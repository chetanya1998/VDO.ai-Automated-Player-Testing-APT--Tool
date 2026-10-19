export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type Verdict = "PASS" | "FAIL" | "WARNING" | "UNKNOWN" | "NOT_APPLICABLE";

export interface RunSummary {
  runId: string;
  targetUrl: string;
  deviceId: string;
  executionState: "queued" | "running" | "completed" | "timed_out" | "errored";
  createdAt: string;
  deadlineAt: string;
  startedAt: string | null;
  endedAt: string | null;
  progress: JsonValue;
  partialReport?: ReportSnapshot | null;
}

export interface CheckResult {
  testCaseId: string;
  verdict: Verdict;
  category: string;
  scope: { deviceId: string; articleEpochId: string | null; tagName: string | null };
  expected: JsonValue;
  observed: JsonValue;
  evidenceIds: string[];
}

export interface Diagnosis {
  causeId?: string;
  title?: string;
  category?: string;
  confidence?: string;
  suggestedOwner?: string;
  nextChecks?: string[];
  evidenceIds?: string[];
  [key: string]: unknown;
}

export interface ReportSnapshot {
  reportId: string;
  overallVerdict?: Verdict;
  checks?: CheckResult[];
  diagnoses?: Diagnosis[];
  coverage?: JsonValue;
  verdictCounts?: Partial<Record<Verdict, number>>;
  limitations?: string[];
}

export interface EvidenceItem {
  evidenceId: string;
  articleEpochId: string;
  deviceId: string;
  source: string;
  capturedAt: string;
  metadata: { [key: string]: JsonValue };
}

export interface Finding {
  findingId: string;
  kind: "check" | "diagnosis";
  category: string;
  verdict: string;
  evidenceIds: string[];
  payload: JsonValue;
}

export interface Artifact {
  artifactId: string;
  kind: string;
  byteSize: number;
  sha256: string;
}

export interface ReportEnvelope {
  runId: string;
  executionState: string;
  report: ReportSnapshot | null;
  evidence: EvidenceItem[];
  findings: Finding[];
  artifacts: Artifact[];
}

export interface BatchItem {
  itemIndex: number;
  targetUrl: string;
  deviceId: string;
  admissionState: "accepted" | "rejected";
  state: string;
  runId: string | null;
  deadlineAt: string | null;
  reportAvailable: boolean;
  reportedCaseIds: string[];
  error: { code: string; message: string } | null;
  runUrl: string | null;
  reportUrl: string | null;
}

export interface BatchDetail {
  batchId: string;
  createdAt: string;
  status: "in_progress" | "completed" | "completed_with_issues" | "rejected";
  counts: { total: number; accepted: number; rejected: number; terminal: number };
  completeness: {
    devices: Array<{ deviceId: string; acceptedRuns: number; terminalRuns: number; reportedCaseIds: string[] }>;
    cases: Array<{ testCaseId: string; reportedRuns: number; expectedRuns: number }>;
  };
  items: BatchItem[];
}

export interface TimelineRow extends EvidenceItem {
  elapsedMs: number;
  label: string;
  durationMs: number | null;
  code: string | null;
  tagName: string | null;
  correlation: string;
}
