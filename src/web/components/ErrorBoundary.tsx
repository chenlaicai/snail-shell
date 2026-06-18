import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-[13px] text-text-muted">
          <div className="text-lg text-status-red">组件错误</div>
          <div className="text-text-muted">{this.state.error?.message}</div>
          <button
            className="rounded-md border border-shell-600/40 bg-surface-2 px-2.5 py-1 text-xs font-medium text-shell-400 transition-colors hover:bg-shell-600/10"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
