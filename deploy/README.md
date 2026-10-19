# Deployment boundary

No production manifest is committed yet because this repository does not contain an isolated browser service or a production worker handler. Deploying the API and the current in-process Chromium runner together would let a browser compromise share the worker network namespace, so it cannot meet Task 20.

The first deployable pilot must provide four separately privileged workloads described in [the operations runbook](../docs/operations.md): API, worker, browser sandbox and trusted logger collector. Add platform-specific manifests only after the target orchestrator, secret manager, artifact store, DNS resolver and private-network ranges are known. Remote publisher execution stays disabled in the API until the deployed acceptance suite passes.
