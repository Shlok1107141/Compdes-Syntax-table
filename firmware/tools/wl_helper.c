/*
 * wl_helper.c -- host-side helper for gen_workloads.py (not built for the board)
 *
 *   wl_helper dump <pattern> <n> <seed>
 *       Prints the engine's symbol set, one per line: type scope storage offset name.
 *       pattern 0/1/2 = realistic/random/scoped (symtab_workloads.h, same sets as
 *       results.csv); pattern -1 = the prototype's 30 identifiers.
 *
 * Built with -DVARIANT_SRC='"variant_abc_full.c"' -DCFG_IMPL=abc_impl it also has
 *
 *   wl_helper bytes
 *       Reads symbols in the format above on stdin, inserts them all into the
 *       baseline and the variant, verifies both, and prints
 *       "baseline_bytes variant_bytes verify_ok" (this host's sizes).
 *
 * and, for an arena variant built with -DHAS_ARENA (add -DHAS_META for the tries),
 *
 *   wl_helper pools
 *       Inserts the symbols one by one and prints the arena counts after each
 *       insert: nodes chars meta shadows. gen_workloads.py turns these into
 *       pool sizes for the Uno.
 */
#ifdef VARIANT_SRC
#define SYMTAB_NO_MAIN
#include VARIANT_SRC
#endif
#include "symtab_workloads.h"

static TestSymbol syms[ST_MAX_N];
static char names[ST_MAX_N][ST_NAME_LEN];

static int dump(int pattern, size_t n, unsigned long seed) {
    if (pattern == -1) {
        for (size_t i = 0; i < NUM_SYMBOLS; i++) syms[i] = TEST_SYMBOLS[i];
        n = NUM_SYMBOLS;
    } else {
        if (pattern < 0 || pattern >= ST_NUM_PATTERNS || n == 0 || n > ST_MAX_N) return 2;
        st_generate(pattern, n, seed, syms, names);
    }
    for (size_t i = 0; i < n; i++)
        printf("%u %u %u %u %s\n", syms[i].type, syms[i].scope, syms[i].storage_class,
               syms[i].offset, syms[i].name);
    return 0;
}

#ifdef VARIANT_SRC
static size_t read_all(void) {
    unsigned t, sc, st, off;
    size_t n = 0;
    while (n < ST_MAX_N && scanf("%u %u %u %u %31s", &t, &sc, &st, &off, names[n]) == 5) {
        TestSymbol s = { names[n], (uint8_t)t, (uint8_t)sc, (uint8_t)st, (uint16_t)off };
        syms[n++] = s;
    }
    return n;
}

static int bytes(void) {
    size_t n = read_all();
    int ok = 1;
    BASELINE_IMPL.init();
    CFG_IMPL.init();
    for (size_t i = 0; i < n; i++)
        if (BASELINE_IMPL.insert(&syms[i]) != 0 || CFG_IMPL.insert(&syms[i]) != 0) ok = 0;
    for (size_t i = 0; i < n; i++)
        if (!BASELINE_IMPL.verify(&syms[i]) || !CFG_IMPL.verify(&syms[i])) ok = 0;
    printf("%zu %zu %d\n", BASELINE_IMPL.total_bytes(), CFG_IMPL.total_bytes(), ok);
    BASELINE_IMPL.destroy();
    CFG_IMPL.destroy();
    return ok ? 0 : 1;
}
#endif

#ifdef HAS_ARENA
static int pools(void) {
    size_t n = read_all();
    CFG_IMPL.init();
    for (size_t i = 0; i < n; i++) {
        if (CFG_IMPL.insert(&syms[i]) != 0) return 1;
#ifdef HAS_META
        printf("%u %u %u %u\n", (unsigned)node_count, (unsigned)char_used,
               (unsigned)meta_count, (unsigned)shadow_count);
#else
        printf("%u %u 0 0\n", (unsigned)node_count, (unsigned)char_used);
#endif
    }
    CFG_IMPL.destroy();
    return 0;
}
#endif

int main(int argc, char **argv) {
    if (argc == 5 && strcmp(argv[1], "dump") == 0)
        return dump(atoi(argv[2]), (size_t)strtoul(argv[3], NULL, 10), strtoul(argv[4], NULL, 10));
#ifdef VARIANT_SRC
    if (argc == 2 && strcmp(argv[1], "bytes") == 0) return bytes();
#endif
#ifdef HAS_ARENA
    if (argc == 2 && strcmp(argv[1], "pools") == 0) return pools();
#endif
    fprintf(stderr, "usage: wl_helper dump <pattern> <n> <seed> | bytes | pools\n");
    return 2;
}
