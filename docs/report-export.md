# Technical report exports

Task 18 adds deliberate downloads for a run's final persisted report. Open a completed run in the dashboard and choose **Export JSON** for structured processing or **Export HTML** for a self-contained report that opens without the validator service.

Both formats include the run URL and timestamps, device/browser/OS values when recorded, profile and rule versions, every persisted TC result, verdict counts, first failure, probable owner and next checks, the observed logger sequence, blocked/error events, script and logger timings, findings, limitations, evidence metadata, and sanitized screenshot/HAR artifact references. A missing browser or OS value is written as `not_recorded`; the exporter does not infer it.

Exports apply a second redaction pass to URLs and nested data. Credential-like keys and bearer, cookie, password, token, session, JWT and API-key values are replaced with `[REDACTED]`. Publisher-controlled strings are HTML-escaped. The HTML contains its stylesheet inline and has no scripts, remote resources, artifact links or credentials. Artifact references contain only the ID, kind, size and SHA-256 digest; downloading the artifact itself still requires the authenticated artifact endpoint.

The download endpoints use the same bearer authentication and team ownership check as the dashboard. Unknown and cross-team run IDs return `404`; a run without a final report returns `409 report_not_ready`. The response uses `Content-Disposition: attachment`, private no-store caching and a restrictive content security policy. Public share links are not implemented.
