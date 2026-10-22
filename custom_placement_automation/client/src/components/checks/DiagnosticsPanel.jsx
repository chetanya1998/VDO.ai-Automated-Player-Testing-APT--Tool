const describeAgent = (check) => {
  if (!check) return 'not called';
  if (check.error) return `HTTP ${check.status}, unreadable response`;
  return `HTTP ${check.status} · agent=${check.agent} · allowed=${check.allowed} · ${check.country ?? '—'}`;
};

export default function DiagnosticsPanel({ diagnostics, defaultOpen }) {
  if (!diagnostics) return null;
  const { hints, scriptRequests, dependencies, agentCheck, analyticsEvents, placeholderDivs, errorReports, console: logs, pageErrors } =
    diagnostics;

  return (
    <details className="diagnostics" open={defaultOpen}>
      <summary>Diagnostics{hints.length ? ` (${hints.length})` : ''}</summary>

      {hints.length > 0 && (
        <ul className="hints">
          {hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
      )}

      <dl className="facts">
        <dt>vdo.ai.js loads</dt>
        <dd>{scriptRequests.length ? scriptRequests.map((r) => r.frame).join(', ') : 'none'}</dd>
        <dt>vdo.min.js</dt>
        <dd>{dependencies.vdoMin}</dd>
        <dt>ima3.js</dt>
        <dd>{dependencies.ima3}</dd>
        <dt>Agent check</dt>
        <dd>{describeAgent(agentCheck)}</dd>
        <dt>Placeholder div</dt>
        <dd>{placeholderDivs ?? '—'}</dd>
        <dt>window.close() calls</dt>
        <dd>{diagnostics.closeAttempts ?? '—'}</dd>
        <dt>Analytics events</dt>
        <dd>{analyticsEvents.length ? analyticsEvents.join(', ') : 'none'}</dd>
      </dl>

      {errorReports.length > 0 && (
        <>
          <h4 className="diagnostics-heading">Errors reported by vdo.ai.js</h4>
          <pre>{errorReports.map((r) => `${r.code ?? ''} ${r.message}`).join('\n\n')}</pre>
        </>
      )}

      {pageErrors.length > 0 && (
        <>
          <h4 className="diagnostics-heading">Uncaught errors</h4>
          <pre>{pageErrors.join('\n\n')}</pre>
        </>
      )}

      {logs.length > 0 && (
        <>
          <h4 className="diagnostics-heading">Console from vdo.ai scripts</h4>
          <pre>{logs.map((l) => `[${l.type}] ${l.text}`).join('\n')}</pre>
        </>
      )}
    </details>
  );
}
