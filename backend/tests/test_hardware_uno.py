"""Live Arduino Uno endpoints, against a fake board that speaks the
firmware/uno_bench protocol (no hardware needed). The AVR baseline model is
checked against what the real board measured (firmware/results/uno_mem.csv)."""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

import hardware_uno
from hardware_uno import UnoSession, avr_baseline_bytes

ROOT = Path(__file__).resolve().parents[2]
PORT = "FAKE0"


class FakeBoard:
    """Answers like uno_bench: holds `capacity` symbols, then refuses the rest."""

    def __init__(self, capacity: int = 1000, variant: str = "ABC"):
        self.capacity, self.variant = capacity, variant
        self.out = [b"# uno_bench ready. Commands: ...\r\n"]
        self.live: list[str] | None = None
        self.saved: list[str] | None = None
        self.stopped = False
        self.restart_on_next_write = False

    # the part of pyserial's Serial that UnoSession uses
    def readline(self) -> bytes:
        return self.out.pop(0) if self.out else b""

    def reset_input_buffer(self) -> None:
        self.out.clear()

    def close(self) -> None:
        pass

    def write(self, data: bytes) -> None:
        if self.restart_on_next_write:          # reset button: the board reboots, the command is lost
            self.restart_on_next_write = False
            self.live = None
            self.out.append(b"# uno_bench ready. Commands: ...\r\n")
            return
        for row in self.reply(data.decode().strip()):
            self.out.append(row.encode() + b"\r\n")
        self.out.append(b"DONE\r\n")

    def reply(self, cmd: str) -> list[str]:
        if cmd == "PING":
            return [json.dumps({"status": "PONG", "firmware": "uno_bench", "variant": self.variant,
                                "clock_mhz": 16, "free_heap": 400, "static_ram": 1547, "live_symbols": 0})]
        if cmd == "LIVE":
            self.live, self.stopped = [], False
            return [f"LIVE,READY,{self.variant},400,1547,1200"]
        if self.live is None and cmd != "LOAD":
            return ["LIVE,ERROR,no_session"]
        if cmd.startswith("SYM "):
            t, sc, st, off, name = cmd[4:].split()
            ok = not self.stopped and len(self.live) < self.capacity
            if ok:
                self.live.append(name)
            else:
                self.stopped = True
            packed = (int(t) << 28) | (int(sc) << 20) | (int(st) << 16) | int(off)
            return [f"LIVE,SYM,{len(self.live)},{name},{'ok' if ok else 'arena_full'},"
                    f"{20 * len(self.live)},0,{400 - 20 * len(self.live)},84,{int(ok)},{packed:08X}"]
        if cmd == "END":
            return [f"LIVE,DONE,{len(self.live)},{20 * len(self.live)},0,300,"
                    f"{'arena_full' if self.stopped else 'none'}"]
        if cmd.startswith("LOOKUP "):
            name = cmd[7:]
            return [f"LIVE,LOOKUP,{name},{'FOUND' if name in self.live else 'ABSENT'},{self.live.count(name)}"]
        if cmd == "SAVE":
            self.saved = list(self.live)
            return [f"LIVE,SAVED,{len(self.live)},{10 + 20 * len(self.live)},{20 * len(self.live)},1500000"]
        if cmd == "LOAD":
            if self.saved == "benchmark":           # what collect.py's SAVE <set> leaves behind
                return ["CSV,LOAD,ABC,proto30,30,677,5220,1,669,1"]
            if self.saved is None:
                return ["LIVE,ERROR,no_snapshot"]
            self.live = list(self.saved)
            return [f"LIVE,LOADED,{len(self.live)},{10 + 20 * len(self.live)},{20 * len(self.live)},5200"]
        return []


@pytest.fixture
def board(monkeypatch: pytest.MonkeyPatch) -> FakeBoard:
    fake = FakeBoard()
    port = SimpleNamespace(device=PORT, description="USB-SERIAL CH340 (FAKE0)", vid=0x1A86, pid=0x7523)
    monkeypatch.setattr(hardware_uno, "_comports", lambda: [port])
    monkeypatch.setattr(hardware_uno, "SESSION", UnoSession(opener=lambda *a, **k: fake))
    return fake


def stream(client, code: str) -> list[dict]:
    r = client.post("/hardware/uno/live", json={"code": code, "port": PORT, "delay_ms": 0})
    assert r.status_code == 200, r.text
    return [json.loads(line) for line in r.text.splitlines() if line.strip()]


def test_ports_lists_the_board(client, board):
    data = client.get("/hardware/ports").json()
    assert data["ports"][0]["device"] == PORT
    assert data["ports"][0]["likely_board"] == "Arduino Uno compatible (CH340)"


def test_unknown_port_is_rejected(client, board):
    assert client.get("/hardware/uno/status", params={"port": "COM99"}).status_code == 400
    assert client.post("/hardware/uno/live", json={"code": "int a;", "port": "/dev/sda"}).status_code == 400


def test_status_reads_the_firmware(client, board):
    data = client.get("/hardware/uno/status", params={"port": PORT}).json()
    assert data["status"] == "ONLINE" and data["variant"] == "ABC" and data["static_ram"] == 1547


def test_live_stream_sends_every_declaration_in_order(client, board):
    events = stream(client, "int alpha; int beta; void f(void) { int gamma; }")
    kinds = [e["event"] for e in events]
    assert kinds[0] == "start" and kinds[-1] == "done" and set(kinds[1:-1]) == {"symbol"}
    names = [e["name"] for e in events if e["event"] == "symbol"]
    assert names == board.live                      # the board received exactly these, in order
    assert all(e["result"] == "ok" and e["verified"] for e in events if e["event"] == "symbol")
    done = events[-1]
    assert done["stored"] == done["total"] == len(names) and done["refused"] == 0
    assert done["avr_baseline_model_bytes"] == avr_baseline_bytes(names)
    assert events[0]["pc"]["baseline_bytes"] > 0


def test_refusal_stops_the_table(client, board):
    board.capacity = 2
    events = stream(client, "int a1; int a2; int a3; int a4;")
    results = [e["result"] for e in events if e["event"] == "symbol"]
    assert results == ["ok", "ok", "arena_full", "arena_full"]
    done = events[-1]
    assert done["stored"] == 2 and done["refused"] == 2 and done["stopped"] == "arena_full"
    assert done["avr_baseline_model_bytes"] == avr_baseline_bytes(["a1", "a2"])


def test_busy_board_answers_409(client, board):
    hardware_uno.SESSION.lock.acquire()
    try:
        assert client.get("/hardware/uno/status", params={"port": PORT}).status_code == 409
        assert client.post("/hardware/uno/live", json={"code": "int a;", "port": PORT}).status_code == 409
    finally:
        hardware_uno.SESSION.lock.release()


def test_lookup_save_load_round_trip(client, board):
    stream(client, "int counter; int counter_max;")
    assert client.post("/hardware/uno/lookup", json={"port": PORT, "name": "counter_max"}).json()["found"]
    assert not client.post("/hardware/uno/lookup", json={"port": PORT, "name": "count"}).json()["found"]
    assert client.post("/hardware/uno/save", json={"port": PORT}).json()["symbols"] == 2
    board.live = None                                # as if the board were reset
    assert client.post("/hardware/uno/lookup", json={"port": PORT, "name": "counter"}).status_code == 409
    assert client.post("/hardware/uno/load", json={"port": PORT}).json()["symbols"] == 2
    assert client.post("/hardware/uno/lookup", json={"port": PORT, "name": "counter"}).json()["found"]


def test_command_lost_to_a_reset_is_sent_again(client, board):
    stream(client, "int counter;")
    assert client.post("/hardware/uno/save", json={"port": PORT}).status_code == 200
    board.restart_on_next_write = True              # someone presses the reset button
    r = client.post("/hardware/uno/load", json={"port": PORT})
    assert r.status_code == 200 and r.json()["symbols"] == 1
    assert client.post("/hardware/uno/lookup", json={"port": PORT, "name": "counter"}).json()["found"]


def test_load_explains_a_benchmark_snapshot(client, board):
    board.saved = "benchmark"
    r = client.post("/hardware/uno/load", json={"port": PORT})
    assert r.status_code == 409 and "collect.py" in r.json()["detail"]


def test_bad_lookup_name_is_rejected(client, board):
    stream(client, "int a;")
    r = client.post("/hardware/uno/lookup", json={"port": PORT, "name": "a b"})
    assert r.status_code == 400


def _uno_workloads() -> dict[str, list[str]]:
    """Symbol names of each set the board ran, from the sketch's generated workloads.h."""
    text = (ROOT / "firmware" / "uno_bench" / "src" / "workloads.h").read_text()
    labels = dict(re.findall(r'WL_(\d+)_LABEL\[\] PROGMEM = "(\w+)"', text))
    sets = {}
    for idx, body in re.findall(r"WL_(\d+)\[\] PROGMEM = \{(.*?)\};", text, re.S):
        sets[labels[idx]] = ["".join(re.findall(r"'(.)'", ln)) for ln in body.strip().splitlines()]
    return sets


def test_avr_baseline_model_matches_the_board():
    """The model equals the baseline the Uno measured, for every set it ran."""
    sets = _uno_workloads()
    rows = [r for r in csv.DictReader((ROOT / "firmware" / "results" / "uno_mem.csv").open())
            if r["variant"] == "baseline"]
    assert len(rows) == 5
    for r in rows:
        names = sets[r["workload"]][: int(r["inserted"])]
        assert avr_baseline_bytes(names) == int(r["modelled_bytes"]) == int(r["heap_bytes"]) + 128, r["workload"]
