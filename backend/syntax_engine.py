"""Runs the C syntax table compression benchmark engine and returns its 6-pillar evaluation data.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ENGINE_DIR = REPO_ROOT / "engine"
BINARY_NAME = "syntax_bench.exe" if sys.platform == "win32" else "syntax_bench"

TIMEOUT_SECONDS = float(os.environ.get("SYNTAX_ENGINE_TIMEOUT", "10"))
MAX_OUTPUT_BYTES = 16 * 1024 * 1024


class SyntaxEngineError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def syntax_engine_path() -> Path:
    override = os.environ.get("SYNTAX_ENGINE")
    path = Path(override) if override else ENGINE_DIR / BINARY_NAME
    if not path.is_file():
        # Try compiling on the fly if gcc is available
        try:
            cmd = ["gcc", "-O2", "-Wall", "-DSYNTAX_BENCH_CLI", "syntax_table_compress.c", "-o", BINARY_NAME]
            subprocess.run(cmd, cwd=str(ENGINE_DIR), check=True, capture_output=True)
        except Exception:
            pass

    if not path.is_file():
        raise SyntaxEngineError(
            503,
            f"syntax table compression binary not found at {path}; build it with 'make -C engine syntax_bench'",
        )
    return path


def _child_env() -> dict[str, str]:
    env = {"LC_ALL": "C", "LANG": "C"}
    if sys.platform == "win32":
        for key in ("SYSTEMROOT", "PATH", "TEMP"):
            if key in os.environ:
                env[key] = os.environ[key]
    else:
        env["PATH"] = "/usr/bin:/bin"
    return env


async def run_syntax_benchmarks() -> dict:
    binary = syntax_engine_path()
    try:
        proc = await asyncio.create_subprocess_exec(
            str(binary),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_child_env(),
        )
    except OSError as exc:
        raise SyntaxEngineError(503, f"failed to spawn {binary.name}: {exc}") from exc

    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        raise SyntaxEngineError(504, f"syntax benchmark timed out after {TIMEOUT_SECONDS}s") from None

    if len(stdout) > MAX_OUTPUT_BYTES:
        raise SyntaxEngineError(500, f"syntax benchmark output exceeded {MAX_OUTPUT_BYTES} bytes")

    if proc.returncode != 0:
        err_msg = stderr.decode("utf-8", errors="replace").strip()
        raise SyntaxEngineError(500, f"syntax benchmark exited with status {proc.returncode}: {err_msg}")

    try:
        data = json.loads(stdout.decode("utf-8", errors="strict"))
    except json.JSONDecodeError as exc:
        raise SyntaxEngineError(500, f"syntax benchmark produced invalid JSON: {exc}") from exc

    return data
