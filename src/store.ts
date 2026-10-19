import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";
import type { JsonValue } from "./contracts.js";

export interface StoreOptions {
  capacity: number;
  leaseMs: number;
  runDeadlineMs: number;
  retentionMs: number;
}

export interface EnqueueRunInput {
  runId: string;
  profileId: string;
  profileVersion: number;
  profileHash: string;
  profileSnapshot: JsonValue;
  targetUrl: string;
  deviceId: string;
  teamId?: string;
  userId?: string;
  idempotencyKey?: string;
  submissionHash?: string;
}

export interface EnqueueRunResult {
  runId: string;
  created: boolean;
  createdAt: string;
  deadlineAt: string;
}

export interface BatchItemInput {
  itemIndex: number;
  targetUrl: string;
  deviceId: string;
  runId: string;
  rejection?: { code: string; message: string };
}

export interface EnqueueBatchInput {
  batchId: string;
  profileId: string;
  profileVersion: number;
  profileHash: string;
  profileSnapshot: JsonValue;
  teamId: string;
  userId: string;
  idempotencyKey: string;
  submissionHash: string;
  items: BatchItemInput[];
}

export interface EnqueueBatchResult {
  batchId: string;
  created: boolean;
}

export interface BatchItemDetail {
  itemIndex: number;
  targetUrl: string;
  deviceId: string;
  admissionState: "accepted" | "rejected";
  state: string;
  runId: string | null;
  deadlineAt: string | null;
  reportAvailable: boolean;
  reportedCaseIds: string[];
  error: { code: string; message: string } | null;
}

export interface BatchDetail {
  batchId: string;
  createdAt: string;
  status: "in_progress" | "completed" | "completed_with_issues" | "rejected";
  counts: {
    total: number;
    accepted: number;
    rejected: number;
    terminal: number;
  };
  completeness: {
    devices: Array<{
      deviceId: string;
      acceptedRuns: number;
      terminalRuns: number;
      reportedCaseIds: string[];
    }>;
    cases: Array<{ testCaseId: string; reportedRuns: number; expectedRuns: number }>;
  };
  items: BatchItemDetail[];
}

export interface RunSummary {
  runId: string;
  targetUrl: string;
  deviceId: string;
  executionState: string;
  createdAt: string;
  deadlineAt: string;
  startedAt: string | null;
  endedAt: string | null;
  progress: JsonValue;
}

export interface RunDetail extends RunSummary {
  partialReport: ReportSnapshot | null;
}

export interface TeamReport {
  runId: string;
  executionState: string;
  report: ReportSnapshot | null;
  evidence: EvidenceMetadataInput[];
  findings: FindingInput[];
  artifacts: Array<Omit<ArtifactReferenceInput, "storageRef">>;
}

export interface TeamReportExportSource {
  run: RunDetail;
  report: TeamReport;
  profile: {
    profileId: string;
    profileVersion: number;
    profileHash: string;
    snapshot: JsonValue;
  };
}

export interface TeamArtifact {
  artifactId: string;
  kind: string;
  storageRef: string;
  byteSize: number;
  sha256: string;
}

export interface ClaimedJob {
  jobId: string;
  runId: string;
  targetUrl: string;
  deviceId: string;
  deadlineAt: string;
  leaseExpiresAt: string;
}

export interface EvidenceMetadataInput {
  evidenceId: string;
  articleEpochId: string;
  deviceId: string;
  source: string;
  capturedAt: string;
  metadata: { [key: string]: JsonValue };
}

export interface ArtifactReferenceInput {
  artifactId: string;
  kind: string;
  storageRef: string;
  byteSize: number;
  sha256: string;
}

export interface FindingInput {
  findingId: string;
  kind: "check" | "diagnosis";
  category: string;
  verdict: string;
  evidenceIds: string[];
  payload: JsonValue;
}

export interface ReportSnapshot {
  reportId: string;
  overallVerdict?: string;
  checks?: JsonValue[];
  diagnoses?: JsonValue[];
  coverage?: JsonValue;
  limitations?: string[];
}

export interface PersistedRun {
  runId: string;
  executionState: string;
  progress: JsonValue;
  partialReport: ReportSnapshot | null;
  finalReport: ReportSnapshot | null;
  evidence: EvidenceMetadataInput[];
  artifacts: ArtifactReferenceInput[];
  findings: FindingInput[];
}

const DEFAULT_OPTIONS: StoreOptions = {
  capacity: 25,
  leaseMs: 30_000,
  runDeadlineMs: 300_000,
  retentionMs: 30 * 24 * 60 * 60 * 1_000,
};

export class QueueCapacityError extends Error {
  constructor(capacity: number) {
    super(`validator queue capacity ${capacity} reached`);
    this.name = "QueueCapacityError";
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("idempotency key was already used for a different submission");
    this.name = "IdempotencyConflictError";
  }
}

function positive(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function instant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function reportJson(report: ReportSnapshot): string {
  if (report.reportId.trim() === "") throw new TypeError("reportId is required");
  const value = JSON.stringify(report);
  if (Buffer.byteLength(value, "utf8") > 1_048_576) throw new TypeError("report snapshot exceeds 1 MiB; store large artifacts externally");
  if (/"(?:evidence|artifacts|screenshots|har)"\s*:/i.test(value)) throw new TypeError("report snapshot must reference evidence and artifacts instead of embedding them");
  return value;
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function applyMigrations(pool: Pool, directory = join(process.cwd(), "db", "migrations")): Promise<void> {
  const files = (await readdir(directory)).filter((file) => /^\d+_.*\.sql$/.test(file)).sort();
  await transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(867530901)");
    await client.query(`CREATE TABLE IF NOT EXISTS validator_schema_migrations (
      migration text PRIMARY KEY,
      sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    for (const file of files) {
      const sql = await readFile(join(directory, file), "utf8");
      const sha256 = createHash("sha256").update(sql).digest("hex");
      const prior = await client.query<{ sha256: string }>("SELECT sha256 FROM validator_schema_migrations WHERE migration = $1", [file]);
      if (prior.rows[0] !== undefined) {
        if (prior.rows[0].sha256 !== sha256) throw new Error(`applied migration changed: ${file}`);
        continue;
      }
      await client.query(sql);
      await client.query("INSERT INTO validator_schema_migrations (migration, sha256) VALUES ($1, $2)", [file, sha256]);
    }
  });
}

export class PostgresStore {
  readonly options: StoreOptions;

  constructor(private readonly pool: Pool, options: Partial<StoreOptions> = {}) {
    const runDeadlineMs = positive(options.runDeadlineMs ?? DEFAULT_OPTIONS.runDeadlineMs, "runDeadlineMs");
    if (runDeadlineMs > 300_000) throw new TypeError("runDeadlineMs must not exceed 300000");
    this.options = {
      capacity: positive(options.capacity ?? DEFAULT_OPTIONS.capacity, "capacity"),
      leaseMs: positive(options.leaseMs ?? DEFAULT_OPTIONS.leaseMs, "leaseMs"),
      runDeadlineMs,
      retentionMs: positive(options.retentionMs ?? DEFAULT_OPTIONS.retentionMs, "retentionMs"),
    };
  }

  async isReady(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async enqueueRun(input: EnqueueRunInput): Promise<EnqueueRunResult> {
    return transaction(this.pool, async (client) => {
      const teamId = input.teamId ?? "system";
      const userId = input.userId ?? "system";
      if (teamId.trim() === "" || userId.trim() === "") throw new TypeError("teamId and userId are required");
      if ((input.idempotencyKey === undefined) !== (input.submissionHash === undefined)) {
        throw new TypeError("idempotencyKey and submissionHash must be provided together");
      }
      await client.query("SELECT pg_advisory_xact_lock(867530902)");
      if (input.idempotencyKey !== undefined) {
        if (input.idempotencyKey.trim() === "" || Buffer.byteLength(input.idempotencyKey, "utf8") > 200) {
          throw new TypeError("idempotencyKey must contain 1 to 200 bytes");
        }
        const prior = await client.query<{ run_id: string; submission_hash: string; created_at: Date; deadline_at: Date }>(
          `SELECT run_id, submission_hash, created_at, deadline_at FROM validator_runs
           WHERE team_id = $1 AND idempotency_key = $2`,
          [teamId, input.idempotencyKey],
        );
        if (prior.rows[0] !== undefined) {
          if (prior.rows[0].submission_hash !== input.submissionHash) throw new IdempotencyConflictError();
          return {
            runId: prior.rows[0].run_id,
            created: false,
            createdAt: instant(prior.rows[0].created_at),
            deadlineAt: instant(prior.rows[0].deadline_at),
          };
        }
      }
      const active = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM validator_jobs WHERE state IN ('queued', 'leased')");
      if (Number(active.rows[0]?.count ?? 0) >= this.options.capacity) throw new QueueCapacityError(this.options.capacity);
      await client.query(
        `INSERT INTO validator_profiles (profile_id, profile_version, profile_hash, snapshot)
         VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (profile_id, profile_version) DO NOTHING`,
        [input.profileId, input.profileVersion, input.profileHash, JSON.stringify(input.profileSnapshot)],
      );
      const profile = await client.query<{ profile_hash: string }>(
        "SELECT profile_hash FROM validator_profiles WHERE profile_id = $1 AND profile_version = $2",
        [input.profileId, input.profileVersion],
      );
      if (profile.rows[0]?.profile_hash !== input.profileHash) throw new Error("profile version is immutable and its hash does not match");
      const run = await client.query<{ created_at: Date; deadline_at: Date }>(
        `INSERT INTO validator_runs (
           run_id, profile_id, profile_version, target_url, device_id, deadline_at, retention_until,
           team_id, user_id, idempotency_key, submission_hash
         ) VALUES (
           $1, $2, $3, $4, $5,
           clock_timestamp() + ($6 * interval '1 millisecond'),
           clock_timestamp() + ($7 * interval '1 millisecond'),
           $8, $9, $10, $11
         ) RETURNING created_at, deadline_at`,
        [
          input.runId, input.profileId, input.profileVersion, input.targetUrl, input.deviceId,
          this.options.runDeadlineMs, this.options.retentionMs, teamId, userId,
          input.idempotencyKey ?? null, input.submissionHash ?? null,
        ],
      );
      await client.query(
        "INSERT INTO validator_jobs (run_id, deadline_at) SELECT run_id, deadline_at FROM validator_runs WHERE run_id = $1",
        [input.runId],
      );
      return {
        runId: input.runId,
        created: true,
        createdAt: instant(run.rows[0]!.created_at),
        deadlineAt: instant(run.rows[0]!.deadline_at),
      };
    });
  }

  async enqueueBatch(input: EnqueueBatchInput): Promise<EnqueueBatchResult> {
    return transaction(this.pool, async (client) => {
      if (input.teamId.trim() === "" || input.userId.trim() === "") throw new TypeError("teamId and userId are required");
      if (input.idempotencyKey.trim() === "" || Buffer.byteLength(input.idempotencyKey, "utf8") > 200) {
        throw new TypeError("idempotencyKey must contain 1 to 200 bytes");
      }
      if (input.items.length === 0) throw new TypeError("batch items are required");
      if (new Set(input.items.map((item) => item.itemIndex)).size !== input.items.length) throw new TypeError("batch item indexes must be unique");
      await client.query("SELECT pg_advisory_xact_lock(867530902)");
      const prior = await client.query<{ batch_id: string; submission_hash: string }>(
        "SELECT batch_id, submission_hash FROM validator_batches WHERE team_id = $1 AND idempotency_key = $2",
        [input.teamId, input.idempotencyKey],
      );
      if (prior.rows[0] !== undefined) {
        if (prior.rows[0].submission_hash !== input.submissionHash) throw new IdempotencyConflictError();
        return { batchId: prior.rows[0].batch_id, created: false };
      }
      await client.query(
        `INSERT INTO validator_profiles (profile_id, profile_version, profile_hash, snapshot)
         VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (profile_id, profile_version) DO NOTHING`,
        [input.profileId, input.profileVersion, input.profileHash, JSON.stringify(input.profileSnapshot)],
      );
      const profile = await client.query<{ profile_hash: string }>(
        "SELECT profile_hash FROM validator_profiles WHERE profile_id = $1 AND profile_version = $2",
        [input.profileId, input.profileVersion],
      );
      if (profile.rows[0]?.profile_hash !== input.profileHash) throw new Error("profile version is immutable and its hash does not match");
      await client.query(
        `INSERT INTO validator_batches (
           batch_id, team_id, user_id, idempotency_key, submission_hash, profile_id, profile_version
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [input.batchId, input.teamId, input.userId, input.idempotencyKey, input.submissionHash, input.profileId, input.profileVersion],
      );
      const active = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM validator_jobs WHERE state IN ('queued', 'leased')");
      let available = Math.max(0, this.options.capacity - Number(active.rows[0]?.count ?? 0));
      for (const item of [...input.items].sort((left, right) => left.itemIndex - right.itemIndex)) {
        const rejection = item.rejection ?? (available === 0
          ? { code: "queue_capacity_reached", message: "validator queue capacity reached" }
          : null);
        if (rejection !== null) {
          await client.query(
            `INSERT INTO validator_batch_items (
               batch_id, item_index, target_url, device_id, admission_state, error_code, error_message
             ) VALUES ($1, $2, $3, $4, 'rejected', $5, $6)`,
            [input.batchId, item.itemIndex, item.targetUrl, item.deviceId, rejection.code, rejection.message],
          );
          continue;
        }
        await client.query(
          `INSERT INTO validator_runs (
             run_id, profile_id, profile_version, target_url, device_id, deadline_at, retention_until,
             team_id, user_id
           ) VALUES (
             $1, $2, $3, $4, $5,
             clock_timestamp() + ($6 * interval '1 millisecond'),
             clock_timestamp() + ($7 * interval '1 millisecond'),
             $8, $9
           )`,
          [
            item.runId, input.profileId, input.profileVersion, item.targetUrl, item.deviceId,
            this.options.runDeadlineMs, this.options.retentionMs, input.teamId, input.userId,
          ],
        );
        await client.query(
          "INSERT INTO validator_jobs (run_id, deadline_at) SELECT run_id, deadline_at FROM validator_runs WHERE run_id = $1",
          [item.runId],
        );
        await client.query(
          `INSERT INTO validator_batch_items (batch_id, item_index, target_url, device_id, admission_state, run_id)
           VALUES ($1, $2, $3, $4, 'accepted', $5)`,
          [input.batchId, item.itemIndex, item.targetUrl, item.deviceId, item.runId],
        );
        available -= 1;
      }
      return { batchId: input.batchId, created: true };
    });
  }

  async getBatchForTeam(teamId: string, batchId: string): Promise<BatchDetail | null> {
    const result = await this.pool.query<{
      batch_id: string; batch_created_at: Date; item_index: number; target_url: string; device_id: string;
      admission_state: "accepted" | "rejected"; error_code: string | null; error_message: string | null;
      run_id: string | null; execution_state: string | null; deadline_at: Date | null; final_report: ReportSnapshot | null;
    }>(
      `SELECT batches.batch_id, batches.created_at AS batch_created_at,
              items.item_index, items.target_url, items.device_id, items.admission_state,
              items.error_code, items.error_message, items.run_id,
              runs.execution_state, runs.deadline_at, runs.final_report
       FROM validator_batches AS batches
       JOIN validator_batch_items AS items ON items.batch_id = batches.batch_id
       LEFT JOIN validator_runs AS runs ON runs.run_id = items.run_id
       WHERE batches.team_id = $1 AND batches.batch_id = $2
       ORDER BY items.item_index`,
      [teamId, batchId],
    );
    if (result.rows[0] === undefined) return null;
    const items: BatchItemDetail[] = result.rows.map((row) => {
      const reportedCaseIds = Array.isArray(row.final_report?.checks)
        ? [...new Set(row.final_report.checks.map((check) => {
          if (check === null || typeof check !== "object" || Array.isArray(check)) return null;
          const value = check.testCaseId;
          return typeof value === "string" ? value : null;
        }).filter((value): value is string => value !== null))].sort((left, right) => Number(left.slice(3)) - Number(right.slice(3)))
        : [];
      const state = row.admission_state === "rejected" ? "rejected" : row.execution_state ?? "expired";
      return {
        itemIndex: row.item_index,
        targetUrl: row.target_url,
        deviceId: row.device_id,
        admissionState: row.admission_state,
        state,
        runId: row.run_id,
        deadlineAt: row.deadline_at === null ? null : instant(row.deadline_at),
        reportAvailable: row.final_report !== null,
        reportedCaseIds,
        error: row.error_code === null || row.error_message === null ? null : { code: row.error_code, message: row.error_message },
      };
    });
    const accepted = items.filter((item) => item.admissionState === "accepted");
    const rejected = items.length - accepted.length;
    const terminalStates = new Set(["completed", "timed_out", "errored", "expired"]);
    const terminal = accepted.filter((item) => terminalStates.has(item.state)).length;
    const deviceIds = [...new Set(items.map((item) => item.deviceId))].sort();
    const cases = Array.from({ length: 23 }, (_, index) => `TC-${index + 1}`);
    const hasTerminalFailures = accepted.some((item) => item.state !== "completed" && terminalStates.has(item.state));
    const status = accepted.length === 0 ? "rejected"
      : terminal < accepted.length ? "in_progress"
      : rejected > 0 || hasTerminalFailures ? "completed_with_issues"
      : "completed";
    return {
      batchId: result.rows[0].batch_id,
      createdAt: instant(result.rows[0].batch_created_at),
      status,
      counts: { total: items.length, accepted: accepted.length, rejected, terminal },
      completeness: {
        devices: deviceIds.map((deviceId) => {
          const runs = accepted.filter((item) => item.deviceId === deviceId);
          return {
            deviceId,
            acceptedRuns: runs.length,
            terminalRuns: runs.filter((item) => terminalStates.has(item.state)).length,
            reportedCaseIds: [...new Set(runs.flatMap((item) => item.reportedCaseIds))].sort((left, right) => Number(left.slice(3)) - Number(right.slice(3))),
          };
        }),
        cases: cases.map((testCaseId) => ({
          testCaseId,
          reportedRuns: accepted.filter((item) => item.reportedCaseIds.includes(testCaseId)).length,
          expectedRuns: accepted.length,
        })),
      },
      items,
    };
  }

  async getRunSummary(teamId: string, runId: string): Promise<RunDetail | null> {
    const result = await this.pool.query<{
      run_id: string; target_url: string; device_id: string; execution_state: string;
      created_at: Date; deadline_at: Date; started_at: Date | null; ended_at: Date | null;
      progress: JsonValue; partial_report: ReportSnapshot | null;
    }>(
      `SELECT run_id, target_url, device_id, execution_state, created_at, deadline_at, started_at, ended_at,
              progress, partial_report
       FROM validator_runs WHERE team_id = $1 AND run_id = $2`,
      [teamId, runId],
    );
    const row = result.rows[0];
    return row === undefined ? null : { ...this.runSummary(row), partialReport: row.partial_report };
  }

  async listRuns(teamId: string): Promise<RunSummary[]> {
    // shortcut: return the newest 100 runs until the dashboard needs cursor pagination.
    const result = await this.pool.query<{
      run_id: string; target_url: string; device_id: string; execution_state: string;
      created_at: Date; deadline_at: Date; started_at: Date | null; ended_at: Date | null; progress: JsonValue;
    }>(
      `SELECT run_id, target_url, device_id, execution_state, created_at, deadline_at, started_at, ended_at, progress
       FROM validator_runs WHERE team_id = $1 ORDER BY created_at DESC, run_id LIMIT 100`,
      [teamId],
    );
    return result.rows.map((row) => this.runSummary(row));
  }

  async getReportForTeam(teamId: string, runId: string): Promise<TeamReport | null> {
    const run = await this.pool.query<{ run_id: string; execution_state: string; final_report: ReportSnapshot | null }>(
      "SELECT run_id, execution_state, final_report FROM validator_runs WHERE team_id = $1 AND run_id = $2",
      [teamId, runId],
    );
    const row = run.rows[0];
    if (row === undefined) return null;
    const [evidence, findings, artifacts] = await Promise.all([
      this.pool.query<{
        evidence_id: string; article_epoch_id: string; device_id: string; source: string;
        captured_at: Date; metadata: { [key: string]: JsonValue };
      }>(
        `SELECT evidence_id, article_epoch_id, device_id, source, captured_at, metadata
         FROM validator_evidence_metadata WHERE run_id = $1 ORDER BY captured_at, evidence_id`,
        [runId],
      ),
      this.pool.query<{
        finding_id: string; kind: "check" | "diagnosis"; category: string;
        verdict: string; evidence_ids: string[]; payload: JsonValue;
      }>(
        `SELECT finding_id, kind, category, verdict, evidence_ids, payload
         FROM validator_findings WHERE run_id = $1 ORDER BY finding_id`,
        [runId],
      ),
      this.pool.query<{ artifact_id: string; kind: string; byte_size: string; sha256: string }>(
        `SELECT artifact_id, kind, byte_size::text, sha256
         FROM validator_artifact_refs WHERE run_id = $1 ORDER BY artifact_id`,
        [runId],
      ),
    ]);
    return {
      runId: row.run_id,
      executionState: row.execution_state,
      report: row.final_report,
      evidence: evidence.rows.map((item) => ({
        evidenceId: item.evidence_id,
        articleEpochId: item.article_epoch_id,
        deviceId: item.device_id,
        source: item.source,
        capturedAt: instant(item.captured_at),
        metadata: item.metadata,
      })),
      findings: findings.rows.map((item) => ({
        findingId: item.finding_id,
        kind: item.kind,
        category: item.category,
        verdict: item.verdict,
        evidenceIds: item.evidence_ids,
        payload: item.payload,
      })),
      artifacts: artifacts.rows.map((item) => ({
        artifactId: item.artifact_id,
        kind: item.kind,
        byteSize: Number(item.byte_size),
        sha256: item.sha256,
      })),
    };
  }

  async getReportExportSource(teamId: string, runId: string): Promise<TeamReportExportSource | null> {
    const result = await this.pool.query<{
      run_id: string; target_url: string; device_id: string; execution_state: string;
      created_at: Date; deadline_at: Date; started_at: Date | null; ended_at: Date | null;
      progress: JsonValue; partial_report: ReportSnapshot | null;
      profile_id: string; profile_version: number; profile_hash: string; profile_snapshot: JsonValue;
    }>(
      `SELECT runs.run_id, runs.target_url, runs.device_id, runs.execution_state, runs.created_at,
              runs.deadline_at, runs.started_at, runs.ended_at, runs.progress, runs.partial_report,
              profiles.profile_id, profiles.profile_version, profiles.profile_hash,
              profiles.snapshot AS profile_snapshot
       FROM validator_runs AS runs
       JOIN validator_profiles AS profiles
         ON profiles.profile_id = runs.profile_id AND profiles.profile_version = runs.profile_version
       WHERE runs.team_id = $1 AND runs.run_id = $2`,
      [teamId, runId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const report = await this.getReportForTeam(teamId, runId);
    if (report === null) return null;
    return {
      run: { ...this.runSummary(row), partialReport: row.partial_report },
      report,
      profile: {
        profileId: row.profile_id,
        profileVersion: row.profile_version,
        profileHash: row.profile_hash,
        snapshot: row.profile_snapshot,
      },
    };
  }

  async getArtifactForTeam(teamId: string, artifactId: string): Promise<TeamArtifact | null> {
    const result = await this.pool.query<{
      artifact_id: string; kind: string; storage_ref: string; byte_size: string; sha256: string;
    }>(
      `SELECT artifacts.artifact_id, artifacts.kind, artifacts.storage_ref, artifacts.byte_size::text, artifacts.sha256
       FROM validator_artifact_refs AS artifacts
       JOIN validator_runs AS runs ON runs.run_id = artifacts.run_id
       WHERE runs.team_id = $1 AND artifacts.artifact_id = $2`,
      [teamId, artifactId],
    );
    const row = result.rows[0];
    return row === undefined ? null : {
      artifactId: row.artifact_id,
      kind: row.kind,
      storageRef: row.storage_ref,
      byteSize: Number(row.byte_size),
      sha256: row.sha256,
    };
  }

  async expireInterrupted(now = new Date()): Promise<string[]> {
    const result = await this.pool.query<{ run_id: string }>(
      `WITH expired AS (
         UPDATE validator_jobs
         SET state = 'interrupted', lease_owner = NULL, lease_expires_at = NULL,
             interrupted_at = $1,
             interruption_reason = CASE WHEN deadline_at <= $1 THEN 'run_deadline_exceeded' ELSE 'lease_expired' END
         WHERE (state = 'queued' AND deadline_at <= $1)
            OR (state = 'leased' AND (deadline_at <= $1 OR lease_expires_at <= $1))
         RETURNING run_id, deadline_at
       )
       UPDATE validator_runs AS runs
       SET execution_state = CASE WHEN expired.deadline_at <= $1 THEN 'timed_out' ELSE 'errored' END,
           interrupted_at = $1, ended_at = $1
       FROM expired WHERE runs.run_id = expired.run_id
       RETURNING runs.run_id`,
      [now],
    );
    return result.rows.map((row) => row.run_id);
  }

  async claim(workerId: string): Promise<ClaimedJob | null> {
    if (workerId.trim() === "") throw new TypeError("workerId is required");
    await this.expireInterrupted();
    return transaction(this.pool, async (client) => {
      const result = await client.query<{
        job_id: string; run_id: string; target_url: string; device_id: string; deadline_at: Date; lease_expires_at: Date;
      }>(
        `WITH candidate AS (
           SELECT job_id FROM validator_jobs
           WHERE state = 'queued' AND deadline_at > clock_timestamp()
           ORDER BY queued_at, job_id
           FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE validator_jobs AS jobs
         SET state = 'leased', lease_owner = $1, claimed_at = clock_timestamp(),
             lease_expires_at = LEAST(jobs.deadline_at, clock_timestamp() + ($2 * interval '1 millisecond'))
         FROM candidate, validator_runs AS runs
         WHERE jobs.job_id = candidate.job_id AND runs.run_id = jobs.run_id
         RETURNING jobs.job_id::text, jobs.run_id, runs.target_url, runs.device_id,
                   jobs.deadline_at, jobs.lease_expires_at`,
        [workerId, this.options.leaseMs],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      await client.query(
        "UPDATE validator_runs SET execution_state = 'running', started_at = COALESCE(started_at, clock_timestamp()) WHERE run_id = $1",
        [row.run_id],
      );
      return {
        jobId: row.job_id,
        runId: row.run_id,
        targetUrl: row.target_url,
        deviceId: row.device_id,
        deadlineAt: instant(row.deadline_at),
        leaseExpiresAt: instant(row.lease_expires_at),
      };
    });
  }

  async heartbeat(runId: string, workerId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE validator_jobs SET lease_expires_at = LEAST(deadline_at, clock_timestamp() + ($3 * interval '1 millisecond'))
       WHERE run_id = $1 AND state = 'leased' AND lease_owner = $2
         AND lease_expires_at > clock_timestamp() AND deadline_at > clock_timestamp()`,
      [runId, workerId, this.options.leaseMs],
    );
    return result.rowCount === 1;
  }

  async saveProgress(runId: string, workerId: string, progress: JsonValue, partialReport?: ReportSnapshot): Promise<void> {
    const result = await this.pool.query(
      `UPDATE validator_runs AS runs
       SET progress = $3::jsonb, partial_report = COALESCE($4::jsonb, partial_report)
       FROM validator_jobs AS jobs
       WHERE runs.run_id = $1 AND jobs.run_id = runs.run_id
         AND jobs.state = 'leased' AND jobs.lease_owner = $2 AND jobs.lease_expires_at > clock_timestamp()`,
      [runId, workerId, JSON.stringify(progress), partialReport === undefined ? null : reportJson(partialReport)],
    );
    if (result.rowCount !== 1) throw new Error("active job lease is required to save progress");
  }

  async saveEvidenceMetadata(runId: string, workerId: string, item: EvidenceMetadataInput): Promise<void> {
    await transaction(this.pool, async (client) => {
      await this.assertLease(client, runId, workerId);
      const inserted = await client.query<{ run_id: string }>(
        `INSERT INTO validator_evidence_metadata (
           evidence_id, run_id, article_epoch_id, device_id, source, captured_at, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (evidence_id) DO NOTHING RETURNING run_id`,
        [item.evidenceId, runId, item.articleEpochId, item.deviceId, item.source, item.capturedAt, JSON.stringify(item.metadata)],
      );
      if (inserted.rowCount === 0) {
        const existing = await client.query<{ run_id: string }>("SELECT run_id FROM validator_evidence_metadata WHERE evidence_id = $1", [item.evidenceId]);
        if (existing.rows[0]?.run_id !== runId) throw new Error("evidenceId already belongs to another run");
      }
    });
  }

  async saveArtifactReference(runId: string, workerId: string, item: ArtifactReferenceInput): Promise<void> {
    await transaction(this.pool, async (client) => {
      await this.assertLease(client, runId, workerId);
      const inserted = await client.query<{ run_id: string }>(
        `INSERT INTO validator_artifact_refs (
           artifact_id, run_id, kind, storage_ref, byte_size, sha256, retention_until
         ) SELECT $1, $2, $3, $4, $5, $6, retention_until FROM validator_runs WHERE run_id = $2
         ON CONFLICT (artifact_id) DO NOTHING RETURNING run_id`,
        [item.artifactId, runId, item.kind, item.storageRef, item.byteSize, item.sha256],
      );
      if (inserted.rowCount === 0) {
        const existing = await client.query<{ run_id: string }>("SELECT run_id FROM validator_artifact_refs WHERE artifact_id = $1", [item.artifactId]);
        if (existing.rows[0]?.run_id !== runId) throw new Error("artifactId already belongs to another run");
      }
    });
  }

  async complete(runId: string, workerId: string, report: ReportSnapshot, findings: readonly FindingInput[]): Promise<void> {
    if (findings.some((finding) => finding.evidenceIds.length === 0)) throw new TypeError("every persisted finding must cite evidence");
    await transaction(this.pool, async (client) => {
      await this.assertLease(client, runId, workerId);
      const cited = [...new Set(findings.flatMap((finding) => finding.evidenceIds))];
      if (cited.length > 0) {
        const stored = await client.query<{ evidence_id: string }>(
          "SELECT evidence_id FROM validator_evidence_metadata WHERE run_id = $1 AND evidence_id = ANY($2::text[])",
          [runId, cited],
        );
        const known = new Set(stored.rows.map((item) => item.evidence_id));
        const missing = cited.filter((evidenceId) => !known.has(evidenceId));
        if (missing.length > 0) throw new Error(`findings reference unknown evidence: ${missing.join(", ")}`);
      }
      await client.query("DELETE FROM validator_findings WHERE run_id = $1", [runId]);
      for (const finding of findings) {
        await client.query(
          `INSERT INTO validator_findings (run_id, finding_id, kind, category, verdict, evidence_ids, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [runId, finding.findingId, finding.kind, finding.category, finding.verdict, finding.evidenceIds, JSON.stringify(finding.payload)],
        );
      }
      await client.query(
        "UPDATE validator_runs SET execution_state = 'completed', final_report = $2::jsonb, ended_at = clock_timestamp() WHERE run_id = $1",
        [runId, reportJson(report)],
      );
      await client.query(
        `UPDATE validator_jobs SET state = 'completed', lease_owner = NULL, lease_expires_at = NULL,
           completed_at = clock_timestamp() WHERE run_id = $1`,
        [runId],
      );
    });
  }

  async interrupt(runId: string, workerId: string, reason: string): Promise<boolean> {
    return transaction(this.pool, async (client) => {
      const job = await client.query(
        `UPDATE validator_jobs SET state = 'interrupted', lease_owner = NULL, lease_expires_at = NULL,
           interrupted_at = clock_timestamp(), interruption_reason = $3
         WHERE run_id = $1 AND state = 'leased' AND lease_owner = $2`,
        [runId, workerId, reason.slice(0, 1_000)],
      );
      if (job.rowCount !== 1) return false;
      await client.query(
        "UPDATE validator_runs SET execution_state = 'errored', interrupted_at = clock_timestamp(), ended_at = clock_timestamp() WHERE run_id = $1",
        [runId],
      );
      return true;
    });
  }

  async getRun(runId: string): Promise<PersistedRun | null> {
    const run = await this.pool.query<{
      run_id: string; execution_state: string; progress: JsonValue; partial_report: ReportSnapshot | null; final_report: ReportSnapshot | null;
    }>("SELECT run_id, execution_state, progress, partial_report, final_report FROM validator_runs WHERE run_id = $1", [runId]);
    if (run.rows[0] === undefined) return null;
    const [evidence, artifacts, findings] = await Promise.all([
      this.pool.query<{ evidence_id: string; article_epoch_id: string; device_id: string; source: string; captured_at: Date; metadata: { [key: string]: JsonValue } }>(
        "SELECT evidence_id, article_epoch_id, device_id, source, captured_at, metadata FROM validator_evidence_metadata WHERE run_id = $1 ORDER BY captured_at, evidence_id", [runId],
      ),
      this.pool.query<{ artifact_id: string; kind: string; storage_ref: string; byte_size: string; sha256: string }>(
        "SELECT artifact_id, kind, storage_ref, byte_size::text, sha256 FROM validator_artifact_refs WHERE run_id = $1 ORDER BY artifact_id", [runId],
      ),
      this.pool.query<{ finding_id: string; kind: "check" | "diagnosis"; category: string; verdict: string; evidence_ids: string[]; payload: JsonValue }>(
        "SELECT finding_id, kind, category, verdict, evidence_ids, payload FROM validator_findings WHERE run_id = $1 ORDER BY finding_id", [runId],
      ),
    ]);
    const row = run.rows[0];
    return {
      runId: row.run_id,
      executionState: row.execution_state,
      progress: row.progress,
      partialReport: row.partial_report,
      finalReport: row.final_report,
      evidence: evidence.rows.map((item) => ({ evidenceId: item.evidence_id, articleEpochId: item.article_epoch_id, deviceId: item.device_id, source: item.source, capturedAt: instant(item.captured_at), metadata: item.metadata })),
      artifacts: artifacts.rows.map((item) => ({ artifactId: item.artifact_id, kind: item.kind, storageRef: item.storage_ref, byteSize: Number(item.byte_size), sha256: item.sha256 })),
      findings: findings.rows.map((item) => ({ findingId: item.finding_id, kind: item.kind, category: item.category, verdict: item.verdict, evidenceIds: item.evidence_ids, payload: item.payload })),
    };
  }

  async cleanupExpired(deleteArtifact: (storageRef: string) => Promise<void>, now = new Date()): Promise<{ artifacts: number; runs: number }> {
    const expired = await this.pool.query<{ artifact_id: string; storage_ref: string }>(
      `SELECT artifacts.artifact_id, artifacts.storage_ref
       FROM validator_artifact_refs AS artifacts JOIN validator_runs AS runs ON runs.run_id = artifacts.run_id
       WHERE artifacts.retention_until <= $1 AND runs.execution_state IN ('completed', 'timed_out', 'errored')
       ORDER BY artifacts.artifact_id`, [now],
    );
    let artifacts = 0;
    for (const item of expired.rows) {
      await deleteArtifact(item.storage_ref);
      const deleted = await this.pool.query("DELETE FROM validator_artifact_refs WHERE artifact_id = $1 AND retention_until <= $2", [item.artifact_id, now]);
      artifacts += deleted.rowCount ?? 0;
    }
    const runs = await this.pool.query(
      `DELETE FROM validator_runs AS runs WHERE retention_until <= $1
       AND execution_state IN ('completed', 'timed_out', 'errored')
       AND NOT EXISTS (SELECT 1 FROM validator_artifact_refs AS artifacts WHERE artifacts.run_id = runs.run_id)`,
      [now],
    );
    return { artifacts, runs: runs.rowCount ?? 0 };
  }

  private async assertLease(client: PoolClient, runId: string, workerId: string): Promise<void> {
    const result = await client.query(
      `SELECT 1 FROM validator_jobs WHERE run_id = $1 AND state = 'leased' AND lease_owner = $2
       AND lease_expires_at > clock_timestamp() AND deadline_at > clock_timestamp() FOR UPDATE`,
      [runId, workerId],
    );
    if (result.rowCount !== 1) throw new Error("active job lease is required");
  }

  private runSummary(row: {
    run_id: string; target_url: string; device_id: string; execution_state: string;
    created_at: Date; deadline_at: Date; started_at: Date | null; ended_at: Date | null; progress: JsonValue;
  }): RunSummary {
    return {
      runId: row.run_id,
      targetUrl: row.target_url,
      deviceId: row.device_id,
      executionState: row.execution_state,
      createdAt: instant(row.created_at),
      deadlineAt: instant(row.deadline_at),
      startedAt: row.started_at === null ? null : instant(row.started_at),
      endedAt: row.ended_at === null ? null : instant(row.ended_at),
      progress: row.progress,
    };
  }
}
