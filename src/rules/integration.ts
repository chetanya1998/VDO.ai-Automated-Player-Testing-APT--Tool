import type { CheckResult, Evidence, JsonValue } from "../contracts.js";
import type { SiteTagProfile } from "../profile/tag-identity.js";

export interface IntegrationExpectation {
  tag: SiteTagProfile;
  tagName: string;
  loaderUrl: string;
  expectedRequestCount: number;
  expectedExternalScriptCount: number;
  expectedBootstrapScriptCount: number;
  expectedAnchorCount: number;
  expectedScriptType: string;
}

export interface IntegrationValidationInput {
  evidence: readonly Evidence[];
  expectation: IntegrationExpectation;
  deviceId: string;
  articleEpochId: string;
}

interface LoaderObservation {
  evidenceId: string;
  url: string;
  tagName: string | null;
  resourceType: string | null;
  status: number | null;
  outcome: string | null;
  initiator: JsonValue;
}

function records(value: JsonValue | undefined): Array<{ [key: string]: JsonValue }> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is { [key: string]: JsonValue } => typeof item === "object" && item !== null && !Array.isArray(item));
}

function text(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: JsonValue | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function loaderIdentity(value: string): { canonical: string; tagName: string | null } | null {
  try {
    const url = new URL(value);
    const match = /\/core\/([^/]+)\/vdo\.ai\.js$/i.exec(url.pathname);
    return match === null ? null : { canonical: `${url.origin}${url.pathname}`, tagName: match[1] ?? null };
  } catch {
    return null;
  }
}

function loaderObservations(evidence: readonly Evidence[]): LoaderObservation[] {
  return evidence.flatMap((item) => {
    if (item.source !== "browser_network" || item.data.kind !== "request") return [];
    const url = text(item.data.url);
    const identity = url === null ? null : loaderIdentity(url);
    if (url === null || identity === null) return [];
    return [{
      evidenceId: item.evidenceId,
      url,
      tagName: identity.tagName,
      resourceType: text(item.data.resourceType),
      status: number(item.data.status),
      outcome: text(item.data.outcome),
      initiator: item.data.initiator ?? null,
    }];
  });
}

function domEvidence(evidence: readonly Evidence[]): Evidence[] {
  const unique = new Map<string, Evidence>();
  for (const item of evidence) {
    if (item.source !== "browser_dom" || item.data.kind !== "page_snapshot") continue;
    const rawRef = text(item.data.rawArtifactRef) ?? item.evidenceId;
    const existing = unique.get(rawRef);
    if (existing === undefined || item.capturedAt > existing.capturedAt) unique.set(rawRef, item);
  }
  return [...unique.values()].sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
}

function result(input: IntegrationValidationInput, testCaseId: "TC-1" | "TC-3" | "TC-13", verdict: CheckResult["verdict"], expected: JsonValue, observed: JsonValue, evidenceIds: string[]): CheckResult {
  return {
    testCaseId,
    verdict,
    category: verdict === "PASS" ? "NONE" : verdict === "FAIL" ? "IMPLEMENTATION" : "TOOLING",
    scope: { deviceId: input.deviceId, articleEpochId: input.articleEpochId, tagName: input.expectation.tagName },
    expected,
    observed,
    evidenceIds: [...new Set(evidenceIds)],
  };
}

function validateLoader(input: IntegrationValidationInput, loaders: LoaderObservation[], dom: Evidence | null): CheckResult {
  const expectedIdentity = loaderIdentity(input.expectation.loaderUrl);
  if (expectedIdentity === null) throw new TypeError("expectation.loaderUrl must be a VDO core loader URL");
  const expected = loaders.filter((loader) => loaderIdentity(loader.url)?.canonical === expectedIdentity.canonical);
  const failures: string[] = [];
  if (expected.length === 0) failures.push("expected loader request was not observed");
  for (const loader of expected) {
    if (loader.resourceType !== "script") failures.push("loader request resource type was not script");
    if (loader.status !== 200 || loader.outcome !== "http_success") failures.push(`loader outcome was ${loader.outcome ?? "unknown"} with status ${loader.status ?? "unknown"}`);
  }
  const scripts = dom === null ? [] : records(dom.data.externalScripts).filter((script) => text(script.tagNameFromUrl) === input.expectation.tagName);
  if (scripts.some((script) => text(script.scriptType) !== input.expectation.expectedScriptType)) failures.push("external loader script type did not match the profile");
  const verdict = expected.length === 0 && dom === null ? "UNKNOWN" : failures.length === 0 ? "PASS" : "FAIL";
  return result(input, "TC-1", verdict, {
    loaderUrl: expectedIdentity.canonical,
    resourceType: "script",
    status: 200,
    scriptType: input.expectation.expectedScriptType,
  }, {
    matchingRequests: expected.length,
    requests: expected.map((loader) => ({ url: loader.url, status: loader.status, outcome: loader.outcome, resourceType: loader.resourceType, initiator: loader.initiator })),
    failures,
  }, expected.length > 0 ? expected.map((loader) => loader.evidenceId) : [...loaders.map((loader) => loader.evidenceId), ...(dom === null ? [] : [dom.evidenceId])]);
}

function domCounts(input: IntegrationValidationInput, dom: Evidence) {
  const anchors = records(dom.data.anchors).filter((anchor) => text(anchor.id) === input.expectation.tagName);
  const externalScripts = records(dom.data.externalScripts).filter((script) => text(script.tagNameFromUrl) === input.expectation.tagName);
  const bootstrapScripts = records(dom.data.bootstrapScripts).filter((script) => Array.isArray(script.referencedTags) && script.referencedTags.includes(input.expectation.tagName));
  return { externalScriptCount: externalScripts.length, bootstrapScriptCount: bootstrapScripts.length, anchorCount: anchors.length };
}

function validateCounts(input: IntegrationValidationInput, loaders: LoaderObservation[], doms: readonly Evidence[]): CheckResult {
  const requestCount = loaders.filter((loader) => loader.tagName === input.expectation.tagName).length;
  const dom = doms.at(-1) ?? null;
  if (dom === null) {
    return result(input, "TC-3", "UNKNOWN", "network and DOM counts", { requestCount, dom: "unavailable" }, loaders.map((loader) => loader.evidenceId));
  }
  const expectedAnchorCount = input.expectation.tag.floatingMode === "floating" ? 0 : input.expectation.expectedAnchorCount;
  const counts = { requestCount, ...domCounts(input, dom) };
  const expectedCounts = {
    requestCount: input.expectation.expectedRequestCount,
    externalScriptCount: input.expectation.expectedExternalScriptCount,
    bootstrapScriptCount: input.expectation.expectedBootstrapScriptCount,
    anchorCount: expectedAnchorCount,
  };
  const articleSnapshots = doms.map((item) => ({ articleEpochId: item.articleEpochId, pageUrl: text(item.data.pageUrl), ...domCounts(input, item), evidenceId: item.evidenceId }));
  const passed = Object.entries(expectedCounts).every(([key, value]) => counts[key as keyof typeof counts] === value)
    && articleSnapshots.every((item) => item.externalScriptCount === expectedCounts.externalScriptCount && item.bootstrapScriptCount === expectedCounts.bootstrapScriptCount && item.anchorCount === expectedCounts.anchorCount);
  return result(input, "TC-3", passed ? "PASS" : "FAIL", expectedCounts, { ...counts, physicalLoadRequestCount: requestCount, articleSnapshots }, [...loaders.filter((loader) => loader.tagName === input.expectation.tagName).map((loader) => loader.evidenceId), ...doms.map((item) => item.evidenceId)]);
}

function validateDom(input: IntegrationValidationInput, doms: readonly Evidence[]): CheckResult {
  const dom = doms.at(-1) ?? null;
  if (dom === null) return result(input, "TC-13", "UNKNOWN", "DOM snapshot", "unavailable", []);
  const allAnchors = records(dom.data.anchors);
  const anchors = allAnchors.filter((anchor) => text(anchor.id) === input.expectation.tagName);
  const externalScripts = records(dom.data.externalScripts).filter((script) => text(script.tagNameFromUrl) === input.expectation.tagName);
  const mutations = records(dom.data.mutations).filter((mutation) => text(mutation.tagName) === input.expectation.tagName);
  const failures: string[] = [];
  const floating = input.expectation.tag.floatingMode === "floating";
  if (!floating && anchors.length !== input.expectation.expectedAnchorCount) failures.push(`expected ${input.expectation.expectedAnchorCount} anchor(s), observed ${anchors.length}`);
  if (floating && anchors.length > 0) failures.push("floating profile unexpectedly contained an anchor");
  if (!floating && anchors.some((anchor) => text(anchor.placement) !== "body_content")) failures.push("anchor is outside the approved body/content position");
  if (externalScripts.length !== input.expectation.expectedExternalScriptCount) failures.push(`expected ${input.expectation.expectedExternalScriptCount} external loader script(s), observed ${externalScripts.length}`);
  if (externalScripts.some((script) => text(script.scriptType) !== input.expectation.expectedScriptType)) failures.push("external loader script type did not match the profile");
  for (const mutation of mutations) {
    if ((number(mutation.removed) ?? 0) > 0 || (number(mutation.added) ?? 0) > 1) failures.push(`unexpected removal or recreation: ${text(mutation.identity) ?? "unknown element"}`);
  }
  const articleSnapshots = doms.map((item) => ({
    articleEpochId: item.articleEpochId,
    pageUrl: text(item.data.pageUrl),
    ...domCounts(input, item),
    evidenceId: item.evidenceId,
  }));
  for (const snapshot of articleSnapshots) {
    if (!floating && snapshot.anchorCount !== input.expectation.expectedAnchorCount) failures.push(`${snapshot.pageUrl ?? snapshot.articleEpochId}: anchor count changed to ${snapshot.anchorCount}`);
    if (snapshot.externalScriptCount !== input.expectation.expectedExternalScriptCount) failures.push(`${snapshot.pageUrl ?? snapshot.articleEpochId}: external script count changed to ${snapshot.externalScriptCount}`);
  }
  return result(input, "TC-13", failures.length === 0 ? "PASS" : "FAIL", {
    tagName: input.expectation.tagName,
    placement: floating ? "floating_without_anchor" : input.expectation.tag.placement,
    externalScriptCount: input.expectation.expectedExternalScriptCount,
  }, {
    anchors,
    otherAnchorIds: allAnchors.map((anchor) => text(anchor.id)).filter((id): id is string => id !== null),
    externalScripts,
    mutations,
    articleSnapshots,
    failures,
  }, doms.map((item) => item.evidenceId));
}

export function validateIntegration(input: IntegrationValidationInput): CheckResult[] {
  const loaders = loaderObservations(input.evidence);
  const doms = domEvidence(input.evidence);
  const dom = doms.at(-1) ?? null;
  return [validateLoader(input, loaders, dom), validateCounts(input, loaders, doms), validateDom(input, doms)];
}
