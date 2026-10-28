import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CurrentPoolWorkspace from './CurrentPoolWorkspace';
import CurrentPoolPositionsWorkspace from './CurrentPoolPositionsWorkspace';
import CurrentLimitWorkspace from './CurrentLimitWorkspace';
import { CURRENT_CHEAP_DEX_CANDIDATE as candidate } from '../../../lib/dexV2Deployment';
import type { SharedWalletSession } from '../../../lib/walletSession';

// Retained native controls are tested with local capabilities only.
vi.mock('../../../lib/dexV2Deployment', async original => {
  const actual = await original<typeof import('../../../lib/dexV2Deployment')>();
  return { ...actual, CURRENT_CHEAP_DEX_CANDIDATE: actual.resolveCurrentCheapDexCandidate('cheap-native'),
    resolveCurrentCheapDexCandidate: (key: Parameters<typeof actual.resolveCurrentCheapDexCandidate>[0]) =>
      actual.resolveCurrentCheapDexCandidate(key === 'cheap-current' ? 'cheap-native' : key) };
});

// Capture one render's callbacks. React busy state cannot change that closure.
// This tests component dispatch only; capabilities/sends are local mocks.
const hooks = vi.hoisted(() => ({ index: 0, refIndex: 0, states: [] as unknown[], refs: [] as { current: unknown }[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.states)) hooks.states[i] = initial;
    return [hooks.states[i], (value: unknown) => { hooks.states[i] = typeof value === 'function' ? value(hooks.states[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); },
}));
vi.mock('../../trading/hooks/useTradeActionConfirmationState', () => ({ default: () => ({ confirmation: null, requestConfirmation: async () => false, resolveConfirmation: () => {} }) }));
const elements = (node: ReactNode): ReactElement<{ children?: ReactNode; disabled?: boolean; onClick?: () => void }>[] =>
  Array.isArray(node) ? node.flatMap(elements) : isValidElement<{ children?: ReactNode }>(node) ? [node, ...elements(node.props.children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
afterEach(() => { hooks.states = []; hooks.refs = []; vi.unstubAllGlobals(); });

function fixture(kind: 'pool' | 'position' | 'limit', components = {
  pool: CurrentPoolWorkspace, position: CurrentPoolPositionsWorkspace, limit: CurrentLimitWorkspace,
}) {
  const owner = `0x${'22'.repeat(20)}`;
  const position = { positionId: 9n, context: 'current-context', producerKind: 'snapshot', status: 1n,
    amounts: { classId: 0n, amount0: 100n, amount1: 200n, shares: 50n } };
  const capability = { preparePoolCreation: vi.fn(async () => null), readPosition: vi.fn(async () => position),
    prepareSnapshot: vi.fn(async () => null), prepareAction: vi.fn(async () => null),
    prepareLimit: vi.fn(async () => null), prepareOwnerAction: vi.fn(async () => ({ data: 'local' })) };
  const sender = { checkCurrentCheapCandidate: vi.fn(async () => ({ ...candidate, chainId: BigInt(candidate.chainId), owner })),
    submitPoolPreview: vi.fn(), submitPoolFunding: vi.fn(async () => ({ transactionHash: 'local', recover: vi.fn() })),
    preparePoolApproval: vi.fn(async () => null), preparePoolUnfundedCleanup: vi.fn(async () => null),
    abandonCurrentNativePoolFunding: vi.fn(async () => null), recoverCurrentNativePoolFundingResult: vi.fn(async () => null), readCurrentNativePoolResume: vi.fn(async () => null),
    recoverPendingPoolAttempt: vi.fn(async () => null), submitCurrentTokenFunding: vi.fn(),
    recoverCurrentNativePoolPositionResult: vi.fn(async () => null), recoverPendingPoolPositionAttempt: vi.fn(async () => null),
    submitPoolPositionAction: vi.fn(), submitLimit: vi.fn(),
    submitLimitOwner: vi.fn(async () => ({ transactionHash: 'local', recover: vi.fn() })), recoverPendingLimitAttempt: vi.fn(async () => null) };
  const getCapability = vi.fn(async () => capability), getSender = vi.fn(async () => sender);
  const session = { walletAddress: owner, chainId: Number(candidate.chainId), browserWalletId: 'metamask', activeSignerSource: 'browser',
    sessionOnboardInfo: { [owner]: { aesKey: 'local-fixture' } }, walletAesHealthByAddress: {},
    browserProvider: { request: vi.fn(async () => ({ number: '0x1', hash: `0x${'11'.repeat(32)}` })) },
    actions: { getCurrentDexPoolFundingCapability: getCapability, getCurrentDexPoolPositionCapability: getCapability,
      getCurrentDexLimitCapability: getCapability, getCurrentDexSubmissionCapability: getSender } } as unknown as SharedWalletSession;
  vi.stubGlobal('window', { sessionStorage: { getItem: () => null } });
  const render = () => { hooks.index = 0; hooks.refIndex = 0;
    return kind === 'pool' ? components.pool({ sharedWalletSession: session }) : kind === 'position' ?
      components.position({ sharedWalletSession: session }) : components.limit({ sharedWalletSession: session, view: 'manage' }); };
  const button = (label: string | RegExp) => elements(render()).find(element => element.type === 'button' &&
    (typeof label === 'string' ? text(element.props.children) === label : label.test(text(element.props.children))))!;
  const busyIndex = kind === 'limit' ? 4 : 5;
  const done = () => vi.waitFor(() => expect(hooks.states[busyIndex]).toBe(false));
  render();
  return { render, button, done, getSender, getCapability, sender, capability, position };
}

describe('retained native owner workspace operation serialization with local capabilities', () => {
  it.each(['Review deposit', 'Check Pool status'])('starts only one Pool operation for repeated %s callbacks', async label => {
    const f = fixture('pool'), callback = f.button(label).props.onClick!;
    callback(); callback(); await f.done(); expect(f.getSender).toHaveBeenCalledTimes(1);
  });
  it.each(['Review and fund Pool', 'Approve exact', 'Review stop and clear approvals'])('starts only one prepared Pool operation for %s', async label => {
    const f = fixture('pool');
    hooks.states[10] = { value: { prepared: 'local' }, scope: hooks.refs[0].current };
    hooks.states[11] = label === 'Review and fund Pool' ? [true, true] : [false, false]; hooks.states[19] = true;
    const callback = f.button(label === 'Approve exact' ? /^Approve exact / : label).props.onClick!;
    callback(); callback(); await f.done(); expect(f.getSender).toHaveBeenCalledTimes(1);
    if (label === 'Review and fund Pool') expect(f.sender.submitPoolFunding).toHaveBeenCalledTimes(1);
  });
  it.each(['Load private position', 'Review paid private refresh', 'Check position status'])('starts only one position operation for repeated %s', async label => {
    const f = fixture('position'); hooks.states[0] = '9';
    const callback = f.button(label).props.onClick!; callback(); callback(); await f.done();
    expect(label === 'Check position status' ? f.getSender : f.getCapability).toHaveBeenCalledTimes(1);
  });
  it('serializes close preparation and status against the same position operation', async () => {
    const f = fixture('position'); hooks.states[0] = '9'; f.button('Load private position').props.onClick!(); await f.done(); f.getCapability.mockClear();
    const close = f.button('Close and withdraw all').props.onClick!, status = f.button('Check position status').props.onClick!;
    close(); close(); status(); await f.done(); expect(f.getCapability).toHaveBeenCalledTimes(1); expect(f.getSender).not.toHaveBeenCalled();
    f.button('Check position status').props.onClick!(); await f.done(); expect(f.getSender).toHaveBeenCalledTimes(1);
  });
  it('starts only one Limit creation preparation from repeated callbacks', async () => {
    const f = fixture('limit'); hooks.states[1] = '1'; hooks.states[2] = '2';
    const callback = f.button('Review order').props.onClick!; callback(); callback(); await f.done();
    expect(f.getSender).toHaveBeenCalledTimes(1); expect(f.capability.prepareLimit).toHaveBeenCalledTimes(1);
  });
  it('starts only one private creation snapshot from repeated callbacks', async () => {
    const f = fixture('limit'), prepareSnapshot = vi.fn(async () => null);
    hooks.states[8] = { value: { positionId: 9n, prepareSnapshot }, scope: hooks.refs[0].current };
    const callback = f.button('Refresh private Limit result').props.onClick!; callback(); callback(); await f.done(); expect(prepareSnapshot).toHaveBeenCalledTimes(1);
  });
  it.each(['Load private order', 'Check Limit status'])('starts only one Limit operation for repeated %s', async label => {
    const f = fixture('limit'); hooks.states[10] = '9'; const callback = f.button(label).props.onClick!;
    callback(); callback(); await f.done(); expect(label === 'Check Limit status' ? f.getSender : f.getCapability).toHaveBeenCalledTimes(1);
  });
  it.each(['Claim Limit proceeds', 'Pause Limit', 'Close Limit and return funds'])('dispatches one owner send for repeated %s callbacks', async label => {
    const f = fixture('limit'); hooks.states[10] = '9'; f.render();
    hooks.states[11] = { value: { positionId: 9n, status: 0n, closed: false, refreshRequired: false,
      amounts: { unspent: 100n, proceeds: 7n, sellToken0: true, priceNumerator: 2n, priceDenominator: 1n, makerMinimum: 0n } },
      capability: f.capability, scope: hooks.refs[0].current };
    const callback = f.button(label).props.onClick!; callback(); callback(); await f.done();
    expect(f.capability.prepareOwnerAction).toHaveBeenCalledTimes(1); expect(f.sender.submitLimitOwner).toHaveBeenCalledTimes(1);
  });
  it.each(['pool', 'position', 'limit'] as const)('allows explicit new status checks after a failed %s operation', async kind => {
    const f = fixture(kind), label = kind === 'pool' ? 'Check Pool status' : kind === 'position' ? 'Check position status' : 'Check Limit status';
    f.getSender.mockRejectedValueOnce(new Error('Local transport failure'));
    f.button(label).props.onClick!(); await f.done(); f.button(label).props.onClick!(); await f.done();
    expect(f.getSender).toHaveBeenCalledTimes(2); expect(text(f.render())).not.toContain('Local transport failure');
    expect(text(f.render())).not.toContain('not a function');
  });
});

it.each(['pool','position','limit'] as const)('serializes actual current %s public status without native authority or sends',async kind=>{
  vi.doMock('../../../lib/dexV2Deployment',()=>vi.importActual('../../../lib/dexV2Deployment'));vi.resetModules();
  const [{default:pool},{default:position},{default:limit}]=await Promise.all([
    import('./CurrentPoolWorkspace'),import('./CurrentPoolPositionsWorkspace'),import('./CurrentLimitWorkspace'),
  ]);
  const f=fixture(kind,{pool,position,limit});
  const label=kind==='pool'?'Check Pool status':kind==='position'?'Check position status':'Check Limit status';
  const callback=f.button(label).props.onClick!;callback();callback();await f.done();
  expect(f.getSender).toHaveBeenCalledOnce();
  if(kind==='limit')expect(f.getSender).toHaveBeenCalledWith(BigInt(candidate.chainId));
  else expect(f.getSender).toHaveBeenCalledWith(BigInt(candidate.chainId),undefined);
  const metadata=kind==='pool'?f.sender.recoverPendingPoolAttempt:kind==='position'?
    f.sender.recoverPendingPoolPositionAttempt:f.sender.recoverPendingLimitAttempt;
  expect(metadata).toHaveBeenCalledOnce();expect(text(f.render())).toContain('No pending');
  expect(f.sender.recoverCurrentNativePoolFundingResult).not.toHaveBeenCalled();
  expect(f.sender.readCurrentNativePoolResume).not.toHaveBeenCalled();
  expect(f.sender.recoverCurrentNativePoolPositionResult).not.toHaveBeenCalled();
  for(const send of [f.sender.submitPoolPreview,f.sender.submitPoolFunding,f.sender.submitCurrentTokenFunding,
    f.sender.submitPoolPositionAction,f.sender.submitLimit,f.sender.submitLimitOwner])expect(send).not.toHaveBeenCalled();
});
