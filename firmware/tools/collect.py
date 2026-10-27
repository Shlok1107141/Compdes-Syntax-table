"""Build, flash and measure every structure on an Arduino Uno; write the results.

    python firmware/tools/collect.py --port COM3

For each structure (BENCH_VARIANT 0..7) this compiles firmware/uno_bench with
arduino-cli, records flash and static RAM from the compiler's report, uploads,
runs INFO, MEM, TIME and CAP, and for baseline and ABC stores two tables in
EEPROM, resets the board (reopening the port pulls DTR) and loads them back.

Output, in --out (default firmware/results):
  uno_raw.log      every line the board printed, prefixed with the build
  uno_build.csv    variant, flash_bytes, static_ram_bytes
  uno_mem.csv, uno_time.csv, uno_cap.csv, uno_save.csv, uno_load.csv
                   the board's CSV rows (header from the board's "# ..." line)
  uno_meta.json    board, core, compiler, git commit, date

Needs pyserial and arduino-cli (the Arduino IDE ships one; pass --cli).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import serial

ROOT = Path(__file__).resolve().parents[2]
SKETCH = ROOT / "firmware" / "uno_bench"
NAMES = ["baseline", "A", "B", "C", "AB", "AC", "BC", "ABC"]
FQBN = "arduino:avr:uno"
IDE_CLI = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe"


def find_cli(given: str | None) -> str:
    for c in (given, os.environ.get("ARDUINO_CLI"), shutil.which("arduino-cli"), str(IDE_CLI)):
        if c and Path(c).exists():
            return c
    sys.exit("arduino-cli not found: pass --cli or set ARDUINO_CLI")


def cli(exe: str, *args: str) -> str:
    r = subprocess.run([exe, *args], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"arduino-cli {' '.join(args[:2])} failed:\n{r.stdout}\n{r.stderr}")
    return r.stdout + r.stderr


def build(exe: str, v: int, build_dir: Path) -> tuple[int, int]:
    flag = f"-DBENCH_VARIANT={v}"
    out = cli(exe, "compile", "--fqbn", FQBN, "--build-path", str(build_dir),
              "--build-property", f"compiler.c.extra_flags={flag}",
              "--build-property", f"compiler.cpp.extra_flags={flag}", str(SKETCH))
    flash = int(re.search(r"Sketch uses (\d+) bytes", out).group(1))
    ram = int(re.search(r"Global variables use (\d+) bytes", out).group(1))
    return flash, ram


class Board:
    """Serial session. Opening the port resets an Uno; wait for its banner."""

    def __init__(self, port: str, log, tag: str):
        self.log, self.tag = log, tag
        self.ser = serial.Serial(port, 115200, timeout=0.5)
        self.lines(until="# uno_bench ready", timeout=8)

    def lines(self, until: str, timeout: float) -> list[str]:
        got, end = [], time.time() + timeout
        while time.time() < end:
            raw = self.ser.readline().decode("ascii", errors="replace").strip()
            if not raw:
                continue
            self.log.write(f"[{self.tag}] {raw}\n")
            got.append(raw)
            if raw.startswith(until):
                return got
        raise TimeoutError(f"{self.tag}: no '{until}' within {timeout}s (got {got[-3:]})")

    def run(self, command: str, timeout: float = 120) -> list[str]:
        self.ser.write((command + "\n").encode())
        return self.lines(until="DONE", timeout=timeout)

    def close(self):
        self.ser.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", required=True)
    ap.add_argument("--cli")
    ap.add_argument("--out", default=str(ROOT / "firmware" / "results"))
    ap.add_argument("--variants", default="0,1,2,3,4,5,6,7")
    args = ap.parse_args()
    exe = find_cli(args.cli)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    rows: dict[str, list[str]] = {}
    headers: dict[str, str] = {}
    builds = ["variant,flash_bytes,static_ram_bytes"]

    def keep(lines: list[str]):
        header = None
        for ln in lines:
            if ln.startswith("# variant,"):
                header = ln[2:].split("  ")[0]
            elif ln.startswith("CSV,"):
                kind = ln.split(",")[1]
                rows.setdefault(kind, []).append(ln.split(",", 2)[2])
                if header:
                    headers[kind] = header

    with tempfile.TemporaryDirectory() as tmp, open(out / "uno_raw.log", "w", newline="\n") as log:
        for v in map(int, args.variants.split(",")):
            name = NAMES[v]
            print(f"[{name}] compiling", flush=True)
            flash, ram = build(exe, v, Path(tmp) / f"b{v}")
            builds.append(f"{name},{flash},{ram}")
            print(f"[{name}] flash {flash} B, static RAM {ram} B; uploading", flush=True)
            cli(exe, "upload", "-p", args.port, "--fqbn", FQBN, "--input-dir", str(Path(tmp) / f"b{v}"))
            time.sleep(1)

            board = Board(args.port, log, name)
            for command in ("PING", "INFO", "MEM", "TIME", "CAP"):
                print(f"[{name}] {command}", flush=True)
                keep(board.run(command))
            board.close()

            if name in ("baseline", "ABC"):
                for w in (0, 1):                     # proto30, esp32_sensor
                    board = Board(args.port, log, name)
                    keep(board.run(f"SAVE {w}"))
                    board.close()
                    time.sleep(0.5)
                    board = Board(args.port, log, name)   # a fresh reset: RAM is gone
                    keep(board.run("LOAD"))
                    board.close()
                    print(f"[{name}] saved and reloaded symbol set {w} across a reset", flush=True)

    (out / "uno_build.csv").write_text("\n".join(builds) + "\n", newline="\n")
    for kind in ("MEM", "TIME", "CAP", "SAVE", "LOAD"):
        if kind in rows:
            text = headers.get(kind, "") + "\n" + "\n".join(rows[kind]) + "\n"
            (out / f"uno_{kind.lower()}.csv").write_text(text, newline="\n")

    core = re.search(r"arduino:avr\s+(\S+)", cli(exe, "core", "list"))
    meta = {
        "board": "Arduino Uno compatible (ATmega328P, CH340 USB-serial, Optiboot)",
        "fqbn": FQBN,
        "core": f"arduino:avr {core.group(1) if core else '?'}",
        "arduino_cli": cli(exe, "version").strip(),
        "git_commit": subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True,
                                     cwd=ROOT).stdout.strip(),
        "date": dt.datetime.now().isoformat(timespec="seconds"),
    }
    (out / "uno_meta.json").write_text(json.dumps(meta, indent=2) + "\n", newline="\n")
    print(f"wrote results to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
