import type { CheckResult, Evidence, JsonValue } from "../contracts.js";
import { parseRuntimePolicy, type RuntimePolicy } from "./blocked.js";

export interface DependencyValidationInput {
  evidence: readonly Evidence[];
  policy: RuntimePolicy;
  profileId: string;
  product: string;
  deviceId: string;
  articleEpochId: string;
  tagName: string;
  captureComplete: boolean;
}

function url(item: Evidence): URL | null {
  if (item.source !== "browser_network" || item.data.kind !== "request" || typeof item.data.url !== "string") return null;
  try { return new URL(item.data.url); } catch { return null; }
}

function outcome(item: Evidence): string {
  return typeof item.data.outcome === "string" ? item.data.outcome : "incomplete";
}

export function validateDependencies(input: DependencyValidationInput): CheckResult {
  const policy = parseRuntimePolicy(input.policy);
  if (policy.profileId !== input.profileId) throw new TypeError("runtime policy profile does not match the selected profile");
  const scoped = input.evidence.filter((item) => item.deviceId === input.deviceId && item.articleEpochId === input.articleEpochId);
  const requests = scoped.map((item) => ({ item, parsed: url(item) })).filter((value): value is { item: Evidence; parsed: URL } => value.parsed !== null);
  const configured = policy.dependencies.filter((item) => item.products.includes(input.product));
  const observations = configured.map((dependency) => {
    const matched = requests.filter(({ parsed }) => dependency.pathSuffixes.some((suffix) => parsed.pathname.endsWith(suffix))).map(({ item }) => item);
    const failed = matched.find((item) => outcome(item) !== "http_success");
    const success = matched.some((item) => outcome(item) === "http_success");
    const state = failed !== undefined ? "failed" : success ? "loaded" : input.captureComplete ? "missing" : "unknown";
    const cause = failed === undefined ? state === "missing" ? "no_matching_request" : state === "unknown" ? "capture_incomplete" : null
      : outcome(failed) === "http_failure" ? "http_status" : outcome(failed) === "transport_failure" ? "transport_failure" : "request_incomplete";
    const suggestedOwner = cause === "no_matching_request" ? "integration_or_product_configuration" : cause === null ? null : "runtime_or_network";
    return {
      id: dependency.id,
      required: dependency.required,
      state,
      cause,
      suggestedOwner,
      // A request failure is transport evidence only; it cannot identify an ad blocker.
      adBlockerDetected: false,
      evidenceIds: matched.map((item) => item.evidenceId),
      attempts: matched.map((item) => ({ evidenceId: item.evidenceId, outcome: outcome(item), status: typeof item.data.status === "number" ? item.data.status : null })) as JsonValue,
    };
  });
  const required = observations.filter((item) => item.required);
  const failures = required.filter((item) => item.state === "failed" || item.state === "missing");
  const unknown = required.filter((item) => item.state === "unknown");
  const verdict = policy.status !== "confirmed" || unknown.length > 0 ? "UNKNOWN" : failures.length > 0 ? "FAIL" : "PASS";
  const category = verdict === "PASS" ? "NONE" : verdict === "UNKNOWN" ? "TOOLING"
    : failures.some((item) => item.cause === "no_matching_request") ? "CONFIGURATION" : "RUNTIME_BROWSER";
  return {
    testCaseId: "TC-12",
    verdict,
    category,
    scope: { deviceId: input.deviceId, articleEpochId: input.articleEpochId, tagName: input.tagName },
    expected: { policyId: policy.policyId, state: policy.status, product: input.product, dependencies: configured.map(({ id, required, pathSuffixes }) => ({ id, required, pathSuffixes })) },
    observed: { dependencies: observations, failedRequired: failures.map((item) => item.id), unknownRequired: unknown.map((item) => item.id), inference: "request failures do not prove ad-blocker use" },
    evidenceIds: [...new Set([
      ...observations.flatMap((item) => item.evidenceIds),
      ...(failures.some((item) => item.state === "missing") ? scoped.map((item) => item.evidenceId) : []),
    ])],
  };
}
