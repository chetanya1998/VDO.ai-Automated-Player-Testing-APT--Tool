import { useRef, useState, type FormEvent } from "react";

export interface BatchSubmission {
  profile: unknown;
  targetUrls: string[];
  deviceIds: string[];
  idempotencyKey: string;
}

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter((item) => item !== "");
}

export function BatchForm({ busy, onSubmit }: { busy: boolean; onSubmit(input: BatchSubmission): Promise<void> }) {
  const [targetList, setTargetList] = useState("");
  const [deviceList, setDeviceList] = useState("desktop-chromium\nmobile-chromium-emulated");
  const [profileJson, setProfileJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const profile: unknown = JSON.parse(profileJson);
      const targetUrls = lines(targetList);
      const deviceIds = lines(deviceList);
      if (targetUrls.length === 0 || deviceIds.length === 0) throw new Error("Enter at least one URL and device ID");
      const fingerprint = JSON.stringify([profile, targetUrls, deviceIds]);
      if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, key: crypto.randomUUID() };
      await onSubmit({ profile, targetUrls, deviceIds, idempotencyKey: retry.current.key });
      retry.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Batch submission failed");
    }
  }

  return (
    <form className="panel form-panel" onSubmit={(event) => void submit(event)}>
      <div className="panel-heading"><div><p className="eyebrow">URL batch</p><h2>Validate a bounded list</h2></div><span className="local-chip">Max 50 runs</span></div>
      <label>Target URLs, one per line<textarea required rows={5} value={targetList} onChange={(event) => setTargetList(event.target.value)} placeholder="http://127.0.0.1:3000/article-one" /></label>
      <label>Device IDs, one per line<textarea required rows={2} value={deviceList} onChange={(event) => setDeviceList(event.target.value)} /></label>
      <label>Profile JSON<textarea required rows={7} value={profileJson} onChange={(event) => setProfileJson(event.target.value)} placeholder='{"schemaVersion":1,"profileStatus":"fixture_only",...}' /></label>
      <p className="muted form-note">Every admitted URL/device pair becomes a separate run with its own deadline. Retrying after a response creates new activity only when you submit again.</p>
      {error !== null && <p className="form-error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit batch"}</button>
    </form>
  );
}
