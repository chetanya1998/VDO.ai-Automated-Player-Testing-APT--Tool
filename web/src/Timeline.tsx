import { useMemo, useState } from "react";
import { formatJson, timelineRows } from "./model.js";
import type { EvidenceItem } from "./types.js";

export function Timeline({ evidence }: { evidence: readonly EvidenceItem[] }) {
  const [source, setSource] = useState("all");
  const rows = useMemo(() => timelineRows(evidence), [evidence]);
  const sources = [...new Set(rows.map((row) => row.source))].sort();
  const visible = source === "all" ? rows : rows.filter((row) => row.source === source);

  return (
    <section className="panel timeline-panel" aria-labelledby="timeline-title">
      <div className="panel-heading timeline-heading">
        <div>
          <p className="eyebrow">Evidence stream</p>
          <h2 id="timeline-title">Event timeline</h2>
        </div>
        <label className="compact-control">
          Source
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="all">All sources</option>
            {sources.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
          </select>
        </label>
      </div>
      <p className="timeline-note">Events are ordered by capture time. Their order does not prove causality across sources.</p>
      {visible.length === 0 ? <p className="empty">No evidence matches this filter.</p> : (
        <ol className="timeline-list">
          {visible.map((row) => (
            <li id={`evidence-${row.evidenceId}`} key={row.evidenceId} className="timeline-item">
              <div className="timeline-rail" aria-hidden="true"><span /></div>
              <div className="timeline-content">
                <div className="timeline-meta">
                  <span className="elapsed">+{row.elapsedMs} ms</span>
                  <span>{row.source.replaceAll("_", " ")}</span>
                  <span>{row.correlation}</span>
                </div>
                <h3>{row.label}</h3>
                <dl className="inline-facts">
                  <div><dt>Device</dt><dd>{row.deviceId}</dd></div>
                  <div><dt>Article</dt><dd>{row.articleEpochId}</dd></div>
                  {row.tagName !== null && <div><dt>Tag</dt><dd>{row.tagName}</dd></div>}
                  {row.durationMs !== null && <div><dt>Duration</dt><dd>{row.durationMs} ms</dd></div>}
                  {row.code !== null && <div><dt>Code</dt><dd>{row.code}</dd></div>}
                </dl>
                <details>
                  <summary>Observed metadata</summary>
                  <pre>{formatJson(row.metadata)}</pre>
                </details>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
