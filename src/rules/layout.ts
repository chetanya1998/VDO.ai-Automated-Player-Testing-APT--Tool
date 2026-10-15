import type { CheckResult, Evidence, JsonValue } from "../contracts.js";

export interface VisibilitySample {
  evidenceId: string;
  atMs: number;
  reason: string | null;
  triggerNetworkEvidenceId: string | null;
  triggerEvent: string | null;
  tagName: string | null;
  formed: boolean;
  frameAccessible: boolean | null;
  viewportState: string | null;
  visiblePercent: number;
  blockers: string[];
  position: string | null;
  player: { [key: string]: JsonValue };
}

export interface LayoutValidationInput {
  evidence: readonly Evidence[];
  deviceId: string;
  articleEpochId: string;
  tagName: string;
  captureComplete: boolean;
}

function record(value: JsonValue | undefined): { [key: string]: JsonValue } | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function text(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readVisibilitySamples(input: Pick<LayoutValidationInput, "evidence" | "deviceId" | "articleEpochId">): { samples: VisibilitySample[]; sampleEvidenceIds: string[] } {
  const scoped = input.evidence.filter((item) => item.deviceId === input.deviceId && item.articleEpochId === input.articleEpochId && item.source === "browser_dom" && item.data.kind === "visibility_sample");
  const samples = scoped.flatMap((item): VisibilitySample[] => {
    const player = record(item.data.player);
    if (player === null) return [];
    const style = record(player.style);
    return [{
      evidenceId: item.evidenceId,
      atMs: number(item.data.sampledMs) ?? Date.parse(item.capturedAt),
      reason: text(item.data.reason),
      triggerNetworkEvidenceId: text(item.data.triggerNetworkEvidenceId),
      triggerEvent: text(item.data.triggerEvent),
      tagName: text(player.tagName),
      formed: player.formed === true,
      frameAccessible: typeof player.frameAccessible === "boolean" ? player.frameAccessible : null,
      viewportState: text(player.viewportState),
      visiblePercent: number(player.visiblePercent) ?? 0,
      blockers: Array.isArray(player.blockers) ? player.blockers.filter((value): value is string => typeof value === "string") : [],
      position: text(style?.position),
      player,
    }];
  }).sort((left, right) => left.atMs - right.atMs || left.evidenceId.localeCompare(right.evidenceId));
  return { samples, sampleEvidenceIds: scoped.map((item) => item.evidenceId) };
}

function compact(sample: VisibilitySample): JsonValue {
  return {
    evidenceId: sample.evidenceId,
    sampledMs: sample.atMs,
    formed: sample.formed,
    frameAccessible: sample.frameAccessible,
    viewportState: sample.viewportState,
    visiblePercent: sample.visiblePercent,
    blockers: sample.blockers,
    position: sample.position,
    rect: sample.player.rect ?? null,
    style: sample.player.style ?? null,
    ancestors: sample.player.ancestors ?? [],
    occluders: sample.player.occluders ?? [],
  };
}

export function validateLayout(input: LayoutValidationInput): CheckResult {
  const { samples, sampleEvidenceIds } = readVisibilitySamples(input);
  const matching = samples.filter((sample) => sample.tagName === input.tagName);
  const expected = { playerPresent: true, playerFormed: true, publisherCssObstruction: false, tagName: input.tagName };
  if (matching.length === 0) return {
    testCaseId: "TC-14",
    verdict: input.captureComplete && sampleEvidenceIds.length > 0 ? "FAIL" : "UNKNOWN",
    category: input.captureComplete && sampleEvidenceIds.length > 0 ? "IMPLEMENTATION" : "TOOLING",
    scope: { deviceId: input.deviceId, articleEpochId: input.articleEpochId, tagName: input.tagName },
    expected,
    observed: { state: sampleEvidenceIds.length > 0 ? "player_not_formed" : "visibility_capture_unavailable", samples: [] },
    evidenceIds: sampleEvidenceIds,
  };
  const latestAt = Math.max(...matching.map((sample) => sample.atMs));
  const latest = matching.filter((sample) => sample.atMs === latestAt).sort((left, right) => right.visiblePercent - left.visiblePercent)[0]!;
  const unobservableFrame = latest.frameAccessible === false;
  const layoutBlockers = latest.blockers.filter((blocker) => [
    "display_none", "visibility_hidden", "opacity_zero", "zero_dimensions", "ancestor_display_none",
    "ancestor_visibility_hidden", "ancestor_opacity_zero", "ancestor_clipped", "occluded",
  ].includes(blocker));
  const verdict = unobservableFrame ? "UNKNOWN" : !latest.formed || layoutBlockers.length > 0 ? "FAIL" : "PASS";
  const category = verdict === "PASS" ? "NONE" : verdict === "UNKNOWN" ? "TOOLING" : !latest.formed ? "IMPLEMENTATION" : "RUNTIME_BROWSER";
  return {
    testCaseId: "TC-14",
    verdict,
    category,
    scope: { deviceId: input.deviceId, articleEpochId: input.articleEpochId, tagName: input.tagName },
    expected,
    observed: {
      state: unobservableFrame ? "frame_geometry_unobservable" : !latest.formed ? "player_not_formed" : layoutBlockers.length > 0 ? "publisher_css_obstruction" : "formed",
      layoutBlockers,
      latest: compact(latest),
      positionTransitions: matching.map((sample) => ({ evidenceId: sample.evidenceId, sampledMs: sample.atMs, position: sample.position, transform: text(record(sample.player.style)?.transform), viewportState: sample.viewportState })),
    },
    evidenceIds: [...new Set(matching.map((sample) => sample.evidenceId))],
  };
}
