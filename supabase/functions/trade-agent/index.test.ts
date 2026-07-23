import { privateKeyToAccount } from 'npm:viem@2.48.2/accounts';
import { buildTradeAgentRecoveryMessage } from './payment-v2.ts';

const quoteSecret = 'endpoint-quote-secret-used-only-for-tests-1234567890';
const payerAccount = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const paymentTxHash = `0x${'33'.repeat(32)}`;

Deno.env.set('SUPABASE_URL', 'http://mock-supabase');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'mock-service-role-key');
Deno.env.set('TRADE_AGENT_QUOTE_SECRET', quoteSecret);
Deno.env.set('COTI_RPC_URL', 'http://mock-rpc');
Deno.env.set('CARBON_WISP_USD_RATE_URL', 'http://mock-carbon');

const { handleTradeAgentHttpRequest } = await import('./index.ts');

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const invoke = async (body: Record<string, unknown>): Promise<{ body: Record<string, unknown>; status: number }> => {
  const response = await handleTradeAgentHttpRequest(new Request('http://localhost/trade-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }));
  return {
    body: await response.json() as Record<string, unknown>,
    status: response.status
  };
};

Deno.test('endpoint serves estimate, quote, cached run, recovery, and rejects a legacy row', async () => {
  const originalFetch = globalThis.fetch;
  let paymentRow: Record<string, unknown> | null = null;
  globalThis.fetch = (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('http://mock-carbon')) {
      return Promise.resolve(Response.json({ data: { USD: 0.01 } }));
    }
    if (url.startsWith('http://mock-supabase/rest/v1/trade_agent_payments')) {
      return Promise.resolve(Response.json(paymentRow));
    }
    throw new Error(`Unexpected test fetch: ${url}`);
  };

  try {
    const action = 'find_price';
    const prompt = 'I want to buy 1 WISP with COTI.';
    const context = {
      selectedPair: {
        buyToken: { symbol: 'WISP' },
        sellToken: { symbol: 'COTI' },
        mode: 'buy'
      }
    };
    const estimate = await invoke({ kind: 'estimate', action, prompt: '', context: {} });
    assert(estimate.status === 200);
    assert(typeof estimate.body.feeAmountWei === 'string');
    assert(BigInt(String(estimate.body.feeAmountWei)) % 1_000_000n === 0n);
    assert(!('requestId' in estimate.body));

    const priceOnlyQuote = await invoke({
      kind: 'quote',
      action,
      context,
      payerAddress: payerAccount.address,
      prompt: 'Compare current price references for WISP and COTI for a buy request.'
    });
    assert(priceOnlyQuote.status === 200, JSON.stringify(priceOnlyQuote.body));
    assert(typeof priceOnlyQuote.body.quoteToken === 'string');

    const quote = await invoke({
      kind: 'quote',
      action,
      context,
      payerAddress: payerAccount.address,
      prompt
    });
    assert(quote.status === 200, JSON.stringify(quote.body));
    assert(typeof quote.body.quoteToken === 'string');
    assert(typeof quote.body.authorizationMessage === 'string');
    const payerSignature = await payerAccount.signMessage({
      message: String(quote.body.authorizationMessage)
    });

    paymentRow = {
      action_type: action,
      completed_at: new Date().toISOString(),
      fee_amount_wei: quote.body.feeAmountWei,
      fee_recipient: String(quote.body.feeRecipient).toLowerCase(),
      fee_token_address: String(quote.body.feeTokenAddress).toLowerCase(),
      id: 1,
      payer_address: payerAccount.address.toLowerCase(),
      payment_tx_hash: paymentTxHash,
      quote_expires_at: quote.body.expiresAt,
      quote_issued_at: quote.body.issuedAt,
      request_hash: quote.body.requestHash,
      request_id: quote.body.requestId,
      response_expires_at: new Date(Date.now() + 60_000).toISOString(),
      response_json: { answer: 'Cached answer.', warnings: [], actions: [] },
      status: 'completed',
      updated_at: new Date().toISOString()
    };

    const runBody = {
      kind: 'run',
      action,
      context,
      payerAddress: payerAccount.address,
      payerSignature,
      paymentTxHash,
      prompt,
      quoteToken: quote.body.quoteToken,
      requestHash: quote.body.requestHash,
      requestId: quote.body.requestId
    };
    const run = await invoke(runBody);
    assert(run.status === 200, JSON.stringify(run.body));
    assert(run.body.status === 'completed');
    assert((run.body.response as { answer?: unknown }).answer === 'Cached answer.');

    const signedAt = new Date().toISOString();
    const recoveryMessage = buildTradeAgentRecoveryMessage({
      payerAddress: payerAccount.address,
      requestId: String(quote.body.requestId),
      signedAt
    });
    const signature = await payerAccount.signMessage({ message: recoveryMessage });
    const recovered = await invoke({
      kind: 'recover',
      payerAddress: payerAccount.address,
      requestId: quote.body.requestId,
      signedAt,
      signature
    });
    assert(recovered.status === 200, JSON.stringify(recovered.body));
    assert(recovered.body.status === 'completed');

    const completedPaymentRow = paymentRow;
    paymentRow = {
      ...completedPaymentRow,
      status: 'pending',
      updated_at: new Date().toISOString()
    };
    const processing = await invoke(runBody);
    assert(processing.status === 202, JSON.stringify(processing.body));
    assert(processing.body.status === 'processing');

    paymentRow = {
      ...completedPaymentRow,
      response_json: null,
      status: 'failed'
    };
    const retryable = await invoke({
      kind: 'recover',
      payerAddress: payerAccount.address,
      requestId: quote.body.requestId,
      signedAt,
      signature
    });
    assert(retryable.status === 200, JSON.stringify(retryable.body));
    assert(retryable.body.status === 'retryable');

    paymentRow = {
      ...completedPaymentRow,
      response_expires_at: new Date(Date.now() - 1_000).toISOString()
    };
    const expired = await invoke({
      kind: 'recover',
      payerAddress: payerAccount.address,
      requestId: quote.body.requestId,
      signedAt,
      signature
    });
    assert(expired.status === 410, JSON.stringify(expired.body));

    paymentRow = { ...completedPaymentRow, request_hash: null };
    const legacy = await invoke(runBody);
    assert(legacy.status === 409, JSON.stringify(legacy.body));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
