import { parseReport, VERDICTS, type CheckResult, type Evidence, type Report, type TestCaseId, type Verdict } from "../contracts.js";
import type { BrowserRunError } from "../browser/run.js";
import type { CoverageError, NormalizedEvidenceBundle } from "../evidence/normalize.js";

const ALL_CASES = Array.from({ length: 23 }, (_, index) => `TC-${index + 1}` as TestCaseId);

export interface IncompleteCheck {
  testCaseId: TestCaseId;
  reason: string;
}

export interface ReportCoverage {
  totalCases: 23;
  reportedCaseIds: TestCaseId[];
  evaluatedCaseIds: TestCaseId[];
  incompleteCaseIds: TestCaseId[];
  captureComplete: boolean;
  evidenceRecords: number;
  coverageErrors: CoverageError[];
}

export interface DeterministicReport extends Report {
  schemaVersion: 2;
  targetUrl: string;
  deviceId: string;
  verdictCounts: Record<Verdict, number>;
  coverage: ReportCoverage;
  incompleteChecks: IncompleteCheck[];
  executionErrors: BrowserRunError[];
  evidence: Evidence[];
}

export interface BuildReportInput {
  reportId: string;
  createdAt: string;
  bundle: NormalizedEvidenceBundle;
  checks: readonly CheckResult[];
  captureComplete: boolean;
  executionErrors: readonly BrowserRunError[];
}

function placeholder(bundle: NormalizedEvidenceBundle, testCaseId: TestCaseId): CheckResult {
  return {
    testCaseId,
    verdict: "UNKNOWN",
    category: "TOOLING",
    scope: { deviceId: bundle.run.deviceId, articleEpochId: null, tagName: null },
    expected: "case-specific validation",
    observed: "not implemented in the current milestone",
    evidenceIds: [],
  };
}

function overall(checks: readonly CheckResult[]): Verdict {
  for (const verdict of ["FAIL", "WARNING", "UNKNOWN", "PASS", "NOT_APPLICABLE"] as const) {
    if (checks.some((check) => check.verdict === verdict)) return verdict;
  }
  return "UNKNOWN";
}

function unknownReason(check: CheckResult): string {
  if (typeof check.observed === "string") return check.observed;
  if (check.observed !== null && !Array.isArray(check.observed) && typeof check.observed === "object") {
    const state = check.observed.state;
    if (typeof state === "string") return state;
  }
  return "required evidence or rule is unavailable";
}

export function buildReport(input: BuildReportInput): DeterministicReport {
  const duplicate = input.checks.find((check, index) => input.checks.findIndex((candidate) => candidate.testCaseId === check.testCaseId) !== index);
  if (duplicate !== undefined) throw new TypeError(`report has multiple results for ${duplicate.testCaseId}`);
  const evaluatedCaseIds = input.checks.map((check) => check.testCaseId).sort((left, right) => Number(left.slice(3)) - Number(right.slice(3)));
  const supplied = new Map(input.checks.map((check) => [check.testCaseId, check]));
  const checks = ALL_CASES.map((testCaseId) => supplied.get(testCaseId) ?? placeholder(input.bundle, testCaseId));
  const evidenceIds = input.bundle.evidence.map((item) => item.evidenceId);
  const knownEvidence = new Set(evidenceIds);
  for (const check of checks) {
    const missing = check.evidenceIds.filter((evidenceId) => !knownEvidence.has(evidenceId));
    if (missing.length > 0) throw new TypeError(`${check.testCaseId} references unknown evidence: ${missing.join(", ")}`);
    if (check.verdict === "FAIL" && check.evidenceIds.length === 0) {
      throw new TypeError(`${check.testCaseId} FAIL must reference evidence`);
    }
  }
  const verdictCounts = Object.fromEntries(VERDICTS.map((verdict) => [verdict, checks.filter((check) => check.verdict === verdict).length])) as Record<Verdict, number>;
  const incompleteChecks = checks.filter((check) => check.verdict === "UNKNOWN").map((check) => ({
    testCaseId: check.testCaseId,
    reason: unknownReason(check),
  }));
  const report: DeterministicReport = {
    schemaVersion: 2,
    reportId: input.reportId,
    runId: input.bundle.run.runId,
    profileId: input.bundle.run.profileId,
    targetUrl: input.bundle.run.targetUrl,
    deviceId: input.bundle.run.deviceId,
    createdAt: input.createdAt,
    executionState: input.bundle.run.executionState,
    overallVerdict: overall(checks),
    checks,
    evidenceIds,
    verdictCounts,
    coverage: {
      totalCases: 23,
      reportedCaseIds: ALL_CASES,
      evaluatedCaseIds,
      incompleteCaseIds: incompleteChecks.map((item) => item.testCaseId),
      captureComplete: input.captureComplete,
      evidenceRecords: input.bundle.evidence.length,
      coverageErrors: input.bundle.coverageErrors,
    },
    incompleteChecks,
    executionErrors: [...input.executionErrors],
    evidence: input.bundle.evidence,
  };
  parseReport(report);
  return report;
}
