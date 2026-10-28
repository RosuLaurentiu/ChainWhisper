import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import useAppChainLookups from './useAppChainLookups';

const legacy = vi.hoisted(() => ({ fetch: vi.fn(), limit: vi.fn(), load: vi.fn(), range: vi.fn(), trade: vi.fn(), asset: vi.fn() }));
vi.mock('../../lib/appChain', () => ({ fetchTradeSnapshotById: legacy.trade, resolveTradeAssetSnapshot: legacy.asset }));
vi.mock('../../lib/appLookup', () => ({ fetchOnChainNicknames: legacy.fetch, getNicknameMaxLength: legacy.limit,
  loadMyNicknameFromChain: legacy.load, resolveConversationBlockRange: legacy.range }));
const owner = `0x${'11'.repeat(20)}`, peer = `0x${'22'.repeat(20)}`;
const create = (runtime: unknown, selected = true, tradeRuntime: unknown = null, tradeContracts?: readonly string[]) => {
  const cache = { current: {} as Record<string, string | null> }, setError = vi.fn(), setName = vi.fn();
  let actions!: ReturnType<typeof useAppChainLookups>;
  function Capture() {
    actions = useAppChainLookups({ directChatV2Runtime: runtime, directChatV2Selected: selected, directTradeV2Runtime: tradeRuntime, directTradeV2Contracts: tradeContracts,
      loadMyNicknameFromChainRef: { current: async () => '' }, myNickname: 'Name', nicknameMaxBytes: 64, onChainNicknameCacheRef: cache,
      privateRewardTokenDecimals: 6, privateRewardTokenSymbol: 'P', rewardTokenDecimals: 6, rewardTokenSymbol: 'R',
      setContacts: vi.fn(), setError, setMyNickname: setName, setNicknameMaxBytes: vi.fn(), setTradeSnapshotsById: vi.fn(), tradeSnapshotsById: {}, walletAddress: owner } as never);
    return null;
  }
  renderToString(<Capture />); return { actions, cache, setError, setName };
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
  it('retains legacy reads when V2 is not selected', async () => {
    const { actions } = create(null, false);
    expect(await actions.fetchOnChainNicknames([peer])).toEqual(new Map([[peer, 'Legacy']]));
    expect(await actions.getNicknameMaxLength()).toBe(64); expect(legacy.fetch).toHaveBeenCalledOnce();
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
  it('reads retained terms through their full reference without a legacy read', async () => {
    legacy.asset.mockImplementation(async (_kind, token, amount) => ({ kind: 'erc20', tokenAddress: token, amount: amount.toString(), decimals: 6, symbol: 'TEST' }));
    const read = vi.fn(async () => ({ tradeId: '7', maker: owner, taker: peer, status: 'open', createdAt: '1', expiresAt: '9999999999',
      parentTradeId: '0', replacementTradeId: '0', replacesTradeId: '0', amountMode: 'public', offerAmount: '10', requestAmount: '20',
      offerAsset: { assetType: 'erc20', token: owner }, requestAsset: { assetType: 'erc20', token: peer } }));
    const old = { contractAddress: retained, deployment: { chainId: '7082400' }, isCurrent: () => true, readTradeTerms: read };
    const selectedRead = vi.fn(), forReference = vi.fn(async () => old);
    const root = { ...old, contractAddress: current, readTradeTerms: selectedRead, forReference, supportedContracts: [current, retained] };
    const result = await create(null, true, root).actions.resolveTradeSnapshotForOffer(offer, { allowPrivatePrompt: false });
    expect(forReference).toHaveBeenCalledWith({ chainId: '7082400', contractAddress: retained, orderId: '7' });
    expect(read).toHaveBeenCalledWith(7, { decryptPrivateAmounts: false });
    expect(result).toMatchObject({ tradeId: 7, escrowContract: retained, offer: { amount: '10' } });
    expect(selectedRead).not.toHaveBeenCalled(); expect(legacy.trade).not.toHaveBeenCalled();
  });
  it('does not fall back to a legacy reader when an admitted Direct runtime is unavailable', async () => {
    legacy.trade.mockClear();
    await expect(create(null, true, null, [current, retained]).actions.resolveTradeSnapshotForOffer(offer)).rejects.toThrow(/unavailable/);
    expect(legacy.trade).not.toHaveBeenCalled();
  });
});
