import type { Page } from '@playwright/test';
import { REWARD_TOKEN_ADDRESS } from '../../../src/lib/appShared/contracts';

// Mainnet UI fixture: owner connection only. It cannot sign or send.
export const installPortalOwner = async (page: Page) => {
  await page.route('https://mainnet.coti.io/**', async (route) => {
    const payload = route.request().postDataJSON();
    const answer = (request: { id: number; method: string; params?: unknown[] }) => {
      const call = request.params?.[0] as { data?: string; to?: string } | undefined;
      const result = request.method === 'eth_chainId' ? '0x282b34'
        : request.method === 'eth_blockNumber' ? '0x989680'
        : request.method === 'eth_getBalance' ? '0x0'
        : request.method === 'eth_call' && call?.to?.toLowerCase() === REWARD_TOKEN_ADDRESS.toLowerCase()
          && call?.data?.startsWith('0x70a08231') ? `0x${'00'.repeat(32)}`
        : undefined;
      return result === undefined
        ? { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'This local fixture admits only public zero-balance reads.' } }
        : { jsonrpc: '2.0', id: request.id, result };
    };
    await route.fulfill({ json: Array.isArray(payload) ? payload.map(answer) : answer(payload) });
  });
  await page.addInitScript(() => {
    const owner = `0x${'11'.repeat(20)}`;
    let connected = false;
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const provider = {
      isMetaMask: true,
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_accounts') return connected ? [owner] : [];
        if (method === 'eth_requestAccounts') { connected = true; return [owner]; }
        if (method === 'eth_chainId') return '0x282b34';
        if (method === 'net_version') return '2632500';
        if (method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts', caveats: [] }];
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
        if (method === 'personal_sign' || method === 'eth_sendTransaction') throw new Error('Signing is forbidden in the Portal UI fixture.');
        return null;
      },
      on: (name: string, callback: (...args: unknown[]) => void) => {
        const callbacks = listeners.get(name) ?? new Set<(...args: unknown[]) => void>();
        callbacks.add(callback); listeners.set(name, callbacks);
      },
      removeListener: (name: string, callback: (...args: unknown[]) => void) => { listeners.get(name)?.delete(callback); }
    };
    Object.defineProperty(window, 'ethereum', { configurable: true, value: provider });
  });
};
