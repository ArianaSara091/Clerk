import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  details: string | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '', details: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let parsedMessage = error.message || 'An unexpected error occurred.';
    let details: string | null = null;

    try {
      const parsed = JSON.parse(error.message);
      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        parsedMessage = parsed.error || parsedMessage;
        details = `${parsed.operationType?.toUpperCase() || 'OP'} on ${parsed.path || 'unknown path'}`;
      }
    } catch {
      // Non-JSON error message
    }

    return {
      hasError: true,
      message: parsedMessage,
      details,
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0B0D14] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#131622] border border-white/10 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h2 className="text-lg font-semibold font-display">Workspace Error</h2>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">{this.state.message}</p>
            {this.state.details && (
              <p className="text-xs font-mono text-slate-400 bg-black/30 border border-white/5 rounded-lg px-3 py-2">
                {this.state.details}
              </p>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white text-sm font-medium transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-4 h-4" />
              Reload Guildspace
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
