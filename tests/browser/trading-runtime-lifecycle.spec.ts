import { expect, test } from '@playwright/test';

test('keeps the Direct-trade action runtime alive across equivalent privacy refreshes', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/trading-runtime-lifecycle-harness.html');
  await expect(page.getByTestId('runtime-generation')).toHaveText('1');
  await expect(page.getByTestId('runtime-closures')).toHaveText('0');

  await page.getByRole('button', { name: 'Refresh equivalent privacy' }).click();

  await expect(page.getByTestId('runtime-generation')).toHaveText('1');
  await expect(page.getByTestId('runtime-closures')).toHaveText('0');
});
