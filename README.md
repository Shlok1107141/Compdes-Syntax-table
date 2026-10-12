# Memory-Constrained Compressed Symbol Table

> **BCSE307L — Compiler Design Team Project**  
> A memory-optimized symbol table for resource-constrained compilers, with a C engine, a sandboxed API and an interactive web demo.

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
│   ├── tests/                    pytest suite, run against a sanitizer build of the engine
│   └── scripts/                  offline-sample generator, adversarial end-to-end suite
├── frontend/                     React + Vite web demo (metrics, symbol table, trie visualizer)
├── docker-compose.yml            whole app on http://localhost:8080
└── .github/workflows/ci.yml      engine, backend, frontend and docker jobs
```

---

## 🚀 Getting Started

### Everything at once (Docker)

```bash
docker compose up --build        # then open http://localhost:8080
```

### Engine (C)

```bash
cd engine
make check       # build the analyzer under ASan/UBSan and smoke-test it
make run         # each variant's demo against the 30-symbol test set
make sweep       # memory sweep -> results.csv (+ comparison table)
make bench       # speed benchmark -> bench_results.csv
```

The original prototype still builds on its own:
`gcc -std=c11 -fsanitize=address,undefined -Wall -Wextra symtab_demo.c -o symtab_demo && ./symtab_demo`

### Backend (FastAPI)

```bash
pip install -r backend/requirements.txt
make -C engine symtab_analyze
cd backend && pytest                       # compiles its own sanitizer build of the engine
uvicorn main:app --reload --port 8000
```

See [`backend/README.md`](backend/README.md) for the API, limits and security measures.

### Frontend (React / Vite)

```bash
cd frontend
npm ci
npm run dev          # proxies /api to the backend on port 8000
npm run lint && npm run build
```

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
