/*
 * symtab_common.h
 * Shared by every symbol-table variant and by the programs that drive them:
 *   - the symbol record and the Impl interface each variant implements
 *   - allocation tracker (same accounting model as the original: n + MALLOC_OVERHEAD)
 *   - the limits that 16-bit arena indices impose
 *   - metadata packing helpers (4b type | 8b scope | 4b storage | 16b offset)
 *   - BASELINE implementation (textbook chained hash table, unpacked ints)
 *   - test data + experiment harness used by each variant's demo main()
 *
 * Header-only with static functions: each variant is a single .c file. Every
 * variant also exports `const Impl <cfg>_impl`, so a program can either link
 * several variants together (symtab_analyze) or #include exactly one with
 * SYMTAB_NO_MAIN defined (symtab_stress).
 */
#ifndef SYMTAB_COMMON_H
#define SYMTAB_COMMON_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <sys/types.h>

/* ---------- symbol record ---------- */
typedef struct {
    const char *name;
    uint8_t  type;           /* 4 bits needed  */
    uint8_t  scope;          /* 8 bits needed  */
    uint8_t  storage_class;  /* 4 bits needed  */
    uint16_t offset;         /* 16 bits needed */
} TestSymbol;

/* ---------- implementation interface ----------
 * A name may be declared more than once (shadowed in an inner scope, or
 * redeclared). Every declaration is stored, and verify() must find each one,
 * not only the newest. */
typedef struct {
    const char *label;
    void   (*init)(void);
    int    (*insert)(const TestSymbol *s);   /* 0 = stored, -1 = an arena is full */
    int    (*verify)(const TestSymbol *s);   /* 1 = this exact declaration is found */
    int    (*absent)(const char *key);       /* 1 = correctly not found             */
    size_t (*total_bytes)(void);
    void   (*breakdown)(void);
    void   (*destroy)(void);                 /* release everything init/insert took */
} Impl;

extern const Impl a_impl, b_impl, c_impl, ab_impl, ac_impl, bc_impl, abc_impl;

/* Scoped lookup on the compressed (ABC) table: writes every declaration of
 * `name` into out[], newest first, as insertion indices; returns how many.
 * A use resolves to the first one whose scope is still open. */
size_t abc_declarations(const char *name, uint16_t *out, size_t max);

/* ---------- arena limits ----------
 * Arena variants address nodes, characters and metadata with uint16_t, and
 * reserve 0xFFFF as the NIL index. These are hard limits of the technique,
 * not tuning knobs: inserts past them fail rather than wrap. */
#define NIL              0xFFFF
#define ARENA_MAX_ITEMS  0xFFFFu    /* usable indices 0 .. 0xFFFE */
#define ARENA_MAX_CHARS  0xFFFFu    /* uint16_t character offsets */

/* A trie stores each name once, so a second declaration of a stored name
 * needs one extra record holding the older declaration. Paid only on
 * redeclaration, so unique-name workloads cost exactly what they did before. */
typedef struct {
    uint16_t node;           /* trie node whose name was redeclared   */
    uint16_t older;          /* meta_pool index of the older declaration */
} ArenaShadow;

/* ---------- metadata packing ---------- */
static inline uint32_t pack_meta(uint8_t type, uint8_t scope, uint8_t sc, uint16_t off) {
    return ((uint32_t)(type & 0xF) << 28) | ((uint32_t)scope << 20)
         | ((uint32_t)(sc & 0xF) << 16)   | (uint32_t)off;
}

static inline void unpack_meta(uint32_t m, uint8_t *type, uint8_t *scope, uint8_t *sc, uint16_t *off) {
    *type  = (uint8_t)((m >> 28) & 0xF);
    *scope = (uint8_t)((m >> 20) & 0xFF);
    *sc    = (uint8_t)((m >> 16) & 0xF);
    *off   = (uint16_t)(m & 0xFFFF);
}

static inline uint32_t pack_symbol(const TestSymbol *s) {
    return pack_meta(s->type, s->scope, s->storage_class, s->offset);
}

/* Unpacks rather than comparing words, so it also proves the round-trip. */
static inline int packed_matches(uint32_t m, const TestSymbol *s) {
    uint8_t t, sc, stc;
    uint16_t off;
    unpack_meta(m, &t, &sc, &stc, &off);
    return t == s->type && sc == s->scope && stc == s->storage_class && off == s->offset;
}

static inline int fields_match(int type, int scope, int sc, int off, const TestSymbol *s) {
    return type == s->type && scope == s->scope && sc == s->storage_class && off == s->offset;
}

/* ---------- allocation accounting ----------
 * Each live malloc costs (requested bytes + MALLOC_OVERHEAD), identical to the
 * original prototype's model. Frees are tracked so that variants which
 * free/reallocate (trie edge splits) are charged only for what is live.
 * The overhead is two machine words of chunk header, as in glibc: 16 B on a
 * 64-bit host (the prototype's figure), 8 B when built with -m32. */
#define MALLOC_OVERHEAD (2 * sizeof(void *))
#define HASH_BUCKETS    64

typedef struct { size_t payload; size_t allocs; } Tracker;

static inline void *t_alloc(Tracker *t, size_t n) {
    void *p = malloc(n);
    if (!p) { fprintf(stderr, "OOM\n"); exit(1); }
    t->payload += n;
    t->allocs++;
    return p;
}
static inline void t_free(Tracker *t, void *p, size_t n) {
    free(p);
    t->payload -= n;
    t->allocs--;
}
static inline size_t t_total(const Tracker *t) {
    return t->payload + t->allocs * MALLOC_OVERHEAD;
}

static inline unsigned hash_str(const char *s) {
    unsigned h = 5381;
    while (*s) h = ((h << 5) + h) + (unsigned char)(*s++);
    return h % HASH_BUCKETS;
}

/* ============================================================
 * BASELINE: chained hash table, malloc per node + per name,
 * pointers, unpacked int fields. A redeclaration is simply
 * another node (inserted at the chain head, so it shadows).
 * ============================================================ */
typedef struct HNode {
    char *name;
    struct HNode *next;
    int type, scope, storage_class, offset;
} HNode;

static HNode  *base_buckets[HASH_BUCKETS];
static Tracker base_t;

static void base_init(void) { memset(base_buckets, 0, sizeof base_buckets); base_t.payload = base_t.allocs = 0; }

static int base_insert(const TestSymbol *s) {
    HNode *n = t_alloc(&base_t, sizeof(HNode));
    n->name = t_alloc(&base_t, strlen(s->name) + 1);
    strcpy(n->name, s->name);
    n->type = s->type; n->scope = s->scope;
    n->storage_class = s->storage_class; n->offset = s->offset;
    unsigned b = hash_str(s->name);
    n->next = base_buckets[b];
    base_buckets[b] = n;
    return 0;
}

static int base_verify(const TestSymbol *s) {
    for (HNode *n = base_buckets[hash_str(s->name)]; n; n = n->next)
        if (strcmp(n->name, s->name) == 0 &&
            fields_match(n->type, n->scope, n->storage_class, n->offset, s)) return 1;
    return 0;
}

static int base_absent(const char *k) {
    for (HNode *n = base_buckets[hash_str(k)]; n; n = n->next)
        if (strcmp(n->name, k) == 0) return 0;
    return 1;
}

static size_t base_total(void) { return t_total(&base_t) + sizeof base_buckets; }

static void base_breakdown(void) {
    printf("    sizeof(HNode)        : %zu B\n", sizeof(HNode));
    printf("    bucket array         : %zu B\n", sizeof base_buckets);
    printf("    live allocations     : %zu (%zu B payload + %zu B overhead)\n",
           base_t.allocs, base_t.payload, base_t.allocs * (size_t)MALLOC_OVERHEAD);
}

static void base_destroy(void) {
    for (size_t b = 0; b < HASH_BUCKETS; b++) {
        HNode *n = base_buckets[b];
        while (n) {
            HNode *next = n->next;
            t_free(&base_t, n->name, strlen(n->name) + 1);
            t_free(&base_t, n, sizeof(HNode));
            n = next;
        }
        base_buckets[b] = NULL;
    }
}

static const Impl BASELINE_IMPL = {
    "BASELINE (hash + malloc + pointers + unpacked ints)",
    base_init, base_insert, base_verify, base_absent, base_total, base_breakdown, base_destroy
};

/* ---------- test data (the original prototype's 30 identifiers) ---------- */
static const TestSymbol TEST_SYMBOLS[] = {
    {"counter",        0, 0, 1,   0}, {"counter_max",    0, 0, 1,   4},
    {"counter_min",    0, 0, 1,   8}, {"counter_reset",  3, 1, 3,   0},
    {"count",          0, 1, 0,   0}, {"count_all",      0, 1, 0,   4},
    {"temp",           1, 0, 1,  12}, {"temp_max",       1, 0, 1,  13},
    {"temp_min",       1, 0, 1,  14}, {"temp_buffer",    2, 0, 1,  16},
    {"sensor_id",      0, 0, 1,  24}, {"sensor_value",   0, 0, 1,  28},
    {"sensor_read",    3, 1, 3,   0}, {"sensor_write",   3, 1, 3,   0},
    {"led_pin",        0, 0, 1,  32}, {"led_state",      0, 0, 1,  36},
    {"led_toggle",     3, 1, 3,   0}, {"buffer",         2, 0, 1,  40},
    {"buffer_size",    0, 0, 1,  44}, {"buffer_ptr",     2, 0, 1,  48},
    {"status",         0, 0, 1,  52}, {"status_flag",    0, 0, 1,  56},
    {"status_code",    0, 0, 1,  60}, {"init",           3, 1, 3,   0},
    {"init_flag",      0, 2, 0,   0}, {"main",           3, 1, 3,   0},
    {"handler",        3, 1, 3,   0}, {"handler_id",     0, 2, 0,   4},
    {"config",         3, 0, 1,  64}, {"config_flag",    0, 0, 1,  68},
};
#define NUM_SYMBOLS (sizeof(TEST_SYMBOLS) / sizeof(TEST_SYMBOLS[0]))

static inline size_t test_name_bytes(void) {
    size_t t = 0;
    for (size_t i = 0; i < NUM_SYMBOLS; i++) t += strlen(TEST_SYMBOLS[i].name) + 1;
    return t;
}

/* ============================================================
 * Harness: run baseline and ONE variant on identical input.
 * ============================================================ */
static inline int run_experiment(const char *title, const Impl *var) {
    const Impl *base = &BASELINE_IMPL;
    size_t bsnap[NUM_SYMBOLS], vsnap[NUM_SYMBOLS];
    int ok = 1;

    base->init();
    var->init();
    for (size_t i = 0; i < NUM_SYMBOLS; i++) {
        if (base->insert(&TEST_SYMBOLS[i]) != 0 || var->insert(&TEST_SYMBOLS[i]) != 0) {
            printf("INSERT FAILED '%s' (arena full)\n", TEST_SYMBOLS[i].name);
            ok = 0;
        }
        bsnap[i] = base->total_bytes();
        vsnap[i] = var->total_bytes();
    }

    for (size_t i = 0; i < NUM_SYMBOLS; i++) {
        if (!base->verify(&TEST_SYMBOLS[i])) { printf("BASELINE MISMATCH '%s'\n", TEST_SYMBOLS[i].name); ok = 0; }
        if (!var->verify(&TEST_SYMBOLS[i]))  { printf("VARIANT MISMATCH  '%s'\n", TEST_SYMBOLS[i].name); ok = 0; }
    }
    if (!base->absent("not_a_real_symbol")) { printf("BASELINE false positive\n"); ok = 0; }
    if (!var->absent("not_a_real_symbol"))  { printf("VARIANT false positive\n");  ok = 0; }
    /* proper-prefix of a stored key that is not itself a key */
    if (!base->absent("sens") || !var->absent("sens")) { printf("prefix false positive\n"); ok = 0; }

    printf("=== %s ===\n\n", title);
    printf("Correctness: %s (%zu identifiers)\n\n", ok ? "PASS" : "FAIL", NUM_SYMBOLS);

    size_t bt = base->total_bytes(), vt = var->total_bytes();
    printf("--- %s ---\n", base->label); base->breakdown();
    printf("    TOTAL                : %zu B  (%.1f B/symbol)\n\n", bt, (double)bt / NUM_SYMBOLS);
    printf("--- %s ---\n", var->label);  var->breakdown();
    printf("    TOTAL                : %zu B  (%.1f B/symbol)\n\n", vt, (double)vt / NUM_SYMBOLS);
    printf(">>> %s vs baseline: %+.1f%% memory (%zd B)\n\n", title,
           -100.0 * (1.0 - (double)vt / (double)bt), (ssize_t)vt - (ssize_t)bt);

    size_t budgets[] = { 512, 1024, 1536, 2048 };
    printf("--- Identifiers that fit in fixed RAM budget ---\n  %-8s %-14s %-14s\n", "Budget", "Baseline", "Variant");
    for (size_t b = 0; b < sizeof budgets / sizeof budgets[0]; b++) {
        int bf = 0, vf = 0;
        for (size_t i = 0; i < NUM_SYMBOLS && bsnap[i] <= budgets[b]; i++) bf = (int)i + 1;
        for (size_t i = 0; i < NUM_SYMBOLS && vsnap[i] <= budgets[b]; i++) vf = (int)i + 1;
        printf("  %-8zu %2d / %zu        %2d / %zu\n", budgets[b], bf, NUM_SYMBOLS, vf, NUM_SYMBOLS);
    }
    printf("\n");

    base->destroy();
    var->destroy();
    return ok ? 0 : 1;
}

#endif
