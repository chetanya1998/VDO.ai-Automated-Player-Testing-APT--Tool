import type { BatchDetail } from "./types.js";

export function BatchStatus({ batch, onOpenRun, onRefresh }: { batch: BatchDetail; onOpenRun(runId: string): void; onRefresh(): void }) {
  const coveredCases = batch.completeness.cases.filter((item) => item.expectedRuns > 0 && item.reportedRuns === item.expectedRuns).length;
  return (
    <section className="panel batch-panel" aria-labelledby="batch-title">
      <div className="panel-heading"><div><p className="eyebrow">Latest batch</p><h2 id="batch-title">{batch.status.replaceAll("_", " ")}</h2></div><button className="text-button" type="button" onClick={onRefresh}>Refresh</button></div>
      <p className="mono">{batch.batchId}</p>
      <div className="batch-counts" aria-label="Batch admission and completion">
        <span><strong>{batch.counts.accepted}</strong> accepted</span><span><strong>{batch.counts.rejected}</strong> rejected</span><span><strong>{batch.counts.terminal}</strong> terminal</span><span><strong>{coveredCases}/23</strong> complete cases</span>
      </div>
      <ul className="batch-list">{batch.items.map((item) => (
        <li className={`batch-item batch-item-${item.state}`} key={item.itemIndex}>
          <div><strong>{item.targetUrl}</strong><small>{item.deviceId} · {item.state.replaceAll("_", " ")}</small>{item.error !== null && <small>{item.error.code}: {item.error.message}</small>}</div>
          {item.runId !== null && <button className="text-button" type="button" onClick={() => onOpenRun(item.runId!)}>Inspect run</button>}
        </li>
      ))}</ul>
      <details><summary>Device completeness</summary><ul className="plain-list">{batch.completeness.devices.map((device) => <li key={device.deviceId}>{device.deviceId}: {device.terminalRuns}/{device.acceptedRuns} terminal, {device.reportedCaseIds.length}/23 cases reported</li>)}</ul></details>
      <p className="muted form-note">Batch duration is the combined queue workflow; the five-minute deadline applies separately to each admitted run.</p>
    </section>
  );
}
