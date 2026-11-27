import { describe, expect, it } from 'vitest';
import { CHAT_SEND_HELD_FOR_SUBMITTED_REASON, getChatSendHoldReason } from './chatSubmittedTransaction';

describe('getChatSendHoldReason', () => {
  it('holds a conversation only while it has a submitted outgoing message', () => {
    expect(getChatSendHoldReason([
      { direction: 'incoming' },
      { direction: 'outgoing', deliveryState: 'submitted' }
    ])).toBe(CHAT_SEND_HELD_FOR_SUBMITTED_REASON);
  });

  it.each(['pending', 'sent', 'failed', undefined] as const)('does not hold for outgoing state %s', (deliveryState) => {
    expect(getChatSendHoldReason([{ direction: 'outgoing', deliveryState }])).toBeNull();
  });

  it('does not hold an empty conversation or one with only incoming messages', () => {
    expect(getChatSendHoldReason([])).toBeNull();
    expect(getChatSendHoldReason([{ direction: 'incoming', deliveryState: 'submitted' }])).toBeNull();
  });
});
