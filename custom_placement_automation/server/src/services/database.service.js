import pg from 'pg';
import fs from 'node:fs/promises';

// One worker owns a schema. The session lock is released by PostgreSQL on crash.
export class PlacementDatabase {
  constructor(connectionString, schema = 'custom_placement') {
    if (!connectionString) throw new Error('DATABASE_URL is required for the local PostgreSQL database');
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid database schema');
    this.schema = schema;
    this.client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    this.ready = false;
    this.pending = Promise.resolve();
    this.client.on('error', () => { this.ready = false; });
  }

  query(...args) {
    const result = this.pending.then(() => this.client.query(...args));
    this.pending = result.catch(() => {});
    return result;
  }

  async open(legacyReportsFile) {
    try {
      await this.client.connect();
      const lock = await this.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [`placement:${this.schema}`]);
      if (!lock.rows[0].acquired) throw new Error('Another placement server already owns this database schema');
      await this.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);
      await this.query(`SET search_path TO ${this.schema}`);
      await this.query(`
        CREATE TABLE IF NOT EXISTS jobs (id uuid PRIMARY KEY, data jsonb NOT NULL);
        CREATE TABLE IF NOT EXISTS runs (id uuid PRIMARY KEY, data jsonb NOT NULL);
        CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY);
      `);
      const imported = await this.query("SELECT 1 FROM migrations WHERE name='legacy_reports'");
      if (!imported.rowCount) {
        let runs = [];
        if (legacyReportsFile) {
          try { runs = JSON.parse(await fs.readFile(legacyReportsFile, 'utf8')); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        if (!Array.isArray(runs)) throw new Error('Legacy reports must be an array');
        await this.query('BEGIN');
        try {
          for (const run of runs) await this.query('INSERT INTO runs VALUES ($1,$2) ON CONFLICT DO NOTHING', [run.id, run]);
          await this.query("INSERT INTO migrations VALUES ('legacy_reports')");
          await this.query('COMMIT');
        } catch (error) { await this.query('ROLLBACK'); throw error; }
      }
      // Do not silently replay a browser visit that may already have served an ad.
      await this.query(`UPDATE jobs SET data = data || jsonb_build_object(
        'status','failed','error','Execution interrupted by server restart; inspect retained results before rerunning.',
        'finishedAt', $1::text) WHERE data->>'status' = 'running'`, [new Date().toISOString()]);
      this.ready = true;
    } catch (error) { await this.client.end().catch(() => {}); throw error; }
  }

  async admit(job, limit) {
    const result = await this.query(`INSERT INTO jobs (id,data)
      SELECT $1,$2 WHERE (SELECT count(*) FROM jobs WHERE data->>'status' IN ('queued','running')) < $3 RETURNING id`,
    [job.id, job, limit]);
    return result.rowCount === 1;
  }
  async saveJob(job) { await this.query('UPDATE jobs SET data=$2 WHERE id=$1', [job.id, job]); }
  async jobs() { return (await this.query("SELECT data FROM jobs ORDER BY data->>'createdAt',id")).rows.map(row => row.data); }
  async runs() { return (await this.query('SELECT data FROM runs')).rows.map(row => row.data); }
  async saveRun(run) { await this.query('INSERT INTO runs VALUES ($1,$2)', [run.id, run]); }
  async deleteRun(id) { return (await this.query('DELETE FROM runs WHERE id=$1', [id])).rowCount; }
  async clearRuns() { return (await this.query('DELETE FROM runs')).rowCount; }
  async pruneJobs(ttlMs) {
    await this.query(`DELETE FROM jobs WHERE data->>'status' IN ('completed','failed') AND data->>'finishedAt' < $1`,
      [new Date(Date.now() - ttlMs).toISOString()]);
  }
  async ping() { await this.query('SELECT 1'); return this.ready; }
  async close() { this.ready = false; await this.pending; await this.client.end(); }
}

let database;
export function getDatabase() {
  if (!database?.ready) throw Object.assign(new Error('Database is unavailable'), { status: 503 });
  return database;
}
export async function initializeDatabase(config) {
  database = new PlacementDatabase(config.databaseUrl, config.databaseSchema);
  await database.open(config.storage.reportsFile);
  return database;
}
