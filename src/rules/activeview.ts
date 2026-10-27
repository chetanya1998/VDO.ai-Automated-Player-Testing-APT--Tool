import type { Evidence, IssueCategory, JsonValue, Verdict } from "../contracts.js";
import type { ViewabilityValidation } from "./viewability.js";

// Google Active View pingbacks (Tech Doc, "How to Use Chrome Dev Tools to Monitor Active View Pingbacks"):
// bs = browser size (negative = not measurable), mtos = continuous ms on screen per visibility bucket
// [100%, 75-99%, 50-74%, 25-49%, 1-24%], p = creative position top,left,bottom,right (zero height or negative = not viewable).

export interface ActiveViewPingback {
  evidenceId: string;
  measurable: boolean;
  msAtLeastHalfVisible: number | null;
  zeroHeightOrOffscreen: boolean;
}

export interface ActiveViewSummary {
  pingbacks: ActiveViewPingback[];
  measurable: boolean;
  viewable: boolean | null;
  requiredMs: number;
  reasons: string[];
}

function numbers(value: string | null): number[] | null {
  if (value === null || value.trim() === "") return null;
  const parsed = value.split(",").map((item) => Number(item));
  return parsed.every((item) => Number.isFinite(item)) ? parsed : null;
}

export function summarizeActiveView(evidence: readonly Evidence[], requiredMs: number): ActiveViewSummary {
  const pingbacks = evidence.flatMap((item): ActiveViewPingback[] => {
    if (item.source !== "browser_network" || item.data.kind !== "request" || typeof item.data.url !== "string") return [];
    let url: URL;
    try { url = new URL(item.data.url); } catch { return []; }
    if (!/activeview/i.test(url.pathname + url.search)) return [];
    const bs = numbers(url.searchParams.get("bs"));
    const mtos = numbers(url.searchParams.get("mtos"));
    const p = numbers(url.searchParams.get("p"));
    const measurable = bs !== null && bs.length >= 2 && bs.every((value) => value >= 0);
    // Buckets are cumulative, so the third value is the continuous time with at least 50% on screen.
    const msAtLeastHalfVisible = mtos !== null && mtos.length >= 3 ? mtos[2]! : null;
    const zeroHeightOrOffscreen = p !== null && p.length === 4 && (p.some((value) => value < 0) || p[2]! - p[0]! <= 0 || p[3]! - p[1]! <= 0);
    return [{ evidenceId: item.evidenceId, measurable, msAtLeastHalfVisible, zeroHeightOrOffscreen }];
  });
  const reasons: string[] = [];
  const measured = pingbacks.filter((item) => item.measurable && item.msAtLeastHalfVisible !== null);
  if (pingbacks.length === 0) reasons.push("no Active View pingbacks captured");
  else if (measured.length === 0) reasons.push("Active View reported the creative as not measurable");
  const viewable = measured.length === 0 ? null
    : measured.some((item) => item.msAtLeastHalfVisible! >= requiredMs && !item.zeroHeightOrOffscreen);
  if (viewable === false) reasons.push(`no pingback showed at least 50% on screen for ${requiredMs} ms`);
  if (pingbacks.some((item) => item.zeroHeightOrOffscreen)) reasons.push("a pingback placed the creative off screen or at zero size");
  return { pingbacks, measurable: measured.length > 0, viewable, requiredMs, reasons };
}

const GEOMETRY_GAPS = new Set(["frame_geometry_unobservable", "visibility_samples_unavailable"]);

// Our own sampling cannot see inside cross-origin ad frames; a measurable Active View pingback can settle viewability there.
export function applyActiveViewEvidence(validation: ViewabilityValidation, summary: ActiveViewSummary, policyConfirmed: boolean): ViewabilityValidation {
  const observed = typeof validation.observed === "object" && validation.observed !== null && !Array.isArray(validation.observed) ? validation.observed : { value: validation.observed };
  const activeView = { measurable: summary.measurable, viewable: summary.viewable, requiredMs: summary.requiredMs, reasons: summary.reasons, pingbacks: summary.pingbacks as unknown as JsonValue };
  const withEvidence = { ...validation, observed: { ...observed, activeView }, evidenceIds: [...new Set([...validation.evidenceIds, ...summary.pingbacks.map((item) => item.evidenceId)])] };
  const state = typeof observed.state === "string" ? observed.state : null;
  if (!policyConfirmed || validation.verdict !== "UNKNOWN" || state === null || !GEOMETRY_GAPS.has(state) || summary.viewable === null) return withEvidence;
  const verdict: Verdict = summary.viewable ? "PASS" : "FAIL";
  const category: IssueCategory = summary.viewable ? "NONE" : "RUNTIME_BROWSER";
  return { ...withEvidence, verdict, category, sufficientExposure: summary.viewable, observed: { ...withEvidence.observed, state: null, settledBy: "active_view_pingback" } };
}
