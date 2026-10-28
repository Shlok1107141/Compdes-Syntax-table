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

from typing import Optional

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
    packed: int = Field(
        0,
        description="The 32-bit metadata word the compressed table stores: "
                    "type(4) | scope(8) | storage_class(4) | offset(16), high bits first.",
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

# Behind the bundled nginx (docker-compose) every request arrives from the
# proxy's address, so per-client limits would collapse into one shared bucket.
# nginx overwrites X-Real-IP with the real peer address, so the header is
# trusted only when this flag says a proxy we control is in front.
TRUST_PROXY_HEADERS = os.environ.get("SYMTAB_TRUST_PROXY_HEADERS") == "1"


def _client_key(request: Request) -> str:
    if TRUST_PROXY_HEADERS:
        real_ip = request.headers.get("x-real-ip", "").strip()
        if real_ip:
            return real_ip
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


@app.get("/syntax-table/benchmark")
async def get_syntax_table_benchmark() -> dict:
    """Returns comprehensive 6-pillar benchmark data across parse table algorithms and grammars."""
    from syntax_engine import SyntaxEngineError, run_syntax_benchmarks

    try:
        return await run_syntax_benchmarks()
    except SyntaxEngineError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None


class HardwareAnalyzePayload(BaseModel):
    code: Optional[str] = Field(default=None, description="C code snippet to analyze on ESP32")
    port: str = Field(default="COM6", description="Serial COM port")


@app.get("/hardware/status")
async def get_hardware_telemetry_status(port: str = "COM6") -> dict:
    """Probes physical ESP32 on the specified COM port and checks firmware beacon."""
    from hardware_bridge import get_hardware_status

    return get_hardware_status(port=port)


@app.post("/hardware/analyze")
async def post_hardware_analyze(payload: HardwareAnalyzePayload) -> dict:
    """Streams C code to physical ESP32 over serial and returns live hardware metrics."""
    from hardware_bridge import analyze_code_on_esp32

    return analyze_code_on_esp32(code=payload.code, port=payload.port)


# --------------------------------------------------------------------------
# Arduino Uno, live (firmware/uno_bench, see backend/hardware_uno.py). Works
# only when this backend runs on the computer the board is plugged into.
# --------------------------------------------------------------------------

class UnoPortRequest(BaseModel):
    port: str = Field(..., max_length=64, description="Serial port the OS lists, e.g. COM3")


class UnoLiveRequest(UnoPortRequest):
    code: str = Field(..., description="C source; parsed here, its declarations sent to the board")
    delay_ms: int = Field(120, ge=0, le=1000, description="Pause between symbols, so people can watch")


class UnoLookupRequest(UnoPortRequest):
    name: str = Field(..., max_length=64)


def _uno_call(port: str, fn, *args):
    """One exchange with the board, under its lock; board errors become HTTP errors."""
    from hardware_uno import SESSION, UnoError, check_port

    try:
        port = check_port(port)
    except UnoError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None
    if not SESSION.lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="the board is busy with another request")
    try:
        return fn(SESSION, port, *args)
    except UnoError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None
    finally:
        SESSION.lock.release()


@app.get("/hardware/ports")
def hardware_ports() -> dict:
    """Serial ports on this computer, with a guess at what is plugged into each."""
    from hardware_uno import SESSION, list_ports

    return {"ports": list_ports(), "connected": SESSION.port}


@app.get("/hardware/uno/status")
def uno_status(port: str) -> dict:
    from hardware_uno import status

    return _uno_call(port, status)


@app.post("/hardware/uno/lookup")
def uno_lookup(payload: UnoLookupRequest) -> dict:
    from hardware_uno import lookup

    return _uno_call(payload.port, lookup, payload.name)


@app.post("/hardware/uno/save")
def uno_save(payload: UnoPortRequest) -> dict:
    from hardware_uno import save

    return _uno_call(payload.port, save)


@app.post("/hardware/uno/load")
def uno_load(payload: UnoPortRequest) -> dict:
    from hardware_uno import load

    return _uno_call(payload.port, load)


@app.post("/hardware/uno/reset")
def uno_reset(payload: UnoPortRequest) -> dict:
    """Reopen the port, which resets the Uno: its RAM (and the table in it) is cleared."""
    from hardware_uno import status

    def reset_then_status(session, port):
        session.reset(port)
        return status(session, port)

    return _uno_call(payload.port, reset_then_status)


@app.post("/hardware/uno/disconnect")
def uno_disconnect() -> dict:
    """Release the port, e.g. so flash.py can upload new firmware."""
    from hardware_uno import SESSION

    if not SESSION.lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="the board is busy with another request")
    try:
        SESSION.close()
    finally:
        SESSION.lock.release()
    return {"connected": None}


@app.post("/hardware/uno/live")
async def uno_live(payload: UnoLiveRequest, request: Request):
    """Parse the code, then insert its declarations on the board one by one.

    Streams newline-delimited JSON events: start, symbol (one per declaration,
    with what the board reported), done, or error. Every byte count in them
    comes from the board, except avr_baseline_model_bytes (see hardware_uno).
    """
    import asyncio
    import json

    from fastapi.responses import StreamingResponse
    from starlette.concurrency import run_in_threadpool

    from hardware_uno import (SESSION, UnoError, avr_baseline_bytes, check_port, decode_symbols,
                              live_end, live_insert, live_ready)

    _check_rate_limit(request)
    size = len(payload.code.encode("utf-8"))
    if size > MAX_CODE_BYTES:
        raise HTTPException(status_code=413, detail=f"source is {size} bytes; the limit is {MAX_CODE_BYTES}")
    try:
        port = check_port(payload.port)
    except UnoError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None
    if SESSION.lock.locked():
        raise HTTPException(status_code=409, detail="the board is busy with another request")
    async with _get_semaphore():
        try:
            result = await analyze_source(payload.code)
        except EngineError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None
    symbols, skipped = decode_symbols(result["symbol_table"])

    def line(event: dict) -> bytes:
        return (json.dumps(event) + "\n").encode()

    async def events():
        # The lock is taken here, not in the endpoint, so a stream that never
        # starts cannot leave the board locked.
        if not SESSION.lock.acquire(blocking=False):
            yield line({"event": "error", "status": 409, "detail": "the board is busy with another request"})
            return
        try:
            ready = await run_in_threadpool(live_ready, SESSION, port)
            yield line({"event": "start", "port": port, **ready, "total": len(symbols), "skipped": skipped,
                        "pc": {"baseline_bytes": result["baseline_bytes"],
                               "compressed_bytes": result["compressed_bytes"],
                               "savings_pct": result["savings_pct"]}})
            for i, sym in enumerate(symbols):
                board = await run_in_threadpool(live_insert, SESSION, port, sym)
                info = {k: sym[k] for k in ("name", "type", "scope", "storage_class", "offset")}
                yield line({"event": "symbol", "index": i, **info, **board})
                if payload.delay_ms:
                    await asyncio.sleep(payload.delay_ms / 1000)
            done = await run_in_threadpool(live_end, SESSION, port)
            stored = [s["name"] for s in symbols[:done["stored"]]]
            model = avr_baseline_bytes(stored) if stored else None
            saving = (round(100 * (1 - done["table_bytes"] / model), 2)
                      if model and ready["variant"] != "baseline" else None)
            yield line({"event": "done", **done, "variant": ready["variant"], "total": len(symbols),
                        "refused": len(symbols) - done["stored"],
                        "avr_baseline_model_bytes": model, "saving_vs_model_pct": saving})
        except UnoError as exc:
            yield line({"event": "error", "status": exc.status_code, "detail": exc.detail})
        finally:
            SESSION.lock.release()

    return StreamingResponse(events(), media_type="application/x-ndjson")


