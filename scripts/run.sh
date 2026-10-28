#!/usr/bin/env bash
# Start the application for local use (run scripts/setup.sh first):
#   backend   FastAPI on http://127.0.0.1:8000  (settings from backend/.env)
#   frontend  Vite dev server on http://localhost:5173, which forwards /api to the backend
# Ctrl+C stops both. For the production-style stack use: docker compose up --build (port 8080).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VENV="${VENV:-$ROOT/.venv}"
[ -x "$VENV/bin/uvicorn" ] || { echo "no virtualenv at $VENV: run scripts/setup.sh first" >&2; exit 1; }
[ -x engine/symtab_analyze ] || make -C engine symtab_analyze

if [ -f backend/.env ]; then
  set -a
  # shellcheck disable=SC1091
  . backend/.env
  set +a
fi

(cd backend && exec "$VENV/bin/uvicorn" main:app --host 127.0.0.1 --port 8000) &
BACKEND=$!
trap 'kill $BACKEND 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 30); do
  curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1 && break
  sleep 0.5
done
echo "backend:  http://127.0.0.1:8000/health -> $(curl -fsS http://127.0.0.1:8000/health 2>/dev/null || echo 'not responding')"
echo "frontend: http://localhost:5173  (switch the header to 'Live Backend' to analyze your own code)"
npm --prefix frontend run dev
