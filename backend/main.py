"""FastAPI wrapper around the compressed symbol table engine.

Single endpoint, contract locked (see backend/README.md):

    POST /analyze  {"code": "<source text>"}  ->  baseline_bytes,
    compressed_bytes, savings_pct, symbol_table[], ablation{}

Security scope is deliberately narrow -- there are no accounts and no user
data here. The one real risk is untrusted source text reaching a native
parser, so this module caps input size, rate-limits by client, bounds
concurrency, and locks CORS down; engine.py bounds the child process.
"""

from __future__ import annotations

import os
import time
from collections import defaultdict, deque

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from engine import EngineError, analyze_source

MAX_CODE_BYTES = int(os.environ.get("SYMTAB_MAX_CODE_BYTES", 64 * 1024))
RATE_LIMIT_REQUESTS = int(os.environ.get("SYMTAB_RATE_LIMIT", "30"))
RATE_LIMIT_WINDOW_SECONDS = 60.0
MAX_CONCURRENT_ANALYSES = int(os.environ.get("SYMTAB_MAX_CONCURRENCY", "4"))
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "SYMTAB_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000"
    ).split(",")
    if origin.strip()
]

app = FastAPI(
    title="Compressed Symbol Table API",
    version="1.0.0",
    summary="Parses C source and compares a textbook symbol table against a compressed one.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


# --------------------------------------------------------------------------
# Contract models -- the response shape the frontend builds against
# --------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    code: str = Field(..., description="C source text to analyze. Parsed, never executed.")


class Symbol(BaseModel):
    name: str
    type: str
    scope: int
    storage_class: str
    offset: int
    references: int = Field(
        0,
        description="Uses of this declaration, resolved through the compressed table's "
                    "scoped lookup (additive to the locked contract).",
    )


class Ablation(BaseModel):
    trie_only: int
    arena_only: int
    bitpack_only: int
    trie_arena: int
    trie_bitpack: int
    arena_bitpack: int


class Peak(BaseModel):
    """Largest table needed at any point if each scope released its symbols on exit.

    Additive to the locked contract: the whole-program figures above keep
    every declaration; this is what a compiler that frees block scopes needs.
    """

    baseline_bytes: int
    compressed_bytes: int
    savings_pct: float
    live_symbols: int


class AnalyzeResponse(BaseModel):
    baseline_bytes: int
    compressed_bytes: int
    savings_pct: float
    symbol_table: list[Symbol]
    ablation: Ablation
    peak: Peak


# --------------------------------------------------------------------------
# Rate limiting: fixed window per client address, in-process
# --------------------------------------------------------------------------

_hits: dict[str, deque[float]] = defaultdict(deque)


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _check_rate_limit(request: Request) -> None:
    if RATE_LIMIT_REQUESTS <= 0:
        return
    now = time.monotonic()
    window = _hits[_client_key(request)]
    while window and now - window[0] > RATE_LIMIT_WINDOW_SECONDS:
        window.popleft()
    if len(window) >= RATE_LIMIT_REQUESTS:
        raise HTTPException(
            status_code=429,
            detail=f"rate limit is {RATE_LIMIT_REQUESTS} requests per minute",
        )
    window.append(now)
    if len(_hits) > 10000:  # keep the table from growing without bound
        for key in [k for k, v in _hits.items() if not v][:5000]:
            _hits.pop(key, None)


# Bound how many analyzer processes can run at once, so a burst of requests
# cannot spawn an unbounded number of children.
_semaphore = None


def _get_semaphore():
    global _semaphore
    if _semaphore is None:
        import asyncio

        _semaphore = asyncio.Semaphore(MAX_CONCURRENT_ANALYSES)
    return _semaphore


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict:
    """Liveness check that also reports whether the engine binary is present."""
    from engine import engine_path

    try:
        binary = str(engine_path())
        engine_ready = True
    except EngineError as exc:
        binary = exc.detail
        engine_ready = False
    return {"status": "ok", "engine_ready": engine_ready, "engine": binary}


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(payload: AnalyzeRequest, request: Request) -> AnalyzeResponse:
    _check_rate_limit(request)

    size = len(payload.code.encode("utf-8"))
    if size > MAX_CODE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"source is {size} bytes; the limit is {MAX_CODE_BYTES}",
        )

    async with _get_semaphore():
        try:
            result = await analyze_source(payload.code)
        except EngineError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None

    # Return the locked contract plus the additive `peak`; the engine's extra
    # diagnostics ("stats") stay server-side.
    return AnalyzeResponse(
        baseline_bytes=result["baseline_bytes"],
        compressed_bytes=result["compressed_bytes"],
        savings_pct=result["savings_pct"],
        symbol_table=result["symbol_table"],
        ablation=result["ablation"],
        peak=result["peak"],
    )
