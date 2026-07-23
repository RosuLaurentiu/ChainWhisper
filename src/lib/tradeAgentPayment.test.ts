import { describe, expect, it, vi } from 'vitest';
import {
  TRADE_AGENT_PAYMENT_PROTOCOL_VERSION,
  TRADE_AGENT_PAYMENT_FEE_RECIPIENT,
  TRADE_AGENT_PAYMENT_FEE_TOKEN_ADDRESS,
  TRADE_AGENT_PAYMENT_RETRY_STORAGE_KEY,
  buildTradeAgentRecoveryMessage,
  hashTradeAgentPaymentRequest,
  normalizeTradeAgentPaymentResult,
  orchestrateTradeAgentPayment,
  readTradeAgentPaymentRetry,
  stableStringifyTradeAgentPaymentValue,
  writeTradeAgentPaymentRetry,
  type TradeAgentPaymentQuote,
  type TradeAgentPaymentRequest,
  type TradeAgentPaymentRetryRecord
} from './tradeAgentPayment';

const PAYER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = TRADE_AGENT_PAYMENT_FEE_RECIPIENT.toLowerCase();
const TOKEN = TRADE_AGENT_PAYMENT_FEE_TOKEN_ADDRESS.toLowerCase();
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const PAYMENT_HASH = `0x${'4'.repeat(64)}`;
const SIGNATURE = `0x${'5'.repeat(130)}`;
const ISSUED_AT = '2026-07-23T10:00:00.000Z';
const EXPIRES_AT = '2026-07-23T10:15:00.000Z';
const NOW = Date.parse('2026-07-23T10:05:00.000Z');

const createMemoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
};

const request: TradeAgentPaymentRequest = {
  action: 'find_price',
  context: {
    surface: 'agent',
    quote: { amount: '10', buyToken: 'COTI', sellToken: 'WISP' }
  },
  payerAddress: PAYER,
  prompt: 'Buy 10 COTI with WISP.'
};

const buildAuthorizationMessage = (
  requestHash: string,
  requestValue: TradeAgentPaymentRequest = request
): string => [
  'ChainWhisper Trade Agent payment authorization',
  'Version: 2',
  'Chain ID: 2632500',
  `Request ID: ${REQUEST_ID}`,
  `Request hash: ${requestHash}`,
  `Action: ${requestValue.action}`,
  `Payer: ${requestValue.payerAddress.toLowerCase()}`,
  `Fee token: ${TOKEN}`,
  'Fee amount (base units): 12000',
  `Fee recipient: ${RECIPIENT}`,
  `Issued at: ${ISSUED_AT}`,
  `Expires at: ${EXPIRES_AT}`,
  'This signature authorizes one public WISP payment and does not execute a trade.'
].join('\n');

const createQuote = async (
  requestValue: TradeAgentPaymentRequest = request
): Promise<TradeAgentPaymentQuote> => {
  const requestHash = await hashTradeAgentPaymentRequest(requestValue);
  return {
    authorizationMessage: buildAuthorizationMessage(requestHash, requestValue),
    expiresAt: EXPIRES_AT,
    feeAmountWei: '12000',
    feeRecipient: RECIPIENT,
    feeTokenAddress: TOKEN,
    feeTokenDecimals: 6,
    feeTokenSymbol: 'WISP',
    issuedAt: ISSUED_AT,
    quoteToken: 'signed_quote.payload',
    requestHash,
    requestId: REQUEST_ID
  };
};

const createRetryRecord = async (
  requestValue: TradeAgentPaymentRequest = request
): Promise<TradeAgentPaymentRetryRecord> => {
  const quote = await createQuote(requestValue);
  return {
    version: TRADE_AGENT_PAYMENT_PROTOCOL_VERSION,
    ...requestValue,
    requestId: quote.requestId,
    requestHash: quote.requestHash,
    quoteToken: quote.quoteToken,
    payerSignature: SIGNATURE,
    paymentTxHash: PAYMENT_HASH,
    issuedAt: quote.issuedAt,
    expiresAt: quote.expiresAt
  };
};

const createCallbacks = (result: unknown = {
  requestId: REQUEST_ID,
  status: 'completed',
  response: { answer: 'Done.' }
}) => ({
  createQuote: vi.fn(createQuote),
  signAuthorization: vi.fn(async () => SIGNATURE),
  transferPayment: vi.fn(async () => PAYMENT_HASH),
  runRequest: vi.fn(async () => result)
});

describe('tradeAgentPayment', () => {
  it('stable-stringifies request data independently of object key order', () => {
    expect(stableStringifyTradeAgentPaymentValue({ z: 1, a: { y: 2, x: 3 } })).toBe(
      '{"a":{"x":3,"y":2},"z":1}'
    );
  });

  it('builds the exact read-only recovery message expected by the Edge Function', () => {
    expect(
      buildTradeAgentRecoveryMessage({
        payerAddress: PAYER.toUpperCase().replace('0X', '0x'),
        requestId: REQUEST_ID.toUpperCase(),
        signedAt: '2026-07-23T10:20:00.000Z'
      })
    ).toBe([
      'ChainWhisper Trade Agent response recovery',
      'Version: 2',
      'Chain ID: 2632500',
      `Request ID: ${REQUEST_ID}`,
      `Payer: ${PAYER}`,
      'Signed at: 2026-07-23T10:20:00.000Z',
      'This is a read-only request to recover one paid Agent response.'
    ].join('\n'));
  });

  it('signs before transferring and never charges when signing is cancelled', async () => {
    const storage = createMemoryStorage();
    const events: string[] = [];
    const callbacks = createCallbacks();
    callbacks.createQuote.mockImplementation(async (input) => {
      events.push('quote');
      return createQuote(input);
    });
    callbacks.signAuthorization.mockImplementation(async () => {
      events.push('sign');
      throw new Error('User rejected the signature.');
    });
    callbacks.transferPayment.mockImplementation(async () => {
      events.push('transfer');
      return PAYMENT_HASH;
    });

    await expect(
      orchestrateTradeAgentPayment({ callbacks, request, storage, now: () => NOW })
    ).rejects.toThrow('User rejected the signature.');
    expect(events).toEqual(['quote', 'sign']);
    expect(callbacks.transferPayment).not.toHaveBeenCalled();
    expect(callbacks.runRequest).not.toHaveBeenCalled();
    expect(readTradeAgentPaymentRetry(storage)).toBeNull();
  });

  it('rejects an unexpected fee destination before requesting a signature', async () => {
    const storage = createMemoryStorage();
    const callbacks = createCallbacks();
    callbacks.createQuote.mockImplementation(async (input) => ({
      ...await createQuote(input),
      feeRecipient: '0x9999999999999999999999999999999999999999'
    }));

    await expect(
      orchestrateTradeAgentPayment({
        callbacks,
        request,
        storage,
        now: () => NOW
      })
    ).rejects.toThrow('payment quote is invalid');
    expect(callbacks.signAuthorization).not.toHaveBeenCalled();
    expect(callbacks.transferPayment).not.toHaveBeenCalled();
  });

  it('checks quote expiry again after signing and before transfer', async () => {
    const storage = createMemoryStorage();
    const callbacks = createCallbacks();
    const currentTime = vi.fn()
      .mockReturnValueOnce(NOW)
      .mockReturnValueOnce(NOW)
      .mockReturnValueOnce(Date.parse('2026-07-23T10:16:00.000Z'));

    await expect(
      orchestrateTradeAgentPayment({
        callbacks,
        request,
        storage,
        now: currentTime
      })
    ).rejects.toThrow('expired before payment');
    expect(callbacks.signAuthorization).toHaveBeenCalledTimes(1);
    expect(callbacks.transferPayment).not.toHaveBeenCalled();
    expect(callbacks.runRequest).not.toHaveBeenCalled();
  });

  it('requires enough quote lifetime for the payment to be mined', async () => {
    const storage = createMemoryStorage();
    const callbacks = createCallbacks();
    const almostExpired = Date.parse('2026-07-23T10:14:40.001Z');

    await expect(
      orchestrateTradeAgentPayment({
        callbacks,
        request,
        storage,
        now: () => almostExpired
      })
    ).rejects.toThrow('expired before payment');
    expect(callbacks.signAuthorization).toHaveBeenCalledTimes(1);
    expect(callbacks.transferPayment).not.toHaveBeenCalled();
  });

  it('continues a paid run in memory when localStorage cannot persist it', async () => {
    const storage = {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new Error('Storage quota exceeded.');
      }
    };
    const callbacks = createCallbacks();
    const onPaidRequest = vi.fn();

    await expect(
      orchestrateTradeAgentPayment({
        callbacks,
        onPaidRequest,
        request,
        storage,
        now: () => NOW
      })
    ).resolves.toEqual({
      requestId: REQUEST_ID,
      status: 'completed',
      response: { answer: 'Done.' }
    });
    expect(callbacks.transferPayment).toHaveBeenCalledTimes(1);
    expect(callbacks.runRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentTxHash: PAYMENT_HASH,
        requestId: REQUEST_ID
      })
    );
    expect(onPaidRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: REQUEST_ID }),
      {
        persisted: false,
        storageError: 'Storage quota exceeded.'
      }
    );
  });

  it('reuses the complete in-memory paid record when retry storage is unavailable', async () => {
    const storage = {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new Error('Storage unavailable.');
      }
    };
    let inMemoryRecord: TradeAgentPaymentRetryRecord | null = null;
    const firstCallbacks = createCallbacks({
      requestId: REQUEST_ID,
      status: 'processing',
      retryAfterMs: 2_000
    });
    await orchestrateTradeAgentPayment({
      callbacks: firstCallbacks,
      onPaidRequest: (record) => {
        inMemoryRecord = record;
      },
      request,
      storage,
      now: () => NOW
    });

    const retryCallbacks = createCallbacks({
      requestId: REQUEST_ID,
      status: 'completed',
      response: { answer: 'Recovered from memory.' }
    });
    await expect(
      orchestrateTradeAgentPayment({
        callbacks: retryCallbacks,
        request,
        retryRecord: inMemoryRecord,
        storage,
        now: () => NOW
      })
    ).resolves.toEqual({
      requestId: REQUEST_ID,
      status: 'completed',
      response: { answer: 'Recovered from memory.' }
    });
    expect(retryCallbacks.createQuote).not.toHaveBeenCalled();
    expect(retryCallbacks.signAuthorization).not.toHaveBeenCalled();
    expect(retryCallbacks.transferPayment).not.toHaveBeenCalled();
  });

  it('persists after transfer and reuses the exact paid request without quoting or charging again', async () => {
    const storage = createMemoryStorage();
    const processingCallbacks = createCallbacks({
      requestId: REQUEST_ID,
      status: 'processing',
      retryAfterMs: 2_000
    });

    await expect(
      orchestrateTradeAgentPayment({
        callbacks: processingCallbacks,
        request,
        storage,
        now: () => NOW
      })
    ).resolves.toEqual({
      requestId: REQUEST_ID,
      status: 'processing',
      retryAfterMs: 2_000
    });
    expect(readTradeAgentPaymentRetry(storage, Date.parse(ISSUED_AT))).toMatchObject({
      action: request.action,
      paymentTxHash: PAYMENT_HASH,
      requestId: REQUEST_ID,
      version: 2
    });

    const retryCallbacks = createCallbacks({
      requestId: REQUEST_ID,
      status: 'completed',
      response: { answer: 'Recovered.' }
    });
    await expect(
      orchestrateTradeAgentPayment({
        callbacks: retryCallbacks,
        request: {
          ...request,
          context: {
            quote: { sellToken: 'WISP', buyToken: 'COTI', amount: '10' },
            surface: 'agent'
          }
        },
        storage,
        now: () => NOW
      })
    ).resolves.toEqual({
      requestId: REQUEST_ID,
      status: 'completed',
      response: { answer: 'Recovered.' }
    });
    expect(retryCallbacks.createQuote).not.toHaveBeenCalled();
    expect(retryCallbacks.signAuthorization).not.toHaveBeenCalled();
    expect(retryCallbacks.transferPayment).not.toHaveBeenCalled();
    expect(retryCallbacks.runRequest).toHaveBeenCalledTimes(1);
    expect(readTradeAgentPaymentRetry(storage)).toBeNull();
  });

  it('does not reuse a retry record whose request hash was tampered with', async () => {
    const storage = createMemoryStorage();
    writeTradeAgentPaymentRetry(
      {
        ...await createRetryRecord(),
        requestHash: `0x${'9'.repeat(64)}`
      },
      storage,
      Date.parse(ISSUED_AT)
    );
    const callbacks = createCallbacks({
      requestId: REQUEST_ID,
      status: 'retryable'
    });

    await expect(
      orchestrateTradeAgentPayment({
        callbacks,
        request,
        storage,
        now: () => NOW
      })
    ).resolves.toEqual({ requestId: REQUEST_ID, status: 'retryable' });
    expect(callbacks.createQuote).toHaveBeenCalledTimes(1);
    expect(callbacks.signAuthorization).toHaveBeenCalledTimes(1);
    expect(callbacks.transferPayment).toHaveBeenCalledTimes(1);
  });

  it('requires a new quote, signature, and payment when any exact request input changes', async () => {
    const storage = createMemoryStorage();
    writeTradeAgentPaymentRetry(
      await createRetryRecord(),
      storage,
      Date.parse(ISSUED_AT)
    );
    const changedRequest = { ...request, prompt: 'Buy 11 COTI with WISP.' };
    const callbacks = createCallbacks({
      requestId: REQUEST_ID,
      status: 'retryable'
    });
    callbacks.createQuote.mockImplementation(createQuote);

    await expect(
      orchestrateTradeAgentPayment({
        callbacks,
        request: changedRequest,
        storage,
        now: () => NOW
      })
    ).resolves.toEqual({ requestId: REQUEST_ID, status: 'retryable' });
    expect(callbacks.createQuote).toHaveBeenCalledTimes(1);
    expect(callbacks.signAuthorization).toHaveBeenCalledTimes(1);
    expect(callbacks.transferPayment).toHaveBeenCalledTimes(1);
    expect(readTradeAgentPaymentRetry(storage, Date.parse(ISSUED_AT))).toMatchObject({
      prompt: changedRequest.prompt,
      paymentTxHash: PAYMENT_HASH
    });
  });

  it('rejects and removes corrupt or legacy retry storage', () => {
    const storage = createMemoryStorage();
    storage.setItem(
      TRADE_AGENT_PAYMENT_RETRY_STORAGE_KEY,
      JSON.stringify({ version: 1, txHash: PAYMENT_HASH })
    );
    expect(readTradeAgentPaymentRetry(storage)).toBeNull();
    expect(storage.getItem(TRADE_AGENT_PAYMENT_RETRY_STORAGE_KEY)).toBeNull();

    storage.setItem(TRADE_AGENT_PAYMENT_RETRY_STORAGE_KEY, '{not-json');
    expect(readTradeAgentPaymentRetry(storage)).toBeNull();
    expect(storage.getItem(TRADE_AGENT_PAYMENT_RETRY_STORAGE_KEY)).toBeNull();
  });

  it('preserves processing and retryable wrappers and clears only completed', async () => {
    expect(
      normalizeTradeAgentPaymentResult(
        { requestId: REQUEST_ID, status: 'processing', retryAfterMs: 1_500 },
        REQUEST_ID
      )
    ).toEqual({ requestId: REQUEST_ID, status: 'processing', retryAfterMs: 1_500 });
    expect(
      normalizeTradeAgentPaymentResult(
        { requestId: REQUEST_ID, status: 'retryable' },
        REQUEST_ID
      )
    ).toEqual({ requestId: REQUEST_ID, status: 'retryable' });
    expect(
      normalizeTradeAgentPaymentResult(
        { requestId: REQUEST_ID, status: 'completed', response: { answer: 'Safe.' } },
        REQUEST_ID
      )
    ).toEqual({
      requestId: REQUEST_ID,
      status: 'completed',
      response: { answer: 'Safe.' }
    });
    expect(() =>
      normalizeTradeAgentPaymentResult(
        { requestId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', status: 'completed', response: {} },
        REQUEST_ID
      )
    ).toThrow('another request');
  });

  it('keeps the paid retry when the run transport fails', async () => {
    const storage = createMemoryStorage();
    const callbacks = createCallbacks();
    callbacks.runRequest.mockRejectedValue(new Error('Connection lost.'));

    await expect(
      orchestrateTradeAgentPayment({
        callbacks,
        request,
        storage,
        now: () => NOW
      })
    ).resolves.toEqual({
      requestId: REQUEST_ID,
      status: 'retryable',
      error: 'Connection lost.'
    });
    expect(readTradeAgentPaymentRetry(storage, Date.parse(ISSUED_AT))).not.toBeNull();
  });

  it('does not mislabel terminal payment verification errors as retryable', async () => {
    const storage = createMemoryStorage();
    const callbacks = createCallbacks();
    callbacks.runRequest.mockRejectedValue(
      Object.assign(new Error('Payment verification failed.'), {
        tradeAgentRetryable: false
      })
    );

    await expect(
      orchestrateTradeAgentPayment({
        callbacks,
        request,
        storage,
        now: () => NOW
      })
    ).rejects.toThrow('Payment verification failed.');
    expect(readTradeAgentPaymentRetry(storage, Date.parse(ISSUED_AT))).not.toBeNull();
  });
});
