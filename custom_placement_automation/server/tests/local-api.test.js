import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import http from 'node:http';

test('real HTTP server restricts origins and validates publisher URLs before queueing', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/health`, {headers:{origin:'https://untrusted.example'}})).status, 403);
    const hostStatus = await new Promise((resolve, reject) => {
      http.get(`${base}/api/health`, {headers:{host:'untrusted.example'}}, response => {
        response.resume(); resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(hostStatus, 403);
    for (const url of ['https://other.example/article','https://user:password@example.com/article','file:///etc/passwd']) {
      const response = await fetch(`${base}/api/placement-checks`, { method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({domain:'example.com', tag:'v-example', devices:['desktop'], urls:[url]}) });
      assert.equal(response.status, 400);
    }
    assert.equal((await fetch(`${base}/api/ready`)).status, 503, 'readiness must fail without an initialized database');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
