# Setup

> **Windows / PowerShell:** `bash setup.sh` does not run in PowerShell. Follow the step-by-step [Windows installation guide](INSTALL-WINDOWS.md), which also covers PostgreSQL 18 and the deep test engine.

**Local PostgreSQL is now required.** Before the final start step, set `DATABASE_URL` in `server/.env` to your local connection. The server creates the `custom_placement` schema and imports an existing `server/storage/reports.json` once. The setup script does not install PostgreSQL. See [LOCAL-VALIDATION-PLAN.md](LOCAL-VALIDATION-PLAN.md) for recovery, tests and the 23-case rollout.

Step-by-step instructions for installing and running Placement Automation. The steps are written so a person or an AI agent can follow them in order. Each step says how to confirm it worked.

## Quick path: the setup script

On **macOS or Linux**, one command does steps 1–5 below:

```bash
npm run setup || bash setup.sh   # run the setup script, via npm or directly
bash setup.sh --no-start         # install only, don't start
```

**Why the `||`:** `npm run setup` only works when npm is already installed, because it comes with Node. If it isn't, the shell reports `npm: command not found`, and `||` runs `bash setup.sh` directly, which then installs Node. When npm is present, `npm run setup` runs the same script. The fallback adds a second run only if the first one fails, and that's harmless because the script skips whatever is already in place.

It runs these steps, skipping anything already in place:

1. **Node.js 20+:** if Node is missing or older, it installs nvm (unless present) and the latest Node LTS, and makes it the default.
2. **Dependencies:** runs `npm install` at the root, which installs the server and client packages.
3. **Chromium:** downloads Playwright's Chromium.
4. **Linux only:** looks for missing Chromium system libraries and installs them with `sudo npx playwright install-deps chromium`. It asks for your password; when run without a terminal, it prints the command instead.
5. **`server/.env`:** creates it from `.env.example` if it doesn't exist. It warns if there's no display while `HEADLESS=false`.
6. **Start:** runs `npm start`.

On **Windows**, use Git Bash or WSL for the script. Without nvm on Windows, install Node.js 20+ from https://nodejs.org first; the script stops with that instruction if Node is missing or too old.

If the script finishes, you can skip to [step 6](#6-run-a-first-check). The manual steps below do the same thing by hand.

## 1. Requirements

| Requirement | Check with | Expected |
|---|---|---|
| Node.js 20 or newer | `node -v` | `v20.x` or higher |
| npm (comes with Node) | `npm -v` | any version |
| Internet access (first install only) | | needed for npm packages and the Chromium download (~150 MB) |
| ~2 GB free RAM while a check runs | | |

**Supported systems:**

- Windows 10/11, macOS, and Ubuntu/Debian-based Linux.
- Alpine Linux isn't supported.
- Phones and tablets can't run it.

If `node -v` is below 20 or Node isn't installed, install the LTS version from https://nodejs.org before continuing.

## 2. Get the code

Copy or clone the project folder, then open a terminal in its **root**: the folder containing `package.json`, `server/` and `client/`.

```bash
cd custom_placement_automation
```

## 3. Install

```bash
npm install
```

This runs three steps automatically:

1. installs the server's dependencies (`server/node_modules`);
2. installs the client's dependencies (`client/node_modules`);
3. downloads Chromium for Playwright (skipped if it's already installed).

**Confirm:** the command ends without `npm error`, and both `server/node_modules` and `client/node_modules` exist.

**Linux only:** if a later check fails with a missing shared library error (e.g. `libnss3.so`), install Chromium's system dependencies once:

```bash
cd server && sudo npx playwright install-deps chromium && cd ..
```

## 4. Configure (optional)

Every setting has a default, so this step can be skipped. To change settings, copy the example file:

```bash
cp server/.env.example server/.env
```

On Windows (PowerShell): `Copy-Item server/.env.example server/.env`

| Setting | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | API port. If you change it, also change the proxy target in `client/vite.config.js` |
| `HEADLESS` | `false` | `false` shows the browser window during checks. **Set to `true` on a machine without a display** (servers, containers) |
| `NAVIGATION_TIMEOUT_MS` | `30000` | Max time to load a page |
| `URL_TIMEOUT_MS` | `60000` | Max time per URL, including all checks |
| `PLACEMENT_EVENT_SETTLE_MS` | `3000` | How long to keep listening after the first `vdo:placement` event |
| `SCREENSHOT_SETTLE_MS` | `1200` | Pause before each screenshot so the player can settle |
| `SCROLL_STEP_VIEWPORT_RATIO` | `0.45` | Default scroll step, as a fraction of the screen height |
| `SCROLL_INTERVAL_MS` | `1600` | Default wait between scroll steps and between checks |
| `MAX_CONCURRENT_JOBS` | `2` | Checks that may run at the same time; the rest queue |
| `STORAGE_DIR` | `storage` | Where reports, screenshots and scripts are saved (relative to `server/`) |
| `HOST` | all interfaces | Address the API listens on |

## 5. Start

```bash
npm start
```

This starts both apps in one terminal. Lines are labelled `[server]` and `[client]`.

- **API:** http://localhost:3000
- **UI:** http://localhost:5173

**Confirm:**

1. The terminal shows `[server] … Server running on http://localhost:3000` and `[client] … Local: http://localhost:5173/`.
2. `curl http://localhost:3000/api/health` returns `{"status":"ok"}`.
3. Opening http://localhost:5173 shows the **New check** form and an empty **History**.

To stop both, press `Ctrl+C`.

Steps 3 and 5 can also be run together with `bash setup.sh` or `npm run setup`.

## 6. Run a first check

1. Open http://localhost:5173.
2. Choose **Custom placement (vdo.ai.js)**.
3. Enter the **domain** (e.g. `prabhatkhabar.com`) and the **tag** (e.g. `v-prabhatkhabar-v4`). The tag must match the one in the site's `a.vdo.ai/core/<tag>/vdo.ai.js` URL.
4. Paste one or more article URLs from that site, one per line.
5. Upload or paste your `vdo.ai.js`. It must fire `vdo:placement` (the **?** next to the field shows an example).
6. Click **Run check**. A Chromium window opens (unless `HEADLESS=true`) and the progress bar fills.
7. When it finishes, the results appear under **Current check** and in **History**.

## Running parts separately

| What | Command (from the project root) |
|---|---|
| API only, auto-restart on code changes | `npm --prefix server run dev` |
| API only, no auto-restart | `npm --prefix server start` |
| UI only | `npm --prefix client run dev` |
| Re-download Chromium | `npm --prefix server run browsers:install` |

## Opening the UI from another device (optional)

By default the UI is only reachable from the machine it runs on. To open it from another device on the same network:

1. Start the client with `npm --prefix client run dev -- --host`.
2. On the other device, open `http://<this-machine's-IP>:5173`.

There's no login, so anyone on that network can then run checks and delete reports. Only do this on a trusted network.

## Data

Everything is stored under `server/storage/` (created automatically, not committed to git):

- `reports.json`: every run and its results;
- `screenshots/<runId>/`: the screenshots for each run;
- `scripts/`: the uploaded `vdo.ai.js` / `style.css` files, used by **Re-run**.

You can delete runs from the UI with **Delete** or **Clear all**. To reset everything by hand, stop the app and delete `server/storage/`.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Port 3000 is already in use` or `Port 5173 is in use` | Stop the other process using the port, or change `PORT` in `server/.env` (and the proxy target in `client/vite.config.js`) |
| UI loads but History shows an error, or checks don't start | The API isn't running. Check the `[server]` lines in the terminal, and confirm `curl http://localhost:3000/api/health` |
| `Executable doesn't exist … chromium` | Run `npm --prefix server run browsers:install` |
| `Missing X server or $DISPLAY` / browser won't open | No display available. Set `HEADLESS=true` in `server/.env` |
| Missing `.so` library errors on Linux | `cd server && sudo npx playwright install-deps chromium` |
| Every URL shows `script_not_loaded` | The tag in the form doesn't match the site's `a.vdo.ai/core/<tag>/vdo.ai.js`, or the site loads the tag through an ad slot that didn't fill. Check the Diagnostics panel |
| `No vdo:placement event` although the override applied | The script never reached the dispatch. Check for a syntax error (e.g. `node --check vdo.ai.js`), and check Diagnostics → "Errors reported by vdo.ai.js" |
| Chromium download fails behind a proxy | Set `HTTPS_PROXY` before `npm install`, or ask your network admin to allow `playwright.azureedge.net` / `cdn.playwright.dev` |
