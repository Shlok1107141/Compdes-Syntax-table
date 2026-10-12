/*
 * VARIANT A: bit-packed metadata ONLY
 * ------------------------------------------------------------
 * Changed vs baseline : type/scope/storage_class/offset packed into one uint32_t.
 * Unchanged           : hash table + separate chaining, malloc per node,
 *                       malloc per name string, full 8-byte pointers,
 *                       64 x pointer bucket array, no string sharing.
 *
 * Expected effect: node payload drops 16 B -> 4 B of metadata, but struct
 * padding (8-byte alignment from pointers) eats part of it. sizeof(PNode) is
 * printed so the real saving is visible.
 */
#include "symtab_common.h"

typedef struct PNode {
    char *name;
    struct PNode *next;
    uint32_t meta;           /* 4b type | 8b scope | 4b storage | 16b offset */
} PNode;

static PNode  *buckets[HASH_BUCKETS];
static Tracker T;

static void a_init(void) { memset(buckets, 0, sizeof buckets); T.payload = T.allocs = 0; }

static int a_insert(const TestSymbol *s) {
    PNode *n = t_alloc(&T, sizeof(PNode));
    n->name = t_alloc(&T, strlen(s->name) + 1);
    strcpy(n->name, s->name);
    n->meta = pack_symbol(s);
    unsigned b = hash_str(s->name);
    n->next = buckets[b];
    buckets[b] = n;
    return 0;
}

static int a_verify(const TestSymbol *s) {
    for (PNode *n = buckets[hash_str(s->name)]; n; n = n->next)
        if (strcmp(n->name, s->name) == 0 && packed_matches(n->meta, s)) return 1;
    return 0;
}

static int a_absent(const char *k) {
    for (PNode *n = buckets[hash_str(k)]; n; n = n->next)
        if (strcmp(n->name, k) == 0) return 0;
    return 1;
}

static size_t a_total(void) { return t_total(&T) + sizeof buckets; }

static void a_breakdown(void) {
    printf("    sizeof(PNode)        : %zu B  (baseline HNode = %zu B)\n", sizeof(PNode), sizeof(HNode));
    printf("    bucket array         : %zu B\n", sizeof buckets);
    printf("    live allocations     : %zu (%zu B payload + %zu B overhead)\n",
           T.allocs, T.payload, T.allocs * (size_t)MALLOC_OVERHEAD);
}

static void a_destroy(void) {
    for (size_t b = 0; b < HASH_BUCKETS; b++) {
        PNode *n = buckets[b];
        while (n) {
            PNode *next = n->next;
            t_free(&T, n->name, strlen(n->name) + 1);
            t_free(&T, n, sizeof(PNode));
            n = next;
        }
        buckets[b] = NULL;
    }
}

const Impl a_impl = { "VARIANT A (bit-packed metadata only)",
                      a_init, a_insert, a_verify, a_absent, a_total, a_breakdown, a_destroy };

#ifndef SYMTAB_NO_MAIN
int main(void) {
    return run_experiment("Variant A: bit-packing in isolation", &a_impl);
}
#endif
