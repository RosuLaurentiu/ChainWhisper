/* global document, window */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.CW_DESIGN_QA_BASE_URL ?? 'http://127.0.0.1:4173';
const outputDir = path.resolve('design-audit', 'whole-product-captures');
const desktopViewport = { width: 1440, height: 1024 };
const mobileViewport = { width: 390, height: 844 };
const compactHeaderViewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 }
];
const mockWalletAddress = '0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d';
const cotiChainIdHex = '0x6c11a0';

const installMockWallet = async (page, { privacyReady = true } = {}) => {
  await page.addInitScript(({ address, chainIdHex, privacyReady }) => {
    const listeners = new Map();
    let connected = false;
    const snapId = 'npm:@coti-io/coti-snap';
    const installedSnaps = { [snapId]: { id: snapId } };
    const provider = {
      isMetaMask: true,
      selectedAddress: null,
      request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts') {
          connected = true;
          provider.selectedAddress = address;
          return [address];
        }
        if (method === 'eth_accounts') return connected ? [address] : [];
        if (method === 'eth_chainId') return chainIdHex;
        if (method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts', caveats: [] }];
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
        if (method === 'wallet_getSnaps') return privacyReady ? installedSnaps : null;
        if (method === 'wallet_requestSnaps') return privacyReady ? installedSnaps : null;
        if (method === 'wallet_invokeSnap') {
          const snapMethod = params?.request?.method;
          if (snapMethod === 'connect-to-wallet' || snapMethod === 'has-aes-key') return true;
          if (snapMethod === 'get-aes-key') return 'whole-product-design-qa-owner-aes';
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
  }, { address: mockWalletAddress, chainIdHex: cotiChainIdHex, privacyReady });
};

const connectMockWallet = async (page) => {
  const connect = page.locator('.wallet-primary-action:visible').first();
  if (await connect.count() && /connect/i.test(await connect.innerText())) {
    await connect.click({ timeout: 5_000 });
    await page.waitForFunction(() => {
      const button = Array.from(document.querySelectorAll('.wallet-primary-action'))
        .find((candidate) => candidate.getBoundingClientRect().width > 0);
      return Boolean(button && !/connect/i.test(button.textContent ?? ''));
    }, undefined, { timeout: 15_000 });
  }
};

const waitForRoute = async (page, pathname, locator) => {
  await page.goto(`${baseURL}${pathname}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator(locator).waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(1_000);
};

const capture = async (page, name) => {
  await page.mouse.move(1, 1);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const selector of ['.app-main', '.chat-panel', '.swap-page-shell', '.treasury-shell', '.standalone-trades-shell']) {
      const element = document.querySelector(selector);
      if (element) element.scrollTop = 0;
    }
  });
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
    title: document.title,
    path: window.location.pathname,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    visibleHeadings: Array.from(document.querySelectorAll('h1, h2'))
      .filter((element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0)
      .map((element) => element.textContent?.trim())
      .filter(Boolean)
  }));
};

const assertSharedShell = async (page, expectedNavLabel) => {
  const appNavigation = page.getByRole('navigation', { name: 'ChainWhisper apps' });
  await expect(appNavigation).toBeVisible();
  await expect(appNavigation.getByRole('button', { name: expectedNavLabel, exact: true })).toHaveAttribute('aria-current', 'page');
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    viewportFitCover: document.querySelector('meta[name="viewport"]')?.getAttribute('content')?.includes('viewport-fit=cover') ?? false
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.viewportFitCover).toBe(true);
};

const readDesktopHeaderGeometry = async (page) => page.evaluate(() => {
  const box = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    };
  };
  return {
    bar: box('.top-header-bar'),
    brand: box('.top-header-brand'),
    home: box('.top-header-brand-actions button'),
    navigation: box('.top-header-app-nav'),
    wallet: box('.top-header-actions .wallet-header-panel-connected')
  };
});

const assertDesktopHeaderGeometryMatches = (candidate, reference, routeLabel) => {
  const differences = [];
  for (const region of ['bar', 'brand', 'home', 'navigation', 'wallet']) {
    expect(candidate[region], `${routeLabel}: ${region} geometry exists`).not.toBeNull();
    expect(reference[region], `Chat: ${region} reference geometry exists`).not.toBeNull();
    for (const edge of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
      const delta = Math.abs(candidate[region][edge] - reference[region][edge]);
      if (delta > 1) differences.push({ region, edge, delta, candidate: candidate[region][edge], reference: reference[region][edge] });
    }
  }
  expect(differences, `${routeLabel}: full shared-header geometry matches Chat`).toEqual([]);
};

const assertCompactConnectedHeader = async (page, routeLabel) => {
  const capsule = page.locator('.top-header-mobile-wallet-inline .wallet-header-panel-connected');
  const address = capsule.locator('.wallet-primary-action');
  const privacy = capsule.locator('.p2p-wallet-privacy-direct');
  const more = capsule.locator('.p2p-wallet-menu-trigger');

  await expect(capsule, `${routeLabel}: connected wallet capsule`).toBeVisible();
  await expect(address, `${routeLabel}: address/copy control`).toBeVisible();
  await expect(address, `${routeLabel}: clean compact address`).toHaveText('0x5d\u2026979d');
  expect(
    await address.evaluate((button) => {
      const label = button.querySelector('span');
      if (!label) return false;
      const style = window.getComputedStyle(button);
      const contentWidth = button.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return false;
      context.font = window.getComputedStyle(label).font;
      return context.measureText(label.textContent ?? '').width <= contentWidth + 0.5;
    }),
    `${routeLabel}: address label is not visually truncated`
  ).toBe(true);
  await expect(privacy, `${routeLabel}: privacy lock control`).toBeVisible();
  await expect(more, `${routeLabel}: wallet More control`).toBeVisible();

  const geometry = await page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    return {
      viewportWidth: window.innerWidth,
      capsule: box('.top-header-mobile-wallet-inline .wallet-header-panel-connected'),
      status: box('.top-header-mobile-wallet-inline .wallet-header-panel-connected .p2p-wallet-status'),
      address: box('.top-header-mobile-wallet-inline .wallet-primary-action'),
      privacy: box('.top-header-mobile-wallet-inline .p2p-wallet-privacy-direct'),
      menuWrap: box('.top-header-mobile-wallet-inline .p2p-wallet-menu-wrap'),
      more: box('.top-header-mobile-wallet-inline .p2p-wallet-menu-trigger'),
      utilityCluster: box('.top-header-mobile-utility-cluster'),
      home: box('.top-header-mobile-home button'),
      help: box('.top-header-help-btn')
    };
  });
  expect(geometry.capsule, `${routeLabel}: capsule geometry`).not.toBeNull();
  expect(geometry.address, `${routeLabel}: address geometry`).not.toBeNull();
  expect(geometry.privacy, `${routeLabel}: privacy geometry`).not.toBeNull();
  expect(geometry.more, `${routeLabel}: More geometry`).not.toBeNull();
  expect(geometry.capsule.left, `${routeLabel}: capsule begins inside viewport`).toBeGreaterThanOrEqual(0);
  expect(geometry.capsule.right, `${routeLabel}: capsule ends inside viewport`).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.capsule.height, `${routeLabel}: capsule stays compact`).toBeLessThanOrEqual(40);
  expect(Math.abs(geometry.address.top - geometry.privacy.top), `${routeLabel}: address and privacy align`).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.privacy.top - geometry.more.top), `${routeLabel}: privacy and More align`).toBeLessThanOrEqual(1);
  expect(geometry.address.right, `${routeLabel}: address does not overlap privacy`).toBeLessThanOrEqual(geometry.privacy.left + 1);
  expect(geometry.privacy.right, `${routeLabel}: privacy does not overlap More`).toBeLessThanOrEqual(geometry.more.left + 1);
  if (geometry.home) {
    expect(geometry.home.right, `${routeLabel}: home does not overlap wallet`).toBeLessThanOrEqual(geometry.capsule.left + 1);
  }
  if (geometry.utilityCluster) {
    expect(geometry.utilityCluster.right, `${routeLabel}: utility controls do not overlap wallet`).toBeLessThanOrEqual(geometry.capsule.left + 1);
  }
  if (geometry.help) {
    expect(geometry.capsule.right, `${routeLabel}: wallet does not overlap help`).toBeLessThanOrEqual(geometry.help.left + 1);
  }

  await more.click();
  const menu = page.locator('.top-header-mobile-wallet-inline .p2p-wallet-menu:visible');
  await expect(menu, `${routeLabel}: wallet menu`).toBeVisible();
  const menuBox = await menu.boundingBox();
  expect(menuBox, `${routeLabel}: wallet menu geometry`).not.toBeNull();
  expect(menuBox.x, `${routeLabel}: wallet menu begins inside viewport`).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width, `${routeLabel}: wallet menu ends inside viewport`).toBeLessThanOrEqual(geometry.viewportWidth);
  await more.click();
};

const auditCompactHeaderViewports = async (browser, report) => {
  for (const viewport of compactHeaderViewports) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const suffix = `${viewport.width}x${viewport.height}`;
    await installMockWallet(page);
    page.on('console', (message) => {
      if (message.type() === 'error') report.consoleErrors.push({ viewport: `header-${suffix}`, text: message.text() });
    });
    page.on('pageerror', (error) => report.consoleErrors.push({ viewport: `header-${suffix}`, text: error.message }));

    await waitForRoute(page, '/chat', '.app-shell-chat');
    await connectMockWallet(page);
    await assertCompactConnectedHeader(page, `Chat ${suffix}`);
    report.captures[`chatConnectedHeader${viewport.width}`] = await capture(page, `chat-connected-header-${viewport.width}`);

    await waitForRoute(page, '/portal', '.swap-page-shell');
    await connectMockWallet(page);
    await assertCompactConnectedHeader(page, `Privacy Portal ${suffix}`);
    report.captures[`privacyPortalConnectedHeader${viewport.width}`] = await capture(page, `privacy-portal-connected-header-${viewport.width}`);

    report.interactions[`compactConnectedHeader${viewport.width}`] = 'passed';
    await page.close();
  }
};

const auditViewport = async (browser, viewport, suffix, report) => {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await installMockWallet(page);
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push({ viewport: suffix, text: message.text() });
  });
  page.on('pageerror', (error) => report.consoleErrors.push({ viewport: suffix, text: error.message }));

  await waitForRoute(page, '/', '.landing-shell');
  await expect(page.getByRole('heading', { name: /Built around private coordination/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'DEX & P2P' })).toBeVisible();
  await expect(page.getByText('DEX & OTC', { exact: true })).toHaveCount(0);
  report.captures[`home${suffix}`] = await capture(page, `home-${suffix.toLowerCase()}`);

  await waitForRoute(page, '/chat', '.app-shell-chat');
  await assertSharedShell(page, 'Chat');
  await expect(page.getByRole('button', { name: 'Connect MetaMask or CipherTrade' })).toHaveText(
    suffix === 'Mobile' ? 'Connect' : 'Connect wallet'
  );
  await expect(page.getByText('Wallet disconnected', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Wallet needed', exact: true, level: 2 })).toBeVisible();
  await expect(page.locator('.app-root-readiness')).toBeVisible();
  await expect(page.locator('.contacts-sidebar')).toHaveCount(0);
  await expect(page.locator('.mobile-bottom-nav')).toHaveCount(0);
  report.captures[`chatDisconnected${suffix}`] = await capture(page, `chat-disconnected-${suffix.toLowerCase()}`);
  await connectMockWallet(page);
  await expect(page.locator('.app-shell-chat')).toBeVisible();
  await expect(page.locator('.p2p-wallet-privacy-ready:visible')).toBeVisible();
  await expect(page.getByText(/Snap request was rejected|did not finish switching/i)).toHaveCount(0);
  const newChatFromWorkspace = page.getByRole('button', { name: 'New chat', exact: true }).last();
  if (suffix === 'Desktop') {
    await expect(newChatFromWorkspace).toBeVisible();
    await newChatFromWorkspace.click();
    const quickActionsDialog = page.getByRole('dialog', { name: 'New' });
    await expect(quickActionsDialog).toBeVisible();
    await expect(quickActionsDialog.getByRole('tab', { name: 'Add contact' })).toHaveAttribute('aria-selected', 'true');
    await quickActionsDialog.getByRole('button', { name: 'Close' }).click();
    await expect(quickActionsDialog).toBeHidden();
    report.interactions.chatWorkspaceNewChatDesktop = 'passed';
  }
  report.captures[`chatConnectedEmpty${suffix}`] = await capture(page, `chat-connected-empty-${suffix.toLowerCase()}`);
  if (suffix === 'Desktop') {
    report.headerConsistencyDesktop = {
      chat: await readDesktopHeaderGeometry(page)
    };
  }
  const chatNotifications = page.locator('.direct-trade-notification-toggle:visible');
  if (await chatNotifications.count()) {
    await chatNotifications.click();
    const notificationList = page.getByLabel('Direct trade notifications list');
    await expect(notificationList).toBeVisible();
    await expect(notificationList.getByText('Trade notifications', { exact: true })).toBeVisible();
    await expect(notificationList.getByText('No new direct trades or counters.', { exact: true })).toBeVisible();
    await expect(notificationList.getByText('Notification sound', { exact: true })).toBeVisible();
    await expect(notificationList.getByRole('switch')).toBeVisible();
    const notificationBounds = await notificationList.boundingBox();
    expect(notificationBounds, `${suffix}: notification popover geometry`).not.toBeNull();
    expect(notificationBounds.x, `${suffix}: notification popover begins inside viewport`).toBeGreaterThanOrEqual(0);
    expect(notificationBounds.x + notificationBounds.width, `${suffix}: notification popover ends inside viewport`).toBeLessThanOrEqual(viewport.width);
    report.captures[`notificationsEmpty${suffix}`] = await capture(page, `notifications-empty-${suffix.toLowerCase()}`);
    await chatNotifications.click();
    await expect(notificationList).toBeHidden();
  }

  await waitForRoute(page, '/portal', '.swap-page-shell');
  await assertSharedShell(page, 'Privacy Portal');
  await expect(page.getByRole('heading', { name: 'Connect wallet to use Privacy Portal', level: 2 })).toBeVisible();
  await expect(page.getByText('Wallet disconnected', { exact: true })).toHaveCount(0);
  await expect(page.locator('.privacy-connection-card')).toBeVisible();
  await expect(page.locator('.swap-flow')).toHaveCount(0);
  await expect(page.locator('.swap-action-btn')).toHaveCount(0);
  await expect(page.locator('.swap-error-row')).toHaveCount(0);
  report.captures[`privacyPortalDisconnected${suffix}`] = await capture(page, `privacy-portal-disconnected-${suffix.toLowerCase()}`);
  await connectMockWallet(page);
  await expect(page.getByText('Privacy unlocked', { exact: true })).toBeVisible();
  await expect(page.locator('.privacy-connection-card')).toHaveCount(0);
  await expect(page.locator('.swap-flow')).toBeVisible();
  report.captures[`privacyPortalConnected${suffix}`] = await capture(page, `privacy-portal-connected-${suffix.toLowerCase()}`);
  if (suffix === 'Desktop') {
    report.headerConsistencyDesktop.privacyPortal = await readDesktopHeaderGeometry(page);
    assertDesktopHeaderGeometryMatches(
      report.headerConsistencyDesktop.privacyPortal,
      report.headerConsistencyDesktop.chat,
      'Privacy Portal'
    );
  }
  const recoveryToggle = page.getByRole('button', { name: /legacy|recovery/i }).first();
  if (await recoveryToggle.count()) {
    await recoveryToggle.click();
    report.captures[`privacyRecovery${suffix}`] = await capture(page, `privacy-recovery-${suffix.toLowerCase()}`);
  }

  await waitForRoute(page, '/tvl', '.treasury-shell');
  await assertSharedShell(page, 'Private TVL');
  await connectMockWallet(page);
  await expect(page.locator('.top-header .wallet-header-panel-connected')).toBeVisible();
  await expect(page.locator('.sound-toggle-btn')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Private TVL is temporarily unavailable', level: 2 })).toBeVisible();
  await expect(page.locator('.treasury-readiness-grid')).toBeVisible();
  await expect(page.getByText('No estimates shown', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry verification', exact: true })).toBeVisible();
  report.captures[`privateTvl${suffix}`] = await capture(page, `private-tvl-${suffix.toLowerCase()}`);
  if (suffix === 'Desktop') {
    report.headerConsistencyDesktop.privateTvl = await readDesktopHeaderGeometry(page);
    assertDesktopHeaderGeometryMatches(
      report.headerConsistencyDesktop.privateTvl,
      report.headerConsistencyDesktop.chat,
      'Private TVL'
    );
  }

  await waitForRoute(page, '/otc/agent', '.standalone-trades-shell');
  await assertSharedShell(page, 'Trading');
  await connectMockWallet(page);
  const assistant = page.getByRole('region', { name: 'ChainWhisper Assistant' });
  await expect(assistant).toBeVisible();
  await assistant.getByRole('tab', { name: 'Trade Agent', exact: true }).click();
  await expect(assistant.getByRole('tab', { name: 'Trade Agent', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(assistant.getByRole('heading', { level: 1, name: 'Trading help, not autopilot.' })).toBeVisible();
  await expect(assistant.getByText('Compare prices, review an order, or draft a trade. Nothing is submitted until you confirm it.', { exact: true })).toBeVisible();
  if (suffix === 'Mobile') {
    const feeBadge = assistant.locator('.p2p-agent-hero small');
    const hero = assistant.locator('.p2p-agent-hero');
    const submitButton = assistant.getByRole('button', { name: 'Pay and send', exact: true });
    const prompt = assistant.locator('.p2p-agent-prompt');
    const [feeBounds, heroBounds, submitBounds, promptBounds] = await Promise.all([
      feeBadge.boundingBox(),
      hero.boundingBox(),
      submitButton.boundingBox(),
      prompt.boundingBox()
    ]);
    expect(feeBounds, 'Mobile: Trade Agent fee badge geometry').not.toBeNull();
    expect(heroBounds, 'Mobile: Trade Agent hero geometry').not.toBeNull();
    expect(submitBounds, 'Mobile: Trade Agent submit geometry').not.toBeNull();
    expect(promptBounds, 'Mobile: Trade Agent prompt geometry').not.toBeNull();
    expect(feeBounds.width, 'Mobile: fee status is a compact badge').toBeLessThan(heroBounds.width * 0.8);
    expect(submitBounds.width, 'Mobile: primary Trade Agent action spans the prompt').toBeGreaterThan(promptBounds.width * 0.9);
    expect(submitBounds.height, 'Mobile: primary Trade Agent action meets touch target').toBeGreaterThanOrEqual(44);
  }
  report.captures[`tradeAgent${suffix}`] = await capture(page, `trade-agent-${suffix.toLowerCase()}`);
  if (suffix === 'Desktop') {
    report.headerConsistencyDesktop.trading = await readDesktopHeaderGeometry(page);
    assertDesktopHeaderGeometryMatches(
      report.headerConsistencyDesktop.trading,
      report.headerConsistencyDesktop.chat,
      'Trading'
    );
  }

  report.interactions[`shellNavigation${suffix}`] = 'passed';
  await page.close();
};

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = { baseURL, captures: {}, interactions: {}, consoleErrors: [] };

try {
  await auditViewport(browser, desktopViewport, 'Desktop', report);
  await auditViewport(browser, mobileViewport, 'Mobile', report);
  await auditCompactHeaderViewports(browser, report);
} finally {
  await browser.close();
}

for (const [name, result] of Object.entries(report.captures)) {
  expect(result.horizontalOverflow, `${name} should not overflow horizontally`).toBe(false);
}

await writeFile(path.join(outputDir, 'capture-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
