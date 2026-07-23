import { expect, test } from '@playwright/test';

test.describe('Agent App Help', () => {
  test('answers common questions locally and keeps paid trading help separate', async ({ page }) => {
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
});
