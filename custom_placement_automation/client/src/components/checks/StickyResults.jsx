import { useState } from 'react';
import { Badge } from '../ui';
import VerdictTiles from './VerdictTiles.jsx';
import ScreenshotGallery from './ScreenshotGallery.jsx';
import { verdictLabel, verdictTone } from '../../utils/verdicts.js';
import { formatDuration } from '../../utils/format.js';
import { reasonLabel } from '../../utils/reasons.js';

// Status criteria for sticky checks: only Pass, Fail and Warning (= could not be judged).
const STICKY_VERDICTS = ['PASS', 'FAIL', 'WARNING'];
const FILTERS = [{ value: 'ALL', label: 'All' }, ...STICKY_VERDICTS.map((verdict) => ({ value: verdict, label: verdictLabel(verdict) }))];
const GROUPS = [
  { key: 'core', title: 'Mandatory checks · ST-01 to ST-13' },
  { key: 'additional', title: 'Additional checks · ST-14 to ST-25' },
];

// Overall from the share of judged checks that passed: ≥ 80% Pass, 50–80% Pass · Review required, < 50% Fail.
function stickyOverall(sticky) {
  if (sticky.overallVerdict === 'PASS') return sticky.review ? { label: 'Pass · Review required', tone: 'warn' } : { label: 'Pass', tone: 'pass' };
  if (sticky.overallVerdict === 'FAIL') return { label: 'Fail', tone: 'fail' };
  return { label: 'Could not be judged', tone: 'warn' };
}

const hostOf = (value) => { try { return new URL(value).hostname; } catch { return value; } };

function CheckDetail({ item, evidence, onClose }) {
  return (
    <div className={`case-detail tone-${verdictTone(item.verdict)}`} role="region" aria-label={`${item.id} explanation`}>
      <div className="case-detail-head">
        <span className="case-id">{item.id}</span>
        <strong>{item.title}</strong>
        <Badge tone={verdictTone(item.verdict)}>{verdictLabel(item.verdict)}</Badge>
        <button type="button" className="case-detail-close" onClick={onClose} aria-label="Close explanation">×</button>
      </div>
      <div className="sticky-detail-body">
        <div className="sticky-detail-text">
          <div className="case-plain">
            <h6>What this test checks</h6>
            <p>{item.checks}</p>
          </div>
          <div className="case-plain">
            <h6>Expected</h6>
            <p>{item.expected}</p>
          </div>
          <div className="case-plain case-plain-result">
            <h6>Result: {verdictLabel(item.verdict)}</h6>
            <p>{item.summary}</p>
          </div>
          <p className="muted small">{item.meaning}</p>
          {item.details && (
            <details className="event-detail">
              <summary>Technical detail (for engineers)</summary>
              <pre>{JSON.stringify(item.details, null, 2)}</pre>
            </details>
          )}
        </div>
        {evidence ? (
          <div className="sticky-evidence">
            <h6>Screenshot evidence</h6>
            <ScreenshotGallery screenshots={[evidence.src]} labels={[evidence.label]} />
          </div>
        ) : (
          <p className="muted small">No screenshot for this check.</p>
        )}
      </div>
    </div>
  );
}

// One URL of a sticky violation check: the mandatory (and optional additional) checks, each with screenshot evidence.
export default function StickyResults({ result, index }) {
  const [filter, setFilter] = useState('ALL');
  const [openId, setOpenId] = useState(null);
  const sticky = result.sticky;
  const counts = sticky?.verdictCounts ?? {};
  const total = sticky?.total ?? sticky?.cases?.length ?? 0;
  const open = openId ? sticky?.cases.find((item) => item.id === openId) : null;
  const overall = sticky ? stickyOverall(sticky) : null;
  const judged = (counts.PASS ?? 0) + (counts.FAIL ?? 0);
  const evidenceFor = (item) => (Number.isInteger(item?.evidence) && result.screenshots?.[item.evidence]
    ? { src: result.screenshots[item.evidence], label: result.screenshotLabels?.[item.evidence] ?? `Screenshot ${item.evidence + 1}` }
    : null);

  return (
    <article className={`result result-${result.status}`}>
      <header className="result-header">
        <Badge tone={result.status}>Sticky: {result.status.toUpperCase()}</Badge>
        {overall && <Badge tone={overall.tone}>Overall {overall.label}</Badge>}
        {result.offDomain && <Badge tone="warn">Staging / preview: {hostOf(result.url)}</Badge>}
        <span className="muted">#{index + 1}</span>
        <a className="result-url" href={result.url} target="_blank" rel="noreferrer">{result.url}</a>
      </header>

      {result.reasons.length > 0 && (
        <div className="reasons">
          {result.reasons.map((reason) => <Badge key={reason} tone={reason === 'review_required' ? 'warn' : result.status === 'error' ? 'error' : 'fail'}>{reasonLabel(reason)}</Badge>)}
        </div>
      )}

      <section className="deep-block" aria-label="Sticky violation results">
        <header className="deep-head">
          <div>
            <span className="block-eyebrow">Sticky violation check · {sticky?.includeAdditional ? 'mandatory + additional' : 'mandatory checks'}</span>
            <h4>
              {sticky
                ? judged ? `${counts.PASS} of ${judged} judged checks passed (${Math.round(sticky.passShare * 100)}%)` : 'No check could be judged'
                : 'Checks were not run'}
            </h4>
          </div>
          {overall && <Badge tone={overall.tone}>Overall {overall.label}</Badge>}
        </header>

        <dl className="facts">
          {sticky && (
            <>
              <dt>Player type</dt>
              <dd>{sticky.playerType}</dd>
              <dt>Floating started</dt>
              <dd>{sticky.floatingStartedAt ? `${sticky.floatingStartedAt.label} (scrolled ${sticky.floatingStartedAt.scrollY} px)` : 'never'}</dd>
              <dt>Viewport</dt>
              <dd>{sticky.viewport ? `${sticky.viewport.width}×${sticky.viewport.height}` : '—'}{sticky.browserVersion ? ` · browser ${sticky.browserVersion}` : ''}</dd>
            </>
          )}
          <dt>Duration</dt>
          <dd>{formatDuration(result.durationMs)}</dd>
          {result.error && (
            <>
              <dt>Error</dt>
              <dd>{result.error}</dd>
            </>
          )}
        </dl>

        {sticky && <VerdictTiles counts={counts} total={total} verdicts={STICKY_VERDICTS} />}
        {sticky && (
          <p className="muted small">
            Overall rule: share of judged checks (Pass + Fail) that passed. 80% or more = Pass · 50% to under 80% = Pass · Review required ·
            under 50% = Fail. Warnings could not be judged on this page and are left out.
          </p>
        )}

        {!sticky && result.screenshots?.length > 0 && (
          <div className="deep-shots">
            <h5>What the site showed</h5>
            <ScreenshotGallery screenshots={result.screenshots} labels={result.screenshotLabels} />
          </div>
        )}

        {sticky && (
          <>
            <div className="filter-chips" role="radiogroup" aria-label="Filter checks by result">
              {FILTERS.map((option) => {
                const count = option.value === 'ALL' ? total : counts[option.value] ?? 0;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={filter === option.value}
                    className={`filter-chip${filter === option.value ? ' active' : ''}`}
                    onClick={() => setFilter(option.value)}
                    disabled={count === 0 && option.value !== 'ALL'}
                  >
                    {option.label} <span>{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="case-groups">
              {GROUPS.map((group) => {
                const items = sticky.cases.filter((item) => item.group === group.key && (filter === 'ALL' || item.verdict === filter));
                if (items.length === 0) return null;
                return (
                  <div key={group.key} className="case-group">
                    <h5>{group.title}</h5>
                    <div className="case-grid">
                      {items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`case-tile tone-${verdictTone(item.verdict)}${openId === item.id ? ' open' : ''}`}
                          aria-expanded={openId === item.id}
                          onClick={() => setOpenId(openId === item.id ? null : item.id)}
                          title={item.summary}
                        >
                          <span className="case-tile-top">
                            <span className="case-id">{item.id}</span>
                            <span className={`case-verdict tone-${verdictTone(item.verdict)}`}>{verdictLabel(item.verdict)}</span>
                          </span>
                          <span className="case-title">{item.title}</span>
                          {Number.isInteger(item.evidence) && <span className="case-evidence">Screenshot #{item.evidence + 1}</span>}
                        </button>
                      ))}
                    </div>
                    {open && items.some((item) => item.id === open.id) && <CheckDetail item={open} evidence={evidenceFor(open)} onClose={() => setOpenId(null)} />}
                  </div>
                );
              })}
            </div>
            {!open && <p className="muted small case-hint">Click any check to see what it tests, what was expected, what happened and its screenshot.</p>}
            {!sticky.includeAdditional && <p className="muted small">Additional checks (ST-14 to ST-25) were not selected for this run.</p>}

            {result.screenshots?.length > 0 && (
              <details className="deep-shots">
                <summary>All evidence screenshots ({result.screenshots.length}) · blue = vdo.ai player, red = problem area</summary>
                <ScreenshotGallery screenshots={result.screenshots} labels={result.screenshotLabels} />
              </details>
            )}
            {sticky.notes?.length > 0 && (
              <ul className="muted small">{sticky.notes.map((note) => <li key={note}>{note}</li>)}</ul>
            )}
            <p className="muted small">
              These are internal preventative QA checks, not official Google violation triggers: a failure needs investigation, and passing does
              not guarantee policy compliance.
            </p>
          </>
        )}
      </section>
    </article>
  );
}
