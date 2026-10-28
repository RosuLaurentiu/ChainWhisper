import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { AbiCoder, Interface, keccak256, toUtf8Bytes, toBeHex, zeroPadValue } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import { createDexV2ReadCapability, readCurrentSharedPoolDexGraph } from './dexV2Chain';
import { CURRENT_SHARED_POOL_CANDIDATE as m } from './dexV2Deployment';
import { CURRENT_CHEAP_DEX_CANDIDATE as current, resolveCurrentCheapDexCandidate, assertCurrentCheapDexNativeAdmission } from './dexV2Deployment';

const codeHashMap = vi.hoisted(() => new Map<string, string>());
vi.mock('@coti-io/coti-ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@coti-io/coti-ethers')>();
  return { ...actual, keccak256: (value: string) => codeHashMap.get(value) ?? actual.keccak256(value) };
});

const root = '../../../ChainWhisper Contracts V2/validation/candidates/shared-pool-2026-09-28/';
const retained = (name: string) => readFileSync(new URL(root + name, import.meta.url), 'utf8');
const coreAbi = new Interface([
  'function releaseId() view returns (bytes32)', 'function marketId() view returns (bytes32)',
  'function feePpm() view returns (uint32)', 'function maxWorkLifetime() view returns (uint32)',
  'function tokenAdmissionCommitment() view returns (bytes32)',
  'function inputToken() view returns (address)', 'function outputToken() view returns (address)',
  'function inputRuntimeHash() view returns (bytes32)', 'function outputRuntimeHash() view returns (bytes32)',
  'function fixedEngine() view returns (address)', 'function fixedEngineRuntimeHash() view returns (bytes32)',
  'function terminalEvaluator() view returns (address)', 'function terminalEvaluatorRuntimeHash() view returns (bytes32)',
  'function terminalEvaluatorBindingCommitment() view returns (bytes32)',
  'function positionNFT() view returns (address)', 'function positionNFTRuntimeHash() view returns (bytes32)',
  'function fastPoolQuote() view returns (address)', 'function poolTerms() view returns (address)'
]);
const engineAbi = new Interface([
  'function core() view returns (address)', 'function releaseId() view returns (bytes32)',
  'function marketId() view returns (bytes32)', 'function positionNFT() view returns (address)',
  'function inputToken() view returns (address)', 'function outputToken() view returns (address)',
  'function feePpm() view returns (uint32)', 'function maxWorkLifetime() view returns (uint32)',
  'function selector() view returns (address)', 'function selectorRuntimeHash() view returns (bytes32)'
]);
const factoryAbi = new Interface([
  'function snapshotOwner() view returns (address)', 'function recurringOwner() view returns (address)',
  'function ownerLifecycle() view returns (address)', 'function orderWork() view returns (address)',
  'function workLifecycle() view returns (address)', 'function rangeOwner() view returns (address)',
  'function rangeWork() view returns (address)', 'function matchWork() view returns (address)'
]);
const nftAbi = new Interface(['function core() view returns (address)']);
const evaluatorAbi = new Interface(['function bindingCommitment() view returns (bytes32)']);
const at = (role: string) => m.runtimes.find(([name]) => name === role)![1];
const runtime = (role: string) => m.runtimes.find(([name]) => name === role)![2];
const engine = '0x0000000000000000000000000000000000000101';
const evaluator = '0x0000000000000000000000000000000000000102';
const nft = '0x0000000000000000000000000000000000000103';
const binding = `0x${'33'.repeat(32)}`;
const blockHash = `0x${'44'.repeat(32)}`;
const blockNumber = 9819000n;
const code = '0x6001';
const dynamicHash = keccak256(code);
const codes = new Map<string, string>();
[...m.runtimes.map(([, address, hash]) => [address, hash]), ...m.tokens].forEach(([address, hash], i) => {
  const synthetic = `0xcafe${i.toString(16).padStart(2, '0')}`;
  codes.set(address, synthetic);
  codeHashMap.set(synthetic, hash);
});
const values: Record<string, Record<string, string | number>> = {
  [m.core]: {
    releaseId: m.releaseId, marketId: m.marketId, feePpm: m.feePpm,
    maxWorkLifetime: m.maxWorkLifetime, tokenAdmissionCommitment: m.reviewedTokenSet,
    inputToken: m.tokens[0][0], outputToken: m.tokens[1][0],
    inputRuntimeHash: m.tokens[0][1], outputRuntimeHash: m.tokens[1][1],
    fixedEngine: engine, fixedEngineRuntimeHash: dynamicHash,
    terminalEvaluator: evaluator, terminalEvaluatorRuntimeHash: dynamicHash,
    terminalEvaluatorBindingCommitment: binding,
    positionNFT: nft, positionNFTRuntimeHash: dynamicHash
  },
  [engine]: { core: m.core, releaseId: m.releaseId, marketId: m.marketId,
    positionNFT: nft, inputToken: m.tokens[0][0], outputToken: m.tokens[1][0],
    feePpm: m.feePpm, maxWorkLifetime: m.maxWorkLifetime,
    selector: at('ChainWhisperFixedBoundedSelector'),
    selectorRuntimeHash: runtime('ChainWhisperFixedBoundedSelector') },
  [evaluator]: { bindingCommitment: binding },
  [nft]: { core: m.core },
  [at('ChainWhisperFixedEngineFactory')]: {
    snapshotOwner: at('ChainWhisperFixedOwner'), recurringOwner: at('ChainWhisperRecurringOwnerControls'),
    ownerLifecycle: at('ChainWhisperOrderOwnerLifecycle'), orderWork: at('ChainWhisperOrderWork'),
    workLifecycle: at('ChainWhisperFixedWorkLifecycle'), rangeOwner: at('ChainWhisperRangeOwner'),
    rangeWork: at('ChainWhisperRangeWork')
  }
};
const interfaces: Record<string, Interface> = {
  [m.core]: coreAbi, [engine]: engineAbi, [evaluator]: evaluatorAbi,
  [nft]: nftAbi, [at('ChainWhisperFixedEngineFactory')]: factoryAbi
};

const provider = (fault: { code?: string; getter?: string; network?: boolean; genesis?: boolean;
  reorg?: boolean; session?: boolean } = {}) => {
  let current = true, anchors = 0;
  const assertCurrent = () => { if (!current) throw new Error('Session revoked'); };
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    const p = params ?? [];
    if (method === 'eth_chainId') return fault.network ? '0x1' : '0x6c11a0';
    if (method === 'eth_getBlockByNumber') {
      if (p[0] === '0x0') return { number: '0x0', hash: fault.genesis ? blockHash : m.genesisHash };
      expect(p[0]).toBe(`0x${blockNumber.toString(16)}`);
      return { number: p[0], hash: fault.reorg && ++anchors > 1 ? m.genesisHash : blockHash, timestamp: '0x64' };
    }
    expect(p[1]).toEqual({ blockHash, requireCanonical: true });
    if (method === 'eth_getCode') {
      const address = p[0] as string;
      if (fault.session) current = false;
      if (address === fault.code) return '0x6002';
      return [engine, evaluator, nft].includes(address) ? code : codes.get(address);
    }
    if (method === 'eth_call') {
      const call = p[0] as { to: string; data: string };
      const abi = interfaces[call.to];
      const name = abi?.parseTransaction({ data: call.data })?.name;
      if (!abi || !name) throw new Error('Unexpected call');
      const original = values[call.to][name];
      const value = fault.getter === `${call.to}:${name}`
        ? typeof original === 'number' ? original + 1 : original.length === 42
          ? original === m.tokens[0][0] ? m.tokens[1][0] : m.tokens[0][0]
          : original === m.marketId ? m.releaseId : m.marketId
        : original;
      return abi.encodeFunctionResult(name, [value]);
    }
    throw new Error(`Unexpected RPC ${method}`);
  });
  return { request, capability: createDexV2ReadCapability({ provider: { request }, chainId: 7082400n, assertCurrent }) };
};
const read = (capability: ReturnType<typeof provider>['capability']) =>
  readCurrentSharedPoolDexGraph({ capability, blockNumber, blockHash });

const currentAt = (role: string) => current.runtimes.find(([name]) => name === role)![1];
const companionAt = (role: string) => current.companions.find(([name]) => name === role)![1];
const companionHash = (role: string) => current.companions.find(([name]) => name === role)![2];
const currentEngine = companionAt('ChainWhisperFixedEngine');
const currentEvaluator = companionAt('ChainWhisperDexWideTerminalGT');
const currentNFT = companionAt('ChainWhisperDexPositionNFT');
const currentFast = companionAt('ChainWhisperDexFastPoolQuote');
const currentFactory = currentAt('ChainWhisperFixedEngineFactory');
const currentNumber = BigInt(current.attestationBlock.number) + 100n;
const currentHash = `0x${'55'.repeat(32)}`;
const currentCodes = new Map<string, string>();
const currentRuntimeRows = [...current.runtimes, ...current.companions,
  ...current.tokens.map(([address, hash]) => ['token', address, hash] as const)];
currentRuntimeRows.forEach(([, address, hash], i) => {
  const synthetic = `0xdead${i.toString(16).padStart(2, '0')}`;
  currentCodes.set(address, synthetic);
  codeHashMap.set(synthetic, hash);
});
const currentValues: Record<string, Record<string, string | number>> = {
  [current.core]: { releaseId: current.releaseId, marketId: current.marketId,
    feePpm: current.feePpm, maxWorkLifetime: current.maxWorkLifetime,
    tokenAdmissionCommitment: current.reviewedTokenSet,
    inputToken: current.tokens[0][0], outputToken: current.tokens[1][0],
    inputRuntimeHash: current.tokens[0][1], outputRuntimeHash: current.tokens[1][1],
    fixedEngine: currentEngine, fixedEngineRuntimeHash: companionHash('ChainWhisperFixedEngine'),
    terminalEvaluator: currentEvaluator, terminalEvaluatorRuntimeHash: companionHash('ChainWhisperDexWideTerminalGT'),
    terminalEvaluatorBindingCommitment: current.evaluatorBinding,
    positionNFT: currentNFT, positionNFTRuntimeHash: companionHash('ChainWhisperDexPositionNFT'),
    fastPoolQuote: currentFast, poolTerms: current.poolTerms },
  [currentEngine]: { core: current.core, releaseId: current.releaseId, marketId: current.marketId,
    positionNFT: currentNFT, inputToken: current.tokens[0][0], outputToken: current.tokens[1][0],
    feePpm: current.feePpm, maxWorkLifetime: current.maxWorkLifetime,
    selector: currentAt('ChainWhisperFixedBoundedSelector'),
    selectorRuntimeHash: current.runtimes.find(([role]) => role === 'ChainWhisperFixedBoundedSelector')![2] },
  [currentEvaluator]: { bindingCommitment: current.evaluatorBinding },
  [currentNFT]: { core: current.core }, [currentFast]: { core: current.core },
  [currentFactory]: Object.fromEntries([
    ['snapshotOwner', 'ChainWhisperFixedOwner'], ['recurringOwner', 'ChainWhisperRecurringOwnerControls'],
    ['ownerLifecycle', 'ChainWhisperOrderOwnerLifecycle'], ['orderWork', 'ChainWhisperOrderWork'],
    ['workLifecycle', 'ChainWhisperFixedWorkLifecycle'], ['rangeOwner', 'ChainWhisperRangeOwner'],
    ['rangeWork', 'ChainWhisperRangeWork'], ['matchWork', 'ChainWhisperFixedMatchWork']
  ].map(([getter, role]) => [getter, currentAt(role)]))
};
const currentInterfaces: Record<string, Interface> = { [current.core]: coreAbi,
  [currentEngine]: engineAbi, [currentEvaluator]: evaluatorAbi, [currentNFT]: nftAbi,
  [currentFast]: nftAbi, [currentFactory]: factoryAbi };
type CurrentFault = { code?: string; getter?: string; storage?: number; network?: boolean;
  networkAfter?: boolean; genesis?: boolean; genesisAfter?: boolean; origin?: boolean; originAfter?: boolean;
  reorg?: boolean; session?: 'code' | 'getter' | 'final'; malformedStorage?: boolean;
  consistentBinding?: boolean; missingBlock?: boolean; wrongNumber?: boolean; badTimestamp?: boolean };
const currentProvider = (fault: CurrentFault = {}) => {
  let active = true, anchors = 0, origins = 0, chains = 0, genesisReads = 0;
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    const p = params ?? [];
    if (method === 'eth_chainId') return fault.network || (fault.networkAfter && ++chains > 1) ? '0x1' : '0x6c11a0';
    if (method === 'eth_getBlockByNumber') {
      if (p[0] === '0x0') return { number: '0x0', hash: fault.genesis ||
        (fault.genesisAfter && ++genesisReads > 1) ? currentHash : current.genesisHash };
      if (p[0] === `0x${BigInt(current.attestationBlock.number).toString(16)}`) {
        return { number: p[0], hash: fault.origin || (fault.originAfter && ++origins > 1) ? currentHash : current.attestationBlock.hash };
      }
      expect(p[0]).toBe(`0x${currentNumber.toString(16)}`);
      anchors++;
      if (fault.session === 'final' && anchors > 1) active = false;
      if (fault.missingBlock) return null;
      return { number: fault.wrongNumber ? '0x1' : p[0],
        hash: fault.reorg && anchors > 1 ? current.genesisHash : currentHash,
        timestamp: fault.badTimestamp ? '0x00' : '0x64' };
    }
    expect(p[1]).toEqual(method === 'eth_getStorageAt' ? expect.any(String) : { blockHash: currentHash, requireCanonical: true });
    if (method === 'eth_getCode') {
      if (fault.session === 'code') active = false;
      return p[0] === fault.code ? '0x6002' : currentCodes.get(p[0] as string);
    }
    if (method === 'eth_getStorageAt') {
      expect(p[0]).toBe(currentFactory);
      expect(p[2]).toEqual({ blockHash: currentHash, requireCanonical: true });
      const slot = Number(BigInt(p[1] as string));
      return fault.malformedStorage ? '0x01' : slot === fault.storage ? zeroPadValue('0x01', 32) :
        current.factoryStorage.find(([s]) => Number(s) === slot)![1];
    }
    if (method === 'eth_call') {
      if (fault.session === 'getter') active = false;
      const call = p[0] as { to: string; data: string };
      const abi = currentInterfaces[call.to];
      const name = abi?.parseTransaction({ data: call.data })?.name;
      if (!abi || !name || currentValues[call.to][name] === undefined) throw new Error('Unexpected current getter');
      const original = currentValues[call.to][name];
      const drift = fault.getter === `${call.to}:${name}` ||
        (fault.consistentBinding && ['bindingCommitment', 'terminalEvaluatorBindingCommitment'].includes(name));
      const value = !drift ? original : typeof original === 'number' ? original + 1 :
        original.length === 42 ? engine : binding;
      return abi.encodeFunctionResult(name, [value]);
    }
    throw new Error(`Unexpected current RPC ${method}`);
  });
  return { request, capability: createDexV2ReadCapability({ provider: { request }, chainId: 7082400n,
    assertCurrent: () => { if (!active) throw new Error('Session revoked'); } }) };
};
const readCurrent = (capability: ReturnType<typeof currentProvider>['capability']) =>
  readCurrentSharedPoolDexGraph({ capability, blockNumber: currentNumber, blockHash: currentHash, candidate: 'cheap-current' });

describe('current cheap-mode public graph identity', () => {
  it('binds retained archived runtimes, public identities and Factory slots to their exact frozen package', () => {
    const current = resolveCurrentCheapDexCandidate('cheap-archived');
    const currentEvaluator = current.companions.find(([role]) => role === 'ChainWhisperDexWideTerminalGT')![1];
    const frozen = createRequire(import.meta.url)(root.replace('shared-pool-2026-09-28/',
      'direct-limit-match-2026-09-30/current-integration/current-pool-case.cjs')).frozen();
    expect(frozen.attHash).toBe(current.attestationSha256);
    expect(frozen.candidate.graphSha256).toBe(current.graph);
    expect(frozen.candidate.packageSha256).toBe(current.packageSha256);
    expect(frozen.pkg.chainId).toBe(String(current.chainId));
    expect(frozen.pkg.genesisHash).toBe(current.genesisHash);
    expect(frozen.pkg.expectedCore.toLowerCase()).toBe(current.core);
    expect(frozen.pkg.calls).toHaveLength(40);
    expect(current.runtimes.length + current.companions.length + current.tokens.length).toBe(46);
    expect(frozen.att.rows.map((row: { index: number; name: string; address: string; runtimeHash: string }, i: number) => {
      expect(row.index).toBe(frozen.pkg.calls[i].index);
      expect(row.name).toBe(frozen.pkg.calls[i].name);
      expect(row.address.toLowerCase()).toBe(frozen.pkg.calls[i].predictedAddress.toLowerCase());
      return [row.name, row.address.toLowerCase(), row.runtimeHash];
    })).toEqual(current.runtimes);
    expect(frozen.att.companions.map((row: { name: string; address: string; runtimeHash: string }) =>
      [row.name, row.address.toLowerCase(), row.runtimeHash])).toEqual(current.companions);
    expect(frozen.pkg.tokenAddresses.map((address: string, i: number) =>
      [address.toLowerCase(), frozen.pkg.tokenRuntimeHashes[i]])).toEqual(current.tokens);
    for (const [key, pkgKey] of [['releaseId', 'release'], ['marketId', 'market'],
      ['reviewedTokenSet', 'reviewedTokenSet'], ['feePpm', 'feePpm'], ['maxWorkLifetime', 'maxWorkLifetime']] as const) {
      expect(String(current[key])).toBe(String(frozen.pkg[pkgKey]));
    }
    expect(current.poolTerms).toBe(frozen.att.publicState.poolTerms.toLowerCase());
    expect(current.attestationBlock).toEqual({ number: String(frozen.att.head.number), hash: frozen.att.head.hash });
    const factory = frozen.pkg.calls.find((row: { name: string }) => row.name === 'ChainWhisperFixedEngineFactory');
    const nativeFactoryABI = new frozen.iface.constructor(frozen.candidate.compiled('ChainWhisperFixedEngineFactory').abi);
    expect(factory.data.endsWith(nativeFactoryABI.encodeDeploy(factory.args).slice(2))).toBe(true);
    const layout = frozen.candidate.compiled('ChainWhisperFixedEngineFactory').storageLayout.storage;
    expect(layout.filter((row: { label: string }) => ['_first', '_second', '_creationLength', 'expectedCore'].includes(row.label))
      .map((row: { slot: string; offset: number; type: string }) => [Number(row.slot), row.offset, row.type]))
      .toEqual([[5, 0, 't_address'], [6, 0, 't_address'], [7, 0, 't_uint256'], [10, 0, 't_address']]);
    expect(current.factoryStorage).toEqual([0, 1, 2, 8].map((arg, i) =>
      [String([5, 6, 7, 10][i]), zeroPadValue(typeof factory.args[arg] === 'number' ? toBeHex(factory.args[arg]) : factory.args[arg], 32).toLowerCase()]));
    for (const [name, abi] of [['ChainWhisperDexCore', coreAbi], ['ChainWhisperFixedEngine', engineAbi],
      ['ChainWhisperFixedEngineFactory', factoryAbi], ['ChainWhisperDexPositionNFT', nftAbi],
      ['ChainWhisperDexFastPoolQuote', nftAbi], ['ChainWhisperDexWideTerminalGT', evaluatorAbi]] as const) {
      const actual = new frozen.iface.constructor(frozen.candidate.compiled(name).abi);
      abi.forEachFunction(fragment => {
        const found = actual.getFunction(fragment.name);
        expect(found.format('sighash')).toBe(fragment.format('sighash'));
        expect(found.outputs.map((output: { type: string }) => output.type)).toEqual(fragment.outputs.map(output => output.type));
        expect(found.stateMutability).toBe(fragment.stateMutability);
      });
    }
    const evaluatorSource = frozen.candidate.info.input.sources['contracts/dex/ChainWhisperDexWideTerminalGT.sol'].content;
    expect(evaluatorSource).toContain('chainwhisper.dex.role.terminal-evaluator');
    expect(evaluatorSource).toContain('chainwhisper.dex.terminal.wide512.bounded-net-payout.minimum-input.v7');
    expect(evaluatorSource).toContain('uint16 private constant RESULT_ABI_VERSION = 7;');
    expect(evaluatorSource.replace(/\s/g, '')).toContain(
      'abi.encode(block.chainid,address(this),core_,releaseId_,marketId_,MODULE_ROLE,RESULT_ABI_VERSION,TERMINAL_PROFILE_COMMITMENT,feePpm_)');
    const expectedBinding = keccak256(AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'address', 'address', 'bytes32', 'bytes32', 'bytes32', 'uint16', 'bytes32', 'uint32'],
      [current.chainId, currentEvaluator, current.core, current.releaseId, current.marketId,
        keccak256(toUtf8Bytes('chainwhisper.dex.role.terminal-evaluator')), 7,
        keccak256(toUtf8Bytes('chainwhisper.dex.terminal.wide512.bounded-net-payout.minimum-input.v7')), current.feePpm]));
    expect(current.evaluatorBinding).toBe(expectedBinding);
    expect(current.readyToSign).toBe(false);
  });

  it('binds actual current d06 identity to its exact saved public capture without granting admission', async () => {
    const captureBytes = readFileSync(new URL('../../reports/current-dex-c1-integration-2026-10-06/public-capture-5.json', import.meta.url));
    expect(createHash('sha256').update(captureBytes).digest('hex')).toBe(current.attestationSha256);
    const capture = JSON.parse(captureBytes.toString()) as { schema: string; destination: string; reads: { method: string; params: unknown[]; result: unknown }[] };
    expect(capture.schema).toBe('D06_APP_PUBLIC_BINDING_V1'); expect(capture.destination).toBe('https://testnet.coti.io/rpc');
    const helper = createRequire(import.meta.url)('../../scripts/prepare-current-dex-c1-candidate.cjs');
    const input = helper.inputs(); expect(input.pkg.calls).toHaveLength(43);
    const saved = new Map(capture.reads.map(row => [JSON.stringify([row.method, row.params]), row.result]));
    const rpc = vi.fn(async (method: string, params: unknown[]) => {
      expect(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getStorageAt', 'eth_call']).toContain(method);
      const key = JSON.stringify([method, params]); expect(saved.has(key)).toBe(true); return saved.get(key);
    });
    const observed = await helper.collect(rpc, input);
    expect({ ...observed, attestationSha256: current.attestationSha256 }).toEqual(current);
    expect(current.graph).toBe(resolveCurrentCheapDexCandidate('cheap-d06').graph);
    expect(current.runtimes).toHaveLength(46); expect(current.companions).toHaveLength(4); expect(current.tokens).toHaveLength(2);
    expect(() => assertCurrentCheapDexNativeAdmission(current)).toThrow('native App submission admission');
    expect(rpc.mock.calls.some(([method]) => method.startsWith('eth_send'))).toBe(false);
  }, 30000);

  it('reads exactly 52 d06 runtime identities and required public links at one canonical head', async () => {
    const p = currentProvider();
    expect(await readCurrent(p.capability)).toMatchObject({ graph: current.graph, core: current.core,
      runtimeCount: 52, readyToSign: false, attestationSha256: current.attestationSha256,
      deploymentOrigin: current.attestationBlock,
      operationReadIdentity: { releaseId: current.releaseId,
        runtimeHash: current.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2] } });
    expect(p.request.mock.calls.filter(([call]) => call.method === 'eth_getCode')).toHaveLength(52);
    expect(p.request.mock.calls.filter(([call]) => call.method === 'eth_getCode').map(([call]) => call.params![0]))
      .toEqual([...current.runtimes.map(([, address]) => address), ...current.tokens.map(([address]) => address), ...current.companions.map(([, address]) => address)]);
    expect(p.request.mock.calls.some(([call]) => call.method.startsWith('eth_send'))).toBe(false);
  });

  it.each(currentRuntimeRows)('rejects actual runtime drift for %s at %s', async (_role, code) => {
    await expect(readCurrent(currentProvider({ code }).capability)).rejects.toThrow();
  });
  it.each(Object.entries(currentValues).flatMap(([address, getters]) =>
    Object.keys(getters).map(name => `${address}:${name}`)))('rejects getter drift %s', async getter => {
    await expect(readCurrent(currentProvider({ getter }).capability)).rejects.toThrow();
  });
  it.each(current.factoryStorage)('rejects frozen Factory storage drift at slot %s', async storage => {
    await expect(readCurrent(currentProvider({ storage: Number(storage) }).capability)).rejects.toThrow();
  });
  it.each([{ network: true }, { networkAfter: true }, { genesis: true }, { genesisAfter: true }, { origin: true },
    { originAfter: true }, { reorg: true }, { session: 'code' }, { session: 'getter' },
    { session: 'final' }, { consistentBinding: true }, { malformedStorage: true },
    { missingBlock: true }, { wrongNumber: true }, { badTimestamp: true }] satisfies CurrentFault[])('rejects chain, canonical origin/head, lease or encoding drift %j', async fault => {
    await expect(readCurrent(currentProvider(fault).capability)).rejects.toThrow();
  });
  it('rejects a read before the attested deployment and retains the old default', async () => {
    await expect(readCurrentSharedPoolDexGraph({ capability: currentProvider().capability,
      blockNumber: BigInt(current.attestationBlock.number) - 1n, blockHash: currentHash, candidate: 'cheap-current' })).rejects.toThrow();
    await expect(readCurrentSharedPoolDexGraph({ capability: currentProvider().capability,
      blockNumber: currentNumber, blockHash: currentHash })).rejects.toThrow();
    expect((await read(provider().capability)).graph).toBe(m.graph);
  });
  it('rejects an unknown candidate or a capability for another chain before graph reads', async () => {
    const p = currentProvider();
    await expect(readCurrentSharedPoolDexGraph({ capability: p.capability, blockNumber: currentNumber,
      blockHash: currentHash, candidate: 'unknown' as never })).rejects.toThrow('Unknown');
    const capability = createDexV2ReadCapability({ provider: { request: p.request }, chainId: 1n, assertCurrent: () => {} });
    await expect(readCurrent(capability)).rejects.toThrow();
    expect(p.request).not.toHaveBeenCalled();
  });
});

describe('current shared-Pool graph read identity', () => {
  it('matches all 33 pinned deployment and receipt rows to the retained package', () => {
    const pkg = JSON.parse(retained('native-terminal-guard-2026-09-29-unsigned.package.json'));
    const journal = retained(`native-deployment-${m.packageSha256}.jsonl`).trim().split(/\r?\n/).map(line => JSON.parse(line));
    expect(createHash('sha256').update(JSON.stringify(pkg)).digest('hex')).toBe(m.packageSha256);
    expect(pkg.artifactGraphSha256).toBe(m.graph);
    expect(pkg.expectedCore.toLowerCase()).toBe(m.core);
    expect(pkg.release).toBe(m.releaseId);
    expect(pkg.market).toBe(m.marketId);
    expect(pkg.reviewedTokenSet).toBe(m.reviewedTokenSet);
    expect(pkg.tokenAddresses.map((x: string) => x.toLowerCase())).toEqual(m.tokens.map(([address]) => address));
    expect(pkg.tokenRuntimeHashes.map((x: string) => x.toLowerCase())).toEqual(m.tokens.map(([, hash]) => hash));
    const confirmed = journal.filter((row: { kind: string }) => row.kind === 'confirmed');
    expect(confirmed).toHaveLength(33);
    expect(pkg.calls.map((row: { index: number; name: string; predictedAddress: string }, i: number) => [
      row.name, row.predictedAddress.toLowerCase(), confirmed[i].runtimeHash.toLowerCase()
    ])).toEqual(m.runtimes);
  });

  it('reads pinned code and linked getters at one canonical block with no write authority', async () => {
    const p = provider();
    const result = await read(p.capability);
    expect(result).toMatchObject({ graph: m.graph, core: m.core, runtimeCount: 38, readyToSign: false,
      operationReadIdentity: { releaseId: m.releaseId, runtimeHash: runtime('ChainWhisperDexCore') } });
    expect(p.request.mock.calls.some(([call]) => call.method.startsWith('eth_send'))).toBe(false);
  });

  it.each([
    { code: m.core }, { code: at('ChainWhisperDexPoolWorkLibrary') },
    { getter: `${m.core}:releaseId` }, { getter: `${m.core}:marketId` },
    { getter: `${m.core}:inputToken` }, { getter: `${m.core}:inputRuntimeHash` },
    { getter: `${m.core}:fixedEngine` }, { getter: `${m.core}:terminalEvaluator` },
    { getter: `${m.core}:positionNFT` }, { getter: `${engine}:selectorRuntimeHash` },
    { getter: `${evaluator}:bindingCommitment` }, { getter: `${nft}:core` },
    { getter: `${at('ChainWhisperFixedEngineFactory')}:snapshotOwner` },
    { network: true }, { genesis: true }, { reorg: true }, { session: true }
  ])('rejects changed identity or session %j', async fault => {
    await expect(read(provider(fault).capability)).rejects.toThrow();
  });

  it.skipIf(process.env.CHAINWHISPER_READ_SHARED_POOL_TESTNET !== '1')(
    'checks the pinned graph on COTI Testnet with read-only RPC', async () => {
      let id = 0;
      const request = async ({ method, params }: { method: string; params?: unknown[] }) => {
        const response = await fetch('https://testnet.coti.io/rpc', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: params ?? [] })
        });
        if (!response.ok) throw new Error(`Testnet RPC HTTP ${response.status}`);
        const body = await response.json() as { result?: unknown; error?: { message?: string } };
        if (body.error || body.result === undefined) throw new Error(body.error?.message ?? 'Testnet RPC result is absent.');
        return body.result;
      };
      const head = await request({ method: 'eth_getBlockByNumber', params: ['latest', false] }) as { number: string; hash: string };
      const capability = createDexV2ReadCapability({ provider: { request }, chainId: 7082400n, assertCurrent: () => {} });
      const result = await readCurrentSharedPoolDexGraph({ capability, blockNumber: BigInt(head.number), blockHash: head.hash });
      expect(result).toMatchObject({ graph: m.graph, core: m.core, readyToSign: false });
      console.info(`Shared-Pool read-only Testnet block ${head.number} ${head.hash}`);
    }, 120_000
  );
});
