/*
 * VARIANT BC: radix (Patricia) trie  AND  flat arena + 16-bit indices
 * ------------------------------------------------------------
 * Techniques applied : C (radix trie, shared prefixes stored once)
 *                      B (static node/char/meta arrays, uint16_t indices,
 *                         no per-object malloc)
 * NOT applied        : bit-packing. Metadata stays as four unpacked 32-bit
 *                      ints, stored in a separate meta_pool indexed by a
 *                      uint16_t symbol_id held in terminal nodes.
 *
 * Because edge labels are (offset, length) views into one char pool, an edge
 * split just re-slices the existing bytes: no label is copied or freed.
 *
 * Redeclaration: the node points at the newest metadata; each older one is
 * remembered by a 4 B ArenaShadow record. Unique names never use one.
 *
 * Accounting: bytes USED in the arenas (same convention as Variant B).
 */
#include "symtab_common.h"

#define ROOT 0

typedef struct {
    uint16_t first_child;    /* node index, NIL if none          */
    uint16_t next_sibling;   /* node index, NIL if none          */
    uint16_t edge_offset;    /* offset into char_pool            */
    uint8_t  edge_len;
    uint8_t  is_leaf;        /* 1 if node ends a stored identifier */
    uint16_t symbol_id;      /* index into meta_pool when is_leaf  */
} TrieNode;

typedef struct { int type, scope, storage_class, offset; } Meta;   /* unpacked */

static TrieNode    node_pool[ARENA_MAX_NODES];
static uint16_t    node_count;
static char        char_pool[ARENA_MAX_CHARS];
static uint16_t    char_used;
static Meta        meta_pool[ARENA_MAX_META];
static uint16_t    meta_count;
static ArenaShadow shadow_pool[ARENA_MAX_SHADOWS];
static uint16_t    shadow_count;

static uint16_t new_node(void) {
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
    uint16_t off = char_used;
    memcpy(&char_pool[off], chars, len);
    char_used = (uint16_t)(char_used + len);
    return off;
}

static void add_declaration(uint16_t node, const TestSymbol *s) {
    if (node_pool[node].is_leaf) {
        shadow_pool[shadow_count].node = node;
        shadow_pool[shadow_count].older = node_pool[node].symbol_id;
        shadow_count++;
    }
    Meta *m = &meta_pool[meta_count];
    m->type = s->type;
    m->scope = s->scope;
    m->storage_class = s->storage_class;
    m->offset = s->offset;
    node_pool[node].is_leaf = 1;
    node_pool[node].symbol_id = meta_count++;
}

/* Slot of the sibling list that holds a child whose edge starts with c,
 * or the NIL slot where one would be appended. */
static uint16_t *find_child_slot(uint16_t parent, char c) {
    uint16_t *slot = &node_pool[parent].first_child;
    while (*slot != NIL && char_pool[node_pool[*slot].edge_offset] != c)
        slot = &node_pool[*slot].next_sibling;
    return slot;
}

static void bc_init(void) {
    node_count = 0;
    char_used = 0;
    meta_count = 0;
    shadow_count = 0;
    (void)new_node();            /* index 0 = ROOT; fields set to NIL, not 0 */
}

static int bc_insert(const TestSymbol *s) {
    const char *key = s->name;
    size_t len = strlen(key), pos = 0;
    uint16_t cur = ROOT;

    /* Worst case for one insert: two nodes, every character, one metadata
     * record, one shadow record. Refuse up front rather than half-insert. */
    if ((size_t)node_count + 2 > ARENA_MAX_NODES || (size_t)char_used + len > ARENA_MAX_CHARS ||
        meta_count >= ARENA_MAX_META || shadow_count >= ARENA_MAX_SHADOWS) return -1;

    while (pos < len) {
        uint16_t *slot = find_child_slot(cur, key[pos]);

        if (*slot == NIL) {                        /* no matching edge: new leaf */
            uint16_t leaf = new_node();
            node_pool[leaf].edge_offset = pool_store(key + pos, len - pos);
            node_pool[leaf].edge_len = (uint8_t)(len - pos);
            add_declaration(leaf, s);
            *slot = leaf;
            return 0;
        }

        uint16_t child = *slot;
        uint16_t e_off = node_pool[child].edge_offset;
        uint8_t  e_len = node_pool[child].edge_len;

        size_t cp = 0;
        while (cp < e_len && pos + cp < len && char_pool[e_off + cp] == key[pos + cp]) cp++;

        if (cp == e_len) {                         /* full edge match: descend */
            pos += cp;
            cur = child;
            if (pos == len) {
                add_declaration(cur, s);
                return 0;
            }
            continue;
        }

        /* partial match: split edge at cp (re-slice existing bytes) */
        uint16_t mid = new_node();
        node_pool[mid].edge_offset = e_off;
        node_pool[mid].edge_len = (uint8_t)cp;
        node_pool[mid].next_sibling = node_pool[child].next_sibling;

        node_pool[child].edge_offset = (uint16_t)(e_off + cp);
        node_pool[child].edge_len = (uint8_t)(e_len - cp);
        node_pool[child].next_sibling = NIL;
        node_pool[mid].first_child = child;

        *slot = mid;                               /* mid takes child's place */

        size_t remaining = len - (pos + cp);
        if (remaining == 0) {
            add_declaration(mid, s);
        } else {
            uint16_t leaf = new_node();
            node_pool[leaf].edge_offset = pool_store(key + pos + cp, remaining);
            node_pool[leaf].edge_len = (uint8_t)remaining;
            add_declaration(leaf, s);
            node_pool[child].next_sibling = leaf;
        }
        return 0;
    }
    return 0;
}

/* Node that terminates key, or NIL. */
static uint16_t bc_find(const char *key) {
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
    return node_pool[cur].is_leaf ? cur : NIL;
}

static int meta_matches(uint16_t id, const TestSymbol *s) {
    const Meta *m = &meta_pool[id];
    return fields_match(m->type, m->scope, m->storage_class, m->offset, s);
}

static int bc_verify(const TestSymbol *s) {
    uint16_t node = bc_find(s->name);
    if (node == NIL) return 0;
    if (meta_matches(node_pool[node].symbol_id, s)) return 1;
    for (uint16_t i = 0; i < shadow_count; i++)
        if (shadow_pool[i].node == node && meta_matches(shadow_pool[i].older, s)) return 1;
    return 0;
}
static int bc_absent(const char *k) { return bc_find(k) == NIL; }

static size_t bc_total(void) {
    return (size_t)node_count * sizeof(TrieNode)
         + (size_t)char_used
         + (size_t)meta_count * sizeof(Meta)
         + (size_t)shadow_count * sizeof(ArenaShadow);
}
static void bc_breakdown(void) {
    printf("    sizeof(TrieNode)     : %zu B, sizeof(Meta) = %zu B\n", sizeof(TrieNode), sizeof(Meta));
    printf("    trie nodes           : %u x %zu = %zu B (incl. root)\n", (unsigned)node_count,
           sizeof(TrieNode), (size_t)node_count * sizeof(TrieNode));
    printf("    char pool            : %u B  (vs %zu B of full names in baseline)\n",
           (unsigned)char_used, test_name_bytes());
    printf("    meta pool            : %u x %zu = %zu B (unpacked)\n", (unsigned)meta_count,
           sizeof(Meta), (size_t)meta_count * sizeof(Meta));
    printf("    allocator overhead   : 0 B (no malloc)\n");
}

static void bc_destroy(void) { bc_init(); }   /* static arenas: nothing to free */

const Impl bc_impl = { "VARIANT BC (radix trie + arena/16-bit indices, unpacked meta)",
                       bc_init, bc_insert, bc_verify, bc_absent, bc_total, bc_breakdown, bc_destroy };

#ifndef SYMTAB_NO_MAIN
int main(void) {
    return run_experiment("Variant BC: trie + arena", &bc_impl);
}
#endif
