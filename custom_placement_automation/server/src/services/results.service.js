import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config/index.js';
import { httpError } from '../utils/httpError.js';
import { clearScripts } from './scriptStore.service.js';

const { reportsFile, screenshotsDir } = config.storage;
export const SCREENSHOTS_URL_PATH = '/screenshots';

let writeQueue = Promise.resolve();

async function readRuns() {
  try {
    return JSON.parse(await fs.readFile(reportsFile, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeRuns(runs) {
  const tmpFile = `${reportsFile}.tmp`;
  await fs.mkdir(path.dirname(reportsFile), { recursive: true });
  await fs.writeFile(tmpFile, JSON.stringify(runs, null, 2));
  await fs.rename(tmpFile, reportsFile);
}

function updateRuns(change) {
  const update = writeQueue.then(async () => {
    const runs = await readRuns();
    const { runs: next, value } = await change(runs);
    await writeRuns(next);
    return value;
  });

  writeQueue = update.catch(() => {});
  return update;
}

const appendRun = (run) => updateRuns((runs) => ({ runs: [...runs, run] }));

async function writeScreenshots(runId, resultId, buffers) {
  const runDir = path.join(screenshotsDir, runId);
  await fs.mkdir(runDir, { recursive: true });

  return Promise.all(
    buffers.map(async (buffer, index) => {
      const fileName = `${resultId}_${index + 1}.jpg`;
      await fs.writeFile(path.join(runDir, fileName), buffer);
      return `${SCREENSHOTS_URL_PATH}/${runId}/${fileName}`;
    }),
  );
}

export async function saveRun({ type, tag, domain, scroll, scriptId, scriptName, scriptBytes }, run) {
  const id = crypto.randomUUID();

  const results = await Promise.all(
    run.results.map(async ({ screenshots, ...result }) => {
      const resultId = crypto.randomUUID();
      return { ...result, id: resultId, screenshots: await writeScreenshots(id, resultId, screenshots) };
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
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    results,
  };

  await appendRun(saved);
  return saved;
}

const runStatus = (run) => (run.errorCount ? 'error' : run.failCount ? 'fail' : 'pass');

function matchesFilters(run, { q, status, type }) {
  if (status && runStatus(run) !== status) return false;
  if (type && (run.type ?? 'vdo.ai.js') !== type) return false;
  if (!q) return true;
  const haystack = [run.tag, run.domain, ...run.results.map((r) => r.url)].join(' ').toLowerCase();
  return haystack.includes(q);
}

export async function listRuns({ page, pageSize, q = '', status = '', type = '' }) {
  const filters = { q: q.trim().toLowerCase(), status, type };
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
  await updateRuns((runs) => {
    if (!runs.some((r) => r.id === runId)) throw httpError(404, 'Run not found');
    return { runs: runs.filter((r) => r.id !== runId) };
  });
  await fs.rm(path.join(screenshotsDir, runId), { recursive: true, force: true });
}

export function clearRuns() {
  return updateRuns(async (runs) => {
    await fs.rm(screenshotsDir, { recursive: true, force: true });
    await clearScripts();
    return { runs: [], value: { deleted: runs.length } };
  });
}
