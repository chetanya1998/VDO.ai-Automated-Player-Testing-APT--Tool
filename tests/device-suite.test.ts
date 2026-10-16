import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseArticlePolicy } from "../src/browser/articles.js";
import { parseArticleEpoch, parseEvidence, type Evidence } from "../src/contracts.js";
import { validateArticles } from "../src/rules/articles.js";
import { parseDevicePolicy, parseRealDeviceEvidence, validateDevice } from "../src/rules/devices.js";
import { parseEventRulePolicy } from "../src/rules/events.js";

const at = (milliseconds: number) => new Date(Date.parse("2026-10-16T00:00:00.000Z") + milliseconds).toISOString();

function evidence(id: string, deviceId: string, source: Evidence["source"], capturedAt: string, data: Evidence["data"]): Evidence {
  return parseEvidence({ schemaVersion: 1, evidenceId: id, runId: `run-${deviceId}`, articleEpochId: "article-1", deviceId, source, capturedAt, data });
}

function visibility(deviceId: string, width: number, height: number): Evidence {
  return evidence(`${deviceId}-dimensions`, deviceId, "browser_dom", at(1), { kind: "visibility_sample", viewport: { width, height }, players: [{ rect: { width: Math.min(640, width), height: 360 } }] });
}

function logger(deviceId: string, event: string, milliseconds: number): Evidence {
  return evidence(`${deviceId}-${event}-${milliseconds}`, deviceId, "browser_logger", at(milliseconds), { kind: "logger_request", canonicalEvent: event, fields: { event, tagName: "v-example-site" } });
}

async function policy() {
  const value = JSON.parse(await readFile("config/devices.json", "utf8"));
  value.status = "confirmed";
  return parseDevicePolicy(value);
}

test("desktop and emulated mobile profiles retain viewport, consent, autoplay, and fidelity metadata", async () => {
  const rules = await policy();
  const desktop = rules.devices.find((item) => item.kind === "desktop")!;
  const mobile = rules.devices.find((item) => item.kind === "mobile")!;
  const desktopCheck = validateDevice({ evidence: [visibility(desktop.id, desktop.viewport.width, desktop.viewport.height)], policy: rules, device: desktop, deviceId: desktop.id, captureComplete: true, runtime: { os: "win32", browser: "chromium", viewport: desktop.viewport } });
  assert.equal(desktopCheck.verdict, "PASS");
  assert.match(JSON.stringify(desktopCheck.expected), /muted/);

  const mobileCheck = validateDevice({ evidence: [visibility(mobile.id, mobile.viewport.width, mobile.viewport.height)], policy: rules, device: mobile, deviceId: mobile.id, captureComplete: true, runtime: { os: "win32", browser: "chromium", viewport: mobile.viewport } });
  assert.equal(mobileCheck.verdict, "UNKNOWN");
  assert.match(JSON.stringify(mobileCheck.observed), /Chromium emulation cannot verify iOS restrictions/);
  assert.deepEqual(rules.deferred, ["tablet", "ctv"]);
});

test("mobile block exercises and playback after tap pass only with real iOS Safari evidence", async () => {
  const rules = await policy();
  const mobile = rules.devices.find((item) => item.kind === "mobile")!;
  const items = [
    visibility(mobile.id, mobile.viewport.width, mobile.viewport.height),
    logger(mobile.id, "blocked_inline", 2), logger(mobile.id, "blocked_autoplay", 3), logger(mobile.id, "blocked_device", 4),
    evidence("tap", mobile.id, "browser_dom", at(5), { kind: "device_tap", outcome: "completed", selector: "[data-player-tap]" }),
    logger(mobile.id, "video_start", 6),
    evidence("ios-proof", mobile.id, "browser_dom", at(7), { kind: "real_device_evidence", platform: "ios", browser: "safari", consent: "granted", autoplayMode: "muted", playbackAfterTap: true, blockEvents: [], artifactRefs: ["qa://capture/1"] }),
  ];
  const check = validateDevice({ evidence: items, policy: rules, device: mobile, deviceId: mobile.id, captureComplete: true, runtime: { os: "win32", browser: "chromium", viewport: mobile.viewport } });
  assert.equal(check.verdict, "PASS");
  assert.equal(check.evidenceIds.length, 7);

  const withoutPlayback = items.filter((item) => item.data.canonicalEvent !== "video_start");
  assert.equal(validateDevice({ evidence: withoutPlayback, policy: rules, device: mobile, deviceId: mobile.id, captureComplete: true, runtime: { os: "win32", browser: "chromium", viewport: mobile.viewport } }).verdict, "FAIL");
});

test("real-device evidence import requires attributable iOS Safari artifacts", async () => {
  const valid = parseRealDeviceEvidence({ schemaVersion: 1, evidenceId: "ios-1", profileId: "fixture-video-inline-v1", deviceId: "mobile-chromium-emulated", capturedAt: at(9), pageUrl: "https://publisher.example/articles/one", platform: "ios", browser: "safari", consent: "granted", autoplayMode: "muted", playbackAfterTap: true, blockEvents: [], artifactRefs: ["qa://capture/ios-1"] }, "fixture-video-inline-v1");
  assert.equal(valid.capture.data.kind, "real_device_evidence");
  assert.throws(() => parseRealDeviceEvidence({ ...valid.capture.data, schemaVersion: 1, evidenceId: "bad", profileId: "fixture-video-inline-v1", deviceId: valid.deviceId, capturedAt: at(9), platform: "ios", browser: "chromium", pageUrl: "https://publisher.example" }, "fixture-video-inline-v1"), /iOS and Safari/);
});

test("three-article lifecycle validation runs independently for desktop and mobile profiles", async () => {
  const articleRaw = JSON.parse(await readFile("config/article-policy.json", "utf8")); articleRaw.status = "confirmed";
  const eventRaw = JSON.parse(await readFile("config/event-rules.json", "utf8")); eventRaw.status = "confirmed";
  const articlePolicy = parseArticlePolicy(articleRaw);
  const eventPolicy = parseEventRulePolicy(eventRaw);
  const epochs = ["one", "two", "three"].map((name, sequence) => parseArticleEpoch({ schemaVersion: 1, articleEpochId: `article-${sequence + 1}`, runId: "run-matrix", sequence, url: `https://publisher.example/articles/${name}`, startedAt: at(sequence * 100), endedAt: at(sequence * 100 + 99) }));
  for (const deviceId of ["desktop-chromium", "mobile-chromium-emulated"]) {
    const events = epochs.flatMap((epoch, index) => ["loaded", "pageview", "website_pageview"].map((name, offset) => parseEvidence({ schemaVersion: 1, evidenceId: `${deviceId}-${index}-${name}`, runId: "run-matrix", articleEpochId: epoch.articleEpochId, deviceId, source: "browser_logger", capturedAt: at(index * 100 + offset), data: { kind: "logger_request", canonicalEvent: name, pageUrlStrictMatch: true, displayedUrlAtRequestStart: epoch.url, fields: { event: name, tagName: "v-example-site", domainName: "publisher.example", page_url: epoch.url, dep: "dependencies_fixture_1" } } })));
    const checks = validateArticles({ evidence: events, articleEpochs: epochs, articlePolicy, eventPolicy, deviceId, activeTags: ["v-example-site"], expectedDomainName: "publisher.example", captureComplete: true });
    assert.equal(checks.find((check) => check.testCaseId === "TC-23")?.verdict, "PASS", deviceId);
  }
});
