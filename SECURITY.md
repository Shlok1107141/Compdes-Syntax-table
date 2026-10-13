# Security Policy

## Threat Model & Scope

This application provides a web-based demonstration and analysis interface for an in-memory C compiler symbol table. The system processes user-submitted C-like source code snippets to extract identifiers, build symbol tables, and evaluate memory utilization.

> [!IMPORTANT]
> **Deliberately Narrow Security Scope**:  
> This application does not maintain user accounts, session cookies, databases, or payment flows. **The primary security boundary and singular threat vector is untrusted user-submitted text reaching a native C-based analysis engine.**

---

## 🛡 Security Architecture & Mitigations

To protect the host environment while parsing arbitrary input, the following defensive layers are enforced across the backend and engine boundaries:

### 1. Pure Static Analysis (Parse-Only Execution)
- User-submitted source code is **never compiled into an executable binary and never executed**.
- Input text is strictly processed by a lexer/parser and symbol table constructor that allocates internal data structures in memory and terminates.
- The engine operates purely as a read-only scanner of the provided character buffer.

### 2. Subprocess Resource Limits & Sandboxing
When invoking the native C engine from the Python backend ([`backend/engine.py`](backend/engine.py)):
- **Execution Timeout**: the child is killed if it runs longer than 5 seconds (`SYMTAB_ENGINE_TIMEOUT`), returned to the client as `504`.
- **Memory and CPU Ceiling**: on POSIX the engine caps its own address space (256 MiB) and CPU time (5 s) with `setrlimit` before reading any input. (No equivalent is applied on Windows; deploy with Docker.)
- **Minimal Process Surface**: no shell, an argument vector only, a scrubbed environment, an empty temporary working directory, and a cap on output size.
- **Bounded Concurrency**: at most 4 engine processes run at once (`SYMTAB_MAX_CONCURRENCY`).
- **Container Isolation** ([`docker-compose.yml`](docker-compose.yml)): the backend runs as an unprivileged user on a read-only filesystem, with all Linux capabilities dropped, `no-new-privileges`, 512 MiB / 1 CPU / 64-process limits, and no network route except from the nginx front end.

### 3. Strict Input Size Caps
- `POST /analyze` rejects source larger than 64 KiB with `413 Payload Too Large` before the engine is started; nginx caps the whole request body at 512 KiB.
- The engine independently refuses input over 1 MiB, identifiers over 255 characters, more than 8,192 declarations, and anything past its 16-bit arena limits — each as a JSON error (`400`), never a crash.

### 4. Memory Safety & Sanitizer Verification
- All C source code in [`engine/`](engine/) is compiled with AddressSanitizer (`-fsanitize=address`) and UndefinedBehaviorSanitizer (`-fsanitize=undefined`) during development and CI.
- The trie and arena implementations enforce explicit bounds checking on array indices to guard against buffer overflows or out-of-bounds arena accesses.

### 5. Network & API Boundary Protection
- **CORS Lockdown**: only origins listed in `SYMTAB_ALLOWED_ORIGINS` are allowed; credentials are never allowed.
- **Rate Limiting**: 30 requests per minute per client (`SYMTAB_RATE_LIMIT`). Behind the bundled nginx the client is identified by `X-Real-IP`, which nginx overwrites; the header is ignored unless `SYMTAB_TRUST_PROXY_HEADERS=1`, so clients cannot spoof it.

### 6. Continuous Verification
- 108 hostile inputs ([`backend/tests/hostile_inputs.py`](backend/tests/hostile_inputs.py)) run against a sanitizer build on every pull request.
- [`backend/scripts/adversarial_e2e.py`](backend/scripts/adversarial_e2e.py) attacks the running Docker stack through nginx in CI: malformed and oversized requests, hostile source, 50 concurrent requests and a request flood. Every request must get a deliberate answer (never a 5xx) and the service must stay healthy.

---

## 🚨 Reporting a Vulnerability

If you identify a security flaw or an edge case that could lead to memory corruption, out-of-bounds execution, or host compromise:

1. Do not open a public issue.
2. Reach out directly to the project team leads:
   - [**Shlok**](https://github.com/Shlok1107141) (`@Shlok1107141`) - Engine & Backend Lead
   - [**Sagnik Datta**](https://github.com/armoredglock) (`@armoredglock`) - Frontend Lead
   - [**Eben**](https://github.com/Eben923) (`@Eben923`) - Security & Testing Lead
3. Please include:
   - The crafted input payload causing the failure.
   - Execution environment and GCC/Clang sanitizer logs if applicable.
   - Expected vs actual subprocess behavior.
