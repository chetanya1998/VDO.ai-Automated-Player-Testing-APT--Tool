import assert from "node:assert/strict";
import test from "node:test";
import type { Page, Request, Response } from "playwright-core";
import { BrowserCapture } from "../src/browser/capture.js";

type Listener = (...args: never[]) => void;

function fakePage(url = "http://127.0.0.1/scenario"): {
  page: Page;
  emit(name: string, value: unknown): void;
} {
  const listeners = new Map<string, Listener[]>();
  const page = {
    on(name: string, listener: Listener) {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
      return page;
    },
    url: () => url,
    title: async () => "Fixture player",
    frames: () => [{ name: () => "main", url: () => url }],
    evaluate: async () => ({
      anchors: [{ id: "v-player", tag: "video", parentLandmark: "main", placement: "body_content" }],
      externalScripts: [],
      bootstrapScripts: [],
      mutations: [],
      players: [{ tag: "video", id: "v-player", playerState: "ready", width: 640, height: 360, visible: true }],
    }),
    screenshot: async () => Buffer.from("fixture-screenshot"),
  } as unknown as Page;
  return {
    page,
    emit(name, value) {
      for (const listener of listeners.get(name) ?? []) listener(value as never);
    },
  };
}

function fakeRequest(options: {
  url: string;
  method?: string;
  resourceType?: string;
  contentType?: string;
  body?: string | null;
  failure?: string;
}): Request {
  return {
    url: () => options.url,
    method: () => options.method ?? "GET",
    resourceType: () => options.resourceType ?? "script",
    headers: () => options.contentType === undefined ? {} : { "content-type": options.contentType },
    postData: () => options.body ?? null,
    frame: () => ({ url: () => "http://127.0.0.1/scenario" }),
    redirectedFrom: () => null,
    failure: () => options.failure === undefined ? null : { errorText: options.failure },
  } as unknown as Request;
}

function fakeResponse(request: Request, options: {
  status: number;
  statusText?: string;
  contentType?: string;
  body?: string;
}): Response {
  const body = options.body ?? "";
  return {
    request: () => request,
    status: () => options.status,
    statusText: () => options.statusText ?? String(options.status),
    headers: () => ({
      "content-type": options.contentType ?? "application/json",
      "content-length": String(Buffer.byteLength(body)),
    }),
    finished: async () => null,
    body: async () => Buffer.from(body),
  } as unknown as Response;
}

function harness(limits: ConstructorParameters<typeof BrowserCapture>[0]["limits"] = {}) {
  let elapsedMs = 0;
  const fixture = fakePage();
  const capture = new BrowserCapture({
    startedAt: new Date("2026-10-13T00:00:00.000Z"),
    elapsedMs: () => elapsedMs,
    limits,
  });
  capture.attach(fixture.page);
  return {
    ...fixture,
    capture,
    advance(milliseconds: number) { elapsedMs += milliseconds; },
  };
}

test("logger capture keeps duplicate requests separate and persists only allowlisted fields", async () => {
  const run = harness();
  const requests = [1, 2].map(() => fakeRequest({
    url: "http://127.0.0.1/logger.php?token=private-query-value",
    method: "POST",
    resourceType: "xhr",
    contentType: "application/json",
    body: JSON.stringify({
      event: "player_loaded",
      tagName: "video",
      domainName: "fixture.local",
      page_url: "http://127.0.0.1/scenario?session=private-session-value",
      dep: "vdo.ai.js",
      authorization: "Bearer SECRET_SENTINEL",
      cookie: "session=SECRET_SENTINEL",
      extra: "SECRET_SENTINEL",
    }),
  }));

  for (const request of requests) {
    run.emit("request", request);
    run.advance(12);
    run.emit("response", fakeResponse(request, {
      status: 200,
      body: JSON.stringify({ accepted: true, token: "private-response-value", note: "SECRET_SENTINEL" }),
    }));
  }
  const result = await run.capture.finalize();
  const network = result.evidence.filter((item) => item.source === "browser_network");
  const logger = result.evidence.filter((item) => item.source === "browser_logger");

  assert.equal(network.length, 2);
  assert.notEqual(network[0]?.evidenceId, network[1]?.evidenceId);
  assert.equal(logger.length, 2);
  assert.deepEqual(Object.keys(logger[0]?.data.fields as object).sort(), ["dep", "domainName", "event", "page_url", "tagName"]);
  assert.equal(network[0]?.data.outcome, "http_success");
  assert.doesNotMatch(JSON.stringify(result), /SECRET_SENTINEL|private-query-value|private-session-value|private-response-value|authorization|cookie|extra/);
});

test("network capture separates HTTP failures from transport failures", async () => {
  const run = harness();
  const missing = fakeRequest({ url: "http://127.0.0.1/vdo.player.js" });
  const blocked = fakeRequest({ url: "http://127.0.0.1/prebid.js", failure: "net::ERR_BLOCKED_BY_CLIENT" });

  run.emit("request", missing);
  run.advance(25);
  run.emit("response", fakeResponse(missing, { status: 503, statusText: "Service Unavailable", body: "failure" }));
  run.emit("request", blocked);
  run.advance(9);
  run.emit("requestfailed", blocked);

  const result = await run.capture.finalize();
  const network = result.evidence.filter((item) => item.source === "browser_network");
  assert.equal(network[0]?.data.outcome, "http_failure");
  assert.equal(network[0]?.data.status, 503);
  assert.equal(network[1]?.data.outcome, "transport_failure");
  assert.equal(network[1]?.data.failure, "net::ERR_BLOCKED_BY_CLIENT");
  assert.equal(network[1]?.data.durationMs, 9);
});

test("unfinished traffic and service-worker visibility are explicit collection gaps", async () => {
  const run = harness();
  const unfinished = fakeRequest({ url: "http://127.0.0.1/analytics.js" });
  run.emit("request", unfinished);
  run.advance(40);

  const result = await run.capture.finalize();
  const network = result.evidence.find((item) => item.source === "browser_network");
  assert.equal(result.complete, false);
  assert.equal(network?.data.outcome, "incomplete");
  assert.equal(network?.data.durationMs, 40);
  assert.ok(result.gaps.some((gap) => gap.code === "request_incomplete" && gap.evidenceId === network?.evidenceId));
  assert.ok(result.gaps.some((gap) => gap.code === "service_worker_visibility" && /remain enabled/.test(gap.detail)));
});

test("page evidence is bounded and oversized screenshots become a visible gap", async () => {
  const run = harness({ maxScreenshotBytes: 4 });
  await run.capture.capturePage(run.page);
  const result = await run.capture.finalize();

  assert.ok(result.evidence.some((item) => item.source === "browser_dom"));
  assert.equal(result.evidence.some((item) => item.source === "screenshot"), false);
  assert.ok(result.gaps.some((gap) => gap.code === "screenshot_too_large"));
});
