import { VERDICTS, verdictLabel, verdictTone } from '../../utils/verdicts.js';

// A stacked bar plus counts for PASS / FAIL / WARNING / UNKNOWN / N/A.
export default function VerdictCounts({ counts, total, compact = false }) {
  const sum = total ?? VERDICTS.reduce((n, verdict) => n + (counts?.[verdict] ?? 0), 0);

  return (
    <div className={`verdict-counts${compact ? ' compact' : ''}`}>
      <div className="verdict-bar" role="img" aria-label={VERDICTS.map((v) => `${counts?.[v] ?? 0} ${verdictLabel(v)}`).join(', ')}>
        {VERDICTS.map((verdict) => {
          const value = counts?.[verdict] ?? 0;
          return value > 0 ? (
            <span key={verdict} className={`verdict-seg tone-${verdictTone(verdict)}`} style={{ flexGrow: value }} />
          ) : null;
        })}
        {sum === 0 && <span className="verdict-seg tone-na" style={{ flexGrow: 1 }} />}
      </div>
      <div className="verdict-legend">
        {VERDICTS.map((verdict) => (
          <span key={verdict} className={`verdict-legend-item tone-${verdictTone(verdict)}${(counts?.[verdict] ?? 0) === 0 ? ' zero' : ''}`}>
            <b>{counts?.[verdict] ?? 0}</b> {verdictLabel(verdict)}
          </span>
        ))}
      </div>
    </div>
  );
}
