import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildArticleEpochs, parseArticlePolicy, performArticleActions, type ArticlePolicy } from "../src/browser/articles.js";
import type { Page } from "playwright-core";
import type { CapturedBrowserEvidence } from "../src/browser/capture.js";
import { parseArticleEpoch, parseEvidence, type ArticleEpoch, type Evidence } from "../src/contracts.js";
import { validateArticles } from "../src/rules/articles.js";
import { parseEventRulePolicy } from "../src/rules/events.js";

const deviceId = "desktop-chromium";
const tag = "v-example-site";

async function policies(): Promise<{ article: ArticlePolicy; events: ReturnType<typeof parseEventRulePolicy> }> {
  const article = JSON.parse(await readFile("config/article-policy.json", "utf8"));
  article.status = "confirmed";
  const events = JSON.parse(await readFile("config/event-rules.json", "utf8"));
  events.status = "confirmed";
  return { article: parseArticlePolicy(article), events: parseEventRulePolicy(events) };
}

function epochs(urls = ["https://publisher.example/articles/one", "https://publisher.example/articles/two", "https://publisher.example/articles/three"]): ArticleEpoch[] {
  return urls.map((url, sequence) => parseArticleEpoch({
    schemaVersion: 1,
    articleEpochId: `run-1-article-${sequence + 1}`,
    runId: "run-1",
    sequence,
    url,
    startedAt: new Date(Date.parse("2026-10-15T00:00:00.000Z") + sequence * 1_000).toISOString(),
    endedAt: new Date(Date.parse("2026-10-15T00:00:00.999Z") + sequence * 1_000).toISOString(),
  }));
}

function event(epoch: ArticleEpoch, name: string, sequence: number, options: { tagName?: string; pageUrl?: string; displayedUrl?: string; domainName?: string; dep?: string } = {}): Evidence {
  const pageUrl = options.pageUrl ?? epoch.url;
  return parseEvidence({
    schemaVersion: 1,
    evidenceId: `${epoch.articleEpochId}-${options.tagName ?? tag}-${name}-${sequence}`,
    runId: "run-1",
    articleEpochId: epoch.articleEpochId,
    deviceId,
    source: "browser_logger",
    capturedAt: epoch.startedAt,
    data: {
      kind: "logger_request",
      canonicalEvent: name,
      fields: {
        event: name,
        tagName: options.tagName ?? tag,
        domainName: options.domainName ?? "publisher.example",
        page_url: pageUrl,
        dep: options.dep ?? "dependencies_fixture_1",
      },
      displayedUrlAtRequestStart: options.displayedUrl ?? epoch.url,
      pageUrlStrictMatch: pageUrl === (options.displayedUrl ?? epoch.url),
      physicalLoadId: "load-1",
    },
  });
}

function healthyEvidence(articleEpochs: readonly ArticleEpoch[], tags = [tag]): Evidence[] {
  return articleEpochs.flatMap((epoch, epochIndex) => [
    ...tags.flatMap((tagName, tagIndex) => [
      event(epoch, "loaded", epochIndex * 20 + tagIndex * 2, { tagName }),
      event(epoch, "pageview", epochIndex * 20 + tagIndex * 2 + 1, { tagName }),
    ]),
    event(epoch, "website_pageview", epochIndex * 20 + 19, { tagName: tags[0]! }),
  ]);
}

async function checks(evidence: Evidence[], articleEpochs = epochs(), tags = [tag], captureComplete = true) {
  const policy = await policies();
  return Object.fromEntries(validateArticles({
    evidence,
    articleEpochs,
    articlePolicy: policy.article,
    eventPolicy: policy.events,
    deviceId,
    activeTags: tags,
    expectedDomainName: "publisher.example",
    captureComplete,
  }).map((check) => [check.testCaseId, check]));
}

test("strict policy rejects URL normalization and article epochs retain same-document transitions", async () => {
  const policy = JSON.parse(await readFile("config/article-policy.json", "utf8"));
  policy.urlComparison = "ignore_hash";
  assert.throws(() => parseArticlePolicy(policy), /must be strict/);

  const capture: CapturedBrowserEvidence[] = [
    { evidenceId: "browser-0", source: "browser_dom", capturedAt: "2026-10-15T00:00:00.100Z", data: { kind: "article_transition", pageUrl: "https://publisher.example/articles/one" } },
    { evidenceId: "browser-1", source: "browser_dom", capturedAt: "2026-10-15T00:00:01.000Z", data: { kind: "article_transition", pageUrl: "https://publisher.example/articles/two" } },
    { evidenceId: "browser-2", source: "browser_dom", capturedAt: "2026-10-15T00:00:02.000Z", data: { kind: "article_transition", pageUrl: "https://publisher.example/articles/three#section" } },
  ];
  const result = buildArticleEpochs({ runId: "run-1", targetUrl: "https://publisher.example/articles/one", startedAt: "2026-10-15T00:00:00.000Z", endedAt: "2026-10-15T00:00:03.000Z", capture, revisit: "unknown" });
  assert.deepEqual(result.map((epoch) => epoch.url), ["https://publisher.example/articles/one", "https://publisher.example/articles/two", "https://publisher.example/articles/three#section"]);
  assert.equal(result[0]?.endedAt, result[1]?.startedAt);

  const redirected = buildArticleEpochs({ runId: "run-2", targetUrl: "https://publisher.example/redirect", startedAt: "2026-10-15T00:00:00.000Z", endedAt: "2026-10-15T00:00:01.000Z", capture: [capture[0]!], revisit: "unknown" });
  assert.deepEqual(redirected.map((epoch) => epoch.url), ["https://publisher.example/articles/one"]);

  const revisitCapture = [...capture, { evidenceId: "browser-3", source: "browser_dom" as const, capturedAt: "2026-10-15T00:00:03.000Z", data: { kind: "article_transition", pageUrl: "https://publisher.example/articles/one" } }];
  const sameEpoch = buildArticleEpochs({ runId: "run-3", targetUrl: "https://publisher.example/articles/one", startedAt: "2026-10-15T00:00:00.000Z", endedAt: "2026-10-15T00:00:04.000Z", capture: revisitCapture, revisit: "same_epoch" });
  assert.equal(sameEpoch[0]?.articleEpochId, sameEpoch[3]?.articleEpochId);
  const newEpoch = buildArticleEpochs({ runId: "run-4", targetUrl: "https://publisher.example/articles/one", startedAt: "2026-10-15T00:00:00.000Z", endedAt: "2026-10-15T00:00:04.000Z", capture: revisitCapture, revisit: "new_epoch" });
  assert.notEqual(newEpoch[0]?.articleEpochId, newEpoch[3]?.articleEpochId);
});

test("profile actions execute only bounded click and scroll transitions and wait for exact URLs", async () => {
  const calls: string[] = [];
  let current = "https://publisher.example/articles/one";
  const page = {
    locator: (selector: string) => ({ click: async () => { calls.push(`click:${selector}`); current = "https://publisher.example/articles/two"; } }),
    evaluate: async (_fn: unknown, point: { x: number; y: number }) => { calls.push(`scroll:${point.x},${point.y}`); current = "https://publisher.example/articles/three"; },
    waitForURL: async (predicate: (url: URL) => boolean) => { assert.equal(predicate(new URL(current)), true); },
    waitForTimeout: async (milliseconds: number) => { calls.push(`wait:${milliseconds}`); },
  } as unknown as Page;
  let snapshots = 0;
  await performArticleActions(page, [
    { type: "click", selector: "#next", expectedUrl: "https://publisher.example/articles/two", settleMs: 10 },
    { type: "scroll", x: 0, y: 900, expectedUrl: "https://publisher.example/articles/three", settleMs: 0 },
  ], async () => { snapshots += 1; });
  assert.deepEqual(calls, ["click:#next", "wait:10", "scroll:0,900"]);
  assert.equal(snapshots, 2);
});

test("three healthy article transitions pass strict URLs and per-tag lifecycle counts", async () => {
  const articleEpochs = epochs();
  const result = await checks(healthyEvidence(articleEpochs), articleEpochs);
  for (const id of ["TC-7", "TC-17", "TC-21", "TC-22", "TC-23"]) assert.equal(result[id]?.verdict, "PASS", id);
});

test("multiple legitimate tags are isolated per article while Website Pageview remains article-wide", async () => {
  const articleEpochs = epochs();
  const tags = [tag, "v-example-site-v2"];
  const result = await checks(healthyEvidence(articleEpochs, tags), articleEpochs, tags);
  assert.equal(result["TC-7"]?.verdict, "PASS");
  assert.equal(result["TC-22"]?.verdict, "PASS");
  assert.equal(result["TC-17"]?.verdict, "PASS");
});

test("duplicate events, missing loaded, and loaded without Pageview fail independently", async () => {
  const articleEpochs = epochs();
  const duplicate = healthyEvidence(articleEpochs);
  duplicate.push(event(articleEpochs[1]!, "loaded", 90));
  assert.equal((await checks(duplicate, articleEpochs))["TC-22"]?.verdict, "FAIL");

  const missingLoaded = healthyEvidence(articleEpochs).filter((item) => !(item.articleEpochId === articleEpochs[1]!.articleEpochId && item.data.canonicalEvent === "loaded"));
  assert.equal((await checks(missingLoaded, articleEpochs))["TC-22"]?.verdict, "FAIL");

  const loadedWithoutPageview = healthyEvidence(articleEpochs).filter((item) => !(item.articleEpochId === articleEpochs[2]!.articleEpochId && item.data.canonicalEvent === "pageview"));
  const result = await checks(loadedWithoutPageview, articleEpochs);
  assert.equal(result["TC-7"]?.verdict, "FAIL");
  assert.equal(result["TC-22"]?.verdict, "FAIL");
});

test("stale article URLs fail strict event-time comparison and preserve the source URL group", async () => {
  const articleEpochs = epochs();
  const evidence = healthyEvidence(articleEpochs);
  evidence.push(event(articleEpochs[2]!, "ad_request", 99, { pageUrl: articleEpochs[1]!.url }));
  const result = await checks(evidence, articleEpochs);
  assert.equal(result["TC-21"]?.verdict, "FAIL");
  assert.equal(result["TC-17"]?.verdict, "FAIL");
  assert.equal(result["TC-23"]?.verdict, "FAIL");
  assert.match(JSON.stringify(result["TC-21"]?.observed), /articles\/two/);
});

test("query, hash, and trailing-slash variants remain strict mismatches", async () => {
  const articleEpochs = epochs();
  for (const pageUrl of [`${articleEpochs[0]!.url}?mode=reader`, `${articleEpochs[0]!.url}#comments`, `${articleEpochs[0]!.url}/`]) {
    const evidence = healthyEvidence(articleEpochs);
    evidence.push(event(articleEpochs[0]!, "ad_request", evidence.length, { pageUrl }));
    assert.equal((await checks(evidence, articleEpochs))["TC-21"]?.verdict, "FAIL", pageUrl);
  }
});

test("a prior-article logger response retains its request-start article scope", async () => {
  const articleEpochs = epochs();
  const delayed = event(articleEpochs[0]!, "ad_request", 100, { pageUrl: articleEpochs[0]!.url, displayedUrl: articleEpochs[0]!.url });
  delayed.capturedAt = articleEpochs[1]!.startedAt;
  const result = await checks([...healthyEvidence(articleEpochs), delayed], articleEpochs);
  assert.equal(result["TC-21"]?.verdict, "PASS");
  assert.equal(delayed.articleEpochId, articleEpochs[0]!.articleEpochId);
});

test("fewer than three distinct articles is incomplete coverage rather than a product failure", async () => {
  const articleEpochs = epochs().slice(0, 2);
  const result = await checks(healthyEvidence(articleEpochs), articleEpochs);
  assert.equal(result["TC-23"]?.verdict, "UNKNOWN");
  assert.equal(result["TC-22"]?.verdict, "PASS");
});
