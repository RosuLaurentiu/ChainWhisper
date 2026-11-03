import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import usePrivateLiquidityOwnerData from './usePrivateLiquidityOwnerData';
import usePrivateLiquidityHiddenIntentOwnerData from './usePrivateLiquidityHiddenIntentOwnerData';
import { resolveBrowserWalletPrivacyReadScope } from '../../../lib/browserWalletRuntimeScope';

const hooks = vi.hoisted(() => ({ index: 0, slots: [] as {
  value?: unknown; deps?: readonly unknown[]; cleanup?: () => void
}[], effects: [] as (() => void)[] }));
const reads = vi.hoisted(() => ({ owner: vi.fn(), history: vi.fn(), intents: vi.fn() }));
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
  readPrivateLiquidityOwnerPrivateData: reads.owner,
  readPrivateLiquidityPrivateHistory: reads.history,
  readPrivateLiquidityHiddenIntentOwnerPage: reads.intents,
  isPrivateLiquidityReceiptPrivacyRefreshRequired: () => false
}));

const owner = `0x${'11'.repeat(20)}`;
const capability = Object.freeze({ name: 'current-private-capability' });
const inventory = Object.freeze({ balance: 'private-inventory' });
const history = Object.freeze({ traderRows: ['private-history'], positionRows: [], positionTotals: [] });
const page = Object.freeze({ intents: ['private-intent'] });
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const flushEffects = () => hooks.effects.splice(0).forEach(effect => effect());
beforeEach(() => {
  hooks.index = 0; hooks.slots = []; hooks.effects = [];
  vi.resetAllMocks(); vi.useFakeTimers();
  reads.owner.mockResolvedValue({ inventory, history: { history } });
  reads.history.mockResolvedValue({ history });
  reads.intents.mockResolvedValue(page);
});
afterEach(() => { hooks.slots.forEach(slot => slot.cleanup?.()); vi.useRealTimers(); });

function fixture(kind: 'owner' | 'intents', ready = true) {
  const getCapability = vi.fn(async () => capability);
  const args = {
    active: true,
    deployment: { chainId: '7082400', contractAddress: 'current-book' },
    model: { atBlock: { number: '100', hash: 'current-block' }, selection: {
      status: 'manageable', position: { privacyOwner: owner, identity: { positionId: '1' }, revision: '1' }
    } },
    historyPages: [{ range: { fromBlock: '1', toBlock: '100', toBlockHash: 'current-block' } }],
    walletAddress: owner, walletReady: true,
    privacyReadScope: resolveBrowserWalletPrivacyReadScope('current-provider', ready, null),
    walletActions: { getPrivateLiquidityCapability: getCapability,
      runWalletTransactionFlow: async <T,>(operation: () => Promise<T>) => operation() },
    refreshKey: '0'
  };
  const usePrivateData = kind === 'owner' ? usePrivateLiquidityOwnerData : usePrivateLiquidityHiddenIntentOwnerData;
  const Render = (effects = true) => {
    hooks.index = 0;
    const result = usePrivateData(args as unknown as Parameters<typeof usePrivateLiquidityOwnerData>[0]
      & Parameters<typeof usePrivateLiquidityHiddenIntentOwnerData>[0]);
    if (effects) flushEffects();
    return result;
  };
  const expectPrivate = (state: ReturnType<typeof Render>) => {
    expect(state.status).toBe('available');
    if ('inventory' in state) {
      expect(state.inventory).toBe(inventory); expect(state.history).toBe(history);
    } else expect(state.page).toBe(page);
  };
  const expectLocked = (state: ReturnType<typeof Render>) => {
    expect(state.status).toBe('locked');
    if ('inventory' in state) {
      expect(state.inventory).toBeNull(); expect(state.history.traderRows).toEqual([]);
    } else expect(state.page).toBeNull();
  };
  return { args, render: Render, getCapability, expectPrivate, expectLocked,
    read: kind === 'owner' ? reads.owner : reads.intents };
}

describe.each(['owner', 'intents'] as const)('%s private read scope', kind => {
  it('masks revealed data on lock before effects run and does not prompt in the background', async () => {
    const f = fixture(kind); const initial = f.render();
    await initial.reveal(); f.expectPrivate(f.render());
    f.args.privacyReadScope = resolveBrowserWalletPrivacyReadScope('current-provider', false, f.args.privacyReadScope);
    f.expectLocked(f.render(false)); flushEffects(); f.expectLocked(f.render());
    f.args.model = { ...f.args.model, atBlock: { number: '101', hash: 'next-block' } };
    f.args.refreshKey = '1'; f.render(); await settle();
    expect(f.getCapability).toHaveBeenCalledTimes(1);
    expect(f.read).toHaveBeenCalledTimes(1);
  });

  it('masks the same owner data on provider replacement and accepts a new current-scope read', async () => {
    const f = fixture(kind); await f.render().reveal(); f.expectPrivate(f.render());
    f.args.privacyReadScope = resolveBrowserWalletPrivacyReadScope('replacement-provider', true, f.args.privacyReadScope);
    f.expectLocked(f.render(false)); flushEffects();
    await f.render().reveal(); f.expectPrivate(f.render());
    expect(f.getCapability).toHaveBeenCalledTimes(2);
  });

  it('rejects late old results even when the changed-scope effect has not run', async () => {
    const f = fixture(kind);
    let resolve!: (value: unknown) => void;
    f.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = f.render().reveal(); await settle();
    f.args.privacyReadScope = resolveBrowserWalletPrivacyReadScope('replacement-provider', true, f.args.privacyReadScope);
    f.render(false);
    resolve(kind === 'owner' ? { inventory, history: { history } } : page);
    await pending;
    f.expectLocked(f.render(false)); flushEffects(); f.expectLocked(f.render());
    await f.render().reveal(); f.expectPrivate(f.render());
  });

  it('resumes the first explicit Reveal after unlock with one capability request', async () => {
    const f = fixture(kind, false);
    const pending = f.render().reveal(); await settle();
    expect(f.getCapability).toHaveBeenCalledTimes(1);
    expect(f.read).not.toHaveBeenCalled();
    f.args.privacyReadScope = resolveBrowserWalletPrivacyReadScope('current-provider', true, f.args.privacyReadScope);
    f.render(); await pending; f.expectPrivate(f.render());
    expect(f.getCapability).toHaveBeenCalledTimes(1);
    expect(f.read).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending first Reveal when its provider is replaced', async () => {
    const f = fixture(kind, false);
    const pending = f.render().reveal(); await settle();
    f.args.privacyReadScope = resolveBrowserWalletPrivacyReadScope('replacement-provider', true, f.args.privacyReadScope);
    f.render(); await pending; f.expectLocked(f.render());
    expect(f.read).not.toHaveBeenCalled();
  });

  it('rejects a late result after the same provider locks and unlocks again', async () => {
    const f = fixture(kind);
    let resolve!: (value: unknown) => void;
    f.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = f.render().reveal(); await settle();
    f.args.privacyReadScope = resolveBrowserWalletPrivacyReadScope('current-provider', false, f.args.privacyReadScope);
    f.render(false);
    f.args.privacyReadScope = resolveBrowserWalletPrivacyReadScope('current-provider', true, f.args.privacyReadScope);
    f.render(false);
    resolve(kind === 'owner' ? { inventory, history: { history } } : page);
    await pending; f.expectLocked(f.render(false)); flushEffects();
    expect(f.getCapability).toHaveBeenCalledTimes(1);
  });

  it('retains the first Reveal when unlock renders before capability acquisition completes', async () => {
    const f = fixture(kind, false);
    let resolve!: (value: typeof capability) => void;
    f.getCapability.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = f.render().reveal(); await settle();
    f.args.privacyReadScope = resolveBrowserWalletPrivacyReadScope('current-provider', true, f.args.privacyReadScope);
    f.render(); resolve(capability); await pending; f.expectPrivate(f.render());
    expect(f.getCapability).toHaveBeenCalledTimes(1);
  });

  it('ends a stalled first unlock with a bounded error and no automatic retry', async () => {
    const f = fixture(kind, false);
    const pending = f.render().reveal(); await settle();
    expect(f.render().status).toBe('loading');
    await vi.advanceTimersByTimeAsync(10_000); await pending;
    const stalled = f.render();
    expect(stalled.status).toBe('error');
    expect(stalled.error).toContain('Unlock privacy and reveal again.');
    expect(f.read).not.toHaveBeenCalled();
    expect(f.getCapability).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('owner private inventory selection', () => {
  it.each(['capability', 'read'] as const)('rejects the first old-position Reveal while %s is pending', async stage => {
    const f = fixture('owner');
    let release!: () => void;
    if (stage === 'read') f.read.mockImplementationOnce(() => new Promise(done => {
      release = () => done({ inventory, history: { history } });
    }));
    else f.getCapability.mockImplementationOnce(() => new Promise(done => { release = () => done(capability); }));
    const pending = f.render().reveal(); await settle();
    f.args.model = { ...f.args.model, selection: { ...f.args.model.selection,
      position: { ...f.args.model.selection.position, identity: { positionId: '2' } }
    } };
    const changed = f.render(false);
    expect('inventory' in changed && changed.inventory).toBeNull();
    release();
    await pending; f.expectLocked(f.render(false)); flushEffects();
    const currentInventory = { positionId: '2', balance: 'current-private-inventory' };
    f.read.mockResolvedValueOnce({ inventory: currentInventory, history: { history } });
    await f.render().reveal();
    const current = f.render();
    expect(current.status).toBe('available');
    expect('inventory' in current && current.inventory).toBe(currentInventory);
    expect(f.read.mock.lastCall?.[0].position.identity.positionId).toBe('2');
  });
});
