import { createRequire } from 'node:module';
import { AbiCoder, Interface, keccak256, toBeHex, type JsonRpcSigner } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import type { CotiReadProvider } from './appShared';
import { STAGED_PREPARED_DEX_CANDIDATE as candidate } from './dexV2Deployment';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { STAGED_GAP_DEX_CANDIDATE as currentGap } from './currentDexGapCandidate';
import { readPreparedDexMarketRegistry, type DexV2ReadCapability } from './dexV2Chain';
import { currentPoolPositionAbi, currentPoolNftAbi } from './currentDexPoolPosition';
import { currentTokenFundingAbi } from './currentDexTokenFunding';
import { encodePreparedPoolCreation, encodePreparedPoolFundingPreview } from './currentDexPoolFunding';
import { PREPARED_POOL_LAYOUT as layout, preparedPoolPositionStorageBase, preparedPoolStoredEnvelopes,
  checkPreparedPoolPositionValues, createPreparedOwnerPoolSnapshotReader, checkPreparedPoolFinancialTransition,
  checkPreparedPoolSnapshotOnlyChange, checkPreparedPoolSelectedScope, checkPreparedPoolFundingCurrent, type PreparedPoolStoredState } from './currentDexPreparedPoolSnapshot';

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
    getLogs: async () => [],
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

describe.runIf(resolvePreparedDexScope('cheap-history').candidate.graph === currentGap.graph)('superseded plain snapshot recovery proof', () => {
  it.each(['success', 'same-hash', 'order', 'missing-latest', 'wrong-call', 'wrong-id', 'duplicate-event', 'event-encoding',
    'latest-envelope', 'position-revision', 'ownership-revision', 'lifecycle-revision', 'terms-revision', 'owner', 'closed', 'reorg', 'late-revision'] as const)(
    'keeps old amounts outside normal producers and checks recovery: %s', async fault => {
      const selected = resolvePreparedDexScope('cheap-history').candidate;
      expect(selected.graph).toBe(currentGap.graph);
      const f = fixture(false, false, 0, selected), latestHash = word(78), current = { number: 101n, hash: word(101) };
      const base = preparedPoolPositionStorageBase(f.pair.marketId, 8n), nft = selected.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1];
      f.put(selected.core, base + 17n, word(102));
      const latestTx = { ...f.tx, hash: latestHash, nonce: 1 };
      const latestReceipt = { ...f.receipt, hash: latestHash, logs: [{ address: selected.core,
        ...eventAbi.encodeEventLog(eventAbi.getEvent('PoolSnapshotRefreshed')!, [8n, context, preparedPoolStoredEnvelopes(f.claim())]) }] };
      if (fault === 'wrong-call') f.tx.data = currentPoolPositionAbi.encodeFunctionData('poolSnapshot', [9n]);
      if (fault === 'wrong-id') f.receipt.logs = [{ address: selected.core,
        ...eventAbi.encodeEventLog(eventAbi.getEvent('PoolSnapshotRefreshed')!, [9n, context, preparedPoolStoredEnvelopes(f.claim())]) }];
      if (fault === 'duplicate-event') f.receipt.logs.push({ ...f.receipt.logs[0] });
      if (fault === 'event-encoding') f.receipt.logs[0].data += '00';
      if (fault === 'latest-envelope') f.put(selected.core, base + 17n, word(103));
      const revision = ['position-revision', 'ownership-revision', 'lifecycle-revision', 'terms-revision'].indexOf(fault);
      if (revision >= 0) f.put(selected.core, base + 4n + BigInt(revision), word(2));
      if (fault === 'owner') f.put(nft, map(8n, 2n), word(999));
      if (fault === 'closed') f.put(selected.core, base, word(4));
      const read = f.provider.send.bind(f.provider); let latestHeads = 0;
      f.provider.getTransaction = async hash => (hash === transactionHash ? f.tx : latestTx) as never;
      f.provider.getTransactionReceipt = async hash => (fault === 'missing-latest' && hash === latestHash ? null : hash === transactionHash ? f.receipt : latestReceipt) as never;
      f.provider.send = async (method, params) => {
        if (!Array.isArray(params)) throw new Error('Expected RPC parameters.');
        const latest = params[0] === latestHash, tx = latest ? latestTx : f.tx, receipt = latest ? latestReceipt : f.receipt;
        if (method === 'eth_getTransactionByHash') return { ...tx, chainId: `0x${tx.chainId.toString(16)}`, value: '0x0', input: tx.data,
          nonce: latest ? '0x1' : '0x0', gas: '0x5f5e100', blockNumber: '0x64', transactionIndex: fault === 'order' ? latest ? '0x0' : '0x1' : latest ? '0x1' : '0x0' };
        if (method === 'eth_getTransactionReceipt') return { ...receipt, transactionHash: receipt.hash, status: '0x1', blockNumber: '0x64',
          transactionIndex: fault === 'order' ? latest ? '0x0' : '0x1' : latest ? '0x1' : '0x0' };
        if (method === 'eth_getBlockByNumber') {
          if (params[0] === 'latest') {
            latestHeads++;
            if (fault === 'late-revision' && latestHeads === 2) f.put(selected.core, base + 4n, word(2));
            return { number: '0x65', hash: current.hash, transactions: [] };
          }
          if (params[0] === '0x65') return { number: '0x65', hash: fault === 'reorg' ? word(999) : current.hash, transactions: [] };
          return { number: '0x64', hash: block.hash, transactions: fault === 'order' ? [latestHash, transactionHash] : [transactionHash, latestHash] };
        }
        return read(method, params);
      };
      const recovery = f.reader.verifySupersededSnapshot(8n, transactionHash, fault === 'same-hash' ? transactionHash : latestHash);
      if (fault === 'success') {
        const result = await recovery;
        expect(result).toMatchObject({ claimStatus: 1n, revisions: [1n, 1n, 1n, 1n], block: current });
        expect(result).not.toHaveProperty('amounts'); expect(result).not.toHaveProperty('producer');
        await expect(f.reader.issue(8n, 'snapshot', transactionHash)).rejects.toThrow('differs from stored owner envelopes');
        await expect(f.reader.readSnapshot(8n, transactionHash)).rejects.toThrow('differs from stored owner envelopes');
      } else await expect(recovery).rejects.toThrow();
    });
});

describe('prepared Pool source-bound storage and authenticated producers', () => {
  it.each([false, true])('exposes verified state after current checks (reuse issued %s)', async reuse => {
    const f = fixture(), producer = await f.reader.issue(8n, 'snapshot', transactionHash);
    const send = vi.spyOn(f.provider, 'send'), capture = vi.fn();
    await expect(f.reader.current(producer, block, reuse, capture)).resolves.toBe(producer);
    expect(capture).toHaveBeenCalledOnce();
    expect(capture.mock.calls[0][0]).toMatchObject({ graph: candidate.graph, owner, positionId: 8n, block });
    const storageReads = send.mock.calls.filter(([method]) => method === 'eth_getStorageAt').length;
    expect(storageReads > 0).toBe(!reuse);
  });
  it.each(['owner', 'lease', 'reorg', 'block', 'brand', 'market'] as const)('does not expose verified state after %s failure', async fault => {
    const f = fixture(), producer = await f.reader.issue(8n, 'snapshot', transactionHash), capture = vi.fn();
    if (fault === 'owner') f.wrongOwner();
    if (fault === 'lease') f.revoke();
    if (fault === 'reorg') f.reorg();
    const supplied = fault === 'brand' ? { ...producer } : producer;
    const selectedBlock = fault === 'block' ? { ...block, hash: word(101) } : block;
    const reader = fault === 'market' ? createPreparedOwnerPoolSnapshotReader({ signer: f.signer, owner, candidate,
      marketId: candidate.pairs[1].marketId, readCapability: {} as DexV2ReadCapability, provider: f.provider,
      guard: async () => {}, attest: async () => {} }) : f.reader;
    await expect(reader.current(supplied, selectedBlock, true, capture)).rejects.toThrow();
    expect(capture).not.toHaveBeenCalled();
  });
  it('keeps selected accounting reads fixed when unrelated positions are allocated', async () => {
    const counts: number[] = [];
    for (const allocated of [51,64,200] as const) {
      const f=fixture(false,false,allocated===200?51:allocated),send=f.provider.send.bind(f.provider);let reads=0;
      if(allocated===200)f.put(candidate.core,11n,word(200));
      f.provider.send=async(method,params)=>{if(method==='eth_getStorageAt')reads++;return send(method,params);};
      const s=await f.reader.selectedState(8n,block);
      expect(Object.keys(s.markets)).toEqual([f.pair.marketId]);
      expect(Object.keys(s.claims)).toHaveLength(8);expect(s.anchors).toHaveLength(7);
      expect(Object.keys(s.nftOwners)).toEqual(['8']);counts.push(reads);
    }
    expect(counts).toEqual([810,810,810]);
  });
  it('checks complete selected creation accounting and protects every retained field', async () => {
    const f=fixture(),id=49n,before=await f.reader.selectedState(id,block),base=preparedPoolPositionStorageBase(f.pair.marketId,id);
    const claim=f.claim();claim.forEach((v,i)=>f.put(candidate.core,base+BigInt(i),v));
    f.put(candidate.core,11n,word(id));f.put(candidate.core,map(id,18n),f.pair.marketId);
    f.put(candidate.core,map(f.pair.marketId,124n,'bytes32'),word(1));
    f.put(nft,map(id,2n),word(BigInt(owner)));f.put(nft,map(id,6n),word(1));f.put(nft,map(owner,3n,'address'),word(7));
    for(const anchor of before.markets[f.pair.marketId].slice(18,25))f.put(candidate.core,preparedPoolPositionStorageBase(f.pair.marketId,BigInt(anchor))+4n,word(2));
    const after=await f.reader.selectedState(id,block);
    expect(()=>checkPreparedPoolFinancialTransition(before,after,'fund')).not.toThrow();
    for(const fault of ['anchor','claim','nft','ledger','escrow','ever-funded','mapping','source','missing-anchor','extra-market']as const){
      const bad=structuredClone(after),set=(words:readonly string[],i:number,value=word(99))=>(words as string[])[i]=value;
      if(fault==='anchor')set(bad.anchors[6],13);
      if(fault==='claim')set(bad.claim,54);
      if(fault==='nft')(bad.nftOwners as Record<string,string>)[String(id)]=word(2);
      if(fault==='ledger')set(bad.ledgers[candidate.tokens[0][0]],4);
      if(fault==='escrow')set(bad.escrows[candidate.tokens[0][0]],0);
      if(fault==='ever-funded')Object.assign(bad,{everPoolFunded:word(0)});
      if(fault==='mapping')Object.assign(bad,{positionMarket:candidate.pairs[1].marketId});
      if(fault==='source')Object.assign(bad,{sourceIdForPosition:word(1)});
      if(fault==='missing-anchor')delete(bad.claims as Record<string,unknown>)[String(BigInt(after.markets[f.pair.marketId][18]))];
      if(fault==='extra-market')(bad.markets as Record<string,readonly string[]>)[candidate.pairs[1].marketId]=before.markets[f.pair.marketId];
      expect(()=>checkPreparedPoolFinancialTransition(before,bad,'fund'),fault).toThrow();
    }
    const incomplete=structuredClone(after);(incomplete.anchors as unknown[]).pop();
    expect(()=>checkPreparedPoolSelectedScope(incomplete)).toThrow('scope');
  });
  it.each(['before-shared','before-disjoint','after-shared','after-disjoint'] as const)('attributes the actual own mint with an unrelated other-owner %s mint',async order=>{
    const f=fixture(),baseline=await f.reader.selectedState(null,block),beforeOther=order.startsWith('before'),
      otherPair=candidate.pairs.find(p=>p.marketId!==f.pair.marketId && p.tokens.filter(t=>f.pair.tokens.some(v=>v===t)).length===(order.endsWith('shared')?1:0))!,
      ownId=beforeOther?50n:49n,otherId=beforeOther?49n:50n;
    const unrelated=()=>{
      f.put(candidate.core,11n,word(beforeOther?49n:50n));
      f.put(candidate.core,map(otherId,18n),otherPair.marketId);f.put(nft,map(otherId,2n),word(2));f.put(nft,map(otherId,6n),word(1));
      for(const token of otherPair.tokens){f.put(candidate.core,map(token,22n,'address')+9n,word(99));f.put(token,map(candidate.core,4n,'address'),word(99));}
      for(const slot of [12n,13n,14n,16n,17n,58n,98n])f.put(candidate.core,slot,word(99));
    };
    if(beforeOther){unrelated();const fresh=await f.reader.selectedState(null,block);expect(fresh.positionId).toBe(50n);expect(()=>checkPreparedPoolFundingCurrent(baseline,fresh)).not.toThrow();}
    const claim=f.claim();claim.forEach((v,i)=>f.put(candidate.core,preparedPoolPositionStorageBase(f.pair.marketId,ownId)+BigInt(i),v));
    f.put(candidate.core,11n,word(ownId));f.put(candidate.core,map(ownId,18n),f.pair.marketId);
    f.put(candidate.core,map(f.pair.marketId,124n,'bytes32'),word(1));f.put(nft,map(ownId,2n),word(BigInt(owner)));
    f.put(nft,map(ownId,6n),word(1));f.put(nft,map(owner,3n,'address'),word(7));
    for(const anchor of baseline.markets[f.pair.marketId].slice(18,25))f.put(candidate.core,preparedPoolPositionStorageBase(f.pair.marketId,BigInt(anchor))+4n,word(2));
    if(!beforeOther)unrelated();
    const after=await f.reader.selectedState(ownId,block);
    expect(ownId===baseline.counter+1n && after.counter===ownId).toBe(false);
    expect(after.counter).toBe(50n);expect(()=>checkPreparedPoolFinancialTransition(baseline,after,'fund')).not.toThrow();
    for(const fault of ['reused-id','counter','config','monotonic','context','anchor']as const){
      const bad=structuredClone(after);
      if(fault==='reused-id')Object.assign(bad,{positionId:48n});
      if(fault==='counter')Object.assign(bad,{counter:ownId-1n});
      if(fault==='config')(bad.core as string[])[50]=word(99);
      if(fault==='monotonic')(bad.core as string[])[12]=word(0);
      if(fault==='context')(bad.anchors[0]as string[])[13]=word(99);
      if(fault==='anchor')(bad.anchors[6]as string[])[4]=word(1);
      expect(()=>checkPreparedPoolFinancialTransition(baseline,bad,'fund'),fault).toThrow();
    }
  });
  it.each(['same-pool-after','incoming-nft'] as const)('attributes selected funding with %s interference',async interference=>{
    const f=fixture(),before=await f.reader.selectedState(null,block),id=49n;
    f.claim().forEach((v,i)=>f.put(candidate.core,preparedPoolPositionStorageBase(f.pair.marketId,id)+BigInt(i),v));
    f.put(candidate.core,11n,word(id));f.put(candidate.core,map(id,18n),f.pair.marketId);
    f.put(candidate.core,map(f.pair.marketId,124n,'bytes32'),word(1));
    f.put(nft,map(id,2n),word(BigInt(owner)));f.put(nft,map(id,6n),word(1));
    f.put(nft,map(owner,3n,'address'),word(interference==='incoming-nft'?8:7));
    for(const anchor of before.markets[f.pair.marketId].slice(18,25)){
      const base=preparedPoolPositionStorageBase(f.pair.marketId,BigInt(anchor));
      f.put(candidate.core,base+4n,word(interference==='same-pool-after'?3:2));
      if(interference==='same-pool-after')for(const slot of [8n,9n,10n,11n,14n,15n,18n,19n])f.put(candidate.core,base+slot,word(99));
    }
    if(interference==='same-pool-after'){
      const market=map(f.pair.marketId,1n,'bytes32');
      for(let i=25n;i<39n;i++)f.put(candidate.core,market+i,word(99));
    }
    const after=await f.reader.selectedState(id,block);
    expect(()=>checkPreparedPoolFinancialTransition(before,after,'fund')).not.toThrow();
    // These aggregates are still exact dependencies before signing.
    const changed=structuredClone(before);(changed.anchors[0] as string[])[4]=word(2);
    expect(()=>checkPreparedPoolFundingCurrent(before,changed)).toThrow();
  });
  it.each(['valid','envelope','event','calldata','canonical','order','duplicate','bound','revision','owner','market','context'] as const)(
    'authenticates a later same-block owner snapshot after funding: %s',async fault=>{
      const f=fixture(false,true),snapshotHash=word(78),base=preparedPoolPositionStorageBase(f.pair.marketId,f.selectedId);
      // Refresh changes entitlement/total shares with no change to owned shares or public revisions.
      f.put(candidate.core,base+17n,word(250));f.put(candidate.core,base+29n,word(150));
      const event={address:candidate.core,...eventAbi.encodeEventLog(eventAbi.getEvent('PoolSnapshotRefreshed')!,
        [f.selectedId,context,preparedPoolStoredEnvelopes(f.claim())])};
      const snapshotTx={...f.tx,hash:snapshotHash,data:currentPoolPositionAbi.encodeFunctionData('poolSnapshot',[f.selectedId])};
      const snapshotReceipt={...f.receipt,hash:snapshotHash,logs:[event]};
      const discovered={...event,transactionHash:snapshotHash,blockHash:block.hash,blockNumber:Number(block.number),index:3,removed:false};
      const send=f.provider.send.bind(f.provider),getTx=f.provider.getTransaction.bind(f.provider),getReceipt=f.provider.getTransactionReceipt.bind(f.provider);
      const transactions=fault==='order'?[snapshotHash,transactionHash]:[transactionHash,snapshotHash];
      f.provider.getTransaction=async hash=>hash===snapshotHash?snapshotTx as never:getTx(hash);
      f.provider.getTransactionReceipt=async hash=>hash===snapshotHash?snapshotReceipt as never:getReceipt(hash);
      f.provider.getLogs=async()=>Array.from({length:fault==='duplicate'?2:fault==='bound'?257:1},()=>discovered) as never;
      f.provider.send=async(method,params)=>{
        if(!Array.isArray(params))throw new Error('Expected positional RPC parameters.');
        if(method==='eth_getBlockByNumber')return{...await send(method,params),transactions};
        if(method==='eth_getTransactionByHash'&&params[0]===snapshotHash)return{...snapshotTx,chainId:toBeHex(snapshotTx.chainId).replace(/^0x0/,'0x'),
          value:'0x0',input:snapshotTx.data,nonce:'0x0',gas:'0x5f5e100',blockNumber:'0x64',transactionIndex:toBeHex(BigInt(transactions.indexOf(snapshotHash))).replace(/^0x0/,'0x')};
        if(method==='eth_getTransactionReceipt'&&params[0]===snapshotHash)return{...snapshotReceipt,transactionHash:snapshotHash,
          status:fault==='canonical'?'0x0':'0x1',blockNumber:'0x64',transactionIndex:toBeHex(BigInt(transactions.indexOf(snapshotHash))).replace(/^0x0/,'0x')};
        const value=await send(method,params);
        if(['eth_getTransactionByHash','eth_getTransactionReceipt'].includes(method)&&params[0]===transactionHash)
          return{...value as object,transactionIndex:toBeHex(BigInt(transactions.indexOf(transactionHash))).replace(/^0x0/,'0x')};
        return value;
      };
      if(fault==='envelope')f.put(candidate.core,base+17n,word(999));
      if(fault==='event')snapshotReceipt.logs=[{...event,data:event.data+'00'}];
      if(fault==='calldata')snapshotTx.data=currentPoolPositionAbi.encodeFunctionData('poolSnapshot',[8n]);
      if(fault==='revision')f.put(candidate.core,base+4n,word(2));
      if(fault==='owner')f.put(nft,map(f.selectedId,2n),word(2));
      if(fault==='market')f.put(candidate.core,map(f.selectedId,18n),candidate.pairs[1].marketId);
      if(fault==='context')f.put(candidate.core,base+13n,word(999));
      const result=f.reader.issue(f.selectedId,'fund',transactionHash,f.tx.data);
      if(fault==='valid')await expect(result).resolves.toMatchObject({kind:'fund',transactionHash,amountsTransactionHash:snapshotHash,
        amounts:{amount0:250n,shares:50n,totalShares:150n},readyToSign:false});
      else await expect(result).rejects.toThrow();
    });
  it('counts the full funding baseline separately from the display-only owner snapshot', async () => {
    const f = fixture(false, false, 51), send = f.provider.send.bind(f.provider);
    const calls: Record<string, number> = {};
    f.provider.send = async (method, params) => {
      calls[method] = (calls[method] ?? 0) + 1;
      return send(method, params);
    };
    const baseline = await f.reader.state(52n, block);
    expect(Object.keys(baseline.markets)).toHaveLength(6);
    expect(Object.keys(baseline.claims)).toHaveLength(51);
    expect(Object.keys(baseline.fixedSources)).toEqual(['50', '51']);
    expect(Object.keys(baseline.nftOwners)).toHaveLength(52);
    expect(calls).toEqual({ eth_getStorageAt: 5093 });
    const stateCalls = { ...calls };
    for (const method of Object.keys(calls)) delete calls[method];
    const snapshot = await f.reader.readSnapshot(8n, transactionHash);
    expect(snapshot.amounts.shares).toBe(50n);
    expect(calls.eth_getStorageAt).toBe(66);
    console.info('Pool reader local fixture provider.send counts', JSON.stringify({ state: stateCalls, readSnapshot: calls }));
  });
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
  it('keeps the exact funding preview context separate from the minted owner context',async()=>{
    const f=fixture(false,true),abi=new Interface(['function createPoolPosition(bytes32 selectedMarket,bytes32 expectedPreview,bytes data) returns(uint256)']),
      args=abi.decodeFunctionData('createPoolPosition',f.tx.data);
    f.tx.data=abi.encodeFunctionData('createPoolPosition',[args[0],word(99),args[2]]);
    const producer=await f.reader.issue(f.selectedId,'fund',transactionHash,f.tx.data);
    expect(producer.context).toBe(context);expect(producer.context).not.toBe(word(99));
  });
  for (const limitScope of [51, 64] as const) it(`preserves native common fixed sources50/51 in allocated scope${limitScope}`, async () => {
    const f = fixture(false, false, limitScope), baseline = await f.reader.state(BigInt(limitScope + 1), block);
    expect(baseline.fixedSources['50'].sourceId).toBe(43n); expect(baseline.fixedSources['51'].sourceId).toBe(44n);
    expect(baseline.fixedSources['50'].engine[16]).toBe(word(456)); expect(baseline.fixedSources['50'].core[13]).toBe(word(123));
    const producer = await f.reader.issue(8n, 'snapshot', transactionHash);
    f.put(f.pair.engine, map(43n, 9n) + 16n, word(999));
    expect((await f.reader.state(BigInt(limitScope+1),block)).fixedSources['50'].engine[16]).toBe(word(999));
    await expect(f.reader.current(producer, block)).resolves.toBe(producer);
  });
  it.each(['reorg', 'owner', 'lease', 'event', 'selector', 'market', 'counter', 'non-pool'] as const)('rejects %s mismatch', async fault => {
    const f = fixture();
    if (fault === 'reorg') f.reorg(); if (fault === 'owner') f.wrongOwner(); if (fault === 'lease') f.revoke();
    if (fault === 'event') f.receipt.logs[0].data += '00'; if (fault === 'selector') f.tx.data = '0x00000000';
    if (fault === 'market') f.put(candidate.core, map(8n, 18n), candidate.pairs[1].marketId);
    if (fault === 'counter') f.put(candidate.core, 11n, word(41));
    if (fault === 'non-pool') f.put(candidate.core, preparedPoolPositionStorageBase(f.pair.marketId, 8n) + 59n, zero);
    await expect(f.reader.issue(8n, 'snapshot', transactionHash)).rejects.toThrow();
  });
  it.each(['anchor', 'other-market', 'other-claim', 'revision', 'custody', 'nft-owner', 'c1'] as const)('tracks %s drift within the declared accounting scope', async fault => {
    const f = fixture(), p = await f.reader.issue(8n, 'snapshot', transactionHash);
    if (fault === 'anchor') f.put(candidate.core, preparedPoolPositionStorageBase(f.pair.marketId, 1n) + 8n, word(2));
    if (fault === 'other-market') f.put(candidate.core, map(candidate.pairs[1].marketId, 1n, 'bytes32') + 11n, word(2));
    if (fault === 'other-claim') f.put(candidate.core, preparedPoolPositionStorageBase(candidate.pairs[1].marketId, 16n) + 60n, word(2));
    if (fault === 'revision') f.put(candidate.core, preparedPoolPositionStorageBase(f.pair.marketId, 8n) + 4n, word(2));
    if (fault === 'custody') f.put(candidate.tokens[0][0], map(candidate.core, 4n, 'address'), word(2));
    if (fault === 'nft-owner') f.put(nft, map(16n, 2n), word(2));
    if (fault === 'c1') f.put(candidate.core, 50n, word(2));
    if(['other-market','other-claim','nft-owner'].includes(fault))await expect(f.reader.current(p,block)).resolves.toBe(p);
    else await expect(f.reader.current(p, block)).rejects.toThrow('stale');
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
  it.each([false,true])('preserves C1 configuration, lifecycle and accounting checks (closed=%s)', async closed => {
    const f=fixture(closed),before=await f.reader.selectedState(8n,block);
    // CW-135: C1 configuration (50..57) stays protected. The C1 service changes its active state (58..98) in each window.
    for(let index=50;index<=98;index++){
      const bad=structuredClone(before);(bad.core as string[])[index]=word(BigInt(before.core[index])+1n);
      if(index<58)expect(()=>checkPreparedPoolSnapshotOnlyChange(before,bad)).toThrow('financial state');
      else expect(()=>checkPreparedPoolSnapshotOnlyChange(before,bad)).not.toThrow();
    }
    for(const index of [49,99]){
      const bad=structuredClone(before);(bad.core as string[])[index]=word(BigInt(before.core[index])+1n);
      expect(()=>checkPreparedPoolSnapshotOnlyChange(before,bad)).toThrow('financial state');
    }
  });
  it('allows only supported snapshot words and protects closed system ciphertexts', async () => {
    const f = fixture(true), before = await f.reader.state(8n, block), after = structuredClone(before) as unknown as MutableState;
    after.claim[16] = word(9); after.claims['8'].words[16] = word(9);
    expect(() => checkPreparedPoolSnapshotOnlyChange(before, after)).not.toThrow();
    after.claim[14] = word(9); after.claims['8'].words[14] = word(9);
    expect(() => checkPreparedPoolSnapshotOnlyChange(before, after)).toThrow();
  });
});

describe('selected Pool scan reuse by storage root (CW-133)', () => {
  const later = { number: 101n, hash: word(101) };
  const rooted = (f: ReturnType<typeof fixture>, fault?: 'refused' | 'malformed' | 'address' | 'zero') => {
    const send = f.provider.send.bind(f.provider), calls: Record<string, number> = {}, proofs: unknown[][] = [];
    f.provider.send = async (method, params) => {
      calls[method] = (calls[method] ?? 0) + 1;
      if (method !== 'eth_getProof') return send(method, params);
      proofs.push(params as unknown[]);
      if (fault === 'refused') throw new Error('COTI RPC reads stopped after HTTP 403. No automatic retry.');
      const account = String((params as unknown[])[0]).toLowerCase();
      const entries = [...f.slots].filter(([key]) => key.startsWith(`${account}:`)).sort(([a], [b]) => a < b ? -1 : 1);
      const storageHash = fault === 'zero' ? zero : keccak256(coder.encode(['string'], [JSON.stringify(entries)]));
      return fault === 'malformed' ? { address: account, storageHash: '0x12' } : { address: fault === 'address' ? owner : account, storageHash };
    };
    return { calls, proofs };
  };
  it('reads only the six pinned storage roots while contract storage is unchanged', async () => {
    const f = fixture(), { calls, proofs } = rooted(f);
    const first = await f.reader.selectedState(8n, block);
    expect(calls).toMatchObject({ eth_getStorageAt: 810, eth_getProof: 6 });
    const second = await f.reader.selectedState(8n, later);
    expect(calls).toMatchObject({ eth_getStorageAt: 810, eth_getProof: 12 });
    expect(second.block).toEqual(later);
    expect({ ...second, block: null }).toEqual({ ...first, block: null });
    expect(proofs.slice(6).map(([account]) => account)).toEqual([candidate.core, ...candidate.tokens.map(([token]) => token), nft]);
    proofs.slice(6).forEach(params => expect(params.slice(1)).toEqual([[], { blockHash: later.hash, requireCanonical: true }]));
    const next = await f.reader.selectedState(null, block), again = await f.reader.selectedState(null, later);
    expect(calls.eth_getStorageAt).toBe(1620);
    expect(again.positionId).toBe(next.positionId);
  });
  it.each(['core', 'token', 'nft'] as const)('scans again and returns the new word after a %s storage change', async account => {
    const f = fixture(), { calls } = rooted(f), token = candidate.tokens[0][0];
    await f.reader.selectedState(8n, block);
    if (account === 'core') f.put(candidate.core, 12n, word(4));
    if (account === 'token') f.put(token, map(candidate.core, 4n, 'address'), word(9));
    if (account === 'nft') f.put(nft, map(owner, 3n, 'address'), word(7));
    const changed = await f.reader.selectedState(8n, later);
    expect(calls.eth_getStorageAt).toBe(1620);
    if (account === 'core') expect(changed.operation).toBe(4n);
    if (account === 'token') expect(changed.custody[token][0]).toBe(word(9));
    if (account === 'nft') expect(changed.ownerNftBalance).toBe(7n);
  });
  it.each(['refused', 'malformed', 'address', 'zero'] as const)('keeps the full scan when a storage root is %s', async fault => {
    const f = fixture(), { calls } = rooted(f, fault);
    const first = await f.reader.selectedState(8n, block), second = await f.reader.selectedState(8n, block);
    expect(calls.eth_getStorageAt).toBe(1620);
    expect(second).toEqual(first);
  });
  it('still rejects a stale producer and reuses the scan for a current one', async () => {
    const f = fixture(), { calls } = rooted(f), producer = await f.reader.issue(8n, 'snapshot', transactionHash);
    const reads = calls.eth_getStorageAt;
    await expect(f.reader.current(producer, block)).resolves.toBe(producer);
    expect(calls.eth_getStorageAt).toBe(reads);
    f.put(candidate.core, 12n, word(4));
    await expect(f.reader.current(producer, block)).rejects.toThrow('Prepared Pool producer is stale; sign a new snapshot.');
    expect(calls.eth_getStorageAt).toBe(reads + 810);
  });
  it('stops on a revoked wallet lease and retains at most four scans', async () => {
    const f = fixture(), { calls } = rooted(f);
    await f.reader.selectedState(8n, block);
    for (const value of [11, 12, 13, 14]) { f.put(candidate.core, 12n, word(value)); await f.reader.selectedState(8n, block); }
    f.put(candidate.core, 12n, word(3));
    await f.reader.selectedState(8n, block);
    expect(calls.eth_getStorageAt).toBe(6 * 810);
    f.revoke();
    await expect(f.reader.selectedState(8n, block)).rejects.toThrow('lease revoked');
    expect(calls.eth_getStorageAt).toBe(6 * 810);
  });
});

describe('separate C1 Core words in producer and snapshot comparisons (CW-135)', () => {
  it('keeps a producer current across a C1 window and rejects another Core word', async () => {
    const f = fixture(), producer = await f.reader.issue(8n, 'snapshot', transactionHash);
    for (const slot of [58n, 64n, 88n, 98n]) f.put(candidate.core, slot, word(700));
    await expect(f.reader.current(producer, block)).resolves.toBe(producer);
    f.put(candidate.core, 57n, word(700));
    await expect(f.reader.current(producer, block)).rejects.toThrow('Prepared Pool producer is stale; sign a new snapshot.');
  });
  it.each([57n, 99n, 10n])('accepts a snapshot-only change across a C1 window and rejects Core word %s', async other => {
    const f = fixture(), before = await f.reader.selectedState(8n, block);
    for (const slot of [63n, 66n, 74n, 88n]) f.put(candidate.core, slot, word(700));
    const window = await f.reader.selectedState(8n, block);
    expect(() => checkPreparedPoolSnapshotOnlyChange(before, window)).not.toThrow();
    f.put(candidate.core, other, word(700));
    const changed = await f.reader.selectedState(8n, block);
    expect(() => checkPreparedPoolSnapshotOnlyChange(before, changed)).toThrow('Prepared snapshot changed financial state.');
  });
});
