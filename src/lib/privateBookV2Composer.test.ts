import { describe, expect, it, vi } from 'vitest';
import { CURRENT_P2P_BINDING } from './currentP2PBinding';
import { buildPrivateBookV2ComposerAction, executePrivateBookV2Composer } from './privateBookV2Composer';
import { PRIVATE_BOOK_V2_RUNTIME_HASH, type PrivateBookV2OrderView } from './privateBookV2Actions';
import { projectPrivateBookV2Snapshot } from './oneOffTradeV2Snapshot';
import type { OtcV2ActionRuntime } from './otcV2ActionRuntime';
import type { OtcV2ConfirmationDetails } from './otcV2Confirmation';
vi.mock('./otcV2ActionRuntime', () => ({ assertOtcV2ActionRuntime: (value: OtcV2ActionRuntime) => value }));
const address = (byte: string) => `0x${byte.repeat(20)}`;
const owner = address('11');
const offerToken = { kind: 'private-erc20' as const, tokenAddress: address('22'), symbol: 'A', decimals: 0 };
const requestToken = { ...offerToken, tokenAddress: address('33'), symbol: 'B' };
const deployment = { protocol: 'private-v2' as const, chainId: '7082400', contractAddress: address('44'), runtimeBytecodeHash: PRIVATE_BOOK_V2_RUNTIME_HASH };
const view: PrivateBookV2OrderView = { orderId: '7', maker: owner, status: 'open', mode: 'private-pair', offerAsset: { assetType: 'private-erc20', token: offerToken.tokenAddress, publicAmount: '0' }, requestAsset: { assetType: 'private-erc20', token: requestToken.tokenAddress, publicAmount: '0' }, priceTerms: { offerAmount: '1', requestAmount: '2' }, revision: '1', fillCount: '0', fillPolicy: { partialFillsAllowed: false, minPartialFillBps: '0', maxFills: '0' }, createdAt: '1', expiresAt: '0', rootOrderId: '7', replacementOrderId: '0', replacesOrderId: '0', offerLocked: true, offerTokenCodeHash: `0x${'11'.repeat(32)}`, requestTokenCodeHash: `0x${'22'.repeat(32)}`, pairKey: `0x${'33'.repeat(32)}` };
const input = () => ({ offerToken, requestToken, offerBudget: 100n, requestAtBudget: 200n, expiresAt: 0, disclosePrivateBudget: false });
const fixture = () => {
  const execute = vi.fn(async () => ({ orderId: '7', transactionHash: 'confirmed' }));
  const read = vi.fn(async () => view);
  const runtime = { isCurrent: () => true, deployments: { 'private-v2': deployment }, privateBook: { execute, read } } as unknown as OtcV2ActionRuntime;
  const confirm = vi.fn(async (_details: OtcV2ConfirmationDetails) => true);
  return { runtime, execute, read, confirm };
};
describe('private book creation producer; runtime admission mocked', () => {
  it('reviews and projects creation on the registered linked runtime', async () => {
    const f = fixture();
    const runtime = { ...f.runtime, deployments: { ...f.runtime.deployments, 'private-v2': { ...f.runtime.deployments['private-v2'], ...CURRENT_P2P_BINDING.deployments['private-v2'] } } };
    const result = await executePrivateBookV2Composer({ ...f, runtime, ...input(), action: buildPrivateBookV2ComposerAction(input()), walletAddress: owner });
    expect(f.confirm).toHaveBeenCalledOnce(); expect(f.execute).toHaveBeenCalledOnce();
    expect(result?.snapshot?.privateBook?.runtimeBytecodeHash).toBe(CURRENT_P2P_BINDING.deployments['private-v2'].runtimeBytecodeHash);
    expect(result?.snapshot?.offer.amount).toBe('1');
    expect(result?.snapshot?.privateBook?.ownerBudget).toBeUndefined();
  });
  it.each([['private-erc20', 'private-erc20'], ['private-erc20', 'erc20'], ['erc20', 'private-erc20']] as const)('uses price units and a separate budget for %s / %s', async (offerKind, requestKind) => {
    const f = fixture(); const terms = { ...input(), offerToken: { ...offerToken, kind: offerKind }, requestToken: { ...requestToken, kind: requestKind } };
    f.read.mockResolvedValue({ ...view, mode: offerKind === 'erc20' ? 'public-offer-private-request' : requestKind === 'erc20' ? 'private-offer-public-request' : 'private-pair',
      offerAsset: { ...view.offerAsset, assetType: offerKind, publicAmount: offerKind === 'erc20' ? '100' : '0' }, requestAsset: { ...view.requestAsset, assetType: requestKind } });
    const action = buildPrivateBookV2ComposerAction(terms);
    const result = await executePrivateBookV2Composer({ ...f, ...terms, action, walletAddress: owner });
    expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ offerAsset: expect.objectContaining({ amount: 100n }), priceTerms: { offerAmount: 1n, requestAmount: 2n } }));
    expect(f.confirm.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ tradeSummary: expect.arrayContaining([{ label: 'Offer budget', value: '100 A' }, { label: 'Public price', value: '1 A for 2 B' }]) }));
    expect(f.confirm.mock.calls[0]?.[0].confirmationStats).toContainEqual({ label: 'COTI private inputs', value: offerKind === 'erc20' ? '0 confirmations' : '1 confirmation' });
    expect(result?.snapshot?.offer.amount).toBe('1');
    expect(result?.snapshot?.makerPrivateProgress).toBeUndefined();
    expect(result?.snapshot?.fillState).toBeUndefined();
  });
  it('reviews upward unit-price rounding and the actual full-budget request', async () => {
    const f = fixture(); const terms = { ...input(), offerBudget: 3n, requestAtBudget: 4n };
    const action = buildPrivateBookV2ComposerAction(terms);
    await executePrivateBookV2Composer({ ...f, ...terms, action, walletAddress: owner });
    expect(action.priceTerms).toEqual({ offerAmount: 1n, requestAmount: 2n });
    expect(f.confirm.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ tradeSummary: expect.arrayContaining([{ label: 'Request at full budget', value: '6 B' }]) }));
  });
  it('requires a separate budget-publication review and rejects native form assets', () => {
    expect(() => buildPrivateBookV2ComposerAction({ ...input(), disclosePrivateBudget: true })).toThrow(/Publish original budget in Manage offer/);
    expect(() => buildPrivateBookV2ComposerAction({ ...input(), offerToken: { ...offerToken, kind: 'native' } })).toThrow(/ERC20/);
  });
  it('keeps the captured budget and price when a confirmation caller changes its input', async () => {
    const f = fixture(); const terms = input(); const action = buildPrivateBookV2ComposerAction(terms);
    const confirm = vi.fn(async () => { terms.offerBudget = 999n; terms.requestAtBudget = 1n; return true; });
    await executePrivateBookV2Composer({ ...f, ...terms, action, walletAddress: owner, confirm });
    expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ offerAsset: expect.objectContaining({ amount: 100n }), priceTerms: { offerAmount: 1n, requestAmount: 2n } }));
  });
  it('does not send on declined review or stale runtime', async () => {
    const f = fixture(); const action = buildPrivateBookV2ComposerAction(input());
    expect(await executePrivateBookV2Composer({ ...f, ...input(), action, walletAddress: owner, confirm: async () => false })).toBeUndefined();
    expect(f.execute).not.toHaveBeenCalled();
    await expect(executePrivateBookV2Composer({ ...f, ...input(), action, walletAddress: owner, runtime: { ...f.runtime, isCurrent: () => false } })).rejects.toThrow(/Refresh/);
  });
  it('keeps confirmed identity when the later public view read fails', async () => {
    const f = fixture(); f.read.mockRejectedValue(new Error('read unavailable'));
    const result = await executePrivateBookV2Composer({ ...f, ...input(), action: buildPrivateBookV2ComposerAction(input()), walletAddress: owner });
    expect(result).toMatchObject({ tradeId: 7, txHash: 'confirmed', snapshot: undefined, refreshError: expect.stringContaining('do not create it again') });
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it('binds replacement to fresh maker, deployment, revision and no fills before review', async () => {
    const f = fixture();
    const editingTrade = projectPrivateBookV2Snapshot({ view, deployment: deployment as never, viewer: owner, resolveTokenMetadata: () => ({ symbol: 'A', decimals: 0 }) });
    const action = buildPrivateBookV2ComposerAction({ ...input(), editingTrade });
    f.read.mockResolvedValue({ ...view, fillCount: '1' });
    await expect(executePrivateBookV2Composer({ ...f, ...input(), action, walletAddress: owner, editingTrade })).rejects.toThrow(/unfilled/);
    expect(f.confirm).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
    f.read.mockResolvedValue(view);
    await executePrivateBookV2Composer({ ...f, ...input(), action, walletAddress: owner, editingTrade });
    expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ kind: 'replace', originalOrderId: 7 }));
    await expect(executePrivateBookV2Composer({ ...f, ...input(), action, walletAddress: address('55'), editingTrade })).rejects.toThrow(/your current/);
  });
  it.each([{ revision: '2' }, { maker: address('55') }, { status: 'cancelled' as const }])('rejects a changed replacement source before funding: %s', async change => {
    const f = fixture();
    const editingTrade = projectPrivateBookV2Snapshot({ view, deployment: deployment as never, viewer: owner, resolveTokenMetadata: () => ({ symbol: 'A', decimals: 0 }) });
    f.read.mockResolvedValue({ ...view, ...change });
    await expect(executePrivateBookV2Composer({ ...f, ...input(), action: buildPrivateBookV2ComposerAction({ ...input(), editingTrade }), walletAddress: owner, editingTrade })).rejects.toThrow(/Refresh/);
    expect(f.confirm).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  });
});
