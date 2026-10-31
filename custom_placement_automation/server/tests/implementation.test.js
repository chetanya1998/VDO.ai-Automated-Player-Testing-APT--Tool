import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateImplementation,
  evaluateTag,
  eventKey,
  isErrorReportUrl,
  isLoggerEventUrl,
  parseErrorReport,
  parseLoggerPayload,
  parseTags,
  siteOf,
  tagFromScriptUrl,
  unitOf,
} from '../src/services/implementation/rules.js';
import { IMPLEMENTATION_CASES, casesFor } from '../src/services/implementation/guide.js';

const PAGE = 'https://www.koimoi.com/news/story';
const script = (tag, overrides = {}) => ({ url: `https://a.vdo.ai/core/${tag}/vdo.ai.js`, tag, atMs: 1200, status: 200, failure: null, initiator: { type: 'script', url: PAGE }, ...overrides });
const event = (tag, name, overrides = {}) => ({ event: name, tagName: tag, page_url: PAGE, dep: 'dependencies_hbv4_latest', eventData: '1', ...overrides });
const healthyEvents = (tag, names = ['loaded', 'pageview', 'website_pageview', 'pageview_match', 'website_pageview_match', 'ad_match', 'came_in_view', 'ad_request']) => names.map((n) => event(tag, n));
const elementsFor = (tag, overrides = {}) => ({
  scripts: [{ src: `https://a.vdo.ai/core/${tag}/vdo.ai.js`, tag, async: true, defer: true, id: unitOf(tag) === 'offerwall' ? `vdo-ai-${tag}` : '' }],
  wrappers: { [tag]: unitOf(tag) === 'video' ? [{ id: `${tag}-0`, element: 'vdo', hasPlayer: true, hasContent: true }] : [] },
  floating: [],
  bannerDivs: { [tag]: unitOf(tag) === 'banner' ? [`${tag.replace(/-/g, '_')}_Anchor_Top_1`] : [] },
  ...overrides,
});
const evidence = (tag, overrides = {}) => ({ scripts: [script(tag)], errorReports: [], events: healthyEvents(tag), elements: elementsFor(tag), loadWindowMs: 10000, watchMs: 30000, ...overrides });
const verdicts = (result) => Object.fromEntries(result.cases.map((c) => [c.id, c.verdict]));

test('the guide lists TC-01 to TC-13; video and banner run 11 test cases, offerwall 10', () => {
  assert.deepEqual(IMPLEMENTATION_CASES.map((c) => c.id), Array.from({ length: 13 }, (_, i) => `TC-${String(i + 1).padStart(2, '0')}`));
  assert.equal(casesFor('video').length, 11);
  assert.equal(casesFor('banner').length, 11);
  assert.equal(casesFor('offerwall').length, 10);
  assert.ok(!casesFor('video').some((c) => c.id === 'TC-08'), 'video records TC-08 events without a result');
  assert.ok(!casesFor('offerwall').some((c) => ['TC-09', 'TC-12', 'TC-13'].includes(c.id)));
});

test('tags, units and URLs are recognised', () => {
  assert.deepEqual(['v-livemint', 'v-livemint-v1', 'livemint', 'b-tayyar-org-v0', 'o-metbeatnews'].map(unitOf), ['video', 'video', 'video', 'banner', 'offerwall']);
  assert.equal(siteOf('v-tayyar-org-v1'), 'tayyar-org');
  assert.equal(siteOf('b-tayyar-org'), 'tayyar-org');
  assert.deepEqual(parseTags('v-livemint, v-livemint-v1\nb-tayyar  v-livemint'), ['v-livemint', 'v-livemint-v1', 'b-tayyar']);
  assert.equal(tagFromScriptUrl('https://a.vdo.ai/core/v-koimoi-v1/vdo.ai.js'), 'v-koimoi-v1');
  assert.equal(tagFromScriptUrl('https://evil.example/core/v-koimoi-v1/vdo.ai.js'), null);
  assert.equal(isErrorReportUrl('https://a.vdo.ai/core/logger.php?msg=TypeError&tag=v-ibctamil&code=Q2Fubm90IH&func=vdo.ai.js'), true);
  assert.equal(isErrorReportUrl('https://a.vdo.ai/core/logger.php'), false, 'only logger.php?msg= is an error report');
  assert.equal(isLoggerEventUrl('https://analytics.vdo.ai/logger'), true);
  assert.equal(isLoggerEventUrl('https://a.vdo.ai/core/logger.php?msg=x'), false);
  assert.equal(eventKey('Blocked IMA'), eventKey('blocked_ima'));
});

test('logger payloads are read from JSON, form and query bodies', () => {
  assert.deepEqual(parseLoggerPayload(JSON.stringify({ domainName: 'x.com', page_url: PAGE, tagName: 'v-x', event: 'loaded', eventData: 1, uid: '', dep: 'dependencies_hbv4_latest' })), [{ event: 'loaded', tagName: 'v-x', page_url: PAGE, dep: 'dependencies_hbv4_latest', eventData: '1', domainName: 'x.com' }]);
  assert.equal(parseLoggerPayload('event=pageview&tagName=v-x')[0].event, 'pageview');
  assert.equal(parseLoggerPayload(JSON.stringify([{ event: 'a', tagName: 't' }, { event: 'b', tagName: 't' }])).length, 2);
  assert.equal(parseLoggerPayload(null, 'https://analytics.vdo.ai/logger?event=loaded&tagName=v-x')[0].tagName, 'v-x');
  const report = parseErrorReport(`https://a.vdo.ai/core/logger.php?msg=${encodeURIComponent("TypeError: Cannot read properties of null (reading 'style')\n at loadPlayerDiv")}&tag=v-ibctamil&code=Q2Fubm90IH&url=${encodeURIComponent('https://ibctamil.com/a')}&func=vdo.ai.js`);
  assert.deepEqual(report, { msg: "TypeError: Cannot read properties of null (reading 'style')", tag: 'v-ibctamil', code: 'Q2Fubm90IH', url: 'https://ibctamil.com/a', func: 'vdo.ai.js' });
});

test('a healthy video, banner and offerwall pass every test case they run', () => {
  for (const tag of ['v-koimoi-v1', 'b-tayyar-org-v1', 'o-metbeatnews']) {
    const result = evaluateTag({ tag, evidence: evidence(tag) });
    assert.equal(result.overallVerdict, 'PASS', `${tag}: ${JSON.stringify(result.cases.filter((c) => c.verdict !== 'PASS'))}`);
    assert.equal(result.summaryLine, `${result.total} PASS, 0 WARNING, 0 FAIL`);
  }
});

test('reference examples from section 8 of the test case document', () => {
  // koimoi.com: one 200 request, in-content wrapper, dep dependencies_vdodev_1343 → TC-01, TC-02, TC-12 PASS, TC-10 WARNING.
  const koimoi = verdicts(evaluateTag({ tag: 'v-koimoi-v1', evidence: evidence('v-koimoi-v1', { events: healthyEvents('v-koimoi-v1').map((e) => ({ ...e, dep: 'dependencies_vdodev_1343' })) }) }));
  assert.deepEqual([koimoi['TC-01'], koimoi['TC-02'], koimoi['TC-12'], koimoi['TC-10']], ['PASS', 'PASS', 'PASS', 'WARNING']);

  // ibctamil.com: logger.php?msg=TypeError … code Q2Fubm90IH under the vdo.ai.js filter → TC-04 FAIL (even with status 200).
  const ibc = evaluateTag({ tag: 'v-ibctamil', evidence: evidence('v-ibctamil', { errorReports: [{ msg: "TypeError: Cannot read properties of null (reading 'style')", tag: 'v-ibctamil', code: 'Q2Fubm90IH', url: 'https://ibctamil.com/a', func: 'vdo.ai.js', status: 200 }] }) });
  const tc04 = ibc.cases.find((c) => c.id === 'TC-04');
  assert.equal(tc04.verdict, 'FAIL');
  assert.match(tc04.summary, /Q2Fubm90IH/);
  assert.equal(ibc.overallVerdict, 'FAIL');

  // insights.dsij.in: dep = dependencies_dev_3153 → TC-10 WARNING (infinite scroll build).
  const dsij = evaluateTag({ tag: 'v-dsij-in', evidence: evidence('v-dsij-in', { events: healthyEvents('v-dsij-in').map((e) => ({ ...e, dep: 'dependencies_dev_3153' })) }) });
  assert.equal(verdicts(dsij)['TC-10'], 'WARNING');
  assert.match(dsij.cases.find((c) => c.id === 'TC-10').summary, /infinite scroll/);
  assert.equal(dsij.overallVerdict, 'WARNING', 'a WARNING never makes the tag FAIL');

  // tayyar.org: the expected script and a b_tayyar_org_v1_Anchor_Top_ container → TC-11 and TC-13 PASS.
  const tayyar = verdicts(evaluateTag({ tag: 'b-tayyar-org-v1', evidence: evidence('b-tayyar-org-v1') }));
  assert.deepEqual([tayyar['TC-11'], tayyar['TC-13']], ['PASS', 'PASS']);

  // metbeatnews: the offerwall script with id vdo-ai-o-metbeatnews → TC-11 PASS; offerwall never runs TC-13.
  const met = evaluateTag({ tag: 'o-metbeatnews', evidence: evidence('o-metbeatnews') });
  assert.equal(verdicts(met)['TC-11'], 'PASS');
  assert.equal(verdicts(met)['TC-13'], undefined);
});

test('TC-01 names the problem: missing, wrong unit prefix, another site, bad status, blocked', () => {
  const tc01 = (tag, scripts) => evaluateTag({ tag, evidence: evidence(tag, { scripts }) }).cases.find((c) => c.id === 'TC-01');
  assert.match(tc01('v-x', []).summary, /No vdo.ai.js request/);
  assert.match(tc01('b-tayyar-org', [script('v-tayyar-org')]).summary, /wrong unit prefix/);
  assert.match(tc01('v-livemint', [script('v-livemint-v1')]).summary, /another tag of this site/);
  assert.match(tc01('v-livemint', [script('v-koimoi')]).summary, /another website's tag/);
  assert.match(tc01('v-x', [script('v-x', { status: 404 })]).summary, /status 404/);
  const blocked = tc01('v-x', [script('v-x', { status: null, failure: 'net::ERR_BLOCKED_BY_CLIENT' })]);
  assert.equal(blocked.verdict, 'FAIL');
  assert.match(blocked.summary, /blocked/);
});

test('TC-02 counts only the entered tag; TC-03 catches a reload during the watch', () => {
  const twice = evaluateTag({ tag: 'v-livemint', evidence: evidence('v-livemint', { scripts: [script('v-livemint'), script('v-livemint', { atMs: 1300 }), script('v-livemint-v1')] }) });
  assert.equal(verdicts(twice)['TC-02'], 'FAIL');
  const other = evaluateTag({ tag: 'v-livemint', evidence: evidence('v-livemint', { scripts: [script('v-livemint'), script('v-livemint-v1'), script('v-livemint-v1', { atMs: 1400 })] }) });
  assert.equal(verdicts(other)['TC-02'], 'PASS', 'requests for v-livemint-v1 are not counted for v-livemint');
  // Chromium serves two identical in-flight script requests with one network request: the two script elements show it.
  const element = (atMs, state = 'loaded') => ({ tag: 'v-x', src: 'https://a.vdo.ai/core/v-x/vdo.ai.js', atMs, state });
  const coalesced = evaluateTag({ tag: 'v-x', evidence: evidence('v-x', { scriptElements: [element(40), element(45)] }) });
  assert.equal(verdicts(coalesced)['TC-02'], 'FAIL');
  assert.match(coalesced.cases.find((c) => c.id === 'TC-02').summary, /2 vdo.ai.js script elements .* 1 network request/);
  assert.equal(verdicts(evaluateTag({ tag: 'v-x', evidence: evidence('v-x', { scriptElements: [element(40), element(45, 'error')] }) }))['TC-02'], 'PASS', 'an element that failed to load is not a load');
  const refreshed = evaluateTag({ tag: 'v-x', evidence: evidence('v-x', { scripts: [script('v-x', { atMs: 1000 }), script('v-x', { atMs: 21000 })] }) });
  assert.deepEqual([verdicts(refreshed)['TC-02'], verdicts(refreshed)['TC-03']], ['PASS', 'FAIL']);
  assert.match(refreshed.cases.find((c) => c.id === 'TC-03').summary, /21\.0 s/);
});

test('TC-05: video fails on blocking events and error codes, warns on Blocked Agent; banner and offerwall only on Error', () => {
  const tc05 = (tag, names, extra = {}) => evaluateTag({ tag, evidence: evidence(tag, { events: [...healthyEvents(tag), ...names.map((n) => event(tag, n, extra))] }) }).cases.find((c) => c.id === 'TC-05');
  for (const name of ['Blocked Player', 'player_blocked', 'BlockedInline', 'BlockedAutoPlay', 'blocked_ima', 'Blocked Device', 'Blocked URL']) assert.equal(tc05('v-x', [name]).verdict, 'FAIL', name);
  assert.equal(tc05('v-x', ['error'], { eventData: 'Q2Fubm90IH' }).verdict, 'FAIL', 'error code Q2Fubm90IH');
  assert.equal(tc05('v-x', ['error'], { eventData: 'bnVsbCBpcy' }).verdict, 'FAIL', 'error code bnVsbCBpcy');
  assert.equal(tc05('v-x', ['blocked_agent']).verdict, 'WARNING');
  assert.equal(tc05('v-x', ['error'], { eventData: 'VHlwZUVycm' }).verdict, 'PASS', 'video lists only the blocking events and the two codes');
  assert.equal(tc05('b-x', ['Error']).verdict, 'FAIL');
  assert.equal(tc05('o-x', ['error']).verdict, 'FAIL');
  assert.equal(tc05('b-x', ['blocked_ima']).verdict, 'PASS', 'extra events never fail banner TC-05');
  assert.match(tc05('v-x', ['blocked_ima']).summary, new RegExp(PAGE.replace(/[./]/g, '\\$&')));
});

test('logger events count only for the tag in tagName (rule 6)', () => {
  const result = evaluateTag({ tag: 'v-livemint', evidence: evidence('v-livemint', { events: [...healthyEvents('v-livemint'), event('v-livemint-v1', 'blocked_ima'), event('v-livemint-v1', 'pageview')] }) });
  assert.equal(result.overallVerdict, 'PASS');
});

test('TC-06 safeframe, TC-07 loaded/pageview per page_url, TC-08 expected events, TC-09 size mismatch', () => {
  const sf = 'https://0696a8f32fd9dd37b4050d9734714c15.safeframe.googlesyndication.com/safeframe/1-0-45/html/container.html';
  assert.equal(verdicts(evaluateTag({ tag: 'v-x', evidence: evidence('v-x', { events: healthyEvents('v-x').map((e) => ({ ...e, page_url: sf })) }) }))['TC-06'], 'FAIL');

  const second = 'https://www.koimoi.com/news/next-story';
  const infinite = evaluateTag({ tag: 'v-x', evidence: evidence('v-x', { events: [...healthyEvents('v-x'), event('v-x', 'loaded', { page_url: second }), event('v-x', 'pageview', { page_url: second })] }) });
  assert.equal(verdicts(infinite)['TC-07'], 'PASS', 'each article of an infinite scroll has its own loaded and pageview');
  const spa = evaluateTag({ tag: 'v-x', evidence: evidence('v-x', { events: [...healthyEvents('v-x'), event('v-x', 'pageview', { page_url: second })] }) });
  assert.equal(verdicts(spa)['TC-07'], 'FAIL');
  assert.match(spa.cases.find((c) => c.id === 'TC-07').summary, /SPA/);
  const doubled = evaluateTag({ tag: 'v-x', evidence: evidence('v-x', { events: [...healthyEvents('v-x'), event('v-x', 'loaded')] }) });
  assert.equal(verdicts(doubled)['TC-07'], 'FAIL');

  const missing = evaluateTag({ tag: 'b-x', evidence: evidence('b-x', { events: healthyEvents('b-x', ['loaded', 'pageview', 'website_pageview']) }) });
  assert.equal(verdicts(missing)['TC-08'], 'WARNING');
  assert.deepEqual(missing.cases.find((c) => c.id === 'TC-08').evidence.missing, ['pageview_match', 'website_pageview_match', 'ad_match', 'came_in_view', 'ad_request']);

  const mismatch = evaluateTag({ tag: 'v-x', evidence: evidence('v-x', { events: [...healthyEvents('v-x'), event('v-x', 'size_mismatch_content')] }) });
  assert.equal(verdicts(mismatch)['TC-09'], 'WARNING');
  assert.equal(mismatch.overallVerdict, 'WARNING');
  assert.ok(mismatch.events.listed.find((e) => e.name === 'size_mismatch_content').count === 1, 'video events are recorded');
});

test('TC-11 script once, TC-12 player once (with floating attribution), TC-13 banner div', () => {
  const twoScripts = elementsFor('v-x');
  twoScripts.scripts.push({ ...twoScripts.scripts[0] });
  assert.equal(verdicts(evaluateTag({ tag: 'v-x', evidence: evidence('v-x', { elements: twoScripts }) }))['TC-11'], 'FAIL');
  assert.match(evaluateTag({ tag: 'v-x', evidence: evidence('v-x', { elements: { ...elementsFor('v-x'), scripts: [{ src: 'https://a.vdo.ai/core/v-y/vdo.ai.js', tag: 'v-y' }] } }) }).cases.find((c) => c.id === 'TC-11').summary, /another tag: v-y/);

  const floatingOnly = { ...elementsFor('v-x'), wrappers: { 'v-x': [] }, floating: [{ id: '_vdo_ads_player_ai_39685', className: 'vdo_video_unit vdo_floating', insideWrapper: false }] };
  assert.equal(verdicts(evaluateTag({ tag: 'v-x', evidence: evidence('v-x', { elements: floatingOnly }) }))['TC-12'], 'PASS');
  const both = { ...elementsFor('v-x'), floating: floatingOnly.floating };
  assert.equal(verdicts(evaluateTag({ tag: 'v-x', evidence: evidence('v-x', { elements: both }) }))['TC-12'], 'FAIL', 'an in-content and a floating player for one tag is more than one');
  const none = { ...elementsFor('v-x'), wrappers: { 'v-x': [{ id: 'v-x-0', element: 'vdo', hasPlayer: false, hasContent: false }] } };
  assert.match(evaluateTag({ tag: 'v-x', evidence: evidence('v-x', { elements: none }) }).cases.find((c) => c.id === 'TC-12').summary, /holds no vdo_video_unit/);

  // v-livemint is in-content, v-livemint-v1 is floating: the floating player belongs to v-livemint-v1, not a duplicate.
  const page = {
    scripts: [script('v-livemint'), script('v-livemint-v1')],
    errorReports: [],
    events: [...healthyEvents('v-livemint'), ...healthyEvents('v-livemint-v1')],
    elements: {
      scripts: ['v-livemint', 'v-livemint-v1'].map((tag) => ({ src: `https://a.vdo.ai/core/${tag}/vdo.ai.js`, tag, async: true, defer: true })),
      wrappers: { 'v-livemint': [{ id: 'v-livemint-0', element: 'vdo', hasPlayer: true, hasContent: true }], 'v-livemint-v1': [] },
      floating: floatingOnly.floating,
      bannerDivs: {},
    },
    loadWindowMs: 10000,
    watchMs: 30000,
  };
  const multi = evaluateImplementation({ tags: ['v-livemint', 'v-livemint-v1'], evidence: page });
  assert.deepEqual(multi.tags.map((t) => [t.tag, verdicts(t)['TC-12']]), [['v-livemint', 'PASS'], ['v-livemint-v1', 'PASS']]);
  assert.equal(multi.overallVerdict, 'PASS');

  assert.equal(verdicts(evaluateTag({ tag: 'b-x', evidence: evidence('b-x', { elements: { ...elementsFor('b-x'), bannerDivs: { 'b-x': [] } } }) }))['TC-13'], 'WARNING');
});

test('every test case runs after a FAIL, and the tag result is the worst one', () => {
  const result = evaluateTag({ tag: 'v-x', evidence: { scripts: [], errorReports: [], events: [], elements: {}, loadWindowMs: 10000, watchMs: 30000 } });
  assert.equal(result.cases.length, 11);
  assert.equal(result.overallVerdict, 'FAIL');
  assert.ok(result.cases.every((c) => c.summary && c.verdict), 'each test case has its own result and evidence text');
});

test('live implementation checks on local video, banner and offerwall pages', { skip: process.env.IMPLEMENTATION_BROWSER_TEST ? false : 'set IMPLEMENTATION_BROWSER_TEST=1 (opens a real browser, about 1.5 minutes)' }, async () => {
  const { startImplementationSite, routeVdo, TAGS } = await import('./fixtures/implementationSite.js');
  const { runImplementationChecks } = await import('../src/services/implementationRunner.service.js');
  const { closeBrowser } = await import('../src/services/browser.service.js');
  const site = await startImplementationSite();
  try {
    const video = await runImplementationChecks({ tags: [TAGS.video], device: 'desktop', urls: [site.url('video-good'), site.url('video-bad')], watchSec: 15, prepareContext: routeVdo });
    const [good, bad] = video.results;
    assert.equal(good.status, 'pass', JSON.stringify(good.implementation?.tags[0].cases.filter((c) => c.verdict !== 'PASS')));
    assert.equal(good.implementation.tags[0].summaryLine, '11 PASS, 0 WARNING, 0 FAIL');
    assert.equal(bad.status, 'fail');
    const badVerdicts = verdicts(bad.implementation.tags[0]);
    for (const id of ['TC-02', 'TC-03', 'TC-04', 'TC-05', 'TC-07', 'TC-11', 'TC-12']) assert.equal(badVerdicts[id], 'FAIL', `${id}: ${bad.implementation.tags[0].cases.find((c) => c.id === id).summary}`);
    for (const id of ['TC-09', 'TC-10']) assert.equal(badVerdicts[id], 'WARNING', id);
    assert.equal(badVerdicts['TC-01'], 'PASS');
    assert.ok(good.screenshots.length >= 1);

    const others = await runImplementationChecks({ tags: [TAGS.banner, TAGS.offerwall], device: 'mobile', urls: [site.url('banner-good'), site.url('offerwall-bad')], watchSec: 5, prepareContext: routeVdo });
    const [bannerPage, offerPage] = others.results.map((r) => Object.fromEntries(r.implementation.tags.map((t) => [t.tag, t])));
    assert.equal(bannerPage[TAGS.banner].overallVerdict, 'PASS', JSON.stringify(bannerPage[TAGS.banner].cases.filter((c) => c.verdict !== 'PASS')));
    assert.equal(verdicts(bannerPage[TAGS.offerwall])['TC-01'], 'FAIL', 'the offerwall tag is not on the banner page');
    const offer = verdicts(offerPage[TAGS.offerwall]);
    assert.deepEqual([offer['TC-01'], offer['TC-05'], offer['TC-08'], offer['TC-11']], ['PASS', 'FAIL', 'WARNING', 'PASS']);
  } finally {
    await closeBrowser();
    await site.stop();
  }
});

test('the API accepts the implementation type with several tags and rejects options that do not belong to it', async () => {
  const { default: app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const post = (body) => fetch(`http://127.0.0.1:${server.address().port}/api/placement-checks`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'livemint.com', tag: 'v-livemint, v-livemint-v1', devices: ['desktop'], urls: ['https://livemint.com/a'], type: 'implementation', ...body }) });
  try {
    const withDeep = await post({ deep: true });
    assert.equal(withDeep.status, 400);
    assert.match((await withDeep.json()).error, /not available with the implementation validator/);
    const badWatch = await post({ watchSec: 10 });
    assert.equal(badWatch.status, 400);
    assert.match((await badWatch.json()).error, /watchSec/);
    const badTag = await post({ tag: 'v-livemint, v-live mint!' });
    assert.equal(badTag.status, 400);
    const placementWithTwoTags = await post({ type: 'vdo.ai.js', script: 'x' });
    assert.equal(placementWithTwoTags.status, 400, 'only the implementation validator takes several tags');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
