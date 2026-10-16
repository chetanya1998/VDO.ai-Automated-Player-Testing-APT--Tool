# PostgreSQL persistence and worker

Task 15 uses PostgreSQL for immutable profile versions, run state, evidence metadata, findings, artifact references and queue leases. Browser captures, screenshots and sanitized HAR files remain in an external artifact store; database rows contain only their reference, size and SHA-256 digest.

Apply migrations to an empty or existing validator database:

```powershell
$env:DATABASE_URL = "postgresql://validator@localhost/player_validator"
pnpm db:migrate
```

The migrator serializes concurrent migration attempts and rejects any migration file changed after application. A run is admitted only while queued plus leased jobs remain below the configured capacity. Its maximum 300-second deadline starts when the run is inserted, so queue time is included.

`ValidatorWorker.runOnce()` owns one job at a time. PostgreSQL claims jobs with `FOR UPDATE SKIP LOCKED`, records a bounded lease and extends it while the handler runs. An expired lease or run deadline makes the job terminally interrupted; it is never returned to the queue because repeating browser ad activity requires a new run ID. Progress, partial report snapshots, evidence metadata and artifact references written before interruption remain available.

Retention cleanup calls the configured artifact deletion function first, removes the corresponding database reference only after that succeeds, then deletes terminal runs with no remaining artifacts. It never cleans queued or running runs.

Run the real PostgreSQL acceptance cases against a disposable database where the test account can create and drop schemas:

```powershell
$env:TEST_DATABASE_URL = "postgresql://validator_test@localhost/player_validator_test"
pnpm test
```

The PostgreSQL cases are skipped when `TEST_DATABASE_URL` is absent. They do not use an in-memory database or a mocked SQL client.
