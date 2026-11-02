#!/bin/sh
# Build all 7 stress configurations, run the sweep, print the comparison table.
#   SEEDS="1 2 3" ./run_sweep.sh     # average over several symbol-set seeds
#   OUT=results.csv                  # raw rows (data, pattern, n, baseline_bytes, variant_bytes)
set -eu
cd "$(dirname "$0")"
CC=${CC:-gcc}
CFLAGS="-std=c11 -O2 -Wall -Wextra -Werror -pedantic"
SEEDS=${SEEDS:-1}
OUT=${OUT:-results.csv}

BUILD=${BUILD:-$(mktemp -d)}
trap 'rm -rf "$BUILD"' EXIT
: > "$OUT"
for entry in a:variant_a_bitpack.c b:variant_b_arena.c c:variant_c_trie.c \
             ab:variant_ab_arena_bitpack.c ac:variant_ac_trie_bitpack.c \
             bc:variant_bc_trie_arena.c abc:variant_abc_full.c; do
    cfg=${entry%%:*}
    src=${entry#*:}
    label=$(printf '%s' "$cfg" | tr 'a-z' 'A-Z')
    $CC $CFLAGS -DCFG="$cfg" -DCFG_LABEL="\"$label\"" -DVARIANT_SRC="\"$src\"" \
        -o "$BUILD/stress_$cfg" symtab_stress.c
    for seed in $SEEDS; do
        "$BUILD/stress_$cfg" "$seed" >> "$OUT"
    done
done
echo "wrote $(wc -l < "$OUT") rows to $OUT" >&2
python3 compare_table.py "$OUT"
