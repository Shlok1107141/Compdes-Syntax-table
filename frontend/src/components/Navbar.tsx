import React from 'react';
import { Cpu, Radio, Sparkles } from 'lucide-react';
import type { ExecutionMode } from '../types';

interface NavbarProps {
  mode: ExecutionMode;
  onToggleMode: (newMode: ExecutionMode) => void;
  isBackendAvailable: boolean | null;
}

export const Navbar: React.FC<NavbarProps> = ({ mode, onToggleMode, isBackendAvailable }) => {
  return (
    <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand & Course */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 p-0.5 shadow-lg shadow-indigo-500/20">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Cpu className="w-5 h-5 text-indigo-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-white text-base sm:text-lg tracking-tight">
                Compressed Symbol Table
              </span>
              <span className="hidden sm:inline-block px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                BCSE307L
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              Embedded Memory Optimization Sprint (Patricia Trie + 16b Arena + Bitpack)
            </p>
          </div>
        </div>

        {/* Controls & Badges */}
        <div className="flex items-center space-x-3">
          {/* Mode Toggle Button */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-1 text-xs">
            <button
              onClick={() => onToggleMode('mock')}
              className={`px-3 py-1.5 rounded-md font-medium transition-all flex items-center space-x-1.5 ${
                mode === 'mock'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Runs instant client-side simulation based on engine/symtab_demo.c"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Simulated Mode</span>
            </button>
            <button
              onClick={() => onToggleMode('live')}
              className={`px-3 py-1.5 rounded-md font-medium transition-all flex items-center space-x-1.5 ${
                mode === 'live'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Connects to FastAPI backend at http://localhost:8000/analyze"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Live Backend</span>
              {mode === 'live' && (
                <span
                  className={`w-2 h-2 rounded-full ml-1 ${
                    isBackendAvailable ? 'bg-emerald-300 animate-pulse' : 'bg-amber-400'
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
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors border border-slate-700"
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
