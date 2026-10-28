import { describe, expect, it, vi } from 'vitest';
import type { OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import { PRIVATE_BOOK_V2_RUNTIME_HASH, type PrivateBookV2OrderView } from '../../../lib/privateBookV2Actions';
import { deriveTradeComposerModel, type TradeComposerModel } from '../../../lib/tradeComposer';
import { buildTradeCustomTokenInfoKey } from '../../../lib/appHelpers';
import { projectPrivateBookV2Snapshot } from '../../../lib/oneOffTradeV2Snapshot';
import { TradeActionConfirmationCancelledError, type TradeFundingPreflightInput } from '../../../lib/tradeActionConfirm';
import { buildLinkTradeV2Path } from '../../../lib/linkTradeV2Links';
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useCallback: <T,>(callback: T) => callback }));
vi.mock('../../../lib/otcV2ActionRuntime', () => ({ assertOtcV2ActionRuntime: (value: OtcV2ActionRuntime) => value }));
import useP2PTradeComposerActions from './useP2PTradeComposerActions';
const addr = (byte: string) => `0x${byte.repeat(20)}`;
const owner = addr('11'); const escrow = addr('44');
const offer = { kind: 'private-erc20' as const, tokenAddress: addr('22'), symbol: 'A', decimals: 0 };
const request = { ...offer, tokenAddress: addr('33'), symbol: 'B' };
const view: PrivateBookV2OrderView = { orderId: '7', maker: owner, status: 'open', mode: 'private-pair', offerAsset: { assetType: 'private-erc20', token: offer.tokenAddress, publicAmount: '0' }, requestAsset: { assetType: 'private-erc20', token: request.tokenAddress, publicAmount: '0' }, priceTerms: { offerAmount: '1', requestAmount: '2' }, revision: '1', fillCount: '0', fillPolicy: { partialFillsAllowed: false, minPartialFillBps: '0', maxFills: '0' }, createdAt: '1', expiresAt: '0', rootOrderId: '7', replacementOrderId: '0', replacesOrderId: '0', offerLocked: true, offerTokenCodeHash: `0x${'11'.repeat(32)}`, requestTokenCodeHash: `0x${'22'.repeat(32)}`, pairKey: `0x${'33'.repeat(32)}` };
const fixture = () => {
  const execute = vi.fn(async () => ({ orderId: '7', transactionHash: 'confirmed' }));
  const read = vi.fn(async () => view);
  const standard = vi.fn(async () => ({ tradeId: '7', transactionHash: 'confirmed' }));
  const direct = vi.fn(async () => ({ tradeId: '7', transactionHash: 'confirmed' }));
  const runtime = { isCurrent: () => true, deployments: {
    'private-v2': { protocol: 'private-v2', chainId: '7082400', contractAddress: escrow, runtimeBytecodeHash: PRIVATE_BOOK_V2_RUNTIME_HASH },
    'standard-v2': { chainId: '7082400', contractAddress: addr('55') }, 'direct-v2': { chainId: '7082400', contractAddress: addr('66') }
  }, privateBook: { execute, read }, standard, direct, privateTrade: vi.fn() } as unknown as OtcV2ActionRuntime;
  const model = { selectedTradeOfferToken: { ...offer }, selectedTradeRequestToken: { ...request }, parsedTradeOfferAmountWei: 100n,
    parsedTradeRequestAmountWei: 200n, tradeComposerValidationMessage: '', hiddenLiquidityActive: true, hiddenPriceOfferAmountWei: 1n,
    hiddenPriceRequestAmountWei: 2n, parsedTradeExpiryHours: 24 } as TradeComposerModel;
  const input: Parameters<typeof useP2PTradeComposerActions>[0] = {
    buildCurrentTradeSurfacePath: vi.fn(() => '/create'), buildTradeShareUrl: vi.fn(id => `link/${id}`), canEditPublicTrade: vi.fn(() => true),
    counterParentTrade: null, directTradeRecipientIsValid: true, directTradeRecipientNormalized: addr('77'), editingTrade: null,
    ensureTradeFunding: vi.fn(async (_details: TradeFundingPreflightInput) => undefined), loadWalletBalances: vi.fn(async () => undefined),
    mergeTradeSnapshot: vi.fn(), navigateToTradePath: vi.fn(), openTrade: vi.fn(), refreshMyTrades: vi.fn(async () => undefined), refreshPublicTrades: vi.fn(async () => undefined),
    runTradeWalletPromptFlow: async <T,>(fn: () => Promise<T>) => fn(), setCounterParentTrade: vi.fn(), setCreatedTradeId: vi.fn(),
    setCreatedTradeLink: vi.fn(), setCreatingTrade: vi.fn(), setDetailTrade: vi.fn(), setDirectTradeRecipient: vi.fn(), setEditingTrade: vi.fn(),
    setTradeActionError: vi.fn(), setTradeExpiryHoursInput: vi.fn(), setTradeHasNoExpiry: vi.fn(), setTradeHidePrivateLiquidity: vi.fn(),
    setTradeOfferAmountInput: vi.fn(), setTradeOfferCustomTokenAddress: vi.fn(), setTradeOfferTokenSelection: vi.fn(), setTradeRequestAmountInput: vi.fn(),
    setTradeRequestCustomTokenAddress: vi.fn(), setTradeRequestTokenSelection: vi.fn(), setTradeVisibility: vi.fn(), tradeComposerModel: model,
    tradeHasNoExpiry: true, tradeHidePrivateLiquidity: true, tradeVisibility: 'public', walletAddress: owner, walletKey: owner,
    onActionNotice: vi.fn(), otcV2ActionRuntime: runtime, refreshOneOffV2Trades: vi.fn()
  };
  return { input, model, runtime, execute, read, standard, direct };
};

const privateDirectCounterFixture = () => {
  const f = fixture(), deployment = f.runtime.deployments['direct-v2'];
  f.input.tradeVisibility = 'unlisted';
  f.input.tradeHidePrivateLiquidity = false;
  f.input.counterParentTrade = {
    tradeId: 3, escrowContract: deployment.contractAddress, maker: addr('77'), taker: owner,
    offer: { ...request, amount: '75000' }, request: { ...offer, amount: '25000' },
    hiddenLiquidity: true, createdAt: 1, expiresAt: 0, status: 'open',
    v2: { protocol: 'direct-v2', chainId: deployment.chainId, contractAddress: deployment.contractAddress, amountMode: 'private' }
  };
  return f;
};

describe('private Direct counters in the normal composer', () => {
  it('reviews the child terms then uses the exact parent and reversed private assets', async () => {
    const f = privateDirectCounterFixture();
    await useP2PTradeComposerActions(f.input).createTrade();
    expect(f.input.ensureTradeFunding).toHaveBeenCalledOnce();
    expect(f.direct).toHaveBeenCalledExactlyOnceWith({ kind: 'counter-private', parentTradeId: 3,
      offerToken: offer.tokenAddress, requestToken: request.tokenAddress, offerAmount: 100n, requestAmount: 200n, expiresAt: 0 });
    expect(f.input.setCreatedTradeId).toHaveBeenLastCalledWith(7);
    expect(f.input.setCreatedTradeLink).toHaveBeenLastCalledWith('link/7');
  });

  it.each(['chain', 'escrow', 'v2-contract'] as const)('rejects a mismatched parent %s before requesting confirmation', async mismatch => {
    const f = privateDirectCounterFixture(), parent = f.input.counterParentTrade!;
    f.input.counterParentTrade = { ...parent,
      ...(mismatch === 'chain' ? { v2: { ...parent.v2!, chainId: '1' } } :
        mismatch === 'escrow' ? { escrowContract: addr('88') } : { v2: { ...parent.v2!, contractAddress: addr('88') } }) };
    await useP2PTradeComposerActions(f.input).createTrade();
    expect(f.input.ensureTradeFunding).not.toHaveBeenCalled();
    expect(f.direct).not.toHaveBeenCalled();
    expect(f.input.setTradeActionError).toHaveBeenLastCalledWith(expect.stringMatching(/does not match/));
  });

  it('sends no counter when the owner cancels review', async () => {
    const f = privateDirectCounterFixture();
    f.input.ensureTradeFunding = vi.fn(async () => { throw new TradeActionConfirmationCancelledError(); });
    await useP2PTradeComposerActions(f.input).createTrade();
    expect(f.input.ensureTradeFunding).toHaveBeenCalledOnce();
    expect(f.direct).not.toHaveBeenCalled();
  });

  it('keeps the reviewed parent ID fixed while confirmation is open', async () => {
    const f = privateDirectCounterFixture();
    f.input.ensureTradeFunding = vi.fn(async () => { f.input.counterParentTrade!.tradeId = 99; });
    await useP2PTradeComposerActions(f.input).createTrade();
    expect(f.direct).toHaveBeenCalledWith(expect.objectContaining({ parentTradeId: 3 }));
  });
});

describe('Unlisted Link creation in the existing composer', () => {
  const reference = { chainId: '7082400', escrow, id: '9007199254740993', revision: '1', credentialEpoch: '1' };
  const sharePath = buildLinkTradeV2Path(reference, `0x${'ab'.repeat(32)}`);
  const connect = (f: ReturnType<typeof fixture>) => {
    const create = vi.fn(async () => ({ reference, sharePath, transactionHash: 'confirmed' }));
    Object.assign(f.runtime, { link: { create, ownerAddress: owner } });
    f.input.tradeVisibility = 'unlisted';
    return create;
  };
  it.each(['erc20', 'private-erc20'] as const)('reviews and opens the full-width %s Link without a legacy ID or snapshot', async kind => {
    const f = fixture(), create = connect(f);
    f.model.selectedTradeOfferToken = { ...offer, kind };
    f.model.selectedTradeRequestToken = { ...request, kind };
    await useP2PTradeComposerActions(f.input).createTrade();
    expect(create).toHaveBeenCalledWith({ offerBudget: '100', terms: {
      offerToken: offer.tokenAddress, requestToken: request.tokenAddress, privatePair: kind === 'private-erc20',
      priceOffer: '1', priceRequest: '2', expiresAt: '0' } });
    expect(f.input.ensureTradeFunding).toHaveBeenCalledWith(expect.objectContaining({ confirmationPolicy: 'always',
      requirements: [expect.objectContaining({ amountWei: 100n })], tradeSummary: expect.arrayContaining([
        { label: 'Access', value: 'Shared link' }, { label: 'Price', value: '1 A for 2 B' }]) }));
    expect(f.input.navigateToTradePath).toHaveBeenCalledWith(sharePath);
    expect(f.input.setCreatedTradeLink).toHaveBeenCalledWith(expect.stringContaining(sharePath));
    expect(f.input.setCreatedTradeId).not.toHaveBeenCalledWith(Number(reference.id));
    expect(f.input.mergeTradeSnapshot).not.toHaveBeenCalled();
    expect(f.standard).not.toHaveBeenCalled(); expect(f.direct).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  });
  it.each(['runtime', 'mixed', 'disclosure'] as const)('holds %s before funding', async failure => {
      const f = fixture(), create = connect(f);
      if (failure === 'runtime') Object.assign(f.runtime, { link: undefined });
      if (failure === 'mixed') f.model.selectedTradeRequestToken = { ...request, kind: 'erc20' };
      if (failure === 'disclosure') f.input.tradeHidePrivateLiquidity = false;
      await useP2PTradeComposerActions(f.input).createTrade();
      expect(create).not.toHaveBeenCalled(); expect(f.input.ensureTradeFunding).not.toHaveBeenCalled();
      expect(f.standard).not.toHaveBeenCalled(); expect(f.direct).not.toHaveBeenCalled();
  });
  it('does not send after cancelled review and preserves confirmed creation after a display failure', async () => {
    const cancelled = fixture(), create = connect(cancelled);
    vi.mocked(cancelled.input.ensureTradeFunding!).mockRejectedValue(new TradeActionConfirmationCancelledError());
    await useP2PTradeComposerActions(cancelled.input).createTrade(); expect(create).not.toHaveBeenCalled();
    const f = fixture(), confirmed = connect(f);
    vi.mocked(f.input.loadWalletBalances).mockRejectedValue(new Error('Display unavailable.'));
    await useP2PTradeComposerActions(f.input).createTrade();
    expect(confirmed).toHaveBeenCalledOnce(); expect(f.input.setCreatedTradeLink).toHaveBeenCalledWith(expect.stringContaining(sharePath));
    expect(f.input.onActionNotice).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', txHash: 'confirmed' }));
  });
});
describe('private book composer hook; React hooks and runtime admission mocked', () => {
  it.each([['private-erc20', 'private-erc20'], ['private-erc20', 'erc20'], ['erc20', 'private-erc20']] as const)('passes the real form model into current creation for %s / %s', async (offerKind, requestKind) => {
    const f = fixture();
    f.input.tradeComposerModel = deriveTradeComposerModel({
      activeContact: null, walletAddress: owner, isSelfChat: false, onCotiNetwork: true, creatingTrade: false,
      sending: false, tipping: false, tradeFeeModeSelection: 'coti',
      tradeOfferTokenSelection: offerKind === 'erc20' ? 'custom-public' : 'custom-private',
      tradeRequestTokenSelection: requestKind === 'erc20' ? 'custom-public' : 'custom-private',
      tradeOfferCustomTokenAddress: offer.tokenAddress, tradeRequestCustomTokenAddress: request.tokenAddress,
      tradeCustomOfferTokenKind: offerKind, tradeCustomRequestTokenKind: requestKind,
      customTradeTokenInfoByAddress: {
        [buildTradeCustomTokenInfoKey(offerKind, offer.tokenAddress)]: { kind: offerKind, address: offer.tokenAddress, symbol: 'A', decimals: 0, balanceWei: 100n, loading: false },
        [buildTradeCustomTokenInfoKey(requestKind, request.tokenAddress)]: { kind: requestKind, address: request.tokenAddress, symbol: 'B', decimals: 0, balanceWei: 0n, loading: false }
      },
      tradeOfferAmountInput: '100', tradeRequestAmountInput: '200', tradeExpiryHoursInput: '24', tradeHasNoExpiry: true,
      tradeHidePrivateLiquidity: true, rewardTokenSymbol: 'WISP', rewardTokenDecimals: 6,
      privateRewardTokenSymbol: 'p.WISP', privateRewardTokenDecimals: 6, tipNativeBalanceWei: 1n,
      rewardTokenBalanceWei: 0n, privateRewardTokenBalanceWei: 0n, tradeRequiredFeeWei: 0n, counterpartyRequired: false
    });
    f.read.mockResolvedValue({ ...view, mode: offerKind === 'erc20' ? 'public-offer-private-request' : requestKind === 'erc20' ? 'private-offer-public-request' : 'private-pair',
      offerAsset: { ...view.offerAsset, assetType: offerKind, publicAmount: offerKind === 'erc20' ? '100' : '0' }, requestAsset: { ...view.requestAsset, assetType: requestKind } });
    expect(f.input.tradeComposerModel.canSendTradeOffer).toBe(true);
    expect(f.input.tradeComposerModel.hiddenLiquidityActive).toBe(true);
    await useP2PTradeComposerActions(f.input).createTrade();
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ kind: 'create',
      offerAsset: { assetType: offerKind, token: offer.tokenAddress, amount: 100n },
      requestAsset: { assetType: requestKind, token: request.tokenAddress }, priceTerms: { offerAmount: 1n, requestAmount: 2n } }));
    expect(f.input.ensureTradeFunding).toHaveBeenCalledWith(expect.objectContaining({ tradeSummary: expect.arrayContaining([{ label: 'Public price', value: '1 A for 2 B' }]) }));
    expect(f.standard).not.toHaveBeenCalled(); expect(f.runtime.privateTrade).not.toHaveBeenCalled();
  });
  it.each([['private-erc20', 'private-erc20'], ['private-erc20', 'erc20'], ['erc20', 'private-erc20']] as const)('uses the current create API without fabricated capacity for %s / %s', async (offerKind, requestKind) => {
    const f = fixture();
    f.model.selectedTradeOfferToken = { ...offer, kind: offerKind }; f.model.selectedTradeRequestToken = { ...request, kind: requestKind };
    f.input.tradeHidePrivateLiquidity = offerKind === 'private-erc20';
    f.read.mockResolvedValue({ ...view, mode: offerKind === 'erc20' ? 'public-offer-private-request' : requestKind === 'erc20' ? 'private-offer-public-request' : 'private-pair',
      offerAsset: { ...view.offerAsset, assetType: offerKind, publicAmount: offerKind === 'erc20' ? '100' : '0' }, requestAsset: { ...view.requestAsset, assetType: requestKind } });
    await useP2PTradeComposerActions(f.input).createTrade();
    expect(f.execute).toHaveBeenCalledOnce(); expect(f.runtime.privateTrade).not.toHaveBeenCalled();
    expect(f.input.ensureTradeFunding).toHaveBeenCalledWith(expect.objectContaining({ confirmationPolicy: 'always', tradeSummary: expect.arrayContaining([{ label: 'Public price', value: '1 A for 2 B' }]) }));
    expect(f.input.mergeTradeSnapshot).toHaveBeenCalledWith(expect.objectContaining({ offer: expect.objectContaining({ amount: '1' }) }));
    const snapshot = vi.mocked(f.input.mergeTradeSnapshot).mock.calls[0][0];
    expect(snapshot.fillState).toBeUndefined(); expect(snapshot.makerPrivateProgress).toBeUndefined();
    expect(f.input.setCreatedTradeId).toHaveBeenCalledWith(7);
  });
  it('keeps selected token metadata and terms fixed during confirmation', async () => {
    const f = fixture(); f.input.ensureTradeFunding = vi.fn(async () => { f.model.selectedTradeOfferToken!.tokenAddress = addr('88'); f.model.parsedTradeOfferAmountWei = 999n; });
    await useP2PTradeComposerActions(f.input).createTrade();
    expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ offerAsset: { assetType: 'private-erc20', token: offer.tokenAddress, amount: 100n } }));
  });
  it('requires confirmation and respects cancellation before sending', async () => {
    const f = fixture(); f.input.ensureTradeFunding = undefined;
    await useP2PTradeComposerActions(f.input).createTrade(); expect(f.execute).not.toHaveBeenCalled();
    f.input.ensureTradeFunding = vi.fn(async () => { throw new TradeActionConfirmationCancelledError(); });
    await useP2PTradeComposerActions(f.input).createTrade(); expect(f.execute).not.toHaveBeenCalled();
  });
  it('preserves confirmed ID and link through failed display and list refresh', async () => {
    const f = fixture(); f.read.mockRejectedValue(new Error('view unavailable'));
    f.input.refreshMyTrades = vi.fn(async () => { throw new Error('list unavailable'); });
    await useP2PTradeComposerActions(f.input).createTrade();
    expect(f.input.setCreatedTradeId).toHaveBeenLastCalledWith(7); expect(f.input.setCreatedTradeLink).toHaveBeenLastCalledWith('link/7');
    expect(f.input.setTradeActionError).toHaveBeenLastCalledWith(expect.stringContaining('do not create it again'));
    expect(f.input.mergeTradeSnapshot).not.toHaveBeenCalled(); expect(f.execute).toHaveBeenCalledOnce();
    expect(f.input.onActionNotice).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'success', txHash: 'confirmed' }));
  });
  it.each(['public', 'direct'] as const)('preserves the public-token %s creation API', async visibility => {
    const f = fixture(); f.model.selectedTradeOfferToken = { ...offer, kind: 'erc20' }; f.model.selectedTradeRequestToken = { ...request, kind: 'erc20' };
    f.input.tradeVisibility = visibility; f.input.tradeHidePrivateLiquidity = false;
    await useP2PTradeComposerActions(f.input).createTrade();
    expect(visibility === 'direct' ? f.direct : f.standard).toHaveBeenCalledOnce(); expect(f.execute).not.toHaveBeenCalled();
  });
  it('preserves private Direct creation on the retained API', async () => {
    const f = fixture(); f.input.tradeVisibility = 'direct';
    await useP2PTradeComposerActions(f.input).createTrade();
    expect(f.direct).toHaveBeenCalledWith(expect.objectContaining({ kind: 'create-private', offerAmount: 100n, requestAmount: 200n }));
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('rejects a current-book edit on the old runtime before funding', async () => {
    const f = fixture();
    f.input.editingTrade = projectPrivateBookV2Snapshot({ view, deployment: f.runtime.deployments['private-v2'], viewer: owner, resolveTokenMetadata: () => ({ symbol: 'A', decimals: 0 }) });
    f.input.otcV2ActionRuntime = { ...f.runtime, deployments: { ...f.runtime.deployments, 'private-v2': { ...f.runtime.deployments['private-v2'], runtimeBytecodeHash: `0x${'88'.repeat(32)}` } } };
    await useP2PTradeComposerActions(f.input).createTrade();
    expect(f.input.ensureTradeFunding).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled(); expect(f.runtime.privateTrade).not.toHaveBeenCalled();
  });
  it('requires a maker-only budget before prefilling a current-book edit', () => {
    const f = fixture();
    const snapshot = projectPrivateBookV2Snapshot({ view, deployment: f.runtime.deployments['private-v2'], viewer: owner, resolveTokenMetadata: () => ({ symbol: 'A', decimals: 0 }) });
    useP2PTradeComposerActions(f.input).beginEditTrade(snapshot);
    expect(f.input.setEditingTrade).not.toHaveBeenCalled(); expect(f.input.setTradeOfferAmountInput).not.toHaveBeenCalled();
    expect(f.input.setTradeActionError).toHaveBeenCalledWith(expect.stringContaining('private escrow budget'));
  });
  it('prefills from maker capacity and sends a fresh-bound replacement without a fabricated parent status', async () => {
    const f = fixture();
    const snapshot = projectPrivateBookV2Snapshot({ view, deployment: f.runtime.deployments['private-v2'], viewer: owner, resolveTokenMetadata: () => ({ symbol: 'A', decimals: 0 }),
      account: { orderId: '7', sequence: '1', totalOfferAmount: '100', remainingOfferAmount: '100', totalRequestAmount: '200' } });
    useP2PTradeComposerActions(f.input).beginEditTrade(snapshot);
    expect(f.input.setTradeOfferAmountInput).toHaveBeenCalledWith('100'); expect(f.input.setTradeRequestAmountInput).toHaveBeenCalledWith('200');
    f.input.editingTrade = snapshot;
    f.execute.mockResolvedValue({ orderId: '8', transactionHash: 'confirmed' });
    f.read.mockResolvedValueOnce(view).mockResolvedValue({ ...view, orderId: '8', replacesOrderId: '7' });
    await useP2PTradeComposerActions(f.input).createTrade();
    expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ kind: 'replace', originalOrderId: 7 }));
    expect(f.input.mergeTradeSnapshot).toHaveBeenCalledTimes(1);
    expect(f.input.mergeTradeSnapshot).toHaveBeenCalledWith(expect.objectContaining({ tradeId: 8, replacesTradeId: 7 }));
  });
});
