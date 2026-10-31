// Runs inside each frame of the page (Elements step, TC-11 to TC-13). Plain DOM only: it is serialized by Playwright.
export function elementsProbe(tags) {
  const isVdoHost = (host) => host === 'vdo.ai' || host.endsWith('.vdo.ai');
  const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const scripts = [];
  for (const el of document.querySelectorAll('script[src]')) {
    let url;
    try { url = new URL(el.getAttribute('src'), location.href); } catch { continue; }
    const match = url.pathname.match(/^\/core\/([^/]+)\/vdo\.ai\.js$/);
    if (!isVdoHost(url.hostname) || !match) continue;
    scripts.push({ src: url.href, tag: decodeURIComponent(match[1]), async: el.async || el.hasAttribute('async'), defer: el.defer || el.hasAttribute('defer'), id: el.id || '' });
  }

  // In-content wrappers: id <TAG>-<n>, e.g. <vdo id="v-koimoi-v1-0">. v-livemint-0 never matches v-livemint-v1-0.
  const wrapperRe = tags.map((tag) => new RegExp(`^${escapeRe(tag)}-\\d+$`));
  const wrappers = Object.fromEntries(tags.map((tag) => [tag, []]));
  const wrapperEls = [];
  for (const el of document.querySelectorAll('[id]')) {
    tags.forEach((tag, i) => {
      if (!wrapperRe[i].test(el.id)) return;
      const isPlayer = el.classList.contains('vdo_video_unit');
      wrappers[tag].push({
        id: el.id,
        element: el.tagName.toLowerCase(),
        hasPlayer: isPlayer || Boolean(el.querySelector('.vdo_video_unit')),
        hasContent: (isPlayer && el.classList.contains('vdo_content')) || Boolean(el.querySelector('.vdo_video_unit.vdo_content')),
      });
      wrapperEls.push(el);
    });
  }

  const floating = [...document.querySelectorAll('.vdo_video_unit.vdo_floating')].map((el) => ({
    id: el.id || '',
    className: String(el.className).slice(0, 160),
    insideWrapper: wrapperEls.some((w) => w === el || w.contains(el)),
  }));

  // Banner divs: the tag with hyphens as underscores in the id (b_tayyar_org_v1_Anchor_Top_…). For b-tayyar-org, a div
  // of the b-tayyar-org-v1 tag (b_tayyar_org_v1…) is another tag's div and does not count.
  const bannerDivs = Object.fromEntries(tags.map((tag) => {
    const form = tag.replace(/-/g, '_');
    const re = new RegExp(`${escapeRe(form)}(?!_v\\d+(?:_|$))(?:_|$)`);
    const ids = [...document.querySelectorAll('div[id]')].map((el) => el.id).filter((id) => re.test(id)).slice(0, 5);
    return [tag, ids];
  }));

  return { scripts, wrappers, floating, bannerDivs };
}

// Init script (every frame, before the page's own code): records each vdo.ai.js <script> element as it is inserted and
// whether it loaded. Chromium serves two identical in-flight script requests with one network request, even with the
// cache disabled, so a duplicate embed is only visible by counting the elements that load (TC-02 / TC-03).
export function scriptWatchScript() {
  const seen = [];
  window.__vdoScriptLoads = seen;
  const check = (node) => {
    if (!node || node.nodeName !== 'SCRIPT' || node.__vdoSeen) return;
    const src = node.getAttribute('src');
    if (!src) return;
    let url;
    try { url = new URL(src, location.href); } catch { return; }
    if (!(url.hostname === 'vdo.ai' || url.hostname.endsWith('.vdo.ai'))) return;
    const match = url.pathname.match(/^\/core\/([^/]+)\/vdo\.ai\.js$/);
    if (!match) return;
    node.__vdoSeen = true;
    const entry = { tag: decodeURIComponent(match[1]), src: url.href, at: Date.now(), state: 'pending' };
    seen.push(entry);
    node.addEventListener('load', () => { entry.state = 'loaded'; });
    node.addEventListener('error', () => { entry.state = 'error'; });
  };
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        check(node);
        if (node.querySelectorAll) node.querySelectorAll('script[src]').forEach(check);
      }
    }
  }).observe(document, { childList: true, subtree: true });
}

// Brings the first vdo.ai unit found into view, so lazy players form and send came_in_view / ad_request.
export function scrollUnitIntoView(tags) {
  const selectors = tags.flatMap((tag) => [`[id="${tag}"]`, `[id^="${tag}-"]`, `[id*="${tag.replace(/-/g, '_')}"]`]).concat(['.vdo_video_unit']);
  for (const selector of selectors) {
    let el = null;
    try { el = document.querySelector(selector); } catch { el = null; }
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && !el.querySelector('*')) continue;
    if (rect.top < 0 || rect.bottom > innerHeight) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    return true;
  }
  return false;
}
