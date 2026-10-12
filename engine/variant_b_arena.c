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

#define NIL        0xFFFF
#define MAX_NODES  1024
#define MAX_CHARS  8192

typedef struct {
    uint16_t name_off;       /* offset of NUL-terminated name in char_pool */
    uint16_t next;           /* index of next node in chain, or NIL        */
    int type, scope, storage_class, offset;   /* deliberately unpacked     */
} ANode;

static ANode    node_pool[MAX_NODES];
static uint16_t node_count;
static char     char_pool[MAX_CHARS];
static uint16_t char_used;
static uint16_t buckets[HASH_BUCKETS];

static void b_init(void) {
    memset(buckets, 0xFF, sizeof buckets);   /* all NIL (0 is a valid index!) */
    node_count = 0; char_used = 0;
}

static void b_insert(const TestSymbol *s) {
    size_t len = strlen(s->name) + 1;
    if (node_count >= MAX_NODES || char_used + len > MAX_CHARS) { fprintf(stderr, "arena full\n"); exit(1); }
    uint16_t id = node_count++;
    ANode *n = &node_pool[id];
    n->name_off = char_used;
    memcpy(&char_pool[char_used], s->name, len);
    char_used += (uint16_t)len;
    n->type = s->type; n->scope = s->scope;
    n->storage_class = s->storage_class; n->offset = s->offset;
    unsigned b = hash_str(s->name);
    n->next = buckets[b];
    buckets[b] = id;
}

static ANode *b_find(const char *name) {
    for (uint16_t i = buckets[hash_str(name)]; i != NIL; i = node_pool[i].next)
        if (strcmp(&char_pool[node_pool[i].name_off], name) == 0) return &node_pool[i];
    return NULL;
}

static int b_verify(const TestSymbol *s) {
    ANode *n = b_find(s->name);
    return n && n->type == s->type && n->scope == s->scope &&
           n->storage_class == s->storage_class && n->offset == s->offset;
}
static int b_absent(const char *k) { return b_find(k) == NULL; }
static size_t b_total(void) {
    return (size_t)node_count * sizeof(ANode) + char_used + sizeof buckets;
}
static void b_breakdown(void) {
    printf("    sizeof(ANode)        : %zu B  (baseline HNode = %zu B)\n", sizeof(ANode), sizeof(HNode));
    printf("    nodes                : %u x %zu = %zu B\n", node_count, sizeof(ANode), node_count * sizeof(ANode));
    printf("    char pool (full names): %u B\n", char_used);
    printf("    bucket array         : %zu B  (uint16_t heads)\n", sizeof buckets);
    printf("    allocator overhead   : 0 B (no malloc)\n");
}

int main(void) {
    static const Impl v = { "VARIANT B (flat arena + 16-bit indices only)",
                            b_init, b_insert, b_verify, b_absent, b_total, b_breakdown };
    return run_experiment("Variant B: arena + 16-bit indices in isolation", &v);
}
