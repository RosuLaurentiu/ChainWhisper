import { expect, test } from '@playwright/test';

test.describe('private liquidity', () => {
  test('presents independent partial-fill protection and the current Position NFT workspace', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/dex');
    const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
    // Advanced protections are inside the Slippage settings.
    await swap.locator('.dex-v2-current-advanced > summary').click();
    await swap.locator('.dex-v2-extra-settings > summary').click();
    await expect(swap.getByRole('button', { name: 'Fast', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(swap.getByText('Pools only', { exact: true })).toBeVisible();
    await expect(swap.getByLabel('Price limit', { exact: true })).toHaveValue('');
    await expect(swap.getByLabel('Minimum input fill', { exact: true })).toHaveValue('0');
    await swap.getByLabel('Price limit', { exact: true }).fill('0.3');
    await swap.getByLabel('Minimum input fill', { exact: true }).fill('50');
    await swap.getByLabel('Maximum input', { exact: true }).fill('100');
    await expect(swap.getByLabel('Price limit', { exact: true })).toHaveValue('0.3');
    await expect(swap.getByLabel('Minimum input fill', { exact: true })).toHaveValue('50');
    await expect(swap.getByLabel('Maximum input', { exact: true })).toHaveValue('100');
    // Without a wallet the swap action is Connect wallet; no Quote action is shown.
    await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toHaveCount(0);
    await expect(swap.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
    await page.goto('/otc/pools');
    await expect(page).toHaveURL(/\/dex\/positions$/);
    const positions = page.getByRole('region', { name: 'Current liquidity NFT positions' });
    await expect(positions.getByText('Connect your wallet on COTI Testnet to see your positions.')).toBeVisible();
    await expect(positions.getByRole('button', { name: 'Refresh owned liquidity positions' })).toBeDisabled();
    await positions.locator('details.dex-owner-footer > summary', { hasText: 'Find a position by ID' }).click();
    await expect(positions.getByRole('button', { name: 'Load private position' })).toBeDisabled();
    await page.goto('/dex/strategies');
    const pool = page.getByRole('region', { name: 'Current private Pool creation' });
    await expect(pool.getByLabel('Pool spread', { exact: true }).getByRole('option')).toHaveText(['0.1%', '0.3%', '0.5%', '1%', '2%', '5%', '10%']);
    await pool.getByLabel('Pool spread', { exact: true }).selectOption('2');
    await expect(pool.getByLabel('Pool spread', { exact: true })).toHaveValue('2');
    await expect(pool.getByRole('button', { name: 'Preview deposit' })).toBeDisabled();
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
    // The route ID is not applied. Without a wallet the manual lookup stays closed and no position action is shown.
    await positions.locator('details.dex-owner-footer > summary', { hasText: 'Find a position by ID' }).click();
    await expect(positions.getByLabel('Liquidity NFT ID')).toHaveValue('');
    await positions.getByLabel('Liquidity NFT ID').fill('0');
    await expect(positions.getByRole('button', { name: 'Load private position' })).toBeDisabled();
    await expect(positions.getByRole('button', { name: /withdraw|Transfer/i })).toHaveCount(0);
    await expect(positions.getByRole('button', { name: 'Refresh this position' })).toBeDisabled();
    await expect(positions.getByText('Connect your wallet on COTI Testnet to see your positions.')).toBeVisible();
  });
});
