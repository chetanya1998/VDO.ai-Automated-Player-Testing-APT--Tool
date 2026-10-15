import type { ArticleEpoch, CheckResult, Evidence, JsonValue, Verdict } from "../contracts.js";
import type { ArticlePolicy } from "../browser/articles.js";
import type { EventRulePolicy } from "./events.js";

export interface ArticleValidationInput {
  evidence: readonly Evidence[];
  articleEpochs: readonly ArticleEpoch[];
  articlePolicy: ArticlePolicy;
  eventPolicy: EventRulePolicy;
  deviceId: string;
  activeTags: readonly string[];
  expectedDomainName: string;
  captureComplete: boolean;
}

interface LoggerEvent {
  evidenceId: string;
  articleEpochId: string;
  canonicalEvent: string | null;
  tagName: string | null;
  domainName: string | null;
  pageUrl: string | null;
  displayedUrlAtRequestStart: string | null;
  strictUrlMatch: boolean | null;
  dep: string | null;
}

function text(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function fields(item: Evidence): { [key: string]: JsonValue } {
  const value = item.data.fields;
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function loggerEvents(input: ArticleValidationInput): LoggerEvent[] {
  return input.evidence.flatMap((item) => {
    if (item.source !== "browser_logger" || item.deviceId !== input.deviceId) return [];
    const value = fields(item);
    return [{
      evidenceId: item.evidenceId,
      articleEpochId: item.articleEpochId,
      canonicalEvent: text(item.data.canonicalEvent),
      tagName: text(value.tagName),
      domainName: text(value.domainName),
      pageUrl: text(value.page_url),
      displayedUrlAtRequestStart: text(item.data.displayedUrlAtRequestStart),
      strictUrlMatch: typeof item.data.pageUrlStrictMatch === "boolean" ? item.data.pageUrlStrictMatch : null,
      dep: text(value.dep),
    }];
  });
}

function result(input: ArticleValidationInput, testCaseId: "TC-7" | "TC-17" | "TC-21" | "TC-22" | "TC-23", verdict: Verdict, expected: JsonValue, observed: JsonValue, evidenceIds: readonly string[]): CheckResult {
  return {
    testCaseId,
    verdict,
    category: verdict === "PASS" || verdict === "NOT_APPLICABLE" ? "NONE" : verdict === "FAIL" ? "IMPLEMENTATION" : "TOOLING",
    scope: { deviceId: input.deviceId, articleEpochId: null, tagName: null },
    expected,
    observed,
    evidenceIds: [...new Set(evidenceIds)],
  };
}

function verdict(input: ArticleValidationInput, failures: readonly string[], proven: boolean): Verdict {
  if (failures.length === 0) return input.captureComplete ? "PASS" : "UNKNOWN";
  if (proven) return "FAIL";
  return input.captureComplete ? "FAIL" : "UNKNOWN";
}

export function validateArticles(input: ArticleValidationInput): CheckResult[] {
  if (input.articlePolicy.urlComparison !== "strict") throw new TypeError("only strict article URL comparison is implemented");
  const events = loggerEvents(input);
  const logicalEpochs = [...new Map(input.articleEpochs.map((epoch) => [epoch.articleEpochId, epoch])).values()];
  const allEvidenceIds = input.evidence.filter((item) => item.deviceId === input.deviceId).map((item) => item.evidenceId);
  const eventIds = events.map((event) => event.evidenceId);

  const urlMismatches = events.filter((event) => event.strictUrlMatch === false || (event.strictUrlMatch === null && event.pageUrl !== null && event.displayedUrlAtRequestStart !== null && event.pageUrl !== event.displayedUrlAtRequestStart));
  const missingUrls = events.filter((event) => event.pageUrl === null || event.displayedUrlAtRequestStart === null);
  const urlVerdict: Verdict = urlMismatches.length > 0 ? "FAIL"
    : events.length === 0 || missingUrls.length > 0 || !input.captureComplete ? "UNKNOWN" : "PASS";
  const tc21 = result(input, "TC-21", urlVerdict, { comparison: "strict", basis: "request_start_displayed_url" }, {
    comparisons: events.map((event) => ({ evidenceId: event.evidenceId, pageUrl: event.pageUrl, displayedUrlAtRequestStart: event.displayedUrlAtRequestStart, matches: event.strictUrlMatch ?? (event.pageUrl === null || event.displayedUrlAtRequestStart === null ? null : event.pageUrl === event.displayedUrlAtRequestStart) })),
    mismatches: urlMismatches.map((event) => event.evidenceId),
    missingUrlEvidence: missingUrls.map((event) => event.evidenceId),
  }, urlMismatches.length > 0 ? urlMismatches.map((event) => event.evidenceId) : eventIds);

  const identityMismatches = events.flatMap((event) => {
    const issues: string[] = [];
    if (event.tagName !== null && !input.activeTags.includes(event.tagName)) issues.push("unapproved tagName");
    if (event.domainName !== null && event.domainName !== input.expectedDomainName) issues.push("wrong domainName");
    if (event.strictUrlMatch === false || (event.strictUrlMatch === null && event.pageUrl !== null && event.displayedUrlAtRequestStart !== null && event.pageUrl !== event.displayedUrlAtRequestStart)) issues.push("stale page_url");
    return issues.length === 0 ? [] : [{ evidenceId: event.evidenceId, issues }];
  });
  const missingIdentity = events.filter((event) => event.tagName === null || event.domainName === null || event.pageUrl === null || event.dep === null);
  const deps = [...new Set(events.flatMap((event) => event.dep === null ? [] : [event.dep]))];
  if (deps.length > 1) identityMismatches.push({ evidenceId: events.find((event) => event.dep === deps[1])?.evidenceId ?? eventIds[0]!, issues: ["dep changed within physical page load"] });
  const tc17Verdict: Verdict = identityMismatches.length > 0 ? "FAIL"
    : events.length === 0 || missingIdentity.length > 0 || !input.captureComplete ? "UNKNOWN" : "PASS";
  const tc17 = result(input, "TC-17", tc17Verdict, { activeTags: input.activeTags as string[], domainName: input.expectedDomainName, pageUrl: "request-start article URL", dep: "one value per physical load" }, {
    mismatches: identityMismatches,
    missingFields: missingIdentity.map((event) => event.evidenceId),
    depValues: deps,
  }, identityMismatches.length > 0 ? identityMismatches.map((item) => item.evidenceId) : eventIds);

  const counts = logicalEpochs.flatMap((epoch) => input.activeTags.map((tagName) => {
    const scoped = events.filter((event) => event.articleEpochId === epoch.articleEpochId && event.tagName === tagName);
    return {
      articleEpochId: epoch.articleEpochId,
      articleUrl: epoch.url,
      tagName,
      loaded: scoped.filter((event) => event.canonicalEvent === "loaded").length,
      pageview: scoped.filter((event) => event.canonicalEvent === "pageview").length,
      websitePageview: scoped.filter((event) => event.canonicalEvent === "website_pageview").length,
      evidenceIds: scoped.map((event) => event.evidenceId),
      sourcePageUrls: [...new Set(scoped.flatMap((event) => event.pageUrl === null ? [] : [event.pageUrl]))],
    };
  }));
  const pageviewFailures = counts.flatMap((item) => item.pageview === input.eventPolicy.pageview.perTag ? [] : [`${item.articleUrl}/${item.tagName}: pageview=${item.pageview}`]);
  const websiteCounts = logicalEpochs.map((epoch) => ({
    articleEpochId: epoch.articleEpochId,
    articleUrl: epoch.url,
    count: events.filter((event) => event.articleEpochId === epoch.articleEpochId && input.activeTags.includes(event.tagName ?? "") && event.canonicalEvent === "website_pageview").length,
  }));
  const websiteFailures = websiteCounts.filter((item) => item.count < input.eventPolicy.pageview.websiteMinimum || item.count > input.eventPolicy.pageview.websiteMaximum);
  const pageviewProven = counts.some((item) => item.pageview > input.eventPolicy.pageview.perTag) || websiteFailures.some((item) => item.count > input.eventPolicy.pageview.websiteMaximum);
  const tc7 = result(input, "TC-7", verdict(input, [...pageviewFailures, ...websiteFailures.map((item) => `${item.articleUrl}: website_pageview=${item.count}`)], pageviewProven), input.eventPolicy.pageview, { perArticleTag: counts.map(({ evidenceIds: _, ...item }) => item), websitePageviews: websiteCounts, failures: [...pageviewFailures, ...websiteFailures.map((item) => `${item.articleUrl}: website_pageview=${item.count}`)] }, counts.flatMap((item) => item.evidenceIds).length > 0 ? counts.flatMap((item) => item.evidenceIds) : allEvidenceIds);

  const lifecycleFailures = counts.flatMap((item) => [
    ...(item.loaded === input.eventPolicy.pageview.loadedPerTag ? [] : [`${item.articleUrl}/${item.tagName}: loaded=${item.loaded}`]),
    ...(item.pageview === input.eventPolicy.pageview.perTag ? [] : [`${item.articleUrl}/${item.tagName}: pageview=${item.pageview}`]),
  ]);
  const lifecycleProven = counts.some((item) => item.loaded > input.eventPolicy.pageview.loadedPerTag || item.pageview > input.eventPolicy.pageview.perTag);
  const tc22Verdict = verdict(input, lifecycleFailures, lifecycleProven);
  const tc22 = result(input, "TC-22", tc22Verdict, { loadedPerArticleTag: input.eventPolicy.pageview.loadedPerTag, pageviewPerArticleTag: input.eventPolicy.pageview.perTag, physicalScriptReloadRequired: false }, { perArticleTag: counts.map(({ evidenceIds: _, ...item }) => item), failures: lifecycleFailures }, counts.flatMap((item) => item.evidenceIds).length > 0 ? counts.flatMap((item) => item.evidenceIds) : allEvidenceIds);

  const distinctUrls = [...new Set(input.articleEpochs.map((epoch) => epoch.url))];
  const revisited = distinctUrls.length !== input.articleEpochs.length;
  const reachedMinimum = distinctUrls.length >= input.articlePolicy.minimumDistinctArticles;
  const tc23Verdict: Verdict = !reachedMinimum || (revisited && input.articlePolicy.revisit === "unknown") ? "UNKNOWN"
    : urlVerdict === "FAIL" || tc22Verdict === "FAIL" ? "FAIL"
    : urlVerdict === "PASS" && tc22Verdict === "PASS" && input.captureComplete ? "PASS" : "UNKNOWN";
  const tc23 = result(input, "TC-23", tc23Verdict, { minimumDistinctArticles: input.articlePolicy.minimumDistinctArticles, actionCount: input.articlePolicy.actions.length, revisit: input.articlePolicy.revisit }, { distinctArticleCount: distinctUrls.length, distinctUrls, articleEpochs: input.articleEpochs.map((epoch) => ({ articleEpochId: epoch.articleEpochId, url: epoch.url, startedAt: epoch.startedAt, endedAt: epoch.endedAt ?? null })), reachedMinimum, lifecycleVerdict: tc22Verdict, urlVerdict }, allEvidenceIds);
  return [tc7, tc17, tc21, tc22, tc23];
}
