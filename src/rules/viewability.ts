import type { CheckResult, Evidence, IssueCategory, JsonValue, Verdict } from "../contracts.js";
import { readVisibilitySamples, type VisibilitySample } from "./layout.js";

export interface VisibilityPolicy {
  schemaVersion: number;
  policyId: string;
  profileId: string;
  status: "draft" | "confirmed";
  sampleIntervalMs: number;
  maximumSampleGapMs: number;
  cameInViewMinimumPercent: number;
  products: Array<{ product: string; minimumVisiblePercent: number; minimumContinuousMs: number; eligibilityEvent: string }>;
}

export interface ViewabilityValidationInput {
  evidence: readonly Evidence[];
  policy: VisibilityPolicy;
  profileId: string;
  product: string;
  deviceId: string;
  articleEpochId: string;
  tagName: string;
  captureComplete: boolean;
}

export interface ViewabilityValidation {
  tc8: CheckResult;
  verdict: Verdict;
  category: IssueCategory;
  eligible: boolean;
  reported: boolean;
  sufficientExposure: boolean | null;
  expectedViewableEvent: boolean | null;
  expected: JsonValue;
  observed: JsonValue;
  evidenceIds: string[];
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a non-empty string`);
  return value;
}

function positive(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new TypeError(`${path} must be a positive number`);
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = positive(value, path);
  if (!Number.isInteger(parsed)) throw new TypeError(`${path} must be an integer`);
  return parsed;
}

export function parseVisibilityPolicy(value: unknown): VisibilityPolicy {
  const root = object(value, "visibilityPolicy");
  if (root.status !== "draft" && root.status !== "confirmed") throw new TypeError("visibilityPolicy.status must be draft or confirmed");
  if (!Array.isArray(root.products) || root.products.length === 0) throw new TypeError("visibilityPolicy.products must be a non-empty array");
  const products = root.products.map((raw, index) => {
    const path = `visibilityPolicy.products[${index}]`;
    const item = object(raw, path);
    const minimumVisiblePercent = positive(item.minimumVisiblePercent, `${path}.minimumVisiblePercent`);
    if (minimumVisiblePercent > 100) throw new TypeError(`${path}.minimumVisiblePercent must not exceed 100`);
    return {
      product: text(item.product, `${path}.product`),
      minimumVisiblePercent,
      minimumContinuousMs: positiveInteger(item.minimumContinuousMs, `${path}.minimumContinuousMs`),
      eligibilityEvent: text(item.eligibilityEvent, `${path}.eligibilityEvent`),
    };
  });
  if (new Set(products.map((item) => item.product)).size !== products.length) throw new TypeError("visibilityPolicy product names must be unique");
  return {
    schemaVersion: positiveInteger(root.schemaVersion, "visibilityPolicy.schemaVersion"),
    policyId: text(root.policyId, "visibilityPolicy.policyId"),
    profileId: text(root.profileId, "visibilityPolicy.profileId"),
    status: root.status,
    sampleIntervalMs: positiveInteger(root.sampleIntervalMs, "visibilityPolicy.sampleIntervalMs"),
    maximumSampleGapMs: positiveInteger(root.maximumSampleGapMs, "visibilityPolicy.maximumSampleGapMs"),
    cameInViewMinimumPercent: positive(root.cameInViewMinimumPercent, "visibilityPolicy.cameInViewMinimumPercent"),
    products,
  };
}

function loggerEvent(item: Evidence): string | null {
  return item.source === "browser_logger" && typeof item.data.canonicalEvent === "string" ? item.data.canonicalEvent : null;
}

function loggerTag(item: Evidence): string | null {
  const fields = item.data.fields;
  return typeof fields === "object" && fields !== null && !Array.isArray(fields) && typeof fields.tagName === "string" ? fields.tagName : null;
}

function timeline(samples: VisibilitySample[]): VisibilitySample[] {
  const best = new Map<number, VisibilitySample>();
  for (const sample of samples) {
    const previous = best.get(sample.atMs);
    if (previous === undefined || Number(sample.frameAccessible !== false) > Number(previous.frameAccessible !== false) || sample.visiblePercent > previous.visiblePercent) best.set(sample.atMs, sample);
  }
  return [...best.values()].sort((left, right) => left.atMs - right.atMs || left.evidenceId.localeCompare(right.evidenceId));
}

function exposure(samples: readonly VisibilitySample[], minimumPercent: number, maximumGapMs: number): { maximumContinuousMs: number; evidenceIds: string[]; intervals: JsonValue[] } {
  let start: VisibilitySample | null = null;
  let previous: VisibilitySample | null = null;
  let maximumContinuousMs = 0;
  let maximumIds: string[] = [];
  const intervals: JsonValue[] = [];
  const close = () => {
    if (start === null || previous === null) return;
    const durationMs = previous.atMs - start.atMs;
    intervals.push({ startMs: start.atMs, endMs: previous.atMs, durationMs, startEvidenceId: start.evidenceId, endEvidenceId: previous.evidenceId });
    if (durationMs > maximumContinuousMs || (durationMs === maximumContinuousMs && maximumIds.length === 0)) {
      maximumContinuousMs = durationMs;
      maximumIds = start.evidenceId === previous.evidenceId ? [start.evidenceId] : [start.evidenceId, previous.evidenceId];
    }
  };
  for (const sample of samples) {
    const qualifies = sample.visiblePercent >= minimumPercent;
    const continuous = previous !== null && sample.atMs - previous.atMs <= maximumGapMs;
    if (!qualifies) {
      close(); start = null; previous = null; continue;
    }
    if (start === null || !continuous) {
      close(); start = sample;
    }
    previous = sample;
  }
  close();
  return { maximumContinuousMs, evidenceIds: maximumIds, intervals };
}

function sampleForEvent(samples: readonly VisibilitySample[], event: Evidence, maximumGapMs: number): VisibilitySample | null {
  const networkId = typeof event.data.networkEvidenceId === "string" ? event.data.networkEvidenceId : null;
  const triggered = networkId === null ? undefined : samples.find((sample) => sample.triggerNetworkEvidenceId === networkId);
  if (triggered !== undefined) return triggered;
  const atMs = typeof event.data.requestStartedMs === "number" ? event.data.requestStartedMs : null;
  if (atMs === null) return null;
  return samples.filter((sample) => Math.abs(sample.atMs - atMs) <= maximumGapMs).sort((left, right) => Math.abs(left.atMs - atMs) - Math.abs(right.atMs - atMs))[0] ?? null;
}

function tc8Result(input: ViewabilityValidationInput, policy: VisibilityPolicy, samples: VisibilitySample[], events: Evidence[], unknown: string | null): CheckResult {
  const beginEvents = events.filter((item) => ["began_atf", "began_btf"].includes(loggerEvent(item) ?? ""));
  const cameEvents = events.filter((item) => loggerEvent(item) === "came_in_view");
  const exposureObserved = samples.some((sample) => sample.visiblePercent >= policy.cameInViewMinimumPercent);
  const failures: string[] = [];
  if (beginEvents.length !== 1) failures.push(`expected exactly one began_atf/began_btf event, observed ${beginEvents.length}`);
  if (beginEvents.length === 1) {
    const event = beginEvents[0]!;
    const sample = sampleForEvent(samples, event, policy.maximumSampleGapMs);
    // Tech Doc: Began ATF covers a player in the viewport or above it; Began BTF only a player below it.
    const expected = sample?.viewportState === "below_viewport" ? "began_btf" : sample?.viewportState === "in_view" || sample?.viewportState === "above_viewport" ? "began_atf" : null;
    if (expected === null) failures.push("viewport state at began event was not measurable");
    else if (loggerEvent(event) !== expected) failures.push(`reported ${loggerEvent(event)} while measured viewport state required ${expected}`);
  }
  if (exposureObserved && cameEvents.length === 0) failures.push("missing came_in_view after measured exposure");
  if (!exposureObserved && cameEvents.length > 0) failures.push("came_in_view reported without measured exposure");
  if (cameEvents.length > 1) failures.push(`expected at most one came_in_view event, observed ${cameEvents.length}`);
  const verdict: Verdict = failures.length > 0 && unknown === null ? "FAIL" : unknown !== null || !input.captureComplete ? "UNKNOWN" : "PASS";
  return {
    testCaseId: "TC-8",
    verdict,
    category: verdict === "PASS" ? "NONE" : verdict === "FAIL" ? "RUNTIME_BROWSER" : "TOOLING",
    scope: { deviceId: input.deviceId, articleEpochId: input.articleEpochId, tagName: input.tagName },
    expected: { exactlyOnePlacementEvent: true, cameInViewMinimumPercent: policy.cameInViewMinimumPercent, eventTimeViewportMeasurement: true },
    observed: {
      state: unknown,
      placementEvents: beginEvents.map((item) => ({ evidenceId: item.evidenceId, event: loggerEvent(item), requestStartedMs: item.data.requestStartedMs ?? null })),
      cameInViewEvents: cameEvents.map((item) => item.evidenceId),
      exposureObserved,
      samples: samples.map((sample) => ({ evidenceId: sample.evidenceId, sampledMs: sample.atMs, viewportState: sample.viewportState, visiblePercent: sample.visiblePercent })),
      failures,
    },
    evidenceIds: [...new Set([...samples.map((sample) => sample.evidenceId), ...beginEvents.map((item) => item.evidenceId), ...cameEvents.map((item) => item.evidenceId)])],
  };
}

export function validateViewability(input: ViewabilityValidationInput): ViewabilityValidation {
  const policy = parseVisibilityPolicy(input.policy);
  if (policy.profileId !== input.profileId) throw new TypeError("visibility policy profile does not match the selected profile");
  const scopedEvents = input.evidence.filter((item) => item.deviceId === input.deviceId && item.articleEpochId === input.articleEpochId && loggerTag(item) === input.tagName);
  const allSamples = readVisibilitySamples(input).samples.filter((sample) => sample.tagName === input.tagName);
  const samples = timeline(allSamples);
  const product = policy.products.find((item) => item.product === input.product);
  const expected = { policyId: policy.policyId, configVersion: policy.schemaVersion, state: policy.status, product: input.product, rule: product ?? null };
  const eligible = product === undefined ? false : scopedEvents.some((item) => loggerEvent(item) === product.eligibilityEvent);
  const reported = scopedEvents.some((item) => loggerEvent(item) === "viewable_impression");
  const unobservableFrame = samples.length > 0 && samples.every((sample) => sample.frameAccessible === false);
  const unknown = policy.status !== "confirmed" ? "visibility_policy_unconfirmed"
    : product === undefined ? "viewability_configuration_unknown"
      : samples.length === 0 ? "visibility_samples_unavailable"
        : unobservableFrame ? "frame_geometry_unobservable" : null;
  const tc8 = tc8Result(input, policy, samples, scopedEvents, unknown);
  if (product === undefined || unknown !== null) return {
    tc8, verdict: "UNKNOWN", category: "TOOLING", eligible, reported, sufficientExposure: null, expectedViewableEvent: null, expected,
    observed: { state: unknown, eligible, reported, samples: samples.map((sample) => ({ evidenceId: sample.evidenceId, sampledMs: sample.atMs, visiblePercent: sample.visiblePercent, blockers: sample.blockers })) },
    evidenceIds: [...new Set([...samples.map((sample) => sample.evidenceId), ...scopedEvents.map((item) => item.evidenceId)])],
  };
  const measured = exposure(samples, product.minimumVisiblePercent, policy.maximumSampleGapMs);
  const measurementGaps = samples.slice(1).flatMap((sample, index) => sample.atMs - samples[index]!.atMs > policy.maximumSampleGapMs
    ? [{ afterEvidenceId: samples[index]!.evidenceId, beforeEvidenceId: sample.evidenceId, gapMs: sample.atMs - samples[index]!.atMs }] : []);
  const observedSpanMs = samples.at(-1)!.atMs - samples[0]!.atMs;
  const enoughObservation = observedSpanMs >= product.minimumContinuousMs && measurementGaps.length === 0;
  const sufficientExposure = measured.maximumContinuousMs >= product.minimumContinuousMs ? true : enoughObservation ? false : null;
  const expectedViewableEvent = eligible ? sufficientExposure : false;
  const mismatch = expectedViewableEvent !== null && reported !== expectedViewableEvent;
  const verdict: Verdict = !input.captureComplete || expectedViewableEvent === null ? "UNKNOWN" : !eligible && !reported ? "NOT_APPLICABLE" : mismatch ? "FAIL" : "PASS";
  return {
    tc8,
    verdict,
    category: verdict === "PASS" || verdict === "NOT_APPLICABLE" ? "NONE" : verdict === "FAIL" ? "RUNTIME_BROWSER" : "TOOLING",
    eligible,
    reported,
    sufficientExposure,
    expectedViewableEvent,
    expected,
    observed: {
      eligible,
      eligibilityEvent: product.eligibilityEvent,
      reported,
      expectedViewableEvent,
      minimumVisiblePercent: product.minimumVisiblePercent,
      minimumContinuousMs: product.minimumContinuousMs,
      maximumContinuousMs: measured.maximumContinuousMs,
      observedSpanMs,
      measurementGaps,
      intervals: measured.intervals,
      activeView: "supplemental fields not present in the five-field logger contract",
    },
    evidenceIds: [...new Set([...measured.evidenceIds, ...scopedEvents.filter((item) => [product.eligibilityEvent, "viewable_impression"].includes(loggerEvent(item) ?? "")).map((item) => item.evidenceId)])],
  };
}

const rank: Record<Verdict, number> = { NOT_APPLICABLE: 0, PASS: 1, WARNING: 2, UNKNOWN: 3, FAIL: 4 };

function record(value: JsonValue): { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : { value };
}

function removeInapplicableViewableFailure(check: CheckResult, validation: ViewabilityValidation): CheckResult {
  const observed = record(check.observed);
  if (check.testCaseId === "TC-6") {
    const tc8Observed = record(validation.tc8.observed);
    const removable = new Set<string>();
    if (validation.expectedViewableEvent === false && !validation.reported) removable.add("viewable_impression");
    if (tc8Observed.state === null && tc8Observed.exposureObserved === false) removable.add("came_in_view");
    if (removable.size === 0) return check;
    const failures = Array.isArray(observed.failures) ? observed.failures.filter((item) => typeof item !== "string" || ![...removable].some((name) => item.endsWith(`missing ${name}`))) : [];
    const originallyOnlyRemovable = check.verdict === "FAIL" && Array.isArray(observed.failures) && observed.failures.length > 0 && failures.length === 0;
    const tags = Array.isArray(observed.tags) ? observed.tags.map((item) => {
      const tag = record(item);
      return { ...tag, missing: Array.isArray(tag.missing) ? tag.missing.filter((name) => typeof name !== "string" || !removable.has(name)) : tag.missing ?? [] };
    }) : [];
    return { ...check, verdict: originallyOnlyRemovable ? "PASS" : check.verdict, category: originallyOnlyRemovable ? "NONE" : check.category, observed: { ...observed, tags, failures } };
  }
  if (check.testCaseId === "TC-10") {
    if (validation.expectedViewableEvent !== false || validation.reported) return check;
    const firstFailure = record(observed.firstFailure ?? null);
    if (firstFailure.event === "viewable_impression" && firstFailure.cause === "event_not_observed") return { ...check, verdict: "PASS", category: "NONE", observed: { ...observed, firstFailure: null } };
  }
  return check;
}

function combine(check: CheckResult, verdict: Verdict, category: IssueCategory): CheckResult {
  if (verdict === "NOT_APPLICABLE" || rank[verdict] <= rank[check.verdict]) return check;
  return { ...check, verdict, category };
}

export function applyVisibilityContext(checks: readonly CheckResult[], validation: ViewabilityValidation): CheckResult[] {
  return checks.map((original) => {
    if (original.testCaseId !== "TC-6") return original;
    const check = removeInapplicableViewableFailure(original, validation);
    const combined = combine(check, validation.tc8.verdict, validation.tc8.category);
    return { ...combined, expected: { events: combined.expected, visibility: validation.tc8.expected }, observed: { ...record(combined.observed), visibility: validation.tc8.observed }, evidenceIds: [...new Set([...combined.evidenceIds, ...validation.tc8.evidenceIds])] };
  });
}

export function applyViewabilityContext(original: CheckResult, validation: ViewabilityValidation): CheckResult {
  const check = removeInapplicableViewableFailure(original, validation);
  const combined = combine(check, validation.verdict, validation.category);
  return { ...combined, expected: { chain: combined.expected, viewability: validation.expected }, observed: { ...record(combined.observed), viewability: validation.observed }, evidenceIds: [...new Set([...combined.evidenceIds, ...validation.evidenceIds])] };
}
