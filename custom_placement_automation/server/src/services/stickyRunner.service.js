import config from '../config/index.js';
import * as browserService from './browser.service.js';
import {
  BLOCKED_STATUSES,
  BLOCKED_TITLE,
  STATUS,
  blockNavigation,
  guardWindowCloseScript,
  injectStyleScript,
  overrideTagScript,
} from './placementRunner.service.js';
import { drawOverlay, removeOverlay, stickySnapshot } from './sticky/probe.js';
import { evaluateSticky } from './sticky/rules.js';
import logger from '../utils/logger.js';

export const STICKY_TYPE = 'sticky';
// Code a sticky check can apply before inspecting the page: none (the live tag as served), vdo.ai.js or style.css.
export const STICKY_CODE = ['none', 'vdo.ai.js', 'style.css'];

// Window sizes tried after the main scroll-through. Zoom is emulated with the CSS size the zoomed window would have.
const RESIZES = {
  desktop: (vp) => [
    { stage: 'resize', label: 'Window 1024×640 (ST-19)', w: 1024, h: 640 },
    { stage: 'resize', label: 'Window 800×600 (ST-19)', w: 800, h: 600 },
    { stage: 'zoom', label: 'Zoom 125% (ST-24)', w: Math.round(vp.width / 1.25), h: Math.round(vp.height / 1.25) },
    { stage: 'zoom', label: 'Zoom 150% (ST-24)', w: Math.round(vp.width / 1.5), h: Math.round(vp.height / 1.5) },
  ],
  mobile: (vp) => [
    { stage: 'resize', label: `Phone rotated to landscape ${vp.height}×${vp.width} (ST-19)`, w: vp.height, h: vp.width },
    { stage: 'resize', label: 'Small phone 360×640 (ST-19)', w: 360, h: 640 },
  ],
};

const SKIP_SELECTOR = '.videoAdUiSkipButton, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, button[class*="skip" i], [role="button"][class*="skip" i], [aria-label*="skip ad" i]';

// Skip Ad buttons live inside ad iframes (often cross-origin); Playwright can reach them frame by frame.
async function findSkipButtons(page, playerRect) {
  const found = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame() || frame.isDetached()) continue;
    let handles = [];
    try { handles = (await frame.$$(SKIP_SELECTOR)).slice(0, 4); } catch { continue; }
    for (const handle of handles) {
      try {
        if (!(await handle.isVisible())) continue;
        const label = await handle.evaluate((el) => `${el.className} ${el.getAttribute('aria-label') ?? ''}`);
        if (/pre-?skip/i.test(label)) continue;
        const rect = await handle.boundingBox();
        if (!rect || rect.width < 6 || rect.height < 6) continue;
        const local = await handle.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return Boolean(top && (top === el || el.contains(top) || top.contains(el)));
        });
        // Walk up to the iframe in the top page, then make sure nothing on the page covers that point.
        let child = frame;
        while (child.parentFrame() && child.parentFrame() !== page.mainFrame()) child = child.parentFrame();
        const iframe = await child.frameElement();
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const onTop = await page.evaluate(([el, x, y]) => {
          const top = document.elementFromPoint(x, y);
          return Boolean(top && (top === el || el.contains(top)));
        }, [iframe, cx, cy]);
        const viewport = page.viewportSize();
        const box = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
        // A button partly outside its own iframe is cut off by the frame edge.
        const frameBox = await (await frame.frameElement()).boundingBox();
        const overlapW = frameBox ? Math.min(rect.x + rect.width, frameBox.x + frameBox.width) - Math.max(rect.x, frameBox.x) : rect.width;
        const overlapH = frameBox ? Math.min(rect.y + rect.height, frameBox.y + frameBox.height) - Math.max(rect.y, frameBox.y) : rect.height;
        const visibleFraction = Math.round((Math.max(0, overlapW) * Math.max(0, overlapH) / (rect.width * rect.height)) * 100) / 100;
        found.push({
          desc: 'Skip Ad button',
          rect: box,
          inViewport: box.x >= -1 && box.y >= -1 && box.x + box.w <= viewport.width + 1 && box.y + box.h <= viewport.height + 1,
          visibleFraction,
          topmost: local && onTop,
          outsidePlayer: Boolean(playerRect) && (cx < playerRect.x || cx > playerRect.x + playerRect.w || cy < playerRect.y || cy > playerRect.y + playerRect.h),
        });
      } catch {
        // The ad UI changed while it was being measured; it is looked at again on the next snapshot.
      }
    }
  }
  return found;
}

const covered = (item) => item.fraction > 0 && item.area >= 200;

function problemRects(snap) {
  return [
    ...snap.headers.filter(covered).map((h) => ({ rect: h.rect, label: 'header covered' })),
    ...snap.headlines.filter(covered).map((h) => ({ rect: h.rect, label: 'headline covered' })),
    ...snap.footers.filter(covered).map((h) => ({ rect: h.rect, label: 'footer covered' })),
    ...snap.others.filter((o) => covered(o) || o.buttonsCovered.length).map((o) => ({ rect: o.rect, label: o.consent ? 'banner covered' : o.adLike ? 'other ad covered' : o.headerLike ? 'header covered' : o.bottomNav ? 'bottom menu covered' : 'fixed element covered' })),
    ...[...snap.controls.close, ...snap.controls.skip].filter((c) => !c.inViewport || c.visibleFraction < 0.95 || !c.topmost).map((c) => ({ rect: c.rect, label: `${c.desc} blocked` })),
  ];
}

async function inspectUrl(page, url, { tag, device, overrideStats, codeType, includeAdditional }) {
  const started = Date.now();
  const snaps = [];
  // One screenshot per snapshot (player in blue, problems in red); the ones a check points to become its evidence.
  const shots = [];
  const notes = [];
  const pause = (ms) => page.waitForTimeout(ms);

  const shoot = async (entry) => {
    try {
      await page.evaluate(drawOverlay, { player: entry.player?.rect ?? null, problems: problemRects(entry) });
      shots[entry.index] = await page.screenshot({ type: 'jpeg', quality: 60, scale: 'css', animations: 'disabled', caret: 'hide', timeout: 10000 });
    } catch (error) {
      if (!notes.some((note) => note.startsWith('Some screenshots'))) notes.push(`Some screenshots failed: ${error.message.split('\n')[0]}`);
    } finally {
      await page.evaluate(removeOverlay).catch(() => {});
    }
  };
  const snap = async (stage, label) => {
    const data = await page.evaluate(stickySnapshot, { tag });
    data.controls.skip.push(...(await findSkipButtons(page, data.player?.rect)));
    const entry = { stage, label, t: Date.now() - started, index: snaps.length, ...data };
    snaps.push(entry);
    await shoot(entry);
    return entry;
  };
  const scrollTo = (y) => page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
  const scrollBy = (dy) => page.evaluate((top) => window.scrollBy({ top, behavior: 'instant' }), dy);

  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.browser.navigationTimeoutMs });
  const title = await page.title().catch(() => '');
  if ((response && BLOCKED_STATUSES.has(response.status())) || BLOCKED_TITLE.test(title)) {
    // Keep what the site showed (HTTP status, title, a screenshot) so the reason is visible in the report.
    const buffer = await page.screenshot({ type: 'jpeg', quality: 60, scale: 'css', timeout: 10000 }).catch(() => null);
    return { blocked: { status: response?.status() ?? null, title: title.slice(0, 120), buffer }, snaps, shots, notes };
  }
  const vp = page.viewportSize();
  // A first look right away, usually before the tag has run: the baseline for page spacing (ST-01).
  await snap('load', 'Page opened');

  // 1. Initial load, no scrolling (ST-21, ST-09).
  for (let i = 0; i < 8; i += 1) {
    await pause(600);
    await snap('load', 'Initial load');
  }

  // 2. Scroll down until the in-content placement is well behind (ST-06, ST-07, ST-22, ST-01).
  let floatSeen = false;
  for (let step = 0; step < 24; step += 1) {
    await scrollBy(Math.round(vp.height * 0.5));
    await pause(700);
    const s = await snap('scroll', 'Scrolling down');
    if (s.isFloating && !floatSeen) {
      floatSeen = true;
      s.label = 'Floating started';
    }
    const passed = s.anchor ? s.anchor.rect.y + s.anchor.rect.h < -vp.height : step >= 5;
    const atBottom = s.scrollY + vp.height >= s.docHeight - 2;
    if ((passed && (s.isFloating || step >= 8)) || atBottom) break;
  }

  // 3. Wait without scrolling while the ad loads and plays (ST-04, ST-09, ST-08, ST-10).
  for (let i = 0; i < 10; i += 1) {
    await pause(1000);
    await snap('ad', 'While the ad loads (no scrolling)');
  }
  const readingY = snaps.at(-1).scrollY;

  // 4. Scroll up and down a little, three times (ST-16).
  for (let i = 0; i < 3; i += 1) {
    await scrollBy(-Math.round(vp.height * 0.6));
    await pause(700);
    await snap('updown', 'Scrolling up and down');
    await scrollBy(Math.round(vp.height * 0.6));
    await pause(700);
    await snap('updown', 'Scrolling up and down');
  }

  // 5. Down to the bottom of the page (ST-13, ST-14, ST-18, ST-25). Infinite scroll may keep adding pages; stop after 15 screens.
  for (let i = 0; i < 15; i += 1) {
    await scrollBy(vp.height);
    await pause(600);
    const s = await snap('bottom', 'Bottom of the page');
    if (s.scrollY + vp.height >= s.docHeight - 2) break;
  }
  await pause(1200);
  await snap('bottom', 'Bottom of the page');

  // 6. Back to the article; with the additional checks, also other window sizes and zoom (ST-15, ST-19, ST-24).
  await scrollTo(readingY);
  await pause(1200);
  await snap('back', 'Back in the article');
  if (includeAdditional) {
    for (const size of RESIZES[device](vp)) {
      await page.setViewportSize({ width: size.w, height: size.h });
      await pause(1500);
      await snap(size.stage, size.label);
    }
    await page.setViewportSize(vp);
    await pause(1200);
  }

  // 7. Click the floating player's close button, then keep scrolling (ST-05, ST-17).
  const before = await snap('back', 'Back in the article');
  const target = before.isFloating ? before.controls.close.find((c) => c.inViewport && c.topmost) : null;
  const close = { clicked: false, closed: false, reason: null };
  if (!before.isFloating) close.reason = 'The player was not floating when the close button would be clicked.';
  else if (!target) close.reason = 'No usable close button was found on the floating player.';
  else {
    const unblock = await blockNavigation(page);
    try {
      await page.mouse.click(target.rect.x + target.rect.w / 2, target.rect.y + target.rect.h / 2);
      close.clicked = true;
      await pause(1500);
      const after = await snap('after-close', 'After clicking close');
      close.closed = !after.isFloating;
      // Behaviour after closing (ST-17) is an additional check.
      for (let i = 0; i < (includeAdditional ? 3 : 0); i += 1) {
        await scrollBy(Math.round(vp.height * 0.6));
        await pause(900);
        await snap('after-close', 'Scrolling after close');
        await scrollBy(-Math.round(vp.height * 0.4));
        await pause(900);
        await snap('after-close', 'Scrolling after close');
      }
    } finally {
      await unblock();
    }
  }

  if (codeType === 'vdo.ai.js' && overrideStats.hits === 0) notes.push('The page never requested this tag\'s vdo.ai.js, so the custom code did not run.');
  return { blocked: false, snaps, shots, notes, close };
}

// The screenshots the checks point to, in timeline order; each check gets the number of its screenshot.
function attachEvidence(evaluation, snaps, shots) {
  const firstFloat = snaps.find((s) => s.isFloating && s.stage !== 'after-close');
  const fallback = (firstFloat ?? snaps.filter((s) => s.stage === 'load').at(-1) ?? snaps.at(-1))?.index;
  for (const item of evaluation.cases) item.evidenceSnap ??= fallback;
  const used = [...new Set(evaluation.cases.map((item) => item.evidenceSnap))].filter((index) => index !== undefined && shots[index]).sort((a, b) => a - b);
  const position = new Map(used.map((index, i) => [index, i]));
  for (const item of evaluation.cases) {
    if (position.has(item.evidenceSnap)) item.evidence = position.get(item.evidenceSnap);
    delete item.evidenceSnap;
  }
  return used.map((index, i) => {
    const s = snaps[index];
    const checks = evaluation.cases.filter((item) => item.evidence === i).map((item) => item.id);
    return { buffer: shots[index], label: `#${i + 1} ${s.label} · ${(s.t / 1000).toFixed(1)} s · ${s.viewport.w}×${s.viewport.h} · ${checks.join(', ')}` };
  });
}

export async function runStickyChecks({ tag, device, urls, script, codeType = 'none', includeAdditional = false, onUrlDone = () => {} }) {
  const startedAt = new Date();
  const results = [];
  for (const url of urls) {
    const urlStarted = Date.now();
    const context = await browserService.newContext(device);
    const result = { url, status: STATUS.ERROR, reasons: [], screenshots: [], screenshotLabels: [], durationMs: 0, sticky: null };
    let watchdog;
    try {
      const overrideStats = codeType === 'vdo.ai.js' ? await overrideTagScript(context, tag, script) : { hits: 0 };
      await context.addInitScript(guardWindowCloseScript);
      if (codeType === 'style.css') await context.addInitScript(injectStyleScript, script);
      const page = await context.newPage();
      // Ads can open pop-ups when clicked; close them and stay on the article.
      context.on('page', (popup) => popup !== page && popup.close().catch(() => {}));
      const run = inspectUrl(page, url, { tag, device, overrideStats, codeType, includeAdditional });
      run.catch(() => {}); // A run cut off by the time limit fails when its page closes.
      const limit = new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error(`Stopped after the ${config.sticky.urlTimeoutMs / 1000}s limit`)), config.sticky.urlTimeoutMs); });
      const outcome = await Promise.race([run, limit]);
      if (outcome.blocked) {
        result.reasons = ['page_blocked'];
        result.blocked = { status: outcome.blocked.status, title: outcome.blocked.title };
        result.error = `The site refused the visit or showed a bot check${outcome.blocked.status ? ` (HTTP ${outcome.blocked.status})` : ''}${outcome.blocked.title ? `: "${outcome.blocked.title}"` : ''}.`;
        if (outcome.blocked.buffer) {
          result.screenshots = [outcome.blocked.buffer];
          result.screenshotLabels = ['What the site showed'];
        }
      } else {
        const evaluation = evaluateSticky({ snaps: outcome.snaps, close: outcome.close, device, includeAdditional });
        const evidence = attachEvidence(evaluation, outcome.snaps, outcome.shots);
        const last = outcome.snaps.at(-1);
        result.sticky = {
          ...evaluation,
          viewport: page.viewportSize(),
          browserVersion: page.context().browser()?.version() ?? null,
          snapshots: outcome.snaps.length,
          finalUrl: last?.url ?? url,
          notes: outcome.notes,
        };
        result.screenshots = evidence.map((shot) => shot.buffer);
        result.screenshotLabels = evidence.map((shot) => shot.label);
        // PASS and PASS · Review required pass the URL; FAIL fails it; nothing judged is an error (could not be checked).
        result.status = evaluation.overallVerdict === 'PASS' ? STATUS.PASS : evaluation.overallVerdict === 'FAIL' ? STATUS.FAIL : STATUS.ERROR;
        if (evaluation.playerType === 'not found') result.reasons = ['player_not_found'];
        else if (evaluation.overallVerdict === 'WARNING') result.reasons = ['not_judged'];
        else if (evaluation.review) result.reasons = ['review_required'];
      }
    } catch (error) {
      result.error = error.message.split('\n')[0];
      result.reasons = [/limit/.test(result.error) ? 'timeout' : 'page_open_failed'];
    } finally {
      clearTimeout(watchdog);
      await context.close().catch(() => {});
    }
    result.durationMs = Date.now() - urlStarted;
    logger.info(`[STICKY ${result.status.toUpperCase()}] ${url} (${device}) ${result.sticky ? JSON.stringify(result.sticky.verdictCounts) : result.error ?? result.reasons.join(',')}`);
    results.push(result);
    await onUrlDone();
  }
  const count = (status) => results.filter((r) => r.status === status).length;
  return {
    device,
    reviewCount: results.filter((r) => r.sticky?.review).length,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    passCount: count(STATUS.PASS),
    failCount: count(STATUS.FAIL),
    errorCount: count(STATUS.ERROR),
    results,
  };
}
