import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CurrentSharedTestTokenControls, { sharedTokenFundingConfirmation } from './CurrentSharedTestTokenControls';
import { readCurrentSharedDexTestTokens } from '../../../lib/appChain';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { CURRENT_SHARED_DEX_TOKENS, CURRENT_SHARED_TOKEN_DISTRIBUTION as p, resolveCurrentSharedTokenDistribution } from '../../../lib/currentSharedDexTokenDistribution';
import type { CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
const hooks = vi.hoisted(() => ({ enabled: false, stateIndex: 0, refIndex: 0, states: [] as unknown[], refs: [] as { current: unknown }[] }));
vi.mock('react', async original => { const actual = await original<typeof import('react')>(); return { ...actual,
  useState: (initial: unknown) => { if (!hooks.enabled) return actual.useState(initial); const i = hooks.stateIndex++; if (!(i in hooks.states)) hooks.states[i] = initial; return [hooks.states[i], (value: unknown) => { hooks.states[i] = value; }]; },
  useRef: (initial: unknown) => { if (!hooks.enabled) return actual.useRef(initial); const i = hooks.refIndex++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); } }; });
vi.mock('../../../lib/appChain', () => ({ readCurrentSharedDexTestTokens: vi.fn() }));
vi.mock('../../trading/hooks/useTradeActionConfirmationState', () => ({ default: () => ({ confirmation: null, requestConfirmation: async () => true, resolveConfirmation: () => {} }) }));
const elements = (node: ReactNode): ReactElement<{ children?: ReactNode; disabled?: boolean; onClick?: () => void }>[] => Array.isArray(node) ? node.flatMap(elements) : isValidElement<{ children?: ReactNode }>(node) ? [node, ...elements(node.props.children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const snapshot = () => ({ owner: p.vault.recovery, head: { number: 9951288n, hash: `0x${'11'.repeat(32)}`, timestamp: 1791340000n },
  core: p.core, graph: p.graph, packageSha256: p.packageSha256, vault: p.vault, readyToSign: false as const,
  tokens: CURRENT_SHARED_DEX_TOKENS.map((token, i) => ({ ...token, claimed: i !== 3, initialClaimAvailability: i === 3 ? 'ready' as const : 'claimed' as const,
    refillAvailability: i === 3 ? 'initial-claim-required' as const : 'cooldown' as const, quota: 999000n * 10n ** 6n,
    nextClaimAt: 1791400000n, initialAmount: p.initialAmount, refillAmount: p.refillAmount })) });
function fixture() {
  hooks.enabled = true;
  const session = { walletAddress: p.vault.recovery, chainId: 7082400, browserProvider: { request: vi.fn() }, browserWalletId: 'metamask', activeSignerSource: 'metamask' } as unknown as SharedWalletSession;
  let candidateKey: CurrentCheapDexCandidateKey = 'cheap-prepared';
  const render = () => { hooks.stateIndex = 0; hooks.refIndex = 0; return CurrentSharedTestTokenControls({ sharedWalletSession: session, candidateKey }); };
  const button = () => elements(render()).find(e => e.type === 'button')!;
  render(); return { session, render, button, click: () => button().props.onClick!(), select: (key: CurrentCheapDexCandidateKey) => { candidateKey = key; } };
}
afterEach(() => { hooks.enabled = false; hooks.states = []; hooks.refs = []; vi.clearAllMocks(); });
describe('four-asset beta funding controls', () => {
  it.each(['initial', 'refill'] as const)('shows all four current engineering %s actions after private eligibility is read', async action => {
    const f = fixture(), owner = '0x8b749251cf1f712d4e39fd048c53394af03e10be', policy = resolveCurrentSharedTokenDistribution('cheap-history');
    f.select('cheap-history'); f.session.walletAddress = owner;
    f.session.sessionOnboardInfo = { [owner]: { aesKey: 'synthetic-test-session' } } as never;
    vi.stubGlobal('window', { sessionStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
    const funds = { ...snapshot(), owner, core: policy.core, graph: policy.graph, packageSha256: policy.packageSha256,
      privateFundsVerified: true, tokens: snapshot().tokens.map(token => ({ ...token, claimed: action === 'refill',
        initialClaimAvailability: action === 'initial' ? 'ready' : 'claimed', refillAvailability: action === 'refill' ? 'ready' : 'initial-claim-required',
        balance: 0n, allowance: 0n, encryptionAddress: owner })) };
    const getSender = vi.fn();
    f.session.actions = { getCurrentSharedDexTokenFundsCapability: async () => ({ read: async () => funds }), getCurrentDexSubmissionCapability: getSender } as never;
    elements(f.render()).find(e => e.type === 'button' && text(e.props.children) === 'Reveal balances')!.props.onClick!();
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
    const writes = elements(f.render()).filter(e => e.type === 'button' && /^(Claim|Refill) /.test(text(e.props.children)));
    expect(writes).toHaveLength(4);
    expect(writes.every(button => button.props.disabled === false && text(button.props.children).startsWith(action === 'initial' ? 'Claim' : 'Refill'))).toBe(true);
    expect(text(f.render())).not.toContain('Token signing is held'); expect(getSender).not.toHaveBeenCalled();
  });
  it('shows the legacy hold when all remaining displayed actions are refills', async () => {
    const f = fixture(), owner = '0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d', policy = resolveCurrentSharedTokenDistribution('cheap-exit');
    f.select('cheap-exit'); f.session.walletAddress = owner;
    f.session.sessionOnboardInfo = { [owner]: { aesKey: 'synthetic-test-session' } } as never;
    vi.stubGlobal('window', { sessionStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
    const funds = { ...snapshot(), owner, core: policy.core, graph: policy.graph, packageSha256: policy.packageSha256, privateFundsVerified: true,
      tokens: snapshot().tokens.map(token => ({ ...token, claimed: true, initialClaimAvailability: 'claimed', refillAvailability: 'ready', balance: 0n, allowance: 0n })) };
    f.session.actions = { getCurrentSharedDexTokenFundsCapability: async () => ({ read: async () => funds }), getCurrentDexSubmissionCapability: vi.fn() } as never;
    elements(f.render()).find(e => e.type === 'button' && text(e.props.children) === 'Reveal balances')!.props.onClick!();
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
    expect(text(f.render())).toContain('Token signing is held');
    expect(elements(f.render()).filter(e => e.type === 'button' && /^Refill /.test(text(e.props.children))).every(button => button.props.disabled)).toBe(true);
  });
  it('uses the saved known hash for blocked-claim reconciliation without manual hash entry', async () => {
    const f = fixture(), owner = '0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d', policy = resolveCurrentSharedTokenDistribution('cheap-exit');
    f.select('cheap-exit'); f.session.walletAddress = owner;
    f.session.sessionOnboardInfo = { [owner]: { aesKey: 'synthetic-test-session' } } as never;
    const hash = `0x${'33'.repeat(32)}`, failedRecover = vi.fn();
    let pending: string | null = JSON.stringify({ version: 1, chainId: '7082400', owner, core: policy.core.toLowerCase(),
      graph: `0x${policy.graph}`, phase: 'token-faucet', callHash: `0x${'44'.repeat(32)}`, nonce: 1, txHash: hash,
      target: CURRENT_SHARED_DEX_TOKENS[1].address.toLowerCase(), verificationBlocked: true });
    vi.stubGlobal('window', { sessionStorage: { getItem: () => pending, setItem: vi.fn(), removeItem: vi.fn() } });
    const recover = vi.fn(async (knownHash: string) => { expect(knownHash).toBe(hash); pending = null;
      return { status: 'observed-mined', privateAccountingVerified: true }; });
    f.session.actions = { getCurrentDexSubmissionCapability: async () => ({ recoverPendingSharedTokenFunding: recover,
      readSharedTokenFunding: async () => ({ ...snapshot(), owner, core: policy.core, graph: policy.graph,
        packageSha256: policy.packageSha256, privateFundsVerified: true,
        tokens: snapshot().tokens.map(token => ({ ...token, balance: 0n, allowance: 0n })) }) }) } as never;
    f.render();
    elements(f.render()).find(e => e.type === 'button' && text(e.props.children) === 'Check confirmation')!.props.onClick!();
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
    expect(recover).toHaveBeenCalledOnce(); expect(failedRecover).not.toHaveBeenCalled();
    expect(text(f.render())).toContain('Confirmed: exact private beta token credit verified.');
  });
  it.each(['verified', 'reverted', 'pending', 'private-failure'] as const)('checks a known claim automatically and shows %s accurately', async outcome => {
    const f = fixture(), owner = '0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d', policy = resolveCurrentSharedTokenDistribution('cheap-exit');
    f.select('cheap-exit'); f.session.walletAddress = owner;
    vi.stubGlobal('window', { sessionStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
    f.session.sessionOnboardInfo = { [owner]: { aesKey: 'synthetic-test-session' } } as never;
    const funds = { ...snapshot(), owner, core: policy.core, graph: policy.graph, packageSha256: policy.packageSha256,
      privateFundsVerified: true, tokens: snapshot().tokens.map(token => ({ ...token, claimed: false,
        initialClaimAvailability: 'ready', balance: 0n, allowance: 0n, encryptionAddress: owner })) };
    const after = { ...funds, tokens: funds.tokens.map(token => token.symbol === 'HBR' ? { ...token, claimed: true,
      initialClaimAvailability: 'claimed', balance: policy.initialAmount } : token) };
    let finishWallet!: () => void;
    const wallet = new Promise<void>(resolve => { finishWallet = resolve; });
    const recover = vi.fn(async () => {
      if (outcome === 'private-failure') throw new Error('Private claim credit differs. Do not resend.');
      return { fundingOutcome: outcome === 'reverted' ? 'reverted' : 'verified', privateAccountingVerified: true,
        funds: outcome === 'reverted' ? funds : after };
    });
    const sender = { prepareSharedTokenFunding: vi.fn(async () => ({ action: 'initial', token: CURRENT_SHARED_DEX_TOKENS[1].address })),
      submitSharedTokenFunding: vi.fn(async (_prepared: unknown, onSigningRequest?: () => void) => {
        onSigningRequest?.(); await wallet; return { transactionHash: `0x${'33'.repeat(32)}`, recover };
      }), waitForCurrentCheapReceipt: vi.fn(async () => outcome === 'pending' ? null : { status: outcome === 'reverted' ? 0 : 1 }) };
    f.session.actions = { getCurrentSharedDexTokenFundsCapability: async () => ({ read: async () => funds }),
      getCurrentDexSubmissionCapability: async () => sender } as never;
    elements(f.render()).filter(e => e.type === 'button')[1].props.onClick!();
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
    const claim = () => elements(f.render()).find(e => e.type === 'button' && text(e.props.children) === 'Claim HBR')!;
    expect(claim().props.disabled).toBe(false); claim().props.onClick!();
    await vi.waitFor(() => expect(sender.submitSharedTokenFunding).toHaveBeenCalledOnce());
    const walletText = text(f.render()); claim().props.onClick!(); finishWallet();
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
    expect(sender.submitSharedTokenFunding).toHaveBeenCalledOnce();
    if (outcome === 'verified') {
      expect(text(f.render())).toContain('Confirmed: exact private beta token credit verified.');
      expect(text(f.render())).toContain('Balance: 10000.0'); expect(recover).toHaveBeenCalledOnce();
    } else if (outcome === 'reverted') {
      expect(text(f.render())).toContain('Claim reverted. Exact private state is unchanged.');
      expect(text(f.render())).not.toContain('Balance: 10000.0'); expect(recover).toHaveBeenCalledOnce();
    } else if (outcome === 'private-failure') {
      expect(text(f.render())).toContain('Private claim credit differs. Do not resend.'); expect(claim().props.disabled).toBe(true);
    } else {
      expect(text(f.render())).toContain('Claim is pending. Check confirmation; do not resend.'); expect(recover).not.toHaveBeenCalled();
    }
    expect(walletText).toContain('Confirm the claim in your wallet.');
  });
  it('binds current private funds and discards them on deployment change', async () => {
    const f = fixture(), policy = resolveCurrentSharedTokenDistribution('cheap-exit');
    f.select('cheap-exit');
    const getFunds = vi.fn(async () => ({ read: async () => ({ ...snapshot(), core: policy.core, graph: policy.graph,
      packageSha256: policy.packageSha256, privateFundsVerified: true,
      tokens: snapshot().tokens.map(t => ({ ...t, balance: 987654321n, allowance: 0n })) }) }));
    f.session.actions = { getCurrentSharedDexTokenFundsCapability: getFunds } as never;
    f.session.sessionOnboardInfo = { [f.session.walletAddress.toLowerCase()]: { aesKey: 'synthetic-test-session' } } as never;
    elements(f.render()).filter(e => e.type === 'button')[1].props.onClick!();
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
    expect(getFunds).toHaveBeenCalledWith(7082400n, { candidate: 'cheap-exit' });
    expect(text(f.render())).toContain('987.654321');
    f.select('cheap-prepared'); expect(text(f.render())).not.toContain('987.654321');
  });
  it('refuses an old-Core private result for the current candidate', async () => {
    const f = fixture(); f.select('cheap-exit');
    f.session.actions = { getCurrentSharedDexTokenFundsCapability: async () => ({ read: async () => ({ ...snapshot(),
      privateFundsVerified: true, tokens: snapshot().tokens.map(t => ({ ...t, balance: 987654321n, allowance: 0n })) }) }) } as never;
    f.session.sessionOnboardInfo = { [f.session.walletAddress.toLowerCase()]: { aesKey: 'synthetic-test-session' } } as never;
    elements(f.render()).filter(e => e.type === 'button')[1].props.onClick!();
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
    expect(text(f.render())).toContain('candidate or owner changed'); expect(text(f.render())).not.toContain('987.654321');
  });
  it('shows claim policy and connection reason without enabling disconnected reads', () => {
    const html = renderToStaticMarkup(<CurrentSharedTestTokenControls />);
    for (const token of CURRENT_SHARED_DEX_TOKENS) expect(html).toContain(`<strong>${token.symbol}</strong>`);
    expect(html).toContain('10,000.0 tokens once per wallet and token');
    expect(html).toContain('1,000.0 tokens every 24 hours while quota remains'); expect(html).toContain('Connect your wallet to check availability.');
    expect(html).toContain('href="https://faucet.testnet.coti.io/" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('Get Test COTI for gas');
    expect(html).toMatch(/disabled=""[^>]*>Check availability/);
  });
  it('shows separate per-token eligibility and exact six-decimal quota', async () => {
    vi.mocked(readCurrentSharedDexTestTokens).mockResolvedValueOnce(snapshot()); const f = fixture(); f.click();
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
    expect(text(f.render())).toContain('999000.0 tokens');
    const orbt = elements(f.render()).find(e => e.type === 'article' && text(e).includes('ORBT'))!;
    expect(text(orbt)).toContain('Initial claim available');
    expect(elements(orbt).filter(e => e.type === 'button' && /^(Claim|Refill) /.test(text(e.props.children)))).toHaveLength(1);
    expect(text(orbt)).toContain('Claim ORBT');
    expect(text(f.render())).toMatch(/Token signing is held|previous transaction needs confirmation/); expect(elements(f.render()).filter(e => e.type === 'button')).toHaveLength(7);
    expect(elements(f.render()).filter(e => e.type === 'button' && /^(Claim|Refill) /.test(text(e.props.children)))).toHaveLength(4);
  });
  it('rejects duplicate reads and hides the old result after owner changes', async () => {
    let resolve!: (value: ReturnType<typeof snapshot>) => void;
    vi.mocked(readCurrentSharedDexTestTokens).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const f = fixture(); f.click(); f.click(); expect(readCurrentSharedDexTestTokens).toHaveBeenCalledTimes(1);
    f.session.walletAddress = '0x23aBDe1d22019D52852D6845c9444326Dde1D99e'; f.render(); resolve(snapshot());
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false)); expect(text(f.render())).not.toContain('9951288');
  });
  it('shows an unavailable read without a false eligibility result', async () => {
    vi.mocked(readCurrentSharedDexTestTokens).mockRejectedValueOnce(new Error('Distribution runtime changed.'));
    const f = fixture(); f.click(); await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
    expect(text(f.render())).toContain('Distribution runtime changed'); expect(text(f.render())).not.toContain('Refill available');
  });
  it.each([1, 2632500])('disables current-candidate reads on network %s and discards an in-flight result', async chainId => {
    const f = fixture(); f.select('cheap-exit'); f.session.chainId = chainId;
    expect(f.button().props.disabled).toBe(true); f.click(); expect(readCurrentSharedDexTestTokens).not.toHaveBeenCalled();
    f.session.chainId = 7082400;
    let resolve!: (value: ReturnType<typeof snapshot>) => void;
    vi.mocked(readCurrentSharedDexTestTokens).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    f.click(); expect(readCurrentSharedDexTestTokens).toHaveBeenCalledOnce();
    f.session.chainId = chainId; f.render(); resolve(snapshot());
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
    expect(text(f.render())).not.toContain('999000.0 tokens'); expect(f.button().props.disabled).toBe(true);
  });
  it('requires unlocked privacy, then shows six-decimal funds and hides them when privacy changes', async () => {
    const f = fixture(), read = vi.fn(async () => ({ ...snapshot(), privateFundsVerified: true as const,
      tokens: snapshot().tokens.map(t => ({ ...t, balance: 123456789n, allowance: 1000000n, encryptionAddress: p.vault.recovery })) }));
    const getFunds = vi.fn(async () => ({ read }));
    f.session.actions = { getCurrentSharedDexTokenFundsCapability: getFunds } as never;
    const reveal = () => elements(f.render()).filter(e => e.type === 'button')[1];
    expect(reveal().props.disabled).toBe(true); reveal().props.onClick!(); expect(getFunds).not.toHaveBeenCalled();
    f.session.sessionOnboardInfo = { [f.session.walletAddress.toLowerCase()]: { aesKey: 'synthetic-test-session' } } as never;
    expect(reveal().props.disabled).toBe(false); reveal().props.onClick!();
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
    expect(text(f.render())).toContain('Balance: 123.456789');
    expect(text(f.render())).toContain('DEX allowance1.0 tokens');
    expect(text(f.render())).toContain('not confirmation of a previous claim'); expect(getFunds).toHaveBeenCalledWith(7082400n, { candidate: 'cheap-prepared' });
    f.session.sessionOnboardInfo = {}; expect(text(f.render())).not.toContain('123.456789');
    expect(reveal().props.disabled).toBe(true);
  });
  it('discards a private result if the owner changes during the read', async () => {
    const f = fixture(); let finish!: (v: unknown) => void;
    f.session.actions = { getCurrentSharedDexTokenFundsCapability: async () => ({ read: () => new Promise(r => { finish = r; }) }) } as never;
    f.session.sessionOnboardInfo = { [f.session.walletAddress.toLowerCase()]: { aesKey: 'synthetic-test-session' } } as never;
    elements(f.render()).filter(e => e.type === 'button')[1].props.onClick!();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    f.session.walletAddress = '0x23aBDe1d22019D52852D6845c9444326Dde1D99e'; f.render();
    finish({ ...snapshot(), privateFundsVerified: true, tokens: snapshot().tokens.map(t => ({ ...t, balance: 1000000n, allowance: 0n })) });
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false)); expect(text(f.render())).not.toContain('Balance: 1.0');
  });
  it('keeps all four-token writes held even with unlocked funds and an available sender', async () => {
    const f = fixture(), sender = vi.fn();
    f.session.actions = { getCurrentDexSubmissionCapability: sender } as never;
    f.session.sessionOnboardInfo = { [f.session.walletAddress.toLowerCase()]: { aesKey: 'synthetic-test-session' } } as never;
    const writes = elements(f.render()).filter(e => e.type === 'button' && /^(Claim|Refill) /.test(text(e.props.children)));
    expect(writes).toHaveLength(4);
    for (const button of writes) { expect(button.props.disabled).toBe(true); button.props.onClick!(); }
    expect(sender).not.toHaveBeenCalled();
  });
  it('hides unread private balances and keeps the initial action disabled until verified', () => {
    const html = renderToStaticMarkup(<CurrentSharedTestTokenControls />);
    expect(html).not.toContain('Balance:');
    expect(html.replace(/<[^>]+>/g, '')).toContain('Receive 10,000.0 BCN');
    expect(html).not.toContain('Balance: 0.0');
    expect(html.match(/>(?:Claim|Refill) (?:BCN|HBR|EMBR|ORBT)<\/button>/g)).toHaveLength(4);
    expect(html.match(/disabled=""[^>]*>(?:Claim|Refill) /g)).toHaveLength(4);
  });
  it('uses six-decimal claim review and separates allowance from credit', () => {
    const review = sharedTokenFundingConfirmation({ action: 'refill', token: CURRENT_SHARED_DEX_TOKENS[0].address, amount: p.refillAmount,
      to: p.vault.address, data: '0x', core: p.core, graph: p.graph, packageSha256: p.packageSha256, readyToSign: false, decimals: 6, cooldown: p.cooldown,
      expiresAt: p.vault.expiresAt, gasEstimate: 800_000n, gasPrice: 50_000_000n, gasLimit: 5_000_000n });
    expect(review.title).toBe('Refill BCN');
    expect(review.summaryRows).toContainEqual({ label: 'Amount', value: '1000.0 BCN' });
    expect(review.summaryRows).toContainEqual({ label: 'Estimated network fee', value: '0.00004 Test COTI' });
    expect(review.summaryRows).toContainEqual({ label: 'Maximum network fee', value: '0.00025 Test COTI' });
    expect(review.message).toContain('Your DEX allowance stays unchanged');
  });
  it('reconciles metadata while signing is held without claiming a private balance delta', async () => {
    const f = fixture(), recover = vi.fn(async () => ({ status: 'observed-mined', privateAccountingVerified: false }));
    const read = vi.fn(async () => ({ ...snapshot(), privateFundsVerified: true,
      tokens: snapshot().tokens.map(t => ({ ...t, balance: 123456789n, allowance: 1000000n })) }));
    const getSender = vi.fn(async () => ({ recoverPendingSharedTokenFunding: recover, readSharedTokenFunding: read }));
    f.session.actions = { getCurrentDexSubmissionCapability: getSender } as never;
    f.session.sessionOnboardInfo = { [f.session.walletAddress.toLowerCase()]: { aesKey: 'synthetic-test-session' } } as never;
    elements(f.render()).find(e => e.type === 'button' && text(e.props.children) === 'Check confirmation')!.props.onClick!();
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
    expect(recover).toHaveBeenCalledWith(undefined); expect(read).toHaveBeenCalledOnce();
    expect(text(f.render())).toContain('Reload recovery does not prove the previous private balance change');
    expect(text(f.render())).toContain('Balance: 123.456789'); expect(text(f.render())).not.toContain('exact private beta token credit verified');
  });
  it.each([false, true])('labels private receipt credit separately from a historical balance delta; blocked=%s', async blocked => {
    const f = fixture();
    f.session.actions = { getCurrentDexSubmissionCapability: async () => ({
      recoverPendingSharedTokenFunding: async () => ({ status: 'observed-mined', privateAccountingVerified: false, privateCreditVerified: true,
        ...(blocked ? { verificationBlocked: true } : {}) }),
      readSharedTokenFunding: async () => ({ ...snapshot(), privateFundsVerified: true,
        tokens: snapshot().tokens.map(token => ({ ...token, balance: 123456789n, allowance: 0n })) }) }) } as never;
    f.session.sessionOnboardInfo = { [f.session.walletAddress.toLowerCase()]: { aesKey: 'synthetic-test-session' } } as never;
    elements(f.render()).find(e => e.type === 'button' && text(e.props.children) === 'Check confirmation')!.props.onClick!();
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
    expect(text(f.render())).toContain(blocked ? 'Private receipt credit verified. The earlier balance check is unresolved; do not resend.'
      : 'Claim confirmed. Private receipt credit verified; balances are current.');
    expect(hooks.states[2]).toBe(blocked);
    expect(text(f.render())).not.toContain('exact private beta token credit verified');
  });
  it.each(['manual-reconciliation-required', 'awaiting-chain-confirmation'])('keeps %s unavailable without a private read or resend', async status => {
    const f = fixture(), read = vi.fn(), recover = vi.fn(async () => ({ status, privateAccountingVerified: false }));
    f.session.actions = { getCurrentDexSubmissionCapability: async () => ({ recoverPendingSharedTokenFunding: recover, readSharedTokenFunding: read }) } as never;
    f.session.sessionOnboardInfo = { [f.session.walletAddress.toLowerCase()]: { aesKey: 'synthetic-test-session' } } as never;
    elements(f.render()).find(e => e.type === 'button' && text(e.props.children) === 'Check confirmation')!.props.onClick!();
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
    expect(read).not.toHaveBeenCalled(); expect(text(f.render())).toMatch(/do not resend/i);
    expect(text(f.render())).not.toContain('Balance:');
    expect(text(f.render())).not.toContain('Balance: 123.456789'); expect(hooks.states[2]).toBe(true);
  });
  it('discards recovery and private funds after owner context changes', async () => {
    const f = fixture(), read = vi.fn(); let finish!: (value: unknown) => void;
    f.session.actions = { getCurrentDexSubmissionCapability: async () => ({
      recoverPendingSharedTokenFunding: () => new Promise(r => { finish = r; }), readSharedTokenFunding: read }) } as never;
    f.session.sessionOnboardInfo = { [f.session.walletAddress.toLowerCase()]: { aesKey: 'synthetic-test-session' } } as never;
    elements(f.render()).find(e => e.type === 'button' && text(e.props.children) === 'Check confirmation')!.props.onClick!();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    f.session.walletAddress = '0x23aBDe1d22019D52852D6845c9444326Dde1D99e'; f.render();
    finish({ status: 'observed-mined', privateAccountingVerified: false });
    await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
    expect(read).not.toHaveBeenCalled(); expect(text(f.render())).not.toContain('Current private funds checked');
  });
});
