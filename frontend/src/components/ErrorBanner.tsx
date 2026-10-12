import React from 'react';
import { AlertCircle, AlertTriangle, X, ArrowRight } from 'lucide-react';
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
    error.includes('Failed to fetch') ||
    error.includes('NetworkError') ||
    error.includes('ECONNREFUSED') ||
    error.includes('timed out');

  return (
    <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-950/40 p-4 backdrop-blur-sm text-rose-200 flex items-start justify-between shadow-lg shadow-rose-950/20">
      <div className="flex items-start space-x-3">
        {isNetworkError ? (
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        ) : (
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
        )}
        <div>
          <h4 className="text-sm font-semibold text-rose-100">
            {isNetworkError ? 'Backend Connection Notice' : 'Analysis Error'}
          </h4>
          <p className="text-sm text-rose-300/90 mt-0.5">{error}</p>

          {isNetworkError && mode === 'live' && onSwitchToMock && (
            <div className="mt-3">
              <button
                onClick={onSwitchToMock}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition-colors"
              >
                <span>Switch to Simulated Mode (Preview Now)</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      <button
        onClick={onDismiss}
        className="p-1 rounded-lg text-rose-400 hover:text-rose-200 hover:bg-rose-900/50 transition-colors ml-4"
        title="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
