import { useState, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { CodeEditor } from './components/CodeEditor';
import { MetricsDashboard } from './components/MetricsDashboard';
import { SymbolTableView } from './components/SymbolTableView';
import { RadixTrieVisualizer } from './components/RadixTrieVisualizer';
import { ErrorBanner } from './components/ErrorBanner';
import { SAMPLE_PRESETS } from './data/sampleCodes';
import type { SamplePreset } from './data/sampleCodes';
import { analyzeCode, analyzeCodeSimulated } from './services/api';
import type { AnalyzeResponse, ExecutionMode } from './types';
import { BarChart3, Hash, Network } from 'lucide-react';

export function App() {
  const [code, setCode] = useState<string>(SAMPLE_PRESETS[0].code);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(SAMPLE_PRESETS[0].id);
  const [mode, setMode] = useState<ExecutionMode>('mock');
  const [isBackendAvailable, setIsBackendAvailable] = useState<boolean | null>(null);

  const [activeTab, setActiveTab] = useState<'metrics' | 'symbols' | 'trie'>('metrics');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalyzeResponse | null>(() =>
    analyzeCodeSimulated(SAMPLE_PRESETS[0].code)
  );

  // Trigger analysis
  const runAnalysis = useCallback(
    async (codeToAnalyze: string, targetMode: ExecutionMode) => {
      const trimmed = codeToAnalyze.trim();
      if (!trimmed) {
        setError('Please provide non-empty C code declarations before analyzing.');
        return;
      }

      const byteSize = new TextEncoder().encode(codeToAnalyze).length;
      if (byteSize > 64 * 1024) {
        setError(`Payload size (${(byteSize / 1024).toFixed(1)} KB) exceeds the 64 KB security limit.`);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await analyzeCode(codeToAnalyze, targetMode);
        setAnalysisData(result);
        if (targetMode === 'live') {
          setIsBackendAvailable(true);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error during analysis.';
        setError(msg);
        if (targetMode === 'live') {
          setIsBackendAvailable(false);
        }
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const handleSelectPreset = (preset: SamplePreset) => {
    setSelectedPresetId(preset.id);
    setCode(preset.code);
    runAnalysis(preset.code, mode);
  };

  const handleToggleMode = (newMode: ExecutionMode) => {
    setMode(newMode);
    runAnalysis(code, newMode);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* Navigation Header */}
      <Navbar
        mode={mode}
        onToggleMode={handleToggleMode}
        isBackendAvailable={isBackendAvailable}
      />

      {/* Main Workspace Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Error / Status Alerts */}
        <ErrorBanner
          error={error}
          onDismiss={() => setError(null)}
          mode={mode}
          onSwitchToMock={() => handleToggleMode('mock')}
        />

        {/* 2-Column Responsive Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Code Editor Input (5 cols on lg) */}
          <div className="lg:col-span-5 h-[680px]">
            <CodeEditor
              code={code}
              onChange={setCode}
              onAnalyze={() => runAnalysis(code, mode)}
              isLoading={isLoading}
              selectedPresetId={selectedPresetId}
              onSelectPreset={handleSelectPreset}
            />
          </div>

          {/* Right Column: Analysis Tabs & Results (7 cols on lg) */}
          <div className="lg:col-span-7 space-y-4">
            {/* View Selector Tabs */}
            <div className="flex items-center space-x-2 border-b border-slate-800 pb-2">
              <button
                onClick={() => setActiveTab('metrics')}
                className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center space-x-2 ${
                  activeTab === 'metrics'
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                <span>Metrics & Ablation</span>
              </button>

              <button
                onClick={() => setActiveTab('symbols')}
                className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center space-x-2 ${
                  activeTab === 'symbols'
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Hash className="w-4 h-4" />
                <span>
                  Symbol Table{' '}
                  {analysisData?.symbol_table && (
                    <span className="ml-1 text-[11px] opacity-80 font-mono">
                      ({analysisData.symbol_table.length})
                    </span>
                  )}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('trie')}
                className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center space-x-2 ${
                  activeTab === 'trie'
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Network className="w-4 h-4" />
                <span>Radix Trie Visualizer</span>
                <span className="hidden sm:inline-block px-1.5 py-0.2 rounded text-[10px] bg-emerald-500/20 text-emerald-300 font-bold uppercase">
                  Showcase
                </span>
              </button>
            </div>

            {/* Tab Views */}
            <div className="transition-all duration-300">
              {activeTab === 'metrics' && (
                <MetricsDashboard data={analysisData} />
              )}

              {activeTab === 'symbols' && (
                <SymbolTableView symbols={analysisData?.symbol_table || []} />
              )}

              {activeTab === 'trie' && (
                <RadixTrieVisualizer symbols={analysisData?.symbol_table || []} />
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-4 mt-8 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-wrap items-center justify-between gap-2">
          <span>
            BCSE307L Compiler Design &bull; Sprint Webapp &bull; Frontend by <strong>Sagnik Datta</strong>
          </span>
          <div className="flex items-center space-x-3 text-slate-400 font-mono text-[11px]">
            <span>Contract: POST /analyze</span>
            <span>&bull;</span>
            <span>Status: Sanitizer-Verified</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
