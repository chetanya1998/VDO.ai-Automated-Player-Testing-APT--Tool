// Runs inside the page (passed to page.evaluate), so it must not use anything from this module's scope.
// One call = one snapshot of where the vdo.ai player is, how it is styled, and what it covers.
export function stickySnapshot({ tag }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const round = (value) => Math.round(value);
  const box = (rect) => ({ x: round(rect.left), y: round(rect.top), w: round(rect.width), h: round(rect.height) });
  const area = (r) => Math.max(0, r.w) * Math.max(0, r.h);
  const intersect = (a, b) => {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const w = Math.min(a.x + a.w, b.x + b.w) - x;
    const h = Math.min(a.y + a.h, b.y + b.h) - y;
    return w > 0 && h > 0 ? { x, y, w, h } : null;
  };
  const viewport = { x: 0, y: 0, w: vw, h: vh };
  const styleOf = (el) => getComputedStyle(el);
  const shown = (el) => {
    if (!el || !el.isConnected) return false;
    const s = styleOf(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls.length ? `.${cls.join('.')}` : ''}`.slice(0, 80);
  };
  const isAnchorId = (id) => id === tag || (typeof id === 'string' && id.startsWith(`${tag}-`));
  const ownName = (n) => `${n.id || ''} ${typeof n.className === 'string' ? n.className : ''}`;
  const isVdo = (el) => {
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (isAnchorId(n.id) || /vdo/i.test(ownName(n))) return true;
    }
    return false;
  };
  const num = (value) => Number.parseFloat(value) || 0;
  const spacingOf = (el) => {
    if (!el) return null;
    const s = styleOf(el);
    return { mt: num(s.marginTop), mb: num(s.marginBottom), pt: num(s.paddingTop), pb: num(s.paddingBottom) };
  };

  // The player: in-content anchor div(s), vdo wrapper(s) and any vdo element that is fixed (floating).
  const anchors = [...document.querySelectorAll(`[id="${CSS.escape(tag)}"], [id^="${CSS.escape(tag)}-"]`)];
  const wrappers = [...document.querySelectorAll('#vdoai_parentWrapperDiv, .vdoai_parentWrapperDiv, [id^="vdoai_parentWrapperDiv"]')];
  const vdoNodes = [...new Set([...anchors, ...wrappers, ...document.querySelectorAll('[id*="vdo" i], [class*="vdo" i]')])].slice(0, 600);
  const fixedVdo = vdoNodes.filter((el) => shown(el) && styleOf(el).position === 'fixed');
  // Floating instances = outermost fixed vdo elements big enough to be a player.
  const floating = fixedVdo
    .filter((el) => !fixedVdo.some((other) => other !== el && other.contains(el)))
    .map((el) => ({ el, rect: box(el.getBoundingClientRect()) }))
    .filter((item) => item.rect.w >= 100 && item.rect.h >= 56 && intersect(item.rect, viewport));
  floating.sort((a, b) => area(b.rect) - area(a.rect));
  const floatEl = floating[0]?.el ?? null;
  const anchor = anchors.find(shown) ?? anchors[0] ?? null;
  const wrapper = wrappers.find(shown) ?? null;
  const inContentEl = wrapper ?? anchor;
  const playerEl = floatEl ?? (inContentEl && shown(inContentEl) ? inContentEl : null);
  const playerBox = playerEl ? box(playerEl.getBoundingClientRect()) : null;
  const visiblePlayer = playerBox ? intersect(playerBox, viewport) : null;

  // How much of a rectangle the player is drawn over, by hit-testing a 3×3 grid of points.
  const coverage = (rect) => {
    if (!visiblePlayer) return { fraction: 0, area: 0 };
    const overlap = intersect(intersect(rect, viewport) ?? { x: 0, y: 0, w: 0, h: 0 }, visiblePlayer);
    if (!overlap) return { fraction: 0, area: 0 };
    let hits = 0;
    for (const fx of [0.15, 0.5, 0.85]) {
      for (const fy of [0.15, 0.5, 0.85]) {
        const top = document.elementFromPoint(overlap.x + overlap.w * fx, overlap.y + overlap.h * fy);
        if (top && isVdo(top)) hits += 1;
      }
    }
    return { fraction: Math.round((hits / 9) * 100) / 100, area: round((area(overlap) * hits) / 9) };
  };
  const centerCovered = (rect) => {
    const x = rect.x + rect.w / 2;
    const y = rect.y + rect.h / 2;
    if (x < 0 || y < 0 || x >= vw || y >= vh) return false;
    const top = document.elementFromPoint(x, y);
    return Boolean(top && isVdo(top));
  };
  const collect = (selector, filter = () => true, limit = 12) => {
    const found = [];
    for (const el of document.querySelectorAll(selector)) {
      if (found.length >= limit) break;
      if (isVdo(el) || !shown(el) || found.some((other) => other.contains(el))) continue;
      if (!filter(el)) continue;
      found.push(el);
    }
    return found.map((el) => {
      const rect = box(el.getBoundingClientRect());
      const links = [...el.querySelectorAll('a[href], button, [role="button"]')].filter(shown).slice(0, 20);
      const linksCovered = links.filter((link) => centerCovered(box(link.getBoundingClientRect()))).map(describe);
      return { desc: describe(el), rect, inView: Boolean(intersect(rect, viewport)), ...coverage(rect), fixed: styleOf(el).position === 'fixed', linksCovered };
    });
  };

  // The site header and main menu only: a header/nav near the top of the page or fixed to the top, not breadcrumbs,
  // pagination, widget headers or an article's own <header> (that is the headline area, ST-03).
  const nearTop = (el) => {
    const r = el.getBoundingClientRect();
    const position = styleOf(el).position;
    return r.top + window.scrollY < 400 || ((position === 'fixed' || position === 'sticky') && r.top <= 2);
  };
  const headers = collect('header, [role="banner"], nav, [role="navigation"], #header, #masthead, .site-header, .navbar',
    (el) => el.getBoundingClientRect().width >= 100 && nearTop(el) && !(el.tagName === 'HEADER' && el.closest('article, main') && !el.closest('.site-header, #masthead')) && !el.closest('article'));
  // The article headline: h1 elements and schema.org headlines, not related-post titles that reuse .entry-title.
  const headlines = collect('h1, [itemprop="headline"]', (el) => el.tagName === 'H1' || /^H[1-2]$/.test(el.tagName), 4);
  const footers = collect('footer, [role="contentinfo"], #footer, .site-footer', () => true, 4);

  // Fixed/sticky elements that are not the player: bottom navigation, consent banners, other sticky ads.
  const others = [];
  const consentWords = /cookie|consent|gdpr|privacy|accept all/i;
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    if (others.length >= 25) break;
    const position = styleOf(el).position;
    if (position !== 'fixed' && position !== 'sticky') continue;
    if (isVdo(el) || !shown(el)) continue;
    const rect = box(el.getBoundingClientRect());
    if (area(rect) < 3000 || !intersect(rect, viewport) || others.some((other) => other.el.contains(el))) continue;
    const name = ownName(el);
    const adLike = /(^|[\s_-])(ad|ads|advert|adslot|gpt|dfp|banner|sticky-ad|anchor-ad)([\s_-]|$)|google_ads|adsbygoogle/i.test(name)
      || Boolean(el.querySelector('iframe[id^="google_ads_iframe"], ins.adsbygoogle, [id^="div-gpt-ad"]'));
    const consent = /onetrust|cookie|consent|cmp|gdpr|cybot|didomi|qc-cmp|fc-consent|sp_message/i.test(name) || consentWords.test((el.innerText || '').slice(0, 400));
    const bottomNav = !consent && !adLike && rect.y + rect.h >= vh - 2 && rect.h <= vh * 0.3 && rect.w >= vw * 0.5;
    const headerLike = !consent && !adLike && rect.y <= 2 && rect.h <= vh * 0.3 && rect.w >= vw * 0.5;
    const buttons = [...el.querySelectorAll('a[href], button, [role="button"], input[type="submit"]')].filter(shown).slice(0, 12)
      .map((button) => ({ desc: describe(button), covered: centerCovered(box(button.getBoundingClientRect())) }));
    others.push({ el, desc: describe(el), position, rect, adLike, consent, bottomNav, headerLike, ...coverage(rect), buttonsCovered: buttons.filter((b) => b.covered).map((b) => b.desc), buttons: buttons.length });
  }

  // Page content under the player: interactive controls (centre covered) and media/headings.
  const underPlayer = { interactive: [], media: [] };
  if (visiblePlayer) {
    for (const el of document.querySelectorAll('a[href], button, input, select, textarea, [role="button"], img, video, figure, h2, h3')) {
      if (underPlayer.interactive.length + underPlayer.media.length >= 30) break;
      if (isVdo(el) || !shown(el)) continue;
      const rect = box(el.getBoundingClientRect());
      if (rect.w < 8 || rect.h < 8 || !intersect(rect, visiblePlayer)) continue;
      const interactive = /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.getAttribute('role') === 'button';
      if (interactive) {
        if (centerCovered(rect)) underPlayer.interactive.push(describe(el));
      } else if (coverage(rect).fraction >= 0.8 && area(rect) >= 2500) {
        underPlayer.media.push(describe(el));
      }
    }
  }

  // Player controls inside the main document (close, skip). Skip buttons inside ad iframes are found by the runner.
  const controls = { close: [], skip: [] };
  if (playerEl) {
    const root = floatEl ?? playerEl;
    const candidates = [...root.querySelectorAll('*')].slice(0, 800);
    for (const el of candidates) {
      if (!shown(el)) continue;
      const rect = box(el.getBoundingClientRect());
      if (rect.w < 6 || rect.h < 6 || rect.w > 120 || rect.h > 120) continue;
      const label = `${ownName(el)} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`;
      const text = (el.childElementCount === 0 ? el.textContent || '' : '').trim();
      const kind = /pre-?skip/i.test(label) ? null
        : /skip/i.test(label) ? 'skip'
          : /close|cross|dismiss/i.test(label) || /^(×|✕|✖|x|X)$/.test(text) ? 'close' : null;
      if (!kind || controls[kind].some((other) => other.el.contains(el) || el.contains(other.el))) continue;
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      const top = cx >= 0 && cy >= 0 && cx < vw && cy < vh ? document.elementFromPoint(cx, cy) : null;
      let clip = rect;
      for (let n = el.parentElement; n && clip; n = n.parentElement) {
        const s = styleOf(n);
        if (s.overflow !== 'visible' || s.overflowX !== 'visible' || s.overflowY !== 'visible') clip = intersect(clip, box(n.getBoundingClientRect()));
        if (n === root) break;
      }
      controls[kind].push({
        el,
        desc: describe(el),
        rect,
        inViewport: rect.x >= -1 && rect.y >= -1 && rect.x + rect.w <= vw + 1 && rect.y + rect.h <= vh + 1,
        visibleFraction: clip ? Math.round((area(clip) / area(rect)) * 100) / 100 : 0,
        topmost: Boolean(top && (top === el || el.contains(top) || top.contains(el))),
      });
    }
  }

  // Publisher CSS around the player: clipping ancestors and ancestors that break position: fixed.
  let playerVisibleFraction = 1;
  const breakers = [];
  if (playerEl && playerBox && area(playerBox) > 0) {
    let clip = playerBox;
    for (let n = playerEl.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const s = styleOf(n);
      if (clip && (s.overflow !== 'visible' || s.overflowX !== 'visible' || s.overflowY !== 'visible')) clip = intersect(clip, box(n.getBoundingClientRect()));
      const breaksFixed = s.transform !== 'none' || s.filter !== 'none' || s.perspective !== 'none' || /paint|layout|strict|content/.test(s.contain) || /transform|filter/.test(s.willChange);
      if (breaksFixed && n !== document.body) breakers.push(describe(n));
    }
    playerVisibleFraction = clip ? Math.round((area(clip) / area(playerBox)) * 100) / 100 : 0;
  }
  // Is the player itself covered by page elements?
  let playerObscured = 0;
  const obscuredBy = new Set();
  if (visiblePlayer) {
    let blocked = 0;
    for (const fx of [0.2, 0.5, 0.8]) {
      for (const fy of [0.2, 0.5, 0.8]) {
        const top = document.elementFromPoint(visiblePlayer.x + visiblePlayer.w * fx, visiblePlayer.y + visiblePlayer.h * fy);
        if (top && !isVdo(top)) {
          blocked += 1;
          obscuredBy.add(describe(top));
        }
      }
    }
    playerObscured = Math.round((blocked / 9) * 100) / 100;
  }

  const anchorRect = anchor ? box(anchor.getBoundingClientRect()) : null;
  const inContentRect = inContentEl ? box(inContentEl.getBoundingClientRect()) : null;
  // Which article (anchor index) the floating player belongs to, and which article is being read.
  const anchorTops = anchors.map((el) => el.getBoundingClientRect().top + window.scrollY);
  const readingY = window.scrollY + vh / 2;
  let currentAnchor = -1;
  anchorTops.forEach((top, index) => { if (top <= readingY) currentAnchor = index; });
  const media = playerEl ? [...(floatEl ?? playerEl).querySelectorAll('video')] : [];

  return {
    url: location.href,
    scrollY: round(window.scrollY),
    viewport: { w: vw, h: vh },
    docHeight: round(document.documentElement.scrollHeight),
    found: Boolean(anchor || wrapper || floating.length),
    anchor: anchorRect && { rect: anchorRect, docTop: round(anchorRect.y + window.scrollY), spacing: spacingOf(anchor), containsFloating: Boolean(floatEl && anchor.contains(floatEl)) },
    inContent: inContentRect && { rect: inContentRect, spacing: spacingOf(inContentEl), shown: shown(inContentEl) },
    isFloating: Boolean(floatEl),
    floating: floating.map((item) => ({ desc: describe(item.el), rect: item.rect, zIndex: styleOf(item.el).zIndex })),
    player: playerBox && { rect: playerBox, desc: describe(playerEl), position: styleOf(playerEl).position },
    page: { body: spacingOf(document.body), html: spacingOf(document.documentElement) },
    headers,
    headlines,
    footers,
    others: others.map(({ el, ...item }) => item),
    underPlayer,
    controls: { close: controls.close.map(({ el, ...item }) => item), skip: controls.skip.map(({ el, ...item }) => item) },
    playerVisibleFraction,
    fixedBreakers: floatEl ? breakers.slice(0, 5) : [],
    playerObscured,
    obscuredBy: [...obscuredBy].slice(0, 4),
    counts: { anchors: anchors.length, wrappersShown: wrappers.filter(shown).length, floating: floating.length },
    floatingAnchor: floatEl ? anchors.findIndex((el) => el.contains(floatEl)) : -1,
    currentAnchor,
    adPlaying: media.some((video) => !video.paused && video.currentTime > 0),
  };
}

// Draws outlines over the page for a screenshot: the player in blue, problem areas in red.
export function drawOverlay({ player, problems }) {
  const layer = document.createElement('div');
  layer.id = '__sticky_overlay';
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const draw = (rect, color, label) => {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;outline:3px solid ${color};outline-offset:-2px;background:${color}22`;
    if (label) {
      const tagEl = document.createElement('span');
      tagEl.textContent = label;
      tagEl.style.cssText = `position:absolute;left:0;top:0;font:600 11px/1.3 sans-serif;background:${color};color:#fff;padding:1px 4px;max-width:100%;overflow:hidden;white-space:nowrap`;
      el.appendChild(tagEl);
    }
    layer.appendChild(el);
  };
  if (player) draw(player, '#2f6fed', 'vdo.ai player');
  for (const problem of problems) draw(problem.rect, '#e5484d', problem.label);
  document.documentElement.appendChild(layer);
}

export function removeOverlay() {
  document.getElementById('__sticky_overlay')?.remove();
}
