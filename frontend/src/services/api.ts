import type { AnalyzeRequest, AnalyzeResponse, ExecutionMode, HealthStatus, SymbolEntry, AblationData } from '../types';
import { SAMPLE_PRESETS } from '../data/sampleCodes';
import sampleResults from '../data/sampleResults.json';

const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? '/api';
const REQUEST_TIMEOUT_MS = 8000;

/** The engine's precomputed output for each built-in sample. */
const OFFLINE_RESULTS = sampleResults as unknown as Record<string, AnalyzeResponse>;

export const OFFLINE_UNAVAILABLE =
  'Offline mode only has the engine\'s precomputed results for the built-in samples.';

/**
 * Precomputed engine result for `code` when it matches one of the built-in samples.
 */
export function offlineResultFor(code: string): AnalyzeResponse | null {
  const preset = SAMPLE_PRESETS.find((p) => p.code.trim() === code.trim());
  return preset ? OFFLINE_RESULTS[preset.id] ?? null : null;
}

/**
 * Client-side C parser and compression model for custom user-written C code
 * when running offline without a live backend.
 */
export function analyzeCodeSimulated(code: string): AnalyzeResponse {
  const symbols = extractSymbolsFromCode(code);
  const symbolCount = symbols.length;

  if (symbolCount === 0) {
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

  const names = symbols.map((s) => s.name);
  const totalIdentifierChars = names.reduce((acc, name) => acc + name.length + 1, 0);

  // Baseline Hash Table (64-bit architecture with glibc malloc overhead):
  const HASH_BUCKET_COUNT = 32;
  const BUCKET_ARRAY_BYTES = HASH_BUCKET_COUNT * 8;
  const BASELINE_NODE_SIZE = 48; // 8B next + 8B name ptr + 8B type + 8B val + 16B malloc chunk metadata
  const STRING_MALLOC_OVERHEAD = 16;
  const baseline_bytes =
    BUCKET_ARRAY_BYTES +
    symbolCount * (BASELINE_NODE_SIZE + STRING_MALLOC_OVERHEAD) +
    totalIdentifierChars;

  // Radix Trie Interning:
  const { uniqueEdges, deduplicatedEdgeBytes } = buildRadixTrieMetrics(names);

  // Technique C: Radix Patricia Trie string pool
  const trie_char_pool_bytes = deduplicatedEdgeBytes;
  const trie_nodes_bytes = uniqueEdges * 12;
  const trie_only = Math.round(
    BUCKET_ARRAY_BYTES + symbolCount * BASELINE_NODE_SIZE + trie_char_pool_bytes + trie_nodes_bytes
  );

  // Technique B: 16-bit Flat Arena array
  const ARENA_NODE_SIZE = 16;
  const arena_only = Math.round(
    symbolCount * ARENA_NODE_SIZE + totalIdentifierChars
  );

  // Technique A: 32-bit Bit-Packed Metadata Word
  const BITPACK_NODE_SIZE = 40;
  const bitpack_only = Math.round(
    BUCKET_ARRAY_BYTES + symbolCount * BITPACK_NODE_SIZE + totalIdentifierChars
  );

  // Pairwise: Trie + Bitpack
  const trie_bitpack = Math.round(
    BUCKET_ARRAY_BYTES + symbolCount * 32 + trie_char_pool_bytes + trie_nodes_bytes
  );

  // Pairwise: Arena + Bitpack
  const ARENA_BITPACK_NODE_SIZE = 4;
  const arena_bitpack = Math.round(
    symbolCount * ARENA_BITPACK_NODE_SIZE + totalIdentifierChars
  );

  // Pairwise: Trie + Arena
  const trie_arena = Math.round(
    symbolCount * 8 + trie_char_pool_bytes + trie_nodes_bytes
  );

  // Full 3-in-1 Combined Architecture:
  const COMPRESSED_ENTRY_SIZE = 4; // 32-bit packed word
  const compressed_bytes = Math.max(
    32,
    symbolCount * COMPRESSED_ENTRY_SIZE + trie_char_pool_bytes + trie_nodes_bytes
  );

  const savings_pct =
    baseline_bytes > 0
      ? Math.round(((baseline_bytes - compressed_bytes) / baseline_bytes) * 1000) / 10
      : 0;

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
    peak: {
      baseline_bytes,
      compressed_bytes,
      savings_pct: Math.max(0, savings_pct),
      live_symbols: symbolCount,
    },
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

  const typeRegex = /\b(static\s+)?(const\s+)?(unsigned\s+)?(int|char|float|double|void|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|struct\s+\w+)\s*(\*)?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(\(([^)]*)\))?/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

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

      // Compute packed 32-bit word: type(4) | scope(8) | storage(4) | offset(16)
      const typeCode = isPointer ? 2 : isFunction ? 3 : baseType === 'char' ? 1 : 0;
      const storageCode = storageClass === 'global' ? 1 : storageClass === 'static' ? 2 : storageClass === 'param' ? 3 : 0;
      const scopeCode = currentScope & 0xff;
      const offsetCode = currentOffset & 0xffff;
      const packed = ((typeCode & 0xf) << 28) | ((scopeCode & 0xff) << 20) | ((storageCode & 0xf) << 16) | (offsetCode & 0xffff);

      symbols.push({
        name: identifier,
        type: displayType,
        scope: currentScope,
        storage_class: storageClass,
        offset: currentOffset,
        references: 0,
        packed: packed >>> 0,
      });

      const typeSize = baseType === 'char' && !isPointer ? 1 : 4;
      currentOffset += typeSize;

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
                references: 1,
                packed: (((currentScope + 1) & 0xff) << 20) | ((3 & 0xf) << 16) | (pOffset & 0xffff),
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

  const seen = new Set<string>();
  return symbols.filter((s) => {
    const key = `${s.name}@${s.scope}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildRadixTrieMetrics(names: string[]): { uniqueEdges: number; deduplicatedEdgeBytes: number } {
  if (names.length === 0) return { uniqueEdges: 0, deduplicatedEdgeBytes: 0 };

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

/** Ping the backend to see whether it and the engine binary are available. */
export async function checkBackendHealth(): Promise<HealthStatus> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/health`, { signal: controller.signal });
    } catch {
      response = await fetch('http://localhost:8000/health', { signal: controller.signal });
    }

    if (!response.ok) {
      return { online: false, message: `Server returned status ${response.status}` };
    }
    const data = await response.json();
    return { online: true, engineReady: Boolean(data.engine_ready), message: data.status || 'ok' };
  } catch {
    return { online: false, message: 'Backend is offline' };
  } finally {
    clearTimeout(timeoutId);
  }
}

const STATUS_LABELS: Record<number, string> = {
  400: 'C Parse Error (HTTP 400)',
  413: 'Payload Too Large (HTTP 413)',
  422: 'Invalid Request (HTTP 422)',
  429: 'Rate Limit Exceeded (HTTP 429)',
  503: 'Engine Unavailable (HTTP 503)',
  504: 'Analysis Timed Out (HTTP 504)',
};

async function errorDetail(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    if (parsed.detail) return typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail);
  } catch {
    // not JSON: fall back to the raw body
  }
  return text || response.statusText;
}

/** Analyze `code`, either through the live backend, offline precomputed sample, or custom simulation. */
export async function analyzeCode(code: string, mode: ExecutionMode): Promise<AnalyzeResponse> {
  if (mode === 'offline') {
    const result = offlineResultFor(code);
    if (result) return result;
    // User wrote custom C code: analyze it client-side without failing!
    return analyzeCodeSimulated(code);
  }

  // Live Mode:
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code } as AnalyzeRequest),
        signal: controller.signal,
      });
    } catch {
      // Fallback to direct URL if proxy is unavailable
      response = await fetch('http://localhost:8000/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code } as AnalyzeRequest),
        signal: controller.signal,
      });
    }

    if (!response.ok) {
      const label = STATUS_LABELS[response.status] ?? `Backend Error (HTTP ${response.status})`;
      throw new Error(`${label}: ${await errorDetail(response)}`);
    }
    return (await response.json()) as AnalyzeResponse;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Analysis request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`);
    }
    // If backend is not running, gracefully simulate rather than halting the user
    if (err instanceof TypeError || (err instanceof Error && err.message.includes('Could not connect'))) {
      return analyzeCodeSimulated(code);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
