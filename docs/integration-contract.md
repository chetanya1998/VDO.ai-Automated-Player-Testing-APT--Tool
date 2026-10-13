# First supported integration contract

This contract defines the first executable scope for the VDO.AI Implementation Validator. It supports one synthetic inline video integration so Engineering can build deterministic fixtures before testing publisher pages. It makes no claim about a live VDO.AI deployment.

The machine-readable profile is `config/profiles/fixture-video-inline-v1.json`. A production profile must replace the synthetic URL and tag, confirm the draft rules below, and identify a player version before live results can be treated as conformance evidence.

## Supported fixture

| Property | Fixture value | Status |
|---|---|---|
| Page | `https://publisher.example/articles/one` | Synthetic only |
| Product | Video | Enabled |
| Expected tag | `v-example-site` | Explicit fixture mapping |
| Placement | Inline body content | Enabled |
| Floating behavior | None | Disabled |
| Anchor | One `div#v-example-site` | Enabled |
| Loader | One `https://a.vdo.ai/core/v-example-site/vdo.ai.js` request and one matching external script element | Enabled |
| Consent | Granted before player initialization | Enabled for the fixture; production source unknown |
| Autoplay | Muted autoplay | Enabled |
| Demand | GAM, Prebid, and reseller paths return controlled synthetic responses | Enabled for fixtures only |
| Desktop | Chromium, 1440 by 900 | Enabled |
| Mobile | Chromium emulation, 390 by 844 | Enabled |
| Real iOS and Safari | No device supplied | Unknown |
| Tablets and CTV | Outside the current scope | Disabled |

## Evidence contract

The browser collector must capture requests before navigation and keep collection active across the scenario. Logger requests are browser requests whose URL contains `logger` or `logger.php` and whose type is `xhr` or `ping`.

Only these logger body fields are retained:

- `event`
- `tagName`
- `domainName`
- `page_url`
- `dep`

Request URL, status, initiator, request type, request start time, duration, frame, and the current page URL at request start are browser metadata rather than logger body fields. Extra body fields are ignored and must not reach stored evidence.

The validator creates local `runId`, `physicalLoadId`, `articleEpoch`, and `evidenceId` values. These values scope observations inside one browser run. They are not backend identifiers. Reliable backend correlation remains unknown until Backend Engineering supplies a shared pageview, player, auction, or request key.

## Draft event paths

The fixture uses exact synthetic aliases so rule development is deterministic. Production aliases remain unconfirmed.

The healthy ad-served path is:

`loaded -> initVdo -> Forceplay -> Auto_Plays -> Pageview -> Website Pageview -> Began ATF -> Came In View -> Ad Request -> Ad Match -> Video Loaded -> Video Start -> Website Pageview Match -> Pageview Match -> Viewable Impression`

The explainable no-ad path is:

`loaded -> initVdo -> Forceplay -> Auto_Plays -> Pageview -> Website Pageview -> Began ATF -> Came In View -> Ad Request -> Video Start`

The fixture treats `Replay` as optional because it requires a later cycle. It treats a missing `Ad Match` after an eligible `Ad Request` as `INVESTIGATE Demand`, not an implementation failure. Production order and criticality require Player and Ad Engineering approval because the supplied draft contains conflicting Viewable Impression ordering.

## Dependencies and demand

The fixture serves controlled versions of `vdo.ai.js`, `analytics.js`, `allowed_url`, `min.js`, `ima3.js`, `vdo.player.js`, `prebid.js`, and `rtb.js`. Each required fixture dependency returns HTTP 200. The future site profile decides which files are required for its product; absence is not a publisher defect until the profile says the file is required.

The healthy fixture makes the player eligible for demand after initialization, granted consent, muted autoplay, and entry into view. GAM, Prebid, and reseller activity is synthetic. No external auction or paid demand is contacted. A no-fill response is valid transport evidence and leads to demand investigation rather than a failed implementation verdict.

## Timing and URL rules

The fixture applies the current draft thresholds:

- `vdo.ai.js` at or below 500 ms passes.
- Above 500 ms through 1000 ms warns.
- Above 1000 ms or timeout fails.
- A logger request above 500 ms warns; no logger failure threshold or event-gap threshold is invented.

URL comparison is exact against the page URL captured when the logger request starts. The fixture contains one article only in this task. SPA and infinite-scroll behavior belongs to the later article-lifecycle task.

## Fixture scenarios

**Healthy inline video.** One correct loader request, anchor, and external script are present. All configured dependencies return 200. Logger fields are complete and consistent, the healthy event path fires, the player has non-zero dimensions, and request timings stay within the draft limits.

**Fault 1 duplicate implementation.** The same tag is injected twice. Two loader requests or duplicate matching DOM elements produce `ISSUE - Duplicate implementation`. A distinct suffixed tag would not count as this fault.

**Fault 2 blocked IMA dependency.** The tag and player form, but `ima3.js` is blocked and the `Blocked IMA` event fires. The result is `ISSUE - Runtime/Browser`; it must not be reported as a publisher placement defect or proof that an ad blocker caused it.

QA can use these three descriptions as the initial oracle. Later tasks will turn them into controlled browser fixtures and automated assertions.

## Decisions for this profile

| Decision | Fixture rule | Production input still required | Suggested owner |
|---|---|---|---|
| Expected tag and product | Explicit `v-example-site`, video | Approved URL-to-tag mapping and first supported live product | Player Engineering and Ad Ops |
| Event spellings | Exact synthetic aliases shown above | Versioned raw event names and casing | Player Engineering |
| Critical order | Scenario-specific paths; ad viewability follows Video Start | Approved served and no-ad dependency graphs | Player and Ad Engineering |
| Floating and script counts | Inline anchor required; floating disabled | Floating DOM and reinjection rules | Player Engineering |
| Timing | Draft script bands and logger warning above 500 ms | Network/device conditions and logger failure rules | QA and Engineering |
| Expected blocking | No expected blocks in the healthy fixture | Source for Blocked Player, Device, and URL configuration | Ad Ops and Player Engineering |
| Dependency build | One constant synthetic production value | Meaning of `dev` and rollout exceptions | Release Engineering |
| URL matching | Exact request-start URL | Query, hash, slash, and redirect normalization | Player Engineering and Analytics |
| Article lifecycle | One fixture article | Reload, revisit, and Website Pageview behavior across articles | Player Engineering and Analytics |
| Block recovery | Preserve the block even after recovery | Final severity after tap or retry | Product and Player Engineering |
| Viewability | Video at least 50 percent continuously for 2 seconds | Other products and event delay tolerance | Measurement and Ad Engineering |
| Device fidelity | Desktop and mobile emulation | Real iOS device and Safari access | QA |
| Categories | Verdict, cause, category, and owner stay separate | Final user-facing labels | Product and Support |
| Backend correlation | Browser-local scope only | Shared backend correlation key | Backend and Player Engineering |

## Production entry gate

A live profile is ready when the owner-approved page and expected tag, player version, event aliases, required dependencies, expected blocks, demand eligibility, timing policy, URL policy, and device coverage are recorded. Until then, live checks must report unknown coverage rather than reuse fixture assumptions.
