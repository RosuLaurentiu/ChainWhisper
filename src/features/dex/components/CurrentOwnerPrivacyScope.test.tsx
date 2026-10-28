import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { CURRENT_CHEAP_DEX_CANDIDATE as candidate } from '../../../lib/dexV2Deployment';
import CurrentPoolWorkspace from './CurrentPoolWorkspace';
import CurrentPoolPositionsWorkspace from './CurrentPoolPositionsWorkspace';
import CurrentLimitWorkspace from './CurrentLimitWorkspace';
// Retained native recovery tests select their candidate before component import.
vi.mock('../../../lib/dexV2Deployment', async original => {
  const actual = await original<typeof import('../../../lib/dexV2Deployment')>();
  return { ...actual, CURRENT_CHEAP_DEX_CANDIDATE: actual.resolveCurrentCheapDexCandidate('cheap-native'),
    resolveCurrentCheapDexCandidate: (key: Parameters<typeof actual.resolveCurrentCheapDexCandidate>[0]) =>
      actual.resolveCurrentCheapDexCandidate(key === 'cheap-current' ? 'cheap-native' : key) };
});

const hooks = vi.hoisted(() => ({ index: 0, refIndex: 0, states: [] as unknown[], refs: [] as { current: unknown }[] }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  return { ...actual,
    useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.states)) hooks.states[i] = initial;
      return [hooks.states[i], (value: unknown) => { hooks.states[i] = value; }]; },
    useRef: (initial: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); }
  };
});
vi.mock('../../trading/hooks/useTradeActionConfirmationState', () => ({ default: () => ({ confirmation: null, requestConfirmation: async () => true, resolveConfirmation: () => {} }) }));

type Panel = 'pool' | 'position' | 'limit';
type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void; 'aria-label'?: string }>;
const elements = (node: ReactNode): Element[] => Array.isArray(node) ? node.flatMap(elements) : isValidElement<Element['props']>(node) ? [node, ...elements(node.props.children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const owner = `0x${'22'.repeat(20)}`;
const labels = { pool: 'PRIVATE PREVIEW', position: 'Private shares', limit: 'Private price' };

function fixture(panel: Panel, components = { pool: CurrentPoolWorkspace, position: CurrentPoolPositionsWorkspace }) {
  const records = new Map<string, string>();
  vi.stubGlobal('window', { sessionStorage: { getItem: (k: string) => records.get(k) ?? null, setItem: (k: string, value: string) => records.set(k, value), removeItem: (k: string) => records.delete(k) } });
  const preview = { amounts: { operation: 'add', used0: 2n * 10n ** 18n, used1: 3n * 10n ** 18n, unused0: 0n, unused1: 0n,
    mintedShares: 10n, ownedShares: 10n, toleranceN: 1n, toleranceD: 200n }, prepareFunding: vi.fn() };
  const position = { positionId: 9n, context: 'local-owner', status: 1n, producerKind: 'snapshot', amounts: { classId: 0n, amount0: 2n * 10n ** 18n, amount1: 3n * 10n ** 18n, shares: 10n } };
  const limit = { positionId: 9n, context: 'local-owner', status: 0n, closed: false, refreshRequired: false,
    amounts: { unspent: 2n * 10n ** 18n, proceeds: 3n * 10n ** 18n, sellToken0: true, priceNumerator: 3n, priceDenominator: 1n, makerMinimum: 1n } };
  let deferred: Promise<unknown> | undefined, release: (value: unknown) => void = () => {};
  const read = vi.fn(async () => deferred ?? (panel === 'pool' ? preview : panel === 'position' ? position : limit));
  const prepareOwnerAction = vi.fn(async () => ({ prepared: true }));
  const submitLimitOwner = vi.fn(async () => ({ transactionHash: `0x${'11'.repeat(32)}`, recover: read }));
  const sender = { recoverCurrentNativePoolFundingResult: read, recoverCurrentNativePoolPositionResult: vi.fn(async () => null),
    recoverPendingPoolAttempt: vi.fn(async () => ({ status: 'observed-mined', privateAccountingVerified: false, readyToSign: false })),
    recoverPendingPoolPositionAttempt: vi.fn(async () => ({ status: 'observed-mined', privateAccountingVerified: false, readyToSign: false })),
    submitLimitOwner, recoverPendingLimitAttempt: vi.fn(async () => null) };
  const session = { walletAddress: owner, chainId: Number(candidate.chainId), browserProvider: { request: vi.fn() },
    activeSignerSource: 'browser', browserWalletId: 'metamask', sessionOnboardInfo: { [owner]: { aesKey: 'local-fixture-only' } }, walletAesHealthByAddress: {},
    actions: { getCurrentDexSubmissionCapability: vi.fn(async () => sender), getCurrentDexPoolFundingCapability: vi.fn(),
      getCurrentDexPoolPositionCapability: vi.fn(async () => ({ readPosition: read })), getCurrentDexLimitCapability: vi.fn(async () => ({ prepareOwnerAction })) }
  } as unknown as SharedWalletSession;
  const render = () => { hooks.index = 0; hooks.refIndex = 0;
    return panel === 'pool' ? components.pool({ sharedWalletSession: session }) : panel === 'position' ? components.position({ sharedWalletSession: session }) : CurrentLimitWorkspace({ sharedWalletSession: session, view: 'manage' }); };
  const button = (label: string) => elements(render()).find(e => e.type === 'button' && text(e.props.children) === label)!;
  const idle = async () => { await vi.waitFor(() => expect(hooks.states[panel === 'limit' ? 4 : 5]).toBe(false)); };
  const click = async (label: string) => { button(label).props.onClick!(); await idle(); };
  render();
  if (panel !== 'pool') {
    const label = panel === 'position' ? 'Liquidity NFT ID' : 'Limit owner NFT ID';
    const input = elements(render()).find(e => e.type === 'input' && e.props['aria-label'] === label)!;
    input.props.onChange!({ target: { value: '9' } }); render();
  }
  const start = async () => {
    if (panel === 'limit') { await click('Load private order'); button('Check Limit status').props.onClick!(); }
    else button(panel === 'pool' ? 'Check Pool status' : 'Load private position').props.onClick!();
  };
  const load = async () => { await start(); await idle(); };
  return { session, sender, button, render, load, start, idle, read, submitLimitOwner,
    delay: () => { deferred = new Promise(resolve => { release = resolve; }); },
    finish: () => { release(panel === 'pool' ? preview : panel === 'position' ? position : limit); deferred = undefined; } };
}
const rotate = (session: SharedWalletSession, change: 'onboard' | 'health' | 'lock') => {
  if (change === 'onboard') session.sessionOnboardInfo = { ...session.sessionOnboardInfo };
  if (change === 'health') session.walletAesHealthByAddress = { ...session.walletAesHealthByAddress };
  if (change === 'lock') delete session.sessionOnboardInfo![owner];
};
afterEach(() => { hooks.states = []; hooks.refs = []; vi.unstubAllGlobals(); });

describe.each(['pool', 'position', 'limit'] as const)('retained native %s owner private session', panel => {
  it('retains the verified display during an unchanged session render', async () => {
    const f = fixture(panel); await f.load(); expect(text(f.render())).toContain(labels[panel]);
    expect(text(f.render())).toContain(labels[panel]); expect(f.read).toHaveBeenCalledOnce();
  });
  it.each(['onboard', 'health', 'lock'] as const)('hides cached private data after %s changes', async change => {
    const f = fixture(panel); await f.load(); expect(text(f.render())).toContain(labels[panel]);
    rotate(f.session, change); expect(text(f.render())).not.toContain(labels[panel]);
    if (change !== 'lock') { await f.load(); expect(text(f.render())).toContain(labels[panel]); }
  });
  it.each(['onboard', 'health'] as const)('rejects a late private result after %s changes', async change => {
    const f = fixture(panel); f.delay(); await f.start(); await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce());
    rotate(f.session, change); f.render(); f.finish(); await f.idle();
    expect(text(f.render())).not.toContain(labels[panel]);
    expect(text(f.render())).toMatch(/session changed|Refresh this position/);
  });
});

it.each(['pool', 'position'] as const)('actual current %s public metadata grants no private owner display', async panel => {
  vi.doMock('../../../lib/dexV2Deployment', () => vi.importActual('../../../lib/dexV2Deployment')); vi.resetModules();
  const [pool, position] = await Promise.all([import('./CurrentPoolWorkspace'), import('./CurrentPoolPositionsWorkspace')]);
  const f = fixture(panel, { pool: pool.default, position: position.default });
  f.button(panel === 'pool' ? 'Check Pool status' : 'Check position status').props.onClick!(); await f.idle();
  expect(f.sender.recoverPendingPoolAttempt).toHaveBeenCalledTimes(panel === 'pool' ? 1 : 0); expect(f.sender.recoverPendingPoolPositionAttempt).toHaveBeenCalledTimes(panel === 'position' ? 1 : 0);
  expect(f.sender.recoverCurrentNativePoolFundingResult).not.toHaveBeenCalled(); expect(f.sender.recoverCurrentNativePoolPositionResult).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
  expect(text(f.render())).not.toContain(labels[panel]); expect(f.submitLimitOwner).not.toHaveBeenCalled();
  expect(text(f.render())).toMatch(/no authenticated private result|No private payout is confirmed/);
});
