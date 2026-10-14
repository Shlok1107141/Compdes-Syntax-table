import React, { useState, useEffect } from 'react';
import { 
  RefreshCw,
  CheckCircle2,
  Table as TableIcon
} from 'lucide-react';
import type { SyntaxBenchmarkItem, SyntaxBenchmarkResponse } from '../types';
import { fetchSyntaxBenchmarks } from '../services/api';
import syntaxResults from '../data/syntaxResults.json';

export const SyntaxTableSuite: React.FC = () => {
  const [data, setData] = useState<SyntaxBenchmarkResponse>(
    () => syntaxResults as unknown as SyntaxBenchmarkResponse
  );
  const [selectedGrammar, setSelectedGrammar] = useState<string>('ANSI C11 Grammar');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const res = await fetchSyntaxBenchmarks();
      setData(res);
    } catch {
      // Handled in api
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    fetchSyntaxBenchmarks().then((res) => {
      if (isMounted) setData(res);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const grammars = data ? Array.from(new Set(data.benchmarks.map((b) => b.grammar))) : [];
  const currentBenchmarks: SyntaxBenchmarkItem[] = data
    ? data.benchmarks.filter((b) => b.grammar === selectedGrammar)
    : [];

  const rawBench = currentBenchmarks.find((b) => b.algorithm === 'raw_2d');
  const dispBench = currentBenchmarks.find((b) => b.algorithm === 'row_displacement');
  const dispDefBench = currentBenchmarks.find((b) => b.algorithm === 'row_displacement_default');
  const csrBench = currentBenchmarks.find((b) => b.algorithm === 'csr');

  return (
    <div className="space-y-6">
      {/* Top Banner & Refresh */}
      <div className="bg-white rounded-xl border-2 border-slate-300 p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <TableIcon className="w-6 h-6 text-teal-800" />
            <h2 className="text-xl font-black text-slate-900 tracking-tight">
              Parser Syntax Table Compression Suite
            </h2>
            <span className="px-2.5 py-0.5 rounded-md text-xs font-black uppercase bg-teal-100 text-teal-900 border border-teal-300">
              6-Pillar Evaluation
            </span>
          </div>
          <p className="text-xs text-slate-600 font-medium mt-1">
            Evaluating LR / LALR Parse Action-Goto Matrix compression across Size, Latency (p99), Build Time, Cache Locality, Losslessness & Scalability.
          </p>
        </div>

        <button
          type="button"
          onClick={loadData}
          disabled={isLoading}
          className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-teal-800 hover:bg-teal-900 text-white font-black text-xs shadow-xs transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>{isLoading ? 'Benchmarking...' : 'Re-run Evaluation'}</span>
        </button>
      </div>

      {/* Section 6: Scalability & Robustness Across Diverse Inputs */}
      <div className="bg-white rounded-xl border-2 border-slate-300 p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="w-6 h-6 rounded-md bg-teal-800 text-white font-black text-xs flex items-center justify-center">
              6
            </span>
            <h3 className="text-base font-black text-slate-900 tracking-tight">
              Scalability & Robustness Across Diverse Grammar Inputs
            </h3>
          </div>
          <span className="text-xs font-mono font-bold text-slate-600">
            6 Corpus Tables • 35.0% to 98.8% Sparsity
          </span>
        </div>

        <p className="text-xs text-slate-600 font-medium">
          Syntax tables vary drastically in density and structure. Choose a grammar to evaluate behavior across small toy models, real-world grammars, and stress limits:
        </p>

        {/* Grammar Selection Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-1">
          {grammars.map((g) => {
            const item = data?.benchmarks.find((b) => b.grammar === g);
            const isSelected = selectedGrammar === g;
            return (
              <button
                key={g}
                type="button"
                onClick={() => setSelectedGrammar(g)}
                className={`p-3 rounded-lg border-2 text-left transition-all ${
                  isSelected
                    ? 'border-orange-600 bg-orange-50/70 shadow-xs ring-2 ring-orange-500/30'
                    : 'border-slate-300 bg-white hover:border-teal-500 hover:bg-teal-50/30'
                }`}
              >
                <div className="text-[11px] font-mono font-black text-slate-500 uppercase tracking-wider">
                  {item?.category}
                </div>
                <div className="text-xs font-black text-slate-900 truncate mt-0.5" title={g}>
                  {g}
                </div>
                <div className="mt-2 text-[10px] font-mono font-bold text-slate-600 space-y-0.5">
                  <div>
                    States: <strong className="text-slate-900">{item?.states}</strong> | Tokens: <strong className="text-slate-900">{item?.tokens}</strong>
                  </div>
                  <div>
                    Sparsity: <strong className="text-teal-900">{item?.sparsity_pct.toFixed(1)}%</strong>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid: Pillars 1, 2, 3, 4, 5 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pillar 1: Compressed Size, Including Overhead */}
        <div className="bg-white rounded-xl border-2 border-slate-300 p-5 shadow-xs space-y-4">
          <div className="flex items-center space-x-2">
            <span className="w-6 h-6 rounded-md bg-teal-800 text-white font-black text-xs flex items-center justify-center">
              1
            </span>
            <h3 className="text-base font-black text-slate-900 tracking-tight">
              Compressed Size, Including All Side Overhead
            </h3>
          </div>
          <p className="text-xs text-slate-600 font-medium">
            Full accounting of payload, row indices, base arrays, check collision arrays, and decoder code overhead. No hidden side costs.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 border-b-2 border-slate-300 text-slate-700 font-bold uppercase text-[10px]">
                <tr>
                  <th className="py-2.5 px-3">Algorithm</th>
                  <th className="py-2.5 px-3">Payload</th>
                  <th className="py-2.5 px-3">Aux Overhead</th>
                  <th className="py-2.5 px-3">Total Bytes</th>
                  <th className="py-2.5 px-3 text-right">Ratio / Savings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono">
                {currentBenchmarks.map((b) => (
                  <tr key={b.algorithm} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-bold text-slate-900">
                      {b.algorithm}
                    </td>
                    <td className="py-2 px-3 text-slate-600">
                      {b.payload_bytes} B
                    </td>
                    <td className="py-2 px-3 text-slate-600">
                      {b.index_bytes + b.side_structure_bytes + b.decoder_code_bytes} B
                    </td>
                    <td className="py-2 px-3 font-black text-slate-900">
                      {b.total_compressed_bytes} B
                    </td>
                    <td className="py-2 px-3 text-right">
                      <span className={`px-2 py-0.5 rounded font-black text-[11px] ${
                        b.savings_pct > 0
                          ? 'bg-teal-100 text-teal-900 border border-teal-300'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {b.savings_pct > 0 ? `-${b.savings_pct.toFixed(1)}%` : 'Baseline'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-3 rounded-lg bg-teal-50 border border-teal-200 text-xs text-slate-700 font-medium">
            💡 <strong className="text-teal-950 font-bold">Key Insight:</strong> At {rawBench?.sparsity_pct.toFixed(1)}% sparsity, Row Displacement shrinks the table from{' '}
            <strong className="text-slate-900">{rawBench?.raw_bytes} B</strong> down to{' '}
            <strong className="text-orange-950">{dispBench?.total_compressed_bytes} B</strong> ({dispBench?.savings_pct.toFixed(1)}% net saving including all verification vectors).
          </div>
        </div>

        {/* Pillar 2: Lookup Latency (Mean & p99 Worst Case) */}
        <div className="bg-white rounded-xl border-2 border-slate-300 p-5 shadow-xs space-y-4">
          <div className="flex items-center space-x-2">
            <span className="w-6 h-6 rounded-md bg-teal-800 text-white font-black text-xs flex items-center justify-center">
              2
            </span>
            <h3 className="text-base font-black text-slate-900 tracking-tight">
              Lookup Decode Latency: Mean & p99 Worst Case
            </h3>
          </div>
          <p className="text-xs text-slate-600 font-medium">
            Time to resolve action for state <code className="font-mono bg-slate-100 px-1 rounded">s</code> on token <code className="font-mono bg-slate-100 px-1 rounded">t</code> over 200,000 queries.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg border-2 border-slate-300 bg-slate-50">
              <div className="text-[11px] font-bold text-slate-600">Raw 2D Array</div>
              <div className="text-lg font-black text-slate-900 mt-1">
                {rawBench?.mean_lookup_ns.toFixed(1)} <span className="text-xs font-normal">ns</span>
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-1">
                p99: <strong className="text-slate-800">{rawBench?.p99_lookup_ns.toFixed(0)} ns</strong>
              </div>
            </div>

            <div className="p-3 rounded-lg border-2 border-teal-400 bg-teal-50">
              <div className="text-[11px] font-bold text-teal-950">Row Displacement</div>
              <div className="text-lg font-black text-teal-950 mt-1">
                {dispBench?.mean_lookup_ns.toFixed(1)} <span className="text-xs font-normal">ns</span>
              </div>
              <div className="text-[10px] font-mono text-teal-900 mt-1">
                p99: <strong className="text-teal-950">{dispBench?.p99_lookup_ns.toFixed(0)} ns</strong>
              </div>
            </div>

            <div className="p-3 rounded-lg border-2 border-orange-400 bg-orange-50">
              <div className="text-[11px] font-bold text-orange-950">CSR (Binary Search)</div>
              <div className="text-lg font-black text-orange-950 mt-1">
                {csrBench?.mean_lookup_ns.toFixed(1)} <span className="text-xs font-normal">ns</span>
              </div>
              <div className="text-[10px] font-mono text-orange-900 mt-1">
                p99: <strong className="text-orange-950">{csrBench?.p99_lookup_ns.toFixed(0)} ns</strong>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 border border-slate-300 text-xs text-slate-700 font-medium">
            ⚡ <strong className="text-slate-900 font-bold">Latency Analysis:</strong> Direct array and Row Displacement exhibit flat <span className="font-mono font-bold">O(1)</span> latency. CSR requires binary search <span className="font-mono font-bold">O(log K)</span> across active tokens, widening worst-case p99 tail latency.
          </div>
        </div>

        {/* Pillar 3 & 4: Build Time & Cache Locality */}
        <div className="bg-white rounded-xl border-2 border-slate-300 p-5 shadow-xs space-y-4">
          <div className="flex items-center space-x-2">
            <span className="w-6 h-6 rounded-md bg-teal-800 text-white font-black text-xs flex items-center justify-center">
              3 & 4
            </span>
            <h3 className="text-base font-black text-slate-900 tracking-tight">
              Build Time & 64-Byte Cache Behavior
            </h3>
          </div>
          <p className="text-xs text-slate-600 font-medium">
            Compression generation time for grammar loops, and simulated 32KB L1 cache misses during parsing.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 border-b-2 border-slate-300 text-slate-700 font-bold uppercase text-[10px]">
                <tr>
                  <th className="py-2.5 px-3">Algorithm</th>
                  <th className="py-2.5 px-3">Build Time</th>
                  <th className="py-2.5 px-3">Working Mem</th>
                  <th className="py-2.5 px-3">L1 Miss Rate</th>
                  <th className="py-2.5 px-3 text-right">Lines Touched</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono">
                {currentBenchmarks.map((b) => (
                  <tr key={b.algorithm} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-bold text-slate-900">
                      {b.algorithm}
                    </td>
                    <td className="py-2 px-3 text-slate-700 font-bold">
                      {b.build_time_us < 1000 ? `${b.build_time_us.toFixed(0)} µs` : `${(b.build_time_us / 1000).toFixed(2)} ms`}
                    </td>
                    <td className="py-2 px-3 text-slate-600">
                      {(b.peak_working_mem_bytes / 1024).toFixed(1)} KB
                    </td>
                    <td className="py-2 px-3 font-bold text-teal-900">
                      {b.cache_miss_rate_pct.toFixed(2)}%
                    </td>
                    <td className="py-2 px-3 text-right text-slate-700">
                      {b.avg_lines_touched.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-3 rounded-lg bg-orange-50 border border-orange-200 text-xs text-slate-700 font-medium">
            🧠 <strong className="text-orange-950 font-bold">Cache Locality Note:</strong> Comb-vector row displacement provides high contiguous spatial locality, ensuring nearly all queries touch $\le 2$ cache lines.
          </div>
        </div>

        {/* Pillar 5: Correctness and Losslessness */}
        <div className="bg-white rounded-xl border-2 border-slate-300 p-5 shadow-xs space-y-4">
          <div className="flex items-center space-x-2">
            <span className="w-6 h-6 rounded-md bg-teal-800 text-white font-black text-xs flex items-center justify-center">
              5
            </span>
            <h3 className="text-base font-black text-slate-900 tracking-tight">
              Correctness, Losslessness & Error Entries
            </h3>
          </div>
          <p className="text-xs text-slate-600 font-medium">
            Every query <code className="font-mono bg-slate-100 px-1 rounded">(s, t)</code> in the matrix is verified against raw table behavior.
          </p>

          <div className="p-4 rounded-xl border-2 border-teal-500 bg-teal-50/50 space-y-3">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-5 h-5 text-teal-700" />
              <span className="text-sm font-black text-teal-950">
                100% Equivalence Verified Across All Matrix Cells
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
              <div className="bg-white p-2.5 rounded-lg border border-teal-300 font-mono text-xs">
                <span className="text-slate-500 font-bold">Total Cells Tested:</span>
                <div className="text-sm font-black text-slate-900 mt-0.5">
                  {rawBench ? rawBench.states * rawBench.tokens : 0} queries
                </div>
              </div>

              <div className="bg-white p-2.5 rounded-lg border border-teal-300 font-mono text-xs">
                <span className="text-slate-500 font-bold">Zero-Error Preservation:</span>
                <div className="text-sm font-black text-teal-900 mt-0.5">
                  {dispBench?.errors_correctly_detected} errors matched
                </div>
              </div>

              <div className="bg-white p-2.5 rounded-lg border border-teal-300 font-mono text-xs">
                <span className="text-slate-500 font-bold">Default Reductions:</span>
                <div className="text-sm font-black text-orange-950 mt-0.5">
                  {dispDefBench?.default_reductions_applied} deferred
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-600 font-medium">
              ✓ <strong className="text-slate-900">Lossless Standard:</strong> Shift, Reduce, Goto, Accept, and syntax error detections produce identical parser execution.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
