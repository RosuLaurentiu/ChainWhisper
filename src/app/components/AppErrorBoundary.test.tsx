import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AppErrorBoundary from './AppErrorBoundary';

describe('AppErrorBoundary', () => {
  it('shows an App-file reload action for a failed lazy module without losing Help', () => {
    const boundary = new AppErrorBoundary({ children: <p>Conversation</p>,
      fallback: <p>Generic fallback</p>, onOpenHelp: vi.fn() });
    boundary.state = AppErrorBoundary.getDerivedStateFromError(new TypeError(
      'Failed to fetch dynamically imported module: http://localhost:5173/assets/GroupChatPanel-cERemsCR.js'
    ));
    const markup = renderToStaticMarkup(boundary.render());
    expect(markup).toContain('could not load a required file');
    expect(markup).toContain('Reload App');
    expect(markup).toContain('Get help');
    expect(markup).not.toContain('Generic fallback');
    expect(markup).not.toContain('MetaMask');
    expect(markup).not.toContain('http://localhost');
  });

  it('keeps the existing custom fallback for other rendering errors', () => {
    const boundary = new AppErrorBoundary({ children: <p>Conversation</p>, fallback: <p>Generic fallback</p> });
    boundary.state = AppErrorBoundary.getDerivedStateFromError(new Error('Unexpected render failure.'));
    expect(renderToStaticMarkup(boundary.render())).toContain('Generic fallback');
  });

  it('keeps healthy content unchanged', () => {
    const boundary = new AppErrorBoundary({ children: <p>Conversation</p> });
    expect(renderToStaticMarkup(boundary.render())).toBe('<p>Conversation</p>');
  });
});
