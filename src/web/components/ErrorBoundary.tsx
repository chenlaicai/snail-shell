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
        <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px] flex-col gap-4">
          <div style={{ fontSize: "var(--font-size-lg)", color: "var(--color-danger-text)" }}>组件错误</div>
          <div style={{ color: "var(--color-text-muted)" }}>{this.state.error?.message}</div>
          <button
            className="primary-button"
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
