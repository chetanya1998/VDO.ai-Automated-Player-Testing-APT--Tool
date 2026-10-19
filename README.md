# VDO.AI Automated Player Testing (APT) Tool

An automated validator for VDO.AI player integrations. The project is being built as a deterministic evidence pipeline: run a page in an isolated browser, capture what happened, apply explicit checks, and report likely root causes without inventing missing evidence.

## Current status

Tasks 01–08, 11–18, 22–29 are implemented:

- strict TypeScript contracts for runs, profiles, article epochs, evidence, checks, and reports;
- a fixture-only integration profile;
- twelve local synthetic publisher scenarios covering healthy and broken player behavior;
- a bounded Playwright Chromium runner with isolated contexts, navigation and total deadlines, partial observations, cleanup, and crash classification;
- structured browser evidence for requests, responses, failures, logger payloads, console errors, frames, player references, and bounded screenshots;
- credential and query-value redaction, approved response-body limits, distinct evidence IDs, and explicit collection gaps;
- five-field logger parsing with versioned aliases, field diagnostics, and physical-load dependency consistency;
- deterministic profile snapshots and normalized evidence with retained duplicates, raw artifact references, timing, article scope, and separate player instances;
- explicit site/domain/tag/product mappings with supported suffix variants, multiple-tag identities, and unverified candidate suggestions;
- evidence-backed loader, per-tag duplicate, anchor, external/bootstrap script, DOM placement, floating, and lifecycle checks;
- draft cold-cache script timing bands plus logger request-duration and raw event-gap measurements;
- TC-4 logger presence/status checks and a schema-versioned JSON report containing all TC-1 through TC-23 outcomes, evidence, coverage, verdict counts, and separate execution errors;
- versioned TC-5/6/7/9/22 lifecycle, required-event, pageview-count, eligible-ad-request, and per-article count rules for served and no-ad paths;
- versioned TC-11/12 expected-block, error-code, event-window, and product-specific dependency rules that preserve recovery/failure evidence without inferring an ad blocker;
- bounded VAST XML plus GAM, Prebid, and reseller response adapters with TC-9/10 initiation, no-fill, deadline, wrapper-chain, and first-gap classification;
- versioned auction-cycle rules for configured parallel stages, waterfalls, dependency timeouts, required fallbacks, and refresh intervals, reported through TC-10 with the violated policy version and evidence;
- bounded event-time and interval visibility samples with geometry, CSS ancestors, clipping, occlusion, transforms, and fixed/sticky transitions, plus TC-8/10/14 rules for formation and continuous exposure;
- confirmed-policy click/scroll article transitions, main-frame full and same-document URL epochs, request-start strict URL attribution, per-article/tag loaded and Pageview counts, article-wide Website Pageview limits, and three-distinct-article coverage for TC-7/17/21/22/23;
- sequential named desktop/mobile matrix execution with viewport and CSS measurements, touch emulation, recorded playback taps, TC-16 block coverage, explicit real-iOS gaps, and attributable iOS/Safari evidence import;
- deterministic RCA ranking that groups dependent symptoms under the earliest supported failure, retains independent demand/configuration findings, cites every cause, and separates confidence, category, owner suggestion, and next checks;
- a verified PostgreSQL migration, bounded queue store and single-job lease worker for profile/run state, partial reports, evidence metadata, findings and external artifact references;
- a loopback-only authenticated run API with team-scoped create, list, status, report and artifact access plus persisted idempotency;
- a responsive local dashboard for fixture submission, bounded status polling, team history, health and RCA summaries, TC-1 through TC-23 coverage, authenticated artifacts, and a filterable evidence timeline;
- authenticated redacted JSON and self-contained offline HTML technical-report exports with all persisted checks, evidence summaries, findings, timings, environment/profile versions and safe artifact references;
- authenticated bounded URL/device batches with persisted mixed admission results, independent run deadlines, explicit retries, per-item report links and aggregate case/device completeness;
- an optional deadline-bounded backend logger client with scoped bearer authentication, cursor pagination, rate-limit handling and ingestion watermark metadata; live access and correlation remain unverified;
- explicit origin allowlisting for production browser runs, while unrestricted remote execution stays disabled.

Remaining product verdict rules are still pending. No approved production profile, live URL, real demand capture, confirmed auction order, live viewability capture, confirmed device/article policies, or real-iOS evidence has been supplied, so this repository does not yet claim validation of a live publisher or advertising provider.

## Requirements

- Node.js 24 or newer
- pnpm
- A Chromium-based browser for the optional live smoke test
- PostgreSQL for Task 15 migration and queue integration tests

## Setup

```bash
pnpm install
pnpm typecheck
pnpm test
```

Copy your local PostgreSQL connection strings into ignored `.env.local`, export them into the process, then apply the migration with `DATABASE_URL` or run the real queue acceptance suite with `TEST_DATABASE_URL`. See [PostgreSQL persistence and worker](docs/persistence.md). Tests skip those database cases when no disposable PostgreSQL database is configured.

Start the authenticated local API with `pnpm api` after setting `DATABASE_URL`, `VDO_VALIDATOR_API_IDENTITIES`, and `VDO_VALIDATOR_ARTIFACT_ROOT`, then open `http://127.0.0.1:8787/`. See [Local authenticated run API](docs/api.md), [Local validation dashboard](docs/dashboard.md), and [Bounded URL batches](docs/batches.md).

Validate the fixture profile:

```bash
pnpm validate:fixture-profile
```

Generate a report from a real approved page:

```powershell
pnpm report -- "https://approved.example/article" "config/profiles/production.json" "reports/run.json" `
  --browser "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --aliases "config/production-event-aliases.json" `
  --timing "config/production-timing.json" `
  --event-rules "config/production-event-rules.json" `
  --runtime-policy "config/production-runtime-policy.json" `
  --demand-policy "config/production-demand-policy.json" `
  --auction-rules "config/production-auction-rules.json" `
  --visibility-policy "config/production-visibility-policy.json" `
  --article-policy "config/production-article-policy.json" `
  --device-policy "config/production-devices.json" `
  --rca-rules "config/production-rca-rules.json"
```

The report command requires a `production` profile plus confirmed event aliases, timing, event rules, runtime policy, demand policy, auction rules, visibility, article, device, and RCA policies for that profile. Article actions are limited to configured clicks or scrolls, must remain on the target origin, and wait for an exact expected URL. The target must appear exactly in `site.approvedUrls`. List every required page, player, logger, and CDN origin in `site.approvedResourceOrigins`; requests to any other origin are blocked and recorded. Demand parsing uses captured bounded bodies and never follows wrapper URLs. Visibility is sampled during the observation window and at logger-request time. Output files are created once and never overwritten.

Run both enabled desktop and mobile profiles with `pnpm matrix --` using the same options and an output directory in place of the report file. It creates one complete TC-1 through TC-23 report per device and `matrix.json`. See [desktop, mobile and real-iOS validation](docs/device-validation.md) for the hardware evidence procedure and `--real-device-evidence` format.

After collecting the agreed QA-labeled corpus, calculate the pilot metrics and release gates with `pnpm pilot:evaluate -- observations.json results.json`. See [Pilot release results](docs/pilot-results.md) and [Pilot support runbook](docs/support-runbook.md). The current corpus is empty, so no accuracy, latency or release claim is made.

Legacy regression tests still use the earlier development fixtures and browser harness. The report command rejects fixture-only profiles, and fixture results are not accepted as product evidence. To run the optional real-browser regression smoke test, provide an installed Chromium executable:

```powershell
$env:VDO_VALIDATOR_BROWSER = "C:\Program Files\Google\Chrome\Application\chrome.exe"
pnpm test
```

## Repository structure

```text
config/                 Fixture-only profiles, event aliases, and site identity mappings
docs/                   Integration contract and implementation plan
src/browser/            Bounded browser runner, evidence capture, and URL policy
src/evidence/           Deterministic capture normalization
src/logger/             Five-field browser logger payload parsing
src/logger/client.ts    Optional bounded backend logger collection
src/profile.ts          Deterministic profile snapshots
src/profile/            Approved site/tag/product identity resolution
src/rules/              Deterministic evidence-backed validator rules
src/rca/                Evidence-backed probable-cause ranking
src/contracts.ts        Runtime-validated shared contracts
src/report/             Versioned deterministic report assembly
src/pilot/              Pilot metrics and release-gate evaluation
src/store.ts             PostgreSQL run, evidence and queue persistence
src/worker.ts            Single-job leased worker
web/                     Responsive run dashboard and evidence timeline
db/migrations/           Versioned PostgreSQL schema
src/cli.ts              Profile validation and real-page report CLI
tests/fixtures/         Synthetic publisher pages and deterministic local endpoints
tests/                   Contract, fixture, and runner checks
```

## Safety boundary

The runner installs HTTP and WebSocket routes before navigation, permits only profile origins, rejects remote hosts that resolve to non-public IPv4 or IPv6 addresses, pins resolved address sets for the run, and removes backend credentials from the Chromium environment. Remote runs require a production profile. Unrestricted remote execution remains disabled because the required separate browser network namespace and deployed egress tests are not available. See [Internal pilot operations](docs/operations.md).

The synthetic fixtures never contact live advertising demand. They are development inputs, not publisher conformance evidence.

## Development roadmap

The detailed execution order, case coverage, decisions, and current handoff are in [`docs/plan/STATUS.md`](docs/plan/STATUS.md) and [`docs/plan/TASKS.md`](docs/plan/TASKS.md). The plan maps all 23 supplied validator cases into 29 executable tasks.

Task 21 measurement tooling and its mandatory CASES manifest are implemented, but the release decision is blocked by the missing labeled corpus, confirmed decisions and Task 20 deployment acceptance.

