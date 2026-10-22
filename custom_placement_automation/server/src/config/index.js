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
const envInteger = (name, fallback, max) => {
  if (process.env[name] === undefined) return fallback;
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${name} must be an integer from 1 to ${max}`);
  return value;
};

const clientDistDir = path.resolve(serverRoot, '../client/dist');
const repoRoot = path.resolve(serverRoot, '../..');

const config = {
  port: Number(process.env.PORT) || 3000,
  host: '127.0.0.1',
  databaseUrl: process.env.DATABASE_URL,
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

  deep: {
    repoRoot,
    enginePath: path.resolve(repoRoot, process.env.DEEP_ENGINE_PATH || 'dist/src/deep/index.js'),
    observeMs: envNumber('DEEP_OBSERVE_MS', 15000),
    urlTimeoutMs: envNumber('DEEP_URL_TIMEOUT_MS', 90000),
  },

  checks: {
    maxConcurrentJobs: envInteger('MAX_CONCURRENT_JOBS', 2, 8),
    maxPendingJobs: envInteger('MAX_PENDING_JOBS', 20, 200),
    maxUrls: 50,
    maxScriptBytes: 2 * 1024 * 1024,
    jobTtlMs: 60 * 60 * 1000,
  },
};

export default config;
