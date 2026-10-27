import type { CheckResult, Evidence, JsonValue, Verdict } from "../contracts.js";
import type { CapturedBrowserEvidence } from "../browser/capture.js";

export interface DevicePolicyEntry {
  id: string;
  kind: "desktop" | "mobile";
  os: string;
  browser: string;
  viewport: { width: number; height: number };
  emulated: boolean;
  consent: string;
  autoplayMode: string;
  requiredBlockEvents: string[];
  tap: { state: "enabled" | "disabled"; selector: string | null; settleMs: number; playbackRequired: boolean };
  realIosEvidence: "required" | "not_applicable";
}

export interface DevicePolicy {
  schemaVersion: number;
  policyId: string;
  profileId: string;
  status: "draft" | "confirmed";
  devices: DevicePolicyEntry[];
  deferred: string[];
}

export function parseRealDeviceEvidence(value: unknown, expectedProfileId: string): { deviceId: string; capture: CapturedBrowserEvidence } {
  const root = object(value, "realDeviceEvidence");
  integer(root.schemaVersion, "realDeviceEvidence.schemaVersion");
  if (text(root.profileId, "realDeviceEvidence.profileId") !== expectedProfileId) throw new TypeError("realDeviceEvidence profile does not match");
  const platform = text(root.platform, "realDeviceEvidence.platform");
  const browser = text(root.browser, "realDeviceEvidence.browser");
  if (platform !== "ios" || browser !== "safari") throw new TypeError("realDeviceEvidence must identify iOS and Safari");
  if (typeof root.playbackAfterTap !== "boolean") throw new TypeError("realDeviceEvidence.playbackAfterTap must be boolean");
  const capturedAt = text(root.capturedAt, "realDeviceEvidence.capturedAt");
  if (Number.isNaN(Date.parse(capturedAt))) throw new TypeError("realDeviceEvidence.capturedAt must be a timestamp");
  const deviceId = text(root.deviceId, "realDeviceEvidence.deviceId");
  const artifactRefs = strings(root.artifactRefs, "realDeviceEvidence.artifactRefs");
  if (artifactRefs.length === 0) throw new TypeError("realDeviceEvidence.artifactRefs must identify at least one retained artifact");
  const blockEvents = strings(root.blockEvents, "realDeviceEvidence.blockEvents");
  if (blockEvents.some((event) => !["blocked_inline", "blocked_autoplay", "blocked_device"].includes(event))) throw new TypeError("realDeviceEvidence.blockEvents contains an unsupported event");
  return {
    deviceId,
    capture: {
      evidenceId: text(root.evidenceId, "realDeviceEvidence.evidenceId"), source: "browser_dom", capturedAt,
      data: { kind: "real_device_evidence", pageUrl: text(root.pageUrl, "realDeviceEvidence.pageUrl"), platform, browser, playbackAfterTap: root.playbackAfterTap, blockEvents, artifactRefs, consent: text(root.consent, "realDeviceEvidence.consent"), autoplayMode: text(root.autoplayMode, "realDeviceEvidence.autoplayMode") },
    },
  };
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a non-empty string`);
  return value;
}
function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) throw new TypeError(`${path} must be an integer >= ${minimum}`);
  return Number(value);
}
function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value.map((item, index) => text(item, `${path}[${index}]`));
}

export function parseDevicePolicy(value: unknown): DevicePolicy {
  const root = object(value, "devicePolicy");
  integer(root.schemaVersion, "devicePolicy.schemaVersion");
  const status = text(root.status, "devicePolicy.status");
  if (status !== "draft" && status !== "confirmed") throw new TypeError("devicePolicy.status must be draft or confirmed");
  if (!Array.isArray(root.devices) || root.devices.length < 2) throw new TypeError("devicePolicy.devices must include desktop and mobile profiles");
  const devices = root.devices.map((value, index): DevicePolicyEntry => {
    const entry = object(value, `devicePolicy.devices[${index}]`);
    const kind = text(entry.kind, `devicePolicy.devices[${index}].kind`);
    if (kind !== "desktop" && kind !== "mobile") throw new TypeError(`devicePolicy.devices[${index}].kind must be desktop or mobile`);
    const viewport = object(entry.viewport, `devicePolicy.devices[${index}].viewport`);
    const tap = object(entry.tap, `devicePolicy.devices[${index}].tap`);
    const tapState = text(tap.state, `devicePolicy.devices[${index}].tap.state`);
    if (tapState !== "enabled" && tapState !== "disabled") throw new TypeError(`devicePolicy.devices[${index}].tap.state must be enabled or disabled`);
    const realIosEvidence = text(entry.realIosEvidence, `devicePolicy.devices[${index}].realIosEvidence`);
    if (realIosEvidence !== "required" && realIosEvidence !== "not_applicable") throw new TypeError(`devicePolicy.devices[${index}].realIosEvidence is unsupported`);
    if (typeof entry.emulated !== "boolean" || typeof tap.playbackRequired !== "boolean") throw new TypeError(`devicePolicy.devices[${index}] boolean fields are invalid`);
    const requiredBlockEvents = strings(entry.requiredBlockEvents, `devicePolicy.devices[${index}].requiredBlockEvents`);
    if (requiredBlockEvents.some((event) => !["blocked_inline", "blocked_autoplay", "blocked_device"].includes(event))) throw new TypeError(`devicePolicy.devices[${index}].requiredBlockEvents contains an unsupported event`);
    return {
      id: text(entry.id, `devicePolicy.devices[${index}].id`), kind,
      os: text(entry.os, `devicePolicy.devices[${index}].os`), browser: text(entry.browser, `devicePolicy.devices[${index}].browser`),
      viewport: { width: integer(viewport.width, `devicePolicy.devices[${index}].viewport.width`, 1), height: integer(viewport.height, `devicePolicy.devices[${index}].viewport.height`, 1) },
      emulated: entry.emulated, consent: text(entry.consent, `devicePolicy.devices[${index}].consent`), autoplayMode: text(entry.autoplayMode, `devicePolicy.devices[${index}].autoplayMode`),
      requiredBlockEvents,
      tap: { state: tapState, selector: tapState === "enabled" ? text(tap.selector, `devicePolicy.devices[${index}].tap.selector`) : null, settleMs: integer(tap.settleMs, `devicePolicy.devices[${index}].tap.settleMs`), playbackRequired: tap.playbackRequired },
      realIosEvidence,
    };
  });
  if (!devices.some((item) => item.kind === "desktop") || !devices.some((item) => item.kind === "mobile")) throw new TypeError("devicePolicy requires desktop and mobile entries");
  if (new Set(devices.map((item) => item.id)).size !== devices.length) throw new TypeError("devicePolicy device ids must be unique");
  return { schemaVersion: Number(root.schemaVersion), policyId: text(root.policyId, "devicePolicy.policyId"), profileId: text(root.profileId, "devicePolicy.profileId"), status, devices, deferred: strings(root.deferred, "devicePolicy.deferred") };
}

function textValue(value: JsonValue | undefined): string | null { return typeof value === "string" ? value : null; }

export function validateDevice(input: { evidence: readonly Evidence[]; policy: DevicePolicy; device: DevicePolicyEntry; deviceId: string; captureComplete: boolean; runtime: { os: string; browser: string; viewport: { width: number; height: number } } }): CheckResult {
  const scoped = input.evidence.filter((item) => item.deviceId === input.deviceId);
  const events = scoped.filter((item) => item.source === "browser_logger").map((item) => ({ item, event: textValue(item.data.canonicalEvent) }));
  const completedTap = scoped.find((item) => item.source === "browser_dom" && item.data.kind === "device_tap" && item.data.outcome === "completed");
  const playbackAfterTap = completedTap === undefined ? null : events.find(({ item, event }) => event === "video_start" && item.capturedAt >= completedTap.capturedAt)?.item ?? null;
  const samples = scoped.filter((item) => item.source === "browser_dom" && item.data.kind === "visibility_sample");
  const matchesViewport = (item: Evidence) => {
    const viewport = item.data.viewport;
    return typeof viewport === "object" && viewport !== null && !Array.isArray(viewport) && viewport.width === input.device.viewport.width && viewport.height === input.device.viewport.height;
  };
  // Normalized evidence holds one player per sample (data.player); raw samples keep the data.players list.
  const samplePlayers = (item: Evidence): JsonValue[] => Array.isArray(item.data.players) && item.data.players.length > 0
    ? item.data.players
    : item.data.player === undefined || item.data.player === null ? [] : [item.data.player];
  const dimensionsMeasured = samples.filter(matchesViewport).flatMap(samplePlayers).some((player) => {
    if (typeof player !== "object" || player === null || Array.isArray(player) || typeof player.rect !== "object" || player.rect === null || Array.isArray(player.rect)) return false;
    return typeof player.rect.width === "number" && player.rect.width > 0 && typeof player.rect.height === "number" && player.rect.height > 0;
  });
  const hardware = scoped.find((item) => item.source === "browser_dom" && item.data.kind === "real_device_evidence" && item.data.platform === "ios" && item.data.browser === "safari");
  const hardwareBlocks = hardware !== undefined && Array.isArray(hardware.data.blockEvents) ? hardware.data.blockEvents.filter((item): item is string => typeof item === "string") : [];
  const observedBlocks = [...new Set([...events.flatMap(({ event }) => event !== null && event.startsWith("blocked_") ? [event] : []), ...hardwareBlocks])];
  const missingExercises = input.device.requiredBlockEvents.filter((event) => !observedBlocks.includes(event));
  const failures: string[] = [];
  if (input.runtime.viewport.width !== input.device.viewport.width || input.runtime.viewport.height !== input.device.viewport.height) failures.push("runtime viewport did not match device policy");
  if (input.device.tap.playbackRequired && completedTap !== undefined && playbackAfterTap === null) failures.push("playback did not start after the configured tap");
  if (input.device.realIosEvidence === "required" && hardware !== undefined && hardware.data.playbackAfterTap !== true) failures.push("real iOS/Safari evidence did not confirm playback after tap");
  if (hardware !== undefined && (hardware.data.consent !== input.device.consent || hardware.data.autoplayMode !== input.device.autoplayMode)) failures.push("real-device consent or autoplay mode did not match the device policy");
  const coverageGaps: string[] = [];
  if (!dimensionsMeasured) coverageGaps.push("CSS dimensions were not measured at the configured viewport");
  if (missingExercises.length > 0) coverageGaps.push(`required block events not exercised: ${missingExercises.join(", ")}`);
  if (input.device.tap.playbackRequired && completedTap === undefined) coverageGaps.push("configured playback tap was not completed");
  if (input.device.realIosEvidence === "required" && hardware === undefined) coverageGaps.push("real iOS/Safari hardware evidence is unavailable; Chromium emulation cannot verify iOS restrictions");
  if (!input.captureComplete) coverageGaps.push("browser capture was incomplete");
  if (failures.length > 0 && scoped.length === 0) coverageGaps.push("failure metadata has no captured evidence record");
  const verdict: Verdict = failures.length > 0 && scoped.length > 0 ? "FAIL" : coverageGaps.length > 0 || input.policy.status !== "confirmed" ? "UNKNOWN" : "PASS";
  const evidenceIds = [samples.find(matchesViewport)?.evidenceId, completedTap?.evidenceId, playbackAfterTap?.evidenceId, hardware?.evidenceId, ...events.filter(({ event }) => event !== null && observedBlocks.includes(event)).map(({ item }) => item.evidenceId)].filter((value): value is string => value !== undefined);
  if (verdict === "FAIL" && evidenceIds.length === 0) evidenceIds.push(...scoped.map((item) => item.evidenceId));
  return {
    testCaseId: "TC-16", verdict, category: verdict === "PASS" ? "NONE" : verdict === "FAIL" ? "RUNTIME_BROWSER" : "TOOLING",
    scope: { deviceId: input.deviceId, articleEpochId: null, tagName: null },
    expected: { policyId: input.policy.policyId, kind: input.device.kind, os: input.device.os, browser: input.device.browser, viewport: input.device.viewport, emulated: input.device.emulated, consent: input.device.consent, autoplayMode: input.device.autoplayMode, requiredBlockEvents: input.device.requiredBlockEvents, playbackAfterTap: input.device.tap.playbackRequired, realIosEvidence: input.device.realIosEvidence, deferred: input.policy.deferred },
    observed: { runtime: input.runtime, observedBlocks, missingExercises, cssDimensionsMeasured: dimensionsMeasured, tapCompleted: completedTap !== undefined, playbackAfterTap: playbackAfterTap !== null, realIosSafariEvidence: hardware !== undefined, coverageGaps, failures },
    evidenceIds: [...new Set(evidenceIds)],
  };
}
