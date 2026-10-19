import { useCallback, useEffect, useState, type FormEvent } from "react";
import { RunDetail } from "./RunDetail.js";
import { RunForm, type RunSubmission } from "./RunForm.js";
import type { ReportEnvelope, RunSummary } from "./types.js";

async function responseJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body
      ? (body as { error?: { message?: unknown } }).error?.message
      : undefined;
    throw new Error(typeof message === "string" ? message : `Request failed (${response.status})`);
  }
  return body as T;
}

export function App() {
  const [tokenInput, setTokenInput] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<RunSummary | null>(null);
  const [report, setReport] = useState<ReportEnvelope | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollingPaused, setPollingPaused] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const request = useCallback(async <T,>(path: string, authToken: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(path, {
      ...init,
      headers: { authorization: `Bearer ${authToken}`, ...init.headers },
    });
    return responseJson<T>(response);
  }, []);

  const loadRuns = useCallback(async (authToken: string) => {
    const result = await request<{ runs: RunSummary[] }>("/v1/runs", authToken);
    setRuns(result.runs);
  }, [request]);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await loadRuns(tokenInput);
      setToken(tokenInput);
      setTokenInput("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitRun(input: RunSubmission) {
    if (token === null) throw new Error("Connect with an access token first");
    setBusy(true);
    setError(null);
    try {
      const created = await request<{ runId: string }>("/v1/runs", token, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey },
        body: JSON.stringify({ profile: input.profile, targetUrl: input.targetUrl, deviceId: input.deviceId }),
      });
      await loadRuns(token);
      setSelectedId(created.runId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Run submission failed";
      setError(message);
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (token === null || selectedId === null) {
      setSelected(null);
      setReport(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    setPollingPaused(false);

    const poll = async () => {
      try {
        const [run, envelope] = await Promise.all([
          request<RunSummary>(`/v1/runs/${encodeURIComponent(selectedId)}`, token),
          request<ReportEnvelope>(`/v1/runs/${encodeURIComponent(selectedId)}/report`, token),
        ]);
        if (cancelled) return;
        setSelected(run);
        setRuns((current) => current.map((item) => item.runId === run.runId ? run : item));
        setReport(envelope);
        setError(null);
        attempts += 1;
        if (["queued", "running"].includes(run.executionState) && attempts < 60) {
          timer = setTimeout(() => void poll(), 2_000);
        } else if (["queued", "running"].includes(run.executionState)) {
          setPollingPaused(true);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Run could not be loaded");
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [refresh, request, selectedId, token]);

  async function downloadArtifact(artifactId: string) {
    if (token === null) return;
    try {
      const response = await fetch(`/v1/artifacts/${encodeURIComponent(artifactId)}`, { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`Artifact download failed (${response.status})`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = artifactId;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Artifact download failed");
    }
  }

  if (token === null) {
    return (
      <main className="login-shell">
        <section className="login-copy">
          <p className="brand-mark">VDO<span>.AI</span></p>
          <p className="eyebrow">Implementation validator</p>
          <h1>See what the player did, and why.</h1>
          <p>Inspect deterministic checks, probable causes, coverage and browser evidence from one local workspace.</p>
          <ul><li>Team-scoped evidence</li><li>TC-1 through TC-23 coverage</li><li>Chronological browser timeline</li></ul>
        </section>
        <form className="login-card" onSubmit={(event) => void connect(event)}>
          <p className="eyebrow">Local access</p>
          <h2>Connect to the validator</h2>
          <p>The token stays in this tab's memory and is sent only to the local API.</p>
          <label>Bearer token<input type="password" required autoComplete="off" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} autoFocus /></label>
          {error !== null && <p className="form-error" role="alert">{error}</p>}
          <button className="primary" type="submit" disabled={busy}>{busy ? "Connecting…" : "Open dashboard"}</button>
        </form>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand-mark" href="#top">VDO<span>.AI</span></a>
        <div><span className="connection-dot" aria-hidden="true" />Local validator</div>
        <button className="text-button" type="button" onClick={() => { setToken(null); setSelectedId(null); setRuns([]); }}>Disconnect</button>
      </header>
      <div className="workspace" id="top">
        <aside className="left-column">
          <RunForm busy={busy} onSubmit={submitRun} />
          <section className="panel history-panel" aria-labelledby="history-title">
            <div className="panel-heading"><div><p className="eyebrow">Team history</p><h2 id="history-title">Recent runs</h2></div><button className="text-button" type="button" onClick={() => void loadRuns(token)}>Refresh</button></div>
            {runs.length === 0 ? <p className="empty">No runs for this team.</p> : (
              <ul className="run-list">{runs.map((run) => (
                <li key={run.runId}><button className={run.runId === selectedId ? "run-link selected" : "run-link"} type="button" onClick={() => setSelectedId(run.runId)}>
                  <span><strong>{run.targetUrl}</strong><small>{new Date(run.createdAt).toLocaleString()}</small></span><span className={`state-dot state-dot-${run.executionState}`}><span className="sr-only">State: </span>{run.executionState.replaceAll("_", " ")}</span>
                </button></li>
              ))}</ul>
            )}
          </section>
        </aside>
        <section className="content-column">
          {error !== null && <div className="global-error" role="alert">{error}</div>}
          {selected === null ? (
            <section className="panel welcome-panel"><p className="eyebrow">Run workspace</p><h1>Select a run to inspect its evidence.</h1><p>Choose a recent run or submit a controlled fixture. Pending, partial, failed and timed-out states stay visible.</p></section>
          ) : (
            <RunDetail run={selected} envelope={report} pollingPaused={pollingPaused} onRefresh={() => setRefresh((value) => value + 1)} onArtifact={downloadArtifact} />
          )}
        </section>
      </div>
    </div>
  );
}
