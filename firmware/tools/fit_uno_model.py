"""Turn the Uno runs into the app's hardware data and a fitted timing model.

    python firmware/tools/fit_uno_model.py

Reads firmware/results/uno_runs.csv, uno_run_symbols.csv, uno_run_lookups.csv
(written by board_runs.py) and writes frontend/src/data/unoBoard.json:
  presets  every preset measured on the board, per structure
  sims     the generated programs, averaged per structure, pattern and size
  model    what the website uses to estimate custom code it cannot run:
           - bytes and refusals are computed exactly in the browser
             (frontend/src/lib/unoModel.ts); this file supplies the board
             constants they need (pool sizes, the baseline's free-RAM constant)
           - times are a linear fit on the simulations only:
               insert_us = a + b*name_len + c*symbols_already_stored
               lookup_us = a + b*name_len + c*symbols_in_table
             with the spread between programs (sd_program) as the uncertainty,
             validated on the presets, which the fit never saw.
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import re
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "firmware" / "results"
OUT = ROOT / "frontend" / "src" / "data" / "unoBoard.json"
VARIANTS = ["baseline", "AB", "ABC"]


def load(name: str) -> list[dict]:
    return list(csv.DictReader((RES / name).open()))


def solve(xtx: list[list[float]], xty: list[float]) -> list[float]:
    """Gaussian elimination for the 3x3 normal equations."""
    n = len(xty)
    m = [row[:] + [xty[i]] for i, row in enumerate(xtx)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[p] = m[p], m[c]
        for r in range(n):
            if r != c:
                f = m[r][c] / m[c][c]
                m[r] = [a - f * b for a, b in zip(m[r], m[c])]
    return [m[i][n] / m[i][i] for i in range(n)]


def least_squares(rows: list[dict], y: str, xs: list[str]) -> list[float]:
    X = [[1.0 if x == "1" else float(r[x]) for x in xs] for r in rows]
    Y = [float(r[y]) for r in rows]
    k = len(xs)
    xtx = [[sum(a[i] * a[j] for a in X) for j in range(k)] for i in range(k)]
    xty = [sum(a[i] * b for a, b in zip(X, Y)) for i in range(k)]
    return solve(xtx, xty)


def pattern_of(row: dict) -> str:
    return row["list"].split("-")[0]


def cross_validated_sd(rows: list[dict], y: str, xs: list[str]) -> float:
    """Leave one naming pattern out: fit on the other two, predict each program
    of the held-out one, and return the RMS error of the program means. This is
    the error to expect on a program unlike the ones the fit saw."""
    errs = []
    for held in {pattern_of(r) for r in rows}:
        coef = least_squares([r for r in rows if pattern_of(r) != held], y, xs)
        by_list: dict[str, list[dict]] = {}
        for r in rows:
            if pattern_of(r) == held:
                by_list.setdefault(r["list"], []).append(r)
        for rs in by_list.values():
            pred = statistics.fmean(sum(c * (1.0 if x == "1" else float(r[x])) for c, x in zip(coef, xs)) for r in rs)
            errs.append(pred - statistics.fmean(float(r[y]) for r in rs))
    return (statistics.fmean(e * e for e in errs)) ** 0.5


def fit(rows: list[dict], y: str, xs: list[str]) -> dict:
    """Least squares y = sum(coef_i * x_i) ('1' is the intercept), the spread of program
    means, and the cross-validated error the website uses as its range."""
    X = [[1.0 if x == "1" else float(r[x]) for x in xs] for r in rows]
    Y = [float(r[y]) for r in rows]
    coef = least_squares(rows, y, xs)
    pred = [sum(c * v for c, v in zip(coef, a)) for a in X]
    res = [b - p for b, p in zip(Y, pred)]
    mean_y = statistics.fmean(Y)
    r2 = 1 - sum(e * e for e in res) / sum((b - mean_y) ** 2 for b in Y)
    by_list: dict[str, list[float]] = {}
    for r, e in zip(rows, res):
        by_list.setdefault(r["list"], []).append(e)
    program_means = [statistics.fmean(v) for v in by_list.values()]
    sd_program = statistics.stdev(program_means)
    sd_cv = cross_validated_sd(rows, y, xs)
    return {"coef": [round(c, 5) for c in coef], "x": xs,
            "sd_symbol": round(statistics.stdev(res), 3), "sd_program": round(sd_program, 3),
            "sd_cross_validated": round(sd_cv, 3), "sd_band": round(max(sd_program, sd_cv), 3),
            "r2": round(r2, 4), "n_rows": len(rows), "n_programs": len(by_list)}


def predict(m: dict, rows: list[dict]) -> float:
    return statistics.fmean(sum(c * (1.0 if x == "1" else float(r[x])) for c, x in zip(m["coef"], m["x"]))
                            for r in rows)


# The hash tables' time depends on the name and the table size; the trie's on how
# much of it a name walks, counted by frontend/scripts/uno_features.ts. Counts that
# are fixed by the others are left out: an insert compares or copies every
# character (copied = name_len - compares), and a hit compares all of the name.
FEATURES = {
    "insert": {"hash": ["1", "name_len", "stored_before"],
               "trie": ["1", "name_len", "scans", "compares", "split"]},
    "lookup_hit": {"hash": ["1", "name_len", "table_n"],
                   "trie": ["1", "name_len", "scans", "depth"]},
    "lookup_miss": {"hash": ["1", "name_len", "table_n"],
                    "trie": ["1", "name_len", "scans", "compares", "depth"]},
}


def attach_trie_work(syms: list[dict], looks: list[dict]) -> None:
    """Join the counted work onto the board's ABC rows (same order as the board ran them)."""
    path = RES / "uno_abc_features.csv"
    if not path.exists():
        sys.exit("run: node frontend/scripts/uno_features.ts")
    work = {(r["kind"], r["list"], int(r["ordinal"])): r for r in csv.DictReader(path.open())}
    for r in syms:
        if r["variant"] == "ABC" and r["result"] == "ok":
            r.update({k: v for k, v in work[("insert", r["list"], int(r["index"]))].items()
                      if k in ("scans", "compares", "copied", "split")})
    seen: dict[tuple, int] = {}
    for r in looks:
        if r["variant"] == "ABC":
            key = (r["lookup"], r["list"])
            i = seen.get(key, 0)
            seen[key] = i + 1
            w = work[(r["lookup"], r["list"], i)]
            if int(w["len"]) != int(r["name_len"]):
                sys.exit(f"feature rows out of step with the board's lookups in {r['list']}")
            r.update({k: w[k] for k in ("scans", "compares", "depth")})


def mean_of(rows: list[dict], key: str):
    vals = [float(r[key]) for r in rows if r[key] != ""]
    return round(statistics.fmean(vals), 2) if vals else None


def pools() -> dict:
    text = (ROOT / "firmware" / "uno_bench" / "src" / "pools.h").read_text()
    vals = {k: int(v) for k, v in re.findall(r"#define (POOL_\w+|STRUCT_BUDGET)\s+(\d+)", text)}
    return {"AB": {"nodes": vals["POOL_AB_NODES"], "chars": vals["POOL_AB_CHARS"]},
            "ABC": {"nodes": vals["POOL_ABC_NODES"], "chars": vals["POOL_ABC_CHARS"],
                    "meta": vals["POOL_ABC_META"], "shadows": vals["POOL_ABC_SHADOWS"]},
            "budget": vals["STRUCT_BUDGET"]}


def main() -> int:
    runs, syms, looks = load("uno_runs.csv"), load("uno_run_symbols.csv"), load("uno_run_lookups.csv")
    meta = json.loads((RES / "uno_meta.json").read_text())
    samples = {s["id"]: s["name"] for s in json.loads((ROOT / "frontend/src/data/samples.json").read_text(encoding="utf-8"))}
    bad = [r for r in runs if r["verified"] != "1"]
    if bad:
        sys.exit(f"{len(bad)} runs failed verification on the board; not using them")

    # Baseline refusals: free RAM before an insert = C - heap so far (the board checks
    # free >= 256 + 2 * name_len). C must be the same in every baseline row.
    consts = {int(r["free_ram"]) + int(r["heap_bytes"]) for r in syms if r["variant"] == "baseline" and r["result"] == "ok"}
    if len(consts) != 1:
        print(f"warning: baseline free+heap is not constant: {sorted(consts)}")
    baseline_c = min(consts)

    attach_trie_work(syms, looks)
    model = {"baseline_free_plus_heap": baseline_c, "ram_reserve": 256, "pools": pools(), "variants": {}, "validation": []}
    for v in VARIANTS:
        kind = "trie" if v == "ABC" else "hash"
        ins = [r for r in syms if r["variant"] == v and r["kind"] == "sim" and r["result"] == "ok"]
        hit = [r for r in looks if r["variant"] == v and r["kind"] == "sim" and r["lookup"] == "hit"]
        miss = [r for r in looks if r["variant"] == v and r["kind"] == "sim" and r["lookup"] == "miss"]
        model["variants"][v] = {"insert": fit(ins, "insert_us", FEATURES["insert"][kind]),
                                "lookup_hit": fit(hit, "lookup_us", FEATURES["lookup_hit"][kind]),
                                "lookup_miss": fit(miss, "lookup_us", FEATURES["lookup_miss"][kind])}
        mv = model["variants"][v]
        for run in (r for r in runs if r["variant"] == v and r["kind"] == "preset"):
            p_ins = [r for r in syms if r["variant"] == v and r["list"] == run["list"] and r["result"] == "ok"]
            p_hit = [r for r in looks if r["variant"] == v and r["list"] == run["list"] and r["lookup"] == "hit"]
            if not p_ins:
                continue
            model["validation"].append({
                "variant": v, "preset": run["list"],
                "insert_measured": float(run["insert_us_mean"]),
                "insert_predicted": round(predict(mv["insert"], p_ins), 2),
                "lookup_measured": float(run["lookup_hit_us_mean"]),
                "lookup_predicted": round(predict(mv["lookup_hit"], p_hit), 2),
                "insert_half_range": round(2 * mv["insert"]["sd_band"], 2),
                "lookup_half_range": round(2 * mv["lookup_hit"]["sd_band"], 2)})

    presets = []
    for pid, name in samples.items():
        row = {"id": pid, "name": name}
        for v in VARIANTS:
            r = next((x for x in runs if x["variant"] == v and x["list"] == pid), None)
            if r:
                row[v] = {k: r[k] for k in ("n", "stored", "refused", "stopped", "table_bytes", "heap_bytes",
                                            "min_free_ram")}
                for k in ("insert_us_mean", "lookup_hit_us_mean", "lookup_miss_us_mean"):
                    row[v][k] = float(r[k]) if r[k] != "" else None
                for k in ("n", "stored", "refused", "table_bytes", "heap_bytes", "min_free_ram"):
                    row[v][k] = int(row[v][k])
        presets.append(row)

    sims = []
    for v in VARIANTS:
        for pattern in ("realistic", "random", "scoped"):
            for n in sorted({int(r["n"]) for r in runs if r["kind"] == "sim"}):
                rs = [r for r in runs if r["variant"] == v and r["kind"] == "sim" and r["pattern"] == pattern and int(r["n"]) == n]
                if not rs:
                    continue
                full = [r for r in rs if r["refused"] == "0"]
                sims.append({"variant": v, "pattern": pattern, "n": n, "programs": len(rs),
                             "held_all": len(full),
                             "table_bytes_mean": round(statistics.fmean(int(r["table_bytes"]) for r in full), 1) if full else None,
                             "insert_us_mean": mean_of(rs, "insert_us_mean"),
                             "lookup_hit_us_mean": mean_of(rs, "lookup_hit_us_mean")})

    data = {"source": "Measured on the Arduino Uno by firmware/tools/board_runs.py; "
                      "written by firmware/tools/fit_uno_model.py",
            "board": meta.get("board"), "measured": dt.date.today().isoformat(),
            "counts": {"runs": len(runs), "inserts": len(syms), "lookups": len(looks)},
            "presets": presets, "sims": sims, "model": model}
    OUT.write_text(json.dumps(data, indent=1) + "\n", newline="\n")

    print(f"{len(runs)} runs, {len(syms)} inserts, {len(looks)} lookups; baseline free+heap = {sorted(consts)}")
    for v in VARIANTS:
        for k, m in model["variants"][v].items():
            print(f"{v:8} {k:11} R2 {m['r2']}  sd/symbol {m['sd_symbol']}  sd/program {m['sd_program']}  "
                  f"sd cross-validated {m['sd_cross_validated']}  ({m['n_rows']} rows, {m['n_programs']} programs)")
    print("validation on presets (never used in the fit):")
    for r in model["validation"]:
        print(f"  {r['variant']:8} {r['preset']:28} insert {r['insert_measured']:6} vs {r['insert_predicted']:6}   "
              f"lookup {r['lookup_measured']:6} vs {r['lookup_predicted']:6}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
