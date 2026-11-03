import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { useState } from 'react';
import useAppChainLookups from './useAppChainLookups';

const legacy = vi.hoisted(() => ({ fetch: vi.fn(), limit: vi.fn(), load: vi.fn(), range: vi.fn(), trade: vi.fn(), asset: vi.fn() }));
vi.mock('../../lib/appChain', () => ({ fetchTradeSnapshotById: legacy.trade, resolveTradeAssetSnapshot: legacy.asset }));
const owner = `0x${'11'.repeat(20)}`, peer = `0x${'22'.repeat(20)}`;
const create = (runtime: unknown, tradeRuntime: unknown = null, tradeContracts?: readonly string[], snapshots = {}) => {
  const cache = { current: {} as Record<string, string | null> }, setError = vi.fn(), setName = vi.fn();
  let actions!: ReturnType<typeof useAppChainLookups>;
  function Capture() {
    actions = useAppChainLookups({ directChatV2Runtime: runtime, directTradeV2Runtime: tradeRuntime, directTradeV2Contracts: tradeContracts,
      loadMyNicknameFromChainRef: { current: async () => '' }, myNickname: 'Name', nicknameMaxBytes: 64, onChainNicknameCacheRef: cache,
      privateRewardTokenDecimals: 6, privateRewardTokenSymbol: 'P', rewardTokenDecimals: 6, rewardTokenSymbol: 'R',
      setContacts: vi.fn(), setError, setMyNickname: setName, setNicknameMaxBytes: vi.fn(), tradeSnapshotSessionScope: {}, walletAddress: owner } as never);
    return null;
  }
  renderToString(<Capture />);
  actions.setTradeSnapshotsById(snapshots);
  return { actions, cache, setError, setName };
};
const ready = () => ({ enabled: true, isCurrent: () => true, session: { ownerAddress: owner,
  hasProfileSync: vi.fn(async () => true), readNickname: vi.fn(async () => 'Peer'), setNickname: vi.fn(async () => 'Name') } });

describe('selected Chat nickname lookup', () => {
  beforeEach(() => { vi.clearAllMocks(); legacy.fetch.mockResolvedValue(new Map([[peer, 'Legacy']])); legacy.limit.mockResolvedValue(64); });
  it.each(['loading', 'stale', 'unsupported', 'feature-error', 'read-error'])('does not use legacy reads when V2 is %s', async mode => {
    const runtime = ready();
    if (mode === 'stale') runtime.isCurrent = () => false;
    if (mode === 'unsupported') runtime.session.hasProfileSync.mockResolvedValue(false);
    if (mode === 'feature-error') runtime.session.hasProfileSync.mockRejectedValue(new Error('Unavailable'));
    if (mode === 'read-error') runtime.session.readNickname.mockRejectedValue(new Error('Unavailable'));
    const { actions, cache } = create(mode === 'loading' ? null : runtime);
    expect(await actions.fetchOnChainNicknames([peer])).toEqual(new Map());
    expect(legacy.fetch).not.toHaveBeenCalled(); expect(cache.current[peer]).toBeUndefined();
  });
  it('uses the selected V2 name bound without a legacy RPC', async () => {
    const runtime = ready(); runtime.session.hasProfileSync.mockRejectedValue(new Error('Unavailable'));
    expect(await create(runtime).actions.getNicknameMaxLength()).toBe(32);
    expect(legacy.limit).not.toHaveBeenCalled();
  });
  it('reads and caches only confirmed selected V2 names', async () => {
    const runtime = ready(), { actions, cache } = create(runtime);
    expect(await actions.fetchOnChainNicknames([peer, peer])).toEqual(new Map([[peer, 'Peer']]));
    expect(cache.current[peer]).toBe('Peer'); expect(runtime.session.readNickname).toHaveBeenCalledOnce();
    expect(await actions.fetchOnChainNicknames([peer])).toEqual(new Map([[peer, 'Peer']]));
    expect(runtime.session.readNickname).toHaveBeenCalledOnce(); expect(legacy.fetch).not.toHaveBeenCalled();
  });
  it('caches a confirmed empty name without caching an unavailable read as empty', async () => {
    const runtime = ready(); runtime.session.readNickname.mockResolvedValue('');
    const { actions, cache } = create(runtime);
    await actions.fetchOnChainNicknames([peer]); await actions.fetchOnChainNicknames([peer]);
    expect(cache.current[peer]).toBeNull(); expect(runtime.session.readNickname).toHaveBeenCalledOnce();
  });
  it('rejects a runtime for another owner before any read or name write', async () => {
    const runtime = ready(); runtime.session.ownerAddress = peer;
    const { actions } = create(runtime);
    expect(await actions.fetchOnChainNicknames([peer])).toEqual(new Map()); expect(await actions.saveMyNicknameOnChain()).toBe(false);
    expect(runtime.session.hasProfileSync).not.toHaveBeenCalled(); expect(runtime.session.setNickname).not.toHaveBeenCalled();
    expect(legacy.fetch).not.toHaveBeenCalled();
  });
});

describe('Direct offer lookup', () => {
  const current = `0x${'33'.repeat(20)}`, retained = `0x${'88'.repeat(20)}`;
  const offer = { version: 2 as const, tradeId: 7, escrowContract: retained, maker: owner, taker: peer, createdAt: 1, expiresAt: 9999999999 };
  const terms = { tradeId: '7', maker: owner, taker: peer, offerAsset: { assetType: 'erc20', token: current },
    requestAsset: { assetType: 'erc20', token: retained }, offerAmount: '12', requestAmount: '24',
    createdAt: '1', expiresAt: '9999999999', parentTradeId: '0', replacementTradeId: '0', replacesTradeId: '0',
    status: 'open', amountMode: 'private' };
  const tradeReady = () => ({ contractAddress: retained, ownerAddress: owner, deployment: { chainId: '7082400' },
    isCurrent: () => true, readTradeTerms: vi.fn(async () => terms), supportedContracts: [retained] });
  beforeEach(() => {
    vi.clearAllMocks();
    legacy.asset.mockImplementation(async (_kind, token, amount) => ({ tokenAddress: token, amount: String(amount) }));
  });
  it.each(['closed', 'wrong-owner'])('rejects a cached private snapshot when runtime is %s', async mode => {
    const runtime = tradeReady();
    const snapshot = { hiddenLiquidity: true, offer: { amount: '12' }, request: { amount: '24' } };
    const { actions } = create(null, runtime, [retained], { [`${retained.toLowerCase()}:7`]: snapshot });
    if (mode === 'closed') runtime.isCurrent = () => false;
    else runtime.ownerAddress = peer;
    await expect(actions.resolveTradeSnapshotForOffer(offer)).rejects.toThrow(/unavailable|scope/i);
    expect(runtime.readTradeTerms).not.toHaveBeenCalled();
  });
  it('rejects plaintext that completes metadata resolution after the runtime closes', async () => {
    const runtime = tradeReady();
    legacy.asset.mockImplementation(async (_kind, token, amount) => {
      runtime.isCurrent = () => false;
      return { tokenAddress: token, amount: String(amount) };
    });
    await expect(create(null, runtime).actions.resolveTradeSnapshotForOffer(offer)).rejects.toThrow(/unavailable|scope/i);
  });
  it('keeps revealed agreed terms in the current scope without a repeated terms read', async () => {
    const runtime = tradeReady(), { actions } = create(null, runtime);
    const result = await actions.resolveTradeSnapshotForOffer(offer);
    expect(result.offer.amount).toBe('12'); expect(result.request.amount).toBe('24');
    expect(await actions.resolveTradeSnapshotForOffer(offer)).toBe(result);
    expect(runtime.readTradeTerms).toHaveBeenCalledOnce();
  });
  it('does not invoke a queued cache update after runtime retirement', () => {
    const runtime = tradeReady(), { actions } = create(null, runtime);
    runtime.isCurrent = () => false;
    const update = vi.fn(() => ({}));
    actions.setTradeSnapshotsById(update);
    expect(update).not.toHaveBeenCalled();
  });
  it('upgrades a private placeholder only when participant reveal is permitted', async () => {
    const runtime = tradeReady();
    const placeholder = { hiddenLiquidity: true, offer: { amount: '0' }, request: { amount: '0' } };
    const { actions } = create(null, runtime, [retained], { [`${retained}:7`]: placeholder });
    expect(await actions.resolveTradeSnapshotForOffer(offer, { allowPrivatePrompt: false })).toBe(placeholder);
    expect(runtime.readTradeTerms).not.toHaveBeenCalled();
    expect((await actions.resolveTradeSnapshotForOffer(offer)).offer.amount).toBe('12');
    expect(runtime.readTradeTerms).toHaveBeenCalledWith(7, { decryptPrivateAmounts: true });
  });
  it('keeps public terms readable without a private prompt', async () => {
    const runtime = tradeReady();
    runtime.readTradeTerms.mockResolvedValue({ ...terms, amountMode: 'public' });
    const result = await create(null, runtime).actions.resolveTradeSnapshotForOffer(offer, { allowPrivatePrompt: false });
    expect(result.hiddenLiquidity).toBe(false); expect(result.offer.amount).toBe('12');
    expect(runtime.readTradeTerms).toHaveBeenCalledWith(7, { decryptPrivateAmounts: false });
  });
  it('stops before metadata if terms finish after runtime retirement', async () => {
    const runtime = tradeReady();
    runtime.readTradeTerms.mockImplementation(async () => { runtime.isCurrent = () => false; return terms; });
    await expect(create(null, runtime).actions.resolveTradeSnapshotForOffer(offer)).rejects.toThrow(/unavailable/);
    expect(legacy.asset).not.toHaveBeenCalled();
  });
  it('clears the display cache on a privacy epoch change and rejects the old resolver and setter', async () => {
    const runtime = tradeReady(), firstScope = {}, nextScope = {};
    let previous!: ReturnType<typeof useAppChainLookups>, currentActions!: ReturnType<typeof useAppChainLookups>;
    function Capture() {
      const [scope, setScope] = useState(firstScope);
      currentActions = useAppChainLookups({ directChatV2Runtime: null, directTradeV2Runtime: runtime,
        loadMyNicknameFromChainRef: { current: async () => '' }, myNickname: '', nicknameMaxBytes: 32,
        onChainNicknameCacheRef: { current: {} }, privateRewardTokenDecimals: 6, privateRewardTokenSymbol: 'P',
        rewardTokenDecimals: 6, rewardTokenSymbol: 'R', setContacts: vi.fn(), setError: vi.fn(),
        setMyNickname: vi.fn(), setNicknameMaxBytes: vi.fn(), tradeSnapshotSessionScope: scope, walletAddress: owner } as never);
      if (scope === firstScope) {
        previous = currentActions;
        previous.setTradeSnapshotsById({ [`${retained}:7`]: { hiddenLiquidity: true, offer: { amount: '12' }, request: { amount: '24' } } } as never);
        setScope(nextScope);
      }
      return null;
    }
    renderToString(<Capture />);
    expect(currentActions.tradeSnapshotsById).toEqual({});
    const update = vi.fn(() => ({})); previous.setTradeSnapshotsById(update);
    expect(update).not.toHaveBeenCalled();
    await expect(previous.resolveTradeSnapshotForOffer(offer)).rejects.toThrow(/unavailable/);
    expect(runtime.readTradeTerms).not.toHaveBeenCalled();
  });
  it('rejects an old Direct reference before reading terms', async () => {
    const readTradeTerms = vi.fn();
    const runtime = { contractAddress: current, ownerAddress: owner, deployment: { chainId: '7082400' }, isCurrent: () => true,
      readTradeTerms, supportedContracts: [current] };
    await expect(create(null, runtime).actions.resolveTradeSnapshotForOffer(offer)).rejects.toThrow(/unsupported|invalid|outside|unavailable/i);
    expect(readTradeTerms).not.toHaveBeenCalled();
    expect(legacy.trade).not.toHaveBeenCalled();
  });
  it('does not fall back to a legacy reader when an admitted Direct runtime is unavailable', async () => {
    legacy.trade.mockClear();
    await expect(create(null, null, [current, retained]).actions.resolveTradeSnapshotForOffer(offer)).rejects.toThrow(/unavailable/);
    expect(legacy.trade).not.toHaveBeenCalled();
  });
});
