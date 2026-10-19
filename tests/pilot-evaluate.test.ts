import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { evaluatePilot } from "../src/pilot/evaluate.js";

function record(testCaseId: string, deviceClass: "desktop" | "mobile", scenarioKind: "healthy" | "fault_or_boundary" | "ambiguous") {
  const failure = scenarioKind === "fault_or_boundary";
  return {
    scenarioId: `${testCaseId}-${deviceClass}-${scenarioKind}`,
    testCaseId,
    deviceId: deviceClass === "desktop" ? "desktop-chromium" : "mobile-chromium",
    deviceClass,
    scenarioKind,
    criticalFault: failure,
    submittedAt: "2026-10-19T10:00:00.000Z",
    reportedAt: failure ? "2026-10-19T10:00:02.000Z" : "2026-10-19T10:00:01.000Z",
    expectedVerdict: failure ? "FAIL" : scenarioKind === "ambiguous" ? "UNKNOWN" : "PASS",
    actualVerdict: failure ? "FAIL" : scenarioKind === "ambiguous" ? "UNKNOWN" : "PASS",
    evidenceIds: [`evidence-${testCaseId}-${deviceClass}-${scenarioKind}`],
    expectedDiagnosisCode: failure ? `diagnosis-${testCaseId}` : null,
    actualDiagnosisCode: failure ? `diagnosis-${testCaseId}` : null,
    diagnosisEvidenceIds: failure ? [`evidence-${testCaseId}-${deviceClass}-${scenarioKind}`] : [],
    ambiguousJoinCount: scenarioKind === "ambiguous" ? 1 : 0,
    articleTransitions: testCaseId === "TC-23" ? 3 : 0,
    costUsd: 0,
  };
}

test("pilot manifest exactly follows CASES.json and retains the blocked state", async () => {
  const manifest = JSON.parse(await readFile(join(process.cwd(), "tests/pilot/manifest.json"), "utf8")) as { caseIds: string[]; state: string; aiEnabled: boolean };
  const cases = JSON.parse(await readFile(join(process.cwd(), "docs/plan/CASES.json"), "utf8")) as Array<{ case_id: string }>;
  assert.deepEqual(manifest.caseIds, cases.map((item) => item.case_id));
  assert.equal(manifest.state, "blocked_missing_labeled_corpus_and_deployment");
  assert.equal(manifest.aiEnabled, false);
});

test("pilot evaluator calculates release metrics and enforces every gate", () => {
  const caseIds = Array.from({ length: 23 }, (_, index) => `TC-${index + 1}`);
  const records = caseIds.flatMap((testCaseId) => (["desktop", "mobile"] as const).flatMap((device) => [
    record(testCaseId, device, "healthy"),
    record(testCaseId, device, "fault_or_boundary"),
  ]));
  records.push(record("TC-10", "desktop", "ambiguous"));
  const result = evaluatePilot({
    declaredConcurrency: 2,
    decisionsConfirmed: true,
    accessRedactionAndEgressPassed: true,
    records,
  });
  assert.equal(result.corpus.records, 93);
  assert.equal(result.corpus.completeCaseDeviceKinds, 92);
  assert.equal(result.metrics.submissionToReportP50Ms, 1_000);
  assert.equal(result.metrics.submissionToReportP95Ms, 2_000);
  assert.equal(result.metrics.diagnosisCompleteness, 1);
  assert.equal(result.metrics.falsePositiveRate, 0);
  assert.equal(result.metrics.recall, 1);
  assert.equal(result.metrics.precision, 1);
  assert.equal(result.metrics.ambiguousJoinCount, 1);
  assert.equal(result.metrics.costCoverage, 1);
  assert.equal(result.releaseReady, true);
  assert.deepEqual(result.failures, []);
});

test("empty observations publish unavailable metrics and cannot release", () => {
  const result = evaluatePilot({ declaredConcurrency: 1, decisionsConfirmed: false, accessRedactionAndEgressPassed: false, records: [] });
  assert.equal(result.metrics.submissionToReportP95Ms, null);
  assert.equal(result.metrics.diagnosisCompleteness, null);
  assert.equal(result.releaseReady, false);
  assert.ok(result.failures.length >= 8);
});

test("pilot labels reject contradictory critical and ambiguous expectations", () => {
  const critical = { ...record("TC-1", "desktop", "fault_or_boundary"), expectedVerdict: "PASS" };
  assert.throws(() => evaluatePilot({ declaredConcurrency: 1, decisionsConfirmed: true, accessRedactionAndEgressPassed: true, records: [critical] }), /criticalFault requires/);
  const ambiguous = { ...record("TC-1", "desktop", "ambiguous"), expectedVerdict: "PASS" };
  assert.throws(() => evaluatePilot({ declaredConcurrency: 1, decisionsConfirmed: true, accessRedactionAndEgressPassed: true, records: [ambiguous] }), /ambiguous scenarios require/);
});
