#!/bin/sh
# Build the Uno benchmark for the PC (firmware/tools/host_bench.c) once per
# structure, under AddressSanitizer/UBSan, run every command and fail if any
# result row reports a failed verification. Byte counts differ from the board.
#   sh firmware/tools/host_test.sh
set -eu
cd "$(dirname "$0")/../.."
SRC=firmware/uno_bench/src
OUT=${OUT:-$(mktemp -d)}
CF="-std=c11 -O1 -g -Wall -Wextra -Werror -pedantic -fsanitize=address,undefined -fno-sanitize-recover=all"
fail=0
for v in 0 1 2 3 4 5 6 7; do
    gcc $CF -DBENCH_VARIANT=$v -I $SRC firmware/tools/host_bench.c $SRC/bench.c $SRC/variant_*.c \
        -o "$OUT/host_bench_$v"
    printf 'PING\nINFO\nMEM\nTIME\nCAP\nSAVE 0\nLOAD\nSAVE 1\nLOAD\n' | "$OUT/host_bench_$v" > "$OUT/out_$v.txt"
    # verify_ok is the last field of TIME, CAP and LOAD rows; MEM rows end
    # verify_ok, heap_after_destroy (must be 0: destroy() frees everything)
    bad=$(grep -E '^CSV,(MEM|TIME|CAP|LOAD),' "$OUT/out_$v.txt" |
          awk -F, '($2 == "MEM" && ($(NF-1) != 1 || $NF != 0)) || ($2 != "MEM" && $NF != 1)' || true)
    rows=$(grep -c '^CSV,' "$OUT/out_$v.txt")
    if [ -n "$bad" ]; then echo "variant $v: FAILED"; echo "$bad"; fail=1; else echo "variant $v: ok ($rows rows)"; fi
done
exit $fail
