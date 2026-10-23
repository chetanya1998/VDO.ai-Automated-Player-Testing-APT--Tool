import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { buildArticleEpochs, parseArticlePolicy } from "../browser/articles.js";
import { createQueuedRun, parseProfile, parseRun, type CheckResult, type JsonValue, type TestCaseId, type Verdict } from "../contracts.js";
import { normalizeEvidence } from "../evidence/normalize.js";
import { parseEventAliasProfile } from "../logger/browser-payload.js";
import type { SiteTagProfile } from "../profile/tag-identity.js";
import { diagnose, parseRcaPolicy } from "../rca/diagnose.js";
import { buildReport, type DeterministicReport } from "../report/build.js";
import { validateArticles } from "../rules/articles.js";
import { applyAuctionContext, parseAuctionPolicy, validateAuction } from "../rules/auction.js";
import { applyRuntimeContext, parseRuntimePolicy, validateBlockedEvents } from "../rules/blocked.js";
import { applyDemandContext, parseDemandPolicy, validateDemand } from "../rules/demand.js";
import { validateDependencies } from "../rules/dependencies.js";
import { parseDevicePolicy, validateDevice } from "../rules/devices.js";
import { parseEventRulePolicy, validateEvents } from "../rules/events.js";
import { validateIntegration, type IntegrationExpectation } from "../rules/integration.js";
import { validateLayout } from "../rules/layout.js";
import { validateLoggerPresence } from "../rules/logger-presence.js";
import { parseTimingPolicy, validateTiming } from "../rules/timing.js";
import { applyViewabilityContext, applyVisibilityContext, parseVisibilityPolicy, validateViewability } from "../rules/viewability.js";
import { productForTag, validateDependencyBuild, validateEventSanity, validateTagDomain } from "./cases.js";
import { runDeepBrowser, type DeepBrowserRunOptions, type DeepBrowserRunResult, type DeepScrollSettings } from "./runner.js";

export const CASE_TITLES: Record<TestCaseId, string> = {
  "TC-1": "Correct tag and vdo.ai.js loading",
  "TC-2": "Load time of vdo.ai.js",
  "TC-3": "Tag loads only once",
  "TC-4": "Logger requests are firing",
  "TC-5": "Logger event sequence",
  "TC-6": "Individual event checks",
  "TC-7": "Pageview counts",
  "TC-8": "ATF, BTF and Came In View",
  "TC-9": "Ad request",
  "TC-10": "Ad serving chain and viewable impression",
  "TC-11": "Blocked events and errors",
  "TC-12": "Dependency loading",
  "TC-13": "DOM check",
  "TC-14": "Player formation and CSS layout",
  "TC-15": "Timing of logger events",
  "TC-16": "Device coverage",
  "TC-17": "Payload consistency",
  "TC-18": "Tag to domain match",
  "TC-19": "Dependency build check",
  "TC-20": "Event name and field sanity",
  "TC-21": "Current article URL equals logger page_url",
  "TC-22": "loaded and Pageview once per article URL",
  "TC-23": "Infinite scroll and SPA scenario",
};

export type DeepDeviceKind = "desktop" | "mobile";
export type DeepCodeType = "vdo.ai.js" | "style.css";

export interface DeepValidationInput {
  targetUrl: string;
  domain: string;
  tagName: string;
  device: { id: string; kind: DeepDeviceKind; contextOptions: DeepBrowserRunOptions["contextOptions"] };
  browserExecutablePath: string;
  code?: { type: DeepCodeType; body: string };
  scroll?: DeepScrollSettings;
  observeAfterLoadMs?: number;
  navigationTimeoutMs?: number;
  totalTimeoutMs?: number;
  configDirectory?: string;
  // Defaults to https://a.vdo.ai/core/<tag>/vdo.ai.js; local fixture tests serve the tag themselves.
  loaderUrl?: string;
  allowPrivateNetwork?: boolean;
  runBrowser?: (options: DeepBrowserRunOptions) => Promise<DeepBrowserRunResult>;
}

export interface DeepCaseSummary {
  testCaseId: TestCaseId;
  title: string;
  verdict: Verdict;
  category: string;
  summary: string;
  expected: JsonValue;
  observed: JsonValue;
  evidenceCount: number;
}

export interface DeepValidationSummary {
  schemaVersion: 1;
  targetUrl: string;
  finalUrl: string | null;
  deviceId: string;
  executionState: DeterministicReport["executionState"];
  overallVerdict: Verdict;
  verdictCounts: Record<Verdict, number>;
  policyStatus: "draft" | "confirmed";
  draftPolicies: string[];
  captureComplete: boolean;
  evidenceRecords: number;
  scriptOverrideHits: number | null;
  blockedRequestCount: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  cases: DeepCaseSummary[];
  probableCauses: Array<{ testCaseId: TestCaseId; code: string; summary: string; confidence: string; owner: string; nextChecks: string[]; rules: "draft" | "confirmed" }>;
  executionErrors: Array<{ stage: string; message: string }>;
  limitations: string[];
}

export interface DeepValidationResult {
  summary: DeepValidationSummary;
  report: DeterministicReport;
}

const DEFAULT_CONFIG_DIRECTORY = fileURLToPath(new URL("../../../config/", import.meta.url));
const MAX_DETAIL_CHARS = 4_000;

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

async function readJson(directory: string, name: string): Promise<Record<string, unknown>> {
  return object(JSON.parse(await readFile(join(directory, name), "utf8")), name);
}

function rescoped(policy: Record<string, unknown>, profileId: string): Record<string, unknown> {
  return { ...policy, profileId };
}

function bounded(value: JsonValue): JsonValue {
  const text = JSON.stringify(value);
  if (text === undefined || text.length <= MAX_DETAIL_CHARS) return value;
  return { truncated: true, preview: `${text.slice(0, MAX_DETAIL_CHARS)}…` };
}

// Which repository policy each case's rule depends on, used to explain UNKNOWN verdicts.
const CASE_POLICIES: Partial<Record<TestCaseId, { key: string; label: string }>> = {
  "TC-2": { key: "timing", label: "timing" },
  "TC-5": { key: "eventRules", label: "event rules" },
  "TC-6": { key: "eventRules", label: "event rules" },
  "TC-7": { key: "eventRules", label: "event rules" },
  "TC-8": { key: "visibilityPolicy", label: "visibility" },
  "TC-9": { key: "demandPolicy", label: "demand" },
  "TC-10": { key: "demandPolicy", label: "demand and auction" },
  "TC-11": { key: "runtimePolicy", label: "runtime (blocked events)" },
  "TC-12": { key: "runtimePolicy", label: "runtime (dependencies)" },
  "TC-15": { key: "timing", label: "timing" },
  "TC-16": { key: "devicePolicy", label: "device" },
  "TC-22": { key: "eventRules", label: "event rules" },
  "TC-23": { key: "articlePolicy", label: "article navigation" },
};

function describe(item: unknown): string {
  if (typeof item === "string") return item;
  if (typeof item === "object" && item !== null && !Array.isArray(item)) {
    const record = item as Record<string, unknown>;
    for (const key of ["detail", "reason", "message", "cause"]) if (typeof record[key] === "string") return record[key] as string;
  }
  return JSON.stringify(item);
}

const readable = (value: string) => value.replaceAll("_", " ");

// A short, plain-language reason taken from the rule's own observation.
export function caseSummary(check: CheckResult, draftPolicies: readonly string[] = []): string {
  const observed = check.observed;
  if (typeof observed === "string") return observed;
  const record = observed !== null && typeof observed === "object" && !Array.isArray(observed) ? observed : {};
  if (check.verdict !== "PASS" && check.verdict !== "NOT_APPLICABLE") {
    for (const key of ["failures", "problems", "violations", "coverageGaps", "mismatches", "missingRequests"]) {
      const list = record[key];
      if (Array.isArray(list) && list.length > 0) return list.slice(0, 3).map(describe).join("; ");
    }
    if (typeof record.firstFailure === "string") return readable(record.firstFailure);
    if (typeof record.state === "string") return readable(record.state);
    if (typeof record.detail === "string") return record.detail;
    const expected = check.expected !== null && typeof check.expected === "object" && !Array.isArray(check.expected) ? check.expected : {};
    const differences = Object.entries(expected).flatMap(([key, value]) => {
      const actual = record[key];
      const primitive = (item: unknown) => item === null || ["string", "number", "boolean"].includes(typeof item);
      return primitive(value) && primitive(actual) && actual !== value ? [`${readable(key)}: expected ${String(value)}, observed ${String(actual)}`] : [];
    });
    if (differences.length > 0) return differences.slice(0, 3).join("; ");
  }
  if (check.verdict === "FAIL" || check.verdict === "WARNING") return "Did not match the expected behaviour; see the observed detail.";
  if (check.verdict === "UNKNOWN") {
    if (check.testCaseId === "TC-23") return "Needs an approved infinite-scroll/SPA navigation for this site; only one article was visited.";
    const policy = CASE_POLICIES[check.testCaseId];
    if (policy !== undefined && draftPolicies.includes(policy.key)) return `Evidence captured, but the ${policy.label} policy is still a draft; this rule only passes against a confirmed policy.`;
    return "Required evidence was not captured.";
  }
  if (check.verdict === "PASS") {
    if (typeof record.state === "string") return readable(record.state);
    return "Observed behaviour matched the rule.";
  }
  return "Not applicable to this page or product.";
}

function devicePolicyFor(raw: Record<string, unknown>, input: DeepValidationInput, profileId: string): Record<string, unknown> {
  const devices = (Array.isArray(raw.devices) ? raw.devices : []).map((item) => object(item, "devicePolicy.devices[]"));
  if (!devices.some((item) => item.kind === input.device.kind)) throw new TypeError(`device policy has no ${input.device.kind} template`);
  return {
    ...raw,
    profileId,
    // The policy must describe desktop and mobile; only the entry for the tested device is replaced.
    devices: devices.map((template) => template.kind !== input.device.kind ? template : {
      ...template,
      id: input.device.id,
      viewport: input.device.contextOptions.viewport,
      emulated: input.device.kind === "mobile",
      // The fixture tap selector is not a publisher selector; no tap is configured for real pages.
      tap: { state: "disabled", selector: null, settleMs: 0, playbackRequired: false },
    }),
  };
}

function loaderUrlFor(input: DeepValidationInput): string {
  return input.loaderUrl ?? `https://a.vdo.ai/core/${input.tagName}/vdo.ai.js`;
}

function profileFor(template: Record<string, unknown>, input: DeepValidationInput, profileId: string): Record<string, unknown> {
  const url = new URL(input.targetUrl);
  const site = object(template.site, "profile.site");
  const tag = object(template.tag, "profile.tag");
  const player = object(template.player, "profile.player");
  const features = object(player.features, "profile.player.features");
  const anchor = object(features.anchor, "profile.player.features.anchor");
  return {
    ...template,
    profileId,
    description: "Generated for a placement deep test from the check's domain, tag and URL. Policies are the repository drafts.",
    site: {
      ...site,
      identityMappingId: `deep-input-${input.domain}`,
      approvedUrls: [input.targetUrl],
      expectedOrigin: url.origin,
      expectedDomainName: input.domain,
    },
    tag: {
      ...tag,
      mappingSource: "deep_test_input",
      expected: [input.tagName],
      loaderUrl: loaderUrlFor(input),
    },
    player: {
      ...player,
      product: productForTag(input.tagName) ?? "video",
      features: { ...features, anchor: { ...anchor, expectedId: input.tagName } },
    },
    devices: [{
      id: input.device.id,
      state: "enabled",
      browser: "chromium",
      viewport: input.device.contextOptions.viewport,
      emulated: input.device.kind === "mobile",
    }],
  };
}

function integrationExpectation(rawProfile: Record<string, unknown>, tagName: string): IntegrationExpectation {
  const tag = object(rawProfile.tag, "profile.tag");
  const player = object(rawProfile.player, "profile.player");
  const features = object(player.features, "profile.player.features");
  const anchor = object(features.anchor, "profile.player.features.anchor");
  const floating = object(features.floating, "profile.player.features.floating");
  const product = productForTag(tagName) ?? "video";
  const floatingMode = floating.state === "enabled" ? "floating" : floating.state === "disabled" ? "inline" : "unconfirmed";
  const siteTag: SiteTagProfile = {
    baseTag: tagName,
    allowedTagNames: [tagName],
    product,
    placement: player.placement === "inline_body_content" ? "inline_body_content" : floatingMode === "floating" ? "floating" : "unconfirmed",
    floatingMode,
    ruleSupport: product === "video" ? "supported" : "unsupported",
  };
  return {
    tag: siteTag,
    tagName,
    loaderUrl: String(tag.loaderUrl),
    expectedRequestCount: Number(tag.expectedRequestCount),
    expectedExternalScriptCount: Number(tag.expectedExternalScriptCount),
    expectedBootstrapScriptCount: Number(tag.expectedBootstrapScriptCount),
    expectedAnchorCount: Number(anchor.expectedCount),
    expectedScriptType: String(tag.expectedScriptType),
  };
}

// Real pages always end with some requests in flight (media, ad refresh, beacons). The deep test treats the
// capture as complete when nothing structural is missing and every logger and tag-loader request finished.
const STRUCTURAL_GAPS = new Set(["service_worker_visibility", "evidence_limit_reached", "page_capture_unavailable"]);

function deepCaptureComplete(browser: DeepBrowserRunResult, tagName: string): boolean {
  if (browser.status !== "completed") return false;
  if (browser.capture.gaps.some((gap) => STRUCTURAL_GAPS.has(gap.code))) return false;
  const byId = new Map(browser.capture.evidence.map((item) => [item.evidenceId, item]));
  const loggerNetworkIds = new Set(browser.capture.evidence.flatMap((item) => item.source === "browser_logger" && typeof item.data.networkEvidenceId === "string" ? [item.data.networkEvidenceId] : []));
  return !browser.capture.gaps.some((gap) => {
    if (gap.code !== "request_incomplete" || gap.evidenceId === null) return false;
    const url = String(byId.get(gap.evidenceId)?.data.url ?? "");
    return loggerNetworkIds.has(gap.evidenceId) || url.includes(`/core/${tagName}/vdo.ai.js`);
  });
}

function inFlightAtEnd(browser: DeepBrowserRunResult): number {
  return browser.capture.gaps.filter((gap) => gap.code === "request_incomplete").length;
}

// Reports require FAIL/WARNING findings to cite evidence; a finding with nothing captured stays open as UNKNOWN.
function requireEvidence(checks: readonly CheckResult[]): CheckResult[] {
  return checks.map((check) => (check.verdict === "FAIL" || check.verdict === "WARNING") && check.evidenceIds.length === 0
    ? { ...check, verdict: "UNKNOWN", category: "TOOLING", observed: { state: "no_captured_evidence_for_finding", ruleVerdict: check.verdict, capturedObservation: check.observed } }
    : check);
}

function markExecutionUnverified(checks: readonly CheckResult[], reason: string): CheckResult[] {
  return checks.map((check) => ({
    ...check,
    verdict: "UNKNOWN",
    category: "TOOLING",
    observed: { state: "execution_error", reason, capturedObservation: check.observed },
  }));
}

export async function runDeepValidation(input: DeepValidationInput): Promise<DeepValidationResult> {
  if (!/^[\w-]+$/.test(input.tagName)) throw new TypeError("tagName may only contain letters, numbers, _ and -");
  const directory = input.configDirectory ?? DEFAULT_CONFIG_DIRECTORY;
  const profileId = `deep-${input.tagName}`;
  const [profileTemplate, rawAliases, rawTiming, rawEventRules, rawRuntime, rawDemand, rawAuction, rawVisibility, rawArticle, rawDevices, rawRca] = await Promise.all([
    readJson(join(directory, "profiles"), "fixture-video-inline-v1.json"),
    readJson(directory, "event-aliases.json"),
    readJson(directory, "timing.json"),
    readJson(directory, "event-rules.json"),
    readJson(directory, "runtime-policy.json"),
    readJson(directory, "demand-policy.json"),
    readJson(directory, "auction-rules.json"),
    readJson(directory, "visibility-policy.json"),
    readJson(directory, "article-policy.json"),
    readJson(directory, "devices.json"),
    readJson(directory, "rca-rules.json"),
  ]);
  const rawProfile = profileFor(profileTemplate, input, profileId);
  const profile = parseProfile(rawProfile);
  const aliases = parseEventAliasProfile(rescoped(rawAliases, profileId));
  const timing = parseTimingPolicy(rawTiming);
  const eventRules = parseEventRulePolicy(rescoped(rawEventRules, profileId));
  const runtimePolicy = parseRuntimePolicy(rescoped(rawRuntime, profileId));
  const demandPolicy = parseDemandPolicy(rescoped(rawDemand, profileId));
  const auctionPolicy = parseAuctionPolicy(rescoped(rawAuction, profileId));
  const visibilityPolicy = parseVisibilityPolicy(rescoped(rawVisibility, profileId));
  // No approved click/scroll navigation exists for an arbitrary publisher page.
  const articlePolicy = parseArticlePolicy({ ...rescoped(rawArticle, profileId), actions: [] });
  const devicePolicy = parseDevicePolicy(devicePolicyFor(rawDevices, input, profileId));
  const rcaPolicy = parseRcaPolicy(rescoped(rawRca, profileId));
  const deviceRule = devicePolicy.devices.find((item) => item.id === input.device.id)!;
  const expectation = integrationExpectation(rawProfile, input.tagName);
  const policies = { aliases, timing, eventRules, runtimePolicy, demandPolicy, auctionPolicy, visibilityPolicy, articlePolicy, devicePolicy, rcaPolicy };
  const draftPolicies = Object.entries(policies).flatMap(([name, policy]) => policy.status === "confirmed" ? [] : [name]);

  const runId = `deep-${randomUUID()}`;
  const queued = createQueuedRun({ runId, profileId, targetUrl: input.targetUrl, deviceId: input.device.id, createdAt: new Date().toISOString() });
  const browser = await (input.runBrowser ?? runDeepBrowser)({
    targetUrl: input.targetUrl,
    browserExecutablePath: input.browserExecutablePath,
    contextOptions: input.device.contextOptions,
    navigationTimeoutMs: input.navigationTimeoutMs ?? 30_000,
    totalTimeoutMs: input.totalTimeoutMs ?? 90_000,
    observeAfterLoadMs: input.observeAfterLoadMs ?? 15_000,
    visibilitySampleIntervalMs: visibilityPolicy.sampleIntervalMs,
    ...(input.scroll === undefined ? {} : { scroll: input.scroll }),
    ...(input.code?.type === "vdo.ai.js" ? { scriptOverride: { tagName: input.tagName, body: input.code.body, loaderOrigin: new URL(loaderUrlFor(input)).origin } } : {}),
    ...(input.code?.type === "style.css" ? { injectCss: input.code.body } : {}),
    ...(input.allowPrivateNetwork === undefined ? {} : { allowPrivateNetwork: input.allowPrivateNetwork }),
  });
  const executionState = browser.status === "completed" ? "completed" : browser.status === "timed_out" ? "timed_out" : "errored";
  const run = parseRun({ ...queued, executionState });
  const captureComplete = deepCaptureComplete(browser, input.tagName);
  const articleEpochs = buildArticleEpochs({
    runId,
    targetUrl: input.targetUrl,
    startedAt: browser.startedAt,
    endedAt: browser.endedAt,
    capture: browser.capture.evidence,
    revisit: articlePolicy.revisit,
  });
  const articleEpoch = articleEpochs[0]!;
  const bundle = normalizeEvidence({ run, capture: browser.capture, articleEpochs, profile, eventAliases: aliases, physicalLoadId: `${runId}-load-1` });
  const shared = { evidence: bundle.evidence, deviceId: run.deviceId, articleEpochId: articleEpoch.articleEpochId, tagName: expectation.tagName };

  // Same composition as the validator's report command, plus the TC-18/19/20 adapters.
  const eventChecks = validateEvents({ evidence: bundle.evidence, policy: eventRules, deviceId: run.deviceId, articleEpochId: articleEpoch.articleEpochId, activeTags: [expectation.tagName], captureComplete });
  const articleChecks = validateArticles({ evidence: bundle.evidence, articleEpochs, articlePolicy, eventPolicy: eventRules, deviceId: run.deviceId, activeTags: [expectation.tagName], expectedDomainName: input.domain, captureComplete });
  const runtimeShared = { evidence: bundle.evidence, policy: runtimePolicy, profileId, product: expectation.tag.product, deviceId: run.deviceId, articleEpochId: articleEpoch.articleEpochId, tagName: expectation.tagName, captureComplete };
  const dependencies = validateDependencies(runtimeShared);
  const blocked = validateBlockedEvents(runtimeShared);
  const demand = validateDemand({ ...runtimeShared, policy: demandPolicy });
  const auction = validateAuction({ ...runtimeShared, policy: auctionPolicy, demandPolicy });
  const viewability = validateViewability({ ...runtimeShared, policy: visibilityPolicy });
  const layout = validateLayout(runtimeShared);
  const deviceCheck = validateDevice({ evidence: bundle.evidence, policy: devicePolicy, device: deviceRule, deviceId: run.deviceId, captureComplete, runtime: { os: browser.metadata.os, browser: browser.metadata.browser, viewport: browser.metadata.viewport } });
  const loggerCaseInput = { ...shared, aliases, captureComplete };
  const evaluatedChecks = [
    ...validateIntegration({ ...shared, expectation }),
    ...validateTiming({ ...shared, policy: timing, loaderUrl: expectation.loaderUrl, captureContext: { coldCache: browser.metadata.coldCache, networkConditions: browser.metadata.networkConditions } }),
    validateLoggerPresence({ ...shared, loaderUrl: expectation.loaderUrl, captureComplete }),
    ...applyDemandContext(applyRuntimeContext(applyVisibilityContext(eventChecks.filter((check) => check.testCaseId !== "TC-7" && check.testCaseId !== "TC-22"), viewability), blocked, dependencies), demand),
    ...articleChecks,
    viewability.tc8,
    blocked.check,
    dependencies,
    applyAuctionContext(applyViewabilityContext(demand.check, viewability), auction),
    layout,
    deviceCheck,
    validateTagDomain({ ...loggerCaseInput, targetUrl: input.targetUrl, domain: input.domain }),
    validateDependencyBuild(loggerCaseInput),
    validateEventSanity(loggerCaseInput),
  ];
  const checks = browser.status === "runner_error"
    ? markExecutionUnverified(evaluatedChecks, browser.errors.map((error) => error.message).join("; ") || "browser runner error")
    : requireEvidence(evaluatedChecks);
  const report = buildReport({
    reportId: `report-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    bundle,
    checks,
    captureComplete,
    executionErrors: browser.errors,
    // The report builder accepts only confirmed RCA rules; draft rules are applied below and labelled.
    ...(rcaPolicy.status === "confirmed" ? { rcaPolicy } : {}),
  });
  const diagnoses = rcaPolicy.status === "confirmed" ? report.diagnoses : diagnose(report.checks, bundle.evidence, rcaPolicy);

  const limitations = [
    ...(draftPolicies.length > 0 ? [`Draft policies (${draftPolicies.join(", ")}) are used; rules that require confirmed policy report UNKNOWN instead of PASS.`] : []),
    "No approved click/scroll article navigation exists for this page, so TC-23 cannot reach three distinct articles.",
    ...(input.device.kind === "mobile" ? ["Mobile is Chromium emulation and cannot certify real iOS/Safari behaviour."] : []),
    ...(input.code?.type === "vdo.ai.js" && browser.scriptOverrideHits === 0 ? ["The page never requested the tag's vdo.ai.js, so the custom placement code did not run."] : []),
    ...(inFlightAtEnd(browser) > 0 ? [`${inFlightAtEnd(browser)} request(s) were still in flight when observation ended; they are recorded but only logger and tag-loader requests must finish.`] : []),
    ...(browser.blockedRequestCount > 0 ? [`${browser.blockedRequestCount} request(s) to private or unresolvable addresses were blocked.`] : []),
  ];

  const summary: DeepValidationSummary = {
    schemaVersion: 1,
    targetUrl: input.targetUrl,
    finalUrl: browser.metadata.finalUrl,
    deviceId: input.device.id,
    executionState: report.executionState,
    overallVerdict: report.overallVerdict,
    verdictCounts: report.verdictCounts,
    policyStatus: draftPolicies.length === 0 ? "confirmed" : "draft",
    draftPolicies,
    captureComplete,
    evidenceRecords: report.coverage.evidenceRecords,
    scriptOverrideHits: input.code?.type === "vdo.ai.js" ? browser.scriptOverrideHits : null,
    blockedRequestCount: browser.blockedRequestCount,
    startedAt: browser.startedAt,
    finishedAt: browser.endedAt,
    durationMs: browser.durationMs,
    cases: report.checks.map((check) => ({
      testCaseId: check.testCaseId,
      title: CASE_TITLES[check.testCaseId] ?? check.testCaseId,
      verdict: check.verdict,
      category: check.category,
      summary: caseSummary(check, draftPolicies).slice(0, 500),
      expected: bounded(check.expected),
      observed: bounded(check.observed),
      evidenceCount: check.evidenceIds.length,
    })),
    probableCauses: diagnoses.slice(0, 5).map((diagnosis) => ({
      testCaseId: diagnosis.primarySymptom.testCaseId,
      code: diagnosis.probableCause.code,
      summary: diagnosis.probableCause.summary,
      confidence: diagnosis.probableCause.confidence,
      owner: diagnosis.suggestedOwner,
      nextChecks: diagnosis.nextChecks.slice(0, 5),
      rules: rcaPolicy.status,
    })),
    executionErrors: report.executionErrors.map((error) => ({ stage: error.stage, message: error.message })),
    limitations,
  };
  return { summary, report };
}
