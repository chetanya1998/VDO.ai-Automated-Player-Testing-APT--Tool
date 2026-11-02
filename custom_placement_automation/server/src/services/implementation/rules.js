// Implementation validator rules (TC-01 to TC-13). Pure functions: the runner captures network, logger and element
// evidence in the browser, and everything here judges it, so each rule can be tested without a browser.
import {
  BLOCKING_ERROR_CODES,
  IMPLEMENTATION_CASES,
  UNIT_LABELS,
  DEFAULT_DEP,
  EVENT_DEFINITIONS,
  EXPECTED_EVENTS,
  IMPLEMENTATION_MEANING,
  UNITS,
  VIDEO_BLOCKING_EVENTS,
  casesFor,
} from './guide.js';

// NOT_ELIGIBLE: the test case does not apply to this tag's unit, or the tag is not on this page. It is shown so the
// report is complete, but it is never a result: it does not count towards PASS, WARNING or FAIL.
export const VERDICT = { PASS: 'PASS', WARNING: 'WARNING', FAIL: 'FAIL', NOT_ELIGIBLE: 'NOT_ELIGIBLE' };
const RANK = { PASS: 0, WARNING: 1, FAIL: 2 };
export const worst = (verdicts) => verdicts.filter((v) => v in RANK).reduce((acc, v) => (RANK[v] > RANK[acc] ? v : acc), VERDICT.PASS);

// ---------- Tags and units ----------

// v-… video, b-… banner, o-… offerwall. A tag without a prefix is treated as video.
export function unitOf(tag) {
  if (/^b-/i.test(tag)) return UNITS.BANNER;
  if (/^o-/i.test(tag)) return UNITS.OFFERWALL;
  return UNITS.VIDEO;
}

// The site part of a tag, without the unit prefix and a -v{n} version: v-tayyar-org-v1 → tayyar-org.
export const siteOf = (tag) => String(tag).toLowerCase().replace(/^[vbo]-/, '').replace(/-v\d+$/, '');

// Banner div ids hold the tag with hyphens as underscores: b-tayyar-org-v1 → b_tayyar_org_v1.
export const underscoreForm = (tag) => String(tag).replace(/-/g, '_');

// Several tags can be entered at once, separated by commas, spaces or new lines.
export const parseTags = (value) => [...new Set(String(value ?? '').split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean))];

// ---------- Network classification ----------

const isVdoHost = (host) => host === 'vdo.ai' || host.endsWith('.vdo.ai');

const parseUrl = (value) => {
  try { return new URL(value); } catch { return null; }
};

// https://a.vdo.ai/core/<TAG>/vdo.ai.js → <TAG>; anything else → null.
export function tagFromScriptUrl(value) {
  const url = parseUrl(value);
  if (!url || !isVdoHost(url.hostname)) return null;
  const match = url.pathname.match(/^\/core\/([^/]+)\/vdo\.ai\.js$/);
  return match ? decodeURIComponent(match[1]) : null;
}

// logger.php?msg=… is the error report vdo.ai.js sends from logError (it shows up under the vdo.ai.js filter).
export function isErrorReportUrl(value) {
  const url = parseUrl(value);
  return Boolean(url && /\/logger\.php$/i.test(url.pathname) && url.searchParams.has('msg') && (isVdoHost(url.hostname) || url.searchParams.get('func') === 'vdo.ai.js'));
}

// Normal events go to https://analytics.vdo.ai/logger (or analytics1); never logger.php.
export function isLoggerEventUrl(value) {
  const url = parseUrl(value);
  return Boolean(url && isVdoHost(url.hostname) && /logger/i.test(url.pathname) && !/\/logger\.php$/i.test(url.pathname));
}

const safeDecode = (value) => {
  try { return decodeURIComponent(value); } catch { return value; }
};

export function parseErrorReport(value) {
  const url = parseUrl(value);
  const param = (name) => url.searchParams.get(name);
  // msg is the encoded stack; the first line is the message (TypeError: Cannot read properties of null …).
  const msg = safeDecode(param('msg') ?? '');
  return {
    msg: msg.split('\n')[0].slice(0, 300),
    tag: param('tag'),
    code: param('code'),
    url: param('url') ? safeDecode(param('url')) : null,
    func: param('func'),
  };
}

const LOGGER_FIELDS = ['event', 'tagName', 'page_url', 'dep', 'eventData', 'domainName'];

function pickFields(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  if (record.event === undefined && record.tagName === undefined) return null;
  const out = {};
  for (const field of LOGGER_FIELDS) {
    const value = record[field];
    if (value === undefined || value === null) continue;
    out[field] = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return out;
}

// One logger request carries one event (logPixel posts JSON.stringify(requestObject)), but form bodies, query strings
// and batched arrays are read too.
export function parseLoggerPayload(postData, requestUrl) {
  const records = [];
  const push = (value) => {
    if (Array.isArray(value)) value.forEach(push);
    else if (value && typeof value === 'object') {
      const fields = pickFields(value);
      if (fields) records.push(fields);
      else if (Array.isArray(value.events)) value.events.forEach(push);
    }
  };
  const body = typeof postData === 'string' ? postData.trim() : '';
  if (body) {
    let parsed = null;
    if (/^[[{]/.test(body)) {
      try { parsed = JSON.parse(body); } catch { parsed = null; }
    }
    if (parsed) push(parsed);
    else push(Object.fromEntries(new URLSearchParams(body)));
  }
  if (records.length === 0) {
    const url = parseUrl(requestUrl);
    if (url) push(Object.fromEntries(url.searchParams));
  }
  return records;
}

// ---------- Event names ----------

// "Blocked IMA", "blocked_ima" and "BlockedIMA" are the same event.
export const eventKey = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const keyIs = (name, ...candidates) => candidates.some((c) => eventKey(c) === eventKey(name));

const isSafeframeUrl = (value) => {
  const url = parseUrl(value);
  if (!url) return /\/safeframe\//i.test(String(value));
  return url.hostname === 'safeframe.googlesyndication.com' || url.hostname.endsWith('.safeframe.googlesyndication.com') || url.pathname.includes('/safeframe/');
};

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
const where = (event) => (event.page_url ? ` on ${event.page_url}` : '');

// ---------- Test cases ----------

function tc01({ tag, unit, scripts }) {
  const own = scripts.filter((s) => s.tag === tag);
  const ok = own.find((s) => s.status === 200);
  const evidence = own.map((s) => ({ url: s.url, status: s.status ?? null, failure: s.failure ?? null }));
  if (ok) return { verdict: VERDICT.PASS, summary: `${ok.url} returned status 200.`, evidence };
  if (own.length) {
    const first = own[0];
    const problem = first.failure ? `was blocked (${first.failure})` : first.status ? `returned status ${first.status}` : 'never got a response';
    return { verdict: VERDICT.FAIL, summary: `The request for ${tag} ${problem}.`, evidence };
  }
  const others = [...new Set(scripts.map((s) => s.tag))];
  const otherEvidence = scripts.map((s) => ({ url: s.url, status: s.status ?? null, failure: s.failure ?? null }));
  if (others.length === 0) return { verdict: VERDICT.FAIL, summary: `No vdo.ai.js request was made (expected https://a.vdo.ai/core/${tag}/vdo.ai.js).`, evidence: [] };
  const sameSite = others.filter((t) => siteOf(t) === siteOf(tag));
  const wrongUnit = sameSite.find((t) => unitOf(t) !== unit);
  if (wrongUnit) return { verdict: VERDICT.FAIL, summary: `No request for ${tag}. The page loads ${wrongUnit}, which has the wrong unit prefix (${unitOf(wrongUnit)} instead of ${unit}).`, evidence: otherEvidence };
  if (sameSite.length) return { verdict: VERDICT.FAIL, summary: `No request for ${tag}. The page loads another tag of this site instead: ${sameSite.join(', ')}.`, evidence: otherEvidence };
  return { verdict: VERDICT.FAIL, summary: `No request for ${tag}. The page loads another website's tag: ${others.join(', ')}.`, evidence: otherEvidence };
}

// Requests within loadWindowMs of the first one are the page load (TC-02); later ones are refreshes (TC-03).
function splitLoads(own, loadWindowMs) {
  if (own.length === 0) return { loads: [], refreshes: [] };
  const first = Math.min(...own.map((s) => s.atMs));
  return { loads: own.filter((s) => s.atMs - first <= loadWindowMs), refreshes: own.filter((s) => s.atMs - first > loadWindowMs) };
}

const initiatorText = (s) => (s.initiator ? `${s.initiator.type ?? 'script'}${s.initiator.url ? ` from ${s.initiator.url}` : ''}` : 'unknown initiator');

// A load is a network request for the tag, or a <script> element for it that loaded: Chromium serves two identical
// in-flight script requests with one network request (even with the cache disabled), so a duplicate embed can show up
// only as a second script element. Whichever source saw more loads is counted.
function loadsOf({ tag, scripts, scriptElements = [], loadWindowMs }) {
  const network = splitLoads(scripts.filter((s) => s.tag === tag), loadWindowMs);
  const elements = splitLoads(scriptElements.filter((e) => e.tag === tag && e.state !== 'error'), loadWindowMs);
  return {
    network,
    elements,
    loads: elements.loads.length > network.loads.length ? elements.loads : network.loads,
    refreshes: elements.refreshes.length > network.refreshes.length ? elements.refreshes : network.refreshes,
    fromElements: elements.loads.length > network.loads.length,
  };
}

const loadEvidence = ({ network, elements }) => ({
  requests: [...network.loads, ...network.refreshes].map((s) => ({ url: s.url, atMs: s.atMs, status: s.status ?? null, initiator: s.initiator ?? null })),
  scriptElements: [...elements.loads, ...elements.refreshes].map((e) => ({ src: e.src, atMs: e.atMs, state: e.state, frameUrl: e.frameUrl ?? null })),
});

function tc02(input) {
  const { tag } = input;
  const seen = loadsOf(input);
  const { loads } = seen;
  const evidence = loadEvidence(seen);
  if (loads.length === 1) return { verdict: VERDICT.PASS, summary: `Exactly one request for ${tag} (at ${secs(loads[0].atMs)}${loads[0].initiator ? `, ${initiatorText(loads[0])}` : ''}).`, evidence };
  if (loads.length === 0) return { verdict: VERDICT.FAIL, summary: `No request for ${tag}, so the tag did not load once.`, evidence };
  if (seen.fromElements) {
    return { verdict: VERDICT.FAIL, summary: `${tag} loaded ${loads.length} times while the page loaded: ${loads.length} vdo.ai.js script elements for it (inserted at ${loads.map((e) => secs(e.atMs)).join(', ')}${loads.some((e) => e.frameUrl) ? ', some inside frames' : ''}); Chrome served them with ${plural(seen.network.loads.length, 'network request')}. Requests for other tags are not counted.`, evidence };
  }
  return { verdict: VERDICT.FAIL, summary: `${tag} was requested ${loads.length} times while the page loaded: ${loads.map((s) => `${secs(s.atMs)} (${initiatorText(s)})`).join('; ')}. Requests for other tags are not counted.`, evidence };
}

function tc03(input) {
  const { tag, watchMs } = input;
  const seen = loadsOf(input);
  const { loads, refreshes } = seen;
  const evidence = loadEvidence(seen);
  if (refreshes.length) return { verdict: VERDICT.FAIL, summary: `${tag} loaded again during the ${secs(watchMs)} watch, at ${refreshes.map((s) => secs(s.atMs)).join(', ')} (first load at ${secs(loads[0].atMs)}).`, evidence };
  if (loads.length === 0) return { verdict: VERDICT.PASS, summary: `No vdo.ai.js request for ${tag} during the ${secs(watchMs)} watch, so nothing refreshed (see TC-01 for the missing load).`, evidence };
  return { verdict: VERDICT.PASS, summary: `No new request for ${tag} after the first load at ${secs(loads[0].atMs)}, watched for ${secs(watchMs)}.`, evidence };
}

// A report names its tag; a report without one cannot be put on another tag, so it counts for every tag tested.
function tc04({ tag, errorReports }) {
  const mine = errorReports.filter((r) => !r.tag || r.tag === tag);
  const evidence = mine.map((r) => ({ msg: r.msg, tag: r.tag, code: r.code, url: r.url, func: r.func, status: r.status ?? null }));
  if (mine.length === 0) return { verdict: VERDICT.PASS, summary: 'No logger.php?msg= error report was sent.', evidence };
  const first = mine[0];
  const code = BLOCKING_ERROR_CODES.find((c) => c.code === first.code);
  return {
    verdict: VERDICT.FAIL,
    summary: `${plural(mine.length, 'error report')} sent to logger.php${first.status ? ` (status ${first.status})` : ''}: "${first.msg}"${first.code ? `, code ${first.code}` : ''}${first.func ? `, func ${first.func}` : ''}.${code ? ` ${code.meaning}` : ''}`,
    evidence,
  };
}

function tc05({ unit, events }) {
  if (unit !== UNITS.VIDEO) {
    const errors = events.filter((e) => keyIs(e.event, 'Error'));
    if (errors.length) return { verdict: VERDICT.FAIL, summary: `The Error event fired ${plural(errors.length, 'time')}${where(errors[0])}${errors[0].eventData ? ` (eventData ${errors[0].eventData})` : ''}.`, evidence: errors.map(eventEvidence) };
    return { verdict: VERDICT.PASS, summary: `No Error event among ${plural(events.length, 'logger event')}.`, evidence: [] };
  }
  const hits = [];
  for (const e of events) {
    const blocking = VIDEO_BLOCKING_EVENTS.find((b) => keyIs(e.event, b.name, ...b.aliases));
    if (blocking) hits.push({ ...eventEvidence(e), name: blocking.name, verdict: blocking.verdict, meaning: blocking.meaning });
    const code = BLOCKING_ERROR_CODES.find((c) => [e.event, e.eventData].some((v) => String(v ?? '').includes(c.code)));
    if (code) hits.push({ ...eventEvidence(e), name: code.code, verdict: VERDICT.FAIL, meaning: code.meaning });
  }
  const fails = hits.filter((h) => h.verdict === VERDICT.FAIL);
  if (fails.length) return { verdict: VERDICT.FAIL, summary: `Blocking event${fails.length > 1 ? 's' : ''} fired: ${fails.map((h) => `${h.name}${where(h)}`).join('; ')}. ${fails[0].meaning}`, evidence: hits };
  if (hits.length) return { verdict: VERDICT.WARNING, summary: `Blocked Agent fired${where(hits[0])}. Bot traffic was detected; the validator's own browser can trigger it.`, evidence: hits };
  return { verdict: VERDICT.PASS, summary: `None of the blocking events fired among ${plural(events.length, 'logger event')}.`, evidence: [] };
}

const eventEvidence = (e) => ({ event: e.event, page_url: e.page_url ?? null, eventData: e.eventData ?? null, atMs: e.atMs ?? null });

function tc06({ events }) {
  const bad = [...new Set(events.map((e) => e.page_url).filter((u) => u && isSafeframeUrl(u)))];
  if (bad.length) return { verdict: VERDICT.FAIL, summary: `The tag is in a safeframe container: page_url is ${bad[0]}.`, evidence: bad.map((page_url) => ({ page_url })) };
  const urls = new Set(events.map((e) => e.page_url).filter(Boolean));
  return { verdict: VERDICT.PASS, summary: urls.size ? `No page_url is a safeframe URL (${plural(urls.size, 'page_url')} checked).` : 'No logger event carried a page_url, so none is a safeframe URL.', evidence: [...urls].map((page_url) => ({ page_url })) };
}

function tc07({ tag, events }) {
  const groups = new Map();
  for (const e of events) {
    const isLoaded = keyIs(e.event, 'loaded');
    const isPageview = keyIs(e.event, 'pageview');
    if (!isLoaded && !isPageview) continue;
    const key = e.page_url ?? '(no page_url)';
    const group = groups.get(key) ?? { page_url: key, loaded: 0, pageview: 0 };
    if (isLoaded) group.loaded += 1;
    else group.pageview += 1;
    groups.set(key, group);
  }
  const evidence = [...groups.values()];
  if (evidence.length === 0) return { verdict: VERDICT.FAIL, summary: `No loaded or pageview event was sent for ${tag}.`, evidence };
  const bad = evidence.filter((g) => g.loaded !== 1 || g.pageview !== 1);
  if (bad.length === 0) return { verdict: VERDICT.PASS, summary: `Every page_url has one loaded and one pageview (${plural(evidence.length, 'page_url')}).`, evidence };
  const spa = bad.some((g) => g.pageview > 0 && g.loaded === 0);
  return {
    verdict: VERDICT.FAIL,
    summary: `${bad.map((g) => `${g.page_url}: ${plural(g.loaded, 'loaded', 'loaded')}, ${plural(g.pageview, 'pageview')}`).join('; ')}.${spa ? ' A pageview for a URL with no loaded points to an infinite scroll or SPA setup that does not reload the tag.' : ''}`,
    evidence,
  };
}

function tc08({ events }) {
  const seen = EXPECTED_EVENTS.filter((name) => events.some((e) => keyIs(e.event, name)));
  const missing = EXPECTED_EVENTS.filter((name) => !seen.includes(name));
  const evidence = { seen, missing };
  if (missing.length === 0) return { verdict: VERDICT.PASS, summary: 'All eight expected events fired.', evidence };
  return { verdict: VERDICT.WARNING, summary: `${plural(missing.length, 'expected event')} did not fire: ${missing.join(', ')}${missing.includes('ad_match') ? ' (for example when no ad matched)' : ''}.`, evidence };
}

function tc09({ events }) {
  const hits = events.filter((e) => keyIs(e.event, 'size_mismatch_content'));
  if (hits.length) return { verdict: VERDICT.WARNING, summary: `size_mismatch_content fired${where(hits[0])}: the video content size does not match the player.`, evidence: hits.map(eventEvidence) };
  return { verdict: VERDICT.PASS, summary: 'size_mismatch_content did not fire.', evidence: [] };
}

function tc10({ events }) {
  const deps = [...new Set(events.map((e) => e.dep).filter(Boolean))];
  const evidence = deps.map((dep) => ({ dep }));
  const other = deps.filter((d) => d !== DEFAULT_DEP);
  if (deps.length === 0) return { verdict: VERDICT.WARNING, summary: `No logger payload carried a dep value, so the build could not be confirmed as ${DEFAULT_DEP}.`, evidence };
  if (other.length === 0) return { verdict: VERDICT.PASS, summary: `dep is ${DEFAULT_DEP}, the default build.`, evidence };
  const note = other.includes('dependencies_dev_3153') ? ' (dependencies_dev_3153 is the infinite scroll build)' : '';
  return { verdict: VERDICT.WARNING, summary: `dep is ${other.join(', ')}, not the default ${DEFAULT_DEP}${note}.`, evidence };
}

const EXPECTED_SCRIPT = {
  video: (tag) => `<script defer async src="https://a.vdo.ai/core/${tag}/vdo.ai.js">`,
  banner: (tag) => `<script async defer src="https://a.vdo.ai/core/${tag}/vdo.ai.js">`,
  offerwall: (tag) => `<script src="https://a.vdo.ai/core/${tag}/vdo.ai.js" id="vdo-ai-${tag}" async defer>`,
};

function tc11({ tag, unit, elements }) {
  const all = elements.scripts ?? [];
  const own = all.filter((s) => s.tag === tag);
  const evidence = own.map((s) => ({ src: s.src, async: s.async, defer: s.defer, id: s.id || null, frameUrl: s.frameUrl ?? null }));
  if (own.length === 1) {
    const s = own[0];
    const attrs = [s.async && 'async', s.defer && 'defer', s.id && `id="${s.id}"`].filter(Boolean).join(' ') || 'no async/defer';
    const idNote = unit === UNITS.OFFERWALL && s.id !== `vdo-ai-${tag}` ? ` The offerwall script usually has id="vdo-ai-${tag}".` : '';
    return { verdict: VERDICT.PASS, summary: `One script for ${tag}: ${s.src} (${attrs}).${idNote}`, evidence, expected: EXPECTED_SCRIPT[unit](tag) };
  }
  if (own.length > 1) return { verdict: VERDICT.FAIL, summary: `${own.length} scripts for ${tag} are on the page: ${own.map((s) => s.src).join(', ')}.`, evidence, expected: EXPECTED_SCRIPT[unit](tag) };
  const others = [...new Set(all.map((s) => s.tag))];
  return {
    verdict: VERDICT.FAIL,
    summary: others.length ? `No script for ${tag}; the page has the script of another tag: ${others.join(', ')}.` : `No vdo.ai.js script for ${tag} was found in the page.`,
    evidence: all.map((s) => ({ src: s.src, id: s.id || null })),
    expected: EXPECTED_SCRIPT[unit](tag),
  };
}

// In-content: a wrapper <TAG>-<n> holding a vdo_video_unit player. Floating: a vdo_video_unit vdo_floating player
// outside every tested tag's wrapper. Floating players carry no tag name, so when several video tags are tested on one
// page, each other tested video tag that loaded without an in-content wrapper claims one floating player first.
function tc12({ tag, elements, otherFloatingTags = 0 }) {
  const wrappers = (elements.wrappers?.[tag] ?? []).filter((w) => w.hasPlayer);
  const floatingOutside = (elements.floating ?? []).filter((f) => !f.insideWrapper).length;
  const floating = Math.max(0, floatingOutside - otherFloatingTags);
  const evidence = {
    inContent: wrappers.map((w) => ({ id: w.id, element: w.element, contentClass: w.hasContent })),
    floating: (elements.floating ?? []).filter((f) => !f.insideWrapper).map((f) => ({ id: f.id || null, className: f.className })),
    floatingCounted: floating,
    floatingClaimedByOtherTags: Math.min(floatingOutside, otherFloatingTags),
  };
  const total = wrappers.length + floating;
  if (total === 1) {
    return wrappers.length
      ? { verdict: VERDICT.PASS, summary: `In-content player found: <${wrappers[0].element} id="${wrappers[0].id}"> holding a vdo_video_unit player.`, evidence }
      : { verdict: VERDICT.PASS, summary: `Floating player found${evidence.floating[0]?.id ? `: id ${evidence.floating[0].id}` : ''} (a floating tag has no anchor div).`, evidence };
  }
  if (total === 0) {
    const empty = (elements.wrappers?.[tag] ?? []).filter((w) => !w.hasPlayer);
    return { verdict: VERDICT.FAIL, summary: `Neither player form is present${empty.length ? ` (the wrapper ${empty[0].id} is on the page but holds no vdo_video_unit player)` : ''}.`, evidence };
  }
  return { verdict: VERDICT.FAIL, summary: `More than one player: ${plural(wrappers.length, 'in-content wrapper')} (${wrappers.map((w) => w.id).join(', ') || 'none'}) and ${plural(floating, 'floating player')}.`, evidence };
}

function tc13({ tag, elements }) {
  const divs = elements.bannerDivs?.[tag] ?? [];
  const evidence = divs.map((id) => ({ id }));
  if (divs.length) return { verdict: VERDICT.PASS, summary: `Banner div found: ${divs[0]}${divs.length > 1 ? ` (+${divs.length - 1} more)` : ''}.`, evidence };
  return { verdict: VERDICT.WARNING, summary: `No div whose id contains ${underscoreForm(tag)} was found. The banner may still work, because the script is present.`, evidence };
}

// The report's Evidence column: what the validator saw, as short lines (URL and status, event and page_url, error
// code and msg, dep value, script src, element ids).
const at = (ms) => (Number.isFinite(ms) ? ` at ${secs(ms)}` : '');
const EVIDENCE_TEXT = {
  'TC-01': (ev) => ev.map((r) => `${r.url} → ${r.status ? `status ${r.status}` : r.failure ? `blocked (${r.failure})` : 'no response'}`),
  'TC-02': (ev) => [
    ...ev.requests.map((r) => `Request ${r.url}${at(r.atMs)}${r.status ? ` · status ${r.status}` : ''}${r.initiator ? ` · initiator ${initiatorText(r)}` : ''}`),
    ...ev.scriptElements.map((e) => `Script element ${e.src}${at(e.atMs)} · ${e.state}${e.frameUrl ? ` · in frame ${e.frameUrl}` : ''}`),
  ],
  'TC-04': (ev) => ev.map((r) => [`msg=${r.msg}`, r.tag && `tag=${r.tag}`, r.code && `code=${r.code}`, r.url && `url=${r.url}`, r.func && `func=${r.func}`, r.status && `status ${r.status}`].filter(Boolean).join(' · ')),
  'TC-05': (ev) => ev.map((e) => `${e.name ?? e.event} (event "${e.event}")${e.page_url ? ` on ${e.page_url}` : ''}${e.eventData && e.eventData !== '1' ? ` · eventData ${e.eventData}` : ''} → ${e.verdict ?? 'FAIL'}`),
  'TC-06': (ev) => ev.map((e) => `page_url ${e.page_url}`),
  'TC-07': (ev) => ev.map((g) => `${g.page_url}: loaded ${g.loaded}, pageview ${g.pageview}`),
  'TC-08': (ev) => [`Seen: ${ev.seen.join(', ') || 'none'}`, ...(ev.missing.length ? [`Missing: ${ev.missing.join(', ')}`] : [])],
  'TC-09': (ev) => ev.map((e) => `${e.event}${e.page_url ? ` on ${e.page_url}` : ''}`),
  'TC-10': (ev) => ev.map((e) => `dep = ${e.dep}`),
  'TC-11': (ev) => ev.map((s) => `${s.src}${s.async || s.defer ? ` · ${[s.async && 'async', s.defer && 'defer'].filter(Boolean).join(' ')}` : ''}${s.id ? ` · id="${s.id}"` : ''}${s.frameUrl ? ` · in frame ${s.frameUrl}` : ''}`),
  'TC-12': (ev) => [
    ...ev.inContent.map((w) => `In-content: <${w.element} id="${w.id}">${w.contentClass ? ' holding vdo_video_unit vdo_content' : ' holding a vdo_video_unit'}`),
    ...ev.floating.map((f) => `Floating: ${f.id ? `id ${f.id} · ` : ''}class ${f.className}`),
    ...(ev.floatingClaimedByOtherTags ? [`${plural(ev.floatingClaimedByOtherTags, 'floating player')} counted for the other video tag(s) tested on this page`] : []),
  ],
  'TC-13': (ev) => ev.map((d) => `div id="${d.id}"`),
};
EVIDENCE_TEXT['TC-03'] = EVIDENCE_TEXT['TC-02'];

const RULES = {'TC-01': tc01, 'TC-02': tc02, 'TC-03': tc03, 'TC-04': tc04, 'TC-05': tc05, 'TC-06': tc06, 'TC-07': tc07, 'TC-08': tc08, 'TC-09': tc09, 'TC-10': tc10, 'TC-11': tc11, 'TC-12': tc12, 'TC-13': tc13 };

// Events per section 7 for this unit: fired or not, with counts. Video's TC-08 has no result, so it is recorded here.
function eventsRecorded(unit, events) {
  const listed = EVENT_DEFINITIONS.filter((d) => d.units.includes(unit)).map((d) => ({ name: d.name, meaning: d.meaning, count: events.filter((e) => keyIs(e.event, d.name)).length }));
  const known = new Set(EVENT_DEFINITIONS.map((d) => eventKey(d.name)));
  const extra = {};
  for (const e of events) {
    if (!known.has(eventKey(e.event))) extra[e.event] = (extra[e.event] ?? 0) + 1;
  }
  return { listed, extra: Object.entries(extra).map(([name, count]) => ({ name, count })) };
}

// Did the tag leave any trace on the page: a vdo.ai.js request or script for it, a logger event with its tagName, or a
// logger.php report naming it.
export function tagPresent(tag, evidence) {
  const elements = evidence.elements ?? {};
  return (evidence.scripts ?? []).some((s) => s.tag === tag)
    || (evidence.scriptElements ?? []).some((e) => e.tag === tag)
    || (elements.scripts ?? []).some((s) => s.tag === tag)
    || (evidence.events ?? []).some((e) => e.tagName === tag)
    || (evidence.errorReports ?? []).some((r) => r.tag === tag);
}

const unitList = (units) => units.map((u) => UNIT_LABELS[u].toLowerCase()).join(' and ');

function notEligible(item, summary) {
  return { id: item.id, step: item.step, title: item.title, checks: item.checks, expected: item.expected, verdict: VERDICT.NOT_ELIGIBLE, summary, meaning: IMPLEMENTATION_MEANING.NOT_ELIGIBLE, evidence: null, evidenceLines: [] };
}

// Each tag is its own instance: every one of the 13 test cases is listed. Those of its unit run (even after a FAIL, each
// on its own evidence) and the tag's result is the worst of them; the others are marked not eligible.
// absentReason: set when the tag is not on this page while another entered tag is, so none of its cases is eligible.
export function evaluateTag({ tag, evidence, otherFloatingTags = 0, absentReason = null }) {
  const unit = unitOf(tag);
  // Rule 6: only the events whose tagName is the tag being tested.
  const events = (evidence.events ?? []).filter((e) => e.tagName === tag);
  const input = {
    tag,
    unit,
    scripts: evidence.scripts ?? [],
    scriptElements: evidence.scriptElements ?? [],
    errorReports: evidence.errorReports ?? [],
    events,
    elements: evidence.elements ?? {},
    loadWindowMs: evidence.loadWindowMs,
    watchMs: evidence.watchMs,
    otherFloatingTags,
  };
  const eligibleIds = new Set(casesFor(unit).map((item) => item.id));
  const cases = IMPLEMENTATION_CASES.map((item) => {
    if (absentReason) return notEligible(item, absentReason);
    if (!eligibleIds.has(item.id)) {
      const why = item.id === 'TC-08' && unit === UNITS.VIDEO
        ? 'Not eligible for video tags: the validator records which video events fired (see the logger events below), and a missing or extra event does not change the result.'
        : `Not eligible: ${item.id} applies to ${unitList(item.units)} tags only, and ${tag} is a ${UNIT_LABELS[unit].toLowerCase()} tag.`;
      return notEligible(item, why);
    }
    const outcome = RULES[item.id](input);
    return {
      id: item.id,
      step: item.step,
      title: item.title,
      checks: item.checks,
      expected: item.expected,
      verdict: outcome.verdict,
      summary: outcome.summary,
      meaning: IMPLEMENTATION_MEANING[outcome.verdict],
      evidence: outcome.evidence,
      evidenceLines: EVIDENCE_TEXT[item.id](outcome.evidence).slice(0, 20),
      ...(outcome.expected ? { expectedScript: outcome.expected } : {}),
    };
  });
  const verdictCounts = { PASS: 0, WARNING: 0, FAIL: 0, NOT_ELIGIBLE: 0 };
  for (const item of cases) verdictCounts[item.verdict] += 1;
  const total = cases.length - verdictCounts.NOT_ELIGIBLE;
  return {
    tag,
    unit,
    eligible: !absentReason,
    ...(absentReason ? { notEligibleReason: absentReason } : {}),
    overallVerdict: absentReason ? VERDICT.NOT_ELIGIBLE : worst(cases.map((item) => item.verdict)),
    verdictCounts,
    total,
    summaryLine: absentReason
      ? 'Not eligible on this page'
      : `${verdictCounts.PASS} PASS, ${verdictCounts.WARNING} WARNING, ${verdictCounts.FAIL} FAIL · ${verdictCounts.NOT_ELIGIBLE} not eligible`,
    cases,
    events: eventsRecorded(unit, events),
    eventCount: events.length,
  };
}

// All tags tested on one URL, each as its own instance with its own unit's test cases; two different tags on one page
// are not duplicates. In a run with several tags, a tag with no trace on this page while another entered tag is there
// is not eligible on this page (it is not reported as failing). When none of the tags is on the page, every tag is
// tested, so a missing installation still fails TC-01.
export function evaluateImplementation({ tags, evidence }) {
  const elements = evidence.elements ?? {};
  const present = tags.filter((t) => tagPresent(t, evidence));
  const floatingTags = tags.filter((t) => unitOf(t) === UNITS.VIDEO
    && (evidence.scripts ?? []).some((s) => s.tag === t && s.status === 200)
    && !(elements.wrappers?.[t] ?? []).some((w) => w.hasPlayer));
  const results = tags.map((tag) => {
    const absentReason = present.length > 0 && !present.includes(tag)
      ? `Not eligible on this page: ${tag} was not found here (no vdo.ai.js request or script for it and no logger event with its tagName), while ${present.join(', ')} ${present.length === 1 ? 'was' : 'were'}. Only the tags on this page are tested.`
      : null;
    return evaluateTag({ tag, evidence, otherFloatingTags: floatingTags.filter((t) => t !== tag).length, absentReason });
  });
  const eligible = results.filter((r) => r.eligible);
  return { overallVerdict: worst(eligible.map((r) => r.overallVerdict)), tags: results, testedTags: eligible.map((r) => r.tag), notEligibleTags: results.filter((r) => !r.eligible).map((r) => r.tag) };
}
