import { useState } from 'react';
import { Badge } from '../ui';
import VerdictTiles from './VerdictTiles.jsx';
import ScreenshotGallery from './ScreenshotGallery.jsx';
import { verdictLabel, verdictTone } from '../../utils/verdicts.js';
import { formatDuration } from '../../utils/format.js';
import { reasonLabel } from '../../utils/reasons.js';
import { UNIT_LABELS } from '../../utils/checkTypes.js';

// Implementation validator: only PASS, WARNING and FAIL. A WARNING never makes the tag FAIL.
const IMPLEMENTATION_VERDICTS = ['PASS', 'WARNING', 'FAIL'];
const STEPS = ['Network', 'Logger', 'Elements'];
const STEP_HINTS = {
  Network: 'vdo.ai.js requests with the cache disabled',
  Logger: 'event, tagName, page_url and dep of each logger request',
  Elements: 'script, player and banner div in the page',
};
const FILTERS = [{ value: 'ALL', label: 'All' }, ...[...IMPLEMENTATION_VERDICTS, 'NOT_ELIGIBLE'].map((verdict) => ({ value: verdict, label: verdictLabel(verdict) }))];

const hostOf = (value) => { try { return new URL(value).hostname; } catch { return value; } };
const seconds = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : '—');

function CaseRow({ item, open, onToggle }) {
  const tone = verdictTone(item.verdict);
  return (
    <>
      <tr className={`impl-row tone-${tone}`}>
        <td className="impl-id">
          <span className="case-id">{item.id}</span>
          <span className="impl-title">{item.title}</span>
        </td>
        <td><Badge tone={tone}>{verdictLabel(item.verdict)}</Badge></td>
        <td className="impl-evidence">
          <p>{item.summary}</p>
          {item.verdict !== 'NOT_ELIGIBLE' && item.evidenceLines?.length > 0 && (
            <ul>{item.evidenceLines.map((line, i) => <li key={`${i}-${line}`}>{line}</li>)}</ul>
          )}
          {item.verdict !== 'NOT_ELIGIBLE' && <button type="button" className="link-button" onClick={onToggle} aria-expanded={open}>
            {open ? 'Hide what this checks' : 'What this checks'}
          </button>}
        </td>
      </tr>
      {open && (
        <tr className="impl-detail-row">
          <td colSpan={3}>
            <div className="case-plain"><h6>How</h6><p>{item.checks}</p></div>
            <div className="case-plain"><h6>Expected</h6><p>{item.expected}</p></div>
            {item.expectedScript && <div className="case-plain"><h6>Expected script</h6><p><code>{item.expectedScript}</code></p></div>}
            <p className="muted small">{item.meaning}</p>
            <details className="event-detail">
              <summary>Technical detail (for engineers)</summary>
              <pre>{JSON.stringify(item.evidence, null, 2)}</pre>
            </details>
          </td>
        </tr>
      )}
    </>
  );
}

function TagBlock({ result }) {
  const [filter, setFilter] = useState('ALL');
  // A tag that is not on this page is not tested here; say so instead of listing 13 not-eligible rows.
  if (result.eligible === false) {
    return (
      <section className="impl-tag tone-na" aria-label={`${result.tag} not eligible`}>
        <header className="deep-head">
          <div>
            <span className="block-eyebrow">{UNIT_LABELS[result.unit]} tag</span>
            <h4>{result.tag} · Not eligible on this page</h4>
          </div>
          <Badge tone="na">Not eligible</Badge>
        </header>
        <p className="muted">{result.notEligibleReason}</p>
      </section>
    );
  }
  return <EligibleTagBlock result={result} filter={filter} setFilter={setFilter} />;
}

function EligibleTagBlock({ result, filter, setFilter }) {
  const [openId, setOpenId] = useState(null);
  const counts = result.verdictCounts ?? {};
  const fired = (result.events?.listed ?? []).filter((e) => e.count > 0);
  const notFired = (result.events?.listed ?? []).filter((e) => e.count === 0);

  return (
    <section className={`impl-tag tone-${verdictTone(result.overallVerdict)}`} aria-label={`${result.tag} results`}>
      <header className="deep-head">
        <div>
          <span className="block-eyebrow">{UNIT_LABELS[result.unit]} tag · {result.total} test cases run · {result.verdictCounts?.NOT_ELIGIBLE ?? 0} not eligible</span>
          <h4>{result.tag} · {result.summaryLine}</h4>
        </div>
        <Badge tone={verdictTone(result.overallVerdict)}>Tag {verdictLabel(result.overallVerdict)}</Badge>
      </header>

      <VerdictTiles counts={counts} total={result.total} verdicts={IMPLEMENTATION_VERDICTS} />

      <div className="filter-chips" role="radiogroup" aria-label={`Filter ${result.tag} test cases by result`}>
        {FILTERS.map((option) => {
          const count = option.value === 'ALL' ? result.cases.length : counts[option.value] ?? 0;
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

      {STEPS.map((step) => {
        const items = result.cases.filter((item) => item.step === step && (filter === 'ALL' || item.verdict === filter));
        if (items.length === 0) return null;
        return (
          <div key={step} className="impl-step">
            <h5>Step: {step} <span className="muted small">· {STEP_HINTS[step]}</span></h5>
            <div className="table-wrap">
              <table className="table impl-table">
                <thead>
                  <tr><th>ID and test case</th><th>Result</th><th>Evidence</th></tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <CaseRow key={item.id} item={item} open={openId === item.id} onToggle={() => setOpenId(openId === item.id ? null : item.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <details className="impl-events">
        <summary>
          Logger events for {result.tag}: {result.eventCount ?? 0} read · {fired.length} of {fired.length + notFired.length} listed events fired
          {result.unit === 'video' ? ' (video records its events; a missing event does not change the result)' : ''}
        </summary>
        <div className="impl-event-list">
          {(result.events?.listed ?? []).map((e) => (
            <span key={e.name} className={`impl-event${e.count ? ' fired' : ''}`} title={e.meaning}>
              {e.name}{e.count ? ` ×${e.count}` : ''}
            </span>
          ))}
          {(result.events?.extra ?? []).map((e) => (
            <span key={`extra-${e.name}`} className="impl-event extra" title="Not in the event list; extra events never cause a FAIL">
              {e.name} ×{e.count}
            </span>
          ))}
        </div>
      </details>
    </section>
  );
}

// One URL of an implementation validator run: TC-01 to TC-13 for every tag entered.
export default function ImplementationResults({ result, index }) {
  const impl = result.implementation;
  return (
    <article className={`result result-${result.status}`}>
      <header className="result-header">
        <Badge tone={result.status}>Implementation: {result.status.toUpperCase()}</Badge>
        {(impl?.tags ?? []).map((t) => <Badge key={t.tag} tone={verdictTone(t.overallVerdict)}>{t.tag} ({UNIT_LABELS[t.unit]}): {t.eligible === false ? 'Not eligible on this page' : verdictLabel(t.overallVerdict)}</Badge>)}
        {result.offDomain && <Badge tone="warn">Staging / preview: {hostOf(result.url)}</Badge>}
        <span className="muted">#{index + 1}</span>
        <a className="result-url" href={result.url} target="_blank" rel="noreferrer">{result.url}</a>
      </header>

      {result.reasons.length > 0 && (
        <div className="reasons">
          {result.reasons.map((reason) => <Badge key={reason} tone={reason.endsWith('not on this page') ? 'neutral' : reason === 'has_warnings' ? 'warn' : result.status === 'error' ? 'error' : 'fail'}>{reasonLabel(reason)}</Badge>)}
        </div>
      )}

      <section className="deep-block" aria-label="Implementation validator results">
        <dl className="facts">
          {impl?.page && (
            <>
              <dt>Page</dt>
              <dd>{impl.page.status ? `HTTP ${impl.page.status}` : 'no response'}{impl.page.title ? ` · ${impl.page.title}` : ''}</dd>
              <dt>Loaded after</dt>
              <dd>{seconds(impl.page.loadedAtMs)} · then watched {seconds(impl.watchMs)} for a slot refresh</dd>
              <dt>Network</dt>
              <dd>{impl.network?.scripts?.length ?? 0} vdo.ai.js request(s) · {impl.network?.errorReports?.length ?? 0} logger.php error report(s) · {impl.network?.eventCount ?? 0} logger event(s)</dd>
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
        {impl?.notes?.length > 0 && <ul className="muted small">{impl.notes.map((note) => <li key={note}>{note}</li>)}</ul>}

        {(impl?.tags ?? []).map((tagResult) => <TagBlock key={tagResult.tag} result={tagResult} />)}
        {!impl && <p className="muted">The test cases could not run on this page.</p>}

        {result.screenshots?.length > 0 && (
          <details className="deep-shots">
            <summary>Screenshots ({result.screenshots.length})</summary>
            <ScreenshotGallery screenshots={result.screenshots} labels={result.screenshotLabels} />
          </details>
        )}
      </section>
    </article>
  );
}
