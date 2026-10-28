import React from 'react';
import { Cpu, Radio, Sparkles } from 'lucide-react';
import type { ExecutionMode } from '../types';

interface NavbarProps {
  mode: ExecutionMode;
  onToggleMode: (newMode: ExecutionMode) => void;
  isBackendAvailable: boolean | null;
  activeTab?: 'symbol' | 'syntax' | 'hardware';
  onSelectTab?: (tab: 'symbol' | 'syntax' | 'hardware') => void;
}

export const Navbar: React.FC<NavbarProps> = ({ 
  mode, 
  onToggleMode, 
  isBackendAvailable, 
  activeTab = 'symbol', 
  onSelectTab 
}) => {
  return (
    <header className="border-b-2 border-slate-200 bg-white sticky top-0 z-50 shadow-2xs">
      <div className="max-w-[1720px] w-full mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand & Course */}
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-teal-800 text-white flex items-center justify-center shadow-xs">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-black text-slate-900 text-base sm:text-lg tracking-tight">
                  Compiler Table Optimizer
                </span>
                <span className="hidden sm:inline-block px-2 py-0.2 text-xs font-bold rounded-md bg-teal-50 text-teal-900 border border-teal-300">
                  BCSE307L
                </span>
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          {onSelectTab && (
            <div className="hidden md:flex items-center bg-slate-100 p-1 rounded-lg border border-slate-300 text-xs font-bold">
              <button
                type="button"
                onClick={() => onSelectTab('symbol')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  activeTab === 'symbol'
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-300 font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Symbol Table (Trie/Arena)
              </button>
              <button
                type="button"
                onClick={() => onSelectTab('syntax')}
                className={`px-3 py-1.5 rounded-md transition-all flex items-center space-x-1.5 ${
                  activeTab === 'syntax'
                    ? 'bg-teal-800 text-white shadow-xs font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>Syntax Table Suite</span>
                <span className="px-1.5 py-0.2 rounded text-[10px] bg-orange-500 text-white font-extrabold uppercase">
                  6-Pillar
                </span>
              </button>
              <button
                type="button"
                onClick={() => onSelectTab('hardware')}
                className={`px-3 py-1.5 rounded-md transition-all flex items-center space-x-1.5 ${
                  activeTab === 'hardware'
                    ? 'bg-teal-800 text-white shadow-xs font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>Hardware</span>
                <span className="px-1.5 py-0.2 rounded text-[10px] bg-emerald-600 text-white font-extrabold uppercase">
                  Uno · ESP32
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Controls & Badges */}
        <div className="flex items-center space-x-3">
          {mode === 'live' && (
            <div
              className={`hidden sm:flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-mono font-bold border ${
                isBackendAvailable
                  ? 'bg-teal-50 border-teal-300 text-teal-900'
                  : 'bg-amber-50 border-amber-300 text-amber-900'
              }`}
              title={
                isBackendAvailable
                  ? 'Connected to FastAPI backend with native C engine ready'
                  : 'Backend not responding (start it with uvicorn on port 8000)'
              }
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isBackendAvailable ? 'bg-teal-600 animate-pulse' : 'bg-amber-600'
                }`}
              />
              <span>{isBackendAvailable ? 'Engine Online' : 'Engine Offline'}</span>
            </div>
          )}

          {/* Mode Toggle Button */}
          <div className="flex items-center bg-slate-100 border border-slate-300 rounded-lg p-1 text-xs">
            <button
              type="button"
              onClick={() => onToggleMode('offline')}
              className={`px-3 py-1.5 rounded-md font-bold transition-all flex items-center space-x-1.5 ${
                mode === 'offline'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-300'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Built-in precomputed samples & instant client simulation"
            >
              <Sparkles className="w-3.5 h-3.5 text-teal-700" />
              <span>Offline / Simulation</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleMode('live')}
              className={`px-3 py-1.5 rounded-md font-bold transition-all flex items-center space-x-1.5 ${
                mode === 'live'
                  ? 'bg-teal-800 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Runs native C engine on code in the editor via POST /analyze"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Live Backend</span>
              {mode === 'live' && (
                <span
                  className={`w-2 h-2 rounded-full ml-1 ${
                    isBackendAvailable ? 'bg-teal-300 animate-pulse' : 'bg-orange-300'
                  }`}
                />
              )}
            </button>
          </div>

          {/* GitHub Icon */}
          <a
            href="https://github.com/Shlok1107141/Compdes-Syntax-table"
            target="_blank"
            rel="noreferrer"
            className="p-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 transition-colors border border-slate-300 shadow-2xs"
            title="View on GitHub"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
          </a>
        </div>
      </div>
    </header>
  );
};
