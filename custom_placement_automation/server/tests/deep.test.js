import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import config from '../src/config/index.js';
import { addPlainLanguage, deepReadiness, runDeepCheck, summarizeDeepRun } from '../src/services/deepValidation.service.js';

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

test('a deep check that cannot run returns 23 unevaluated cases instead of failing the job', { skip: !(await deepReadiness()).available ? 'run pnpm build in the repository root first' : config.deep.allowPrivateNetwork ? 'DEEP_ALLOW_PRIVATE_NETWORK is on' : false }, async () => {
  const summary = await runDeepCheck({ url: 'http://127.0.0.1:9/article', domain: '127.0.0.1', tag: 'v-example', device: 'desktop', type: 'vdo.ai.js', script: '/* */' });
  assert.equal(summary.executionState, 'errored');
  assert.equal(summary.verdictCounts.UNKNOWN, 23);
  assert.match(summary.executionErrors[0].message, /public network address/);
});

test('run totals add up per-URL deep verdicts', () => {
  const counts = (pass, fail) => ({ PASS: pass, FAIL: fail, WARNING: 0, UNKNOWN: 23 - pass - fail, NOT_APPLICABLE: 0 });
  const totals = summarizeDeepRun([{ url: 'a', deep: { overallVerdict: 'FAIL', verdictCounts: counts(20, 1) } }, { url: 'b', deep: { overallVerdict: 'FAIL', verdictCounts: counts(10, 3) } }, { url: 'c' }]);
  assert.deepEqual({ urls: totals.urls, cases: totals.cases, verdictCounts: totals.verdictCounts }, { urls: 2, cases: 46, verdictCounts: { PASS: 30, FAIL: 4, WARNING: 0, UNKNOWN: 12, NOT_APPLICABLE: 0 } });
  assert.deepEqual(totals.perUrl.map((item) => [item.url, item.verdictCounts.PASS]), [['a', 20], ['b', 10]], 'deep counts stay per URL');
});

test('runs saved before plain-language explanations get them when opened', { skip: (await deepReadiness()).available ? false : 'run pnpm build in the repository root first' }, async () => {
  const run = { results: [{ deep: { cases: [{ testCaseId: 'TC-3', verdict: 'FAIL', summary: 'x' }, { testCaseId: 'TC-10', verdict: 'UNKNOWN', summary: 'y' }] } }] };
  await addPlainLanguage(run);
  const [tc3, tc10] = run.results[0].deep.cases;
  assert.match(tc3.checks, /installed only once/);
  assert.match(tc3.meaning, /more than once/);
  assert.match(tc10.meaning, /could not decide/);
});
