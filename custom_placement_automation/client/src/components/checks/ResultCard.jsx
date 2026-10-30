import { Badge } from '../ui';
import ScreenshotGallery from './ScreenshotGallery.jsx';
import DiagnosticsPanel from './DiagnosticsPanel.jsx';
import DeepResults from './DeepResults.jsx';
import ExtraChecks from './ExtraChecks.jsx';
import { verdictLabel, verdictTone } from '../../utils/verdicts.js';
import { formatBox, formatDuration } from '../../utils/format.js';
import { reasonLabel } from '../../utils/reasons.js';
import { CHECK_TYPE } from '../../utils/checkTypes.js';

const hostOf = (value) => { try { return new URL(value).hostname; } catch { return value; } };

function describeEvent({ status, reasons, eventDetail }, type) {
  if (type === CHECK_TYPE.CSS) return 'not checked (CSS check)';
  if (status === 'error' || reasons.includes('no_event_emitted')) return 'not received';
  if (typeof eventDetail === 'boolean') return `received (${eventDetail})`;
  if (eventDetail && typeof eventDetail === 'object' && 'success' in eventDetail) {
    return `received (success: ${String(eventDetail.success)})`;
  }
  return 'received';
}

export default function ResultCard({ result, index, type }) {
  const { status, wrapper, eventDetail } = result;

  return (
    <article className={`result result-${status}`}>
      <header className="result-header">
        <Badge tone={status}>Placement: {status.toUpperCase()}</Badge>
        {result.deep && <Badge tone={`deep-${result.deep.overallVerdict === 'PASS' ? 'pass' : result.deep.overallVerdict === 'FAIL' ? 'fail' : 'mixed'}`}>Deep test: {result.deep.verdictCounts?.PASS ?? 0} of 23 passed</Badge>}
        {(result.extraChecks ?? []).map((check) => (
          <Badge key={check.id} tone={verdictTone(check.verdict)}>{check.id === 'SAFE_FRAME' ? 'Safe frame' : 'Refresh'}: {verdictLabel(check.verdict)}</Badge>
        ))}
        {result.offDomain && <Badge tone="warn">Staging / preview: {hostOf(result.url)}</Badge>}
        <span className="muted">#{index + 1}</span>
        <a className="result-url" href={result.url} target="_blank" rel="noreferrer">
          {result.url}
        </a>
      </header>

      <div className="result-body">
        <div>
          <span className="block-eyebrow">Custom placement check</span>
          {result.reasons.length > 0 && (
            <div className="reasons">
              {result.reasons.map((reason) => (
                <Badge key={reason} tone={status === 'error' ? 'error' : 'fail'}>
                  {reasonLabel(reason)}
                </Badge>
              ))}
            </div>
          )}

          <dl className="facts">
            <dt>vdo:placement</dt>
            <dd>{describeEvent(result, type)}</dd>
            <dt>Anchor</dt>
            <dd>{eventDetail?.anchor ?? '—'}</dd>
            <dt>Wrapper div</dt>
            <dd>{wrapper?.found ? `found ×${wrapper.count}, ${wrapper.visible ? 'visible' : 'hidden'}` : 'not found'}</dd>
            <dt>Wrapper box</dt>
            <dd>{formatBox(wrapper?.box)}</dd>
            <dt>Duration</dt>
            <dd>{formatDuration(result.durationMs)}</dd>
            {result.error && (
              <>
                <dt>Error</dt>
                <dd>{result.error}</dd>
              </>
            )}
          </dl>

          {eventDetail && (
            <details className="event-detail">
              <summary>Event detail</summary>
              <pre>{JSON.stringify(eventDetail, null, 2)}</pre>
            </details>
          )}

          <DiagnosticsPanel diagnostics={result.diagnostics} defaultOpen={status !== 'pass'} />
        </div>

        <ScreenshotGallery screenshots={result.screenshots} labels={result.screenshotLabels} />
      </div>

      <DeepResults deep={result.deep} />
      <ExtraChecks checks={result.extraChecks} />
    </article>
  );
}
