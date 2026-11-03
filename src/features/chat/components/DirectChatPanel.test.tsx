import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Contact } from '../../../lib/appShared';
import { mergeUniqueContacts } from '../../../lib/appShared/parsers';
import MessageActions from '../../../shared/components/chat/MessageActions';
import DirectChatPanel, {
  canShowInChatTradeOffer,
  getDirectReplyActionPolicy,
  hasDirectMessageReplyReference
} from './DirectChatPanel';
import type { TradeOfferMessagePayload } from '../../../lib/appShared';

vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: ({ count }: { count: number }) => ({ getTotalSize: () => count * 108, getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 108, size: 108 })), measureElement: () => undefined }) }));

const legacyMessage: ChatMessage = {
  id: 'legacy-message',
  direction: 'incoming',
  text: 'legacy'
};

const directV2Message: ChatMessage = {
  id: 'direct-v2-message',
  direction: 'incoming',
  text: 'new protocol',
  directV2: {
    protocol: 'direct-v2',
    contentState: 'available',
    chainId: '7082400',
    contractAddress: '0x3333333333333333333333333333333333333333',
    conversationId: `0x${'44'.repeat(32)}`,
    messageId: '7',
    epoch: '1',
    senderSequence: '3',
    nonce: `0x${'55'.repeat(12)}`,
    transactionHash: `0x${'66'.repeat(32)}`,
    blockNumber: '100',
    blockHash: `0x${'77'.repeat(32)}`,
    logIndex: 0,
    finality: 'finalized'
  }
};

const renderDirectHistory = (syncingHistory: boolean, activeMessages: ChatMessage[] = [], loadingOlderHistory = false, privacyUnlocked = true,
  extra: Partial<ComponentProps<typeof DirectChatPanel>> = {}) =>
  renderToStaticMarkup(createElement(DirectChatPanel, {
    activeContact: '0x2222222222222222222222222222222222222222',
    walletAddress: '0x1111111111111111111111111111111111111111',
    activeMessages,
    syncingHistory,
    loadingOlderHistory,
    privacyUnlocked,
    activeContactMeta: { address: '0x2222222222222222222222222222222222222222', savedName: 'Secret saved name' },
    messageInput: 'Secret draft',
    replyingPreviewText: 'Secret reply',
    imageAttachmentStatus: { fileName: 'secret.png', previewUrl: 'blob:secret-attachment', title: 'Secret attachment', detail: 'Secret attachment detail', sizeLabel: '1 KB', tone: 'pending' },
    messageElementRefs: { current: {} },
    isReactionOnlyMessage: () => false,
    getReactionsForMessage: () => [],
    ...extra
  } as unknown as ComponentProps<typeof DirectChatPanel>));

describe('DirectChatPanel history state', () => {
  it('keeps a saved private name in the header and input after discovery refreshes', () => {
    const peer = '0x2222222222222222222222222222222222222222';
    const privateName = 'Synthetic owner label';
    let contacts: Contact[] = [{ address: peer, name: 'Public contact', savedName: privateName }];
    for (const discovered of [[peer], ['0x3333333333333333333333333333333333333333'], []]) {
      contacts = mergeUniqueContacts(contacts, discovered);
    }
    const extra = { activeContactMeta: contacts.find(contact => contact.address === peer) };
    const markup = renderDirectHistory(false, [directV2Message], false, true, extra);
    expect(markup).toContain(`${privateName} (0x2222`);
    expect(markup).toContain(`value="${privateName}"`);
    expect(renderDirectHistory(false, [directV2Message], false, false, extra)).not.toContain(privateName);
  });

  it('offers an explicit older page without hiding recent messages or exposing locked history', () => {
    const older = { hasOlderHistory: true, onLoadOlderHistory: vi.fn() };
    const markup = renderDirectHistory(false, [directV2Message], false, true, older);
    expect(markup).toContain('Load older messages');
    expect(markup).toContain('new protocol');
    expect(renderDirectHistory(false, [directV2Message], false, false, older)).not.toContain('Load older messages');
    expect(renderDirectHistory(false, [directV2Message], false, true,
      { ...older, hasOlderHistory: false })).not.toContain('Load older messages');
    expect(renderDirectHistory(false, [directV2Message], true, true, older))
      .toMatch(/disabled=""[^>]*>Loading older messages/u);
  });
  it('hides cached text, attachment, saved name and composer data while privacy is locked', () => {
    const markup = renderDirectHistory(false, [directV2Message], false, false);
    expect(markup).toContain('Unlock privacy');
    for (const secret of ['new protocol', 'Secret saved name', 'Secret draft', 'Secret reply', 'secret.png', 'blob:secret-attachment']) {
      expect(markup).not.toContain(secret);
    }
  });
  it('shows loading rather than verified-empty text during the current history sync', () => {
    const markup = renderDirectHistory(true);
    expect(markup).toContain('aria-label="Loading direct messages"');
    expect(markup).not.toContain('No messages yet');
  });

  it('keeps the existing empty state when no history read is pending', () => {
    const markup = renderDirectHistory(false);
    expect(markup).toContain('No messages yet');
    expect(markup).toContain('use Force sync');
    expect(markup).not.toContain('Sync History');
    expect(markup).not.toContain('aria-label="Loading direct messages"');
  });

  it('keeps the initial loading display for older-history reads', () => {
    expect(renderDirectHistory(false, [], true)).toContain('aria-label="Loading direct messages"');
  });

  it('does not replace retained message rows with an initial skeleton during sync', () => {
    const markup = renderDirectHistory(true, [directV2Message]);
    expect(markup).toContain('class="virtual-message-list"');
    expect(markup).not.toContain('aria-label="Loading direct messages"');
    expect(markup).not.toContain('No messages yet');
  });
});

describe('DirectChatPanel reply policy', () => {
  it('enables MetaMask replies only for stable Direct Chat V2 targets', () => {
    expect(getDirectReplyActionPolicy({
      directChatV2RepliesEnabled: true,
      message: directV2Message,
      walletPromptSensitiveActionsDisabled: true,
      walletPromptSensitiveActionsTitle: 'legacy disabled'
    })).toEqual({ disabled: false, title: 'Reply' });

    expect(getDirectReplyActionPolicy({
      directChatV2RepliesEnabled: true,
      message: legacyMessage,
      walletPromptSensitiveActionsDisabled: true,
      walletPromptSensitiveActionsTitle: 'legacy disabled'
    })).toEqual({
      disabled: true,
      title: 'Direct Chat V2 replies can target only new-protocol messages.'
    });
  });

  it('keeps the legacy wallet policy when V2 is inactive', () => {
    expect(getDirectReplyActionPolicy({
      directChatV2RepliesEnabled: false,
      message: directV2Message,
      walletPromptSensitiveActionsDisabled: true,
      walletPromptSensitiveActionsTitle: 'Use the ChainWhisper account.'
    })).toEqual({ disabled: true, title: 'Use the ChainWhisper account.' });

    expect(getDirectReplyActionPolicy({
      directChatV2RepliesEnabled: false,
      message: legacyMessage,
      walletPromptSensitiveActionsDisabled: false,
      walletPromptSensitiveActionsTitle: 'unused'
    })).toEqual({ disabled: false, title: 'Reply' });
  });

  it('renders a reply card for a stable V2 parent even without legacy preview metadata', () => {
    expect(hasDirectMessageReplyReference({
      ...directV2Message,
      replyToMessageId: 'direct-v2:7082400:chat:conversation:6'
    })).toBe(true);
    expect(hasDirectMessageReplyReference(directV2Message)).toBe(false);
  });
});

describe('DirectChatPanel trade privacy', () => {
  const offer: TradeOfferMessagePayload = {
    version: 2,
    tradeId: 23,
    escrowContract: '0x1111111111111111111111111111111111111111',
    maker: '0x2222222222222222222222222222222222222222',
    taker: '0x3333333333333333333333333333333333333333',
    createdAt: 1,
    expiresAt: 2
  };

  it('shows in-chat trade cards only after privacy unlock', () => {
    expect(canShowInChatTradeOffer(offer, false)).toBe(false);
    expect(canShowInChatTradeOffer(offer, true)).toBe(true);
  });
});

const renderMessageActions = (reactionDisclosure?: string) => renderToStaticMarkup(createElement(MessageActions, {
  message: directV2Message,
  pickerOpen: true,
  reactedEmojiSet: new Set<string>(),
  sendingReaction: false,
  reactionDisabled: false,
  reactionTitle: reactionDisclosure ? 'React publicly on-chain' : 'React',
  reactionDisclosure,
  replyDisabled: false,
  replyTitle: 'Reply',
  onToggleReactionPicker: () => undefined,
  onSendReaction: async () => undefined,
  onReplyToMessage: () => undefined
}));

describe('MessageActions reaction disclosure', () => {
  it('visibly and accessibly labels the public V2 reaction transaction', () => {
    const markup = renderMessageActions('Emoji reactions are public on-chain and need one wallet transaction.');

    expect(markup).toContain('Emoji reactions are public on-chain and need one wallet transaction.');
    expect(markup).toMatch(/aria-describedby="[^"]+-disclosure"/);
    expect(markup).toContain('aria-label="Public on-chain reaction');
  });

  it('does not mislabel a non-V2 reaction path as public', () => {
    const markup = renderMessageActions();

    expect(markup).not.toContain('public on-chain');
    expect(markup).not.toContain('aria-describedby=');
    expect(markup).toContain('aria-label="Reaction');
  });
});
