import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectTradeV2Runtime } from '../../../lib/directTradeV2Runtime';
import type { ChatMessage, TradeOfferMessagePayload, TradeSnapshot } from '../../../lib/appShared';
import useInChatTradeActions from './useInChatTradeActions';

const OWNER = '0x1111111111111111111111111111111111111111';
const PEER = '0x2222222222222222222222222222222222222222';
const CONTRACT = '0x3333333333333333333333333333333333333333';
const TOKEN_A = '0x4444444444444444444444444444444444444444';
const TOKEN_B = '0x5555555555555555555555555555555555555555';
const TX_HASH = `0x${'66'.repeat(32)}`;
const BLOCK_HASH = `0x${'77'.repeat(32)}`;

const snapshot: TradeSnapshot = {
  tradeId: 9,
  escrowContract: CONTRACT,
  maker: OWNER,
  taker: PEER,
  offer: { kind: 'erc20', tokenAddress: TOKEN_A, symbol: 'A', decimals: 18, amount: '10' },
  request: { kind: 'erc20', tokenAddress: TOKEN_B, symbol: 'B', decimals: 18, amount: '20' },
  createdAt: 1,
  expiresAt: 9_999_999_999,
  status: 'open',
  fillState: {
    remainingOfferAmount: '10',
    remainingRequestAmount: '20',
    filledOfferAmount: '0',
    filledRequestAmount: '0'
  }
};

const createRuntime = (execute: ReturnType<typeof vi.fn>): DirectTradeV2Runtime => ({
  contractAddress: CONTRACT,
  ownerAddress: OWNER.toLowerCase(),
  deployment: { chainId: '2632500' } as never,
  execute,
  readTradeTerms: vi.fn(),
  sync: vi.fn(),
  isCurrent: () => true,
  close: vi.fn()
}) as unknown as DirectTradeV2Runtime;

const createArgs = (runtime: DirectTradeV2Runtime) => {
  const sendMessage = vi.fn();
  const getMemoSigner = vi.fn();
  const requestTradeActionConfirmation = vi.fn(async () => true);
  const resolveTradeSnapshotForOffer = vi.fn(async () => snapshot);
  const args = {
    activeContact: PEER,
    activeSignerSource: 'metamask',
    creatingTrade: false,
    currentWalletKeyRef: { current: OWNER.toLowerCase() },
    directTradeV2Runtime: runtime,
    getMemoSigner,
    parsedTradeExpiryHours: 24,
    parsedTradeOfferAmountWei: 10n,
    parsedTradeRequestAmountWei: 20n,
    processingTradeActionId: '',
    preflightDirectMessageSend: vi.fn(() => true),
    requestTradeActionConfirmation,
    replyingToMessage: null,
    runWalletTransactionFlow: vi.fn(async <T,>(operation: () => Promise<T>) => operation()),
    resolveRequiredFeeForTradeCreate: vi.fn(),
    resolveTradeSnapshotForOffer,
    selectedTradeOfferToken: { kind: 'erc20', tokenAddress: TOKEN_A, symbol: 'A', decimals: 18 },
    selectedTradeRequestToken: { kind: 'erc20', tokenAddress: TOKEN_B, symbol: 'B', decimals: 18 },
    sendMessage,
    sendingRef: { current: false },
    setCreatingTrade: vi.fn(),
    setError: vi.fn(),
    setProcessingTradeActionId: vi.fn(),
    setReplyingToMessage: vi.fn(),
    setSessionOnboardInfo: vi.fn(),
    setTipComposerOpen: vi.fn(),
    setWalletBalanceRefreshNonce: vi.fn(),
    setTradeComposerOpen: vi.fn(),
    setTradeCounterContext: vi.fn(),
    setTradeCounterParentId: vi.fn(),
    setTradeExpiryHoursInput: vi.fn(),
    setTradeHidePrivateLiquidity: vi.fn(),
    setTradeOfferAmountInput: vi.fn(),
    setTradeOfferCustomTokenAddress: vi.fn(),
    setTradeOfferTokenSelection: vi.fn(),
    setTradeRequestAmountInput: vi.fn(),
    setTradeRequestCustomTokenAddress: vi.fn(),
    setTradeRequestTokenSelection: vi.fn(),
    setTradeSnapshotsById: vi.fn(),
    tipping: false,
    tradeComposerValidationMessage: '',
    tradeCounterContext: null,
    tradeCounterParentId: null,
    walletAddress: OWNER
  } as unknown as Parameters<typeof useInChatTradeActions>[0];
  return { args, getMemoSigner, requestTradeActionConfirmation, resolveTradeSnapshotForOffer, sendMessage };
};

const offer: TradeOfferMessagePayload = {
  version: 2,
  tradeId: 9,
  escrowContract: CONTRACT,
  maker: OWNER,
  taker: PEER,
  createdAt: 1,
  expiresAt: 9_999_999_999
};

const sourceMessage: ChatMessage = {
  id: 'direct-v2-card',
  direction: 'incoming',
  text: 'trade',
  timestamp: 1,
  directTradeV2: {
    protocol: 'direct-trade-v2',
    eventKind: 'opened',
    chainId: '2632500',
    contractAddress: CONTRACT,
    tradeId: '9',
    relatedTradeId: '0',
    transactionHash: TX_HASH,
    blockNumber: '1',
    blockHash: BLOCK_HASH,
    logIndex: 0,
    finality: 'finalized'
  }
};

describe('useInChatTradeActions Direct Trade V2 routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes retained card actions and counters to the original escrow while new offers use the selected escrow', async () => {
    const oldAddress = `0x${'88'.repeat(20)}`;
    const execute = vi.fn(async () => ({ tradeId: '10', transactionHash: TX_HASH }));
    const oldExecute = vi.fn(async () => ({ tradeId: '10', transactionHash: TX_HASH }));
    const root = createRuntime(execute), old = { ...createRuntime(oldExecute), contractAddress: oldAddress } as DirectTradeV2Runtime;
    const forReference = vi.fn(async () => old);
    const state = createArgs({ ...root, forReference } as DirectTradeV2Runtime);
    state.resolveTradeSnapshotForOffer.mockResolvedValue({ ...snapshot, escrowContract: oldAddress });
    const oldOffer = { ...offer, escrowContract: oldAddress };
    const oldMessage = { ...sourceMessage, directTradeV2: { ...sourceMessage.directTradeV2!, contractAddress: oldAddress } };
    const actions = useInChatTradeActions(state.args);
    for (const action of ['acceptTradeOffer', 'declineTradeOffer', 'cancelTradeOffer'] as const) {
      await actions[action](oldOffer, oldMessage);
    }
    state.resolveTradeSnapshotForOffer.mockResolvedValue({ ...snapshot, escrowContract: oldAddress, maker: PEER, taker: OWNER });
    await useInChatTradeActions(state.args).prepareCounterTrade(oldOffer, oldMessage);
    expect(forReference).toHaveBeenCalledWith({ chainId: '2632500', contractAddress: oldAddress, orderId: '9' });
    expect(oldExecute).toHaveBeenCalledTimes(3);
    expect(execute).not.toHaveBeenCalled();
    state.args.tradeCounterContext = { offer: oldOffer, sourceMessage: oldMessage };
    state.args.tradeCounterParentId = 9;
    await useInChatTradeActions(state.args).createTradeOffer();
    expect(oldExecute).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'counter-public', parentTradeId: 9 }));
    state.args.tradeCounterContext = null;
    state.args.tradeCounterParentId = null;
    await useInChatTradeActions(state.args).createTradeOffer();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ kind: 'create-public' }));
  });

  it.each(['chain', 'contract', 'id'] as const)('rejects mismatched card %s before review or execution', async kind => {
    const execute = vi.fn(), state = createArgs(createRuntime(execute));
    const identity = { ...sourceMessage.directTradeV2! };
    if (kind === 'chain') identity.chainId = '1';
    if (kind === 'contract') identity.contractAddress = TOKEN_A;
    if (kind === 'id') identity.tradeId = '10';
    await useInChatTradeActions(state.args).cancelTradeOffer(offer, { ...sourceMessage, directTradeV2: identity });
    expect(execute).not.toHaveBeenCalled();
    expect(state.requestTradeActionConfirmation).not.toHaveBeenCalled();
    expect(state.resolveTradeSnapshotForOffer).not.toHaveBeenCalled();
    expect(state.args.setError).toHaveBeenLastCalledWith(expect.stringMatching(/reference/));
  });

  it('creates the escrow offer without a parsed chat memo transaction', async () => {
    const execute = vi.fn(async (_action: unknown) => ({
      action: 'create-public',
      tradeId: '9',
      submittedTransactionHash: TX_HASH,
      transactionHash: TX_HASH,
      blockNumber: '1',
      blockHash: BLOCK_HASH,
      logIndex: 0
    }));
    const state = createArgs(createRuntime(execute));
    await useInChatTradeActions(state.args).createTradeOffer();

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][0]).toMatchObject({
      kind: 'create-public', taker: PEER, offerAmount: 10n, requestAmount: 20n
    });
    expect(state.sendMessage).not.toHaveBeenCalled();
    expect(state.getMemoSigner).not.toHaveBeenCalled();
    expect(state.requestTradeActionConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      primaryLabel: 'Create offer',
      stats: expect.arrayContaining([
        { label: 'COTI private inputs', value: '0 confirmations' },
        { label: 'Chat notification', value: '0 transactions' }
      ])
    }));
  });

  it('accepts a finalized V2 card without invoking legacy signer or memo paths', async () => {
    const execute = vi.fn(async (_action: unknown) => ({
      action: 'accept-public',
      tradeId: '9',
      nextStatus: '2',
      relatedTradeId: '0',
      submittedTransactionHash: TX_HASH,
      transactionHash: TX_HASH,
      blockNumber: '2',
      blockHash: BLOCK_HASH,
      logIndex: 0
    }));
    const state = createArgs(createRuntime(execute));
    await useInChatTradeActions(state.args).acceptTradeOffer(offer, sourceMessage);

    expect(execute).toHaveBeenCalledWith({
      kind: 'accept-public',
      tradeId: 9,
      expectedOfferAmount: 10n,
      expectedRequestAmount: 20n,
      requestAsset: { assetType: 'erc20', token: TOKEN_B }
    });
    expect(state.sendMessage).not.toHaveBeenCalled();
    expect(state.getMemoSigner).not.toHaveBeenCalled();
    expect(state.requestTradeActionConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      primaryLabel: 'Buy',
      summaryRows: expect.arrayContaining([
        { label: 'You pay', value: '0.00000000000000002 B' },
        { label: 'You receive', value: '0.00000000000000001 A' }
      ])
    }));
  });

  it('does not submit a Direct Trade V2 action when the review is cancelled', async () => {
    const execute = vi.fn();
    const state = createArgs(createRuntime(execute));
    state.requestTradeActionConfirmation.mockResolvedValueOnce(false);

    await useInChatTradeActions(state.args).createTradeOffer();

    expect(state.requestTradeActionConfirmation).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(state.sendMessage).not.toHaveBeenCalled();
  });

  it('fails closed when Direct Trade V2 is unavailable instead of using the legacy trade or chat paths', async () => {
    const execute = vi.fn();
    const state = createArgs(createRuntime(execute));
    state.args.directTradeV2Runtime = null;

    await useInChatTradeActions(state.args).createTradeOffer();

    expect(state.args.setError).toHaveBeenCalledWith(
      'Direct Trade V2 is unavailable. No legacy trade or chat transaction was sent.'
    );
    expect(execute).not.toHaveBeenCalled();
    expect(state.sendMessage).not.toHaveBeenCalled();
    expect(state.getMemoSigner).not.toHaveBeenCalled();
  });

  it.each(['acceptTradeOffer', 'declineTradeOffer', 'cancelTradeOffer'] as const)(
    'keeps legacy parsed offers read-only for %s',
    async (actionName) => {
      const execute = vi.fn();
      const state = createArgs(createRuntime(execute));
      const legacyMessage: ChatMessage = { ...sourceMessage, directTradeV2: undefined };

      await useInChatTradeActions(state.args)[actionName](offer, legacyMessage);

      expect(state.args.setError).toHaveBeenCalledWith(
        expect.stringContaining('Legacy direct offers are read-only')
      );
      expect(execute).not.toHaveBeenCalled();
      expect(state.sendMessage).not.toHaveBeenCalled();
      expect(state.getMemoSigner).not.toHaveBeenCalled();
    }
  );

  it('does not prepare a counter from a legacy parsed offer', async () => {
    const execute = vi.fn();
    const state = createArgs(createRuntime(execute));
    const legacyMessage: ChatMessage = { ...sourceMessage, directTradeV2: undefined };

    await useInChatTradeActions(state.args).prepareCounterTrade(offer, legacyMessage);

    expect(state.args.setError).toHaveBeenCalledWith(
      'Legacy direct offers are read-only. Create a new Direct V2 offer instead.'
    );
    expect(state.resolveTradeSnapshotForOffer).not.toHaveBeenCalled();
    expect(state.sendMessage).not.toHaveBeenCalled();
    expect(state.getMemoSigner).not.toHaveBeenCalled();
  });
});
