/*
 * symtab_stress.c
 * ------------------------------------------------------------
 * Stress/scaling harness for the Review 0 prototype.
 * Reuses the same baseline (hash+chaining) and compressed
 * (radix trie + arena + bit-packed meta) structures as
 * symtab_demo.c, but:
 *   - sweeps identifier count N across a range
 *   - tests TWO identifier patterns:
 *       REALISTIC : subsystem_field naming (like real embedded
 *                   code -- sensor_id, sensor_value, buffer_ptr...)
 *       RANDOM    : near-random names with minimal shared
 *                   prefixes (worst case for the trie)
 *   - verifies correctness at every N before trusting the numbers
 *   - prints machine-parseable "DATA," lines + a human summary
 * ------------------------------------------------------------
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#define MALLOC_OVERHEAD 16

/* ============================================================
 * BASELINE: hash table with separate chaining
 * ============================================================ */

typedef struct HNode {
    char *name;
    struct HNode *next;
    int type;
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

static void baseline_insert(const char *name) {
    HNode *n = counting_malloc(sizeof(HNode));
    n->name = counting_malloc(strlen(name) + 1);
    strcpy(n->name, name);
    n->type = 0;
    unsigned b = hash_str(name);
    n->next = baseline_buckets[b];
    baseline_buckets[b] = n;
}

static int baseline_lookup_ok(const char *name) {
    unsigned b = hash_str(name);
    for (HNode *n = baseline_buckets[b]; n; n = n->next)
        if (strcmp(n->name, name) == 0) return 1;
    return 0;
}

static void baseline_reset(void) {
    for (int i = 0; i < HASH_BUCKETS; i++) {
        HNode *n = baseline_buckets[i];
        while (n) { HNode *next = n->next; free(n->name); free(n); n = next; }
        baseline_buckets[i] = NULL;
    }
    baseline_bytes = 0;
}

/* ============================================================
 * COMPRESSED: radix (Patricia) trie + arena + bit-packed meta
 * ============================================================ */

#define MAX_NODES 4096
#define MAX_CHARS 16384
#define MAX_SYMS  1024
#define NIL       0xFFFF
#define ROOT      0

typedef struct {
    uint16_t first_child;
    uint16_t next_sibling;
    uint16_t edge_offset;
    uint8_t  edge_len;
    uint8_t  is_leaf;
    uint16_t symbol_id;
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

static void trie_reset(void) {
    node_count = 1;
    node_pool[ROOT].first_child = NIL;
    node_pool[ROOT].next_sibling = NIL;
    node_pool[ROOT].is_leaf = 0;
    char_used = 0;
    meta_count = 0;
}

static uint16_t pool_store(const char *chars, uint8_t len) {
    if (char_used + len > MAX_CHARS) { fprintf(stderr, "char arena full\n"); exit(1); }
    uint16_t off = char_used;
    memcpy(&char_pool[off], chars, len);
    char_used += len;
    return off;
}

static uint16_t store_metadata(uint32_t packed) {
    if (meta_count >= MAX_SYMS) { fprintf(stderr, "meta arena full\n"); exit(1); }
    meta_pool[meta_count] = packed;
    return meta_count++;
}

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

        uint16_t mid = new_node();
        node_pool[mid].edge_offset = e_off;
        node_pool[mid].edge_len = (uint8_t)cp;
        node_pool[mid].next_sibling = node_pool[child].next_sibling;

        node_pool[child].edge_offset = e_off + cp;
        node_pool[child].edge_len = (uint8_t)(e_len - cp);
        node_pool[child].next_sibling = NIL;
        node_pool[mid].first_child = child;

        *slot = mid;

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
    return NIL;
}

static int trie_lookup_ok(const char *key) {
    size_t len = strlen(key);
    uint16_t cur = ROOT;
    size_t pos = 0;
    while (pos < len) {
        uint16_t *slot = find_child_slot(cur, key[pos]);
        if (*slot == NIL) return 0;
        uint16_t child = *slot;
        uint16_t e_off = node_pool[child].edge_offset;
        uint8_t  e_len = node_pool[child].edge_len;
        if (e_len > len - pos) return 0;
        if (memcmp(&char_pool[e_off], key + pos, e_len) != 0) return 0;
        pos += e_len;
        cur = child;
    }
    return node_pool[cur].is_leaf;
}

/* ============================================================
 * Identifier generators
 * ============================================================ */

static const char *PREFIXES[] = {
    "sensor","buffer","status","config","handler","timer","uart","spi","adc","gpio",
    "motor","temp","batt","wifi","flash","crc","dma","isr","task","queue",
    "led","pwm","clock","reset","boot"
};
#define NUM_PREFIXES (sizeof(PREFIXES)/sizeof(PREFIXES[0]))

static const char *SUFFIXES[] = {
    "id","value","flag","state","count","max","min","size","ptr","addr",
    "len","reset","init","read","write","buffer","mask","offset","index","enable"
};
#define NUM_SUFFIXES (sizeof(SUFFIXES)/sizeof(SUFFIXES[0]))

/* subsystem_field pattern -- mirrors real embedded C naming conventions,
 * so identifiers sharing a subsystem share a prefix (what the trie compresses). */
static void gen_realistic_name(char *buf, size_t idx) {
    size_t prefix_i = (idx / NUM_SUFFIXES) % NUM_PREFIXES;
    size_t suffix_i = idx % NUM_SUFFIXES;
    snprintf(buf, 32, "%s_%s", PREFIXES[prefix_i], SUFFIXES[suffix_i]);
}

/* Near-random names: a cheap xorshift32 PRNG (seeded per-index, so the run
 * is deterministic/reproducible) picks 6-13 lowercase letters, with the
 * index base-36 encoded on the end purely to guarantee uniqueness -- the
 * point is the FRONT of the name (what the trie would compress) is
 * effectively random, i.e. worst case for prefix sharing. */
static void gen_random_name(char *buf, size_t idx) {
    uint32_t x = (uint32_t)(idx * 2654435761u + 1);
    size_t len = 6 + (x % 8); /* 6..13 */
    size_t p = 0;
    for (size_t i = 0; i < len; i++) {
        x ^= x << 13; x ^= x >> 17; x ^= x << 5;
        buf[p++] = 'a' + (x % 26);
    }
    buf[p++] = '_';
    /* base36 suffix for guaranteed uniqueness */
    size_t v = idx;
    char tmp[8]; int t = 0;
    if (v == 0) tmp[t++] = '0';
    while (v > 0) { size_t d = v % 36; tmp[t++] = d < 10 ? ('0'+d) : ('a'+d-10); v /= 36; }
    while (t > 0) buf[p++] = tmp[--t];
    buf[p] = '\0';
}

/* ============================================================
 * One (pattern, N) trial
 * ============================================================ */

static void run_trial(const char *pattern_name, void (*gen)(char*, size_t), size_t N) {
    baseline_reset();
    trie_reset();

    char names[512][32];
    for (size_t i = 0; i < N; i++) {
        gen(names[i], i);
        baseline_insert(names[i]);
        trie_insert(names[i], (uint32_t)i);
    }

    int ok = 1;
    for (size_t i = 0; i < N; i++) {
        if (!baseline_lookup_ok(names[i])) { fprintf(stderr, "BASELINE FAIL %s\n", names[i]); ok = 0; }
        if (!trie_lookup_ok(names[i])) { fprintf(stderr, "TRIE FAIL %s\n", names[i]); ok = 0; }
    }
    /* duplicate check: ensure generator produced N unique names (else the
     * comparison would be unfair -- fewer real entries than claimed) */
    for (size_t i = 0; i < N && ok; i++)
        for (size_t j = i + 1; j < N; j++)
            if (strcmp(names[i], names[j]) == 0) {
                fprintf(stderr, "DUPLICATE NAME GENERATED: %s\n", names[i]);
                ok = 0;
                break;
            }

    size_t baseline_total = baseline_bytes + sizeof(baseline_buckets);
    size_t trie_total = (size_t)node_count * sizeof(TrieNode)
                       + (size_t)char_used
                       + (size_t)meta_count * sizeof(uint32_t);

    if (!ok) {
        printf("DATA,%s,%zu,FAILED,FAILED\n", pattern_name, N);
        return;
    }
    printf("DATA,%s,%zu,%zu,%zu\n", pattern_name, N, baseline_total, trie_total);
}

int main(void) {
    size_t sweep[] = { 10, 20, 30, 50, 75, 100, 150, 200, 300 };
    size_t num_sweep = sizeof(sweep) / sizeof(sweep[0]);

    printf("=== Stress / Scaling Simulation ===\n");
    printf("(DATA lines are machine-parseable: DATA,pattern,N,baseline_bytes,trie_bytes)\n\n");

    printf("--- Pattern: REALISTIC (subsystem_field naming, like real embedded code) ---\n");
    for (size_t i = 0; i < num_sweep; i++) run_trial("realistic", gen_realistic_name, sweep[i]);

    printf("\n--- Pattern: RANDOM (minimal shared prefixes -- worst case) ---\n");
    for (size_t i = 0; i < num_sweep; i++) run_trial("random", gen_random_name, sweep[i]);

    printf("\n=== Simulation complete ===\n");
    return 0;
}