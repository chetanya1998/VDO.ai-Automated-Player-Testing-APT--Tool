# VDO.AI Automated Player Testing (APT) Tool

An automated validator for VDO.AI player integrations. The project is being built as a deterministic evidence pipeline: run a page in an isolated browser, capture what happened, apply explicit checks, and report likely root causes without inventing missing evidence.

## Current status

Tasks 01–05 are implemented:

- strict TypeScript contracts for runs, profiles, article epochs, evidence, checks, and reports;
- a fixture-only integration profile;
- twelve local synthetic publisher scenarios covering healthy and broken player behavior;
- a bounded Playwright Chromium runner with isolated contexts, navigation and total deadlines, partial observations, cleanup, and crash classification;
- structured browser evidence for requests, responses, failures, logger payloads, console errors, frames, player references, and bounded screenshots;
- credential and query-value redaction, approved response-body limits, distinct evidence IDs, and explicit collection gaps;
- a loopback-only URL policy that keeps unrestricted remote execution disabled.

Versioned logger validation, browser evidence normalization, and product verdict rules start in Task 22. This repository does not yet claim validation of a live publisher or real ad demand.

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

The normal test suite uses controlled Playwright-compatible browser objects and the local HTTP fixture server. To run the additional live Chromium smoke test, provide an installed Chromium executable:

```powershell
$env:VDO_VALIDATOR_BROWSER = "C:\Program Files\Google\Chrome\Application\chrome.exe"
pnpm test
```

## Repository structure

```text
config/profiles/        Fixture-only execution profile
docs/                   Integration contract and implementation plan
src/browser/            Bounded browser runner, evidence capture, and URL policy
src/contracts.ts        Runtime-validated shared contracts
src/cli.ts              Profile validation CLI
tests/fixtures/         Synthetic publisher pages and mock endpoints
tests/                   Contract, fixture, and runner checks
```

## Safety boundary

The current runner accepts explicit `127.0.0.1` and `[::1]` origins only. It installs a browser-context request route before navigation and blocks requests outside the approved fixture origin. Production remote execution, WebSocket controls, DNS controls, authentication, and deployment policy remain scheduled for Task 20.

The synthetic fixtures never contact live advertising demand. They are development inputs, not publisher conformance evidence.

## Development roadmap

The detailed execution order, case coverage, decisions, and current handoff are in [`docs/plan/STATUS.md`](docs/plan/STATUS.md) and [`docs/plan/TASKS.md`](docs/plan/TASKS.md). The plan maps all 23 supplied validator cases into 29 executable tasks.

The next implementation task is Task 22: parse and validate browser logger payloads.

