/*
 * symtab_common.h
 * Shared by all three isolated variants:
 *   - test data (same identifier set as the original prototype)
 *   - allocation tracker (same accounting model as original: n + MALLOC_OVERHEAD)
 *   - BASELINE implementation (textbook chained hash table, unpacked ints)
 *   - experiment harness that runs baseline vs. ONE variant and reports
 *
 * Header-only with static functions: each variant .c file is a single TU.
 */
#ifndef SYMTAB_COMMON_H
#define SYMTAB_COMMON_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <sys/types.h>

/* ---------- test data ---------- */
typedef struct {
    const char *name;
    uint8_t  type;           /* 4 bits needed  */
    uint8_t  scope;          /* 8 bits needed  */
    uint8_t  storage_class;  /* 4 bits needed  */
    uint16_t offset;         /* 16 bits needed */
} TestSymbol;

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

/* ---------- allocation accounting ----------
 * Each live malloc costs (requested bytes + MALLOC_OVERHEAD), identical to the
 * original prototype's model. Unlike the original, frees are tracked so that
 * variants which free/reallocate (trie edge splits) are charged only for what
 * is live at the end. */
#define MALLOC_OVERHEAD 16
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

/* ---------- implementation interface ---------- */
typedef struct {
    const char *label;
    void   (*init)(void);
    void   (*insert)(const TestSymbol *s);
    int    (*verify)(const TestSymbol *s);   /* 1 = lookup returns exact metadata */
    int    (*absent)(const char *key);       /* 1 = correctly not found           */
    size_t (*total_bytes)(void);
    void   (*breakdown)(void);
} Impl;

/* ============================================================
 * BASELINE: chained hash table, malloc per node + per name,
 * pointers, unpacked int fields.
 * ============================================================ */
typedef struct HNode {
    char *name;
    struct HNode *next;
    int type, scope, storage_class, offset;
} HNode;

static HNode  *base_buckets[HASH_BUCKETS];
static Tracker base_t;

static void base_init(void) { memset(base_buckets, 0, sizeof base_buckets); base_t.payload = base_t.allocs = 0; }

static void base_insert(const TestSymbol *s) {
    HNode *n = t_alloc(&base_t, sizeof(HNode));
    n->name = t_alloc(&base_t, strlen(s->name) + 1);
    strcpy(n->name, s->name);
    n->type = s->type; n->scope = s->scope;
    n->storage_class = s->storage_class; n->offset = s->offset;
    unsigned b = hash_str(s->name);
    n->next = base_buckets[b];
    base_buckets[b] = n;
}

static HNode *base_find(const char *name) {
    for (HNode *n = base_buckets[hash_str(name)]; n; n = n->next)
        if (strcmp(n->name, name) == 0) return n;
    return NULL;
}

static int base_verify(const TestSymbol *s) {
    HNode *h = base_find(s->name);
    return h && h->type == s->type && h->scope == s->scope &&
           h->storage_class == s->storage_class && h->offset == s->offset;
}
static int base_absent(const char *k) { return base_find(k) == NULL; }
static size_t base_total(void) { return t_total(&base_t) + sizeof base_buckets; }
static void base_breakdown(void) {
    printf("    sizeof(HNode)        : %zu B\n", sizeof(HNode));
    printf("    bucket array         : %zu B\n", sizeof base_buckets);
    printf("    live allocations     : %zu (%zu B payload + %zu B overhead)\n",
           base_t.allocs, base_t.payload, base_t.allocs * (size_t)MALLOC_OVERHEAD);
}

static const Impl BASELINE_IMPL = {
    "BASELINE (hash + malloc + pointers + unpacked ints)",
    base_init, base_insert, base_verify, base_absent, base_total, base_breakdown
};

/* ============================================================
 * Harness: run baseline and ONE variant on identical input.
 * ============================================================ */
static int run_experiment(const char *title, const Impl *var) {
    const Impl *base = &BASELINE_IMPL;
    size_t bsnap[NUM_SYMBOLS], vsnap[NUM_SYMBOLS];

    base->init();
    var->init();
    for (size_t i = 0; i < NUM_SYMBOLS; i++) {
        base->insert(&TEST_SYMBOLS[i]);
        var->insert(&TEST_SYMBOLS[i]);
        bsnap[i] = base->total_bytes();
        vsnap[i] = var->total_bytes();
    }

    int ok = 1;
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
    return ok ? 0 : 1;
}

#endif
