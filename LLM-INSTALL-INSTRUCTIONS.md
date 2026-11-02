# LLM instructions: install, update and verify the VDO.ai tool

This file is written for an **AI coding assistant** (Claude Code, Cursor, Copilot agent mode, Codex or similar) that is asked to install or update this tool on a team member's computer. The human version is [INSTALL-AND-UPDATE.md](INSTALL-AND-UPDATE.md).

**For people:** open your AI assistant in a terminal on the computer where the tool should run, and paste one of the [prompts](#prompts-to-copy) at the end of this file.

---

## Part A — Instructions for the assistant

### A1. What you are installing

- **Repository:** `https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool` (default branch `main`).
- **The application to run** is **Placement Automation** in `custom_placement_automation/`. It is a local dashboard (Express API + React) that opens publisher pages in Chrome and checks the vdo.ai player.
- **Data:** it stores its results in **PostgreSQL**, in schema `custom_placement`, inside the database named in `DATABASE_URL`.
- **Entry point:** `npm run app` from the repository root, which runs `custom_placement_automation/scripts/app.mjs`. It does everything after the system requirements:
  1. updates the branch from GitHub (fast-forward only);
  2. reads `custom_placement_automation/server/.env`, or asks for the PostgreSQL settings when it's missing;
  3. installs packages (`pnpm install --frozen-lockfile` at the root, `npm ci` in `server/` and `client/`), but only when lockfiles changed;
  4. builds the 23-case deep test engine (`pnpm exec tsc -p tsconfig.json`) and the dashboard, but only when their code changed;
  5. connects to PostgreSQL and creates the database if it is missing;
  6. starts the server on `http://127.0.0.1:3000` and keeps running until stopped.
- **Readiness endpoint:** `GET http://127.0.0.1:3000/api/ready` returns HTTP 200 and `"ready": true` when the database, the queue and a real browser launch all work. The deep test engine is reported separately in `deep.available`.

### A2. System requirements

| Requirement | Minimum | Check command |
|---|---|---|
| Git | any recent | `git --version` |
| Node.js | **22** (24 LTS recommended) | `node -v` |
| npm | comes with Node | `npm -v` |
| PostgreSQL server | 14+, running and reachable | Windows `Get-Service postgresql*`; macOS `brew services list`; Linux `systemctl status postgresql`; any OS `psql --version` and `pg_isready -h 127.0.0.1 -p <port>` |
| Google Chrome | current (recommended) | Windows `Test-Path "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"`; macOS `ls "/Applications/Google Chrome.app"`; Linux `google-chrome --version` |
| pnpm | optional | Not needed: the launcher falls back to `npx pnpm@10` |
| Disk / RAM | ~3 GB free, 8 GB RAM | |
| Network | GitHub, registry.npmjs.org, playwright.azureedge.net (optional), publisher sites, `*.vdo.ai` | |
| Display | needed unless `HEADLESS=true` | On a server or container with no display, set `HEADLESS=true` in `server/.env` |

**Without Chrome**, the tool uses Playwright's Chromium (`npm --prefix custom_placement_automation/server run browsers:install`). Chromium can't play MP4/H.264 video ads, so recommend installing Chrome.

### A3. Rules you must follow

1. **Ask before installing system software** (Git, Node.js, PostgreSQL, Chrome) or running anything with `sudo` or administrator rights. Say what you will install and from where.
2. **Never invent, print or commit credentials.**
   - Ask the user for the PostgreSQL user and password; don't guess them.
   - Don't echo the password back, and don't put it in shell history where you can avoid it.
   - `server/.env` holds the password: it is git-ignored and must stay that way. Never `git add` it.
3. **Don't modify the code or the lockfiles.**
   - Don't run `npm install <pkg>`, `npm update`, `npm audit fix` or `pnpm update`, and don't edit `package-lock.json` / `pnpm-lock.yaml`.
   - The updater only fast-forwards. Any local change (even a rewritten lockfile) stops future updates with "files were changed on this computer".
4. **Don't commit, push, rebase, reset or force anything** in the repository, unless the user explicitly asks.
5. **Don't delete data.** Never drop the database, the `custom_placement` schema or `custom_placement_automation/server/storage/` unless the user explicitly asks for an uninstall with data removal.
6. **Leave the server running** when you finish installing, unless the user asks otherwise. It is a long-running process: start it in the background or in a separate terminal, don't block on it.
7. **Report honestly.**
   - Show the user the relevant output for each step.
   - If a step fails, stop, show the error and use the [troubleshooting table](#a7-troubleshooting).
   - Don't claim success until the readiness check in A5 passes.
8. **Live sites are real traffic.** Don't run checks against publisher sites on your own initiative. The only test check you may run without asking is the `example.com` smoke test in A5.

### A4. Installation procedure

Work from the folder the user wants the tool in. Use a short path on Windows, for example `C:\vdo`.

**Step 1 — Check the requirements** with the commands in A2. Report a table of what is present and what is missing, with versions. If something is missing, propose the install commands below and **wait for approval**.

| OS | Git / Node.js | PostgreSQL | Chrome |
|---|---|---|---|
| Windows (winget) | `winget install --id Git.Git -e` and `winget install --id OpenJS.NodeJS.LTS -e` | `winget install --id PostgreSQL.PostgreSQL.16 -e` (the installer asks the **user** to set the `postgres` password; note the port) | `winget install --id Google.Chrome -e` |
| macOS (Homebrew) | `brew install git node@24` | `brew install postgresql@16 && brew services start postgresql@16` (user = macOS user name, no password, port 5432) | `brew install --cask google-chrome` |
| Ubuntu/Debian | `sudo apt install -y git`, then Node 24 via nvm: `nvm install 24` | `sudo apt install -y postgresql && sudo systemctl enable --now postgresql`; the user sets a password with `sudo -u postgres psql -c "ALTER USER postgres PASSWORD '…';"` | Download `google-chrome-stable_current_amd64.deb` from dl.google.com and `sudo apt install -y ./google-chrome-stable_current_amd64.deb` |

After installing Node.js on Windows, a **new terminal** is needed before `node` is on the `PATH`.

**Step 2 — Get the code.**

```bash
git clone https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool.git <folder>
cd <folder>
```

- On Windows, run `git config --global core.longpaths true` first.
- If the repository is already cloned, `cd` into it and run `git status`. It must say "working tree clean"; if it doesn't, ask the user before changing anything.
- If the user wants a specific branch, use `git clone -b <branch> …`, or let the launcher switch later with `--branch`.

**Step 3 — Write the settings file.** `npm run app` asks for the PostgreSQL settings interactively. An assistant usually has **no interactive terminal**, and then the launcher stops with `server/.env is missing`. So create the file yourself, exactly as the launcher would:

1. Ask the user for the PostgreSQL **host** (default `127.0.0.1`), **port** (default `5432`), **user** (default `postgres`; on macOS Homebrew, the macOS user name), **password**, and **database name** (default `player_validator`, created automatically).
2. Copy `custom_placement_automation/server/.env.example` to `custom_placement_automation/server/.env`. Skip this if `.env` already exists with a real `DATABASE_URL`: then keep it and go to step 4.
3. Replace the line starting with `DATABASE_URL=` with:

   ```
   DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<database>
   ```

   URL-encode the user and password: `@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`, `%` → `%25`. An empty password stays empty: `postgresql://alice:@127.0.0.1:5432/player_validator`.
4. If the machine has no display (server, container, WSL without a GUI), set `HEADLESS=true`. Otherwise leave `HEADLESS=false` so the user sees the browser during checks.
5. Leave every other line as it is.

**Step 4 — Start the tool** in the background, from the repository root, and capture its output:

```bash
npm run app -- --no-open > "${TMPDIR:-/tmp}/vdo-app.log" 2>&1 &          # macOS / Linux
```

```powershell
Start-Process -NoNewWindow -FilePath npm.cmd -ArgumentList 'run','app','--','--no-open' -RedirectStandardOutput "$env:TEMP\vdo-app.log" -RedirectStandardError "$env:TEMP\vdo-app.err"   # Windows
```

Or ask the user to run `npm run app` in their own terminal, or double-click `Start VDO Tool.cmd` on Windows. The first run takes several minutes: it installs packages, downloads a browser and builds. Watch the log (outside the repository, so it never shows up as a changed file) for the `▸` step lines; it is ready when it prints `Ready: open http://127.0.0.1:3000`. A line starting with `✗` is a failure: stop and troubleshoot.

**Step 5 — Verify:** run A5.

**Step 6 — Report to the user:**
- what was installed;
- the folder;
- the branch and commit (`git log -1 --format='%h %cs %s'`);
- the readiness result;
- how to start the tool next time (`npm run app`, or `Start VDO Tool.cmd` on Windows);
- how to stop it (Ctrl+C, or end the background process).

### A5. Verification

1. **Readiness:**

   ```bash
   curl -s http://127.0.0.1:3000/api/ready
   ```

   Expect HTTP 200 with `"ready": true`, `"database": true` and `"browser": {"launchable": true, …}`. Also report:
   - `browser.name`: `Google Chrome` is preferred over `Chromium`;
   - `browser.mp4`: whether MP4 ads can play;
   - `deep.available`: whether the 23-case deep test engine is built.
2. **Version:** `curl -s http://127.0.0.1:3000/api/settings` shows `version` as `branch · commit · date`.
3. **Smoke test.** It is safe: it involves no vdo.ai tag and no publisher site.

   ```bash
   curl -s -X POST http://127.0.0.1:3000/api/placement-checks -H 'content-type: application/json' \
     -d '{"type":"style.css","domain":"example.com","tag":"v-example","devices":["desktop"],"urls":["https://example.com/"],"script":"body { }"}'
   ```

   This returns a job with an `id`. Poll `GET /api/placement-checks/<id>` until `status` is `completed`, which takes about 60 s. The expected result is `runs[0].failCount: 1`, with `runs[0].results[0].reasons` containing `div_not_found`, because example.com has no player. That proves the browser, queue, database and screenshots work.

   If the run completes with `page_blocked` instead, read `runs[0].results[0].error`. An error such as `net::ERR_TUNNEL_CONNECTION_FAILED`, `ERR_NAME_NOT_RESOLVED` or `ERR_CONNECTION_REFUSED` means **this computer's network (proxy or firewall) blocks the site**, not that the tool is broken. The run still proves the browser, queue and database work. Tell the user that the network must allow the publisher sites and `*.vdo.ai` before real checks can work.
4. **Optionally, tests.** Only if the user asks: `npm --prefix custom_placement_automation/server test`. Tests that need a database require `TEST_DATABASE_URL`.

### A6. Updating an existing installation

1. `cd` into the repository and run `git status`.
   - **Working tree clean:** go on.
   - **Changed files:** show them to the user and ask before running `git restore .`. Updates do not apply while files are changed.
2. Stop the running tool if there is one. On macOS/Linux, find it with `lsof -i :3000`; on Windows, with `Get-NetTCPConnection -LocalPort 3000`. If it runs in the user's terminal, ask them to press Ctrl+C.
3. Run `npm run app -- --no-open`, in the background as in A4 step 4. Read the update line:
   - `Updated <branch>: a → b (n new changes)`: applied. It reinstalls and rebuilds only what changed.
   - `Up to date (<branch>)`: nothing new.
   - `files were changed on this computer`, `this copy has its own commits`, or `GitHub could not be reached`: not applied. Report it and see [INSTALL-AND-UPDATE.md § How updates work](INSTALL-AND-UPDATE.md#5-how-updates-work).
4. Run A5 steps 1 and 2. Summarise what changed from the top entry of [CHANGELOG.md](CHANGELOG.md).

**Switching branch:** `npm run app -- --branch <name> --no-open`. The tree must be clean. Go back with `--branch main`.

**Rolling back:**
1. `git switch --detach <commit>`, then `npm run app -- --no-update --no-open`.
2. Return with `npm run app -- --branch main`.

Only do this when the user asks.

### A7. Troubleshooting

| Log line or symptom | Cause | Action |
|---|---|---|
| `Node.js … is too old` | Node < 22 | Install Node 24 LTS (ask first), open a new terminal |
| `server/.env is missing. Run "npm run app" in a terminal…` | No `.env` and no interactive terminal | Do A4 step 3 |
| `PostgreSQL is not running at host:port` | Service stopped or wrong port | Start the service (Windows `Start-Service postgresql-x64-<n>`; macOS `brew services start postgresql@16`; Linux `sudo systemctl start postgresql`), or fix the port in `DATABASE_URL` |
| `PostgreSQL rejected the password` | Wrong credentials | Ask the user for the right password; update `DATABASE_URL` |
| `permission denied to create database` | The role can't create databases | Ask the user to create the database or grant `CREATEDB`; or point `DATABASE_URL` at an existing database |
| `Another placement server already owns this database schema` | A second copy is running on the same database | Stop the other copy |
| `Port 3000 is already in use` | Another process on port 3000 | Stop it, or set `PORT=<free port>` in `server/.env` and use that port in the checks |
| `Installing the deep test engine packages failed` / `npm ci` errors | Network, or a modified lockfile | Check `git status` (lockfiles must be unchanged) and the network, then run again. Don't "fix" it by editing lockfiles |
| `Playwright's Chromium could not be downloaded` | Download blocked | Fine if Chrome is installed; otherwise install Chrome |
| `/api/ready` → `browser.launchable: false` | No display, or missing libraries | Set `HEADLESS=true` on headless machines. On Linux, in `custom_placement_automation/server`: `npx playwright install-deps chromium` (needs sudo; ask first) |
| `deep.available: false` | Engine not built | Run `npm run app` again. If it persists, run `npx pnpm@10 install --frozen-lockfile && npx pnpm@10 exec tsc -p tsconfig.json` at the repository root |
| `Filename too long` (Windows clone) | Long paths disabled | `git config --global core.longpaths true`, clone to `C:\vdo` |

### A8. Uninstall (only when asked)

1. Stop the tool.
2. Delete the repository folder.
3. Only with explicit confirmation, drop the database: `psql -U <user> -h <host> -p <port> -c "DROP DATABASE <database>;"`.

Don't uninstall Git, Node.js, PostgreSQL or Chrome unless asked: other software may use them.

---

## Prompts to copy

Paste one of these into your AI assistant, opened in a terminal on the computer where the tool should run. Replace the parts in `<angle brackets>`.

### Install

```text
Install the VDO.ai Placement Automation tool on this computer.
Follow LLM-INSTALL-INSTRUCTIONS.md from https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool
(read it from the repository after cloning, or from GitHub first). Follow its rules exactly.
- Install folder: <C:\vdo or ~/vdo>
- Branch: main
- First check the requirements and show me what is missing; ask me before installing anything or using admin rights.
- Ask me for the PostgreSQL port, user and password when you need them; never print the password.
- Start the tool, run the readiness check and the example.com smoke test, and report the result,
  the branch and commit, and how I start it next time.
```

### Update

```text
Update my VDO.ai tool in <C:\vdo or ~/vdo> to the latest version, following section A6 of
LLM-INSTALL-INSTRUCTIONS.md in that repository. Don't discard any local changes without asking me.
Start it again, run the readiness check, and tell me what changed using the top entry of CHANGELOG.md.
```

### Try a test branch

```text
Switch my VDO.ai tool in <C:\vdo or ~/vdo> to the branch <implementation-validator> using
npm run app -- --branch <implementation-validator>, following LLM-INSTALL-INSTRUCTIONS.md (A6).
Check that the working tree is clean first. Run the readiness check and show me the version from /api/settings.
Tell me the command to go back to main.
```

### Check that it works

```text
Check my VDO.ai tool installation in <C:\vdo or ~/vdo> following section A5 of LLM-INSTALL-INSTRUCTIONS.md:
readiness, version and the example.com smoke test. Don't run checks on any other site.
Report each result and anything that is not green (browser, MP4 video, deep test engine).
```

### Fix a problem

```text
My VDO.ai tool in <C:\vdo or ~/vdo> does not start (or shows an error). Read LLM-INSTALL-INSTRUCTIONS.md
(section A7) and INSTALL-AND-UPDATE.md, run npm run app -- --no-open in the background, read the output,
find the cause and propose the fix. Ask me before changing settings, installing software or deleting anything.
Here is what I see: <paste the error or describe it>
```

### Uninstall

```text
Uninstall the VDO.ai tool from <C:\vdo or ~/vdo> following section A8 of LLM-INSTALL-INSTRUCTIONS.md.
Stop it and delete the folder. <Keep / Also drop> the PostgreSQL database — ask me to confirm before dropping it.
```
