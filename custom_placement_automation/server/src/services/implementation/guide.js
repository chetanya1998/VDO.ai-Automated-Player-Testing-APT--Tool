// "VDO.AI Implementation Validator: Test Cases" (TC-01 to TC-13) in plain words.
// units: which units run the test case (video, banner, offerwall). Video records TC-08's events without a result.
export const UNITS = { VIDEO: 'video', BANNER: 'banner', OFFERWALL: 'offerwall' };
export const UNIT_LABELS = { video: 'Video', banner: 'Banner', offerwall: 'Offerwall' };
export const STEPS = { NETWORK: 'Network', LOGGER: 'Logger', ELEMENTS: 'Elements' };

const ALL = [UNITS.VIDEO, UNITS.BANNER, UNITS.OFFERWALL];

export const IMPLEMENTATION_CASES = [
  { id: 'TC-01', step: STEPS.NETWORK, units: ALL, title: 'Correct tag loads', checks: 'Finds the vdo.ai.js request and compares the tag in its URL with the tag entered for this website.', expected: 'The request for the entered tag (a.vdo.ai/core/<tag>/vdo.ai.js) returns status 200.' },
  { id: 'TC-02', step: STEPS.NETWORK, units: ALL, title: 'Tag loads once', checks: 'Counts the vdo.ai.js requests for the entered tag while the page loads. Requests for other tags are not counted.', expected: 'Exactly one request.' },
  { id: 'TC-03', step: STEPS.NETWORK, units: ALL, title: 'No slot refresh', checks: 'Keeps the page open for the watch period and looks for the tag loading again.', expected: 'No new vdo.ai.js request for the tag after the first load.' },
  { id: 'TC-04', step: STEPS.NETWORK, units: ALL, title: 'No logger.php error report', checks: 'Looks for a logger.php?msg= request. Normal events go to requests named logger, so a logger.php request is an error report.', expected: 'No logger.php?msg= request appears (it fails even with status 200).' },
  { id: 'TC-05', step: STEPS.LOGGER, units: ALL, title: 'No blocking or error event', checks: 'Reads the event of every logger request for the tag. Video: the full list of blocking events and error codes. Banner and offerwall: the Error event only.', expected: 'Video: no blocking event fires. Banner and offerwall: no Error event fires.' },
  { id: 'TC-06', step: STEPS.LOGGER, units: ALL, title: 'Tag is not in a safeframe', checks: 'Reads page_url in the logger payloads.', expected: 'No page_url is a safeframe URL (safeframe.googlesyndication.com or a /safeframe/ path).' },
  { id: 'TC-07', step: STEPS.LOGGER, units: ALL, title: 'One loaded and one pageview per page URL', checks: 'Keeps the events whose tagName is this tag, groups them by page_url and counts loaded and pageview in each group.', expected: 'Every page_url has exactly one loaded and one pageview.' },
  { id: 'TC-08', step: STEPS.LOGGER, units: [UNITS.BANNER, UNITS.OFFERWALL], title: 'Expected events seen', checks: 'Checks that eight events fired, in any order: loaded, pageview, website_pageview, pageview_match, website_pageview_match, ad_match, came_in_view, ad_request. Extra events are fine.', expected: 'All eight events fired.' },
  { id: 'TC-09', step: STEPS.LOGGER, units: [UNITS.VIDEO], title: 'Content size mismatch', checks: 'Looks for the size_mismatch_content event.', expected: 'The event does not fire.' },
  { id: 'TC-10', step: STEPS.LOGGER, units: ALL, title: 'Dependency build', checks: 'Reads dep in the logger payloads.', expected: 'dep is dependencies_hbv4_latest, the default build.' },
  { id: 'TC-11', step: STEPS.ELEMENTS, units: ALL, title: 'Script present once', checks: 'Searches the page (Elements) for the vdo.ai.js script of the tag.', expected: 'Exactly one script, with the correct tag.' },
  { id: 'TC-12', step: STEPS.ELEMENTS, units: [UNITS.VIDEO], title: 'Player present once', checks: 'Looks for one of the two player forms: the in-content wrapper <tag>-0 holding a vdo_video_unit vdo_content player, or a floating vdo_video_unit vdo_floating player.', expected: 'Exactly one of the two forms is present.' },
  { id: 'TC-13', step: STEPS.ELEMENTS, units: [UNITS.BANNER], title: 'Banner div present', checks: 'Searches the page for a div whose id holds the tag with hyphens as underscores (b-tayyar-org-v1 → b_tayyar_org_v1).', expected: 'Such a div is found.' },
];

export const casesFor = (unit) => IMPLEMENTATION_CASES.filter((item) => item.units.includes(unit));

// Section 7: events and the units that list them. TC-08's eight events for banner and offerwall.
export const EXPECTED_EVENTS = ['loaded', 'pageview', 'website_pageview', 'pageview_match', 'website_pageview_match', 'ad_match', 'came_in_view', 'ad_request'];

export const EVENT_DEFINITIONS = [
  { name: 'loaded', units: ALL, meaning: 'vdo.ai.js loaded successfully.' },
  { name: 'initVdo', units: [UNITS.VIDEO], meaning: 'Prebid.js, the IMA SDK and min.js have all loaded, so the player can form.' },
  { name: 'auto_plays', units: [UNITS.VIDEO], meaning: 'Forceplay succeeded, so ad requests can be sent.' },
  { name: 'pageview', units: ALL, meaning: 'The unit formed on the page. Each tag sends its own.' },
  { name: 'website_pageview', units: ALL, meaning: 'Sent once per page, whatever the number of tags.' },
  { name: 'began_atf', units: [UNITS.VIDEO], meaning: "The player was in or above the user's viewport at load." },
  { name: 'began_btf', units: [UNITS.VIDEO], meaning: "The player was below the user's viewport at load." },
  { name: 'came_in_view', units: ALL, meaning: "The player came into the user's view." },
  { name: 'video_start', units: [UNITS.VIDEO], meaning: 'The video content has loaded and can play.' },
  { name: 'ad_request', units: ALL, meaning: 'An ad request went out.' },
  { name: 'video_quartile_1', units: [UNITS.VIDEO], meaning: 'Ad playback reached the first quartile (25%).' },
  { name: 'midpoint', units: [UNITS.VIDEO], meaning: 'Ad playback reached the midpoint (50%).' },
  { name: 'video_quartile_3', units: [UNITS.VIDEO], meaning: 'Ad playback reached the third quartile (75%).' },
  { name: 'ad_match', units: ALL, meaning: 'An ad was received for the player.' },
  { name: 'video_loaded', units: [UNITS.VIDEO], meaning: 'The video ad is ready to show in the player.' },
  { name: 'pageview_match', units: ALL, meaning: 'An impression was recorded against a pageview.' },
  { name: 'website_pageview_match', units: ALL, meaning: 'Recorded when a pageview match is recorded.' },
  { name: 'viewable_impression', units: [UNITS.VIDEO], meaning: "At least 50% of the creative's pixels were in view for 2 seconds." },
  { name: 'size_mismatch_content', units: [UNITS.VIDEO], meaning: 'The video content size does not match the player (TC-09 warning).' },
  { name: 'Error', units: [UNITS.BANNER, UNITS.OFFERWALL], meaning: 'An internal error. Fails TC-05 for banner and offerwall.' },
];

// Video blocking events (TC-05). Names are matched loosely (case, spaces, _ and - ignored); "aliases" are the spellings
// vdo.ai.js actually sends (it logs player_blocked, blocked_ima, blocked_agent).
export const VIDEO_BLOCKING_EVENTS = [
  { name: 'Blocked Player', verdict: 'FAIL', aliases: ['player_blocked'], meaning: 'The player is blocked on purpose for certain pages or inventory.' },
  { name: 'BlockedInline', verdict: 'FAIL', aliases: [], meaning: 'iOS does not allow autoplay, so the ad waits for the user to tap play.' },
  { name: 'BlockedAutoPlay', verdict: 'FAIL', aliases: [], meaning: 'The browser blocked autoplay; the player formed but cannot play.' },
  { name: 'Blocked IMA', verdict: 'FAIL', aliases: [], meaning: 'The IMA SDK (ima3.js) is blocked, mostly by an ad blocker.' },
  { name: 'Blocked Device', verdict: 'FAIL', aliases: [], meaning: 'The player is switched off for mobile or desktop in the dashboard.' },
  { name: 'Blocked URL', verdict: 'FAIL', aliases: [], meaning: 'GAM reported a policy violation on this page URL.' },
  { name: 'Blocked Agent', verdict: 'WARNING', aliases: [], meaning: "Bot traffic was detected. The validator's own browser can trigger it." },
];

// Error codes sent when the parent div is missing (btoa of the error message, first 10 characters).
export const BLOCKING_ERROR_CODES = [
  { code: 'Q2Fubm90IH', meaning: 'Cannot read properties of null: the parent div is missing, so the player cannot form.' },
  { code: 'bnVsbCBpcy', meaning: 'null is …: the parent div is missing, so the player cannot form.' },
];

export const DEFAULT_DEP = 'dependencies_hbv4_latest';

export const IMPLEMENTATION_MEANING = {
  PASS: 'The test case is met.',
  WARNING: 'The unit may still work, but the team should look. A WARNING never makes the tag FAIL.',
  FAIL: 'An implementation, blocking or logger problem. One FAIL makes the tag FAIL.',
};
