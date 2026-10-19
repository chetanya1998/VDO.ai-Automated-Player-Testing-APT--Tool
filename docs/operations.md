# Internal pilot operations

Task 20 remains fixture-only until the deployment acceptance checks below pass in the target environment. The application now validates every HTTP request and WebSocket against the profile origin allowlist, resolves each remote host before use, rejects non-public IPv4 and IPv6 addresses, pins the address set for the run, and launches Chromium with an allowlisted environment that excludes database, API and logger credentials. These checks reduce risk but do not replace a network sandbox.

## Required topology

Use separate API, worker, browser and collector identities. The API may reach PostgreSQL and the artifact store but must not launch a browser. The worker may claim jobs and send sanitized browser instructions, but browser processes must run in a separate network namespace with no database, API-token, artifact-store or collector secrets. Only the trusted collector may receive logger credentials. The browser namespace may resolve DNS and connect to approved public destinations; its firewall must reject loopback, private, carrier-grade NAT, link-local, multicast, reserved and cloud-metadata ranges for IPv4 and IPv6 after DNS resolution.

Do not enable production profiles until the actual platform proves that the browser cannot reach PostgreSQL, the collector, the artifact store control plane, instance metadata or any private service. Application routing cannot close the DNS-to-connect race by itself.

## Runtime limits

- Keep one active job per worker. Set PostgreSQL queue capacity for the pilot load and retain the existing five-minute maximum run deadline.
- Limit each browser sandbox by wall time, memory, CPU, process count and writable disk. Kill the whole sandbox when its run deadline expires.
- Mount a new empty temporary directory per run and destroy it after browser cleanup.
- Store large captures outside PostgreSQL. Configure `VDO_VALIDATOR_ARTIFACT_ROOT` on the API; it refuses to stream a database reference outside that root.
- Keep the configured retention interval explicit. Cleanup deletes the object first, then its database reference, then an eligible terminal run.

The API exposes unauthenticated `GET /health/live` for process health and `GET /health/ready` for PostgreSQL readiness. All run, report, export and artifact endpoints continue to require a team-scoped bearer identity.

## Recovery

1. Stop admission and let active jobs finish or expire. Record the last accepted run ID.
2. Back up PostgreSQL and the artifact root at the same recovery point. Preserve artifact paths, sizes and SHA-256 digests.
3. Restore both into an isolated environment with the same schema migration set.
4. Start the API against the restore, check `/health/ready`, authenticate as a test team and retrieve a known report and artifact.
5. Hash the restored artifact and compare it with `x-artifact-sha256`. Confirm another team receives `404`.
6. Run retention cleanup once and verify that an object deletion failure keeps its database reference. Resume admission only after these checks pass.

## Production activation gate

Run the egress suite in the deployed browser namespace against real endpoints for private IPv4, private IPv6, link-local metadata, a public-to-private redirect, DNS rebinding, a hostile child frame and WebSocket traffic. Also verify queue exhaustion, process cleanup, artifact retention, authenticated restore, and one approved public publisher page. Save the resulting network, process, database and artifact evidence. Until those results exist, keep API submissions restricted to `fixture_only` profiles and do not describe a fixture report as live validation.

After every check passes, create a deployment acceptance document consumed by `src/deploy/acceptance.ts`. The document must include:

- a unique acceptance and environment ID;
- evaluation and expiry timestamps with no more than 30 days of validity;
- the immutable browser image SHA-256 digest;
- every approved profile snapshot SHA-256 and HTTPS origin;
- one `passed` entry for every control exported as `DEPLOYMENT_CONTROLS`;
- at least one retained evidence ID and SHA-256 digest for every control.

Set `VDO_VALIDATOR_ENABLE_REMOTE_EXECUTION=true`, mount the document read-only at `VDO_VALIDATOR_DEPLOYMENT_ACCEPTANCE_FILE`, and set `VDO_VALIDATOR_BROWSER_IMAGE_DIGEST` from the running immutable image. The API requires that digest to match the accepted browser image and resolves the target against the public-address guard before queue admission. Any profile, origin or image change requires a new acceptance document. Remove the enable flag immediately when evidence expires or a control regresses.

The acceptance document is deployment evidence, not application-generated proof. Keep it in the platform's protected configuration system with the referenced artifacts. The repository still needs a target-specific manifest and isolated browser service before these checks can be executed.
