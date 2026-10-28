import { expect, test } from '@playwright/test';

test.describe('Agent App Help', () => {
  test('answers common questions locally and keeps paid trading help separate', async ({ page }) => {
    const paidRequests: string[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && /\/functions\/v1\/trade-agent(?:\?|$)/u.test(request.url())) paidRequests.push(request.postData() ?? '{}');
    });
    await page.setViewportSize({ width: 2048, height: 1200 });
    await page.goto('/otc/agent');
    const tools = page.getByRole('navigation', { name: 'Agent tools' });
    await tools.getByRole('button', { name: 'App Help', exact: true }).click();
    await expect(tools.getByRole('button', { name: 'App Help', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText(/Free product help/)).toBeVisible();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByText('How do I start?')).toBeVisible();
    const answer = page.locator('.p2p-agent-message').filter({ hasText: /Choose an app from Home\./ });
    await expect(answer).toBeVisible();
    await expect(answer.getByText(/Verified ChainWhisper help/)).toBeVisible();
    await expect(answer.getByRole('button', { name: 'Browser wallet' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Open (Home|Chat)/ })).toHaveCount(0);
    await expect(page).toHaveURL(/\/otc\/agent$/);
    await tools.getByRole('button', { name: 'Trade Agent', exact: true }).click();
    await expect(page.getByText('What do you want to do?')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pay and send' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Compare prices' }).click();
    await expect(page.getByRole('textbox', { name: 'Ask the Trade Agent' })).toHaveValue(/^Compare prices to (buy|sell) /);
    await expect(page.getByRole('textbox', { name: 'Ask the Trade Agent' })).not.toHaveValue(/reference-only|do not require|ask for/i);
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
    expect(paidRequests.map(body => JSON.parse(body).kind)).toEqual(paidRequests.map(() => 'estimate'));
  });

  test('keeps App Help usable without horizontal overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/otc/agent');
    const help = page.getByRole('navigation', { name: 'Agent tools' }).getByRole('button', { name: 'App Help', exact: true });
    await help.click();
    await expect(help).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: 'Browser wallet' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.getByRole('button', { name: 'Start', exact: true }).evaluate(button => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  });

  test('keeps critical Agent states free of browser errors and horizontal overflow', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', error => errors.push(error.message));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 950 });
      await page.goto('/otc/agent');
      const tools = page.getByRole('navigation', { name: 'Agent tools' });
      for (const name of ['App Help', 'Trade Agent', 'MCP for agents']) {
        await tools.getByRole('button', { name, exact: true }).click();
        await expect(tools.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      }
    }
    expect(errors).toEqual([]);
  });

  test('keeps the Trade Agent composer usable beside its attached trading context', async ({ page }) => {
    await page.setViewportSize({ width: 2048, height: 747 });
    await page.goto('/otc/agent');
    const composer = page.locator('.p2p-agent-composer-trade');
    await expect(composer).toBeVisible();
    await expect(page.getByText('Attached context', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Draft limit order' }).click();
    await expect(page.getByRole('textbox', { name: 'Ask the Trade Agent' })).toHaveValue(/^Draft a limit order to (buy|sell) /);
    const layout = await composer.evaluate(element => {
      const prompt = element.querySelector<HTMLElement>('.p2p-agent-prompt')!;
      const textarea = prompt.querySelector('textarea')!;
      const style = getComputedStyle(element);
      const contentWidth = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return { promptWidth: prompt.getBoundingClientRect().width, contentWidth,
        overflow: element.scrollWidth - element.clientWidth, textareaHeight: textarea.getBoundingClientRect().height };
    });
    expect(Math.abs(layout.promptWidth - layout.contentWidth)).toBeLessThanOrEqual(2);
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.textareaHeight).toBeGreaterThanOrEqual(44);
    await page.setViewportSize({ width: 390, height: 844 });
    await composer.scrollIntoViewIfNeeded();
    await expect(composer).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
});

