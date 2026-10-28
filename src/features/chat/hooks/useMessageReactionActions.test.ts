import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../lib/appShared';
import type { ChatReactionWriteResult } from '../../../lib/chatReactionsV1Actions';
import useMessageReactionActions from './useMessageReactionActions';

const OWNER = '0x1111111111111111111111111111111111111111';
const CHAT = '0x2222222222222222222222222222222222222222';
const TX_HASH = `0x${'33'.repeat(32)}`;
const BLOCK_HASH = `0x${'44'.repeat(32)}`;
const CONVERSATION_ID = `0x${'55'.repeat(32)}`;

const targetMessage: ChatMessage = {
  id: 'direct-v2-message',
  direction: 'incoming',
  text: 'hello',
  txHash: TX_HASH,
  directV2: {
    protocol: 'direct-v2',
    contentState: 'available',
    chainId: '7082400',
    contractAddress: CHAT,
    conversationId: CONVERSATION_ID,
    messageId: '7',
    epoch: '1',
    senderSequence: '1',
    nonce: `0x${'66'.repeat(12)}`,
    transactionHash: TX_HASH,
    blockNumber: '100',
    blockHash: BLOCK_HASH,
    logIndex: 0,
    finality: 'finalized'
  }
};

const createArgs = () => {
  const submitChatReactionV1 = vi.fn(async () => ({
    event: { stateKey: 'reaction-state', blockNumber: '101' },
    transactionHash: TX_HASH
  } as unknown as ChatReactionWriteResult));
  const setError = vi.fn();
  const getReactionsForMessage = vi.fn((): Array<{
    emoji: string;
    count: number;
    reactedByMe: boolean;
  }> => []);
  const args = {
    activeContact: OWNER,
    activeGroupId: null,
    activeSignerSource: 'metamask',
    browserWalletLiteMode: true,
    directChatV2WritesRequired: true,
    currentWalletKeyRef: { current: OWNER.toLowerCase() },
    encodeMemoForActiveSigner: (value: string) => value,
    getMemoSigner: vi.fn(),
    getReactionsForMessage,
    groupFeeModeSelection: 'native',
    privateRewardTokenBalanceWei: 0n,
    requestChainWhisperFundingAfterError: vi.fn(),
    resolveGroupSubmitSelector: vi.fn(),
    resolveRequiredFeeForGroupSend: vi.fn(),
    resolveRequiredFeeForSend: vi.fn(),
    resolveRequiredTokenFeeForGroupSend: vi.fn(),
    resolveSubmitSelector: vi.fn(),
    runWalletTransactionFlow: async <T,>(operation: () => Promise<T>) => operation(),
    sendingReaction: false,
    setError,
    setMessagesByContact: vi.fn(),
    setMessagesByGroup: vi.fn(),
    setReactionPickerMessageId: vi.fn(),
    setSendingReaction: vi.fn(),
    setSessionOnboardInfo: vi.fn(),
    setWalletBalanceRefreshNonce: vi.fn(),
    syncConversationHistory: vi.fn(),
    syncGroupData: vi.fn(),
    submitChatReactionV1,
    walletAddress: OWNER
  } as unknown as Parameters<typeof useMessageReactionActions>[0];
  return { args, getReactionsForMessage, setError, submitChatReactionV1 };
};

describe('useMessageReactionActions ChatReactionsV1 routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses one public V2 reaction transaction from MetaMask without a legacy memo', async () => {
    const state = createArgs();
    const actions = useMessageReactionActions(state.args);

    await actions.sendReactionToMessage(targetMessage, '👍');

    expect(state.submitChatReactionV1).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({
        kind: 'direct',
        conversationId: CONVERSATION_ID,
        messageId: '7',
        blockHash: BLOCK_HASH
      }),
      emoji: '👍',
      active: true
    }));
    expect(state.setError).not.toHaveBeenCalledWith(expect.stringMatching(/\S/u));
  });

  it('writes desired state false when the owner clicks an existing reaction', async () => {
    const state = createArgs();
    state.getReactionsForMessage.mockReturnValue([{
      emoji: '👍',
      count: 2,
      reactedByMe: true
    }]);
    const actions = useMessageReactionActions(state.args);

    await actions.sendReactionToMessage(targetMessage, '👍');

    expect(state.submitChatReactionV1).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
  });

  it('admits only one wallet operation when two clicks race before React rerenders', async () => {
    const state = createArgs();
    let release: (() => void) | undefined;
    state.submitChatReactionV1.mockImplementationOnce(() => new Promise<ChatReactionWriteResult>((resolve) => {
      release = () => resolve({
        event: { stateKey: 'reaction-state', blockNumber: '101' },
        transactionHash: TX_HASH
      } as unknown as ChatReactionWriteResult);
    }));
    const actions = useMessageReactionActions(state.args);

    const first = actions.sendReactionToMessage(targetMessage, 'ðŸ‘');
    const second = actions.sendReactionToMessage(targetMessage, 'ðŸ‘');
    await second;

    expect(state.submitChatReactionV1).toHaveBeenCalledOnce();
    release?.();
    await first;
    expect(state.args.setSendingReaction).toHaveBeenNthCalledWith(1, true);
    expect(state.args.setSendingReaction).toHaveBeenLastCalledWith(false);
  });

  it('never falls back to legacy memo reactions when the V2 runtime is unavailable', async () => {
    const state = createArgs();
    state.args.submitChatReactionV1 = null;
    const actions = useMessageReactionActions(state.args);

    await actions.sendReactionToMessage(targetMessage, '👍');

    expect(state.setError).toHaveBeenCalledWith('Public reactions are not active for this chat deployment yet.');
  });

  it('surfaces the verified runtime boundary that made reactions unavailable', async () => {
    const state = createArgs();
    state.args.submitChatReactionV1 = null;
    state.args.unavailableReason = 'Reaction history source anchors could not be verified.';
    const actions = useMessageReactionActions(state.args);

    await actions.sendReactionToMessage(targetMessage, '👍');

    expect(state.submitChatReactionV1).not.toHaveBeenCalled();
    expect(state.setError).toHaveBeenCalledWith(
      'Reaction history source anchors could not be verified.'
    );
  });

  it('keeps every legacy chat message read-only after cutover', async () => {
    const state = createArgs();
    const legacyMessage = { ...targetMessage, id: 'legacy-message', directV2: undefined };
    const actions = useMessageReactionActions(state.args);

    await actions.sendReactionToMessage(legacyMessage, 'ðŸ‘');

    expect(state.submitChatReactionV1).not.toHaveBeenCalled();
    expect(state.setError).toHaveBeenCalledWith(
      'Legacy chat reactions are read-only after the V2 cutover.'
    );
  });

  it('submits a reaction immediately for a confirmed source-anchored V2 message', async () => {
    const state = createArgs();
    const confirmedMessage = {
      ...targetMessage,
      directV2: { ...targetMessage.directV2!, finality: 'confirmed' as const }
    };
    const actions = useMessageReactionActions(state.args);

    await actions.sendReactionToMessage(confirmedMessage, 'ðŸ‘');

    expect(state.submitChatReactionV1).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({
        conversationId: CONVERSATION_ID,
        messageId: '7',
        blockHash: BLOCK_HASH,
        transactionHash: TX_HASH
      })
    }));
    expect(state.setError).not.toHaveBeenCalledWith(expect.stringMatching(/finaliz|5 COTI blocks/iu));
  });
});
