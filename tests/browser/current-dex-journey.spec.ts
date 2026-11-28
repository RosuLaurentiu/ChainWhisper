import { expect, test, type Page, type TestInfo } from '@playwright/test';

type Control = {
  snapshot(): { sends: Array<{ name: string; operationId: string; nonce: number; gasLimit: string; data: string }>;
    calls: string[]; signingAttempts: number; inputSignatureRequests: number; operationId: string; stage: number; pending: string | null;
    allowances: string[]; quoteTerms: { maximumInput: string; minimumInput: string; minimumOutput: string; rateNumerator: string; rateDenominator: string; toleranceBps: string } | null;
    limit:{id:string;unspent:string;proceeds:string;closed:boolean;balances:string[];status:string;coreLifecycle:string;engineLifecycle:string} };
  seedLimit(direction?:boolean):void;
  seedFunding(): void;
  set(next: { ready?: boolean; receiptAvailable?: boolean; hideNewReceipts?: boolean; waitReceipt?: boolean; interrupted?: boolean; corruptPayout?: boolean;
    graphDrift?: boolean; gasLimit?: string; wallet?: string; revoked?: boolean; contextDrift?: boolean;
    nextOperationId?: string; issueLogs?: 'missing' | 'duplicate' | 'forged'; settled?: boolean;
    revertNext?: boolean; quoteAmountDrift?: boolean; belowMinimumFill?: boolean; connected?: boolean;
    poolMode?: 'initialize' | 'add'; badPoolDebit?: boolean; denySignature?: boolean;badLimitTerms?:boolean;badLimitPayout?:boolean;recipientCode?:string;claimContextDrift?:boolean;badFundingCredit?:boolean;
    balances?: string[]; balanceReadFailure?: boolean; balanceReadDelay?: number; privacyUnlocked?: boolean; wrongWalletResponseNonce?: boolean; missingWalletChainId?: boolean; delayedTransactionVisibility?: boolean;
    priceDisplayInverted?: boolean }): void;
  remount(): void;
  forgedCopyRejected(): Promise<boolean>;
  exportChain(): string;
  restoreChain(raw: string): void;
  editPending(patch: Record<string, unknown>): Record<string, unknown>;
};
const control = (page: Page) => ({
  snapshot: () => page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.snapshot()),
  set: (next: Parameters<Control['set']>[0]) => page.evaluate(value =>
    (window as unknown as { __currentJourney: Control }).__currentJourney.set(value), next)
});

test.beforeEach(async ({ page },info) => {
  const startupErrors:string[]=[],networkFailures:unknown[]=[];
  page.on('pageerror',error=>startupErrors.push(error.message));page.on('console',event=>{if(['error','warning'].includes(event.type()))startupErrors.push(event.text());});
  page.on('requestfailed',request=>networkFailures.push({url:request.url(),failure:request.failure()?.errorText}));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.fallback() : route.abort());
  // Explicit test seams; no changed production files or live wallet/RPC.
  await page.route('**/src/features/wallet/ownerCotiMetaMaskCapability.ts', route => route.fulfill({ contentType: 'application/javascript',
    body: 'export const issueOwnerCotiMetaMaskCapability = async ({bindCapability}) => bindCapability(window.__currentJourney.binding());' +
      ' export const hasCurrentDexBrowserSigner = () => true; export const releaseOwnerCotiMetaMaskProviderPool = () => {};' }));
  // Same synthetic runtime-hash seam as currentSharedPoolGraph.test.ts. The graph, the swap-funds reader and
  // the token distribution reader each hash contract code (and the vault deployment calldata); the fixture
  // supplies the expected hash of each mock value. Real preimage checks belong to native graph evidence.
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
    '<html><head><title>Current DEX local fixture</title><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root" class="app-shell app-shell-wallet app-shell-dex-v2"></div><script type="module" src="/tests/browser/current-dex-journey.fixture.ts"></script></body></html>' }));
  await page.goto('/dex');
  try{await expect(page.getByRole('region', { name: 'Private Swap', exact: true })).toBeVisible();}
  catch(error){await info.attach('startup-diagnostic',{body:JSON.stringify({url:page.url(),title:await page.title(),startupErrors,networkFailures,fixtureLoaded:await page.evaluate(()=>Boolean((window as unknown as{__currentJourney?:Control}).__currentJourney))}),contentType:'application/json'});await info.attach('startup-dom',{body:await page.content(),contentType:'text/html'});throw error;}
  if(info.title==='rejects graph drift without a false payout claim')await info.attach('startup-diagnostic',{body:JSON.stringify({url:page.url(),title:await page.title(),startupErrors,networkFailures,fixtureLoaded:await page.evaluate(()=>Boolean((window as unknown as{__currentJourney?:Control}).__currentJourney))}),contentType:'application/json'});
});

// Build 13 tokens (BCN, HBR, EMBR, ORBT) have 6 decimals. The default market shows "Buy BCN": the owner
// sends HBR. 0.00002 is 20 raw units, the base case of the fixture receipt; 0.000001 is 1 raw unit.
const privatePaidResult = 'Paid 0.000015 HBR; received 0.000016 BCN; refunded 0.000005 HBR.';
const privateRefundResult = 'Paid 0.0 HBR; received 0.0 BCN; refunded 0.00002 HBR.';
type Swap = ReturnType<Page['getByRole']>;
const status = (swap: Swap) => swap.locator('.dex-v2-current-status');
// The operation facts show next to the swap status: "Operation", the ID and the expiry or public state.
const operationFacts = (swap: Swap) => swap.locator('.dex-v2-progress-facts');
const checkState = (swap: Swap) => swap.getByRole('button', { name: 'Check current state', exact: true }).click();
const reviewButton = (swap: Swap) => swap.getByRole('button', { name: 'Review and Accept', exact: true });
const reviewDialog = (page: Page) => page.getByRole('dialog', { name: 'Review private quote', exact: true });
const approvalDialog = (page: Page) => page.getByRole('dialog', { name: 'Approve swap token', exact: true });
// The fixture answers a receipt read at once. With receiptAvailable false the App waits up to 60 s
// (a read each 2 s) before it reports a pending transaction; this helper moves the page clock past that wait.
async function passReceiptWait(page: Page) { await page.clock.fastForward(61_000); }
type JourneyTiming = {
  operationId: string | null; quoteTransactionHash: string | null; acceptTransactionHash: string | null; terminalTransactionHash: string | null;
  quoteClickToPrivatePreviewDisplayedMs: number | null; acceptRequestToVerifiedResultDisplayedMs: number | null;
  acceptConfirmationToVerifiedResultDisplayedMs: number | null; quoteClickToVerifiedResultDisplayedMs: number | null;
  acceptAttempts: Array<{ cancelled: boolean; submitted: boolean; requestToConfirmationMs: number | null }>;
};
async function journeyTiming(swap: Swap): Promise<JourneyTiming> {
  const json = swap.getByLabel('Local trial timing', { exact: true }).locator('pre').first();
  await expect(json).toHaveCount(1);
  return JSON.parse((await json.textContent())!);
}
// The timing panel is under "Transaction details" and shows only on the Vite development server.
async function openTiming(swap: Swap) {
  const setup = swap.locator('details.dex-v2-setup');
  if (await setup.getAttribute('open') === null) await setup.locator(':scope > summary').click();
  const timing = swap.getByLabel('Local trial timing', { exact: true });
  if (await timing.getAttribute('open') === null) await timing.locator(':scope > summary').click();
  return timing;
}
async function timingScreenshot(swap: Swap, info: TestInfo, name: string) {
  // Only public identities and clocks belong in this screenshot.
  await (await openTiming(swap)).screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' });
}

// Advanced protections are inside the Slippage details (owner decision 2026-11-18).
async function openProtections(swap: Swap) {
  const protections = swap.locator('.dex-v2-current-advanced').first();
  if (await protections.getAttribute('open') === null) await protections.locator(':scope > summary').click();
  const extra = protections.locator('.dex-v2-extra-settings');
  if (await extra.getAttribute('open') === null) await extra.locator(':scope > summary').click();
}
// Mounts the swap again with a new wallet session object and waits for the new view.
async function remount(page: Page) {
  await page.evaluate(() => {
    document.querySelector('.dex-v2-current-swap')?.setAttribute('data-before-remount', '');
    (window as unknown as { __currentJourney: Control }).__currentJourney.remount();
  });
  await expect(page.locator('.dex-v2-current-swap:not([data-before-remount])')).toBeVisible();
}
async function quoteInputs(page: Page, asyncMode = false) {
  const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeEnabled();
  if (asyncMode) await swap.getByRole('button', { name: 'Multi-source', exact: true }).click();
  await swap.getByLabel('Maximum input', { exact: true }).fill('0.00002');
  await openProtections(swap);
  await swap.getByLabel('Minimum net output', { exact: true }).fill('0.000001');
  await swap.getByLabel('Minimum input fill', { exact: true }).fill('25');
  await swap.getByLabel('Price limit', { exact: true }).fill('1');
  return swap;
}

// The current App has no "Confirm private Quote inputs" window (owner decision 2026-11-17): Get Quote
// starts the private input signatures and the Quote send. A Fast Quote then opens the private trade review;
// an async Quote reports "Quote preparation is in progress" and waits for the keeper.
async function quote(page: Page, asyncMode = false) {
  const swap = await quoteInputs(page, asyncMode);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  return swap;
}

test('initial connection does not mask invalid Quote input as a wallet change', async ({ page }, info) => {
  await control(page).set({ connected: false });
  await remount(page);
  const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
  // Without a wallet the main action is "Connect wallet"; no Quote and no state check are available.
  await expect(swap.getByRole('button', { name: 'Connect wallet', exact: true })).toBeEnabled();
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toHaveCount(0);
  await expect(swap.getByRole('button', { name: 'Check current state', exact: true })).toHaveCount(0);
  await swap.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeEnabled();
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await expect(status(swap)).not.toContainText('Wallet or network changed');
  await expect(status(swap)).toHaveText('You send: enter a token amount with at most 6 decimal places.');
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  await quote(page);
  await expect(reviewDialog(page)).toBeVisible();
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  expect(await page.title()).toBe('Current DEX local fixture');
  expect(page.url()).toContain('/dex');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('quote-initial-connection.png') });
});

async function poolPreview(page: Page) {
  const pool = await poolForm(page);
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  // The current App has no "Confirm private Pool inputs" window (owner decision 2026-11-17): Preview deposit
  // starts the eight private-input signatures and the preview send, then verifies the private preview itself.
  await pool.getByRole('button', { name: 'Preview deposit', exact: true }).click();
  await expect(poolStatus(pool)).toHaveText('Private Pool preview verified. Review the exact debit before funding.');
  await expect(pool.getByLabel('Authenticated Pool preview')).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['previewPoolFunding']);
  return pool;
}
// The Pool is under "Liquidity". The canonical Pool order of the default market is HBR, then BCN.
// The budgets are 240 and 100 raw units; two amounts with no price fill the price (2.4 HBR for each BCN).
const openLiquidity = (page: Page) => page.locator('button:visible').filter({ hasText: /^Liquidity$/ }).first().click();
const poolRegion = (page: Page) => page.getByRole('region', { name: 'Current private Pool creation', exact: true });
const poolStatus = (pool: Swap) => pool.locator('p.dex-v2-activation-note[role=status]');
async function poolForm(page: Page) {
  await openLiquidity(page);
  const pool = poolRegion(page);
  await expect(pool).toBeVisible();
  await pool.getByLabel('HBR Pool budget', { exact: true }).fill('0.00024');
  await pool.getByLabel('BCN Pool budget', { exact: true }).fill('0.0001');
  await expect(pool.getByLabel('Pool starting price', { exact: true })).toHaveValue('2.4');
  return pool;
}
// Opens the funding review of a verified preview, confirms it and waits for the allowance check.
// The default Core allowance (1000 raw units) covers both debits, so no approval is sent.
async function poolFundingReview(page: Page, pool: Swap, title = 'Initialize this Pool') {
  await pool.getByRole('button', { name: 'Review funding', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: title, exact: true });
  await expect(confirmation).toBeVisible();
  return confirmation;
}
async function poolFundingReady(page: Page, pool: Swap, title = 'Initialize this Pool') {
  const sends = (await control(page).snapshot()).sends.length;
  await (await poolFundingReview(page, pool, title)).getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(poolStatus(pool)).toHaveText('Both token approvals are ready. Select Review and fund Pool to deposit.');
  expect((await control(page).snapshot()).sends).toHaveLength(sends);
}

for (const width of [1440, 390]) test(`direction-aware price and percentage fill at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  // One whole token of BCN and of HBR. The fixture starts with a Core allowance of 1000 raw units for each token,
  // so the exact approval is an increase to the swap amount.
  await control(page).set({ balances: ['1000000', '1000000'] });
  const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
  await swap.getByLabel('Maximum input', { exact: true }).fill('1');
  await openProtections(swap);
  await expect(swap.getByText('Maximum buy price', { exact: true })).toBeVisible();
  await expect(swap.getByLabel('Minimum input fill', { exact: true })).toHaveValue('0');
  await swap.getByLabel('Price limit', { exact: true }).fill('1.25');
  await swap.getByLabel('Minimum input fill', { exact: true }).fill('100.01');
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await expect(status(swap)).toContainText('Minimum fill:');
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  await swap.getByLabel('Minimum input fill', { exact: true }).fill('25');
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const approval = approvalDialog(page);
  await expect(approval).toBeVisible();
  await expect(approval).toContainText('Input tokenHBR');
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  await approval.getByRole('button', { name: 'Continue', exact: true }).click();
  // The App has no private-input window now. The signed terms prove the direction-aware price and the
  // percentage fill: 25% of 1 HBR, and at most 1.25 HBR for each BCN (at least 0.8 BCN for each HBR).
  const dialog = reviewDialog(page);
  await expect(dialog).toBeVisible();
  let terms = (await control(page).snapshot()).quoteTerms!;
  expect(terms).toMatchObject({ maximumInput: '1000000', minimumInput: '250000', toleranceBps: '50' });
  expect(BigInt(terms.rateNumerator) * 5n).toBe(BigInt(terms.rateDenominator) * 4n);
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['increaseAllowance', 'quoteFastPool']);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await swap.locator('.dex-v2-current-advanced').first().scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`swap-protections-${width}.png`), fullPage: true });
  // An unfunded Fast Quote is discarded in the App; then the other side is available.
  await swap.getByRole('button', { name: 'Cancel quote', exact: true }).click();
  await expect(status(swap)).toHaveText('Quote cancelled. Change the amount and get a new quote.');
  await swap.getByRole('button', { name: 'Sell', exact: true }).click();
  await expect(swap.getByText('Minimum sell price', { exact: true })).toBeVisible();
  await expect(swap.getByLabel('Price limit', { exact: true })).toHaveValue('');
  await swap.getByLabel('Maximum input', { exact: true }).fill('1');
  // The fixture fill gives 16 HBR for 15 BCN (about 1.067 HBR for each BCN), so 1.05 is a limit that it meets.
  await swap.getByLabel('Price limit', { exact: true }).fill('1.05');
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await expect(approval).toBeVisible();
  await expect(approval).toContainText('Input tokenBCN');
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['increaseAllowance', 'quoteFastPool']);
  await approval.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog).toBeVisible();
  terms = (await control(page).snapshot()).quoteTerms!;
  // Sell: 25% of 1 BCN, and at least 1.05 HBR for each BCN.
  expect(terms).toMatchObject({ maximumInput: '1000000', minimumInput: '250000' });
  expect(BigInt(terms.rateNumerator) * 20n).toBe(BigInt(terms.rateDenominator) * 21n);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['increaseAllowance', 'quoteFastPool', 'increaseAllowance', 'quoteFastPool']);
  expect((await control(page).snapshot()).allowances.slice(0, 2)).toEqual(['1000000', '1000000']);
  expect((await control(page).snapshot()).pending).toBeNull();
});

// Test tokens are under "Get test tokens" (owner decision 2026-11-18): one check button, one claim for each
// token and "Status and recovery". The swap asks for the token approval itself; there is no manual approval.
const fundingPanel = (page: Page) => page.getByRole('region', { name: 'Private Swap', exact: true }).locator('details.dex-v2-token-funding');
const fundingStatus = (panel: ReturnType<Page['locator']>) => panel.locator('.dex-v2-beta-tokens > p[role=status]');
const tokenCard = (panel: ReturnType<Page['locator']>, symbol: string) => panel.locator('.dex-v2-beta-token-card').filter({ has: panel.page().getByText(symbol, { exact: true }) });
async function fundingView(page: Page, input: 0 | 1 = 1) {
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
  if (input === 0) await swap.getByRole('button', { name: 'Sell', exact: true }).click();
  await swap.getByLabel('Maximum input', { exact: true }).fill('0.00002');
  const panel = fundingPanel(page);
  await panel.locator(':scope > summary').click();
  await panel.getByRole('button', { name: 'Check balances and refills', exact: true }).click();
  await expect(fundingStatus(panel)).toHaveText('Balances and refills checked.');
  await expect(tokenCard(panel, input === 1 ? 'HBR' : 'BCN')).toContainText('Initial claim available');
  return panel;
}
// Opens the claim review and continues to the wallet. The App then waits for the receipt and verifies the private credit.
async function claimTokens(page: Page, panel: ReturnType<Page['locator']>, symbol = 'HBR') {
  const before = await control(page).snapshot();
  await panel.getByRole('button', { name: `Claim 10,000.0 ${symbol}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Claim ${symbol}`, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`10000.0 ${symbol}`);
  expect((await control(page).snapshot()).sends).toHaveLength(before.sends.length);
  await dialog.getByRole('button', { name: 'Continue to wallet', exact: true }).click();
}
async function checkConfirmation(panel: ReturnType<Page['locator']>) {
  const recovery = panel.locator('details.dex-v2-beta-token-recovery');
  if (await recovery.getAttribute('open') === null) await recovery.locator(':scope > summary').click();
  await recovery.getByRole('button', { name: 'Check confirmation', exact: true }).click();
}
for (const width of [1440, 390]) test(`normal token input and exact approval at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error' && !e.text().includes('Failed to load resource: net::ERR_FAILED')) errors.push(e.text()); });
  const panel = await fundingView(page);
  await claimTokens(page, panel);
  await expect(fundingStatus(panel)).toHaveText('Claim confirmed. Your private balance is updated.');
  const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
  await swap.getByLabel('Maximum input', { exact: true }).fill('1.25');
  await openProtections(swap);
  // The build 13 Quote protocol has a slippage tolerance; the hard price limit is optional.
  await expect(swap.getByLabel('Price limit', { exact: true })).toHaveAttribute('placeholder', 'Optional');
  await expect(swap.getByLabel('Minimum net output')).toHaveValue('0');
  await swap.getByLabel('Minimum net output').fill('');
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await expect(status(swap)).toContainText('You receive at least:');
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  await swap.getByLabel('Minimum net output').fill('0');
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const approval = approvalDialog(page);
  await expect(approval).toContainText('Input tokenHBR');
  await expect(approval).toContainText('Swap amount1.25');
  await expect(approval).toContainText('Approve only the amount needed.');
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  await approval.getByRole('button', { name: 'Continue', exact: true }).click();
  const dialog = reviewDialog(page);
  await expect(dialog).toContainText('HBR');
  await expect(dialog).toContainText('BCN');
  const observed = await control(page).snapshot();
  expect(observed.sends.map(row => [row.name, row.gasLimit])).toEqual([['claimFaucet', '5000000'], ['approve', '5000000'], ['quoteFastPool', '110000000']]);
  // Exact approval: the Core allowance of HBR is the swap amount.
  expect(observed.allowances[1]).toBe('1250000');
  expect(observed.quoteTerms).toMatchObject({ maximumInput: '1250000', minimumInput: '0', minimumOutput: '0', rateNumerator: '0' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await swap.getByLabel('Maximum input').scrollIntoViewIfNeeded();
  expect(await page.title()).toBe('Current DEX local fixture');
  expect(page.url()).toContain('/dex');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath(`normal-swap-tokens-${width}.png`) });
});
for (const [width, input, asyncMode] of [[1440, 1, false], [390, 0, true]] as const) test(`current-token funding exact faucet approval before ${asyncMode ? 'async' : 'Fast'} at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (['error', 'warning'].includes(e.type()) && !e.text().includes('Failed to load resource: net::ERR_FAILED')) errors.push(e.text()); });
  const symbol = input === 1 ? 'HBR' : 'BCN';
  const panel = await fundingView(page, input); await claimTokens(page, panel, symbol);
  await expect(fundingStatus(panel)).toHaveText('Claim confirmed. Your private balance is updated.');
  await expect(tokenCard(panel, symbol)).toContainText('10,000');
  await panel.locator('details.dex-v2-beta-token-details > summary').click();
  await expect(panel.locator('details.dex-v2-beta-token-details')).toContainText('DEX allowance 0.0');
  expect((await control(page).snapshot()).sends.map(x => [x.name, x.gasLimit])).toEqual([['claimFaucet', '5000000']]);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`current-token-funding-readiness-${width}.png`), fullPage: true });
  const swap = await quote(page, asyncMode);
  const approval = approvalDialog(page);
  await expect(approval).toContainText(`Input token${symbol}`);
  await expect(approval).toContainText('Swap amount0.00002');
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  await approval.getByRole('button', { name: 'Continue', exact: true }).click();
  if (asyncMode) await expect(status(swap)).toContainText('Quote preparation is in progress');
  else await expect(reviewDialog(page)).toBeVisible();
  const observed = await control(page).snapshot();
  expect(observed.sends.map(x => [x.name, x.gasLimit])).toEqual([['claimFaucet', '5000000'], ['approve', '5000000'], [asyncMode ? 'quoteCheapAsync' : 'quoteFastPool', '110000000']]);
  expect(observed.allowances[input]).toBe('20');
  await expect(page).toHaveTitle('Current DEX local fixture'); await expect(page.locator('vite-error-overlay')).toHaveCount(0); expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`current-token-funding-${width}.png`), fullPage: true });
});
test('current-token funding reload reconciles canonical metadata then verifies fresh private funds', async ({ page }) => {
  await control(page).set({ receiptAvailable: false });
  const panel = await fundingView(page); await claimTokens(page, panel);
  // The App waits up to 60 s for the receipt; the reload happens during this wait.
  await expect(fundingStatus(panel)).toHaveText('Claim submitted. Checking confirmation and private credit.');
  expect(JSON.parse((await control(page).snapshot()).pending!)).toMatchObject({ phase: 'token-faucet', nonce: 4 });
  const saved = await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.exportChain());
  await page.reload(); await page.evaluate(raw => (window as unknown as { __currentJourney: Control }).__currentJourney.restoreChain(raw), saved);
  const current = fundingPanel(page); await current.locator(':scope > summary').click();
  await expect(current.locator('.dex-v2-beta-token-guidance')).toHaveText('A previous transaction needs confirmation. Check it below; do not resend.');
  await expect(current.getByRole('button', { name: 'Claim 10,000.0 HBR', exact: true })).toBeDisabled();
  await checkConfirmation(current);
  // A reload proves the private receipt credit and reads the current funds; it does not prove the earlier balance.
  await expect(fundingStatus(current)).toHaveText('Claim confirmed. Private receipt credit verified; balances are current.');
  await expect(tokenCard(current, 'HBR')).toContainText('10,000'); expect((await control(page).snapshot()).pending).toBeNull();
  await current.getByRole('button', { name: 'Check balances and refills', exact: true }).click();
  await expect(fundingStatus(current)).toHaveText('Balances and refills checked.');
  await expect(tokenCard(current, 'HBR')).toContainText('10,000');
  expect((await control(page).snapshot()).sends).toHaveLength(1);
});
for (const width of [1440, 390]) test(`current-token funding lost hash reconciles the exact existing transaction at ${width}px without resending`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await control(page).set({ receiptAvailable: false });
  const panel = await fundingView(page); await claimTokens(page, panel);
  await expect(fundingStatus(panel)).toHaveText('Claim submitted. Checking confirmation and private credit.');
  const existingHash = await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.editPending({ txHash: null }).txHash as string);
  await remount(page);
  await control(page).set({ receiptAvailable: true });
  const current = fundingPanel(page); await current.locator(':scope > summary').click();
  await checkConfirmation(current);
  await expect(fundingStatus(current)).toHaveText('Beta funding has no saved hash. Enter its existing hash. Do not resend.');
  await expect(current.getByRole('button', { name: 'Claim 10,000.0 HBR', exact: true })).toBeDisabled();
  await current.getByLabel('Existing beta funding transaction hash', { exact: true }).fill('invalid');
  await checkConfirmation(current);
  await expect(fundingStatus(current)).toHaveText('Invalid or changed beta funding transaction hash.');
  expect((await control(page).snapshot()).pending).not.toBeNull();
  await current.getByLabel('Existing beta funding transaction hash', { exact: true }).fill(existingHash);
  await checkConfirmation(current);
  await expect(fundingStatus(current)).toHaveText('Claim confirmed. Private receipt credit verified; balances are current.');
  await expect(tokenCard(current, 'HBR')).toContainText('10,000');
  expect((await control(page).snapshot()).pending).toBeNull(); expect((await control(page).snapshot()).sends).toHaveLength(1);
  await expect(page).toHaveTitle('Current DEX local fixture'); expect(page.url()).toContain('/dex');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0); expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await current.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`funding-hash-recovery-${width}.png`) });
});
test('current-token funding known wrong private credit remains blocked, never metadata fallback', async ({ page }) => {
  const panel = await fundingView(page); await control(page).set({ badFundingCredit: true }); await claimTokens(page, panel);
  await expect(fundingStatus(panel)).toHaveText('Beta funding private accounting, allowance or policy differs.');
  await expect(panel.getByRole('button', { name: 'Claim 10,000.0 HBR', exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Claim 10,000.0 BCN', exact: true })).toBeDisabled();
  expect(JSON.parse((await control(page).snapshot()).pending!)).toMatchObject({ phase: 'token-faucet', verificationBlocked: true });
  await checkConfirmation(panel);
  await expect(fundingStatus(panel)).toHaveText('Beta funding private accounting, allowance or policy differs.');
  expect((await control(page).snapshot()).pending).not.toBeNull(); expect((await control(page).snapshot()).sends).toHaveLength(1);
  const saved = await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.exportChain());
  await page.reload(); await page.evaluate(raw => (window as unknown as { __currentJourney: Control }).__currentJourney.restoreChain(raw), saved);
  const current = fundingPanel(page); await current.locator(':scope > summary').click();
  await checkConfirmation(current);
  // The recheck of the exact saved transaction finds the same accounting difference; nothing unblocks the claim.
  await expect(fundingStatus(current)).toHaveText('Beta funding private accounting, allowance or policy differs.');
  await expect(current.getByRole('button', { name: 'Claim 10,000.0 HBR', exact: true })).toBeDisabled();
  // The swap is also held: Get Quote checks the saved funding action first and stops before any signature.
  const swap = await quote(page);
  await expect(status(swap)).toHaveText('Reconcile the pending or active owner record before normal use.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  expect((await control(page).snapshot()).pending).not.toBeNull(); expect((await control(page).snapshot()).sends).toHaveLength(1);
});

async function limitForm(page:Page){
  await page.locator('button:visible').filter({hasText:/^Strategies$/}).first().click();
  await page.getByRole('tab',{name:'Limit',exact:true}).click();
  const form=page.getByRole('region',{name:'Current private plain Limit creation',exact:true});
  await expect(form).toBeVisible();await form.getByLabel('Limit offered budget').fill('300');await form.getByLabel('Limit exact price').fill('0.3');await form.getByLabel('Limit maker minimum').fill('1');return form;
}
for(const [direction,viewport]of [['1',{width:1440,height:1000}],['0',{width:390,height:844}]]as const)test(`current plain Limit exact two-phase creation at ${viewport.width}px`,async({page})=>{
  await page.setViewportSize(viewport);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(['error','warning'].includes(e.type())&&!e.text().includes('Failed to load resource: net::ERR_FAILED'))errors.push(e.text());});
  const form=await limitForm(page);await form.getByLabel('Limit offered token').selectOption(direction);
  await form.getByRole('button',{name:'Review and create Limit',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Create private plain Limit',exact:true});
  await expect(dialog).toContainText(direction==='1'?'Test token 1 per Test token 0':'Test token 0 per Test token 1');await expect(dialog).toContainText('3/10');expect((await control(page).snapshot()).sends).toHaveLength(0);
  await dialog.getByRole('button',{name:'Continue',exact:true}).click();await expect(form.getByRole('status')).toContainText('creation submitted');
  await form.getByRole('button',{name:'Check Limit status',exact:true}).click();await expect(form).toContainText('Minted NFT 92');await expect(form).not.toContainText('Verified plain Limit NFT');
  await form.getByRole('button',{name:'Refresh private Limit result',exact:true}).click();const snapshot=page.getByRole('dialog',{name:'Refresh private Limit result',exact:true});await expect(snapshot).toBeVisible();expect((await control(page).snapshot()).sends).toHaveLength(1);
  await snapshot.getByRole('button',{name:'Continue',exact:true}).click();await expect(form.getByRole('status')).toContainText('snapshot submitted');await form.getByRole('button',{name:'Check Limit status',exact:true}).click();await expect(form).toContainText('Verified plain Limit NFT 92');
  expect((await control(page).snapshot()).sends.map(x=>[x.name,x.gasLimit])).toEqual([['createPrivateOrder','30000000'],['privateOrderSnapshot','10000000']]);
  expect(await page.title()).toBe('Current DEX local fixture');expect(page.url()).toContain('/dex');expect(await page.locator('vite-error-overlay').count()).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  await page.screenshot({path:`C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/current-limit-${viewport.width}.png`});
  await control(page).set({wallet:`0x${'33'.repeat(20)}`});await expect(form).not.toContainText('Verified plain Limit NFT');
});
for(const fault of ['mutation','cancel','denied','debit','snapshot','reload']as const)test(`current plain Limit ${fault} does not invent private creation success`,async({page})=>{
  const form=await limitForm(page);await form.getByRole('button',{name:'Review and create Limit',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Create private plain Limit',exact:true});await expect(dialog).toBeVisible();
  if(fault==='mutation')await control(page).set({wallet:`0x${'33'.repeat(20)}`});if(fault==='denied')await control(page).set({denySignature:true});if(fault==='debit')await control(page).set({badPoolDebit:true});
  await dialog.getByRole('button',{name:fault==='cancel'?'Cancel':'Continue',exact:true}).click();
  if(['mutation','cancel','denied'].includes(fault)){await expect.poll(async()=>(await control(page).snapshot()).sends.length).toBe(0);return;}
  await expect(form.getByRole('status')).toContainText('creation submitted');
  if(fault==='reload'){
    const ledger=await page.evaluate(()=>(window as unknown as {__currentJourney:Control}).__currentJourney.exportChain());await page.reload();await page.evaluate(raw=>(window as unknown as {__currentJourney:Control}).__currentJourney.restoreChain(raw),ledger);
    const restored=await limitForm(page);await restored.getByRole('button',{name:'Check Limit status',exact:true}).click();await expect(restored.getByRole('status')).toContainText('no authenticated private creation result');await expect(restored).not.toContainText('Minted NFT');return;
  }
  await form.getByRole('button',{name:'Check Limit status',exact:true}).click();
  if(fault==='snapshot'){await control(page).set({badLimitTerms:true});await form.getByRole('button',{name:'Refresh private Limit result',exact:true}).click();await page.getByRole('dialog',{name:'Refresh private Limit result',exact:true}).getByRole('button',{name:'Continue',exact:true}).click();await expect(form.getByRole('status')).toContainText('snapshot submitted');await form.getByRole('button',{name:'Check Limit status',exact:true}).click();}
  await expect(form).not.toContainText('Verified plain Limit NFT');await expect(form.getByRole('status')).toContainText(fault==='snapshot'?'private inventory, price':'creation debit differs');
});

async function ownedLimit(page:Page,direction=true){
  await page.evaluate(value=>(window as unknown as{__currentJourney:Control}).__currentJourney.seedLimit(value),direction);
  const form=await limitForm(page);await form.getByLabel('Limit owner NFT ID').fill('92');return form;
}
async function ownerLimitAction(page:Page,button:string,title:string,verify=true){
  const form=page.getByRole('region',{name:'Current private plain Limit creation',exact:true}),before=(await control(page).snapshot()).sends.length;
  await form.getByRole('button',{name:button,exact:true}).click();const modal=page.getByRole('dialog',{name:title,exact:true});await expect(modal).toBeVisible();expect((await control(page).snapshot()).sends).toHaveLength(before);
  await modal.getByRole('button',{name:'Continue',exact:true}).click();await expect(form.getByRole('status')).toContainText('owner action submitted');
  if(verify){await form.getByRole('button',{name:'Check Limit status',exact:true}).click();await expect.poll(async()=>(await control(page).snapshot()).pending).toBeNull();}
  return form;
}
for(const [direction,width]of [[true,1440],[false,390]]as const)test(`Limit owner browser refresh Claim Pause Resume Close exact accounting at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:width===390?844:1000});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(['error','warning'].includes(e.type())&&!e.text().includes('Failed to load resource: net::ERR_FAILED'))errors.push(e.text());});
  await expect(page.getByRole('region',{name:'Private Swap',exact:true})).toBeVisible();await expect(page.locator('vite-error-overlay')).toHaveCount(0);await page.screenshot({path:`C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/limit-owner-resume-entry-${width}.png`});
  const form=await ownedLimit(page,direction);await form.getByLabel('Limit owner NFT ID').scrollIntoViewIfNeeded();await expect(form.getByRole('button',{name:'Claim Limit proceeds',exact:true})).toBeDisabled();
  await ownerLimitAction(page,'Refresh private owned Limit','Refresh private Limit');await expect(form).toContainText(`Unspent 300 atoms of Test token ${direction?1:0}; proceeds 7 atoms of Test token ${direction?0:1}`);await expect(form.getByRole('button',{name:'Resume Limit',exact:true})).toBeDisabled();
  await page.screenshot({path:`C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/limit-owner-resume-refresh-${width}.png`});
  await ownerLimitAction(page,'Claim Limit proceeds','Claim Limit proceeds');await expect(form).not.toContainText('Unspent 300');await expect(form.getByRole('status')).toContainText('Private amount authority is cleared');await expect(form.getByRole('button',{name:'Close Limit and return funds',exact:true})).toBeDisabled();
  await ownerLimitAction(page,'Refresh private owned Limit','Refresh private Limit');await expect(form).toContainText('proceeds 0 atoms');
  await ownerLimitAction(page,'Pause Limit','Pause plain Limit');await expect(form).not.toContainText('Unspent 300');await expect(form.getByRole('button',{name:'Claim Limit proceeds',exact:true})).toBeDisabled();
  expect((await control(page).snapshot()).limit).toMatchObject({status:'1',coreLifecycle:'2',engineLifecycle:'2'});await expect(form.getByRole('button',{name:'Resume Limit',exact:true})).toBeDisabled();
  await ownerLimitAction(page,'Refresh private owned Limit','Refresh private Limit');await expect(form.getByRole('button',{name:'Pause Limit',exact:true})).toBeDisabled();await expect(form.getByRole('button',{name:'Resume Limit',exact:true})).toBeEnabled();
  await page.screenshot({path:`C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/limit-owner-paused-resume-${width}.png`});
  const beforeResume=(await control(page).snapshot()).limit;await ownerLimitAction(page,'Resume Limit','Resume plain Limit');await expect(form).not.toContainText('Unspent 300');await expect(form.getByRole('button',{name:'Pause Limit',exact:true})).toBeDisabled();await expect(form.getByRole('button',{name:'Claim Limit proceeds',exact:true})).toBeDisabled();await expect(form.getByRole('button',{name:'Resume Limit',exact:true})).toBeDisabled();
  expect((await control(page).snapshot()).limit).toEqual({...beforeResume,status:'0',coreLifecycle:'3',engineLifecycle:'3'});
  await ownerLimitAction(page,'Refresh private owned Limit','Refresh private Limit');await expect(form).toContainText('Unspent 300');await expect(form.getByRole('button',{name:'Pause Limit',exact:true})).toBeEnabled();await expect(form.getByRole('button',{name:'Resume Limit',exact:true})).toBeDisabled();
  await ownerLimitAction(page,'Close Limit and return funds','Close plain Limit');await expect(form.getByRole('status')).toContainText('NFT burn and closed owner tombstone verified');await expect(form).toContainText('Unspent 0 atoms');await expect(form.getByRole('button',{name:'Close Limit and return funds',exact:true})).toBeDisabled();
  const result=await control(page).snapshot();expect(result.limit).toEqual({id:'92',unspent:'0',proceeds:'0',closed:true,balances:direction?['1007','1300']:['1300','1007'],status:'0',coreLifecycle:'4',engineLifecycle:'4'});expect(result.sends.map(x=>[x.name,x.gasLimit])).toEqual([['privateOrderSnapshot','10000000'],['claimPrivateOrderProceeds','30000000'],['privateOrderSnapshot','10000000'],['managePrivateOrderStatus','10000000'],['privateOrderSnapshot','10000000'],['managePrivateOrderStatus','10000000'],['privateOrderSnapshot','10000000'],['closePrivateOrder','30000000']]);
  expect(result.sends.filter(x=>x.name==='managePrivateOrderStatus').map(x=>[0,1,2].map(i=>BigInt(`0x${x.data.slice(10+i*64,10+(i+1)*64)}`).toString()))).toEqual([['92','1','0'],['92','2','1']]);
  await expect(page).toHaveTitle('Current DEX local fixture');expect(page.url()).toContain('/dex');await expect(page.locator('vite-error-overlay')).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  await form.getByRole('status').scrollIntoViewIfNeeded();await expect(form.getByRole('status')).toBeVisible();await page.screenshot({path:`C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/limit-owner-resumed-closed-${width}.png`});
});
test('Limit owner browser lost-session mined metadata permits a new explicit snapshot, not restored amounts',async({page})=>{
  await ownedLimit(page);await ownerLimitAction(page,'Refresh private owned Limit','Refresh private Limit');await ownerLimitAction(page,'Claim Limit proceeds','Claim Limit proceeds',false);
  const ledger=await page.evaluate(()=>(window as unknown as{__currentJourney:Control}).__currentJourney.exportChain());await page.reload();await page.evaluate(raw=>(window as unknown as{__currentJourney:Control}).__currentJourney.restoreChain(raw),ledger);
  const form=await limitForm(page);await form.getByRole('button',{name:'Check Limit status',exact:true}).click();await expect(form.getByRole('status')).toContainText('Private accounting was not restored');expect((await control(page).snapshot()).pending).toBeNull();await expect(form).not.toContainText('Unspent 300');
  await form.getByLabel('Limit owner NFT ID').fill('92');await ownerLimitAction(page,'Refresh private owned Limit','Refresh private Limit');await expect(form).toContainText('proceeds 0 atoms');expect((await control(page).snapshot()).sends.map(x=>x.name)).toEqual(['privateOrderSnapshot','claimPrivateOrderProceeds','privateOrderSnapshot']);
});
for(const fault of ['owner','selection','session']as const)test(`Limit owner browser ${fault} change revokes private amount authority`,async({page})=>{
  const form=await ownedLimit(page);await ownerLimitAction(page,'Refresh private owned Limit','Refresh private Limit');await expect(form).toContainText('Unspent 300');
  if(fault==='selection')await form.getByLabel('Limit owner NFT ID').fill('93');else if(fault==='owner')await control(page).set({wallet:`0x${'33'.repeat(20)}`});else{await page.evaluate(()=>(window as unknown as{__currentJourney:Control}).__currentJourney.remount());await limitForm(page);}
  await expect(form).not.toContainText('Unspent 300');await expect(form.getByRole('button',{name:'Claim Limit proceeds',exact:true})).toBeDisabled();expect((await control(page).snapshot()).sends).toHaveLength(1);
});
test('Limit owner browser known private payout failure keeps pending and all funding disabled',async({page})=>{
  const form=await ownedLimit(page);await ownerLimitAction(page,'Refresh private owned Limit','Refresh private Limit');await control(page).set({badLimitPayout:true});await ownerLimitAction(page,'Claim Limit proceeds','Claim Limit proceeds',false);
  await form.getByRole('button',{name:'Check Limit status',exact:true}).click();await expect(form.getByRole('status')).toContainText('payout differs');await expect(form).not.toContainText('Unspent 300');expect((await control(page).snapshot()).pending).not.toBeNull();await expect(form.getByRole('button',{name:'Refresh private owned Limit',exact:true})).toBeDisabled();await expect(form.getByRole('button',{name:'Review and create Limit',exact:true})).toBeDisabled();expect((await control(page).snapshot()).sends).toHaveLength(2);
});

for (const [mode, viewport] of [['initialize', { width: 1440, height: 1000 }], ['add', { width: 390, height: 844 }]] as const) {
  test(`current Pool ${mode} preview and exact funding mint a verified NFT`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await control(page).set({ poolMode: mode });
    const pool = await poolPreview(page);
    await expect(page).toHaveTitle('Current DEX local fixture');
    expect(page.url()).toContain('/dex');
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    const preview = pool.getByLabel('Authenticated Pool preview');
    const title = mode === 'initialize' ? 'Initialize this Pool' : 'Add to this Pool';
    await expect(preview).toContainText(title);
    // A new Pool takes the entered price: both budgets fit. An existing Pool uses its reserve ratio
    // (2 HBR for each BCN in the fixture), so 40 raw units of HBR stay in the wallet.
    await expect(preview).toContainText(mode === 'initialize' ? 'HBR debit0.00024' : 'HBR debit0.0002');
    await expect(preview).toContainText('BCN debit0.0001');
    if (mode === 'add') await expect(preview).toContainText('HBR unused0.00004');
    else await expect(preview).not.toContainText('unused');
    await expect(pool.getByLabel('Pool spread', { exact: true })).toHaveValue('1');
    expect(await pool.getByLabel('Pool spread', { exact: true }).locator('option').allTextContents()).toEqual(['0.1%', '0.3%', '0.5%', '1%', '2%', '5%', '10%']);
    await preview.screenshot({ path: info.outputPath(`current-pool-${mode}-preview.png`) });
    const before = await control(page).snapshot();
    const confirmation = await poolFundingReview(page, pool, title);
    await expect(confirmation).toContainText(mode === 'initialize' ? 'HBR debit0.00024' : 'HBR debit0.0002');
    await expect(confirmation).toContainText(mode === 'initialize' ? 'HBR unused from entered budget0.0' : 'HBR unused from entered budget0.00004');
    expect((await control(page).snapshot()).sends).toHaveLength(before.sends.length);
    await confirmation.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(poolStatus(pool)).toHaveText('Both token approvals are ready. Select Review and fund Pool to deposit.');
    expect((await control(page).snapshot()).sends).toHaveLength(before.sends.length);
    // The funding review is the consent for the deposit: "Review and fund Pool" sends it and the App verifies the result.
    await pool.getByRole('button', { name: 'Review and fund Pool', exact: true }).click();
    await expect(poolStatus(pool)).toHaveText('Position NFT 82 minted. Both private token debits are verified.');
    await expect(pool).toContainText('Verified position NFT ID: 82.');
    const result = await control(page).snapshot();
    expect(result.sends.map(row => row.name)).toEqual(['previewPoolFunding', 'createPoolPosition']);
    expect(result.sends.map(row => row.gasLimit)).toEqual(['100000000', '100000000']);
    expect(result.pending).toBeNull();
    // Exact accounting: the wallet balances (BCN, HBR) fall by the two debits only.
    expect(result.limit.balances.slice(0, 2)).toEqual(mode === 'initialize' ? ['900', '760'] : ['900', '800']);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`current-pool-${mode}.png`) });
  });
}

for (const fault of ['terms', 'owner', 'pending', 'graph', 'debit'] as const) {
  test(`current Pool ${fault} drift cannot reuse a private preview or claim an NFT result`, async ({ page }) => {
    const pool = await poolPreview(page);
    if (fault === 'terms') {
      await pool.locator('details.dex-v2-pool-settings > summary').click();
      await pool.getByLabel('Pool funding tolerance', { exact: true }).fill('2');
      // A changed term removes the funding action; only a new preview is available.
      await expect(pool.getByRole('button', { name: 'Review funding', exact: true })).toHaveCount(0);
      await expect(pool.getByRole('button', { name: 'Review and fund Pool', exact: true })).toHaveCount(0);
      await expect(pool.getByRole('alert')).toContainText('terms or wallet session changed');
    } else if (fault === 'owner') {
      await control(page).set({ wallet: `0x${'33'.repeat(20)}`, revoked: true });
      await expect(pool.getByRole('button', { name: 'Review funding', exact: true })).toHaveCount(0);
      await expect(pool.getByRole('button', { name: 'Review and fund Pool', exact: true })).toHaveCount(0);
      await expect(pool.getByLabel('Authenticated Pool preview')).toHaveCount(0);
    } else if (fault === 'graph') {
      await control(page).set({ graphDrift: true });
      // The funding review reads the candidate again after the owner confirms; a changed runtime stops before any deposit.
      await (await poolFundingReview(page, pool)).getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(poolStatus(pool)).toContainText('runtime hash differs');
      await expect(pool.getByRole('button', { name: 'Review and fund Pool', exact: true })).toHaveCount(0);
    } else {
      await poolFundingReady(page, pool);
      if (fault === 'pending') await control(page).set({ interrupted: true });
      if (fault === 'debit') await control(page).set({ badPoolDebit: true });
      await pool.getByRole('button', { name: 'Review and fund Pool', exact: true }).click();
      if (fault === 'pending') {
        await expect(poolStatus(pool)).toContainText('interrupted');
        await pool.getByRole('button', { name: 'Check Pool status', exact: true }).click();
        await expect(poolStatus(pool)).toContainText('Do not resend');
        await expect(pool.getByRole('button', { name: 'Review and fund Pool', exact: true })).toBeDisabled();
        expect((await control(page).snapshot()).pending).not.toBeNull();
      } else {
        await expect(poolStatus(pool)).toContainText('Pool funding debit differs from its confirmed preview.');
        await pool.getByRole('button', { name: 'Check Pool status', exact: true }).click();
        await expect(poolStatus(pool)).toContainText('Known Pool verification failure. Manual reconciliation is required.');
        expect((await control(page).snapshot()).pending).not.toBeNull();
      }
      await expect(poolStatus(pool)).not.toContainText('NFT 82 minted');
      await expect(pool).not.toContainText('Verified position NFT ID');
    }
    expect((await control(page).snapshot()).sends.length).toBe(fault === 'debit' ? 2 : 1);
  });
}

test('current Pool denied signature sends nothing and status refresh permits a fresh preview', async ({ page }) => {
  await control(page).set({ denySignature: true });
  const pool = await poolForm(page);
  await pool.getByRole('button', { name: 'Preview deposit', exact: true }).click();
  await expect(poolStatus(pool)).toContainText('signature denied');
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  await pool.getByRole('button', { name: 'Check Pool status', exact: true }).click();
  await expect(poolStatus(pool)).toContainText('No pending Pool attempt');
  await expect(pool.getByRole('button', { name: 'Preview deposit', exact: true })).toBeEnabled();
  expect((await control(page).snapshot()).pending).toBeNull();
});

test('current Pool reconnect cannot restore a prepared private preview', async ({ page }) => {
  await poolPreview(page);
  await remount(page);
  await openLiquidity(page);
  const pool = poolRegion(page);
  await expect(pool).toBeVisible();
  await expect(pool.getByLabel('Authenticated Pool preview')).toHaveCount(0);
  await expect(pool.getByRole('button', { name: 'Review funding', exact: true })).toHaveCount(0);
  await expect(pool.getByRole('button', { name: 'Review and fund Pool', exact: true })).toHaveCount(0);
  expect((await control(page).snapshot()).sends).toHaveLength(1);
});

test('current Pool pending funding survives reload without private funding or NFT authority', async ({ page }) => {
  await page.clock.install();
  const pool = await poolPreview(page);
  await poolFundingReady(page, pool);
  // With no receipt of the deposit the App waits 60 s, then keeps the deposit pending.
  await control(page).set({ hideNewReceipts: true });
  await pool.getByRole('button', { name: 'Review and fund Pool', exact: true }).click();
  await expect(poolStatus(pool)).toHaveText('Pool funding submitted. Checking the private debits and minted NFT.');
  await passReceiptWait(page);
  await expect(poolStatus(pool)).toHaveText('Pool transaction is pending. Check Pool status; do not resend.');
  expect((await control(page).snapshot()).pending).not.toBeNull();
  await reloadWithChain(page, await exportChain(page));
  await openLiquidity(page);
  const reconnected = poolRegion(page);
  await reconnected.getByRole('button', { name: 'Check Pool status', exact: true }).click();
  await expect(poolStatus(reconnected)).toContainText('no authenticated private result');
  await expect(reconnected.getByLabel('Authenticated Pool preview')).toHaveCount(0);
  await expect(reconnected).not.toContainText('Verified position NFT ID');
  expect((await control(page).snapshot()).sends).toHaveLength(2);
});

// Brings a Quote to READY with no review window open. A mined Fast Quote opens its private review at once;
// this helper closes it, which sends nothing. An async Quote needs the keeper READY step.
async function ready(page: Page, asyncMode = false) {
  const before = await control(page).snapshot();
  const swap = await quote(page, asyncMode);
  if (asyncMode) {
    await expect(status(swap)).toContainText('Quote preparation is in progress');
    await expect(reviewButton(swap)).toBeDisabled();
    await control(page).set({ ready: true });
    await checkState(swap);
    await expect(status(swap)).toHaveText('Private Quote is READY for review.');
  } else {
    await expect(reviewDialog(page)).toBeVisible();
    await reviewDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(status(swap)).toHaveText('Quote ready. Review and Accept when you are ready.');
  }
  const after = await control(page).snapshot();
  expect(after.sends).toHaveLength(before.sends.length + 1);
  await expect(operationFacts(swap)).toContainText(`Operation${after.operationId}`);
  await expect(reviewButton(swap)).toBeEnabled();
  return swap;
}

async function readLiquidityClaim(page:Page){
  await page.locator('button:visible').filter({hasText:/^Positions$/}).first().click();
  const positions=page.getByRole('region',{name:'Current liquidity NFT positions',exact:true});
  await positions.getByLabel('Liquidity NFT ID',{exact:true}).fill('81');
  await positions.getByRole('button',{name:'Read private claim',exact:true}).click();
  await expect(positions.getByLabel('Owner private liquidity claim')).toContainText('200 atoms');
  return positions;
}
for(const viewport of [{width:1440,height:1000},{width:390,height:844}])test(`current liquidity NFT private read and protected Close at ${viewport.width}px`,async({page})=>{
  await page.setViewportSize(viewport);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  // All external requests are deliberately aborted in this offline fixture.
  // Ignore only that explicit browser network diagnostic, not application warnings.
  page.on('console',event=>{if(['error','warning'].includes(event.type())&&!event.text().includes('Failed to load resource: net::ERR_FAILED'))errors.push(event.text());});
  const positions=await readLiquidityClaim(page);
  await expect(positions.getByLabel('Owner private liquidity claim')).toContainText('Test token 1 entitlement200 atoms');
  await expect(positions.getByLabel('Owner private liquidity claim')).toContainText('Test token 0 entitlement100 atoms');
  await positions.getByLabel('Owner private liquidity claim').screenshot({path:`C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/current-pool-claim-${viewport.width}.png`});
  await expect(positions.getByRole('button',{name:'Withdraw selected shares',exact:true})).toBeEnabled();
  await expect(positions.getByRole('button',{name:'Transfer liquidity NFT',exact:true})).toBeEnabled();
  await positions.getByLabel('Test token 1 minimum payout',{exact:true}).fill('199');await positions.getByLabel('Test token 0 minimum payout',{exact:true}).fill('99');
  await positions.getByRole('button',{name:'Close and withdraw all',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Close liquidity claim',exact:true});await expect(dialog).toBeVisible();
  expect((await control(page).snapshot()).sends).toHaveLength(0);await dialog.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(positions.getByRole('status')).toContainText('submitted');await positions.getByRole('button',{name:'Check position status',exact:true}).click();
  await expect(positions.getByRole('status')).toContainText('Private payouts verified: Test token 1 200 atoms; Test token 0 100 atoms.');
  await expect(positions.getByLabel('Owner private liquidity claim')).toContainText('Closed');
  await expect(positions.getByRole('button',{name:'Close and withdraw all',exact:true})).toBeDisabled();
  const result=await control(page).snapshot();expect(result.sends.map(row=>row.name)).toEqual(['managePoolPosition']);expect(result.sends[0].gasLimit).toBe('30000000');expect(result.pending).toBeNull();
  expect(page.url()).toContain('/dex');await expect(page).toHaveTitle('Current DEX local fixture');await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:`C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/current-pool-position-${viewport.width}.png`});
  await control(page).set({wallet:`0x${'33'.repeat(20)}`,revoked:true});
  await expect(positions.getByLabel('Owner private liquidity claim')).toHaveCount(0);await expect(positions.getByRole('status')).not.toContainText('200 atoms');
});
for(const viewport of [{width:1440,height:1000},{width:390,height:844}])test(`current liquidity NFT admitted withdrawal and EOA transfer roundtrip at ${viewport.width}px`,async({page})=>{
  await page.setViewportSize(viewport);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(['error','warning'].includes(e.type())&&!e.text().includes('Failed to load resource: net::ERR_FAILED'))errors.push(e.text());});
  const positions=await readLiquidityClaim(page),recipient=`0x${'33'.repeat(20)}`;
  await positions.getByLabel('Test token 1 minimum payout').fill('99');await positions.getByLabel('Test token 0 minimum payout').fill('49');
  await positions.getByRole('button',{name:'Withdraw selected shares',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Withdraw liquidity',exact:true});
  await expect(dialog).toContainText('1/2');expect((await control(page).snapshot()).sends).toHaveLength(0);await dialog.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(positions.getByRole('status')).toContainText('submitted');await positions.getByRole('button',{name:'Check position status',exact:true}).click();
  await expect(positions.getByRole('status')).toContainText('Test token 1 100 atoms; Test token 0 50 atoms');
  await expect(positions.getByLabel('Owner private liquidity claim')).toContainText('Private shares100');
  const transfer=async(to:string)=>{await positions.getByLabel('Liquidity NFT recipient').fill(to);await positions.getByRole('button',{name:'Transfer liquidity NFT',exact:true}).click();
    const modal=page.getByRole('dialog',{name:'Transfer liquidity NFT',exact:true});await expect(modal).toContainText(to);await modal.getByRole('button',{name:'Continue',exact:true}).click();
    await expect(positions.getByRole('status')).toContainText('submitted');await positions.getByRole('button',{name:'Check position status',exact:true}).click();await expect(positions.getByRole('status')).toContainText('Old owner private access is revoked');await expect(positions.getByLabel('Owner private liquidity claim')).toHaveCount(0);};
  const activateResume=async(wallet:string)=>{await control(page).set({wallet});await positions.getByRole('button',{name:'Read private claim',exact:true}).click();
    await expect(positions.getByLabel('Owner private liquidity claim')).toContainText('Awaiting privacy activation');await expect(positions.getByRole('button',{name:'Withdraw selected shares',exact:true})).toBeDisabled();await expect(positions.getByLabel('Owner private liquidity claim')).not.toContainText('atoms');
    await positions.getByRole('button',{name:'Activate claim privacy',exact:true}).click();dialog=page.getByRole('dialog',{name:'Activate claim privacy',exact:true});await dialog.getByRole('button',{name:'Continue',exact:true}).click();
    await expect(positions.getByRole('status')).toContainText('submitted');await positions.getByRole('button',{name:'Check position status',exact:true}).click();await expect(positions.getByLabel('Owner private liquidity claim')).toContainText('Paused');
    await expect(positions.getByRole('button',{name:'Withdraw selected shares',exact:true})).toBeDisabled();await positions.getByRole('button',{name:'Resume liquidity claim',exact:true}).click();
    dialog=page.getByRole('dialog',{name:'Resume liquidity claim',exact:true});await dialog.getByRole('button',{name:'Continue',exact:true}).click();await expect(positions.getByRole('status')).toContainText('submitted');await positions.getByRole('button',{name:'Check position status',exact:true}).click();await expect(positions.getByLabel('Owner private liquidity claim')).toContainText('Active');};
  await transfer(recipient);await activateResume(recipient);await transfer(`0x${'22'.repeat(20)}`);await activateResume(`0x${'22'.repeat(20)}`);
  expect((await control(page).snapshot()).sends.map(x=>x.gasLimit)).toEqual(['100000000','10000000','30000000','30000000','10000000','30000000','30000000']);expect((await control(page).snapshot()).pending).toBeNull();
  await expect(page).toHaveTitle('Current DEX local fixture');expect(page.url()).toContain('/dex');await expect(page.locator('vite-error-overlay')).toHaveCount(0);expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/current-pool-admitted-${viewport.width}.png`});
});
for(const fault of ['contract','code-review','stale','cancel','pending','reload']as const)test(`current liquidity NFT transfer ${fault} remains fail closed`,async({page})=>{
  const positions=await readLiquidityClaim(page);await positions.getByLabel('Liquidity NFT recipient').fill(`0x${'33'.repeat(20)}`);
  if(fault==='contract')await control(page).set({recipientCode:'0x6001'});
  await positions.getByRole('button',{name:'Transfer liquidity NFT',exact:true}).click();
  if(fault==='contract'){await expect(positions.getByRole('status')).toContainText('Only EOA');expect((await control(page).snapshot()).sends).toHaveLength(0);return;}
  const modal=page.getByRole('dialog',{name:'Transfer liquidity NFT',exact:true});await expect(modal).toBeVisible();
  if(fault==='code-review')await control(page).set({recipientCode:'0x6001'});if(fault==='stale')await control(page).set({claimContextDrift:true});if(fault==='pending')await control(page).set({interrupted:true});
  await modal.getByRole('button',{name:fault==='cancel'?'Cancel':'Continue',exact:true}).click();
  if(['code-review','stale','cancel'].includes(fault)){expect((await control(page).snapshot()).sends).toHaveLength(0);return;}
  await expect(positions.getByRole('status')).toContainText(fault==='pending'?'interrupted':'submitted');
  if(fault==='reload'){const ledger=await page.evaluate(()=>(window as unknown as {__currentJourney:Control}).__currentJourney.exportChain());await page.reload();await page.evaluate(raw=>(window as unknown as {__currentJourney:Control}).__currentJourney.restoreChain(raw),ledger);await page.locator('button:visible').filter({hasText:/^Positions$/}).first().click();}
  const current=page.getByRole('region',{name:'Current liquidity NFT positions',exact:true});await current.getByRole('button',{name:'Check position status',exact:true}).click();
  await expect(current.getByRole('status')).toContainText(fault==='pending'?'Do not resend':'No private payout is confirmed');await expect(current.getByLabel('Owner private liquidity claim')).toHaveCount(fault==='pending'?1:0);
});
for(const fault of ['owner','cancel','minimum','debit','pending','reload']as const)test(`current liquidity NFT ${fault} fails without false private payout`,async({page})=>{
  const positions=await readLiquidityClaim(page);
  if(fault==='owner'){
    await control(page).set({wallet:`0x${'33'.repeat(20)}`,revoked:true});await expect(positions.getByLabel('Owner private liquidity claim')).toHaveCount(0);
    await expect(positions.getByRole('button',{name:'Close and withdraw all',exact:true})).toBeDisabled();return;
  }
  if(fault==='minimum')await positions.getByLabel('Test token 1 minimum payout').fill('201');
  if(fault==='debit')await control(page).set({badPoolDebit:true});if(fault==='pending')await control(page).set({interrupted:true});
  await positions.getByRole('button',{name:'Close and withdraw all',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Close liquidity claim',exact:true});
  if(fault==='cancel'){await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect((await control(page).snapshot()).sends).toHaveLength(0);return;}
  await dialog.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(positions.getByRole('status')).toContainText(fault==='minimum'?'minimum payout rejected':fault==='pending'?'interrupted':'submitted');
  if(fault==='reload'){
    const ledger=await page.evaluate(()=>(window as unknown as{__currentJourney:Control}).__currentJourney.exportChain());await page.reload();
    await page.evaluate(raw=>(window as unknown as{__currentJourney:Control}).__currentJourney.restoreChain(raw),ledger);
    await page.locator('button:visible').filter({hasText:/^Positions$/}).first().click();
  }
  const current=page.getByRole('region',{name:'Current liquidity NFT positions',exact:true});
  await current.getByRole('button',{name:'Check position status',exact:true}).click();await expect(current.getByRole('status')).not.toContainText('Private payouts verified');
  if(fault==='pending')await expect(current.getByRole('status')).toContainText('Do not resend');
  if(fault==='reload')await expect(current.getByRole('status')).toContainText('No private payout is confirmed');
});

// Returns with the private trade review open and no Accept sent.
async function review(page: Page, asyncMode = false) {
  const before = await control(page).snapshot();
  let swap: Swap;
  if (asyncMode) { swap = await ready(page, true); await reviewButton(swap).click(); }
  else swap = await quote(page);
  const dialog = reviewDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('You receive', { exact: true })).toBeVisible();
  await expect(dialog).toContainText('0.000016 BCN');
  await expect(dialog).toContainText('0.000015 HBR');
  expect((await control(page).snapshot()).sends).toHaveLength(before.sends.length + 1);
  await expect(swap.getByText(/^Paid /)).toHaveCount(0);
  return { swap, dialog };
}
const exportChain = (page: Page) => page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.exportChain());
async function reloadWithChain(page: Page, ledger: string) {
  await page.reload();
  await expect(page.getByRole('region', { name: 'Private Swap', exact: true })).toBeVisible();
  await page.evaluate(raw => (window as unknown as { __currentJourney: Control }).__currentJourney.restoreChain(raw), ledger);
}

for (const width of [1440, 390]) test(`async mined Accept stays pending CW00503 reload keeps public operation lookup at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', event => { if (['error', 'warning'].includes(event.type()) && !event.text().includes('net::ERR_FAILED')) errors.push(event.text()); });
  const { swap, dialog } = await review(page, true);
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(status(swap)).toHaveText('Accept is mined; settlement remains pending.');
  await reloadWithChain(page, await exportChain(page));
  const restored = page.getByRole('region', { name: 'Private Swap', exact: true });
  const before = await control(page).snapshot();
  await checkState(restored);
  await expect(status(restored)).toContainText('Accept is mined; settlement remains pending');
  await expect(operationFacts(restored)).toContainText(`Operation${before.operationId}`);
  await expect(restored.getByText(/^Paid /)).toHaveCount(0);
  await control(page).set({ settled: true });
  await checkState(restored);
  // The current App restores the operation of the same owner and privacy session from its saved, authenticated
  // record, so it verifies the private delivery after the reload (the old App reported public settlement only).
  await expect(status(restored)).toHaveText('Settlement confirmed by the private receipt.');
  await expect(restored.getByText(privatePaidResult, { exact: true })).toBeVisible();
  await expect(reviewButton(restored)).toHaveCount(0);
  const after = await control(page).snapshot();
  expect(after.sends).toEqual(before.sends); expect(after.signingAttempts).toBe(before.signingAttempts);
  expect(after.inputSignatureRequests).toBe(before.inputSignatureRequests);
  expect(page.url()).toContain('/dex'); await expect(page).toHaveTitle('Current DEX local fixture');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0); expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`cw00503-async-reload-${width}.png`) });
});

test('async mined Accept stays pending CW00503 known hash and blocked verification remain distinct from a missing hash', async ({ page }, info) => {
  const { swap, dialog } = await review(page, true);
  // The Accept stays a saved pending action while its receipt is not available.
  await control(page).set({ receiptAvailable: false });
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(status(swap)).toContainText('Accept submitted');
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.editPending({ verificationBlocked: true }));
  await control(page).set({ receiptAvailable: true });
  await remount(page);
  const restored = page.getByRole('region', { name: 'Private Swap', exact: true });
  const before = await control(page).snapshot();
  await checkState(restored);
  await expect(status(restored)).toContainText('Private verification failed or is unavailable');
  await expect(status(restored)).not.toContainText('has no transaction hash');
  await expect(restored.getByRole('link', { name: 'View transaction', exact: true })).toHaveAttribute('href', /0x[0-9a-f]{64}$/);
  const after = await control(page).snapshot();
  expect(after.sends).toEqual(before.sends); expect(after.signingAttempts).toBe(before.signingAttempts);
  expect(after.pending).not.toBeNull();
  await expect(restored.getByText(/^Paid /)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('cw00503-known-hash-blocked.png') });
});

// App finding (CW-112): build 13 checks the private Quote against the protections before it opens the review, so a Quote below the minimum fill shows "Private verification failed" and never this read-only "Quote cannot be accepted" review.
for (const width of [1440, 390]) test.fixme(`shows a read-only review when the private Quote misses minimum fill at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const swap = await ready(page);
  await control(page).set({ belowMinimumFill: true });
  const before = await control(page).snapshot();
  await reviewButton(swap).click();
  const dialog = page.getByRole('dialog', { name: 'Quote cannot be accepted', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('opacity', '1');
  await expect(dialog).toContainText('Below your minimum fill');
  await expect(dialog.getByText('You pay', { exact: true })).toBeVisible();
  await expect(dialog.getByText('You receive', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Average price', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Accept quote', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button')).toHaveCount(1);
  const after = await control(page).snapshot();
  expect(after.sends).toEqual(before.sends);
  expect(after.signingAttempts).toBe(before.signingAttempts);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`rejected-quote-${width}.png`), fullPage: true, animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('async rejected Quote offers Cancel and confirms release at stage 8', async ({ page }) => {
  const swap = await ready(page, true);
  await control(page).set({ belowMinimumFill: true });
  await reviewButton(swap).click();
  // The App reports the rejected Quote as a failed private check (see the finding at the read-only review test);
  // it opens no review and sends nothing.
  await expect(status(swap)).toHaveText('Private verification failed: Current-mode private receipt violates the protected intent.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await control(page).snapshot()).signingAttempts).toBe(1);
  await expect(swap.getByRole('button', { name: 'Cancel swap', exact: true })).toBeEnabled();
  await expect(swap.getByRole('button', { name: 'Recover swap', exact: true })).toHaveCount(0);
  await swap.getByRole('button', { name: 'Cancel swap', exact: true }).click();
  const cancel = page.getByRole('dialog', { name: 'Cancel private swap', exact: true });
  await expect(cancel).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteCheapAsync']);
  await cancel.getByRole('button', { name: 'Cancel swap', exact: true }).click();
  await expect(status(swap)).toHaveText('Quote cancelled before funding.');
  // RELEASED is stage 8 of the build 13 async protocol.
  expect((await control(page).snapshot()).stage).toBe(8);
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteCheapAsync', 'cancelSwap']);
});

test('malformed private payout stays a generic blocked review', async ({ page }) => {
  const swap = await ready(page);
  await control(page).set({ corruptPayout: true });
  const before = await control(page).snapshot();
  await reviewButton(swap).click();
  await expect(status(swap)).toContainText('Private verification failed');
  await expect(page.getByRole('dialog', { name: 'Quote cannot be accepted', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(reviewButton(swap)).toBeDisabled();
  await expect(swap.getByRole('button', { name: 'Accept quote', exact: true })).toHaveCount(0);
  expect((await control(page).snapshot()).sends).toEqual(before.sends);
  expect((await control(page).snapshot()).signingAttempts).toBe(before.signingAttempts);
});

test.describe('completion', () => {
  for (const width of [1440, 390]) test(`automatically observes async Quote progress without signing at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.clock.install();
    const swap = await quote(page, true);
    await expect(status(swap)).toContainText('Quote preparation is in progress');
    await page.clock.fastForward(5001);
    // Build 13 has four keeper work steps before READY.
    await expect(status(swap)).toContainText('0 of 4 work steps complete');
    expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteCheapAsync']);
    await reviewButton(swap).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`async-progress-${width}.png`) });
    await control(page).set({ ready: true });
    await page.clock.fastForward(5001);
    await expect(status(swap)).toHaveText('Private Quote is READY for review.');
    await expect(reviewButton(swap)).toBeEnabled();
    expect((await control(page).snapshot()).signingAttempts).toBe(1);
    await expect(reviewDialog(page)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('automatically verifies async delivery after explicit Accept, not at funding', async ({ page }) => {
    await page.clock.install();
    const swap = await quote(page, true);
    await expect(status(swap)).toContainText('Quote preparation is in progress');
    await control(page).set({ ready: true });
    await page.clock.fastForward(5001);
    await expect(status(swap)).toHaveText('Private Quote is READY for review.');
    await reviewButton(swap).click();
    await reviewDialog(page).getByRole('button', { name: 'Accept quote', exact: true }).click();
    await expect(status(swap)).toContainText('settlement remains pending');
    await expect(swap.getByText(/^Paid /)).toHaveCount(0);
    await control(page).set({ settled: true });
    await page.clock.fastForward(5001);
    await expect(swap.getByText(privatePaidResult, { exact: true })).toBeVisible();
    expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteCheapAsync', 'acceptPrivateSwapV1']);
  });

  test('async progress observation stops when the wallet changes', async ({ page }) => {
    await page.clock.install();
    const swap = await quote(page, true);
    await expect(status(swap)).toContainText('Quote preparation is in progress');
    await control(page).set({ connected: false });
    const before = await control(page).snapshot();
    await page.clock.fastForward(15000);
    const after = await control(page).snapshot();
    expect(after.calls).toEqual(before.calls);
    expect(after.signingAttempts).toBe(before.signingAttempts);
    await expect(status(swap)).toContainText('Wallet or network changed');
  });

  test('renders async terminal delivery and starts a new canonical Quote after completion', async ({ page }, info) => {
    const { swap, dialog } = await review(page, true);
    await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
    await expect(status(swap)).toHaveText('Accept is mined; settlement remains pending.');
    await control(page).set({ settled: true });
    await checkState(swap);
    await expect(status(swap)).toHaveText('Settlement confirmed by the private receipt.');
    await expect(swap.getByText(privatePaidResult, { exact: true })).toBeVisible();
    expect((await control(page).snapshot()).pending).toBeNull();
    await swap.screenshot({ path: info.outputPath('async-terminal.png') });
    await swap.getByRole('button', { name: 'New Quote', exact: true }).click();
    await expect(swap.getByText(/^Paid /)).toHaveCount(0);
    await ready(page, true);
    await expect(operationFacts(swap)).toContainText('Operation102');
    expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteCheapAsync', 'acceptPrivateSwapV1', 'quoteCheapAsync']);
  });

  test('rejects an async terminal receipt below the captured minimum input fill', async ({ page }) => {
    const { swap, dialog } = await review(page, true);
    await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
    await expect(status(swap)).toHaveText('Accept is mined; settlement remains pending.');
    await control(page).set({ settled: true, belowMinimumFill: true });
    await checkState(swap);
    await expect(status(swap)).toContainText('Private verification failed');
    await expect(status(swap)).not.toContainText('Settlement confirmed');
    await expect(swap.getByText(/^Paid /)).toHaveCount(0);
  });

  // The old test "expiry during private review prevents signing and permits a new unfunded Fast Quote" is two tests now.
  const expireDuringReview = async (page: Page) => {
    await page.clock.install();
    const { swap, dialog } = await review(page);
    // A build 13 Quote lives 900 s.
    await page.clock.fastForward(901_000);
    await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
    await expect(status(swap)).toContainText('Quote is not available for acceptance');
    expect((await control(page).snapshot()).signingAttempts).toBe(1);
    await checkState(swap);
    await expect(status(swap)).toHaveText('Fast Quote expired. Quote did not fund the swap; create a new Quote.');
    await expect(reviewButton(swap)).toHaveCount(0);
    expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteFastPool']);
    return swap;
  };
  test('expiry during private review prevents signing', async ({ page }) => {
    const swap = await expireDuringReview(page);
    await expect(swap.getByRole('button', { name: 'New Quote', exact: true })).toBeEnabled();
    await expect(swap.getByText(/^Paid /)).toHaveCount(0);
  });
  // App finding (CW-112): after an expired Fast Quote, New Quote and then Get Quote stop with "Reconcile the active owner swap before another Quote."; only a second Check current state closes the expired Quote in the owner record.
  test.fixme('expired Fast Quote permits a new unfunded Fast Quote', async ({ page }) => {
    const swap = await expireDuringReview(page);
    await swap.getByRole('button', { name: 'New Quote', exact: true }).click();
    await ready(page);
    await expect(operationFacts(swap)).toContainText('Operation102');
  });

  test('expired unfunded async Quote offers Cancel and never Recover', async ({ page }, info) => {
    await page.clock.install();
    const swap = await quote(page, true);
    await expect(status(swap)).toContainText('Quote preparation is in progress');
    const deadline = await page.evaluate(() => Number(JSON.parse(
      (window as unknown as { __currentJourney: Control }).__currentJourney.exportChain()
    ).deadline.__testBigInt));
    await page.clock.setSystemTime((deadline + 1) * 1000);
    await checkState(swap);
    await expect(status(swap)).toHaveText('Quote expired without funding. Use Cancel swap before a new Quote.');
    await expect(swap.getByRole('button', { name: 'Cancel swap', exact: true })).toBeEnabled();
    await expect(swap.getByRole('button', { name: 'Recover swap', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('expired-async-unfunded-quote.png'), fullPage: true });
  });

  test('a changed private Quote during review requires a fresh review before retry', async ({ page }) => {
    const { swap, dialog } = await review(page);
    await control(page).set({ quoteAmountDrift: true });
    await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
    await expect(status(swap)).toContainText('Quote changed during review');
    expect((await control(page).snapshot()).signingAttempts).toBe(1);
    await checkState(swap);
    await expect(status(swap)).toHaveText('Private Quote is READY for review.');
    await reviewButton(swap).click();
    const fresh = reviewDialog(page);
    await expect(fresh).toContainText('0.000014 HBR');
    await fresh.getByRole('button', { name: 'Accept quote', exact: true }).click();
    await expect(status(swap)).toHaveText('Settlement confirmed by the private receipt.');
    expect((await control(page).snapshot()).signingAttempts).toBe(2);
    expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteFastPool', 'acceptFastPool']);
  });

  test('canonical status-0 Quote clears only its journal and allows a fresh safe Quote', async ({ page }) => {
    await control(page).set({ revertNext: true });
    const swap = await quote(page);
    // The mined Quote has status 0: its issue cannot be read, and the saved action stays until the state check.
    await expect(status(swap)).toHaveText('Quote issue does not match the submitted transaction.');
    expect((await control(page).snapshot()).pending).not.toBeNull();
    await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeDisabled();
    await checkState(swap);
    await expect(status(swap)).toHaveText('Transaction reverted. No settlement or refund is confirmed.');
    expect((await control(page).snapshot()).pending).toBeNull();
    await expect(swap.getByText(/^Paid /)).toHaveCount(0);
    await swap.getByRole('button', { name: 'New Quote', exact: true }).click();
    await ready(page);
    await expect(operationFacts(swap)).toContainText('Operation101');
    expect((await control(page).snapshot()).signingAttempts).toBe(2);
  });

  // The old test "canonical status-0 Accept reconciles and offers a safe retry from READY" is two tests now.
  const revertedAccept = async (page: Page) => {
    const { swap, dialog } = await review(page);
    await control(page).set({ revertNext: true });
    await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
    await expect(status(swap)).toHaveText('Current DEX transaction failed on chain. Check its status before another action. Do not resend.');
    expect((await control(page).snapshot()).pending).not.toBeNull();
    await checkState(swap);
    await expect(status(swap)).toHaveText('Transaction reverted. No settlement or refund is confirmed.');
    expect((await control(page).snapshot()).pending).toBeNull();
    await expect(swap.getByText(/^Paid /)).toHaveCount(0);
    await checkState(swap);
    await expect(status(swap)).toHaveText('Private Quote is READY for review.');
    await expect(reviewButton(swap)).toBeEnabled();
    expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteFastPool', 'acceptFastPool']);
    expect((await control(page).snapshot()).signingAttempts).toBe(2);
    return swap;
  };
  test('canonical status-0 Accept reconciles without a settlement claim', async ({ page }) => {
    const swap = await revertedAccept(page);
    await expect(swap.getByText(/^Paid /)).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
  // App finding (CW-112): after a reverted Accept the App shows READY and Review and Accept, but the second Accept stops with "Owner beta swap scope, phase or prior reservation changed." and Cancel quote stops with "Fast Quote has funding, an Accept reservation or unresolved accounting."; the Quote stays until it expires.
  test.fixme('canonical status-0 Accept offers a safe retry from READY', async ({ page }) => {
    const swap = await revertedAccept(page);
    await reviewButton(swap).click();
    const retry = reviewDialog(page);
    await expect(retry).toBeVisible();
    await retry.getByRole('button', { name: 'Accept quote', exact: true }).click();
    await expect(status(swap)).toHaveText('Settlement confirmed by the private receipt.');
    expect((await control(page).snapshot()).signingAttempts).toBe(3);
  });

  // The current App restores an open Quote of the same owner and privacy session after a reload (the old App
  // reported "no authenticated Quote origin"). The reload sends nothing and asks for no input signature;
  // a disconnected wallet gets no state check, and Accept still needs a new review.
  test('full page reload and reconnect reconcile the pending Quote without a new send', async ({ page }) => {
    await control(page).set({ receiptAvailable: false });
    const swap = await quote(page);
    await expect(status(swap)).toContainText('Open submitted');
    await control(page).set({ connected: false });
    await expect(status(swap)).toContainText('Wallet or network changed');
    await expect(swap.getByRole('button', { name: 'Check current state', exact: true })).toHaveCount(0);
    await reloadWithChain(page, await exportChain(page));
    await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeDisabled();
    await checkState(swap);
    await expect(status(swap)).toHaveText('Private Quote is READY for review.');
    expect((await control(page).snapshot()).pending).toBeNull();
    expect((await control(page).snapshot()).signingAttempts).toBe(1);
    expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
    expect((await control(page).snapshot()).sends).toHaveLength(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(reviewButton(swap)).toBeEnabled();
    await expect(swap.getByText(/^Paid /)).toHaveCount(0);
  });
});

test('wallet response mismatch identifies the field and blocks another Quote send', async ({ page }) => {
  await control(page).set({ wrongWalletResponseNonce: true });
  const swap = await quote(page);
  await expect(status(swap)).toContainText('Mismatch: nonce');
  await expect(status(swap)).toContainText('Do not resend');
  expect((await control(page).snapshot()).pending).not.toBeNull();
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  await expect(reviewDialog(page)).toHaveCount(0);
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeDisabled();
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  expect((await control(page).snapshot()).pending).not.toBeNull();
});

// The balance line shows the amount; the token symbol is next to "You send" and "Estimated receive".
for (const width of [1440, 390]) test(`current private balances use normal units and follow the swap side at ${width}px`, async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
  // 1.25 BCN and 10000 HBR in raw units of 6-decimal tokens.
  await control(page).set({ balances: ['1250000', '10000000000'], balanceReadDelay: 300 });
  await swap.getByRole('button', { name: 'Refresh balances', exact: true }).click();
  await expect(swap.getByLabel('Input token balance')).toContainText('Loading');
  await expect(swap.locator('.dex-v2-amount-input')).toContainText('HBR');
  await expect(swap.getByLabel('Input token balance')).toHaveText('Balance: 10000.0');
  await expect(swap.locator('.dex-v2-quote-output')).toContainText('BCN');
  await expect(swap.getByLabel('Output token balance')).toHaveText('Balance: 1.25');
  await swap.getByRole('button', { name: 'Sell', exact: true }).click();
  await expect(swap.locator('.dex-v2-amount-input')).toContainText('BCN');
  await expect(swap.getByLabel('Input token balance')).toHaveText('Balance: 1.25');
  await expect(swap.getByLabel('Output token balance')).toHaveText('Balance: 10000.0');
  await page.screenshot({ path: info.outputPath(`swap-balances-${width}.png`), fullPage: true, animations: 'disabled' });
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('current private balances distinguish failure and zero and clear on privacy lock', async ({ page }) => {
  const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
  await expect(swap.getByRole('button', { name: 'Refresh balances', exact: true })).toBeEnabled();
  await control(page).set({ balanceReadFailure: true });
  await swap.getByRole('button', { name: 'Refresh balances', exact: true }).click();
  await expect(swap.getByLabel('Input token balance')).toHaveText('Balance: Unavailable');
  await expect(swap.getByLabel('Output token balance')).toHaveText('Balance: Unavailable');
  await control(page).set({ balanceReadFailure: false, balances: ['0', '0'] });
  await swap.getByRole('button', { name: 'Refresh balances', exact: true }).click();
  await expect(swap.getByLabel('Input token balance')).toHaveText('Balance: 0.0');
  await control(page).set({ privacyUnlocked: false });
  // A locked privacy session shows no amount and no balance refresh.
  await expect(swap.getByLabel('Input token balance')).toHaveText('Balance: Locked');
  await expect(swap.getByLabel('Output token balance')).toHaveText('Balance: Locked');
  await expect(swap.getByRole('button', { name: 'Refresh balances', exact: true })).toHaveCount(0);
  await control(page).set({ connected: false });
  // Without a wallet there is no balance line.
  await expect(swap.getByLabel('Input token balance')).toHaveCount(0);
  await expect(swap.getByLabel('Output token balance')).toHaveCount(0);
  expect((await control(page).snapshot()).sends).toHaveLength(0);
});

test('current private balances discard an in-flight read after wallet disconnect', async ({ page }) => {
  const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
  await expect(swap.getByRole('button', { name: 'Refresh balances', exact: true })).toBeEnabled();
  await control(page).set({ balanceReadDelay: 500 });
  await swap.getByRole('button', { name: 'Refresh balances', exact: true }).click();
  await expect(swap.getByLabel('Input token balance')).toContainText('Loading');
  await control(page).set({ connected: false });
  await expect(swap.getByLabel('Input token balance')).toHaveCount(0);
  await page.waitForTimeout(650);
  await expect(swap.getByLabel('Input token balance')).toHaveCount(0);
  expect((await control(page).snapshot()).sends).toHaveLength(0);
});

// Guided funding in the current App: the four private Quote inputs are signed first, then the swap asks for
// one token approval that is bound to this Quote ("Approve swap token"), then it sends the Quote. A missing
// balance is not funded by the swap; the owner claims test tokens under "Get test tokens".
for (const width of [1440, 390]) test(`guided allowance leads to Quote review and verified private result at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  await control(page).set({ balances: ['100', '100'] });
  const swap = await quoteInputs(page);
  await expect(swap.getByLabel('Existing DEX transaction hash', { exact: true })).toHaveCount(0);
  await expect(swap.getByLabel('Existing beta funding transaction hash', { exact: true })).toHaveCount(0);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const approval = approvalDialog(page);
  await expect(approval).toBeVisible();
  await expect(approval).toContainText('0.00002');
  // The private inputs are signed (4 signatures); no transaction was requested or sent.
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  expect((await control(page).snapshot()).signingAttempts).toBe(0);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(4);
  await page.screenshot({ path: info.outputPath(`guided-approval-${width}.png`), fullPage: true, animations: 'disabled' });
  await approval.getByRole('button', { name: 'Continue', exact: true }).click();
  const dialog = reviewDialog(page);
  await expect(dialog).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => [row.name, row.gasLimit])).toEqual([['approve', '5000000'], ['quoteFastPool', '110000000']]);
  expect((await control(page).snapshot()).allowances[1]).toBe('20');
  expect((await control(page).snapshot()).pending).toBeNull();
  await control(page).set({ balanceReadDelay: 200 });
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(status(swap)).toHaveText('Checking the quote and input funds before the wallet request.');
  await expect(status(swap)).toHaveText('Settlement confirmed by the private receipt.', { timeout: 20_000 });
  const result = swap.getByText(privatePaidResult, { exact: true });
  await expect(result).toBeVisible();
  await result.scrollIntoViewIfNeeded();
  await expect(result).toBeInViewport();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve', 'quoteFastPool', 'acceptFastPool']);
  expect((await control(page).snapshot()).pending).toBeNull();
  await expect(swap.getByLabel('Existing DEX transaction hash', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`guided-private-result-${width}.png`), animations: 'disabled' });
});

test('guided faucet and exact approval each require consent before Quote', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  const swap = await quoteInputs(page);
  // The swap does not claim tokens. With no balance it stops and sends nothing.
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await expect(status(swap)).toHaveText('Private input balance is insufficient. Claim test tokens separately before Get Quote.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  expect((await control(page).snapshot()).signingAttempts).toBe(0);
  // App finding (CW-112): the App asks for the four private input signatures before it reads the balance.
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(4);
  const panel = fundingPanel(page);
  await panel.locator(':scope > summary').click();
  await panel.getByRole('button', { name: 'Check balances and refills', exact: true }).click();
  await expect(fundingStatus(panel)).toHaveText('Balances and refills checked.');
  // claimTokens proves that the claim review shows before any send.
  await claimTokens(page, panel);
  await expect(fundingStatus(panel)).toHaveText('Claim confirmed. Your private balance is updated.');
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['claimFaucet']);
  expect((await control(page).snapshot()).pending).toBeNull();
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const approval = approvalDialog(page);
  await expect(approval).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['claimFaucet']);
  expect((await control(page).snapshot()).pending).toBeNull();
  await approval.getByRole('button', { name: 'Continue', exact: true }).click();
  const dialog = reviewDialog(page);
  await expect(dialog).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['claimFaucet', 'approve', 'quoteFastPool']);
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(status(swap)).toHaveText('Settlement confirmed by the private receipt.');
  await expect(swap.getByText(privatePaidResult, { exact: true })).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['claimFaucet', 'approve', 'quoteFastPool', 'acceptFastPool']);
});

for (const action of ['faucet', 'approve'] as const) test(`guided ${action} cancellation sends no funding or Quote`, async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
  if (action === 'faucet') {
    const panel = fundingPanel(page);
    await panel.locator(':scope > summary').click();
    await panel.getByRole('button', { name: 'Check balances and refills', exact: true }).click();
    await panel.getByRole('button', { name: 'Claim 10,000.0 HBR', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Claim HBR', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(fundingStatus(panel)).toHaveText('Beta token claim cancelled. Check funds before another action.');
  } else {
    await control(page).set({ balances: ['100', '100'] });
    await quoteInputs(page);
    await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
    const dialog = approvalDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(status(swap)).toHaveText('Token approval cancelled. No swap was sent.');
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  expect((await control(page).snapshot()).signingAttempts).toBe(0);
  expect((await control(page).snapshot()).pending).toBeNull();
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeEnabled();
});

test('guided private funds check clears parent recovery only after confirmed exact approval', async ({ page }) => {
  await page.clock.install();
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  await control(page).set({ balances: ['100', '100'], receiptAvailable: false });
  const swap = await quoteInputs(page);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const approval = approvalDialog(page);
  await expect(approval).toBeVisible();
  await approval.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(status(swap)).toHaveText('Token approval submitted. Waiting for its private result.');
  await passReceiptWait(page);
  await expect(status(swap)).toHaveText('Approval is pending. Check current state before another action; do not resend.');
  const observed = await control(page).snapshot();
  expect(observed.sends.map(row => row.name)).toEqual(['approve']);
  expect(JSON.parse(observed.pending!)).toMatchObject({ phase: 'token-approve', nonce: 4 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(swap.getByRole('button', { name: 'Check funding and continue', exact: true })).toBeEnabled();
  await expect(swap.getByRole('alert')).toHaveText('Check the pending funding transaction before another request.');
  await expect(swap.getByLabel('Maximum input', { exact: true })).toBeDisabled();
  await expect(swap.getByLabel('Minimum net output', { exact: true })).toBeDisabled();
  await expect(swap.getByRole('button', { name: 'Sell', exact: true })).toBeDisabled();
  await expect(swap.getByRole('button', { name: 'Multi-source', exact: true })).toBeDisabled();
  // The state check verifies the mined approval; it sends nothing and asks for no signature.
  await control(page).set({ receiptAvailable: true });
  await checkState(swap);
  await expect(status(swap)).toHaveText('Private input funds verified. Continue with Get Quote or Review and Accept.');
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeEnabled();
  await expect(swap.getByLabel('Maximum input', { exact: true })).toBeEnabled();
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(observed.inputSignatureRequests);
  expect((await control(page).snapshot()).pending).toBeNull();
  expect((await control(page).snapshot()).allowances[1]).toBe('20');
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await expect(reviewDialog(page)).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve', 'quoteFastPool']);
});

for (const width of [1440, 390]) test(`guided reloaded confirmed approval reaches Quote review without duplicate approval at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  await control(page).set({ balances: ['100', '100'], receiptAvailable: false });
  const swap = await quoteInputs(page);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const approval = approvalDialog(page);
  await expect(approval).toBeVisible();
  await approval.getByRole('button', { name: 'Continue', exact: true }).click();
  // The reload happens while the App waits for the approval receipt.
  await expect(status(swap)).toHaveText('Token approval submitted. Waiting for its private result.');
  const before = await control(page).snapshot();
  expect(before.sends.map(row => row.name)).toEqual(['approve']);
  expect(JSON.parse(before.pending!)).toMatchObject({ phase: 'token-approve', nonce: 4 });
  await reloadWithChain(page, await exportChain(page));
  const current = await quoteInputs(page);
  const funding = fundingPanel(page);
  // Get Quote stops at the saved approval before any signature; the state check verifies it.
  await current.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await expect(status(current)).toHaveText('Reconcile the pending or active owner record before normal use.');
  await expect(current.getByRole('button', { name: 'Check funding and continue', exact: true })).toBeVisible();
  await expect(current.getByLabel('Maximum input', { exact: true })).toBeDisabled();
  await control(page).set({ balanceReadFailure: true });
  await checkState(current);
  await expect(status(current)).toContainText('Test balance read unavailable');
  await expect(current.getByLabel('Maximum input', { exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve']);
  expect((await control(page).snapshot()).signingAttempts).toBe(before.signingAttempts);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  await control(page).set({ balanceReadFailure: false });
  await checkState(current);
  await expect(status(current)).toHaveText('Private input funds verified. Continue with Get Quote or Review and Accept.');
  expect((await control(page).snapshot()).pending).toBeNull();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve']);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  await current.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const dialog = reviewDialog(page);
  await expect(dialog).toBeVisible();
  // No second approval: the exact allowance of the first approval covers this Quote.
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve', 'quoteFastPool']);
  expect((await control(page).snapshot()).allowances[1]).toBe('20');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(funding).toHaveJSProperty('open', false);
  if (await current.locator('.dex-v2-current-advanced').first().getAttribute('open') !== null) await current.locator('.dex-v2-current-advanced > summary').first().click();
  const mainAction = reviewButton(current);
  await mainAction.scrollIntoViewIfNeeded();
  await expect(mainAction).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`guided-compact-ready-${width}.png`), animations: 'disabled' });
});

test('guided funding retry waits for an actual receipt without Quote or duplicate signatures', async ({ page }) => {
  await page.clock.install();
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  await control(page).set({ balances: ['100', '100'], receiptAvailable: false });
  const swap = await quoteInputs(page);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const approval = approvalDialog(page);
  await expect(approval).toBeVisible();
  await approval.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(status(swap)).toHaveText('Token approval submitted. Waiting for its private result.');
  await passReceiptWait(page);
  await expect(status(swap)).toHaveText('Approval is pending. Check current state before another action; do not resend.');
  const before = await control(page).snapshot();
  expect(before.sends.map(row => row.name)).toEqual(['approve']);
  // The state check is the retry that works in the current App (see the finding at the next test).
  await checkState(swap);
  await expect(status(swap)).toHaveText('Confirmation is not available yet. Keep this transaction pending and check its status. Do not resend.');
  await expect(swap.getByRole('button', { name: 'Check funding and continue', exact: true })).toBeVisible();
  await expect(swap.getByLabel('Maximum input', { exact: true })).toBeDisabled();
  await expect(swap.getByRole('button', { name: 'Sell', exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await control(page).snapshot()).pending).not.toBeNull();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve']);
  expect((await control(page).snapshot()).signingAttempts).toBe(before.signingAttempts);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(before.inputSignatureRequests);
  await control(page).set({ receiptAvailable: true });
  await checkState(swap);
  await expect(status(swap)).toHaveText('Private input funds verified. Continue with Get Quote or Review and Accept.');
  expect((await control(page).snapshot()).pending).toBeNull();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve']);
  expect((await control(page).snapshot()).signingAttempts).toBe(before.signingAttempts);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await expect(reviewDialog(page)).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve', 'quoteFastPool']);
  expect((await control(page).snapshot()).signingAttempts).toBe(before.signingAttempts + 1);
});

// App finding (CW-112): with a pending or mined swap approval, "Check funding and continue" always stops with "Reconcile the pending or active owner record before normal use."; only Check current state verifies the approval.
test.fixme('guided Check funding and continue verifies the mined approval and continues to the Quote', async ({ page }) => {
  await page.clock.install();
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  await control(page).set({ balances: ['100', '100'], receiptAvailable: false });
  const swap = await quoteInputs(page);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await approvalDialog(page).getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(status(swap)).toHaveText('Token approval submitted. Waiting for its private result.');
  await passReceiptWait(page);
  await control(page).set({ receiptAvailable: true });
  await swap.getByRole('button', { name: 'Check funding and continue', exact: true }).click();
  await expect(reviewDialog(page)).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve', 'quoteFastPool']);
});

for (const fault of ['wallet', 'funds'] as const) test(`guided approval rejects ${fault} drift before signing`, async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  await control(page).set({ balances: ['100', '100'] });
  const swap = await quoteInputs(page);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const approval = approvalDialog(page);
  await expect(approval).toBeVisible();
  const inputSignatures = (await control(page).snapshot()).inputSignatureRequests;
  await control(page).set(fault === 'wallet' ? { wallet: `0x${'33'.repeat(20)}` } : { balances: ['99', '99'] });
  // A wallet change closes the approval review itself; changed funds are found after Continue.
  if (fault === 'wallet') await expect(approval).toHaveCount(0);
  else await approval.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(status(swap)).toContainText(fault === 'wallet' ? 'Wallet or network changed' : 'funds changed during confirmation');
  // No approval signature and no transaction: the encrypted approval input is not requested after the drift.
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  expect((await control(page).snapshot()).signingAttempts).toBe(0);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(inputSignatures);
  expect((await control(page).snapshot()).pending).toBeNull();
});

test('guided wrong faucet credit locks Quote and remains blocked after reload', async ({ page }) => {
  await control(page).set({ badFundingCredit: true });
  const panel = await fundingView(page);
  await claimTokens(page, panel);
  await expect(fundingStatus(panel)).toHaveText('Beta funding private accounting, allowance or policy differs.');
  expect(JSON.parse((await control(page).snapshot()).pending!)).toMatchObject({ phase: 'token-faucet', verificationBlocked: true });
  const swap = await quote(page);
  await expect(status(swap)).toHaveText('Reconcile the pending or active owner record before normal use.');
  await checkState(swap);
  await expect(status(swap)).toContainText('Known beta funding verification failure');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  await reloadWithChain(page, await exportChain(page));
  const current = await quoteInputs(page);
  await current.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await expect(status(current)).toHaveText('Reconcile the pending or active owner record before normal use.');
  await checkState(current);
  await expect(status(current)).toContainText('Known beta funding verification failure');
  await expect(current.getByLabel('Maximum input', { exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const funding = fundingPanel(page);
  await expect(funding.getByRole('button', { name: 'Claim 10,000.0 HBR', exact: true })).toBeDisabled();
  expect((await control(page).snapshot()).pending).not.toBeNull();
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['claimFaucet']);
});

test('manual funding fallback waits and verifies each private result automatically', async ({ page }) => {
  const panel = await fundingView(page);
  await expect(panel.getByLabel('Existing beta funding transaction hash', { exact: true })).toHaveCount(0);
  await claimTokens(page, panel);
  await expect(fundingStatus(panel)).toHaveText('Claim confirmed. Your private balance is updated.');
  expect((await control(page).snapshot()).pending).toBeNull();
  await expect(panel.getByLabel('Existing beta funding transaction hash', { exact: true })).toHaveCount(0);
  // The token approval is part of the swap in the current App; it also waits and verifies its private result.
  const swap = await quote(page);
  await approvalDialog(page).getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(reviewDialog(page)).toBeVisible();
  expect((await control(page).snapshot()).pending).toBeNull();
  expect((await control(page).snapshot()).allowances[1]).toBe('20');
  await expect(swap.getByLabel('Existing DEX transaction hash', { exact: true })).toHaveCount(0);
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['claimFaucet', 'approve', 'quoteFastPool']);
});

test('guided Quote rejects a changed graph before any funding or private signatures', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  await control(page).set({ graphDrift: true });
  const swap = await quoteInputs(page);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await expect(status(swap)).toContainText('runtime hash differs');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  expect((await control(page).snapshot()).signingAttempts).toBe(0);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  expect((await control(page).snapshot()).pending).toBeNull();
});

test('automatic async Accept receipt remains pending until terminal private delivery', async ({ page }) => {
  const { swap, dialog } = await review(page, true);
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(status(swap)).toHaveText('Accept is mined; settlement remains pending.');
  await expect(swap.getByText(/^Paid /)).toHaveCount(0);
  // FUNDED is stage 6 of the build 13 async protocol.
  expect((await control(page).snapshot()).stage).toBe(6);
  expect((await control(page).snapshot()).pending).toBeNull();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteCheapAsync', 'acceptPrivateSwapV1']);
  await control(page).set({ settled: true });
  await checkState(swap);
  await expect(status(swap)).toHaveText('Settlement confirmed by the private receipt.');
  await expect(swap.getByText(privatePaidResult, { exact: true })).toBeVisible();
});

// The wallet returns only the transaction hash now; the App reads the transaction from the RPC. The second
// case delays that first read (the old case was a wallet response with no chain ID).
for (const delayed of [false, true]) for (const width of [1440, 390]) test(`confirmed Fast Quote opens trade review automatically at ${width}px${delayed ? ' with delayed transaction visibility' : ''}`, async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await control(page).set({ waitReceipt: true, delayedTransactionVisibility: delayed });
  const swap = await quote(page);
  const dialog = reviewDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('You pay');
  await expect(dialog).toContainText('You receive');
  await expect(dialog).toContainText('BCN');
  await expect(dialog).toContainText('Average price');
  await expect(dialog).not.toContainText('Expected unused-input refund');
  await expect(dialog).not.toContainText('Quote gas cost');
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteFastPool']);
  expect((await control(page).snapshot()).pending).toBeNull();
  await page.screenshot({ path: info.outputPath(`compact-quote-review-${width}.png`), fullPage: true, animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  await reviewButton(swap).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(status(swap)).toContainText('Settlement confirmed by the private receipt');
  await expect(swap.getByText(privatePaidResult, { exact: true })).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteFastPool', 'acceptFastPool']);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [1440, 390]) test(`CW00503 timing renders Fast Quote → canonical mined ID → separate review/Accept → protected net payout/refund at ${width}px`, async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const operationId = width === 390 ? '501' : '101';
  await control(page).set({ nextOperationId: operationId });
  const { swap, dialog } = await review(page);
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  // The App waits for the Accept receipt and verifies the private delivery itself.
  await expect(status(swap)).toHaveText('Settlement confirmed by the private receipt.');
  let observed = await control(page).snapshot();
  expect(observed.sends.map(({ name, operationId, gasLimit }) => ({ name, operationId, gasLimit }))).toEqual([
    { name: 'quoteFastPool', operationId, gasLimit: '110000000' },
    { name: 'acceptFastPool', operationId, gasLimit: '110000000' }
  ]);
  await expect(swap.getByText(privatePaidResult, { exact: true })).toBeVisible();
  const timing = await openTiming(swap);
  await expect(timing.locator('pre').nth(1)).toContainText('fast-private-delivery');
  await expect(timing).toContainText('These do not measure mining or browser paint.');
  await expect(timing).toContainText('Complete journey: Get Quote click to verified delivery/refund displayed');
  await expect(timing.locator('pre').first()).not.toContainText('actualInput');
  const measured = await journeyTiming(swap);
  expect(measured.operationId).toBe(operationId);
  expect(measured.quoteClickToPrivatePreviewDisplayedMs).toBeGreaterThanOrEqual(0);
  expect(measured.acceptConfirmationToVerifiedResultDisplayedMs).toBeGreaterThanOrEqual(0);
  expect(measured.quoteClickToVerifiedResultDisplayedMs).toBeGreaterThanOrEqual(measured.quoteClickToPrivatePreviewDisplayedMs!);
  observed = await control(page).snapshot();
  expect(observed.pending).toBeNull();
  expect(observed.calls).toContain('fastPoolQuotePublic');
  expect(observed.calls).toContain('fastPoolPrincipalReceipt');
  expect(await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.forgedCopyRejected())).toBe(true);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await timingScreenshot(swap, info, `cw00503-fast-timing-${width}`);
  await info.attach('local-journey', { body: JSON.stringify(observed, null, 2), contentType: 'application/json' });
});

test('CW00503 timing async mined Accept stays pending; owner recovery verifies the exact refund', async ({ page }, info) => {
  const { swap, dialog } = await review(page, true);
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(status(swap)).toHaveText('Accept is mined; settlement remains pending.');
  const timing = await openTiming(swap);
  await expect(timing.locator('pre').nth(1)).toContainText('async-funded-accept');
  expect((await journeyTiming(swap)).quoteClickToVerifiedResultDisplayedMs).toBeNull();
  expect((await journeyTiming(swap)).acceptConfirmationToVerifiedResultDisplayedMs).toBeNull();
  await expect(swap.getByText(/^Paid /)).toHaveCount(0);
  expect((await control(page).snapshot()).stage).toBe(6);
  await swap.getByRole('button', { name: 'Recover swap', exact: true }).click();
  const release = page.getByRole('dialog', { name: 'Recover private swap', exact: true });
  await expect(release).toBeVisible();
  expect((await control(page).snapshot()).sends).toHaveLength(2);
  await release.getByRole('button', { name: 'Recover swap', exact: true }).click();
  await expect(status(swap)).toHaveText('Released with a private refund receipt.');
  await expect(swap.getByText(privateRefundResult, { exact: true })).toBeVisible();
  const observed = await control(page).snapshot();
  expect(observed.sends.map(row => [row.name, row.gasLimit])).toEqual([['quoteCheapAsync', '110000000'], ['acceptPrivateSwapV1', '35000000'], ['recoverSwap', '50000000']]);
  expect(observed.pending).toBeNull();
  await expect.poll(async () => (await journeyTiming(swap)).quoteClickToVerifiedResultDisplayedMs).not.toBeNull();
  expect((await journeyTiming(swap)).quoteClickToVerifiedResultDisplayedMs).toBeGreaterThanOrEqual(0);
  await timingScreenshot(swap, info, 'cw00503-async-refund-timing');
});

test('CW00503 timing starts at the click and records only the first authenticated private preview', async ({ page }, info) => {
  const swap = await quote(page, true);
  await expect(status(swap)).toContainText('Quote preparation is in progress');
  expect((await journeyTiming(swap)).quoteClickToPrivatePreviewDisplayedMs).toBeNull();
  await control(page).set({ ready: true });
  await checkState(swap);
  await expect(reviewButton(swap)).toBeEnabled();
  // Public READY does not expose the authenticated private terms.
  expect((await journeyTiming(swap)).quoteClickToPrivatePreviewDisplayedMs).toBeNull();
  await reviewButton(swap).click();
  const dialog = reviewDialog(page);
  await expect(dialog.getByText('You receive', { exact: true })).toBeVisible();
  await expect.poll(async () => (await journeyTiming(swap)).quoteClickToPrivatePreviewDisplayedMs).not.toBeNull();
  const firstPreview = (await journeyTiming(swap)).quoteClickToPrivatePreviewDisplayedMs;
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(reviewButton(swap)).toBeEnabled();
  expect((await journeyTiming(swap)).acceptTransactionHash).toBeNull();
  expect((await journeyTiming(swap)).quoteClickToVerifiedResultDisplayedMs).toBeNull();
  await reviewButton(swap).click();
  await expect(dialog).toBeVisible();
  expect((await journeyTiming(swap)).quoteClickToPrivatePreviewDisplayedMs).toBe(firstPreview);
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(status(swap)).toContainText('settlement remains pending');
  const funded = await journeyTiming(swap);
  expect(funded.acceptAttempts.map(attempt => ({ cancelled: attempt.cancelled, submitted: attempt.submitted })))
    .toEqual([{ cancelled: true, submitted: false }, { cancelled: false, submitted: true }]);
  expect(funded.quoteClickToVerifiedResultDisplayedMs).toBeNull();
  await control(page).set({ settled: true });
  await checkState(swap);
  await expect(swap.getByText(privatePaidResult, { exact: true })).toBeVisible();
  await expect.poll(async () => (await journeyTiming(swap)).quoteClickToVerifiedResultDisplayedMs).not.toBeNull();
  const delivered = await journeyTiming(swap);
  expect(delivered.quoteClickToPrivatePreviewDisplayedMs).toBe(firstPreview);
  expect(delivered.acceptConfirmationToVerifiedResultDisplayedMs).toBeGreaterThanOrEqual(0);
  await checkState(swap);
  await expect(status(swap)).toHaveText('Settlement confirmed by the private receipt.');
  expect((await journeyTiming(swap)).quoteClickToVerifiedResultDisplayedMs).toBe(delivered.quoteClickToVerifiedResultDisplayedMs);
  await timingScreenshot(swap, info, 'cw00503-preview-cancel-retry-terminal');
  await swap.getByRole('button', { name: 'New Quote', exact: true }).click();
  await expect(swap.getByLabel('Local trial timing', { exact: true })).toHaveCount(0);
});

for (const reset of ['wallet', 'privacy', 'remount', 'reload'] as const) test(`CW00503 timing clears the old journey on ${reset}`, async ({ page }) => {
  const { swap, dialog } = await review(page);
  await expect.poll(async () => (await journeyTiming(swap)).quoteClickToPrivatePreviewDisplayedMs).not.toBeNull();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const sends = (await control(page).snapshot()).sends.length;
  if (reset === 'wallet') await control(page).set({ wallet: `0x${'33'.repeat(20)}` });
  else if (reset === 'privacy') await control(page).set({ privacyUnlocked: false });
  else if (reset === 'remount') await remount(page);
  else await page.reload();
  await expect(swap.getByLabel('Local trial timing', { exact: true })).toHaveCount(0);
  await expect(swap.getByText(/^Paid /)).toHaveCount(0);
  if (reset !== 'reload') expect((await control(page).snapshot()).sends).toHaveLength(sends);
});

test('async preparing Quote can be cancelled with a separately confirmed full refund', async ({ page }) => {
  const swap = await quote(page, true);
  await expect(status(swap)).toContainText('Quote preparation is in progress');
  await expect(reviewButton(swap)).toBeDisabled();
  await swap.getByRole('button', { name: 'Cancel swap', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel private swap', exact: true });
  await expect(dialog).toBeVisible();
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Cancel swap', exact: true }).click();
  // The Quote was not funded: the private receipt shows the whole input as unused.
  await expect(status(swap)).toHaveText('Quote cancelled before funding.');
  await expect(swap.getByText('Paid 0.0 HBR; received 0.0 BCN; unused 0.00002 HBR.', { exact: true })).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => [row.name, row.gasLimit])).toEqual([['quoteCheapAsync', '110000000'], ['cancelSwap', '30000000']]);
  expect((await control(page).snapshot()).pending).toBeNull();
});

// The current App restores an open Quote for the same owner and privacy session from its saved, authenticated
// record (the old App reported "no authenticated Quote origin"). Another wallet gets no operation and no Accept.
test('new wallet session after component remount observes mined metadata; another wallet gets no private Accept authority', async ({ page }) => {
  await control(page).set({ receiptAvailable: false });
  const swap = await quote(page);
  await expect(status(swap)).toContainText('Open submitted');
  expect((await control(page).snapshot()).pending).not.toBeNull();
  const signatures = (await control(page).snapshot()).inputSignatureRequests;
  await control(page).set({ receiptAvailable: true });
  await remount(page);
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeDisabled();
  await checkState(swap);
  await expect(status(swap)).toHaveText('Private Quote is READY for review.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(signatures);
  expect((await control(page).snapshot()).pending).toBeNull();
  await control(page).set({ wallet: `0x${'33'.repeat(20)}` });
  await expect(status(swap)).toHaveText('Wallet or network changed. Reconnect and reconcile the pending action.');
  await expect(reviewButton(swap)).toBeDisabled();
  await expect(swap.getByRole('button', { name: 'Check current state', exact: true })).toBeDisabled();
  await expect(swap.getByText(/^Paid /)).toHaveCount(0);
  expect((await control(page).snapshot()).sends).toHaveLength(1);
});

for (const issueLogs of ['missing', 'duplicate', 'forged'] as const) {
  test(`rejects ${issueLogs} mined issue event without inventing an operation ID`, async ({ page }) => {
    // The receipt is held back until the fixture changes its logs; the App reads a receipt each 2 s.
    await control(page).set({ receiptAvailable: false });
    const swap = await quote(page);
    await expect(status(swap)).toContainText('Open submitted');
    await control(page).set({ issueLogs });
    await control(page).set({ receiptAvailable: true });
    await expect(status(swap)).toContainText('Expected one Core quote issue event');
    await expect(operationFacts(swap)).toHaveCount(0);
    await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeDisabled();
    await expect(reviewDialog(page)).toHaveCount(0);
    expect((await control(page).snapshot()).pending).not.toBeNull();
    expect((await control(page).snapshot()).signingAttempts).toBe(1);
  });
}

test('unknown transport outcome retains nonce reservation and prevents a duplicate send', async ({ page }) => {
  await control(page).set({ interrupted: true });
  const swap = await quote(page);
  await expect(status(swap)).toContainText('Test transport interrupted');
  expect(JSON.parse((await control(page).snapshot()).pending!)).toMatchObject({ phase: 'quote', nonce: 4, txHash: null });
  await checkState(swap);
  await expect(status(swap)).toContainText('saved action has no transaction hash');
  const signatures = (await control(page).snapshot()).inputSignatureRequests;
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(status(swap)).toContainText('saved action has no transaction hash');
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(signatures);
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  expect((await control(page).snapshot()).signingAttempts).toBe(1);
});

for (const width of [1440, 390]) test(`expired Fast lost hash reconciles without new signatures at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  // The Quote stays a saved pending action while its receipt is not available.
  await control(page).set({ receiptAvailable: false });
  const swap = await quote(page);
  await expect(status(swap)).toContainText('Open submitted');
  const saved = await page.evaluate(() => {
    const fixture = (window as unknown as { __currentJourney: Control }).__currentJourney;
    const pending = fixture.editPending({ txHash: null });
    const ledger = JSON.parse(fixture.exportChain());
    return { hash: pending.txHash as string, expires: Number(ledger.deadline.__testBigInt) };
  });
  await page.clock.setSystemTime((saved.expires + 1) * 1000);
  await control(page).set({ receiptAvailable: true });
  await remount(page);
  await checkState(swap);
  await expect(status(swap)).toContainText('saved action has no transaction hash');
  const before = await control(page).snapshot();
  await swap.getByText('DEX recovery details', { exact: true }).click();
  await swap.getByLabel('Existing DEX transaction hash', { exact: true }).fill(saved.hash);
  await checkState(swap);
  await expect(status(swap)).toHaveText('Fast Quote expired. Quote did not fund the swap; create a new Quote.');
  expect((await control(page).snapshot()).pending).toBeNull();
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(before.inputSignatureRequests);
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  await expect(reviewButton(swap)).toHaveCount(0);
  await swap.getByRole('button', { name: 'New Quote', exact: true }).click();
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeEnabled();
  await expect(swap.getByLabel('Existing DEX transaction hash', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`expired-quote-reconciled-${width}.png`), fullPage: true });
});

for (const fault of ['wallet', 'context', 'headroom', 'graph', 'payout'] as const) {
  test(`rejects ${fault} drift without a false payout claim`, async ({ page }) => {
    const { swap, dialog } = await review(page);
    if (fault === 'wallet') await control(page).set({ revoked: true, wallet: `0x${'33'.repeat(20)}` });
    if (fault === 'context') await control(page).set({ contextDrift: true });
    if (fault === 'headroom') await control(page).set({ gasLimit: '50000000' });
    if (fault === 'graph') await control(page).set({ graphDrift: true });
    // The payout changes after the Accept send: the receipt is held back until the fixture changes the private receipt.
    if (fault === 'payout') await control(page).set({ receiptAvailable: false });
    // A wallet change closes the review itself; no Accept can start from it.
    if (fault === 'wallet') await expect(dialog).toHaveCount(0);
    else await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
    if (fault === 'payout') {
      await expect(status(swap)).toContainText('Accept submitted');
      await control(page).set({ corruptPayout: true });
      await control(page).set({ receiptAvailable: true });
      await expect(status(swap)).toContainText('Private verification failed');
      await expect(status(swap)).not.toContainText('Settlement confirmed');
      expect((await control(page).snapshot()).sends).toHaveLength(2);
    } else if (fault === 'graph') {
      // Within one wallet session the App reuses the graph qualification of the Quote (contract code is immutable
      // at the qualified canonical block), so the Accept is sent. The private result check reads the graph again
      // in its own scope and rejects the changed runtime: no payout is claimed and the saved action stays.
      await expect(status(swap)).toContainText('runtime hash differs');
      expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteFastPool', 'acceptFastPool']);
      expect((await control(page).snapshot()).pending).not.toBeNull();
    } else {
      await expect(status(swap)).toContainText(fault === 'wallet' ? 'Wallet or network changed' : fault === 'context' ? 'does not match' : 'headroom');
      expect((await control(page).snapshot()).sends).toHaveLength(1);
    }
    await expect(swap.getByText(/^Paid /)).toHaveCount(0);
  });
}
