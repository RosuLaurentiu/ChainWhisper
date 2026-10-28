import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CurrentPoolWorkspace from './CurrentPoolWorkspace';
import CurrentPoolPositionsWorkspace from './CurrentPoolPositionsWorkspace';
import CurrentLimitWorkspace from './CurrentLimitWorkspace';
import { CURRENT_CHEAP_DEX_CANDIDATE as candidate } from '../../../lib/dexV2Deployment';
import type { SharedWalletSession } from '../../../lib/walletSession';
// Retained native recovery tests select their candidate before component import.
vi.mock('../../../lib/dexV2Deployment', async original => {
  const actual = await original<typeof import('../../../lib/dexV2Deployment')>();
  return { ...actual, CURRENT_CHEAP_DEX_CANDIDATE: actual.resolveCurrentCheapDexCandidate('cheap-native'),
    resolveCurrentCheapDexCandidate: (key: Parameters<typeof actual.resolveCurrentCheapDexCandidate>[0]) =>
      actual.resolveCurrentCheapDexCandidate(key === 'cheap-current' ? 'cheap-native' : key) };
});
const hooks = vi.hoisted(() => ({ index: 0, refIndex: 0, states: [] as unknown[], refs: [] as { current: unknown }[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = value; }]; },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; return hooks.refs[index] ?? (hooks.refs[index] = { current: initial }); },
}));
vi.mock('../../trading/hooks/useTradeActionConfirmationState', () => ({ default: () => ({ confirmation: null, requestConfirmation: async () => true, resolveConfirmation: () => {} }) }));
type Panel = 'pool' | 'position' | 'limit';
type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean; role?: string }>;
const elements = (node: ReactNode): Element[] => Array.isArray(node) ? node.flatMap(elements) : isValidElement<Element['props']>(node) ? [node, ...elements(node.props.children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const owner = `0x${'22'.repeat(20)}`;
const errorText = 'Original owner status rejected: exact accounting must be reconciled.';
const changes = ['owner', 'chain', 'provider', 'onboard', 'health', 'lock', 'wallet', 'source'] as const;
function fixture(panel: Panel, components = { pool: CurrentPoolWorkspace, position: CurrentPoolPositionsWorkspace }, publicRecovery = false) {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => storage.get(key) ?? null } });
  let reject: (error: Error) => void = () => {};
  const deferred = new Promise<never>((_, fail) => { reject = fail; });
  const pendingRead = vi.fn(async () => deferred);
  const sender = { recoverCurrentNativePoolFundingResult: publicRecovery ? vi.fn(async () => null) : pendingRead,
    recoverCurrentNativePoolPositionResult: publicRecovery ? vi.fn(async () => null) : pendingRead,
    recoverPendingLimitAttempt: pendingRead, recoverPendingPoolAttempt: publicRecovery ? pendingRead : vi.fn(async () => null),
    recoverPendingPoolPositionAttempt: publicRecovery ? pendingRead : vi.fn(async () => null) };
  const session = { walletAddress: owner, chainId: Number(candidate.chainId), browserProvider: { request: vi.fn() },
    browserWalletId: 'metamask', activeSignerSource: 'browser', sessionOnboardInfo: { [owner]: { aesKey: 'fixture-only' } }, walletAesHealthByAddress: {},
    actions: { getCurrentDexSubmissionCapability: vi.fn(async () => sender), getCurrentDexPoolFundingCapability: vi.fn(), getCurrentDexPoolPositionCapability: vi.fn(), getCurrentDexLimitCapability: vi.fn() },
  } as unknown as SharedWalletSession;
  const render = () => { hooks.index = 0; hooks.refIndex = 0;
    return panel === 'pool' ? components.pool({ sharedWalletSession: session }) : panel === 'position' ? components.position({ sharedWalletSession: session }) : CurrentLimitWorkspace({ sharedWalletSession: session, view: 'manage' }); };
  const button = (label: string) => elements(render()).find(node => node.type === 'button' && text(node.props.children) === label)!;
  const status = () => text(elements(render()).find(node => node.props.role === 'status')!.props.children);
  const statusLabel = panel === 'pool' ? 'Check Pool status' : panel === 'position' ? 'Check position status' : 'Check Limit status';
  const start = async () => { button(statusLabel).props.onClick!(); await vi.waitFor(() => expect(pendingRead).toHaveBeenCalledOnce()); };
  const finish = async () => { reject(new Error(errorText)); await vi.waitFor(() => expect(button(statusLabel).props.disabled).toBe(false)); };
  const change = (kind: typeof changes[number]) => {
    if (kind === 'owner') session.walletAddress = `0x${'33'.repeat(20)}`;
    if (kind === 'chain') session.chainId = 1;
    if (kind === 'provider') session.browserProvider = { request: vi.fn() };
    if (kind === 'onboard') session.sessionOnboardInfo = { ...session.sessionOnboardInfo };
    if (kind === 'health') session.walletAesHealthByAddress = { ...session.walletAesHealthByAddress };
    if (kind === 'lock') delete session.sessionOnboardInfo![owner];
    if (kind === 'wallet') session.browserWalletId = 'ciphertrade';
    if (kind === 'source') session.activeSignerSource = 'walletconnect' as SharedWalletSession['activeSignerSource'];
    render();
  };
  return { session, sender, render, status, start, finish, change, pendingRead, button, statusLabel, reject,
    idle: async () => { await vi.waitFor(() => expect(hooks.states[panel === 'limit' ? 4 : 5]).toBe(false)); } };
}
afterEach(() => { hooks.states = []; hooks.refs = []; vi.unstubAllGlobals(); });
describe.each(['pool', 'position', 'limit'] as const)('retained native %s error session', panel => {
  it('retains the exact failure and recovery control for an unchanged session', async () => {
    const f = fixture(panel); await f.start(); await f.finish(); expect(f.status()).toBe(errorText);
    expect(f.button(f.statusLabel).props.disabled).toBe(false);
  });
  it.each(changes)('does not show a late prior-session failure after %s changes', async change => {
    const f = fixture(panel); await f.start(); f.change(change); f.reject(new Error(errorText)); await f.idle();
    expect(f.status()).not.toContain(errorText); expect(f.pendingRead).toHaveBeenCalledOnce();
    expect(f.status()).toMatch(/session changed|Refresh this position/);
  });
  it.each(['onboard', 'health', 'lock'] as const)('hides a cached prior-session failure after %s changes', async change => {
    const f = fixture(panel); await f.start(); await f.finish(); expect(f.status()).toBe(errorText);
    f.change(change); expect(f.status()).not.toContain(errorText);
  });
});

it.each(['pool', 'position'] as const)('keeps actual current %s public recovery failures scoped without native recovery', async panel => {
  vi.doMock('../../../lib/dexV2Deployment', () => vi.importActual('../../../lib/dexV2Deployment')); vi.resetModules();
  const [pool, position] = await Promise.all([import('./CurrentPoolWorkspace'), import('./CurrentPoolPositionsWorkspace')]);
  const f = fixture(panel, { pool: pool.default, position: position.default }, true);
  await f.start(); await f.finish(); expect(f.status()).toBe(errorText);
  expect(f.session.actions!.getCurrentDexSubmissionCapability).toHaveBeenCalledWith(BigInt(candidate.chainId), undefined);
  expect(f.sender.recoverCurrentNativePoolFundingResult).not.toHaveBeenCalled(); expect(f.sender.recoverCurrentNativePoolPositionResult).not.toHaveBeenCalled();
  expect(f.pendingRead).toHaveBeenCalledOnce(); f.change('health'); expect(f.status()).not.toContain(errorText);
});
