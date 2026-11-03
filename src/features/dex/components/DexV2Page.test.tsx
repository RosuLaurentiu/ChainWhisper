import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CurrentDexPrivateReceiptError } from '../../../lib/currentDexSubmission';
import { checkCurrentFunding } from './CurrentTokenFundingControls';
import { readCurrentDexDisplay } from '../../../lib/currentDexDisplay';
import { resolveCurrentCheapDexCandidate } from '../../../lib/dexV2Deployment';
import { CURRENT_SHARED_DEX_TOKENS } from '../../../lib/currentSharedDexTokenDistribution';
import DexV2Page, {
  ModeNavigation,
  resolveDexModeFromPath,
  parseCurrentTrialAtoms,
  parseCurrentSwapAmount,
  parseCurrentSwapFillPercent,
  parseCurrentSwapPriceLimit,
  parseCurrentTrialPriceLimit,
  reconcileCurrentTrialPending,
  verifyCurrentTrialCandidate,
  recoverOrReconcileCurrentTrial,
  hasCurrentTrialSavedAction,
  currentTrialAttemptPresentation,
  readCurrentSwapInputFunding,
} from './DexV2Page';

// These server-rendered views read the same pending-attempt store as the browser.
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('window', { location: { pathname: '/dex' }, sessionStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key), clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; }
  } });
});
afterEach(() => vi.unstubAllGlobals());

describe('selected swap funding adapter', () => {
  const owner = `0x${'11'.repeat(20)}`;
  const make = (candidateKey: 'cheap-prepared' | 'cheap-exit') => {
    const candidate = resolveCurrentCheapDexCandidate(candidateKey);
    const funds = { owner, core: candidate.core, graph: candidate.graph, packageSha256: candidate.packageSha256,
      privateFundsVerified: true, readyToSign: false, head: { number: 99n, hash: `0x${'22'.repeat(32)}` },
      tokens: CURRENT_SHARED_DEX_TOKENS.map((token, i) => ({ ...token, balance: BigInt(100 + i), allowance: BigInt(17 + i), claimed: true })) };
    const readSharedTokenFunding = vi.fn(async () => funds), readCurrentTokenFunding = vi.fn(async () => { throw new Error('Historical adapter must not run'); });
    const sender = { readSharedTokenFunding, readCurrentTokenFunding } as unknown as Parameters<typeof readCurrentSwapInputFunding>[0];
    return { funds, sender, readSharedTokenFunding, readCurrentTokenFunding };
  };
  it.each(['cheap-prepared', 'cheap-exit'] as const)('reads all four selected tokens through shared funding for %s', async candidateKey => {
    const f = make(candidateKey);
    for (const [i, token] of CURRENT_SHARED_DEX_TOKENS.entries()) {
      expect(await readCurrentSwapInputFunding(f.sender, candidateKey, owner, token.address, 0)).toEqual({ balance: BigInt(100 + i), allowance: BigInt(17 + i), claimed: true, block: f.funds.head });
    }
    expect(f.readCurrentTokenFunding).not.toHaveBeenCalled(); expect(f.readSharedTokenFunding).toHaveBeenCalledTimes(4);
  });
  it('keeps the historical adapter on the historical candidate', async () => {
    const f = make('cheap-exit'), historical = { balance: 7n, allowance: 5n, claimed: true,
      block: { ...f.funds.head, timestamp: 1n, gasLimit: 200_000_000n }, tokenIndex: 1 as const,
      token: resolveCurrentCheapDexCandidate('cheap-current').tokens[1][0], owner,
      faucetAmount: 10_000n * 10n ** 18n, decimals: 18n, publicAmounts: false, encryptionAddress: owner };
    const readCurrentTokenFunding = vi.fn(async () => historical);
    expect(await readCurrentSwapInputFunding({ ...f.sender, readCurrentTokenFunding } as Parameters<typeof readCurrentSwapInputFunding>[0], 'cheap-current', owner, CURRENT_SHARED_DEX_TOKENS[0].address, 1)).toBe(historical);
    expect(readCurrentTokenFunding).toHaveBeenCalledWith(1); expect(f.readSharedTokenFunding).not.toHaveBeenCalled();
  });
  it.each(['owner', 'core', 'graph', 'packageSha256', 'privateFundsVerified', 'readyToSign', 'decimals', 'balance', 'allowance'] as const)('rejects changed %s before Quote consumes shared funds', async field => {
    const f = make('cheap-exit');
    if (field === 'decimals') f.funds.tokens[0].decimals = 18 as 6;
    else if (field === 'balance' || field === 'allowance') f.funds.tokens[0][field] = -1n;
    else Object.assign(f.funds, { [field]: field === 'privateFundsVerified' ? false : field === 'readyToSign' ? true : 'changed' });
    await expect(readCurrentSwapInputFunding(f.sender, 'cheap-exit', owner, CURRENT_SHARED_DEX_TOKENS[0].address, 0)).rejects.toThrow('identity or private state');
    expect(f.readCurrentTokenFunding).not.toHaveBeenCalled();
  });
});

describe('DexV2Page', () => {
  it.each(['/dex/positions', '/dex/activity'])('keeps the existing %s link in Manage', pathname => {
    vi.stubGlobal('window', { location: { pathname }, sessionStorage: { getItem: () => null } });
    const html = renderToStaticMarkup(<DexV2Page />);
    const navigation = html.match(/<nav[^>]*aria-label="Manage views"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    expect(navigation).toBeDefined();
    for (const label of ['Orders', 'Positions', 'History']) expect(navigation).toContain(`>${label}</button>`);
    expect(navigation).toMatch(pathname.endsWith('positions') ? /aria-current="page"[^>]*>Positions/ : /aria-current="page"[^>]*>Orders/);
    expect(html).not.toContain('aria-label="Liquidity views"');
  });

  it.each(['/dex/liquidity','/dex/positions','/dex/activity'])('keeps the chart visible on %s', pathname => {
    vi.stubGlobal('window',{location:{pathname},sessionStorage:{getItem:()=>null}});
    try {
      const html=renderToStaticMarkup(<DexV2Page/>);
      const chart=html.match(/class="dex-market-chart-host"([^>]*)>/)?.[1];
      expect(chart).toBeDefined(); expect(chart).not.toContain('hidden');
      expect(html).not.toContain('dex-v2-content-grid dex-v2-management-grid');
    } finally { vi.unstubAllGlobals(); }
  });
  it.each(['cheap-prepared', 'cheap-exit'] as const)('passes each selected market to the Limit view for %s', candidateKey => {
    for (const pair of readCurrentDexDisplay(resolveCurrentCheapDexCandidate(candidateKey)).pairs) {
      const selectedPair = pair.tokens.map(token => token.label) as [string, string];
      const markup = renderToStaticMarkup(<DexV2Page swapCandidate={candidateKey} selectedPair={selectedPair} />);
      const limit = markup.match(/<section class="[^"]*dex-v2-current-limit[^"]*"[\s\S]*?<\/section>/)?.[0];
      expect(limit).toBeDefined();
      expect(limit).toContain(`Amount (${selectedPair[0]})`);
      expect(limit).toContain(`${selectedPair[1]} per ${selectedPair[0]}`);
      expect(limit).not.toContain('Test token');
    }
  });
  it.each(['cheap-prepared', 'cheap-exit'] as const)('keeps selected chart and swap tokens for %s without price history', candidateKey => {
    const markup = renderToStaticMarkup(<DexV2Page swapCandidate={candidateKey} selectedPair={['EMBR', 'ORBT']} />);
    expect(markup).toContain('Buy EMBR');
    expect(markup).toContain('<strong>You send</strong><small>ORBT</small>');
    expect(markup).toContain('<strong>Estimated receive</strong><small>EMBR</small>');
    expect(markup).toContain('ORBT per EMBR');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*><span>Get Quote<\/span>/);
  });
  it.each(['quote', 'accept', 'cancel', 'recover', 'pool-fund', 'limit-create', 'token-faucet', 'token-approve'] as const)(
    'reads the existing %s journal before enabling a fresh swap', phase => {
      const saved = { version: 1, chainId: '7082400', owner: `0x${'11'.repeat(20)}`, core: `0x${'22'.repeat(20)}`,
        graph: `0x${'33'.repeat(32)}`, phase, callHash: `0x${'44'.repeat(32)}`, nonce: 2, txHash: `0x${'55'.repeat(32)}`,
        ...(['cancel', 'recover'].includes(phase) ? { operationId: '1' } : {}) };
      const storage = { getItem: () => JSON.stringify(saved), setItem: vi.fn(), removeItem: vi.fn() };
      expect(hasCurrentTrialSavedAction(storage)).toBe(!['token-faucet', 'token-approve'].includes(phase));
      expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled();
    });
  it('keeps malformed or unavailable saved metadata blocked and permits an empty journal', () => {
    expect(hasCurrentTrialSavedAction(null)).toBe(true);
    expect(hasCurrentTrialSavedAction({ getItem: () => '{bad', setItem: vi.fn(), removeItem: vi.fn() })).toBe(true);
    expect(hasCurrentTrialSavedAction({ getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })).toBe(false);
  });
  it.each(['outside tolerance', 'malformed receipt', 'exact accounting failure', 'private read unavailable'])(
    'retains pending identity when private verification reports %s', async message => {
      const error = new CurrentDexPrivateReceiptError(message);
      const pending = { recover: vi.fn().mockRejectedValue(error) };
      const sender = { recoverPendingCurrentCheapAttempt: vi.fn() };
      const capability = vi.fn();
      await expect(recoverOrReconcileCurrentTrial(pending, capability as never, sender as never)).rejects.toBe(error);
      expect(sender.recoverPendingCurrentCheapAttempt).not.toHaveBeenCalled();
      expect(capability).not.toHaveBeenCalled();
    });
  it('reconciles canonical funding before reading private readiness', async () => {
    const order: string[] = [];
    const sender = { recoverPendingCurrentTokenFunding: vi.fn(async () => { order.push('canonical'); return { status: 'observed-mined' }; }),
      readCurrentTokenFunding: vi.fn(async () => { order.push('private'); return { balance: 10n, allowance: 10n }; }) };
    await expect(checkCurrentFunding(sender as never, 1, undefined, 'saved-hash')).resolves.toEqual({ balance: 10n, allowance: 10n });
    expect(order).toEqual(['canonical', 'private']);
    expect(sender.recoverPendingCurrentTokenFunding).toHaveBeenCalledWith('saved-hash');
    expect(sender.readCurrentTokenFunding).toHaveBeenCalledWith(1);
  });
  it('does not replace a prepared private failure with public recovery', async () => {
    const sender = { recoverPendingCurrentTokenFunding: vi.fn(), readCurrentTokenFunding: vi.fn() };
    const recover = vi.fn().mockRejectedValue(new Error('Known private verification failure'));
    await expect(checkCurrentFunding(sender as never, 1, recover)).rejects.toThrow('Known private verification failure');
    expect(sender.recoverPendingCurrentTokenFunding).not.toHaveBeenCalled();
    expect(sender.readCurrentTokenFunding).not.toHaveBeenCalled();
  });
  it('reads fresh funds after exact prepared recovery, without a metadata fallback', async () => {
    const sender = { recoverPendingCurrentTokenFunding: vi.fn(), readCurrentTokenFunding: vi.fn().mockResolvedValue({ balance: 9n, allowance: 9n }) };
    const recover = vi.fn().mockResolvedValue({ balance: 10n, allowance: 10n, fundingOutcome: 'verified' });
    await expect(checkCurrentFunding(sender as never, 1, recover)).resolves.toEqual({ balance: 9n, allowance: 9n, fundingOutcome: 'verified' });
    expect(sender.recoverPendingCurrentTokenFunding).not.toHaveBeenCalled();
    expect(sender.readCurrentTokenFunding).toHaveBeenCalledOnce();
  });
  it.each(['awaiting-chain-confirmation', 'manual-reconciliation-required'])('does not unlock private readiness for %s', async status => {
    const sender = { recoverPendingCurrentTokenFunding: vi.fn().mockResolvedValue({ status }), readCurrentTokenFunding: vi.fn() };
    await expect(checkCurrentFunding(sender as never, 1)).rejects.toThrow('Do not resend');
    expect(sender.readCurrentTokenFunding).not.toHaveBeenCalled();
  });
  it('converts minimum fill percentages to exact atoms, rounding up for protection', () => {
    expect(parseCurrentSwapFillPercent('0', 20n)).toBe(0n);
    expect(parseCurrentSwapFillPercent('25', 20n)).toBe(5n);
    expect(parseCurrentSwapFillPercent('50', 3n)).toBe(2n);
    expect(parseCurrentSwapFillPercent('0.01', 1n)).toBe(1n);
    const max = (1n << 256n) - 1n;
    expect(parseCurrentSwapFillPercent('100', max)).toBe(max);
    expect(parseCurrentSwapFillPercent('99.99', max)).toBe((max * 9999n + 9999n) / 10000n);
    for (const value of ['', '-1', '100.01', '0.001', '01', '1e2']) {
      expect(() => parseCurrentSwapFillPercent(value, 20n)).toThrow('Minimum fill:');
    }
  });
  it('maps Buy maximum and Sell minimum prices to the exact net-output rate', () => {
    expect(parseCurrentSwapPriceLimit('1.25', 'buy')).toEqual({ numerator: 4n, denominator: 5n });
    expect(parseCurrentSwapPriceLimit('1.25', 'sell')).toEqual({ numerator: 5n, denominator: 4n });
    expect(parseCurrentSwapPriceLimit('0.000000000000000001', 'buy')).toEqual({ numerator: 1000000000000000000n, denominator: 1n });
    for (const side of ['buy', 'sell'] as const) {
      for (const value of ['', '0', '-1', '1e2']) expect(() => parseCurrentSwapPriceLimit(value, side)).toThrow();
    }
  });
  it('converts normal swap tokens exactly and identifies invalid fields', () => {
    expect(parseCurrentSwapAmount('1', 'You send', true)).toBe(10n ** 18n);
    expect(parseCurrentSwapAmount(' 1.25 ', 'You send')).toBe(125n * 10n ** 16n);
    expect(parseCurrentSwapAmount('0.000000000000000001', 'You send')).toBe(1n);
    expect(parseCurrentSwapAmount('9007199254740993', 'You send')).toBe(9007199254740993n * 10n ** 18n);
    expect(parseCurrentSwapAmount('0', 'Minimum fill')).toBe(0n);
    const max = (1n << 256n) - 1n, scale = 10n ** 18n;
    expect(parseCurrentSwapAmount(`${max / scale}.${(max % scale).toString().padStart(18, '0')}`, 'You send')).toBe(max);
    for (const value of ['', '-1', '1e3', '1.0000000000000000001', '01', '1.']) {
      expect(() => parseCurrentSwapAmount(value, 'You receive at least')).toThrow('You receive at least:');
    }
    expect(() => parseCurrentSwapAmount('0', 'You send', true)).toThrow('You send:');
    expect(() => parseCurrentSwapAmount((1n << 256n).toString(), 'You send')).toThrow('You send:');
  });
  it('parses exact token atoms without rounding a large private amount', () => {
    expect(parseCurrentTrialAtoms('9007199254740993')).toBe(9007199254740993n);
    expect(parseCurrentTrialAtoms('0')).toBe(0n);
    for (const value of ['1.5', '01', '-1', '1e6', '']) expect(() => parseCurrentTrialAtoms(value)).toThrow();
    expect(() => parseCurrentTrialAtoms('0', true)).toThrow();
  });
  it('maps one decimal price limit to exact contract terms', () => {
    expect(parseCurrentTrialPriceLimit('1.25')).toEqual({ numerator: 5n, denominator: 4n });
    expect(parseCurrentTrialPriceLimit('0.000000000000000001')).toEqual({ numerator: 1n, denominator: 1000000000000000000n });
    for (const value of ['', '0', '-1', '01', '1e3', '1.']) expect(() => parseCurrentTrialPriceLimit(value)).toThrow();
  });
  it('offers automatic contract verification without starting a wallet call during render', () => {
    const getCurrentDexQuoteCapability = vi.fn();
    const getCurrentDexSubmissionCapability = vi.fn();
    const getCurrentDexReceiptCapability = vi.fn();
    const markup = renderToStaticMarkup(<DexV2Page sharedWalletSession={{
      walletAddress: '0x1111111111111111111111111111111111111111', chainId: 7082400,
      browserProvider: { request: vi.fn() },
      actions: { getCurrentDexQuoteCapability, getCurrentDexSubmissionCapability,
        getCurrentDexReceiptCapability }
    } as never} />);
    expect(markup).toMatch(/<button[^>]*><span>Get Quote<\/span>/);
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*><span>Get Quote<\/span>/);
    expect(markup).toContain('Check current state</button>');
    expect(markup).toContain('Check current contracts');
    expect(markup).not.toContain('Existing funding transaction hash');
    expect(getCurrentDexQuoteCapability).not.toHaveBeenCalled();
    expect(getCurrentDexSubmissionCapability).not.toHaveBeenCalled();
  });
  it('requires current owner and candidate identity from the read-only sender check', async () => {
    const owner = `0x${'22'.repeat(20)}`;
    const candidate = (await import('../../../lib/dexV2Deployment')).CURRENT_CHEAP_DEX_CANDIDATE;
    const observed = { chainId: 7082400n, owner, graph: candidate.graph, core: candidate.core, readyToSign: false };
    const checkCurrentCheapCandidate = vi.fn().mockResolvedValue(observed);
    const getCapability = vi.fn().mockResolvedValue({ checkCurrentCheapCandidate });
    await expect(verifyCurrentTrialCandidate(getCapability as never, owner)).resolves.toMatchObject({ observed });
    expect(getCapability).toHaveBeenCalledWith(7082400n);
    for (const changed of [{ owner: candidate.core }, { core: owner }, { graph: 'old' }, { chainId: 1n }, { readyToSign: true }]) {
      checkCurrentCheapCandidate.mockResolvedValueOnce({ ...observed, ...changed });
      await expect(verifyCurrentTrialCandidate(getCapability as never, owner)).rejects.toThrow('identity changed');
    }
  });
  it('reacquires the owner capability after reload and reconciles only the canonical pending journal', async () => {
    const attempt = { status: 'observed-mined', phase: 'quote', operationId: 7n };
    const recoverPendingCurrentCheapAttempt = vi.fn().mockResolvedValue(attempt);
    const getCapability = vi.fn().mockResolvedValue({ recoverPendingCurrentCheapAttempt });

    const observed = await reconcileCurrentTrialPending(getCapability as never);
    expect(getCapability).toHaveBeenCalledExactlyOnceWith(7082400n);
    expect(recoverPendingCurrentCheapAttempt).toHaveBeenCalledOnce();
    expect(observed.attempt).toBe(attempt);
    expect(observed.sender).toEqual({ recoverPendingCurrentCheapAttempt });

    const source = readFileSync(fileURLToPath(new URL('./DexV2Page.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('Open mined, but this session has no authenticated Quote origin. Accept is unavailable.');
    expect(source).toContain('currentTrialAttemptPresentation(attempt)');
  });
  it.each([
    [{ status: 'manual-reconciliation-required', transactionHash: 'known-hash', reason: 'Native App phase admission is absent.' }, 'Native App phase admission is absent.', false],
    [{ status: 'manual-reconciliation-required' }, 'has no transaction hash', false],
    [{ status: 'manual-reconciliation-required', transactionHash: 'known-hash', verificationBlocked: true }, 'Private verification failed', false],
    [{ status: 'awaiting-chain-confirmation', transactionHash: 'known-hash' }, 'pending or is not available', false],
    [{ status: 'observed-reverted' }, 'Transaction reverted', false],
    [{ status: 'observed-mined', phase: 'accept', profile: 'cheap-async', operation: { phase: 'settling' } }, 'settlement remains pending', true],
    [{ status: 'observed-mined', phase: 'accept', profile: 'cheap-async', operation: { phase: 'settled' } }, 'Public settlement is complete', true],
    [{ status: 'observed-mined', phase: 'accept', profile: 'cheap-async', operation: { phase: 'released' } }, 'private refund is not verified', true]
  ])('shows the exact public recovery status for %j', (attempt, message, publicOperation) => {
    const presentation = currentTrialAttemptPresentation(attempt as never);
    expect(presentation.message).toContain(message);
    expect(presentation.stage).toBe(publicOperation ? 'observed-accept' : attempt.status === 'observed-reverted' ? 'reverted' : 'reconciling');
    if ('transactionHash' in attempt) expect(presentation.message).not.toContain('has no transaction hash');
  });
  it('reconciles a rejected in-memory recovery before treating a reverted receipt as terminal', async () => {
    const pending = { recover: vi.fn().mockRejectedValue(new Error('Open did not confirm successfully.')) };
    const recoverPendingCurrentCheapAttempt = vi.fn()
      .mockResolvedValueOnce({ status: 'awaiting-chain-confirmation', phase: 'quote' })
      .mockResolvedValueOnce({ status: 'observed-reverted', phase: 'quote' });
    const sender = { recoverPendingCurrentCheapAttempt };
    const getCapability = vi.fn();

    const uncertain = await recoverOrReconcileCurrentTrial(pending, getCapability as never, sender as never);
    expect(uncertain).toMatchObject({ kind: 'reconciled', attempt: { status: 'awaiting-chain-confirmation' } });
    const reverted = await recoverOrReconcileCurrentTrial(pending, getCapability as never, sender as never);
    expect(reverted).toMatchObject({ kind: 'reconciled', attempt: { status: 'observed-reverted', phase: 'quote' } });
    expect(pending.recover).toHaveBeenCalledTimes(2);
    expect(recoverPendingCurrentCheapAttempt).toHaveBeenCalledTimes(2);
    expect(getCapability).not.toHaveBeenCalled();
    const source = readFileSync(fileURLToPath(new URL('./DexV2Page.tsx', import.meta.url)), 'utf8');
    expect(source).toContain("outcome.attempt?.status === 'observed-reverted'");
    expect(source).toContain('pending || savedActionPending || issued || unknownOrigin');
    expect(source).toContain("if (pending.phase === 'quote')");
    expect(source).toContain("setPending({ recover: sent.recover, phase: 'quote' })");
    expect(source).toContain('checking || (busy && !pending)');
    expect(source).toContain("(stage === 'reverted' && !issued)");
  });
  it('renders the approved preview-first private swap surface', () => {
    const markup = renderToStaticMarkup(<DexV2Page onPriceDisplayInvertedChange={vi.fn()} />);

    expect(markup).toContain('aria-label="Private Swap"');
    expect(markup).not.toContain('Get Quote to see the amount');
    expect(markup).toContain('Pools only');
    expect(markup).not.toContain('one private transaction');
    expect(markup).not.toContain('Testnet ready');
    const source = readFileSync(fileURLToPath(new URL('./DexV2Page.tsx', import.meta.url)), 'utf8');
    expect(markup).toContain('Check current contracts');
    expect(source).not.toContain("? 'Testnet ready'");
    expect(markup).toContain('You send');
    expect(markup).toContain('Estimated receive');
    expect(markup).toContain('<output aria-label="Estimated output">—</output>');
    expect(markup).toContain('<h2>Buy Test token 0</h2>');
    expect(markup).toContain('<strong>You send</strong><small>Test token 1</small>');
    expect(markup).toContain('<strong>Estimated receive</strong><small>Test token 0</small>');
    expect(markup).toContain('aria-label="Swap side"');
    expect(markup).toContain('aria-pressed="true">Buy</button>');
    expect(markup).toContain('aria-pressed="false">Sell</button>');
    expect(markup).toContain('aria-label="Reverse price ratio"');
    expect(markup).toContain('<small>Test token 1</small>');
    expect(markup).toContain('<small>Test token 0</small>');
    expect(markup).toContain('<strong>Slippage</strong><span>0.5%</span>');
    expect(markup).toMatch(/aria-label="Price limit"[^>]*placeholder="Optional"/);
    expect(markup).toContain('Maximum buy price');
    expect(markup).toContain('aria-label="Maximum input"');
    expect(markup).toContain('aria-label="Minimum net output"');
    expect(markup).toContain('aria-label="Price limit"');
    expect(markup).toContain('dex-v2-current-advanced');
    expect(markup).toContain('dex-v2-current-actions');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*><span>Get Quote<\/span>/);
    expect(markup).not.toContain('>Review and Accept<');
    expect(markup).toContain('<summary>Transaction details</summary>');
    expect(markup).not.toContain('Reference price');
    expect(markup).not.toContain('2.0000 HBR');
    expect(markup).not.toContain('0.50%');
  });

  it('keeps one ordered top-level DEX navigation', () => {
    const markup = renderToStaticMarkup(<ModeNavigation activeMode="swap" onOpenAgent={vi.fn()} onSelect={vi.fn()} />);

    for (const mode of ['Trade', 'Liquidity', 'Manage', 'Agent']) expect(markup).toContain(`>${mode}<`);
    for (const detail of ['Pool', 'Limit', 'Recurring']) expect(markup).not.toContain(`>${detail}<`);
  });

  it('keeps both mode choices explicit without enabling wallet actions', () => {
    const markup = renderToStaticMarkup(<DexV2Page />);

    expect(markup).toContain('aria-label="Swap mode"');
    expect(markup).toContain('aria-pressed="false">Multi-source</button>');
    expect(markup).toContain('aria-pressed="true">Fast</button>');
    expect(markup).toContain('Pools only');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*><span>Get Quote<\/span>/);
    expect(markup).toContain('<summary><strong>Slippage</strong><span>0.5%</span>');
  });

  it('maps canonical and legacy DEX paths to the new workspaces', () => {
    expect(resolveDexModeFromPath('/dex')).toBe('swap');
    expect(resolveDexModeFromPath('/dex/desk')).toBe('strategies');
    expect(resolveDexModeFromPath('/dex/orders/position/7')).toBe('positions');
    expect(resolveDexModeFromPath('/otc/pools')).toBe('positions');
  });

  it('keeps Buy/Sell separate from the explicitly reversible displayed ratio', () => {
    const markup = renderToStaticMarkup(<DexV2Page priceDisplayInverted onPriceDisplayInvertedChange={vi.fn()} />);
    expect(markup).toContain('<h2>Sell Test token 1</h2>');
    expect(markup).toContain('<strong>You send</strong><small>Test token 1</small>');
    expect(markup).toContain('<strong>Estimated receive</strong><small>Test token 0</small>');
    expect(markup).toContain('aria-pressed="false">Buy</button>');
    expect(markup).toContain('aria-pressed="true">Sell</button>');
  });

  it('shows independent exact current trial protections without a synthetic price', () => {
    const markup = renderToStaticMarkup(<DexV2Page />);

    expect(markup).toContain('aria-label="Minimum net output"');
    expect(markup).toContain('aria-label="Price limit"');
    expect(markup).toContain('aria-label="Minimum input fill"');
    expect(markup).toContain('0% allows partial fills');
    expect(markup).toContain('100% requires a full fill');
    expect(markup).not.toContain('aria-label="Minimum net price numerator"');
    expect(markup).not.toContain('aria-label="Minimum net price denominator"');
    expect(markup).toContain('aria-label="DEX daily sampled price history"');
    expect(markup).toContain('No admitted daily recorder');
    expect(markup).toContain('Show illustrative preview');
    expect(markup).not.toContain('/ Preview');
    expect(markup).not.toContain('Slippage tolerance');
    expect(markup).not.toContain('Exact price override');
  });

  it('does not ship seeded private strategy terms in the Positions source', () => {
    const source = readFileSync(fileURLToPath(new URL('./SuccessorPositionsWorkspace.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('runtime.snapshot.positions.filter');
    expect(source).not.toContain('runtime.manifest.strategies.filter');
    for (const leakedTerm of [
      'Sell EMBR for BCN',
      '0.1667 BCN per EMBR',
      '24.0000–26.4000 ORBT per BCN',
      '1,000 EMBR + 0 ORBT',
      'Shared compatible private lane'
    ]) expect(source).not.toContain(leakedTerm);
    expect(source).toContain('Private position terms');
    expect(source).toContain('action.revealTerms(selected)');
    expect(source).toContain('Owner-private Fixed terms');
    expect(source).toContain('Owner-private Range terms');
    expect(source).toContain('Owner-private Aggregate terms');
    expect(source).toContain('Owner-private Recurring');
    expect(source).toContain('Values stay in this session only.');
    expect(source).toContain('Edit owner-private terms');
    expect(source).toContain('Edit owner-private Aggregate terms');
    expect(source).toContain('Edit owner-private Recurring terms');
    expect(source).toContain("action.edit(selected, editableTerms, { kind: 'top-up'");
    expect(source).toContain("kind: 'reprice-fixed'");
    expect(source).toContain("kind: 'reprice-range'");
    expect(source).toContain("kind: 'partial-exit-fixed'");
    expect(source).toContain("kind: 'partial-exit-range'");
    expect(source).toContain("kind: 'top-up-aggregate'");
    expect(source).toContain("kind: 'reprice-aggregate'");
    expect(source).toContain("kind: 'partial-exit-aggregate'");
    expect(source).toContain("kind: 'withdraw-aggregate-counters'");
    expect(source).toContain("kind: 'top-up-recurring'");
    expect(source).toContain("kind: 'reprice-recurring'");
    expect(source).toContain("kind: 'withdraw-recurring'");
    expect(source).toContain('current budget');
    expect(source).toContain('Total spread');
    expect(source).toContain('Lower marginal price');
    expect(source).toContain('Upper marginal price');
    expect(source).toContain('The private revision is not published.');
    expect(source).not.toContain('lifecycleEditable');
    expect(source).toContain('Top up position');
    expect(source).toContain('Update Fixed terms');
    expect(source).toContain('Update Range terms');
    expect(source).toContain('Partially exit Fixed position');
    expect(source).toContain('Partially exit Range position');
    expect(source).not.toContain('Pool inventory');
    expect(source).not.toContain('Four private aggregate bins');
  });

  it('reads successor balances only through the corrected private-token ABI', () => {
    const source = readFileSync(fileURLToPath(new URL('../hooks/useDexV2TokenBalances.ts', import.meta.url)), 'utf8');
    expect(source).toContain('readSuccessorPrivateErc20BalanceWei');
    expect(source).not.toContain('readCurrentPrivateErc20BalanceWei');
  });

  it('keeps keeper work out of the primary Swap action', () => {
    const pageSource = readFileSync(fileURLToPath(new URL('./DexV2Page.tsx', import.meta.url)), 'utf8');

    expect(pageSource).not.toContain('Manual test controls');
    expect(pageSource).not.toContain('processManually');
    expect(pageSource).toContain('sender.submitCurrentCheapQuote(quote, {');
    expect(pageSource).toContain('sender.submitCurrentCheapAcceptance');
    expect(pageSource).toContain('submission.submitCurrentCheapOwnerAction');
    expect(pageSource).not.toContain('sender.submitCurrentQuote(quote)');
    expect(pageSource).not.toContain("profile: 'shared-pool'");
    expect(pageSource).not.toContain('useSuccessorDexSwapAction');
    expect(pageSource).not.toContain('successorDexAdmissionAvailable');
    expect(pageSource).not.toContain("strategies.includes('Aggregate')");
    expect(pageSource).not.toContain('strategies.includes(orderFamily)');
    expect(pageSource).not.toContain("strategies.includes('Recurring')");
  });

  it('keeps corrected successor transactions independent of old DEX modules', () => {
    for (const file of [
      '../../../lib/successorDexSwap.ts',
      '../../../lib/successorDexStrategies.ts',
      '../../../lib/successorDexPositionActions.ts',
      '../../../lib/successorDexP2.ts'
    ]) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      expect(source).not.toContain('./dexV2SwapExecution');
    }
    const appChainSource = readFileSync(fileURLToPath(new URL('../../../lib/appChain.ts', import.meta.url)), 'utf8');
    expect(appChainSource).not.toContain('./dexV2PositionDiscovery');
  });
});
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
