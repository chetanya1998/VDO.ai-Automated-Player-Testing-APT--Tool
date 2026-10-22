import config from '../config/index.js';
import { SUPPORTED_DEVICES } from '../services/browser.service.js';
import * as jobQueue from '../services/jobQueue.service.js';
import { CHECK_TYPE } from '../services/placementRunner.service.js';
import { loadScript, storeScript } from '../services/scriptStore.service.js';
import { httpError } from '../utils/httpError.js';

const TAG_PATTERN = /^[\w-]+$/;
const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;

const normalizeHost = (host) => host.toLowerCase().replace(/^www\./, '');

const normalizeDomain = (value) =>
  normalizeHost(String(value).trim().replace(/^https?:\/\//i, '').split('/')[0]);

function parseScrollValue(value, name, label, unit = '') {
  const { min, max } = config.placement.scrollLimits[name];
  if (value === undefined || value === null || value === '') return config.placement.lazyScroll[name];
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw httpError(400, `${label} must be between ${min} and ${max}${unit}`);
  return n;
}

function parseScroll(scroll = {}) {
  return {
    stepViewportRatio: parseScrollValue(scroll.stepViewportRatio, 'stepViewportRatio', 'Scroll ratio'),
    intervalMs: parseScrollValue(scroll.intervalMs, 'intervalMs', 'Scroll interval', ' ms'),
    maxSteps: config.placement.lazyScroll.maxSteps,
  };
}

const CHECK_TYPES = Object.values(CHECK_TYPE);

function parseCheckInput(body = {}) {
  const type = body.type ?? CHECK_TYPE.JS;
  if (!CHECK_TYPES.includes(type)) throw httpError(400, `Type must be one of: ${CHECK_TYPES.join(', ')}`);

  const domain = normalizeDomain(body.domain ?? '');
  if (!DOMAIN_PATTERN.test(domain)) throw httpError(400, 'Enter a valid domain, e.g. example.com');

  const tag = String(body.tag ?? '').trim();
  if (!TAG_PATTERN.test(tag)) throw httpError(400, 'Tag may only contain letters, numbers, _ and -');

  const devices = [...new Set(Array.isArray(body.devices) ? body.devices : SUPPORTED_DEVICES)];
  if (devices.length === 0 || !devices.every((d) => SUPPORTED_DEVICES.includes(d))) {
    throw httpError(400, `Devices must be any of: ${SUPPORTED_DEVICES.join(', ')}`);
  }

  if (!Array.isArray(body.urls)) throw httpError(400, '`urls` must be a list');
  const urls = [...new Set(body.urls.map((u) => String(u).trim()).filter(Boolean))];
  if (urls.length === 0) throw httpError(400, 'Add at least one URL');
  if (urls.length > config.checks.maxUrls) throw httpError(400, `At most ${config.checks.maxUrls} URLs per check`);

  for (const value of urls) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw httpError(400, `Not a valid URL: ${value}`);
    }
    if (!/^https?:$/.test(url.protocol)) throw httpError(400, `URL must start with http(s): ${value}`);
  }

  const scroll = parseScroll(body.scroll);
  const scriptName = String(body.scriptName ?? type).slice(0, 200);
  return { type, domain, tag, devices, urls, scroll, scriptName };
}

async function resolveScript(body, type) {
  if (body.scriptId && !body.script) {
    const script = await loadScript(body.scriptId);
    return { script, scriptId: body.scriptId };
  }

  const script = typeof body.script === 'string' ? body.script : '';
  if (!script.trim()) throw httpError(400, `Add the ${type} code`);
  if (Buffer.byteLength(script) > config.checks.maxScriptBytes) {
    throw httpError(400, `${type} must be under ${config.checks.maxScriptBytes / 1024 / 1024} MB`);
  }
  return { script, scriptId: await storeScript(script) };
}

export async function createPlacementCheck(req, res) {
  const input = parseCheckInput(req.body);
  const { script, scriptId } = await resolveScript(req.body, input.type);
  const job = jobQueue.enqueueJob({ ...input, script, scriptId, scriptBytes: Buffer.byteLength(script) });
  res.status(202).json(job);
}

export function getPlacementCheck(req, res) {
  const job = jobQueue.getJob(req.params.jobId);
  if (!job) throw httpError(404, 'Check not found. It may have expired; see History for finished runs.');
  res.json(job);
}
