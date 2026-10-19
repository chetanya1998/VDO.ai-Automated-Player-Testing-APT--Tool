import { checkGroups, checksFrom, elapsedLabel, formatJson, slowLoggerCalls, timelineRows, verdictCounts } from "./model.js";
import { Timeline } from "./Timeline.js";
import type { CheckResult, Finding, ReportEnvelope, RunSummary, Verdict } from "./types.js";

function Badge({ value }: { value: string }) {
  return <span className={`badge badge-${value.toLowerCase()}`}>{value.replaceAll("_", " ")}</span>;
}

function EvidenceLinks({ ids }: { ids: readonly string[] }) {
  return ids.length === 0 ? <span className="muted">No evidence linked</span> : (
    <span className="evidence-links">{ids.map((id) => <a key={id} href={`#evidence-${id}`}>{id}</a>)}</span>
  );
}

function CheckCard({ check }: { check: CheckResult }) {
  return (
    <article className="check-card">
      <div className="check-title"><strong>{check.testCaseId}</strong><Badge value={check.verdict} /></div>
      <p className="category">{check.category.replaceAll("_", " ")}</p>
      <dl className="scope-grid">
        <div><dt>Device</dt><dd>{check.scope.deviceId}</dd></div>
        <div><dt>Article</dt><dd>{check.scope.articleEpochId ?? "Run-wide"}</dd></div>
        <div><dt>Tag</dt><dd>{check.scope.tagName ?? "All tags"}</dd></div>
      </dl>
      <div className="expected-grid">
        <div><h4>Expected</h4><pre>{formatJson(check.expected)}</pre></div>
        <div><h4>Observed</h4><pre>{formatJson(check.observed)}</pre></div>
      </div>
      <EvidenceLinks ids={check.evidenceIds} />
    </article>
  );
}

function CheckSection({ title, subtitle, checks }: { title: string; subtitle: string; checks: readonly CheckResult[] }) {
  if (checks.length === 0) return null;
  return (
    <section className="result-section">
      <div className="section-title"><h3>{title}</h3><span>{checks.length}</span></div>
      <p>{subtitle}</p>
      <div className="check-list">{checks.map((check, index) => <CheckCard key={`${check.testCaseId}-${check.scope.deviceId}-${check.scope.articleEpochId}-${check.scope.tagName}-${index}`} check={check} />)}</div>
    </section>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <article className="cause-card">
      <div className="check-title"><strong>{finding.findingId}</strong><Badge value={finding.verdict} /></div>
      <p>{finding.category.replaceAll("_", " ")}</p>
      <pre>{formatJson(finding.payload)}</pre>
      <EvidenceLinks ids={finding.evidenceIds} />
    </article>
  );
}

export function RunDetail({
  run,
  envelope,
  pollingPaused,
  onRefresh,
  onArtifact,
}: {
  run: RunSummary;
  envelope: ReportEnvelope | null;
  pollingPaused: boolean;
  onRefresh(): void;
  onArtifact(artifactId: string): Promise<void>;
}) {
  const checks = checksFrom(envelope, run.partialReport ?? null);
  const counts = verdictCounts(checks);
  const groups = checkGroups(checks);
  const slowLoggers = slowLoggerCalls(envelope?.evidence ?? []);
  const scripts = timelineRows(envelope?.evidence ?? [])
    .filter((item) => item.durationMs !== null && /script|vdo\.ai\.js/i.test(`${item.label} ${JSON.stringify(item.metadata)}`))
    .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0));
  const causes = envelope?.findings.filter((finding) => finding.kind === "diagnosis") ?? [];
  const pending = envelope === null || envelope.report === null;
  const coveredCases = new Set(checks.map((check) => check.testCaseId)).size;

  return (
    <main className="detail-stack" id="run-detail" tabIndex={-1}>
      <section className="panel run-hero">
        <div>
          <div className="run-title"><Badge value={run.executionState} /><span>{elapsedLabel(run.createdAt, run.endedAt)}</span></div>
          <h1>{run.targetUrl}</h1>
          <p className="mono">{run.runId}</p>
        </div>
        <button className="secondary" type="button" onClick={onRefresh}>Refresh</button>
      </section>

      {pending && (
        <section className={`state-message state-${run.executionState}`} aria-live="polite">
          <strong>{run.partialReport === null || run.partialReport === undefined ? "Report pending" : "Partial report available"}</strong>
          <span>{run.executionState === "timed_out" ? "The run exceeded its queue-inclusive deadline." : run.executionState === "errored" ? "The run ended with an execution error." : "The worker is collecting or processing evidence."}</span>
          {pollingPaused && <span>Automatic polling stopped after 60 attempts. Refresh when ready.</span>}
        </section>
      )}

      <section className="metric-grid" aria-label="Run health summary">
        {(["PASS", "FAIL", "WARNING", "UNKNOWN", "NOT_APPLICABLE"] as Verdict[]).map((verdict) => (
          <article className="metric-card" key={verdict}><Badge value={verdict} /><strong>{counts[verdict]}</strong><span>checks</span></article>
        ))}
        <article className="metric-card"><span className="metric-label">Coverage</span><strong>{coveredCases}/23</strong><span>distinct cases reported</span></article>
      </section>

      <div className="detail-grid">
        <section className="panel results-panel">
          <div className="panel-heading"><div><p className="eyebrow">Deterministic findings</p><h2>Health and causes</h2></div></div>
          <CheckSection title="Issues" subtitle="Evidence-backed failures that need action." checks={groups.failed} />
          <CheckSection title="Investigate demand" subtitle="Demand outcomes remain separate from implementation failures." checks={groups.demand} />
          <CheckSection title="Warnings" subtitle="Observed risks that do not establish a failure." checks={groups.warnings} />
          <CheckSection title="Unknown" subtitle="Evidence or confirmed rules are missing; these are not failures." checks={groups.unknown} />
          {checks.length === 0 && <p className="empty">No check results have been persisted yet.</p>}
        </section>

        <aside className="side-stack">
          <section className="panel compact-panel">
            <p className="eyebrow">Performance</p>
            <h2>Observed timings</h2>
            <h3>Script time</h3>
            {scripts[0] === undefined ? <p className="muted">No measured script request.</p> : <p><strong>{scripts[0].durationMs} ms</strong> · {scripts[0].label}</p>}
            <h3>Slowest logger calls</h3>
            {slowLoggers.length === 0 ? <p className="muted">No measured logger calls.</p> : (
              <ol className="ranked-list">{slowLoggers.map((item) => <li key={item.evidenceId}><strong>{item.durationMs} ms</strong><span>{item.label}</span></li>)}</ol>
            )}
          </section>
          <section className="panel compact-panel">
            <p className="eyebrow">RCA</p>
            <h2>Probable causes</h2>
            {causes.length === 0 ? <p className="muted">No persisted diagnosis is available.</p> : causes.map((finding) => <FindingCard key={finding.findingId} finding={finding} />)}
          </section>
          <section className="panel compact-panel">
            <p className="eyebrow">Artifacts</p>
            <h2>Evidence files</h2>
            {envelope?.artifacts.length ? envelope.artifacts.map((artifact) => (
              <button className="artifact-button" type="button" key={artifact.artifactId} onClick={() => void onArtifact(artifact.artifactId)}>
                <span>{artifact.kind.replaceAll("_", " ")}</span><small>{artifact.byteSize.toLocaleString()} bytes</small>
              </button>
            )) : <p className="muted">No artifacts retained.</p>}
          </section>
        </aside>
      </div>

      <section className="panel coverage-panel" aria-labelledby="coverage-title">
        <div className="panel-heading"><div><p className="eyebrow">TC-1 through TC-23</p><h2 id="coverage-title">Coverage by device, article and tag</h2></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Case</th><th>Verdict</th><th>Device</th><th>Article</th><th>Tag</th><th>Evidence</th></tr></thead>
            <tbody>{checks.map((check, index) => (
              <tr key={`${check.testCaseId}-${check.scope.deviceId}-${check.scope.articleEpochId}-${check.scope.tagName}-${index}`}>
                <th scope="row">{check.testCaseId}</th><td><Badge value={check.verdict} /></td><td>{check.scope.deviceId}</td>
                <td>{check.scope.articleEpochId ?? "Run-wide"}</td><td>{check.scope.tagName ?? "All"}</td><td><EvidenceLinks ids={check.evidenceIds} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <Timeline evidence={envelope?.evidence ?? []} />
    </main>
  );
}
