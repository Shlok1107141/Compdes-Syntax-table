/*
 * VARIANT ABC: radix trie + flat arena/16-bit indices + bit-packed metadata
 * ------------------------------------------------------------
 * All three techniques. This is the structure from the original prototype,
 * in the same harness form as the other variants.
 *
 * Layout is deliberately identical to Variant BC (10 B TrieNode, separate
 * meta_pool indexed by a uint16_t symbol_id) with the single difference that
 * meta_pool holds packed uint32_t words instead of 16 B unpacked structs.
 * That makes ABC - BC a clean measurement of bit-packing on top of trie+arena.
 *
 * Accounting: bytes USED in the three arenas (same convention as B / AB / BC).
 */
#include "symtab_common.h"

#define NIL        0xFFFF
#define ROOT       0
#define MAX_NODES  2048
#define MAX_CHARS  8192
#define MAX_SYMS   512

typedef struct {
    uint16_t first_child;
    uint16_t next_sibling;
    uint16_t edge_offset;
    uint8_t  edge_len;
    uint8_t  is_leaf;
    uint16_t symbol_id;      /* index into meta_pool when is_leaf */
} TrieNode;

static TrieNode node_pool[MAX_NODES];
static uint16_t node_count;
static char     char_pool[MAX_CHARS];
static uint16_t char_used;
static uint32_t meta_pool[MAX_SYMS];   /* 4b type | 8b scope | 4b storage | 16b off */
static uint16_t meta_count;

static uint32_t pack_meta(uint8_t type, uint8_t scope, uint8_t sc, uint16_t off) {
    return ((uint32_t)(type & 0xF) << 28) | ((uint32_t)scope << 20)
         | ((uint32_t)(sc & 0xF) << 16)   | (uint32_t)off;
}
static void unpack_meta(uint32_t m, uint8_t *type, uint8_t *scope, uint8_t *sc, uint16_t *off) {
    *type = (uint8_t)((m >> 28) & 0xF);
    *scope = (uint8_t)((m >> 20) & 0xFF);
    *sc = (uint8_t)((m >> 16) & 0xF);
    *off = (uint16_t)(m & 0xFFFF);
}

static uint16_t new_node(void) {
    if (node_count >= MAX_NODES) { fprintf(stderr, "node arena full\n"); exit(1); }
    uint16_t id = node_count++;
    node_pool[id].first_child = NIL;
    node_pool[id].next_sibling = NIL;
    node_pool[id].edge_offset = 0;
    node_pool[id].edge_len = 0;
    node_pool[id].is_leaf = 0;
    node_pool[id].symbol_id = NIL;
    return id;
}

static uint16_t pool_store(const char *chars, size_t len) {
    if ((size_t)char_used + len > MAX_CHARS) { fprintf(stderr, "char arena full\n"); exit(1); }
    uint16_t off = char_used;
    memcpy(&char_pool[off], chars, len);
    char_used = (uint16_t)(char_used + len);
    return off;
}

static uint16_t store_meta(const TestSymbol *s) {
    if (meta_count >= MAX_SYMS) { fprintf(stderr, "meta arena full\n"); exit(1); }
    meta_pool[meta_count] = pack_meta(s->type, s->scope, s->storage_class, s->offset);
    return meta_count++;
}

static void make_terminal(uint16_t node, const TestSymbol *s) {
    node_pool[node].is_leaf = 1;
    node_pool[node].symbol_id = store_meta(s);
}

static uint16_t *find_child_slot(uint16_t parent, char c) {
    uint16_t *slot = &node_pool[parent].first_child;
    while (*slot != NIL && char_pool[node_pool[*slot].edge_offset] != c)
        slot = &node_pool[*slot].next_sibling;
    return slot;
}

static void abc_init(void) {
    node_count = 0;
    char_used = 0;
    meta_count = 0;
    (void)new_node();            /* index 0 = ROOT; fields set to NIL, not 0 */
}

static void abc_insert(const TestSymbol *s) {
    const char *key = s->name;
    size_t len = strlen(key), pos = 0;
    uint16_t cur = ROOT;

    while (pos < len) {
        uint16_t *slot = find_child_slot(cur, key[pos]);

        if (*slot == NIL) {
            uint16_t leaf = new_node();
            node_pool[leaf].edge_offset = pool_store(key + pos, len - pos);
            node_pool[leaf].edge_len = (uint8_t)(len - pos);
            make_terminal(leaf, s);
            *slot = leaf;
            return;
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
                if (!node_pool[cur].is_leaf) make_terminal(cur, s);
                return;
            }
            continue;
        }

        uint16_t mid = new_node();
        node_pool[mid].edge_offset = e_off;
        node_pool[mid].edge_len = (uint8_t)cp;
        node_pool[mid].next_sibling = node_pool[child].next_sibling;

        node_pool[child].edge_offset = (uint16_t)(e_off + cp);
        node_pool[child].edge_len = (uint8_t)(e_len - cp);
        node_pool[child].next_sibling = NIL;
        node_pool[mid].first_child = child;

        *slot = mid;

        size_t remaining = len - (pos + cp);
        if (remaining == 0) {
            make_terminal(mid, s);
        } else {
            uint16_t leaf = new_node();
            node_pool[leaf].edge_offset = pool_store(key + pos + cp, remaining);
            node_pool[leaf].edge_len = (uint8_t)remaining;
            make_terminal(leaf, s);
            node_pool[child].next_sibling = leaf;
        }
        return;
    }
}

static uint16_t abc_find(const char *key) {
    size_t len = strlen(key), pos = 0;
    uint16_t cur = ROOT;
    while (pos < len) {
        uint16_t *slot = find_child_slot(cur, key[pos]);
        if (*slot == NIL) return NIL;
        uint16_t child = *slot;
        uint8_t e_len = node_pool[child].edge_len;
        if (e_len > len - pos) return NIL;
        if (memcmp(&char_pool[node_pool[child].edge_offset], key + pos, e_len) != 0) return NIL;
        pos += e_len;
        cur = child;
    }
    return node_pool[cur].is_leaf ? node_pool[cur].symbol_id : NIL;
}

static int abc_verify(const TestSymbol *s) {
    uint16_t id = abc_find(s->name);
    if (id == NIL) return 0;
    uint8_t t, sc, stc;
    uint16_t off;
    unpack_meta(meta_pool[id], &t, &sc, &stc, &off);
    return t == s->type && sc == s->scope && stc == s->storage_class && off == s->offset;
}
static int abc_absent(const char *k) { return abc_find(k) == NIL; }

static size_t abc_total(void) {
    return (size_t)node_count * sizeof(TrieNode)
         + (size_t)char_used
         + (size_t)meta_count * sizeof(uint32_t);
}
static size_t full_name_bytes(void) {
    size_t t = 0;
    for (size_t i = 0; i < NUM_SYMBOLS; i++) t += strlen(TEST_SYMBOLS[i].name) + 1;
    return t;
}
static void abc_breakdown(void) {
    printf("    sizeof(TrieNode)     : %zu B\n", sizeof(TrieNode));
    printf("    trie nodes           : %u x %zu = %zu B (incl. root)\n", (unsigned)node_count,
           sizeof(TrieNode), (size_t)node_count * sizeof(TrieNode));
    printf("    char pool            : %u B  (vs %zu B of full names in baseline)\n",
           (unsigned)char_used, full_name_bytes());
    printf("    meta pool            : %u x 4 = %zu B (packed)\n", (unsigned)meta_count,
           (size_t)meta_count * sizeof(uint32_t));
    printf("    allocator overhead   : 0 B (no malloc)\n");
}

int main(void) {
    static const Impl v = { "VARIANT ABC (radix trie + arena/16-bit indices + bit-packed meta)",
                            abc_init, abc_insert, abc_verify, abc_absent, abc_total, abc_breakdown };
    return run_experiment("Variant ABC: all three techniques", &v);
}
