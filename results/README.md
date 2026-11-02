# Results

All results in the manuscript come from the files below; nothing is typed in by hand.
`bash scripts/reproduce_results.sh` regenerates the deterministic ones into
`results/regenerated/` and checks them against these files (`--corpus` also re-measures the
real C corpus).

## Data files

| File | What it holds | Produced by |
|---|---|---|
| [`engine/results.csv`](../engine/results.csv) | Memory of all 7 compressed structures vs the baseline: 3 naming patterns × n = 10 … 1,000 (168 rows) | `engine/run_sweep.sh` |
| [`engine/results_seeds.csv`](../engine/results_seeds.csv) | The same sweep for seeds 1–5 (840 rows) | `SEEDS="1 2 3 4 5" engine/run_sweep.sh` |
| [`engine/real_corpus.csv`](../engine/real_corpus.csv) | All 8 structures on 93 real C files, raw and preprocessed | `engine/real_corpus.py` |
| [`engine/bench_results.csv`](../engine/bench_results.csv) | ns per insert / lookup hit / lookup miss, 8 structures, n = 100 and 1,000 (Linux, glibc, `-O2`) | `make -C engine bench` |
| [`engine/EVALUATION.md`](../engine/EVALUATION.md) | The analysis of all of the above, with caveats | written from the data |
| [`backend/tests/ADVERSARIAL_TEST_REPORT.md`](../backend/tests/ADVERSARIAL_TEST_REPORT.md) | 25 hostile-input and request-flood cases against the API, all passed | `backend/tests/test_hostile_inputs.py`, `backend/scripts/adversarial_e2e.py` |
| [`firmware/results/`](../firmware/results/) | 468 runs of the 8 structures on an Arduino Uno (ATmega328P): RAM, capacity, timing, EEPROM save/load | `firmware/tools/collect.py`, `board_runs.py`; summary in [`HARDWARE_RESULTS.md`](../firmware/results/HARDWARE_RESULTS.md) |

## Evaluation metrics

- **Bytes** used by each structure, and the **saving** against the baseline: `(baseline − structure) / baseline`.
- **Bytes per declaration** (median over files).
- **Files in which each structure is the smallest.**
- **Peak memory** when each block's symbols are freed as the block closes.
- **Nanoseconds per operation** for insert, successful lookup and failed lookup.
- **Spread across seeds** of the AB − ABC difference (mean ± standard deviation, percentage points).

Every structure is verified (every declaration found with its exact attributes, absent names
rejected) before it is measured, and the C code runs clean under AddressSanitizer and UBSan.

## Headline results

| Measurement | Baseline | Arena + bit-packing (AB) | All three (ABC) |
|---|---:|---:|---:|
| 30-identifier prototype | 2,725 B | 661 B (−75.7%) | 669 B (−75.4%) |
| Real C, 84 preprocessed translation units (126,374 declarations) | 9,631,762 B | 2,522,562 B (−73.8%) | **2,484,115 B (−74.2%)** |
| Real C, 93 raw files (7,437 declarations) | 573,678 B | **121,494 B (−78.8%)** | 121,836 B (−78.8%) |
| Files in which the structure is smallest (preprocessed / raw) | 0 / 0 | 40 / 44 | **44 / 49** |
| Insert, ns (realistic names, n = 1,000) | 27.0 | **7.8** | 39.6 |

The trie on its own makes the table larger (+48.1% on the prototype, +58.0% on preprocessed
code); the saving comes from the arena and bit-packing, and the trie adds a little on top of them.

## Sample outputs

[`sample_outputs/`](sample_outputs/) holds the exact terminal output of the programs
(GCC 15.2, Linux x86-64), which `scripts/reproduce_results.sh` compares against:

| File | Command |
|---|---|
| [`symtab_demo.txt`](sample_outputs/symtab_demo.txt) | `engine/symtab_demo` (the 30-identifier prototype) |
| [`variants.txt`](sample_outputs/variants.txt) | `make -C engine run` (the seven variants on the same 30 identifiers) |
| [`sweep_table.txt`](sample_outputs/sweep_table.txt) | `engine/run_sweep.sh` (comparison tables of the sweep) |
| [`analyze_example.json`](sample_outputs/analyze_example.json) | the analyzer (and `POST /analyze`) on `int sensor_temp; int sensor_press; void system_init() { int local_val; }` |
