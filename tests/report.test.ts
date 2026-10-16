import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createQueuedRun, parseRun, type CheckResult, type Evidence } from "../src/contracts.js";
import type { NormalizedEvidenceBundle } from "../src/evidence/normalize.js";
import { parseRcaPolicy } from "../src/rca/diagnose.js";
import { buildReport } from "../src/report/build.js";

test("report includes all 23 cases and keeps execution errors separate", () => {
  const queued = createQueuedRun({
    runId: "run-report",
    profileId: "production-profile",
    targetUrl: "https://publisher.example/article",
    deviceId: "desktop-chromium",
    createdAt: "2026-10-14T00:00:00.000Z",
  });
  const run = parseRun({ ...queued, executionState: "timed_out" });
  const bundle: NormalizedEvidenceBundle = {
    run,
    profileSnapshot: {
      profileId: "production-profile",
      profileSchemaVersion: 1,
      profileHash: "sha256:recorded",
      profile: {} as never,
    },
    evidence: [],
    loggerTimelineEvidenceIds: [],
    coverageErrors: [],
  };
  const tc4: CheckResult = {
    testCaseId: "TC-4",
    verdict: "UNKNOWN",
    category: "TOOLING",
    scope: { deviceId: run.deviceId, articleEpochId: "article-1", tagName: "v-approved" },
    expected: "captured logger request",
    observed: { state: "capture_incomplete" },
    evidenceIds: [],
  };
  const report = buildReport({
    reportId: "report-1",
    createdAt: "2026-10-14T00:01:00.000Z",
    bundle,
    checks: [tc4],
    captureComplete: false,
    executionErrors: [{ stage: "navigation", name: "TimeoutError", message: "deadline exceeded" }],
  });

  assert.equal(report.checks.length, 23);
  assert.deepEqual(report.coverage.evaluatedCaseIds, ["TC-4"]);
  assert.equal(report.verdictCounts.UNKNOWN, 23);
  assert.equal(report.executionErrors.length, 1);
  assert.equal(report.checks.some((check) => check.verdict === "FAIL"), false);
});

test("report embeds evidence-backed RCA diagnoses", async () => {
  const queued = createQueuedRun({
    runId: "run-rca-report",
    profileId: "production-profile",
    targetUrl: "https://publisher.example/article",
    deviceId: "desktop-chromium",
    createdAt: "2026-10-16T00:00:00.000Z",
  });
  const run = parseRun({ ...queued, executionState: "completed" });
  const item: Evidence = {
    schemaVersion: 1,
    evidenceId: "ev-layout",
    runId: run.runId,
    articleEpochId: "article-1",
    deviceId: run.deviceId,
    source: "browser_dom",
    capturedAt: "2026-10-16T00:00:01.000Z",
    data: { kind: "visibility_sample", covered: true },
  };
  const bundle: NormalizedEvidenceBundle = {
    run,
    profileSnapshot: { profileId: run.profileId, profileSchemaVersion: 1, profileHash: "sha256:recorded", profile: {} as never },
    evidence: [item],
    loggerTimelineEvidenceIds: [],
    coverageErrors: [],
  };
  const policy = parseRcaPolicy(JSON.parse(await readFile(join(process.cwd(), "config/rca-rules.json"), "utf8")));
  const report = buildReport({
    reportId: "report-rca",
    createdAt: "2026-10-16T00:01:00.000Z",
    bundle,
    checks: [{
      testCaseId: "TC-14",
      verdict: "FAIL",
      category: "RUNTIME_BROWSER",
      scope: { deviceId: run.deviceId, articleEpochId: "article-1", tagName: "v-approved" },
      expected: "uncovered player",
      observed: { state: "covered" },
      evidenceIds: [item.evidenceId],
    }],
    captureComplete: true,
    executionErrors: [],
    rcaPolicy: { ...policy, status: "confirmed", profileId: run.profileId },
  });

  assert.equal(report.diagnoses[0]?.probableCause.code, "player_formation_or_layout_failure");
  assert.deepEqual(report.diagnoses[0]?.probableCause.evidenceIds, [item.evidenceId]);
});
