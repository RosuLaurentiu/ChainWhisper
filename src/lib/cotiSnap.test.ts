import { describe, expect, it, vi } from 'vitest';
import {
  canStoreCotiSnapAesKeyFromCurrentOrigin,
  deleteCotiSnapAesKeyResult,
  detectWalletSnapCapability,
  getCotiSnapAesKey,
  getCotiSnapAesKeyResult,
  getCotiSnapAesStatus,
  getCotiSnapOwnerAesKeyResult,
  getCotiSnapOwnerAesStatusMessage,
  storeCotiSnapAesKey,
  storeCotiSnapAesKeyResult
} from './cotiSnap';
import type { Eip1193Provider } from './appShared';

const snapId = 'npm:@coti-io/coti-snap';
const currentSnap = { id: snapId, version: '1.0.54-8a5cfb', enabled: true, blocked: false };

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

const providerWithFlags = (
  handler: (request: ProviderRequest) => unknown,
  flags: Record<string, unknown>
): Eip1193Provider =>
  ({
    ...(provider(handler) as object),
    ...flags
  }) as Eip1193Provider;

describe('detectWalletSnapCapability', () => {
  it('times out hanging Snap discovery so unlock can fall back', async () => {
    vi.useFakeTimers();
    const capability = detectWalletSnapCapability(
      provider(({ method }) => {
        if (method === 'wallet_getSnaps') {
          return new Promise(() => {});
        }
        return null;
      })
    );

    await vi.advanceTimersByTimeAsync(1500);
    await expect(capability).resolves.toBe('unsupported');
    vi.useRealTimers();
  });

  it('treats providers with Snap discovery as Snap-capable', async () => {
    await expect(
      detectWalletSnapCapability(provider(({ method }) => (method === 'wallet_getSnaps' ? {} : null)))
    ).resolves.toBe('supported');
  });

  it('treats MetaMask Mobile without Snap RPCs as mobile-unsupported', async () => {
    await expect(
      detectWalletSnapCapability(
        providerWithFlags(() => {
          throw Object.assign(new Error('method not supported'), { code: 4200 });
        }, { isMetaMask: true }),
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile MetaMaskMobile'
      )
    ).resolves.toBe('unsupported-mobile');
  });

  it('uses a Snap-capable provider under mobile device emulation', async () => {
    const requestedMethods: string[] = [];
    await expect(
      detectWalletSnapCapability(
        providerWithFlags(({ method }) => {
          requestedMethods.push(method);
          if (method === 'wallet_getSnaps') return { [snapId]: currentSnap };
          return null;
        }, { isMetaMask: true }),
        'Mozilla/5.0 (Linux; Android 14) Mobile MetaMaskMobile'
      )
    ).resolves.toBe('supported');

    expect(requestedMethods).toEqual(['wallet_getSnaps']);
  });
});

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
          if (method === 'wallet_getSnaps') return { [snapId]: currentSnap };
          return null;
        })
      )
    ).resolves.toBe('installed');
  });

  it('does not ask mobile MetaMask users to install desktop-only Snaps', async () => {
    await expect(
      getCotiSnapAesStatus(
        providerWithFlags(() => {
          throw Object.assign(new Error('method not supported'), { code: 4200 });
        }, { isMetaMask: true }),
        'Mozilla/5.0 (Linux; Android 14) Mobile MetaMaskMobile'
      )
    ).resolves.toBe('unsupported-mobile');
  });

  it('does not invoke Snap RPC methods during passive status checks', async () => {
    const invokedMethods: string[] = [];
    await getCotiSnapAesStatus(
      provider(({ method, params }) => {
        if (method === 'wallet_getSnaps') return { [snapId]: currentSnap };
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
        if (method === 'wallet_getSnaps') return { [snapId]: currentSnap };
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
    expect(invokedParams).toEqual([
      undefined,
      { address: '0x1111111111111111111111111111111111111111', chainId: '2632500' },
      { address: '0x1111111111111111111111111111111111111111', chainId: '2632500' }
    ]);
  });

  it('returns rejected instead of reading stale AES when Snap wallet sync fails', async () => {
    const aesKey = await getCotiSnapAesKeyResult(
      provider(({ method, params }) => {
        if (method === 'wallet_getSnaps') return { [snapId]: currentSnap };
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
        if (method === 'wallet_getSnaps') return { [snapId]: currentSnap };
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
        if (method === 'wallet_getSnaps') return { [snapId]: currentSnap };
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
        if (method === 'wallet_getSnaps') return { [snapId]: currentSnap };
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
          if (method === 'wallet_getSnaps') return { [snapId]: currentSnap };
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

  it('does not request or invoke Snap when passive discovery hangs', async () => {
    vi.useFakeTimers();
    const requestedMethods: string[] = [];
    const aesKey = getCotiSnapAesKeyResult(
      provider(({ method }) => {
        requestedMethods.push(method);
        if (method === 'wallet_getSnaps') {
          return new Promise(() => {});
        }
        return null;
      })
    );

    await vi.advanceTimersByTimeAsync(1500);
    await expect(aesKey).resolves.toEqual({ status: 'unsupported' });
    expect(requestedMethods).not.toContain('wallet_requestSnaps');
    expect(requestedMethods).not.toContain('wallet_invokeSnap');
    vi.useRealTimers();
  });

  it('skips Snap install prompts for MetaMask Mobile', async () => {
    const requestedMethods: string[] = [];

    await expect(
      getCotiSnapAesKeyResult(
        providerWithFlags(({ method }) => {
          requestedMethods.push(method);
          if (method === 'wallet_getSnaps') {
            throw Object.assign(new Error('method not supported'), { code: 4200 });
          }
          return null;
        }, { isMetaMask: true }),
        {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile MetaMaskMobile',
          walletAddress: '0x1111111111111111111111111111111111111111'
        }
      )
    ).resolves.toEqual({ status: 'unsupported-mobile' });

    expect(requestedMethods).not.toContain('wallet_requestSnaps');
    expect(requestedMethods).not.toContain('wallet_invokeSnap');
  });

  it('uses Snap under mobile emulation when the provider supports Snap RPCs', async () => {
    const requestedMethods: string[] = [];

    await expect(
      getCotiSnapAesKeyResult(
        providerWithFlags(({ method, params }) => {
          requestedMethods.push(method);
          if (method === 'eth_accounts') return ['0x1111111111111111111111111111111111111111'];
          if (method === 'eth_chainId') return '0x282b34';
          if (method === 'wallet_getSnaps') return { [snapId]: currentSnap };
          if (method === 'wallet_invokeSnap' && params?.request?.method === 'connect-to-wallet') return true;
          if (method === 'wallet_invokeSnap' && params?.request?.method === 'has-aes-key') return true;
          if (method === 'wallet_invokeSnap' && params?.request?.method === 'get-aes-key') return 'mobile-emulated-aes';
          return null;
        }, { isMetaMask: true }),
        {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile MetaMaskMobile',
          walletAddress: '0x1111111111111111111111111111111111111111'
        }
      )
    ).resolves.toEqual({ status: 'ready', aesKey: 'mobile-emulated-aes' });

    expect(requestedMethods).toContain('wallet_getSnaps');
    expect(requestedMethods).toContain('wallet_invokeSnap');
    expect(requestedMethods).not.toContain('wallet_requestSnaps');
  });
});

describe('getCotiSnapOwnerAesKeyResult', () => {
  it('returns owner AES only from the active owner wallet on COTI mainnet', async () => {
    await expect(
      getCotiSnapOwnerAesKeyResult(
        provider(({ method, params }) => {
          if (method === 'wallet_getSnaps') return { [snapId]: currentSnap };
          if (method === 'wallet_invokeSnap' && params?.request?.method === 'connect-to-wallet') return true;
          if (method === 'wallet_invokeSnap' && params?.request?.method === 'has-aes-key') return true;
          if (method === 'wallet_invokeSnap' && params?.request?.method === 'get-aes-key') return ' owner-aes ';
          return null;
        }),
        '0x1111111111111111111111111111111111111111'
      )
    ).resolves.toEqual({ status: 'ready', aesKey: 'owner-aes' });
  });

  it('maps missing Snap AES to an owner recovery setup message', async () => {
    await expect(
      getCotiSnapOwnerAesKeyResult(
        provider(({ method, params }) => {
          if (method === 'wallet_getSnaps') return { [snapId]: currentSnap };
          if (method === 'wallet_invokeSnap' && params?.request?.method === 'connect-to-wallet') return true;
          if (method === 'wallet_invokeSnap' && params?.request?.method === 'has-aes-key') return false;
          return null;
        }),
        '0x1111111111111111111111111111111111111111'
      )
    ).resolves.toEqual({ status: 'snap-missing-aes' });

    expect(getCotiSnapOwnerAesStatusMessage('snap-missing-aes')).toContain('Each MetaMask install keeps its own Snap keys');
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
          if (method === 'wallet_getSnaps') return { [snapId]: currentSnap };
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
        if (method === 'wallet_getSnaps') return { [snapId]: currentSnap };
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
        if (method === 'wallet_getSnaps') return { [snapId]: currentSnap };
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

describe('COTI Snap version and account binding', () => {
  const wallet = '0x1111111111111111111111111111111111111111';
  const otherWallet = '0x2222222222222222222222222222222222222222';
  const olderSnap = { id: snapId, version: '1.0.52-eeccdb', enabled: true, blocked: false };

  const snapProvider = (
    installed: Record<string, unknown> | null,
    permittedAccounts: string[] | Error,
    requests: Array<{ method: string; params?: unknown }>
  ) =>
    provider((request) => {
      requests.push(request);
      if (request.method === 'wallet_getSnaps') return installed ? { [snapId]: installed } : {};
      if (request.method === 'wallet_requestSnaps') return { [snapId]: currentSnap };
      if (request.method === 'wallet_invokeSnap') {
        const snapMethod = request.params?.request?.method;
        if (snapMethod === 'check-account-permissions') {
          if (permittedAccounts instanceof Error) throw permittedAccounts;
          return { hasPermission: true, currentAccount: permittedAccounts[0] ?? null, permittedAccounts };
        }
        if (snapMethod === 'get-aes-key') return 'snap-aes';
        return true;
      }
      return null;
    });

  const invoked = (requests: Array<{ method: string; params?: unknown }>) =>
    requests
      .filter((request) => request.method === 'wallet_invokeSnap')
      .map((request) => (request.params as { request: { method: string; params?: unknown } }).request);

  it('never asks MetaMask to update an installed Snap, because every Snap update clears its stored keys', async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];
    const aesKey = await getCotiSnapAesKeyResult(snapProvider(olderSnap, [wallet], requests), {
      expectedChainId: 2632500,
      walletAddress: wallet
    });

    expect(aesKey).toEqual({ status: 'ready', aesKey: 'snap-aes' });
    expect(requests.map((request) => request.method)).not.toContain('wallet_requestSnaps');
  });

  it('installs a missing Snap without a version range, so MetaMask selects its allowlisted version', async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];
    await getCotiSnapAesKeyResult(snapProvider(null, [wallet], requests), {
      expectedChainId: 2632500,
      walletAddress: wallet
    });

    const install = requests.find((request) => request.method === 'wallet_requestSnaps');
    expect(install?.params).toEqual({ [snapId]: {} });
  });

  it('confirms the account of a Snap older than 1.0.54 before reading its AES key', async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];
    await getCotiSnapAesKeyResult(snapProvider(olderSnap, [wallet.toUpperCase().replace('0X', '0x')], requests), {
      expectedChainId: 2632500,
      walletAddress: wallet
    });

    expect(invoked(requests).map((request) => request.method)).toEqual([
      'connect-to-wallet',
      'check-account-permissions',
      'has-aes-key',
      'get-aes-key'
    ]);
    expect(invoked(requests)[2].params).toEqual({ address: wallet, chainId: '2632500' });
  });

  it('does not read AES from a Snap older than 1.0.54 that uses a different account', async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];
    const aesKey = await getCotiSnapAesKeyResult(snapProvider(olderSnap, [otherWallet, wallet], requests), {
      expectedChainId: 2632500,
      walletAddress: wallet
    });

    expect(aesKey).toEqual({ status: 'snap-account-mismatch' });
    expect(invoked(requests).map((request) => request.method)).not.toContain('has-aes-key');
    expect(invoked(requests).map((request) => request.method)).not.toContain('get-aes-key');
  });

  it('does not read AES when an older Snap cannot report its account', async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];
    const aesKey = await getCotiSnapAesKeyResult(
      snapProvider({ ...olderSnap, version: '1.0.10-352de1' }, new Error('Method not found'), requests),
      { expectedChainId: 2632500, walletAddress: wallet }
    );

    expect(aesKey).toEqual({ status: 'error' });
    expect(invoked(requests).map((request) => request.method)).not.toContain('get-aes-key');
  });

  it('reads AES by address from Snap 1.0.54 without the older account check', async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];
    const aesKey = await getCotiSnapAesKeyResult(snapProvider(currentSnap, [otherWallet], requests), {
      expectedChainId: 2632500,
      walletAddress: wallet
    });

    expect(aesKey).toEqual({ status: 'ready', aesKey: 'snap-aes' });
    expect(invoked(requests).map((request) => request.method)).toEqual(['connect-to-wallet', 'has-aes-key', 'get-aes-key']);
  });

  it('reports missing Snap account access, not a rejection, when the Snap has no connected account', async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];
    const aesKey = await getCotiSnapAesKeyResult(
      provider((request) => {
        requests.push(request);
        if (request.method === 'wallet_getSnaps') return { [snapId]: currentSnap };
        if (request.method === 'wallet_invokeSnap') return request.params?.request?.method === 'connect-to-wallet' ? false : true;
        return null;
      }),
      { expectedChainId: 2632500, walletAddress: wallet }
    );

    expect(aesKey).toEqual({ status: 'snap-account-mismatch' });
    expect(invoked(requests).map((request) => request.method)).toEqual(['connect-to-wallet']);
  });

  it('maps an account mismatch to an owner message', async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];
    await expect(
      getCotiSnapOwnerAesKeyResult(snapProvider(olderSnap, [otherWallet], requests), wallet, { expectedChainId: 2632500 })
    ).resolves.toEqual({ status: 'snap-account-mismatch' });
    expect(getCotiSnapOwnerAesStatusMessage('snap-account-mismatch')).toContain('does not use this wallet account');
  });

  it('passes the App wallet address when storing and deleting AES', async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];
    const store = snapProvider(currentSnap, [wallet], requests);
    await storeCotiSnapAesKeyResult(store, 'aes-key', { expectedChainId: 2632500, walletAddress: wallet });
    await deleteCotiSnapAesKeyResult(store, { expectedChainId: 2632500, walletAddress: wallet });

    expect(invoked(requests).map((request) => request.params)).toEqual([
      undefined,
      { newUserAesKey: 'aes-key', address: wallet, chainId: '2632500' },
      undefined,
      { address: wallet, chainId: '2632500' }
    ]);
  });

  it('does not delete AES from an older Snap that uses a different account', async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];
    const result = await deleteCotiSnapAesKeyResult(snapProvider(olderSnap, [otherWallet], requests), {
      expectedChainId: 2632500,
      walletAddress: wallet
    });

    expect(result).toBe('snap-account-mismatch');
    expect(invoked(requests).map((request) => request.method)).not.toContain('delete-aes-key');
  });
});
