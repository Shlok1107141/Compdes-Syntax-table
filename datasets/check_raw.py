#!/usr/bin/env python3
"""Compare the raw-mode rows of a fresh real_corpus.py run with the published engine/real_corpus.csv.

Raw mode depends only on the source file and the analyzer, so every byte count must match.
(Preprocessed mode also depends on the platform's system headers, so it is not compared.)

    python3 datasets/check_raw.py NEW.csv [engine/real_corpus.csv]
"""
import csv
import sys
from pathlib import Path

FIELDS = ["source_bytes", "symbols", "baseline", "bitpack_only", "arena_only", "trie_only", "arena_bitpack",
          "trie_bitpack", "trie_arena", "compressed", "peak_baseline", "peak_compressed", "peak_live", "status"]


def raw_rows(path):
    with open(path, newline="") as fh:
        return {(r["project"], r["file"]): r for r in csv.DictReader(fh) if r["mode"] == "raw"}


def main() -> int:
    new = raw_rows(sys.argv[1])
    ref = raw_rows(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).resolve().parents[1] / "engine" / "real_corpus.csv")
    bad = []
    for key, r in ref.items():
        n = new.get(key)
        if n is None:
            bad.append(f"{key}: missing from the new run")
            continue
        diff = [f"{f} {r[f]} -> {n[f]}" for f in FIELDS if r[f] != n[f]]
        if diff:
            bad.append(f"{key}: " + ", ".join(diff))
    for line in bad[:20]:
        print("  MISMATCH", line)
    print(f"raw mode: {len(ref) - len(bad)}/{len(ref)} files reproduce engine/real_corpus.csv exactly")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
