export interface SymbolEntry {
  name: string;
  type: string;
  scope: number;
  storage_class: string;
  offset: number;
  /** Uses that resolve to this declaration through the compressed table's scoped lookup. */
  references?: number;
  /** The 32-bit word the compressed table stores: type(4) | scope(8) | storage(4) | offset(16). */
  packed?: number;
}

export interface AblationData {
  trie_only: number;
  arena_only: number;
  bitpack_only: number;
  trie_arena: number;
  trie_bitpack: number;
  arena_bitpack: number;
}

/** Largest table needed at any point if each scope released its symbols when it closed. */
export interface PeakData {
  baseline_bytes: number;
  compressed_bytes: number;
  savings_pct: number;
  live_symbols: number;
}

export interface AnalyzeResponse {
  baseline_bytes: number;
  compressed_bytes: number;
  savings_pct: number;
  symbol_table: SymbolEntry[];
  ablation: AblationData;
  peak?: PeakData;
}

export interface AnalyzeRequest {
  code: string;
}

/**
 * 'live'    — the backend runs the C engine on whatever is in the editor.
 * 'offline' — no backend: the engine's precomputed results for the built-in samples.
 */
export type ExecutionMode = 'offline' | 'live';

export interface HealthStatus {
  online: boolean;
  engineReady?: boolean;
  message?: string;
}

export interface SyntaxBenchmarkItem {
  grammar: string;
  category: string;
  algorithm: string;
  states: number;
  tokens: number;
  nnz: number;
  sparsity_pct: number;
  raw_bytes: number;
  payload_bytes: number;
  index_bytes: number;
  side_structure_bytes: number;
  decoder_code_bytes: number;
  total_compressed_bytes: number;
  compression_ratio: number;
  savings_pct: number;
  build_time_us: number;
  mean_lookup_ns: number;
  p99_lookup_ns: number;
  max_lookup_ns: number;
  peak_working_mem_bytes: number;
  cache_miss_rate_pct: number;
  avg_lines_touched: number;
  correctness_verified: boolean;
  verified_queries_count: number;
  errors_correctly_detected: number;
  default_reductions_applied: number;
}

export interface SyntaxBenchmarkResponse {
  timestamp: number;
  benchmarks: SyntaxBenchmarkItem[];
}
