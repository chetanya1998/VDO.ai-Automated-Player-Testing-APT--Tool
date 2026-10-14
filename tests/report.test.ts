import assert from "node:assert/strict";
import test from "node:test";
import { createQueuedRun, parseRun, type CheckResult } from "../src/contracts.js";
import type { NormalizedEvidenceBundle } from "../src/evidence/normalize.js";
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
