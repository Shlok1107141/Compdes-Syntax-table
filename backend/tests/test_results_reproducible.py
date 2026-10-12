"""engine/results.csv must be reproducible from the code in engine/.

The paper's numbers come from that file, so a change to a variant that moves
any figure must also regenerate it (engine/run_sweep.sh). This rebuilds the
seven stress configurations exactly as run_sweep.sh does and compares rows.
"""

from __future__ import annotations

import subprocess
import sys

from conftest import ENGINE_DIR

CONFIGS = {
    "a": "variant_a_bitpack.c",
    "b": "variant_b_arena.c",
    "c": "variant_c_trie.c",
    "ab": "variant_ab_arena_bitpack.c",
    "ac": "variant_ac_trie_bitpack.c",
    "bc": "variant_bc_trie_arena.c",
    "abc": "variant_abc_full.c",
}
SWEEP_FLAGS = ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-pedantic"]


def test_results_csv_matches_a_fresh_sweep(tmp_path):
    rows: list[str] = []
    for cfg, source in CONFIGS.items():
        exe = tmp_path / (f"stress_{cfg}.exe" if sys.platform == "win32" else f"stress_{cfg}")
        build = subprocess.run(
            ["gcc", *SWEEP_FLAGS,
             f"-DCFG={cfg}", f'-DCFG_LABEL="{cfg.upper()}"', f'-DVARIANT_SRC="{source}"',
             "-o", str(exe), str(ENGINE_DIR / "symtab_stress.c")],
            capture_output=True, text=True, check=False,
        )
        assert build.returncode == 0, build.stderr
        run = subprocess.run([str(exe), "1"], capture_output=True, text=True, check=False, timeout=120)
        assert run.returncode == 0, run.stderr
        rows += run.stdout.splitlines()

    committed = (ENGINE_DIR / "results.csv").read_text().splitlines()
    assert rows == committed, "engine/results.csv is stale: re-run engine/run_sweep.sh"
