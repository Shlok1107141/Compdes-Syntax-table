# BCSE307L — Compiler Design Team Project: Compressed Symbol Table

## Project Summary
A memory-optimized compiler symbol table combining three techniques:
1. **Radix (Patricia) Trie**: Identifier storage with prefix compression (trie IS the intern table).
2. **Flat Arena Allocation**: 16-bit array indices (`uint16_t`) instead of 64-bit (`uint64_t`) pointers.
3. **Bit-Packed Metadata**: Type (4b), scope (8b), storage class (4b), offset (16b) in a single 32-bit word (`uint32_t`).

**Verified Prototype Results** (`engine/symtab_demo.c`, 30 symbols):
- Baseline hash table: 32 B nodes + names + malloc overhead + 64-bucket array = **2,725 bytes**.
- Compressed table: 10 B trie nodes + 139 B char pool + 4 B packed words = **669 bytes**.
- **75.4% memory savings**, verified clean under GCC `-fsanitize=address,undefined`.

**On real C code** (see `engine/EVALUATION.md`): all three techniques save 74–79%, but
arena + bit-packing alone saves 73.8–78.8%; the trie adds ~0–2% and on its own makes the
table 38–58% larger. Never quote a figure that a script in `engine/` does not produce.

---

## Team & Roles
- **Shlok** ([@Shlok1107141](https://github.com/Shlok1107141)): Engine + Backend (C lexer/scope tracker, FastAPI wrapper, subprocess executor, `POST /analyze`).
- **Sagnik Datta** ([@armoredglock](https://github.com/armoredglock)): Frontend (React + Vite + Tailwind CSS, live stats, symbol table view, Radix trie visualizer).
- **Hardik** ([@hardikpardik](https://github.com/hardikpardik)): Ablation Study (7 engine variants, scaling sweep N=10..1000, comparison table).
- **Eben** ([@Eben923](https://github.com/Eben923)): Research Paper, Security Policy (deliberately narrow: untrusted code input, subprocess bounds), and adversarial testing.

---

## API Contract (Locked Day 1)
- **Endpoint**: `POST /analyze`
- **Request**: `{ "code": "<source code text>" }`
- **Response** (real output for `int sensor_temp; int sensor_press; void system_init() { int local_val; }`, 1 of 4 symbols shown):
```json
{
  "baseline_bytes": 815,
  "compressed_bytes": 121,
  "savings_pct": 85.15,
  "symbol_table": [
    { "name": "sensor_temp", "type": "int", "scope": 0, "storage_class": "global",
      "offset": 0, "references": 0, "packed": 65536 }
  ],
  "ablation": {
    "bitpack_only": 783, "arena_only": 255, "trie_only": 651,
    "arena_bitpack": 207, "trie_bitpack": 467, "trie_arena": 169
  },
  "peak": { "baseline_bytes": 815, "compressed_bytes": 121, "savings_pct": 85.15, "live_symbols": 4 }
}
```
The five original fields are locked; `references`, `packed` and `peak` are additive.

---

## Build & Test Commands

### C Engine
```bash
cd engine
make check      # analyzer (links all variants) under ASan/UBSan
make run        # each variant's demo on the 30-symbol set
make sweep      # results.csv  (memory; reproducibility checked by backend tests)
make bench      # bench_results.csv (speed)
python3 real_corpus.py --summary real_corpus.csv   # real-code measurements
```
MinGW has no sanitizer runtime: verify under WSL/Linux (CI does).
`symtab_stress.c` compiled without `-DCFG=...` is a stub; use `run_sweep.sh`.

### Whole app
```bash
docker compose up --build    # http://localhost:8080
```

### Python Backend
```bash
cd backend
pip install -r requirements.txt
pytest -v --tb=short
```

### Frontend (React + Vite)
```bash
cd frontend
npm ci
npm run lint
npm run build
```
