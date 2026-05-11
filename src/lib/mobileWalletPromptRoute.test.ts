import { describe, expect, it, vi } from 'vitest';
import {
  MOBILE_WALLET_PROMPT_ROUTE_SHIM_KEY,
  beginMobileWalletPromptRouteShim
} from './mobileWalletPromptRoute';

const createMemoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
};

const createMutableBrowserState = (route: string) => {
  const url = new URL(route, 'https://chainwhisper.test');
  const location = {
    pathname: url.pathname,
    search: url.search,
    hash: url.hash
  };
  const history = {
    state: { marker: true },
    replaceState: vi.fn((_state: unknown, _title: string, nextRoute: string) => {
      const nextUrl = new URL(nextRoute, 'https://chainwhisper.test');
      location.pathname = nextUrl.pathname;
      location.search = nextUrl.search;
      location.hash = nextUrl.hash;
    })
  };
  return { history, location };
};

describe('mobile wallet prompt route shim', () => {
  it('temporarily presents the stable trade shell route during mobile trade wallet prompts', () => {
    const storage = createMemoryStorage();
    const { history, location } = createMutableBrowserState('/trades/77?mode=fill#secret');
    const trace = vi.fn();

    const restore = beginMobileWalletPromptRouteShim({
      enabled: true,
      isMobileBrowser: true,
      location,
      storage,
      history,
      now: 123,
      onTrace: trace
    });

    expect(location.pathname).toBe('/trades');
    expect(location.search).toBe(`?p=${encodeURIComponent('/trades/77?mode=fill#secret')}`);
    expect(history.replaceState).toHaveBeenCalledWith(
      history.state,
      '',
      `/trades?p=${encodeURIComponent('/trades/77?mode=fill#secret')}`
    );
    expect(JSON.parse(storage.getItem(MOBILE_WALLET_PROMPT_ROUTE_SHIM_KEY) ?? '{}')).toEqual({
      path: '/trades/77?mode=fill#secret',
      timestamp: 123
    });
    expect(trace).toHaveBeenCalledWith('mobile-prompt-route-shim-start', {
      fromRoute: '/trades/[route]',
      toRoute: '/trades?p=[route]'
    });

    restore();

    expect(location.pathname).toBe('/trades/77');
    expect(location.search).toBe('?mode=fill');
    expect(location.hash).toBe('#secret');
    expect(storage.getItem(MOBILE_WALLET_PROMPT_ROUTE_SHIM_KEY)).toBeNull();
  });

  it('redacts trade route details from traces', () => {
    const storage = createMemoryStorage();
    const { history, location } = createMutableBrowserState('/trades/l/private-link-code?escrow=direct');
    const trace = vi.fn();

    beginMobileWalletPromptRouteShim({
      enabled: true,
      isMobileBrowser: true,
      location,
      storage,
      history,
      onTrace: trace
    });

    expect(trace).toHaveBeenCalledWith('mobile-prompt-route-shim-start', {
      fromRoute: '/trades/[route]',
      toRoute: '/trades?p=[route]'
    });
  });

  it('does not nest the trade shell when the prompt starts from an existing shell route', () => {
    const storage = createMemoryStorage();
    const shellPath = `/trades?p=${encodeURIComponent('/trades/77?mode=fill#secret')}`;
    const { history, location } = createMutableBrowserState(shellPath);

    const restore = beginMobileWalletPromptRouteShim({
      enabled: true,
      isMobileBrowser: true,
      location,
      storage,
      history
    });

    expect(location.pathname).toBe('/trades');
    expect(location.search).toBe(`?p=${encodeURIComponent('/trades/77?mode=fill#secret')}`);
    expect(history.replaceState).toHaveBeenCalledWith(history.state, '', shellPath);

    restore();

    expect(location.pathname).toBe('/trades');
    expect(location.search).toBe(`?p=${encodeURIComponent('/trades/77?mode=fill#secret')}`);
  });

  it('does nothing outside mobile trade routes', () => {
    const storage = createMemoryStorage();
    const { history, location } = createMutableBrowserState('/chat');

    const restore = beginMobileWalletPromptRouteShim({
      enabled: true,
      isMobileBrowser: true,
      location,
      storage,
      history
    });

    restore();

    expect(location.pathname).toBe('/chat');
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(storage.getItem(MOBILE_WALLET_PROMPT_ROUTE_SHIM_KEY)).toBeNull();
  });

  it('leaves successful in-flow navigation alone instead of restoring the old route', () => {
    const storage = createMemoryStorage();
    const { history, location } = createMutableBrowserState('/trades/create');

    const restore = beginMobileWalletPromptRouteShim({
      enabled: true,
      isMobileBrowser: true,
      location,
      storage,
      history
    });
    history.replaceState(history.state, '', '/trades/88');

    restore();

    expect(location.pathname).toBe('/trades/88');
    expect(storage.getItem(MOBILE_WALLET_PROMPT_ROUTE_SHIM_KEY)).toBeNull();
  });
});
