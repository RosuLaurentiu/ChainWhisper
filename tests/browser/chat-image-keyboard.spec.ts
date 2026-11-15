import { expect, test } from '@playwright/test';

test('image preview keeps keyboard focus inside and restores its trigger on close', async ({ page, baseURL }) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL!).origin
    ? route.continue() : route.abort());
  await page.goto('/tests/browser/chat-image-keyboard-harness.html');
  const trigger = page.getByRole('button', { name: 'Open image preview', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Image preview', exact: true });
  const close = page.getByRole('button', { name: 'Close image preview', exact: true });

  await trigger.press('Enter');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.press('Enter');
  await expect(close).toBeFocused();
  await close.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
