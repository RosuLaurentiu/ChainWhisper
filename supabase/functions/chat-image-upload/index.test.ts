import { privateKeyToAccount } from 'viem/accounts';
import { issueChatImageSessionToken } from '../_shared/chat-image-session.ts';

const SUPABASE_URL = 'https://chat-image-upload-test.supabase.co';
const RATE_SECRET = 'chat-image-rate-limit-test-secret-0123456789abcdef';
const SESSION_SECRET = 'd'.repeat(64);
const CHAT_IMAGE_CHAIN_ID_HEX = '0x6c11a0';

Deno.env.set('SUPABASE_URL', SUPABASE_URL);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key');
Deno.env.set('CHAT_IMAGE_RATE_LIMIT_SECRET', RATE_SECRET);
Deno.env.set('CHAT_IMAGE_SESSION_SECRET', SESSION_SECRET);
Deno.env.set('CHAT_IMAGE_CHAIN_ID_HEX', CHAT_IMAGE_CHAIN_ID_HEX);

const { handleChatImageUploadHttpRequest } = await import('./index.ts');

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}

// CW-154: uploads need a wallet-signed session and a current V2 protocol; no request reaches Supabase otherwise.
Deno.test('a spoofed owner, a missing session or a missing V2 protocol is refused before any privileged request', async () => {
  const body = new TextEncoder().encode('encrypted-chat-image');
  const sessionOwner = privateKeyToAccount(`0x${'11'.repeat(32)}`);
  const claimedOwner = privateKeyToAccount(`0x${'22'.repeat(32)}`);
  const issuedAt = Math.floor(Date.now() / 1000);
  const sessionToken = await issueChatImageSessionToken({
    authorization: { audience: SUPABASE_URL, chainId: CHAT_IMAGE_CHAIN_ID_HEX, expiresAt: issuedAt + 900, issuedAt,
      nonce: 'f'.repeat(64), ownerAddress: sessionOwner.address },
    secretHex: SESSION_SECRET,
    supabaseUrl: SUPABASE_URL
  });
  const headers = (change: Record<string, string | null>) => Object.fromEntries(Object.entries({
    'content-type': 'application/octet-stream',
    'x-forwarded-for': '203.0.113.10',
    'x-chat-image-blob-id': '12345678-abcd-40ef-9234-567890abcdef',
    'x-chat-image-ciphertext-sha256': 'a'.repeat(64),
    'x-chat-image-confirmation-token-hash': 'b'.repeat(64),
    'x-chat-image-encrypted-size': String(body.byteLength),
    'x-chat-image-kind': 'direct',
    'x-chat-image-mime': 'image/png',
    'x-chat-image-owner': sessionOwner.address,
    'x-chat-image-plaintext-size': '4',
    'x-chat-image-protocol': 'direct-v2',
    'x-chat-image-session-token': sessionToken,
    'x-chat-image-target': '0x3333333333333333333333333333333333333333',
    ...change
  }).filter((entry): entry is [string, string] => entry[1] !== null));
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    throw new Error('privileged fetch must not run');
  }) as typeof fetch;
  try {
    for (const [change, status] of [
      [{ 'x-chat-image-owner': claimedOwner.address }, [400, 403]],
      [{ 'x-chat-image-session-token': null }, [401]],
      [{ 'x-chat-image-protocol': null }, [400]],
      [{ 'x-chat-image-protocol': 'legacy-v1' }, [400]]
    ] as const) {
      const response = await handleChatImageUploadHttpRequest(new Request(
        `${SUPABASE_URL}/functions/v1/chat-image-upload`,
        { method: 'POST', body, headers: headers(change) }
      ));
      assert((status as readonly number[]).includes(response.status), `${JSON.stringify(change)}: ${response.status} ${await response.text()}`);
    }
    assert(fetchCalls === 0, `Expected zero privileged fetches, got ${fetchCalls}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('wallet-scoped session authorizes a Direct V2 encrypted upload without a per-image signature', async () => {
  const body = new TextEncoder().encode('different-encrypted-chat-image');
  const owner = privateKeyToAccount(`0x${'55'.repeat(32)}`);
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 900;
  const sessionToken = await issueChatImageSessionToken({
    authorization: {
      audience: SUPABASE_URL,
      chainId: CHAT_IMAGE_CHAIN_ID_HEX,
      expiresAt,
      issuedAt,
      nonce: 'e'.repeat(64),
      ownerAddress: owner.address
    },
    secretHex: SESSION_SECRET,
    supabaseUrl: SUPABASE_URL
  });
  const fetchedUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    fetchedUrls.push(url);
    if (url.includes('/rest/v1/rpc/claim_chat_image_work')) {
      return new Response(JSON.stringify([{ allowed: true, retry_after_seconds: 0 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`Unexpected privileged request: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleChatImageUploadHttpRequest(new Request(
      `${SUPABASE_URL}/functions/v1/chat-image-upload`,
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/octet-stream',
          'x-forwarded-for': '203.0.113.12',
          'x-chat-image-blob-id': '32345678-abcd-40ef-9234-567890abcdef',
          'x-chat-image-ciphertext-sha256': 'a'.repeat(64),
          'x-chat-image-confirmation-token-hash': 'b'.repeat(64),
          'x-chat-image-encrypted-size': String(body.byteLength),
          'x-chat-image-kind': 'direct',
          'x-chat-image-mime': 'image/png',
          'x-chat-image-owner': owner.address,
          'x-chat-image-plaintext-size': '4',
          'x-chat-image-protocol': 'direct-v2',
          'x-chat-image-session-token': sessionToken,
          'x-chat-image-target': '0x6666666666666666666666666666666666666666'
        }
      }
    ));
    assert(response.status === 400, await response.text());
    assert(fetchedUrls.length === 1, JSON.stringify(fetchedUrls));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('wallet-scoped session authorizes a Group V2 encrypted upload without a per-image signature', async () => {
  const body = new TextEncoder().encode('group-encrypted-chat-image');
  const owner = privateKeyToAccount(`0x${'66'.repeat(32)}`);
  const issuedAt = Math.floor(Date.now() / 1000);
  const sessionToken = await issueChatImageSessionToken({
    authorization: {
      audience: SUPABASE_URL,
      chainId: CHAT_IMAGE_CHAIN_ID_HEX,
      expiresAt: issuedAt + 900,
      issuedAt,
      nonce: 'f'.repeat(64),
      ownerAddress: owner.address
    },
    secretHex: SESSION_SECRET,
    supabaseUrl: SUPABASE_URL
  });
  const fetchedUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    fetchedUrls.push(url);
    if (url.includes('/rest/v1/rpc/claim_chat_image_work')) {
      return new Response(JSON.stringify([{ allowed: true, retry_after_seconds: 0 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`Unexpected privileged request: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleChatImageUploadHttpRequest(new Request(
      `${SUPABASE_URL}/functions/v1/chat-image-upload`,
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/octet-stream',
          'x-forwarded-for': '203.0.113.13',
          'x-chat-image-blob-id': '42345678-abcd-40ef-9234-567890abcdef',
          'x-chat-image-ciphertext-sha256': 'a'.repeat(64),
          'x-chat-image-confirmation-token-hash': 'b'.repeat(64),
          'x-chat-image-encrypted-size': String(body.byteLength),
          'x-chat-image-kind': 'group',
          'x-chat-image-mime': 'image/png',
          'x-chat-image-owner': owner.address,
          'x-chat-image-plaintext-size': '4',
          'x-chat-image-protocol': 'group-v2',
          'x-chat-image-session-token': sessionToken,
          'x-chat-image-target': '7'
        }
      }
    ));
    assert(response.status === 400, await response.text());
    assert(fetchedUrls.length === 1, JSON.stringify(fetchedUrls));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
