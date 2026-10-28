import { Interface, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import {
  attestPrivateLiquidityDailyPriceDeployment,
  bindPrivateLiquidityDailyPriceReadCapability,
  readLatestPrivateLiquidityDailyPrices,
  readPrivateLiquidityDailyPricePage
} from './privateLiquidityDailyPriceChain';

const ABI = new Interface([
  'function contractVersion() pure returns (string)',
  'function supportsFeature(bytes32 feature) pure returns (bool)',
  'function sourceBook() view returns (address)',
  'function sourceBookRuntimeHash() view returns (bytes32)',
  'function owner() view returns (address)',
  'function recorder() view returns (address)',
  'function dayCount(bytes32 pairKey) view returns (uint256)',
  'function getSnapshots(bytes32 pairKey,uint256 start,uint256 count) view returns (tuple(uint64 day,uint64 capturedAt,uint64 sourceBlockNumber,uint32 sourceLogIndex,uint8 direction,uint64 revision,uint128 priceBaseAmount,uint128 priceQuoteAmount,uint256 swapId,uint256 positionId,bytes32 sourceBlockHash,bytes32 sourceTransactionHash)[])'
]);

const store = `0x${'11'.repeat(20)}`;
const book = `0x${'22'.repeat(20)}`;
const owner = `0x${'33'.repeat(20)}`;
const recorder = `0x${'34'.repeat(20)}`;
const rotatedRecorder = `0x${'35'.repeat(20)}`;
const bookCode = '0x6002600055';
const bookRuntime = keccak256(bookCode);
const runtime = '0x6001600055';
const runtimeHash = keccak256(runtime);
const safeHash = `0x${'44'.repeat(32)}`;
const deploymentHash = `0x${'55'.repeat(32)}`;
const sourceHash = `0x${'66'.repeat(32)}`;
const sourceTransactionHash = `0x${'77'.repeat(32)}`;
const deploymentTransactionHash = `0x${'99'.repeat(32)}`;
const pairKey = `0x${'88'.repeat(32)}`;

const selector = (data: string) => data.slice(0, 10);
const result = (name: string, values: readonly unknown[]) => ABI.encodeFunctionResult(name, [...values]);

const provider = ({
  wrongRuntime = false,
  wrongBook = false,
  wrongReceipt = false,
  wrongOwner = false,
  wrongRecorder = false,
  rotateRecorderAfterAttestation = false,
  totalCount = 1n
} = {}) => {
  let recorderReads = 0;
  return Object.freeze({
  request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
    if (method === 'eth_chainId') return '0x6c11a0';
    if (method === 'eth_blockNumber') return '0x64';
    if (method === 'eth_getBlockByNumber') {
      const number = params[0];
      return number === '0x5f'
        ? { number, hash: safeHash }
        : { number, hash: deploymentHash };
    }
    if (method === 'eth_getCode') {
      const target = String(params[0]).toLowerCase();
      return target === book ? bookCode : wrongRuntime ? '0x6000' : runtime;
    }
    if (method === 'eth_getTransactionReceipt') {
      return {
        transactionHash: deploymentTransactionHash,
        blockNumber: '0x50',
        blockHash: deploymentHash,
        status: wrongReceipt ? '0x0' : '0x1',
        contractAddress: store
      };
    }
    if (method === 'eth_call') {
      const transaction = params[0] as { data: string };
      const dataSelector = selector(transaction.data);
      if (dataSelector === selector(ABI.encodeFunctionData('contractVersion'))) {
        return result('contractVersion', ['ChainWhisperPrivateLiquidityDailyPriceStoreV1']);
      }
      if (dataSelector === selector(ABI.encodeFunctionData('sourceBook'))) {
        return result('sourceBook', [wrongBook ? store : book]);
      }
      if (dataSelector === selector(ABI.encodeFunctionData('sourceBookRuntimeHash'))) {
        return result('sourceBookRuntimeHash', [bookRuntime]);
      }
      if (dataSelector === selector(ABI.encodeFunctionData('owner'))) {
        return result('owner', [wrongOwner ? rotatedRecorder : owner]);
      }
      if (dataSelector === selector(ABI.encodeFunctionData('recorder'))) {
        recorderReads += 1;
        return result('recorder', [wrongRecorder || (rotateRecorderAfterAttestation && recorderReads > 1)
          ? rotatedRecorder
          : recorder]);
      }
      if (dataSelector === selector(ABI.encodeFunctionData('supportsFeature', [keccak256(toUtf8Bytes('DAILY_MARGINAL_PRICE'))]))) {
        return result('supportsFeature', [true]);
      }
      if (dataSelector === selector(ABI.encodeFunctionData('dayCount', [pairKey]))) {
        return result('dayCount', [totalCount]);
      }
      if (dataSelector === selector(ABI.encodeFunctionData('getSnapshots', [pairKey, 0n, 0n]))) {
        return result('getSnapshots', [[{
          day: 20_000n,
          capturedAt: 20_000n * 86_400n + 86_399n,
          sourceBlockNumber: 91n,
          sourceLogIndex: 7,
          direction: 0,
          revision: 1n,
          priceBaseAmount: 10n,
          priceQuoteAmount: 12n,
          swapId: 3n,
          positionId: 4n,
          sourceBlockHash: sourceHash,
          sourceTransactionHash
        }]]);
      }
    }
    throw new Error(`Unexpected RPC ${method}`);
  }
  });
};

const manifest = Object.freeze({
  chainId: '7082400',
  address: store,
  deploymentBlock: '80',
  deploymentBlockHash: deploymentHash,
  transactionHash: deploymentTransactionHash,
  runtimeBytecodeHash: runtimeHash,
  owner,
  recorder,
  sourceBook: book,
  sourceBookRuntimeHash: bookRuntime
});

describe('privateLiquidityDailyPriceChain', () => {
  it('attests the separate analytics store and reads one safe-head-pinned page', async () => {
    const capability = await bindPrivateLiquidityDailyPriceReadCapability({
      provider: provider(),
      expectedChainId: 7_082_400n,
      assertCurrent: () => undefined
    });
    const deployment = await attestPrivateLiquidityDailyPriceDeployment({
      capability,
      manifest,
      finalityLagBlocks: 5n
    });
    const page = await readPrivateLiquidityDailyPricePage({ deployment, pairKey, start: 0n, count: 30n });
    expect(deployment.attestationBlock).toEqual({ number: '95', hash: safeHash });
    expect(page.totalCount).toBe('1');
    expect(page.snapshots[0]).toMatchObject({
      day: '20000',
      direction: 0,
      priceBaseAmount: '10',
      priceQuoteAmount: '12',
      sourceTransactionHash
    });
    expect(Object.isFrozen(page.snapshots)).toBe(true);
  });

  it('rejects runtime and source-Book substitutions before returning chart data', async () => {
    const bind = (options: Parameters<typeof provider>[0]) => bindPrivateLiquidityDailyPriceReadCapability({
      provider: provider(options),
      expectedChainId: 7_082_400n,
      assertCurrent: () => undefined
    });
    await expect(attestPrivateLiquidityDailyPriceDeployment({
      capability: await bind({ wrongRuntime: true }), manifest, finalityLagBlocks: 5n
    })).rejects.toThrow(/runtime hash/);
    await expect(attestPrivateLiquidityDailyPriceDeployment({
      capability: await bind({ wrongBook: true }), manifest, finalityLagBlocks: 5n
    })).rejects.toThrow(/wrong Private Liquidity Book/);
    await expect(attestPrivateLiquidityDailyPriceDeployment({
      capability: await bind({ wrongReceipt: true }), manifest, finalityLagBlocks: 5n
    })).rejects.toThrow(/receipt/);
    await expect(attestPrivateLiquidityDailyPriceDeployment({
      capability: await bind({ wrongOwner: true }), manifest, finalityLagBlocks: 5n
    })).rejects.toThrow(/authority/);
    await expect(attestPrivateLiquidityDailyPriceDeployment({
      capability: await bind({ wrongRecorder: true }), manifest, finalityLagBlocks: 5n
    })).rejects.toThrow(/authority/);
  });

  it('rejects a recorder rotation before returning a later chart page', async () => {
    const capability = await bindPrivateLiquidityDailyPriceReadCapability({
      provider: provider({ rotateRecorderAfterAttestation: true }),
      expectedChainId: 7_082_400n,
      assertCurrent: () => undefined
    });
    const deployment = await attestPrivateLiquidityDailyPriceDeployment({ capability, manifest, finalityLagBlocks: 5n });
    await expect(readPrivateLiquidityDailyPricePage({ deployment, pairKey, start: 0n, count: 30n }))
      .rejects.toThrow(/authority changed/);
  });

  it('rejects unbounded history requests before making a store call', async () => {
    const capability = await bindPrivateLiquidityDailyPriceReadCapability({
      provider: provider(), expectedChainId: 7_082_400n, assertCurrent: () => undefined
    });
    const deployment = await attestPrivateLiquidityDailyPriceDeployment({ capability, manifest, finalityLagBlocks: 5n });
    await expect(readPrivateLiquidityDailyPricePage({ deployment, pairKey, start: 0n, count: 367n }))
      .rejects.toThrow(/page bounds/);
  });

  it('derives the trailing page start from the same pinned total', async () => {
    const capability = await bindPrivateLiquidityDailyPriceReadCapability({
      provider: provider({ totalCount: 400n }), expectedChainId: 7_082_400n, assertCurrent: () => undefined
    });
    const deployment = await attestPrivateLiquidityDailyPriceDeployment({ capability, manifest, finalityLagBlocks: 5n });
    const page = await readLatestPrivateLiquidityDailyPrices({ deployment, pairKey, count: 366n });
    expect(page.totalCount).toBe('400');
    expect(page.start).toBe('34');
    expect(page.nextStart).toBe('35');
  });
});
