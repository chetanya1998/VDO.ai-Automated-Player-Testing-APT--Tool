import { Badge } from '../ui';
import { verdictLabel, verdictTone } from '../../utils/verdicts.js';

const DETAIL_LABELS = {
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

const show = (value) => (typeof value === 'boolean' ? (value ? 'Yes' : 'No') : Array.isArray(value) ? value.join(', ') || '—' : String(value));

// Checks added on top of the 23 test cases (safe frame, ad slot refresh). Never counted in the 23-case totals.
export default function ExtraChecks({ checks }) {
  if (!checks?.length) return null;
  return (
    <section className="extra-block" aria-label="Additional checks">
      <header className="deep-head">
        <div>
          <span className="block-eyebrow">Additional checks</span>
          <h4>Not part of the 23 test cases</h4>
        </div>
      </header>
      <div className="extra-grid">
        {checks.map((check) => (
          <article key={check.id} className={`extra-check tone-${verdictTone(check.verdict)}`}>
            <div className="case-detail-head">
              <strong>{check.title}</strong>
              <Badge tone={verdictTone(check.verdict)}>{verdictLabel(check.verdict)}</Badge>
            </div>
            <p className="extra-summary">{check.summary}</p>
            {check.checks && (
              <div className="case-plain">
                <h6>What this check looks at</h6>
                <p>{check.checks}</p>
              </div>
            )}
            <div className="case-plain case-plain-result">
              <h6>Result: {verdictLabel(check.verdict)}</h6>
              <p>{check.meaning}</p>
            </div>
            {Object.keys(check.details ?? {}).length > 0 && (
              <dl className="facts">
                {Object.entries(check.details).map(([key, value]) => (
                  <div key={key} className="facts-row">
                    <dt>{DETAIL_LABELS[key] ?? key}</dt>
                    <dd>{show(value)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
