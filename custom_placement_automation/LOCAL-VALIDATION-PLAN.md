# Local validation delivery — 22 October 2026

Source: the original implementation-validator catalogue at [CASES.json](../docs/plan/CASES.json), TC-1 through TC-23. These are the 23 requested cases; the later 63-row workbook is additional scenario coverage.

## Case map

Paths below are existing source modules under the repository's root src/ directory. They are reuse candidates, not validators already connected to this imported application. Every case below is **not yet integrated or executed in custom_placement_automation**. Existing placement PASS results must never count as these 23 cases.

| Case | Requirement | Existing module to connect |
| --- | --- | --- |
| TC-1 | Correct tag and vdo.ai.js loading | rules/integration.ts |
| TC-2 | Load time of vdo.ai.js | rules/timing.ts |
| TC-3 | Tag loads only once | rules/integration.ts |
| TC-4 | Logger requests are firing | rules/logger-presence.ts |
| TC-5 | Logger event sequence | rules/events.ts |
| TC-6 | Individual event checks | rules/events.ts |
| TC-7 | Pageview counts | rules/events.ts; rules/articles.ts |
| TC-8 | ATF BTF and Came In View | rules/viewability.ts |
| TC-9 | Ad request | rules/events.ts; rules/demand.ts |
| TC-10 | Ad serving chain and viewable impression | rules/demand.ts; rules/viewability.ts |
| TC-11 | Blocked events and errors | rules/blocked.ts |
| TC-12 | Dependency loading | rules/dependencies.ts |
| TC-13 | DOM check | rules/integration.ts |
| TC-14 | Player formation and CSS layout | rules/layout.ts |
| TC-15 | Timing of logger events | rules/timing.ts |
| TC-16 | Device coverage | rules/devices.ts |
| TC-17 | Payload consistency | rules/articles.ts; logger/browser-payload.ts |
| TC-18 | Tag to domain match | profile/tag-identity.ts |
| TC-19 | Dependency build check | logger/browser-payload.ts |
| TC-20 | Event name and field sanity | logger/browser-payload.ts |
| TC-21 | Current article URL equals logger page_url | rules/articles.ts |
| TC-22 | loaded and pageview once per article URL | rules/articles.ts; rules/events.ts |
| TC-23 | Infinite scroll and SPA scenario | rules/articles.ts |

## Executable chunks

1. **Local execution foundation (implemented in this change):** PostgreSQL jobs/reports, one worker per database schema, bounded admission, sequential devices within each job, restart recovery, retained completed-device results, screenshot hashes, loopback-only server, request validation and readiness endpoint. Legacy reports.json is imported once without modifying the source file. Queued jobs resume; interrupted jobs fail explicitly instead of being replayed.
2. **Real evidence and production observation mode:** add a mode that uses the publisher's scripts without replacement, captures bounded sanitized network/logger records before navigation, and ties evidence to request-time URLs and DOM snapshots. Keep existing JS/CSS custom-code modes available and label their evidence as modified-code tests. Add browser launch checks, cancellation, per-URL durable checkpoints and evidence retention. A readiness file check does not prove successful Chromium launch.
3. **Installation/layout cases:** connect TC-1–3, TC-12–14 and TC-18. Respect the observed NDTV placeholder replacement and deferred bootstrap; do not enforce universal anchor counts from one page.
4. **Logger/demand cases:** connect TC-4–11, TC-15, TC-17, TC-19 and TC-20. Preserve raw events and approved aliases; unsupported policy or incomplete capture stays UNKNOWN. No-fill is distinct from broken implementation.
5. **Device/article cases:** connect TC-16 and TC-21–23, retaining request-time article scope and requiring real transitions. Chromium mobile emulation is labelled as emulation; it cannot certify real iOS/Safari.
6. **Dashboard and acceptance:** show all 23 cases, coverage and evidence links without changing the existing placement flow. Test real publisher runs and real failure/recovery scenarios. Resolve D09 lifecycle and D11 duration conflicts with Admin before enforcing those policies.

## Current verification

- Real PostgreSQL tests cover concurrent bounded admission, exclusive worker ownership, persisted records, restart recovery, retained partial device results, one-time legacy import, deletion and retention of queued work.
- Real local HTTP tests cover origin/Host restrictions, publisher URL validation and unavailable-database readiness. No database or HTTP mocks.
- A real queue test verifies that missing uploaded code produces a persisted failed job with zero completed URLs, rather than a false PASS. All three integration tests passed with zero skipped tests.
- Chromium smoke test could not launch: Playwright 1.64.0 requires chromium_headless_shell-1248, which is absent. Installing its browser was attempted and failed with spawn EPERM. No publisher run or 23-case PASS is claimed.

## Local setup

Use the imported application's server on 127.0.0.1:3000 and Vite dashboard on 127.0.0.1:5173. The original dashboard at :8787 is a separate application and is not changed by this branch.

Set DATABASE_URL in server/.env to the existing local PostgreSQL connection. The application creates its own custom_placement schema. Use a database role allowed to create that schema. Do not commit credentials. Stop the server before backing up both the PostgreSQL schema and server/storage; reports reference screenshot and uploaded-script files there.

From custom_placement_automation in a normal local terminal:

```powershell
npm install
Copy-Item server/.env.example server/.env
# Edit server/.env: set DATABASE_URL to your local connection.
npm --prefix server run browsers:install
npm start
```

Copy the example only if server/.env does not already exist. To test the database layer, set TEST_DATABASE_URL to a local database and run npm --prefix server test. Tests create and remove an isolated placement_test_* schema. Test records are not player evidence.

MAX_PENDING_JOBS (default 20) counts queued plus running jobs; a full queue returns HTTP 429. MAX_CONCURRENT_JOBS (default 2, maximum 8) limits active placement browser contexts because device runs within one job are sequential. PDF rendering uses a separate browser. Finished job polling records expire after one hour; reports remain until deleted. Running work is not resumed in the middle of a URL. Local trusted Admin use only; this is not network-hosted multi-user authentication or a sandbox for untrusted uploaded JavaScript.
