# Deployment boundary

No platform manifest is committed because the target orchestrator, secret manager, artifact store, DNS resolver and private-network ranges have not been supplied. Deploying the API and the current in-process Chromium runner together would let a browser compromise share the worker network namespace, so it cannot meet Task 20.

The first deployable pilot must provide four separately privileged workloads described in [the operations runbook](../docs/operations.md): API, worker, browser sandbox and trusted logger collector. Remote publisher execution is disabled by default. It can be admitted only when both of these variables are present:

```text
VDO_VALIDATOR_ENABLE_REMOTE_EXECUTION=true
VDO_VALIDATOR_DEPLOYMENT_ACCEPTANCE_FILE=/run/secrets/deployment-acceptance.json
VDO_VALIDATOR_BROWSER_IMAGE_DIGEST=sha256:<running-image-digest>
```

The acceptance file is parsed at API startup. It must contain fresh evidence for every required deployment control and bind the approval to exact immutable profile hashes, HTTPS origins and the browser image digest. Missing, stale, incomplete or mismatched acceptance keeps production submissions unavailable. Fixture profiles do not use this gate.

This configuration gate does not replace the isolated browser service or deployed acceptance suite. Do not create an acceptance document until the actual platform has produced and retained the required evidence.
