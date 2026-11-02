#!/usr/bin/env bash
# One-time setup on a fresh Linux, macOS or WSL machine:
#   1. check the required tools and their versions
#   2. build the C engine (analyzer, the seven variants, the syntax-table engine)
#   3. install the backend's Python packages into a virtual environment
#   4. install the frontend's npm packages (exact versions from package-lock.json)
#   5. create backend/.env from the template if it does not exist yet
#
#   bash scripts/setup.sh            # VENV=/path/to/venv to put the virtualenv elsewhere
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VENV="${VENV:-$ROOT/.venv}"

step() { printf '\n== %s ==\n' "$*"; }
fail() { printf 'setup: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "'$1' not found: install $2"; }

step "Checking tools"
need gcc     "GCC 11 or newer (Debian/Ubuntu: sudo apt install build-essential)"
need make    "GNU make (part of build-essential)"
need python3 "Python 3.10 or newer"
need node    "Node.js 20.19+ or 22.12+ (https://nodejs.org)"
need npm     "npm 10+ (comes with Node.js)"
python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' \
  || fail "Python 3.10+ is required (found $(python3 --version 2>&1))"
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit((a===20&&b>=19)||(a===22&&b>=12)||a>=23?0:1)' \
  || fail "Node.js 20.19+ or 22.12+ is required by Vite 8 (found $(node --version))"
python3 -c 'import venv, ensurepip' 2>/dev/null \
  || fail "Python's venv module is missing (Debian/Ubuntu: sudo apt install python3-venv)"
echo "gcc $(gcc -dumpfullversion), $(python3 --version), node $(node --version), npm $(npm --version)"

step "Building the C engine"
make -C engine all
make -C engine syntax_bench

step "Installing backend packages into $VENV"
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install --quiet --upgrade pip
"$VENV/bin/python" -m pip install --quiet -r backend/requirements-lock.txt   # exact, tested versions
"$VENV/bin/python" -m pip list --format=freeze | grep -iE '^(fastapi|uvicorn|pytest|httpx|pyserial)=' || true

step "Installing frontend packages (npm ci)"
npm ci --prefix frontend --no-audit --no-fund

step "Configuration"
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo "created backend/.env from backend/.env.example (defaults work as they are)"
else
  echo "backend/.env already exists, left unchanged"
fi

step "Done"
echo "next: bash scripts/test.sh     (all test suites)"
echo "      bash scripts/run.sh      (web app on http://localhost:5173)"
