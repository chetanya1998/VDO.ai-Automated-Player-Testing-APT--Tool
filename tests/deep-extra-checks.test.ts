import assert from "node:assert/strict";
import test from "node:test";
import type { Evidence } from "../src/contracts.js";
import { isSafeFrameUrl, validateSafeFrame, validateSlotRefresh, type SafeFrameSample } from "../src/deep/index.js";

let id = 0;
const network = (url: string, startedMs: number, outcome = "http_success"): Evidence => ({
  schemaVersion: 1, runId: "r", articleEpochId: "a", deviceId: "desktop", evidenceId: `n-${++id}`, source: "browser_network", capturedAt: "2026-01-01T00:00:00.000Z",
  data: { kind: "request", url, startedMs, outcome },
});
const loggerEvent = (event: string, startedMs: number): Evidence[] => {
  const request = network("https://logger.vdo.ai/logger.php", startedMs);
  return [request, { ...request, evidenceId: `l-${++id}`, source: "browser_logger", data: { kind: "logger_request", networkEvidenceId: request.evidenceId, fields: { event } } }];
};
const sample = (overrides: Partial<SafeFrameSample>): SafeFrameSample => ({
  atMs: 5_000, url: "https://abc.safeframe.googlesyndication.com/safeframe/1-0-40/html/container.html", width: 300, height: 250, visible: true, inViewport: true, inPlayer: true, crossOrigin: true, ...overrides,
});

test("SafeFrame URLs are recognised", () => {
  assert.equal(isSafeFrameUrl("https://0a1b.safeframe.googlesyndication.com/safeframe/1-0-40/html/container.html"), true);
  assert.equal(isSafeFrameUrl("https://tpc.googlesyndication.com/safeframe/1-0-40/html/container.html"), true);
  assert.equal(isSafeFrameUrl("https://tpc.googlesyndication.com/simgad/123"), false);
  assert.equal(isSafeFrameUrl("https://evil.example/safeframe/x.html"), false);
});

test("safe frame check judges only SafeFrames inside the player", () => {
  const loaded = [{ atMs: 4_000, url: sample({}).url }];
  const verdict = (samples: SafeFrameSample[], evidence: Evidence[] = []) => validateSafeFrame({ evidence, safeFrames: { loaded, samples }, completed: true }).verdict;
  assert.equal(verdict([sample({})]), "PASS");
  assert.equal(verdict([sample({ width: 0, height: 0 })]), "WARNING", "zero size cannot be seen");
  assert.equal(verdict([sample({ visible: false })]), "WARNING");
  assert.equal(verdict([sample({ crossOrigin: false })]), "WARNING", "not separated from the page");
  assert.equal(verdict([sample({ inPlayer: false })]), "NOT_APPLICABLE", "publisher's own SafeFrame ads are not judged");
  assert.equal(validateSafeFrame({ evidence: [], safeFrames: { loaded: [], samples: [] }, completed: true }).verdict, "NOT_APPLICABLE");
  assert.equal(verdict([], [network(sample({}).url, 3_000, "http_failure")]), "WARNING", "a failed SafeFrame container is reported");
  assert.equal(validateSafeFrame({ evidence: [], completed: false }).verdict, "UNKNOWN");
});

test("refresh check: on time passes, wrong interval warns, no refresh fails, no ads is unknown", () => {
  const window = { startMs: 20_000, endMs: 70_000 };
  const check = (evidence: Evidence[], refreshWindow: { startMs: number; endMs: number } | null = window) => validateSlotRefresh({ evidence, intervalSec: 30, refreshWindow });
  const onTime = check([...loggerEvent("Ad Request", 10_000), ...loggerEvent("Ad Request", 11_000), ...loggerEvent("Ad Request", 41_500)]);
  assert.equal(onTime.verdict, "PASS", onTime.summary);
  assert.match(onTime.summary, /31\.5 s/);
  assert.equal(check([...loggerEvent("Ad Request", 10_000), ...loggerEvent("Ad Request", 22_000)]).verdict, "WARNING");
  const none = check(loggerEvent("Ad Request", 10_000));
  assert.equal(none.verdict, "FAIL", none.summary);
  assert.equal(check(loggerEvent("Ad Request", 50_000)).verdict, "UNKNOWN", "too little time watched after a late first ad");
  assert.equal(check([]).verdict, "UNKNOWN");
  assert.equal(check(loggerEvent("Ad Request", 10_000), null).verdict, "UNKNOWN");
  const gam = check([network("https://securepubads.g.doubleclick.net/gampad/ads?iu=x", 10_000), network("https://securepubads.g.doubleclick.net/gampad/ads?iu=x", 40_000)]);
  assert.equal(gam.verdict, "PASS", "Google Ad Manager requests are used when the player sends no Ad Request events");
});
