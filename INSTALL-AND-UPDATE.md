# Installing and updating the VDO.ai tool (team guide)

This guide is for everyone on the team who runs **Placement Automation**, the dashboard for:
- custom placement and CSS checks;
- the 23-case deep test;
- the sticky violation checker;
- the implementation validator.

It covers the one-time installation on Windows, macOS and Linux, everyday starting, how updates reach you, switching to a test branch, going back to an older version, and fixing common problems.

- Windows users who want every click spelled out can also follow [custom_placement_automation/INSTALL-WINDOWS.md](custom_placement_automation/INSTALL-WINDOWS.md).
- To have an AI coding assistant do the installation, give it [LLM-INSTALL-INSTRUCTIONS.md](LLM-INSTALL-INSTRUCTIONS.md).
- What changed in each update is in [CHANGELOG.md](CHANGELOG.md).

## In short

| When | What you do |
|---|---|
| Once per computer | Install Git, Node.js 24, PostgreSQL and Google Chrome, then clone the repository |
| Every time you use the tool | `npm run app` in the repository folder (Windows: double-click `Start VDO Tool.cmd`) |
| To get updates | Nothing extra: every start checks GitHub and applies new changes for your branch |
| To try a test branch | `npm run app -- --branch <branch-name>` |
| To go back to `main` | `npm run app -- --branch main` |

## 1. Requirements

| Software | Version | Why |
|---|---|---|
| **Git** | any recent | Downloads the tool and its updates |
| **Node.js** | **24 LTS** recommended (22 is the minimum) | Runs the tool |
| **PostgreSQL** | 14 or newer (16–18 tested) | Stores runs, results and the job queue |
| **Google Chrome** | current | Opens the pages. It plays MP4/H.264 video ads, which Playwright's built-in Chromium cannot |

Hardware and access:
- **Hardware:** 8 GB RAM or more, and about 3 GB free disk for packages, the browser and screenshots.
- **Network:** internet access to GitHub, npmjs.com, the publisher sites and `*.vdo.ai`.
- **GitHub access:** read access to `chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool`. If the repository is private, Git asks you to sign in the first time.
- **Display:** the tool shows the browser window while it checks (`HEADLESS=false`). On a server without a display, set `HEADLESS=true` in `custom_placement_automation/server/.env`.

## 2. One-time installation

### Windows

1. Install the four programs. Keep the defaults, except for PostgreSQL, where you **write down the password and the port**:
   - Git: https://git-scm.com/download/win
   - Node.js 24 LTS: https://nodejs.org
   - PostgreSQL: https://www.postgresql.org/download/windows/
   - Google Chrome: https://www.google.com/chrome/

   If an older PostgreSQL is already installed, the installer offers the next free port (for example 5435). Keep it and note it.
2. Close and reopen **PowerShell**, then check:

   ```powershell
   git --version
   node -v
   Get-Service postgresql*
   ```

   `node -v` must show v22 or higher, and the PostgreSQL service must be **Running**. If it isn't, run `Start-Service postgresql-x64-18`, using the name `Get-Service` showed.
3. Download the code into a short folder (long paths fail on Windows):

   ```powershell
   git config --global core.longpaths true
   git clone https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool.git C:\vdo
   ```

### macOS

1. Install the programs with [Homebrew](https://brew.sh):

   ```bash
   brew install git node@24 postgresql@16
   brew services start postgresql@16
   brew install --cask google-chrome
   ```

   Homebrew's PostgreSQL user is your macOS user name, with no password, on port 5432. If `node -v` doesn't show v24, follow the `brew info node@24` instructions to put it on your `PATH`.
2. Download the code:

   ```bash
   git clone https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool.git ~/vdo
   ```

### Linux (Ubuntu / Debian)

1. Install Git and PostgreSQL, start PostgreSQL and give the `postgres` user a password:

   ```bash
   sudo apt update && sudo apt install -y git postgresql
   sudo systemctl enable --now postgresql
   sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'choose-a-password';"
   ```

2. Install Node.js 24 through [nvm](https://github.com/nvm-sh/nvm). Open a new terminal after installing nvm, then:

   ```bash
   nvm install 24
   ```

3. Install Google Chrome:

   ```bash
   wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
   sudo apt install -y ./google-chrome-stable_current_amd64.deb
   ```

4. Download the code:

   ```bash
   git clone https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool.git ~/vdo
   ```

## 3. First start

From the repository folder (`C:\vdo` or `~/vdo`):

```bash
npm run app
```

On Windows you can double-click **`Start VDO Tool.cmd`** instead.

The first time, it asks five questions about PostgreSQL. Press Enter to keep the value in brackets:

| Question | What to enter |
|---|---|
| PostgreSQL host | Enter (`127.0.0.1`) |
| PostgreSQL port | The port from the installation (`5432` unless the installer chose another) |
| PostgreSQL user | `postgres`. On macOS with Homebrew, your macOS user name |
| Password | The PostgreSQL password, shown as `*****`. Leave it empty on macOS Homebrew |
| Database name | Enter (`player_validator`). It is created for you |

The answers are saved in `custom_placement_automation/server/.env`, which never leaves your computer and isn't in Git.

Then it does the rest by itself. The first run takes a few minutes; later starts take seconds:

```
▸ Checking for updates        ✓ Up to date (main)
▸ Settings                    ✓ Settings found (server/.env)
▸ Installing packages         ✓ … up to date
▸ Building                    ✓ … up to date
▸ Database                    ✓ PostgreSQL connected
▸ Starting                    Ready: open http://127.0.0.1:3000
```

The browser opens at **http://127.0.0.1:3000**. Keep the terminal window open while you use the tool; **Ctrl+C** stops it.

**Installation is done when:**
- all the status boxes at the top of the dashboard are green: API, Database, Google Chrome, MP4 video, Deep test engine, Queue;
- the footer shows the version, for example `Version main · 370d32d · 2026-11-02`.

**Safe first test.** It touches no vdo.ai tag and no live site:
1. Choose **CSS check**, then **Paste code**, and paste `body { }`.
2. Enter domain `example.com`, tag `v-example` and URL `https://example.com/`.
3. Select Desktop only and click **Run check**.

The result should be **FAIL · Wrapper div not found**, which is expected because example.com has no player. The run appears in History, and **PDF** downloads a report.

If the result is **ERROR · Page blocked** with an error like `ERR_TUNNEL_CONNECTION_FAILED` or `ERR_NAME_NOT_RESOLVED`, your network (proxy or firewall) is blocking the site. The tool itself works. Ask IT to allow the publisher sites and `*.vdo.ai`.

## 4. Everyday use

Start the tool with `npm run app` (or the double-click) whenever you need it, and stop it with Ctrl+C.

| Command | What it does |
|---|---|
| `npm run app` | Check for updates, apply them, start |
| `npm run app -- --no-update` | Start the version you already have, without checking GitHub |
| `npm run app -- --branch <name>` | Switch to another branch, then update and start |
| `npm run app -- --setup` | Change the PostgreSQL settings |
| `npm run app -- --no-open` | Start without opening the browser |

Your settings, the database, past runs and screenshots are kept across starts, updates and branch switches.

**Be careful with live sites.** Every run on a live publisher page sends real logger events, analytics hits and ad requests. An uploaded `vdo.ai.js` is swapped in only inside the test browser; the live tag and the vdo.ai servers are never changed. Keep the number of URLs and repeats small.

## 5. How updates work

**For users: nothing to do.** Every `npm run app` does this before starting:

1. **Fetch:** it fetches your branch from GitHub (usually `main`).
2. **Apply:** if there are new commits, it applies them as a **fast-forward only**. It never merges, rebases or overwrites anything on your computer, and the terminal shows `Updated main: 1a2b3c4 → 5d6e7f8 (3 new changes)`.
3. **Restart, install and build:** it restarts itself with the new version. It re-installs packages only when a `package.json` or lockfile changed, and rebuilds the deep test engine and dashboard only when their code changed.
4. **Start:** it starts the tool. The dashboard footer shows the new commit.

When an update is **not** applied, the terminal says why and starts the version you have:

| Message | Meaning and fix |
|---|---|
| `GitHub could not be reached` | No internet or GitHub access. Try again later |
| `files were changed on this computer` | Someone edited files in the folder. Run `git restore .` in the repository folder to undo the edits, then `npm run app` |
| `this copy has its own commits` | Commits were made on this computer. Ask a developer, or start fresh: `git switch main` then `git reset --hard origin/main` (this **deletes** those local commits) |
| `does not follow a GitHub branch` | You are on a detached commit (see "Going back to an older version"). Run `npm run app -- --branch main` |

**What changed:** read [CHANGELOG.md](CHANGELOG.md). The newest entry is at the top.

### Trying a test branch

New features are first made available on a branch, for example `implementation-validator`, before they are merged into `main`. To try one:

```bash
npm run app -- --branch implementation-validator
```

The tool switches branches, updates and starts, and the footer shows the branch name. From then on, plain `npm run app` keeps updating **that** branch. To go back:

```bash
npm run app -- --branch main
```

Runs made on any branch stay in the same database and History.

### Going back to an older version

If an update breaks something you need today:

1. Find the last good commit in [CHANGELOG.md](CHANGELOG.md) or with `git log --oneline -10`.
2. Check it out and start it without updating:

   ```bash
   git switch --detach <commit>
   npm run app -- --no-update
   ```

3. Tell the maintainers what broke. When it is fixed, return to the latest version:

   ```bash
   npm run app -- --branch main
   ```

### Several people, several computers

- Each person runs their **own copy** with their **own PostgreSQL database**. The tool listens only on `127.0.0.1` and has no login, so it isn't meant to be shared over the network.
- Two copies can't use the same database at the same time. The second one stops with `Another placement server already owns this database schema`.
- Results stay on the computer that made them. To share a result, download its **PDF** from History.

## 6. For maintainers: shipping an update to the team

1. Do the work on a branch, and run the checks:

   ```bash
   npm --prefix custom_placement_automation/server test
   ```

   With a test database, set `TEST_DATABASE_URL`. For the opt-in browser tests, set `STICKY_BROWSER_TEST=1` or `IMPLEMENTATION_BROWSER_TEST=1`.
2. Add an entry to [CHANGELOG.md](CHANGELOG.md) under **Unreleased**: what changed, in words a user understands, with the commit links.
3. Let the team try it with `npm run app -- --branch <your-branch>`.
4. Merge into `main` (a pull request, or a fast-forward merge). Rename **Unreleased** to the date it reached `main`.
5. Tell the team. Their next `npm run app` applies it.

Rules that keep updates applying for everyone:
- **Never rewrite `main`'s history** (no force-push). Updates are fast-forward only, so a rewritten `main` stops every copy from updating.
- **Commit `package-lock.json` / `pnpm-lock.yaml` changes** together with `package.json` changes. The tool installs with `npm ci` and `pnpm install --frozen-lockfile`, which refuse a lockfile that doesn't match.
- **Keep settings out of Git.** New settings go into `custom_placement_automation/server/.env.example` with a safe default and are documented in [SETUP.md](custom_placement_automation/SETUP.md). Existing `.env` files are not rewritten, so the code must work when a new setting is missing.

## 7. Troubleshooting

| What you see | Fix |
|---|---|
| `Node.js … is too old` | Install Node.js 24 LTS and open a new terminal |
| `PostgreSQL is not running at …` | Start the PostgreSQL service (Windows: `Start-Service postgresql-x64-18`; macOS: `brew services start postgresql@16`; Linux: `sudo systemctl start postgresql`), or `npm run app -- --setup` if the port is wrong |
| `PostgreSQL rejected the password` | `npm run app -- --setup` and enter the right password |
| `server/.env is missing. Run "npm run app" in a terminal` | The first start must run in a terminal so it can ask the questions. Open a terminal in the folder and run `npm run app` |
| `Port 3000 is already in use` | Another copy of the tool is running; close its window. Or set another `PORT` in `server/.env` |
| `Another placement server already owns this database schema` | Another copy is still running on this database; close it |
| `Playwright's Chromium could not be downloaded` | Fine when Google Chrome is installed. Otherwise check the internet connection and start again |
| Dashboard box **MP4 video** amber | Install Google Chrome, or set `CHROME_PATH` in `server/.env` to Chrome's path, then restart |
| Dashboard box **Deep test engine** red | Run `npm run app` once more; it rebuilds the engine when its code changed. If it persists, run `npx pnpm@10 install --frozen-lockfile` then `npx pnpm@10 exec tsc -p tsconfig.json` in the repository folder |
| `Filename too long` while cloning (Windows) | `git config --global core.longpaths true` and clone into `C:\vdo` |
| Browser window doesn't open on a server | Set `HEADLESS=true` in `custom_placement_automation/server/.env` |
| A URL shows **Page blocked** | The site refused the automated browser (bot protection). Try Desktop, wait a few minutes, or try another URL |

Still stuck? Send the maintainers:
- the full terminal output of `npm run app`;
- the version from the dashboard footer;
- what you clicked.

## 8. Uninstalling

1. Stop the tool (Ctrl+C).
2. Delete the repository folder (`C:\vdo` or `~/vdo`). This also deletes its screenshots and settings.
3. Optionally drop the database:

   ```bash
   psql -U postgres -c "DROP DATABASE player_validator;"
   ```

4. Uninstall PostgreSQL, Node.js, Git and Chrome only if nothing else needs them.
