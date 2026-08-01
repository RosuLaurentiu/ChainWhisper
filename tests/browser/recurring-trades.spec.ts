import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const PENDING_TERMINAL_ROUTE_KEY = 'chainwhisper:p2p:pending-terminal-route:v1';
const CARBON_MARKET_RATE_URL = '**/market-rate?**';
const CARBON_NATIVE_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const COTI_CHAIN_ID_HEX = '0x282b34';
const RECURRING_ORDER_ONE_MAKER = '0xbf01185A70CDfEF1858659836D57BFf085ebed55';
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const installMockTradingWallet = async (page: Page, address: string) => {
  await page.addInitScript(({ walletAddress, chainIdHex }) => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const provider = {
      isMetaMask: true,
      selectedAddress: walletAddress,
      request: async ({ method }: { method: string }) => {
        switch (method) {
          case 'eth_requestAccounts':
          case 'eth_accounts':
            return [walletAddress];
          case 'eth_chainId':
            return chainIdHex;
          case 'wallet_requestPermissions':
            return [{ parentCapability: 'eth_accounts', caveats: [] }];
          case 'wallet_switchEthereumChain':
          case 'wallet_addEthereumChain':
            return null;
          default:
            return null;
        }
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

    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: provider
    });
  }, { walletAddress: address, chainIdHex: COTI_CHAIN_ID_HEX });
};

const mockCarbonPairReference = async (page: Page, marketPrice: number | null) => {
  await page.route(CARBON_MARKET_RATE_URL, async (route: Route) => {
    const address = new URL(route.request().url()).searchParams.get('address')?.toLowerCase();
    const usd = marketPrice === null ? null : address === CARBON_NATIVE_TOKEN_ADDRESS ? 1 : marketPrice;
    await route.fulfill({
      body: JSON.stringify({
        data: { USD: usd }
      }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      status: 200
    });
  });
};

const selectComposerToken = async (
  page: Page,
  sectionSelector: string,
  symbol: string,
  scope: 'Public' | 'Private'
) => {
  const section = page.locator(sectionSelector);
  await section.locator('.trade-token-select-trigger').click();
  const dropdown = section.locator('.trade-token-select-dropdown');
  await expect(dropdown).toBeVisible();
  await dropdown.getByRole('tab', { name: new RegExp(`^${scope}\\b`) }).click();
  await dropdown.getByLabel('Search trade tokens').fill(symbol);
  const option = dropdown.getByRole('option', { name: new RegExp(`^${escapeRegExp(symbol)}\\b`) });
  await expect(option).toHaveCount(1);
  await option.click();
  await expect(section.locator('.trade-token-select-trigger strong')).toHaveText(symbol);
};

test.describe('trading V1 routes', () => {
  test('redirects legacy trading aliases to canonical OTC routes', async ({ page }) => {
    test.setTimeout(60_000);
    const cases = [
      ['/otcdesk', '/otc'],
      ['/otcdesk/create', '/otc/limit'],
      ['/otcdesk/mytrades', '/otc/orders'],
      ['/trades', '/otc/desk'],
      ['/trades/create', '/otc/limit'],
      ['/trades/mine', '/otc/orders'],
      ['/trades/recurring', '/otc/recurring']
    ] as const;

    for (const [legacyPath, canonicalPath] of cases) {
      await page.goto(legacyPath);
      await expect(page).toHaveURL(new RegExp(`${canonicalPath.replaceAll('/', '\\/')}$`));
    }
  });

  test('uses the recurring read path for recurring links', async ({ page }) => {
    await page.goto('/trades/recurring?order=1');
    await expect(page).toHaveURL(/\/otc\/order\/recurring\/1$/);

    const drawer = page.locator('.p2p-trading-shell-drawer-open .standalone-trade-detail-section');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('.landing-eyebrow', { hasText: /^Order$/ })).toBeVisible();
    await expect(drawer.locator('.p2p-terminal-eyebrow', { hasText: /^Recurring OTC order$/ })).toBeVisible({
      timeout: 30_000
    });
    await expect(drawer.locator('.p2p-terminal-shell-recurring')).toBeVisible();
    await expect(drawer.locator('.p2p-terminal-main')).toBeVisible();
    await expect(drawer.locator('.p2p-terminal-history-desktop')).toHaveCount(0);
    await expect(page.locator('.p2p-terminal-history-window')).toBeVisible();
    await expect(page.getByText('Trade could not load')).toHaveCount(0);
    await expect(page.getByText('contract.getTradeView is not a function')).toHaveCount(0);
  });

  test('keeps recurring order prices stable while mapping the fill action to the filled side', async ({ page }) => {
    await page.goto('/trades/recurring?order=1');
    await expect(page).toHaveURL(/\/otc\/order\/recurring\/1$/);

    const terminal = page.locator('.p2p-terminal-shell-recurring');
    await expect(terminal).toBeVisible({ timeout: 30_000 });
    const priceDesk = terminal.locator('.p2p-terminal-price-desk');
    const orderBuySide = priceDesk.locator('.p2p-recurring-price-buy');
    const orderSellSide = priceDesk.locator('.p2p-recurring-price-sell');

    await expect(priceDesk.locator('.p2p-recurring-price-card-head')).toContainText('Price ratio');
    await expect(orderBuySide).toContainText(/^Buy /i);
    await expect(orderSellSide).toContainText(/^Sell /i);
    await expect(orderBuySide).toHaveClass(/is-active/);
    await expect(terminal.locator('.p2p-recurring-fill-price-note')).toContainText(/You buy .* at/i);

    await terminal.locator('.p2p-terminal-tabs').getByRole('tab', { name: 'Sell' }).click();
    await expect(orderSellSide).toHaveClass(/is-active/);
    await expect(terminal.locator('.p2p-recurring-fill-price-note')).toContainText(/You sell .* at/i);
  });

  test('shows recurring price sides from the maker perspective after wallet connect', async ({ page }) => {
    await installMockTradingWallet(page, RECURRING_ORDER_ONE_MAKER);
    await page.goto('/trades');
    await expect(page).toHaveURL(/\/otc\/desk$/);

    const header = page.locator('.top-header');
    await header.locator('.wallet-primary-action').click();

    const recurringCard = page
      .locator('.p2p-public-trade-grid .p2p-recurring-order-card')
      .filter({ has: page.locator('.p2p-order-chip-owner') })
      .first();
    await expect(recurringCard).toBeVisible({ timeout: 30_000 });
    await expect(recurringCard.locator('.p2p-order-chip-owner')).toContainText('Maker');
    await expect(recurringCard.locator('.p2p-recurring-price-buy')).toContainText(/^Buy /i);
    await expect(recurringCard.locator('.p2p-recurring-price-sell')).toContainText(/^Sell /i);
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

    await expect(page).toHaveURL(/\/otc\/order\/recurring\/1$/);
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
      await expect(terminal.locator('.landing-eyebrow', { hasText: /^Order$/ })).toBeVisible();
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
      await expect(terminal.locator('.landing-eyebrow', { hasText: /^Order$/ })).toBeVisible();
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
      await expect(page.getByRole('button', { name: 'OTC Desk', exact: true })).toHaveAttribute('aria-current', 'page');
      await page.getByRole('button', { name: 'Chat', exact: true }).click();
      await expect(page).toHaveURL(/\/wallet-connect$/);
      await expect(page.getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute('aria-current', 'page');
      await page.getByRole('button', { name: 'OTC Desk', exact: true }).click();
      await expect(page).toHaveURL(/\/wallet-connect$/);
      await expect(page.getByRole('button', { name: 'OTC Desk', exact: true })).toHaveAttribute('aria-current', 'page');
    } finally {
      await context.close();
    }
  });

  test('closing the current Desk terminal clears the pending terminal route', async ({ page }) => {
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

    const deskButton = page.getByRole('button', { name: 'Desk', exact: true });
    await deskButton.click();
    await expect(page.locator('.standalone-trade-detail-section')).toBeVisible();
    await deskButton.click();

    await expect(page).toHaveURL(/\/otc\/desk$/);
    const pendingRoute = await page.evaluate((storageKey) => window.sessionStorage.getItem(storageKey), PENDING_TERMINAL_ROUTE_KEY);
    expect(pendingRoute).toBeNull();
  });

  test('shows the two-sided recurring builder', async ({ page }) => {
    await page.goto('/otc/limit');
    await page.getByRole('tab', { name: 'Recurring' }).click();

    await expect(page.getByText('Buy side', { exact: true })).toBeVisible();
    await expect(page.getByText('Sell side', { exact: true })).toBeVisible();
    await expect(page.getByText('Buy price', { exact: true })).toBeVisible();
    await expect(page.getByText('Sell price', { exact: true })).toBeVisible();
    await expect(page.getByText('Buy liquidity', { exact: true })).toBeVisible();
    await expect(page.getByText('Sell liquidity', { exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Recurring OTC order' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Base CA / })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Quote CA / })).toBeVisible();
    await expect(page.locator('.p2p-recurring-side-grid + .trade-compose-privacy-panel')).toContainText('Order privacy');
    await expect(page.locator('.p2p-recurring-action-fee')).toContainText('Fee');
    await expect(page.getByText('You buy').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Swap recurring token sides' })).toHaveCount(1);
  });

  test('shows Carbon reference prices in create and terminal surfaces', async ({ page }) => {
    await mockCarbonPairReference(page, 0.000286);

    await page.goto('/otc/limit');
    await selectComposerToken(page, '.trade-compose-section-sell', 'p.WISP', 'Private');
    await selectComposerToken(page, '.trade-compose-section-buy', 'p.COTI', 'Private');
    await expect(page.getByRole('group', { name: 'OTC trade offer' }).locator('.p2p-carbon-price-reference')).toContainText(
      'Carbon price 0.000286 COTI/WISP'
    );

    await selectComposerToken(page, '.trade-compose-section-sell', 'gCOTI', 'Public');
    await selectComposerToken(page, '.trade-compose-section-buy', 'COTI', 'Public');
    await expect(page.getByRole('group', { name: 'OTC trade offer' }).locator('.p2p-carbon-price-reference')).toContainText(
      'Carbon price 0.000286 COTI/gCOTI'
    );

    await selectComposerToken(page, '.trade-compose-section-sell', 'p.gCOTI', 'Private');
    await selectComposerToken(page, '.trade-compose-section-buy', 'p.COTI', 'Private');
    await expect(page.getByRole('group', { name: 'OTC trade offer' }).locator('.p2p-carbon-price-reference')).toContainText(
      'Carbon price 0.000286 COTI/gCOTI'
    );

    await page.getByRole('tab', { name: 'Recurring' }).click();
    await expect(page.locator('.p2p-recurring-pair-price .p2p-carbon-price-reference').first()).toContainText(
      'Carbon price 0.000286 COTI/gCOTI'
    );

    await page.goto('/otc/order/recurring/5');
    const recurringTerminal = page.locator('.p2p-terminal-shell-recurring');
    await expect(recurringTerminal.locator('.p2p-carbon-price-reference')).toContainText(
      /Carbon price/,
      { timeout: 30_000 }
    );
  });

  test('keeps the one-off Carbon price inside the narrow create price area', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 720 });
    await mockCarbonPairReference(page, 3172.212);

    await page.goto('/otc/limit');
    await selectComposerToken(page, '.trade-compose-section-sell', 'COTI', 'Public');
    await selectComposerToken(page, '.trade-compose-section-buy', 'Pengo', 'Public');

    const activeComposer = page.getByRole('group', { name: 'OTC trade offer' });
    const carbonReference = activeComposer.locator('.p2p-carbon-price-reference');
    await expect(carbonReference).toContainText('Carbon price');

    const bounds = await page.evaluate(() => {
      const carbon = document.querySelector('[aria-label="OTC trade offer"] .p2p-carbon-price-reference');
      const priceArea = carbon?.closest('.trade-compose-limit-price, .trade-compose-inline-price');
      const panel = carbon?.closest('.trade-compose-panel');
      const readBounds = (element: Element | null | undefined, label: string) => {
        if (!element) {
          throw new Error(`Missing ${label}`);
        }
        const rect = element.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          top: rect.top
        };
      };

      return {
        carbon: readBounds(carbon, 'Carbon price reference'),
        panel: readBounds(panel, 'composer panel'),
        priceArea: readBounds(priceArea, 'price area')
      };
    });

    expect(bounds.carbon.left).toBeGreaterThanOrEqual(bounds.priceArea.left);
    expect(bounds.carbon.right).toBeLessThanOrEqual(bounds.priceArea.right);
    expect(bounds.carbon.top).toBeGreaterThanOrEqual(bounds.priceArea.top);
    expect(bounds.carbon.bottom).toBeLessThanOrEqual(bounds.priceArea.bottom);
    expect(bounds.priceArea.right).toBeLessThanOrEqual(bounds.panel.right);
  });

  test('hides Carbon reference prices for same-underlying public/private terminal pairs', async ({ page }) => {
    await mockCarbonPairReference(page, 0.000286);

    await page.goto('/trades/recurring?order=1');
    await expect(page).toHaveURL(/\/otc\/order\/recurring\/1$/);
    await expect(page.locator('.p2p-terminal-shell-recurring')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.p2p-terminal-shell-recurring .p2p-carbon-price-reference')).toHaveCount(0);
  });

  test('hides Carbon reference prices when Carbon has no pair data', async ({ page }) => {
    await mockCarbonPairReference(page, null);

    await page.goto('/otc/limit');
    await expect(page.getByRole('group', { name: 'OTC trade offer' }).locator('.p2p-carbon-price-reference')).toHaveCount(0);
  });

  test('calculates recurring receive amounts from price and liquidity', async ({ page }) => {
    await page.goto('/otc/limit');
    await page.getByRole('tab', { name: 'Recurring' }).click();

    const buySide = page.locator('.p2p-recurring-side-panel-buy');
    await buySide.getByLabel('Buy price').fill('0.0001');
    await buySide.getByLabel('Buy liquidity').fill('0.22');
    await expect(buySide.locator('.p2p-recurring-derived-field input')).toHaveValue('2200');

    await buySide.getByRole('button', { name: 'Edit amount bought on buy side' }).click();
    await buySide.locator('.p2p-recurring-derived-field input').fill('1100');
    await expect(buySide.getByLabel('Buy liquidity')).toHaveValue('0.11');

    const sellSide = page.locator('.p2p-recurring-side-panel-sell');
    await sellSide.getByLabel('Sell price').fill('0.00012');
    await sellSide.getByLabel('Sell liquidity').fill('12.5');
    await expect(sellSide.locator('.p2p-recurring-derived-field input')).toHaveValue('0.0015');
  });

  test('swaps recurring token sides while preserving price meaning', async ({ page }) => {
    await page.goto('/otc/limit');
    await page.getByRole('tab', { name: 'Recurring' }).click();

    const builder = page.locator('.p2p-recurring-builder');
    const buySide = builder.locator('.p2p-recurring-side-panel-buy');
    const sellSide = builder.locator('.p2p-recurring-side-panel-sell');

    await buySide.getByLabel('Buy price').fill('0.0001');
    await buySide.getByLabel('Buy liquidity').fill('0.22');
    await sellSide.getByLabel('Sell price').fill('0.0002');
    await sellSide.getByLabel('Sell liquidity').fill('12.5');
    await expect(buySide.locator('.p2p-recurring-derived-field input')).toHaveValue('2200');
    await expect(sellSide.locator('.p2p-recurring-derived-field input')).toHaveValue('0.0025');

    const selectedSymbols = builder.locator('.p2p-recurring-pair-picker .trade-token-select-trigger strong');
    const symbolsBeforeSwap = await selectedSymbols.allTextContents();
    await builder.getByRole('button', { name: 'Swap recurring token sides' }).click();

    await expect(selectedSymbols.nth(0)).toHaveText(symbolsBeforeSwap[1]);
    await expect(selectedSymbols.nth(1)).toHaveText(symbolsBeforeSwap[0]);
    await expect(buySide.getByLabel('Buy price')).toHaveValue('5000');
    await expect(buySide.getByLabel('Buy liquidity')).toHaveValue('12.5');
    await expect(buySide.locator('.p2p-recurring-derived-field input')).toHaveValue('0.0025');
    await expect(sellSide.getByLabel('Sell price')).toHaveValue('10000');
    await expect(sellSide.getByLabel('Sell liquidity')).toHaveValue('0.22');
    await expect(sellSide.locator('.p2p-recurring-derived-field input')).toHaveValue('2200');
  });
});
