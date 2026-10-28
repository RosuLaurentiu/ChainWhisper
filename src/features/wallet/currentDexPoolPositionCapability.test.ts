import { POOL_EXIT_PREVIEW_ABI, computePoolExitPreviewContext } from '../../lib/currentDexPoolExitPreview';
import type { PreparedPoolStoredState } from '../../lib/currentDexPreparedPoolSnapshot';
import { AbiCoder, Interface, keccak256, toBeHex } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import { issueCurrentDexPoolPositionCapability, assertCurrentPoolPositionPrepared } from './currentDexPoolPositionCapability';
import { resolvePreparedDexScope } from '../../lib/currentDexPreparedScope';
import { currentPoolPositionAbi as abi, currentPoolNftAbi as nftAbi } from '../../lib/currentDexPoolPosition';
import { ARCHIVED_CHEAP_DEX_CANDIDATE as c, resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../lib/dexV2Deployment';
const ARCHIVED_CHEAP_POOL_TOKENS=[...c.tokens].sort(([a],[b])=>BigInt(a)<BigInt(b)?-1:1);
const mocks=vi.hoisted(()=>({issue:vi.fn(),graph:vi.fn(),decrypt:vi.fn(),small:vi.fn(),wide:vi.fn(),reader:vi.fn()}));
vi.mock('../../lib/currentDexPreparedPoolSnapshot',async original=>({...await original<typeof import('../../lib/currentDexPreparedPoolSnapshot')>(),createPreparedOwnerPoolSnapshotReader:mocks.reader}));
vi.mock('./ownerCotiMetaMaskCapability',()=>({issueOwnerCotiMetaMaskCapability:mocks.issue}));
vi.mock('../../lib/dexV2Chain',async original=>({...await original<typeof import('../../lib/dexV2Chain')>(),readCurrentSharedPoolDexGraph:mocks.graph}));
vi.mock('../../lib/privateUint256',()=>({decryptPrivateUint256Output:mocks.decrypt,encryptPrivateUint128Input:mocks.small,encryptPrivateUint256Input:mocks.wide}));
const owner=`0x${'22'.repeat(20)}`,recipient=`0x${'33'.repeat(20)}`,hash=toBeHex(30n,32),txHash=toBeHex(40n,32),context=toBeHex(50n,32);
const transfer=new Interface(['event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
const previewAbi = new Interface(POOL_EXIT_PREVIEW_ABI);
const word = (n: bigint | number) => toBeHex(n, 32), empty = (n: number) => Array.from({ length: n }, () => word(0));
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer V)[] ? Mutable<V>[] : T[K] extends object ? Mutable<T[K]> : T[K] };
// Exact six-market/four-token synthetic scope. The financial and codec checks are real.
async function preparedExitFixture(pairIndex = 0,candidateKey:'cheap-exit'|'cheap-history'='cheap-exit') {
  const candidate = resolvePreparedDexScope(candidateKey).candidate, pair = candidate.pairs[pairIndex], id = 43n;
  const before: Mutable<PreparedPoolStoredState> = { graph: candidate.graph, marketId: pair.marketId, positionId: id,
    block: { number: 10n, hash }, market: { marketId: pair.marketId, canonicalId: BigInt(pair.canonicalId), registryRevision: 7n,
      marketRevision: 1n, enabled: true, token0: pair.tokens[0], token1: pair.tokens[1], engine: pair.engine, poolTerms: pair.poolTerms,
      companions: pair.companions.map(([role, address, runtimeHash]) => ({ role, address, runtimeHash })) },
    claim: empty(64), anchors: [], core: empty(149), markets: {}, claims: {}, c1: {}, ledgers: {}, escrows: {}, custody: {},
    nftOwners: {}, nftMinted: {}, ownerNftBalance: 1n, engines: {}, directories: {}, fixedSources: {}, counter: id, operation: 7n };
  before.core[11] = word(id); before.core[12] = word(7);
  candidate.pairs.forEach((p, k) => {
    const raw = empty(71); raw[0] = candidate.releaseId; raw[1] = p.marketId; raw[2] = word(BigInt(p.tokens[0])); raw[3] = word(BigInt(p.tokens[1]));
    before.markets[p.marketId] = raw; before.engines[p.marketId] = empty(46); before.c1[p.marketId] = empty(49); before.directories[p.marketId] = [];
    for (let i = 0; i < 7; i++) {
      const anchorId = k * 7 + i + 1, a = empty(64); a[0] = word(1); a[4] = word(2); a[62] = word(i);
      raw[18 + i] = word(anchorId); before.claims[String(anchorId)] = { marketId: p.marketId, words: a };
      before.nftOwners[String(anchorId)] = word(0); before.nftMinted[String(anchorId)] = word(0); if (k === pairIndex) before.anchors.push(a);
    }
  });
  Object.assign(before.claim, { 0: word(1), 4: word(1), 5: word(1), 6: word(1), 7: word(1), 13: context, 59: word(1) });
  before.claims[String(id)] = { marketId: pair.marketId, words: before.claim }; before.nftOwners[String(id)] = word(BigInt(owner)); before.nftMinted[String(id)] = word(1);
  candidate.tokens.forEach(([token]) => { before.ledgers[token] = empty(12); before.escrows[token] = empty(2); before.custody[token] = empty(4); });
  const amounts = { amount0: 200n, amount1: 100n, shares: 200n, totalShares: 400n, classId: 1n };
  const wallets = candidate.tokens.map(([token]) => ({ token, balance: 1000n, allowance: 0n }));
  const managed = structuredClone(before); managed.block = { number: 11n, hash: word(31) };
  Object.assign(managed.claim, { 4: word(2), 13: word(51), 60: word(101), 61: word(102) });
  managed.anchors.forEach(a => { a[4] = word(3); [8, 9, 10, 11].forEach((i, j) => { a[i] = word(100 + j); a[[14, 15, 18, 19][j]] = a[i]; }); });
  const snapshot = structuredClone(managed); snapshot.block = { number: 12n, hash: word(32) };
  for (let i = 14; i < 54; i++) if ((i - 14) % 4 >= 2) snapshot.claim[i] = word(i + 300);
  const paidWallets = wallets.map(v => ({ ...v, balance: v.balance + (v.token === pair.tokens[0] ? 100n : v.token === pair.tokens[1] ? 50n : 0n) }));
  const previewHash = word(701), withdrawalHash = word(702), snapshotHash = word(703);
  let current = before;
  const proofs = new Map<string, { block: typeof before.block; data: string; logs: { address: string; topics: string[]; data: string }[] }>([
    [txHash, { block: before.block, data: abi.encodeFunctionData('poolSnapshot', [id]), logs: [] }],
    [snapshotHash, { block: snapshot.block, data: abi.encodeFunctionData('poolSnapshot', [id]), logs: [] }]
  ]);
  const reader = { state: vi.fn(async () => structuredClone(current)), wallets: vi.fn(async () => structuredClone(current === before ? wallets : paidWallets)),
    canonical: vi.fn(async (hash: string) => { const p = proofs.get(hash); return p ? structuredClone(p) : null; }),
    issue: vi.fn(async (_id: bigint, kind: string, hash: string) => ({ kind, positionId: id, marketId: pair.marketId,
      block: current.block, transactionHash: hash, status: BigInt(current.claim[0]), context: current.claim[13], revisions: current.claim.slice(4, 8).map(BigInt),
      amounts: { ...amounts, shares: current === before ? 200n : 100n, totalShares: current === before ? 400n : 300n } })), current: vi.fn(async p => p) };
  mocks.reader.mockReturnValue(reader); const f = await fixture(candidateKey);
  const original = f.provider.send.getMockImplementation()!;
  f.provider.send.mockImplementation(async (method, params) => {
    if (method === 'eth_getBlockByNumber') return { number: toBeHex(current.block.number), hash: current.block.hash };
    if (method === 'eth_getStorageAt') return pair.marketId;
    if (method === 'eth_call' && abi.parseTransaction({ data: params[0].data })?.name === 'poolPublicState')
      return abi.encodeFunctionResult('poolPublicState', [{ ...f.state, status: BigInt(current.claim[0]), positionRevision: BigInt(current.claim[4]),
        ownershipRevision: BigInt(current.claim[5]), lifecycleRevision: BigInt(current.claim[6]), context: BigInt(current.claim[0])===3n?context:current.claim[13] }]);
    if (method === 'eth_call') {
      const parsed=nftAbi.parseTransaction({data:params[0].data})!;
      return nftAbi.encodeFunctionResult(parsed.name,[parsed.name==='balanceOf'?0n:parsed.name==='getApproved'?toBeHex(0n,20):owner]);
    }
    return original(method, params);
  });
  f.provider.getTransactionReceipt.mockImplementation(async hash => ({ hash, blockHash: proofs.get(hash)!.block.hash, index: hash === previewHash ? 0 : 1 }));
  const request = { ...f.request, positionId: id, producerHash: txHash, minimums: [100n, 50n] as const };
  const preparePreview = async () => {
    const p = (await f.cap.prepareExitPreview(request))!;
    const ctx = computePoolExitPreviewContext(p.data, { chainId: BigInt(candidate.chainId), core: candidate.core, releaseId: candidate.releaseId,
      marketId: pair.marketId, owner, marketWords: before.markets[pair.marketId], anchors: before.anchors });
    proofs.set(previewHash, { block: before.block, data: p.data, logs: [{ address: candidate.core,
      ...previewAbi.encodeEventLog(previewAbi.getEvent('PoolExitPreviewed')!, [id, ctx, [100n, 50n, 100n, 100n, 1n, 2n].map(v => [1n, v])]) }] });
    return p;
  };
  const prepareWithdrawal = async () => {
    const preview = await preparePreview(); await preview.readResult(previewHash);
    const reissued = await issueCurrentDexPoolPositionCapability({ candidate: candidateKey } as never);
    const p = (await reissued.prepareAction(request))!;
    proofs.set(withdrawalHash, { block: managed.block, data: p.data, logs: pair.tokens.map((token, i) => ({ address: token,
      ...transfer.encodeEventLog(transfer.getEvent('Transfer')!, [candidate.core, owner, [999n, 0n], [1n, i ? 50n : 100n]]) })) });
    return { p, preview };
  };
  return { ...f, request, candidate, pair, reader, before, managed, snapshot, wallets, paidWallets, proofs,
    previewHash, withdrawalHash, snapshotHash, preparePreview, prepareWithdrawal, setState: (s: typeof before) => { current = s; } };
}
async function fixture(candidate:CurrentCheapDexCandidateKey='cheap-archived'){
  const c=resolveCurrentCheapDexCandidate(candidate);
  vi.clearAllMocks();let active=true,aes='test-key',nftOwner=owner,recipientCode='0x';
  const signer={getUserOnboardInfo:()=>({aesKey:aes})};
  const guard=()=>{if(!active)throw new Error('Revoked session');};
  const state={status:1n,sourceId:0n,bucket0Id:0n,bucket1Id:0n,positionRevision:1n,ownershipRevision:1n,lifecycleRevision:1n,termsRevision:1n,context};
  const values=[200n,100n,200n,400n,0n,0n,0n,0n,0n,1n];
  const provider={send:vi.fn(async(method,params):Promise<unknown>=>{
    if(method==='eth_getBlockByNumber')return{number:'0xa',hash};
    if(method==='eth_getStorageAt')return resolvePreparedDexScope(candidate).candidate.pairs[4].marketId;
    if(method==='eth_getCode'){expect(params).toEqual([recipient,{blockHash:hash,requireCanonical:true}]);return recipientCode;}
    const [request,block]=params;expect(block).toEqual({blockHash:hash,requireCanonical:true});expect(request.from).toBe(owner);
    if(request.to===c.core){const parsed=abi.parseTransaction({data:request.data})!;
      if(parsed.name==='poolPublicState')return abi.encodeFunctionResult(parsed.name,[state]);
      return abi.encodeFunctionResult('poolSnapshot',[state.context,values.map((v,i)=>[[999n,BigInt(i)],[BigInt(i),v]])]);}
    return nftAbi.encodeFunctionResult('ownerOf',[nftOwner]);
  }),getTransaction:vi.fn(),getTransactionReceipt:vi.fn(),getLogs:vi.fn(async()=>[] as unknown[])};
  mocks.issue.mockImplementation(async args=>{expect(args.requirePrivacy).toBe(true);return args.bindCapability({signer,readProvider:provider,ownerAddress:owner,chainId:BigInt(c.chainId),assertCurrent:async()=>guard(),assertSnapshotCurrent:guard});});
  mocks.graph.mockImplementation(async({blockNumber,blockHash})=>({graph:c.graph,packageSha256:c.packageSha256,core:c.core,chainId:BigInt(c.chainId),genesisHash:c.genesisHash,block:{number:blockNumber,hash:blockHash}}));
  mocks.decrypt.mockImplementation((_,v)=>v.ciphertextLow);
  mocks.small.mockImplementation(async(_,v)=>({ciphertext:v,signature:`0x${'44'.repeat(65)}`}));
  mocks.wide.mockImplementation(async(_,v)=>({ciphertext:{ciphertextHigh:1n,ciphertextLow:v},signature:`0x${'44'.repeat(65)}`}));
  const cap=await issueCurrentDexPoolPositionCapability({candidate}as never);
  const request={positionId:8n,expectedContext:context,action:'withdraw' as const,fraction:[1n,2n]as const,minimums:[99n,49n]as const,confirm:vi.fn(async()=>true)};
  const mine=(data:string,to=c.core as string)=>{
    provider.getTransaction.mockResolvedValue({hash:txHash,chainId:BigInt(c.chainId),from:owner,to,value:0n,data,blockNumber:10,blockHash:hash});
    const receipt={hash:txHash,status:1,from:owner,to,blockNumber:10,blockHash:hash,logs:[]as{address:string;topics:string[];data:string}[]};provider.getTransactionReceipt.mockResolvedValue(receipt);return receipt;
  };
  return{cap,request,provider,state,values,signer,mine,revoke:()=>{active=false;},lock:()=>{aes='';},owner:(v:string)=>{nftOwner=v;},code:(v:string)=>{recipientCode=v;}};
}

describe('current owner Pool inventory capability',()=>{
  const mapping=(key:bigint|string,root:bigint,type='uint256')=>keccak256(AbiCoder.defaultAbiCoder().encode([type,'uint256'],[key,root]));
  async function inventoryFixture(key:'cheap-exit'|'cheap-history'='cheap-exit'){
    const f=await fixture(key),candidate=resolvePreparedDexScope(key).candidate;
    const nft=candidate.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1], original=f.provider.send.getMockImplementation()!;
    f.provider.send.mockImplementation(async(method,params)=>{
      if(method==='eth_getStorageAt'){
        if(params[0]===candidate.core&&BigInt(params[1])===11n)return word(45);
        if(params[0]===nft&&params[1]===mapping(owner,3n,'address'))return word(2);
        if(params[0]===nft&&[mapping(43n,2n),mapping(45n,2n)].includes(params[1]))return word(BigInt(owner));
        return word(0);
      }
      if(method==='eth_call'&&params[0].to===candidate.core){
        const parsed=abi.parseTransaction({data:params[0].data})!;
        if(parsed.name==='poolPublicState'&&parsed.args[0]===45n)return abi.encodeFunctionResult('poolPublicState',[{...f.state,status:0n,positionRevision:0n,ownershipRevision:0n,lifecycleRevision:0n,termsRevision:0n}]);
      }
      return original(method,params);
    });return f;
  }
  it.each(['cheap-exit','cheap-history']as const)('lists %s Pool claims and excludes owned Limits without private snapshots or signing',async key=>{
    const f=await inventoryFixture(key),result=await f.cap.readOwnedPositions();
    expect(result.complete).toBe(true);expect(result.positions).toMatchObject([{positionId:43n,status:1n,context}]);
    expect(mocks.decrypt).not.toHaveBeenCalled();expect(mocks.reader).not.toHaveBeenCalled();expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();
  });
  it.each(['ownership','pool-state','reorg','privacy'] as const)('rejects %s change and returns no stale owner list',async fault=>{
    const f=await inventoryFixture(),original=f.provider.send.getMockImplementation()!;
    if(fault==='ownership')f.owner(recipient);
    if(fault==='pool-state')f.state.sourceId=1n;
    if(fault==='privacy')f.lock();
    if(fault==='reorg')f.provider.send.mockImplementation(async(method,params)=>method==='eth_getBlockByNumber'&&params[0]!=='latest'?{number:'0xa',hash:word(999)}:original(method,params));
    await expect(f.cap.readOwnedPositions()).rejects.toThrow();
  });
});

describe.each(['cheap-exit','cheap-history']as const)('%s received prepared Pool owner access',candidateKey=>{
  const exitFixture=(pair=0)=>preparedExitFixture(pair,candidateKey);
  it('reads only owned pending metadata before privacy activation without a creator producer',async()=>{
    const f=await exitFixture();f.before.claim[0]=word(3);
    const result=await f.cap.readPosition(43n);
    expect(result).toMatchObject({positionId:43n,status:3n,amounts:null,marketId:f.pair.marketId,poolTokens:f.pair.tokens,readyToSign:false});
    expect(f.reader.issue).not.toHaveBeenCalled();expect(f.reader.current).not.toHaveBeenCalled();expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it('does not reinterpret a creator receipt as recipient privacy authority',async()=>{
    const f=await exitFixture();f.before.claim[0]=word(3);
    await expect(f.cap.readPosition(43n,{producerHash:txHash})).rejects.toThrow('Activate');
    expect(f.reader.issue).not.toHaveBeenCalled();expect(mocks.decrypt).not.toHaveBeenCalled();
  });
});

describe.each(['cheap-exit','cheap-history']as const)('%s prepared Pool ownership lifecycle',candidateKey=>{
  const exitFixture=(pair=0)=>preparedExitFixture(pair,candidateKey);
  async function transferred(){
    const f=await exitFixture(),request={positionId:43n,expectedContext:context,action:'transfer' as const,recipient,producerHash:txHash,confirm:async()=>true};
    const p=(await f.cap.prepareAction(request))!,nft=p.to,after=structuredClone(f.before);
    after.block=f.managed.block;after.claim[0]=word(3);for(const i of [4,5,6])after.claim[i]=word(2);
    after.claim[13]=word(0);after.nftOwners['43']=word(BigInt(recipient));after.ownerNftBalance=0n;
    f.paidWallets.forEach((v,i)=>{v.balance=f.wallets[i].balance;});f.setState(after);
    const tx={hash:txHash,chainId:BigInt(f.candidate.chainId),from:owner,to:nft,value:0n,data:p.data,nonce:1,gasLimit:10_000_000n,
      blockNumber:11,blockHash:after.block.hash};
    const receipt={hash:txHash,status:1,from:owner,to:nft,blockNumber:11,blockHash:after.block.hash,
      logs:[{address:nft,...nftAbi.encodeEventLog(nftAbi.getEvent('Transfer')!,[owner,recipient,43n])}]};
    f.provider.getTransaction.mockResolvedValue(tx);f.provider.getTransactionReceipt.mockResolvedValue(receipt);
    const original=f.provider.send.getMockImplementation()!;
    let approval=toBeHex(0n,20),balance=1n,reorg=false;
    f.provider.send.mockImplementation(async(method,params)=>{
      if(method==='eth_getCode')return '0x';
      if(method==='eth_getBlockByNumber')return{number:'0xb',hash:reorg?word(999):after.block.hash,transactions:[txHash]};
      if(method==='eth_getTransactionByHash')return{...tx,chainId:`0x${tx.chainId.toString(16)}`,value:'0x0',input:tx.data,nonce:'0x1',gas:`0x${tx.gasLimit.toString(16)}`,blockNumber:'0xb',transactionIndex:'0x0'};
      if(method==='eth_getTransactionReceipt')return{...receipt,transactionHash:txHash,status:'0x1',blockNumber:'0xb',transactionIndex:'0x0'};
      if(method==='eth_call'&&params[0].to===nft){const parsed=nftAbi.parseTransaction({data:params[0].data})!;
        return nftAbi.encodeFunctionResult(parsed.name,[parsed.name==='ownerOf'?recipient:parsed.name==='getApproved'?approval:balance]);}
      return original(method,params);
    });
    return{...f,p,after,tx,receipt,badApproval:()=>{approval=recipient;},badBalance:()=>{balance=2n;},reorg:()=>{reorg=true;}};
  }
  it('authenticates transfer, checks exact NFT and economic state and revokes the old private producer',async()=>{
    const f=await transferred();expect(await f.p.readResult(txHash)).toMatchObject({action:'transfer',recipient,privateAccountingVerified:true});
    await expect(f.cap.readPosition(43n,{producerHash:txHash})).rejects.toThrow('does not own');expect(f.reader.issue).toHaveBeenCalledTimes(1);
  });
  it.each(['approval','balance','shares','wallet','event','call','reorg','privacy'] as const)('rejects %s in confirmed prepared transfer',async fault=>{
    const f=await transferred();
    if(fault==='approval')f.badApproval();if(fault==='balance')f.badBalance();if(fault==='shares')f.after.claim[60]=word(99);
    if(fault==='wallet')f.paidWallets[0].balance++;if(fault==='event')f.receipt.logs.push(f.receipt.logs[0]);if(fault==='call')f.tx.data+='00';
    if(fault==='reorg')f.reorg();if(fault==='privacy')f.lock();
    await expect(f.p.readResult(txHash)).rejects.toThrow();
  });
  it('prepares an exact transfer with no token funding',async()=>{
    const f=await exitFixture(),request={positionId:43n,expectedContext:context,action:'transfer' as const,recipient,producerHash:txHash,confirm:vi.fn(async()=>true)};
    const prepared=(await f.cap.prepareAction(request))!;
    expect(prepared).toMatchObject({action:'transfer',recipient,to:f.candidate.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1],value:0n});
    expect(nftAbi.decodeFunctionData('safeTransferFrom',prepared.data)).toEqual(expect.arrayContaining([owner,recipient,43n]));
    expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();
  });
  it.each(['activate','resume'] as const)('prepares public-context %s without encrypted inputs',async action=>{
    const f=await exitFixture();f.before.claim[0]=word(action==='activate'?3:2);
    if(action==='activate')f.before.claim[13]=word(0);
    const prepared=(await f.cap.prepareAction({positionId:43n,expectedContext:context,action,confirm:async()=>true}))!;
    expect(prepared).toMatchObject({action,to:f.candidate.core,value:0n,recipient:null});
    expect([...abi.decodeFunctionData('managePoolPosition',prepared.data)]).toEqual([43n,context,action==='activate'?6n:5n,'0x']);
    expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();
  });
  it.each(['activate','resume'] as const)('checks %s and uses its private owner producer without another paid snapshot',async action=>{
    const f=await exitFixture();f.before.claim[0]=word(action==='activate'?3:2);
    if(action==='activate')f.before.claim[13]=word(0);
    const prepared=(await f.cap.prepareAction({positionId:43n,expectedContext:context,action,confirm:async()=>true}))!;
    const after=structuredClone(f.before);after.block=f.managed.block;after.claim[0]=word(action==='activate'?2:1);
    after.claim[4]=word(2);after.claim[6]=word(2);for(let i=13;i<54;i++)after.claim[i]=word(1000+i);
    f.paidWallets.forEach((v,i)=>{v.balance=f.wallets[i].balance;});
    f.proofs.set(f.withdrawalHash,{block:after.block,data:prepared.data,logs:[]});f.setState(after);
    expect(await prepared.readResult(f.withdrawalHash)).toMatchObject({action,status:'owner-action-verified',privateAccountingVerified:true,
      snapshot:{status:action==='activate'?2n:1n,producerKind:action}});
    expect(f.reader.issue).toHaveBeenCalledWith(43n,action,f.withdrawalHash,prepared.data);
    expect(await f.cap.readPosition(43n)).toMatchObject({producerKind:action});
    expect(mocks.wide).not.toHaveBeenCalled();expect(mocks.small).not.toHaveBeenCalled();
    after.custody[f.candidate.tokens[0][0]][0]=word(99);
    await expect(prepared.readResult(f.withdrawalHash)).rejects.toThrow('protected economic');
  });
  it.each(['wrong-status','wrong-context','recipient-contract','review-state','review-wallet','revoked'] as const)('stops %s before preparing a Pool ownership send',async fault=>{
    const f=await exitFixture(),request={positionId:43n,expectedContext:fault==='wrong-context'?word(99):context,
      action:(fault==='wrong-status'?'activate':'transfer') as 'activate'|'transfer',
      ...(fault==='wrong-status'?{}:{recipient,producerHash:txHash}),confirm:async()=>{
        if(fault==='review-state')f.before.core[9]=word(99);if(fault==='review-wallet')f.wallets[0].balance++;return true;
      }};
    if(fault==='recipient-contract')f.code('0x6000');if(fault==='revoked')f.revoke();
    await expect(f.cap.prepareAction(request)).rejects.toThrow();expect(mocks.wide).not.toHaveBeenCalled();expect(mocks.small).not.toHaveBeenCalled();
  });
});

describe.each(['cheap-exit','cheap-history']as const)('%s exit preview and exact withdrawal owner proof', candidateKey => {
  const exitFixture=(pair=0)=>preparedExitFixture(pair,candidateKey);
  it('orders a verification snapshot by its receipt block while accounting uses a later current state',async()=>{
    const f=await exitFixture(),{p}=await f.prepareWithdrawal();f.setState(f.managed);await p.readResult(f.withdrawalHash);
    const paid=(await f.cap.prepareSnapshot({positionId:43n,confirm:async()=>true}))!;f.setState(f.snapshot);
    const issue=f.reader.issue.getMockImplementation()!;
    f.reader.issue.mockImplementation(async(...args)=>({...await issue(...args),block:{number:13n,hash:word(999)}}));
    expect(await paid.readResult(f.snapshotHash)).toMatchObject({privateAccountingVerified:true});
  });
  it.each([0, 1, 2, 3, 4, 5])('retains exact encrypted fraction and verifies remaining snapshot on pair %i', async pair => {
    const f = await exitFixture(pair), { p, preview } = await f.prepareWithdrawal();
    assertCurrentPoolPositionPrepared(preview, f.signer); assertCurrentPoolPositionPrepared(p, f.signer);
    const first = abi.decodeFunctionData('managePoolPosition', preview.data), second = abi.decodeFunctionData('managePoolPosition', p.data);
    expect(first[2]).toBe(11n); expect(second[2]).toBe(12n);
    const small = 'tuple(uint256 ciphertext,bytes signature)', wide = 'tuple(tuple(uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature)';
    const a = AbiCoder.defaultAbiCoder().decode([`${small}[2]`], first[3]), b = AbiCoder.defaultAbiCoder().decode(['bytes32', `${small}[2]`, `${wide}[2]`], second[3]);
    expect([...b[1]]).toEqual([...a[0]]); expect(mocks.small).toHaveBeenCalledTimes(2);
    expect(mocks.small.mock.calls.map(v => v.slice(1, 4))).toEqual([1n, 2n].map(value => [value, f.candidate.core, abi.getFunction('managePoolPosition')!.selector]));
    await p.assertBeforeSend(); f.setState(f.managed);
    expect(await p.readResult(f.withdrawalHash)).toMatchObject({ status: 'remaining-proof-required', payouts: [100n, 50n], privateAccountingVerified: false });
    const paid = (await f.cap.prepareSnapshot({ positionId: 43n, confirm: async () => true }))!;
    expect(paid.replacementFrom).toBe(f.withdrawalHash);
    f.setState(f.snapshot);
    expect(await paid.readResult(f.snapshotHash)).toMatchObject({ privateAccountingVerified: true, snapshot: { amounts: { shares: 100n, totalShares: 300n } } });
    await expect(f.cap.prepareSnapshot({ positionId: 43n, confirm: async () => true })).resolves.toMatchObject({ action: 'snapshot', closed: false, replacementFrom: f.snapshotHash });
  });
  it.each(['cheap-prepared', 'cheap-native', 'cheap-archived'] as const)('holds preview for %s before encryption', async candidate => {
    const f = await fixture(candidate); await expect(f.cap.prepareExitPreview(f.request)).rejects.toThrow('exact exit candidate');
    expect(mocks.small).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'fraction', 'context', 'producer', 'review-state', 'review-wallet', 'revoked'] as const)('rejects %s preview preparation', async fault => {
    const f = await exitFixture();
    const request = { ...f.request, fraction: [...f.request.fraction] as [bigint, bigint], confirm: async () => {
      if (fault === 'review-state') f.before.core[9] = word(55); if (fault === 'review-wallet') f.wallets[3].allowance++;
      return fault !== 'cancel';
    } };
    if (fault === 'fraction') request.fraction = [1n, 1n]; if (fault === 'context') request.expectedContext = word(55);
    if (fault === 'producer') f.reader.issue.mockRejectedValue(new Error('Invalid producer')); if (fault === 'revoked') f.revoke();
    if (fault === 'cancel') expect(await f.cap.prepareExitPreview(request)).toBeNull(); else await expect(f.cap.prepareExitPreview(request)).rejects.toThrow();
    expect(mocks.small).not.toHaveBeenCalled();
  });
  it.each(['call', 'event-context', 'event-values', 'duplicate', 'state', 'wallet', 'receipt', 'lease'] as const)('rejects %s preview proof and grants no withdrawal', async fault => {
    const f = await exitFixture(), p = await f.preparePreview(), proof = f.proofs.get(f.previewHash)!;
    if (fault === 'call') proof.data = '0x12345678';
    if (fault === 'duplicate') proof.logs.push(proof.logs[0]);
    if (fault === 'event-context' || fault === 'event-values') {
      const e = previewAbi.parseLog(proof.logs[0])!;
      proof.logs[0] = { address: f.candidate.core, ...previewAbi.encodeEventLog(e.fragment, [43n,
        fault === 'event-context' ? word(999) : e.args.context,
        [100n, 50n, fault === 'event-values' ? 99n : 100n, 100n, 1n, 2n].map(v => [1n, v])]) };
    }
    if (fault === 'state') f.before.c1[f.pair.marketId][1] = word(999); if (fault === 'wallet') f.wallets[2].balance++;
    if (fault === 'receipt') f.reader.canonical.mockResolvedValueOnce(structuredClone(proof)).mockResolvedValueOnce(null);
    if (fault === 'lease') f.revoke();
    await expect(p.readResult(f.previewHash)).rejects.toThrow();
    await expect(f.cap.prepareAction(f.request)).rejects.toThrow('authenticated exit preview');
  });
  it.each(['fraction', 'minimum', 'receipt', 'reserve', 'wallet'] as const)('rejects %s withdrawal before input encryption', async fault => {
    const f = await exitFixture(), preview = await f.preparePreview(); await preview.readResult(f.previewHash); mocks.wide.mockClear();
    const request = { ...f.request, fraction: [...f.request.fraction] as [bigint, bigint], minimums: [...f.request.minimums] as [bigint, bigint] };
    if (fault === 'fraction') request.fraction = [1n, 3n]; if (fault === 'minimum') request.minimums = [101n, 50n];
    if (fault === 'receipt') f.proofs.get(f.previewHash)!.data = '0x12345678';
    if (fault === 'reserve') f.before.anchors[6][8] = word(999); if (fault === 'wallet') f.wallets[3].balance++;
    await expect(f.cap.prepareAction(request)).rejects.toThrow(); expect(mocks.wide).not.toHaveBeenCalled();
  });
  it.each(['payout', 'duplicate', 'wallet', 'other-market', 'call', 'preview-reorg', 'order', 'nonce-state'] as const)('rejects %s withdrawal result', async fault => {
    const f = await exitFixture(), { p } = await f.prepareWithdrawal(), proof = f.proofs.get(f.withdrawalHash)!; f.setState(f.managed);
    if (fault === 'payout') proof.logs[0] = { address: f.pair.tokens[0], ...transfer.encodeEventLog(transfer.getEvent('Transfer')!, [f.candidate.core, owner, [999n, 0n], [1n, 101n]]) };
    if (fault === 'duplicate') proof.logs.push(proof.logs[0]); if (fault === 'wallet') f.paidWallets[3].balance++;
    if (fault === 'other-market') f.managed.markets[f.candidate.pairs[1].marketId][11] = word(999);
    if (fault === 'call') proof.data = '0x12345678'; if (fault === 'preview-reorg') f.proofs.get(f.previewHash)!.data = '0x12345678';
    if (fault === 'order') { proof.block = f.before.block; f.provider.getTransactionReceipt.mockImplementation(async hash => ({ hash, blockHash: f.before.block.hash, index: 0 })); }
    if (fault === 'nonce-state') f.managed.core[12] = word(99);
    await expect(p.readResult(f.withdrawalHash)).rejects.toThrow();
  });
  it.each(['shares', 'total', 'protected', 'wallet', 'withdrawal-reorg'] as const)('rejects %s remaining snapshot proof', async fault => {
    const f = await exitFixture(), { p } = await f.prepareWithdrawal(); f.setState(f.managed); await p.readResult(f.withdrawalHash);
    const paid = (await f.cap.prepareSnapshot({ positionId: 43n, confirm: async () => true }))!; f.setState(f.snapshot);
    if (fault === 'shares' || fault === 'total') { const original = f.reader.issue.getMockImplementation()!;
      f.reader.issue.mockImplementationOnce(async (...args) => { const value = await original(...args); value.amounts[fault === 'shares' ? 'shares' : 'totalShares']++; return value; }); }
    if (fault === 'protected') f.snapshot.core[9] = word(99); if (fault === 'wallet') f.paidWallets[2].allowance++;
    if (fault === 'withdrawal-reorg') f.proofs.get(f.withdrawalHash)!.data = '0x12345678';
    await expect(paid.readResult(f.snapshotHash)).rejects.toThrow();
  });
});
describe('current owner liquidity NFT capability',()=>{
  it('reads only owner envelopes from the same canonical block',async()=>{
    const f=await fixture();expect(await f.cap.readPosition(8n)).toMatchObject({positionId:8n,status:1n,amounts:{amount0:200n,amount1:100n,shares:200n,classId:1n}});
    expect(mocks.decrypt.mock.calls.map(call=>call[1].ciphertextHigh)).toEqual(Array.from({length:10},(_,i)=>BigInt(i)));
    expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();
  });
  it.each(['owner','anchor','independent','class','padding','shares','context','encoding','graph','locked','revoked'])('rejects %s private claims',async fault=>{
    const f=await fixture();if(fault==='owner')f.owner(recipient);if(fault==='independent')f.state.sourceId=1n;
    if(fault==='class')f.values[9]=7n;if(fault==='padding')f.values[4]=1n;if(fault==='shares')f.values[2]=401n;
    if(fault==='context')f.state.context=toBeHex(0n,32);if(fault==='encoding')f.provider.send.mockResolvedValueOnce({number:'0xa',hash}).mockResolvedValueOnce('0x');
    if(fault==='graph')mocks.graph.mockRejectedValueOnce(new Error('Graph changed'));if(fault==='locked')f.lock();if(fault==='revoked')f.revoke();
    await expect(f.cap.readPosition(fault==='anchor'?7n:8n)).rejects.toThrow();
  });
  it('reads pending recipient public state without decrypting a private claim',async()=>{
    const f=await fixture();f.state.status=3n;expect((await f.cap.readPosition(8n)).amounts).toBeNull();expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it.each(['0x6001','0x00','0x0','',null])('rejects non-EOA or malformed recipient code %s before confirmation',async code=>{
    const f=await fixture();f.code(code as string);
    await expect(f.cap.prepareAction({...f.request,action:'transfer',recipient})).rejects.toThrow('Only EOA');
    expect(f.request.confirm).not.toHaveBeenCalled();expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();
  });
  it.each(['review','sign','result'])('rejects recipient code changes at %s',async phase=>{
    const f=await fixture();const request={...f.request,action:'transfer' as const,recipient,
      confirm:async()=>{if(phase==='review')f.code('0x6001');return true;}};
    if(phase==='review'){await expect(f.cap.prepareAction(request)).rejects.toThrow('Only EOA');return;}
    const prepared=(await f.cap.prepareAction(request))!;f.code('0x6001');
    if(phase==='sign')await expect(prepared.assertBeforeSend()).rejects.toThrow('Only EOA');
    else{f.mine(prepared.data,prepared.to);await expect(prepared.readResult(txHash)).rejects.toThrow('Only EOA');}
  });
  it('requires confirmation and exact selector-bound fraction/minimum encryption',async()=>{
    const f=await fixture(),prepared=(await f.cap.prepareAction(f.request))!;
    assertCurrentPoolPositionPrepared(prepared,f.signer);expect(()=>assertCurrentPoolPositionPrepared({...prepared},f.signer)).toThrow();
    expect(mocks.wide.mock.calls.map(call=>call[1])).toEqual([99n,49n]);expect(mocks.small.mock.calls.map(call=>call[1])).toEqual([1n,2n]);
    for(const call of [...mocks.small.mock.calls,...mocks.wide.mock.calls])expect(call.slice(2)).toEqual([c.core,abi.getFunction('managePoolPosition')!.selector]);
  });
  it.each(['cancel','mutation','full','zero','minimum','recipient','stale','revoked'])('rejects %s preparation before private signing',async fault=>{
    const f=await fixture();let request={...f.request}as Parameters<typeof f.cap.prepareAction>[0];
    if(fault==='cancel')request.confirm=async()=>false;if(fault==='mutation')request.confirm=async()=>{f.state.context=toBeHex(51n,32);return true;};
    if(fault==='full')request.fraction=[1n,1n];if(fault==='zero')request.fraction=[0n,2n];if(fault==='minimum')request.minimums=[-1n,0n];
    if(fault==='recipient')request={...request,action:'transfer',recipient:owner};if(fault==='stale')request.expectedContext=toBeHex(52n,32);if(fault==='revoked')f.revoke();
    if(fault==='cancel')await expect(f.cap.prepareAction(request)).resolves.toBeNull();else await expect(f.cap.prepareAction(request)).rejects.toThrow();
    expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();
  });
  it.each(['withdraw','close','activate','resume']as const)('rejects incorrect %s lifecycle revision before payout decryption',async action=>{
    const f=await fixture();if(action==='activate')f.state.status=3n;if(action==='resume')f.state.status=2n;
    const prepared=(await f.cap.prepareAction({...f.request,action}))!;f.mine(prepared.data,prepared.to);
    f.state.positionRevision=2n;f.state.context=toBeHex(51n,32);
    f.state.status=action==='close'?4n:action==='activate'?2n:1n;
    f.state.lifecycleRevision=action==='withdraw'?2n:1n;
    await expect(prepared.readResult(txHash)).rejects.toThrow('incorrect status or revision');
  });
  it.each(['withdraw','close','transfer','activate','resume']as const)('authenticates %s result, private payouts or authority revision',async action=>{
    const f=await fixture();if(action==='activate')f.state.status=3n;if(action==='resume')f.state.status=2n;
    const prepared=(await f.cap.prepareAction({...f.request,action,recipient}))!,receipt=f.mine(prepared.data,prepared.to);
    f.state.positionRevision=2n;f.state.context=toBeHex(51n,32);f.state.status=action==='close'?4n:action==='activate'?2n:action==='transfer'?3n:1n;
    if(action==='close'||action==='activate'||action==='resume')f.state.lifecycleRevision=2n;
    if(action==='transfer'){f.owner(recipient);f.state.ownershipRevision=2n;f.state.lifecycleRevision=2n;
      receipt.logs=[{address:prepared.to,...nftAbi.encodeEventLog(nftAbi.getEvent('Transfer')!,[owner,recipient,8n])}];
    }else if(action==='withdraw'||action==='close'){
      f.values[2]=action==='close'?0n:100n;f.values[0]=100n;f.values[1]=50n;
      receipt.logs=ARCHIVED_CHEAP_POOL_TOKENS.map(([address],i)=>({address,...transfer.encodeEventLog(transfer.getEvent('Transfer')!,[c.core,owner,[999n,0n],[BigInt(i),i?50n:100n]])}));
      if(action==='close')receipt.logs.push({address:c.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1],...nftAbi.encodeEventLog(nftAbi.getEvent('Transfer')!,[owner,`0x${'00'.repeat(20)}`,8n])});
    }
    mocks.decrypt.mockClear();
    await expect(prepared.readResult(txHash)).resolves.toMatchObject({action,positionId:8n,readyToSign:false});
    if(action==='transfer')expect(mocks.decrypt).not.toHaveBeenCalled();
  });
});


describe('selected native Pool position issuer remains narrow',()=>{
  it('holds unissued private reads and owner actions; never signs on Load',async()=>{const f=await fixture('cheap-native');await expect(f.cap.readPosition(8n)).rejects.toThrow('issued current native Pool session');await expect(f.cap.prepareAction(f.request)).rejects.toThrow('issued current native Pool session');expect(mocks.wide).not.toHaveBeenCalled();f.revoke();await expect(f.cap.readPosition(8n)).rejects.toThrow('Revoked');});
});

// Isolated capability tests: the real snapshot-only checker runs here. Reader
// authentication/storage/crypto use the 35 unmocked reader tests separately.
describe.each(['cheap-prepared', 'cheap-exit','cheap-history'] as const)('%s position capability with isolated authenticated reader', candidateKey => {
  const preparedFixture = async () => {
    const candidate = resolvePreparedDexScope(candidateKey).candidate, pair = candidate.pairs[4];
    const claim = Array.from({ length: 64 }, () => toBeHex(0n, 32)); claim[0] = toBeHex(1n, 32);
    const stored = { positionId: 8n, marketId: pair.marketId, block: { number: 10n, hash }, claim,
      claims: { '8': { marketId: pair.marketId, words: claim } }, protected: ['unchanged'] };
    const wallets = candidate.tokens.map(([token]) => ({ token, balance: 1000n, allowance: 0n }));
    const producer = { kind: 'snapshot', transactionHash:txHash, positionId: 8n, marketId: pair.marketId, block: { number: 10n, hash }, status: 1n,
      context, revisions: [1n, 1n, 1n, 1n], amounts: { amount0: 200n, amount1: 100n, shares: 200n, classId: 1n } };
    let data = abi.encodeFunctionData('poolSnapshot', [8n]);
    const reader = { state: vi.fn(async () => structuredClone(stored)), wallets: vi.fn(async () => structuredClone(wallets)),
      issue: vi.fn(async (_id, kind) => ({ ...producer, kind })), readSnapshot:vi.fn(async()=>producer), current: vi.fn(async value => value),
      canonical: vi.fn(async () => ({ data, block: producer.block, logs: [] })) };
    mocks.reader.mockReturnValue(reader);
    const f = await fixture(candidateKey);
    return { ...f, candidate, reader, producer, stored, wallets, pair, setData: (value: string) => { data = value; } };
  };
  it('requires an authenticated producer and uses mapped canonical pair metadata', async () => {
    const f = await preparedFixture();
    await expect(f.cap.readPosition(8n)).resolves.toMatchObject({amounts:null,readyToSign:false});
    const result = await f.cap.readPosition(8n, { producerHash: txHash });
    expect(result).toMatchObject({ marketId: f.pair.marketId, poolTokens: f.pair.tokens, producerKind: 'snapshot', amounts: f.producer.amounts });
    expect(mocks.reader).toHaveBeenCalledWith(expect.objectContaining({ marketId: f.pair.marketId }));
    expect(f.provider.send).toHaveBeenCalledWith('eth_getStorageAt', [resolvePreparedDexScope(candidateKey).candidate.core,
      keccak256(AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256'], [8n, 18n])), { blockHash: hash, requireCanonical: true }]);
    expect(f.reader.issue).toHaveBeenCalledWith(8n, 'snapshot', txHash, undefined);
    expect(f.provider.send.mock.calls.some(([method, args]) => method === 'eth_call' &&
      args[0].data === abi.encodeFunctionData('poolSnapshot', [8n]))).toBe(false);
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it('finds the current snapshot without a hash and does not scan its checked block twice',async()=>{
    const f=await preparedFixture();
    const event=new Interface(['event PoolSnapshotRefreshed(uint256 indexed positionId,bytes32 context,(uint256 ciphertextHigh,uint256 ciphertextLow)[10] userValues)']);
    const log=event.encodeEventLog(event.getEvent('PoolSnapshotRefreshed')!,[8n,context,Array.from({length:10},()=>[1n,2n])]);
    f.provider.getLogs.mockResolvedValue([{...log,address:f.candidate.core,transactionHash:txHash,blockNumber:10,index:0,removed:false}]);
    await expect(f.cap.readPosition(8n)).resolves.toMatchObject({amounts:f.producer.amounts,producerHash:txHash,readyToSign:false});
    expect(f.reader.readSnapshot).toHaveBeenCalledWith(8n,txHash);
    expect(f.reader.issue).not.toHaveBeenCalled();expect(f.reader.current).not.toHaveBeenCalled();
    expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();
  });
  it.each(['stale-context','removed','wrong-id','unverified'] as const)('does not reveal an automatic %s snapshot',async fault=>{
    const f=await preparedFixture(),event=new Interface(['event PoolSnapshotRefreshed(uint256 indexed positionId,bytes32 context,(uint256 ciphertextHigh,uint256 ciphertextLow)[10] userValues)']);
    const log=event.encodeEventLog(event.getEvent('PoolSnapshotRefreshed')!,[fault==='wrong-id'?9n:8n,fault==='stale-context'?toBeHex(99n,32):context,Array.from({length:10},()=>[1n,2n])]);
    f.provider.getLogs.mockResolvedValue([{...log,address:f.candidate.core,transactionHash:txHash,blockNumber:10,index:0,removed:fault==='removed'}]);
    if(fault==='unverified')f.reader.readSnapshot.mockRejectedValue(new Error('Owner envelope differs'));
    if(fault==='stale-context')await expect(f.cap.readPosition(8n)).resolves.toMatchObject({amounts:null});
    else await expect(f.cap.readPosition(8n)).rejects.toThrow();
    expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();
  });
  it('passes an arbitrary fund call to the exact authenticated reader without granting spending authority', async () => {
    const f = await preparedFixture(); f.setData('0x12345678');
    await expect(f.cap.readPosition(8n, { producerHash: txHash })).resolves.toMatchObject({ producerKind: 'fund', readyToSign: false });
    expect(f.reader.issue).toHaveBeenCalledWith(8n, 'fund', txHash, '0x12345678');
    await expect(f.cap.prepareAction(f.request)).rejects.toThrow('authenticated exit preview');
    expect(mocks.wide).not.toHaveBeenCalled();
  });
  it.each(['market', 'producer', 'public-context', 'revoked'] as const)('rejects %s read mismatch', async fault => {
    const f = await preparedFixture();
    if (fault === 'market') f.provider.send.mockImplementationOnce(async () => ({ number: '0xa', hash })).mockImplementationOnce(async () => toBeHex(0n, 32));
    if (fault === 'producer') f.reader.issue.mockRejectedValueOnce(new Error('Invalid canonical producer'));
    if (fault === 'public-context') f.state.context = toBeHex(51n, 32);
    if (fault === 'revoked') f.revoke();
    await expect(f.cap.readPosition(8n, { producerHash: txHash })).rejects.toThrow();
  });
  it('prepares a branded snapshot and accepts only the real snapshot-only field transition', async () => {
    const f = await preparedFixture(), prepared = (await f.cap.prepareSnapshot({ positionId: 8n, confirm: async () => true }))!;
    assertCurrentPoolPositionPrepared(prepared, f.signer);
    expect(prepared).toMatchObject({ marketId: f.pair.marketId, poolTokens: f.pair.tokens, data: abi.encodeFunctionData('poolSnapshot', [8n]), readyToSign: false });
    await expect(prepared.assertBeforeSend()).resolves.toBeUndefined();
    f.stored.claim[16] = toBeHex(9n, 32);
    await expect(prepared.readResult(txHash)).resolves.toMatchObject({ action: 'snapshot', status: 'active-snapshot-verified', snapshot: { marketId: f.pair.marketId } });
    expect(f.reader.issue).toHaveBeenCalledWith(8n, 'snapshot', txHash, prepared.data);
    expect(f.reader.canonical.mock.calls.length).toBe(3);
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it.each(['state', 'wallet', 'missing-wallet', 'market', 'lease'] as const)('rejects %s drift during snapshot review', async fault => {
    const f = await preparedFixture();
    await expect(f.cap.prepareSnapshot({ positionId: 8n, confirm: async () => {
      if (fault === 'state') f.stored.protected[0] = 'changed';
      if (fault === 'wallet') f.wallets[3].allowance++;
      if (fault === 'missing-wallet') f.wallets.pop();
      if (fault === 'market') f.provider.send.mockImplementation(async method => method === 'eth_getBlockByNumber' ? { number: '0xa', hash } : toBeHex(0n, 32));
      if (fault === 'lease') f.revoke();
      return true;
    } })).rejects.toThrow();
    expect(f.reader.issue).not.toHaveBeenCalled();
  });
  it.each(['state', 'wallet', 'missing-wallet', 'receipt', 'old-block', 'producer'] as const)('rejects %s snapshot result corruption', async fault => {
    const f = await preparedFixture(), prepared = (await f.cap.prepareSnapshot({ positionId: 8n, confirm: async () => true }))!;
    if (fault === 'state') f.stored.protected[0] = 'changed';
    if (fault === 'wallet') f.wallets[2].balance--;
    if (fault === 'missing-wallet') f.wallets.pop();
    if (fault === 'receipt') f.reader.canonical.mockResolvedValueOnce({ data: prepared.data, block: f.producer.block, logs: [] }).mockResolvedValue({ data: prepared.data, block: f.producer.block, logs: ['changed'] } as never);
    if (fault === 'old-block') f.producer.block.number = 9n;
    if (fault === 'producer') f.reader.issue.mockRejectedValueOnce(new Error('Invalid producer'));
    await expect(prepared.readResult(txHash)).rejects.toThrow();
  });
  it('cancelled snapshot creates no producer and unknown wallet scope is held', async () => {
    const f = await preparedFixture();
    await expect(f.cap.prepareSnapshot({ positionId: 8n, confirm: async () => false })).resolves.toBeNull();
    f.wallets.pop();
    await expect(f.cap.prepareSnapshot({ positionId: 8n, confirm: async () => true })).rejects.toThrow('all four');
    expect(f.reader.issue).not.toHaveBeenCalled();
  });
  it.each([2n, 4n])('retains status%s snapshot metadata', async status => {
    const f = await preparedFixture(); f.state.status = status; f.producer.status = status;
    f.stored.claim[0] = toBeHex(status, 32); if (status === 4n) f.producer.amounts.shares = 0n;
    const prepared = (await f.cap.prepareSnapshot({ positionId: 8n, confirm: async review => {
      expect(review.closed).toBe(status === 4n); return true;
    } }))!;
    f.stored.claim[16] = toBeHex(9n, 32);
    await expect(prepared.readResult(txHash)).resolves.toMatchObject({ snapshot: { status },
      status: status === 4n ? 'closed-snapshot-verified' : 'active-snapshot-verified', privateAccountingVerified: false });
  });
  it('rejects closed system ciphertext changes through the real checker', async () => {
    const f = await preparedFixture(); f.state.status = 4n; f.producer.status = 4n; f.stored.claim[0] = toBeHex(4n, 32);
    const prepared = (await f.cap.prepareSnapshot({ positionId: 8n, confirm: async () => true }))!;
    f.stored.claim[14] = toBeHex(1n, 32);
    await expect(prepared.readResult(txHash)).rejects.toThrow('financial state');
  });
  it('rechecks the canonical receipt after final public position reads', async () => {
    const f = await preparedFixture(), prepared = (await f.cap.prepareSnapshot({ positionId: 8n, confirm: async () => true }))!;
    const proof = { data: prepared.data, block: f.producer.block, logs: [] };
    f.reader.canonical.mockResolvedValueOnce(proof).mockResolvedValueOnce(proof).mockResolvedValue(null as never);
    await expect(prepared.readResult(txHash)).rejects.toThrow('after position reads');
  });
  it('does not replace an authenticated producer when its current-state check fails', async () => {
    const f = await preparedFixture();
    f.reader.current.mockRejectedValueOnce(new Error('Stale producer'));
    await expect(f.cap.readPosition(8n, { producerHash: txHash })).rejects.toThrow('Stale producer');
    await expect(f.cap.readPosition(8n)).resolves.toMatchObject({amounts:null});
  });
});
