import { withTimeout } from '../utils/withTimeout.js';

const MAX_ITEMS = 30;
const MAX_TEXT = 500;

const clip = (text) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text);
const pushLimited = (list, item) => list.length < MAX_ITEMS && list.push(item);

const frameLabel = (frame) => (frame && frame.parentFrame() ? `iframe: ${frame.url().slice(0, 120)}` : 'main');

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function emptySnapshot() {
  return {
    scriptRequests: [],
    dependencies: { vdoMin: 'not requested', ima3: 'not requested' },
    agentCheck: null,
    analyticsEvents: [],
    errorReports: [],
    pageErrors: [],
    console: [],
    placeholderDivs: null,
    closeAttempts: null,
  };
}

const dependencyKey = (url) => (url.includes('/vdo.min.js') ? 'vdoMin' : url.includes('ima3.js') ? 'ima3' : null);

export function attachTagDiagnostics(context, tag) {
  let current = emptySnapshot();
  const tagScriptPath = `/core/${tag}/vdo.ai.js`;

  context.on('request', (request) => {
    const url = request.url();

    if (url.includes(tagScriptPath)) {
      pushLimited(current.scriptRequests, { url: clip(url), frame: frameLabel(request.frame()) });
    }

    const dep = dependencyKey(url);
    if (dep) current.dependencies[dep] = 'pending';

    if (url.includes('vdo.ai/core/logger.php')) {
      const params = new URL(url).searchParams;
      pushLimited(current.errorReports, {
        code: params.get('code'),
        message: clip(safeDecode(params.get('msg') || '')),
        func: params.get('func'),
      });
    }

    if (/analytics1?\.vdo\.ai\/logger/.test(url)) {
      try {
        const body = JSON.parse(request.postData() || '{}');
        pushLimited(current.analyticsEvents, body.event ?? 'unknown');
      } catch {
        pushLimited(current.analyticsEvents, 'unparsable');
      }
    }
  });

  context.on('requestfinished', async (request) => {
    const dep = dependencyKey(request.url());
    if (!dep) return;
    const response = await request.response().catch(() => null);
    current.dependencies[dep] = response ? `loaded (${response.status()})` : 'loaded';
  });

  context.on('requestfailed', (request) => {
    const dep = dependencyKey(request.url());
    if (dep) current.dependencies[dep] = `failed: ${request.failure()?.errorText ?? 'unknown'}`;
  });

  context.on('response', async (response) => {
    if (!response.url().includes('allowed_url_go.php')) return;
    const snapshot = current;
    try {
      const body = JSON.parse(await response.text());
      snapshot.agentCheck = {
        status: response.status(),
        agent: body.agent ?? null,
        allowed: body.allowed ?? null,
        country: body.country ?? null,
      };
    } catch (err) {
      snapshot.agentCheck = { status: response.status(), error: clip(err.message) };
    }
  });

  context.on('console', (message) => {
    const source = message.location()?.url ?? '';
    if (!source.includes('vdo.ai')) return;
    pushLimited(current.console, { type: message.type(), text: clip(message.text()), source: clip(source) });
  });

  context.on('weberror', (webError) => {
    const error = webError.error();
    const stack = error?.stack ?? String(error);
    if (!stack.includes('vdo.ai')) return;
    pushLimited(current.pageErrors, clip(stack));
  });

  return {
    reset() {
      current = emptySnapshot();
    },

    async snapshot(page, { stoppedByLimit = false } = {}) {
      const pageState = page.isClosed()
        ? null
        : await withTimeout(
            page.evaluate((id) => ({
              placeholderDivs: document.querySelectorAll(`[id="${id}"], [id^="${id}-"]`).length,
              closeAttempts: window.__vdoCloseAttempts ?? 0,
            }), tag),
            2000,
            null,
          );
      current.placeholderDivs = pageState?.placeholderDivs ?? null;
      current.closeAttempts = pageState?.closeAttempts ?? null;
      current.pageClosed = page.isClosed() && !stoppedByLimit;
      current.stoppedByLimit = stoppedByLimit;
      return { ...current, hints: buildHints(current, tag) };
    },
  };
}

function buildHints(snapshot, tag) {
  const hints = [];

  if (snapshot.stoppedByLimit) hints.push('The check went over the per-URL time limit and was stopped.');
  if (snapshot.pageClosed) hints.push('The browser page was closed during this check (window closed by hand, or the browser crashed).');
  if (snapshot.closeAttempts > 0) hints.push(`The page called window.close() ${snapshot.closeAttempts} time(s); it was blocked so the check could continue.`);
  if (snapshot.scriptRequests.length === 0) hints.push(`The page never requested ${tag}'s vdo.ai.js.`);
  if (snapshot.scriptRequests.some((r) => r.frame !== 'main')) {
    hints.push('vdo.ai.js was loaded inside an iframe, so it takes the iframe-burst path in loadPlayerDiv.');
  }
  if (snapshot.agentCheck && snapshot.agentCheck.agent !== 'false') {
    hints.push(`The targeting agent check returned agent=${JSON.stringify(snapshot.agentCheck.agent)}, so onConfigLoaded rejects (blocked_agent).`);
  }
  if (snapshot.analyticsEvents.includes('blocked_agent')) hints.push('vdo.ai.js logged blocked_agent: this browser was flagged as a bot.');
  if (snapshot.analyticsEvents.includes('blocked_ima')) hints.push('ima3.js failed to load (blocked_ima).');
  for (const [name, state] of Object.entries(snapshot.dependencies)) {
    if (state.startsWith('failed') || state === 'pending') hints.push(`${name === 'vdoMin' ? 'vdo.min.js' : 'ima3.js'} is ${state}, so startTag never runs.`);
  }
  if (snapshot.scriptRequests.length > 0 && snapshot.placeholderDivs === 0) {
    hints.push(`No #${tag} placeholder div on the page, so loadPlayerDiv throws before parentToAppend.`);
  }
  if (snapshot.errorReports.length > 0) hints.push('vdo.ai.js reported errors through logger.php; see errorReports.');
  if (snapshot.pageErrors.length > 0) hints.push('Uncaught errors came from vdo.ai scripts; see pageErrors.');

  return hints;
}
