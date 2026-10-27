import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import config from '../config/index.js';
import { deviceContextOptions } from './browser.service.js';
import logger from '../utils/logger.js';

// The 23 validators live in the repository's TypeScript validator. Deep tests load its compiled
// build (pnpm build in the repository root) instead of re-implementing the rules here.
let enginePromise = null;

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

function errorSummary(url, device, error) {
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
  };
}

export async function runDeepCheck({ url, domain, tag, device, type, script, scroll }) {
  try {
    const engine = await loadEngine();
    const { summary } = await engine.runDeepValidation({
      targetUrl: url,
      domain,
      tagName: tag,
      device: { id: device, kind: device === 'mobile' ? 'mobile' : 'desktop', contextOptions: deviceContextOptions(device) },
      browserExecutablePath: chromium.executablePath(),
      code: { type, body: script },
      scroll,
      observeAfterLoadMs: config.deep.observeMs,
      navigationTimeoutMs: config.browser.navigationTimeoutMs,
      totalTimeoutMs: config.deep.urlTimeoutMs,
      configDirectory: path.join(config.deep.repoRoot, 'config'),
      allowPrivateNetwork: config.deep.allowPrivateNetwork,
    });
    logger.info(`[DEEP ${summary.overallVerdict}] ${url} (${device}) ${JSON.stringify(summary.verdictCounts)}`);
    return summary;
  } catch (error) {
    logger.error(`Deep test failed for ${url} (${device})`, error);
    return errorSummary(url, device, error);
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

// Run-level totals so history rows can show deep results without loading every case.
export function summarizeDeepRun(results) {
  const totals = { PASS: 0, FAIL: 0, WARNING: 0, UNKNOWN: 0, NOT_APPLICABLE: 0 };
  let urls = 0;
  for (const result of results) {
    if (!result.deep) continue;
    urls += 1;
    for (const [verdict, count] of Object.entries(result.deep.verdictCounts ?? {})) totals[verdict] = (totals[verdict] ?? 0) + count;
  }
  return { urls, cases: urls * 23, verdictCounts: totals };
}
