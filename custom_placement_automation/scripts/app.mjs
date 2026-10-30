#!/usr/bin/env node
// One command to update, set up, build and start the placement automation tool:
//   npm run app                      (from the repository root or from custom_placement_automation)
//   npm run app -- --branch <name>   switch to another branch first
//   npm run app -- --no-update       start the version you already have
//   npm run app -- --setup           change the PostgreSQL settings
//   npm run app -- --no-open         do not open the browser
// Uses only Node's built-in modules, so it runs before anything is installed.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appDir, '..');
const serverDir = path.join(appDir, 'server');
const clientDir = path.join(appDir, 'client');
const envFile = path.join(serverDir, '.env');
const stateFile = path.join(appDir, '.app-state.json');
const isWindows = process.platform === 'win32';
const MIN_NODE = 22;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const color = (code) => (text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = color('1');
const green = color('32');
const yellow = color('33');
const red = color('31');
const step = (text) => console.log(`\n${bold('▸')} ${text}`);
const ok = (text) => console.log(`  ${green('✓')} ${text}`);
const warn = (text) => console.log(`  ${yellow('!')} ${text}`);
class Stop extends Error {}
const stop = (text) => { throw new Stop(text); };

// --- helpers ---------------------------------------------------------------------------------------------

function run(command, commandArgs, { cwd = appDir, quiet = false, env, shell = isWindows } = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: quiet ? 'pipe' : 'inherit',
    shell, // npm, pnpm and npx are .cmd files on Windows
    encoding: 'utf8',
    env: env ? { ...process.env, ...env } : process.env,
  });
  return { ok: result.status === 0, out: (result.stdout ?? '').trim(), err: (result.stderr ?? '').trim() };
}

// git is a real executable on every system, so no shell (cmd would expand the % in --format).
const git = (...gitArgs) => run('git', gitArgs, { cwd: repoRoot, quiet: true, shell: false });

function hashFiles(paths) {
  const hash = crypto.createHash('sha256');
  const visit = (target) => {
    if (!fs.existsSync(target)) return;
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(target).sort()) {
        if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
        visit(path.join(target, name));
      }
    } else {
      hash.update(path.relative(repoRoot, target));
      hash.update(fs.readFileSync(target));
    }
  };
  for (const target of paths) visit(target);
  return hash.digest('hex');
}

const readState = () => {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; }
};
const state = readState();
const saveState = () => fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

// Runs `task` only when the hash of its inputs changed since the last successful run (or `force`).
function whenChanged(key, inputs, { force = false } = {}, task) {
  const hash = hashFiles(inputs);
  if (!force && state[key] === hash) return false;
  task();
  state[key] = hash;
  saveState();
  return true;
}

let pnpmCommand = null;
function pnpm(pnpmArgs, options) {
  if (!pnpmCommand) {
    pnpmCommand = run('pnpm', ['--version'], { quiet: true }).ok ? ['pnpm'] : ['npx', '--yes', 'pnpm@10'];
  }
  const [command, ...prefix] = pnpmCommand;
  return run(command, [...prefix, ...pnpmArgs], { cwd: repoRoot, ...options });
}

// --- steps -----------------------------------------------------------------------------------------------

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE) stop(`Node.js ${process.versions.node} is too old. Install Node.js ${MIN_NODE} or newer (24 LTS recommended) from https://nodejs.org and run this again.`);
  ok(`Node.js ${process.versions.node}`);
}

// Fast-forwards the current branch to GitHub's version. Never merges, rebases or overwrites local edits.
// Returns true when the code changed, so the launcher can restart itself with the new version.
function update() {
  if (!fs.existsSync(path.join(repoRoot, '.git')) || !git('--version').ok) {
    warn('Not a git checkout (or git is not installed), so no update check.');
    return false;
  }
  const dirty = git('status', '--porcelain', '--untracked-files=no').out;
  const wanted = option('--branch');
  if (wanted) {
    const current = git('rev-parse', '--abbrev-ref', 'HEAD').out;
    if (wanted !== current) {
      if (dirty) stop(`You have local changes, so the tool cannot switch to "${wanted}". Undo them (git restore .) or commit them, then try again.`);
      if (!git('fetch', '--quiet', 'origin', wanted).ok) stop(`Branch "${wanted}" was not found on GitHub (or GitHub is unreachable).`);
      const switched = git('rev-parse', '--verify', '--quiet', `refs/heads/${wanted}`).ok
        ? git('switch', wanted)
        : git('switch', '--track', `origin/${wanted}`);
      if (!switched.ok) stop(`Could not switch to "${wanted}": ${switched.err}`);
      ok(`Switched to branch ${wanted}`);
    }
  }
  if (flag('--no-update')) {
    warn('Update check skipped (--no-update).');
    return false;
  }
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').out;
  const upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
  if (!upstream.ok) {
    warn(`Branch "${branch}" does not follow a GitHub branch, so no update check.`);
    return false;
  }
  if (!git('fetch', '--quiet').ok) {
    warn('GitHub could not be reached; starting the version you already have.');
    return false;
  }
  const [ahead, behind] = git('rev-list', '--left-right', '--count', `HEAD...${upstream.out}`).out.split(/\s+/).map(Number);
  if (!behind) {
    ok(`Up to date (${branch})`);
    return false;
  }
  if (dirty) {
    warn(`An update is available, but files were changed on this computer, so it was not applied. Undo the changes (git restore .) to get updates.`);
    return false;
  }
  if (ahead) {
    warn(`An update is available, but this copy has its own commits on "${branch}", so it was not applied automatically.`);
    return false;
  }
  const before = git('rev-parse', '--short', 'HEAD').out;
  const merged = git('merge', '--ff-only', upstream.out);
  if (!merged.ok) {
    warn(`The update could not be applied: ${merged.err.split('\n')[0]}`);
    return false;
  }
  ok(`Updated ${branch}: ${before} → ${git('rev-parse', '--short', 'HEAD').out} (${behind} new change${behind === 1 ? '' : 's'})`);
  return true;
}

function installDependencies() {
  const rootChanged = whenChanged('rootDeps', [path.join(repoRoot, 'package.json'), path.join(repoRoot, 'pnpm-lock.yaml')], { force: !fs.existsSync(path.join(repoRoot, 'node_modules')) }, () => {
    console.log('  Installing the deep test engine packages (first run or after an update)…');
    if (!pnpm(['install', '--frozen-lockfile']).ok) stop('Installing the deep test engine packages failed (see the messages above).');
  });
  ok(rootChanged ? 'Deep test engine packages installed' : 'Deep test engine packages up to date');

  const appInputs = ['package.json', 'package-lock.json', 'server/package.json', 'server/package-lock.json', 'client/package.json', 'client/package-lock.json'].map((file) => path.join(appDir, file));
  const missing = ['node_modules', 'server/node_modules', 'client/node_modules'].some((dir) => !fs.existsSync(path.join(appDir, dir)));
  const appChanged = whenChanged('appDeps', appInputs, { force: missing }, () => {
    console.log('  Installing the app packages (first run or after an update)…');
    // Each part separately (no postinstall chain), so a failed browser download cannot stop the install.
    // `npm ci` installs exactly what the lockfile says and never rewrites it, so git stays clean and updates keep applying.
    for (const dir of [appDir, serverDir, clientDir]) {
      const where = path.relative(repoRoot, dir) || '.';
      if (run('npm', ['ci', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd: dir }).ok) continue;
      warn(`The lockfile in ${where} does not match package.json; installing without changing it.`);
      if (!run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--no-package-lock'], { cwd: dir }).ok) stop(`Installing the packages in ${where} failed (see the messages above).`);
    }
    // Playwright's Chromium; when it cannot be downloaded, Google Chrome is used if installed (BROWSER_CHANNEL=auto).
    if (!run('npm', ['run', 'browsers:install'], { cwd: serverDir }).ok) {
      warn('Playwright\'s Chromium could not be downloaded. The tool will use Google Chrome if it is installed; otherwise run "npm --prefix custom_placement_automation/server run browsers:install" later.');
    }
  });
  ok(appChanged ? 'App packages installed' : 'App packages up to date');
}

function buildEngine() {
  const engine = path.join(repoRoot, 'dist', 'src', 'deep', 'index.js');
  const inputs = ['src', 'tests', 'tsconfig.json', 'package.json'].map((file) => path.join(repoRoot, file));
  const built = whenChanged('engine', inputs, { force: !fs.existsSync(engine) }, () => {
    console.log('  Building the 23-case deep test engine…');
    if (!pnpm(['exec', 'tsc', '-p', 'tsconfig.json']).ok) stop('Building the deep test engine failed (see the messages above).');
  });
  ok(built ? 'Deep test engine built' : 'Deep test engine up to date');
}

function buildDashboard() {
  const inputs = ['src', 'public', 'index.html', 'vite.config.js', 'package.json'].map((file) => path.join(clientDir, file));
  const built = whenChanged('dashboard', inputs, { force: !fs.existsSync(path.join(clientDir, 'dist', 'index.html')) }, () => {
    console.log('  Building the dashboard…');
    if (!run('npm', ['run', 'build'], { cwd: clientDir }).ok) stop('Building the dashboard failed (see the messages above).');
  });
  ok(built ? 'Dashboard built' : 'Dashboard up to date');
}

const readEnv = () => (fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '');
const envValue = (text, name) => text.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();

async function ask(question, fallback) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`  ${question}${fallback ? ` [${fallback}]` : ''}: `);
    return answer.trim() || fallback;
  } finally {
    rl.close();
  }
}

// Reads a password without showing it (one * per character).
function askSecret(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(`  ${question}: `);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    let value = '';
    const done = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      resolve(value);
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n' || char === '\u0004') return done();
        if (char === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (char === '\u007f' || char === '\b') {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        value += char;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

// First run (or --setup): ask for the PostgreSQL connection and write server/.env from .env.example.
async function settings() {
  const existing = readEnv();
  if (existing && !flag('--setup') && envValue(existing, 'DATABASE_URL') && !envValue(existing, 'DATABASE_URL').includes('REPLACE_ME')) {
    ok('Settings found (server/.env)');
    return;
  }
  if (!process.stdin.isTTY) stop('server/.env is missing. Run "npm run app" in a terminal once so it can ask for the PostgreSQL settings.');
  console.log('  The tool keeps its results in PostgreSQL. Enter the details of your local PostgreSQL (press Enter to keep the value in brackets).');
  let current = {};
  try {
    const url = new URL(envValue(existing, 'DATABASE_URL') ?? '');
    current = { host: url.hostname, port: url.port, user: decodeURIComponent(url.username), database: url.pathname.slice(1) };
  } catch { /* first run */ }
  {
    const host = await ask('PostgreSQL host', current.host || '127.0.0.1');
    const port = await ask('PostgreSQL port (5432 unless several versions are installed)', current.port || '5432');
    const user = await ask('PostgreSQL user', current.user || 'postgres');
    const password = await askSecret(`Password for "${user}" (hidden)`);
    const database = await ask('Database name (created if missing)', current.database || 'player_validator');
    const url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
    const template = existing || fs.readFileSync(path.join(serverDir, '.env.example'), 'utf8');
    const text = /^DATABASE_URL=.*$/m.test(template) ? template.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${url}`) : `${template}\nDATABASE_URL=${url}\n`;
    fs.writeFileSync(envFile, text);
    ok('Settings saved to server/.env');
  }
}

// Connects to PostgreSQL and creates the database when it does not exist yet.
async function database() {
  const url = envValue(readEnv(), 'DATABASE_URL');
  const { Client } = createRequire(path.join(serverDir, 'package.json'))('pg');
  const connect = async (target) => {
    const client = new Client({ connectionString: target, connectionTimeoutMillis: 8000 });
    await client.connect();
    return client;
  };
  try {
    const client = await connect(url);
    await client.end();
    ok('PostgreSQL connected');
  } catch (error) {
    if (error.code === '3D000') {
      const name = new URL(url).pathname.slice(1);
      const admin = new URL(url);
      admin.pathname = '/postgres';
      const client = await connect(admin.toString());
      await client.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
      await client.end();
      ok(`Database "${name}" created`);
      return;
    }
    const where = (() => { try { const u = new URL(url); return `${u.hostname}:${u.port || 5432}`; } catch { return 'the configured address'; } })();
    if (error.code === '28P01') stop(`PostgreSQL rejected the password. Run "npm run app -- --setup" and enter the right password.`);
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') stop(`PostgreSQL is not running at ${where}. Start the PostgreSQL service (or run "npm run app -- --setup" to change the port), then try again.`);
    stop(`Could not connect to PostgreSQL at ${where}: ${error.message}`);
  }
}

function versionLabel() {
  if (!git('--version').ok) return '';
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').out;
  const info = git('log', '-1', '--format=%h · %cs').out;
  return branch && info ? `${branch} · ${info}` : '';
}

function openBrowser(url) {
  if (flag('--no-open') || !process.stdout.isTTY) return;
  const [command, commandArgs] = isWindows ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(command, commandArgs, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

async function waitForServer(url, child) {
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null) return false;
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return true;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function start() {
  const port = Number(envValue(readEnv(), 'PORT')) || 3000;
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: serverDir, stdio: 'inherit', env: { ...process.env, APP_VERSION: versionLabel() } });
  const forward = (signal) => () => child.kill(signal);
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));
  waitForServer(url, child).then((up) => {
    if (!up) return;
    console.log(`\n${green(bold('Ready:'))} open ${bold(url)} in your browser. Press Ctrl+C here to stop the tool.\n`);
    openBrowser(url);
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

// --- main ------------------------------------------------------------------------------------------------

async function main() {
  console.log(bold('VDO.ai placement automation'));
  step('Checking requirements');
  checkNode();

  if (!flag('--restarted')) {
    step('Checking for updates');
    if (update()) {
      // The launcher itself may have changed with the update: restart with the new version.
      const again = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args.filter((a) => a !== '--branch' && a !== option('--branch')), '--restarted', '--no-update'], { stdio: 'inherit' });
      process.exit(again.status ?? 0);
    }
  }

  // Questions first, so you can leave the long first install running on its own.
  step('Settings');
  await settings();
  step('Installing packages (only when something changed)');
  installDependencies();
  step('Building (only when something changed)');
  buildEngine();
  buildDashboard();
  step('Database');
  await database();
  step('Starting');
  start();
}

main().catch((error) => {
  console.error(`\n${red('✗')} ${error instanceof Stop ? error.message : error.stack ?? error.message}`);
  process.exit(1);
});
