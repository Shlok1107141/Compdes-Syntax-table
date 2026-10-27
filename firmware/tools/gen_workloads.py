"""Generate the Uno benchmark's symbol sets and arena pool sizes.

    python firmware/tools/gen_workloads.py [--budget 1200]

Writes firmware/uno_bench/src/workloads.h (symbol sets, stored in flash) and
firmware/uno_bench/src/pools.h (static arena sizes). Needs gcc on PATH.

Every symbol set comes from the engine, not from this script:
  proto30       the prototype's 30 identifiers (engine/symtab_common.h)
  esp32_sensor  the built-in program of firmware/esp32/esp32.ino, declarations
                as engine/symtab_analyze.c reports them
  realistic50, random50, scoped50
                symtab_workloads.h with seed 1: the n=50 rows of results.csv
  capacity      realistic, 400 names, seed 1; inserted until the table is full

Pool sizes: in the capacity test the heap variants may grow to --budget bytes.
Each arena variant gets static pools of at most the same total size: first
large enough for every other symbol set whose table fits the budget, then the
rest split as the capacity workload needs. That is the best case for an arena
(a real compiler does not know its input in advance), and the results say so.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENGINE = ROOT / "engine"
SRC = ROOT / "firmware" / "uno_bench" / "src"
HELPER = Path(__file__).with_name("wl_helper.c")

# Same program the ESP32 firmware analyses for its DEMO command.
ESP32_SENSOR_CODE = """
int sensor_reading = 0;
int sensor_threshold = 100;
float sensor_calibration = 1.05;
uint16_t sensor_offset = 12;
uint8_t channel_status = 1;
uint8_t channel_mask = 0xFF;
int channel_config = 4;
int channel_advocate = 0;
float filter_alpha = 0.85;
float filter_beta = 0.15;
int filter_window = 16;
int adc_raw_value = 512;
int adc_scaled_val = 250;
int adc_buffer_head = 0;
int adc_buffer_tail = 0;
void process_frame() {
    int sensor_reading = 42;
    int local_error = 0;
    int channel_status = 2;
    float local_variance = 0.04;
    {
        int sensor_reading = 99;
        int temp_scratch = 1;
        int loop_counter = 0;
    }
}
"""

# (label, pattern, n); pattern -1 = proto30, None = esp32_sensor
WORKLOADS = [
    ("proto30", -1, 30),
    ("esp32_sensor", None, 0),
    ("realistic50", 0, 50),
    ("random50", 1, 50),
    ("scoped50", 2, 50),
    ("capacity", 0, 400),
]
CAPACITY = len(WORKLOADS) - 1

# Bytes per pool entry on the ATmega328P (int and pointers are 2 bytes).
# meta/shadow are 0 for the hash-table arenas, which store one node per symbol.
AVR = {
    "B": {"node": 12, "meta": 0, "shadow": 0, "fixed": 128},   # ANode; 64 uint16 buckets
    "AB": {"node": 8, "meta": 0, "shadow": 0, "fixed": 128},   # ABNode; 64 uint16 buckets
    "BC": {"node": 10, "meta": 8, "shadow": 4, "fixed": 0},    # TrieNode; unpacked Meta
    "ABC": {"node": 10, "meta": 4, "shadow": 4, "fixed": 0},   # TrieNode; packed word
}
# label: (source, Impl, is an arena variant, has a metadata pool)
VARIANT_SRC = {
    "A": ("variant_a_bitpack.c", "a_impl", False, False),
    "B": ("variant_b_arena.c", "b_impl", True, False),
    "C": ("variant_c_trie.c", "c_impl", False, False),
    "AB": ("variant_ab_arena_bitpack.c", "ab_impl", True, False),
    "AC": ("variant_ac_trie_bitpack.c", "ac_impl", False, False),
    "BC": ("variant_bc_trie_arena.c", "bc_impl", True, True),
    "ABC": ("variant_abc_full.c", "abc_impl", True, True),
}


def run(cmd, stdin=None):
    return subprocess.run(cmd, input=stdin, capture_output=True, text=True, check=True).stdout


def build(tmp: Path) -> dict[str, Path]:
    exe = ".exe" if sys.platform == "win32" else ""
    base = ["gcc", "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", f"-I{ENGINE}"]
    out = {"dump": tmp / f"wl_dump{exe}", "analyze": tmp / f"analyze{exe}"}
    run(base + [str(HELPER), "-o", str(out["dump"])])
    for v, (src, impl, arena, has_meta) in VARIANT_SRC.items():
        out[v] = tmp / f"wl_{v}{exe}"
        flags = [f'-DVARIANT_SRC="{src}"', f"-DCFG_IMPL={impl}"]
        flags += (["-DHAS_ARENA"] if arena else []) + (["-DHAS_META"] if has_meta else [])
        run(base + flags + [str(HELPER), "-o", str(out[v])])
    variants = sorted(str(p) for p in ENGINE.glob("variant_*.c"))
    run(["gcc", "-std=c11", "-O2", "-DSYMTAB_NO_MAIN", str(ENGINE / "symtab_analyze.c"), *variants,
         "-o", str(out["analyze"]), "-lm"])
    return out


def esp32_sensor(analyze: Path) -> list[tuple[int, int, int, int, str]]:
    table = json.loads(run([str(analyze)], ESP32_SENSOR_CODE))["symbol_table"]
    rows = []
    for s in table:
        p = s["packed"]
        rows.append(((p >> 28) & 0xF, (p >> 20) & 0xFF, (p >> 16) & 0xF, p & 0xFFFF, s["name"]))
    return rows


def symbols(exes, pattern, n):
    if pattern is None:
        return esp32_sensor(exes["analyze"])
    lines = run([str(exes["dump"]), "dump", str(pattern), str(n), "1"]).splitlines()
    return [(*map(int, ln.split()[:4]), ln.split()[4]) for ln in lines]


def as_text(rows) -> str:
    return "".join(f"{t} {sc} {st} {off} {name}\n" for t, sc, st, off, name in rows)


def need(v: str, counts: list[tuple[int, ...]], rows, k: int) -> dict[str, int]:
    """Smallest pools that accept the first k inserts. Mirrors each insert's
    up-front check: a trie insert asks for two free nodes, room for the whole
    name in the char pool, one metadata slot and one shadow slot."""
    if AVR[v]["meta"] == 0:
        return {"nodes": k, "chars": counts[k - 1][1], "meta": 0, "shadows": 0}
    before = [(1, 0, 0, 0)] + counts[:k - 1]                    # the root exists before insert 1
    return {"nodes": before[-1][0] + 2,
            "chars": max(b[1] + len(r[4]) for b, r in zip(before, rows)),
            "meta": counts[k - 1][2],
            "shadows": before[-1][3] + 1}


def size(v: str, p: dict[str, int]) -> int:
    a = AVR[v]
    return p["nodes"] * a["node"] + p["chars"] + p["meta"] * a["meta"] + p["shadows"] * a["shadow"] + a["fixed"]


def c_record(t, sc, st, off, name) -> str:
    chars = ",".join(f"'{c}'" for c in name)
    return f"    {t},{sc},{st},{off & 0xFF},{off >> 8}, {chars},0,\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=int, default=1200, help="bytes each structure may occupy")
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        exes = build(Path(tmp))
        sets = [(label, symbols(exes, pattern, n)) for label, pattern, n in WORKLOADS]

        def counts_for(v, rows):
            return [tuple(map(int, ln.split())) for ln in run([str(exes[v]), "pools"], as_text(rows)).splitlines()]

        def merge(a, b):
            return {f: max(a[f], b[f]) for f in a}

        pools, report = {}, []
        for v in AVR:
            floor = {"nodes": 0, "chars": 0, "meta": 0, "shadows": 0}
            for label, rows in sets[:CAPACITY]:
                c = counts_for(v, rows)
                req = need(v, c, rows, len(c))
                ok = size(v, merge(floor, req)) <= args.budget
                if ok:
                    floor = merge(floor, req)
                report.append(f"{v:4} {label:13} needs {size(v, req):5} B -> {'fits' if ok else 'over budget'}")
            cap_rows = sets[CAPACITY][1]
            counts = counts_for(v, cap_rows)
            k = max(k for k in range(1, len(counts) + 1)
                    if size(v, merge(floor, need(v, counts, cap_rows, k))) <= args.budget)
            pools[v] = merge(floor, need(v, counts, cap_rows, k))
            report.append(f"{v:4} pools {pools[v]} = {size(v, pools[v])} B, capacity {k}")

    out = ["/* Generated by firmware/tools/gen_workloads.py -- do not edit. Symbol sets in flash.",
           " * Record: type, scope, storage class, offset (lo, hi), name, NUL. */",
           "#ifndef WORKLOADS_H", "#define WORKLOADS_H", ""]
    for i, (label, rows) in enumerate(sets):
        out.append(f"/* {label}: {len(rows)} symbols */")
        out.append(f"static const uint8_t WL_{i}[] PROGMEM = {{\n" + "".join(c_record(*r) for r in rows) + "};")
        out.append(f'static const char WL_{i}_LABEL[] PROGMEM = "{label}";')
        out.append("")
    n = len(sets)
    out.append("static const uint8_t *const WL_DATA[] PROGMEM = { " + ", ".join(f"WL_{i}" for i in range(n)) + " };")
    out.append("static const char *const WL_LABEL[] PROGMEM = { " + ", ".join(f"WL_{i}_LABEL" for i in range(n)) + " };")
    out.append("static const uint16_t WL_SIZE[] PROGMEM = { " + ", ".join(str(len(r)) for _, r in sets) + " };")
    out += [f"#define WL_NUM      {n}", f"#define WL_CAPACITY {CAPACITY}", "", "#endif", ""]
    SRC.mkdir(parents=True, exist_ok=True)
    (SRC / "workloads.h").write_text("\n".join(out), newline="\n")

    p = ["/* Generated by firmware/tools/gen_workloads.py -- do not edit.",
         f" * Static arena pools for a {args.budget} B structure budget, split as the capacity",
         " * workload needs (best case for an arena). */",
         "#ifndef POOLS_H", "#define POOLS_H", f"#define STRUCT_BUDGET {args.budget}"]
    for v, q in pools.items():
        for f in ("nodes", "chars", "meta", "shadows"):
            p.append(f"#define POOL_{v}_{f.upper():8} {max(q[f], 1)}")
    p += ["#endif", ""]
    (SRC / "pools.h").write_text("\n".join(p), newline="\n")

    print("\n".join(report))
    print(f"wrote {SRC / 'workloads.h'} and {SRC / 'pools.h'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
