import { expect, test } from '@playwright/test';

test.describe('ChainWhisper Agent Setup', () => {
  test('uses three keyboard-reachable navigation buttons and previews coming-soon setup without wallet or payment side effects', async ({
    page
  }) => {
    const tradeAgentPaymentRequests: Array<{ body: string | null; url: string }> = [];
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        /\/functions\/v1\/trade-agent(?:\?|$)/u.test(request.url())
      ) {
        tradeAgentPaymentRequests.push({ body: request.postData(), url: request.url() });
      }
    });

    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto('/otc/agent');

    const tabs = page.getByRole('navigation', { name: 'Agent tools' }).getByRole('button');
    await expect(tabs).toHaveCount(3);
    const helpTab = page.getByRole('button', { name: 'App Help', exact: true });
    const tradeTab = page.getByRole('button', { name: 'Trade Agent', exact: true });
    const setupTab = page.getByRole('button', { name: 'MCP for agents', exact: true });

    await helpTab.focus();
    await helpTab.press('Tab');
    await expect(tradeTab).toBeFocused();
    await tradeTab.press('Tab');
    await setupTab.press('Enter');
    await expect(setupTab).toBeFocused();
    await expect(setupTab).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByText('Add ChainWhisper to your agent', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Preview command only. Installation becomes available with the public beta.')).toBeVisible();
    await expect(page.getByText('Coming soon', { exact: true })).toBeVisible();
    await expect(
      page.getByText('One package. Two local connections. Private negotiation included.')
    ).toBeVisible();
    await expect(
      page.getByText('A COTI companion stays separate for generic COTI operations.')
    ).toBeVisible();

    await expect(
      page.getByText('npm install --global @chainwhisper/agent-tools@0.1.0-beta.0', {
        exact: true
      })
    ).toBeVisible();
    await expect(page.getByText('ChainWhisper planning')).toBeVisible();
    await expect(page.getByText('Local COTI signing')).toBeVisible();
    await expect(page.getByText('Compatible COTI companion')).toBeVisible();
    await expect(page.getByText('ChainWhisper adds these two local connections')).toBeVisible();
    await expect(
      page.getByText(/not needed for ChainWhisper private negotiation/)
    ).toBeVisible();
    await expect(page.getByText(/complete-action approval/)).toBeVisible();
    await expect(page.getByText('One local dashboard from setup to history')).toBeVisible();
    await expect(page.getByText('One order approval')).toBeVisible();
    await expect(page.getByText('Persistent progress')).toBeVisible();
    await expect(page.getByText('Optional market tools')).toBeVisible();
    await expect(page.getByText('Add unsigned market context')).toBeVisible();
    await expect(page.getByRole('link', { name: /Carbon MCP/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /General COTI MCP/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /COTI skills/ })).toHaveCount(0);
    await expect(page.getByText('Connected', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pay and send' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Connect account' })).toHaveCount(0);

    const setupPanelWidth = await page
      .locator('.p2p-agent-panel-setup')
      .evaluate((panel) => panel.getBoundingClientRect().width);
    expect(setupPanelWidth).toBeGreaterThanOrEqual(1000);

    await expect(page.getByRole('button', { name: 'Setup coming soon' })).toBeDisabled();
    await expect(page.getByText('Preview setup prompt')).toBeVisible();
    await expect(page.getByText('Preview only', { exact: true })).toBeVisible();
    await expect(page.getByText(/Free preview. No wallet connection or WISP payment/)).toBeVisible();
    // Fee estimates are unsigned reads. Setup must not request paid execution.
    expect(tradeAgentPaymentRequests.map(request => JSON.parse(request.body ?? '{}').kind)).toEqual(tradeAgentPaymentRequests.map(() => 'estimate'));

    await setupTab.press('Shift+Tab');
    await expect(tradeTab).toBeFocused();
    await tradeTab.press('Shift+Tab');
    await expect(helpTab).toBeFocused();
    await helpTab.press('Tab');
    await expect(tradeTab).toBeFocused();
    await tradeTab.press('Tab');
    await expect(setupTab).toBeFocused();
  });

  test('stacks setup content without horizontal overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/otc/agent');
    await page.getByRole('button', { name: 'MCP for agents', exact: true }).click();

    await expect(
      page.getByText('One package. Two local connections. Private negotiation included.')
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
        )
      )
      .toBe(true);
    await expect
      .poll(() =>
        page
          .getByRole('button', { name: 'Setup coming soon' })
          .evaluate((button) => button.getBoundingClientRect().height)
      )
      .toBeGreaterThanOrEqual(44);
  });

  test('uses the outer workspace scrollbar for the expanded setup prompt', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/otc/agent');
    await page.getByRole('button', { name: 'MCP for agents', exact: true }).click();

    const workspace = page.locator('.p2p-agent-section');
    const setupContent = page.locator('.p2p-agent-setup-panel');
    const prompt = page.locator('.p2p-agent-setup-prompt');
    const promptText = prompt.locator('pre');
    const finalLink = page.getByRole('link', { name: 'COTI messaging details' });

    await prompt.locator('summary').click();
    await expect(prompt).toHaveAttribute('open', '');
    const initialLayout = await Promise.all([
      workspace.evaluate((element) => ({
        clientHeight: element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
        scrollHeight: element.scrollHeight
      })),
      setupContent.evaluate((element) => ({
        overflowY: getComputedStyle(element).overflowY
      })),
      promptText.evaluate((element) => ({
        clientHeight: element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
        scrollHeight: element.scrollHeight
      }))
    ]);

    expect(initialLayout[0].overflowY).toBe('auto');
    expect(initialLayout[0].scrollHeight).toBeGreaterThan(initialLayout[0].clientHeight);
    expect(initialLayout[1].overflowY).toBe('visible');
    expect(initialLayout[2].overflowY).toBe('visible');
    expect(initialLayout[2].scrollHeight).toBeLessThanOrEqual(
      initialLayout[2].clientHeight + 1
    );

    const finalScroll = await workspace.evaluate((element) => {
      element.scrollTo({ top: element.scrollHeight });
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop
      };
    });

    expect(finalScroll.scrollTop).toBeGreaterThan(0);
    expect(finalScroll.scrollTop + finalScroll.clientHeight).toBeGreaterThanOrEqual(
      finalScroll.scrollHeight - 1
    );

    const [workspaceBounds, finalLinkBounds] = await Promise.all([
      workspace.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          top: bounds.top,
          bottom: bounds.bottom,
          right: bounds.right,
          viewportWidth: window.innerWidth
        };
      }),
      finalLink.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { top: bounds.top, bottom: bounds.bottom };
      })
    ]);

    expect(workspaceBounds.right).toBeGreaterThanOrEqual(workspaceBounds.viewportWidth - 20);
    expect(finalLinkBounds.top).toBeGreaterThanOrEqual(workspaceBounds.top - 1);
    expect(finalLinkBounds.bottom).toBeLessThanOrEqual(workspaceBounds.bottom + 1);
  });
});


