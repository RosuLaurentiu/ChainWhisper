import { AbiCoder, Interface, keccak256 } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import { makeHistoryFixture, HISTORY_FIXTURE_DAY } from '../../tests/fixtures/history.fixture';
import { CURRENT_DEX_DAILY_PRICE_SOURCE, readCurrentDexDailyPrice, readCurrentDexPublicReference } from './currentDexDailyPrice';
import { currentDexMarketReference, currentDexEstimatedReceive } from './currentDexMarketReference';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as candidate, type CurrentCheapDexCandidate } from './dexV2Deployment';
import { readCurrentDexDisplay } from './currentDexDisplay';
import { CURRENT_HISTORY_DEX_DAILY_PRICE_ARTIFACT } from './currentDexHistoryDailyPriceArtifact';
import { HISTORY_TESTNET_DEX_DAILY_PRICE_MANIFESTS } from './currentDexHistoryDailyPriceTestnet';

const runtimeHashes = vi.hoisted(() => new Map([
  ['0x6001', '0xa5a60403d5c4ab01cd2baddb94cefdcd108bc99d249f21c6e217be2187cb3d34'],
  ['0x6002', '0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0']
]));
vi.mock('@coti-io/coti-ethers', async importOriginal => {
  const actual = await importOriginal<typeof import('@coti-io/coti-ethers')>();
  return { ...actual, keccak256: (value: string) => runtimeHashes.get(value) ?? actual.keccak256(value) };
});

const referenceTypes = ['bytes32','bytes32','uint256','address','bytes32','bytes32','bytes32','bytes32','uint256','uint256','uint256','address','address','uint8','uint8','uint256','uint256','uint256','uint256','bytes32','bool'];
const referenceFixture = (options: { chainId?: string; codeFault?: string; observationFault?: (values: unknown[]) => unknown[]; malformed?: boolean; noncanonical?: boolean; reorg?: boolean } = {}) => {
  const coder = AbiCoder.defaultAbiCoder(), sourceApi = new Interface(['function poolReference(bytes32) view returns(bytes)']);
  const market = candidate.pairs[0], display = readCurrentDexDisplay(candidate).pairs.find(row => row.marketId === market.marketId)!;
  const [token0, token1] = display.tokens;
  const core = candidate.runtimes.find(([name]) => name === 'ChainWhisperDexCore')!;
  const headTimestamp = 1_800_000_000n, sampleTimestamp = headTimestamp - 1n;
  let values: unknown[] = [CURRENT_DEX_DAILY_PRICE_SOURCE.schema, CURRENT_DEX_DAILY_PRICE_SOURCE.policy, candidate.chainId,
    candidate.core, core[2], candidate.releaseId, market.marketId,
    keccak256(coder.encode(['uint256','address','address'], [candidate.chainId, token0.address, token1.address])),
    market.canonicalId, 1n, 1n, token0.address, token1.address, token0.decimals, token1.decimals,
    2n * 10n ** 18n, sampleTimestamp, 199n, 3n, `0x${'77'.repeat(32)}`, true];
  if (options.observationFault) values = options.observationFault(values);
  const encoded = coder.encode(referenceTypes, values);
  const observation = options.noncanonical ? `${encoded.slice(0,-64)}${'2'.padStart(64,'0')}` : encoded;
  let headReads = 0;
  const provider = { request: async ({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> => {
    if (method === 'eth_chainId') return options.chainId ?? `0x${BigInt(candidate.chainId).toString(16)}`;
    if (method === 'eth_getBlockByNumber') {
      const number = String(params[0]);
      if (number === 'latest') return { number: '0xc8', hash: `0x${'88'.repeat(32)}`, timestamp: `0x${headTimestamp.toString(16)}` };
      if (number === '0x0') return { number, hash: candidate.genesisHash, timestamp: '0x1' };
      if (number === '0xc8') {
        headReads++;
        return { number, hash: options.reorg && headReads > 1 ? `0x${'99'.repeat(32)}` : `0x${'88'.repeat(32)}`, timestamp: `0x${headTimestamp.toString(16)}` };
      }
      if (number === '0xc7') return { number, hash: `0x${'77'.repeat(32)}`, timestamp: `0x${sampleTimestamp.toString(16)}` };
    }
    if (method === 'eth_getCode') {
      const address = String(params[0]).toLowerCase();
      if (address === candidate.core.toLowerCase()) return options.codeFault === 'core' ? '0x6002' : '0x6001';
      if (candidate.tokens.some(([token]) => token.toLowerCase() === address)) return options.codeFault === 'token' ? '0x6001' : '0x6002';
    }
    if (method === 'eth_call') {
      if (options.malformed) return sourceApi.encodeFunctionResult('poolReference', ['0x1234']);
      return sourceApi.encodeFunctionResult('poolReference', [observation]);
    }
    throw new Error(`Unexpected public RPC method: ${method}`);
  } };
  return { provider, display, market, headTimestamp, observation };
};

// Real reference and chart readers, one synthetic current-candidate RPC identity.
const combinedFixture = () => {
  const base = referenceFixture(), api = new Interface(CURRENT_HISTORY_DEX_DAILY_PRICE_ARTIFACT.abi);
  const manifest = { ...HISTORY_TESTNET_DEX_DAILY_PRICE_MANIFESTS[0],
    runtimeHash: keccak256(CURRENT_HISTORY_DEX_DAILY_PRICE_ARTIFACT.deployedBytecode),
    deploymentBlock: '70', deploymentBlockHash: `0x${'66'.repeat(32)}` };
  const values: Record<string, unknown> = { SOURCE_GRAPH: `0x${manifest.sourceGraph}`,
    SCHEMA: CURRENT_DEX_DAILY_PRICE_SOURCE.schema, POLICY: CURRENT_DEX_DAILY_PRICE_SOURCE.policy,
    source: manifest.source, sourceRuntime: manifest.sourceRuntimeHash, sourceChain: manifest.chainId,
    releaseId: manifest.releaseId, market: manifest.market, pair: manifest.pair, canonicalId: manifest.canonicalId,
    token0: manifest.token0, token1: manifest.token1, decimals0: manifest.decimals0, decimals1: manifest.decimals1, MAX_PAGE: 32 };
  const requests: Array<{ method: string; params?: unknown[] }> = [];
  let intercept: ((args: { method: string; params?: unknown[] }) => unknown | Promise<unknown>) | undefined;
  const provider = { request: async (args: { method: string; params?: unknown[] }): Promise<unknown> => {
    requests.push(args); const replacement = await intercept?.(args);
    if (replacement !== undefined) return replacement;
    const params = args.params ?? [];
    if (args.method === 'eth_getBlockByNumber' && params[0] === '0x46') return {
      number: '0x46', hash: manifest.deploymentBlockHash, timestamp: `0x${(base.headTimestamp - 1_000n).toString(16)}` };
    if (args.method === 'eth_getTransactionReceipt') return { status: '0x1', transactionHash: manifest.deploymentTransactionHash,
      blockNumber: '0x46', blockHash: manifest.deploymentBlockHash, contractAddress: manifest.address, from: manifest.deployer, to: null };
    if (args.method === 'eth_getCode' && params[0] === manifest.address) return CURRENT_HISTORY_DEX_DAILY_PRICE_ARTIFACT.deployedBytecode;
    if (args.method === 'eth_call') {
      const call = params[0] as { to: string; data: string };
      if ([manifest.token0, manifest.token1].includes(call.to)) return AbiCoder.defaultAbiCoder().encode(['uint8'], [6]);
      if (call.to === manifest.address) {
        const parsed = api.parseTransaction({ data: call.data })!;
        if (parsed.name !== 'getDays') return api.encodeFunctionResult(parsed.name, [values[parsed.name]]);
        const zero = referenceTypes.map(type => type === 'bool' ? false : type.startsWith('uint') ? 0n
          : `0x${'00'.repeat(type === 'address' ? 20 : 32)}`);
        return api.encodeFunctionResult('getDays', [Array.from({ length: Number(parsed.args[1]) }, (_, index) =>
          [parsed.args[0] + BigInt(index), false, zero, 0n, 0n])]);
      }
    }
    return base.provider.request(args);
  } };
  const constructorReads = () => requests.filter(args => args.method === 'eth_call' &&
    (args.params?.[0] as { to: string }).to === manifest.address &&
    api.parseTransaction({ data: (args.params![0] as { data: string }).data })!.name !== 'getDays').length;
  const readReference = (assertCurrent?: () => void) => readCurrentDexPublicReference({ provider, candidate,
    pair: manifest.symbols, finalityLagBlocks: 0, assertCurrent });
  const readChart = (assertCurrent?: () => void) => readCurrentDexDailyPrice({ provider, manifest, finalityLagBlocks: 0, assertCurrent });
  return { provider, manifest, requests, constructorReads, readReference, readChart,
    intercept: (value?: typeof intercept) => { intercept = value; } };
};

describe('shared current DEX reference and chart reads', () => {
  it('observes redacted candidate-only read phases without changing requests, validation or errors', async () => {
    const writes: Array<{ name: string; value: Record<string, unknown> }> = [];
    const setAttribute = vi.fn((name: string, value: string) => { writes.push({ name, value: JSON.parse(value) }); });
    vi.stubGlobal('document', { documentElement: { setAttribute } });
    vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'production');
    try {
      const baseline = combinedFixture();
      const expected = await Promise.all([baseline.readReference(), baseline.readChart()]);
      expect(writes).toHaveLength(0);
      vi.stubEnv('MODE', 'coti-testnet-candidate');
      const f = combinedFixture(); let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      f.intercept(async args => { if (args.method === 'eth_chainId') await held; });
      const pending = Promise.all([f.readReference(), f.readChart()]);
      await vi.waitFor(() => expect(writes.length).toBe(2));
      expect(writes.map(row => row.name).sort()).toEqual(['data-dex-history-read', 'data-dex-reference-read']);
      for (const row of writes) expect(row.value).toMatchObject({ ordinal: 1, method: 'eth_chainId', state: 'pending' });
      release();
      const actual = await pending;
      expect(actual).toEqual(expected);
      expect(f.requests.length).toBe(baseline.requests.length);
      for (const name of ['data-dex-reference-read', 'data-dex-history-read']) {
        expect(writes.filter(row => row.name === name).slice(-1)[0].value).toMatchObject({ method: 'validation', state: 'completed' });
      }
      const rpcError = new Error(`Synthetic read failed with redacted fixture ${candidate.core}`);
      const failed = combinedFixture(); failed.intercept(() => { throw rpcError; });
      await expect(failed.readReference()).rejects.toBe(rpcError);
      expect(writes.slice(-1)[0].value).toMatchObject({ method: 'eth_chainId', state: 'failed', ordinal: 1 });
      await expect(failed.readChart()).rejects.toMatchObject({ kind: 'rpc' });
      expect(writes.slice(-1)[0].value).toMatchObject({ method: 'eth_chainId', state: 'failed', ordinal: 1 });
      await expect(readCurrentDexDailyPrice({ provider: f.provider, manifest: f.manifest, count: 0 })).rejects.toThrow('bound');
      expect(writes.slice(-1)[0].value).toMatchObject({ method: 'validation', state: 'failed', ordinal: 0 });
      for (const { value } of writes) {
        expect(Object.keys(value).sort()).toEqual(['at', 'attemptStartedAt', 'method', 'ordinal', 'state']);
        expect(Number.isSafeInteger(value.attemptStartedAt)).toBe(true);
        expect(Number.isSafeInteger(value.at)).toBe(true);
        expect(Number(value.at)).toBeGreaterThanOrEqual(Number(value.attemptStartedAt));
        expect(['pending', 'completed', 'failed']).toContain(value.state);
        expect(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getTransactionReceipt', 'eth_call', 'validation']).toContain(value.method);
        expect(JSON.stringify(value)).not.toContain('0x');
        expect(JSON.stringify(value)).not.toContain('Synthetic');
      }
      setAttribute.mockImplementation(() => { throw new Error('Synthetic DOM failure'); });
      const noDom = combinedFixture();
      expect(await Promise.all([noDom.readReference(), noDom.readChart()])).toEqual(expected);
      expect(noDom.requests.length).toBe(baseline.requests.length);
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  it('reuses accepted recorder immutable bindings while fresh references and canonical fences remain independent', async () => {
    const f = combinedFixture();
    await Promise.all([f.readReference(), f.readChart()]);
    const cold = f.requests.length;
    expect(f.constructorReads()).toBe(15);
    f.requests.length = 0;
    await Promise.all([f.readReference(), f.readChart()]);
    const warm = f.requests.length;
    console.info('Local real-reader RPC counts', { cold, warm, saved: cold - warm });
    expect(f.constructorReads()).toBe(0);
    expect(cold - warm).toBe(15);
    expect(f.requests.filter(args => args.method === 'eth_chainId')).toHaveLength(2);
    expect(f.requests.filter(args => args.method === 'eth_getBlockByNumber' && args.params?.[0] === 'latest')).toHaveLength(2);
    expect(f.requests.filter(args => args.method === 'eth_getTransactionReceipt')).toHaveLength(1);
    expect(f.requests.filter(args => args.method === 'eth_getCode')).toHaveLength(7);
  });

  it.each([false, true])('joins one identical pinned read without retaining its failure=%s or sharing consumer authority', async failure => {
    const f = combinedFixture();
    let release!: () => void, coreStarted!: () => void, recorderStarted!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const firstCore = new Promise<void>(resolve => { coreStarted = resolve; });
    const recorder = new Promise<void>(resolve => { recorderStarted = resolve; });
    f.intercept(async args => {
      if (args.method === 'eth_getCode' && String(args.params?.[0]).toLowerCase() === candidate.core.toLowerCase()) {
        coreStarted(); await held;
        if (failure) throw new Error('Held synthetic RPC failed.');
      }
      if (args.method === 'eth_getCode' && args.params?.[0] === f.manifest.address) recorderStarted();
    });
    let current = true;
    const reference = f.readReference(() => { if (!current) throw new Error('Reference scope replaced.'); });
    await firstCore;
    const chart = f.readChart();
    const results = Promise.allSettled([reference, chart]);
    await recorder;
    for (let turn = 0; turn < 12; turn++) await Promise.resolve();
    const coreReads = () => f.requests.filter(args => args.method === 'eth_getCode' && String(args.params?.[0]).toLowerCase() === candidate.core.toLowerCase()).length;
    expect(coreReads()).toBe(1);
    if (!failure) current = false;
    release();
    const settled = await results;
    expect(settled[0].status).toBe('rejected');
    expect(settled[1].status).toBe(failure ? 'rejected' : 'fulfilled');
    f.intercept();
    await f.readReference();
    expect(coreReads()).toBe(2);
    if (failure) {
      f.requests.length = 0;
      await f.readChart();
      expect(f.constructorReads()).toBe(15);
    }
  });

  it('revalidates recorder bindings for another provider and a changed manifest', async () => {
    const f = combinedFixture(); await f.readChart();
    f.requests.length = 0;
    await readCurrentDexDailyPrice({ provider: { request: f.provider.request }, manifest: f.manifest, finalityLagBlocks: 0 });
    expect(f.constructorReads()).toBe(15);
    f.requests.length = 0;
    await expect(readCurrentDexDailyPrice({ provider: f.provider, manifest: {
      ...f.manifest, releaseId: `0x${'55'.repeat(32)}`
    }, finalityLagBlocks: 0 })).rejects.toThrow('constructor binding');
    expect(f.constructorReads()).toBeGreaterThan(0);
  });

  it('captures manifest identity before an asynchronous read can change its caller-owned object', async () => {
    const f = combinedFixture(), supplied = { ...f.manifest, symbols: [...f.manifest.symbols] as [string, string] };
    f.intercept(args => {
      if (args.method === 'eth_chainId') { supplied.releaseId = `0x${'55'.repeat(32)}`; supplied.symbols[0] = 'changed'; }
    });
    const snapshot = await readCurrentDexDailyPrice({ provider: f.provider, manifest: supplied, finalityLagBlocks: 0 });
    expect(snapshot.manifest.releaseId).toBe(f.manifest.releaseId);
    expect(snapshot.manifest.symbols).toEqual(f.manifest.symbols);
    expect(Object.isFrozen(snapshot.manifest.symbols)).toBe(true);
    f.intercept(); f.requests.length = 0;
    await f.readChart(); expect(f.constructorReads()).toBe(0);
  });

  it.each(['reference', 'chart'] as const)('invalidates accepted recorder bindings after a %s canonical fence fails', async reader => {
    const f = combinedFixture(); await f.readChart();
    let sourceRead = false;
    f.intercept(args => {
      if (args.method === 'eth_call' && (args.params?.[0] as { to: string }).to.toLowerCase() === candidate.core.toLowerCase()) sourceRead = true;
      if (sourceRead && args.method === 'eth_getBlockByNumber' && args.params?.[0] === '0xc8') {
        return { number: '0xc8', hash: `0x${'99'.repeat(32)}`, timestamp: `0x${1_800_000_000n.toString(16)}` };
      }
    });
    await expect(reader === 'reference' ? f.readReference() : f.readChart()).rejects.toMatchObject({ kind: 'reorg' });
    f.intercept(); f.requests.length = 0;
    await f.readChart();
    expect(f.constructorReads()).toBe(15);
  });

  it('checks exact recorder code again before it can reuse immutable bindings', async () => {
    const f = combinedFixture(); await f.readChart();
    f.intercept(args => args.method === 'eth_getCode' && args.params?.[0] === f.manifest.address ? '0x6002' : undefined);
    await expect(f.readChart()).rejects.toThrow('runtime');
    f.intercept(); f.requests.length = 0;
    await f.readChart(); expect(f.constructorReads()).toBe(15);
  });

  it('acquires the new head and reports an aged current reference even with warm recorder bindings', async () => {
    const f = combinedFixture(); await f.readChart(); f.requests.length = 0;
    f.intercept(args => args.method === 'eth_getBlockByNumber' && ['latest', '0xc9'].includes(String(args.params?.[0]))
      ? { number: '0xc9', hash: `0x${'99'.repeat(32)}`, timestamp: `0x${1_800_000_121n.toString(16)}` } : undefined);
    const [reference, chart] = await Promise.all([f.readReference(), f.readChart()]);
    for (const snapshot of [reference, chart]) {
      expect(snapshot.atBlock.number).toBe('201');
      expect(snapshot.currentReference).toBe('stale');
      expect(snapshot.currentObservation).toBeUndefined();
    }
    expect(f.constructorReads()).toBe(0);
    expect(f.requests.filter(args => args.method === 'eth_getCode')).toHaveLength(7);
  });
});

describe('authenticated public market reference',()=>{
  it('estimates both directions from the verified marginal rate with exact token decimals',async()=>{
    const f=makeHistoryFixture('empty'),snapshot=await readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0,count:1});
    const pair=f.manifest.symbols,now=HISTORY_FIXTURE_DAY*86400n+100n;
    const reference=currentDexMarketReference({status:'empty',snapshot},pair,now);
    const args={reference,pair,now,input:10_000_000n,inputDecimals:6,outputDecimals:6};
    expect(currentDexEstimatedReceive({...args,inputIndex:0})).toBe('20.0');
    expect(currentDexEstimatedReceive({...args,inputIndex:1})).toBe('5.0');
    expect(currentDexEstimatedReceive({...args,inputIndex:0,input:1_234_567n,outputDecimals:18})).toBe('2.469134');
    expect(currentDexEstimatedReceive({...args,inputIndex:1,input:1n})).toBe('<0.000001');
    expect(currentDexEstimatedReceive({...args,inputIndex:1,input:3n})).toBe('0.000001');
    const reversedPair=[pair[1],pair[0]] as const;
    const reversed=currentDexMarketReference({status:'empty',snapshot},reversedPair,now);
    expect(currentDexEstimatedReceive({...args,reference:reversed,pair:reversedPair,inputIndex:0})).toBe('5.0');
    for(const edited of [{reference:undefined},{reference:{status:'stale' as const}},{reference:{status:'loading' as const}},
      {reference:{...reference}},{pair:reversedPair},{now:now+111n},{now:now-11n},{input:0n},{input:-1n},{input:1n<<256n}]){
      expect(currentDexEstimatedReceive({...args,inputIndex:0,...edited})).toBeNull();
    }
  });
  it('uses the live observation independently of missing historical samples and preserves canonical units',async()=>{
    const f=makeHistoryFixture('empty'),snapshot=await readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0,count:1});
    const view={status:'empty' as const,snapshot},now=HISTORY_FIXTURE_DAY*86400n+100n;
    expect(snapshot.slots.every(s=>s.point===null)).toBe(true);
    expect(currentDexMarketReference(view,f.manifest.symbols,now)).toMatchObject({status:'available',price:2,revision:'3'});
    expect(currentDexMarketReference(view,[f.manifest.symbols[1],f.manifest.symbols[0]],now)).toMatchObject({status:'available',price:0.5});
    expect(currentDexMarketReference(view,['wrong',f.manifest.symbols[1]],now).status).toBe('unavailable');
    expect(currentDexMarketReference({...view,snapshot:{...snapshot}},f.manifest.symbols,now).status).toBe('unavailable');
    expect(currentDexMarketReference(view,f.manifest.symbols,now+111n).status).toBe('stale');
    expect(currentDexMarketReference(view,f.manifest.symbols,now-11n).status).toBe('stale');
  });
  it.each(['stale','suppressed','unobserved'] as const)('does not replace %s current state with historical prices',async mode=>{
    const f=makeHistoryFixture(mode),snapshot=await readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0});
    expect(snapshot.slots.some(s=>s.point!==null)).toBe(true);
    expect(currentDexMarketReference({status:'ready',snapshot},f.manifest.symbols,HISTORY_FIXTURE_DAY*86400n+100n).status).toBe(mode==='stale'?'stale':'unavailable');
  });
});

describe('Core-backed public market reference', () => {
  it('reads the exact 7b67 HBR/BCN pair and preserves forward and reverse display orientation', async () => {
    const f = referenceFixture(), snapshot = await readCurrentDexPublicReference({ provider: f.provider, candidate, pair: ['HBR', 'BCN'], finalityLagBlocks: 0 });
    const now = f.headTimestamp;
    expect(snapshot).toMatchObject({ symbols: ['HBR', 'BCN'], currentReference: 'available', currentObservation: { priceE18: '2000000000000000000', sampledBlock: '199', revision: '3' } });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(currentDexMarketReference({ status: 'reference', snapshot }, ['HBR', 'BCN'], now)).toMatchObject({ status: 'available', price: 2 });
    expect(currentDexMarketReference({ status: 'reference', snapshot }, ['BCN', 'HBR'], now)).toMatchObject({ status: 'available', price: 0.5 });
    expect(currentDexMarketReference({ status: 'reference', snapshot: { ...snapshot } }, ['HBR', 'BCN'], now).status).toBe('unavailable');
    expect(currentDexMarketReference({ status: 'reference', snapshot }, ['HBR', 'BCN'], now + 120n).status).toBe('stale');
  });

  it('rejects a forged candidate and a pair outside its maintained display scope', async () => {
    const f = referenceFixture(); let calls = 0;
    const provider = { request: async (args: { method: string; params?: unknown[] }) => { calls++; return f.provider.request(args); } };
    await expect(readCurrentDexPublicReference({ provider, candidate: { ...candidate, graph: `0x${'00'.repeat(32)}` } as CurrentCheapDexCandidate, pair: ['HBR', 'BCN'] })).rejects.toThrow('candidate changed');
    await expect(readCurrentDexPublicReference({ provider, candidate, pair: ['HBR', 'unknown'] })).rejects.toThrow('outside');
    expect(calls).toBe(0);
  });

  it.each([
    ['network', { chainId: '0x1' }],
    ['Core runtime', { codeFault: 'core' }],
    ['token runtime', { codeFault: 'token' }],
    ['source identity', { observationFault: (values: unknown[]) => { values[5] = `0x${'aa'.repeat(32)}`; return values; } }],
    ['sample block time', { observationFault: (values: unknown[]) => { values[16] = 1_799_999_900n; return values; } }],
    ['canonical observation', { malformed: true }],
    ['noncanonical bool', { noncanonical: true }],
    ['canonical reorg', { reorg: true }]
  ] as const)('rejects changed %s evidence', async (_name, options) => {
    const f = referenceFixture(options as Parameters<typeof referenceFixture>[0]);
    await expect(readCurrentDexPublicReference({ provider: f.provider, candidate, pair: ['HBR', 'BCN'], finalityLagBlocks: 0 })).rejects.toThrow();
  });
  it.each(['stale','unobserved','suppressed-or-changed'] as const)('keeps %s source data unavailable without a substitute price',async mode=>{
    const f=referenceFixture({observationFault:values=>{
      if(mode==='stale')values[16]=1_799_999_879n;
      if(mode==='unobserved')values[16]=0n;
      if(mode==='suppressed-or-changed')values[20]=false;
      return values;
    }});
    const snapshot=await readCurrentDexPublicReference({provider:f.provider,candidate,pair:['HBR','BCN'],finalityLagBlocks:0});
    expect(snapshot.currentReference).toBe(mode);expect(snapshot.currentObservation).toBeUndefined();
    expect(currentDexMarketReference({status:'reference',snapshot},['HBR','BCN'],f.headTimestamp).status).toBe(mode==='stale'?'stale':'unavailable');
  });
});
