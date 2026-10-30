import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDomain, offDomainUrls, onDomain } from '../src/utils/domains.js';
import * as clientCopy from '../../client/src/utils/domains.js';

const staging = 'https://devbl.thehindu.co.in/markets/tcs-rally/article69715209.ece?google_preview=x&iu=22390678';

test('a URL belongs to the publisher when its host is the domain or a subdomain', () => {
  const domain = normalizeDomain('https://www.TheHinduBusinessLine.com/');
  assert.equal(domain, 'thehindubusinessline.com');
  assert.equal(onDomain(domain, 'https://www.thehindubusinessline.com/markets/a.ece'), true);
  assert.equal(onDomain(domain, 'https://m.thehindubusinessline.com/a'), true);
  assert.equal(onDomain(domain, 'https://thehindubusinessline.com:8443/a'), true);
  assert.equal(onDomain(domain, staging), false, 'staging on another domain');
  assert.equal(onDomain(domain, 'https://notthehindubusinessline.com/a'), false);
  assert.equal(onDomain(domain, 'https://thehindubusinessline.com.evil.net/a'), false);
  assert.deepEqual(offDomainUrls(domain, ['https://www.thehindubusinessline.com/a', staging]), [staging]);
});

test('the dashboard copy of the domain rules gives the same answers', () => {
  for (const url of ['https://www.thehindubusinessline.com/a', 'https://m.thehindubusinessline.com/a', staging, 'https://thehindubusinessline.com.evil.net/a']) {
    assert.equal(clientCopy.onDomain('thehindubusinessline.com', url), onDomain('thehindubusinessline.com', url), url);
  }
  assert.equal(clientCopy.normalizeDomain(' https://www.Example.com/x '), normalizeDomain(' https://www.Example.com/x '));
});

test('URLs on other domains are refused, naming the host, unless the user allows them', async () => {
  const { default: app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  // No script is sent, so a request that passes the domain check stops at "Add the … code" without starting a job.
  const post = (body) => fetch(`http://127.0.0.1:${server.address().port}/api/placement-checks`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'thehindubusinessline.com', tag: 'v-thehindubusinessline-v5', devices: ['desktop'], urls: [staging], ...body }) });
  try {
    const refused = await post({});
    assert.equal(refused.status, 400);
    const message = (await refused.json()).error;
    assert.match(message, /devbl\.thehindu\.co\.in/);
    assert.match(message, /Allow URLs on other domains/);
    const allowed = await post({ allowOtherDomains: true });
    assert.equal(allowed.status, 400);
    assert.match((await allowed.json()).error, /Add the vdo\.ai\.js code/, 'passes the domain check and stops at the missing code');
    const badFlag = await post({ allowOtherDomains: 'yes' });
    assert.match((await badFlag.json()).error, /allowOtherDomains/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
