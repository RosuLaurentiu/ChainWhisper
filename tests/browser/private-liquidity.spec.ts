import { expect, test } from '@playwright/test';

test.describe('private liquidity', () => {
  test('presents independent partial-fill protection and the current Position NFT workspace', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/dex');
    const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
    await swap.locator('.dex-v2-current-advanced > summary').click();
    await expect(swap.getByText(/It does not scan Limit orders/)).toBeVisible();
    await expect(swap.getByLabel('Price limit', { exact: true })).toHaveValue('');
    await expect(swap.getByLabel('Minimum input fill', { exact: true })).toHaveValue('0');
    await swap.getByLabel('Price limit', { exact: true }).fill('0.3');
    await swap.getByLabel('Minimum input fill', { exact: true }).fill('50');
    await swap.getByLabel('Maximum input', { exact: true }).fill('100');
    await expect(swap.getByLabel('Price limit', { exact: true })).toHaveValue('0.3');
    await expect(swap.getByLabel('Minimum input fill', { exact: true })).toHaveValue('50');
    await expect(swap.getByLabel('Maximum input', { exact: true })).toHaveValue('100');
    await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeDisabled();
    await page.goto('/otc/pools');
    await expect(page).toHaveURL(/\/dex\/positions$/);
    const positions = page.getByRole('region', { name: 'Current liquidity NFT positions' });
    await expect(positions.getByText(/Class and liquidity are owner-private/)).toBeVisible();
    await expect(positions.getByRole('button', { name: 'Read private claim' })).toBeDisabled();
    await expect(positions.getByRole('button', { name: 'Transfer liquidity NFT' })).toBeDisabled();
    await page.goto('/dex/strategies');
    const pool = page.getByRole('region', { name: 'Current private Pool creation' });
    await expect(pool.getByLabel('Pool spread').getByRole('option')).toHaveText(['0.1%', '0.3%', '0.5%', '1%', '2%', '5%', '10%']);
    await pool.getByLabel('Pool spread').selectOption('2');
    await expect(pool.getByLabel('Pool spread')).toHaveValue('2');
    await expect(pool.getByRole('button', { name: 'Get private Pool preview' })).toBeDisabled();
  });

  test('keeps swap and Pool protection fields free of horizontal overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ['/dex', '/dex/strategies', '/dex/positions']) {
      await page.goto(route);
      await expect(page.locator('.dex-v2-page')).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
  });

  test('keeps legacy invalid Position NFT routes inside the current fail-closed workspace', async ({ page }) => {
    await page.goto('/otc/pools/position/0');
    await expect(page).toHaveURL(/\/dex\/positions$/);
    const positions = page.getByRole('region', { name: 'Current liquidity NFT positions' });
    await expect(positions).toBeVisible();
    await positions.getByLabel('Liquidity NFT ID').fill('0');
    await expect(positions.getByRole('button', { name: 'Read private claim' })).toBeDisabled();
    await expect(positions.getByRole('button', { name: 'Close and withdraw all' })).toBeDisabled();
    await expect(positions.getByRole('button', { name: 'Withdraw selected shares' })).toBeDisabled();
    await expect(positions.getByRole('button', { name: 'Transfer liquidity NFT' })).toBeDisabled();
    await expect(positions.getByRole('status')).toContainText('Connect the owner wallet on COTI Testnet');
  });
});
