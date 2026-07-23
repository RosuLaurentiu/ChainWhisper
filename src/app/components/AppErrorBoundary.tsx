import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
  onOpenHelp?: () => void;
  resetKey?: string;
};

type State = {
  hasError: boolean;
};

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary]', error, info.componentStack);
  }

  componentDidUpdate(previousProps: Props) {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="chat-placeholder" role="alert">
            <strong>Something went wrong.</strong>
            <div className="app-error-boundary-actions">
              <button type="button" onClick={() => this.setState({ hasError: false })}>
                Try again
              </button>
              {this.props.onOpenHelp ? (
                <button type="button" className="app-help-context-link" onClick={this.props.onOpenHelp}>
                  Get help
                </button>
              ) : null}
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
