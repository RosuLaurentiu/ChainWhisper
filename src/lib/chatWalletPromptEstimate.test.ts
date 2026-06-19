import { describe, expect, it } from 'vitest';
import {
  buildMessageWithTradeReferencePayload,
  encodeCompactMemoPlaintext,
  RECURRING_OTC_CONTRACT_ADDRESS,
  type TradeMessageReferencePayload
} from './appShared';
import { buildMetaMaskPromptEstimateMessage, estimateChatWalletPromptLoad } from './chatWalletPromptEstimate';

describe('chatWalletPromptEstimate', () => {
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
    expect(buildMetaMaskPromptEstimateMessage(estimate)).toContain('Shorten it or switch to the app wallet');
  });
});
