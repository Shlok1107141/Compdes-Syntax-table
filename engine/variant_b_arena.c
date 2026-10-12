/*
 * VARIANT B: flat arena + 16-bit indices ONLY
 * ------------------------------------------------------------
 * Changed vs baseline : nodes live in a static array; next-links and bucket
 *                       heads are uint16_t indices (not 8-byte pointers);
 *                       names are copied into one contiguous char pool and
 *                       referenced by a uint16_t offset; no per-object malloc,
 *                       so zero allocator overhead.
 * Unchanged           : hash table + separate chaining, metadata stays four
 *                       unpacked 32-bit ints, every name stored in full
 *                       (NO prefix sharing).
 *
 * Accounting: bytes USED in the arenas (nodes*sizeof + chars used) + buckets,
 * same "used, not reserved" convention as the original prototype.
 */
#include "symtab_common.h"

typedef struct {
    uint16_t name_off;       /* offset of NUL-terminated name in char_pool */
    uint16_t next;           /* index of next node in chain, or NIL        */
    int type, scope, storage_class, offset;   /* deliberately unpacked     */
} ANode;

static ANode    node_pool[ARENA_MAX_ITEMS];
static uint16_t node_count;
static char     char_pool[ARENA_MAX_CHARS];
static uint16_t char_used;
static uint16_t buckets[HASH_BUCKETS];

static void b_init(void) {
    memset(buckets, 0xFF, sizeof buckets);   /* all NIL (0 is a valid index!) */
    node_count = 0; char_used = 0;
}

static int b_insert(const TestSymbol *s) {
    size_t len = strlen(s->name) + 1;
    if (node_count >= ARENA_MAX_ITEMS || (size_t)char_used + len > ARENA_MAX_CHARS) return -1;
    uint16_t id = node_count++;
    ANode *n = &node_pool[id];
    n->name_off = char_used;
    memcpy(&char_pool[char_used], s->name, len);
    char_used = (uint16_t)(char_used + len);
    n->type = s->type; n->scope = s->scope;
    n->storage_class = s->storage_class; n->offset = s->offset;
    unsigned b = hash_str(s->name);
    n->next = buckets[b];
    buckets[b] = id;
    return 0;
}

static int b_verify(const TestSymbol *s) {
    for (uint16_t i = buckets[hash_str(s->name)]; i != NIL; i = node_pool[i].next) {
        const ANode *n = &node_pool[i];
        if (strcmp(&char_pool[n->name_off], s->name) == 0 &&
            fields_match(n->type, n->scope, n->storage_class, n->offset, s)) return 1;
    }
    return 0;
}

static int b_absent(const char *k) {
    for (uint16_t i = buckets[hash_str(k)]; i != NIL; i = node_pool[i].next)
        if (strcmp(&char_pool[node_pool[i].name_off], k) == 0) return 0;
    return 1;
}

static size_t b_total(void) {
    return (size_t)node_count * sizeof(ANode) + char_used + sizeof buckets;
}

static void b_breakdown(void) {
    printf("    sizeof(ANode)        : %zu B  (baseline HNode = %zu B)\n", sizeof(ANode), sizeof(HNode));
    printf("    nodes                : %u x %zu = %zu B\n", (unsigned)node_count, sizeof(ANode),
           (size_t)node_count * sizeof(ANode));
    printf("    char pool (full names): %u B\n", (unsigned)char_used);
    printf("    bucket array         : %zu B  (uint16_t heads)\n", sizeof buckets);
    printf("    allocator overhead   : 0 B (no malloc)\n");
}

static void b_destroy(void) { b_init(); }   /* static arenas: nothing to free */

const Impl b_impl = { "VARIANT B (flat arena + 16-bit indices only)",
                      b_init, b_insert, b_verify, b_absent, b_total, b_breakdown, b_destroy };

#ifndef SYMTAB_NO_MAIN
int main(void) {
    return run_experiment("Variant B: arena + 16-bit indices in isolation", &b_impl);
}
#endif
