import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, textAlign: "center" }}>
          <h2>页面出错了</h2>
          <p style={{ color: "var(--c-muted)" }}>{this.state.error.message}</p>
          <button
            className="btn-solid"
            type="button"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
