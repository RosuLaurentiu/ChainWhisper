import { privateKeyToAccount } from 'viem/accounts';
import {
  buildChatImageSessionAuthorizationMessage,
  verifyChatImageSessionToken
} from '../_shared/chat-image-session.ts';

const SUPABASE_URL = 'https://chat-image-session-test.supabase.co';
const SESSION_SECRET = 'a'.repeat(64);
const CHAT_IMAGE_CHAIN_ID_HEX = '0x6c11a0';

Deno.env.set('SUPABASE_URL', SUPABASE_URL);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key');
Deno.env.set('CHAT_IMAGE_RATE_LIMIT_SECRET', 'chat-image-rate-limit-test-secret-0123456789abcdef');
Deno.env.set('CHAT_IMAGE_SESSION_SECRET', SESSION_SECRET);
Deno.env.set('CHAT_IMAGE_CHAIN_ID_HEX', CHAT_IMAGE_CHAIN_ID_HEX);

const { handleChatImageSessionHttpRequest } = await import('./index.ts');

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}

const authorizationFor = (ownerAddress: string) => {
  const issuedAt = Math.floor(Date.now() / 1000);
  return {
    audience: SUPABASE_URL,
    chainId: CHAT_IMAGE_CHAIN_ID_HEX,
    expiresAt: issuedAt + 900,
    issuedAt,
    nonce: 'b'.repeat(64),
    ownerAddress
  };
};

const withAdmission = async (operation: () => Promise<void>) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/rest/v1/rpc/claim_chat_image_work')) {
      return new Response(JSON.stringify([{ allowed: true, retry_after_seconds: 0 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`Unexpected privileged request: ${url}`);
  }) as typeof fetch;
  try {
    await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

Deno.test('valid wallet authorization issues an exact owner-scoped upload token', async () => {
  await withAdmission(async () => {
    const owner = privateKeyToAccount(`0x${'11'.repeat(32)}`);
    const authorization = authorizationFor(owner.address);
    const signature = await owner.signMessage({
      message: buildChatImageSessionAuthorizationMessage(authorization)
    });
    const response = await handleChatImageSessionHttpRequest(new Request(
      `${SUPABASE_URL}/functions/v1/chat-image-session`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
        body: JSON.stringify({ ...authorization, signature })
      }
    ));
    const responseBody = await response.text();
    assert(response.status === 200, responseBody);
    const body = JSON.parse(responseBody) as { token?: string; expiresAt?: number };
    assert(typeof body.token === 'string');
    assert(body.expiresAt === authorization.expiresAt);
    const verified = await verifyChatImageSessionToken({
      expectedChainId: authorization.chainId,
      expectedOwnerAddress: owner.address,
      secretHex: SESSION_SECRET,
      supabaseUrl: SUPABASE_URL,
      token: body.token
    });
    assert(verified.ownerAddress === owner.address.toLowerCase());
  });
});

Deno.test('a signature from another wallet cannot mint a claimed-owner session', async () => {
  await withAdmission(async () => {
    const owner = privateKeyToAccount(`0x${'22'.repeat(32)}`);
    const attacker = privateKeyToAccount(`0x${'33'.repeat(32)}`);
    const authorization = authorizationFor(owner.address);
    const signature = await attacker.signMessage({
      message: buildChatImageSessionAuthorizationMessage(authorization)
    });
    const response = await handleChatImageSessionHttpRequest(new Request(
      `${SUPABASE_URL}/functions/v1/chat-image-session`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.11' },
        body: JSON.stringify({ ...authorization, signature })
      }
    ));
    assert(response.status === 403, await response.text());
  });
});
