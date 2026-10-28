import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.fallback() : route.abort());
  await page.goto('/tests/browser/fixtures/trade-review-harness.html');
});

test('long funding details remain readable on mobile', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 620 });
  await page.getByRole('button', { name: 'Funding review', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Approve exact swap input' });
  const funding = dialog.locator('.trade-action-confirm-funding-row small');
  await expect(funding).toContainText('Only the exact amount required for this action is approved.');
  await page.screenshot({ path: info.outputPath('funding-mobile.png'), animations: 'disabled' });
  expect(await funding.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const action = dialog.getByRole('button', { name: 'Continue', exact: true });
  const box = await action.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(620);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Escape and Cancel close without confirming and return focus', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Accept quote', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Review private quote' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.getByText('Review closed. No transaction sent.', { exact: true })).toBeVisible();
  await opener.click();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(opener).toBeFocused();
});

test('protection review has only its dismiss action', async ({ page }) => {
  await page.getByRole('button', { name: 'Protection review', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Quote cannot be accepted' });
  await expect(dialog).toContainText('Below your minimum output of 26.0 BCN. No swap was sent.');
  await expect(dialog.getByRole('button')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('Quote and recovery reviews keep their facts and explicit actions', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Quote inputs', exact: true }).click();
  const inputs = page.getByRole('dialog', { name: 'Confirm private Quote inputs' });
  await expect(inputs).toContainText('25.0 HBR');
  await expect(inputs).toContainText('0.5% of the Quote net rate');
  await page.screenshot({ path: info.outputPath('quote-inputs.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Accept quote', exact: true }).click();
  const accept = page.getByRole('dialog', { name: 'Review private quote' });
  await expect(accept).toContainText('26.24 BCN');
  await expect(accept).toContainText('0.0105 COTI');
  await expect(accept).toContainText('0.021 COTI');
  await expect(accept.locator('.modal-copy')).toHaveText('Expected amounts, after fees.');
  await page.screenshot({ path: info.outputPath('accept.png'), animations: 'disabled' });
  await accept.getByText('Price and slippage', { exact: true }).click();
  await expect(accept.getByText('Price impact compares the net Quote rate', { exact: false })).toBeVisible();
  await accept.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(page.getByText('Review confirmed. Local preview only; no transaction sent.', { exact: true })).toBeVisible();

  await page.getByRole('navigation', { name: 'Preview states' }).getByRole('button', { name: 'Recover swap', exact: true }).click();
  const recover = page.getByRole('dialog', { name: 'Recover private swap' });
  await expect(recover).toContainText('Verify the refund after confirmation.');
  await expect(recover.locator('.trade-action-confirm-stats')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('recovery.png'), animations: 'disabled' });
  await recover.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('navigation', { name: 'Preview states' }).getByRole('button', { name: 'Cancel swap', exact: true }).click();
  const cancel = page.getByRole('dialog', { name: 'Cancel private swap' });
  await expect(cancel.getByRole('button', { name: 'Cancel swap', exact: true })).toBeVisible();
  await expect(cancel.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('pending and recovery states keep a single status area and manual controls', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const states = page.getByRole('navigation', { name: 'Status previews' });
  const status = page.getByRole('region', { name: 'Swap status' });
  await expect(status.getByRole('status')).toHaveText('Accept is mined; settlement remains pending.');
  await expect(status.getByRole('button', { name: 'Recover swap' })).toHaveCount(0);
  await expect(status.getByRole('button', { name: 'New Quote' })).toHaveCount(0);
  await states.getByRole('button', { name: 'Recovery', exact: true }).click();
  await expect(status.getByRole('button', { name: 'Recover swap', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('expired.png'), animations: 'disabled' });
  await states.getByRole('button', { name: 'Unknown', exact: true }).click();
  await expect(status).toContainText('do not resend');
  await status.getByText('DEX recovery details', { exact: true }).click();
  await status.getByRole('textbox', { name: 'Existing DEX transaction hash' }).fill('0x1234');
  await expect(status.getByRole('textbox')).toHaveValue('0x1234');
  expect(await status.getByRole('textbox').evaluate(element => Number.parseFloat(getComputedStyle(element).borderTopWidth))).toBeGreaterThan(0);
  await expect(status.getByRole('textbox')).toBeFocused();
  await status.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(page.getByText('Read-only status check selected. Local sample only.', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('unknown.png'), animations: 'disabled' });
  await states.getByRole('button', { name: 'Verified', exact: true }).click();
  await expect(status).toContainText('Paid 25.0 HBR; received 26.24 BCN; refunded 0.0 HBR.');
  await expect(status.getByRole('button', { name: 'New Quote', exact: true })).toBeVisible();
});

test('short mobile reviews scroll details while keeping both actions visible', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 620 });
  await page.getByRole('button', { name: 'Quote inputs', exact: true }).click();
  const inputs = page.getByRole('dialog', { name: 'Confirm private Quote inputs' });
  await inputs.getByText('0.021 COTI', { exact: true }).scrollIntoViewIfNeeded();
  await expect(inputs.getByText('0.021 COTI', { exact: true })).toBeInViewport();
  await expect(inputs.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  await expect(inputs.getByRole('button', { name: 'Continue', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('quote-mobile.png'), animations: 'disabled' });
  await inputs.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Accept quote', exact: true }).click();
  const accept = page.getByRole('dialog', { name: 'Review private quote' });
  await accept.getByText('Price and slippage', { exact: true }).click();
  await accept.getByText('Slippage protects the Quote net rate.', { exact: false }).scrollIntoViewIfNeeded();
  await expect(accept.getByRole('button', { name: 'Accept quote', exact: true })).toBeInViewport();
  await expect(accept.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('accept-mobile.png'), animations: 'disabled' });
});
