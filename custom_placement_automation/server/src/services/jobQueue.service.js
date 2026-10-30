import crypto from 'node:crypto';
import config from '../config/index.js';
import { runPlacementChecks } from './placementRunner.service.js';
import { runDeepCheck } from './deepValidation.service.js';
import { STICKY_TYPE, runStickyChecks } from './stickyRunner.service.js';
import { saveRun } from './results.service.js';
import logger from '../utils/logger.js';
import { getDatabase } from './database.service.js';
import { loadScript } from './scriptStore.service.js';
import { httpError } from '../utils/httpError.js';

export const JOB_STATUS = { QUEUED: 'queued', RUNNING: 'running', COMPLETED: 'completed', FAILED: 'failed' };

const jobs = new Map();
const queue = [];
let activeJobs = 0;
let stopping = false;
let maintenance = false;
let admissions = 0;
const active = new Set();

export async function initializeQueue() {
  const database = getDatabase();
  await database.pruneJobs(config.checks.jobTtlMs);
  for (const job of await database.jobs()) {
    jobs.set(job.id, job);
    if (job.status === JOB_STATUS.QUEUED) queue.push(job);
    else if (job.finishedAt) {
      const remaining = Math.max(0, Date.parse(job.finishedAt) + config.checks.jobTtlMs - Date.now());
      setTimeout(() => jobs.delete(job.id), remaining).unref();
    }
  }
  startNextJobs();
}

function toPublicJob(job) {
  const { input, ...publicJob } = job;
  return {
    ...publicJob,
    type: input.type,
    tag: input.tag,
    domain: input.domain,
    devices: input.devices,
    scroll: input.scroll,
    deep: input.deep === true,
    refreshIntervalSec: input.refreshIntervalSec ?? null,
    stickyCode: input.stickyCode ?? null,
    stickyAdditional: input.stickyAdditional === true,
    script: { id: input.scriptId, name: input.scriptName, bytes: input.scriptBytes },
  };
}

async function processJob(job) {
  const { input } = job;
  job.status = JOB_STATUS.RUNNING;
  job.startedAt = new Date().toISOString();
  logger.info(`Job ${job.id} [${input.type}]: ${input.urls.length} URL(s) × ${input.devices.join('+')} for ${input.tag}`);

  try {
    await getDatabase().saveJob(job);
    const script = input.scriptId ? await loadScript(input.scriptId) : '';
    // One context per admitted job: a failed device cannot leave a sibling running.
    for (const device of input.devices) {
        if (stopping) throw new Error('Execution interrupted by server shutdown');
        const onUrlDone = async () => {
          job.progress.done += 1;
          await getDatabase().saveJob(job);
          if (stopping) throw new Error('Execution interrupted by server shutdown');
        };
        // Sticky violation checker: its own scenario instead of the placement check.
        if (input.type === STICKY_TYPE) {
          const run = await runStickyChecks({ tag: input.tag, device, urls: input.urls, script, codeType: input.stickyCode ?? 'none', includeAdditional: input.stickyAdditional === true, onUrlDone });
          job.runs.push(await saveRun(input, run));
          await getDatabase().saveJob(job);
          continue;
        }
        const run = await runPlacementChecks({
          type: input.type,
          tag: input.tag,
          device,
          urls: input.urls,
          script,
          scroll: input.scroll,
          onUrlDone,
        });

        // Deep test and/or refresh check: after the unchanged placement check, one extra browser visit per URL.
        if (input.deep || input.refreshIntervalSec) {
          for (const result of run.results) {
            if (stopping) throw new Error('Execution interrupted by server shutdown');
            const deep = await runDeepCheck({
              url: result.url,
              domain: input.domain,
              tag: input.tag,
              device,
              type: input.type,
              script,
              scroll: input.scroll,
              refreshIntervalSec: input.refreshIntervalSec ?? null,
            });
            const { extraChecks = [], ...summary } = deep.summary;
            // The safe frame check belongs to the deep test; the refresh check is its own option.
            result.extraChecks = extraChecks.filter((check) => input.deep || check.id === 'SLOT_REFRESH');
            if (input.deep) {
              result.deep = summary;
              // Saved as files with the run, like the placement screenshots.
              result.deepScreenshots = deep.screenshots;
            }
            job.progress.done += 1;
            await getDatabase().saveJob(job);
          }
        }

        job.runs.push(await saveRun(input, run));
        await getDatabase().saveJob(job);
    }
    job.status = JOB_STATUS.COMPLETED;
  } catch (err) {
    logger.error(`Job ${job.id} failed:`, err);
    job.status = JOB_STATUS.FAILED;
    job.error = err.message;
  } finally {
    job.finishedAt = new Date().toISOString();
    await getDatabase().saveJob(job);
    await getDatabase().pruneJobs(config.checks.jobTtlMs);
    setTimeout(() => jobs.delete(job.id), config.checks.jobTtlMs).unref();
  }
}

function startNextJobs() {
  while (!stopping && !maintenance && activeJobs < config.checks.maxConcurrentJobs && queue.length > 0) {
    const job = queue.shift();
    activeJobs += 1;
    const task = processJob(job).catch((error) => {
      stopping = true;
      logger.error('Queue stopped after persistence failure; restart after restoring the database.', error);
    }).finally(() => {
      activeJobs -= 1;
      active.delete(task);
      startNextJobs();
    });
    active.add(task);
  }
}

export async function enqueueJob(input) {
  if (stopping || maintenance) throw httpError(503, 'Queue is stopping or undergoing maintenance');
  const { script, ...storedInput } = input;
  const job = {
    id: crypto.randomUUID(),
    input: storedInput,
    status: JOB_STATUS.QUEUED,
    progress: { done: 0, total: input.urls.length * input.devices.length * (input.deep || input.refreshIntervalSec ? 2 : 1) },
    runs: [],
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  };

  admissions += 1;
  try {
    if (!await getDatabase().admit(job, config.checks.maxPendingJobs)) throw httpError(429, 'Queue is full. Wait for a check to finish.');
    jobs.set(job.id, job);
    queue.push(job);
    startNextJobs();
    return toPublicJob(job);
  } finally { admissions -= 1; }
}

export function getJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  return { ...toPublicJob(job), queuePosition: job.status === JOB_STATUS.QUEUED ? queue.indexOf(job) + 1 : 0 };
}

export const hasPendingJobs = () => activeJobs > 0 || queue.length > 0 || admissions > 0;
export async function withIdleQueue(action) {
  if (maintenance || hasPendingJobs()) throw httpError(409, 'Wait for pending checks to finish before changing history');
  maintenance = true;
  try { return await action(); } finally { maintenance = false; startNextJobs(); }
}
export const queueState = () => ({ active: activeJobs, queued: queue.length, stopping, limit: config.checks.maxPendingJobs });
export function stopQueue() { stopping = true; }
export async function drainQueue() { await Promise.allSettled([...active]); }
