# Bounded URL batches

Task 28 adds an authenticated URL-list workflow over the existing PostgreSQL queue. A batch accepts one fixture profile, up to 25 target URLs and up to four enabled device IDs, with at most 50 URL/device items after expansion. Every admitted item becomes an ordinary run with its own queue-inclusive deadline, status, report and export endpoints.

Submit a batch with `POST /v1/batches`, bearer authentication and an `Idempotency-Key`:

```json
{
  "profile": { "schemaVersion": 1, "profileStatus": "fixture_only" },
  "targetUrls": ["http://127.0.0.1:3000/one", "http://127.0.0.1:3000/two"],
  "deviceIds": ["desktop-chromium", "mobile-chromium-emulated"]
}
```

The response retains every item in input order. An item is either accepted with a `runId`, `runUrl`, `reportUrl` and independent `deadlineAt`, or rejected with a stable error code. Invalid, duplicate, unapproved or disallowed targets and disabled devices do not hide other items. When queue capacity is exhausted, remaining valid items are recorded as `queue_capacity_reached` instead of expanding the queue.

`GET /v1/batches/{batchId}` returns current per-item states plus accepted/rejected/terminal counts. Device completeness reports terminal runs and distinct reported cases. Case completeness reports how many accepted runs contain each TC-1 through TC-23 result. A completed run remains visible when another item is rejected, times out or errors.

Repeating the same team, idempotency key and submission returns the original batch and run IDs. Reusing the key for different input returns `409`. After a response, retrying work requires a new submission and key, which creates new run IDs; the service never repeats advertising activity automatically. Batch duration has no five-minute guarantee: the configured deadline applies independently to every admitted run. Recurring scheduling is not included.

The same bearer/team boundary used by runs and reports protects batch status. Fixture-only loopback restrictions are evaluated for every target. Production URLs remain disabled until deployment controls are implemented.
