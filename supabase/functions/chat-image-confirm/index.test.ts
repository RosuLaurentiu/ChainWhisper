const SUPABASE_URL = 'https://chat-image-confirm-test.supabase.co';
const COTI_RPC_URL = 'https://rpc.test.invalid';
const DIRECT_CHAT_V2_ADDRESS = '0x7777777777777777777777777777777777777777';
const GROUP_CHAT_V2_ADDRESS = '0x8888888888888888888888888888888888888888';
const CHAT_IMAGE_CHAIN_ID_HEX = '0x6c11a0';

Deno.env.set('SUPABASE_URL', SUPABASE_URL);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key');
Deno.env.set('COTI_RPC_URL', COTI_RPC_URL);
Deno.env.set('CHAT_IMAGE_RATE_LIMIT_SECRET', 'chat-image-rate-limit-test-secret-0123456789abcdef');
Deno.env.set('DIRECT_CHAT_V2_ADDRESS', DIRECT_CHAT_V2_ADDRESS);
Deno.env.set('GROUP_CHAT_V2_ADDRESS', GROUP_CHAT_V2_ADDRESS);
Deno.env.set('CHAT_IMAGE_CHAIN_ID_HEX', CHAT_IMAGE_CHAIN_ID_HEX);

const { handleChatImageConfirmHttpRequest } = await import('./index.ts');

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('wrong confirmation token is rejected before any COTI RPC request', async () => {
  const blobId = '12345678-abcd-40ef-9234-567890abcdef';
  let rpcCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const requestInit = init as { body?: unknown; method?: string } | undefined;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(COTI_RPC_URL)) {
      rpcCalls += 1;
      throw new Error('COTI RPC must not run');
    }
    if (url.includes('/rest/v1/rpc/claim_chat_image_work')) {
      return new Response(JSON.stringify([{ allowed: true, retry_after_seconds: 0 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.includes('/rest/v1/chat_image_uploads')) {
      return new Response(JSON.stringify({
        authorization_version: 1,
        confirmation_token_hash: 'b'.repeat(64),
        confirmed_at: null,
        confirmed_tx_hash: null,
        conversation_kind: 'direct',
        conversation_target: '0x3333333333333333333333333333333333333333',
        created_at: new Date().toISOString(),
        owner_address: '0x1111111111111111111111111111111111111111',
        protocol_version: 1
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`Unexpected Supabase request: ${requestInit?.method ?? 'GET'} ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleChatImageConfirmHttpRequest(new Request(
      `${SUPABASE_URL}/functions/v1/chat-image-confirm`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.10'
        },
        body: JSON.stringify({
          blobId,
          txHash: `0x${'a'.repeat(64)}`,
          confirmationToken: 'c'.repeat(64)
        })
      }
    ));

    assert(response.status === 403, await response.text());
    assert(rpcCalls === 0, `Expected zero COTI RPC calls, got ${rpcCalls}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('same-wallet transaction to another recipient is rejected before confirmation update', async () => {
  const blobId = '22345678-abcd-40ef-9234-567890abcdef';
  const ownerAddress = '0x1111111111111111111111111111111111111111';
  const expectedRecipient = '0x3333333333333333333333333333333333333333';
  const wrongRecipient = '0x4444444444444444444444444444444444444444';
  const confirmationToken = 'd'.repeat(64);
  const tokenBytes = new Uint8Array(32).fill(0xdd);
  const confirmationTokenHash = await sha256Hex(tokenBytes);
  const txHash = `0x${'e'.repeat(64)}`;
  const selector = [...DIRECT_CHAT_SUBMIT_SELECTORS][0];
  const input = `${selector}${wrongRecipient.slice(2).padStart(64, '0')}${'00'.repeat(64)}`;
  const supabaseMutations: string[] = [];
  const rpcMethods: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (fetchInput, init) => {
    const requestInit = init as { body?: unknown; method?: string } | undefined;
    const url = typeof fetchInput === 'string'
      ? fetchInput
      : fetchInput instanceof URL
        ? fetchInput.href
        : fetchInput.url;
    if (url.startsWith(COTI_RPC_URL)) {
      const requestBody = JSON.parse(String(requestInit?.body ?? '{}')) as { id?: unknown; method?: string };
      rpcMethods.push(requestBody.method ?? '');
      const result = requestBody.method === 'eth_chainId'
        ? CHAT_IMAGE_CHAIN_ID_HEX
        : requestBody.method === 'eth_getTransactionReceipt'
          ? { blockNumber: '0x10', status: '0x1' }
          : requestBody.method === 'eth_getTransactionByHash'
            ? { from: ownerAddress, input, to: CHAT_CONTRACT_ADDRESS }
            : null;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: requestBody.id ?? 1, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.includes('/rest/v1/rpc/claim_chat_image_work')) {
      return new Response(JSON.stringify([{ allowed: true, retry_after_seconds: 0 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.includes('/rest/v1/chat_image_uploads') && (requestInit?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({
        authorization_version: 1,
        confirmation_token_hash: confirmationTokenHash,
        confirmed_at: null,
        confirmed_tx_hash: null,
        conversation_kind: 'direct',
        conversation_target: expectedRecipient,
        created_at: new Date().toISOString(),
        owner_address: ownerAddress,
        protocol_version: 1
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    supabaseMutations.push(`${requestInit?.method ?? 'GET'} ${url}`);
    throw new Error(`Unexpected request: ${supabaseMutations.at(-1)}`);
  }) as typeof fetch;

  try {
    const response = await handleChatImageConfirmHttpRequest(new Request(
      `${SUPABASE_URL}/functions/v1/chat-image-confirm`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.11'
        },
        body: JSON.stringify({ blobId, txHash, confirmationToken })
      }
    ));

    assert(response.status === 400, await response.text());
    assert(rpcMethods.includes('eth_getTransactionByHash'));
    assert(!rpcMethods.includes('eth_getBlockByNumber'));
    assert(supabaseMutations.length === 0, JSON.stringify(supabaseMutations));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('Direct V2 confirmation requires the exact participant-indexed MessagePosted event', async () => {
  const blobId = '32345678-abcd-40ef-9234-567890abcdef';
  const ownerAddress = '0x1111111111111111111111111111111111111111';
  const recipient = '0x3333333333333333333333333333333333333333';
  const confirmationToken = 'f'.repeat(64);
  const confirmationTokenHash = await sha256Hex(new Uint8Array(32).fill(0xff));
  const txHash = `0x${'8'.repeat(64)}`;
  const messageTopic = '0xc1b1cd53414aa748881be289567f95e4860fba25bed82b5ae31129f90b5f9e6a';
  const indexed = (address: string) => `0x${address.slice(2).padStart(64, '0')}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (fetchInput, init) => {
    const requestInit = init as { body?: unknown; method?: string } | undefined;
    const url = typeof fetchInput === 'string'
      ? fetchInput
      : fetchInput instanceof URL
        ? fetchInput.href
        : fetchInput.url;
    if (url.startsWith(COTI_RPC_URL)) {
      const requestBody = JSON.parse(String(requestInit?.body ?? '{}')) as { id?: unknown; method?: string };
      const result = requestBody.method === 'eth_chainId'
        ? CHAT_IMAGE_CHAIN_ID_HEX
        : requestBody.method === 'eth_getTransactionReceipt'
          ? {
              blockNumber: '0x20',
              status: '0x1',
              logs: [{
                address: DIRECT_CHAT_V2_ADDRESS,
                topics: [messageTopic, `0x${'9'.repeat(64)}`, indexed(ownerAddress), indexed(recipient)],
                data: '0x01'
              }]
            }
          : requestBody.method === 'eth_getTransactionByHash'
            ? { from: ownerAddress, input: `0x9c37c00d${'00'.repeat(64)}`, to: DIRECT_CHAT_V2_ADDRESS }
            : requestBody.method === 'eth_getBlockByNumber'
              ? { timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` }
              : null;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: requestBody.id ?? 1, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.includes('/rest/v1/rpc/claim_chat_image_work')) {
      return new Response(JSON.stringify([{ allowed: true, retry_after_seconds: 0 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.includes('/rest/v1/chat_image_uploads') && (requestInit?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({
        authorization_version: 2,
        confirmation_token_hash: confirmationTokenHash,
        confirmed_at: null,
        confirmed_tx_hash: null,
        conversation_kind: 'direct',
        conversation_target: recipient,
        created_at: new Date().toISOString(),
        owner_address: ownerAddress,
        protocol_version: 2
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/rest/v1/chat_image_uploads') && requestInit?.method === 'PATCH') {
      return new Response(JSON.stringify([{ blob_id: blobId, confirmed_tx_hash: txHash }]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`Unexpected request: ${requestInit?.method ?? 'GET'} ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleChatImageConfirmHttpRequest(new Request(
      `${SUPABASE_URL}/functions/v1/chat-image-confirm`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.12' },
        body: JSON.stringify({ blobId, txHash, confirmationToken })
      }
    ));
    assert(response.status === 200, await response.text());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('Group V2 confirmation requires the exact group and sender indexed event', async () => {
  const blobId = '42345678-abcd-40ef-9234-567890abcdef';
  const ownerAddress = '0x1111111111111111111111111111111111111111';
  const groupId = '7';
  const confirmationToken = 'a'.repeat(64);
  const confirmationTokenHash = await sha256Hex(new Uint8Array(32).fill(0xaa));
  const txHash = `0x${'7'.repeat(64)}`;
  const messageTopic = '0xc179bb86b638762e8d9d1c349babf4f3ee84c2ef57188c590f4ad6ec281a09c8';
  const indexed = (value: string | bigint) =>
    `0x${BigInt(value).toString(16).padStart(64, '0')}`;
  const indexedAddress = (address: string) => `0x${address.slice(2).padStart(64, '0')}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (fetchInput, init) => {
    const requestInit = init as { body?: unknown; method?: string } | undefined;
    const url = typeof fetchInput === 'string'
      ? fetchInput
      : fetchInput instanceof URL
        ? fetchInput.href
        : fetchInput.url;
    if (url.startsWith(COTI_RPC_URL)) {
      const requestBody = JSON.parse(String(requestInit?.body ?? '{}')) as { id?: unknown; method?: string };
      const result = requestBody.method === 'eth_chainId'
        ? CHAT_IMAGE_CHAIN_ID_HEX
        : requestBody.method === 'eth_getTransactionReceipt'
          ? {
              blockNumber: '0x30',
              status: '0x1',
              logs: [{
                address: GROUP_CHAT_V2_ADDRESS,
                topics: [messageTopic, indexed(groupId), indexed(9n), indexedAddress(ownerAddress)],
                data: '0x01'
              }]
            }
          : requestBody.method === 'eth_getTransactionByHash'
            ? { from: ownerAddress, input: `0x67b2dfaa${'00'.repeat(64)}`, to: GROUP_CHAT_V2_ADDRESS }
            : requestBody.method === 'eth_getBlockByNumber'
              ? { timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` }
              : null;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: requestBody.id ?? 1, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.includes('/rest/v1/rpc/claim_chat_image_work')) {
      return new Response(JSON.stringify([{ allowed: true, retry_after_seconds: 0 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.includes('/rest/v1/chat_image_uploads') && (requestInit?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({
        authorization_version: 2,
        confirmation_token_hash: confirmationTokenHash,
        confirmed_at: null,
        confirmed_tx_hash: null,
        conversation_kind: 'group',
        conversation_target: groupId,
        created_at: new Date().toISOString(),
        owner_address: ownerAddress,
        protocol_version: 2
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/rest/v1/chat_image_uploads') && requestInit?.method === 'PATCH') {
      return new Response(JSON.stringify([{ blob_id: blobId, confirmed_tx_hash: txHash }]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`Unexpected request: ${requestInit?.method ?? 'GET'} ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleChatImageConfirmHttpRequest(new Request(
      `${SUPABASE_URL}/functions/v1/chat-image-confirm`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.13' },
        body: JSON.stringify({ blobId, txHash, confirmationToken })
      }
    ));
    assert(response.status === 200, await response.text());
  } finally {
    globalThis.fetch = originalFetch;
  }
});
import { sha256Hex } from '../_shared/chat-image-authorization.ts';
import {
  CHAT_CONTRACT_ADDRESS,
  DIRECT_CHAT_SUBMIT_SELECTORS
} from '../_shared/chat-image.ts';
