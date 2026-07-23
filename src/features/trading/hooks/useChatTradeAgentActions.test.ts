import { describe, expect, it } from 'vitest';
import type { TradeAgentPaymentRetryRecord } from '../../../lib/tradeAgentPayment';
import {
  isChatTradeAgentRetryAvailable,
  selectChatTradeAgentRetry
} from './useChatTradeAgentActions';

const retryRecord = (clientSurface: 'chat' | 'otc-agent') =>
  ({
    context: { clientSurface },
    payerAddress: '0x1111111111111111111111111111111111111111'
  }) as unknown as TradeAgentPaymentRetryRecord;

describe('selectChatTradeAgentRetry', () => {
  it('hydrates only a retry created from Chat', () => {
    const chatRetry = retryRecord('chat');
    expect(selectChatTradeAgentRetry(chatRetry)).toBe(chatRetry);
    expect(selectChatTradeAgentRetry(retryRecord('otc-agent'))).toBeNull();
    expect(selectChatTradeAgentRetry(null)).toBeNull();
  });

  it('exposes the retry only to the wallet that paid for it', () => {
    const chatRetry = retryRecord('chat');
    expect(
      isChatTradeAgentRetryAvailable(
        chatRetry,
        '0x1111111111111111111111111111111111111111'
      )
    ).toBe(true);
    expect(
      isChatTradeAgentRetryAvailable(
        chatRetry,
        '0x2222222222222222222222222222222222222222'
      )
    ).toBe(false);
    expect(isChatTradeAgentRetryAvailable(chatRetry, '')).toBe(false);
  });
});
