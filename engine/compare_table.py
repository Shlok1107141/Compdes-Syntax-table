#!/usr/bin/env python3
"""
compare_table.py -- consolidated comparison table for the symtab stress sweep.

Reads raw rows of the form
    data, pattern, n, baseline_bytes, variant_bytes
(from a file argument or stdin) and computes, per row,
    savings = ((baseline_bytes - variant_bytes) / baseline_bytes) * 100
Positive = variant uses less memory; negative = variant uses MORE than baseline.

If several rows share the same (data, pattern, n) -- e.g. a sweep run with
several seeds -- their per-row savings are averaged.

usage:  python3 compare_table.py results.csv
        ./stress_ab | python3 compare_table.py
"""
import sys
from collections import defaultdict

CONFIG_ORDER = ["A", "B", "C", "AB", "AC", "BC", "ABC"]
CONFIG_NAMES = {
    "A": "bit-packing only",
    "B": "arena + 16-bit idx only",
    "C": "radix trie only",
    "AB": "arena + bit-packing",
    "AC": "trie + bit-packing",
    "BC": "trie + arena",
    "ABC": "all three",
}
PATTERN_ORDER = ["realistic", "random"]
PATTERN_TITLES = {
    "realistic": "Realistic subsystem naming",
    "random": "Random worst-case naming",
}


def savings(baseline, variant):
    return ((baseline - variant) / baseline) * 100.0


def parse(lines):
    rows = []
    for lineno, raw in enumerate(lines, 1):
        line = raw.strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) != 5:
            sys.exit(f"line {lineno}: expected 5 fields "
                     f"'data, pattern, n, baseline_bytes, variant_bytes', got {len(parts)}: {line!r}")
        data, pattern, n, base, var = parts
        try:
            n, base, var = int(n), int(base), int(var)
        except ValueError:
            sys.exit(f"line {lineno}: n / baseline_bytes / variant_bytes must be integers: {line!r}")
        if base <= 0:
            sys.exit(f"line {lineno}: baseline_bytes must be > 0: {line!r}")
        rows.append((data, pattern, n, base, var))
    if not rows:
        sys.exit("no data rows found")
    return rows


def fmt(x):
    return f"{x:+.1f}%" if x is not None else "n/a"


def table(header, body):
    """Markdown table; first column left-aligned, the rest right-aligned."""
    widths = [max(len(r[i]) for r in [header] + body) for i in range(len(header))]
    def line(cells):
        out = [cells[0].ljust(widths[0])] + [c.rjust(w) for c, w in zip(cells[1:], widths[1:])]
        return "| " + " | ".join(out) + " |"
    sep = "| " + " | ".join(["-" * widths[0]] + ["-" * (w - 1) + ":" for w in widths[1:]]) + " |"
    return "\n".join([line(header), sep] + [line(r) for r in body])


def main():
    src = open(sys.argv[1]) if len(sys.argv) > 1 else sys.stdin
    rows = parse(src.read().splitlines())

    sav = defaultdict(list)       # (data, pattern, n) -> [savings, ...]
    basebytes = defaultdict(list) # (pattern, n) -> [baseline bytes, ...]
    for data, pattern, n, base, var in rows:
        sav[(data, pattern, n)].append(savings(base, var))
        basebytes[(data, pattern, n)].append(base)

    configs = [c for c in CONFIG_ORDER if any(k[0] == c for k in sav)]
    configs += sorted({k[0] for k in sav} - set(configs))
    patterns = [p for p in PATTERN_ORDER if any(k[1] == p for k in sav)]
    patterns += sorted({k[1] for k in sav} - set(patterns))

    for pattern in patterns:
        ns = sorted({k[2] for k in sav if k[1] == pattern})
        header = ["Config", "Technique"] + [f"n={n}" for n in ns] + ["Mean"]
        body = []
        for c in configs:
            vals = []
            for n in ns:
                v = sav.get((c, pattern, n))
                vals.append(sum(v) / len(v) if v else None)
            present = [v for v in vals if v is not None]
            mean = sum(present) / len(present) if present else None
            body.append([c, CONFIG_NAMES.get(c, "")] + [fmt(v) for v in vals] + [fmt(mean)])

        # baseline bytes are identical across configs (same symbol sets); show once for orientation
        ref = configs[0]
        bb = []
        for n in ns:
            v = basebytes.get((ref, pattern, n))
            bb.append(f"{sum(v) / len(v):.0f}" if v else "n/a")
        body.append(["baseline", "bytes (reference)"] + bb + [""])

        print(f"### {PATTERN_TITLES.get(pattern, pattern)} -- memory savings vs baseline\n")
        print(table(header, body))
        print()

    # consistency check: baseline bytes must agree across configs for every (pattern, n)
    for pattern in patterns:
        for n in sorted({k[2] for k in sav if k[1] == pattern}):
            seen = {c: round(sum(basebytes[(c, pattern, n)]) / len(basebytes[(c, pattern, n)]))
                    for c in configs if (c, pattern, n) in basebytes}
            if len(set(seen.values())) > 1:
                print(f"warning: baseline_bytes differ across configs for {pattern}, n={n}: {seen}",
                      file=sys.stderr)


if __name__ == "__main__":
    main()
