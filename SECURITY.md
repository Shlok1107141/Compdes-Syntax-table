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
When invoking the native C engine from the Python backend:
- **Execution Timeout**: Subprocesses are terminated with `SIGKILL` if execution exceeds a strict threshold (e.g., maximum 2.0 seconds) to prevent infinite loops, algorithmic complexity attacks, or catastrophic backtracking.
- **Memory Ceiling**: Subprocesses are bounded by strict memory caps (e.g., `setrlimit` on POSIX or job object limits on Windows) to prevent exhaustion of host RAM.
- **Unprivileged Execution**: The native binary runs with dropped privileges without filesystem write access or network access.

### 3. Strict Input Size Caps
- The HTTP endpoint (`POST /analyze`) enforces a hard maximum payload limit (e.g., 64 KB).
- Requests exceeding this limit are rejected at the FastAPI / reverse proxy layer with `413 Payload Too Large` before ever being passed to the native binary.

### 4. Memory Safety & Sanitizer Verification
- All C source code in [`engine/`](engine/) is compiled with AddressSanitizer (`-fsanitize=address`) and UndefinedBehaviorSanitizer (`-fsanitize=undefined`) during development and CI.
- The trie and arena implementations enforce explicit bounds checking on array indices to guard against buffer overflows or out-of-bounds arena accesses.

### 5. Network & API Boundary Protection
- **CORS Lockdown**: Cross-Origin Resource Sharing (CORS) middleware is restricted to designated frontend origins in production to prevent arbitrary third-party website abuse.
- **Rate Limiting**: The `/analyze` endpoint enforces per-IP request rate limits to mitigate Denial of Service (DoS) attempts against the parsing subprocesses.

---

## 🚨 Reporting a Vulnerability

If you identify a security flaw or an edge case that could lead to memory corruption, out-of-bounds execution, or host compromise:

1. Do not open a public issue.
2. Reach out directly to the project team leads:
   - [**Shlok**](https://github.com/Shlok1107141) (`@Shlok1107141`) - Engine & Backend Lead
   - [**Sagnik Datta**](https://github.com/armoredglock) (`@armoredglock`) - Frontend Lead
   - **Eben** - Security & Testing Lead
3. Please include:
   - The crafted input payload causing the failure.
   - Execution environment and GCC/Clang sanitizer logs if applicable.
   - Expected vs actual subprocess behavior.
