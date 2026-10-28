import { createServer } from 'node:http';

// A local article with a fake vdo.ai player for sticky checks.
//   /article?mode=good  floats bottom-right after its place is scrolled past, closes, keeps clear of everything.
//   /article?mode=bad   floats on load inside a transformed <main> (so it scrolls with the page), over the headline,
//                       adds page padding, jumps when the "ad" loads, has a cut-off close and Skip Ad button, leaves a
//                       large empty gap, and a second floating copy covers the header, a sticky ad and the consent banner.
export const STICKY_TAG = 'v-sticky-site';

const text = (n) => Array.from({ length: n }, (_, i) => `<p>Paragraph ${i + 1}. ${'Plain article text without links. '.repeat(12)}</p>`).join('');

const page = (mode) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sticky fixture</title>
<style>
  body { margin: 0; padding-top: 60px; font: 16px/1.5 sans-serif; }
  .site-header { position: fixed; top: 0; left: 0; right: 0; height: 60px; background: #eee; z-index: 100; display: flex; gap: 16px; align-items: center; padding: 0 16px; }
  main { max-width: 720px; margin: 0 auto; padding: 0 16px; }
  .consent { position: fixed; left: 16px; ${mode === 'bad' ? 'top: 70px' : 'bottom: 16px'}; width: 280px; background: #fff; border: 1px solid #999; padding: 8px; z-index: 50; }
  .sticky-ad { position: fixed; right: 16px; top: 70px; width: 320px; height: 50px; background: #fdd; z-index: 60; }
  footer { padding: 24px 16px; background: #ddd; }
</style></head><body>
<header class="site-header"><a href="#home">Home</a><a href="#news">News</a><a href="#sport">Sport</a></header>
<main ${mode === 'bad' ? 'style="transform: translateZ(0)"' : ''}>
  <h1 class="entry-title">Sticky fixture article (${mode})</h1>
  ${text(9)}
  <div id="${STICKY_TAG}"></div>
  ${text(18)}
</main>
<footer><a href="#about">About</a> · <a href="#contact">Contact</a></footer>
<div class="consent" id="cookie-consent">We use cookies. <button>Accept all</button> <button>Settings</button></div>
${mode === 'bad' ? '<div class="sticky-ad" id="div-gpt-ad-sticky"><iframe title="ad" style="width:100%;height:100%;border:0"></iframe></div>' : ''}
<script>(function(v,d,o,ai){ai=d.createElement('script');ai.async=true;ai.src=v.location.protocol+o;d.head.appendChild(ai);})(window,document,'//'+location.host+'/core/${STICKY_TAG}/vdo.ai.js');</script>
</body></html>`;

const skipFrame = (offset) => `<!doctype html><body style="margin:0;background:#234;color:#fff;font:14px sans-serif">Ad playing
<button class="videoAdUiSkipButton" style="position:absolute;right:${offset}px;bottom:12px;width:110px;height:36px;display:none">Skip Ad</button>
<script>setTimeout(() => { document.querySelector('button').style.display = 'block'; }, 1500);</script></body>`;

const loader = (mode) => `(() => {
  const mode = ${JSON.stringify(mode)};
  const anchor = document.getElementById('${STICKY_TAG}');
  const make = (id) => {
    const wrap = document.createElement('div');
    wrap.id = id;
    wrap.className = 'vdoai_parentWrapperDiv';
    const frame = document.createElement('iframe');
    frame.className = 'vdo_ad_frame';
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
    frame.srcdoc = ${JSON.stringify(skipFrame(12))}.replace('right:12px', mode === 'bad' ? 'right:-60px' : 'right:12px');
    const close = document.createElement('button');
    close.className = 'vdo_close_btn';
    close.textContent = '×';
    close.style.cssText = 'position:absolute;top:4px;width:26px;height:26px;z-index:2;' + (mode === 'bad' ? 'right:-18px' : 'right:4px');
    wrap.append(frame, close);
    return { wrap, close };
  };
  const inContent = 'position:relative;width:100%;max-width:640px;height:360px;background:#123';
  const { wrap, close } = make('vdoai_parentWrapperDiv');
  wrap.style.cssText = inContent;
  anchor.append(wrap);
  let closed = false;
  close.onclick = () => { closed = true; wrap.style.display = 'none'; };

  if (mode === 'good') {
    const float = (on) => {
      if (closed) return;
      const width = Math.min(400, innerWidth - 32);
      wrap.style.cssText = on ? 'position:fixed;right:16px;bottom:16px;width:' + width + 'px;height:' + Math.round(width * 9 / 16) + 'px;z-index:9999;background:#123' : inContent;
    };
    addEventListener('scroll', () => float(anchor.getBoundingClientRect().bottom < 0));
    return;
  }
  // Bad: floats immediately, over the header, with page padding and an empty 600 px gap left behind.
  anchor.style.minHeight = '600px';
  const big = () => 'position:fixed;left:0;top:' + top + 'px;width:' + innerWidth + 'px;height:' + Math.round(innerHeight * 0.45) + 'px;z-index:9999;background:#123';
  let top = 0;
  wrap.style.cssText = big();
  document.body.style.paddingBottom = '200px';
  setTimeout(() => { top = 40; wrap.style.cssText = big(); }, 2500);
  addEventListener('resize', () => { if (!closed) wrap.style.cssText = big(); });
  // A second copy floating at the top, over the header, the sticky ad and the consent banner.
  const copy = make('vdoai_parentWrapperDiv_2');
  copy.wrap.style.cssText = 'position:fixed;left:0;top:0;width:' + innerWidth + 'px;height:180px;z-index:9998;background:#321';
  document.body.append(copy.wrap);
})();`;

export async function startStickySite() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    request.resume();
    if (url.pathname === '/article') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(page(url.searchParams.get('mode') === 'bad' ? 'bad' : 'good'));
    } else if (url.pathname === `/core/${STICKY_TAG}/vdo.ai.js`) {
      const mode = new URL(request.headers.referer ?? 'http://x/?mode=good').searchParams.get('mode') === 'bad' ? 'bad' : 'good';
      response.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' });
      response.end(loader(mode));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, url: (mode) => `${origin}/article?mode=${mode}`, stop: () => new Promise((resolve) => server.close(resolve)) };
}
