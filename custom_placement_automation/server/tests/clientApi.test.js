import test from 'node:test';
import assert from 'node:assert/strict';
import { startPlacementCheck } from '../../client/src/api/placementChecks.js';

// The dashboard must send every option the form sets; a missing field silently turns that option off.
test('the dashboard sends the deep test and refresh check options', async (t) => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_path, options) => {
    sent.push(JSON.parse(options.body));
    return new Response('{}', { status: 202, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = realFetch; });
  await startPlacementCheck({ type: 'vdo.ai.js', domain: 'a.com', tag: 'v-a', devices: ['desktop'], urls: ['https://a.com/x'], deep: true, refreshIntervalSec: 45 });
  assert.equal(sent[0].deep, true);
  assert.equal(sent[0].refreshIntervalSec, 45);
});
