"""Runs the C analyzer as a sandboxed child process and returns its JSON.

The submitted source text is never compiled or executed -- it is written to
the analyzer's stdin and only parsed. Everything that bounds the child
(timeout, output cap, scrubbed environment, no shell) lives here.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ENGINE_DIR = REPO_ROOT / "engine"
BINARY_NAME = "symtab_analyze.exe" if sys.platform == "win32" else "symtab_analyze"

TIMEOUT_SECONDS = float(os.environ.get("SYMTAB_ENGINE_TIMEOUT", "5"))
MAX_OUTPUT_BYTES = 8 * 1024 * 1024

# Engine exit codes (see engine/symtab_analyze.c)
EXIT_OK = 0
EXIT_INPUT_REJECTED = 2
EXIT_VERIFICATION_FAILED = 3


class EngineError(Exception):
    """Failure that maps onto an HTTP status code."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def engine_path() -> Path:
    """Locate the analyzer binary, preferring an explicit override."""
    override = os.environ.get("SYMTAB_ENGINE")
    path = Path(override) if override else ENGINE_DIR / BINARY_NAME
    if not path.is_file():
        raise EngineError(
            503,
            f"analyzer binary not found at {path}; build it with 'make -C engine symtab_analyze'",
        )
    return path


def _child_env() -> dict[str, str]:
    """Minimal environment: the child needs no inherited configuration."""
    env = {"LC_ALL": "C", "LANG": "C"}
    if sys.platform == "win32":  # Windows needs these to load the CRT
        for key in ("SYSTEMROOT", "PATH", "TEMP"):
            if key in os.environ:
                env[key] = os.environ[key]
    else:
        env["PATH"] = "/usr/bin:/bin"
    return env


def _run_blocking(binary: Path, source: bytes) -> subprocess.CompletedProcess[bytes]:
    with tempfile.TemporaryDirectory(prefix="symtab-") as workdir:
        return subprocess.run(
            [str(binary)],
            input=source,
            capture_output=True,
            timeout=TIMEOUT_SECONDS,
            cwd=workdir,          # no access to the repo from the child
            env=_child_env(),
            shell=False,
            check=False,
        )


async def analyze_source(code: str) -> dict:
    """Parse `code` with the analyzer and return its JSON object."""
    binary = engine_path()
    source = code.encode("utf-8", errors="replace")

    try:
        proc = await asyncio.to_thread(_run_blocking, binary, source)
    except subprocess.TimeoutExpired:
        raise EngineError(504, "analysis timed out") from None
    except OSError as exc:
        raise EngineError(503, f"could not start the analyzer: {exc}") from None

    if len(proc.stdout) > MAX_OUTPUT_BYTES:
        raise EngineError(500, "analyzer produced an implausibly large result")

    try:
        payload = json.loads(proc.stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        detail = proc.stderr.decode("utf-8", "replace")[:200].strip()
        raise EngineError(500, f"analyzer returned unreadable output. {detail}".strip()) from None

    if proc.returncode == EXIT_INPUT_REJECTED:
        raise EngineError(400, payload.get("error", "input rejected by the analyzer"))
    if proc.returncode == EXIT_VERIFICATION_FAILED:
        raise EngineError(500, payload.get("error", "symbol table failed verification"))
    if proc.returncode != EXIT_OK:
        raise EngineError(500, f"analyzer exited with status {proc.returncode}")
    if "error" in payload:
        raise EngineError(500, str(payload["error"]))

    return payload
