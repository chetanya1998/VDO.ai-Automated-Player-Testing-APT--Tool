import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import config from '../config/index.js';
import { SCREENSHOTS_URL_PATH, getRun } from './results.service.js';
import logger from '../utils/logger.js';

const REASON_LABELS = {
  page_blocked: 'Page blocked',
  div_not_found: 'Wrapper div not found',
  no_event_emitted: 'No vdo:placement event',
  placement_failed: 'Placement reported failure',
  script_not_loaded: 'vdo.ai.js not requested',
  wrapper_hidden: 'Wrapper hidden',
  timeout: 'Page load timed out',
  page_closed: 'Page closed during check',
};

let pdfBrowserPromise = null;

function getPdfBrowser() {
  if (!pdfBrowserPromise) {
    logger.info('Launching headless Chromium for PDF reports');
    pdfBrowserPromise = chromium
      .launch({ channel: 'chromium', headless: true, timeout: 10000 })
      .then((browser) => {
        browser.on('disconnected', () => {
          pdfBrowserPromise = null;
        });
        return browser;
      })
      .catch((err) => {
        pdfBrowserPromise = null;
        throw err;
      });
  }
  return pdfBrowserPromise;
}

export async function closePdfBrowser() {
  if (!pdfBrowserPromise) return;
  const browser = await pdfBrowserPromise.catch(() => null);
  pdfBrowserPromise = null;
  await browser?.close();
}

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB') : '—');
const formatSeconds = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : '—');
const formatBox = (box) =>
  box ? `${Math.round(box.width)}×${Math.round(box.height)} at (${Math.round(box.x)}, ${Math.round(box.y)})` : '—';

const runStatus = (run) => (run.errorCount ? 'error' : run.failCount ? 'fail' : 'pass');

async function readScreenshot(url) {
  if (!url?.startsWith(`${SCREENSHOTS_URL_PATH}/`)) return null;
  const relative = url.slice(SCREENSHOTS_URL_PATH.length + 1);
  const filePath = path.resolve(config.storage.screenshotsDir, relative);
  if (!filePath.startsWith(path.resolve(config.storage.screenshotsDir) + path.sep)) return null;
  try {
    return `data:image/jpeg;base64,${(await fs.readFile(filePath)).toString('base64')}`;
  } catch {
    return null;
  }
}

function describeEvent(run, result) {
  if (run.type === 'style.css') return 'not checked (CSS check)';
  if (result.status === 'error' || result.reasons.includes('no_event_emitted')) return 'not received';
  const detail = result.eventDetail;
  if (typeof detail === 'boolean') return `received (${detail})`;
  if (detail && typeof detail === 'object' && 'success' in detail) return `received (success: ${detail.success})`;
  return 'received';
}

function renderResult(run, result, index, images) {
  const wrapper = result.wrapper;
  const hints = result.diagnostics?.hints ?? [];
  const facts = [
    ['vdo:placement', describeEvent(run, result)],
    ['Anchor', result.eventDetail?.anchor ?? '—'],
    ['Wrapper div', wrapper?.found ? `found ×${wrapper.count}, ${wrapper.visible ? 'visible' : 'hidden'}` : 'not found'],
    ['Wrapper box', formatBox(wrapper?.box)],
    ['Duration', formatSeconds(result.durationMs)],
    ...(result.error ? [['Error', result.error]] : []),
  ];

  return `
  <section class="result ${result.status}">
    <header>
      <span class="badge ${result.status}">${result.status.toUpperCase()}</span>
      <span class="index">#${index + 1}</span>
      <span class="url">${escapeHtml(result.url)}</span>
    </header>
    ${
      result.reasons.length
        ? `<div class="reasons">${result.reasons.map((r) => `<span>${escapeHtml(REASON_LABELS[r] ?? r)}</span>`).join('')}</div>`
        : ''
    }
    <dl>${facts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
    ${hints.length ? `<ul class="hints">${hints.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>` : ''}
    ${
      result.eventDetail !== null && result.eventDetail !== undefined && run.type !== 'style.css'
        ? `<pre>${escapeHtml(JSON.stringify(result.eventDetail, null, 2))}</pre>`
        : ''
    }
    ${
      images.length
        ? `<div class="shots">${images
            .map(
              (img) =>
                `<figure><img src="${img.src}" alt=""><figcaption>${escapeHtml(img.label)}</figcaption></figure>`,
            )
            .join('')}</div>`
        : ''
    }
  </section>`;
}

function renderReport(run, imagesByResult) {
  const status = runStatus(run);
  const meta = [
    ['Domain', run.domain],
    ['Check type', run.type ?? 'vdo.ai.js'],
    ['Device', run.device],
    ['Started', formatDateTime(run.startedAt)],
    ['Duration', formatSeconds(new Date(run.finishedAt) - new Date(run.startedAt))],
    ['Script', run.script?.name ?? '—'],
    ['Scroll', run.scroll ? `${run.scroll.stepViewportRatio} × screen every ${run.scroll.intervalMs} ms` : 'server default'],
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(run.tag)} placement report</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 11px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1c2128; }
  h1 { margin: 0 0 2px; font-size: 18px; }
  .sub { color: #5c6570; margin-bottom: 12px; }
  .meta { display: grid; grid-template-columns: max-content 1fr max-content 1fr; gap: 3px 14px; margin: 0 0 14px; padding: 10px 12px; background: #f4f6f8; border-radius: 6px; }
  .meta dt { color: #5c6570; }
  .meta dd { margin: 0; overflow-wrap: anywhere; }
  .summary { display: flex; gap: 10px; margin-bottom: 16px; }
  .summary div { flex: 1; padding: 8px 10px; border: 1px solid #dde1e6; border-radius: 6px; }
  .summary b { display: block; font-size: 16px; }
  .summary .pass b { color: #1a7f37; } .summary .fail b { color: #c62828; } .summary .error b { color: #9a6700; }
  .badge { font-weight: 700; font-size: 9.5px; padding: 1px 7px; border-radius: 999px; }
  .badge.pass { color: #1a7f37; background: #e6f4ea; } .badge.fail { color: #c62828; background: #fdecea; } .badge.error { color: #9a6700; background: #fff4d6; }
  .result { break-inside: avoid; border: 1px solid #dde1e6; border-left: 4px solid #dde1e6; border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; }
  .result.pass { border-left-color: #1a7f37; } .result.fail { border-left-color: #c62828; } .result.error { border-left-color: #9a6700; }
  .result header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .index { color: #5c6570; }
  .url { overflow-wrap: anywhere; font-weight: 500; }
  .reasons { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
  .reasons span { font-size: 9.5px; font-weight: 600; color: #c62828; background: #fdecea; padding: 1px 7px; border-radius: 999px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0; }
  dt { color: #5c6570; }
  dd { margin: 0; overflow-wrap: anywhere; }
  .hints { margin: 6px 0 0; padding-left: 16px; color: #9a6700; }
  pre { margin: 6px 0 0; padding: 6px 8px; background: #f4f6f8; border-radius: 4px; font-size: 9.5px; white-space: pre-wrap; }
  .shots { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
  figure { margin: 0; }
  img { display: block; width: 100%; max-height: 110mm; object-fit: contain; object-position: top; border: 1px solid #dde1e6; border-radius: 4px; background: #f4f6f8; }
  figcaption { color: #5c6570; font-size: 9.5px; margin-top: 2px; }
</style>
</head>
<body>
  <h1>${escapeHtml(run.tag)} <span class="badge ${status}">${status.toUpperCase()}</span></h1>
  <div class="sub">Placement report · generated ${escapeHtml(formatDateTime(new Date().toISOString()))}</div>
  <dl class="meta">${meta.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
  <div class="summary">
    <div><b>${run.passCount + run.failCount + run.errorCount}</b>URLs</div>
    <div class="pass"><b>${run.passCount}</b>Pass</div>
    <div class="fail"><b>${run.failCount}</b>Fail</div>
    <div class="error"><b>${run.errorCount}</b>Error</div>
  </div>
  ${run.results.map((result, i) => renderResult(run, result, i, imagesByResult[i])).join('')}
</body>
</html>`;
}

export async function renderRunPdf(runId) {
  const run = await getRun(runId);
  const imagesByResult = await Promise.all(
    run.results.map(async (result) => {
      const labels = result.screenshotLabels ?? [];
      const images = await Promise.all(
        (result.screenshots ?? []).map(async (url, i) => ({ src: await readScreenshot(url), label: labels[i] ?? `Screenshot ${i + 1}` })),
      );
      return images.filter((img) => img.src);
    }),
  );

  const browser = await getPdfBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(renderReport(run, imagesByResult), { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#888;">${escapeHtml(run.tag)} · ${escapeHtml(run.device)} · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
    });

    const date = (run.startedAt ?? '').slice(0, 10);
    return { pdf, fileName: `${run.tag}_${run.device}_${date}.pdf`.replace(/[^\w.-]/g, '_') };
  } finally {
    await page.close().catch(() => {});
  }
}
