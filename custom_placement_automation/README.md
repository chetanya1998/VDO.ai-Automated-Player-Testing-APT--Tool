# Placement Automation

A local tool for checking vdo.ai player placement on publisher pages before a site goes live. You give it a domain, a tag, a list of article URLs and either a `vdo.ai.js` build or a `style.css`. It opens each page in Chromium, applies your code, checks whether the player was placed, and keeps a report with screenshots.

The local backend now requires PostgreSQL (`DATABASE_URL` in `server/.env`). See [the 23-case mapping, implementation stages and local setup](LOCAL-VALIDATION-PLAN.md). The 23-case validators are not yet connected to this placement dashboard.

## Features

### Two kinds of checks

| | **Custom placement (`vdo.ai.js`)** | **CSS (`style.css`)** |
|---|---|---|
| What's applied | Your `vdo.ai.js` replaces `a.vdo.ai/core/<tag>/vdo.ai.js` on every page | Your CSS is injected into the page's `<head>`; the site's own `vdo.ai.js` runs unchanged |
| Pass condition | The page fires a `vdo:placement` event reporting success **and** the player wrapper is visible | The player wrapper is visible |
| Time per URL | Stops as soon as the result is clear (max 60 s) | Always runs the full 60 s so you can watch it |

**Reporting the placement result (vdo.ai.js checks):** add this at the end of your custom placement logic:

```js
window.dispatchEvent(new CustomEvent('vdo:placement', {
  detail: { success: placed } // true only if the player was actually inserted
}));
```

### Running checks

- **Devices:** desktop (1366×768), mobile (Pixel 7), or both. Devices run sequentially within a job, with at most `MAX_CONCURRENT_JOBS` placement contexts active.
- **URLs:** up to 50 per check, one per line.
- **Code input:** upload a file or paste the code.
- **Lazy-load scrolling:** while waiting, the page is scrolled in steps so lazy-loaded players and ad slots get triggered. The step size and interval can be set per check (under the scroll fields) or as defaults in `server/.env`.
- **Live progress:** shows "Checking… 3/10 URLs" while it runs. Checks run in the background, so the page stays responsive.

### Results

Each URL is marked **PASS**, **FAIL** or **ERROR**, with reasons:

| Reason | Meaning |
|---|---|
| `script_not_loaded` | The page never requested the tag's `vdo.ai.js`, so your file wasn't used |
| `no_event_emitted` | `vdo:placement` was never fired |
| `placement_failed` | `vdo:placement` reported failure |
| `div_not_found` | No `#vdoai_parentWrapperDiv` / `.vdoai_parentWrapperDiv` on the page |
| `wrapper_hidden` | The wrapper exists but isn't visible |
| `page_blocked` | The site blocked the browser (403/429, captcha or Cloudflare page) |
| `timeout` | The page or the check took too long |
| `page_closed` | The browser page was closed during the check |

Every result also includes:

- **Two screenshots:** the player centred in view, then the page scrolled past the player (to show floating).
- **Diagnostics:**
  - whether `vdo.ai.js` loaded, in the main page or an iframe;
  - `vdo.min.js` / `ima3.js` status;
  - the targeting agent check;
  - analytics events;
  - errors the tag reported;
  - console output;
  - plain-language hints explaining what probably went wrong.

### History

- Every run is saved locally and listed in **History**.
- **Re-run:** fills the form with that run's settings and stored script so you can change something and run it again.
- **PDF:** downloads a report for the run, with all results and screenshots.
- **Delete / Clear all:** removes runs and their screenshots.

## Quick start

```bash
npm run setup || bash setup.sh
```

`npm run setup` needs npm, which comes with Node. If npm isn't installed, the `||` falls back to running `bash setup.sh` directly.

The script checks for Node.js 20+ (installing it through nvm if it's missing or too old) and installs the server and client dependencies. It also installs Chromium and, on Linux, Chromium's system libraries, then creates `server/.env` and starts the app.

Open **http://localhost:5173**. Full instructions, including troubleshooting, are in [SETUP.md](SETUP.md).

Before starting, configure `DATABASE_URL` for your local PostgreSQL instance in `server/.env`. Setup does not install PostgreSQL or create credentials. The API listens only on `127.0.0.1`. `/api/ready` checks the database, queue state and presence of Chromium; actual browser launch still requires a successful run.

| Command (project root) | Does |
|---|---|
| `npm install` | Installs server and client dependencies, plus Chromium |
| `npm start` | Starts the API (port 3000) and the UI (port 5173) together |
| `npm run setup` / `bash setup.sh` | Full setup: checks Node, installs everything, starts the app (`--no-start` to only install) |

## How it works

1. The UI sends the check to the API, which queues it as a job and returns straight away. The UI then polls for progress.
2. For each device, Playwright opens one Chromium page and visits the URLs in turn:
   - **vdo.ai.js checks:** the tag's script request is answered with your file.
   - **CSS checks:** your CSS is injected as the page loads.
3. For each URL, the runner listens for `vdo:placement` in every frame and looks for the wrapper. It scrolls while waiting, takes the screenshots and works out the result. One URL can't take more than 60 seconds.
4. Jobs and results are stored in PostgreSQL's `custom_placement` schema. Screenshots stay under `server/storage/screenshots/`, with SHA-256 digests in the report. An existing `reports.json` is imported once and retained as a source backup.

## Project structure

```
package.json            root scripts: install, start, setup
server/                 Express API + Playwright runner
  server.js
  src/
    config/             settings (DATABASE_URL required in server/.env)
    routes/, controllers/
    services/
      placementRunner   opens pages, applies code, checks placement, screenshots
      tagDiagnostics    records what vdo.ai.js did on each page
      jobQueue          background jobs, max 2 at once
      results           PostgreSQL reports + screenshot files
      database          durable jobs, reports and exclusive worker ownership
      scriptStore       uploaded scripts (used by Re-run)
      pdfReport         PDF reports (separate headless Chromium)
  storage/              reports.json, screenshots/, scripts/  (created automatically, not in git)
client/                 React (Vite) UI
  src/
    components/ui/      buttons, inputs, tables, tooltip …
    components/checks/  check form, progress, results, diagnostics
    components/history/ history table, re-run, delete, PDF
    api/, utils/
implementation/         planning notes
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/ready` | Database, queue and Chromium installation readiness |
| GET | `/api/settings` | Default scroll settings, limits and the per-URL time limit |
| POST | `/api/placement-checks` | Start a check and return a job |
| GET | `/api/placement-checks/:jobId` | Job progress and results |
| GET | `/api/history` | List runs (`?page=&pageSize=`) |
| GET | `/api/history/:runId` | One run with its results |
| GET | `/api/history/:runId/pdf` | Download the run as a PDF |
| DELETE | `/api/history/:runId` | Delete one run and its screenshots |
| DELETE | `/api/history` | Delete all runs, screenshots and stored scripts |

## Limitations

- **No login.** Anyone who can reach the app can run checks and delete reports. By default it's only reachable from the machine it runs on.
- **Restart recovery:** queued jobs resume; interrupted jobs are marked failed for inspection, preserving completed-device results. The current URL is not resumed automatically. Reports remain in PostgreSQL; terminal job polling records expire after an hour.
- **Some sites block automated browsers;** these show up as `page_blocked`.
- **`script_not_loaded` is common on sites where the ad slot doesn't always fill,** because then the page never requests `vdo.ai.js`.
