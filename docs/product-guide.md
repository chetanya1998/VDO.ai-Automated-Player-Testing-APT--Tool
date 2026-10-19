# APT Tool product guide

## Purpose

The VDO.AI Automated Player Testing Tool helps teams understand whether a player integration is installed correctly, whether it progresses through its expected lifecycle, and where a supported failure first appears.

This work often requires several people to inspect the page, browser console, network calls, player events, ad responses, layout, and device behavior. The tool brings those observations into one repeatable workflow and preserves the evidence behind every conclusion.

The product is an investigator and validator. It assigns a cause only when captured evidence supports that relationship.

## Product outcome

For each run, the user receives:

- a clear status for all 23 test cases;
- expected and observed behavior;
- evidence references supporting the result;
- the first supported failure in a dependent chain;
- a likely category and suggested owner;
- known limitations and missing coverage;
- a chronological evidence timeline;
- a downloadable JSON or offline HTML report.

This allows QA to repeat checks, Support to shorten investigation, Ad Operations to verify configuration, and Engineering to reproduce supported failures.

## End-to-end user journey

### 1. Prepare an approved profile

An administrator defines the page URLs, resource origins, expected tags, products, placements, devices, article actions, timing bands, event rules, dependencies, expected blocks, demand behavior, auction behavior, visibility rules, and probable-cause rules.

The profile is versioned. A result belongs to the exact profile and rule versions used during the run.

### 2. Submit a validation

The user signs in to the dashboard with a team-scoped token. They select an approved URL, profile, device, and either a single run or bounded batch.

The application rejects unsupported URLs, invalid profiles, oversized batches, and production runs that lack current deployment acceptance.

### 3. Observe the page

A fresh browser context opens the page. The runner records allowed network activity, logger payloads, DOM state, player references, layout and visibility samples, page transitions, and bounded artifacts. It observes the page only for the configured period and closes the browser after success, timeout, or failure.

### 4. Evaluate the evidence

Versioned rules assess the evidence. Checks remain separate from diagnoses: a missing event may be caused by an earlier missing dependency, so the report highlights the earliest supported problem rather than presenting every later symptom as an independent root cause.

### 5. Review the result

The dashboard shows status, elapsed time, verdict totals, case coverage, probable causes, artifacts, and a filterable timeline. The user can export the same bounded information in JSON or offline HTML.

### 6. Assign and follow up

The suggested owner helps route a supported finding. Examples include Publisher Implementation, Player Engineering, Ad Operations, Demand, Measurement, or Runtime/Browser. The suggestion is evidence-based guidance rather than automatic proof of fault.

## Understanding results

`PASS` means sufficient evidence met the configured requirement. `FAIL` means sufficient evidence contradicted it. `WARNING` highlights a provisional or non-fatal risk. `UNKNOWN` means the application cannot make a supported decision. `NOT APPLICABLE` means the selected scenario does not require that behavior.

The application keeps diagnostic category separate from verdict. For example:

- a valid no-fill can pass transport checks while producing a Demand investigation;
- an expected autoplay block can recover after a user tap;
- a hidden formed player can point to publisher CSS while an unformed player can point to an earlier runtime failure;
- a missing server record cannot be confidently correlated from timing or URL resemblance alone.

## Functional areas

### Integration identity

The product checks the expected tag, product, domain, suffix, anchor, and script identities. It supports legitimate multiple-tag pages and avoids treating a different approved tag as a duplicate.

### Browser and network evidence

The controlled browser records relevant requests, responses, failures, initiators, durations, logger payloads, console errors, frames, page URLs, screenshots, and bounded response bodies. Sensitive values are removed before evidence is retained.

### Logger lifecycle

The validator preserves raw event names and applies approved aliases. It checks complete served-ad and explainable no-ad flows, required events, event counts, event-specific prerequisites, blocked events, error codes, and event fields.

### Demand and auction behavior

The product can inspect bounded captured VAST, GAM, Prebid, and reseller responses. It distinguishes a missing request, transport failure, malformed response, no-fill/no-bid, wrapper issue, dependency timeout, missing fallback, and refresh-policy violation. It does not follow arbitrary wrapper URLs outside the protected browser.

### Layout and viewability

The runner measures player geometry, viewport overlap, ancestor layout, clipping, occlusion samples, transforms, and fixed, sticky, or floating changes. It distinguishes player formation from CSS obstruction and measures continuous exposure for configured video or banner rules.

### Articles and SPA behavior

The application keeps physical page loads separate from logical article changes. It follows approved click or scroll actions through at least three distinct articles and checks event-time URLs and per-article loaded/Pageview lifecycles.

### Devices

Named desktop and mobile profiles record browser, operating system, viewport, touch behavior, consent, autoplay policy, block exercises, and playback after tap. Real iOS/Safari evidence must be imported for claims that Chromium emulation cannot prove.

### Reports and probable-cause analysis

Reports contain all test cases, evidence references, profile and rule versions, environment details, timings, limitations, first failure, probable cause, suggested owner, and next checks. The analysis groups dependent symptoms under the earliest supported cause while retaining independent demand or configuration findings.

### Optional backend and AI extensions

Backend logger records may be collected with an approved credential. A high-confidence join requires a confirmed shared identifier; page URL, event name, tag, and timing are context only.

AI explanations are opt-in and use selected redacted findings and evidence. They cannot change results, create evidence, or replace deterministic rules.

## Test case groups

| Group | Cases | Question answered |
| --- | --- | --- |
| Installation | TC-1, TC-3, TC-13, TC-18 | Is the correct tag installed once and in the correct place? |
| Performance and logging | TC-2, TC-4–TC-7, TC-15, TC-20 | Did the player and logger run with the required events, counts, fields, and timing? |
| Advertising | TC-9, TC-10 | Did eligible demand start, and where did the ad chain stop? |
| Runtime dependencies | TC-11, TC-12, TC-19 | Was the player blocked, did required files load, and was the build consistent? |
| Layout and measurement | TC-8, TC-14 | Did the player form and become viewable without being hidden or clipped? |
| Device behavior | TC-16 | Does the integration work for the required desktop and mobile conditions? |
| Page and article identity | TC-17, TC-21–TC-23 | Do payload identity and lifecycle remain correct across article transitions? |

The complete case-by-case descriptions are in the repository [README](../README.md#the-23-test-cases).

## Batch validation

A batch expands approved URLs and devices into independent run items. Each item has its own admission decision, deadline, status, report, and export. One rejection or timeout does not erase successful items. The batch summary reports accepted, rejected, terminal, device-complete, and case-complete counts.

The current bounds are up to 25 target URLs, up to four enabled devices, and no more than 50 expanded URL/device items.

## Access and privacy

Each configured bearer token belongs to one user and team. Run lists, status, reports, artifacts, and batch results are team-scoped. Unknown or cross-team identifiers are not revealed.

The tool redacts credentials and sensitive query values, limits retained response bodies, confines artifacts to an approved root, and rejects unapproved network destinations. Offline exports escape page-controlled text and retain safe artifact references.

## Product architecture in plain language

The dashboard is the front door. The API checks who the user is and whether the requested test is allowed. PostgreSQL stores job and result records. A worker coordinates each job. A separate browser service visits the page without holding internal secrets. The rule engine converts observations into test results. Artifact storage retains bounded evidence. An optional collector accesses authorized backend logs with a credential that the browser never receives.

This separation is essential because publisher pages are external content. A compromised page must not gain access to the validator database, team tokens, artifacts, backend logger credentials, host system, or deployment platform.

## Deployment approach

### Internal fixture stage

The first Coolify stage hosts the dashboard/API, PostgreSQL, and artifact storage. It proves routing, authentication, migrations, persistence, health checks, backup restoration, and fixture reports. It does not open arbitrary publisher URLs.

### Production stage

The production stage adds a continuous queue worker, isolated browser service, and trusted logger collector as separate workloads. The browser runs on a separate host with strict egress rules and no internal credentials. Production admission remains closed until the actual deployment passes isolation, egress, cleanup, authorization, backup, recovery, monitoring, and canary checks.

The operator procedure, server layout, variables, firewall rules, rollout, rollback, and acceptance checklist are in the [Coolify self-hosting plan](coolify-self-hosting.md).

## Development roadmap

### Completed locally

- requirements, profiles, shared data contracts, and controlled fixtures;
- bounded Chromium runner and evidence capture;
- all TC-1 through TC-23 rule implementations;
- event, timing, block, dependency, demand, auction, visibility, device, and article policies;
- deterministic reporting and probable-cause analysis;
- PostgreSQL persistence and leased queue processing;
- authenticated API and responsive dashboard;
- report exports and bulk validation;
- optional backend logger, exact correlation, and AI explanation modules;
- application-level network hardening, health checks, artifact confinement, and production admission gate;
- pilot manifest, readiness validation, metric calculation, and release gates.

### Required before the internal hosted stage

- configurable API container bind address;
- production Node 24 container image;
- Coolify PostgreSQL and artifact volumes;
- deployed health, authentication, persistence, backup, and restore checks.

### Required before live publisher execution

- long-running production worker process;
- separate authenticated browser service;
- isolated browser host and proven network controls;
- trusted logger collector for optional backend verification;
- production secrets, monitoring, limits, retention, and rollback configuration;
- deployment acceptance bound to the exact browser image, profiles, and origins;
- one approved live canary.

### Required before product release

- approved production profiles and rule decisions;
- QA-owned labeled healthy and fault corpus;
- real mobile and real iOS evidence;
- measured concurrency and cost source;
- completed observations for the mandatory case manifest;
- precision, recall, false-positive, completeness, latency, evidence-quality, and cost gates;
- reviewed disagreements with assigned follow-up owners.

## What remains unverified

The code has deterministic and integration checks, but the product has not been evaluated against the required real pilot inputs. No claim is currently made for live publisher accuracy, time saved, production scale, real-iOS behavior, real demand-provider coverage, or backend correlation.

Several production rules remain owner decisions: approved tag mapping, event aliases and order, floating placement, timing thresholds, expected blocks, dependency builds, URL comparison, article lifecycle, block recovery, viewability rules, device fidelity, diagnosis ownership, and backend correlation identity.

These limits are deliberate. A trustworthy validator must show where its evidence ends.

## Operating ownership

| Area | Primary owner |
| --- | --- |
| Approved profiles and tag/domain mapping | Ad Operations and Player Engineering |
| Event aliases, lifecycle, dependencies, and block policy | Player Engineering |
| Timing thresholds and labeled corpus | QA and Engineering |
| Browser isolation, secrets, backups, monitoring, and deployment | Platform/SRE |
| Viewability policy | Measurement and Ad Engineering |
| Real-device evidence | QA |
| Release decision and user-facing labels | Product |
| Incident triage and publisher communication | Support with the suggested technical owner |

## Success criteria

The product is ready for broader use only when:

1. the production architecture passes deployment acceptance;
2. every enforced rule has an approved owner and version;
3. the labeled corpus represents healthy, faulty, desktop, mobile, article, demand, and boundary scenarios;
4. pilot metrics pass the documented release gates;
5. reports consistently cite sufficient evidence and expose gaps;
6. backup, restoration, rollback, cleanup, and on-call alerts have been proven;
7. a controlled live canary succeeds without leaking credentials or sensitive evidence.
