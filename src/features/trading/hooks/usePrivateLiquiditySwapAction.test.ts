import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import usePrivateLiquiditySwapAction from './usePrivateLiquiditySwapAction';
import { resolveBrowserWalletPrivacyReadScope } from '../../../lib/browserWalletRuntimeScope';

const hooks = vi.hoisted(() => ({ index: 0, slots: [] as {
  value?: unknown; deps?: readonly unknown[]; cleanup?: () => void
}[], effects: [] as (() => void)[] }));
const flow = vi.hoisted(() => ({ prepare: vi.fn(), allowance: vi.fn(), submit: vi.fn(), confirm: vi.fn() }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  const memo = (factory: () => unknown, deps: readonly unknown[]) => {
    const i = hooks.index++, previous = hooks.slots[i];
    if (!previous || deps.some((dep, n) => !Object.is(dep, previous.deps?.[n]))) hooks.slots[i] = { value: factory(), deps };
    return hooks.slots[i].value;
  };
  return { ...actual,
    useRef: (initial: unknown) => (hooks.slots[hooks.index++] ??= { value: { current: initial } }).value,
    useState: (initial: unknown) => {
      const i = hooks.index++;
      hooks.slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [hooks.slots[i].value, (value: unknown) => {
        hooks.slots[i].value = typeof value === 'function' ? value(hooks.slots[i].value) : value;
      }];
    },
    useMemo: memo,
    useCallback: (callback: unknown, deps: readonly unknown[]) => memo(() => callback, deps),
    useEffect: (effect: () => (() => void) | undefined, deps: readonly unknown[]) => {
      const i = hooks.index++, previous = hooks.slots[i];
      if (!previous || deps.some((dep, n) => !Object.is(dep, previous.deps?.[n]))) {
        hooks.slots[i] = { deps, cleanup: previous?.cleanup };
        hooks.effects.push(() => { hooks.slots[i].cleanup?.(); hooks.slots[i].cleanup = effect(); });
      }
    }
  };
});
vi.mock('../../../lib/privateLiquidityActions', () => ({
  ensurePrivateLiquidityInputAllowance: flow.allowance,
  submitPrivateLiquiditySwap: flow.submit,
  confirmPrivateLiquiditySwap: flow.confirm,
  isPrivateLiquidityAllowancePrivacyRefreshRequired: () => false,
  isPrivateLiquidityReceiptPrivacyRefreshRequired: () => false
}));
vi.mock('../../../lib/privateLiquiditySwapFlow', () => ({
  preparePrivateLiquiditySwap: flow.prepare,
  buildPrivateLiquiditySwapConfirmation: () => ({ title: 'Review private swap' })
}));

const prepared = Object.freeze({
  plan: { chainId: '7082400', contractAddress: 'current-book' },
  quote: { pairKey: 'private-pair', direction: 'base-to-quote', maximumInput: '123',
    minimumInputFilled: '1', minimumFillBps: 0, slippageBps: 50, candidates: [] },
  inputToken: { tokenAddress: 'input-token', symbol: 'PRIVATE-IN', decimals: 0 },
  outputToken: { tokenAddress: 'output-token', symbol: 'PRIVATE-OUT', decimals: 0 }
});
const confirmed = Object.freeze({ inputAmount: '123', outputAmount: '456', transactionHash: 'confirmed-hash' });
const failedReceipt = new Error('Private-liquidity swap transaction did not succeed.');
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const flushEffects = () => hooks.effects.splice(0).forEach(effect => effect());
beforeEach(() => {
  hooks.index = 0; hooks.slots = []; hooks.effects = [];
  vi.resetAllMocks(); vi.useFakeTimers();
  flow.prepare.mockReturnValue(prepared);
  flow.allowance.mockResolvedValue(undefined);
  flow.submit.mockResolvedValue({ submittedTransactionHash: 'submitted-hash' });
  flow.confirm.mockResolvedValue(confirmed);
});
afterEach(() => { hooks.slots.forEach(slot => slot.cleanup?.()); vi.useRealTimers(); });

function fixture(ready = true) {
  const getCapability = vi.fn(async () => ({}));
  const args = {
    active: true, deployment: { chainId: '7082400', contractAddress: 'current-book' },
    model: { atBlock: { number: '100', hash: 'current-block' } },
    sellToken: null, buyToken: null, sellAmountInput: '123', slippageBps: 50, minimumFillBps: 0,
    walletReady: true,
    privacyReadScope: resolveBrowserWalletPrivacyReadScope('current-owner-provider', ready, null),
    walletActions: { getPrivateLiquidityCapability: getCapability,
      runWalletTransactionFlow: vi.fn(async <T,>(operation: () => Promise<T>) => operation()) },
    requestConfirmation: vi.fn(async () => true), refresh: vi.fn()
  };
  const Render = (effects = true) => {
    hooks.index = 0;
    const result = usePrivateLiquiditySwapAction(args as unknown as Parameters<typeof usePrivateLiquiditySwapAction>[0]);
    if (effects) flushEffects();
    return result;
  };
  return { args, render: Render, getCapability };
}
const expectHidden = (state: ReturnType<ReturnType<typeof fixture>['render']>) => {
  expect(state.confirmed).toBeNull();
  expect(state.failedAttempts).toEqual([]);
  expect(state.message).toBe('');
};

describe('private swap terminal projections', () => {
  it('shows the successful current-scope result', async () => {
    const f = fixture(); await f.render().review();
    const state = f.render();
    expect(state.confirmed).toBe(confirmed);
    expect(state.message).toContain('123 PRIVATE-IN');
    expect(state.message).toContain('456 PRIVATE-OUT');
    expect(flow.submit).toHaveBeenCalledTimes(1);
  });

  it.each(['lock', 'provider', 'owner'] as const)('masks and clears successful amounts on %s before effects run', async change => {
    const f = fixture(); await f.render().review(); expect(f.render().confirmed).toBe(confirmed);
    const previous = f.args.privacyReadScope;
    f.args.privacyReadScope = resolveBrowserWalletPrivacyReadScope(
      change === 'lock' ? previous.runtimeScopeKey : `changed-${change}`, change !== 'lock', previous);
    expectHidden(f.render(false)); flushEffects(); expectHidden(f.render());
    // Returning to the old scope object must not restore private terminal state after cleanup.
    f.args.privacyReadScope = previous; expectHidden(f.render(false)); flushEffects();
  });

  it('hides a late prior-owner completion and preserves the one submitted operation', async () => {
    const f = fixture();
    let resolve!: (value: unknown) => void;
    flow.confirm.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = f.render().review(); await settle();
    expect(f.render().stage).toBe('confirming-swap');
    f.args.privacyReadScope = resolveBrowserWalletPrivacyReadScope('new-owner-provider', true, f.args.privacyReadScope);
    f.render();
    resolve(confirmed); await pending;
    expectHidden(f.render(false)); flushEffects(); expectHidden(f.render());
    expect(flow.submit).toHaveBeenCalledTimes(1);
    expect(flow.confirm).toHaveBeenCalledTimes(1);
    expect(f.args.refresh).toHaveBeenCalledTimes(1);
  });

  it('hides failed-attempt amounts on lock and preserves the fresh-liquidity guard', async () => {
    flow.confirm.mockRejectedValue(failedReceipt);
    const f = fixture(); await f.render().review();
    const failed = f.render();
    expect(failed.failedAttempts[0]?.maximumInput).toBe('123');
    expect(failed.quote).toBeNull();
    f.args.privacyReadScope = resolveBrowserWalletPrivacyReadScope('current-owner-provider', false, f.args.privacyReadScope);
    expectHidden(f.render(false)); flushEffects();
    const locked = f.render(); expectHidden(locked); expect(locked.quote).toBeNull();
    expect(flow.submit).toHaveBeenCalledTimes(1);
  });

  it('allows one first Review to unlock and complete through its existing action flow', async () => {
    const f = fixture(false);
    f.getCapability.mockImplementationOnce(async () => {
      f.args.privacyReadScope = resolveBrowserWalletPrivacyReadScope('current-owner-provider', true, f.args.privacyReadScope);
      f.render(); return {};
    });
    await f.render().review();
    expect(f.render().confirmed).toBe(confirmed);
    expect(f.getCapability).toHaveBeenCalledTimes(1);
    expect(f.args.requestConfirmation).toHaveBeenCalledTimes(1);
    expect(f.args.walletActions.runWalletTransactionFlow).toHaveBeenCalledTimes(1);
    expect(flow.submit).toHaveBeenCalledTimes(1);
    expect(flow.confirm).toHaveBeenCalledTimes(1);
  });
});
