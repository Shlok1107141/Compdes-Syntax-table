# Memory-Constrained Compressed Symbol Table

> **BCSE307L — Compiler Design Team Project**  
> A high-efficiency, memory-optimized symbol table architecture engineered for resource-constrained embedded compilers.

---

## 📌 Problem & Motivation

Standard compiler frontends rely on textbook separate-chaining hash tables for symbol tables. On standard 64-bit desktop/server environments, this overhead is negligible. However, in **memory-constrained embedded systems, bare-metal cross-compilers, and RTOS environments**, standard hash tables suffer from severe memory inflation:

- **64-bit Pointer Bloat**: Multiple 8-byte pointer fields per node (`*next`, `*name`, etc.) consume excessive RAM.
- **Dynamic Heap Allocation Overhead**: Performing individual heap allocations (`malloc`) for every node and identifier string causes severe memory fragmentation and allocator metadata overhead.
- **Redundant String Storage**: Identifiers sharing prefixes (e.g., `sensor_read_temp`, `sensor_read_press`) duplicate identical character sequences across the heap.
- **Unpacked Struct Fields**: Memory alignment and padding waste substantial bytes per symbol record.

---

## 💡 Core Innovations

This project demonstrates a symbol table that combines **three memory-saving techniques** to beat a textbook separate-chaining baseline by **~75.4%** in memory consumption, while also outperforming each technique applied in isolation:

```
+-------------------------------------------------------------------------+
|                  COMPRESSED SYMBOL TABLE ARCHITECTURE                   |
+-------------------------------------------------------------------------+
|  1. Patricia / Radix Trie     |  2. 16-bit Arena Allocation             |
|     Edges store shared         |     Nodes and strings live in flat      |
|     prefixes; the trie IS      |     arenas addressed by 16-bit offsets  |
|     the string intern table    |     instead of 64-bit (8-byte) pointers |
+--------------------------------+----------------------------------------+
|                                3. Bit-Packed Metadata                   |
|     Type (4b) + Scope (8b) + Storage Class (4b) + Offset (16b)          |
|     packed into a single 32-bit word (uint32_t)                         |
+-------------------------------------------------------------------------+
```

1. **Radix (Patricia) Trie for Identifier Storage**:
   Edges represent shared prefixes. Common naming conventions in embedded systems (e.g., subsystem prefixes) automatically share memory. The trie itself functions as the string intern table, eliminating duplicate strings.
2. **Flat Arena Allocation with 16-Bit Indices**:
   Instead of allocating separate memory blocks with 8-byte pointers, all nodes and identifier edges reside in contiguous pre-allocated arena arrays, addressed using compact 16-bit indices (up to 65,536 entries).
3. **Bit-Packed Symbol Metadata**:
   Symbol attributes are tightly packed into a single 32-bit integer (`uint32_t`):
   - Type (4 bits)
   - Scope Depth (8 bits)
   - Storage Class (4 bits)
   - Stack/Struct Offset (16 bits)

---

## 📊 Prototype Verification & Results

The verified prototype in [`engine/symtab_demo.c`](engine/symtab_demo.c) benchmarks 30 realistic embedded C identifiers against a textbook hash table:

| Metric | Baseline Hash Table | Compressed Architecture | Savings |
| :--- | :--- | :--- | :--- |
| **Node Representation** | Unpacked struct + 64-bit pointers | 16-bit arena indices + bit-packing | **68.8% reduction** (32 B/node -> 10 B/node) |
| **Total Memory Allocated** | 960 bytes | 236 bytes | **75.4% total memory savings** |
| **Lookup Correctness** | 100% verified | 100% verified | Identical lookup guarantees |

Sanitizer validation passes cleanly under GCC with `-fsanitize=address,undefined`.

---

## 🏛 Repository Architecture

```
Compdes-Syntax-table/
├── engine/                  # Core C engine & benchmark implementations
│   ├── symtab_demo.c        # Verified 30-symbol prototype benchmark
│   └── symtab_stress.c      # Scaling sweep harness (N=10 to 300)
├── backend/                 # FastAPI REST service wrapping engine binary
│   ├── requirements.txt     # Python dependencies (fastapi, uvicorn, pytest)
│   └── test_placeholder.py  # Unit tests
├── frontend/                # Interactive web demo & visualizer (React + Vite)
├── .github/
│   └── workflows/
│       └── ci.yml           # Multi-job CI (engine sanitizers, backend tests, frontend build)
├── CONTRIBUTING.md          # Contribution guidelines & testing standards
├── SECURITY.md              # Targeted security policy & sandbox boundaries
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites
- **GCC / Clang** with AddressSanitizer and UndefinedBehaviorSanitizer support.
- **Python 3.11+**
- **Node.js 20+** & **npm**

### 1. Engine (C)

Compile and execute the engine verification tests with memory and undefined-behavior sanitizers:

```bash
cd engine

# Compile demo with AddressSanitizer and UndefinedBehaviorSanitizer
gcc symtab_demo.c -o symtab_demo -fsanitize=address,undefined -Wall -Wextra
./symtab_demo

# Compile and run scaling stress sweep
gcc symtab_stress.c -o symtab_stress -fsanitize=address,undefined -Wall -Wextra
./symtab_stress
```

### 2. Backend (FastAPI)

Set up the Python environment and run backend tests:

```bash
cd backend
python -m venv venv

# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
pytest
```

To run the development server:
```bash
uvicorn main:app --reload --port 8000
```

### 3. Frontend (React / Vite)

```bash
cd frontend
npm install
npm run dev
```

To verify production build (matches CI requirements):
```bash
npm run build
```

---

## 📡 API Contract

The backend and frontend communicate via a locked REST API contract:

### `POST /analyze`

Analyzes user-submitted C-like source code and computes memory metrics across symbol table configurations.

#### Request Body
```json
{
  "code": "int sensor_temp;\nint sensor_press;\nvoid system_init() { int local_val; }"
}
```

#### Response (200 OK)
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
    },
    {
      "name": "sensor_press",
      "type": "int",
      "scope": 0,
      "storage_class": "global",
      "offset": 4
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

## 👥 Team & Responsibilities

| Contributor | Area of Ownership | Deliverables |
| :--- | :--- | :--- |
| [**Shlok**](https://github.com/Shlok1107141) (`@Shlok1107141`) | Engine + Backend | C Lexer/Scope tracker, FastAPI wrapper, subprocess execution, API contract |
| [**Sagnik Datta**](https://github.com/armoredglock) (`@armoredglock`) | Frontend | Interactive web UI, live metrics, symbol table view, Radix trie visualizer |
| [**Hardik**](https://github.com/hardikpardik) (`@hardikpardik`) | Ablation Study | 7-configuration engine variants, scaling measurements, ablation comparison matrix |
| [**Eben**](https://github.com/Eben923) (`@Eben923`) | Paper + Security + Testing | Research paper, adversarial input testing, subprocess security auditing |

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
