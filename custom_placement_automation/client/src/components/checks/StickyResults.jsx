import { useState } from 'react';
import { Badge } from '../ui';
import VerdictTiles from './VerdictTiles.jsx';
import ScreenshotGallery from './ScreenshotGallery.jsx';
import { VERDICTS, verdictLabel, verdictTone } from '../../utils/verdicts.js';
import { formatDuration } from '../../utils/format.js';
import { reasonLabel } from '../../utils/reasons.js';

const FILTERS = [{ value: 'ALL', label: 'All' }, ...VERDICTS.map((verdict) => ({ value: verdict, label: verdictLabel(verdict) }))];
const GROUPS = [
  { key: 'core', title: 'Core checks · ST-01 to ST-12 (must test)' },
  { key: 'additional', title: 'Additional checks · ST-13 to ST-25 (recommended)' },
];

function CheckDetail({ item, onClose }) {
  return (
    <div className={`case-detail tone-${verdictTone(item.verdict)}`} role="region" aria-label={`${item.id} explanation`}>
      <div className="case-detail-head">
        <span className="case-id">{item.id}</span>
        <strong>{item.title}</strong>
        <Badge tone={verdictTone(item.verdict)}>{verdictLabel(item.verdict)}</Badge>
        <button type="button" className="case-detail-close" onClick={onClose} aria-label="Close explanation">×</button>
      </div>
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
      {item.seenAt && <p className="muted small">Seen at: {item.seenAt} (see the screenshot with the same name)</p>}
      {item.details && (
        <details className="event-detail">
          <summary>Technical detail (for engineers)</summary>
          <pre>{JSON.stringify(item.details, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

// One URL of a sticky violation check: 25 checks, evidence screenshots and what the player did.
export default function StickyResults({ result, index }) {
  const [filter, setFilter] = useState('ALL');
  const [openId, setOpenId] = useState(null);
  const sticky = result.sticky;
  const counts = sticky?.verdictCounts ?? {};
  const open = openId ? sticky?.cases.find((item) => item.id === openId) : null;

  return (
    <article className={`result result-${result.status}`}>
      <header className="result-header">
        <Badge tone={result.status}>Sticky: {result.status.toUpperCase()}</Badge>
        {sticky && <Badge tone={verdictTone(sticky.overallVerdict)}>{counts.FAIL ?? 0} failed · {counts.WARNING ?? 0} warnings</Badge>}
        <span className="muted">#{index + 1}</span>
        <a className="result-url" href={result.url} target="_blank" rel="noreferrer">{result.url}</a>
      </header>

      {result.reasons.length > 0 && (
        <div className="reasons">
          {result.reasons.map((reason) => <Badge key={reason} tone={result.status === 'error' ? 'error' : 'fail'}>{reasonLabel(reason)}</Badge>)}
        </div>
      )}

      <section className="deep-block" aria-label="Sticky violation results">
        <header className="deep-head">
          <div>
            <span className="block-eyebrow">Sticky violation check</span>
            <h4>{sticky ? `${counts.FAIL ?? 0} of 25 checks failed` : 'Checks were not run'}</h4>
          </div>
          {sticky && <Badge tone={verdictTone(sticky.overallVerdict)}>Overall {verdictLabel(sticky.overallVerdict)}</Badge>}
        </header>

        <dl className="facts">
          {sticky && (
            <>
              <dt>Player type</dt>
              <dd>{sticky.playerType}</dd>
              <dt>Floating started</dt>
              <dd>{sticky.floatingStartedAt ? `${sticky.floatingStartedAt.label} (scrolled ${sticky.floatingStartedAt.scrollY} px)` : 'never'}</dd>
              <dt>Viewport</dt>
              <dd>{sticky.viewport ? `${sticky.viewport.width}×${sticky.viewport.height}` : '—'}</dd>
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

        {sticky && <VerdictTiles counts={counts} total={25} />}

        {result.screenshots?.length > 0 && (
          <div className="deep-shots">
            <h5>Evidence screenshots · blue = vdo.ai player, red = problem area</h5>
            <ScreenshotGallery screenshots={result.screenshots} labels={result.screenshotLabels} />
          </div>
        )}

        {sticky && (
          <>
            <div className="filter-chips" role="radiogroup" aria-label="Filter checks by result">
              {FILTERS.map((option) => {
                const count = option.value === 'ALL' ? 25 : counts[option.value] ?? 0;
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
                        </button>
                      ))}
                    </div>
                    {open && items.some((item) => item.id === open.id) && <CheckDetail item={open} onClose={() => setOpenId(null)} />}
                  </div>
                );
              })}
            </div>
            {!open && <p className="muted small case-hint">Click any check to see what it tests, what was expected and what happened on this page.</p>}
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
