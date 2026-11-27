import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChatReplySourceAnchor } from '../../../lib/chatReplySourceAnchor';
import type { GroupChatV2SessionController } from '../../../lib/groupChatV2Session';
import { ChatTransactionUnconfirmedError } from '../../../lib/chatSubmittedTransaction';
import type { ChatMessage } from '../../../lib/appShared';

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

  it.each([8, null])('preserves the new composer after switching from the sending group to %s', async (target) => {
    const state = createArgs();
    const receipt = await state.send();
    let complete!: (value: typeof receipt) => void;
    state.send.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = useGroupMessageActions(state.args).sendGroupMessage();
    state.args.activeGroupIdRef.current = target as number;
    complete(receipt);
    await expect(pending).resolves.toBe(TX_HASH);
    expect(state.args.setMessageInput).not.toHaveBeenCalled();
    expect(state.args.setReplyingToMessage).not.toHaveBeenCalled();
    const calls = vi.mocked(state.args.setMessagesByGroup).mock.calls;
    const update = calls[calls.length - 1][0];
    expect(typeof update).toBe('function');
    if (typeof update === 'function') {
      const optimistic = vi.mocked(state.args.setMessagesByGroup).mock.calls[0]![0];
      const messages = typeof optimistic === 'function' ? optimistic({}) : optimistic;
      expect(update(messages)['7'][0]).toMatchObject({ deliveryState: 'sent', txHash: TX_HASH });
    }
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

  const applyUpdates = (setMessagesByGroup: unknown, initial: Record<string, ChatMessage[]> = {}) =>
    vi.mocked(setMessagesByGroup as (next: unknown) => void).mock.calls.reduce<Record<string, ChatMessage[]>>(
      (state, [update]) => (typeof update === 'function' ? update(state) : update as Record<string, ChatMessage[]>),
      initial
    );

  it('keeps a broadcast message as submitted with its txHash when the receipt wait times out', async () => {
    const state = createArgs();
    state.send.mockRejectedValueOnce(new ChatTransactionUnconfirmedError('confirmation timed out', TX_HASH));

    await expect(useGroupMessageActions(state.args).sendGroupMessage()).resolves.toBe(TX_HASH);

    const messages = applyUpdates(state.args.setMessagesByGroup)['7'];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ deliveryState: 'submitted', txHash: TX_HASH, text: 'hello' });
    expect(messages[0].id.startsWith('local-group-v2-')).toBe(true);
    expect(state.args.setMessageInput).toHaveBeenCalledWith('');
    expect(state.setError).toHaveBeenLastCalledWith(expect.stringContaining('Do not send it again'));
    expect(state.send).toHaveBeenCalledOnce();
  });

  it('drops the submitted local copy when history already holds the same transaction', async () => {
    const state = createArgs();
    const confirmed: ChatMessage = {
      id: `group-v2:7082400:${CONTRACT}:7:1`,
      direction: 'outgoing',
      text: 'hello',
      txHash: TX_HASH
    };
    state.send.mockRejectedValueOnce(new ChatTransactionUnconfirmedError('confirmation timed out', TX_HASH));

    await useGroupMessageActions(state.args).sendGroupMessage();

    expect(applyUpdates(state.args.setMessagesByGroup, { '7': [confirmed] })['7']).toEqual([confirmed]);
  });

  it('still marks a pre-broadcast wallet rejection as failed and keeps the composer text', async () => {
    const state = createArgs();
    state.send.mockRejectedValueOnce(Object.assign(new Error('user rejected transaction'), { code: 'ACTION_REJECTED' }));

    await expect(useGroupMessageActions(state.args).sendGroupMessage()).resolves.toBeUndefined();

    const messages = applyUpdates(state.args.setMessagesByGroup)['7'];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ deliveryState: 'failed' });
    expect(messages[0].txHash).toBeUndefined();
    expect(state.args.setMessageInput).not.toHaveBeenCalled();
  });
});
