# Is the compressed symbol table worth using?

**Short answer: yes, for memory.** On real C code, the three techniques together
cut symbol-table memory by **74–79%** (≈ 80 → 20 bytes per declaration), with
lookups that stay in the tens of nanoseconds. But the gain comes almost
entirely from **arena allocation + bit-packing**; the radix trie adds only
**~0–2%** on top of them on real code, and on its own it makes the table
*bigger*. "All three together" is the smallest structure more often than any
other, but only narrowly.

Every number below is produced by code in this directory and can be re-run.

---

## 1. Data

| Dataset | What it is | Size | Produced by |
|---|---|---|---|
| Synthetic sweep | Generated identifier sets: `realistic` (subsystem_field names), `random` (no shared prefixes), `scoped` (functions that redeclare common locals) | 168 rows, n = 10 … 1000 | `run_sweep.sh` → `results.csv` |
| Real C corpus | 93 real `.c` files from 5 projects (SQLite extensions, GNU readline, xz, MPFR, this engine), measured **raw** (the file's own declarations) and **preprocessed** with `gcc -E` (everything a compiler's table holds, system headers included) | 133,811 declarations | `real_corpus.py` → `real_corpus.csv` |
| Speed | Insert / lookup-hit / lookup-miss time for all 8 structures on the synthetic workloads | 48 rows, Linux + Windows | `make bench` → `bench_results.csv` |

All eight structures are the real implementations in `variant_*.c`; every one is
verified (every declaration found, absent names not found) before it is measured.
The corpus sources are *not* in the repository (their licences vary) — only the
measurements are.

## 2. Memory on real code

### Preprocessed translation units — what a compiler actually stores
84 files, 126,374 declarations (9 more files could not be preprocessed: missing headers).

| Structure | Bytes | Saving vs baseline |
|---|---:|---:|
| Baseline (hash + malloc + 8-byte pointers + unpacked fields) | 9,631,762 | — |
| A: bit-packing | 8,620,770 | +10.5% |
| B: arena + 16-bit indices | 4,039,050 | +58.1% |
| C: radix trie | 15,214,461 | **−58.0%** (larger) |
| AB | 2,522,562 | +73.8% |
| AC | 10,107,461 | −4.9% |
| BC | 4,000,603 | +58.5% |
| **ABC (all three)** | **2,484,115** | **+74.2%** |

- Smallest structure per file: **ABC 44, AB 40**.
- ABC vs AB per file: median **+0.1%** (range −4.3% … +10.0%).
- Bytes per declaration (median): baseline 76.6 → ABC 20.5.
- Peak memory if block scopes are freed on exit: median saving 71.4%.

### Raw source files — the program's own declarations
93 files, 7,437 declarations.

| | Baseline | AB | ABC |
|---|---:|---:|---:|
| Bytes | 573,678 | 121,494 (+78.8%) | 121,836 (+78.8%) |

- Smallest per file: **ABC 49, AB 44**; ABC vs AB median **+2.0%** (range −17.3% … +70.1%).
- Bytes per declaration (median): baseline 82.1 → ABC 17.7.

Per project (preprocessed): ABC saves 73.2% (SQLite ext.) to 76.9% (this engine);
ABC beats AB by +7.5% on MPFR and +5.9% on xz, and trails it by 0.7% on readline.

## 3. Memory on synthetic workloads (`results.csv`, mean over n)

| Pattern | AB | ABC | Who wins |
|---|---:|---:|---|
| realistic | +75.1% | +74.2% | AB from n = 50 |
| random | +72.2% | +66.9% | AB from n = 25 |
| scoped | +78.2% | +78.6% | ABC at n ≤ 25 and n ≥ 500 |

The trie wins when names repeat across scopes (a trie stores a repeated name
once; the hash tables copy it per declaration) and loses on flat tables of
unrelated names, where each trie node (10 B) costs more than the shared prefix saves.

## 4. Speed (`bench_results.csv`, Linux/glibc, -O2, n = 1000, ns per operation)

| Workload | Structure | Insert | Lookup hit | Lookup miss |
|---|---|---:|---:|---:|
| realistic | baseline | 27.0 | 36.3 | 66.7 |
| | AB | **7.8** | 38.6 | 56.0 |
| | ABC | 39.6 | 46.6 | **49.4** |
| random | baseline | 29.4 | 38.0 | 69.4 |
| | AB | **9.0** | 38.2 | 55.6 |
| | ABC | 43.6 | 57.5 | 58.2 |
| scoped | baseline | 27.7 | 22.8 | 62.9 |
| | AB | **6.8** | 20.2 | 53.1 |
| | ABC | 27.4 | 32.4 | **34.9** |

- **Insert:** the arena removes `malloc` from the hot path — AB inserts 3–4× faster than the baseline. The trie gives back some of that (edge splits, sibling scans).
- **Lookup:** ABC is 1.3–1.5× slower on hits than the hash tables, and often faster on misses (a trie rejects a non-matching prefix early).
- **In absolute terms none of this matters:** a typical translation unit (≈ 1,500 declarations, a few thousand lookups) spends well under a millisecond in its symbol table either way.

Windows (MinGW, UCRT malloc) shows the same ordering with somewhat larger numbers.

## 5. Limits

The 16-bit indices cap a table at 65,535 trie nodes and 64 KiB of name
characters. The largest real translation unit measured (SQLite `spellfix.c`,
preprocessed: 2,755 declarations, 248 KB of source) used at most ~39.6 KB for
nodes + characters — inside the limits with ~1.6× headroom; the median TU has
1,505 declarations. A single huge translation unit (e.g. the 8 MB SQLite
amalgamation) would not fit and would need 32-bit indices, which give back part
of the arena's saving. The analyzer reports this as a clear error rather than
wrapping.

## 6. Verdict

**Beneficial for use:** yes, for any compiler where symbol-table memory matters
(cross-compilers on small hosts, compilers that keep many translation units'
tables resident, IDE/language-server indexes). On real C it uses about a
quarter of the memory of a textbook chained hash table, with no practical cost
in speed.

**What the data does *not* support:** that the trie is what makes the
difference. Arena + bit-packing alone achieves 73.8–78.8% on real code; adding
the trie moves that to 74.2–78.8%. The honest framing of the claim is:

> Arena allocation with 16-bit indices and bit-packed metadata reduce symbol-table
> memory by about three quarters on real C code. A radix trie on top gives a
> further small reduction where identifiers repeat across scopes or share long
> prefixes, and is the smallest structure in slightly more files than any
> alternative — but used without the arena it increases memory by 38–58%.

**Recommendation:** if simplicity or insert speed matters more than the last
1–2%, use AB; use ABC when programs reuse names heavily across scopes.

## 7. Caveats and what more data would strengthen this

- **64-bit host only.** Every figure assumes 8-byte pointers and 16-byte malloc headers. On a 32-bit target both halve, so the arena's advantage shrinks. The code is ready for it: `MALLOC_OVERHEAD` derives from `sizeof(void *)`; install `gcc-multilib` and run `CC="gcc -m32" OUT=results_32bit.csv ./run_sweep.sh`.
- **Corpus is desktop libraries, not firmware.** An embedded corpus (Zephyr, FreeRTOS, vendor HALs) would test the motivating use case directly; it needs those sources downloaded.
- **Baseline uses a fixed 64-bucket table** (as the prototype did). At n = 1000 its chains are long, so its lookups are slower than a resizing hash table's would be; a resizing table would also grow its bucket array, so its memory would rise.
- **Synthetic sweep uses one seed.** `SEEDS="1 2 3 4 5" ./run_sweep.sh` averages several; the corpus results do not depend on a seed.
- **Raw mode is not preprocessed**, so macros and `#include`d names are missing from those tables; the preprocessed mode covers that.

## 8. Reproduce

```bash
cd engine
make sweep        # results.csv (memory, synthetic)    -- also checked by backend tests
make bench        # bench_results.csv (speed)
python3 real_corpus.py -I /path/to/include  NAME=dir/with/c/files ...   # real_corpus.csv
python3 real_corpus.py --summary real_corpus.csv
```

On this machine the corpus run was:
`real_corpus.py -I C:\msys64\ucrt64\include sqlite-ext=C:\msys64\ucrt64\share\sqlite\extensions readline=C:\msys64\ucrt64\share\readline xz=C:\msys64\ucrt64\share\doc\xz\examples mpfr=C:\msys64\ucrt64\share\doc\mpfr\examples symtab-engine=.`
