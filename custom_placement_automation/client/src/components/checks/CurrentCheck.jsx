import { useEffect, useState } from 'react';
import { Alert, Badge, Card } from '../ui';
import RunResults from './RunResults.jsx';
import { getPlacementCheck } from '../../api/placementChecks.js';
import { formatScroll } from '../../utils/format.js';
import { checkTypeLabel } from '../../utils/checkTypes.js';

const POLL_INTERVAL_MS = 2000;
const isFinished = (job) => job.status === 'completed' || job.status === 'failed';

export default function CurrentCheck({ job: initialJob, onFinished }) {
  const [job, setJob] = useState(initialJob);
  const [pollError, setPollError] = useState('');
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    if (isFinished(job)) return undefined;

    const timer = setTimeout(async () => {
      try {
        const next = await getPlacementCheck(job.id);
        setJob(next);
        setPollError('');
        if (isFinished(next)) onFinished(next);
      } catch (err) {
        setPollError(err.message);
        setRetryAttempt(attempt => attempt + 1);
        if (err.status === 404) {
          const expired = { ...job, status: 'failed', error: err.message };
          setJob(expired);
          onFinished(expired);
        }
      }
    }, POLL_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [job, onFinished, retryAttempt]);

  const { done, total } = job.progress;
  const percent = total ? Math.round((done / total) * 100) : 0;
  // Deep jobs run the placement check and the 23-case deep test once per URL and device.
  const progressLabel = job.deep ? `Checking… ${done}/${total} steps (placement + deep test per URL)` : `Checking… ${done}/${total} URLs`;

  return (
    <Card title="Current check">
      <div className="job-meta">
        <Badge tone="neutral">{checkTypeLabel(job.type)}</Badge>
        {job.deep && <Badge tone="accent">Deep test · 23 cases</Badge>}
        <strong>{job.tag}</strong>
        <span className="muted">
          {job.domain} · {job.devices.join(' + ')}
          {job.scroll ? ` · ${formatScroll(job.scroll)}` : ''}
        </span>
      </div>

      {!isFinished(job) && (
        <div className="progress-block">
          <div className="progress-label">
            {job.status === 'queued'
              ? `Queued${job.queuePosition ? ` (position ${job.queuePosition})` : ''}…`
              : progressLabel}
          </div>
          <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-bar" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}

      {pollError && <Alert tone="error">{pollError}</Alert>}
      {job.status === 'failed' && job.error && <Alert tone="error">Check failed: {job.error}</Alert>}

      {job.runs.map((run) => (
        <RunResults key={run.id ?? run.device} run={run} />
      ))}
    </Card>
  );
}
