"""Live link to an Arduino Uno running firmware/uno_bench.

The Uno has 2 KB of RAM and no C lexer, so the PC parses the code (the same
engine as /analyze) and sends the declarations to the board one at a time;
the board inserts each into the structure it was flashed with and reports
what that cost (see the LIVE commands in firmware/uno_bench/src/bench.c).

Opening the port resets an Uno, and it ignores input for ~2 s while the
bootloader runs, so one connection is opened once and kept. One lock makes
sure only one request talks to the board at a time.
"""

from __future__ import annotations

import re
import threading
import time
from typing import Any, Callable, Iterable, Optional

BAUD = 115200
READY = "# uno_bench ready"
NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,31}$")   # firmware NAME_MAX_LEN = 32
MAX_LIVE_SYMBOLS = 200

# USB IDs of boards people plug in for this project.
KNOWN_BOARDS = {
    (0x1A86, 0x7523): "Arduino Uno compatible (CH340)",
    (0x2341, None): "Arduino",
    (0x2A03, None): "Arduino",
    (0x10C4, 0xEA60): "CP210x (ESP32 dev boards)",
    (0x0403, 0x6001): "FTDI serial",
}

# AVR model of the textbook baseline, in bytes (ATmega328P, avr-libc):
#   64 bucket pointers x 2 B, then per symbol one 12 B node (2 pointers + 4 ints
#   of 2 B) and one name string, each malloc block carrying a 2 B header.
# backend/tests/test_hardware_uno.py checks it against every baseline row the
# board measured (firmware/results/uno_mem.csv).
AVR_BUCKETS = 64 * 2
AVR_NODE = 12 + 2
AVR_STRING_EXTRA = 1 + 2


def avr_baseline_bytes(names: Iterable[str]) -> int:
    return AVR_BUCKETS + sum(AVR_NODE + len(n) + AVR_STRING_EXTRA for n in names)


class UnoError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _comports():
    import serial.tools.list_ports

    return list(serial.tools.list_ports.comports())


def list_ports() -> list[dict[str, Any]]:
    out = []
    for p in _comports():
        board = None
        if p.vid is not None:
            board = KNOWN_BOARDS.get((p.vid, p.pid)) or KNOWN_BOARDS.get((p.vid, None))
        out.append({
            "device": p.device,
            "description": p.description,
            "vid_pid": f"{p.vid:04X}:{p.pid:04X}" if p.vid is not None else None,
            "likely_board": board,
        })
    return out


def check_port(port: str) -> str:
    """Only ports the OS lists are accepted, never an arbitrary path."""
    devices = {p["device"].upper(): p["device"] for p in list_ports()}
    if port.upper() not in devices:
        raise UnoError(400, f"no serial port named {port!r}; found: {', '.join(devices.values()) or 'none'}")
    return devices[port.upper()]


class UnoSession:
    """One open connection to the board. Callers hold `lock` around every use."""

    def __init__(self, opener: Optional[Callable[..., Any]] = None):
        self.lock = threading.Lock()
        self._opener = opener
        self._ser = None
        self._port: Optional[str] = None

    @property
    def port(self) -> Optional[str]:
        return self._port if self._ser is not None else None

    def close(self) -> None:
        if self._ser is not None:
            try:
                self._ser.close()
            except Exception:  # noqa: BLE001 - closing a dead port must not fail
                pass
        self._ser, self._port = None, None

    def _open(self, port: str) -> None:
        import serial

        self.close()
        opener = self._opener or serial.Serial
        try:
            self._ser = opener(port, BAUD, timeout=0.5)
        except (serial.SerialException, OSError) as exc:
            text = str(exc)
            if "denied" in text.lower() or "busy" in text.lower() or "PermissionError" in text:
                raise UnoError(409, f"{port} is in use: close the Arduino IDE Serial Monitor, "
                                    "collect.py or flash.py, then retry") from None
            raise UnoError(502, f"could not open {port}: {text}") from None
        self._port = port
        self._read_until(READY, 8.0, f"no uno_bench firmware answered on {port}: "
                                     "flash it with python firmware/tools/flash.py ABC --port " + port)

    def _read_until(self, marker: str, timeout: float, error: str) -> list[str]:
        lines, end = [], time.monotonic() + timeout
        try:
            while time.monotonic() < end:
                raw = self._ser.readline()
                if not raw:
                    continue
                line = raw.decode("ascii", errors="replace").strip()
                if line.startswith(marker):
                    return lines
                if marker != READY and line.startswith(READY):
                    raise _Restarted()        # reset button: the command was lost
                if line:
                    lines.append(line)
        except _Restarted:
            raise
        except Exception as exc:  # noqa: BLE001 - unplugged mid-read
            self.close()
            raise UnoError(502, f"lost the board: {exc}") from None
        self.close()
        raise UnoError(504, error)

    def connect(self, port: str) -> None:
        if self._ser is None or self._port != port:
            self._open(port)

    def reset(self, port: str) -> None:
        """Close and reopen: the Uno resets (its RAM, and any table in it, is gone)."""
        self.close()
        self._open(port)

    def command(self, port: str, line: str, timeout: float = 3.0) -> list[str]:
        """Send one command; return the lines it printed before DONE. If the
        board restarts meanwhile (reset button), send it once more."""
        self.connect(port)
        for attempt in range(2):
            try:
                self._ser.reset_input_buffer()
                self._ser.write((line + "\n").encode("ascii"))
            except Exception as exc:  # noqa: BLE001
                self.close()
                raise UnoError(502, f"lost the board: {exc}") from None
            try:
                return self._read_until("DONE", timeout,
                                        f"the board did not answer {line.split()[0]!r} in {timeout:.0f} s")
            except _Restarted:
                if attempt:
                    raise UnoError(502, "the board keeps restarting") from None
        raise AssertionError("unreachable")


class _Restarted(Exception):
    """The board printed its start-up banner in the middle of a command."""


SESSION = UnoSession()


# ---------------------------------------------------------------- parsing ---

def _live_rows(lines: list[str], kind: str) -> list[list[str]]:
    return [ln.split(",") for ln in lines if ln.startswith(f"LIVE,{kind},")]


def _live_error(lines: list[str]) -> Optional[str]:
    rows = _live_rows(lines, "ERROR")
    return rows[0][2] if rows else None


def status(session: UnoSession, port: str) -> dict[str, Any]:
    import json

    lines = session.command(port, "PING")
    for ln in lines:
        if ln.startswith("{"):
            ping = json.loads(ln)
            if ping.get("firmware") != "uno_bench":
                break
            return {"status": "ONLINE", "port": port, "variant": ping.get("variant"),
                    "clock_mhz": ping.get("clock_mhz"), "free_ram": ping.get("free_heap"),
                    "static_ram": ping.get("static_ram"), "live_symbols": ping.get("live_symbols", 0)}
    raise UnoError(502, f"{port} answered, but not with the uno_bench firmware")


def decode_symbols(symbol_table: list[dict]) -> tuple[list[dict], list[dict]]:
    """Engine symbols -> what the board gets (fields from the packed word), and those skipped."""
    sent, skipped = [], []
    for s in symbol_table:
        if not NAME_RE.match(s["name"]):
            skipped.append({"name": s["name"], "reason": "name longer than 32 characters"})
            continue
        if len(sent) >= MAX_LIVE_SYMBOLS:
            skipped.append({"name": s["name"], "reason": f"more than {MAX_LIVE_SYMBOLS} symbols"})
            continue
        p = s["packed"]
        sent.append({"name": s["name"], "type": s["type"], "scope": s["scope"],
                     "storage_class": s["storage_class"], "offset": s["offset"],
                     "fields": ((p >> 28) & 0xF, (p >> 20) & 0xFF, (p >> 16) & 0xF, p & 0xFFFF)})
    return sent, skipped


def live_ready(session: UnoSession, port: str) -> dict[str, Any]:
    rows = _live_rows(session.command(port, "LIVE"), "READY")
    if not rows:
        raise UnoError(502, "the board did not start a live session")
    _, _, variant, free_ram, static_ram, budget = rows[0]
    return {"variant": variant, "free_ram": int(free_ram), "static_ram": int(static_ram), "budget": int(budget)}


def live_insert(session: UnoSession, port: str, sym: dict) -> dict[str, Any]:
    t, sc, st, off = sym["fields"]
    lines = session.command(port, f"SYM {t} {sc} {st} {off} {sym['name']}")
    rows = _live_rows(lines, "SYM")
    if not rows:
        raise UnoError(502, f"the board rejected {sym['name']!r}: {_live_error(lines) or 'no reply'}")
    _, _, n, name, result, table, heap, free_ram, us, verified, packed = rows[0]
    return {"stored": int(n), "name": name, "result": result, "table_bytes": int(table),
            "heap_bytes": int(heap), "free_ram": int(free_ram), "insert_us": int(us),
            "verified": verified == "1", "packed_hex": packed}


def live_end(session: UnoSession, port: str) -> dict[str, Any]:
    rows = _live_rows(session.command(port, "END"), "DONE")
    if not rows:
        raise UnoError(502, "the board did not finish the live session")
    _, _, n, table, heap, free_ram, stop = rows[0]
    return {"stored": int(n), "table_bytes": int(table), "heap_bytes": int(heap),
            "free_ram": int(free_ram), "stopped": stop}


def lookup(session: UnoSession, port: str, name: str) -> dict[str, Any]:
    if not NAME_RE.match(name):
        raise UnoError(400, "not an identifier of at most 32 characters")
    lines = session.command(port, f"LOOKUP {name}")
    rows = _live_rows(lines, "LOOKUP")
    if not rows:
        if _live_error(lines) == "no_session":
            raise UnoError(409, "no table on the board: run some code or load a saved one first")
        raise UnoError(502, "the board did not answer the lookup")
    _, _, got, found, decls = rows[0]
    return {"name": got, "found": found == "FOUND", "declarations": int(decls) if int(decls) >= 0 else None}


def save(session: UnoSession, port: str) -> dict[str, Any]:
    lines = session.command(port, "SAVE", timeout=12.0)   # EEPROM writes take ~3 ms a byte
    rows = _live_rows(lines, "SAVED")
    if not rows:
        err = _live_error(lines) or "no reply"
        msgs = {"no_session": "no table on the board to save",
                "no_persistence": "this firmware build cannot save (only baseline and ABC can)"}
        if err == "too_big":
            r = _live_rows(lines, "ERROR")[0]
            raise UnoError(409, f"the table needs {r[3]} B; the EEPROM holds {r[4]} B")
        raise UnoError(409, msgs.get(err, err))
    _, _, n, snap, table, us = rows[0]
    return {"symbols": int(n), "snapshot_bytes": int(snap), "table_bytes": int(table), "save_ms": int(us) / 1000}


def load(session: UnoSession, port: str) -> dict[str, Any]:
    lines = session.command(port, "LOAD", timeout=5.0)
    rows = _live_rows(lines, "LOADED")
    if not rows:
        err = _live_error(lines) or "no reply"
        msgs = {"no_snapshot": "no saved table for this firmware build in EEPROM",
                "no_persistence": "this firmware build cannot load (only baseline and ABC can)"}
        raise UnoError(409, msgs.get(err, err))
    _, _, n, snap, table, us = rows[0]
    return {"symbols": int(n), "snapshot_bytes": int(snap), "table_bytes": int(table), "load_ms": int(us) / 1000}
