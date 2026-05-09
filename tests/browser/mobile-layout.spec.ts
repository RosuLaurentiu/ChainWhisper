import { expect, test, type Page } from '@playwright/test';

const mobileViewport = { width: 390, height: 844 };

const expectNoHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(4);
};

test.describe('mobile layout polish', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(mobileViewport);
  });

  test('keeps the chat wallet header compact on mobile', async ({ page }) => {
    await page.goto('/chat');

    await expect(page.locator('.top-header-mobile-wallet .wallet-header-panel')).toBeVisible();
    await expect(page.getByRole('button', { name: /Generate app wallet|Connect app wallet|Wallet unavailable/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('keeps P2P tabs and wallet controls usable on mobile', async ({ page }) => {
    await page.goto('/trades');

    await expect(page.locator('.top-header-mobile-wallet .wallet-header-panel')).toBeVisible();
    const appMenu = page.getByRole('navigation', { name: 'ChainWhisper apps' });
    await expect(appMenu).toBeHidden();
    await page.getByRole('button', { name: 'Show app menu' }).click();
    await expect(appMenu).toBeVisible();
    await page.getByRole('button', { name: 'Hide app menu' }).click();
    await expect(appMenu).toBeHidden();

    const tradeTabs = page.getByRole('navigation', { name: 'P2P trade views' });
    await expect(tradeTabs).toBeVisible();
    await expect(tradeTabs.getByRole('button', { name: 'Desk' })).toBeVisible();
    await expect(tradeTabs.getByRole('button', { name: 'Create' })).toBeVisible();
    await expect(tradeTabs.getByRole('button', { name: 'Terminal', exact: true })).toBeVisible();
    await expect(tradeTabs.getByRole('button', { name: 'My Trades', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('opens the mobile trading terminal as focused page content', async ({ page }) => {
    await page.goto('/trades/open');

    const terminal = page.locator('.standalone-trade-detail-section');
    await expect(terminal).toBeVisible();
    await expect(terminal.locator('.landing-eyebrow', { hasText: /^Trading Terminal$/ })).toBeVisible();
    await expect(page.locator('.p2p-market-overview')).toBeHidden();
    await expect(page.locator('.p2p-public-trades-section')).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'P2P trade views' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('keeps Treasury controls reachable on mobile', async ({ page }) => {
    await page.goto('/treasury');

    await expect(page.locator('.top-header-brand-subtitle', { hasText: /^Treasury$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'COTI in pool', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Active gCOTI', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '90D' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
