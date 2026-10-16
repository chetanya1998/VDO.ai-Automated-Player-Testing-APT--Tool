import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { CheckResult, Evidence, IssueCategory, TestCaseId, Verdict } from "../src/contracts.js";
import { diagnose, parseRcaPolicy } from "../src/rca/diagnose.js";

const policy = parseRcaPolicy(JSON.parse(await readFile(join(process.cwd(), "config/rca-rules.json"), "utf8")));

function evidence(evidenceId: string): Evidence {
  return {
    schemaVersion: 1,
    evidenceId,
    runId: "run-rca",
    articleEpochId: "article-1",
    deviceId: "desktop",
    source: "browser_network",
    capturedAt: "2026-10-16T00:00:00.000Z",
    data: { kind: "request" },
  };
}

function check(testCaseId: TestCaseId, verdict: Verdict, category: IssueCategory, evidenceId: string, observed: CheckResult["observed"]): CheckResult {
  return {
    testCaseId,
    verdict,
    category,
    scope: { deviceId: "desktop", articleEpochId: "article-1", tagName: "v-approved" },
    expected: "configured requirement",
    observed,
    evidenceIds: [evidenceId],
  };
}

test("missing loader is the primary cause for dependent symptoms without inventing a logger outage", () => {
  const checks = [
    check("TC-1", "FAIL", "IMPLEMENTATION", "ev-loader", { state: "loader_missing" }),
    check("TC-4", "FAIL", "TOOLING", "ev-logger", { state: "logger_request_missing" }),
    check("TC-5", "FAIL", "RUNTIME_BROWSER", "ev-init", { state: "init_event_missing" }),
    check("TC-10", "FAIL", "RUNTIME_BROWSER", "ev-ad", { state: "ad_request_missing" }),
  ];
  const diagnoses = diagnose(checks, checks.map((item) => evidence(item.evidenceIds[0]!)), policy);

  assert.equal(diagnoses.length, 1);
  assert.equal(diagnoses[0]!.probableCause.code, "loader_script_unavailable");
  assert.deepEqual(diagnoses[0]!.groupedSymptoms.map((item) => item.testCaseId), ["TC-4", "TC-5", "TC-10"]);
  assert.equal(diagnoses.some((item) => item.probableCause.code === "logger_delivery_failure"), false);
  assert.deepEqual(new Set(diagnoses[0]!.probableCause.evidenceIds), new Set(["ev-loader", "ev-logger", "ev-init", "ev-ad"]));
});

test("player, backend, demand, and configuration failures remain separately attributable", () => {
  const checks = [
    check("TC-4", "FAIL", "RUNTIME_BROWSER", "ev-backend", { state: "backend_correlation_mismatch" }),
    check("TC-12", "FAIL", "CONFIGURATION", "ev-dependency", { failedRequired: ["vdo.player.js"] }),
    check("TC-10", "WARNING", "INVESTIGATE_DEMAND", "ev-demand", { firstFailure: { event: "ad_match", cause: "no_fill_or_no_bid" } }),
    check("TC-14", "FAIL", "RUNTIME_BROWSER", "ev-layout", { state: "covered" }),
  ];
  const diagnoses = diagnose(checks, checks.map((item) => evidence(item.evidenceIds[0]!)), policy);

  assert.deepEqual(diagnoses.map((item) => item.probableCause.code), [
    "backend_correlation_unavailable",
    "required_dependency_failure",
    "demand_or_ad_chain_gap",
    "player_formation_or_layout_failure",
  ]);
  assert.equal(diagnoses.find((item) => item.category === "INVESTIGATE_DEMAND")?.suggestedOwner, "Demand or ad operations");
  assert.doesNotMatch(diagnoses.find((item) => item.category === "CONFIGURATION")!.suggestedOwner, /publisher/i);
  assert.equal(diagnoses.every((item) => item.probableCause.evidenceIds.length > 0), true);
  assert.equal(diagnoses.every((item) => item.probableCause.confidence === "supported"), true);
  assert.doesNotMatch(JSON.stringify(diagnoses), /probability|\d+%/i);
});

test("conflicting later success reduces cause confidence without erasing the earlier failure", () => {
  const dependency = check("TC-12", "FAIL", "RUNTIME_BROWSER", "ev-dependency", {
    state: "failed",
    attempts: [{ outcome: "http_failure" }, { outcome: "http_success" }],
  });
  const diagnoses = diagnose([dependency], [evidence("ev-dependency")], policy);

  assert.equal(diagnoses[0]!.primarySymptom.verdict, "FAIL");
  assert.equal(diagnoses[0]!.probableCause.confidence, "possible");
  assert.equal(diagnoses[0]!.conflicts.length, 1);
});

test("an expected block stays a warning with a separate supported cause", () => {
  const blocked = check("TC-11", "WARNING", "RUNTIME_BROWSER", "ev-block", {
    blocks: [{ event: "blocked_autoplay", expectation: "expected", cause: "configured_block" }],
  });
  const diagnoses = diagnose([blocked], [evidence("ev-block")], policy);

  assert.equal(diagnoses[0]!.primarySymptom.verdict, "WARNING");
  assert.equal(diagnoses[0]!.probableCause.code, "expected_runtime_block");
  assert.equal(diagnoses[0]!.category, "RUNTIME_BROWSER");
});

test("RCA policy and diagnosis reject unsupported evidence references", () => {
  const failure = check("TC-14", "FAIL", "RUNTIME_BROWSER", "ev-missing", { state: "covered" });
  assert.throws(() => diagnose([failure], [], policy), /unknown evidence/);
  assert.throws(() => parseRcaPolicy({ ...policy, lifecycleOrder: ["TC-1", "TC-1"] }), /duplicates/);
});
