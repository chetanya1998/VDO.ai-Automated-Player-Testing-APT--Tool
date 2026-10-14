import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseEvidence, type Evidence, type JsonValue } from "../src/contracts.js";
import { parseTimingPolicy, validateTiming, type TimingValidationInput } from "../src/rules/timing.js";

const policy = parseTimingPolicy(JSON.parse(await readFile("config/timing.json", "utf8")));
const createdAt = "2026-10-13T00:00:00.000Z";

function evidence(evidenceId: string, source: Evidence["source"], data: { [key: string]: JsonValue }): Evidence {
  return parseEvidence({
    schemaVersion: 1,
    evidenceId,
    runId: "run-timing",
    articleEpochId: "article-one",
    deviceId: "desktop-chromium",
    source,
    capturedAt: createdAt,
    data,
  });
}

function network(evidenceId: string, url: string, startedMs: number | null, durationMs: number | null, outcome = "http_success"): Evidence {
  return evidence(evidenceId, "browser_network", {
    kind: "request",
    url,
    startedMs,
    durationMs,
    outcome,
  });
}

function logger(evidenceId: string, networkEvidenceId: string | null, event: string, startedMs: number | null, durationMs: number | null, outcome = "http_success"): Evidence {
  return evidence(evidenceId, "browser_logger", {
    kind: "logger_request",
    networkEvidenceId,
    fields: { event },
    rawEvent: event,
    requestStartedMs: startedMs,
    requestDurationMs: durationMs,
    requestOutcome: outcome,
  });
}

function input(items: Evidence[], overrides: Partial<TimingValidationInput> = {}): TimingValidationInput {
  return {
    evidence: items,
    policy,
    loaderUrl: "https://a.vdo.ai/core/v-example-site/vdo.ai.js",
    deviceId: "desktop-chromium",
    articleEpochId: "article-one",
    tagName: "v-example-site",
    captureContext: { coldCache: "new_context", networkConditions: "host_default_unshaped" },
    ...overrides,
  };
}

function check(items: Evidence[], id: "TC-2" | "TC-15", overrides: Partial<TimingValidationInput> = {}) {
  return validateTiming(input(items, overrides)).find((item) => item.testCaseId === id)!;
}

test("script timing honors 500 and 1000 ms boundaries", () => {
  for (const [durationMs, verdict] of [[499, "PASS"], [500, "PASS"], [501, "WARNING"], [1000, "WARNING"], [1001, "FAIL"]] as const) {
    const result = check([network(`loader-${durationMs}`, `https://a.vdo.ai/core/v-example-site/vdo.ai.js?case=${durationMs}`, 10, durationMs)], "TC-2");
    assert.equal(result.verdict, verdict, `${durationMs} ms`);
    assert.equal((result.observed as { requests: Array<{ durationMs: number }> }).requests[0]?.durationMs, durationMs);
  }
});

test("script timeout fails while missing timing or cold-cache proof stays unknown", () => {
  assert.equal(check([network("loader-timeout", "https://a.vdo.ai/core/v-example-site/vdo.ai.js", 10, 1200, "incomplete")], "TC-2").verdict, "FAIL");
  assert.equal(check([network("loader-missing", "https://a.vdo.ai/core/v-example-site/vdo.ai.js", null, null)], "TC-2").verdict, "UNKNOWN");
  assert.equal(check([network("loader-warm", "https://a.vdo.ai/core/v-example-site/vdo.ai.js", 10, 100)], "TC-2", {
    captureContext: { coldCache: "unknown", networkConditions: "unknown" },
  }).verdict, "UNKNOWN");
});

test("logger durations warn only above 500 ms and keep raw event gaps", () => {
  const items = [
    network("network-one", "https://publisher.example/logger.php", 100, 500),
    logger("logger-one", "network-one", "loaded", 100, 500),
    network("network-two", "https://publisher.example/logger.php", 800, 501),
    logger("logger-two", "network-two", "Pageview", 800, 501),
  ];
  const result = check(items, "TC-15");
  const observed = result.observed as { requests: Array<{ durationVerdict: string; eventGapMs: number | null }>; eventGapAssessment: string };
  assert.equal(result.verdict, "WARNING");
  assert.deepEqual(observed.requests.map((item) => item.durationVerdict), ["PASS", "WARNING"]);
  assert.deepEqual(observed.requests.map((item) => item.eventGapMs), [null, 700]);
  assert.equal(observed.eventGapAssessment, "unconfigured");
});

test("repeated logger spikes and timeouts remain warnings without an invented failure threshold", () => {
  const items = [
    network("network-one", "https://publisher.example/logger.php", 0, 900),
    logger("logger-one", "network-one", "loaded", 0, 900),
    network("network-two", "https://publisher.example/logger.php", 1000, 1500, "incomplete"),
    logger("logger-two", "network-two", "Pageview", 1000, 1500, "incomplete"),
  ];
  const result = check(items, "TC-15");
  assert.equal(result.verdict, "WARNING");
  assert.equal((result.observed as { slowRequestCount: number }).slowRequestCount, 2);
  assert.equal((result.expected as { requestDurationMs: { failureAbove: null } }).requestDurationMs.failureAbove, null);
  assert.equal(check([logger("logger-timeout-only", null, "loaded", 0, null, "incomplete")], "TC-15").verdict, "WARNING");
});

test("missing logger timing is unknown and unconfigured policy rejects invented limits", () => {
  const result = check([logger("logger-missing", null, "loaded", null, null)], "TC-15");
  assert.equal(result.verdict, "UNKNOWN");
  assert.throws(() => parseTimingPolicy({
    ...policy,
    logger: { ...policy.logger, eventGapThresholdMs: 250 },
  }), /must remain null/);
});

test("normalized logger timing remains usable without the linked network record", () => {
  const result = check([logger("logger-normalized", "network-not-in-scope", "loaded", 10, 501)], "TC-15");
  assert.equal(result.verdict, "WARNING");
});
