/*
 * VARIANT C: radix (Patricia) trie prefix sharing ONLY
 * ------------------------------------------------------------
 * Changed vs baseline : identifiers stored as a radix trie; shared prefixes
 *                       (counter_, sensor_, ...) are stored once.
 * Unchanged           : full 8-byte pointers (first_child / next_sibling),
 *                       malloc per trie node AND per edge label, metadata kept
 *                       as four unpacked ints, no arena, no 16-bit indices.
 *
 * Design choice (to keep the isolation honest): metadata lives in a separate
 * malloc'd Meta struct referenced by pointer from terminal nodes only. This
 * avoids charging 16 B of metadata to every internal (prefix) node. Embedding
 * it in TNode instead would be a different, worse trade-off and would
 * conflate "trie" with "node layout".
 *
 * Edge labels are heap strings (not NUL-terminated; length in edge_len).
 * Splitting an edge allocates the new prefix/suffix and frees the old label;
 * only live allocations at the end are charged.
 *
 * Redeclaration: the node keeps the newest Meta; each older one moves to a
 * malloc'd CShadow record. Unique-name workloads never allocate one.
 */
#include "symtab_common.h"

typedef struct { int type, scope, storage_class, offset; } Meta;

typedef struct TNode {
    char *edge;                    /* heap label, edge_len bytes, no NUL */
    struct TNode *first_child;
    struct TNode *next_sibling;
    Meta *meta;                    /* NULL for non-terminal nodes        */
    uint8_t edge_len;
} TNode;

typedef struct CShadow {
    const TNode    *owner;         /* node whose name was redeclared     */
    Meta           *meta;          /* the older declaration              */
    struct CShadow *next;
} CShadow;

static Tracker  T;
static TNode   *root;
static CShadow *shadows;

static TNode *new_node(const char *edge, size_t len) {
    TNode *n = t_alloc(&T, sizeof(TNode));
    n->first_child = n->next_sibling = NULL;
    n->meta = NULL;
    n->edge_len = (uint8_t)len;
    n->edge = NULL;
    if (len) { n->edge = t_alloc(&T, len); memcpy(n->edge, edge, len); }
    return n;
}

static void add_declaration(TNode *n, const TestSymbol *s) {
    if (n->meta) {
        CShadow *sh = t_alloc(&T, sizeof(CShadow));
        sh->owner = n;
        sh->meta = n->meta;
        sh->next = shadows;
        shadows = sh;
    }
    n->meta = t_alloc(&T, sizeof(Meta));
    n->meta->type = s->type; n->meta->scope = s->scope;
    n->meta->storage_class = s->storage_class; n->meta->offset = s->offset;
}

static TNode **find_child_slot(TNode *parent, char c) {
    TNode **slot = &parent->first_child;
    while (*slot && (*slot)->edge[0] != c) slot = &(*slot)->next_sibling;
    return slot;
}

static void c_init(void) { T.payload = T.allocs = 0; shadows = NULL; root = new_node(NULL, 0); }

static int c_insert(const TestSymbol *s) {
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
            pos += cp; cur = child;
            if (pos == len) { add_declaration(cur, s); return 0; }
            continue;
        }

        /* partial match: split child's edge at cp */
        TNode *mid = new_node(child->edge, cp);    /* shared prefix */
        mid->next_sibling = child->next_sibling;

        size_t suf = child->edge_len - cp;         /* shrink child to suffix */
        char *suffix = t_alloc(&T, suf);
        memcpy(suffix, child->edge + cp, suf);
        t_free(&T, child->edge, child->edge_len);
        child->edge = suffix;
        child->edge_len = (uint8_t)suf;
        child->next_sibling = NULL;

        mid->first_child = child;
        *slot = mid;

        size_t rem = len - (pos + cp);
        if (rem == 0) { add_declaration(mid, s); }
        else {
            TNode *leaf = new_node(key + pos + cp, rem);
            add_declaration(leaf, s);
            child->next_sibling = leaf;
        }
        return 0;
    }
    return 0;
}

static const TNode *c_find(const char *key) {
    size_t len = strlen(key), pos = 0;
    TNode *cur = root;
    while (pos < len) {
        TNode **slot = find_child_slot(cur, key[pos]);
        if (!*slot) return NULL;
        TNode *c = *slot;
        if (c->edge_len > len - pos) return NULL;
        if (memcmp(c->edge, key + pos, c->edge_len) != 0) return NULL;
        pos += c->edge_len; cur = c;
    }
    return cur->meta ? cur : NULL;
}

static int meta_matches(const Meta *m, const TestSymbol *s) {
    return fields_match(m->type, m->scope, m->storage_class, m->offset, s);
}

static int c_verify(const TestSymbol *s) {
    const TNode *n = c_find(s->name);
    if (!n) return 0;
    if (meta_matches(n->meta, s)) return 1;
    for (const CShadow *sh = shadows; sh; sh = sh->next)
        if (sh->owner == n && meta_matches(sh->meta, s)) return 1;
    return 0;
}
static int c_absent(const char *k) { return c_find(k) == NULL; }
static size_t c_total(void) { return t_total(&T); }

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
static void c_breakdown(void) {
    printf("    sizeof(TNode)        : %zu B, sizeof(Meta) = %zu B\n", sizeof(TNode), sizeof(Meta));
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
    if (n->meta) t_free(&T, n->meta, sizeof(Meta));
    t_free(&T, n, sizeof(TNode));
}

static void c_destroy(void) {
    while (shadows) {
        CShadow *next = shadows->next;
        t_free(&T, shadows->meta, sizeof(Meta));
        t_free(&T, shadows, sizeof(CShadow));
        shadows = next;
    }
    if (root) free_subtree(root);
    root = NULL;
}

const Impl c_impl = { "VARIANT C (radix trie prefix sharing only)",
                      c_init, c_insert, c_verify, c_absent, c_total, c_breakdown, c_destroy };

#ifndef SYMTAB_NO_MAIN
int main(void) {
    return run_experiment("Variant C: radix trie in isolation", &c_impl);
}
#endif
