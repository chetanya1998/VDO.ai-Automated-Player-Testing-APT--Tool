import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseEvidence, type Evidence } from "../src/contracts.js";
import { parseEventRulePolicy, validateEvents, type EventRulePolicy } from "../src/rules/events.js";

const served = [
  "loaded", "init_vdo", "forceplay", "auto_plays", "pageview", "website_pageview", "began_atf", "came_in_view",
  "ad_request", "ad_match", "video_loaded", "video_start", "website_pageview_match", "pageview_match", "viewable_impression",
];
const noAd = ["loaded", "init_vdo", "forceplay", "auto_plays", "pageview", "began_btf", "came_in_view", "ad_request", "video_start"];

async function policy(expected: EventRulePolicy["flow"]["expected"]): Promise<EventRulePolicy> {
  const value = JSON.parse(await readFile("config/event-rules.json", "utf8"));
  value.status = "confirmed";
  value.flow.expected = expected;
  return parseEventRulePolicy(value);
}

function events(tagName: string, names: readonly (string | null)[], start = 0): Evidence[] {
  return names.map((name, index) => parseEvidence({
    schemaVersion: 1,
    evidenceId: `${tagName}-${start + index}`,
    runId: "run-recorded",
    articleEpochId: "article-recorded",
    deviceId: "desktop-chromium",
    source: "browser_logger",
    capturedAt: new Date(Date.parse("2026-10-14T00:00:00.000Z") + start + index).toISOString(),
    data: {
      kind: "logger_request",
      fields: { event: name ?? "unmapped-event", tagName },
      rawEvent: name ?? "unmapped-event",
      canonicalEvent: name,
      requestStartedMs: start + index,
    },
  }));
}

function verdicts(evidence: Evidence[], activeTags: string[], rules: EventRulePolicy): Record<string, string> {
  return Object.fromEntries(validateEvents({
    evidence,
    policy: rules,
    deviceId: "desktop-chromium",
    articleEpochId: "article-recorded",
    activeTags,
    captureComplete: true,
  }).map((check) => [check.testCaseId, check.verdict]));
}

test("served and no-ad lifecycles pass without requiring Video Loaded for no-ad content", async () => {
  assert.deepEqual(verdicts(events("v-served", served), ["v-served"], await policy("served")), {
    "TC-5": "PASS", "TC-6": "PASS", "TC-7": "PASS", "TC-9": "PASS", "TC-22": "PASS",
  });
  assert.deepEqual(verdicts(events("v-no-ad", noAd), ["v-no-ad"], await policy("no_ad")), {
    "TC-5": "PASS", "TC-6": "PASS", "TC-7": "PASS", "TC-9": "PASS", "TC-22": "PASS",
  });
});

test("concurrent served and no-ad tag paths retain independent counts", async () => {
  const evidence = [
    ...events("v-served", served, 0),
    ...events("v-no-ad", noAd, 100),
  ];
  assert.deepEqual(verdicts(evidence, ["v-served", "v-no-ad"], await policy("auto")), {
    "TC-5": "PASS", "TC-6": "PASS", "TC-7": "PASS", "TC-9": "PASS", "TC-22": "PASS",
  });
});

test("events from an inactive tag do not change active-tag counts", async () => {
  const evidence = [...events("v-served", served), ...events("v-inactive", ["pageview", "website_pageview"], 100)];
  const checks = verdicts(evidence, ["v-served"], await policy("served"));
  assert.equal(checks["TC-7"], "PASS");
  assert.equal(checks["TC-22"], "PASS");
});

test("every required served event and placement state fails when conclusively absent", async () => {
  const rules = await policy("served");
  for (const missing of [...rules.required.common, ...rules.required.served, "began_atf"]) {
    const observed = served.filter((name) => name !== missing);
    const checks = verdicts(events("v-served", observed), ["v-served"], rules);
    assert.equal(checks["TC-6"], "FAIL", `missing ${missing}`);
  }
});

test("eligible playback without Ad Request fails TC-9 while disabled demand is not applicable", async () => {
  const rules = await policy("served");
  const withoutRequest = events("v-served", served.filter((name) => name !== "ad_request"));
  assert.equal(verdicts(withoutRequest, ["v-served"], rules)["TC-9"], "FAIL");
  rules.adRequest.state = "disabled";
  assert.equal(verdicts(withoutRequest, ["v-served"], rules)["TC-9"], "NOT_APPLICABLE");
});

test("Replay is enforced only when the confirmed policy requires it", async () => {
  const rules = await policy("served");
  assert.equal(verdicts(events("v-served", served), ["v-served"], rules)["TC-6"], "PASS");
  rules.required.replay = "required";
  assert.equal(verdicts(events("v-served", served), ["v-served"], rules)["TC-6"], "FAIL");
  assert.equal(verdicts(events("v-served", [...served, "replay"]), ["v-served"], rules)["TC-6"], "PASS");
});

test("unknown aliases and observed interruptions keep dependent checks unknown", async () => {
  const rules = await policy("served");
  const unknown = verdicts(events("v-served", [...served, null]), ["v-served"], rules);
  assert.equal(unknown["TC-5"], "UNKNOWN");
  assert.equal(unknown["TC-6"], "UNKNOWN");
  assert.equal(unknown["TC-9"], "UNKNOWN");

  const interrupted = verdicts(events("v-served", ["loaded", "init_vdo", "blocked_player"]), ["v-served"], rules);
  assert.equal(interrupted["TC-5"], "UNKNOWN");
  assert.equal(interrupted["TC-6"], "UNKNOWN");
});

test("an early ordering failure survives a later successful sequence", async () => {
  const checks = verdicts(events("v-served", ["ad_match", ...served]), ["v-served"], await policy("served"));
  assert.equal(checks["TC-5"], "FAIL");
});

test("duplicate pageview and loaded events fail without deduplicating evidence", async () => {
  const evidence = events("v-served", [...served, "loaded", "pageview"]);
  const results = validateEvents({
    evidence,
    policy: await policy("served"),
    deviceId: "desktop-chromium",
    articleEpochId: "article-recorded",
    activeTags: ["v-served"],
    captureComplete: true,
  });
  assert.equal(results.find((check) => check.testCaseId === "TC-7")?.verdict, "FAIL");
  const tc22 = results.find((check) => check.testCaseId === "TC-22");
  assert.equal(tc22?.verdict, "FAIL");
  assert.equal(tc22?.evidenceIds.length, evidence.length);
});
