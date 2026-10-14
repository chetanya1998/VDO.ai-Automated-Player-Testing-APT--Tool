import type { CheckResult, Evidence, JsonValue, Verdict } from "../contracts.js";

export interface TimingPolicy {
  schemaVersion: number;
  policyId: string;
  status: "synthetic_draft" | "confirmed";
  script: {
    passMaxMs: number;
    warningMaxMs: number;
  };
  logger: {
    warningAboveMs: number;
    failureAboveMs: null;
    eventGapThresholdMs: null;
  };
}

export interface TimingValidationInput {
  evidence: readonly Evidence[];
  policy: TimingPolicy;
  loaderUrl: string;
  deviceId: string;
  articleEpochId: string;
  tagName: string;
  captureContext: {
    coldCache: "new_context" | "unknown";
    networkConditions: string;
  };
}

interface RequestTiming {
  evidenceId: string;
  url: string | null;
  startedMs: number | null;
  durationMs: number | null;
  outcome: string | null;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function positiveNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new TypeError(`${path} must be a positive number`);
  return value;
}

export function parseTimingPolicy(value: unknown): TimingPolicy {
  const root = object(value, "timingPolicy");
  if (!Number.isInteger(root.schemaVersion) || Number(root.schemaVersion) < 1) throw new TypeError("timingPolicy.schemaVersion must be a positive integer");
  if (typeof root.policyId !== "string" || root.policyId.trim() === "") throw new TypeError("timingPolicy.policyId must be a non-empty string");
  if (root.status !== "synthetic_draft" && root.status !== "confirmed") throw new TypeError("timingPolicy.status is unsupported");
  const script = object(root.script, "timingPolicy.script");
  const passMaxMs = positiveNumber(script.passMaxMs, "timingPolicy.script.passMaxMs");
  const warningMaxMs = positiveNumber(script.warningMaxMs, "timingPolicy.script.warningMaxMs");
  if (warningMaxMs <= passMaxMs) throw new TypeError("timingPolicy.script.warningMaxMs must be greater than passMaxMs");
  const logger = object(root.logger, "timingPolicy.logger");
  positiveNumber(logger.warningAboveMs, "timingPolicy.logger.warningAboveMs");
  if (logger.failureAboveMs !== null) throw new TypeError("timingPolicy.logger.failureAboveMs must remain null until policy is confirmed");
  if (logger.eventGapThresholdMs !== null) throw new TypeError("timingPolicy.logger.eventGapThresholdMs must remain null until policy is confirmed");
  return value as TimingPolicy;
}

function text(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function canonicalLoaderUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return /\/core\/[^/]+\/vdo\.ai\.js$/i.test(url.pathname) ? `${url.origin}${url.pathname}` : null;
  } catch {
    return null;
  }
}

function category(verdict: Verdict): CheckResult["category"] {
  if (verdict === "PASS") return "NONE";
  if (verdict === "UNKNOWN") return "TOOLING";
  return "RUNTIME_BROWSER";
}

function result(input: TimingValidationInput, testCaseId: "TC-2" | "TC-15", verdict: Verdict, expected: JsonValue, observed: JsonValue, evidenceIds: string[]): CheckResult {
  return {
    testCaseId,
    verdict,
    category: category(verdict),
    scope: { deviceId: input.deviceId, articleEpochId: input.articleEpochId, tagName: input.tagName },
    expected,
    observed,
    evidenceIds: [...new Set(evidenceIds)],
  };
}

function scopedEvidence(input: TimingValidationInput): readonly Evidence[] {
  return input.evidence.filter((item) => item.deviceId === input.deviceId && item.articleEpochId === input.articleEpochId);
}

function networkTimings(input: TimingValidationInput): Map<string, RequestTiming> {
  return new Map(scopedEvidence(input).flatMap((item): Array<[string, RequestTiming]> => {
    if (item.source !== "browser_network" || item.data.kind !== "request") return [];
    return [[item.evidenceId, {
      evidenceId: item.evidenceId,
      url: text(item.data.url),
      startedMs: number(item.data.startedMs),
      durationMs: number(item.data.durationMs),
      outcome: text(item.data.outcome),
    }]];
  }));
}

function scriptVerdict(timing: RequestTiming, policy: TimingPolicy): Verdict {
  if (timing.outcome === "incomplete") return "FAIL";
  if (timing.durationMs === null) return "UNKNOWN";
  if (timing.durationMs <= policy.script.passMaxMs) return "PASS";
  return timing.durationMs <= policy.script.warningMaxMs ? "WARNING" : "FAIL";
}

function worst(verdicts: readonly Verdict[]): Verdict {
  const rank: Record<Verdict, number> = { FAIL: 5, WARNING: 4, UNKNOWN: 3, PASS: 2, NOT_APPLICABLE: 1 };
  return verdicts.reduce((left, right) => rank[right] > rank[left] ? right : left, "NOT_APPLICABLE");
}

function validateScript(input: TimingValidationInput, policy: TimingPolicy, network: Map<string, RequestTiming>): CheckResult {
  const expectedUrl = canonicalLoaderUrl(input.loaderUrl);
  if (expectedUrl === null) throw new TypeError("loaderUrl must be a VDO core loader URL");
  const requests = [...network.values()].filter((item) => item.url !== null && canonicalLoaderUrl(item.url) === expectedUrl);
  const measuredVerdict = requests.length === 0 ? "UNKNOWN" : worst(requests.map((item) => scriptVerdict(item, policy)));
  const verdict = input.captureContext.coldCache === "new_context" ? measuredVerdict : "UNKNOWN";
  return result(input, "TC-2", verdict, {
    coldCache: "new_context",
    requestDurationMs: {
      passAtOrBelow: policy.script.passMaxMs,
      warningAtOrBelow: policy.script.warningMaxMs,
      failAbove: policy.script.warningMaxMs,
    },
    timeout: "FAIL",
    policyStatus: policy.status,
  }, {
    captureContext: input.captureContext,
    requests: requests.map((item) => ({ ...item, verdict: scriptVerdict(item, policy) })),
  }, requests.map((item) => item.evidenceId));
}

function loggerDurationVerdict(durationMs: number | null, outcome: string | null, warningAboveMs: number): Verdict {
  if (outcome === "incomplete") return "WARNING";
  if (durationMs === null) return "UNKNOWN";
  return durationMs > warningAboveMs ? "WARNING" : "PASS";
}

function validateLogger(input: TimingValidationInput, policy: TimingPolicy, network: Map<string, RequestTiming>): CheckResult {
  const logger = scopedEvidence(input)
    .filter((item) => item.source === "browser_logger" && item.data.kind === "logger_request")
    .map((item) => {
      const networkEvidenceId = text(item.data.networkEvidenceId);
      const timing = networkEvidenceId === null ? undefined : network.get(networkEvidenceId);
      const fields = typeof item.data.fields === "object" && item.data.fields !== null && !Array.isArray(item.data.fields)
        ? item.data.fields : {};
      return {
        evidenceId: item.evidenceId,
        networkEvidenceId,
        event: text(item.data.rawEvent) ?? text(fields.event),
        startedMs: number(item.data.requestStartedMs) ?? timing?.startedMs ?? null,
        durationMs: number(item.data.requestDurationMs) ?? timing?.durationMs ?? null,
        outcome: text(item.data.requestOutcome) ?? timing?.outcome ?? null,
      };
    })
    .sort((left, right) => (left.startedMs ?? Number.MAX_SAFE_INTEGER) - (right.startedMs ?? Number.MAX_SAFE_INTEGER)
      || left.evidenceId.localeCompare(right.evidenceId));

  const observations = logger.map((item, index) => {
    const previous = index === 0 ? undefined : logger[index - 1];
    const eventGapMs = item.startedMs === null || previous?.startedMs == null ? null : Math.max(0, item.startedMs - previous.startedMs);
    return {
      evidenceId: item.evidenceId,
      networkEvidenceId: item.networkEvidenceId,
      event: item.event,
      startedMs: item.startedMs,
      requestDurationMs: item.durationMs,
      requestOutcome: item.outcome,
      durationVerdict: loggerDurationVerdict(item.durationMs, item.outcome, policy.logger.warningAboveMs),
      eventGapMs,
    };
  });
  const verdict = observations.length === 0 ? "UNKNOWN" : worst(observations.map((item) => item.durationVerdict));
  return result(input, "TC-15", verdict, {
    requestDurationMs: {
      passAtOrBelow: policy.logger.warningAboveMs,
      warningAbove: policy.logger.warningAboveMs,
      failureAbove: policy.logger.failureAboveMs,
    },
    eventGapThresholdMs: policy.logger.eventGapThresholdMs,
    policyStatus: policy.status,
  }, {
    captureContext: input.captureContext,
    requests: observations,
    slowRequestCount: observations.filter((item) => item.durationVerdict === "WARNING").length,
    eventGapAssessment: "unconfigured",
  }, logger.flatMap((item) => [item.evidenceId, ...(item.networkEvidenceId === null ? [] : [item.networkEvidenceId])]));
}

export function validateTiming(input: TimingValidationInput): CheckResult[] {
  const policy = parseTimingPolicy(input.policy);
  const network = networkTimings(input);
  return [validateScript(input, policy, network), validateLogger(input, policy, network)];
}
