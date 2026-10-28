import { useState, useCallback, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { CodeEditor } from './components/CodeEditor';
import { MetricsDashboard } from './components/MetricsDashboard';
import { SymbolTableView } from './components/SymbolTableView';
import { RadixTrieVisualizer } from './components/RadixTrieVisualizer';
import { SyntaxTableSuite } from './components/SyntaxTableSuite';
import { HardwareTelemetry } from './components/HardwareTelemetry';
import { UnoLive } from './components/UnoLive';
import { ErrorBanner } from './components/ErrorBanner';
import { SAMPLE_PRESETS } from './data/sampleCodes';
import type { SamplePreset } from './data/sampleCodes';
import { analyzeCode, checkBackendHealth, offlineResultFor } from './services/api';
import type { AnalyzeResponse, ExecutionMode } from './types';
import { BarChart3, Hash, Network } from 'lucide-react';

export function App() {
  const [mainView, setMainView] = useState<'symbol' | 'syntax' | 'hardware'>('symbol');
  const [hardwareBoard, setHardwareBoard] = useState<'uno' | 'esp32'>('uno');
  const [code, setCode] = useState<string>(SAMPLE_PRESETS[0].code);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(SAMPLE_PRESETS[0].id);
  const [mode, setMode] = useState<ExecutionMode>('offline');
  const [isBackendAvailable, setIsBackendAvailable] = useState<boolean | null>(null);

  const [activeTab, setActiveTab] = useState<'metrics' | 'symbols' | 'trie'>('metrics');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalyzeResponse | null>(() =>
    offlineResultFor(SAMPLE_PRESETS[0].code)
  );

  // Trigger analysis with deliberate wait time and processing feedback
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
      setLoadingStep('Tokenizing C declarations & resolving scopes...');
      const startTime = Date.now();

      try {
        // Slight deliberate wait time to process properly and give realistic engine crunch feedback
        await new Promise((r) => setTimeout(r, 350));
        setLoadingStep('Building Radix Patricia Trie & computing ablation matrix...');

        const result = await analyzeCode(codeToAnalyze, targetMode);

        // Ensure minimum duration of 750ms so user visibly sees the engine processing without flickering
        const elapsed = Date.now() - startTime;
        if (elapsed < 750) {
          await new Promise((r) => setTimeout(r, 750 - elapsed));
        }

        setAnalysisData(result);
        if (targetMode === 'live') {
          setIsBackendAvailable(true);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error during analysis.';
        setError(msg);
        const unreachable =
          msg.includes('Could not connect') || msg.includes('timed out') || msg.includes('HTTP 503');
        if (targetMode === 'live' && unreachable) {
          setIsBackendAvailable(false);
        }
      } finally {
        setIsLoading(false);
        setLoadingStep('');
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
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col selection:bg-teal-100 selection:text-teal-900">
      {/* Navigation Header */}
      <Navbar
        mode={mode}
        onToggleMode={handleToggleMode}
        isBackendAvailable={isBackendAvailable}
        activeTab={mainView}
        onSelectTab={setMainView}
      />

      {/* Mobile/Tablet Sub-Header Switcher */}
      <div className="md:hidden flex items-center justify-center p-2.5 bg-slate-100 border-b border-slate-300 gap-2">
        <button
          type="button"
          onClick={() => setMainView('symbol')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
            mainView === 'symbol'
              ? 'bg-white text-slate-900 border border-slate-300 shadow-xs'
              : 'text-slate-600'
          }`}
        >
          Symbol Table
        </button>
        <button
          type="button"
          onClick={() => setMainView('syntax')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
            mainView === 'syntax'
              ? 'bg-teal-800 text-white shadow-xs'
              : 'text-slate-600'
          }`}
        >
          Syntax Suite
        </button>
        <button
          type="button"
          onClick={() => setMainView('hardware')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
            mainView === 'hardware'
              ? 'bg-teal-800 text-white shadow-xs'
              : 'text-slate-600'
          }`}
        >
          Hardware
        </button>
      </div>

      {/* Main Workspace Container (Expansive width for wide displays) */}
      <main className="flex-1 max-w-[1720px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {mainView === 'syntax' ? (
          <SyntaxTableSuite />
        ) : mainView === 'hardware' ? (
          <div className="space-y-4">
            <div className="inline-flex p-1 rounded-lg bg-slate-100 border-2 border-slate-300 text-xs font-bold">
              {([['uno', 'Arduino Uno (live)'], ['esp32', 'ESP32']] as const).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setHardwareBoard(id)}
                  className={`px-3 py-1.5 rounded-md ${hardwareBoard === id ? 'bg-teal-800 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}>
                  {label}
                </button>
              ))}
            </div>
            {hardwareBoard === 'uno' ? <UnoLive editorCode={code} /> : <HardwareTelemetry currentCode={code} />}
          </div>
        ) : (
          <>
            {/* Error / Status Alerts */}
            <ErrorBanner
              error={error}
              onDismiss={() => setError(null)}
              mode={mode}
              onSwitchToOffline={() => handleToggleMode('offline')}
            />

            {/* 2-Column Responsive Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Code Editor Input (5 cols on lg, 4 on xl) */}
          <div className="lg:col-span-5 xl:col-span-4 h-[720px] xl:h-[780px]">
            <CodeEditor
              code={code}
              onChange={setCode}
              onAnalyze={() => runAnalysis(code, mode)}
              isLoading={isLoading}
              loadingStep={loadingStep}
              selectedPresetId={selectedPresetId}
              onSelectPreset={handleSelectPreset}
            />
          </div>

          {/* Right Column: Analysis Tabs & Results (7 cols on lg, 8 on xl) */}
          <div className="lg:col-span-7 xl:col-span-8 space-y-4">
            {/* View Selector Tabs */}
            <div className="flex items-center space-x-2 border-b-2 border-slate-200 pb-2.5">
              <button
                type="button"
                onClick={() => setActiveTab('metrics')}
                className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-extrabold transition-all flex items-center space-x-2 ${
                  activeTab === 'metrics'
                    ? 'bg-teal-800 text-white shadow-xs'
                    : 'bg-white border-2 border-slate-200 text-slate-700 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                <span>Metrics & Ablation</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('symbols')}
                className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-extrabold transition-all flex items-center space-x-2 ${
                  activeTab === 'symbols'
                    ? 'bg-teal-800 text-white shadow-xs'
                    : 'bg-white border-2 border-slate-200 text-slate-700 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                <Hash className="w-4 h-4" />
                <span>
                  Symbol Table{' '}
                  {analysisData?.symbol_table && (
                    <span className="ml-1 text-xs opacity-90 font-mono font-bold">
                      ({analysisData.symbol_table.length})
                    </span>
                  )}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('trie')}
                className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-extrabold transition-all flex items-center space-x-2 ${
                  activeTab === 'trie'
                    ? 'bg-teal-800 text-white shadow-xs'
                    : 'bg-white border-2 border-slate-200 text-slate-700 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                <Network className="w-4 h-4" />
                <span>Radix Trie Visualizer</span>
                <span className="hidden sm:inline-block px-1.5 py-0.2 rounded text-[10px] bg-orange-100 text-orange-900 font-black uppercase border border-orange-300">
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
                <p className="mt-3 text-xs text-slate-600 font-medium">
                  Offline mode: precomputed C engine results for built-in benchmark samples. You can also write or paste custom C code above to evaluate it.
                </p>
              )}

              {activeTab === 'trie' && (
                <RadixTrieVisualizer symbols={analysisData?.symbol_table || []} />
              )}
            </div>
          </div>
        </div>
        </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t-2 border-slate-200 bg-white py-4 mt-8 text-center text-xs text-slate-600">
        <div className="max-w-[1720px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-between gap-2">
          <span>
            BCSE307L Compiler Design &bull; Sprint Webapp &bull; Frontend Lead <strong>Sagnik Datta</strong>
          </span>
          <div className="flex items-center space-x-3 text-slate-600 font-mono text-xs font-bold">
            <span>Contract: POST /analyze</span>
            <span>&bull;</span>
            <span>Architecture: Patricia Trie + 16b Arena + Bitpack</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
