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

  let title = 'Analysis Notice';
  let badgeStyle = 'border-rose-200 bg-rose-50 text-rose-900';

  if (isNetworkError) {
    title = 'FastAPI Backend Disconnected';
    badgeStyle = 'border-amber-200 bg-amber-50 text-amber-900';
  } else if (isRateLimit) {
    title = 'Security Notice: Rate Limit Exceeded';
    badgeStyle = 'border-orange-200 bg-orange-50 text-orange-900';
  } else if (isPayloadTooLarge) {
    title = 'Security Limit: Payload Exceeds 64 KB';
    badgeStyle = 'border-rose-200 bg-rose-50 text-rose-900';
  } else if (isParseError) {
    title = 'C Semantic Lexer Notice';
    badgeStyle = 'border-teal-200 bg-teal-50 text-teal-900';
  }

  return (
    <div className={`mb-6 rounded-xl border p-4 flex items-start justify-between shadow-xs ${badgeStyle}`}>
      <div className="flex items-start space-x-3">
        {isNetworkError ? (
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        ) : isRateLimit ? (
          <Clock className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
        ) : isPayloadTooLarge ? (
          <Ban className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
        ) : isParseError ? (
          <ShieldAlert className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
        ) : (
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
        )}

        <div>
          <h4 className="text-sm font-bold tracking-tight">{title}</h4>
          <p className="text-xs sm:text-sm mt-1 opacity-90 leading-relaxed font-mono">{error}</p>

          {isNetworkError && mode === 'live' && onSwitchToMock && (
            <div className="mt-3 flex items-center space-x-3 flex-wrap gap-2">
              <button
                type="button"
                onClick={onSwitchToMock}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold shadow-2xs transition-colors"
              >
                <span>Switch to Simulated Mode (Preview Offline)</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs text-slate-500 font-sans">
                (or start backend: <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-700">cd backend && uvicorn main:app --port 8000</code>)
              </span>
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-black/5 transition-colors ml-4 shrink-0"
        title="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
