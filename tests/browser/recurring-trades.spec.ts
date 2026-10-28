import { expect, test } from '@playwright/test';
import { installLegacyTradingReads } from './fixtures/legacy-trading-reads';
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
  test.beforeEach(async ({ page }) => installLegacyTradingReads(page));
  test('redirects legacy trading aliases to canonical OTC routes', async ({ page }) => {
    test.setTimeout(60_000);
    const cases = [
      ['/otcdesk', '/otc/desk'],
      ['/otcdesk/create', '/otc/limit'],
      ['/otcdesk/mytrades', '/otc/orders'],
      ['/trades', '/otc/desk'],
      ['/trades/create', '/otc/limit'],
      ['/trades/mine', '/otc/orders'],
      ['/trades/recurring', '/otc/limit']
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
    await expect(drawer.locator('.landing-eyebrow', { hasText: /^P2P$/ })).toBeVisible();
    await expect(drawer.locator('.p2p-terminal-eyebrow', { hasText: /^Recurring P2P order$/ })).toBeVisible({
      timeout: 30_000
    });
    await expect(drawer.locator('.p2p-terminal-shell-recurring')).toBeVisible();
    await expect(drawer.locator('.p2p-terminal-main')).toBeVisible();
    await expect(drawer.locator('.p2p-terminal-history-desktop')).toHaveCount(0);
    await drawer.getByRole('tab', { name: 'Activity', exact: true }).click();
    await expect(drawer.locator('.p2p-terminal-activity-panel')).toBeVisible();
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

  test('shows recurring order controls and price sides from the maker perspective after wallet connect', async ({ page }) => {
    await installMockTradingWallet(page, RECURRING_ORDER_ONE_MAKER);
    await page.goto('/trades/recurring?order=1');
    await expect(page).toHaveURL(/\/otc\/order\/recurring\/1$/);

    const header = page.locator('.top-header');
    await header.locator('.wallet-primary-action').click();

    const terminal = page.locator('.p2p-terminal-shell-recurring');
    await expect(terminal).toBeVisible({ timeout: 30_000 });
    await expect(terminal.getByRole('button', { name: /Manage order|Manage offer/ })).toBeVisible();
    await expect(terminal.locator('.p2p-recurring-price-buy')).toContainText(/^Buy /i);
    await expect(terminal.locator('.p2p-recurring-price-sell')).toContainText(/^Sell /i);
  });

  test('shows functional current Offers filters without exposing private inventory', async ({ page }) => {
    await page.goto('/trades');
    const filters = page.locator('.p2p-offers-filter-controls');
    const type = filters.getByRole('combobox', { name: 'Type', exact: true });
    await expect(type).toBeVisible();
    await type.selectOption('recurring');
    await expect(type).toHaveValue('recurring');
    await expect(filters.getByLabel('Access')).toHaveCount(0);
    await filters.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(type).toHaveValue('all');
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
      await expect(terminal.locator('.landing-eyebrow', { hasText: /^P2P$/ })).toBeVisible();
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
      await expect(terminal.locator('.landing-eyebrow', { hasText: /^P2P$/ })).toBeVisible();
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
      await expect(page.getByRole('button', { name: 'Trading', exact: true })).toHaveAttribute('aria-current', 'page');
      await page.getByRole('button', { name: 'Chat', exact: true }).click();
      await expect(page).toHaveURL(/\/wallet-connect$/);
      await expect(page.getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute('aria-current', 'page');
      await page.getByRole('button', { name: 'Trading', exact: true }).click();
      await expect(page).toHaveURL(/\/wallet-connect$/);
      await expect(page.getByRole('button', { name: 'Trading', exact: true })).toHaveAttribute('aria-current', 'page');
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

    const deskButton = page.getByRole('button', { name: 'Offers', exact: true });
    await deskButton.click();
    await expect(page.locator('.standalone-trade-detail-section')).toBeVisible();
    await deskButton.click();

    await expect(page).toHaveURL(/\/otc$/);
    const pendingRoute = await page.evaluate((storageKey) => window.sessionStorage.getItem(storageKey), PENDING_TERMINAL_ROUTE_KEY);
    expect(pendingRoute).toBeNull();
  });

  test('opens one-off Create from a retired recurring URL without a recurring builder', async ({ page }, testInfo) => {
    const errors: string[] = [];
    const consoleMessages: { level: string; text: string }[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleMessages.push({ level: message.type(), text: message.text() });
      }
    });
    await page.goto('/otc/recurring');
    await expect(page).toHaveURL(/\/otc\/limit$/);
    await expect(page.getByRole('heading', { name: 'Create P2P offer', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'P2P trade offer', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Recurring P2P order', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Recurring', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'One-off', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create recurring strategy', exact: true })).toHaveCount(0);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    // Record background read health separately from the retired-creation check.
    const offersSettled = await expect(page.getByText(/^Loading market and offers(?:\u2026|\.{3})$/))
      .toHaveCount(0, { timeout: 10_000 }).then(() => true, () => false);
    await testInfo.attach('rendered-state', {
      body: JSON.stringify({
        url: page.url(), title: await page.title(), offersSettled, errors, consoleMessages,
        visibleText: await page.locator('body').innerText()
      }, null, 2),
      contentType: 'application/json'
    });
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('p2p-create.png') });
  });
  test('shows Carbon reference prices in create and terminal surfaces', async ({ page }) => {
    await mockCarbonPairReference(page, 0.000286);

    await page.goto('/otc/limit');
    await selectComposerToken(page, '.trade-compose-section-sell', 'p.WISP', 'Private');
    await selectComposerToken(page, '.trade-compose-section-buy', 'p.COTI', 'Private');
    await expect(page.getByRole('group', { name: 'P2P trade offer' }).locator('.p2p-carbon-price-reference')).toContainText(
      'Carbon price 0.000286 COTI/WISP'
    );

    await selectComposerToken(page, '.trade-compose-section-sell', 'gCOTI', 'Public');
    await selectComposerToken(page, '.trade-compose-section-buy', 'COTI', 'Public');
    await expect(page.getByRole('group', { name: 'P2P trade offer' }).locator('.p2p-carbon-price-reference')).toContainText(
      'Carbon price 0.000286 COTI/gCOTI'
    );

    await selectComposerToken(page, '.trade-compose-section-sell', 'p.gCOTI', 'Private');
    await selectComposerToken(page, '.trade-compose-section-buy', 'p.COTI', 'Private');
    await expect(page.getByRole('group', { name: 'P2P trade offer' }).locator('.p2p-carbon-price-reference')).toContainText(
      'Carbon price 0.000286 COTI/gCOTI'
    );

    await expect(page.getByRole('tab', { name: 'Recurring' })).toHaveCount(0);
    await expect(page.locator('.trading-ratio-trigger')).toBeVisible();

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

    const activeComposer = page.getByRole('group', { name: 'P2P trade offer' });
    const carbonReference = activeComposer.locator('.p2p-carbon-price-reference');
    await expect(carbonReference).toContainText('Carbon price');

    const bounds = await page.evaluate(() => {
      const carbon = document.querySelector('[aria-label="P2P trade offer"] .p2p-carbon-price-reference');
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

    await page.goto('/trades/recurring?order=6');
    await expect(page).toHaveURL(/\/otc\/order\/recurring\/6$/);
    await expect(page.locator('.p2p-terminal-shell-recurring')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.p2p-terminal-shell-recurring .p2p-carbon-price-reference')).toHaveCount(0);
  });

  test('hides Carbon reference prices when Carbon has no pair data', async ({ page }) => {
    await mockCarbonPairReference(page, null);

    await page.goto('/otc/limit');
    await expect(page.getByRole('group', { name: 'P2P trade offer' }).locator('.p2p-carbon-price-reference')).toHaveCount(0);
  });

  test('keeps old empty recurring aliases in one-off Create', async ({ page }) => {
    for (const path of ['/otc/limit?mode=recurring', '/trades/create?tab=recurring', '/otc/order/recurring']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/otc\/limit$/);
      await expect(page.getByRole('group', { name: 'P2P trade offer', exact: true })).toBeVisible();
      await expect(page.getByRole('group', { name: 'Recurring P2P order', exact: true })).toHaveCount(0);
    }
  });
  test('keeps an existing recurring order reachable after leaving a retired create route', async ({ page }) => {
    await page.goto('/otc/recurring');
    await page.getByRole('navigation', { name: 'P2P trading views' }).getByRole('button', { name: 'Offers', exact: true }).click();
    const linkTool = page.locator('.p2p-offers-private-link-tool');
    await linkTool.locator('summary').click();
    await linkTool.getByLabel('Private trade link').fill('/otc/order/recurring/1');
    await linkTool.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page).toHaveURL(/\/otc\/order\/recurring\/1$/);
    await expect(page.locator('.p2p-terminal-shell-recurring')).toBeVisible();
    await expect(page.locator('.p2p-terminal-shell-recurring')).toContainText('WISP');
  });
});








