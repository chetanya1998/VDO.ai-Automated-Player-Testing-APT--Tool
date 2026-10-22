import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = fileURLToPath(new URL('../..', import.meta.url));
dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true });

const storageDir = path.resolve(serverRoot, process.env.STORAGE_DIR || 'storage');
const envNumber = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const clientDistDir = path.resolve(serverRoot, '../client/dist');

const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || undefined,
  env: process.env.NODE_ENV || 'development',

  clientDistDir: fs.existsSync(path.join(clientDistDir, 'index.html')) ? clientDistDir : null,

  storage: {
    reportsFile: path.join(storageDir, 'reports.json'),
    screenshotsDir: path.join(storageDir, 'screenshots'),
    scriptsDir: path.join(storageDir, 'scripts'),
  },

  browser: {
    headless: process.env.HEADLESS === 'true',
    navigationTimeoutMs: Number(process.env.NAVIGATION_TIMEOUT_MS) || 30000,
  },

  placement: {
    eventName: 'vdo:placement',
    wrapperSelector: '#vdoai_parentWrapperDiv, .vdoai_parentWrapperDiv',
    urlTimeoutMs: Number(process.env.URL_TIMEOUT_MS) || 60000,
    finalizeGraceMs: 15000,
    eventSettleMs: Number(process.env.PLACEMENT_EVENT_SETTLE_MS) || 3000,
    screenshotQuality: 70,
    screenshotSettleMs: Number(process.env.SCREENSHOT_SETTLE_MS) || 1200,
    pageCallTimeoutMs: 2000,
    scrollLimits: {
      stepViewportRatio: { min: 0.05, max: 2 },
      intervalMs: { min: 200, max: 10000 },
    },
    lazyScroll: {
      stepViewportRatio: envNumber('SCROLL_STEP_VIEWPORT_RATIO', 0.45),
      intervalMs: envNumber('SCROLL_INTERVAL_MS', 1600),
      maxSteps: 2,
    },
  },

  checks: {
    maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS) || 2,
    maxUrls: 50,
    maxScriptBytes: 2 * 1024 * 1024,
    jobTtlMs: 60 * 60 * 1000,
  },
};

export default config;
