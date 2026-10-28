import { expect, test, type Page } from '@playwright/test';
import { installLegacyTradingReads, openLegacyPublicOffers } from './fixtures/legacy-trading-reads';
test.beforeEach(async ({ page }) => installLegacyTradingReads(page));

const mobileViewport = { width: 390, height: 844 };
const mockTradingWalletAddress = '0x1234567890abcdef1234567890abcdef12345678';
const sampleRecurringMakerAddress = '0xbf01185A70CDfEF1858659836D57BFf085ebed55';
const cotiChainIdHex = '0x282b34';

const expectNoHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(4);
};

const openTradeActivity = async (page: Page) => {
  const tabs = page.getByRole('tablist', { name: 'Trade terminal view' });
  await tabs.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(tabs.getByRole('tab', { name: 'Activity', exact: true })).toHaveAttribute('aria-selected', 'true');
  const activity = page.getByRole('tabpanel', { name: 'Trade activity', exact: true });
  await expect(activity.locator('.p2p-terminal-history-head')).toContainText('Trade activity');
  await expect(activity.getByRole('button', { name: /Reveal.*history/i })).toHaveCount(0);
  return activity;
};

const returnToTradeOverview = async (page: Page) => {
  const overview = page.getByRole('tablist', { name: 'Trade terminal view' }).getByRole('tab', { name: 'Overview', exact: true });
  await overview.click();
  await expect(overview).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Trade overview', exact: true })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'Trade activity', exact: true })).toHaveCount(0);
};

const scrollTradeShellToBottom = async (page: Page) => {
  await page.evaluate(() => {
    const candidates = [
      document.querySelector<HTMLElement>('.p2p-trade-workspace-panel'),
      document.querySelector<HTMLElement>('.standalone-trades-shell'),
      document.scrollingElement
    ].filter((element): element is Element => Boolean(element));
    const scrollTarget =
      candidates.find((element) => {
        const style = window.getComputedStyle(element);
        return (
          element.scrollHeight > element.clientHeight + 1 &&
          ['auto', 'scroll', 'overlay'].includes(style.overflowY)
        );
      }) ?? document.scrollingElement;
    if (scrollTarget) {
      scrollTarget.scrollTop = scrollTarget.scrollHeight;
    }
  });
};

const expectClearOfTradeTabs = async (page: Page, selector: string) => {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeVisible();
  const targetBox = await target.boundingBox();
  const tabsBox = await page.getByRole('navigation', { name: 'P2P trading views' }).boundingBox();
  expect(targetBox).not.toBeNull();
  expect(tabsBox).not.toBeNull();
  const overlapY = Math.min(targetBox!.y + targetBox!.height, tabsBox!.y + tabsBox!.height)
    - Math.max(targetBox!.y, tabsBox!.y);
  expect(overlapY).toBeLessThanOrEqual(0);
  expect(targetBox!.y).toBeGreaterThanOrEqual(0);
  expect(targetBox!.y + targetBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
};

const installMockTradingWallet = async (
  page: Page,
  address = mockTradingWalletAddress,
  { snapAesKey = '' }: { snapAesKey?: string } = {}
) => {
  await page.addInitScript(({ address, chainIdHex, snapAesKey }) => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const requestedMethods: string[] = [];
    const provider = {
      isMetaMask: true,
      selectedAddress: address,
      request: async ({ method, params }: { method: string; params?: object | unknown[] }) => {
        const snapMethod =
          method === 'wallet_invokeSnap' && params && !Array.isArray(params)
            ? (params as { request?: { method?: string } }).request?.method
            : undefined;
        requestedMethods.push(snapMethod ? `${method}:${snapMethod}` : method);
        switch (method) {
          case 'eth_requestAccounts':
          case 'eth_accounts':
            return [address];
          case 'eth_chainId':
            return chainIdHex;
          case 'wallet_requestPermissions':
            return [{ parentCapability: 'eth_accounts', caveats: [] }];
          case 'wallet_switchEthereumChain':
          case 'wallet_addEthereumChain':
            return null;
          case 'wallet_getSnaps':
            return snapAesKey ? { 'npm:@coti-io/coti-snap': {} } : null;
          case 'wallet_requestSnaps':
            return snapAesKey ? { 'npm:@coti-io/coti-snap': {} } : null;
          case 'wallet_invokeSnap':
            if (!snapAesKey) {
              return null;
            }
            if (snapMethod === 'connect-to-wallet') {
              return true;
            }
            if (snapMethod === 'has-aes-key') {
              return true;
            }
            if (snapMethod === 'get-aes-key') {
              return snapAesKey;
            }
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
    Object.defineProperty(window, '__chainWhisperMockWalletMethods', {
      configurable: true,
      value: requestedMethods
    });
  }, { address, chainIdHex: cotiChainIdHex, snapAesKey });
};

const parseLeadingPrice = (value: string | null) => {
  const match = value?.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
};

const parseColorAlpha = (value: string) => {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) {
    return 1;
  }
  if (match[1].includes('/')) {
    const alpha = Number(match[1].split('/').pop()?.trim());
    return Number.isFinite(alpha) ? alpha : 1;
  }
  const parts = match[1].includes(',') ? match[1].split(',') : match[1].trim().split(/\s+/);
  const values = parts.map((part) => Number(part.trim()));
  return Number.isFinite(values[3]) ? values[3] : 1;
};

const parseColorChroma = (value: string) => {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) {
    return 255;
  }
  const channelParts = match[1].includes('/') ? match[1].split('/')[0] : match[1];
  const parts = channelParts.includes(',') ? channelParts.split(',') : channelParts.trim().split(/\s+/);
  const values = parts.slice(0, 3).map((part) => Number(part.trim()));
  if (values.some((channel) => !Number.isFinite(channel))) {
    return 255;
  }
  return Math.max(...values) - Math.min(...values);
};

test.describe('mobile layout polish', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(mobileViewport);
  });

  test('keeps the chat wallet header compact on mobile', async ({ page }) => {
    await page.goto('/chat');

    await expect(page.locator('.top-header-mobile-wallet .wallet-header-panel')).toBeVisible();
    await expect(page.locator('.top-header-mobile-wallet .wallet-primary-action')).toBeVisible();
    await page.locator('.top-header-mobile-wallet').getByRole('button', { name: /^Open Wallet menu$/ }).click();
    await expect(page.getByRole('menuitem', { name: /^Open MetaMask Mobile$/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /MetaMask or CipherTrade not detected/i })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /^Create account$/ })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /^Import account$/ })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test('uses the same accessible mobile owner controls for Chat and Trading', async ({ page }) => {
    await installMockTradingWallet(page);
    for (const route of ['/chat', '/otc/desk']) {
      await page.goto(route);
      const header = page.locator('.top-header');
      const wallet = header.locator('.top-header-mobile-wallet-inline');
      await expect(wallet.locator('.wallet-primary-action')).toBeVisible();
      const menu = wallet.getByRole('button', { name: 'Open Wallet menu', exact: true });
      await expect(menu).toBeVisible();
      expect(await menu.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      await menu.click();
      const utilities = page.getByRole('menu', { name: 'Wallet' });
      await expect(utilities.getByRole('switch', { name: /Turn notification sound/ })).toBeVisible();
      await expect(utilities.getByRole('menuitem', { name: 'Help', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toBeFocused();
      const bounds = await wallet.evaluate(element => {
        const box = element.getBoundingClientRect(); return { left: box.left, right: box.right, width: document.documentElement.clientWidth };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
      await expectNoHorizontalOverflow(page);
    }
  });
  test('keeps OTC Desk tabs and wallet controls usable on mobile', async ({ page }) => {
    await page.goto('/trades');

    const appStrip = page.locator('.top-header-mobile-app-nav');
    await expect(appStrip).toBeVisible();
    await expect(appStrip.getByRole('navigation', { name: 'ChainWhisper apps' })).toBeVisible();
    await expect(page.locator('.top-header-bar').getByRole('button', { name: 'Back to home' })).toBeVisible();
    await expect(page.locator('.top-header-mobile-utility-cluster')).toBeVisible();
    await expect(page.locator('.top-header-mobile-wallet .wallet-header-panel')).toBeVisible();
    await expect(page.locator('.top-header-mobile-wallet .wallet-primary-action')).toBeVisible();
    await page.locator('.top-header-mobile-wallet').getByRole('button', { name: /^Open Wallet menu$/ }).click();
    await expect(page.getByRole('menuitem', { name: /^Open MetaMask Mobile$/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /MetaMask or CipherTrade not detected/i })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /^Create account$/ })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /^Import account$/ })).toHaveCount(0);
    await page.locator('.top-header-mobile-wallet').getByRole('button', { name: /^Close Wallet menu$/ }).click();
    await installMockTradingWallet(page);
    await page.reload();
    await page.locator('.top-header-mobile-wallet').getByRole('button', { name: /^Open Wallet menu$/ }).click();
    const soundToggle = page.getByRole('menu', { name: 'Wallet' }).getByRole('switch', { name: /Turn notification sound/ });
    await expect(soundToggle).toBeVisible();
    const soundBefore = await soundToggle.getAttribute('aria-checked');
    await soundToggle.click();
    await expect(soundToggle).not.toHaveAttribute('aria-checked', soundBefore ?? '');
    await page.keyboard.press('Escape');
    const tradeTabs = page.getByRole('navigation', { name: 'P2P trading views' });
    await expect(tradeTabs).toBeVisible();
    await expect(tradeTabs.getByRole('button', { name: 'Create' })).toBeVisible();
    await expect(tradeTabs.getByRole('button', { name: 'Offers' })).toBeVisible();
    await expect(tradeTabs.getByRole('button', { name: 'Agent' })).toBeVisible();
    await expect(tradeTabs.getByRole('button', { name: 'My trades', exact: true })).toBeVisible();

    const toggle = page.getByRole('button', { name: /^Filter offers/ });
    await toggle.click();
    const filters = page.locator('.p2p-offers-filter-controls');
    await expect(filters).toBeVisible();
    await filters.getByRole('combobox', { name: 'Type', exact: true }).selectOption('private');
    await expect(filters.getByRole('combobox', { name: 'Type', exact: true })).toHaveValue('private');
    await toggle.click();
    await expect(filters).toBeHidden();
    await toggle.click();
    await expect(filters.getByRole('combobox', { name: 'Type', exact: true })).toHaveValue('private');
    await expectNoHorizontalOverflow(page);
  });

  test('keeps the connected trading wallet hierarchy readable at tablet width', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await installMockTradingWallet(page);
    await page.goto('/trades');

    const header = page.locator('.top-header');
    const wallet = header.locator('.top-header-mobile-wallet-inline');
    await wallet.locator('.wallet-primary-action').click();

    await expect(wallet.getByRole('button', { name: 'Unlock privacy with MetaMask' })).toBeVisible();
    await expect(wallet.locator('.wallet-primary-action')).toHaveAccessibleName(new RegExp(mockTradingWalletAddress, 'i'));
    await expect(wallet.getByRole('button', { name: 'Unlock privacy with MetaMask' })).toBeVisible();
    await expect(wallet.getByRole('button', { name: /Copy wallet address/ })).toBeVisible();
    await expect(wallet.locator('.p2p-wallet-status-indicator')).toContainText('Privacy locked');
    await expect(wallet.getByRole('button', { name: /^Open Wallet menu$/ })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Back to home' })).toBeVisible();
    await expect(header.locator('.top-header-mobile-app-nav')).toBeVisible();

    const layout = await page.evaluate(() => {
      const headerRect = document.querySelector<HTMLElement>('.top-header-bar')?.getBoundingClientRect();
      const walletRect = document
        .querySelector<HTMLElement>('.top-header-mobile-wallet-inline')
        ?.getBoundingClientRect();
      const statusRect = document
        .querySelector<HTMLElement>('.top-header-mobile-wallet-inline .p2p-wallet-status-text')
        ?.getBoundingClientRect();
      return {
        header: headerRect ? { left: headerRect.left, right: headerRect.right } : null,
        wallet: walletRect ? { left: walletRect.left, right: walletRect.right } : null,
        statusWidth: statusRect?.width ?? 0,
      };
    });

    expect(layout.header).not.toBeNull();
    expect(layout.wallet).not.toBeNull();
    expect(layout.wallet!.left).toBeGreaterThanOrEqual(layout.header!.left);
    expect(layout.wallet!.right).toBeLessThanOrEqual(layout.header!.right);
    expect(layout.wallet!.right - layout.wallet!.left).toBeGreaterThanOrEqual(132);
    await expectNoHorizontalOverflow(page);
  });

  test('uses COTI Snap before any fallback during connected privacy preparation', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await installMockTradingWallet(page, mockTradingWalletAddress, {
      snapAesKey: 'snap-owner-aes'
    });
    await page.goto('/trades');

    const wallet = page.locator('.top-header-mobile-wallet-inline');
    await wallet.getByRole('button', { name: 'Unlock privacy with MetaMask' }).click();

    await expect.poll(() => page.evaluate(
      () =>
        (window as Window & { __chainWhisperMockWalletMethods?: string[] })
          .__chainWhisperMockWalletMethods ?? []
    )).toContain('wallet_invokeSnap:get-aes-key');
    await expect(wallet.locator('.p2p-wallet-status-indicator')).toContainText('Privacy ready');
    const requestedMethods = await page.evaluate(() =>
      (window as Window & { __chainWhisperMockWalletMethods?: string[] })
        .__chainWhisperMockWalletMethods ?? []
    );

    expect(requestedMethods).toContain('wallet_invokeSnap:connect-to-wallet');
    expect(requestedMethods).toContain('wallet_invokeSnap:has-aes-key');
    expect(requestedMethods).toContain('wallet_invokeSnap:get-aes-key');
    expect(requestedMethods).not.toContain('personal_sign');
    expect(requestedMethods).not.toContain('eth_sendTransaction');
  });

  test('keeps mobile token balances and contract links reachable in Create', async ({ page }) => {
    await page.goto('/otc/limit');
    const composer = page.locator('.standalone-trade-create-panel');
    await expect(composer).toBeVisible();
    const links = composer.locator('.trade-token-select-state a');
    await expect(links.first()).toHaveAttribute('href', /\/address\//);
    await links.first().scrollIntoViewIfNeeded();
    await expect(links.first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect MetaMask or CipherTrade', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('restores mobile desk scroll after visiting the terminal tab', async ({ page }) => {
    await page.setViewportSize({ width: mobileViewport.width, height: 480 });
    await openLegacyPublicOffers(page, '/otc/desk');
    const shell = page.locator('.standalone-trades-shell');
    await expect(shell).toBeVisible();
    const captureScroll = async (stage: string) => {
      const state = await shell.evaluate(node => ({ top: node.scrollTop, height: node.scrollHeight, clientHeight: node.clientHeight }));
      console.info(`Mobile Offers scroll ${stage}: ${JSON.stringify({ path: new URL(page.url()).pathname, ...state })}`);
    };
    const firstOrder = page.locator('.p2p-offer-rate-row').filter({ hasText: 'Recurring P2P' }).first();
    await expect(firstOrder).toBeVisible({ timeout: 30_000 });
    await firstOrder.scrollIntoViewIfNeeded();
    const savedTop = await shell.evaluate((node) => {
      const targetTop = Math.min(90, Math.max(0, node.scrollHeight - node.clientHeight));
      node.scrollTop = targetTop;
      return node.scrollTop;
    });
    expect(savedTop).toBeGreaterThanOrEqual(24);

    const tradeTabs = page.getByRole('navigation', { name: 'P2P trading views' });
    await firstOrder.scrollIntoViewIfNeeded();
    const clickedTop = await shell.evaluate(node => node.scrollTop);
    expect(Math.abs(clickedTop - savedTop)).toBeLessThanOrEqual(4);
    await captureScroll('before first open');
    await firstOrder.click();
    await captureScroll('after first open click');
    await expect(page.locator('.standalone-trade-detail-section .p2p-terminal-shell-recurring')).toBeVisible();
    await page.getByRole('button', { name: 'Back to offers' }).click();
    await expect(page.locator('.p2p-offers-workspace')).toBeVisible();
    await captureScroll('after Back return');
    await page.waitForFunction(
      (expectedTop) => {
        const node = document.querySelector<HTMLElement>('.standalone-trades-shell');
        return Boolean(node && Math.abs(node.scrollTop - expectedTop) <= 4);
      },
      savedTop
    );

    await firstOrder.scrollIntoViewIfNeeded();
    const secondSavedTop = await shell.evaluate(node => node.scrollTop);
    await captureScroll('before second open');
    await firstOrder.click();
    await captureScroll('after second open click');
    await expect(page.locator('.standalone-trade-detail-section .p2p-terminal-shell-recurring')).toBeVisible();
    await tradeTabs.getByRole('button', { name: 'Offers' }).click();
    await expect(page.locator('.p2p-offers-workspace')).toBeVisible();
    await captureScroll('after Offers return');
    await page.waitForFunction(
      (expectedTop) => {
        const node = document.querySelector<HTMLElement>('.standalone-trades-shell');
        return Boolean(node && Math.abs(node.scrollTop - expectedTop) <= 4);
      },
      secondSavedTop
    );

    await captureScroll('before repeated Offers click');
    await tradeTabs.getByRole('button', { name: 'Offers' }).click();
    await captureScroll('after repeated Offers click');
    await page.waitForFunction(() => {
      const node = document.querySelector<HTMLElement>('.standalone-trades-shell');
      return Boolean(node && node.scrollTop <= 4);
    });
  });

  test('keeps both recurring mobile prices readable in the current stacked layout', async ({ page }) => {
    await page.setViewportSize(mobileViewport);
    await page.goto('/otc/order/recurring/1');

    const recurringCard = page.locator('.p2p-terminal-shell-recurring');
    await expect(recurringCard).toBeVisible({ timeout: 30_000 });
    const priceLayout = await recurringCard.locator('.p2p-recurring-price-grid').evaluate((grid) => {
      const box = grid.getBoundingClientRect();
      const columns = window.getComputedStyle(grid).gridTemplateColumns;
      const priceBoxes = [...grid.querySelectorAll('.p2p-recurring-price-box')].map((priceBox) => {
        const rect = priceBox.getBoundingClientRect();
        return { top: Math.round(rect.top), width: rect.width };
      });
      return { columns, priceBoxes, width: box.width };
    });

    expect(priceLayout.width).toBeGreaterThan(300);
    expect(priceLayout.columns.split(' ')).toHaveLength(1);
    expect(priceLayout.priceBoxes).toHaveLength(2);
    expect(priceLayout.priceBoxes[1].top).toBeGreaterThan(priceLayout.priceBoxes[0].top);
    for (const priceBox of priceLayout.priceBoxes) expect(Math.abs(priceBox.width - priceLayout.width)).toBeLessThanOrEqual(2);
  });

  test('shows the desktop wallet entry without fabricated balance chips', async ({ page }) => {
    await installMockTradingWallet(page);
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto('/trades');
    await expect(page.locator('.top-header').getByRole('button', { name: /Copy wallet address/ })).toBeVisible();
    await expect(page.getByText('-- COTI', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open Wallet menu', exact: true }).click();
    await expect(page.getByRole('menu', { name: 'Wallet' }).getByRole('menuitem', { name: /Network/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('keeps desktop owner identity accessible when wallet utilities close', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await installMockTradingWallet(page);
    await page.goto('/trades');
    await page.locator('.top-header .wallet-primary-action').click();
    const copy = page.locator('.top-header').getByRole('button', { name: /Copy wallet address/ });
    await expect(copy).toBeVisible();
    const menu = page.getByRole('button', { name: 'Open Wallet menu', exact: true });
    await menu.click();
    await expect(page.getByRole('menu', { name: 'Wallet' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Wallet' })).toHaveCount(0);
    await expect(menu).toBeFocused();
    await expect(copy).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('previews My Trades workspace before wallet connection', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto('/trades/mine');

    const workspace = page.locator('.p2p-my-trades-empty-workspace');
    await expect(workspace).toBeVisible();
    await expect(workspace.locator('.p2p-my-trades-wallet-card')).toContainText('Wallet readiness');
    await expect(workspace.locator('.p2p-my-trades-wallet-card')).toContainText('Connect your trading wallet');
    await expect(workspace.locator('.p2p-my-trades-connect-btn')).toHaveCount(0);
    await expect(workspace.locator('.p2p-my-trades-empty-slot[aria-disabled="true"]')).toHaveCount(3);
    await expect(workspace.locator('.p2p-my-trades-empty-slot', { hasText: 'Received' })).toContainText('0');
    await expect(workspace.locator('.p2p-my-trades-empty-slot', { hasText: 'Active' })).toContainText('0');
    await expect(workspace.locator('.p2p-my-trades-empty-slot', { hasText: 'History' })).toContainText('0');
    await expect(page.locator('.p2p-wallet-trade-switcher')).toHaveCount(0);
    await expect(page.locator('.p2p-my-trades-section .standalone-trade-secondary-btn')).toHaveCount(0);
    await expect(page.getByText('Connect to see your trades')).toHaveCount(0);

    const layout = await page.evaluate(() => {
      const wallet = document.querySelector<HTMLElement>('.p2p-my-trades-wallet-card')?.getBoundingClientRect();
      const preview = document.querySelector<HTMLElement>('.p2p-my-trades-empty-preview')?.getBoundingClientRect();
      const slots = Array.from(document.querySelectorAll<HTMLElement>('.p2p-my-trades-empty-slot')).map((slot) =>
        slot.getBoundingClientRect(),
      );
      return {
        wallet: wallet ? { x: wallet.x, y: wallet.y, width: wallet.width, height: wallet.height } : null,
        preview: preview ? { x: preview.x, y: preview.y, width: preview.width, height: preview.height } : null,
        slots: slots.map((slot) => ({ y: slot.y, height: slot.height })),
      };
    });

    expect(layout.wallet).not.toBeNull();
    expect(layout.preview).not.toBeNull();
    expect(layout.preview!.x).toBeGreaterThan(layout.wallet!.x + layout.wallet!.width - 1);
    expect(Math.abs(layout.wallet!.y - layout.preview!.y)).toBeLessThanOrEqual(2);
    for (const slot of layout.slots) {
      expect(slot.height).toBeGreaterThanOrEqual(32);
      expect(Math.abs(slot.height - layout.slots[0].height)).toBeLessThanOrEqual(2);
      expect(slot.y + slot.height).toBeLessThanOrEqual(layout.preview!.y + layout.preview!.height + 1);
    }

    await expectNoHorizontalOverflow(page);
  });

  test('loads My Trades after connecting from the desk and keeps one refresh action', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await installMockTradingWallet(page);
    await page.goto('/trades');

    await page.locator('.top-header .wallet-primary-action').click();
    await page.getByRole('navigation', { name: 'P2P trading views' }).getByRole('button', { name: 'My trades' }).click();

    const myTradesSection = page.locator('.p2p-my-trades-section');
    await expect(myTradesSection).toBeVisible();
    const switcher = myTradesSection.locator('.p2p-wallet-trade-switcher');
    await expect(switcher).toBeVisible({ timeout: 45_000 });
    await expect(myTradesSection.locator('.p2p-my-trades-empty-workspace')).toHaveCount(0);
    await expect(myTradesSection.locator('.p2p-my-trades-refresh-btn')).toHaveCount(1);
    await expect(myTradesSection.getByRole('button', { name: /^(Refresh|Refreshing\.\.\.)$/ })).toHaveCount(1);

    for (const group of ['Active', 'History']) {
      await expect(switcher.getByRole('tab', { name: new RegExp(`${group}: \\d+`) })).toBeVisible();
    }

    await switcher.getByRole('tab', { name: /Active: \d+/ }).click();
    await expect(switcher.getByRole('tab', { name: /Active: \d+/ })).toHaveAttribute('aria-selected', 'true');
    await myTradesSection.getByRole('button', { name: /^Incoming/ }).click();
    await expect(myTradesSection.locator('.p2p-wallet-trade-empty')).toContainText('No received offers');
    await switcher.getByRole('tab', { name: /History: \d+/ }).click();
    await expect(switcher.getByRole('tab', { name: /History: \d+/ })).toHaveAttribute('aria-selected', 'true');
    await expect(myTradesSection.locator('.p2p-wallet-trade-group-head')).toHaveCount(0);
    await expect(myTradesSection.locator('.p2p-wallet-trade-empty')).toContainText('No history yet');

    await myTradesSection.locator('.p2p-my-trades-refresh-btn').click();
    await expect(myTradesSection.locator('.p2p-wallet-trade-switcher')).toBeVisible();
    await expect(myTradesSection.getByRole('button', { name: /^(Refresh|Refreshing\.\.\.)$/ })).toHaveCount(1);
    const scrollState = await page.evaluate(() => {
      const read = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) {
          return null;
        }
        return window.getComputedStyle(element).overflowY;
      };
      return {
        section: read('.p2p-my-trades-section'),
        shell: read('.p2p-trading-shell-mine')
      };
    });
    // Desktop My Trades uses its own scrollable section inside the visible
    // workspace. The separate mobile case checks the outer page flow.
    expect(scrollState.shell).toBe('visible');
    expect(scrollState.section).toBe('auto');
    await expectNoHorizontalOverflow(page);
  });

  test('opens the mobile trading terminal as focused page content', async ({ page }) => {
    await page.goto('/otc/order');

    const terminal = page.locator('.standalone-trade-detail-section');
    await expect(terminal).toBeVisible();
    await expect(terminal.locator('.landing-eyebrow', { hasText: /^P2P$/ })).toBeVisible();
    await expect(terminal.getByRole('heading', { name: 'Open order' })).toBeVisible();
    await expect(terminal.getByText('Paste a shared offer link')).toBeVisible();
    await expect(terminal.getByRole('button', { name: 'Open order', exact: true })).toBeVisible();
    await expect(terminal.getByRole('button', { name: 'Open desk', exact: true })).toBeVisible();
    await expect(terminal.getByRole('button', { name: 'Create offer', exact: true })).toBeVisible();
    await expect(terminal.getByText('Open trading terminal', { exact: true })).toHaveCount(0);
    await expect(terminal.getByRole('button', { name: 'Paste Link', exact: true })).toHaveCount(0);
    await expect(terminal.locator('.p2p-trade-window-warning')).toHaveCount(0);
    await expect(page.locator('.p2p-market-overview')).toBeHidden();
    await expect(page.locator('.p2p-offers-workspace')).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'P2P trading views' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('keeps mobile trade creation actions reachable without eager field errors', async ({ page }) => {
    page.on('pageerror', error => console.error(`Create runtime error: ${error.message}`));
    page.on('requestfailed', request => {
      if (new URL(request.url()).hostname === '127.0.0.1') console.error(`Create local request failed: ${new URL(request.url()).pathname} ${request.failure()?.errorText}`);
    });
    page.on('response', response => {
      if (new URL(response.url()).hostname === '127.0.0.1' && response.status() >= 400) console.error(`Create local response: ${response.status()} ${new URL(response.url()).pathname}`);
    });
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) console.info(`Create navigation: ${new URL(frame.url()).pathname}`);
    });
    await installMockTradingWallet(page);
    const response = await page.goto('/otc/limit');
    console.info(`Create navigation status: ${response?.status()}`);
    try {
      await expect(page.getByRole('group', { name: 'P2P trade offer' })).toBeVisible();
    } catch (error) {
      console.info(`Create render state: ${JSON.stringify(await page.evaluate(() => ({ path: window.location.pathname, readyState: document.readyState, rootChildren: document.querySelector('#root')?.childElementCount })))}`);
      await page.screenshot({ path: test.info().outputPath('create-runtime-failure.png'), fullPage: true });
      throw error;
    }
    // Use real selectors and public balances. The default private pair requires
    // privacy authority, which this connection-only wallet does not provide.
    for (const [sectionName, symbol] of [['sell', 'WISP'], ['buy', 'COTI']]) {
      const section = page.locator(`.trade-compose-section-${sectionName}`);
      await section.locator('.trade-token-select-trigger').click();
      const dropdown = section.locator('.trade-token-select-dropdown');
      await dropdown.getByRole('tab', { name: /^Public\b/ }).click();
      await dropdown.getByLabel('Search trade tokens').fill(symbol);
      await dropdown.getByRole('option', { name: new RegExp(`^${symbol}\\b`) }).click();
      await expect(section.locator('.trade-token-select-trigger strong')).toHaveText(symbol);
    }
    await page.locator('summary').filter({ hasText: /^Advanced options/ }).click();
    await page.getByRole('group', { name: 'Private liquidity', exact: true }).getByRole('button', { name: 'Visible amounts', exact: true }).click();
    await page.locator('summary').filter({ hasText: /^Advanced options/ }).click();

    const readiness = page.locator('.trade-compose-readiness');
    await expect(readiness).toContainText('Enter a valid WISP amount to send.');

    const sendAmountError = page.locator('.trade-compose-section-sell .trade-compose-field-error').filter({ hasText: /Enter a valid .+ amount to send\./ });
    await expect(sendAmountError).toHaveCount(0);
    await page.getByRole('button', { name: 'Create Offer' }).click();
    await expect(sendAmountError).toBeVisible();

    await page.locator('.trade-compose-section-sell .trade-compose-amount-field .trade-compose-input').fill('10');
    await page.locator('.trade-compose-price-field .trade-compose-input').fill('1');
    await expect(page.locator('.trade-compose-pricing-source')).toHaveCount(2);
    await expect(page.locator('.trade-compose-pricing-derived')).toHaveCount(1);
    await expect(page.locator('.trade-compose-pricing-derived .trade-compose-pricing-state')).toHaveText('Calculated');

    await scrollTradeShellToBottom(page);
    await expect(page.getByRole('button', { name: 'Create Offer' })).toBeVisible();
    await expectClearOfTradeTabs(page, '.trade-compose-footer');
    await expectNoHorizontalOverflow(page);
  });

  test('keeps one-off Create reachable from retired recurring routes on mobile', async ({ page }, testInfo) => {
    await page.goto('/otc/recurring');
    await expect(page).toHaveURL(/\/otc\/limit$/);
    await expect(page.getByRole('group', { name: 'P2P trade offer', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Recurring', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create recurring strategy', exact: true })).toHaveCount(0);
    await scrollTradeShellToBottom(page);
    await expect(page.getByRole('button', { name: 'Create Offer', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('p2p-create-mobile.png') });
  });

  test('opens mobile trade Activity and returns to the trade overview', async ({ page }) => {
    await page.goto('/trades/recurring?order=1');
    await expect(page.locator('.p2p-terminal-shell-recurring')).toBeVisible();
    const activity = await openTradeActivity(page);
    await expect(activity).toContainText('Recurring P2P #1');
    await expect(activity.locator('.p2p-terminal-history-row-lifecycle')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
    await returnToTradeOverview(page);
    await expect(page.locator('.p2p-terminal-shell-recurring')).toBeVisible();
  });

  test('keeps the mobile trading terminal dense without stacking early', async ({ page }) => {
    await page.goto('/trades/recurring?order=1');

    const terminal = page.locator('.p2p-terminal-shell-recurring');
    await expect(terminal).toBeVisible({ timeout: 30_000 });

    const terminalTop = page.locator('.standalone-trade-detail-section > .standalone-trades-section-head');
    const terminalTopBox = await terminalTop.boundingBox();
    expect(terminalTopBox).not.toBeNull();
    expect(terminalTopBox!.height).toBeLessThanOrEqual(96);
    expect((await terminalTop.getByRole('button', { name: 'Back to offers' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(terminalTop.locator('.landing-eyebrow')).toContainText('P2P');
    await expect(terminalTop.getByRole('button', { name: 'Back to offers' })).toBeVisible();

    await expect(terminal.locator('.p2p-terminal-head')).toBeVisible();
    await expect(terminal.locator('.p2p-terminal-head')).toContainText('Recurring P2P #1');

    const liquidityCells = terminal.locator('.p2p-terminal-liquidity-grid > div');
    await expect(liquidityCells).toHaveCount(3);
    const liquiditySpread = await liquidityCells.evaluateAll((cells) => {
      const tops = cells.map((cell) => Math.round(cell.getBoundingClientRect().top));
      return Math.max(...tops) - Math.min(...tops);
    });
    expect(liquiditySpread).toBeLessThanOrEqual(2);

    const amountFields = terminal.locator('.p2p-terminal-amount-grid .p2p-terminal-input-field');
    if ((await amountFields.count()) >= 2) {
      const amountMetrics = await amountFields.evaluateAll((fields) =>
        fields.slice(0, 2).map((field) => {
          const box = field.getBoundingClientRect();
          return { top: Math.round(box.top), width: box.width };
        })
      );
      expect(Math.abs(amountMetrics[0].top - amountMetrics[1].top)).toBeLessThanOrEqual(2);
      expect(amountMetrics[0].width).toBeGreaterThan(120);
      expect(amountMetrics[1].width).toBeGreaterThan(120);
    }

    await scrollTradeShellToBottom(page);
    await expect(page.locator('.p2p-mobile-contracts-btn')).toHaveCount(0);
    await expect(page.locator('.wallet-primary-action')).toBeVisible();
    const activity = await openTradeActivity(page);
    await expect(activity.locator('.p2p-terminal-history-row-lifecycle')).toHaveCount(1);
    await returnToTradeOverview(page);
    await expectNoHorizontalOverflow(page);
  });

  test('keeps mobile trade controls usable across token, access, and terminal states', async ({ page }) => {
    await page.goto('/otc/limit');

    await page.locator('.trade-token-select-trigger').first().click();
    const tokenDropdown = page.locator('.trade-token-select-dropdown');
    const tokenState = page.locator('.trade-token-select-state').first();
    await expect(tokenDropdown).toBeVisible();
    await expect(tokenDropdown.getByLabel('Search trade tokens')).not.toBeFocused();
    const firstTokenOption = tokenDropdown.locator('.trade-token-select-option').first();
    await firstTokenOption.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true });
    await expect(tokenDropdown).toBeHidden();
    await page.locator('.trade-token-select-trigger').first().click();
    await expect(tokenDropdown).toBeVisible();
    await tokenDropdown.getByLabel('Search trade tokens').click();
    await expect(tokenDropdown.getByLabel('Search trade tokens')).toBeFocused();
    await expect(tokenState).toContainText(/Whitelisted|Native asset|Balance pending/);
    await expect(tokenState).not.toContainText(/Balance\s+(?:--|\d)/);
    await expect(tokenState.locator('a[title="View token on explorer"]')).toBeVisible();
    await expect(page.locator('.trade-compose-asset-field > .trade-compose-field-head .trade-compose-icon-link')).toHaveCount(0);
    await expect(tokenDropdown).not.toContainText(/Custom public|Custom private|Custom token|Custom .*CA/);
    await expect(tokenDropdown.locator('.trade-token-select-option-main strong').first()).toBeVisible();
    await expect(tokenDropdown.locator('.trade-token-select-option-main small').first()).toBeVisible();
    await expect(tokenDropdown.locator('.trade-token-select-option-kind').first()).toBeVisible();
    await expect(tokenDropdown.locator('.trade-token-select-check')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await page.locator('.trade-token-select-trigger').first().click();
    await expect(tokenDropdown).toBeHidden();
    await expect(page).toHaveURL(/\/otc\/limit$/);
    await page.getByRole('button', { name: /^Direct proposal$/ }).click();
    await expect(page.locator('.p2p-direct-recipient')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: /^Private link$/ }).click();
    await expect(page.getByRole('button', { name: /^Private link$/ })).toHaveAttribute('aria-pressed', 'true');
    await expectNoHorizontalOverflow(page);

    await page.goto('/otc/order');
    const terminal = page.locator('.standalone-trade-detail-section');
    await expect(terminal.getByPlaceholder('Paste offer link, compact code, or id')).toBeVisible();
    await expect(terminal.getByRole('button', { name: 'Open order', exact: true })).toBeVisible();
    await expect(terminal.getByRole('button', { name: 'Open desk', exact: true })).toBeVisible();
    await expect(terminal.getByRole('button', { name: 'Create offer', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('keeps My Trades mobile lifecycle labels short and readable', async ({ page }) => {
    await installMockTradingWallet(page, sampleRecurringMakerAddress);
    await page.goto('/trades/mine');
    await page.locator('.top-header-mobile-wallet .wallet-primary-action').click();

    const switcher = page.locator('.p2p-wallet-trade-switcher');
    const lifecycleTabs = switcher.getByRole('tab');
    await expect(lifecycleTabs).toHaveCount(2, { timeout: 45_000 });
    await expect(lifecycleTabs.nth(0)).toContainText('Active');
    await expect(lifecycleTabs.nth(1)).toContainText('History');
    await expect(page.getByRole('group', { name: 'Active trade filters' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Trade pair scope' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('lets My Trades mobile cards scroll in the main page flow', async ({ page }) => {
    await page.setViewportSize({ width: mobileViewport.width, height: 620 });
    await installMockTradingWallet(page, sampleRecurringMakerAddress);
    await page.goto('/trades/mine');
    await page.locator('.top-header-mobile-wallet .wallet-primary-action').click();

    const switcher = page.locator('.p2p-wallet-trade-switcher');
    await expect(switcher).toBeVisible({ timeout: 45_000 });
    const historyTrades = switcher.getByRole('tab', { name: /History: [1-9]\d*/ });
    await expect(historyTrades).toBeVisible({ timeout: 45_000 });
    await historyTrades.click();
    await expect(page.locator('.p2p-wallet-trade-grid .p2p-order-card').first()).toBeVisible();

    const scrollState = await page.locator('.standalone-trades-shell').evaluate((shell) => {
      const tradeShell = document.querySelector<HTMLElement>('.p2p-trading-shell-mine');
      const workspace = document.querySelector<HTMLElement>('.p2p-wallet-inline-workspace');
      const workspaceStyle = workspace ? window.getComputedStyle(workspace) : null;
      return {
        shellClientHeight: shell.clientHeight,
        shellScrollHeight: shell.scrollHeight,
        shellOverflowY: window.getComputedStyle(shell).overflowY,
        tradeShellHeight: tradeShell?.getBoundingClientRect().height ?? 0,
        workspaceOverflowY: workspaceStyle?.overflowY ?? '',
      };
    });

    expect(scrollState.shellScrollHeight).toBeGreaterThan(scrollState.shellClientHeight + 8);
    expect(scrollState.shellOverflowY).toBe('auto');
    expect(scrollState.tradeShellHeight).toBeLessThanOrEqual(scrollState.shellClientHeight);
    expect(scrollState.workspaceOverflowY).toBe('visible');
    await expectNoHorizontalOverflow(page);
  });

  test('keeps Private TVL verification and safe retry reachable on mobile', async ({ page }) => {
    await page.route('https://mainnet.coti.io/**', route => route.abort());
    await page.goto('/treasury');
    await expect(page.locator('.top-header-brand-subtitle', { hasText: /^Private TVL$/ })).toBeAttached();
    await expect(page.getByRole('navigation', { name: 'ChainWhisper apps' }).getByRole('button', { name: 'Private TVL', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Private TVL is temporarily unavailable', exact: true })).toBeVisible();
    await expect(page.getByText('No estimates shown', { exact: true })).toBeVisible();
    const retry = page.getByRole('button', { name: 'Retry verification', exact: true });
    await retry.scrollIntoViewIfNeeded();
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(retry).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('trading responsive layout', () => {
  for (const route of ['/otcdesk', '/otcdesk/create', '/otcdesk/terminal', '/otcdesk/mytrades']) {
    test(`keeps ${route} free of horizontal overflow on desktop and mobile`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 950 });
      await page.goto(route);
      await expectNoHorizontalOverflow(page);

      await page.setViewportSize(mobileViewport);
      await page.goto(route);
      await expectNoHorizontalOverflow(page);
    });
  }

  test('keeps desktop Trading panels and owner controls inside the shared gutters', async ({ page }) => {
    await page.setViewportSize({ width: 2016, height: 980 });
    for (const route of ['/otcdesk', '/otcdesk/create', '/otcdesk/terminal', '/otcdesk/mytrades']) {
      await page.goto(route);
      await expect(page.locator('.p2p-trading-shell')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open Wallet menu', exact: true })).toBeVisible();
      const bounds = await page.locator('.p2p-trading-shell').evaluate(element => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, width: document.documentElement.clientWidth };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
      await expectNoHorizontalOverflow(page);
    }
  });

  test('keeps centered Create controls, exact price inputs and owner-gated actions reachable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto('/otc/limit');
    const shell = page.locator('.p2p-trading-shell-create');
    const composer = page.getByRole('group', { name: 'P2P trade offer', exact: true });
    await expect(shell).toBeVisible();
    await expect(composer).toBeVisible();
    await expect(page.getByRole('tab', { name: 'One-off', exact: true })).toHaveCount(0);
    const shellBox = await shell.boundingBox();
    const composerBox = await composer.boundingBox();
    expect(composerBox!.width).toBeLessThan(shellBox!.width);
    const panelBox = (await page.locator('.standalone-trade-create-panel').boundingBox())!;
    expect(composerBox!.x).toBeGreaterThanOrEqual(panelBox.x);
    expect(composerBox!.x + composerBox!.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(shellBox!.x + shellBox!.width + 1);
    await composer.locator('.trade-compose-section-sell .trade-compose-amount-field .trade-compose-input').fill('10');
    await composer.locator('.trade-compose-limit-price .trade-compose-price-field .trade-compose-input').fill('1');
    await expect(composer.locator('.trade-compose-readiness')).toContainText(/Connect wallet|Complete required fields|Loading token balance/);
    await expect(composer.getByRole('button', { name: 'Create Offer', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Recurring', exact: true })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Recurring P2P order', exact: true })).toHaveCount(0);
    await expect(page.locator('.trading-ratio-trigger')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('centers create controls while keeping the ultrawide shell full', async ({ page }) => {
    await page.setViewportSize({ width: 2200, height: 950 });
    await page.goto('/otc/limit');
    await expect(page.locator('.p2p-trading-shell-create')).toBeVisible({ timeout: 30_000 });

    const metrics = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('.p2p-trading-shell-create');
      const overview = document.querySelector<HTMLElement>('.p2p-create-overview');
      const panel = document.querySelector<HTMLElement>('.standalone-trade-create-panel');
      const controls = document.querySelector<HTMLElement>('.standalone-trade-create-panel .trade-compose-panel');
      const shellBox = shell?.getBoundingClientRect();
      const overviewBox = overview?.getBoundingClientRect();
      const panelBox = panel?.getBoundingClientRect();
      const controlsBox = controls?.getBoundingClientRect();
      return {
        controlsCenteredDelta:
          shellBox && controlsBox
            ? Math.abs((controlsBox.left - panelBox!.left) - (panelBox!.right - controlsBox.right))
            : 999,
        controlsWidth: controlsBox?.width ?? 0,
        overviewWidth: overviewBox?.width ?? 0,
        panelWidth: panelBox?.width ?? 0,
        shellWidth: shellBox?.width ?? 0
      };
    });

    expect(metrics.overviewWidth).toBeGreaterThanOrEqual(720);
    expect(metrics.overviewWidth).toBeLessThanOrEqual(780);
    expect(metrics.panelWidth).toBeGreaterThanOrEqual(680);
    expect(metrics.panelWidth).toBeLessThanOrEqual(metrics.overviewWidth);
    expect(metrics.controlsWidth).toBeGreaterThanOrEqual(640);
    expect(metrics.controlsWidth).toBeLessThanOrEqual(740);
    expect(metrics.controlsWidth).toBeLessThanOrEqual(metrics.panelWidth);
    expect(metrics.controlsCenteredDelta).toBeLessThanOrEqual(16);
    await expectNoHorizontalOverflow(page);
  });

  test('shows an explicit loading state until local offer reads finish', async ({ page }) => {
    let releaseReads!: () => void;
    const gate = new Promise<void>((resolve) => { releaseReads = resolve; });
    await page.route('https://mainnet.coti.io/**', async (route) => {
      await gate;
      await route.fallback();
    });
    await page.setViewportSize({ width: 2016, height: 980 });
    try {
      await page.goto('/trades', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.p2p-offers-empty.is-loading')).toBeVisible();
      await expect(page.locator('.p2p-offer-rate-row')).toHaveCount(0);
    } finally { releaseReads(); }
    await expect(page.locator('.p2p-offers-empty.is-loading')).toHaveCount(0);
    await expect(page.locator('.p2p-offers-empty')).toContainText(/No .*offers|No .*orders/i);
    await openLegacyPublicOffers(page);
    await expect(page.locator('.p2p-offer-rate-row').first()).toBeVisible();
  });

  test('keeps desktop Offers rows and owner entry inside the current workspace', async ({ page }) => {
    await page.setViewportSize({ width: 2016, height: 980 });
    await openLegacyPublicOffers(page, '/trades');
    const offers = page.getByRole('region', { name: 'P2P offers', exact: true });
    await expect(offers.locator('.p2p-offer-rate-row').first()).toBeVisible();
    await expect(page.locator('.wallet-primary-action')).toBeVisible();
    const box = await offers.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
    await expectNoHorizontalOverflow(page);
  });

  test('keeps empty terminal guidance and close control reachable without an obsolete dock', async ({ page }) => {
    await page.setViewportSize({ width: 2016, height: 980 });
    await page.goto('/otc/order');
    const terminal = page.locator('.standalone-trade-detail-section');
    await expect(terminal).toContainText('Open order');
    await expect(terminal.locator('.p2p-terminal-open-panel')).toBeVisible();
    await expect(page.locator('.wallet-primary-action')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to offers', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('closes the empty order drawer when switching to Orders', async ({ page }) => {
    await page.setViewportSize({ width: 2016, height: 980 });
    await page.goto('/otc/order');

    const marketTabs = page.locator('.p2p-market-tabs').getByRole('button');
    const terminal = page.locator('.standalone-trade-detail-section');
    await expect(terminal).toContainText('Open order');
    await expect(terminal.locator('.p2p-terminal-open-panel')).toBeVisible();
    await expect(terminal.locator('.p2p-terminal-shell')).toHaveCount(0);

    await marketTabs.filter({ hasText: /^My trades$/ }).click();
    await expect(page).toHaveURL(/\/otc\/orders$/);
    await expect(page.locator('.p2p-my-trades-section')).toBeVisible();
    await expect(page.locator('.standalone-trade-detail-section .p2p-terminal-shell')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test('closes an open terminal when clicking the current desk tab', async ({ page }) => {
    await page.setViewportSize({ width: 2016, height: 980 });
    await openLegacyPublicOffers(page, '/otc/desk');

    const cards = page.locator('.p2p-offer-rate-row');
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    await cards.first().click();

    const terminal = page.locator('.standalone-trade-detail-section');
    const marketTabs = page.locator('.p2p-market-tabs').getByRole('button');
    await expect(terminal.locator('.p2p-terminal-shell')).toBeVisible();
    await expect(terminal).toContainText('Trade review');
    await expect(page).toHaveURL(/\/otc\/order\/(link\/|recurring\/)/);

    await marketTabs.filter({ hasText: /^Offers$/ }).click();
    await expect(page).toHaveURL(/\/otc$/);
    await expect(page.locator('.p2p-offers-workspace')).toBeVisible();
    await expect(page.locator('.standalone-trade-detail-section .p2p-terminal-shell')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test('closes any open order when switching between Desk and Orders', async ({ page }) => {
    await page.setViewportSize({ width: 2016, height: 980 });
    await openLegacyPublicOffers(page, '/otc/desk');

    const cards = page.locator('.p2p-offer-rate-row');
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    await cards.first().click();

    const terminal = page.locator('.standalone-trade-detail-section');
    const marketTabs = page.locator('.p2p-market-tabs').getByRole('button');
    await expect(terminal.locator('.p2p-terminal-shell')).toBeVisible();
    await expect(terminal).toContainText('Trade review');
    await expect(page).toHaveURL(/\/otc\/order\/(link\/|recurring\/)/);

    await marketTabs.filter({ hasText: /^My trades$/ }).click();
    await expect(page).toHaveURL(/\/otc\/orders$/);
    await expect(page.locator('.p2p-my-trades-section')).toBeVisible();
    await expect(terminal.locator('.p2p-terminal-shell')).toHaveCount(0);

    await marketTabs.filter({ hasText: /^Offers$/ }).click();
    await expect(page).toHaveURL(/\/otc$/);
    await expect(page.locator('.p2p-offers-workspace')).toBeVisible();
    await expect(page.locator('.standalone-trade-detail-section .p2p-terminal-shell')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test('keeps trading view tabs color-consistent across routes', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });

    const routes = ['/otc', '/otc/desk', '/otc/agent', '/otc/orders'];
    const routeStyles: Array<{
      active: Record<string, string | boolean>;
      bounds: { height: number; left: number; top: number };
      inactive: Record<string, string | boolean>;
    }> = [];

    for (const route of routes) {
      await page.goto(route);
      const tabs = page.getByRole('navigation', { name: 'P2P trading views' });
      await expect(tabs).toBeVisible();
      const tabBounds = await tabs.boundingBox();
      expect(tabBounds).not.toBeNull();
      const styles = await tabs.locator('button').evaluateAll((buttons) =>
        buttons.map((button) => {
          const style = window.getComputedStyle(button);
          return {
            active: button.classList.contains('active'),
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            borderColor: style.borderTopColor,
            borderRadius: style.borderRadius,
            boxShadow: style.boxShadow,
            color: style.color,
            fontSize: style.fontSize,
            height: `${Math.round(button.getBoundingClientRect().height)}px`,
            padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`
          };
        })
      );
      expect(styles).toHaveLength(4);
      const activeStyles = styles.filter((style) => style.active);
      const inactiveStyles = styles.filter((style) => !style.active);
      expect(activeStyles).toHaveLength(1);
      expect(new Set(inactiveStyles.map((style) => JSON.stringify(style))).size).toBe(1);
      expect(activeStyles[0].color).not.toEqual(inactiveStyles[0].color);
      expect(activeStyles[0].boxShadow).not.toEqual(inactiveStyles[0].boxShadow);
      await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
      routeStyles.push({
        active: activeStyles[0],
        bounds: {
          height: Math.round(tabBounds!.height),
          left: Math.round(tabBounds!.x),
          top: Math.round(tabBounds!.y)
        },
        inactive: inactiveStyles[0]
      });
    }

    const [referenceStyles, ...comparisonStyles] = routeStyles;
    for (const styles of comparisonStyles) {
      expect(styles.active).toEqual(referenceStyles.active);
      expect(styles.inactive).toEqual(referenceStyles.inactive);
      expect(Math.abs(styles.bounds.left - referenceStyles.bounds.left)).toBeLessThanOrEqual(4);
      expect(Math.abs(styles.bounds.top - referenceStyles.bounds.top)).toBeLessThanOrEqual(4);
      expect(styles.bounds.height).toEqual(referenceStyles.bounds.height);
    }
  });

  test('keeps selected-offer navigation and restored filter access stable', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await openLegacyPublicOffers(page, '/otc/desk');
    const navigation = page.getByRole('navigation', { name: 'P2P trading views' });
    const before = await navigation.boundingBox();
    await page.locator('.p2p-offer-rate-row').first().click();
    await expect(page.locator('.standalone-trade-detail-section')).toContainText('Trade review');
    const after = await navigation.boundingBox();
    expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(4);
    await navigation.getByRole('button', { name: 'Offers', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Type', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('keeps current Offers rows readable, actionable and private inventory undisclosed', async ({ page }) => {
    for (const viewport of [{ width: 2016, height: 980 }, mobileViewport]) {
      await page.setViewportSize(viewport);
      await openLegacyPublicOffers(page, '/trades');
      const offers = page.getByRole('region', { name: 'P2P offers', exact: true });
      const rows = offers.locator('.p2p-offer-rate-row');
      await expect(rows.first()).toBeVisible();
      expect(await rows.count()).toBeGreaterThanOrEqual(2);
      expect(await rows.count()).toBeLessThanOrEqual(8);
      for (const row of await rows.all()) {
        await expect(row.locator('.p2p-offer-rate-price strong')).toBeVisible();
        await expect(row.locator('.p2p-offer-rate-payment strong')).toBeVisible();
        await expect(row.locator('.p2p-offer-rate-availability strong')).toBeVisible();
        await expect(row.locator('.p2p-offer-rate-action')).toContainText('Trade');
        await expect(row).toHaveAccessibleName(/Trade/);
        expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await expect(offers).not.toContainText('Offer #4');
      await expect(offers.getByRole('button', { name: /Reveal history|Counter/ })).toHaveCount(0);
      await expect(offers.locator('.p2p-maker-inline-actions')).toHaveCount(0);
      await expect(offers.locator('.p2p-offers-market-row')).toContainText('Reference only');
      await expectNoHorizontalOverflow(page);
    }
  });

  test('renders current terminal with coupled amounts and separate safe Activity', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await openLegacyPublicOffers(page, '/trades');
    await page.locator('.p2p-offer-rate-row').filter({ hasText: /One-off/ }).first().click();
    const terminal = page.locator('.p2p-terminal-shell-standard');
    await expect(terminal).toBeVisible();
    await expect(terminal.locator('.p2p-terminal-main')).toBeVisible();
    await expect(terminal.locator('.p2p-terminal-history-desktop')).toHaveCount(0);

    const sell = terminal.getByRole('textbox', { name: /^You pay COTI\b/ });
    const buy = terminal.getByRole('textbox', { name: /^You receive WISP\b/ });
    await expect(sell).toBeVisible();
    await expect(buy).toBeVisible();
    await sell.fill('1');
    await expect(buy).not.toHaveValue('');
    await buy.fill('1');
    await expect(sell).not.toHaveValue('');
    await expect(terminal.locator('.p2p-terminal-primary-action')).toBeVisible();
    await expect(page.locator('.wallet-primary-action')).toBeVisible();
    const terminalBox = await terminal.boundingBox();
    expect(terminalBox).not.toBeNull();
    expect(terminalBox!.x).toBeGreaterThanOrEqual(0);
    expect(terminalBox!.x + terminalBox!.width).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
    expect(await terminal.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const history = await openTradeActivity(page);
    for (const element of [history]) {
      const box = await element.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
      expect(await element.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    }
    await expectNoHorizontalOverflow(page);
  });

  test('respects reduced motion for trading polish effects', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openLegacyPublicOffers(page, '/trades');

    const firstCard = page.locator('.p2p-offer-rate-row').first();
    await expect(firstCard).toBeVisible({ timeout: 30_000 });
    const motionStyle = await firstCard.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        transform: style.transform,
        transitionDuration: style.transitionDuration
      };
    });
    expect(motionStyle.transform).toBe('none');
    expect(motionStyle.transitionDuration.split(',').every((duration) => duration.trim() === '0s')).toBe(true);
  });

  test('keeps private order Activity free of disclosed private amounts', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto('/otc/order/recurring/4');
    await expect(page.locator('.p2p-terminal-shell-recurring')).toBeVisible();
    const history = await openTradeActivity(page);
    await expect(history).toContainText('Recurring P2P #4');
    await expect(history.locator('.p2p-terminal-history-row-lifecycle')).toHaveCount(1);
    await expect(history.locator('.p2p-terminal-history-row')).not.toContainText(/5 WISP|10 pCOTI|5,000,000|10000000000000000000/);
    await expectNoHorizontalOverflow(page);
    await returnToTradeOverview(page);
  });

  test('keeps trading filters compact and recurring terminal liquidity status scannable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto('/trades');

    const overviewBox = await page.locator('.p2p-offers-filter-controls').boundingBox();
    expect(overviewBox).not.toBeNull();
    expect(overviewBox!.height).toBeLessThanOrEqual(112);

    const scrollStyle = await page.locator('.p2p-offers-workspace').evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        scrollbarColor: style.scrollbarColor,
        scrollbarWidth: style.scrollbarWidth,
      };
    });
    expect(scrollStyle.scrollbarWidth).toBe('thin');
    expect(scrollStyle.scrollbarColor).toContain('139');

    await page.goto('/trades/mine');
    const mineOverviewBox = await page.locator('.p2p-my-trades-section .standalone-trades-section-head').boundingBox();
    expect(mineOverviewBox).not.toBeNull();
    expect(mineOverviewBox!.height).toBeLessThanOrEqual(120);
    const mineTypeFilter = page.locator('.p2p-filter-type select');
    if (await mineTypeFilter.count()) {
      await expect(mineTypeFilter).toContainText('Private liquidity');
      await expect(mineTypeFilter).toContainText('Unlisted');
      await expect(mineTypeFilter).toContainText('Direct links');
      await expect(mineTypeFilter).toContainText('Counters');
      await mineTypeFilter.selectOption('private-link');
      await expect(mineTypeFilter).toHaveValue('private-link');

      await page.goto('/trades');
      const deskTypeFilter = page.locator('.p2p-offers-filter-type select');
      await expect(deskTypeFilter).toHaveValue('all');
      await deskTypeFilter.selectOption('private');
      await expect(deskTypeFilter).toHaveValue('private');

      await page.goto('/trades/mine');
      await expect(page.locator('.p2p-filter-type select')).toHaveValue('all');
    }

    await page.goto('/trades/recurring?order=1');
    const terminal = page.locator('.p2p-terminal-shell-recurring');
    await expect(terminal).toBeVisible({ timeout: 30_000 });
    const recurringHeaderTags = terminal.locator('.p2p-terminal-head .p2p-terminal-tag-row');
    await expect(recurringHeaderTags).toContainText(/Recurring P2P #\d+/);
    await expect(recurringHeaderTags.locator('.p2p-offer-status')).toBeVisible();
    await expect(recurringHeaderTags).toContainText(/liquidity/i);
    await expect(terminal.locator('.p2p-terminal-market > .p2p-terminal-tag-row')).toHaveCount(0);
    const recurringPriceDesk = terminal.locator('.p2p-terminal-price-desk');
    await expect(recurringPriceDesk.locator('.p2p-recurring-price-card-head')).toContainText('Price ratio');
    await expect(recurringPriceDesk.locator('.p2p-recurring-price-buy')).toContainText(/^Buy /i);
    await expect(recurringPriceDesk.locator('.p2p-recurring-price-sell')).toContainText(/^Sell /i);
    await expect(recurringPriceDesk.locator('.p2p-recurring-price-buy')).toHaveClass(/is-active/);
    await expect(terminal.locator('.p2p-recurring-fill-price-note')).toContainText(/You buy .* at/i);
    await expect(recurringPriceDesk.locator('.p2p-recurring-price-basis')).toHaveCount(0);
    await terminal.locator('.p2p-terminal-tabs').getByRole('tab', { name: 'Sell' }).click();
    await expect(recurringPriceDesk.locator('.p2p-recurring-price-sell')).toHaveClass(/is-active/);
    await expect(terminal.locator('.p2p-recurring-fill-price-note')).toContainText(/You sell .* at/i);
    await expect(terminal.locator('.p2p-terminal-liquidity-head .p2p-recurring-liquidity-dot')).toHaveCount(2);
    await expect(terminal.locator('.p2p-terminal-liquidity-grid')).not.toContainText(/Live|Order history/);
    await expect(terminal.getByText('Both sides live')).toHaveCount(0);
    await expect(terminal.locator('.p2p-terminal-ticket').getByText('You receive')).toHaveCount(0);
    await expect(terminal.locator('.p2p-terminal-ticket').getByText('Live capacity')).toHaveCount(0);
    const recurringHistory = await openTradeActivity(page);
    const recurringHistoryRows = recurringHistory.locator('.p2p-terminal-history-row');
    const recurringHistoryCount = parseInt(
      (await recurringHistory.locator('.p2p-terminal-history-head > span').last().textContent()) ?? '0'
    );
    expect(recurringHistoryCount).toBeGreaterThanOrEqual(1);
    await expect(recurringHistoryRows).toHaveCount(recurringHistoryCount);
    await expect(recurringHistory).toContainText(/Recurring P2P #\d+ opened/);
    const createdLifecycleRow = recurringHistory.locator('.p2p-terminal-history-row-lifecycle').first();
    await expect(createdLifecycleRow.locator('.p2p-terminal-history-event small')).toBeVisible();
    await expect(createdLifecycleRow.locator('.p2p-terminal-history-chip-lifecycle')).toContainText(/Order|Offer/);
    await expect(createdLifecycleRow.locator('.p2p-terminal-history-date')).toHaveCount(0);
    await expect(recurringHistory).not.toContainText(/Execution #\d+/);
    const terminalManage = terminal.getByRole('button', { name: /Manage order|Manage offer/ });
    if (await terminalManage.count()) {
      await terminalManage.first().click();
      await expect(page.locator('.p2p-public-trade-grid .p2p-maker-inline-actions')).toHaveCount(0);
    }
    await expect(terminal.getByRole('button', { name: /Reveal history|Refresh history/ })).toHaveCount(0);
  });

  test('renders My Trades with desk cards and opens the desk-style terminal drawer', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await installMockTradingWallet(page, sampleRecurringMakerAddress);
    await page.goto('/trades/mine');
    await page.locator('.top-header .wallet-primary-action').click();

    const tabs = page.getByRole('tab');
    await expect(tabs.first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('tab', { name: /History: [1-9]\d*/ })).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('.p2p-history-ledger-card')).toHaveCount(0);

    let openedTerminalDrawer = false;
    for (let index = 0; index < await tabs.count(); index += 1) {
      await tabs.nth(index).click();
      const cards = page.locator('.p2p-wallet-trade-grid .p2p-order-card');
      if ((await cards.count()) === 0) {
        continue;
      }

      await expect(cards.first()).toBeVisible();
      const historyDateRows = cards.locator('.p2p-order-date-row');
      if ((await historyDateRows.count()) > 0) {
        await expect(historyDateRows.first().locator('.p2p-expiry-chip')).toBeVisible();
        const dateRowOrder = await cards
          .filter({ has: page.locator('.p2p-order-date-row') })
          .first()
          .evaluate((card) => {
            const meta = card.querySelector<HTMLElement>('.p2p-order-meta-line')?.getBoundingClientRect();
            const date = card.querySelector<HTMLElement>('.p2p-order-date-row')?.getBoundingClientRect();
            return meta && date ? Math.round(date.top) - Math.round(meta.top) : 0;
          });
        expect(dateRowOrder).toBeGreaterThan(0);
        const counterDateRows = cards.locator('.p2p-order-date-row', { hasText: /Counter/ });
        if ((await counterDateRows.count()) > 0) {
          const counterDateRow = counterDateRows.first();
          await expect(counterDateRow.locator('.p2p-expiry-chip')).toBeVisible();
          await expect(counterDateRow.locator('.p2p-order-chip', { hasText: /Counter/ })).toBeVisible();
          const counterLayout = await counterDateRow.evaluate((row) => {
            const date = row.querySelector<HTMLElement>('.p2p-expiry-chip')?.getBoundingClientRect();
            const counter = row.querySelector<HTMLElement>('.p2p-order-chip')?.getBoundingClientRect();
            return date && counter ? Math.abs(Math.round(date.top) - Math.round(counter.top)) : 99;
          });
          expect(counterLayout).toBeLessThanOrEqual(2);
        }
      }
      if ((await cards.count()) > 1) {
        const firstRowAlignment = await cards.evaluateAll((cardElements) => {
          const metrics = cardElements.map((card) => {
            const cardBox = card.getBoundingClientRect();
            const cardStyle = window.getComputedStyle(card);
            const headBox = card.querySelector<HTMLElement>('.p2p-order-card-head')?.getBoundingClientRect();
            const priceBox = card.querySelector<HTMLElement>('.p2p-order-market-panel')?.getBoundingClientRect();
            const footerBox = card.querySelector<HTMLElement>('.p2p-order-card-footer')?.getBoundingClientRect();
            return {
              type: card.querySelector('.p2p-order-type-label, .p2p-offer-kind')?.textContent ?? card.textContent?.slice(0, 160),
              gridTemplateRows: cardStyle.gridTemplateRows,
              alignContent: cardStyle.alignContent,
              gap: cardStyle.gap,
              head: headBox ? { top: headBox.top, height: headBox.height } : null,
              children: Array.from(card.children).map(child => {
                const box = child.getBoundingClientRect();
                const style = window.getComputedStyle(child);
                return { class: child.className, top: box.top, height: box.height, marginTop: style.marginTop, marginBottom: style.marginBottom };
              }),
              cardTop: Math.round(cardBox.top),
              footerTop: footerBox ? Math.round(footerBox.top) : null,
              priceTop: priceBox ? Math.round(priceBox.top) : null
            };
          });
          const firstTop = Math.min(...metrics.map((metric) => metric.cardTop));
          const firstRow = metrics.filter((metric) => Math.abs(metric.cardTop - firstTop) <= 3);
          const priceTops = firstRow.flatMap((metric) => (metric.priceTop === null ? [] : [metric.priceTop]));
          const footerTops = firstRow.flatMap((metric) => (metric.footerTop === null ? [] : [metric.footerTop]));
          return {
            cards: firstRow.length,
            footerSpread: footerTops.length ? Math.max(...footerTops) - Math.min(...footerTops) : 0,
            priceSpread: priceTops.length ? Math.max(...priceTops) - Math.min(...priceTops) : 0,
            metrics: firstRow
          };
        });
        if (firstRowAlignment.cards > 1) {
          console.info(`My Trades first-row geometry: ${JSON.stringify(firstRowAlignment)}`);
          await page.screenshot({ path: test.info().outputPath('my-trades-row-geometry.png'), fullPage: true });
          await test.info().attach('my-trades-row-geometry', {
            body: JSON.stringify(firstRowAlignment, null, 2), contentType: 'application/json'
          });
          expect(firstRowAlignment.priceSpread).toBeLessThanOrEqual(2);
          expect(firstRowAlignment.footerSpread).toBeLessThanOrEqual(2);
        }
      }
      const openControl = cards.first().locator('.p2p-offer-open-btn, .p2p-offer-manage-btn').first();
      if ((await openControl.count()) === 0) {
        continue;
      }

      await openControl.click();
      openedTerminalDrawer = true;
      await expect(page).toHaveURL(/\/otc\/orders/);
      await expect(cards.first()).toHaveClass(/p2p-order-card-selected/);
      await expect(page.locator('.p2p-trading-shell-drawer-open')).toBeVisible();
      await expect(page.locator('.standalone-trade-detail-section .p2p-terminal-shell')).toBeVisible();
      const activity = await openTradeActivity(page);
      await expect(activity.locator('.p2p-terminal-history-row')).not.toHaveCount(0);
      await returnToTradeOverview(page);
      await expect(page.locator('.p2p-my-trades-section')).toBeVisible();
      const myTradesScroll = await page.evaluate(() => {
        const section = document.querySelector<HTMLElement>('.p2p-my-trades-section');
        const groups = document.querySelector<HTMLElement>('.p2p-wallet-trade-groups');
        const workspace = document.querySelector<HTMLElement>('.p2p-wallet-inline-workspace');
        const terminal = document.querySelector<HTMLElement>('.standalone-trade-detail-section');
        if (!section || !groups || !workspace || !terminal) {
          return null;
        }
        const before = section.scrollTop;
        section.scrollTop = 80;
        const after = section.scrollTop;
        const sectionBox = section.getBoundingClientRect();
        const terminalBox = terminal.getBoundingClientRect();
        return {
          canScroll: section.scrollHeight > section.clientHeight,
          groupsOverflowY: window.getComputedStyle(groups).overflowY,
          groupsOverflow: groups.scrollHeight - groups.clientHeight,
          scrolled: after > before,
          // CSS110 uses clamp(28px, 2vw, 52px) for the shared content gutter.
          contentGutter: Math.max(28, Math.min(window.innerWidth * 0.02, 52)),
          sectionRight: sectionBox.right,
          sectionWidth: sectionBox.width,
          sectionOverflowY: window.getComputedStyle(section).overflowY,
          terminalLeft: terminalBox.left,
          terminalWidth: terminalBox.width,
          workspaceOverflowY: window.getComputedStyle(workspace).overflowY,
          workspaceOverflow: workspace.scrollHeight - workspace.clientHeight
        };
      });
      expect(myTradesScroll).not.toBeNull();
      expect(['auto', 'scroll']).toContain(myTradesScroll!.sectionOverflowY);
      // The accepted horizontal clipping rule makes CSS compute overflow-y as
      // auto. Check actual nested overflow rather than treating that as scroll.
      expect(myTradesScroll!.groupsOverflowY).toBe('auto');
      expect(myTradesScroll!.workspaceOverflowY).toBe('auto');
      expect(myTradesScroll!.groupsOverflow).toBeLessThanOrEqual(1);
      expect(myTradesScroll!.workspaceOverflow).toBeLessThanOrEqual(1);
      expect(myTradesScroll!.terminalLeft).toBeGreaterThanOrEqual(myTradesScroll!.sectionRight);
      expect(myTradesScroll!.sectionWidth).toBeGreaterThanOrEqual(320);
      expect(myTradesScroll!.terminalWidth).toBeGreaterThanOrEqual(560);
      expect(Math.abs((myTradesScroll!.terminalLeft - myTradesScroll!.sectionRight) - myTradesScroll!.contentGutter)).toBeLessThanOrEqual(2);
      if (myTradesScroll!.canScroll) {
        expect(myTradesScroll!.scrolled).toBe(true);
      }

      const terminalManage = page.locator('.standalone-trade-detail-section .p2p-terminal-manage-toggle').first();
      if ((await terminalManage.count()) > 0) {
        await terminalManage.click();
        await expect(page.locator('.p2p-wallet-trade-grid .p2p-maker-inline-actions')).toHaveCount(0);
      }
      break;
    }

    expect(openedTerminalDrawer).toBe(true);
    await expectNoHorizontalOverflow(page);
  });

  test('opens My Trades terminal and mobile Activity from desk cards', async ({ page }) => {
    await page.setViewportSize(mobileViewport);
    await installMockTradingWallet(page, sampleRecurringMakerAddress);
    await page.goto('/trades/mine');
    await page.locator('.top-header-mobile-wallet .wallet-primary-action').click();

    const tabs = page.getByRole('tab');
    await expect(tabs.first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('tab', { name: /History: [1-9]\d*/ })).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('.p2p-history-ledger-card')).toHaveCount(0);

    let openedTerminalDrawer = false;
    for (let index = 0; index < await tabs.count(); index += 1) {
      await tabs.nth(index).click();
      const cards = page.locator('.p2p-wallet-trade-grid .p2p-order-card');
      if ((await cards.count()) === 0) {
        continue;
      }

      const openControl = cards.first().locator('.p2p-offer-open-btn, .p2p-offer-manage-btn').first();
      if ((await openControl.count()) === 0) {
        continue;
      }

      await openControl.click();
      openedTerminalDrawer = true;
      break;
    }

    expect(openedTerminalDrawer).toBe(true);
    await expect(page.locator('.p2p-trading-shell-drawer-open')).toBeVisible();
    await expect(page.locator('.standalone-trade-detail-section .p2p-terminal-shell')).toBeVisible();
    await expect(page.locator('.p2p-my-trades-section')).toBeHidden();
    const activity = await openTradeActivity(page);
    await expect(activity.locator('.p2p-terminal-history-row')).not.toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await returnToTradeOverview(page);
  });
});





