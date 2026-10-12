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
 *
 * Redeclaration: the node keeps the newest word; each older one moves to a
 * malloc'd ACShadow record. Unique-name workloads never allocate one.
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

typedef struct ACShadow {
    const TNode     *owner;        /* node whose name was redeclared  */
    uint32_t         meta;         /* the older declaration, packed   */
    struct ACShadow *next;
} ACShadow;

static Tracker   T;
static TNode    *root;
static ACShadow *shadows;

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

static void add_declaration(TNode *n, const TestSymbol *s) {
    if (n->is_term) {
        ACShadow *sh = t_alloc(&T, sizeof(ACShadow));
        sh->owner = n;
        sh->meta = n->meta;
        sh->next = shadows;
        shadows = sh;
    }
    n->meta = pack_symbol(s);
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
    shadows = NULL;
    root = new_node(NULL, 0);
}

static int ac_insert(const TestSymbol *s) {
    const char *key = s->name;
    size_t len = strlen(key), pos = 0;
    TNode *cur = root;

    while (pos < len) {
        TNode **slot = find_child_slot(cur, key[pos]);

        if (!*slot) {                              /* no matching edge: new leaf */
            TNode *leaf = new_node(key + pos, len - pos);
            add_declaration(leaf, s);
            *slot = leaf;
            return 0;
        }

        TNode *child = *slot;
        size_t cp = 0;
        while (cp < child->edge_len && pos + cp < len && child->edge[cp] == key[pos + cp]) cp++;

        if (cp == child->edge_len) {               /* full edge match: descend */
            pos += cp;
            cur = child;
            if (pos == len) {
                add_declaration(cur, s);
                return 0;
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
            add_declaration(mid, s);
        } else {
            TNode *leaf = new_node(key + pos + cp, rem);
            add_declaration(leaf, s);
            child->next_sibling = leaf;
        }
        return 0;
    }
    return 0;
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
    if (packed_matches(n->meta, s)) return 1;
    for (const ACShadow *sh = shadows; sh; sh = sh->next)
        if (sh->owner == n && packed_matches(sh->meta, s)) return 1;
    return 0;
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
static void ac_breakdown(void) {
    printf("    sizeof(TNode)        : %zu B\n", sizeof(TNode));
    printf("    trie nodes           : %zu (incl. root)\n", count_nodes(root));
    printf("    edge label bytes     : %zu B  (vs %zu B of full names in baseline)\n",
           count_edge_bytes(root), test_name_bytes());
    printf("    live allocations     : %zu (%zu B payload + %zu B overhead)\n",
           T.allocs, T.payload, T.allocs * (size_t)MALLOC_OVERHEAD);
}

static void free_subtree(TNode *n) {
    TNode *child = n->first_child;
    while (child) {
        TNode *next = child->next_sibling;
        free_subtree(child);
        child = next;
    }
    if (n->edge) t_free(&T, n->edge, n->edge_len);
    t_free(&T, n, sizeof(TNode));
}

static void ac_destroy(void) {
    while (shadows) {
        ACShadow *next = shadows->next;
        t_free(&T, shadows, sizeof(ACShadow));
        shadows = next;
    }
    if (root) free_subtree(root);
    root = NULL;
}

const Impl ac_impl = { "VARIANT AC (radix trie + bit-packed meta, pointers + malloc)",
                       ac_init, ac_insert, ac_verify, ac_absent, ac_total, ac_breakdown, ac_destroy };

#ifndef SYMTAB_NO_MAIN
int main(void) {
    return run_experiment("Variant AC: trie + bit-packing", &ac_impl);
}
#endif
