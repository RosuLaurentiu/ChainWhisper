import { isFixedCurrentDexCandidate } from './selectedCurrentDexCandidate';
import {
  Interface,
  getAddress,
  keccak256,
  type Eip1193Provider
} from '@coti-io/coti-ethers';
import { resolveCurrentCheapDexCandidate,
  currentCheapDexCandidateKey, currentCheapDexStages, currentCheapDexQuoteProtocol,
  type CurrentCheapDexIdentity, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { decodeCurrentDexOperation, encodeCurrentDexOperationRead, decodeCurrentDexReceipt, encodeCurrentDexReceiptRead, decodeCurrentDexQuoteIssue,
  decodeCurrentCheapDexOperation, encodeCurrentCheapDexOperationRead, type CurrentCheapDexProfile } from './currentDexOperation';
import { resolvePreparedDexScope } from './currentDexPreparedScope';

const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;

const SHARED_CORE = new Interface([
  'function releaseId() view returns (bytes32)',
  'function marketId() view returns (bytes32)',
  'function feePpm() view returns (uint32)',
  'function maxWorkLifetime() view returns (uint32)',
  'function tokenAdmissionCommitment() view returns (bytes32)',
  'function inputToken() view returns (address)',
  'function outputToken() view returns (address)',
  'function inputRuntimeHash() view returns (bytes32)',
  'function outputRuntimeHash() view returns (bytes32)',
  'function fixedEngine() view returns (address)',
  'function fixedEngineRuntimeHash() view returns (bytes32)',
  'function terminalEvaluator() view returns (address)',
  'function terminalEvaluatorRuntimeHash() view returns (bytes32)',
  'function terminalEvaluatorBindingCommitment() view returns (bytes32)',
  'function positionNFT() view returns (address)',
  'function positionNFTRuntimeHash() view returns (bytes32)',
  'function fastPoolQuote() view returns (address)',
  'function poolTerms() view returns (address)'
]);
const SHARED_ENGINE = new Interface([
  'function core() view returns (address)',
  'function releaseId() view returns (bytes32)',
  'function marketId() view returns (bytes32)',
  'function positionNFT() view returns (address)',
  'function inputToken() view returns (address)',
  'function outputToken() view returns (address)',
  'function feePpm() view returns (uint32)',
  'function maxWorkLifetime() view returns (uint32)',
  'function selector() view returns (address)',
  'function selectorRuntimeHash() view returns (bytes32)'
]);
const SHARED_FACTORY = new Interface([
  'function snapshotOwner() view returns (address)',
  'function recurringOwner() view returns (address)',
  'function ownerLifecycle() view returns (address)',
  'function orderWork() view returns (address)',
  'function workLifecycle() view returns (address)',
  'function rangeOwner() view returns (address)',
  'function rangeWork() view returns (address)',
  'function matchWork() view returns (address)'
]);
const SHARED_NFT = new Interface(['function core() view returns (address)']);
const SHARED_EVALUATOR = new Interface(['function bindingCommitment() view returns (bytes32)']);
// Exact public ABI of graph 85767f8a; checked against the frozen build in the
// prepared registry tests. This interface grants no write or signing authority.
const PREPARED_MARKET_REGISTRY = new Interface([
  'function marketForTokens(address input,address output) view returns(bytes32 selectedMarket,uint256 canonicalId,uint256 registryRevision,uint256 marketRevision,bool enabled,address engine,address terms)'
]);
const PREPARED_POOL_TERMS = new Interface([
  'function core() view returns(address)', 'function releaseId() view returns(bytes32)',
  'function marketId() view returns(bytes32)', 'function token0() view returns(address)',
  'function token1() view returns(address)', 'function sharedMath() view returns(address)'
]);

type ReadProvider = Pick<Eip1193Provider, 'request'>;
type Binding = Readonly<{
  request: ReadProvider['request'];
  chainId: bigint;
  assertCurrent: () => void | Promise<void>;
  /** Public contract qualification is shared by every capability with this scope (CW-140.03). */
  qualificationScope: object;
}>;

declare const DEX_V2_READ_CAPABILITY_BRAND: unique symbol;
export type DexV2ReadCapability = Readonly<{
  readonly [DEX_V2_READ_CAPABILITY_BRAND]: true;
}>;

const CAPABILITIES = new WeakMap<object, Binding>();
// Keyed by the read provider of one page session. A reuse still checks the qualification block hash on the new capability.
const SHARED_QUALIFICATIONS = new WeakMap<object, Readonly<{ identity: string; number: bigint; hash: string;
  registryImmutableProof?: true; lastBlock?: Readonly<{ number: bigint; hash: string; timestamp: bigint }> }>>();

const quantity = (value: unknown, label: string, maximum = UINT256_MAX): bigint => {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new Error(`${label} must be a canonical JSON-RPC quantity.`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed;
};

const bytes = (value: unknown, label: string, allowEmpty = false): string => {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`${label} must be canonical bytes.`);
  }
  if (!allowEmpty && value === '0x') throw new Error(`${label} cannot be empty.`);
  return value.toLowerCase();
};

const address = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  let normalized: string;
  try {
    normalized = getAddress(value).toLowerCase();
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (normalized === ZERO_ADDRESS) throw new Error(`${label} cannot be zero.`);
  return normalized;
};

const hash = (value: unknown, label: string): string => {
  const normalized = bytes(value, label);
  if (normalized.length !== 66 || normalized === `0x${'00'.repeat(32)}`) {
    throw new Error(`${label} must be non-zero bytes32.`);
  }
  return normalized;
};

const hexQuantity = (value: bigint): string => `0x${value.toString(16)}`;
const blockSelector = (blockHash: string) => Object.freeze({ blockHash, requireCanonical: true });

const bindingFor = (capability: DexV2ReadCapability): Binding => {
  const binding = capability && CAPABILITIES.get(capability);
  if (!binding) throw new Error('DEX V2 reads require a current wallet-scoped capability.');
  return binding;
};

const rpc = async (binding: Binding, method: string, params: readonly unknown[] = []): Promise<unknown> => {
  await binding.assertCurrent();
  return binding.request({ method, params: [...params] });
};

const assertChain = async (binding: Binding): Promise<void> => {
  const chainId = quantity(await rpc(binding, 'eth_chainId'), 'DEX V2 chain ID');
  if (chainId !== binding.chainId) throw new Error('DEX V2 provider changed networks.');
};

const readBlock = async (binding: Binding, number: bigint, label: string): Promise<Readonly<{ number: bigint; hash: string }>> => {
  const value = await rpc(binding, 'eth_getBlockByNumber', [hexQuantity(number), false]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is unavailable.`);
  const record = value as Record<string, unknown>;
  const returnedNumber = quantity(record.number, `${label} number`, UINT64_MAX);
  if (returnedNumber !== number) throw new Error(`${label} number drifted.`);
  return Object.freeze({ number, hash: hash(record.hash, `${label} hash`) });
};

const ethCall = async (
  binding: Binding,
  contractAddress: string,
  abi: Interface,
  functionName: string,
  args: readonly unknown[],
  blockHash: string
): Promise<readonly unknown[]> => {
  const data = abi.encodeFunctionData(functionName, [...args]);
  const raw = bytes(await rpc(binding, 'eth_call', [
    { to: contractAddress, data },
    blockSelector(blockHash)
  ]), `${functionName} result`);
  return abi.decodeFunctionResult(functionName, raw) as unknown as readonly unknown[];
};

const scalar = async (
  binding: Binding,
  contractAddress: string,
  abi: Interface,
  functionName: string,
  args: readonly unknown[],
  blockHash: string
): Promise<unknown> => (await ethCall(binding, contractAddress, abi, functionName, args, blockHash))[0];

const requireRuntime = async (
  binding: Binding,
  contractAddress: string,
  expectedHash: string,
  blockHash: string,
  label: string
): Promise<void> => {
  const code = bytes(await rpc(binding, 'eth_getCode', [contractAddress, blockSelector(blockHash)]), `${label} runtime`);
  if (keccak256(code).toLowerCase() !== expectedHash) throw new Error(`${label} runtime hash differs from the manifest.`);
};

export const createDexV2ReadCapability = ({
  provider,
  chainId,
  assertCurrent,
  qualificationScope
}: {
  provider: ReadProvider;
  chainId: bigint;
  assertCurrent: () => void | Promise<void>;
  /** The shared read provider. Capabilities without one qualify the contracts on their own. */
  qualificationScope?: object;
}): DexV2ReadCapability => {
  if (!provider || typeof provider.request !== 'function' || typeof assertCurrent !== 'function' || chainId <= 0n) {
    throw new Error('DEX V2 read capability input is invalid.');
  }
  const capability = Object.freeze({}) as DexV2ReadCapability;
  if (qualificationScope !== undefined && (typeof qualificationScope !== 'object' || qualificationScope === null)) {
    throw new Error('DEX V2 read capability input is invalid.');
  }
  CAPABILITIES.set(capability, Object.freeze({ request: provider.request.bind(provider), chainId, assertCurrent,
    qualificationScope: qualificationScope ?? capability }));
  return capability;
};

/** Exact deployed shared-Pool trial identity. Public reads only; no submission admission. */
export const readCurrentSharedPoolDexGraph = async ({ capability, blockNumber, blockHash, candidate = 'cheap-history' }: {
  capability: DexV2ReadCapability; blockNumber: bigint; blockHash: string;
  candidate?: CurrentCheapDexCandidateKey;
}) => {
  const binding = bindingFor(capability);
  try {
    const m = resolveCurrentCheapDexCandidate(candidate);
    if (binding.chainId !== BigInt(m.chainId) || typeof blockNumber !== 'bigint' || blockNumber < 0n || blockNumber > UINT64_MAX) {
      throw new Error('Shared-Pool DEX read identity is invalid.');
    }
    const canonicalHash = hash(blockHash, 'Shared-Pool DEX block');
    const readCanonicalHead = async () => {
      const current = await rpc(binding, 'eth_getBlockByNumber', [hexQuantity(blockNumber), false]);
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        throw new Error('Shared-Pool DEX block is unavailable.');
      }
      const record = current as Record<string, unknown>;
      if (quantity(record.number, 'Shared-Pool DEX block number', UINT64_MAX) !== blockNumber ||
          hash(record.hash, 'Shared-Pool DEX block hash') !== canonicalHash) {
        throw new Error('Shared-Pool DEX block changed.');
      }
      return quantity(record.timestamp, 'Shared-Pool DEX block timestamp');
    };
    const readAnchor = async () => {
      await assertChain(binding);
      if ((await readBlock(binding, 0n, 'Shared-Pool DEX genesis')).hash !== m.genesisHash) throw new Error('Shared-Pool DEX genesis differs.');
      if ('attestationBlock' in m && (blockNumber < BigInt(m.attestationBlock.number) ||
          (await readBlock(binding, BigInt(m.attestationBlock.number), 'Current DEX deployment origin')).hash !== m.attestationBlock.hash)) {
        throw new Error('Current DEX deployment origin changed or is after the read block.');
      }
      return readCanonicalHead();
    };
    const identity = candidate === 'cheap-history' ? `${binding.chainId}:${JSON.stringify(m)}` : null;
    const currentGraph = candidate === 'cheap-history' && isFixedCurrentDexCandidate(m);
    let qualified = identity ? SHARED_QUALIFICATIONS.get(binding.qualificationScope) : undefined;
    if (qualified && qualified.identity !== identity) { SHARED_QUALIFICATIONS.delete(binding.qualificationScope); qualified = undefined; }
    // CW-140.03: capabilities in one scope read at different heads. A read before the qualification block
    // qualifies on its own and leaves the cache unchanged; a later read reuses it after the block-hash check below.
    if (qualified && blockNumber < qualified.number) qualified = undefined;
    const reuse = qualified?.identity === identity;
    const coreRuntime = m.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2];
    const graphAt = (timestamp: bigint) => Object.freeze({ graph: m.graph, packageSha256: m.packageSha256, chainId: binding.chainId,
      ...('attestationBlock' in m ? { attestationSha256: m.attestationSha256, deploymentOrigin: m.attestationBlock } : {}),
      genesisHash: m.genesisHash, core: m.core, inputToken: m.tokens[0][0], outputToken: m.tokens[1][0], maxWorkLifetime: BigInt(m.maxWorkLifetime),
      block: Object.freeze({ number: blockNumber, hash: canonicalHash, timestamp }),
      operationReadIdentity: Object.freeze({ chainId: binding.chainId, core: m.core, runtimeHash: coreRuntime,
        releaseId: m.releaseId, blockNumber, blockHash: canonicalHash }),
      runtimeCount: m.runtimes.length + m.tokens.length + ('companions' in m ? m.companions.length : 3), readyToSign: false as const });
    const checkPrimaryMarket = async () => {
      if (!currentGraph) return;
      const primary = resolvePreparedDexScope('cheap-history').candidate.pairs.find(p => p.marketId === m.marketId);
      if (!primary) throw new Error('Current DEX primary market is unavailable.');
      const raw = bytes(await rpc(binding, 'eth_call', [{ to: m.core, data: PREPARED_MARKET_REGISTRY.encodeFunctionData('marketForTokens', primary.tokens) }, blockSelector(canonicalHash)]), 'Current DEX market admission');
      const row = PREPARED_MARKET_REGISTRY.decodeFunctionResult('marketForTokens', raw);
      if (PREPARED_MARKET_REGISTRY.encodeFunctionResult('marketForTokens', row).toLowerCase() !== raw ||
          row[0] !== primary.marketId || row[1] !== BigInt(primary.canonicalId) || row[2] === 0n || row[3] === 0n || row[4] !== true ||
          address(row[5], 'Current DEX Engine') !== primary.engine || address(row[6], 'Current DEX PoolTerms') !== primary.poolTerms) throw new Error('Current DEX primary market admission changed.');
    };
    const rememberBlock = (timestamp: bigint) => {
      if (!identity) return;
      const current = SHARED_QUALIFICATIONS.get(binding.qualificationScope);
      if (current !== qualified) {
        if (!current || current.identity !== identity || current.lastBlock?.number === blockNumber && current.lastBlock.hash !== canonicalHash) {
          throw new Error('Current DEX qualification changed during read.');
        }
        return; // Another checked observation owns the cache; an older completion cannot replace it.
      }
      SHARED_QUALIFICATIONS.set(binding.qualificationScope, Object.freeze({ identity, number: qualified?.number ?? blockNumber, hash: qualified?.hash ?? canonicalHash,
        ...(qualified?.registryImmutableProof ? { registryImmutableProof: true as const } : {}),
        ...(currentGraph ? { lastBlock: qualified?.lastBlock && qualified.lastBlock.number > blockNumber ? qualified.lastBlock :
          Object.freeze({ number: blockNumber, hash: canonicalHash, timestamp }) } : {}) }));
    };
    if (currentGraph && reuse && qualified?.lastBlock?.number === blockNumber) {
      if (qualified.lastBlock.hash !== canonicalHash) throw new Error('Current DEX observed block changed.');
      await assertChain(binding);
      const timestamp = await readCanonicalHead();
      if (timestamp !== qualified.lastBlock.timestamp) throw new Error('Current DEX observed timestamp changed.');
      await binding.assertCurrent();
      return graphAt(timestamp);
    }
    await readAnchor();
    if (reuse && qualified) {
      if (qualified.number > blockNumber || (qualified.number !== blockNumber &&
        (await readBlock(binding, qualified.number, 'DEX qualification block')).hash !== qualified.hash)) {
        throw new Error('DEX qualification block changed.');
      }
      if (qualified.number === blockNumber && qualified.hash !== canonicalHash) throw new Error('DEX qualification block changed.');
    }
    if (currentGraph && reuse && qualified) {
      // Exact reviewed constructor/one-time fields stay fixed; current code and primary admission remain fresh.
      for (const [at, runtimeHash] of [[m.core, coreRuntime], ...m.tokens]) await requireRuntime(binding, at, runtimeHash, canonicalHash, 'Current DEX admitted runtime');
      await checkPrimaryMarket();
      const timestamp = await readAnchor();
      await binding.assertCurrent();
      rememberBlock(timestamp);
      return graphAt(timestamp);
    }
    // The exact current graph has fixed code and constructor bindings; Core state is still read below.
    if (!reuse) {
      for (const [role, at, runtimeHash] of m.runtimes) {
        await requireRuntime(binding, at, runtimeHash, canonicalHash, `Shared-Pool DEX ${role}`);
      }
      for (const [at, runtimeHash] of m.tokens) {
        await requireRuntime(binding, at, runtimeHash, canonicalHash, 'Shared-Pool DEX token');
      }
      if ('companions' in m) {
        for (const [role, at, runtimeHash] of m.companions) {
          await requireRuntime(binding, at, runtimeHash, canonicalHash, `Current DEX ${role}`);
        }
      }
    }
    const core = m.core;
    const equal = async (at: string, abi: Interface, getter: string, expected: string | number) => {
      const actual = await scalar(binding, at, abi, getter, [], canonicalHash);
      const value = typeof expected === 'number' ? Number(actual) :
        expected.length === 42 ? address(actual, getter) : hash(actual, getter);
      if (value !== expected) throw new Error(`Shared-Pool DEX ${getter} differs from the reviewed candidate.`);
    };
    for (const [getter, expected] of [
      ['releaseId', m.releaseId], ['marketId', m.marketId], ['feePpm', m.feePpm],
      ['maxWorkLifetime', m.maxWorkLifetime], ['tokenAdmissionCommitment', m.reviewedTokenSet],
      ['inputToken', m.tokens[0][0]], ['outputToken', m.tokens[1][0]],
      ['inputRuntimeHash', m.tokens[0][1]], ['outputRuntimeHash', m.tokens[1][1]]
    ] as const) await equal(core, SHARED_CORE, getter, expected);
    const companion = async (getter: string, runtimeGetter: string, role: string) => {
      const at = address(await scalar(binding, core, SHARED_CORE, getter, [], canonicalHash), getter);
      const runtimeHash = hash(await scalar(binding, core, SHARED_CORE, runtimeGetter, [], canonicalHash), runtimeGetter);
      if ('companions' in m) {
        const pinned = m.companions.find(([name]) => name === role);
        if (!pinned || at !== pinned[1] || runtimeHash !== pinned[2]) throw new Error(`Current DEX ${getter} companion differs from the attestation.`);
      } else await requireRuntime(binding, at, runtimeHash, canonicalHash, `Shared-Pool DEX ${getter}`);
      return at;
    };
    const engine = await companion('fixedEngine', 'fixedEngineRuntimeHash', 'ChainWhisperFixedEngine');
    const evaluator = await companion('terminalEvaluator', 'terminalEvaluatorRuntimeHash', 'ChainWhisperDexWideTerminalGT');
    const nft = await companion('positionNFT', 'positionNFTRuntimeHash', 'ChainWhisperDexPositionNFT');
    if (!reuse) await equal(nft, SHARED_NFT, 'core', core);
    const evaluatorBinding = hash(await scalar(binding, core, SHARED_CORE, 'terminalEvaluatorBindingCommitment', [], canonicalHash), 'terminalEvaluatorBindingCommitment');
    if ('evaluatorBinding' in m && evaluatorBinding !== m.evaluatorBinding) throw new Error('Current DEX terminal binding differs from the frozen constructor.');
    if (!reuse) await equal(evaluator, SHARED_EVALUATOR, 'bindingCommitment', evaluatorBinding);
    const selector = m.runtimes.find(([role]) => role === 'ChainWhisperFixedBoundedSelector')!;
    if (!reuse) for (const [getter, expected] of [
      ['core', core], ['releaseId', m.releaseId], ['marketId', m.marketId],
      ['positionNFT', nft], ['inputToken', m.tokens[0][0]], ['outputToken', m.tokens[1][0]],
      ['feePpm', m.feePpm], ['maxWorkLifetime', m.maxWorkLifetime],
      ['selector', selector[1]], ['selectorRuntimeHash', selector[2]]
    ] as const) await equal(engine, SHARED_ENGINE, getter, expected);
    const factory = m.runtimes.find(([role]) => role === 'ChainWhisperFixedEngineFactory')![1];
    if (!reuse) for (const [getter, role] of [
      ['snapshotOwner', 'ChainWhisperFixedOwner'],
      ['recurringOwner', 'ChainWhisperRecurringOwnerControls'],
      ['ownerLifecycle', 'ChainWhisperOrderOwnerLifecycle'],
      ['orderWork', 'ChainWhisperOrderWork'],
      ['workLifecycle', 'ChainWhisperFixedWorkLifecycle'],
      ['rangeOwner', 'ChainWhisperRangeOwner'],
      ['rangeWork', 'ChainWhisperRangeWork']
    ] as const) await equal(factory, SHARED_FACTORY, getter, m.runtimes.find(([name]) => name === role)![1]);
    if ('companions' in m) {
      const fastQuote = m.companions.find(([role]) => role === 'ChainWhisperDexFastPoolQuote')![1];
      await equal(core, SHARED_CORE, 'fastPoolQuote', fastQuote);
      if (!reuse) await equal(fastQuote, SHARED_NFT, 'core', core);
      await equal(core, SHARED_CORE, 'poolTerms', m.poolTerms);
      if (!reuse) await equal(factory, SHARED_FACTORY, 'matchWork', m.runtimes.find(([role]) => role === 'ChainWhisperFixedMatchWork')![1]);
      if (!reuse) for (const [slot, expectedWord] of m.factoryStorage) {
        const word = bytes(await rpc(binding, 'eth_getStorageAt', [factory, hexQuantity(BigInt(slot)), blockSelector(canonicalHash)]), 'Current DEX Factory storage');
        if (word !== expectedWord) throw new Error(`Current DEX Factory slot ${slot} differs from the frozen constructor.`);
      }
    }
    await checkPrimaryMarket();
    const timestamp = await readAnchor();
    await binding.assertCurrent();
    if (!reuse) rememberBlock(timestamp);
    return graphAt(timestamp);
  } catch (error) {
    SHARED_QUALIFICATIONS.delete(binding.qualificationScope);
    throw error;
  }
};

export type PreparedDexMarket = Readonly<{
  marketId: string; canonicalId: bigint; registryRevision: bigint; marketRevision: bigint;
  enabled: true; token0: string; token1: string; engine: string; poolTerms: string;
  companions: readonly Readonly<{ role: string; address: string; runtimeHash: string }>[];
}>;

/** All six accepted prepared markets at one canonical block. Public reads only. */
export const readPreparedDexMarketRegistry = async ({ capability, blockNumber, blockHash, candidate = 'cheap-history' }: {
  capability: DexV2ReadCapability; blockNumber: bigint; blockHash: string; candidate?: CurrentCheapDexCandidateKey;
}) => {
  const binding = bindingFor(capability), scope = resolvePreparedDexScope(candidate), m = scope.candidate;
  const graph = await readCurrentSharedPoolDexGraph({ capability, blockNumber, blockHash, candidate: scope.key });
  const identity = scope.key === 'cheap-history' && isFixedCurrentDexCandidate(m) ? `${binding.chainId}:${JSON.stringify(m)}` : null;
  const qualified = SHARED_QUALIFICATIONS.get(binding.qualificationScope);
  const reuseImmutable = identity !== null && qualified?.identity === identity && qualified.registryImmutableProof === true;
  try {
  const canonicalHash = graph.block.hash;
  const call = async (at: string, abi: Interface, method: string, args: readonly unknown[] = []) => {
    const raw = bytes(await rpc(binding, 'eth_call', [{ to: at, data: abi.encodeFunctionData(method, [...args]) },
      blockSelector(canonicalHash)]), `Prepared market ${method}`);
    const values = abi.decodeFunctionResult(method, raw);
    if (abi.encodeFunctionResult(method, values).toLowerCase() !== raw) throw new Error('Prepared market ABI result is non-canonical.');
    return values;
  };
  const decodedUint = (value: unknown): bigint => {
    if (typeof value !== 'bigint' || value < 0n || value > UINT256_MAX) throw new Error('Prepared market revision is invalid.');
    return value;
  };
  const markets: PreparedDexMarket[] = [];
  for (const expected of m.pairs) {
    const [token0, token1] = expected.tokens;
    const forward = await call(m.core, PREPARED_MARKET_REGISTRY, 'marketForTokens', [token0, token1]);
    const reverse = await call(m.core, PREPARED_MARKET_REGISTRY, 'marketForTokens', [token1, token0]);
    if (PREPARED_MARKET_REGISTRY.encodeFunctionResult('marketForTokens', forward) !==
        PREPARED_MARKET_REGISTRY.encodeFunctionResult('marketForTokens', reverse)) throw new Error('Prepared market directions differ.');
    if (hash(forward[0], 'Prepared market ID') !== expected.marketId || forward[1] !== BigInt(expected.canonicalId) ||
        forward[4] !== true || address(forward[5], 'Prepared market Engine') !== expected.engine ||
        address(forward[6], 'Prepared market PoolTerms') !== expected.poolTerms) throw new Error('Prepared market registry identity changed or is unavailable.');
    const registryRevision = decodedUint(forward[2]), marketRevision = decodedUint(forward[3]);
    if (markets.length && markets[0].registryRevision !== registryRevision) throw new Error('Prepared registry revisions differ.');
    const companions = [];
    for (const [role, at, runtimeHash] of expected.companions) {
      await requireRuntime(binding, at, runtimeHash, canonicalHash, `Prepared market ${role}`);
      companions.push(Object.freeze({ role, address: at, runtimeHash }));
    }
    // These getters are compiler-proven immutables; their current runtime hashes remain checked above.
    if (!reuseImmutable) {
    for (const [at, abi] of [[expected.engine, SHARED_ENGINE], [expected.poolTerms, PREPARED_POOL_TERMS]] as const) {
      for (const [method, value] of [['core', m.core], ['releaseId', m.releaseId], ['marketId', expected.marketId]] as const) {
        const actual = (await call(at, abi, method))[0];
        if ((method === 'core' ? address(actual, method) : hash(actual, method)) !== value) throw new Error(`Prepared market ${method} binding changed.`);
      }
    }
    const math = expected.companions.find(([role]) => role === 'ChainWhisperSharedPoolMath')![1];
    for (const [method, value] of [['token0', token0], ['token1', token1], ['sharedMath', math]] as const) {
      if (address((await call(expected.poolTerms, PREPARED_POOL_TERMS, method))[0], method) !== value) throw new Error(`Prepared market ${method} binding changed.`);
    }
    if (address((await call(math, SHARED_NFT, 'core'))[0], 'Prepared math Core') !== m.core) throw new Error('Prepared market math Core changed.');
    }
    markets.push(Object.freeze({ marketId: expected.marketId, canonicalId: BigInt(expected.canonicalId), registryRevision, marketRevision,
      enabled: true, token0, token1, engine: expected.engine, poolTerms: expected.poolTerms, companions: Object.freeze(companions) }));
  }
  await assertChain(binding);
  if ((await readBlock(binding, 0n, 'Prepared registry genesis')).hash !== m.genesisHash ||
      (await readBlock(binding, BigInt(m.attestationBlock.number), 'Prepared registry origin')).hash !== m.attestationBlock.hash ||
      (await readBlock(binding, blockNumber, 'Prepared registry block')).hash !== canonicalHash) throw new Error('Prepared registry anchor changed.');
  await binding.assertCurrent();
  if (!reuseImmutable && identity !== null && qualified?.identity === identity && SHARED_QUALIFICATIONS.get(binding.qualificationScope) === qualified) {
    SHARED_QUALIFICATIONS.set(binding.qualificationScope, Object.freeze({ ...qualified, registryImmutableProof: true }));
  }
  return Object.freeze({ graph: m.graph, packageSha256: m.packageSha256, chainId: graph.chainId, core: m.core, releaseId: m.releaseId,
    attestationSha256: m.attestationSha256, block: graph.block, registryRevision: markets[0].registryRevision,
    markets: Object.freeze(markets), tokens: Object.freeze(m.tokenMetadata.map((token, index) =>
      Object.freeze({ ...token, runtimeHash: m.tokens[index][1] }))), readyToSign: false as const });
  } catch (error) {
    SHARED_QUALIFICATIONS.delete(binding.qualificationScope);
    throw error;
  }
};

type CurrentDexReadArgs = {
  capability: DexV2ReadCapability;
  candidate?: CurrentCheapDexIdentity;
  expected: Readonly<{ chainId: bigint; core: string; runtimeHash: string; releaseId: string;
    blockNumber?: bigint; blockHash?: string; originBlockNumber?: bigint; originBlockHash?: string }>;
  operationId: bigint;
};
type CurrentDexSnapshot<T> = Readonly<{ candidate?: CurrentCheapDexIdentity; chainId: bigint; core: string; runtimeHash: string; releaseId: string;
  operationId: bigint; block: Readonly<{ number: bigint; hash: string; timestamp: bigint }>; operation: T }>;
type HistoricalProfile = 'legacy' | 'shared-pool';
type CurrentDexProfile = HistoricalProfile | CurrentCheapDexProfile;
const CURRENT_OPERATION_OBSERVATIONS = new WeakMap<Binding, { value?: {
  key: string; block: Readonly<{ number: bigint; hash: string; timestamp: bigint }>;
} }>();
/** Public snapshot only; not deployment admission or write authority. */
export function readCurrentDexOperation(args: CurrentDexReadArgs & { profile: CurrentCheapDexProfile }): Promise<CurrentDexSnapshot<ReturnType<typeof decodeCurrentCheapDexOperation>>>;
export function readCurrentDexOperation(args: CurrentDexReadArgs & { profile?: HistoricalProfile }): Promise<CurrentDexSnapshot<ReturnType<typeof decodeCurrentDexOperation>>>;
export async function readCurrentDexOperation({ capability, expected, operationId, candidate, profile = 'legacy' }: CurrentDexReadArgs & { profile?: CurrentDexProfile }): Promise<CurrentDexSnapshot<ReturnType<typeof decodeCurrentCheapDexOperation> | ReturnType<typeof decodeCurrentDexOperation>>> {
  if (!['legacy', 'shared-pool', 'fast-pool', 'cheap-async'].includes(profile)) throw new Error('Unknown current quote profile.');
  const cheapProfile = profile === 'fast-pool' || profile === 'cheap-async' ? profile : undefined;
  const binding = bindingFor(capability);
  try {
  const core = address(expected.core, 'Current DEX Core');
  const runtimeHash = hash(expected.runtimeHash, 'Current DEX runtime');
  const releaseId = hash(expected.releaseId, 'Current DEX release');
  const selected = candidate ? resolveCurrentCheapDexCandidate(currentCheapDexCandidateKey(candidate)) : undefined;
  if (selected && (!cheapProfile || core.toLowerCase() !== selected.core || expected.chainId !== BigInt(selected.chainId) ||
      runtimeHash !== selected.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2] || releaseId !== selected.releaseId)) {
    throw new Error('Current DEX read differs from its exact candidate.');
  }
  if ((expected.blockNumber === undefined) !== (expected.blockHash === undefined) ||
      (expected.originBlockNumber === undefined) !== (expected.originBlockHash === undefined)) {
    throw new Error('Current DEX read identity is invalid.');
  }
  let observation = isFixedCurrentDexCandidate(selected)
    ? CURRENT_OPERATION_OBSERVATIONS.get(binding) : undefined;
  if (isFixedCurrentDexCandidate(selected) && !observation) {
    observation = {}; CURRENT_OPERATION_OBSERVATIONS.set(binding, observation);
  }
  await assertChain(binding);
  const head = expected.blockNumber === undefined ? await rpc(binding, 'eth_getBlockByNumber', ['latest', false]) : null;
  if (expected.blockNumber === undefined && head === null) throw new Error('Current DEX head is unavailable.');
  if (head !== null && (typeof head !== 'object' || Array.isArray(head))) throw new Error('Current DEX head is unavailable.');
  const blockNumber = head ? quantity((head as Record<string, unknown>).number, 'Current DEX head number', UINT64_MAX) : expected.blockNumber;
  const blockHash = hash(head ? (head as Record<string, unknown>).hash : expected.blockHash, 'Current DEX block');
  if (expected.chainId !== binding.chainId || typeof blockNumber !== 'bigint' || blockNumber < 0n || blockNumber > UINT64_MAX) {
    throw new Error('Current DEX read identity is invalid.');
  }
  const originNumber = expected.originBlockNumber;
  const originHash = originNumber === undefined ? null : hash(expected.originBlockHash, 'Current DEX origin block');
  if (originNumber !== undefined && (originNumber < 0n || originNumber > UINT64_MAX || originNumber > blockNumber ||
      (await readBlock(binding, originNumber, 'Current DEX origin block')).hash !== originHash)) {
    throw new Error('Current DEX origin block changed.');
  }
  const data = cheapProfile ? encodeCurrentCheapDexOperationRead(operationId, cheapProfile) : encodeCurrentDexOperationRead(operationId);
  const release = new Interface(['function releaseId() view returns(bytes32)']);
  const block = await rpc(binding, 'eth_getBlockByNumber', [hexQuantity(blockNumber), false]);
  if (!block || typeof block !== 'object') throw new Error('Current DEX block is unavailable.');
  const record = block as Record<string, unknown>;
  if (quantity(record.number, 'Current DEX block number', UINT64_MAX) !== blockNumber || hash(record.hash, 'Current DEX block hash') !== blockHash) {
    throw new Error('Current DEX block changed.');
  }
  const timestamp = quantity(record.timestamp, 'Current DEX block timestamp');
  const observationKey = JSON.stringify([selected, core, runtimeHash, releaseId]);
  const previous = observation?.value;
  const sameObservation = previous?.key === observationKey && previous.block.number === blockNumber && previous.block.hash === blockHash;
  if (sameObservation && previous.block.timestamp !== timestamp) throw new Error('Current DEX observed timestamp changed.');
  const checkCandidateAnchors = async () => {
    if (!selected) return;
    if ((await readBlock(binding, 0n, 'Current DEX candidate genesis')).hash !== selected.genesisHash ||
        blockNumber < BigInt(selected.attestationBlock.number) ||
        (await readBlock(binding, BigInt(selected.attestationBlock.number), 'Current DEX deployment origin')).hash !== selected.attestationBlock.hash) {
      throw new Error('Current DEX candidate genesis or deployment origin changed.');
    }
  };
  // This operation snapshot binds Core and its canonical origins. The wallet performs
  // the complete same-block module graph check separately; do not duplicate that scan.
  if (!sameObservation) {
    await checkCandidateAnchors();
    await requireRuntime(binding, core, runtimeHash, blockHash, 'Current DEX Core');
    if (hash(await scalar(binding, core, release, 'releaseId', [], blockHash), 'Current DEX release') !== releaseId) {
      throw new Error('Current DEX release changed.');
    }
  }
  const raw = bytes(await rpc(binding, 'eth_call', [{ to: core, data }, blockSelector(blockHash)]), 'Current DEX operation');
  const operation = cheapProfile ? decodeCurrentCheapDexOperation(raw, timestamp, cheapProfile, selected) :
    decodeCurrentDexOperation(raw, timestamp, profile as HistoricalProfile);
  await assertChain(binding);
  if ((await readBlock(binding, blockNumber, 'Rechecked current DEX block')).hash !== blockHash) {
    throw new Error('Current DEX block changed during read.');
  }
  if (originNumber !== undefined && (await readBlock(binding, originNumber, 'Rechecked DEX origin block')).hash !== originHash) {
    throw new Error('Current DEX origin block changed during read.');
  }
  // An unchanged canonical reviewed observation hash commits the candidate ancestry checked above.
  if (!isFixedCurrentDexCandidate(selected)) await checkCandidateAnchors();
  await binding.assertCurrent();
  if (observation && CURRENT_OPERATION_OBSERVATIONS.get(binding) === observation &&
      (!observation.value || blockNumber >= observation.value.block.number)) {
    observation.value = { key: observationKey, block: Object.freeze({ number: blockNumber, hash: blockHash, timestamp }) };
  }
  return Object.freeze({ ...(selected ? { candidate: selected } : {}), chainId: binding.chainId, core, runtimeHash, releaseId, operationId,
    block: Object.freeze({ number: blockNumber, hash: blockHash, timestamp }), operation });
  } catch (error) {
    CURRENT_OPERATION_OBSERVATIONS.delete(binding);
    throw error;
  }
}

/** Recover the opening operation/context from the exact mined call and current canonical state. */
type CurrentDexIssuedArgs = {
  capability: DexV2ReadCapability;
  candidate?: CurrentCheapDexIdentity;
  runtimeHash: string;
  issue: Omit<Parameters<typeof decodeCurrentDexQuoteIssue>[0], 'profile'>;
};
type CurrentDexIssueOrigin = Readonly<{ originBlock: Readonly<{ number: bigint; hash: string }>; principal: string; transactionHash: string }>;
export function readCurrentDexIssuedQuote(args: CurrentDexIssuedArgs & { profile: CurrentCheapDexProfile }): Promise<CurrentDexSnapshot<ReturnType<typeof decodeCurrentCheapDexOperation>> & CurrentDexIssueOrigin>;
export function readCurrentDexIssuedQuote(args: CurrentDexIssuedArgs & { profile?: HistoricalProfile }): Promise<CurrentDexSnapshot<ReturnType<typeof decodeCurrentDexOperation>> & CurrentDexIssueOrigin & { epochId: bigint }>;
export async function readCurrentDexIssuedQuote({ capability, runtimeHash, issue, candidate, profile = 'legacy' }: CurrentDexIssuedArgs & { profile?: CurrentDexProfile }) {
  if (!['legacy', 'shared-pool', 'fast-pool', 'cheap-async'].includes(profile)) throw new Error('Unknown current quote profile.');
  const cheapProfile = profile === 'fast-pool' || profile === 'cheap-async' ? profile : undefined;
  if (candidate && (!cheapProfile || issue.quoteProtocol !== currentCheapDexQuoteProtocol(candidate))) {
    throw new Error('Quote issue protocol differs from its exact candidate.');
  }
  const expected = Object.freeze({ ...issue.expected });
  const issued = decodeCurrentDexQuoteIssue({ ...issue, expected, profile: cheapProfile ?? 'legacy' });
  const epochId = 'epochId' in issued ? issued.epochId : undefined;
  const issueContextHash = 'contextHash' in issued ? issued.contextHash : undefined;
  const args = { capability, candidate, operationId: issued.operationId,
    expected: { chainId: expected.chainId, core: expected.core, runtimeHash, releaseId: issued.releaseId,
      originBlockNumber: issued.block.number, originBlockHash: issued.block.hash } };
  const snapshot = cheapProfile ? await readCurrentDexOperation({ ...args, profile: cheapProfile }) :
    await readCurrentDexOperation({ ...args, profile: profile as HistoricalProfile });
  const operation = snapshot.operation;
  if (operation.phase === 'not-found' || operation.deadline !== issued.deadline ||
      ('epochId' in operation && (operation.epochId !== epochId || BigInt(operation.contextHash) === 0n)) ||
      (cheapProfile === 'fast-pool' && operation.contextHash !== issueContextHash)) {
    throw new Error('Quote issue does not match Core operation state.');
  }
  return Object.freeze({ ...snapshot, originBlock: issued.block, ...(cheapProfile ? {} : { epochId }),
    principal: address(expected.principal, 'Quote principal'),
    transactionHash: issued.transactionHash });
}

/** Ciphertext read, not caller authentication or proof of payout. Decrypt only in the selected owner session. */
type CurrentDexReceiptSnapshot<T> = CurrentDexSnapshot<T> & Readonly<{ principal: string; kind: 'quote' | 'pending' | 'terminal' | 'unverified'; encrypted: ReturnType<typeof decodeCurrentDexReceipt> }>;
export function readCurrentDexPrincipalReceipt(args: CurrentDexReadArgs & { principal: string; profile: CurrentCheapDexProfile }): Promise<CurrentDexReceiptSnapshot<ReturnType<typeof decodeCurrentCheapDexOperation>>>;
export function readCurrentDexPrincipalReceipt(args: CurrentDexReadArgs & { principal: string; profile?: HistoricalProfile }): Promise<CurrentDexReceiptSnapshot<ReturnType<typeof decodeCurrentDexOperation>>>;
export async function readCurrentDexPrincipalReceipt(args: CurrentDexReadArgs & { principal: string; profile?: CurrentDexProfile }) {
  const principal = address(args.principal, 'Current DEX principal');
  const originNumber = args.expected.originBlockNumber;
  const originHash = originNumber === undefined ? undefined : hash(args.expected.originBlockHash, 'Receipt origin hash');
  const binding = bindingFor(args.capability);
  const cheapProfile = args.profile === 'fast-pool' || args.profile === 'cheap-async' ? args.profile : undefined;
  const snapshot = cheapProfile ? await readCurrentDexOperation({ ...args, profile: cheapProfile }) :
    await readCurrentDexOperation({ ...args, profile: args.profile as HistoricalProfile | undefined });
  const operation = snapshot.operation;
  const stages = currentCheapDexStages(args.candidate);
  const available = 'status' in operation ? (operation.status === 2 && operation.quotePrepared) || operation.status === 3 || operation.status === 4 :
    operation.profile === 'fast-pool' ? operation.phase !== 'not-found' : operation.stage! >= stages.ready;
  if (!available) {
    throw new Error('Current DEX receipt is not available.');
  }
  const raw = bytes(await rpc(binding, 'eth_call', [{ from: principal, to: snapshot.core,
    data: encodeCurrentDexReceiptRead(snapshot.operationId, cheapProfile) }, blockSelector(snapshot.block.hash)]), 'Current DEX receipt');
  const encrypted = decodeCurrentDexReceipt(raw, cheapProfile);
  await assertChain(binding);
  if ((await readBlock(binding, snapshot.block.number, 'Rechecked receipt block')).hash !== snapshot.block.hash) {
    throw new Error('Current DEX receipt block changed during read.');
  }
  if (originNumber !== undefined &&
      (await readBlock(binding, originNumber, 'Rechecked receipt origin')).hash !== originHash) {
    throw new Error('Current DEX origin block changed during receipt read.');
  }
  await binding.assertCurrent();
  const kind = 'status' in operation ? operation.status === 2 ? 'quote' : 'terminal' :
    operation.profile === 'fast-pool' ? operation.ready ? 'quote' : 'unverified' :
    operation.stage === stages.ready ? 'quote' : operation.stage === stages.funded ? 'pending' : 'terminal';
  return Object.freeze({ ...snapshot, principal, kind, encrypted });
}
