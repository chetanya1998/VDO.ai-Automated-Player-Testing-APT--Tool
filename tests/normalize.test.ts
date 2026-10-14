import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { BrowserCaptureResult, CapturedBrowserEvidence } from "../src/browser/capture.js";
import { createQueuedRun, parseArticleEpoch } from "../src/contracts.js";
import { normalizeEvidence } from "../src/evidence/normalize.js";
import { parseEventAliasProfile } from "../src/logger/browser-payload.js";

const profile = JSON.parse(await readFile("config/profiles/fixture-video-inline-v1.json", "utf8"));
const aliases = parseEventAliasProfile(JSON.parse(await readFile("config/event-aliases.json", "utf8")));
const run = createQueuedRun({
  runId: "run-normalize-1",
  profileId: "fixture-video-inline-v1",
  targetUrl: "https://publisher.example/articles/one",
  deviceId: "desktop-chromium",
  createdAt: "2026-10-13T00:00:00.000Z",
});
const articleEpochs = [
  parseArticleEpoch({
    schemaVersion: 1,
    articleEpochId: "article-one",
    runId: run.runId,
    sequence: 0,
    url: "https://publisher.example/articles/one",
    startedAt: "2026-10-13T00:00:00.000Z",
    endedAt: "2026-10-13T00:00:00.050Z",
  }),
  parseArticleEpoch({
    schemaVersion: 1,
    articleEpochId: "article-two",
    runId: run.runId,
    sequence: 1,
    url: "https://publisher.example/articles/two",
    startedAt: "2026-10-13T00:00:00.051Z",
  }),
];

function captured(evidenceId: string, source: CapturedBrowserEvidence["source"], capturedAt: string, data: CapturedBrowserEvidence["data"]): CapturedBrowserEvidence {
  return { evidenceId, source, capturedAt, data };
}

const capture: BrowserCaptureResult = {
  complete: false,
  gaps: [{ code: "service_worker_visibility", detail: "service worker traffic may be incomplete", evidenceId: null }],
  evidence: [
    captured("network-late", "browser_network", "2026-10-13T00:00:00.020Z", {
      kind: "request",
      url: "https://publisher.example/logger.php",
      requestStartPageUrl: "https://publisher.example/articles/one",
      startedMs: 20,
      durationMs: 30,
      outcome: "http_success",
    }),
    captured("logger-late", "browser_logger", "2026-10-13T00:00:00.021Z", {
      kind: "logger_request",
      networkEvidenceId: "network-late",
      requestStartPageUrl: "https://publisher.example/articles/one",
      parseState: "malformed",
      fields: {},
    }),
    captured("network-early", "browser_network", "2026-10-13T00:00:00.010Z", {
      kind: "request",
      url: "https://publisher.example/logger.php",
      requestStartPageUrl: "https://publisher.example/articles/one",
      startedMs: 10,
      durationMs: 12,
      outcome: "http_success",
    }),
    captured("logger-early", "browser_logger", "2026-10-13T00:00:00.011Z", {
      kind: "logger_request",
      networkEvidenceId: "network-early",
      requestStartPageUrl: "https://publisher.example/articles/one",
      parseState: "allowlisted",
      fields: {
        event: "Pageview",
        tagName: "v-example-site",
        domainName: "publisher.example",
        page_url: "https://publisher.example/articles/one",
        dep: "dependencies_fixture_1",
      },
    }),
    captured("dom-two", "browser_dom", "2026-10-13T00:00:00.100Z", {
      kind: "page_snapshot",
      pageUrl: "https://publisher.example/articles/two",
      frames: [],
      players: [
        { id: "v-one", tag: "div", visible: true },
        { id: "v-two", tag: "div", visible: true },
      ],
    }),
  ],
};

test("normalization preserves duplicates, timing, source, article scope, and separate players", () => {
  const result = normalizeEvidence({ run, capture, articleEpochs, profile, eventAliases: aliases, physicalLoadId: "load-1" });

  assert.deepEqual(result.loggerTimelineEvidenceIds, ["logger-early", "logger-late"]);
  assert.equal(result.evidence.filter((item) => item.source === "browser_network").length, 2);
  const logger = result.evidence.find((item) => item.evidenceId === "logger-early");
  assert.equal(logger?.capturedAt, "2026-10-13T00:00:00.011Z");
  assert.equal(logger?.data.observationTime, "2026-10-13T00:00:00.011Z");
  assert.equal(logger?.data.eventTime, "2026-10-13T00:00:00.010Z");
  assert.equal(logger?.data.requestStartedMs, 10);
  assert.equal(logger?.data.requestDurationMs, 12);
  assert.equal(logger?.data.requestOutcome, "http_success");
  assert.equal(logger?.data.rawEvent, "Pageview");
  assert.equal(logger?.data.canonicalEvent, "pageview");
  assert.equal(logger?.data.sessionId, null);
  assert.equal(logger?.data.playerKey, "tag:v-example-site");
  assert.equal(logger?.articleEpochId, "article-one");

  const players = result.evidence.filter((item) => item.evidenceId.startsWith("dom-two:player:"));
  assert.deepEqual(players.map((item) => item.data.playerKey), ["dom:v-one:1", "dom:v-two:2"]);
  assert.ok(players.every((item) => item.articleEpochId === "article-two"));
  assert.ok(players.every((item) => item.data.rawArtifactRef === "dom-two"));
});

test("mixed malformed evidence remains valid and produces explicit coverage errors", () => {
  const result = normalizeEvidence({ run, capture, articleEpochs, profile, eventAliases: aliases, physicalLoadId: "load-1" });
  assert.ok(result.evidence.some((item) => item.evidenceId === "logger-late"));
  assert.ok(result.coverageErrors.some((item) => item.code === "logger_payload" && item.evidenceId === "logger-late"));
  assert.ok(result.coverageErrors.some((item) => item.code === "capture_gap"));
  assert.ok(result.coverageErrors.some((item) => item.code === "unsupported_capability" && /backendLogger/.test(item.detail)));
  assert.ok(result.coverageErrors.some((item) => item.code === "unsupported_capability" && /aiExplanation/.test(item.detail)));
});

test("normalization and profile snapshots are deterministic for a recorded capture", () => {
  const input = { run, capture, articleEpochs, profile, eventAliases: aliases, physicalLoadId: "load-1" } as const;
  const first = normalizeEvidence(input);
  const second = normalizeEvidence(JSON.parse(JSON.stringify(input)));
  assert.equal(first.profileSnapshot.profileHash, second.profileSnapshot.profileHash);
  assert.deepEqual(first, second);
});
