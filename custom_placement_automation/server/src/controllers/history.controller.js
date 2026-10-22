import * as resultsService from '../services/results.service.js';
import { hasPendingJobs } from '../services/jobQueue.service.js';
import { renderRunPdf } from '../services/pdfReport.service.js';
import { httpError } from '../utils/httpError.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toPositiveInt = (value, fallback, max) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
};

export async function listRuns(req, res) {
  const page = toPositiveInt(req.query.page, 1, 10_000);
  const pageSize = toPositiveInt(req.query.pageSize, 20, 100);
  const q = String(req.query.q ?? '').slice(0, 200);
  const status = ['pass', 'fail', 'error'].includes(req.query.status) ? req.query.status : '';
  const type = ['vdo.ai.js', 'style.css'].includes(req.query.type) ? req.query.type : '';
  res.json(await resultsService.listRuns({ page, pageSize, q, status, type }));
}

export async function getRun(req, res) {
  if (!UUID_PATTERN.test(req.params.runId)) throw httpError(404, 'Run not found');
  res.json(await resultsService.getRun(req.params.runId));
}

export async function deleteRun(req, res) {
  if (!UUID_PATTERN.test(req.params.runId)) throw httpError(404, 'Run not found');
  await resultsService.deleteRun(req.params.runId);
  res.status(204).end();
}

export async function clearRuns(_req, res) {
  if (hasPendingJobs()) throw httpError(409, 'A check is running. Clear history once it finishes.');
  res.json(await resultsService.clearRuns());
}

export async function downloadRunPdf(req, res) {
  if (!UUID_PATTERN.test(req.params.runId)) throw httpError(404, 'Run not found');
  const { pdf, fileName } = await renderRunPdf(req.params.runId);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Content-Length': pdf.length,
  });
  res.send(pdf);
}
