import type { Page } from "playwright-core";

export interface VisibilitySnapshot {
  sampledMs: number;
  reason: "after_load" | "interval" | "logger_event";
  triggerNetworkEvidenceId: string | null;
  triggerEvent: string | null;
  viewport: { width: number; height: number; scrollX: number; scrollY: number };
  players: Array<{
    id: string;
    tagName: string | null;
    tag: string;
    playerState: string | null;
    present: true;
    formed: boolean;
    frameAccessible: boolean | null;
    viewportState: "in_view" | "below_viewport" | "above_viewport";
    visiblePercent: number;
    geometricVisiblePercent: number;
    occlusionPercent: number;
    occlusionSamplePoints: number;
    rect: { x: number; y: number; width: number; height: number; top: number; right: number; bottom: number; left: number };
    clippedRect: { top: number; right: number; bottom: number; left: number; width: number; height: number };
    style: { display: string; visibility: string; opacity: string; position: string; zIndex: string; transform: string; overflowX: string; overflowY: string };
    ancestors: Array<{ tag: string; id: string; display: string; visibility: string; opacity: string; overflowX: string; overflowY: string; position: string; zIndex: string; transform: string }>;
    occluders: Array<{ tag: string; id: string; zIndex: string }>;
    blockers: string[];
  }>;
}

export async function captureVisibilitySnapshot(page: Page, input: {
  sampledMs: number;
  reason: VisibilitySnapshot["reason"];
  triggerNetworkEvidenceId?: string | null;
  triggerEvent?: string | null;
}): Promise<VisibilitySnapshot> {
  return page.evaluate((options) => {
    const selector = "[data-synthetic-player], [data-vdo-player], [id^='v-'], iframe";
    const hiddenOverflow = new Set(["hidden", "clip", "scroll", "auto"]);
    const round = (value: number) => Math.round(value * 100) / 100;
    const intersect = (left: { top: number; right: number; bottom: number; left: number }, right: { top: number; right: number; bottom: number; left: number }) => ({
      top: Math.max(left.top, right.top),
      right: Math.min(left.right, right.right),
      bottom: Math.min(left.bottom, right.bottom),
      left: Math.max(left.left, right.left),
    });
    const area = (rect: { top: number; right: number; bottom: number; left: number }) => Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);
    const players = Array.from(document.querySelectorAll<HTMLElement>(selector)).slice(0, 50).map((element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const ancestors: VisibilitySnapshot["players"][number]["ancestors"] = [];
      const blockers: string[] = [];
      let clipped = { top: 0, right: innerWidth, bottom: innerHeight, left: 0 };
      let ancestor = element.parentElement;
      while (ancestor !== null && ancestors.length < 16) {
        const ancestorStyle = getComputedStyle(ancestor);
        ancestors.push({
          tag: ancestor.tagName.toLowerCase(), id: ancestor.id, display: ancestorStyle.display,
          visibility: ancestorStyle.visibility, opacity: ancestorStyle.opacity, overflowX: ancestorStyle.overflowX,
          overflowY: ancestorStyle.overflowY, position: ancestorStyle.position, zIndex: ancestorStyle.zIndex,
          transform: ancestorStyle.transform,
        });
        if (ancestorStyle.display === "none") blockers.push("ancestor_display_none");
        if (ancestorStyle.visibility === "hidden" || ancestorStyle.visibility === "collapse") blockers.push("ancestor_visibility_hidden");
        if (Number(ancestorStyle.opacity) === 0) blockers.push("ancestor_opacity_zero");
        if (hiddenOverflow.has(ancestorStyle.overflowX) || hiddenOverflow.has(ancestorStyle.overflowY)) {
          const ancestorBounds = ancestor.getBoundingClientRect();
          clipped = intersect(clipped, {
            top: hiddenOverflow.has(ancestorStyle.overflowY) ? ancestorBounds.top : clipped.top,
            right: hiddenOverflow.has(ancestorStyle.overflowX) ? ancestorBounds.right : clipped.right,
            bottom: hiddenOverflow.has(ancestorStyle.overflowY) ? ancestorBounds.bottom : clipped.bottom,
            left: hiddenOverflow.has(ancestorStyle.overflowX) ? ancestorBounds.left : clipped.left,
          });
        }
        ancestor = ancestor.parentElement;
      }
      const viewportClipped = intersect({ top: 0, right: innerWidth, bottom: innerHeight, left: 0 }, { top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left });
      clipped = intersect(clipped, { top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left });
      const totalArea = Math.max(0, bounds.width) * Math.max(0, bounds.height);
      const clippedArea = area(clipped);
      const geometricVisiblePercent = totalArea === 0 ? 0 : Math.min(100, clippedArea / totalArea * 100);
      const occluders = new Map<string, { tag: string; id: string; zIndex: string }>();
      let testedPoints = 0;
      let visiblePoints = 0;
      if (clippedArea > 0) {
        for (let row = 0; row < 10; row += 1) for (let column = 0; column < 10; column += 1) {
          const x = clipped.left + (column + 0.5) * (clipped.right - clipped.left) / 10;
          const y = clipped.top + (row + 0.5) * (clipped.bottom - clipped.top) / 10;
          const hit = document.elementsFromPoint(x, y)[0];
          testedPoints += 1;
          if (hit !== undefined && (hit === element || element.contains(hit))) visiblePoints += 1;
          else if (hit !== undefined && occluders.size < 10) {
            const hitStyle = getComputedStyle(hit);
            occluders.set(`${hit.tagName}:${(hit as HTMLElement).id}`, { tag: hit.tagName.toLowerCase(), id: (hit as HTMLElement).id, zIndex: hitStyle.zIndex });
          }
        }
      }
      const occlusionPercent = testedPoints === 0 ? 0 : visiblePoints / testedPoints * 100;
      const visiblePercent = geometricVisiblePercent * occlusionPercent / 100;
      const playerState = element.dataset.syntheticPlayer ?? element.dataset.vdoPlayer ?? null;
      const formed = element instanceof HTMLIFrameElement || playerState !== null || element.querySelector("video,iframe,[data-vdo-player]") !== null;
      let frameAccessible: boolean | null = null;
      if (element instanceof HTMLIFrameElement) {
        try { frameAccessible = element.contentDocument?.documentElement !== undefined && element.contentDocument?.documentElement !== null; }
        catch { frameAccessible = false; }
      }
      if (style.display === "none") blockers.push("display_none");
      if (style.visibility === "hidden" || style.visibility === "collapse") blockers.push("visibility_hidden");
      if (Number(style.opacity) === 0) blockers.push("opacity_zero");
      if (bounds.width <= 0 || bounds.height <= 0) blockers.push("zero_dimensions");
      if (area(viewportClipped) < totalArea) blockers.push("outside_viewport");
      if (clippedArea < area(viewportClipped)) blockers.push("ancestor_clipped");
      if (occlusionPercent < 100 && clippedArea > 0) blockers.push("occluded");
      if (frameAccessible === false) blockers.push("frame_geometry_unobservable");
      const closestTag = element.closest<HTMLElement>("[id^='v-']")?.id ?? null;
      return {
        id: element.id,
        tagName: element.dataset.tagName ?? (/^v-[a-z0-9-]+$/i.test(element.id) ? element.id : closestTag),
        tag: element.tagName.toLowerCase(),
        playerState,
        present: true as const,
        formed,
        frameAccessible,
        viewportState: bounds.bottom <= 0 ? "above_viewport" as const : bounds.top >= innerHeight ? "below_viewport" as const : "in_view" as const,
        visiblePercent: round(visiblePercent),
        geometricVisiblePercent: round(geometricVisiblePercent),
        occlusionPercent: round(occlusionPercent),
        occlusionSamplePoints: testedPoints,
        rect: { x: round(bounds.x), y: round(bounds.y), width: round(bounds.width), height: round(bounds.height), top: round(bounds.top), right: round(bounds.right), bottom: round(bounds.bottom), left: round(bounds.left) },
        clippedRect: { top: round(clipped.top), right: round(clipped.right), bottom: round(clipped.bottom), left: round(clipped.left), width: round(Math.max(0, clipped.right - clipped.left)), height: round(Math.max(0, clipped.bottom - clipped.top)) },
        style: { display: style.display, visibility: style.visibility, opacity: style.opacity, position: style.position, zIndex: style.zIndex, transform: style.transform, overflowX: style.overflowX, overflowY: style.overflowY },
        ancestors,
        occluders: [...occluders.values()],
        blockers: [...new Set(blockers)],
      };
    });
    return {
      sampledMs: options.sampledMs,
      reason: options.reason,
      triggerNetworkEvidenceId: options.triggerNetworkEvidenceId ?? null,
      triggerEvent: options.triggerEvent ?? null,
      viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
      players,
    };
  }, input);
}
