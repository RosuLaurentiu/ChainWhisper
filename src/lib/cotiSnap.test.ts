import { describe, expect, it, vi } from 'vitest';
import {
  canStoreCotiSnapAesKeyFromCurrentOrigin,
  deleteCotiSnapAesKeyResult,
  getCotiSnapAesKey,
  getCotiSnapAesKeyResult,
  getCotiSnapAesStatus,
  storeCotiSnapAesKey,
  storeCotiSnapAesKeyResult
} from './cotiSnap';
import type { Eip1193Provider } from './appShared';

const snapId = 'npm:@coti-io/coti-snap';

type ProviderRequest = {
  method: string;
  params?: {
    [snapId]?: Record<string, unknown>;
    request?: {
      method: string;
      params?: Record<string, unknown>;
    };
    snapId?: string;
  };
};

const provider = (handler: (request: ProviderRequest) => unknown): Eip1193Provider =>
  ({
    request: async (request: ProviderRequest) => {
      if (request.method === 'eth_accounts') {
        const handled = handler(request);
        return handled ?? ['0x1111111111111111111111111111111111111111'];
      }
      if (request.method === 'eth_chainId') {
        const handled = handler(request);
        return handled ?? '0x282b34';
      }
      return handler(request);
    }
  }) as unknown as Eip1193Provider;

describe('getCotiSnapAesStatus', () => {
  it('detects unsupported Snap discovery without prompting install', async () => {
    await expect(
      getCotiSnapAesStatus(
        provider(() => {
          throw new Error('unsupported');
        })
      )
    ).resolves.toBe('unsupported');
  });

  it('detects missing and installed Snap states without AES prompts', async () => {
    await expect(
      getCotiSnapAesStatus(provider(({ method }) => (method === 'wallet_getSnaps' ? {} : null)))
    ).resolves.toBe('not-installed');

    await expect(
      getCotiSnapAesStatus(
        provider(({ method }) => {
          if (method === 'wallet_getSnaps') return { [snapId]: {} };
          return null;
        })
      )
    ).resolves.toBe('installed');
  });

  it('does not invoke Snap RPC methods during passive status checks', async () => {
    const invokedMethods: string[] = [];
    await getCotiSnapAesStatus(
      provider(({ method, params }) => {
        if (method === 'wallet_getSnaps') return { [snapId]: {} };
        if (method === 'wallet_invokeSnap') {
          invokedMethods.push(params?.request?.method ?? '');
          return true;
        }
        return null;
      })
    );

    expect(invokedMethods).toEqual([]);
  });
});

describe('getCotiSnapAesKey', () => {
  it('connects the Snap to the active wallet before returning an AES key', async () => {
    const invokedMethods: string[] = [];
    const invokedParams: Array<Record<string, unknown> | undefined> = [];
    const aesKey = await getCotiSnapAesKeyResult(
      provider(({ method, params }) => {
        if (method === 'wallet_getSnaps') return { [snapId]: {} };
        if (method === 'wallet_invokeSnap') {
          const snapMethod = params?.request?.method ?? '';
          invokedMethods.push(snapMethod);
          invokedParams.push(params?.request?.params);
          if (snapMethod === 'get-aes-key') return ' aes-key ';
          return true;
        }
        return null;
      }),
      { expectedChainId: 2632500, walletAddress: '0x1111111111111111111111111111111111111111' }
    );

    expect(aesKey).toEqual({ status: 'ready', aesKey: 'aes-key' });
    expect(invokedMethods).toEqual(['connect-to-wallet', 'has-aes-key', 'get-aes-key']);
    expect(invokedParams).toEqual([undefined, { chainId: '2632500' }, { chainId: '2632500' }]);
  });

  it('returns rejected instead of reading stale AES when Snap wallet sync fails', async () => {
    const aesKey = await getCotiSnapAesKeyResult(
      provider(({ method, params }) => {
        if (method === 'wallet_getSnaps') return { [snapId]: {} };
        if (method === 'wallet_invokeSnap' && params?.request?.method === 'connect-to-wallet') {
          throw Object.assign(new Error('rejected'), { code: 4001 });
        }
        if (method === 'wallet_invokeSnap' && params?.request?.method === 'has-aes-key') return true;
        if (method === 'wallet_invokeSnap' && params?.request?.method === 'get-aes-key') return 'stale-key';
        return null;
      })
    );

    expect(aesKey).toEqual({ status: 'rejected' });
  });

  it('does not read AES when MetaMask active account is not the expected wallet', async () => {
    const invokedMethods: string[] = [];
    const aesKey = await getCotiSnapAesKeyResult(
      provider(({ method, params }) => {
        if (method === 'eth_accounts') return ['0x2222222222222222222222222222222222222222'];
        if (method === 'wallet_getSnaps') return { [snapId]: {} };
        if (method === 'wallet_invokeSnap') {
          invokedMethods.push(params?.request?.method ?? '');
        }
        return null;
      }),
      { walletAddress: '0x1111111111111111111111111111111111111111' }
    );

    expect(aesKey).toEqual({ status: 'wallet-mismatch' });
    expect(invokedMethods).toEqual([]);
  });

  it('rechecks the active account after the Snap connect prompt before reading AES', async () => {
    const invokedMethods: string[] = [];
    let connected = false;
    const aesKey = await getCotiSnapAesKeyResult(
      provider(({ method, params }) => {
        if (method === 'eth_accounts') {
          return connected
            ? ['0x2222222222222222222222222222222222222222']
            : ['0x1111111111111111111111111111111111111111'];
        }
        if (method === 'wallet_getSnaps') return { [snapId]: {} };
        if (method === 'wallet_invokeSnap') {
          const snapMethod = params?.request?.method ?? '';
          invokedMethods.push(snapMethod);
          if (snapMethod === 'connect-to-wallet') {
            connected = true;
            return true;
          }
          if (snapMethod === 'has-aes-key') return true;
          if (snapMethod === 'get-aes-key') return 'wrong-wallet-key';
        }
        return null;
      }),
      { walletAddress: '0x1111111111111111111111111111111111111111' }
    );

    expect(aesKey).toEqual({ status: 'wallet-mismatch' });
    expect(invokedMethods).toEqual(['connect-to-wallet']);
  });

  it('does not read AES when MetaMask is not on COTI Mainnet', async () => {
    const aesKey = await getCotiSnapAesKeyResult(
      provider(({ method }) => {
        if (method === 'eth_chainId') return '0x1';
        if (method === 'wallet_getSnaps') return { [snapId]: {} };
        return null;
      }),
      { walletAddress: '0x1111111111111111111111111111111111111111' }
    );

    expect(aesKey).toEqual({ status: 'wrong-network' });
  });

  it('keeps the legacy null wrapper for existing callers', async () => {
    await expect(
      getCotiSnapAesKey(
        provider(({ method, params }) => {
          if (method === 'wallet_getSnaps') return { [snapId]: {} };
          if (method === 'wallet_invokeSnap' && params?.request?.method === 'connect-to-wallet') return true;
          if (method === 'wallet_invokeSnap' && params?.request?.method === 'has-aes-key') return false;
          return null;
        })
      )
    ).resolves.toBeNull();
  });

  it('reports unsupported when MetaMask Snap RPCs are unavailable', async () => {
    await expect(
      getCotiSnapAesKeyResult(
        provider(({ method }) => {
          if (method === 'wallet_getSnaps') return {};
          if (method === 'wallet_requestSnaps') {
            throw Object.assign(new Error('method not supported'), { code: 4200 });
          }
          return null;
        })
      )
    ).resolves.toEqual({ status: 'unsupported' });
  });
});

describe('storeCotiSnapAesKey', () => {
  it('knows only COTI companion origins may update Snap AES storage', () => {
    expect(canStoreCotiSnapAesKeyFromCurrentOrigin('https://metamask.coti.io')).toBe(true);
    expect(canStoreCotiSnapAesKeyFromCurrentOrigin('https://dev.metamask.coti.io')).toBe(true);
    expect(canStoreCotiSnapAesKeyFromCurrentOrigin('http://localhost:5173')).toBe(false);
  });

  it('does not invoke set-aes-key from unauthorized app origins', async () => {
    const invokedMethods: string[] = [];
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } });

    await expect(
      storeCotiSnapAesKeyResult(
        provider(({ method, params }) => {
          if (method === 'wallet_getSnaps') return { [snapId]: {} };
          if (method === 'wallet_invokeSnap') {
            invokedMethods.push(params?.request?.method ?? '');
            return true;
          }
          return null;
        }),
        'aes-key',
        { walletAddress: '0x1111111111111111111111111111111111111111' }
      )
    ).resolves.toBe('unsupported');

    expect(invokedMethods).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('connects the Snap to the active wallet before storing AES', async () => {
    const invokedMethods: string[] = [];
    await storeCotiSnapAesKey(
      provider(({ method, params }) => {
        if (method === 'wallet_getSnaps') return { [snapId]: {} };
        if (method === 'wallet_invokeSnap') {
          invokedMethods.push(params?.request?.method ?? '');
          return true;
        }
        return null;
      }),
      'aes-key',
      { walletAddress: '0x1111111111111111111111111111111111111111' }
    );

    expect(invokedMethods).toEqual(['connect-to-wallet', 'set-aes-key']);
  });
});

describe('deleteCotiSnapAesKeyResult', () => {
  it('connects the Snap to the active wallet before deleting AES', async () => {
    const invokedMethods: string[] = [];
    await expect(
      deleteCotiSnapAesKeyResult(
        provider(({ method, params }) => {
        if (method === 'wallet_getSnaps') return { [snapId]: {} };
        if (method === 'wallet_invokeSnap') {
          invokedMethods.push(params?.request?.method ?? '');
          return true;
        }
        return null;
      }),
      { walletAddress: '0x1111111111111111111111111111111111111111' }
    )
    ).resolves.toBe('ready');

    expect(invokedMethods).toEqual(['connect-to-wallet', 'delete-aes-key']);
  });
});
