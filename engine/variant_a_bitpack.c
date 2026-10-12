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

static uint32_t pack_meta(uint8_t type, uint8_t scope, uint8_t sc, uint16_t off) {
    return ((uint32_t)(type & 0xF) << 28) | ((uint32_t)scope << 20)
         | ((uint32_t)(sc & 0xF) << 16)   | (uint32_t)off;
}
static void unpack_meta(uint32_t m, uint8_t *type, uint8_t *scope, uint8_t *sc, uint16_t *off) {
    *type = (m >> 28) & 0xF; *scope = (m >> 20) & 0xFF;
    *sc = (m >> 16) & 0xF;   *off = m & 0xFFFF;
}

static void a_init(void) { memset(buckets, 0, sizeof buckets); T.payload = T.allocs = 0; }

static void a_insert(const TestSymbol *s) {
    PNode *n = t_alloc(&T, sizeof(PNode));
    n->name = t_alloc(&T, strlen(s->name) + 1);
    strcpy(n->name, s->name);
    n->meta = pack_meta(s->type, s->scope, s->storage_class, s->offset);
    unsigned b = hash_str(s->name);
    n->next = buckets[b];
    buckets[b] = n;
}

static PNode *a_find(const char *name) {
    for (PNode *n = buckets[hash_str(name)]; n; n = n->next)
        if (strcmp(n->name, name) == 0) return n;
    return NULL;
}

static int a_verify(const TestSymbol *s) {
    PNode *n = a_find(s->name);
    if (!n) return 0;
    uint8_t t, sc, stc; uint16_t off;
    unpack_meta(n->meta, &t, &sc, &stc, &off);
    return t == s->type && sc == s->scope && stc == s->storage_class && off == s->offset;
}
static int a_absent(const char *k) { return a_find(k) == NULL; }
static size_t a_total(void) { return t_total(&T) + sizeof buckets; }
static void a_breakdown(void) {
    printf("    sizeof(PNode)        : %zu B  (baseline HNode = %zu B)\n", sizeof(PNode), sizeof(HNode));
    printf("    bucket array         : %zu B\n", sizeof buckets);
    printf("    live allocations     : %zu (%zu B payload + %zu B overhead)\n",
           T.allocs, T.payload, T.allocs * (size_t)MALLOC_OVERHEAD);
}

int main(void) {
    static const Impl v = { "VARIANT A (bit-packed metadata only)",
                            a_init, a_insert, a_verify, a_absent, a_total, a_breakdown };
    return run_experiment("Variant A: bit-packing in isolation", &v);
}
