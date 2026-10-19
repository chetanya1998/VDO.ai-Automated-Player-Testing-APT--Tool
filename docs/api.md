# Local authenticated run API

Task 16 exposes a local-only HTTP API on `127.0.0.1`. Each configured bearer token maps to one user and team. Runs, reports, lists and artifacts are scoped by team in PostgreSQL; an unknown or cross-team identifier returns `404`.

Configure the database and one or more internal identities, then start the service:

```powershell
$env:DATABASE_URL = "postgresql://validator:password@127.0.0.1:5432/player_validator"
$env:VDO_VALIDATOR_API_IDENTITIES = '[{"token":"replace-with-at-least-16-characters","userId":"alice","teamId":"qa"}]'
$env:VDO_VALIDATOR_ARTIFACT_ROOT = "C:\validator-artifacts"
pnpm api
```

The process applies pending migrations and listens on `http://127.0.0.1:8787`. Open that address for the Task 17 dashboard, or call the endpoints directly. It cannot bind to a remote interface. Until Task 20 adds deployment controls, submissions must use a `fixture_only` profile whose approved URLs and resource origins are loopback addresses. See [Local validation dashboard](dashboard.md) for the UI behavior and polling boundary.

Requests use `Authorization: Bearer <token>`. Creating a run also requires an `Idempotency-Key` containing 1 to 200 bytes.

| Method | Path | Result |
|---|---|---|
| `GET` | `/health/live` | Process liveness; no authentication required |
| `GET` | `/health/ready` | PostgreSQL readiness; no authentication required |
| `POST` | `/v1/runs` | Validate and enqueue `{ profile, targetUrl, deviceId }` |
| `POST` | `/v1/batches` | Validate and enqueue bounded `{ profile, targetUrls, deviceIds }` items |
| `GET` | `/v1/runs` | List the team's 100 newest runs |
| `GET` | `/v1/batches/{batchId}` | Read team-scoped item status and case/device completeness |
| `GET` | `/v1/runs/{runId}` | Read team-scoped run status and progress |
| `GET` | `/v1/runs/{runId}/report` | Read a final report, or `202` while it is unavailable |
| `GET` | `/v1/runs/{runId}/export.json` | Download a redacted structured technical report |
| `GET` | `/v1/runs/{runId}/export.html` | Download a redacted self-contained offline report |
| `GET` | `/v1/artifacts/{artifactId}` | Stream an authorized external artifact |

An identical team/key submission returns the original run. Reusing the key with a different profile, URL or device returns `409`. A full queue returns `429` with `queue_capacity_reached`. HTTP error bodies contain stable codes and safe messages without database details, credentials or stack traces.

Report exports require a final report and otherwise return `409 report_not_ready`. They use the same team scope as report inspection. See [Technical report exports](report-export.md) for contents and redaction behavior.

Batch submissions keep mixed admission results, use one independent run deadline per accepted URL/device item, and never retry automatically. See [Bounded URL batches](batches.md) for limits, status fields and retry behavior.

Artifact downloads are confined to `VDO_VALIDATOR_ARTIFACT_ROOT` even when a stored database reference points elsewhere. See [Internal pilot operations](operations.md) for deployment and recovery gates.
