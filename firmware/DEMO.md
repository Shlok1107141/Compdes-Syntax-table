# Live demo: the symbol table on an Arduino Uno

The app streams a C program to the Uno one declaration at a time. The PC parses
the code (the Uno has no lexer and only 2 KB of RAM); the board inserts each
declaration into the structure it was flashed with, verifies it, and reports
the bytes it took and the RAM left. Every number on the panel is tagged
LIVE (from the board), MODEL, PC or RECORDED.

The board is an Arduino Uno compatible (ATmega328P, CH340 USB-serial), not a
genuine Arduino; say so if asked.

## Start (on the computer the board is plugged into)

```bash
gcc -std=c11 -O2 -DSYMTAB_NO_MAIN engine/symtab_analyze.c engine/variant_*.c -o engine/symtab_analyze.exe -lm
```
```bash
.venv/Scripts/python -m uvicorn --app-dir backend main:app --port 8000
```
```bash
npm --prefix frontend run dev
```

Open http://localhost:5173, then **Hardware → Arduino Uno (live)**. The panel
finds the board by itself (COM3 here) and shows which structure it runs.
Docker and the GitHub Pages site cannot reach a USB port; use this setup.

## Script (about 6 minutes)

1. **Textbook table runs out.** Flash the baseline:
   ```bash
   python firmware/tools/flash.py baseline --port COM3
   ```
   Press **Refresh**. Program: *Arduino Uno Demo (50 Embedded Globals)*, pace
   120 ms, **Run on Uno**. Watch the heap bar grow; near the end the board
   refuses a symbol (out of RAM) and every one after it.
2. **Compressed table holds them all.** Flash ABC (`flash.py ABC --port COM3`),
   **Refresh**, run the same program: all 50 stored and verified in 1,065 B.
   Point at the MODEL tile (what the textbook table would need for the same
   symbols) and the PC tile (the same program on a 64-bit PC: the saving is
   much larger there because pointers are 8 B, not 2 B).
3. **It survives a reset.** Program: *Embedded Sensor Subsystem (Prototype's
   30 names)*, **Run on Uno**, **Save to EEPROM** (about 2 s). Press the
   board's reset button (or **Reset board**). **Lookup** `counter_max`: the
   board says it has no table. **Load from EEPROM**, then **Lookup** again:
   FOUND. ABC's arrays hold indices, not addresses, so they are copied back
   byte for byte.
4. **Recorded results** at the bottom: all eight structures measured on this
   board (`firmware/results/HARDWARE_RESULTS.md`).

Things to know:
- `flash.py` asks the running backend to release the port before uploading.
- The 50-name table is too big for the 1,024 B EEPROM (the board says so);
  use the 30-name program for step 3.
- The live run keeps more stack free than the batch benchmark, so the point
  where the textbook table refuses can be a few symbols later than in the
  recorded results. Both are real runs; quote whichever you show.

## Rehearsal checklist

- [ ] Close the Arduino IDE Serial Monitor (it holds the port).
- [ ] Board in camera view; the L LED blinks on every command.
- [ ] `python firmware/tools/flash.py ABC --port COM3` works, then flash baseline for step 1.
- [ ] Backend and frontend running; Hardware tab shows ONLINE.
- [ ] Run steps 1 to 3 once before the call.

If something goes wrong: **Refresh** reconnects (the Uno restarts when its
port opens, about 2 s). "Port in use": close the Serial Monitor or another
script. "No uno_bench firmware answered": flash it with `flash.py`. Unplugging
mid-run shows an error; plug back in and press **Refresh**.
