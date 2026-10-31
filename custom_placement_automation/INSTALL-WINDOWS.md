# Windows installation, step by step

This guide installs Placement Automation on Windows: the placement checks, the 23-case **deep test** and the **sticky violation checker**. After the software in Part 1 is installed, one command does everything else: updating, installing, building, setting up the database and starting the tool.

Run the commands in **PowerShell**. Every part ends with a ✅ check.

## Part 1: Install the software (once)

| # | Install | Where | During install |
|---|---|---|---|
| 1 | **Git** | https://git-scm.com/download/win | Keep the defaults |
| 2 | **Node.js 24 LTS** (22 or newer works) | https://nodejs.org | Keep the defaults |
| 3 | **PostgreSQL 18** | https://www.postgresql.org/download/windows/ | **Write down the password** for the `postgres` user and the **port** the installer offers |
| 4 | **Google Chrome** | https://www.google.com/chrome/ | Keep the defaults. The tool uses it automatically because it plays MP4 video ads |

If other PostgreSQL versions (for example 14, 15, 17) are already installed, ports 5432–5434 are usually taken and the 18 installer suggests the next free one (often **5435**). Keep it and note it. Each version has its own password.

Close and reopen PowerShell after installing.

✅ **Check**

```powershell
git --version
node -v
Get-Service postgresql*
```

`node -v` shows **v22 or higher** (v24 recommended), and `postgresql-x64-18` shows **Running** (if not: `Start-Service postgresql-x64-18`).

## Part 2: Download the code (once)

Use a short folder such as `C:\vdo`; long Windows paths fail with "Filename too long".

```powershell
git config --global core.longpaths true
git clone -b sticky-violation-detection https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool.git C:\vdo
```

✅ **Check**: `cd C:\vdo` then `git status` shows "working tree clean".

## Part 3: Start the tool (every time)

```powershell
cd C:\vdo
npm run app
```

Or **double-click `Start VDO Tool.cmd`** in `C:\vdo`.

**First time only**, it asks five questions. Press Enter to keep the value in brackets:

| Question | What to enter |
|---|---|
| PostgreSQL host | Enter (`127.0.0.1`) |
| PostgreSQL port | The PostgreSQL 18 port from Part 1, e.g. `5435` |
| PostgreSQL user | Enter (`postgres`) |
| Password | The PostgreSQL 18 password (shown as `*****`) |
| Database name | Enter (`player_validator`; it is created for you) |

Then it does the rest on its own. The first run takes a few minutes (downloads packages and the test browser); later starts take seconds:

```
▸ Checking for updates        ✓ Up to date (sticky-violation-detection)
▸ Settings                    ✓ Settings found (server/.env)
▸ Installing packages         ✓ … up to date
▸ Building                    ✓ … up to date
▸ Database                    ✓ PostgreSQL connected
▸ Starting                    Ready: open http://127.0.0.1:3000
```

The browser opens at **http://127.0.0.1:3000**. Keep the PowerShell window open; **Ctrl+C** stops the tool.

✅ **Check**: the dashboard shows the status boxes green (API, Database, Google Chrome, MP4 video, Deep test engine, Queue), and the footer shows the version, e.g. `Version sticky-violation-detection · 1a2b3c4 · 2026-10-30`.

## Updating

Nothing to do. Every `npm run app` (or double-click) first fetches the latest version from GitHub for the branch you are on. It then re-installs and rebuilds only what changed. Your settings, database and past runs are kept.

| Command | What it does |
|---|---|
| `npm run app` | Update, then start |
| `npm run app -- --no-update` | Start the version you already have |
| `npm run app -- --branch <name>` | Switch to another branch (e.g. a test branch), then start |
| `npm run app -- --setup` | Change the PostgreSQL settings |
| `npm run app -- --no-open` | Do not open the browser |

Updates are only fast-forwards: the tool never merges or overwrites your files. If you edited files in `C:\vdo`, it says so and starts the current version; `git restore .` undoes the edits and lets updates apply again.

## Part 4: Safe first test (no vdo.ai tag involved)

1. **What to test**: CSS check → Paste code → `body { }`
2. **Target site**: domain `example.com`, tag `v-example`, URL `https://example.com/`
3. **Run settings**: Desktop only; deep test **off** → **Run check**

✅ **Check**: a Chrome window opens and closes, the result is **FAIL · Wrapper div not found** (expected: example.com has no vdo.ai player), the run appears in **Recent runs**, and **PDF** downloads a report.

## Part 5: Testing a live tag (be careful)

Each run on a live site sends **real** logger events, analytics hits and ad requests. Your uploaded `vdo.ai.js` is swapped in only inside the test browser; the live tag and the vdo.ai server are not changed. Keep the number of URLs and repeats to a minimum, and start with Desktop.

- **Custom placement / CSS check:** upload or paste the code, add the publisher domain, tag and article URLs, optionally turn on the deep test.
- **Sticky violation checker:** pick it in step 1. The 13 mandatory checks (ST-01 to ST-13) always run. Tick **Also run the additional checks** for ST-14 to ST-25. Every check shows Pass, Fail or Warning with its screenshot.

## Troubleshooting

| What you see | Fix |
|---|---|
| `Node.js … is too old` | Install Node.js 24 LTS (Part 1), reopen PowerShell |
| `PostgreSQL is not running at …` | `Start-Service postgresql-x64-18`, or `npm run app -- --setup` if the port is wrong |
| `PostgreSQL rejected the password` | `npm run app -- --setup` and enter the PostgreSQL 18 password |
| `An update is available, but files were changed on this computer` | `git restore .` in `C:\vdo` (undoes local edits), then `npm run app` |
| `Playwright's Chromium could not be downloaded` | Fine if Google Chrome is installed; otherwise check the internet connection and run `npm run app` again |
| `Filename too long` while cloning | Part 2: `git config --global core.longpaths true` and clone into `C:\vdo` |
| `Port 3000 is already in use` | Another copy is running; close its window |
| `Another placement server already owns this database schema` | Another copy is still running; close it |
| MP4 video box amber | Install Google Chrome, or set `CHROME_PATH` in `server\.env` to `chrome.exe`, then restart |
| `… is not on <domain>. Tick "Allow URLs on other domains"` | The URL is a staging / preview copy on another host. Keep the publisher's domain in the Domain field and tick **Allow URLs on other domains (staging / preview)** |
| A URL shows **Page blocked** | The site refused the automated browser (bot protection); the result shows the HTTP status and what the site showed. Try Desktop, wait a few minutes, or try another URL |
