import type { JsonValue } from "../contracts.js";
import type { TeamReportExportSource } from "../store.js";

const SENSITIVE_KEYS = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|apikey|jwt|session|sessionid)$/i;
const VERSION_KEYS = /(?:^|_)(?:schemaVersion|ruleVersion|policyVersion|version|policyId|mappingId|aliasStatus)$/i;

function redactText(value: string): string {
  return value
    .replace(/secret[\s_-]*sentinel/gi, "[REDACTED]")
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:access[_-]?token|api[_-]?key|authorization|password|secret|token|session|jwt)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/((?:access[_-]?token|api[_-]?key|authorization|cookie|password|secret|session|jwt)\s*[=:]\s*)[^&\s,;"']+/gi, "$1[REDACTED]");
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_KEYS.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    return redactText(url.href);
  } catch {
    return redactText(value);
  }
}

export function redactReportValue(value: unknown, key = ""): JsonValue {
  if (SENSITIVE_KEYS.test(key)) return "[REDACTED]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string") return /^https?:\/\//i.test(value) ? sanitizeUrl(value) : redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactReportValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([name, item]) => [name, redactReportValue(item, name)]));
  }
  return String(value);
}

function record(value: JsonValue): { [key: string]: JsonValue } | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value: JsonValue | undefined): string | null {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : null;
}

function findScalar(value: JsonValue, names: readonly string[]): string | null {
  const object = record(value);
  if (object === null) return null;
  for (const name of names) {
    const found = text(object[name]);
    if (found !== null) return found;
  }
  for (const child of Object.values(object)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findScalar(item, names);
        if (found !== null) return found;
      }
    } else if (record(child) !== null) {
      const found = findScalar(child, names);
      if (found !== null) return found;
    }
  }
  return null;
}

function collectVersions(value: JsonValue, path = "profile", output: Record<string, string> = {}): Record<string, string> {
  const object = record(value);
  if (object === null) return output;
  for (const [key, child] of Object.entries(object)) {
    const childPath = `${path}.${key}`;
    const scalar = text(child);
    if (scalar !== null && VERSION_KEYS.test(key)) output[childPath] = scalar;
    if (Array.isArray(child)) child.forEach((item, index) => collectVersions(item, `${childPath}[${index}]`, output));
    else if (record(child) !== null) collectVersions(child, childPath, output);
  }
  return output;
}

function selectDevice(snapshot: JsonValue, deviceId: string): JsonValue | null {
  const devices = record(snapshot)?.devices;
  if (!Array.isArray(devices)) return null;
  return devices.find((item) => record(item)?.id === deviceId) ?? null;
}

function eventName(metadata: { [key: string]: JsonValue }): string | null {
  return text(metadata.canonicalEvent) ?? text(metadata.rawEvent) ?? text(record(metadata.fields ?? null)?.event) ?? text(metadata.event);
}

function duration(metadata: { [key: string]: JsonValue }): number | null {
  return typeof metadata.durationMs === "number" && Number.isFinite(metadata.durationMs) ? metadata.durationMs : null;
}

function countVerdicts(checks: readonly JsonValue[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const check of checks) {
    const verdict = text(record(check)?.verdict) ?? "UNKNOWN";
    counts[verdict] = (counts[verdict] ?? 0) + 1;
  }
  return counts;
}

export interface TechnicalReportExport {
  schemaVersion: 1;
  exportedAt: string;
  run: JsonValue;
  profile: JsonValue;
  environment: JsonValue;
  summary: JsonValue;
  report: JsonValue;
  loggerSequence: JsonValue[];
  blockedAndErrorEvents: JsonValue[];
  timings: JsonValue;
  evidence: JsonValue[];
  findings: JsonValue[];
  artifacts: JsonValue[];
}

export function buildTechnicalReportExport(source: TeamReportExportSource, exportedAt = new Date().toISOString()): TechnicalReportExport {
  if (source.report.report === null) throw new TypeError("a final persisted report is required for export");
  const sanitized = redactReportValue(source) as unknown as TeamReportExportSource;
  const finalReport = sanitized.report.report;
  if (finalReport === null) throw new TypeError("redacted report unexpectedly missing");
  const profileSnapshot = sanitized.profile.snapshot;
  const device = selectDevice(profileSnapshot, sanitized.run.deviceId);
  const evidence = sanitized.report.evidence;
  const reportValue = finalReport as unknown as JsonValue;
  const checks = Array.isArray(finalReport.checks) ? finalReport.checks : [];
  const diagnoses = Array.isArray(finalReport.diagnoses) ? finalReport.diagnoses : [];
  const firstFailure = checks.find((item) => record(item)?.verdict === "FAIL") ?? null;
  const firstFailureCase = firstFailure === null ? null : text(record(firstFailure)?.testCaseId);
  const diagnosis = diagnoses.find((item) => {
    const symptom = record(record(item)?.primarySymptom ?? null);
    return firstFailureCase !== null && text(symptom?.testCaseId) === firstFailureCase;
  }) ?? diagnoses[0] ?? null;
  const diagnosisRecord = diagnosis === null ? null : record(diagnosis);
  const loggerSequence = evidence.filter((item) => item.source === "browser_logger")
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt) || left.evidenceId.localeCompare(right.evidenceId))
    .map((item, index) => ({
      index: index + 1,
      evidenceId: item.evidenceId,
      capturedAt: item.capturedAt,
      articleEpochId: item.articleEpochId,
      deviceId: item.deviceId,
      event: eventName(item.metadata) ?? "unrecorded",
      tagName: text(item.metadata.tagName) ?? text(record(item.metadata.fields ?? null)?.tagName),
      durationMs: duration(item.metadata),
    }));
  const blockedAndErrorEvents = evidence.filter((item) => {
    const value = JSON.stringify(item.metadata).toLowerCase();
    return value.includes("block") || value.includes("error") || value.includes("fail");
  }).map((item) => ({
    evidenceId: item.evidenceId,
    capturedAt: item.capturedAt,
    articleEpochId: item.articleEpochId,
    code: text(item.metadata.blockedCode) ?? text(item.metadata.errorCode) ?? text(item.metadata.code) ?? "unrecorded",
    metadata: item.metadata,
  }));
  const measured = evidence.filter((item) => duration(item.metadata) !== null).map((item) => ({
    evidenceId: item.evidenceId,
    capturedAt: item.capturedAt,
    source: item.source,
    label: eventName(item.metadata) ?? text(item.metadata.kind) ?? "request",
    durationMs: duration(item.metadata),
  }));
  const ruleVersions = collectVersions(profileSnapshot);
  collectVersions(reportValue, "report", ruleVersions);

  return {
    schemaVersion: 1,
    exportedAt,
    run: {
      runId: sanitized.run.runId,
      targetUrl: sanitized.run.targetUrl,
      deviceId: sanitized.run.deviceId,
      executionState: sanitized.run.executionState,
      createdAt: sanitized.run.createdAt,
      startedAt: sanitized.run.startedAt,
      endedAt: sanitized.run.endedAt,
    },
    profile: {
      profileId: sanitized.profile.profileId,
      profileVersion: sanitized.profile.profileVersion,
      profileHash: sanitized.profile.profileHash,
      ruleVersions,
    },
    environment: {
      deviceId: sanitized.run.deviceId,
      browser: device === null ? findScalar(reportValue, ["browser", "browserName"]) ?? "not_recorded" : findScalar(device, ["browser", "browserName"]) ?? "not_recorded",
      os: findScalar(reportValue, ["os", "operatingSystem", "platform"]) ?? (device === null ? null : findScalar(device, ["os", "operatingSystem", "platform"])) ?? "not_recorded",
    },
    summary: {
      overallVerdict: finalReport.overallVerdict ?? "UNKNOWN",
      checkCount: checks.length,
      verdictCounts: record(reportValue)?.verdictCounts ?? countVerdicts(checks),
      findingCount: sanitized.report.findings.length,
      firstFailure,
      suggestedOwner: text(diagnosisRecord?.suggestedOwner) ?? "not_recorded",
      suggestedFixes: Array.isArray(diagnosisRecord?.nextChecks) ? diagnosisRecord.nextChecks : [],
      limitations: finalReport.limitations ?? [],
    },
    report: reportValue,
    loggerSequence,
    blockedAndErrorEvents,
    timings: {
      scripts: measured.filter((item) => /script|vdo\.ai\.js/i.test(JSON.stringify(item))),
      logger: measured.filter((item) => item.source === "browser_logger" || /logger/i.test(String(item.label))),
    },
    evidence: evidence as unknown as JsonValue[],
    findings: sanitized.report.findings as unknown as JsonValue[],
    artifacts: sanitized.report.artifacts.map((item) => ({
      artifactId: item.artifactId,
      kind: item.kind,
      byteSize: item.byteSize,
      sha256: item.sha256,
    })),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function pretty(value: unknown): string {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function section(title: string, value: unknown): string {
  return `<section><h2>${escapeHtml(title)}</h2><pre>${pretty(value)}</pre></section>`;
}

export function renderTechnicalReportHtml(report: TechnicalReportExport): string {
  const run = record(report.run)!;
  const summary = record(report.summary)!;
  const title = `VDO.AI validation report ${text(run.runId) ?? ""}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
:root{color-scheme:light;--ink:#13231f;--muted:#52635e;--line:#d8e0dc;--paper:#fff;--wash:#f3f6f4;--accent:#164c3d}*{box-sizing:border-box}body{background:var(--wash);color:var(--ink);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;margin:0}main{margin:auto;max-width:1120px;padding:32px 20px 64px}header,section{background:var(--paper);border:1px solid var(--line);border-radius:8px;margin:0 0 16px;padding:22px}h1{font-size:clamp(24px,4vw,42px);letter-spacing:-.04em;margin:.25rem 0}h2{font-size:18px;margin:0 0 12px}.eyebrow{color:var(--muted);font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.facts{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-top:20px}.facts div{border-top:1px solid var(--line);padding-top:8px}.facts strong,.facts span{display:block}.facts span{color:var(--muted);font-size:12px}pre{background:var(--wash);border-radius:6px;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;margin:0;max-height:600px;overflow:auto;padding:14px;white-space:pre-wrap;word-break:break-word}@media print{body{background:#fff}main{max-width:none;padding:0}header,section{break-inside:avoid;border-color:#bbb}}
</style></head><body><main><header><p class="eyebrow">Offline technical export</p><h1>VDO.AI Player Validation</h1><p>${escapeHtml(text(run.targetUrl) ?? "Target URL not recorded")}</p><div class="facts"><div><span>Run</span><strong>${escapeHtml(text(run.runId) ?? "unrecorded")}</strong></div><div><span>Verdict</span><strong>${escapeHtml(text(summary.overallVerdict) ?? "UNKNOWN")}</strong></div><div><span>Checks</span><strong>${escapeHtml(text(summary.checkCount) ?? "0")}</strong></div><div><span>Exported</span><strong>${escapeHtml(report.exportedAt)}</strong></div></div></header>
${section("Run and environment", { run: report.run, environment: report.environment, profile: report.profile })}
${section("Summary and recommended fixes", report.summary)}
${section("TC-1 through TC-23 results", record(report.report)?.checks ?? [])}
${section("Observed logger sequence", report.loggerSequence)}
${section("Blocked and error events", report.blockedAndErrorEvents)}
${section("Script and logger timings", report.timings)}
${section("Findings and probable causes", report.findings)}
${section("Evidence timeline", report.evidence)}
${section("Sanitized artifact references", report.artifacts)}
</main></body></html>`;
}
