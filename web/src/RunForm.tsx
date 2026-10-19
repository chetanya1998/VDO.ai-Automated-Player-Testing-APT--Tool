import { useRef, useState, type FormEvent } from "react";

export interface RunSubmission {
  profile: unknown;
  targetUrl: string;
  deviceId: string;
  idempotencyKey: string;
}

export function RunForm({ busy, onSubmit }: { busy: boolean; onSubmit(input: RunSubmission): Promise<void> }) {
  const [targetUrl, setTargetUrl] = useState("");
  const [deviceId, setDeviceId] = useState("desktop-chromium");
  const [profileJson, setProfileJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const profile: unknown = JSON.parse(profileJson);
      const fingerprint = JSON.stringify([profile, targetUrl, deviceId]);
      if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, key: crypto.randomUUID() };
      await onSubmit({ profile, targetUrl, deviceId, idempotencyKey: retry.current.key });
      retry.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Run submission failed");
    }
  }

  return (
    <form className="panel form-panel" onSubmit={(event) => void submit(event)}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">New validation</p>
          <h2>Submit a controlled fixture</h2>
        </div>
        <span className="local-chip">Local only</span>
      </div>
      <label>
        Target URL
        <input type="url" required value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} placeholder="http://127.0.0.1:3000/article" />
      </label>
      <label>
        Device ID
        <input required value={deviceId} onChange={(event) => setDeviceId(event.target.value)} />
      </label>
      <label>
        Profile JSON
        <textarea required rows={9} value={profileJson} onChange={(event) => setProfileJson(event.target.value)} placeholder='{"schemaVersion":1,"profileStatus":"fixture_only",...}' />
      </label>
      {error !== null && <p className="form-error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit run"}</button>
    </form>
  );
}
