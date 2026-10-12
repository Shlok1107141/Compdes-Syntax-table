import React from 'react';
import { AlertCircle, AlertTriangle, X, ArrowRight, ShieldAlert, Clock, Ban } from 'lucide-react';
import type { ExecutionMode } from '../types';

interface ErrorBannerProps {
  error: string | null;
  onDismiss: () => void;
  mode: ExecutionMode;
  onSwitchToMock?: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  error,
  onDismiss,
  mode,
  onSwitchToMock,
}) => {
  if (!error) return null;

  const isNetworkError =
    error.includes('Could not connect') ||
    error.includes('Failed to fetch') ||
    error.includes('NetworkError') ||
    error.includes('ECONNREFUSED') ||
    error.includes('timed out');

  const isRateLimit = error.includes('HTTP 429') || error.includes('Rate Limit');
  const isPayloadTooLarge = error.includes('HTTP 413') || error.includes('Payload Too Large');
  const isParseError = error.includes('HTTP 400') || error.includes('Parse Error');

  let title = 'Analysis Error';
  let badgeColor = 'border-rose-500/30 bg-rose-950/40 text-rose-200 shadow-rose-950/20';

  if (isNetworkError) {
    title = 'FastAPI Backend Disconnected';
    badgeColor = 'border-amber-500/30 bg-amber-950/40 text-amber-200 shadow-amber-950/20';
  } else if (isRateLimit) {
    title = 'Security Notice: Rate Limit Exceeded';
    badgeColor = 'border-purple-500/30 bg-purple-950/40 text-purple-200 shadow-purple-950/20';
  } else if (isPayloadTooLarge) {
    title = 'Security Limit: Payload Exceeds 64 KB';
    badgeColor = 'border-rose-500/30 bg-rose-950/40 text-rose-200 shadow-rose-950/20';
  } else if (isParseError) {
    title = 'C Semantic Lexer Notice';
    badgeColor = 'border-blue-500/30 bg-blue-950/40 text-blue-200 shadow-blue-950/20';
  }

  return (
    <div className={`mb-6 rounded-xl border p-4 backdrop-blur-sm flex items-start justify-between shadow-lg ${badgeColor}`}>
      <div className="flex items-start space-x-3">
        {isNetworkError ? (
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        ) : isRateLimit ? (
          <Clock className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
        ) : isPayloadTooLarge ? (
          <Ban className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
        ) : isParseError ? (
          <ShieldAlert className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
        ) : (
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
        )}

        <div>
          <h4 className="text-sm font-semibold tracking-tight">{title}</h4>
          <p className="text-xs sm:text-sm mt-1 opacity-90 leading-relaxed font-mono">{error}</p>

          {isNetworkError && mode === 'live' && onSwitchToMock && (
            <div className="mt-3 flex items-center space-x-3">
              <button
                type="button"
                onClick={onSwitchToMock}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition-colors"
              >
                <span>Switch to Simulated Mode (Preview Offline)</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs text-slate-400 font-sans">
                (or start backend: <code className="bg-slate-900 px-1 py-0.5 rounded text-slate-300">cd backend && uvicorn main:app --port 8000</code>)
              </span>
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/50 transition-colors ml-4 shrink-0"
        title="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
