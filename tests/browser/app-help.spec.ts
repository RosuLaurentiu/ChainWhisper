import { expect, test } from '@playwright/test';

test.describe('Agent App Help', () => {
  test('answers common questions locally and keeps paid trading help separate', async ({ page }) => {
    await page.setViewportSize({ width: 2048, height: 1200 });
    await page.goto('/otc/agent');

    await expect(page.getByRole('tab', { name: 'App Help' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Free — no wallet required.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByText('How do I start?')).toBeVisible();
    const localAnswer = page.locator('.p2p-agent-message').filter({ hasText: /Choose an app from Home\./ });
    await expect(localAnswer).toBeVisible();
    await expect(localAnswer.getByText(/Verified ChainWhisper help/)).toBeVisible();
    await expect(localAnswer.getByRole('button', { name: 'Wallet vs account' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Open (Home|Chat)/ })).toHaveCount(0);
    await expect(page).toHaveURL(/\/otc\/agent$/);

    await page.getByRole('tab', { name: 'Trade Agent' }).click();
    await expect(page.getByText('Trading help, not autopilot.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pay and send' })).toBeDisabled();
    await page.getByRole('button', { name: 'Compare price references' }).click();
    await expect(page.getByRole('textbox', { name: 'Ask the Trade Agent' })).toHaveValue(
      /^Compare prices to (buy|sell) /
    );
    await expect(page.getByRole('textbox', { name: 'Ask the Trade Agent' })).not.toHaveValue(
      /reference-only|do not require|ask for/i
    );

    const compactLayout = await page.locator('.p2p-agent-panel').evaluate((panel) => {
      const hero = panel.querySelector<HTMLElement>('.p2p-agent-hero');
      const modeToggle = panel.querySelector<HTMLElement>('.p2p-agent-mode-toggle');
      const messages = panel.querySelector<HTMLElement>('.p2p-agent-messages');
      const composer = panel.querySelector<HTMLElement>('.p2p-agent-composer');
      const textarea = panel.querySelector<HTMLTextAreaElement>('.p2p-agent-prompt textarea');
      const section = panel.closest<HTMLElement>('.p2p-agent-section');
      if (!hero || !modeToggle || !messages || !composer || !textarea || !section) {
        return null;
      }
      const composerBox = composer.getBoundingClientRect();
      const heroBox = hero.getBoundingClientRect();
      const messagesBox = messages.getBoundingClientRect();
      const panelBox = panel.getBoundingClientRect();
      const sectionBox = section.getBoundingClientRect();
      const toggleBox = modeToggle.getBoundingClientRect();
      return {
        composerBottomGap: panelBox.bottom - composerBox.bottom,
        composerHeight: composerBox.height,
        headerTopDelta: Math.abs(heroBox.top - toggleBox.top),
        messagesAboveComposer: composerBox.top - messagesBox.bottom,
        panelBottomGap: sectionBox.bottom - panelBox.bottom,
        panelGapDifference: Math.abs(
          sectionBox.bottom - panelBox.bottom - (panelBox.top - sectionBox.top)
        ),
        panelTopGap: panelBox.top - sectionBox.top,
        textareaHeight: textarea.getBoundingClientRect().height
      };
    });
    expect(compactLayout).not.toBeNull();
    expect(compactLayout!.headerTopDelta).toBeLessThanOrEqual(2);
    expect(compactLayout!.panelTopGap).toBeLessThanOrEqual(20);
    expect(compactLayout!.panelBottomGap).toBeLessThanOrEqual(20);
    expect(compactLayout!.panelGapDifference).toBeLessThanOrEqual(2);
    expect(compactLayout!.messagesAboveComposer).toBeGreaterThanOrEqual(0);
    expect(compactLayout!.composerBottomGap).toBeGreaterThanOrEqual(0);
    expect(compactLayout!.composerHeight).toBeLessThanOrEqual(160);
    expect(compactLayout!.textareaHeight).toBeLessThanOrEqual(44);
  });

  test('keeps App Help usable without horizontal overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/otc/agent');

    await expect(page.getByRole('tab', { name: 'App Help' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Wallet vs account' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1))
      .toBe(true);
    await expect
      .poll(() => page.getByRole('button', { name: 'Start', exact: true }).evaluate((button) => button.getBoundingClientRect().height))
      .toBeGreaterThanOrEqual(44);
  });

  test('keeps the Trade Agent composer full width beside an order drawer', async ({ page }) => {
    await page.setViewportSize({ width: 2048, height: 747 });
    await page.goto('/trades/recurring?order=1');

    const terminal = page.locator('.p2p-terminal-shell-recurring');
    await expect(terminal).toBeVisible({ timeout: 30_000 });
    await terminal.getByRole('button', { name: 'Ask Agent' }).click();
    await expect(page).toHaveURL(/\/otc\/agent$/);
    await page.goBack();

    const composer = page.locator('.p2p-trading-shell-drawer-open .p2p-agent-composer-trade');
    await expect(composer).toBeVisible();
    await expect(page.locator('.p2p-trading-shell-drawer-open .p2p-terminal-shell-recurring')).toBeVisible();
    await page.getByRole('button', { name: 'Draft a counter' }).click();
    await expect(page.getByRole('textbox', { name: 'Ask the Trade Agent' })).toHaveValue(
      'Draft a counter for this order.'
    );

    const layout = await composer.evaluate((composerElement) => {
      const actions = composerElement.querySelector<HTMLElement>('.p2p-agent-quick-actions');
      const prompt = composerElement.querySelector<HTMLElement>('.p2p-agent-prompt');
      const textarea = prompt?.querySelector<HTMLTextAreaElement>('textarea');
      const actionButtons = Array.from(actions?.querySelectorAll('button') ?? []);
      if (!actions || !prompt || !textarea || actionButtons.length === 0) {
        return null;
      }
      const composerBox = composerElement.getBoundingClientRect();
      const actionsBox = actions.getBoundingClientRect();
      const promptBox = prompt.getBoundingClientRect();
      return {
        actionButtonMinHeight: Math.min(...actionButtons.map((button) => button.getBoundingClientRect().height)),
        actionsBottom: actionsBox.bottom,
        actionsFlexWrap: window.getComputedStyle(actions).flexWrap,
        composerWidth: composerBox.width,
        hasOverflow: composerElement.scrollWidth > composerElement.clientWidth + 1,
        height: composerBox.height,
        promptTop: promptBox.top,
        promptWidth: promptBox.width,
        textareaHeight: textarea.getBoundingClientRect().height
      };
    });

    expect(layout).not.toBeNull();
    expect(layout!.actionButtonMinHeight).toBeGreaterThanOrEqual(44);
    expect(layout!.actionsFlexWrap).toBe('wrap');
    expect(layout!.promptTop).toBeGreaterThanOrEqual(layout!.actionsBottom);
    expect(layout!.promptWidth).toBeGreaterThanOrEqual(layout!.composerWidth - 2);
    expect(layout!.height).toBeLessThanOrEqual(160);
    expect(layout!.textareaHeight).toBeLessThanOrEqual(44);
    expect(layout!.hasOverflow).toBe(false);

    const updateLayout = await page
      .locator('.p2p-agent-message-status')
      .filter({ hasText: 'Recurring OTC #1 loaded.' })
      .evaluate((message) => {
        const label = message.querySelector<HTMLElement>('span');
        const text = message.querySelector<HTMLElement>('p');
        if (!label || !text) {
          return null;
        }
        const labelBox = label.getBoundingClientRect();
        const messageBox = message.getBoundingClientRect();
        const textBox = text.getBoundingClientRect();
        return {
          height: messageBox.height,
          labelTop: labelBox.top,
          textTop: textBox.top
        };
      });
    expect(updateLayout).not.toBeNull();
    expect(updateLayout!.height).toBeLessThanOrEqual(32);
    expect(Math.abs(updateLayout!.labelTop - updateLayout!.textTop)).toBeLessThanOrEqual(3);

    await expect
      .poll(() => page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1))
      .toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.p2p-agent-section')).toBeHidden();
    await expect(page.locator('.standalone-trade-detail-section')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1))
      .toBe(true);
  });
});
