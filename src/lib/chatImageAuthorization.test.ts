import { describe, expect, it } from 'vitest';
import { recoverMessageAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  assertChatImageAuthorizationFresh,
  assertChatImageConversationTargetFromCalldata,
  buildChatImageUploadAuthorizationMessage,
  constantTimeEqualHex,
  normalizeChatImageUploadAuthorization,
  sha256Hex,
  type ChatImageUploadAuthorization
} from '../../supabase/functions/_shared/chat-image-authorization';
import { corsHeaders } from '../../supabase/functions/_shared/cors';
import {
  assertChatImageSessionFresh,
  buildChatImageSessionAuthorizationMessage,
  issueChatImageSessionToken,
  verifyChatImageSessionToken
} from '../../supabase/functions/_shared/chat-image-session';

const baseAuthorization: ChatImageUploadAuthorization = {
  audience: 'https://example.supabase.co/functions/v1/chat-image-upload?ignored=yes',
  blobId: '12345678-abcd-40ef-9234-567890abcdef',
  chainId: '0x282b34',
  ciphertextSha256: 'a'.repeat(64),
  confirmationTokenHash: 'b'.repeat(64),
  contractAddress: '0xe5101d33986c91565d2c9f8b49aaf0b8ffee2243',
  conversationKind: 'direct',
  conversationTarget: '0x2222222222222222222222222222222222222222',
  encryptedSize: 1040,
  expiresAt: 1_700_000_300,
  issuedAt: 1_700_000_000,
  mime: 'image/png',
  ownerAddress: '0x1111111111111111111111111111111111111111',
  plaintextSize: 1024
};

describe('chat image upload authorization', () => {
  it('allows every signed upload header through the Edge preflight contract', () => {
    const allowed = corsHeaders['Access-Control-Allow-Headers'];
    for (const header of [
      'x-chat-image-ciphertext-sha256',
      'x-chat-image-confirmation-token-hash',
      'x-chat-image-encrypted-size',
      'x-chat-image-target',
      'x-chat-image-issued-at',
      'x-chat-image-expires-at',
      'x-chat-image-authorization-signature',
      'x-chat-image-protocol',
      'x-chat-image-session-token'
    ]) {
      expect(allowed).toContain(header);
    }
  });

  it('builds one stable domain-separated message over the exact object and target', () => {
    expect(buildChatImageUploadAuthorizationMessage(baseAuthorization)).toBe([
      'ChainWhisper Chat Image Upload Authorization',
      'version:1',
      'audience:https://example.supabase.co/functions/v1/chat-image-upload',
      'chainId:0x282b34',
      'contract:0xe5101d33986c91565d2c9f8b49aaf0b8ffee2243',
      'blobId:12345678-abcd-40ef-9234-567890abcdef',
      'owner:0x1111111111111111111111111111111111111111',
      'kind:direct',
      'target:0x2222222222222222222222222222222222222222',
      'mime:image/png',
      'plaintextSize:1024',
      'encryptedSize:1040',
      `ciphertextSha256:${'a'.repeat(64)}`,
      `confirmationTokenHash:${'b'.repeat(64)}`,
      'issuedAt:1700000000',
      'expiresAt:1700000300'
    ].join('\n'));
  });

  it('recovers only the wallet that signed the exact authorization fields', async () => {
    const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
    const authorization = { ...baseAuthorization, ownerAddress: account.address };
    const message = buildChatImageUploadAuthorizationMessage(authorization);
    const signature = await account.signMessage({ message });

    await expect(recoverMessageAddress({ message, signature })).resolves.toBe(account.address);
    const changedMessage = buildChatImageUploadAuthorizationMessage({
      ...authorization,
      conversationTarget: '0x3333333333333333333333333333333333333333'
    });
    await expect(recoverMessageAddress({ message: changedMessage, signature })).resolves.not.toBe(account.address);
  });

  it('binds direct recipients and group ids to the first calldata argument', () => {
    const selector = '0x12345678';
    const directTarget = '0x2222222222222222222222222222222222222222';
    const directWord = directTarget.slice(2).padStart(64, '0');
    expect(() => assertChatImageConversationTargetFromCalldata(
      `${selector}${directWord}${'00'.repeat(64)}`,
      'direct',
      directTarget
    )).not.toThrow();
    expect(() => assertChatImageConversationTargetFromCalldata(
      `${selector}${directWord}`,
      'direct',
      '0x3333333333333333333333333333333333333333'
    )).toThrow('different recipient');

    const groupWord = BigInt(7).toString(16).padStart(64, '0');
    expect(() => assertChatImageConversationTargetFromCalldata(
      `${selector}${groupWord}`,
      'group',
      '7'
    )).not.toThrow();
    expect(() => assertChatImageConversationTargetFromCalldata(
      `${selector}${groupWord}`,
      'group',
      '8'
    )).toThrow('different group');
  });

  it('requires canonical group ids and rejects cross-kind targets', () => {
    expect(normalizeChatImageUploadAuthorization({
      ...baseAuthorization,
      conversationKind: 'group',
      conversationTarget: '7'
    })).toMatchObject({ conversationTarget: '7' });

    expect(() => normalizeChatImageUploadAuthorization({
      ...baseAuthorization,
      conversationKind: 'group',
      conversationTarget: '0007'
    })).toThrow('Invalid group chat image target');

    expect(() => normalizeChatImageUploadAuthorization({
      ...baseAuthorization,
      conversationKind: 'direct',
      conversationTarget: '7'
    })).toThrow('Invalid direct chat image target');
  });

  it('rejects stale, future, and overlong authorization windows', () => {
    expect(() => assertChatImageAuthorizationFresh(1_700_000_000, 1_700_000_300, 1_700_000_010)).not.toThrow();
    expect(() => assertChatImageAuthorizationFresh(1_699_999_000, 1_699_999_300, 1_700_000_000)).toThrow();
    expect(() => assertChatImageAuthorizationFresh(1_700_000_100, 1_700_000_200, 1_700_000_000)).toThrow();
    expect(() => assertChatImageAuthorizationFresh(1_700_000_000, 1_700_000_301, 1_700_000_000)).toThrow();
  });

  it('hashes confirmation material and compares digests without early mismatch exits', async () => {
    const digest = await sha256Hex(new TextEncoder().encode('confirmation-secret'));
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(constantTimeEqualHex(digest, digest)).toBe(true);
    expect(constantTimeEqualHex(digest, `${digest.slice(0, -1)}0`)).toBe(false);
    expect(constantTimeEqualHex('not-hex', digest)).toBe(false);
  });

  it('issues a short-lived wallet-scoped session token and rejects tampering or scope changes', async () => {
    const account = privateKeyToAccount(`0x${'44'.repeat(32)}`);
    const issuedAt = Math.floor(Date.now() / 1000);
    const authorization = {
      audience: 'https://example.supabase.co',
      chainId: '0x282b34',
      expiresAt: issuedAt + 900,
      issuedAt,
      nonce: 'c'.repeat(64),
      ownerAddress: account.address
    };
    expect(buildChatImageSessionAuthorizationMessage(authorization)).toContain(
      'audience:https://example.supabase.co/functions/v1/chat-image-session'
    );
    expect(() => assertChatImageSessionFresh(
      authorization.issuedAt,
      authorization.expiresAt,
      authorization.issuedAt
    )).not.toThrow();
    const secretHex = 'd'.repeat(64);
    const token = await issueChatImageSessionToken({
      authorization,
      secretHex,
      supabaseUrl: authorization.audience
    });
    await expect(verifyChatImageSessionToken({
      expectedChainId: authorization.chainId,
      expectedOwnerAddress: account.address,
      secretHex,
      supabaseUrl: authorization.audience,
      token
    })).resolves.toMatchObject({
      ownerAddress: account.address.toLowerCase(),
      audience: 'https://example.supabase.co/functions/v1/chat-image-upload'
    });
    const [payload, signature] = token.split('.');
    await expect(verifyChatImageSessionToken({
      expectedChainId: authorization.chainId,
      expectedOwnerAddress: account.address,
      secretHex,
      supabaseUrl: authorization.audience,
      token: `${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`
    })).rejects.toThrow(/signature/i);
    await expect(verifyChatImageSessionToken({
      expectedChainId: authorization.chainId,
      expectedOwnerAddress: '0x5555555555555555555555555555555555555555',
      secretHex,
      supabaseUrl: authorization.audience,
      token
    })).rejects.toThrow(/scope/i);
  });
});
