import React from 'react';
import { Play, RotateCcw, Trash2, FileCode, CheckCircle2 } from 'lucide-react';
import { SAMPLE_PRESETS } from '../data/sampleCodes';
import type { SamplePreset } from '../data/sampleCodes';

interface CodeEditorProps {
  code: string;
  onChange: (value: string) => void;
  onAnalyze: () => void;
  isLoading: boolean;
  selectedPresetId: string;
  onSelectPreset: (preset: SamplePreset) => void;
}

const MAX_PAYLOAD_BYTES = 64 * 1024; // 64 KB security limit

export const CodeEditor: React.FC<CodeEditorProps> = ({
  code,
  onChange,
  onAnalyze,
  isLoading,
  selectedPresetId,
  onSelectPreset,
}) => {
  const byteCount = new TextEncoder().encode(code).length;
  const isOversized = byteCount > MAX_PAYLOAD_BYTES;
  const lineCount = code.split('\n').length;

  const handleClear = () => {
    onChange('');
  };

  const handleReset = () => {
    const defaultPreset = SAMPLE_PRESETS[0];
    onSelectPreset(defaultPreset);
  };

  return (
    <div className="flex flex-col h-full rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl backdrop-blur-sm">
      {/* Top Header Bar */}
      <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/90 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          <FileCode className="w-4 h-4 text-indigo-400" />
          <span className="text-sm font-semibold text-slate-200">C Source Input</span>
          <span className="text-xs text-slate-500 font-mono">({lineCount} lines)</span>
        </div>

        {/* Preset Selector */}
        <div className="flex items-center space-x-2">
          <label htmlFor="preset-select" className="text-xs text-slate-400 hidden sm:inline">
            Preset:
          </label>
          <select
            id="preset-select"
            value={selectedPresetId}
            onChange={(e) => {
              const p = SAMPLE_PRESETS.find((preset) => preset.id === e.target.value);
              if (p) onSelectPreset(p);
            }}
            className="text-xs bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
          >
            {SAMPLE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Preset Details / Description pill */}
      {selectedPresetId && (
        <div className="px-4 py-2 bg-slate-950/40 border-b border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
          <span className="truncate">
            {SAMPLE_PRESETS.find((p) => p.id === selectedPresetId)?.description}
          </span>
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 shrink-0 ml-2">
            {SAMPLE_PRESETS.find((p) => p.id === selectedPresetId)?.badge}
          </span>
        </div>
      )}

      {/* Code Textarea with Line Numbers */}
      <div className="relative flex-1 min-h-[360px] flex bg-slate-950 font-mono text-xs sm:text-sm">
        {/* Line Numbers Sidebar */}
        <div className="py-4 pl-3 pr-2 select-none text-right text-slate-600 bg-slate-950/80 border-r border-slate-800/60 min-w-[42px]">
          {Array.from({ length: Math.max(lineCount, 15) }).map((_, i) => (
            <div key={i} className="leading-6 text-[11px]">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Text Input */}
        <textarea
          value={code}
          onChange={(e) => onChange(e.target.value)}
          placeholder="// Paste or write C code declarations here...
int sensor_temp;
int sensor_press;
void system_init() {
    int local_counter;
}"
          className="w-full h-full p-4 bg-transparent text-slate-200 focus:outline-none resize-none leading-6 font-mono placeholder:text-slate-600"
          spellCheck={false}
        />
      </div>

      {/* Bottom Action Footer */}
      <div className="p-3 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center space-x-2">
          {/* Byte size indicator */}
          <div
            className={`text-xs px-2.5 py-1 rounded-md font-mono flex items-center space-x-1 border ${
              isOversized
                ? 'bg-rose-500/10 text-rose-400 border-rose-500/30 font-bold'
                : byteCount > 32 * 1024
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            <span>{byteCount.toLocaleString()} / 65,536 B</span>
            {!isOversized && <CheckCircle2 className="w-3 h-3 text-emerald-400 ml-1" />}
          </div>

          <button
            type="button"
            onClick={handleReset}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Reset to Prototype 30"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleClear}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
            title="Clear Code"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Analyze Button */}
        <button
          type="button"
          onClick={onAnalyze}
          disabled={isLoading || isOversized || code.trim().length === 0}
          className={`px-5 py-2 rounded-xl text-sm font-semibold flex items-center space-x-2 transition-all shadow-lg ${
            isLoading || isOversized || code.trim().length === 0
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
              : 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white shadow-indigo-500/25 active:scale-[0.98]'
          }`}
        >
          {isLoading ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span>Analyzing...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>Analyze Symbol Table</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
