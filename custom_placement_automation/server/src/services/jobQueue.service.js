import crypto from 'node:crypto';
import config from '../config/index.js';
import { runPlacementChecks } from './placementRunner.service.js';
import { saveRun } from './results.service.js';
import logger from '../utils/logger.js';

export const JOB_STATUS = { QUEUED: 'queued', RUNNING: 'running', COMPLETED: 'completed', FAILED: 'failed' };

const jobs = new Map();
const queue = [];
let activeJobs = 0;

function toPublicJob(job) {
  const { input, ...publicJob } = job;
  return {
    ...publicJob,
    type: input.type,
    tag: input.tag,
    domain: input.domain,
    devices: input.devices,
    scroll: input.scroll,
    script: { id: input.scriptId, name: input.scriptName, bytes: input.scriptBytes },
  };
}

async function processJob(job) {
  const { input } = job;
  job.status = JOB_STATUS.RUNNING;
  job.startedAt = new Date().toISOString();
  logger.info(`Job ${job.id} [${input.type}]: ${input.urls.length} URL(s) × ${input.devices.join('+')} for ${input.tag}`);

  try {
    job.runs = await Promise.all(
      input.devices.map(async (device) => {
        const run = await runPlacementChecks({
          type: input.type,
          tag: input.tag,
          device,
          urls: input.urls,
          script: input.script,
          scroll: input.scroll,
          onUrlDone: () => {
            job.progress.done += 1;
          },
        });

        return saveRun(input, run);
      }),
    );
    job.status = JOB_STATUS.COMPLETED;
  } catch (err) {
    logger.error(`Job ${job.id} failed:`, err);
    job.status = JOB_STATUS.FAILED;
    job.error = err.message;
  } finally {
    job.finishedAt = new Date().toISOString();
    job.input.script = null;
    setTimeout(() => jobs.delete(job.id), config.checks.jobTtlMs).unref();
  }
}

function startNextJobs() {
  while (activeJobs < config.checks.maxConcurrentJobs && queue.length > 0) {
    const job = queue.shift();
    activeJobs += 1;
    processJob(job).finally(() => {
      activeJobs -= 1;
      startNextJobs();
    });
  }
}

export function enqueueJob(input) {
  const job = {
    id: crypto.randomUUID(),
    input,
    status: JOB_STATUS.QUEUED,
    progress: { done: 0, total: input.urls.length * input.devices.length },
    runs: [],
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  };

  jobs.set(job.id, job);
  queue.push(job);
  startNextJobs();
  return toPublicJob(job);
}

export function getJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  return { ...toPublicJob(job), queuePosition: job.status === JOB_STATUS.QUEUED ? queue.indexOf(job) + 1 : 0 };
}

export const hasPendingJobs = () => activeJobs > 0 || queue.length > 0;
