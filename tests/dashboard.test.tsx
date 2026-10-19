import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RunDetail } from "../web/src/RunDetail.js";
import { checkGroups, timelineRows } from "../web/src/model.js";
import type { CheckResult, EvidenceItem, ReportEnvelope, RunSummary } from "../web/src/types.js";

const checks: CheckResult[] = [
  { testCaseId: "TC-1", verdict: "FAIL", category: "IMPLEMENTATION", scope: { deviceId: "desktop", articleEpochId: "article-1", tagName: "v-site" }, expected: "one loader", observed: "loader missing", evidenceIds: ["ev-loader"] },
  { testCaseId: "TC-10", verdict: "WARNING", category: "INVESTIGATE_DEMAND", scope: { deviceId: "desktop", articleEpochId: "article-1", tagName: "v-site" }, expected: "demand response", observed: "no fill", evidenceIds: ["ev-demand"] },
  { testCaseId: "TC-16", verdict: "UNKNOWN", category: "TOOLING", scope: { deviceId: "ios", articleEpochId: null, tagName: null }, expected: "real iOS evidence", observed: "hardware evidence unavailable", evidenceIds: [] },
];

const evidence: EvidenceItem[] = [
  { evidenceId: "ev-demand", articleEpochId: "article-1", deviceId: "desktop", source: "backend_logger", capturedAt: "2026-10-16T10:00:01.000Z", metadata: { event: "Ad Request", durationMs: 640, status: 204 } },
  { evidenceId: "ev-loader", articleEpochId: "article-1", deviceId: "desktop", source: "browser_network", capturedAt: "2026-10-16T10:00:00.000Z", metadata: { kind: "vdo.ai.js", durationMs: 501, errorCode: "ERR_BLOCKED" } },
];

test("dashboard model preserves verdict distinctions and time order without claiming backend correlation", () => {
  const groups = checkGroups(checks);
  assert.deepEqual(groups.failed.map((check) => check.testCaseId), ["TC-1"]);
  assert.deepEqual(groups.demand.map((check) => check.testCaseId), ["TC-10"]);
  assert.deepEqual(groups.unknown.map((check) => check.testCaseId), ["TC-16"]);

  const timeline = timelineRows(evidence);
  assert.deepEqual(timeline.map((item) => item.evidenceId), ["ev-loader", "ev-demand"]);
  assert.equal(timeline[0]?.elapsedMs, 0);
  assert.equal(timeline[1]?.elapsedMs, 1_000);
  assert.equal(timeline[1]?.correlation, "Unconfirmed backend join");
  assert.equal(timeline[0]?.code, "ERR_BLOCKED");
});

test("run detail renders failure, unknown, demand, performance, evidence, and accessible timeline controls", () => {
  const run: RunSummary = {
    runId: "run-dashboard",
    targetUrl: "http://127.0.0.1:3000/article",
    deviceId: "desktop",
    executionState: "completed",
    createdAt: "2026-10-16T10:00:00.000Z",
    deadlineAt: "2026-10-16T10:05:00.000Z",
    startedAt: "2026-10-16T10:00:00.000Z",
    endedAt: "2026-10-16T10:00:02.000Z",
    progress: { stage: "complete" },
    partialReport: null,
  };
  const envelope: ReportEnvelope = {
    runId: run.runId,
    executionState: "completed",
    report: { reportId: "report-dashboard", overallVerdict: "FAIL", checks },
    evidence,
    findings: [{ findingId: "cause-loader", kind: "diagnosis", category: "IMPLEMENTATION", verdict: "FAIL", evidenceIds: ["ev-loader"], payload: { cause: "loader missing" } }],
    artifacts: [{ artifactId: "artifact-har", kind: "sanitized_har", byteSize: 2048, sha256: `sha256:${"c".repeat(64)}` }],
  };
  const html = renderToStaticMarkup(<RunDetail run={run} envelope={envelope} pollingPaused={false} onRefresh={() => undefined} onArtifact={async () => undefined} />);
  assert.match(html, />Issues</);
  assert.match(html, />Investigate demand</);
  assert.match(html, />Unknown</);
  assert.match(html, /Script time/);
  assert.match(html, /Slowest logger calls/);
  assert.match(html, /ERR_BLOCKED/);
  assert.match(html, /order does not prove causality across sources/);
  assert.match(html, /aria-label="Run health summary"/);
  assert.match(html, /href="#evidence-ev-loader"/);
  assert.match(html, /<select/);
  assert.match(html, /<button[^>]*>Refresh<\/button>/);
});
