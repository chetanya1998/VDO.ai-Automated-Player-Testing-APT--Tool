import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createBearerAuthenticator } from "../src/api/auth.js";
import { createRunApiServer, listenLocal } from "../src/api/runs.js";
import { applyMigrations, PostgresStore } from "../src/store.js";

const teamAToken = "batch-team-a-token-00000000000000";
const teamBToken = "batch-team-b-token-00000000000000";

function headers(token: string, key?: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    ...(key === undefined ? {} : { "idempotency-key": key }),
  };
}

function profile(approvedUrls: string[]): unknown {
  return {
    schemaVersion: 1,
    profileId: "batch-fixture",
    profileStatus: "fixture_only",
    site: { approvedUrls },
    devices: [{ id: "desktop", state: "enabled" }],
    logger: { backendCorrelation: { state: "disabled" } },
  };
}

interface BatchResponse {
  created?: boolean;
  batchId: string;
  status: string;
  deadlineAt?: string;
  counts: { total: number; accepted: number; rejected: number; terminal: number };
  items: Array<{
    itemIndex: number; targetUrl: string; deviceId: string; state: string; runId: string | null;
    deadlineAt: string | null; error: { code: string; message: string } | null;
    runUrl: string | null; reportUrl: string | null;
  }>;
  completeness: {
    devices: Array<{ deviceId: string; acceptedRuns: number; terminalRuns: number; reportedCaseIds: string[] }>;
    cases: Array<{ testCaseId: string; reportedRuns: number; expectedRuns: number }>;
  };
}

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

test("real batch API preserves mixed results, idempotency, capacity, and per-run completeness", {
  skip: process.env.TEST_DATABASE_URL ? false : "set TEST_DATABASE_URL to a disposable PostgreSQL database",
}, async () => {
  const connectionString = process.env.TEST_DATABASE_URL!;
  const schema = `validator_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString, max: 1 });
  const pool = new Pool({ connectionString, max: 6, options: `-c search_path=${schema}` });
  let server: ReturnType<typeof createRunApiServer> | undefined;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await applyMigrations(pool);
    const store = new PostgresStore(pool, { capacity: 2, leaseMs: 5_000, runDeadlineMs: 20_000, retentionMs: 10_000 });
    server = createRunApiServer({
      store,
      authenticate: createBearerAuthenticator([
        { token: teamAToken, userId: "alice", teamId: "team-a" },
        { token: teamBToken, userId: "bob", teamId: "team-b" },
      ]),
    });
    const port = await listenLocal(server, 0);
    const base = `http://127.0.0.1:${port}`;
    const targets = [`${base}/one`, `${base}/two`, `${base}/three`];
    const remoteApproved = "https://approved-but-remote.example/article";
    const fixtureProfile = profile([...targets, remoteApproved]);
    assert.equal((await fetch(`${base}/v1/batches`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
    const oversized = await fetch(`${base}/v1/batches`, {
      method: "POST",
      headers: headers(teamAToken, "too-many"),
      body: JSON.stringify({ profile: fixtureProfile, targetUrls: Array.from({ length: 26 }, () => targets[0]), deviceIds: ["desktop"] }),
    });
    assert.equal(oversized.status, 400);
    assert.equal((await json<{ error: { code: string } }>(oversized)).error.code, "batch_limit_exceeded");
    const submission = JSON.stringify({
      profile: fixtureProfile,
      targetUrls: [targets[0], "https://not-approved.example/article", remoteApproved, targets[1], targets[2]],
      deviceIds: ["desktop"],
    });

    const created = await fetch(`${base}/v1/batches`, { method: "POST", headers: headers(teamAToken, "batch-one"), body: submission });
    assert.equal(created.status, 201);
    const first = await json<BatchResponse>(created);
    assert.equal(first.created, true);
    assert.deepEqual(first.counts, { total: 5, accepted: 2, rejected: 3, terminal: 0 });
    assert.equal(first.status, "in_progress");
    assert.equal(first.deadlineAt, undefined, "a batch must not imply one shared deadline");
    assert.deepEqual(first.items.map((item) => item.error?.code ?? "accepted"), [
      "accepted", "target_not_approved", "target_not_allowed", "accepted", "queue_capacity_reached",
    ]);
    const accepted = first.items.filter((item) => item.runId !== null);
    assert.equal(accepted.every((item) => item.deadlineAt !== null && item.runUrl !== null && item.reportUrl !== null), true);
    assert.equal(new Set(accepted.map((item) => item.runId)).size, 2);

    const repeated = await fetch(`${base}/v1/batches`, { method: "POST", headers: headers(teamAToken, "batch-one"), body: submission });
    assert.equal(repeated.status, 200);
    const repeatedBody = await json<BatchResponse>(repeated);
    assert.equal(repeatedBody.created, false);
    assert.equal(repeatedBody.batchId, first.batchId);
    assert.deepEqual(repeatedBody.items.map((item) => item.runId), first.items.map((item) => item.runId));

    const conflict = await fetch(`${base}/v1/batches`, {
      method: "POST",
      headers: headers(teamAToken, "batch-one"),
      body: JSON.stringify({ profile: fixtureProfile, targetUrls: [targets[0]], deviceIds: ["desktop"] }),
    });
    assert.equal(conflict.status, 409);
    assert.equal((await json<{ error: { code: string } }>(conflict)).error.code, "idempotency_conflict");
    assert.equal((await fetch(`${base}/v1/batches/${first.batchId}`, { headers: headers(teamBToken) })).status, 404);

    const firstJob = await store.claim("batch-worker-one");
    assert.equal(firstJob?.runId, accepted[0]?.runId);
    await store.complete(firstJob!.runId, "batch-worker-one", {
      reportId: "batch-report-one",
      overallVerdict: "PASS",
      checks: [{ testCaseId: "TC-1", verdict: "PASS" }],
    }, []);
    const secondJob = await store.claim("batch-worker-two");
    assert.equal(secondJob?.runId, accepted[1]?.runId);
    assert.equal(await store.interrupt(secondJob!.runId, "batch-worker-two", "fixture execution failed"), true);

    const completed = await json<BatchResponse>(await fetch(`${base}/v1/batches/${first.batchId}`, { headers: headers(teamAToken) }));
    assert.equal(completed.status, "completed_with_issues");
    assert.deepEqual(completed.counts, { total: 5, accepted: 2, rejected: 3, terminal: 2 });
    assert.equal(completed.items.some((item) => item.state === "completed"), true);
    assert.equal(completed.items.some((item) => item.state === "errored"), true);
    assert.equal(completed.items.filter((item) => item.state === "rejected").length, 3);
    assert.deepEqual(completed.completeness.devices, [{
      deviceId: "desktop", acceptedRuns: 2, terminalRuns: 2, reportedCaseIds: ["TC-1"],
    }]);
    assert.deepEqual(completed.completeness.cases.find((item) => item.testCaseId === "TC-1"), {
      testCaseId: "TC-1", reportedRuns: 1, expectedRuns: 2,
    });

    const explicitRetry = await fetch(`${base}/v1/batches`, {
      method: "POST",
      headers: headers(teamAToken, "batch-two"),
      body: JSON.stringify({ profile: fixtureProfile, targetUrls: [targets[0]], deviceIds: ["desktop"] }),
    });
    assert.equal(explicitRetry.status, 201);
    const retried = await json<BatchResponse>(explicitRetry);
    assert.notEqual(retried.batchId, first.batchId);
    assert.notEqual(retried.items[0]?.runId, accepted[0]?.runId);

    const duplicateTargets = await fetch(`${base}/v1/batches`, {
      method: "POST",
      headers: headers(teamAToken, "batch-three"),
      body: JSON.stringify({ profile: fixtureProfile, targetUrls: [targets[1], targets[1]], deviceIds: ["desktop", "desktop"] }),
    });
    assert.equal(duplicateTargets.status, 201);
    const duplicateBody = await json<BatchResponse>(duplicateTargets);
    assert.deepEqual(duplicateBody.items.map((item) => item.error?.code ?? "accepted"), [
      "accepted", "duplicate_device", "duplicate_target", "duplicate_target",
    ]);
  } finally {
    if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
