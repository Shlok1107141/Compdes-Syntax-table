"""Run every preset and many generated programs on the Arduino Uno; log each insert and lookup.

    python firmware/tools/board_runs.py --port COM3 [--seeds 4] [--variants baseline,AB,ABC]

For each structure this flashes firmware/uno_bench, then streams symbol lists
to the board with the live protocol (backend/hardware_uno.py), exactly as the
app does:
  presets      the six programs of frontend/src/data/samples.json, parsed by
               the engine (the declarations the website shows)
  simulations  generated symbol sets (engine/symtab_workloads.h): patterns
               realistic, random, scoped x n = 10..50 x seeds 1..--seeds
After each list, every stored name is looked up (a hit) and up to ten names
that are not stored (a miss); the board times each lookup itself.

Writes to firmware/results/:
  uno_runs.csv         one row per (structure, list): bytes, refusals, means
  uno_run_symbols.csv  one row per insert
  uno_run_lookups.csv  one row per lookup
  uno_run_lists.json   the names sent in each list, in order
firmware/tools/fit_uno_model.py turns these into the app's data.
"""
from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "backend"))
import gen_workloads as gw  # noqa: E402
from collect import FQBN, NAMES, build, cli, find_cli  # noqa: E402
from hardware_uno import (UnoSession, decode_symbols, live_end, live_insert,  # noqa: E402
                          live_ready, lookup)

OUT = ROOT / "firmware" / "results"
PATTERNS = ["realistic", "random", "scoped"]
SIZES = [10, 20, 30, 40, 50]


def preset_lists(exes) -> list[dict]:
    samples = json.loads((ROOT / "frontend" / "src" / "data" / "samples.json").read_text(encoding="utf-8"))
    out = []
    for s in samples:
        table = json.loads(gw.run([str(exes["analyze"])], s["code"]))["symbol_table"]
        sent, skipped = decode_symbols(table)
        out.append({"kind": "preset", "id": s["id"], "pattern": "", "symbols": sent, "skipped": len(skipped)})
    return out


def sim_lists(exes, seeds: int) -> list[dict]:
    out = []
    for p, pattern in enumerate(PATTERNS):
        for n in SIZES:
            for seed in range(1, seeds + 1):
                rows = gw.run([str(exes["dump"]), "dump", str(p), str(n), str(seed)]).splitlines()
                syms = []
                for ln in rows:
                    t, sc, st, off, name = ln.split()
                    syms.append({"name": name, "fields": (int(t), int(sc), int(st), int(off))})
                out.append({"kind": "sim", "id": f"{pattern}-{n}-s{seed}", "pattern": pattern,
                            "symbols": syms, "skipped": 0})
    return out


def write_lists(lists: list[dict]) -> None:
    names = {l["id"]: [s["name"] for s in l["symbols"]] for l in lists}
    (OUT / "uno_run_lists.json").write_text(json.dumps(names, indent=0) + "\n", newline="\n")


def run_list(session: UnoSession, port: str, variant: str, lst: dict, sym_rows: list, look_rows: list) -> dict:
    ready = live_ready(session, port)
    if ready["variant"] != variant:
        raise SystemExit(f"board runs {ready['variant']}, expected {variant}")
    stored_names, inserts, verified = [], [], True
    for i, s in enumerate(lst["symbols"]):
        r = live_insert(session, port, s)
        sym_rows.append({"variant": variant, "kind": lst["kind"], "list": lst["id"], "pattern": lst["pattern"],
                         "n": len(lst["symbols"]), "index": i, "name_len": len(s["name"]),
                         "stored_before": r["stored"] - (1 if r["result"] == "ok" else 0), "result": r["result"],
                         "insert_us": r["insert_us"] if r["result"] == "ok" else "",
                         "table_bytes": r["table_bytes"], "heap_bytes": r["heap_bytes"], "free_ram": r["free_ram"]})
        if r["result"] == "ok":
            stored_names.append(s["name"])
            inserts.append(r["insert_us"])
            verified &= r["verified"]
    done = live_end(session, port)
    names = list(dict.fromkeys(stored_names))           # each distinct stored name once
    hits, misses = [], []
    for name in names:
        r = lookup(session, port, name)
        verified &= r["found"]
        hits.append(r["lookup_us"])
        look_rows.append({"variant": variant, "kind": lst["kind"], "list": lst["id"], "table_n": done["stored"],
                          "name_len": len(name), "lookup": "hit", "lookup_us": r["lookup_us"]})
    probes = [f"{n}_zq" for n in names[:10] if f"{n}_zq" not in names]
    for name in probes:
        r = lookup(session, port, name)
        verified &= not r["found"]
        misses.append(r["lookup_us"])
        look_rows.append({"variant": variant, "kind": lst["kind"], "list": lst["id"], "table_n": done["stored"],
                          "name_len": len(name), "lookup": "miss", "lookup_us": r["lookup_us"]})
    mean = lambda xs: round(statistics.fmean(xs), 2) if xs else ""
    return {"variant": variant, "kind": lst["kind"], "list": lst["id"], "pattern": lst["pattern"],
            "n": len(lst["symbols"]), "skipped": lst["skipped"], "stored": done["stored"],
            "refused": len(lst["symbols"]) - done["stored"], "stopped": done["stopped"],
            "table_bytes": done["table_bytes"], "heap_bytes": done["heap_bytes"],
            "min_free_ram": min((r["free_ram"] for r in sym_rows[-len(lst["symbols"]):]), default=""),
            "insert_us_mean": mean(inserts), "lookup_hit_us_mean": mean(hits), "lookup_miss_us_mean": mean(misses),
            "verified": int(verified)}


def write(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="\n") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", help="the Uno's serial port (not needed with --lists-only)")
    ap.add_argument("--cli")
    ap.add_argument("--seeds", type=int, default=4)
    ap.add_argument("--variants", default="baseline,AB,ABC")
    ap.add_argument("--lists-only", action="store_true", help="only write uno_run_lists.json (no board)")
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        exes = gw.build(Path(tmp))
        lists = preset_lists(exes) + sim_lists(exes, args.seeds)
        if args.lists_only:
            write_lists(lists)
            print(f"wrote {OUT / 'uno_run_lists.json'}")
            return 0
        if not args.port:
            ap.error("--port is required to run on the board")
        exe = find_cli(args.cli)
        print(f"{len(lists)} symbol lists: {sum(l['kind'] == 'preset' for l in lists)} presets, "
              f"{sum(l['kind'] == 'sim' for l in lists)} simulations", flush=True)

        runs, sym_rows, look_rows = [], [], []
        for variant in args.variants.split(","):
            v = NAMES.index(variant)
            print(f"[{variant}] compiling and uploading", flush=True)
            build(exe, v, Path(tmp) / f"b{v}")
            cli(exe, "upload", "-p", args.port, "--fqbn", FQBN, "--input-dir", str(Path(tmp) / f"b{v}"))
            time.sleep(1)
            session = UnoSession()
            t0 = time.time()
            for i, lst in enumerate(lists):
                runs.append(run_list(session, args.port, variant, lst, sym_rows, look_rows))
                if lst["kind"] == "preset" or i % 15 == 0:
                    r = runs[-1]
                    print(f"[{variant}] {r['list']:28} stored {r['stored']}/{r['n']}  {r['table_bytes']} B  "
                          f"insert {r['insert_us_mean']} us  hit {r['lookup_hit_us_mean']} us  "
                          f"verified {r['verified']}", flush=True)
            session.close()
            print(f"[{variant}] {len(lists)} lists in {time.time() - t0:.0f} s", flush=True)

        write_lists(lists)
    write(OUT / "uno_runs.csv", runs)
    write(OUT / "uno_run_symbols.csv", sym_rows)
    write(OUT / "uno_run_lookups.csv", look_rows)
    print(f"wrote {len(runs)} runs, {len(sym_rows)} inserts, {len(look_rows)} lookups to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
