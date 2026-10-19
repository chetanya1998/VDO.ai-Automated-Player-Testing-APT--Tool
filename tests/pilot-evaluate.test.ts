import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DEPLOYMENT_CONTROLS } from "../src/deploy/acceptance.js";
import { evaluatePilot } from "../src/pilot/evaluate.js";
import { evaluatePilotReadiness } from "../src/pilot/readiness.js";

const DIGEST = `sha256:${"a".repeat(64)}`;
const PROFILE_HASH = `sha256:${"b".repeat(64)}`;
const NOW = new Date("2026-10-19T12:00:00.000Z");

function evidence(id: string) {
  return [{ evidenceId: id, sha256: DIGEST }];
}

function readiness() {
  return {
    schemaVersion: 1,
    corpus: { corpusId: "qa-corpus-2026-10", labelSetId: "labels-v1", labelOwner: "qa", evidence: evidence("corpus") },
    decisions: Array.from({ length: 14 }, (_, index) => ({
      decisionId: `D${String(index + 1).padStart(2, "0")}`,
      confirmedBy: "decision-owner",
      evidence: evidence(`decision-${index + 1}`),
    })),
    deployment: {
      acceptance: {
        schemaVersion: 1,
        acceptanceId: "acceptance-1",
        environmentId: "pilot-prod",
        evaluatedAt: "2026-10-19T10:00:00.000Z",
        expiresAt: "2026-10-20T10:00:00.000Z",
        browserImageDigest: DIGEST,
        approvedProfileHashes: [PROFILE_HASH],
        approvedOrigins: ["https://publisher.example"],
        checks: DEPLOYMENT_CONTROLS.map((control) => ({ control, state: "passed", evidence: evidence(`deployment-${control}`) })),
      },
      browserImageDigest: DIGEST,
      profileHashes: [PROFILE_HASH],
      requiredOrigins: ["https://publisher.example"],
    },
    devices: [
      { deviceId: "desktop-chromium", deviceClass: "desktop", platform: "windows", realDevice: true, evidence: evidence("desktop") },
      { deviceId: "iphone-safari", deviceClass: "mobile", platform: "ios", realDevice: true, evidence: evidence("ios") },
    ],
    execution: { declaredConcurrency: 2, costSourceId: "billing-export-1", evidence: evidence("cost") },
  };
}

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
    readiness: readiness(),
    records,
  }, NOW);
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
  assert.equal(result.readiness.ready, true);
  assert.deepEqual(result.disagreements, []);
  assert.deepEqual(result.followUpCards, []);
  assert.equal(result.releaseReady, true);
  assert.deepEqual(result.failures, []);
});

test("empty observations publish unavailable metrics and cannot release", () => {
  const result = evaluatePilot({ readiness: readiness(), records: [] }, NOW);
  assert.equal(result.metrics.submissionToReportP95Ms, null);
  assert.equal(result.metrics.diagnosisCompleteness, null);
  assert.equal(result.releaseReady, false);
  assert.ok(result.failures.length >= 8);
});

test("pilot labels reject contradictory critical and ambiguous expectations", () => {
  const critical = { ...record("TC-1", "desktop", "fault_or_boundary"), expectedVerdict: "PASS" };
  assert.throws(() => evaluatePilot({ readiness: readiness(), records: [critical] }, NOW), /criticalFault requires/);
  const ambiguous = { ...record("TC-1", "desktop", "ambiguous"), expectedVerdict: "PASS" };
  assert.throws(() => evaluatePilot({ readiness: readiness(), records: [ambiguous] }, NOW), /ambiguous scenarios require/);
});

test("pilot readiness rejects unsupported release claims", () => {
  const missingDecision = readiness();
  missingDecision.decisions.pop();
  const decisionResult = evaluatePilotReadiness(missingDecision, NOW);
  assert.equal(decisionResult.ready, false);
  assert.equal(decisionResult.gates.allRuleDecisionsConfirmed, false);

  const emulatedIos = readiness();
  emulatedIos.devices[1]!.realDevice = false;
  const deviceResult = evaluatePilotReadiness(emulatedIos, NOW);
  assert.equal(deviceResult.gates.realMobileEvidencePresent, false);
  assert.equal(deviceResult.gates.realIosEvidencePresent, false);

  const expired = readiness();
  const deploymentResult = evaluatePilotReadiness(expired, new Date("2026-10-21T12:00:00.000Z"));
  assert.equal(deploymentResult.gates.deploymentAcceptanceValid, false);
});

test("pilot evaluator emits owned follow-up cards for observed disagreements", () => {
  const disagreement = { ...record("TC-1", "desktop", "healthy"), actualVerdict: "WARNING" as const };
  const result = evaluatePilot({ readiness: readiness(), records: [disagreement] }, NOW);
  assert.equal(result.releaseReady, false);
  assert.deepEqual(result.disagreements.map((item) => item.scenarioId), [disagreement.scenarioId]);
  assert.deepEqual(result.followUpCards, [{
    title: "Resolve TC-1 disagreement for TC-1-desktop-healthy",
    owner: "qa",
    scenarioId: "TC-1-desktop-healthy",
    testCaseId: "TC-1",
  }]);
});

test("pilot evaluator rejects duplicate scenario observations", () => {
  const duplicate = record("TC-1", "desktop", "healthy");
  assert.throws(() => evaluatePilot({ readiness: readiness(), records: [duplicate, duplicate] }, NOW), /duplicate scenarioId/);
});
