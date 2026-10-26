/*
 * uno_bench -- the engine's symbol-table structures, measured on an Arduino Uno.
 *
 * Open this folder in the Arduino IDE, board "Arduino Uno", upload, then open
 * the Serial Monitor at 115200 baud (newline ending) and send ALL, or HELP for
 * the other commands. Which structure is built is set in src/symtab_target.h
 * (BENCH_VARIANT); firmware/tools/collect.py builds and measures all eight.
 *
 * The structures are engine/ code, copied into src/ by
 * firmware/tools/sync_engine.py. The measuring is in src/bench.c.
 */
#include <stdio.h>
#include "src/bench.h"

static FILE serial_out;
static char line[24];
static uint8_t line_len = 0;

static int serial_putc(char c, FILE *) {
    if (c == '\n') Serial.write('\r');
    Serial.write(c);
    return 0;
}

extern "C" void bench_flush(void) { Serial.flush(); }

void setup() {
    Serial.begin(115200);
    fdev_setup_stream(&serial_out, serial_putc, NULL, _FDEV_SETUP_WRITE);
    stdout = &serial_out;
    pinMode(LED_BUILTIN, OUTPUT);
    printf_P(PSTR("# uno_bench ready. Commands: PING INFO MEM TIME CAP SAVE <n> LOAD ALL\n"));
}

void loop() {
    while (Serial.available() > 0) {
        char c = (char)Serial.read();
        if (c == '\r') continue;
        if (c != '\n') {
            if (line_len < sizeof line - 1) line[line_len++] = c;
            continue;
        }
        line[line_len] = '\0';
        line_len = 0;
        if (line[0] == '\0') continue;
        digitalWrite(LED_BUILTIN, HIGH);        /* LED on while a command runs */
        bench_command(line);
        digitalWrite(LED_BUILTIN, LOW);
    }
}
