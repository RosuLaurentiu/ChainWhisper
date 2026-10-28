import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const walletPanel = '.wallet-header-panel';
const cotiPrivacyPortalUrl = 'https://privacy.coti.io/';
const COTI_CHAIN_ID_HEX = '0x6c11a0';
const TEST_OWNER = '0x1111111111111111111111111111111111111111';
const SENSITIVE_TEST_CALLDATA = `0x${'ab'.repeat(96)}`;

const installMockOwnerWallet = async (page: Page) => {
  await page.addInitScript(({ chainId, owner }) => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const provider = {
      isMetaMask: true,
      selectedAddress: owner,
      chainId,
      networkVersion: String(Number.parseInt(chainId, 16)),
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [owner];
        if (method === 'eth_chainId') return chainId;
        if (method === 'net_version') return String(Number.parseInt(chainId, 16));
        if (method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts', caveats: [] }];
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
        return null;
      },
      on: (eventName: string, handler: (...args: unknown[]) => void) => {
        const handlers = listeners.get(eventName) ?? new Set<(...args: unknown[]) => void>();
        handlers.add(handler);
        listeners.set(eventName, handlers);
      },
      removeListener: (eventName: string, handler: (...args: unknown[]) => void) => {
        listeners.get(eventName)?.delete(handler);
      }
    };
    Object.defineProperty(window, 'ethereum', { configurable: true, value: provider });
  }, { chainId: COTI_CHAIN_ID_HEX, owner: TEST_OWNER });
};

const installMockSnapOwnerWallet = async (page: Page) => {
  await page.addInitScript(({ chainId, owner }) => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const snapId = 'npm:@coti-io/coti-snap';
    const requestedMethods: string[] = [];
    const provider = {
      isMetaMask: true,
      selectedAddress: owner,
      chainId,
      networkVersion: String(Number.parseInt(chainId, 16)),
      request: async ({
        method,
        params
      }: {
        method: string;
        params?: { request?: { method?: string } };
      }) => {
        requestedMethods.push(
          method === 'wallet_invokeSnap' && params?.request?.method
            ? `${method}:${params.request.method}`
            : method
        );
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [owner];
        if (method === 'eth_chainId') return chainId;
        if (method === 'net_version') return String(Number.parseInt(chainId, 16));
        if (method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts', caveats: [] }];
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
        if (method === 'wallet_getSnaps') return { [snapId]: { id: snapId } };
        if (method === 'wallet_invokeSnap' && params?.request?.method === 'connect-to-wallet') return true;
        if (method === 'wallet_invokeSnap' && params?.request?.method === 'has-aes-key') return true;
        if (method === 'wallet_invokeSnap' && params?.request?.method === 'get-aes-key') return 'mobile-emulated-aes';
        return null;
      },
      on: (eventName: string, handler: (...args: unknown[]) => void) => {
        const handlers = listeners.get(eventName) ?? new Set<(...args: unknown[]) => void>();
        handlers.add(handler);
        listeners.set(eventName, handlers);
      },
      removeListener: (eventName: string, handler: (...args: unknown[]) => void) => {
        listeners.get(eventName)?.delete(handler);
      }
    };
    Object.defineProperty(window, '__chainWhisperSnapRequests', {
      configurable: true,
      value: requestedMethods
    });
    Object.defineProperty(window, 'ethereum', { configurable: true, value: provider });
  }, { chainId: COTI_CHAIN_ID_HEX, owner: TEST_OWNER });
};

const installFailingMockOwnerWallet = async (page: Page) => {
  await page.addInitScript(({ calldata, chainId }) => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const provider = {
      isMetaMask: true,
      chainId,
      networkVersion: String(Number.parseInt(chainId, 16)),
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_accounts') return [];
        if (method === 'eth_chainId') return chainId;
        if (method === 'net_version') return String(Number.parseInt(chainId, 16));
        if (method === 'eth_requestAccounts' || method === 'wallet_requestPermissions') {
          const error = new Error(
            `could not coalesce error (payload={ "jsonrpc": "2.0", "method": "${method}", "params": [{ "data": "${calldata}" }] }, chrome-extension://wallet/service-worker.js)`
          );
          Object.assign(error, { code: -32603 });
          throw error;
        }
        return null;
      },
      on: (eventName: string, handler: (...args: unknown[]) => void) => {
        const handlers = listeners.get(eventName) ?? new Set<(...args: unknown[]) => void>();
        handlers.add(handler);
        listeners.set(eventName, handlers);
      },
      removeListener: (eventName: string, handler: (...args: unknown[]) => void) => {
        listeners.get(eventName)?.delete(handler);
      }
    };
    Object.defineProperty(window, 'ethereum', { configurable: true, value: provider });
  }, { calldata: SENSITIVE_TEST_CALLDATA, chainId: COTI_CHAIN_ID_HEX });
};

test.describe('route wallet header policy', () => {
  test('shows the shared app menu on every top-level page', async ({ page }) => {
    for (const route of ['/', '/chat', '/otc', '/otc/desk', '/portal', '/shield', '/treasury']) {
      await page.goto(route);
      const appMenu = page.getByRole('navigation', { name: 'ChainWhisper apps' }).first();
      await expect(appMenu).toBeVisible();
      await expect(appMenu.getByRole('button', { name: 'Chat' })).toBeVisible();
      await expect(appMenu.getByRole('button', { name: 'Trading' })).toBeVisible();
      await expect(appMenu.getByRole('button', { name: 'Privacy Portal' })).toBeVisible();
      await expect(appMenu.getByRole('button', { name: 'Private TVL' })).toBeVisible();
      await expect(appMenu.getByRole('button', { name: 'Home' })).toHaveCount(0);
    }
  });

  test('keeps Home wallet-free and gives Private TVL the shared wallet header', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(walletPanel)).toHaveCount(0);
    await expect(page.locator('.sound-toggle-btn')).toHaveCount(0);

    await page.goto('/home');
    await expect(page.locator(walletPanel)).toHaveCount(0);
    await expect(page.locator('.sound-toggle-btn')).toHaveCount(0);

    await page.goto('/treasury');
    await expect(page.locator('.top-header-brand-subtitle', { hasText: /^Private TVL$/ })).toBeVisible();
    await expect(page.locator(walletPanel)).toBeVisible();
    await expect(page.locator('.top-header .wallet-primary-action')).toBeVisible();
  });

  test('links Home and Privacy Portal to the official COTI Privacy Portal', async ({ page }) => {
    await page.goto('/');
    await page.locator('.top-header-ecosystem-menu > summary').click();
    const headerPrivacyLink = page.getByRole('link', { name: 'Privacy Portal' });
    await expect(headerPrivacyLink).toBeVisible();
    await expect(headerPrivacyLink).toHaveAttribute('href', cotiPrivacyPortalUrl);
    await expect(headerPrivacyLink).toHaveAttribute('target', '_blank');

    await page.goto('/portal');
    const portalPrivacyButton = page.getByRole('link', { name: /View official contracts/i });
    await expect(portalPrivacyButton).toBeVisible();
    await expect(portalPrivacyButton).toHaveAttribute('href', cotiPrivacyPortalUrl);
    await expect(portalPrivacyButton).toHaveAttribute('target', '_blank');
  });

  test('keeps network, notifications, sound, and Help in the shared wallet menu', async ({ page }) => {
    await installMockOwnerWallet(page);
    for (const route of ['/chat', '/otc', '/otc/desk', '/portal', '/shield', '/treasury']) {
      await page.goto(route);
      await expect(page.locator('.sound-toggle-btn')).toHaveCount(0);
      await page.getByRole('button', { name: 'Open Wallet menu' }).click();
      const walletMenu = page.getByRole('menu', { name: 'Wallet' });
      await expect(walletMenu.getByRole('menuitem', { name: /Network/i })).toBeVisible();
      await expect(walletMenu.getByText('Notifications', { exact: true })).toBeVisible();
      await expect(walletMenu.getByRole('switch', { name: /Turn notification sound/i })).toBeVisible();
      await expect(walletMenu.getByRole('menuitem', { name: 'Help' })).toBeVisible();
    }

    await page.goto('/');
    await expect(page.locator('.sound-toggle-btn')).toHaveCount(0);
  });

  test('shows browser-wallet controls across wallet-enabled app pages', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.locator(walletPanel)).toBeVisible();
    await expect(page.locator('.top-header .wallet-primary-action')).toBeVisible();

    await page.goto('/shield');
    await expect(page.locator(walletPanel)).toBeVisible();
    await expect(page.locator('.top-header .wallet-primary-action')).toBeVisible();

    await page.goto('/portal');
    await expect(page.locator(walletPanel)).toBeVisible();
    await expect(page.locator('.top-header .wallet-primary-action')).toBeVisible();

    await page.goto('/swap');
    await expect(page.locator(walletPanel)).toBeVisible();
    await expect(page.locator('.top-header .wallet-primary-action')).toBeVisible();

    await page.goto('/treasury');
    await expect(page.locator(walletPanel)).toBeVisible();
    await expect(page.locator('.top-header .wallet-primary-action')).toBeVisible();
  });

  test('redacts coalesced wallet payloads from rendered connection errors', async ({ page }) => {
    await installFailingMockOwnerWallet(page);
    await page.goto('/chat');

    await page.getByRole('button', { name: 'Open Wallet menu' }).click();
    const metaMaskOption = page.getByRole('menuitem', { name: /^Connect MetaMask$/i });
    await expect(metaMaskOption).toBeVisible();
    await metaMaskOption.click();

    const safeWalletError = page.getByText('Failed to connect wallet.');
    await expect(safeWalletError).toBeVisible();
    await expect(page.getByText(/could not coalesce error/i)).toHaveCount(0);
    await expect(page.getByText(/chrome-extension:\/\//i)).toHaveCount(0);
    await expect(page.getByText(SENSITIVE_TEST_CALLDATA, { exact: false })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Connect MetaMask or CipherTrade' })).toBeVisible();
    await page.waitForTimeout(1_000);
    await expect(safeWalletError).toBeVisible();
  });

  test('offers CipherTrade Mobile through WalletConnect in the wallet menu', async ({ page }) => {
    await page.goto('/chat');
    await page.getByRole('button', { name: 'Open Wallet menu' }).click();
    await expect(
      page.getByRole('menuitem', {
        name: /^(Connect CipherTrade Mobile|CipherTrade Mobile setup needed)$/
      })
    ).toBeVisible();
  });

  test('runs automatic Snap onboarding with a mobile-emulated Snap-capable desktop provider', async ({
    browser,
    baseURL
  }) => {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile MetaMaskMobile',
      viewport: { width: 390, height: 844 }
    });
    const page = await context.newPage();
    try {
      await installMockSnapOwnerWallet(page);
      await page.goto(`${baseURL ?? 'http://127.0.0.1:4174'}/chat`);
      const connectButton = page.getByRole('button', { name: 'Connect MetaMask or CipherTrade' });
      if (await connectButton.count()) {
        await connectButton.click();
      } else {
        await page.getByRole('button', { name: 'Unlock privacy with MetaMask' }).click();
      }

      await expect
        .poll(
          () => page.evaluate(
            () =>
              (window as unknown as { __chainWhisperSnapRequests?: string[] }).__chainWhisperSnapRequests ?? []
          ),
          { timeout: 5_000 }
        )
        .toContain('wallet_invokeSnap:get-aes-key');
      await expect(page.getByText(/MetaMask Mobile does not support COTI Snap/i)).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Unlock privacy/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Copy wallet address/ })).toBeVisible();
    } finally {
      void context.close().catch(() => undefined);
    }
  });

  test('shows OTC Desk wallet controls without duplicate preferred browser action', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'chainwhisper-wallet-preference:v1',
        JSON.stringify({ version: 1, kind: 'browser', browserWalletId: 'metamask' })
      );
    });

    await page.goto('/otc');

    const header = page.locator('.top-header');
    await expect(header.locator(walletPanel)).toBeVisible();
    const walletMenuButton = header.getByRole('button', { name: /^Open Wallet menu$/i });
    await expect(walletMenuButton).toBeVisible();

    const quickMetaMask = header.getByRole('button', { name: /^MetaMask$/i });
    const quickMetaMaskCount = await quickMetaMask.count();
    expect(quickMetaMaskCount).toBeLessThanOrEqual(1);

    if (quickMetaMaskCount === 1) {
      await walletMenuButton.click();
      await expect(page.getByRole('menuitem', { name: /^MetaMask$/i })).toHaveCount(0);
    }
  });

  test('replaces Trading wallet header state when navigating back to Chat', async ({ page }) => {
    await page.goto('/otc');
    await expect(page.locator('.top-header-brand-subtitle', { hasText: /^DEX & P2P$/ })).toBeVisible();
    await expect(page.locator(walletPanel)).toBeVisible();

    const appMenu = page.getByRole('navigation', { name: 'ChainWhisper apps' }).first();
    await appMenu.getByRole('button', { name: 'Chat' }).click();

    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.locator('.top-header-brand-subtitle', { hasText: /^Chat$/ })).toBeVisible();
    await expect(page.locator(walletPanel)).toBeVisible();
    await expect(page.locator('.top-header-brand-subtitle', { hasText: /^DEX & P2P$/ })).toHaveCount(0);
  });
});
