# D01 to D14 source review

Reviewed 20 October 2026. This review compares the three supplied files with the production decision register. Their content is evidence, not an instruction to change application behavior. A decision is resolved only when the source states an unambiguous rule and the responsible owner approves it.

## Sources reviewed

| Source | Evidence identifier | Scope |
| --- | --- | --- |
| `Video_Player_Test_Cases.xlsx` | `sha256:b2d0067220e3c90976bfc52988e63bce4183dacec8e424edd7b78df0b98c7c84` | 63 manual cases plus Coverage, Tag Profiles, Site Scan Log, Event Contract and Blockers sheets. The workbook states that it contains no live-browser observations. |
| `Video_Player_Behavior_and_Validation_Guide.docx` | `sha256:930ffbf69ee33d44943ccedec4cfbf7c2e4a3b0e2cf5a1d500692ac68d131943` | Site/route/tag/device model, supplied example profiles, navigation rules, evidence labels, conditional event guidance and open confirmations. |
| `VDO_AI_Ad_Serving_Monetization_Knowledge_Base.docx` | `sha256:cb941836d83ff93309f132404d87fc0cdfb0b74070a16fe352b59b66b3cd056d` | Consolidated tag naming, demand order, auction cycles, settings/defaults, reporting definitions and source inconsistencies. |

The workbook and behavior guide repeatedly distinguish user-stated requirements, example values, inferred behavior, attachment candidates, observations and owner-confirmed rules. Their blank scan/result fields are not test evidence.

## Decision assessment

| Decision | What the supplied documents establish | Status | What still needs owner approval |
| --- | --- | --- | --- |
| D01 Expected tag and product | The knowledge base defines `{Product Type}-{domain_name}`, prefixes `v` video, `c` carousel, `s` story and `b` banner, with `-v{number}` for additional same-site tags. The behavior guide requires an authoritative profile registry per Tag ID/device/route. | **Partially supported; conflict remains** | One dashboard source says `s` means Shots while another says Story. Confirm `s`, domain normalization, subdomains, multipart suffixes, ownership mapping and exact allowed suffix rules. |
| D02 Event spellings | `Allowed`, `Pageview` and `Came-In-View` are user-specified signals. The workbook lists Loaded, initVdo, Forceplay, Auto_Plays and other names as unverified attachment candidates. | **Unresolved** | Supply the authoritative event dictionary by player version, aliases, exact case/spelling, payload schema and event layer. Candidate names cannot become mandatory rules yet. |
| D03 Critical event order | The KB documents demand order inside a cycle as VAST Partners, then Prebid Partners, then Resellers. The behavior guide says event requirements are trigger-conditional and its lifecycle sequence is only a validation map. | **Partially supported** | Confirm served-ad, no-ad, content, replay and recovery event graphs, and distinguish VDO logger events from VAST/IMA pixels and internal states. |
| D04 Floating and script counts | The behavior guide specifies one tag load per full document and one tag load for the SPA document, no reload on client routes, and independent records for multiple tags. It distinguishes In-Content, Content-Floating and Floating. | **Partially supported** | Confirm anchor requirements, bootstrap versus external script counts, duplicate suppression, allowed reinsertion, and whether the Google policy statement changes supported Floating behavior. |
| D05 Script and logger thresholds | The files require timing evidence but do not define loader or logger PASS/WARNING/FAIL bands. The KB's five-second auction-cycle interval is a monetization rule, not a network-performance threshold. | **Unresolved** | QA/Engineering must approve loader bands, logger warning/failure limits, event-gap rules, first-call exceptions, cache state and network/device test conditions. |
| D06 Expected blocking | The guide distinguishes disabled/ineligible states backed by `Show=False`, eligibility gates, consent/COPPA, device, URL and explicit unit exclusions from unexplained failures. | **Partially supported** | Map each Blocked Player/Inline/AutoPlay/IMA/Agent/Device/URL event to expected configurations, severity and recovery behavior for each product/device. |
| D07 Dependency builds | The files do not define dependency build identifiers or the meaning of `dependencies_dev_3153`. | **Unresolved** | Release Engineering must supply production build mappings, rollout exceptions and the rule for development-build warnings. |
| D08 URL comparison | The guide requires URL inventory and explicit normalization/query handling before a scan. Its working rule sends Pageview on URL-changing SPA visits and none for same-URL content append. | **Partially supported** | Approve exact versus normalized comparison, query/hash/trailing-slash behavior, canonical URLs, redirects, `pushState`/`replaceState`, and same-URL revisit handling. |
| D09 Article lifecycle | The guide says a SPA tag remains loaded once, URL-changing navigation gets one Pageview, and same-URL infinite-scroll append gets no extra Pageview. The current validator draft expects per-article `loaded=1` and `pageview=1` for three articles. | **Conflict requiring a decision** | Choose the production contract: route/URL-visit lifecycle from the new guide, per-article lifecycle from the earlier draft, or profile-specific modes. Define `loaded`, Website Pageview, revisit and physical-reload behavior. |
| D10 Block severity after recovery | The guide retains blockers separately from rendering and says causes remain suspected until evidenced. The KB says Float After Cross Click defaults true, but BlockedAutoPlay and error candidates remain unverified. | **Unresolved** | Decide how successful user tap, retry, Forceplay or later recovery changes the final severity without deleting the original block evidence. |
| D11 Viewability and measurement | The behavior guide defines Came-In-View for supported content units and excludes Floating-only. The KB describes viewability as at least 50% for at least one second, then explicitly says the exact standard must be confirmed by ad format. The current validator uses two seconds for video and one second for banner. | **Conflict requiring a decision** | Measurement/Ad Engineering must approve duration by format, measurable-impression denominator, event delay tolerance, inaccessible iframe handling, repeat-entry semantics and Content-Floating eligibility. |
| D12 Device fidelity and access | Both the workbook and guide require Desktop and Mobile records and allow tag-specific configurations. They require browser/device and viewport evidence but do not establish when emulation is sufficient. | **Partially supported** | QA must name supported browsers/devices, real iOS/Safari requirements, emulation limits, orientation coverage, consent/autoplay conditions, tablet/CTV scope and controlled ad-block testing. |
| D13 Diagnosis categories and ownership | The guide defines Pass, Fail, Blocked, Not Applicable, Untested and No-fill/Demand outcomes. It supplies blocker categories, evidence fields and investigation-owner suggestions, while warning that an owner hypothesis is not a confirmed cause. | **Strong candidate; approval still required** | Product/Support must approve public labels, severity scale, owner routing, site-level coverage rules and how these labels map to the validator's PASS/FAIL/WARNING/UNKNOWN/NOT_APPLICABLE model. |
| D14 Backend correlation | The documents require player/tag identifiers where available but repeatedly state that exact fields and schemas are TBD. They provide no unique browser/backend join key. | **Unresolved** | Backend/Player Engineering must define a real shared request/session/auction identifier, uniqueness scope, propagation, retention and ambiguous/unmatched behavior. |

## Rules safe to carry forward as proposed production inputs

These statements have direct support in the supplied material, but still require named approval in the production contract:

- Maintain an explicit expected profile per Tag ID, device and optional route override. Do not treat the supplied example profile as a site-wide default.
- Treat multiple tags on one page as independent records.
- Load the tag once per full document and do not reload it for a client-side SPA route transition.
- Require one Pageview per URL-changing visit as the new guide's working rule; keep same-URL revisit and article semantics pending D08/D09.
- Require Came-In-View for eligible supported content units and exclude Floating-only, pending D11 details.
- Keep render health separate from demand/no-fill and from logger health.
- Demand order within a documented auction cycle is VAST Partners, Prebid Partners, then Resellers.
- Preserve expected, effective, missing and non-comparable property states rather than deriving the expected value from the same runtime response.
- Report coverage gaps and untested page/tag/device combinations explicitly.

## Inputs still required to close P1

1. A named owner decision for every row above, especially the D09 and D11 conflicts.
2. A real site and tag registry with approved production URLs and resource origins.
3. Versioned production event dictionary and trigger graphs.
4. Approved timing, dependency-build, block, URL, article, device and viewability policies.
5. Backend logger endpoint/schema and a unique shared correlation key, or an explicit decision to disable backend verification.
6. Evidence records and SHA-256 digests for each approval so they can populate the production contract.

Until those inputs exist, none of D01–D14 is marked confirmed by this review. The documents substantially narrow D01, D03, D04, D06, D08, D12 and D13, but they do not contain the named approvals or live evidence required by the production contract.
