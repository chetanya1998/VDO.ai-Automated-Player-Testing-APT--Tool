import type { CheckResult, Evidence, JsonValue, Verdict } from "../contracts.js";
import { parseBrowserLoggerPayload, summarizePhysicalLoadPayloads, type EventAliasProfile, type ParsedBrowserLoggerPayload } from "../logger/browser-payload.js";
import { validateTagSet, type Product, type SiteProfileCatalog } from "../profile/tag-identity.js";

// TC-18, TC-19 and TC-20 have parsing/identity helpers but no CheckResult emitter in the
// validator report. These adapters turn the existing helpers' results into checks for deep tests.

export interface LoggerCaseInput {
  evidence: readonly Evidence[];
  aliases: EventAliasProfile;
  deviceId: string;
  articleEpochId: string;
  tagName: string;
  captureComplete: boolean;
}

interface LoggerRecord {
  evidenceId: string;
  payload: ParsedBrowserLoggerPayload;
}

function loggerRecords(input: LoggerCaseInput): LoggerRecord[] {
  return input.evidence
    .filter((item) => item.source === "browser_logger")
    .map((item) => {
      const fields = typeof item.data.fields === "object" && item.data.fields !== null && !Array.isArray(item.data.fields) ? item.data.fields : null;
      const malformed = item.data.parseState === "malformed" || item.data.parseState === "empty" || fields === null;
      return { evidenceId: item.evidenceId, payload: parseBrowserLoggerPayload(malformed ? null : JSON.stringify(fields), "application/json", input.aliases) };
    });
}

function check(input: LoggerCaseInput, testCaseId: "TC-18" | "TC-19" | "TC-20", verdict: Verdict, expected: JsonValue, observed: JsonValue, evidenceIds: string[]): CheckResult {
  return {
    testCaseId,
    verdict,
    category: verdict === "PASS" || verdict === "NOT_APPLICABLE" ? "NONE" : verdict === "UNKNOWN" ? "TOOLING" : "IMPLEMENTATION",
    scope: { deviceId: input.deviceId, articleEpochId: input.articleEpochId, tagName: input.tagName },
    expected,
    observed,
    evidenceIds,
  };
}

const PRODUCT_PREFIXES: Record<string, Product> = { v: "video", c: "carousel", s: "story", b: "banner" };

export function productForTag(tagName: string): Product | null {
  return PRODUCT_PREFIXES[tagName.split("-", 1)[0] ?? ""] ?? null;
}

export function validateTagDomain(input: LoggerCaseInput & { targetUrl: string; domain: string }): CheckResult {
  const product = productForTag(input.tagName);
  const records = loggerRecords(input);
  if (product === null) return check(input, "TC-18", "FAIL", { productPrefixes: Object.keys(PRODUCT_PREFIXES) }, {
    state: "tag_prefix_not_approved",
    detail: `${input.tagName} does not start with an approved v/c/s/b product prefix.`,
  }, records.map((item) => item.evidenceId));
  const host = new URL(input.targetUrl).hostname.toLowerCase();
  // The tag under test and its -v<number> siblings form one family (Tech Doc: "-v{Number of Tag}").
  const baseTag = input.tagName.replace(/-v[1-9]\d*$/, "");
  const inFamily = (name: string) => name === baseTag || (name.startsWith(`${baseTag}-v`) && /^[1-9]\d*$/.test(name.slice(baseTag.length + 2)));
  const allPairs = [...new Map(records.flatMap(({ payload }) => payload.fields.tagName === null ? [] : [{ tagName: payload.fields.tagName, domainName: payload.fields.domainName }])
    .map((pair) => [`${pair.tagName}\u0000${pair.domainName ?? ""}`, pair] as const)).values()];
  // When only other tags fired, judge those: a page logging another site's tag is a TC-18 failure.
  const familyPairs = allPairs.filter((pair) => inFamily(pair.tagName));
  const pairs = familyPairs.length > 0 ? familyPairs : allPairs;
  const otherTags = [...new Set(allPairs.filter((pair) => !inFamily(pair.tagName)).map((pair) => pair.tagName))];
  const catalog: SiteProfileCatalog = {
    schemaVersion: 1,
    status: "synthetic_draft",
    productPrefixes: { v: "video", c: "carousel", s: "story", b: "banner" },
    sites: [{
      mappingId: `deep-input-${input.domain}`,
      approvedHosts: [...new Set([host, input.domain, `www.${input.domain}`])],
      rootDomain: input.domain,
      acceptedDomainNames: [...new Set([input.domain, `www.${input.domain}`, host])],
      allowMultipleTags: true,
      tags: [{
        baseTag,
        allowedTagNames: [...new Set([baseTag, input.tagName, ...familyPairs.map((pair) => pair.tagName)])],
        product,
        placement: "unconfirmed",
        floatingMode: "unconfirmed",
        ruleSupport: product === "video" ? "supported" : "unsupported",
      }],
    }],
  };
  const result = validateTagSet({ siteUrl: input.targetUrl, observations: pairs }, catalog);
  const verdict: Verdict = result.verdict === "PASS" && !input.captureComplete ? "UNKNOWN" : result.verdict;
  return check(input, "TC-18", verdict, {
    mappingSource: "deep_test_input",
    domain: input.domain,
    tagName: input.tagName,
    product,
  }, {
    ...(pairs.length === 0 ? { state: "no_logger_identity_observed" } : {}),
    observations: pairs,
    ...(otherTags.length > 0 ? { otherTagsOnPage: otherTags } : {}),
    identities: result.identities.map((item) => ({ verdict: item.verdict, reason: item.reason, detail: item.detail })),
    detail: result.detail,
  }, records.map((item) => item.evidenceId));
}

export function validateDependencyBuild(input: LoggerCaseInput): CheckResult {
  const records = loggerRecords(input);
  const summary = summarizePhysicalLoadPayloads(records.map((item) => item.payload));
  const changed = summary.diagnostics.some((item) => item.code === "dep_changed");
  const verdict: Verdict = changed ? "FAIL" : summary.depValues.length === 0 || !input.captureComplete ? "UNKNOWN" : "PASS";
  return check(input, "TC-19", verdict, { depValuesPerPhysicalLoad: 1 }, {
    ...(summary.depValues.length === 0 ? { state: records.length === 0 ? "no_logger_requests_observed" : "dep_field_not_observed" } : {}),
    depValues: summary.depValues,
    tagNames: summary.tagNames,
    diagnostics: summary.diagnostics.map((item) => ({ code: item.code, severity: item.severity, detail: item.detail })),
  }, records.map((item) => item.evidenceId));
}

export function validateEventSanity(input: LoggerCaseInput): CheckResult {
  const records = loggerRecords(input);
  const problems = records.flatMap(({ evidenceId, payload }) => payload.diagnostics.map((item) => ({ evidenceId, code: item.code, field: item.field, detail: item.detail })));
  const verdict: Verdict = records.length === 0 ? "UNKNOWN" : problems.length > 0 ? "WARNING" : input.captureComplete ? "PASS" : "UNKNOWN";
  const rawEvents = [...new Set(records.flatMap(({ payload }) => payload.rawEvent === null ? [] : [payload.rawEvent]))];
  return check(input, "TC-20", verdict, { requiredNonEmptyFields: ["event", "tagName", "domainName", "page_url", "dep"], eventVocabulary: "configured aliases" }, {
    ...(records.length === 0 ? { state: "no_logger_requests_observed" } : {}),
    loggerRequests: records.length,
    rawEvents,
    unknownEvents: [...new Set(problems.filter((item) => item.code === "unknown_event").map((item) => item.detail))],
    problems: problems.slice(0, 50),
  }, problems.length > 0 ? [...new Set(problems.map((item) => item.evidenceId))] : records.map((item) => item.evidenceId));
}

export interface PlayerFileTimingInput {
  evidence: readonly Evidence[];
  dependencies: ReadonlyArray<{ id: string; products: string[]; pathSuffixes: string[]; pathPatterns?: string[] }>;
  product: string;
  deviceId: string;
  articleEpochId: string;
  tagName: string;
  passMaxMs: number;
  warningMaxMs: number;
}

// TC-2 as agreed for deep tests: every request for the player's own files (vdo.ai.js and the files TC-12 checks)
// must finish within passMaxMs; up to warningMaxMs is a warning; slower, or never finishing, fails. The slowest file decides.
export function validatePlayerFileTiming(input: PlayerFileTimingInput): CheckResult {
  const loaderPath = `/core/${input.tagName}/vdo.ai.js`;
  const dependencies = input.dependencies.filter((item) => item.products.includes(input.product) && item.id !== "vdo.ai.js")
    .map((item) => ({ id: item.id, suffixes: item.pathSuffixes, patterns: (item.pathPatterns ?? []).map((pattern) => new RegExp(pattern, "i")) }));
  const rank: Record<Verdict, number> = { PASS: 0, NOT_APPLICABLE: 0, UNKNOWN: 1, WARNING: 2, FAIL: 3 };
  const files = input.evidence.flatMap((item) => {
    if (item.source !== "browser_network" || item.data.kind !== "request" || typeof item.data.url !== "string") return [];
    let url: URL;
    try { url = new URL(item.data.url); } catch { return []; }
    const id = url.pathname.endsWith(loaderPath) ? "vdo.ai.js"
      : dependencies.find((dependency) => dependency.suffixes.some((suffix) => url.pathname.endsWith(suffix)) || dependency.patterns.some((pattern) => pattern.test(url.pathname)))?.id;
    if (id === undefined) return [];
    const outcome = typeof item.data.outcome === "string" ? item.data.outcome : "incomplete";
    const durationMs = typeof item.data.durationMs === "number" ? item.data.durationMs : null;
    const finished = outcome === "http_success" || outcome === "http_failure";
    const band: Verdict = !finished || durationMs === null || durationMs > input.warningMaxMs ? "FAIL" : durationMs > input.passMaxMs ? "WARNING" : "PASS";
    return [{ evidenceId: item.evidenceId, file: id, url: `${url.origin}${url.pathname}`, durationMs, outcome, band }];
  }).sort((left, right) => rank[right.band] - rank[left.band] || (right.durationMs ?? Infinity) - (left.durationMs ?? Infinity));
  const verdict: Verdict = files.length === 0 ? "UNKNOWN" : files.reduce<Verdict>((worst, item) => rank[item.band] > rank[worst] ? item.band : worst, "PASS");
  const failures = files.filter((item) => item.band !== "PASS").map((item) => item.durationMs === null || !["http_success", "http_failure"].includes(item.outcome)
    ? `${item.file} never finished loading`
    : `${item.file} took ${item.durationMs} ms (${item.band === "FAIL" ? `over ${input.warningMaxMs}` : `over ${input.passMaxMs}`} ms)`);
  return {
    testCaseId: "TC-2",
    verdict,
    category: verdict === "PASS" ? "NONE" : verdict === "UNKNOWN" ? "TOOLING" : "RUNTIME_BROWSER",
    scope: { deviceId: input.deviceId, articleEpochId: input.articleEpochId, tagName: input.tagName },
    expected: { files: "vdo.ai.js and the player files TC-12 checks", passMaxMs: input.passMaxMs, warningMaxMs: input.warningMaxMs },
    observed: {
      ...(files.length === 0 ? { state: "no_player_file_requests_observed" } : {}),
      files,
      failures,
    },
    evidenceIds: files.map((item) => item.evidenceId),
  };
}
