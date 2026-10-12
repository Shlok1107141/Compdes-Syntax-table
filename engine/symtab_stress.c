/*
 * symtab_stress.c -- multi-configuration stress sweep
 * ------------------------------------------------------------
 * One executable measures ONE configuration against the baseline.
 * The configuration is chosen at compile time:
 *
 *   cc ... -DCFG=ab -DCFG_LABEL='"AB"' -DVARIANT_SRC='"variant_ab_arena_bitpack.c"' \
 *          symtab_stress.c
 *
 * The variant's source file is #included UNMODIFIED (its demo main() is
 * renamed away), so the exact code validated on days 1-2 is what gets
 * measured here, along with the unchanged symtab_common.h baseline and
 * accounting model. Every variant uses the function prefix <cfg>_init,
 * <cfg>_insert, <cfg>_verify, <cfg>_absent, <cfg>_total, <cfg>_breakdown.
 *
 * For every pattern x n it:
 *   1. generates a deterministic symbol set (same set for every config),
 *   2. inserts it into baseline and variant,
 *   3. VERIFIES both (every symbol round-trips; absent / prefix / extension
 *      probes are not found) -- a run that fails verification emits no row,
 *   4. prints exactly one row on stdout:
 *          data, pattern, n, baseline_bytes, variant_bytes
 *      where `data` is the configuration label (A, B, C, AB, AC, BC, ABC).
 *
 * stdout carries ONLY rows. All diagnostics go to stderr.
 *
 * usage: stress_<cfg> [seed]      (default seed = 1)
 */
#include "symtab_common.h"

#ifndef CFG
#error "define CFG (function prefix, e.g. -DCFG=ab)"
#endif
#ifndef CFG_LABEL
#error "define CFG_LABEL (row label string, e.g. -DCFG_LABEL='\"AB\"')"
#endif
#ifndef VARIANT_SRC
#error "define VARIANT_SRC (variant source file, e.g. -DVARIANT_SRC='\"variant_ab_arena_bitpack.c\"')"
#endif

#define main variant_demo_main      /* keep the variant's own demo main out of the way */
#include VARIANT_SRC
#undef main

#define ST_PASTE_(a, b) a##b
#define ST_PASTE(a, b)  ST_PASTE_(a, b)

static const Impl st_variant = {
    CFG_LABEL,
    ST_PASTE(CFG, _init),  ST_PASTE(CFG, _insert), ST_PASTE(CFG, _verify),
    ST_PASTE(CFG, _absent), ST_PASTE(CFG, _total), ST_PASTE(CFG, _breakdown)
};

/* ---------------- deterministic RNG (splitmix64) ---------------- */
#define ST_MAX_N     300
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

/* ---------------- one (pattern, n) measurement ---------------- */
static int st_in_set(const TestSymbol *syms, size_t n, const char *key) {
    for (size_t i = 0; i < n; i++)
        if (strcmp(syms[i].name, key) == 0) return 1;
    return 0;
}

static int st_run_one(int pattern, const char *pname, size_t n, uint64_t seed) {
    static TestSymbol syms[ST_MAX_N];
    static char names[ST_MAX_N][ST_NAME_LEN];
    const Impl *base = &BASELINE_IMPL, *var = &st_variant;
    StRng r;
    r.s = seed * 1000003ULL + (uint64_t)pattern * 7919ULL + (uint64_t)n;

    if (pattern == 0) st_gen_realistic(&r, n, syms, names);
    else              st_gen_random(&r, n, syms, names);

    base->init();
    var->init();
    for (size_t i = 0; i < n; i++) { base->insert(&syms[i]); var->insert(&syms[i]); }

    int ok = 1;
    for (size_t i = 0; i < n; i++) {
        if (!base->verify(&syms[i])) { fprintf(stderr, "[%s/%s/n=%zu] BASELINE mismatch '%s'\n", CFG_LABEL, pname, n, syms[i].name); ok = 0; }
        if (!var->verify(&syms[i]))  { fprintf(stderr, "[%s/%s/n=%zu] VARIANT mismatch '%s'\n",  CFG_LABEL, pname, n, syms[i].name); ok = 0; }
    }
    if (!base->absent("not_a_real_symbol") || !var->absent("not_a_real_symbol")) {
        fprintf(stderr, "[%s/%s/n=%zu] false positive on absent key\n", CFG_LABEL, pname, n); ok = 0;
    }
    /* every proper prefix and every 1-char extension that is NOT itself a key must be absent */
    for (size_t i = 0; i < n; i++) {
        char probe[ST_NAME_LEN + 2];
        size_t len = strlen(syms[i].name);
        if (len >= 2) {
            memcpy(probe, syms[i].name, len - 1);
            probe[len - 1] = '\0';
            if (!st_in_set(syms, n, probe) && (!base->absent(probe) || !var->absent(probe))) {
                fprintf(stderr, "[%s/%s/n=%zu] prefix false positive '%s'\n", CFG_LABEL, pname, n, probe); ok = 0;
            }
        }
        memcpy(probe, syms[i].name, len);
        probe[len] = '~';
        probe[len + 1] = '\0';
        if (!base->absent(probe) || !var->absent(probe)) {
            fprintf(stderr, "[%s/%s/n=%zu] extension false positive '%s'\n", CFG_LABEL, pname, n, probe); ok = 0;
        }
    }
    if (!ok) return 1;

    printf("%s, %s, %zu, %zu, %zu\n", CFG_LABEL, pname, n, base->total_bytes(), var->total_bytes());
    return 0;
}

int main(int argc, char **argv) {
    static const size_t ns[] = { 10, 25, 50, 100, 200, 300 };
    static const char *const patterns[] = { "realistic", "random" };
    uint64_t seed = 1;
    if (argc > 1) seed = strtoull(argv[1], NULL, 10);

    for (int p = 0; p < 2; p++)
        for (size_t k = 0; k < sizeof ns / sizeof ns[0]; k++)
            if (st_run_one(p, patterns[p], ns[k], seed)) return 1;
    return 0;
}
