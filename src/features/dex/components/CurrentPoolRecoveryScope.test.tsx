import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CurrentPoolWorkspace from './CurrentPoolWorkspace';
import { CURRENT_CHEAP_DEX_CANDIDATE as candidate } from '../../../lib/dexV2Deployment';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY } from '../../../lib/currentDexPendingAttempt';
import type { SharedWalletSession } from '../../../lib/walletSession';
// Retained native recovery tests select their candidate before component import.
vi.mock('../../../lib/dexV2Deployment', async original => {
  const actual = await original<typeof import('../../../lib/dexV2Deployment')>();
  return { ...actual, CURRENT_CHEAP_DEX_CANDIDATE: actual.resolveCurrentCheapDexCandidate('cheap-native'),
    resolveCurrentCheapDexCandidate: (key: Parameters<typeof actual.resolveCurrentCheapDexCandidate>[0]) => actual.resolveCurrentCheapDexCandidate(key === 'cheap-current' ? 'cheap-native' : key) };
});
const hooks = vi.hoisted(() => ({ index: 0, refIndex: 0, states: [] as unknown[], refs: [] as { current: unknown }[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = typeof value === 'function' ? value(hooks.states[index]) : value; }]; },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; return hooks.refs[index] ?? (hooks.refs[index] = { current: initial }); },
}));
vi.mock('../../trading/hooks/useTradeActionConfirmationState', () => ({ default: () => ({ confirmation: null, requestConfirmation: async () => true, resolveConfirmation: () => {} }) }));
type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; onClick?: () => void }>;
const elements = (node: ReactNode): Element[] => Array.isArray(node) ? node.flatMap(elements) : isValidElement<Element['props']>(node) ? [node, ...elements(node.props.children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const owner = `0x${'22'.repeat(20)}`;
const changes = ['owner', 'provider', 'onboard', 'health'] as const;
const resume = (positionId: bigint) => ({ positionId, producerHash: `0x${'44'.repeat(32)}`, approvals: [false, false], unfundedFailed: false, completed: false, unfundedAbandonEligible: false });
function fixture(Workspace = CurrentPoolWorkspace) {
  const records = new Map<string, string>();
  const writes = vi.fn();
  vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => records.get(key) ?? null,
    setItem: writes, removeItem: writes } });
  const makeSender = () => ({ recoverCurrentNativePoolFundingResult: vi.fn(async () => null as unknown),
    recoverCurrentNativePoolTokenResult: vi.fn(async () => null), readCurrentNativePoolResume: vi.fn(async () => null as unknown),
    recoverPendingPoolAttempt: vi.fn(async () => null as unknown), recoverPendingCurrentTokenFunding: vi.fn(async () => null as unknown) });
  const first = makeSender(), next = makeSender(); let selected = first;
  const getSender = vi.fn(async () => selected);
  const session = { walletAddress: owner, chainId: Number(candidate.chainId), browserProvider: { request: vi.fn() },
    browserWalletId: 'metamask', activeSignerSource: 'metamask', sessionOnboardInfo: { [owner]: { aesKey: 'fixture-only' } }, walletAesHealthByAddress: {},
    actions: { getCurrentDexSubmissionCapability: getSender, getCurrentDexPoolFundingCapability: vi.fn() },
  } as unknown as SharedWalletSession;
  const render = () => { hooks.index = 0; hooks.refIndex = 0; return Workspace({ sharedWalletSession: session }); };
  const button = (label: string) => elements(render()).find(node => node.type === 'button' && text(node.props.children) === label)!;
  const idle = async () => { await vi.waitFor(() => expect(hooks.states[5]).toBe(false)); };
  const check = async () => { button('Check Pool status').props.onClick!(); await idle(); };
  const change = (kind: typeof changes[number]) => {
    selected = next;
    if (kind === 'owner') { session.walletAddress = `0x${'33'.repeat(20)}`; session.sessionOnboardInfo = { [session.walletAddress]: { aesKey: 'fixture-next' } } as SharedWalletSession['sessionOnboardInfo']; }
    if (kind === 'provider') session.browserProvider = { request: vi.fn() };
    if (kind === 'onboard') session.sessionOnboardInfo = { ...session.sessionOnboardInfo };
    if (kind === 'health') session.walletAesHealthByAddress = { ...session.walletAesHealthByAddress };
    render();
  };
  const journal = (phase: 'pool-preview' | 'token-approve') => {
    const value = JSON.stringify({ version: 1, chainId: candidate.chainId, owner: session.walletAddress.toLowerCase(), core: candidate.core,
      graph: `0x${candidate.graph}`, phase, callHash: `0x${'11'.repeat(32)}`, nonce: 9, txHash: null, verificationBlocked: true });
    records.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, value); return value;
  };
  render(); return { session, first, next, getSender, render, button, check, idle, change, records, writes, journal };
}
afterEach(() => { hooks.states = []; hooks.refs = []; vi.unstubAllGlobals(); });
describe('retained native Pool recovery session cache', () => {
  it('reuses the existing sender for unchanged-session status checks', async () => {
    const f = fixture(); await f.check(); await f.check(); expect(f.getSender).toHaveBeenCalledOnce();
    expect(f.first.recoverPendingPoolAttempt).toHaveBeenCalledTimes(2); expect(f.next.recoverPendingPoolAttempt).not.toHaveBeenCalled();
  });
  it.each(changes)('uses the current issuer after %s changes', async change => {
    const f = fixture(); await f.check(); f.change(change); await f.check();
    expect(f.getSender).toHaveBeenCalledTimes(2); expect(f.first.recoverPendingPoolAttempt).toHaveBeenCalledOnce();
    expect(f.next.recoverPendingPoolAttempt).toHaveBeenCalledOnce(); expect(f.writes).not.toHaveBeenCalled();
  });
  it.each(changes)('hides the prior funded NFT after %s changes and restores only a fresh authenticated ID', async change => {
    const f = fixture(); f.first.readCurrentNativePoolResume.mockResolvedValue(resume(19n)); await f.check();
    expect(text(f.render())).toContain('Verified position NFT ID: 19.'); f.change(change);
    expect(text(f.render())).not.toContain('Verified position NFT ID: 19.'); await f.check();
    expect(text(f.render())).not.toContain('Verified position NFT ID: 19.');
    f.next.readCurrentNativePoolResume.mockResolvedValue(resume(20n)); await f.check();
    expect(text(f.render())).toContain('Verified position NFT ID: 20.'); expect(f.writes).not.toHaveBeenCalled();
  });
  it.each(['pool-preview', 'token-approve'] as const)('skips an old callback and follows the current %s journal without changing it', async phase => {
    const f = fixture(); await f.check(); const oldRecover = vi.fn(async () => null);
    hooks.states[13] = { phase: phase === 'pool-preview' ? 'approval-0' : 'preview', scope: hooks.refs[0].current, recover: oldRecover };
    f.change('onboard'); const before = f.journal(phase);
    const pending = { status: 'manual-reconciliation-required', readyToSign: false };
    f.next.recoverPendingPoolAttempt.mockResolvedValue(pending); f.next.recoverPendingCurrentTokenFunding.mockResolvedValue(pending);
    await f.check(); expect(oldRecover).not.toHaveBeenCalled();
    expect(f.next.recoverPendingPoolAttempt).toHaveBeenCalledTimes(phase === 'pool-preview' ? 1 : 0);
    expect(f.next.recoverPendingCurrentTokenFunding).toHaveBeenCalledTimes(phase === 'token-approve' ? 1 : 0);
    expect(f.records.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(before); expect(f.writes).not.toHaveBeenCalled();
    expect(f.button('Review deposit').props.disabled).toBe(true); expect(f.button('Check Pool status').props.disabled).toBe(false);
  });
  it('keeps current-session private pending recovery ahead of metadata', async () => {
    const f = fixture(), recover = vi.fn(async () => ({ positionId: 19n }));
    hooks.states[13] = { phase: 'fund', scope: hooks.refs[0].current, recover };
    await f.check(); expect(recover).toHaveBeenCalledOnce(); expect(f.getSender).not.toHaveBeenCalled();
    expect(text(f.render())).toContain('Verified position NFT ID: 19.'); expect(f.writes).not.toHaveBeenCalled();
  });
  it('rejects a sender issued after its initiating session changed before any recovery call', async () => {
    const f = fixture(); let release: (value: typeof f.first) => void = () => {};
    f.getSender.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    f.button('Check Pool status').props.onClick!(); await vi.waitFor(() => expect(f.getSender).toHaveBeenCalledOnce());
    f.change('health'); release(f.first); await f.idle();
    expect(f.first.recoverCurrentNativePoolFundingResult).not.toHaveBeenCalled(); expect(f.first.readCurrentNativePoolResume).not.toHaveBeenCalled();
    expect(f.writes).not.toHaveBeenCalled(); await f.check(); expect(f.next.recoverPendingPoolAttempt).toHaveBeenCalledOnce();
  });
});

it('actual current public recovery grants no private preview, NFT or native profile', async () => {
  vi.doMock('../../../lib/dexV2Deployment', () => vi.importActual('../../../lib/dexV2Deployment')); vi.resetModules();
  const actual = await vi.importActual<typeof import('../../../lib/dexV2Deployment')>('../../../lib/dexV2Deployment');
  expect(actual.CURRENT_CHEAP_DEX_CANDIDATE.graph).toBe(actual.resolveCurrentCheapDexCandidate('cheap-d06').graph);
  expect(vi.isMockFunction(actual.assertCurrentCheapDexNativeAdmission)).toBe(false);
  expect(() => actual.assertCurrentCheapDexNativeAdmission(actual.CURRENT_CHEAP_DEX_CANDIDATE)).toThrow('native App submission admission');
  const { default: Workspace } = await import('./CurrentPoolWorkspace'); const f = fixture(Workspace);
  f.first.readCurrentNativePoolResume.mockResolvedValue(resume(19n));
  f.first.recoverPendingPoolAttempt.mockResolvedValue({ status: 'observed-mined', privateAccountingVerified: false, readyToSign: false });
  await f.check(); expect(f.first.recoverPendingPoolAttempt).toHaveBeenCalledOnce();
  expect(f.first.readCurrentNativePoolResume).not.toHaveBeenCalled(); expect(f.first.recoverCurrentNativePoolFundingResult).not.toHaveBeenCalled(); expect(f.first.recoverCurrentNativePoolTokenResult).not.toHaveBeenCalled();
  expect(f.getSender).toHaveBeenCalledWith(BigInt(candidate.chainId), undefined);
  expect(text(f.render())).toContain('no funding or NFT amount is confirmed'); expect(text(f.render())).not.toContain('PRIVATE PREVIEW'); expect(text(f.render())).not.toContain('Verified position NFT ID:'); expect(f.writes).not.toHaveBeenCalled();
});
