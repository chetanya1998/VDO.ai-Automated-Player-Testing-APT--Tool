#!/usr/bin/env bash
# Installs everything Placement Automation needs, then starts it.
#
#   bash setup.sh             install/update what's missing, then start the app
#   bash setup.sh --no-start  install only
#   npm run setup             same as "bash setup.sh" (needs npm to be present)
#
# Steps: Node.js (via nvm if missing or too old) -> project dependencies
# (root, server, client) -> Playwright Chromium -> Chromium system libraries
# (Linux) -> server/.env -> start.

set -euo pipefail

REQUIRED_NODE_MAJOR=20
NVM_VERSION="v0.40.3"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START_APP=true

for arg in "$@"; do
  case "$arg" in
    --no-start) START_APP=false ;;
    -h | --help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok() { printf '\033[32m  ✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$*"; }
fail() {
  printf '\033[31m  ✖ %s\033[0m\n' "$*" >&2
  exit 1
}

case "$(uname -s)" in
  Linux*) OS=linux ;;
  Darwin*) OS=mac ;;
  MINGW* | MSYS* | CYGWIN*) OS=windows ;;
  *) OS=other ;;
esac

node_major() {
  command -v node >/dev/null 2>&1 || {
    echo 0
    return
  }
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

load_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  command -v nvm >/dev/null 2>&1
}

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$1"
  else
    fail "Neither curl nor wget is installed. Install one of them and run this script again."
  fi
}

# ---------------------------------------------------------------------------
step "Checking Node.js (need v${REQUIRED_NODE_MAJOR}+)"

current_major="$(node_major)"
if [ "$current_major" -ge "$REQUIRED_NODE_MAJOR" ]; then
  ok "Node $(node -v) found"
else
  if [ "$current_major" -eq 0 ]; then
    warn "Node.js is not installed"
  else
    warn "Node $(node -v) is too old"
  fi

  if [ "$OS" = windows ]; then
    fail "Install Node.js ${REQUIRED_NODE_MAJOR}+ from https://nodejs.org (or nvm-windows), open a new terminal and run this again."
  fi

  if load_nvm; then
    ok "nvm $(nvm --version) found"
  else
    step "Installing nvm ${NVM_VERSION}"
    download "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash
    load_nvm || fail "nvm was installed but couldn't be loaded. Open a new terminal and run this script again."
    ok "nvm $(nvm --version) installed"
  fi

  step "Installing the latest Node.js LTS with nvm"
  nvm install --lts
  nvm alias default 'lts/*' >/dev/null
  nvm use default >/dev/null
  hash -r
  [ "$(node_major)" -ge "$REQUIRED_NODE_MAJOR" ] || fail "Node installation didn't succeed."
  ok "Using Node $(node -v) (set as nvm default; new terminals will use it)"
fi

command -v npm >/dev/null 2>&1 || fail "npm is missing even though Node is installed. Reinstall Node.js."
ok "npm $(npm -v)"

# ---------------------------------------------------------------------------
step "Installing project dependencies (root, server, client, Chromium)"
cd "$ROOT_DIR"
npm install --no-fund --no-audit
ok "Root, server and client dependencies installed"

step "Making sure Playwright's Chromium is installed"
npm --prefix server run browsers:install
ok "Chromium ready"

# ---------------------------------------------------------------------------
# The optional deep test (all 23 cases) uses the validator compiled in the repository root.
step "Building the deep test engine (23 cases)"
REPO_DIR="$(cd "$ROOT_DIR/.." && pwd)"
if [ -f "$REPO_DIR/package.json" ] && [ -f "$REPO_DIR/tsconfig.json" ]; then
  if (cd "$REPO_DIR" && npx --yes pnpm@10.28.0 install --frozen-lockfile --config.engine-strict=false && npx --yes pnpm@10.28.0 exec tsc -p tsconfig.json); then
    ok "Deep test engine built"
  else
    warn "Couldn't build the deep test engine. Placement checks still work."
    warn "  To enable deep tests later run: cd \"$REPO_DIR\" && pnpm install && pnpm build"
  fi
else
  warn "Repository root not found; deep tests stay unavailable."
fi

# ---------------------------------------------------------------------------
if [ "$OS" = linux ]; then
  step "Checking Chromium's system libraries"
  chromium_path="$(cd "$ROOT_DIR/server" && node -e "import('playwright').then((p) => console.log(p.chromium.executablePath()))" 2>/dev/null || true)"

  if [ -n "$chromium_path" ] && [ -x "$chromium_path" ] && command -v ldd >/dev/null 2>&1; then
    missing="$(ldd "$chromium_path" 2>/dev/null | grep 'not found' || true)"
    if [ -z "$missing" ]; then
      ok "All system libraries present"
    else
      warn "Missing libraries:"
      echo "$missing" | sed 's/^/      /'
      if command -v sudo >/dev/null 2>&1 && [ -t 0 ]; then
        bold "  Installing them needs sudo (you may be asked for your password)."
        (cd "$ROOT_DIR/server" && sudo npx playwright install-deps chromium)
        ok "System libraries installed"
      else
        warn "Run this once with admin rights, then start the app:"
        warn "  cd server && sudo npx playwright install-deps chromium"
      fi
    fi
  else
    warn "Couldn't inspect Chromium; if checks fail with missing .so files run:"
    warn "  cd server && sudo npx playwright install-deps chromium"
  fi
fi

# ---------------------------------------------------------------------------
step "Configuration"
if [ -f "$ROOT_DIR/server/.env" ]; then
  ok "server/.env already exists (left unchanged)"
else
  cp "$ROOT_DIR/server/.env.example" "$ROOT_DIR/server/.env"
  ok "Created server/.env from .env.example"
fi

if [ "$OS" = linux ] && [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ] && grep -q '^HEADLESS=false' "$ROOT_DIR/server/.env"; then
  warn "No display detected but HEADLESS=false. On a machine without a screen,"
  warn "set HEADLESS=true in server/.env or the checks can't open a browser."
fi

# ---------------------------------------------------------------------------
if [ "$START_APP" = true ]; then
  step "Starting the app"
  bold "  UI:  http://localhost:5173"
  bold "  API: http://localhost:3000"
  bold "  Press Ctrl+C to stop."
  exec npm start
else
  step "Setup complete"
  bold "  Start the app with: npm start"
fi
