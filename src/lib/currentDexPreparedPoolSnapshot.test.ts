import { createRequire } from 'node:module';
import { AbiCoder, Interface, keccak256, toBeHex, type JsonRpcSigner } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import type { CotiReadProvider } from './appShared';
import { STAGED_PREPARED_DEX_CANDIDATE as candidate } from './dexV2Deployment';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { readPreparedDexMarketRegistry, type DexV2ReadCapability } from './dexV2Chain';
import { currentPoolPositionAbi, currentPoolNftAbi } from './currentDexPoolPosition';
import { currentTokenFundingAbi } from './currentDexTokenFunding';
import { encodePreparedPoolCreation, encodePreparedPoolFundingPreview } from './currentDexPoolFunding';
import { PREPARED_POOL_LAYOUT as layout, preparedPoolPositionStorageBase, preparedPoolStoredEnvelopes,
  checkPreparedPoolPositionValues, createPreparedOwnerPoolSnapshotReader, checkPreparedPoolFinancialTransition,
  checkPreparedPoolSnapshotOnlyChange, type PreparedPoolStoredState } from './currentDexPreparedPoolSnapshot';

vi.mock('./dexV2Chain', () => ({ readPreparedDexMarketRegistry: vi.fn() }));
vi.mock('./privateUint256', () => ({ decryptPrivateUint256Output: (_signer: unknown, cipher: { ciphertextLow: bigint }) => cipher.ciphertextLow }));
const word = (n: bigint | number) => toBeHex(n, 32), zero = word(0), owner = `0x${'11'.repeat(20)}`;
const block = { number: 100n, hash: word(100) }, transactionHash = word(77), context = word(44);
const coder = AbiCoder.defaultAbiCoder(), map = (key: bigint | string, at: bigint, type = 'uint256') => BigInt(keccak256(coder.encode([type, 'uint256'], [key, at])));
const empty = (n: number) => Array.from({ length: n }, () => zero);
const eventAbi = new Interface(['event PoolSnapshotRefreshed(uint256 indexed positionId,bytes32 context,(uint256 ciphertextHigh,uint256 ciphertextLow)[10] userValues)',
  'event SharedClaimCreated(uint256 indexed positionId)']);
const nft = candidate.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1];
type LayoutField = { label: string; slot: string; type: string; offset: number };
type Layout = { storage: LayoutField[]; types: Record<string, { members: LayoutField[]; value: string; numberOfBytes: string }> };

const fixture = (closed = false, fund = false, withLimits: 0 | 51 | 64 = 0,
  selectedCandidate: import('./currentDexPreparedScope').PreparedDexCandidate = candidate) => {
  const candidate = selectedCandidate, nft = candidate.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1];
  const slots = new Map<string, string>(), at = (address: string, slot: bigint) => `${address.toLowerCase()}:${slot}`;
  const put = (address: string, slot: bigint, value: string) => slots.set(at(address, slot), value);
  const get = (address: string, slot: bigint) => slots.get(at(address, slot)) ?? zero;
  put(candidate.core, 11n, word(fund ? 49 : 48)); put(candidate.core, 12n, word(3));
  const selectedId = fund ? 49n : 8n, pair = candidate.pairs[0];
  const markets = candidate.pairs.map(p => ({ marketId: p.marketId, canonicalId: BigInt(p.canonicalId), registryRevision: 7n,
    marketRevision: 1n, enabled: true as const, token0: p.tokens[0], token1: p.tokens[1], engine: p.engine, poolTerms: p.poolTerms,
    companions: p.companions.map(([role, address, runtimeHash]) => ({ role, address, runtimeHash })) }));
  vi.mocked(readPreparedDexMarketRegistry).mockImplementation(async () => ({ graph: candidate.graph, packageSha256: candidate.packageSha256,
    chainId: BigInt(candidate.chainId), core: candidate.core, releaseId: candidate.releaseId, attestationSha256: candidate.attestationSha256,
    block: { ...block, timestamp: 1n }, registryRevision: 7n, markets, tokens: [], readyToSign: false as const }));
  const setClaim = (market: string, id: bigint, claim: readonly string[]) => claim.forEach((v, i) => put(candidate.core, preparedPoolPositionStorageBase(market, id) + BigInt(i), v));
  candidate.pairs.forEach((p, index) => {
    const base = map(p.marketId, 1n, 'bytes32'), raw = empty(71);
    [raw[0], raw[1], raw[2], raw[3], raw[4], raw[5]] = [candidate.releaseId, p.marketId, word(BigInt(p.tokens[0])), word(BigInt(p.tokens[1])), word(BigInt(nft)), word(BigInt(p.poolTerms))];
    for (let j = 0; j < 7; j++) {
      const anchorId = BigInt(index * 8 + j + 1), anchor = empty(64); raw[18 + j] = word(anchorId);
      anchor[0] = word(1); anchor[4] = word(1); anchor[62] = word(j); setClaim(p.marketId, anchorId, anchor);
    }
    raw.forEach((v, i) => put(candidate.core, base + BigInt(i), v));
    const id = BigInt(index * 8 + 8), claim = empty(64);
    claim[0] = word(index === 0 && closed ? 4 : 1); claim[4] = word(1); claim[5] = word(1); claim[6] = word(1); claim[7] = word(1);
    claim[13] = context; claim[59] = word(1);
    const values = [200n, 101n, index === 0 && closed ? 0n : 50n, 100n, 0n, 0n, 0n, 0n, 0n, BigInt(index)];
    values.forEach((v, i) => { claim[16 + i * 4] = word(i + 1); claim[17 + i * 4] = word(v); });
    if (index === 0 && closed) claim[12] = word(BigInt(owner));
    setClaim(p.marketId, id, claim); put(candidate.core, map(id, 18n), p.marketId);
    put(nft, map(id, 2n), index === 0 && closed ? zero : word(BigInt(owner))); put(nft, map(id, 6n), word(1));
  });
  if (fund) {
    const source = Array.from({ length: 64 }, (_, i) => get(candidate.core, preparedPoolPositionStorageBase(pair.marketId, 8n) + BigInt(i)));
    setClaim(pair.marketId, selectedId, source); put(candidate.core, map(selectedId, 18n), pair.marketId);
    put(nft, map(selectedId, 2n), word(BigInt(owner))); put(nft, map(selectedId, 6n), word(1));
  }
  if (withLimits) {
    for (let id = 49n; id <= BigInt(withLimits); id++) {
      put(candidate.core, map(id, 18n), pair.marketId);
      put(nft, map(id, 2n), word(BigInt(owner))); put(nft, map(id, 6n), word(1));
      if (![50n, 51n, 64n].includes(id)) {
        const raw = Array.from({ length: 64 }, (_, i) => get(candidate.core, preparedPoolPositionStorageBase(pair.marketId, 8n) + BigInt(i)));
        setClaim(pair.marketId, id, raw); continue;
      }
      const sourceId = id === 50n ? 43n : id === 51n ? 44n : 45n;
      const raw = empty(36), engine = empty(39);
      const identity = [1n, sourceId - 43n, 1n, id, sourceId, 1n, 1n, sourceId * 2n, sourceId * 2n + 1n, 1n, 1n, 1n];
      identity.forEach((v, i) => { raw[i] = word(v); engine[i] = word(v); });
      raw[13] = word(123); engine[16] = word(456);
      raw.forEach((v, i) => put(candidate.core, map(sourceId, 20n) + BigInt(i), v));
      engine.forEach((v, i) => put(pair.engine, map(sourceId, 9n) + BigInt(i), v));
      put(candidate.core, map(id, 19n), word(sourceId)); put(pair.engine, map(id, 4n), word(sourceId));
      put(pair.engine, map(1n, map(sourceId, 12n)), word(1));
    }
    put(candidate.core, 11n, word(withLimits)); put(candidate.core, 16n, word(withLimits === 64 ? 45 : 44));
    put(candidate.core, map(pair.marketId, 1n, 'bytes32') + 54n, word(1)); put(pair.engine, 8n, word(1));
  }
  put(nft, map(owner, 3n, 'address'), word(fund ? 7 : closed ? 5 : 6));
  const claim = () => Array.from({ length: 64 }, (_, i) => get(candidate.core, preparedPoolPositionStorageBase(pair.marketId, selectedId) + BigInt(i)));
  let data = currentPoolPositionAbi.encodeFunctionData('poolSnapshot', [selectedId]);
  let logs: { address: string; topics: string[]; data: string }[] = [{ address: candidate.core, ...eventAbi.encodeEventLog(eventAbi.getEvent('PoolSnapshotRefreshed')!, [selectedId, context, preparedPoolStoredEnvelopes(claim())]) }];
  if (fund) {
    const signature = `0x${'11'.repeat(65)}`, narrow = (ciphertext: bigint) => ({ ciphertext, signature }), wide = { ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature };
    const inputs = [narrow(1n), wide, wide, ...Array.from({ length: 10 }, () => narrow(1n))];
    data = encodePreparedPoolCreation(pair.marketId, encodePreparedPoolFundingPreview(pair.marketId, 0n, inputs), context, inputs);
    logs = [{ address: candidate.core, ...eventAbi.encodeEventLog(eventAbi.getEvent('SharedClaimCreated')!, [selectedId]) },
      { address: nft, ...currentPoolNftAbi.encodeEventLog(currentPoolNftAbi.getEvent('Transfer')!, [toBeHex(0n, 20), owner, selectedId]) }];
  }
  const tx = { hash: transactionHash, chainId: BigInt(candidate.chainId), from: owner, to: candidate.core, value: 0n, data,
    nonce: 0, gasLimit: 100_000_000n, blockNumber: Number(block.number), blockHash: block.hash };
  const receipt = { hash: transactionHash, from: owner, to: candidate.core, status: 1, blockNumber: Number(block.number), blockHash: block.hash, logs };
  let revoked = false, wrongOwner = false, reorg = false;
  const signer = { getAddress: async () => wrongOwner ? nft : owner } as unknown as JsonRpcSigner;
  const provider = {
    getTransaction: async () => tx, getTransactionReceipt: async () => receipt,
    send: async (method: string, params: unknown[]) => {
      if (method === 'eth_getStorageAt') return get(String(params[0]), BigInt(params[1] as string));
      if (method === 'eth_getBlockByNumber') return { number: '0x64', hash: reorg ? word(101) : block.hash, transactions: [transactionHash] };
      if (method === 'eth_getTransactionByHash') return { ...tx, chainId: toBeHex(tx.chainId).replace(/^0x0/, '0x'), value: '0x0', input: tx.data,
        nonce: '0x0', gas: '0x5f5e100', blockNumber: '0x64', transactionIndex: '0x0' };
      if (method === 'eth_getTransactionReceipt') return { ...receipt, transactionHash, status: '0x1', blockNumber: '0x64', transactionIndex: '0x0' };
      if (method === 'eth_call') {
        const input = params[0] as { to: string; data: string };
        if (input.to.toLowerCase() === nft) return currentPoolNftAbi.encodeFunctionResult('ownerOf', [owner]);
        if (candidate.tokens.some(([token]) => token === input.to.toLowerCase())) {
          const method = currentTokenFundingAbi.parseTransaction({ data: input.data })!.name;
          if (method === 'balanceOf') {
            const base = map(owner, 4n, 'address');
            return currentTokenFundingAbi.encodeFunctionResult(method, [[BigInt(get(input.to, base + 2n)), BigInt(get(input.to, base + 3n))]]);
          }
          if (method === 'allowance') return currentTokenFundingAbi.encodeFunctionResult(method, [[[0n, 0n], [0n, 0n], [0n, 0n]]]);
          throw Error(`Unexpected token read ${method}`);
        }
        expect(input.data.slice(0, 10)).toBe(currentPoolPositionAbi.getFunction('poolPublicState')!.selector);
        const c = claim();
        return currentPoolPositionAbi.encodeFunctionResult('poolPublicState', [[BigInt(c[0]), 0n, 0n, 0n, ...c.slice(4, 8).map(BigInt), c[13]]]);
      }
      throw Error(method);
    }
  } as unknown as CotiReadProvider;
  const reader = createPreparedOwnerPoolSnapshotReader({ signer, owner, candidate, marketId: pair.marketId, readCapability: {} as DexV2ReadCapability,
    provider, guard: async () => { if (revoked) throw Error('lease revoked'); }, attest: async () => {} });
  return { reader, signer, provider, pair, selectedId, claim, tx, receipt, slots, put, get,
    revoke: () => { revoked = true; }, wrongOwner: () => { wrongOwner = true; }, reorg: () => { reorg = true; } };
};

describe('prepared Pool source-bound storage and authenticated producers', () => {
  it('reads an authenticated owner snapshot without scanning other positions or granting action authority',async()=>{
    const f=fixture(),send=f.provider.send.bind(f.provider);let storageReads=0;
    f.provider.send=async(method,params)=>{if(method==='eth_getStorageAt')storageReads++;return send(method,params);};
    const snapshot=await f.reader.readSnapshot(8n,transactionHash);
    expect(snapshot.amounts.shares).toBe(50n);expect(storageReads).toBeLessThan(100);
    await expect(f.reader.current(snapshot,snapshot.block)).rejects.toThrow('session');
    f.reorg();await expect(f.reader.readSnapshot(8n,transactionHash)).rejects.toThrow();
  });
  it.each(['envelope','context','owner','lease','event','market'] as const)('rejects %s drift in the display-only snapshot',async fault=>{
    const f=fixture(),base=preparedPoolPositionStorageBase(f.pair.marketId,8n);
    if(fault==='envelope')f.put(candidate.core,base+17n,word(999));
    if(fault==='context')f.put(candidate.core,base+13n,word(999));
    if(fault==='owner')f.put(nft,map(8n,2n),word(999));
    if(fault==='lease')f.revoke();
    if(fault==='event')f.receipt.logs[0].data+='00';
    if(fault==='market')f.put(candidate.core,map(8n,18n),candidate.pairs[1].marketId);
    await expect(f.reader.readSnapshot(8n,transactionHash)).rejects.toThrow();
  });
  it('reuses only the freshly issued canonical block without a second storage scan',async()=>{
    const f=fixture(),send=f.provider.send.bind(f.provider);let storageReads=0;
    f.provider.send=async(method,params)=>{if(method==='eth_getStorageAt')storageReads++;return send(method,params);};
    const producer=await f.reader.issue(8n,'snapshot',transactionHash),afterIssue=storageReads;
    expect(afterIssue).toBeGreaterThan(100);
    await expect(f.reader.current(producer,producer.block,true)).resolves.toBe(producer);
    expect(storageReads).toBe(afterIssue);
    await expect(f.reader.current(producer,{...producer.block,number:producer.block.number+1n},true)).rejects.toThrow('issued block changed');
    f.reorg();await expect(f.reader.current(producer,producer.block,true)).rejects.toThrow();
  });
  it('authenticates a matching snapshot from current canonical storage after receipt state is pruned',async()=>{
    const f=fixture(),send=f.provider.send.bind(f.provider),current={number:101n,hash:word(101)};
    f.provider.send=async(method,params)=>{
      if(!Array.isArray(params))throw new Error('Expected positional RPC parameters.');
      if(method==='eth_getBlockByNumber'&&params[0]==='latest')return{number:'0x65',hash:current.hash,transactions:[]};
      if(method==='eth_getBlockByNumber'&&params[0]==='0x65')return{number:'0x65',hash:current.hash,transactions:[]};
      if(['eth_getStorageAt','eth_getCode','eth_call'].includes(method)&&
        (params[params.length-1] as {blockHash?:string})?.blockHash===block.hash)throw new Error('missing trie node');
      return send(method,params);
    };
    const producer=await f.reader.issue(8n,'snapshot',transactionHash);
    expect(producer.block).toEqual(current);expect(producer.amounts.shares).toBe(50n);
    await expect(f.reader.current(producer,current)).resolves.toBe(producer);
  });
  it.each(['envelope','context','owner','current-reorg'] as const)('rejects %s drift when authenticating a snapshot at current state',async fault=>{
    const f=fixture(),send=f.provider.send.bind(f.provider),current={number:101n,hash:word(101)},base=preparedPoolPositionStorageBase(f.pair.marketId,8n);
    if(fault==='envelope')f.put(candidate.core,base+17n,word(999));if(fault==='context')f.put(candidate.core,base+13n,word(999));
    if(fault==='owner')f.put(nft,map(8n,2n),word(999));
    f.provider.send=async(method,params)=>{
      if(!Array.isArray(params))throw new Error('Expected positional RPC parameters.');
      if(method==='eth_getBlockByNumber'&&params[0]==='latest')return{number:'0x65',hash:current.hash,transactions:[]};
      if(method==='eth_getBlockByNumber'&&params[0]==='0x65')return{number:'0x65',hash:fault==='current-reorg'?word(102):current.hash,transactions:[]};
      if(['eth_getStorageAt','eth_getCode','eth_call'].includes(method)&&(params[params.length-1] as {blockHash?:string})?.blockHash===block.hash)throw new Error('missing trie node');
      return send(method,params);
    };
    await expect(f.reader.issue(8n,'snapshot',transactionHash)).rejects.toThrow();
  });
  it('resolves only the complete accepted descriptor and returns the canonical scope', () => {
    expect(resolvePreparedDexScope().candidate).toBe(candidate);
    expect(resolvePreparedDexScope(structuredClone(candidate))).toEqual({ key: 'cheap-prepared', candidate });
    const duplicate = { ...candidate, pairs: [candidate.pairs[0], ...candidate.pairs.slice(0, 5)] };
    const tokenSpoof = { ...candidate, tokens: [candidate.tokens[0], candidate.tokens[0], ...candidate.tokens.slice(2)] };
    const derivative = { ...candidate, graph: 'b2aa0895d7661a43e3a7db85c9ae24daaa641db238a06bec5c64d031dcf382cd', core: '0x52d5d2acc60ada57a7316de996221766bafffe27' };
    for (const supplied of [duplicate, tokenSpoof, derivative]) expect(() => resolvePreparedDexScope(supplied)).toThrow('candidate changed');
    expect(() => resolvePreparedDexScope('cheap-d06')).toThrow('candidate changed');
  });
  it('binds registry graph, package, Core and unique six-market scope to the same explicit key', async () => {
    for (const fault of ['graph', 'package', 'core', 'duplicate'] as const) {
      const f = fixture();
      const registry = await readPreparedDexMarketRegistry({ capability: {} as DexV2ReadCapability, blockNumber: block.number, blockHash: block.hash });
      vi.mocked(readPreparedDexMarketRegistry).mockResolvedValueOnce({ ...registry,
        ...(fault === 'graph' ? { graph: 'wrong-graph' } : fault === 'package' ? { packageSha256: 'wrong-package' } :
          fault === 'core' ? { core: owner } : { markets: [registry.markets[0], ...registry.markets.slice(0, 5)] }) });
      await expect(f.reader.state(8n, block)).rejects.toThrow('registry candidate scope');
      expect(readPreparedDexMarketRegistry).toHaveBeenLastCalledWith(expect.objectContaining({ candidate: 'cheap-prepared' }));
    }
  });
  it('matches the sealed build-6 layout, NFT mapping and snapshot ABI', () => {
    const frozen = createRequire(import.meta.url)('../../../ChainWhisper Contracts V2/validation/candidates/shared-core-prepared-markets-2026-10-07/candidate.cjs').frozen();
    const compiled = frozen.info.output.contracts[frozen.artifacts.ChainWhisperDexCore.sourceName].ChainWhisperDexCore;
    const l = compiled.storageLayout as Layout, field = (name: string) => l.storage.find(v => v.label === name)!;
    expect(field('_marketState').slot).toBe(String(layout.marketMapping)); expect(field('_marketForPosition').slot).toBe(String(layout.positionMarket));
    expect(field('_tokenAccounting').slot).toBe(String(layout.tokenLedger)); expect(field('nextPositionId').slot).toBe(String(layout.counter));
    expect(field('nextOperationId').slot).toBe(String(layout.operation));
    const last = l.storage[l.storage.length - 1];
    expect(BigInt(last.slot) + BigInt(l.types[last.type].numberOfBytes) / 32n).toBe(BigInt(layout.coreWords));
    const marketType = l.types[field('_marketState').type].value, poolType = l.types[marketType].members.find(v => v.label === '_pool')!.type;
    expect(Number(l.types[marketType].numberOfBytes) / 32).toBe(layout.marketWords);
    const positions = l.types[poolType].members.find(v => v.label === 'positions')!;
    expect(positions.slot).toBe(String(layout.positionMapping));
    const position = l.types[l.types[positions.type].value]; expect(Number(position.numberOfBytes) / 32).toBe(layout.positionWords);
    expect(position.members.find(v => v.label === 'snapshot')!.slot).toBe(String(layout.snapshot));
    expect(position.members.find(v => v.label === 'snapshotContext')!.slot).toBe(String(layout.context));
    const snapshot = position.members.find(v => v.label === 'snapshot')!;
    const envelope = l.types[Object.keys(l.types).find(key => key.startsWith('t_struct(utUint256)'))!];
    expect(envelope.members.find(v => v.label === 'userCiphertext')!.slot).toBe(String(layout.user));
    expect(Number(l.types[snapshot.type].numberOfBytes) / 32 / 10).toBe(layout.stride);
    const actual = new Interface(compiled.abi);
    for (const method of ['poolPublicState', 'poolSnapshot']) expect(actual.getFunction(method)!.format('minimal')).toBe(currentPoolPositionAbi.getFunction(method)!.format('minimal'));
    const nftLayout = frozen.info.output.contracts[frozen.artifacts.ChainWhisperDexPositionNFT.sourceName].ChainWhisperDexPositionNFT.storageLayout as Layout;
    expect(nftLayout.storage.find(v => v.label === '_owners')!.slot).toBe(String(layout.nftOwners));
    const token = createRequire(import.meta.url)('../../../ChainWhisper Contracts V2/validation/candidates/shared-core-markets-2026-10-07/funding-v2/token-observation.cjs').metadata();
    expect(token.balanceSlot).toBe(layout.tokenBalances);
    expect(field('_sourceIdForPosition').slot).toBe(String(layout.sourceIdForPosition));
    const sources = field('_sources'); expect(sources.slot).toBe(String(layout.coreSources));
    expect(Number(l.types[l.types[sources.type].value].numberOfBytes) / 32).toBe(layout.coreSourceWords);
    const engineLayout = frozen.info.output.contracts[frozen.artifacts.ChainWhisperFixedEngine.sourceName].ChainWhisperFixedEngine.storageLayout as Layout;
    const engineField = (name: string) => engineLayout.storage.find(v => v.label === name)!;
    expect(engineField('_sources').slot).toBe(String(layout.engineSources));
    expect(Number(engineLayout.types[engineLayout.types[engineField('_sources').type].value].numberOfBytes) / 32).toBe(layout.engineSourceWords);
    expect(engineField('_sourceIdForPosition').slot).toBe(String(layout.engineSourceIdForPosition));
    expect(engineField('_terms').slot).toBe(String(layout.engineTerms));
    expect(engineField('_ownerSnapshot').slot).toBe(String(layout.engineOwnerSnapshot));
    expect(engineField('_rangeOwnerSnapshot').slot).toBe(String(layout.engineRangeSnapshot));
    const lastEngine = engineLayout.storage[engineLayout.storage.length - 1];
    expect(BigInt(lastEngine.slot) + BigInt(engineLayout.types[lastEngine.type].numberOfBytes) / 32n).toBe(BigInt(layout.engineWords));
  });
  it('preserves full uint256 private amounts and rejects invalid shares/class/zero fields', () => {
    expect(checkPreparedPoolPositionValues([(1n << 256n) - 1n, 1n, 1n, 1n, 0n, 0n, 0n, 0n, 0n, 6n]).amount0).toBe((1n << 256n) - 1n);
    for (const index of [4, 5, 6, 7, 8, 9]) {
      const values = [1n, 1n, 1n, 1n, 0n, 0n, 0n, 0n, 0n, 0n]; values[index] = index === 9 ? 7n : 1n;
      expect(() => checkPreparedPoolPositionValues(values)).toThrow();
    }
    expect(() => checkPreparedPoolPositionValues([1n << 256n, 1n, 1n, 1n, 0n, 0n, 0n, 0n, 0n, 0n])).toThrow();
  });
  for (const closed of [false, true]) it(`authenticates canonical ${closed ? 'closed' : 'active'} owner envelopes without GC eth_call`, async () => {
    const f = fixture(closed), p = await f.reader.issue(f.selectedId, 'snapshot', transactionHash);
    expect(p.amounts).toMatchObject({ amount0: 200n, amount1: 101n, shares: closed ? 0n : 50n, classId: 0n });
    expect(p.marketId).toBe(f.pair.marketId); expect(p.revisions).toEqual([1n, 1n, 1n, 1n]);
    await expect(f.reader.current(p, { ...block, number: 101n })).resolves.toBe(p);
    await expect(f.reader.current({ ...p }, block)).rejects.toThrow('session');
  });
  it('retains an authenticated paused empty claim after full withdrawal', async () => {
    const f = fixture(), base = preparedPoolPositionStorageBase(f.pair.marketId, 8n);
    f.put(candidate.core, base, word(2));
    for (const offset of [17n, 21n, 25n]) f.put(candidate.core, base + offset, zero);
    f.receipt.logs[0] = { address: candidate.core, ...eventAbi.encodeEventLog(eventAbi.getEvent('PoolSnapshotRefreshed')!, [8n, context, preparedPoolStoredEnvelopes(f.claim())]) };
    const p = await f.reader.issue(8n, 'snapshot', transactionHash);
    expect(p.status).toBe(2n); expect(p.amounts.shares).toBe(0n); expect(p.amounts.amount0).toBe(0n);
  });
  it('authenticates exact selected-market creation calldata and NFT mint', async () => {
    const f = fixture(false, true), p = await f.reader.issue(f.selectedId, 'fund', transactionHash, f.tx.data);
    expect(p.kind).toBe('fund'); expect(p.positionId).toBe(49n);
    await expect(f.reader.issue(f.selectedId, 'fund', transactionHash, '0x')).rejects.toThrow('submitted');
    f.receipt.logs.push(f.receipt.logs[1]); await expect(f.reader.issue(f.selectedId, 'fund', transactionHash, f.tx.data)).rejects.toThrow('unique');
  });
  for (const limitScope of [51, 64] as const) it(`preserves native common fixed sources50/51 in allocated scope${limitScope}`, async () => {
    const f = fixture(false, false, limitScope), baseline = await f.reader.state(BigInt(limitScope + 1), block);
    expect(baseline.fixedSources['50'].sourceId).toBe(43n); expect(baseline.fixedSources['51'].sourceId).toBe(44n);
    expect(baseline.fixedSources['50'].engine[16]).toBe(word(456)); expect(baseline.fixedSources['50'].core[13]).toBe(word(123));
    const producer = await f.reader.issue(8n, 'snapshot', transactionHash);
    f.put(f.pair.engine, map(43n, 9n) + 16n, word(999)); await expect(f.reader.current(producer, block)).rejects.toThrow('stale');
  });
  it.each(['reorg', 'owner', 'lease', 'event', 'selector', 'market', 'counter', 'non-pool'] as const)('rejects %s mismatch', async fault => {
    const f = fixture();
    if (fault === 'reorg') f.reorg(); if (fault === 'owner') f.wrongOwner(); if (fault === 'lease') f.revoke();
    if (fault === 'event') f.receipt.logs[0].data += '00'; if (fault === 'selector') f.tx.data = '0x00000000';
    if (fault === 'market') f.put(candidate.core, map(8n, 18n), candidate.pairs[1].marketId);
    if (fault === 'counter') f.put(candidate.core, 11n, word(129));
    if (fault === 'non-pool') f.put(candidate.core, preparedPoolPositionStorageBase(f.pair.marketId, 8n) + 59n, zero);
    await expect(f.reader.issue(8n, 'snapshot', transactionHash)).rejects.toThrow();
  });
  it.each(['anchor', 'other-market', 'other-claim', 'revision', 'custody', 'nft-owner', 'c1'] as const)('holds %s drift despite the same owner context', async fault => {
    const f = fixture(), p = await f.reader.issue(8n, 'snapshot', transactionHash);
    if (fault === 'anchor') f.put(candidate.core, preparedPoolPositionStorageBase(f.pair.marketId, 1n) + 8n, word(2));
    if (fault === 'other-market') f.put(candidate.core, map(candidate.pairs[1].marketId, 1n, 'bytes32') + 11n, word(2));
    if (fault === 'other-claim') f.put(candidate.core, preparedPoolPositionStorageBase(candidate.pairs[1].marketId, 16n) + 60n, word(2));
    if (fault === 'revision') f.put(candidate.core, preparedPoolPositionStorageBase(f.pair.marketId, 8n) + 4n, word(2));
    if (fault === 'custody') f.put(candidate.tokens[0][0], map(candidate.core, 4n, 'address'), word(2));
    if (fault === 'nft-owner') f.put(nft, map(16n, 2n), word(2));
    if (fault === 'c1') f.put(candidate.core, 50n, word(2));
    await expect(f.reader.current(p, block)).rejects.toThrow('stale');
  });
  it('reports the compiled shared-owner event gap before receipt or private reads', async () => {
    const f = fixture(); for (const action of ['top-up', 'close', 'withdraw'] as const)
      await expect(f.reader.issue(8n, action, transactionHash, f.tx.data)).rejects.toThrow('separate poolSnapshot');
    for(const action of ['activate','resume']as const)
      await expect(f.reader.issue(8n,action,transactionHash,f.tx.data)).rejects.toThrow('current exit candidate');
  });
  for(const candidateKey of ['cheap-exit','cheap-history']as const){
  it.each(['activate','resume'] as const)(`${candidateKey}: authenticates the exact %s owner envelopes without a separate snapshot event`,async kind=>{
    const c=resolvePreparedDexScope(candidateKey).candidate,f=fixture(false,false,0,c),base=preparedPoolPositionStorageBase(f.pair.marketId,8n);
    f.put(c.core,base,word(kind==='activate'?2:1));f.tx.data=currentPoolPositionAbi.encodeFunctionData('managePoolPosition',[8n,context,kind==='activate'?6n:5n,'0x']);
    f.receipt.logs=[];
    const producer=await f.reader.issue(8n,kind,transactionHash,f.tx.data);
    expect(producer).toMatchObject({kind,status:kind==='activate'?2n:1n,amounts:{shares:50n}});
    await expect(f.reader.current(producer,block)).resolves.toBe(producer);
    f.tx.data=currentPoolPositionAbi.encodeFunctionData('managePoolPosition',[8n,context,7n,'0x']);
    await expect(f.reader.issue(8n,kind,transactionHash)).rejects.toThrow('calldata');
  });
  it.each(['id','data','status','context','envelope','owner','reorg'] as const)(`${candidateKey}: rejects %s in an eventless lifecycle producer`,async fault=>{
    const c=resolvePreparedDexScope(candidateKey).candidate,f=fixture(false,false,0,c),base=preparedPoolPositionStorageBase(f.pair.marketId,8n);
    f.put(c.core,base,word(fault==='status'?1:2));f.receipt.logs=[];
    f.tx.data=currentPoolPositionAbi.encodeFunctionData('managePoolPosition',[fault==='id'?16n:8n,context,6n,fault==='data'?'0x11':'0x']);
    if(fault==='context')f.put(c.core,base+13n,zero);
    if(fault==='envelope'){f.put(c.core,base+16n,zero);f.put(c.core,base+17n,zero);}
    if(fault==='owner')f.wrongOwner();if(fault==='reorg')f.reorg();
    await expect(f.reader.issue(8n,'activate',transactionHash)).rejects.toThrow();
  });
  }
  it('reads all four owner wallets with exact bigint values and a proved zero fallback', async () => {
    const f = fixture(), token = candidate.tokens[0][0], base = map(owner, 4n, 'address');
    f.put(token, base, word(99)); f.put(token, base + 1n, word(88));
    f.put(token, base + 2n, word(1)); f.put(token, base + 3n, word(1000));
    const wallets = await f.reader.wallets(block);
    expect(wallets).toHaveLength(4); expect(wallets[0]).toEqual({ token, balance: 1000n, allowance: 0n });
    expect(wallets[1].balance).toBe(0n);
    f.put(token, base + 2n, zero); f.put(token, base + 3n, zero);
    await expect(f.reader.wallets(block)).rejects.toThrow('unavailable');
  });
});

describe('prepared bounded financial preservation', () => {
  const transition = async (withLimits: 0 | 51 | 64 = 0) => {
    const f = fixture(false, false, withLimits), before = structuredClone(await f.reader.state(BigInt((withLimits || 48) + 1), block)) as PreparedPoolStoredState;
    const after = structuredClone(before) as unknown as MutableState;
    after.counter++; after.core[11] = word(after.counter); after.ownerNftBalance++;
    after.claim[0] = word(1); after.claim[59] = word(1); after.nftOwners[String(after.positionId)] = word(BigInt(owner)); after.nftMinted[String(after.positionId)] = word(1);
    after.claims[String(after.positionId)] = { marketId: after.marketId, words: after.claim };
    after.anchors.forEach(anchor => { anchor[4] = word(BigInt(anchor[4]) + 1n); });
    for (const raw of Object.values(after.claims)) if (after.markets[after.marketId].slice(18, 25).some(v => BigInt(v) === BigInt(Object.keys(after.claims).find(key => after.claims[key] === raw)!))) {
      raw.words[4] = word(2);
    }
    after.markets[after.marketId][11] = word(2);
    after.ledgers[after.market.token0][9] = word(2); after.custody[after.market.token0][0] = word(2);
    return { before, after };
  };
  type MutableState = { -readonly [K in keyof PreparedPoolStoredState]: PreparedPoolStoredState[K] extends readonly string[] ? string[] :
    K extends 'anchors' ? string[][] : K extends 'claims' ? Record<string, { marketId: string; words: string[] }> :
    K extends 'markets' | 'c1' | 'ledgers' | 'escrows' | 'custody' ? Record<string, string[]> : K extends 'nftOwners' | 'nftMinted' ? Record<string, string> : PreparedPoolStoredState[K] };
  it('accepts only the proven creation field changes and preserves other market claims', async () => {
    const { before, after } = await transition(); expect(() => checkPreparedPoolFinancialTransition(before, after, 'fund')).not.toThrow();
    after.claims['16'].words[60] = word(9); expect(() => checkPreparedPoolFinancialTransition(before, after, 'fund')).toThrow('protected');
  });
  it('accepts creation beside native fixed positions50/51 and rejects fixed inventory drift', async () => {
    const { before, after } = await transition(51);
    expect(() => checkPreparedPoolFinancialTransition(before, after, 'fund')).not.toThrow();
    (after.fixedSources['50'].engine as string[])[16] = word(999);
    expect(() => checkPreparedPoolFinancialTransition(before, after, 'fund')).toThrow('protected');
  });
  it.each(['operation', 'c1', 'fixed-ledger', 'escrow', 'counter', 'other-custody', 'nft-owner'] as const)('rejects %s funding drift', async fault => {
    const { before, after } = await transition();
    if (fault === 'operation') after.operation++; if (fault === 'c1') after.c1[after.marketId][0] = word(2);
    if (fault === 'fixed-ledger') after.ledgers[after.market.token0][4] = word(2);
    if (fault === 'escrow') after.escrows[after.market.token0][0] = word(2);
    if (fault === 'counter') after.counter++;
    if (fault === 'other-custody') after.custody[candidate.tokens.find(([token]) => ![after.market.token0, after.market.token1].includes(token))![0]][0] = word(2);
    if (fault === 'nft-owner') after.nftOwners['16'] = word(2);
    expect(() => checkPreparedPoolFinancialTransition(before, after, 'fund')).toThrow();
  });
  it('allows only supported snapshot words and protects closed system ciphertexts', async () => {
    const f = fixture(true), before = await f.reader.state(8n, block), after = structuredClone(before) as unknown as MutableState;
    after.claim[16] = word(9); after.claims['8'].words[16] = word(9);
    expect(() => checkPreparedPoolSnapshotOnlyChange(before, after)).not.toThrow();
    after.claim[14] = word(9); after.claims['8'].words[14] = word(9);
    expect(() => checkPreparedPoolSnapshotOnlyChange(before, after)).toThrow();
  });
});
