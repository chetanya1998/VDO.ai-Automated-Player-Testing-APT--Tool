import { useCallback, useEffect, useState } from 'react';
import NewCheckForm from '../components/checks/NewCheckForm.jsx';
import CurrentCheck from '../components/checks/CurrentCheck.jsx';
import HistorySection from '../components/history/HistorySection.jsx';
import { Alert, StatusPill } from '../components/ui';
import { getReadiness } from '../api/settings.js';

export default function HomePage() {
  const [currentJob, setCurrentJob] = useState(null);
  const [running, setRunning] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [prefill, setPrefill] = useState(null);
  const [apiUp, setApiUp] = useState(null);
  const [readiness, setReadiness] = useState(null);

  useEffect(() => {
    let stopped = false;
    let timer;
    const refresh = async () => {
      try {
        const state = await getReadiness();
        if (!stopped) { setReadiness(state); setApiUp(true); }
      } catch { if (!stopped) { setReadiness(null); setApiUp(false); } }
      if (!stopped) timer = setTimeout(refresh, 10000);
    };
    refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  const handleRerun = useCallback((settings) => {
    setPrefill(settings);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleStarted = useCallback((job) => {
    setCurrentJob(job);
    setRunning(true);
  }, []);

  const handleFinished = useCallback(() => {
    setRunning(false);
    setHistoryKey((k) => k + 1);
  }, []);

  const systemPill = running
    ? { tone: 'busy', label: 'Check running' }
    : apiUp === false
      ? { tone: 'down', label: 'API unreachable' }
      : readiness?.ready
        ? { tone: 'ok', label: 'Chromium connected' }
        : { tone: 'down', label: apiUp ? 'Setup required' : 'Connecting…' };

  const systemItems = [
    { label: 'API', ok: apiUp === true, detail: apiUp === false ? 'Unreachable' : apiUp ? 'Connected' : 'Connecting…' },
    { label: 'Database', ok: Boolean(readiness?.database), detail: readiness ? (readiness.database ? 'PostgreSQL ready' : 'Unavailable') : '—' },
    { label: 'Chromium', ok: Boolean(readiness?.browser?.launchable), detail: readiness?.browser?.launchable ? `Version ${readiness.browser.version ?? 'ready'}` : readiness ? 'Not launchable' : '—' },
    { label: 'Deep test engine', ok: Boolean(readiness?.deep?.available), detail: readiness?.deep ? (readiness.deep.available ? '23 cases ready' : 'Not built') : '—', optional: true },
    { label: 'Queue', ok: Boolean(readiness && !readiness.queue?.stopping), detail: readiness?.queue ? `${readiness.queue.active} running · ${readiness.queue.queued} queued` : '—' },
  ];

  return (
    <div className="app">
      <header className="page-header">
        <div>
          <span className="block-eyebrow">vdo.ai · Automated player testing</span>
          <h1>Placement automation</h1>
          <p>Check custom placement code on real publisher pages, then optionally validate all 23 player test cases.</p>
        </div>
        <StatusPill tone={systemPill.tone}>{systemPill.label}</StatusPill>
      </header>

      <section className="system-strip" aria-label="System status">
        {systemItems.map((item) => (
          <div key={item.label} className={`system-item ${item.ok ? 'ok' : item.optional ? 'warn' : 'down'}`}>
            <span className="system-dot" aria-hidden="true" />
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
          </div>
        ))}
      </section>

      <main className="sections">
        {readiness && !readiness.ready && <Alert tone="error">
          {!readiness.database ? 'Local PostgreSQL is unavailable. Check the backend connection.'
            : !readiness.browser.launchable ? readiness.browser.message
              : 'The test queue is stopping. Restart the backend before running checks.'}
        </Alert>}
        <NewCheckForm
          key={prefill?.key ?? 'new'}
          prefill={prefill}
          onReset={() => setPrefill(null)}
          disabled={running || !readiness?.ready}
          unavailable={!readiness?.ready}
          deepEngine={readiness?.deep ?? null}
          onStarted={handleStarted}
        />
        {currentJob && <CurrentCheck key={currentJob.id} job={currentJob} onFinished={handleFinished} />}
        <HistorySection refreshKey={historyKey} onRerun={handleRerun} />
      </main>
    </div>
  );
}
