import { describe, expect, it } from 'vitest';
import type { TradeAgentPaymentRetryRecord } from '../../../lib/tradeAgentPayment';
import {
  commitChatTradeAgentOriginMutation,
  completeIrreversibleChatTradeAgentPayment,
  isChatTradeAgentRetryAvailable,
  type ChatTradeAgentOperationOrigin,
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

const operationOrigin = (
  overrides: Partial<ChatTradeAgentOperationOrigin> = {}
): ChatTradeAgentOperationOrigin => ({
  conversationKey: 'contact:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  generation: 4,
  linkedTradeKey: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:17',
  operationId: 9,
  sourceMessageId: 'message-a',
  walletKey: '0x1111111111111111111111111111111111111111',
  walletSessionEpoch: 3,
  ...overrides
});

describe('commitChatTradeAgentOriginMutation', () => {
  it('does not apply a late reply to a different active conversation', () => {
    const startedForA = operationOrigin();
    const nowViewingB = operationOrigin({
      conversationKey: 'contact:0xcccccccccccccccccccccccccccccccccccccccc',
      generation: 5
    });
    let composer = 'draft already entered for contact B';

    expect(
      commitChatTradeAgentOriginMutation(startedForA, nowViewingB, () => {
        composer = 'private reply generated from contact A';
      })
    ).toBe(false);
    expect(composer).toBe('draft already entered for contact B');
  });

  it('preserves the payment hash when the conversation switches after broadcast', async () => {
    let resolvePayment!: (hash: string) => void;
    let originCurrent = true;
    const submittedPayment = new Promise<string>((resolve) => {
      resolvePayment = resolve;
    });
    const completion = (async () => {
      const paymentTxHash = await submittedPayment;
      return completeIrreversibleChatTradeAgentPayment(
        paymentTxHash,
        () => originCurrent
      );
    })();

    originCurrent = false;
    resolvePayment(`0x${'ab'.repeat(32)}`);

    await expect(completion).resolves.toEqual({
      originChanged: true,
      paymentTxHash: `0x${'ab'.repeat(32)}`
    });
  });

  it('rejects return-to-origin, wallet, source-message, linked-trade, and operation replacement races', () => {
    const started = operationOrigin();
    const changedOrigins = [
      operationOrigin({ generation: 6 }),
      operationOrigin({ walletKey: '0x2222222222222222222222222222222222222222' }),
      operationOrigin({ walletSessionEpoch: 4 }),
      operationOrigin({ sourceMessageId: 'message-b' }),
      operationOrigin({ linkedTradeKey: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:18' }),
      operationOrigin({ operationId: 10 })
    ];

    for (const current of changedOrigins) {
      expect(commitChatTradeAgentOriginMutation(started, current, () => undefined)).toBe(false);
    }
  });

  it('preserves the normal unchanged-conversation draft flow', () => {
    const started = operationOrigin();
    let composer = '';

    expect(
      commitChatTradeAgentOriginMutation(started, operationOrigin(), () => {
        composer = 'safe editable draft';
      })
    ).toBe(true);
    expect(composer).toBe('safe editable draft');
  });
});
