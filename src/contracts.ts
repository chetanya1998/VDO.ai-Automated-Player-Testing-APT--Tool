export const VERDICTS = [
  "PASS",
  "FAIL",
  "WARNING",
  "UNKNOWN",
  "NOT_APPLICABLE",
] as const;

export const EXECUTION_STATES = [
  "queued",
  "running",
  "completed",
  "timed_out",
  "errored",
] as const;

export const ISSUE_CATEGORIES = [
  "NONE",
  "IMPLEMENTATION",
  "RUNTIME_BROWSER",
  "INVESTIGATE_DEMAND",
  "CONFIGURATION",
  "TOOLING",
] as const;

export const EVIDENCE_SOURCES = [
  "browser_network",
  "browser_logger",
  "browser_dom",
  "browser_console",
  "screenshot",
  "backend_logger",
] as const;

export type Verdict = (typeof VERDICTS)[number];
export type ExecutionState = (typeof EXECUTION_STATES)[number];
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];
export type TestCaseId = `TC-${number}`;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface CapabilityStatus {
  state: "available" | "unavailable";
  reason?: string;
}

export interface Capabilities {
  browserCollector: CapabilityStatus;
  backendLogger: CapabilityStatus;
  aiExplanation: CapabilityStatus;
}

export interface Run {
  schemaVersion: number;
  runId: string;
  profileId: string;
  targetUrl: string;
  deviceId: string;
  createdAt: string;
  executionState: ExecutionState;
  capabilities: Capabilities;
}

export interface Profile {
  schemaVersion: number;
  profileId: string;
  profileStatus: "fixture_only" | "production";
  site: {
    approvedUrls: string[];
    approvedResourceOrigins?: string[];
    [key: string]: unknown;
  };
  devices: Array<{
    id: string;
    state: "enabled" | "disabled" | "unknown";
    [key: string]: unknown;
  }>;
  logger: {
    backendCorrelation: {
      state: "enabled" | "disabled" | "unknown";
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ArticleEpoch {
  schemaVersion: number;
  articleEpochId: string;
  runId: string;
  sequence: number;
  url: string;
  startedAt: string;
  endedAt?: string;
}

export interface Evidence {
  schemaVersion: number;
  evidenceId: string;
  runId: string;
  articleEpochId: string;
  deviceId: string;
  source: EvidenceSource;
  capturedAt: string;
  data: { [key: string]: JsonValue };
}

export interface CheckScope {
  deviceId: string;
  articleEpochId: string | null;
  tagName: string | null;
}

export interface CheckResult {
  testCaseId: TestCaseId;
  verdict: Verdict;
  category: IssueCategory;
  scope: CheckScope;
  expected: JsonValue;
  observed: JsonValue;
  evidenceIds: string[];
}

export interface Report {
  schemaVersion: number;
  reportId: string;
  runId: string;
  profileId: string;
  createdAt: string;
  executionState: ExecutionState;
  overallVerdict: Verdict;
  checks: CheckResult[];
  evidenceIds: string[];
}

const FEATURE_STATES = ["enabled", "disabled", "unknown"] as const;
const PROFILE_STATES = ["fixture_only", "production"] as const;
const CAPABILITY_STATES = ["available", "unavailable"] as const;

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new TypeError(`${path} must be an integer >= ${minimum}`);
  }
  return value as number;
}

function enumeration<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new TypeError(`${path} must be one of: ${allowed.join(", ")}`);
  }
  return value as T[number];
}

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array`);
  }
  return value.map((item, index) => string(item, `${path}[${index}]`));
}

function httpUrl(value: unknown, path: string): string {
  const input = string(value, path);
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new TypeError(`${path} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new TypeError(`${path} must be an HTTP(S) URL without credentials`);
  }
  return input;
}

function instant(value: unknown, path: string): string {
  const input = string(value, path);
  if (Number.isNaN(Date.parse(input))) {
    throw new TypeError(`${path} must be an ISO-compatible timestamp`);
  }
  return input;
}

function jsonValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${path}[${index}]`));
  if (typeof value === "object") {
    const object = record(value, path);
    return Object.fromEntries(
      Object.entries(object).map(([key, item]) => [key, jsonValue(item, `${path}.${key}`)]),
    );
  }
  throw new TypeError(`${path} must be a JSON value`);
}

function jsonObject(value: unknown, path: string): { [key: string]: JsonValue } {
  const result = jsonValue(value, path);
  if (result === null || Array.isArray(result) || typeof result !== "object") {
    throw new TypeError(`${path} must be a JSON object`);
  }
  return result;
}

function capability(value: unknown, path: string): CapabilityStatus {
  const object = record(value, path);
  const state = enumeration(object.state, CAPABILITY_STATES, `${path}.state`);
  if (state === "unavailable") {
    string(object.reason, `${path}.reason`);
  } else if (object.reason !== undefined) {
    string(object.reason, `${path}.reason`);
  }
  return value as CapabilityStatus;
}

function testCaseId(value: unknown, path: string): TestCaseId {
  const input = string(value, path);
  const match = /^TC-(\d+)$/.exec(input);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 23) {
    throw new TypeError(`${path} must be TC-1 through TC-23`);
  }
  return input as TestCaseId;
}

export function parseProfile(value: unknown): Profile {
  const object = record(value, "profile");
  integer(object.schemaVersion, "profile.schemaVersion", 1);
  string(object.profileId, "profile.profileId");
  enumeration(object.profileStatus, PROFILE_STATES, "profile.profileStatus");

  const site = record(object.site, "profile.site");
  const approvedUrls = site.approvedUrls;
  if (!Array.isArray(approvedUrls) || approvedUrls.length === 0) {
    throw new TypeError("profile.site.approvedUrls must contain at least one URL");
  }
  approvedUrls.forEach((url, index) => httpUrl(url, `profile.site.approvedUrls[${index}]`));
  if (site.approvedResourceOrigins !== undefined) {
    if (!Array.isArray(site.approvedResourceOrigins)) throw new TypeError("profile.site.approvedResourceOrigins must be an array");
    site.approvedResourceOrigins.forEach((url, index) => {
      const parsed = new URL(httpUrl(url, `profile.site.approvedResourceOrigins[${index}]`));
      if (parsed.href !== parsed.origin + "/") throw new TypeError(`profile.site.approvedResourceOrigins[${index}] must be an origin`);
    });
  }

  if (!Array.isArray(object.devices) || object.devices.length === 0) {
    throw new TypeError("profile.devices must contain at least one device");
  }
  object.devices.forEach((device, index) => {
    const item = record(device, `profile.devices[${index}]`);
    string(item.id, `profile.devices[${index}].id`);
    enumeration(item.state, FEATURE_STATES, `profile.devices[${index}].state`);
  });

  const logger = record(object.logger, "profile.logger");
  const backend = record(logger.backendCorrelation, "profile.logger.backendCorrelation");
  enumeration(backend.state, FEATURE_STATES, "profile.logger.backendCorrelation.state");

  // shortcut: validate only shared boundary fields until a task consumes deeper profile sections.
  return value as Profile;
}

export function parseRun(value: unknown): Run {
  const object = record(value, "run");
  integer(object.schemaVersion, "run.schemaVersion", 1);
  string(object.runId, "run.runId");
  string(object.profileId, "run.profileId");
  httpUrl(object.targetUrl, "run.targetUrl");
  string(object.deviceId, "run.deviceId");
  instant(object.createdAt, "run.createdAt");
  enumeration(object.executionState, EXECUTION_STATES, "run.executionState");
  const capabilities = record(object.capabilities, "run.capabilities");
  capability(capabilities.browserCollector, "run.capabilities.browserCollector");
  capability(capabilities.backendLogger, "run.capabilities.backendLogger");
  capability(capabilities.aiExplanation, "run.capabilities.aiExplanation");
  return value as Run;
}

export function parseArticleEpoch(value: unknown): ArticleEpoch {
  const object = record(value, "articleEpoch");
  integer(object.schemaVersion, "articleEpoch.schemaVersion", 1);
  string(object.articleEpochId, "articleEpoch.articleEpochId");
  string(object.runId, "articleEpoch.runId");
  integer(object.sequence, "articleEpoch.sequence", 0);
  httpUrl(object.url, "articleEpoch.url");
  instant(object.startedAt, "articleEpoch.startedAt");
  if (object.endedAt !== undefined) instant(object.endedAt, "articleEpoch.endedAt");
  return value as ArticleEpoch;
}

export function parseEvidence(value: unknown): Evidence {
  const object = record(value, "evidence");
  integer(object.schemaVersion, "evidence.schemaVersion", 1);
  string(object.evidenceId, "evidence.evidenceId");
  string(object.runId, "evidence.runId");
  string(object.articleEpochId, "evidence.articleEpochId");
  string(object.deviceId, "evidence.deviceId");
  enumeration(object.source, EVIDENCE_SOURCES, "evidence.source");
  instant(object.capturedAt, "evidence.capturedAt");
  jsonObject(object.data, "evidence.data");
  return value as Evidence;
}

export function parseCheckResult(value: unknown, path = "check"): CheckResult {
  const object = record(value, path);
  testCaseId(object.testCaseId, `${path}.testCaseId`);
  enumeration(object.verdict, VERDICTS, `${path}.verdict`);
  enumeration(object.category, ISSUE_CATEGORIES, `${path}.category`);
  const scope = record(object.scope, `${path}.scope`);
  string(scope.deviceId, `${path}.scope.deviceId`);
  if (scope.articleEpochId !== null) string(scope.articleEpochId, `${path}.scope.articleEpochId`);
  if (scope.tagName !== null) string(scope.tagName, `${path}.scope.tagName`);
  jsonValue(object.expected, `${path}.expected`);
  jsonValue(object.observed, `${path}.observed`);
  strings(object.evidenceIds, `${path}.evidenceIds`);
  return value as CheckResult;
}

export function parseReport(value: unknown): Report {
  const object = record(value, "report");
  integer(object.schemaVersion, "report.schemaVersion", 1);
  string(object.reportId, "report.reportId");
  string(object.runId, "report.runId");
  string(object.profileId, "report.profileId");
  instant(object.createdAt, "report.createdAt");
  const executionState = enumeration(object.executionState, EXECUTION_STATES, "report.executionState");
  const overallVerdict = enumeration(object.overallVerdict, VERDICTS, "report.overallVerdict");
  if (!Array.isArray(object.checks)) throw new TypeError("report.checks must be an array");
  const checks = object.checks.map((check, index) => parseCheckResult(check, `report.checks[${index}]`));
  strings(object.evidenceIds, "report.evidenceIds");

  if (overallVerdict === "PASS") {
    const hasPass = checks.some((check) => check.verdict === "PASS");
    const hasBlockingResult = checks.some((check) => !["PASS", "NOT_APPLICABLE"].includes(check.verdict));
    if (executionState !== "completed" || !hasPass || hasBlockingResult) {
      throw new TypeError("a PASS report must be completed and contain passed checks with no blocking verdicts");
    }
  }
  return value as Report;
}

export function createQueuedRun(input: {
  runId: string;
  profileId: string;
  targetUrl: string;
  deviceId: string;
  createdAt: string;
}): Run {
  return parseRun({
    schemaVersion: 1,
    ...input,
    executionState: "queued",
    capabilities: {
      browserCollector: { state: "available" },
      backendLogger: { state: "unavailable", reason: "optional backend verification is not enabled for this run" },
      aiExplanation: { state: "unavailable", reason: "optional explanation is scheduled for task 19" },
    },
  });
}
