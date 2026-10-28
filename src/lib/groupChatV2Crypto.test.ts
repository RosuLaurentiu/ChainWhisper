import { AbiCoder, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import {
  GROUP_CHAT_V2_MAX_CIPHERTEXT_BYTES,
  GROUP_CHAT_V2_NONCE_BYTES,
  decryptGroupChatV2Message,
  decryptGroupChatV2Metadata,
  deriveGroupChatV2MessageAadHash,
  deriveGroupChatV2MetadataAadHash,
  encryptGroupChatV2Message,
  encryptGroupChatV2Metadata,
  type GroupChatV2MessageContext,
  type GroupChatV2MetadataContext
} from './groupChatV2Crypto';

const GROUP = '0x3333333333333333333333333333333333333333';
const ALICE = '0x1111111111111111111111111111111111111111';
const CHAIN_ID = 7_082_400n;
const SEED = { value: 0x0123456789abcdeffedcba9876543210n };
const NONCE = '0x0102030405060708090a0b0c';

const messageContext = {
  chainId: CHAIN_ID,
  contractAddress: GROUP,
  groupId: 42n,
  epoch: 3n,
  membershipRevision: 7n,
  sender: ALICE,
  senderSequence: 2n,
  valueSent: 5n,
  feeTaken: 5n
} satisfies GroupChatV2MessageContext;

const metadataContext = {
  chainId: CHAIN_ID,
  contractAddress: GROUP,
  groupId: 42n,
  epoch: 3n,
  membershipRevision: 7n,
  metadataVersion: 4n,
  editor: ALICE
} satisfies GroupChatV2MetadataContext;

describe('groupChatV2Crypto', () => {
  it('round-trips group messages with a fresh epoch-wide nonce per attempt', async () => {
    const first = await encryptGroupChatV2Message('hello group', SEED, messageContext);
    const second = await encryptGroupChatV2Message('hello group', SEED, messageContext);

    expect((first.nonce.length - 2) / 2).toBe(GROUP_CHAT_V2_NONCE_BYTES);
    expect(first.nonce).not.toBe('0x000000000000000000000000');
    expect(second.nonce).not.toBe(first.nonce);
    expect(second.ciphertext).not.toBe(first.ciphertext);
    await expect(decryptGroupChatV2Message(first, SEED, messageContext)).resolves.toBe('hello group');
  });

  it('matches the exact Solidity message AAD schema', () => {
    const expected = keccak256(AbiCoder.defaultAbiCoder().encode(
      [
        'bytes32', 'uint16', 'uint256', 'address', 'uint256', 'uint64',
        'uint32', 'address', 'uint64', 'bytes12', 'uint256', 'uint256'
      ],
      [
        keccak256(toUtf8Bytes('chainwhisper.group-chat.v2.aes-gcm.aad.v1')),
        2n,
        CHAIN_ID,
        GROUP,
        42n,
        3n,
        7n,
        ALICE,
        2n,
        NONCE,
        5n,
        5n
      ]
    ));
    expect(deriveGroupChatV2MessageAadHash(messageContext, NONCE)).toBe(expected);
  });

  it('uses a distinct metadata key and exact metadata AAD schema', async () => {
    const encrypted = await encryptGroupChatV2Metadata('{"title":"Private title"}', SEED, metadataContext);
    const expectedAad = keccak256(AbiCoder.defaultAbiCoder().encode(
      [
        'bytes32', 'uint16', 'uint256', 'address', 'uint256', 'uint64',
        'uint32', 'uint64', 'address', 'bytes12'
      ],
      [
        keccak256(toUtf8Bytes('chainwhisper.group-chat.v2.metadata.aad.v1')),
        2n,
        CHAIN_ID,
        GROUP,
        42n,
        3n,
        7n,
        4n,
        ALICE,
        NONCE
      ]
    ));
    expect(deriveGroupChatV2MetadataAadHash(metadataContext, NONCE)).toBe(expectedAad);
    await expect(decryptGroupChatV2Metadata(encrypted, SEED, metadataContext)).resolves.toBe(
      '{"title":"Private title"}'
    );
    await expect(decryptGroupChatV2Message(encrypted, SEED, messageContext)).rejects.toThrow();
  });

  it('authenticates group, epoch, revision, sender, sequence, fee, and metadata version', async () => {
    const message = await encryptGroupChatV2Message('bound', SEED, messageContext);
    const messageMutations: GroupChatV2MessageContext[] = [
      { ...messageContext, groupId: 43n },
      { ...messageContext, epoch: 4n },
      { ...messageContext, membershipRevision: 8n },
      { ...messageContext, sender: '0x2222222222222222222222222222222222222222' },
      { ...messageContext, senderSequence: 3n },
      { ...messageContext, valueSent: 6n, feeTaken: 6n }
    ];
    for (const mutated of messageMutations) {
      await expect(decryptGroupChatV2Message(message, SEED, mutated)).rejects.toThrow();
    }

    const metadata = await encryptGroupChatV2Metadata('title', SEED, metadataContext);
    await expect(decryptGroupChatV2Metadata(
      metadata,
      SEED,
      { ...metadataContext, metadataVersion: 5n }
    )).rejects.toThrow();
  });

  it('accepts the exact ciphertext boundaries and rejects one byte above the cap', async () => {
    const empty = await encryptGroupChatV2Message('', SEED, messageContext);
    expect((empty.ciphertext.length - 2) / 2).toBe(16);
    await expect(decryptGroupChatV2Message(empty, SEED, messageContext)).resolves.toBe('');

    const maximumPlaintext = 'a'.repeat(GROUP_CHAT_V2_MAX_CIPHERTEXT_BYTES - 16);
    const maximum = await encryptGroupChatV2Message(maximumPlaintext, SEED, messageContext);
    expect((maximum.ciphertext.length - 2) / 2).toBe(GROUP_CHAT_V2_MAX_CIPHERTEXT_BYTES);
    await expect(encryptGroupChatV2Message(`${maximumPlaintext}a`, SEED, messageContext)).rejects.toThrow(
      'contract limit'
    );
  });

  it('fails closed on zero nonces, out-of-range seeds, and non-exact fee values', async () => {
    expect(() => deriveGroupChatV2MessageAadHash(
      messageContext,
      '0x000000000000000000000000'
    )).toThrow('non-zero');
    expect(() => deriveGroupChatV2MessageAadHash(
      { ...messageContext, valueSent: 6n },
      NONCE
    )).toThrow('exact fee');
    await expect(encryptGroupChatV2Message('message', { value: 1n << 128n }, messageContext))
      .rejects.toThrow('Group epoch seed');
  });
});
