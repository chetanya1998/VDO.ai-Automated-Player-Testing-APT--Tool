import config from '../config/index.js';
import * as browserService from './browser.service.js';
import { attachTagDiagnostics } from './tagDiagnostics.service.js';
import logger from '../utils/logger.js';
import { withTimeout } from '../utils/withTimeout.js';

export const STATUS = { PASS: 'pass', FAIL: 'fail', ERROR: 'error' };

export const CHECK_TYPE = { JS: 'vdo.ai.js', CSS: 'style.css' };

export const REASON = {
  PAGE_BLOCKED: 'page_blocked',
  DIV_NOT_FOUND: 'div_not_found',
  NO_EVENT_EMITTED: 'no_event_emitted',
  PLACEMENT_FAILED: 'placement_failed',
  SCRIPT_NOT_LOADED: 'script_not_loaded',
  WRAPPER_HIDDEN: 'wrapper_hidden',
  TIMEOUT: 'timeout',
  PAGE_CLOSED: 'page_closed',
};

function placementSucceeded(event) {
  if (!event) return false;
  if (typeof event.detail === 'boolean') return event.detail;
  return event.detail?.success !== false;
}

const BLOCKED_STATUSES = new Set([401, 403, 429, 503]);
const BLOCKED_TITLE = /just a moment|attention required|access denied|captcha|are you a robot|verify you are human/i;

function placementListenerScript(eventName) {
  window.__vdoPlacementEvents = [];
  const seen = new WeakSet();

  const toPlain = (value) => {
    try {
      return JSON.parse(JSON.stringify(value ?? null));
    } catch {
      return String(value);
    }
  };

  const record = (event) => {
    if (seen.has(event)) return;
    seen.add(event);
    const detail = toPlain(event.detail);
    window.__vdoPlacementEvents.push({ detail, receivedAt: Date.now() });
    if (typeof window.__vdoReportPlacement === 'function') window.__vdoReportPlacement(detail).catch(() => {});
  };

  window.addEventListener(eventName, record);
  document.addEventListener(eventName, record);
}

function injectStyleScript(css) {
  if (window !== window.top) return;
  const style = document.createElement('style');
  style.id = '__placement_check_style';
  style.textContent = css;

  const attach = () => {
    const parent = document.head || document.documentElement;
    if (!parent) return false;
    parent.appendChild(style);
    return true;
  };

  if (!attach()) {
    const observer = new MutationObserver(() => attach() && observer.disconnect());
    observer.observe(document, { childList: true, subtree: true });
  }
  document.addEventListener('DOMContentLoaded', attach);
  window.addEventListener('load', attach);
}

function guardWindowCloseScript() {
  if (window !== window.top) return;
  window.__vdoCloseAttempts = 0;
  window.close = function blockedClose() {
    window.__vdoCloseAttempts += 1;
  };
}

const isPageClosedError = (err) => /has been closed|Target closed/i.test(err?.message ?? '');

function reasonForError(err) {
  if (isPageClosedError(err)) return REASON.PAGE_CLOSED;
  return err.name === 'TimeoutError' ? REASON.TIMEOUT : REASON.PAGE_BLOCKED;
}

const isTagScript = (url, tag) => url.hostname.endsWith('vdo.ai') && url.pathname === `/core/${tag}/vdo.ai.js`;

async function overrideTagScript(context, tag, script) {
  const stats = { hits: 0 };
  await context.route(
    (url) => isTagScript(url, tag),
    async (route) => {
      stats.hits += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
        body: script,
      });
    },
  );
  return stats;
}

const PLACEMENT_BINDING = '__vdoReportPlacement';
const NO_WRAPPER = { found: false, count: 0, visible: false, box: null };

const pageCall = (promise, fallback) => withTimeout(promise, config.placement.pageCallTimeoutMs, fallback);

async function readWrapperIn(frame) {
  const locator = frame.locator(config.placement.wrapperSelector);
  const count = await pageCall(locator.count(), 0);
  if (!count) return null;

  const first = locator.first();
  return {
    frame,
    wrapper: {
      found: true,
      count,
      visible: await pageCall(first.isVisible(), false),
      box: await pageCall(first.boundingBox({ timeout: config.placement.pageCallTimeoutMs }), null),
      inIframe: frame !== frame.page().mainFrame(),
    },
  };
}

async function findWrapper(page) {
  const mainFrame = page.mainFrame();
  const inMain = await readWrapperIn(mainFrame);
  if (inMain) return inMain;

  const inFrames = await Promise.all(page.frames().filter((f) => f !== mainFrame && !f.isDetached()).map(readWrapperIn));
  return inFrames.find(Boolean) ?? { frame: null, wrapper: NO_WRAPPER };
}

const scrollDown = (page, ratio) =>
  pageCall(page.evaluate((r) => window.scrollBy({ top: Math.round(window.innerHeight * r), behavior: 'instant' }), ratio));

async function watchPlacement(page, placementEvents, deadline, lazyScroll, type) {
  const { eventSettleMs } = config.placement;
  const exitEarly = type === CHECK_TYPE.JS;
  let scrollSteps = 0;

  for (;;) {
    const events = [...placementEvents];
    const { wrapper } = await findWrapper(page);
    const firstEvent = events[0];
    const settled = Boolean(firstEvent) && Date.now() - firstEvent.receivedAt >= eventSettleMs;

    if (exitEarly && settled && !placementSucceeded(events.at(-1))) return { events, wrapper };
    if (exitEarly && settled && wrapper.found && wrapper.visible) return { events, wrapper };
    if (Date.now() >= deadline) return { events, wrapper };

    await page.waitForTimeout(Math.min(lazyScroll.intervalMs, Math.max(0, deadline - Date.now())));
    if (!firstEvent && scrollSteps < lazyScroll.maxSteps) {
      scrollSteps += 1;
      await scrollDown(page, lazyScroll.stepViewportRatio);
    }
  }
}

const takeScreenshot = (page) =>
  page
    .screenshot({
      type: 'jpeg',
      quality: config.placement.screenshotQuality,
      animations: 'disabled',
      caret: 'hide',
      timeout: 10000,
    })
    .catch((err) => {
      logger.warn(`Screenshot failed: ${err.message}`);
      return null;
    });

function waitForScrollToStop(page) {
  return pageCall(
    page.evaluate(
      () =>
        new Promise((resolve) => {
          let lastY = window.scrollY;
          let stableFrames = 0;
          const startedAt = performance.now();
          const tick = () => {
            if (window.scrollY === lastY) stableFrames += 1;
            else {
              stableFrames = 0;
              lastY = window.scrollY;
            }
            if (stableFrames >= 10 || performance.now() - startedAt > 2000) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    ),
  );
}

async function settleForScreenshot(page) {
  await waitForScrollToStop(page);
  await page.waitForTimeout(config.placement.screenshotSettleMs);
}

async function blockNavigation(page) {
  const mainFrame = page.mainFrame();
  const handler = (route) => {
    const request = route.request();
    if (request.isNavigationRequest() && request.frame() === mainFrame) return route.abort('aborted');
    return route.fallback();
  };
  await page.route('**/*', handler);
  return () => page.unroute('**/*', handler).catch(() => {});
}

async function captureScreenshots(page, wrapperFrame) {
  const shots = [];
  const unblock = await blockNavigation(page);
  let box = null;

  try {
    if (wrapperFrame) {
      const first = wrapperFrame.locator(config.placement.wrapperSelector).first();
      await pageCall(first.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' })));
      await settleForScreenshot(page);
      box = await pageCall(first.boundingBox({ timeout: config.placement.pageCallTimeoutMs }), null);
      shots.push({ label: 'Player in view', buffer: await takeScreenshot(page) });

      const wrapperBottom = await pageCall(first.evaluate((el) => el.getBoundingClientRect().bottom), null);
      await pageCall(
        page.evaluate((bottom) => {
          const distance = Math.max(window.innerHeight * 0.5, (bottom ?? window.innerHeight) + window.innerHeight * 0.25);
          window.scrollBy({ top: distance, behavior: 'instant' });
        }, wrapperBottom),
      );
      await settleForScreenshot(page);
      shots.push({ label: 'Scrolled past player (floating)', buffer: await takeScreenshot(page) });
    } else {
      await pageCall(page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })));
      await settleForScreenshot(page);
      shots.push({ label: 'Top of page', buffer: await takeScreenshot(page) });
    }
  } finally {
    await unblock();
  }

  return { shots, box };
}

function evaluateReasons({ type, placementEvents, wrapper, scriptOverridden }) {
  const reasons = [];
  const lastEvent = placementEvents.at(-1);

  if (type === CHECK_TYPE.JS) {
    if (!scriptOverridden) reasons.push(REASON.SCRIPT_NOT_LOADED);
    if (!lastEvent) reasons.push(REASON.NO_EVENT_EMITTED);
    else if (!placementSucceeded(lastEvent)) reasons.push(REASON.PLACEMENT_FAILED);
  }
  if (!wrapper.found) reasons.push(REASON.DIV_NOT_FOUND);
  else if (!wrapper.visible) reasons.push(REASON.WRAPPER_HIDDEN);

  return reasons;
}

async function checkUrl(page, url, { overrideStats, diagnostics, placementEvents }, { scroll, type }) {
  const { urlTimeoutMs, finalizeGraceMs } = config.placement;
  const startedAt = Date.now();
  const deadline = startedAt + urlTimeoutMs;
  const hitsBefore = overrideStats.hits;
  diagnostics.reset();
  placementEvents.length = 0;

  const result = {
    url,
    status: STATUS.ERROR,
    reasons: [],
    eventDetail: null,
    wrapper: null,
    shots: [],
    screenshots: [],
    screenshotLabels: [],
    durationMs: 0,
    diagnostics: null,
  };

  let stoppedByLimit = false;
  const watchdog = setTimeout(() => {
    stoppedByLimit = true;
    logger.warn(`Stopping ${url}: over the ${urlTimeoutMs / 1000}s limit`);
    page.close().catch(() => {});
  }, urlTimeoutMs + finalizeGraceMs);

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(config.browser.navigationTimeoutMs, urlTimeoutMs),
    });
    const title = await pageCall(page.title(), '');

    if ((response && BLOCKED_STATUSES.has(response.status())) || BLOCKED_TITLE.test(title)) {
      result.reasons = [REASON.PAGE_BLOCKED];
    } else {
      const { events, wrapper } = await watchPlacement(page, placementEvents, deadline, scroll, type);
      const lastEvent = events.at(-1);
      result.eventDetail = lastEvent?.detail ?? null;
      if (lastEvent?.frameUrl) logger.info(`vdo:placement fired inside an iframe: ${lastEvent.frameUrl}`);

      const located = wrapper.found ? await findWrapper(page) : { frame: null };
      const { shots, box } = await captureScreenshots(page, located.frame);
      result.shots.push(...shots);
      result.wrapper = wrapper.found ? { ...wrapper, box: box ?? wrapper.box } : wrapper;

      result.reasons = evaluateReasons({
        type,
        placementEvents: events,
        wrapper: result.wrapper,
        scriptOverridden: overrideStats.hits > hitsBefore,
      });
      result.status = result.reasons.length ? STATUS.FAIL : STATUS.PASS;
    }
  } catch (err) {
    result.status = STATUS.ERROR;
    result.reasons = [stoppedByLimit ? REASON.TIMEOUT : reasonForError(err)];
    result.error = stoppedByLimit ? `Stopped after the ${urlTimeoutMs / 1000}s limit` : err.message.split('\n')[0];
  } finally {
    clearTimeout(watchdog);
  }

  if (result.shots.length === 0 && !page.isClosed()) result.shots.push({ label: 'Page', buffer: await takeScreenshot(page) });
  const shots = result.shots.filter((shot) => shot.buffer);
  delete result.shots;
  result.screenshots = shots.map((shot) => shot.buffer);
  result.screenshotLabels = shots.map((shot) => shot.label);
  result.durationMs = Date.now() - startedAt;
  result.diagnostics = await diagnostics.snapshot(page, { stoppedByLimit });
  if (result.status !== STATUS.PASS) {
    for (const hint of result.diagnostics.hints) logger.info(`  ↳ ${hint}`);
    for (const report of result.diagnostics.errorReports) logger.info(`  ↳ vdo.ai.js error ${report.code}: ${report.message}`);
  }

  logger.info(
    `[${result.status.toUpperCase()}] ${url} (${(result.durationMs / 1000).toFixed(1)}s)${result.reasons.length ? ` - ${result.reasons.join(', ')}` : ''}`,
  );
  return result;
}

async function openSession({ device, tag, script, type }) {
  const context = await browserService.newContext(device);
  const overrideStats = type === CHECK_TYPE.JS ? await overrideTagScript(context, tag, script) : { hits: 0 };
  const diagnostics = attachTagDiagnostics(context, tag);
  await context.addInitScript(guardWindowCloseScript);
  if (type === CHECK_TYPE.CSS) await context.addInitScript(injectStyleScript, script);
  await context.addInitScript(placementListenerScript, config.placement.eventName);

  const placementEvents = [];
  await context.exposeBinding(PLACEMENT_BINDING, ({ frame, page: sourcePage }, detail) => {
    const inIframe = Boolean(frame && sourcePage && frame !== sourcePage.mainFrame());
    placementEvents.push({ detail, receivedAt: Date.now(), frameUrl: inIframe ? frame.url() : null });
  });

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(config.browser.navigationTimeoutMs);
  const session = { context, page, overrideStats, diagnostics, placementEvents, closing: false };
  page.on('close', () => !session.closing && logger.warn(`${device} page was closed during a check`));
  return session;
}

export async function runPlacementChecks({
  type = CHECK_TYPE.JS,
  tag,
  device,
  urls,
  script,
  scroll = config.placement.lazyScroll,
  onUrlDone = () => {},
}) {
  const startedAt = new Date();
  const results = [];
  let session = null;

  try {
    for (const url of urls) {
      if (!session || session.page.isClosed()) {
        if (session) {
          logger.warn(`Reopening the ${device} browser page before ${url}`);
          session.closing = true;
          await session.context.close().catch(() => {});
        }
        session = await openSession({ device, tag, script, type });
      }

      results.push(await checkUrl(session.page, url, session, { scroll, type }));
      onUrlDone();
    }
  } finally {
    if (session) {
      session.closing = true;
      await session.context.close().catch(() => {});
    }
  }

  const count = (status) => results.filter((r) => r.status === status).length;
  return {
    device,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    passCount: count(STATUS.PASS),
    failCount: count(STATUS.FAIL),
    errorCount: count(STATUS.ERROR),
    results,
  };
}
