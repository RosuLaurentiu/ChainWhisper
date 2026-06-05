import { expect, test } from '@playwright/test';

const walletPanel = '.wallet-header-panel';
const cotiPrivacyPortalUrl = 'https://privacy.coti.io/';

test.describe('route wallet header policy', () => {
  test('shows the shared app menu on every top-level page', async ({ page }) => {
    for (const route of ['/', '/chat', '/otcdesk', '/trades', '/portal', '/shield', '/treasury']) {
      await page.goto(route);
      const appMenu = page.getByRole('navigation', { name: 'ChainWhisper apps' }).first();
      await expect(appMenu).toBeVisible();
      await expect(appMenu.getByRole('button', { name: 'Chat' })).toBeVisible();
      await expect(appMenu.getByRole('button', { name: 'OTC Desk' })).toBeVisible();
      await expect(appMenu.getByRole('button', { name: 'WISP Portal' })).toBeVisible();
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

  test('links Home and WISP Portal to the COTI Privacy Portal', async ({ page }) => {
    await page.goto('/');
    const headerPrivacyLink = page.getByRole('link', { name: 'Privacy Portal' });
    await expect(headerPrivacyLink).toBeVisible();
    await expect(headerPrivacyLink).toHaveAttribute('href', cotiPrivacyPortalUrl);
    await expect(headerPrivacyLink).toHaveAttribute('target', '_blank');

    await page.goto('/portal');
    const portalPrivacyButton = page.getByRole('link', { name: 'Open COTI Privacy Portal' });
    await expect(portalPrivacyButton).toBeVisible();
    await expect(portalPrivacyButton).toHaveAttribute('href', cotiPrivacyPortalUrl);
    await expect(portalPrivacyButton).toHaveAttribute('target', '_blank');
  });

  test('shows notification sound controls on app pages except Home', async ({ page }) => {
    for (const route of ['/chat', '/otcdesk', '/trades', '/portal', '/shield', '/treasury']) {
      await page.goto(route);
      await expect(page.locator('.sound-toggle-btn')).toBeVisible();
    }

    await page.goto('/');
    await expect(page.locator('.sound-toggle-btn')).toHaveCount(0);
  });

  test('shows Chat and WISP Portal app-wallet controls', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.locator(walletPanel)).toBeVisible();
    await expect(page.getByText(/App wallet|No wallet connected/i).first()).toBeVisible();

    await page.goto('/shield');
    await expect(page.locator(walletPanel)).toBeVisible();
    await expect(page.getByText(/App wallet|No wallet connected/i).first()).toBeVisible();

    await page.goto('/portal');
    await expect(page.locator(walletPanel)).toBeVisible();
    await expect(page.getByText(/App wallet|No wallet connected/i).first()).toBeVisible();

    await page.goto('/swap');
    await expect(page.locator(walletPanel)).toBeVisible();
    await expect(page.getByText(/App wallet|No wallet connected/i).first()).toBeVisible();
  });

  test('opens the app-wallet PIN dialog from every wallet-enabled app shell', async ({ page }) => {
    for (const route of ['/chat', '/shield', '/otcdesk']) {
      await page.goto(route);
      const header = page.locator('.top-header');
      await expect(header.locator(walletPanel)).toBeVisible();

      await header.getByRole('button', { name: /^Open Wallet menu$/i }).click();
      await page.getByRole('menuitem', { name: /^Generate wallet$/i }).click();

      const pinDialog = page.getByRole('dialog', { name: /Set PIN|Unlock Wallet/i });
      await expect(pinDialog).toBeVisible();
      await expect(pinDialog.getByLabel('Wallet PIN')).toBeVisible();

      await pinDialog.getByRole('button', { name: /^Cancel$/i }).click();
      await expect(pinDialog).toHaveCount(0);
    }
  });

  test('shows OTC Desk wallet controls without duplicate preferred browser action', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'chainwhisper-wallet-preference:v1',
        JSON.stringify({ version: 1, kind: 'browser', browserWalletId: 'metamask' })
      );
    });

    await page.goto('/otcdesk');

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
    await page.goto('/otcdesk');
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
