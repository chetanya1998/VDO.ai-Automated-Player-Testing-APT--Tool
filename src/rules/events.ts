import type { CheckResult, Evidence, JsonValue, Verdict } from "../contracts.js";

type Flow = "served" | "no_ad" | "unknown";

export interface EventRulePolicy {
  schemaVersion: number;
  policyId: string;
  profileId: string;
  status: "draft" | "confirmed";
  flow: {
    expected: "auto" | "served" | "no_ad";
    servedIndicators: string[];
    noAdIndicators: string[];
    interruptEvents: string[];
  };
  required: {
    common: string[];
    commonAnyOf: string[][];
    served: string[];
    noAd: string[];
    replay: "optional" | "required" | "not_applicable";
  };
  order: {
    common: Array<[string, string]>;
    served: Array<[string, string]>;
    noAd: Array<[string, string]>;
  };
  pageview: {
    perTag: number;
    websiteMinimum: number;
    websiteMaximum: number;
    loadedPerTag: number;
  };
  adRequest: {
    state: "enabled" | "disabled";
    event: string;
    eligibilityAllOf: string[];
    eligibilityAnyOf: string[];
  };
}

export interface EventValidationInput {
  evidence: readonly Evidence[];
  policy: EventRulePolicy;
  deviceId: string;
  articleEpochId: string;
  activeTags: readonly string[];
  captureComplete: boolean;
}

interface EventObservation {
  evidenceId: string;
  rawEvent: string | null;
  canonicalEvent: string | null;
  tagName: string | null;
  startedMs: number | null;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a non-empty string`);
  return value;
}

function strings(value: unknown, path: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new TypeError(`${path} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  return value.map((item, index) => text(item, `${path}[${index}]`));
}

function integer(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new TypeError(`${path} must be a non-negative integer`);
  return Number(value);
}

function pairs(value: unknown, path: string): Array<[string, string]> {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value.map((item, index) => {
    if (!Array.isArray(item) || item.length !== 2) throw new TypeError(`${path}[${index}] must contain two events`);
    return [text(item[0], `${path}[${index}][0]`), text(item[1], `${path}[${index}][1]`)];
  });
}

export function parseEventRulePolicy(value: unknown): EventRulePolicy {
  const root = record(value, "eventRules");
  if (!Number.isInteger(root.schemaVersion) || Number(root.schemaVersion) < 1) throw new TypeError("eventRules.schemaVersion must be a positive integer");
  text(root.policyId, "eventRules.policyId");
  text(root.profileId, "eventRules.profileId");
  if (root.status !== "draft" && root.status !== "confirmed") throw new TypeError("eventRules.status is unsupported");
  const flow = record(root.flow, "eventRules.flow");
  if (!(["auto", "served", "no_ad"] as unknown[]).includes(flow.expected)) throw new TypeError("eventRules.flow.expected is unsupported");
  strings(flow.servedIndicators, "eventRules.flow.servedIndicators");
  strings(flow.noAdIndicators, "eventRules.flow.noAdIndicators");
  strings(flow.interruptEvents, "eventRules.flow.interruptEvents", true);
  const required = record(root.required, "eventRules.required");
  strings(required.common, "eventRules.required.common");
  strings(required.served, "eventRules.required.served");
  strings(required.noAd, "eventRules.required.noAd");
  if (!(["optional", "required", "not_applicable"] as unknown[]).includes(required.replay)) throw new TypeError("eventRules.required.replay is unsupported");
  if (!Array.isArray(required.commonAnyOf)) throw new TypeError("eventRules.required.commonAnyOf must be an array");
  required.commonAnyOf.forEach((item, index) => strings(item, `eventRules.required.commonAnyOf[${index}]`));
  const order = record(root.order, "eventRules.order");
  pairs(order.common, "eventRules.order.common");
  pairs(order.served, "eventRules.order.served");
  pairs(order.noAd, "eventRules.order.noAd");
  const pageview = record(root.pageview, "eventRules.pageview");
  const perTag = integer(pageview.perTag, "eventRules.pageview.perTag");
  const websiteMinimum = integer(pageview.websiteMinimum, "eventRules.pageview.websiteMinimum");
  const websiteMaximum = integer(pageview.websiteMaximum, "eventRules.pageview.websiteMaximum");
  if (websiteMaximum < websiteMinimum) throw new TypeError("eventRules.pageview.websiteMaximum must be >= websiteMinimum");
  const loadedPerTag = integer(pageview.loadedPerTag, "eventRules.pageview.loadedPerTag");
  if (perTag !== 1 || loadedPerTag !== 1 || websiteMinimum !== 0 || websiteMaximum !== 1) {
    throw new TypeError("eventRules.pageview must require loaded=1, pageview=1, and website pageview 0-1");
  }
  const adRequest = record(root.adRequest, "eventRules.adRequest");
  if (adRequest.state !== "enabled" && adRequest.state !== "disabled") throw new TypeError("eventRules.adRequest.state is unsupported");
  text(adRequest.event, "eventRules.adRequest.event");
  strings(adRequest.eligibilityAllOf, "eventRules.adRequest.eligibilityAllOf", true);
  strings(adRequest.eligibilityAnyOf, "eventRules.adRequest.eligibilityAnyOf", true);
  return value as EventRulePolicy;
}

function jsonText(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function jsonNumber(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function loggerEvents(input: EventValidationInput): EventObservation[] {
  return input.evidence
    .filter((item) => item.deviceId === input.deviceId && item.articleEpochId === input.articleEpochId && item.source === "browser_logger" && item.data.kind === "logger_request")
    .map((item) => {
      const fields = item.data.fields !== null && !Array.isArray(item.data.fields) && typeof item.data.fields === "object"
        ? item.data.fields as { [key: string]: JsonValue } : {};
      return {
        evidenceId: item.evidenceId,
        rawEvent: jsonText(item.data.rawEvent) ?? jsonText(fields.event),
        canonicalEvent: jsonText(item.data.canonicalEvent),
        tagName: jsonText(fields.tagName),
        startedMs: jsonNumber(item.data.requestStartedMs),
      };
    })
    .sort((left, right) => (left.startedMs ?? Number.MAX_SAFE_INTEGER) - (right.startedMs ?? Number.MAX_SAFE_INTEGER)
      || left.evidenceId.localeCompare(right.evidenceId));
}

function count(events: readonly EventObservation[], name: string): number {
  return events.filter((event) => event.canonicalEvent === name).length;
}

function flowFor(events: readonly EventObservation[], policy: EventRulePolicy): Flow {
  if (policy.flow.expected !== "auto") return policy.flow.expected;
  if (policy.flow.servedIndicators.some((name) => count(events, name) > 0)) return "served";
  return policy.flow.noAdIndicators.every((name) => count(events, name) > 0) ? "no_ad" : "unknown";
}

function orderingFailures(events: readonly EventObservation[], edges: ReadonlyArray<readonly [string, string]>): string[] {
  const failures: string[] = [];
  for (const [before, after] of edges) {
    // shortcut: five-field payloads have no cycle ID, so each dependent requires any prior prerequisite.
    let seenBefore = false;
    for (const event of events) {
      if (event.canonicalEvent === before) seenBefore = true;
      if (event.canonicalEvent === after && !seenBefore) failures.push(`${after} occurred before ${before}`);
    }
  }
  return [...new Set(failures)];
}

function interruption(events: readonly EventObservation[], policy: EventRulePolicy): EventObservation[] {
  return events.filter((event) => event.canonicalEvent !== null && policy.flow.interruptEvents.includes(event.canonicalEvent));
}

function uncertain(input: EventValidationInput, events: readonly EventObservation[], interrupted: readonly EventObservation[]): boolean {
  return input.policy.status !== "confirmed" || !input.captureComplete || interrupted.length > 0
    || !input.evidence.some((item) => item.deviceId === input.deviceId && item.articleEpochId === input.articleEpochId)
    || events.some((event) => event.canonicalEvent === null);
}

function category(verdict: Verdict): CheckResult["category"] {
  return verdict === "PASS" || verdict === "NOT_APPLICABLE" ? "NONE" : verdict === "FAIL" ? "RUNTIME_BROWSER" : "TOOLING";
}

function result(input: EventValidationInput, testCaseId: "TC-5" | "TC-6" | "TC-7" | "TC-9" | "TC-22", verdict: Verdict, expected: JsonValue, observed: JsonValue, evidenceIds: string[]): CheckResult {
  return {
    testCaseId,
    verdict,
    category: category(verdict),
    scope: { deviceId: input.deviceId, articleEpochId: input.articleEpochId, tagName: input.activeTags.length === 1 ? input.activeTags[0]! : null },
    expected,
    observed,
    evidenceIds: [...new Set(evidenceIds)],
  };
}

function verdictForMissing(input: EventValidationInput, events: readonly EventObservation[], interrupted: readonly EventObservation[], failures: readonly string[]): Verdict {
  if (failures.length === 0) return uncertain(input, events, interrupted) ? "UNKNOWN" : "PASS";
  if (failures.some((failure) => failure.includes("occurred before") || failure.includes("observed more than"))) return "FAIL";
  return uncertain(input, events, interrupted) ? "UNKNOWN" : "FAIL";
}

function normalizedPrerequisites(events: readonly EventObservation[], policy: EventRulePolicy): { [key: string]: JsonValue } {
  const has = (name: string) => count(events, name) > 0;
  return {
    loaded: has("loaded"),
    initialized: has("init_vdo"),
    autoplaySignal: has("auto_plays") || has("forceplay"),
    visible: has("came_in_view"),
    adRequest: has(policy.adRequest.event),
    adMatch: has("ad_match"),
    videoLoaded: has("video_loaded"),
    videoStarted: has("video_start"),
    viewableImpression: has("viewable_impression"),
    interrupted: interruption(events, policy).map((event) => ({ evidenceId: event.evidenceId, event: event.canonicalEvent })),
  };
}

function eventSummary(events: readonly EventObservation[]): JsonValue[] {
  return events.map((event) => ({
    evidenceId: event.evidenceId,
    rawEvent: event.rawEvent,
    canonicalEvent: event.canonicalEvent,
    tagName: event.tagName,
    startedMs: event.startedMs,
  }));
}

export function validateEvents(input: EventValidationInput): CheckResult[] {
  const policy = parseEventRulePolicy(input.policy);
  if (input.activeTags.length === 0 || input.activeTags.some((tag) => tag.trim() === "") || new Set(input.activeTags).size !== input.activeTags.length) throw new TypeError("activeTags must contain distinct tag names");
  const capturedEvents = loggerEvents(input);
  const activeEvents = capturedEvents.filter((event) => event.tagName !== null && input.activeTags.includes(event.tagName));
  const semanticEvents = capturedEvents.filter((event) => event.tagName === null || input.activeTags.includes(event.tagName));
  const scopedEvidenceIds = input.evidence
    .filter((item) => item.deviceId === input.deviceId && item.articleEpochId === input.articleEpochId)
    .map((item) => item.evidenceId);
  const perTag = input.activeTags.map((tagName) => {
    const events = activeEvents.filter((event) => event.tagName === tagName);
    const flow = flowFor(events, policy);
    const interrupted = interruption(events, policy);
    const required = [
      ...policy.required.common,
      ...(flow === "served" ? policy.required.served : flow === "no_ad" ? policy.required.noAd : []),
      ...(policy.required.replay === "required" ? ["replay"] : []),
    ];
    const missing = required.filter((name) => count(events, name) === 0);
    const missingAnyOf = policy.required.commonAnyOf.filter((group) => !group.some((name) => count(events, name) > 0));
    const edges = [...policy.order.common, ...(flow === "served" ? policy.order.served : flow === "no_ad" ? policy.order.noAd : [])];
    const orderFailures = orderingFailures(events, edges);
    return {
      tagName,
      events,
      flow,
      interrupted,
      required,
      missing,
      missingAnyOf,
      orderFailures,
      prerequisites: normalizedPrerequisites(events, policy),
    };
  });

  const lifecycleFailures = perTag.flatMap((tag) => [
    ...tag.missing.map((name) => `${tag.tagName}: missing ${name}`),
    ...tag.missingAnyOf.map((group) => `${tag.tagName}: missing one of ${group.join("/")}`),
    ...tag.orderFailures.map((failure) => `${tag.tagName}: ${failure}`),
  ]);
  const interrupted = perTag.flatMap((tag) => tag.interrupted);
  const lifecycleVerdict = perTag.some((tag) => tag.orderFailures.length > 0) ? "FAIL"
    : perTag.some((tag) => tag.flow === "unknown") ? "UNKNOWN"
    : verdictForMissing(input, semanticEvents, interrupted, lifecycleFailures);
  const individualFailures = perTag.flatMap((tag) => [
    ...tag.missing.map((name) => `${tag.tagName}: missing ${name}`),
    ...tag.missingAnyOf.map((group) => `${tag.tagName}: missing one of ${group.join("/")}`),
  ]);
  const individualVerdict = verdictForMissing(input, semanticEvents, interrupted, individualFailures);
  const lifecycleObserved = {
    tags: perTag.map((tag) => ({ tagName: tag.tagName, flow: tag.flow, missing: tag.missing, missingAnyOf: tag.missingAnyOf, orderFailures: tag.orderFailures, prerequisites: tag.prerequisites, events: eventSummary(tag.events) })),
    failures: lifecycleFailures,
  };

  const pageviewCounts = perTag.map((tag) => ({ tagName: tag.tagName, count: count(tag.events, "pageview") }));
  const websitePageviews = count(activeEvents, "website_pageview");
  const pageviewFailures = [
    ...pageviewCounts.filter((item) => item.count !== policy.pageview.perTag).map((item) => `${item.tagName}: expected ${policy.pageview.perTag} pageview, observed ${item.count}`),
    ...(websitePageviews < policy.pageview.websiteMinimum || websitePageviews > policy.pageview.websiteMaximum
      ? [`website pageview expected ${policy.pageview.websiteMinimum}-${policy.pageview.websiteMaximum}, observed ${websitePageviews}`] : []),
  ];
  const provenPageviewFailure = pageviewCounts.some((item) => item.count > policy.pageview.perTag) || websitePageviews > policy.pageview.websiteMaximum;
  const pageviewVerdict = pageviewFailures.length === 0
    ? uncertain(input, semanticEvents, interrupted) ? "UNKNOWN" : "PASS"
    : provenPageviewFailure ? "FAIL" : uncertain(input, semanticEvents, interrupted) ? "UNKNOWN" : "FAIL";

  const lifecycleCounts = perTag.map((tag) => ({
    tagName: tag.tagName,
    loaded: count(tag.events, "loaded"),
    pageview: count(tag.events, "pageview"),
  }));
  const countFailures = lifecycleCounts.flatMap((item) => [
    ...(item.loaded === policy.pageview.loadedPerTag ? [] : [`${item.tagName}: expected ${policy.pageview.loadedPerTag} loaded, observed ${item.loaded}`]),
    ...(item.pageview === policy.pageview.perTag ? [] : [`${item.tagName}: expected ${policy.pageview.perTag} pageview, observed ${item.pageview}`]),
  ]);
  const provenCountFailure = lifecycleCounts.some((item) => item.loaded > policy.pageview.loadedPerTag || item.pageview > policy.pageview.perTag);
  const countVerdict = countFailures.length === 0
    ? uncertain(input, semanticEvents, interrupted) ? "UNKNOWN" : "PASS"
    : provenCountFailure ? "FAIL" : uncertain(input, semanticEvents, interrupted) ? "UNKNOWN" : "FAIL";

  const eligibility = perTag.map((tag) => {
    const allOf = policy.adRequest.eligibilityAllOf.every((name) => count(tag.events, name) > 0);
    const anyOf = policy.adRequest.eligibilityAnyOf.length === 0 || policy.adRequest.eligibilityAnyOf.some((name) => count(tag.events, name) > 0);
    return { tagName: tag.tagName, eligible: allOf && anyOf, prerequisites: tag.prerequisites, requestCount: count(tag.events, policy.adRequest.event) };
  });
  const eligible = eligibility.filter((item) => item.eligible);
  const missingRequests = eligible.filter((item) => item.requestCount === 0);
  const adVerdict: Verdict = policy.adRequest.state === "disabled" ? "NOT_APPLICABLE"
    : eligible.length === 0 ? uncertain(input, semanticEvents, interrupted) ? "UNKNOWN" : "NOT_APPLICABLE"
    : missingRequests.length > 0 ? uncertain(input, semanticEvents, interrupted) ? "UNKNOWN" : "FAIL"
    : uncertain(input, semanticEvents, interrupted) ? "UNKNOWN" : "PASS";

  return [
    result(input, "TC-5", lifecycleVerdict, { common: policy.required.common, served: policy.required.served, noAd: policy.required.noAd, order: policy.order }, lifecycleObserved, scopedEvidenceIds),
    result(input, "TC-6", individualVerdict, { requiredByFlow: policy.required }, { ...lifecycleObserved, failures: individualFailures }, scopedEvidenceIds),
    result(input, "TC-7", pageviewVerdict, policy.pageview, { perTag: pageviewCounts, websitePageviews, failures: pageviewFailures, events: eventSummary(activeEvents) }, scopedEvidenceIds),
    result(input, "TC-9", adVerdict, { state: policy.adRequest.state, event: policy.adRequest.event, eligibilityAllOf: policy.adRequest.eligibilityAllOf, eligibilityAnyOf: policy.adRequest.eligibilityAnyOf }, { tags: eligibility, missingRequests: missingRequests.map((item) => item.tagName) }, scopedEvidenceIds),
    result(input, "TC-22", countVerdict, { loadedPerTag: policy.pageview.loadedPerTag, pageviewPerTag: policy.pageview.perTag }, { perTag: lifecycleCounts, failures: countFailures, events: eventSummary(activeEvents) }, scopedEvidenceIds),
  ];
}
