import React from 'react';
import { Play, RotateCcw, Trash2, FileCode, CheckCircle2, Code2 } from 'lucide-react';
import { SAMPLE_PRESETS, CUSTOM_PRESET } from '../data/sampleCodes';
import type { SamplePreset } from '../data/sampleCodes';

interface CodeEditorProps {
  code: string;
  onChange: (value: string) => void;
  onAnalyze: () => void;
  isLoading: boolean;
  loadingStep?: string;
  selectedPresetId: string;
  onSelectPreset: (preset: SamplePreset) => void;
}

const MAX_PAYLOAD_BYTES = 64 * 1024; // 64 KB security limit

export const CodeEditor: React.FC<CodeEditorProps> = ({
  code,
  onChange,
  onAnalyze,
  isLoading,
  loadingStep,
  selectedPresetId,
  onSelectPreset,
}) => {
  const byteCount = new TextEncoder().encode(code).length;
  const isOversized = byteCount > MAX_PAYLOAD_BYTES;
  const lineCount = code.split('\n').length;
  const gutterRef = React.useRef<HTMLDivElement>(null);

  // The gutter never scrolls by itself: it follows the text area.
  const syncGutter = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
  };

  const handleClear = () => {
    onChange('');
    onSelectPreset(CUSTOM_PRESET);
  };

  const handleReset = () => {
    const defaultPreset = SAMPLE_PRESETS[0];
    onSelectPreset(defaultPreset);
  };

  const handleTextChange = (newCode: string) => {
    onChange(newCode);
    // If the edited code doesn't match the current preset, automatically switch to custom
    const matchingPreset = SAMPLE_PRESETS.find((p) => p.code.trim() === newCode.trim());
    if (!matchingPreset && selectedPresetId !== 'custom') {
      onSelectPreset(CUSTOM_PRESET);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const { selectionStart, selectionEnd, value } = textarea;

    if (e.key === 'Tab') {
      e.preventDefault();
      const TAB = '    '; // Standard 4-space tab gap for C code

      if (selectionStart === selectionEnd) {
        if (e.shiftKey) {
          // Shift+Tab: Outdent single line if it starts with spaces
          const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
          const linePrefix = value.substring(lineStart, selectionStart);
          if (linePrefix.startsWith(TAB)) {
            const nextValue = value.substring(0, lineStart) + value.substring(lineStart + 4);
            handleTextChange(nextValue);
            requestAnimationFrame(() => {
              textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, selectionStart - 4);
            });
          } else if (linePrefix.startsWith(' ')) {
            const spacesToRemove = linePrefix.match(/^ +/)?.[0].length || 0;
            const removeCount = Math.min(4, spacesToRemove);
            const nextValue = value.substring(0, lineStart) + value.substring(lineStart + removeCount);
            handleTextChange(nextValue);
            requestAnimationFrame(() => {
              textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, selectionStart - removeCount);
            });
          }
        } else {
          // Tab: Insert 4 spaces at cursor position
          const nextValue = value.substring(0, selectionStart) + TAB + value.substring(selectionEnd);
          handleTextChange(nextValue);
          requestAnimationFrame(() => {
            textarea.selectionStart = textarea.selectionEnd = selectionStart + TAB.length;
          });
        }
      } else {
        // Multi-line selection: indent or outdent all selected lines
        const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
        const lineEnd = value.indexOf('\n', selectionEnd);
        const effectiveEnd = lineEnd === -1 ? value.length : lineEnd;

        const selectedText = value.substring(lineStart, effectiveEnd);
        const lines = selectedText.split('\n');

        let startDelta = 0;
        let totalDelta = 0;

        let modifiedLines: string[];
        if (e.shiftKey) {
          // Shift+Tab: Outdent lines
          modifiedLines = lines.map((line, idx) => {
            if (line.startsWith(TAB)) {
              if (idx === 0) startDelta = -4;
              totalDelta -= 4;
              return line.substring(4);
            } else if (line.startsWith(' ')) {
              const spaces = line.match(/^ +/)?.[0].length || 0;
              const removeCount = Math.min(4, spaces);
              if (idx === 0) startDelta = -removeCount;
              totalDelta -= removeCount;
              return line.substring(removeCount);
            }
            return line;
          });
        } else {
          // Tab: Indent all lines
          modifiedLines = lines.map((line, idx) => {
            if (idx === 0) startDelta = 4;
            totalDelta += 4;
            return TAB + line;
          });
        }

        const nextValue =
          value.substring(0, lineStart) + modifiedLines.join('\n') + value.substring(effectiveEnd);
        handleTextChange(nextValue);
        requestAnimationFrame(() => {
          textarea.selectionStart = Math.max(lineStart, selectionStart + startDelta);
          textarea.selectionEnd = Math.max(lineStart, selectionEnd + totalDelta);
        });
      }
    } else if (e.key === 'Enter') {
      // Auto-indent on Enter to preserve current indentation level
      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
      const currentLine = value.substring(lineStart, selectionStart);
      const matchIndent = currentLine.match(/^[ \t]+/);
      const indent = matchIndent ? matchIndent[0] : '';
      const extraIndent = currentLine.trim().endsWith('{') ? '    ' : '';

      if (indent || extraIndent) {
        e.preventDefault();
        const addition = '\n' + indent + extraIndent;
        const nextValue = value.substring(0, selectionStart) + addition + value.substring(selectionEnd);
        handleTextChange(nextValue);
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = selectionStart + addition.length;
        });
      }
    }
  };

  const activePreset = SAMPLE_PRESETS.find((p) => p.id === selectedPresetId) || CUSTOM_PRESET;

  return (
    <div className="flex flex-col h-full rounded-xl border-2 border-slate-300 bg-white overflow-hidden shadow-xs">
      {/* Top Header Bar */}
      <div className="px-4 py-3 border-b-2 border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          <FileCode className="w-4 h-4 text-teal-800" />
          <span className="text-sm font-bold text-slate-900 tracking-tight">C Source Editor</span>
          <span className="text-xs text-slate-600 font-mono font-bold">({lineCount} lines)</span>
        </div>

        {/* Preset Selector */}
        <div className="flex items-center space-x-2 min-w-0 max-w-full">
          <label htmlFor="preset-select" className="text-xs text-slate-700 font-bold hidden sm:inline shrink-0">
            Source Preset:
          </label>
          <select
            id="preset-select"
            value={selectedPresetId}
            onChange={(e) => {
              const p = SAMPLE_PRESETS.find((preset) => preset.id === e.target.value);
              if (p) onSelectPreset(p);
            }}
            className="min-w-0 max-w-full text-xs bg-white border-2 border-slate-300 text-slate-900 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-700 font-bold shadow-2xs"
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
      <div className="px-4 py-2 bg-teal-50/60 border-b border-teal-200 flex items-center justify-between text-xs text-slate-700 font-medium">
        <div className="flex items-center space-x-2 truncate pr-2">
          {selectedPresetId === 'custom' ? (
            <Code2 className="w-3.5 h-3.5 text-orange-600 shrink-0" />
          ) : null}
          <span className="truncate">{activePreset.description}</span>
        </div>
        <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-teal-100 text-teal-900 border border-teal-300 shrink-0 ml-2">
          {activePreset.badge}
        </span>
      </div>

      {/* Code Textarea with Line Numbers */}
      <div className="relative flex-1 min-h-[360px] flex overflow-hidden bg-white font-mono text-xs sm:text-sm">
        {/* Line Numbers Sidebar (clipped; scrolled together with the text area) */}
        <div ref={gutterRef} aria-hidden="true"
          className="pt-4 pb-10 pl-3 pr-2.5 select-none text-right text-slate-500 font-bold bg-slate-50 border-r-2 border-slate-200 min-w-[46px] overflow-hidden">
          {Array.from({ length: Math.max(lineCount, 18) }).map((_, i) => (
            <div key={i} className="leading-6 text-[11px]">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Text Input */}
        <textarea
          value={code}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={syncGutter}
          wrap="off"
          placeholder="// Paste or write your own C code declarations, structs, and functions here...
int sensor_temp;
int sensor_press;
struct MotorState {
    int rpm;
    float current;
};
void system_init(int bus_rate) {
    int local_counter = 0;
}"
          className="w-full h-full p-4 bg-white text-slate-900 focus:outline-none resize-none leading-6 font-mono font-medium placeholder:text-slate-400 whitespace-pre overflow-auto"
          spellCheck={false}
        />
      </div>

      {/* Bottom Action Footer */}
      <div className="p-3 border-t-2 border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center space-x-2">
          {/* Byte size indicator */}
          <div
            className={`text-xs px-2.5 py-1.5 rounded-md font-mono font-bold flex items-center space-x-1 border ${
              isOversized
                ? 'bg-rose-50 text-rose-800 border-rose-300'
                : byteCount > 32 * 1024
                ? 'bg-amber-50 text-amber-900 border-amber-300'
                : 'bg-white text-slate-800 border-slate-300 shadow-2xs'
            }`}
          >
            <span>{byteCount.toLocaleString()} / 65,536 B</span>
            {!isOversized && <CheckCircle2 className="w-3.5 h-3.5 text-teal-700 ml-1" />}
          </div>

          <button
            type="button"
            onClick={handleReset}
            className="p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-200 transition-colors border border-slate-200 shadow-2xs"
            title="Reset to Benchmark Preset"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleClear}
            className="p-2 rounded-lg text-slate-600 hover:text-rose-700 hover:bg-rose-50 transition-colors border border-slate-200 shadow-2xs"
            title="Clear and write custom code"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Analyze Button (Primary Orange CTA with visible progress state) */}
        <button
          type="button"
          onClick={onAnalyze}
          disabled={isLoading || isOversized || code.trim().length === 0}
          className={`px-6 py-2.5 rounded-lg text-sm font-extrabold flex items-center space-x-2 transition-all shadow-xs ${
            isLoading || isOversized || code.trim().length === 0
              ? 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300'
              : 'bg-orange-600 hover:bg-orange-700 text-white active:translate-y-px'
          }`}
        >
          {isLoading ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span>{loadingStep || 'Analyzing Symbol Table...'}</span>
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
