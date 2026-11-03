import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getProviderErrorMessage, isAppModuleLoadError } from '../../lib/appShared/core';

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
  onOpenHelp?: () => void;
  resetKey?: string;
};

type State = {
  hasError: boolean;
  appFileMessage: string;
};

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, appFileMessage: '' };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, appFileMessage: isAppModuleLoadError(error)
      ? getProviderErrorMessage(error, 'An App file could not be loaded.') : '' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      '[AppErrorBoundary]',
      getProviderErrorMessage(error, 'Unexpected interface failure.'),
      info.componentStack
    );
  }

  componentDidUpdate(previousProps: Props) {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.state.appFileMessage) {
        return (
          <div className="chat-placeholder" role="alert">
            <strong>{this.state.appFileMessage}</strong>
            <div className="app-error-boundary-actions">
              <button type="button" onClick={() => window.location.reload()}>Reload App</button>
              {this.props.onOpenHelp ? (
                <button type="button" className="app-help-context-link" onClick={this.props.onOpenHelp}>Get help</button>
              ) : null}
            </div>
          </div>
        );
      }
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
