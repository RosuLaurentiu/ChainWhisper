import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { CURRENT_CHEAP_DEX_CANDIDATE as current, STAGED_PREPARED_DEX_CANDIDATE as prepared, STAGED_EXIT_PREVIEW_DEX_CANDIDATE as exit, STAGED_SHARED_HISTORY_DEX_CANDIDATE as history } from '../../../lib/dexV2Deployment';
import useCurrentTrialBalances, { type CurrentTrialBalanceSelection } from './useCurrentTrialBalances';

// Small hook harness: retain state, compare dependencies and run effect cleanup.
// It uses no DOM, provider, privacy material or network.
const hooks = vi.hoisted(() => ({ index: 0, slots: [] as {
  value?: unknown; deps?: readonly unknown[]; cleanup?: () => void
}[], effects: [] as (() => void)[] }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  const memo = (factory: () => unknown, deps: readonly unknown[]) => {
    const i = hooks.index++, old = hooks.slots[i];
    if (!old || deps.some((dep, index) => !Object.is(dep, old.deps?.[index]))) {
      hooks.slots[i] = { value: factory(), deps };
    }
    return hooks.slots[i].value;
  };
  return { ...actual,
    useRef: (initial: unknown) => {
      const i = hooks.index++;
      return (hooks.slots[i] ??= { value: { current: initial } }).value;
    },
    useState: (initial: unknown) => {
      const i = hooks.index++;
      hooks.slots[i] ??= { value: initial };
      return [hooks.slots[i].value, (value: unknown) => { hooks.slots[i].value = value; }];
    },
    useMemo: memo,
    useCallback: (fn: unknown, deps: readonly unknown[]) => memo(() => fn, deps),
    useEffect: (effect: () => (() => void) | undefined, deps: readonly unknown[]) => {
      const i = hooks.index++, old = hooks.slots[i];
      if (!old || deps.some((dep, index) => !Object.is(dep, old.deps?.[index]))) {
        hooks.slots[i] = { deps, cleanup: old?.cleanup };
        hooks.effects.push(() => { hooks.slots[i].cleanup?.(); hooks.slots[i].cleanup = effect(); });
      }
    }
  };
});

const owner = `0x${'22'.repeat(20)}`, other = `0x${'33'.repeat(20)}`;
const snapshot = () => ({ owner, core: prepared.core, graph: prepared.graph, packageSha256: prepared.packageSha256,
  privateFundsVerified: true, readyToSign: false,
  tokens: prepared.tokenMetadata.map((token, index) => ({ ...token, balance: index === 0 ? 1n : 9007199254740993000001n, allowance: 0n })) });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
function fixture() {
  const read = vi.fn(async () => snapshot());
  const getFunds = vi.fn(async () => ({ read }));
  const legacyRead = vi.fn(async (index: number) => ({ balance: BigInt(index + 1) }));
  const getSender = vi.fn(async () => ({ readCurrentTokenFunding: legacyRead }));
  const session = { walletAddress: owner, chainId: 7082400, browserProvider: { request: vi.fn() },
    activeSignerSource: 'browser', browserWalletId: 'metamask', browserWalletLabel: 'MetaMask',
    sessionOnboardInfo: { [owner]: { aesKey: 'local-fixture-only' } }, walletAesHealthByAddress: {},
    actions: { getCurrentSharedDexTokenFundsCapability: getFunds, getCurrentDexSubmissionCapability: getSender }
  } as unknown as SharedWalletSession;
  let selection: CurrentTrialBalanceSelection | undefined = { candidate: prepared, tokens: [prepared.tokens[0][0], prepared.tokens[1][0]] };
  const Render = (effects = true) => {
    hooks.index = 0;
    const view = useCurrentTrialBalances(session, '', selection);
    if (effects) hooks.effects.splice(0).forEach(effect => effect());
    return view;
  };
  const settle = async () => { await vi.waitFor(() => expect(Render().loading).toBe(false)); return Render(); };
  return { session, read, getFunds, getSender, legacyRead, render: Render, settle,
    select: (value: CurrentTrialBalanceSelection | undefined) => { selection = value; } };
}
beforeEach(() => { hooks.index = 0; hooks.slots = []; hooks.effects = []; });

describe('selected DEX private balance display', () => {
  it.each([[0,1],[3,0]])('uses the current shared reader for 7b67 token direction %s -> %s', async (input,output) => {
    const f=fixture(); f.select({candidate:history,tokens:[history.tokens[input][0],history.tokens[output][0]]});
    f.read.mockResolvedValue({...snapshot(),core:history.core,graph:history.graph,packageSha256:history.packageSha256,
      tokens:history.tokenMetadata.map((token,index)=>({...token,balance:index===0?1n:9007199254740993000001n,allowance:0n}))} as never);
    f.render();
    expect((await f.settle()).labels).toEqual([input,output].map(index=>index===0?'0.000001':'9007199254740993.000001'));
    expect(f.getFunds).toHaveBeenCalledWith(7082400n,{candidate:'cheap-history'});
    expect(f.getSender).not.toHaveBeenCalled(); expect(f.legacyRead).not.toHaveBeenCalled();
  });
  it('selects current Core allowances and rejects an earlier candidate result', async () => {
    const f = fixture(); f.select({ candidate: exit, tokens: [exit.tokens[3][0], exit.tokens[0][0]] });
    f.read.mockResolvedValueOnce({ ...snapshot(), core: exit.core, graph: exit.graph, packageSha256: exit.packageSha256 } as never);
    f.render(); expect((await f.settle()).labels).toEqual(['9007199254740993.000001', '0.000001']);
    expect(f.getFunds).toHaveBeenCalledWith(7082400n, { candidate: 'cheap-exit' });
    expect(f.getSender).not.toHaveBeenCalled();
    await f.render().refresh(); expect(f.render().labels).toEqual(['Unavailable', 'Unavailable']);
  });

  it('discards a private result when the selected deployment changes during reading', async () => {
    const f = fixture(), pending = deferred<ReturnType<typeof snapshot>>();
    f.read.mockReturnValueOnce(pending.promise); f.render();
    f.select({ candidate: exit, tokens: [exit.tokens[0][0], exit.tokens[1][0]] });
    expect(f.render(false).labels).toEqual(['Loading…', 'Loading…']);
    pending.resolve(snapshot()); await Promise.resolve(); await Promise.resolve();
    expect(f.render(false).labels).toEqual(['Loading…', 'Loading…']);
    f.render(); await f.settle(); expect(f.render().labels).toEqual(['Unavailable', 'Unavailable']);
  });
  it('reads only the existing read capability and keeps exact selected direction', async () => {
    const f = fixture(); f.render();
    expect((await f.settle()).labels).toEqual(['0.000001', '9007199254740993.000001']);
    expect(f.getFunds).toHaveBeenCalledWith(7082400n, { candidate: 'cheap-prepared' });
    expect(f.getSender).not.toHaveBeenCalled();
    f.select({ candidate: { graph: prepared.graph, core: prepared.core.toUpperCase(), packageSha256: prepared.packageSha256 },
      tokens: [prepared.tokens[0][0].toUpperCase(), prepared.tokens[1][0]] });
    f.render(); await f.settle(); expect(f.read).toHaveBeenCalledOnce();
    f.select({ candidate: prepared, tokens: [prepared.tokens[1][0], prepared.tokens[0][0]] });
    expect(f.render(false).labels).toEqual(['Loading…', 'Loading…']);
    f.render(); expect((await f.settle()).labels).toEqual(['9007199254740993.000001', '0.000001']);
  });

  it.each(['owner', 'core', 'graph', 'package', 'token', 'precision', 'duplicate', 'private', 'missing-private', 'signing', 'range', 'quantity'])(
    'rejects funds with wrong %s evidence', async kind => {
      const f = fixture(), funds = snapshot();
      if (kind === 'owner') funds.owner = other;
      if (kind === 'core') funds.core = current.core as typeof funds.core;
      if (kind === 'graph') funds.graph = 'wrong' as typeof funds.graph;
      if (kind === 'package') funds.packageSha256 = 'wrong' as typeof funds.packageSha256;
      if (kind === 'token') funds.tokens.shift();
      if (kind === 'precision') funds.tokens[0].decimals = 18 as 6;
      if (kind === 'duplicate') funds.tokens.push(funds.tokens[0]);
      if (kind === 'private') funds.privateFundsVerified = false;
      if (kind === 'missing-private') delete (funds as Record<string, unknown>).privateFundsVerified;
      if (kind === 'signing') funds.readyToSign = true;
      if (kind === 'range') funds.tokens[0].balance = 1n << 256n;
      if (kind === 'quantity') funds.tokens[0].balance = 1 as unknown as bigint;
      f.read.mockResolvedValue(funds); f.render();
      expect((await f.settle()).labels).toEqual(['Unavailable', 'Unavailable']);
    });

  it.each(['pair', 'owner', 'privacy', 'privacy-key', 'provider', 'candidate', 'package', 'core', 'reader', 'health', 'onboard', 'wallet', 'chain'])(
    'hides prior data and rejects a deferred result after %s change', async kind => {
      const f = fixture(); f.render(); await f.settle();
      const waiting = deferred<ReturnType<typeof snapshot>>(); f.read.mockImplementationOnce(() => waiting.promise);
      const oldRefresh = f.render().refresh, pending = oldRefresh();
      await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(2));
      if (kind === 'pair') f.select({ candidate: prepared, tokens: [prepared.tokens[2][0], prepared.tokens[3][0]] });
      if (kind === 'owner') f.session.walletAddress = other;
      if (kind === 'privacy') f.session.sessionOnboardInfo = {};
      if (kind === 'privacy-key') f.session.sessionOnboardInfo[owner].aesKey = 'changed-local-fixture';
      if (kind === 'provider') f.session.browserProvider = { request: vi.fn() };
      if (kind === 'candidate') f.select(undefined);
      if (kind === 'package') f.select({ candidate: { ...prepared, packageSha256: 'wrong' }, tokens: [prepared.tokens[0][0], prepared.tokens[1][0]] });
      if (kind === 'core') f.select({ candidate: { ...prepared, core: current.core }, tokens: [prepared.tokens[0][0], prepared.tokens[1][0]] });
      if (kind === 'reader') f.session.actions!.getCurrentSharedDexTokenFundsCapability = vi.fn() as never;
      if (kind === 'health') f.session.walletAesHealthByAddress = {};
      if (kind === 'onboard') f.session.sessionOnboardInfo = { ...f.session.sessionOnboardInfo };
      if (kind === 'wallet') f.session.browserWalletId = 'other';
      if (kind === 'chain') f.session.chainId = 1;
      expect(f.render(false).labels).not.toContain('0.000001');
      waiting.resolve(snapshot()); await pending;
      expect(f.render(false).labels).not.toContain('0.000001');
      const calls = f.read.mock.calls.length;
      await oldRefresh(); expect(f.read).toHaveBeenCalledTimes(calls);
    });

  it('does not start the read after capability issuance when scope changed', async () => {
    const f = fixture(), issued = deferred<{ read: typeof f.read }>();
    f.getFunds.mockImplementationOnce(() => issued.promise); f.render();
    f.session.browserProvider = { request: vi.fn() }; f.render(false);
    issued.resolve({ read: f.read }); await Promise.resolve(); await Promise.resolve();
    expect(f.read).not.toHaveBeenCalled();
  });

  it.each(['no-reader', 'locked', 'mismatch', 'invalid-identity', 'no-pair', 'same-token', 'unknown-token'])(
    'does not read with %s', async kind => {
      const f = fixture();
      if (kind === 'no-reader') delete f.session.actions!.getCurrentSharedDexTokenFundsCapability;
      if (kind === 'locked') f.session.sessionOnboardInfo = {};
      if (kind === 'mismatch') f.session.walletAesHealthByAddress = { [owner]: { status: 'key-mismatch' } } as never;
      if (kind === 'invalid-identity') f.select({ candidate: { ...prepared, graph: 'wrong' }, tokens: [prepared.tokens[0][0], prepared.tokens[1][0]] });
      if (kind === 'no-pair') f.select({ candidate: prepared });
      if (kind === 'same-token') f.select({ candidate: prepared, tokens: [prepared.tokens[0][0], prepared.tokens[0][0]] });
      if (kind === 'unknown-token') f.select({ candidate: prepared, tokens: [prepared.tokens[0][0], current.tokens[0][0]] });
      const view = f.render(); await view.refresh();
      expect(view.eligible).toBe(false); expect(f.getFunds).not.toHaveBeenCalled(); expect(f.getSender).not.toHaveBeenCalled();
      expect(view.labels).toEqual(kind === 'locked' || kind === 'mismatch' ? ['Unlock privacy', 'Unlock privacy'] : ['Unavailable', 'Unavailable']);
    });

  it('retains the default current two-token 18-decimal read', async () => {
    const f = fixture(); f.select(undefined); f.render();
    expect((await f.settle()).labels).toEqual(['0.000000000000000001', '0.000000000000000002']);
    expect(f.getFunds).not.toHaveBeenCalled(); expect(f.getSender).toHaveBeenCalledWith(BigInt(current.chainId));
    expect(f.legacyRead.mock.calls.map(([index]) => index)).toEqual([0, 1]);
  });
});
