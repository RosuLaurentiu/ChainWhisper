import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const walletPanel = '.wallet-header-panel';
const cotiPrivacyPortalUrl = 'https://privacy.coti.io/';
const COTI_CHAIN_ID_HEX = '0x282b34';
const TEST_OWNER = '0x1111111111111111111111111111111111111111';

const installMockOwnerWallet = async (page: Page) => {
  await page.addInitScript(({ chainId, owner }) => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const provider = {
      isMetaMask: true,
      selectedAddress: owner,
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [owner];
        if (method === 'eth_chainId') return chainId;
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

test.describe('route wallet header policy', () => {
  test('shows the shared app menu on every top-level page', async ({ page }) => {
    for (const route of ['/', '/chat', '/otc', '/otc/desk', '/portal', '/shield', '/treasury']) {
      await page.goto(route);
      const appMenu = page.getByRole('navigation', { name: 'ChainWhisper apps' }).first();
      await expect(appMenu).toBeVisible();
      await expect(appMenu.getByRole('button', { name: 'Chat' })).toBeVisible();
      await expect(appMenu.getByRole('button', { name: 'OTC Desk' })).toBeVisible();
      await expect(appMenu.getByRole('button', { name: 'Privacy Portal' })).toBeVisible();
      await expect(appMenu.getByRole('button', { name: 'Treasury' })).toBeVisible();
      await expect(appMenu.getByRole('button', { name: 'Home' })).toHaveCount(0);
    }
  });

  test('keeps Home and Treasury wallet-free', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(walletPanel)).toHaveCount(0);
    await expect(page.locator('.sound-toggle-btn')).toHaveCount(0);

    await page.goto('/home');
    await expect(page.locator(walletPanel)).toHaveCount(0);
    await expect(page.locator('.sound-toggle-btn')).toHaveCount(0);

    await page.goto('/treasury');
    await expect(page.locator('.top-header-brand-subtitle', { hasText: /^Treasury$/ })).toBeVisible();
    await expect(page.locator(walletPanel)).toHaveCount(0);
  });

  test('links Home and Privacy Portal to the official COTI Privacy Portal', async ({ page }) => {
    await page.goto('/');
    await page.locator('.top-header-ecosystem-menu > summary').click();
    const headerPrivacyLink = page.getByRole('link', { name: 'Privacy Portal' });
    await expect(headerPrivacyLink).toBeVisible();
    await expect(headerPrivacyLink).toHaveAttribute('href', cotiPrivacyPortalUrl);
    await expect(headerPrivacyLink).toHaveAttribute('target', '_blank');

    await page.goto('/portal');
    const portalPrivacyButton = page.getByRole('link', { name: /Official COTI contracts/i });
    await expect(portalPrivacyButton).toBeVisible();
    await expect(portalPrivacyButton).toHaveAttribute('href', cotiPrivacyPortalUrl);
    await expect(portalPrivacyButton).toHaveAttribute('target', '_blank');
  });

  test('shows notification sound controls on app pages except Home', async ({ page }) => {
    for (const route of ['/chat', '/otc', '/otc/desk', '/portal', '/shield', '/treasury']) {
      await page.goto(route);
      await expect(page.locator('.sound-toggle-btn')).toBeVisible();
    }

    await page.goto('/');
    await expect(page.locator('.sound-toggle-btn')).toHaveCount(0);
  });

  test('shows Chat and Privacy Portal app-wallet controls', async ({ page }) => {
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
  });

  test('exposes account creation from every wallet-enabled app shell after owner connection', async ({ page }) => {
    await installMockOwnerWallet(page);
    await page.goto('/chat');
    await page.locator('.top-header .wallet-primary-action').click();
    await expect(
      page.locator('.top-header').getByRole('button', { name: 'Copy owner wallet address' })
    ).toBeVisible({ timeout: 30_000 });

    for (const route of ['/chat', '/shield', '/otc']) {
      await page.goto(route);
      const header = page.locator('.top-header');
      await expect(header.locator(walletPanel)).toBeVisible();
      const connectOwner = header.getByRole('button', {
        name: 'Connect the owner wallet used for login, funding, and recovery'
      });
      if (await connectOwner.count()) {
        await connectOwner.click();
        await expect(header.getByRole('button', { name: 'Copy owner wallet address' })).toBeVisible({
          timeout: 30_000
        });
      }

      await header.getByRole('button', { name: /^Open Wallet menu$/i }).click();
      const ownerAccountTab = page.getByRole('menuitemradio', { name: 'Owner wallet selected' });
      await expect(ownerAccountTab).toBeVisible();
      await expect(ownerAccountTab).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByRole('menuitem', { name: /^Use owner wallet$/i })).toHaveCount(0);
      const createAccount = page.getByRole('menuitem', { name: /^Create account$/i });
      await expect(createAccount).toBeVisible();
      await expect(createAccount).toBeEnabled();
      await header.getByRole('button', { name: /^Close Wallet menu$/i }).click();
    }
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
      await page
        .getByRole('button', { name: 'Connect the owner wallet used for login, funding, and recovery' })
        .click();

      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { __chainWhisperSnapRequests?: string[] }).__chainWhisperSnapRequests ?? []
          )
        )
        .toContain('wallet_invokeSnap:get-aes-key');
      await expect(page.getByText(/MetaMask Mobile does not support COTI Snap/i)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Open ChainWhisper account setup options' })).toBeVisible();
    } finally {
      await context.close();
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

  test('replaces OTC Desk wallet header state when navigating back to Chat', async ({ page }) => {
    await page.goto('/otc');
    await expect(page.locator('.top-header-brand-subtitle', { hasText: /^OTC Desk$/ })).toBeVisible();
    await expect(page.locator(walletPanel)).toBeVisible();

    const appMenu = page.getByRole('navigation', { name: 'ChainWhisper apps' }).first();
    await appMenu.getByRole('button', { name: 'Chat' }).click();

    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.locator('.top-header-brand-subtitle', { hasText: /^Chat$/ })).toBeVisible();
    await expect(page.locator(walletPanel)).toBeVisible();
    await expect(page.locator('.top-header-brand-subtitle', { hasText: /^OTC Desk$/ })).toHaveCount(0);
  });
});
