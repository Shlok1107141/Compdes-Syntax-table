"""Adversarial end-to-end checks against a running deployment (issue #16).

Black-box: talks HTTP only, stdlib only, so it runs against anything --

    python backend/scripts/adversarial_e2e.py                         # docker compose (nginx)
    python backend/scripts/adversarial_e2e.py http://localhost:8000   # bare uvicorn

The property under test: hostile input never produces a 5xx, never hangs,
and never takes the service down -- every request gets a deliberate answer
(200, or a 4xx that names the problem), and the service is still healthy
at the end. Prints one line per check and exits non-zero on any failure.
"""

from __future__ import annotations

import json
import random
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/api").rstrip("/")
TIMEOUT = 20.0

results: list[tuple[str, bool, str]] = []


def request(method: str, path: str, body: bytes | None = None,
            headers: dict[str, str] | None = None) -> tuple[int, dict, dict, float]:
    """Returns (status, json body or {}, response headers, seconds)."""
    req = urllib.request.Request(BASE + path, data=body, method=method, headers=headers or {})
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw, status, hdrs = resp.read(), resp.status, dict(resp.headers)
    except urllib.error.HTTPError as err:
        raw, status, hdrs = err.read(), err.code, dict(err.headers)
    elapsed = time.monotonic() - start
    try:
        payload = json.loads(raw) if raw else {}
    except ValueError:
        payload = {"_raw": raw[:200].decode("latin-1")}
    return status, payload, {k.lower(): v for k, v in hdrs.items()}, elapsed


def analyze(code: str | None = None, raw: bytes | None = None, **headers: str):
    body = raw if raw is not None else json.dumps({"code": code}).encode()
    return request("POST", "/analyze", body, {"Content-Type": "application/json", **headers})


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  -- {detail}" if detail else ""))


def deliberate(status: int) -> bool:
    """A considered answer: success or a client error, never a server error."""
    return status < 500


def main() -> int:
    print(f"target: {BASE}\n")

    status, body, _, _ = request("GET", "/health")
    check("service is up and the engine is ready", status == 200 and body.get("engine_ready") is True,
          f"HTTP {status} {body}")
    if status != 200:
        return 1

    # ---- malformed requests --------------------------------------------------
    status, body, _, _ = analyze("")
    check("empty source -> 200 with no symbols", status == 200 and body.get("symbol_table") == [],
          f"HTTP {status}")

    status, _, _, _ = analyze(raw=b"{}")
    check("missing 'code' field -> 422", status == 422, f"HTTP {status}")

    status, _, _, _ = analyze(raw=b"this is not json")
    check("non-JSON body -> 422", status == 422, f"HTTP {status}")

    status, _, _, _ = analyze(raw=json.dumps({"code": 12345}).encode())
    check("wrong type for 'code' -> 422", status == 422, f"HTTP {status}")

    status, _, _, _ = request("GET", "/analyze")
    check("GET /analyze -> 405", status == 405, f"HTTP {status}")

    # ---- size limits ---------------------------------------------------------
    status, body, _, _ = analyze("int x;\n" * 11000)          # ~77 KB > 64 KiB
    check("source over 64 KiB -> 413", status == 413, f"HTTP {status} {body.get('detail', '')}")

    status, _, _, _ = analyze("x" * (2 * 1024 * 1024))       # 2 MiB body
    check("2 MiB body -> 413, not a crash", status == 413, f"HTTP {status}")

    status, body, _, _ = analyze("int " + "a" * 300 + ";")
    check("300-character identifier -> 400 naming the problem",
          status == 400 and "identifier" in str(body.get("detail", "")), f"HTTP {status}")

    # ---- hostile content: parsed, never executed -----------------------------
    rng = random.Random(16)
    hostile = {
        "random bytes": bytes(rng.randrange(256) for _ in range(4000)).decode("latin-1"),
        "5000 unclosed braces": "{" * 5000,
        "5000 stray closing braces": "}" * 5000,
        "deep parenthesis nesting": "int x = " + "(" * 5000 + "1" + ")" * 5000 + ";",
        "unterminated comment": "int a; /* never closed " + "x" * 1000,
        "unterminated string": 'char *s = "' + "y" * 1000,
        "NUL and control bytes": "int \x00\x01\x02 x; \x1b[31m int y;",
        "shell metacharacters": "int a; $(rm -rf /); `id`; | cat /etc/passwd > x; int b;",
        "format strings": "int %s%s%s%n%n; int %x;",
        "C that would be dangerous if run": '#include <stdlib.h>\nint main(void){ system("rm -rf /"); for(;;); }',
        "3000 redeclarations of one name": "void f(void){" + "{int x;}" * 3000 + "}",
        "pathological prefix sharing": "".join(f"int {'p' * 200}{i};" for i in range(200)),
    }
    for label, source in hostile.items():
        status, body, _, secs = analyze(source)
        check(f"hostile input: {label} -> deliberate answer in < 10 s",
              deliberate(status) and secs < 10, f"HTTP {status} in {secs:.2f}s")

    status, body, _, _ = analyze(hostile["C that would be dangerous if run"])
    names = [s["name"] for s in body.get("symbol_table", [])]
    check("dangerous C is parsed as data, not run (main is just a symbol)",
          status == 200 and names == ["main"], f"symbols: {names}")

    # ---- CORS ------------------------------------------------------------------
    _, _, hdrs, _ = analyze("int x;", Origin="https://attacker.example")
    check("foreign origin gets no CORS allowance",
          "access-control-allow-origin" not in hdrs, hdrs.get("access-control-allow-origin", ""))

    # ---- concurrency and flooding ---------------------------------------------
    def burst(n: int) -> list[int]:
        with ThreadPoolExecutor(max_workers=n) as pool:
            return list(pool.map(lambda _: analyze("int a; int b; void f(void) { int c; }")[0], range(n)))

    statuses = burst(50)
    check("50 concurrent requests: every answer is 200 or 429, none 5xx",
          all(s in (200, 429) for s in statuses),
          f"200x{statuses.count(200)} 429x{statuses.count(429)} other={[s for s in statuses if s not in (200, 429)]}")

    statuses = [analyze("int z;")[0] for _ in range(60)]
    check("flood of 60 sequential requests is rate-limited (429), not served or crashed",
          429 in statuses and all(s in (200, 429) for s in statuses),
          f"200x{statuses.count(200)} 429x{statuses.count(429)}")

    status, body, _, _ = request("GET", "/health")
    check("service still healthy after the attack", status == 200 and body.get("engine_ready") is True,
          f"HTTP {status}")

    failed = [name for name, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
