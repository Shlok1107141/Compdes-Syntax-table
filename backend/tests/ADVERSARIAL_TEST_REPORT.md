# Adversarial End-to-End Test Suite Execution Log (Issue #16)

> **BCSE307L — Compiler Design Team Project: Compressed Symbol Table (`DenseSym`)**  
> **Lead QA / Security Auditor**: Eben (`@Eben923`)  
> **Target Service**: FastAPI Subprocess Harness (`POST /analyze`, `GET /health`)  
> **Execution Date**: 2026-10-13  
> **Environment**: Ubuntu 24.04 LTS (WSL2), GCC 15.2.0 (`-fsanitize=address,undefined`), Python 3.11, Uvicorn ASGI  

---

## 1. Executive Summary

This test log documents the adversarial validation and stress testing of the `DenseSym` compiler engine and FastAPI backend service (Issue #16). The testing strategy enforces a strict black-box HTTP security and robustness perimeter: **hostile input must never produce an unhandled exception (HTTP 5xx), must never cause denial of service or hang, must never trigger sanitizer faults (ASan/UBSan), and must always yield a deliberate response (HTTP 200, or a structured 4xx naming the issue)**.

All **26/26 adversarial test checks passed with zero failures (100% pass rate)**.

---

## 2. Test Suite Specifications & Outcomes

### Suite 1: Empty and Malformed Requests
*Objective*: Verify that malformed HTTP requests and invalid JSON contracts are trapped at the API perimeter before reaching the native subprocess parser.

| Test ID | Input Payload Description | Expected Status | Actual Status | Latency | Result |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `TC-1.1` | Service Health Probe (`GET /health`) | `200 OK` | `200 OK` | 0.002s | **PASS** |
| `TC-1.2` | Empty Source Text (`{"code": ""}`) | `200 OK` (`[]` symbols) | `200 OK` | 0.003s | **PASS** |
| `TC-1.3` | Missing `code` field (`{}`) | `422 Unprocessable` | `422 Unprocessable` | 0.001s | **PASS** |
| `TC-1.4` | Non-JSON Raw Body (`this is not json`) | `422 Unprocessable` | `422 Unprocessable` | 0.001s | **PASS** |
| `TC-1.5` | Non-String Field Type (`{"code": 12345}`) | `422 Unprocessable` | `422 Unprocessable` | 0.001s | **PASS** |
| `TC-1.6` | Disallowed Method (`GET /analyze`) | `405 Method Not Allowed` | `405 Method Not Allowed` | 0.001s | **PASS** |

---

### Suite 2: Size & Payload Limits
*Objective*: Ensure the backend enforces memory and request bounds to protect against memory exhaustion attacks.

| Test ID | Input Payload Description | Expected Status | Actual Status | Details | Result |
| :--- | :--- | :---: | :---: | :--- | :---: |
| `TC-2.1` | Payload exceeding 64 KiB ceiling (~77 KB source) | `413 Payload Too Large` | `413 Payload Too Large` | `source is 77000 bytes; limit is 65536` | **PASS** |
| `TC-2.2` | Large 2 MiB request body flood | `413 Payload Too Large` | `413 Payload Too Large` | Rejected prior to process spawn | **PASS** |
| `TC-2.3` | Pathological 300-character identifier | `400 Bad Request` | `400 Bad Request` | Engine rejected oversized identifier | **PASS** |

---

### Suite 3: Hostile, Garbage & Adversarial Syntax (Fuzzing)
*Objective*: Supply deliberately corrupted syntax, binary streams, and potentially hostile C constructs to verify that the C lexer/parser processes input strictly as static read-only AST data without crashes, infinite loops, or buffer overflows.

| Test ID | Hostile Pattern | Input Characteristics | Expected Behavior | Actual Outcome | Result |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `TC-3.1` | Random Bytes | 4,000 random non-ASCII binary bytes | Clean parser termination, `< 10s` | `HTTP 200` in 0.01s, 0 crashes | **PASS** |
| `TC-3.2` | Unclosed Braces | 5,000 consecutive `{` | Graceful EOF handling | `HTTP 200` in 0.01s | **PASS** |
| `TC-3.3` | Stray Closing Braces | 5,000 consecutive `}` | Scope counter floor clamped at 0 | `HTTP 200` in 0.01s | **PASS** |
| `TC-3.4` | Deep Parenthesis Nesting | `int x = (((...1...)));` (5,000 deep) | Deterministic stack handling | `HTTP 200` in 0.01s | **PASS** |
| `TC-3.5` | Unterminated Comment | `int a; /* never closed` + 1,000 chars | Clean EOF comment termination | `HTTP 200` in 0.01s | **PASS** |
| `TC-3.6` | Unterminated String | `char *s = "` + 1,000 chars | Lexer string scan bounds hold | `HTTP 200` in 0.01s | **PASS** |
| `TC-3.7` | NUL and Control Bytes | `\x00\x01\x02`, ANSI escape sequences | Stream sanitized without corruption | `HTTP 200` in 0.01s | **PASS** |
| `TC-3.8` | Shell Metacharacters | `$(rm -rf /); \`id\`; \| cat /etc/passwd` | No subshell spawned; parsed as tokens | `HTTP 200` in 0.01s | **PASS** |
| `TC-3.9` | Format Strings | `%s%s%s%n%n; %x;` | Not passed to `printf` format slot | `HTTP 200` in 0.01s | **PASS** |
| `TC-3.10`| Hostile C Payloads | `system("rm -rf /"); for(;;);` | Static analysis only; code never run | `HTTP 200`, `symbols=['main']` | **PASS** |
| `TC-3.11`| Massive Redeclarations | 3,000 redeclarations of `x` across scopes | Shadow chain and arena pool intact | `HTTP 200` in 0.10s | **PASS** |
| `TC-3.12`| Pathological Prefix Sharing | 200 identifiers sharing 200-char prefix | Trie edge splitting verified | `HTTP 200` in 0.02s | **PASS** |

---

### Suite 4: Concurrency, Flooding & Security Boundaries
*Objective*: Validate subprocess worker concurrency limits, client rate-limiting, and CORS origin restrictions.

| Test ID | Test Scenario | Execution Vector | Measured Outcome | Result |
| :--- | :--- | :--- | :--- | :---: |
| `TC-4.1` | CORS Origin Restriction | Header `Origin: https://attacker.example` | No `Access-Control-Allow-Origin` header emitted | **PASS** |
| `TC-4.2` | 50 Concurrent Burst Requests | Parallel thread pool dispatching `/analyze` | 100% responses are `200` or `429` (0 server 5xx errors) | **PASS** |
| `TC-4.3` | High-Frequency Request Flood | 60 rapid sequential `/analyze` calls | Rate limiter activates (`HTTP 429`), zero crashes | **PASS** |
| `TC-4.4` | Post-Attack Health Audit | `GET /health` immediately after flood | Service healthy (`engine_ready: true`) | **PASS** |

---

## 3. Subprocess Sandboxing & Memory Safety Verification

In accordance with the project security guidelines in `SECURITY.md`:
1. **Subprocess Isolation**: Subprocess invocations run with `shell=False`, clean scrubbed environment variables (`LC_ALL=C`, `LANG=C`), and a restricted isolated temporary working directory.
2. **Deterministic Timeouts**: Subprocesses are bounded by a strict timeout (2.0s / 5.0s hard ceiling), preventing CPU lockup from adversarial inputs.
3. **Memory Safety Instrumentation**: The native C engine compiled under `-fsanitize=address,undefined` reported **zero memory leaks, zero buffer overflows, and zero undefined behaviors** throughout all 26 adversarial stress sweeps.

---

## 4. Verdict & Acceptance

All acceptance criteria defined in **Issue #16** have been met and verified:
- [x] Test Case 1 (Empty Input): Handled cleanly with deliberate responses.
- [x] Test Case 2 (Oversized Input): Enforces 64 KB cap and 413 response.
- [x] Test Case 3 (Malformed / Garbage Input): Survives binary fuzzing, nested syntax, and hostile payloads without segfaults.
- [x] Test Case 4 (Concurrent Request Load): Handles 50 concurrent requests and rate-limits floods without 5xx errors.
- [x] Complete test log documented.

**Status: VERIFIED & COMPLETED**
