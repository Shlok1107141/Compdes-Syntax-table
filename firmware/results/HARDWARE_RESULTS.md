# Hardware results: Arduino Uno (ATmega328P)

Measured on an Arduino Uno compatible board (ATmega328P at 16 MHz, 2,048 B SRAM,
1,024 B EEPROM, CH340 USB-serial, Optiboot), core `arduino:avr` 1.8.7, avr-gcc 7.3.0.
The board ran the engine's own eight structures (`engine/variant_*.c`, copied
byte for byte), one structure per firmware build. Raw data: `uno_*.csv`,
`uno_raw.log`, `uno_meta.json` in this folder. Every table below is printed by
`python firmware/tools/summarize_uno.py`; every row was verified on the board
(each declaration found, absent names not found).

## What the Uno shows

1. **The saving depends on pointer size.** The same 30 identifiers take 669 B in
   ABC on both machines, because ABC holds no pointers. The textbook table drops
   from 2,725 B on the 64-bit PC to 901 B on the Uno: pointers are 2 B instead
   of 8, avr-libc's malloc header is 2 B instead of 16, and `int` is 2 B instead
   of 4. The saving falls from **75.4% on the PC to 25.7% on the Uno**.
2. **Arena + bit-packing still carries the saving; the trie helps only with
   repeated names.** AB is within a few bytes of ABC (661 vs 669 B on the
   prototype set) and smaller on the realistic and scoped sets. ABC is clearly
   best on the ESP32 sensor program (570 B vs 649 B for AB, 31.6% vs 22.1%), whose
   redeclared names (`sensor_reading` three times, `channel_status` twice) the
   trie stores once. This matches the PC finding in `engine/EVALUATION.md`.
3. **On 2 KB the textbook table runs out first.** The baseline could not hold
   the 50-symbol realistic set at all: it ran out of RAM after 44 symbols. ABC
   held all 50 in 1,065 B. In the capacity test, with the same 1,200 B for every
   structure, ABC held 54 names of the 400-name set and the baseline 41. Using
   every byte up to the 256 B stack reserve, the baseline stopped at 46.
4. **Caveat on capacity: arena pools are reserved at compile time.** An arena
   build takes 1,535–1,547 B of static RAM even while the table is empty; the
   heap builds take 359–487 B and grow. The pools were also sized for these symbol sets
   (`gen_workloads.py`), the best case for an arena. With other input the fixed
   split can fill early: ABC took only 22 of the random set's 50 names, because
   random names fill the character pool.
5. **Compression costs time on an 8-bit CPU.** On the prototype set ABC inserts
   in 81.7 µs vs the baseline's 55.5 µs, and finds a stored name in 64.0 µs vs
   37.9 µs. Bit-packing alone (A) adds about 20 µs per lookup, the cost of
   unpacking 32-bit words with 8-bit instructions. Absent-name lookups are
   26–42 µs for every structure.
6. **ABC can be stored as it is in RAM; the baseline cannot.** ABC's arenas
   hold indices, not addresses, so the used bytes go to EEPROM unchanged (677 B)
   and come back in 5.2 ms, verified after a reset. The baseline is a web of
   pointers: it has to be written out as records and rebuilt by inserting them
   again (7.9 ms). Its record file is *smaller* (533 B), because a flat list of
   names is more compact than ABC's trie nodes. Writing takes up to ~1.8 s:
   an EEPROM write takes about 3 ms per byte, and bytes that already hold the
   right value are skipped, so saving over a similar table is faster (0.3 s for
   the baseline in this run).
7. **The allocation model is exact for the hash tables.** For baseline and A,
   the heap the board actually used equals the engine's model (payload + one
   2-byte header per block) to the byte. For the pointer tries (C, AC) the real
   heap is 16–34 B more than modelled: avr-libc rounds 1-byte edge labels up to
   2 B, and labels freed when an edge splits leave holes.

## Method

- **One structure per build**, chosen with `BENCH_VARIANT`. Unused variants are
  removed by the linker (`-fdata-sections`, `--gc-sections`).
- **Symbol sets are stored in flash and copied one record at a time**, so they
  do not take RAM. They are the engine's own sets: the prototype's 30 identifiers,
  the ESP32 firmware's sensor program as `symtab_analyze` reads it, and the
  n=50, seed=1 rows of `engine/results.csv`.
- **Bytes** are the engine's accounting (`total_bytes()`). For heap structures
  they are also checked against the real heap (`__brkval`) on every run.
- **Heap structures stop inserting when less than 256 B of RAM stays free** between
  heap and stack. Arena structures stop when a pool is full.
- **Times** come from `micros()`, which has 4 µs resolution. Each figure is a loop
  over the whole set, best of 5, minus a loop that only copies the records out of
  flash. The timer interrupt stays on.
- **"Fit in 1200 B"** is the number of symbols held while the structure took at
  most 1,200 B. Arena pools total at most 1,200 B.

Reproduce: `python firmware/tools/collect.py --port COM3`, then
`python firmware/tools/summarize_uno.py --json frontend/src/data/unoResults.json`.

**Live mode.** The app's Hardware tab runs the same structures interactively:
the PC parses a program and the board inserts one declaration at a time
(`LIVE` / `SYM` commands; see [`../DEMO.md`](../DEMO.md)). A live run checks
free RAM at a shallower stack depth than this batch benchmark, so the textbook
table can hold a few more symbols there (49 of the 50-name set in one run)
before it runs out.

ESP32: no measured ESP32 data is in the repository yet. `firmware/esp32/` uses
its own copy of the trie and computes its baseline figure from a formula, so its
numbers are not comparable with these.

## Tables

### Memory: Uno vs PC, same symbols

| Symbol set | n | Uno baseline B | Uno AB B (saving) | Uno ABC B (saving) | PC baseline B | PC ABC B (saving) |
|---|---:|---:|---:|---:|---:|---:|
| proto30 | 30 | 901 | 661 (26.6%) | 669 (25.7%) | 2725 | 669 (75.4%) |
| esp32_sensor | 23 | 833 | 649 (22.1%) | 570 (31.6%) | 2321 | 570 (75.4%) |
| realistic50 | 50 | out of RAM at 44/50 | 1033 | 1065 | 4217 | 1065 (74.7%) |
| random50 | 50 | out of RAM at 38/50 | 1199 | pools full at 22/50 | 4383 | 1467 (66.5%) |
| scoped50 | 50 | out of RAM at 49/50 | 922 | 1008 | 4106 | 1008 (75.5%) |

### All eight structures on the Uno (bytes; saving vs Uno baseline)

| Symbol set | baseline | A | B | C | AB | AC | BC | ABC |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| proto30 | 901 | 781 (13.3%) | 781 (13.3%) | 970 (-7.7%) | 661 (26.6%) | 793 (12.0%) | 789 (12.4%) | 669 (25.7%) |
| esp32_sensor | 833 | 741 (11.0%) | 741 (11.0%) | 802 (3.7%) | 649 (22.1%) | 662 (20.5%) | 662 (20.5%) | 570 (31.6%) |
| realistic50 | out of RAM at 44/50 | 1233 | pools full at 46/50 | out of RAM at 42/50 | 1033 | 1247 | pools full at 46/50 | 1065 |
| random50 | out of RAM at 38/50 | out of RAM at 45/50 | pools full at 33/50 | out of RAM at 32/50 | 1199 | out of RAM at 37/50 | pools full at 17/50 | pools full at 22/50 |
| scoped50 | out of RAM at 49/50 | 1122 | 1122 | out of RAM at 42/50 | 922 | 1190 | pools full at 36/50 | 1008 |

### Allocation model vs the real heap (heap variants)

| Structure | Symbol set | Symbols held | Modelled B | Measured B (heap + buckets) | Difference | Heap left after destroy |
|---|---:|---:|---:|---:|---:|---:|
| baseline | proto30 | 30/30 | 901 | 901 | +0 | 0 |
| baseline | esp32_sensor | 23/23 | 833 | 833 | +0 | 0 |
| baseline | realistic50 | 44/50 | 1282 | 1282 | +0 | 0 |
| baseline | random50 | 38/50 | 1273 | 1273 | +0 | 0 |
| baseline | scoped50 | 49/50 | 1293 | 1293 | +0 | 0 |
| A | proto30 | 30/30 | 781 | 781 | +0 | 0 |
| A | esp32_sensor | 23/23 | 741 | 741 | +0 | 0 |
| A | realistic50 | 50/50 | 1233 | 1233 | +0 | 0 |
| A | random50 | 45/50 | 1290 | 1290 | +0 | 0 |
| A | scoped50 | 50/50 | 1122 | 1122 | +0 | 0 |
| C | proto30 | 30/30 | 970 | 992 | +22 | 0 |
| C | esp32_sensor | 23/23 | 802 | 827 | +25 | 0 |
| C | realistic50 | 42/50 | 1285 | 1302 | +17 | 0 |
| C | random50 | 32/50 | 1281 | 1302 | +21 | 0 |
| C | scoped50 | 42/50 | 1291 | 1308 | +17 | 0 |
| AC | proto30 | 30/30 | 793 | 815 | +22 | 0 |
| AC | esp32_sensor | 23/23 | 662 | 678 | +16 | 0 |
| AC | realistic50 | 50/50 | 1247 | 1278 | +31 | 0 |
| AC | random50 | 37/50 | 1242 | 1276 | +34 | 0 |
| AC | scoped50 | 50/50 | 1190 | 1219 | +29 | 0 |

### Static RAM of each firmware build (compiler report, of 2048 B)

| Structure | Flash B | Static RAM B |
|---|---:|---:|
| baseline | 23500 | 487 |
| A | 21398 | 483 |
| B | 20036 | 1537 |
| C | 21980 | 359 |
| AB | 20130 | 1540 |
| AC | 22148 | 359 |
| BC | 21018 | 1535 |
| ABC | 23328 | 1547 |

### Speed on the Uno (16 MHz), microseconds per symbol, best of 5

| Structure | Symbol set | Insert | Lookup (found) | Lookup (absent) | Verified |
|---|---:|---:|---:|---:|---:|
| baseline | proto30 | 55.5 | 37.9 | 29.7 | 1 |
| baseline | esp32_sensor | 71.5 | 54.3 | 41.0 | 1 |
| A | proto30 | 76.5 | 57.5 | 29.7 | 1 |
| A | esp32_sensor | 92.3 | 77.0 | 41.2 | 1 |
| A | scoped50 | 70.4 | 56.7 | 26.3 | 1 |
| B | proto30 | 42.1 | 38.8 | 30.4 | 1 |
| B | esp32_sensor | 58.4 | 54.8 | 41.6 | 1 |
| B | scoped50 | 35.9 | 35.0 | 27.5 | 1 |
| C | proto30 | 87.7 | 32.7 | 29.9 | 1 |
| C | esp32_sensor | 103.0 | 35.3 | 31.5 | 1 |
| AB | proto30 | 65.3 | 59.9 | 30.1 | 1 |
| AB | esp32_sensor | 81.6 | 79.5 | 41.4 | 1 |
| AB | realistic50 | 66.6 | 60.8 | 32.6 | 1 |
| AB | random50 | 77.5 | 70.7 | 40.3 | 1 |
| AB | scoped50 | 59.1 | 59.7 | 27.8 | 1 |
| AC | proto30 | 101.3 | 53.5 | 29.9 | 1 |
| AC | esp32_sensor | 103.0 | 59.1 | 31.7 | 1 |
| BC | proto30 | 57.9 | 44.9 | 36.0 | 1 |
| BC | esp32_sensor | 61.4 | 47.1 | 36.9 | 1 |
| ABC | proto30 | 81.7 | 64.0 | 36.1 | 1 |
| ABC | esp32_sensor | 85.6 | 69.2 | 36.7 | 1 |
| ABC | realistic50 | 92.9 | 69.8 | 41.7 | 1 |
| ABC | scoped50 | 82.7 | 69.8 | 36.8 | 1 |

### Capacity: 400-name set inserted until the structure is full

| Structure | Fit in 1200 B | Held when it stopped | Stopped because | Bytes then | Free RAM then | Verified |
|---|---:|---:|---:|---:|---:|---:|
| baseline | 41 | 46 | out_of_ram | 1310 | 267 | 1 |
| A | 49 | 55 | out_of_ram | 1333 | 256 | 1 |
| B | 48 | 48 | arena_full | 1172 | 409 | 1 |
| C | 38 | 42 | out_of_ram | 1319 | 263 | 1 |
| AB | 50 | 50 | arena_full | 1014 | 406 | 1 |
| AC | 48 | 53 | out_of_ram | 1321 | 261 | 1 |
| BC | 46 | 46 | arena_full | 1157 | 411 | 1 |
| ABC | 54 | 54 | arena_full | 1143 | 399 | 1 |

### Stored in EEPROM, reloaded after a reset

| Structure | Symbol set | Table in RAM B | Snapshot B | Save ms | Reload ms | CRC ok | Verified |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline | proto30 | 901 | 533 | 324 | 7.9 | 1 | 1 |
| baseline | esp32_sensor | 833 | 521 | 1431 | 8.1 | 1 | 1 |
| ABC | proto30 | 669 | 677 | 1839 | 5.2 | 1 | 1 |
| ABC | esp32_sensor | 570 | 578 | 1406 | 4.5 | 1 | 1 |
