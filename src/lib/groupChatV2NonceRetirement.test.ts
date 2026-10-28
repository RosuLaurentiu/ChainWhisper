import { describe, expect, it, vi } from 'vitest';
import {
  GROUP_CHAT_V2_NONCE_RETIREMENT_SCHEMA,
  buildGroupChatV2NonceAttemptRecord,
  createGroupChatV2NonceAttemptRetirer,
  type GroupChatV2NonceAttemptClaimStore
} from './groupChatV2NonceRetirement';

const ATTEMPT = {
  purpose: 'message' as const,
  chainId: 7_082_400n,
  contractAddress: '0x1000000000000000000000000000000000000001',
  groupId: 42n,
  epoch: 3n,
  ownerAddress: '0x3000000000000000000000000000000000000003',
  nonce: `0x${'44'.repeat(12)}`
};

describe('groupChatV2NonceRetirement', () => {
  it('builds a canonical public-only epoch-wide record', () => {
    const record = buildGroupChatV2NonceAttemptRecord(ATTEMPT);
    expect(record).toEqual({
      schema: GROUP_CHAT_V2_NONCE_RETIREMENT_SCHEMA,
      key: [
        GROUP_CHAT_V2_NONCE_RETIREMENT_SCHEMA,
        'message',
        ATTEMPT.chainId.toString(),
        ATTEMPT.contractAddress.toLowerCase(),
        ATTEMPT.groupId.toString(),
        ATTEMPT.epoch.toString(),
        ATTEMPT.nonce
      ].join(':'),
      purpose: 'message',
      chainId: ATTEMPT.chainId.toString(),
      contractAddress: ATTEMPT.contractAddress,
      groupId: ATTEMPT.groupId.toString(),
      epoch: ATTEMPT.epoch.toString(),
      ownerAddress: ATTEMPT.ownerAddress,
      nonce: ATTEMPT.nonce
    });
    expect(JSON.stringify(record)).not.toMatch(/ciphertext|plaintext|seed|keyMaterial/u);
  });

  it('claims atomically and fails closed on duplicates', async () => {
    const keys = new Set<string>();
    const claim = vi.fn(async (record: ReturnType<typeof buildGroupChatV2NonceAttemptRecord>) => {
      if (keys.has(record.key)) return 'duplicate' as const;
      keys.add(record.key);
      return 'claimed' as const;
    });
    const retire = createGroupChatV2NonceAttemptRetirer({ claim } satisfies GroupChatV2NonceAttemptClaimStore);
    await expect(retire(ATTEMPT)).resolves.toBeUndefined();
    await expect(retire(ATTEMPT)).rejects.toThrow('already retired');
  });

  it('shares message uniqueness across members and separates metadata from messages', () => {
    const base = buildGroupChatV2NonceAttemptRecord(ATTEMPT).key;
    expect(buildGroupChatV2NonceAttemptRecord({
      ...ATTEMPT,
      ownerAddress: '0x5000000000000000000000000000000000000005'
    }).key).toBe(base);
    expect(buildGroupChatV2NonceAttemptRecord({ ...ATTEMPT, purpose: 'metadata' }).key).not.toBe(base);
    expect(buildGroupChatV2NonceAttemptRecord({ ...ATTEMPT, groupId: 43n }).key).not.toBe(base);
    expect(buildGroupChatV2NonceAttemptRecord({ ...ATTEMPT, epoch: 4n }).key).not.toBe(base);
  });

  it('rejects malformed scope without touching storage', async () => {
    const claim = vi.fn(async () => 'claimed' as const);
    const retire = createGroupChatV2NonceAttemptRetirer({ claim });
    await expect(retire({ ...ATTEMPT, nonce: `0x${'00'.repeat(12)}` })).rejects.toThrow('cannot be zero');
    await expect(retire({ ...ATTEMPT, epoch: 0n })).rejects.toThrow('out of range');
    await expect(retire({ ...ATTEMPT, groupId: 0n })).rejects.toThrow('out of range');
    expect(claim).not.toHaveBeenCalled();
  });
});
