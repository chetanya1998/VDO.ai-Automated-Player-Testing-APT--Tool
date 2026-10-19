# Production delivery backlog

Updated 20 October 2026. This is the remaining work required to turn the locally implemented validator into a fully working hosted product with its backend on Coolify and frontend on Vercel.

## Delivery rule

A task is complete only when its real service runs in the target environment and its acceptance evidence is retained. Unit fixtures remain useful for regression testing, but they do not complete a deployment task. Do not substitute mocked PostgreSQL, Chromium, publisher pages, logger APIs, object storage, DNS, network isolation, email/alerts, or device evidence.

## Critical path

```text
Production decisions and credentials
  -> runnable API/worker/browser/collector services
  -> real persistence and artifact storage
  -> Coolify staging
  -> deployed isolation and recovery acceptance
  -> public production API
  -> frontend/API separation
  -> Vercel staging and production
  -> approved live canary
  -> labeled pilot and release decision
```

## Parallel delivery plan

The detailed tasks below can be delivered as eight larger packages. Four workstreams can run in parallel, with integration gates between waves.

| Package | Clubbed tasks | Deliverable | Can run with |
| --- | --- | --- | --- |
| P1 Production contract | A01, A12 and external owner inputs | Approved profiles, rule decisions, domains, identity model, storage choice, environments and credentials | P2, P3, P4 |
| P2 Container-ready control plane | A02–A04, A10, C04–C08 | Containerized API, real PostgreSQL, artifact staging and continuously running worker on Coolify | P1, P3, P4 |
| P3 Isolated execution plane | A05–A07, A13, C03, C09–C10, C14 | Authenticated Chromium service on a separate host with enforced limits and proven network isolation | P1, P2, P4 |
| P4 Hosted frontend foundation | V01–V05, V07–V09 | Vercel staging frontend using a configurable HTTPS API, exact CORS and security headers | P1, P2, P3 |
| P5 Evidence services | A08–A09, C06, C11–C12 | Real artifact storage and trusted logger collector with isolated credentials | Late P2 and P3 |
| P6 Operations and recovery | A11, A14, C13, C15–C16, V06, V12 | TLS, observability, alerts, backup/restore, end-to-end acceptance and rollback | After staging services exist |
| P7 Production acceptance | A15–A16, C17–C18, V10–V11 | Production domains, exact deployment acceptance and approved live canary | After P1–P6 |
| P8 Pilot and release | R01–R05 | Real corpus, device evidence, measured metrics and release decision | Corpus preparation can start during P2–P6; evaluation follows P7 |

### Workstreams

| Workstream | Primary packages | Scope |
| --- | --- | --- |
| Backend/control | P2, part of P5 | API, migrations, PostgreSQL, queue worker and artifact integration |
| Browser/security | P3, browser part of P6 | Browser protocol, Chromium service, host isolation, limits and cleanup |
| Frontend | P4, frontend part of P6 | API client configuration, hosted wording, Vercel build, CORS acceptance, UI smoke and rollback |
| Platform/operations | Coolify parts of P2/P3/P5, then P6/P7 | Servers, networks, domains, TLS, secrets, storage, monitoring, backup and release |
| Product/QA | P1 and P8 | Profiles, rule ownership, approved pages, labeled corpus, real devices and release decision |

### Execution waves

**Wave 0 — owner inputs and interfaces**

- P1 confirms domains, policies, identity, storage, logger access and pilot inputs.
- Backend and browser owners agree the browser-service API before implementing either side.
- Backend and frontend owners agree the public API origin, error contract and CORS origins.
- Platform prepares servers, DNS zones, GitHub access, Coolify and Vercel projects without enabling production traffic.

**Wave 1 — parallel build**

- Backend builds the container-ready API and real worker from P2.
- Browser/security builds the isolated service and negative network suite from P3.
- Frontend implements configurable API access, hosted language, build output, routing and headers from P4 against the existing real staging API or a temporary real API deployment. No mock API completes frontend acceptance.
- Platform provisions PostgreSQL, storage, Coolify destinations and Vercel staging.
- Product/QA prepares approved profiles and corpus definitions.

**Wave 2 — staging integration**

- Connect worker to browser service using the final authenticated protocol.
- Connect API/worker to real PostgreSQL and artifact storage.
- Connect the Vercel staging frontend directly to the Coolify staging API with exact-origin CORS.
- Deploy the trusted collector against the authorized logger API.
- Run real fixture jobs end to end through Vercel, Coolify, PostgreSQL and Chromium.

**Wave 3 — operational acceptance**

- Run network-isolation, authorization, redaction, cleanup and capacity checks.
- Trigger real monitoring alerts.
- Restore PostgreSQL and artifacts into a clean environment.
- Prove backend and frontend rollback while preserving API compatibility.

**Wave 4 — controlled production**

- Bind acceptance to exact image digests, profile hashes and origins.
- Deploy production frontend and backend domains.
- Run one approved live publisher canary.
- Keep all other remote inputs closed until the canary and evidence review pass.

**Wave 5 — pilot release decision**

- Collect real observations and real-device evidence.
- Calculate pilot metrics, resolve disagreements and record the release decision.

### Hard dependencies that cannot be parallelized away

- The production worker cannot complete before the browser-service protocol and real browser service exist.
- Vercel end-to-end acceptance cannot complete before a reachable Coolify API and exact CORS policy exist.
- Deployment acceptance cannot be created before the actual network, secrets, images, restore and monitoring controls are tested.
- A live canary cannot run before deployment acceptance matches its exact profile and origins.
- Pilot evaluation cannot pass before real labeled observations and real mobile/iOS evidence exist.

### Recommended first sprint

Run these four packages together:

1. **Backend:** A02–A04 — configurable API bind, API image and production worker.
2. **Browser/security:** A05–A06 — browser protocol and real Chromium service.
3. **Frontend:** V01, V03–V05 — API-base support, hosted UI, Vercel build and headers. Finish V02 with backend during integration.
4. **Platform/product:** C01–C06 plus A01 — servers, repository connection, PostgreSQL, storage and production decisions.

The sprint exits only when the Vercel staging UI can submit one real fixture job to the Coolify staging API, the real worker sends it to the separately hosted Chromium service, and the resulting report and artifact survive a restart. This exit criterion prevents each track from stopping at scaffolding.

## A. Application tasks blocking any production deployment

These are code and product gaps. Coolify or Vercel configuration cannot compensate for them.

| ID | Task | Depends on | Completion evidence |
| --- | --- | --- | --- |
| A01 | Confirm production inputs: approved URLs/origins, tag mappings, event aliases, timing, runtime, demand, auction, visibility, article, device and RCA policies | Product, QA, Ad Ops and Engineering owners | Versioned production profile and signed D01–D14 decision record; fixture profile is rejected as production evidence |
| A02 | Make API host binding configurable | None | Container binds to `0.0.0.0:$PORT`; local default remains loopback; live and ready endpoints work through a container network |
| A03 | Add production API container | A02 | Multi-stage Node 24 image builds reproducibly, runs as non-root, contains the dashboard assets and no secrets, and passes `/health/live` and `/health/ready` |
| A04 | Implement a long-running worker executable | PostgreSQL queue already implemented | Worker continuously leases real PostgreSQL jobs, renews leases, handles cancellation/deadlines, shuts down cleanly and exposes health/heartbeat state |
| A05 | Define and implement the authenticated browser-service contract | A04 | Worker submits bounded normalized jobs to a real service; request/response schemas are versioned; identity, replay protection, timeout and maximum evidence size are enforced |
| A06 | Build the isolated Chromium service | A05 | Real Playwright Chromium completes healthy and fault runs; one disposable context/container per job; crash, timeout and cancellation cleanup are proven |
| A07 | Remove in-process production browser execution | A05–A06 | Production worker can reach only the browser-service client path; API never launches Chromium; fixture CLI behavior remains explicit and separate |
| A08 | Implement production artifact storage | A03–A06 | Real S3-compatible storage or a deliberately single-host persistent volume stores screenshots/HAR/report artifacts with SHA-256, authorization, retention and deletion; restart retrieval passes |
| A09 | Implement the trusted backend logger collector process | Approved logger endpoint and credential | Real API pagination, rate limits, bounded retries, cursor/watermark persistence and credential isolation pass; browser and API never receive the credential |
| A10 | Add service health and graceful draining | A03–A09 | API, worker, browser and collector have meaningful liveness/readiness; a deployment stops admissions, drains bounded work and exits without abandoned processes |
| A11 | Add production observability | A10 | Structured redacted logs, run IDs, metrics and alerts cover readiness, queue age, leases, browser crashes, disk/storage, DB, collector watermark and acceptance expiry; real alert reaches on-call |
| A12 | Add production identity management | API exists | Replace hand-maintained long-lived shared tokens with an approved identity flow or documented token lifecycle; issue, rotate and revoke a real team credential; cross-team access remains `404` |
| A13 | Complete deployed security tests | A03–A12 | Real namespace blocks private IPv4/IPv6, loopback, link-local, metadata, control-plane, redirects, DNS rebinding, hostile frames and WebSockets; secret-leak scan passes |
| A14 | Complete recovery behavior | A08, PostgreSQL | Coordinated database/artifact backup restores into a clean environment; known report and artifact hashes match; queue recovery and rollback are exercised |
| A15 | Produce deployment acceptance | A01–A14 | Fresh acceptance file binds the actual browser image digest, exact profile hashes and approved HTTPS origins; all required evidence references resolve |
| A16 | Run one approved live canary | A15 | A real approved publisher page completes with browser evidence, report, artifacts, cleanup and no secret leakage; remote execution stays closed for all unapproved inputs |

### Product release blockers after deployment

| ID | Task | Completion evidence |
| --- | --- | --- |
| R01 | Collect the mandatory QA-labeled corpus | Unique healthy and fault/boundary observations cover TC-1–TC-23 on desktop/mobile, with required three-article cases |
| R02 | Supply real device evidence | At least one real mobile and one real iOS/Safari result are attributable and pass import validation |
| R03 | Measure real concurrency and cost | Pilot records declared concurrency, queue-inclusive latency and traceable infrastructure/provider cost |
| R04 | Evaluate the pilot | Precision, recall, false-positive, completeness, latency, evidence-quality and cost gates run from the real corpus |
| R05 | Resolve disagreements and decide release | QA disagreements produce owned follow-up cards; release owner records the evidence-backed go/no-go decision |

## B. Coolify backend deployment tasks

Start B01 after A02–A03. Remote publisher execution cannot start until A15.

| ID | Coolify task | Depends on | Completion evidence |
| --- | --- | --- | --- |
| C01 | Provision Coolify control server | Infrastructure access | Supported Ubuntu LTS host, SSH keys, HTTPS dashboard, firewall and encrypted backup of Coolify `APP_KEY` |
| C02 | Provision validator control server | C01 | Dedicated destination for API, worker, collector, PostgreSQL and artifact access; only API HTTPS is public |
| C03 | Provision isolated browser server | C01 | Separate Coolify destination/host; no public ingress, control credentials or shared Docker network |
| C04 | Connect the GitHub repository | C01 | Restricted GitHub App installation reads this repository and deploys an exact commit/image tag |
| C05 | Create real PostgreSQL | C02 | Pinned PostgreSQL version, private network, strong credential, persistent volume, `pg_isready`, migrations and scheduled backup |
| C06 | Create artifact storage | C02, A08 | Persistent storage or S3-compatible service, application identity, retention and restore procedure work with real artifacts |
| C07 | Deploy fixture-only API staging | A03, C04–C06 | HTTPS staging domain reaches API/dashboard; authentication, migrations, fixture run, report and artifact retrieval pass after restart |
| C08 | Deploy production worker | A04, C05–C06 | Worker leases and completes a real staging job; health, drain and stale-lease behavior pass |
| C09 | Deploy browser service | A05–A06, C03 | Immutable Chromium image digest runs on browser host; authenticated private worker path succeeds |
| C10 | Apply host/network isolation | C03, C09 | Host firewall and resolver enforce approved public egress and prohibit internal/metadata access; negative suite evidence is retained |
| C11 | Deploy logger collector | A09, C02 | Collector alone holds the real logger credential; real bounded collection and watermark recovery pass |
| C12 | Configure secrets and least privilege | C07–C11 | Secrets exist only in required services; browser environment and image inspection show none; rotation procedure succeeds |
| C13 | Configure domains and TLS | C07 | `api.<domain>` has valid HTTPS, HTTP redirects to HTTPS and only intended API/health paths are exposed |
| C14 | Configure resource limits and concurrency | C07–C11 | CPU, memory, process, disk and one-job browser limits are enforced using measured staging behavior |
| C15 | Configure monitoring and alerts | A11 | Coolify/service health and external probes trigger the real on-call destination |
| C16 | Configure database/artifact backups | A14 | Scheduled off-host backups and a clean restore drill succeed at a documented common recovery point |
| C17 | Run deployment acceptance | A13–A15, C07–C16 | Acceptance artifact matches running services, image digest, profiles and origins; remote gate opens only for exact approved inputs |
| C18 | Production rollout and rollback drill | C17 | Canary deploy, admission stop, drain, previous-image rollback and compatible data recovery are proven |

The detailed operator procedure is in [Coolify self-hosting plan](../coolify-self-hosting.md).

## C. Vercel frontend deployment tasks

The frontend is a static React application. It must not run PostgreSQL, the queue worker, Chromium or the logger collector on Vercel. Those long-running and privileged services remain on Coolify.

The current frontend calls relative `/v1/*` paths and says it connects to a local API. Complete V01–V06 before creating the Vercel production project.

| ID | Vercel/frontend task | Depends on | Completion evidence |
| --- | --- | --- | --- |
| V01 | Add an explicit frontend API base URL | C13 | Build-time public variable points preview/staging/production to the intended Coolify HTTPS API; all run, batch, report and artifact calls use one validated URL builder |
| V02 | Add exact-origin CORS to the API | V01 | API handles preflight and permits only named Vercel/custom frontend origins, methods and headers including `Authorization`, `Content-Type` and `Idempotency-Key`; arbitrary origins fail |
| V03 | Update hosted UI language and connection state | V01 | UI says hosted validator/API, shows environment/API reachability, and never labels production as local |
| V04 | Add frontend production build contract | V01 | Pinned `packageManager`, deterministic install/build command, static output directory and `vercel.json` are committed; clean build produces only deployable public assets |
| V05 | Add SPA routing and security headers | V04 | Direct route refresh works; CSP, HSTS, content-type, frame, referrer and permissions policies are verified without breaking downloads |
| V06 | Add frontend-to-backend acceptance tests | V01–V05 | Deployed browser signs in with a real staging identity, lists runs, submits one approved fixture job, polls, shows report/timeline and downloads real JSON, HTML and artifact bytes |
| V07 | Create Vercel project and Git connection | V04 | Project is linked to the repository with the correct root/build/output settings and preview deployments enabled |
| V08 | Configure Vercel environments | V01, V07 | Development, Preview and Production have explicit public API URLs; no backend secrets or API bearer tokens exist in Vercel variables |
| V09 | Deploy protected staging frontend | V02–V08, C07 | Stable staging domain is the sole staging CORS origin; deployed smoke and accessibility checks pass |
| V10 | Configure production domain | V09, C13 | Production DNS/TLS works; exact domain is added to backend CORS and deployment records |
| V11 | Deploy production frontend | C17, V10 | Exact commit is promoted; real team sign-in and approved canary workflow pass end to end |
| V12 | Prove rollback and observability | V11 | Vercel rollback restores the previous frontend without API incompatibility; browser errors and API request failures reach monitoring |

### Frontend security decision

Prefer direct browser calls from Vercel to the Coolify API with an exact CORS allowlist. A Vercel rewrite would cause bearer tokens and artifact traffic to pass through the Vercel edge. Use a rewrite only if the security owner explicitly accepts that data path and it is covered by the threat model and privacy policy.

Vercel serves only the static build output, supports separate environment variables for Preview and Production, and can define routing and security headers in project configuration. Use the official [build configuration](https://vercel.com/docs/deployments/configure-a-build), [environment variable](https://vercel.com/docs/environment-variables), [rewrite](https://vercel.com/docs/routing/rewrites), and [security header](https://vercel.com/docs/cdn-security/security-headers) documentation when implementing V04–V10.

## D. External inputs required

These are real owner-provided inputs rather than coding tasks:

- production and staging domain names;
- Coolify control, validator and isolated browser servers;
- Vercel team/project access;
- approved publisher URLs and every required resource origin;
- confirmed production policies and D01–D14 decisions;
- backend logger endpoint, schema, scoped credential and shared correlation ID;
- S3-compatible artifact/backup destination or an approved single-host storage decision;
- identity/token ownership and rotation policy;
- monitoring/on-call destination;
- QA-labeled corpus, real mobile device and real iOS/Safari access;
- pilot concurrency target, retention period, recovery objectives and cost owner.

## Definition of fully working

The tool is fully working only when a user can open the production Vercel dashboard, authenticate with a real team identity, submit an approved live publisher URL, have a real Coolify worker execute it in an isolated Chromium service, receive persisted TC-1–TC-23 results and evidence, download authorized reports/artifacts, and repeat the workflow after service restart and tested rollback. The deployed system must pass isolation, redaction, authorization, cleanup, backup/restore, monitoring and pilot release gates.
