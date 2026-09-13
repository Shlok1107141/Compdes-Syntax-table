/*
 * symtab_demo.c
 * ------------------------------------------------------------
 * Prototype: Memory-Constrained Compressed Symbol Table for
 * Embedded Compilers (Review 0)
 *
 * Demonstrates the core idea only (not a full compiler):
 *   BASELINE  : textbook hash table w/ separate chaining,
 *               one malloc per node + one malloc per name string,
 *               unpacked struct fields.
 *   COMPRESSED: radix (Patricia) trie for identifier storage
 *               (edges = shared prefixes -> trie IS the intern
 *               table, no duplicate strings), nodes/metadata
 *               kept in flat arena arrays addressed by 16-bit
 *               indices instead of 8-byte pointers, per-symbol
 *               metadata bit-packed into a single uint32_t.
 *
 * Both structures are fed the same identifier set and compared
 * on: total bytes used, bytes/symbol, and correctness of lookup.
 * ------------------------------------------------------------
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>

/* ============================================================
 * Shared test data: identifiers as they'd appear in a small
 * embedded C-like program, chosen to have realistic shared
 * prefixes (naming convention: subsystem_field).
 * ============================================================ */

typedef struct {
    const char *name;
    uint8_t     type;          /* 0=int,1=char,2=ptr,3=struct ... (4 bits) */
    uint8_t     scope;         /* nesting depth (8 bits)                   */
    uint8_t     storage_class; /* 0=local,1=global,2=static,3=param (4 bits)*/
    uint16_t    offset;        /* stack/struct offset (16 bits)            */
} TestSymbol;

static const TestSymbol TEST_SYMBOLS[] = {
    {"counter",        0, 0, 1,   0},
    {"counter_max",    0, 0, 1,   4},
    {"counter_min",    0, 0, 1,   8},
    {"counter_reset",  3, 1, 3,   0},
    {"count",          0, 1, 0,   0},
    {"count_all",      0, 1, 0,   4},
    {"temp",           1, 0, 1,  12},
    {"temp_max",       1, 0, 1,  13},
    {"temp_min",       1, 0, 1,  14},
    {"temp_buffer",    2, 0, 1,  16},
    {"sensor_id",      0, 0, 1,  24},
    {"sensor_value",   0, 0, 1,  28},
    {"sensor_read",    3, 1, 3,   0},
    {"sensor_write",   3, 1, 3,   0},
    {"led_pin",        0, 0, 1,  32},
    {"led_state",      0, 0, 1,  36},
    {"led_toggle",     3, 1, 3,   0},
    {"buffer",         2, 0, 1,  40},
    {"buffer_size",    0, 0, 1,  44},
    {"buffer_ptr",     2, 0, 1,  48},
    {"status",         0, 0, 1,  52},
    {"status_flag",    0, 0, 1,  56},
    {"status_code",    0, 0, 1,  60},
    {"init",           3, 1, 3,   0},
    {"init_flag",      0, 2, 0,   0},
    {"main",           3, 1, 3,   0},
    {"handler",        3, 1, 3,   0},
    {"handler_id",     0, 2, 0,   4},
    {"config",         3, 0, 1,  64},
    {"config_flag",    0, 0, 1,  68},
};
#define NUM_SYMBOLS (sizeof(TEST_SYMBOLS)/sizeof(TEST_SYMBOLS[0]))

/* Typical glibc-style per-allocation chunk overhead. Real overhead
 * varies (8-32 bytes) by allocator/platform; used here as a
 * representative constant so the baseline isn't flattered. */
#define MALLOC_OVERHEAD 16

/* ============================================================
 * BASELINE: hash table with separate chaining
 * ============================================================ */

typedef struct HNode {
    char *name;              /* separately malloc'd copy of the string */
    struct HNode *next;
    int type;
    int scope;
    int storage_class;
    int offset;
} HNode;

#define HASH_BUCKETS 64
static HNode *baseline_buckets[HASH_BUCKETS];
static size_t baseline_bytes = 0;

static unsigned hash_str(const char *s) {
    unsigned h = 5381;
    while (*s) h = ((h << 5) + h) + (unsigned char)(*s++);
    return h % HASH_BUCKETS;
}

static void *counting_malloc(size_t n) {
    void *p = malloc(n);
    if (!p) { fprintf(stderr, "baseline OOM\n"); exit(1); }
    baseline_bytes += n + MALLOC_OVERHEAD;
    return p;
}

static void baseline_insert(const char *name, uint8_t type, uint8_t scope,
                             uint8_t storage_class, uint16_t offset) {
    HNode *n = counting_malloc(sizeof(HNode));
    n->name = counting_malloc(strlen(name) + 1);
    strcpy(n->name, name);
    n->type = type;
    n->scope = scope;
    n->storage_class = storage_class;
    n->offset = offset;
    unsigned b = hash_str(name);
    n->next = baseline_buckets[b];
    baseline_buckets[b] = n;
}

static HNode *baseline_lookup(const char *name) {
    unsigned b = hash_str(name);
    for (HNode *n = baseline_buckets[b]; n; n = n->next)
        if (strcmp(n->name, name) == 0) return n;
    return NULL;
}

/* ============================================================
 * COMPRESSED: radix (Patricia) trie + arena + bit-packed meta
 * ============================================================ */

#define MAX_NODES   2048
#define MAX_CHARS   8192
#define MAX_SYMS    512
#define NIL         0xFFFF
#define ROOT        0

typedef struct {
    uint16_t first_child;   /* index into node_pool, NIL if none */
    uint16_t next_sibling;  /* index into node_pool, NIL if none */
    uint16_t edge_offset;   /* offset into char_pool             */
    uint8_t  edge_len;
    uint8_t  is_leaf;
    uint16_t symbol_id;     /* index into meta_pool, if is_leaf  */
} TrieNode;

static TrieNode node_pool[MAX_NODES];
static uint16_t  node_count = 0;

static unsigned char char_pool[MAX_CHARS];
static uint16_t       char_used = 0;

static uint32_t meta_pool[MAX_SYMS];
static uint16_t  meta_count = 0;

static uint16_t new_node(void) {
    if (node_count >= MAX_NODES) { fprintf(stderr, "node arena full\n"); exit(1); }
    uint16_t id = node_count++;
    node_pool[id].first_child = NIL;
    node_pool[id].next_sibling = NIL;
    node_pool[id].is_leaf = 0;
    return id;
}

/* Static arrays are zero-initialized by C, which for node_pool[ROOT] means
 * first_child == 0 and next_sibling == 0 -- but 0 is also a VALID node index
 * (it's ROOT's own index), not the NIL sentinel (0xFFFF). Left unfixed, the
 * root points to itself and find_child_slot() loops forever. Call this once
 * before any insert/lookup. */
static void trie_init(void) {
    node_pool[ROOT].first_child = NIL;
    node_pool[ROOT].next_sibling = NIL;
    node_pool[ROOT].is_leaf = 0;
    node_count = 1; /* index 0 is reserved for root; new_node() starts at 1 */
}

static uint16_t pool_store(const char *chars, uint8_t len) {
    if (char_used + len > MAX_CHARS) { fprintf(stderr, "char arena full\n"); exit(1); }
    uint16_t off = char_used;
    memcpy(&char_pool[off], chars, len);
    char_used += len;
    return off;
}

static uint32_t pack_meta(uint8_t type, uint8_t scope, uint8_t storage_class, uint16_t offset) {
    /* 4 bits type | 8 bits scope | 4 bits storage_class | 16 bits offset = 32 bits */
    return ((uint32_t)(type & 0xF) << 28)
         | ((uint32_t)(scope)      << 20)
         | ((uint32_t)(storage_class & 0xF) << 16)
         | (uint32_t)offset;
}

static void unpack_meta(uint32_t m, uint8_t *type, uint8_t *scope, uint8_t *storage_class, uint16_t *offset) {
    *type          = (m >> 28) & 0xF;
    *scope         = (m >> 20) & 0xFF;
    *storage_class = (m >> 16) & 0xF;
    *offset        = m & 0xFFFF;
}

static uint16_t store_metadata(uint32_t packed) {
    if (meta_count >= MAX_SYMS) { fprintf(stderr, "meta arena full\n"); exit(1); }
    meta_pool[meta_count] = packed;
    return meta_count++;
}

/* Returns pointer to the sibling-list slot that either already
 * holds a child whose edge starts with c, or is NIL (append point). */
static uint16_t *find_child_slot(uint16_t parent, char c) {
    uint16_t *slot = &node_pool[parent].first_child;
    while (*slot != NIL && char_pool[node_pool[*slot].edge_offset] != c)
        slot = &node_pool[*slot].next_sibling;
    return slot;
}

static uint16_t trie_insert(const char *key, uint32_t packed_meta) {
    size_t len = strlen(key);
    uint16_t cur = ROOT;
    size_t pos = 0;

    while (pos < len) {
        uint16_t *slot = find_child_slot(cur, key[pos]);

        if (*slot == NIL) {
            uint16_t leaf = new_node();
            node_pool[leaf].edge_offset = pool_store(key + pos, (uint8_t)(len - pos));
            node_pool[leaf].edge_len = (uint8_t)(len - pos);
            node_pool[leaf].is_leaf = 1;
            node_pool[leaf].symbol_id = store_metadata(packed_meta);
            *slot = leaf;
            return node_pool[leaf].symbol_id;
        }

        uint16_t child = *slot;
        uint16_t e_off = node_pool[child].edge_offset;
        uint8_t  e_len = node_pool[child].edge_len;

        size_t cp = 0;
        while (cp < e_len && pos + cp < len && char_pool[e_off + cp] == key[pos + cp]) cp++;

        if (cp == e_len) {
            pos += cp;
            cur = child;
            if (pos == len) {
                if (!node_pool[cur].is_leaf) {
                    node_pool[cur].is_leaf = 1;
                    node_pool[cur].symbol_id = store_metadata(packed_meta);
                }
                return node_pool[cur].symbol_id;
            }
            continue;
        }

        /* Partial match: split the edge at cp */
        uint16_t mid = new_node();
        node_pool[mid].edge_offset = e_off;
        node_pool[mid].edge_len = (uint8_t)cp;
        node_pool[mid].next_sibling = node_pool[child].next_sibling;

        node_pool[child].edge_offset = e_off + cp;
        node_pool[child].edge_len = (uint8_t)(e_len - cp);
        node_pool[child].next_sibling = NIL;
        node_pool[mid].first_child = child;

        *slot = mid; /* mid takes child's place in parent's sibling list */

        size_t remaining = len - (pos + cp);
        if (remaining == 0) {
            node_pool[mid].is_leaf = 1;
            node_pool[mid].symbol_id = store_metadata(packed_meta);
            return node_pool[mid].symbol_id;
        } else {
            uint16_t leaf = new_node();
            node_pool[leaf].edge_offset = pool_store(key + pos + cp, (uint8_t)remaining);
            node_pool[leaf].edge_len = (uint8_t)remaining;
            node_pool[leaf].is_leaf = 1;
            node_pool[leaf].symbol_id = store_metadata(packed_meta);
            node_pool[child].next_sibling = leaf;
            return node_pool[leaf].symbol_id;
        }
    }
    return NIL; /* empty key */
}

static uint16_t trie_lookup(const char *key) {
    size_t len = strlen(key);
    uint16_t cur = ROOT;
    size_t pos = 0;

    while (pos < len) {
        uint16_t *slot = find_child_slot(cur, key[pos]);
        if (*slot == NIL) return NIL;
        uint16_t child = *slot;
        uint16_t e_off = node_pool[child].edge_offset;
        uint8_t  e_len = node_pool[child].edge_len;
        if (e_len > len - pos) return NIL;
        if (memcmp(&char_pool[e_off], key + pos, e_len) != 0) return NIL;
        pos += e_len;
        cur = child;
    }
    if (!node_pool[cur].is_leaf) return NIL;
    return node_pool[cur].symbol_id;
}

/* ============================================================
 * main: build both tables, verify correctness, compare memory
 * ============================================================ */

int main(void) {
    printf("=== Memory-Constrained Compressed Symbol Table -- Prototype ===\n\n");
    printf("sizeof(HNode)   [baseline node] = %zu bytes\n", sizeof(HNode));
    printf("sizeof(TrieNode)[compressed node] = %zu bytes\n\n", sizeof(TrieNode));

    trie_init();

    size_t bucket_array_bytes_early = sizeof(baseline_buckets);
    static size_t baseline_snapshot[NUM_SYMBOLS];
    static size_t trie_snapshot[NUM_SYMBOLS];

    /* ---- populate both structures, recording cumulative bytes as we go ---- */
    for (size_t i = 0; i < NUM_SYMBOLS; i++) {
        const TestSymbol *s = &TEST_SYMBOLS[i];
        baseline_insert(s->name, s->type, s->scope, s->storage_class, s->offset);
        uint32_t packed = pack_meta(s->type, s->scope, s->storage_class, s->offset);
        trie_insert(s->name, packed);

        baseline_snapshot[i] = baseline_bytes + bucket_array_bytes_early;
        trie_snapshot[i] = (size_t)node_count * sizeof(TrieNode)
                          + (size_t)char_used
                          + (size_t)meta_count * sizeof(uint32_t);
    }

    /* ---- correctness check: every symbol round-trips ---- */
    int ok = 1;
    for (size_t i = 0; i < NUM_SYMBOLS; i++) {
        const TestSymbol *s = &TEST_SYMBOLS[i];

        HNode *h = baseline_lookup(s->name);
        if (!h || h->type != s->type || h->scope != s->scope ||
            h->storage_class != s->storage_class || h->offset != s->offset) {
            printf("BASELINE MISMATCH on '%s'\n", s->name);
            ok = 0;
        }

        uint16_t sid = trie_lookup(s->name);
        if (sid == NIL) { printf("TRIE LOOKUP FAILED on '%s'\n", s->name); ok = 0; continue; }
        uint8_t t, sc, stc; uint16_t off;
        unpack_meta(meta_pool[sid], &t, &sc, &stc, &off);
        if (t != s->type || sc != s->scope || stc != s->storage_class || off != s->offset) {
            printf("TRIE MISMATCH on '%s'\n", s->name);
            ok = 0;
        }
    }
    /* ---- negative lookup check ---- */
    if (baseline_lookup("not_a_real_symbol") != NULL) { printf("BASELINE false positive\n"); ok = 0; }
    if (trie_lookup("not_a_real_symbol") != NIL) { printf("TRIE false positive\n"); ok = 0; }

    printf(ok ? "Correctness: PASS -- all %zu identifiers inserted and looked up correctly in both structures.\n\n"
              : "Correctness: FAIL -- see mismatches above.\n\n", NUM_SYMBOLS);

    /* ---- memory comparison ---- */
    size_t bucket_array_bytes = sizeof(baseline_buckets);
    size_t baseline_total = baseline_bytes + bucket_array_bytes;

    size_t trie_total = (size_t)node_count * sizeof(TrieNode)
                       + (size_t)char_used
                       + (size_t)meta_count * sizeof(uint32_t);

    printf("--- Baseline (hash table, chaining, per-node malloc) ---\n");
    printf("  bucket array          : %zu bytes\n", bucket_array_bytes);
    printf("  nodes + name strings  : %zu bytes (incl. %d B/alloc overhead est.)\n", baseline_bytes, MALLOC_OVERHEAD);
    printf("  TOTAL                 : %zu bytes  (%.1f bytes/symbol)\n\n",
           baseline_total, (double)baseline_total / NUM_SYMBOLS);

    printf("--- Compressed (radix trie + arena + bit-packed meta) ---\n");
    printf("  trie nodes   : %u used x %zu B = %zu bytes\n", node_count, sizeof(TrieNode), node_count * sizeof(TrieNode));
    printf("  char pool    : %u bytes (shared prefixes stored once)\n", char_used);
    printf("  metadata pool: %u used x 4 B = %u bytes\n", meta_count, meta_count * 4);
    printf("  TOTAL                 : %zu bytes  (%.1f bytes/symbol)\n\n",
           trie_total, (double)trie_total / NUM_SYMBOLS);

    double savings = 100.0 * (1.0 - (double)trie_total / (double)baseline_total);
    printf("=== Compressed table uses %.1f%% less memory than baseline for %zu identifiers ===\n\n",
           savings, NUM_SYMBOLS);

    /* ---- simulated fixed RAM budgets: how many identifiers fit before exhaustion? ---- */
    size_t budgets[] = { 512, 1024, 1536, 2048 };
    printf("--- Simulated fixed RAM budget: identifiers fit before exhaustion ---\n");
    printf("  %-10s %-18s %-18s\n", "Budget", "Baseline fits", "Compressed fits");
    for (size_t b = 0; b < sizeof(budgets)/sizeof(budgets[0]); b++) {
        size_t budget = budgets[b];
        int base_fit = 0, trie_fit = 0;
        for (size_t i = 0; i < NUM_SYMBOLS; i++) {
            if (baseline_snapshot[i] <= budget) base_fit = (int)(i + 1); else break;
        }
        for (size_t i = 0; i < NUM_SYMBOLS; i++) {
            if (trie_snapshot[i] <= budget) trie_fit = (int)(i + 1); else break;
        }
        char base_str[24], trie_str[24];
        snprintf(base_str, sizeof(base_str), "%d / %zu%s", base_fit, (size_t)NUM_SYMBOLS,
                 base_fit == (int)NUM_SYMBOLS ? " (all)" : "");
        snprintf(trie_str, sizeof(trie_str), "%d / %zu%s", trie_fit, (size_t)NUM_SYMBOLS,
                 trie_fit == (int)NUM_SYMBOLS ? " (all)" : "");
        printf("  %-10zu %-18s %-18s\n", budget, base_str, trie_str);
    }
    printf("\n");

    return ok ? 0 : 1;
}