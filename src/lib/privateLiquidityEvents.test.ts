import { Interface } from 'ethers';
import { describe, expect, it } from 'vitest';
import {
  PRIVATE_LIQUIDITY_V1_EVENT_ABI,
  parsePrivateLiquidityV1Log,
  type PrivateLiquidityV1RawLog
} from './privateLiquidityEvents';

const CONTRACT = '0x0000000000000000000000000000000000000100';
const OWNER = '0x0000000000000000000000000000000000000020';
const ACTOR = '0x0000000000000000000000000000000000000030';
const BASE = '0x0000000000000000000000000000000000000040';
const QUOTE = '0x0000000000000000000000000000000000000050';
const PAIR_KEY = `0x${'11'.repeat(32)}`;
const BLOCK_HASH = `0x${'22'.repeat(32)}`;
const TRANSACTION_HASH = `0x${'33'.repeat(32)}`;
const ABI = new Interface(PRIVATE_LIQUIDITY_V1_EVENT_ABI);

const rawLog = (
  eventName: string,
  args: readonly unknown[],
  overrides: Partial<PrivateLiquidityV1RawLog> = {}
): PrivateLiquidityV1RawLog => {
  const event = ABI.getEvent(eventName);
  if (!event) throw new Error(`Missing test event ${eventName}.`);
  const encoded = ABI.encodeEventLog(event, [...args]);
  return {
    chainId: '2632500',
    address: CONTRACT,
    blockNumber: '100',
    blockHash: BLOCK_HASH,
    transactionHash: TRANSACTION_HASH,
    transactionIndex: 2,
    logIndex: 4,
    removed: false,
    topics: encoded.topics,
    data: encoded.data,
    ...overrides
  };
};

const encrypted = (offset: bigint) => [
  [offset + 1n, offset + 2n],
  [offset + 3n, offset + 4n]
];

describe('privateLiquidityEvents', () => {
  it('strictly decodes the public position creation schema', () => {
    const parsed = parsePrivateLiquidityV1Log(
      rawLog('PrivateLiquidityPositionCreated', [
        7n,
        OWNER,
        PAIR_KEY,
        BASE,
        QUOTE,
        [1n, 9n],
        [1n, 11n],
        123n,
        1n
      ])
    );
    expect(parsed).toMatchObject({
      kind: 'position-created',
      positionId: '7',
      positionOwner: OWNER,
      pairKey: PAIR_KEY,
      baseToken: BASE,
      quoteToken: QUOTE,
      buyTerms: { baseAmount: '1', quoteAmount: '9' },
      sellTerms: { baseAmount: '1', quoteAmount: '11' },
      createdAt: '123',
      revision: '1'
    });
    expect(parsed.rawEventKey).toContain(`${BLOCK_HASH}:${TRANSACTION_HASH}:4`);
  });

  it('decodes amount-free public swap markers and bounds their candidate count', () => {
    const parsed = parsePrivateLiquidityV1Log(
      rawLog('PrivateLiquiditySwapExecuted', [5n, OWNER, PAIR_KEY, 1, 8n])
    );
    expect(parsed).toMatchObject({
      kind: 'swap-executed',
      swapId: '5',
      trader: OWNER,
      pairKey: PAIR_KEY,
      direction: 'quote-to-base',
      candidateCount: 8
    });
    expect(() =>
      parsePrivateLiquidityV1Log(
        rawLog('PrivateLiquiditySwapExecuted', [5n, OWNER, PAIR_KEY, 0, 9n])
      )
    ).toThrow(/out of range/);
  });

  it('preserves all four recipient-bound ciphertext limbs without decrypting them', () => {
    const positionReceipt = parsePrivateLiquidityV1Log(
      rawLog('PrivateLiquidityPositionExecutionReceiptUpdated', [
        7n,
        5n,
        OWNER,
        0,
        encrypted(10n),
        encrypted(20n)
      ])
    );
    expect(positionReceipt).toMatchObject({
      kind: 'position-execution-receipt',
      positionId: '7',
      swapId: '5',
      recipient: OWNER,
      direction: 'base-to-quote',
      baseAmount: {
        ciphertextHigh: '11',
        ciphertextLow: '12',
        userCiphertextHigh: '13',
        userCiphertextLow: '14'
      },
      quoteAmount: {
        ciphertextHigh: '21',
        ciphertextLow: '22',
        userCiphertextHigh: '23',
        userCiphertextLow: '24'
      }
    });

    const traderReceipt = parsePrivateLiquidityV1Log(
      rawLog('PrivateLiquidityTraderSwapReceiptUpdated', [
        5n,
        OWNER,
        PAIR_KEY,
        1,
        encrypted(30n),
        encrypted(40n),
        encrypted(50n)
      ])
    );
    expect(traderReceipt).toMatchObject({
      kind: 'trader-swap-receipt',
      inputAmount: {
        ciphertextHigh: '31',
        ciphertextLow: '32',
        userCiphertextHigh: '33',
        userCiphertextLow: '34'
      },
      outputAmount: {
        ciphertextHigh: '41',
        ciphertextLow: '42',
        userCiphertextHigh: '43',
        userCiphertextLow: '44'
      },
      unusedInputAmount: {
        ciphertextHigh: '51',
        ciphertextLow: '52',
        userCiphertextHigh: '53',
        userCiphertextLow: '54'
      }
    });
  });

  it('decodes transfer activation and owner snapshot lifecycle events', () => {
    const activation = parsePrivateLiquidityV1Log(
      rawLog('PrivateLiquidityPositionTransferActivationRequired', [7n, OWNER, ACTOR, 3n])
    );
    expect(activation).toMatchObject({
      kind: 'position-transfer-activation-required',
      positionId: '7',
      previousOwner: OWNER,
      nextOwner: ACTOR,
      revision: '3'
    });

    const snapshot = parsePrivateLiquidityV1Log(
      rawLog('PrivateLiquidityOwnerInventorySnapshotUpdated', [
        7n,
        OWNER,
        ACTOR,
        6n,
        encrypted(50n),
        encrypted(60n)
      ])
    );
    expect(snapshot).toMatchObject({
      kind: 'position-owner-inventory',
      positionId: '7',
      recipient: OWNER,
      actor: ACTOR,
      sequence: '6'
    });
  });

  it('allows zero only in standard ERC-721 mint and burn endpoints', () => {
    const mint = parsePrivateLiquidityV1Log(
      rawLog('Transfer', ['0x0000000000000000000000000000000000000000', OWNER, 7n])
    );
    expect(mint).toMatchObject({
      kind: 'position-transfer',
      from: '0x0000000000000000000000000000000000000000',
      to: OWNER,
      positionId: '7'
    });
  });

  it('rejects removed, malformed, foreign, and impossible event observations', () => {
    const valid = rawLog('PrivateLiquiditySwapExecuted', [5n, OWNER, PAIR_KEY, 0, 2n]);
    expect(() => parsePrivateLiquidityV1Log({ ...valid, removed: true } as never)).toThrow(
      /Removed logs/
    );
    expect(() => parsePrivateLiquidityV1Log({ ...valid, blockHash: '0x12' })).toThrow(/bytes32/);
    expect(() => parsePrivateLiquidityV1Log({ ...valid, data: '0x1' })).toThrow(/hex bytes/);

    const foreign = new Interface(['event ForeignEvent(uint256 value)']);
    const foreignEvent = foreign.getEvent('ForeignEvent');
    if (!foreignEvent) throw new Error('Missing foreign event.');
    const encoded = foreign.encodeEventLog(foreignEvent, [1n]);
    expect(() =>
      parsePrivateLiquidityV1Log({ ...valid, topics: encoded.topics, data: encoded.data })
    ).toThrow(/not a canonical PrivateLiquidityBookV1 event/);
  });
});
