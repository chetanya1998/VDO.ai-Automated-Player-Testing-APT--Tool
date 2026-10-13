import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createQueuedRun,
  parseArticleEpoch,
  parseEvidence,
  parseProfile,
  parseReport,
  type CheckResult,
  type Report,
} from "../src/contracts.js";

const createdAt = "2026-10-13T00:00:00.000Z";

test("synthetic contracts survive a JSON round trip without claiming success", async () => {
  const profile = parseProfile(JSON.parse(await readFile(
    "config/profiles/fixture-video-inline-v1.json",
    "utf8",
  )));
  const run = createQueuedRun({
    runId: "run-1",
    profileId: profile.profileId,
    targetUrl: profile.site.approvedUrls[0]!,
    deviceId: profile.devices[0]!.id,
    createdAt,
  });
  const epoch = parseArticleEpoch({
    schemaVersion: 1,
    articleEpochId: "article-1",
    runId: run.runId,
    sequence: 0,
    url: run.targetUrl,
    startedAt: createdAt,
  });
  const evidence = parseEvidence({
    schemaVersion: 1,
    evidenceId: "evidence-1",
    runId: run.runId,
    articleEpochId: epoch.articleEpochId,
    deviceId: run.deviceId,
    source: "browser_network",
    capturedAt: createdAt,
    data: { url: run.targetUrl, status: 200 },
  });
  const checks: CheckResult[] = [
    {
      testCaseId: "TC-1",
      verdict: "UNKNOWN",
      category: "TOOLING",
      scope: { deviceId: run.deviceId, articleEpochId: epoch.articleEpochId, tagName: null },
      expected: "browser evidence",
      observed: "browser collection has not run",
      evidenceIds: [],
    },
    {
      testCaseId: "TC-16",
      verdict: "NOT_APPLICABLE",
      category: "NONE",
      scope: { deviceId: run.deviceId, articleEpochId: null, tagName: null },
      expected: "real iOS evidence",
      observed: "desktop fixture",
      evidenceIds: [],
    },
  ];
  const report: Report = {
    schemaVersion: 1,
    reportId: "report-1",
    runId: run.runId,
    profileId: run.profileId,
    createdAt,
    executionState: run.executionState,
    overallVerdict: "UNKNOWN",
    checks,
    evidenceIds: [evidence.evidenceId],
  };

  assert.deepEqual(parseReport(JSON.parse(JSON.stringify(report))), report);
  assert.equal(run.capabilities.browserCollector.state, "available");
  assert.notEqual(checks[0]!.verdict, checks[1]!.verdict);
});

test("external inputs reject invalid URLs, profiles, and evidence", async () => {
  assert.throws(() => createQueuedRun({
    runId: "run-2",
    profileId: "fixture-video-inline-v1",
    targetUrl: "file:///etc/passwd",
    deviceId: "desktop-chromium",
    createdAt,
  }), /HTTP\(S\) URL/);

  const rawProfile = JSON.parse(await readFile("config/profiles/fixture-video-inline-v1.json", "utf8"));
  rawProfile.site.approvedUrls = ["not a URL"];
  assert.throws(() => parseProfile(rawProfile), /valid URL/);

  assert.throws(() => parseEvidence({
    schemaVersion: 1,
    evidenceId: "evidence-2",
    runId: "run-2",
    articleEpochId: "article-2",
    deviceId: "desktop-chromium",
    source: "browser_network",
    capturedAt: "yesterday",
    data: {},
  }), /timestamp/);

  assert.throws(() => parseEvidence({
    schemaVersion: 1,
    evidenceId: "evidence-3",
    runId: "run-2",
    articleEpochId: "article-2",
    deviceId: "desktop-chromium",
    source: "browser_network",
    capturedAt: createdAt,
    data: [],
  }), /JSON object/);
});

test("an empty or incomplete placeholder cannot report PASS", () => {
  assert.throws(() => parseReport({
    schemaVersion: 1,
    reportId: "report-placeholder",
    runId: "run-placeholder",
    profileId: "fixture-video-inline-v1",
    createdAt,
    executionState: "queued",
    overallVerdict: "PASS",
    checks: [],
    evidenceIds: [],
  }), /PASS report must be completed/);
});
