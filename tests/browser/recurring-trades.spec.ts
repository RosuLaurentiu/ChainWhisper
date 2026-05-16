import { expect, test } from '@playwright/test';

const PENDING_TERMINAL_ROUTE_KEY = 'chainwhisper:p2p:pending-terminal-route:v1';

test.describe('trading V1 routes', () => {
  test('uses the recurring read path for recurring links', async ({ page }) => {
    await page.goto('/trades/recurring?order=1');

    const drawer = page.locator('.p2p-trading-shell-drawer-open .standalone-trade-detail-section');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('.landing-eyebrow', { hasText: /^Trading Terminal$/ })).toBeVisible();
    await expect(drawer.locator('.p2p-terminal-eyebrow', { hasText: /^Recurring OTC Terminal$/ })).toBeVisible({
      timeout: 30_000
    });
    await expect(drawer.locator('.p2p-terminal-shell-recurring')).toBeVisible();
    await expect(drawer.locator('.p2p-terminal-main')).toBeVisible();
    await expect(drawer.locator('.p2p-terminal-history-desktop')).toHaveCount(0);
    await expect(page.locator('.p2p-terminal-history-window')).toBeVisible();
    await expect(page.getByText('Trade could not load')).toHaveCount(0);
    await expect(page.getByText('contract.getTradeView is not a function')).toHaveCount(0);
  });

  test('shows functional desk filters', async ({ page }) => {
    await page.goto('/trades');

    await expect(page.getByPlaceholder(/Search offers by pair/i)).toBeVisible();
    await expect(page.getByLabel('Pair')).toBeVisible();
    await expect(page.getByLabel('Type')).toBeVisible();
    await expect(page.getByLabel('Access')).toHaveCount(0);
    await expect(page.getByLabel('Sort')).toBeVisible();
    await page.getByLabel('Type').selectOption('recurring');
    await expect(page.getByLabel('Type')).toHaveValue('recurring');
    await page.getByRole('button', { name: /Reset/ }).click();
    await expect(page.getByLabel('Type')).toHaveValue('all');
  });

  test('restores a pending terminal route after a mobile wallet handoff', async ({ page }) => {
    await page.addInitScript((storageKey) => {
      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          path: '/trades/recurring?order=1',
          timestamp: Date.now(),
          tradeId: 1
        })
      );
    }, PENDING_TERMINAL_ROUTE_KEY);

    await page.goto('/trades');

    await expect(page).toHaveURL(/\/trades\/recurring\?order=1/);
    await expect(page.locator('.p2p-trading-shell-drawer-open .standalone-trade-detail-section')).toBeVisible();
  });

  test('keeps the MetaMask Mobile wallet bootstrap URL while rendering the terminal', async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile MetaMaskMobile'
    });
    const page = await context.newPage();
    const shellPath = `/wallet-connect?p=${encodeURIComponent('/trades/recurring?order=1')}`;
    try {
      await page.goto(`${baseURL ?? 'http://127.0.0.1:4174'}${shellPath}`);

      await expect(page).toHaveURL(/\/wallet-connect$/);
      const terminal = page.locator('.p2p-trading-shell-drawer-open .standalone-trade-detail-section');
      await expect(terminal).toBeVisible();
      await expect(terminal.locator('.landing-eyebrow', { hasText: /^Trading Terminal$/ })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('converts direct MetaMask Mobile trade links into the stable wallet bootstrap URL', async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile MetaMaskMobile'
    });
    const page = await context.newPage();
    try {
      await page.goto(`${baseURL ?? 'http://127.0.0.1:4174'}/trades/recurring?order=1`);

      await expect(page).toHaveURL(/\/wallet-connect$/);
      const terminal = page.locator('.p2p-trading-shell-drawer-open .standalone-trade-detail-section');
      await expect(terminal).toBeVisible();
      await expect(terminal.locator('.landing-eyebrow', { hasText: /^Trading Terminal$/ })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('keeps MetaMask Mobile bootstrap stable across app navigation', async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile MetaMaskMobile'
    });
    const page = await context.newPage();
    try {
      await page.goto(`${baseURL ?? 'http://127.0.0.1:4174'}/wallet-connect?p=${encodeURIComponent('/trades')}`);

      await expect(page).toHaveURL(/\/wallet-connect$/);
      await expect(page.getByRole('button', { name: 'Trades', exact: true })).toHaveAttribute('aria-current', 'page');
      await page.getByRole('button', { name: 'Chat', exact: true }).click();
      await expect(page).toHaveURL(/\/wallet-connect$/);
      await expect(page.getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute('aria-current', 'page');
      await page.getByRole('button', { name: 'Trades', exact: true }).click();
      await expect(page).toHaveURL(/\/wallet-connect$/);
      await expect(page.getByRole('button', { name: 'Trades', exact: true })).toHaveAttribute('aria-current', 'page');
    } finally {
      await context.close();
    }
  });

  test('manual Desk navigation clears the pending terminal route', async ({ page }) => {
    await page.goto('/trades/recurring?order=1');
    await page.evaluate((storageKey) => {
      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          path: '/trades/recurring?order=1',
          timestamp: Date.now(),
          tradeId: 1
        })
      );
    }, PENDING_TERMINAL_ROUTE_KEY);

    await page.getByRole('button', { name: 'Desk', exact: true }).click();

    await expect(page).toHaveURL(/\/trades$/);
    const pendingRoute = await page.evaluate((storageKey) => window.sessionStorage.getItem(storageKey), PENDING_TERMINAL_ROUTE_KEY);
    expect(pendingRoute).toBeNull();
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
    await expect(page.locator('.p2p-recurring-side-panel-buy .p2p-recurring-asset-field')).toContainText('Base asset');
    await expect(page.locator('.p2p-recurring-side-panel-sell .p2p-recurring-asset-field')).toContainText('Quote asset');
    await expect(page.locator('.p2p-recurring-side-panel-buy .p2p-recurring-asset-field')).toContainText('Balance:');
    await expect(page.locator('.p2p-recurring-side-panel-sell .p2p-recurring-asset-field')).toContainText('Balance:');
    await expect(page.locator('.p2p-recurring-side-panel-buy .trade-token-select-state a')).toHaveAttribute(
      'href',
      /\/address\//
    );
    await expect(page.locator('.p2p-recurring-side-grid + .trade-compose-privacy-panel')).toContainText('Order privacy');
    await expect(page.locator('.p2p-recurring-action-fee')).toContainText('Fee');
    await expect(page.getByText('You receive').first()).toBeVisible();
    await expect(page.getByText('Liquidity stays in this order and cycles between sides.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Swap recurring token sides' })).toHaveCount(1);
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

  test('swaps recurring token sides while preserving price meaning', async ({ page }) => {
    await page.goto('/trades/create');
    await page.getByRole('button', { name: /Recurring/ }).click();

    const builder = page.locator('.p2p-recurring-builder');
    const buySide = builder.locator('.p2p-recurring-side-panel-buy');
    const sellSide = builder.locator('.p2p-recurring-side-panel-sell');

    await buySide.getByLabel('Buy price').fill('0.0001');
    await buySide.getByLabel('Buy liquidity').fill('0.22');
    await sellSide.getByLabel('Sell price').fill('0.0002');
    await sellSide.getByLabel('Sell liquidity').fill('12.5');
    await expect(buySide.locator('.p2p-recurring-derived-field input')).toHaveValue('2200');
    await expect(sellSide.locator('.p2p-recurring-derived-field input')).toHaveValue('0.0025');

    await builder.getByRole('button', { name: 'Swap recurring token sides' }).click();

    const selectedSymbols = builder.locator('.p2p-recurring-side-grid .trade-token-select-trigger strong');
    await expect(selectedSymbols.nth(0)).toHaveText('COTI');
    await expect(selectedSymbols.nth(1)).toHaveText('WISP');
    await expect(buySide.getByLabel('Buy price')).toHaveValue('5000');
    await expect(buySide.getByLabel('Buy liquidity')).toHaveValue('12.5');
    await expect(buySide.locator('.p2p-recurring-derived-field input')).toHaveValue('0.0025');
    await expect(sellSide.getByLabel('Sell price')).toHaveValue('10000');
    await expect(sellSide.getByLabel('Sell liquidity')).toHaveValue('0.22');
    await expect(sellSide.locator('.p2p-recurring-derived-field input')).toHaveValue('2200');
  });
});
