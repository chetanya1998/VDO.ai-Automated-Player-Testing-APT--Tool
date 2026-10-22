import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { initializeDatabase } from '../src/services/database.service.js';
import { initializeQueue, enqueueJob, getJob, stopQueue, drainQueue } from '../src/services/jobQueue.service.js';

test('real queue persists a failed job when its uploaded source is missing', async () => {
  const connection = process.env.TEST_DATABASE_URL;
  assert.ok(connection, 'TEST_DATABASE_URL is required; database tests must not silently skip');
  const schema = `placement_test_${crypto.randomBytes(8).toString('hex')}`;
  const db = await initializeDatabase({databaseUrl:connection, databaseSchema:schema, storage:{}});
  try {
    await initializeQueue();
    const result = await enqueueJob({type:'style.css',tag:'v-example',domain:'example.com',devices:['desktop'],
      urls:['https://example.com'],scriptId:crypto.randomBytes(32).toString('hex'),scriptName:'absent.css',scriptBytes:1});
    const deadline = Date.now()+5000;
    while (getJob(result.id).status !== 'failed' && Date.now()<deadline) await new Promise(resolve => setTimeout(resolve,20));
    const job = getJob(result.id);
    assert.equal(job.status,'failed');
    assert.equal(job.progress.done,0);
    assert.deepEqual(job.runs,[]);
    assert.match(job.error,/no longer stored/);
    await drainQueue();
    assert.equal((await db.jobs())[0].status,'failed');
    assert.equal((await db.jobs())[0].input.script,undefined, 'uploaded code is stored by digest, not duplicated in jobs');
    stopQueue();
    await assert.rejects(enqueueJob({}), error => error.status===503);
  } finally {
    stopQueue(); await drainQueue(); await db.close();
    const cleanup = new pg.Client({connectionString:connection});
    await cleanup.connect();
    try { await cleanup.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await cleanup.end(); }
  }
});
