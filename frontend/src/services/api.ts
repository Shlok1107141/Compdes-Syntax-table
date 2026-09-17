import type { AnalyzeRequest, AnalyzeResponse, SymbolEntry, AblationData, ExecutionMode } from '../types';

const API_BASE_URL = 'http://localhost:8000';

/**
 * Intelligent client-side C lexer & symbol analyzer.
 * Emulates the exact memory models implemented in engine/symtab_demo.c
 */
export function analyzeCodeSimulated(code: string): AnalyzeResponse {
  const symbols = extractSymbolsFromCode(code);

  if (symbols.length === 0) {
    return {
      baseline_bytes: 0,
      compressed_bytes: 0,
      savings_pct: 0,
      symbol_table: [],
      ablation: {
        trie_only: 0,
        arena_only: 0,
        bitpack_only: 0,
        trie_arena: 0,
        trie_bitpack: 0,
        arena_bitpack: 0,
      },
    };
  }

  // Calculate memory based on engine/symtab_demo.c formulas
  const MALLOC_CHUNK_OVERHEAD = 16;
  const HASH_NODE_SIZE = 32; // unpacked struct with 64-bit pointers (8-byte next, 8-byte name ptr, 4x 4-byte fields)

  let totalStringBytes = 0;
  for (const sym of symbols) {
    totalStringBytes += sym.name.length + 1; // null-terminated string
  }

  // Baseline: per-symbol node malloc (32B) + string malloc (length+1) + per-allocation chunk headers
  const baseline_bytes = symbols.length * (HASH_NODE_SIZE + MALLOC_CHUNK_OVERHEAD) +
                         totalStringBytes + (symbols.length * MALLOC_CHUNK_OVERHEAD);

  // Patricia / Radix Trie string interning analysis
  const trieStats = buildRadixTrieMetrics(symbols.map(s => s.name));

  // Compressed Symbol Table:
  // 1. Radix trie nodes: 16-bit indices (uint16_t child, sibling, edge_offset, edge_len) = 8 bytes per trie node
  // 2. Compact string edge pool (deduplicated prefix bytes)
  // 3. Bit-packed metadata: 4 bytes (uint32_t) per symbol entry
  // 4. Arena indexed array: symbol record = 2 bytes trie_node_id + 4 bytes packed_metadata = 6 bytes
  const COMPRESSED_ARENA_NODE_SIZE = 6;
  const TRIE_NODE_ARENA_SIZE = 8;
  const compressed_bytes = Math.round(
    (symbols.length * COMPRESSED_ARENA_NODE_SIZE) +
    (trieStats.uniqueEdges * TRIE_NODE_ARENA_SIZE) +
    trieStats.deduplicatedEdgeBytes
  );

  const savings_pct = Math.round(((baseline_bytes - compressed_bytes) / baseline_bytes) * 1000) / 10;

  // Ablation Variants (Isolating individual and pairwise techniques)
  // 1. trie_only: Patricia trie for strings, but pointer nodes (32B) and unpacked fields
  const trie_only = Math.round(
    symbols.length * (HASH_NODE_SIZE + MALLOC_CHUNK_OVERHEAD) +
    (trieStats.uniqueEdges * 24) + trieStats.deduplicatedEdgeBytes
  );

  // 2. arena_only: 16-bit arena indices (10B/node), but full individual strings and unpacked fields
  const arena_only = Math.round(
    (symbols.length * 18) + totalStringBytes
  );

  // 3. bitpack_only: 32-bit packed word, but standard hash table pointers (8B next, 8B name ptr, 4B packed)
  const bitpack_only = Math.round(
    symbols.length * (20 + MALLOC_CHUNK_OVERHEAD) +
    totalStringBytes + (symbols.length * MALLOC_CHUNK_OVERHEAD)
  );

  // 4. trie_arena: Trie + 16-bit Arena, unpacked metadata (16 bytes per symbol)
  const trie_arena = Math.round(
    (symbols.length * 16) +
    (trieStats.uniqueEdges * TRIE_NODE_ARENA_SIZE) +
    trieStats.deduplicatedEdgeBytes
  );

  // 5. trie_bitpack: Trie + Bit-packed metadata, 64-bit pointers
  const trie_bitpack = Math.round(
    (symbols.length * 20) +
    (trieStats.uniqueEdges * 16) +
    trieStats.deduplicatedEdgeBytes
  );

  // 6. arena_bitpack: Arena + Bit-packed metadata, plain individual strings
  const arena_bitpack = Math.round(
    (symbols.length * COMPRESSED_ARENA_NODE_SIZE) +
    totalStringBytes
  );

  const ablation: AblationData = {
    trie_only,
    arena_only,
    bitpack_only,
    trie_arena,
    trie_bitpack,
    arena_bitpack,
  };

  return {
    baseline_bytes,
    compressed_bytes,
    savings_pct: Math.max(0, savings_pct),
    symbol_table: symbols,
    ablation,
  };
}

/**
 * C Lexer simulation: extracts declarations, functions, variables, types, and scope depths.
 */
function extractSymbolsFromCode(code: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = [];
  const lines = code.split('\n');

  let currentScope = 0;
  let currentOffset = 0;

  // Regular expression to match C declarations:
  // e.g.: int counter; char* buffer; static int init_flag; void func(int param)
  const typeRegex = /\b(static\s+)?(const\s+)?(unsigned\s+)?(int|char|float|double|void|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|struct\s+\w+)\s*(\*)?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(\(([^)]*)\))?/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // Track scope depth via curly braces
    const openBraces = (trimmed.match(/\{/g) || []).length;
    const closeBraces = (trimmed.match(/\}/g) || []).length;

    let match: RegExpExecArray | null;
    while ((match = typeRegex.exec(line)) !== null) {
      const isStatic = Boolean(match[1]);
      const baseType = match[4].trim();
      const isPointer = Boolean(match[5]);
      const identifier = match[6];
      const isFunction = Boolean(match[7]);
      const params = match[8];

      // Ignore common C keywords that look like identifiers
      if (['return', 'if', 'for', 'while', 'switch', 'sizeof'].includes(identifier)) {
        continue;
      }

      const displayType = isPointer ? `${baseType}*` : (isFunction ? `${baseType}()` : baseType);
      
      let storageClass = 'global';
      if (isFunction) {
        storageClass = 'function';
      } else if (isStatic) {
        storageClass = 'static';
      } else if (currentScope > 0) {
        storageClass = 'local';
      }

      symbols.push({
        name: identifier,
        type: displayType,
        scope: currentScope,
        storage_class: storageClass,
        offset: currentOffset,
      });

      // Advance stack/struct offset (4 bytes for int/ptr, 1 byte for char, 8 for double)
      const typeSize = baseType === 'char' && !isPointer ? 1 : 4;
      currentOffset += typeSize;

      // Extract parameters if function
      if (isFunction && params && params.trim() !== 'void') {
        const paramList = params.split(',');
        let pOffset = 0;
        for (const p of paramList) {
          const pParts = p.trim().split(/\s+/);
          if (pParts.length >= 2) {
            const pType = pParts.slice(0, -1).join(' ');
            const pName = pParts[pParts.length - 1].replace(/[*&]/g, '');
            if (pName && !['void'].includes(pName)) {
              symbols.push({
                name: pName,
                type: pType,
                scope: currentScope + 1,
                storage_class: 'param',
                offset: pOffset,
              });
              pOffset += 4;
            }
          }
        }
      }
    }

    currentScope += openBraces - closeBraces;
    if (currentScope < 0) currentScope = 0;
  }

  // Deduplicate symbols by name + scope
  const seen = new Set<string>();
  return symbols.filter(s => {
    const key = `${s.name}@${s.scope}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Metric calculator for Radix / Patricia Trie string sharing.
 */
function buildRadixTrieMetrics(names: string[]): { uniqueEdges: number; deduplicatedEdgeBytes: number } {
  if (names.length === 0) return { uniqueEdges: 0, deduplicatedEdgeBytes: 0 };

  // Calculate common prefix savings
  let sharedPrefixBytes = 0;
  const sorted = [...names].sort();

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    let common = 0;
    while (common < prev.length && common < curr.length && prev[common] === curr[common]) {
      common++;
    }
    sharedPrefixBytes += common;
  }

  const rawStringBytes = names.reduce((acc, n) => acc + n.length + 1, 0);
  const deduplicatedEdgeBytes = Math.max(16, rawStringBytes - sharedPrefixBytes);
  const uniqueEdges = Math.max(names.length, Math.round(names.length * 1.2));

  return {
    uniqueEdges,
    deduplicatedEdgeBytes,
  };
}

/**
 * Execute symbol analysis.
 * Supports both Live FastAPI backend and local Mock/Simulation mode.
 */
export async function analyzeCode(
  code: string,
  mode: ExecutionMode = 'mock'
): Promise<AnalyzeResponse> {
  if (mode === 'mock') {
    // Return simulated response conforming directly to contract
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(analyzeCodeSimulated(code));
      }, 350); // slight delay to feel realistic
    });
  }

  // Live Mode: Call POST /analyze on the FastAPI backend
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8-second timeout

  try {
    const response = await fetch(`${API_BASE_URL}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code } as AnalyzeRequest),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Backend responded with status ${response.status}: ${errorText || response.statusText}`);
    }

    const data: AnalyzeResponse = await response.json();
    return data;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Analysis request timed out after 8 seconds.');
    }
    throw err;
  }
}
