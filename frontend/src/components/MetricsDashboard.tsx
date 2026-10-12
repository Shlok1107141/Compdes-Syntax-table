import React from 'react';
import { Layers, Database, Sparkles, TrendingDown, ArrowDownRight, Zap } from 'lucide-react';
import type { AnalyzeResponse } from '../types';

interface MetricsDashboardProps {
  data: AnalyzeResponse | null;
}

export const MetricsDashboard: React.FC<MetricsDashboardProps> = ({ data }) => {
  if (!data || data.symbol_table.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center text-slate-500 backdrop-blur-sm flex flex-col items-center justify-center min-h-[300px]">
        <Layers className="w-12 h-12 text-slate-700 mb-3" />
        <h3 className="text-base font-semibold text-slate-400">No Analysis Data Yet</h3>
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
    { key: 'bitpack_only', name: 'Bitpack Only', bytes: ablation.bitpack_only, color: 'bg-sky-600', textColor: 'text-sky-400', badge: 'Single Technique' },
    { key: 'arena_only', name: 'Arena Only', bytes: ablation.arena_only, color: 'bg-blue-600', textColor: 'text-blue-400', badge: 'Single Technique' },
    { key: 'trie_only', name: 'Trie Only', bytes: ablation.trie_only, color: 'bg-indigo-600', textColor: 'text-indigo-400', badge: 'Single Technique' },
    { key: 'trie_bitpack', name: 'Trie + Bitpack', bytes: ablation.trie_bitpack, color: 'bg-violet-600', textColor: 'text-violet-400', badge: 'Pairwise Combo' },
    { key: 'arena_bitpack', name: 'Arena + Bitpack', bytes: ablation.arena_bitpack, color: 'bg-purple-600', textColor: 'text-purple-400', badge: 'Pairwise Combo' },
    { key: 'trie_arena', name: 'Trie + Arena', bytes: ablation.trie_arena, color: 'bg-fuchsia-600', textColor: 'text-fuchsia-400', badge: 'Pairwise Combo' },
    { key: 'all_three', name: 'All Three Combined', bytes: compressed_bytes, color: 'bg-gradient-to-r from-emerald-500 to-teal-400', textColor: 'text-emerald-400', badge: 'Trie + Arena + Bitpack' },
  ];
  const winner = techniques.reduce((best, t) => (t.bytes < best.bytes ? t : best));
  const allThreeWins = winner.key === 'all_three';

  const configurations = [
    { key: 'baseline', name: 'Baseline Hash Table', bytes: baseline_bytes, color: 'bg-slate-700', textColor: 'text-slate-400', badge: 'Uncompressed Baseline' },
    ...techniques,
  ].map((cfg) => ({ ...cfg, savings: cfg.key === 'baseline' ? 0 : savingsOf(cfg.bytes), isWinner: cfg.key === winner.key }));

  // Scale bars to the largest configuration: a trie with 8-byte pointers can exceed the baseline.
  const largestBytes = Math.max(...configurations.map((c) => c.bytes), 1);

  return (
    <div className="space-y-6">
      {/* Top Hero Readout Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Hero Card: % Memory Saved */}
        <div className="md:col-span-1 rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-950/40 via-slate-900/60 to-slate-900/80 p-6 relative overflow-hidden shadow-xl shadow-emerald-950/20 backdrop-blur-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
              Memory Savings
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              {densityMultiplier}x Denser
            </span>
          </div>

          <div className="my-4">
            <div className="flex items-baseline space-x-2">
              <span className="text-5xl sm:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-teal-200 to-cyan-300 tracking-tight">
                {savings_pct}%
              </span>
              <TrendingDown className="w-8 h-8 text-emerald-400 mb-1" />
            </div>
            <p className="text-xs text-slate-300 mt-2 font-medium">
              Spared <span className="text-emerald-300 font-bold font-mono">{netBytesSaved} bytes</span> of RAM across {symbolCount} identifiers.
            </p>
          </div>

          <div className="pt-3 border-t border-emerald-500/20 flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>Delta: -{netBytesSaved} B</span>
            <span className="text-emerald-400 font-semibold">{compressedPerSymbol} B/symbol</span>
          </div>
        </div>

        {/* Baseline Card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Database className="w-4 h-4 text-rose-400" />
                <h4 className="text-sm font-semibold text-slate-300">Baseline Hash Table</h4>
              </div>
              <span className="text-xs font-mono text-slate-400">{baselinePerSymbol} B/sym</span>
            </div>

            <div className="mt-4">
              <div className="text-3xl font-bold font-mono text-slate-100">
                {baseline_bytes.toLocaleString()} <span className="text-sm text-slate-400 font-normal">bytes</span>
              </div>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Standard separate chaining: 64-bit pointers (8B next, 8B name ptr), per-symbol heap chunk allocations, unpacked 32-bit fields.
              </p>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500 font-mono">
            <span>Overhead: High</span>
            <span>Allocations: {symbolCount * 2}</span>
          </div>
        </div>

        {/* Compressed Card */}
        <div className="rounded-2xl border border-indigo-500/30 bg-slate-900/60 p-5 backdrop-blur-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <h4 className="text-sm font-semibold text-slate-200">Compressed Architecture</h4>
              </div>
              <span className="text-xs font-mono text-emerald-400 font-semibold">{compressedPerSymbol} B/sym</span>
            </div>

            <div className="mt-4">
              <div className="text-3xl font-bold font-mono text-emerald-300">
                {compressed_bytes.toLocaleString()} <span className="text-sm text-slate-400 font-normal">bytes</span>
              </div>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Patricia trie string interning, contiguous 16-bit arena index addressing (no 8B pointers), and 32-bit bit-packed metadata word.
              </p>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-emerald-400/90 font-mono">
            <span>Arena Nodes: Single Block</span>
            <span>Zero Pointer Bloat</span>
          </div>
        </div>
      </div>

      {/* Ablation Study Chart: Proving the Core Research Claim */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-sm shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
          <div>
            <div className="flex items-center space-x-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <h3 className="text-base font-semibold text-white">
                Ablation Comparison (All 7 Configurations vs Baseline)
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              Every bar is a real structure the C engine built from this code and verified. Which combination is
              smallest depends on the program: the trie pays off when names share prefixes or are redeclared across
              scopes, and costs extra on flat tables of unrelated names.
            </p>
          </div>

          <div className="text-xs px-3 py-1 rounded-full bg-slate-800 text-slate-300 font-mono border border-slate-700">
            N = {symbolCount} Symbols
          </div>
        </div>

        {/* Horizontal Bar Chart */}
        <div className="space-y-3.5">
          {configurations.map((cfg) => {
            const widthPct = Math.round((cfg.bytes / largestBytes) * 100);
            const verdict =
              cfg.key === 'baseline'
                ? 'Baseline'
                : cfg.savings > 0
                ? `-${cfg.savings}%`
                : cfg.savings < 0
                ? `+${-cfg.savings}% larger`
                : 'same';
            return (
              <div key={cfg.key} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <span className={`font-semibold ${cfg.isWinner ? 'text-emerald-300' : 'text-slate-300'}`}>
                      {cfg.name}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                      {cfg.badge}
                    </span>
                    {cfg.isWinner && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold">
                        Smallest for this input
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-3 font-mono">
                    <span className="text-slate-400">{cfg.bytes.toLocaleString()} B</span>
                    <span
                      className={`font-bold min-w-[50px] text-right ${
                        cfg.savings > 0 ? cfg.textColor : cfg.savings < 0 ? 'text-rose-400' : 'text-slate-500'
                      }`}
                    >
                      {verdict}
                    </span>
                  </div>
                </div>

                {/* Progress Bar Track */}
                <div className="h-3 w-full bg-slate-950 rounded-full overflow-hidden p-0.5 border border-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ease-out ${cfg.color} ${
                      cfg.isWinner ? 'shadow-sm shadow-emerald-500/50' : ''
                    }`}
                    style={{ width: `${Math.max(3, widthPct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between text-[11px] text-slate-400 gap-2">
          <div className="flex items-center space-x-1.5">
            <ArrowDownRight className="w-4 h-4 text-emerald-400" />
            <span>
              {allThreeWins ? (
                <>
                  <strong>All three techniques together</strong> are the smallest structure here:{' '}
                  <span className="text-emerald-400 font-bold">{savings_pct}%</span> below the baseline.
                </>
              ) : (
                <>
                  <strong>{winner.name}</strong> is the smallest here ({winner.bytes.toLocaleString()} B, -
                  {savingsOf(winner.bytes)}%); all three combined saves{' '}
                  <span className="text-emerald-400 font-bold">{savings_pct}%</span>.
                </>
              )}
            </span>
          </div>
          <span className="text-slate-500 font-mono">Formula: ((Baseline - Config) / Baseline) * 100</span>
        </div>
      </div>

      {/* Peak memory if scopes release their symbols on exit */}
      {peak && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-slate-200">Peak Memory with Scope Release</h4>
              <p className="text-xs text-slate-400 mt-1 max-w-xl">
                The figures above keep every declaration. A compiler can free a block's symbols when the block
                closes; this is the largest table needed at any one point ({peak.live_symbols} of {symbolCount}{' '}
                symbols alive together).
              </p>
            </div>
            <div className="flex items-center space-x-6 font-mono text-sm">
              <div>
                <div className="text-[10px] uppercase text-slate-500">Baseline peak</div>
                <div className="text-slate-200 font-bold">{peak.baseline_bytes.toLocaleString()} B</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-slate-500">Compressed peak</div>
                <div className="text-emerald-300 font-bold">{peak.compressed_bytes.toLocaleString()} B</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-slate-500">Saved</div>
                <div className="text-emerald-400 font-bold">{peak.savings_pct}%</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
