import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import config from '../config/index.js';
import { launchOptions } from './browser.service.js';
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
  player_not_found: 'vdo.ai player not found',
};

let pdfBrowserPromise = null;

function getPdfBrowser() {
  if (!pdfBrowserPromise) {
    logger.info('Launching headless browser for PDF reports');
    pdfBrowserPromise = chromium
      .launch({ ...launchOptions(), headless: true, timeout: 10000 })
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

const VERDICT_CLASS = { PASS: 'pass', FAIL: 'fail', WARNING: 'warn', UNKNOWN: 'unknown', NOT_APPLICABLE: 'na' };
const VERDICT_LABEL = { PASS: 'Pass', FAIL: 'Fail', WARNING: 'Warning', UNKNOWN: 'Unknown', NOT_APPLICABLE: 'N/A' };
const VERDICT_ORDER = ['PASS', 'FAIL', 'WARNING', 'UNKNOWN', 'NOT_APPLICABLE'];

const VERDICT_HELP = {
  PASS: 'the player did what it should',
  FAIL: 'something is broken and needs fixing',
  WARNING: 'it works, but something needs attention',
  UNKNOWN: 'the tool could not decide, usually because the rules are not signed off yet or the page gave too little data',
  NOT_APPLICABLE: 'the check does not apply to this page or device',
};
const GENERIC_REASON = 'Observed behaviour matched the rule.';

// One box per result type, so the totals read separately.
function renderVerdictTiles(counts, total) {
  const sum = total ?? VERDICT_ORDER.reduce((n, verdict) => n + (counts?.[verdict] ?? 0), 0);
  return `<div class="tiles">${VERDICT_ORDER.map((verdict) => {
    const value = counts?.[verdict] ?? 0;
    return `<div class="tile ${VERDICT_CLASS[verdict]}${value === 0 ? ' zero' : ''}"><b>${value}</b><span>${VERDICT_LABEL[verdict]}</span><small>${sum ? Math.round((value / sum) * 100) : 0}%</small></div>`;
  }).join('')}</div>`;
}

const renderLegend = () =>
  `<p class="legend">${VERDICT_ORDER.map((verdict) => `<b class="${VERDICT_CLASS[verdict]}">${VERDICT_LABEL[verdict]}</b>: ${VERDICT_HELP[verdict]}`).join(' · ')}</p>`;

// Deep test results per URL: 23 test cases each, never added across URLs or to the placement counts.
function renderDeepPerUrl(run) {
  const rows = run.results.filter((result) => result.deep);
  if (rows.length === 0) return '';
  return `<h2 class="section-title">Deep test · 23 test cases per URL</h2>
  <p class="section-note">Counted separately for each URL. Details for every test case follow under each URL.</p>
  <table class="cases per-url"><thead><tr><th>URL</th><th>Overall</th>${VERDICT_ORDER.map((verdict) => `<th class="num ${VERDICT_CLASS[verdict]}">${VERDICT_LABEL[verdict]}</th>`).join('')}</tr></thead><tbody>${rows
    .map((result, i) => `<tr><td class="url-cell">#${i + 1} ${escapeHtml(result.url)}</td><td><span class="badge ${VERDICT_CLASS[result.deep.overallVerdict] ?? 'unknown'}">${escapeHtml(VERDICT_LABEL[result.deep.overallVerdict] ?? result.deep.overallVerdict)}</span></td>${VERDICT_ORDER.map((verdict) => `<td class="num ${VERDICT_CLASS[verdict]}"><b>${result.deep.verdictCounts?.[verdict] ?? 0}</b>/23</td>`).join('')}</tr>`)
    .join('')}</tbody></table>
  ${renderLegend()}`;
}

function renderCase(c) {
  const reason = c.summary && c.summary !== GENERIC_REASON && c.summary !== c.meaning ? c.summary : '';
  return `<tr class="${VERDICT_CLASS[c.verdict] ?? 'unknown'}">
    <td class="case-id">${escapeHtml(c.testCaseId)}<span class="badge ${VERDICT_CLASS[c.verdict] ?? 'unknown'}">${escapeHtml(VERDICT_LABEL[c.verdict] ?? c.verdict)}</span></td>
    <td><b>${escapeHtml(c.title)}</b>${c.checks ? `<div class="plain"><i>What it tests:</i> ${escapeHtml(c.checks)}</div>` : ''}</td>
    <td>${
      // The legend already explains Unknown, so state the page's reason directly instead of repeating it.
      c.verdict === 'UNKNOWN' && reason
        ? `Could not decide: ${escapeHtml(reason)}`
        : `${escapeHtml(c.meaning ?? c.summary)}${reason ? `<div class="plain"><i>On this page:</i> ${escapeHtml(reason)}</div>` : ''}`
    }</td>
  </tr>`;
}

function renderDeep(deep, deepImages = []) {
  if (!deep) return '';
  const causes = deep.probableCauses ?? [];
  const evaluated = deep.cases?.length ?? 0;
  return `
    <div class="deep">
      <h3>Deep test · ${evaluated ? `${deep.verdictCounts?.PASS ?? 0} of ${evaluated} test cases passed` : '23 test cases not evaluated'} <span class="badge ${VERDICT_CLASS[deep.overallVerdict] ?? 'unknown'}">Overall ${escapeHtml(VERDICT_LABEL[deep.overallVerdict] ?? deep.overallVerdict)}</span></h3>
      ${renderVerdictTiles(deep.verdictCounts, evaluated || undefined)}
      ${deepImages.length ? `<p class="deep-h">Screenshots from the deep test (your custom code applied)</p><div class="shots">${deepImages.map((img) => `<figure><img src="${img.src}" alt=""><figcaption>${escapeHtml(img.label)}</figcaption></figure>`).join('')}</div>` : ''}
      ${
        evaluated
          ? `<table class="cases"><thead><tr><th>Test case</th><th>What it tests</th><th>What the result means</th></tr></thead><tbody>${deep.cases.map(renderCase).join('')}</tbody></table>`
          : ''
      }
      ${causes.length ? `<p class="deep-h">Likely causes${causes[0].rules === 'draft' ? ' (draft rules)' : ''}</p><ul class="hints">${causes.map((c) => `<li>${escapeHtml(c.testCaseId)}: ${escapeHtml(c.summary)} · owner: ${escapeHtml(c.owner)}</li>`).join('')}</ul>` : ''}
      ${deep.executionErrors?.length ? `<p class="deep-h">Errors</p><ul class="hints">${deep.executionErrors.map((e) => `<li>${escapeHtml(e.message)}</li>`).join('')}</ul>` : ''}
      ${deep.limitations?.length ? `<p class="deep-h">What this run could not confirm</p><ul class="notes">${deep.limitations.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : ''}
    </div>`;
}

const EXTRA_DETAIL_LABELS = {
  safeFramesLoaded: 'SafeFrames loaded on the page',
  insidePlayer: 'SafeFrame inside the player',
  shownInPlayer: 'Shown with a real size',
  keptSeparateFromPage: 'Kept separate from the page',
  size: 'Ad size (px)',
  onScreen: 'Visible on screen',
  otherSafeFramesOnPage: 'Other SafeFrame ads on the page',
  failedToLoad: 'Failed to load',
  intervalSec: 'Chosen interval (s)',
  adRequestSource: 'Ad requests read from',
  adCycles: 'Ad cycles seen',
  secondsBetweenAdCycles: 'Seconds between ad cycles',
  watchedWithPlayerInViewSec: 'Watched with the player in view (s)',
};
const showDetail = (value) => (typeof value === 'boolean' ? (value ? 'Yes' : 'No') : Array.isArray(value) ? value.join(', ') || '—' : String(value));

// Safe frame and refresh checks: listed on their own, never counted in the 23-case totals.
function renderExtraChecks(checks = []) {
  if (!checks.length) return '';
  return `
    <div class="deep extra">
      <h3>Additional checks <span class="muted-note">(not part of the 23 test cases)</span></h3>
      <table class="cases"><thead><tr><th>Check</th><th>What it looks at</th><th>Result on this page</th></tr></thead><tbody>${checks
        .map((check) => {
          const tone = VERDICT_CLASS[check.verdict] ?? 'unknown';
          const details = Object.entries(check.details ?? {}).map(([key, value]) => `${escapeHtml(EXTRA_DETAIL_LABELS[key] ?? key)}: ${escapeHtml(showDetail(value))}`).join(' · ');
          return `<tr class="${tone}">
            <td class="case-id">${escapeHtml(check.title)}<span class="badge ${tone}">${escapeHtml(VERDICT_LABEL[check.verdict] ?? check.verdict)}</span></td>
            <td>${escapeHtml(check.checks || '—')}</td>
            <td><b>${escapeHtml(check.summary)}</b><div class="plain">${escapeHtml(check.meaning)}</div>${details ? `<div class="plain"><i>Details:</i> ${details}</div>` : ''}</td>
          </tr>`;
        })
        .join('')}</tbody></table>
    </div>`;
}

// Sticky violation checker: 25 checks per URL (ST-01..ST-12 core, ST-13..ST-25 additional).
function renderStickyCase(c) {
  const tone = VERDICT_CLASS[c.verdict] ?? 'unknown';
  return `<tr class="${tone}">
    <td class="case-id">${escapeHtml(c.id)}<span class="badge ${tone}">${escapeHtml(VERDICT_LABEL[c.verdict] ?? c.verdict)}</span></td>
    <td><b>${escapeHtml(c.title)}</b><div class="plain"><i>What it tests:</i> ${escapeHtml(c.checks)}</div><div class="plain"><i>Expected:</i> ${escapeHtml(c.expected)}</div></td>
    <td><b>${escapeHtml(c.summary)}</b>${c.seenAt ? `<div class="plain"><i>Seen at:</i> ${escapeHtml(c.seenAt)}</div>` : ''}</td>
  </tr>`;
}

function renderStickyResult(run, result, index, images) {
  const sticky = result.sticky;
  const table = (group, heading) => {
    const rows = (sticky?.cases ?? []).filter((c) => c.group === group);
    return rows.length ? `<p class="deep-h">${heading}</p><table class="cases"><thead><tr><th>Check</th><th>What it tests</th><th>Result on this page</th></tr></thead><tbody>${rows.map(renderStickyCase).join('')}</tbody></table>` : '';
  };
  const facts = sticky
    ? [
        ['Player type', sticky.playerType],
        ['Floating started', sticky.floatingStartedAt ? `${sticky.floatingStartedAt.label} (scrolled ${sticky.floatingStartedAt.scrollY} px)` : 'never'],
        ['Viewport', sticky.viewport ? `${sticky.viewport.width}×${sticky.viewport.height}` : '—'],
        ['Snapshots taken', String(sticky.snapshots)],
        ['Duration', formatSeconds(result.durationMs)],
      ]
    : [['Duration', formatSeconds(result.durationMs)], ...(result.error ? [['Error', result.error]] : [])];
  return `
  <section class="result ${result.status} has-deep">
    <header>
      <span class="badge ${result.status}">Sticky: ${result.status.toUpperCase()}</span>
      ${sticky ? `<span class="badge ${VERDICT_CLASS[sticky.overallVerdict] ?? 'unknown'}">${sticky.verdictCounts.FAIL} failed · ${sticky.verdictCounts.WARNING} warnings</span>` : ''}
      <span class="index">#${index + 1}</span>
      <span class="url">${escapeHtml(result.url)}</span>
    </header>
    ${result.reasons.length ? `<div class="reasons">${result.reasons.map((r) => `<span>${escapeHtml(REASON_LABELS[r] ?? r)}</span>`).join('')}</div>` : ''}
    <dl>${facts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
    ${sticky ? renderVerdictTiles(sticky.verdictCounts, 25) : ''}
    ${images.length ? `<div class="shots"><p class="deep-h shots-h">Evidence screenshots (blue = vdo.ai player, red = problem area)</p>${images.map((img) => `<figure><img src="${img.src}" alt=""><figcaption>${escapeHtml(img.label)}</figcaption></figure>`).join('')}</div>` : ''}
    ${table('core', 'Core checks (ST-01 to ST-12, must test)')}
    ${table('additional', 'Additional checks (ST-13 to ST-25, recommended)')}
    ${sticky?.notes?.length ? `<p class="deep-h">Notes</p><ul class="notes">${sticky.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
  </section>`;
}

function renderResult(run, result, index, images, deepImages) {
  if (run.type === 'sticky') return renderStickyResult(run, result, index, images);
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

  const hasMore = Boolean(result.deep || result.extraChecks?.length);
  return `
  <section class="result ${result.status}${hasMore ? ' has-deep' : ''}">
    <header>
      <span class="badge ${result.status}">Placement: ${result.status.toUpperCase()}</span>
      <span class="index">#${index + 1}</span>
      <span class="url">${escapeHtml(result.url)}</span>
    </header>
    ${hasMore ? '<p class="part-h">Custom placement check</p>' : ''}
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
    ${renderDeep(result.deep, deepImages)}
    ${renderExtraChecks(result.extraChecks)}
  </section>`;
}

function renderReport(run, imagesByResult, deepImagesByResult) {
  const status = runStatus(run);
  const meta = [
    ['Domain', run.domain],
    ['Check type', run.type === 'sticky' ? 'Sticky violation check (ST-01 to ST-25)' : run.type ?? 'vdo.ai.js'],
    ['Device', run.device],
    ['Started', formatDateTime(run.startedAt)],
    ['Duration', formatSeconds(new Date(run.finishedAt) - new Date(run.startedAt))],
    ['Script', run.script?.name ?? '—'],
    ...(run.type === 'sticky' ? [] : [['Scroll', run.scroll ? `${run.scroll.stepViewportRatio} × screen every ${run.scroll.intervalMs} ms` : 'server default']]),
    ...(run.type === 'sticky'
      ? [['Code applied', run.stickyCode === 'none' || !run.stickyCode ? 'None (live tag as served)' : run.stickyCode]]
      : [
          ['Deep test', run.deep ? 'On (all 23 cases per URL, plus the safe frame check)' : 'Off'],
          ['Ad slot refresh check', run.refreshIntervalSec ? `On (every ${run.refreshIntervalSec} s)` : 'Off'],
        ]),
  ];
  const sticky = run.type === 'sticky';

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
  .section-title { font-size: 13px; margin: 0 0 2px; }
  .deep.extra { break-inside: avoid; }
  .shots-h { grid-column: 1 / -1; margin: 0; }
  .muted-note { font-weight: 400; font-size: 10px; color: #5c6570; }
  .part-h { margin: 2px 0 4px; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #5c6570; }
  .section-note { margin: 0 0 6px; color: #5c6570; font-size: 9.5px; }
  table.per-url { margin-bottom: 6px; }
  table.per-url th.num, table.per-url td.num { text-align: right; white-space: nowrap; }
  table.per-url td.num.pass b { color: #1a7f37; } table.per-url td.num.fail b { color: #c62828; } table.per-url td.num.warn b { color: #9a6700; }
  table.per-url .url-cell { overflow-wrap: anywhere; }
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
  .badge.warn { color: #9a6700; background: #fff4d6; } .badge.unknown { color: #475467; background: #eef0f3; } .badge.na { color: #475467; background: #f4f6f8; }
  .result.has-deep { break-inside: auto; }
  .result.has-deep > header, .result.has-deep .shots { break-inside: avoid; }
  .deep { margin-top: 10px; padding-top: 8px; border-top: 1px dashed #dde1e6; }
  .deep h3 { margin: 0 0 6px; font-size: 12px; display: flex; gap: 6px; align-items: center; }
  .deep-h { margin: 8px 0 2px; font-weight: 600; }
  .deep-counts { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
  .deep-counts .v { padding: 2px 8px; border-radius: 999px; background: #f4f6f8; font-size: 9.5px; }
  .deep-counts .v.pass b { color: #1a7f37; } .deep-counts .v.fail b { color: #c62828; } .deep-counts .v.warn b { color: #9a6700; }
  table.cases { width: 100%; border-collapse: collapse; font-size: 9.5px; }
  .tiles { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 8px; }
  .tile { border: 1px solid #dde1e6; border-top: 3px solid #98a2b3; border-radius: 6px; padding: 5px 8px; break-inside: avoid; }
  .tile b { display: block; font-size: 17px; line-height: 1.2; }
  .tile span { display: block; font-weight: 600; font-size: 10px; }
  .tile small { color: #5c6570; font-size: 9px; }
  .tile.pass { border-top-color: #1a7f37; } .tile.pass b { color: #1a7f37; }
  .tile.fail { border-top-color: #c62828; } .tile.fail b { color: #c62828; }
  .tile.warn { border-top-color: #9a6700; } .tile.warn b { color: #9a6700; }
  .tile.unknown { border-top-color: #667085; } .tile.unknown b { color: #475467; }
  .tile.na { border-top-color: #c0c6ce; }
  .tile.zero { opacity: 0.55; }
  .legend { margin: 0 0 14px; color: #5c6570; font-size: 9.5px; }
  .legend b.pass { color: #1a7f37; } .legend b.fail { color: #c62828; } .legend b.warn { color: #9a6700; }
  table.cases td.case-id { width: 62px; }
  table.cases td.case-id .badge { display: inline-block; margin-top: 3px; }
  table.cases .plain { color: #5c6570; margin-top: 2px; }
  table.cases tr.fail td:first-child { border-left: 3px solid #c62828; }
  table.cases tr.warn td:first-child { border-left: 3px solid #9a6700; }
  table.cases tr.pass td:first-child { border-left: 3px solid #1a7f37; }
  table.cases th, table.cases td { text-align: left; vertical-align: top; padding: 3px 5px; border-bottom: 1px solid #eef0f3; }
  table.cases th { color: #5c6570; font-weight: 600; }
  table.cases tr { break-inside: avoid; }
  table.cases td:first-child { white-space: nowrap; color: #5c6570; }
  .notes { margin: 2px 0 0; padding-left: 16px; color: #5c6570; }
</style>
</head>
<body>
  <h1>${escapeHtml(run.tag)} <span class="badge ${status}">${sticky ? 'Sticky violation check' : 'Placement check'}: ${status.toUpperCase()}</span></h1>
  <div class="sub">${sticky ? 'Sticky violation report' : 'Placement report'} · generated ${escapeHtml(formatDateTime(new Date().toISOString()))}</div>
  <dl class="meta">${meta.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
  <h2 class="section-title">${sticky ? 'Sticky violation check · 25 checks per URL' : 'Custom placement check'}</h2>
  <p class="section-note">${sticky ? 'Counts URLs. A URL fails when any of its 25 checks fails; warnings need a look but do not fail it. These are internal preventative QA checks, not official Google violation triggers: a failure needs investigation, and passing does not guarantee policy compliance.' : 'Counts URLs. A URL passes when your placement code puts a visible player on the page.'}</p>
  <div class="summary">
    <div><b>${run.passCount + run.failCount + run.errorCount}</b>URLs checked</div>
    <div class="pass"><b>${run.passCount}</b>URLs passed</div>
    <div class="fail"><b>${run.failCount}</b>URLs failed</div>
    <div class="error"><b>${run.errorCount}</b>URLs with errors</div>
  </div>
  ${run.deep ? renderDeepPerUrl(run) : ''}
  ${run.results.map((result, i) => renderResult(run, result, i, imagesByResult[i], deepImagesByResult[i])).join('')}
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

  const deepImagesByResult = await Promise.all(
    run.results.map(async (result) => {
      const labels = result.deep?.screenshotLabels ?? [];
      const images = await Promise.all(
        (result.deep?.screenshots ?? []).map(async (url, i) => ({ src: await readScreenshot(url), label: labels[i] ?? `Deep test screenshot ${i + 1}` })),
      );
      return images.filter((img) => img.src);
    }),
  );

  const browser = await getPdfBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(renderReport(run, imagesByResult, deepImagesByResult), { waitUntil: 'load' });
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
