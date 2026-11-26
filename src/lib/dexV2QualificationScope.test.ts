import { describe, expect, it, vi } from 'vitest';
import { Interface, keccak256, toBeHex, toUtf8Bytes } from '@coti-io/coti-ethers';

// The fake chain has no real contract code. A code word `0xfe<hash>` stands for code whose runtime hash is <hash>.
vi.mock('@coti-io/coti-ethers', async importOriginal => {
  const actual = await importOriginal<typeof import('@coti-io/coti-ethers')>();
  return { ...actual, keccak256: (value: Parameters<typeof actual.keccak256>[0]) =>
    typeof value === 'string' && /^0xfe[0-9a-f]{64}$/.test(value) ? `0x${value.slice(4)}` : actual.keccak256(value) };
});

import { createDexV2ReadCapability, readCurrentSharedPoolDexGraph } from './dexV2Chain';
import { resolveCurrentCheapDexCandidate } from './dexV2Deployment';
import { resolvePreparedDexScope } from './currentDexPreparedScope';

const m = resolveCurrentCheapDexCandidate('cheap-history') as ReturnType<typeof resolveCurrentCheapDexCandidate> & Record<string, any>;
const core = new Interface(['function releaseId() view returns (bytes32)', 'function marketId() view returns (bytes32)',
  'function feePpm() view returns (uint32)', 'function maxWorkLifetime() view returns (uint32)',
  'function tokenAdmissionCommitment() view returns (bytes32)', 'function inputToken() view returns (address)',
  'function outputToken() view returns (address)', 'function inputRuntimeHash() view returns (bytes32)',
  'function outputRuntimeHash() view returns (bytes32)', 'function fixedEngine() view returns (address)',
  'function fixedEngineRuntimeHash() view returns (bytes32)', 'function terminalEvaluator() view returns (address)',
  'function terminalEvaluatorRuntimeHash() view returns (bytes32)', 'function terminalEvaluatorBindingCommitment() view returns (bytes32)',
  'function positionNFT() view returns (address)', 'function positionNFTRuntimeHash() view returns (bytes32)',
  'function fastPoolQuote() view returns (address)', 'function poolTerms() view returns (address)',
  'function marketForTokens(address,address) view returns (bytes32,uint256,uint256,uint256,bool,address,address)']);
const engine = new Interface(['function core() view returns (address)', 'function releaseId() view returns (bytes32)',
  'function marketId() view returns (bytes32)', 'function positionNFT() view returns (address)', 'function inputToken() view returns (address)',
  'function outputToken() view returns (address)', 'function feePpm() view returns (uint32)', 'function maxWorkLifetime() view returns (uint32)',
  'function selector() view returns (address)', 'function selectorRuntimeHash() view returns (bytes32)']);
const factory = new Interface(['function snapshotOwner() view returns (address)', 'function recurringOwner() view returns (address)',
  'function ownerLifecycle() view returns (address)', 'function orderWork() view returns (address)', 'function workLifecycle() view returns (address)',
  'function rangeOwner() view returns (address)', 'function rangeWork() view returns (address)', 'function matchWork() view returns (address)']);
const coreOnly = new Interface(['function core() view returns (address)']);
const evaluator = new Interface(['function bindingCommitment() view returns (bytes32)']);

const lower = (value: string) => value.toLowerCase();
const companion = (role: string) => (m.companions as readonly (readonly [string, string, string])[]).find(([name]) => name === role)!;
const runtime = (role: string) => (m.runtimes as readonly (readonly [string, string, string])[]).find(([name]) => name === role)!;

/** Public answers that the reviewed candidate expects, keyed by contract address. */
const answers = () => {
  const [, engineAt, engineHash] = companion('ChainWhisperFixedEngine');
  const [, evaluatorAt, evaluatorHash] = companion('ChainWhisperDexWideTerminalGT');
  const [, nftAt, nftHash] = companion('ChainWhisperDexPositionNFT');
  const [, fastAt] = companion('ChainWhisperDexFastPoolQuote');
  const selector = runtime('ChainWhisperFixedBoundedSelector');
  const factoryAt = runtime('ChainWhisperFixedEngineFactory')[1];
  const primary = resolvePreparedDexScope('cheap-history').candidate.pairs.find(p => p.marketId === m.marketId)!;
  const calls = new Map<string, [Interface, Record<string, unknown[]>]>([
    [lower(m.core), [core, { releaseId: [m.releaseId], marketId: [m.marketId], feePpm: [m.feePpm], maxWorkLifetime: [m.maxWorkLifetime],
      tokenAdmissionCommitment: [m.reviewedTokenSet], inputToken: [m.tokens[0][0]], outputToken: [m.tokens[1][0]],
      inputRuntimeHash: [m.tokens[0][1]], outputRuntimeHash: [m.tokens[1][1]], fixedEngine: [engineAt], fixedEngineRuntimeHash: [engineHash],
      terminalEvaluator: [evaluatorAt], terminalEvaluatorRuntimeHash: [evaluatorHash], terminalEvaluatorBindingCommitment: [m.evaluatorBinding],
      positionNFT: [nftAt], positionNFTRuntimeHash: [nftHash], fastPoolQuote: [fastAt], poolTerms: [m.poolTerms],
      marketForTokens: [primary.marketId, BigInt(primary.canonicalId), 6n, 1n, true, primary.engine, primary.poolTerms] }]],
    [lower(engineAt), [engine, { core: [m.core], releaseId: [m.releaseId], marketId: [m.marketId], positionNFT: [nftAt],
      inputToken: [m.tokens[0][0]], outputToken: [m.tokens[1][0]], feePpm: [m.feePpm], maxWorkLifetime: [m.maxWorkLifetime],
      selector: [selector[1]], selectorRuntimeHash: [selector[2]] }]],
    [lower(factoryAt), [factory, Object.fromEntries(([['snapshotOwner', 'ChainWhisperFixedOwner'], ['recurringOwner', 'ChainWhisperRecurringOwnerControls'],
      ['ownerLifecycle', 'ChainWhisperOrderOwnerLifecycle'], ['orderWork', 'ChainWhisperOrderWork'], ['workLifecycle', 'ChainWhisperFixedWorkLifecycle'],
      ['rangeOwner', 'ChainWhisperRangeOwner'], ['rangeWork', 'ChainWhisperRangeWork'], ['matchWork', 'ChainWhisperFixedMatchWork']] as const)
      .map(([getter, role]) => [getter, [runtime(role)[1]]]))]],
    [lower(nftAt), [coreOnly, { core: [m.core] }]],
    [lower(fastAt), [coreOnly, { core: [m.core] }]],
    [lower(evaluatorAt), [evaluator, { bindingCommitment: [m.evaluatorBinding] }]]
  ]);
  const codes = new Map<string, string>([...(m.runtimes as readonly (readonly [string, string, string])[]).map(([, at, h]) => [lower(at), h] as const),
    ...(m.tokens as readonly (readonly [string, string])[]).map(([at, h]) => [lower(at), h] as const),
    ...(m.companions as readonly (readonly [string, string, string])[]).map(([, at, h]) => [lower(at), h] as const)]);
  const storage = new Map((m.factoryStorage as readonly (readonly [string, string])[]).map(([slot, word]) => [`${lower(factoryAt)}:${BigInt(slot)}`, word]));
  return { calls, codes, storage };
};

const chain = () => {
  const { calls, codes, storage } = answers();
  const base = BigInt(m.attestationBlock.number) + 10n;
  const blockHash = (n: bigint) => n === 0n ? m.genesisHash : n === BigInt(m.attestationBlock.number) ? m.attestationBlock.hash :
    keccak256(toUtf8Bytes(`scope-block-${n}`));
  const request = vi.fn(async ({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> => {
    if (method === 'eth_chainId') return '0x6c11a0';
    if (method === 'eth_getBlockByNumber') {
      const n = BigInt(String(params[0]));
      return { number: `0x${n.toString(16)}`, hash: blockHash(n), timestamp: '0x64' };
    }
    if (method === 'eth_getCode') {
      const h = codes.get(lower(String(params[0])));
      if (!h) throw new Error(`No code for ${params[0]}`);
      return `0xfe${h.slice(2).toLowerCase()}`;
    }
    if (method === 'eth_getStorageAt') {
      const word = storage.get(`${lower(String(params[0]))}:${BigInt(String(params[1]))}`);
      if (!word) throw new Error(`No storage for ${params[0]} ${params[1]}`);
      return word;
    }
    if (method === 'eth_call') {
      const { to, data } = params[0] as { to: string; data: string };
      const entry = calls.get(lower(to));
      const parsed = entry?.[0].parseTransaction({ data });
      if (!entry || !parsed || !(parsed.name in entry[1])) throw new Error(`No call ${to} ${data.slice(0, 10)}`);
      return entry[0].encodeFunctionResult(parsed.name, entry[1][parsed.name]);
    }
    throw new Error(`No method ${method}`);
  });
  const provider = { request };
  const capability = (qualificationScope?: object) => createDexV2ReadCapability({ provider, chainId: 7082400n, assertCurrent: () => undefined,
    ...(qualificationScope ? { qualificationScope } : {}) });
  const read = (capabilityValue: ReturnType<typeof capability>, at = base) =>
    readCurrentSharedPoolDexGraph({ capability: capabilityValue, candidate: 'cheap-history', blockNumber: at, blockHash: blockHash(at) });
  const count = async (run: () => Promise<unknown>) => { request.mockClear(); await run(); return request.mock.calls.length; };
  return { base, capability, read, count, request };
};

describe('contract qualification shared by one read provider (CW-140.03)', () => {
  it('qualifies once for every capability of the same read provider', async () => {
    const c = chain(), scope = {};
    const cold = await c.count(() => c.read(c.capability(scope)));
    expect(cold).toBeGreaterThan(100);
    expect(await c.count(() => c.read(c.capability(scope)))).toBe(2);
    const later = await c.count(() => c.read(c.capability(scope), c.base + 1n));
    expect(later).toBeLessThan(20);
    expect(c.request.mock.calls.filter(([r]) => r.method === 'eth_getCode')).toHaveLength(5);
    expect(await c.count(() => c.read(c.capability({})))).toBe(cold);
    expect(await c.count(() => c.read(c.capability()))).toBe(cold);
  });

  it('keeps the cache when another capability reads an older head', async () => {
    const c = chain(), scope = {};
    await c.read(c.capability(scope), c.base + 2n);
    // Before the qualification block: this read qualifies on its own and leaves the cache unchanged.
    expect(await c.count(() => c.read(c.capability(scope), c.base))).toBeGreaterThan(100);
    expect(await c.count(() => c.read(c.capability(scope), c.base + 2n))).toBe(2);
    await c.read(c.capability(scope), c.base + 4n);
    // After the qualification block but before the newest observation: reuse with fresh runtime checks.
    expect(await c.count(() => c.read(c.capability(scope), c.base + 3n))).toBeLessThan(20);
    expect(await c.count(() => c.read(c.capability(scope), c.base + 4n))).toBe(2);
  });

  it('rejects a changed qualification block on reuse by another capability', async () => {
    const c = chain(), scope = {};
    await c.read(c.capability(scope));
    const original = c.request.getMockImplementation()!;
    c.request.mockImplementation(async call => {
      const result = await original(call);
      return call.method === 'eth_getBlockByNumber' && call.params?.[0] === toBeHex(c.base)
        ? { ...(result as object), hash: keccak256(toUtf8Bytes('replaced')) } : result;
    });
    await expect(c.read(c.capability(scope), c.base + 1n)).rejects.toThrow('DEX qualification block changed.');
    c.request.mockImplementation(original);
    expect(await c.count(() => c.read(c.capability(scope), c.base + 1n))).toBeGreaterThan(100);
  });
});
