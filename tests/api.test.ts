import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";
import { createBearerAuthenticator } from "../src/api/auth.js";
import { createRunApiServer, listenLocal } from "../src/api/runs.js";
import { applyMigrations, PostgresStore } from "../src/store.js";

const teamAToken = "team-a-token-00000000000000000000";
const teamBToken = "team-b-token-00000000000000000000";

function headers(token: string, idempotencyKey?: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
  };
}

function profile(approvedUrls: string[]): unknown {
  return {
    schemaVersion: 1,
    profileId: "local-api-fixture",
    profileStatus: "fixture_only",
    site: { approvedUrls },
    devices: [{ id: "desktop", state: "enabled" }],
    logger: { backendCorrelation: { state: "disabled" } },
  };
}

async function body<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

test("real local API authenticates, scopes teams, deduplicates submissions, and reports saturation", {
  skip: process.env.TEST_DATABASE_URL ? false : "set TEST_DATABASE_URL to a disposable PostgreSQL database",
}, async () => {
  const connectionString = process.env.TEST_DATABASE_URL!;
  const schema = `validator_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString, max: 1 });
  const pool = new Pool({ connectionString, max: 6, options: `-c search_path=${schema}` });
  const artifacts = await mkdtemp(join(tmpdir(), "validator-api-artifacts-"));
  const artifactPath = join(artifacts, "capture.txt");
  const artifactBody = "real API artifact";
  let server: ReturnType<typeof createRunApiServer> | undefined;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await applyMigrations(pool);
    const store = new PostgresStore(pool, { capacity: 1, leaseMs: 5_000, runDeadlineMs: 20_000, retentionMs: 10_000 });
    server = createRunApiServer({
      store,
      dashboardRoot: process.cwd(),
      authenticate: createBearerAuthenticator([
        { token: teamAToken, userId: "alice", teamId: "team-a" },
        { token: teamBToken, userId: "bob", teamId: "team-b" },
      ]),
    });
    const port = await listenLocal(server, 0);
    const base = `http://127.0.0.1:${port}`;
    const targetOne = `${base}/fixture/one`;
    const targetTwo = `${base}/fixture/two`;
    const fixtureProfile = profile([targetOne, targetTwo]);

    const dashboard = await fetch(base);
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /VDO\.AI Player Validator/);

    const unauthorized = await fetch(`${base}/v1/runs`);
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");

    const malformed = await fetch(`${base}/v1/runs`, {
      method: "POST",
      headers: headers(teamAToken, "malformed"),
      body: `{"secret":"${teamAToken}"`,
    });
    const malformedText = await malformed.text();
    assert.equal(malformed.status, 400);
    assert.doesNotMatch(malformedText, new RegExp(teamAToken));
    assert.doesNotMatch(malformedText, /stack|\bat\s+\w+/i);

    const submission = JSON.stringify({ profile: fixtureProfile, targetUrl: targetOne, deviceId: "desktop" });
    const created = await fetch(`${base}/v1/runs`, { method: "POST", headers: headers(teamAToken, "retry-one"), body: submission });
    assert.equal(created.status, 201);
    const createdBody = await body<{ created: boolean; runId: string }>(created);
    assert.equal(createdBody.created, true);
    assert.equal(typeof createdBody.runId, "string");

    const repeated = await fetch(`${base}/v1/runs`, { method: "POST", headers: headers(teamAToken, "retry-one"), body: submission });
    const repeatedBody = await body<{ created: boolean; runId: string }>(repeated);
    assert.equal(repeated.status, 200);
    assert.equal(repeatedBody.created, false);
    assert.equal(repeatedBody.runId, createdBody.runId);

    const conflict = await fetch(`${base}/v1/runs`, {
      method: "POST",
      headers: headers(teamAToken, "retry-one"),
      body: JSON.stringify({ profile: fixtureProfile, targetUrl: targetTwo, deviceId: "desktop" }),
    });
    assert.equal(conflict.status, 409);
    assert.deepEqual((await body<{ error: unknown }>(conflict)).error, {
      code: "idempotency_conflict",
      message: "idempotency key was already used for a different submission",
    });

    assert.equal((await fetch(`${base}/v1/runs/${createdBody.runId}`, { headers: headers(teamAToken) })).status, 200);
    assert.equal((await fetch(`${base}/v1/runs/${createdBody.runId}`, { headers: headers(teamBToken) })).status, 404);

    const job = await store.claim("api-test-worker");
    assert.equal(job?.runId, createdBody.runId);
    await writeFile(artifactPath, artifactBody, "utf8");
    await store.saveArtifactReference(createdBody.runId, "api-test-worker", {
      artifactId: "artifact-api",
      kind: "text_fixture",
      storageRef: artifactPath,
      byteSize: Buffer.byteLength(artifactBody),
      sha256: `sha256:${"b".repeat(64)}`,
    });
    await store.saveEvidenceMetadata(createdBody.runId, "api-test-worker", {
      evidenceId: "evidence-api",
      articleEpochId: "article-api",
      deviceId: "desktop",
      source: "browser_dom",
      capturedAt: new Date().toISOString(),
      metadata: { artifactId: "artifact-api" },
    });
    await store.complete(createdBody.runId, "api-test-worker", { reportId: "report-api", overallVerdict: "PASS" }, [{
      findingId: "finding-api",
      kind: "check",
      category: "NONE",
      verdict: "PASS",
      evidenceIds: ["evidence-api"],
      payload: { state: "passed" },
    }]);

    assert.equal((await fetch(`${base}/v1/runs/${createdBody.runId}/report`, { headers: headers(teamBToken) })).status, 404);
    const report = await fetch(`${base}/v1/runs/${createdBody.runId}/report`, { headers: headers(teamAToken) });
    assert.equal(report.status, 200);
    assert.deepEqual((await body<{ report: unknown }>(report)).report, { reportId: "report-api", overallVerdict: "PASS" });

    assert.equal((await fetch(`${base}/v1/artifacts/artifact-api`, { headers: headers(teamBToken) })).status, 404);
    const artifact = await fetch(`${base}/v1/artifacts/artifact-api`, { headers: headers(teamAToken) });
    assert.equal(artifact.status, 200);
    assert.equal(await artifact.text(), artifactBody);

    const teamAList = await body<{ runs: Array<{ runId: string }> }>(await fetch(`${base}/v1/runs`, { headers: headers(teamAToken) }));
    const teamBList = await body<{ runs: unknown[] }>(await fetch(`${base}/v1/runs`, { headers: headers(teamBToken) }));
    assert.deepEqual(teamAList.runs.map((run) => run.runId), [createdBody.runId]);
    assert.deepEqual(teamBList.runs, []);

    const queued = await fetch(`${base}/v1/runs`, {
      method: "POST",
      headers: headers(teamAToken, "queued-two"),
      body: JSON.stringify({ profile: fixtureProfile, targetUrl: targetTwo, deviceId: "desktop" }),
    });
    assert.equal(queued.status, 201);
    const saturated = await fetch(`${base}/v1/runs`, {
      method: "POST",
      headers: headers(teamBToken, "queue-full"),
      body: JSON.stringify({ profile: fixtureProfile, targetUrl: targetOne, deviceId: "desktop" }),
    });
    const saturatedText = await saturated.text();
    assert.equal(saturated.status, 429);
    assert.match(saturatedText, /queue_capacity_reached/);
    assert.doesNotMatch(saturatedText, /postgres|stack|password|team-b-token/i);
  } finally {
    if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    await rm(artifacts, { recursive: true, force: true });
  }
});
