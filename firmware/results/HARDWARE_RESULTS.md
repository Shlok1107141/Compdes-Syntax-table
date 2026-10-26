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
   the 50-symbol realistic set at all: it ran out of RAM after 45 symbols. ABC
   held all 50 in 1,065 B. In the capacity test, with the same 1,200 B for every
   structure, ABC held 54 names of the 400-name set and the baseline 41. Using
   every byte up to the 256 B stack reserve, the baseline stopped at 47.
4. **Caveat on capacity: arena pools are reserved at compile time.** An arena
   build takes 1,535–1,547 B of static RAM even while the table is empty; the
   heap builds take 355–483 B and grow. The pools were also sized for these symbol sets
   (`gen_workloads.py`), the best case for an arena. With other input the fixed
   split can fill early: ABC took only 22 of the random set's 50 names, because
   random names fill the character pool.
5. **Compression costs time on an 8-bit CPU.** On the prototype set ABC inserts
   in 82.0 µs vs the baseline's 55.5 µs, and finds a stored name in 63.9 µs vs
   37.9 µs. Bit-packing alone (A) adds about 20 µs per lookup, the cost of
   unpacking 32-bit words with 8-bit instructions. Absent-name lookups are
   26–42 µs for every structure.
6. **ABC can be stored as it is in RAM; the baseline cannot.** ABC's arenas
   hold indices, not addresses, so the used bytes go to EEPROM unchanged (677 B)
   and come back in 5.2 ms, verified after a reset. The baseline is a web of
   pointers: it has to be written out as records and rebuilt by inserting them
   again (7.9 ms). Its record file is *smaller* (533 B), because a flat list of
   names is more compact than ABC's trie nodes. Writing takes ~1.4–1.7 s either
   way (EEPROM writes take about 3 ms per byte).
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
`python firmware/tools/summarize_uno.py`.

ESP32: no measured ESP32 data is in the repository yet. `firmware/esp32/` uses
its own copy of the trie and computes its baseline figure from a formula, so its
numbers are not comparable with these.

## Tables

### Memory: Uno vs PC, same symbols

| Symbol set | n | Uno baseline B | Uno AB B (saving) | Uno ABC B (saving) | PC baseline B | PC ABC B (saving) |
|---|---:|---:|---:|---:|---:|---:|
| proto30 | 30 | 901 | 661 (26.6%) | 669 (25.7%) | 2725 | 669 (75.4%) |
| esp32_sensor | 23 | 833 | 649 (22.1%) | 570 (31.6%) | 2321 | 570 (75.4%) |
| realistic50 | 50 | out of RAM at 45/50 | 1033 | 1065 | 4217 | 1065 (74.7%) |
| random50 | 50 | out of RAM at 39/50 | 1199 | pools full at 22/50 | 4383 | 1467 (66.5%) |
| scoped50 | 50 | out of RAM at 49/50 | 922 | 1008 | 4106 | 1008 (75.5%) |

### All eight structures on the Uno (bytes; saving vs Uno baseline)

| Symbol set | baseline | A | B | C | AB | AC | BC | ABC |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| proto30 | 901 | 781 (13.3%) | 781 (13.3%) | 970 (-7.7%) | 661 (26.6%) | 793 (12.0%) | 789 (12.4%) | 669 (25.7%) |
| esp32_sensor | 833 | 741 (11.0%) | 741 (11.0%) | 802 (3.7%) | 649 (22.1%) | 662 (20.5%) | 662 (20.5%) | 570 (31.6%) |
| realistic50 | out of RAM at 45/50 | 1233 | pools full at 46/50 | out of RAM at 44/50 | 1033 | 1247 | pools full at 46/50 | 1065 |
| random50 | out of RAM at 39/50 | out of RAM at 48/50 | pools full at 33/50 | out of RAM at 34/50 | 1199 | out of RAM at 40/50 | pools full at 17/50 | pools full at 22/50 |
| scoped50 | out of RAM at 49/50 | 1122 | 1122 | out of RAM at 44/50 | 922 | 1190 | pools full at 36/50 | 1008 |

### Allocation model vs the real heap (heap variants)

| Structure | Symbol set | Symbols held | Modelled B | Measured B (heap + buckets) | Difference | Heap left after destroy |
|---|---:|---:|---:|---:|---:|---:|
| baseline | proto30 | 30/30 | 901 | 901 | +0 | 0 |
| baseline | esp32_sensor | 23/23 | 833 | 833 | +0 | 0 |
| baseline | realistic50 | 45/50 | 1307 | 1307 | +0 | 0 |
| baseline | random50 | 39/50 | 1302 | 1302 | +0 | 0 |
| baseline | scoped50 | 49/50 | 1293 | 1293 | +0 | 0 |
| A | proto30 | 30/30 | 781 | 781 | +0 | 0 |
| A | esp32_sensor | 23/23 | 741 | 741 | +0 | 0 |
| A | realistic50 | 50/50 | 1233 | 1233 | +0 | 0 |
| A | random50 | 48/50 | 1352 | 1352 | +0 | 0 |
| A | scoped50 | 50/50 | 1122 | 1122 | +0 | 0 |
| C | proto30 | 30/30 | 970 | 992 | +22 | 0 |
| C | esp32_sensor | 23/23 | 802 | 827 | +25 | 0 |
| C | realistic50 | 44/50 | 1351 | 1369 | +18 | 0 |
| C | random50 | 34/50 | 1345 | 1366 | +21 | 0 |
| C | scoped50 | 44/50 | 1376 | 1400 | +24 | 0 |
| AC | proto30 | 30/30 | 793 | 815 | +22 | 0 |
| AC | esp32_sensor | 23/23 | 662 | 678 | +16 | 0 |
| AC | realistic50 | 50/50 | 1247 | 1278 | +31 | 0 |
| AC | random50 | 40/50 | 1324 | 1358 | +34 | 0 |
| AC | scoped50 | 50/50 | 1190 | 1219 | +29 | 0 |

### Static RAM of each firmware build (compiler report, of 2048 B)

| Structure | Flash B | Static RAM B |
|---|---:|---:|
| baseline | 20340 | 483 |
| A | 18624 | 479 |
| B | 17530 | 1537 |
| C | 19242 | 355 |
| AB | 17622 | 1540 |
| AC | 19408 | 355 |
| BC | 18528 | 1535 |
| ABC | 20350 | 1547 |

### Speed on the Uno (16 MHz), microseconds per symbol, best of 5

| Structure | Symbol set | Insert | Lookup (found) | Lookup (absent) | Verified |
|---|---:|---:|---:|---:|---:|
| baseline | proto30 | 55.5 | 37.9 | 29.7 | 1 |
| baseline | esp32_sensor | 71.5 | 53.9 | 41.0 | 1 |
| A | proto30 | 76.5 | 57.5 | 29.9 | 1 |
| A | esp32_sensor | 92.3 | 77.0 | 41.0 | 1 |
| A | realistic50 | 77.5 | 58.4 | 31.6 | 1 |
| A | scoped50 | 70.2 | 56.4 | 26.3 | 1 |
| B | proto30 | 42.3 | 38.7 | 30.4 | 1 |
| B | esp32_sensor | 58.4 | 54.8 | 41.7 | 1 |
| B | scoped50 | 35.8 | 34.9 | 27.5 | 1 |
| C | proto30 | 87.7 | 32.7 | 29.9 | 1 |
| C | esp32_sensor | 102.8 | 35.3 | 31.7 | 1 |
| AB | proto30 | 65.5 | 60.0 | 30.3 | 1 |
| AB | esp32_sensor | 81.7 | 79.5 | 41.6 | 1 |
| AB | realistic50 | 66.5 | 60.8 | 32.6 | 1 |
| AB | random50 | 77.6 | 71.0 | 40.4 | 1 |
| AB | scoped50 | 59.0 | 59.6 | 27.8 | 1 |
| AC | proto30 | 101.5 | 53.5 | 29.9 | 1 |
| AC | esp32_sensor | 103.0 | 59.1 | 31.3 | 1 |
| AC | realistic50 | 103.8 | 57.7 | 33.8 | 1 |
| AC | scoped50 | 93.4 | 57.9 | 29.6 | 1 |
| BC | proto30 | 58.0 | 44.8 | 36.1 | 1 |
| BC | esp32_sensor | 61.7 | 47.1 | 36.9 | 1 |
| ABC | proto30 | 82.0 | 63.9 | 36.0 | 1 |
| ABC | esp32_sensor | 85.6 | 69.2 | 36.7 | 1 |
| ABC | realistic50 | 93.0 | 69.8 | 41.7 | 1 |
| ABC | scoped50 | 82.7 | 69.9 | 36.7 | 1 |

### Capacity: 400-name set inserted until the structure is full

| Structure | Fit in 1200 B | Held when it stopped | Stopped because | Bytes then | Free RAM then | Verified |
|---|---:|---:|---:|---:|---:|---:|
| baseline | 41 | 47 | out_of_ram | 1343 | 256 | 1 |
| A | 49 | 58 | out_of_ram | 1405 | 261 | 1 |
| B | 48 | 48 | arena_full | 1172 | 480 | 1 |
| C | 38 | 44 | out_of_ram | 1389 | 270 | 1 |
| AB | 50 | 50 | arena_full | 1014 | 477 | 1 |
| AC | 48 | 55 | out_of_ram | 1390 | 269 | 1 |
| BC | 46 | 46 | arena_full | 1157 | 482 | 1 |
| ABC | 54 | 54 | arena_full | 1143 | 434 | 1 |

### Stored in EEPROM, reloaded after a reset

| Structure | Symbol set | Table in RAM B | Snapshot B | Save ms | Reload ms | CRC ok | Verified |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline | proto30 | 901 | 533 | 1575 | 7.9 | 1 | 1 |
| baseline | esp32_sensor | 833 | 521 | 1429 | 8.0 | 1 | 1 |
| ABC | proto30 | 669 | 677 | 1711 | 5.2 | 1 | 1 |
| ABC | esp32_sensor | 570 | 578 | 1403 | 4.5 | 1 | 1 |
