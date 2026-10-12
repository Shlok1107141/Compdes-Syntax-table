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

typedef struct {
    uint16_t name_off;       /* offset of NUL-terminated name in char_pool */
    uint16_t next;           /* next node index in chain, or NIL           */
    uint32_t meta;           /* 4b type | 8b scope | 4b storage | 16b off  */
} ABNode;

static ABNode   node_pool[ARENA_MAX_ITEMS];
static uint16_t node_count;
static char     char_pool[ARENA_MAX_CHARS];
static uint16_t char_used;
static uint16_t buckets[HASH_BUCKETS];

static void ab_init(void) {
    memset(buckets, 0xFF, sizeof buckets);   /* all NIL (0 is a valid index) */
    node_count = 0;
    char_used = 0;
}

static int ab_insert(const TestSymbol *s) {
    size_t len = strlen(s->name) + 1;
    if (node_count >= ARENA_MAX_ITEMS || (size_t)char_used + len > ARENA_MAX_CHARS) return -1;
    uint16_t id = node_count++;
    ABNode *n = &node_pool[id];
    n->name_off = char_used;
    memcpy(&char_pool[char_used], s->name, len);
    char_used = (uint16_t)(char_used + len);
    n->meta = pack_symbol(s);
    unsigned b = hash_str(s->name);
    n->next = buckets[b];
    buckets[b] = id;
    return 0;
}

static int ab_verify(const TestSymbol *s) {
    for (uint16_t i = buckets[hash_str(s->name)]; i != NIL; i = node_pool[i].next)
        if (strcmp(&char_pool[node_pool[i].name_off], s->name) == 0 &&
            packed_matches(node_pool[i].meta, s)) return 1;
    return 0;
}

static int ab_absent(const char *k) {
    for (uint16_t i = buckets[hash_str(k)]; i != NIL; i = node_pool[i].next)
        if (strcmp(&char_pool[node_pool[i].name_off], k) == 0) return 0;
    return 1;
}

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

static void ab_destroy(void) { ab_init(); }   /* static arenas: nothing to free */

const Impl ab_impl = { "VARIANT AB (arena + 16-bit indices + bit-packed meta, linear strings)",
                       ab_init, ab_insert, ab_verify, ab_absent, ab_total, ab_breakdown, ab_destroy };

#ifndef SYMTAB_NO_MAIN
int main(void) {
    return run_experiment("Variant AB: arena + bit-packing", &ab_impl);
}
#endif
