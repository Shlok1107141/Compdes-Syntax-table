export interface SymbolEntry {
  name: string;
  type: string;
  scope: number;
  storage_class: string;
  offset: number;
}

export interface AblationData {
  trie_only: number;
  arena_only: number;
  bitpack_only: number;
  trie_arena: number;
  trie_bitpack: number;
  arena_bitpack: number;
}

export interface AnalyzeResponse {
  baseline_bytes: number;
  compressed_bytes: number;
  savings_pct: number;
  symbol_table: SymbolEntry[];
  ablation: AblationData;
}

export interface AnalyzeRequest {
  code: string;
}

export type ExecutionMode = 'mock' | 'live';
