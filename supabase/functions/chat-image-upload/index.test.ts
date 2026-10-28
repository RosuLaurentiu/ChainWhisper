import { privateKeyToAccount } from 'viem/accounts';
import {
  buildChatImageUploadAuthorizationMessage,
  getChatImageAuthorizationDomain,
  sha256Hex
} from '../_shared/chat-image-authorization.ts';
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

Deno.test('spoofed upload owner is rejected before any service-role or Storage request', async () => {
  const body = new TextEncoder().encode('encrypted-chat-image');
  const claimedOwner = privateKeyToAccount(`0x${'11'.repeat(32)}`);
  const attacker = privateKeyToAccount(`0x${'22'.repeat(32)}`);
  const domain = getChatImageAuthorizationDomain('direct');
  const issuedAt = Math.floor(Date.now() / 1000);
  const authorization = {
    audience: SUPABASE_URL,
    blobId: '12345678-abcd-40ef-9234-567890abcdef',
    chainId: domain.chainId,
    ciphertextSha256: await sha256Hex(body),
    confirmationTokenHash: 'b'.repeat(64),
    contractAddress: domain.contractAddress,
    conversationKind: 'direct' as const,
    conversationTarget: '0x3333333333333333333333333333333333333333',
    encryptedSize: body.byteLength,
    expiresAt: issuedAt + 300,
    issuedAt,
    mime: 'image/png',
    ownerAddress: claimedOwner.address,
    plaintextSize: 4
  };
  const signature = await attacker.signMessage({
    message: buildChatImageUploadAuthorizationMessage(authorization)
  });
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    throw new Error('privileged fetch must not run');
  }) as typeof fetch;

  try {
    const response = await handleChatImageUploadHttpRequest(new Request(
      `${SUPABASE_URL}/functions/v1/chat-image-upload`,
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/octet-stream',
          'x-forwarded-for': '203.0.113.10',
          'x-chat-image-authorization-signature': signature,
          'x-chat-image-blob-id': authorization.blobId,
          'x-chat-image-ciphertext-sha256': authorization.ciphertextSha256,
          'x-chat-image-confirmation-token-hash': authorization.confirmationTokenHash,
          'x-chat-image-encrypted-size': String(authorization.encryptedSize),
          'x-chat-image-expires-at': String(authorization.expiresAt),
          'x-chat-image-issued-at': String(authorization.issuedAt),
          'x-chat-image-kind': authorization.conversationKind,
          'x-chat-image-mime': authorization.mime,
          'x-chat-image-owner': authorization.ownerAddress,
          'x-chat-image-plaintext-size': String(authorization.plaintextSize),
          'x-chat-image-target': authorization.conversationTarget
        }
      }
    ));

    assert(response.status === 403, await response.text());
    assert(fetchCalls === 0, `Expected zero privileged fetches, got ${fetchCalls}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('ciphertext mismatch is rejected after admission but before DB or Storage writes', async () => {
  const body = new TextEncoder().encode('different-encrypted-chat-image');
  const owner = privateKeyToAccount(`0x${'33'.repeat(32)}`);
  const domain = getChatImageAuthorizationDomain('group');
  const issuedAt = Math.floor(Date.now() / 1000);
  const authorization = {
    audience: SUPABASE_URL,
    blobId: '22345678-abcd-40ef-9234-567890abcdef',
    chainId: domain.chainId,
    ciphertextSha256: 'a'.repeat(64),
    confirmationTokenHash: 'b'.repeat(64),
    contractAddress: domain.contractAddress,
    conversationKind: 'group' as const,
    conversationTarget: '7',
    encryptedSize: body.byteLength,
    expiresAt: issuedAt + 300,
    issuedAt,
    mime: 'image/png',
    ownerAddress: owner.address,
    plaintextSize: 4
  };
  const signature = await owner.signMessage({
    message: buildChatImageUploadAuthorizationMessage(authorization)
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
          'x-forwarded-for': '203.0.113.10',
          'x-chat-image-authorization-signature': signature,
          'x-chat-image-blob-id': authorization.blobId,
          'x-chat-image-ciphertext-sha256': authorization.ciphertextSha256,
          'x-chat-image-confirmation-token-hash': authorization.confirmationTokenHash,
          'x-chat-image-encrypted-size': String(authorization.encryptedSize),
          'x-chat-image-expires-at': String(authorization.expiresAt),
          'x-chat-image-issued-at': String(authorization.issuedAt),
          'x-chat-image-kind': authorization.conversationKind,
          'x-chat-image-mime': authorization.mime,
          'x-chat-image-owner': authorization.ownerAddress,
          'x-chat-image-plaintext-size': String(authorization.plaintextSize),
          'x-chat-image-target': authorization.conversationTarget
        }
      }
    ));

    assert(response.status === 400, await response.text());
    assert(fetchedUrls.length === 1, JSON.stringify(fetchedUrls));
    assert(fetchedUrls[0]?.includes('/rest/v1/rpc/claim_chat_image_work'));
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
