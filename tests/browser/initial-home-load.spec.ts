import { expect, test } from '@playwright/test';

test('keeps the full application out of the initial Home module graph', async ({ page }) => {
  const requestedPaths: string[] = [];
  page.on('request', (request) => requestedPaths.push(new URL(request.url()).pathname));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ChainWhisper', exact: true })).toBeVisible();
  expect(requestedPaths).not.toContain('/src/App.tsx');

  await page.getByRole('button', { name: 'Open Trading', exact: true }).first().click();
  await expect(page).toHaveURL(/\/otc\/desk$/);
  await expect.poll(() => requestedPaths.includes('/src/App.tsx')).toBe(true);
  await expect(page.getByRole('navigation', { name: 'Trading product' })).toBeVisible();
});

test('keeps the lightweight Home shell contained on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'ChainWhisper', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole('button', { name: 'Open Trading', exact: true }).first().click();
  await expect(page).toHaveURL(/\/otc\/desk$/);
  await expect(page.getByRole('navigation', { name: 'Trading product' })).toBeVisible();
});
