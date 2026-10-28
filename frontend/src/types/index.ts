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

export interface HardwareStatusResponse {
  status: 'ONLINE' | 'CONNECTED_READY_TO_FLASH' | 'DISCONNECTED' | 'ERROR';
  port: string;
  board?: string;
  clock_mhz?: number;
  free_heap?: number;
  description?: string;
  detail?: string;
}

/* ---- Arduino Uno, live (backend/hardware_uno.py, firmware/uno_bench) ---- */

export interface SerialPortInfo {
  device: string;
  description: string;
  vid_pid: string | null;
  likely_board: string | null;
}

export interface UnoStatus {
  status: 'ONLINE';
  port: string;
  /** Structure the board was flashed with: baseline, A, B, C, AB, AC, BC or ABC. */
  variant: string;
  clock_mhz: number;
  free_ram: number;
  /** RAM taken by the firmware's globals, including an arena build's fixed pools. */
  static_ram: number;
  live_symbols: number;
}

export type UnoInsertResult = 'ok' | 'arena_full' | 'out_of_ram';

/** One line of the POST /hardware/uno/live stream. Byte counts come from the board. */
export type UnoLiveEvent =
  | {
      event: 'start';
      port: string;
      variant: string;
      free_ram: number;
      static_ram: number;
      /** Bytes every structure gets in the capacity test (STRUCT_BUDGET). */
      budget: number;
      total: number;
      skipped: { name: string; reason: string }[];
      /** The same program measured by the engine on the PC (64-bit); absent when the
       * declarations came from the browser's approximate parser. */
      pc?: { baseline_bytes: number; compressed_bytes: number; savings_pct: number };
    }
  | {
      event: 'symbol';
      index: number;
      name: string;
      type: string;
      scope: number;
      storage_class: string;
      offset: number;
      stored: number;
      result: UnoInsertResult;
      table_bytes: number;
      heap_bytes: number;
      free_ram: number;
      insert_us: number;
      verified: boolean;
      packed_hex: string;
    }
  | {
      event: 'done';
      stored: number;
      table_bytes: number;
      heap_bytes: number;
      free_ram: number;
      stopped: 'none' | 'arena_full' | 'out_of_ram';
      variant: string;
      total: number;
      refused: number;
      /** Textbook table for the stored symbols on the Uno: a model, exact on every set measured. */
      avr_baseline_model_bytes: number | null;
      saving_vs_model_pct: number | null;
      /** Mean time to find one stored name, timed on the board after the inserts. */
      lookup_us_mean?: number | null;
    }
  | { event: 'error'; status: number; detail: string };

export interface HardwareAnalyzeResponse {
  status: string;
  hardware: {
    board: string;
    soc: string;
    cpu_mhz: number;
    free_heap_bytes: number;
    heap_delta_bytes: number;
  };
  metrics: {
    mode: string;
    symbol_count: number;
    trie_nodes: number;
    char_pool_bytes: number;
    compressed_bytes: number;
    baseline_bytes: number;
    savings_pct: number;
    exec_time_us: number;
  };
  symbols: Array<{
    name: string;
    type: string;
    scope: number;
    offset: number;
    packed_word: string;
  }>;
}

