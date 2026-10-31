import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import config from '../src/config/index.js';
import { browserChoice, launchOptions } from '../src/services/browser.service.js';

test('browser choice prefers Google Chrome, honours the channel setting and reports a missing Chrome', (t) => {
  const saved = { ...config.browser };
  t.after(() => Object.assign(config.browser, saved));
  const fakeChrome = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-')), 'chrome');
  fs.writeFileSync(fakeChrome, '');

  Object.assign(config.browser, { channel: 'auto', chromePath: fakeChrome });
  assert.deepEqual(browserChoice(), { name: 'Google Chrome', executablePath: fakeChrome });
  assert.deepEqual(launchOptions(), { executablePath: fakeChrome });

  Object.assign(config.browser, { channel: 'chromium' });
  assert.deepEqual(browserChoice(), { name: 'Chromium', executablePath: chromium.executablePath() });
  assert.deepEqual(launchOptions(), { channel: 'chromium' });

  Object.assign(config.browser, { channel: 'chrome', chromePath: `${fakeChrome}-missing` });
  assert.equal(browserChoice().missing, true);
  Object.assign(config.browser, { channel: 'auto' });
  assert.equal(browserChoice().name, 'Chromium', 'auto falls back to Chromium');
});
