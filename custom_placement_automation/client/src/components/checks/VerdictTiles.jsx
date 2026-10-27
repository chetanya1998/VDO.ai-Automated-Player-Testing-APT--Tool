import { VERDICTS, VERDICT_HELP, verdictLabel, verdictTone } from '../../utils/verdicts.js';

// One box per result type, so pass / fail / warning / unknown / N/A totals read separately.
export default function VerdictTiles({ counts, total }) {
  const sum = total ?? VERDICTS.reduce((n, verdict) => n + (counts?.[verdict] ?? 0), 0);

  return (
    <div className="verdict-tiles">
      {VERDICTS.map((verdict) => {
        const value = counts?.[verdict] ?? 0;
        return (
          <div key={verdict} className={`verdict-tile tone-${verdictTone(verdict)}${value === 0 ? ' zero' : ''}`} title={VERDICT_HELP[verdict]}>
            <b>{value}</b>
            <span className="verdict-tile-label">{verdictLabel(verdict)}</span>
            <span className="verdict-tile-share">{sum ? `${Math.round((value / sum) * 100)}%` : '—'}</span>
          </div>
        );
      })}
    </div>
  );
}
