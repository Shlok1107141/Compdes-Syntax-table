"""The UI's offline results must be exactly what the engine prints today.

Offline mode shows frontend/src/data/sampleResults.json instead of calling
the backend, so a stale file would put numbers on screen that the engine no
longer produces. Regenerate with backend/scripts/build_sample_results.py.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from build_sample_results import RESULTS, SAMPLES, build_results  # noqa: E402


def test_every_sample_has_a_stored_result():
    samples = json.loads(SAMPLES.read_text(encoding="utf-8"))
    stored = json.loads(RESULTS.read_text(encoding="utf-8"))
    assert sorted(stored) == sorted(s["id"] for s in samples)


def test_offline_results_match_the_engine(engine_binary):
    stored = json.loads(RESULTS.read_text(encoding="utf-8"))
    assert build_results(engine_binary) == stored, (
        "frontend/src/data/sampleResults.json is stale: "
        "run python backend/scripts/build_sample_results.py"
    )
