import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PrivateBookV2RecoveryPanel from './PrivateBookV2RecoveryPanel';

// Same callback-level component test method as the existing owner operation tests.
// Chain, review and wallet-flow boundaries are local mocks; no browser or RPC runs.
const hooks = vi.hoisted(() => ({ index: 0, refIndex: 0, memoIndex: 0, effectIndex: 0,
  states: [] as unknown[], refs: [] as { current: unknown }[],
  memos: [] as { deps: unknown[]; value: unknown }[],
  effects: [] as { deps: unknown[]; cleanup?: () => void }[], scheduled: [] as (() => void)[] }));
const review = vi.hoisted(() => ({ build: vi.fn(), execute: vi.fn() }));
vi.mock('../../../lib/privateBookV2Review', () => ({ buildPrivateBookV2Review: review.build, executePrivateBookV2Review: review.execute }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.states)) hooks.states[i] = initial;
    return [hooks.states[i], (value: unknown) => { hooks.states[i] = typeof value === 'function' ? value(hooks.states[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); },
  useMemo: (factory: () => unknown, deps: unknown[]) => { const i = hooks.memoIndex++, old = hooks.memos[i];
    if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) hooks.memos[i] = { deps, value: factory() };
    return hooks.memos[i].value; },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const i = hooks.effectIndex++, old = hooks.effects[i];
    if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) hooks.scheduled.push(() => {
      old?.cleanup?.(); hooks.effects[i] = { deps, cleanup: effect() };
    });
  }
}));
type NodeProps = { children?: ReactNode; disabled?: boolean; onClick?: () => void; role?: string };
const nodes = (node: ReactNode): ReactElement<NodeProps>[] => Array.isArray(node) ? node.flatMap(nodes)
  : isValidElement<NodeProps>(node) ? [node, ...nodes(node.props.children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('')
  : isValidElement<NodeProps>(node) ? text(node.props.children) : typeof node === 'string' ? node : '';
const owner = `0x${'11'.repeat(20)}`;
const fixture = (state: 'submitted' | 'confirmed' | 'unsent' | 'rejected' | 'failed' = 'submitted', privateOffer = true) => {
  const status = { id: 'saved-book', active: true, scope: { owner }, book: { kind: 'create', approvalToken: `0x${'22'.repeat(20)}`, approvalPrivate: privateOffer }, feeWei: '0',
    records: state === 'unsent' ? [] : [{ step: 'approval', state }] };
  const book = { readRecovery: vi.fn(async () => status as never), reconcile: vi.fn(async () => null as unknown),
    readPreparedAction: vi.fn(async () => ({ kind: 'create', offerAsset: { assetType: 'native', amount: '10' },
      requestAsset: { assetType: 'private-erc20', token: `0x${'22'.repeat(20)}` }, priceTerms: { offerAmount: '1', requestAmount: '2' }, expiresAt: '0' })),
    cleanupPreparation: vi.fn(async () => undefined), discardPreparation: vi.fn(async () => undefined), execute: vi.fn(async () => ({ transactionHash: 'local-confirmed' })), read: vi.fn() };
  const runtime = { privateBook: book, isCurrent: () => true };
  const props: ComponentProps<typeof PrivateBookV2RecoveryPanel> = {
    runtime: runtime as never, ownerAddress: owner, privacyUnlocked: false, actionInProgress: false, tokenInfoByKey: {},
    ensureTokenInfo: vi.fn(async () => ({ symbol: 'TEST', decimals: 0 })), confirmFunding: vi.fn(async () => undefined),
    runWalletFlow: vi.fn(async operation => operation()), onBusyChange: vi.fn(), onConfirmed: vi.fn()
  };
  const render = () => {
    hooks.index = 0; hooks.refIndex = 0; hooks.memoIndex = 0; hooks.effectIndex = 0;
    const tree = PrivateBookV2RecoveryPanel(props);
    hooks.scheduled.splice(0).forEach(effect => effect()); return tree;
  };
  const load = async () => { render(); await vi.waitFor(() => expect(book.readRecovery).toHaveBeenCalled()); await Promise.resolve(); return render(); };
  const button = (label: string) => nodes(render()).find(node => node.type === 'button' && text(node.props.children) === label)!;
  const idle = () => vi.waitFor(() => expect(props.onBusyChange).toHaveBeenLastCalledWith(false));
  return { props, runtime, book, status, render, load, button, idle };
};
afterEach(() => {
  hooks.effects.forEach(effect => effect.cleanup?.());
  hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.scheduled = []; vi.clearAllMocks();
});

describe('Book recovery owner controls with local runtime mocks', () => {
  it.each(['rejected', 'failed'] as const)('offers a fresh explicit review only for a definite %s cleanup', async state => {
    const f = fixture(state, false); f.status.records[0].step = 'cleanup';
    if (state === 'failed') Object.assign(f.status.records[0], { mined: { outcome: 'reverted' } });
    f.status.records.unshift({ step: 'approval', state: 'confirmed' }); await f.load();
    expect(f.book.cleanupPreparation).not.toHaveBeenCalled();
    f.button('Retry removing approval').props.onClick!(); await f.idle();
    expect(f.props.confirmFunding).toHaveBeenCalledOnce(); expect(f.book.cleanupPreparation).toHaveBeenCalledExactlyOnceWith('saved-book');
    expect(f.book.execute).not.toHaveBeenCalled();
  });
  it('does not expose a retry or continuation for an uncertain cleanup', async () => {
    const f = fixture('submitted', false); f.status.records[0].step = 'cleanup'; await f.load();
    expect(f.button('Retry removing approval')).toBeUndefined(); expect(f.button('Continue trade')).toBeUndefined();
    expect(f.book.cleanupPreparation).not.toHaveBeenCalled();
  });
  it('does not offer retry for a cleanup replaced by an unknown action', async () => {
    const f = fixture('failed', false); f.status.records[0].step = 'cleanup';
    Object.assign(f.status.records[0], { mined: { outcome: 'replaced' } });
    f.status.records.unshift({ step: 'approval', state: 'confirmed' }); await f.load();
    expect(f.button('Retry removing approval')).toBeUndefined(); expect(f.book.cleanupPreparation).not.toHaveBeenCalled();
  });
  it('keeps a cleanup-only preparation out of funding continuation', async () => {
    const f = fixture('confirmed', false); Object.assign(f.status, { cleanupOnly: true }); await f.load();
    expect(f.button('Continue trade')).toBeUndefined(); expect(f.button('Remove unused approval')).toBeDefined();
  });
  it('reviews public approval cleanup without funding or decrypting terms', async () => {
    const f = fixture('confirmed', false); await f.load();
    expect(f.book.cleanupPreparation).not.toHaveBeenCalled();
    f.button('Remove unused approval').props.onClick!(); await f.idle();
    expect(f.props.confirmFunding).toHaveBeenCalledWith(expect.objectContaining({ requirements: [],
      confirmButtonLabel: 'Remove approval', confirmMessage: expect.stringContaining('No tokens move') }));
    expect(f.book.cleanupPreparation).toHaveBeenCalledExactlyOnceWith('saved-book');
    expect(f.book.readPreparedAction).not.toHaveBeenCalled(); expect(f.book.execute).not.toHaveBeenCalled();
  });
  it('does not clean after the wallet changes during explicit confirmation', async () => {
    const f = fixture('confirmed', false); await f.load();
    let finish!: () => void;
    vi.mocked(f.props.confirmFunding).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.button('Remove unused approval').props.onClick!();
    f.props.ownerAddress = `0x${'33'.repeat(20)}`; f.render(); finish(); await f.idle();
    expect(f.book.cleanupPreparation).not.toHaveBeenCalled();
  });
  it('holds private cleanup and private cleanup reconciliation while privacy is locked', async () => {
    const f = fixture('confirmed'); await f.load();
    expect(f.button('Remove unused approval').props.disabled).toBe(true);
    f.button('Remove unused approval').props.onClick!(); expect(f.props.confirmFunding).not.toHaveBeenCalled();
    f.status.records[0].step = 'cleanup'; f.status.records[0].state = 'submitted';
    expect(f.button('Check status').props.disabled).toBe(true);
    f.button('Check status').props.onClick!(); expect(f.book.reconcile).not.toHaveBeenCalled();
    expect(text(f.render())).toContain('Unlock privacy to remove or check');
  });
  it('checks an unresolved send without unlocking privacy, signing or executing again', async () => {
    const f = fixture(); await f.load();
    expect(f.button('Continue trade')).toBeUndefined();
    const click = f.button('Check status').props.onClick!; click(); click(); await f.idle();
    expect(f.book.reconcile).toHaveBeenCalledExactlyOnceWith();
    expect(f.book.execute).not.toHaveBeenCalled(); expect(f.book.readPreparedAction).not.toHaveBeenCalled();
    expect(f.props.runWalletFlow).not.toHaveBeenCalled(); expect(f.props.confirmFunding).not.toHaveBeenCalled();
    expect(text(f.render())).toContain('Still pending. No transaction was sent.');
  });
  it.each(['wallet', 'runtime'])('ignores a completed recovery after the %s changes', async change => {
    const f = fixture(); await f.load();
    let finish!: (value: unknown) => void;
    f.book.reconcile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.button('Check status').props.onClick!();
    if (change === 'wallet') f.props.ownerAddress = `0x${'33'.repeat(20)}`;
    else f.props.runtime = { ...f.runtime } as never;
    f.render(); finish({ transactionHash: 'old-session-result', orderId: '7' }); await f.idle();
    expect(f.props.onConfirmed).not.toHaveBeenCalled();
    expect(text(f.render())).not.toContain('Book transaction confirmed.');
    expect(f.book.execute).not.toHaveBeenCalled();
  });
  it('holds private continuation until privacy is unlocked', async () => {
    const f = fixture('confirmed'); await f.load();
    const button = f.button('Continue trade'); expect(button.props.disabled).toBe(true);
    expect(text(f.render())).toContain('Unlock privacy to continue.');
    button.props.onClick!();
    expect(f.book.readPreparedAction).not.toHaveBeenCalled(); expect(f.props.runWalletFlow).not.toHaveBeenCalled();
  });
  it('discards only an unsent preparation without a wallet prompt', async () => {
    const f = fixture('unsent'); await f.load();
    expect(f.button('Continue trade')).toBeUndefined();
    f.button('Discard unsent preparation').props.onClick!(); await f.idle();
    expect(f.book.discardPreparation).toHaveBeenCalledExactlyOnceWith('saved-book');
    expect(f.book.reconcile).not.toHaveBeenCalled(); expect(f.book.execute).not.toHaveBeenCalled();
    expect(f.props.runWalletFlow).not.toHaveBeenCalled(); expect(text(f.render())).toContain('Unsent preparation discarded.');
  });
  it('does not show a recovery card for a completed request', async () => {
    const f = fixture('confirmed'); f.status.active = false; await f.load();
    expect(f.render()).toBeNull();
  });
  it('ignores a reconciliation result after the panel unmounts', async () => {
    const f = fixture(); await f.load();
    let finish!: (value: unknown) => void;
    f.book.reconcile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.button('Check status').props.onClick!();
    hooks.effects.forEach(effect => effect.cleanup?.());
    finish({ transactionHash: 'old-view', orderId: '7' }); await f.idle();
    expect(f.props.onConfirmed).not.toHaveBeenCalled();
  });
  it('reviews the exact saved funding requirement before an explicit continuation', async () => {
    const f = fixture('confirmed', false); await f.load();
    review.build.mockResolvedValue({ details: {} });
    review.execute.mockImplementationOnce(async ({ confirm }: { confirm: (details: unknown) => Promise<boolean> }) => {
      await confirm({ confirmMessage: 'Reviewed terms', confirmationStats: [], tradeSummary: [] });
      return f.book.execute();
    });
    f.button('Continue trade').props.onClick!(); await f.idle();
    expect(f.props.confirmFunding).toHaveBeenCalledWith(expect.objectContaining({ confirmationPolicy: 'always',
      requirements: [{ asset: { kind: 'native', symbol: 'COTI', decimals: 18 }, amountWei: 10n, reason: 'saved Book payment' }] }));
    expect(review.build).toHaveBeenCalledOnce(); expect(f.book.execute).toHaveBeenCalledOnce();
  });
});
