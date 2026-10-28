import { describe, expect, it } from 'vitest';
import { reconcileDexV2OwnedPositionIds } from './dexV2PositionDiscovery';

const ZERO = `0x${'00'.repeat(20)}`;
const ALICE = `0x${'11'.repeat(20)}`;
const BOB = `0x${'22'.repeat(20)}`;

const transfer = (
  blockNumber: bigint,
  logIndex: bigint,
  from: string,
  to: string,
  positionId: bigint
) => ({ blockNumber, transactionIndex: 0n, logIndex, from, to, positionId });

describe('dexV2PositionDiscovery', () => {
  it('replays mint, transfer, burn, and self-transfer in canonical log order', () => {
    const owned = reconcileDexV2OwnedPositionIds({
      owner: ALICE,
      nextPositionId: 6n,
      nftBalance: 2n,
      transfers: [
        transfer(12n, 0n, BOB, ALICE, 5n),
        transfer(10n, 2n, ALICE, ALICE, 2n),
        transfer(11n, 0n, ALICE, ZERO, 3n),
        transfer(10n, 1n, ZERO, ALICE, 3n),
        transfer(10n, 0n, ZERO, ALICE, 2n),
        transfer(11n, 1n, ALICE, BOB, 2n),
        transfer(13n, 0n, BOB, ALICE, 2n)
      ]
    });
    expect(owned).toEqual([2n, 5n]);
  });

  it('fails closed when transfer history does not reconcile to balance', () => {
    expect(() => reconcileDexV2OwnedPositionIds({
      owner: ALICE,
      nextPositionId: 3n,
      nftBalance: 2n,
      transfers: [transfer(10n, 0n, ZERO, ALICE, 1n)]
    })).toThrow(/does not reconcile/);
  });

  it('rejects zero, future, and out-of-range position IDs', () => {
    for (const positionId of [0n, 3n, 4n]) {
      expect(() => reconcileDexV2OwnedPositionIds({
        owner: ALICE,
        nextPositionId: 3n,
        nftBalance: 1n,
        transfers: [transfer(10n, 0n, ZERO, ALICE, positionId)]
      })).toThrow(/unissued/);
    }
  });

  it('rejects impossible issuance and balance bounds', () => {
    expect(() => reconcileDexV2OwnedPositionIds({
      owner: ALICE,
      nextPositionId: 2n,
      nftBalance: 2n,
      transfers: []
    })).toThrow(/issuance bounds/);
  });
});
