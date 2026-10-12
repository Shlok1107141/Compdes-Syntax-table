/*
 * symtab_bench.c -- how fast is each of the eight structures?
 * ------------------------------------------------------------
 * Memory is half the question; a compiler also inserts and looks up names
 * constantly, so a smaller table that is much slower would be a bad trade.
 * For each workload in symtab_workloads.h (the same identifier sets the
 * memory sweep uses) this times, per structure:
 *
 *   insert  building the table from empty, ns per declaration
 *   hit     looking up a stored name (finds its newest declaration), ns per lookup
 *   miss    looking up a name that is not stored, ns per lookup
 *
 * Each figure is the best of REPEATS timed runs -- the run least disturbed by
 * the OS -- and each run does enough operations to dwarf timer resolution.
 * Lookups go through absent(), the name search a compiler performs; verify()
 * is a test oracle that also matches metadata and is not timed.
 *
 * stdout carries only CSV rows:  pattern, n, structure, bytes, insert_ns, hit_ns, miss_ns
 *
 * build:  make bench    (gcc -std=c11 -O2 -DSYMTAB_NO_MAIN symtab_bench.c variant_*.c)
 */
#include <time.h>

#include "symtab_common.h"
#include "symtab_workloads.h"

#define REPEATS        5
#define INSERT_TARGET  100000     /* declarations inserted per timed run */
#define LOOKUP_TARGET  400000     /* lookups per timed run               */

static const struct { const char *label; const Impl *impl; } STRUCTURES[] = {
    { "baseline", &BASELINE_IMPL }, { "A", &a_impl },   { "B", &b_impl },   { "C", &c_impl },
    { "AB", &ab_impl },             { "AC", &ac_impl }, { "BC", &bc_impl }, { "ABC", &abc_impl },
};
#define NUM_STRUCTURES (sizeof STRUCTURES / sizeof STRUCTURES[0])

static volatile int sink;   /* keeps lookups from being optimised away */

static double now_ns(void) {
    struct timespec ts;
    timespec_get(&ts, TIME_UTC);
    return (double)ts.tv_sec * 1e9 + (double)ts.tv_nsec;
}

static int bench_one(int pattern, size_t n) {
    static TestSymbol syms[ST_MAX_N];
    static char names[ST_MAX_N][ST_NAME_LEN];
    static char missing[ST_MAX_N][ST_NAME_LEN + 2];

    st_generate(pattern, n, 1, syms, names);
    for (size_t i = 0; i < n; i++) {         /* '~' cannot appear in an identifier */
        size_t len = strlen(syms[i].name);
        memcpy(missing[i], syms[i].name, len);
        missing[i][len] = '~';
        missing[i][len + 1] = '\0';
    }

    size_t insert_rounds = INSERT_TARGET / n ? INSERT_TARGET / n : 1;
    size_t lookup_rounds = LOOKUP_TARGET / n ? LOOKUP_TARGET / n : 1;

    for (size_t s = 0; s < NUM_STRUCTURES; s++) {
        const Impl *impl = STRUCTURES[s].impl;
        double best_insert = 1e300, best_hit = 1e300, best_miss = 1e300;
        size_t bytes = 0;

        for (int rep = 0; rep < REPEATS; rep++) {
            double insert_total = 0;
            for (size_t r = 0; r < insert_rounds; r++) {
                impl->init();
                double t0 = now_ns();
                for (size_t i = 0; i < n; i++)
                    if (impl->insert(&syms[i]) != 0) {
                        fprintf(stderr, "%s: insert failed (arena full)\n", STRUCTURES[s].label);
                        impl->destroy();
                        return 1;
                    }
                insert_total += now_ns() - t0;
                if (r + 1 < insert_rounds) impl->destroy();
            }

            /* the last table built stays for the lookups */
            for (size_t i = 0; i < n; i++)
                if (impl->absent(syms[i].name) || !impl->absent(missing[i])) {
                    fprintf(stderr, "%s: lookup returned the wrong answer\n", STRUCTURES[s].label);
                    impl->destroy();
                    return 1;
                }

            double t0 = now_ns();
            for (size_t r = 0; r < lookup_rounds; r++)
                for (size_t i = 0; i < n; i++) sink += impl->absent(syms[i].name);
            double hit = now_ns() - t0;

            t0 = now_ns();
            for (size_t r = 0; r < lookup_rounds; r++)
                for (size_t i = 0; i < n; i++) sink += impl->absent(missing[i]);
            double miss = now_ns() - t0;

            bytes = impl->total_bytes();
            impl->destroy();

            double ins_ns = insert_total / (double)(insert_rounds * n);
            double hit_ns = hit / (double)(lookup_rounds * n);
            double miss_ns = miss / (double)(lookup_rounds * n);
            if (ins_ns < best_insert) best_insert = ins_ns;
            if (hit_ns < best_hit) best_hit = hit_ns;
            if (miss_ns < best_miss) best_miss = miss_ns;
        }

        printf("%s, %zu, %s, %zu, %.1f, %.1f, %.1f\n", ST_PATTERNS[pattern], n,
               STRUCTURES[s].label, bytes, best_insert, best_hit, best_miss);
        fflush(stdout);
    }
    return 0;
}

int main(void) {
    static const size_t ns[] = { 100, 1000 };
    for (int p = 0; p < ST_NUM_PATTERNS; p++)
        for (size_t k = 0; k < sizeof ns / sizeof ns[0]; k++)
            if (bench_one(p, ns[k])) return 1;
    return 0;
}
