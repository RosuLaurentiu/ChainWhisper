import { expect, test, type Page } from '@playwright/test';
import { Interface } from '@coti-io/coti-ethers';
// The ABI is read in the page: src modules read import.meta.env, which only Vite supplies.
const slippageQuoteAbi = (page: Page) => page.evaluate(async () =>
  (await import('/src/lib/currentDexOperation.ts' as string)).CURRENT_SLIPPAGE_DEX_QUOTE_ABI as string[]);

// LOCAL ONLY: exact staged metadata, production owner/receipt/submission path,
// synthetic runtime preimages and private SDK seals. No extension or live RPC.
type Control = {
  snapshot(): { sends: Array<{ name: string; data: string }>; inputSignatureRequests: number; pending: string | null };
  set(next: { ready?: boolean; settled?: boolean; revoked?: boolean; contextDrift?: boolean; receiptAvailable?: boolean; waitReceipt?: boolean; adverseDelivery?: boolean; priceDisplayInverted?: boolean }): void;
  exportChain(): string;
  restoreChain(raw: string): void;
};
const control = (page: Page) => ({
  snapshot: () => page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.snapshot()),
  set: (next: Parameters<Control['set']>[0]) => page.evaluate(value => (window as unknown as { __currentJourney: Control }).__currentJourney.set(value), next)
});
// Build 13 tokens have 6 decimals: 0.00002 is 20 raw units and 0.000001 is 1 raw unit.
const HBR = '0x5181b25e7ad744e635fe048d388fd820f943e582';
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.fallback() : route.abort());
  await page.route('**/src/features/wallet/ownerCotiMetaMaskCapability.ts', route => route.fulfill({ contentType: 'application/javascript',
    body: 'export const issueOwnerCotiMetaMaskCapability = async ({bindCapability}) => bindCapability(window.__currentJourney.binding());' +
      ' export const hasCurrentDexBrowserSigner = () => true; export const releaseOwnerCotiMetaMaskProviderPool = () => {};' }));
  // The current build 13 candidate uses the quote-slippage protocol, so no candidate rewrite is necessary.
  // Synthetic preimage seam: the graph, the swap-funds reader and the token distribution reader each hash
  // contract code (and the vault deployment calldata). The fixture supplies the expected hash of each mock value.
  for (const [file, values] of [['dexV2Chain', ['code']], ['currentSharedDexTokenFunds', ['code']],
    ['currentSharedDexTokenDistribution', ['code', 'tx.input']]] as const) await page.route(`**/src/lib/${file}.ts`, async route => {
    const response = await route.fetch();
    let source = await response.text();
    for (const value of values) {
      expect(source).toContain(`keccak256(${value})`);
      source = source.replaceAll(`keccak256(${value})`, `(window.__currentJourney.runtimeHashes[${value}] ?? keccak256(${value}))`);
    }
    await route.fulfill({ response, body: source });
  });
  await page.route('**/dex', route => route.fulfill({ contentType: 'text/html', body:
    '<html><head><title>Staged slippage local fixture</title><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root" class="app-shell app-shell-wallet app-shell-dex-v2"></div><script type="module" src="/tests/browser/current-dex-journey.fixture.ts"></script></body></html>' }));
  await page.goto('/dex');
  await expect(page.getByRole('region', { name: 'Private Swap', exact: true })).toBeVisible();
});
const status = (swap: ReturnType<Page['getByRole']>) => swap.locator('.dex-v2-current-status');
const checkState = (swap: ReturnType<Page['getByRole']>) => swap.getByRole('button', { name: 'Check current state', exact: true }).click();
// Fills the Quote terms and selects Get Quote. The App has no window before the private input signatures
// (owner decision 2026-11-17); the protections show in the Slippage details and in the trade review.
async function prepare(page: Page, asyncMode = false, tolerance = '0.5', price?: string, inverse = false) {
  const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeEnabled();
  const slippage = swap.locator('.dex-v2-current-advanced').first();
  await expect(slippage.locator(':scope > summary')).toContainText('0.5%');
  if (asyncMode) await swap.getByRole('button', { name: 'Multi-source', exact: true }).click();
  // The header pair control reverses the price ratio in the App; the fixture has no header.
  if (inverse) await control(page).set({ priceDisplayInverted: true });
  await slippage.locator(':scope > summary').click();
  await expect(slippage.getByRole('button', { name: '0.5%', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await slippage.getByRole('button', { name: 'Custom', exact: true }).click();
  await swap.getByLabel('Slippage percent').fill(tolerance);
  await swap.getByLabel('Maximum input', { exact: true }).fill('0.00002');
  await slippage.locator('.dex-v2-extra-settings > summary').click();
  await swap.getByLabel('Minimum net output', { exact: true }).fill('0.000001');
  await swap.getByLabel('Minimum input fill', { exact: true }).fill('25');
  if (price !== undefined) await swap.getByLabel('Price limit', { exact: true }).fill(price);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  return swap;
}
// Returns with the private trade review open. A Fast Quote opens it after the mined Quote; an async
// Quote needs the keeper READY step and then Review and Accept.
async function review(page: Page, asyncMode = false, tolerance = '0.5', price?: string, inverse = false) {
  const swap = await prepare(page, asyncMode, tolerance, price, inverse);
  const dialog = page.getByRole('dialog', { name: 'Review private quote', exact: true });
  if (asyncMode) {
    await expect(status(swap)).toContainText('Quote preparation is in progress');
    await expect(swap.getByRole('button', { name: 'Review and Accept', exact: true })).toBeDisabled();
    await control(page).set({ ready: true });
    await checkState(swap);
    await expect(status(swap)).toHaveText('Private Quote is READY for review.');
    await swap.getByRole('button', { name: 'Review and Accept', exact: true }).click();
  }
  await expect(dialog).toContainText(`${tolerance}% of the Quote net rate`);
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  return { swap, dialog };
}
for (const asyncMode of [false, true]) test(`${asyncMode ? 'async' : 'Fast'} default 0.5% without guessed rate completes protected partial delivery`, async ({ page }, info) => {
  const { swap, dialog } = await review(page, asyncMode);
  await expect(dialog).toContainText('You pay'); await expect(dialog).toContainText('You receive'); await expect(dialog).toContainText('Average price');
  // The current review shows the slippage protection of the Quote (the old review did not).
  await expect(dialog).toContainText('Slippage protection0.5% of the Quote net rate');
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  if (asyncMode) {
    await expect(status(swap)).toHaveText('Accept is mined; settlement remains pending.');
    await control(page).set({ settled: true });
    await checkState(swap);
  }
  await expect(status(swap)).toHaveText('Settlement confirmed by the private receipt.');
  await expect(swap).toContainText('refunded 0.000005 HBR');
  const sent = (await control(page).snapshot()).sends, name = asyncMode ? 'quoteCheapAsync' : 'quoteFastPool';
  expect(sent.map(row => row.name)).toEqual([name, asyncMode ? 'acceptPrivateSwapV1' : 'acceptFastPool']);
  const decoded = new Interface(await slippageQuoteAbi(page)).decodeFunctionData(name, sent[0].data);
  expect((asyncMode ? decoded.request : decoded).toleranceBps).toBe(50n);
  await page.screenshot({ path: info.outputPath('protected-partial.png'), fullPage: true });
});
test('custom tolerance and inverse hard limit preserve the economic input/output pair', async ({ page }) => {
  const { swap, dialog } = await review(page, false, '1.25', '1', true);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(swap.locator('.dex-v2-amount-input')).toContainText('HBR');
  await expect(swap.locator('.dex-v2-quote-output')).toContainText('BCN');
  const sent = (await control(page).snapshot()).sends[0];
  const decoded = new Interface(await slippageQuoteAbi(page)).decodeFunctionData('quoteFastPool', sent.data);
  expect(decoded.toleranceBps).toBe(125n);
  expect(decoded.inputToken.toLowerCase()).toBe(HBR);
  await expect(swap.getByLabel('Slippage percent')).toBeDisabled();
});
for (const fault of ['context', 'owner'] as const) test(`${fault} change during Accept review prevents a second send`, async ({ page }) => {
  const { swap, dialog } = await review(page);
  await control(page).set(fault === 'context' ? { contextDrift: true } : { revoked: true });
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(status(swap)).toContainText(fault === 'context' ? 'submitted intent' : 'revoked');
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  await expect(swap.getByLabel('Slippage percent')).toHaveValue('0.5');
});
test('invalid tolerance fails before private input authorization', async ({ page }) => {
  const swap = await prepare(page, false, '0.001');
  await expect(status(swap)).toContainText('at most two decimal places');
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  expect((await control(page).snapshot()).sends).toHaveLength(0);
});
// The current App restores an open Quote of the same owner and privacy session from its saved, authenticated
// record and the chain (the old App showed "no authenticated Quote origin" here). The reload sends nothing
// and asks for no input signature; Accept still needs a new review.
test('pending Quote reload reconciles its saved call and restores the Quote for a new review', async ({ page }) => {
  await control(page).set({ receiptAvailable: false });
  const swap = await prepare(page);
  // The App waits up to 60 s for the receipt; the reload happens during this wait.
  await expect(status(swap)).toContainText('Open submitted');
  expect((await control(page).snapshot()).pending).not.toBeNull();
  const ledger = await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.exportChain());
  await page.reload();
  await page.evaluate(raw => (window as unknown as { __currentJourney: Control }).__currentJourney.restoreChain(raw), ledger);
  await control(page).set({ receiptAvailable: true });
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeDisabled();
  await checkState(swap);
  await expect(status(swap)).toHaveText('Private Quote is READY for review.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(swap.getByRole('button', { name: 'Review and Accept', exact: true })).toBeEnabled();
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  expect((await control(page).snapshot()).pending).toBeNull();
});
test('private delivery outside the authorized Quote rate is rejected even with valid accounting', async ({ page }) => {
  const { swap, dialog } = await review(page);
  await control(page).set({ adverseDelivery: true });
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(status(swap)).toContainText('reviewed Quote tolerance');
  await expect(swap.getByText(/^Paid /)).toHaveCount(0);
  expect((await control(page).snapshot()).sends).toHaveLength(2);
  expect((await control(page).snapshot()).pending).not.toBeNull();
  const ledger = await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.exportChain());
  await page.reload();
  await page.evaluate(raw => (window as unknown as { __currentJourney: Control }).__currentJourney.restoreChain(raw), ledger);
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeDisabled();
  await checkState(swap);
  await expect(status(swap)).toContainText('saved action remains blocked');
  expect((await control(page).snapshot()).pending).not.toBeNull();
  expect((await control(page).snapshot()).sends).toHaveLength(2);
});
test('funded async owner recovery verifies a zero-charge full refund', async ({ page }) => {
  const { swap, dialog } = await review(page, true);
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(status(swap)).toHaveText('Accept is mined; settlement remains pending.');
  await swap.getByRole('button', { name: 'Recover swap', exact: true }).click();
  await page.getByRole('dialog', { name: 'Recover private swap' }).getByRole('button', { name: 'Recover swap', exact: true }).click();
  await expect(status(swap)).toHaveText('Released with a private refund receipt.');
  await expect(swap).toContainText('refunded 0.00002 HBR');
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteCheapAsync', 'acceptPrivateSwapV1', 'recoverSwap']);
  expect((await control(page).snapshot()).pending).toBeNull();
});
