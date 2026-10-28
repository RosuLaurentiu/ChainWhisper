import { describe, expect, it, vi } from 'vitest';

const reads = vi.hoisted(() => ({ provider: vi.fn(() => { throw new Error('Wrong-chain legacy RPC read'); }) }));
vi.mock('./chainWhisperNetworks', async original => {
  const actual = await original<typeof import('./chainWhisperNetworks')>();
  return { ...actual, CONFIGURED_COTI_NETWORK: actual.COTI_TESTNET_NETWORK };
});
vi.mock('./appShared', async original => ({
  ...await original<typeof import('./appShared')>(), loadCotiReadProvider: reads.provider
}));
import { fetchRecentTradeSnapshots, fetchWalletTradeSnapshots, fetchTradeSnapshotById } from './appChain';

const options = { rewardTokenSymbol: 'WISP', rewardTokenDecimals: 6,
  privateRewardTokenSymbol: 'p.WISP', privateRewardTokenDecimals: 6 };

describe('legacy Mainnet discovery in the Testnet App', () => {
  it('does not query Mainnet deployments for Testnet public or wallet discovery', async () => {
    await expect(fetchRecentTradeSnapshots(options)).resolves.toEqual([]);
    await expect(fetchWalletTradeSnapshots('0x1111111111111111111111111111111111111111', options)).resolves.toEqual([]);
    expect(reads.provider).not.toHaveBeenCalled();
  });

  it('rejects an exact legacy order read on the wrong network before RPC access', async () => {
    await expect(fetchTradeSnapshotById(1, options)).rejects.toThrow(/Mainnet/);
    expect(reads.provider).not.toHaveBeenCalled();
  });
});
