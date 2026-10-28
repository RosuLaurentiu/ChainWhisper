import { Interface, keccak256, toUtf8Bytes, type Eip1193Provider } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import {
  attestPrivateLiquidityDeployment,
  bindPrivateLiquidityReadCapability,
  type CanonicalPrivateLiquidityLogRange
} from './privateLiquidityChain';
import { materializeCanonicalPrivateLiquidityHistory } from './privateLiquidityHistoryMaterialize';
import {
  createPrivateLiquidityHistorySyncState,
  getPrivateLiquidityHistorySyncScope,
  syncPrivateLiquidityHistoryRange
} from './privateLiquiditySync';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const quantity = (value: bigint): string => `0x${value.toString(16)}`;
const canonicalHash = (number: bigint, salt = 0n): string =>
  `0x${(number + salt * 10_000n).toString(16).padStart(64, '0')}`;

const CHAIN_ID = 7_082_400n;
const CONTRACT = address('11');
const VIEWER = address('22');
const CODE = '0x6001600055';
const METADATA = new Interface([
  'function contractVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)'
]);
const APP_WALLET_FEATURE = keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR')).toLowerCase();

class SyncProvider implements Pick<Eip1193Provider, 'request'> {
  latest = 130n;
  failLogs = false;
  readonly hashSaltByBlock = new Map<bigint, bigint>();

  hash(number: bigint): string {
    return canonicalHash(number, this.hashSaltByBlock.get(number) ?? 0n);
  }

  async request({ method, params = [] }: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    if (method === 'eth_chainId') return quantity(CHAIN_ID);
    if (method === 'eth_blockNumber') return quantity(this.latest);
    if (method === 'eth_getBlockByNumber') {
      const number = BigInt(String(params[0]));
      return { number: quantity(number), hash: this.hash(number), transactions: [] };
    }
    if (method === 'eth_getCode') return CODE;
    if (method === 'eth_getLogs') {
      if (this.failLogs) throw new Error('Injected provider failure.');
      return [];
    }
    if (method === 'eth_call') {
      const call = params[0] as { data: string };
      const parsed = METADATA.parseTransaction({ data: call.data });
      if (!parsed) throw new Error('Unknown metadata call.');
      return parsed.name === 'contractVersion'
        ? METADATA.encodeFunctionResult(parsed.name, ['ChainWhisperPrivateLiquidityBookV1'])
        : METADATA.encodeFunctionResult(parsed.name, [
            String(parsed.args[0]).toLowerCase() !== APP_WALLET_FEATURE
          ]);
    }
    throw new Error(`Unexpected RPC ${method}.`);
  }
}

const setup = async () => {
  const provider = new SyncProvider();
  const capability = await bindPrivateLiquidityReadCapability({
    provider,
    expectedChainId: CHAIN_ID,
    assertCurrent: () => undefined
  });
  const deployment = await attestPrivateLiquidityDeployment({
    capability,
    manifest: {
      chainId: CHAIN_ID,
      contractAddress: CONTRACT,
      deploymentBlock: 100n,
      runtimeBytecodeHash: keccak256(CODE)
    },
    finalityLagBlocks: 5n
  });
  return { provider, capability, deployment };
};

describe('privateLiquiditySync', () => {
  it('paginates complete canonical ranges with overlap and commits each checkpoint atomically', async () => {
    const context = await setup();
    let state = createPrivateLiquidityHistorySyncState();
    for (const expected of [
      { revision: 0, range: { fromBlock: '100', toBlock: '109' }, hasMore: true },
      { revision: 1, range: { fromBlock: '108', toBlock: '117' }, hasMore: true },
      { revision: 2, range: { fromBlock: '116', toBlock: '125' }, hasMore: false }
    ]) {
      const result = await syncPrivateLiquidityHistoryRange({
        previous: state,
        capability: context.capability,
        deployment: context.deployment,
        maxBlockSpan: 10n,
        overlapBlocks: 2n,
        expectedRevision: expected.revision
      });
      expect(result.status).toBe('page-applied');
      expect(result.page).toEqual(expected.range);
      expect(result.hasMore).toBe(expected.hasMore);
      state = result.state;
    }
    const scope = getPrivateLiquidityHistorySyncScope({ state, deployment: context.deployment });
    expect(scope.revision).toBe(3);
    expect(scope.pages).toHaveLength(3);
    expect(scope.checkpoint).toEqual({ blockNumber: '125', blockHash: context.provider.hash(125n) });
    const snapshot = await materializeCanonicalPrivateLiquidityHistory({
      pages: scope.pages,
      viewer: VIEWER,
      decrypt: async () => {
        throw new Error('No empty-page receipt should be decrypted.');
      }
    });
    expect(snapshot.coverage).toMatchObject({
      fromBlock: '100',
      toBlock: '125',
      safeHead: '125',
      completeFromDeploymentThroughSafeHead: true,
      hasRangeGaps: false
    });
    const upToDate = await syncPrivateLiquidityHistoryRange({
      previous: state,
      capability: context.capability,
      deployment: context.deployment,
      maxBlockSpan: 10n,
      overlapBlocks: 2n,
      expectedRevision: 3
    });
    expect(upToDate).toMatchObject({ status: 'up-to-date', state, hasMore: false, reorged: false });
  });

  it('clears only the affected deployment and replays from deployment after a checkpoint reorg', async () => {
    const context = await setup();
    context.provider.latest = 145n;
    let state = createPrivateLiquidityHistorySyncState();
    for (let revision = 0; revision < 4; revision += 1) {
      const result = await syncPrivateLiquidityHistoryRange({
        previous: state,
        capability: context.capability,
        deployment: context.deployment,
        maxBlockSpan: 10n,
        overlapBlocks: 2n,
        expectedRevision: revision
      });
      state = result.state;
    }
    const before = getPrivateLiquidityHistorySyncScope({ state, deployment: context.deployment });
    expect(before.checkpoint?.blockNumber).toBe('133');
    expect(before.pages).toHaveLength(4);
    context.provider.hashSaltByBlock.set(133n, 1n);
    const replay = await syncPrivateLiquidityHistoryRange({
      previous: state,
      capability: context.capability,
      deployment: context.deployment,
      maxBlockSpan: 10n,
      overlapBlocks: 2n,
      expectedRevision: 4
    });
    expect(replay).toMatchObject({
      status: 'reorg-replay',
      reorged: true,
      page: { fromBlock: '100', toBlock: '109' }
    });
    const after = getPrivateLiquidityHistorySyncScope({ state: replay.state, deployment: context.deployment });
    expect(after.revision).toBe(5);
    expect(after.pages).toHaveLength(1);
    expect(after.checkpoint?.blockNumber).toBe('109');
  });

  it('rejects stale, forged, and interrupted work without mutating the previous state', async () => {
    const context = await setup();
    const initial = createPrivateLiquidityHistorySyncState();
    await expect(syncPrivateLiquidityHistoryRange({
      previous: initial,
      capability: context.capability,
      deployment: context.deployment,
      maxBlockSpan: 10n,
      overlapBlocks: 2n,
      expectedRevision: 1
    })).rejects.toThrow(/stale revision/);
    await expect(syncPrivateLiquidityHistoryRange({
      previous: initial,
      capability: context.capability,
      deployment: context.deployment,
      maxBlockSpan: 10n,
      overlapBlocks: 2n,
      expectedRevision: 0,
      shouldContinue: () => false
    })).rejects.toThrow(/scope changed/);
    const forged = {
      scopes: {
        [`chainwhisper-private-liquidity-v1:${CHAIN_ID}:${CONTRACT}:100`]: {
          revision: 0,
          pages: [{} as CanonicalPrivateLiquidityLogRange]
        }
      }
    };
    await expect(syncPrivateLiquidityHistoryRange({
      previous: forged,
      capability: context.capability,
      deployment: context.deployment,
      maxBlockSpan: 10n,
      overlapBlocks: 2n,
      expectedRevision: 0
    })).rejects.toThrow(/provider-owned canonical page/);
    context.provider.failLogs = true;
    await expect(syncPrivateLiquidityHistoryRange({
      previous: initial,
      capability: context.capability,
      deployment: context.deployment,
      maxBlockSpan: 10n,
      overlapBlocks: 2n,
      expectedRevision: 0
    })).rejects.toThrow(/eth_getLogs failed/);
    expect(initial).toEqual(createPrivateLiquidityHistorySyncState());
  });
});
