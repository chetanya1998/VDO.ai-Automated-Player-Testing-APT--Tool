# VDO.AI Automated Player Testing (APT) Tool

An automated validator for VDO.AI player integrations. The project is being built as a deterministic evidence pipeline: run a page in an isolated browser, capture what happened, apply explicit checks, and report likely root causes without inventing missing evidence.

## Current status

Tasks 01–08, 11, and 22–24 are implemented:

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
- explicit origin allowlisting for production browser runs, while unrestricted remote execution stays disabled.

Logger lifecycle, demand, viewability, and remaining product verdict rules are still pending. No approved production profile and live URL have been supplied, so this repository does not yet claim validation of a live publisher or real ad demand.

## Requirements

- Node.js 24 or newer
- pnpm
- A Chromium-based browser for the optional live smoke test

## Setup

```bash
pnpm install
pnpm typecheck
pnpm test
```

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
  --event-rules "config/production-event-rules.json"
```

The report command requires a `production` profile, confirmed event aliases, a confirmed timing policy, and confirmed event rules for the same profile. The target must appear exactly in `site.approvedUrls`. List every required page, player, logger, and CDN origin in `site.approvedResourceOrigins`; requests to any other origin are blocked and recorded. Output files are created once and never overwritten.

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
src/profile.ts          Deterministic profile snapshots
src/profile/            Approved site/tag/product identity resolution
src/rules/              Deterministic evidence-backed validator rules
src/contracts.ts        Runtime-validated shared contracts
src/report/             Versioned deterministic report assembly
src/cli.ts              Profile validation and real-page report CLI
tests/fixtures/         Synthetic publisher pages and mock endpoints
tests/                   Contract, fixture, and runner checks
```

## Safety boundary

The runner installs a browser-context route before navigation and permits only origins explicitly named by the selected profile. Remote runs require a production profile. Unrestricted remote execution is disabled; WebSocket controls, DNS controls, authentication, and deployment network policy remain scheduled for Task 20.

The synthetic fixtures never contact live advertising demand. They are development inputs, not publisher conformance evidence.

## Development roadmap

The detailed execution order, case coverage, decisions, and current handoff are in [`docs/plan/STATUS.md`](docs/plan/STATUS.md) and [`docs/plan/TASKS.md`](docs/plan/TASKS.md). The plan maps all 23 supplied validator cases into 29 executable tasks.

The next implementation task is Task 29: classify blocked events and dependency failures.

