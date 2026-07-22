import { expect, test } from '@playwright/test';

test.describe('Privacy Portal', () => {
  test('keeps WISP in the unified selector and scopes legacy recovery to WISP', async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 1024 });
    await page.goto('/portal');

    await expect(page.getByRole('heading', { name: 'Privacy Portal' })).toBeVisible();

    const rail = page.getByRole('complementary', { name: 'Supported privacy tokens' });
    const tokenButtons = rail.locator('.privacy-token-list > button');
    await expect(tokenButtons).toHaveCount(8);
    await expect(tokenButtons.first()).toContainText('WISP');
    await expect(page.getByText('Legacy pWISP recovery', { exact: true })).toHaveCount(0);

    await tokenButtons.first().click();

    await expect(page.getByText('This pair is provided by ChainWhisper, not an official COTI bridge.')).toBeVisible();
    const outputPanel = page.locator('.privacy-wisp-card .swap-asset-panel-output');
    await expect(outputPanel).toContainText('Balance: Locked');

    await page.getByRole('button', { name: 'To public', exact: true }).click();
    await expect(outputPanel).toContainText('Balance: Unavailable');
    await expect(page.locator('.privacy-wisp-card').getByRole('button', { name: 'Max' })).toBeDisabled();

    const legacyRecovery = page.locator('.privacy-legacy-recovery');
    await expect(legacyRecovery).toBeVisible();
    await expect(page.locator('.privacy-wisp-card .privacy-legacy-recovery')).toHaveCount(1);
    await expect(page.locator('.swap-page-panel > .privacy-legacy-recovery')).toHaveCount(0);
    await expect(legacyRecovery).not.toHaveAttribute('open', '');

    await rail.getByRole('button', { name: 'COTI', exact: true }).click();
    await expect(legacyRecovery).toHaveCount(0);
  });

  test('uses the in-card token picker on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/portal');

    await expect(page.locator('.privacy-token-rail')).toBeHidden();
    const picker = page.locator('.privacy-mobile-token-picker > button');
    await expect(picker).toBeVisible();
    await picker.click();

    const menu = page.getByRole('menu', { name: 'Select a privacy token' });
    await expect(menu).toBeVisible();
    await expect(menu.locator('button')).toHaveCount(8);
    await expect(menu.locator('button').first()).toContainText('WISP');

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(picker).toBeFocused();
  });

  for (const route of ['/swap', '/shield', '/whisper-shield']) {
    test(`${route} remains a Privacy Portal alias`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/portal$/);
      await expect(page.getByRole('heading', { name: 'Privacy Portal' })).toBeVisible();
    });
  }
});
