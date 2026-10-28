import { expect, test, type Page } from '@playwright/test';

test('keeps orders, positions and history together in Manage', async ({ page }) => {
  await page.goto('/dex/positions');
  const primary = page.getByRole('navigation', { name: 'DEX trading views' });
  const manage = page.getByRole('navigation', { name: 'Manage views' });
  await expect(primary.getByRole('button', { name: 'Manage', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(manage.getByRole('button', { name: 'Positions', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Current liquidity NFT positions', exact: true })).toBeVisible();
  await manage.getByRole('button', { name: 'Orders', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Manage limit orders', exact: true })).toBeVisible();
  await manage.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Trade history', exact: true })).toBeVisible();
  await primary.getByRole('button', { name: 'Liquidity', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Current private Pool creation', exact: true })).toBeVisible();
  await expect(manage).toHaveCount(0);
  await page.goto('/dex/activity');
  await expect(page.getByRole('navigation', { name: 'Manage views' }).getByRole('button', { name: 'Orders', exact: true })).toHaveAttribute('aria-current', 'page');
});

const OWNER = '0x1111111111111111111111111111111111111111';
const COTI_TESTNET_CHAIN_ID = '0x6c11a0';

const installMockWallet = async (page: Page) => {
  await page.addInitScript(({ chainId, owner }) => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const snapId = 'npm:@coti-io/coti-snap';
    const provider = {
      isMetaMask: true,
      selectedAddress: owner,
      chainId,
      networkVersion: String(Number.parseInt(chainId, 16)),
      request: async ({ method, params }: { method: string; params?: { request?: { method?: string } } }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [owner];
        if (method === 'eth_chainId') return chainId;
        if (method === 'net_version') return String(Number.parseInt(chainId, 16));
        if (method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts', caveats: [] }];
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
        if (method === 'wallet_getSnaps' || method === 'wallet_requestSnaps') return { [snapId]: { id: snapId } };
        if (method === 'wallet_invokeSnap') {
          const snapMethod = params?.request?.method;
          if (snapMethod === 'connect-to-wallet' || snapMethod === 'has-aes-key') return true;
          if (snapMethod === 'get-aes-key') return 'keyboard-flow-aes';
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
  }, { chainId: COTI_TESTNET_CHAIN_ID, owner: OWNER });
};

test.describe('Trading keyboard acceptance flow', () => {
  test.beforeEach(async ({ page }) => {
    await installMockWallet(page);
    await page.goto('/otc?designQa=approved-offers');
    await expect(page.getByRole('heading', { name: 'Offers' })).toBeVisible();
  });

  test('keeps ratio, direction, and wallet utilities understandable from the keyboard', async ({ page }) => {
    const ratio = page.locator('.trading-ratio-value');
    const reverseRatio = page.getByRole('button', { name: /Reverse price display to 1 HBR priced in BCN/i });
    await reverseRatio.focus();
    await expect(reverseRatio).toBeFocused();
    await expect(reverseRatio).toHaveCSS('outline-color', 'rgb(196, 181, 253)');
    await reverseRatio.press('Enter');
    await expect(ratio).toContainText('1 HBR = 0.5000 BCN');
    await expect(ratio).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByRole('button', { name: 'P2P', exact: true })).toHaveAttribute('aria-current', 'page');

    const directionTabs = page.getByRole('tablist', { name: 'Trade direction' });
    const buy = directionTabs.getByRole('tab', { name: 'Buy' });
    const sell = directionTabs.getByRole('tab', { name: 'Sell' });
    await sell.focus();
    await sell.press('ArrowLeft');
    await expect(buy).toBeFocused();
    await expect(buy).toHaveAttribute('aria-selected', 'true');
    await buy.press('ArrowRight');
    await expect(sell).toBeFocused();
    await expect(sell).toHaveAttribute('aria-selected', 'true');

    const more = page.getByRole('button', { name: 'Open Wallet menu' });
    await more.focus();
    await more.press('Enter');
    const walletMenu = page.getByRole('menu', { name: 'Wallet' });
    const network = walletMenu.getByRole('menuitem', { name: /Network/i });
    await expect(network).toBeFocused();
    await network.press('ArrowDown');
    expect(await page.evaluate(() => ({
      ariaLabel: document.activeElement?.getAttribute('aria-label'),
      role: document.activeElement?.getAttribute('role'),
      text: document.activeElement?.textContent?.replace(/\s+/gu, ' ').trim()
    }))).toEqual({ ariaLabel: null, role: null, text: 'NotificationsAll caught up' });
    await page.keyboard.press('ArrowDown');
    await expect(walletMenu.getByRole('switch', { name: /Turn notification sound/i })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(more).toBeFocused();
    await expect(walletMenu).toHaveCount(0);
  });

  test('keeps the mobile Offers/Create/My trades dock keyboard reachable and route-aware', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    const dock = page.locator('.p2p-secondary-nav-mobile:visible');
    const offers = dock.getByRole('button', { name: 'Offers' });
    const create = dock.getByRole('button', { name: 'Create' });

    await expect(offers).toHaveAttribute('aria-current', 'page');
    await offers.focus();
    await offers.press('Tab');
    await expect(create).toBeFocused();
    await expect(create).toHaveCSS('outline-color', 'rgb(196, 181, 253)');
    await create.press('Enter');
    await expect(page).toHaveURL(/\/otc\/limit/);
    await expect(page.locator('.p2p-secondary-nav-mobile:visible').getByRole('button', { name: 'Create' })).toHaveAttribute('aria-current', 'page');

    const currentDock = page.locator('.p2p-secondary-nav-mobile:visible');
    await currentDock.getByRole('button', { name: 'My trades' }).focus();
    await currentDock.getByRole('button', { name: 'My trades' }).press('Enter');
    await expect(page).toHaveURL(/\/otc\/orders/);
    await expect(page.locator('.p2p-secondary-nav-mobile:visible').getByRole('button', { name: 'My trades' })).toHaveAttribute('aria-current', 'page');
  });

  test('keeps the Offers list beside the desktop terminal without replacing mobile Offers', async ({ page }) => {
    await expect(page.locator('.p2p-offers-workspace')).toBeVisible();
    const terminal = page.locator('.standalone-trade-detail-section');
    await expect(terminal).toBeVisible();
    await expect(terminal).toContainText('Select an offer');
    await expect(terminal.getByRole('tablist', { name: 'Trade direction' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /amount/i })).toHaveCount(0);

    await page.locator('.p2p-market-tabs').getByRole('button', { name: 'Create' }).click();
    await expect(page).toHaveURL(/\/otc\/limit/);
    await expect(page.locator('.p2p-offers-workspace')).toBeVisible();
    await expect(page.locator('.standalone-trade-create-panel')).toBeVisible();

    await page.locator('.p2p-create-tabs').getByRole('button', { name: 'Offers' }).click();
    await expect(page).toHaveURL(/\/otc(?:\/desk)?$/);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.p2p-offers-workspace')).toBeVisible();
    await expect(page.locator('.standalone-trade-detail-section')).toHaveCount(0);
  });
});

