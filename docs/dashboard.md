# Local validation dashboard

Task 17 adds a responsive dashboard to the authenticated local API. Start the API as described in [api.md](api.md), then open `http://127.0.0.1:8787/` and enter one of the configured bearer tokens. The token remains in the current tab's React state and is not written to browser storage.

The dashboard can submit an approved fixture URL, device and complete profile JSON. It shows the team's recent runs, queue and execution states, partial or final results, distinct PASS, FAIL, WARNING, UNKNOWN and NOT APPLICABLE counts, probable causes, artifacts and TC-1 through TC-23 coverage by device, article and tag.

The event timeline orders persisted evidence by capture timestamp and can filter it by source. This order is for inspection only and does not claim cross-source causality. Each row keeps its recorded source, local or backend-correlation confidence, elapsed time, duration, tag, article, blocked/error code and full bounded metadata.

Completed runs expose JSON and HTML export controls. Downloads send the current bearer token in the request header. The HTML file is self-contained for offline review, while artifact bytes remain behind their authenticated endpoint. See [Technical report exports](report-export.md).

The URL batch form accepts one profile plus newline-separated target URLs and devices. The latest submitted batch polls with the same bounded cadence as a run and shows every accepted or rejected item, its current state, device completeness and a control to inspect each admitted run. See [Bounded URL batches](batches.md).

Active runs poll every two seconds for at most 60 attempts. After that, the page stops automatically and exposes a manual refresh control. Artifact downloads are fetched with the current bearer token rather than placing credentials in a URL.

The local API continues to accept fixture-only profiles and loopback targets until deployment controls are implemented. A dashboard result therefore does not establish live publisher conformance without the approved production inputs described in the repository README.
