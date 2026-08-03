import { privateKeyToAccount } from 'npm:viem@2.48.2/accounts';
import {
  COTI_CHAIN_ID,
  TRADE_AGENT_PROTOCOL,
  TRADE_AGENT_PROTOCOL_VERSION,
  assertFreshTradeAgentRecoverySignature,
  buildTradeAgentAuthorizationMessage,
  buildTradeAgentRecoveryMessage,
  createTradeAgentQuoteToken,
  hashTradeAgentRequest,
  recoverTradeAgentMessageSigner,
  stableStringifyTradeAgentValue,
  verifyTradeAgentPaymentReceiptData,
  verifyTradeAgentQuoteToken,
  type TradeAgentQuotePayload
} from './payment-v2.ts';

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const assertEquals = (actual: unknown, expected: unknown): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
};

const assertThrows = (fn: () => unknown, expected: RegExp): void => {
  try {
    fn();
  } catch (error) {
    assert(error instanceof Error && expected.test(error.message), `Unexpected error: ${String(error)}`);
    return;
  }
  throw new Error('Expected function to throw.');
};

const assertRejects = async (fn: () => Promise<unknown>, expected: RegExp): Promise<void> => {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof Error && expected.test(error.message), `Unexpected error: ${String(error)}`);
    return;
  }
  throw new Error('Expected promise to reject.');
};

const payerAccount = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const quoteSecret = 'quote-secret-used-only-for-deterministic-tests-123456789';
const feeTokenAddress = '0xb70c55bd0823436f44877dc6a9f46e0c55f2c3a8';
const feeRecipient = '0xd5f92b95d6224804fa54bcae2ee73b5a4a2d8bbd';

const makeQuote = async (): Promise<TradeAgentQuotePayload> => ({
  action: 'find_price',
  chainId: COTI_CHAIN_ID,
  domain: TRADE_AGENT_PROTOCOL,
  expiresAt: '2026-07-23T12:15:00.000Z',
  feeAmountWei: '600000',
  feeRecipient,
  feeTokenAddress,
  issuedAt: '2026-07-23T12:00:00.000Z',
  payerAddress: payerAccount.address.toLowerCase(),
  requestHash: await hashTradeAgentRequest({
    action: 'find_price',
    context: { selectedPair: { buyToken: 'WISP', sellToken: 'COTI' } },
    prompt: 'I want to buy 1 WISP with COTI.'
  }),
  requestId: 'd804ca25-03f2-4bd6-888d-0a7c4549864c',
  version: TRADE_AGENT_PROTOCOL_VERSION
});

Deno.test('canonical request hashes are stable across object key order', async () => {
  const left = await hashTradeAgentRequest({
    action: 'find_price',
    context: { nested: { b: 2, a: 1 }, list: [{ z: true, a: false }] },
    prompt: 'Compare.'
  });
  const right = await hashTradeAgentRequest({
    action: 'find_price',
    context: { list: [{ a: false, z: true }], nested: { a: 1, b: 2 } },
    prompt: 'Compare.'
  });
  assertEquals(left, right);
  assertEquals(stableStringifyTradeAgentValue({ z: 1, a: 2 }), '{"a":2,"z":1}');
});

Deno.test('HMAC quote tokens reject tampering and bind the EIP-191 signer', async () => {
  const quote = await makeQuote();
  const token = await createTradeAgentQuoteToken(quote, quoteSecret);
  assertEquals(await verifyTradeAgentQuoteToken(token, quoteSecret), quote);

  const authorizationMessage = buildTradeAgentAuthorizationMessage(quote);
  const signature = await payerAccount.signMessage({ message: authorizationMessage });
  assertEquals(
    await recoverTradeAgentMessageSigner({ message: authorizationMessage, signature }),
    quote.payerAddress
  );

  const replacement = token.endsWith('A') ? 'B' : 'A';
  await assertRejects(
    () => verifyTradeAgentQuoteToken(`${token.slice(0, -1)}${replacement}`, quoteSecret),
    /invalid/iu
  );
});

Deno.test('recovery signatures are deterministic, fresh, and read-only', async () => {
  const signedAt = '2026-07-23T12:00:00.000Z';
  const message = buildTradeAgentRecoveryMessage({
    payerAddress: payerAccount.address,
    requestId: 'd804ca25-03f2-4bd6-888d-0a7c4549864c',
    signedAt
  });
  const signature = await payerAccount.signMessage({ message });
  assertEquals(
    await recoverTradeAgentMessageSigner({ message, signature }),
    payerAccount.address.toLowerCase()
  );
  assertFreshTradeAgentRecoverySignature(signedAt, Date.parse('2026-07-23T12:04:59.000Z'));
  assertThrows(
    () => assertFreshTradeAgentRecoverySignature(signedAt, Date.parse('2026-07-23T12:05:01.000Z')),
    /expired/iu
  );
});

Deno.test('receipt validation requires the exact payer, amount, recipient, token, and quote window', () => {
  const transferTopic = `0x${'ab'.repeat(32)}`;
  const payerTopic = `0x${payerAccount.address.toLowerCase().slice(2).padStart(64, '0')}`;
  const recipientTopic = `0x${feeRecipient.slice(2).padStart(64, '0')}`;
  const baseInput = {
    expiresAt: '2026-07-23T12:15:00.000Z',
    feeAmountWei: 600000n,
    feeRecipient,
    feeTokenAddress,
    issuedAt: '2026-07-23T12:00:00.000Z',
    payerAddress: payerAccount.address,
    receipt: {
      blockNumber: '0x123',
      from: payerAccount.address,
      status: '0x1',
      logs: [{
        address: feeTokenAddress,
        data: `0x${600000n.toString(16).padStart(64, '0')}`,
        topics: [transferTopic, payerTopic, recipientTopic]
      }]
    },
    transactionBlockTimestampSeconds: Date.parse('2026-07-23T12:10:00.000Z') / 1_000,
    transferTopic
  };
  verifyTradeAgentPaymentReceiptData(baseInput);
  assertThrows(
    () => verifyTradeAgentPaymentReceiptData({
      ...baseInput,
      receipt: {
        ...baseInput.receipt,
        logs: [{
          ...baseInput.receipt.logs[0],
          data: `0x${600001n.toString(16).padStart(64, '0')}`
        }]
      }
    }),
    /exact quoted/iu
  );
  assertThrows(
    () => verifyTradeAgentPaymentReceiptData({
      ...baseInput,
      transactionBlockTimestampSeconds: Date.parse('2026-07-23T12:15:01.000Z') / 1_000
    }),
    /payment window/iu
  );
});
