import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseEvidence, type CheckResult, type Evidence } from "../src/contracts.js";
import { applyAuctionContext, parseAuctionPolicy, validateAuction, type AuctionPolicy } from "../src/rules/auction.js";
import { parseDemandPolicy, type DemandPolicy } from "../src/rules/demand.js";

async function policies(): Promise<{ auction: AuctionPolicy; demand: DemandPolicy }> {
  const auctionRaw = JSON.parse(await readFile("config/auction-rules.json", "utf8"));
  const demandRaw = JSON.parse(await readFile("config/demand-policy.json", "utf8"));
  auctionRaw.status = "confirmed";
  demandRaw.status = "confirmed";
  return { auction: parseAuctionPolicy(auctionRaw), demand: parseDemandPolicy(demandRaw) };
}

function request(id: string, provider: "prebid" | "reseller" | "gam", startedMs: number, durationMs = 20, outcome: "valid" | "empty" = "valid"): Evidence {
  const details = provider === "prebid"
    ? { path: "/openrtb2/auction", body: outcome === "empty" ? { bids: [] } : { bids: [{ price: 1 }] } }
    : provider === "reseller"
      ? { path: "/reseller", body: outcome === "empty" ? { noFill: true } : { ad: { creative: "ok" } } }
      : { path: "/mock-demand", body: outcome === "empty" ? { matched: false } : { matched: true } };
  return parseEvidence({
    schemaVersion: 1,
    evidenceId: id,
    runId: "run-recorded",
    articleEpochId: "article-recorded",
    deviceId: "desktop-chromium",
    source: "browser_network",
    capturedAt: "2026-10-15T00:00:00.000Z",
    data: { kind: "request", url: `https://ads.example${details.path}`, startedMs, durationMs, outcome: "http_success", status: 200, responseBody: { state: "captured", contentType: "application/json", text: JSON.stringify(details.body) } },
  });
}

function validate(auction: AuctionPolicy, demand: DemandPolicy, evidence: Evidence[]) {
  return validateAuction({ evidence, policy: auction, demandPolicy: demand, profileId: auction.profileId, product: "video", deviceId: "desktop-chromium", articleEpochId: "article-recorded", captureComplete: true });
}

test("valid parallel bidding waits for all bidders before the dependent ad-server stage", async () => {
  const { auction, demand } = await policies();
  const result = validate(auction, demand, [request("prebid", "prebid", 0), request("reseller", "reseller", 10), request("gam", "gam", 30)]);
  assert.equal(result.verdict, "PASS");
  assert.deepEqual(result.evidenceIds, ["prebid", "reseller", "gam"]);
});

test("a configured waterfall permits serial provider requests", async () => {
  const { auction, demand } = await policies();
  auction.products[0]!.stages = [{ id: "waterfall", mode: "waterfall", providers: ["prebid", "reseller", "gam"], dependsOn: [], timeoutMs: 100 }];
  const result = validate(auction, demand, [request("prebid", "prebid", 0), request("reseller", "reseller", 20), request("gam", "gam", 40)]);
  assert.equal(result.verdict, "PASS");
});

test("a configured required fallback runs after a no-bid response", async () => {
  const { auction, demand } = await policies();
  auction.products[0]!.stages = [{ id: "primary", mode: "waterfall", providers: ["prebid"], dependsOn: [], timeoutMs: 100 }];
  auction.products[0]!.fallbacks = [{ fromProvider: "prebid", toProvider: "gam", on: ["no_bid", "failed", "timeout"], required: true, maxDelayMs: 50 }];
  const result = validate(auction, demand, [request("prebid", "prebid", 0, 20, "empty"), request("gam", "gam", 20)]);
  assert.equal(result.verdict, "PASS");
});

test("a missing required fallback fails with the source evidence and config version", async () => {
  const { auction, demand } = await policies();
  auction.products[0]!.stages = [{ id: "primary", mode: "waterfall", providers: ["prebid"], dependsOn: [], timeoutMs: 100 }];
  auction.products[0]!.fallbacks = [{ fromProvider: "prebid", toProvider: "gam", on: ["no_bid"], required: true, maxDelayMs: 50 }];
  const result = validate(auction, demand, [request("prebid", "prebid", 0, 20, "empty")]);
  assert.equal(result.verdict, "FAIL");
  assert.match(JSON.stringify(result.observed), /missing_required_fallback/);
  assert.match(JSON.stringify(result.observed), /"configVersion":1/);
  assert.deepEqual(result.evidenceIds, ["prebid"]);
});

test("a dependent request that starts before parallel bidders settle fails", async () => {
  const { auction, demand } = await policies();
  const result = validate(auction, demand, [request("prebid", "prebid", 0, 30), request("reseller", "reseller", 5, 30), request("gam", "gam", 20)]);
  assert.equal(result.verdict, "FAIL");
  assert.match(JSON.stringify(result.observed), /premature_request/);
  assert.ok(result.evidenceIds.includes("gam"));
});

test("stage timeout releases a dependent request and records the timeout outcome", async () => {
  const { auction, demand } = await policies();
  auction.products[0]!.stages[0]!.timeoutMs = 100;
  const result = validate(auction, demand, [request("prebid", "prebid", 0, 500), request("reseller", "reseller", 0, 20), request("gam", "gam", 100)]);
  assert.equal(result.verdict, "PASS");
  assert.match(JSON.stringify(result.observed), /"outcome":"timeout"/);
});

test("refresh creates a new cycle and enforces its configured minimum gap", async () => {
  const { auction, demand } = await policies();
  auction.products[0]!.refreshMinimumGapMs = 1000;
  const result = validate(auction, demand, [
    request("prebid-1", "prebid", 0), request("reseller-1", "reseller", 0), request("gam-1", "gam", 20),
    request("prebid-2", "prebid", 500), request("reseller-2", "reseller", 500), request("gam-2", "gam", 520),
  ]);
  assert.equal(result.verdict, "FAIL");
  assert.match(JSON.stringify(result.observed), /refresh_too_early/);
  assert.match(JSON.stringify(result.observed), /"cycle":2/);
});

test("unknown product configuration remains UNKNOWN", async () => {
  const { auction, demand } = await policies();
  auction.products[0]!.product = "banner";
  const result = validate(auction, demand, [request("prebid", "prebid", 0)]);
  assert.equal(result.verdict, "UNKNOWN");
  assert.equal(result.category, "TOOLING");
  assert.match(JSON.stringify(result.observed), /auction_configuration_unknown/);
});

test("captured auction traffic without the configured cycle start is a cited violation", async () => {
  const { auction, demand } = await policies();
  const result = validate(auction, demand, [request("gam", "gam", 0)]);
  assert.equal(result.verdict, "FAIL");
  assert.match(JSON.stringify(result.observed), /cycle_start_missing/);
  assert.deepEqual(result.evidenceIds, ["gam"]);
});

test("auction failure enriches TC-10 without replacing its demand evidence", async () => {
  const { auction, demand } = await policies();
  const result = validate(auction, demand, [request("prebid", "prebid", 0, 30), request("reseller", "reseller", 0, 30), request("gam", "gam", 10)]);
  const tc10: CheckResult = { testCaseId: "TC-10", verdict: "PASS", category: "NONE", scope: { deviceId: "desktop-chromium", articleEpochId: "article-recorded", tagName: "v-example-site" }, expected: { demand: true }, observed: { firstFailure: null }, evidenceIds: ["event-chain"] };
  const combined = applyAuctionContext(tc10, result);
  assert.equal(combined.verdict, "FAIL");
  assert.deepEqual(combined.evidenceIds, ["event-chain", "prebid", "reseller", "gam"]);
  assert.match(JSON.stringify(combined.expected), /fixture-auction-v1/);
});
