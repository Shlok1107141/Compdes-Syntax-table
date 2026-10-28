#!/usr/bin/env bash
# Every test suite the CI runs, in one command (run scripts/setup.sh first):
#   engine    the prototype, the stress program and the analyzer under AddressSanitizer + UBSan
#   firmware  the Arduino Uno benchmark logic on the PC under sanitizers (no board needed)
#   backend   the pytest suite (API, engine, hostile inputs, reproducibility of results.csv)
#   frontend  lint, type-check and production build
#
#   bash scripts/test.sh                 # all suites
#   bash scripts/test.sh engine backend  # only some
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VENV="${VENV:-$ROOT/.venv}"
SUITES=("$@")
[ ${#SUITES[@]} -gt 0 ] || SUITES=(engine firmware backend frontend)
export ASAN_OPTIONS="detect_leaks=1:abort_on_error=1"
export UBSAN_OPTIONS="halt_on_error=1:print_stacktrace=1"
SAN="-std=c11 -g -Wall -Wextra -Werror -pedantic -fsanitize=address,undefined"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

step() { printf '\n== %s ==\n' "$*"; }

for suite in "${SUITES[@]}"; do
  case "$suite" in
    engine)
      step "engine: prototype and stress program under sanitizers"
      gcc $SAN engine/symtab_demo.c -o "$TMP/symtab_demo"
      "$TMP/symtab_demo" | grep -E "Correctness|less memory"
      gcc $SAN engine/symtab_stress.c -o "$TMP/symtab_stress"
      "$TMP/symtab_stress" | tail -1
      step "engine: analyzer (links all eight structures) under sanitizers"
      make -C engine check
      ;;
    firmware)
      step "firmware: the Uno sketch's engine copy matches engine/"
      python3 firmware/tools/sync_engine.py --check
      step "firmware: benchmark logic for all 8 structures under sanitizers"
      sh firmware/tools/host_test.sh
      node_major=$(node -p 'process.versions.node.split(".")[0]')
      node_minor=$(node -p 'process.versions.node.split(".")[1]')
      if [ "$node_major" -gt 22 ] || { [ "$node_major" -eq 22 ] && [ "$node_minor" -ge 18 ]; }; then
        step "firmware: the website's Uno model reproduces every recorded board run"
        node frontend/scripts/check_uno_model.ts
      else
        echo "(skipping check_uno_model.ts: it needs Node 22.18+ to run TypeScript directly)"
      fi
      ;;
    backend)
      step "backend: pytest"
      [ -x "$VENV/bin/python" ] || { echo "no virtualenv at $VENV: run scripts/setup.sh" >&2; exit 1; }
      [ -x engine/syntax_bench ] || make -C engine syntax_bench
      (cd backend && "$VENV/bin/python" -m pytest -q --tb=short)
      ;;
    frontend)
      step "frontend: lint, type-check and build"
      npm --prefix frontend run lint
      npm --prefix frontend run build
      ;;
    *)
      echo "unknown suite '$suite' (engine, firmware, backend, frontend)" >&2
      exit 2
      ;;
  esac
done
step "all requested suites passed: ${SUITES[*]}"
