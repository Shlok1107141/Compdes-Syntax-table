"""Tables for firmware/results/HARDWARE_RESULTS.md from the Uno's measurements.

    python firmware/tools/summarize_uno.py [--results firmware/results]

Reads the uno_*.csv files written by collect.py. The PC column (64-bit) comes
from the engine itself: the same symbol sets are inserted into the engine/
code on this computer (needs gcc). Prints Markdown.
"""
from __future__ import annotations

import argparse
import csv
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import gen_workloads as gw  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ORDER = ["baseline", "A", "B", "C", "AB", "AC", "BC", "ABC"]
HEAP_STATIC = {"baseline": 128, "A": 128, "C": 0, "AC": 0}   # bucket array outside the heap (2-byte pointers)


def load(path: Path) -> list[dict[str, str]]:
    return list(csv.DictReader(path.open())) if path.exists() else []


def pct(new: float, base: float) -> str:
    return f"{100 * (1 - new / base):.1f}%"


def table(header: list[str], rows: list[list[str]]) -> str:
    out = ["| " + " | ".join(header) + " |", "|" + "|".join("---:" if i else "---" for i in range(len(header))) + "|"]
    out += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(out)


def pc_bytes() -> dict[tuple[str, str], tuple[int, int]]:
    """(variant, workload) -> (baseline, variant) bytes on this 64-bit PC."""
    res = {}
    with tempfile.TemporaryDirectory() as tmp:
        exes = gw.build(Path(tmp))
        for label, pattern, n in gw.WORKLOADS[:gw.CAPACITY]:
            text = gw.as_text(gw.symbols(exes, pattern, n))
            for v in gw.VARIANT_SRC:
                b, x, ok = map(int, gw.run([str(exes[v]), "bytes"], text).split())
                if not ok:
                    sys.exit(f"PC verification failed: {v} on {label}")
                res[(v, label)] = (b, x)
    return res


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default=str(ROOT / "firmware" / "results"))
    d = Path(ap.parse_args().results)
    mem, tim, cap = load(d / "uno_mem.csv"), load(d / "uno_time.csv"), load(d / "uno_cap.csv")
    save, restore, builds = load(d / "uno_save.csv"), load(d / "uno_load.csv"), load(d / "uno_build.csv")
    pc = pc_bytes()
    sets = [w for w, _, _ in gw.WORKLOADS[:gw.CAPACITY]]
    m = {(r["variant"], r["workload"]): r for r in mem}

    def full(v, w):
        r = m.get((v, w))
        return r is not None and r["inserted"] == r["n"] and r["verify_ok"] == "1"

    def partial(r):
        why = "out of RAM" if r["stop"] == "out_of_ram" else "pools full"
        return f"{why} at {r['inserted']}/{r['n']}"

    def cell(v, w):
        """Bytes, with the saving when both this table and the baseline's are complete."""
        r = m.get((v, w))
        if r is None:
            return "-"
        if not full(v, w):
            return partial(r)
        if v == "baseline" or not full("baseline", w):
            return r["modelled_bytes"]
        return f"{r['modelled_bytes']} ({pct(int(r['modelled_bytes']), int(m[('baseline', w)]['modelled_bytes']))})"

    print("### Memory: Uno vs PC, same symbols\n")
    rows = []
    for w in sets:
        row = [w, m[("baseline", w)]["n"], cell("baseline", w), cell("AB", w), cell("ABC", w)]
        pb, pa = pc[("ABC", w)]
        row += [str(pb), f"{pa} ({pct(pa, pb)})"]
        rows.append(row)
    print(table(["Symbol set", "n", "Uno baseline B", "Uno AB B (saving)", "Uno ABC B (saving)",
                 "PC baseline B", "PC ABC B (saving)"], rows))

    print("\n### All eight structures on the Uno (bytes; saving vs Uno baseline)\n")
    print(table(["Symbol set"] + ORDER, [[w] + [cell(v, w) for v in ORDER] for w in sets]))

    print("\n### Allocation model vs the real heap (heap variants)\n")
    rows = []
    for v in ("baseline", "A", "C", "AC"):
        for w in sets:
            r = m.get((v, w))
            if not r:
                continue
            real = int(r["heap_bytes"]) + HEAP_STATIC[v]
            rows.append([v, w, f"{r['inserted']}/{r['n']}", r["modelled_bytes"], str(real),
                         f"{real - int(r['modelled_bytes']):+d}", r["heap_after_destroy"]])
    print(table(["Structure", "Symbol set", "Symbols held", "Modelled B", "Measured B (heap + buckets)",
                 "Difference", "Heap left after destroy"], rows))

    print("\n### Static RAM of each firmware build (compiler report, of 2048 B)\n")
    print(table(["Structure", "Flash B", "Static RAM B"],
                [[b["variant"], b["flash_bytes"], b["static_ram_bytes"]] for b in builds]))

    print("\n### Speed on the Uno (16 MHz), microseconds per symbol, best of 5\n")
    rows = []
    for r in tim:
        n = int(r["n"])
        ins = (int(r["insert_us"]) - int(r["read_us"])) / n
        hit = (int(r["hit_us"]) - int(r["read_us"])) / n
        miss = (int(r["miss_us"]) - int(r["read_probe_us"])) / n
        rows.append([r["variant"], r["workload"], f"{ins:.1f}", f"{hit:.1f}", f"{miss:.1f}", r["verify_ok"]])
    print(table(["Structure", "Symbol set", "Insert", "Lookup (found)", "Lookup (absent)", "Verified"], rows))

    print(f"\n### Capacity: 400-name set inserted until the structure is full\n")
    print(table(["Structure", "Fit in 1200 B", "Held when it stopped", "Stopped because", "Bytes then",
                 "Free RAM then", "Verified"],
                [[r["variant"], r["fit_budget"], r["max_held"], r["stop"], r["bytes_at_max"],
                  r["free_ram_at_max"], r["verify_ok"]] for r in cap]))

    print("\n### Stored in EEPROM, reloaded after a reset\n")
    rows = []
    for s in save:
        ld = next((x for x in restore if x["variant"] == s["variant"] and x["workload"] == s["workload"]), None)
        rows.append([s["variant"], s["workload"], s["table_bytes"], s["snapshot_bytes"],
                     f"{int(s['save_us']) / 1000:.0f}", f"{int(ld['restore_us']) / 1000:.1f}" if ld else "-",
                     ld["crc_ok"] if ld else "-", ld["verify_ok"] if ld else "-"])
    print(table(["Structure", "Symbol set", "Table in RAM B", "Snapshot B", "Save ms", "Reload ms", "CRC ok",
                 "Verified"], rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
