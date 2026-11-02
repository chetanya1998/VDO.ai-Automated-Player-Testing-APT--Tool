# Placement Automation

A local tool that opens publisher pages in a real Chrome/Chromium browser and checks the vdo.ai player on them. It runs four kinds of checks from one dashboard:

| Check type | Question it answers | Code applied |
|---|---|---|
| **Custom placement (`vdo.ai.js`)** | Does my new placement code put the player on these pages? | Your `vdo.ai.js` replaces the tag's script |
| **CSS check (`style.css`)** | Does my CSS change keep the player visible? | Your CSS is injected; the site's own `vdo.ai.js` runs |
| **Sticky violation checker** (ST-01 to ST-25) | Does the floating player behave without covering or breaking the page? | None (live tag), or optionally a `vdo.ai.js` / `style.css` |
| **Implementation validator** (TC-01 to TC-13) | Is the live tag installed correctly: loading, logger events and page elements? | None: the live tag as the site serves it |

The placement and CSS checks can also run the **deep test**, which covers all 23 player test cases from the APT Validator, and an **ad slot refresh check**. Every run is saved with screenshots and evidence, listed in History, and can be downloaded as a PDF.

The backend needs PostgreSQL (`DATABASE_URL` in `server/.env`). See [the 23-case mapping, implementation stages and local setup](LOCAL-VALIDATION-PLAN.md).

## Contents

- [Running a check](#running-a-check)
- [Custom placement and CSS checks](#custom-placement-and-css-checks)
- [Deep test (all 23 cases)](#deep-test-all-23-cases)
- [Additional checks (safe frame, ad slot refresh)](#additional-checks-safe-frame-ad-slot-refresh)
- [Sticky violation checker (ST-01 to ST-25)](#sticky-violation-checker-st-01-to-st-25)
  - [How the tool tests each sticky check](#how-the-tool-tests-each-sticky-check)
- [Implementation validator (TC-01 to TC-13)](#implementation-validator-tc-01-to-tc-13)
  - [How the tool tests each test case](#how-the-tool-tests-each-test-case)
- [Staging and preview URLs on another domain](#staging-and-preview-urls-on-another-domain)
- [History and PDF reports](#history-and-pdf-reports)
- [Quick start: one command](#quick-start-one-command)
- [Developer setup](#developer-setup)
- [Settings](#settings)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [API](#api)
- [Tests](#tests)
- [Limitations](#limitations)

## Running a check

The form has up to five steps:

1. **What to test:** the check type, and for placement/CSS checks the code to apply (upload a file or paste it).
2. **Target site:** the publisher **domain**, the **tag name** (several tags for the implementation validator) and up to **50 URLs**, one per line.
3. **Run settings:** the **devices** and, for placement/CSS checks, how the page is scrolled. Desktop is 1366×768 and mobile is an emulated Pixel 7.
4. **Test depth** (placement/CSS only): the optional deep test.
5. **Ad slot refresh check** (placement/CSS only): optional.

The rest of the form adapts to the chosen type: the sticky checker and the implementation validator have their own options and don't show scroll, deep test or refresh settings.

- Checks run in the background as jobs. Progress shows live ("Checking… 3/10 URLs"), and the page stays usable.
- Devices run one after another within a job. At most `MAX_CONCURRENT_JOBS` jobs (default 2) run at once; the rest queue, up to `MAX_PENDING_JOBS`.
- Every URL gets its own fresh browser context: no cookies or cache carry over between URLs.
- The dashboard enables **Run check** only when `/api/ready` reports the database, the queue and a real browser launch as ready.

## Custom placement and CSS checks

| | **Custom placement (`vdo.ai.js`)** | **CSS (`style.css`)** |
|---|---|---|
| What's applied | Your `vdo.ai.js` answers every request for `a.vdo.ai/core/<tag>/vdo.ai.js` | Your CSS is injected into the page's `<head>` as it loads; the site's own `vdo.ai.js` runs unchanged |
| Pass condition | The page fires a `vdo:placement` event reporting success **and** the player wrapper is visible | The player wrapper is visible |
| Time per URL | Stops as soon as the result is clear (max 60 s) | Always runs the full 60 s so you can watch it |

**Reporting the placement result (vdo.ai.js checks).** Add this at the end of your custom placement logic:

```js
window.dispatchEvent(new CustomEvent('vdo:placement', {
  detail: { success: placed } // true only if the player was actually inserted
}));
```

**How the tool tests it.**

1. It opens the URL. A 401/403/429/503 response or a bot-check page title (captcha, "Just a moment", "Access denied") is an ERROR (`page_blocked`).
2. It listens for `vdo:placement` in the page and in every frame, and looks for the wrapper (`#vdoai_parentWrapperDiv` or `.vdoai_parentWrapperDiv`), in the page or inside an iframe.
3. While nothing has happened yet, it scrolls the page in steps (the scroll step and interval from the form or `server/.env`) so lazy-loaded players and ad slots start.
4. After the first event it keeps listening for `PLACEMENT_EVENT_SETTLE_MS` (3 s), then records the last event, the wrapper's visibility and its position.
5. It takes two screenshots, with navigation blocked so an ad can't take the page away: the player centred in view, then the page scrolled past the player (to show floating).

Each URL gets **PASS**, **FAIL** or **ERROR**, with every failing reason that applies:

| Reason | Meaning |
|---|---|
| `script_not_loaded` | The page never requested the tag's `vdo.ai.js`, so your file wasn't used |
| `no_event_emitted` | `vdo:placement` was never fired |
| `placement_failed` | `vdo:placement` reported failure |
| `div_not_found` | No `#vdoai_parentWrapperDiv` / `.vdoai_parentWrapperDiv` on the page |
| `wrapper_hidden` | The wrapper exists but isn't visible |
| `page_blocked` | The site blocked the browser (403/429, captcha or Cloudflare page) |
| `timeout` | The page or the check took too long |
| `page_closed` | The browser page was closed during the check |

**Diagnostics** are kept with every result:
- whether `vdo.ai.js` loaded, in the main page or an iframe;
- the status of `vdo.min.js` and `ima3.js`;
- the targeting agent check;
- the analytics events;
- the errors the tag reported;
- the console output;
- plain-language hints explaining what probably went wrong.

## Deep test (all 23 cases)

Turn on **Automated player testing — deep** in step 4. The placement check runs exactly as before. Afterwards, each URL is opened again in a separate browser with the same device, tag and your `vdo.ai.js` or `style.css`, and validated against TC-1 to TC-23 of the APT Validator.

- **Engine:** the repository's validator rules (`src/rules`, `src/deep` in the repository root), compiled once with `pnpm install && pnpm build` in the repository root. `npm run setup` and `npm run app` do this for you. `/api/ready` reports `deep.available`; the toggle stays disabled until the engine is built.
- **How each of the 23 cases is tested:** see [case coverage](../docs/plan/CASE-COVERAGE.md) for the evidence each case uses and the scenarios it covers.
- **Results per URL:** separate Pass / Fail / Warning / Unknown / N/A totals and filter chips. The 23 case tiles are grouped as *Tag & installation*, *Logger & events*, *Ads & viewability* and *Devices & navigation*. Click a tile to read, in plain words, what the test checks, what its result means and why it got that result on this page. Technical detail for engineers is folded underneath.
- **Run totals:** pass / fail / warning / unknown counts across every URL × 23 cases, also shown in History (*Deep tests* filter) and in the PDF.
- **Screenshots:** taken with your code applied, at the end of the observation, with the player centred and scrolled past it.
- **TC-2 (load time):** every request for a player file is timed. All within 500 ms is a Pass; the slowest between 500 and 1000 ms is a Warning; over 1000 ms or never finishing is a Fail.
- **Honest verdicts:** a PASS needs captured evidence and a confirmed policy. The repository policies are still drafts, so rules that need a confirmed policy report **UNKNOWN** with the reason, never a guessed PASS. TC-23 needs an approved infinite-scroll/SPA navigation and reports UNKNOWN until one exists.
- **Network:** public internet traffic is allowed; private-network addresses are refused unless `DEEP_ALLOW_PRIVATE_NETWORK=true`.
- **Time:** about 15 s of observation per URL and device (`DEEP_OBSERVE_MS`), capped at `DEEP_URL_TIMEOUT_MS` (90 s).

## Additional checks (safe frame, ad slot refresh)

They are shown in their own **Additional checks** block under each URL and in the PDF, and are never added to the 23-case totals.

**Safe frame check** (runs with every deep test). It looks for Google SafeFrame ad frames (`*.safeframe.googlesyndication.com`) inside the vdo.ai player, about every 5 seconds and at the end of the visit.
- **Pass:** a SafeFrame in the player had a real size, was visible, and was on a different address from the page.
- **Warning:** it was hidden, had no size, failed to load, or was on the page's own address.
- **N/A:** no ad in the player used a SafeFrame. Video ads played through Google IMA don't use one, and SafeFrames from the publisher's own ads outside the player are counted but not judged.

**Ad slot refresh check** (step 5, separate from the deep test). Choose 30, 45 or 60 s. After the normal visit, the player is kept in view for the interval plus 20 s while the tool watches for a new ad request. That is the player's *Ad Request* logger events, or Google Ad Manager requests if the player sends none.
- **Pass:** a new ad request came between 5 s early and 15 s late, measured from the previous one.
- **Warning:** the slot refreshed, but at a different interval.
- **Fail:** no new ad request came while the player stayed in view.
- **Unknown:** the player never asked for an ad.

## Sticky violation checker (ST-01 to ST-25)

Pick **Sticky violation checker** in step 1. It runs the checks from *VDOAI Sticky Violation Test Cases – Status Criteria* on each URL and device:

- **Mandatory, always run:** ST-01 to ST-13.
- **Additional, only when ticked:** ST-14 to ST-25 (**Also run the additional checks**).
- **Code to apply first:** **None** by default (the live tag as the site serves it), or a `vdo.ai.js` / `style.css` to apply before inspecting.

**What the tool does on each page** (about 30 s per URL and device for the mandatory checks; about 15 s more with the additional checks):

1. **Initial load:** it watches the page for about 5 seconds without scrolling, taking a snapshot every 0.6 s.
2. **Scroll down:** half a screen at a time until the player's place in the article is well behind (at most 24 steps).
3. **Ad load:** it waits 10 s without scrolling while the ad loads and plays.
4. **Small scrolls:** up and down by 60% of a screen, three times.
5. **Bottom:** it scrolls to the bottom of the page, at most 15 screens (for infinite scroll).
6. **Window sizes (additional checks only):** it goes back to the article and tries other sizes. Desktop gets 1024×640, 800×600, and 125% and 150% zoom (emulated with the smaller CSS window a zoomed browser has). Mobile gets landscape and a 360×640 phone.
7. **Close:** it clicks the floating player's close button. With the additional checks it then keeps scrolling to see whether the player comes back.

**What every snapshot records:**
- where the vdo.ai player is, and whether it is in-content or floating (`position: fixed`);
- the page and player spacing, and the publisher CSS around the player;
- what the player covers, found by **hit-testing** a 3×3 grid of points with `elementFromPoint`: the site header, the headline, footer links, consent banners, other sticky ads, and page links, buttons, images and headings;
- whether the close and Skip Ad buttons are fully on screen, not cut off, and on top. Skip Ad is found inside the ad iframes, frame by frame, and **is never clicked** on live ads.

Every snapshot also gets a screenshot, with the player outlined in blue and problem areas in red.

**Results:**
- Only three statuses, as in the status criteria document:
  - **Pass:** the observed result matches the expected result.
  - **Fail:** it does not.
  - **Warning:** it could not be judged on this page (the situation didn't occur, a prerequisite was missing, or the setting is unknown).
- **Screenshot evidence for every check**, including passes and warnings: each check names the screenshot of the moment that decided it ("Screenshot #3").
- **Overall per URL** comes from the share of *judged* checks (Pass + Fail) that passed. Warnings are left out:

  | Judged checks passed | Overall |
  |---|---|
  | 80% or more | **Pass** |
  | 50% to under 80% | **Pass · Review required** |
  | Under 50% | **Fail** |
  | None could be judged | **Could not be judged** |

  Example: 8 pass, 3 fail and 2 warnings = 8 of 11 = 73% → Pass · Review required.
- **Page blocked:** a refused URL shows the HTTP status, the page title and a screenshot of what the site showed.

### How the tool tests each sticky check

A player that is never found makes every check a Warning. "Covered" means at least one hit-test point lands on the player and the overlap is at least 200 px².

| Check | How the tool tests it | Pass / Fail / Warning |
|---|---|---|
| **ST-01** Unnecessary margins or blank space | Compares the margin + padding of `<body>`, `<html>`, the player wrapper and the anchor div in the last snapshot before floating with the first floating snapshot. | **Fail:** any of them grew by more than 8 px with nothing to make room for. **Warning:** it grew while a fixed bar was in the way, or the player never floated. |
| **ST-02** Overlap with site header / navigation | Hit-tests the site header and main menu (a `header`/`nav` near the top of the page or fixed to the top; breadcrumbs, pagination and widget headers don't count) in every snapshot. | **Fail:** the player covers it at any moment. **Warning:** no header was found. |
| **ST-03** Overlap with article headline | Hit-tests the article headline (`h1` and schema.org headlines, not related-post titles) in every snapshot. | **Fail:** the player covers it. **Warning:** no headline was found. |
| **ST-04** Skip Ad visibility and clickability | Looks for Skip Ad buttons inside the ad iframes while the whole player is on screen, then checks that each one is inside the screen and its own frame (at least 95% visible) and is the top element at its centre. | **Fail:** off screen, cut off, covered or outside the player. **Warning:** no skippable ad appeared. |
| **ST-05** Close button visibility and clickability | Finds the floating player's close control (elements named close/× inside the player), checks it like ST-04, then **clicks it** and takes a snapshot 1.5 s later. | **Fail:** the button is off screen, cut off or covered, or clicking it did not close the player. **Warning:** the player never floated or has no close button. |
| **ST-06** Content-floating does not appear too early | Records when the anchor div first enters the screen ("reached") and compares that with every floating snapshot. | **Fail:** the player floated before its place was reached. **Warning:** no anchor div, or the player never floated. |
| **ST-07** Content-floating appears after in-content trigger | Same timing as ST-06, from the first floating snapshot. | **Pass:** floating started after the place was reached. **Warning:** it never floated (the message says whether its place was scrolled past). |
| **ST-08** Overlap with important article content | Measures the floating player's share of the screen, and hit-tests the links, buttons, form fields, images, videos and `h2`/`h3` headings under it. | **Fail:** more than 30% of the screen (a large sticky ad under the Better Ads Standards), or it covers any of those elements. |
| **ST-09** Position shift when ad loads | Compares the player position between consecutive snapshots during the initial load and the ad wait, with no scrolling in between. | **Fail:** it moved more than 20 px into the header or headline. **Warning:** it moved but stayed clear, or no ad was seen playing. |
| **ST-10** Player or controls outside viewport | Checks every floating snapshot: the player box and the close button must be inside the screen (2 px tolerance). | **Fail:** any part is off screen. |
| **ST-11** Overlap with another sticky ad or floating element | Lists the other fixed/sticky elements on screen while the player floats. Ads are recognised by their id/class (`ad`, `gpt`, `dfp`, `adsbygoogle`, `sticky-ad` …). The tool then hit-tests those elements and their buttons. Headers, bottom bars and consent banners are left to ST-02, ST-13 and ST-14. | **Fail:** the player covers another sticky ad or fixed element. **Warning:** something else covers 34% or more of the player, or there was no other fixed element. |
| **ST-12** Duplicate floating players | Counts the outermost fixed vdo elements big enough to be a player in every snapshot. | **Fail:** more than one floats at the same time. **Warning:** only one floated, but no next article loaded to test across articles. |
| **ST-13** Overlap with footer or bottom navigation | At the bottom of the page, hit-tests the footer links and any fixed bottom navigation bar. | **Fail:** the player covers them. **Warning:** no footer, or the player was not floating at the bottom. |
| **ST-14** Overlap with consent / notification banner | Finds cookie, consent and notification banners among the fixed elements by name (OneTrust, CMP, GDPR, Didomi …) or text ("cookie", "accept all"), then hit-tests them and their buttons. | **Fail:** a banner button is covered, or 34% or more of the banner. **Warning:** no banner appeared. |
| **ST-15** Controls clipped at different player sizes | Repeats the ST-04/ST-05 control check at every window size tried. | **Fail:** a control is off screen, cut off or covered at any size. |
| **ST-16** Position while scrolling up and down | Compares the floating player's box across the up/down scrolls and the ad wait, and the page spacing too. | **Fail:** it moved or resized more than 10 px, or the spacing changed more than 8 px. **Warning:** it switched between floating and in-content. |
| **ST-17** Behaviour after closing the floater | After the ST-05 click, scrolls down and up three times and looks for the player floating again. | **Pass:** it stays closed. **Warning:** it came back, which depends on its configuration. **Fail:** the click did not close it. |
| **ST-18** Infinite-scroll article placement mismatch | When a next article loads (a second anchor div or a changed address), compares the article holding the floating player with the article being read. | **Fail:** it belongs to another article in two or more snapshots. **Warning:** no next article loaded. |
| **ST-19** Responsive viewport changes | At each resized window, checks that the floating player is on screen, an in-content player is not wider than the screen, controls are usable, and the header/headline is clear. | **Fail:** any of those breaks at a size. |
| **ST-20** Publisher CSS causes clipping / overlap | Measures how much of the player is actually visible (`overflow` on a parent), whether page elements are drawn over it while it is fully on screen, and whether a parent has `transform` / `filter` / `contain`, which breaks `position: fixed`. | **Fail:** under 90% visible, 34% or more covered, or a breaking parent makes the floater move with the page. An in-content player under the site's own sticky header is normal and is not counted. |
| **ST-21** Premature floating during initialisation | Checks the snapshots taken before any scrolling. | **Fail:** the player floated before its place was on screen, or appeared more than 300 px away from its anchor. |
| **ST-22** Extra space left after floating starts | While floating, measures the height the anchor div still takes in the article. A floating (fixed) child adds nothing; a left-behind box does. | **Fail:** a gap of 50 px or more remains. |
| **ST-23** Short article behaviour | Applies only when the player sits within 1.2 screens of the end of the page; then repeats the ST-06 timing test. | **Fail:** it floated before being reached. **Warning:** the article is long. |
| **ST-24** Chromium zoom / viewport scaling | The ST-19 test at 125% and 150% zoom (desktop only). | **Warning** on mobile, where browser zoom is not a setting. |
| **ST-25** Page navigation and stale player state | When the address changes inside the page, checks that the floating player belongs to the new page's article. | **Fail:** it kept floating for the previous page. **Warning:** the address never changed. |

**Note:** these are internal preventative QA checks, not official Google violation triggers. A failure needs investigation, and a pass does not guarantee policy compliance.

## Implementation validator (TC-01 to TC-13)

Pick **Implementation validator** in step 1. It runs the test cases from *VDO.AI Implementation Validator: Test Cases* on the live page, the way you would check an install by hand in Chrome DevTools: **Network** (filter `vdo.ai.js`), **Network** (filter `logger`, Payload tab) and **Elements** (search for the tag). No code is applied.

### Inputs

- **Domain**, up to **50 URLs** and one or more **tag names**, separated by commas (for example `v-livemint, v-livemint-v1, b-livemint, o-livemint`). At most 10 tags per check. The form shows each tag with its unit and number of test cases.
- **The unit comes from the tag prefix:**

  | Unit | Tag pattern | Examples | Test cases run |
  |---|---|---|---|
  | Video | `v-{site}`, `v-{site}-v{n}`, or no prefix | `v-livemint`, `v-koimoi-v1`, `livemint` | 11 |
  | Banner | `b-{site}`, `b-{site}-v{n}` | `b-tayyar-org-v1` | 11 |
  | Offerwall | `o-{site}` | `o-metbeatnews` | 10 |

- **Watch period (TC-03):** 30, 45 or 60 s. Each URL takes the page load plus the watch, about 45 s with the default.
- **Devices:** desktop, mobile or both. Each device is a separate run.

### What the tool does on each page

1. **New browser context, cache disabled:** a fresh context per URL with `Network.setCacheDisabled`, the same as DevTools with *Disable cache* ticked. Pop-ups opened by ads are closed, and `window.close()` is blocked.
2. **Recording starts before the page opens:** every request, response and failed request in the page and all its frames, timed from the start of navigation. An init script in every frame also records each `vdo.ai.js` `<script>` element as it is inserted, and whether it loaded.
3. **Load:** the URL opens and the tool waits for the `load` event (at most `NAVIGATION_TIMEOUT_MS`, 30 s). A slower page is noted, and the checks continue with what loaded. A screenshot is taken.
4. **Watch:** from the load event, the page stays open for the watch period. Navigation is blocked so an ad can't take the page away. Every 2 s the tool brings the first vdo.ai unit it finds into view (the tag's div, `<tag>-0`, the banner div, or `.vdo_video_unit`), so lazy units form and send `came_in_view` and `ad_request`. If no unit is found, it scrolls down half a screen at a time, at most 6 times.
5. **Elements:** after the watch it brings the unit into view, takes a second screenshot, and searches the page **and every frame** for the scripts, player forms and banner divs.
6. **Judging:** all evidence goes to the rules, and every test case is judged for every tag.

A page the site refuses (401/403/429/503, or a bot check) is an **ERROR** for the URL; its test cases are still shown with what was seen. A page that can't be opened at all is an ERROR with **Page could not be opened**.

### Results and how to read them

- Each test case gets **PASS**, **WARNING** or **FAIL**, or **Not eligible** when it doesn't apply.
  - **PASS:** the test case is met.
  - **WARNING:** the unit may still work, but the team should look. A WARNING never makes the tag FAIL.
  - **FAIL:** an implementation, blocking or logger problem.
- **A tag's result** is the worst of its test cases: one FAIL fails the tag, and a failing tag fails the URL.
- **Every test case runs for every tag, even after a FAIL**, and uses only its own evidence. For example, TC-02 counts requests even if TC-01 failed, and the Elements checks run even when the script didn't load.
- **Logger events** can arrive in any order; the order is not checked. Extra events never cause a FAIL: an event fails a test case only if that test case lists it.
- **Not eligible:**
  - **Another unit's test cases:** each tag lists all 13 test cases, and the ones its unit doesn't run are marked *Not eligible* with the reason, for example "TC-12 applies to video tags only, and b-tayyar-org is a banner tag". They never count as PASS, WARNING or FAIL.

    | Unit | Not eligible |
    |---|---|
    | Video | TC-08 (video's events are recorded, not judged), TC-13 |
    | Banner | TC-09, TC-12 |
    | Offerwall | TC-09, TC-12, TC-13 |

  - **Tags not on the page:** with several tags, each tag found on a page is tested as **its own instance** with its own unit's test cases, so a video, a banner and an offerwall tag on one page give three separate results. A tag that left no trace on a page while another entered tag is there is **Not eligible on this page**, not FAIL. No trace means no `vdo.ai.js` request or script for it, no logger event with its `tagName`, and no logger.php report naming it.
  - **No entered tag on the page:** all tags are tested, so a missing installation still fails TC-01.
- **Report:** per URL, one block per tag with its unit and a summary line, for example *8 PASS, 1 WARNING, 2 FAIL · 2 not eligible*. Then one row per test case, grouped by step:
  - **ID and test case**
  - **Result**
  - **Evidence**: what the tool saw. That is the request URL and status, the initiator, the event name and `page_url`, the error code and `msg`, the `dep` value, the script `src` or the element id.

  Click **What this checks** under a row for the expected result and the raw evidence. A filter shows only PASS, WARNING, FAIL or Not eligible rows. Each tag also lists every logger event it sent (the section 7 events, fired or not, plus any extra events).

### Test cases at a glance

| ID | Test case | Step | Video | Banner | Offerwall |
|---|---|---|---|---|---|
| TC-01 | Correct tag loads | Network | ✓ | ✓ | ✓ |
| TC-02 | Tag loads once | Network | ✓ | ✓ | ✓ |
| TC-03 | No slot refresh | Network | ✓ | ✓ | ✓ |
| TC-04 | No logger.php error report | Network | ✓ | ✓ | ✓ |
| TC-05 | No blocking or error event | Logger | ✓ full list | ✓ Error only | ✓ Error only |
| TC-06 | Tag is not in a safeframe | Logger | ✓ | ✓ | ✓ |
| TC-07 | One loaded and one pageview per page URL | Logger | ✓ | ✓ | ✓ |
| TC-08 | Expected events seen | Logger | recorded only | ✓ | ✓ |
| TC-09 | Content size mismatch | Logger | ✓ | – | – |
| TC-10 | Dependency build | Logger | ✓ | ✓ | ✓ |
| TC-11 | Script present once | Elements | ✓ | ✓ | ✓ |
| TC-12 | Player present once | Elements | ✓ | – | – |
| TC-13 | Banner div present | Elements | – | ✓ | – |
| | **Test cases that run** | | **11** | **11** | **10** |

### How the tool tests each test case

The tool reads three sources of evidence, the same ones DevTools shows.

**Network: `vdo.ai.js` requests.** Every request whose host is `vdo.ai` or a subdomain and whose path is `/core/<TAG>/vdo.ai.js`. For each one it keeps:
- the tag in the path;
- the time from the start of navigation;
- the HTTP status, following redirects to the final response;
- the failure text if it never got a response (for example `net::ERR_BLOCKED_BY_CLIENT`);
- the frame;
- the **initiator** (`parser` or `script`, with the URL and line), from the Chrome DevTools Protocol.

**Network: `logger.php` error reports.** Requests whose path ends in `/logger.php` and that carry `msg=`. They are on a vdo.ai host, or have `func=vdo.ai.js`. This is what `vdo.ai.js`'s `logError` sends: `a.vdo.ai/core/logger.php?msg=<stack>&tag=<tag>&code=<first 10 characters of btoa(message)>&url=<page>&func=vdo.ai.js`. The tool decodes `msg` (first line), `tag`, `code`, `url` and `func`, and keeps the status.

**Logger: event payloads.** Requests to a vdo.ai host whose path contains `logger`, except `logger.php`. `vdo.ai.js` posts one JSON object per event to `https://analytics.vdo.ai/logger` (falling back to `analytics1.vdo.ai`), for example:

```json
{ "domainName": "www.koimoi.com", "page_url": "https://www.koimoi.com/news/story", "tagName": "v-koimoi-v1",
  "event": "loaded", "eventData": 1, "uid": "", "dep": "dependencies_hbv4_latest" }
```

How the payloads are read:
- **Formats:** JSON bodies are read, and so are arrays, `events: [...]` batches, form-encoded bodies and query strings.
- **Fields kept:** `event`, `tagName`, `page_url`, `dep`, `eventData` and `domainName`.
- **Filtering:** only events whose `tagName` **exactly equals** the tag being tested are used (rule 6), so `v-livemint-v1`'s events never count for `v-livemint`.
- **Name matching:** event names are compared ignoring case, spaces, `_` and `-`, so `Blocked IMA` = `blocked_ima` = `BlockedIMA`. The spellings `vdo.ai.js` really sends are known aliases: `player_blocked` is **Blocked Player**.

**Elements.** It searches the page and every frame Playwright can reach:
- `script[src]` elements for `/core/<TAG>/vdo.ai.js`, with their `async`, `defer` and `id`;
- elements whose id is `<TAG>-<n>` (the in-content wrapper);
- `.vdo_video_unit.vdo_floating` players;
- `div`s whose id contains the tag in underscore form.

How each test case uses that evidence:

#### TC-01 Correct tag loads (Network · all units)

- **What it checks:** the `vdo.ai.js` request for the entered tag loads.
- **How the tool tests it:** it keeps the recorded `vdo.ai.js` requests whose path tag equals the entered tag.
  - If one of them got status **200**, the test case passes.
  - If there are requests for the tag but none got 200, the first one's problem is reported: a non-200 status, a blocked request, or no response.
  - If there is no request for the tag at all, it looks at the `vdo.ai.js` requests for **other** tags, comparing their site part (the tag without the `v-`/`b-`/`o-` prefix and `-v{n}`):
    - **wrong unit prefix:** same site, different unit, for example `v-tayyar-org` loaded while `b-tayyar-org` was entered;
    - **another tag of this site:** same site and unit, another version;
    - **another website's tag;**
    - **no vdo.ai.js request at all.**
- **PASS:** the request for the entered tag returns 200.
- **WARNING:** never.
- **FAIL:** no request, another site's tag, wrong unit prefix, a status other than 200, or the request was blocked.
- **Evidence:** each request URL with its status, or `blocked (<error>)`.

#### TC-02 Tag loads once (Network · all units)

- **What it checks:** the tag is loaded exactly once while the page loads.
- **How the tool tests it:**
  - Requests for the entered tag that start within `IMPLEMENTATION_LOAD_WINDOW_MS` (10 s) of the first one count as **page loads**. Later ones belong to TC-03.
  - Chrome sends **one** network request for two identical scripts that are inserted at the same time, even with the cache disabled. So the tool also counts the `vdo.ai.js` `<script>` elements for the tag that loaded (in every frame, in the same window) and uses **the larger of the two counts**. A duplicate embed is caught either way. A script element that failed to load is not a load.
  - Requests for other tags are never counted: `v-livemint-v1` next to `v-livemint` is not a duplicate.
- **PASS:** exactly one load.
- **WARNING:** never.
- **FAIL:** two or more loads. Zero loads is also a FAIL ("the tag did not load once").
- **Evidence:** each request with time, status and initiator, plus each script element with time, load state and frame.

#### TC-03 No slot refresh (Network · all units)

- **What it checks:** the tag does not load again while the page stays open.
- **How the tool tests it:** the page stays open for the watch period (30/45/60 s from the `load` event) with the unit in view. Any request for the tag (or script element for it) starting more than 10 s after the first load is a **refresh**. The same larger-count rule as TC-02 applies.
- **PASS:** no new load after the first one. Also PASS when the tag never loaded; that is TC-01's failure.
- **WARNING:** never.
- **FAIL:** the tag loaded again during the watch, for example at 20 or 30 s.
- **Evidence:** the time of every request and script element, from the start of navigation.

#### TC-04 No logger.php error report (Network · all units)

- **What it checks:** `vdo.ai.js` did not send an error report.
- **How the tool tests it:** it looks at the recorded `logger.php?msg=` requests. A report counts for this tag when its `tag` parameter equals the tag, or when it has no `tag` (it can't be put on another tag). A report naming another entered tag counts only for that tag. The status doesn't matter: the request itself is the error report. A known code is explained, for example `Q2Fubm90IH` = "Cannot read properties of null", the parent div is missing.
- **PASS:** no `logger.php?msg=` request.
- **WARNING:** never.
- **FAIL:** one or more reports, even with status 200.
- **Evidence:** `msg`, `tag`, `code`, `url`, `func` and the status of each report.

#### TC-05 No blocking or error event (Logger · video: full list; banner and offerwall: Error only)

- **What it checks:** no event that blocks the unit fired.
- **How the tool tests it:** it reads the `event` of every logger payload for the tag.
  - **Video:** each event is matched against the blocking list:

    | Event (also matches) | Result |
    |---|---|
    | Blocked Player (`player_blocked`) | FAIL |
    | BlockedInline | FAIL |
    | BlockedAutoPlay | FAIL |
    | Blocked IMA (`blocked_ima`) | FAIL |
    | Blocked Device | FAIL |
    | Blocked URL | FAIL |
    | Error code `Q2Fubm90IH` or `bnVsbCBpcy`, found in the event name or its `eventData` (`logError` sends an `error` event with the code as `eventData`) | FAIL |
    | Blocked Agent (`blocked_agent`) | WARNING: bot traffic detected; the validator's own browser can trigger it |

    Other `error` events are not in the video list and don't fail video's TC-05.
  - **Banner and offerwall:** only the `Error` event (`error`) fails.
- **PASS:** none of the listed events fired.
- **WARNING:** video only, when Blocked Agent fired and nothing failed.
- **FAIL:** a FAIL event from the list above fired.
- **Evidence:** each event's name, the `event` string as sent, its `page_url` and `eventData`.

#### TC-06 Tag is not in a safeframe (Logger · all units)

- **What it checks:** the tag does not run inside a Google SafeFrame container.
- **How the tool tests it:** it reads the `page_url` of every logger payload for the tag. A `page_url` whose host is `safeframe.googlesyndication.com` or a subdomain of it, or whose path contains `/safeframe/`, means the tag ran inside a safeframe. For example: `https://0696a8f32fd9dd37b4050d9734714c15.safeframe.googlesyndication.com/safeframe/1-0-45/html/container.html`.
- **PASS:** no `page_url` is a safeframe URL.
- **WARNING:** never.
- **FAIL:** a safeframe `page_url`. The report says "The tag is in a safeframe container".
- **Evidence:** the `page_url` values checked.

#### TC-07 One loaded and one pageview per page URL (Logger · all units)

- **What it checks:** each article sends one `loaded` and one `pageview` for the tag.
- **How the tool tests it:** it keeps the tag's events, groups them by `page_url`, and counts `loaded` and `pageview` in each group. `website_pageview` is a different event and is not counted.
- **PASS:** every `page_url` has exactly one `loaded` and one `pageview`. With infinite scroll, each article has its own `page_url` and needs its own pair.
- **WARNING:** never.
- **FAIL:**
  - a `page_url` has none or more than one of either;
  - no `loaded` or `pageview` was sent at all;
  - a `pageview` for a new URL with no `loaded`. The report adds that this points to an infinite-scroll or SPA setup that doesn't reload the tag.
- **Evidence:** `<page_url>: loaded N, pageview N` for each group.

#### TC-08 Expected events seen (Logger · banner and offerwall)

- **What it checks:** the normal event set fired.
- **How the tool tests it:** it checks the tag's events, in any order, for the eight expected events: `loaded`, `pageview`, `website_pageview`, `pageview_match`, `website_pageview_match`, `ad_match`, `came_in_view` and `ad_request`. Extra events are fine.
- **Video:** not eligible. Video's events are **recorded** in the tag's event list (every section 7 event, fired or not, with counts), and a missing or extra event doesn't change the result.
- **PASS:** all eight fired.
- **WARNING:** one or more did not fire, for example `ad_match` when no ad matched.
- **FAIL:** never.
- **Evidence:** the events seen and the events missing.

#### TC-09 Content size mismatch (Logger · video)

- **What it checks:** the video content size matches the player.
- **How the tool tests it:** it looks for the `size_mismatch_content` event among the tag's events.
- **PASS:** it did not fire.
- **WARNING:** it fired.
- **FAIL:** never.
- **Evidence:** the event and its `page_url`.

#### TC-10 Dependency build (Logger · all units)

- **What it checks:** the tag uses the default dependency build.
- **How the tool tests it:** it collects the distinct `dep` values from the tag's payloads. Some events, such as `player_blocked`, carry no `dep`, so only payloads that have one are used.
- **PASS:** every `dep` is `dependencies_hbv4_latest`, the default build.
- **WARNING:**
  - any other value, for example `dependencies_dev_3153` (the infinite-scroll build, named as such in the report) or `dependencies_vdodev_1343`;
  - no payload carried a `dep`, so the build could not be confirmed.
- **FAIL:** never.
- **Evidence:** each `dep` value.

#### TC-11 Script present once (Elements · all units)

- **What it checks:** exactly one `vdo.ai.js` script for the tag is in the page.
- **How the tool tests it:** it finds every `script[src]` in the page and its frames whose `src` resolves to `https://*.vdo.ai/core/<TAG>/vdo.ai.js`, and counts those for the entered tag. Inline loader scripts (the embed snippet) have no `src` and are not counted; the script element they insert is. It also records `async`, `defer` and `id`, and shows the expected form for the unit:
  - **Video:** `<script defer async src="https://a.vdo.ai/core/<TAG>/vdo.ai.js">`
  - **Banner:** `<script async defer src="https://a.vdo.ai/core/<TAG>/vdo.ai.js">`
  - **Offerwall:** `<script src="https://a.vdo.ai/core/<TAG>/vdo.ai.js" id="vdo-ai-<TAG>" async defer>`. An offerwall script without `id="vdo-ai-<TAG>"` is pointed out, but doesn't fail.
- **PASS:** exactly one script with the correct tag.
- **WARNING:** never.
- **FAIL:** no script, only another tag's script (named in the report), or two or more.
- **Evidence:** each script's `src`, attributes and frame, plus the expected script.

#### TC-12 Player present once (Elements · video)

- **What it checks:** exactly one video player formed for the tag.
- **How the tool tests it:** it counts two player forms.
  - **In-content:** an element whose id is `<TAG>-<n>`, for example `<vdo id="v-koimoi-v1-0">`, holding a `.vdo_video_unit` player (normally `vdo_video_unit vdo_content`). The id match is exact: `v-livemint-0` never matches `v-livemint-v1-0`. A wrapper with no player inside doesn't count, and the report says so.
  - **Floating:** a `.vdo_video_unit.vdo_floating` player outside every tested tag's wrapper, for example id `_vdo_ads_player_ai_39685`. A floating tag has no anchor div. An in-content player that is floating at that moment is still inside its wrapper, so it is not counted twice.
  - **Several video tags on one page:** floating players carry no tag name. Each **other** tested video tag that loaded (status 200) without an in-content wrapper claims one floating player first. The rest count for this tag, so `v-livemint` (in-content) and `v-livemint-v1` (floating) on one page both pass. The report says how many floating players went to other tags.
- **PASS:** exactly one form is present.
- **WARNING:** never.
- **FAIL:** neither form, or more than one (two wrappers, or a wrapper and a floating player).
- **Evidence:** each in-content wrapper (element and id) and each floating player (id and class).

#### TC-13 Banner div present (Elements · banner)

- **What it checks:** the banner's container div is on the page.
- **How the tool tests it:** it turns the tag's hyphens into underscores (`b-tayyar-org-v1` → `b_tayyar_org_v1`) and looks for a `div` whose id contains that text, followed by `_` or the end of the id. For example `b_tayyar_org_v1_Anchor_Top_…`. A div of a versioned tag doesn't count for the base tag: `b_tayyar_org_v1_…` is not a div of `b-tayyar-org`. The first 5 matches per frame are kept. An offerwall has no div, so it is not looked for.
- **PASS:** a matching div is found.
- **WARNING:** no such div. The banner may still work, because the script is present.
- **FAIL:** never.
- **Evidence:** the div ids found.

### Logger events reference

These are the events from section 7 of the test case document, and the units that list them (V video, B banner, O offerwall). Each tag's result shows which of its unit's events fired and how often.

| Event | Units | Meaning |
|---|---|---|
| `loaded` | V B O | `vdo.ai.js` loaded |
| `initVdo` | V | Prebid.js, the IMA SDK and min.js loaded, so the player can form |
| `auto_plays` | V | Forceplay succeeded, so ad requests can be sent |
| `pageview` | V B O | The unit formed; each tag sends its own |
| `website_pageview` | V B O | Once per page, whatever the number of tags |
| `began_atf` / `began_btf` | V | Player above / below the fold at load |
| `came_in_view` | V B O | The player came into view |
| `video_start` | V | Video content loaded and can play |
| `ad_request` | V B O | An ad request went out |
| `video_quartile_1`, `midpoint`, `video_quartile_3` | V | Ad playback reached 25%, 50%, 75% |
| `ad_match` | V B O | An ad was received |
| `video_loaded` | V | The video ad is ready to show |
| `pageview_match`, `website_pageview_match` | V B O | An impression was recorded against a pageview |
| `viewable_impression` | V | 50% of the creative in view for 2 s |
| `size_mismatch_content` | V | Content size does not match the player (TC-09) |
| `Error` | B O | Internal error (fails TC-05 for banner and offerwall) |

### Reference examples

The examples from section 8 of the test case document are unit tests, and give these results:

| Page | Tag | What was seen | Result |
|---|---|---|---|
| koimoi.com | `v-koimoi-v1` (video) | One `vdo.ai.js` request with status 200, the `v-koimoi-v1-0` wrapper, `dep = dependencies_vdodev_1343` | TC-01, TC-02, TC-12 PASS; TC-10 WARNING |
| ibctamil.com | `v-ibctamil` (video) | `logger.php?msg=TypeError: Cannot read properties of null (reading 'style')`, code `Q2Fubm90IH`, func `vdo.ai.js` | TC-04 FAIL |
| insights.dsij.in | `v-dsij-in` (video) | `dep = dependencies_dev_3153` | TC-10 WARNING (infinite-scroll build) |
| tayyar.org | `b-tayyar-org-v1` (banner) | The expected script and a `b_tayyar_org_v1_Anchor_Top_…` div | TC-11, TC-13 PASS |
| metbeatnews | `o-metbeatnews` (offerwall) | The script with `id="vdo-ai-o-metbeatnews"` | TC-11 PASS |

## Staging and preview URLs on another domain

Every URL must be on the publisher **domain** or one of its subdomains (`www.`, `m.` and so on). Otherwise the form names the host and the check does not start. For staging or preview copies on another host, tick **Allow URLs on other domains (staging / preview)** under the URLs.

- Keep the **publisher's own domain** in the Domain field, for example `thehindubusinessline.com` for `https://devbl.thehindu.co.in/…`. The deep test's tag-to-domain check (TC-18) keeps judging the tag against that domain; typing the staging domain would make TC-18 fail wrongly.
- These URLs are marked **Staging / preview: host** on their result, in the run header, in History and in the PDF.
- Google Ad Manager preview links (`?google_preview=…`) work; they show one creative and expire after a while.
- For staging sites only reachable inside a private network, the deep test also needs `DEEP_ALLOW_PRIVATE_NETWORK=true`.

## History and PDF reports

- Every run (one per device) is saved in PostgreSQL and listed in **History**, newest first. You can search by tag, domain or URL.
- **Filters:** Placement passed, failed or errors; Custom placement; CSS checks; Sticky checks; **Implementation validator**; Deep tests.
- **Check type column:**
  - sticky runs show each URL's overall result;
  - implementation runs show **each tag's result per URL**, for example "b-tayyar-org: Pass · 11 pass, 0 warning, 0 fail" or "o-metbeatnews: Not eligible on this URL".
- **Open** a run to see the full results.
- **Re-run** fills the form with that run's settings and stored code: the deep test, the refresh check, the sticky options (code to apply, additional checks), and the implementation validator's tags and watch period.
- **PDF** downloads a report with every result and screenshot:
  - **Deep runs** add separate totals and a legend.
  - **Sticky runs** list every check with its screenshot number.
  - **Implementation runs** show each tag with its unit, summary line, and every test case with result and evidence lines. Tags not on a page get a one-line reason.
- **Delete / Clear all** removes runs and their screenshots. Both wait until no check is running.

## Quick start: one command

> **Team installation and updates:** [INSTALL-AND-UPDATE.md](../INSTALL-AND-UPDATE.md) (Windows, macOS, Linux, updates, test branches, rollback). **AI assistant installation:** [LLM-INSTALL-INSTRUCTIONS.md](../LLM-INSTALL-INSTRUCTIONS.md). **What changed:** [CHANGELOG.md](../CHANGELOG.md).

After installing **Git, Node.js 24 LTS (22+), PostgreSQL and Google Chrome** once, clone the repository and run, from the repository root or from this folder:

```bash
npm run app
```

On Windows you can also double-click **`Start VDO Tool.cmd`** in the repository root. Step-by-step: [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md).

`npm run app` (`scripts/app.mjs`):

1. **Updates:** fetches the latest version of the current branch from GitHub (fast-forward only; it never merges or overwrites local edits) and restarts itself if it changed.
2. **Settings, first run only:** asks for the PostgreSQL host, port, user, password (hidden) and database name, and writes `server/.env`.
3. **Installs packages** for the deep test engine (pnpm, `--frozen-lockfile`) and the app (`npm ci`). It does this only when a `package.json` or lockfile changed. If Playwright's Chromium can't be downloaded, Google Chrome is used.
4. **Builds** the deep test engine and the dashboard only when their code changed.
5. **Connects to PostgreSQL**, creating the database if it doesn't exist.
6. **Starts the server** at **http://127.0.0.1:3000** (dashboard included) and opens the browser. The dashboard footer shows the branch, commit and date that are running.

Options: `--no-update`, `--branch <name>` (switch branch first), `--setup` (change the PostgreSQL settings), `--no-open`. Pass them after `--`, for example:

```bash
npm run app -- --branch implementation-validator
```

## Developer setup

```bash
npm run setup || bash setup.sh
```

`npm run setup` needs npm, which comes with Node. If npm isn't installed, the `||` falls back to `bash setup.sh`. The script:
- checks for Node.js 20+, installing it through nvm if it's missing or too old;
- installs the server and client dependencies;
- installs Chromium and, on Linux, Chromium's system libraries;
- creates `server/.env`;
- starts the app.

Open **http://localhost:5173** (Vite development mode). Full instructions and troubleshooting are in [SETUP.md](SETUP.md); on Windows (PowerShell) follow [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md).

Before starting, set `DATABASE_URL` for your local PostgreSQL in `server/.env`. Setup does not install PostgreSQL or create credentials.

**Browser.** All checks and the PDFs use one browser: **Google Chrome when it is installed** (`BROWSER_CHANNEL=auto`), otherwise Playwright's Chromium. Install Chrome: Playwright's Chromium can't play MP4/H.264 video, which most video ads use. The dashboard shows which browser is in use and whether it plays MP4. If Chromium is missing, run `node server/node_modules/playwright/cli.js install chromium` from this folder; the running dashboard picks it up. When `client/dist` exists, the backend also serves the built dashboard at `http://127.0.0.1:3000/`.

| Command (this folder) | Does |
|---|---|
| `npm run app` | Everyday use: update, install/build what changed, start on port 3000 |
| `npm install` | Installs server and client dependencies, plus Chromium |
| `npm start` | Starts the API (port 3000) and the UI (port 5173) together |
| `npm run setup` / `bash setup.sh` | Full setup: checks Node, installs everything, starts the app (`--no-start` to only install) |
| `npm --prefix server test` | Server tests (see [Tests](#tests)) |

## Settings

Set in `server/.env`; see [`server/.env.example`](server/.env.example) and [SETUP.md](SETUP.md).

| Setting | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | API port (the API listens only on `127.0.0.1`) |
| `DATABASE_URL` | — | PostgreSQL connection string (required) |
| `HEADLESS` | `false` | `false` shows the browser window during checks; use `true` on a machine without a display |
| `NAVIGATION_TIMEOUT_MS` | `30000` | Max time to load a page |
| `BROWSER_CHANNEL` | `auto` | `auto`: Chrome when installed, otherwise Chromium; `chrome` or `chromium` forces one |
| `CHROME_PATH` | — | Full path to Chrome, only if it is installed somewhere unusual |
| `URL_TIMEOUT_MS` | `60000` | Max time per URL for placement and CSS checks |
| `PLACEMENT_EVENT_SETTLE_MS` | `3000` | How long to keep listening after the first `vdo:placement` event |
| `SCREENSHOT_SETTLE_MS` | `1200` | Pause before each placement screenshot |
| `SCROLL_STEP_VIEWPORT_RATIO` | `0.45` | Default scroll step, as a fraction of the screen height |
| `SCROLL_INTERVAL_MS` | `1600` | Default wait between scroll steps |
| `STICKY_URL_TIMEOUT_MS` | `180000` | Max time per URL for the sticky violation checker |
| `IMPLEMENTATION_URL_TIMEOUT_MS` | `150000` | Max time per URL for the implementation validator (load + watch + Elements) |
| `IMPLEMENTATION_LOAD_WINDOW_MS` | `10000` | `vdo.ai.js` loads within this time of the first one are the page load (TC-02); later ones are a slot refresh (TC-03) |
| `DEEP_OBSERVE_MS` | `15000` | Deep test observation time per URL |
| `DEEP_URL_TIMEOUT_MS` | `90000` | Max time per URL for the deep test |
| `DEEP_ALLOW_PRIVATE_NETWORK` | `false` | Allow deep tests on private-network pages (internal staging) |
| `MAX_CONCURRENT_JOBS` | `2` | Checks that run at the same time (1–8) |
| `MAX_PENDING_JOBS` | `20` | Checks that may be queued or running (1–200) |
| `STORAGE_DIR` | `storage` | Where screenshots and uploaded scripts are saved (relative to `server/`) |

## How it works

1. The dashboard sends the check to the API (`POST /api/placement-checks`). The API validates it and stores any uploaded code. It then admits the job into the PostgreSQL-backed queue and returns at once; the dashboard polls for progress.
2. The queue runs each job, one device after another, with the runner for its type:

   | Type | Runner | What it does per URL |
   |---|---|---|
   | `vdo.ai.js` / `style.css` | `placementRunner.service.js` (+ `deepValidation.service.js` for the deep test and refresh check) | Applies the code, waits for `vdo:placement` and the wrapper while scrolling, takes two screenshots |
   | `sticky` | `stickyRunner.service.js` with `sticky/probe.js` and `sticky/rules.js` | Walks the page through load, scroll, ad wait, small scrolls, bottom, sizes and close, then judges ST-01–ST-25 from the snapshots |
   | `implementation` | `implementationRunner.service.js` with `implementation/probe.js` and `implementation/rules.js` | Records network, logger and script elements with the cache disabled, watches the page, searches Elements, then judges TC-01–TC-13 for each tag |

3. Each finished device becomes a **run**, saved in the `custom_placement` schema. Screenshots are saved under `server/storage/screenshots/<run>/`, with SHA-256 digests in the report.
4. History reads the runs; the PDF is rendered from a run in a separate headless browser.

Every URL is limited by its type's time limit. A URL cut off by the limit is an ERROR (`timeout`), and the job goes on with the next URL.

## Project structure

```
package.json              scripts: app, install, start, setup
scripts/app.mjs           one-command start (update, install, build, run)
server/                   Express API + Playwright runners
  server.js
  src/
    config/               settings from server/.env
    routes/, controllers/ /api/... endpoints and input validation
    services/
      browser               shared Chrome/Chromium, device profiles, readiness
      jobQueue              background jobs per check type, bounded concurrency
      placementRunner       placement/CSS checks: apply code, detect placement, screenshots
      tagDiagnostics        what vdo.ai.js did on each page
      deepValidation        loads the compiled 23-case engine (deep test, refresh, safe frame)
      stickyRunner          sticky checker scenario; sticky/probe (in-page snapshot), sticky/rules (ST-01..25), sticky/guide
      implementationRunner  implementation validator; implementation/probe (Elements + script watch),
                            implementation/rules (TC-01..13, evidence text), implementation/guide (cases, units, events)
      results               saves runs to PostgreSQL and screenshots to disk
      database              durable jobs and runs, exclusive worker ownership
      scriptStore           uploaded scripts (used by Re-run)
      pdfReport             PDF reports
  tests/                  node:test suites and fixture sites (stickySite, implementationSite)
  storage/                screenshots/, scripts/ (created automatically, not in git)
client/                   React (Vite) dashboard
  src/
    components/ui/          buttons, inputs, tables, toggles …
    components/checks/      form, progress, results: ResultCard, DeepResults, StickyResults, ImplementationResults
    components/history/     history table, filters, re-run, delete, PDF
    api/, utils/            API calls, check types, verdicts, reasons, formatting
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/ready` | Database, queue, browser launch and deep engine readiness |
| GET | `/api/settings` | Default scroll settings, limits and per-URL time limits |
| POST | `/api/placement-checks` | Start a check and return a job (202; 429 when the queue is full) |
| GET | `/api/placement-checks/:jobId` | Job progress and results |
| GET | `/api/history` | List runs (`?page=&pageSize=&q=&status=&type=&mode=deep`) |
| GET | `/api/history/:runId` | One run with its results |
| GET | `/api/history/:runId/pdf` | Download the run as a PDF |
| DELETE | `/api/history/:runId` | Delete one run and its screenshots |
| DELETE | `/api/history` | Delete all runs, screenshots and stored scripts |

**Starting a check:** `POST /api/placement-checks` with JSON:

| Field | For | Value |
|---|---|---|
| `type` | all | `"vdo.ai.js"` (default), `"style.css"`, `"sticky"` or `"implementation"` |
| `domain` | all | Publisher domain, for example `"livemint.com"` |
| `tag` | all | One tag; for `implementation`, one or more separated by commas (`"v-livemint, b-livemint"`, at most 10) |
| `urls` | all | Up to 50 `http(s)` URLs |
| `devices` | all | `["desktop"]`, `["mobile"]` or both |
| `allowOtherDomains` | all | `true` to allow staging / preview URLs on another host |
| `script` / `scriptId` / `scriptName` | placement, CSS, sticky with code | The code, or the id of a stored script (Re-run) |
| `scroll` | placement, CSS | `{ "stepViewportRatio": 0.45, "intervalMs": 1600 }` |
| `deep` | placement, CSS | `true` adds the 23-case deep test and the safe frame check |
| `refreshIntervalSec` | placement, CSS | `30`, `45` or `60` adds the ad slot refresh check |
| `stickyCode` / `stickyAdditional` | sticky | `"none"`, `"vdo.ai.js"` or `"style.css"`; `true` adds ST-14 to ST-25 |
| `watchSec` | implementation | `30` (default), `45` or `60`: the TC-03 watch period |

Options that don't belong to a type are refused with a 400, for example `deep` with `sticky` or `implementation`, or several tags for a placement check.

**Filtering History:** `GET /api/history?type=sticky` or `?type=implementation`.

## Tests

```bash
npm --prefix server test
```

- **Without a database:** the unit and API tests run. They cover the sticky rules, the implementation rules (every test case, the section 8 reference examples, not-eligible handling, multi-tag pages), domain checks and request validation.
- **Database tests:** set `TEST_DATABASE_URL` to a PostgreSQL database. They use an isolated schema that is removed afterwards, and fail rather than skip when the variable is missing.
- **Real-browser tests (opt-in):** they open Chrome/Chromium against local fixture sites.
  - `STICKY_BROWSER_TEST=1` runs good, mixed and bad floating players (about 2 minutes).
  - `IMPLEMENTATION_BROWSER_TEST=1` runs good and bad video, banner and offerwall pages. `a.vdo.ai` and `analytics.vdo.ai` are served by the test, so it needs no internet (about 1.5 minutes).

  Add `HEADLESS=true` on a machine without a display.

## Limitations

- **No login.** Anyone who can reach the app can run checks and delete reports. It only listens on `127.0.0.1`, so by default only the machine it runs on can reach it.
- **Restart recovery:** queued jobs resume after a restart. Interrupted jobs are marked failed, keeping completed-device results, and the current URL is not resumed. Job polling records expire after an hour; runs stay until deleted.
- **Bot protection:** some sites block automated browsers; these show as `page_blocked`. The vdo.ai tag itself may also flag the browser (`blocked_agent`): the implementation validator's TC-05 reports that as a WARNING.
- **Ad fill varies:** `script_not_loaded` is common on sites where the ad slot doesn't always fill, because the page then never requests `vdo.ai.js`. Events such as `ad_match` depend on demand, so TC-08 may warn on one visit and pass on the next.
- **Mobile is emulated** (Pixel 7 in Chrome/Chromium). iPhone/Safari behaviour such as BlockedInline is not reproduced.
- **Implementation validator:**
  - Elements are searched in frames the browser can reach; a cross-origin frame that refuses scripting is skipped.
  - TC-12 attributes floating players across several video tags by rule, because floating players carry no tag name.
  - Each URL is visited once per device. All entered tags are judged from that one visit, each separately, which gives the same result as visiting once per tag.
- **Sticky checker:** "too early" (ST-06/07/23) is judged against the player's place in the article, because the tag's configured activation point isn't known to the tool.
