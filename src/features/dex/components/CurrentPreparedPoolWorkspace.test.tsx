import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CurrentPoolWorkspace, { currentPoolIntent } from './CurrentPoolWorkspace';
import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import { readCurrentDexDisplay } from '../../../lib/currentDexDisplay';
import { CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY } from '../../../lib/currentDexC1SwapPolicy';
import type { SharedWalletSession } from '../../../lib/walletSession';

const hooks = vi.hoisted(() => ({ index: 0, refIndex: 0, states: [] as unknown[], refs: [] as { current: unknown }[], confirm: vi.fn(), allowNative: false }));
// Only local capability wiring tests may pass the hold. The default uses the real gate.
vi.mock('../../../lib/dexV2Deployment', async original => {
  const actual = await original<typeof import('../../../lib/dexV2Deployment')>();
  return { ...actual, assertCurrentCheapDexNativeAdmission: (value: Parameters<typeof actual.assertCurrentCheapDexNativeAdmission>[0]) => {
    if (!hooks.allowNative) actual.assertCurrentCheapDexNativeAdmission(value);
  } };
});
vi.mock('../../../lib/currentDexC1SwapPolicy', async original => {
  const actual = await original<typeof import('../../../lib/currentDexC1SwapPolicy')>();
  return { ...actual, assertCurrentAppPoolAuthority: (graph: string, scope: Parameters<typeof actual.assertCurrentAppPoolAuthority>[1]) => {
    if (!hooks.allowNative) actual.assertCurrentAppPoolAuthority(graph, scope);
  }, assertCurrentAppPoolAllowanceCleanupAuthority: (graph: string, account: string) => {
    if (!hooks.allowNative) actual.assertCurrentAppPoolAllowanceCleanupAuthority(graph, account);
  } };
});
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.states)) hooks.states[i] = initial;
    return [hooks.states[i], (value: unknown) => { hooks.states[i] = typeof value === 'function' ? value(hooks.states[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); }
}));
vi.mock('../../trading/hooks/useTradeActionConfirmationState', () => ({ default: () => ({ confirmation: null, requestConfirmation: hooks.confirm, resolveConfirmation: vi.fn() }) }));
type Props = { children?: ReactNode; onClick?: () => void; disabled?: boolean; role?: string; 'aria-label'?: string };
const elements = (node: ReactNode): ReactElement<Props>[] => Array.isArray(node) ? node.flatMap(elements) : isValidElement<Props>(node) ? [node, ...elements(node.props.children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : isValidElement<Props>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const owner = `0x${'22'.repeat(20)}`;
describe.each(['cheap-prepared', 'cheap-exit', 'cheap-history'] as const)('%s prepared consumers', key => {
const candidate = resolveCurrentCheapDexCandidate(key);
function fixture() {
  vi.stubGlobal('window', { sessionStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
  const getPool = vi.fn(), getSender = vi.fn(), request = vi.fn();
  const session = { walletAddress: owner, chainId: Number(candidate.chainId), browserProvider: { request },
    actions: { getCurrentDexPoolFundingCapability: getPool, getCurrentDexSubmissionCapability: getSender } } as unknown as SharedWalletSession;
  const props = { sharedWalletSession: session, candidateKey: key as CurrentCheapDexCandidateKey,
    selectedPair: ['EMBR', 'ORBT'] as readonly [string, string], priceDisplayInverted: false };
  const render = () => { hooks.index = 0; hooks.refIndex = 0; return CurrentPoolWorkspace(props); };
  const button = (label: string) => elements(render()).find(element => element.type === 'button' && text(element.props.children) === label)!;
  render(); return { props, render, button, getPool, getSender, request };
}
afterEach(() => { hooks.states = []; hooks.refs = []; hooks.allowNative = false; vi.clearAllMocks(); vi.unstubAllGlobals(); });

function fundingFixture() {
  const f = fixture(), scope = hooks.refs[0].current;
  const pair = readCurrentDexDisplay(candidate).pairs.find(value => value.tokens.every(token => ['EMBR', 'ORBT'].includes(token.label)))!;
  const funding = { intent: currentPoolIntent('1', '1', '2', 1, '0.5'), amounts: { used0: 1234567n, used1: 2345678n },
    abandonUnfunded: vi.fn(async () => ({ status: 'unfunded-cleanup-required', cleanupRequired: [true, false] })) };
  hooks.states[10] = { value: funding, scope };
  const tokens = readCurrentDexDisplay(candidate).tokens.map(token => ({ address: token.address, decimals: 6, allowance: 0n, balance: 9_000_000n }));
  const outcome = { token: pair.tokens[0].address, fundingOutcome: 'verified', privateAccountingVerified: true,
    funds: { owner, core: candidate.core, graph: candidate.graph, packageSha256: candidate.packageSha256, tokens,
      privateFundsVerified: true, readyToSign: false } };
  const recover = vi.fn(async () => outcome), prepared = { data: 'test-only' };
  const sender = { checkCurrentCheapCandidate: vi.fn(async () => ({ owner, chainId: BigInt(candidate.chainId), core: candidate.core,
    graph: candidate.graph, packageSha256: candidate.packageSha256, readyToSign: false })),
    prepareSharedPoolApproval: vi.fn(async () => prepared), prepareSharedPoolAllowanceCleanup: vi.fn(async () => prepared),
    submitSharedPoolApproval: vi.fn(async () => ({ transactionHash: 'test-only-hash', recover })),
    submitPoolFunding: vi.fn(), recoverCurrentPreparedPoolFundingResult: vi.fn(async () => null),
    recoverPendingSharedPoolApproval: vi.fn(async () => ({ status: 'observed-mined', privateAccountingVerified: false })),
    recoverPendingPoolAttempt: vi.fn(async () => null) };
  f.getSender.mockResolvedValue(sender);
  return { ...f, scope, pair, funding, sender, prepared, recover, outcome, tokens };
}
describe('prepared Pool creation view', () => {
  it.each([0, 1, 2, 3, 4, 5])('shows only canonical token budgets for selected market %i', index => {
    const f = fixture(), pair = readCurrentDexDisplay(candidate).pairs[index];
    f.props.selectedPair = [pair.tokens[1].label, pair.tokens[0].label];
    const tree = f.render();
    expect(elements(tree).filter(element => element.type === 'input' && element.props['aria-label']?.endsWith('Pool budget')).map(element => element.props['aria-label']))
      .toEqual(pair.tokens.map(token => `${token.label} Pool budget`));
    expect(text(tree)).toContain(`${pair.tokens[0].label} per ${pair.tokens[1].label}`);
    f.props.priceDisplayInverted = true;
    expect(text(f.render())).toContain(`${pair.tokens[1].label} per ${pair.tokens[0].label}`);
    expect(f.getPool).not.toHaveBeenCalled(); expect(f.getSender).not.toHaveBeenCalled();
  });
  it('keeps the connected-wallet hold before provider, capability or private input prompts', async () => {
    const f = fixture(); hooks.states[0] = '1'; hooks.states[1] = '1'; hooks.states[2] = '2';
    const button = f.button('Review deposit'); expect(button.props.disabled).toBe(false);
    button.props.onClick!();
    await vi.waitFor(() => expect(text(f.render())).toContain(key==='cheap-history'?'App signing hold remains active':'native App submission admission is absent'));
    expect(f.getPool).not.toHaveBeenCalled(); expect(f.getSender).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled(); expect(hooks.confirm).not.toHaveBeenCalled();
  });
  it.each(['pair', 'candidate', 'owner'] as const)('hides an old private preview after %s changes', change => {
    const f = fixture();
    hooks.states[9] = { scope: hooks.refs[0].current, value: { amounts: { operation: 'add', used0: 1234567n, used1: 2345678n,
      unused0: 0n, unused1: 0n, mintedShares: 17n, ownedShares: 17n, toleranceN: 1n, toleranceD: 200n } } };
    expect(text(f.render())).toContain('1.234567');
    if (change === 'pair') f.props.selectedPair = ['BCN', 'HBR'];
    if (change === 'candidate') f.props.candidateKey = 'cheap-current';
    if (change === 'owner') f.props.sharedWalletSession = { ...f.props.sharedWalletSession, walletAddress: `0x${'33'.repeat(20)}` };
    expect(text(f.render())).not.toContain('1.234567');
    expect(elements(f.render()).some(element => element.props['aria-label'] === 'Authenticated Pool preview')).toBe(false);
  });
  it.each([['EMBR', 'EMBR'], ['unknown', 'ORBT']])('rejects unsupported pair %s/%s', (a, b) => {
    const f = fixture(); f.props.selectedPair = [a, b]; expect(() => f.render()).toThrow();
    expect(f.getPool).not.toHaveBeenCalled(); expect(f.getSender).not.toHaveBeenCalled();
  });
  it('holds prepared approvals before capability reads or confirmations', async () => {
    const f = fundingFixture(); f.button(`Approve exact ${f.pair.tokens[0].label}`).props.onClick!();
    await vi.waitFor(() => expect(text(f.render())).toContain(key==='cheap-history'?'App signing hold remains active':'native App submission admission is absent'));
    expect(f.getSender).not.toHaveBeenCalled(); expect(hooks.confirm).not.toHaveBeenCalled();
    expect(f.sender.submitSharedPoolApproval).not.toHaveBeenCalled();
  });
  it('stages the confirmed deposit before either approval or funding', async () => {
    hooks.allowNative = true; const f = fundingFixture(); hooks.states[10] = null;
    const prepareFunding = vi.fn(async () => f.funding);
    hooks.states[9] = { value: { prepareFunding, intent: f.funding.intent, amounts: { ...f.funding.amounts, operation: 'add', unused0: 0n, unused1: 0n,
      mintedShares: 17n, ownedShares: 17n, toleranceN: 1n, toleranceD: 200n } }, scope: f.scope };
    hooks.states[18] = { value: { intent: f.funding.intent }, scope: f.scope };
    f.button('Review funding and approvals').props.onClick!();
    await vi.waitFor(() => expect(text(f.render())).toContain('Review and approve each exact token amount'));
    expect(f.getSender).toHaveBeenCalledWith(BigInt(candidate.chainId), { candidate: key });
    expect(f.sender.submitPoolFunding).not.toHaveBeenCalled(); expect(f.sender.prepareSharedPoolApproval).not.toHaveBeenCalled();
    expect(f.button('Review and fund Pool').props.disabled).toBe(true);
  });
  if (key === 'cheap-history') it('admits an engineering owner with exact creation terms before capability access', async () => {
    hooks.states[0] = '1'; hooks.states[1] = '1'; hooks.states[2] = '2'; hooks.states[3] = 0; hooks.states[4] = '0.5';
    const f = fixture();
    f.props.sharedWalletSession = { ...f.props.sharedWalletSession, walletAddress: CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY.owner };
    const pair = readCurrentDexDisplay(candidate).pairs.find(value => value.tokens.every(token => ['EMBR', 'ORBT'].includes(token.label)))!;
    const hash = `0x${'44'.repeat(32)}`;
    const prepared = { data: 'prepared' };
    const preparePoolCreation = vi.fn(async (request: { confirmPrivateInputs: () => Promise<boolean> }) =>
      await request.confirmPrivateInputs() ? prepared : null);
    const sender = { checkCurrentCheapCandidate: vi.fn(async () => ({ owner: CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY.owner,
      chainId: BigInt(candidate.chainId), graph: candidate.graph, core: candidate.core, packageSha256: candidate.packageSha256, readyToSign: false })),
      submitPoolPreview: vi.fn(async () => ({ transactionHash: hash, recover: vi.fn(async () => null) })) };
    f.request.mockResolvedValue({ number: '0x1', hash }); f.getSender.mockResolvedValue(sender);
    f.getPool.mockResolvedValue({ preparePoolCreation });
    f.button('Review deposit').props.onClick!();
    await vi.waitFor(() => expect(preparePoolCreation).toHaveBeenCalledOnce());
    expect(f.getPool).toHaveBeenCalledWith(BigInt(candidate.chainId), { candidate: key });
    expect(preparePoolCreation.mock.calls[0][0]).toEqual(expect.objectContaining({ pair: pair.tokens.map(token => token.address),
      intent: expect.objectContaining({ classId: 0n, budgets: [1_000_000n, 1_000_000n], terms: expect.any(Array) }) }));
  });
  it('uses the selected funding object and requires private proof before enabling funding', async () => {
    hooks.allowNative = true; const f = fundingFixture();
    f.tokens.find(token => token.address === f.pair.tokens[0].address)!.allowance = f.funding.amounts.used0;
    f.button(`Approve exact ${f.pair.tokens[0].label}`).props.onClick!();
    await vi.waitFor(() => expect(f.sender.submitSharedPoolApproval).toHaveBeenCalledWith(f.prepared));
    expect(f.sender.prepareSharedPoolApproval).toHaveBeenCalledWith({ funding: f.funding, canonicalIndex: 0, cleanup: false, confirm: expect.any(Function) });
    f.button('Check Pool status').props.onClick!();
    await vi.waitFor(() => expect(text(f.render())).toContain(`Exact ${f.pair.tokens[0].label} approval verified`));
    expect(f.button('Review and fund Pool').props.disabled).toBe(true);
    f.outcome.token = f.pair.tokens[1].address;
    f.tokens.find(token => token.address === f.pair.tokens[1].address)!.allowance = f.funding.amounts.used1;
    f.button(`Approve exact ${f.pair.tokens[1].label}`).props.onClick!();
    await vi.waitFor(() => expect(f.sender.submitSharedPoolApproval).toHaveBeenCalledTimes(2));
    f.button('Check Pool status').props.onClick!();
    await vi.waitFor(() => expect(f.button('Review and fund Pool').props.disabled).toBe(false));
  });
  it.each(['private', 'amount', 'token', 'owner', 'graph', 'package'])('does not accept a false %s approval result', async fault => {
    hooks.allowNative = true; const f = fundingFixture();
    f.tokens.find(token => token.address === f.pair.tokens[0].address)!.allowance = f.funding.amounts.used0;
    if (fault === 'private') f.outcome.privateAccountingVerified = false;
    if (fault === 'amount') f.tokens.find(token => token.address === f.pair.tokens[0].address)!.allowance--;
    if (fault === 'token') f.outcome.token = owner;
    if (fault === 'owner') f.outcome.funds.owner = candidate.core;
    if (fault === 'graph') Object.assign(f.outcome.funds, { graph: 'changed' });
    if (fault === 'package') Object.assign(f.outcome.funds, { packageSha256: 'changed' });
    f.button(`Approve exact ${f.pair.tokens[0].label}`).props.onClick!();
    await vi.waitFor(() => expect(f.sender.submitSharedPoolApproval).toHaveBeenCalledOnce());
    f.button('Check Pool status').props.onClick!();
    await vi.waitFor(() => expect(f.sender.recoverPendingSharedPoolApproval).toHaveBeenCalledOnce());
    expect(f.button('Review and fund Pool').props.disabled).toBe(true);
    expect(text(f.render())).toContain('no authenticated private result');
  });
  it('stops the exact unfunded deposit and exposes only remaining zero-approval cleanup', async () => {
    hooks.allowNative = true; const f = fundingFixture(); hooks.states[19] = true;
    f.button('Review stop and clear approvals').props.onClick!();
    await vi.waitFor(() => expect(f.funding.abandonUnfunded).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(text(f.render())).toContain('Funding cannot restart'));
    expect(f.getSender).not.toHaveBeenCalled();
    expect(f.button('Review and fund Pool').props.disabled).toBe(true);
    expect(f.button(`Clear ${f.pair.tokens[1].label} approval`).props.disabled).toBe(true);
    f.button(`Clear ${f.pair.tokens[0].label} approval`).props.onClick!();
    await vi.waitFor(() => expect(f.sender.prepareSharedPoolApproval).toHaveBeenCalledWith(expect.objectContaining({ funding: f.funding, cleanup: true })));
  });
  if (key === 'cheap-history') it('clears an unused approval after local Pool preparation is lost, without another preview', async () => {
    hooks.allowNative = true; const f = fundingFixture(); hooks.states[10] = null;
    Object.assign(f.outcome, { recoveredCleanup: true, cleanup: true });
    f.button(`Clear unused ${f.pair.tokens[0].label} approval`).props.onClick!();
    await vi.waitFor(() => expect(f.sender.submitSharedPoolApproval).toHaveBeenCalledWith(f.prepared));
    expect(f.sender.prepareSharedPoolAllowanceCleanup).toHaveBeenCalledWith(expect.objectContaining({ marketId: f.pair.marketId, canonicalIndex: 0 }));
    f.button('Check Pool status').props.onClick!();
    await vi.waitFor(() => expect(text(f.render())).toContain('Unused '+f.pair.tokens[0].label+' approval cleared'));
    expect(f.button(`Clear unused ${f.pair.tokens[0].label} approval`).props.disabled).toBe(true);
    expect(f.getPool).not.toHaveBeenCalled(); expect(f.sender.submitPoolFunding).not.toHaveBeenCalled();
  });
  if (key === 'cheap-history') it.each([
    ['Known Pool verification failure. Manual reconciliation is required.', 'The first private proof failed.'],
    ['A distinct fallback recovery failure.', 'A distinct fallback recovery failure.']
  ])('keeps the useful recovery reason when the funding fallback fails with %s', async (fallbackError, expectedMessage) => {
    const f = fundingFixture(), originalError = new Error('The first private proof failed.');
    const recover = vi.fn(async () => { throw originalError; });
    const pending = { phase: 'fund' as const, recover, scope: f.scope };
    hooks.states[6] = true; hooks.states[13] = pending; hooks.states[14] = `0x${'55'.repeat(32)}`;
    f.sender.recoverCurrentPreparedPoolFundingResult.mockRejectedValue(new Error(fallbackError));
    f.button('Check Pool status').props.onClick!();
    await vi.waitFor(() => expect(text(f.render())).toContain(expectedMessage));
    expect(recover).toHaveBeenCalledOnce();
    expect(f.sender.recoverCurrentPreparedPoolFundingResult).toHaveBeenCalledOnce();
    expect(hooks.states[6]).toBe(true); expect(hooks.states[13]).toBe(pending);
    expect(f.sender.submitPoolFunding).not.toHaveBeenCalled(); expect(hooks.confirm).not.toHaveBeenCalled();
  });
  if (key === 'cheap-history') it.each(['private-proof', 'nonzero-allowance'])('does not accept recovered cleanup with %s', async fault => {
    hooks.allowNative = true; const f = fundingFixture(); hooks.states[10] = null;
    Object.assign(f.outcome, { recoveredCleanup: true, cleanup: true });
    if (fault === 'private-proof') f.outcome.privateAccountingVerified = false;
    else f.tokens.find(token => token.address === f.pair.tokens[0].address)!.allowance = 1n;
    f.button(`Clear unused ${f.pair.tokens[0].label} approval`).props.onClick!();
    await vi.waitFor(() => expect(f.sender.submitSharedPoolApproval).toHaveBeenCalledOnce());
    f.button('Check Pool status').props.onClick!();
    await vi.waitFor(() => expect(text(f.render())).toContain('no authenticated private result'));
    expect(hooks.states[12]).toEqual([false, false]);
    expect(f.sender.submitPoolFunding).not.toHaveBeenCalled();
  });
});

});
