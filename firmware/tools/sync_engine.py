"""Copy the engine's symbol-table code into the Uno sketch, or check the copy.

    python firmware/tools/sync_engine.py           # copy engine/ -> firmware/uno_bench/src/
    python firmware/tools/sync_engine.py --check   # exit 1 if the copy is stale (CI)

The Arduino IDE only compiles files inside the sketch folder, so the sketch
carries a copy. The copy must stay byte-identical to engine/, so the board
runs exactly the code the PC results come from.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENGINE = ROOT / "engine"
DEST = ROOT / "firmware" / "uno_bench" / "src"
FILES = ["symtab_common.h"] + sorted(p.name for p in ENGINE.glob("variant_*.c"))


def main() -> int:
    check = "--check" in sys.argv[1:]
    stale = []
    for name in FILES:
        src, dst = (ENGINE / name).read_bytes(), DEST / name
        if dst.exists() and dst.read_bytes() == src:
            continue
        stale.append(name)
        if not check:
            dst.write_bytes(src)
    if check and stale:
        print("stale engine copy in firmware/uno_bench/src: " + ", ".join(stale))
        print("run: python firmware/tools/sync_engine.py")
        return 1
    print(f"{'checked' if check else 'synced'} {len(FILES)} files" + (f", updated {len(stale)}" if stale and not check else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
