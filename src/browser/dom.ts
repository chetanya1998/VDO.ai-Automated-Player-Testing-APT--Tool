import type { Page } from "playwright-core";

export interface DomAnchorSnapshot {
  id: string;
  tag: string;
  parentLandmark: string | null;
  placement: "body_content" | "header" | "footer" | "outside_body";
}

export interface DomScriptSnapshot {
  src: string;
  tagNameFromUrl: string | null;
  scriptType: string;
  parentLandmark: string | null;
}

export interface DomBootstrapSnapshot {
  referencedTags: string[];
  parentLandmark: string | null;
}

export interface DomMutationSnapshot {
  kind: "anchor" | "external_script";
  identity: string;
  tagName: string | null;
  added: number;
  removed: number;
  moved?: number;
}

export interface DomPlayerSnapshot {
  tag: string;
  id: string;
  playerState: string | null;
  width: number;
  height: number;
  visible: boolean;
}

export interface DomSnapshot {
  anchors: DomAnchorSnapshot[];
  externalScripts: DomScriptSnapshot[];
  bootstrapScripts: DomBootstrapSnapshot[];
  mutations: DomMutationSnapshot[];
  players: DomPlayerSnapshot[];
}

export const DOM_TRACKER_INIT_SCRIPT = `(() => {
  const key = "__vdoDomTracker";
  const state = { entries: new Map() };
  // Count elements, not mutation records: one element can appear in several records while the page is parsed.
  // A node removed and re-inserted (custom placement moving the anchor) is a move, not a recreation.
  const attached = new WeakSet();
  const detached = new WeakSet();
  const tagPattern = /^[vcsb]-[a-z0-9-]+$/i;
  const loaderTag = (value) => {
    try { return /\\/core\\/([^/]+)\\/vdo\\.ai\\.js$/i.exec(new URL(value, location.href).pathname)?.[1] ?? null; }
    catch { return null; }
  };
  const record = (kind, identity, tagName, action, element) => {
    const id = kind + ":" + identity;
    const entry = state.entries.get(id) ?? { kind, identity, tagName, added: 0, removed: 0, moved: 0 };
    if (action === "added") {
      if (attached.has(element)) return;
      attached.add(element);
      if (detached.has(element)) {
        detached.delete(element);
        entry.removed -= 1;
        entry.moved += 1;
      } else {
        entry.added += 1;
      }
    } else {
      if (!attached.has(element)) return;
      attached.delete(element);
      detached.add(element);
      entry.removed += 1;
    }
    state.entries.set(id, entry);
  };
  const visit = (node, action) => {
    if (!(node instanceof Element)) return;
    const elements = [node, ...node.querySelectorAll("[id],script[src]")];
    for (const element of elements) {
      if (element.id && tagPattern.test(element.id)) record("anchor", element.id, element.id, action, element);
      if (element instanceof HTMLScriptElement && element.src) {
        const tagName = loaderTag(element.src);
        if (tagName) record("external_script", element.src, tagName, action, element);
      }
    }
  };
  new MutationObserver((records) => {
    for (const mutation of records) {
      for (const node of mutation.addedNodes) visit(node, "added");
      for (const node of mutation.removedNodes) visit(node, "removed");
    }
  }).observe(document, { childList: true, subtree: true });
  Object.defineProperty(globalThis, key, { value: state, configurable: false });
})();`;

export async function captureDomSnapshot(page: Page): Promise<DomSnapshot> {
  return page.evaluate(() => {
    const landmark = (element: Element): string | null => element.closest("header,footer,main,article,body")?.tagName.toLowerCase() ?? null;
    const loaderTag = (value: string): string | null => {
      try { return /\/core\/([^/]+)\/vdo\.ai\.js$/i.exec(new URL(value, location.href).pathname)?.[1] ?? null; }
      catch { return null; }
    };
    const anchors = Array.from(document.querySelectorAll<HTMLElement>("[id]"))
      .filter((element) => /^[vcsb]-[a-z0-9-]+$/i.test(element.id))
      .slice(0, 100)
      .map((element) => {
        const parentLandmark = landmark(element);
        const placement: DomAnchorSnapshot["placement"] = !document.body?.contains(element) ? "outside_body"
          : parentLandmark === "header" ? "header"
            : parentLandmark === "footer" ? "footer" : "body_content";
        return { id: element.id, tag: element.tagName.toLowerCase(), parentLandmark, placement };
      });
    const externalScripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"))
      .map((script) => ({
        src: script.src,
        tagNameFromUrl: loaderTag(script.src),
        scriptType: script.type || "classic",
        parentLandmark: landmark(script),
      }))
      .filter((script) => script.tagNameFromUrl !== null)
      .slice(0, 100);
    const bootstrapScripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script:not([src])"))
      .map((script) => ({
        referencedTags: [...new Set(Array.from(script.textContent?.matchAll(/\/core\/([a-z0-9-]+)\/vdo\.ai\.js/gi) ?? []).map((match) => match[1]!).filter(Boolean))],
        parentLandmark: landmark(script),
      }))
      .filter((script) => script.referencedTags.length > 0)
      .slice(0, 100);
    const players = Array.from(document.querySelectorAll<HTMLElement>("[data-synthetic-player], [id^='v-'], iframe")).slice(0, 50).map((element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id,
        playerState: element.dataset.syntheticPlayer ?? null,
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        visible: style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0,
      };
    });
    const tracker = (globalThis as typeof globalThis & {
      __vdoDomTracker?: { entries: Map<string, DomMutationSnapshot> };
    }).__vdoDomTracker;
    const mutations = tracker === undefined ? [] : [...tracker.entries.values()].slice(0, 200);
    return { anchors, externalScripts, bootstrapScripts, mutations, players };
  });
}
