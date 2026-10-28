import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSticky } from '../src/services/sticky/rules.js';
import { STICKY_CASES } from '../src/services/sticky/guide.js';

const viewport = { w: 1366, h: 768 };
const none = { mt: 0, mb: 0, pt: 0, pb: 0 };
let clock = 0;
// A snapshot as the in-page probe returns it, with an in-content player by default.
const snap = (stage, overrides = {}) => ({
  stage,
  label: stage,
  t: (clock += 500),
  url: 'https://publisher.example/article',
  scrollY: 0,
  viewport,
  docHeight: 6000,
  found: true,
  anchor: { rect: { x: 300, y: 900, w: 640, h: 360 }, docTop: 900, spacing: none, containsFloating: false },
  inContent: { rect: { x: 300, y: 900, w: 640, h: 360 }, spacing: none, shown: true },
  isFloating: false,
  floating: [],
  player: { rect: { x: 300, y: 900, w: 640, h: 360 }, desc: 'div#vdoai_parentWrapperDiv', position: 'relative' },
  page: { body: none, html: none },
  headers: [{ desc: 'header.site-header', rect: { x: 0, y: 0, w: 1366, h: 60 }, inView: true, fraction: 0, area: 0, linksCovered: [] }],
  headlines: [{ desc: 'h1', rect: { x: 300, y: 100, w: 640, h: 40 }, inView: true, fraction: 0, area: 0, linksCovered: [] }],
  footers: [],
  others: [],
  underPlayer: { interactive: [], media: [] },
  controls: { close: [], skip: [] },
  playerVisibleFraction: 1,
  fixedBreakers: [],
  playerObscured: 0,
  obscuredBy: [],
  counts: { anchors: 1, wrappersShown: 1, floating: 1 },
  floatingAnchor: -1,
  currentAnchor: 0,
  ...overrides,
});
const floatingPlayer = { rect: { x: 950, y: 527, w: 400, h: 225 }, desc: 'div#vdoai_parentWrapperDiv', position: 'fixed' };
const goodClose = { desc: 'button.vdo_close', rect: { x: 1320, y: 531, w: 26, h: 26 }, inViewport: true, visibleFraction: 1, topmost: true };
const passedAnchor = { rect: { x: 300, y: -500, w: 640, h: 0 }, docTop: 900, spacing: none, containsFloating: true };
const floatSnap = (stage, overrides = {}) => snap(stage, { isFloating: true, player: floatingPlayer, anchor: passedAnchor, scrollY: 1800, controls: { close: [goodClose], skip: [] }, ...overrides });

const timeline = (extra = []) => [
  snap('load'), snap('load'),
  snap('scroll', { anchor: { ...passedAnchor, rect: { x: 300, y: 400, w: 640, h: 360 }, containsFloating: false }, scrollY: 500 }),
  floatSnap('scroll'), floatSnap('ad'), floatSnap('ad'), floatSnap('updown'), floatSnap('updown'),
  floatSnap('bottom'),
  // After resizing, the player repositions inside the smaller window.
  floatSnap('resize', { viewport: { w: 1024, h: 640 }, player: { ...floatingPlayer, rect: { x: 608, y: 399, w: 400, h: 225 } }, controls: { close: [{ ...goodClose, rect: { x: 978, y: 403, w: 26, h: 26 } }], skip: [] } }),
  floatSnap('zoom', { viewport: { w: 911, h: 512 }, player: { ...floatingPlayer, rect: { x: 495, y: 271, w: 400, h: 225 } }, controls: { close: [{ ...goodClose, rect: { x: 865, y: 275, w: 26, h: 26 } }], skip: [] } }),
  ...extra,
];
const verdicts = (evaluation) => Object.fromEntries(evaluation.cases.map((item) => [item.id, item.verdict]));

test('the guide lists ST-01 to ST-25 with plain-language text', () => {
  assert.deepEqual(STICKY_CASES.map((item) => item.id), Array.from({ length: 25 }, (_, i) => `ST-${String(i + 1).padStart(2, '0')}`));
  assert.ok(STICKY_CASES.every((item) => item.title && item.checks.length > 30 && item.expected));
  assert.equal(STICKY_CASES.filter((item) => item.group === 'core').length, 12);
});

test('a well-behaved content-floating player passes the core checks', () => {
  const result = evaluateSticky({ snaps: timeline([snap('after-close', { player: null, controls: { close: [], skip: [] } })]), close: { clicked: true, closed: true } });
  const v = verdicts(result);
  for (const id of ['ST-01', 'ST-02', 'ST-03', 'ST-05', 'ST-06', 'ST-07', 'ST-08', 'ST-09', 'ST-10', 'ST-12', 'ST-16', 'ST-17', 'ST-19', 'ST-21', 'ST-22', 'ST-24']) assert.equal(v[id], 'PASS', `${id}: ${result.cases.find((c) => c.id === id).summary}`);
  assert.equal(result.playerType, 'content-floating');
  assert.equal(result.cases.length, 25);
});

test('floating over the header, too large, too early and with page padding fails the matching checks', () => {
  const header = { desc: 'header.site-header', rect: { x: 0, y: 0, w: 1366, h: 60 }, inView: true, fraction: 1, area: 80000, linksCovered: [] };
  const big = { rect: { x: 0, y: 0, w: 1366, h: 400 }, desc: 'div#vdoai_parentWrapperDiv', position: 'fixed' };
  const snaps = [
    snap('load'),
    snap('load', { isFloating: true, player: big, headers: [header], page: { body: { ...none, pb: 200 }, html: none } }),
    floatSnap('ad', { player: big, headers: [header] }),
  ];
  const v = verdicts(evaluateSticky({ snaps }));
  assert.equal(v['ST-01'], 'FAIL', 'page padding added when floating started');
  assert.equal(v['ST-02'], 'FAIL');
  assert.equal(v['ST-06'], 'FAIL', 'floated before the placement was reached');
  assert.equal(v['ST-08'], 'FAIL', 'over 30% of the screen');
  assert.equal(v['ST-21'], 'FAIL');
});

test('controls, duplicates, banners and other sticky ads are judged from the snapshots', () => {
  const offClose = { ...goodClose, inViewport: false };
  const coveredSkip = { desc: 'Skip Ad button', rect: { x: 1200, y: 700, w: 110, h: 36 }, inViewport: true, visibleFraction: 1, topmost: false };
  const consent = { desc: 'div#cookie', rect: { x: 0, y: 600, w: 300, h: 120 }, adLike: false, consent: true, bottomNav: false, headerLike: false, fraction: 0.3, area: 9000, buttonsCovered: ['button'], buttons: 2 };
  const stickyAd = { desc: 'div#div-gpt-ad-sticky', rect: { x: 900, y: 700, w: 320, h: 50 }, adLike: true, consent: false, bottomNav: false, headerLike: false, fraction: 0.5, area: 8000, buttonsCovered: [], buttons: 0 };
  const snaps = timeline([floatSnap('ad', { controls: { close: [offClose], skip: [coveredSkip] }, counts: { anchors: 1, wrappersShown: 2, floating: 2 }, others: [consent, stickyAd] })]);
  const v = verdicts(evaluateSticky({ snaps, close: { clicked: true, closed: false } }));
  assert.equal(v['ST-04'], 'FAIL');
  assert.equal(v['ST-05'], 'FAIL');
  assert.equal(v['ST-10'], 'FAIL');
  assert.equal(v['ST-11'], 'FAIL');
  assert.equal(v['ST-12'], 'FAIL');
  assert.equal(v['ST-14'], 'FAIL');
  assert.equal(v['ST-15'], 'FAIL');
  assert.equal(v['ST-17'], 'FAIL', 'close did not close the player');
});

test('a player that never floats leaves the floating checks not applicable, and a missing player is unknown', () => {
  const inContentOnly = evaluateSticky({ snaps: [snap('load'), snap('scroll', { anchor: passedAnchor }), snap('bottom'), snap('resize')] });
  const v = verdicts(inContentOnly);
  for (const id of ['ST-05', 'ST-06', 'ST-08', 'ST-10', 'ST-22']) assert.equal(v[id], 'NOT_APPLICABLE', id);
  assert.equal(inContentOnly.playerType, 'in-content (did not float)');
  const missing = evaluateSticky({ snaps: [snap('load', { found: false, anchor: null, inContent: null, player: null })] });
  assert.equal(missing.verdictCounts.UNKNOWN, 25);
  assert.equal(missing.playerType, 'not found');
});

test('live sticky checks on local good and bad pages', { skip: process.env.STICKY_BROWSER_TEST ? false : 'set STICKY_BROWSER_TEST=1 (opens a real browser, about 80 s)' }, async () => {
  const { startStickySite, STICKY_TAG } = await import('./fixtures/stickySite.js');
  const { runStickyChecks } = await import('../src/services/stickyRunner.service.js');
  const { closeBrowser } = await import('../src/services/browser.service.js');
  const site = await startStickySite();
  try {
    const run = await runStickyChecks({ tag: STICKY_TAG, device: 'desktop', urls: [site.url('good'), site.url('bad')] });
    const [good, bad] = run.results.map((result) => verdicts(result.sticky));
    assert.equal(run.results[0].status, 'pass', JSON.stringify(run.results[0].sticky.cases.filter((c) => c.verdict === 'FAIL')));
    assert.equal(good['ST-05'], 'PASS', 'close button visible and works');
    assert.equal(good['ST-07'], 'PASS');
    for (const id of ['ST-02', 'ST-03', 'ST-04', 'ST-05', 'ST-06', 'ST-08', 'ST-11', 'ST-12', 'ST-14', 'ST-20', 'ST-21', 'ST-22']) assert.equal(bad[id], 'FAIL', id);
    assert.ok(run.results[1].screenshots.length >= 4, 'evidence screenshots are taken');
  } finally {
    await closeBrowser();
    await site.stop();
  }
});

test('the API accepts the sticky type and rejects options that do not belong to it', async () => {
  const { default: app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const post = (body) => fetch(`http://127.0.0.1:${server.address().port}/api/placement-checks`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'example.com', tag: 'v-example', devices: ['desktop'], urls: ['https://example.com/a'], type: 'sticky', ...body }) });
  try {
    const withDeep = await post({ deep: true });
    assert.equal(withDeep.status, 400);
    assert.match((await withDeep.json()).error, /not available with the sticky/);
    const badCode = await post({ stickyCode: 'theme.js' });
    assert.equal(badCode.status, 400);
    assert.match((await badCode.json()).error, /stickyCode/);
    const missingCode = await post({ stickyCode: 'style.css' });
    assert.equal(missingCode.status, 400, 'a chosen style.css must be supplied');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
