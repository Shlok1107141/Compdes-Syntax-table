# Contributing to Compdes-Syntax-table

Thank you for contributing to the **Memory-Constrained Compressed Symbol Table** project (BCSE307L Compiler Design Sprint). To maintain code quality, ensure reproducible benchmarks, and keep our multi-tier CI pipeline green, please follow these guidelines.

---

## 👥 Team Areas of Ownership

Our sprint divides ownership across four primary domains. Before making major structural modifications outside your area, coordinate with the respective owner:

- **Engine & Backend** (Owner: [**Shlok**](https://github.com/Shlok1107141) - `@Shlok1107141`):
  - C lexer, parser, scope tracker, and symbol table implementations (`engine/`).
  - FastAPI web server and subprocess execution harness (`backend/`).
  - API contract maintenance (`POST /analyze`).
- **Frontend** (Owner: [**Sagnik Datta**](https://github.com/armoredglock) - `@armoredglock`):
  - React/Vite web application (`frontend/`).
  - Code input interface, live stats & memory comparison charts.
  - Parsed symbol table viewer and Radix trie visualization.
  - Client-side error handling and mock fallbacks.
- **Ablation Study** (Owner: [**Hardik**](https://github.com/hardikpardik) - `@hardikpardik`):
  - Isolated engine variants (trie-only, arena-only, bitpack-only, pairwise combinations).
  - Stress testing benchmarks across scaling $N$ values.
  - Data generation for comparative paper figures.
- **Paper, Security & Testing** (Owner: [**Eben**](https://github.com/Eben923) - `@Eben923`):
  - Research paper drafts (Problem, Methodology, Results, Discussion).
  - Targeted security auditing (subprocess memory/time bounds, input size limits, CORS).
  - Adversarial and edge-case end-to-end testing.

---

## 🛠 Local Development & Testing Standards

Every component must be validated locally before submitting changes.

### 1. Engine Testing Standard (`engine/`)

> [!IMPORTANT]
> **Mandatory Sanitizer Verification**: All C engine code and ablation variants MUST compile cleanly with AddressSanitizer and UndefinedBehaviorSanitizer enabled. **Unverified benchmarks or crashing builds will not be accepted.**

Run:
```bash
cd engine
gcc symtab_demo.c -o symtab_demo -fsanitize=address,undefined -Wall -Wextra
./symtab_demo

gcc symtab_stress.c -o symtab_stress -fsanitize=address,undefined -Wall -Wextra
./symtab_stress
```
- No memory leaks, out-of-bounds reads/writes, or undefined behavior warnings are permitted.

### 2. Backend Testing Standard (`backend/`)

- Python version: **3.11**
- Run test suite:
```bash
cd backend
pip install -r requirements.txt
pytest
```
- Ensure any added endpoints maintain compliance with the locked API contract (`POST /analyze`).

### 3. Frontend Testing Standard (`frontend/`)

- Node.js version: **20+**
- The repository CI verifies builds using `npm ci` followed by `npm run build`.
- Always verify that the project builds cleanly without TypeScript or bundler errors:
```bash
cd frontend
npm ci
npm run build
```

---

## 🔒 The API Contract

All frontend and backend integrations must adhere strictly to the Day 1 locked JSON interface for `POST /analyze`:

- **Request**:
  ```json
  { "code": "<source code string>" }
  ```
- **Response**:
  ```json
  {
    "baseline_bytes": <int>,
    "compressed_bytes": <int>,
    "savings_pct": <float>,
    "symbol_table": [
      {
        "name": "<str>",
        "type": "<str>",
        "scope": <int>,
        "storage_class": "<str>",
        "offset": <int>
      }
    ],
    "ablation": {
      "trie_only": <int>,
      "arena_only": <int>,
      "bitpack_only": <int>,
      "trie_arena": <int>,
      "trie_bitpack": <int>,
      "arena_bitpack": <int>
    }
  }
  ```

---

## 🌿 Git Workflow & Pull Requests

1. **Branch Naming**:
   - `feature/engine-<feature>` for engine updates
   - `feature/frontend-<feature>` for frontend components
   - `feature/backend-<feature>` for backend endpoints
   - `feature/ablation-<feature>` for ablation variants
   - `fix/<bug-description>` for bug fixes

2. **Commit Messages**:
   - Use clear, descriptive commit messages:
     - `feat(frontend): add radix trie visualizer component`
     - `test(engine): add stress sweep test for random identifier set`
     - `fix(backend): enforce 64kb payload limit on /analyze`

3. **Pull Request Checklist**:
   - [ ] Relevant CI checks pass cleanly on GitHub Actions.
   - [ ] C code passes `-fsanitize=address,undefined`.
   - [ ] No temporary binaries or debug artifacts committed.
   - [ ] Updated documentation or comments where appropriate.
