# Placement Automation

A local tool for checking vdo.ai player placement on publisher pages before a site goes live. You give it a domain, a tag, a list of article URLs and either a `vdo.ai.js` build or a `style.css`. It opens each page in Chromium, applies your code, checks whether the player was placed, and keeps a report with screenshots.

The local backend now requires PostgreSQL (`DATABASE_URL` in `server/.env`). See [the 23-case mapping, implementation stages and local setup](LOCAL-VALIDATION-PLAN.md).

An optional **deep test** validates all 23 player test cases on each URL, on top of the placement check. See [Deep test](#deep-test-all-23-cases).

## Features

### Three kinds of checks

The first two check placement code. The third, the **sticky violation checker**, checks how a floating player behaves; see [Sticky violation checker](#sticky-violation-checker-st-01-to-st-25).

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

### Deep test (all 23 cases)

Turn on **Automated player testing — deep** in step 4 of the form. The placement check runs exactly as before; afterwards each URL is opened again in a separate browser, with the same device, tag and your `vdo.ai.js` or `style.css` applied, and validated against TC-1 to TC-23.

- **Engine:** the repository's validator rules (`src/rules`, `src/deep` in the repository root), compiled once with `pnpm install && pnpm build` in the repository root. `npm run setup` does this for you. `/api/ready` reports `deep.available`; the toggle is disabled until the engine is built.
- **Results per URL:** separate Pass / Fail / Warning / Unknown / N/A totals, filter chips and 23 case tiles grouped as *Tag & installation*, *Logger & events*, *Ads & viewability* and *Devices & navigation*. Click a tile to read, in plain words, what the test checks, what its result means and why it got that result on this page; technical detail for engineers is folded underneath. Likely causes and limitations are listed below.
- **Run totals:** pass/fail/warning/unknown counts across every URL × 23 cases, also shown in History (Depth column, *Deep tests* filter) and in the PDF.
- **Screenshots:** the deep test takes its own screenshots with your code applied: at the end of the observation, with the player centred in view, and scrolled past the player (to show floating). They are shown under the deep results and in the PDF. Identical pictures (a page too short to scroll) are kept once; a screenshot that fails is listed under limitations and does not affect the verdicts.
- **TC-2 (load time):** every request for a player file (vdo.ai.js and the files TC-12 checks) is timed. All within 500 ms is a Pass, the slowest between 500 and 1000 ms is a Warning, and over 1000 ms or never finishing is a Fail. The detail names the slow files.
- **Verdicts are honest:** PASS needs captured evidence and a confirmed policy. The repository policies are still drafts, so rules that require a confirmed policy report **UNKNOWN** with the reason, never a guessed PASS. TC-23 needs an approved infinite-scroll/SPA navigation for the site and reports UNKNOWN until one exists. Mobile is an emulated Android phone (Pixel 7); iPhone/Safari is not tested.
- **Network:** deep tests allow public internet traffic but refuse private-network addresses. Set `DEEP_ALLOW_PRIVATE_NETWORK=true` in `server/.env` to test internal staging servers.
- **Time:** about 15 s of observation per URL and device (`DEEP_OBSERVE_MS`), capped at `DEEP_URL_TIMEOUT_MS` (default 90 s).

### Additional checks (safe frame, ad slot refresh)

These are shown in their own **Additional checks** block under each URL and in the PDF. They are never added to the 23-case totals.

- **Safe frame check** (runs with every deep test): looks for Google SafeFrame ad frames (`*.safeframe.googlesyndication.com`) inside the vdo.ai player, about every 5 seconds and at the end of the visit.
  - **Pass:** a SafeFrame in the player had a real size, was visible and was on a different address from the page.
  - **Warning:** it was hidden, had no size, failed to load, or was on the page's own address.
  - **N/A:** no ad in the player used a SafeFrame. Video ads played through Google IMA don't use one. SafeFrames from the publisher's own ads, outside the player, are counted but not judged.
- **Ad slot refresh check** (step 5 of the form, separate from the deep test): choose **30, 45 or 60 s**. After the normal visit the player is kept in view for the interval plus 20 s, and the tool watches for a new ad request (the player's *Ad Request* logger events, or Google Ad Manager requests if the player sends none).
  - **Pass:** a new ad request came 5 s early to 15 s late, measured from the previous one.
  - **Warning:** the slot refreshed, but at a different interval.
  - **Fail:** no new ad request came while the player stayed in view.
  - **Unknown:** the player never asked for an ad.
  - Each URL and device takes about the interval plus 20 s longer. With the deep test off, the refresh check still opens each URL once more in the deep test browser, but only the refresh result is kept.

### Sticky violation checker (ST-01 to ST-25)

Pick **Sticky violation checker** in step 1. It runs the checks from *VDOAI Sticky Violation Test Cases – Status Criteria* on each URL and device:

- **Mandatory, always run:** ST-01 to ST-13.
- **Additional, only when ticked:** ST-14 to ST-25, via **Also run the additional checks** in the form.

Like the placement checks, it can first apply a `vdo.ai.js` or `style.css` (**Code to apply first**). The default is **None**: the live tag as the site serves it. The deep test and refresh check are not offered with it.

**What the tool does on each page** (about 30 s per URL and device for the mandatory checks; about 15 s more with the additional checks):

1. **Initial load:** it watches the page for 5 seconds without scrolling.
2. **Scroll down:** half a screen at a time, until the player's place in the article is well behind.
3. **Ad load:** it waits 10 s without scrolling while the ad loads.
4. **Small scrolls:** up and down a little, three times.
5. **Bottom:** it scrolls to the bottom of the page (at most 15 screens, for infinite scroll).
6. **Window sizes (additional checks only):** it goes back to the article and tries other sizes. Desktop gets 1024×640, 800×600, and 125% and 150% zoom. Mobile gets landscape and a 360×640 phone.
7. **Close:** it clicks the floating player's close button; with the additional checks it then keeps scrolling to see whether the player comes back.

**How it measures:**

- At every step it records where the vdo.ai player is: in-content or floating (`position: fixed`).
- It hit-tests what the player covers: header, headline, footer links, consent banners, other sticky ads, page links and buttons.
- It checks whether the close and Skip Ad buttons are fully on screen, not cut off, and on top. Skip Ad is found inside the ad iframes. The tool never clicks Skip Ad on live ads.
- It also notes page and player spacing, and the site's CSS around the player.

**Results:**

- Only three statuses, as in the status criteria document:
  - **Pass:** the observed result matches the expected result.
  - **Fail:** it does not.
  - **Warning:** it could not be judged on this page (the situation didn't occur, a prerequisite was missing, or the setting is unknown).
  - There is no N/A, Unknown or "Not run".
- **Screenshot evidence for every check**, including passes and warnings. A screenshot is taken at every step, with the player outlined in blue and problems in red. Each check shows the one from the moment that decided it ("Screenshot #3"); click the check to see it next to the explanation. The PDF lists the same numbers.
- **Overall result per URL**, from the share of *judged* checks (Pass + Fail) that passed. Warnings are left out:

  | Judged checks passed | Overall |
  |---|---|
  | 80% or more | **Pass** |
  | 50% to under 80% | **Pass · Review required** |
  | Under 50% | **Fail** |
  | None could be judged | **Could not be judged** |

  Example: 8 pass, 3 fail, 2 warnings = 8 of 11 = 73% → Pass · Review required. The run summary counts how many URLs need review.
- **Page blocked:** a URL the site refuses (bot protection, HTTP 401/403/429/503) shows the HTTP status, the page title and a screenshot of what the site showed. A page that could not be opened at all shows **Page could not be opened** with the error.

**Rules worth knowing:**

- **ST-08:** a floating player covering more than 30% of the screen fails. The Better Ads Standards call that a large sticky ad.
- **ST-06/07/23:** "too early" means floating before the player's place in the article has entered the screen. The tool doesn't know each tag's configured activation point.
- **ST-02 / ST-03:** only the site header and main menu (near the top of the page, or fixed to the top) and the article headline (`h1`) count. Breadcrumbs, pagination, widget headers and related-post titles don't.
- **ST-20:** an in-content player scrolling under the site's own sticky header is normal and is not counted as a z-index problem.
- **ST-22:** an empty gap of 50 px or more left in the article while the player floats fails.
- **ST-24:** zoom is emulated with the smaller CSS window a zoomed browser has.
- **ST-18/25:** these apply only when a next article loads in the page. Each URL otherwise opens fresh, so stale state can't carry over from another page.

**Note:** these are internal preventative QA checks, not official Google violation triggers. A failure needs investigation, and a pass does not guarantee policy compliance.

### History

- Every run is saved locally and listed in **History**.
- **Re-run:** fills the form with that run's settings and stored script so you can change something and run it again.
- **PDF:** downloads a report for the run, with all results and screenshots. Deep runs add separate result totals, a legend of what each result means, and for every test case what it tested and what its result means in plain words.
- **Re-run** keeps the deep test, refresh check and sticky settings (code to apply, additional checks).
- **Delete / Clear all:** removes runs and their screenshots.

## Quick start: one command

After installing **Git, Node.js 24 LTS (22+), PostgreSQL and Google Chrome** once, clone the repository and run, from the repository root or from this folder:

```bash
npm run app
```

On Windows you can also double-click **`Start VDO Tool.cmd`** in the repository root. Step-by-step: [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md).

`npm run app` (`scripts/app.mjs`):

1. **Updates:** fetches the latest version of the current branch from GitHub (fast-forward only; it never merges or overwrites local edits) and restarts itself if it changed.
2. **Settings, first run only:** asks for the PostgreSQL host, port, user, password (hidden) and database name, and writes `server/.env`.
3. **Installs packages** for the deep test engine (pnpm, `--frozen-lockfile`) and for the app (`npm ci`, never rewrites lockfiles). It does this only when a `package.json` or lockfile changed. If Playwright's Chromium can't be downloaded, Google Chrome is used.
4. **Builds** the deep test engine and the dashboard only when their code changed.
5. **Connects to PostgreSQL**, creating the database if it doesn't exist.
6. **Starts the server** at **http://127.0.0.1:3000** (dashboard included) and opens the browser. The dashboard footer shows the branch, commit and date that are running.

Options: `--no-update`, `--branch <name>` (switch branch first), `--setup` (change the PostgreSQL settings), `--no-open`. Pass them after `--`, e.g. `npm run app -- --branch custom-placement-automation`.

### Developer setup

```bash
npm run setup || bash setup.sh
```

`npm run setup` needs npm, which comes with Node. If npm isn't installed, the `||` falls back to running `bash setup.sh` directly.

The script checks for Node.js 20+ (installing it through nvm if it's missing or too old) and installs the server and client dependencies. It also installs Chromium and, on Linux, Chromium's system libraries, then creates `server/.env` and starts the app.

Open **http://localhost:5173**. Full instructions, including troubleshooting, are in [SETUP.md](SETUP.md). **On Windows (PowerShell)**, follow [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md) step by step instead.

Before starting, configure `DATABASE_URL` for your local PostgreSQL instance in `server/.env`. Setup does not install PostgreSQL or create credentials. The API listens only on `127.0.0.1`. `/api/ready` checks the database, queue state and actual Chromium launch (cached for 30 seconds). The dashboard polls readiness and enables checks only when all three are ready. Placement checks, deep tests and PDFs use the same browser: **Google Chrome when it is installed** (`BROWSER_CHANNEL=auto`), otherwise Playwright's Chromium. Install Chrome: Playwright's Chromium cannot play MP4/H.264 video, which most video ads use, so ad playback cases (TC-10) are less reliable without it. The dashboard shows which browser is in use and whether it plays MP4 video.

If Chromium is missing, run `node server/node_modules/playwright/cli.js install chromium` from this folder in a normal terminal. The running dashboard detects the installation automatically. A production-built dashboard is also served directly by the backend at `http://127.0.0.1:3000/` when `client/dist` exists; Vite development mode remains on port 5173.

| Command (project root) | Does |
|---|---|
| `npm run app` | Everyday use: update, install/build what changed, start on port 3000 |
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
      deepValidation    loads the compiled 23-case engine and runs the deep test per URL
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
| POST | `/api/placement-checks` | Start a check and return a job (`"deep": true` adds the 23-case deep test and the safe frame check; `"refreshIntervalSec": 30 \| 45 \| 60` adds the ad slot refresh check; `"type": "sticky"` runs the sticky violation checker, with `"stickyCode": "none" \| "vdo.ai.js" \| "style.css"`) |
| GET | `/api/placement-checks/:jobId` | Job progress and results |
| GET | `/api/history` | List runs (`?page=&pageSize=&q=&status=&type=&mode=deep`; `type=sticky` for sticky checks) |
| GET | `/api/history/:runId` | One run with its results |
| GET | `/api/history/:runId/pdf` | Download the run as a PDF |
| DELETE | `/api/history/:runId` | Delete one run and its screenshots |
| DELETE | `/api/history` | Delete all runs, screenshots and stored scripts |

## Limitations

- **No login.** Anyone who can reach the app can run checks and delete reports. By default it's only reachable from the machine it runs on.
- **Restart recovery:** queued jobs resume; interrupted jobs are marked failed for inspection, preserving completed-device results. The current URL is not resumed automatically. Reports remain in PostgreSQL; terminal job polling records expire after an hour.
- **Some sites block automated browsers;** these show up as `page_blocked`.
- **`script_not_loaded` is common on sites where the ad slot doesn't always fill,** because then the page never requests `vdo.ai.js`.
