/* global document, window */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.CW_DESIGN_QA_BASE_URL ?? 'http://127.0.0.1:4173';
const outputDir = path.resolve('design-audit', 'acceptance-accessibility');
const owner = '0x1111111111111111111111111111111111111111';
const chainId = '0x6c11a0';

const installMockWallet = async (page) => {
  await page.addInitScript(({ chainIdHex, ownerAddress }) => {
    const listeners = new Map();
    const snapId = 'npm:@coti-io/coti-snap';
    const provider = {
      isMetaMask: true,
      selectedAddress: ownerAddress,
      chainId: chainIdHex,
      networkVersion: String(Number.parseInt(chainIdHex, 16)),
      request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ownerAddress];
        if (method === 'eth_chainId') return chainIdHex;
        if (method === 'net_version') return String(Number.parseInt(chainIdHex, 16));
        if (method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts', caveats: [] }];
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
        if (method === 'wallet_getSnaps' || method === 'wallet_requestSnaps') return { [snapId]: { id: snapId } };
        if (method === 'wallet_invokeSnap') {
          const snapMethod = params?.request?.method;
          if (snapMethod === 'connect-to-wallet' || snapMethod === 'has-aes-key') return true;
          if (snapMethod === 'get-aes-key') return 'accessibility-capture-aes';
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
  }, { chainIdHex: chainId, ownerAddress: owner });
};

const stabilize = async (page) => {
  await page.evaluate(() => new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  }));
  await page.waitForTimeout(200);
};

const capture = async (page, name) => {
  await stabilize(page);
  const file = path.join(outputDir, `${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', fullPage: false });
  return {
    file,
    path: await page.evaluate(() => window.location.pathname),
    horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1),
    focus: await page.evaluate(() => ({
      ariaLabel: document.activeElement?.getAttribute('aria-label'),
      outlineColor: window.getComputedStyle(document.activeElement).outlineColor,
      text: document.activeElement?.textContent?.replace(/\s+/gu, ' ').trim()
    }))
  };
};

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = { baseURL, captures: {}, consoleErrors: [] };

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1024 }, deviceScaleFactor: 1 });
  desktop.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  await installMockWallet(desktop);
  await desktop.goto(`${baseURL}/otc?designQa=approved-offers`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await expect(desktop.getByRole('heading', { name: 'Offers' })).toBeVisible();
  const reverse = desktop.getByRole('button', { name: /Reverse price display to 1 cwTPQ priced in cwTPB/i });
  await reverse.focus();
  await reverse.press('Enter');
  await expect(desktop.locator('.trading-ratio-value')).toContainText('1 cwTPQ = 1.0000 cwTPB');
  report.captures.desktopRatioFocus = await capture(desktop, '01-desktop-ratio-focus');

  const more = desktop.getByRole('button', { name: 'Open Wallet menu' });
  await more.focus();
  await more.press('Enter');
  await expect(desktop.getByRole('menu', { name: 'Wallet' }).getByRole('menuitem', { name: /Network/i })).toBeFocused();
  report.captures.desktopWalletMenuFocus = await capture(desktop, '02-desktop-wallet-menu-focus');
  await desktop.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  mobile.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  await installMockWallet(mobile);
  await mobile.goto(`${baseURL}/otc/limit`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const dock = mobile.locator('.p2p-secondary-nav-mobile:visible');
  await expect(dock.getByRole('button', { name: 'Create' })).toHaveAttribute('aria-current', 'page');
  await dock.getByRole('button', { name: 'My trades' }).focus();
  report.captures.mobileDockFocus = await capture(mobile, '03-mobile-dock-focus');
  await mobile.close();

  expect(report.consoleErrors).toEqual([]);
  expect(Object.values(report.captures).every((item) => !item.horizontalOverflow)).toBe(true);
  expect(Object.values(report.captures).every((item) => item.focus.outlineColor === 'rgb(196, 181, 253)')).toBe(true);
  await writeFile(path.join(outputDir, 'capture-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
