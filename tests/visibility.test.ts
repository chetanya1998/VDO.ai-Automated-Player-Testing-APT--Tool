import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseEvidence, type CheckResult, type Evidence, type JsonValue } from "../src/contracts.js";
import { validateLayout } from "../src/rules/layout.js";
import { applyViewabilityContext, applyVisibilityContext, parseVisibilityPolicy, validateViewability, type VisibilityPolicy } from "../src/rules/viewability.js";

const tagName = "v-example-site";

async function policy(): Promise<VisibilityPolicy> {
  const raw = JSON.parse(await readFile("config/visibility-policy.json", "utf8"));
  raw.status = "confirmed";
  return parseVisibilityPolicy(raw);
}

function evidence(id: string, source: Evidence["source"], data: { [key: string]: JsonValue }): Evidence {
  return parseEvidence({ schemaVersion: 1, evidenceId: id, runId: "run-recorded", articleEpochId: "article-recorded", deviceId: "desktop-chromium", source, capturedAt: "2026-10-15T00:00:00.000Z", data });
}

function sample(atMs: number, visiblePercent: number, options: {
  viewportState?: "in_view" | "below_viewport" | "above_viewport";
  blockers?: string[];
  formed?: boolean;
  frameAccessible?: boolean | null;
  position?: string;
  transform?: string;
  triggerNetworkEvidenceId?: string;
} = {}): Evidence {
  const blockers = options.blockers ?? [];
  return evidence(`sample-${atMs}-${visiblePercent}-${blockers.join("-") || "clear"}`, "browser_dom", {
    kind: "visibility_sample", sampledMs: atMs, reason: options.triggerNetworkEvidenceId === undefined ? "interval" : "logger_event",
    triggerNetworkEvidenceId: options.triggerNetworkEvidenceId ?? null, triggerEvent: null,
    player: {
      id: tagName, tagName, tag: "div", present: true, formed: options.formed ?? true,
      frameAccessible: options.frameAccessible ?? null, viewportState: options.viewportState ?? "in_view", visiblePercent,
      blockers,
      rect: { x: 0, y: 0, width: blockers.includes("zero_dimensions") ? 0 : 640, height: blockers.includes("zero_dimensions") ? 0 : 360, top: 0, right: 640, bottom: 360, left: 0 },
      style: { display: blockers.includes("display_none") ? "none" : "block", visibility: blockers.includes("visibility_hidden") ? "hidden" : "visible", opacity: blockers.includes("opacity_zero") ? "0" : "1", position: options.position ?? "static", zIndex: "1", transform: options.transform ?? "none", overflowX: "visible", overflowY: "visible" },
      ancestors: blockers.some((blocker) => blocker.startsWith("ancestor_")) ? [{ tag: "section", id: "publisher", display: blockers.includes("ancestor_display_none") ? "none" : "block", visibility: blockers.includes("ancestor_visibility_hidden") ? "hidden" : "visible", opacity: blockers.includes("ancestor_opacity_zero") ? "0" : "1" }] : [],
      occluders: blockers.includes("occluded") ? [{ tag: "div", id: "overlay", zIndex: "10" }] : [],
    },
  });
}

function emptySample(): Evidence {
  return evidence("sample-empty", "browser_dom", { kind: "visibility_sample", sampledMs: 0, reason: "after_load", players: [] });
}

function logger(name: string, atMs: number, networkEvidenceId = `network-${name}`): Evidence {
  return evidence(`event-${name}-${atMs}`, "browser_logger", { kind: "logger_request", networkEvidenceId, canonicalEvent: name, rawEvent: name, requestStartedMs: atMs, fields: { event: name, tagName } });
}

function series(percent: number, durationMs: number, mutate?: (atMs: number) => number): Evidence[] {
  const values: Evidence[] = [];
  for (let atMs = 0; atMs <= durationMs; atMs += 100) values.push(sample(atMs, mutate?.(atMs) ?? percent, atMs === 0 ? { triggerNetworkEvidenceId: "network-began" } : {}));
  return values;
}

function input(visibilityPolicy: VisibilityPolicy, items: Evidence[], product = "video") {
  return { evidence: items, policy: visibilityPolicy, profileId: visibilityPolicy.profileId, product, deviceId: "desktop-chromium", articleEpochId: "article-recorded", tagName, captureComplete: true };
}

function placementEvents(kind: "began_atf" | "began_btf" = "began_atf"): Evidence[] {
  return [logger(kind, 0, "network-began"), logger("came_in_view", 100)];
}

test("video exposure passes at exactly 50 percent for 2000 ms and fails below the boundary", async () => {
  const visibilityPolicy = await policy();
  const pass = validateViewability(input(visibilityPolicy, [...series(50, 2000), ...placementEvents(), logger("video_start", 0), logger("viewable_impression", 2000)]));
  assert.equal(pass.verdict, "PASS");
  assert.equal(pass.sufficientExposure, true);
  assert.match(JSON.stringify(pass.observed), /"maximumContinuousMs":2000/);

  const below = validateViewability(input(visibilityPolicy, [...series(49.99, 2000), ...placementEvents(), logger("video_start", 0), logger("viewable_impression", 2000)]));
  assert.equal(below.verdict, "FAIL");
  assert.equal(below.sufficientExposure, false);
});

test("banner exposure uses the exact 1000 ms boundary", async () => {
  const visibilityPolicy = await policy();
  const result = validateViewability(input(visibilityPolicy, [...series(50, 1000), ...placementEvents(), logger("ad_match", 0), logger("viewable_impression", 1000)], "banner"));
  assert.equal(result.verdict, "PASS");
  assert.equal(result.sufficientExposure, true);
});

test("interrupted exposure resets the continuous timer", async () => {
  const visibilityPolicy = await policy();
  const result = validateViewability(input(visibilityPolicy, [...series(50, 2000, (atMs) => atMs === 1000 ? 0 : 50), ...placementEvents(), logger("video_start", 0)]));
  assert.equal(result.verdict, "PASS");
  assert.equal(result.sufficientExposure, false);
  assert.doesNotMatch(JSON.stringify(result.observed), /"maximumContinuousMs":2000/);
});

test("ATF, BTF after scroll, early scroll, and missing Came In View use event-time geometry", async () => {
  const visibilityPolicy = await policy();
  const atf = validateViewability(input(visibilityPolicy, [sample(0, 20, { viewportState: "in_view", triggerNetworkEvidenceId: "network-began" }), ...placementEvents("began_atf")]));
  assert.equal(atf.tc8.verdict, "PASS");

  const btf = validateViewability(input(visibilityPolicy, [
    sample(0, 0, { viewportState: "below_viewport", triggerNetworkEvidenceId: "network-began" }),
    sample(100, 20, { viewportState: "in_view" }),
    ...placementEvents("began_btf"),
  ]));
  assert.equal(btf.tc8.verdict, "PASS");

  const earlyScroll = validateViewability(input(visibilityPolicy, [sample(0, 20, { viewportState: "in_view", triggerNetworkEvidenceId: "network-began" }), ...placementEvents("began_atf")]));
  assert.equal(earlyScroll.tc8.verdict, "PASS");

  const missingCame = validateViewability(input(visibilityPolicy, [sample(0, 20, { triggerNetworkEvidenceId: "network-began" }), logger("began_atf", 0, "network-began")]));
  assert.equal(missingCame.tc8.verdict, "FAIL");
  assert.match(JSON.stringify(missingCame.tc8.observed), /missing came_in_view/);
});

test("layout separates absent formation from publisher CSS obstruction", async () => {
  const base = { deviceId: "desktop-chromium", articleEpochId: "article-recorded", tagName, captureComplete: true };
  const absent = validateLayout({ ...base, evidence: [emptySample()] });
  assert.equal(absent.verdict, "FAIL");
  assert.equal(absent.category, "IMPLEMENTATION");
  assert.match(JSON.stringify(absent.observed), /player_not_formed/);

  const unformed = validateLayout({ ...base, evidence: [sample(0, 0, { formed: false })] });
  assert.equal(unformed.verdict, "FAIL");
  assert.equal(unformed.category, "IMPLEMENTATION");

  for (const blocker of ["display_none", "visibility_hidden", "opacity_zero", "ancestor_display_none", "ancestor_visibility_hidden", "ancestor_clipped", "occluded", "zero_dimensions"]) {
    const result = validateLayout({ ...base, evidence: [sample(0, blocker === "zero_dimensions" ? 0 : 20, { blockers: [blocker] })] });
    assert.equal(result.verdict, "FAIL", blocker);
    assert.equal(result.category, "RUNTIME_BROWSER", blocker);
    assert.match(JSON.stringify(result.observed), /publisher_css_obstruction/);
  }
});

test("transforms and fixed or sticky transitions are measured without becoming automatic failures", async () => {
  const result = validateLayout({
    evidence: [sample(0, 100, { position: "fixed", transform: "matrix(1, 0, 0, 1, 20, 10)" }), sample(100, 100, { position: "sticky" })],
    deviceId: "desktop-chromium", articleEpochId: "article-recorded", tagName, captureComplete: true,
  });
  assert.equal(result.verdict, "PASS");
  assert.match(JSON.stringify(result.observed), /matrix\(1, 0, 0, 1, 20, 10\)/);
  assert.match(JSON.stringify(result.observed), /fixed/);
  assert.match(JSON.stringify(result.observed), /sticky/);
});

test("unobservable iframe geometry stays UNKNOWN", async () => {
  const visibilityPolicy = await policy();
  const items = [sample(0, 100, { frameAccessible: false, triggerNetworkEvidenceId: "network-began" }), ...placementEvents(), logger("video_start", 0)];
  const viewability = validateViewability(input(visibilityPolicy, items));
  const layout = validateLayout({ evidence: items, deviceId: "desktop-chromium", articleEpochId: "article-recorded", tagName, captureComplete: true });
  assert.equal(viewability.verdict, "UNKNOWN");
  assert.equal(layout.verdict, "UNKNOWN");
  assert.match(JSON.stringify(viewability.observed), /frame_geometry_unobservable/);
});

test("missing Viewable Impression fails only after eligible playback and sufficient measured exposure", async () => {
  const visibilityPolicy = await policy();
  const baseCheck: CheckResult = {
    testCaseId: "TC-10", verdict: "FAIL", category: "RUNTIME_BROWSER",
    scope: { deviceId: "desktop-chromium", articleEpochId: "article-recorded", tagName }, expected: {},
    observed: { firstFailure: { event: "viewable_impression", cause: "event_not_observed" } }, evidenceIds: ["event-video_start-0"],
  };
  const insufficient = validateViewability(input(visibilityPolicy, [...series(49.99, 2000), ...placementEvents(), logger("video_start", 0)]));
  assert.equal(applyViewabilityContext(baseCheck, insufficient).verdict, "PASS");

  const sufficient = validateViewability(input(visibilityPolicy, [...series(50, 2000), ...placementEvents(), logger("video_start", 0)]));
  const failed = applyViewabilityContext(baseCheck, sufficient);
  assert.equal(failed.verdict, "FAIL");
  assert.match(JSON.stringify(failed.observed), /"expectedViewableEvent":true/);
});

test("a short or gapped observation window stays UNKNOWN", async () => {
  const visibilityPolicy = await policy();
  const short = validateViewability(input(visibilityPolicy, [...series(50, 1900), ...placementEvents(), logger("video_start", 0)]));
  assert.equal(short.verdict, "UNKNOWN");
  assert.equal(short.sufficientExposure, null);

  const gapped = validateViewability(input(visibilityPolicy, [sample(0, 50, { triggerNetworkEvidenceId: "network-began" }), sample(2000, 50), ...placementEvents(), logger("video_start", 0)]));
  assert.equal(gapped.verdict, "UNKNOWN");
  assert.match(JSON.stringify(gapped.observed), /measurementGaps/);
});

test("TC-6 does not require Came In View or Viewable Impression without measured exposure", async () => {
  const visibilityPolicy = await policy();
  const validation = validateViewability(input(visibilityPolicy, [
    sample(0, 0, { viewportState: "below_viewport", triggerNetworkEvidenceId: "network-began" }),
    logger("began_btf", 0, "network-began"),
  ]));
  const tc6: CheckResult = {
    testCaseId: "TC-6", verdict: "FAIL", category: "RUNTIME_BROWSER",
    scope: { deviceId: "desktop-chromium", articleEpochId: "article-recorded", tagName }, expected: {},
    observed: { tags: [{ tagName, missing: ["came_in_view", "viewable_impression"] }], failures: [`${tagName}: missing came_in_view`, `${tagName}: missing viewable_impression`] },
    evidenceIds: ["event-began_btf-0"],
  };
  const result = applyVisibilityContext([tc6], validation)[0]!;
  assert.equal(result.verdict, "PASS");
  assert.deepEqual((result.observed as { failures: string[] }).failures, []);
});

test("a reported Viewable Impression without measured exposure fails", async () => {
  const visibilityPolicy = await policy();
  const result = validateViewability(input(visibilityPolicy, [...series(20, 2000), ...placementEvents(), logger("video_start", 0), logger("viewable_impression", 2000)]));
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.expectedViewableEvent, false);
  assert.equal(result.reported, true);
});
