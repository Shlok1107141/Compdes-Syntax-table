import { useState, useCallback, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { CodeEditor } from './components/CodeEditor';
import { MetricsDashboard } from './components/MetricsDashboard';
import { SymbolTableView } from './components/SymbolTableView';
import { RadixTrieVisualizer } from './components/RadixTrieVisualizer';
import { ErrorBanner } from './components/ErrorBanner';
import { SAMPLE_PRESETS } from './data/sampleCodes';
import type { SamplePreset } from './data/sampleCodes';
import { analyzeCode, checkBackendHealth, offlineResultFor } from './services/api';
import type { AnalyzeResponse, ExecutionMode } from './types';
import { BarChart3, Hash, Network } from 'lucide-react';

export function App() {
  const [code, setCode] = useState<string>(SAMPLE_PRESETS[0].code);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(SAMPLE_PRESETS[0].id);
  // Start offline (the engine's precomputed sample results); switch to live
  // as soon as the backend reports the engine is ready.
  const [mode, setMode] = useState<ExecutionMode>('offline');
  const [isBackendAvailable, setIsBackendAvailable] = useState<boolean | null>(null);

  const [activeTab, setActiveTab] = useState<'metrics' | 'symbols' | 'trie'>('metrics');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalyzeResponse | null>(() =>
    offlineResultFor(SAMPLE_PRESETS[0].code)
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
        // Only a failed connection means the engine is down; a 400/413/429 is the
        // engine (or its guards) working as intended.
        const unreachable =
          msg.includes('Could not connect') || msg.includes('timed out') || msg.includes('HTTP 503');
        if (targetMode === 'live' && unreachable) {
          setIsBackendAvailable(false);
        }
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // Probe backend health status on mount
  useEffect(() => {
    let isMounted = true;
    checkBackendHealth().then((health) => {
      if (isMounted) {
        const ready = health.online && Boolean(health.engineReady);
        setIsBackendAvailable(ready);
        if (ready) setMode('live');
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleSelectPreset = (preset: SamplePreset) => {
    setSelectedPresetId(preset.id);
    setCode(preset.code);
    runAnalysis(preset.code, mode);
  };

  const handleToggleMode = (newMode: ExecutionMode) => {
    setMode(newMode);
    if (newMode === 'live') {
      checkBackendHealth().then((health) => {
        setIsBackendAvailable(health.online && Boolean(health.engineReady));
      });
    }
    runAnalysis(code, newMode);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col selection:bg-teal-100 selection:text-teal-900">
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
          onSwitchToOffline={() => handleToggleMode('offline')}
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
            <div className="flex items-center space-x-2 border-b border-slate-200 pb-2">
              <button
                type="button"
                onClick={() => setActiveTab('metrics')}
                className={`px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center space-x-2 ${
                  activeTab === 'metrics'
                    ? 'bg-teal-700 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                <span>Metrics & Ablation</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('symbols')}
                className={`px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center space-x-2 ${
                  activeTab === 'symbols'
                    ? 'bg-teal-700 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
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
                type="button"
                onClick={() => setActiveTab('trie')}
                className={`px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center space-x-2 ${
                  activeTab === 'trie'
                    ? 'bg-teal-700 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Network className="w-4 h-4" />
                <span>Radix Trie Visualizer</span>
                <span className="hidden sm:inline-block px-1.5 py-0.2 rounded text-[10px] bg-orange-100 text-orange-800 font-bold uppercase border border-orange-200">
                  Demo
                </span>
              </button>
            </div>

            {/* Tab Views */}
            <div className="transition-all duration-200">
              {activeTab === 'metrics' && (
                <MetricsDashboard data={analysisData} />
              )}

              {activeTab === 'symbols' && (
                <SymbolTableView symbols={analysisData?.symbol_table || []} />
              )}

              {mode === 'offline' && analysisData && analysisData === offlineResultFor(code) && (
                <p className="mt-3 text-[11px] text-slate-500">
                  Offline mode: these are the C engine's real results for this sample, precomputed by{' '}
                  <code className="text-slate-400">backend/scripts/build_sample_results.py</code>.
                </p>
              )}

              {activeTab === 'trie' && (
                <RadixTrieVisualizer symbols={analysisData?.symbol_table || []} />
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 mt-8 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-wrap items-center justify-between gap-2">
          <span>
            BCSE307L Compiler Design &bull; Sprint Webapp &bull; Frontend by <strong>Sagnik Datta</strong>
          </span>
          <div className="flex items-center space-x-3 text-slate-500 font-mono text-[11px]">
            <span>Contract: POST /analyze</span>
            <span>&bull;</span>
            <span>Architecture: Trie + 16b Arena + Bitpack</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
