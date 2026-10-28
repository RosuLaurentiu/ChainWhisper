import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChatReplySourceAnchor } from '../../../lib/chatReplySourceAnchor';
import type { GroupChatV2SessionController } from '../../../lib/groupChatV2Session';

const mocks = vi.hoisted(() => ({ sendChatImageAttachment: vi.fn() }));

vi.mock('../../../lib/chatImageAttachment', () => ({
  sendChatImageAttachment: mocks.sendChatImageAttachment
}));

import useGroupMessageActions from './useGroupMessageActions';

const OWNER = '0x1111111111111111111111111111111111111111';
const CONTRACT = '0x2222222222222222222222222222222222222222';
const TX_HASH = `0x${'33'.repeat(32)}`;
const BLOCK_HASH = `0x${'44'.repeat(32)}`;
const IMAGE_TAG = `[img:12345678-abcd-40ef-9234-567890abcdef|${'11'.repeat(32)}:${'22'.repeat(12)}|9|image/png]`;

const createArgs = () => {
  const send = vi.fn(async () => ({
    transactionHash: TX_HASH,
    event: {
      key: `group-v2:7082400:${CONTRACT}:7:1`,
      chainId: 7_082_400n,
      contractAddress: CONTRACT,
      groupId: 7n,
      messageId: 1n,
      epoch: 1n,
      membershipRevision: 1n,
      senderSequence: 1n,
      nonce: `0x${'55'.repeat(12)}`,
      transactionHash: TX_HASH,
      blockNumber: 100n,
      blockHash: BLOCK_HASH,
      logIndex: 0
    }
  }));
  const getGroupChatV2ImageSessionToken = vi.fn(async () => 'group-session-token');
  const groupChatV2Session = { send } as unknown as GroupChatV2SessionController;
  const setError = vi.fn();
  const args = {
    activeGroupId: 7,
    activeGroupIdRef: { current: 7 },
    browserWalletLiteMode: true,
    clearImageAttachmentStatus: vi.fn(),
    currentWalletKeyRef: { current: OWNER.toLowerCase() },
    encodeMemoForActiveSigner: (value: string) => value,
    getMemoSigner: vi.fn(),
    getGroupChatV2ImageSessionToken,
    groupFeeModeSelection: 'native',
    groupChatV2Session,
    isGroupChatV2ScopeCurrent: () => true,
    messageInput: 'hello',
    privateRewardTokenBalanceWei: 0n,
    replyingToMessage: null,
    resolveGroupSubmitSelector: vi.fn(),
    resolveRequiredFeeForGroupSend: vi.fn(),
    resolveRequiredTokenFeeForGroupSend: vi.fn(),
    runWalletTransactionFlow: async <T,>(operation: () => Promise<T>) => operation(),
    sendingGroupMessage: false,
    setError,
    setMessageInput: vi.fn(),
    setMessagesByGroup: vi.fn(),
    setReplyingToMessage: vi.fn(),
    setSendingGroupMessage: vi.fn(),
    setSessionOnboardInfo: vi.fn(),
    setWalletBalanceRefreshNonce: vi.fn(),
    setUploadingImage: vi.fn(),
    showImageAttachmentStatus: vi.fn(),
    syncGroupData: vi.fn(),
    uploadingImage: false,
    walletAddress: OWNER
  } as unknown as Parameters<typeof useGroupMessageActions>[0];
  return { args, getGroupChatV2ImageSessionToken, send, setError };
};

describe('useGroupMessageActions Group Chat V2 routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads with the wallet session and sends the exact encrypted image tag in one V2 message', async () => {
    const state = createArgs();
    mocks.sendChatImageAttachment.mockImplementationOnce(async (options: {
      sendImageTag: (tag: string) => Promise<string | undefined>;
      uploadAuthorization: { mode: string; protocol: string; token: () => Promise<string> };
    }) => {
      expect(options.uploadAuthorization).toMatchObject({
        mode: 'session',
        protocol: 'group-v2'
      });
      expect(await options.uploadAuthorization.token()).toBe('group-session-token');
      await expect(options.sendImageTag(IMAGE_TAG)).resolves.toBe(TX_HASH);
    });

    const actions = useGroupMessageActions(state.args);
    await actions.sendGroupImageMessage(new File(['encrypted'], 'image.png', { type: 'image/png' }));

    expect(state.getGroupChatV2ImageSessionToken).toHaveBeenCalledOnce();
    expect(state.send).toHaveBeenCalledWith(7n, { body: IMAGE_TAG });
    expect(state.setError).not.toHaveBeenCalledWith(expect.stringMatching(/disabled|not active/i));
  });

  it('still rejects a user-typed image tag', async () => {
    const state = createArgs();
    state.args.messageInput = IMAGE_TAG;
    const actions = useGroupMessageActions(state.args);

    await actions.sendGroupMessage();

    expect(state.send).not.toHaveBeenCalled();
    expect(state.setError).toHaveBeenCalledWith('Image messages are disabled for security reasons.');
  });

  it('encrypts a stable Group V2 reply target into the same message transaction', async () => {
    const state = createArgs();
    const parentMessage = {
      id: 'group-v2-parent',
      direction: 'incoming',
      text: 'parent message',
      txHash: TX_HASH,
      groupV2: {
        protocol: 'group-v2',
        contentState: 'available',
        chainId: '7082400',
        contractAddress: CONTRACT,
        groupId: '7',
        messageId: '5',
        epoch: '1',
        membershipRevision: '2',
        senderSequence: '1',
        nonce: `0x${'66'.repeat(12)}`,
        transactionHash: TX_HASH,
        blockNumber: '99',
        blockHash: BLOCK_HASH,
        logIndex: 0,
        finality: 'finalized'
      }
    } as const;
    state.args.replyingToMessage = parentMessage;
    const actions = useGroupMessageActions(state.args);

    await actions.sendGroupMessage();

    expect(state.send).toHaveBeenCalledWith(7n, {
      body: 'hello',
      replyToMessageId: 5n,
      replyToMessageAnchor: getChatReplySourceAnchor(parentMessage),
      replyPreview: 'parent message'
    });
  });

  it('fails closed without Group Chat V2 instead of sending a legacy memo', async () => {
    const state = createArgs();
    state.args.groupChatV2Session = null;
    const actions = useGroupMessageActions(state.args);

    await actions.sendGroupMessage();

    expect(state.send).not.toHaveBeenCalled();
    expect(state.setError).toHaveBeenCalledWith(
      'Group Chat V2 is unavailable. No legacy message was sent.'
    );
  });

  it('keeps legacy group messages readable but refuses them as V2 reply targets', async () => {
    const state = createArgs();
    state.args.replyingToMessage = {
      id: 'legacy-group-message',
      direction: 'incoming',
      text: 'legacy parent',
      txHash: TX_HASH
    };
    const actions = useGroupMessageActions(state.args);

    await actions.sendGroupMessage();

    expect(state.send).not.toHaveBeenCalled();
    expect(state.setError).toHaveBeenCalledWith(
      'Group Chat V2 replies can target only messages from the new group protocol.'
    );
  });
});
