import { AbiCoder, Interface, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  assertAttestedDexV2Deployment,
  attestDexV2Deployment,
  createDexV2ReadCapability,
  readCurrentDexOperation,
  readCurrentSharedPoolDexGraph,
  readPreparedDexMarketRegistry
} from './dexV2Chain';
import { CURRENT_CHEAP_DEX_OPERATION_ABI } from './currentDexOperation';
import {
  DEX_V2_COMPONENT_KEYS,
  hashDexV2AppManifestBody,
  parseDexV2AppManifest,
  STAGED_SHARED_HISTORY_DEX_CANDIDATE,
  type DexV2AppManifest,
  type DexV2ComponentKey
} from './dexV2Deployment';

describe('current directory graph qualification', () => {
  const selected = STAGED_SHARED_HISTORY_DEX_CANDIDATE;
  const registry = new Interface(['function marketForTokens(address,address) view returns(bytes32,uint256,uint256,uint256,bool,address,address)']);
  const publicOperation = new Interface(CURRENT_CHEAP_DEX_OPERATION_ABI);
  // Public capture of the selected build 13 candidate (graph 5045070b); the gap candidate capture was removed with decision-034.
  const capture = JSON.parse(readFileSync(new URL('../../../ChainWhisper Contracts V2/validation/candidates/c1-band-sizing-2026-11-21/native-bob-dense-1/APP_PUBLIC_CAPTURE.json', import.meta.url), 'utf8')) as { graph: string; reads: { method: string; params: unknown[]; result: unknown }[] };
  it('uses the public capture of the selected candidate', () => expect(capture.graph).toBe(selected.graph));
  function currentFixture() {
    const number = BigInt(selected.attestationBlock.number) + 10n;
    const primary = selected.pairs.find(p => p.marketId === selected.marketId)!;
    const row: (string | bigint | boolean)[] = [primary.marketId, BigInt(primary.canonicalId), 6n, 1n, true, primary.engine, primary.poolTerms];
    let active = true, chain = '0x6c11a0', reorg = false, code = '', fail = false, revokeAtBlock = false;
    const blockHash = (n: bigint) => n === 0n ? selected.genesisHash : n === BigInt(selected.attestationBlock.number) ? selected.attestationBlock.hash :
      keccak256(toUtf8Bytes(`directory-block-${n}${reorg && n === number ? '-reorg' : ''}`));
    const request = vi.fn(async ({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> => {
      if (fail) throw new Error('Fixture RPC failure');
      if (method === 'eth_chainId') return chain;
      if (method === 'eth_getBlockByNumber') {
        const n = params[0] === 'latest' ? number : BigInt(String(params[0])); if (revokeAtBlock) active = false;
        return { number: `0x${n.toString(16)}`, hash: blockHash(n), timestamp: '0x64' };
      }
      if (method === 'eth_getCode' && params[0] === code) return '0x6000';
      if (method === 'eth_call' && [registry.encodeFunctionData('marketForTokens', primary.tokens),
        registry.encodeFunctionData('marketForTokens', [...primary.tokens].reverse())].includes((params[0] as { data: string }).data)) {
        return registry.encodeFunctionResult('marketForTokens', row);
      }
      if (method === 'eth_call') {
        const pair = selected.pairs.find(p => [registry.encodeFunctionData('marketForTokens', p.tokens),
          registry.encodeFunctionData('marketForTokens', [...p.tokens].reverse())].includes((params[0] as { data: string }).data));
        if (pair) return registry.encodeFunctionResult('marketForTokens',
          [pair.marketId, BigInt(pair.canonicalId), row[2], 1n, true, pair.engine, pair.poolTerms]);
      }
      if (method === 'eth_call' && (params[0] as { data: string }).data === publicOperation.encodeFunctionData('cheapAsyncPublic', [7n])) {
        return publicOperation.encodeFunctionResult('cheapAsyncPublic', [1n, `0x${'00'.repeat(32)}`, 200n]);
      }
      const key = (args: unknown[]) => method === 'eth_call' ? `${(args[0] as { to: string }).to.toLowerCase()}:${(args[0] as { data: string }).data}` : `${String(args[0]).toLowerCase()}:${method === 'eth_getStorageAt' ? args[1] : ''}`;
      const saved = capture.reads.find(r => r.method === method && key(r.params) === key(params));
      if (!saved) throw new Error(`Missing directory fixture ${method}`);
      return saved.result;
    });
    const makeCapability = () => createDexV2ReadCapability({ provider: { request }, chainId: 7082400n, assertCurrent: () => { if (!active) throw new Error('Session revoked'); } });
    const capability = makeCapability();
    return { request, row, number, capability, makeCapability,
      read: (at = number, hash = blockHash(at)) => readCurrentSharedPoolDexGraph({ capability, candidate: 'cheap-history', blockNumber: at, blockHash: hash }),
      revoke: () => { active = false; }, wrongChain: () => { chain = '0x1'; }, reorg: () => { reorg = true; },
      revokeAtBlock: () => { revokeAtBlock = true; },
      drift: (address: string) => { code = address; }, fail: () => { fail = true; }, resume: () => { fail = false; } };
  }
  it('keeps full cold checks, uses two same-block anchors and fresh later-block runtime/admission', async () => {
    const f = currentFixture(); await f.read(); expect(f.request).toHaveBeenCalledTimes(107);
    f.request.mockClear(); await f.read(); expect(f.request).toHaveBeenCalledTimes(2);
    expect(f.request.mock.calls.map(([r]) => r.method)).toEqual(['eth_chainId', 'eth_getBlockByNumber']);
    f.row[2] = 7n;
    f.request.mockClear(); await f.read(f.number + 1n); expect(f.request).toHaveBeenCalledTimes(15);
    expect(f.request.mock.calls.filter(([r]) => r.method === 'eth_getCode')).toHaveLength(5);
    expect(f.request.mock.calls.filter(([r]) => r.method === 'eth_call')).toHaveLength(1);
    // CW-140.03: a read at the qualification block reuses that qualification after its block-hash check,
    // and repeats only the fresh runtime/admission reads (no second cold read).
    f.request.mockClear(); await f.read(f.number); expect(f.request).toHaveBeenCalledTimes(14);
    expect(f.request.mock.calls.filter(([r]) => r.method === 'eth_getCode')).toHaveLength(5);
    expect(f.request.mock.calls.filter(([r]) => r.method === 'eth_call')).toHaveLength(1);
  });
  it('reuses only the six-market immutable proof while checking current companion code and registry', async () => {
    const f = currentFixture();
    const read = (at = f.number, capability = f.capability) => readPreparedDexMarketRegistry({
      capability, candidate: 'cheap-history', blockNumber: at,
      blockHash: keccak256(toUtf8Bytes(`directory-block-${at}`))
    });
    const cold = await read(); expect(cold.markets.map(m => m.canonicalId)).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);
    const counts = { cold: f.request.mock.calls.length, sameBlock: 0, nextBlock: 0 };
    f.request.mockClear(); await read(); counts.sameBlock = f.request.mock.calls.length;
    expect(f.request.mock.calls.filter(([r]) => r.method === 'eth_getCode')).toHaveLength(24);
    const marketSelector = registry.getFunction('marketForTokens')!.selector;
    expect(f.request.mock.calls.filter(([r]) => r.method === 'eth_call' &&
      (r.params?.[0] as { data: string }).data.startsWith(marketSelector))).toHaveLength(12);
    f.request.mockClear(); await read(f.number + 1n); counts.nextBlock = f.request.mock.calls.length;
    expect(f.request.mock.calls.filter(([r]) => r.method === 'eth_getCode')).toHaveLength(29);
    f.request.mockClear(); await read(f.number + 1n, f.makeCapability());
    expect(f.request).toHaveBeenCalledTimes(207);

    const changedCode = currentFixture();
    const readChanged = () => readPreparedDexMarketRegistry({ capability: changedCode.capability, candidate: 'cheap-history',
      blockNumber: changedCode.number, blockHash: keccak256(toUtf8Bytes(`directory-block-${changedCode.number}`)) });
    await readChanged(); changedCode.drift(selected.pairs[1].companions[0][1]);
    await expect(readChanged()).rejects.toThrow('runtime hash differs');
    const changedRegistry = currentFixture(), original = changedRegistry.request.getMockImplementation()!;
    const readRegistry = () => readPreparedDexMarketRegistry({ capability: changedRegistry.capability, candidate: 'cheap-history',
      blockNumber: changedRegistry.number, blockHash: keccak256(toUtf8Bytes(`directory-block-${changedRegistry.number}`)) });
    await readRegistry();
    changedRegistry.request.mockImplementation(async request => {
      const result = await original(request);
      if (request.method === 'eth_call' && (request.params?.[0] as { data: string }).data ===
          registry.encodeFunctionData('marketForTokens', selected.pairs[1].tokens)) {
        const row = Array.from(registry.decodeFunctionResult('marketForTokens', result as string)); row[5] = selected.core;
        return registry.encodeFunctionResult('marketForTokens', row);
      }
      return result;
    });
    await expect(readRegistry()).rejects.toThrow();
    const revoked = currentFixture(); await readPreparedDexMarketRegistry({ capability: revoked.capability, candidate: 'cheap-history',
      blockNumber: revoked.number, blockHash: keccak256(toUtf8Bytes(`directory-block-${revoked.number}`)) });
    revoked.revoke();
    await expect(readPreparedDexMarketRegistry({ capability: revoked.capability, candidate: 'cheap-history',
      blockNumber: revoked.number, blockHash: keccak256(toUtf8Bytes(`directory-block-${revoked.number}`)) })).rejects.toThrow('Session revoked');
    for (const fault of ['immutable', 'final-anchor'] as const) {
      const partial = currentFixture(), originalRequest = partial.request.getMockImplementation()!;
      const coreGetter = new Interface(['function core() view returns(address)']);
      const lastMath = selected.pairs[5].companions.find(([role]) => role === 'ChainWhisperSharedPoolMath')![1];
      let constructorsComplete = false;
      const readPartial = () => readPreparedDexMarketRegistry({ capability: partial.capability, candidate: 'cheap-history',
        blockNumber: partial.number, blockHash: keccak256(toUtf8Bytes(`directory-block-${partial.number}`)) });
      partial.request.mockImplementation(async request => {
        const result = await originalRequest(request), call = request.params?.[0] as { to?: string; data?: string };
        if (request.method === 'eth_call' && call.data === coreGetter.getFunction('core')!.selector) {
          if (call.to === lastMath) constructorsComplete = true;
          if (fault === 'immutable' && call.to === selected.pairs[1].engine) return coreGetter.encodeFunctionResult('core', [selected.tokens[0][0]]);
        }
        if (fault === 'final-anchor' && constructorsComplete && request.method === 'eth_getBlockByNumber' &&
            request.params?.[0] === `0x${partial.number.toString(16)}`) return { ...(result as object), hash: `0x${'ab'.repeat(32)}` };
        return result;
      });
      await expect(readPartial()).rejects.toThrow();
      partial.request.mockImplementation(originalRequest); partial.request.mockClear(); await readPartial();
      expect(partial.request).toHaveBeenCalledTimes(207);
    }
    expect(counts).toEqual({ cold: 207, sameBlock: 42, nextBlock: 55 });
  }, 30_000); // About 3 s alone; many replayed reads exceed the 5 s default under full DEX-suite load.
  it.each(['core', 'token', 'selector', 'id', 'registry-revision', 'market-revision', 'enabled', 'engine', 'terms', 'anchor', 'chain', 'session'] as const)('rejects changed %s after qualification', async fault => {
    const f = currentFixture(); await f.read();
    if (fault === 'core') f.drift(selected.core);
    if (fault === 'token') f.drift(selected.tokens[0][0]);
    if (fault === 'selector') f.row[0] = `0x${'11'.repeat(32)}`;
    if (fault === 'id') f.row[1] = 0n;
    if (fault === 'registry-revision') f.row[2] = 0n;
    if (fault === 'market-revision') f.row[3] = 0n;
    if (fault === 'enabled') f.row[4] = false;
    if (fault === 'engine') f.row[5] = selected.core;
    if (fault === 'terms') f.row[6] = selected.core;
    if (fault === 'anchor') f.reorg();
    if (fault === 'chain') f.wrongChain();
    if (fault === 'session') f.revoke();
    await expect(f.read(f.number + 1n)).rejects.toThrow();
  });
  it('clears failed observations and qualifies a new capability independently', async () => {
    const f = currentFixture(); await f.read(); f.fail(); await expect(f.read()).rejects.toThrow(); f.resume();
    f.request.mockClear(); await f.read(); expect(f.request).toHaveBeenCalledTimes(107);
    f.request.mockClear(); await readCurrentSharedPoolDexGraph({ capability: f.makeCapability(), candidate: 'cheap-history', blockNumber: f.number, blockHash: (await f.read()).block.hash });
    expect(f.request.mock.calls.filter(([r]) => r.method === 'eth_getCode').length).toBeGreaterThan(5);
  });
  it.each(['reorg', 'chain', 'session-after-read'] as const)('rejects %s on exact same-block reuse', async fault => {
    const f = currentFixture(); await f.read(); f.request.mockClear();
    if (fault === 'reorg') f.reorg();
    if (fault === 'chain') f.wrongChain();
    if (fault === 'session-after-read') f.revokeAtBlock();
    // The caller retains the original observed hash even if the provider replaces its block.
    const original = keccak256(toUtf8Bytes(`directory-block-${f.number}`));
    await expect(f.read(f.number, original)).rejects.toThrow();
    expect(f.request.mock.calls.every(([r]) => ['eth_chainId', 'eth_getBlockByNumber'].includes(r.method))).toBe(true);
  });
  it.each(['newer', 'invalidated', 'conflicting'] as const)('does not publish a stale overlapping %s observation', async fault => {
    const f = currentFixture(); await f.read();
    let unblock!: () => void, reached!: () => void;
    const blocked = new Promise<void>(resolve => { unblock = resolve; }), entered = new Promise<void>(resolve => { reached = resolve; });
    const original = f.request.getMockImplementation()!;
    let held = false;
    const older = f.number + 1n, newer = f.number + 2n;
    const conflictingHash = keccak256(toUtf8Bytes('conflicting-canonical-head'));
    f.request.mockImplementation(async request => {
      if (request.method === 'eth_getBlockByNumber' && request.params?.[0] === `0x${older.toString(16)}` && !held) {
        held = true; reached(); await blocked;
      }
      const result = await original(request);
      return fault === 'conflicting' && request.method === 'eth_getBlockByNumber' && request.params?.[0] === `0x${older.toString(16)}`
        ? { ...(result as object), hash: conflictingHash } : result;
    });
    const pending = f.read(older, fault === 'conflicting' ? conflictingHash : undefined);
    const outcome = pending.then(value => ({ value, error: null }), error => ({ value: null, error }));
    await entered;
    if (fault === 'newer') await f.read(newer);
    if (fault === 'invalidated') { f.fail(); await expect(f.read(newer)).rejects.toThrow(); f.resume(); }
    if (fault === 'conflicting') {
      f.request.mockImplementation(original);
      await f.read(older);
      f.request.mockImplementation(async request => {
        const result = await original(request);
        return request.method === 'eth_getBlockByNumber' && request.params?.[0] === `0x${older.toString(16)}` ? { ...(result as object), hash: conflictingHash } : result;
      });
    }
    unblock(); const settled = await outcome;
    if (fault === 'newer') {
      expect(settled.error).toBeNull(); f.request.mockClear(); await f.read(newer); expect(f.request).toHaveBeenCalledTimes(2);
    } else expect(settled.error).toBeInstanceOf(Error);
    if (fault === 'invalidated') { f.request.mockClear(); await f.read(newer); expect(f.request).toHaveBeenCalledTimes(107); }
  });
  it.each(['none', 'head-reorg', 'quote-origin-reorg'] as const)('keeps final canonical and Quote-origin checks after candidate anchor reuse: %s', async fault => {
    const f = currentFixture(); await f.read(); f.request.mockClear();
    const original = f.request.getMockImplementation()!;
    const origin = f.number - 1n, currentHex = `0x${f.number.toString(16)}`, originHex = `0x${origin.toString(16)}`;
    let heads = 0, origins = 0;
    f.request.mockImplementation(async request => {
      const result = await original(request);
      if (request.method === 'eth_getBlockByNumber') {
        const currentChanged = request.params?.[0] === currentHex && ++heads === 2 && fault === 'head-reorg';
        const originChanged = request.params?.[0] === originHex && ++origins === 2 && fault === 'quote-origin-reorg';
        if (currentChanged || originChanged) return { ...(result as object), hash: keccak256(toUtf8Bytes('replaced-canonical-block')) };
      }
      return result;
    });
    const pending = readCurrentDexOperation({ capability: f.capability, candidate: selected, profile: 'cheap-async', operationId: 7n,
      expected: { chainId: 7082400n, core: selected.core, releaseId: selected.releaseId,
        runtimeHash: selected.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2],
        originBlockNumber: origin, originBlockHash: keccak256(toUtf8Bytes(`directory-block-${origin}`)) } });
    if (fault !== 'none') await expect(pending).rejects.toThrow('block changed');
    else {
      expect((await pending).operation.phase).toBe('preparing-quote');
      expect(f.request).toHaveBeenCalledTimes(12);
      for (const anchor of ['0x0', `0x${BigInt(selected.attestationBlock.number).toString(16)}`]) {
        expect(f.request.mock.calls.filter(([r]) => r.method === 'eth_getBlockByNumber' && r.params?.[0] === anchor)).toHaveLength(1);
      }
    }
  });
  it('reuses exact canonical operation bindings but reads operation state fresh and clears failures', async () => {
    const f = currentFixture(), origin = f.number - 1n;
    const request = { capability: f.capability, candidate: selected, profile: 'cheap-async' as const, operationId: 7n,
      expected: { chainId: 7082400n, core: selected.core, releaseId: selected.releaseId,
        runtimeHash: selected.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2],
        originBlockNumber: origin, originBlockHash: keccak256(toUtf8Bytes(`directory-block-${origin}`)) } };
    const first = await readCurrentDexOperation(request);
    f.request.mockClear();
    expect(await readCurrentDexOperation(request)).toEqual(first);
    expect(f.request).toHaveBeenCalledTimes(8);
    expect(f.request.mock.calls.filter(([r]) => r.method === 'eth_call')).toHaveLength(1);
    expect(f.request.mock.calls.some(([r]) => r.method === 'eth_getCode')).toBe(false);
    f.fail(); await expect(readCurrentDexOperation(request)).rejects.toThrow(); f.resume();
    f.request.mockClear(); await readCurrentDexOperation(request);
    expect(f.request).toHaveBeenCalledTimes(12);
    f.request.mockClear(); await readCurrentDexOperation({ ...request, capability: f.makeCapability() });
    expect(f.request).toHaveBeenCalledTimes(12);
  });
  it.each(['chain', 'head', 'origin', 'session'] as const)('rejects cached operation bindings after %s changes', async fault => {
    const f = currentFixture(), origin = f.number - 1n;
    const request = { capability: f.capability, candidate: selected, profile: 'cheap-async' as const, operationId: 7n,
      expected: { chainId: 7082400n, core: selected.core, releaseId: selected.releaseId,
        runtimeHash: selected.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2],
        ...(fault === 'head' ? { blockNumber: f.number, blockHash: keccak256(toUtf8Bytes(`directory-block-${f.number}`)) } : {}),
        originBlockNumber: origin, originBlockHash: keccak256(toUtf8Bytes(`directory-block-${origin}`)) } };
    await readCurrentDexOperation(request);
    if (fault === 'chain') f.wrongChain();
    if (fault === 'head') f.reorg();
    if (fault === 'session') f.revoke();
    if (fault === 'origin') request.expected.originBlockHash = keccak256(toUtf8Bytes('different-origin'));
    await expect(readCurrentDexOperation(request)).rejects.toThrow();
  });
});

// Only the historical reader fixture's synthetic code has a pinned hash override.
// Manifest hashes, calldata, fault code and all other inputs use real keccak256.
const fixtureCodeHashes = vi.hoisted(() => new Map<string, string>());
vi.mock('@coti-io/coti-ethers', async original => {
  const actual = await original<typeof import('@coti-io/coti-ethers')>();
  return { ...actual, keccak256: (value: string) => fixtureCodeHashes.get(value) ?? actual.keccak256(value) };
});

const CORE = new Interface([
  'function contractVersion() view returns (string)',
  'function owner() view returns (address)',
  'function poolModule() view returns (address)',
  'function limitModule() view returns (address)',
  'function recurringModule() view returns (address)',
  'function swapModule() view returns (address)',
  'function positionToken() view returns (address)',
  'function poolModuleRuntimeHash() view returns (bytes32)',
  'function limitModuleRuntimeHash() view returns (bytes32)',
  'function recurringModuleRuntimeHash() view returns (bytes32)',
  'function swapModuleRuntimeHash() view returns (bytes32)',
  'function privateTokenRuntimeManifestHash() view returns (bytes32)',
  'function privateTokenRuntimeManifestLength() view returns (uint256)',
  'function approvedPrivateTokenCodeHash(address token) view returns (bytes32)',
  'function canonicalTickTableHash() view returns (bytes32)',
  'function newActivityPaused() view returns (bool)',
  'function getPair(bytes32 key) view returns ((address baseToken,address quoteToken,bytes32 baseTokenCodeHash,bytes32 quoteTokenCodeHash,bytes32 tickTableHash,uint128 baseLotSize,uint128 quoteLotSize,uint64 executionRevision,uint64 createdAt,uint64 lastPublicPoolPriorityId,uint64 lastPublicPoolMarginalTick,uint32 maximumAggregateLots,uint8 baseDecimals,uint8 quoteDecimals,bool initialized))'
]);

const FACTORY = new Interface([
  'function authorizedDeployer() view returns (address)',
  'function poolModule() view returns (address)',
  'function limitModule() view returns (address)',
  'function recurringModule() view returns (address)',
  'function swapModule() view returns (address)',
  'function dexCore() view returns (address)',
  'function deploymentCompleted() view returns (bool)'
]);

const MODULE = new Interface([
  'function intendedDex() view returns (address)',
  'function moduleSelf() view returns (address)',
  'function moduleVersion() view returns (string)'
]);

const NFT = new Interface([
  'function dex() view returns (address)',
  'function contractVersion() view returns (string)'
]);

const address = (byte: number): string => `0x${byte.toString(16).padStart(2, '0').repeat(20)}`;
const hash = (label: string): string => keccak256(toUtf8Bytes(label)).toLowerCase();
const pairKey = (baseToken: string, quoteToken: string): string =>
  keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'address'], [baseToken, quoteToken])).toLowerCase();
const componentCode = Object.freeze(Object.fromEntries(
  DEX_V2_COMPONENT_KEYS.map((key, index) => [key, `0x60${(index + 1).toString(16).padStart(2, '0')}`])
)) as Readonly<Record<DexV2ComponentKey, string>>;

const makeManifest = (): DexV2AppManifest => {
  const addresses = Object.fromEntries(DEX_V2_COMPONENT_KEYS.map((key, index) => [key, address(index + 1)]));
  const runtimeHashes = Object.fromEntries(
    DEX_V2_COMPONENT_KEYS.map((key) => [key, keccak256(componentCode[key]).toLowerCase()])
  );
  const body = {
    schemaVersion: 1,
    status: 'activated-testnet',
    network: 'cotiTestnet',
    chainId: '7082400',
    productionActivationEvidence: false,
    operator: address(59),
    owner: address(60),
    deploymentPlanHash: hash('deployment-plan'),
    deploymentCandidateHash: hash('candidate'),
    activationPlanHash: hash('activation-plan'),
    activationReportHash: hash('activation-report'),
    addresses,
    runtimeHashes,
    deploymentAnchors: {
      factory: { number: '100', hash: hash('block-100') },
      economicSuite: { number: '105', hash: hash('block-105') },
      pairRegistration: { number: '110', hash: hash('block-110') }
    },
    pair: {
      baseToken: address(40),
      quoteToken: address(41),
      pairKey: pairKey(address(40), address(41)),
      baseTokenRuntimeHash: keccak256('0x6040').toLowerCase(),
      quoteTokenRuntimeHash: keccak256('0x6041').toLowerCase(),
      privateTokenRuntimeManifestHash: hash('private-token-manifest'),
      privateTokenRuntimeManifestLength: 1,
      baseDecimals: 6,
      quoteDecimals: 6,
      baseLotSize: '100',
      quoteLotSize: '100',
      maximumAggregateLots: '2000000',
      tickTableHash: hash('tick-table')
    },
    activation: {
      result: 'pass',
      transactionCount: 16,
      measuredRouteCount: 4,
      finalBlock: { number: '150', hash: hash('block-150') },
      allProofsPassed: true,
      routeGasP95Passed: true,
      routeGasMaximumPassed: true,
      routeLatencyP95Passed: true
    }
  };
  return parseDexV2AppManifest(JSON.stringify({
    ...body,
    manifestHash: hashDexV2AppManifestBody(body)
  }));
};

const versions: Readonly<Record<'pool' | 'limit' | 'recurring' | 'swap', string>> = Object.freeze({
  pool: 'ChainWhisperDexPoolModuleV2',
  limit: 'ChainWhisperDexLimitModuleV2',
  recurring: 'ChainWhisperDexRecurringModuleV2',
  swap: 'ChainWhisperDexSwapModuleV2'
});

const makeProvider = (manifest: DexV2AppManifest, mutate?: {
  runtime?: Partial<Record<DexV2ComponentKey, string>>;
  blockHashes?: Readonly<Record<string, string>>;
  coreOwner?: string;
}) => {
  const blocks = new Map<string, string>([
    ['100', hash('block-100')],
    ['105', hash('block-105')],
    ['110', hash('block-110')],
    ['150', hash('block-150')],
    ['195', hash('block-195')],
    ['200', hash('block-200')]
  ]);
  for (const [number, blockHash] of Object.entries(mutate?.blockHashes ?? {})) blocks.set(number, blockHash);
  const codes = new Map<string, string>();
  for (const key of DEX_V2_COMPONENT_KEYS) {
    codes.set(manifest.addresses[key], mutate?.runtime?.[key] ?? componentCode[key]);
  }
  codes.set(manifest.pair.baseToken, '0x6040');
  codes.set(manifest.pair.quoteToken, '0x6041');

  const encode = (abi: Interface, name: string, values: readonly unknown[]): string =>
    abi.encodeFunctionResult(name, [...values]);

  const call = (to: string, data: string): string => {
    const normalized = to.toLowerCase();
    if (normalized === manifest.addresses.factory) {
      const name = FACTORY.parseTransaction({ data })?.name;
      const values: Record<string, readonly unknown[]> = {
        authorizedDeployer: [manifest.operator],
        poolModule: [manifest.addresses.pool],
        limitModule: [manifest.addresses.limit],
        recurringModule: [manifest.addresses.recurring],
        swapModule: [manifest.addresses.swap],
        dexCore: [manifest.addresses.core],
        deploymentCompleted: [true]
      };
      if (!name || !values[name]) throw new Error('unexpected factory call');
      return encode(FACTORY, name, values[name]);
    }
    if (normalized === manifest.addresses.core) {
      const parsed = CORE.parseTransaction({ data });
      const name = parsed?.name;
      if (!name) throw new Error('unexpected core call');
      const values: Record<string, readonly unknown[]> = {
        contractVersion: ['ChainWhisperDexCoreV2-discrete-bin'],
        owner: [mutate?.coreOwner ?? manifest.owner],
        poolModule: [manifest.addresses.pool],
        limitModule: [manifest.addresses.limit],
        recurringModule: [manifest.addresses.recurring],
        swapModule: [manifest.addresses.swap],
        positionToken: [manifest.addresses.positionToken],
        poolModuleRuntimeHash: [manifest.runtimeHashes.pool],
        limitModuleRuntimeHash: [manifest.runtimeHashes.limit],
        recurringModuleRuntimeHash: [manifest.runtimeHashes.recurring],
        swapModuleRuntimeHash: [manifest.runtimeHashes.swap],
        privateTokenRuntimeManifestHash: [manifest.pair.privateTokenRuntimeManifestHash],
        privateTokenRuntimeManifestLength: [BigInt(manifest.pair.privateTokenRuntimeManifestLength)],
        canonicalTickTableHash: [manifest.pair.tickTableHash],
        newActivityPaused: [false],
        getPair: [[
          manifest.pair.baseToken,
          manifest.pair.quoteToken,
          manifest.pair.baseTokenRuntimeHash,
          manifest.pair.quoteTokenRuntimeHash,
          manifest.pair.tickTableHash,
          100n,
          100n,
          10n,
          1n,
          0n,
          0n,
          2_000_000n,
          6,
          6,
          true
        ]]
      };
      if (name === 'approvedPrivateTokenCodeHash') {
        const token = String(parsed.args[0]).toLowerCase();
        const expected = token === manifest.pair.baseToken
          ? manifest.pair.baseTokenRuntimeHash
          : manifest.pair.quoteTokenRuntimeHash;
        return encode(CORE, name, [expected]);
      }
      if (!values[name]) throw new Error(`unexpected core call ${name}`);
      return encode(CORE, name, values[name]);
    }
    for (const key of Object.keys(versions) as Array<keyof typeof versions>) {
      if (normalized !== manifest.addresses[key]) continue;
      const name = MODULE.parseTransaction({ data })?.name;
      const values: Record<string, readonly unknown[]> = {
        intendedDex: [manifest.addresses.core],
        moduleSelf: [manifest.addresses[key]],
        moduleVersion: [versions[key]]
      };
      if (!name || !values[name]) throw new Error('unexpected module call');
      return encode(MODULE, name, values[name]);
    }
    if (normalized === manifest.addresses.positionToken) {
      const name = NFT.parseTransaction({ data })?.name;
      const values: Record<string, readonly unknown[]> = {
        dex: [manifest.addresses.core],
        contractVersion: ['ChainWhisperDexPositionNFTV2']
      };
      if (!name || !values[name]) throw new Error('unexpected NFT call');
      return encode(NFT, name, values[name]);
    }
    throw new Error('unexpected call target');
  };

  return {
    request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
      if (method === 'eth_chainId') return `0x${BigInt(7082400).toString(16)}`;
      if (method === 'eth_blockNumber') return '0xc8';
      if (method === 'eth_getBlockByNumber') {
        const number = BigInt(String(params[0])).toString();
        const blockHash = blocks.get(number);
        return blockHash ? { number: `0x${BigInt(number).toString(16)}`, hash: blockHash } : null;
      }
      if (method === 'eth_getCode') return codes.get(String(params[0]).toLowerCase()) ?? '0x';
      if (method === 'eth_call') {
        const transaction = params[0] as { to: string; data: string };
        return call(transaction.to, transaction.data);
      }
      throw new Error(`unsupported ${method}`);
    }
  };
};

describe('dexV2Chain', () => {
  // decision-034: the retained archived and d06 operation-reader fixtures were removed with those candidates.
  it('attests all seven runtimes, immutable bindings, the registered pair, and finality anchors', async () => {
    const manifest = makeManifest();
    let currentChecks = 0;
    const provider = makeProvider(manifest);
    const capability = createDexV2ReadCapability({
      provider: provider as never,
      chainId: 7082400n,
      assertCurrent: () => { currentChecks += 1; }
    });
    const deployment = await attestDexV2Deployment({ capability, manifest, finalityLagBlocks: 5n });
    expect(deployment).toMatchObject({
      attestationBlock: { number: '195', hash: hash('block-195') },
      executionRevision: '10',
      lastPublicPoolPriorityId: '0',
      lastPublicPoolMarginalTick: '0',
      newActivityPaused: false
    });
    expect(currentChecks).toBeGreaterThan(30);
    expect(assertAttestedDexV2Deployment(deployment)).toBe(deployment);
  });

  it('fails closed on runtime drift, immutable binding drift, or a reorganized anchor', async () => {
    const manifest = makeManifest();
    for (const provider of [
      makeProvider(manifest, { runtime: { swap: '0x6000' } }),
      makeProvider(manifest, { coreOwner: address(61) }),
      makeProvider(manifest, { blockHashes: { '150': hash('replacement-block') } })
    ]) {
      const capability = createDexV2ReadCapability({
        provider: provider as never,
        chainId: 7082400n,
        assertCurrent: () => undefined
      });
      await expect(attestDexV2Deployment({ capability, manifest, finalityLagBlocks: 5n })).rejects.toThrow();
    }
  });

  it('rejects unparsed manifests and stale wallet capabilities', async () => {
    const manifest = makeManifest();
    const provider = makeProvider(manifest);
    const stale = createDexV2ReadCapability({
      provider: provider as never,
      chainId: 7082400n,
      assertCurrent: () => { throw new Error('stale wallet lease'); }
    });
    await expect(attestDexV2Deployment({ capability: stale, manifest, finalityLagBlocks: 5n }))
      .rejects.toThrow(/stale wallet lease/);
    const capability = createDexV2ReadCapability({
      provider: provider as never,
      chainId: 7082400n,
      assertCurrent: () => undefined
    });
    await expect(attestDexV2Deployment({
      capability,
      manifest: JSON.parse(JSON.stringify(manifest)) as DexV2AppManifest,
      finalityLagBlocks: 5n
    })).rejects.toThrow(/exact parser/);
    expect(() => assertAttestedDexV2Deployment({} as never)).toThrow(/exact attester/);
  });
});
