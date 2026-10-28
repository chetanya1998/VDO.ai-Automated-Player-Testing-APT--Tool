import type { Evidence, JsonValue, Verdict } from "../contracts.js";
import { isSafeFrameUrl, type SafeFrameSample } from "./runner.js";

type CapturedEvidence = Pick<Evidence, "evidenceId" | "source" | "data">;

// Checks requested on top of the 23 test cases. They are reported on their own and never counted in the
// 23-case totals.
export type ExtraCheckId = "SAFE_FRAME" | "SLOT_REFRESH";

export interface ExtraCheck {
  id: ExtraCheckId;
  title: string;
  // Plain language: what the check looks at, and what this result means.
  checks: string;
  meaning: string;
  verdict: Verdict;
  summary: string;
  details: JsonValue;
}

export const REFRESH_INTERVALS_SEC = [30, 45, 60] as const;
export type RefreshIntervalSec = (typeof REFRESH_INTERVALS_SEC)[number];
// A refresh this much earlier or later than the chosen interval still counts as on time.
export const REFRESH_EARLY_MS = 5_000;
export const REFRESH_LATE_MS = 15_000;
// Ad requests closer together than this belong to the same auction.
const AD_CYCLE_GAP_MS = 3_000;

const SAFE_FRAME_CHECKS = "Whether the player's display ad is shown inside a Google SafeFrame: a protected frame that keeps the ad separate from the page, and whether that frame has a real size and is visible so the ad can be seen and counted.";

const SAFE_FRAME_MEANING: Record<Verdict, string> = {
  PASS: "The ad was shown in a SafeFrame inside the player, kept separate from the page, with a real size.",
  WARNING: "A SafeFrame ad was loaded, but it was hidden, had no size, failed to load or was not kept separate from the page, so it may not be seen or counted.",
  FAIL: "The SafeFrame ad could not be shown.",
  UNKNOWN: "The tool could not decide, usually because the page did not finish loading.",
  NOT_APPLICABLE: "No ad in the player used a SafeFrame on this visit. Video ads played through Google IMA do not use one, so this is not a fault by itself.",
};

const refreshChecks = (intervalSec: number) => `Whether the ad slot asks for a new ad every ${intervalSec} seconds while the player stays in view (on time = ${intervalSec - REFRESH_EARLY_MS / 1000} to ${intervalSec + REFRESH_LATE_MS / 1000} seconds after the previous ad request).`;

const REFRESH_MEANING: Record<Verdict, string> = {
  PASS: "The slot refreshed on time, so more ads can be shown during a long visit.",
  WARNING: "The slot refreshed, but not at the chosen interval. Check the refresh setting for this publisher.",
  FAIL: "The slot never asked for a new ad while the player stayed in view, so only one ad cycle runs per visit.",
  UNKNOWN: "Refresh could not be checked, usually because the player never asked for an ad or the visit ended too early.",
  NOT_APPLICABLE: "The refresh check does not apply here.",
};

const looseEvent = (value: unknown) => typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
const seconds = (ms: number) => Math.round(ms / 100) / 10;

export interface SafeFrameInput {
  evidence: readonly CapturedEvidence[];
  safeFrames?: { loaded: Array<{ atMs: number; url: string }>; samples: SafeFrameSample[] };
  completed: boolean;
}

export function validateSafeFrame(input: SafeFrameInput): ExtraCheck {
  const loaded = input.safeFrames?.loaded ?? [];
  const samples = input.safeFrames?.samples ?? [];
  const failures = input.evidence.filter((item) => item.source === "browser_network" && item.data.kind === "request" && typeof item.data.url === "string"
    && isSafeFrameUrl(item.data.url) && ["http_failure", "transport_failure"].includes(String(item.data.outcome)))
    .map((item) => `${String(item.data.url).split("?")[0]} (${String(item.data.outcome)})`);
  const inPlayer = samples.filter((item) => item.inPlayer);
  const shown = inPlayer.filter((item) => item.visible && item.width > 0 && item.height > 0);
  const isolated = shown.filter((item) => item.crossOrigin);
  const best = isolated.find((item) => item.inViewport) ?? isolated[0] ?? shown[0];
  const outsidePlayer = new Set(samples.filter((item) => !item.inPlayer).map((item) => item.url)).size;

  let verdict: Verdict;
  let summary: string;
  if (input.safeFrames === undefined || (!input.completed && inPlayer.length === 0)) {
    verdict = "UNKNOWN";
    summary = "The page did not finish loading, so SafeFrame ads could not be checked.";
  } else if (isolated.length > 0) {
    verdict = "PASS";
    summary = `The player showed an ad in a Google SafeFrame (${best!.width}×${best!.height} px)${best!.inViewport ? ", visible on screen" : ""}.`;
  } else if (shown.length > 0) {
    verdict = "WARNING";
    summary = "The player's SafeFrame ad was on the same address as the page, so it is not kept separate from it.";
  } else if (inPlayer.length > 0) {
    verdict = "WARNING";
    summary = "The player loaded a SafeFrame ad, but it was hidden or had no size, so the ad could not be seen.";
  } else if (failures.length > 0) {
    verdict = "WARNING";
    summary = `A SafeFrame ad container failed to load: ${failures.slice(0, 2).join(", ")}.`;
  } else {
    verdict = "NOT_APPLICABLE";
    summary = loaded.length === 0
      ? "No ad on this page was shown in a Google SafeFrame."
      : `${outsidePlayer || loaded.length} SafeFrame ad(s) were found on the page, but none inside the vdo.ai player; they belong to other ads on the page.`;
  }
  return {
    id: "SAFE_FRAME",
    title: "Safe frame check",
    checks: SAFE_FRAME_CHECKS,
    meaning: SAFE_FRAME_MEANING[verdict],
    verdict,
    summary,
    details: {
      safeFramesLoaded: loaded.length,
      insidePlayer: inPlayer.length > 0,
      shownInPlayer: shown.length > 0,
      keptSeparateFromPage: isolated.length > 0,
      ...(best === undefined ? {} : { size: `${best.width}×${best.height}`, onScreen: best.inViewport }),
      otherSafeFramesOnPage: outsidePlayer,
      failedToLoad: failures.slice(0, 5),
    },
  };
}

export interface SlotRefreshInput {
  evidence: readonly CapturedEvidence[];
  intervalSec: RefreshIntervalSec;
  refreshWindow?: { startMs: number; endMs: number } | null;
}

// Ad requests come from the player's own "Ad Request" logger events; Google Ad Manager requests are used when the
// player sends none.
function adRequestTimes(evidence: readonly CapturedEvidence[]): { source: string; times: number[] } {
  const started = new Map(evidence.filter((item) => item.source === "browser_network" && item.data.kind === "request" && typeof item.data.startedMs === "number")
    .map((item) => [item.evidenceId, item.data.startedMs as number]));
  const logger = evidence.filter((item) => item.source === "browser_logger" && item.data.kind === "logger_request")
    .filter((item) => {
      const fields = item.data.fields;
      const event = typeof fields === "object" && fields !== null && !Array.isArray(fields) ? fields.event : undefined;
      return ["adrequest", "trequest"].includes(looseEvent(event));
    })
    .map((item) => started.get(String(item.data.networkEvidenceId)))
    .filter((value): value is number => value !== undefined);
  if (logger.length > 0) return { source: "the player's Ad Request events", times: logger.sort((a, b) => a - b) };
  const gam = evidence.filter((item) => item.source === "browser_network" && item.data.kind === "request" && typeof item.data.url === "string" && typeof item.data.startedMs === "number")
    .filter((item) => {
      try {
        const url = new URL(String(item.data.url));
        return /(^|\.)(securepubads|pubads)\.g\.doubleclick\.net$/.test(url.hostname) && url.pathname.startsWith("/gampad/ads");
      } catch {
        return false;
      }
    })
    .map((item) => item.data.startedMs as number);
  return { source: "Google Ad Manager ad requests", times: gam.sort((a, b) => a - b) };
}

export function adCycles(times: readonly number[]): number[] {
  const cycles: number[] = [];
  for (const time of times) if (cycles.length === 0 || time - cycles.at(-1)! > AD_CYCLE_GAP_MS) cycles.push(time);
  return cycles;
}

export function validateSlotRefresh(input: SlotRefreshInput): ExtraCheck {
  const intervalMs = input.intervalSec * 1000;
  const { source, times } = adRequestTimes(input.evidence);
  const cycles = adCycles(times);
  const gaps = cycles.slice(1).map((time, index) => time - cycles[index]!);
  const onTime = gaps.find((gap) => gap >= intervalMs - REFRESH_EARLY_MS && gap <= intervalMs + REFRESH_LATE_MS);
  const window = input.refreshWindow ?? null;
  const waitedAfterLast = window === null || cycles.length === 0 ? 0 : window.endMs - cycles.at(-1)!;

  let verdict: Verdict;
  let summary: string;
  if (window === null) {
    verdict = "UNKNOWN";
    summary = "The visit ended before the refresh watch could run.";
  } else if (cycles.length === 0) {
    verdict = "UNKNOWN";
    summary = "The player never asked for an ad, so refresh could not be checked (see TC-9).";
  } else if (onTime !== undefined) {
    verdict = "PASS";
    summary = `A new ad was requested ${seconds(onTime)} s after the previous one (chosen interval ${input.intervalSec} s).`;
  } else if (gaps.length > 0) {
    verdict = "WARNING";
    summary = `The slot refreshed every ${gaps.map(seconds).join(", ")} s instead of every ${input.intervalSec} s.`;
  } else if (waitedAfterLast >= intervalMs + REFRESH_LATE_MS) {
    verdict = "FAIL";
    summary = `No new ad was requested in the ${seconds(waitedAfterLast)} s after the last ad request while the player was kept in view.`;
  } else {
    verdict = "UNKNOWN";
    summary = `The first ad request came late, so only ${seconds(waitedAfterLast)} s could be watched afterwards; ${input.intervalSec + REFRESH_LATE_MS / 1000} s are needed.`;
  }
  return {
    id: "SLOT_REFRESH",
    title: `Ad slot refresh (every ${input.intervalSec} s)`,
    checks: refreshChecks(input.intervalSec),
    meaning: REFRESH_MEANING[verdict],
    verdict,
    summary,
    details: {
      intervalSec: input.intervalSec,
      adRequestSource: source,
      adCycles: cycles.length,
      secondsBetweenAdCycles: gaps.map(seconds),
      watchedWithPlayerInViewSec: window === null ? 0 : seconds(window.endMs - window.startMs),
    },
  };
}
