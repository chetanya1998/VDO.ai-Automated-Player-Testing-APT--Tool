import { useCallback, useEffect, useState } from 'react';
import NewCheckForm from '../components/checks/NewCheckForm.jsx';
import CurrentCheck from '../components/checks/CurrentCheck.jsx';
import HistorySection from '../components/history/HistorySection.jsx';
import { StatusPill } from '../components/ui';
import { getHealth } from '../api/settings.js';

export default function HomePage() {
  const [currentJob, setCurrentJob] = useState(null);
  const [running, setRunning] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [prefill, setPrefill] = useState(null);
  const [apiUp, setApiUp] = useState(null);

  useEffect(() => {
    getHealth()
      .then(() => setApiUp(true))
      .catch(() => setApiUp(false));
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
      : { tone: 'ok', label: apiUp ? 'All systems go' : 'Connecting…' };

  return (
    <div className="app">
      <header className="page-header">
        <div>
          <h1>Placement automation</h1>
          <p>Configure and run placement checks across your site.</p>
        </div>
        <StatusPill tone={systemPill.tone}>{systemPill.label}</StatusPill>
      </header>

      <main className="sections">
        <NewCheckForm
          key={prefill?.key ?? 'new'}
          prefill={prefill}
          onReset={() => setPrefill(null)}
          disabled={running}
          onStarted={handleStarted}
        />
        {currentJob && <CurrentCheck key={currentJob.id} job={currentJob} onFinished={handleFinished} />}
        <HistorySection refreshKey={historyKey} onRerun={handleRerun} />
      </main>
    </div>
  );
}
