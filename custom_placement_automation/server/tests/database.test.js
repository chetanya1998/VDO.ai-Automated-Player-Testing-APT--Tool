import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { PlacementDatabase } from '../src/services/database.service.js';

const connection = process.env.TEST_DATABASE_URL;
if (!connection) throw new Error('Set TEST_DATABASE_URL to a real local PostgreSQL database; these tests do not mock the database');

test('real PostgreSQL admission, ownership, restart recovery, retention and legacy import', async () => {
  const schema = `placement_test_${crypto.randomBytes(8).toString('hex')}`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'placement-db-'));
  const legacy = path.join(dir, 'reports.json');
  const run = { id: crypto.randomUUID(), results: [], device: 'desktop' };
  await fs.writeFile(legacy, JSON.stringify([run]));
  let db = new PlacementDatabase(connection, schema);
  try {
    await db.open(legacy);
    await assert.rejects(new PlacementDatabase(connection, schema).open(), /already owns/);
    assert.deepEqual(await db.runs(), [run]);
    const makeJob = () => ({ id: crypto.randomUUID(), status: 'queued', createdAt: new Date().toISOString(), runs: [], input: { scriptId: 'a'.repeat(64) } });
    const one = makeJob(); const two = makeJob(); const three = makeJob();
    const admitted = await Promise.all([one,two,three].map(job => db.admit(job, 2)));
    assert.deepEqual(admitted, [true,true,false]);
    one.status = 'running'; one.runs = [run];
    await db.saveJob(one);
    await db.deleteRun(run.id);
    await db.close();
    db = new PlacementDatabase(connection, schema);
    await db.open(legacy);
    assert.deepEqual(await db.runs(), [], 'deleted legacy reports must not reappear');
    const jobs = await db.jobs();
    assert.equal(jobs.find(job => job.id === one.id).status, 'failed');
    assert.match(jobs.find(job => job.id === one.id).error, /interrupted/);
    assert.deepEqual(jobs.find(job => job.id === one.id).runs, [run]);
    assert.equal(jobs.find(job => job.id === two.id).status, 'queued');
    assert.equal(await db.admit(three, 2), true);
    const recovered = jobs.find(job => job.id === one.id);
    recovered.finishedAt = '2000-01-01T00:00:00.000Z';
    await db.saveJob(recovered);
    await db.pruneJobs(1000);
    assert.equal((await db.jobs()).length, 2, 'retention must preserve queued work');
    await db.saveRun(run);
    assert.equal(await db.clearRuns(), 1);
  } finally {
    await db.close().catch(() => {});
    const cleanup = new pg.Client({ connectionString: connection });
    await cleanup.connect();
    try { await cleanup.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await cleanup.end(); }
    await fs.rm(dir, {recursive:true,force:true});
  }
});
