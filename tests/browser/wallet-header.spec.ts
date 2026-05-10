import { expect, test } from '@playwright/test';

const walletPanel = '.wallet-header-panel';

test.describe('route wallet header policy', () => {
  test('shows the shared app menu on every top-level page', async ({ page }) => {
    for (const route of ['/', '/chat', '/trades', '/shield', '/treasury']) {
      await page.goto(route);
      const appMenu = page.getByRole('navigation', { name: 'ChainWhisper apps' }).first();
      await expect(appMenu).toBeVisible();
      await expect(appMenu.getByRole('button', { name: 'Chat' })).toBeVisible();
      await expect(appMenu.getByRole('button', { name: 'Trades' })).toBeVisible();
      await expect(appMenu.getByRole('button', { name: 'Shield' })).toBeVisible();
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

  test('shows notification sound controls on app pages except Home', async ({ page }) => {
    for (const route of ['/chat', '/trades', '/shield', '/treasury']) {
      await page.goto(route);
      await expect(page.locator('.sound-toggle-btn')).toBeVisible();
    }

    await page.goto('/');
    await expect(page.locator('.sound-toggle-btn')).toHaveCount(0);
  });

  test('shows Chat and Shield app-wallet controls', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.locator(walletPanel)).toBeVisible();
    await expect(page.getByText(/App wallet|No wallet connected/i).first()).toBeVisible();

    await page.goto('/shield');
    await expect(page.locator(walletPanel)).toBeVisible();
    await expect(page.getByText(/App wallet|No wallet connected/i).first()).toBeVisible();

    await page.goto('/swap');
    await expect(page.locator(walletPanel)).toBeVisible();
    await expect(page.getByText(/App wallet|No wallet connected/i).first()).toBeVisible();
  });

  test('shows Trades wallet controls without duplicate preferred browser action', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'chainwhisper-wallet-preference:v1',
        JSON.stringify({ version: 1, kind: 'browser', browserWalletId: 'metamask' })
      );
    });

    await page.goto('/trades');

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

  test('replaces Trades wallet header state when navigating back to Chat', async ({ page }) => {
    await page.goto('/trades');
    await expect(page.locator('.top-header-brand-subtitle', { hasText: /^P2P Trades$/ })).toBeVisible();
    await expect(page.locator(walletPanel)).toBeVisible();

    const appMenu = page.getByRole('navigation', { name: 'ChainWhisper apps' }).first();
    await appMenu.getByRole('button', { name: 'Chat' }).click();

    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.locator('.top-header-brand-subtitle', { hasText: /^Chat$/ })).toBeVisible();
    await expect(page.locator(walletPanel)).toBeVisible();
    await expect(page.locator('.top-header-brand-subtitle', { hasText: /^P2P Trades$/ })).toHaveCount(0);
  });
});
