import { expect, test } from '@playwright/test';

test.describe('ChainWhisper Agent Setup', () => {
  test('uses three keyboard-complete tabs and copies setup without wallet or payment side effects', async ({
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

    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    const helpTab = page.getByRole('tab', { name: 'App Help' });
    const tradeTab = page.getByRole('tab', { name: 'Trade Agent' });
    const setupTab = page.getByRole('tab', { name: 'Agent Setup' });

    await helpTab.focus();
    await helpTab.press('End');
    await expect(setupTab).toBeFocused();
    await expect(setupTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Connect your agent to ChainWhisper.')).toBeVisible();
    await expect(
      page.getByText('One package. Two MCP connections. No separate skill required.')
    ).toBeVisible();

    await expect(
      page.getByText('npm install --global @chainwhisper/agent-tools@0.1.0-beta.0', {
        exact: true
      })
    ).toBeVisible();
    await expect(page.getByText('ChainWhisper planning')).toBeVisible();
    await expect(page.getByText('Local COTI signing')).toBeVisible();
    await expect(page.getByText(/Encrypted private messaging is included/)).toBeVisible();
    await expect(page.getByText('Optional ecosystem tools')).toBeVisible();
    await expect(page.getByText('Add broader COTI and market tools')).toBeVisible();
    await expect(page.getByRole('link', { name: /General COTI MCP/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /COTI skills/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Carbon MCP/ })).toBeVisible();
    await expect(page.getByText('Connected', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pay and send' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Connect account' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Copy setup prompt' }).click();
    await expect(page.getByRole('button', { name: 'Setup prompt copied' })).toBeVisible();
    await expect(page.getByText('Paste it into your agent configuration chat.')).toBeVisible();
    expect(tradeAgentPaymentRequests).toEqual([]);

    await setupTab.press('ArrowRight');
    await expect(helpTab).toBeFocused();
    await helpTab.press('ArrowRight');
    await expect(tradeTab).toBeFocused();
    await tradeTab.press('ArrowRight');
    await expect(setupTab).toBeFocused();
  });

  test('stacks setup content without horizontal overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/otc/agent');
    await page.getByRole('tab', { name: 'Agent Setup' }).click();

    await expect(
      page.getByText('One package. Two MCP connections. No separate skill required.')
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
          .getByRole('button', { name: 'Copy setup prompt' })
          .evaluate((button) => button.getBoundingClientRect().height)
      )
      .toBeGreaterThanOrEqual(44);
  });
});
