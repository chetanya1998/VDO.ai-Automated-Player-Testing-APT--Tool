# VDO.AI Automated Player Testing (APT) Tool

The APT Tool checks whether a VDO.AI player is installed and behaving correctly on a publisher page. It opens the page in a controlled Chromium browser, records what the player does, and produces a report with screenshots, evidence and the most likely cause of any problem.

It is built for QA, Ad Operations, Publisher Support, Player Engineering, and publisher implementation teams. It replaces repeated manual inspection, and every conclusion it reaches can be traced back to captured evidence.

> **Current status — 22 October 2026:** the repository now contains **two applications** that share one PostgreSQL server:
>
> 1. **APT Validator** (repository root): all 23 case rules and the planned local product functions are implemented. It is in internal-pilot status and has not completed production deployment acceptance or validation against an approved live publisher corpus.
> 2. **Placement Automation** (`custom_placement_automation/`): a local tool for testing custom `vdo.ai.js` placement code and `style.css` changes before a site goes live. It now has a durable PostgreSQL job queue, restart recovery, and a dashboard that checks Chromium can actually launch. The 23-case validators are **mapped but not yet connected** to it.
>
> Neither application claims production accuracy or live publisher certification yet.

## Contents

- [The architecture at a glance](#the-architecture-at-a-glance)
- [Repository layout](#repository-layout)
- [Application 1 — APT Validator](#application-1--apt-validator)
- [Application 2 — Placement Automation](#application-2--placement-automation)
- [Bringing the 23 cases into Placement Automation](#bringing-the-23-cases-into-placement-automation)
- [The 23 test cases](#the-23-test-cases)
- [Result meanings](#result-meanings)
- [Getting started](#getting-started)
- [Deployment strategy](#deployment-strategy)
- [Security and evidence principles](#security-and-evidence-principles)
- [Development roadmap](#development-roadmap)
- [Documentation map](#documentation-map)
- [Known limitations](#known-limitations)

## The architecture at a glance

Both applications follow the same pattern: a dashboard submits work to an API, the API stores a job in PostgreSQL, a queue runs the job in Chromium, and the results are saved for the dashboard and report exports. They are kept apart so the placement tool can change quickly without affecting the validator.

```mermaid
flowchart TB
    subgraph Users
      QA["QA / Ad Ops / Support"]
      DEV["Placement engineer"]
    end

    subgraph APT["APT Validator (repository root, TypeScript)"]
      direction TB
      WEB["React dashboard<br/>web/ · :8787"]
      API["Authenticated API<br/>src/api"]
      WORKER["Queue worker<br/>src/worker.ts"]
      BR1["Browser runner + capture<br/>src/browser"]
      RULES["Rule engine (TC-1…TC-23)<br/>src/rules"]
      RCA["RCA + report builder<br/>src/rca · src/report"]
      ART[("Artifact storage")]
    end

    subgraph CPA["Placement Automation (custom_placement_automation/, JavaScript)"]
      direction TB
      UI["React + Vite dashboard<br/>client/ · :5173"]
      EXP["Express API<br/>server/ · 127.0.0.1:3000"]
      QUEUE["Job queue<br/>jobQueue.service"]
      RUNNER["Placement runner<br/>placementRunner + tagDiagnostics"]
      PDF["PDF reports<br/>pdfReport.service"]
      FILES[("server/storage<br/>screenshots · scripts")]
    end

    PG[("PostgreSQL<br/>validator_* tables · custom_placement schema")]
    PUB["Publisher pages + VDO.AI player resources"]

    QA --> WEB --> API
    API --> PG
    WORKER --> PG
    WORKER --> BR1 --> PUB
    BR1 --> RULES --> RCA --> PG
    RCA --> ART

    DEV --> UI --> EXP
    EXP --> QUEUE --> PG
    QUEUE --> RUNNER --> PUB
    RUNNER --> FILES
    EXP --> PDF

    RULES -. "planned reuse<br/>(see roadmap)" .-> RUNNER
```

| | APT Validator | Placement Automation |
| --- | --- | --- |
| Question it answers | "Is this live integration correct according to the 23 cases?" | "Does my new placement JS or CSS put the player on these pages?" |
| Code under test | The publisher's real page and scripts | Your `vdo.ai.js` (replaces the tag's script) or `style.css` (injected) |
| Input | Approved URL, integration profile, device | Domain, tag, up to 50 URLs, devices, uploaded/pasted code |
| Output | 23 case verdicts, evidence timeline, probable causes, JSON/HTML report | PASS / FAIL / ERROR per URL, reasons, two screenshots, diagnostics, PDF |
| Language / stack | TypeScript, Node 24+, `pnpm`, `playwright-core` | JavaScript, Node 20+, `npm`, Express, Playwright, React + Vite |
| Access | Team tokens, team-scoped history | Local only (loopback, no login) |
| Database | `validator_*` tables via `db/migrations` | Its own `custom_placement` schema, created on start |
| Port | `127.0.0.1:8787` | API `127.0.0.1:3000`, dev UI `:5173` |

## Repository layout

```
.
├── src/                         APT Validator (TypeScript)
│   ├── api/                     authenticated HTTP API, batches, static dashboard
│   ├── browser/                 Chromium run, network/DOM capture, URL policy, articles
│   ├── evidence/                evidence normalisation and backend correlation
│   ├── logger/                  logger payload parsing and backend client
│   ├── rules/                   one module per rule family (TC-1…TC-23)
│   ├── rca/                     probable-cause ranking
│   ├── report/                  report build and redacted export
│   ├── ai/                      optional AI explanation (cannot change verdicts)
│   ├── pilot/ production/ deploy/   pilot evaluator, production contract, acceptance
│   ├── store.ts  worker.ts      PostgreSQL store and leased queue worker
│   └── cli.ts
├── web/                         APT Validator dashboard (React)
├── config/                      versioned rule, policy, device and profile configuration
├── db/migrations/               APT Validator schema
├── tests/                       APT Validator tests and fixture pages
├── docs/                        product, operations and planning documentation
└── custom_placement_automation/ Placement Automation
    ├── server/                  Express API, queue, Playwright runner, PDF, tests
    ├── client/                  React + Vite dashboard
    ├── vdo.ai.js                sample placement build
    ├── LOCAL-VALIDATION-PLAN.md 23-case mapping and delivery stages
    └── SETUP.md
```

## Application 1 — APT Validator

### How a validation works

```mermaid
flowchart LR
    A["User selects approved<br/>URL, profile, device"] --> B["API authenticates<br/>and creates run"]
    B --> C["Worker leases job<br/>(deadline + heartbeat)"]
    C --> D["Isolated Chromium<br/>opens page"]
    D --> E["Evidence captured<br/>and redacted"]
    E --> F["23 deterministic<br/>checks run"]
    F --> G["Probable causes<br/>ranked"]
    G --> H["Dashboard, JSON and<br/>offline HTML report"]
```

1. The user signs in with a team token.
2. The user selects an approved page, integration profile and device.
3. The API creates a bounded job with a deadline.
4. A worker claims the job with a lease and keeps it alive with heartbeats.
5. Chromium loads the page and records permitted evidence (network, DOM, logger, timing, layout, screenshots).
6. Evidence is normalised, and the rule engine compares it with the approved profile.
7. The RCA engine groups dependent symptoms and ranks supported causes.
8. Results, evidence references and causes are stored; the dashboard offers JSON or offline HTML export.

### Inside one run: the evidence pipeline

```mermaid
flowchart TB
    subgraph Capture["src/browser"]
      NAV["run.ts<br/>navigate + device profile"]
      NET["capture.ts<br/>network + logger requests"]
      DOM["dom.ts / visibility.ts<br/>anchors, layout, viewport"]
      ART["articles.ts<br/>infinite scroll / SPA steps"]
      POL["url-policy.ts<br/>approved origins only"]
    end
    subgraph Evidence["src/evidence + src/logger"]
      NORM["normalize.ts<br/>one evidence bundle"]
      PAY["browser-payload.ts<br/>event names, fields, build"]
      COR["correlate.ts<br/>optional backend match"]
    end
    subgraph Rules["src/rules"]
      R1["integration · timing · dependencies"]
      R2["logger-presence · events · blocked"]
      R3["demand · auction · viewability · layout"]
      R4["devices · articles · tag identity"]
    end
    RCA["src/rca/diagnose.ts"]
    REP["src/report/build.ts + export.ts"]
    AI["src/ai/explain.ts<br/>(optional, read-only)"]

    POL --> NAV
    NAV --> NET & DOM & ART
    NET --> PAY --> NORM
    DOM --> NORM
    ART --> NORM
    COR -.-> NORM
    NORM --> R1 & R2 & R3 & R4
    R1 & R2 & R3 & R4 --> RCA --> REP
    REP -.-> AI
```

### Run lifecycle

```mermaid
stateDiagram-v2
    [*] --> queued: API admits run
    queued --> running: worker claims lease (job → leased)
    running --> running: heartbeat / save progress
    running --> completed: report + findings stored
    running --> timed_out: run deadline exceeded
    running --> errored: lease lost or unrecoverable error (job → interrupted)
    completed --> [*]
    timed_out --> [*]
    errored --> [*]
```

`validator_runs.execution_state` moves through `queued → running → completed | timed_out | errored`; the matching `validator_jobs.state` is `queued → leased → completed | interrupted`.

### Components

| Component | Purpose |
| --- | --- |
| Dashboard (`web/`) | Submit tests and inspect history, coverage, failures, evidence and probable causes |
| Authenticated API (`src/api`) | Identity, team boundaries, run admission, batches, status, reports and artifact access |
| PostgreSQL (`db/migrations`) | Profiles, runs, leased jobs, evidence metadata, findings, artifact references, batches |
| Queue worker (`src/worker.ts`) | Claims jobs, enforces deadlines and leases, coordinates browser execution |
| Browser runner (`src/browser`) | Opens the publisher page with real Chromium and collects bounded evidence |
| Rule engine (`src/rules`) | Applies versioned, deterministic rules to the captured evidence |
| RCA engine (`src/rca`) | Groups dependent symptoms and ranks supported causes without inventing evidence |
| Artifact storage | Bounded screenshots, sanitised network evidence and report artifacts |
| Logger collector (`src/logger/client.ts`) | Optionally retrieves authorised server-side logger records |
| Report exporter (`src/report`) | Redacted JSON and self-contained HTML reports |
| Pilot evaluator (`src/pilot`) | Accuracy, latency, completeness, cost and release gates from a labelled corpus |

### Data model

```mermaid
erDiagram
    validator_profiles ||--o{ validator_runs : "versioned profile for"
    validator_runs ||--|| validator_jobs : "executed by"
    validator_runs ||--o{ validator_evidence_metadata : records
    validator_runs ||--o{ validator_findings : produces
    validator_runs ||--o{ validator_artifact_refs : references
    validator_batches ||--o{ validator_batch_items : contains
    validator_batch_items |o--o| validator_runs : "creates"

    validator_runs {
      text run_id PK
      text profile_id
      text target_url
      text device_id
      text execution_state
      timestamptz deadline_at
      jsonb final_report
    }
    validator_jobs {
      bigint job_id PK
      text run_id FK
      text state
      text lease_owner
      timestamptz lease_expires_at
    }
```

## Application 2 — Placement Automation

Placement Automation lets an engineer test new placement logic on real publisher pages **before** it ships. You give it a domain, a tag, a list of article URLs and either a `vdo.ai.js` build or a `style.css`. Full details are in [custom_placement_automation/README.md](custom_placement_automation/README.md).

### Two kinds of checks

```mermaid
flowchart LR
    START["Check submitted"] --> TYPE{"Check type?"}
    TYPE -->|vdo.ai.js| JS["Intercept a.vdo.ai/core/&lt;tag&gt;/vdo.ai.js<br/>and serve your file"]
    TYPE -->|style.css| CSS["Inject your CSS into &lt;head&gt;<br/>site's own vdo.ai.js runs"]
    JS --> JSW["Wait for vdo:placement event<br/>+ visible wrapper<br/>(stops early, max 60 s)"]
    CSS --> CSSW["Wait for visible wrapper<br/>(always full 60 s)"]
    JSW --> SHOT["Screenshots: player centred,<br/>then scrolled past (floating)"]
    CSSW --> SHOT
    SHOT --> RES["PASS / FAIL / ERROR<br/>+ reasons + diagnostics"]
```

For `vdo.ai.js` checks, your placement code reports its own outcome:

```js
window.dispatchEvent(new CustomEvent('vdo:placement', {
  detail: { success: placed } // true only if the player was actually inserted
}));
```

### Request flow

```mermaid
sequenceDiagram
    autonumber
    actor U as Engineer
    participant C as Dashboard (React)
    participant A as Express API
    participant DB as PostgreSQL (custom_placement)
    participant Q as Job queue
    participant B as Chromium (Playwright)
    participant P as Publisher page
    participant S as server/storage

    C->>A: GET /api/ready (polled)
    A->>DB: ping
    A->>B: launch check (cached 30 s)
    A-->>C: ready = database ∧ browser launchable ∧ queue not stopping
    U->>C: Domain, tag, URLs, devices, code
    C->>A: POST /api/placement-checks
    A->>S: store uploaded script
    A->>DB: admit job (queued + running < MAX_PENDING_JOBS)
    alt queue full
      A-->>C: 429 Queue is full
    else admitted
      A-->>C: 202 job id
    end
    Q->>DB: status = running
    loop each device (sequential), each URL
      Q->>B: new context (desktop 1366×768 / Pixel 7)
      B->>P: open URL, apply JS override or CSS, lazy-scroll
      P-->>B: vdo:placement event, wrapper, tag diagnostics
      B->>S: 2 screenshots (SHA-256 recorded)
      Q->>DB: progress.done += 1
    end
    Q->>DB: save run, status = completed / failed
    C->>A: GET /api/placement-checks/:jobId (polled)
    A-->>C: progress and results
    U->>C: History → PDF
    C->>A: GET /api/history/:runId/pdf
```

### Job lifecycle and restart recovery

```mermaid
stateDiagram-v2
    [*] --> queued: admitted (bounded by MAX_PENDING_JOBS)
    queued --> running: slot free (MAX_CONCURRENT_JOBS)
    running --> completed: all devices finished
    running --> failed: error, missing script or shutdown
    queued --> queued: server restart (resumed)
    running --> failed: server restart (not replayed)
    completed --> [*]: polling record expires after 1 h<br/>report kept until deleted
    failed --> [*]
```

Queued jobs resume after a restart. A job that was running is marked failed, with completed-device results kept, rather than silently replayed — a replay could re-serve an ad. A PostgreSQL advisory lock ensures only one server owns the schema at a time.

### Result for one URL

```mermaid
flowchart TD
    O["Open URL"] --> BLK{"403/429/503 or<br/>captcha / Cloudflare?"}
    BLK -->|yes| E1["ERROR · page_blocked"]
    BLK -->|no| JSQ{"vdo.ai.js check?"}
    JSQ -->|yes| LOADED{"Tag's vdo.ai.js<br/>requested?"}
    LOADED -->|no| F1["FAIL · script_not_loaded"]
    LOADED -->|yes| EV{"vdo:placement<br/>fired?"}
    EV -->|no| F2["FAIL · no_event_emitted"]
    EV -->|success: false| F3["FAIL · placement_failed"]
    EV -->|success| WRAP
    JSQ -->|no, CSS| WRAP{"Player wrapper<br/>found?"}
    WRAP -->|no| F4["FAIL · div_not_found"]
    WRAP -->|yes| VIS{"Wrapper visible?"}
    VIS -->|no| F5["FAIL · wrapper_hidden"]
    VIS -->|yes| PASS["PASS"]
    O -.->|time limit| E2["ERROR · timeout"]
    O -.->|page closed| E3["ERROR · page_closed"]
```

The chart shows the main path. In practice every failing condition is recorded, so one URL can carry several reasons (for example `script_not_loaded` and `div_not_found`).

### Server modules

| Module | Responsibility |
| --- | --- |
| `server/src/app.js` | Express app; rejects any non-loopback Host or Origin; serves `client/dist` when built |
| `routes/`, `controllers/` | `/api/health`, `/api/ready`, `/api/settings`, `/api/placement-checks`, `/api/history` |
| `services/database.service.js` | `custom_placement` schema, job admission, advisory lock, restart recovery, one-time `reports.json` import |
| `services/jobQueue.service.js` | Bounded queue, concurrency limit, progress persistence, graceful drain |
| `services/browser.service.js` | Shared Chromium, device profiles, cached launch readiness |
| `services/placementRunner.service.js` | Opens pages, applies code, scrolls, detects placement, takes screenshots |
| `services/tagDiagnostics.service.js` | Records `vdo.ai.js`, `vdo.min.js`, `ima3.js`, agent, analytics events, tag errors, console |
| `services/results.service.js` | Saves runs to PostgreSQL and screenshots to disk |
| `services/scriptStore.service.js` | Stores uploaded scripts for Re-run |
| `services/pdfReport.service.js` | PDF reports in a separate Chromium |

### API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness |
| GET | `/api/ready` | Database, queue and real Chromium launch readiness (503 until all are ready) |
| GET | `/api/settings` | Default scroll settings, limits and per-URL time limit |
| POST | `/api/placement-checks` | Start a check; returns a job (429 when the queue is full) |
| GET | `/api/placement-checks/:jobId` | Job progress and results |
| GET | `/api/history` | List runs (`?page=&pageSize=`) |
| GET | `/api/history/:runId` | One run with its results |
| GET | `/api/history/:runId/pdf` | Download the run as a PDF |
| DELETE | `/api/history/:runId` | Delete one run and its screenshots |
| DELETE | `/api/history` | Delete all runs, screenshots and stored scripts |

## Bringing the 23 cases into Placement Automation

The 23 validators already exist in the APT Validator. The plan in [LOCAL-VALIDATION-PLAN.md](custom_placement_automation/LOCAL-VALIDATION-PLAN.md) connects them to Placement Automation in stages. Until then, a placement PASS must **never** be counted as a pass for any of the 23 cases.

```mermaid
flowchart LR
    S1["1 · Local execution foundation<br/>PostgreSQL jobs, recovery,<br/>readiness, screenshot hashes"]:::done
    S2["2 · Real evidence mode<br/>publisher scripts unmodified,<br/>sanitised network/logger capture"]:::wip
    S3["3 · Installation and layout<br/>TC-1–3, TC-12–14, TC-18"]:::todo
    S4["4 · Logger and demand<br/>TC-4–11, TC-15, TC-17, TC-19, TC-20"]:::todo
    S5["5 · Device and articles<br/>TC-16, TC-21–23"]:::todo
    S6["6 · Dashboard and acceptance<br/>all 23 cases, real runs,<br/>D09 / D11 decisions"]:::todo
    S1 --> S2 --> S3 --> S4 --> S5 --> S6

    classDef done fill:#d1fadf,stroke:#12b76a,color:#054f31
    classDef wip fill:#fef0c7,stroke:#f79009,color:#7a2e0e
    classDef todo fill:#f2f4f7,stroke:#98a2b3,color:#344054
```

| Stage | Status |
| --- | --- |
| 1. Local execution foundation | Implemented |
| 2. Real evidence / production observation mode | In progress — dashboard readiness now uses a real Chromium launch; cancellation, per-URL checkpoints and evidence retention pending |
| 3–5. Case integration | Connected as the opt-in **deep test**: all 23 cases run per URL from the placement dashboard ([details](custom_placement_automation/README.md#deep-test-all-23-cases)) |
| 6. Dashboard and acceptance | Dashboard done; live publisher acceptance and confirmed policies pending |

Each case maps to an existing module under `src/` (for example TC-1 → `rules/integration.ts`, TC-14 → `rules/layout.ts`, TC-23 → `rules/articles.ts`); the full table is in the plan.

## The 23 test cases

| Case | Plain-language check |
| --- | --- |
| TC-1 | Is the correct VDO.AI tag and loader script present and successfully loaded? |
| TC-2 | Did the loader script finish within the approved timing bands? |
| TC-3 | Did each tag load only once without duplicate scripts or anchors? |
| TC-4 | Are browser logger requests being sent successfully? |
| TC-5 | Does the observed logger event journey match an approved served-ad or no-ad flow? |
| TC-6 | Are all events required for this page, product, and outcome present? |
| TC-7 | Is Pageview emitted once per active tag and Website Pageview within its allowed count? |
| TC-8 | Is the player correctly classified above or below the fold, and does it report entering view? |
| TC-9 | Does an eligible player initiate the expected ad request? |
| TC-10 | Where does the ad-serving chain first stop, and was viewable exposure achieved? |
| TC-11 | Were player, inline, autoplay, IMA, agent, device, URL, or coded errors blocked as expected? |
| TC-12 | Did every dependency required by the selected product load successfully? |
| TC-13 | Are the correct anchor and external script present in the intended page location? |
| TC-14 | Did the player form correctly, and is publisher CSS hiding, clipping, or covering it? |
| TC-15 | How long did logger requests take, and where are repeated delays visible? |
| TC-16 | Does the integration behave correctly on the required desktop and mobile profiles? |
| TC-17 | Do logger tag, domain, page URL, and dependency values agree with observed page evidence? |
| TC-18 | Does the approved tag belong to the configured domain and product? |
| TC-19 | Does the dependency build stay consistent throughout one physical page load? |
| TC-20 | Are logger event names and the five required fields present and valid? |
| TC-21 | Does each logger event carry the article URL that was current when the request began? |
| TC-22 | Does each tag emit one loaded and one Pageview event for each article? |
| TC-23 | Does validation remain correct through at least three infinite-scroll or SPA articles? |

Every result retains expected and observed values, evidence references, applicability and limitations. Detailed acceptance scenarios are in [case coverage](docs/plan/CASE-COVERAGE.md).

## Result meanings

**APT Validator**

| Result | Meaning |
| --- | --- |
| `PASS` | The required behaviour was observed with sufficient evidence |
| `FAIL` | Evidence shows that a required rule was violated |
| `WARNING` | A risk or provisional threshold breach that may not be a defect |
| `UNKNOWN` | The evidence or approved policy is insufficient for a conclusion |
| `NOT APPLICABLE` | The rule does not apply to the selected product, device or scenario |

Demand, publisher implementation, runtime/browser, configuration and coverage problems stay separate. A no-fill response is not automatically blamed on the publisher.

**Placement Automation** reports `PASS`, `FAIL` or `ERROR` per URL with a reason code (`script_not_loaded`, `no_event_emitted`, `placement_failed`, `div_not_found`, `wrapper_hidden`, `page_blocked`, `timeout`, `page_closed`). These describe placement only, not the 23 cases.

## Getting started

### APT Validator

Requirements: Node.js 24+, `pnpm`, PostgreSQL, and an installed Chromium for browser-level testing.

```bash
pnpm install
pnpm typecheck
pnpm test
```

Set `DATABASE_URL`, `VDO_VALIDATOR_API_IDENTITIES` and `VDO_VALIDATOR_ARTIFACT_ROOT`, then:

```bash
pnpm db:migrate
pnpm api
```

Open `http://127.0.0.1:8787`, enter an authorised team token, submit an approved fixture profile and URL, choose a device, and follow the run until its report is available. From the dashboard you can submit single runs or bounded batches, monitor progress, review coverage and verdicts, inspect the evidence timeline and probable causes, and download redacted JSON or offline HTML.

### Placement Automation

Everyday use, one command from the repository root (updates from GitHub, asks for the PostgreSQL settings the first time, installs and builds only what changed, starts on http://127.0.0.1:3000):

```bash
npm run app            # or double-click "Start VDO Tool.cmd" on Windows
```

Developer setup: Node.js 20+, `npm`, and a local PostgreSQL database role that can create the `custom_placement` schema.

```bash
cd custom_placement_automation
npm run setup || bash setup.sh          # installs server, client and Chromium, creates server/.env
# edit server/.env and set DATABASE_URL
npm start                               # API on 127.0.0.1:3000, UI on http://localhost:5173
```

The dashboard enables checks only when `/api/ready` reports the database, queue and Chromium launch as ready. If Chromium is missing, run `npm --prefix server run browsers:install`; the dashboard picks it up automatically. See [SETUP.md](custom_placement_automation/SETUP.md) for troubleshooting.

Database tests: set `TEST_DATABASE_URL` and run `npm --prefix server test`. They use an isolated `placement_test_*` schema that is removed afterwards.

Further guides: [product guide](docs/product-guide.md), [API](docs/api.md), [dashboard](docs/dashboard.md), [batches](docs/batches.md), [report export](docs/report-export.md).

## Deployment strategy

Placement Automation is a **local, trusted-admin tool** and is not designed to be network-hosted. The APT Validator is deployed in two controlled stages.

```mermaid
flowchart LR
    L["Local / internal pilot<br/>(today)"] --> S1["Stage 1 · Fixture environment<br/>API, dashboard, PostgreSQL,<br/>artifacts on Coolify<br/>remote execution OFF"]
    S1 --> S2["Stage 2 · Production remote validation<br/>separate API, worker, browser<br/>and logger-collector services"]
    S2 --> GO{"Acceptance evidence:<br/>isolation, egress, secrets,<br/>backup/restore, monitoring, canary"}
    GO -->|all retained| LIVE["Approved live URLs enabled"]
    GO -->|missing| S2
```

In Stage 2 the browser runs on a separate server with no database, API, artifact, logger, Docker, cloud or Coolify credentials. It may reach only approved public destinations; private, loopback, link-local, metadata and control-plane networks are denied.

```mermaid
flowchart LR
    subgraph Control["Validator control server"]
      API["API and dashboard"]
      WORKER["Worker"]
      DB[("PostgreSQL")]
      STORE[("Artifacts")]
      LOGGER["Logger collector"]
    end
    subgraph Sandbox["Separate browser server"]
      BROWSER["Disposable Chromium job"]
    end
    USERS["Users"] -->|HTTPS| API
    API --> DB
    WORKER --> DB
    WORKER -->|bounded job instructions| BROWSER
    BROWSER -->|approved public origins only| WEB["Publisher + player resources"]
    BROWSER -->|sanitised result only| WORKER
    WORKER --> STORE
    LOGGER -->|approved backend API| BACK["Backend logger"]
    LOGGER --> DB
```

The exact procedure is in the [Coolify self-hosting plan](docs/coolify-self-hosting.md), the [operations runbook](docs/operations.md) and the [production delivery backlog](docs/plan/PRODUCTION-DELIVERY.md).

## Security and evidence principles

- Only approved URLs and resource origins may be tested; destinations are checked after DNS resolution.
- Private, loopback, link-local and metadata destinations are rejected.
- Chromium receives no database, API or logger credentials.
- Tokens and sensitive query values are redacted from retained evidence.
- Team boundaries protect APT Validator runs, reports and artifacts.
- Placement Automation listens only on `127.0.0.1` and rejects non-local Host/Origin headers; it is not a sandbox for untrusted uploaded JavaScript.
- Output is bounded by time, size and count limits.
- AI can explain existing findings but cannot create or alter verdicts.
- Synthetic fixtures verify code behaviour but do not prove live publisher correctness.

## Development roadmap

```mermaid
flowchart TB
    F["Foundation<br/>01–03"]:::done --> B["Browser and evidence<br/>04–06, 22–24"]:::done
    B --> C["Core validation<br/>07–08, 11–14, 25–27, 29"]:::done
    C --> A["Application<br/>15–18, 28"]:::done
    C --> O["Optional intelligence<br/>09–10, 19"]:::partial
    A --> H["Deployment hardening<br/>20"]:::partial
    A --> P["Placement Automation<br/>local foundation"]:::done
    P --> PI["23-case integration<br/>stages 2–6"]:::partial
    H --> R["Pilot and release<br/>21"]:::partial

    classDef done fill:#d1fadf,stroke:#12b76a,color:#054f31
    classDef partial fill:#fef0c7,stroke:#f79009,color:#7a2e0e
```

| Phase | Tasks | Outcome | Status |
| --- | --- | --- | --- |
| Foundation | 01–03 | Supported integration, shared contracts, controlled page scenarios | Implemented locally |
| Browser and evidence | 04–06, 22–24 | Bounded Chromium runs, evidence, logger parsing, identities, normalisation, timing | Implemented locally |
| Core validation | 07–08, 11–14, 25–27, 29 | All 23 checks, demand/auction/layout/article/device rules, reports, RCA | Implemented locally |
| Application | 15–18, 28 | PostgreSQL queue, authenticated API, dashboard, exports, batch validation | Implemented locally |
| Optional intelligence | 09–10, 19 | Backend verification, exact correlation, bounded AI explanation | Implemented locally; live integrations unverified |
| Deployment hardening | 20 | Network safety, admission controls, health, credential separation, recovery | Application hardening done; deployment acceptance pending |
| Pilot and release | 21 | Labelled-corpus evaluation and evidence-backed release decision | Evaluator implemented; real pilot inputs pending |
| Placement Automation | — | Durable local placement backend, readiness, 23-case mapping | Stage 1 done; stage 2 in progress |

The authoritative task order and handoff are in [TASKS.md](docs/plan/TASKS.md) and [STATUS.md](docs/plan/STATUS.md).

## Documentation map

- [Non-technical product guide](docs/product-guide.md)
- [Placement Automation README](custom_placement_automation/README.md), [setup](custom_placement_automation/SETUP.md), [Windows step-by-step install](custom_placement_automation/INSTALL-WINDOWS.md) and [local validation plan](custom_placement_automation/LOCAL-VALIDATION-PLAN.md)
- [Coolify self-hosting plan](docs/coolify-self-hosting.md)
- [Dashboard use](docs/dashboard.md)
- [Report exports](docs/report-export.md)
- [Bulk validation](docs/batches.md)
- [Desktop, mobile and real-iOS validation](docs/device-validation.md)
- [PostgreSQL and worker](docs/persistence.md)
- [Support and pilot runbook](docs/support-runbook.md)
- [Pilot results and release status](docs/pilot-results.md)
- [Detailed case coverage](docs/plan/CASE-COVERAGE.md)
- [Implementation status](docs/plan/STATUS.md)

## Known limitations

- No approved production profile, live publisher corpus or real demand capture has been supplied.
- Production service separation and Coolify deployment acceptance are not complete.
- The 23 cases are not yet executed by Placement Automation; its PASS covers placement only.
- Placement Automation has no login, does not resume a URL interrupted mid-run, and some sites block automated browsers (`page_blocked`). `script_not_loaded` is common where the ad slot does not always fill.
- Real iOS/Safari evidence is required for iOS-specific conclusions; Chromium mobile emulation does not replace it.
- Some thresholds and lifecycle rules remain draft until product owners confirm decisions D01–D14.
- Backend logger verification requires authorised credentials and a confirmed shared identifier.
- Tablet and connected-TV profiles are deferred.
- Pilot accuracy, time saving and release metrics cannot be claimed before the labelled corpus is evaluated.

Both applications are safe by default: missing evidence produces `UNKNOWN`, `ERROR` or an explicit coverage gap rather than a fabricated pass, failure or cause.
