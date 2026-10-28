#!/usr/bin/env bash
# Regenerate the paper's results from source and check them against the committed ones.
# Everything is written to results/regenerated/ (git-ignored); committed files are never overwritten.
#
#   bash scripts/reproduce_results.sh            # prototype, 7 variants, memory sweep, API example, speed
#   bash scripts/reproduce_results.sh --corpus   # also download the real-C corpus and re-measure it
#
# Memory results are deterministic and must match byte for byte. Speed (ns per operation)
# depends on the machine, so bench_results.csv is regenerated but not compared.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OUT="$ROOT/results/regenerated"
SAMPLES="$ROOT/results/sample_outputs"
mkdir -p "$OUT"
status=0

step() { printf '\n== %s ==\n' "$*"; }
same() {   # same NEW REFERENCE LABEL  (line endings ignored: Windows checkouts may add CR)
  if [ -f "$2" ] && diff -q <(tr -d '\r' < "$1") <(tr -d '\r' < "$2") >/dev/null; then
    echo "MATCH     $3"
  else
    echo "DIFFERENT $3 (diff $1 $2)"; status=1
  fi
}

step "Building"
make -s --no-print-directory -C engine all
gcc -std=c11 -O2 -Wall -Wextra -Werror -pedantic engine/symtab_demo.c -o "$OUT/symtab_demo"

step "Prototype: 30 identifiers (paper Table 4, Figure 4)"
"$OUT/symtab_demo" > "$OUT/symtab_demo.txt"
same "$OUT/symtab_demo.txt" "$SAMPLES/symtab_demo.txt" "symtab_demo output"

step "Ablation: the seven variants on the same 30 identifiers (Table 5, Figure 5)"
make -s --no-print-directory -C engine run > "$OUT/variants.txt"
same "$OUT/variants.txt" "$SAMPLES/variants.txt" "variant outputs"

step "Scaling sweep: n = 10..1000, three naming patterns (Table 6, Figure 6)"
OUT="$OUT/results.csv" sh engine/run_sweep.sh > "$OUT/sweep_table.txt"
same "$OUT/results.csv" engine/results.csv "engine/results.csv (168 rows)"

step "API example: the 4-declaration program from the README"
printf 'int sensor_temp; int sensor_press; void system_init() { int local_val; }\n' \
  | engine/symtab_analyze > "$OUT/analyze_example.json"
same "$OUT/analyze_example.json" "$SAMPLES/analyze_example.json" "analyzer JSON"

step "Speed benchmark (machine-dependent, not compared)"
gcc -std=c11 -O2 -Wall -Wextra -Werror -pedantic -DSYMTAB_NO_MAIN -o "$OUT/symtab_bench" \
  engine/symtab_bench.c engine/variant_*.c
"$OUT/symtab_bench" > "$OUT/bench_results.csv"
echo "wrote $OUT/bench_results.csv ($(wc -l < "$OUT/bench_results.csv") rows); published: engine/bench_results.csv"

if [ "${1:-}" = "--corpus" ]; then
  step "Real C corpus: download, verify and measure (Tables 7 and 8, Figure 7)"
  python3 datasets/fetch_corpus.py
  python3 engine/real_corpus.py --out "$OUT/real_corpus.csv" \
    sqlite-ext=datasets/corpus/sqlite-ext readline=datasets/corpus/readline xz=datasets/corpus/xz \
    mpfr=datasets/corpus/mpfr symtab-engine=datasets/corpus/symtab-engine > "$OUT/real_corpus_summary.txt"
  python3 datasets/check_raw.py "$OUT/real_corpus.csv" || status=1
fi

step "Summary"
if [ $status -eq 0 ]; then echo "every deterministic result matches the committed one"; else echo "some results differ (see above)"; fi
exit $status
