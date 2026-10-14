import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseEvidence, type CheckResult, type Evidence } from "../src/contracts.js";
import { applyRuntimeContext, parseRuntimePolicy, validateBlockedEvents, type RuntimePolicy } from "../src/rules/blocked.js";
import { validateDependencies } from "../src/rules/dependencies.js";

async function policy(): Promise<RuntimePolicy> {
  const value = JSON.parse(await readFile("config/runtime-policy.json", "utf8"));
  value.status = "confirmed";
  return parseRuntimePolicy(value);
}

function evidence(id: string, source: Evidence["source"], data: Evidence["data"]): Evidence {
  return parseEvidence({ schemaVersion: 1, evidenceId: id, runId: "run-recorded", articleEpochId: "article-recorded", deviceId: "desktop-chromium", source, capturedAt: "2026-10-14T00:00:00.000Z", data });
}

function logger(id: string, canonicalEvent: string, startedMs: number, rawEvent = canonicalEvent): Evidence {
  return evidence(id, "browser_logger", { kind: "logger_request", fields: { event: rawEvent, tagName: "v-example-site" }, rawEvent, canonicalEvent, requestStartedMs: startedMs });
}

function request(id: string, file: string, outcome = "http_success", status: number | null = 200): Evidence {
  return evidence(id, "browser_network", { kind: "request", url: `https://cdn.example/dependencies/${file}`, outcome, status });
}

function input(runtime: RuntimePolicy, items: Evidence[]) {
  return { evidence: items, policy: runtime, profileId: runtime.profileId, product: "video", deviceId: "desktop-chromium", articleEpochId: "article-recorded", tagName: "v-example-site", captureComplete: true };
}

test("expected blocks warn while unexpected autoplay and IMA blocks fail as runtime evidence", async () => {
  const runtime = await policy();
  runtime.blocks.blocked_autoplay.expectation = "expected";
  runtime.blocks.blocked_ima.expectation = "unexpected";
  const items = [logger("loaded", "loaded", 1), logger("init", "init_vdo", 2), logger("autoplay", "blocked_autoplay", 3), logger("recovered", "video_start", 4), logger("ima", "blocked_ima", 5), logger("pageview", "pageview", 6)];
  const result = validateBlockedEvents(input(runtime, items));
  assert.equal(result.check.verdict, "FAIL");
  assert.equal(result.check.category, "RUNTIME_BROWSER");
  assert.equal(result.classifications[0]?.verdict, "WARNING");
  assert.equal(result.classifications[0]?.recoveredAfterBlock, true);
  assert.equal(result.classifications[0]?.placement, "inside");
  assert.equal(result.classifications[1]?.cause, "runtime_block");
});

test("draft policy remains unknown, agent blocks warn, and device policy is device-specific", async () => {
  const runtime = await policy();
  runtime.status = "draft";
  assert.equal(validateBlockedEvents(input(runtime, [logger("block", "blocked_inline", 1)])).check.verdict, "UNKNOWN");
  runtime.status = "confirmed";
  runtime.blocks.blocked_agent.expectation = "unexpected";
  assert.equal(validateBlockedEvents(input(runtime, [logger("agent", "blocked_agent", 1)])).check.verdict, "WARNING");
  runtime.blocks.blocked_device.expectation = "unexpected";
  runtime.blocks.blocked_device.byDevice["desktop-chromium"] = "expected";
  const device = validateBlockedEvents(input(runtime, [logger("device", "blocked_device", 1)]));
  assert.equal(device.check.verdict, "WARNING");
  assert.equal(device.classifications[0]?.cause, "device_configuration");
});

test("five Forceplay attempts are counted from five records and later recovery does not erase the block", async () => {
  const runtime = await policy();
  runtime.blocks.blocked_player.expectation = "unexpected";
  const attempts = Array.from({ length: 5 }, (_, index) => logger(`force-${index}`, "forceplay", index + 1));
  const result = validateBlockedEvents(input(runtime, [...attempts, logger("block", "blocked_player", 6), logger("start", "video_start", 7)]));
  assert.equal(result.classifications[0]?.forceplayAttemptsObserved, 5);
  assert.equal(result.classifications[0]?.recoveredAfterBlock, true);
  assert.equal(result.check.verdict, "FAIL");
});

test("Q2 is tied to observed missing anchor while Bn keeps unknown meaning", async () => {
  const runtime = await policy();
  runtime.blocks.error.expectation = "unexpected";
  const dom = evidence("dom", "browser_dom", { kind: "page_snapshot", anchors: [] });
  const q2 = validateBlockedEvents(input(runtime, [dom, logger("q2", "error", 1, "Error Q2")]));
  assert.equal(q2.check.verdict, "FAIL");
  assert.equal(q2.check.category, "IMPLEMENTATION");
  assert.equal(q2.classifications[0]?.cause, "missing_anchor");
  const bn = validateBlockedEvents(input(runtime, [dom, logger("bn", "error", 1, "Error Bn")]));
  assert.equal(bn.check.verdict, "UNKNOWN");
  assert.equal(bn.classifications[0]?.meaning, null);
  assert.equal(bn.classifications[0]?.cause, "unknown_error_code");
  const undocumented = validateBlockedEvents(input(runtime, [dom, logger("other", "error", 1, "Error ZX9")]));
  assert.equal(undocumented.check.verdict, "UNKNOWN");
  assert.equal(undocumented.classifications[0]?.meaning, null);
});

test("each required dependency failure is retained without claiming ad-blocker detection", async () => {
  const runtime = await policy();
  const configured = runtime.dependencies.filter((item) => item.products.includes("video") && item.required);
  for (const failed of configured) {
    const items = configured.map((item) => request(item.id, item.pathSuffixes[0]!.slice(1), item.id === failed.id ? "transport_failure" : "http_success", item.id === failed.id ? null : 200));
    const result = validateDependencies(input(runtime, items));
    assert.equal(result.verdict, "FAIL", failed.id);
    assert.equal(result.category, "RUNTIME_BROWSER");
    assert.equal(JSON.stringify(result.observed).includes('"adBlockerDetected":false'), true);
  }
});

test("product-specific and optional files do not fail video, while IMA and rtb are assessed independently", async () => {
  const runtime = await policy();
  runtime.dependencies.push({ id: "carousel-only.js", products: ["carousel"], required: true, pathSuffixes: ["/carousel-only.js"] });
  runtime.dependencies.push({ id: "optional-video.js", products: ["video"], required: false, pathSuffixes: ["/optional-video.js"] });
  const required = runtime.dependencies.filter((item) => item.products.includes("video") && item.required);
  const items = required.map((item) => request(item.id, item.pathSuffixes[0]!.slice(1), item.id === "ima3.js" ? "http_failure" : "http_success", item.id === "ima3.js" ? 403 : 200));
  const result = validateDependencies(input(runtime, items));
  assert.equal(result.verdict, "FAIL");
  assert.match(JSON.stringify(result.observed), /"id":"ima3.js".*"state":"failed"/);
  assert.match(JSON.stringify(result.observed), /"id":"rtb.js".*"state":"loaded"/);
  assert.doesNotMatch(JSON.stringify(result.observed), /carousel-only/);
  assert.match(JSON.stringify(result.observed), /"id":"optional-video.js".*"state":"missing"/);
});

test("Blocked URL stays in its Loaded-to-initVdo window while Prebid and rtb loading remain independent", async () => {
  const runtime = await policy();
  runtime.blocks.blocked_url.expectation = "expected";
  const blocked = validateBlockedEvents(input(runtime, [logger("loaded", "loaded", 1), logger("url", "blocked_url", 2), logger("init", "init_vdo", 3)]));
  assert.equal(blocked.check.verdict, "WARNING");
  assert.equal(blocked.classifications[0]?.placement, "inside");
  const required = runtime.dependencies.filter((item) => item.products.includes("video") && item.required);
  const dependencies = validateDependencies(input(runtime, required.map((item) => request(
    item.id,
    item.pathSuffixes[0]!.slice(1),
    item.id === "allowed_url" ? "http_failure" : "http_success",
    item.id === "allowed_url" ? 403 : 200,
  ))));
  const observed = JSON.stringify(dependencies.observed);
  assert.match(observed, /"id":"allowed_url".*"state":"failed"/);
  assert.match(observed, /"id":"prebid.js".*"state":"loaded"/);
  assert.match(observed, /"id":"rtb.js".*"state":"loaded"/);
});

test("missing initVdo uses required dependency evidence before placement attribution", async () => {
  const runtime = await policy();
  runtime.blocks.blocked_autoplay.expectation = "expected";
  const required = runtime.dependencies.filter((item) => item.products.includes("video") && item.required);
  const items = [
    evidence("dom", "browser_dom", { kind: "page_snapshot", anchors: [{ id: "v-example-site" }] }),
    ...required.filter((item) => item.id !== "vdo.ai.js").map((item) => request(item.id, item.pathSuffixes[0]!.slice(1))),
  ];
  const dependencies = validateDependencies(input(runtime, items));
  assert.equal(dependencies.verdict, "FAIL");
  assert.equal(dependencies.category, "CONFIGURATION");
  const blocked = validateBlockedEvents(input(runtime, [logger("block", "blocked_autoplay", 1)]));
  const checks: CheckResult[] = [{
    testCaseId: "TC-6", verdict: "FAIL", category: "RUNTIME_BROWSER",
    scope: { deviceId: "desktop-chromium", articleEpochId: "article-recorded", tagName: "v-example-site" },
    expected: {}, observed: { failures: ["v-example-site: missing init_vdo"] }, evidenceIds: ["dom"],
  }, {
    testCaseId: "TC-9", verdict: "UNKNOWN", category: "TOOLING",
    scope: { deviceId: "desktop-chromium", articleEpochId: "article-recorded", tagName: "v-example-site" },
    expected: {}, observed: {}, evidenceIds: [],
  }];
  const contextualized = applyRuntimeContext(checks, blocked, dependencies);
  assert.equal(contextualized[0]?.category, "CONFIGURATION");
  assert.match(JSON.stringify(contextualized[0]?.observed), /placement attribution withheld/);
  assert.equal(contextualized[1]?.verdict, "NOT_APPLICABLE");
});
