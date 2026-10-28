import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChatReplySourceAnchor } from '../../../lib/chatReplySourceAnchor';
import type { DirectChatV2WriteCoordinator } from '../../../lib/directChatV2WriteCoordinator';

const mocks = vi.hoisted(() => ({
  sendChatImageAttachment: vi.fn()
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useCallback: <T,>(callback: T) => callback
  };
});

vi.mock('../../../lib/chatImageAttachment', () => ({
  sendChatImageAttachment: mocks.sendChatImageAttachment
}));

import useDirectMessageActions from './useDirectMessageActions';
import useConversationPreferenceActions from './useConversationPreferenceActions';

const OWNER = '0x1111111111111111111111111111111111111111';
const PEER = '0x2222222222222222222222222222222222222222';
const TX_HASH = `0x${'33'.repeat(32)}`;
const IMAGE_TAG = `[img:12345678-abcd-40ef-9234-567890abcdef|${'11'.repeat(32)}:${'22'.repeat(12)}|9|image/png]`;

const coordinator = (send: ReturnType<typeof vi.fn>): DirectChatV2WriteCoordinator => ({
  enabled: true,
  ownerAddress: OWNER,
  send
}) as unknown as DirectChatV2WriteCoordinator;

const createArgs = (directChatV2WriteCoordinator: DirectChatV2WriteCoordinator | null) => {
  const setError = vi.fn();
  const setMessageInput = vi.fn();
  const setReplyingToMessage = vi.fn();
  const getMemoSigner = vi.fn();
  const getDirectChatV2ImageSessionToken = vi.fn(async () => 'session-token');
  const args = {
    activeContact: PEER,
    activeContactRef: { current: PEER },
    activeLinkedTradeContext: null,
    activeMessages: [],
    activeSignerSource: 'metamask',
    browserWalletLiteMode: true,
    clearImageAttachmentStatus: vi.fn(),
    currentWalletKeyRef: { current: OWNER.toLowerCase() },
    directMessageMaxLength: 4_000,
    directChatV2WriteCoordinator,
    directChatV2WritesRequired: true,
    getDirectChatV2ImageSessionToken,
    encodeMemoForActiveSigner: (value: string) => value,
    getMemoSigner,
    getMemoSignerForAccount: vi.fn(),
    groupTipRecipientAddress: '',
    isDirectChatV2WriteScopeCurrent: () => true,
    messageInput: 'hello from V2',
    privateRewardTokenBalanceWei: 0n,
    privateRewardTokenDecimals: 6,
    privateRewardTokenSymbol: 'pWISP',
    replyingToMessage: null,
    requestChainWhisperFundingAfterError: vi.fn(),
    resolveRequiredFeeForSend: vi.fn(),
    resolveSubmitSelector: vi.fn(),
    rewardTokenBalanceWei: 0n,
    rewardTokenDecimals: 6,
    rewardTokenSymbol: 'WISP',
    runWalletTransactionFlow: async <T,>(operation: () => Promise<T>) => operation(),
    sendingRef: { current: false },
    setError,
    setMessageInput,
    setMessagesByContact: vi.fn(),
    setPrivateRewardTokenBalanceWei: vi.fn(),
    setReplyingToMessage,
    setRewardTokenBalanceWei: vi.fn(),
    setSending: vi.fn(),
    setSessionOnboardInfo: vi.fn(),
    setTipAmountInput: vi.fn(),
    setTipNativeBalanceWei: vi.fn(),
    setTipping: vi.fn(),
    setWalletBalanceRefreshNonce: vi.fn(),
    setUploadingImage: vi.fn(),
    showImageAttachmentStatus: vi.fn(),
    syncConversationHistory: vi.fn(),
    tipNativeBalanceWei: 0n,
    tipping: false,
    uploadingImage: false,
    walletAddress: OWNER,
    walletReadAccounts: []
  } as unknown as Parameters<typeof useDirectMessageActions>[0];
  return {
    args,
    getDirectChatV2ImageSessionToken,
    getMemoSigner,
    setError,
    setMessageInput,
    setReplyingToMessage
  };
};

describe('useDirectMessageActions Direct Chat V2 routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes an enabled MetaMask send only through the V2 coordinator', async () => {
    const send = vi.fn(async (_write: unknown) => ({ transactionHash: TX_HASH }));
    const state = createArgs(coordinator(send));
    const actions = useDirectMessageActions(state.args);

    await expect(actions.sendMessage()).resolves.toBe(TX_HASH);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({
      peer: PEER,
      payload: { body: 'hello from V2' },
      optimisticMessage: {
        accountRole: 'owner',
        deliveryState: 'pending',
        direction: 'outgoing',
        senderAddress: OWNER,
        text: 'hello from V2'
      }
    });
    expect(state.getMemoSigner).not.toHaveBeenCalled();
    expect(state.setMessageInput).toHaveBeenCalledWith('');
    expect(state.setReplyingToMessage).toHaveBeenCalledWith(null);
  });

  it('binds an immediate Direct V2 reply to the exact confirmed source event', async () => {
    const send = vi.fn(async (_write: unknown) => ({ transactionHash: TX_HASH }));
    const state = createArgs(coordinator(send));
    const parent = {
      id: 'direct-v2-parent',
      direction: 'incoming' as const,
      text: 'parent',
      txHash: TX_HASH,
      directV2: {
        protocol: 'direct-v2' as const,
        contentState: 'available' as const,
        chainId: '7082400',
        contractAddress: PEER,
        conversationId: `0x${'44'.repeat(32)}`,
        messageId: '5',
        epoch: '1',
        senderSequence: '1',
        nonce: `0x${'55'.repeat(12)}`,
        transactionHash: TX_HASH,
        blockNumber: '99',
        blockHash: `0x${'66'.repeat(32)}`,
        logIndex: 0,
        finality: 'confirmed' as const
      }
    };
    state.args.replyingToMessage = parent;
    const actions = useDirectMessageActions(state.args);

    await actions.sendMessage();

    expect(send.mock.calls[0][0]).toMatchObject({
      payload: {
        replyToMessageId: 5n,
        replyToMessageAnchor: getChatReplySourceAnchor(parent),
        replyPreview: 'parent'
      },
      optimisticMessage: {
        replyToMessageId: parent.id,
        replyToMessageAnchor: getChatReplySourceAnchor(parent)
      }
    });
  });

  it('reports a V2 failure without retrying or downgrading to legacy ChatGC', async () => {
    const send = vi.fn(async (_write: unknown) => {
      throw new Error('V2 submission rejected');
    });
    const state = createArgs(coordinator(send));
    const actions = useDirectMessageActions(state.args);

    await expect(actions.sendMessage()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
    expect(state.setError).toHaveBeenCalledWith(expect.stringMatching(/V2 submission rejected/));
    expect(state.getMemoSigner).not.toHaveBeenCalled();
  });

  it('fails closed while a configured V2 runtime is unavailable', async () => {
    const state = createArgs(null);
    const actions = useDirectMessageActions(state.args);

    await expect(actions.sendMessage()).resolves.toBeUndefined();
    expect(state.setError).toHaveBeenCalledWith(
      'Direct Chat V2 is unavailable or still initializing. No legacy message was sent.'
    );
    expect(state.getMemoSigner).not.toHaveBeenCalled();
  });

  it('routes encrypted images through a wallet-scoped session and keeps native tips in one V2 transaction', async () => {
    const send = vi.fn(async (_write: unknown) => ({ transactionHash: TX_HASH }));
    const state = createArgs(coordinator(send));
    state.args.tipNativeBalanceWei = 10n;
    mocks.sendChatImageAttachment.mockImplementationOnce(async (options: {
      sendImageTag: (tag: string) => Promise<string | undefined>;
      uploadAuthorization: { mode: string; protocol: string; token: () => Promise<string> };
    }) => {
      expect(options.uploadAuthorization.mode).toBe('session');
      expect(options.uploadAuthorization.protocol).toBe('direct-v2');
      expect(await options.uploadAuthorization.token()).toBe('session-token');
      await options.sendImageTag(IMAGE_TAG);
    });
    const actions = useDirectMessageActions(state.args);

    await actions.sendDirectImageMessage(new File(['encrypted'], 'cipher.bin'));
    await actions.sendTipToActiveContact('coti', 1n);

    expect(state.getDirectChatV2ImageSessionToken).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      peer: PEER,
      payload: expect.objectContaining({ body: IMAGE_TAG })
    }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      peer: PEER,
      payload: expect.objectContaining({
        body: '[TIP] You received 0.000000000000000001 COTI.',
        tip: 1n
      })
    }));
    expect(state.args.setTipAmountInput).toHaveBeenCalledWith('');
    expect(state.args.setTipping).toHaveBeenNthCalledWith(1, true);
    expect(state.args.setTipping).toHaveBeenLastCalledWith(false);
    expect(state.getMemoSigner).not.toHaveBeenCalled();
  });

  it('rejects token tips in V2 without sending or falling back to legacy chat', async () => {
    const send = vi.fn();
    const state = createArgs(coordinator(send));
    const actions = useDirectMessageActions(state.args);

    await actions.sendTipToActiveContact('wisp', 1n);

    expect(state.setError).toHaveBeenCalledWith(
      'Direct Chat V2 currently supports native COTI tips only.'
    );
    expect(send).not.toHaveBeenCalled();
  });
});

describe('Direct Chat V2 local preferences', () => {
  it('stores one unified private hidden state without a legacy chat memo', async () => {
    const getMemoSigner = vi.fn();
    const readContactSettings = vi.fn(async () => ({
      exists: true,
      revision: 2n,
      settings: { savedName: 'Bob', hidden: false }
    }));
    const setContactSettings = vi.fn(async () => ({
      exists: true,
      revision: 3n,
      settings: { savedName: 'Bob', hidden: true }
    }));
    const actions = useConversationPreferenceActions({
      activeSignerSource: 'metamask',
      browserWalletLiteMode: true,
      chainId: 7_082_400,
      directChatV2WritesRequired: true,
      directChatV2Session: { readContactSettings, setContactSettings },
      encodeMemoForActiveSigner: (value: string) => value,
      getMemoSigner,
      hasAesReady: true,
      requestChainWhisperFundingAfterError: vi.fn(),
      resolveRequiredFeeForSend: vi.fn(),
      resolveSubmitSelector: vi.fn(),
      runWalletTransactionFlow: async <T,>(operation: () => Promise<T>) => operation(),
      setError: vi.fn(),
      setSessionOnboardInfo: vi.fn(),
      setWalletBalanceRefreshNonce: vi.fn(),
      syncConversationHistory: vi.fn(),
      walletAddress: OWNER
    } as unknown as Parameters<typeof useConversationPreferenceActions>[0]);

    expect(actions).not.toHaveProperty('syncContactNameAliasFromInput');
    await expect(actions.syncConversationStateFromInput(PEER, { muted: true })).resolves.toBe(true);

    expect(readContactSettings).toHaveBeenCalledWith(PEER);
    expect(setContactSettings).toHaveBeenCalledWith(PEER, { savedName: 'Bob', hidden: true });
    expect(getMemoSigner).not.toHaveBeenCalled();
  });
});
