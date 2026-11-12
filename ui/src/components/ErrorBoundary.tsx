import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp, Terminal } from 'lucide-react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  name?: string;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  isDetailsOpen: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null,
    isDetailsOpen: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error(`[KIN ERROR BOUNDARY: ${this.props.name || 'Component'}]`, error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null, isDetailsOpen: false });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  private toggleDetails = (): void => {
    this.setState((prev) => ({ isDetailsOpen: !prev.isDetailsOpen }));
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const boundaryName = this.props.name || 'Module';
      const isRoot = boundaryName.toLowerCase().includes('root');

      return (
        <div
          className={`flex flex-col items-center justify-center p-6 bg-kin-bg border border-red-500/30 text-kin-text font-sans selection:bg-red-500/30 ${
            isRoot ? 'h-screen w-screen' : 'h-full w-full min-h-[220px] rounded-xl'
          }`}
        >
          <div className="max-w-md w-full bg-kin-surface border border-red-500/40 rounded-xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
                <AlertTriangle className="w-5 h-5 animate-pulse" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-red-400 dark:text-red-200 uppercase tracking-wide font-mono">
                  Runtime Error Caught
                </h3>
                <p className="text-xs text-kin-muted truncate font-mono">
                  Scope: <span className="text-emerald-400 font-semibold">{boundaryName}</span>
                </p>
              </div>
            </div>

            <div className="p-3 bg-kin-card border border-kin-border rounded-lg text-xs font-mono text-red-400 dark:text-red-300 break-words max-h-32 overflow-y-auto">
              {this.state.error?.message || 'Unknown runtime error occurred.'}
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={this.handleReset}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-950/50 transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Recover Component</span>
              </button>

              <button
                type="button"
                onClick={this.toggleDetails}
                className="flex items-center space-x-1 text-[11px] text-kin-subtle hover:text-kin-text transition font-mono cursor-pointer"
              >
                <Terminal className="w-3 h-3" />
                <span>Diagnostics</span>
                {this.state.isDetailsOpen ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
            </div>

            {this.state.isDetailsOpen && (
              <div className="pt-2 border-t border-kin-border space-y-2 text-[10px] font-mono animate-fadeIn">
                <div className="text-kin-subtle uppercase font-bold tracking-wider">Stack Trace:</div>
                <pre className="p-2 bg-kin-card text-kin-muted rounded border border-kin-border max-h-40 overflow-auto whitespace-pre-wrap leading-tight">
                  {this.state.error?.stack || 'No stack trace available.'}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
