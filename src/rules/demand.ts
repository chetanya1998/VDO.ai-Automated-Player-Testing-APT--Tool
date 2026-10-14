import type { CheckResult, Evidence, JsonValue, Verdict } from "../contracts.js";
import { parseDemandResponse, type DemandFormat, type DemandParseLimits, type ParsedDemandState } from "../demand/parse.js";

export interface DemandPolicy {
  schemaVersion: number;
  policyId: string;
  profileId: string;
  status: "draft" | "confirmed";
  limits: DemandParseLimits & { maxWrappers: number };
  chain: string[];
  providers: Array<{ id: string; products: string[]; required: boolean; format: DemandFormat; pathContains: string[]; deadlineMs: number }>;
}

export interface DemandValidationInput {
  evidence: readonly Evidence[];
  policy: DemandPolicy;
  profileId: string;
  product: string;
  deviceId: string;
  articleEpochId: string;
  tagName: string;
  captureComplete: boolean;
}

export interface DemandObservation {
  providerId: string;
  required: boolean;
  evidenceId: string | null;
  state: ParsedDemandState | "missing" | "deadline_exceeded" | "wrapper_loop" | "wrapper_limit" | "wrapper_incomplete";
  transport: "pass" | "fail" | "unknown";
  cause: string | null;
  durationMs: number | null;
  deadlineMs: number;
  wrapperChain: string[];
  wrapperEvidenceIds: string[];
}

export interface DemandValidation {
  check: CheckResult;
  observations: DemandObservation[];
  requiredInitiated: boolean | null;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a non-empty string`);
  return value;
}

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${path} must be a non-empty array`);
  return value.map((item, index) => text(item, `${path}[${index}]`));
}

function positive(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new TypeError(`${path} must be a positive integer`);
  return Number(value);
}

export function parseDemandPolicy(value: unknown): DemandPolicy {
  const root = object(value, "demandPolicy");
  const schemaVersion = positive(root.schemaVersion, "demandPolicy.schemaVersion");
  const policyId = text(root.policyId, "demandPolicy.policyId");
  const profileId = text(root.profileId, "demandPolicy.profileId");
  if (root.status !== "draft" && root.status !== "confirmed") throw new TypeError("demandPolicy.status must be draft or confirmed");
  const limitsInput = object(root.limits, "demandPolicy.limits");
  const limits = {
    maxBodyBytes: positive(limitsInput.maxBodyBytes, "demandPolicy.limits.maxBodyBytes"),
    maxXmlDepth: positive(limitsInput.maxXmlDepth, "demandPolicy.limits.maxXmlDepth"),
    maxWrappers: positive(limitsInput.maxWrappers, "demandPolicy.limits.maxWrappers"),
    supportedVastVersions: strings(limitsInput.supportedVastVersions, "demandPolicy.limits.supportedVastVersions"),
  };
  const chain = strings(root.chain, "demandPolicy.chain");
  if (!Array.isArray(root.providers) || root.providers.length === 0) throw new TypeError("demandPolicy.providers must be a non-empty array");
  const formats: DemandFormat[] = ["vast_xml", "gam_json", "prebid_json", "reseller_json"];
  const providers = root.providers.map((value, index) => {
    const provider = object(value, `demandPolicy.providers[${index}]`);
    if (typeof provider.required !== "boolean") throw new TypeError(`demandPolicy.providers[${index}].required must be boolean`);
    if (!formats.includes(provider.format as DemandFormat)) throw new TypeError(`demandPolicy.providers[${index}].format is unsupported`);
    return {
      id: text(provider.id, `demandPolicy.providers[${index}].id`),
      products: strings(provider.products, `demandPolicy.providers[${index}].products`),
      required: provider.required,
      format: provider.format as DemandFormat,
      pathContains: strings(provider.pathContains, `demandPolicy.providers[${index}].pathContains`),
      deadlineMs: positive(provider.deadlineMs, `demandPolicy.providers[${index}].deadlineMs`),
    };
  });
  if (new Set(providers.map((provider) => provider.id)).size !== providers.length) throw new TypeError("demandPolicy provider ids must be unique");
  return { schemaVersion, policyId, profileId, status: root.status, limits, chain, providers };
}

function networkUrl(item: Evidence): URL | null {
  if (item.source !== "browser_network" || item.data.kind !== "request" || typeof item.data.url !== "string") return null;
  try { return new URL(item.data.url); } catch { return null; }
}

function started(item: Evidence): number {
  return typeof item.data.startedMs === "number" ? item.data.startedMs : Number.MAX_SAFE_INTEGER;
}

function loggerEvent(item: Evidence): string | null {
  return item.source === "browser_logger" && typeof item.data.canonicalEvent === "string" ? item.data.canonicalEvent : null;
}

function loggerTag(item: Evidence): string | null {
  const fields = item.data.fields;
  return typeof fields === "object" && fields !== null && !Array.isArray(fields) && typeof fields.tagName === "string" ? fields.tagName : null;
}

function resolveWrapper(root: Evidence, requests: readonly Evidence[], format: DemandFormat, limits: DemandPolicy["limits"]): { state: DemandObservation["state"]; cause: string | null; chain: string[]; evidenceIds: string[] } {
  let current = root;
  const chain: string[] = [];
  const evidenceIds: string[] = [];
  const seen = new Set<string>();
  for (let count = 0; count <= limits.maxWrappers; count += 1) {
    const currentUrl = typeof current.data.url === "string" ? current.data.url : current.evidenceId;
    if (seen.has(currentUrl)) return { state: "wrapper_loop", cause: "wrapper_loop", chain, evidenceIds };
    seen.add(currentUrl);
    chain.push(currentUrl);
    evidenceIds.push(current.evidenceId);
    const parsed = parseDemandResponse(current, format, limits);
    if (parsed.state !== "wrapper") return { state: parsed.state, cause: parsed.cause, chain, evidenceIds };
    if (count === limits.maxWrappers) return { state: "wrapper_limit", cause: "wrapper_limit", chain, evidenceIds };
    const next = requests.find((item) => item.data.url === parsed.wrapperUrl);
    if (next === undefined) return { state: "wrapper_incomplete", cause: "wrapper_target_not_captured", chain: [...chain, parsed.wrapperUrl!], evidenceIds };
    current = next;
  }
  return { state: "wrapper_limit", cause: "wrapper_limit", chain, evidenceIds };
}

function chainGap(events: readonly Evidence[], chain: readonly string[]): { event: string; after: string | null } | null {
  let cursor = -Infinity;
  let previous: string | null = null;
  for (const name of chain) {
    const found = events.find((item) => loggerEvent(item) === name && (typeof item.data.requestStartedMs === "number" ? item.data.requestStartedMs : Infinity) > cursor);
    if (found === undefined) return { event: name, after: previous };
    cursor = typeof found.data.requestStartedMs === "number" ? found.data.requestStartedMs : cursor;
    previous = name;
  }
  return null;
}

function badState(state: DemandObservation["state"]): boolean {
  return ["failed", "malformed", "deadline_exceeded", "missing", "wrapper_loop", "wrapper_limit"].includes(state);
}

function unknownState(state: DemandObservation["state"]): boolean {
  return ["unsupported", "truncated", "unknown", "wrapper_incomplete"].includes(state);
}

export function validateDemand(input: DemandValidationInput): DemandValidation {
  const policy = parseDemandPolicy(input.policy);
  if (policy.profileId !== input.profileId) throw new TypeError("demand policy profile does not match the selected profile");
  const scoped = input.evidence.filter((item) => item.deviceId === input.deviceId && item.articleEpochId === input.articleEpochId);
  const requests = scoped.filter((item) => networkUrl(item) !== null).sort((a, b) => started(a) - started(b) || a.evidenceId.localeCompare(b.evidenceId));
  const providers = policy.providers.filter((provider) => provider.products.includes(input.product));
  const observations = providers.flatMap((provider): DemandObservation[] => {
    const matched = requests.filter((item) => provider.pathContains.some((part) => networkUrl(item)!.pathname.includes(part)));
    if (matched.length === 0) return provider.required ? [{ providerId: provider.id, required: true, evidenceId: null, state: input.captureComplete ? "missing" : "unknown", transport: input.captureComplete ? "fail" : "unknown", cause: input.captureComplete ? "request_not_observed" : "capture_incomplete", durationMs: null, deadlineMs: provider.deadlineMs, wrapperChain: [], wrapperEvidenceIds: [] }] : [];
    return matched.map((item) => {
      const parsed = parseDemandResponse(item, provider.format, policy.limits);
      const durationMs = typeof item.data.durationMs === "number" ? item.data.durationMs : null;
      const wrapper = provider.format === "vast_xml" && parsed.state === "wrapper" ? resolveWrapper(item, requests, provider.format, policy.limits) : null;
      const state = durationMs !== null && durationMs > provider.deadlineMs ? "deadline_exceeded" : wrapper?.state ?? parsed.state;
      return { providerId: provider.id, required: provider.required, evidenceId: item.evidenceId, state, transport: state === "deadline_exceeded" ? "fail" : parsed.transport, cause: state === "deadline_exceeded" ? "deadline_exceeded" : wrapper?.cause ?? parsed.cause, durationMs, deadlineMs: provider.deadlineMs, wrapperChain: wrapper?.chain ?? [], wrapperEvidenceIds: wrapper?.evidenceIds ?? [] };
    });
  });
  const required = observations.filter((item) => item.required);
  const events = scoped.filter((item) => loggerTag(item) === input.tagName).sort((a, b) => Number(a.data.requestStartedMs ?? Number.MAX_SAFE_INTEGER) - Number(b.data.requestStartedMs ?? Number.MAX_SAFE_INTEGER));
  const hasAdRequest = events.some((item) => loggerEvent(item) === policy.chain[0]);
  const failure = required.find((item) => badState(item.state));
  const uncertain = required.find((item) => unknownState(item.state));
  const noDemand = required.length > 0 && required.every((item) => item.state === "no_fill" || item.state === "no_bid");
  const gap = chainGap(events, policy.chain);
  let verdict: Verdict;
  let category: CheckResult["category"];
  let firstFailure: JsonValue = null;
  if (policy.status !== "confirmed") {
    verdict = "UNKNOWN"; category = "TOOLING"; firstFailure = "demand_policy_unconfirmed";
  } else if (providers.filter((item) => item.required).length === 0) {
    verdict = "NOT_APPLICABLE"; category = "NONE";
  } else if (!hasAdRequest) {
    verdict = "UNKNOWN"; category = "TOOLING"; firstFailure = { event: policy.chain[0]!, cause: "ad_request_prerequisite_not_observed" };
  } else if (failure !== undefined) {
    verdict = "FAIL"; category = "RUNTIME_BROWSER"; firstFailure = { providerId: failure.providerId, state: failure.state, cause: failure.cause, evidenceId: failure.evidenceId };
  } else if (uncertain !== undefined) {
    verdict = "UNKNOWN"; category = "TOOLING"; firstFailure = { providerId: uncertain.providerId, state: uncertain.state, cause: uncertain.cause, evidenceId: uncertain.evidenceId };
  } else if (noDemand) {
    verdict = "WARNING"; category = "INVESTIGATE_DEMAND"; firstFailure = { event: "ad_match", after: "ad_request", cause: "no_fill_or_no_bid" };
  } else if (gap !== null) {
    verdict = gap.event === "ad_match" ? "WARNING" : "FAIL";
    category = gap.event === "ad_match" ? "INVESTIGATE_DEMAND" : "RUNTIME_BROWSER";
    firstFailure = { event: gap.event, after: gap.after, cause: "event_not_observed" };
  } else {
    verdict = "PASS"; category = "NONE";
  }
  const evidenceIds = [...new Set([...observations.flatMap((item) => [...(item.evidenceId === null ? [] : [item.evidenceId]), ...item.wrapperEvidenceIds]), ...events.map((item) => item.evidenceId)])];
  return {
    observations,
    requiredInitiated: providers.some((item) => item.required) ? required.some((item) => item.evidenceId !== null) : null,
    check: {
      testCaseId: "TC-10",
      verdict,
      category,
      scope: { deviceId: input.deviceId, articleEpochId: input.articleEpochId, tagName: input.tagName },
      expected: { policyId: policy.policyId, state: policy.status, chain: policy.chain, providers: providers.map(({ id, required, format, deadlineMs }) => ({ id, required, format, deadlineMs })) },
      observed: { providers: observations as unknown as JsonValue, firstFailure, wrapperPolicy: "captured responses only; no wrapper URL fetching" },
      evidenceIds,
    },
  };
}

export function applyDemandContext(checks: readonly CheckResult[], demand: DemandValidation): CheckResult[] {
  return checks.map((check) => {
    if (check.testCaseId !== "TC-9" || check.verdict === "NOT_APPLICABLE") return check;
    const observed = typeof check.observed === "object" && check.observed !== null && !Array.isArray(check.observed) ? check.observed : { value: check.observed };
    if (demand.requiredInitiated === false && demand.check.verdict === "FAIL") return {
      ...check,
      verdict: "FAIL",
      category: "RUNTIME_BROWSER",
      observed: { ...observed, demandInitiation: "required request not observed", demandEvidenceIds: demand.check.evidenceIds },
      evidenceIds: [...new Set([...check.evidenceIds, ...demand.check.evidenceIds])],
    };
    return { ...check, observed: { ...observed, demandInitiation: demand.requiredInitiated } };
  });
}
