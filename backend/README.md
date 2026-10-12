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
                "trie_arena": int, "trie_bitpack": int, "arena_bitpack": int },
  "peak": { "baseline_bytes": int, "compressed_bytes": int,
            "savings_pct": float, "live_symbols": int }
}
```

Two additions, both **additive** — every locked field is unchanged:

- `peak`: the whole-program figures keep every declaration; `peak` is the
  largest table needed at any single point if each scope released its symbols
  when it closed (what a compiler that frees block scopes would need).
- `references` on each `symbol_table` entry: how many identifier uses resolve
  to that declaration. Each use is resolved through the compressed table's
  scoped lookup — the innermost declaration of the name still in scope, so
  shadowing resolves the way a compiler does — and cross-checked against an
  independent resolver on every request.

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
make -C engine symtab_analyze        # links the analyzer with every variant_*.c
pip install -r backend/requirements.txt
cd backend && uvicorn main:app --reload --port 8000
```

Then `curl -X POST localhost:8000/analyze -H 'Content-Type: application/json' -d '{"code":"int counter; int counter_max;"}'`.

Without `make` (e.g. plain MinGW on Windows):
`gcc -std=c11 -O2 -DSYMTAB_NO_MAIN engine/symtab_analyze.c engine/variant_*.c -o engine/symtab_analyze.exe`.
Set `SYMTAB_ENGINE` to use a binary somewhere else.

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

`conftest.py` compiles the engine with `-fsanitize=address,undefined -Werror -pedantic`
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
  108 hostile inputs ([`tests/hostile_inputs.py`](tests/hostile_inputs.py): random
  bytes, unbalanced braces, unterminated literals, pathological nesting) produce
  JSON and exit cleanly under ASan, UBSan and LeakSanitizer.

Deployment still needs to run the process as an unprivileged user in a
container — that part belongs in the writeup, not in this code.

## How the ablation numbers are produced

Three independent techniques — bit-packed metadata (A), arena allocation with
16-bit indices (B), radix trie (C) — give eight structures. For every request
the engine **builds all eight for real** from the parsed declarations, checks
that each one finds every declaration (and does not find an absent name), then
measures it. They are the implementations in `engine/variant_*.c` — the same code
`engine/run_sweep.sh` measures for `results.csv` — so the UI and the paper share
one source of truth.

| JSON key | Variant | Techniques |
|---|---|---|
| `baseline_bytes` | baseline | none |
| `bitpack_only` | A | bit-packing |
| `arena_only` | B | arena |
| `trie_only` | C | trie |
| `arena_bitpack` | AB | arena + bit-packing |
| `trie_bitpack` | AC | trie + bit-packing |
| `trie_arena` | BC | trie + arena |
| `compressed_bytes` | ABC | all three |

`test_numbers_match_the_standalone_variant_demos` pins this: for the
prototype's 30 identifiers the analyzer must print exactly the totals the
variant demos print.

A name declared more than once (shadowing) is stored once in a trie; each
extra declaration adds its metadata plus a shadow record (4 B in the arena
tries). Unique-name workloads — everything in `results.csv` — never pay for it.

## What the parser covers

Handles: variable, array, pointer, function, parameter, struct/union member,
typedef and function-pointer declarations; storage classes; nested block scopes;
`for`-statement scopes; shadowing; bit-fields; comments, string/char literals and
preprocessor lines (ignored).

Array sizes may be integer literals or object-like integer macros
(`#define N 16` … `char buf[N];`).

Known limits: the analyzer does not preprocess, so any other macro — and any
array size that is an expression (`[N + 1]`) — is unknown and the array is sized
as one element; K&R parameter lists are not modelled; `for`-init declarations
share the depth of the loop body; struct members are not resolved through
`.`/`->` (that needs type information); offsets saturate at 65535 and scope depth
at 255, the widths the bit-packing allows. Past the 16-bit arena limits (65,535
nodes or 64 KiB of name characters) the request fails with a clear 400 rather
than wrapping.
