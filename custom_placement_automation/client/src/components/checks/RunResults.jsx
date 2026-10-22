import { Badge } from '../ui';
import ResultCard from './ResultCard.jsx';
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
        <strong>{run.tag}</strong>
        <span className="muted">
          {run.domain} · {run.device}
        </span>
        <span className="muted">
          {formatDateTime(run.startedAt)} · {formatDuration(new Date(run.finishedAt) - new Date(run.startedAt))}
        </span>
        {run.scroll && <span className="muted">{formatScroll(run.scroll)}</span>}
        <span className="run-counts">
          <span className="text-pass">{run.passCount} pass</span> · <span className="text-fail">{run.failCount} fail</span> ·{' '}
          <span className="text-error">{run.errorCount} error</span> of {total}
        </span>
      </header>

      <div className="results">
        {run.results.map((result, i) => (
          <ResultCard key={result.id ?? `${result.url}-${i}`} result={result} index={i} type={run.type} />
        ))}
      </div>
    </section>
  );
}
