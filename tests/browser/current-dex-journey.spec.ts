import { expect, test, type Page } from '@playwright/test';

type Control = {
  snapshot(): { sends: Array<{ name: string; operationId: string; nonce: number; gasLimit: string; data: string }>;
    calls: string[]; signingAttempts: number; inputSignatureRequests: number; operationId: string; stage: number; pending: string | null;limit:{id:string;unspent:string;proceeds:string;closed:boolean;balances:string[];status:string;coreLifecycle:string;engineLifecycle:string} };
  seedLimit(direction?:boolean):void;
  seedFunding(): void;
  set(next: { ready?: boolean; receiptAvailable?: boolean; waitReceipt?: boolean; interrupted?: boolean; corruptPayout?: boolean;
    graphDrift?: boolean; gasLimit?: string; wallet?: string; revoked?: boolean; contextDrift?: boolean;
    nextOperationId?: string; issueLogs?: 'missing' | 'duplicate' | 'forged'; settled?: boolean;
    revertNext?: boolean; quoteAmountDrift?: boolean; belowMinimumFill?: boolean; connected?: boolean;
    poolMode?: 'initialize' | 'add'; badPoolDebit?: boolean; denySignature?: boolean;badLimitTerms?:boolean;badLimitPayout?:boolean;recipientCode?:string;claimContextDrift?:boolean;badFundingCredit?:boolean;
    balances?: string[]; balanceReadFailure?: boolean; balanceReadDelay?: number; privacyUnlocked?: boolean; wrongWalletResponseNonce?: boolean; missingWalletChainId?: boolean; delayedTransactionVisibility?: boolean }): void;
  remount(): void;
  forgedCopyRejected(): Promise<boolean>;
  exportChain(): string;
  restoreChain(raw: string): void;
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
    body: 'export const issueOwnerCotiMetaMaskCapability = async ({bindCapability}) => bindCapability(window.__currentJourney.binding());' }));
  await page.route('**/src/lib/dexV2Chain.ts', async route => {
    const response = await route.fetch(), source = await response.text();
    expect(source).toContain('keccak256(code).toLowerCase()');
    // Same synthetic runtime-hash seam as currentSharedPoolGraph.test.ts.
    // Real runtime preimage checks belong to native graph evidence.
    await route.fulfill({ response, body: source.replace('keccak256(code).toLowerCase()',
      '(window.__currentJourney.runtimeHashes[code] ?? keccak256(code)).toLowerCase()') });
  });
  await page.route('**/dex', route => route.fulfill({ contentType: 'text/html', body:
    '<html><head><title>Current DEX local fixture</title><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root" class="app-shell app-shell-wallet app-shell-dex-v2"></div><script type="module" src="/tests/browser/current-dex-journey.fixture.ts"></script></body></html>' }));
  await page.goto('/dex');
  try{await expect(page.getByRole('region', { name: 'Private Swap', exact: true })).toBeVisible();}
  catch(error){await info.attach('startup-diagnostic',{body:JSON.stringify({url:page.url(),title:await page.title(),startupErrors,networkFailures,fixtureLoaded:await page.evaluate(()=>Boolean((window as unknown as{__currentJourney?:Control}).__currentJourney))}),contentType:'application/json'});await info.attach('startup-dom',{body:await page.content(),contentType:'text/html'});throw error;}
  if(info.title==='rejects graph drift without a false payout claim')await info.attach('startup-diagnostic',{body:JSON.stringify({url:page.url(),title:await page.title(),startupErrors,networkFailures,fixtureLoaded:await page.evaluate(()=>Boolean((window as unknown as{__currentJourney?:Control}).__currentJourney))}),contentType:'application/json'});
});

const privatePaidResult = 'Paid 0.000000000000000015 Test token 1; received 0.000000000000000016 Test token 0; refunded 0.000000000000000005 Test token 1.';
const privateRefundResult = 'Paid 0.0 Test token 1; received 0.0 Test token 0; refunded 0.00000000000000002 Test token 1.';
const timingScreenshotDirectory = 'C:/Users/rosu_/.codex/visualizations/2026/09/01/01a05cb7-8fd0-7510-ad9c-71cb0c8ea6a0';
type JourneyTiming = {
  operationId: string | null; quoteTransactionHash: string | null; acceptTransactionHash: string | null; terminalTransactionHash: string | null;
  quoteClickToPrivatePreviewDisplayedMs: number | null; acceptRequestToVerifiedResultDisplayedMs: number | null;
  acceptConfirmationToVerifiedResultDisplayedMs: number | null; quoteClickToVerifiedResultDisplayedMs: number | null;
  acceptAttempts: Array<{ cancelled: boolean; submitted: boolean; requestToConfirmationMs: number | null }>;
};
async function journeyTiming(swap: ReturnType<Page['getByRole']>): Promise<JourneyTiming> {
  const json = swap.getByLabel('Local trial timing', { exact: true }).locator('pre').first();
  await expect(json).toHaveCount(1);
  return JSON.parse((await json.textContent())!);
}
async function timingScreenshot(swap: ReturnType<Page['getByRole']>, name: string) {
  const setup = swap.locator('details.dex-v2-setup');
  if (await setup.getAttribute('open') === null) await setup.locator(':scope > summary').click();
  const timing = swap.getByLabel('Local trial timing', { exact: true });
  if (await timing.getAttribute('open') === null) await timing.locator(':scope > summary').click();
  // Only public identities and clocks belong in this screenshot.
  await timing.screenshot({ path: `${timingScreenshotDirectory}/${name}.png`, animations: 'disabled' });
}

async function quoteInputs(page: Page, asyncMode = false) {
  const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeEnabled();
  if (asyncMode) await swap.getByRole('button', { name: 'Multi-source', exact: true }).click();
  await swap.getByLabel('Maximum input', { exact: true }).fill('0.00000000000000002');
  const protections = swap.locator('.dex-v2-current-advanced').first();
  if (await protections.getAttribute('open') === null) {
    await protections.locator(':scope > summary').click();
  }
  const extra = protections.locator('.dex-v2-extra-settings');
  if (await extra.count() && await extra.getAttribute('open') === null) await extra.locator(':scope > summary').click();
  await swap.getByLabel('Minimum net output', { exact: true }).fill('0.000000000000000001');
  await swap.getByLabel('Minimum input fill', { exact: true }).fill('25');
  await swap.getByLabel('Price limit', { exact: true }).fill('1');
  return swap;
}

async function quote(page: Page, asyncMode = false) {
  const before = await control(page).snapshot();
  const swap = await quoteInputs(page, asyncMode);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm private Quote inputs', exact: true });
  await expect(dialog).toBeVisible();
  expect((await control(page).snapshot()).sends).toHaveLength(before.sends.length);
  expect((await control(page).snapshot()).signingAttempts).toBe(before.signingAttempts);
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  return swap;
}

test('initial connection does not mask invalid Quote input as a wallet change', async ({ page }) => {
  await control(page).set({ connected: false });
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.remount());
  const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
  await expect(swap).toBeVisible();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Connect the owner wallet');
  await control(page).set({ connected: true });
  await swap.getByRole('button', { name: 'Check current contracts', exact: true }).click();
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeEnabled();
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).not.toContainText('Wallet or network changed');
  await expect(swap.locator('.dex-v2-current-status')).toHaveText('You send: enter a token amount with at most 18 decimal places.');
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  await quote(page);
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Open submitted');
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  expect(await page.title()).toBe('Current DEX local fixture');
  expect(page.url()).toContain('/dex');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.screenshot({ path: 'C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/quote-initial-connection-fixed.png' });
});

async function poolPreview(page: Page) {
  await page.locator('button:visible').filter({ hasText: /^Strategies$/ }).first().click();
  const pool = page.getByRole('region', { name: 'Current private Pool creation', exact: true });
  await expect(pool).toBeVisible();
  await pool.getByLabel('Pool starting price', { exact: true }).fill('0.5');
  await pool.getByLabel('Test token 1 Pool budget', { exact: true }).fill('240');
  await pool.getByLabel('Test token 0 Pool budget', { exact: true }).fill('100');
  await pool.getByRole('button', { name: 'Get private Pool preview', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm private Pool inputs', exact: true });
  await expect(dialog).toBeVisible();
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(pool.getByRole('status')).toContainText('Pool preview submitted');
  await pool.getByRole('button', { name: 'Check Pool status', exact: true }).click();
  await expect(pool.getByLabel('Authenticated Pool preview')).toBeVisible();
  return pool;
}

for (const width of [1440, 390]) test(`direction-aware price and percentage fill at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await control(page).set({ balances: ['1000000000000000000', '1000000000000000000'], waitReceipt: true });
  const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
  await swap.getByRole('button', { name: 'Check current contracts', exact: true }).click();
  await swap.getByLabel('Maximum input', { exact: true }).fill('1');
  await swap.locator('.dex-v2-current-advanced > summary').click();
  await expect(swap.getByText('Maximum buy price', { exact: true })).toBeVisible();
  await expect(swap.getByLabel('Minimum input fill', { exact: true })).toHaveValue('0');
  await swap.getByLabel('Price limit', { exact: true }).fill('1.25');
  await swap.getByLabel('Minimum input fill', { exact: true }).fill('100.01');
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Minimum fill:');
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  await swap.getByLabel('Minimum input fill', { exact: true }).fill('25');
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const approval = page.getByRole('dialog', { name: 'Approve exact current input', exact: true });
  await expect(approval).toBeVisible();
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  await approval.getByRole('button', { name: 'Continue', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm private Quote inputs', exact: true });
  await expect(dialog).toContainText('25% minimum · 0.25 Test token 1');
  await expect(dialog).toContainText('1.25 Test token 1 per Test token 0 · net of fees');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await swap.locator('.dex-v2-current-advanced').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/swap-protections-${width}.png`, fullPage: true });
  await swap.getByRole('button', { name: 'Sell', exact: true }).click();
  await expect(swap.getByText('Minimum sell price', { exact: true })).toBeVisible();
  await expect(swap.getByLabel('Price limit', { exact: true })).toHaveValue('');
  await swap.getByLabel('Maximum input', { exact: true }).fill('1');
  await swap.getByLabel('Price limit', { exact: true }).fill('1.25');
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await expect(approval).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve']);
  await approval.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog).toContainText('25% minimum · 0.25 Test token 0');
  await expect(dialog).toContainText('1.25 Test token 1 per Test token 0 · net of fees');
  await expect(dialog).toContainText('Minimum sell price');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve', 'approve']);
  expect((await control(page).snapshot()).pending).toBeNull();
});

async function fundingView(page: Page, input: 0 | 1 = 1) {
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
  if (input === 0) await swap.getByRole('button', { name: 'Sell', exact: true }).click();
  await swap.getByLabel('Maximum input', { exact: true }).fill('0.00000000000000002');
  const form = swap.getByLabel('Current trial-token funding', { exact: true });
  await form.locator(':scope > summary').click(); await form.getByRole('button', { name: 'Check current input funds', exact: true }).click();
  await expect(form.getByLabel('Private current-token readiness')).toContainText('Balance 0.0 tokens; Core allowance 0.0 tokens.'); return form;
}
async function fundingAction(page: Page, form: ReturnType<Page['getByLabel']>, kind: 'faucet' | 'approve') {
  await form.getByRole('button', { name: kind === 'faucet' ? 'Claim current test-token faucet' : 'Approve exact input allowance', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: kind === 'faucet' ? 'Claim current test-token faucet' : 'Approve exact current input', exact: true });
  await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(form.locator(':scope > p[role=status]')).toContainText('Current-token action submitted');
}
async function checkFundingStatus(form: ReturnType<Page['getByLabel']>) {
  await form.getByRole('button', { name: 'Check funding status', exact: true }).click();
  await expect(form.locator('button').filter({ hasText: /^Check funding status$/ })).toBeEnabled();
  if (await form.getAttribute('open') === null) await form.locator(':scope > summary').click();
}
for (const width of [1440, 390]) test(`normal token input and exact approval at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error' && !e.text().includes('Failed to load resource: net::ERR_FAILED')) errors.push(e.text()); });
  const form = await fundingView(page);
  await fundingAction(page, form, 'faucet');
  await checkFundingStatus(form);
  const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
  await swap.getByLabel('Maximum input', { exact: true }).fill('1.25');
  await form.getByRole('button', { name: 'Check current input funds', exact: true }).click();
  await fundingAction(page, form, 'approve');
  await form.getByRole('button', { name: 'Check funding status', exact: true }).click();
  await expect(form.getByLabel('Private current-token readiness')).toContainText('Core allowance 1.25 tokens. Ready for this input.');
  await swap.getByRole('button', { name: 'Check current contracts', exact: true }).click();
  await expect(swap.getByLabel('Minimum net output')).toHaveValue('0');
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Price limit:');
  await swap.locator('.dex-v2-current-advanced > summary').click();
  await swap.getByLabel('Price limit', { exact: true }).fill('1');
  await swap.getByLabel('Minimum net output').fill('');
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('You receive at least:');
  await swap.getByLabel('Minimum net output').fill('0');
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm private Quote inputs', exact: true });
  await expect(dialog).toContainText('1.25 Test token 1');
  await expect(dialog).toContainText('0.0 Test token 0');
  expect((await control(page).snapshot()).sends).toHaveLength(2);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await swap.getByLabel('Maximum input').scrollIntoViewIfNeeded();
  expect(await page.title()).toBe('Current DEX local fixture');
  expect(page.url()).toContain('/dex');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: `C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/normal-swap-tokens-${width}.png` });
});
for (const [width, input, asyncMode] of [[1440, 1, false], [390, 0, true]] as const) test(`current-token funding exact faucet approval before ${asyncMode ? 'async' : 'Fast'} at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (['error', 'warning'].includes(e.type()) && !e.text().includes('Failed to load resource: net::ERR_FAILED')) errors.push(e.text()); });
  const form = await fundingView(page, input); await fundingAction(page, form, 'faucet');
  await checkFundingStatus(form); await expect(form.locator(':scope > p[role=status]')).toContainText('Exact private funding result verified');
  await expect(form.getByLabel('Private current-token readiness')).toContainText('Balance 10000.0 tokens; Core allowance 0.0 tokens.');
  await fundingAction(page, form, 'approve'); await checkFundingStatus(form);
  await expect(form.getByLabel('Private current-token readiness')).toContainText('Core allowance 0.00000000000000002 tokens. Ready for this input.');
  expect((await control(page).snapshot()).sends.map(x => [x.name, x.gasLimit])).toEqual([['claimFaucet', '5000000'], ['approve', '5000000']]);
  await form.getByRole('button', { name: 'Check current input funds', exact: true }).click();
  await form.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/current-token-funding-readiness-${width}.png`, fullPage: true });
  await quote(page, asyncMode); expect((await control(page).snapshot()).sends.map(x => x.name)).toEqual(['claimFaucet', 'approve', asyncMode ? 'quoteCheapAsyncV1' : 'quoteFastPoolV1']);
  await expect(page).toHaveTitle('Current DEX local fixture'); await expect(page.locator('vite-error-overlay')).toHaveCount(0); expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/current-token-funding-${width}.png`, fullPage: true });
});
test('current-token funding reload reconciles canonical metadata then verifies fresh private funds', async ({ page }) => {
  const form = await fundingView(page); await fundingAction(page, form, 'faucet');
  const saved = await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.exportChain());
  await page.reload(); await page.evaluate(raw => (window as unknown as { __currentJourney: Control }).__currentJourney.restoreChain(raw), saved);
  const current = page.getByLabel('Current trial-token funding', { exact: true }); await current.locator(':scope > summary').click();
  await checkFundingStatus(current); await expect(current.locator(':scope > p[role=status]')).toContainText('Private current-token balance and Core allowance verified');
  await expect(current.locator(':scope > p[role=status]')).not.toContainText('Exact private funding result verified');
  await expect(current.getByLabel('Private current-token readiness')).toContainText('10000.0 tokens'); expect((await control(page).snapshot()).pending).toBeNull();
  await current.getByRole('button', { name: 'Check current input funds', exact: true }).click(); await expect(current.getByLabel('Private current-token readiness')).toContainText('10000.0 tokens');
  expect((await control(page).snapshot()).sends).toHaveLength(1);
});
for (const width of [1440, 390]) test(`current-token funding lost hash reconciles the exact existing transaction at ${width}px without resending`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const form = await fundingView(page); await fundingAction(page, form, 'faucet');
  const existingHash = await page.evaluate(() => {
    const key = 'chainwhisper:dex:current-pending-attempt:v1', record = JSON.parse(sessionStorage.getItem(key)!);
    const hash = record.txHash; sessionStorage.setItem(key, JSON.stringify({ ...record, txHash: null }));
    (window as unknown as { __currentJourney: Control }).__currentJourney.remount(); return hash as string;
  });
  const current = page.getByLabel('Current trial-token funding', { exact: true }); await current.locator(':scope > summary').click();
  await checkFundingStatus(current);
  await expect(current.locator(':scope > p[role=status]')).toContainText('saved funding action has no hash');
  await expect(current.getByRole('button', { name: 'Check current input funds', exact: true })).toBeEnabled();
  await current.getByRole('button', { name: 'Check current input funds', exact: true }).click();
  await expect(current.locator(':scope > p[role=status]')).toContainText('saved funding action has no hash');
  await expect(current.getByLabel('Private current-token readiness')).toHaveCount(0);
  await current.locator('details > summary').filter({ hasText: /^Recovery details$/ }).click();
  await current.getByLabel('Existing funding transaction hash', { exact: true }).fill('invalid');
  await checkFundingStatus(current);
  await expect(current.locator(':scope > p[role=status]')).toContainText('Enter a valid funding transaction hash');
  expect((await control(page).snapshot()).pending).not.toBeNull();
  await current.getByLabel('Existing funding transaction hash', { exact: true }).fill(existingHash);
  await checkFundingStatus(current);
  await expect(current.locator(':scope > p[role=status]')).toContainText('Private current-token balance and Core allowance verified');
  await expect(current.locator(':scope > p[role=status]')).not.toContainText('Exact private funding result verified');
  await current.getByRole('button', { name: 'Check current input funds', exact: true }).click();
  await expect(current.getByLabel('Private current-token readiness')).toContainText('Balance 10000.0 tokens; Core allowance 0.0 tokens.');
  expect((await control(page).snapshot()).pending).toBeNull(); expect((await control(page).snapshot()).sends).toHaveLength(1);
  await expect(page).toHaveTitle('Current DEX local fixture'); expect(page.url()).toContain('/dex');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0); expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await current.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/funding-hash-recovery-${width}.png` });
});
test('current-token funding known wrong private credit remains blocked, never metadata fallback', async ({ page }) => {
  const form = await fundingView(page); await control(page).set({ badFundingCredit: true }); await fundingAction(page, form, 'faucet');
  await checkFundingStatus(form); await expect(form.locator(':scope > p[role=status]')).toContainText('private credit or allowance differs');
  await expect(form.getByRole('button', { name: 'Check current input funds', exact: true })).toBeEnabled();
  await form.getByRole('button', { name: 'Check current input funds', exact: true }).click();
  await expect(form.locator(':scope > p[role=status]')).toContainText('Known current-token verification failure');
  await expect(form.getByLabel('Private current-token readiness')).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Approve exact input allowance', exact: true })).toBeDisabled(); expect((await control(page).snapshot()).pending).not.toBeNull();
  await checkFundingStatus(form); expect((await control(page).snapshot()).pending).not.toBeNull(); expect((await control(page).snapshot()).sends).toHaveLength(1);
  const saved = await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.exportChain());
  await page.reload(); await page.evaluate(raw => (window as unknown as { __currentJourney: Control }).__currentJourney.restoreChain(raw), saved);
  const current = page.getByLabel('Current trial-token funding', { exact: true }); await current.locator(':scope > summary').click();
  await checkFundingStatus(current);
  await expect(current.locator(':scope > p[role=status]')).toContainText('Known current-token verification failure');
  await expect(current.getByRole('button', { name: 'Check current input funds', exact: true })).toBeEnabled();
  await current.getByRole('button', { name: 'Check current input funds', exact: true }).click();
  await expect(current.locator(':scope > p[role=status]')).toContainText('Known current-token verification failure');
  await expect(current.getByLabel('Private current-token readiness')).toHaveCount(0);
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
  test(`current Pool ${mode} preview and exact funding mint a verified NFT`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await control(page).set({ poolMode: mode });
    const pool = await poolPreview(page);
    await expect(page).toHaveTitle('Current DEX local fixture');
    expect(page.url()).toContain('/dex');
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    const preview = pool.getByLabel('Authenticated Pool preview');
    await expect(preview).toContainText(mode === 'initialize' ? 'Initialize this Pool' : 'Add to this Pool');
    await expect(preview).toContainText('Test token 1 debit200 atoms');
    await expect(preview).toContainText('Test token 0 debit100 atoms');
    await expect(preview).toContainText('Test token 1 left in wallet40 atoms');
    await expect(pool.getByLabel('Pool spread')).toHaveValue('1');
    expect(await pool.getByLabel('Pool spread').locator('option').allTextContents()).toEqual(['0.1%', '0.3%', '0.5%', '1%', '2%', '5%', '10%']);
    await preview.screenshot({ path: `C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/current-pool-${mode}-preview.png` });
    const before = await control(page).snapshot();
    await pool.getByRole('button', { name: 'Review and fund Pool', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: mode === 'initialize' ? 'Initialize this Pool' : 'Add to this Pool', exact: true });
    await expect(confirmation).toBeVisible();
    expect((await control(page).snapshot()).sends).toHaveLength(before.sends.length);
    await confirmation.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(pool.getByRole('status')).toContainText('Pool funding submitted');
    await pool.getByRole('button', { name: 'Check Pool status', exact: true }).click();
    await expect(pool.getByRole('status')).toContainText('Position NFT 82 minted. Both private token debits are verified.');
    const result = await control(page).snapshot();
    expect(result.sends.map(row => row.name)).toEqual(['previewPoolFunding', 'createPoolPosition']);
    expect(result.sends.map(row => row.gasLimit)).toEqual(['100000000', '100000000']);
    expect(result.pending).toBeNull();
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/current-pool-${mode}.png` });
  });
}

for (const fault of ['terms', 'owner', 'pending', 'graph', 'debit'] as const) {
  test(`current Pool ${fault} drift cannot reuse a private preview or claim an NFT result`, async ({ page }) => {
    const pool = await poolPreview(page);
    if (fault === 'terms') {
      await pool.getByLabel('Pool funding tolerance', { exact: true }).fill('2');
      await expect(pool.getByRole('button', { name: 'Review and fund Pool', exact: true })).toBeDisabled();
      await expect(pool.getByRole('alert')).toContainText('terms or wallet session changed');
    } else if (fault === 'owner') {
      await control(page).set({ wallet: `0x${'33'.repeat(20)}`, revoked: true });
      await expect(pool.getByRole('button', { name: 'Review and fund Pool', exact: true })).toBeDisabled();
      await expect(pool.getByLabel('Authenticated Pool preview')).toHaveCount(0);
    } else {
      if (fault === 'graph') await control(page).set({ graphDrift: true });
      if (fault === 'pending') await control(page).set({ interrupted: true });
      if (fault === 'debit') await control(page).set({ badPoolDebit: true });
      await pool.getByRole('button', { name: 'Review and fund Pool', exact: true }).click();
      if (fault !== 'graph') await page.getByRole('dialog', { name: 'Initialize this Pool', exact: true })
        .getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(pool.getByRole('status')).toContainText(fault === 'graph' ? 'runtime hash differs' : fault === 'pending' ? 'interrupted' : 'funding submitted');
      await pool.getByRole('button', { name: 'Check Pool status', exact: true }).click();
      if (fault === 'pending') {
        await expect(pool.getByRole('status')).toContainText('Do not resend');
        await expect(pool.getByRole('button', { name: 'Get private Pool preview', exact: true })).toBeDisabled();
      }
      await expect(pool.getByRole('status')).not.toContainText('NFT 82 minted');
    }
    expect((await control(page).snapshot()).sends.length).toBe(fault === 'debit' ? 2 : 1);
  });
}

test('current Pool denied signature sends nothing and status refresh permits a fresh preview', async ({ page }) => {
  await control(page).set({ denySignature: true });
  await page.locator('button:visible').filter({ hasText: /^Strategies$/ }).first().click();
  const pool = page.getByRole('region', { name: 'Current private Pool creation', exact: true });
  await pool.getByLabel('Pool starting price').fill('0.5');
  await pool.getByLabel('Test token 1 Pool budget').fill('240');
  await pool.getByLabel('Test token 0 Pool budget').fill('100');
  await pool.getByRole('button', { name: 'Get private Pool preview', exact: true }).click();
  await page.getByRole('dialog', { name: 'Confirm private Pool inputs' }).getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(pool.getByRole('status')).toContainText('signature denied');
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  await pool.getByRole('button', { name: 'Check Pool status', exact: true }).click();
  await expect(pool.getByRole('status')).toContainText('No pending Pool attempt');
  await expect(pool.getByRole('button', { name: 'Get private Pool preview', exact: true })).toBeEnabled();
});

test('current Pool reconnect cannot restore a prepared private preview', async ({ page }) => {
  await poolPreview(page);
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.remount());
  await page.locator('button:visible').filter({ hasText: /^Strategies$/ }).first().click();
  const pool = page.getByRole('region', { name: 'Current private Pool creation', exact: true });
  await expect(pool.getByLabel('Authenticated Pool preview')).toHaveCount(0);
  await expect(pool.getByRole('button', { name: 'Review and fund Pool', exact: true })).toHaveCount(0);
  expect((await control(page).snapshot()).sends).toHaveLength(1);
});

test('current Pool pending funding survives reload without private funding or NFT authority', async ({ page }) => {
  const pool = await poolPreview(page);
  await pool.getByRole('button', { name: 'Review and fund Pool', exact: true }).click();
  await page.getByRole('dialog', { name: 'Initialize this Pool' }).getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(pool.getByRole('status')).toContainText('funding submitted');
  expect((await control(page).snapshot()).pending).not.toBeNull();
  const ledger = await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.exportChain());
  await page.reload();
  await page.evaluate(raw => (window as unknown as { __currentJourney: Control }).__currentJourney.restoreChain(raw), ledger);
  await page.locator('button:visible').filter({ hasText: /^Strategies$/ }).first().click();
  const reconnected = page.getByRole('region', { name: 'Current private Pool creation', exact: true });
  await reconnected.getByRole('button', { name: 'Check Pool status', exact: true }).click();
  await expect(reconnected.getByRole('status')).toContainText('no authenticated private result');
  await expect(reconnected.getByLabel('Authenticated Pool preview')).toHaveCount(0);
  await expect(reconnected).not.toContainText('Verified position NFT ID');
  expect((await control(page).snapshot()).sends).toHaveLength(2);
});

async function ready(page: Page, asyncMode = false) {
  const before = await control(page).snapshot();
  const swap = await quote(page, asyncMode);
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Open submitted');
  expect((await control(page).snapshot()).sends).toHaveLength(before.sends.length + 1);
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  const id = (await control(page).snapshot()).operationId;
  await expect(swap.getByText(new RegExp(`^Operation ${id}\\.`))).toBeVisible();
  if (asyncMode) {
    await expect(swap.getByRole('button', { name: 'Review and Accept', exact: true })).toBeDisabled();
    await control(page).set({ ready: true });
    await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  }
  await expect(swap.getByRole('button', { name: 'Review and Accept', exact: true })).toBeEnabled();
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

async function review(page: Page, asyncMode = false) {
  const before = await control(page).snapshot();
  const swap = await ready(page, asyncMode);
  await swap.getByRole('button', { name: 'Review and Accept', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review private quote', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('You receive', { exact: true })).toBeVisible();
  await expect(dialog).toContainText('0.000000000000000016 Test token 0');
  await expect(dialog).toContainText('0.000000000000000015 Test token 1');
  expect((await control(page).snapshot()).sends).toHaveLength(before.sends.length + 1);
  await expect(swap.getByText(/^Paid /)).toHaveCount(0);
  return { swap, dialog };
}

for (const width of [1440, 390]) test(`async mined Accept stays pending CW00503 reload keeps public operation lookup at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', event => { if (['error', 'warning'].includes(event.type()) && !event.text().includes('net::ERR_FAILED')) errors.push(event.text()); });
  const { swap, dialog } = await review(page, true);
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Accept submitted');
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('settlement remains pending');
  const ledger = await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.exportChain());
  await page.reload();
  await page.evaluate(raw => (window as unknown as { __currentJourney: Control }).__currentJourney.restoreChain(raw), ledger);
  const restored = page.getByRole('region', { name: 'Private Swap', exact: true });
  const before = await control(page).snapshot();
  await restored.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(restored.locator('.dex-v2-current-status')).toContainText('Accept is mined; settlement remains pending');
  await expect(restored.getByText(`Operation ${before.operationId}. Public state: settling. Private accounting is not verified.`, { exact: true })).toBeVisible();
  await control(page).set({ settled: true });
  await restored.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(restored.locator('.dex-v2-current-status')).toContainText('Public settlement is complete');
  await expect(restored.getByText(/^Paid /)).toHaveCount(0);
  await expect(restored.getByRole('button', { name: 'Review and Accept', exact: true })).toHaveCount(0);
  const after = await control(page).snapshot();
  expect(after.sends).toEqual(before.sends); expect(after.signingAttempts).toBe(before.signingAttempts);
  expect(after.inputSignatureRequests).toBe(before.inputSignatureRequests);
  expect(page.url()).toContain('/dex'); await expect(page).toHaveTitle('Current DEX local fixture');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0); expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `C:/Users/rosu_/.codex/visualizations/2026/09/01/01a05cb7-8fd0-7510-ad9c-71cb0c8ea6a0/cw00503-async-reload-${width}.png` });
});

test('async mined Accept stays pending CW00503 known hash and blocked verification remain distinct from a missing hash', async ({ page }) => {
  const { swap, dialog } = await review(page, true);
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Accept submitted');
  await page.evaluate(() => {
    const key = 'chainwhisper:dex:current-pending-attempt:v1';
    const saved = JSON.parse(sessionStorage.getItem(key)!); saved.verificationBlocked = true;
    sessionStorage.setItem(key, JSON.stringify(saved));
    (window as unknown as { __currentJourney: Control }).__currentJourney.remount();
  });
  const restored = page.getByRole('region', { name: 'Private Swap', exact: true });
  const before = await control(page).snapshot();
  await restored.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(restored.locator('.dex-v2-current-status')).toContainText('Private verification failed or is unavailable');
  await expect(restored.locator('.dex-v2-current-status')).not.toContainText('has no transaction hash');
  await expect(restored.getByRole('link', { name: 'View transaction', exact: true })).toHaveAttribute('href', /0x[0-9a-f]{64}$/);
  const after = await control(page).snapshot();
  expect(after.sends).toEqual(before.sends); expect(after.signingAttempts).toBe(before.signingAttempts);
  await expect(restored.getByText(/^Paid /)).toHaveCount(0);
  await page.screenshot({ path: 'C:/Users/rosu_/.codex/visualizations/2026/09/01/01a05cb7-8fd0-7510-ad9c-71cb0c8ea6a0/cw00503-known-hash-blocked.png' });
});

for (const width of [1440, 390]) test(`shows a read-only review when the private Quote misses minimum fill at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const swap = await ready(page);
  await control(page).set({ belowMinimumFill: true });
  const before = await control(page).snapshot();
  await swap.getByRole('button', { name: 'Review and Accept', exact: true }).click();
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
  await page.screenshot({ path: `C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/rejected-quote-${width}.png`, fullPage: true, animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('async rejected Quote offers Cancel and confirms release at stage 7', async ({ page }) => {
  const swap = await ready(page, true);
  await control(page).set({ belowMinimumFill: true });
  await swap.getByRole('button', { name: 'Review and Accept', exact: true }).click();
  const rejected = page.getByRole('dialog', { name: 'Quote cannot be accepted', exact: true });
  await expect(rejected).toBeVisible();
  await rejected.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(swap.getByRole('button', { name: 'Cancel swap', exact: true })).toBeEnabled();
  await expect(swap.getByRole('button', { name: 'Recover swap', exact: true })).toHaveCount(0);
  await swap.getByRole('button', { name: 'Cancel swap', exact: true }).click();
  const cancel = page.getByRole('dialog', { name: 'Cancel private swap', exact: true });
  await expect(cancel).toBeVisible();
  await cancel.getByRole('button', { name: 'Cancel swap', exact: true }).click();
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toHaveText('Released with a private refund receipt.');
  expect((await control(page).snapshot()).stage).toBe(7);
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteCheapAsyncV1', 'cancelSwap']);
});

test('malformed private payout stays a generic blocked review', async ({ page }) => {
  const swap = await ready(page);
  await control(page).set({ corruptPayout: true });
  const before = await control(page).snapshot();
  await swap.getByRole('button', { name: 'Review and Accept', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Quote cannot be accepted', exact: true })).toHaveCount(0);
  await expect(swap.getByRole('button', { name: 'Review and Accept', exact: true })).toBeDisabled();
  await expect(swap.getByRole('button', { name: 'Accept quote', exact: true })).toHaveCount(0);
  expect((await control(page).snapshot()).sends).toEqual(before.sends);
  expect((await control(page).snapshot()).signingAttempts).toBe(before.signingAttempts);
});

test.describe('completion', () => {
  for (const width of [1440, 390]) test(`automatically observes async Quote progress without signing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.clock.install();
    await control(page).set({ waitReceipt: true });
    const swap = await quote(page, true);
    await expect(swap.locator('.dex-v2-current-status')).toContainText('Quote preparation is in progress');
    await page.clock.fastForward(5001);
    await expect(swap.locator('.dex-v2-current-status')).toContainText('0 of 3 work steps complete');
    expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteCheapAsyncV1']);
    await swap.locator('.dex-v2-current-advanced > summary').click();
    await swap.getByRole('button', { name: 'Review and Accept', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/async-progress-${width}.png` });
    await control(page).set({ ready: true });
    await page.clock.fastForward(5001);
    await expect(swap.locator('.dex-v2-current-status')).toHaveText('Private Quote is READY for review.');
    await expect(swap.getByRole('button', { name: 'Review and Accept', exact: true })).toBeEnabled();
    expect((await control(page).snapshot()).signingAttempts).toBe(1);
    await expect(page.getByRole('dialog', { name: 'Review private quote', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('automatically verifies async delivery after explicit Accept, not at funding', async ({ page }) => {
    await page.clock.install();
    await control(page).set({ waitReceipt: true });
    const swap = await quote(page, true);
    await expect(swap.locator('.dex-v2-current-status')).toContainText('Quote preparation is in progress');
    await control(page).set({ ready: true });
    await page.clock.fastForward(5001);
    await expect(swap.locator('.dex-v2-current-status')).toHaveText('Private Quote is READY for review.');
    await swap.getByRole('button', { name: 'Review and Accept', exact: true }).click();
    await page.getByRole('dialog', { name: 'Review private quote', exact: true }).getByRole('button', { name: 'Accept quote', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).toContainText('settlement remains pending');
    await expect(swap.getByText(/^Paid /)).toHaveCount(0);
    await control(page).set({ settled: true });
    await page.clock.fastForward(5001);
    await expect(swap.getByText(privatePaidResult, { exact: true })).toBeVisible();
    expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteCheapAsyncV1', 'acceptPrivateSwapV1']);
  });

  test('async progress observation stops when the wallet changes', async ({ page }) => {
    await page.clock.install();
    await control(page).set({ waitReceipt: true });
    const swap = await quote(page, true);
    await expect(swap.locator('.dex-v2-current-status')).toContainText('Quote preparation is in progress');
    await control(page).set({ connected: false });
    const before = await control(page).snapshot();
    await page.clock.fastForward(15000);
    const after = await control(page).snapshot();
    expect(after.calls).toEqual(before.calls);
    expect(after.signingAttempts).toBe(before.signingAttempts);
    await expect(swap.locator('.dex-v2-current-status')).toContainText('Wallet or network changed');
  });

  test('renders async terminal delivery and starts a new canonical Quote after completion', async ({ page }, info) => {
    const { swap, dialog } = await review(page, true);
    await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).toContainText('Accept submitted');
    await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).toContainText('settlement remains pending');
    await control(page).set({ settled: true });
    await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).toHaveText('Settlement confirmed by the private receipt.');
    await expect(swap.getByText(privatePaidResult, { exact: true })).toBeVisible();
    expect((await control(page).snapshot()).pending).toBeNull();
    await swap.screenshot({ path: info.outputPath('async-terminal.png') });
    await swap.getByRole('button', { name: 'New Quote', exact: true }).click();
    await expect(swap.getByText(/^Paid /)).toHaveCount(0);
    await ready(page, true);
    await expect(swap.getByText(/^Operation 102\./)).toBeVisible();
    expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteCheapAsyncV1', 'acceptPrivateSwapV1', 'quoteCheapAsyncV1']);
  });

  test('rejects an async terminal receipt below the captured minimum input fill', async ({ page }) => {
    const { swap, dialog } = await review(page, true);
    await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).toContainText('Accept submitted');
    await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).toContainText('settlement remains pending');
    await control(page).set({ settled: true, belowMinimumFill: true });
    await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).not.toContainText('Settlement confirmed');
    await expect(swap.getByText(/^Paid /)).toHaveCount(0);
  });

  test('expiry during private review prevents signing and permits a new unfunded Fast Quote', async ({ page }) => {
    await page.clock.install();
    const { swap, dialog } = await review(page);
    await page.clock.fastForward(601_000);
    await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).toContainText('Quote is not available for acceptance');
    expect((await control(page).snapshot()).signingAttempts).toBe(1);
    await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).toHaveText('Fast Quote expired. Quote did not fund the swap; create a new Quote.');
    await expect(swap.getByRole('button', { name: 'Review and Accept', exact: true })).toBeDisabled();
    await swap.getByRole('button', { name: 'New Quote', exact: true }).click();
    await ready(page);
    await expect(swap.getByText(/^Operation 102\./)).toBeVisible();
  });

  test('expired unfunded async Quote offers Cancel and never Recover', async ({ page }) => {
    await page.clock.install();
    const swap = await quote(page, true);
    await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
    const deadline = await page.evaluate(() => Number(JSON.parse(
      (window as unknown as { __currentJourney: Control }).__currentJourney.exportChain()
    ).deadline.__testBigInt));
    await page.clock.setSystemTime((deadline + 1) * 1000);
    await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).toHaveText('Quote expired without funding. Use Cancel swap before a new Quote.');
    await expect(swap.getByRole('button', { name: 'Cancel swap', exact: true })).toBeEnabled();
    await expect(swap.getByRole('button', { name: 'Recover swap', exact: true })).toHaveCount(0);
    await page.screenshot({ path: 'C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/expired-async-unfunded-quote.png', fullPage: true });
  });

  test('a changed private Quote during review requires a fresh review before retry', async ({ page }) => {
    const { swap, dialog } = await review(page);
    await control(page).set({ quoteAmountDrift: true });
    await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).toContainText('Quote changed during review');
    expect((await control(page).snapshot()).signingAttempts).toBe(1);
    await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).toHaveText('Private Quote is READY for review.');
    await swap.getByRole('button', { name: 'Review and Accept', exact: true }).click();
    const fresh = page.getByRole('dialog', { name: 'Review private quote', exact: true });
    await expect(fresh).toContainText('0.000000000000000014 Test token 1');
    await fresh.getByRole('button', { name: 'Accept quote', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).toContainText('Accept submitted');
    expect((await control(page).snapshot()).signingAttempts).toBe(2);
  });

  test('canonical status-0 Quote clears only its journal and allows a fresh safe Quote', async ({ page }) => {
    await control(page).set({ revertNext: true });
    const swap = await quote(page);
    await expect(swap.locator('.dex-v2-current-status')).toContainText('Open submitted');
    await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).toHaveText('Transaction reverted. No settlement or refund is confirmed.');
    expect((await control(page).snapshot()).pending).toBeNull();
    await expect(swap.getByText(/^Paid /)).toHaveCount(0);
    await swap.getByRole('button', { name: 'New Quote', exact: true }).click();
    await ready(page);
    await expect(swap.getByText(/^Operation 101\./)).toBeVisible();
    expect((await control(page).snapshot()).signingAttempts).toBe(2);
  });

  test('canonical status-0 Accept reconciles and offers a safe retry from READY', async ({ page }) => {
    const { swap, dialog } = await review(page);
    await control(page).set({ revertNext: true });
    await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).toContainText('Accept submitted');
    await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).toHaveText('Transaction reverted. No settlement or refund is confirmed.');
    expect((await control(page).snapshot()).pending).toBeNull();
    await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
    await expect(swap.getByRole('button', { name: 'Review and Accept', exact: true })).toBeEnabled();
    await swap.getByRole('button', { name: 'Review and Accept', exact: true }).click();
    const retry = page.getByRole('dialog', { name: 'Review private quote', exact: true });
    await expect(retry).toBeVisible();
    await retry.getByRole('button', { name: 'Accept quote', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).toContainText('Accept submitted');
    expect((await control(page).snapshot()).signingAttempts).toBe(3);
  });

  test('full page reload and reconnect reconcile only public pending state', async ({ page }) => {
    await control(page).set({ receiptAvailable: false });
    const swap = await quote(page);
    await expect(swap.locator('.dex-v2-current-status')).toContainText('Open submitted');
    await control(page).set({ connected: false });
    await expect(swap.locator('.dex-v2-current-status')).toContainText('Wallet or network changed');
    await expect(swap.getByRole('button', { name: 'Check current state', exact: true })).toHaveCount(0);
    const ledger = await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.exportChain());
    await page.reload();
    await expect(swap).toBeVisible();
    await page.evaluate(raw => (window as unknown as { __currentJourney: Control }).__currentJourney.restoreChain(raw), ledger);
    await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeDisabled();
    await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).toHaveText('Open mined, but this session has no authenticated Quote origin. Accept is unavailable.');
    expect((await control(page).snapshot()).pending).toBeNull();
    expect((await control(page).snapshot()).signingAttempts).toBe(1);
    await expect(swap.getByRole('button', { name: 'Review and Accept', exact: true })).toHaveCount(0);
    await expect(swap.getByText(/^Paid /)).toHaveCount(0);
  });
});

test('wallet response mismatch identifies the field and blocks another Quote send', async ({ page }) => {
  await control(page).set({ wrongWalletResponseNonce: true });
  const swap = await quote(page);
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Mismatch: nonce');
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Do not resend');
  expect((await control(page).snapshot()).pending).not.toBeNull();
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  await expect(page.getByRole('dialog', { name: 'Review private quote', exact: true })).toHaveCount(0);
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeDisabled();
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  expect((await control(page).snapshot()).pending).not.toBeNull();
});

for (const width of [1440, 390]) test(`current private balances use normal units and follow the swap side at ${width}px`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
  await control(page).set({ balances: ['1250000000000000000', '10000000000000000000000'], balanceReadDelay: 300 });
  await swap.getByRole('button', { name: 'Refresh balances', exact: true }).click();
  await expect(swap.getByLabel('Input token balance')).toContainText('Loading');
  await expect(swap.getByLabel('Input token balance')).toHaveText('Balance: 10000.0 Test token 1');
  await expect(swap.getByLabel('Output token balance')).toHaveText('Balance: 1.25 Test token 0');
  await swap.getByRole('button', { name: 'Sell', exact: true }).click();
  await expect(swap.getByLabel('Input token balance')).toHaveText('Balance: 1.25 Test token 0');
  await expect(swap.getByLabel('Output token balance')).toHaveText('Balance: 10000.0 Test token 1');
  await page.screenshot({ path: `C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/swap-balances-${width}.png`, fullPage: true, animations: 'disabled' });
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
  await expect(swap.getByLabel('Input token balance')).toHaveText('Balance: Unavailable Test token 1');
  await expect(swap.getByLabel('Output token balance')).toHaveText('Balance: Unavailable Test token 0');
  await control(page).set({ balanceReadFailure: false, balances: ['0', '0'] });
  await swap.getByRole('button', { name: 'Refresh balances', exact: true }).click();
  await expect(swap.getByLabel('Input token balance')).toHaveText('Balance: 0.0 Test token 1');
  await control(page).set({ privacyUnlocked: false });
  await expect(swap.getByLabel('Input token balance')).toHaveText('Balance: Unlock privacy Test token 1');
  await expect(swap.getByRole('button', { name: 'Refresh balances', exact: true })).toBeDisabled();
  await control(page).set({ connected: false });
  await expect(swap.getByLabel('Output token balance')).toHaveText('Balance: Connect wallet Test token 0');
  expect((await control(page).snapshot()).sends).toHaveLength(0);
});

test('current private balances discard an in-flight read after wallet disconnect', async ({ page }) => {
  const swap = page.getByRole('region', { name: 'Private Swap', exact: true });
  await expect(swap.getByRole('button', { name: 'Refresh balances', exact: true })).toBeEnabled();
  await control(page).set({ balanceReadDelay: 500 });
  await swap.getByRole('button', { name: 'Refresh balances', exact: true }).click();
  await expect(swap.getByLabel('Input token balance')).toContainText('Loading');
  await control(page).set({ connected: false });
  await expect(swap.getByLabel('Input token balance')).toContainText('Connect wallet');
  await page.waitForTimeout(650);
  await expect(swap.getByLabel('Input token balance')).toContainText('Connect wallet');
  expect((await control(page).snapshot()).sends).toHaveLength(0);
});

for (const width of [1440, 390]) test(`guided allowance leads to Quote review and verified private result at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  await control(page).set({ balances: ['100', '100'], waitReceipt: true });
  const swap = await quoteInputs(page);
  await expect(swap.getByLabel('Existing DEX transaction hash', { exact: true })).toHaveCount(0);
  await expect(swap.getByLabel('Existing funding transaction hash', { exact: true })).toHaveCount(0);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const approval = page.getByRole('dialog', { name: 'Approve exact current input', exact: true });
  await expect(approval).toBeVisible();
  await expect(approval).toContainText('0.00000000000000002');
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  await page.screenshot({ path: `C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/guided-approval-${width}.png`, fullPage: true, animations: 'disabled' });
  await approval.getByRole('button', { name: 'Continue', exact: true }).click();
  const inputs = page.getByRole('dialog', { name: 'Confirm private Quote inputs', exact: true });
  await expect(inputs).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => [row.name, row.gasLimit])).toEqual([['approve', '5000000']]);
  expect((await control(page).snapshot()).pending).toBeNull();
  await inputs.getByRole('button', { name: 'Continue', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review private quote', exact: true });
  await expect(dialog).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve', 'quoteFastPoolV1']);
  await control(page).set({ balanceReadDelay: 600 });
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toHaveText('Checking the quote and input funds before the wallet request.');
  await expect(swap.locator('.dex-v2-current-status')).toHaveText('Settlement confirmed by the private receipt.');
  const result = swap.getByText(privatePaidResult, { exact: true });
  await expect(result).toBeVisible();
  await result.scrollIntoViewIfNeeded();
  await expect(result).toBeInViewport();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve', 'quoteFastPoolV1', 'acceptFastPoolV1']);
  expect((await control(page).snapshot()).pending).toBeNull();
  await expect(swap.getByLabel('Existing DEX transaction hash', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/guided-private-result-${width}.png`, animations: 'disabled' });
});

test('guided faucet and exact approval each require consent before Quote', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  await control(page).set({ waitReceipt: true });
  const swap = await quoteInputs(page);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const faucet = page.getByRole('dialog', { name: 'Claim current test-token faucet', exact: true });
  await expect(faucet).toBeVisible();
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  await faucet.getByRole('button', { name: 'Continue', exact: true }).click();
  const approval = page.getByRole('dialog', { name: 'Approve exact current input', exact: true });
  await expect(approval).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['claimFaucet']);
  expect((await control(page).snapshot()).pending).toBeNull();
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  await approval.getByRole('button', { name: 'Continue', exact: true }).click();
  const inputs = page.getByRole('dialog', { name: 'Confirm private Quote inputs', exact: true });
  await expect(inputs).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['claimFaucet', 'approve']);
  expect((await control(page).snapshot()).pending).toBeNull();
  await inputs.getByRole('button', { name: 'Continue', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review private quote', exact: true });
  await expect(review).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['claimFaucet', 'approve', 'quoteFastPoolV1']);
  await review.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toHaveText('Settlement confirmed by the private receipt.');
  await expect(swap.getByText(privatePaidResult, { exact: true })).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['claimFaucet', 'approve', 'quoteFastPoolV1', 'acceptFastPoolV1']);
});

for (const action of ['faucet', 'approve'] as const) test(`guided ${action} cancellation sends no funding or Quote`, async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  if (action === 'approve') await control(page).set({ balances: ['100', '100'] });
  const swap = await quoteInputs(page);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: action === 'faucet' ? 'Claim current test-token faucet' : 'Approve exact current input', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Confirm private Quote inputs', exact: true })).toHaveCount(0);
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  expect((await control(page).snapshot()).signingAttempts).toBe(0);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  expect((await control(page).snapshot()).pending).toBeNull();
});

test('guided private funds check clears parent recovery only after confirmed exact approval', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  await control(page).set({ balances: ['100', '100'], waitReceipt: false });
  const swap = await quoteInputs(page);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const approval = page.getByRole('dialog', { name: 'Approve exact current input', exact: true });
  await expect(approval).toBeVisible();
  await approval.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toHaveText('Funding is still pending. Select Check funding and continue; do not resend.');
  const observed = await control(page).snapshot();
  expect(observed.sends.map(row => row.name)).toEqual(['approve']);
  expect(JSON.parse(observed.pending!)).toMatchObject({ phase: 'token-approve', nonce: 4 });
  await expect(page.getByRole('dialog', { name: 'Confirm private Quote inputs', exact: true })).toHaveCount(0);
  await expect(swap.getByRole('button', { name: 'Check funding and continue', exact: true })).toBeEnabled();
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(observed.inputSignatureRequests);
  await expect(swap.getByLabel('Maximum input', { exact: true })).toBeDisabled();
  await expect(swap.getByLabel('Minimum net output', { exact: true })).toBeDisabled();
  await expect(swap.getByRole('button', { name: 'Sell', exact: true })).toBeDisabled();
  await expect(swap.getByRole('button', { name: 'Multi-source', exact: true })).toBeDisabled();
  const funding = swap.getByLabel('Current trial-token funding', { exact: true });
  await expect(funding).toHaveJSProperty('open', false);
  await funding.locator(':scope > summary').click();
  await funding.getByRole('button', { name: 'Check current input funds', exact: true }).click();
  await expect(funding.locator(':scope > p[role=status]')).toContainText('Exact private funding result verified');
  await expect(funding.getByLabel('Private current-token readiness')).toContainText('Ready for this input');
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeEnabled();
  await expect(swap.getByLabel('Maximum input', { exact: true })).toBeEnabled();
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(observed.inputSignatureRequests);
  expect((await control(page).snapshot()).pending).toBeNull();
  await control(page).set({ waitReceipt: true });
  await quote(page);
  await expect(page.getByRole('dialog', { name: 'Review private quote', exact: true })).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve', 'quoteFastPoolV1']);
});

for (const width of [1440, 390]) test(`guided reloaded confirmed approval reaches Quote review without duplicate approval at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  await control(page).set({ balances: ['100', '100'], waitReceipt: false });
  const swap = await quoteInputs(page);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const approval = page.getByRole('dialog', { name: 'Approve exact current input', exact: true });
  await expect(approval).toBeVisible();
  await approval.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(swap.getByRole('button', { name: 'Check funding and continue', exact: true })).toBeEnabled();
  const before = await control(page).snapshot();
  expect(before.sends.map(row => row.name)).toEqual(['approve']);
  expect(JSON.parse(before.pending!)).toMatchObject({ phase: 'token-approve', nonce: 4 });
  const ledger = await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.exportChain());
  await page.reload();
  await page.evaluate(raw => (window as unknown as { __currentJourney: Control }).__currentJourney.restoreChain(raw), ledger);
  await control(page).set({ waitReceipt: true, balanceReadFailure: true });
  const current = await quoteInputs(page);
  const funding = current.getByLabel('Current trial-token funding', { exact: true });
  await expect(funding).toHaveJSProperty('open', false);
  await current.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await expect(current.locator('.dex-v2-current-status')).toContainText('Test balance read unavailable');
  const retry = current.getByRole('button', { name: 'Check funding and continue', exact: true });
  await expect(retry).toBeEnabled();
  await expect(current.getByLabel('Maximum input', { exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await control(page).snapshot()).pending).toBeNull();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve']);
  expect((await control(page).snapshot()).signingAttempts).toBe(before.signingAttempts);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  await control(page).set({ balanceReadFailure: false });
  await retry.click();
  const inputs = page.getByRole('dialog', { name: 'Confirm private Quote inputs', exact: true });
  await expect(inputs).toBeVisible();
  expect((await control(page).snapshot()).pending).toBeNull();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve']);
  expect((await control(page).snapshot()).signingAttempts).toBe(before.signingAttempts);
  await inputs.getByRole('button', { name: 'Continue', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review private quote', exact: true });
  await expect(review).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve', 'quoteFastPoolV1']);
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(funding).toHaveJSProperty('open', false);
  if (await current.locator('.dex-v2-current-advanced').getAttribute('open') !== null) await current.locator('.dex-v2-current-advanced > summary').click();
  const mainAction = current.getByRole('button', { name: 'Review and Accept', exact: true });
  await mainAction.scrollIntoViewIfNeeded();
  await expect(mainAction).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/guided-compact-ready-${width}.png`, animations: 'disabled' });
});

test('guided funding retry waits for an actual receipt without Quote or duplicate signatures', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  await control(page).set({ balances: ['100', '100'], waitReceipt: false, receiptAvailable: false });
  const swap = await quoteInputs(page);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const approval = page.getByRole('dialog', { name: 'Approve exact current input', exact: true });
  await expect(approval).toBeVisible();
  await approval.getByRole('button', { name: 'Continue', exact: true }).click();
  const retry = swap.getByRole('button', { name: 'Check funding and continue', exact: true });
  await expect(retry).toBeEnabled();
  const before = await control(page).snapshot();
  expect(before.sends.map(row => row.name)).toEqual(['approve']);
  await retry.click();
  await expect(retry).toBeEnabled();
  await expect(swap.getByLabel('Maximum input', { exact: true })).toBeDisabled();
  await expect(swap.getByRole('button', { name: 'Sell', exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await control(page).snapshot()).pending).not.toBeNull();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve']);
  expect((await control(page).snapshot()).signingAttempts).toBe(before.signingAttempts);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(before.inputSignatureRequests);
  const funding = swap.getByLabel('Current trial-token funding', { exact: true });
  await funding.locator(':scope > summary').click();
  await funding.getByRole('button', { name: 'Check current input funds', exact: true }).click();
  await expect(funding.getByRole('button', { name: 'Check current input funds', exact: true })).toBeEnabled();
  await expect(funding.getByLabel('Private current-token readiness')).toHaveCount(0);
  expect((await control(page).snapshot()).pending).not.toBeNull();
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(before.inputSignatureRequests);
  await control(page).set({ waitReceipt: true, receiptAvailable: true });
  await retry.click();
  await expect(page.getByRole('dialog', { name: 'Confirm private Quote inputs', exact: true })).toBeVisible();
  expect((await control(page).snapshot()).pending).toBeNull();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['approve']);
});

for (const fault of ['wallet', 'funds'] as const) test(`guided approval rejects ${fault} drift before signing`, async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  await control(page).set({ balances: ['100', '100'], waitReceipt: true });
  const swap = await quoteInputs(page);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const approval = page.getByRole('dialog', { name: 'Approve exact current input', exact: true });
  await expect(approval).toBeVisible();
  await control(page).set(fault === 'wallet' ? { wallet: `0x${'33'.repeat(20)}` } : { balances: ['99', '99'] });
  await approval.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText(fault === 'wallet' ? 'Wallet or network changed' : 'funding state changed');
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  expect((await control(page).snapshot()).signingAttempts).toBe(0);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  expect((await control(page).snapshot()).pending).toBeNull();
});

test('guided wrong faucet credit locks Quote and remains blocked after reload', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  await control(page).set({ waitReceipt: true, badFundingCredit: true });
  const swap = await quoteInputs(page);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const faucet = page.getByRole('dialog', { name: 'Claim current test-token faucet', exact: true });
  await expect(faucet).toBeVisible();
  await faucet.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('private credit or allowance differs');
  expect(JSON.parse((await control(page).snapshot()).pending!)).toMatchObject({ phase: 'token-faucet', verificationBlocked: true });
  await expect(page.getByRole('dialog', { name: 'Approve exact current input', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Confirm private Quote inputs', exact: true })).toHaveCount(0);
  const ledger = await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.exportChain());
  await page.reload();
  await page.evaluate(raw => (window as unknown as { __currentJourney: Control }).__currentJourney.restoreChain(raw), ledger);
  const current = await quoteInputs(page);
  await current.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await expect(current.locator('.dex-v2-current-status')).toContainText('Known current-token verification failure');
  const retry = current.getByRole('button', { name: 'Check funding and continue', exact: true });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(current.locator('.dex-v2-current-status')).toContainText('Known current-token verification failure');
  await expect(current.getByLabel('Maximum input', { exact: true })).toBeDisabled();
  const funding = current.getByLabel('Current trial-token funding', { exact: true });
  await expect(funding).toHaveJSProperty('open', false);
  await funding.locator(':scope > summary').click();
  await checkFundingStatus(funding);
  await expect(funding.locator(':scope > p[role=status]')).toContainText('Known current-token verification failure');
  await expect(funding.getByLabel('Private current-token readiness')).toHaveCount(0);
  expect((await control(page).snapshot()).pending).not.toBeNull();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['claimFaucet']);
});

test('manual funding fallback waits and verifies each private result automatically', async ({ page }) => {
  await control(page).set({ waitReceipt: true });
  const form = await fundingView(page);
  await expect(form.getByLabel('Existing funding transaction hash', { exact: true })).toHaveCount(0);
  for (const action of ['faucet', 'approve'] as const) {
    await form.getByRole('button', { name: action === 'faucet' ? 'Claim current test-token faucet' : 'Approve exact input allowance', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: action === 'faucet' ? 'Claim current test-token faucet' : 'Approve exact current input', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(form.locator(':scope > p[role=status]')).toContainText('Exact private funding result verified');
    if (await form.getAttribute('open') === null) await form.locator(':scope > summary').click();
    expect((await control(page).snapshot()).pending).toBeNull();
  }
  await expect(form.getByLabel('Private current-token readiness')).toContainText('Core allowance 0.00000000000000002 tokens. Ready for this input.');
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['claimFaucet', 'approve']);
});

test('guided Quote rejects a changed graph before any funding or private signatures', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.seedFunding());
  await control(page).set({ graphDrift: true });
  const swap = await quoteInputs(page);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('runtime hash differs');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  expect((await control(page).snapshot()).signingAttempts).toBe(0);
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(0);
  expect((await control(page).snapshot()).pending).toBeNull();
});

test('automatic async Accept receipt remains pending until terminal private delivery', async ({ page }) => {
  const { swap, dialog } = await review(page, true);
  await control(page).set({ waitReceipt: true });
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toHaveText('Accept is mined; settlement remains pending.');
  await expect(swap.getByText(/^Paid /)).toHaveCount(0);
  expect((await control(page).snapshot()).stage).toBe(5);
  expect((await control(page).snapshot()).pending).toBeNull();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteCheapAsyncV1', 'acceptPrivateSwapV1']);
  await control(page).set({ settled: true });
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toHaveText('Settlement confirmed by the private receipt.');
  await expect(swap.getByText(privatePaidResult, { exact: true })).toBeVisible();
});

for (const missingWalletChainId of [false, true]) for (const width of [1440, 390]) test(`confirmed Fast Quote opens trade review automatically at ${width}px${missingWalletChainId ? ' with omitted wallet chain ID' : ''}`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await control(page).set({ waitReceipt: true, missingWalletChainId, delayedTransactionVisibility: missingWalletChainId });
  const swap = await quote(page);
  const dialog = page.getByRole('dialog', { name: 'Review private quote', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('You pay');
  await expect(dialog).toContainText('You receive');
  await expect(dialog).toContainText('Test token 0');
  await expect(dialog).toContainText('Average price');
  await expect(dialog).not.toContainText('Expected unused-input refund');
  await expect(dialog).not.toContainText('Quote gas cost');
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteFastPoolV1']);
  expect((await control(page).snapshot()).pending).toBeNull();
  await page.screenshot({ path: `C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/compact-quote-review-${width}.png`, fullPage: true, animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  await swap.getByRole('button', { name: 'Review and Accept', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Settlement confirmed by the private receipt');
  await expect(swap.getByText(privatePaidResult, { exact: true })).toBeVisible();
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteFastPoolV1', 'acceptFastPoolV1']);
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
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Accept submitted. Settlement is not complete.');
  let observed = await control(page).snapshot();
  expect(observed.sends.map(({ name, operationId, gasLimit }) => ({ name, operationId, gasLimit }))).toEqual([
    { name: 'quoteFastPoolV1', operationId, gasLimit: '60000000' },
    { name: 'acceptFastPoolV1', operationId, gasLimit: '50000000' }
  ]);
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toHaveText('Settlement confirmed by the private receipt.');
  await expect(swap.getByText(privatePaidResult, { exact: true })).toBeVisible();
  const diagnostics = swap.locator('details.dex-v2-setup');
  if (await diagnostics.getAttribute('open') === null) await diagnostics.locator(':scope > summary').click();
  const timing = swap.getByLabel('Local trial timing', { exact: true });
  await timing.locator('summary').click();
  await expect(timing.locator('pre').nth(1)).toContainText('fast-private-delivery');
  await expect(timing).toContainText('not mining times');
  await expect(timing).toContainText('Complete journey: Get Quote click to verified delivery/refund displayed');
  await expect(timing).toContainText('Browser paint is not measured');
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
  await timingScreenshot(swap, `cw00503-fast-timing-${width}-20261009`);
  await info.attach('local-journey', { body: JSON.stringify(observed, null, 2), contentType: 'application/json' });
});

test('CW00503 timing async mined Accept stays pending; owner recovery verifies the exact refund', async ({ page }) => {
  const { swap, dialog } = await review(page, true);
  await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Accept submitted');
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toHaveText('Accept is mined; settlement remains pending.');
  const diagnostics = swap.locator('details.dex-v2-setup');
  if (await diagnostics.getAttribute('open') === null) await diagnostics.locator(':scope > summary').click();
  const timing = swap.getByLabel('Local trial timing', { exact: true });
  await timing.locator('summary').click();
  await expect(timing.locator('pre').nth(1)).toContainText('async-funded-accept');
  await expect(timing).toContainText('later delivery is separate');
  expect((await journeyTiming(swap)).quoteClickToVerifiedResultDisplayedMs).toBeNull();
  expect((await journeyTiming(swap)).acceptConfirmationToVerifiedResultDisplayedMs).toBeNull();
  await expect(swap.getByText(/^Paid /)).toHaveCount(0);
  expect((await control(page).snapshot()).stage).toBe(5);
  await swap.getByRole('button', { name: 'Recover swap', exact: true }).click();
  const release = page.getByRole('dialog', { name: 'Recover private swap', exact: true });
  await expect(release).toBeVisible();
  expect((await control(page).snapshot()).sends).toHaveLength(2);
  await release.getByRole('button', { name: 'Recover swap', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Release submitted');
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toHaveText('Released with a private refund receipt.');
  await expect(swap.getByText(privateRefundResult, { exact: true })).toBeVisible();
  const observed = await control(page).snapshot();
  expect(observed.sends.map(row => row.name)).toEqual(['quoteCheapAsyncV1', 'acceptPrivateSwapV1', 'recoverSwap']);
  expect(observed.pending).toBeNull();
  expect((await journeyTiming(swap)).quoteClickToVerifiedResultDisplayedMs).toBeGreaterThanOrEqual(0);
  await timingScreenshot(swap, 'cw00503-async-refund-timing-20261009');
});

test('CW00503 timing starts at the click and records only the first authenticated private preview', async ({ page }) => {
  const swap = await quoteInputs(page, true);
  await swap.getByRole('button', { name: 'Get Quote', exact: true }).click();
  const inputs = page.getByRole('dialog', { name: 'Confirm private Quote inputs', exact: true });
  await expect(inputs).toBeVisible();
  expect((await journeyTiming(swap)).quoteClickToPrivatePreviewDisplayedMs).toBeNull();
  await inputs.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Open submitted');
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await control(page).set({ ready: true });
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.getByRole('button', { name: 'Review and Accept', exact: true })).toBeEnabled();
  // Public READY does not expose the authenticated private terms.
  expect((await journeyTiming(swap)).quoteClickToPrivatePreviewDisplayedMs).toBeNull();
  await swap.getByRole('button', { name: 'Review and Accept', exact: true }).click();
  const reviewDialog = page.getByRole('dialog', { name: 'Review private quote', exact: true });
  await expect(reviewDialog.getByText('You receive', { exact: true })).toBeVisible();
  await expect.poll(async () => (await journeyTiming(swap)).quoteClickToPrivatePreviewDisplayedMs).not.toBeNull();
  const firstPreview = (await journeyTiming(swap)).quoteClickToPrivatePreviewDisplayedMs;
  await reviewDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(swap.getByRole('button', { name: 'Review and Accept', exact: true })).toBeEnabled();
  expect((await journeyTiming(swap)).acceptTransactionHash).toBeNull();
  expect((await journeyTiming(swap)).quoteClickToVerifiedResultDisplayedMs).toBeNull();
  await swap.getByRole('button', { name: 'Review and Accept', exact: true }).click();
  await expect(reviewDialog).toBeVisible();
  expect((await journeyTiming(swap)).quoteClickToPrivatePreviewDisplayedMs).toBe(firstPreview);
  await reviewDialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Accept submitted');
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('settlement remains pending');
  const funded = await journeyTiming(swap);
  expect(funded.acceptAttempts.map(attempt => ({ cancelled: attempt.cancelled, submitted: attempt.submitted })))
    .toEqual([{ cancelled: true, submitted: false }, { cancelled: false, submitted: true }]);
  expect(funded.quoteClickToVerifiedResultDisplayedMs).toBeNull();
  await control(page).set({ settled: true });
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.getByText(privatePaidResult, { exact: true })).toBeVisible();
  await expect.poll(async () => (await journeyTiming(swap)).quoteClickToVerifiedResultDisplayedMs).not.toBeNull();
  const delivered = await journeyTiming(swap);
  expect(delivered.quoteClickToPrivatePreviewDisplayedMs).toBe(firstPreview);
  expect(delivered.acceptConfirmationToVerifiedResultDisplayedMs).toBeGreaterThanOrEqual(0);
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  expect((await journeyTiming(swap)).quoteClickToVerifiedResultDisplayedMs).toBe(delivered.quoteClickToVerifiedResultDisplayedMs);
  await timingScreenshot(swap, 'cw00503-preview-cancel-retry-terminal-20261009');
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
  else if (reset === 'remount') await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.remount());
  else await page.reload();
  await expect(swap.getByLabel('Local trial timing', { exact: true })).toHaveCount(0);
  await expect(swap.getByText(/^Paid /)).toHaveCount(0);
  if (reset !== 'reload') expect((await control(page).snapshot()).sends).toHaveLength(sends);
});

test('async preparing Quote can be cancelled with a separately confirmed full refund', async ({ page }) => {
  const swap = await quote(page, true);
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Open submitted');
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.getByRole('button', { name: 'Review and Accept', exact: true })).toBeDisabled();
  await swap.getByRole('button', { name: 'Cancel swap', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel private swap', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel swap', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Release submitted');
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toHaveText('Released with a private refund receipt.');
  expect((await control(page).snapshot()).sends.map(row => row.name)).toEqual(['quoteCheapAsyncV1', 'cancelSwap']);
});

test('new wallet session after component remount observes mined metadata and does not restore private Accept authority', async ({ page }) => {
  await control(page).set({ receiptAvailable: false });
  const swap = await quote(page);
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Open submitted');
  expect((await control(page).snapshot()).pending).not.toBeNull();
  await control(page).set({ receiptAvailable: true });
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.remount());
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toHaveText('Open mined, but this session has no authenticated Quote origin. Accept is unavailable.');
  await expect(swap.getByRole('button', { name: 'Review and Accept', exact: true })).toHaveCount(0);
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeDisabled();
  expect((await control(page).snapshot()).sends).toHaveLength(1);
});

for (const issueLogs of ['missing', 'duplicate', 'forged'] as const) {
  test(`rejects ${issueLogs} mined issue event without inventing an operation ID`, async ({ page }) => {
    const swap = await quote(page);
    await expect(swap.locator('.dex-v2-current-status')).toContainText('Open submitted');
    await control(page).set({ issueLogs });
    await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
    await expect(swap.locator('.dex-v2-current-status')).toContainText('unique Core event');
    await expect(swap.getByText(/^Operation /)).toHaveCount(0);
    await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeDisabled();
    expect((await control(page).snapshot()).pending).not.toBeNull();
    expect((await control(page).snapshot()).signingAttempts).toBe(1);
  });
}

test('unknown transport outcome retains nonce reservation and prevents a duplicate send', async ({ page }) => {
  await control(page).set({ interrupted: true });
  const swap = await quote(page);
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Test transport interrupted');
  expect(JSON.parse((await control(page).snapshot()).pending!)).toMatchObject({ phase: 'quote', nonce: 4, txHash: null });
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('saved action has no transaction hash');
  const signatures = (await control(page).snapshot()).inputSignatureRequests;
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog', { name: 'Confirm private Quote inputs', exact: true })).toHaveCount(0);
  await expect(swap.locator('.dex-v2-current-status')).toContainText('saved action has no transaction hash');
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(signatures);
  expect((await control(page).snapshot()).sends).toHaveLength(0);
  expect((await control(page).snapshot()).signingAttempts).toBe(1);
});

for (const width of [1440, 390]) test(`expired Fast lost hash reconciles without new signatures at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const swap = await quote(page);
  const saved = await page.evaluate(() => {
    const key = 'chainwhisper:dex:current-pending-attempt:v1';
    const pending = JSON.parse(sessionStorage.getItem(key)!);
    sessionStorage.setItem(key, JSON.stringify({ ...pending, txHash: null }));
    const ledger = JSON.parse((window as unknown as { __currentJourney: Control }).__currentJourney.exportChain());
    return { hash: pending.txHash as string, expires: Number(ledger.deadline.__testBigInt) };
  });
  await page.clock.setSystemTime((saved.expires + 1) * 1000);
  await page.evaluate(() => (window as unknown as { __currentJourney: Control }).__currentJourney.remount());
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('saved action has no transaction hash');
  const before = await control(page).snapshot();
  await swap.getByText('DEX recovery details', { exact: true }).click();
  await swap.getByLabel('Existing DEX transaction hash', { exact: true }).fill(saved.hash);
  await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
  await expect(swap.locator('.dex-v2-current-status')).toContainText('Expired Fast Quote reconciled');
  expect((await control(page).snapshot()).pending).toBeNull();
  expect((await control(page).snapshot()).inputSignatureRequests).toBe(before.inputSignatureRequests);
  expect((await control(page).snapshot()).sends).toHaveLength(1);
  await expect(swap.getByRole('button', { name: 'Review and Accept', exact: true })).toHaveCount(0);
  await swap.getByRole('button', { name: 'New Quote', exact: true }).click();
  await expect(swap.getByRole('button', { name: 'Get Quote', exact: true })).toBeEnabled();
  await expect(swap.getByLabel('Existing DEX transaction hash', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `C:/Users/rosu_/.codex/visualizations/2026/09/27/01a0e512-ae27-7cb0-bce0-b46e778d5497/expired-quote-reconciled-${width}.png`, fullPage: true });
});

for (const fault of ['wallet', 'context', 'headroom', 'graph', 'payout'] as const) {
  test(`rejects ${fault} drift without a false payout claim`, async ({ page }) => {
    const { swap, dialog } = await review(page);
    if (fault === 'wallet') await control(page).set({ revoked: true, wallet: `0x${'33'.repeat(20)}` });
    if (fault === 'context') await control(page).set({ contextDrift: true });
    if (fault === 'headroom') await control(page).set({ gasLimit: '50000000' });
    if (fault === 'graph') await control(page).set({ graphDrift: true });
    await dialog.getByRole('button', { name: 'Accept quote', exact: true }).click();
    if (fault === 'payout') {
      await expect(swap.locator('.dex-v2-current-status')).toContainText('Accept submitted');
      await control(page).set({ corruptPayout: true });
      await swap.getByRole('button', { name: 'Check current state', exact: true }).click();
      await expect(swap.locator('.dex-v2-current-status')).not.toContainText('Settlement confirmed');
    } else {
      await expect(swap.locator('.dex-v2-current-status')).toContainText(fault === 'wallet' ? 'Wallet or network changed' : fault === 'graph' ? 'runtime hash differs' : fault === 'context' ? 'does not match' : 'headroom');
      expect((await control(page).snapshot()).sends).toHaveLength(1);
    }
    await expect(swap.getByText(/^Paid /)).toHaveCount(0);
  });
}
