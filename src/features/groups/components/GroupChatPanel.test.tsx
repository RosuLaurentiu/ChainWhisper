import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../lib/appShared';
import GroupChatPanel, { getGroupReplyActionPolicy } from './GroupChatPanel';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 112,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 112 })),
    measureElement: vi.fn()
  })
}));
vi.mock('../../../shared/components/chat/ChatImage', () => ({ default: () => <span>Retained group image</span> }));
vi.mock('../../../shared/hooks/useVirtualizedPrependScrollAnchor', () => ({ default: vi.fn() }));

const confirmedMessage: ChatMessage = {
  id: 'group-v2-confirmed',
  direction: 'incoming',
  text: 'hello',
  groupV2: {
    protocol: 'group-v2',
    contentState: 'available',
    chainId: '7082400',
    contractAddress: '0x1111111111111111111111111111111111111111',
    groupId: '7',
    messageId: '2',
    epoch: '1',
    membershipRevision: '2',
    senderSequence: '1',
    nonce: `0x${'22'.repeat(12)}`,
    transactionHash: `0x${'33'.repeat(32)}`,
    blockNumber: '100',
    blockHash: `0x${'44'.repeat(32)}`,
    logIndex: 0,
    finality: 'confirmed'
  }
};

describe('Group Chat V2 reply policy', () => {
  it('allows a source-anchored reply as soon as the message receipt is confirmed', () => {
    expect(getGroupReplyActionPolicy({
      groupChatV2RepliesEnabled: true,
      message: confirmedMessage,
      walletPromptSensitiveActionsDisabled: true,
      walletPromptSensitiveActionsTitle: 'Unavailable'
    })).toEqual({ disabled: false, title: 'Reply' });
  });

  it('keeps legacy messages and unavailable V2 runtime fail closed for browser wallets', () => {
    expect(getGroupReplyActionPolicy({
      groupChatV2RepliesEnabled: true,
      message: { id: 'legacy', direction: 'incoming', text: 'legacy' },
      walletPromptSensitiveActionsDisabled: true,
      walletPromptSensitiveActionsTitle: 'Unavailable'
    }).disabled).toBe(true);
    expect(getGroupReplyActionPolicy({
      groupChatV2RepliesEnabled: false,
      message: confirmedMessage,
      walletPromptSensitiveActionsDisabled: true,
      walletPromptSensitiveActionsTitle: 'Unavailable'
    })).toEqual({ disabled: true, title: 'Unavailable' });
  });
});

const panelProps = (archived: boolean, isMobileNav = false): ComponentProps<typeof GroupChatPanel> => {
  const noop = () => undefined;
  const asyncNoop = async () => undefined;
  const owner = '0x1111111111111111111111111111111111111111';
  const other = '0x2222222222222222222222222222222222222222';
  const group = { id: 4, admin: owner, title: 'Existing group', isPrivate: true, createdAt: 1,
    memberCount: 2, members: [owner, other], lastBlock: 100, lastTimestamp: 100, archived };
  return {
    activeGroupId: 4, activeGroupMeta: group, isActiveGroupAdmin: true, activeGroupMemberCount: 2,
    activeGroupParticipants: [{ key: other, address: other, shortAddress: 'Bob', isSelf: false, isAdmin: false }],
    lastCopiedKey: null, onCopyWithFeedback: asyncNoop, processingGroupAction: false,
    onRemoveMember: asyncNoop, onTransferAdmin: asyncNoop, adminTransferEnabled: true,
    desktopJoinCodeList: <button>Codes fixture</button>, desktopInviteMenu: <button>Invite fixture</button>,
    mobileInviteTools: <button>Mobile invite fixture</button>, desktopGroupActions: <button>Admin fixture</button>,
    mobileGroupActions: <button>Mobile admin fixture</button>, isMobileNav, syncingGroups: false,
    mobileGroupOptionsOpen: true, onToggleMobileGroupOptions: noop, onRefreshGroup: noop,
    chatMessagesRef: { current: null }, messageLoadPhase: null, groupEpochSyncRequired: false,
    groupEpochSyncPending: false, onSynchronizeGroupEpoch: noop,
    activeGroupMessages: [{ ...confirmedMessage, id: 'text', text: 'Preserved group history', txHash: `0x${'33'.repeat(32)}` },
      { ...confirmedMessage, id: 'image', text: '[img:12345678-abcd-90ef-1234-567890abcdef|0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:0123456789abcdef01234567|1024|image/png]' }],
    isReactionOnlyMessage: () => false, getReactionsForMessage: () => [], reactionPickerMessageId: null,
    onToggleReactionPicker: noop, sendingReaction: false, onSendReaction: asyncNoop,
    walletPromptSensitiveActionsDisabled: false, walletPromptSensitiveActionsTitle: '', chatReactionsV1Enabled: true,
    groupChatV2RepliesEnabled: true, replyingToMessage: null, onReplyToMessage: noop, highlightedMessageId: null,
    messageElementRefs: { current: {} }, onJumpToReferencedMessage: noop, getReplyReferenceFallbackLabel: () => 'reference',
    walletAddress: owner, findContactNameForWalletAddress: () => undefined, replyingPreviewText: '', onCancelReply: noop,
    tipComposerOpen: false, onToggleTipComposer: noop, tipping: false, tipTokenSelection: 'coti',
    onTipTokenSelectionChange: noop, rewardTokenSymbol: 'WISP', privateRewardTokenSymbol: 'pWISP', tipAmountInput: '',
    onTipAmountInputChange: noop, activeTipTokenSymbol: 'COTI', tipAmountWeiFromInput: 0n,
    canSendGroupTipFromComposer: false, tipAmountExceedsBalance: false, tipAmountSummaryLabel: '', tipBalanceSummaryLabel: '',
    onSendTip: noop, groupTipRecipientAddress: '', onGroupTipRecipientChange: noop, activeGroupTipRecipients: [],
    selectedGroupTipRecipient: null, sendingGroupMessage: false, composerRef: { current: null }, onSendImage: noop,
    uploadingImage: false, imageAttachDisabled: false, imageAttachTitle: 'Attach image', onDismissImageAttachmentStatus: noop,
    onSendMessage: noop, maxMessageLength: 1024, onMessageInputChange: noop, onOpenInternalAppLink: noop
  };
};

describe('archived Group view', () => {
  it.each([false, true])('keeps history and reaction policy but removes new-message and admin tools (mobile=%s)', (mobile) => {
    const html = renderToStaticMarkup(<GroupChatPanel {...panelProps(true, mobile)} />);
    expect(html).toContain('Archived');
    expect(html).toContain('New messages are disabled.');
    expect(html).toContain('Preserved group history');
    expect(html).toContain('Retained group image');
    for (const label of ['Send group message', 'Attach image', 'Invite fixture', 'Codes fixture', 'Admin fixture',
      'Mobile invite fixture', 'Mobile admin fixture', 'Make admin', '>Remove<', '>Group tools<']) expect(html).not.toContain(label);
    const replies = html.match(/<button[^>]*class="message-reply-action"[^>]*>/g) ?? [];
    expect(replies).toHaveLength(2);
    expect(replies.every(button => button.includes('disabled=""'))).toBe(true);
    const reactions = html.match(/<button[^>]*class="message-react-action"[^>]*>/g) ?? [];
    expect(reactions[0]).not.toContain('disabled=""');
    expect(html).toContain('Refresh');
  });

  it.each([false, undefined])('retains normal controls when archived is %s', (archived) => {
    const props = panelProps(false);
    if (archived === undefined) delete props.activeGroupMeta!.archived;
    const html = renderToStaticMarkup(<GroupChatPanel {...props} />);
    expect(html).toContain('Send group message');
    expect(html).toContain('Invite fixture');
    expect(html).toContain('Codes fixture');
    expect(html).toContain('Admin fixture');
    expect(html).toContain('Make admin');
    expect(html).not.toContain('New messages are disabled.');
  });
});
