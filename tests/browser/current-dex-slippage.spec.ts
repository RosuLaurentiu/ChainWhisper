import { expect, test, type Page } from '@playwright/test';
import { Interface } from '@coti-io/coti-ethers';
import { CURRENT_SLIPPAGE_DEX_QUOTE_ABI } from '../../src/lib/currentDexOperation';

// LOCAL ONLY: exact staged metadata, production owner/receipt/submission path,
// synthetic runtime preimages and private SDK seals. No extension or live RPC.
type Control = {
  snapshot(): { sends: Array<{ name: string; data: string }>; inputSignatureRequests: number; pending: string | null };
  set(next: { ready?: boolean; settled?: boolean; revoked?: boolean; contextDrift?: boolean; receiptAvailable?: boolean; waitReceipt?: boolean; adverseDelivery?: boolean }): void;
  exportChain(): string;
  restoreChain(raw: string): void;
};
const control = (page: Page) => ({
  snapshot: () => page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.snapshot()),
  set: (next: Parameters<Control['set']>[0]) => page.evaluate(value => (window as unknown as { __currentJourney: Control }).__currentJourney.set(value), next)
});
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.fallback() : route.abort());
  await page.route('**/src/features/wallet/ownerCotiMetaMaskCapability.ts', route => route.fulfill({ contentType: 'application/javascript',
    body: 'export const issueOwnerCotiMetaMaskCapability = async ({bindCapability}) => bindCapability(window.__currentJourney.binding());' }));
  await page.route('**/src/lib/dexV2Deployment.ts', async route => {
    const response = await route.fetch(), source = await response.text();
    expect(source).toContain('const CURRENT_CHEAP_DEX_CANDIDATE = ARCHIVED_CHEAP_DEX_CANDIDATE;');
    await route.fulfill({ response, body: source.replace('const CURRENT_CHEAP_DEX_CANDIDATE = ARCHIVED_CHEAP_DEX_CANDIDATE;',
      'const CURRENT_CHEAP_DEX_CANDIDATE = STAGED_QUOTE_SLIPPAGE_CANDIDATE;') });
  });
  await page.route('**/src/lib/dexV2Chain.ts', async route => {
    const response = await route.fetch(), source = await response.text();
    expect(source).toContain('keccak256(code).toLowerCase()');
    await route.fulfill({ response, body: source.replace('keccak256(code).toLowerCase()',
      '(window.__currentJourney.runtimeHashes[code] ?? keccak256(code)).toLowerCase()') });
  });
  await page.route('**/dex', route => route.fulfill({ contentType: 'text/html', body:
    '<html><head><title>Staged slippage local fixture</title><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root" class="app-shell app-shell-wallet app-shell-dex-v2"></div><script type="module" src="/tests/browser/current-dex-journey.fixture.ts"></script></body></html>' }));
  await page.goto('/dex');
  await expect(page.getByRole('region', { name: 'Private Swap', exact: true })).toBeVisible();
});
async function prepare(page: Page, asyncMode = false, tolerance = '0.5', price?: string, inverse = false) {
  const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
  await expect(swap.getByLabel('Slippage percent')).toHaveValue('0.5');
  if (asyncMode) await swap.getByRole('button', { name: 'Multi-source', exact: true }).click();
  if (inverse) {
    await swap.getByRole('button', { name: 'Check current contracts', exact: true }).click();
    await swap.getByRole('button', { name: 'Reverse price ratio', exact: true }).click();
  }
  await swap.getByLabel('Slippage percent').fill(tolerance);
  await swap.getByLabel('Maximum input', { exact: true }).fill('0.00000000000000002');
  await swap.getByLabel('Minimum net output', { exact: true }).fill('0.000000000000000001');
  await swap.locator('.dex-v2-current-advanced > summary').click();
  await swap.getByLabel('Minimum input fill', { exact: true }).fill('25');
  if (price !== undefined) await swap.getByLabel('Price limit', { exact: true }).fill(price);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  return swap;
}
async function ready(page: Page, asyncMode = false, tolerance = '0.5', price?: string, inverse = false) {
  const swap = await prepare(page, asyncMode, tolerance, price, inverse);
  const dialog = page.getByRole('dialog', { name: 'Confirm private Quote inputs', exact: true });
  await expect(dialog).toContainText(`${tolerance}% of the Quote net rate`);
  if (price === undefined) await expect(dialog).toContainText('No optional hard price limit');
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(swap.getByRole('status')).toContainText('Open submitted');
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  if (asyncMode) {
    await control(page).set({ ready: true });
    await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  }
  await expect(swap.getByRole('button', { name: 'Review and Accept', exact: true })).toBeEnabled();
  return swap;
}
for (const asyncMode of [false, true]) test(`${asyncMode ? 'async' : 'Fast'} default 0.5% without guessed rate completes protected partial delivery`, async ({ page }, info) => {
  const swap = await ready(page, asyncMode);
  await swap.getByRole('button', { name: 'Review and Accept', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review private quote', exact: true });
  await expect(review).toContainText('You pay'); await expect(review).toContainText('You receive'); await expect(review).toContainText('Average price');
  await expect(review).not.toContainText('Slippage');
  await review.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(swap.getByRole('status')).toContainText('Accept submitted');
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  if (asyncMode) { await control(page).set({ settled: true }); await swap.getByRole('button', { name: 'Check current state', exact: true }).click(); }
  await expect(swap.getByRole('status')).toHaveText('Settlement confirmed by the private receipt.');
  await expect(swap).toContainText('refunded 0.000000000000000005 Test token 1');
  const sent = (await control(page).snapshot()).sends, name = asyncMode ? 'quoteCheapAsync' : 'quoteFastPool';
  expect(sent.map(row => row.name)).toEqual([name, asyncMode ? 'acceptPrivateSwapV1' : 'acceptFastPool']);
  const decoded = new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI).decodeFunctionData(name, sent[0].data);
  expect((asyncMode ? decoded.request : decoded).toleranceBps).toBe(50n);
  await page.screenshot({ path: info.outputPath('protected-partial.png'), fullPage: true });
});
test('custom tolerance and inverse hard limit preserve the economic input/output pair', async ({ page }) => {
  const swap = await ready(page, false, '1.25', '1', true);
  await expect(swap.locator('.dex-v2-current-amounts > label')).toContainText('Test token 1');
  await expect(swap.locator('.dex-v2-quote-output')).toContainText('Test token 0');
  const sent = (await control(page).snapshot()).sends[0];
  const decoded = new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI).decodeFunctionData('quoteFastPool', sent.data);
  expect(decoded.toleranceBps).toBe(125n);
  expect(decoded.inputToken.toLowerCase()).toBe('0x96d97450d36eb65804ce2f84d0fe6c9ef52f264a');
  await expect(swap.getByLabel('Slippage percent')).toBeDisabled();
});
for (const fault of ['context', 'owner'] as const) test(`${fault} change during Accept review prevents a second send`, async ({ page }) => {
  const swap = await ready(page);
  await swap.getByRole('button', { name: 'Review and Accept', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review private quote', exact: true });
  await expect(review).toBeVisible();
  await control(page).set(fault === 'context' ? { contextDrift: true } : { revoked: true });
  await review.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(swap.getByRole('status')).toContainText(fault === 'context' ? 'submitted intent' : 'revoked');
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  await expect(swap.getByLabel('Slippage percent')).toHaveValue('0.5');
});
test('invalid tolerance fails before private input authorization', async ({ page }) => {
  const swap = await prepare(page, false, '0.001');
  await expect(swap.getByRole('status')).toContainText('at most two decimal places');
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  expect((await control(page).snapshot()).sends).toHaveLength(0);
});
test('pending Quote reload reconciles its saved call without restoring Accept authority', async ({ page }) => {
  await control(page).set({ receiptAvailable: false });
  const swap = await prepare(page);
  await page.getByRole('dialog', { name: 'Confirm private Quote inputs' }).getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(swap.getByRole('status')).toContainText('still pending');
  const ledger = await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.exportChain());
  await page.reload();
  await page.evaluate(raw => (window as unknown as { __currentJourney: Control }).__currentJourney.restoreChain(raw), ledger);
  await control(page).set({ receiptAvailable: true });
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.getByRole('status')).toContainText('no authenticated Quote origin');
  await expect(swap.getByRole('button', { name: 'Review and Accept', exact: true })).toHaveCount(0);
  expect((await control(page).snapshot()).sends).toHaveLength(1);
});
test('private delivery outside the authorized Quote rate is rejected even with valid accounting', async ({ page }) => {
  const swap = await ready(page);
  await swap.getByRole('button', { name: 'Review and Accept', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review private quote', exact: true });
  await expect(review).toBeVisible();
  await control(page).set({ adverseDelivery: true });
  await review.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(swap.getByRole('status')).toContainText('Accept submitted');
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.getByRole('status')).toContainText('reviewed Quote tolerance');
  await expect(swap.getByText(/^Paid /)).toHaveCount(0);
  expect((await control(page).snapshot()).sends).toHaveLength(2);
  expect((await control(page).snapshot()).pending).not.toBeNull();
  const ledger = await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.exportChain());
  await page.reload();
  await page.evaluate(raw => (window as unknown as { __currentJourney: Control }).__currentJourney.restoreChain(raw), ledger);
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.getByRole('status')).toContainText('saved action remains blocked');
  expect((await control(page).snapshot()).pending).not.toBeNull();
  expect((await control(page).snapshot()).sends).toHaveLength(2);
});
test('funded async owner recovery verifies a zero-charge full refund', async ({ page }) => {
  const swap = await ready(page, true);
  await swap.getByRole('button', { name: 'Review and Accept', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review private quote' }).getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(swap.getByRole('status')).toContainText('Accept submitted');
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await swap.getByRole('button', { name: 'Recover swap', exact: true }).click();
  await page.getByRole('dialog', { name: 'Recover private swap' }).getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(swap.getByRole('status')).toContainText('Release submitted');
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.getByRole('status')).toHaveText('Released with a private refund receipt.');
  await expect(swap).toContainText('refunded 0.00000000000000002 Test token 1');
  expect((await control(page).snapshot()).pending).toBeNull();
});
