import { Badge } from '../ui';
import ResultCard from './ResultCard.jsx';
import { VERDICTS, VERDICT_HELP, verdictLabel, verdictTone } from '../../utils/verdicts.js';
import { checkTypeLabel } from '../../utils/checkTypes.js';
import { formatDateTime, formatDuration, formatScroll, runStatus } from '../../utils/format.js';

export default function RunResults({ run }) {
  const status = runStatus(run);
  const total = run.passCount + run.failCount + run.errorCount;
  const deepRows = run.results.filter((result) => result.deep).map((result) => ({ url: result.url, overallVerdict: result.deep.overallVerdict, verdictCounts: result.deep.verdictCounts }));

  return (
    <section className="run">
      <header className="run-header">
        <Badge tone={status}>Placement: {status.toUpperCase()}</Badge>
        <Badge tone="neutral">{checkTypeLabel(run.type)}</Badge>
        {run.deep && <Badge tone="accent">Deep test</Badge>}
        <strong>{run.tag}</strong>
        <span className="muted">
          {run.domain} · {run.device}
        </span>
        <span className="muted">
          {formatDateTime(run.startedAt)} · {formatDuration(new Date(run.finishedAt) - new Date(run.startedAt))}
        </span>
        {run.scroll && <span className="muted">{formatScroll(run.scroll)}</span>}
      </header>

      {/* Placement counts URLs; the deep test counts 23 test cases per URL. Kept apart so they are never added together. */}
      <section className="summary-section">
        <header className="summary-section-head">
          <h4>Custom placement check</h4>
          <p>Counts URLs. A URL passes when your placement code puts a visible player on the page.</p>
        </header>
        <div className="stat-tiles">
          <div className="stat-tile"><b>{total}</b><span>URLs checked</span></div>
          <div className="stat-tile tone-pass"><b>{run.passCount}</b><span>URLs passed</span></div>
          <div className="stat-tile tone-fail"><b>{run.failCount}</b><span>URLs failed</span></div>
          <div className="stat-tile tone-error"><b>{run.errorCount}</b><span>URLs with errors</span></div>
        </div>
      </section>

      {run.deep && (
        <section className="summary-section summary-section-deep">
          <header className="summary-section-head">
            <h4>Deep test · 23 test cases per URL</h4>
            <p>Counted separately for each URL. Click a URL&apos;s test cases below for plain-language explanations.</p>
          </header>
          {deepRows.length > 0 ? (
            <div className="table-wrap">
              <table className="table deep-url-table">
                <thead>
                  <tr>
                    <th>URL</th>
                    <th>Overall</th>
                    {VERDICTS.map((verdict) => (
                      <th key={verdict} className={`num tone-${verdictTone(verdict)}`} title={VERDICT_HELP[verdict]}>
                        {verdictLabel(verdict)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deepRows.map((row, i) => (
                    <tr key={`${row.url}-${i}`}>
                      <td className="deep-url-cell" title={row.url}>#{i + 1} {row.url}</td>
                      <td><Badge tone={verdictTone(row.overallVerdict)}>{verdictLabel(row.overallVerdict)}</Badge></td>
                      {VERDICTS.map((verdict) => (
                        <td key={verdict} className={`num tone-${verdictTone(verdict)}${(row.verdictCounts?.[verdict] ?? 0) === 0 ? ' zero' : ''}`}>
                          <b>{row.verdictCounts?.[verdict] ?? 0}</b>
                          <small> / 23</small>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Deep test results will appear here as each URL finishes.</p>
          )}
        </section>
      )}

      <div className="results">
        {run.results.map((result, i) => (
          <ResultCard key={result.id ?? `${result.url}-${i}`} result={result} index={i} type={run.type} />
        ))}
      </div>
    </section>
  );
}
