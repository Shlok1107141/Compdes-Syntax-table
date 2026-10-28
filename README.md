# Memory-Constrained Compressed Symbol Table

> **BCSE307L — Compiler Design Team Project**  
> A memory-optimized symbol table for resource-constrained compilers, with a C engine, a sandboxed API and an interactive web demo.

[![CI](https://github.com/Shlok1107141/Compdes-Syntax-table/actions/workflows/ci.yml/badge.svg)](https://github.com/Shlok1107141/Compdes-Syntax-table/actions/workflows/ci.yml)
[![Reproduce](https://github.com/Shlok1107141/Compdes-Syntax-table/actions/workflows/reproduce.yml/badge.svg)](https://github.com/Shlok1107141/Compdes-Syntax-table/actions/workflows/reproduce.yml)
&nbsp;Live demo: <https://shlok1107141.github.io/Compdes-Syntax-table/>

---

## 📦 Reproducibility Package

Everything needed to rebuild, run and re-measure the project without its authors:

| # | Item | Where |
|---|---|---|
| 1 | Manuscript LaTeX (Overleaf zip: `main.tex` + all images) | [`docs/manuscript/DenseSym_Draft2_LaTeX.zip`](docs/manuscript/DenseSym_Draft2_LaTeX.zip) |
| 2 | Source code | [`engine/`](engine/) (C11), [`backend/`](backend/) (Python/FastAPI), [`frontend/`](frontend/) (React/TypeScript), [`firmware/`](firmware/) (Arduino Uno, ESP32) |
| 3 | README | this file; also [`backend/README.md`](backend/README.md), [`frontend/README.md`](frontend/README.md), [`firmware/README.md`](firmware/README.md) |
| 4 | Dependencies | [`backend/requirements.txt`](backend/requirements.txt) (minimums) and [`backend/requirements-lock.txt`](backend/requirements-lock.txt) (exact), [`frontend/package.json`](frontend/package.json) and [`package-lock.json`](frontend/package-lock.json) (exact); the engine needs only a C11 compiler; firmware: Arduino AVR core 1.8.7 |
| 5 | Datasets | [`datasets/`](datasets/): download links, [`fetch_corpus.py`](datasets/fetch_corpus.py) (verifies SHA-256 of all 93 files), preprocessing via [`engine/real_corpus.py`](engine/real_corpus.py); synthetic workloads in [`engine/symtab_workloads.h`](engine/symtab_workloads.h) |
| 6 | Trained models | none: DenseSym is a deterministic data structure, not an ML model ([details](#-models)) |
| 7 | Configuration | [`backend/.env.example`](backend/.env.example), [`frontend/.env.example`](frontend/.env.example), [`docker-compose.yml`](docker-compose.yml), [`firmware/esp32/platformio.ini`](firmware/esp32/platformio.ini) |
| 8 | Execution scripts | [`scripts/setup.sh`](scripts/setup.sh), [`scripts/test.sh`](scripts/test.sh), [`scripts/run.sh`](scripts/run.sh), [`scripts/reproduce_results.sh`](scripts/reproduce_results.sh) |
| 9 | Results | [`results/`](results/) (index, metrics, sample outputs), [`engine/*.csv`](engine/), [`engine/EVALUATION.md`](engine/EVALUATION.md), [`firmware/results/`](firmware/results/) |
| 10 | Documentation: manuscript (Draft 2, PDF) | [`docs/manuscript/DenseSym_Draft2.pdf`](docs/manuscript/DenseSym_Draft2.pdf) |

The **Reproduce** workflow checks this on every push: on a clean Ubuntu machine it runs
`scripts/setup.sh`, `scripts/test.sh` and `scripts/reproduce_results.sh --corpus` exactly as
written below, and compiles the manuscript zip with TeX Live.

---

## 📌 Problem & Motivation

Standard compiler frontends rely on textbook separate-chaining hash tables for symbol tables. On a desktop that overhead is negligible; in **memory-constrained embedded systems, bare-metal cross-compilers and RTOS environments** it is not:

- **64-bit pointer bloat**: several 8-byte pointer fields per node (`*next`, `*name`, ...).
- **Per-allocation heap overhead**: one `malloc` for every node and every identifier string, each carrying allocator metadata.
- **Redundant string storage**: identifiers sharing prefixes (`sensor_read_temp`, `sensor_read_press`) store the same characters again and again.
- **Unpacked fields**: four `int`s of metadata where 32 bits suffice.

---

## 💡 Three Techniques

```
+-------------------------------------------------------------------------+
|                  COMPRESSED SYMBOL TABLE ARCHITECTURE                   |
+-------------------------------------------------------------------------+
|  1. Patricia / Radix Trie      |  2. 16-bit Arena Allocation             |
|     Edges store shared         |     Nodes and strings live in flat      |
|     prefixes; the trie IS      |     arenas addressed by 16-bit offsets  |
|     the string intern table    |     instead of 64-bit (8-byte) pointers |
+--------------------------------+----------------------------------------+
|                                3. Bit-Packed Metadata                   |
|     Type (4b) + Scope (8b) + Storage Class (4b) + Offset (16b)          |
|     packed into a single 32-bit word (uint32_t)                         |
+-------------------------------------------------------------------------+
```

Each technique can be switched on or off, which gives eight structures. All eight are implemented in [`engine/variant_*.c`](engine/) and compared head to head.

---

## 📊 Results

Full analysis, methodology and caveats: **[`engine/EVALUATION.md`](engine/EVALUATION.md)**.

**On real C code** (93 files from SQLite, GNU readline, xz, MPFR and this engine; 133,811 declarations):

| | Baseline hash table | Arena + bit-packing (AB) | All three (ABC) |
| :--- | ---: | ---: | ---: |
| Preprocessed translation units (what a compiler stores) | 9.63 MB | 2.52 MB (−73.8%) | **2.48 MB (−74.2%)** |
| Raw source files (the program's own declarations) | 574 KB | 121.5 KB (−78.8%) | **121.8 KB (−78.8%)** |
| Bytes per declaration (median, preprocessed) | 76.6 | — | **20.5** |

- All three together is the smallest structure in more files than any alternative (44 vs 40 preprocessed; 49 vs 44 raw) — but only narrowly: **arena + bit-packing deliver almost all of the saving**, and the trie adds about 0–2% on top.
- **The trie on its own makes the table 38–58% larger** (8-byte pointers and a `malloc` per node outweigh the shared prefixes).
- The trie pays off most where names repeat across scopes (`i`, `tmp`, `count` in every function) or share long prefixes.
- **Speed is not a concern**: every structure inserts and looks up in tens of nanoseconds; the arena makes inserts 3–4× faster than the baseline.

**The original 30-identifier prototype** ([`engine/symtab_demo.c`](engine/symtab_demo.c)):

| Metric | Baseline hash table | Compressed (ABC) | Saving |
| :--- | :--- | :--- | :--- |
| Node representation | 32 B unpacked struct + pointers | 10 B node, 16-bit indices | 68.8% per node |
| Total memory | 2,725 bytes | 669 bytes | **75.4%** |
| Lookup correctness | 100% verified | 100% verified | identical |

All engine code is verified under GCC `-fsanitize=address,undefined` (with leak detection) before any number is reported.

---

## 🏛 Repository Layout

```
Compdes-Syntax-table/
├── engine/                       C engine and benchmarks
│   ├── symtab_analyze.c          lexer + scope tracker + scoped lookup; builds all 8 structures per request
│   ├── symtab_common.h           shared interface, accounting model, baseline hash table
│   ├── variant_*.c               the 7 compressed variants (A, B, C, AB, AC, BC, ABC)
│   ├── symtab_workloads.h        generated identifier sets (realistic / random / scoped)
│   ├── symtab_stress.c, run_sweep.sh, compare_table.py   memory sweep  -> results.csv
│   ├── symtab_bench.c            speed benchmark                      -> bench_results.csv
│   ├── real_corpus.py            real C files                         -> real_corpus.csv
│   ├── EVALUATION.md             what the data says
│   └── symtab_demo.c             the original 30-symbol prototype
├── backend/                      FastAPI service (POST /analyze), sandboxed engine subprocess
│   ├── tests/                    pytest suite, incl. hostile inputs and result reproducibility
│   └── scripts/                  offline-sample generator, adversarial end-to-end suite
├── frontend/                     React + Vite web app (metrics, symbol table, trie visualizer, hardware)
├── firmware/                     Arduino Uno benchmark (uno_bench/), ESP32 sketch, board tools, board results
├── datasets/                     real-C corpus: links, manifest with SHA-256, fetch and check scripts
├── results/                      results index, evaluation metrics, sample outputs
├── scripts/                      setup.sh, test.sh, run.sh, reproduce_results.sh
├── docs/                         figures and the manuscript (PDF + Overleaf LaTeX zip)
├── docker-compose.yml            whole app on http://localhost:8080
└── .github/workflows/            ci.yml (all suites), reproduce.yml (fresh clone + manuscript), pages.yml
```

---

## 🖥 System Requirements

| Needed for | Requirement | Tested with |
|---|---|---|
| Operating system | Linux, macOS, or Windows with **WSL2** (the scripts are bash; MinGW on Windows has no sanitizer runtime) | Ubuntu 24.04, WSL2 Ubuntu |
| Engine | GCC 11+ (any C11 compiler for plain builds; GCC or Clang for `-fsanitize`), GNU make | GCC 13.3, 15.2 |
| Backend | Python 3.10+ with `venv` (Debian/Ubuntu: `sudo apt install python3-venv`) | Python 3.11, 3.12 |
| Frontend | Node.js 20.19+ or 22.12+ (Vite 8), npm 10+ | Node 20, 22 |
| Disk / network | about 600 MB after setup (mostly `frontend/node_modules`); internet access during setup | |
| *Optional:* whole stack | Docker 24+ with Compose v2 | |
| *Optional:* hardware | Arduino Uno (ATmega328P) + `arduino-cli` with core `arduino:avr@1.8.7`; ESP32 + PlatformIO | |
| *Optional:* manuscript | Overleaf, or TeX Live 2022+ (`latexmk`, pdfLaTeX) | TeX Live (GitHub Actions) |

No accounts, API keys or passwords are needed.

---

## ⚙️ Installation

```bash
git clone https://github.com/Shlok1107141/Compdes-Syntax-table.git
cd Compdes-Syntax-table
bash scripts/setup.sh
```

[`scripts/setup.sh`](scripts/setup.sh) checks the tool versions, builds the C engine
(`make -C engine all syntax_bench`), creates `.venv/` with the exact Python packages of
[`backend/requirements-lock.txt`](backend/requirements-lock.txt), runs `npm ci` in `frontend/`
(exact versions from `package-lock.json`) and creates `backend/.env` from its template.
Set `VENV=/some/path` to put the virtual environment elsewhere.

The same steps by hand:

```bash
make -C engine all syntax_bench
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements-lock.txt
npm ci --prefix frontend
cp backend/.env.example backend/.env
```

---

## 🔧 Configuration

All settings are optional; the defaults work for local use. Templates:

| File | Read by | Settings |
|---|---|---|
| [`backend/.env.example`](backend/.env.example) → `backend/.env` | `scripts/run.sh` (exported to the backend) | `SYMTAB_ALLOWED_ORIGINS` (CORS), `SYMTAB_MAX_CODE_BYTES` (64 KB), `SYMTAB_RATE_LIMIT` (30/min), `SYMTAB_MAX_CONCURRENCY` (4), `SYMTAB_ENGINE_TIMEOUT` (5 s), `SYMTAB_TRUST_PROXY_HEADERS`, `SYMTAB_ENGINE`, `SYNTAX_ENGINE`, `ESP32_PORT`, `ESP32_BAUD` |
| [`frontend/.env.example`](frontend/.env.example) → `frontend/.env` | Vite | `VITE_API_URL` (default `/api`), `VITE_BASE` (default `/`) |
| [`docker-compose.yml`](docker-compose.yml) | Docker | the containers' limits, origins and isolation |
| [`firmware/esp32/platformio.ini`](firmware/esp32/platformio.ini) | PlatformIO | ESP32 board and port |

The Arduino Uno's serial port is chosen in the web page (Web Serial) or passed to the tools
with `--port`.

---

## ▶️ Execution

### Run the application

```bash
bash scripts/run.sh                # backend on :8000 + web app on http://localhost:5173
docker compose up --build          # or: production-style stack on http://localhost:8080
```

In the web app, pick a preset or paste C code. **Offline** mode shows the engine's precomputed
results for the presets; **Live Backend** sends your code to the C engine. The hosted site
(<https://shlok1107141.github.io/Compdes-Syntax-table/>) runs in offline mode.

### Test

```bash
bash scripts/test.sh                       # engine, firmware, backend, frontend
bash scripts/test.sh engine backend        # or only some suites
```

### Reproduce the results

```bash
bash scripts/reproduce_results.sh          # prototype, 7 variants, memory sweep, API example, speed
bash scripts/reproduce_results.sh --corpus # + download and re-measure the 93-file real-C corpus
```

Outputs go to `results/regenerated/`. Every deterministic result is compared with the committed
one and must match exactly (`MATCH ... every deterministic result matches the committed one`).
Speed depends on the machine and is regenerated but not compared.

### Individual engine commands

```bash
cd engine
make check       # build the analyzer under ASan/UBSan and smoke-test it
make run         # each variant's demo against the 30-symbol test set
make sweep       # memory sweep -> results.csv (+ comparison table)
make bench       # speed benchmark -> bench_results.csv
```

The original prototype still builds on its own:
`gcc -std=c11 -fsanitize=address,undefined -Wall -Wextra symtab_demo.c -o symtab_demo && ./symtab_demo`

See [`backend/README.md`](backend/README.md) for the API, limits and security measures.

### Hardware (optional)

Flash a structure onto an Arduino Uno and run the board benchmark or the live demo:
[`firmware/README.md`](firmware/README.md) and [`firmware/DEMO.md`](firmware/DEMO.md)
(`python firmware/tools/flash.py ABC --port COM3`). No board is needed for the tests:
`scripts/test.sh firmware` runs the same benchmark code on the PC under sanitizers.

### Manuscript

Upload [`docs/manuscript/DenseSym_Draft2_LaTeX.zip`](docs/manuscript/DenseSym_Draft2_LaTeX.zip)
to Overleaf (New Project → Upload Project; compiler pdfLaTeX), or unzip it and run
`latexmk -pdf main.tex`. The compiled paper is
[`docs/manuscript/DenseSym_Draft2.pdf`](docs/manuscript/DenseSym_Draft2.pdf).

---

## 🗂 Datasets

| Dataset | Source | Details |
|---|---|---|
| 30-identifier prototype set | in [`engine/symtab_demo.c`](engine/symtab_demo.c) | embedded-style names (`sensor_*`, `counter_*`, ...) |
| Synthetic sweep | generated by [`engine/symtab_workloads.h`](engine/symtab_workloads.h) | realistic / random / scoped names, n = 10 … 1,000, seeds 1–5 |
| Real C corpus | SQLite 3.46.1, GNU Readline 8.2, XZ Utils 5.6.3, GNU MPFR 4.2.1, this engine | 93 files; `python3 datasets/fetch_corpus.py` downloads and verifies them |
| Arduino Uno runs | measured on the board | 468 runs in [`firmware/results/`](firmware/results/) |

Download links, versions, the preprocessing (`gcc -E`) and what reproduces exactly are in
[`datasets/README.md`](datasets/README.md).

## 🧠 Models

DenseSym has **no trained machine-learning models**: the symbol tables are deterministic data
structures, and every result is a measurement. The only fitted model is a small linear timing
model for the Arduino Uno (`insert_us = a + b·name_len + c·symbols_stored`), which the web app
uses to estimate code it cannot run on the board. Its coefficients are in
[`frontend/src/data/unoBoard.json`](frontend/src/data/unoBoard.json), it is refitted from the
board measurements by [`firmware/tools/fit_uno_model.py`](firmware/tools/fit_uno_model.py), and
CI checks it against every recorded run (`node frontend/scripts/check_uno_model.ts`).

---

## 📡 API Contract

### `POST /analyze`

Parses submitted C source (it is never compiled or executed), builds all eight structures, verifies them and reports their sizes.

**Request**
```json
{ "code": "int sensor_temp;\nint sensor_press;\nvoid system_init() { int local_val; }" }
```

**Response (200 OK)** — real output for that request (2 of 4 symbols shown)
```json
{
  "baseline_bytes": 815,
  "compressed_bytes": 121,
  "savings_pct": 85.15,
  "symbol_table": [
    { "name": "sensor_temp",  "type": "int", "scope": 0, "storage_class": "global",
      "offset": 0, "references": 0, "packed": 65536 },
    { "name": "sensor_press", "type": "int", "scope": 0, "storage_class": "global",
      "offset": 4, "references": 0, "packed": 65540 }
  ],
  "ablation": {
    "bitpack_only": 783, "arena_only": 255, "trie_only": 651,
    "arena_bitpack": 207, "trie_bitpack": 467, "trie_arena": 169
  },
  "peak": { "baseline_bytes": 815, "compressed_bytes": 121, "savings_pct": 85.15, "live_symbols": 4 }
}
```

The five original fields are the locked Day 1 contract. `references` (uses resolved to each declaration by scoped lookup), `packed` (the stored 32-bit word) and `peak` (memory if scopes are freed on exit) were added later without changing any of them.

---

## 👥 Team & Responsibilities

| Contributor | Area of Ownership | Deliverables |
| :--- | :--- | :--- |
| [**Shlok**](https://github.com/Shlok1107141) (`@Shlok1107141`) | Engine + Backend | C lexer/scope tracker, FastAPI wrapper, subprocess execution, API contract |
| [**Sagnik Datta**](https://github.com/armoredglock) (`@armoredglock`) | Frontend | Interactive web UI, live metrics, symbol table view, Radix trie visualizer |
| [**Hardik**](https://github.com/hardikpardik) (`@hardikpardik`) | Ablation Study | 7-configuration engine variants, scaling measurements, ablation comparison matrix |
| [**Eben**](https://github.com/Eben923) (`@Eben923`) | Paper + Security + Testing | Research paper, adversarial input testing, subprocess security auditing |

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
