import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseEvidence, type CheckResult, type Evidence } from "../src/contracts.js";
import { parseDemandResponse, type DemandFormat } from "../src/demand/parse.js";
import { applyDemandContext, parseDemandPolicy, validateDemand, type DemandPolicy } from "../src/rules/demand.js";

const chain = ["ad_request", "ad_match", "video_loaded", "video_start", "viewable_impression"];

async function policy(): Promise<DemandPolicy> {
  const raw = JSON.parse(await readFile("config/demand-policy.json", "utf8"));
  raw.status = "confirmed";
  return parseDemandPolicy(raw);
}

function evidence(id: string, source: Evidence["source"], data: Evidence["data"]): Evidence {
  return parseEvidence({ schemaVersion: 1, evidenceId: id, runId: "run-recorded", articleEpochId: "article-recorded", deviceId: "desktop-chromium", source, capturedAt: "2026-10-14T00:00:00.000Z", data });
}

function logger(name: string, index: number): Evidence {
  return evidence(`event-${index}`, "browser_logger", { kind: "logger_request", fields: { event: name, tagName: "v-example-site" }, rawEvent: name, canonicalEvent: name, requestStartedMs: index });
}

function request(id: string, path: string, options: { outcome?: string; status?: number; durationMs?: number; body?: string; bodyState?: string; reason?: string; contentType?: string } = {}): Evidence {
  const bodyState = options.bodyState ?? "captured";
  return evidence(id, "browser_network", {
    kind: "request", url: `https://ads.example${path}`, startedMs: 10, durationMs: options.durationMs ?? 20,
    outcome: options.outcome ?? "http_success", status: options.status ?? 200,
    responseBody: bodyState === "captured"
      ? { state: "captured", contentType: options.contentType ?? "application/json", text: options.body ?? JSON.stringify({ matched: true }) }
      : { state: bodyState, reason: options.reason ?? "actual_size_limit" },
  });
}

function input(demandPolicy: DemandPolicy, items: Evidence[]) {
  return { evidence: items, policy: demandPolicy, profileId: demandPolicy.profileId, product: "video", deviceId: "desktop-chromium", articleEpochId: "article-recorded", tagName: "v-example-site", captureComplete: true };
}

function requireOnly(demandPolicy: DemandPolicy, id: string): void {
  for (const provider of demandPolicy.providers) provider.required = provider.id === id;
}

test("VAST, GAM, Prebid, and reseller adapters recognize their configured response shapes", async () => {
  const demandPolicy = await policy();
  const limits = demandPolicy.limits;
  const cases: Array<[DemandFormat, Evidence, string]> = [
    ["vast_xml", request("vast", "/vast", { contentType: "application/xml", body: '<VAST version="4.2"><Ad><InLine></InLine></Ad></VAST>' }), "valid_ad"],
    ["gam_json", request("gam", "/mock-demand", { body: '{"matched":true}' }), "valid_ad"],
    ["prebid_json", request("prebid", "/openrtb2/auction", { body: '{"bids":[]}' }), "no_bid"],
    ["reseller_json", request("reseller", "/reseller", { body: '{"ad":{"creative":"ok"}}' }), "valid_ad"],
  ];
  for (const [format, item, expected] of cases) assert.equal(parseDemandResponse(item, format, limits).state, expected, format);
  const entity = request("entity", "/vast", { contentType: "application/xml", body: '<!DOCTYPE VAST [<!ENTITY x SYSTEM "file:///etc/passwd">]><VAST version="4.2"><Ad>&x;</Ad></VAST>' });
  assert.equal(parseDemandResponse(entity, "vast_xml", limits).state, "unsupported");
  const deep = request("deep", "/vast", { contentType: "application/xml", body: '<VAST version="4.2"><Ad><Wrapper><One><Two></Two></One></Wrapper></Ad></VAST>' });
  assert.equal(parseDemandResponse(deep, "vast_xml", { ...limits, maxXmlDepth: 3 }).state, "unsupported");
  const oversized = request("large", "/vast", { contentType: "application/xml", body: '<VAST version="4.2"><Ad></Ad></VAST>' });
  assert.equal(parseDemandResponse(oversized, "vast_xml", { ...limits, maxBodyBytes: 10 }).state, "truncated");
});

test("valid demand and the complete configured event chain pass TC-10", async () => {
  const demandPolicy = await policy();
  const result = validateDemand(input(demandPolicy, [request("gam", "/mock-demand"), ...chain.map(logger)]));
  assert.equal(result.check.verdict, "PASS");
  assert.equal(result.requiredInitiated, true);
});

test("no fill passes transport and becomes an INVESTIGATE Demand warning at Ad Match", async () => {
  const demandPolicy = await policy();
  const result = validateDemand(input(demandPolicy, [request("no-fill", "/mock-demand", { status: 204, bodyState: "omitted", reason: "no_body" }), logger("ad_request", 1), logger("video_start", 2)]));
  assert.equal(result.check.verdict, "WARNING");
  assert.equal(result.check.category, "INVESTIGATE_DEMAND");
  assert.equal(result.observations[0]?.transport, "pass");
  assert.equal(result.observations[0]?.state, "no_fill");
  assert.match(JSON.stringify(result.check.observed), /no_fill_or_no_bid/);
});

test("the first network failure survives a later valid response", async () => {
  const demandPolicy = await policy();
  const failed = request("failed", "/mock-demand", { outcome: "transport_failure", status: 0 });
  const recovered = request("recovered", "/mock-demand", { body: '{"matched":true}' });
  recovered.data.startedMs = 30;
  const result = validateDemand(input(demandPolicy, [failed, recovered, ...chain.map(logger)]));
  assert.equal(result.check.verdict, "FAIL");
  assert.equal(result.check.category, "RUNTIME_BROWSER");
  assert.match(JSON.stringify(result.check.observed), /transport_failure/);
});

test("malformed content and deadline violations fail while unsupported and truncated content stay unknown", async () => {
  const malformedPolicy = await policy();
  const malformed = validateDemand(input(malformedPolicy, [request("malformed", "/mock-demand", { body: "{broken" }), logger("ad_request", 1)]));
  assert.equal(malformed.check.verdict, "FAIL");
  assert.match(JSON.stringify(malformed.check.observed), /malformed_json/);

  const deadlinePolicy = await policy();
  const deadline = validateDemand(input(deadlinePolicy, [request("late", "/mock-demand", { durationMs: 3001 }), ...chain.map(logger)]));
  assert.equal(deadline.check.verdict, "FAIL");
  assert.match(JSON.stringify(deadline.check.observed), /deadline_exceeded/);

  const unsupportedPolicy = await policy();
  requireOnly(unsupportedPolicy, "vast");
  const unsupported = validateDemand(input(unsupportedPolicy, [request("old-vast", "/vast", { contentType: "application/xml", body: '<VAST version="2.0"><Ad><InLine></InLine></Ad></VAST>' }), logger("ad_request", 1)]));
  assert.equal(unsupported.check.verdict, "UNKNOWN");

  const truncatedPolicy = await policy();
  const truncated = validateDemand(input(truncatedPolicy, [request("truncated", "/mock-demand", { bodyState: "omitted", reason: "actual_size_limit" }), logger("ad_request", 1)]));
  assert.equal(truncated.check.verdict, "UNKNOWN");
  assert.match(JSON.stringify(truncated.check.observed), /truncated/);
});

test("captured VAST wrapper loops fail without fetching their URL", async () => {
  const demandPolicy = await policy();
  requireOnly(demandPolicy, "vast");
  const vast = '<VAST version="4.2"><Ad><Wrapper><VASTAdTagURI><![CDATA[https://ads.example/vast]]></VASTAdTagURI></Wrapper></Ad></VAST>';
  const result = validateDemand(input(demandPolicy, [request("loop", "/vast", { contentType: "application/xml", body: vast }), logger("ad_request", 1)]));
  assert.equal(result.check.verdict, "FAIL");
  assert.match(JSON.stringify(result.check.observed), /wrapper_loop/);
  assert.match(JSON.stringify(result.check.observed), /no wrapper URL fetching/);
});

test("a captured VAST wrapper chain cites both captured responses", async () => {
  const demandPolicy = await policy();
  requireOnly(demandPolicy, "vast");
  const root = '<VAST version="4.2"><Ad><Wrapper><VASTAdTagURI><![CDATA[https://ads.example/wrapped]]></VASTAdTagURI></Wrapper></Ad></VAST>';
  const inline = '<VAST version="4.2"><Ad><InLine></InLine></Ad></VAST>';
  const result = validateDemand(input(demandPolicy, [
    request("wrapper", "/vast", { contentType: "application/xml", body: root }),
    request("inline", "/wrapped", { contentType: "application/xml", body: inline }),
    ...chain.map(logger),
  ]));
  assert.equal(result.check.verdict, "PASS");
  assert.deepEqual(result.observations[0]?.wrapperEvidenceIds, ["wrapper", "inline"]);
  assert.ok(result.check.evidenceIds.includes("inline"));
});

test("missing required demand initiation updates TC-9 with captured evidence", async () => {
  const demandPolicy = await policy();
  const demand = validateDemand(input(demandPolicy, [logger("ad_request", 1), evidence("dom", "browser_dom", { kind: "page_snapshot", anchors: [] })]));
  const tc9: CheckResult = {
    testCaseId: "TC-9", verdict: "PASS", category: "NONE",
    scope: { deviceId: "desktop-chromium", articleEpochId: "article-recorded", tagName: "v-example-site" },
    expected: {}, observed: {}, evidenceIds: ["event-1", "dom"],
  };
  const contextualized = applyDemandContext([tc9], demand)[0]!;
  assert.equal(contextualized.verdict, "FAIL");
  assert.equal(contextualized.category, "RUNTIME_BROWSER");
  assert.match(JSON.stringify(contextualized.observed), /required request not observed/);
});
