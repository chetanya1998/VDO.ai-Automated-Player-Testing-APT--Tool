import { STICKY_CASES, STICKY_MEANING } from './guide.js';

// Thresholds. A floating ad larger than 30% of the screen is what the Better Ads Standards call a large sticky ad.
export const LIMITS = {
  largeStickyShare: 0.3,
  spacingChangePx: 8,
  positionJumpPx: 10,
  adShiftPx: 20,
  blankSpacePx: 50,
  edgeTolerancePx: 2,
  minCoveredAreaPx: 200,
  clippedShare: 0.9,
  obscuredShare: 0.34,
};

// Overall result per URL, from the share of judged checks (PASS + FAIL) that passed; warnings are left out.
export const OVERALL = { passShare: 0.8, reviewShare: 0.5 };

// Status criteria (Sticky Violation Test Cases – Status Criteria): only PASS, FAIL and WARNING.
// WARNING = the check could not be judged (scenario did not occur, prerequisite missing, config unknown).
const PASS = 'PASS';
const FAIL = 'FAIL';
const WARNING = 'WARNING';

// `where` is the snapshot (or problem item) that shows the result; it becomes the check's screenshot evidence.
const result = (verdict, summary, where = null, details = null) => {
  const ref = !where ? {} : where.snapIndex !== undefined ? { seenAt: where.seenAt, evidenceSnap: where.snapIndex } : { seenAt: where.label, evidenceSnap: where.index };
  return { verdict, summary, ...ref, ...(details ? { details } : {}) };
};
const list = (items, max = 3) => [...new Set(items)].slice(0, max).join(', ') + (new Set(items).size > max ? ` and ${new Set(items).size - max} more` : '');
const pct = (share) => `${Math.round(share * 100)}%`;
const inside = (rect, viewport, tolerance = LIMITS.edgeTolerancePx) =>
  rect.x >= -tolerance && rect.y >= -tolerance && rect.x + rect.w <= viewport.w + tolerance && rect.y + rect.h <= viewport.h + tolerance;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const covered = (item) => item.fraction > 0 && item.area >= LIMITS.minCoveredAreaPx;
const spacingTotal = (s) => (s ? s.mt + s.mb + s.pt + s.pb : 0);
const controlProblem = (control) =>
  !control.inViewport ? 'partly off screen' : control.visibleFraction < 0.95 ? 'cut off' : !control.topmost ? 'covered by something else' : control.outsidePlayer ? 'outside the player' : null;

// Controls are judged only while the whole player is on screen (an in-content player half scrolled away is normal).
const playerOnScreen = (s) => Boolean(s.player) && inside(s.player.rect, s.viewport);
// An in-content player is judged only while fully on screen and not under the site's own sticky header.
const playerClear = (s) => s.isFloating || (playerOnScreen(s) && s.playerObscured === 0);
// A fixed or sticky page element (header bar, banner, other ad) lying over the player's area.
const fixedOverPlayer = (s) => Boolean(s.player) && s.others.some((o) => overlaps(o.rect, s.player.rect));

function problemsIn(snaps, pick) {
  const found = [];
  for (const snap of snaps) for (const item of pick(snap)) found.push({ ...item, seenAt: snap.label, snapIndex: snap.index });
  return found;
}

// One evaluator per check. Each receives the whole timeline and returns { verdict, summary, seenAt?, evidenceSnap?, details? }.
const RULES = {
  'ST-01': ({ snaps, floatingSnaps, firstFloat }) => {
    if (!firstFloat) return result(WARNING, 'The player never floated, so spacing before and after floating could not be compared.');
    const before = [...snaps].reverse().find((s) => !s.isFloating && s.t < firstFloat.t);
    if (!before) return result(WARNING, 'The player was already floating when the page opened, so the spacing before floating could not be compared.', firstFloat);
    const changes = [];
    for (const [name, key] of [['page body', 'body'], ['page', 'html']]) {
      const delta = spacingTotal(firstFloat.page[key]) - spacingTotal(before.page[key]);
      if (delta > LIMITS.spacingChangePx) changes.push(`${name} spacing grew ${Math.round(delta)} px`);
    }
    for (const [name, key] of [['player wrapper', 'inContent'], ['anchor div', 'anchor']]) {
      const delta = spacingTotal(firstFloat[key]?.spacing) - spacingTotal(before[key]?.spacing);
      if (delta > LIMITS.spacingChangePx) changes.push(`${name} margin/padding grew ${Math.round(delta)} px`);
    }
    if (!changes.length) return result(PASS, 'No margin or padding was added when the player started floating.', firstFloat);
    const overlapToResolve = floatingSnaps.some((s) => s.others.some((o) => (o.bottomNav || o.headerLike) && covered(o)));
    return overlapToResolve
      ? result(WARNING, `${list(changes)} when floating started; a fixed bar was in the way, so it may be making room on purpose.`, firstFloat)
      : result(FAIL, `${list(changes)} when floating started, with nothing to make room for.`, firstFloat);
  },

  'ST-02': ({ snaps, floatingSnaps, firstFloat }) => {
    if (!snaps.some((s) => s.headers.some((h) => h.inView) || s.others.some((o) => o.headerLike))) return result(WARNING, 'No site header or main navigation was found on the page.');
    const hits = problemsIn(snaps, (s) => [...s.headers.filter(covered), ...s.others.filter((o) => o.headerLike && covered(o))]);
    if (hits.length) return result(FAIL, `The player covers the site header/navigation (${list(hits.map((h) => h.desc))}).`, hits[0]);
    return floatingSnaps.length
      ? result(PASS, 'The site header and navigation stayed clear while the player floated.', firstFloat)
      : result(PASS, 'The player never covered the site header or navigation.', snaps.find((s) => s.stage === 'load'));
  },

  'ST-03': ({ snaps }) => {
    const withHeadline = snaps.find((s) => s.headlines.length);
    if (!withHeadline) return result(WARNING, 'No article headline (h1) was found on the page.');
    const hits = problemsIn(snaps, (s) => s.headlines.filter(covered));
    return hits.length
      ? result(FAIL, `The player covers the headline (${list(hits.map((h) => h.desc))}).`, hits[0])
      : result(PASS, 'The headline was never covered by the player.', withHeadline);
  },

  'ST-04': ({ snaps }) => {
    const skips = problemsIn(snaps.filter((s) => s.player && playerClear(s)), (s) => s.controls.skip);
    if (!skips.length) return result(WARNING, 'No skippable ad (Skip Ad button) appeared while the player was fully on screen, so it could not be judged.');
    const bad = skips.map((c) => ({ ...c, problem: controlProblem(c) })).filter((c) => c.problem);
    return bad.length
      ? result(FAIL, `The Skip Ad button was ${bad[0].problem}.`, bad[0], { checkedBy: 'hit test (not clicked on live ads)' })
      : result(PASS, 'The Skip Ad button was fully visible and nothing covered it.', skips[0], { checkedBy: 'hit test (not clicked on live ads)' });
  },

  'ST-05': ({ snaps, floatingSnaps, close }) => {
    if (!floatingSnaps.length) return result(WARNING, 'The player never floated, so there was no floating close button to check.');
    const closes = problemsIn(floatingSnaps, (s) => s.controls.close);
    if (!closes.length) return result(WARNING, 'No close button was found on the floating player (the tool looks for elements named close/× inside the player).', floatingSnaps[0]);
    const bad = closes.map((c) => ({ ...c, problem: controlProblem(c) })).filter((c) => c.problem);
    if (bad.length) return result(FAIL, `The close button was ${bad[0].problem}.`, bad[0]);
    const afterClose = snaps.find((s) => s.stage === 'after-close');
    if (close?.clicked && !close.closed) return result(FAIL, 'Clicking the close button did not close the floating player.', afterClose);
    if (close?.clicked) return result(PASS, 'The close button was fully visible and closed the player when clicked.', afterClose);
    return result(PASS, 'The close button was fully visible and not covered.', closes[0]);
  },

  'ST-06': ({ snaps, floatingSnaps, firstFloat, anchorReachedAt }) => {
    if (!snaps.some((s) => s.anchor)) return result(WARNING, 'The tag has no in-content placement div, so content-floating activation could not be checked.');
    if (!firstFloat) return result(WARNING, 'The player never floated, so its activation could not be observed.');
    const early = floatingSnaps.filter((s) => anchorReachedAt === null || s.t < anchorReachedAt);
    return early.length
      ? result(FAIL, 'The player floated before the reader reached its place in the article.', early[0], { floatedAtScrollY: early[0].scrollY })
      : result(PASS, 'The player did not float before its place in the article was reached.', firstFloat);
  },

  'ST-07': ({ snaps, firstFloat, anchorReachedAt, anchorPassedAt }) => {
    if (!snaps.some((s) => s.anchor)) return result(WARNING, 'The tag has no in-content placement div, so content-floating activation could not be checked.');
    if (!firstFloat) {
      return anchorPassedAt !== null
        ? result(WARNING, 'The player never floated, even after its place in the article was scrolled past. If this tag should float, check its floating setting.')
        : result(WARNING, 'The player never floated and the tool could not scroll past its place in the article.');
    }
    return anchorReachedAt !== null && firstFloat.t >= anchorReachedAt
      ? result(PASS, `The player started floating after its place in the article was reached (scrolled ${firstFloat.scrollY} px).`, firstFloat)
      : result(FAIL, 'The player started floating before its place in the article was reached.', firstFloat);
  },

  'ST-08': ({ floatingSnaps }) => {
    if (!floatingSnaps.length) return result(WARNING, 'The player never floated, so overlap with article content could not be checked.');
    const largest = floatingSnaps.reduce((best, s) => {
      const share = (s.player.rect.w * s.player.rect.h) / (s.viewport.w * s.viewport.h);
      return share > best.share ? { share, snap: s } : best;
    }, { share: 0, snap: null });
    if (largest.share > LIMITS.largeStickyShare) {
      return result(FAIL, `The floating player covers ${pct(largest.share)} of the screen (over 30%, which the Better Ads Standards treat as a large sticky ad).`, largest.snap);
    }
    const controls = problemsIn(floatingSnaps, (s) => s.underPlayer.interactive.map((desc) => ({ desc })));
    const media = problemsIn(floatingSnaps, (s) => s.underPlayer.media.map((desc) => ({ desc })));
    if (controls.length) return result(FAIL, `The floating player (${pct(largest.share)} of the screen) covers page links or buttons: ${list(controls.map((c) => c.desc))}.`, controls[0]);
    if (media.length) return result(FAIL, `The floating player (${pct(largest.share)} of the screen) covers images or headings: ${list(media.map((c) => c.desc))}.`, media[0]);
    return result(PASS, `The floating player takes ${pct(largest.share)} of the screen and covers no links, buttons, images or headings.`, largest.snap);
  },

  'ST-09': ({ snaps }) => {
    const shifts = [];
    for (let i = 1; i < snaps.length; i += 1) {
      const [a, b] = [snaps[i - 1], snaps[i]];
      if (!['load', 'ad'].includes(b.stage) || a.stage !== b.stage || a.scrollY !== b.scrollY || !a.player || !b.player || a.isFloating !== b.isFloating) continue;
      const move = Math.max(Math.abs(a.player.rect.x - b.player.rect.x), Math.abs(a.player.rect.y - b.player.rect.y));
      if (move > LIMITS.adShiftPx) shifts.push({ snap: b, move, intoProtected: b.headers.some(covered) || b.headlines.some(covered) });
    }
    const bad = shifts.find((s) => s.intoProtected);
    if (bad) return result(FAIL, `The player jumped ${bad.move} px without scrolling and now covers the header or headline.`, bad.snap);
    if (shifts.length) return result(WARNING, `The player moved ${shifts[0].move} px while nothing was scrolled; it did not reach the header or headline.`, shifts[0].snap);
    const adSnap = snaps.find((s) => s.stage === 'ad' && (s.adPlaying || s.controls.skip.length));
    if (!adSnap) return result(WARNING, 'No ad was seen playing during the wait, so movement while an ad loads could not be observed.', snaps.find((s) => s.stage === 'ad'));
    return result(PASS, 'The player did not move while the ad loaded and nothing was scrolled.', adSnap);
  },

  'ST-10': ({ floatingSnaps }) => {
    if (!floatingSnaps.length) return result(WARNING, 'The player never floated, so the floating position could not be checked.');
    const out = floatingSnaps.find((s) => !inside(s.player.rect, s.viewport));
    if (out) return result(FAIL, 'Part of the floating player is outside the screen.', out, { player: out.player.rect, viewport: out.viewport });
    const control = problemsIn(floatingSnaps, (s) => s.controls.close.filter((c) => !c.inViewport));
    if (control.length) return result(FAIL, 'The close button is outside the screen.', control[0]);
    return result(PASS, 'The floating player and its controls stayed fully on screen.', floatingSnaps[0]);
  },

  'ST-11': ({ floatingSnaps }) => {
    const others = problemsIn(floatingSnaps, (s) => s.others.filter((o) => !o.consent && !o.headerLike && !o.bottomNav));
    if (!others.length) return result(WARNING, 'No other sticky ad or fixed element was on screen while the player floated, so this could not be checked.');
    const coveredAd = others.find((o) => o.adLike && (covered(o) || o.buttonsCovered.length));
    if (coveredAd) return result(FAIL, `The player covers another sticky ad (${coveredAd.desc}).`, coveredAd);
    const coveredOther = others.find((o) => covered(o) || o.buttonsCovered.length);
    if (coveredOther) return result(FAIL, `The player overlaps a fixed element (${coveredOther.desc}).`, coveredOther);
    const coveringPlayer = floatingSnaps.find((s) => s.playerObscured >= LIMITS.obscuredShare);
    if (coveringPlayer) return result(WARNING, `Another fixed element covers the player (${list(coveringPlayer.obscuredBy)}).`, coveringPlayer);
    return result(PASS, `Other fixed elements (${list(others.map((o) => o.desc))}) and the player did not overlap.`, others[0]);
  },

  'ST-12': ({ snaps, firstFloat, multiArticle }) => {
    const dup = snaps.find((s) => s.counts.floating > 1);
    if (dup) return result(FAIL, `${dup.counts.floating} vdo.ai players were floating at the same time.`, dup, { floating: dup.floating });
    if (!firstFloat) return result(WARNING, 'The player never floated, so duplicate floating players could not be checked.');
    return multiArticle
      ? result(PASS, 'Only one vdo.ai player floated, also after the next article loaded.', snaps.filter((s) => s.isFloating).at(-1))
      : result(WARNING, 'Only one vdo.ai player floated, but no next article loaded, so duplicates across article transitions could not be checked.', firstFloat);
  },

  'ST-13': ({ snaps }) => {
    const bottom = snaps.filter((s) => s.stage === 'bottom');
    if (!bottom.length) return result(WARNING, 'The tool could not scroll to the bottom of the page.');
    const last = bottom.at(-1);
    if (!bottom.some((s) => s.footers.some((f) => f.inView) || s.others.some((o) => o.bottomNav))) return result(WARNING, 'No footer or bottom navigation was found.', last);
    const nav = problemsIn(bottom, (s) => s.others.filter((o) => o.bottomNav && (covered(o) || o.buttonsCovered.length)));
    if (nav.length) return result(FAIL, `The player covers the bottom navigation bar (${nav[0].desc}).`, nav[0]);
    const footer = problemsIn(bottom, (s) => s.footers.filter((f) => f.linksCovered?.length));
    if (footer.length) return result(FAIL, `The player covers footer links (${list(footer[0].linksCovered)}).`, footer[0]);
    if (!bottom.some((s) => s.isFloating)) return result(WARNING, 'The player was not floating at the bottom of the page, so footer overlap could not be checked.', last);
    return result(PASS, 'The footer and bottom navigation stayed clear.', bottom.find((s) => s.isFloating));
  },

  'ST-14': ({ snaps }) => {
    const banners = problemsIn(snaps, (s) => s.others.filter((o) => o.consent));
    if (!banners.length) return result(WARNING, 'No cookie, consent or notification banner appeared, so this could not be checked.');
    const bad = banners.find((b) => b.buttonsCovered.length || b.fraction >= 0.34);
    return bad
      ? result(FAIL, `The player covers the banner${bad.buttonsCovered.length ? `'s buttons (${list(bad.buttonsCovered)})` : ''} (${bad.desc}).`, bad)
      : result(PASS, `The banner (${banners[0].desc}) and its buttons stayed clear.`, banners[0]);
  },

  'ST-15': ({ snaps }) => {
    // Close buttons belong to the floating player; Skip Ad is judged on the in-content player too while it is clear.
    const controls = problemsIn(snaps.filter((s) => s.player && playerClear(s)), (s) => [...(s.isFloating ? s.controls.close : []), ...s.controls.skip].map((c) => ({ ...c, size: `${s.viewport.w}×${s.viewport.h}` })));
    if (!controls.length) return result(WARNING, 'No close or Skip Ad button was shown at any screen size tried.');
    const bad = controls.map((c) => ({ ...c, problem: controlProblem(c) })).filter((c) => c.problem);
    const sizes = [...new Set(controls.map((c) => c.size))];
    return bad.length
      ? result(FAIL, `At ${bad[0].size}, a control (${bad[0].desc}) was ${bad[0].problem}.`, bad[0])
      : result(PASS, `Close/Skip controls were fully visible at ${list(sizes, 5)}.`, controls.find((c) => c.size !== controls[0].size) ?? controls[0]);
  },

  'ST-16': ({ snaps }) => {
    const cycle = snaps.filter((s) => s.stage === 'updown' || s.stage === 'ad');
    const floating = cycle.filter((s) => s.isFloating);
    if (!floating.length) return result(WARNING, 'The player was not floating while scrolling up and down.');
    if (floating.length < cycle.length && cycle.filter((s) => s.stage === 'updown').some((s) => !s.isFloating)) {
      return result(WARNING, 'The player switched between floating and in-content while scrolling up and down a little, so its position could not be held for the check.', cycle.find((s) => !s.isFloating));
    }
    const ref = floating[0].player.rect;
    const jump = floating.find((s) => ['x', 'y', 'w', 'h'].some((k) => Math.abs(s.player.rect[k] - ref[k]) > LIMITS.positionJumpPx));
    if (jump) return result(FAIL, `The floating player jumped from (${ref.x}, ${ref.y}) to (${jump.player.rect.x}, ${jump.player.rect.y}) while scrolling.`, jump);
    const spacing = floating.find((s) => Math.abs(spacingTotal(s.page.body) - spacingTotal(floating[0].page.body)) > LIMITS.spacingChangePx);
    if (spacing) return result(FAIL, 'The page spacing changed while scrolling with the player floating.', spacing);
    return result(PASS, 'The floating player kept the same position while scrolling up and down.', floating.at(-1));
  },

  'ST-17': ({ snaps, close }) => {
    if (!close?.clicked) return result(WARNING, close?.reason ?? 'The close button was not clicked (no floating player with a close button).');
    const after = snaps.filter((s) => s.stage === 'after-close');
    if (!close.closed) return result(FAIL, 'The close button did not close the player.', after[0]);
    const back = after.find((s) => s.isFloating);
    return back
      ? result(WARNING, 'The floating player came back after it was closed. Whether that is allowed depends on its configured behaviour.', back)
      : result(PASS, 'The player stayed closed while the reader kept scrolling.', after.at(-1));
  },

  'ST-18': ({ snaps, multiArticle }) => {
    if (!multiArticle) return result(WARNING, 'No next article loaded while scrolling, so infinite-scroll placement could not be checked.');
    const floating = snaps.filter((s) => s.isFloating && s.currentAnchor >= 0);
    if (!floating.length) return result(WARNING, 'A next article loaded, but the player was not floating then.');
    const mismatched = floating.filter((s) => s.floatingAnchor >= 0 && s.floatingAnchor !== s.currentAnchor);
    if (mismatched.length >= 2) return result(FAIL, `The floating player belongs to article ${mismatched[0].floatingAnchor + 1} while article ${mismatched[0].currentAnchor + 1} is being read.`, mismatched[0]);
    if (floating.every((s) => s.floatingAnchor < 0)) return result(WARNING, 'A next article loaded, but the floating player is not inside any article, so the tool cannot tell which one it belongs to.', floating[0]);
    return result(PASS, 'The floating player belonged to the article being read.', floating.at(-1));
  },

  'ST-19': ({ snaps }) => viewportCheck(snaps.filter((s) => s.stage === 'resize'), 'No window-size change was tried.'),

  'ST-20': ({ snaps, floatingSnaps }) => {
    const clipped = snaps.find((s) => s.player && s.playerVisibleFraction < LIMITS.clippedShare && inside(s.player.rect, s.viewport, 50));
    if (clipped) return result(FAIL, `The site's CSS cuts off the player: only ${pct(clipped.playerVisibleFraction)} of it is visible (overflow on a parent element).`, clipped);
    // Only while the player is fully on screen and no fixed bar (e.g. the site's sticky header) lies over it:
    // an in-content player scrolling under a sticky header is normal.
    const hidden = snaps.find((s) => s.player && playerOnScreen(s) && !fixedOverPlayer(s) && s.playerObscured >= LIMITS.obscuredShare);
    if (hidden) return result(FAIL, `Page elements are drawn over the player (${list(hidden.obscuredBy)}), usually a z-index problem.`, hidden);
    const breaker = floatingSnaps.find((s) => s.fixedBreakers.length);
    if (breaker) {
      const moved = floatingSnaps.filter((s) => s.stage === 'updown').some((s) => Math.abs(s.player.rect.y - floatingSnaps[0].player.rect.y) > LIMITS.positionJumpPx);
      return moved
        ? result(FAIL, `A parent element (${list(breaker.fixedBreakers)}) has transform/filter/contain, which breaks the floating position: the player moves with the page.`, breaker)
        : result(PASS, `No CSS problem was seen. Note: a parent element (${list(breaker.fixedBreakers)}) has transform/filter/contain, which can break floating on other layouts.`, breaker);
    }
    return result(PASS, 'No clipping, covering or broken floating caused by the site\'s CSS was found.', floatingSnaps[0] ?? snaps.find((s) => s.player));
  },

  'ST-21': ({ snaps }) => {
    const load = snaps.filter((s) => s.stage === 'load');
    if (!load.length) return result(WARNING, 'The page did not load, so initialisation could not be observed.');
    const early = load.find((s) => s.isFloating && (!s.anchor || s.anchor.rect.y >= s.viewport.h));
    if (early) return result(FAIL, 'The player floated while the page was still loading, before the reader reached its place.', early);
    const stray = load.find((s) => !s.isFloating && s.player && s.anchor && s.inContent?.shown && (Math.abs(s.player.rect.y - s.anchor.rect.y) > 300));
    if (stray) return result(FAIL, 'During loading, the player showed up far from its place in the article.', stray);
    return result(PASS, 'The player did not float or appear elsewhere while the page loaded.', load.at(-1));
  },

  'ST-22': ({ snaps, floatingSnaps, firstFloat }) => {
    if (!firstFloat) return result(WARNING, 'The player never floated, so space left behind could not be checked.');
    if (!snaps.some((s) => s.anchor)) return result(WARNING, 'The tag has no in-content placement div, so no reserved space could be measured.');
    // The placement div keeps only its in-flow height: a floating (fixed) child adds nothing, a left-behind wrapper does.
    const gaps = floatingSnaps.filter((s) => s.anchor && s.anchor.rect.h >= LIMITS.blankSpacePx).map((s) => ({ snap: s, height: s.anchor.rect.h }));
    if (!gaps.length) return result(PASS, 'No empty space was left in the article when the player started floating.', firstFloat);
    const biggest = gaps.reduce((a, b) => (b.height > a.height ? b : a));
    return result(FAIL, `A ${biggest.height} px empty space stays in the article while the player floats.`, biggest.snap);
  },

  'ST-23': ({ snaps, floatingSnaps, anchorReachedAt }) => {
    const first = snaps.find((s) => s.anchor);
    if (!first) return result(WARNING, 'The tag has no in-content placement div.');
    const short = first.anchor.docTop + first.anchor.rect.h > first.docHeight - 1.2 * first.viewport.h;
    if (!short) return result(WARNING, 'This article is long (the player is not near the end of the page), so short-article behaviour could not be checked. Test a short article for this.');
    const early = floatingSnaps.find((s) => anchorReachedAt === null || s.t < anchorReachedAt);
    return early
      ? result(FAIL, 'On this short article the player floated before the reader reached it.', early)
      : result(PASS, 'On this short article the player did not float early.', floatingSnaps[0] ?? first);
  },

  'ST-24': ({ snaps, device }) => device === 'mobile'
    ? result(WARNING, 'Browser zoom is a desktop setting, so it was not tested on mobile (window sizes are covered by ST-19).')
    : viewportCheck(snaps.filter((s) => s.stage === 'zoom'), 'No zoom level was tried.'),

  'ST-25': ({ snaps, urlChanged }) => {
    if (!urlChanged) return result(WARNING, 'The address did not change inside the page, so stale state after navigation could not be checked (each URL is opened fresh).');
    const after = snaps.filter((s) => s.url !== snaps[0].url && s.isFloating);
    const stale = after.find((s) => s.floatingAnchor >= 0 && s.floatingAnchor !== s.currentAnchor);
    return stale
      ? result(FAIL, 'After the address changed, the player kept floating for the previous page.', stale)
      : result(PASS, 'After the address changed in the page, the player followed the new page.', after.at(-1) ?? snaps.at(-1));
  },
};

function viewportCheck(sized, none) {
  if (!sized.length) return result(WARNING, none);
  for (const s of sized) {
    const size = `${s.viewport.w}×${s.viewport.h}`;
    if (!s.player) continue;
    if (s.isFloating && !inside(s.player.rect, s.viewport)) return result(FAIL, `At ${size} part of the floating player is off screen.`, s);
    if (!s.isFloating && s.player.rect.w > s.viewport.w + LIMITS.edgeTolerancePx) return result(FAIL, `At ${size} the player is wider than the screen.`, s);
    const control = s.controls.close.concat(s.controls.skip).map((c) => ({ ...c, problem: controlProblem(c) })).find((c) => c.problem);
    if (control) return result(FAIL, `At ${size} a control (${control.desc}) is ${control.problem}.`, s);
    if (s.isFloating && (s.headers.some(covered) || s.headlines.some(covered))) return result(FAIL, `At ${size} the floating player covers the header or headline.`, s);
  }
  return result(PASS, `The player and its controls were fine at ${list(sized.map((s) => `${s.viewport.w}×${s.viewport.h}`), 5)}.`, sized[0]);
}

// 80% or more of the judged checks passed → PASS; 50% to under 80% → PASS with "Review required"; under 50% → FAIL.
// Nothing judged (all warnings) → WARNING.
export function overallFor(verdictCounts) {
  const judged = verdictCounts.PASS + verdictCounts.FAIL;
  if (judged === 0) return { overallVerdict: WARNING, review: false, passShare: null, judged };
  const passShare = verdictCounts.PASS / judged;
  if (passShare >= OVERALL.passShare) return { overallVerdict: PASS, review: false, passShare, judged };
  if (passShare >= OVERALL.reviewShare) return { overallVerdict: PASS, review: true, passShare, judged };
  return { overallVerdict: FAIL, review: false, passShare, judged };
}

export function evaluateSticky({ snaps, close = null, device = 'desktop', includeAdditional = false }) {
  snaps.forEach((snap, index) => { snap.index ??= index; });
  const found = snaps.some((s) => s.found);
  const live = snaps.filter((s) => s.stage !== 'after-close');
  const floatingSnaps = live.filter((s) => s.isFloating && s.player);
  const firstFloat = floatingSnaps[0] ?? null;
  // The reader "reached" the placement when its div first entered the screen, and "passed" it when it left the top.
  const anchorReachedAt = live.find((s) => s.anchor && s.anchor.rect.y < s.viewport.h)?.t ?? null;
  const anchorPassedAt = live.find((s) => s.anchor && s.anchor.rect.y + s.anchor.rect.h < 0)?.t ?? null;
  const urlChanged = snaps.some((s) => s.url !== snaps[0]?.url);
  const multiArticle = urlChanged || Math.max(0, ...snaps.map((s) => s.counts.anchors)) > 1;
  const input = { snaps, floatingSnaps, firstFloat, anchorReachedAt, anchorPassedAt, urlChanged, multiArticle, close, device };

  // ST-01..ST-13 always run; ST-14..ST-25 only when the user asks for the additional checks.
  const selected = STICKY_CASES.filter((meta) => meta.group === 'core' || includeAdditional);
  const cases = selected.map((meta) => {
    let outcome;
    if (!found) outcome = result(WARNING, 'The vdo.ai player was not found on this page, so this could not be checked.', snaps.at(-1));
    else {
      try {
        outcome = RULES[meta.id](input);
      } catch (error) {
        outcome = result(WARNING, `The check could not be completed (${error.message}).`);
      }
    }
    return { ...meta, ...outcome, meaning: STICKY_MEANING[outcome.verdict] };
  });
  const verdictCounts = { PASS: 0, FAIL: 0, WARNING: 0 };
  for (const item of cases) verdictCounts[item.verdict] += 1;
  const playerType = !found ? 'not found' : !snaps.some((s) => s.anchor) ? 'floating only (no in-content div)' : firstFloat ? 'content-floating' : 'in-content (did not float)';
  return {
    ...overallFor(verdictCounts),
    verdictCounts,
    total: cases.length,
    includeAdditional,
    playerType,
    floatingStartedAt: firstFloat ? { label: firstFloat.label, scrollY: firstFloat.scrollY } : null,
    cases,
  };
}
