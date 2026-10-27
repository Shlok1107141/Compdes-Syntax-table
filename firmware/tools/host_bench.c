/*
 * host_bench.c -- runs firmware/uno_bench/src/bench.c on the PC, so the
 * benchmark's own logic can be tested under AddressSanitizer/UBSan before it
 * goes on the board. Reads commands from stdin, one per line.
 *
 *   gcc -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
 *       -DBENCH_VARIANT=7 -I firmware/uno_bench/src firmware/tools/host_bench.c \
 *       firmware/uno_bench/src/bench.c firmware/uno_bench/src/variant_*.c
 *
 * Byte counts differ from the board (8-byte pointers); counts of symbols that
 * fit the pools, and every verify_ok, must not.
 */
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include "bench.h"

static uint8_t eeprom[1024];

void eeprom_update_block(const void *src, void *dst, size_t n) { memcpy(eeprom + (uintptr_t)dst, src, n); }
void eeprom_read_block(void *dst, const void *src, size_t n) { memcpy(dst, eeprom + (uintptr_t)src, n); }

unsigned long micros(void) {
    struct timespec ts;
    timespec_get(&ts, TIME_UTC);
    return (unsigned long)ts.tv_sec * 1000000UL + (unsigned long)(ts.tv_nsec / 1000);
}

void bench_flush(void) { fflush(stdout); }

int main(void) {
    char line[64];
    while (fgets(line, sizeof line, stdin)) {
        line[strcspn(line, "\r\n")] = '\0';
        if (line[0]) bench_command(line);
    }
    return 0;
}
