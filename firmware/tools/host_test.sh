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

    # Live session 1: 10 symbols, lookups, then save -> load -> lookup (baseline and ABC persist).
    # Live session 2: 80 symbols; the arena builds (2 4 6 7) must refuse part-way, then refuse the rest.
    {
        echo LIVE
        for i in $(seq 0 9); do printf 'SYM %d 0 1 %d sym_%03d\n' $((i % 4)) $((i * 4)) "$i"; done
        printf 'END\nLOOKUP sym_003\nLOOKUP nope_x\nSAVE\nLOAD\nLOOKUP sym_003\nLIVE\n'
        for i in $(seq 0 79); do printf 'SYM 0 0 1 %d sensor_value_%03d\n' $((i * 4)) "$i"; done
        echo END
    } | "$OUT/host_bench_$v" > "$OUT/live_$v.txt"
    case $v in 0|7) persist=1 ;; *) persist=0 ;; esac
    case $v in 2|4|6|7) arena=1 ;; *) arena=0 ;; esac
    live=$(awk -F, -v persist=$persist -v arena=$arena '
        $1 != "LIVE" { next }
        $2 == "READY" { session++; refused = 0 }
        $2 == "SYM" {
            if ($5 == "ok") { if ($10 != 1 || refused) err = err " bad_ok_row:" $4 }
            else { refused = 1; refusals[session]++; if ($10 != 0) err = err " verified_refusal:" $4 }
        }
        $2 == "LOOKUP" && $4 == "FOUND" { found++ }
        $2 == "LOOKUP" && $4 == "ABSENT" { absent++ }
        $2 == "LOADED" { loaded++ }
        $2 == "ERROR" && $3 != "no_persistence" && !($3 == "no_session" && !persist) { err = err " error:" $3 }
        END {
            if (found != 1 + persist) err = err " found=" found
            if (absent != 1) err = err " absent=" absent
            if (loaded != persist) err = err " loaded=" loaded
            if (refusals[1] > 0) err = err " session1_refused"
            if (arena && refusals[2] == 0) err = err " session2_never_refused"
            print err
        }' "$OUT/live_$v.txt")
    if [ -n "$live" ]; then echo "variant $v: LIVE FAILED:$live"; fail=1; else echo "variant $v: live session ok"; fi
done
exit $fail
