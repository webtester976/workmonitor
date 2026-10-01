import React, { Component, ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('WorkMonitor caught an unhandled error:', error, errorInfo);
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center font-bold text-lg">
                !
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Application Notice</h2>
                <p className="text-xs text-slate-400">The application encountered a startup error.</p>
              </div>
            </div>

            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 font-mono text-xs text-rose-300 overflow-x-auto">
              {this.state.error?.message || 'Unknown runtime exception occurred.'}
            </div>

            <div className="text-xs text-slate-400 space-y-1">
              <p>Common causes when deploying to GitHub Pages or custom domains:</p>
              <ul className="list-disc list-inside space-y-0.5 text-slate-300">
                <li>Asset path issues (resolved by setting relative base paths)</li>
                <li>Unconfigured domain origin in Google Cloud Console</li>
              </ul>
            </div>

            <div className="pt-2 flex items-center gap-3">
              <button
                onClick={() => window.location.reload()}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-2.5 rounded-xl transition cursor-pointer"
              >
                Reload Application
              </button>
              <button
                onClick={() => {
                  localStorage.clear();
                  window.location.reload();
                }}
                className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium rounded-xl transition cursor-pointer"
              >
                Clear Cache
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
