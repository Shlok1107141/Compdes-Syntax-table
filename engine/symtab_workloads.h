/*
 * symtab_workloads.h -- deterministic identifier sets for the benchmarks.
 * Shared by symtab_stress.c (memory sweep -> results.csv) and symtab_bench.c
 * (speed), so both measure exactly the same symbols.
 *
 *   0 realistic : <subsystem>_<field> naming, embedded-C style
 *   1 random    : uniform random names, minimal prefix sharing (worst case)
 *   2 scoped    : file-scope names plus functions that redeclare common locals
 *
 * Header-only, static functions; include after symtab_common.h.
 */
#ifndef SYMTAB_WORKLOADS_H
#define SYMTAB_WORKLOADS_H

#include "symtab_common.h"

/* ---------------- deterministic RNG (splitmix64) ---------------- */
#define ST_MAX_N     1000
#define ST_NAME_LEN  32

typedef struct { uint64_t s; } StRng;

static uint64_t st_next(StRng *r) {
    uint64_t z = (r->s += 0x9E3779B97F4A7C15ULL);
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
    return z ^ (z >> 31);
}
static uint32_t st_rand(StRng *r, uint32_t bound) { return (uint32_t)(st_next(r) % bound); }

static int st_name_exists(char names[][ST_NAME_LEN], size_t count, const char *cand) {
    for (size_t i = 0; i < count; i++)
        if (strcmp(names[i], cand) == 0) return 1;
    return 0;
}

/* ---------------- pattern 1: realistic subsystem naming ----------------
 * Embedded-style  <subsystem>_<field>[_<qualifier>]  with a bare subsystem
 * name per group (like `counter` / `count` in the day-1 data). Each subsystem
 * gets 4..12 members; subsystem count therefore grows ~ n/8. */
static const char *const ST_SUBSYS[] = {
    "sensor","temp","led","uart","spi","i2c","adc","dac","gpio","timer","pwm","motor",
    "servo","button","display","lcd","buzzer","battery","power","clock","rtc","flash",
    "eeprom","ram","dma","irq","isr","task","sched","queue","stack","heap","packet",
    "frame","crc","hash","wifi","ble","can","usb","eth","mqtt","log","debug","error",
    "state","config","status","buffer","counter","handler","filter","pid","fan","valve",
    "pump","relay","gps","imu","accel","gyro"
};
static const char *const ST_FIELD[] = {
    "id","value","state","flag","max","min","ptr","size","count","buf","len","mode","rate",
    "time","addr","data","reg","mask","level","cfg","err","code","type","index","head",
    "tail","cb","pin","port","speed"
};
static const char *const ST_QUAL[] = { "lo","hi","raw","avg","cur","prev","next","tmp" };
#define ST_COUNT(a) (sizeof(a) / sizeof((a)[0]))

static void st_gen_realistic(StRng *r, size_t n, TestSymbol *syms, char names[][ST_NAME_LEN]) {
    size_t order[ST_COUNT(ST_SUBSYS)];
    size_t npool = ST_COUNT(ST_SUBSYS), count = 0, sub = 0;
    unsigned off = 0;

    for (size_t i = 0; i < npool; i++) order[i] = i;
    for (size_t i = npool - 1; i > 0; i--) {            /* Fisher-Yates */
        size_t j = st_rand(r, (uint32_t)(i + 1));
        size_t t = order[i]; order[i] = order[j]; order[j] = t;
    }

    while (count < n) {
        char prefix[16];
        size_t pi = order[sub % npool];
        unsigned round = (unsigned)(sub / npool);
        sub++;
        if (round == 0) snprintf(prefix, sizeof prefix, "%s", ST_SUBSYS[pi]);
        else            snprintf(prefix, sizeof prefix, "%s%u", ST_SUBSYS[pi], round + 1);

        size_t members = 4 + st_rand(r, 9);
        for (size_t m = 0; m < members && count < n; m++) {
            char cand[ST_NAME_LEN];
            int placed = 0;
            for (int tries = 0; tries < 30 && !placed; tries++) {
                if (m == 0) {
                    snprintf(cand, sizeof cand, "%s", prefix);
                } else {
                    const char *f = ST_FIELD[st_rand(r, (uint32_t)ST_COUNT(ST_FIELD))];
                    if (st_rand(r, 4) == 0)
                        snprintf(cand, sizeof cand, "%s_%s_%s", prefix, f,
                                 ST_QUAL[st_rand(r, (uint32_t)ST_COUNT(ST_QUAL))]);
                    else
                        snprintf(cand, sizeof cand, "%s_%s", prefix, f);
                }
                placed = !st_name_exists(names, count, cand);
                if (m == 0) break;
            }
            if (!placed) continue;
            memcpy(names[count], cand, sizeof cand);
            syms[count].name = names[count];
            syms[count].type = (uint8_t)st_rand(r, 4);
            syms[count].scope = (uint8_t)st_rand(r, 3);
            syms[count].storage_class = (uint8_t)st_rand(r, 4);
            syms[count].offset = (uint16_t)off;
            off += 4;
            count++;
        }
    }
}

/* ---------------- pattern 2: random worst-case naming ----------------
 * Uniform random identifiers, length 6..20: essentially no shared prefixes,
 * the worst case for any prefix-sharing structure. Metadata uses the FULL bit
 * range of every field so packing is exercised at its limits. */
static void st_gen_random(StRng *r, size_t n, TestSymbol *syms, char names[][ST_NAME_LEN]) {
    static const char first[] = "abcdefghijklmnopqrstuvwxyz";
    static const char rest[]  = "abcdefghijklmnopqrstuvwxyz0123456789_";
    size_t count = 0;
    while (count < n) {
        char cand[ST_NAME_LEN];
        size_t len = 6 + st_rand(r, 15);
        cand[0] = first[st_rand(r, (uint32_t)(sizeof first - 1))];
        for (size_t i = 1; i < len; i++) cand[i] = rest[st_rand(r, (uint32_t)(sizeof rest - 1))];
        cand[len] = '\0';
        if (st_name_exists(names, count, cand)) continue;
        memcpy(names[count], cand, len + 1);
        syms[count].name = names[count];
        syms[count].type = (uint8_t)st_rand(r, 16);
        syms[count].scope = (uint8_t)st_rand(r, 256);
        syms[count].storage_class = (uint8_t)st_rand(r, 16);
        syms[count].offset = (uint16_t)st_rand(r, 65536);
        count++;
    }
}

/* ---------------- pattern 3: scoped program ----------------
 * The shape of real C: file-scope names in <subsystem>_<field> style (40%),
 * then functions, each declaring 2..8 locals drawn from a small recurring
 * pool (i, tmp, len, ...). Every function that uses `i` declares it again,
 * so this is the one pattern with redeclarations: every structure must keep
 * each declaration, and a trie stores the repeated name only once. */
static const char *const ST_LOCALS[] = {
    "i", "j", "k", "n", "tmp", "ret", "len", "count", "buf", "ptr", "idx",
    "value", "err", "result", "status", "data"
};

static void st_gen_scoped(StRng *r, size_t n, TestSymbol *syms, char names[][ST_NAME_LEN]) {
    size_t globals = n * 2 / 5, count = globals;
    unsigned fn = 0;

    st_gen_realistic(r, globals, syms, names);
    for (size_t i = 0; i < globals; i++) {          /* file scope, global storage */
        syms[i].scope = 0;
        syms[i].storage_class = 1;
    }

    while (count < n) {
        snprintf(names[count], ST_NAME_LEN, "%s_task%u",
                 ST_SUBSYS[st_rand(r, (uint32_t)ST_COUNT(ST_SUBSYS))], fn++);
        syms[count].name = names[count];
        syms[count].type = 3;                       /* function */
        syms[count].scope = 0;
        syms[count].storage_class = 1;
        syms[count].offset = 0;
        count++;

        size_t pool[ST_COUNT(ST_LOCALS)];
        for (size_t i = 0; i < ST_COUNT(ST_LOCALS); i++) pool[i] = i;
        size_t locals = 2 + st_rand(r, 7);          /* distinct within one function */
        unsigned frame = 0;
        for (size_t m = 0; m < locals && count < n; m++) {
            size_t j = m + st_rand(r, (uint32_t)(ST_COUNT(ST_LOCALS) - m));
            size_t t = pool[m]; pool[m] = pool[j]; pool[j] = t;
            snprintf(names[count], ST_NAME_LEN, "%s", ST_LOCALS[pool[m]]);
            syms[count].name = names[count];
            syms[count].type = (uint8_t)st_rand(r, 4);
            syms[count].scope = 1;
            syms[count].storage_class = 0;          /* local */
            syms[count].offset = (uint16_t)frame;
            frame += 4;
            count++;
        }
    }
}

static const char *const ST_PATTERNS[] = { "realistic", "random", "scoped" };
#define ST_NUM_PATTERNS 3

/* Fill syms[0..n) for (pattern, n, seed). The seed derivation is part of the
 * contract: results.csv was produced with it. */
static inline void st_generate(int pattern, size_t n, uint64_t seed,
                               TestSymbol *syms, char names[][ST_NAME_LEN]) {
    StRng r;
    r.s = seed * 1000003ULL + (uint64_t)pattern * 7919ULL + (uint64_t)n;
    if (pattern == 0)      st_gen_realistic(&r, n, syms, names);
    else if (pattern == 1) st_gen_random(&r, n, syms, names);
    else                   st_gen_scoped(&r, n, syms, names);
}

#endif
