import type { Page } from "playwright-core";
import { parseArticleEpoch, type ArticleEpoch } from "../contracts.js";
import type { CapturedBrowserEvidence } from "./capture.js";

export type ArticleAction =
  | { type: "click"; selector: string; expectedUrl: string; settleMs: number }
  | { type: "scroll"; x: number; y: number; expectedUrl: string; settleMs: number };

export interface ArticlePolicy {
  schemaVersion: number;
  policyId: string;
  profileId: string;
  status: "draft" | "confirmed";
  urlComparison: "strict";
  minimumDistinctArticles: number;
  revisit: "unknown" | "new_epoch" | "same_epoch";
  actions: ArticleAction[];
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

function httpUrl(value: unknown, path: string): string {
  const result = text(value, path);
  const url = new URL(result);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError(`${path} must be an HTTP(S) URL without credentials`);
  return result;
}

export function parseArticlePolicy(value: unknown): ArticlePolicy {
  const root = object(value, "articlePolicy");
  integer(root.schemaVersion, "articlePolicy.schemaVersion", 1);
  const status = text(root.status, "articlePolicy.status");
  if (status !== "draft" && status !== "confirmed") throw new TypeError("articlePolicy.status must be draft or confirmed");
  if (root.urlComparison !== "strict") throw new TypeError("articlePolicy.urlComparison must be strict");
  const revisit = text(root.revisit, "articlePolicy.revisit");
  if (!['unknown', 'new_epoch', 'same_epoch'].includes(revisit)) throw new TypeError("articlePolicy.revisit is unsupported");
  if (!Array.isArray(root.actions)) throw new TypeError("articlePolicy.actions must be an array");
  const actions = root.actions.map((value, index): ArticleAction => {
    const action = object(value, `articlePolicy.actions[${index}]`);
    const type = text(action.type, `articlePolicy.actions[${index}].type`);
    const common = {
      expectedUrl: httpUrl(action.expectedUrl, `articlePolicy.actions[${index}].expectedUrl`),
      settleMs: integer(action.settleMs, `articlePolicy.actions[${index}].settleMs`),
    };
    if (type === "click") return { type, selector: text(action.selector, `articlePolicy.actions[${index}].selector`), ...common };
    if (type === "scroll") return {
      type,
      x: integer(action.x, `articlePolicy.actions[${index}].x`),
      y: integer(action.y, `articlePolicy.actions[${index}].y`),
      ...common,
    };
    throw new TypeError(`articlePolicy.actions[${index}].type must be click or scroll`);
  });
  return {
    schemaVersion: Number(root.schemaVersion),
    policyId: text(root.policyId, "articlePolicy.policyId"),
    profileId: text(root.profileId, "articlePolicy.profileId"),
    status,
    urlComparison: "strict",
    minimumDistinctArticles: integer(root.minimumDistinctArticles, "articlePolicy.minimumDistinctArticles", 1),
    revisit: revisit as ArticlePolicy["revisit"],
    actions,
  };
}

export async function performArticleActions(page: Page, actions: readonly ArticleAction[], afterAction: () => Promise<void>): Promise<void> {
  for (const action of actions) {
    if (action.type === "click") await page.locator(action.selector).click();
    else await page.evaluate(({ x, y }) => scrollTo(x, y), { x: action.x, y: action.y });
    await page.waitForURL((url) => url.href === action.expectedUrl);
    if (action.settleMs > 0) await page.waitForTimeout(action.settleMs);
    await afterAction();
  }
}

export function buildArticleEpochs(input: {
  runId: string;
  targetUrl: string;
  startedAt: string;
  endedAt: string;
  capture: readonly CapturedBrowserEvidence[];
  revisit: ArticlePolicy["revisit"];
}): ArticleEpoch[] {
  const transitions = input.capture
    .filter((item) => item.source === "browser_dom" && item.data.kind === "article_transition" && typeof item.data.pageUrl === "string")
    .map((item) => ({ url: item.data.pageUrl as string, at: item.capturedAt }));
  const timeline = (transitions.length === 0 ? [{ url: input.targetUrl, at: input.startedAt }] : transitions)
    .filter((item) => {
      try { return ['http:', 'https:'].includes(new URL(item.url).protocol); } catch { return false; }
    })
    .sort((left, right) => left.at.localeCompare(right.at));
  const selected: typeof timeline = [];
  for (const item of timeline) {
    const previous = selected.at(-1);
    if (previous?.url === item.url && input.revisit !== "new_epoch") continue;
    selected.push(item);
  }
  if (selected.length === 0) selected.push({ url: input.targetUrl, at: input.startedAt });
  const logicalIds = new Map<string, string>();
  return selected.map((item, sequence) => parseArticleEpoch({
    schemaVersion: 1,
    articleEpochId: input.revisit === "same_epoch"
      ? logicalIds.get(item.url) ?? (() => { const id = `${input.runId}-article-${logicalIds.size + 1}`; logicalIds.set(item.url, id); return id; })()
      : `${input.runId}-article-${sequence + 1}`,
    runId: input.runId,
    sequence,
    url: item.url,
    startedAt: item.at,
    endedAt: selected[sequence + 1]?.at ?? input.endedAt,
  }));
}
