import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../lib/appShared';
import MessageActions from '../../../shared/components/chat/MessageActions';
import {
  canShowInChatTradeOffer,
  getDirectReplyActionPolicy,
  hasDirectMessageReplyReference
} from './DirectChatPanel';
import type { TradeOfferMessagePayload } from '../../../lib/appShared';

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
