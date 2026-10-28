import { describe, expect, it, vi } from 'vitest';
import {
  DIRECT_CHAT_V2_NONCE_RETIREMENT_SCHEMA,
  buildDirectChatV2NonceAttemptRecord,
  createDirectChatV2NonceAttemptRetirer,
  type DirectChatV2NonceAttemptClaimStore
} from './directChatV2NonceRetirement';

const ATTEMPT = {
  chainId: 7_082_400n,
  contractAddress: '0x1000000000000000000000000000000000000001',
  conversationId: `0x${'22'.repeat(32)}`,
  epoch: 3n,
  ownerAddress: '0x3000000000000000000000000000000000000003',
  nonce: `0x${'44'.repeat(12)}`
};

describe('directChatV2NonceRetirement', () => {
  it('builds a canonical public-only retirement record', () => {
    const record = buildDirectChatV2NonceAttemptRecord(ATTEMPT);

    expect(record).toEqual({
      schema: DIRECT_CHAT_V2_NONCE_RETIREMENT_SCHEMA,
      key: [
        DIRECT_CHAT_V2_NONCE_RETIREMENT_SCHEMA,
        ATTEMPT.chainId.toString(),
        ATTEMPT.contractAddress.toLowerCase(),
        ATTEMPT.conversationId,
        ATTEMPT.epoch.toString(),
        ATTEMPT.nonce
      ].join(':'),
      chainId: ATTEMPT.chainId.toString(),
      contractAddress: ATTEMPT.contractAddress,
      conversationId: ATTEMPT.conversationId,
      epoch: ATTEMPT.epoch.toString(),
      ownerAddress: ATTEMPT.ownerAddress,
      nonce: ATTEMPT.nonce
    });
    expect(JSON.stringify(record)).not.toContain('ciphertext');
    expect(JSON.stringify(record)).not.toContain('plaintext');
  });

  it('awaits an atomic claim and fails closed on a duplicate', async () => {
    const keys = new Set<string>();
    const claim = vi.fn(async (record: ReturnType<typeof buildDirectChatV2NonceAttemptRecord>) => {
      if (keys.has(record.key)) return 'duplicate' as const;
      keys.add(record.key);
      return 'claimed' as const;
    });
    const store = { claim } satisfies DirectChatV2NonceAttemptClaimStore;
    const retire = createDirectChatV2NonceAttemptRetirer(store);

    await expect(retire(ATTEMPT)).resolves.toBeUndefined();
    await expect(retire(ATTEMPT)).rejects.toThrow('already retired');
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it('domain-separates epoch, conversation, and nonce while sharing uniqueness across participants', () => {
    const base = buildDirectChatV2NonceAttemptRecord(ATTEMPT).key;
    expect(buildDirectChatV2NonceAttemptRecord({ ...ATTEMPT, epoch: 4n }).key).not.toBe(base);
    expect(buildDirectChatV2NonceAttemptRecord({
      ...ATTEMPT,
      ownerAddress: '0x5000000000000000000000000000000000000005'
    }).key).toBe(base);
    expect(buildDirectChatV2NonceAttemptRecord({
      ...ATTEMPT,
      conversationId: `0x${'66'.repeat(32)}`
    }).key).not.toBe(base);
    expect(buildDirectChatV2NonceAttemptRecord({
      ...ATTEMPT,
      nonce: `0x${'77'.repeat(12)}`
    }).key).not.toBe(base);
  });

  it('rejects zero or malformed nonce scope before touching storage', async () => {
    const claim = vi.fn(async () => 'claimed' as const);
    const retire = createDirectChatV2NonceAttemptRetirer({ claim });

    await expect(retire({ ...ATTEMPT, nonce: `0x${'00'.repeat(12)}` })).rejects.toThrow('cannot be zero');
    await expect(retire({ ...ATTEMPT, conversationId: '0x12' })).rejects.toThrow('invalid byte length');
    await expect(retire({ ...ATTEMPT, epoch: 0n })).rejects.toThrow('out of range');
    expect(claim).not.toHaveBeenCalled();
  });
});
