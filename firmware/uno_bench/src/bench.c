/*
 * bench.c -- measures one engine structure on the board (see symtab_target.h
 * for how the structure is chosen). The structures are the engine's own code,
 * copied from engine/ by firmware/tools/sync_engine.py.
 *
 * Commands (one per line):
 *   PING        JSON beacon for backend/hardware_bridge.py
 *   INFO        build facts: variant, clock, pools, free RAM
 *   MEM         per symbol set: engine-modelled bytes vs heap actually taken
 *   TIME        per symbol set: insert / lookup-hit / lookup-miss times
 *   CAP         insert the 400-name set until the structure runs out of room
 *   SAVE <w>    build symbol set w and store the table in EEPROM (baseline, ABC)
 *   LOAD        rebuild the table from EEPROM (after a reset) and verify it
 *   ALL         INFO, MEM, TIME, CAP
 * Every result is one line starting with "CSV,"; firmware/tools/collect.py
 * parses them. Every row carries the outcome of verifying the table.
 */
#include "symtab_common.h"
#include "bench.h"

#ifdef __AVR__
#include <avr/io.h>
#include <avr/pgmspace.h>
#include <avr/eeprom.h>
#define RD_PTR(addr)  ((const void *)pgm_read_word(addr))
#define EEPROM_BYTES  (E2END + 1)
#define CPU_MHZ       (F_CPU / 1000000UL)
extern char __heap_start;
extern char *__brkval;
static char *heap_top(void) { return __brkval ? __brkval : &__heap_start; }
static unsigned long heap_used(void) { return (unsigned long)(heap_top() - &__heap_start); }
static long free_ram(void) { char here; return (long)(&here - heap_top()); }
#else   /* host build (firmware/tools/host_bench.c) to test this file under sanitizers */
#define PROGMEM
#define PSTR(s)                 (s)
#define printf_P                printf
#define strcpy_P                strcpy
#define strcmp_P                strcmp
#define strncmp_P               strncmp
#define pgm_read_byte(p)        (*(const uint8_t *)(p))
#define pgm_read_word(p)        (*(const uint16_t *)(p))
#define RD_PTR(addr)            (*(addr))
#define EEPROM_BYTES            1024
#define CPU_MHZ                 0UL
void eeprom_update_block(const void *src, void *dst, size_t n);
void eeprom_read_block(void *dst, const void *src, size_t n);
static unsigned long heap_used(void) { return 0; }
static long free_ram(void) { return 100000L; }
#endif

unsigned long micros(void);    /* Arduino core (C linkage); host_bench.c on the PC */

#include "workloads.h"

/* ---- the structure in this build ---- */
#if BENCH_VARIANT == 0
#define IMPL BASELINE_IMPL
#define VNAME "baseline"
#elif BENCH_VARIANT == 1
#define IMPL a_impl
#define VNAME "A"
#elif BENCH_VARIANT == 2
#define IMPL b_impl
#define VNAME "B"
#elif BENCH_VARIANT == 3
#define IMPL c_impl
#define VNAME "C"
#elif BENCH_VARIANT == 4
#define IMPL ab_impl
#define VNAME "AB"
#elif BENCH_VARIANT == 5
#define IMPL ac_impl
#define VNAME "AC"
#elif BENCH_VARIANT == 6
#define IMPL bc_impl
#define VNAME "BC"
#elif BENCH_VARIANT == 7
#define IMPL abc_impl
#define VNAME "ABC"
#else
#error "BENCH_VARIANT must be 0..7"
#endif

/* Heap variants (baseline, A, C, AC) malloc as they grow; the others use the
 * static pools of pools.h. HEAP_STATIC is the fixed part a heap variant keeps
 * outside the heap (the 64-pointer bucket array of baseline and A). */
#define IS_HEAP     (BENCH_VARIANT == 0 || BENCH_VARIANT == 1 || BENCH_VARIANT == 3 || BENCH_VARIANT == 5)
#define HEAP_STATIC ((BENCH_VARIANT == 0 || BENCH_VARIANT == 1) ? HASH_BUCKETS * sizeof(void *) : 0)

/* SAVE / LOAD: the baseline and the full compressed structure (ABC). */
#define CAN_PERSIST (BENCH_VARIANT == 0 || BENCH_VARIANT == 7)

/* A heap variant stops inserting while this much RAM is still free between heap
 * and stack: avr-libc's malloc keeps 128 B clear for the stack, one insert takes
 * under 64 B plus two copies of the name, and the call itself needs stack. */
#define RAM_RESERVE 256

#define NAME_MAX_LEN 32
#define TIME_REPS    5

/* ---- symbol sets in flash ---- */
static uint16_t wl_size(uint8_t w) { return pgm_read_word(&WL_SIZE[w]); }
static const uint8_t *wl_data(uint8_t w) { return (const uint8_t *)RD_PTR(&WL_DATA[w]); }
static void wl_label(uint8_t w, char *buf) { strcpy_P(buf, (const char *)RD_PTR(&WL_LABEL[w])); }

/* Copy one record to RAM; returns the next record. */
static const uint8_t *wl_read(const uint8_t *p, TestSymbol *s, char *name) {
    uint8_t i = 0;
    char c;
    s->type = pgm_read_byte(p++);
    s->scope = pgm_read_byte(p++);
    s->storage_class = pgm_read_byte(p++);
    s->offset = (uint16_t)(pgm_read_byte(p) | (pgm_read_byte(p + 1) << 8));
    p += 2;
    while ((c = (char)pgm_read_byte(p++)) != '\0' && i < NAME_MAX_LEN) name[i++] = c;
    name[i] = '\0';
    s->name = name;
    return p;
}

/* Turn a name into one that is not in the table: append a character no
 * identifier contains (an "extension" probe for the trie). */
static void make_absent(char *name) {
    size_t n = strlen(name);
    name[n] = '~';
    name[n + 1] = '\0';
}

/* ---- build / verify ---- */
enum { STOP_NONE, STOP_ARENA, STOP_RAM };

/* Insert the first `limit` symbols of w; returns how many went in. */
static uint16_t build(uint8_t w, uint16_t limit, uint8_t *stop) {
    const uint8_t *p = wl_data(w);
    char name[NAME_MAX_LEN + 2];
    TestSymbol s;
    uint16_t i;
    *stop = STOP_NONE;
    IMPL.init();
    for (i = 0; i < limit; i++) {
        p = wl_read(p, &s, name);
        if (IS_HEAP && free_ram() < RAM_RESERVE + 2 * (long)strlen(name)) { *stop = STOP_RAM; break; }
        if (IMPL.insert(&s) != 0) { *stop = STOP_ARENA; break; }
    }
    return i;
}

/* Every inserted declaration is found, and probes that are not stored are not. */
static int verify(uint8_t w, uint16_t count) {
    const uint8_t *p = wl_data(w);
    char name[NAME_MAX_LEN + 2];
    TestSymbol s;
    int ok = IMPL.absent("not_a_real_symbol");
    for (uint16_t i = 0; i < count; i++) {
        p = wl_read(p, &s, name);
        if (!IMPL.verify(&s)) ok = 0;
        make_absent(name);
        if (!IMPL.absent(name)) ok = 0;
    }
    return ok;
}

static const char *stop_name(uint8_t stop) {
    return stop == STOP_ARENA ? "arena_full" : stop == STOP_RAM ? "out_of_ram" : "none";
}

/* ---- commands ---- */
static void cmd_info(void) {
#if IS_HEAP
    unsigned long nodes = 0, chars = 0, meta = 0, shadows = 0;
#else
    unsigned long nodes = ARENA_MAX_NODES, chars = ARENA_MAX_CHARS, meta = 0, shadows = 0;
#if BENCH_VARIANT >= 6
    meta = ARENA_MAX_META;
    shadows = ARENA_MAX_SHADOWS;
#endif
#endif
    printf_P(PSTR("# variant,cpu_mhz,free_ram,struct_budget,pool_nodes,pool_chars,pool_meta,pool_shadows,"
                  "sizeof_int,sizeof_ptr,malloc_overhead\n"));
    printf_P(PSTR("CSV,INFO," VNAME ",%lu,%ld,%lu,%lu,%lu,%lu,%lu,%lu,%lu,%lu\n"),
             CPU_MHZ, free_ram(), (unsigned long)STRUCT_BUDGET, nodes, chars, meta, shadows,
             (unsigned long)sizeof(int), (unsigned long)sizeof(void *), (unsigned long)MALLOC_OVERHEAD);
}

static void cmd_mem(void) {
    char label[16];
    printf_P(PSTR("# variant,workload,n,inserted,stop,modelled_bytes,heap_bytes,verify_ok,heap_after_destroy\n"));
    for (uint8_t w = 0; w < WL_CAPACITY; w++) {
        uint8_t stop;
        unsigned long h0 = heap_used();
        uint16_t n = wl_size(w), got = build(w, n, &stop);
        unsigned long modelled = (unsigned long)IMPL.total_bytes();
        unsigned long heap = heap_used() - h0;
        int ok = verify(w, got);
        IMPL.destroy();
        wl_label(w, label);
        printf_P(PSTR("CSV,MEM," VNAME ",%s,%u,%u,%s,%lu,%lu,%d,%lu\n"), label, n, got,
                 stop_name(stop), modelled, heap, ok, heap_used() - h0);
    }
}

/* Best of TIME_REPS for each loop, in microseconds over the whole set. The
 * read loops time copying records out of flash, which the others include. */
static void cmd_time(void) {
    char label[16], name[NAME_MAX_LEN + 2];
    TestSymbol s;
    printf_P(PSTR("# variant,workload,n,insert_us,hit_us,miss_us,read_us,read_probe_us,verify_ok  "
                  "(totals over n symbols, best of %d)\n"), TIME_REPS);
    for (uint8_t w = 0; w < WL_CAPACITY; w++) {
        unsigned long best[5] = { ~0UL, ~0UL, ~0UL, ~0UL, ~0UL };
        uint16_t n = wl_size(w);
        uint8_t stop;
        int ok = 1;
        if (build(w, n, &stop) != n) {           /* does not fit this build: no timing */
            IMPL.destroy();
            continue;
        }
        ok = verify(w, n);
        IMPL.destroy();
        bench_flush();
        for (uint8_t r = 0; r < TIME_REPS; r++) {
            unsigned long t[5];
            const uint8_t *p;
            unsigned long t0;
            uint16_t i;

            IMPL.init();
            t0 = micros();
            for (p = wl_data(w), i = 0; i < n; i++) { p = wl_read(p, &s, name); IMPL.insert(&s); }
            t[0] = micros() - t0;
            t0 = micros();
            for (p = wl_data(w), i = 0; i < n; i++) { p = wl_read(p, &s, name); ok &= IMPL.verify(&s); }
            t[1] = micros() - t0;
            t0 = micros();
            for (p = wl_data(w), i = 0; i < n; i++) { p = wl_read(p, &s, name); make_absent(name); ok &= IMPL.absent(name); }
            t[2] = micros() - t0;
            IMPL.destroy();
            t0 = micros();
            for (p = wl_data(w), i = 0; i < n; i++) { p = wl_read(p, &s, name); }
            t[3] = micros() - t0;
            t0 = micros();
            for (p = wl_data(w), i = 0; i < n; i++) { p = wl_read(p, &s, name); make_absent(name); }
            t[4] = micros() - t0;
            for (uint8_t k = 0; k < 5; k++) if (t[k] < best[k]) best[k] = t[k];
        }
        wl_label(w, label);
        printf_P(PSTR("CSV,TIME," VNAME ",%s,%u,%lu,%lu,%lu,%lu,%lu,%d\n"), label, n,
                 best[0], best[1], best[2], best[3], best[4], ok);
    }
}

/* Insert the capacity set until the structure cannot take the next symbol.
 * fit_budget: symbols whose table was still within STRUCT_BUDGET (equal-RAM
 * comparison); max: symbols held when it stopped (a heap variant keeps going
 * past the budget until the RAM between heap and stack is used up). */
static void cmd_cap(void) {
    const uint8_t *p = wl_data(WL_CAPACITY);
    char name[NAME_MAX_LEN + 2];
    TestSymbol s;
    uint16_t n = wl_size(WL_CAPACITY), got = 0, fit_budget = 0;
    uint8_t stop = STOP_NONE;
    unsigned long h0 = heap_used(), bytes = 0, modelled;
    long min_free;
    int ok;

    IMPL.init();
    for (; got < n; got++) {
        p = wl_read(p, &s, name);
        if (IS_HEAP && free_ram() < RAM_RESERVE + 2 * (long)strlen(name)) { stop = STOP_RAM; break; }
        if (IMPL.insert(&s) != 0) { stop = STOP_ARENA; break; }
        bytes = IS_HEAP ? heap_used() - h0 + HEAP_STATIC : (unsigned long)IMPL.total_bytes();
        if (bytes <= STRUCT_BUDGET) fit_budget = got + 1;
    }
    min_free = free_ram();
    modelled = (unsigned long)IMPL.total_bytes();
    ok = verify(WL_CAPACITY, got);
    IMPL.destroy();
    printf_P(PSTR("# variant,n,fit_budget,max_held,stop,bytes_at_max,modelled_at_max,free_ram_at_max,verify_ok\n"));
    printf_P(PSTR("CSV,CAP," VNAME ",%u,%u,%u,%s,%lu,%lu,%ld,%d\n"), n, fit_budget, got,
             stop_name(stop), bytes, modelled, min_free, ok);
}

/* ---- persistence (EEPROM) ----
 * Header at address 0, then the payload. ABC writes its arenas as raw bytes
 * (they hold indices, not addresses). The baseline is a web of pointers, so
 * it is written as records (name, then its four int fields) and rebuilt by
 * inserting them again. */
#if CAN_PERSIST
#define SNAP_MAGIC 0x5344u          /* "DS" */
#define SNAP_LIVE  0xFFu            /* workload id of a snapshot of the live table */
typedef struct {
    uint16_t magic;
    uint8_t  variant, workload;
    uint16_t count, length, crc;    /* count: declarations stored */
} SnapHeader;

static uint16_t ee_pos, ee_crc;

static void crc_add(const void *data, size_t n) {
    const uint8_t *b = (const uint8_t *)data;
    while (n--) {
        ee_crc ^= (uint16_t)(*b++ << 8);
        for (uint8_t k = 0; k < 8; k++) ee_crc = (ee_crc & 0x8000u) ? (uint16_t)((ee_crc << 1) ^ 0x1021u) : (uint16_t)(ee_crc << 1);
    }
}
static void ee_put(const void *p, size_t n) {
    eeprom_update_block(p, (void *)(uintptr_t)ee_pos, n);
    crc_add(p, n);
    ee_pos = (uint16_t)(ee_pos + n);
}
static void ee_get(void *p, size_t n) {
    eeprom_read_block(p, (const void *)(uintptr_t)ee_pos, n);
    crc_add(p, n);
    ee_pos = (uint16_t)(ee_pos + n);
}

#if BENCH_VARIANT == 0
/* Oldest declaration first in each chain, so re-inserting keeps the newest at the head. */
static size_t base_save(int write) {
    size_t bytes = 0;
    for (size_t b = 0; b < HASH_BUCKETS; b++) {
        size_t len = 0;
        for (HNode *x = base_buckets[b]; x; x = x->next) len++;
        while (len--) {
            HNode *x = base_buckets[b];
            int f[4];
            for (size_t k = 0; k < len; k++) x = x->next;
            f[0] = x->type; f[1] = x->scope; f[2] = x->storage_class; f[3] = x->offset;
            if (write) { ee_put(x->name, strlen(x->name) + 1); ee_put(f, sizeof f); }
            bytes += strlen(x->name) + 1 + sizeof f;
        }
    }
    return bytes;
}
static int base_load(uint16_t length) {
    uint16_t end = (uint16_t)(ee_pos + length);
    base_init();
    while (ee_pos < end) {
        char name[NAME_MAX_LEN + 2];
        int f[4];
        uint8_t i = 0;
        do { ee_get(&name[i], 1); } while (name[i] != '\0' && ++i <= NAME_MAX_LEN);
        if (i > NAME_MAX_LEN) return -1;
        ee_get(f, sizeof f);
        TestSymbol s = { name, (uint8_t)f[0], (uint8_t)f[1], (uint8_t)f[2], (uint16_t)f[3] };
        if (base_insert(&s) != 0) return -1;
    }
    return 0;
}
#endif

/* Bytes the current table needs in EEPROM, after the header. */
static size_t snap_length(void) {
#if BENCH_VARIANT == 0
    return base_save(0);
#else
    return 4 * sizeof(uint16_t) + IMPL.total_bytes();
#endif
}

/* Write the current table; returns microseconds taken. The caller checked it fits. */
static unsigned long snap_write(uint8_t workload, uint16_t count, size_t length) {
    SnapHeader h = { SNAP_MAGIC, BENCH_VARIANT, workload, count, (uint16_t)length, 0 };
    unsigned long t0 = micros();
    ee_pos = sizeof h;
    ee_crc = 0xFFFFu;
#if BENCH_VARIANT == 0
    base_save(1);
#else
    abc_save(ee_put);
#endif
    h.crc = ee_crc;
    eeprom_update_block(&h, (void *)0, sizeof h);
    return micros() - t0;
}

/* Rebuild the table from EEPROM into IMPL. Returns 0 and the header if the
 * snapshot is this variant's and its CRC matches; otherwise -1 (table empty). */
static int snap_read(SnapHeader *h, unsigned long *us) {
    int loaded;
    unsigned long t0;
    eeprom_read_block(h, (const void *)0, sizeof *h);
    if (h->magic != SNAP_MAGIC || h->variant != BENCH_VARIANT ||
        (h->workload >= WL_NUM && h->workload != SNAP_LIVE) || sizeof *h + h->length > EEPROM_BYTES)
        return -1;
    ee_pos = sizeof *h;
    ee_crc = 0xFFFFu;
    t0 = micros();
#if BENCH_VARIANT == 0
    loaded = base_load(h->length);
#else
    IMPL.init();
    loaded = abc_load(ee_get);
#endif
    *us = micros() - t0;
    if (loaded != 0 || ee_crc != h->crc || ee_pos != sizeof *h + h->length) {
        IMPL.destroy();
        return -1;
    }
    return 0;
}
#endif /* CAN_PERSIST */

/* ---- live session ----
 * The PC sends one declaration at a time (the board has no C lexer); each is
 * inserted into this build's structure and reported at once. The table stays
 * in RAM between commands until another command needs the structure. */
static uint8_t live_active, live_stop;
static uint16_t live_n;
static unsigned long live_h0;

static void live_drop(void) {
    if (live_active) IMPL.destroy();
    live_active = 0;
}

static void live_start(void) {
    live_active = 1;
    live_stop = STOP_NONE;
    live_n = 0;
    live_h0 = heap_used();
}

/* RAM the program's globals take: everything below the heap. */
static unsigned long static_ram(void) {
#ifdef __AVR__
    return (unsigned long)(&__heap_start - (char *)RAMSTART);
#else
    return 0;
#endif
}

/* Heap the live table took (its bucket array, if any, is among the globals). */
static unsigned long live_heap(void) { return IS_HEAP ? heap_used() - live_h0 : 0; }

static void cmd_live(void) {
    live_drop();
    IMPL.init();
    live_start();
    printf_P(PSTR("LIVE,READY," VNAME ",%ld,%lu,%lu\n"), free_ram(), static_ram(), (unsigned long)STRUCT_BUDGET);
}

/* SYM <type> <scope> <storage> <offset> <name> */
static void cmd_sym(const char *args) {
    unsigned long f[4], t0, us = 0;
    char name[NAME_MAX_LEN + 2], *end;
    TestSymbol s;
    size_t len;
    int verified = 0;
    for (uint8_t k = 0; k < 4; k++) {
        f[k] = strtoul(args, &end, 10);
        if (end == args) { printf_P(PSTR("LIVE,ERROR,bad_symbol\n")); return; }
        args = end;
    }
    while (*args == ' ') args++;
    len = strlen(args);
    if (len == 0 || len > NAME_MAX_LEN || f[0] > 15 || f[1] > 255 || f[2] > 15 || f[3] > 65535UL) {
        printf_P(PSTR("LIVE,ERROR,bad_symbol\n"));
        return;
    }
    if (!live_active) { printf_P(PSTR("LIVE,ERROR,no_session\n")); return; }
    memcpy(name, args, len + 1);
    s.name = name;
    s.type = (uint8_t)f[0]; s.scope = (uint8_t)f[1]; s.storage_class = (uint8_t)f[2]; s.offset = (uint16_t)f[3];

    if (live_stop == STOP_NONE) {               /* after the first refusal, refuse the rest */
        if (IS_HEAP && free_ram() < RAM_RESERVE + 2 * (long)len) {
            live_stop = STOP_RAM;
        } else {
            t0 = micros();
            if (IMPL.insert(&s) != 0) live_stop = STOP_ARENA;
            us = micros() - t0;
        }
        if (live_stop == STOP_NONE) {
            live_n++;
            verified = IMPL.verify(&s);
        }
    }
    printf_P(PSTR("LIVE,SYM,%u,%s,"), live_n, name);
    if (live_stop == STOP_NONE) printf_P(PSTR("ok"));
    else if (live_stop == STOP_ARENA) printf_P(PSTR("arena_full"));
    else printf_P(PSTR("out_of_ram"));
    printf_P(PSTR(",%lu,%lu,%ld,%lu,%d,%08lX\n"), (unsigned long)IMPL.total_bytes(), live_heap(), free_ram(),
             us, verified, (unsigned long)pack_symbol(&s));
}

static void cmd_end(void) {
    if (!live_active) { printf_P(PSTR("LIVE,ERROR,no_session\n")); return; }
    printf_P(PSTR("LIVE,DONE,%u,%lu,%lu,%ld,%s\n"), live_n, (unsigned long)IMPL.total_bytes(), live_heap(),
             free_ram(), stop_name(live_stop));
}

/* LOOKUP <name>: is it in the live table? ABC also says how many declarations. */
static void cmd_lookup(const char *name) {
    int decls = -1;
    if (!live_active) { printf_P(PSTR("LIVE,ERROR,no_session\n")); return; }
    if (strlen(name) == 0 || strlen(name) > NAME_MAX_LEN) { printf_P(PSTR("LIVE,ERROR,bad_name\n")); return; }
#if BENCH_VARIANT == 7
    {
        uint16_t out[8];
        decls = (int)abc_declarations(name, out, 8);
    }
#endif
    if (IMPL.absent(name)) printf_P(PSTR("LIVE,LOOKUP,%s,ABSENT,%d\n"), name, decls);
    else printf_P(PSTR("LIVE,LOOKUP,%s,FOUND,%d\n"), name, decls);
}

static void cmd_save_live(void) {
#if CAN_PERSIST
    size_t length;
    if (!live_active) { printf_P(PSTR("LIVE,ERROR,no_session\n")); return; }
    length = snap_length();
    if (sizeof(SnapHeader) + length > EEPROM_BYTES) {
        printf_P(PSTR("LIVE,ERROR,too_big,%lu,%lu\n"), (unsigned long)(sizeof(SnapHeader) + length),
                 (unsigned long)EEPROM_BYTES);
        return;
    }
    printf_P(PSTR("LIVE,SAVED,%u,%lu,%lu,%lu\n"), live_n, (unsigned long)(sizeof(SnapHeader) + length),
             (unsigned long)IMPL.total_bytes(), snap_write(SNAP_LIVE, live_n, length));
#else
    printf_P(PSTR("LIVE,ERROR,no_persistence\n"));
#endif
}

static void cmd_save(uint8_t w) {
#if CAN_PERSIST
    char label[16];
    uint8_t stop;
    uint16_t n;
    unsigned long modelled;
    size_t length;
    if (w >= WL_NUM) { printf_P(PSTR("# no such symbol set\n")); return; }
    n = wl_size(w);
    if (build(w, n, &stop) != n) { IMPL.destroy(); printf_P(PSTR("# set does not fit this build\n")); return; }
    modelled = (unsigned long)IMPL.total_bytes();
    length = snap_length();
    wl_label(w, label);
    printf_P(PSTR("# variant,workload,n,table_bytes,snapshot_bytes,eeprom_bytes,fits,save_us\n"));
    if (sizeof(SnapHeader) + length > EEPROM_BYTES) {
        printf_P(PSTR("CSV,SAVE," VNAME ",%s,%u,%lu,%lu,%lu,0,0\n"), label, n, modelled,
                 (unsigned long)length, (unsigned long)EEPROM_BYTES);
        IMPL.destroy();
        return;
    }
    {
        unsigned long us = snap_write(w, n, length);
        IMPL.destroy();
        printf_P(PSTR("CSV,SAVE," VNAME ",%s,%u,%lu,%lu,%lu,1,%lu\n"), label, n, modelled,
                 (unsigned long)length, (unsigned long)EEPROM_BYTES, us);
    }
#else
    (void)w;
    printf_P(PSTR("# SAVE is implemented for baseline and ABC only\n"));
#endif
}

/* A symbol-set snapshot is verified against the set and dropped (CSV,LOAD);
 * a live snapshot becomes the live table again (LIVE,LOADED). */
static void cmd_load(void) {
#if CAN_PERSIST
    SnapHeader h;
    char label[16];
    unsigned long us, modelled, h0 = heap_used();
    int ok;
    if (snap_read(&h, &us) != 0) {
        printf_P(PSTR("# no valid snapshot of this variant in EEPROM\n"));
        printf_P(PSTR("LIVE,ERROR,no_snapshot\n"));
        return;
    }
    modelled = (unsigned long)IMPL.total_bytes();
    if (h.workload == SNAP_LIVE) {
        live_start();
        live_h0 = h0;                           /* the reload's own allocations count */
        live_n = h.count;
        printf_P(PSTR("LIVE,LOADED,%u,%u,%lu,%lu\n"), h.count, (unsigned)(sizeof h + h.length), modelled, us);
        return;
    }
    ok = verify(h.workload, wl_size(h.workload));
    IMPL.destroy();
    wl_label(h.workload, label);
    printf_P(PSTR("# variant,workload,n,snapshot_bytes,restore_us,crc_ok,table_bytes,verify_ok\n"));
    printf_P(PSTR("CSV,LOAD," VNAME ",%s,%u,%u,%lu,%d,%lu,%d\n"), label, wl_size(h.workload),
             h.length, us, 1, modelled, ok);
#else
    printf_P(PSTR("# LOAD is implemented for baseline and ABC only\n"));
    printf_P(PSTR("LIVE,ERROR,no_persistence\n"));
#endif
}

/* Command names live in flash (PSTR) so they take no RAM. */
#define IS(cmd)     (strcmp_P(line, PSTR(cmd)) == 0)
#define STARTS(cmd) (strncmp_P(line, PSTR(cmd), sizeof(cmd) - 1) == 0)

void bench_command(const char *line) {
    /* Commands that build their own table first free the live one. */
    if (!(IS("PING") || STARTS("SYM ") || IS("END") || STARTS("LOOKUP ") || IS("SAVE")))
        live_drop();

    if (IS("LIVE")) {
        cmd_live();
    } else if (STARTS("SYM ")) {
        cmd_sym(line + 4);
    } else if (IS("END")) {
        cmd_end();
    } else if (STARTS("LOOKUP ")) {
        cmd_lookup(line + 7);
    } else if (IS("SAVE")) {
        cmd_save_live();
    } else if (IS("PING")) {
        printf_P(PSTR("{\"status\": \"PONG\", \"board\": \"Arduino Uno\", \"firmware\": \"uno_bench\", "
                      "\"clock_mhz\": %lu, \"free_heap\": %ld, \"static_ram\": %lu, \"variant\": \"" VNAME "\", "
                      "\"live_symbols\": %u}\n"), CPU_MHZ, free_ram(), static_ram(), live_active ? live_n : 0u);
    } else if (IS("INFO")) {
        cmd_info();
    } else if (IS("MEM")) {
        cmd_mem();
    } else if (IS("TIME")) {
        cmd_time();
    } else if (IS("CAP")) {
        cmd_cap();
    } else if (STARTS("SAVE ")) {
        cmd_save((uint8_t)atoi(line + 5));
    } else if (IS("LOAD")) {
        cmd_load();
    } else if (IS("ALL")) {
        cmd_info(); cmd_mem(); cmd_time(); cmd_cap();
    } else {
        printf_P(PSTR("# commands: PING INFO MEM TIME CAP SAVE <0-%d> LOAD ALL | live: LIVE, "
                      "SYM <type> <scope> <storage> <offset> <name>, END, LOOKUP <name>, SAVE\n"), WL_NUM - 1);
    }
    printf_P(PSTR("DONE\n"));
}
