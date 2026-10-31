import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseEvidence, type Evidence } from "../src/contracts.js";
import { parseBrowserLoggerPayload, parseEventAliasProfile } from "../src/logger/browser-payload.js";
import { parseSiteProfileCatalog, validateTagSet, type SiteProfileCatalog } from "../src/profile/tag-identity.js";
import { applyActiveViewEvidence, summarizeActiveView } from "../src/rules/activeview.js";
import { parseRuntimePolicy, validateBlockedEvents } from "../src/rules/blocked.js";
import { validateDependencies } from "../src/rules/dependencies.js";
import { parseDevicePolicy, validateDevice } from "../src/rules/devices.js";
import { isTagAnchorId } from "../src/rules/integration.js";
import type { ViewabilityValidation } from "../src/rules/viewability.js";

function evidence(id: string, source: Evidence["source"], data: Evidence["data"], deviceId = "desktop-chromium"): Evidence {
  return parseEvidence({ schemaVersion: 1, evidenceId: id, runId: "run-tech-doc", articleEpochId: "article-1", deviceId, source, capturedAt: "2026-10-27T00:00:00.000Z", data });
}

async function runtimePolicy() {
  const value = JSON.parse(await readFile("config/runtime-policy.json", "utf8"));
  value.status = "confirmed";
  return parseRuntimePolicy(value);
}

test("real logger event names map to the documented events; unknown names stay unknown", async () => {
  const aliases = parseEventAliasProfile(JSON.parse(await readFile("config/event-aliases.json", "utf8")));
  const canonical = (event: string) => parseBrowserLoggerPayload(JSON.stringify({ event, tagName: "v-a", domainName: "a.com", page_url: "https://a.com/", dep: "d" }), "application/json", aliases).canonicalEvent;
  assert.equal(canonical("loaded"), "loaded");
  assert.equal(canonical("error"), "error");
  assert.equal(canonical("blocked_ima"), "blocked_ima");
  assert.equal(canonical("blocked_agent"), "blocked_agent");
  assert.equal(canonical("Website PageView Match"), "website_pageview_match");
  assert.equal(canonical("initvdo"), "init_vdo");
  assert.equal(canonical("Auto Play"), "auto_plays");
  assert.equal(canonical("T_Request"), null);
});

test("the anchor renamed to <tag>-<n> by vdo.ai.js still counts as the tag's div", () => {
  assert.equal(isTagAnchorId("v-claim-mitihani-co-tz", "v-claim-mitihani-co-tz"), true);
  assert.equal(isTagAnchorId("v-claim-mitihani-co-tz-0", "v-claim-mitihani-co-tz"), true);
  assert.equal(isTagAnchorId("v-claim-mitihani-co-tz-12", "v-claim-mitihani-co-tz"), true);
  assert.equal(isTagAnchorId("v-claim-mitihani-co-tz-v1", "v-claim-mitihani-co-tz"), false);
  assert.equal(isTagAnchorId("v-other-site", "v-claim-mitihani-co-tz"), false);
});

test("versioned dependency files from real pages load as the documented dependencies", async () => {
  const runtime = await runtimePolicy();
  const files = [
    "https://a.vdo.ai/core/v-mapsofindia-v1/vdo.ai.js",
    "https://www.googletagmanager.com/gtag/js",
    "https://targeting.vdo.ai/allowed_url_go.php",
    "https://a.vdo.ai/core/dependencies_hbv4_latest/vdo.min.js",
    "https://imasdk.googleapis.com/js/sdkloader/ima3.js",
    "https://a.vdo.ai/core/dependencies_hbv4_latest/vdo.player.8.0.js",
    "https://a.vdo.ai/core/dependencies_hbv4_latest/prebid9.1.0.js",
    "https://a.vdo.ai/core/dependencies_hbv4_latest/rtb_v7.45.0.js",
  ];
  const items = files.map((url, index) => evidence(`request-${index}`, "browser_network", { kind: "request", url, outcome: "http_success", status: 200 }));
  const result = validateDependencies({ evidence: items, policy: runtime, profileId: runtime.profileId, product: "video", deviceId: "desktop-chromium", articleEpochId: "article-1", tagName: "v-mapsofindia-v1", captureComplete: true });
  assert.equal(result.verdict, "PASS", JSON.stringify(result.observed));
});

test("any -v<number> sibling tag is a valid variant; other suffixes are not", () => {
  const catalog = (allowed: string[]): SiteProfileCatalog => ({
    schemaVersion: 1,
    status: "synthetic_draft",
    productPrefixes: { v: "video", c: "carousel", s: "story", b: "banner" },
    sites: [{ mappingId: "maps", approvedHosts: ["mapsofindia.com"], rootDomain: "mapsofindia.com", acceptedDomainNames: ["mapsofindia.com"], allowMultipleTags: true,
      tags: [{ baseTag: "v-mapsofindia", allowedTagNames: allowed, product: "video", placement: "unconfirmed", floatingMode: "unconfirmed", ruleSupport: "supported" }] }],
  });
  const accepted = parseSiteProfileCatalog(catalog(["v-mapsofindia", "v-mapsofindia-v1", "v-mapsofindia-v3", "v-mapsofindia-v12"]));
  assert.equal(validateTagSet({ siteUrl: "https://mapsofindia.com/", observations: [{ tagName: "v-mapsofindia-v3", domainName: "mapsofindia.com" }] }, accepted).verdict, "PASS");
  assert.throws(() => parseSiteProfileCatalog(catalog(["v-mapsofindia", "v-mapsofindia-x1"])), /-v<number>/);
  assert.throws(() => parseSiteProfileCatalog(catalog(["v-mapsofindia", "v-mapsofindia-v0"])), /-v<number>/);
});

test("a blocked event outside its documented window is at least a warning", async () => {
  const runtime = await runtimePolicy();
  runtime.blocks.blocked_ima.expectation = "expected";
  const logger = (id: string, event: string, startedMs: number) => evidence(id, "browser_logger", { kind: "logger_request", fields: { event, tagName: "v-example-site" }, rawEvent: event, canonicalEvent: event, requestStartedMs: startedMs });
  const base = { policy: runtime, profileId: runtime.profileId, product: "video", deviceId: "desktop-chromium", articleEpochId: "article-1", tagName: "v-example-site", captureComplete: true };
  const inside = validateBlockedEvents({ ...base, evidence: [logger("l", "loaded", 1), logger("i", "init_vdo", 2), logger("b", "blocked_ima", 3), logger("p", "pageview", 4)] });
  assert.equal(inside.classifications[0]?.placement, "inside");
  assert.equal(inside.classifications[0]?.cause, "configured_block");
  const outside = validateBlockedEvents({ ...base, evidence: [logger("l", "loaded", 1), logger("i", "init_vdo", 2), logger("p", "pageview", 3), logger("b", "blocked_ima", 4)] });
  assert.equal(outside.classifications[0]?.placement, "outside");
  assert.equal(outside.classifications[0]?.verdict, "WARNING");
  assert.match(outside.classifications[0]?.cause ?? "", /outside_documented_window/);
});

test("device coverage reads the per-player samples that normalization produces", async () => {
  const value = JSON.parse(await readFile("config/devices.json", "utf8"));
  value.status = "confirmed";
  const rules = parseDevicePolicy(value);
  const desktop = rules.devices.find((item) => item.kind === "desktop")!;
  const sample = evidence("sample:player:1", "browser_dom", { kind: "visibility_sample", viewport: desktop.viewport, players: [], player: { id: "v-example-site", rect: { width: 640, height: 360 } } });
  const check = validateDevice({ evidence: [sample], policy: rules, device: desktop, deviceId: desktop.id, captureComplete: true, runtime: { os: "linux", browser: "chromium", viewport: desktop.viewport } });
  assert.equal(check.verdict, "PASS", JSON.stringify(check.observed));
});

test("Active View pingbacks settle viewability that frame geometry could not measure", () => {
  const pingback = (id: string, query: string) => evidence(id, "browser_network", { kind: "request", url: `https://pagead2.googlesyndication.com/pcs/activeview?${query}` });
  const viewable = summarizeActiveView([pingback("av-1", "bs=1896,804&mtos=1002,1004,2104,2156,4099&p=145,309,505,949")], 2000);
  assert.equal(viewable.viewable, true);
  const notMeasurable = summarizeActiveView([pingback("av-2", "bs=-12245933,-12245933&mtos=0,0,0,0,0&p=145,309,505,949")], 2000);
  assert.equal(notMeasurable.measurable, false);
  assert.equal(notMeasurable.viewable, null);
  const zeroHeight = summarizeActiveView([pingback("av-3", "bs=1896,804&mtos=3000,3000,3000,3000,3000&p=145,309,145,1037")], 2000);
  assert.equal(zeroHeight.viewable, false);

  const unknown: ViewabilityValidation = {
    tc8: { testCaseId: "TC-8", verdict: "UNKNOWN", category: "TOOLING", scope: { deviceId: "desktop-chromium", articleEpochId: "article-1", tagName: "v-example-site" }, expected: null, observed: null, evidenceIds: [] },
    verdict: "UNKNOWN", category: "TOOLING", eligible: true, reported: true, sufficientExposure: null, expectedViewableEvent: null,
    expected: null, observed: { state: "frame_geometry_unobservable" }, evidenceIds: [],
  };
  assert.equal(applyActiveViewEvidence(unknown, viewable, false).verdict, "UNKNOWN", "draft policy never upgrades");
  const settled = applyActiveViewEvidence(unknown, viewable, true);
  assert.equal(settled.verdict, "PASS");
  assert.equal(settled.sufficientExposure, true);
  assert.deepEqual(settled.evidenceIds, ["av-1"]);
  assert.equal(applyActiveViewEvidence(unknown, zeroHeight, true).verdict, "FAIL");
});
