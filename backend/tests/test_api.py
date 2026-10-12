"""API tests: the locked /analyze contract and the limits that guard it."""

from __future__ import annotations

import main

from conftest import SAMPLE_SOURCE

CONTRACT_KEYS = {"baseline_bytes", "compressed_bytes", "savings_pct", "symbol_table", "ablation", "peak"}


def test_health_reports_a_ready_engine(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["engine_ready"] is True


def test_analyze_returns_exactly_the_contract(client):
    response = client.post("/analyze", json={"code": SAMPLE_SOURCE})
    assert response.status_code == 200

    body = response.json()
    assert set(body) == CONTRACT_KEYS

    assert isinstance(body["baseline_bytes"], int)
    assert isinstance(body["compressed_bytes"], int)
    assert isinstance(body["savings_pct"], float)
    assert set(body["symbol_table"][0]) == {"name", "type", "scope", "storage_class", "offset"}
    assert set(body["ablation"]) == {
        "trie_only", "arena_only", "bitpack_only",
        "trie_arena", "trie_bitpack", "arena_bitpack",
    }


def test_analyze_accepts_empty_source(client):
    body = client.post("/analyze", json={"code": ""}).json()
    assert body["symbol_table"] == []


def test_missing_code_field_is_rejected(client):
    assert client.post("/analyze", json={}).status_code == 422
    assert client.post("/analyze", json={"code": 42}).status_code == 422


def test_oversized_source_is_rejected(client, monkeypatch):
    monkeypatch.setattr(main, "MAX_CODE_BYTES", 1024)
    response = client.post("/analyze", json={"code": "int x;\n" * 500})
    assert response.status_code == 413
    assert "limit" in response.json()["detail"]


def test_engine_rejection_becomes_a_client_error(client):
    response = client.post("/analyze", json={"code": "int " + "a" * 300 + ";"})
    assert response.status_code == 400
    assert "identifier" in response.json()["detail"]


def test_garbage_input_still_answers(client):
    response = client.post("/analyze", json={"code": "@@@ }}} ;;; \x01\x02 int x;"})
    assert response.status_code == 200
    assert response.json()["symbol_table"][0]["name"] == "x"


def test_rate_limit_returns_429(client, monkeypatch):
    monkeypatch.setattr(main, "RATE_LIMIT_REQUESTS", 3)
    main._hits.clear()

    for _ in range(3):
        assert client.post("/analyze", json={"code": "int x;"}).status_code == 200

    blocked = client.post("/analyze", json={"code": "int x;"})
    assert blocked.status_code == 429
    assert "rate limit" in blocked.json()["detail"]


def test_cors_allows_the_frontend_origin_only(client):
    allowed = client.post(
        "/analyze",
        json={"code": "int x;"},
        headers={"Origin": "http://localhost:5173"},
    )
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:5173"

    other = client.post(
        "/analyze",
        json={"code": "int x;"},
        headers={"Origin": "https://evil.example"},
    )
    assert "access-control-allow-origin" not in other.headers


def test_concurrent_requests_all_succeed(client, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    monkeypatch.setattr(main, "RATE_LIMIT_REQUESTS", 0)   # disable for this test

    def post(_: int):
        return client.post("/analyze", json={"code": SAMPLE_SOURCE}).status_code

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert list(pool.map(post, range(8))) == [200] * 8
