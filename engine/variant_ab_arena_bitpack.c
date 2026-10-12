/*
 * VARIANT AB: flat arena + 16-bit indices  AND  bit-packed metadata
 * ------------------------------------------------------------
 * Techniques applied : B (arena, uint16_t indices, flat char pool)
 *                      A (type/scope/storage/offset packed in one uint32_t)
 * NOT applied        : radix trie. Names are stored linearly, in full,
 *                      NUL-terminated, in a flat char pool (no prefix sharing).
 * Structure          : chained hash table, same hash_str() and bucket count
 *                      as the baseline.
 *
 * Accounting: bytes USED in the arenas + bucket array (same convention as
 * Variant B). No malloc, so no allocator overhead.
 */
#include "symtab_common.h"

#define NIL        0xFFFF
#define MAX_NODES  1024
#define MAX_CHARS  8192

typedef struct {
    uint16_t name_off;       /* offset of NUL-terminated name in char_pool */
    uint16_t next;           /* next node index in chain, or NIL           */
    uint32_t meta;           /* 4b type | 8b scope | 4b storage | 16b off  */
} ABNode;

static ABNode   node_pool[MAX_NODES];
static uint16_t node_count;
static char     char_pool[MAX_CHARS];
static uint16_t char_used;
static uint16_t buckets[HASH_BUCKETS];

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

static void ab_init(void) {
    memset(buckets, 0xFF, sizeof buckets);   /* all NIL (0 is a valid index) */
    node_count = 0;
    char_used = 0;
}

static void ab_insert(const TestSymbol *s) {
    size_t len = strlen(s->name) + 1;
    if (node_count >= MAX_NODES || char_used + len > MAX_CHARS) {
        fprintf(stderr, "arena full\n");
        exit(1);
    }
    uint16_t id = node_count++;
    ABNode *n = &node_pool[id];
    n->name_off = char_used;
    memcpy(&char_pool[char_used], s->name, len);
    char_used = (uint16_t)(char_used + len);
    n->meta = pack_meta(s->type, s->scope, s->storage_class, s->offset);
    unsigned b = hash_str(s->name);
    n->next = buckets[b];
    buckets[b] = id;
}

static const ABNode *ab_find(const char *name) {
    for (uint16_t i = buckets[hash_str(name)]; i != NIL; i = node_pool[i].next)
        if (strcmp(&char_pool[node_pool[i].name_off], name) == 0) return &node_pool[i];
    return NULL;
}

static int ab_verify(const TestSymbol *s) {
    const ABNode *n = ab_find(s->name);
    if (!n) return 0;
    uint8_t t, sc, stc;
    uint16_t off;
    unpack_meta(n->meta, &t, &sc, &stc, &off);
    return t == s->type && sc == s->scope && stc == s->storage_class && off == s->offset;
}
static int ab_absent(const char *k) { return ab_find(k) == NULL; }

static size_t ab_total(void) {
    return (size_t)node_count * sizeof(ABNode) + char_used + sizeof buckets;
}
static void ab_breakdown(void) {
    printf("    sizeof(ABNode)       : %zu B  (baseline HNode = %zu B)\n", sizeof(ABNode), sizeof(HNode));
    printf("    nodes                : %u x %zu = %zu B\n", (unsigned)node_count, sizeof(ABNode),
           (size_t)node_count * sizeof(ABNode));
    printf("    char pool (full names): %u B\n", (unsigned)char_used);
    printf("    bucket array         : %zu B  (uint16_t heads)\n", sizeof buckets);
    printf("    allocator overhead   : 0 B (no malloc)\n");
}

int main(void) {
    static const Impl v = { "VARIANT AB (arena + 16-bit indices + bit-packed meta, linear strings)",
                            ab_init, ab_insert, ab_verify, ab_absent, ab_total, ab_breakdown };
    return run_experiment("Variant AB: arena + bit-packing", &v);
}
