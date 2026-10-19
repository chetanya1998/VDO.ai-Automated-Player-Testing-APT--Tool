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
  const outsideArtifacts = await mkdtemp(join(tmpdir(), "validator-api-outside-"));
  const artifactPath = join(artifacts, "capture.txt");
  const outsideArtifactPath = join(outsideArtifacts, "outside.txt");
  const artifactBody = "real API artifact";
  let server: ReturnType<typeof createRunApiServer> | undefined;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await applyMigrations(pool);
    const store = new PostgresStore(pool, { capacity: 1, leaseMs: 5_000, runDeadlineMs: 20_000, retentionMs: 10_000 });
    server = createRunApiServer({
      store,
      dashboardRoot: process.cwd(),
      artifactRoot: artifacts,
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

    assert.equal((await fetch(`${base}/health/live`)).status, 200);
    assert.equal((await fetch(`${base}/health/ready`)).status, 200);

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
    await writeFile(outsideArtifactPath, "must not be served", "utf8");
    await store.saveArtifactReference(createdBody.runId, "api-test-worker", {
      artifactId: "artifact-api",
      kind: "text_fixture",
      storageRef: artifactPath,
      byteSize: Buffer.byteLength(artifactBody),
      sha256: `sha256:${"b".repeat(64)}`,
    });
    await store.saveArtifactReference(createdBody.runId, "api-test-worker", {
      artifactId: "artifact-outside-root",
      kind: "text_fixture",
      storageRef: outsideArtifactPath,
      byteSize: 18,
      sha256: `sha256:${"c".repeat(64)}`,
    });
    await store.saveEvidenceMetadata(createdBody.runId, "api-test-worker", {
      evidenceId: "evidence-api",
      articleEpochId: "article-api",
      deviceId: "desktop",
      source: "browser_dom",
      capturedAt: new Date().toISOString(),
      metadata: {
        artifactId: "artifact-api",
        kind: "logger_request",
        canonicalEvent: "loaded",
        durationMs: 37,
        authorization: "Bearer SECRET_SENTINEL",
      },
    });
    const storedReport = {
      reportId: "report-api",
      overallVerdict: "FAIL",
      checks: [{
        testCaseId: "TC-5",
        verdict: "FAIL",
        category: "IMPLEMENTATION",
        scope: { deviceId: "desktop", articleEpochId: "article-api", tagName: "v-api" },
        expected: "complete logger sequence",
        observed: "<script>globalThis.injected=true</script>",
        evidenceIds: ["evidence-api"],
      }],
      diagnoses: [{
        primarySymptom: { testCaseId: "TC-5" },
        suggestedOwner: "Player engineering",
        nextChecks: ["Inspect the logger sequence"],
      }],
      coverage: { totalCases: 23, policyVersion: "fixture-v1" },
      limitations: ["Fixture-only result"],
    };
    await store.complete(createdBody.runId, "api-test-worker", storedReport, [{
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
    assert.deepEqual((await body<{ report: unknown }>(report)).report, storedReport);

    assert.equal((await fetch(`${base}/v1/runs/${createdBody.runId}/export.json`, { headers: headers(teamBToken) })).status, 404);
    const jsonExport = await fetch(`${base}/v1/runs/${createdBody.runId}/export.json`, { headers: headers(teamAToken) });
    assert.equal(jsonExport.status, 200);
    assert.match(jsonExport.headers.get("content-disposition") ?? "", /attachment; filename="vdo-validator-.*\.json"/);
    const jsonExportText = await jsonExport.text();
    const exported = JSON.parse(jsonExportText) as { summary: { checkCount: number }; artifacts: Array<{ artifactId: string }>; report: unknown };
    assert.equal(exported.summary.checkCount, 1);
    assert.deepEqual(exported.report, storedReport);
    assert.deepEqual(exported.artifacts.map((item) => item.artifactId), ["artifact-api", "artifact-outside-root"]);
    assert.doesNotMatch(jsonExportText, /SECRET_SENTINEL|storageRef|validator-api-artifacts/);

    const htmlExport = await fetch(`${base}/v1/runs/${createdBody.runId}/export.html`, { headers: headers(teamAToken) });
    assert.equal(htmlExport.status, 200);
    assert.match(htmlExport.headers.get("content-type") ?? "", /^text\/html/);
    assert.match(htmlExport.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    const htmlExportText = await htmlExport.text();
    assert.match(htmlExportText, /&lt;script&gt;globalThis\.injected=true&lt;\/script&gt;/);
    assert.doesNotMatch(htmlExportText, /<script>|\b(?:src|href)\s*=/i);

    assert.equal((await fetch(`${base}/v1/artifacts/artifact-api`, { headers: headers(teamBToken) })).status, 404);
    const artifact = await fetch(`${base}/v1/artifacts/artifact-api`, { headers: headers(teamAToken) });
    assert.equal(artifact.status, 200);
    assert.equal(await artifact.text(), artifactBody);
    const outsideArtifact = await fetch(`${base}/v1/artifacts/artifact-outside-root`, { headers: headers(teamAToken) });
    assert.equal(outsideArtifact.status, 500);
    assert.deepEqual(await body<{ error: unknown }>(outsideArtifact), { error: { code: "internal_error", message: "request failed" } });

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
    const queuedBody = await body<{ runId: string }>(queued.clone());
    assert.equal((await fetch(`${base}/v1/runs/${queuedBody.runId}/export.json`, { headers: headers(teamAToken) })).status, 409);
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
    await rm(outsideArtifacts, { recursive: true, force: true });
  }
});
