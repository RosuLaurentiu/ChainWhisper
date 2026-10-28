import { describe, expect, it } from 'vitest';
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toHex,
  type Hex
} from 'viem';
import {
  ManifestPrivateLiquidityV2ApiSource,
  parsePrivateLiquidityV2ApiManifest
} from '../src/privateLiquidityV2';
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

const body = () => {
  const components = Object.entries(contracts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, contract], index) => ({
      key,
      contract,
      address: `0x${(index + 1).toString(16).padStart(40, '0')}`,
      runtimeBytecodeHash: `0x${(index + 101).toString(16).padStart(64, '0')}`,
      deploymentBlock: String(8_000_000 + index)
    }));
  const byKey = new Map(components.map((item) => [item.key, item]));
  return {
    schemaVersion: 1,
    status: 'attested-testnet-candidate-not-app-active',
    network: 'cotiTestnet',
    chainId: '7082400',
    owner: '0x1111111111111111111111111111111111111111',
    attestationBlock: { number: '9000000', hash: `0x${'ab'.repeat(32)}` },
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

const manifestText = (mutate?: (candidate: ReturnType<typeof body>) => void): string => {
  const candidate = body();
  mutate?.(candidate);
  return JSON.stringify({
    ...candidate,
    manifestHash: keccak256(toHex(JSON.stringify(canonicalize(candidate))))
  });
};

const BOOK_ABI = parseAbi([
  'function contractVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)',
  'function hiddenIntentModule() view returns (address)',
  'function hiddenIntentModuleRuntimeHash() view returns (bytes32)',
  'function positionToken() view returns (address)',
  'function pairKey(address baseToken,address quoteToken) pure returns (bytes32)',
  'function positionCountByPair(bytes32 key) view returns (uint256)',
  'function getPositionIdsByPair(bytes32 key,uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'function getPositionView(uint256 positionId) view returns (((uint8 status,address baseToken,address quoteToken,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint64 createdAt,uint64 revision,bytes32 baseTokenCodeHash,bytes32 quoteTokenCodeHash,address privacyOwner,bool buySideAvailable,bool sellSideAvailable) position,uint256 positionId,address positionOwner,bytes32 pairKey) view_)',
  'function lastActivityBlock(uint256 positionId) view returns (uint256)',
  'function openHiddenIntentCountByPair(bytes32 pairKey) view returns (uint256)',
  'function hiddenIntentCursorByPair(bytes32 pairKey) view returns (uint256)'
]);

const liveFixture = () => {
  const codes = new Map<string, Hex>();
  const candidate = body();
  candidate.attestationBlock = { number: '100', hash: keccak256(toHex('block:100')) };
  candidate.components.forEach((component, index) => {
    const code = `0x60${(index + 1).toString(16).padStart(2, '0')}` as Hex;
    component.runtimeBytecodeHash = keccak256(code);
    component.deploymentBlock = '90';
    codes.set(component.address.toLowerCase(), code);
  });
  return {
    codes,
    text: JSON.stringify({
      ...candidate,
      manifestHash: keccak256(toHex(JSON.stringify(canonicalize(candidate))))
    })
  };
};

class CompletePairRpc implements ContractReader {
  readonly #manifest: ReturnType<typeof parsePrivateLiquidityV2ApiManifest>;
  readonly #codes: Map<string, Hex>;
  readonly #baseToken: `0x${string}`;
  readonly #quoteToken: `0x${string}`;
  readonly #pairKey: Hex;
  readonly #owner = '0x1111111111111111111111111111111111111111' as const;
  readonly #options: Readonly<{
    positionCount?: bigint;
    positionPage?: readonly bigint[];
    nextOffset?: bigint;
    runtimeMismatchAtSafeHead?: boolean;
    reorgSafeHeadAtFinalFence?: boolean;
    appWalletExecutor?: boolean;
    versionMismatch?: boolean;
    rpcOutage?: boolean;
  }>;
  #safeHeadReads = 0;

  constructor(
    fixture: ReturnType<typeof liveFixture>,
    options: CompletePairRpc['#options'] = {}
  ) {
    this.#manifest = parsePrivateLiquidityV2ApiManifest(fixture.text);
    this.#codes = fixture.codes;
    [this.#baseToken, this.#quoteToken] = [
      this.#manifest.components.privateTestTokenA.address,
      this.#manifest.components.privateTestTokenB.address
    ].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase())) as [
      `0x${string}`, `0x${string}`
    ];
    this.#pairKey = keccak256(encodeAbiParameters(
      parseAbiParameters('address baseToken,address quoteToken'),
      [this.#baseToken, this.#quoteToken]
    ));
    this.#options = options;
  }

  async readContract(): Promise<unknown> {
    throw new Error('Pinned source must not use latest-block readContract.');
  }

  async request<T>(method: string, params: readonly unknown[]): Promise<T> {
    if (method === 'eth_chainId') return '0x6c11a0' as T;
    if (this.#options.rpcOutage === true && method === 'eth_blockNumber') {
      throw new Error('sensitive RPC host detail');
    }
    if (method === 'eth_blockNumber') return '0x6e' as T;
    if (method === 'eth_getBlockByNumber') {
      const number = BigInt(String(params[0]));
      if (number === 108n) {
        this.#safeHeadReads += 1;
      }
      const reorged = number === 108n &&
        this.#options.reorgSafeHeadAtFinalFence === true &&
        this.#safeHeadReads > 1;
      return {
        number: toHex(number),
        hash: keccak256(toHex(reorged ? `reorged-block:${number}` : `block:${number}`)),
        timestamp: toHex(1_800_000_000n + number)
      } as T;
    }
    if (method === 'eth_getCode') {
      const reference = params[1] as { blockHash?: Hex } | undefined;
      if (
        this.#options.runtimeMismatchAtSafeHead === true &&
        reference?.blockHash === keccak256(toHex('block:108'))
      ) return '0x6000' as T;
      return (this.#codes.get(String(params[0]).toLowerCase()) ?? '0x') as T;
    }
    if (method === 'eth_call') {
      const decoded = decodeFunctionData({
        abi: BOOK_ABI,
        data: (params[0] as { data: Hex }).data
      });
      switch (decoded.functionName) {
        case 'contractVersion': return encodeFunctionResult({
          abi: BOOK_ABI, functionName: decoded.functionName,
          result: this.#options.versionMismatch === true
            ? 'ChainWhisperPrivateLiquidityBookV3'
            : 'ChainWhisperPrivateLiquidityBookV2'
        }) as T;
        case 'supportsFeature': return encodeFunctionResult({
          abi: BOOK_ABI, functionName: decoded.functionName,
          result: decoded.args[0] === keccak256(toHex('APP_WALLET_EXECUTOR'))
            ? this.#options.appWalletExecutor === true
            : true
        }) as T;
        case 'hiddenIntentModule': return encodeFunctionResult({
          abi: BOOK_ABI, functionName: decoded.functionName,
          result: this.#manifest.components.privateLiquidityHiddenIntentV2.address
        }) as T;
        case 'hiddenIntentModuleRuntimeHash': return encodeFunctionResult({
          abi: BOOK_ABI, functionName: decoded.functionName,
          result: this.#manifest.components.privateLiquidityHiddenIntentV2.runtimeBytecodeHash
        }) as T;
        case 'positionToken': return encodeFunctionResult({
          abi: BOOK_ABI, functionName: decoded.functionName,
          result: this.#manifest.components.privateLiquidityPositionNftV2.address
        }) as T;
        case 'pairKey': return encodeFunctionResult({
          abi: BOOK_ABI, functionName: decoded.functionName, result: this.#pairKey
        }) as T;
        case 'positionCountByPair': return encodeFunctionResult({
          abi: BOOK_ABI, functionName: decoded.functionName,
          result: this.#options.positionCount ?? 2n
        }) as T;
        case 'getPositionIdsByPair': return encodeFunctionResult({
          abi: BOOK_ABI, functionName: decoded.functionName,
          result: [this.#options.positionPage ?? [2n, 1n], this.#options.nextOffset ?? 0n]
        }) as T;
        case 'lastActivityBlock': return encodeFunctionResult({
          abi: BOOK_ABI, functionName: decoded.functionName, result: 105n + decoded.args[0]
        }) as T;
        case 'openHiddenIntentCountByPair': return encodeFunctionResult({
          abi: BOOK_ABI, functionName: decoded.functionName, result: 2n
        }) as T;
        case 'hiddenIntentCursorByPair': return encodeFunctionResult({
          abi: BOOK_ABI, functionName: decoded.functionName, result: 1n
        }) as T;
        case 'getPositionView': {
          const id = decoded.args[0];
          const second = id === 2n;
          return encodeFunctionResult({
            abi: BOOK_ABI,
            functionName: decoded.functionName,
            result: [{
              status: 1,
              baseToken: this.#baseToken,
              quoteToken: this.#quoteToken,
              buyTerms: { baseAmount: 1n, quoteAmount: second ? 11n : 10n },
              sellTerms: { baseAmount: 1n, quoteAmount: second ? 9n : 12n },
              createdAt: 1_800_000_000n + id,
              revision: second ? 5n : 3n,
              baseTokenCodeHash: keccak256('0x01'),
              quoteTokenCodeHash: keccak256('0x02'),
              privacyOwner: this.#owner,
              buySideAvailable: true,
              sellSideAvailable: true
            }, id, this.#owner, this.#pairKey]
          }) as T;
        }
      }
    }
    throw new Error(`unexpected RPC ${method}`);
  }
}

describe('Private Liquidity V2 API manifest source', () => {
  it('accepts the exact all-admissions unified manifest', () => {
    const manifest = parsePrivateLiquidityV2ApiManifest(manifestText());
    expect(manifest.components.privateLiquidityBookV2.contract).toBe(
      'ChainWhisperPrivateLiquidityBookV2'
    );
    expect(manifest.components.privateTestTokenA.address).not.toBe(
      manifest.components.privateTestTokenB.address
    );
  });

  it('rejects stale hashes, spoofed contracts, and incomplete admission relationships', () => {
    const stale = JSON.parse(manifestText()) as ReturnType<typeof body> & { manifestHash: string };
    stale.owner = '0x2222222222222222222222222222222222222222';
    expect(() => parsePrivateLiquidityV2ApiManifest(JSON.stringify(stale))).toThrow(
      'invalid candidate manifest hash'
    );
    expect(() => parsePrivateLiquidityV2ApiManifest(manifestText((candidate) => {
      candidate.components[0]!.contract = 'Spoofed';
    }))).toThrow('candidate component spoof');
    expect(() => parsePrivateLiquidityV2ApiManifest(manifestText((candidate) => {
      candidate.relationships.tokenAdmissionOperations = 15;
    }))).toThrow('invalid candidate manifest identity');
  });

  it('fails closed before any contract read when the RPC is not COTI testnet', async () => {
    const rpc: ContractReader = {
      request: async <T>() => '0x1' as T,
      readContract: async () => { throw new Error('unexpected'); }
    };
    const source = new ManifestPrivateLiquidityV2ApiSource({
      manifestJson: manifestText(),
      rpc
    });
    await expect(source.getPair()).rejects.toThrow('wrong chain');
  });

  it('returns a complete canonical amount-free pair from the live source adapter', async () => {
    const fixture = liveFixture();
    const source = new ManifestPrivateLiquidityV2ApiSource({
      manifestJson: fixture.text,
      rpc: new CompletePairRpc(fixture)
    });

    const pair = await source.getPair();
    expect(pair.positions.map(({ positionId }) => positionId)).toEqual(['2', '1']);
    expect(pair.askRoute).toEqual({ positionIds: ['2', '1'], expectedRevisions: ['5', '3'] });
    expect(pair.bidRoute).toEqual({ positionIds: ['2', '1'], expectedRevisions: ['5', '3'] });
    expect(pair.hiddenIntentQueue).toEqual({ openCount: '2', cursor: '1' });
    expect(JSON.stringify(pair)).not.toMatch(
      /baseInventory|quoteInventory|remainingBudget|minimumFill|intentId|packedTerms/iu
    );
  });

  it('refuses an incomplete position listing instead of returning a partial route or quote', async () => {
    const fixture = liveFixture();
    const source = new ManifestPrivateLiquidityV2ApiSource({
      manifestJson: fixture.text,
      rpc: new CompletePairRpc(fixture, {
        positionCount: 3n,
        positionPage: [2n, 1n],
        nextOffset: 0n
      })
    });

    await expect(source.getPair()).rejects.toThrow('incomplete position pages');
  });

  it('refuses a safe-head runtime that no longer matches the frozen candidate', async () => {
    const fixture = liveFixture();
    const source = new ManifestPrivateLiquidityV2ApiSource({
      manifestJson: fixture.text,
      rpc: new CompletePairRpc(fixture, { runtimeMismatchAtSafeHead: true })
    });

    await expect(source.getPair()).rejects.toThrow('runtime mismatch');
  });

  it('refuses a deep reorg detected by the final canonical block fence', async () => {
    const fixture = liveFixture();
    const source = new ManifestPrivateLiquidityV2ApiSource({
      manifestJson: fixture.text,
      rpc: new CompletePairRpc(fixture, { reorgSafeHeadAtFinalFence: true })
    });

    await expect(source.getPair()).rejects.toThrow('canonical pair changed during read');
  });

  it('refuses a deployment that exposes app-wallet execution authority', async () => {
    const fixture = liveFixture();
    const source = new ManifestPrivateLiquidityV2ApiSource({
      manifestJson: fixture.text,
      rpc: new CompletePairRpc(fixture, { appWalletExecutor: true })
    });

    await expect(source.getPair()).rejects.toThrow('incompatible private liquidity deployment');
  });

  it('refuses a live contract-version mismatch even when runtime provenance still matches', async () => {
    const fixture = liveFixture();
    const source = new ManifestPrivateLiquidityV2ApiSource({
      manifestJson: fixture.text,
      rpc: new CompletePairRpc(fixture, { versionMismatch: true })
    });

    await expect(source.getPair()).rejects.toThrow('incompatible private liquidity deployment');
  });

  it('fails closed when the RPC becomes unavailable during the canonical pair read', async () => {
    const fixture = liveFixture();
    const source = new ManifestPrivateLiquidityV2ApiSource({
      manifestJson: fixture.text,
      rpc: new CompletePairRpc(fixture, { rpcOutage: true })
    });

    await expect(source.getPair()).rejects.toThrow('sensitive RPC host detail');
  });
});
