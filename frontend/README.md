# Compressed Symbol Table — Frontend Webapp

> **BCSE307L — Compiler Design Sprint**  
> **Lead**: Sagnik Datta ([@armoredglock](https://github.com/armoredglock))  
> **Stack**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide React

---

## 🌟 Overview

The frontend web application provides an interactive analysis workbench and visualizer for the **Memory-Constrained Compressed Symbol Table**. It demonstrates how combining a **Patricia / Radix Trie**, **16-bit Arena Addressing**, and **32-bit Bit-Packed Metadata** reduces compiler symbol table memory overhead by **~75.4%** compared to a textbook separate-chaining hash table.

---

## 🎯 Deliverables & Features

1. **Monospace Code Input Panel**:
   - Real-time line numbers and byte payload counter.
   - Quick preset selectors preloaded with realistic embedded C workloads (including the verified 30-symbol prototype from `engine/symtab_demo.c`).
   - Client-side size validation guarding against payloads exceeding the 64 KB security ceiling.
2. **Live Metrics Dashboard & Hero Display**:
   - Prominent **% Memory Saved** readout and density multiplier (e.g. `4.1x denser`).
   - Side-by-side memory consumption cards (Baseline Hash Table vs. Compressed Architecture vs. Net Bytes Spared).
   - **7-Configuration Ablation Comparison Bar Chart**: Compares the baseline against all single techniques (Trie, Arena, Bitpack), pairwise combinations, and the winning 3-in-1 architecture.
3. **Parsed Symbol Table View**:
   - Real-time filtering by identifier name, data type, storage class (`global`, `local`, `static`, `param`), and lexical scope depth.
   - **Bit-Packed 32-bit Word Inspector**: Visualizes how `[Type: 4b][Scope: 8b][Storage Class: 4b][Offset: 16b]` is tightly bit-packed into a single `uint32_t`, replacing bloated struct padding.
   - Export to JSON for benchmark auditing.
4. **Interactive Radix (Patricia) Trie Visualizer (Showcase Demo)**:
   - Interactive tree rendering the actual string intern trie.
   - Nodes display 16-bit arena addresses (`arena[#]`) and shared prefix edge labels (e.g. `"sensor_"` -> `"temp"`, `"press"`).
   - Zoom/pan controls and click-to-inspect node details.
5. **Dual Mode Architecture (Mock & Live Backend)**:
   - **Simulated Mode**: Client-side lexing and memory calculation based on `engine/symtab_demo.c` formulas for immediate offline demos.
   - **Live Backend Mode**: Calls `POST /analyze` on `http://localhost:8000/analyze` adhering to the locked JSON API contract.
   - Non-disruptive error banners for connection drops or invalid input.

---

## 🚀 Getting Started

### Installation
```bash
cd frontend
npm ci
```

### Run Local Development Server
```bash
npm run dev
```

### Lint & Type-Check
```bash
npm run lint
```

### Production Build
```bash
npm run build
```
*(Verified by GitHub Actions CI on every commit/PR).*
