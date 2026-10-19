import type { CheckResult, EvidenceItem, JsonValue, ReportEnvelope, TimelineRow, Verdict } from "./types.js";

const VERDICTS: Verdict[] = ["PASS", "FAIL", "WARNING", "UNKNOWN", "NOT_APPLICABLE"];

function scalar(value: JsonValue | undefined): string | null {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : null;
}

function number(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatJson(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function elapsedLabel(start: string, end: string | null, now = Date.now()): string {
  const startMs = Date.parse(start);
  const endMs = end === null ? now : Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "Unknown duration";
  const seconds = Math.max(0, Math.round((endMs - startMs) / 1_000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function verdictCounts(checks: readonly CheckResult[]): Record<Verdict, number> {
  return Object.fromEntries(VERDICTS.map((verdict) => [verdict, checks.filter((check) => check.verdict === verdict).length])) as Record<Verdict, number>;
}

export function timelineRows(evidence: readonly EvidenceItem[]): TimelineRow[] {
  const ordered = [...evidence].sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt) || left.evidenceId.localeCompare(right.evidenceId));
  const first = ordered[0] === undefined ? 0 : Date.parse(ordered[0].capturedAt);
  return ordered.map((item) => {
    const metadata = item.metadata;
    const event = scalar(metadata.event) ?? scalar(metadata.kind) ?? scalar(metadata.requestType);
    const code = scalar(metadata.errorCode) ?? scalar(metadata.blockedCode) ?? scalar(metadata.code) ?? scalar(metadata.status);
    const confidence = scalar(metadata.correlationConfidence);
    return {
      ...item,
      elapsedMs: Math.max(0, Date.parse(item.capturedAt) - first),
      label: event ?? item.source.replaceAll("_", " "),
      durationMs: number(metadata.durationMs),
      code,
      tagName: scalar(metadata.tagName),
      correlation: confidence ?? (item.source === "backend_logger" ? "Unconfirmed backend join" : "Local run scope"),
    };
  });
}

export function slowLoggerCalls(evidence: readonly EvidenceItem[]): TimelineRow[] {
  return timelineRows(evidence)
    .filter((item) => item.durationMs !== null && (item.source === "browser_logger" || item.label.toLowerCase().includes("logger")))
    .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))
    .slice(0, 5);
}

export function checksFrom(envelope: ReportEnvelope | null, partial: unknown): CheckResult[] {
  if (envelope?.report?.checks !== undefined) return envelope.report.checks;
  if (partial !== null && typeof partial === "object" && !Array.isArray(partial)) {
    const checks = (partial as { checks?: unknown }).checks;
    if (Array.isArray(checks)) return checks as CheckResult[];
  }
  return [];
}

export function checkGroups(checks: readonly CheckResult[]): {
  failed: CheckResult[];
  demand: CheckResult[];
  warnings: CheckResult[];
  unknown: CheckResult[];
} {
  return {
    failed: checks.filter((check) => check.verdict === "FAIL" && check.category !== "INVESTIGATE_DEMAND"),
    demand: checks.filter((check) => check.category === "INVESTIGATE_DEMAND"),
    warnings: checks.filter((check) => check.verdict === "WARNING" && check.category !== "INVESTIGATE_DEMAND"),
    unknown: checks.filter((check) => check.verdict === "UNKNOWN"),
  };
}
