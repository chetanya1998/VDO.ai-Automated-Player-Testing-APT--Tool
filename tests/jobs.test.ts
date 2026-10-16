import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";
import { applyMigrations, PostgresStore, QueueCapacityError } from "../src/store.js";
import { ValidatorWorker } from "../src/worker.js";

const migrationPath = join(process.cwd(), "db", "migrations", "001_runs.sql");

test("PostgreSQL schema keeps artifacts external and defines lease claim indexes", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const artifactTable = migration.slice(migration.indexOf("CREATE TABLE validator_artifact_refs"));
  assert.match(artifactTable, /storage_ref text NOT NULL UNIQUE/);
  assert.match(artifactTable, /byte_size bigint NOT NULL/);
  assert.doesNotMatch(artifactTable, /\b(bytea|content|payload)\b/i);
  assert.match(migration, /WHERE state = 'queued'/);
  assert.match(migration, /WHERE state = 'leased'/);
});

test("real PostgreSQL migration, claims, crash recovery, deadline, worker, and retention", {
  skip: process.env.TEST_DATABASE_URL ? false : "set TEST_DATABASE_URL to a disposable PostgreSQL database",
}, async () => {
  const connectionString = process.env.TEST_DATABASE_URL!;
  const schema = `validator_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString, max: 2 });
  const pool = new Pool({ connectionString, max: 6, options: `-c search_path=${schema}` });
  const artifactDirectory = await mkdtemp(join(tmpdir(), "validator-artifacts-"));
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await applyMigrations(pool);
    await applyMigrations(pool);
    const store = new PostgresStore(pool, { capacity: 2, leaseMs: 1_000, runDeadlineMs: 5_000, retentionMs: 10_000 });
    const queued = await store.enqueueRun({
      runId: "run-claim",
      profileId: "profile-1",
      profileVersion: 1,
      profileHash: "sha256:profile-1",
      profileSnapshot: { profileId: "profile-1" },
      targetUrl: "https://publisher.example/article",
      deviceId: "desktop",
    });
    assert.ok(Date.parse(queued.deadlineAt) - Date.parse(queued.createdAt) >= 4_900);

    const [left, right] = await Promise.all([store.claim("worker-left"), store.claim("worker-right")]);
    const claimed = left ?? right;
    assert.ok(claimed);
    assert.equal([left, right].filter((item) => item !== null).length, 1);
    const owner = left === null ? "worker-right" : "worker-left";
    await store.saveProgress("run-claim", owner, { stage: "capture" }, { reportId: "partial-claim", coverage: { checksCompleted: 3 } });
    await store.saveEvidenceMetadata("run-claim", owner, {
      evidenceId: "ev-crash",
      articleEpochId: "article-1",
      deviceId: "desktop",
      source: "browser_network",
      capturedAt: new Date().toISOString(),
      metadata: { status: 500 },
    });
    await store.expireInterrupted(new Date(Date.parse(claimed!.leaseExpiresAt) + 1));
    const interrupted = await store.getRun("run-claim");
    assert.equal(interrupted?.executionState, "errored");
    assert.deepEqual(interrupted?.progress, { stage: "capture" });
    assert.equal(interrupted?.evidence[0]?.evidenceId, "ev-crash");
    assert.equal(await store.claim("worker-retry"), null, "interrupted live activity must not be requeued");

    const deadlineStore = new PostgresStore(pool, { capacity: 2, leaseMs: 1_000, runDeadlineMs: 1_000, retentionMs: 10_000 });
    const deadline = await deadlineStore.enqueueRun({
      runId: "run-deadline",
      profileId: "profile-1",
      profileVersion: 1,
      profileHash: "sha256:profile-1",
      profileSnapshot: { profileId: "profile-1" },
      targetUrl: "https://publisher.example/deadline",
      deviceId: "desktop",
    });
    await deadlineStore.expireInterrupted(new Date(Date.parse(deadline.deadlineAt) + 1));
    assert.equal((await deadlineStore.getRun("run-deadline"))?.executionState, "timed_out");

    const workerStore = new PostgresStore(pool, { capacity: 2, leaseMs: 3_000, runDeadlineMs: 5_000, retentionMs: 10_000 });
    await workerStore.enqueueRun({
      runId: "run-worker",
      profileId: "profile-1",
      profileVersion: 1,
      profileHash: "sha256:profile-1",
      profileSnapshot: { profileId: "profile-1" },
      targetUrl: "https://publisher.example/worker",
      deviceId: "desktop",
    });
    const worker = new ValidatorWorker("single-worker", workerStore, async (context) => {
      await context.saveEvidenceMetadata({
        evidenceId: "ev-worker",
        articleEpochId: "article-1",
        deviceId: "desktop",
        source: "browser_dom",
        capturedAt: new Date().toISOString(),
        metadata: { width: 640, height: 360 },
      });
      await context.saveProgress({ stage: "report" }, { reportId: "partial-worker", coverage: { checksCompleted: 23 } });
      return {
        report: { reportId: "report-worker" },
        findings: [{ findingId: "TC-14", kind: "check", category: "RUNTIME_BROWSER", verdict: "FAIL", evidenceIds: ["ev-worker"], payload: { state: "covered" } }],
      };
    });
    const [workerResult, concurrent] = await Promise.allSettled([worker.runOnce(), worker.runOnce()]);
    assert.equal(workerResult.status, "fulfilled");
    assert.equal(workerResult.status === "fulfilled" ? workerResult.value.state : null, "completed");
    assert.equal(concurrent.status, "rejected");
    assert.equal((await workerStore.getRun("run-worker"))?.findings.length, 1);

    const retentionStore = new PostgresStore(pool, { capacity: 2, leaseMs: 3_000, runDeadlineMs: 5_000, retentionMs: 50 });
    await retentionStore.enqueueRun({
      runId: "run-retention",
      profileId: "profile-1",
      profileVersion: 1,
      profileHash: "sha256:profile-1",
      profileSnapshot: { profileId: "profile-1" },
      targetUrl: "https://publisher.example/retention",
      deviceId: "desktop",
    });
    const retentionJob = await retentionStore.claim("retention-worker");
    assert.ok(retentionJob);
    const artifactPath = join(artifactDirectory, "capture.har");
    await writeFile(artifactPath, "bounded artifact", "utf8");
    await retentionStore.saveArtifactReference("run-retention", "retention-worker", {
      artifactId: "artifact-1",
      kind: "sanitized_har",
      storageRef: artifactPath,
      byteSize: 16,
      sha256: `sha256:${"a".repeat(64)}`,
    });
    await retentionStore.saveEvidenceMetadata("run-retention", "retention-worker", {
      evidenceId: "ev-retention",
      articleEpochId: "article-1",
      deviceId: "desktop",
      source: "browser_network",
      capturedAt: new Date().toISOString(),
      metadata: { artifactId: "artifact-1" },
    });
    await retentionStore.complete("run-retention", "retention-worker", { reportId: "report-retention" }, [{
      findingId: "TC-12", kind: "check", category: "RUNTIME_BROWSER", verdict: "FAIL", evidenceIds: ["ev-retention"], payload: { state: "failed" },
    }]);
    const cleanup = await retentionStore.cleanupExpired((storageRef) => unlink(storageRef), new Date(Date.now() + 1_000));
    assert.deepEqual(cleanup, { artifacts: 1, runs: 1 });
    assert.equal(await retentionStore.getRun("run-retention"), null);
    await assert.rejects(access(artifactPath));
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test("queue admission is bounded in real PostgreSQL", {
  skip: process.env.TEST_DATABASE_URL ? false : "set TEST_DATABASE_URL to a disposable PostgreSQL database",
}, async () => {
  const connectionString = process.env.TEST_DATABASE_URL!;
  const schema = `validator_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString, max: 1 });
  const pool = new Pool({ connectionString, max: 2, options: `-c search_path=${schema}` });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await applyMigrations(pool);
    const store = new PostgresStore(pool, { capacity: 1, leaseMs: 1_000, runDeadlineMs: 5_000, retentionMs: 10_000 });
    const input = {
      profileId: "profile-capacity",
      profileVersion: 1,
      profileHash: "sha256:capacity",
      profileSnapshot: { profileId: "profile-capacity" },
      targetUrl: "https://publisher.example/article",
      deviceId: "desktop",
    } as const;
    await store.enqueueRun({ ...input, runId: "run-one" });
    await assert.rejects(store.enqueueRun({ ...input, runId: "run-two" }), QueueCapacityError);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
