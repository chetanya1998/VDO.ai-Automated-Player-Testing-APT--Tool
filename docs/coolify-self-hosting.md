# Coolify self-hosting plan

This runbook describes how to host the validator on self-managed Coolify infrastructure. It separates the deployment into two stages because the repository cannot yet safely execute arbitrary publisher pages in production.

- **Stage 1 — internal fixture environment:** API, dashboard, PostgreSQL, and persistent artifacts. Remote execution stays disabled. This is suitable for deployment verification and fixture-only runs after the API is made container-reachable.
- **Stage 2 — production remote validation:** API, queue worker, browser sandbox, trusted logger collector, PostgreSQL, and protected artifact storage. Enable this only after the missing service boundaries are implemented and the deployed controls pass acceptance.

The fixtures are development inputs. They are not a substitute for real publisher, demand, logger, or device evidence.

## 1. Current deployment gaps

Do not enable `VDO_VALIDATOR_ENABLE_REMOTE_EXECUTION` in the current code. The following work must land first:

1. Make the API bind address configurable and use `0.0.0.0` inside its container. It currently listens on loopback, which prevents the Coolify proxy from reaching it.
2. Add a production worker entrypoint that continuously leases jobs, applies bounded retries, handles shutdown, and reports health. `src/worker.ts` currently exposes a class rather than a runnable worker service.
3. Move Chromium execution behind an authenticated browser-service protocol. The browser must not run in the API or worker process.
4. Add the trusted logger collector as a separate service. Only this service may receive backend logger credentials.
5. Add production Dockerfiles and health checks for the API, worker, browser service, and collector. Pin the browser image by immutable digest.
6. Add deployed network and recovery tests, then generate the acceptance evidence described in [Deployment boundary](../deploy/README.md). An acceptance file must record real results from the deployed environment; it must never be fabricated from unit tests.

## 2. Recommended infrastructure

Use three servers for the production layout. The Coolify control plane and application control workloads may share a server during an internal pilot, but the browser runner must remain on a separate host.

| Server | Suggested starting size | Workloads | Public ingress |
| --- | --- | --- | --- |
| Coolify control | 2 vCPU, 4 GB RAM, 40 GB disk | Coolify only | SSH, HTTP, HTTPS; temporary installer ports |
| Validator control | 4 vCPU, 8 GB RAM, 80 GB SSD | API/dashboard, worker, collector, PostgreSQL, artifact volume | HTTPS to API only |
| Browser runner | 4 vCPU, 8 GB RAM, 80 GB SSD | Isolated browser service | None |

Increase CPU, memory, and disk from measured queue latency, Chromium concurrency, database size, and artifact retention. Run one browser job per isolated browser container initially. Do not place secrets for PostgreSQL, artifact storage, the API, or the logger collector on the browser host.

Required DNS records:

- `coolify.example.com` points to the Coolify control server.
- `validator.example.com` points to the validator control server.
- The browser service has no public DNS record. The worker reaches it through a private network or VPN with an authenticated service identity.

The browser host's outbound firewall must allow only DNS through an approved resolver and public HTTPS/HTTP destinations needed by approved profiles. Deny loopback, private IPv4 and IPv6 ranges, link-local addresses, cloud metadata endpoints, and access to the control-plane network. Apply these controls at the host or network firewall as well as in application code.

## 3. Install and secure Coolify

1. Provision a supported Linux server, preferably the current Ubuntu LTS release, with a public IP and SSH key access.
2. Allow TCP ports `22`, `80`, `443`, `8000`, `6001`, and `6002` during installation.
3. Connect over SSH as root and install Coolify:

   ```bash
   curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
   ```

4. Open `http://<server-ip>:8000` and immediately create the first administrator account.
5. Add `coolify.example.com` as the dashboard domain and confirm HTTPS works.
6. Close public access to ports `8000`, `6001`, and `6002` after the dashboard domain is working. Keep `22`, `80`, and `443` as required.
7. Copy `/data/coolify/source/.env` to encrypted backup storage. Its `APP_KEY` is required to recover encrypted Coolify data.
8. Enable Coolify database backups, configure an S3-compatible backup destination, and perform a restore drill before production use.
9. Add the validator control and browser servers to Coolify with SSH keys. Use separate Coolify destinations so their Docker networks and credentials cannot overlap.

Coolify installation and firewall details are maintained in the official [self-hosting guide](https://coolify.io/docs/start-with-self-hosted) and [firewall guide](https://coolify.io/docs/core/infrastructure/servers/firewall).

## 4. Connect the source repository

1. In Coolify, open **Sources** and add a GitHub App.
2. Grant the app access only to `chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool`.
3. Create a Coolify project named `vdo-apt` with `staging` and `production` environments.
4. Protect the `main` branch in GitHub. Deploy production from a commit SHA or immutable image tag after checks pass.
5. Keep auto-deploy disabled for production until the rollback and database compatibility checks in this document are automated.

Do not commit production secrets, `.env` files, acceptance evidence, database backups, or artifacts to Git.

## 5. Stage 1: internal fixture environment

Stage 1 is the first executable milestone after adding the API bind setting and a Node 24 production Dockerfile. It proves Coolify routing, persistence, authentication, migrations, and backup recovery while remote URLs remain disabled.

### Create PostgreSQL

1. In the `staging` environment, choose **New Resource → Database → PostgreSQL** on the validator control server.
2. Pin a supported PostgreSQL major version; do not use `latest`.
3. Set a generated database password and keep public access disabled.
4. Add a persistent volume and a health check using `pg_isready`.
5. Enable scheduled backups to S3-compatible storage. Retain at least one daily, weekly, and monthly recovery point according to the team's retention policy.
6. Restore a backup into a separate test database and run the readiness check against it before calling backups operational.

### Create persistent artifact storage

Create a named volume or host bind mount owned by the application user and mount it at `/data/artifacts` in the API container. Artifacts and PostgreSQL records form one logical run record, so back them up on a coordinated schedule and document their common recovery point. A Docker volume alone is not a backup.

The current application uses filesystem artifacts. Move to an object-storage adapter before running multiple API replicas or moving artifacts between hosts.

### Deploy the API and dashboard

1. In the `staging` environment, choose **New Resource → Application**, select the GitHub repository and `main` branch, and target the validator control server.
2. Select the repository Dockerfile after it is implemented.
3. Set the internal application port to `8787` and add `https://staging-validator.example.com` as its domain.
4. Mount the artifact volume at `/data/artifacts`.
5. Add these runtime variables in Coolify. Mark secrets as locked and never expose them as build variables.

   | Variable | Stage 1 value | Secret |
   | --- | --- | --- |
   | `NODE_ENV` | `production` | No |
   | `HOST` | `0.0.0.0` | No |
   | `PORT` | `8787` | No |
   | `DATABASE_URL` | Coolify PostgreSQL internal URL | Yes |
   | `VDO_VALIDATOR_API_IDENTITIES` | JSON containing real team identities and strong tokens | Yes |
   | `VDO_VALIDATOR_ARTIFACT_ROOT` | `/data/artifacts` | No |
   | `VDO_VALIDATOR_ENABLE_REMOTE_EXECUTION` | `false` | No |

6. Configure the container health check to call `GET /health/live`. Configure readiness monitoring and deployment verification to call `GET /health/ready`.
7. Deploy. The API startup applies checksummed PostgreSQL migrations under a database lock.
8. Verify HTTPS, authentication rejection without a token, authenticated dashboard loading, a fixture-only run, report retrieval, and artifact retrieval.
9. Restart the API and confirm the run, report, and artifacts remain accessible.
10. Restore the database and artifact backup into a disposable staging environment and repeat the retrieval checks.

Stage 1 must keep production profiles and arbitrary remote URLs unavailable.

## 6. Stage 2: production remote validation

Create separate Coolify applications after the six deployment gaps are implemented. Use immutable version tags for every image and record the resolved digest in the release evidence.

### Control server resources

| Resource | Network access | Secrets | Persistent state |
| --- | --- | --- | --- |
| API/dashboard | PostgreSQL, artifact store; public HTTPS ingress | API identities, database URL | Artifact volume until object storage is implemented |
| Worker | PostgreSQL, browser service, artifact store | Database URL, browser service credential | None |
| Logger collector | Approved logger backend, PostgreSQL/artifact ingestion endpoint | Logger credential, collector identity | Bounded cursor/watermark state |
| PostgreSQL | API, worker, collector only | Database credential | Database volume and backups |

The API must not connect to the browser service. The worker sends only a normalized, bounded job instruction to the browser service. The collector must not expose logger credentials to the API, worker, browser, reports, or artifacts.

### Browser server resource

Deploy only the browser service on the isolated browser server. It needs:

- an authenticated private endpoint used by the worker;
- one fresh browser context or one disposable container per job;
- CPU, memory, process, output-size, navigation, and total-run limits;
- a read-only root filesystem where possible and a bounded temporary filesystem;
- no database, API identity, artifact-store, logger, cloud, or Coolify credentials;
- no Docker socket or host filesystem mounts;
- host-level egress controls validated after DNS resolution;
- a health endpoint that does not launch a publisher run.

Return sanitized evidence to the worker through the service protocol. Do not let the browser write directly to PostgreSQL or the artifact store.

### Production variables and secret file

Keep the Stage 1 variables and add the final service URLs and credentials defined by the implemented service protocol. Then add these variables only after deployed acceptance succeeds:

```text
VDO_VALIDATOR_ENABLE_REMOTE_EXECUTION=true
VDO_VALIDATOR_DEPLOYMENT_ACCEPTANCE_FILE=/run/secrets/deployment-acceptance.json
VDO_VALIDATOR_BROWSER_IMAGE_DIGEST=sha256:<exact-running-image-digest>
```

Mount `deployment-acceptance.json` read-only at the configured path. The document must be fresh, reference the exact browser digest, approved profile hashes and HTTPS origins, and contain retained evidence for every required control. A mismatch must keep production admission closed.

## 7. Network rules

Apply and test these paths explicitly:

| Source | Destination | Allow |
| --- | --- | --- |
| Internet | API proxy | TCP 443 |
| API | PostgreSQL and artifact storage | Required private ports only |
| Worker | PostgreSQL, artifact storage, browser service | Required private ports only |
| Collector | approved logger backend and bounded ingestion destination | HTTPS/private ingestion only |
| Browser | approved public page, player, logger, CDN, and demand origins | DNS and public HTTP/HTTPS only |
| Browser | private, loopback, link-local, metadata, control network | Deny |
| Internet | PostgreSQL, worker, collector, browser service | Deny |

Run deployed negative tests for redirects, DNS rebinding, private IPv4 and IPv6, link-local addresses, metadata endpoints, unapproved WebSockets, and requests to the control network. Preserve the firewall configuration and test output as acceptance evidence.

## 8. Health, logs, and alerts

- API liveness: `/health/live`.
- API readiness: `/health/ready`, including database and required persistent dependencies.
- PostgreSQL: `pg_isready`.
- Worker: add a health command or endpoint that reports loop activity, lease age, and database access without exposing job data.
- Browser service: add a lightweight process/readiness endpoint; validate actual Chromium launch separately in the deployed acceptance suite.
- Collector: report upstream reachability, last successful watermark, and bounded ingestion failures.

Alert on unavailable readiness, queue age, expired leases, repeated browser crashes, disk pressure, artifact-write failures, database backup failures, collector watermark staleness, and acceptance expiry. Logs must use run IDs and evidence IDs while excluding bearer tokens, query values, raw credentials, and unapproved response bodies.

## 9. Deployment, update, and rollback procedure

For every release:

1. Build and test from the exact Git commit.
2. Build each image once, scan it, assign a version tag, and record its digest.
3. Confirm database migrations are forward compatible with the currently running API and worker.
4. Back up PostgreSQL and artifacts and record the common recovery point.
5. Deploy PostgreSQL-compatible API changes with production remote admission still closed for the new release.
6. Deploy the worker, collector, and isolated browser image.
7. Run health, authentication, persistence, isolation, egress, secret-leak, cleanup, and recovery checks in the deployed environment.
8. Create and mount the acceptance document only from those results.
9. Enable production admission and run one approved canary URL/profile.
10. Check the report, evidence redaction, artifact access, queue completion, and cleanup before expanding traffic.

Coolify Compose deployments do not provide rolling replacement automatically, so plan a maintenance window or implement application-level draining. Before an application rollback, stop new admissions and let or terminate bounded jobs. Roll back images only when the prior release is compatible with the migrated schema. If data restoration is required, restore PostgreSQL and artifacts to their recorded common recovery point, then rerun integrity and readiness checks.

## 10. Production acceptance checklist

Production remote execution remains disabled until every item is evidenced:

- [ ] API, worker, browser, and collector run as separately privileged workloads.
- [ ] The API and worker cannot access logger credentials.
- [ ] The browser has no database, API, artifact, logger, Docker, host, or cloud credentials.
- [ ] The browser cannot reach private, loopback, link-local, metadata, or control-plane destinations.
- [ ] Only approved public origins can be reached after DNS resolution and redirects.
- [ ] Browser CPU, memory, process, output, navigation, and total-run limits are enforced.
- [ ] Browser cleanup is proven after success, timeout, crash, and cancellation.
- [ ] PostgreSQL and artifact backup restoration has succeeded.
- [ ] API authentication, team isolation, artifact authorization, and redaction pass deployed tests.
- [ ] Queue leases, retries, cancellation, and stale-job recovery pass deployed tests.
- [ ] The collector proves bounded pagination, rate-limit handling, credential isolation, and watermark recovery.
- [ ] Health alerts and disk/queue/backup alerts reach the real on-call destination.
- [ ] The acceptance file is fresh and matches exact profile hashes, HTTPS origins, and browser image digest.
- [ ] The approved canary completes with retained evidence and no secret leakage.

## 11. Executable work packages

Implement these in order. Each package should be independently reviewable and keep remote execution disabled unless its acceptance criteria say otherwise.

| Package | Change | Acceptance |
| --- | --- | --- |
| C01 | Configurable API host binding | Container listens on `0.0.0.0:8787`; local default remains safe; live/readiness checks pass |
| C02 | Multi-stage Node 24 API image and `.dockerignore` | Non-root runtime, reproducible build, no source secrets, health check passes |
| C03 | Fixture-only Coolify definition | API, PostgreSQL, and artifact volume deploy; restart and restore checks pass |
| C04 | Production worker entrypoint | Long-running lease loop, graceful shutdown, health, retry and stale-lease tests pass against real PostgreSQL |
| C05 | Browser-service protocol and image | Worker submits a bounded job; browser receives no control secrets; cleanup and crash tests pass with real Chromium |
| C06 | Browser host isolation | Deployed egress and namespace negative tests prove every prohibited destination is denied |
| C07 | Trusted collector service | Real approved backend credentials stay only in collector; cursor, rate-limit, watermark and redaction tests pass |
| C08 | Production Coolify resources | Separate destinations, networks, secrets, health checks, limits and persistent storage are configured |
| C09 | Backup, restore, monitoring and rollback | Paired database/artifact restore and rollback drill succeed; alerts reach on-call |
| C10 | Deployment acceptance and canary | Fresh evidence document matches the running digest/profile/origins; one approved real canary succeeds |

Do not combine C04–C07 into the API container. Their separation is the security boundary required to permit remote publisher execution.

## Coolify references

- [Self-hosted installation](https://coolify.io/docs/start-with-self-hosted)
- [Server firewall](https://coolify.io/docs/core/infrastructure/servers/firewall)
- [Docker Compose services](https://coolify.io/docs/services/configuration/docker-compose)
- [Persistent storage](https://coolify.io/docs/services/configuration/persistent-storage)
- [Database backups](https://coolify.io/docs/databases/backups)
- [Build and deployment model](https://coolify.io/docs/core/build-deployment-model)
- [Domains and ports](https://coolify.io/docs/applications/configuration/general)
- [Environment variables](https://coolify.io/docs/applications/configuration/environment-variables)
- [Health checks](https://coolify.io/docs/applications/configuration/health-checks)
- [Resource limits](https://coolify.io/docs/applications/configuration/resource-limits)
