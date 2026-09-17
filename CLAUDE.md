# BCSE307L — Compiler Design Team Project: Compressed Symbol Table

## Project Summary
A memory-optimized compiler symbol table combining three techniques:
1. **Radix (Patricia) Trie**: Identifier storage with prefix compression (trie IS the intern table).
2. **Flat Arena Allocation**: 16-bit array indices (`uint16_t`) instead of 64-bit (`uint64_t`) pointers.
3. **Bit-Packed Metadata**: Type (4b), scope (8b), storage class (4b), offset (16b) in a single 32-bit word (`uint32_t`).

**Verified Prototype Results**:
- Baseline Hash Table: 32 bytes/node + malloc overhead = 960 bytes for 30 symbols.
- Compressed Table: 10 bytes/node = 236 bytes for 30 symbols.
- **75.4% Memory Savings**, verified clean under GCC `-fsanitize=address,undefined`.

---

## Team & Roles
- **Shlok** ([@Shlok1107141](https://github.com/Shlok1107141)): Engine + Backend (C lexer/scope tracker, FastAPI wrapper, subprocess executor, `POST /analyze`).
- **Sagnik Datta** ([@armoredglock](https://github.com/armoredglock)): Frontend (React + Vite + Tailwind CSS, live stats, symbol table view, Radix trie visualizer).
- **Hardik** ([@hardikpardik](https://github.com/hardikpardik)): Ablation Study (7 engine variants, scaling sweep N=10..300, comparison table).
- **Eben** ([@Eben923](https://github.com/Eben923)): Research Paper, Security Policy (deliberately narrow: untrusted code input, subprocess bounds), and adversarial testing.

---

## API Contract (Locked Day 1)
- **Endpoint**: `POST /analyze`
- **Request**: `{ "code": "<source code text>" }`
- **Response**:
```json
{
  "baseline_bytes": 960,
  "compressed_bytes": 236,
  "savings_pct": 75.4,
  "symbol_table": [
    {
      "name": "sensor_temp",
      "type": "int",
      "scope": 0,
      "storage_class": "global",
      "offset": 0
    }
  ],
  "ablation": {
    "trie_only": 620,
    "arena_only": 540,
    "bitpack_only": 810,
    "trie_arena": 380,
    "trie_bitpack": 490,
    "arena_bitpack": 430
  }
}
```

---

## Build & Test Commands

### C Engine
```bash
cd engine
gcc -std=c11 symtab_demo.c -o symtab_demo -fsanitize=address,undefined -Wall -Wextra -Werror -pedantic
./symtab_demo

gcc -std=c11 symtab_stress.c -o symtab_stress -fsanitize=address,undefined -Wall -Wextra -Werror -pedantic
./symtab_stress
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
