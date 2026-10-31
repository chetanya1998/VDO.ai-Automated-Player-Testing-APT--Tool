import { createServer } from 'node:http';

// Local articles with fake vdo.ai units for the implementation validator. a.vdo.ai and analytics.vdo.ai are served by
// routeVdo(context), so the page loads https://a.vdo.ai/core/<tag>/vdo.ai.js exactly like a publisher page.
//   /article?mode=video-good     v-fixture-v1 embedded once; in-content player; loaded, pageview, … with the default dep.
//   /article?mode=video-bad      embedded twice; Blocked IMA; logger.php error report (Q2Fubm90IH); dep dev build;
//                                size_mismatch_content; a second pageview; the tag reloads after 12 s; two wrappers.
//   /article?mode=banner-good    b-fixture-org with its b_fixture_org_… div and all eight expected events.
//   /article?mode=offerwall-bad  o-fixture with an Error event and only three of the eight expected events.
export const TAGS = { video: 'v-fixture-v1', banner: 'b-fixture-org', offerwall: 'o-fixture' };

const MODES = {
  'video-good': { tag: TAGS.video, embeds: 1 },
  'video-bad': { tag: TAGS.video, embeds: 2 },
  'banner-good': { tag: TAGS.banner, embeds: 1 },
  'offerwall-bad': { tag: TAGS.offerwall, embeds: 1, offerwall: true },
};

const text = (n) => Array.from({ length: n }, (_, i) => `<p>Paragraph ${i + 1}. ${'Plain article text. '.repeat(20)}</p>`).join('');

const embed = (tag) => `<div id="${tag}"></div>
<script data-cfasync="false">(function(v,d,o,ai){ai=d.createElement('script');ai.defer=true;ai.async=true;ai.src=v.location.protocol+o;d.head.appendChild(ai);})(window, document, '//a.vdo.ai/core/${tag}/vdo.ai.js');</script>`;

const page = (mode) => {
  const { tag, embeds, offerwall } = MODES[mode];
  const code = offerwall
    ? `<script src="https://a.vdo.ai/core/${tag}/vdo.ai.js" id="vdo-ai-${tag}" async defer></script>`
    : Array.from({ length: embeds }, () => embed(tag)).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Implementation fixture</title></head><body>
<h1>Implementation fixture (${mode})</h1>${text(3)}${code}${text(6)}</body></html>`;
};

// The fake vdo.ai.js: logPixel posts JSON to analytics.vdo.ai/logger, logError calls a.vdo.ai/core/logger.php.
const loader = (tag, mode) => `(() => {
  const tag = ${JSON.stringify(tag)};
  const mode = ${JSON.stringify(mode)};
  const dep = mode === 'video-bad' ? 'dependencies_dev_3153' : 'dependencies_hbv4_latest';
  const log = (event, extra = {}) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://analytics.vdo.ai/logger', true);
    xhr.send(JSON.stringify({ domainName: location.hostname, page_url: location.href, tagName: tag, event, eventData: 1, uid: '', dep, ...extra }));
  };
  window.__fixtureLoads = (window.__fixtureLoads || 0) + 1;
  const first = window.__fixtureLoads === 1;
  if (mode.startsWith('video')) {
    if (first || mode === 'video-bad') {
      const wrap = document.createElement('vdo');
      wrap.id = tag + '-' + (window.__fixtureLoads - 1);
      wrap.innerHTML = '<div class="vdo_video_unit vdo_content" style="width:640px;height:360px;background:#123"></div>';
      document.getElementById(tag).appendChild(wrap);
    }
    if (!first) return;
    ['loaded', 'pageview', 'website_pageview', 'initVdo', 'came_in_view', 'ad_request', 'ad_match'].forEach((e) => log(e));
    if (mode === 'video-bad') {
      log('pageview');
      log('blocked_ima');
      log('size_mismatch_content');
      const img = new XMLHttpRequest();
      img.open('get', '//a.vdo.ai/core/logger.php?msg=' + encodeURIComponent("TypeError: Cannot read properties of null (reading 'style')\\n at loadPlayerDiv") + '&tag=' + tag + '&code=Q2Fubm90IH&url=' + encodeURIComponent(location.href) + '&func=vdo.ai.js', true);
      img.send();
      setTimeout(() => { const s = document.createElement('script'); s.src = 'https://a.vdo.ai/core/' + tag + '/vdo.ai.js?refresh=1'; document.head.appendChild(s); }, 12000);
    }
  } else if (mode === 'banner-good') {
    const div = document.createElement('div');
    div.id = 'b_fixture_org_Anchor_Top_1';
    div.style.cssText = 'width:300px;height:250px;background:#321';
    document.getElementById(tag).appendChild(div);
    ['loaded', 'pageview', 'website_pageview', 'pageview_match', 'website_pageview_match', 'ad_match', 'came_in_view', 'ad_request'].forEach((e) => log(e));
  } else {
    ['loaded', 'pageview', 'website_pageview'].forEach((e) => log(e));
    log('error', { eventData: 'TypeError' });
  }
})();`;

// Serves a.vdo.ai and analytics.vdo.ai inside the browser context (no real network).
export async function routeVdo(context) {
  await context.route(/^https?:\/\/(a|analytics|analytics1)\.vdo\.ai\//, async (route) => {
    const url = new URL(route.request().url());
    const match = url.pathname.match(/^\/core\/([^/]+)\/vdo\.ai\.js$/);
    if (match) {
      // Cross-origin referers carry only the origin, so the mode comes from the page that asked for the script.
      let pageUrl = 'http://x/?mode=video-good';
      try { pageUrl = route.request().frame().url(); } catch { /* keep the default */ }
      const mode = new URL(pageUrl).searchParams.get('mode') ?? 'video-good';
      return route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: loader(match[1], mode) });
    }
    return route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: 'ok' });
  });
}

export async function startImplementationSite() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    request.resume();
    const mode = url.searchParams.get('mode');
    if (url.pathname === '/article' && MODES[mode]) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(page(mode));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, url: (mode) => `${origin}/article?mode=${mode}`, stop: () => new Promise((resolve) => server.close(resolve)) };
}
