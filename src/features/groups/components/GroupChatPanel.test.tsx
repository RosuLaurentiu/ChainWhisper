import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../lib/appShared';
import GroupChatPanel, { getGroupReplyActionPolicy } from './GroupChatPanel';
import { createGroupChatV2DiscoveryRuntime } from '../../../lib/groupChatV2DiscoveryRuntime';
import { createGroupChatV2HistoryRuntime } from '../../../lib/groupChatV2HistoryRuntime';
import { createGroupChatV2ReadCursorStore } from '../../../lib/groupChatV2ReadCursorStore';
import type { GroupChatV2SessionController } from '../../../lib/groupChatV2Session';
import { buildGroupChatV2MessageKey, type GroupChatV2MessageEvent } from '../../../lib/groupChatV2Chain';
import { encryptGroupChatV2Message } from '../../../lib/groupChatV2Crypto';
import { encodeGroupChatV2Payload } from '../../../lib/groupChatV2Payload';

vi.mock('../../../lib/groupChatV2Session', async importOriginal => ({
  ...await importOriginal<typeof import('../../../lib/groupChatV2Session')>(),
  assertGroupChatV2SessionController: vi.fn()
}));

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
    mobileGroupActions: <button>Mobile admin fixture</button>, isMobileNav,
    mobileGroupOptionsOpen: true, onToggleMobileGroupOptions: noop,
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
  it('keeps older history available without claiming that an empty recent page is a new group', () => {
    const props = { ...panelProps(false), activeGroupMessages: [], hasOlderHistory: true,
      onLoadOlderHistory: vi.fn() };
    const html = renderToStaticMarkup(<GroupChatPanel {...props} />);
    expect(html).toContain('Load older messages');
    expect(html).toContain('No messages in this page');
    expect(html).not.toContain('No group messages yet');
    expect(html).not.toContain('>Refresh</button>');
    expect(renderToStaticMarkup(<GroupChatPanel {...props} loadingOlderHistory />))
      .toMatch(/disabled=""[^>]*>Loading older messages/);
  });
  it('labels a pending member roster without hiding verified history', () => {
    const props = panelProps(false);
    props.activeGroupMeta = { ...props.activeGroupMeta!, members: [], membersLoaded: false };
    props.activeGroupParticipants = [];
    const html = renderToStaticMarkup(<GroupChatPanel {...props} />);
    expect(html).toContain('Loading members');
    expect(html).toContain('Preserved group history');
    expect(html).not.toContain('No members loaded yet.');
  });

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
    expect(html).not.toContain('>Refresh</button>');
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

describe('former Group member history', () => {
  it.each([false, true])('keeps history and paging but removes membership actions (mobile=%s)', mobile => {
    const props = panelProps(false, mobile);
    props.activeGroupMeta = { ...props.activeGroupMeta!, membershipEnded: true };
    props.hasOlderHistory = true;
    props.onLoadOlderHistory = vi.fn();
    props.reactionPickerMessageId = 'text';
    props.getReactionsForMessage = () => [{ emoji: '👍', count: 1, reactedByMe: false }];
    const html = renderToStaticMarkup(<GroupChatPanel {...props} />);
    expect(html).toContain('Membership ended');
    expect(html).toContain('Preserved group history');
    expect(html).toContain('Retained group image');
    expect(html).toContain('Load older messages');
    for (const label of ['Archived', 'Send group message', 'Attach image', 'Invite fixture', 'Codes fixture',
      'Admin fixture', 'Mobile invite fixture', 'Mobile admin fixture', 'Make admin', '>Remove<', '>Group tools<',
      'group-members-dropdown', '>Admin</span>', '>Member</span>', 'reaction-picker']) expect(html).not.toContain(label);
    const actions = html.match(/<button[^>]*class="message-(reply-action|react-action|reaction-chip)"[^>]*>/g) ?? [];
    expect(actions).toHaveLength(6);
    expect(actions.every(button => button.includes('disabled=""'))).toBe(true);
    const recovery = renderToStaticMarkup(<GroupChatPanel {...props} groupEpochSyncRequired />);
    expect(recovery).toContain('authorized history key');
    expect(recovery).toContain('Sync group privacy');
    expect(recovery).not.toContain('new epoch');
    const empty = renderToStaticMarkup(<GroupChatPanel {...props} activeGroupMessages={[]} hasOlderHistory={false} />);
    expect(empty).toContain('No messages from your membership periods');
    expect(empty).not.toContain('Send the first message');
  });

  it('opens a discovered former membership and renders only its decrypted history after a fresh session', async () => {
    const props = panelProps(false), owner = props.walletAddress;
    const contractAddress = '0x2222222222222222222222222222222222222222', chainId = 7_082_400n, groupId = 4n;
    const hash = (block: bigint) => `0x${block.toString(16).padStart(64, '0')}`;
    const keys = [2n, 3n].map(epoch => ({ value: 123n, chainId, contractAddress, groupId, epoch, membershipRevision: epoch }));
    const events: GroupChatV2MessageEvent[] = await Promise.all(keys.map(async (key, index) => {
      const messageId = BigInt(index + 1), blockNumber = 105n + BigInt(index);
      const context = { ...key, sender: '0x3333333333333333333333333333333333333333', senderSequence: 1n, valueSent: 0n, feeTaken: 0n };
      const encrypted = await encryptGroupChatV2Message(encodeGroupChatV2Payload({ body: index
        ? 'After membership ended' : 'Authorized epoch two history' }), key, context);
      return { protocol: 'group-v2', key: buildGroupChatV2MessageKey({ chainId, contractAddress, groupId, messageId }),
        ...context, messageId, ...encrypted, encrypted, context, transactionHash: hash(messageId), blockNumber,
        blockHash: hash(blockNumber), logIndex: index, removed: false };
    }));
    const readEpochKey = vi.fn(async (_id: bigint, epoch: bigint) => {
      if (epoch !== 2n) throw new Error('Unauthorized current epoch');
      return keys[0];
    });
    const readMetadata = vi.fn(async () => { throw new Error('Unauthorized current title'); });
    const source = {
      ownerAddress: owner, manifest: { chainId, contractAddress, deploymentBlock: 101n, runtimeBytecodeHash: hash(1n) },
      latestBlock: async () => 120n,
      canonicalBlock: async (blockNumber: bigint) => ({ blockNumber, blockHash: hash(blockNumber), timestamp: Number(blockNumber) }),
      lifecyclePage: async () => [{ kind: 'member-removed', groupId, walletAddress: owner,
        blockNumber: 107n, blockHash: hash(107n), transactionHash: hash(10n), logIndex: 0 }],
      inspect: async () => ({ groupId, admin: owner, archived: false, createdBlock: 101n, createdAt: 101n, updatedAt: 110n,
        firstMessageBlock: 105n, lastMessageBlock: 106n, messageCount: 2n, memberCount: 1n }),
      inspectMember: async () => ({ active: false }),
      inspectInvite: async () => ({ pending: false, effective: false }),
      membershipRanges: async () => [{ generation: 1n, firstMessageId: 1n, lastMessageId: 1n,
        firstEpoch: 2n, lastEpoch: 2n, joinedRevision: 2n, leftRevision: 3n, joinedAt: 102n, leftAt: 107n }],
      messageCountAtBlock: async (_id: bigint, block: bigint) => BigInt(events.filter(event => event.blockNumber <= block).length),
      historyPage: async (_id: bigint, from: bigint, to: bigint) => events.filter(event => event.blockNumber >= from && event.blockNumber <= to),
      readEpochKey, readMetadata, clearEpochKeys: vi.fn()
    } as unknown as GroupChatV2SessionController;
    // A new runtime must recover the entry and keys without a saved group ID or private projection.
    for (let session = 0; session < 2; session++) {
      const discovery = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true, session: source });
      const history = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true, ownerAddress: owner, session: source });
      const cursors = createGroupChatV2ReadCursorStore({ broadcastFactory: () => ({ postMessage: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(), close: vi.fn() }) });
      try {
        const discovered = await discovery.sync();
        expect(discovered.groups).toHaveLength(1);
        const selected = discovered.groups[0];
        const loaded = await history.sync(BigInt(selected.id));
        expect(loaded.entries.map(entry => entry.text)).toEqual(['Authorized epoch two history']);
        expect(loaded.checkpoint?.lastMessageId).toBe(2n);
        expect(loaded.entries[0].groupV2?.contentState).toBe('available');
        const html = renderToStaticMarkup(<GroupChatPanel {...props} activeGroupId={selected.id}
          activeGroupMeta={selected} activeGroupMessages={[...loaded.entries]} hasOlderHistory={loaded.hasOlder} />);
        expect(html).toContain('Membership ended');
        expect(html).toContain('Authorized epoch two history');
        expect(html).not.toContain('After membership ended');
        expect(html).not.toContain('Send group message');
        expect(discovered.latestIncoming).toEqual([]);
        const readCanonicalAnchor = vi.fn(async (messageId: bigint, blockNumber: bigint) => {
          const event = events.find(item => item.messageId === messageId && item.blockNumber === blockNumber);
          return event ? { messageId, blockNumber, blockHash: (await source.canonicalBlock(blockNumber)).blockHash } : null;
        });
        const cursor = await cursors.advanceVisible({ chainId, contractAddress, walletAddress: owner, groupId }, loaded.entries[0], {
          getCanonicalMessageCount: () => source.messageCountAtBlock(groupId, 110n), readCanonicalAnchor
        });
        expect(cursor.lastReadMessageId).toBe('1');
        expect(readCanonicalAnchor).toHaveBeenCalledWith(1n, 105n);
        expect(discovered.incomingCompleteGroupIds).toEqual([]);
      } finally { discovery.close(); history.close(); cursors.close(); }
    }
    expect(readEpochKey).toHaveBeenCalledTimes(2);
    expect(readEpochKey.mock.calls.every(([, epoch]) => epoch === 2n)).toBe(true);
    expect(readMetadata).not.toHaveBeenCalled();
  });
});
