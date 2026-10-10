# Project Issues & Sprint Deliverables Tracker

> **BCSE307L — Compiler Design Team Project**  
> **Repository**: [Shlok1107141/Compdes-Syntax-table](https://github.com/Shlok1107141/Compdes-Syntax-table)

This document tracks all active, assigned, and completed sprint issues across the team.

---

## 👥 Issue Assignment Overview

| Issue # | Domain | Title | Assignee | Priority | Status |
| :---: | :--- | :--- | :--- | :---: | :---: |
| [#6](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/6) | Engine | Implement C Lexer & Tokenizer for Source Input | [@Shlok1107141](https://github.com/Shlok1107141) | `P0-critical` | **OPEN** |
| [#7](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/7) | Engine | Implement Lexical Scope Tracker & Declaration Resolver | [@Shlok1107141](https://github.com/Shlok1107141) | `P0-critical` | **OPEN** |
| [#8](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/8) | Engine | Connect Lexer & Scope Tracker to Compressed Engine Core | [@Shlok1107141](https://github.com/Shlok1107141) | `P0-critical` | **OPEN** |
| [#9](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/9) | Backend | Build FastAPI Subprocess Wrapper & Sandboxed `/analyze` Endpoint | [@Shlok1107141](https://github.com/Shlok1107141) | `P0-critical` | **OPEN** |
| [#18](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/18) | Frontend | Scaffold React+Vite Webapp & Configure CI/CD Pipeline | [@armoredglock](https://github.com/armoredglock) | `P0-critical` | **CLOSED (PR #5)** |
| [#19](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/19) | Frontend | Build Monospace Code Input Panel & Preset Selector | [@armoredglock](https://github.com/armoredglock) | `P0-critical` | **CLOSED (PR #5)** |
| [#20](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/20) | Frontend | Build Live Metrics Dashboard & 7-Configuration Ablation Chart | [@armoredglock](https://github.com/armoredglock) | `P0-critical` | **CLOSED (PR #5)** |
| [#21](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/21) | Frontend | Build Parsed Symbol Table Inspector & Bit-Packed Word Visualizer | [@armoredglock](https://github.com/armoredglock) | `P0-critical` | **CLOSED (PR #5)** |
| [#22](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/22) | Frontend | Build Interactive Radix (Patricia) Trie Visualizer (Showcase Demo) | [@armoredglock](https://github.com/armoredglock) | `P0-critical` | **CLOSED (PR #5)** |
| [#23](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/23) | Frontend | Implement Dual Mode (Simulated Mock vs Live API) & Failure State UX | [@armoredglock](https://github.com/armoredglock) | `P0-critical` | **CLOSED (PR #5)** |
| [#10](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/10) | Frontend | Live Backend Integration & Error State Hardening | [@armoredglock](https://github.com/armoredglock) | `P1-high` | **OPEN** |
| [#11](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/11) | Ablation | Implement 3 Isolated Single-Technique Engine Variants | [@hardikpardik](https://github.com/hardikpardik) | `P0-critical` | **OPEN** |
| [#12](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/12) | Ablation | Implement 3 Pairwise Combination Engine Variants | [@hardikpardik](https://github.com/hardikpardik) | `P0-critical` | **OPEN** |
| [#13](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/13) | Ablation | Multi-Configuration Stress Sweep & Final Comparison Table | [@hardikpardik](https://github.com/hardikpardik) | `P0-critical` | **OPEN** |
| [#14](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/14) | Paper | Research Paper Draft - Problem, Architecture & Methodology | [@Eben923](https://github.com/Eben923) | `P1-high` | **OPEN** |
| [#15](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/15) | Paper | Research Paper Results & Discussion Synthesis | [@Eben923](https://github.com/Eben923) | `P0-critical` | **OPEN** |
| [#16](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/16) | Testing | Adversarial End-to-End Test Suite Execution | [@Eben923](https://github.com/Eben923) | `P0-critical` | **OPEN** |

---

## 📋 Detailed Issue Descriptions

### 1. Shlok (`@Shlok1107141`) — Engine + Backend

#### [Issue #6](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/6): Implement C Lexer & Tokenizer for Source Input
- **Objective**: Replace the hardcoded `TEST_SYMBOLS[]` array with a token scanner parsing source code character buffers.
- **Tasks**:
  - [ ] Implement token scanning for keywords (`int`, `char`, `float`, `void`, `static`, `const`, `struct`).
  - [ ] Implement identifier token extraction (`[a-zA-Z_][a-zA-Z0-9_]*`).
  - [ ] Handle pointers (`*`), array brackets (`[]`), and function signatures (`()`).
  - [ ] Strip comments and whitespace cleanly.
  - [ ] Ensure 100% clean compilation under GCC `-fsanitize=address,undefined`.

#### [Issue #7](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/7): Implement Lexical Scope Tracker & Declaration Resolver
- **Objective**: Track scope nesting depth and assign unique scope IDs and storage classes to declarations.
- **Tasks**:
  - [ ] Maintain a scope depth counter incremented on `{` and decremented on `}`.
  - [ ] Classify storage class (`0=local`, `1=global`, `2=static`, `3=param`).
  - [ ] Calculate stack/struct relative byte offsets for each declaration.
  - [ ] Handle shadowed declarations across differing scope depths.

#### [Issue #8](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/8): Connect Lexer & Scope Tracker to Compressed Engine Core
- **Objective**: Feed dynamic parsed tokens into the existing Patricia trie, arena allocator, and bit-packed metadata structures.
- **Tasks**:
  - [ ] Insert parsed identifiers into the Radix (Patricia) trie.
  - [ ] Pack metadata into 32-bit `uint32_t` records (`type: 4b`, `scope: 8b`, `class: 4b`, `offset: 16b`).
  - [ ] Allocate nodes and string edges in flat 16-bit indexed arena buffers.
  - [ ] Output computed baseline bytes, compressed bytes, savings %, and symbol records.

#### [Issue #9](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/9): Build FastAPI Subprocess Wrapper & Sandboxed `/analyze` Endpoint
- **Objective**: Create the hardened FastAPI REST server wrapping the compiled C engine via an unprivileged subprocess.
- **Tasks**:
  - [ ] Set up `backend/main.py` with FastAPI and CORS middleware.
  - [ ] Implement `POST /analyze` accepting `{"code": "<string>"}`.
  - [ ] Enforce a 64 KB request payload ceiling (reject larger with HTTP 413).
  - [ ] Enforce subprocess limits (2.0s execution timeout, memory cap, sandboxed execution).
  - [ ] Return JSON matching the locked API contract.

---

### 2. Sagnik Datta (`@armoredglock`) — Frontend

#### [Issue #18](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/18): Scaffold React+Vite Webapp & Configure CI/CD Pipeline
- **Status**: **CLOSED** (Delivered & verified in PR #5)
- **Objective**: Scaffold React 19, Vite, TypeScript, and Tailwind CSS v4 in `frontend/`, ensuring clean automated build and lint passes on GitHub Actions CI.

#### [Issue #19](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/19): Build Monospace Code Input Panel & Preset Selector
- **Status**: **CLOSED** (Delivered & verified in PR #5)
- **Objective**: Create developer-friendly code editor with line numbering, payload byte counter against the 64 KB limit, and 4 preloaded embedded C presets.

#### [Issue #20](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/20): Build Live Metrics Dashboard & 7-Configuration Ablation Chart
- **Status**: **CLOSED** (Delivered & verified in PR #5)
- **Objective**: Display Hero % memory saved metric, side-by-side RAM cards, and the 7-configuration horizontal comparison bar chart.

#### [Issue #21](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/21): Build Parsed Symbol Table Inspector & Bit-Packed Word Visualizer
- **Status**: **CLOSED** (Delivered & verified in PR #5)
- **Objective**: Implement filterable/searchable symbol table with 32-bit packed hexadecimal/binary word inspector and JSON export.

#### [Issue #22](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/22): Build Interactive Radix (Patricia) Trie Visualizer (Showcase Demo)
- **Status**: **CLOSED** (Delivered & verified in PR #5)
- **Objective**: Render interactive tree graph showing shared prefix edge deduplication, 16-bit arena index tags (`arena[#]`), and zoom/pan controls.

#### [Issue #23](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/23): Implement Dual Mode (Simulated Mock vs Live API) & Failure State UX
- **Status**: **CLOSED** (Delivered & verified in PR #5)
- **Objective**: Provide offline client-side simulation engine matching `symtab_demo.c` alongside live API switching and error banner fallback handling.

#### [Issue #10](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/10): Live Backend Integration & Error State Hardening
- **Status**: **OPEN** (Awaiting Shlok's backend deployment)
- **Objective**: Wire and harden live API communication once Shlok's FastAPI server is deployed.
- **Tasks**:
  - [ ] Switch frontend navbar toggle from "Simulated Mode" to "Live Backend".
  - [ ] Verify live `POST http://localhost:8000/analyze` requests against real C parser output.
  - [ ] Validate non-disruptive error banners for backend timeouts or network drops.
  - [ ] Triage and resolve any edge-case UI glitches identified during Eben's test runs.

---

### 3. Hardik (`@hardikpardik`) — Ablation Study

#### [Issue #11](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/11): Implement 3 Isolated Single-Technique Engine Variants
- **Objective**: Measure the memory footprint of each technique applied completely in isolation.
- **Tasks**:
  - [ ] `trie-only`: Radix trie storage with standard pointer nodes and unpacked struct fields.
  - [ ] `arena-only`: Flat 16-bit arena allocation with linear duplicate strings and unpacked fields.
  - [ ] `bitpack-only`: Packed 32-bit metadata word with standard hash table pointer nodes.
  - [ ] Compile and verify all variants with `-fsanitize=address,undefined`.

#### [Issue #12](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/12): Implement 3 Pairwise Combination Engine Variants
- **Objective**: Measure memory footprint of each pair of techniques to prove no single pair suffices.
- **Tasks**:
  - [ ] `trie + arena`: Trie storage + 16-bit arena indexing, unpacked metadata.
  - [ ] `trie + bitpack`: Trie storage + 32-bit packed metadata, standard 64-bit pointers.
  - [ ] `arena + bitpack`: 16-bit arena indexing + 32-bit packed metadata, linear strings.
  - [ ] Verify clean compilation under AddressSanitizer and UndefinedBehaviorSanitizer.

#### [Issue #13](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/13): Multi-Configuration Stress Sweep & Final Comparison Table
- **Objective**: Run all 7 configurations across scaling identifier counts ($N = 10 \text{ to } 300$) and generate the paper's comparison matrix.
- **Tasks**:
  - [ ] Benchmark both 'realistic subsystem' names and 'random worst-case' patterns across $N = 10, 25, 50, 100, 200, 300$.
  - [ ] Emit raw rows matching existing format: `DATA, pattern, N, baseline_bytes, variant_bytes`.
  - [ ] Compute % memory savings for each row.
  - [ ] Deliver consolidated comparison table to Eben.

---

### 4. Eben (`@Eben923`) — Research Paper + Security + Testing

#### [Issue #14](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/14): Research Paper Draft - Problem, Architecture & Methodology
- **Objective**: Draft the theoretical foundations, motivation, and system architecture sections of the research paper.
- **Tasks**:
  - [ ] Section 1: Motivation (Embedded compiler memory constraints, pointer bloat).
  - [ ] Section 2: Architecture (Patricia trie, 16-bit arena, bit-packed metadata).
  - [ ] Section 3: Experimental Setup (Baseline hash table and 7-configuration ablation methodology).

#### [Issue #15](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/15): Research Paper Results & Discussion Synthesis
- **Objective**: Synthesize Hardik's benchmark sweep data and draft the experimental results and discussion sections.
- **Tasks**:
  - [ ] Ingest Hardik's 7-configuration comparison table and scaling sweep plots.
  - [ ] Format publication-quality tables and graphs.
  - [ ] Draft Results section analyzing scaling curves ($N = 10 \text{ to } 300$).
  - [ ] Draft Discussion & Conclusion proving why the 3-in-1 model is essential for >75% savings.

#### [Issue #16](https://github.com/Shlok1107141/Compdes-Syntax-table/issues/16): Adversarial End-to-End Test Suite Execution
- **Objective**: Stress-test the integrated application and file bugs against unhandled failure states.
- **Tasks**:
  - [ ] Test Case 1: Empty input payload.
  - [ ] Test Case 2: Oversized input payload (>64 KB).
  - [ ] Test Case 3: Malformed / garbage non-C syntax.
  - [ ] Test Case 4: Concurrent request load.
  - [ ] Record results in a structured test log and file GitHub issues for any failures.
