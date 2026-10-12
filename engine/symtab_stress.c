/*
 * symtab_stress.c -- multi-configuration stress sweep
 * ------------------------------------------------------------
 * One executable measures ONE configuration against the baseline.
 * The configuration is chosen at compile time:
 *
 *   cc ... -DCFG=ab -DCFG_LABEL='"AB"' -DVARIANT_SRC='"variant_ab_arena_bitpack.c"' \
 *          symtab_stress.c
 *
 * The variant's source file is #included as-is with SYMTAB_NO_MAIN defined
 * (so its demo main() drops out), so the exact code the analyzer links is
 * what gets measured here, along with the symtab_common.h baseline and
 * accounting model. Every variant exports `const Impl <cfg>_impl`.
 *
 * For every pattern x n it:
 *   1. generates a deterministic symbol set (same set for every config),
 *   2. inserts it into baseline and variant,
 *   3. VERIFIES both (every symbol round-trips; absent / prefix / extension
 *      probes are not found) -- a run that fails verification emits no row,
 *   4. prints exactly one row on stdout:
 *          data, pattern, n, baseline_bytes, variant_bytes
 *      where `data` is the configuration label (A, B, C, AB, AC, BC, ABC).
 *
 * stdout carries ONLY rows. All diagnostics go to stderr.
 *
 * usage: stress_<cfg> [seed]      (default seed = 1)
 *
 * Compiled WITHOUT -DCFG this file builds a stub main() that prints a hint to
 * stderr and exits 0, so blind "compile every .c" CI steps succeed.
 */
#include "symtab_common.h"

#ifndef CFG
/* ---- Fallback: "naked" build (no -DCFG). ----------------------------------
 * CI and IDEs sometimes compile every .c file with no configuration flags.
 * Compile cleanly to a harmless stub instead of tripping the #error guards
 * below. Real measurements need the -D flags; see run_sweep.sh, which builds
 * the 7 configurations. The stub writes nothing to stdout, so it can never
 * inject bogus rows into the results stream (compare_table.py rejects an
 * empty stream). */
int main(void) {
    fputs("symtab_stress: built without -DCFG/-DCFG_LABEL/-DVARIANT_SRC; nothing to measure.\n"
          "              use run_sweep.sh to build and run the 7 configurations.\n", stderr);
    return 0;
}
#else /* CFG defined: real stress build */

#ifndef CFG_LABEL
#error "define CFG_LABEL (row label string, e.g. -DCFG_LABEL='\"AB\"')"
#endif
#ifndef VARIANT_SRC
#error "define VARIANT_SRC (variant source file, e.g. -DVARIANT_SRC='\"variant_ab_arena_bitpack.c\"')"
#endif

#define SYMTAB_NO_MAIN              /* keep the variant's own demo main out of the way */
#include VARIANT_SRC

#define ST_PASTE_(a, b) a##b
#define ST_PASTE(a, b)  ST_PASTE_(a, b)
#define st_variant      ST_PASTE(CFG, _impl)   /* e.g. ab_impl, exported by the variant */

#include "symtab_workloads.h"

/* ---------------- one (pattern, n) measurement ---------------- */
static int st_in_set(const TestSymbol *syms, size_t n, const char *key) {
    for (size_t i = 0; i < n; i++)
        if (strcmp(syms[i].name, key) == 0) return 1;
    return 0;
}

static int st_run_one(int pattern, const char *pname, size_t n, uint64_t seed) {
    static TestSymbol syms[ST_MAX_N];
    static char names[ST_MAX_N][ST_NAME_LEN];
    const Impl *base = &BASELINE_IMPL, *var = &st_variant;
    st_generate(pattern, n, seed, syms, names);

    int ok = 1;
    base->init();
    var->init();
    for (size_t i = 0; i < n; i++) {
        if (base->insert(&syms[i]) != 0 || var->insert(&syms[i]) != 0) {
            fprintf(stderr, "[%s/%s/n=%zu] insert failed (arena full) '%s'\n", CFG_LABEL, pname, n, syms[i].name);
            ok = 0;
        }
    }

    for (size_t i = 0; i < n; i++) {
        if (!base->verify(&syms[i])) { fprintf(stderr, "[%s/%s/n=%zu] BASELINE mismatch '%s'\n", CFG_LABEL, pname, n, syms[i].name); ok = 0; }
        if (!var->verify(&syms[i]))  { fprintf(stderr, "[%s/%s/n=%zu] VARIANT mismatch '%s'\n",  CFG_LABEL, pname, n, syms[i].name); ok = 0; }
    }
    if (!base->absent("not_a_real_symbol") || !var->absent("not_a_real_symbol")) {
        fprintf(stderr, "[%s/%s/n=%zu] false positive on absent key\n", CFG_LABEL, pname, n); ok = 0;
    }
    /* every proper prefix and every 1-char extension that is NOT itself a key must be absent */
    for (size_t i = 0; i < n; i++) {
        char probe[ST_NAME_LEN + 2];
        size_t len = strlen(syms[i].name);
        if (len >= 2) {
            memcpy(probe, syms[i].name, len - 1);
            probe[len - 1] = '\0';
            if (!st_in_set(syms, n, probe) && (!base->absent(probe) || !var->absent(probe))) {
                fprintf(stderr, "[%s/%s/n=%zu] prefix false positive '%s'\n", CFG_LABEL, pname, n, probe); ok = 0;
            }
        }
        memcpy(probe, syms[i].name, len);
        probe[len] = '~';
        probe[len + 1] = '\0';
        if (!base->absent(probe) || !var->absent(probe)) {
            fprintf(stderr, "[%s/%s/n=%zu] extension false positive '%s'\n", CFG_LABEL, pname, n, probe); ok = 0;
        }
    }
    if (ok)
        printf("%s, %s, %zu, %zu, %zu\n", CFG_LABEL, pname, n, base->total_bytes(), var->total_bytes());

    base->destroy();
    var->destroy();
    return ok ? 0 : 1;
}

int main(int argc, char **argv) {
    static const size_t ns[] = { 10, 25, 50, 100, 200, 300, 500, 1000 };
    uint64_t seed = 1;
    if (argc > 1) seed = strtoull(argv[1], NULL, 10);

    for (int p = 0; p < ST_NUM_PATTERNS; p++)
        for (size_t k = 0; k < sizeof ns / sizeof ns[0]; k++)
            if (st_run_one(p, ST_PATTERNS[p], ns[k], seed)) return 1;
    return 0;
}

#endif /* CFG */
