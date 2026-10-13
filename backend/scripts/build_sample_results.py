"""Regenerate the frontend's offline results from the real engine.

Offline mode in the UI shows these instead of computing anything itself, so
every number on screen comes from engine/symtab_analyze. Run after changing
the engine or frontend/src/data/samples.json:

    python backend/scripts/build_sample_results.py [path/to/symtab_analyze]

tests/test_sample_results.py fails while the committed file is stale.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLES = REPO_ROOT / "frontend" / "src" / "data" / "samples.json"
RESULTS = REPO_ROOT / "frontend" / "src" / "data" / "sampleResults.json"


def build_results(engine: Path) -> dict[str, dict]:
    results = {}
    for sample in json.loads(SAMPLES.read_text(encoding="utf-8")):
        proc = subprocess.run([str(engine)], input=sample["code"].encode("utf-8"),
                              capture_output=True, check=True)
        payload = json.loads(proc.stdout)
        payload.pop("stats", None)     # server-side diagnostics, not part of the API
        results[sample["id"]] = payload
    return results


def render(results: dict[str, dict]) -> str:
    return json.dumps(results, indent=2) + "\n"


def main(argv: list[str]) -> int:
    default = REPO_ROOT / "engine" / ("symtab_analyze.exe" if sys.platform == "win32" else "symtab_analyze")
    engine = Path(argv[1]) if len(argv) > 1 else default
    if not engine.is_file():
        print(f"engine binary not found: {engine} (build it with: make -C engine symtab_analyze)",
              file=sys.stderr)
        return 1
    RESULTS.write_text(render(build_results(engine)), encoding="utf-8", newline="\n")
    print(f"wrote {RESULTS.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
