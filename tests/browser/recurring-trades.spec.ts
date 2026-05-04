import { expect, test } from '@playwright/test';

test.describe('trading V1 routes', () => {
  test('uses the recurring read path for recurring links', async ({ page }) => {
    await page.goto('/trades/recurring?order=1');

    const drawer = page.locator('.p2p-trading-shell-drawer-open .standalone-trade-detail-section');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Trading Terminal')).toBeVisible();
    await expect(drawer.getByText(/Recurring OTC|Recurring order could not load/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Trade could not load')).toHaveCount(0);
    await expect(page.getByText('contract.getTradeView is not a function')).toHaveCount(0);
  });

  test('shows functional desk filters', async ({ page }) => {
    await page.goto('/trades');

    await expect(page.getByPlaceholder(/Search offers by pair/i)).toBeVisible();
    await expect(page.getByLabel('Pair')).toBeVisible();
    await expect(page.getByLabel('Type')).toBeVisible();
    await expect(page.getByLabel('Access')).toBeVisible();
    await expect(page.getByLabel('Sort')).toBeVisible();
    await page.getByLabel('Type').selectOption('recurring');
    await expect(page.getByLabel('Type')).toHaveValue('recurring');
    await page.getByRole('button', { name: /Filters/ }).click();
    await expect(page.getByLabel('Type')).toHaveValue('all');
  });

  test('shows the two-sided recurring builder', async ({ page }) => {
    await page.goto('/trades/create');
    await page.getByRole('button', { name: /Recurring/ }).click();

    await expect(page.getByText('Reusable OTC order')).toBeVisible();
    await expect(page.getByText('Buy side', { exact: true })).toBeVisible();
    await expect(page.getByText('Sell side', { exact: true })).toBeVisible();
    await expect(page.getByText('Buy price', { exact: true })).toBeVisible();
    await expect(page.getByText('Sell price', { exact: true })).toBeVisible();
    await expect(page.getByText('Buy liquidity', { exact: true })).toBeVisible();
    await expect(page.getByText('Sell liquidity', { exact: true })).toBeVisible();
    await expect(page.getByText('You receive').first()).toBeVisible();
    await expect(page.getByText('Liquidity stays in this order and cycles between sides.')).toBeVisible();
  });

  test('calculates recurring receive amounts from price and liquidity', async ({ page }) => {
    await page.goto('/trades/create');
    await page.getByRole('button', { name: /Recurring/ }).click();

    const buySide = page.locator('.p2p-recurring-side-panel-buy');
    await buySide.getByLabel('Buy price').fill('0.0001');
    await buySide.getByLabel('Buy liquidity').fill('0.22');
    await expect(buySide.locator('.p2p-recurring-derived-field input')).toHaveValue('2200');

    await buySide.getByRole('button', { name: 'Edit buy receive' }).click();
    await buySide.locator('.p2p-recurring-derived-field input').fill('1100');
    await expect(buySide.getByLabel('Buy liquidity')).toHaveValue('0.11');

    const sellSide = page.locator('.p2p-recurring-side-panel-sell');
    await sellSide.getByLabel('Sell price').fill('0.00012');
    await sellSide.getByLabel('Sell liquidity').fill('12.5');
    await expect(sellSide.locator('.p2p-recurring-derived-field input')).toHaveValue('0.0015');
  });
});
