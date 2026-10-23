# Windows installation, step by step

This guide installs Placement Automation, including the optional 23-case **deep test**, on Windows using PowerShell and PostgreSQL 18. Every step ends with a ✅ check; do not move on until it matches.

Run every command in **PowerShell** (not Command Prompt). `bash setup.sh` does not work in PowerShell, so the steps below replace it.

## Part 1: Install the software (once)

| # | Install | Where | During install |
|---|---|---|---|
| 1 | **Git** | https://git-scm.com/download/win | Keep the defaults |
| 2 | **Node.js LTS** (v20 or newer; v22/v24 recommended) | https://nodejs.org | Keep the defaults |
| 3 | **PostgreSQL 18** | https://www.postgresql.org/download/windows/ | **Write down the password** for the `postgres` user and the **port** the installer offers |

If other PostgreSQL versions (for example 14, 15, 17) are already installed, ports 5432–5434 are usually taken and the 18 installer suggests the next free one (often **5435**). Keep it and note it. Each version has its own password.

Close and reopen PowerShell after installing.

✅ **Check**

```powershell
git --version
node -v
npm -v
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" --version
```

`node -v` must be **v20 or higher**. `psql` must report **18**.

## Part 2: Download the code

Use a short folder such as `C:\vdo`. Long Windows paths fail with "Filename too long", and cloning inside another copy of the repository makes paths too long.

```powershell
git config --global core.longpaths true
git clone -b custom-placement-automation https://github.com/chetanya1998/VDO.ai-Automated-Player-Testing-APT--Tool.git C:\vdo
cd C:\vdo
```

✅ **Check**

```powershell
git branch --show-current
git status
```

Shows `custom-placement-automation` and "working tree clean".

## Part 3: Install the placement app (server, dashboard, Chromium)

```powershell
cd C:\vdo\custom_placement_automation
npm install
```

This takes a few minutes. Warnings such as "Unknown env config", "update available" or "vulnerabilities" do not stop the app. Do **not** run `npm audit fix --force`; it can install breaking versions.

✅ **Check**

```powershell
Test-Path .\server\node_modules
Test-Path .\client\node_modules
```

Both print `True`.

## Part 4: Build the 23-case deep test engine

The engine is built from the **repository root** (`C:\vdo`), not from `custom_placement_automation`. Running `pnpm build` in the wrong folder fails with `Command "build" not found`.

```powershell
cd C:\vdo
npx --yes pnpm@10.28.0 install --frozen-lockfile
npx --yes pnpm@10.28.0 build
```

A warning that the repository wants Node 24 is fine.

✅ **Check**

```powershell
Test-Path C:\vdo\dist\src\deep\index.js
```

Prints `True`. If a stray `pnpm-lock.yaml` appeared in `custom_placement_automation`, delete it: `Remove-Item C:\vdo\custom_placement_automation\pnpm-lock.yaml -ErrorAction SilentlyContinue`.

## Part 5: Prepare PostgreSQL 18

### 5.1 Make sure the service is running

```powershell
Get-Service postgresql*
```

`postgresql-x64-18` must show **Running**. If not:

```powershell
Start-Service postgresql-x64-18
```

### 5.2 Find its port

```powershell
Select-String -Path "C:\Program Files\PostgreSQL\18\data\postgresql.conf" -Pattern "^port"
```

Note the number (for example `port = 5435`). If you get "access denied", run PowerShell as Administrator. The commands below use `5435`; replace it with your port.

### 5.3 Connect and create the database

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -p 5435 -c "SELECT version();"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -p 5435 -c "CREATE DATABASE player_validator;"
```

Enter the **PostgreSQL 18** password when asked.

✅ **Check**: the first command mentions **PostgreSQL 18**; the second prints `CREATE DATABASE` (or "already exists", which is fine).

The app creates its own `custom_placement` schema and tables on first start; no other database setup is needed.

## Part 6: Settings file

```powershell
cd C:\vdo\custom_placement_automation
Copy-Item .\server\.env.example .\server\.env
notepad .\server\.env
```

Edit the `DATABASE_URL` line with the PostgreSQL 18 password and port, then save:

```
DATABASE_URL=postgresql://postgres:YOUR_PG18_PASSWORD@127.0.0.1:5435/player_validator
```

If the password contains special characters, encode them: `@` → `%40`, `#` → `%23`, `/` → `%2F`, `:` → `%3A`, `%` → `%25`, space → `%20`.

Other settings in `server\.env` (optional):

| Setting | Default | Meaning |
|---|---|---|
| `HEADLESS` | `false` | `false` shows the test browser window so you can watch; `true` hides it |
| `DEEP_OBSERVE_MS` | `15000` | How long each deep test watches the page |
| `DEEP_URL_TIMEOUT_MS` | `90000` | Maximum time for one deep test |
| `DEEP_ALLOW_PRIVATE_NETWORK` | `false` | Set `true` only to deep-test internal staging servers |

✅ **Check**

```powershell
Select-String DATABASE_URL .\server\.env
```

The line no longer contains `REPLACE_ME` and shows your port.

## Part 7: Start the app

```powershell
cd C:\vdo\custom_placement_automation
npm start
```

Keep this window open; **Ctrl+C** stops the app.

✅ **Check 1**: the terminal shows `Server running on http://127.0.0.1:3000` and no red errors.

✅ **Check 2**: http://127.0.0.1:3000/api/ready shows `"ready":true`, `"database":true`, `"launchable":true` and `"deep":{"available":true}`.

✅ **Check 3**: http://localhost:5173 shows all five status boxes green: **API, Database, Chromium, Deep test engine, Queue**.

## Part 8: Safe first test (no vdo.ai tag involved)

1. **What to test**: CSS check → Paste code → `body { }`
2. **Target site**: domain `example.com`, tag `v-example`, URL `https://example.com/`
3. **Run settings**: Desktop only
4. **Test depth**: deep **off** → **Run check**

✅ **Check**: a Chromium window opens and closes, the result is **FAIL · Wrapper div not found** (expected, example.com has no vdo.ai player), the run appears in **Recent runs**, and **PDF** downloads a report.

Then press **Re-run**, turn the **deep test on** and run again.

✅ **Check**: the URL now has a **Deep test** block with 23 case tiles. Most are Fail or Unknown on example.com; what matters is that the block appears.

## Part 9: Testing a live tag (be careful)

Each run on a live site sends **real** logger events, analytics hits and ad requests. Your uploaded `vdo.ai.js` is swapped in only inside the test browser; the live tag and the vdo.ai server are not changed.

1. **What to test**: Custom placement → upload or paste the `vdo.ai.js`
2. **Target site**: the publisher domain, the tag name and the article URL(s)
3. **Run settings**: Desktop first; Mobile only if needed
4. **Test depth**: deep **on** → **Run check**
5. Open the run in **Recent runs** → **PDF** for the report

Keep the number of URLs and repeats to a minimum.

What to expect:

- The placement check passes only if the custom code fires `vdo:placement` (see README). Without it the result is **"No vdo:placement event"**.
- The deep block shows Pass/Fail per case with the reason. Cases whose rules need a confirmed policy show **Unknown** while the repository policies are drafts; click a tile to see why.

## Troubleshooting

| What you see | Fix |
|---|---|
| `bash : The term 'bash' is not recognized` | Expected in PowerShell; follow Parts 3–7 instead of `setup.sh` |
| `Filename too long` while cloning | Part 2: `git config --global core.longpaths true`, clone into `C:\vdo`, never inside another clone |
| `Command "build" not found` | Run Part 4 from `C:\vdo`, not `custom_placement_automation` |
| Database box red / `password authentication failed` | Use the **PostgreSQL 18** password in `server\.env` |
| `connection refused` / `ECONNREFUSED` | Wrong port in `server\.env`, or the 18 service is stopped (Part 5.1) |
| `database "player_validator" does not exist` | Redo Part 5.3 on the same port as in `server\.env` |
| Chromium box red | `cd C:\vdo\custom_placement_automation\server` then `npx playwright install chromium` |
| Deep test engine box amber | Redo Part 4 |
| `Port 3000 is already in use` | Close the other program or old `npm start` window |
| `Another placement server already owns this database schema` | Another `npm start` is still running; close it |
| A URL shows **Page blocked** | The site blocked the automated browser; try another URL |

## Updating later

```powershell
cd C:\vdo
git pull
cd .\custom_placement_automation
npm install
cd ..
npx --yes pnpm@10.28.0 install --frozen-lockfile
npx --yes pnpm@10.28.0 build
```

Then start again with `npm start` from `custom_placement_automation`.
