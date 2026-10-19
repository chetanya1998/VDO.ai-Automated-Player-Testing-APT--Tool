import assert from "node:assert/strict";
import test from "node:test";
import { parseEvidence, type Evidence } from "../src/contracts.js";
import { correlateBackendLogger, type CorrelationPolicy } from "../src/evidence/correlate.js";
import type { BackendLoggerRecord } from "../src/logger/backend-normalize.js";

const mappings: CorrelationPolicy["mappings"] = [
  { idType: "pageview", browserDataKey: "sharedPageviewId", backendIdentifier: "pageviewId" },
  { idType: "player", browserDataKey: "sharedPlayerId", backendIdentifier: "playerId" },
  { idType: "auction", browserDataKey: "sharedAuctionId", backendIdentifier: "auctionId" },
  { idType: "request", browserDataKey: "sharedRequestId", backendIdentifier: "requestId" },
];

function policy(overrides: Partial<CorrelationPolicy> = {}): CorrelationPolicy {
  return { schemaVersion: 1, policyId: "backend-correlation-v1", status: "confirmed", displayClockSkewMs: 0, mappings, ...overrides };
}

function browser(evidenceId: string, capturedAt: string, identifiers: Record<string, string>): Evidence {
  return parseEvidence({
    schemaVersion: 1,
    evidenceId,
    runId: "run-correlation",
    articleEpochId: evidenceId.startsWith("page-one") ? "article-one" : "article-two",
    deviceId: "desktop-chromium",
    source: "browser_logger",
    capturedAt,
    data: { pageUrl: "https://publisher.example/same-url", ...identifiers },
  });
}

function backend(recordId: string, receivedAt: string, identifiers: BackendLoggerRecord["identifiers"]): BackendLoggerRecord {
  return {
    recordId,
    receivedAt,
    fields: { event: "bid_request", tagName: "v-site", domainName: "publisher.example", page_url: "https://publisher.example/same-url", dep: "dependencies_1" },
    identifiers,
  };
}

test("verified IDs correlate same-URL pageviews, players and concurrent auctions despite out-of-order logs", () => {
  const browserEvidence = [
    browser("page-one-request", "2026-10-19T10:00:09.000Z", { sharedPageviewId: "pv-1", sharedPlayerId: "player-1", sharedAuctionId: "auction-1", sharedRequestId: "request-1" }),
    browser("page-two-request", "2026-10-19T10:00:01.000Z", { sharedPageviewId: "pv-2", sharedPlayerId: "player-2", sharedAuctionId: "auction-2", sharedRequestId: "request-2" }),
  ];
  const backendRecords = [
    backend("server-two", "2026-10-19T10:00:02.000Z", { pageviewId: "pv-2", playerId: "player-2", auctionId: "auction-2", requestId: "request-2" }),
    backend("server-one", "2026-10-19T10:00:10.000Z", { pageviewId: "pv-1", playerId: "player-1", auctionId: "auction-1", requestId: "request-1" }),
  ];

  const result = correlateBackendLogger({ policy: policy({ displayClockSkewMs: 250 }), backendStatus: "complete", browserEvidence, backendRecords });
  assert.deepEqual(result.joins.map((join) => [join.browserEvidenceIds[0], join.backendRecordIds[0]]), [
    ["page-one-request", "server-one"],
    ["page-two-request", "server-two"],
  ]);
  assert.deepEqual(result.joins[0]?.matchedKeys.map((item) => item.idType), ["pageview", "player", "auction", "request"]);
  assert.ok(result.joins[0]?.matchedKeys.every((item) => item.fingerprint.startsWith("sha256:")));
  assert.deepEqual(result.coverage, { exact: 2, ambiguous: 0, unmatchedBrowser: 0, unmatchedBackend: 0, highConfidenceBackendRcaAllowed: true, limitation: null });
  assert.equal(result.backendEvidence[0]?.articleEpochId, "article-one");
  assert.equal((result.backendEvidence[0]?.data.timing as Record<string, unknown>).displayAdjustedDeltaMs, 750);
  assert.doesNotMatch(JSON.stringify(result), /pv-1|player-1|auction-1|request-1/);

  const differentClock = correlateBackendLogger({ policy: policy({ displayClockSkewMs: -86_400_000 }), backendStatus: "complete", browserEvidence, backendRecords });
  assert.deepEqual(differentClock.joins, result.joins, "clock skew must not affect identity matching");
});

test("repeated shared IDs are ambiguous and never cross-join", () => {
  const result = correlateBackendLogger({
    policy: policy(),
    backendStatus: "complete",
    browserEvidence: [
      browser("page-one-a", "2026-10-19T10:00:00.000Z", { sharedRequestId: "reused" }),
      browser("page-one-b", "2026-10-19T10:00:00.001Z", { sharedRequestId: "reused" }),
    ],
    backendRecords: [backend("server-a", "2026-10-19T10:00:00.003Z", { requestId: "reused" })],
  });
  assert.equal(result.coverage.ambiguous, 2);
  assert.equal(result.coverage.highConfidenceBackendRcaAllowed, false);
  assert.equal(result.backendEvidence.length, 0);
  assert.ok(result.joins.every((join) => join.reason === "repeated_identifier"));
});

test("conflicting and missing identifiers remain unresolved", () => {
  const conflict = correlateBackendLogger({
    policy: policy(),
    backendStatus: "complete",
    browserEvidence: [browser("page-one-conflict", "2026-10-19T10:00:00.000Z", { sharedPlayerId: "browser-player", sharedRequestId: "same-request" })],
    backendRecords: [backend("server-conflict", "2026-10-19T10:00:00.001Z", { playerId: "server-player", requestId: "same-request" })],
  });
  assert.equal(conflict.joins[0]?.state, "ambiguous");
  assert.equal(conflict.joins[0]?.reason, "conflicting_identifiers");
  assert.equal(conflict.coverage.highConfidenceBackendRcaAllowed, false);

  const missing = correlateBackendLogger({
    policy: policy(),
    backendStatus: "complete",
    browserEvidence: [browser("page-one-missing", "2026-10-19T10:00:00.000Z", {})],
    backendRecords: [backend("server-missing", "2026-10-19T10:00:00.001Z", {})],
  });
  assert.deepEqual(missing.joins.map((join) => join.reason), ["missing_browser_identifier", "missing_backend_identifier"]);
  assert.deepEqual({ browser: missing.coverage.unmatchedBrowser, backend: missing.coverage.unmatchedBackend }, { browser: 1, backend: 1 });
});

test("unconfirmed policy and incomplete collection block backend RCA even when keys match", () => {
  const browserEvidence = [browser("page-one-only", "2026-10-19T10:00:00.000Z", { sharedRequestId: "request" })];
  const backendRecords = [backend("server-only", "2026-10-19T10:00:00.001Z", { requestId: "request" })];
  const draft = correlateBackendLogger({ policy: policy({ status: "draft" }), backendStatus: "complete", browserEvidence, backendRecords });
  assert.equal(draft.coverage.exact, 0);
  assert.equal(draft.coverage.highConfidenceBackendRcaAllowed, false);
  assert.match(draft.coverage.limitation ?? "", /unconfirmed/);

  const incomplete = correlateBackendLogger({ policy: policy(), backendStatus: "incomplete", browserEvidence, backendRecords });
  assert.equal(incomplete.coverage.exact, 1);
  assert.equal(incomplete.coverage.highConfidenceBackendRcaAllowed, false);
  assert.match(incomplete.coverage.limitation ?? "", /incomplete/);
});

test("correlation rejects duplicate identities and non-network browser evidence", () => {
  const item = browser("duplicate", "2026-10-19T10:00:00.000Z", { sharedRequestId: "request" });
  assert.throws(() => correlateBackendLogger({ policy: policy(), backendStatus: "complete", browserEvidence: [item, item], backendRecords: [] }), /browser evidence IDs must be unique/);
  assert.throws(() => correlateBackendLogger({ policy: policy(), backendStatus: "complete", browserEvidence: [{ ...item, source: "backend_logger" }], backendRecords: [] }), /browser evidence must come from/);
});
