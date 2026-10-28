import { expect, test } from '@playwright/test';

test.describe('shared Trading Agent workspace', () => {
  test('keeps the Agent composer inside short desktop windows', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    for (const route of ['/dex/agent', '/otc/agent']) {
      await page.goto(route);
      const tools = page.getByRole('navigation', { name: 'Agent tools' });
      for (const mode of ['Trade Agent', 'App Help']) {
        await tools.getByRole('button', { name: mode, exact: true }).click();
        await expect.poll(() => page.locator('.p2p-agent-section').evaluate(section => {
          const composer = section.querySelector('.p2p-agent-composer');
          return Boolean(composer && composer.getBoundingClientRect().bottom <= section.getBoundingClientRect().bottom + 1);
        })).toBe(true);
      }
    }
  });

  test('uses the full P2P terminal workspace with attached context on desktop', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/otc/agent');

    const agentTools = page.getByRole('navigation', { name: 'Agent tools' });
    await expect(agentTools.getByRole('button')).toHaveCount(3);
    await expect(agentTools.getByRole('button', { name: 'App Help' })).toBeVisible();
    await expect(agentTools.getByRole('button', { name: 'Trade Agent' })).toHaveAttribute('aria-current', 'page');
    await expect(agentTools.getByRole('button', { name: 'MCP for agents' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'MCP instructions' })).toHaveCount(0);
    await expect(page.getByText('What do you want to do?')).toBeVisible();
    await expect(page.getByText('Attached context')).toBeVisible();
    await expect(page.locator('.p2p-agent-workspace')).toHaveCSS('grid-template-columns', /.+ .+/);
    await expect(page.locator('.p2p-agent-nav-tab.active').first()).toContainText('Agent');

    await agentTools.getByRole('button', { name: 'App Help' }).click();
    await expect(page.getByLabel('Ask App Help a question')).toBeVisible();
    await agentTools.getByRole('button', { name: 'MCP for agents' }).click();
    await expect(page.getByRole('region', { name: 'MCP instructions for user-owned agents' })).toBeVisible();
    await agentTools.getByRole('button', { name: 'Trade Agent' }).click();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);

    await page.screenshot({ path: 'test-results/trading-agent-desktop.png', fullPage: true });
  });

  test('keeps Agent, context, and composer usable above the mobile bottom navigation', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/otc/agent');

    const mobileAgent = page.locator('.p2p-secondary-nav-mobile .p2p-agent-nav-tab');
    await expect(mobileAgent).toBeVisible();
    await expect(mobileAgent).toHaveAttribute('aria-current', 'page');
    const mobileTools = page.getByRole('navigation', { name: 'Agent tools' });
    await expect(mobileTools).toBeVisible();
    await expect(mobileTools.getByRole('button')).toHaveCount(3);

    await page.locator('.p2p-agent-context > summary').click();
    await page.locator('.p2p-agent-composer').scrollIntoViewIfNeeded();

    const layout = await page.evaluate(() => {
      const composer = document.querySelector<HTMLElement>('.p2p-agent-composer');
      const nav = document.querySelector<HTMLElement>('.p2p-secondary-nav-mobile');
      if (!composer || !nav) return null;
      const composerBox = composer.getBoundingClientRect();
      const navBox = nav.getBoundingClientRect();
      return {
        composerAboveNav: composerBox.bottom <= navBox.top + 1,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });

    expect(layout).not.toBeNull();
    expect(layout!.composerAboveNav).toBe(true);
    expect(layout!.overflow).toBeLessThanOrEqual(1);

    await page.screenshot({ path: 'test-results/trading-agent-mobile.png', fullPage: true });
  });

  test('shows DEX as preview-only without presenting unavailable actions as executable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dex/agent');

    await expect(page.getByText('DEX preview', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Pay and send/i })).toHaveCount(0);
    const dexActions = page.locator('.p2p-agent-quick-action-grid button');
    await expect(dexActions.first()).toBeDisabled();
    await expect(page.getByText(/DEX preparation actions are preview-only/i)).toBeVisible();
  });

  test('keeps current swap modes and protections usable without enabling unverified signing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()); });
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.goto('/dex');
      await expect(page).toHaveURL(/\/dex$/);
      expect(await page.title()).not.toBe('');
      await expect(page.getByRole('heading', { name: 'Buy Test token 0', exact: true })).toBeVisible();
      const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
      await expect(page.getByText('Testnet ready', { exact: true })).toHaveCount(0);
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
      await expect(swap.getByRole('button', { name: 'Fast', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await swap.locator('.dex-v2-current-advanced > summary').click();
      await expect(swap.getByText(/It does not scan Limit orders/)).toBeVisible();
      await swap.getByLabel('Minimum input fill', { exact: true }).fill('123');
      await expect(swap.getByLabel('Minimum input fill', { exact: true })).toHaveValue('123');
      await swap.getByRole('button', { name: 'Multi-source', exact: true }).click();
      await expect(swap.getByRole('button', { name: 'Multi-source', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(swap.getByText(/Multi-source uses bounded Pool and Limit liquidity/)).toBeVisible();
      await swap.getByLabel('Price limit', { exact: true }).fill('0.75');
      await expect(swap.getByLabel('Price limit', { exact: true })).toHaveValue('0.75');
      await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `${process.env.TEMP}/chainwhisper-current-swap-${width}.png`, fullPage: true });
    }
    expect(errors).toEqual([]);
  });

  test('checks current contracts automatically and rejects a wallet change during preparation', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/dex');
    // Test-only capabilities exercise the real component. They cannot sign or send.
    await page.evaluate(async () => {
      const reactUrl = '/node_modules/.vite/deps/react.js';
      const domUrl = '/node_modules/.vite/deps/react-dom_client.js';
      const pageUrl = '/src/features/dex/components/DexV2Page.tsx';
      const candidateUrl = '/src/lib/dexV2Deployment.ts';
      const [{ default: { createElement } }, { default: { createRoot } }, { default: DexPage }, { CURRENT_CHEAP_DEX_CANDIDATE: candidate }] =
        await Promise.all([import(reactUrl), import(domUrl), import(pageUrl), import(candidateUrl)]);
      const host = document.createElement('div');
      host.id = 'current-readiness-fixture';
      document.body.append(host);
      const root = createRoot(host);
      const provider = { request: () => { throw new Error('No RPC is allowed in this fixture.'); } };
      let finishCheck: (() => void) | undefined;
      let checks = 0;
      let quoteCalls = 0;
      Object.assign(window, { readTrialCounts: () => ({ checks, quoteCalls }), finishTrialCheck: () => finishCheck?.() });
      const render = (address: string) => root.render(createElement(DexPage, { sharedWalletSession: {
        walletAddress: address, chainId: 7082400, browserProvider: provider,
        actions: {
          getCurrentDexQuoteCapability: () => { quoteCalls += 1; throw new Error('No Quote submission is allowed.'); },
          getCurrentDexReceiptCapability: () => { throw new Error('No private receipt is allowed.'); },
          getCurrentDexSubmissionCapability: async () => ({ checkCurrentCheapCandidate: async () => { checks += 1; await new Promise<void>(resolve => { finishCheck = resolve; }); return ({
            chainId: 7082400n, owner: address, core: candidate.core, graph: candidate.graph, readyToSign: false
          }); } })
        }
      } }));
      window.addEventListener('trial-wallet', event => render((event as CustomEvent<string>).detail));
      render(`0x${'22'.repeat(20)}`);
    });
    const fixture = page.locator('#current-readiness-fixture');
    const quote = fixture.getByRole('button', { name: 'Get Quote', exact: true });
    await expect(quote).toBeEnabled();
    await fixture.getByLabel('Maximum input', { exact: true }).fill('1');
    await fixture.locator('.dex-v2-current-advanced > summary').click();
    await fixture.getByLabel('Price limit', { exact: true }).fill('1');
    await quote.click();
    const counts = () => page.evaluate(() => (window as unknown as { readTrialCounts: () => { checks: number; quoteCalls: number } }).readTrialCounts());
    await expect.poll(counts).toEqual({ checks: 1, quoteCalls: 0 });
    await expect(quote).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('trial-wallet', { detail: `0x${'33'.repeat(20)}` })));
    await page.evaluate(() => (window as unknown as { finishTrialCheck: () => void }).finishTrialCheck());
    await expect(fixture.locator('.dex-v2-current-status')).toContainText('Wallet or network changed');
    await expect(quote).toBeDisabled();
    expect(await counts()).toEqual({ checks: 1, quoteCalls: 0 });
    expect(errors).toEqual([]);
  });
});

