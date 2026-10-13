# Player implementation validator and RCA plan

Cover all 23 test cases in the supplied VDO.AI Implementation Validator document through 29 small implementation tasks. Start with a browser-observed validator, then add the dashboard and original RCA extensions. This revision is dated 13 October 2026. Planning is complete; product implementation and test execution have not started.

## Start here

Read [CASE-COVERAGE.md](CASE-COVERAGE.md) for the case-to-task mapping and acceptance scenarios. [TASKS.md](TASKS.md) gives the executable order. Each task points to only its relevant cases. [DECISIONS.md](DECISIONS.md) captures draft rules that must be confirmed before production enforcement. [WORKFLOW.md](WORKFLOW.md) supplies the compact implementation prompt.

## What changed

The requirements now include exact logger payload fields, configured tag/domain identity, timing boundaries, floating-unit exceptions, blocked-event categories, detailed CSS/viewability checks, desktop/mobile execution, and three-article SPA/infinite-scroll testing. Bulk URL runs from the source build plan are also included. Mobile coverage is required; tablets and CTV remain later phase.

Browser requests provide the logger payloads needed for TC-1 through TC-23. Backend logger API access is needed only for the original brief's additional server verification. The source contains five payload fields, not a globally unique backend correlation key. Do not block the browser validator on unavailable backend access or claim a reliable backend join from URL proximity.

## Scope and architecture

Proposed stack: TypeScript, Node.js, Playwright, React and PostgreSQL. Start with CLI plus local JSON reports. Add one API, one worker and a PostgreSQL job table after collection and rules are reliable. Store diagnostic artifacts separately from database rows. Use a versioned profile for expected tags, product, floating mode, placement, device, consent, event aliases, required files, demand eligibility and thresholds.

Flow: URL and profile → browser evidence → five-field logger parser → article/tag scoping → deterministic rules → first supported failure and probable RCA → report. Optional backend verification and optional AI explanation enrich that report.

Playwright supplies browser network observation and isolated sessions; process and egress isolation are separate deployment requirements. See its official [network](https://playwright.dev/docs/network) and [isolation](https://playwright.dev/docs/browser-contexts) documentation. Only controlled fixtures are used before the runner's deployment controls are verified.

The logger body allowlist is event, tagName, domainName, page_url and dep. Ignore unrelated body fields. Keep request type, status, initiator, start time, duration, frame, event-time URL and local run/article identity as separate browser metadata. Preserve raw event names and original sequence; explicit aliases establish semantics. Collect DOM evidence throughout the run even though the diagnostic report presents DOM checks after logger checks.

All 23 cases are required for the supported profiles. Implement v/c/s/b identity handling and the stated video/banner viewability rules; other product-specific behavior needs confirmed profiles. A video-only validated pilot cannot be described as complete coverage of every product. No case becomes silently optional because its input or device is unavailable.

## Delivery milestones

| Milestone | Task order | Demonstrable result |
|---|---|---|
| A Browser and payload foundation | 01, 02, 03, 04, 05, 22, 23, 06, 07, 24, 08 | Tag/load/duplicates/logger presence/DOM checks, payload sanity and measured timing in a CLI report |
| B Lifecycle and diagnosis | 11, 29, 12, 13, 25, 26, 27, 14 | Event/count/block/dependency/ad checks, CSS/viewability, three-article transitions and desktop/mobile coverage |
| C Internal product | 15, 16, 17, 18, 28, 20, 21 | Authenticated dashboard, evidence/export, bounded URL batches and measured pilot |
| D Original RCA extensions | 09, 10, 19 | Backend verification with confirmed identifiers; optional AI explanation |

Milestone A is a partial prototype, not completion of all 23 cases. Task IDs are stable, so the execution order is intentionally not numeric. Dependencies in each card are authoritative. Original auction-precedence work remains in task 13; the new cases refine rather than erase the original RCA scope. Backend verification remains planned but is not a gate for browser-only coverage. AI can be deferred without weakening deterministic results.

Aim for one focused session per card. Split a card if implementation exposes unrelated work; do not bundle the entire milestone into a single prompt. Re-estimate effort after milestone A rather than treating task count as a calendar commitment.

## Verdict and evidence contract

Each check records its TC ID, PASS/FAIL/WARNING/UNKNOWN/NOT_APPLICABLE, expected and observed values, evidence references, tag, article epoch, device, rule version, category and suggested owner. Execution status and completeness are separate. Missing coverage is UNKNOWN; a confirmed non-applicable requirement has an explicit reason. A partial report cannot become an all-clear.

Present the source lifecycle: tag → script load → duplicates → logger → blocks/errors → DOM/player → timing → final result. Retain the earliest supported failure and related downstream symptoms. Later success never erases earlier failures; independent faults can coexist. Preserve Implementation, Runtime/Browser and INVESTIGATE Demand distinctions. Expected policy blocks warn. No-fill alone is not an implementation failure. Missing configuration does not establish publisher blame.

Pageviews and duplicates are scoped by run, tag and article epoch. Track physical page load separately from virtual article transitions. Compare each payload page_url to the URL at request start, not the final URL after the run. The draft requires one loaded and one pageview for every new article/tag; confirm logical reinitialization versus physical script reload and revisit rules before hard failures on live pages.

Reports include URL, tag, article, device/browser/OS, timestamp, every case and its reason, event timeline, blocked/error codes, initiator-file duration, slow logger calls, first failing step, suggested owner, and screenshot or sanitized HAR evidence. Public links are deferred; exports and stored artifacts use the same access controls as the dashboard.

## Inputs and unresolved rules

The new document supplies test definitions and a sample payload. It does not supply approved test URLs, complete event aliases, confirmed timing policies, expected-block configuration, all product profiles or unique backend identifiers. Obtain these from QA/Ad Ops, player engineering and backend engineering as appropriate. Use [DECISIONS.md](DECISIONS.md) as the short decision list.

The key draft conflicts are explicitly preserved: floating units have no anchor; the sample ad flow disagrees with the detailed playback/viewability order; exactly 500 ms is within a <=500 ms limit; the meaning of a dev dependency name is unconfirmed; and URL normalization plus SPA reload semantics are open. These require rule decisions, not assumptions hidden in code.

## Runtime and release targets

Keep the five-minute target per admitted URL/device/scenario run, with queue time included. Proposed budget: queue 15 s, setup/navigation 30 s, observation 120 s, optional logger completion 60 s, rules 15 s, optional AI 30 s, report 15 s, reserve 15 s. Enforce a 300-second cap and emit incomplete results on timeout. A three-article scenario that cannot complete in its window remains incomplete. The complete desktop/mobile matrix and URL batch have separately reported elapsed times; do not imply they all finish in five minutes.

Use CASES.json as the pilot manifest. For every applicable TC, retain positive and faulty/boundary scenarios, run the desktop/mobile profiles and record hardware/emulation distinctions. Include expected blocks, no fill, multiple tags, URL transitions, stale payloads and timing boundaries. Real iOS claims require real evidence. Add original auction and backend tests when those features are enabled.

Proposed release gates: every finding cites evidence; no false critical failures in the healthy corpus; seeded critical faults detected; ambiguous evidence remains UNKNOWN; no cross-article/tag/session joins; all supported-profile TC scenarios accounted for; relevant draft rules confirmed; access/redaction/egress checks pass; and p95 submission-to-report <=300 seconds under declared load. Publish diagnosis completeness, false positives, precision/recall, unresolved device gaps and matrix/batch duration. The source's screenshot descriptions are examples, not measured pilot results.

Reducing the original two-to-three-hour baseline to five minutes would imply about 95.8–97.2% less elapsed time. This remains a target, not a validated saving.

## Token and cost discipline

Load CONTEXT.md, STATUS.md, one task card, its mapped case rows and only relevant decision rows. Inspect code and callers as needed; avoid reloading the whole specification. Run focused checks and write a short handoff. Compare actual accepted work and token usage rather than promising a saving percentage.

The product's rule engine needs no LLM. Optional AI receives bounded redacted findings and selected evidence, not raw page content or complete HAR files. Initial proposed budgets remain 4,000 input tokens, 800 output tokens and 30 seconds; deterministic results survive any model failure.

Ponytail's six skills were installed previously from [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail). This revision makes no installation changes. Load tests, tablets/CTV, automatic remediation, recurring monitoring, learned failure models and public sharing remain deferred.
