import { expect, test } from '@playwright/test';
type Control = { calls: string[]; set(value: { balance?: string; delayed?: boolean; reorg?: boolean }): void; release(): void; changeOwner(): void; returns(): number };
const control = (page: import('@playwright/test').Page) => ({
  set: (value: Parameters<Control['set']>[0]) => page.evaluate(v => (window as unknown as { __gas: Control }).__gas.set(v), value),
  calls: () => page.evaluate(() => (window as unknown as { __gas: Control }).__gas.calls),
  returns: () => page.evaluate(() => (window as unknown as { __gas: Control }).__gas.returns())
});
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.fallback() : route.abort());
  // Keep the bounded gas controls independent of the chart worker's current
  // appChain edits. Full App lint/build/tests verify the actual bridge later.
  await page.route('**/src/lib/appChain.ts', route => route.fulfill({ contentType: 'application/javascript',
    body: "export { readOfficialTestnetGas } from '/src/lib/officialTestnetFaucet.ts';" }));
  await page.goto('/tests/browser/fixtures/official-testnet-gas-harness.html');
});
test('public gas, explicit unsupported assets and keyboard faucet return refresh once without sends', async ({ page }, info) => {
  const region = page.getByRole('region', { name: 'Official Testnet gas and token support' });
  await region.getByRole('button', { name: 'Check native Testnet gas' }).click();
  await expect(region.getByRole('status')).toContainText('No native gas');
  await region.getByText('Official faucet token support', { exact: true }).click();
  await expect(region.getByRole('table')).toContainText('USDC');
  await expect(region.getByRole('table')).toBeVisible();
  await expect(region).toContainText('not enabled for private DEX swaps');
  await control(page).set({ balance: '0xde0b6b3a7640000' });
  const link = region.getByRole('link', { name: 'Open official COTI Testnet faucet' });
  await expect(link).toHaveAttribute('href', 'https://faucet.testnet.coti.io/');
  await link.focus();
  const popupWait = page.waitForEvent('popup'); await link.press('Enter');
  const popup = await popupWait; await popup.close();
  // Deterministic local focus event, no external faucet claim.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(region).toContainText('Gas balance: 1.0 COTI');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(await control(page).returns()).toBe(1);
  expect(await control(page).calls()).toHaveLength(12);
  expect((await control(page).calls()).some(m => /send|sign|approve|requestAccounts/.test(m))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  for (const action of [link, region.getByRole('button', { name: 'Check native Testnet gas' })]) expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await region.getByRole('table').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('official-gas-controls.png'), fullPage: true });
});
test('owner replacement discards delayed gas and prevents a stale faucet-return callback', async ({ page }) => {
  await control(page).set({ delayed: true });
  const region = page.getByRole('region', { name: 'Official Testnet gas and token support' });
  await region.getByRole('button', { name: 'Check native Testnet gas' }).click();
  await expect.poll(async () => (await control(page).calls()).includes('eth_getBalance')).toBe(true);
  const popupWait = page.waitForEvent('popup');
  await region.getByRole('link', { name: 'Open official COTI Testnet faucet' }).click();
  const popup = await popupWait;
  await page.evaluate(() => { const c = (window as unknown as { __gas: Control }).__gas; c.changeOwner(); });
  await expect(region.getByRole('button', { name: 'Check native Testnet gas' })).toBeDisabled();
  await popup.close();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.evaluate(() => (window as unknown as { __gas: Control }).__gas.release());
  await expect(region.getByRole('status')).not.toContainText('No native gas');
  await expect(region).not.toContainText('Gas balance:');
  expect(await control(page).returns()).toBe(0);
  expect(await control(page).calls()).toHaveLength(6);
});
test('reorg rejects the whole gas result', async ({ page }) => {
  await control(page).set({ reorg: true });
  const region = page.getByRole('region', { name: 'Official Testnet gas and token support' });
  await region.getByRole('button', { name: 'Check native Testnet gas' }).click();
  await expect(region.getByRole('status')).toContainText('reorg');
  await expect(region).not.toContainText('Gas balance:');
});
