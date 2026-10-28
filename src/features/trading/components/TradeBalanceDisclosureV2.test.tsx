import { isValidElement, type ReactElement, type ReactNode, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TradeBalanceDisclosureV2 from './TradeBalanceDisclosureV2';
import { buildTradeCustomTokenInfoKey } from '../../../lib/appHelpers';

// Reuse the callback-level method used by the existing owner recovery tests.
const hooks = vi.hoisted(() => ({ stateIndex: 0, refIndex: 0, memoIndex: 0, effectIndex: 0, states: [] as unknown[], refs: [] as { current: unknown }[],
  memos: [] as { deps: unknown[]; value: unknown }[], effects: [] as { deps: unknown[]; cleanup?: () => void }[], scheduled: [] as (() => void)[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useCallback: <T,>(callback: T) => callback,
  useState: (initial: unknown) => { const i = hooks.stateIndex++; if (!(i in hooks.states)) hooks.states[i] = initial;
    return [hooks.states[i], (value: unknown) => { hooks.states[i] = typeof value === 'function' ? value(hooks.states[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); },
  useMemo: (factory: () => unknown, deps: unknown[]) => { const i = hooks.memoIndex++, old = hooks.memos[i];
    if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) hooks.memos[i] = { deps, value: factory() }; return hooks.memos[i].value; },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => { const i = hooks.effectIndex++, old = hooks.effects[i];
    if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) hooks.scheduled.push(() => { old?.cleanup?.(); hooks.effects[i] = { deps, cleanup: effect() }; }); }
}));
type Props = { children?: ReactNode; onClick?: () => void; onToggle?: (event: { currentTarget: { open: boolean } }) => void; disabled?: boolean };
const nodes = (value: ReactNode): ReactElement<Props>[] => Array.isArray(value) ? value.flatMap(nodes) : isValidElement<Props>(value) ? [value, ...nodes(value.props.children)] : [];
const text = (value: ReactNode): string => Array.isArray(value) ? value.map(text).join('') : isValidElement<Props>(value) ? text(value.props.children) : typeof value === 'string' ? value : '';
const owner = `0x${'11'.repeat(20)}`, peer = `0x${'22'.repeat(20)}`, token = `0x${'33'.repeat(20)}`;
const fixture = (available = true, recovery = false) => {
  const runtime = { ownerAddress: owner, available, read: vi.fn(async () => ({ id: '7', maker: owner, taker: peer, recipient: peer,
    owner, offerToken: token, privatePair: true, variant: 'private-pair', revision: '1', status: 1, availability: 'off', grant: { allowed: false, generation: '0' } })),
    pending: vi.fn(async () => recovery ? { id: 'saved', active: true, action: { orderId: '7', recipient: peer }, feeWei: '160', last: { state: 'submitted' } } : null),
    execute: vi.fn(async () => undefined), reconcile: vi.fn(async () => null), recipients: vi.fn() };
  const props = { runtime, orderId: recovery ? undefined : '7', actionInProgress: false,
    tokenInfoByKey: { [buildTradeCustomTokenInfoKey('private-erc20', token)]: { address: token, kind: 'private-erc20', symbol: 'TEST', decimals: 0, balanceWei: null, loading: false } },
    ensureTokenInfo: vi.fn(async () => undefined), confirmFunding: vi.fn(async () => undefined), runWalletFlow: async <T,>(operation: () => Promise<T>) => operation(),
    onBusyChange: vi.fn() } as unknown as ComponentProps<typeof TradeBalanceDisclosureV2>;
  const render = () => { hooks.stateIndex = hooks.refIndex = hooks.memoIndex = hooks.effectIndex = 0;
    const value = TradeBalanceDisclosureV2(props); hooks.scheduled.splice(0).forEach(effect => effect()); return value; };
  const button = (label: string) => nodes(render()).find(node => node.type === 'button' && text(node.props.children) === label);
  const open = async () => { const tree = render(); if (!recovery) { nodes(tree).find(node => node.type === 'details')!.props.onToggle!({ currentTarget: { open: true } }); render(); }
    await vi.waitFor(() => expect(runtime.pending).toHaveBeenCalled()); await Promise.resolve(); render(); };
  const idle = () => vi.waitFor(() => expect(props.onBusyChange).toHaveBeenLastCalledWith(false));
  return { props, runtime, render, open, button, idle };
};
afterEach(() => { hooks.effects.forEach(effect => effect.cleanup?.()); hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.scheduled = []; });

describe('contextual trade balance controls', () => {
  it('uses the selected trade ID, defaults off and signs only after explicit consent review', async () => {
    const f = fixture(); await f.open(); expect(f.runtime.execute).not.toHaveBeenCalled();
    expect(f.runtime.read).toHaveBeenCalledWith('7', undefined);
    f.button('Share balance')!.props.onClick!(); await f.idle();
    expect(f.props.confirmFunding).toHaveBeenCalledWith(expect.objectContaining({ requirements: [], confirmButtonLabel: 'Confirm sharing', confirmMessage: expect.stringContaining('wallet-token balances stay private') }));
    expect(f.runtime.execute).toHaveBeenCalledExactlyOnceWith({ orderId: '7', kind: 'grant', recipient: peer, allowed: true });
  });
  it('holds unqualified snapshot reads and signing without removing pending recovery', async () => {
    const f = fixture(false, true); await f.open();
    expect(f.runtime.read).not.toHaveBeenCalled(); expect(f.button('Share balance')).toBeUndefined();
    f.button('Check balance request')!.props.onClick!(); await f.idle();
    expect(f.runtime.reconcile).toHaveBeenCalledOnce(); expect(f.runtime.execute).not.toHaveBeenCalled(); expect(f.props.confirmFunding).not.toHaveBeenCalled();
  });
  it('does not sign after the selected wallet changes during confirmation', async () => {
    const f = fixture(); await f.open(); let finish!: () => void;
    vi.mocked(f.props.confirmFunding).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    f.button('Share balance')!.props.onClick!(); f.props.runtime = { ...f.props.runtime, ownerAddress: peer }; f.render(); finish(); await f.idle();
    expect(f.runtime.execute).not.toHaveBeenCalled();
  });
});
