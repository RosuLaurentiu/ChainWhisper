import { expect, test } from '@playwright/test';

const walletPanel = '.wallet-header-panel';

test.describe('route wallet header policy', () => {
  test('keeps Home and Treasury wallet-free', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(walletPanel)).toHaveCount(0);

    await page.goto('/treasury');
    await expect(page.getByText('Treasury', { exact: true })).toBeVisible();
    await expect(page.locator(walletPanel)).toHaveCount(0);
  });

  test('shows Chat and Shield app-wallet controls', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.locator(walletPanel)).toBeVisible();
    await expect(page.getByText(/App wallet|No wallet connected/i).first()).toBeVisible();

    await page.goto('/shield');
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
});
