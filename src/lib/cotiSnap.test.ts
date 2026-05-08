import { describe, expect, it } from 'vitest';
import {
  deleteCotiSnapAesKeyResult,
  getCotiSnapAesKey,
  getCotiSnapAesKeyResult,
  getCotiSnapAesStatus,
  storeCotiSnapAesKey
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
    const aesKey = await getCotiSnapAesKeyResult(
      provider(({ method, params }) => {
        if (method === 'wallet_getSnaps') return { [snapId]: {} };
        if (method === 'wallet_invokeSnap') {
          const snapMethod = params?.request?.method ?? '';
          invokedMethods.push(snapMethod);
          if (snapMethod === 'get-aes-key') return ' aes-key ';
          return true;
        }
        return null;
      })
    );

    expect(aesKey).toEqual({ status: 'ready', aesKey: 'aes-key' });
    expect(invokedMethods).toEqual(['connect-to-wallet', 'has-aes-key', 'get-aes-key']);
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
