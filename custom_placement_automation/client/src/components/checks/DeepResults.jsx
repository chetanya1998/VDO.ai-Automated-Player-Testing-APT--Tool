import { useState } from 'react';
import { Badge } from '../ui';
import VerdictCounts from './VerdictCounts.jsx';
import { CASE_GROUPS, VERDICTS, caseNumber, verdictLabel, verdictTone } from '../../utils/verdicts.js';
import { formatDuration } from '../../utils/format.js';

const FILTERS = [{ value: 'ALL', label: 'All' }, ...VERDICTS.map((verdict) => ({ value: verdict, label: verdictLabel(verdict) }))];

function CaseDetail({ item }) {
  return (
    <div className="case-detail">
      <div className="case-detail-head">
        <span className="case-id">{item.testCaseId}</span>
        <strong>{item.title}</strong>
        <Badge tone={verdictTone(item.verdict)}>{verdictLabel(item.verdict)}</Badge>
      </div>
      <p className="case-why">{item.summary}</p>
      <dl className="facts">
        <dt>Category</dt>
        <dd>{item.category.replaceAll('_', ' ').toLowerCase()}</dd>
        <dt>Evidence records</dt>
        <dd>{item.evidenceCount}</dd>
      </dl>
      <details className="event-detail">
        <summary>Expected vs observed</summary>
        <pre>{JSON.stringify({ expected: item.expected, observed: item.observed }, null, 2)}</pre>
      </details>
    </div>
  );
}

export default function DeepResults({ deep }) {
  const [filter, setFilter] = useState('ALL');
  const [openId, setOpenId] = useState(null);

  if (!deep) return null;
  const byId = new Map((deep.cases ?? []).map((item) => [item.testCaseId, item]));
  const counts = deep.verdictCounts ?? {};
  const open = openId ? byId.get(openId) : null;
  const shown = (item) => filter === 'ALL' || item.verdict === filter;
  const evaluated = deep.cases?.length ?? 0;

  return (
    <section className="deep-block" aria-label="Deep test results">
      <header className="deep-head">
        <div>
          <span className="block-eyebrow">Deep test</span>
          <h4>
            {evaluated ? `${counts.PASS ?? 0} of ${evaluated} cases passed` : 'Cases were not evaluated'}
          </h4>
        </div>
        <Badge tone={verdictTone(deep.overallVerdict)}>Overall {verdictLabel(deep.overallVerdict)}</Badge>
      </header>

      <VerdictCounts counts={counts} />

      <div className="deep-meta muted">
        {deep.policyStatus === 'draft' && <span className="chip chip-warn">Draft policies</span>}
        {deep.captureComplete === false && <span className="chip">Capture incomplete</span>}
        {Number.isInteger(deep.scriptOverrideHits) && (
          <span className="chip">{deep.scriptOverrideHits ? 'Custom vdo.ai.js served' : 'Custom vdo.ai.js not requested'}</span>
        )}
        {Number.isFinite(deep.durationMs) && <span>{formatDuration(deep.durationMs)}</span>}
        {Number.isFinite(deep.evidenceRecords) && <span>{deep.evidenceRecords} evidence records</span>}
      </div>

      {deep.executionErrors?.length > 0 && (
        <div className="alert alert-error">{deep.executionErrors.map((error) => error.message).join(' · ')}</div>
      )}

      {evaluated > 0 && (
        <>
          <div className="filter-chips" role="radiogroup" aria-label="Filter cases by result">
            {FILTERS.map((option) => {
              const count = option.value === 'ALL' ? evaluated : counts[option.value] ?? 0;
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
            {CASE_GROUPS.map((group) => {
              const items = group.ids.map((id) => byId.get(id)).filter(Boolean).filter(shown);
              if (items.length === 0) return null;
              return (
                <div key={group.title} className="case-group">
                  <h5>{group.title}</h5>
                  <div className="case-grid">
                    {items
                      .sort((a, b) => caseNumber(a.testCaseId) - caseNumber(b.testCaseId))
                      .map((item) => (
                        <button
                          key={item.testCaseId}
                          type="button"
                          className={`case-tile tone-${verdictTone(item.verdict)}${openId === item.testCaseId ? ' open' : ''}`}
                          aria-expanded={openId === item.testCaseId}
                          onClick={() => setOpenId(openId === item.testCaseId ? null : item.testCaseId)}
                          title={item.summary}
                        >
                          <span className="case-tile-top">
                            <span className="case-id">{item.testCaseId}</span>
                            <span className={`case-verdict tone-${verdictTone(item.verdict)}`}>{verdictLabel(item.verdict)}</span>
                          </span>
                          <span className="case-title">{item.title}</span>
                        </button>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>

          {open && <CaseDetail item={open} />}
        </>
      )}

      {deep.probableCauses?.length > 0 && (
        <div className="deep-list">
          <h5>Likely causes{deep.probableCauses[0].rules === 'draft' ? ' · draft RCA rules' : ''}</h5>
          <ul>
            {deep.probableCauses.map((cause) => (
              <li key={`${cause.testCaseId}-${cause.code}`}>
                <strong>{cause.testCaseId}</strong> {cause.summary} <span className="muted">· {cause.owner}</span>
                {cause.nextChecks?.length > 0 && <div className="muted small">Next: {cause.nextChecks.join(' ')}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {deep.limitations?.length > 0 && (
        <details className="deep-list deep-notes">
          <summary>What this run could not confirm ({deep.limitations.length})</summary>
          <ul>
            {deep.limitations.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
