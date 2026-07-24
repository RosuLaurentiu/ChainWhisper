import { describe, expect, it, vi } from 'vitest';
import {
  findRecoveryTransactionHash,
  resolveRecoveryTransactionHash,
  type RecoveryExplorerTransaction
} from './recoveryExplorer';
import { CW_PROFILE_REGISTRY_CONTRACT_ADDRESS } from './appShared';

const OWNER = '0x5DFcEe20b5a3FDd3577436A32f62d4C0b39e979d';
const OTHER_OWNER = '0xbf01185A70CDfEF1858659836D57BFf085ebed55';
const ADD_PROFILE_INPUT = `0xe43260fc${'0'.repeat(64)}`;
const createTransaction = ({
  blockNumber,
  hashCharacter,
  input = ADD_PROFILE_INPUT,
  owner = OWNER
}: {
  blockNumber: number;
  hashCharacter: string;
  input?: string;
  owner?: string;
}): RecoveryExplorerTransaction => ({
  block_number: blockNumber,
  from: { hash: owner },
  hash: `0x${hashCharacter.repeat(64)}`,
  position: 1,
  raw_input: input,
  status: 'ok',
  to: { hash: CW_PROFILE_REGISTRY_CONTRACT_ADDRESS }
});

describe('recovery explorer lookup', () => {
  it('maps an owner profile number to its chronological addProfile transaction', () => {
    expect(
      resolveRecoveryTransactionHash({
        ownerAddress: OWNER,
        profileId: 1,
        transactions: [
          createTransaction({ blockNumber: 30, hashCharacter: '3' }),
          createTransaction({ blockNumber: 10, hashCharacter: 'a', owner: OTHER_OWNER }),
          createTransaction({ blockNumber: 20, hashCharacter: '2' }),
          createTransaction({ blockNumber: 10, hashCharacter: '1' })
        ]
      })
    ).toBe(`0x${'2'.repeat(64)}`);
  });

  it('returns the latest setProfile transaction for the recovered profile', () => {
    const setProfileZeroInput = `0xab479c7a${'0'.repeat(64)}${'0'.repeat(64)}`;
    expect(
      resolveRecoveryTransactionHash({
        ownerAddress: OWNER,
        profileId: 0,
        transactions: [
          createTransaction({ blockNumber: 10, hashCharacter: '1' }),
          createTransaction({
            blockNumber: 20,
            hashCharacter: '2',
            input: setProfileZeroInput
          })
        ]
      })
    ).toBe(`0x${'2'.repeat(64)}`);
  });

  it('follows Blockscout pagination and resolves the historical transaction', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [createTransaction({ blockNumber: 20, hashCharacter: '2' })],
            next_page_params: { block_number: 19, index: 1, items_count: 50 }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [createTransaction({ blockNumber: 10, hashCharacter: '1' })],
            next_page_params: null
          }),
          { status: 200 }
        )
      );

    await expect(
      findRecoveryTransactionHash({
        ownerAddress: OWNER,
        profileId: 0,
        fetchImpl
      })
    ).resolves.toBe(`0x${'1'.repeat(64)}`);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toContain('block_number=19');
  });
});
