import React from 'react';
import { Layers, Database, Sparkles, TrendingDown, ArrowDownRight, Zap } from 'lucide-react';
import type { AnalyzeResponse } from '../types';

interface MetricsDashboardProps {
  data: AnalyzeResponse | null;
}

export const MetricsDashboard: React.FC<MetricsDashboardProps> = ({ data }) => {
  if (!data || data.symbol_table.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-xs flex flex-col items-center justify-center min-h-[300px]">
        <Layers className="w-12 h-12 text-slate-300 mb-3" />
        <h3 className="text-base font-semibold text-slate-700">No Analysis Data Yet</h3>
        <p className="text-xs text-slate-500 mt-1 max-w-sm">
          Click "Analyze Symbol Table" to compute memory consumption, compression ratios, and the full ablation breakdown.
        </p>
      </div>
    );
  }

  const { baseline_bytes, compressed_bytes, savings_pct, symbol_table, ablation, peak } = data;
  const netBytesSaved = Math.max(0, baseline_bytes - compressed_bytes);
  const symbolCount = symbol_table.length;
  const baselinePerSymbol = symbolCount > 0 ? (baseline_bytes / symbolCount).toFixed(1) : '0';
  const compressedPerSymbol = symbolCount > 0 ? (compressed_bytes / symbolCount).toFixed(1) : '0';
  const densityMultiplier = compressed_bytes > 0 ? (baseline_bytes / compressed_bytes).toFixed(1) : '1.0';

  // Every byte count below is measured by the C engine on a real structure.
  const savingsOf = (bytes: number) =>
    baseline_bytes > 0 ? Math.round(((baseline_bytes - bytes) / baseline_bytes) * 1000) / 10 : 0;

  const techniques = [
    { key: 'bitpack_only', name: 'Bitpack Only', bytes: ablation.bitpack_only, color: 'bg-teal-500', textColor: 'text-teal-700', badge: 'Single' },
    { key: 'arena_only', name: 'Arena Only', bytes: ablation.arena_only, color: 'bg-teal-600', textColor: 'text-teal-700', badge: 'Single' },
    { key: 'trie_only', name: 'Trie Only', bytes: ablation.trie_only, color: 'bg-teal-700', textColor: 'text-teal-800', badge: 'Single' },
    { key: 'trie_bitpack', name: 'Trie + Bitpack', bytes: ablation.trie_bitpack, color: 'bg-teal-800', textColor: 'text-teal-900', badge: 'Pairwise' },
    { key: 'arena_bitpack', name: 'Arena + Bitpack', bytes: ablation.arena_bitpack, color: 'bg-teal-900', textColor: 'text-teal-900', badge: 'Pairwise' },
    { key: 'trie_arena', name: 'Trie + Arena', bytes: ablation.trie_arena, color: 'bg-teal-950', textColor: 'text-teal-950', badge: 'Pairwise' },
    { key: 'all_three', name: 'All Three Combined', bytes: compressed_bytes, color: 'bg-orange-600', textColor: 'text-orange-600', badge: 'Trie + Arena + Bitpack' },
  ];

  const winner = techniques.reduce((best, t) => (t.bytes < best.bytes ? t : best));
  const allThreeWins = winner.key === 'all_three';

  const configurations = [
    { key: 'baseline', name: 'Baseline Hash Table', bytes: baseline_bytes, color: 'bg-slate-400', textColor: 'text-slate-600', badge: 'Uncompressed' },
    ...techniques,
  ].map((cfg) => ({
    ...cfg,
    savings: cfg.key === 'baseline' ? 0 : savingsOf(cfg.bytes),
    isWinner: cfg.key === winner.key,
  }));

  // Scale bars to the largest configuration
  const largestBytes = Math.max(...configurations.map((c) => c.bytes), 1);

  return (
    <div className="space-y-5">
      {/* Top Hero Readout Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Hero Card: % Memory Saved (Orange Highlight) */}
        <div className="md:col-span-1 rounded-xl border border-orange-200 bg-orange-50/60 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-orange-800 uppercase tracking-wider">
              Memory Savings
            </span>
            <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-orange-100 text-orange-800 border border-orange-200">
              {densityMultiplier}x Denser
            </span>
          </div>

          <div className="my-3">
            <div className="flex items-baseline space-x-2">
              <span className="text-5xl font-extrabold text-orange-600 font-mono tracking-tight">
                {savings_pct}%
              </span>
              <TrendingDown className="w-7 h-7 text-orange-600 mb-1" />
            </div>
            <p className="text-xs text-slate-700 mt-2 font-medium">
              Spared <span className="text-orange-700 font-bold font-mono">{netBytesSaved.toLocaleString()} bytes</span> of RAM across {symbolCount} identifiers.
            </p>
          </div>

          <div className="pt-3 border-t border-orange-200 flex items-center justify-between text-xs text-slate-600 font-mono">
            <span>Delta: -{netBytesSaved.toLocaleString()} B</span>
            <span className="text-orange-700 font-semibold">{compressedPerSymbol} B/symbol</span>
          </div>
        </div>

        {/* Baseline Card (Neutral White) */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Database className="w-4 h-4 text-slate-500" />
                <h4 className="text-sm font-semibold text-slate-800">Baseline Hash Table</h4>
              </div>
              <span className="text-xs font-mono text-slate-500">{baselinePerSymbol} B/sym</span>
            </div>

            <div className="mt-4">
              <div className="text-3xl font-bold font-mono text-slate-900">
                {baseline_bytes.toLocaleString()} <span className="text-sm text-slate-500 font-normal">bytes</span>
              </div>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                Standard separate chaining: 64-bit pointers (8B next, 8B name ptr), per-symbol heap chunk allocations, unpacked 32-bit fields.
              </p>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-mono">
            <span>Overhead: High (Pointers)</span>
            <span>Allocations: {symbolCount * 2}</span>
          </div>
        </div>

        {/* Compressed Card (Teal Accent) */}
        <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-teal-700" />
                <h4 className="text-sm font-semibold text-teal-900">Compressed Architecture</h4>
              </div>
              <span className="text-xs font-mono text-teal-800 font-semibold">{compressedPerSymbol} B/sym</span>
            </div>

            <div className="mt-4">
              <div className="text-3xl font-bold font-mono text-teal-800">
                {compressed_bytes.toLocaleString()} <span className="text-sm text-teal-700/80 font-normal">bytes</span>
              </div>
              <p className="text-xs text-teal-900/80 mt-2 leading-relaxed">
                Patricia trie string interning, contiguous 16-bit arena index addressing (no 8B pointers), and 32-bit bit-packed metadata word.
              </p>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-teal-200 flex items-center justify-between text-xs text-teal-800 font-mono">
            <span>Arena Nodes: Contiguous Block</span>
            <span>Pointer Overhead: Zero</span>
          </div>
        </div>
      </div>

      {/* Ablation Study Chart: Proving the Core Research Claim */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
          <div>
            <div className="flex items-center space-x-2">
              <Zap className="w-4 h-4 text-orange-600" />
              <h3 className="text-base font-bold text-slate-900">
                Ablation Benchmark (All 7 Configurations vs Baseline)
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Validates empirical performance across isolated techniques, pairwise combinations, and the unified architecture.
            </p>
          </div>

          <div className="text-xs px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-mono border border-slate-200">
            N = {symbolCount} Symbols
          </div>
        </div>

        {/* Horizontal Bar Chart */}
        <div className="space-y-3.5">
          {configurations.map((cfg) => {
            const widthPct = Math.round((cfg.bytes / largestBytes) * 100);
            return (
              <div key={cfg.name} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <span className={`font-semibold ${cfg.isWinner ? 'text-orange-700 font-bold' : 'text-slate-800'}`}>
                      {cfg.name}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded border ${
                        cfg.isWinner
                          ? 'bg-orange-100 text-orange-800 border-orange-200 font-bold'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      {cfg.badge}
                    </span>
                  </div>
                  <div className="flex items-center space-x-3 font-mono">
                    <span className="text-slate-500">{cfg.bytes.toLocaleString()} B</span>
                    <span className={`font-bold min-w-[50px] text-right ${cfg.savings > 0 ? cfg.textColor : 'text-slate-400'}`}>
                      {cfg.savings > 0 ? `-${cfg.savings}%` : 'Baseline'}
                    </span>
                  </div>
                </div>

                {/* Progress Bar Track */}
                <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ease-out ${cfg.color} ${
                      cfg.isWinner ? 'shadow-2xs' : ''
                    }`}
                    style={{ width: `${Math.max(4, Math.min(100, widthPct))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between text-xs text-slate-600 gap-2">
          <div className="flex items-center space-x-1.5">
            <ArrowDownRight className="w-4 h-4 text-teal-700" />
            <span>
              {allThreeWins ? (
                <>
                  <strong>All three techniques together</strong> are the smallest structure here:{' '}
                  <span className="text-orange-600 font-bold font-mono">{savings_pct}%</span> below the baseline.
                </>
              ) : (
                <>
                  <strong>{winner.name}</strong> is the smallest here ({winner.bytes.toLocaleString()} B, -
                  {savingsOf(winner.bytes)}%); all three combined saves{' '}
                  <span className="text-orange-600 font-bold font-mono">{savings_pct}%</span>.
                </>
              )}
            </span>
          </div>
          <span className="text-slate-400 font-mono text-[11px]">Formula: ((Baseline - Variant) / Baseline) &times; 100</span>
        </div>
      </div>

      {/* Peak memory if scopes release their symbols on exit */}
      {peak && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-slate-900">Peak Memory with Scope Release</h4>
              <p className="text-xs text-slate-500 mt-1 max-w-xl">
                A compiler can free a block's symbols when the block closes; this is the largest table needed at any one point ({peak.live_symbols} of {symbolCount} symbols alive together).
              </p>
            </div>
            <div className="flex items-center space-x-6 font-mono text-sm">
              <div>
                <div className="text-[10px] uppercase text-slate-400">Baseline peak</div>
                <div className="text-slate-900 font-bold">{peak.baseline_bytes.toLocaleString()} B</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-slate-400">Compressed peak</div>
                <div className="text-teal-800 font-bold">{peak.compressed_bytes.toLocaleString()} B</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-slate-400">Saved</div>
                <div className="text-orange-600 font-bold">{peak.savings_pct}%</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
