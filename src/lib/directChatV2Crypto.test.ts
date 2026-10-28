import { describe, expect, it } from 'vitest';
import {
  DIRECT_CHAT_V2_MAX_CIPHERTEXT_BYTES,
  DIRECT_CHAT_V2_NONCE_BYTES,
  decryptDirectChatV2Message,
  deriveDirectChatV2AadHash,
  deriveDirectChatV2ConversationId,
  encryptDirectChatV2Message,
  type DirectChatV2MessageContext
} from './directChatV2Crypto';

const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const CHAT = '0x3333333333333333333333333333333333333333';
const OTHER_CHAT = '0x4444444444444444444444444444444444444444';
const CHAIN_ID = 7_089n;
const SEED = {
  value: 0x0123456789abcdeffedcba9876543210n
};
const FIXED_NONCE = '0x0102030405060708090a0b0c';

const conversationId = deriveDirectChatV2ConversationId({
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  participantA: ALICE,
  participantB: BOB
});

const context = {
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  conversationId,
  epoch: 1n,
  participantA: ALICE,
  participantB: BOB,
  sender: ALICE,
  recipient: BOB,
  senderSequence: 1n,
  valueSent: 123n,
  feeTaken: 3n
} satisfies DirectChatV2MessageContext;

const mutateHexByte = (value: string, byteIndex: number): string => {
  const normalized = value.slice(2);
  const offset = byteIndex * 2;
  const original = Number.parseInt(normalized.slice(offset, offset + 2), 16);
  const mutated = (original ^ 0x01).toString(16).padStart(2, '0');
  return `0x${normalized.slice(0, offset)}${mutated}${normalized.slice(offset + 2)}`;
};

describe('directChatV2Crypto', () => {
  it('derives one order-independent conversation ID with chain and contract separation', () => {
    expect(
      deriveDirectChatV2ConversationId({
        chainId: CHAIN_ID,
        contractAddress: CHAT,
        participantA: BOB,
        participantB: ALICE
      })
    ).toBe(conversationId);

    expect(
      deriveDirectChatV2ConversationId({
        chainId: CHAIN_ID + 1n,
        contractAddress: CHAT,
        participantA: ALICE,
        participantB: BOB
      })
    ).not.toBe(conversationId);
    expect(
      deriveDirectChatV2ConversationId({
        chainId: CHAIN_ID,
        contractAddress: OTHER_CHAT,
        participantA: ALICE,
        participantB: BOB
      })
    ).not.toBe(conversationId);
  });

  it('generates a fresh non-zero 96-bit nonce for every encryption attempt', async () => {
    const first = await encryptDirectChatV2Message('same payload', SEED, context);
    const second = await encryptDirectChatV2Message('same payload', SEED, context);
    expect((first.nonce.length - 2) / 2).toBe(DIRECT_CHAT_V2_NONCE_BYTES);
    expect(first.nonce).not.toBe('0x000000000000000000000000');
    expect(second.nonce).not.toBe(first.nonce);
    expect(second.ciphertext).not.toBe(first.ciphertext);
  });

  it('matches the frozen conversation and nonce-bound AAD vectors', () => {
    expect(conversationId).toBe('0x305355ba66bd39d8014aa5781ca9b6f42cfdc123a33529dde93791b16fb83770');
    expect(deriveDirectChatV2AadHash(context, FIXED_NONCE)).toBe(
      '0xd497e2e381177a0c3a0b7dde68d180957ab8e30f45ed62d71d20c64f81fefb4a'
    );
  });

  it('round-trips Unicode and rejects ciphertext, key, nonce, and context tampering', async () => {
    const plaintext = 'Hello Bob — encrypted once per epoch 🌍';
    const encrypted = await encryptDirectChatV2Message(plaintext, SEED, context);
    await expect(decryptDirectChatV2Message(encrypted, SEED, context)).resolves.toBe(plaintext);

    await expect(
      decryptDirectChatV2Message(
        { ...encrypted, ciphertext: mutateHexByte(encrypted.ciphertext, 0) },
        SEED,
        context
      )
    ).rejects.toThrow();
    await expect(
      decryptDirectChatV2Message(encrypted, { value: SEED.value ^ 1n }, context)
    ).rejects.toThrow();

    const contextMutations: DirectChatV2MessageContext[] = [
      { ...context, epoch: 2n },
      { ...context, sender: BOB, recipient: ALICE },
      { ...context, senderSequence: 2n },
      { ...context, valueSent: 124n },
      { ...context, feeTaken: 2n }
    ];
    for (const mutatedContext of contextMutations) {
      await expect(decryptDirectChatV2Message(encrypted, SEED, mutatedContext)).rejects.toThrow();
    }

    await expect(
      decryptDirectChatV2Message(
        { ...encrypted, nonce: mutateHexByte(encrypted.nonce, 0) },
        SEED,
        context
      )
    ).rejects.toThrow();
    await expect(
      decryptDirectChatV2Message(
        { ...encrypted, aadHash: mutateHexByte(encrypted.aadHash, 0) },
        SEED,
        context
      )
    ).rejects.toThrow('AAD');
  });

  it('accepts the exact ciphertext boundaries and rejects one byte over the contract cap', async () => {
    const empty = await encryptDirectChatV2Message('', SEED, context);
    expect((empty.ciphertext.length - 2) / 2).toBe(16);
    await expect(decryptDirectChatV2Message(empty, SEED, context)).resolves.toBe('');

    const maximumPlaintext = 'a'.repeat(DIRECT_CHAT_V2_MAX_CIPHERTEXT_BYTES - 16);
    const maximum = await encryptDirectChatV2Message(maximumPlaintext, SEED, context);
    expect((maximum.ciphertext.length - 2) / 2).toBe(DIRECT_CHAT_V2_MAX_CIPHERTEXT_BYTES);
    await expect(decryptDirectChatV2Message(maximum, SEED, context)).resolves.toBe(maximumPlaintext);

    await expect(
      encryptDirectChatV2Message(`${maximumPlaintext}a`, SEED, context)
    ).rejects.toThrow('4096-byte');
  });

  it('fails closed on malformed identities, counters, values, nonces, and seeds', async () => {
    expect(() =>
      deriveDirectChatV2ConversationId({
        chainId: CHAIN_ID,
        contractAddress: CHAT,
        participantA: ALICE,
        participantB: ALICE
      })
    ).toThrow('different');
    expect(() => deriveDirectChatV2AadHash(context, '0x00')).toThrow('12 bytes');
    expect(() => deriveDirectChatV2AadHash(context, '0x000000000000000000000000')).toThrow(
      'must not be zero'
    );
    expect(() => deriveDirectChatV2AadHash(
      { ...context, feeTaken: context.valueSent + 1n },
      FIXED_NONCE
    )).toThrow('cannot exceed');
    await expect(
      encryptDirectChatV2Message('message', { value: 1n << 128n }, context)
    ).rejects.toThrow('uint128');
    await expect(
      encryptDirectChatV2Message('message', { value: -1n }, context)
    ).rejects.toThrow('uint128');
  });
});
