import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { deepReadiness, runDeepCheck, summarizeDeepRun } from '../src/services/deepValidation.service.js';

test('deep option must be a boolean and readiness reports the deep engine separately', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/placement-checks`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'example.com', tag: 'v-example', devices: ['desktop'], urls: ['https://example.com/a'], deep: 'yes' }) });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /deep/);
    const state = await (await fetch(`${base}/api/ready`)).json();
    assert.equal(typeof state.deep.available, 'boolean');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('the compiled 23-case engine loads from the repository build', { skip: (await deepReadiness()).available ? false : 'run pnpm build in the repository root first' }, async () => {
  assert.deepEqual(await deepReadiness(), { available: true });
});

test('a deep check that cannot run returns 23 unevaluated cases instead of failing the job', { skip: (await deepReadiness()).available ? false : 'run pnpm build in the repository root first' }, async () => {
  const summary = await runDeepCheck({ url: 'http://127.0.0.1:9/article', domain: '127.0.0.1', tag: 'v-example', device: 'desktop', type: 'vdo.ai.js', script: '/* */' });
  assert.equal(summary.executionState, 'errored');
  assert.equal(summary.verdictCounts.UNKNOWN, 23);
  assert.match(summary.executionErrors[0].message, /public network address/);
});

test('run totals add up per-URL deep verdicts', () => {
  const counts = (pass, fail) => ({ PASS: pass, FAIL: fail, WARNING: 0, UNKNOWN: 23 - pass - fail, NOT_APPLICABLE: 0 });
  const totals = summarizeDeepRun([{ deep: { verdictCounts: counts(20, 1) } }, { deep: { verdictCounts: counts(10, 3) } }, {}]);
  assert.deepEqual(totals, { urls: 2, cases: 46, verdictCounts: { PASS: 30, FAIL: 4, WARNING: 0, UNKNOWN: 12, NOT_APPLICABLE: 0 } });
});
