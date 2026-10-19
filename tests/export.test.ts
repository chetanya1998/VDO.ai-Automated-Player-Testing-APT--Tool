import assert from "node:assert/strict";
import test from "node:test";
import { buildTechnicalReportExport, renderTechnicalReportHtml } from "../src/report/export.js";
import type { TeamReportExportSource } from "../src/store.js";

function source(): TeamReportExportSource {
  return {
    run: {
      runId: "run-export",
      targetUrl: "https://publisher.example/article?token=PRIVATE_QUERY",
      deviceId: "mobile",
      executionState: "completed",
      createdAt: "2026-10-19T10:00:00.000Z",
      deadlineAt: "2026-10-19T10:05:00.000Z",
      startedAt: "2026-10-19T10:00:01.000Z",
      endedAt: "2026-10-19T10:00:05.000Z",
      progress: { stage: "done" },
      partialReport: null,
    },
    profile: {
      profileId: "fixture-profile",
      profileVersion: 3,
      profileHash: `sha256:${"a".repeat(64)}`,
      snapshot: {
        schemaVersion: 3,
        apiKey: "SECRET_SENTINEL",
        refreshToken: "PRIVATE_REFRESH",
        events: { policyId: "events-v2" },
        devices: [{ id: "mobile", browser: "chromium", os: "android" }],
      },
    },
    report: {
      runId: "run-export",
      executionState: "completed",
      report: {
        reportId: "report-export",
        overallVerdict: "FAIL",
        checks: [
          {
            testCaseId: "TC-1",
            verdict: "PASS",
            category: "IMPLEMENTATION",
            scope: { deviceId: "mobile", articleEpochId: "article-1", tagName: "v-example" },
            expected: "one loader",
            observed: "one loader",
            evidenceIds: ["network-1"],
          },
          {
            testCaseId: "TC-5",
            verdict: "FAIL",
            category: "IMPLEMENTATION",
            scope: { deviceId: "mobile", articleEpochId: "article-1", tagName: "v-example" },
            expected: "complete sequence",
            observed: "<script>globalThis.pwned=true</script>",
            evidenceIds: ["logger-1"],
          },
        ],
        diagnoses: [{
          diagnosisId: "rca-1",
          primarySymptom: { testCaseId: "TC-5", verdict: "FAIL", observed: "missing init", evidenceIds: ["logger-1"] },
          suggestedOwner: "Player engineering",
          nextChecks: ["Verify the loader response"],
        }],
        coverage: { totalCases: 23, policyVersion: "coverage-v1" },
        limitations: ["Real iOS evidence was not supplied."],
      },
      evidence: [
        {
          evidenceId: "network-1",
          articleEpochId: "article-1",
          deviceId: "mobile",
          source: "browser_network",
          capturedAt: "2026-10-19T10:00:01.000Z",
          metadata: { kind: "script_request", url: "https://a.vdo.ai/vdo.ai.js", durationMs: 230 },
        },
        {
          evidenceId: "logger-1",
          articleEpochId: "article-1",
          deviceId: "mobile",
          source: "browser_logger",
          capturedAt: "2026-10-19T10:00:02.000Z",
          metadata: {
            kind: "logger_request",
            canonicalEvent: "loaded",
            durationMs: 41,
            fields: { event: "loaded", tagName: "v-example" },
            authorization: "Bearer PRIVATE_AUTH",
          },
        },
        {
          evidenceId: "error-1",
          articleEpochId: "article-1",
          deviceId: "mobile",
          source: "browser_logger",
          capturedAt: "2026-10-19T10:00:03.000Z",
          metadata: { canonicalEvent: "Blocked IMA", blockedCode: "Q2", secret: "PRIVATE_SECRET" },
        },
      ],
      findings: [{
        findingId: "finding-1",
        kind: "diagnosis",
        category: "IMPLEMENTATION",
        verdict: "FAIL",
        evidenceIds: ["logger-1"],
        payload: { detail: "missing initVdo" },
      }],
      artifacts: [{
        artifactId: "screenshot-1",
        kind: "screenshot",
        byteSize: 1234,
        sha256: `sha256:${"b".repeat(64)}`,
      }],
    },
  };
}

test("technical export preserves stored results and derives its evidence summaries", () => {
  const exported = buildTechnicalReportExport(source(), "2026-10-19T11:00:00.000Z");
  assert.equal((exported.summary as { checkCount: number }).checkCount, 2);
  assert.deepEqual((exported.summary as { verdictCounts: Record<string, number> }).verdictCounts, { PASS: 1, FAIL: 1 });
  assert.equal(exported.findings.length, 1);
  assert.deepEqual(exported.loggerSequence.map((item) => (item as { event: string }).event), ["loaded", "Blocked IMA"]);
  assert.equal(exported.blockedAndErrorEvents.length, 1);
  assert.equal((exported.environment as { browser: string }).browser, "chromium");
  assert.equal((exported.environment as { os: string }).os, "android");
  assert.equal((exported.summary as { suggestedOwner: string }).suggestedOwner, "Player engineering");
  assert.deepEqual((exported.profile as { ruleVersions: Record<string, string> }).ruleVersions, {
    "profile.schemaVersion": "3",
    "profile.events.policyId": "events-v2",
    "report.coverage.policyVersion": "coverage-v1",
  });
});

test("JSON and offline HTML exports redact secrets, escape text, and omit artifact locations", () => {
  const exported = buildTechnicalReportExport(source(), "2026-10-19T11:00:00.000Z");
  const json = JSON.stringify(exported);
  const html = renderTechnicalReportHtml(exported);

  assert.doesNotMatch(json, /PRIVATE_QUERY|PRIVATE_AUTH|PRIVATE_SECRET|PRIVATE_REFRESH|SECRET_SENTINEL/);
  assert.doesNotMatch(json, /storageRef|artifactPath/);
  assert.match(json, /\[REDACTED\]/);
  assert.doesNotMatch(html, /<script>|globalThis\.pwned=true<\/script>/);
  assert.match(html, /&lt;script&gt;globalThis\.pwned=true&lt;\/script&gt;/);
  assert.doesNotMatch(html, /\b(?:src|href)\s*=/i);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /screenshot-1/);
});
