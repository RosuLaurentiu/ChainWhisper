import { AbiCoder, Interface, keccak256 } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import { makeHistoryFixture, HISTORY_FIXTURE_DAY } from '../../tests/fixtures/history.fixture';
import { CURRENT_DEX_DAILY_PRICE_SOURCE, readCurrentDexDailyPrice, readCurrentDexPublicReference } from './currentDexDailyPrice';
import { currentDexMarketReference, currentDexEstimatedReceive } from './currentDexMarketReference';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as candidate, type CurrentCheapDexCandidate } from './dexV2Deployment';
import { readCurrentDexDisplay } from './currentDexDisplay';

const runtimeHashes = vi.hoisted(() => new Map([
  ['0x6001', '0xdf5bb9ac50ee3bf8f554d9d80c192918eebe2e8b43491d957bd9494ab457cc14'],
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
