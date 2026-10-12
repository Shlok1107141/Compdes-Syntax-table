"""Shared fixtures.

The engine is compiled from source for the test session under
-fsanitize=address,undefined, so every test doubles as a memory-safety check
on the C code (the project's testing standard: verify, then measure).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent
ENGINE_DIR = REPO_ROOT / "engine"
ENGINE_SOURCE = ENGINE_DIR / "symtab_analyze.c"

SANITIZER_FLAGS = ["-fsanitize=address,undefined", "-fno-omit-frame-pointer"]
# Same strictness as the CI engine job; SYMTAB_NO_MAIN drops the variants' demo main()s.
BASE_FLAGS = ["-std=c11", "-Wall", "-Wextra", "-Werror", "-pedantic", "-g", "-DSYMTAB_NO_MAIN"]


def engine_sources() -> list[str]:
    """The analyzer plus every variant it links (the real ablation structures)."""
    return [str(ENGINE_SOURCE), *sorted(str(p) for p in ENGINE_DIR.glob("variant_*.c"))]


def _compile(binary: Path, flags: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["gcc", *engine_sources(), "-o", str(binary), *BASE_FLAGS, *flags],
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.fixture(scope="session")
def engine_binary(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Compile the analyzer once per session and return the binary's path."""
    if not ENGINE_SOURCE.is_file():
        pytest.skip(f"engine source missing: {ENGINE_SOURCE}")

    out_dir = tmp_path_factory.mktemp("engine")
    binary = out_dir / ("symtab_analyze.exe" if sys.platform == "win32" else "symtab_analyze")

    result = _compile(binary, SANITIZER_FLAGS)
    if result.returncode != 0:
        # MinGW has no sanitizer runtime; CI (Linux) always takes the path above.
        if sys.platform != "win32":
            pytest.fail(f"sanitized build failed:\n{result.stderr}")
        result = _compile(binary, [])
        if result.returncode != 0:
            pytest.fail(f"engine build failed:\n{result.stderr}")

    assert result.stderr.strip() == "", f"engine compiled with warnings:\n{result.stderr}"
    return binary


@pytest.fixture(scope="session")
def run_engine(engine_binary: Path):
    """Run the analyzer on source text; returns (exit_code, payload, stderr)."""

    def _run(source: str, timeout: float = 30.0) -> tuple[int, dict, str]:
        proc = subprocess.run(
            [str(engine_binary)],
            input=source.encode("utf-8"),
            capture_output=True,
            timeout=timeout,
            check=False,
        )
        stdout = proc.stdout.decode("utf-8", "replace")
        payload = json.loads(stdout) if stdout.strip() else {}
        return proc.returncode, payload, proc.stderr.decode("utf-8", "replace")

    return _run


@pytest.fixture
def client(engine_binary: Path, monkeypatch: pytest.MonkeyPatch):
    """TestClient wired to the freshly built engine, with limits reset."""
    monkeypatch.setenv("SYMTAB_ENGINE", str(engine_binary))
    os.environ.setdefault("SYMTAB_ALLOWED_ORIGINS", "http://localhost:5173")

    from fastapi.testclient import TestClient

    import main

    main._hits.clear()
    with TestClient(main.app) as test_client:
        yield test_client
    main._hits.clear()


SAMPLE_SOURCE = """
/* a small embedded-style program */
#include <stdint.h>

struct sensor_config {
    int  sensor_id;
    char sensor_name[16];
};

static int counter;
int        counter_max = 100;
char       temp_buffer[32];

int sensor_read(int sensor_id, char *out_buf);

int sensor_read(int sensor_id, char *out_buf) {
    static int call_count;
    int value = sensor_id * 2;
    if (value > 10) {
        int clamped = 10;
        value = clamped;
    }
    return value;
}

int main(void) {
    int counter = 0;   /* shadows the file-scope counter */
    for (int i = 0; i < 4; i++) {
        counter += i;
    }
    return counter;
}
"""
