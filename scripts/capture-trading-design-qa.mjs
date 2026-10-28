/* global document, window */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.CW_DESIGN_QA_BASE_URL ?? 'http://127.0.0.1:4173';
const outputDir = path.resolve('design-audit', 'qa-captures');

const desktopViewport = { width: 1486, height: 1059 };
const mobileViewport = { width: 414, height: 863 };
const requiredViewports = [
  { width: 320, height: 800 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 640, height: 512 },
  { width: 768, height: 1024 },
  { width: 834, height: 1194 },
  { width: 1280, height: 800 },
  { width: 1440, height: 1024 },
  { width: 1536, height: 1024 }
];
const mockWalletAddress = '0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d';
const cotiChainIdHex = '0x282b34';
const dexChainIdHex = '0x6c11a0';

const installMockWallet = async (page, { privacyReady = false, privacyUnlockDelayMs = 0 } = {}) => {
  await page.addInitScript(({ address, chainIdHex, dexChainIdHex, privacyReady, privacyUnlockDelayMs }) => {
    const listeners = new Map();
    const snapId = 'npm:@coti-io/coti-snap';
    const installedSnaps = { [snapId]: {} };
    const provider = {
      isMetaMask: true,
      selectedAddress: address,
      request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
        if (method === 'eth_chainId') return window.location.pathname.startsWith('/dex') ? dexChainIdHex : chainIdHex;
        if (method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts', caveats: [] }];
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
        if (method === 'wallet_getSnaps') return privacyReady ? installedSnaps : null;
        if (method === 'wallet_requestSnaps') {
          if (privacyUnlockDelayMs) await new Promise((resolve) => window.setTimeout(resolve, privacyUnlockDelayMs));
          return privacyReady || privacyUnlockDelayMs ? installedSnaps : null;
        }
        if (method === 'wallet_invokeSnap') {
          const snapMethod = params?.request?.method;
          if (snapMethod === 'connect-to-wallet' || snapMethod === 'has-aes-key') return true;
          if (snapMethod === 'get-aes-key') return 'design-qa-owner-aes';
          return true;
        }
        return null;
      },
      on: (eventName, handler) => {
        const handlers = listeners.get(eventName) ?? new Set();
        handlers.add(handler);
        listeners.set(eventName, handlers);
      },
      removeListener: (eventName, handler) => listeners.get(eventName)?.delete(handler)
    };
    Object.defineProperty(window, 'ethereum', { configurable: true, value: provider });
  }, { address: mockWalletAddress, chainIdHex: cotiChainIdHex, dexChainIdHex, privacyReady, privacyUnlockDelayMs });
};

const installMockVisualViewport = async (page) => {
  await page.addInitScript(() => {
    const listeners = new Map();
    let mockHeight = window.innerHeight;
    const visualViewport = {
      get width() { return window.innerWidth; },
      get height() { return mockHeight; },
      get offsetLeft() { return 0; },
      get offsetTop() { return 0; },
      get pageLeft() { return 0; },
      get pageTop() { return 0; },
      get scale() { return 1; },
      addEventListener: (eventName, handler) => {
        const handlers = listeners.get(eventName) ?? new Set();
        handlers.add(handler);
        listeners.set(eventName, handlers);
      },
      removeEventListener: (eventName, handler) => listeners.get(eventName)?.delete(handler),
      dispatchEvent: (event) => {
        for (const handler of listeners.get(event.type) ?? []) handler(event);
        return true;
      }
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
    window.__setDesignQaVisualViewportHeight = (nextHeight) => {
      mockHeight = nextHeight;
      visualViewport.dispatchEvent(new Event('resize'));
    };
  });
};

const connectMockWallet = async (page) => {
  const connect = page.locator('.wallet-primary-action:visible').first();
  if (await connect.count() && /connect/i.test(await connect.innerText())) {
    await connect.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForFunction(() => {
      const button = Array.from(document.querySelectorAll('.wallet-primary-action'))
        .find((candidate) => candidate.getBoundingClientRect().width > 0);
      return Boolean(button && !/connect/i.test(button.textContent ?? ''));
    }, undefined, { timeout: 15_000 });
  }
};

const captureState = async (page, name, { resetScroll = true } = {}) => {
  await page.mouse.move(1, 1);
  if (resetScroll) {
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      for (const selector of ['.app-main', '.dex-v2-page', '.standalone-trades-shell', '.p2p-trade-workspace-panel']) {
        const element = document.querySelector(selector);
        if (element) element.scrollTop = 0;
      }
    });
  }
  await page.evaluate(() => new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  }));
  await page.waitForTimeout(200);
  await page.screenshot({
    path: path.join(outputDir, `${name}.png`),
    animations: 'disabled',
    fullPage: false
  });
  return page.evaluate(() => ({
    bodyHeight: document.body.scrollHeight,
    bodyWidth: document.body.scrollWidth,
    clientHeight: document.documentElement.clientHeight,
    clientWidth: document.documentElement.clientWidth,
    path: window.location.pathname,
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    title: document.title
  }));
};

const openDex = async (page) => {
  await page.goto(`${baseURL}/dex?designQa=approved-positions`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('.dex-v2-page').waitFor({ state: 'visible', timeout: 60_000 });
  await connectMockWallet(page);
  await page.waitForTimeout(1_500);
};

const openP2P = async (page, { privacyReady = false, privacyUnlocking = false, offersState = '' } = {}) => {
  const privacyQa = privacyReady ? '&privacyQa=ready' : privacyUnlocking ? '&privacyQa=unlocking' : '';
  const offersStateQa = offersState ? `&offersState=${encodeURIComponent(offersState)}` : '';
  await page.goto(`${baseURL}/otc/desk?designQa=approved-offers${privacyQa}${offersStateQa}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('.standalone-trades-shell').waitFor({ state: 'visible', timeout: 60_000 });
  await connectMockWallet(page);
  await page.waitForTimeout(2_000);
};

const openP2PPath = async (page, pathname) => {
  await page.goto(`${baseURL}${pathname}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('.standalone-trades-shell').waitFor({ state: 'visible', timeout: 60_000 });
  await connectMockWallet(page);
  await page.waitForTimeout(1_000);
};

const preserveApprovedOffersFixtureOnCurrentRoute = async (page) => {
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('designQa', 'approved-offers');
    url.searchParams.delete('offersState');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new Event('popstate'));
  });
  await page.locator('.standalone-trades-shell').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
};

const assertTradeReviewSemantics = async (page, { expectPrefill = true } = {}) => {
  await expect(page.getByText('Maximum amount: available liquidity fills at this price and the remainder returns.')).toBeVisible();
  await expect(page.getByText('Review the amount and price before confirming in your wallet.')).toHaveCount(0);
  await expect(page.locator('.p2p-terminal-context-summary.is-private')).toBeVisible();
  if (expectPrefill) {
    await expect(page.locator('.p2p-terminal-input-field-sell input')).toHaveValue('124');
    await expect(page.locator('.p2p-terminal-input-field-buy input')).toHaveValue('500');
  }
  await expect(page.getByText('Anyone with the private link can fill this offer while it remains open.')).toBeVisible();
  await expect(page.locator('.p2p-terminal-amount-grid .p2p-terminal-field-head small', { hasText: 'Unlock' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Switch network', exact: true })).toBeVisible();
  const offerDetails = page.locator('.p2p-terminal-details');
  const offerDetailsSummary = offerDetails.locator('> summary');
  await expect(offerDetailsSummary).toContainText('Offer details');
  await expect(offerDetailsSummary.locator('svg')).toHaveCount(1);
  await offerDetailsSummary.click();
  await expect(offerDetails).toHaveAttribute('open', '');
  await offerDetailsSummary.click();
  await expect(offerDetails).not.toHaveAttribute('open', '');
};

const assertSharedPriceOrientation = async (page) => {
  const captures = {};
  const ratio = page.locator('.trading-market-ratio strong');
  await expect(page.getByRole('button', { name: /Reverse price display/ })).toHaveCount(1);
  await expect(page.locator('.p2p-offers-shared-context')).toHaveCount(0);
  await expect(page.locator('.p2p-filter-pair')).toHaveCount(0);
  await expect(ratio).toContainText('1 cwTPB = 1.0000 cwTPQ');
  await expect(page.locator('.p2p-swap-side-switch').getByRole('tab', { name: 'Buy', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('I want to buy', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reverse price display to 1 cwTPQ priced in cwTPB' }).click();
  await expect(ratio).toContainText('1 cwTPQ = 1.0000 cwTPB');
  await expect(page.locator('.p2p-swap-side-switch').getByRole('tab', { name: 'Sell', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('I want to sell', { exact: true })).toBeVisible();
  await expect(page.locator('.p2p-offers-amount strong')).toContainText('cwTPQ');
  await expect(page.getByRole('textbox', { name: 'Sell amount' })).toHaveValue('124');
  await expect(page.locator('.p2p-offers-market-row strong')).toContainText('4.0486 cwTPB');
  captures.p2pOffersRatioReversedDesktop = await captureState(page, 'p2p-offers-ratio-reversed-desktop');
  expect(await ratio.evaluate((element) => window.getComputedStyle(element).animationName)).toBe('cw-ratio-flip');
  expect(await page.locator('.p2p-offers-market-row').evaluate((element) => window.getComputedStyle(element, '::before').backgroundImage)).toContain('linear-gradient');

  await page.locator('.p2p-swap-side-switch').getByRole('tab', { name: 'Buy', exact: true }).click();
  await expect(page.locator('.p2p-swap-side-switch').getByRole('tab', { name: 'Buy', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(ratio).toContainText('1 cwTPQ = 1.0000 cwTPB');

  await page.locator('.p2p-market-tabs').getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('.trade-compose-panel').waitFor({ state: 'visible' });
  await expect(page.locator('.trade-compose-price-field .trade-compose-field-value')).toContainText('cwTPB per cwTPQ');
  const createDirection = page.locator('.trade-compose-direction-control');
  await expect(createDirection.getByRole('tab', { name: 'Buy cwTPQ', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.trade-compose-panel .trade-token-select-trigger')).toHaveCount(0);
  await expect(page.locator('.trade-compose-panel .trade-compose-amount-input-shell')).toHaveCount(2);
  await createDirection.getByRole('tab', { name: 'Sell cwTPQ', exact: true }).click();
  await expect(createDirection.getByRole('tab', { name: 'Sell cwTPQ', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(ratio).toContainText('1 cwTPQ = 1.0000 cwTPB');
  await createDirection.getByRole('tab', { name: 'Buy cwTPQ', exact: true }).click();

  await page.locator('.trading-product-switch').getByRole('button', { name: 'DEX', exact: true }).click();
  await page.locator('.dex-v2-page').waitFor({ state: 'visible', timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Reverse swap direction' })).toHaveCount(0);
  await expect(page.locator('.dex-v2-token-select')).toHaveCount(0);
  await expect(page.locator('.dex-market-chart')).toContainText('cwTPB per cwTPQ');
  expect(await page.locator('.dex-market-chart .recharts-errorBar').count()).toBeGreaterThanOrEqual(40);
  await expect(page.locator('.dex-v2-composer-heading h1')).toHaveText('Sell cwTPQ');
  await expect(page.locator('.dex-v2-composer-heading p')).toHaveText('Current action: Spend cwTPQ and receive cwTPB.');
  await expect(page.locator('.dex-v2-buy-sell-tabs').getByRole('tab', { name: 'Sell', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.dex-v2-form-column').getByText('Minimum price', { exact: true })).toBeVisible();
  await expect(page.locator('.dex-v2-form-column')).toContainText('0.9920 cwTPB per cwTPQ');
  captures.dexSwapRatioReversedDesktop = await captureState(page, 'dex-swap-ratio-reversed-desktop');
  await page.locator('.dex-v2-buy-sell-tabs').getByRole('tab', { name: 'Buy', exact: true }).click();
  await expect(page.locator('.dex-v2-composer-heading h1')).toHaveText('Buy cwTPQ');
  await expect(page.locator('.dex-v2-composer-heading p')).toHaveText('Current action: Spend cwTPB and receive cwTPQ.');
  await expect(page.locator('.dex-v2-form-column').getByText('Maximum price', { exact: true })).toBeVisible();
  await expect(page.locator('.dex-v2-form-column')).toContainText('1.0020 cwTPB per cwTPQ');
  await expect(ratio).toContainText('1 cwTPQ = 1.0000 cwTPB');
  captures.dexSwapRatioReversedBuyDesktop = await captureState(page, 'dex-swap-ratio-reversed-buy-desktop');
  await page.getByRole('tab', { name: 'Strategies', exact: true }).click();
  await expect(page.locator('.dex-market-chart')).toContainText('cwTPB per cwTPQ');
  await page.locator('.dex-v2-strategy-nav').getByRole('tab', { name: 'Limit', exact: true }).click();
  await expect(page.locator('.dex-v2-limit-composer .dex-v2-buy-sell-tabs').getByRole('tab', { name: 'Sell cwTPQ', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.dex-v2-limit-composer h1')).toHaveText('Sell cwTPQ');
  await expect(page.locator('.dex-v2-limit-price-summary')).toContainText('1 cwTPQ = 0.9950 cwTPB');
  await expect(page.locator('.dex-v2-limit-composer')).toContainText('Fund cwTPQ and receive cwTPB');
  await page.locator('.dex-v2-strategy-nav').getByRole('tab', { name: 'Recurring', exact: true }).click();
  const reversedRecurring = page.locator('.dex-v2-recurring-composer');
  await expect(reversedRecurring).toContainText('Sell cwTPQ');
  await expect(reversedRecurring).toContainText('Buy cwTPQ');
  await reversedRecurring.getByRole('button', { name: 'Review private recurring', exact: true }).click();
  const reversedRecurringReview = page.getByRole('dialog', { name: 'Review private recurring' });
  await expect(reversedRecurringReview).toContainText('Sell inventory');
  await expect(reversedRecurringReview).toContainText('900 cwTPQ');
  await expect(reversedRecurringReview).toContainText('Buy budget');
  await expect(reversedRecurringReview).toContainText('897.30 cwTPB');
  await reversedRecurringReview.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('tab', { name: 'Positions', exact: true }).click();
  await expect(page.locator('.dex-v2-positions-shell > .dex-market-chart')).toHaveCount(0);
  await expect(ratio).toContainText('1 cwTPQ = 1.0000 cwTPB');
  await page.getByRole('button', { name: 'Reverse price display to 1 cwTPB priced in cwTPQ' }).click();
  await expect(ratio).toContainText('1 cwTPB = 1.0000 cwTPQ');
  return captures;
};

const assertReducedMotionFallback = async (page) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openP2P(page);
  await page.getByRole('button', { name: 'Reverse price display to 1 cwTPQ priced in cwTPB' }).click();
  const animationName = await page.locator('.trading-ratio-value').evaluate((element) => window.getComputedStyle(element).animationName);
  expect(animationName).toBe('none');
};

const assertPositionsHierarchy = async (page, {
  testCreateNavigation = false,
  testRatioOrientation = false,
  testMobileSelectionFlow = false
  } = {}) => {
  const workspace = page.locator('.dex-v2-positions-workspace');
  await expect(workspace.getByRole('heading', { name: 'Your positions' })).toBeVisible();
  await expect(workspace.getByText(/positions? across all pairs/)).toBeVisible();
  await expect(workspace.getByRole('group', { name: 'Position pair scope' }).getByRole('button', { name: 'All positions', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.dex-v2-positions-shell > .dex-market-chart')).toHaveCount(0);
  await expect(workspace.locator('.dex-v2-positions-toolbar')).not.toContainText('cwTPB / cwTPQ');
  await expect(workspace.locator('.dex-v2-positions-meta')).not.toContainText('Prices ·');
  await expect(workspace.locator('.dex-v2-positions-meta')).toContainText('Ownership synced');
  await expect(workspace.getByText(/Ownership synced · block/)).toHaveCount(0);
  await expect(workspace.getByText('Activated deployment', { exact: true })).toHaveCount(0);
  await expect(workspace.getByRole('button', { name: 'Create position', exact: true })).toBeVisible();
  const lifecycle = workspace.getByRole('tablist', { name: 'Position lifecycle' });
  const terminalView = workspace.getByRole('tablist', { name: 'Position terminal view' });
  await expect(lifecycle.getByRole('tab', { name: /Active/ })).toHaveAttribute('aria-selected', 'true');
  await expect(workspace.getByRole('group', { name: 'Position type filter' })).toBeVisible();
  await expect(workspace.locator('.dex-v2-position-row.selected')).toHaveCount(1);
  await expect(workspace.getByLabel('Selected position terminal')).toContainText('Pool position #12');
  await expect(workspace.locator('.dex-v2-position-transfer')).toHaveCount(1);
  await expect(workspace.getByLabel('Position transfer recipient')).toBeHidden();
  await terminalView.getByRole('tab', { name: 'Activity', exact: true }).click();
  const activityPanel = workspace.getByRole('tabpanel', { name: 'Position activity' });
  await expect(activityPanel).toContainText('Position activity');
  await expect(activityPanel.getByLabel('Current position status')).toContainText('Lifecycle now');
  await expect(activityPanel.getByText('Recorded history', { exact: true })).toBeVisible();
  await expect(activityPanel.getByText('Position created', { exact: true })).toBeVisible();
  await expect(activityPanel).toContainText('Finalized block 9066041');
  await expect(activityPanel).toContainText('Closed and transferred history will appear when the lifecycle index is available.');
  await terminalView.getByRole('tab', { name: 'Overview', exact: true }).click();
  await workspace.getByRole('button', { name: /Limit position #18/ }).click();
  await expect(workspace.getByLabel('Selected position terminal')).toContainText('Limit position #18');
  await expect(workspace.locator('.dex-v2-position-transfer')).toHaveCount(1);
  if (testMobileSelectionFlow) {
    const mobileDock = page.locator('.dex-v2-page > .dex-v2-mode-nav');
    await expect(mobileDock).toBeVisible();
    await expect(mobileDock.getByRole('tab', { name: 'Positions', exact: true })).toHaveAttribute('aria-selected', 'true');
    const mobileDockMetrics = await mobileDock.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        position: window.getComputedStyle(element).position,
        bottomGap: window.innerHeight - rect.bottom,
        height: rect.height
      };
    });
    expect(mobileDockMetrics.position).toBe('fixed');
    expect(Math.abs(mobileDockMetrics.bottomGap)).toBeLessThanOrEqual(1);
    expect(mobileDockMetrics.height).toBeGreaterThanOrEqual(47);
    const terminal = workspace.getByLabel('Selected position terminal');
    await expect(terminal).toBeFocused();
    await expect(terminal.getByRole('button', { name: 'Back to positions' })).toBeVisible();
    const terminalBox = await terminal.boundingBox();
    expect(terminalBox).toBeTruthy();
    expect(terminalBox.y).toBeGreaterThanOrEqual(120);
    expect(terminalBox.y).toBeLessThan(200);
  }

  if (testRatioOrientation) {
    await page.getByRole('button', { name: 'Reverse price display to 1 cwTPQ priced in cwTPB' }).click();
    await expect(page.locator('.trading-ratio-value')).toContainText('1 cwTPQ = 1.0000 cwTPB');
    await expect(workspace.locator('.dex-v2-position-row').first()).toContainText('cwTPQ / cwTPB');
    await page.getByRole('button', { name: 'Reverse price display to 1 cwTPB priced in cwTPQ' }).click();
    await expect(page.locator('.trading-ratio-value')).toContainText('1 cwTPB = 1.0000 cwTPQ');
  }

  if (testCreateNavigation) {
    await workspace.getByRole('button', { name: 'Create position', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Strategies', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.dex-v2-strategy-nav').getByRole('tab', { name: 'Pool', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Positions', exact: true }).click();
  }
};

const assertLimitHierarchy = async (page, { mobile = false } = {}) => {
  const composer = page.locator('.dex-v2-limit-composer');
  const direction = composer.getByRole('tablist', { name: 'Limit direction' });
  const ratio = page.locator('.trading-ratio-value');
  await expect(composer.getByText('Private Limit', { exact: true })).toBeVisible();
  await expect(composer.getByRole('heading', { name: 'Buy cwTPB' })).toBeVisible();
  await expect(direction.getByRole('tab', { name: 'Buy cwTPB', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(composer.locator('.dex-v2-limit-price-summary')).toContainText('1 cwTPB = 1.0050 cwTPQ');
  await expect(composer.locator('.dex-v2-limit-price-summary')).toContainText('0.50% above market');
  const limitPriceInput = composer.getByLabel('Limit price', { exact: true });
  await limitPriceInput.fill('1.0125');
  await expect(limitPriceInput).toHaveValue('1.0125');
  await limitPriceInput.blur();
  await expect(limitPriceInput).toHaveValue('1.0125');
  await expect(composer.locator('.dex-v2-limit-price-summary')).toContainText('1 cwTPB = 1.0125 cwTPQ');
  await limitPriceInput.fill('1.0050');
  await limitPriceInput.blur();

  await direction.getByRole('tab', { name: 'Sell cwTPB', exact: true }).click();
  await expect(composer.getByRole('heading', { name: 'Sell cwTPB' })).toBeVisible();
  await expect(composer).toContainText('Fund cwTPB and receive cwTPQ');
  await expect(ratio).toContainText('1 cwTPB = 1.0000 cwTPQ');
  await direction.getByRole('tab', { name: 'Buy cwTPB', exact: true }).click();

  if (mobile) {
    const [composerBox, chartBox] = await Promise.all([
      composer.boundingBox(),
      page.locator('.dex-v2-strategies-shell > .dex-market-chart').boundingBox()
    ]);
    expect(composerBox).toBeTruthy();
    expect(chartBox).toBeTruthy();
    expect(composerBox.y).toBeLessThan(chartBox.y);
  }
};

const assertP2PCreateAndHistoryBoundaries = async (page) => {
  await openP2PPath(page, '/otc/limit');
  await expect(page.locator('.p2p-wallet-privacy-direct')).toHaveAttribute('aria-label', /Unlock privacy|Privacy ready/);
  const createPanel = page.locator('.standalone-trade-create-panel:visible');
  const access = createPanel.locator('.p2p-trade-access-workspace:visible').first();
  const audience = access.locator('[role="group"][aria-label="Offer audience"]:visible');
  const publicOffer = audience.locator('button:visible').filter({ hasText: 'Public offer' });
  const privateLink = audience.locator('button:visible').filter({ hasText: 'Private link' });
  const directProposal = audience.locator('button:visible').filter({ hasText: 'Direct proposal' });
  await expect(createPanel.getByRole('heading', { name: 'Create P2P offer', exact: true })).toBeVisible();
  await expect(createPanel.getByText('Set access, price, and amounts for one fixed-price offer.', { exact: true })).toHaveCount(0);
  await expect(publicOffer).toHaveAttribute('aria-pressed', 'true');
  await expect(createPanel.getByText('Access is separate from whether the order amounts are public or private.')).toHaveCount(0);
  await expect(createPanel.locator('.trade-compose-warning:visible')).toHaveCount(0);
  await expect(createPanel.locator('.trade-compose-direction-control').getByRole('tab', { name: 'Sell cwTPB', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(createPanel.locator('.trade-token-select-trigger')).toHaveCount(0);
  await expect(createPanel.locator('.trade-compose-amount-input-shell')).toHaveCount(2);
  const [audienceBox, publicBox, directBox] = await Promise.all([
    audience.boundingBox(),
    publicOffer.boundingBox(),
    directProposal.boundingBox()
  ]);
  expect(audienceBox).toBeTruthy();
  expect(publicBox).toBeTruthy();
  expect(directBox).toBeTruthy();
  expect(directBox.x + directBox.width - publicBox.x).toBeGreaterThan(audienceBox.width * 0.9);
  await expect(createPanel.locator('.p2p-create-section-heading > p')).toContainText(
    'Enter any two values.'
  );
  await expect(createPanel.locator('.trade-compose-price-field .trade-compose-field-value')).toHaveText('cwTPQ per cwTPB');
  report.captures.p2pCreatePublicDesktop = await captureState(page, 'p2p-create-public-desktop');

  const createPrice = createPanel.locator('.trade-compose-price-field input');
  const createSellAmount = createPanel.locator('.trade-compose-section-sell .trade-compose-amount-field input');
  const createBuyAmount = createPanel.locator('.trade-compose-section-buy .trade-compose-amount-field input');
  await createPrice.fill('0.25');
  await createSellAmount.fill('500');
  await expect(createBuyAmount).toHaveValue('125');
  await expect(createPanel.locator('.trade-compose-section-buy .trade-compose-pricing-state')).toHaveText('Calculated');
  await expect(createBuyAmount).toHaveAttribute('aria-describedby', /-terms-help$/);
  report.captures.p2pCreateFilledDesktop = await captureState(page, 'p2p-create-filled-desktop');

  await openP2PPath(page, '/otc/limit');
  await expect(publicOffer).toHaveAttribute('aria-pressed', 'true');

  await createPanel.locator('.trade-compose-advanced-options > summary').click();
  await expect(createPanel.locator('.trade-compose-advanced-options .trade-compose-warning:visible')).toContainText('Before signing:');
  await createPanel.locator('.trade-compose-advanced-options > summary').click();

  await privateLink.click();
  await expect(access.locator('.standalone-trade-access-summary')).toHaveCount(0);
  await expect(access.locator('.p2p-private-link-readiness')).toHaveCount(0);
  await expect(createPanel.locator('button:visible').filter({ hasText: 'Private link contract pending' })).toBeDisabled();
  await expect(createPanel.locator('.trade-compose-readiness')).toContainText('Private-link design is ready');
  report.captures.p2pCreatePrivateLinkDesktop = await captureState(page, 'p2p-create-private-link-desktop');

  await directProposal.click();
  const recipient = access.locator('.p2p-direct-recipient:visible input');
  await expect(recipient).toBeVisible();
  await recipient.fill('0x1111111111111111111111111111111111111111');
  await expect(access.locator('.standalone-trade-access-summary')).toHaveCount(0);
  report.captures.p2pCreateDirectDesktop = await captureState(page, 'p2p-create-direct-desktop');

  await page.getByRole('tab', { name: 'Recurring', exact: true }).click();
  await expect(createPanel.getByRole('heading', { name: 'Create recurring strategy', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Recurring P2P order' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Recurring order structure' })).toHaveCount(0);
  await expect(createPanel.locator('.p2p-recurring-pair-picker')).toHaveCount(0);
  await expect(createPanel.locator('.p2p-recurring-builder .trade-token-select-trigger')).toHaveCount(0);
  await expect(createPanel.locator('.p2p-recurring-side-panel .trade-compose-input:visible')).toHaveCount(4);
  await expect(createPanel.locator('.p2p-recurring-primary-field .trade-compose-max')).toHaveCount(2);
  await expect(createPanel.locator('.p2p-recurring-receive-preview')).toHaveCount(2);
  await expect(createPanel.locator('.p2p-recurring-primary-field')).toContainText(['Available:', 'Receive']);
  await expect(createPanel.locator('.p2p-recurring-side-panel').nth(0)).toContainText('Sell cwTPB');
  await expect(createPanel.locator('.p2p-recurring-side-panel').nth(1)).toContainText('Buy cwTPB');
  await page.getByRole('button', { name: /^Reverse price display to/ }).click();
  await expect(createPanel.locator('.p2p-recurring-side-panel').nth(0)).toContainText('Buy cwTPQ');
  await expect(createPanel.locator('.p2p-recurring-side-panel').nth(1)).toContainText('Sell cwTPQ');
  await page.getByRole('button', { name: /^Reverse price display to/ }).click();
  await expect(page.getByText('Create reusable two-sided P2P liquidity.', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Create reusable two-sided OTC liquidity.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Private-token amount visibility' }).getByRole('button', { name: 'Private liquidity' })).toHaveAttribute('aria-pressed', 'true');
  const recurringSidePanels = page.locator('.p2p-recurring-side-panel:visible');
  await expect(recurringSidePanels).toHaveCount(2);
  const recurringSidePanelBoxes = await recurringSidePanels.evaluateAll((panels) =>
    panels.map((panel) => panel.getBoundingClientRect().width)
  );
  expect(Math.abs(recurringSidePanelBoxes[0] - recurringSidePanelBoxes[1])).toBeLessThanOrEqual(2);
  for (let index = 0; index < 2; index += 1) {
    const metrics = await recurringSidePanels.nth(index).evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }));
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
  }
  report.captures.p2pCreateRecurringDesktop = await captureState(page, 'p2p-create-recurring-desktop');

  await openP2PPath(page, '/otc/orders');
  const groups = page.getByRole('tablist', { name: 'Trade lifecycle' });
  for (const name of ['Active', 'History']) {
    const tab = groups.getByRole('tab', { name: new RegExp(`^${name}:`) });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: `${name} trades` })).toBeVisible();
  }
  await groups.getByRole('tab', { name: /^Active:/ }).click();
  await expect(page.getByRole('group', { name: 'Active trade filters' })).toContainText('Incoming 0');
  await expect(page.getByRole('tabpanel', { name: 'Active trades' }).getByText('No active trades', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('tabpanel', { name: 'Active trades' }).locator('.p2p-wallet-trade-empty')).toHaveCount(1);
  await expect(page.locator('.p2p-my-trades-section').getByRole('button', { name: 'New offer', exact: true })).toHaveCount(1);
  await expect(page.locator('.p2p-my-trades-section').getByRole('button', { name: 'Create offer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Trade pair scope' })).toBeVisible();
};

const openPopulatedP2PMyTrades = async (page) => {
  await openP2PPath(page, '/otc/orders?designQa=approved-offers');
  await expect(page.locator('.p2p-market-overview-mine .p2p-filter-bar')).toHaveCount(0);
  await expect(page.locator('.p2p-my-trades-section .p2p-filter-bar')).toContainText('Search trades');
  await expect(page.locator('.p2p-market-overview-mine .p2p-stats-strip')).toHaveCount(0);
  const lifecycle = page.getByRole('tablist', { name: 'Trade lifecycle' });
  await expect(lifecycle.getByRole('tab', { name: 'Active: 2' })).toHaveAttribute('aria-selected', 'true');
  await expect(lifecycle.getByRole('tab', { name: 'History: 2' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Active trade filters' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Active trade filters' })).toContainText('Incoming 1');
  await expect(page.getByRole('group', { name: 'Active trade filters' })).toContainText('Made by me 1');
  await expect(page.locator('.p2p-wallet-trade-grid .p2p-order-card')).toHaveCount(2);
  return lifecycle;
};

const openFirstP2PManagedTrade = async (page) => {
  const firstTrade = page.locator('.p2p-wallet-trade-grid .p2p-order-card').first();
  await expect(firstTrade).toContainText('cwTPQ');
  await expect(firstTrade).toContainText('cwTPB');
  const openAction = firstTrade.locator('.p2p-offer-open-btn, .p2p-offer-manage-btn').first();
  await expect(openAction).toBeVisible();
  await openAction.click();
  await expect(page.locator('.p2p-trading-shell-drawer-open')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to my trades' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Trade terminal view' })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'Trade overview' })).toBeVisible();
};

const assertPopulatedMyTradesDesktopHierarchy = async (page) => {
  const groups = page.locator(
    '.p2p-wallet-trade-group > .p2p-management-group-block'
  );
  await expect(groups).toHaveCount(2);
  const [receivedBox, makerBox] = await Promise.all([
    groups.nth(0).boundingBox(),
    groups.nth(1).boundingBox()
  ]);
  expect(receivedBox).toBeTruthy();
  expect(makerBox).toBeTruthy();
  expect(Math.abs(receivedBox.y - makerBox.y)).toBeLessThanOrEqual(2);
  expect(receivedBox.width).toBeGreaterThanOrEqual(320);
  expect(makerBox.width).toBeGreaterThanOrEqual(320);
  expect(receivedBox.x + receivedBox.width).toBeLessThanOrEqual(makerBox.x + 1);
  const cards = page.locator(
    '.p2p-wallet-trade-group > .p2p-management-group-block .p2p-order-card'
  );
  for (let index = 0; index < (await cards.count()); index += 1) {
    const marketPanel = cards.nth(index).locator('.p2p-order-market-panel');
    const priceValue = marketPanel.locator('.p2p-price-label');
    await expect(priceValue).toBeVisible();
    const [panelBox, priceBox] = await Promise.all([
      marketPanel.boundingBox(),
      priceValue.boundingBox()
    ]);
    expect(panelBox).toBeTruthy();
    expect(priceBox).toBeTruthy();
    expect(priceBox.y + priceBox.height).toBeLessThanOrEqual(
      panelBox.y + panelBox.height + 1
    );
    const detailPanel = cards.nth(index).locator('.p2p-order-detail-band');
    await expect(detailPanel).toBeVisible();
    expect(
      await detailPanel.evaluate(
        (element) => element.scrollHeight <= element.clientHeight + 1
      )
    ).toBe(true);
  }
  const managementViewport = page.locator(
    '.p2p-my-trades-section .p2p-wallet-trade-groups'
  );
  const actions = page.locator(
    '.p2p-wallet-trade-group > .p2p-management-group-block .p2p-order-card-footer button'
  );
  await expect(actions).toHaveCount(4);
  const viewportBox = await managementViewport.boundingBox();
  expect(viewportBox).toBeTruthy();
  for (let index = 0; index < (await actions.count()); index += 1) {
    const actionBox = await actions.nth(index).boundingBox();
    expect(actionBox).toBeTruthy();
    expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(
      viewportBox.y + viewportBox.height + 1
    );
  }
};

const assertAttachedTradeActivityLayout = async (page) => {
  const panel = page.getByRole('tabpanel', { name: 'Trade activity' });
  const headerLabel = panel.locator('.p2p-terminal-history-head > div > span').first();
  const headerTitle = panel.locator('.p2p-terminal-history-head > div > strong').first();
  const eventLabel = panel.locator('.p2p-terminal-history-event > span').first();
  const eventTitle = panel.locator('.p2p-terminal-history-event > strong').first();
  const [headerLabelBox, headerTitleBox, eventLabelBox, eventTitleBox] = await Promise.all([
    headerLabel.boundingBox(),
    headerTitle.boundingBox(),
    eventLabel.boundingBox(),
    eventTitle.boundingBox()
  ]);
  expect(headerLabelBox).toBeTruthy();
  expect(headerTitleBox).toBeTruthy();
  expect(eventLabelBox).toBeTruthy();
  expect(eventTitleBox).toBeTruthy();
  expect(headerLabelBox.y + headerLabelBox.height).toBeLessThanOrEqual(headerTitleBox.y + 1);
  expect(eventLabelBox.y + eventLabelBox.height).toBeLessThanOrEqual(eventTitleBox.y + 1);
  await expect(headerLabel).toHaveText('Trade activity');
  await expect(panel.locator('.p2p-terminal-history-head > span')).toHaveText(/\d+ events?/);
  const [panelBox, lastEventBox] = await Promise.all([
    panel.boundingBox(),
    panel.locator('.p2p-terminal-history-row').last().boundingBox()
  ]);
  expect(panelBox).toBeTruthy();
  expect(lastEventBox).toBeTruthy();
  expect(panelBox.y + panelBox.height - (lastEventBox.y + lastEventBox.height)).toBeLessThanOrEqual(20);
  if (page.viewportSize()?.width <= 700) {
    expect(panelBox.height).toBeLessThanOrEqual(220);
  }
};

const assertP2PDirectLinkHistory = async (page) => {
  await openP2P(page);
  await page.locator('.p2p-offer-rate-row-private').click();
  await page.locator('.standalone-trade-detail-section').waitFor({ state: 'visible', timeout: 15_000 });
  await expect(page).toHaveURL(/\/otc\/order\/link\/VgBc/);
  await page.goBack();
  await expect(page).toHaveURL(/\/otc\/desk/);
  await expect(page.getByRole('heading', { name: 'Offers' })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/otc\/order\/link\/VgBc/);
  await expect(page.locator('.standalone-trade-detail-section')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Trade review' })).toBeVisible();

  await page.goto(`${baseURL}/otc/order/link/VgBc?designQa=approved-offers`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('.standalone-trade-detail-section').waitFor({ state: 'visible', timeout: 15_000 });
  await assertTradeReviewSemantics(page, { expectPrefill: false });
};

const openP2PTradeActionState = async (page, actionState) => {
  await page.goto(
    `${baseURL}/otc/order/link/VgBc?designQa=approved-offers&actionState=${encodeURIComponent(actionState)}`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 }
  );
  await page.locator('.standalone-trade-detail-section').waitFor({ state: 'visible', timeout: 15_000 });
  await preserveApprovedOffersFixtureOnCurrentRoute(page);
  const notice = page.locator(`.p2p-action-notice-${actionState}`);
  await expect(notice).toBeVisible();
  return notice;
};

const assertMobileTradeActionDoesNotCoverFields = async (page) => {
  const [amountGridBox, primaryActionBox] = await Promise.all([
    page.locator('.p2p-terminal-amount-grid').boundingBox(),
    page.locator('.p2p-terminal-primary-action').boundingBox()
  ]);
  expect(amountGridBox).toBeTruthy();
  expect(primaryActionBox).toBeTruthy();
  expect(primaryActionBox.y).toBeGreaterThanOrEqual(amountGridBox.y + amountGridBox.height);
};

const assertMobileKeyboardBehavior = async (page) => {
  await openP2PPath(page, '/otc/limit');
  const priceInput = page.locator('.trade-compose-price-field input');
  await priceInput.focus();
  await page.evaluate(() => window.__setDesignQaVisualViewportHeight(window.innerHeight - 240));
  await expect(page.locator('.p2p-trading-shell')).toHaveClass(/p2p-keyboard-open/);
  await expect(page.locator('.p2p-secondary-nav-mobile')).toBeHidden();
  await page.evaluate(() => window.__setDesignQaVisualViewportHeight(window.innerHeight));
  await priceInput.blur();
  await expect(page.locator('.p2p-trading-shell')).not.toHaveClass(/p2p-keyboard-open/);
  await expect(page.locator('.p2p-secondary-nav-mobile')).toBeVisible();

  await page.goto(`${baseURL}/dex?designQa=approved-positions`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('tab', { name: 'Positions', exact: true }).click();
  const dexDock = page.locator('.dex-v2-page > .dex-v2-mode-nav');
  await expect(dexDock).toBeVisible();
  await page.locator('.dex-v2-position-transfer').first().getByText('Transfer position', { exact: true }).click();
  const transferInput = page.getByLabel('Position transfer recipient');
  await transferInput.focus();
  await page.evaluate(() => window.__setDesignQaVisualViewportHeight(window.innerHeight - 240));
  await expect(page.locator('.dex-v2-page')).toHaveClass(/dex-v2-keyboard-open/);
  await expect(dexDock).toBeHidden();
  await page.evaluate(() => window.__setDesignQaVisualViewportHeight(window.innerHeight));
  await transferInput.blur();
  await expect(page.locator('.dex-v2-page')).not.toHaveClass(/dex-v2-keyboard-open/);
  await expect(dexDock).toBeVisible();
};

const measureResponsiveState = async (page) => page.evaluate(() => {
  const mobileDock = document.querySelector('.p2p-secondary-nav-mobile');
  const dockStyle = mobileDock ? window.getComputedStyle(mobileDock) : null;
  const dockRect = mobileDock?.getBoundingClientRect();
  const pairLabel = document.querySelector('.trading-market-pair strong');
  const ratioLabel = document.querySelector('.trading-market-ratio strong');
  const ratioReverseButton = document.querySelector('.trading-market-ratio button');
  const ratioReverseRect = ratioReverseButton?.getBoundingClientRect();
  const ratioReverseEffectiveTarget = Boolean(
    ratioReverseButton
    && ratioReverseRect
    && ratioReverseRect.width >= 44
    && ratioReverseRect.height >= 44
  );
  return {
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    mobileDockVisible: Boolean(dockRect && dockRect.width > 0 && dockRect.height > 0),
    mobileDockPosition: dockStyle?.position ?? null,
    mobileDockBottom: dockStyle?.bottom ?? null,
    pairLabelFits: Boolean(pairLabel && pairLabel.scrollWidth <= pairLabel.clientWidth + 1),
    ratioLabelFits: Boolean(ratioLabel && ratioLabel.scrollWidth <= ratioLabel.clientWidth + 1),
    ratioReverseEffectiveTarget,
    ratioReverseVisualHeight: ratioReverseRect?.height ?? 0,
    ratioReverseVisualWidth: ratioReverseRect?.width ?? 0,
    viewportFitCover: document.querySelector('meta[name="viewport"]')?.getAttribute('content')?.includes('viewport-fit=cover') ?? false
  };
});

const assertSharedHeaderConsistency = async (page, variant) => {
  const routes = [
    { name: 'chat', path: '/chat' },
    { name: 'privacy-portal', path: '/portal' },
    { name: 'p2p', path: '/otc/desk?designQa=approved-offers' },
    { name: 'dex', path: '/dex?designQa=approved-positions' }
  ];
  const routeMetrics = {};

  for (const route of routes) {
    await page.goto(`${baseURL}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.locator('.app-shell-wallet .top-header').waitFor({ state: 'visible', timeout: 60_000 });
    await connectMockWallet(page);
    const panel = page.locator('.top-header .wallet-header-panel-connected:visible');
    await expect(panel.locator('.wallet-primary-action'), `${route.name} compact wallet address`).toHaveText(
      variant === 'mobile' ? '0x5d\u2026979d' : '0x5dfc\u2026979d'
    );
    await panel.waitFor({ state: 'visible', timeout: 15_000 });
    routeMetrics[route.name] = await panel.evaluate((element) => {
      const readRect = (target) => {
        const rect = target.getBoundingClientRect();
        return {
          height: Math.round(rect.height * 100) / 100,
          left: Math.round(rect.left * 100) / 100,
          right: Math.round(rect.right * 100) / 100,
          width: Math.round(rect.width * 100) / 100
        };
      };
      const identity = element.querySelector('.p2p-wallet-identity');
      const address = element.querySelector('.wallet-primary-action');
      const addressLabel = address.querySelector('span');
      const privacy = element.querySelector('.p2p-wallet-privacy-direct');
      const menu = element.querySelector('.p2p-wallet-menu-trigger');
      const header = document.querySelector('.top-header');
      const bar = document.querySelector('.top-header-bar');
      const identityStyle = window.getComputedStyle(identity);
      const addressStyle = window.getComputedStyle(address);
      const panelStyle = window.getComputedStyle(element);
      return {
        address: readRect(address),
        addressLabelClientWidth: addressLabel.clientWidth,
        addressLabelScrollWidth: addressLabel.scrollWidth,
        addressBackgroundImage: addressStyle.backgroundImage,
        addressBorderWidth: addressStyle.borderWidth,
        addressBoxShadow: addressStyle.boxShadow,
        barHeight: readRect(bar).height,
        headerHeight: readRect(header).height,
        identityBackgroundImage: identityStyle.backgroundImage,
        identityBorderWidth: identityStyle.borderWidth,
        identityBoxShadow: identityStyle.boxShadow,
        menu: readRect(menu),
        panel: readRect(element),
        panelBorderWidth: panelStyle.borderWidth,
        privacy: readRect(privacy)
      };
    });
    await captureState(page, `shared-header-${route.name}-${variant}`);
  }

  const baseline = routeMetrics.chat;
  for (const [routeName, metrics] of Object.entries(routeMetrics)) {
    expect(metrics.headerHeight, `${routeName} header height`).toBe(baseline.headerHeight);
    expect(metrics.barHeight, `${routeName} header bar height`).toBe(baseline.barHeight);
    expect(metrics.panel.width, `${routeName} wallet width`).toBe(baseline.panel.width);
    expect(metrics.panel.height, `${routeName} wallet height`).toBe(baseline.panel.height);
    expect(metrics.address.width, `${routeName} address width`).toBe(baseline.address.width);
    expect(metrics.addressLabelScrollWidth, `${routeName} address label intrinsic fit`).toBeLessThanOrEqual(
      metrics.addressLabelClientWidth + 1
    );
    expect(metrics.privacy.width, `${routeName} privacy width`).toBe(baseline.privacy.width);
    expect(metrics.menu.width, `${routeName} menu width`).toBe(baseline.menu.width);
    expect(metrics.identityBorderWidth, `${routeName} nested identity border`).toBe('0px');
    expect(metrics.identityBackgroundImage, `${routeName} nested identity background`).toBe('none');
    expect(metrics.identityBoxShadow, `${routeName} nested identity shadow`).toBe('none');
    expect(metrics.addressBorderWidth, `${routeName} nested address border`).toBe('0px');
    expect(metrics.addressBackgroundImage, `${routeName} nested address background`).toBe('none');
    expect(metrics.addressBoxShadow, `${routeName} nested address shadow`).toBe('none');
    expect(metrics.panelBorderWidth, `${routeName} outer wallet border`).toBe('1px');
    expect(Math.abs(metrics.address.right - metrics.privacy.left), `${routeName} address/privacy seam`).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.privacy.right - metrics.menu.left), `${routeName} privacy/menu seam`).toBeLessThanOrEqual(1);
  }

  return routeMetrics;
};

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const report = { baseURL, captures: {}, interactions: {}, responsiveChecks: {}, consoleErrors: [] };

try {
  const desktop = await browser.newPage({ viewport: desktopViewport, deviceScaleFactor: 1 });
  await installMockWallet(desktop);
  desktop.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push({ viewport: 'desktop', text: message.text() });
  });
  desktop.on('pageerror', (error) => report.consoleErrors.push({ viewport: 'desktop', text: error.message }));

  report.headerConsistencyDesktop = await assertSharedHeaderConsistency(desktop, 'desktop');
  report.interactions.sharedHeaderDesktop = 'passed';

  await openDex(desktop);
  const swapComposer = desktop.locator('.dex-v2-form-column');
  const swapReviewButton = swapComposer.locator('.dex-v2-review-button');
  await expect(swapComposer.getByText('Maximum price', { exact: true })).toBeVisible();
  await expect(swapComposer).toContainText('1.0080 cwTPQ per cwTPB');
  await expect(swapComposer).toContainText('indicative execution quote of 1.0030');
  report.captures.dexSwapDesktop = await captureState(desktop, 'dex-swap-desktop');

  await swapReviewButton.click();
  const slippageReview = desktop.getByRole('dialog', { name: 'Review private swap' });
  await expect(slippageReview).toContainText('Preview only — no wallet request');
  await expect(slippageReview).toContainText('Action');
  await expect(slippageReview).toContainText('Buy cwTPB');
  await expect(slippageReview).toContainText('900 cwTPQ');
  await expect(slippageReview).toContainText('897.31 cwTPB');
  await expect(slippageReview).toContainText('1.0080 cwTPQ per cwTPB');
  report.captures.dexSwapSlippageReviewDesktop = await captureState(desktop, 'dex-swap-slippage-review-desktop');
  await slippageReview.getByRole('button', { name: 'Cancel', exact: true }).click();

  await swapComposer.getByRole('button', { name: 'Use exact price limit', exact: true }).click();
  const exactPriceInput = swapComposer.getByLabel('Maximum price in cwTPQ per cwTPB');
  await expect(exactPriceInput).toHaveValue('1.0080');
  await exactPriceInput.fill('1.0050');
  await exactPriceInput.blur();
  await expect(exactPriceInput).toHaveValue('1.0050');
  await expect(swapComposer).toContainText('Equivalent slippage');
  await expect(swapComposer).toContainText('0.20%');
  await expect(swapComposer).toContainText('Protected execution price');
  await expect(swapComposer).toContainText('1.0030 cwTPQ per cwTPB');
  report.captures.dexSwapExactDesktop = await captureState(desktop, 'dex-swap-exact-desktop');

  await expect(swapReviewButton).toBeDisabled();
  await expect(swapComposer).toContainText('Amount exceeds this pair’s reviewed aggregate-lot ceiling.');
  await swapComposer.getByLabel('Spend amount').fill('100');
  await expect(swapReviewButton).toBeEnabled();
  await swapReviewButton.click();
  const exactReview = desktop.getByRole('dialog', { name: 'Review private swap' });
  await expect(exactReview).toContainText('Your wallet is next');
  await expect(exactReview).toContainText('Action');
  await expect(exactReview).toContainText('Buy cwTPB');
  await expect(exactReview).toContainText('100 cwTPQ');
  await expect(exactReview).toContainText('1.0030 cwTPQ per cwTPB');
  await expect(exactReview.getByRole('button', { name: 'Continue to wallet', exact: true })).toBeVisible();
  report.captures.dexSwapExactReviewDesktop = await captureState(desktop, 'dex-swap-exact-review-desktop');
  await exactReview.getByRole('button', { name: 'Cancel', exact: true }).click();
  await swapComposer.getByLabel('Spend amount').fill('900');
  await swapComposer.getByRole('button', { name: 'Use slippage instead', exact: true }).click();

  await swapComposer.locator('.dex-v2-buy-sell-tabs').getByRole('tab', { name: 'Sell', exact: true }).click();
  await expect(swapComposer.getByRole('heading', { name: 'Sell cwTPB' })).toBeVisible();
  await expect(swapComposer.getByText('Minimum price', { exact: true })).toBeVisible();
  await expect(swapComposer).toContainText('0.9980 cwTPQ per cwTPB');
  report.captures.dexSwapSellDesktop = await captureState(desktop, 'dex-swap-sell-desktop');
  await swapComposer.locator('.dex-v2-buy-sell-tabs').getByRole('tab', { name: 'Buy', exact: true }).click();
  report.interactions.dexSwapProtectionHierarchy = 'passed';

  await desktop.getByRole('tab', { name: 'Strategies', exact: true }).click();
  await desktop.getByRole('tab', { name: 'Pool', exact: true }).waitFor({ state: 'visible' });
  const poolComposer = desktop.locator('.dex-v2-pool-composer');
  const poolReviewButton = poolComposer.getByRole('button', { name: 'Review pool design', exact: true });
  await expect(poolComposer.getByLabel('Custom fee tier')).toBeVisible();
  await expect(poolComposer.locator('.dex-v2-pool-amount-tools button', { hasText: 'Max' })).toHaveCount(2);
  await expect(poolComposer.getByText('Selected fee: 0.05%', { exact: true })).toBeVisible();
  report.captures.dexPoolFullDesktop = await captureState(desktop, 'dex-pool-full-desktop');

  await desktop.getByRole('button', { name: '±0.5%', exact: true }).click();
  const presetRangeInputs = desktop.locator('.dex-v2-pool-range-inputs input');
  await presetRangeInputs.nth(0).fill('');
  await presetRangeInputs.nth(0).blur();
  await expect(presetRangeInputs.nth(0)).toHaveValue('0.9950');
  await expect(poolReviewButton).toBeEnabled();
  report.captures.dexPoolPresetDesktop = await captureState(desktop, 'dex-pool-preset-desktop');

  const rangeInputs = desktop.locator('.dex-v2-pool-range-inputs input');
  await rangeInputs.nth(0).fill('0.9770');
  await rangeInputs.nth(0).blur();
  await rangeInputs.nth(1).fill('1.0370');
  await rangeInputs.nth(1).blur();
  const customFeeInput = poolComposer.getByLabel('Custom fee tier');
  await customFeeInput.fill('');
  await expect(poolReviewButton).toBeDisabled();
  await customFeeInput.fill('0.08');
  await expect(poolReviewButton).toBeEnabled();
  await expect(poolComposer.getByText('Custom fee selected.', { exact: true })).toBeVisible();
  report.captures.dexPoolCustomDesktop = await captureState(desktop, 'dex-pool-custom-desktop');

  await desktop.getByRole('button', { name: /^Reverse price display to/ }).click();
  await expect(poolComposer.getByText('cwTPB per cwTPQ', { exact: true })).toBeVisible();
  await expect(poolComposer.getByLabel('Lower price (cwTPB per cwTPQ)')).toHaveValue('0.9643');
  await expect(poolComposer.getByLabel('Upper price (cwTPB per cwTPQ)')).toHaveValue('1.0235');
  report.captures.dexPoolRatioReversedDesktop = await captureState(desktop, 'dex-pool-ratio-reversed-desktop');
  await desktop.getByRole('button', { name: /^Reverse price display to/ }).click();

  await poolReviewButton.click();
  const poolReview = desktop.getByRole('dialog', { name: 'Review pool design' });
  await expect(poolReview).toContainText('Preview only — no wallet request');
  await expect(poolReview).toContainText('0.08%');
  await expect(poolReview).toContainText('900 cwTPQ');
  await expect(poolReview).toContainText('897.30 cwTPB');
  report.captures.dexPoolReviewDesktop = await captureState(desktop, 'dex-pool-review-desktop');
  await poolReview.getByRole('button', { name: 'Cancel', exact: true }).click();
  report.interactions.dexPoolHierarchy = 'passed';

  await desktop.getByRole('tab', { name: 'Limit', exact: true }).click();
  await assertLimitHierarchy(desktop);
  await expect(desktop.locator('.dex-v2-limit-composer .dex-v2-field-tools button', { hasText: 'Max' })).toHaveCount(1);
  report.captures.dexLimitDesktop = await captureState(desktop, 'dex-limit-desktop');
  await desktop.getByRole('button', { name: /^Reverse price display to/ }).click();
  await expect(desktop.locator('.dex-v2-limit-composer').getByRole('heading', { name: 'Sell cwTPQ' })).toBeVisible();
  await expect(desktop.locator('.dex-v2-limit-composer')).toContainText('Fund cwTPQ and receive cwTPB');
  await expect(desktop.locator('.dex-v2-limit-price-summary')).toContainText('1 cwTPQ = 0.9950 cwTPB');
  report.captures.dexLimitRatioReversedDesktop = await captureState(desktop, 'dex-limit-ratio-reversed-desktop');
  await desktop.getByRole('button', { name: /^Reverse price display to/ }).click();
  await desktop.getByRole('button', { name: 'Review private limit', exact: true }).click();
  const limitReview = desktop.getByRole('dialog', { name: 'Review private limit' });
  await expect(limitReview).toBeVisible();
  await expect(limitReview).toContainText('Action');
  await expect(limitReview).toContainText('Buy cwTPB');
  await expect(limitReview).toContainText('Fund');
  await expect(limitReview).toContainText('900 cwTPQ');
  await expect(limitReview).toContainText('Preview only — no wallet request');
  await expect(limitReview).toContainText('At least 25%');
  await expect(limitReview).toContainText('Price + amount private');
  report.captures.dexLimitReviewDesktop = await captureState(desktop, 'dex-limit-review-desktop');
  await limitReview.getByRole('button', { name: 'Cancel', exact: true }).click();
  report.interactions.dexLimitHierarchy = 'passed';

  await desktop.getByRole('tab', { name: 'Recurring', exact: true }).click();
  const recurringPrices = desktop.locator('.dex-v2-recurring-price-grid input');
  await expect(recurringPrices).toHaveCount(2);
  await expect(recurringPrices.nth(0)).toHaveValue('0.9500');
  await expect(recurringPrices.nth(1)).toHaveValue('1.0500');
  report.captures.dexRecurringDefaultDesktop = await captureState(desktop, 'dex-recurring-default-desktop');
  await recurringPrices.nth(0).fill('');
  await recurringPrices.nth(0).press('Enter');
  await expect(recurringPrices.nth(0)).toHaveValue('0.9500');
  await expect(recurringPrices.nth(1)).toHaveValue('1.0500');
  await recurringPrices.nth(1).fill('0.9000');
  await recurringPrices.nth(1).press('Enter');
  await expect(recurringPrices.nth(0)).toHaveValue('0.9500');
  await expect(recurringPrices.nth(1)).toHaveValue('1.0500');
  await expect(recurringPrices.nth(0)).toHaveAttribute('aria-invalid', 'false');
  await expect(recurringPrices.nth(1)).toHaveAttribute('aria-invalid', 'false');
  await recurringPrices.nth(0).fill('0.9400');
  await recurringPrices.nth(1).fill('1.0800');
  await expect(recurringPrices.nth(0)).toHaveValue('0.9400');
  await expect(recurringPrices.nth(1)).toHaveValue('1.0800');
  await expect(desktop.locator('.dex-v2-recurring-composer')).toContainText('Edit either price directly');
  await expect(desktop.locator('.dex-market-chart-legend')).not.toContainText('Active range');
  await expect(desktop.locator('.dex-market-chart-legend')).toContainText('Buy cwTPB');
  await expect(desktop.locator('.dex-market-chart-legend')).toContainText('Sell cwTPB');
  await expect(desktop.locator('.dex-recurring-buy-line')).toHaveCount(1);
  await expect(desktop.locator('.dex-recurring-sell-line')).toHaveCount(1);
  const recurringComposer = desktop.locator('.dex-v2-recurring-composer');
  const recurringInventory = recurringComposer.locator('.dex-v2-recurring-inventory input');
  const recurringReviewButton = recurringComposer.getByRole('button', { name: 'Review private recurring', exact: true });
  await expect(recurringInventory).toHaveCount(2);
  await expect(recurringComposer.locator('.dex-v2-recurring-inventory button', { hasText: 'Max' })).toHaveCount(2);
  await expect(recurringComposer.locator('.dex-v2-recurring-inventory em')).toHaveCount(2);
  await recurringInventory.nth(1).fill('0');
  await expect(recurringReviewButton).toBeEnabled();
  await recurringInventory.nth(0).fill('0');
  await expect(recurringReviewButton).toBeDisabled();
  await recurringInventory.nth(0).fill('900');
  await recurringInventory.nth(1).fill('897.30');
  await expect(recurringReviewButton).toBeEnabled();
  await expect(recurringComposer.getByText(/Reversing the shared price ratio/)).toBeHidden();
  await expect(recurringComposer.getByText(/future range-recurring mode would require four price boundaries/)).toBeHidden();
  report.captures.dexRecurringDesktop = await captureState(desktop, 'dex-recurring-desktop');
  await desktop.getByRole('button', { name: /^Reverse price display to/ }).click();
  await expect(recurringPrices.nth(0)).toHaveValue('1.0638');
  await expect(recurringPrices.nth(1)).toHaveValue('0.9259');
  await expect(recurringComposer.locator('.dex-v2-recurring-price-grid label.sell')).toContainText('Sell cwTPQ');
  await expect(recurringComposer.locator('.dex-v2-recurring-price-grid label.buy')).toContainText('Buy cwTPQ');
  await expect(desktop.locator('.dex-market-chart-legend .recurring-sell')).toContainText('Sell cwTPQ');
  await expect(desktop.locator('.dex-market-chart-legend .recurring-buy')).toContainText('Buy cwTPQ');
  await expect(desktop.locator('.dex-recurring-buy-line line')).toHaveAttribute('stroke', '#ef49c1');
  await expect(desktop.locator('.dex-recurring-sell-line line')).toHaveAttribute('stroke', '#23d399');
  report.captures.dexRecurringRatioReversedDesktop = await captureState(desktop, 'dex-recurring-ratio-reversed-desktop');
  await desktop.getByRole('button', { name: /^Reverse price display to/ }).click();
  await recurringReviewButton.click();
  const recurringReview = desktop.getByRole('dialog', { name: 'Review private recurring' });
  await expect(recurringReview).toContainText('Buy budget');
  await expect(recurringReview).toContainText('900 cwTPQ');
  await expect(recurringReview).toContainText('Sell inventory');
  await expect(recurringReview).toContainText('897.30 cwTPB');
  await expect(recurringReview).toContainText('Preview only — no wallet request');
  await expect(recurringReview).toContainText('Prices + inventory private');
  await expect(recurringReview).toContainText('Not requested');
  await expect(recurringReview.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  report.captures.dexRecurringReviewDesktop = await captureState(desktop, 'dex-recurring-review-desktop');
  await recurringReview.getByRole('button', { name: 'Cancel', exact: true }).click();
  await recurringComposer.locator('.dex-v2-recurring-summary > summary').click();
  await expect(recurringComposer.getByText(/Reversing the shared price ratio/)).toBeVisible();
  await expect(recurringComposer.getByText(/future range-recurring mode would require four price boundaries/)).toBeVisible();
  await recurringComposer.locator('.dex-v2-recurring-summary > summary').click();
  report.interactions.dexRecurringHierarchy = 'passed';

  await desktop.getByRole('tab', { name: 'Positions', exact: true }).click();
  await assertPositionsHierarchy(desktop, { testCreateNavigation: true, testRatioOrientation: true });
  report.captures.dexPositionsDesktop = await captureState(desktop, 'dex-positions-desktop');
  await desktop.getByRole('tablist', { name: 'Position terminal view' }).getByRole('tab', { name: 'Activity', exact: true }).click();
  report.captures.dexPositionsActivityDesktop = await captureState(desktop, 'dex-positions-activity-desktop');
  await desktop.getByRole('tablist', { name: 'Position terminal view' }).getByRole('tab', { name: 'Overview', exact: true }).click();
  await desktop.locator('.dex-v2-position-transfer').first().getByText('Transfer position', { exact: true }).click();
  await expect(desktop.getByLabel('Position transfer recipient').first()).toBeVisible();
  const transferRecipient = desktop.getByLabel('Position transfer recipient').first();
  const reviewTransfer = desktop.getByRole('button', { name: 'Review transfer', exact: true }).first();
  await expect(reviewTransfer).toBeDisabled();
  await transferRecipient.fill('0x1234');
  await expect(transferRecipient).toHaveAttribute('aria-invalid', 'true');
  await expect(desktop.getByText('Enter a valid 42-character 0x wallet address.', { exact: true })).toBeVisible();
  await expect(reviewTransfer).toBeDisabled();
  await transferRecipient.fill(`0x${'12'.repeat(20)}`);
  await expect(transferRecipient).toHaveAttribute('aria-invalid', 'false');
  await expect(reviewTransfer).toBeEnabled();
  report.captures.dexPositionsTransferDesktop = await captureState(desktop, 'dex-positions-transfer-desktop');
  await desktop.locator('.dex-v2-position-transfer').first().getByText('Transfer position', { exact: true }).click();
  report.interactions.dexPositionsHierarchy = 'passed';

  await openP2P(desktop);
  await expect(desktop.getByText('DEX & P2P', { exact: true })).toBeVisible();
  await expect(desktop.getByText('DEX & OTC', { exact: true })).toHaveCount(0);
  Object.assign(report.captures, await assertSharedPriceOrientation(desktop));
  report.interactions.sharedPriceOrientation = 'passed';
  await assertP2PCreateAndHistoryBoundaries(desktop);
  report.interactions.p2pCreateRecurringAndHistory = 'passed';
  await assertP2PDirectLinkHistory(desktop);
  report.interactions.p2pDirectLinkAndBrowserHistory = 'passed';
  await openP2P(desktop);
  await expect(desktop.locator('body')).not.toContainText('One-off OTC');
  await expect(desktop.locator('.p2p-market-overview-public .p2p-stats-strip')).toHaveCount(0);
  await expect(desktop.locator('.p2p-market-overview-public .p2p-filter-bar')).toHaveCount(0);
  await expect(desktop.locator('.p2p-offers-filter-controls')).toBeVisible();
  await expect(desktop.locator('.p2p-offers-filter-summary')).toContainText('3 offers');
  await expect(desktop.locator('.p2p-offer-rate-row')).toHaveCount(3);
  await desktop.getByLabel('Search offers').fill('93');
  await expect(desktop.locator('.p2p-offer-rate-row')).toHaveCount(1);
  await expect(desktop.locator('.p2p-offer-rate-row')).toContainText('Offer #93');
  await expect(desktop.locator('.p2p-offer-rate-row-best')).toHaveCount(1);
  await expect(desktop.locator('.p2p-offers-filter-summary')).toContainText('1 of 3 offers');
  await desktop.locator('.p2p-offers-filter-reset').click();
  await expect(desktop.locator('.p2p-offer-rate-row')).toHaveCount(3);
  report.interactions.offersConnectedFiltersDesktop = 'passed';
  report.captures.p2pOffersDesktop = await captureState(desktop, 'p2p-offers-desktop');
  const desktopMarketChartSummary = desktop.locator('.p2p-offers-chart > summary');
  await desktopMarketChartSummary.click();
  await expect(desktop.locator('.p2p-offers-chart-history-line')).toHaveCount(1);
  await expect(desktop.locator('.p2p-offers-chart-order-line')).toHaveCount(1);
  await expect(desktop.locator('.p2p-offers-chart-legend')).toContainText('Illustrative market history');
  await expect(desktop.locator('.p2p-offers-chart-legend')).toContainText('Selected offer');
  await expect(desktop.locator('.p2p-offers-chart-body')).not.toContainText('not price history');
  report.captures.p2pOffersChartDesktop = await captureState(desktop, 'p2p-offers-chart-desktop', { resetScroll: false });
  await desktopMarketChartSummary.click();
  report.interactions.offersMarketHistoryDesktop = 'passed';
  await desktop.locator('.p2p-offer-rate-row-private').click();
  await desktop.locator('.standalone-trade-detail-section').waitFor({ state: 'visible', timeout: 15_000 });
  await preserveApprovedOffersFixtureOnCurrentRoute(desktop);
  await expect(desktop.locator('.p2p-offer-rate-row')).toHaveCount(3);
  await assertTradeReviewSemantics(desktop);
  report.interactions.privateTradeReviewDesktop = 'passed';
  report.captures.p2pTradeReviewDesktop = await captureState(desktop, 'p2p-trade-review-desktop');
  const desktopTerminalTabs = desktop.getByRole('tablist', { name: 'Trade terminal view' });
  await expect(desktop.locator('.p2p-terminal-history-window')).toHaveCount(0);
  await desktopTerminalTabs.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(desktop.getByRole('tabpanel', { name: 'Trade activity' })).toBeVisible();
  await assertAttachedTradeActivityLayout(desktop);
  report.captures.p2pTradeActivityDesktop = await captureState(desktop, 'p2p-trade-activity-desktop', { resetScroll: false });
  await desktopTerminalTabs.getByRole('tab', { name: 'Overview', exact: true }).click();
  report.interactions.attachedTradeActivityDesktop = 'passed';
  await openP2PPath(desktop, '/otc/limit');
  const desktopCreateAction = desktop.locator('.standalone-trade-create-panel:visible .trade-compose-send');
  await expect(desktopCreateAction).toBeDisabled();
  await expect(desktopCreateAction).toHaveAttribute('title', /Switch to COTI network first\./);
  const desktopCreateDisabledStyle = await desktopCreateAction.evaluate((button) => {
    const style = window.getComputedStyle(button);
    return { backgroundImage: style.backgroundImage, boxShadow: style.boxShadow };
  });
  expect(desktopCreateDisabledStyle.backgroundImage).toBe('none');
  expect(desktopCreateDisabledStyle.boxShadow).toBe('none');
  await expect(desktop.locator('.standalone-trade-create-panel:visible .trade-compose-readiness')).toContainText('Switch to COTI network');
  await expect(desktop.locator('.standalone-trade-create-panel:visible .trade-compose-validation')).toHaveCount(0);
  report.interactions.p2pCreateBlockedActionHonestyDesktop = 'passed';
  await desktopCreateAction.evaluate((button) => button.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await desktop.evaluate(
    () => new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))
  );
  report.captures.p2pCreateBlockedActionDesktop = await captureState(
    desktop,
    'p2p-create-blocked-action-desktop',
    { resetScroll: false }
  );
  report.captures.p2pCreateDesktop = await captureState(desktop, 'p2p-create-desktop');
  await openP2PPath(desktop, '/otc/orders');
  report.captures.p2pMyTradesDesktop = await captureState(desktop, 'p2p-my-trades-desktop');
  const populatedDesktopLifecycle = await openPopulatedP2PMyTrades(desktop);
  await assertPopulatedMyTradesDesktopHierarchy(desktop);
  const desktopMyTradesFilters = desktop.locator('.p2p-my-trades-section .p2p-my-trades-filter-bar');
  await expect(desktopMyTradesFilters.locator('.p2p-filter-search')).toBeVisible();
  await expect(desktopMyTradesFilters.locator('.p2p-advanced-filter-panel')).toBeVisible();
  await expect(desktopMyTradesFilters.locator('.p2p-mobile-filter-toggle')).toBeHidden();
  report.interactions.p2pMyTradesFilterHierarchyDesktop = 'passed';
  report.captures.p2pMyTradesPopulatedDesktop = await captureState(desktop, 'p2p-my-trades-populated-desktop');
  await openFirstP2PManagedTrade(desktop);
  report.captures.p2pMyTradesTerminalDesktop = await captureState(desktop, 'p2p-my-trades-terminal-desktop');
  const populatedDesktopTerminalTabs = desktop.getByRole('tablist', { name: 'Trade terminal view' });
  await populatedDesktopTerminalTabs.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(desktop.getByRole('tabpanel', { name: 'Trade activity' })).toBeVisible();
  report.captures.p2pMyTradesActivityDesktop = await captureState(desktop, 'p2p-my-trades-activity-desktop', { resetScroll: false });
  await desktop.getByRole('button', { name: 'Back to my trades' }).click();
  await expect(desktop.locator('.p2p-trading-shell-drawer-open')).toHaveCount(0);
  await populatedDesktopLifecycle.getByRole('tab', { name: 'History: 2' }).click();
  await expect(desktop.locator('.p2p-wallet-trade-grid .p2p-order-card')).toHaveCount(2);
  await expect(desktop.getByRole('tabpanel', { name: 'History trades' })).toContainText('Accepted');
  await expect(desktop.getByRole('tabpanel', { name: 'History trades' })).toContainText('Cancelled');
  report.captures.p2pMyTradesHistoryDesktop = await captureState(desktop, 'p2p-my-trades-history-desktop');
  report.interactions.p2pMyTradesPopulatedDesktop = 'passed';
  await expect(desktop.locator('.p2p-wallet-menu-trigger')).toHaveCount(1);
  await expect(desktop.locator('.sound-toggle-btn')).toHaveCount(0);
  await desktop.getByRole('button', { name: /Open Wallet menu/ }).click();
  const desktopWalletMenu = desktop.getByRole('menu', { name: 'Wallet' });
  await expect(desktopWalletMenu).toBeVisible();
  await expect(desktopWalletMenu).toContainText('Wallet utilities');
  await expect(desktopWalletMenu).toContainText('Network');
  await expect(desktopWalletMenu).toContainText('Notifications');
  await expect(desktopWalletMenu).toContainText('Help');
  await expect(desktopWalletMenu).toContainText('Disconnect');
  report.captures.desktopWalletUtilities = await captureState(desktop, 'desktop-wallet-utilities', { resetScroll: false });
  report.interactions.singleWalletMoreControl = 'passed';
  await desktop.close();

  const offersStates = await browser.newPage({ viewport: desktopViewport, deviceScaleFactor: 1 });
  await installMockWallet(offersStates);
  offersStates.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push({ viewport: 'offers-states', text: message.text() });
  });
  offersStates.on('pageerror', (error) => report.consoleErrors.push({ viewport: 'offers-states', text: error.message }));

  await openP2P(offersStates, { offersState: 'loading' });
  await expect(offersStates.locator('.p2p-offers-orderbook')).toHaveAttribute('aria-busy', 'true');
  await expect(offersStates.locator('.p2p-offers-empty.is-loading')).toContainText('Loading market and offers');
  report.captures.p2pOffersLoadingDesktop = await captureState(offersStates, 'p2p-offers-loading-desktop');

  await openP2P(offersStates, { offersState: 'error' });
  await expect(offersStates.locator('.p2p-offers-empty.is-error')).toContainText('Offers could not be loaded');
  await expect(offersStates.locator('.p2p-offers-empty.is-error').getByRole('button', { name: 'Try again' })).toBeVisible();
  report.captures.p2pOffersErrorDesktop = await captureState(offersStates, 'p2p-offers-error-desktop');

  await openP2P(offersStates, { offersState: 'empty' });
  await expect(offersStates.locator('.p2p-offers-empty')).toContainText('No offers for this pair yet');
  await expect(offersStates.locator('.p2p-offers-market-row')).toContainText('0.247 cwTPQ');
  report.captures.p2pOffersEmptyDesktop = await captureState(offersStates, 'p2p-offers-empty-desktop');

  await openP2P(offersStates, { offersState: 'no-market' });
  await expect(offersStates.locator('.p2p-offer-rate-row')).toHaveCount(3);
  await expect(offersStates.locator('.p2p-offers-market-row')).toContainText('Unavailable');
  report.captures.p2pOffersNoMarketDesktop = await captureState(offersStates, 'p2p-offers-no-market-desktop');

  await openP2P(offersStates, { offersState: 'stale' });
  await expect(offersStates.locator('.p2p-offers-empty.is-stale')).toContainText('selected offer is no longer available');
  await expect(offersStates.locator('.p2p-offers-empty.is-stale').getByRole('button', { name: 'Clear selected offer' })).toBeVisible();
  report.captures.p2pOffersStaleDesktop = await captureState(offersStates, 'p2p-offers-stale-desktop');

  await openP2P(offersStates);
  await offersStates.getByLabel('Search offers').fill('does-not-exist');
  await expect(offersStates.locator('.p2p-offers-empty.is-filtered')).toContainText('No offers match these filters');
  report.captures.p2pOffersFilteredEmptyDesktop = await captureState(offersStates, 'p2p-offers-filtered-empty-desktop');
  await offersStates.locator('.p2p-offers-empty.is-filtered').getByRole('button', { name: 'Clear filters' }).click();
  await offersStates.getByRole('button', { name: /^Reverse price display to/ }).click();
  await expect(offersStates.locator('.trading-market-ratio strong')).toContainText('1 cwTPQ = 1.0000 cwTPB');
  await offersStates.locator('.p2p-offers-chart > summary').click();
  await expect(offersStates.locator('.p2p-offers-chart-legend')).toContainText('Illustrative market history 4.048583');
  await expect(offersStates.locator('.p2p-offers-chart-legend')).toContainText('Selected offer 4.0322');
  report.captures.p2pOffersChartReversedDesktop = await captureState(offersStates, 'p2p-offers-chart-reversed-desktop', { resetScroll: false });
  report.interactions.offersRequiredStatesDesktop = 'passed';

  const actionStateExpectations = {
    wallet: 'Confirm this action in your wallet',
    pending: 'Confirming on-chain...',
    success: 'Trade filled',
    error: 'Wallet rejected the request. No transaction was submitted.',
    uncertain: 'Transaction submitted, but COTI confirmation timed out. Check wallet activity before retrying.'
  };
  for (const [actionState, expectedCopy] of Object.entries(actionStateExpectations)) {
    const notice = await openP2PTradeActionState(offersStates, actionState);
    await expect(notice).toContainText(expectedCopy);
    if (actionState === 'error' || actionState === 'uncertain') {
      await expect(notice).toHaveAttribute('role', 'alert');
      await expect(notice.getByRole('button', { name: 'Dismiss' })).toBeVisible();
    } else {
      await expect(notice).toHaveAttribute('role', 'status');
    }
    report.captures[`p2pTradeAction${actionState[0].toUpperCase()}${actionState.slice(1)}Desktop`] = await captureState(
      offersStates,
      `p2p-trade-action-${actionState}-desktop`
    );
  }
  report.interactions.p2pExecutionFeedbackStatesDesktop = 'passed';

  await offersStates.setViewportSize({ width: 390, height: 844 });
  await openP2P(offersStates, { offersState: 'error' });
  const mobileRetryOfferButton = offersStates.locator('.p2p-offers-empty.is-error').getByRole('button', { name: 'Try again' });
  expect((await mobileRetryOfferButton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  report.captures.p2pOffersErrorMobile = await captureState(offersStates, 'p2p-offers-error-mobile');
  await openP2P(offersStates, { offersState: 'stale' });
  const mobileClearStaleOfferButton = offersStates.locator('.p2p-offers-empty.is-stale').getByRole('button', { name: 'Clear selected offer' });
  expect((await mobileClearStaleOfferButton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  report.captures.p2pOffersStaleMobile = await captureState(offersStates, 'p2p-offers-stale-mobile');
  report.interactions.offersRecoveryTargetsMobile = 'passed';
  const mobileUncertainNotice = await openP2PTradeActionState(offersStates, 'uncertain');
  const mobileUncertainDismiss = mobileUncertainNotice.getByRole('button', { name: 'Dismiss' });
  expect((await mobileUncertainDismiss.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await assertMobileTradeActionDoesNotCoverFields(offersStates);
  report.captures.p2pTradeActionUncertainMobile = await captureState(offersStates, 'p2p-trade-action-uncertain-mobile');
  report.interactions.p2pExecutionFeedbackRecoveryTargetMobile = 'passed';
  await offersStates.close();

  const mobile = await browser.newPage({ viewport: mobileViewport, deviceScaleFactor: 1 });
  await installMockWallet(mobile);
  mobile.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push({ viewport: 'mobile', text: message.text() });
  });
  mobile.on('pageerror', (error) => report.consoleErrors.push({ viewport: 'mobile', text: error.message }));

  report.headerConsistencyMobile = await assertSharedHeaderConsistency(mobile, 'mobile');
  report.interactions.sharedHeaderMobile = 'passed';

  await openP2P(mobile);
  await expect(mobile.getByText('DEX & P2P', { exact: true })).toHaveCount(1);
  await expect(mobile.getByText('DEX & OTC', { exact: true })).toHaveCount(0);
  await expect(mobile.locator('body')).not.toContainText('One-off OTC');
  const mobileOfferFilterToggle = mobile.getByRole('button', { name: /Search and filter/ });
  await expect(mobileOfferFilterToggle).toBeVisible();
  await expect(mobile.locator('.p2p-offers-filter-controls')).toBeHidden();
  expect((await mobileOfferFilterToggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await mobileOfferFilterToggle.click();
  await expect(mobile.locator('.p2p-offers-filter-controls')).toBeVisible();
  for (const target of [
    mobile.getByLabel('Search offers'),
    mobile.locator('.p2p-offers-filter-type select'),
    mobile.locator('.p2p-offers-filter-reset')
  ]) {
    expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await mobile.getByLabel('Search offers').fill('93');
  await expect(mobile.locator('.p2p-offer-rate-row')).toHaveCount(1);
  await expect(mobile.locator('.p2p-offer-rate-row-best')).toHaveCount(1);
  await mobile.locator('.p2p-offers-filter-reset').click();
  await expect(mobile.locator('.p2p-offer-rate-row')).toHaveCount(3);
  await mobileOfferFilterToggle.click();
  await expect(mobile.locator('.p2p-offers-filter-controls')).toBeHidden();
  report.interactions.offersConnectedFiltersMobile = 'passed';
  report.captures.p2pOffersMobile = await captureState(mobile, 'p2p-offers-mobile');
  const mobileMarketChartSummary = mobile.locator('.p2p-offers-chart > summary');
  expect((await mobileMarketChartSummary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await mobileMarketChartSummary.click();
  await expect(mobile.locator('.p2p-offers-chart-history-line')).toHaveCount(1);
  await expect(mobile.locator('.p2p-offers-chart-order-line')).toHaveCount(1);
  await expect(mobile.locator('.p2p-offers-chart-legend')).toContainText('Illustrative market history');
  await expect(mobile.locator('.p2p-offers-chart-legend')).toContainText('Selected offer');
  await mobile.waitForTimeout(450);
  const mobileChartBodyBox = await mobile.locator('.p2p-offers-chart-body').boundingBox();
  const mobileBottomNavBox = await mobile.locator('.p2p-secondary-nav-mobile').boundingBox();
  expect(mobileChartBodyBox).toBeTruthy();
  expect(mobileBottomNavBox).toBeTruthy();
  expect(mobileChartBodyBox.y).toBeGreaterThanOrEqual(100);
  expect(mobileChartBodyBox.y).toBeLessThan(mobileBottomNavBox.y - 120);
  report.captures.p2pOffersChartMobile = await captureState(mobile, 'p2p-offers-chart-mobile', { resetScroll: false });
  await mobileMarketChartSummary.click();
  report.interactions.offersMarketHistoryMobile = 'passed';
  await mobile.locator('.p2p-offer-rate-row-private').click();
  await mobile.locator('.standalone-trade-detail-section').waitFor({ state: 'visible', timeout: 15_000 });
  await preserveApprovedOffersFixtureOnCurrentRoute(mobile);
  await expect(mobile.locator('.p2p-offer-rate-row')).toHaveCount(3);
  await assertTradeReviewSemantics(mobile);
  for (const target of [
    mobile.locator('.p2p-terminal-input-field-sell input'),
    mobile.locator('.p2p-terminal-input-field-buy input'),
    mobile.locator('.p2p-terminal-primary-action')
  ]) {
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await assertMobileTradeActionDoesNotCoverFields(mobile);
  const mobileTradeReviewDock = mobile.locator('.p2p-secondary-nav-mobile');
  const mobileTradeReviewDockTabs = mobileTradeReviewDock.locator('.p2p-trade-tabs');
  await expect(mobileTradeReviewDock).toBeVisible();
  await expect(mobileTradeReviewDockTabs).toHaveCSS('position', 'fixed');
  await expect(mobileTradeReviewDock.getByRole('button', { name: 'Offers', exact: true })).toHaveAttribute('aria-current', 'page');
  const mobileTradeReviewDockBox = await mobileTradeReviewDockTabs.boundingBox();
  const mobileTradeReviewActionBox = await mobile.locator('.p2p-terminal-primary-action').boundingBox();
  expect(mobileTradeReviewDockBox).toBeTruthy();
  expect(mobileTradeReviewActionBox).toBeTruthy();
  expect(mobileTradeReviewActionBox.y + mobileTradeReviewActionBox.height).toBeLessThanOrEqual(mobileTradeReviewDockBox.y + 1);
  report.interactions.privateTradeReviewMobileTouchTargets = 'passed';
  report.interactions.privateTradeReviewMobileDock = 'passed';
  report.interactions.privateTradeReviewMobile = 'passed';
  report.captures.p2pTradeReviewMobile = await captureState(mobile, 'p2p-trade-review-mobile');
  const mobileTerminalTabs = mobile.getByRole('tablist', { name: 'Trade terminal view' });
  await expect(mobile.locator('.p2p-terminal-mobile-history-trigger')).toHaveCount(0);
  await mobileTerminalTabs.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(mobile.getByRole('tabpanel', { name: 'Trade activity' })).toBeVisible();
  await expect(mobileTradeReviewDock).toBeVisible();
  await assertAttachedTradeActivityLayout(mobile);
  report.captures.p2pTradeActivityMobile = await captureState(mobile, 'p2p-trade-activity-mobile', { resetScroll: false });
  await mobileTerminalTabs.getByRole('tab', { name: 'Overview', exact: true }).click();
  report.interactions.attachedTradeActivityMobile = 'passed';
  await openP2PPath(mobile, '/otc/limit');
  const mobileCreatePanel = mobile.locator('.standalone-trade-create-panel:visible');
  await expect(mobileCreatePanel.getByRole('heading', { name: 'Create P2P offer', exact: true })).toBeVisible();
  const mobileCreateAudienceTargets = await mobile
    .locator('[role="group"][aria-label="Offer audience"] button:visible')
    .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
  expect(mobileCreateAudienceTargets).toHaveLength(3);
  expect(mobileCreateAudienceTargets.every((height) => height >= 44)).toBeTruthy();
  await expect(mobileCreatePanel.locator('.p2p-create-section-heading > p')).toBeHidden();
  await expect(mobileCreatePanel.locator('.trade-compose-price-field .trade-compose-field-value')).toHaveText('cwTPQ per cwTPB');
  const mobileCreateAction = mobileCreatePanel.locator('.trade-compose-send');
  await expect(mobileCreateAction).toBeDisabled();
  await expect(mobileCreateAction).toHaveAttribute('title', /Switch to COTI network first\./);
  const mobileCreateDisabledStyle = await mobileCreateAction.evaluate((button) => {
    const style = window.getComputedStyle(button);
    return { backgroundImage: style.backgroundImage, boxShadow: style.boxShadow };
  });
  expect(mobileCreateDisabledStyle.backgroundImage).toBe('none');
  expect(mobileCreateDisabledStyle.boxShadow).toBe('none');
  await expect(mobileCreatePanel.locator('.trade-compose-readiness')).toContainText('Switch to COTI network');
  await expect(mobileCreatePanel.locator('.trade-compose-validation')).toHaveCount(0);
  report.interactions.p2pCreateBlockedActionHonestyMobile = 'passed';
  report.interactions.p2pCreateMobileTouchTargets = 'passed';
  report.captures.p2pCreateMobile = await captureState(mobile, 'p2p-create-mobile');
  const mobileCreatePrice = mobileCreatePanel.locator('.trade-compose-price-field input');
  const mobileCreateSellAmount = mobileCreatePanel.locator('.trade-compose-section-sell .trade-compose-amount-field input');
  const mobileCreateBuyAmount = mobileCreatePanel.locator('.trade-compose-section-buy .trade-compose-amount-field input');
  await mobileCreatePrice.fill('0.25');
  await mobileCreateSellAmount.fill('500');
  await expect(mobileCreateBuyAmount).toHaveValue('125');
  await expect(mobileCreatePanel.locator('.trade-compose-section-buy .trade-compose-pricing-state')).toHaveText('Calculated');
  await mobileCreateAction.evaluate((button) => button.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await mobile.evaluate(
    () => new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))
  );
  report.captures.p2pCreateFilledMobile = await captureState(mobile, 'p2p-create-filled-mobile', { resetScroll: false });
  report.captures.p2pCreateBlockedActionMobile = await captureState(
    mobile,
    'p2p-create-blocked-action-mobile',
    { resetScroll: false }
  );
  await openP2PPath(mobile, '/otc/limit');
  const mobileAudience = mobileCreatePanel.getByRole('group', { name: 'Offer audience' });
  await mobileAudience.getByRole('button', { name: /Private link/ }).click();
  await expect(mobileCreatePanel.locator('.p2p-private-link-readiness')).toHaveCount(0);
  await expect(mobileCreatePanel.locator('.trade-compose-readiness')).toContainText('Private-link design is ready');
  report.captures.p2pCreatePrivateLinkMobile = await captureState(mobile, 'p2p-create-private-link-mobile');
  await mobileAudience.getByRole('button', { name: /Direct proposal/ }).click();
  await expect(mobileCreatePanel.locator('.p2p-direct-recipient:visible input')).toBeVisible();
  report.captures.p2pCreateDirectMobile = await captureState(mobile, 'p2p-create-direct-mobile');
  await mobile.getByRole('tab', { name: 'Recurring', exact: true }).click();
  await expect(mobileCreatePanel.getByRole('heading', { name: 'Create recurring strategy', exact: true })).toBeVisible();
  await expect(mobileCreatePanel.getByRole('group', { name: 'Recurring order structure' })).toHaveCount(0);
  await expect(mobileCreatePanel.locator('.p2p-recurring-builder')).not.toContainText('cwTPB / cwTPQ');
  await expect(mobileCreatePanel.locator('.p2p-recurring-pair-picker')).toHaveCount(0);
  await expect(mobileCreatePanel.locator('.p2p-recurring-builder .trade-token-select-trigger')).toHaveCount(0);
  await expect(mobileCreatePanel.locator('.p2p-recurring-side-panel .trade-compose-input:visible')).toHaveCount(4);
  report.captures.p2pCreateRecurringMobile = await captureState(mobile, 'p2p-create-recurring-mobile');
  await openP2PPath(mobile, '/otc/orders');
  const mobileMyTradesRefreshHeight = await mobile.locator('.p2p-my-trades-refresh-btn:visible').evaluate((button) => button.getBoundingClientRect().height);
  expect(mobileMyTradesRefreshHeight).toBeGreaterThanOrEqual(44);
  await expect(mobile.getByRole('tabpanel', { name: 'Active trades' }).locator('.p2p-wallet-trade-empty')).toHaveCount(1);
  await expect(mobile.getByRole('group', { name: 'Active trade filters' })).toContainText('Incoming 0');
  await expect(mobile.locator('.p2p-my-trades-section').getByRole('button', { name: /^(New|Create) offer$/ })).toHaveCount(0);
  report.interactions.sharedManagementEmptyHierarchy = 'passed';
  report.captures.p2pMyTradesMobile = await captureState(mobile, 'p2p-my-trades-mobile');
  await openPopulatedP2PMyTrades(mobile);
  const mobileMyTradesFilters = mobile.locator('.p2p-my-trades-section .p2p-my-trades-filter-bar');
  const mobileMyTradesFilterToggle = mobileMyTradesFilters.getByRole('button', { name: /Search & filters/ });
  await expect(mobileMyTradesFilters.locator('.p2p-filter-search')).toBeHidden();
  expect((await mobileMyTradesFilterToggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await mobileMyTradesFilterToggle.click();
  await expect(mobileMyTradesFilters.locator('.p2p-filter-search')).toBeVisible();
  await expect(mobileMyTradesFilters.locator('.p2p-advanced-filter-panel')).toBeVisible();
  const mobileMyTradesFilterControlHeights = await mobileMyTradesFilters
    .locator('input:visible, select:visible, .p2p-filter-clear:visible')
    .evaluateAll((controls) => controls.map((control) => control.getBoundingClientRect().height));
  expect(mobileMyTradesFilterControlHeights.length).toBeGreaterThan(0);
  expect(mobileMyTradesFilterControlHeights.every((height) => height >= 44)).toBeTruthy();
  report.captures.p2pMyTradesFiltersOpenMobile = await captureState(
    mobile,
    'p2p-my-trades-filters-open-mobile',
    { resetScroll: false }
  );
  await mobileMyTradesFilterToggle.click();
  await expect(mobileMyTradesFilters.locator('.p2p-filter-search')).toBeHidden();
  report.interactions.p2pMyTradesFilterHierarchyMobile = 'passed';
  const populatedMobileFirstCard = mobile.locator('.p2p-wallet-trade-grid .p2p-order-card').first();
  await expect(populatedMobileFirstCard.locator('.p2p-order-token-actions')).toBeHidden();
  await expect(populatedMobileFirstCard.locator('.p2p-offer-terms-clear')).toBeHidden();
  const populatedMobileRowActions = populatedMobileFirstCard.locator('.p2p-order-card-footer button:visible');
  const populatedMobileRowActionHeights = await populatedMobileRowActions.evaluateAll((buttons) =>
    buttons.map((button) => button.getBoundingClientRect().height)
  );
  expect(populatedMobileRowActionHeights.length).toBeGreaterThan(0);
  expect(populatedMobileRowActionHeights.every((height) => height >= 44)).toBeTruthy();
  const populatedMobilePrimaryAction = populatedMobileFirstCard.locator('.p2p-offer-open-btn, .p2p-offer-manage-btn').first();
  await populatedMobilePrimaryAction.evaluate((button) => button.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await mobile.evaluate(
    () => new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))
  );
  const [populatedMobileActionBox, populatedMobileDockBox] = await Promise.all([
    populatedMobilePrimaryAction.boundingBox(),
    mobile.locator('.p2p-secondary-nav-mobile:visible').boundingBox()
  ]);
  expect(populatedMobileActionBox).toBeTruthy();
  expect(populatedMobileDockBox).toBeTruthy();
  expect(populatedMobileActionBox.y + populatedMobileActionBox.height).toBeLessThanOrEqual(populatedMobileDockBox.y);
  report.captures.p2pMyTradesPopulatedMobile = await captureState(mobile, 'p2p-my-trades-populated-mobile');
  await openFirstP2PManagedTrade(mobile);
  report.captures.p2pMyTradesTerminalMobile = await captureState(mobile, 'p2p-my-trades-terminal-mobile');
  const mobileBackToMyTrades = mobile.getByRole('button', { name: 'Back to my trades' });
  expect((await mobileBackToMyTrades.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await mobileBackToMyTrades.click();
  await expect(mobile.locator('.p2p-trading-shell-drawer-open')).toHaveCount(0);
  await preserveApprovedOffersFixtureOnCurrentRoute(mobile);
  const returnedMobileLifecycle = mobile.getByRole('tablist', { name: 'Trade lifecycle' });
  await expect(returnedMobileLifecycle).toBeVisible();
  const returnedMobileHistory = returnedMobileLifecycle.getByRole('tab', { name: 'History: 2' });
  await returnedMobileHistory.scrollIntoViewIfNeeded();
  await expect(returnedMobileHistory).toBeVisible();
  const returnedMobileHistoryTarget = await returnedMobileHistory.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      height: rect.height,
      withinViewport: rect.top >= 0 && rect.bottom <= window.innerHeight,
      hitTarget: Boolean(hit && (hit === button || button.contains(hit)))
    };
  });
  expect(returnedMobileHistoryTarget.height).toBeGreaterThanOrEqual(44);
  expect(returnedMobileHistoryTarget.withinViewport).toBeTruthy();
  expect(returnedMobileHistoryTarget.hitTarget).toBeTruthy();
  await returnedMobileHistory.click();
  await expect(mobile.locator('.p2p-wallet-trade-grid .p2p-order-card')).toHaveCount(2);
  const populatedMobileHistoryActionHeights = await mobile
    .locator('.p2p-wallet-trade-grid .p2p-order-card-footer button:visible')
    .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
  expect(populatedMobileHistoryActionHeights.length).toBeGreaterThan(0);
  expect(populatedMobileHistoryActionHeights.every((height) => height >= 44)).toBeTruthy();
  report.captures.p2pMyTradesHistoryMobile = await captureState(mobile, 'p2p-my-trades-history-mobile');
  report.interactions.p2pMyTradesPopulatedMobile = 'passed';

  await openDex(mobile);
  const mobileSwapComposer = mobile.locator('.dex-v2-form-column');
  await expect(mobileSwapComposer).toContainText('1.0080 cwTPQ per cwTPB');
  report.captures.dexSwapMobile = await captureState(mobile, 'dex-swap-mobile');
  await mobileSwapComposer.getByRole('button', { name: 'Use exact price limit', exact: true }).click();
  const mobileExactPriceInput = mobileSwapComposer.getByLabel('Maximum price in cwTPQ per cwTPB');
  await expect(mobileExactPriceInput).toHaveValue('1.0080');
  expect((await mobileExactPriceInput.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  report.captures.dexSwapExactMobile = await captureState(mobile, 'dex-swap-exact-mobile', { resetScroll: false });
  await expect(mobileSwapComposer.locator('.dex-v2-review-button')).toBeDisabled();
  await mobileSwapComposer.getByLabel('Spend amount').fill('100');
  await expect(mobileSwapComposer.locator('.dex-v2-review-button')).toBeEnabled();
  await mobileSwapComposer.locator('.dex-v2-review-button').click();
  const mobileExactReview = mobile.getByRole('dialog', { name: 'Review private swap' });
  await expect(mobileExactReview).toContainText('Your wallet is next');
  await expect(mobileExactReview).toContainText('Buy cwTPB');
  await expect(mobileExactReview).toContainText('1.0030 cwTPQ per cwTPB');
  report.captures.dexSwapExactReviewMobile = await captureState(mobile, 'dex-swap-exact-review-mobile', { resetScroll: false });
  await mobileExactReview.getByRole('button', { name: 'Cancel', exact: true }).click();
  await mobileSwapComposer.getByRole('button', { name: 'Use slippage instead', exact: true }).click();
  await mobile.getByRole('tab', { name: 'Strategies', exact: true }).click();
  await mobile.getByRole('tab', { name: 'Pool', exact: true }).waitFor({ state: 'visible' });
  await expect(mobile.locator('.dex-v2-pool-composer').getByLabel('Custom fee tier')).toBeVisible();
  report.captures.dexPoolMobile = await captureState(mobile, 'dex-pool-mobile');
  await mobile.getByRole('button', { name: '±0.5%', exact: true }).click();
  await expect(mobile.getByLabel('Lower price (cwTPQ per cwTPB)')).toBeVisible();
  await expect(mobile.getByLabel('Upper price (cwTPQ per cwTPB)')).toBeVisible();
  report.captures.dexPoolConcentratedMobile = await captureState(mobile, 'dex-pool-concentrated-mobile');
  await mobile.getByRole('tab', { name: 'Limit', exact: true }).click();
  await assertLimitHierarchy(mobile, { mobile: true });
  for (const target of await mobile.locator('.dex-v2-limit-composer .dex-v2-buy-sell-tabs button').all()) {
    expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  report.captures.dexLimitMobile = await captureState(mobile, 'dex-limit-mobile');
  await mobile.getByRole('tab', { name: 'Recurring', exact: true }).click();
  await expect(mobile.locator('.dex-market-chart-legend')).not.toContainText('Active range');
  await expect(mobile.locator('.dex-recurring-buy-line')).toHaveCount(1);
  await expect(mobile.locator('.dex-recurring-sell-line')).toHaveCount(1);
  const [mobileRecurringComposerBox, mobileRecurringChartBox] = await Promise.all([
    mobile.locator('.dex-v2-recurring-composer').boundingBox(),
    mobile.locator('.dex-v2-strategies-shell > .dex-market-chart').boundingBox()
  ]);
  expect(mobileRecurringComposerBox).toBeTruthy();
  expect(mobileRecurringChartBox).toBeTruthy();
  expect(mobileRecurringComposerBox.y).toBeLessThan(mobileRecurringChartBox.y);
  for (const target of await mobile.locator('.dex-v2-recurring-presets button').all()) {
    expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  for (const target of await mobile.locator('.dex-v2-recurring-price-input, .dex-v2-recurring-inventory input').all()) {
    expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  report.captures.dexRecurringMobile = await captureState(mobile, 'dex-recurring-mobile');
  const mobileRecurringReviewButton = mobile.locator('.dex-v2-recurring-composer').getByRole('button', { name: 'Review private recurring', exact: true });
  await mobileRecurringReviewButton.scrollIntoViewIfNeeded();
  await expect(mobile.locator('.dex-v2-recurring-composer .dex-v2-activation-note')).toContainText('exact-price recurring is not active');
  report.captures.dexRecurringActionsMobile = await captureState(mobile, 'dex-recurring-actions-mobile', { resetScroll: false });
  await mobileRecurringReviewButton.click();
  const mobileRecurringReview = mobile.getByRole('dialog', { name: 'Review private recurring' });
  await expect(mobileRecurringReview).toContainText('Preview only — no wallet request');
  await expect(mobileRecurringReview).toContainText('Prices + inventory private');
  await expect(mobileRecurringReview.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  report.captures.dexRecurringReviewMobile = await captureState(mobile, 'dex-recurring-review-mobile', { resetScroll: false });
  await mobileRecurringReview.getByRole('button', { name: 'Cancel', exact: true }).click();
  await mobile.getByRole('tab', { name: 'Positions', exact: true }).click();
  await mobile.emulateMedia({ reducedMotion: 'reduce' });
  report.captures.dexPositionsMobile = await captureState(mobile, 'dex-positions-mobile');
  await assertPositionsHierarchy(mobile, { testMobileSelectionFlow: true });
  report.captures.dexPositionsTerminalMobile = await captureState(mobile, 'dex-positions-terminal-mobile', { resetScroll: false });
  await mobile.getByRole('tablist', { name: 'Position terminal view' }).getByRole('tab', { name: 'Activity', exact: true }).click();
  report.captures.dexPositionsActivityMobile = await captureState(mobile, 'dex-positions-activity-mobile', { resetScroll: false });
  await mobile.getByRole('button', { name: 'Back to positions' }).click();
  const selectedMobilePosition = mobile.locator('.dex-v2-position-row[aria-current="true"]');
  await expect(selectedMobilePosition).toBeFocused();
  await expect.poll(async () => (await selectedMobilePosition.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(120);
  const selectedMobilePositionBox = await selectedMobilePosition.boundingBox();
  expect(selectedMobilePositionBox).toBeTruthy();
  expect(selectedMobilePositionBox.y).toBeGreaterThanOrEqual(120);
  expect(selectedMobilePositionBox.y).toBeLessThan(220);
  report.captures.dexPositionsReturnMobile = await captureState(
    mobile,
    'dex-positions-return-mobile',
    { resetScroll: false }
  );
  await mobile.close();

  const keyboard = await browser.newPage({ viewport: mobileViewport, deviceScaleFactor: 1 });
  await installMockWallet(keyboard);
  await installMockVisualViewport(keyboard);
  await assertMobileKeyboardBehavior(keyboard);
  report.interactions.mobileKeyboard = 'passed';
  await keyboard.setViewportSize({ width: 390, height: 844 });
  await openP2PPath(keyboard, '/otc/limit');
  const keyboardPriceInput = keyboard.locator('.trade-compose-price-field input');
  await keyboardPriceInput.focus();
  await keyboard.evaluate(() => window.__setDesignQaVisualViewportHeight(window.innerHeight - 240));
  report.captures.mobileShellKeyboardOpen390 = await captureState(keyboard, 'mobile-shell-keyboard-open-390', { resetScroll: false });
  await keyboard.close();

  for (const width of [360, 390, 430]) {
    const detailPage = await browser.newPage({ viewport: { width, height: width === 360 ? 800 : width === 390 ? 844 : 932 }, deviceScaleFactor: 1 });
    await installMockWallet(detailPage, { privacyReady: true });
    await openP2P(detailPage, { privacyReady: true });
    await expect(detailPage.locator('.trading-market-pair')).toBeVisible();
    await expect(detailPage.locator('.trading-market-ratio strong')).toContainText('1 cwTPB = 1.0000 cwTPQ');
    await expect(detailPage.getByRole('button', { name: 'Reverse price display to 1 cwTPQ priced in cwTPB' })).toBeVisible();
    const privacyAction = detailPage.locator('.p2p-wallet-privacy-direct');
    if (/unlock privacy/i.test(await privacyAction.getAttribute('aria-label') ?? '')) {
      await privacyAction.click();
    }
    await expect(detailPage.locator('.p2p-wallet-privacy-ready')).toBeVisible();
    await expect(detailPage.locator('.top-header-bar')).toBeVisible();
    report.captures[`mobileShellTop${width}`] = await captureState(detailPage, `mobile-shell-top-${width}`);

    if (width === 390) {
      report.captures.mobileShellPrivacyReady390 = await captureState(detailPage, 'mobile-shell-privacy-ready-390');
      await detailPage.getByRole('button', { name: /Open Wallet menu/ }).click();
      const walletMenu = detailPage.getByRole('menu', { name: 'Wallet' });
      await expect(walletMenu).toBeVisible();
      const walletMenuBounds = await walletMenu.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, viewportWidth: window.innerWidth };
      });
      expect(walletMenuBounds.left).toBeGreaterThanOrEqual(0);
      expect(walletMenuBounds.right).toBeLessThanOrEqual(walletMenuBounds.viewportWidth);
      report.interactions.mobileWalletMenuContained = 'passed';
      report.captures.mobileShellWalletDetails390 = await captureState(detailPage, 'mobile-shell-wallet-details-390', { resetScroll: false });
      await detailPage.keyboard.press('Escape');

      await detailPage.evaluate(() => {
        const candidates = ['.app-main', '.standalone-trades-shell', '.p2p-offers-workspace']
          .map((selector) => document.querySelector(selector))
          .filter(Boolean);
        const scrollable = candidates.find((element) => element.scrollHeight > element.clientHeight);
        if (scrollable) {
          scrollable.scrollTop = Math.min(320, scrollable.scrollHeight - scrollable.clientHeight);
          scrollable.dispatchEvent(new Event('scroll'));
        }
      });
      await expect(detailPage.locator('.app-shell-trades')).toHaveClass(/mobile-trading-scrolled/);
      await expect(detailPage.locator('.top-header-bar')).toBeHidden();
      await expect(detailPage.locator('.top-header-mobile-app-nav')).toBeVisible();
      await expect(detailPage.locator('.trading-market-pair')).toBeVisible();
      await expect(detailPage.getByRole('button', { name: /Reverse price display/ })).toBeVisible();
      report.interactions.mobilePersistentPairContext = 'passed';
      report.captures.mobileShellScrolled390 = await captureState(detailPage, 'mobile-shell-scrolled-390', { resetScroll: false });

      await openDex(detailPage);
      await expect(detailPage.locator('.trading-market-pair')).toBeVisible();
      await expect(detailPage.getByRole('button', { name: /Reverse price display/ })).toBeVisible();
      report.captures.mobileDexShellTop390 = await captureState(detailPage, 'mobile-dex-shell-top-390');
      await detailPage.evaluate(() => {
        const element = document.querySelector('.dex-v2-page');
        if (element) {
          element.scrollTop = Math.min(320, element.scrollHeight - element.clientHeight);
          element.dispatchEvent(new Event('scroll'));
        }
      });
      await expect(detailPage.locator('.app-shell-dex-v2')).toHaveClass(/mobile-trading-scrolled/);
      await expect(detailPage.locator('.top-header-bar')).toBeHidden();
      await expect(detailPage.locator('.top-header-mobile-app-nav')).toBeVisible();
      await expect(detailPage.locator('.trading-market-pair')).toBeVisible();
      await expect(detailPage.getByRole('button', { name: /Reverse price display/ })).toBeVisible();
      report.captures.mobileDexShellScrolled390 = await captureState(detailPage, 'mobile-dex-shell-scrolled-390', { resetScroll: false });
    }
    await detailPage.close();
  }

  const unlocking = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await installMockWallet(unlocking);
  await openP2P(unlocking, { privacyUnlocking: true });
  await expect(unlocking.locator('.p2p-wallet-status-label')).toHaveText('Unlocking privacy...');
  report.captures.mobileShellPrivacyUnlocking390 = await captureState(unlocking, 'mobile-shell-privacy-unlocking-390', { resetScroll: false });
  await unlocking.close();

  const reducedMotion = await browser.newPage({ viewport: desktopViewport, deviceScaleFactor: 1 });
  await installMockWallet(reducedMotion);
  await assertReducedMotionFallback(reducedMotion);
  report.interactions.ratioFlipReducedMotion = 'passed';
  await reducedMotion.close();

  const responsive = await browser.newPage({ viewport: requiredViewports[0], deviceScaleFactor: 1 });
  await installMockWallet(responsive);
  for (const viewport of requiredViewports) {
    await responsive.setViewportSize(viewport);
    await openP2P(responsive);
    const key = `${viewport.width}x${viewport.height}`;
    const metrics = await measureResponsiveState(responsive);
    expect(metrics.horizontalOverflow, `${key} should not have horizontal overflow`).toBe(false);
    expect(metrics.viewportFitCover, `${key} should enable safe-area viewport coverage`).toBe(true);
    expect(metrics.pairLabelFits, `${key} should show the complete shared pair label`).toBe(true);
    expect(metrics.ratioLabelFits, `${key} should show the complete shared price ratio`).toBe(true);
    expect(metrics.ratioReverseEffectiveTarget, `${key} reverse-price control should have a 44px effective target`).toBe(true);
    if (viewport.width <= 430) {
      expect(metrics.mobileDockVisible, `${key} should show the mobile trading dock`).toBe(true);
      expect(metrics.mobileDockPosition, `${key} dock should attach to the viewport`).toBe('fixed');
      expect(metrics.mobileDockBottom, `${key} dock should attach to the bottom`).toBe('0px');
    }
    if (viewport.width === 320 || viewport.width === 640) {
      report.captures[`responsiveReflow${viewport.width}`] = await captureState(
        responsive,
        `responsive-reflow-${viewport.width}x${viewport.height}`
      );
    }
    report.responsiveChecks[key] = metrics;
  }
  await responsive.close();
} finally {
  await browser.close();
}

await writeFile(path.join(outputDir, 'capture-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
