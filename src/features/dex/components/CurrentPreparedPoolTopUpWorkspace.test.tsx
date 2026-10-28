import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CurrentPreparedPoolTopUpWorkspace from './CurrentPreparedPoolTopUpWorkspace';
import { resolveCurrentCheapDexCandidate } from '../../../lib/dexV2Deployment';
import { readCurrentDexDisplay } from '../../../lib/currentDexDisplay';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY } from '../../../lib/currentDexPendingAttempt';
import type { SharedWalletSession } from '../../../lib/walletSession';
import type { issueCurrentDexPoolFundingCapability } from '../../wallet/currentDexPoolFundingCapability';
import type { issueCurrentDexPoolPositionCapability } from '../../wallet/currentDexPoolPositionCapability';
import { CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY } from '../../../lib/currentDexC1SwapPolicy';

// Component control-flow tests. The real capability/sender suites separately
// check brands, canonical calls, private events, storage and wallet accounting.
const hooks = vi.hoisted(() => ({ index: 0, refIndex: 0, states: [] as unknown[], refs: [] as { current: unknown }[],
  allowNative: false, confirm: vi.fn(async () => true) }));
vi.mock('../../../lib/currentDexPoolSubmission', async original => {
  const actual = await original<typeof import('../../../lib/currentDexPoolSubmission')>();
  return { ...actual, assertCurrentPoolFundingNativeAdmission: (candidate: Parameters<typeof actual.assertCurrentPoolFundingNativeAdmission>[0], mode?: 'creation' | 'top-up') => {
    if (!hooks.allowNative) actual.assertCurrentPoolFundingNativeAdmission(candidate, mode);
  } };
});
vi.mock('../../../lib/currentDexC1SwapPolicy', async original => {
  const actual = await original<typeof import('../../../lib/currentDexC1SwapPolicy')>();
  return { ...actual, assertCurrentAppPoolAuthority: (graph: string, scope: Parameters<typeof actual.assertCurrentAppPoolAuthority>[1]) => {
    if (!hooks.allowNative) actual.assertCurrentAppPoolAuthority(graph, scope);
  } };
});
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.states)) hooks.states[i] = initial;
    return [hooks.states[i], (value: unknown) => { hooks.states[i] = typeof value === 'function' ? value(hooks.states[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); }
}));
vi.mock('../../trading/hooks/useTradeActionConfirmationState', () => ({ default: () => ({
  confirmation: null, requestConfirmation: hooks.confirm, resolveConfirmation: vi.fn()
}) }));

type Props = { children?: ReactNode; disabled?: boolean; onClick?: () => void; value?: string;
  onChange?: (event: { target: { value: string } }) => void; 'aria-label'?: string };
type Node = { element: ReactElement<Props>; disabled: boolean };
const elements = (node: ReactNode, disabled = false): Node[] => Array.isArray(node) ? node.flatMap(value => elements(value, disabled)) :
  isValidElement<Props>(node) ? [{ element: node, disabled: disabled || !!node.props.disabled },
    ...elements(node.props.children, disabled || node.type === 'fieldset' && !!node.props.disabled)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : isValidElement<Props>(node) ? text(node.props.children) :
  typeof node === 'string' || typeof node === 'number' ? String(node) : '';
type FundingCap = Awaited<ReturnType<typeof issueCurrentDexPoolFundingCapability>>;
type PositionsCap = Awaited<ReturnType<typeof issueCurrentDexPoolPositionCapability>>;
const owner = `0x${'22'.repeat(20)}`, hash = `0x${'33'.repeat(32)}`, snapshotHash = `0x${'44'.repeat(32)}`;

describe.each(['cheap-prepared', 'cheap-exit', 'cheap-history'] as const)('%s prepared consumers', key => {
const candidate = resolveCurrentCheapDexCandidate(key);
function fixture(pairIndex = 0, wallet = owner) {
  const journal = new Map<string, string>();
  vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => journal.get(key) ?? null,
    setItem: (key: string, value: string) => journal.set(key, value), removeItem: (key: string) => journal.delete(key) } });
  const pair = readCurrentDexDisplay(candidate).pairs[pairIndex], poolTokens = pair.tokens.map(token => token.address) as [string, string];
  const position = { positionId: 52n, context: hash, producerHash: hash, poolTokens, block: { number: 10n, hash } };
  const amounts = { used0: 1_000_001n, used1: 2_000_002n, unused0: 234_566n, unused1: 345_676n, mintedShares: 5n,
    ownedShares: 15n, classId: 1n, toleranceN: 1n, toleranceD: 200n, operation: 'add' as const };
  const allowances = [0n, 0n];
  const abandon = vi.fn(async (confirm: (review: { allowances: readonly [bigint, bigint] }) => Promise<boolean>) => {
    if (!await confirm({ allowances: [...allowances] as [bigint, bigint] })) return null;
    return { status: 'unfunded-cleanup-required', cleanupRequired: allowances.map(value => value !== 0n) };
  });
  const funding = { positionId: 52n, ownerContext: hash, amounts, abandonUnfunded: abandon };
  const prepareFunding = vi.fn(async (confirm: (review: typeof amounts) => Promise<boolean>) => await confirm(amounts) ? funding : null);
  const preview = { positionId: 52n, ownerContext: hash, amounts, prepareFunding };
  const preparedPreview = { positionId: 52n, ownerContext: hash, data: 'preview' };
  const preparePoolTopUp = vi.fn(async (request: Parameters<FundingCap['preparePoolTopUp']>[0]) => {
    return await request.confirmPrivateInputs({ ...request.intent, positionId: request.positionId, ownerContext: request.ownerContext,
      classId: 1n, core: candidate.core, principal: wallet, chainId: BigInt(candidate.chainId), marketId: pair.marketId, poolTokens }) ? preparedPreview : null;
  });
  const previewRecover = vi.fn(async () => preview), fundRecover = vi.fn(async () => managed);
  const verifySnapshot = vi.fn(async () => ({ privateAccountingVerified: true, producerHash: snapshotHash }));
  const managed = { positionId: 52n, privateAccountingVerified: false, status: 'manage-verified-snapshot-required', verifySnapshot };
  const submitPreview = vi.fn(async () => ({ transactionHash: hash, recover: previewRecover }));
  const submitFunding = vi.fn(async () => ({ transactionHash: hash, recover: fundRecover }));
  const funds = () => ({ owner: wallet, graph: candidate.graph, core: candidate.core, packageSha256: candidate.packageSha256, privateFundsVerified: true,
    tokens: candidate.tokens.map(([address]) => ({ address, allowance: poolTokens.includes(address) ? allowances[poolTokens.indexOf(address)] : 0n })) });
  const prepareApproval = vi.fn(async (request: { canonicalIndex: 0 | 1; cleanup: boolean;
    confirm: (review: { amount: bigint; spender: string }) => Promise<boolean> }) => {
    const amount = request.cleanup ? 0n : request.canonicalIndex === 0 ? amounts.used0 : amounts.used1;
    return await request.confirm({ amount, spender: candidate.core }) ? { canonicalIndex: request.canonicalIndex, amount, cleanup: request.cleanup } : null;
  });
  let approvalToken = poolTokens[0];
  const approvalRecover = vi.fn(async () => ({ privateAccountingVerified: true, fundingOutcome: 'verified', token: approvalToken, funds: funds() }));
  const submitApproval = vi.fn(async (request: { canonicalIndex: 0 | 1; amount: bigint; cleanup: boolean }) => {
    approvalToken = poolTokens[request.canonicalIndex]; allowances[request.canonicalIndex] = request.amount; return { transactionHash: hash, recover: approvalRecover };
  });
  const prepareSnapshot = vi.fn(async (request: Parameters<PositionsCap['prepareSnapshot']>[0]) => {
    return await request.confirm({ positionId: 52n, closed: false, gasCap: 30_000_000n }) ? { action: 'snapshot', positionId: 52n } : null;
  });
  const snapshotRecover = vi.fn(async () => ({ positionId: 52n, action: 'snapshot', producerHash: snapshotHash, privateAccountingVerified: false }));
  const submitSnapshot = vi.fn(async () => ({ transactionHash: snapshotHash, recover: snapshotRecover }));
  const sender = { submitPoolTopUpPreview: submitPreview, submitPoolTopUpFunding: submitFunding, prepareSharedPoolApproval: prepareApproval,
    submitSharedPoolApproval: submitApproval, submitPoolPositionAction: submitSnapshot,
    recoverCurrentPreparedPoolFundingResult: vi.fn(async () => null), recoverPendingPoolAttempt: vi.fn(async () => null),
    recoverPendingSharedPoolApproval: vi.fn(async () => null), recoverPendingPoolPositionAttempt: vi.fn(async () => null) };
  const request = vi.fn(async () => ({ number: '0xb', hash }));
  const getFunding = vi.fn(async () => ({ preparePoolTopUp })), getSender = vi.fn(async () => sender), getPositions = vi.fn(async () => ({ prepareSnapshot }));
  const session = { walletAddress: wallet, chainId: Number(candidate.chainId), browserProvider: { request },
    actions: { getCurrentDexPoolFundingCapability: getFunding, getCurrentDexSubmissionCapability: getSender, getCurrentDexPoolPositionCapability: getPositions } } as unknown as SharedWalletSession;
  const props = { session, position, candidateKey: key, disabled: false, onBegin: vi.fn(), onReleased: vi.fn(), onManaged: vi.fn(), onVerified: vi.fn(async () => {}) };
  const render = () => { hooks.index = 0; hooks.refIndex = 0; return CurrentPreparedPoolTopUpWorkspace(props); };
  const button = (label: string) => elements(render()).find(node => node.element.type === 'button' && text(node.element.props.children) === label);
  const input = (label: string) => elements(render()).find(node => node.element.type === 'input' && node.element.props['aria-label'] === label)!;
  const change = (label: string, value: string) => { input(label).element.props.onChange!({ target: { value } }); render(); };
  const settle = () => vi.waitFor(() => expect(button('Check top-up status')!.disabled).toBe(false));
  const click = async (label: string) => { const node = button(label); expect(node, `Missing button: ${label}`).toBeDefined();
    expect(node!.disabled, `Disabled button: ${label}; ${text(render())}`).toBe(false); node!.element.props.onClick!(); await settle(); };
  const enter = () => { change(`${pair.tokens[0].label} top-up maximum`, '1.234567'); change(`${pair.tokens[1].label} top-up maximum`, '2.345678'); };
  const previewFlow = async () => { enter(); await click('Review top-up preview'); await click('Check top-up status'); };
  const fundingFlow = async () => { await previewFlow(); await click('Review exact top-up'); };
  const approveBoth = async () => { for (const token of pair.tokens) { await click(`Approve ${token.label} top-up amount`); await click('Check top-up status'); } };
  return { props, pair, render, button, input, change, click, enter, previewFlow, fundingFlow, approveBoth, settle, journal,
    amounts, funding, managed, preview, funds, allowances, preparePoolTopUp, prepareFunding, abandon, previewRecover, fundRecover, verifySnapshot,
    submitPreview, submitFunding, prepareApproval, submitApproval, approvalRecover, prepareSnapshot, snapshotRecover, submitSnapshot,
    getFunding, getSender, getPositions, request, sender };
}
afterEach(() => { hooks.states = []; hooks.refs = []; hooks.allowNative = false; vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('prepared Pool top-up money flow', () => {
  it('keeps the real App hold before wallet access, confirmation, preparation or send', async () => {
    const f = fixture(); f.enter(); f.change(`${f.pair.tokens[0].label} top-up maximum`, '0.5');
    f.change(`${f.pair.tokens[1].label} top-up maximum`, '0.5'); await f.click('Review top-up preview');
    if (key === 'cheap-history') expect(text(f.render())).toContain('App signing hold remains active');
    else expect(text(f.render())).toContain('native App submission admission is absent');
    for (const mock of [f.getFunding, f.getSender, f.getPositions, f.request, hooks.confirm, f.preparePoolTopUp, f.submitPreview]) expect(mock).not.toHaveBeenCalled();
  });
  it.each([0, 1, 2, 3, 4, 5])('binds pair %i six-decimal budgets, owner proof and default 0.5 percent tolerance', async index => {
    const f = fixture(index); hooks.allowNative = true;
    expect(f.input('Top-up funding tolerance').element.props.value).toBe('0.5');
    await f.previewFlow();
    expect(f.preparePoolTopUp).toHaveBeenCalledWith(expect.objectContaining({ positionId: 52n, ownerContext: hash, producerHash: hash,
      pair: f.props.position.poolTokens, intent: { budgets: [1_234_567n, 2_345_678n], tolerance: [1n, 200n] } }));
    expect(f.getFunding).toHaveBeenCalledWith(BigInt(candidate.chainId), { candidate: key });
    expect(f.getSender).toHaveBeenCalledWith(BigInt(candidate.chainId), { candidate: key });
    expect(f.props.onBegin).toHaveBeenCalledOnce(); expect(text(f.render())).toContain('preview verified');
    expect(f.submitFunding).not.toHaveBeenCalled();
  });
  if (key === 'cheap-history') it('admits an engineering owner with exact position and top-up terms before capability access', async () => {
    const authorizedOwner = CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY.owner, f = fixture(0, authorizedOwner);
    f.enter(); f.change(`${f.pair.tokens[0].label} top-up maximum`, '0.5'); f.change(`${f.pair.tokens[1].label} top-up maximum`, '0.5');
    await f.click('Review top-up preview'); await f.click('Check top-up status');
    expect(f.getSender).toHaveBeenCalledWith(BigInt(candidate.chainId), { candidate: key });
    expect(f.request).toHaveBeenCalledWith({ method: 'eth_getBlockByNumber', params: ['latest', false] });
    expect(f.getFunding).toHaveBeenCalledWith(BigInt(candidate.chainId), { candidate: key });
    expect(f.preparePoolTopUp).toHaveBeenCalledWith(expect.objectContaining({ positionId: 52n, ownerContext: hash, producerHash: hash,
      pair: f.props.position.poolTokens, intent: { budgets: [500_000n, 500_000n], tolerance: [1n, 200n] } }));
  });
  it('requires exact review, two accounted approvals, management and a separate paid snapshot', async () => {
    const f = fixture(4); hooks.allowNative = true; await f.fundingFlow();
    expect(hooks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Review exact top-up amounts', summaryRows: expect.arrayContaining([
      { label: `${f.pair.tokens[0].label} debit`, value: '1.000001' }, { label: `${f.pair.tokens[1].label} debit`, value: '2.000002' },
      { label: `${f.pair.tokens[0].label} left in wallet`, value: '0.234566' }, { label: `${f.pair.tokens[1].label} left in wallet`, value: '0.345676' }
    ]) }));
    await f.click('Submit liquidity top-up'); expect(f.submitFunding).not.toHaveBeenCalled();
    await f.approveBoth();
    expect(f.prepareApproval.mock.calls.map(([request]) => [request.canonicalIndex, request.cleanup])).toEqual([[0, false], [1, false]]);
    expect(f.submitApproval.mock.calls.map(([request]) => request.amount)).toEqual([1_000_001n, 2_000_002n]);
    await f.click('Submit liquidity top-up'); await f.click('Check top-up status');
    expect(f.props.onManaged).toHaveBeenCalledOnce(); expect(f.props.onVerified).not.toHaveBeenCalled();
    expect(f.verifySnapshot).not.toHaveBeenCalled(); expect(text(f.render())).toContain('paid snapshot');
    await f.click('Review top-up verification snapshot'); expect(f.props.onVerified).not.toHaveBeenCalled();
    await f.click('Check top-up status');
    expect(f.verifySnapshot).toHaveBeenCalledWith(snapshotHash); expect(f.props.onVerified).toHaveBeenCalledWith(snapshotHash);
    expect(f.getPositions).toHaveBeenCalledWith(BigInt(candidate.chainId), { candidate: key });
    expect(f.submitFunding).toHaveBeenCalledOnce(); expect(f.submitSnapshot).toHaveBeenCalledOnce();
  });
  it('stops before funding and clears the two remaining exact allowances', async () => {
    const f = fixture(); hooks.allowNative = true; await f.fundingFlow(); await f.approveBoth();
    await f.click('Stop unfunded top-up'); expect(f.props.onReleased).not.toHaveBeenCalled();
    expect(f.button('Submit liquidity top-up')).toBeUndefined();
    for (const token of f.pair.tokens) { await f.click(`Clear ${token.label} top-up amount`); await f.click('Check top-up status'); }
    expect(f.allowances).toEqual([0n, 0n]); expect(f.props.onReleased).toHaveBeenCalledOnce(); expect(f.submitFunding).not.toHaveBeenCalled();
    expect(f.submitApproval.mock.calls.slice(2).map(([request]) => [request.cleanup, request.amount])).toEqual([[true, 0n], [true, 0n]]);
  });
  it.each(['preview', 'exact-review'] as const)('does not send after cancelled %s confirmation', async phase => {
    const f = fixture(); hooks.allowNative = true;
    if (phase === 'exact-review') await f.previewFlow(); else f.enter();
    hooks.confirm.mockResolvedValueOnce(false);
    await f.click(phase === 'preview' ? 'Review top-up preview' : 'Review exact top-up');
    expect(f.submitFunding).not.toHaveBeenCalled(); expect(f.prepareApproval).not.toHaveBeenCalled();
    if (phase === 'preview') expect(f.submitPreview).not.toHaveBeenCalled();
  });
  it.each(['wrong-position', 'wrong-context', 'missing-private-proof'] as const)('rejects recovered preview %s', async reason => {
    const f = fixture(); hooks.allowNative = true; f.enter(); await f.click('Review top-up preview');
    if (reason === 'wrong-position') f.previewRecover.mockResolvedValue({ ...f.preview, positionId: 53n });
    if (reason === 'wrong-context') f.previewRecover.mockResolvedValue({ ...f.preview, ownerContext: snapshotHash });
    if (reason === 'missing-private-proof') f.previewRecover.mockResolvedValue({ status: 'observed-mined', privateAccountingVerified: false } as never);
    await f.click('Check top-up status'); expect(text(f.render())).toContain('proof is unavailable');
    expect(f.button('Review exact top-up')).toBeUndefined(); expect(f.submitFunding).not.toHaveBeenCalled();
  });
  it('does not accept a management result without the retained snapshot verifier', async () => {
    const f = fixture(); hooks.allowNative = true; await f.fundingFlow(); await f.approveBoth(); await f.click('Submit liquidity top-up');
    f.fundRecover.mockResolvedValue({ positionId: 52n, privateAccountingVerified: false } as never);
    await f.click('Check top-up status'); expect(text(f.render())).toContain('management proof is unavailable');
    expect(f.props.onManaged).not.toHaveBeenCalled(); expect(f.props.onVerified).not.toHaveBeenCalled(); expect(f.submitSnapshot).not.toHaveBeenCalled();
  });
  it('keeps final accounting open when separate snapshot verification rejects', async () => {
    const f = fixture(); hooks.allowNative = true; await f.fundingFlow(); await f.approveBoth(); await f.click('Submit liquidity top-up');
    await f.click('Check top-up status'); await f.click('Review top-up verification snapshot');
    f.verifySnapshot.mockRejectedValue(new Error('Snapshot shares differ from management'));
    await f.click('Check top-up status'); expect(text(f.render())).toContain('Snapshot shares differ');
    expect(f.props.onVerified).not.toHaveBeenCalled(); expect(f.submitFunding).toHaveBeenCalledOnce();
  });
  it('retries final snapshot reads without repeating snapshot recovery or sending', async () => {
    const f = fixture(); hooks.allowNative = true; await f.fundingFlow(); await f.approveBoth(); await f.click('Submit liquidity top-up');
    await f.click('Check top-up status'); await f.click('Review top-up verification snapshot');
    f.verifySnapshot.mockRejectedValueOnce(new Error('Temporary private snapshot read failure'));
    await f.click('Check top-up status'); expect(f.props.onVerified).not.toHaveBeenCalled();
    expect(f.snapshotRecover).toHaveBeenCalledOnce(); expect(f.verifySnapshot).toHaveBeenCalledOnce();
    await f.click('Check top-up status');
    expect(f.snapshotRecover).toHaveBeenCalledOnce(); expect(f.verifySnapshot).toHaveBeenCalledTimes(2);
    expect(f.submitSnapshot).toHaveBeenCalledOnce(); expect(f.submitFunding).toHaveBeenCalledOnce();
    expect(f.props.onVerified).toHaveBeenCalledWith(snapshotHash);
  });
  it('starts another preview only after an unfunded stop has no remaining allowances', async () => {
    const f = fixture(); hooks.allowNative = true; await f.fundingFlow(); await f.click('Stop unfunded top-up');
    expect(f.props.onReleased).toHaveBeenCalledOnce(); await f.click('Start another top-up');
    expect(f.button('Submit liquidity top-up')).toBeUndefined(); expect(f.input('Top-up funding tolerance').disabled).toBe(false);
    expect(f.prepareApproval).not.toHaveBeenCalled(); expect(f.submitFunding).not.toHaveBeenCalled();
    await f.click('Review top-up preview'); expect(f.submitPreview).toHaveBeenCalledTimes(2);
  });
  it.each(['wallet', 'position', 'inputs', 'candidate'] as const)('revokes a pending private result after %s changes', async reason => {
    const f = fixture(); hooks.allowNative = true; f.enter(); await f.click('Review top-up preview');
    if (reason === 'wallet') f.props.session = { ...f.props.session, walletAddress: snapshotHash.slice(0, 42) };
    if (reason === 'position') f.props.position = { ...f.props.position, positionId: 53n };
    if (reason === 'candidate') f.props.candidateKey = key === 'cheap-exit' ? 'cheap-prepared' : 'cheap-exit';
    if (reason === 'inputs') f.change('Top-up funding tolerance', '1');
    f.render(); await f.click('Check top-up status');
    expect(f.previewRecover).not.toHaveBeenCalled(); expect(f.button('Review exact top-up')).toBeUndefined(); expect(f.submitFunding).not.toHaveBeenCalled();
  });
  it('keeps an uncertain preview send pending and prevents a second send', async () => {
    const f = fixture(); hooks.allowNative = true; f.enter();
    f.submitPreview.mockImplementation(async () => { f.journal.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, '{}'); throw new Error('Unknown wallet result'); });
    await f.click('Review top-up preview');
    expect(text(f.render())).toContain('Unknown wallet result'); expect(f.submitPreview).toHaveBeenCalledOnce();
    expect(f.button('Review top-up preview')!.disabled).toBe(true); expect(f.props.onReleased).not.toHaveBeenCalled();
  });
  it.each(['token', 'unknown-allowance', 'duplicate-wallet', 'unverified'] as const)('does not unlock funding after approval %s proof failure', async reason => {
    const f = fixture(); hooks.allowNative = true; await f.fundingFlow(); await f.click(`Approve ${f.pair.tokens[0].label} top-up amount`);
    const funds = f.funds();
    if (reason === 'unknown-allowance') funds.tokens.find(token => token.address === f.props.position.poolTokens[0])!.allowance = 999n;
    if (reason === 'duplicate-wallet') funds.tokens[3] = funds.tokens[0];
    f.approvalRecover.mockResolvedValue({ privateAccountingVerified: reason !== 'unverified', fundingOutcome: 'verified',
      token: reason === 'token' ? f.props.position.poolTokens[1] : f.props.position.poolTokens[0], funds });
    await f.click('Check top-up status');
    expect(f.button('Submit liquidity top-up')!.disabled).toBe(true); expect(f.submitFunding).not.toHaveBeenCalled();
    expect(f.props.onVerified).not.toHaveBeenCalled();
  });
  it('does not keep stopped state or old allowances in another position scope', async () => {
    const f = fixture(); hooks.allowNative = true; await f.fundingFlow(); await f.approveBoth(); await f.click('Stop unfunded top-up');
    expect(f.button(`Clear ${f.pair.tokens[0].label} top-up amount`)).toBeDefined();
    f.props.position = { ...f.props.position, positionId: 53n }; f.render();
    expect(f.button(`Clear ${f.pair.tokens[0].label} top-up amount`)).toBeUndefined();
    expect(f.button('Submit liquidity top-up')).toBeUndefined(); expect(f.input('Top-up funding tolerance').disabled).toBe(false);
  });
  it('does not resend an uncertain management action', async () => {
    const f = fixture(); hooks.allowNative = true; await f.fundingFlow(); await f.approveBoth();
    f.submitFunding.mockImplementation(async () => { f.journal.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, '{}'); throw new Error('Unknown management wallet result'); });
    await f.click('Submit liquidity top-up');
    expect(f.submitFunding).toHaveBeenCalledOnce(); expect(f.button('Submit liquidity top-up')!.disabled).toBe(true);
    expect(f.submitSnapshot).not.toHaveBeenCalled(); expect(f.props.onReleased).not.toHaveBeenCalled(); expect(f.props.onVerified).not.toHaveBeenCalled();
  });
  it.each(['pool-preview', 'pool-fund', 'token-approve', 'pool-snapshot'] as const)('reloads %s as public metadata without private funding authority', async phase => {
    const f = fixture();
    f.journal.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify({ version: 1, chainId: candidate.chainId, owner,
      core: candidate.core, graph: `0x${candidate.graph}`, phase, nonce: 3, txHash: hash, callHash: hash }));
    const metadata = { status: 'observed-mined', privateAccountingVerified: false };
    f.sender.recoverPendingPoolAttempt.mockResolvedValue(metadata as never);
    f.sender.recoverPendingSharedPoolApproval.mockResolvedValue(metadata as never);
    f.sender.recoverPendingPoolPositionAttempt.mockResolvedValue(metadata as never);
    await f.click('Check top-up status');
    const expected = phase === 'token-approve' ? f.sender.recoverPendingSharedPoolApproval : phase === 'pool-snapshot' ?
      f.sender.recoverPendingPoolPositionAttempt : f.sender.recoverPendingPoolAttempt;
    expect(expected).toHaveBeenCalledOnce(); expect(text(f.render())).toContain('does not confirm private top-up accounting');
    expect(f.button('Review exact top-up')).toBeUndefined();
    for (const mock of [f.getFunding, f.prepareFunding, f.prepareApproval, f.submitFunding, f.props.onVerified]) expect(mock).not.toHaveBeenCalled();
  });
});

});
