import { describe, expect, it } from 'vitest';
import {
  decodeFunctionData,
  encodeFunctionResult,
  keccak256,
  parseAbi,
  toHex,
  type Hex
} from 'viem';
import {
  ManifestPrivateLiquidityDailyPriceApiSource,
  parsePrivateLiquidityDailyPriceApiManifest
} from '../src/privateLiquidityDailyPrice';
import type { ContractReader } from '../src/rpc';

const contracts = {
  directChatV2: 'ChainWhisperChatV2',
  groupChatV2: 'ChainWhisperGroupChatV2',
  chatReactionsV1: 'ChatReactionsV1',
  directOtcV2: 'ChainWhisperDirectOTCEscrowV2',
  standardOtcV2: 'ChainWhisperStandardOTCEscrowV2',
  privateOtcV2: 'ChainWhisperPrivateOTCEscrowV2',
  recurringOtcV2: 'ChainWhisperRecurringOTCEscrowV2',
  'private-recurringOtcV2': 'ChainWhisperPrivateRecurringOTCEscrowV2',
  privateLiquidityBookV2: 'ChainWhisperPrivateLiquidityBookV2',
  privateLiquidityHiddenIntentV2: 'ChainWhisperPrivateLiquidityHiddenIntentModuleV2',
  privateLiquidityPositionNftV2: 'ChainWhisperPrivateLiquidityPositionNFTV2',
  publicTestTokenA: 'ChainWhisperTestPublicTokenV1',
  publicTestTokenB: 'ChainWhisperTestPublicTokenV1',
  privateTestTokenA: 'ChainWhisperTestPrivateTokenV1',
  privateTestTokenB: 'ChainWhisperTestPrivateTokenV1'
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]));
};

const candidateBody = (bookCode: Hex) => {
  const components = Object.entries(contracts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, contract], index) => ({
      key,
      contract,
      address: `0x${(index + 1).toString(16).padStart(40, '0')}`,
      runtimeBytecodeHash: key === 'privateLiquidityBookV2'
        ? keccak256(bookCode)
        : `0x${(index + 101).toString(16).padStart(64, '0')}`,
      deploymentBlock: String(80 + index)
    }));
  const byKey = new Map(components.map((item) => [item.key, item]));
  return {
    schemaVersion: 1,
    status: 'attested-testnet-candidate-not-app-active',
    network: 'cotiTestnet',
    chainId: '7082400',
    owner: '0x1111111111111111111111111111111111111111',
    attestationBlock: { number: '100', hash: keccak256(toHex('block:100')) },
    components,
    relationships: {
      chatReactionsV1: {
        directChatV2: byKey.get('directChatV2')!.address,
        groupChatV2: byKey.get('groupChatV2')!.address
      },
      tokenAdmissionOperations: 16,
      appActivated: false
    }
  };
};

const withHash = (body: Record<string, unknown>) => JSON.stringify({
  ...body,
  manifestHash: keccak256(toHex(JSON.stringify(canonicalize(body))))
});

const STORE_ABI = parseAbi([
  'function contractVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)',
  'function sourceBook() view returns (address)',
  'function sourceBookRuntimeHash() view returns (bytes32)',
  'function owner() view returns (address)',
  'function recorder() view returns (address)',
  'function dayCount(bytes32 pairKey) view returns (uint256)',
  'function getSnapshots(bytes32 pairKey,uint256 start,uint256 count) view returns ((uint64 day,uint64 capturedAt,uint64 sourceBlockNumber,uint32 sourceLogIndex,uint8 direction,uint64 revision,uint128 priceBaseAmount,uint128 priceQuoteAmount,uint256 swapId,uint256 positionId,bytes32 sourceBlockHash,bytes32 sourceTransactionHash)[])'
]);

const fixture = () => {
  const storeCode = '0x6001' as Hex;
  const bookCode = '0x6002' as Hex;
  const candidate = candidateBody(bookCode);
  const book = candidate.components.find(({ key }) => key === 'privateLiquidityBookV2')!;
  const analyticsBody = {
    schemaVersion: 1,
    status: 'attested-analytics-candidate-not-app-active',
    network: 'cotiTestnet',
    analyticsKind: 'private-liquidity-daily-marginal-price-v1',
    contract: 'ChainWhisperPrivateLiquidityDailyPriceStoreV1',
    chainId: '7082400',
    address: '0x9999999999999999999999999999999999999999',
    runtimeBytecodeHash: keccak256(storeCode),
    deploymentBlock: '95',
    deploymentBlockHash: keccak256(toHex('block:95')),
    deploymentTransactionHash: keccak256(toHex('analytics-deploy')),
    sourceBook: book.address,
    sourceBookRuntimeHash: book.runtimeBytecodeHash,
    owner: candidate.owner,
    recorder: '0x2222222222222222222222222222222222222222',
    attestationBlock: { number: '100', hash: keccak256(toHex('block:100')) },
    appActivated: false
  };
  return {
    storeCode,
    bookCode,
    candidateJson: withHash(candidate),
    analyticsJson: withHash(analyticsBody),
    analyticsBody
  };
};

class DailyPriceRpc implements ContractReader {
  readonly #fixture: ReturnType<typeof fixture>;
  readonly #options: Readonly<{
    reorg?: boolean;
    invalidPoint?: boolean;
    wrongVersion?: boolean;
    dayCount?: bigint;
  }>;
  #safeReads = 0;

  constructor(value: ReturnType<typeof fixture>, options: DailyPriceRpc['#options'] = {}) {
    this.#fixture = value;
    this.#options = options;
  }

  async readContract(): Promise<unknown> {
    throw new Error('Pinned analytics reads must not use latest-block readContract.');
  }

  async request<T>(method: string, params: readonly unknown[]): Promise<T> {
    const body = this.#fixture.analyticsBody;
    if (method === 'eth_chainId') return '0x6c11a0' as T;
    if (method === 'eth_blockNumber') return '0x6e' as T;
    if (method === 'eth_getBlockByNumber') {
      const number = BigInt(String(params[0]));
      if (number === 108n) this.#safeReads += 1;
      const reorged = number === 108n && this.#options.reorg === true && this.#safeReads > 1;
      return {
        number: toHex(number),
        hash: keccak256(toHex(reorged ? `reorg:${number}` : `block:${number}`)),
        timestamp: toHex(1_800_000_000n + number)
      } as T;
    }
    if (method === 'eth_getCode') {
      return (String(params[0]).toLowerCase() === body.address.toLowerCase()
        ? this.#fixture.storeCode
        : this.#fixture.bookCode) as T;
    }
    if (method === 'eth_getTransactionReceipt') {
      return {
        transactionHash: body.deploymentTransactionHash,
        blockNumber: toHex(95n),
        blockHash: body.deploymentBlockHash,
        status: '0x1',
        contractAddress: body.address
      } as T;
    }
    if (method === 'eth_call') {
      const decoded = decodeFunctionData({
        abi: STORE_ABI,
        data: (params[0] as { data: Hex }).data
      });
      switch (decoded.functionName) {
        case 'contractVersion': return encodeFunctionResult({
          abi: STORE_ABI, functionName: decoded.functionName,
          result: this.#options.wrongVersion
            ? 'ChainWhisperPrivateLiquidityDailyPriceStoreV2'
            : 'ChainWhisperPrivateLiquidityDailyPriceStoreV1'
        }) as T;
        case 'supportsFeature': return encodeFunctionResult({
          abi: STORE_ABI, functionName: decoded.functionName, result: true
        }) as T;
        case 'sourceBook': return encodeFunctionResult({
          abi: STORE_ABI, functionName: decoded.functionName, result: body.sourceBook
        }) as T;
        case 'sourceBookRuntimeHash': return encodeFunctionResult({
          abi: STORE_ABI, functionName: decoded.functionName, result: body.sourceBookRuntimeHash
        }) as T;
        case 'owner': return encodeFunctionResult({
          abi: STORE_ABI, functionName: decoded.functionName, result: body.owner
        }) as T;
        case 'recorder': return encodeFunctionResult({
          abi: STORE_ABI, functionName: decoded.functionName, result: body.recorder
        }) as T;
        case 'dayCount': return encodeFunctionResult({
          abi: STORE_ABI,
          functionName: decoded.functionName,
          result: this.#options.dayCount ?? 3n
        }) as T;
        case 'getSnapshots': {
          const [,, count] = decoded.args;
          const start = decoded.args[1];
          const points = Array.from({ length: Number(count) }, (_, offset) => {
            const index = start + BigInt(offset);
            const day = 20_830n + index;
            return [
              day,
              day * 86_400n + 60n,
              this.#options.invalidPoint ? 0n : 101n + index,
              Number(index),
              Number(index % 2n),
              1n,
              1_000_000n,
              1_000_000n + index * 10_000n,
              10n + index,
              20n + index,
              keccak256(toHex(`source-block:${index}`)),
              keccak256(toHex(`source-tx:${index}`))
            ] as const;
          });
          return encodeFunctionResult({
            abi: STORE_ABI, functionName: decoded.functionName, result: points
          }) as T;
        }
      }
    }
    throw new Error(`unexpected RPC ${method}`);
  }
}

describe('Private Liquidity daily-price API source', () => {
  it('accepts only an exact analytics manifest bound to the unified Book', () => {
    const value = fixture();
    const parsed = parsePrivateLiquidityDailyPriceApiManifest(
      value.analyticsJson,
      value.candidateJson
    );
    expect(parsed.sourceBook).toBe(value.analyticsBody.sourceBook);

    const wrong = { ...value.analyticsBody, sourceBook: '0x8888888888888888888888888888888888888888' };
    expect(() => parsePrivateLiquidityDailyPriceApiManifest(
      withHash(wrong),
      value.candidateJson
    )).toThrow('not the unified candidate');
  });

  it('returns the latest bounded canonical range with explicit privacy limits', async () => {
    const value = fixture();
    const source = new ManifestPrivateLiquidityDailyPriceApiSource({
      analyticsManifestJson: value.analyticsJson,
      candidateManifestJson: value.candidateJson,
      rpc: new DailyPriceRpc(value)
    });
    const page = await source.getDailyPrices({
      pairKey: keccak256(toHex('pair')),
      start: null,
      limit: 2
    });
    expect(page).toMatchObject({
      totalCount: '3',
      start: '1',
      nextStart: null,
      completeRange: true
    });
    expect(page.points.map(({ day }) => day)).toEqual(['20831', '20832']);
    expect(page.privacyBoundary).toEqual({
      publicFields: ['daily-marginal-price', 'utc-day', 'source-provenance'],
      excluded: ['liquidity-depth', 'inventory', 'traded-amounts', 'volume', 'participants'],
      recorderReplayVerifiedByApi: false
    });
    expect(JSON.stringify(page)).not.toMatch(/"(?:owner|recorder)"|liquidityDepth|inventoryAmount|tradedAmount/iu);
  });

  it('supports an explicit append-only start without returning an incomplete page', async () => {
    const value = fixture();
    const source = new ManifestPrivateLiquidityDailyPriceApiSource({
      analyticsManifestJson: value.analyticsJson,
      candidateManifestJson: value.candidateJson,
      rpc: new DailyPriceRpc(value)
    });
    const page = await source.getDailyPrices({
      pairKey: keccak256(toHex('pair')),
      start: 0,
      limit: 2
    });
    expect(page.start).toBe('0');
    expect(page.nextStart).toBe('2');
    expect(page.points).toHaveLength(2);
  });

  it('accepts a canonical empty store without inventing live points', async () => {
    const value = fixture();
    const source = new ManifestPrivateLiquidityDailyPriceApiSource({
      analyticsManifestJson: value.analyticsJson,
      candidateManifestJson: value.candidateJson,
      rpc: new DailyPriceRpc(value, { dayCount: 0n })
    });
    const page = await source.getDailyPrices({
      pairKey: keccak256(toHex('pair')),
      start: null,
      limit: 90
    });
    expect(page).toMatchObject({
      totalCount: '0',
      start: '0',
      nextStart: null,
      completeRange: true,
      points: []
    });
  });

  it('fails closed on a live contract-version mismatch', async () => {
    const value = fixture();
    const source = new ManifestPrivateLiquidityDailyPriceApiSource({
      analyticsManifestJson: value.analyticsJson,
      candidateManifestJson: value.candidateJson,
      rpc: new DailyPriceRpc(value, { wrongVersion: true })
    });
    await expect(source.getDailyPrices({
      pairKey: keccak256(toHex('pair')),
      start: null,
      limit: 1
    })).rejects.toThrow('incompatible analytics deployment');
  });

  it('fails closed on malformed stored snapshots', async () => {
    const value = fixture();
    const source = new ManifestPrivateLiquidityDailyPriceApiSource({
      analyticsManifestJson: value.analyticsJson,
      candidateManifestJson: value.candidateJson,
      rpc: new DailyPriceRpc(value, { invalidPoint: true })
    });
    await expect(source.getDailyPrices({
      pairKey: keccak256(toHex('pair')),
      start: 0,
      limit: 1
    })).rejects.toThrow('snapshot invariant');
  });

  it('fails closed when the safe-head block changes during the read', async () => {
    const value = fixture();
    const source = new ManifestPrivateLiquidityDailyPriceApiSource({
      analyticsManifestJson: value.analyticsJson,
      candidateManifestJson: value.candidateJson,
      rpc: new DailyPriceRpc(value, { reorg: true })
    });
    await expect(source.getDailyPrices({
      pairKey: keccak256(toHex('pair')),
      start: 0,
      limit: 1
    })).rejects.toThrow('canonical analytics page changed');
  });
});
