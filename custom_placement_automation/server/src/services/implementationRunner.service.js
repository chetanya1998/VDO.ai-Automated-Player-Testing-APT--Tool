import config from '../config/index.js';
import * as browserService from './browser.service.js';
import { BLOCKED_STATUSES, BLOCKED_TITLE, STATUS, blockNavigation, guardWindowCloseScript } from './placementRunner.service.js';
import { elementsProbe, scriptWatchScript, scrollUnitIntoView } from './implementation/probe.js';
import {
  evaluateImplementation,
  isErrorReportUrl,
  isLoggerEventUrl,
  parseErrorReport,
  parseLoggerPayload,
  tagFromScriptUrl,
} from './implementation/rules.js';
import logger from '../utils/logger.js';

export const IMPLEMENTATION_TYPE = 'implementation';
export const WATCH_OPTIONS_SEC = [30, 45, 60];

const MAX_EVENTS = 500;

// Step 1 and 2 evidence: every vdo.ai.js request (with status, failure and initiator), every logger.php error report and
// every logger event payload, timed from the start of navigation.
async function captureNetwork(context, page, startedAt) {
  const scripts = [];
  const errorReports = [];
  const events = [];
  const records = new Map();
  const initiators = new Map();
  const at = () => Date.now() - startedAt;

  context.on('request', (request) => {
    const url = request.url();
    const root = request.redirectedFrom();
    if (root && records.has(root)) {
      records.set(request, records.get(root));
      return;
    }
    const tag = tagFromScriptUrl(url);
    if (tag) {
      let frameUrl = null;
      try { frameUrl = request.frame().url(); } catch { frameUrl = null; }
      const record = { url, tag, atMs: at(), status: null, failure: null, frameUrl };
      records.set(request, record);
      scripts.push(record);
    } else if (isErrorReportUrl(url)) {
      const record = { ...parseErrorReport(url), atMs: at(), status: null };
      records.set(request, record);
      errorReports.push(record);
    } else if (isLoggerEventUrl(url) && events.length < MAX_EVENTS) {
      for (const event of parseLoggerPayload(request.postData(), url)) events.push({ ...event, atMs: at() });
    }
  });
  context.on('response', (response) => {
    const record = records.get(response.request());
    if (record) record.status = response.status();
  });
  context.on('requestfailed', (request) => {
    const record = records.get(request);
    if (record && record.status === null) record.failure = request.failure()?.errorText ?? 'request failed';
  });

  // Like DevTools with "Disable cache" ticked: a second <script> for the same tag is a real second request, not a
  // memory-cache hit. The same session reports who started each vdo.ai.js request (TC-02 evidence).
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    cdp.on('Network.requestWillBeSent', ({ request, initiator, redirectResponse }) => {
      if (redirectResponse || !tagFromScriptUrl(request.url)) return;
      const frame = initiator?.stack?.callFrames?.find((f) => f.url);
      const list = initiators.get(request.url) ?? [];
      list.push({ type: initiator?.type ?? null, url: initiator?.url ?? frame?.url ?? null, line: frame ? frame.lineNumber + 1 : initiator?.lineNumber ?? null });
      initiators.set(request.url, list);
    });
  } catch (error) {
    logger.warn(`Could not disable the cache for the implementation check: ${error.message}`);
  }

  const finish = () => {
    const pending = new Map([...initiators].map(([url, list]) => [url, [...list]]));
    for (const record of scripts) record.initiator = pending.get(record.url)?.shift() ?? null;
    return { scripts, errorReports, events: events.map(({ event, tagName, page_url, dep, eventData, atMs }) => ({ event, tagName, page_url, dep, eventData, atMs })) };
  };
  return { finish };
}

// Step 3: the Elements panel, searched in the page and every frame Playwright can reach.
async function captureElements(page, tags) {
  const merged = { scripts: [], wrappers: Object.fromEntries(tags.map((t) => [t, []])), floating: [], bannerDivs: Object.fromEntries(tags.map((t) => [t, []])) };
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    let found;
    try { found = await frame.evaluate(elementsProbe, tags); } catch { continue; }
    const frameUrl = frame === page.mainFrame() ? null : frame.url();
    merged.scripts.push(...found.scripts.map((s) => ({ ...s, frameUrl })));
    merged.floating.push(...found.floating.map((f) => ({ ...f, frameUrl })));
    for (const tag of tags) {
      merged.wrappers[tag].push(...found.wrappers[tag].map((w) => ({ ...w, frameUrl })));
      merged.bannerDivs[tag].push(...found.bannerDivs[tag]);
    }
  }
  return merged;
}

// The vdo.ai.js script elements each frame inserted, timed like the network requests.
async function captureScriptLoads(page, startedAt) {
  const loads = [];
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    let found = [];
    try { found = await frame.evaluate(() => window.__vdoScriptLoads ?? []); } catch { continue; }
    const frameUrl = frame === page.mainFrame() ? null : frame.url();
    loads.push(...found.map(({ at, ...entry }) => ({ ...entry, atMs: Math.max(0, at - startedAt), frameUrl })));
  }
  return loads.sort((a, b) => a.atMs - b.atMs);
}

const screenshot = (page) => page.screenshot({ type: 'jpeg', quality: 60, scale: 'css', animations: 'disabled', caret: 'hide', timeout: 10000 }).catch(() => null);

async function inspectUrl(context, page, url, { tags, watchMs }) {
  const startedAt = Date.now();
  const network = await captureNetwork(context, page, startedAt);
  const notes = [];
  const shots = [];
  let response = null;
  let openError = null;

  try {
    response = await page.goto(url, { waitUntil: 'load', timeout: config.browser.navigationTimeoutMs });
  } catch (error) {
    if (error.name === 'TimeoutError') notes.push(`The page did not finish loading within ${config.browser.navigationTimeoutMs / 1000} s; the checks continued with what had loaded.`);
    else openError = error.message.split('\n')[0];
  }
  const loadedAtMs = Date.now() - startedAt;
  const title = await page.title().catch(() => '');
  const blocked = Boolean((response && BLOCKED_STATUSES.has(response.status())) || BLOCKED_TITLE.test(title));

  if (!openError) {
    shots.push({ label: `Page loaded · ${(loadedAtMs / 1000).toFixed(1)} s`, buffer: await screenshot(page) });
    // TC-03 watch: the page stays open; ads must not navigate it away. The unit is kept in view so it can form.
    const unblock = await blockNavigation(page);
    try {
      const watchEnd = startedAt + loadedAtMs + watchMs;
      let scrolled = 0;
      while (Date.now() < watchEnd && !page.isClosed()) {
        const found = await page.evaluate(scrollUnitIntoView, tags).catch(() => false);
        if (!found && scrolled < 6) {
          scrolled += 1;
          await page.evaluate(() => window.scrollBy({ top: Math.round(innerHeight * 0.5), behavior: 'instant' })).catch(() => {});
        }
        await page.waitForTimeout(Math.min(2000, Math.max(0, watchEnd - Date.now())));
      }
      await page.evaluate(scrollUnitIntoView, tags).catch(() => false);
      await page.waitForTimeout(500);
      shots.push({ label: `After the ${watchMs / 1000} s watch · ${((Date.now() - startedAt) / 1000).toFixed(1)} s`, buffer: await screenshot(page) });
    } finally {
      await unblock();
    }
  }

  const elements = page.isClosed() ? {} : await captureElements(page, tags);
  const scriptElements = page.isClosed() ? [] : await captureScriptLoads(page, startedAt);
  const captured = network.finish();
  return {
    evidence: { ...captured, scriptElements, elements, loadWindowMs: config.implementation.loadWindowMs, watchMs },
    page: { status: response?.status() ?? null, title: title.slice(0, 160), finalUrl: page.isClosed() ? url : page.url(), loadedAtMs },
    blocked,
    openError,
    notes,
    shots: shots.filter((s) => s.buffer),
  };
}

// prepareContext lets tests serve a.vdo.ai and analytics.vdo.ai from a local fixture.
export async function runImplementationChecks({ tags, device, urls, watchSec = 30, onUrlDone = () => {}, prepareContext = null }) {
  const startedAt = new Date();
  const watchMs = watchSec * 1000;
  const results = [];
  for (const url of urls) {
    const urlStarted = Date.now();
    const context = await browserService.newContext(device);
    const result = { url, status: STATUS.ERROR, reasons: [], screenshots: [], screenshotLabels: [], durationMs: 0, implementation: null };
    let watchdog;
    try {
      if (prepareContext) await prepareContext(context);
      await context.addInitScript(guardWindowCloseScript);
      await context.addInitScript(scriptWatchScript);
      const page = await context.newPage();
      context.on('page', (popup) => popup !== page && popup.close().catch(() => {}));
      const run = inspectUrl(context, page, url, { tags, watchMs });
      run.catch(() => {});
      const limit = new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error(`Stopped after the ${config.implementation.urlTimeoutMs / 1000}s limit`)), config.implementation.urlTimeoutMs); });
      const outcome = await Promise.race([run, limit]);

      // Every test case runs for every tag, even when the page was blocked: each one reports what it saw.
      const evaluation = evaluateImplementation({ tags, evidence: outcome.evidence });
      result.implementation = {
        ...evaluation,
        watchMs,
        loadWindowMs: outcome.evidence.loadWindowMs,
        page: outcome.page,
        notes: outcome.notes,
        network: { scripts: outcome.evidence.scripts, scriptElements: outcome.evidence.scriptElements, errorReports: outcome.evidence.errorReports, eventCount: outcome.evidence.events.length },
        loggerEvents: outcome.evidence.events.slice(0, 200),
      };
      result.screenshots = outcome.shots.map((s) => s.buffer);
      result.screenshotLabels = outcome.shots.map((s) => s.label);

      if (outcome.openError) {
        result.error = outcome.openError;
        result.reasons = ['page_open_failed'];
      } else if (outcome.blocked) {
        result.error = `The site refused the visit or showed a bot check${outcome.page.status ? ` (HTTP ${outcome.page.status})` : ''}${outcome.page.title ? `: "${outcome.page.title}"` : ''}.`;
        result.reasons = ['page_blocked'];
      } else {
        result.status = evaluation.overallVerdict === 'FAIL' ? STATUS.FAIL : STATUS.PASS;
        const several = tags.length > 1;
        result.reasons = [
          ...(evaluation.overallVerdict === 'FAIL'
            ? evaluation.tags.flatMap((t) => t.cases.filter((c) => c.verdict === 'FAIL').map((c) => (several ? `${t.tag} · ${c.id}` : c.id)))
            : evaluation.overallVerdict === 'WARNING' ? ['has_warnings'] : []),
          ...evaluation.notEligibleTags.map((t) => `${t} · not on this page`),
        ];
      }
    } catch (error) {
      result.error = error.message.split('\n')[0];
      result.reasons = [/limit/.test(result.error) ? 'timeout' : 'page_open_failed'];
    } finally {
      clearTimeout(watchdog);
      await context.close().catch(() => {});
    }
    result.durationMs = Date.now() - urlStarted;
    const summary = result.implementation?.tags.map((t) => `${t.tag} (${t.unit}): ${t.summaryLine}`).join(' | ');
    logger.info(`[IMPLEMENTATION ${result.status.toUpperCase()}] ${url} (${device}) ${summary ?? result.error ?? result.reasons.join(',')}`);
    results.push(result);
    await onUrlDone();
  }
  const count = (status) => results.filter((r) => r.status === status).length;
  return {
    device,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    passCount: count(STATUS.PASS),
    failCount: count(STATUS.FAIL),
    errorCount: count(STATUS.ERROR),
    warningCount: results.filter((r) => r.status === STATUS.PASS && r.implementation?.overallVerdict === 'WARNING').length,
    results,
  };
}
