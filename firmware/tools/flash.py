"""Build firmware/uno_bench for one structure and upload it to the Uno.

    python firmware/tools/flash.py ABC --port COM3
    python firmware/tools/flash.py baseline --port COM3

Structures: baseline A B C AB AC BC ABC. If the backend is running and holds
the port, it is asked to let go first. After the upload the board is asked
which structure it runs and how much RAM is free.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from collect import NAMES, Board, FQBN, build, cli, find_cli  # noqa: E402


def release_port(backend: str) -> None:
    """Best effort: a running backend keeps the port open between requests."""
    try:
        req = urllib.request.Request(f"{backend}/hardware/uno/disconnect", data=b"", method="POST")
        urllib.request.urlopen(req, timeout=2).read()
        print("backend released the port")
    except Exception:  # noqa: BLE001 - no backend running is the normal case
        pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("structure", choices=NAMES)
    ap.add_argument("--port", required=True)
    ap.add_argument("--cli")
    ap.add_argument("--backend", default="http://localhost:8000")
    args = ap.parse_args()
    exe = find_cli(args.cli)
    v = NAMES.index(args.structure)

    release_port(args.backend)
    with tempfile.TemporaryDirectory() as tmp:
        print(f"compiling {args.structure} (BENCH_VARIANT={v})", flush=True)
        flash, ram = build(exe, v, Path(tmp))
        print(f"flash {flash} B, static RAM {ram} B of 2048; uploading to {args.port}", flush=True)
        cli(exe, "upload", "-p", args.port, "--fqbn", FQBN, "--input-dir", tmp)
    time.sleep(1)

    with open(Path(tempfile.gettempdir()) / "uno_flash.log", "w") as log:
        board = Board(args.port, log, args.structure)
        ping = next(ln for ln in board.run("PING") if ln.startswith("{"))
        board.close()
    info = json.loads(ping)
    print(f"board runs {info['variant']}, {info['free_heap']} B RAM free")
    return 0 if info["variant"] == args.structure else 1


if __name__ == "__main__":
    sys.exit(main())
