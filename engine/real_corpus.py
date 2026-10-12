#!/usr/bin/env python3
"""
real_corpus.py -- measure the eight symbol tables on real C source files.

results.csv uses generated identifiers. This runs the analyzer (which builds
and verifies all eight structures) over real projects' .c files, two ways:

  raw           the file as written: the program's own declarations
  preprocessed  `gcc -E` output: everything a compiler's symbol table holds for
                the translation unit, including every system-header declaration

Only measurements are written (real_corpus.csv); the third-party sources are
not copied into the repository, since their licences vary.

usage:
  python3 real_corpus.py [--engine PATH] [-I DIR ...] PROJECT=DIR_OR_GLOB ...
  python3 real_corpus.py --summary real_corpus.csv
"""

from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import statistics
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_ENGINE = HERE / ("symtab_analyze.exe" if os.name == "nt" else "symtab_analyze")
OUT = HERE / "real_corpus.csv"

STRUCTURES = ["baseline", "bitpack_only", "arena_only", "trie_only",
              "arena_bitpack", "trie_bitpack", "trie_arena", "compressed"]
LABELS = {"bitpack_only": "A", "arena_only": "B", "trie_only": "C", "arena_bitpack": "AB",
          "trie_bitpack": "AC", "trie_arena": "BC", "compressed": "ABC", "baseline": "baseline"}
FIELDS = ["project", "file", "mode", "source_bytes", "symbols", *STRUCTURES,
          "peak_baseline", "peak_compressed", "peak_live", "status"]


def expand(spec: str) -> tuple[str, list[Path]]:
    project, _, where = spec.partition("=")
    if not where:
        sys.exit(f"expected PROJECT=DIR_OR_GLOB, got {spec!r}")
    path = Path(where)
    files = sorted(path.glob("*.c")) if path.is_dir() else sorted(Path(p) for p in glob.glob(where))
    return project, [f for f in files if f.is_file()]


def analyze(engine: Path, source: bytes) -> dict:
    proc = subprocess.run([str(engine)], input=source, capture_output=True, timeout=60)
    try:
        return json.loads(proc.stdout)
    except ValueError:
        return {"error": f"engine exit {proc.returncode}, unreadable output"}


def row_for(project: str, path: Path, mode: str, source: bytes, result: dict) -> dict:
    row = {"project": project, "file": path.name, "mode": mode, "source_bytes": len(source)}
    if "error" in result:
        row["status"] = result["error"]
        return row
    row.update(symbols=len(result["symbol_table"]), baseline=result["baseline_bytes"],
               compressed=result["compressed_bytes"], **result["ablation"],
               peak_baseline=result["peak"]["baseline_bytes"],
               peak_compressed=result["peak"]["compressed_bytes"],
               peak_live=result["peak"]["live_symbols"], status="ok")
    return row


def measure(args: argparse.Namespace) -> None:
    rows = []
    for spec in args.projects:
        project, files = expand(spec)
        print(f"{project}: {len(files)} files", file=sys.stderr)
        for path in files:
            raw = path.read_bytes()
            rows.append(row_for(project, path, "raw", raw, analyze(args.engine, raw)))

            pp = subprocess.run(["gcc", "-E", "-P", "-w", *(f"-I{d}" for d in args.include),
                                 f"-I{path.parent}", str(path)], capture_output=True)
            if pp.returncode != 0:
                rows.append({"project": project, "file": path.name, "mode": "preprocessed",
                             "status": "preprocessing failed (missing headers)"})
                continue
            rows.append(row_for(project, path, "preprocessed", pp.stdout, analyze(args.engine, pp.stdout)))

    with open(args.out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {len(rows)} rows to {args.out}", file=sys.stderr)
    summarize(args.out)


def pct(base: int, size: int) -> float:
    return 100.0 * (base - size) / base if base else 0.0


def summarize(path: Path) -> None:
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    for mode in ("raw", "preprocessed"):
        ok = [r for r in rows if r["mode"] == mode and r["status"] == "ok" and int(r["symbols"]) > 0]
        failed = Counter(r["status"] for r in rows if r["mode"] == mode and r["status"] != "ok")
        if not ok:
            continue
        print(f"\n### {mode}: {len(ok)} files, {sum(int(r['symbols']) for r in ok):,} declarations "
              f"({len({r['project'] for r in ok})} projects)")
        if failed:
            print("not measured: " + "; ".join(f"{n} x {s}" for s, n in failed.most_common()))

        totals = {s: sum(int(r[s]) for r in ok) for s in STRUCTURES}
        print("\n| Structure | Total bytes | Saving vs baseline (pooled) | Median per-file saving |")
        print("|---|---:|---:|---:|")
        for s in STRUCTURES:
            med = statistics.median(pct(int(r["baseline"]), int(r[s])) for r in ok)
            print(f"| {LABELS[s]} | {totals[s]:,} | {pct(totals['baseline'], totals[s]):+.1f}% | {med:+.1f}% |")

        wins = Counter(min(STRUCTURES[1:], key=lambda s: int(r[s])) for r in ok)
        print("\nSmallest structure per file: " +
              ", ".join(f"{LABELS[s]} {n}" for s, n in wins.most_common()))
        abc_vs_ab = [pct(int(r["arena_bitpack"]), int(r["compressed"])) for r in ok]
        print(f"ABC vs AB per file: median {statistics.median(abc_vs_ab):+.1f}%, "
              f"range {min(abc_vs_ab):+.1f}% .. {max(abc_vs_ab):+.1f}% (positive = ABC smaller)")
        per_sym = statistics.median(int(r["compressed"]) / int(r["symbols"]) for r in ok)
        per_sym_b = statistics.median(int(r["baseline"]) / int(r["symbols"]) for r in ok)
        print(f"Median bytes per declaration: baseline {per_sym_b:.1f}, ABC {per_sym:.1f}")
        peak = [pct(int(r["peak_baseline"]), int(r["peak_compressed"])) for r in ok]
        print(f"Peak (scopes released) saving: median {statistics.median(peak):+.1f}%")

        by_project = defaultdict(list)
        for r in ok:
            by_project[r["project"]].append(r)
        print("\n| Project | Files | Decls | Baseline | AB | ABC | ABC saving | ABC vs AB |")
        print("|---|---:|---:|---:|---:|---:|---:|---:|")
        for project, prs in sorted(by_project.items()):
            b = sum(int(r["baseline"]) for r in prs)
            ab = sum(int(r["arena_bitpack"]) for r in prs)
            abc = sum(int(r["compressed"]) for r in prs)
            print(f"| {project} | {len(prs)} | {sum(int(r['symbols']) for r in prs):,} | {b:,} | {ab:,} | "
                  f"{abc:,} | {pct(b, abc):+.1f}% | {pct(ab, abc):+.1f}% |")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("projects", nargs="*", help="PROJECT=DIR_OR_GLOB")
    parser.add_argument("--engine", type=Path, default=DEFAULT_ENGINE)
    parser.add_argument("-I", "--include", action="append", default=[], help="extra include dir for gcc -E")
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument("--summary", type=Path, help="only print the summary of an existing CSV")
    args = parser.parse_args()
    if args.summary:
        summarize(args.summary)
    elif args.projects:
        measure(args)
    else:
        parser.error("give PROJECT=DIR_OR_GLOB arguments or --summary FILE")


if __name__ == "__main__":
    main()
