import { describe, expect, it } from 'vitest';
import {
  buildMessageWithTradeReferencePayload,
  encodeCompactMemoPlaintext,
  RECURRING_OTC_CONTRACT_ADDRESS,
  type TradeMessageReferencePayload
} from './appShared';
import {
  buildDirectChatV2PromptEstimateMessage,
  buildDirectTradeV2PromptEstimateMessage,
  buildGroupChatV2PromptEstimateMessage,
  buildMetaMaskPromptEstimateMessage,
  estimateChatWalletPromptLoad
} from './chatWalletPromptEstimate';

describe('chatWalletPromptEstimate', () => {
  it('reports the Direct Chat V2 steady-state count for a known conversation', () => {
    const message = buildDirectChatV2PromptEstimateMessage('this message', 'existing');

    expect(message).toContain('estimates 1 wallet transaction');
    expect(message).toContain('0 COTI private-input confirmations');
    expect(message).not.toContain('2 wallet transactions');
    expect(message).not.toContain('app wallet');
  });

  it('reports the exact setup and send transactions for a new conversation', () => {
    const message = buildDirectChatV2PromptEstimateMessage('this reply', 'new');

    expect(message).toContain('2 wallet transactions total');
    expect(message).toContain('1 one-time setup + 1 send');
    expect(message).toContain('this reply');
    expect(message).toContain('0 COTI private-input confirmations');
  });

  it('reports both possible Direct Chat V2 counts while setup is being checked', () => {
    const message = buildDirectChatV2PromptEstimateMessage('this message', 'checking');

    expect(message).toContain('existing chat needs 1 wallet transaction');
    expect(message).toContain('new chat needs 2 total (setup + send)');
    expect(message).toContain('0 COTI private-input confirmations');
  });

  it('never falls back to legacy prompt math while Chat V2 initializes', () => {
    const message = buildDirectChatV2PromptEstimateMessage('this message', 'unavailable');

    expect(message).toContain('wallet estimate is not available yet');
    expect(message).toContain('legacy ChatGC encryption-prompt estimate does not apply');
    expect(message).not.toContain('about');
  });

  it('reports the Group Chat V2 shared-key message and reply count', () => {
    const message = buildGroupChatV2PromptEstimateMessage('this reply');

    expect(message).toContain('Group Chat V2 estimates 1 wallet transaction');
    expect(message).toContain('this reply');
    expect(message).toContain('shared group key locally');
    expect(message).toContain('0 COTI private-input confirmations');
    expect(message).not.toContain('encryption prompts');
    expect(message).not.toContain('app wallet');
  });

  it('reports a public Direct Trade V2 card without a parsed chat transaction', () => {
    expect(buildDirectTradeV2PromptEstimateMessage({
      offerAssetKind: 'erc20',
      offerSymbol: 'TEST'
    })).toBe(
      'Direct Trade V2 estimates 1 offer transaction. If TEST is not yet approved for this escrow, its one-time token approval adds 1 wallet transaction. The escrow event creates the chat card, so there is no separate chat-notification transaction.'
    );
  });

  it('reports packed private trade inputs and a conditional private approval separately', () => {
    const message = buildDirectTradeV2PromptEstimateMessage({
      offerAssetKind: 'private-erc20',
      offerSymbol: 'pTEST'
    });

    expect(message).toContain('2 packed COTI private-input confirmations plus 1 offer transaction');
    expect(message).toContain(
      'one-time private-token approval adds 1 COTI confirmation and 1 wallet transaction'
    );
    expect(message).toContain('no separate chat-notification transaction');
  });

  it('does not advertise a token approval for native Direct Trade V2 offers', () => {
    const message = buildDirectTradeV2PromptEstimateMessage({ offerAssetKind: 'native' });

    expect(message).toContain('Native COTI needs no token approval');
    expect(message).toContain('no separate chat-notification transaction');
  });

  it('estimates the encrypted string cells for short MetaMask messages', () => {
    const estimate = estimateChatWalletPromptLoad('trade at 0.25?', encodeCompactMemoPlaintext);

    expect(estimate.likelyMultipart).toBe(false);
    expect(estimate.estimatedEncryptedCellCount).toBe(3);
    expect(estimate.estimatedEncryptionPrompts).toBe(3);
    expect(estimate.estimatedWalletPrompts).toBe(4);
    expect(buildMetaMaskPromptEstimateMessage(estimate, 'this message with Trade #5 reference')).toContain(
      'this message with Trade #5 reference should fit single-send mode'
    );
    expect(buildMetaMaskPromptEstimateMessage(estimate)).toContain(
      '3 encryption prompts plus 1 transaction approval'
    );
  });

  it('includes hidden linked trade metadata in the MetaMask prompt estimate', () => {
    const tradeReference: TradeMessageReferencePayload = {
      version: 1,
      tradeId: 5,
      escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
      terminalPath: '/otcdesk/terminal/recurring?order=5'
    };
    const plainText = 'would you trade at 0.25?';
    const plainEstimate = estimateChatWalletPromptLoad(plainText, encodeCompactMemoPlaintext);
    const linkedPayload = buildMessageWithTradeReferencePayload(plainText, tradeReference);
    const linkedEstimate = estimateChatWalletPromptLoad(linkedPayload, encodeCompactMemoPlaintext);

    expect(plainEstimate.estimatedEncryptionPrompts).toBe(4);
    expect(linkedEstimate.likelyMultipart).toBe(false);
    expect(linkedEstimate.estimatedEncryptedCellCount).toBe(7);
    expect(linkedEstimate.estimatedEncryptionPrompts).toBe(7);
    expect(linkedEstimate.estimatedWalletPrompts).toBe(8);
    expect(linkedEstimate.estimatedEncryptionPrompts).toBeGreaterThan(plainEstimate.estimatedEncryptionPrompts);
    expect(buildMetaMaskPromptEstimateMessage(linkedEstimate, 'this message with Trade #5 reference')).toContain(
      'about 7 encryption prompts plus 1 transaction approval'
    );
  });

  it('includes hidden linked trade metadata even when the visible message is tiny', () => {
    const tradeReference: TradeMessageReferencePayload = {
      version: 1,
      tradeId: 5,
      escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
      terminalPath: '/otcdesk/terminal/recurring?order=5'
    };
    const plainEstimate = estimateChatWalletPromptLoad('122212', encodeCompactMemoPlaintext);
    const linkedPayload = buildMessageWithTradeReferencePayload('122212', tradeReference);
    const linkedEstimate = estimateChatWalletPromptLoad(linkedPayload, encodeCompactMemoPlaintext);

    expect(plainEstimate.estimatedEncryptionPrompts).toBe(1);
    expect(linkedEstimate.estimatedEncryptionPrompts).toBe(4);
    expect(linkedEstimate.estimatedWalletPrompts).toBe(5);
  });

  it('warns when a message is likely to spill into multipart prompts', () => {
    let seed = 123456789;
    const longMessage = Array.from({ length: 700 }, () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return String.fromCharCode(33 + (seed % 94));
    }).join('');
    const estimate = estimateChatWalletPromptLoad(
      longMessage,
      encodeCompactMemoPlaintext
    );

    expect(estimate.likelyMultipart).toBe(true);
    expect(estimate.estimatedWalletPrompts).toBeGreaterThan(1);
    expect(buildMetaMaskPromptEstimateMessage(estimate)).toContain('encryption prompts plus 1 transaction approval');
    expect(buildMetaMaskPromptEstimateMessage(estimate)).toContain('Chat V2 sends locally encrypted messages');
  });
});
