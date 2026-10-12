/*
 * VARIANT AC: radix (Patricia) trie  AND  bit-packed metadata
 * ------------------------------------------------------------
 * Techniques applied : C (radix trie, shared prefixes stored once)
 *                      A (metadata packed into one uint32_t)
 * NOT applied        : arena / 16-bit indices. Full 8-byte pointers
 *                      (first_child / next_sibling), malloc per trie node,
 *                      malloc per edge label.
 *
 * Layout note: the packed metadata word is embedded in TNode rather than
 * malloc'd separately (Variant C had to use a separate Meta struct so that
 * 16 B of ints weren't charged to every internal prefix node). At 4 B the
 * word fits in padding the node would carry anyway:
 *     3 pointers (24) + uint32_t (4) + edge_len (1) + is_term (1) -> 32 B
 * so internal nodes pay nothing extra for it. This layout change is part of
 * "applying bit-packing to the trie" and is called out so it can be
 * accounted for when comparing against Variant C.
 *
 * Edge labels are heap strings without a NUL (length in edge_len). Splitting
 * an edge allocates the new prefix/suffix and frees the old label; only live
 * allocations at the end are charged.
 */
#include "symtab_common.h"

typedef struct TNode {
    char *edge;                    /* heap label, edge_len bytes, no NUL */
    struct TNode *first_child;
    struct TNode *next_sibling;
    uint32_t meta;                 /* 4b type | 8b scope | 4b storage | 16b off */
    uint8_t edge_len;
    uint8_t is_term;               /* 1 if this node ends a stored identifier   */
} TNode;

static Tracker T;
static TNode  *root;

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

static TNode *new_node(const char *edge, size_t len) {
    TNode *n = t_alloc(&T, sizeof(TNode));
    n->edge = NULL;
    n->first_child = NULL;
    n->next_sibling = NULL;
    n->meta = 0;
    n->edge_len = (uint8_t)len;
    n->is_term = 0;
    if (len) {
        n->edge = t_alloc(&T, len);
        memcpy(n->edge, edge, len);
    }
    return n;
}

static void set_term(TNode *n, const TestSymbol *s) {
    n->meta = pack_meta(s->type, s->scope, s->storage_class, s->offset);
    n->is_term = 1;
}

static TNode **find_child_slot(TNode *parent, char c) {
    TNode **slot = &parent->first_child;
    while (*slot && (*slot)->edge[0] != c) slot = &(*slot)->next_sibling;
    return slot;
}

static void ac_init(void) {
    T.payload = 0;
    T.allocs = 0;
    root = new_node(NULL, 0);
}

static void ac_insert(const TestSymbol *s) {
    const char *key = s->name;
    size_t len = strlen(key), pos = 0;
    TNode *cur = root;

    while (pos < len) {
        TNode **slot = find_child_slot(cur, key[pos]);

        if (!*slot) {                              /* no matching edge: new leaf */
            TNode *leaf = new_node(key + pos, len - pos);
            set_term(leaf, s);
            *slot = leaf;
            return;
        }

        TNode *child = *slot;
        size_t cp = 0;
        while (cp < child->edge_len && pos + cp < len && child->edge[cp] == key[pos + cp]) cp++;

        if (cp == child->edge_len) {               /* full edge match: descend */
            pos += cp;
            cur = child;
            if (pos == len) {
                if (!cur->is_term) set_term(cur, s);
                return;
            }
            continue;
        }

        /* partial match: split child's edge at cp */
        TNode *mid = new_node(child->edge, cp);    /* shared prefix */
        mid->next_sibling = child->next_sibling;

        size_t suf = (size_t)child->edge_len - cp; /* shrink child to suffix */
        char *suffix = t_alloc(&T, suf);
        memcpy(suffix, child->edge + cp, suf);
        t_free(&T, child->edge, child->edge_len);
        child->edge = suffix;
        child->edge_len = (uint8_t)suf;
        child->next_sibling = NULL;

        mid->first_child = child;
        *slot = mid;

        size_t rem = len - (pos + cp);
        if (rem == 0) {
            set_term(mid, s);
        } else {
            TNode *leaf = new_node(key + pos + cp, rem);
            set_term(leaf, s);
            child->next_sibling = leaf;
        }
        return;
    }
}

static const TNode *ac_find(const char *key) {
    size_t len = strlen(key), pos = 0;
    const TNode *cur = root;
    while (pos < len) {
        TNode **slot = find_child_slot((TNode *)cur, key[pos]);
        if (!*slot) return NULL;
        const TNode *c = *slot;
        if (c->edge_len > len - pos) return NULL;
        if (memcmp(c->edge, key + pos, c->edge_len) != 0) return NULL;
        pos += c->edge_len;
        cur = c;
    }
    return cur->is_term ? cur : NULL;
}

static int ac_verify(const TestSymbol *s) {
    const TNode *n = ac_find(s->name);
    if (!n) return 0;
    uint8_t t, sc, stc;
    uint16_t off;
    unpack_meta(n->meta, &t, &sc, &stc, &off);
    return t == s->type && sc == s->scope && stc == s->storage_class && off == s->offset;
}
static int ac_absent(const char *k) { return ac_find(k) == NULL; }
static size_t ac_total(void) { return t_total(&T); }

static size_t count_nodes(const TNode *n) {
    size_t c = 1;
    for (const TNode *k = n->first_child; k; k = k->next_sibling) c += count_nodes(k);
    return c;
}
static size_t count_edge_bytes(const TNode *n) {
    size_t c = n->edge_len;
    for (const TNode *k = n->first_child; k; k = k->next_sibling) c += count_edge_bytes(k);
    return c;
}
static size_t full_name_bytes(void) {
    size_t t = 0;
    for (size_t i = 0; i < NUM_SYMBOLS; i++) t += strlen(TEST_SYMBOLS[i].name) + 1;
    return t;
}
static void ac_breakdown(void) {
    printf("    sizeof(TNode)        : %zu B\n", sizeof(TNode));
    printf("    trie nodes           : %zu (incl. root)\n", count_nodes(root));
    printf("    edge label bytes     : %zu B  (vs %zu B of full names in baseline)\n",
           count_edge_bytes(root), full_name_bytes());
    printf("    live allocations     : %zu (%zu B payload + %zu B overhead)\n",
           T.allocs, T.payload, T.allocs * (size_t)MALLOC_OVERHEAD);
}

int main(void) {
    static const Impl v = { "VARIANT AC (radix trie + bit-packed meta, pointers + malloc)",
                            ac_init, ac_insert, ac_verify, ac_absent, ac_total, ac_breakdown };
    return run_experiment("Variant AC: trie + bit-packing", &v);
}
