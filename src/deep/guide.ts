import type { TestCaseId, Verdict } from "../contracts.js";

// Plain-language explanations of the 23 cases for people who do not read DevTools, based on the
// "Automated player testing tool – Test Cases & Build Plan" and the Tech Doc.
export interface CaseGuide {
  checks: string;
  pass: string;
  fail: string;
  warning?: string;
}

export const CASE_GUIDE: Record<TestCaseId, CaseGuide> = {
  "TC-1": {
    checks: "Whether the page loads our main file (vdo.ai.js) for the right tag, from our server, without errors.",
    pass: "The page loaded vdo.ai.js for the correct tag and our server answered normally.",
    fail: "vdo.ai.js was missing, was for a different tag, or our server returned an error, so the player could not start. Usually a publisher installation problem.",
  },
  "TC-2": {
    checks: "How long each of the player's files took to load: vdo.ai.js and the files it needs (vdo.min.js, settings, Google IMA, video player, Prebid, real-time bidding, analytics). Every file should load within 500 ms.",
    pass: "Every player file loaded within 500 ms.",
    warning: "At least one player file took between 500 and 1000 ms: it works but slows the player down.",
    fail: "At least one player file took more than 1 second or never finished loading, which delays or stops the player.",
  },
  "TC-3": {
    checks: "That our tag is installed only once: one vdo.ai.js request, one player div and one install script.",
    pass: "The tag is installed exactly once.",
    fail: "The same tag is installed more than once. This causes double page views, double players and double ad auctions. The publisher needs to remove the extra copy.",
  },
  "TC-4": {
    checks: "That the player is sending its tracking calls (logger requests) and our server accepts them.",
    pass: "Tracking calls were sent and accepted.",
    fail: "No tracking calls were sent, or our server rejected them, so we cannot see what the player is doing.",
  },
  "TC-5": {
    checks: "That the player's lifecycle happens in the expected order: loaded → initialised → player formed → in view → ad requested → ad shown.",
    pass: "All the important steps happened, in the right order.",
    fail: "An important step was missing or happened out of order, so the player stopped part-way.",
  },
  "TC-6": {
    checks: "That each expected tracking event (loaded, initVdo, Forceplay, Pageview, Came In View, Ad Request and so on) fired when it should.",
    pass: "Every expected event fired.",
    fail: "One or more expected events never fired. The detail names the missing events and where to look.",
  },
  "TC-7": {
    checks: "Page view counting: one Pageview per tag on the page, and at most one Website Pageview (and Website Pageview Match) per page.",
    pass: "Page views were counted correctly.",
    fail: "Page views were counted too many times, usually because the tag is installed twice or fires twice. Reports will be inflated.",
  },
  "TC-8": {
    checks: "Whether the player correctly reported if it started above or below the fold, and reported 'Came In View' when a user could see it.",
    pass: "The position was reported correctly and 'Came In View' fired when the player became visible.",
    fail: "The player was visible but never reported 'Came In View', or reported the wrong position, so viewability tracking is unreliable.",
  },
  "TC-9": {
    checks: "That the player asks for an ad once it has started and is in view.",
    pass: "An ad request was sent when expected.",
    fail: "No ad request was sent although the player was ready, or the request was blocked. Check auction, autoplay and player settings.",
  },
  "TC-10": {
    checks: "The ad delivery chain: ad requested → ad received → ad video loaded → playback started → ad seen by the user (50% visible for 2 s for video, 1 s for display).",
    pass: "An ad was received, played and counted as viewable.",
    fail: "The chain broke at a specific step (named in the detail). 'Ad requested but none received' usually means no demand rather than a broken install.",
  },
  "TC-11": {
    checks: "Any 'blocked' or 'error' events (ad blocker, autoplay blocked, bot detected, URL blocked, device hidden, error codes such as Q2) and whether each one is expected.",
    pass: "No unexpected blocks or errors happened.",
    warning: "A block happened that can be expected (for example a blocked URL, device setting or bot detection). It is not an installation fault.",
    fail: "An unexpected block or error stopped the player, for example autoplay blocked, IMA blocked by an ad blocker, or error Q2 (player div missing).",
  },
  "TC-12": {
    checks: "That all the files the player needs (analytics, settings, core player, Google IMA, video player, Prebid, real-time bidding) downloaded successfully.",
    pass: "Every required file downloaded.",
    fail: "A required file was blocked, failed or never requested, so the player could not fully start.",
  },
  "TC-13": {
    checks: "The page structure: our player div and install script exist once, with the correct tag name, inside the article content (not the header or footer).",
    pass: "The div and script are present once, correctly named, inside the content area.",
    fail: "The div is missing, duplicated, wrongly named or in the header/footer. A missing div usually causes error Q2.",
  },
  "TC-14": {
    checks: "That the player actually appears: it has a real size, is not hidden by the page's styles and is not covered by something else.",
    pass: "The player is visible with a proper size.",
    fail: "The player did not form, or it formed but the page's design hides or covers it. The detail says which, because the owners differ.",
  },
  "TC-15": {
    checks: "How fast each tracking call is answered. Target: 500 ms or less each.",
    pass: "Tracking calls were answered quickly.",
    warning: "A few tracking calls were slow (over 500 ms).",
    fail: "Tracking calls were repeatedly or very slow.",
  },
  "TC-16": {
    checks: "That the player works on the device being tested (desktop, or an Android phone for mobile) and has the right size there. iPhone is not tested.",
    pass: "The player works correctly on this device.",
    fail: "Something on this device did not work, for example the wrong screen size or playback not starting after a tap.",
  },
  "TC-17": {
    checks: "That every tracking call describes the same tag, website, page address and build.",
    pass: "All tracking calls agree with each other and with the page.",
    fail: "Tracking calls disagree, for example a different tag or page address. Data would be attributed to the wrong place.",
  },
  "TC-18": {
    checks: "That the tag belongs to this website and product, e.g. 'v-' for video plus the site's name, with -v1, -v2 for extra tags.",
    pass: "The tag matches this website and product.",
    fail: "The tag belongs to another website, or the product prefix is wrong.",
  },
  "TC-19": {
    checks: "Which player build (the 'dep' value) the page uses, and that it does not change during one page load.",
    pass: "One consistent build was used.",
    fail: "The build changed during a single page load, which points to mixed or conflicting player files.",
  },
  "TC-20": {
    checks: "That every tracking call uses a known event name and includes all five fields (event, tag, domain, page URL, build).",
    pass: "Every tracking call is complete and uses known event names.",
    warning: "Some tracking calls had an unknown event name or a missing or empty field.",
    fail: "Tracking calls were malformed.",
  },
  "TC-21": {
    checks: "That tracking calls report the article the user is actually reading (the page address matches).",
    pass: "Tracking reported the correct article address.",
    fail: "Tracking reported a different or old address, usually on infinite-scroll or single-page sites where the tag is not reset.",
  },
  "TC-22": {
    checks: "That each article address gets exactly one 'loaded' and one 'Pageview' per tag.",
    pass: "Each article loaded the tag once and counted one page view.",
    fail: "The tag loaded twice, counted twice, or did not reload for a new article.",
  },
  "TC-23": {
    checks: "How the tag behaves when the user moves to the next article without a full page reload (infinite scroll or single-page sites), across at least 3 articles.",
    pass: "Every new article got its own 'loaded' and 'Pageview'.",
    fail: "The address changed but the tag did not reload, or it reported the old article.",
  },
};

const GENERIC: Record<Exclude<Verdict, "PASS" | "FAIL">, string> = {
  WARNING: "It works, but something needs attention. This is not counted as a failure.",
  UNKNOWN: "The tool could not decide pass or fail. Usually the rules for this check have not been signed off yet, or the page did not provide enough information. See the reason below.",
  NOT_APPLICABLE: "This check does not apply to this page, product or device.",
};

export function resultMeaning(testCaseId: TestCaseId, verdict: Verdict): string {
  const guide = CASE_GUIDE[testCaseId];
  if (verdict === "PASS") return guide?.pass ?? "The check passed.";
  if (verdict === "FAIL") return guide?.fail ?? "The check failed.";
  if (verdict === "WARNING") return guide?.warning ?? GENERIC.WARNING;
  return GENERIC[verdict];
}
