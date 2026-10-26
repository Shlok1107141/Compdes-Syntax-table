/* bench.h -- what the sketch (C++) calls in the benchmark (C). */
#ifndef BENCH_H
#define BENCH_H

#ifdef __cplusplus
extern "C" {
#endif

/* Run one command line: PING, INFO, MEM, TIME, CAP, SAVE <w>, LOAD, ALL, HELP.
 * Output goes to stdout; result rows start with "CSV,". */
void bench_command(const char *line);

/* Provided by the sketch: wait until everything printed has left the UART,
 * so serial interrupts do not run inside a timed loop. */
void bench_flush(void);

#ifdef __cplusplus
}
#endif

#endif
