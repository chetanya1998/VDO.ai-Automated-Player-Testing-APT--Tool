import { Badge } from '../ui';
import ResultCard from './ResultCard.jsx';
import VerdictCounts from './VerdictCounts.jsx';
import VerdictTiles from './VerdictTiles.jsx';
import { checkTypeLabel } from '../../utils/checkTypes.js';
import { formatDateTime, formatDuration, formatScroll, runStatus } from '../../utils/format.js';

export default function RunResults({ run }) {
  const status = runStatus(run);
  const total = run.passCount + run.failCount + run.errorCount;

  return (
    <section className="run">
      <header className="run-header">
        <Badge tone={status}>{status.toUpperCase()}</Badge>
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

      <div className="run-stats">
        <div className="stat-block">
          <span className="block-eyebrow">Placement</span>
          <div className="stat-tiles">
            <div className="stat-tile"><b>{total}</b><span>URLs</span></div>
            <div className="stat-tile tone-pass"><b>{run.passCount}</b><span>Pass</span></div>
            <div className="stat-tile tone-fail"><b>{run.failCount}</b><span>Fail</span></div>
            <div className="stat-tile tone-error"><b>{run.errorCount}</b><span>Error</span></div>
          </div>
        </div>
        {run.deep && run.deepSummary && (
          <div className="stat-block">
            <span className="block-eyebrow">
              Deep test · {run.deepSummary.urls} URL{run.deepSummary.urls === 1 ? '' : 's'} × 23 cases
            </span>
            <VerdictTiles counts={run.deepSummary.verdictCounts} total={run.deepSummary.cases} />
            <VerdictCounts counts={run.deepSummary.verdictCounts} compact />
          </div>
        )}
      </div>

      <div className="results">
        {run.results.map((result, i) => (
          <ResultCard key={result.id ?? `${result.url}-${i}`} result={result} index={i} type={run.type} />
        ))}
      </div>
    </section>
  );
}
