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
    <div className="flex flex-col h-full rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
      {/* Top Header Bar */}
      <div className="px-4 py-3 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          <FileCode className="w-4 h-4 text-teal-700" />
          <span className="text-sm font-semibold text-slate-900">C Source Input</span>
          <span className="text-xs text-slate-500 font-mono">({lineCount} lines)</span>
        </div>

        {/* Preset Selector */}
        <div className="flex items-center space-x-2">
          <label htmlFor="preset-select" className="text-xs text-slate-600 hidden sm:inline">
            Preset:
          </label>
          <select
            id="preset-select"
            value={selectedPresetId}
            onChange={(e) => {
              const p = SAMPLE_PRESETS.find((preset) => preset.id === e.target.value);
              if (p) onSelectPreset(p);
            }}
            className="text-xs bg-slate-50 border border-slate-300 text-slate-800 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-600 focus:border-teal-600 font-medium"
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
        <div className="px-4 py-2 bg-teal-50/40 border-b border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <span className="truncate">
            {SAMPLE_PRESETS.find((p) => p.id === selectedPresetId)?.description}
          </span>
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-teal-100 text-teal-800 border border-teal-200 shrink-0 ml-2">
            {SAMPLE_PRESETS.find((p) => p.id === selectedPresetId)?.badge}
          </span>
        </div>
      )}

      {/* Code Textarea with Line Numbers */}
      <div className="relative flex-1 min-h-[360px] flex bg-white font-mono text-xs sm:text-sm">
        {/* Line Numbers Sidebar */}
        <div className="py-4 pl-3 pr-2 select-none text-right text-slate-400 bg-slate-50 border-r border-slate-200 min-w-[44px]">
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
          className="w-full h-full p-4 bg-white text-slate-900 focus:outline-none resize-none leading-6 font-mono placeholder:text-slate-400"
          spellCheck={false}
        />
      </div>

      {/* Bottom Action Footer */}
      <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center space-x-2">
          {/* Byte size indicator */}
          <div
            className={`text-xs px-2.5 py-1 rounded-md font-mono flex items-center space-x-1 border ${
              isOversized
                ? 'bg-rose-50 text-rose-700 border-rose-300 font-bold'
                : byteCount > 32 * 1024
                ? 'bg-amber-50 text-amber-800 border-amber-300'
                : 'bg-white text-slate-700 border-slate-200 shadow-2xs'
            }`}
          >
            <span>{byteCount.toLocaleString()} / 65,536 B</span>
            {!isOversized && <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 ml-1" />}
          </div>

          <button
            type="button"
            onClick={handleReset}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200/70 transition-colors"
            title="Reset to Prototype 30"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleClear}
            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
            title="Clear Code"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Analyze Button (Primary Orange CTA) */}
        <button
          type="button"
          onClick={onAnalyze}
          disabled={isLoading || isOversized || code.trim().length === 0}
          className={`px-5 py-2 rounded-lg text-sm font-semibold flex items-center space-x-2 transition-all shadow-xs ${
            isLoading || isOversized || code.trim().length === 0
              ? 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300'
              : 'bg-orange-600 hover:bg-orange-700 text-white active:scale-[0.98]'
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
