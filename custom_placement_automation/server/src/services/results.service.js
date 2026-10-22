import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config/index.js';
import { httpError } from '../utils/httpError.js';
import { clearScripts } from './scriptStore.service.js';
import { getDatabase } from './database.service.js';
import { summarizeDeepRun } from './deepValidation.service.js';

const { screenshotsDir } = config.storage;
export const SCREENSHOTS_URL_PATH = '/screenshots';

async function readRuns() {
  return getDatabase().runs();
}

const appendRun = (run) => getDatabase().saveRun(run);

async function writeScreenshots(runId, resultId, buffers) {
  const runDir = path.join(screenshotsDir, runId);
  await fs.mkdir(runDir, { recursive: true });

  return Promise.all(
    buffers.map(async (buffer, index) => {
      const fileName = `${resultId}_${index + 1}.jpg`;
      await fs.writeFile(path.join(runDir, fileName), buffer);
      return {
        url: `${SCREENSHOTS_URL_PATH}/${runId}/${fileName}`,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        bytes: buffer.length,
      };
    }),
  );
}

export async function saveRun({ type, tag, domain, scroll, scriptId, scriptName, scriptBytes, deep = false }, run) {
  const id = crypto.randomUUID();

  const results = await Promise.all(
    run.results.map(async ({ screenshots, ...result }) => {
      const resultId = crypto.randomUUID();
      const artifacts = await writeScreenshots(id, resultId, screenshots);
      return { ...result, id: resultId, screenshots: artifacts.map(a => a.url), artifacts };
    }),
  );

  const saved = {
    id,
    type,
    tag,
    domain,
    device: run.device,
    scroll: scroll ? { stepViewportRatio: scroll.stepViewportRatio, intervalMs: scroll.intervalMs } : null,
    script: scriptId ? { id: scriptId, name: scriptName, bytes: scriptBytes } : null,
    passCount: run.passCount,
    failCount: run.failCount,
    errorCount: run.errorCount,
    ...(deep ? { deep: true, deepSummary: summarizeDeepRun(results) } : {}),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    results,
  };

  await appendRun(saved);
  return saved;
}

const runStatus = (run) => (run.errorCount ? 'error' : run.failCount ? 'fail' : 'pass');

function matchesFilters(run, { q, status, type, mode }) {
  if (status && runStatus(run) !== status) return false;
  if (mode === 'deep' && !run.deep) return false;
  if (type && (run.type ?? 'vdo.ai.js') !== type) return false;
  if (!q) return true;
  const haystack = [run.tag, run.domain, ...run.results.map((r) => r.url)].join(' ').toLowerCase();
  return haystack.includes(q);
}

export async function listRuns({ page, pageSize, q = '', status = '', type = '', mode = '' }) {
  const filters = { q: q.trim().toLowerCase(), status, type, mode };
  const runs = (await readRuns())
    .filter((run) => matchesFilters(run, filters))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const from = (page - 1) * pageSize;

  return {
    runs: runs.slice(from, from + pageSize).map(({ results, ...run }) => run),
    total: runs.length,
    page,
    pageSize,
  };
}

export async function getRun(runId) {
  const run = (await readRuns()).find((r) => r.id === runId);
  if (!run) throw httpError(404, 'Run not found');
  return run;
}

export async function deleteRun(runId) {
  if (!await getDatabase().deleteRun(runId)) throw httpError(404, 'Run not found');
  await fs.rm(path.join(screenshotsDir, runId), { recursive: true, force: true });
}

export async function clearRuns() {
  const deleted = await getDatabase().clearRuns();
  await fs.rm(screenshotsDir, { recursive: true, force: true });
  await clearScripts();
  return { deleted };
}
