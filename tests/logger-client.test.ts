import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";
import { collectBackendLogger } from "../src/logger/client.js";

const from = "2026-10-19T10:00:00.000Z";
const until = "2026-10-19T10:00:10.000Z";
const token = "scoped-backend-token-00000000";

function page(records: unknown[], completeThrough: string | null, nextCursor: string | null = null) {
  return {
    schemaVersion: 1,
    records,
    nextCursor,
    watermark: { observedAt: "2026-10-19T10:00:11.000Z", completeThrough, lagMs: completeThrough === null ? 250 : 0 },
  };
}

function record(recordId: string, event: string) {
  return {
    recordId,
    receivedAt: "2026-10-19T10:00:05.000Z",
    fields: { event, tagName: "v-site", domainName: "publisher.example", page_url: "https://publisher.example/article", dep: "dependencies_1", secret: "SERVER_SECRET" },
    identifiers: { requestId: `request-${recordId}`, unsupportedSecretId: "SECRET_ID" },
  };
}

async function service(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("contract service did not bind");
  return {
    endpoint: `http://127.0.0.1:${address.port}/logger-records`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function options(endpoint: string, deadlineMs = 500) {
  return {
    endpoint,
    bearerToken: token,
    from,
    until,
    deadlineAt: new Date(Date.now() + deadlineMs).toISOString(),
    pageSize: 1,
    pollIntervalMs: 5,
    requestTimeoutMs: 100,
  };
}

test("real HTTP logger contract applies scoped auth and cursor pagination", async (suite) => {
  const requests: URL[] = [];
  const server = await service((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push(url);
    const body = url.searchParams.get("cursor") === null
      ? page([record("one", "loaded")], null, "second-page")
      : page([record("two", "pageview")], until);
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  suite.after(() => server.stop());

  const result = await collectBackendLogger(options(server.endpoint));
  assert.equal(result.status, "complete");
  assert.equal(result.reason, "watermark_complete");
  assert.equal(result.requests, 2);
  assert.equal(result.pages, 2);
  assert.deepEqual(result.records.map((item) => item.recordId), ["one", "two"]);
  assert.deepEqual(result.records[0]?.identifiers, { requestId: "request-one" });
  assert.equal(requests[0]?.searchParams.get("from"), from);
  assert.equal(requests[0]?.searchParams.get("until"), until);
  assert.equal(requests[1]?.searchParams.get("cursor"), "second-page");
  assert.doesNotMatch(JSON.stringify(result), /scoped-backend-token|SERVER_SECRET|SECRET_ID|unsupportedSecretId/);
});

test("unauthorized and complete-empty logger results remain distinct", async (suite) => {
  const unauthorized = await service((_request, response) => response.writeHead(401).end());
  const empty = await service((_request, response) => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(page([], until))));
  suite.after(async () => { await unauthorized.stop(); await empty.stop(); });

  const denied = await collectBackendLogger(options(unauthorized.endpoint));
  assert.deepEqual({ status: denied.status, reason: denied.reason, records: denied.records }, { status: "unavailable", reason: "unauthorized", records: [] });
  const complete = await collectBackendLogger(options(empty.endpoint));
  assert.deepEqual({ status: complete.status, reason: complete.reason, records: complete.records }, { status: "complete", reason: "watermark_complete", records: [] });
});

test("rate limits and ingestion lag retain late records before the deadline", async (suite) => {
  let requestCount = 0;
  const server = await service((_request, response) => {
    requestCount += 1;
    if (requestCount === 1) { response.writeHead(429, { "retry-after": "0" }).end(); return; }
    const body = requestCount === 2 ? page([], null) : page([record("late", "video_start")], until);
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  suite.after(() => server.stop());

  const result = await collectBackendLogger(options(server.endpoint));
  assert.equal(result.status, "complete");
  assert.equal(result.requests, 3);
  assert.deepEqual(result.records.map((item) => item.recordId), ["late"]);
  assert.equal(result.watermark?.lagMs, 0);
});

test("polling stops at the run deadline and preserves incomplete metadata", async (suite) => {
  const server = await service((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"schemaVersion":');
    setTimeout(() => response.end("1}"), 100);
  });
  suite.after(() => server.stop());

  const started = Date.now();
  const result = await collectBackendLogger(options(server.endpoint, 40));
  assert.equal(result.status, "incomplete");
  assert.equal(result.reason, "deadline_exceeded");
  assert.ok(result.requests >= 1);
  assert.ok(Date.now() - started < 300, "collector exceeded its bounded deadline");
  assert.equal(result.watermark, null);
});

test("caller limits cannot expand collection beyond fixed safety caps", async () => {
  await assert.rejects(collectBackendLogger({ ...options("http://127.0.0.1:1/logger"), pageSize: 1_001 }), /pageSize must not exceed 1000/);
  await assert.rejects(collectBackendLogger({ ...options("http://127.0.0.1:1/logger"), maxRecords: 100_001 }), /maxRecords must not exceed 100000/);
});
