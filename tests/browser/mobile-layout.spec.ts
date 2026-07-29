import { expect, test, type Page } from '@playwright/test';

const mobileViewport = { width: 390, height: 844 };
const mockTradingWalletAddress = '0x1234567890abcdef1234567890abcdef12345678';
const sampleRecurringMakerAddress = '0xbf01185A70CDfEF1858659836D57BFf085ebed55';
const cotiChainIdHex = '0x282b34';

const expectNoHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(4);
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

const expectAboveTradeTabs = async (page: Page, selector: string) => {
  const targetBox = await page.locator(selector).boundingBox();
  const tabsBox = await page.getByRole('navigation', { name: 'OTC Desk views' }).boundingBox();
  expect(targetBox).not.toBeNull();
  expect(tabsBox).not.toBeNull();
  expect(targetBox!.y + targetBox!.height).toBeLessThanOrEqual(tabsBox!.y - 4);
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
    await expect(page.getByText('ChainWhisper account', { exact: true })).toBeVisible();
    await expect(page.getByText('Owner wallet', { exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /^Create account$/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('uses the same mobile header geometry for Chat and OTC Desk', async ({ page }) => {
    const readHeaderGeometry = () =>
      page.evaluate(() => {
        const getRect = (selector: string) => {
          const rect = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
          return rect
            ? {
                height: rect.height,
                left: rect.left,
                right: rect.right,
                width: rect.width
              }
            : null;
        };

        return {
          appNav: getRect('.top-header-mobile-app-nav'),
          brand: getRect('.top-header-brand'),
          cluster: getRect('.top-header-mobile-utility-cluster'),
          firstAppButton: getRect('.top-header-mobile-app-nav .app-header-nav button'),
          header: getRect('.top-header-bar'),
          helpIcon: getRect('.top-header-actions > .top-header-help-btn svg'),
          homeIcon: getRect('.top-header-mobile-home svg'),
          logo: getRect('.top-header-brand-logo'),
          primaryAction: getRect('.top-header-mobile-wallet-inline .wallet-primary-action'),
          walletIcon: getRect('.top-header-mobile-wallet-inline .p2p-wallet-menu-icon'),
          walletMenuTrigger: getRect('.top-header-mobile-wallet-inline .p2p-wallet-menu-trigger'),
          soundIcon: getRect('.top-header-mobile-utility-cluster .sound-toggle-btn svg'),
          wallet: getRect('.top-header-mobile-wallet-inline')
        };
      });

    await page.goto('/chat');
    const chatHeader = await readHeaderGeometry();
    await page.getByRole('navigation', { name: 'ChainWhisper apps' }).getByRole('button', { name: 'OTC Desk' }).click();
    await expect(page).toHaveURL(/\/otc$/);
    const otcHeader = await readHeaderGeometry();

    for (const geometry of [chatHeader, otcHeader]) {
      expect(geometry.brand).not.toBeNull();
      expect(geometry.cluster).not.toBeNull();
      expect(geometry.header).not.toBeNull();
      expect(geometry.logo).not.toBeNull();
      expect(geometry.homeIcon).not.toBeNull();
      expect(geometry.soundIcon).not.toBeNull();
      expect(geometry.helpIcon).not.toBeNull();
      expect(geometry.appNav).not.toBeNull();
      expect(geometry.firstAppButton).not.toBeNull();
      expect(geometry.wallet).not.toBeNull();
      expect(geometry.primaryAction).not.toBeNull();
      expect(geometry.walletIcon).not.toBeNull();
      expect(geometry.walletMenuTrigger).not.toBeNull();
      expect(geometry.cluster!.left).toBeCloseTo(geometry.brand!.right, 1);
      expect(geometry.wallet!.left - geometry.cluster!.right).toBeGreaterThanOrEqual(40);
      expect(geometry.wallet!.right).toBeLessThanOrEqual(geometry.header!.right);
      expect(geometry.primaryAction!.width).toBeGreaterThanOrEqual(92);
      expect(geometry.walletMenuTrigger!.width).toBeCloseTo(44, 1);
      expect(geometry.walletMenuTrigger!.height).toBeGreaterThanOrEqual(44);
      expect(geometry.walletIcon!.width).toBeCloseTo(19, 1);
      expect(geometry.primaryAction!.width).toBeGreaterThan(geometry.walletMenuTrigger!.width);
      expect(geometry.helpIcon!.left).toBeGreaterThan(geometry.wallet!.right);
    }

    expect(otcHeader.brand!.width).toBeCloseTo(chatHeader.brand!.width, 1);
    expect(otcHeader.cluster!.left).toBeCloseTo(chatHeader.cluster!.left, 1);
    expect(otcHeader.cluster!.width).toBeCloseTo(chatHeader.cluster!.width, 1);
    expect(otcHeader.logo!.width).toBeCloseTo(chatHeader.logo!.width, 1);
    expect(otcHeader.homeIcon!.width).toBeCloseTo(chatHeader.homeIcon!.width, 1);
    expect(otcHeader.soundIcon!.width).toBeCloseTo(chatHeader.soundIcon!.width, 1);
    expect(otcHeader.helpIcon!.width).toBeCloseTo(chatHeader.helpIcon!.width, 1);
    expect(otcHeader.appNav!.width).toBeCloseTo(chatHeader.appNav!.width, 1);
    expect(otcHeader.firstAppButton!.height).toBeCloseTo(chatHeader.firstAppButton!.height, 1);
    expect(otcHeader.wallet!.left).toBeCloseTo(chatHeader.wallet!.left, 1);
    expect(otcHeader.wallet!.width).toBeCloseTo(chatHeader.wallet!.width, 1);
    expect(otcHeader.primaryAction!.width).toBeCloseTo(chatHeader.primaryAction!.width, 1);
    expect(otcHeader.walletMenuTrigger!.width).toBeCloseTo(chatHeader.walletMenuTrigger!.width, 1);
    expect(otcHeader.walletIcon!.width).toBeCloseTo(chatHeader.walletIcon!.width, 1);
    await expectNoHorizontalOverflow(page);
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
    await expect(page.getByRole('menuitem', { name: /^Create account$/ })).toBeVisible();
    await page.locator('.top-header-mobile-wallet').getByRole('button', { name: /^Close Wallet menu$/ }).click();
    const soundToggle = page.locator('.top-header-bar .sound-toggle-btn');
    await expect(soundToggle).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open apps menu' })).toHaveCount(0);
    const soundLabelBefore = await soundToggle.getAttribute('aria-label');
    await soundToggle.click();
    await expect(soundToggle).not.toHaveAttribute('aria-label', soundLabelBefore ?? '');
    await expect(page.locator('.top-header-mobile-links.open')).toHaveCount(0);

    const tradeTabs = page.getByRole('navigation', { name: 'OTC Desk views' });
    await expect(tradeTabs).toBeVisible();
    await expect(tradeTabs.getByRole('button', { name: 'Trade' })).toBeVisible();
    await expect(tradeTabs.getByRole('button', { name: 'Desk' })).toBeVisible();
    await expect(tradeTabs.getByRole('button', { name: 'Agent' })).toBeVisible();
    await expect(tradeTabs.getByRole('button', { name: 'Orders', exact: true })).toBeVisible();

    const filterBar = page.locator('.p2p-filter-bar');
    const mobileFiltersButton = filterBar.locator('.p2p-mobile-filter-toggle');
    const advancedFilters = filterBar.locator('.p2p-advanced-filter-panel');
    await expect(filterBar.getByPlaceholder(/Search offers by pair/i)).toBeVisible();
    await expect(mobileFiltersButton).toBeVisible();
    await expect(advancedFilters).toBeHidden();
    await mobileFiltersButton.click();
    await expect(advancedFilters).toBeVisible();
    await expect(filterBar.getByLabel('Pair')).toBeVisible();
    await filterBar.getByLabel('Type').selectOption('private');
    await expect(filterBar.getByLabel('Type')).toHaveValue('private');
    await expect(mobileFiltersButton).toContainText('1');
    await mobileFiltersButton.click();
    await expect(advancedFilters).toBeHidden();
    await expect(mobileFiltersButton).toContainText('1');
    await expectNoHorizontalOverflow(page);
  });

  test('keeps the connected trading wallet hierarchy readable at tablet width', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await installMockTradingWallet(page);
    await page.goto('/trades');

    const header = page.locator('.top-header');
    const wallet = header.locator('.top-header-mobile-wallet-inline');
    await wallet.locator('.wallet-primary-action').click();

    await expect(wallet.locator('.p2p-wallet-status-text')).toBeVisible();
    await expect(wallet.locator('.wallet-primary-action')).toHaveText('Unlock privacy');
    await expect(wallet.getByRole('button', { name: 'Copy owner wallet address' })).toBeVisible();
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
    expect(layout.statusWidth).toBeGreaterThanOrEqual(80);
    await expectNoHorizontalOverflow(page);
  });

  test('uses COTI Snap before any fallback during connected privacy preparation', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await installMockTradingWallet(page, mockTradingWalletAddress, {
      snapAesKey: 'snap-owner-aes'
    });
    await page.goto('/trades');

    const wallet = page.locator('.top-header-mobile-wallet-inline');
    await wallet.locator('.wallet-primary-action').click();

    await expect(wallet.locator('.p2p-wallet-status-indicator')).toContainText('Privacy ready');
    const requestedMethods = await page.evaluate(
      () =>
        (window as Window & { __chainWhisperMockWalletMethods?: string[] })
          .__chainWhisperMockWalletMethods ?? []
    );

    expect(requestedMethods).toContain('wallet_invokeSnap:connect-to-wallet');
    expect(requestedMethods).toContain('wallet_invokeSnap:has-aes-key');
    expect(requestedMethods).toContain('wallet_invokeSnap:get-aes-key');
    expect(requestedMethods).not.toContain('personal_sign');
    expect(requestedMethods).not.toContain('eth_sendTransaction');
  });

  test('opens mobile trading balances and keeps contracts reachable', async ({ page }) => {
    await page.goto('/otc/desk');

    const footerLinks = page.locator('.p2p-footer-links');
    await expect(footerLinks).toBeHidden();
    await expect(footerLinks.locator('.p2p-balance-dock')).toBeHidden();

    await expect(page.locator('.p2p-mobile-contracts-btn')).toHaveCount(0);

    const balancesButton = page.getByRole('button', { name: 'Balances' });
    await expect(balancesButton).toBeVisible();
    await expect(balancesButton.locator('strong')).toHaveCount(0);
    await balancesButton.click();

    const balancesDialog = page.getByRole('dialog', { name: 'Balances' });
    await expect(balancesDialog).toBeVisible();
    await expect(balancesDialog).toContainText('Connect a wallet');
    const contractsAction = balancesDialog.getByRole('button', { name: 'Contracts' });
    await expect(contractsAction).toBeVisible();
    await contractsAction.click();
    await expect(page.getByRole('dialog', { name: 'Trading contracts' })).toBeVisible();
    await expect(page.locator('.p2p-footer-balances')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test('restores mobile desk scroll after visiting the terminal tab', async ({ page }) => {
    await page.setViewportSize({ width: mobileViewport.width, height: 480 });
    await page.goto('/otc/desk');
    const shell = page.locator('.standalone-trades-shell');
    await expect(shell).toBeVisible();
    const firstOrder = page.locator('.p2p-public-trade-grid .p2p-offer-open-btn').first();
    await expect(firstOrder).toBeVisible({ timeout: 30_000 });
    const savedTop = await shell.evaluate((node) => {
      const targetTop = Math.min(260, Math.max(0, node.scrollHeight - node.clientHeight));
      node.scrollTop = targetTop;
      return node.scrollTop;
    });
    expect(savedTop).toBeGreaterThanOrEqual(24);

    const tradeTabs = page.getByRole('navigation', { name: 'OTC Desk views' });
    await firstOrder.click();
    await expect(page.locator('.standalone-trade-detail-section')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('.p2p-public-trades-section')).toBeVisible();
    await page.waitForFunction(
      (expectedTop) => {
        const node = document.querySelector<HTMLElement>('.standalone-trades-shell');
        return Boolean(node && Math.abs(node.scrollTop - expectedTop) <= 4);
      },
      savedTop
    );

    await firstOrder.click();
    await expect(page.locator('.standalone-trade-detail-section')).toBeVisible();
    await tradeTabs.getByRole('button', { name: 'Desk' }).click();
    await expect(page.locator('.p2p-public-trades-section')).toBeVisible();
    await page.waitForFunction(
      (expectedTop) => {
        const node = document.querySelector<HTMLElement>('.standalone-trades-shell');
        return Boolean(node && Math.abs(node.scrollTop - expectedTop) <= 4);
      },
      savedTop
    );

    await tradeTabs.getByRole('button', { name: 'Desk' }).click();
    await page.waitForFunction(() => {
      const node = document.querySelector<HTMLElement>('.standalone-trades-shell');
      return Boolean(node && node.scrollTop <= 4);
    });
  });

  test('keeps recurring mobile price boxes inline when card width allows', async ({ page }) => {
    await page.goto('/trades');

    const recurringCard = page.locator('.p2p-recurring-order-card').first();
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
    expect(priceLayout.columns.split(' ')).toHaveLength(2);
    expect(priceLayout.priceBoxes).toHaveLength(2);
    expect(priceLayout.priceBoxes[0].top).toBe(priceLayout.priceBoxes[1].top);
  });

  test('shows the desktop trading balance dock without placeholder chips', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto('/trades');

    const balanceDock = page.locator('.p2p-balance-dock');
    await expect(balanceDock).toBeVisible();
    await expect(balanceDock).toContainText('Balances');
    await expect(balanceDock).toContainText('Connect a wallet');
    await expect(page.locator('.p2p-footer-balances')).toHaveCount(0);
    await expect(page.getByText('-- COTI')).toHaveCount(0);
    await expect(balanceDock.getByRole('button', { name: 'Balances' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('lets the desktop balances title hide the dock while wallet identity remains accessible', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await installMockTradingWallet(page);
    await page.goto('/trades');

    await page.locator('.top-header .wallet-primary-action').click();
    await expect(page.locator('.top-header').getByRole('button', { name: 'Copy owner wallet address' })).toBeVisible();

    const balanceDock = page.locator('.p2p-balance-dock');
    await balanceDock.getByRole('button', { name: 'Balances' }).click();
    await expect(balanceDock).toContainText('Hidden');
    await expect(page.locator('.top-header').getByRole('button', { name: 'Copy owner wallet address' })).toBeVisible();

    await balanceDock.getByRole('button', { name: 'Balances' }).click();
    await expect(page.locator('.top-header').getByRole('button', { name: 'Copy owner wallet address' })).toBeVisible();
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
      expect(Math.abs(slot.height - layout.wallet!.height)).toBeLessThanOrEqual(8);
    }

    await expectNoHorizontalOverflow(page);
  });

  test('loads My Trades after connecting from the desk and keeps one refresh action', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await installMockTradingWallet(page);
    await page.goto('/trades');

    await page.locator('.top-header .wallet-primary-action').click();
    await page.getByRole('navigation', { name: 'OTC Desk views' }).getByRole('button', { name: 'Orders' }).click();

    const myTradesSection = page.locator('.p2p-my-trades-section');
    await expect(myTradesSection).toBeVisible();
    const switcher = myTradesSection.locator('.p2p-wallet-trade-switcher');
    await expect(switcher).toBeVisible({ timeout: 45_000 });
    await expect(myTradesSection.locator('.p2p-my-trades-empty-workspace')).toHaveCount(0);
    await expect(myTradesSection.locator('.p2p-my-trades-refresh-btn')).toHaveCount(1);
    await expect(myTradesSection.getByRole('button', { name: /^(Refresh|Refreshing\.\.\.)$/ })).toHaveCount(1);

    for (const group of ['Received', 'Active', 'History']) {
      await expect(switcher.getByRole('tab', { name: new RegExp(`${group}: \\d+`) })).toBeVisible();
    }

    await switcher.getByRole('tab', { name: /Received: \d+/ }).click();
    await expect(switcher.getByRole('tab', { name: /Received: \d+/ })).toHaveAttribute('aria-selected', 'true');
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
    expect(scrollState.shell).toBe('hidden');
    expect(scrollState.section).toBe('hidden');
    await expectNoHorizontalOverflow(page);
  });

  test('opens the mobile trading terminal as focused page content', async ({ page }) => {
    await page.goto('/otc/order');

    const terminal = page.locator('.standalone-trade-detail-section');
    await expect(terminal).toBeVisible();
    await expect(terminal.locator('.landing-eyebrow', { hasText: /^Order$/ })).toBeVisible();
    await expect(terminal.getByRole('heading', { name: 'Open order' })).toBeVisible();
    await expect(terminal.getByText('Paste a shared offer link')).toBeVisible();
    await expect(terminal.getByRole('button', { name: 'Open order', exact: true })).toBeVisible();
    await expect(terminal.getByRole('button', { name: 'Open desk', exact: true })).toBeVisible();
    await expect(terminal.getByRole('button', { name: 'Create offer', exact: true })).toBeVisible();
    await expect(terminal.getByText('Open trading terminal', { exact: true })).toHaveCount(0);
    await expect(terminal.getByRole('button', { name: 'Paste Link', exact: true })).toHaveCount(0);
    await expect(terminal.locator('.p2p-trade-window-warning')).toHaveCount(0);
    await expect(page.locator('.p2p-market-overview')).toBeHidden();
    await expect(page.locator('.p2p-public-trades-section')).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'OTC Desk views' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('keeps mobile trade creation actions reachable without eager field errors', async ({ page }) => {
    await page.goto('/otc/limit');

    const readiness = page.locator('.trade-compose-readiness');
    await expect(readiness).toContainText(/Connect wallet|Complete required fields|Loading token balance|Ready to create offer/);

    const sendAmountError = page.getByText(/Enter a valid .+ amount to send\./);
    await expect(sendAmountError).toHaveCount(0);
    await page.getByRole('button', { name: 'Create Offer' }).click();
    await expect(sendAmountError).toBeVisible();

    await page.locator('.trade-compose-section-sell .trade-compose-amount-field .trade-compose-input').fill('10');
    await page.locator('.trade-compose-price-field .trade-compose-input').fill('1');
    await expect(page.locator('.trade-compose-pricing-source')).toHaveCount(2);
    await expect(page.locator('.trade-compose-pricing-derived')).toHaveCount(1);
    await expect(page.locator('.trade-compose-pricing-derived .trade-compose-pricing-state')).toContainText('Derived');

    await scrollTradeShellToBottom(page);
    await expect(page.getByRole('button', { name: 'Create Offer' })).toBeVisible();
    await expectAboveTradeTabs(page, '.trade-compose-footer');
    await expectNoHorizontalOverflow(page);
  });

  test('keeps recurring order submit controls reachable on mobile', async ({ page }) => {
    await page.goto('/otc/limit');
    await page.getByRole('tab', { name: 'Recurring' }).click();

    await scrollTradeShellToBottom(page);
    await expect(page.getByRole('button', { name: 'Create Recurring Order' })).toBeVisible();
    await expectAboveTradeTabs(page, '.p2p-recurring-actions');
    await expectNoHorizontalOverflow(page);
  });

  test('opens mobile terminal history as a closeable sheet', async ({ page }) => {
    await page.goto('/trades/recurring?order=1');

    const terminal = page.locator('.p2p-terminal-shell-recurring');
    await expect(terminal).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.p2p-terminal-history-window')).toBeHidden();
    await terminal.locator('.p2p-terminal-mobile-history-trigger').click();
    const sheet = page.locator('.p2p-terminal-history-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.p2p-terminal-history-sheet-head')).toContainText('Your history');
    await expect(sheet.getByRole('button', { name: 'Close' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
  });

  test('keeps the mobile trading terminal dense without stacking early', async ({ page }) => {
    await page.goto('/trades/recurring?order=1');

    const terminal = page.locator('.p2p-terminal-shell-recurring');
    await expect(terminal).toBeVisible({ timeout: 30_000 });

    const terminalTop = page.locator('.standalone-trade-detail-section > .standalone-trades-section-head');
    const terminalTopBox = await terminalTop.boundingBox();
    expect(terminalTopBox).not.toBeNull();
    expect(terminalTopBox!.height).toBeLessThanOrEqual(48);
    await expect(terminalTop.locator('.landing-eyebrow')).toContainText('Order');
    await expect(terminalTop.getByRole('button', { name: 'Close' })).toBeVisible();

    const warningBox = await page.locator('.p2p-trade-window-warning').boundingBox();
    expect(warningBox).not.toBeNull();
    expect(warningBox!.height).toBeLessThanOrEqual(48);

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
    await expect(page.locator('.p2p-mobile-balance-fab')).toBeVisible();
    await expectAboveTradeTabs(page, '.p2p-mobile-balance-fab');
    const terminalFooterFlow = await page.evaluate(() => {
      const terminal = document.querySelector('.p2p-terminal-shell-recurring');
      const footer = document.querySelector('.p2p-footer-links');
      if (!terminal || !footer) {
        return null;
      }
      const terminalRect = terminal.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      return {
        terminalBottom: terminalRect.bottom,
        footerTop: footerRect.top
      };
    });
    expect(terminalFooterFlow).not.toBeNull();
    expect(terminalFooterFlow!.footerTop).toBeGreaterThanOrEqual(terminalFooterFlow!.terminalBottom - 1);
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

    await page.mouse.click(5, 5);
    await page.getByRole('button', { name: /^Direct$/ }).click();
    await expect(page.locator('.p2p-direct-recipient')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: /^Unlisted$/ }).click();
    await expect(page.getByRole('button', { name: /^Unlisted$/ })).toHaveAttribute('aria-pressed', 'true');
    await expectNoHorizontalOverflow(page);

    await page.goto('/otc/order');
    const terminal = page.locator('.standalone-trade-detail-section');
    await expect(terminal.getByPlaceholder('Paste offer link, compact code, or id')).toBeVisible();
    await expect(terminal.getByRole('button', { name: 'Open order', exact: true })).toBeVisible();
    await expect(terminal.getByRole('button', { name: 'Open desk', exact: true })).toBeVisible();
    await expect(terminal.getByRole('button', { name: 'Create offer', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('keeps My Trades mobile group labels short and readable', async ({ page }) => {
    await installMockTradingWallet(page, sampleRecurringMakerAddress);
    await page.goto('/trades/mine');
    await page.locator('.top-header-mobile-wallet .wallet-primary-action').click();

    const switcher = page.locator('.p2p-wallet-trade-switcher');
    const mobileLabels = switcher.locator('.p2p-wallet-trade-label-mobile');
    await expect(mobileLabels).toHaveText(['Received', 'Active', 'History'], {
      timeout: 45_000
    });
    await expect
      .poll(
        () =>
          mobileLabels.evaluateAll((labels) =>
            labels.map(
              (label) =>
                window.getComputedStyle(label).display !== 'none' &&
                label.getClientRects().length > 0
            )
          ),
        { timeout: 45_000 }
      )
      .toEqual([true, true, true]);
    await expect(switcher.locator('.p2p-wallet-trade-label-full').first()).toBeHidden();
    await expectNoHorizontalOverflow(page);
  });

  test('lets My Trades mobile cards scroll in the main page flow', async ({ page }) => {
    await page.setViewportSize({ width: mobileViewport.width, height: 620 });
    await installMockTradingWallet(page, sampleRecurringMakerAddress);
    await page.goto('/trades/mine');
    await page.locator('.top-header-mobile-wallet .wallet-primary-action').click();

    const switcher = page.locator('.p2p-wallet-trade-switcher');
    await expect(switcher).toBeVisible({ timeout: 45_000 });
    const activeTrades = switcher.getByRole('tab', { name: /Active: [1-9]\d*/ });
    await expect(activeTrades).toBeVisible({ timeout: 45_000 });
    await activeTrades.click();
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

  test('keeps desktop trading gutters and balance dock aligned across routes', async ({ page }) => {
    await page.setViewportSize({ width: 2016, height: 980 });

    for (const route of ['/otcdesk', '/otcdesk/create', '/otcdesk/terminal', '/otcdesk/mytrades']) {
      await page.goto(route);
      await expect(page.locator('.p2p-trading-shell')).toBeVisible();
      await expect(page.locator('.p2p-balance-dock')).toBeVisible();

      const layout = await page.evaluate(() => {
        const shell = document.querySelector<HTMLElement>('.p2p-trading-shell');
        const dock = document.querySelector<HTMLElement>('.p2p-balance-dock');
        if (!shell || !dock) {
          return null;
        }

        const shellBox = shell.getBoundingClientRect();
        const dockBox = dock.getBoundingClientRect();
        const shellStyle = window.getComputedStyle(shell);
        const innerLeft = shellBox.left + Number.parseFloat(shellStyle.paddingLeft || '0');
        const innerRight = shellBox.right - Number.parseFloat(shellStyle.paddingRight || '0');
        const isDrawer = shell.classList.contains('p2p-trading-shell-drawer-open');
        const fullPanel = !isDrawer
          ? document.querySelector<HTMLElement>('.standalone-trade-create-panel, .p2p-market-overview')
          : null;
        const panelBox = fullPanel?.getBoundingClientRect();

        return {
          dockBottom: dockBox.bottom,
          dockLeft: dockBox.left,
          dockRight: dockBox.right,
          innerBottom: shellBox.bottom - Number.parseFloat(shellStyle.paddingBottom || '0'),
          innerLeft,
          innerRight,
          panelLeft: panelBox?.left ?? null,
          panelRight: panelBox?.right ?? null
        };
      });

      expect(layout).not.toBeNull();
      expect(Math.abs(layout!.dockLeft - layout!.innerLeft)).toBeLessThanOrEqual(2);
      expect(Math.abs(layout!.dockRight - layout!.innerRight)).toBeLessThanOrEqual(2);
      expect(layout!.innerBottom - layout!.dockBottom).toBeGreaterThanOrEqual(-1);
      expect(layout!.innerBottom - layout!.dockBottom).toBeLessThanOrEqual(4);

      if (layout!.panelLeft !== null && layout!.panelRight !== null) {
        expect(Math.abs(layout!.panelLeft - layout!.innerLeft)).toBeLessThanOrEqual(2);
        expect(Math.abs(layout!.panelRight - layout!.innerRight)).toBeLessThanOrEqual(2);
      }

      await expectNoHorizontalOverflow(page);
    }
  });

  test('uses a full-width create workspace with a compact quote area on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto('/otc/limit');

    const shell = page.locator('.p2p-trading-shell-create');
    const createPanel = page.locator('.standalone-trade-create-panel');
    const composer = createPanel.locator('.trade-compose-panel').first();
    const quoteDock = composer.locator('.trade-compose-quote-dock');

    await expect(shell).toBeVisible();
    await expect(createPanel).toBeVisible();
    await expect(composer).toBeVisible();
    await expect(quoteDock).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Limit' })).toHaveAttribute('aria-selected', 'true');
    await expect(composer.getByRole('button', { name: 'Create Offer' })).toBeVisible();
    await expect(composer.locator('.trade-compose-privacy-panel')).toContainText('Private liquidity');
    await expect(composer.locator('.trade-compose-privacy-panel input[type="checkbox"]')).toHaveCount(0);
    await expect(composer.locator('.trade-compose-limit-price .trade-compose-price-field')).toBeVisible();
    await expect(quoteDock.locator('.trade-compose-preview')).toBeHidden();

    const workspaceMetrics = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('.p2p-trading-shell-create');
      const panel = document.querySelector<HTMLElement>('.standalone-trade-create-panel');
      const composer = document.querySelector<HTMLElement>('.standalone-trade-create-panel .trade-compose-panel');
      const grid = document.querySelector<HTMLElement>('.standalone-trade-create-panel .trade-compose-grid');
      const sell = document.querySelector<HTMLElement>('.standalone-trade-create-panel .trade-compose-section-sell');
      const buy = document.querySelector<HTMLElement>('.standalone-trade-create-panel .trade-compose-section-buy');
      const dock = document.querySelector<HTMLElement>('.standalone-trade-create-panel .trade-compose-quote-dock');
      const shellBox = shell?.getBoundingClientRect();
      const panelBox = panel?.getBoundingClientRect();
      const sellBox = sell?.getBoundingClientRect();
      const buyBox = buy?.getBoundingClientRect();
      return {
        buyTop: buyBox?.top ?? 0,
        composerOverflowY: composer ? window.getComputedStyle(composer).overflowY : '',
        dockPosition: dock ? window.getComputedStyle(dock).position : '',
        gridColumns: grid ? window.getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
        panelWidth: panelBox?.width ?? 0,
        sellTop: sellBox?.top ?? 0,
        shellOverflowY: shell ? window.getComputedStyle(shell).overflowY : '',
        shellWidth: shellBox?.width ?? 0
      };
    });
    expect(workspaceMetrics.panelWidth).toBeGreaterThan(1100);
    expect(workspaceMetrics.panelWidth).toBeGreaterThan(workspaceMetrics.shellWidth - 44);
    expect(workspaceMetrics.shellOverflowY).toBe('hidden');
    expect(['auto', 'scroll', 'visible']).toContain(workspaceMetrics.composerOverflowY);
    expect(workspaceMetrics.dockPosition).toBe('static');
    expect(workspaceMetrics.gridColumns).toBe(1);
    expect(workspaceMetrics.buyTop).toBeGreaterThan(workspaceMetrics.sellTop);

    const dockTopBefore = await quoteDock.evaluate((dock) => Math.round(dock.getBoundingClientRect().top));
    await composer.locator('.trade-compose-section-sell .trade-compose-amount-field .trade-compose-input').fill('10');
    await composer.locator('.trade-compose-limit-price .trade-compose-price-field .trade-compose-input').fill('1');
    const dockTopAfter = await quoteDock.evaluate((dock) => Math.round(dock.getBoundingClientRect().top));
    expect(Math.abs(dockTopAfter - dockTopBefore)).toBeLessThanOrEqual(20);
    await expect(quoteDock.locator('.trade-compose-readiness')).toContainText(
      /Connect wallet|Complete required fields|Loading token balance|Ready to create offer/
    );

    await page.getByRole('button', { name: /^Direct$/ }).click();
    await expect(page.locator('.p2p-direct-recipient')).toBeVisible();
    await expect(composer.getByRole('button', { name: 'Create Offer' })).toBeVisible();

    await page.goto('/otc/order/counter');
    await expect(page.locator('.p2p-trading-shell-create')).toBeVisible();
    await expect(page.getByText('Choose an offer to counter')).toBeVisible();
    await expect(page.locator('.p2p-empty-actions').getByRole('button', { name: 'Order' })).toBeVisible();

    await page.goto('/otc/limit');
    await page.getByRole('tab', { name: 'Recurring' }).click();
    const recurringBuilder = page.locator('.p2p-recurring-builder');
    await expect(recurringBuilder).toBeVisible();
    await expect(recurringBuilder.locator('.p2p-recurring-action-fee')).toContainText('Fee');
    await expect(recurringBuilder.locator('.p2p-recurring-pair-picker .trade-compose-field-value').first()).toContainText(
      'Available'
    );
    await expect(recurringBuilder.locator('.p2p-recurring-pair-picker .trade-token-select-state a').first()).toHaveAttribute(
      'href',
      /\/address\//
    );
    await expect(recurringBuilder.getByRole('button', { name: 'Swap recurring token sides' })).toHaveCount(1);
    await recurringBuilder.evaluate((builder) => {
      builder.scrollTop = builder.scrollHeight;
    });
    await expect(recurringBuilder.getByRole('button', { name: 'Create Recurring Order' })).toBeVisible();
    const recurringMetrics = await recurringBuilder.evaluate((builder) => {
      const buy = builder.querySelector<HTMLElement>('.p2p-recurring-side-panel-buy');
      const sell = builder.querySelector<HTMLElement>('.p2p-recurring-side-panel-sell');
      const actions = builder.querySelector<HTMLElement>('.p2p-recurring-actions');
      return {
        actionsPosition: actions ? window.getComputedStyle(actions).position : '',
        buyTop: buy?.getBoundingClientRect().top ?? 0,
        overflowY: window.getComputedStyle(builder).overflowY,
        sellTop: sell?.getBoundingClientRect().top ?? 0
      };
    });
    expect(['auto', 'scroll', 'visible']).toContain(recurringMetrics.overflowY);
    expect(recurringMetrics.actionsPosition).toBe('relative');
    expect(Math.abs(recurringMetrics.buyTop - recurringMetrics.sellTop)).toBeLessThanOrEqual(2);
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
            ? Math.abs((controlsBox.left - shellBox.left) - (shellBox.right - controlsBox.right))
            : 999,
        controlsWidth: controlsBox?.width ?? 0,
        overviewWidth: overviewBox?.width ?? 0,
        panelWidth: panelBox?.width ?? 0,
        shellWidth: shellBox?.width ?? 0
      };
    });

    expect(metrics.overviewWidth).toBeGreaterThan(metrics.shellWidth - 44);
    expect(metrics.panelWidth).toBeGreaterThan(metrics.shellWidth - 44);
    expect(metrics.controlsWidth).toBeGreaterThanOrEqual(640);
    expect(metrics.controlsWidth).toBeLessThanOrEqual(740);
    expect(metrics.controlsWidth).toBeLessThan(metrics.panelWidth - 800);
    expect(metrics.controlsCenteredDelta).toBeLessThanOrEqual(16);
    await expectNoHorizontalOverflow(page);
  });

  test('shows card-shaped skeletons while active desk offers are loading', async ({ page }) => {
    await page.setViewportSize({ width: 2016, height: 980 });
    await page.goto('/trades', { waitUntil: 'domcontentloaded' });

    const skeletonGrid = page.locator('.p2p-desk-skeleton-grid');
    await expect(skeletonGrid).toBeVisible({ timeout: 5_000 });
    await expect(skeletonGrid.locator('.p2p-desk-skeleton-card')).toHaveCount(5);
    await expect(skeletonGrid.locator('.p2p-desk-skeleton-card-recurring')).toHaveCount(3);
    await expect(skeletonGrid.locator('.p2p-desk-skeleton-market')).toHaveCount(5);
    await expect(skeletonGrid.locator('.p2p-desk-skeleton-actions')).toHaveCount(5);
    await expect(page.locator('.p2p-empty-state-loading')).toHaveCount(0);
  });

  test('stretches the desktop desk section down to the balance dock', async ({ page }) => {
    await page.setViewportSize({ width: 2016, height: 980 });
    await page.goto('/trades');

    const desk = page.locator('.p2p-public-trades-section');
    await expect(desk.locator('.p2p-order-card').first()).toBeVisible({ timeout: 30_000 });

    const layout = await page.evaluate(() => {
      const read = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) {
          return null;
        }
        const box = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          bottom: box.bottom,
          clientHeight: element.clientHeight,
          overflowY: style.overflowY,
          scrollHeight: element.scrollHeight,
          top: box.top
        };
      };

      return {
        balanceDock: read('.p2p-balance-dock'),
        desk: read('.p2p-public-trades-section'),
        grid: read('.p2p-public-trade-grid'),
        shell: read('.p2p-trading-shell-has-overview')
      };
    });

    expect(layout.shell?.overflowY).toBe('hidden');
    expect(layout.desk).not.toBeNull();
    expect(layout.grid).not.toBeNull();
    expect(layout.balanceDock).not.toBeNull();
    expect(layout.balanceDock!.top - layout.desk!.bottom).toBeLessThanOrEqual(18);
    expect(layout.shell!.bottom - layout.balanceDock!.bottom).toBeLessThanOrEqual(18);
    expect(['auto', 'scroll']).toContain(layout.grid!.overflowY);
    expect(layout.grid!.clientHeight).toBeLessThanOrEqual(layout.grid!.scrollHeight);
    await expectNoHorizontalOverflow(page);
  });

  test('keeps the compact empty order layout clear of the balance dock', async ({ page }) => {
    await page.setViewportSize({ width: 2016, height: 980 });
    await page.goto('/otc/order');

    await expect(page.locator('.standalone-trade-detail-section')).toContainText('Open order');

    const layout = await page.evaluate(() => {
      const read = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) {
          return null;
        }
        const box = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          bottom: box.bottom,
          clientHeight: element.clientHeight,
          overflowY: style.overflowY,
          scrollHeight: element.scrollHeight,
          top: box.top
        };
      };

      return {
        balanceDock: read('.p2p-balance-dock'),
        shell: read('.p2p-trading-shell-drawer-open'),
        terminal: read('.standalone-trade-detail-section')
      };
    });

    expect(layout.shell?.overflowY).toBe('hidden');
    expect(layout.terminal).not.toBeNull();
    expect(layout.balanceDock).not.toBeNull();
    expect(layout.balanceDock!.top - layout.terminal!.bottom).toBeGreaterThanOrEqual(12);
    expect(layout.balanceDock!.top - layout.terminal!.bottom).toBeLessThanOrEqual(180);
    expect(layout.shell!.bottom - layout.balanceDock!.bottom).toBeLessThanOrEqual(18);
    expect(['auto', 'scroll', 'visible']).toContain(layout.terminal!.overflowY);
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

    await marketTabs.filter({ hasText: /^Orders$/ }).click();
    await expect(page).toHaveURL(/\/otc\/orders$/);
    await expect(page.locator('.p2p-my-trades-section')).toBeVisible();
    await expect(page.locator('.standalone-trade-detail-section')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test('closes an open terminal when clicking the current desk tab', async ({ page }) => {
    await page.setViewportSize({ width: 2016, height: 980 });
    await page.goto('/otc/desk');

    const cards = page.locator('.p2p-public-trade-grid .p2p-order-card');
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    await cards.first().locator('.p2p-offer-open-btn').click();

    const terminal = page.locator('.standalone-trade-detail-section');
    const marketTabs = page.locator('.p2p-market-tabs').getByRole('button');
    await expect(terminal.locator('.p2p-terminal-shell')).toBeVisible();
    await expect(terminal).toContainText('Review order');
    await expect(page).toHaveURL(/\/otc\/order\/(link\/|recurring\/)/);

    await marketTabs.filter({ hasText: /^Desk$/ }).click();
    await expect(page).toHaveURL(/\/otc\/desk$/);
    await expect(page.locator('.p2p-public-trades-section')).toBeVisible();
    await expect(page.locator('.standalone-trade-detail-section')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test('closes any open order when switching between Desk and Orders', async ({ page }) => {
    await page.setViewportSize({ width: 2016, height: 980 });
    await page.goto('/otc/desk');

    const cards = page.locator('.p2p-public-trade-grid .p2p-order-card');
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    await cards.first().locator('.p2p-offer-open-btn').click();

    const terminal = page.locator('.standalone-trade-detail-section');
    const marketTabs = page.locator('.p2p-market-tabs').getByRole('button');
    await expect(terminal.locator('.p2p-terminal-shell')).toBeVisible();
    await expect(terminal).toContainText('Review order');
    await expect(page).toHaveURL(/\/otc\/order\/(link\/|recurring\/)/);

    await marketTabs.filter({ hasText: /^Orders$/ }).click();
    await expect(page).toHaveURL(/\/otc\/orders$/);
    await expect(page.locator('.p2p-my-trades-section')).toBeVisible();
    await expect(terminal).toHaveCount(0);

    await marketTabs.filter({ hasText: /^Desk$/ }).click();
    await expect(page).toHaveURL(/\/otc\/desk$/);
    await expect(page.locator('.p2p-public-trades-section')).toBeVisible();
    await expect(page.locator('.standalone-trade-detail-section')).toHaveCount(0);
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
      const tabs = page.getByRole('navigation', { name: 'OTC Desk views' });
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
      expect(activeStyles[0].backgroundImage).toContain('linear-gradient');
      expect(inactiveStyles[0].backgroundImage).toContain('linear-gradient');
      expect(activeStyles[0].backgroundImage).not.toEqual(inactiveStyles[0].backgroundImage);
      expect(activeStyles[0].boxShadow).not.toEqual(inactiveStyles[0].boxShadow);
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

  test('keeps the desk filter panel edge stable when an order drawer is active', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });

    const readDeskFrame = async () => {
      const overview = page.locator('.p2p-market-overview');
      const overviewHead = page.locator('.p2p-market-overview-head');
      const filterBar = page.locator('.p2p-filter-bar');
      await expect(overview).toBeVisible();
      await expect(overviewHead).toBeVisible();
      await expect(filterBar).toBeVisible();
      const [overviewBox, headBox, filterBox] = await Promise.all([
        overview.boundingBox(),
        overviewHead.boundingBox(),
        filterBar.boundingBox()
      ]);
      expect(overviewBox).not.toBeNull();
      expect(headBox).not.toBeNull();
      expect(filterBox).not.toBeNull();
      return {
        filterLeft: Math.round(filterBox!.x),
        filterTop: Math.round(filterBox!.y),
        headLeft: Math.round(headBox!.x),
        headTop: Math.round(headBox!.y),
        overviewLeft: Math.round(overviewBox!.x),
        overviewTop: Math.round(overviewBox!.y)
      };
    };

    await page.goto('/otc/desk');
    const deskFrame = await readDeskFrame();
    const firstOrder = page.locator('.p2p-public-trade-grid .p2p-order-card').first();
    await expect(firstOrder).toBeVisible({ timeout: 30_000 });
    await firstOrder.locator('.p2p-offer-open-btn').click();
    await expect(page.locator('.standalone-trade-detail-section')).toContainText('Review order');
    const terminalFrame = await readDeskFrame();
    expect(terminalFrame).toEqual(deskFrame);
  });

  test('keeps desk order cards symmetrical and action-ready across order types', async ({ page }) => {
    await page.setViewportSize({ width: 2016, height: 980 });
    await page.goto('/trades');

    const desk = page.locator('.p2p-public-trade-grid');
    const oneOffCard = desk.locator('.p2p-offer-card').first();
    const recurringCard = desk.locator('.p2p-recurring-order-card').first();

    await expect(oneOffCard).toBeVisible({ timeout: 30_000 });
    await expect(recurringCard).toBeVisible({ timeout: 30_000 });
    for (const card of [oneOffCard, recurringCard]) {
      await expect(card.locator('.p2p-order-market-panel')).toBeVisible();
      await expect(card.locator('.p2p-order-detail-band')).toBeVisible();
      await expect(card.locator('.p2p-order-title-row .p2p-offer-status')).toBeVisible();
      await expect(card.locator('.p2p-order-meta-line .p2p-order-id')).toBeVisible();
      await expect(card.locator('.p2p-order-eyebrow-row')).toHaveCount(0);
      await expect(card.locator('.p2p-order-title-row .p2p-order-id')).toHaveCount(0);
      await expect(card.locator('.p2p-order-subline .p2p-order-id')).toHaveCount(1);
      await expect(card.locator('.p2p-order-subline .p2p-offer-status')).toHaveCount(0);
      await expect(card.locator('.p2p-order-subline').first()).toBeVisible();
      await expect(card.locator('.p2p-order-tag-stack .p2p-order-subline')).toHaveCount(1);
      const headerOrder = await card.locator('.p2p-offer-title').evaluate((title) => {
        const pair = title.querySelector('.p2p-order-title-row');
        const status = title.querySelector('.p2p-order-title-row .p2p-offer-status');
        const meta = title.querySelector('.p2p-order-meta-line');
        const id = title.querySelector('.p2p-order-meta-line .p2p-order-id');
        const idStyle = id ? window.getComputedStyle(id) : null;
        return {
          idBorderStyle: idStyle?.borderTopStyle ?? '',
          metaTop: meta?.getBoundingClientRect().top ?? 0,
          pairTop: pair?.getBoundingClientRect().top ?? 0,
          statusTop: status?.getBoundingClientRect().top ?? 0
        };
      });
      expect(headerOrder.pairTop).toBeLessThanOrEqual(headerOrder.metaTop);
      expect(Math.abs(headerOrder.statusTop - headerOrder.pairTop)).toBeLessThanOrEqual(4);
      expect(headerOrder.idBorderStyle).toBe('none');
      await expect(card.locator('.p2p-order-token-actions')).toBeVisible();
      await expect(card.locator('.p2p-order-card-footer')).toBeVisible();
      await expect(card.locator('.p2p-order-card-footer').getByRole('button').first()).toBeVisible();
    }

    await expect(desk.locator('.p2p-offer-term small', { hasText: /Private amount|Public asset/ })).toHaveCount(0);
    await expect(oneOffCard.locator('.p2p-order-meta-line .p2p-order-id')).toContainText(/^(P2P|Private|Direct) OTC #\d+$/);
    await expect(recurringCard.locator('.p2p-order-meta-line .p2p-order-id')).toContainText(/^Recurring OTC #\d+$/);
    await expect(desk.getByRole('button', { name: /Share/ }).first()).toBeVisible();
    await expect(desk.getByText('Public offer')).toHaveCount(0);
    await expect(oneOffCard.locator('.p2p-order-title-token')).toHaveCount(2);
    await expect(oneOffCard.locator('.p2p-order-title-row h3 svg')).toHaveCount(1);
    await expect(recurringCard.locator('.p2p-order-title-row h3')).toContainText(/[A-Z0-9$]+\/[A-Z0-9$]+/i);
    await expect(recurringCard.locator('.p2p-order-title-row h3 svg')).toHaveCount(0);
    await expect(recurringCard.locator('h3')).not.toContainText('buy/sell desk');
    await expect(page.locator('.p2p-public-trade-grid')).not.toContainText('buy/sell desk');
    await expect(recurringCard.getByText('Both sides live')).toHaveCount(0);
    await expect(desk.getByRole('button', { name: /Reveal history/ })).toHaveCount(0);
    await expect(desk).not.toContainText('No expiration');
    const firstExpiryChip = desk.locator('.p2p-offer-card .p2p-expiry-chip').first();
    if (await firstExpiryChip.count()) {
      const expiryTitle = await firstExpiryChip.getAttribute('title');
      expect(expiryTitle?.length ?? 0).toBeGreaterThan(8);
    }
    await expect(recurringCard.locator('.p2p-order-chip', { hasText: 'Private liquidity' })).toHaveCount(1);
    const hybridCardCount = await desk
      .locator('.p2p-offer-card')
      .filter({ has: page.locator('.p2p-order-chip', { hasText: 'Hybrid liquidity' }) })
      .count();
    if (hybridCardCount > 0) {
      await expect(
        desk
          .locator('.p2p-offer-card')
          .filter({ has: page.locator('.p2p-order-chip', { hasText: 'Hybrid liquidity' }) })
          .first()
      ).toBeVisible();
    }
    await expect(
      desk
        .locator('.p2p-offer-card')
        .filter({ has: page.locator('.p2p-order-chip', { hasText: /Public liquidity|Hybrid liquidity|Private liquidity/ }) })
        .first()
    ).toBeVisible();
    await expect(desk.getByRole('button', { name: 'Counter', exact: true })).toHaveCount(0);
    await expect(desk.getByRole('button', { name: 'Counter unavailable', exact: true })).toHaveCount(0);
    const makerCard = desk.locator('.p2p-order-card').filter({ has: page.locator('.p2p-offer-manage-btn') }).first();
    if (await makerCard.count()) {
      const makerChip = makerCard.locator('.p2p-order-tag-stack .p2p-order-chip-owner').first();
      await expect(makerChip).toHaveText('Maker');
      await expect(makerChip).toHaveAttribute('title', 'Created by you');
      await expect(makerCard.locator('.p2p-order-card-footer > span', { hasText: /Created by you|Maker/ })).toHaveCount(0);
      const makerOpenStyle = await makerCard.locator('.p2p-offer-manage-btn').first().evaluate((button) => {
        const style = window.getComputedStyle(button);
        return {
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          borderColor: style.borderColor,
          color: style.color
        };
      });
      expect(makerOpenStyle.backgroundImage).toContain('linear-gradient');
      const referenceOpen = desk.locator('.p2p-offer-open-btn').first();
      if ((await referenceOpen.count()) > 0) {
        const referenceOpenStyle = await referenceOpen.evaluate((button) => {
          const style = window.getComputedStyle(button);
          return {
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            borderColor: style.borderColor,
            color: style.color
          };
        });
        expect(makerOpenStyle).toEqual(referenceOpenStyle);
      }
    }
    await expect(desk.locator('.p2p-offer-term span', { hasText: 'Buyer pays' })).toHaveCount(0);
    const publicLiquidityOneOff = desk
      .locator('.p2p-offer-card')
      .filter({ has: page.locator('.p2p-order-liquidity-summary') })
      .first();
    if (await publicLiquidityOneOff.count()) {
      await expect(publicLiquidityOneOff.locator('.p2p-order-liquidity-summary')).toBeVisible();
      await expect(publicLiquidityOneOff.locator('.p2p-order-liquidity-summary')).toContainText(/You buy|You sell/);
      await expect(publicLiquidityOneOff.locator('.p2p-order-liquidity-summary')).not.toContainText(/Seller sells|Buyer pays/);
      await expect(publicLiquidityOneOff.locator('.p2p-order-liquidity-summary')).toContainText(/left/);
      await expect(publicLiquidityOneOff.locator('.p2p-order-liquidity-summary')).toContainText(/\d+(?:\.\d+)?\/\d+(?:\.\d+)?/);
      await expect(publicLiquidityOneOff.locator('.p2p-order-liquidity-summary')).toContainText(/sold|bought/);
      await expect(publicLiquidityOneOff.locator('.p2p-offer-terms')).toHaveCount(0);
    }
    await expect(desk.locator('.p2p-order-market-panel').getByText('Price desk')).toHaveCount(0);
    await expect(recurringCard.locator('.p2p-recurring-price-card-head')).toContainText('Price ratio');
    await expect(recurringCard.locator('.p2p-recurring-price-basis')).toHaveCount(0);
    await expect(oneOffCard.locator('.p2p-order-market-panel .p2p-price-number')).toBeVisible();
    await expect(oneOffCard.locator('.p2p-order-market-panel .p2p-price-side-label')).toContainText(
      /^(Buy|Sell) [A-Z0-9$._-]+ (with|for) [A-Z0-9$._-]+/i
    );
    await expect(recurringCard.locator('.p2p-recurring-price-box .p2p-price-number')).toHaveCount(2);
    await expect(desk.locator('.p2p-recurring-inventory-strip strong').first()).toBeVisible();
    const oneOffProgressNumericLocator = (await publicLiquidityOneOff.count())
      ? publicLiquidityOneOff.locator('.p2p-order-liquidity-summary strong').first()
      : oneOffCard.locator('.p2p-order-market-panel .p2p-price-number').first();
    const recurringValueWrap = await recurringCard
      .locator('.p2p-recurring-price-box .p2p-price-unit, .p2p-recurring-inventory-strip .p2p-liquidity-label')
      .evaluateAll((values) =>
        values.map((value) => {
          const style = window.getComputedStyle(value);
          return {
            overflow: style.overflow,
            scrollWidth: value.scrollWidth,
            clientWidth: value.clientWidth,
            text: value.textContent?.trim() ?? '',
            textOverflow: style.textOverflow,
            whiteSpace: style.whiteSpace
          };
        })
      );
    expect(recurringValueWrap.length).toBeGreaterThanOrEqual(5);
    for (const value of recurringValueWrap) {
      expect(value.text).not.toMatch(/\.\.\.|…/);
      expect(value.whiteSpace).not.toBe('nowrap');
      expect(value.textOverflow).not.toBe('ellipsis');
      expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth + 1);
    }
    const numericStyles = await Promise.all([
      oneOffCard.locator('.p2p-order-market-panel .p2p-price-number').first().evaluate((element) => {
        const style = window.getComputedStyle(element);
        const unit = element.parentElement?.querySelector('.p2p-price-unit');
        const unitStyle = unit ? window.getComputedStyle(unit) : null;
        return {
          fontFeatureSettings: style.fontFeatureSettings,
          fontSize: parseFloat(style.fontSize),
          fontVariantNumeric: style.fontVariantNumeric,
          unitFontSize: unitStyle ? parseFloat(unitStyle.fontSize) : 0
        };
      }),
      recurringCard.locator('.p2p-recurring-price-box .p2p-price-number').first().evaluate((element) => {
        const style = window.getComputedStyle(element);
        const unit = element.parentElement?.querySelector('.p2p-price-unit');
        const unitStyle = unit ? window.getComputedStyle(unit) : null;
        return {
          fontFeatureSettings: style.fontFeatureSettings,
          fontSize: parseFloat(style.fontSize),
          fontVariantNumeric: style.fontVariantNumeric,
          unitFontSize: unitStyle ? parseFloat(unitStyle.fontSize) : 0
        };
      }),
      oneOffProgressNumericLocator.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          fontFeatureSettings: style.fontFeatureSettings,
          fontSize: parseFloat(style.fontSize),
          fontVariantNumeric: style.fontVariantNumeric,
          unitFontSize: 0
        };
      }),
      desk.locator('.p2p-recurring-inventory-strip strong').first().evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          fontFeatureSettings: style.fontFeatureSettings,
          fontSize: parseFloat(style.fontSize),
          fontVariantNumeric: style.fontVariantNumeric,
          unitFontSize: 0
        };
      })
    ]);
    for (const style of numericStyles) {
      expect(`${style.fontVariantNumeric} ${style.fontFeatureSettings}`).toMatch(/tabular-nums|tnum/);
      if (style.unitFontSize > 0) {
        expect(style.fontSize).toBeGreaterThan(style.unitFontSize);
      }
    }
    expect(numericStyles[0].fontSize).toBeGreaterThan(20);
    expect(numericStyles[1].fontSize).toBeGreaterThan(18);
    expect(numericStyles[0].unitFontSize).toBeLessThanOrEqual(numericStyles[0].fontSize * 0.56);
    expect(numericStyles[1].unitFontSize).toBeLessThanOrEqual(numericStyles[1].fontSize * 0.56);
    const oneOffChrome = await oneOffCard.evaluate((card) => {
      const readBorder = (selector: string) => {
        const element = card.querySelector(selector);
        return element ? window.getComputedStyle(element).borderTopColor : '';
      };
      return {
        detail: readBorder('.p2p-order-detail-band'),
        market: readBorder('.p2p-order-market-panel'),
        outer: window.getComputedStyle(card).borderTopColor,
        term: readBorder('.p2p-order-liquidity-summary, .p2p-offer-term')
      };
    });
    expect(parseColorAlpha(oneOffChrome.market)).toBeLessThan(parseColorAlpha(oneOffChrome.outer));
    expect(parseColorAlpha(oneOffChrome.market)).toBeLessThanOrEqual(0.16);
    expect(parseColorAlpha(oneOffChrome.term)).toBeLessThan(parseColorAlpha(oneOffChrome.outer));
    expect(parseColorAlpha(oneOffChrome.detail)).toBeLessThanOrEqual(parseColorAlpha(oneOffChrome.outer));
    expect(parseColorChroma(oneOffChrome.market)).toBeLessThan(parseColorChroma(oneOffChrome.outer));
    expect(parseColorChroma(oneOffChrome.term)).toBeLessThan(parseColorChroma(oneOffChrome.outer));
    const recurringChrome = await recurringCard.evaluate((card) => {
      const readStyle = (selector: string) => {
        const element = card.querySelector(selector);
        return element ? window.getComputedStyle(element) : null;
      };
      const price = readStyle('.p2p-recurring-price-card');
      const priceBox = readStyle('.p2p-recurring-price-box');
      const strip = readStyle('.p2p-recurring-inventory-strip');
      const stripCell = readStyle('.p2p-recurring-inventory-strip > div');
      return {
        outer: window.getComputedStyle(card).borderTopColor,
        price: price?.borderTopColor ?? '',
        priceBox: priceBox?.borderTopColor ?? '',
        strip: strip?.borderTopColor ?? '',
        stripCellBackground: stripCell?.backgroundColor ?? '',
        stripColumnGap: strip?.columnGap ?? ''
      };
    });
    expect(parseColorAlpha(recurringChrome.price)).toBeLessThan(parseColorAlpha(recurringChrome.outer));
    expect(parseColorAlpha(recurringChrome.priceBox)).toBeLessThan(parseColorAlpha(recurringChrome.outer));
    expect(parseColorAlpha(recurringChrome.strip)).toBeLessThan(parseColorAlpha(recurringChrome.outer));
    expect(parseColorAlpha(recurringChrome.price)).toBeLessThanOrEqual(0.16);
    expect(parseColorAlpha(recurringChrome.priceBox)).toBeLessThanOrEqual(0.14);
    expect(parseColorChroma(recurringChrome.price)).toBeLessThan(parseColorChroma(recurringChrome.outer));
    expect(parseColorChroma(recurringChrome.priceBox)).toBeLessThan(parseColorChroma(recurringChrome.outer));
    expect(parseColorChroma(recurringChrome.strip)).toBeLessThan(parseColorChroma(recurringChrome.outer));
    expect(parseColorAlpha(recurringChrome.stripCellBackground)).toBeLessThanOrEqual(0.05);
    expect(parseFloat(recurringChrome.stripColumnGap)).toBe(0);
    await expect(oneOffCard.locator('.p2p-order-market-panel small')).toHaveCount(0);
    await expect(oneOffCard.locator('.p2p-order-market-panel')).not.toContainText(/Private amounts|Visible terms|Remaining terms/);
    const priceRatioLabelStyles = await Promise.all([
      oneOffCard.locator('.p2p-order-market-panel > span').first().evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          color: style.color,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          letterSpacing: style.letterSpacing,
          textTransform: style.textTransform
        };
      }),
      recurringCard.locator('.p2p-recurring-price-card-head > span').first().evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          color: style.color,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          letterSpacing: style.letterSpacing,
          textTransform: style.textTransform
        };
      })
    ]);
    expect(priceRatioLabelStyles[1]).toEqual(priceRatioLabelStyles[0]);
    expect(parseFloat(priceRatioLabelStyles[0].fontSize)).toBeLessThanOrEqual(11);
    expect(parseColorAlpha(priceRatioLabelStyles[0].color)).toBeLessThanOrEqual(0.8);
    const tagGridMetrics = await oneOffCard.locator('.p2p-order-meta-line .p2p-order-subline').first().evaluate((line) => {
      const style = window.getComputedStyle(line);
      const cells = Array.from(line.querySelectorAll<HTMLElement>('.p2p-order-grid-cell')).map((cell) => {
        const rect = cell.getBoundingClientRect();
        return { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width) };
      });
      return {
        columns: style.gridTemplateColumns.split(' ').length,
        cells,
        topSpread: cells.length ? Math.max(...cells.map((cell) => cell.top)) - Math.min(...cells.map((cell) => cell.top)) : 0
      };
    });
    expect(tagGridMetrics.columns).toBe(3);
    expect(tagGridMetrics.cells).toHaveLength(3);
    expect(tagGridMetrics.cells[0].left).toBeLessThan(tagGridMetrics.cells[1].left);
    expect(tagGridMetrics.cells[1].left).toBeLessThan(tagGridMetrics.cells[2].left);
    expect(tagGridMetrics.topSpread).toBeLessThanOrEqual(2);
    const recurringWithExecutions = desk.locator('.p2p-recurring-order-card').filter({ hasText: /executions/i }).first();
    if (await recurringWithExecutions.count()) {
      await expect(recurringWithExecutions.locator('.p2p-order-chip', { hasText: /executions/i })).toHaveCount(0);
      await expect(recurringWithExecutions.locator('.p2p-recurring-inventory-strip').getByText(/Executions/i)).toBeVisible();
    }

    const firstCardTopGap = await page.locator('.p2p-public-trades-section').evaluate((section) => {
      const header = section.querySelector('.standalone-trades-section-head');
      const firstCard = section.querySelector('.p2p-order-card');
      const headerBox = header?.getBoundingClientRect();
      const cardBox = firstCard?.getBoundingClientRect();
      return headerBox && cardBox ? cardBox.top - headerBox.bottom : 0;
    });
    expect(firstCardTopGap).toBeLessThanOrEqual(28);

    const primaryButtonMetrics = await oneOffCard.locator('.p2p-offer-open-btn').evaluate((button) => {
      const buttonBox = button.getBoundingClientRect();
      return {
        buttonWidth: buttonBox.width,
        text: button.textContent?.trim() ?? ''
      };
    });
    expect(primaryButtonMetrics.text).toMatch(/^(Buy|Sell|Open|Manage)\b/);
    expect(primaryButtonMetrics.text).not.toMatch(/->|\u2192/);
    expect(primaryButtonMetrics.buttonWidth).toBeGreaterThan(120);
    await expect(desk.locator('.p2p-order-card-footer .p2p-offer-open-btn svg, .p2p-order-card-footer .p2p-offer-manage-btn svg')).toHaveCount(0);
    const footerButtonMetrics = await desk.locator('.p2p-order-card').evaluateAll((cards) => {
      const readButton = (button: Element | null) => {
        if (!button) {
          return null;
        }
        const style = window.getComputedStyle(button);
        const buttonBox = button.getBoundingClientRect();
        return {
          alignItems: style.alignItems,
          borderRadius: style.borderRadius,
          display: style.display,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          height: Math.round(buttonBox.height),
          justifyContent: style.justifyContent,
          lineHeight: style.lineHeight,
          padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`
        };
      };

      return cards.map((card) => ({
        open: readButton(card.querySelector('.p2p-offer-open-btn, .p2p-offer-manage-btn')),
        share: readButton(card.querySelector('.p2p-offer-share-btn'))
      }));
    });
    const firstFooterButtons = footerButtonMetrics[0];
    expect(firstFooterButtons.open).not.toBeNull();
    expect(firstFooterButtons.share).not.toBeNull();
    for (const metrics of footerButtonMetrics) {
      expect(metrics.open).toEqual(firstFooterButtons.open);
      expect(metrics.share).toEqual(firstFooterButtons.share);
    }

    const largestTokenFooterGap = await desk.locator('.p2p-order-card').evaluateAll((cards) =>
      Math.max(
        ...cards.map((card) => {
          const token = card.querySelector('.p2p-order-token-actions');
          const footer = card.querySelector('.p2p-order-card-footer');
          const tokenBox = token?.getBoundingClientRect();
          const footerBox = footer?.getBoundingClientRect();
          return tokenBox && footerBox ? footerBox.top - tokenBox.bottom : 0;
        })
      )
    );
    expect(largestTokenFooterGap).toBeLessThanOrEqual(24);

    const compactCardMetrics = await desk.locator('.p2p-order-card').evaluateAll((cards) =>
      cards.map((card) => {
        const cardBox = card.getBoundingClientRect();
        const footer = card.querySelector('.p2p-order-card-footer');
        const footerBox = footer?.getBoundingClientRect();
        return {
          bottomPad: footerBox ? Math.round(cardBox.bottom - footerBox.bottom) : 0,
          height: Math.round(cardBox.height)
        };
      })
    );
    expect(Math.max(...compactCardMetrics.map((metric) => metric.height))).toBeLessThanOrEqual(340);
    expect(Math.max(...compactCardMetrics.map((metric) => metric.bottomPad))).toBeLessThanOrEqual(14);

    const rowAlignment = await desk.locator('.p2p-order-card').evaluateAll((cards) => {
      const firstRowCards = cards
        .map((card) => {
          const cardTop = card.getBoundingClientRect().top;
          const marketTop = card.querySelector('.p2p-order-market-panel')?.getBoundingClientRect().top ?? 0;
          const detailTop = card.querySelector('.p2p-order-detail-band')?.getBoundingClientRect().top ?? 0;
          const tokenTop = card.querySelector('.p2p-order-token-actions')?.getBoundingClientRect().top ?? 0;
          return { cardTop, marketTop, detailTop, tokenTop };
        })
        .filter((entry) => entry.marketTop > 0);
      const top = Math.min(...firstRowCards.map((entry) => entry.cardTop));
      const rowCards = firstRowCards.filter((entry) => Math.abs(entry.cardTop - top) <= 4);
      const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
      return {
        market: spread(rowCards.map((entry) => entry.marketTop)),
        detail: spread(rowCards.map((entry) => entry.detailTop)),
        token: spread(rowCards.map((entry) => entry.tokenTop))
      };
    });
    expect(rowAlignment.market).toBeLessThanOrEqual(2);
    expect(rowAlignment.detail).toBeLessThanOrEqual(2);
    expect(rowAlignment.token).toBeLessThanOrEqual(2);

    const manageButton = desk.getByRole('button', { name: /Manage/ }).first();
    if (await manageButton.count()) {
      await expect(manageButton).toBeVisible();
      await manageButton.click();
      await expect(page.locator('.p2p-terminal-shell')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.p2p-public-trade-grid .p2p-maker-inline-actions')).toHaveCount(0);
    }

    const oneOffPriceBefore = await oneOffCard.locator('.p2p-order-market-panel strong').textContent();
    await oneOffCard.locator('.p2p-order-market-panel').click();
    await expect(oneOffCard.locator('.p2p-order-market-panel strong')).not.toHaveText(oneOffPriceBefore ?? '');

    const buyLabelBefore = await recurringCard.locator('.p2p-recurring-price-buy > span').textContent();
    const sellLabelBefore = await recurringCard.locator('.p2p-recurring-price-sell > span').textContent();
    const buyPriceBefore = await recurringCard.locator('.p2p-recurring-price-buy strong').textContent();
    const sellPriceBefore = await recurringCard.locator('.p2p-recurring-price-sell strong').textContent();
    expect(parseLeadingPrice(sellPriceBefore)).toBeLessThanOrEqual(parseLeadingPrice(buyPriceBefore));
    await recurringCard.locator('.p2p-recurring-price-card').click();
    await expect(recurringCard.locator('.p2p-recurring-price-buy > span')).not.toHaveText(buyLabelBefore ?? '');
    await expect(recurringCard.locator('.p2p-recurring-price-sell > span')).not.toHaveText(sellLabelBefore ?? '');
    await expect(recurringCard.locator('.p2p-recurring-price-buy strong')).not.toHaveText(buyPriceBefore ?? '');
    await expect(recurringCard.locator('.p2p-recurring-price-sell strong')).not.toHaveText(sellPriceBefore ?? '');
    const buyPriceAfter = await recurringCard.locator('.p2p-recurring-price-buy strong').textContent();
    const sellPriceAfter = await recurringCard.locator('.p2p-recurring-price-sell strong').textContent();
    expect(parseLeadingPrice(sellPriceAfter)).toBeLessThanOrEqual(parseLeadingPrice(buyPriceAfter));

    const footerSpread = await desk.locator('.p2p-order-card').evaluateAll((cards) => {
      const firstRowCards = cards
        .map((card) => {
          const cardBox = card.getBoundingClientRect();
          const footer = card.querySelector('.p2p-order-card-footer');
          const footerBox = footer?.getBoundingClientRect();
          return footerBox ? { cardTop: cardBox.top, footerTop: footerBox.top } : null;
        })
        .filter((entry): entry is { cardTop: number; footerTop: number } => Boolean(entry));
      const top = Math.min(...firstRowCards.map((entry) => entry.cardTop));
      const rowFooterTops = firstRowCards
        .filter((entry) => Math.abs(entry.cardTop - top) <= 4)
        .map((entry) => entry.footerTop);
      return Math.max(...rowFooterTops) - Math.min(...rowFooterTops);
    });
    expect(footerSpread).toBeLessThanOrEqual(18);
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize(mobileViewport);
    await page.goto('/trades');
    await expect(page.locator('.p2p-public-trade-grid .p2p-order-card').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.p2p-public-trade-grid .p2p-order-token-actions').first()).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalOverflow(page);
  });

  test('renders unified terminal shell with separate history window on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto('/trades');

    const oneOffOpenButton = page
      .locator('.p2p-public-trade-grid .p2p-order-card:not(.p2p-recurring-order-card)')
      .locator('.p2p-offer-open-btn')
      .first();
    await expect(oneOffOpenButton).toBeVisible({ timeout: 30_000 });
    await oneOffOpenButton.click();

    const terminal = page.locator('.p2p-terminal-shell-standard');
    const history = page.locator('.p2p-terminal-history-window');
    const selectedDeskCard = page.locator('.p2p-public-trade-grid .p2p-order-card-selected');
    await expect(selectedDeskCard).toHaveCount(1);
    const selectedCardStyle = await selectedDeskCard.first().evaluate((element) => {
      const style = window.getComputedStyle(element);
      const ringStyle = window.getComputedStyle(element, '::before');
      return {
        backgroundImage: style.backgroundImage,
        borderColor: style.borderColor,
        outlineColor: style.outlineColor,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
        ringBackgroundImage: ringStyle.backgroundImage,
        ringDisplay: ringStyle.display
      };
    });
    expect(selectedCardStyle.backgroundImage).toContain('linear-gradient');
    expect(selectedCardStyle.backgroundImage).toContain('139, 92, 246');
    expect(selectedCardStyle.outlineWidth).toBe('0px');
    expect(selectedCardStyle.boxShadow).toContain('139, 92, 246');
    expect(selectedCardStyle.ringDisplay).toBe('block');
    expect(selectedCardStyle.ringBackgroundImage).toContain('linear-gradient');
    expect(selectedCardStyle.ringBackgroundImage).toContain('139, 92, 246');
    const selectedCardHeaderHeight = await selectedDeskCard
      .locator('.p2p-order-card-head')
      .evaluate((element) => Math.round(element.getBoundingClientRect().height));
    expect(selectedCardHeaderHeight).toBeLessThanOrEqual(46);
    await expect(terminal).toBeVisible({ timeout: 30_000 });
    await expect(terminal.locator('.p2p-terminal-main')).toBeVisible();
    const terminalChrome = await terminal.evaluate((shell) => {
      const readBorder = (selector: string) => {
        const element = shell.querySelector(selector);
        return element ? window.getComputedStyle(element).borderTopColor : '';
      };
      return {
        outer: window.getComputedStyle(shell).borderTopColor,
        market: readBorder('.p2p-terminal-market'),
        price: readBorder('.p2p-terminal-price-card'),
        detail: readBorder('.p2p-terminal-progress, .p2p-terminal-flow'),
        ticket: readBorder('.p2p-terminal-ticket')
      };
    });
    expect(parseColorAlpha(terminalChrome.market)).toBeLessThan(parseColorAlpha(terminalChrome.outer));
    expect(parseColorAlpha(terminalChrome.ticket)).toBeLessThan(parseColorAlpha(terminalChrome.outer));
    expect(parseColorAlpha(terminalChrome.price)).toBeLessThan(parseColorAlpha(terminalChrome.outer));
    expect(parseColorAlpha(terminalChrome.market)).toBeLessThanOrEqual(0.18);
    expect(parseColorAlpha(terminalChrome.ticket)).toBeLessThanOrEqual(0.18);
    expect(parseColorAlpha(terminalChrome.price)).toBeLessThanOrEqual(0.16);
    expect(parseColorChroma(terminalChrome.market)).toBeLessThan(parseColorChroma(terminalChrome.outer));
    expect(parseColorChroma(terminalChrome.ticket)).toBeLessThan(parseColorChroma(terminalChrome.outer));
    if (terminalChrome.detail) {
      expect(parseColorAlpha(terminalChrome.detail)).toBeLessThanOrEqual(0.16);
      expect(parseColorChroma(terminalChrome.detail)).toBeLessThan(parseColorChroma(terminalChrome.outer));
    }
    await expect(terminal.locator('.p2p-terminal-history-desktop')).toHaveCount(0);
    const standardHeaderTags = terminal.locator('.p2p-terminal-head .p2p-terminal-tag-row');
    await expect(standardHeaderTags).toContainText(/(P2P|Private|Direct) OTC #\d+/);
    await expect(standardHeaderTags.locator('.p2p-offer-status')).toBeVisible();
    await expect(terminal.locator('.p2p-terminal-head p')).toHaveCount(0);
    await expect(terminal.locator('.p2p-terminal-stat-grid')).not.toContainText('Remaining');
    await expect(terminal.locator('.p2p-terminal-stat-grid')).not.toContainText('Expires');
    const terminalFlow = terminal.locator('.p2p-terminal-flow');
    if ((await terminalFlow.count()) > 0) {
      await expect(terminalFlow).toContainText('You sell');
      await expect(terminalFlow).toContainText('You buy');
      await expect(terminalFlow).not.toContainText(/Seller sells|Buyer pays/);
    } else {
      await expect(terminal.locator('.p2p-terminal-progress-flow')).toContainText(/You sell|You buy/);
      await expect(terminal.locator('.p2p-terminal-progress-flow')).not.toContainText(/Seller sells|Buyer pays/);
    }
    if ((await terminal.locator('.p2p-terminal-tag-row', { hasText: /Private liquidity|Hybrid liquidity/ }).count()) > 0) {
      await expect(terminal.locator('.p2p-terminal-stat-grid')).not.toContainText(/Private link|Private order/);
    }
    await expect(history).toBeVisible();
    await expect(history.locator('.p2p-terminal-history-head')).toContainText('Your history');
    await expect(history).toContainText('Created');
    await expect(history).toContainText(/(P2P|Private|Direct) OTC #\d+ opened/);
    const historyRows = history.locator('.p2p-terminal-history-row');
    const historyCount = Number((await history.locator('.p2p-terminal-history-head > span').last().textContent()) ?? '0');
    expect(historyCount).toBe(await historyRows.count());
    const historyHeadStyle = await history.locator('.p2p-terminal-history-head').evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        backgroundImage: style.backgroundImage,
        boxShadow: style.boxShadow,
        marginTop: style.marginTop,
        position: style.position
      };
    });
    expect(historyHeadStyle.position).toBe('sticky');
    expect(historyHeadStyle.backgroundImage).not.toBe('none');
    expect(historyHeadStyle.boxShadow).not.toBe('none');
    expect(historyHeadStyle.marginTop).toBe('0px');
    const historyHeadMetrics = await history.locator('.p2p-terminal-history-head').evaluate((head) => {
      const box = head.getBoundingClientRect();
      const titleBlock = head.querySelector('div');
      const titleStyle = titleBlock ? window.getComputedStyle(titleBlock) : null;
      return {
        display: titleStyle?.display,
        height: box.height
      };
    });
    expect(historyHeadMetrics.display).toBe('flex');
    expect(historyHeadMetrics.height).toBeLessThanOrEqual(36);
    if (await historyRows.count()) {
      const rowMetrics = await historyRows.first().evaluate((row) => {
        const box = row.getBoundingClientRect();
        const firstCell = row.querySelector('div');
        const firstCellStyle = firstCell ? window.getComputedStyle(firstCell) : null;
        return {
          borderTopWidth: firstCellStyle?.borderTopWidth,
          height: box.height
        };
      });
      expect(rowMetrics.height).toBeLessThanOrEqual(54);
      expect(rowMetrics.borderTopWidth).toBe('0px');
    }
    const sellAmountInput = terminal.locator('.p2p-terminal-input-field', { hasText: /You sell/i }).locator('input');
    const buyAmountInput = terminal.locator('.p2p-terminal-input-field', { hasText: /You buy/i }).locator('input');
    await expect(sellAmountInput).toBeVisible();
    await expect(buyAmountInput).toBeVisible();
    await expect(terminal.getByText('Order limit')).toHaveCount(0);
    await expect(terminal.locator('.p2p-terminal-primary-action')).toBeVisible();
    await sellAmountInput.fill('1');
    await expect(buyAmountInput).not.toHaveValue('');
    await buyAmountInput.fill('1');
    await expect(sellAmountInput).not.toHaveValue('');

    const marketBox = await terminal.locator('.p2p-terminal-market').boundingBox();
    const ticketBox = await terminal.locator('.p2p-terminal-ticket').boundingBox();
    const terminalPaneBox = await page.locator('.standalone-trade-detail-section').boundingBox();
    const deskBox = await page.locator('.p2p-public-trades-section').boundingBox();
    const shellBox = await page.locator('.p2p-trading-shell-drawer-open').boundingBox();
    const historyBox = await history.boundingBox();
    const balanceDockBox = await page.locator('.p2p-balance-dock').boundingBox();
    const viewport = page.viewportSize();
    expect(marketBox).not.toBeNull();
    expect(ticketBox).not.toBeNull();
    expect(terminalPaneBox).not.toBeNull();
    expect(deskBox).not.toBeNull();
    expect(shellBox).not.toBeNull();
    expect(historyBox).not.toBeNull();
    expect(balanceDockBox).not.toBeNull();
    expect(ticketBox!.y).toBeGreaterThan(marketBox!.y + marketBox!.height - 2);
    expect(historyBox!.y).toBeGreaterThanOrEqual(deskBox!.y + deskBox!.height - 2);
    expect(historyBox!.y).toBeGreaterThanOrEqual(terminalPaneBox!.y + terminalPaneBox!.height - 2);
    expect(historyBox!.x).toBeLessThanOrEqual(shellBox!.x + 20);
    expect(historyBox!.width).toBeGreaterThan(shellBox!.width - 40);
    expect(balanceDockBox!.x).toBeLessThanOrEqual(shellBox!.x + 20);
    expect(balanceDockBox!.width).toBeGreaterThan(shellBox!.width - 40);
    expect(balanceDockBox!.y).toBeGreaterThanOrEqual(historyBox!.y + historyBox!.height - 2);
    expect(deskBox!.y + deskBox!.height).toBeLessThanOrEqual(historyBox!.y + 2);
    expect(terminalPaneBox!.y + terminalPaneBox!.height).toBeLessThanOrEqual(historyBox!.y + 2);
    expect(historyBox!.y + historyBox!.height).toBeLessThanOrEqual((viewport?.height ?? 950) + 1);

    const scrollState = await page.evaluate(() => {
      const read = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) {
          return null;
        }
        const style = window.getComputedStyle(element);
        return {
          overflowY: style.overflowY,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        };
      };

      return {
        shell: read('.p2p-trading-shell-drawer-open'),
        desk: read('.p2p-public-trades-section'),
        terminal: read('.standalone-trade-detail-section'),
        history: read('.p2p-terminal-history-window'),
      };
    });
    expect(scrollState.shell?.overflowY).toBe('hidden');
    expect(['auto', 'scroll']).toContain(scrollState.desk?.overflowY);
    expect(['auto', 'scroll']).toContain(scrollState.terminal?.overflowY);
    expect(['auto', 'scroll']).toContain(scrollState.history?.overflowY);
    expect(scrollState.desk!.clientHeight).toBeLessThanOrEqual(scrollState.desk!.scrollHeight);
    expect(scrollState.terminal!.clientHeight).toBeLessThanOrEqual(scrollState.terminal!.scrollHeight);
    expect(scrollState.history!.clientHeight).toBeLessThanOrEqual(scrollState.history!.scrollHeight);
    await expectNoHorizontalOverflow(page);
  });

  test('respects reduced motion for trading polish effects', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/trades');

    const firstCard = page.locator('.p2p-public-trade-grid .p2p-order-card').first();
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

  test('keeps private order history in the terminal history window', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto('/otc/order/recurring/5');

    const history = page.locator('.p2p-terminal-history-window');
    await expect(history).toBeVisible({ timeout: 30_000 });
    await expect(history).toContainText('Recurring OTC #5 opened');
    await expect(history.locator('.p2p-terminal-history-row')).toHaveCount(1);
    await expect(history.locator('.p2p-terminal-history-empty').getByRole('button', { name: /Reveal.*history/i })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test('keeps trading filters compact and recurring terminal liquidity status scannable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto('/trades');

    const overviewBox = await page.locator('.p2p-market-overview').boundingBox();
    expect(overviewBox).not.toBeNull();
    expect(overviewBox!.height).toBeLessThanOrEqual(112);

    const scrollStyle = await page.locator('.p2p-public-trades-section').evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        scrollbarColor: style.scrollbarColor,
        scrollbarWidth: style.scrollbarWidth,
      };
    });
    expect(scrollStyle.scrollbarWidth).toBe('thin');
    expect(scrollStyle.scrollbarColor).toContain('139');

    await page.goto('/trades/mine');
    const mineOverviewBox = await page.locator('.p2p-market-overview').boundingBox();
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
      const deskTypeFilter = page.locator('.p2p-filter-type select');
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
    await expect(recurringHeaderTags).toContainText(/Recurring OTC #\d+/);
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
    const recurringHistory = page.locator('.p2p-terminal-history-window');
    await expect(recurringHistory).toContainText('Your history');
    const recurringHistoryRows = recurringHistory.locator('.p2p-terminal-history-row');
    const recurringHistoryCount = Number(
      (await recurringHistory.locator('.p2p-terminal-history-head > span').last().textContent()) ?? '0'
    );
    expect(recurringHistoryCount).toBeGreaterThanOrEqual(1);
    await expect(recurringHistoryRows).toHaveCount(recurringHistoryCount);
    await expect(recurringHistory).toContainText(/Recurring OTC #\d+ opened/);
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
    await expect(page.getByRole('tab', { name: /Active: [1-9]\d*/ })).toBeVisible({ timeout: 45_000 });
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
            const priceBox = card.querySelector<HTMLElement>('.p2p-order-market-panel')?.getBoundingClientRect();
            const footerBox = card.querySelector<HTMLElement>('.p2p-order-card-footer')?.getBoundingClientRect();
            return {
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
            priceSpread: priceTops.length ? Math.max(...priceTops) - Math.min(...priceTops) : 0
          };
        });
        if (firstRowAlignment.cards > 1) {
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
      await expect(page.locator('.p2p-terminal-history-window')).toBeVisible();
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
          scrolled: after > before,
          sectionRight: sectionBox.right,
          sectionOverflowY: window.getComputedStyle(section).overflowY,
          terminalLeft: terminalBox.left,
          workspaceOverflowY: window.getComputedStyle(workspace).overflowY
        };
      });
      expect(myTradesScroll).not.toBeNull();
      expect(['auto', 'scroll']).toContain(myTradesScroll!.sectionOverflowY);
      expect(myTradesScroll!.groupsOverflowY).toBe('visible');
      expect(myTradesScroll!.workspaceOverflowY).toBe('visible');
      expect(myTradesScroll!.terminalLeft - myTradesScroll!.sectionRight).toBeLessThanOrEqual(16);
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

  test('opens My Trades terminal drawer and mobile history sheet from desk cards', async ({ page }) => {
    await page.setViewportSize(mobileViewport);
    await installMockTradingWallet(page, sampleRecurringMakerAddress);
    await page.goto('/trades/mine');
    await page.locator('.top-header-mobile-wallet .wallet-primary-action').click();

    const tabs = page.getByRole('tab');
    await expect(tabs.first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('tab', { name: /Active: [1-9]\d*/ })).toBeVisible({ timeout: 45_000 });
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
    await expect(page.locator('.p2p-terminal-history-window')).toBeHidden();
    await page.locator('.standalone-trade-detail-section .p2p-terminal-mobile-history-trigger').click();
    const sheet = page.locator('.p2p-terminal-history-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.p2p-terminal-history-sheet-head')).toContainText('Your history');
    await expect(sheet.getByRole('button', { name: 'Close' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
  });
});
