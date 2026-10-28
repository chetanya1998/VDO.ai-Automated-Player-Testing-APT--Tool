import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import config from '../config/index.js';
import { browserChoice, deviceContextOptions } from './browser.service.js';
import logger from '../utils/logger.js';

// The 23 validators live in the repository's TypeScript validator. Deep tests load its compiled
// build (pnpm build in the repository root) instead of re-implementing the rules here.
let enginePromise = null;

// Same intervals as the engine's refresh check; kept here so requests validate without loading the engine.
export const REFRESH_INTERVALS_SEC = [30, 45, 60];

const engineMissingMessage = () =>
  `Deep test engine is not built. Run "pnpm install && pnpm build" in the repository root (${config.deep.repoRoot}), then retry.`;

function loadEngine() {
  if (!fs.existsSync(config.deep.enginePath)) return Promise.reject(new Error(engineMissingMessage()));
  enginePromise ??= import(pathToFileURL(config.deep.enginePath).href).catch((error) => {
    enginePromise = null;
    throw error;
  });
  return enginePromise;
}

export async function deepReadiness() {
  if (!fs.existsSync(config.deep.enginePath)) return { available: false, message: engineMissingMessage() };
  try {
    await loadEngine();
    return { available: true };
  } catch (error) {
    logger.error('Deep test engine failed to load', error);
    return { available: false, message: `Deep test engine failed to load: ${error.message}` };
  }
}

// Extra checks that could not run are shown as not evaluated rather than left out.
function unevaluatedExtraChecks(refreshIntervalSec, message) {
  const unknown = (id, title) => ({ id, title, checks: '', meaning: 'The check could not run for this URL.', verdict: 'UNKNOWN', summary: message, details: {} });
  return [unknown('SAFE_FRAME', 'Safe frame check'), ...(refreshIntervalSec ? [unknown('SLOT_REFRESH', `Ad slot refresh (every ${refreshIntervalSec} s)`)] : [])];
}

function errorSummary(url, device, error, refreshIntervalSec) {
  return {
    schemaVersion: 1,
    targetUrl: url,
    deviceId: device,
    executionState: 'errored',
    overallVerdict: 'UNKNOWN',
    verdictCounts: { PASS: 0, FAIL: 0, WARNING: 0, UNKNOWN: 23, NOT_APPLICABLE: 0 },
    cases: [],
    probableCauses: [],
    executionErrors: [{ stage: 'run', message: error.message.split('\n')[0] }],
    limitations: ['The deep test could not run for this URL, so none of the 23 cases were evaluated.'],
    extraChecks: unevaluatedExtraChecks(refreshIntervalSec, error.message.split('\n')[0]),
  };
}

export async function runDeepCheck({ url, domain, tag, device, type, script, scroll, refreshIntervalSec = null }) {
  try {
    const engine = await loadEngine();
    const browser = browserChoice();
    if (!browser.executablePath) throw new Error('Google Chrome was not found. Install Chrome, set CHROME_PATH, or set BROWSER_CHANNEL=auto.');
    const { summary, screenshots } = await engine.runDeepValidation({
      targetUrl: url,
      domain,
      tagName: tag,
      device: { id: device, kind: device === 'mobile' ? 'mobile' : 'desktop', contextOptions: deviceContextOptions(device) },
      browserExecutablePath: browser.executablePath,
      code: { type, body: script },
      scroll,
      observeAfterLoadMs: config.deep.observeMs,
      navigationTimeoutMs: config.browser.navigationTimeoutMs,
      totalTimeoutMs: config.deep.urlTimeoutMs,
      configDirectory: path.join(config.deep.repoRoot, 'config'),
      allowPrivateNetwork: config.deep.allowPrivateNetwork,
      ...(refreshIntervalSec ? { refresh: { intervalSec: refreshIntervalSec } } : {}),
    });
    logger.info(`[DEEP ${summary.overallVerdict}] ${url} (${device}) ${JSON.stringify(summary.verdictCounts)}`);
    return { summary, screenshots: screenshots ?? [] };
  } catch (error) {
    logger.error(`Deep test failed for ${url} (${device})`, error);
    return { summary: errorSummary(url, device, error, refreshIntervalSec), screenshots: [] };
  }
}

// Runs saved before plain-language explanations existed get them from the engine when they are opened.
export async function addPlainLanguage(run) {
  if (!run?.results?.some((result) => result.deep?.cases?.some((item) => !item.checks || !item.meaning))) return run;
  let engine;
  try { engine = await loadEngine(); } catch { return run; }
  for (const result of run.results) {
    for (const item of result.deep?.cases ?? []) {
      item.checks ??= engine.CASE_GUIDE[item.testCaseId]?.checks ?? '';
      item.meaning ??= engine.resultMeaning(item.testCaseId, item.verdict);
    }
  }
  return run;
}

// Deep results per URL, kept apart from the placement check's per-URL pass/fail.
export const deepPerUrl = (results) =>
  results.filter((result) => result.deep).map((result) => ({ url: result.url, overallVerdict: result.deep.overallVerdict, verdictCounts: result.deep.verdictCounts }));

// Run-level totals so history rows can show deep results without loading every case.
export function summarizeDeepRun(results) {
  const totals = { PASS: 0, FAIL: 0, WARNING: 0, UNKNOWN: 0, NOT_APPLICABLE: 0 };
  let urls = 0;
  for (const result of results) {
    if (!result.deep) continue;
    urls += 1;
    for (const [verdict, count] of Object.entries(result.deep.verdictCounts ?? {})) totals[verdict] = (totals[verdict] ?? 0) + count;
  }
  return { urls, cases: urls * 23, verdictCounts: totals, perUrl: deepPerUrl(results) };
}
