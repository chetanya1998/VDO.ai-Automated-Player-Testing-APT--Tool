import type { CheckResult, Evidence, JsonValue, Verdict } from "../contracts.js";

export interface LoggerPresenceInput {
  evidence: readonly Evidence[];
  deviceId: string;
  articleEpochId: string;
  tagName: string;
  loaderUrl: string;
  captureComplete: boolean;
}

interface RequestObservation {
  [key: string]: JsonValue;
  evidenceId: string;
  url: string | null;
  status: number | null;
  outcome: string | null;
}

function text(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function number(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function result(input: LoggerPresenceInput, verdict: Verdict, observed: JsonValue, evidenceIds: string[]): CheckResult {
  return {
    testCaseId: "TC-4",
    verdict,
    category: verdict === "PASS" ? "NONE" : verdict === "FAIL" ? "RUNTIME_BROWSER" : "TOOLING",
    scope: { deviceId: input.deviceId, articleEpochId: input.articleEpochId, tagName: input.tagName },
    expected: {
      condition: "at least one captured browser logger request after successful loader execution",
      status: 200,
    },
    observed,
    evidenceIds: [...new Set(evidenceIds)],
  };
}

export function validateLoggerPresence(input: LoggerPresenceInput): CheckResult {
  const scoped = input.evidence.filter((item) => item.deviceId === input.deviceId && item.articleEpochId === input.articleEpochId);
  const network = new Map(scoped.flatMap((item): Array<[string, RequestObservation]> => {
    if (item.source !== "browser_network" || item.data.kind !== "request") return [];
    return [[item.evidenceId, {
      evidenceId: item.evidenceId,
      url: text(item.data.url),
      status: number(item.data.status),
      outcome: text(item.data.outcome),
    }]];
  }));
  const loaderUrl = canonicalUrl(input.loaderUrl);
  if (loaderUrl === null) throw new TypeError("loaderUrl must be a valid URL");
  const loaders = [...network.values()].filter((item) => item.url !== null && canonicalUrl(item.url) === loaderUrl);
  const eligibleLoaders = loaders.filter((item) => item.status === 200 && item.outcome === "http_success");
  const logger = scoped.flatMap((item) => {
    if (item.source !== "browser_logger" || item.data.kind !== "logger_request") return [];
    const networkEvidenceId = text(item.data.networkEvidenceId);
    const request = networkEvidenceId === null ? undefined : network.get(networkEvidenceId);
    return [{
      evidenceId: item.evidenceId,
      networkEvidenceId,
      url: text(item.data.url),
      status: request?.status ?? null,
      outcome: request?.outcome ?? null,
    }];
  });
  const evidenceIds = logger.flatMap((item) => [item.evidenceId, ...(item.networkEvidenceId === null ? [] : [item.networkEvidenceId])]);
  const failed = logger.filter((item) => (item.status !== null && item.status !== 200)
    || item.outcome === "http_failure" || item.outcome === "transport_failure");
  const successful = logger.filter((item) => item.status === 200 && item.outcome === "http_success");

  if (failed.length > 0) return result(input, "FAIL", {
    state: "non_200_or_incomplete",
    requests: logger,
  }, evidenceIds);
  if (logger.length > 0 && successful.length === logger.length && input.captureComplete) return result(input, "PASS", {
    state: "present_http_200",
    requests: logger,
  }, evidenceIds);
  if (!input.captureComplete) return result(input, "UNKNOWN", {
    state: "capture_incomplete",
    requests: logger,
  }, [...evidenceIds, ...loaders.map((item) => item.evidenceId)]);
  if (logger.length > 0) return result(input, "UNKNOWN", {
    state: "logger_response_unavailable",
    requests: logger,
  }, evidenceIds);
  if (eligibleLoaders.length === 0) return result(input, "UNKNOWN", {
    state: "execution_not_eligible",
    loaderRequests: loaders,
    loggerRequestCount: 0,
  }, loaders.map((item) => item.evidenceId));
  return result(input, "FAIL", {
    state: "absent_after_eligible_execution",
    loaderRequests: eligibleLoaders,
    loggerRequestCount: 0,
  }, eligibleLoaders.map((item) => item.evidenceId));
}
