# Backend — `/analyze`

FastAPI wrapper around `engine/symtab_analyze.c`. The engine parses submitted C
source, builds both symbol tables from the declarations it finds, verifies every
symbol round-trips through both, and reports memory use. **The submitted code is
parsed, never compiled or executed.**

## The contract (locked — build against this)

```
POST /analyze
Request:  { "code": "<source text>" }
Response: {
  "baseline_bytes": int,
  "compressed_bytes": int,
  "savings_pct": float,
  "symbol_table": [ { "name": str, "type": str, "scope": int,
                      "storage_class": str, "offset": int }, ... ],
  "ablation": { "trie_only": int, "arena_only": int, "bitpack_only": int,
                "trie_arena": int, "trie_bitpack": int, "arena_bitpack": int }
}
```

A real response is checked in at [`examples/analyze_response.json`](examples/analyze_response.json)
— use it as the frontend stub; it is generated from the engine, not hand-written.

`type` is one of: `int char short long float double void pointer array struct
union enum function bool typedef_name unknown`.
`storage_class` is one of: `local global static param extern register typedef member`.
`scope` is nesting depth: 0 = file scope, 1 = function body / parameters /
struct members, 2+ = nested blocks.

Errors are `{"detail": "..."}` with these statuses:

| Status | Meaning                                              |
|--------|------------------------------------------------------|
| 400    | Engine rejected the input (identifier > 255 chars, more than 8192 symbols, source > 1 MiB) |
| 413    | Source larger than `SYMTAB_MAX_CODE_BYTES` (64 KiB default) |
| 422    | Body is not `{"code": "<string>"}`                    |
| 429    | Rate limit (30 requests/minute/client by default)     |
| 503    | Engine binary not built                               |
| 504    | Analysis timed out (5 s default)                      |

`GET /health` reports whether the engine binary is present.

## Running it

```bash
gcc engine/symtab_analyze.c -o engine/symtab_analyze -std=c11 -Wall -Wextra -O2
pip install -r backend/requirements.txt
cd backend && uvicorn main:app --reload --port 8000
```

Then `curl -X POST localhost:8000/analyze -H 'Content-Type: application/json' -d '{"code":"int counter; int counter_max;"}'`.

On Windows the engine binary is `engine\symtab_analyze.exe`; set `SYMTAB_ENGINE`
to point somewhere else.

### Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `SYMTAB_ENGINE` | `engine/symtab_analyze` | Path to the analyzer binary |
| `SYMTAB_MAX_CODE_BYTES` | `65536` | Largest accepted source |
| `SYMTAB_RATE_LIMIT` | `30` | Requests per minute per client (0 disables) |
| `SYMTAB_MAX_CONCURRENCY` | `4` | Analyzer processes allowed at once |
| `SYMTAB_ENGINE_TIMEOUT` | `5` | Seconds before the child is killed |
| `SYMTAB_ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:3000` | CORS allow-list |

## Tests

```bash
cd backend && pytest
```

`conftest.py` compiles the engine with `-fsanitize=address,undefined -Werror`
for the test session, so every engine test is also a memory-safety check. On
Windows (MinGW, no sanitizer runtime) it falls back to a plain build; CI runs on
Linux and always takes the sanitized path.

## Security measures implemented here

Narrow by design — no accounts, no user data, no payments. The one real risk is
untrusted source text reaching a native parser:

- Input is **parsed, never executed** — nothing is compiled or run.
- Size caps at both layers: 64 KiB at the API, 1 MiB hard cap in the engine.
- Child process: no shell, argument vector only, scrubbed environment, cwd set
  to an empty temp directory, 5 s timeout with kill, output size capped.
- The engine caps its own address space (256 MiB) and CPU time (5 s) with
  `setrlimit` before it reads a single byte of input.
- Concurrency bounded (4 analyzer processes), so a burst cannot fork-bomb the host.
- Rate limited per client; CORS locked to an explicit origin allow-list.
- Every arena bound in the engine is checked; overflow is a JSON error, not a crash.
  105 hostile inputs (random bytes, unbalanced braces, unterminated literals,
  pathological nesting) produce JSON and exit cleanly.

Deployment still needs to run the process as an unprivileged user in a
container — that part belongs in the writeup, not in this code.

## How the ablation numbers are produced

Three independent techniques — trie storage, arena allocation with 16-bit
indices, bit-packed metadata — give eight combinations. The engine builds the
baseline and the all-three structure **for real** and measures them. The six
partial combinations are computed from the same measured shape (symbol count,
name bytes, trie node and edge counts), with each variant's per-record layout
declared as a real C struct so `sizeof` — not arithmetic in a comment — decides
its size. The engine asserts its own accounting reproduces both structures it
actually built, and refuses to print numbers otherwise.

**This is accounting, not a second implementation.** Hardik's ablation harness
builds the variants for real across the stress sweep; these per-request numbers
exist so the UI can show a breakdown. If the two disagree, his numbers are the
ones that belong in the paper.

## What the parser covers

Handles: variable, array, pointer, function, parameter, struct/union member,
typedef and function-pointer declarations; storage classes; nested block scopes;
`for`-statement scopes; shadowing; bit-fields; comments, string/char literals and
preprocessor lines (ignored).

Known limits: array sizes given by macros are unknown (the analyzer does not
preprocess), so such arrays are sized as one element; K&R parameter lists are not
modelled; `for`-init declarations share the depth of the loop body; offsets
saturate at 65535 and scope depth at 255, the widths the bit-packing allows.
