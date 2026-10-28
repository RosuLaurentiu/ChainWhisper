import { Interface,toBeHex } from '@coti-io/coti-ethers';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { issueCurrentDexLimitCapability,assertCurrentLimitPrepared } from './currentDexLimitCapability';
import { currentLimitAbi as abi,currentLimitAbiForCandidate,resolveCurrentLimitScope,CURRENT_LIMIT_MARKET_FOR_POSITION,currentLimitNftAbi,currentLimitBindingAbi,currentLimitMappingSlot as slot,currentLimitAddressSlot,CURRENT_LIMIT_LAYOUT as l,CURRENT_LIMIT_OWNER_LAYOUT as ol,currentLimitTokens,readCurrentLimitOwnerState,CurrentLimitProofMismatch,type CurrentLimitOwnerAction } from '../../lib/currentDexLimit';
import { PRIVATE_ERC20_TOKEN_VNEXT_ABI } from '../../lib/appShared/contracts';
import { CURRENT_CHEAP_DEX_CANDIDATE as c, STAGED_EXIT_PREVIEW_DEX_CANDIDATE, resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../lib/dexV2Deployment';
import { resolvePreparedDexScope } from '../../lib/currentDexPreparedScope';
import * as limitPolicy from '../../lib/currentDexC1SwapPolicy';
const mocks=vi.hoisted(()=>({issue:vi.fn(),graph:vi.fn(),registry:vi.fn(),funds:vi.fn(),small:vi.fn(),wide:vi.fn(),decrypt:vi.fn()}));
vi.mock('./ownerCotiMetaMaskCapability',()=>({issueOwnerCotiMetaMaskCapability:mocks.issue}));
vi.mock('../../lib/dexV2Chain',async original=>({...await original<typeof import('../../lib/dexV2Chain')>(),readCurrentSharedPoolDexGraph:mocks.graph,readPreparedDexMarketRegistry:mocks.registry}));
vi.mock('../../lib/currentSharedDexTokenFunds',()=>({readCurrentSharedDexTokenFunds:mocks.funds}));
vi.mock('../../lib/privateUint256',()=>({encryptPrivateUint128Input:mocks.small,encryptPrivateUint256Input:mocks.wide,decryptPrivateUint256Output:mocks.decrypt}));
const owner=`0x${'22'.repeat(20)}`,hash=toBeHex(10n,32),txHash=toBeHex(20n,32),engine=c.companions.find(([role])=>role==='ChainWhisperFixedEngine')![1];
const transfer=new Interface(['event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
const approval=new Interface(['event Approval(address indexed owner,address indexed spender,(uint256 ciphertextHigh,uint256 ciphertextLow) ownerValue,(uint256 ciphertextHigh,uint256 ciphertextLow) spenderValue)']);
async function fixture(direction=true,candidate:CurrentCheapDexCandidateKey='cheap-current',pairIndex=0){
  const c=resolveCurrentCheapDexCandidate(candidate),prepared=candidate==='cheap-exit'||candidate==='cheap-prepared'||candidate==='cheap-history'?resolvePreparedDexScope(candidate).candidate:null,pair=prepared?.pairs[pairIndex],scope=resolveCurrentLimitScope(candidate,pair?.tokens),abi=currentLimitAbiForCandidate(candidate),nft=c.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1],engine=scope.engine;
  vi.clearAllMocks();let active=true,aes='key',observedOwner=owner;
  const signer={getUserOnboardInfo:()=>({aesKey:aes})},guard=async()=>{if(!active)throw new Error('Revoked');};
  const expected=[9007199254740993n,0n,3n,1n,1n,9007199254740993n,direction?1n:0n,0n],words=new Map<string,bigint>();
  const set=(address:string,index:bigint,value:bigint)=>words.set(`${address}:${index}`,value);
  if(pair)set(c.core,slot(9n,CURRENT_LIMIT_MARKET_FOR_POSITION),BigInt(pair.marketId));
  set(c.core,slot(9n,l.coreMapping),24n);set(engine,slot(9n,l.engineMapping),24n);
  const authority=[1n,0n,1n,9n,24n,1n,1n,40n,41n,1n,1n,1n];
  for(const [address,root]of [[c.core,l.coreSources],[engine,l.engineSources]]as const)authority.forEach((v,i)=>set(address,slot(24n,root)+BigInt(i),v));
  for(let i=0;i<8;i++){set(engine,slot(9n,l.engineSnapshots)+BigInt(i*4+2),BigInt(i+1));set(engine,slot(9n,l.engineSnapshots)+BigInt(i*4+3),expected[i]);}
  const token=new Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI),balances=c.tokens.map(()=>prepared?expected[0]+1000n:1000n),allowances=c.tokens.map(([address])=>prepared&&address===scope.poolTokens[direction?0:1]?expected[0]:0n);
  let minedTx:Record<string,unknown>|null=null,minedReceipt:Record<string,unknown>|null=null,registryRevision=7n;
  const provider={send:vi.fn(async(method,params):Promise<unknown>=>{if(method==='eth_getBlockByNumber')return{number:'0xa',hash,timestamp:'0x64',transactions:[txHash]};
    if(method==='eth_getTransactionByHash')return{...minedTx,chainId:toBeHex(BigInt(c.chainId)),value:'0x0',nonce:'0x4',gas:'0x989680',input:minedTx?.data,blockNumber:'0xa',transactionIndex:'0x0'};
    if(method==='eth_getTransactionReceipt')return{...minedReceipt,transactionHash:txHash,status:`0x${BigInt(minedReceipt!.status as number).toString(16)}`,blockNumber:'0xa',transactionIndex:'0x0'};expect(params.at(-1)).toEqual({blockHash:hash,requireCanonical:true});
    if(method==='eth_getStorageAt')return toBeHex(words.get(`${params[0]}:${BigInt(params[1])}`)??0n,32);
    const request=params[0];expect(request.from).toBe(owner);
    if(request.to===nft){if(words.get(`${nft}:${slot(9n,ol.nftOwners)}`)===0n)throw new Error('Burned NFT');return currentLimitNftAbi.encodeFunctionResult('ownerOf',[observedOwner]);}
    const index=c.tokens.findIndex(([address])=>address===request.to);if(index>=0){const parsed=token.parseTransaction(request)!;return token.encodeFunctionResult(parsed.fragment,parsed.name==='balanceOf'?[[1n,balances[index]]]:[[[999n,0n],[2n,allowances[index]],[3n,0n]]]);}
    return currentLimitBindingAbi.encodeFunctionResult('bindingCommitment',[toBeHex(77n,32)]);
  }),getTransaction:vi.fn(),getTransactionReceipt:vi.fn()};
  mocks.issue.mockImplementation(async args=>{expect(args.requirePrivacy).toBe(true);return args.bindCapability({signer,readProvider:provider,ownerAddress:owner,chainId:BigInt(c.chainId),assertCurrent:guard,assertSnapshotCurrent:()=>{if(!active)throw new Error('Revoked');}});});
  mocks.graph.mockImplementation(async({blockNumber,blockHash})=>({chainId:BigInt(c.chainId),graph:c.graph,packageSha256:c.packageSha256,core:c.core,genesisHash:c.genesisHash,block:{number:blockNumber,hash:blockHash},operationReadIdentity:{runtimeHash:c.runtimes.find(([role])=>role==='ChainWhisperDexCore')![2],releaseId:c.releaseId}}));
  mocks.registry.mockImplementation(async({blockNumber,blockHash})=>({chainId:BigInt(c.chainId),graph:c.graph,packageSha256:c.packageSha256,core:c.core,releaseId:c.releaseId,block:{number:blockNumber,hash:blockHash},registryRevision,markets:prepared?.pairs.map(pair=>({marketId:pair.marketId,canonicalId:BigInt(pair.canonicalId),registryRevision,marketRevision:1n,enabled:true,token0:pair.tokens[0],token1:pair.tokens[1],engine:pair.engine,poolTerms:pair.poolTerms,companions:[]}))}));
  mocks.funds.mockImplementation(async({candidate:key,owner:account,head})=>{expect(key).toBe(candidate);expect(account).toBe(owner);expect(head).toEqual({number:10n,hash,timestamp:100n});return{core:c.core,graph:c.graph,packageSha256:c.packageSha256,tokens:c.tokens.map(([address],index)=>({address,balance:balances[index],allowance:allowances[index]}))};});
  mocks.small.mockImplementation(async(_,v)=>({ciphertext:v,signature:`0x${'44'.repeat(65)}`}));mocks.wide.mockImplementation(async(_,v)=>({ciphertext:{ciphertextHigh:1n,ciphertextLow:v},signature:`0x${'44'.repeat(65)}`}));mocks.decrypt.mockImplementation((_,v)=>v.ciphertextLow);
  const cap=await issueCurrentDexLimitCapability({candidate,selectedPair:pair?.tokens}as never),request={graph:{number:10n,hash,expectedGraph:c.graph,expectedPackageSha256:c.packageSha256},intent:{sellToken0:direction,amount:expected[0],terms:[3n,1n,1n,1n,2n]as const},confirm:vi.fn(async()=>true)};
  const mine=(data:string,snapshot=false)=>{minedTx={hash:txHash,chainId:BigInt(c.chainId),from:owner,to:c.core,value:0n,data,nonce:4,gasLimit:10000000n,blockNumber:10,blockHash:hash};provider.getTransaction.mockResolvedValue(minedTx);
    const logs=snapshot?[]:[{address:c.core,...abi.encodeEventLog(abi.getEvent('FixedPositionCreated')!,[9n])},{address:nft,...currentLimitNftAbi.encodeEventLog(currentLimitNftAbi.getEvent('Transfer')!,[`0x${'00'.repeat(20)}`,owner,9n])},
      ...currentLimitTokens(direction,c,scope.poolTokens).map((address,i)=>({address,...transfer.encodeEventLog(transfer.getEvent('Transfer')!,[owner,c.core,[BigInt(i+1),i?0n:expected[0]],[999n,0n]])}))];
    const receipt={hash:txHash,status:1,from:owner,to:c.core,blockNumber:10,blockHash:hash,logs};minedReceipt=receipt;provider.getTransactionReceipt.mockResolvedValue(receipt);if(prepared&&!snapshot){const index=c.tokens.findIndex(([address])=>address===scope.poolTokens[direction?0:1]);balances[index]-=expected[0];allowances[index]-=expected[0];}return receipt;};
  return{cap,request,provider,signer,mine,set,c,pair,scope,engine,abi,bumpRegistry:()=>{registryRevision++;},replaceAes:()=>{aes='other-key';},expected,words,balances,allowances,lock:()=>{aes='';},revoke:()=>{active=false;},changeOwner:()=>{observedOwner=c.core;}};
}

async function ownerFixture(direction=true,candidate:CurrentCheapDexCandidateKey='cheap-current',pairIndex=0){
  const c=resolveCurrentCheapDexCandidate(candidate),prepared=candidate==='cheap-exit'||candidate==='cheap-prepared'||candidate==='cheap-history'?resolvePreparedDexScope(candidate).candidate:null,pair=prepared?.pairs[pairIndex],scope=resolveCurrentLimitScope(candidate,pair?.tokens),abi=currentLimitAbiForCandidate(candidate),nft=c.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1],engine=scope.engine;
  const f=await fixture(direction,candidate,pairIndex);f.expected[0]=100n;f.expected[1]=7n;f.expected[5]=100n;
  f.set(nft,slot(9n,ol.nftOwners),BigInt(owner));f.set(nft,currentLimitAddressSlot(owner,ol.nftBalances),1n);
  f.set(engine,slot(0n,ol.engineDirectory),24n);f.set(engine,slot(0n,ol.engineEpochs),1n);f.set(engine,3n,1n);
  const snapshot=()=>f.expected.forEach((v,i)=>f.set(engine,slot(9n,l.engineSnapshots)+BigInt(i*4+3),v));snapshot();
  const mine=(prepared:{data:string},action:CurrentLimitOwnerAction)=>{
    const receipt=f.mine(prepared.data,true);
    if(action==='pause'||action==='resume'||action==='close')for(const [host,root]of [[c.core,l.coreSources],[engine,l.engineSources]]as const){const index=slot(24n,root)+11n;f.set(host,index,f.words.get(`${host}:${index}`)!+1n);}
    if(action==='pause'||action==='resume')f.set(engine,slot(24n,l.engineStatus),action==='pause'?1n:0n);
    if(action==='claim'||action==='close'){
      receipt.logs.push({address:c.core,...abi.encodeEventLog(abi.getEvent(action==='claim'?'FixedProceedsClaimed':'FixedPositionClosed')!,[9n])});
      const offered=scope.poolTokens[direction?0:1];c.tokens.forEach(([address],i)=>{if(!scope.poolTokens.includes(address))return;const amount=address===offered?(action==='close'?100n:0n):7n;f.balances[i]+=amount;receipt.logs.push({address,...transfer.encodeEventLog(transfer.getEvent('Transfer')!,[c.core,owner,[999n,0n],[1n,amount]])});});
      f.set(engine,slot(24n,l.engineSources)+18n,777n);f.set(c.core,slot(24n,l.coreSources)+15n,777n);
    }
    if(action==='close'){
      for(const [host,root]of [[c.core,l.coreSources],[engine,l.engineSources]]as const)f.set(host,slot(24n,root),257n);
      f.set(engine,slot(9n,ol.engineCloseOwner),BigInt(owner));f.set(engine,slot(0n,ol.engineDirectory),0n);f.set(engine,3n,0n);
      f.set(nft,slot(9n,ol.nftOwners),0n);f.set(nft,currentLimitAddressSlot(owner,ol.nftBalances),0n);
      receipt.logs.push({address:nft,...currentLimitNftAbi.encodeEventLog(currentLimitNftAbi.getEvent('Transfer')!,[owner,`0x${'00'.repeat(20)}`,9n])});
      f.expected[0]=0n;f.expected[1]=0n;f.expected[5]=0n;snapshot();
    }
    return receipt;
  };
  const refresh=await f.cap.prepareOwnerAction({positionId:9n,action:'refresh',confirm:async()=>true});mine(refresh!,'refresh');const result=(await refresh!.readResult(txHash))!;
  return{...f,result,ownerMine:mine,snapshot,prepare:(action:CurrentLimitOwnerAction)=>f.cap.prepareOwnerAction({positionId:9n,action,snapshot:result,expectedContext:result.context,confirm:async()=>true})};
}

describe('mined Limit top-up reconciliation',()=>{
  const recoveredFixture=async()=>{
    const f=await ownerFixture(false,'cheap-history'),parentHash=toBeHex(9n,32),beforeWords=new Map(f.words),beforeBalances=[...f.balances],beforeAllowances=[...f.allowances];
    const amount=11n,fundingToken=f.scope.poolTokens[1],data=f.abi.encodeFunctionData('topUpPrivateOrder',[9n,1n,1n,{ciphertext:{ciphertextHigh:1n,ciphertextLow:amount},signature:`0x${'44'.repeat(65)}`}]),receipt=f.ownerMine({data},'refresh');
    receipt.logs.push({address:f.c.core,...f.abi.encodeEventLog(f.abi.getEvent('FixedPositionToppedUp')!,[9n])});
    for(const [index,[address]]of f.c.tokens.entries())if(f.scope.poolTokens.includes(address)){
      const debit=address===fundingToken?amount:0n;f.balances[index]-=debit;f.allowances[index]-=debit;
      receipt.logs.push({address,...approval.encodeEventLog(approval.getEvent('Approval')!,[owner,f.c.core,[1n,f.allowances[index]],[999n,0n]])},{address,...transfer.encodeEventLog(transfer.getEvent('Transfer')!,[owner,f.c.core,[1n,debit],[999n,0n]])});
    }
    const original=f.provider.send.getMockImplementation()!;
    f.provider.send.mockImplementation(async(method,params)=>{
      if(method==='eth_getBlockByNumber'&&params[0]==='0x9')return{number:'0x9',hash:parentHash,timestamp:'0x63'};
      if(method==='eth_getBlockByNumber'){const block=await original(method,params);if(!block||typeof block!=='object')throw new Error('Test block is unavailable');return{...block,parentHash};}
      if(params.at(-1)?.blockHash===parentHash){if(method==='eth_getStorageAt')return toBeHex(beforeWords.get(`${params[0]}:${BigInt(params[1])}`)??0n,32);return original(method,[...params.slice(0,-1),{blockHash:hash,requireCanonical:true}]);}
      return original(method,params);
    });
    mocks.funds.mockImplementation(async({head})=>({tokens:f.c.tokens.map(([address],index)=>({address,balance:(head.hash===parentHash?beforeBalances:f.balances)[index],allowance:(head.hash===parentHash?beforeAllowances:f.allowances)[index]}))}));
    mocks.small.mockClear();mocks.wide.mockClear();
    return{...f,receipt,amount,parentHash,request:{transactionHash:txHash,positionId:9n,expectedAmount:amount}};
  };
  it('verifies one mined top-up with its parent baseline and brands only the exact proof without encryption or sending',async()=>{
    const f=await recoveredFixture(),proof=await f.cap.verifyMinedTopUp(f.request);
    expect(proof).toMatchObject({phase:'limit-topup-reconciliation',nonce:4,transactionHash:txHash,positionId:9n,topUpAmount:11n,readyToSign:false,result:{refreshRequired:true,values:null,amounts:null,termsRevision:1n}});
    assertCurrentLimitPrepared(proof,f.signer);expect(()=>assertCurrentLimitPrepared({...proof},f.signer)).toThrow();expect(()=>assertCurrentLimitPrepared(proof,{})).toThrow();
    expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();expect(f.provider.send.mock.calls.every(([method])=>!['eth_sendTransaction','eth_sendRawTransaction'].includes(method))).toBe(true);
  });
  it.each(['amount','hash','position','revision','wallet','history','parent','reorg','privacy']as const)('retains no usable proof for %s failure',async fault=>{
    const f=await recoveredFixture(),request={...f.request};
    if(fault==='amount')request.expectedAmount++;if(fault==='hash')request.transactionHash=toBeHex(99n,32);if(fault==='position')request.positionId++;
    if(fault==='revision')f.set(f.c.core,slot(24n,l.coreSources)+9n,3n);
    if(fault==='wallet')f.balances[f.c.tokens.findIndex(([address])=>address===f.scope.poolTokens[1])]--;
    if(fault==='privacy')f.replaceAes();
    if(['history','parent','reorg'].includes(fault)){const original=f.provider.send.getMockImplementation()!;let checks=0;f.provider.send.mockImplementation(async(method,params)=>{
      if(fault==='history'&&params.at(-1)?.blockHash===f.parentHash)throw new Error('Historical state unavailable');
      const result=await original(method,params);
      if(method==='eth_getBlockByNumber'){
        if(!result||typeof result!=='object')throw new Error('Test block is unavailable');
        if(params[0]==='0x9'&&fault==='parent')return{...result,hash:toBeHex(999n,32)};
        if(params[0]==='0xa'&&fault==='reorg'&&++checks>2)return{...result,hash:toBeHex(999n,32)};
      }
      return result;
    });}
    await expect(f.cap.verifyMinedTopUp(request)).rejects.toThrow();expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();
  });
});
describe('approved receipt-only Limit top-up repair',()=>{
  afterEach(()=>vi.restoreAllMocks());
  const approvedFixture=async()=>{
    const f=await ownerFixture(false,'cheap-history');f.expected.splice(0,8,250000n,0n,2n,1n,1000n,250000n,0n,0n);f.snapshot();
    f.set(f.engine,slot(24n,l.engineStatus),1n);for(const [host,root]of [[f.c.core,l.coreSources],[f.engine,l.engineSources]]as const)f.set(host,slot(24n,root)+11n,2n);
    const data=f.abi.encodeFunctionData('topUpPrivateOrder',[9n,1n,2n,{ciphertext:{ciphertextHigh:1n,ciphertextLow:250000n},signature:`0x${'44'.repeat(65)}`}]),receipt=f.ownerMine({data},'refresh');
    receipt.logs.push({address:f.c.core,...f.abi.encodeEventLog(f.abi.getEvent('FixedPositionToppedUp')!,[9n])});
    for(const [index,[address]]of f.c.tokens.entries())if(f.scope.poolTokens.includes(address)){
      f.allowances[index]=0n;receipt.logs.push({address,...approval.encodeEventLog(approval.getEvent('Approval')!,[owner,f.c.core,[1n,0n],[999n,0n]])},{address,...transfer.encodeEventLog(transfer.getEvent('Transfer')!,[owner,f.c.core,[1n,address===f.scope.poolTokens[1]?250000n:0n],[999n,0n]])});
    }
    Object.assign(await f.provider.getTransaction(txHash),{gasLimit:30000000n,gasPrice:50000000n});Object.assign(receipt,{gasPrice:50000000n});
    const original=f.provider.send.getMockImplementation()!;
    f.provider.send.mockImplementation(async(method,params)=>{const result=await original(method,params);if(method==='eth_getTransactionByHash'){if(!result||typeof result!=='object')throw new Error('Test transaction unavailable');return{...result,gas:'0x1c9c380',gasPrice:'0x2faf080'};}return result;});
    // The policy pins the real receipt separately; this suite uses the existing synthetic owner fixture.
    const eligibility=vi.spyOn(limitPolicy,'isCurrentAppLimitTopUpRepair').mockImplementation(proof=>proof.graph===f.c.graph&&proof.owner===owner&&proof.hash===txHash&&proof.positionId===9n&&proof.amount===250000n);
    mocks.small.mockClear();mocks.wide.mockClear();f.provider.send.mockClear();
    return{...f,receipt,eligibility,request:{transactionHash:txHash,positionId:9n,expectedAmount:250000n}};
  };
  it('proves private debits and zero allowances without claiming a historical wallet delta or current inventory',async()=>{
    const f=await approvedFixture(),proof=await f.cap.verifyMinedTopUp(f.request);
    expect(proof).toMatchObject({privateReceiptDebitsVerified:true,privateWalletDeltaVerified:false,receiptBlock:{number:10n,hash},result:{status:1n,values:null,amounts:null,refreshRequired:true}});
    assertCurrentLimitPrepared(proof,f.signer);assertCurrentLimitPrepared(proof.result,f.signer);
    expect(f.provider.send.mock.calls.some(([method,params])=>method==='eth_getBlockByNumber'&&params[0]==='0x9')).toBe(false);
    expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();expect(f.provider.send.mock.calls.some(([method])=>['eth_sendTransaction','eth_sendRawTransaction'].includes(method))).toBe(false);
  });
  it.each(['debit','approval','allowance','snapshot','price','status','lifecycle','fees','foreign','duplicate']as const)('rejects approved repair %s drift',async fault=>{
    const f=await approvedFixture(),address=f.scope.poolTokens[1],index=f.c.tokens.findIndex(([token])=>token===address);
    if(fault==='debit')f.receipt.logs.find(row=>row.address===address&&row.topics[0]===transfer.getEvent('Transfer')!.topicHash)!.data=transfer.encodeEventLog(transfer.getEvent('Transfer')!,[owner,f.c.core,[1n,250001n],[999n,0n]]).data;
    if(fault==='approval')f.receipt.logs.find(row=>row.address===address&&row.topics[0]===approval.getEvent('Approval')!.topicHash)!.data=approval.encodeEventLog(approval.getEvent('Approval')!,[owner,f.c.core,[1n,1n],[999n,0n]]).data;
    if(fault==='allowance')f.allowances[index]=1n;if(fault==='snapshot'){f.expected[0]++;f.expected[5]++;f.snapshot();}
    if(fault==='price'){f.expected[2]=1n;f.expected[3]=2n;f.snapshot();}
    if(fault==='status')f.set(f.engine,slot(24n,l.engineStatus),0n);
    if(fault==='lifecycle')for(const [host,root]of [[f.c.core,l.coreSources],[f.engine,l.engineSources]]as const)f.set(host,slot(24n,root)+11n,3n);
    if(fault==='fees')Object.assign(await f.provider.getTransaction(txHash),{gasPrice:50000001n});
    if(fault==='foreign')f.receipt.logs.push({...f.receipt.logs[1],address:owner});if(fault==='duplicate')f.receipt.logs.push({...f.receipt.logs[1]});
    await expect(f.cap.verifyMinedTopUp(f.request)).rejects.toThrow();expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();
  });
  it('keeps historical proof mandatory when the exact repair policy does not match',async()=>{
    const f=await approvedFixture();f.eligibility.mockReturnValue(false);
    await expect(f.cap.verifyMinedTopUp(f.request)).rejects.toThrow(/parent/);
    expect(f.provider.send.mock.calls.some(([method,params])=>method==='eth_getBlockByNumber'&&params[0]==='0x9')).toBe(true);
  });
});
describe('current owner Limit discovery capability',()=>{
  it.each(['cheap-exit','cheap-history']as const)('finds the wallet Limit on %s without signing or decoding its amounts',async key=>{
    const f=await ownerFixture(true,key,2);f.set(f.c.core,11n,42n);mocks.decrypt.mockClear();
    const r=await f.cap.readOwnedOrders();expect(r).toMatchObject({complete:true,readyToSign:false,orders:[{positionId:9n,marketId:f.pair!.marketId,poolTokens:f.pair!.tokens,status:0n}]});
    expect(mocks.decrypt).not.toHaveBeenCalled();expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();
  });
  it('rejects a changed canonical inventory block',async()=>{
    const f=await ownerFixture(true,'cheap-exit');f.set(f.c.core,11n,42n);
    const original=f.provider.send.getMockImplementation()!;let heads=0;
    f.provider.send.mockImplementation(async(method,params)=>method==='eth_getBlockByNumber'&&++heads>1?{number:'0xa',hash:toBeHex(999n,32),timestamp:'0x64',transactions:[txHash]}:original(method,params));
    await expect(f.cap.readOwnedOrders()).rejects.toThrow(/chain head changed/);
  });
});
describe('shared Limit owner-state read',()=>{
  const closeFixture=async(key:'cheap-exit'|'cheap-history'='cheap-exit')=>{const f=await ownerFixture(true,key,2);f.ownerMine({data:f.abi.encodeFunctionData('closePrivateOrder',[9n])},'close');mocks.small.mockClear();mocks.wide.mockClear();mocks.decrypt.mockClear();f.provider.getTransaction.mockClear();f.provider.getTransactionReceipt.mockClear();return f;};
  it('restores the new deployment closed order without private inputs or transaction lookup',async()=>{
    const f=await closeFixture('cheap-history'),state=await f.cap.readClosedOrder({positionId:9n});
    expect(state).toMatchObject({closed:true,readyToSign:false,marketId:f.pair!.marketId,amounts:{unspent:0n,proceeds:0n}});
    expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();expect(f.provider.getTransaction).not.toHaveBeenCalled();
  });
  it.each([false,true])('restores private closed state after slot reuse %s without encryption or a transaction',async reused=>{
    const f=await closeFixture();if(reused){f.set(f.engine,slot(0n,ol.engineDirectory),99n);f.set(f.engine,slot(0n,ol.engineEpochs),2n);}
    const closed=await f.cap.readClosedOrder({positionId:9n});expect(closed).toMatchObject({closed:true,transactionHash:null,refreshRequired:false,readyToSign:false,amounts:{unspent:0n,proceeds:0n,priceNumerator:3n,priceDenominator:1n},marketId:f.pair!.marketId});
    expect(closed.values![5]).toBe(0n);expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();expect(f.provider.getTransaction).not.toHaveBeenCalled();expect(f.provider.getTransactionReceipt).not.toHaveBeenCalled();
    expect(()=>assertCurrentLimitPrepared(closed,f.signer)).toThrow();
    await expect(f.cap.prepareOwnerAction({positionId:9n,action:'claim',snapshot:closed,expectedContext:closed.context,confirm:async()=>true})).rejects.toThrow();
  });
  it.each(['owner','burn','approval','same-epoch-occupant','old-source','epoch','funds','context','canonical','privacy','lease']as const)('rejects closed restoration %s drift',async fault=>{
    const f=await closeFixture(),nft=f.c.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];
    if(fault==='owner')f.set(f.engine,slot(9n,ol.engineCloseOwner),BigInt(f.c.core));
    if(fault==='burn')f.set(nft,slot(9n,ol.nftOwners),BigInt(owner));if(fault==='approval')f.set(nft,slot(9n,ol.nftApprovals),1n);
    if(fault==='same-epoch-occupant')f.set(f.engine,slot(0n,ol.engineDirectory),99n);
    if(fault==='old-source'){f.set(f.engine,slot(0n,ol.engineDirectory),24n);f.set(f.engine,slot(0n,ol.engineEpochs),2n);}
    if(fault==='epoch')f.set(f.engine,slot(0n,ol.engineEpochs),0n);
    if(fault==='funds')f.set(f.engine,slot(9n,l.engineSnapshots)+3n,1n);
    if(fault==='privacy')f.replaceAes();if(fault==='lease')f.revoke();
    if(fault==='canonical'){const original=f.provider.send.getMockImplementation()!;let heads=0;f.provider.send.mockImplementation(async(method,params)=>method==='eth_getBlockByNumber'&&++heads>1?{number:'0xa',hash:toBeHex(999n,32),timestamp:'0x64',transactions:[txHash]}:original(method,params));}
    await expect(f.cap.readClosedOrder({positionId:9n,...(fault==='context'?{expectedContext:'stale'}:{})})).rejects.toThrow();
  });
  it('reads the exact current market,owner,source and encrypted snapshot without issuing signing authority',async()=>{
    const f=await ownerFixture(true,'cheap-exit',2);mocks.decrypt.mockClear();
    const state=await readCurrentLimitOwnerState({candidate:'cheap-exit',selectedPair:f.pair!.tokens,owner,positionId:9n,block:{number:10n,hash},rpc:f.provider.send,assertCurrent:async()=>{},attest:async()=>({registryRevision:7n,marketRevision:1n})});
    expect(state).toMatchObject({positionId:9n,sourceId:24n,status:0n,closed:false,terms:1n,ownership:1n,lifecycle:1n,marketId:f.pair!.marketId,nftBalance:1n});
    expect(state.snapshot).toHaveLength(32);expect(mocks.decrypt).not.toHaveBeenCalled();expect(Object.keys(state)).not.toContain('readyToSign');
  });
  it('rejects a former owner before returning encrypted state',async()=>{
    const f=await ownerFixture(true,'cheap-exit');f.changeOwner();
    await expect(readCurrentLimitOwnerState({candidate:'cheap-exit',selectedPair:f.pair!.tokens,owner,positionId:9n,block:{number:10n,hash},rpc:f.provider.send,assertCurrent:async()=>{},attest:async()=>({registryRevision:7n,marketRevision:1n})})).rejects.toThrow(/own/);
  });
});
describe('source-bound plain Limit owner lifecycle',()=>{
  it.each([true,false])('refreshes eight owner values and closes direction %s without ownerOf on burned NFT',async direction=>{
    const f=await ownerFixture(direction);expect(f.result.amounts).toMatchObject({unspent:100n,proceeds:7n,sellToken0:direction});
    const prepared=(await f.prepare('close'))!;await prepared.assertAuthority({number:10n,hash});f.ownerMine(prepared,'close');
    const closed=(await prepared.readResult(txHash))!;expect(closed).toMatchObject({closed:true,refreshRequired:false,lifecycleRevision:2n,amounts:{unspent:0n,proceeds:0n}});expect(closed.values![5]).toBe(0n);
  });
  it.each(['claim','pause']as const)('%s revokes amount authority without updating stored envelopes',async action=>{
    const f=await ownerFixture(),prepared=(await f.prepare(action))!;f.ownerMine(prepared,action);const result=(await prepared.readResult(txHash))!;
    expect(result).toMatchObject({values:null,amounts:null,refreshRequired:true});expect(f.words.get(`${engine}:${slot(9n,l.engineSnapshots)+7n}`)).toBe(7n);
    await expect(f.cap.prepareOwnerAction({positionId:9n,action:'close',snapshot:result,expectedContext:result.context,confirm:async()=>true})).rejects.toThrow(/Refresh/);
  });
  it.each(['owner','terms','lifecycle','allowance','forged','context'])('rejects %s before signing',async fault=>{
    const f=await ownerFixture();if(fault==='owner')f.changeOwner();if(fault==='terms'||fault==='lifecycle')for(const [host,root]of [[c.core,l.coreSources],[engine,l.engineSources]]as const)f.set(host,slot(24n,root)+(fault==='terms'?9n:11n),2n);
    if(fault==='allowance'){const p=(await f.prepare('claim'))!;f.allowances[0]=1n;await expect(p.assertAuthority({number:10n,hash})).rejects.toThrow();return;}
    await expect(f.cap.prepareOwnerAction({positionId:9n,action:'claim',snapshot:fault==='forged'?{...f.result}:f.result,expectedContext:fault==='context'?'bad':f.result.context,confirm:async()=>true})).rejects.toThrow();
  });
  it.each(['payout','wallet','receipt','snapshot','burn','terms'])('rejects %s in canonical Close readback',async fault=>{
    const f=await ownerFixture(),p=(await f.prepare('close'))!,r=f.ownerMine(p,'close');
    if(fault==='payout')r.logs[1].data=transfer.encodeEventLog(transfer.getEvent('Transfer')!,[c.core,owner,[999n,0n],[1n,8n]]).data;
    if(fault==='wallet')f.balances[0]++;if(fault==='receipt')r.status=0;if(fault==='snapshot')f.set(engine,slot(9n,l.engineSnapshots)+23n,100n);
    if(fault==='burn')r.logs.pop();if(fault==='terms')f.set(engine,slot(24n,l.engineSources)+9n,2n);
    await expect(p.readResult(txHash)).rejects.toThrow();
  });
  it('rejects treating Claim as a new stored snapshot',async()=>{const f=await ownerFixture(),p=(await f.prepare('claim'))!;f.ownerMine(p,'claim');f.set(engine,slot(9n,l.engineSnapshots)+7n,0n);await expect(p.readResult(txHash)).rejects.toThrow(/snapshot/);});
  it('explicit fresh snapshot restores authority after Claim, with current rather than original amounts',async()=>{
    const f=await ownerFixture(),claim=(await f.prepare('claim'))!;f.ownerMine(claim,'claim');await claim.readResult(txHash);
    const refresh=(await f.cap.prepareOwnerAction({positionId:9n,action:'refresh',confirm:async()=>true}))!;f.expected[1]=0n;f.snapshot();f.ownerMine(refresh,'refresh');const current=(await refresh.readResult(txHash))!;
    expect(current.amounts?.proceeds).toBe(0n);expect(current.refreshRequired).toBe(false);await expect(f.cap.prepareOwnerAction({positionId:9n,action:'close',snapshot:current,expectedContext:current.context,confirm:async()=>true})).resolves.toMatchObject({action:'close'});
  });
  it('implements source-derived Pause 0→1 and Resume 1→0 with fresh lifecycle authority, separately from sender admission',async()=>{
    const f=await ownerFixture(),pause=(await f.prepare('pause'))!;f.ownerMine(pause,'pause');await pause.readResult(txHash);
    const refresh=(await f.cap.prepareOwnerAction({positionId:9n,action:'refresh',confirm:async()=>true}))!;f.ownerMine(refresh,'refresh');const current=(await refresh.readResult(txHash))!;
    const resume=(await f.cap.prepareOwnerAction({positionId:9n,action:'resume',snapshot:current,expectedContext:current.context,confirm:async()=>true}))!;expect(abi.decodeFunctionData('managePrivateOrderStatus',resume.data).toArray()).toEqual([9n,2n,1n]);f.ownerMine(resume,'resume');expect(await resume.readResult(txHash)).toMatchObject({status:0n,lifecycleRevision:3n,amounts:null,refreshRequired:true});
  });
});
describe('genuine current owner Limit preparation',()=>{
  it.each([true,false])('authenticates exact offered debit, then stored owner snapshot for direction %s',async direction=>{
    const f=await fixture(direction),prepared=(await f.cap.prepareLimit(f.request))!;assertCurrentLimitPrepared(prepared,f.signer);
    expect(mocks.small.mock.calls.map(x=>x[1])).toEqual([direction?1n:0n,0n,3n,1n,1n,1n,2n]);expect(mocks.wide.mock.calls.map(x=>x[1])).toEqual([9007199254740993n,0n,0n,0n]);
    f.mine(prepared.data);const created=(await prepared.readResult(txHash))!;expect(created.positionId).toBe(9n);expect(mocks.decrypt.mock.calls).toHaveLength(2);
    const snapshot=(await created.prepareSnapshot!(async()=>true))!;f.mine(snapshot.data,true);mocks.decrypt.mockClear();
    await expect(snapshot.readResult(txHash)).resolves.toMatchObject({positionId:9n,intent:f.request.intent});expect(mocks.decrypt.mock.calls.map(x=>x[1].ciphertextHigh)).toEqual([1n,2n,3n,4n,5n,6n,7n,8n]);
    expect(f.provider.send.mock.calls.some(([method,params])=>method==='eth_call'&&params[0].to===c.core)).toBe(false);
  });
  it.each(['cancel','locked','revoked','direction','amount','terms','witness','graph'])('rejects %s before private prompts',async fault=>{
    const f=await fixture();const request={...f.request,confirm:async()=>true,graph:{...f.request.graph,expectedGraph:f.request.graph.expectedGraph as string},intent:{...f.request.intent,terms:[...f.request.intent.terms] as readonly [bigint,bigint,bigint,bigint,bigint]}};
    if(fault==='cancel')request.confirm=async()=>false;if(fault==='locked')f.lock();if(fault==='revoked')f.revoke();if(fault==='direction')request.intent.sellToken0=1 as never;
    if(fault==='amount')request.intent.amount=0n;if(fault==='terms')request.intent.terms=[3n,1n,-1n,1n,2n];if(fault==='witness')request.intent.terms=[3n,1n,1n,0n,0n];if(fault==='graph')request.graph.expectedGraph='bad';
    if(fault==='cancel')await expect(f.cap.prepareLimit(request)).resolves.toBeNull();else await expect(f.cap.prepareLimit(request)).rejects.toThrow();expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();
  });
  it.each(['owner','mapping','revision','mode','direction','budget','price','minimum','envelope','debit','receipt'])('rejects %s authenticated result drift',async fault=>{
    const f=await fixture(),prepared=(await f.cap.prepareLimit(f.request))!;const receipt=f.mine(prepared.data);
    if(fault==='debit'){receipt.logs[2].data=transfer.encodeEventLog(transfer.getEvent('Transfer')!,[owner,c.core,[1n,1n],[999n,0n]]).data;await expect(prepared.readResult(txHash)).rejects.toThrow(CurrentLimitProofMismatch);return;}
    if(fault==='receipt'){receipt.status=0;await expect(prepared.readResult(txHash)).rejects.toThrow();return;}
    const created=(await prepared.readResult(txHash))!,snapshot=(await created.prepareSnapshot!(async()=>true))!;f.mine(snapshot.data,true);
    if(fault==='owner')f.changeOwner();if(fault==='mapping')f.set(engine,slot(9n,l.engineMapping),25n);if(fault==='revision')f.set(engine,slot(24n,l.engineSources)+9n,2n);
    const index={mode:7,direction:6,budget:0,price:2,minimum:4}[fault];if(index!==undefined)f.set(engine,slot(9n,l.engineSnapshots)+BigInt(index*4+3),999n);
    if(fault==='envelope'){f.set(engine,slot(9n,l.engineSnapshots)+2n,0n);f.set(engine,slot(9n,l.engineSnapshots)+3n,0n);}
    await expect(snapshot.readResult(txHash)).rejects.toThrow();
  });
});



describe('selected native Limit issuer',()=>{
  it.each([true,false])('binds selected Core/Engine/NFT and exact token budget for direction %s',async direction=>{
    const f=await fixture(direction,'cheap-native'),c=resolveCurrentCheapDexCandidate('cheap-native'),p=(await f.cap.prepareLimit(f.request))!;expect(p).toMatchObject({to:c.core,graph:c.graph,packageSha256:c.packageSha256,readyToSign:false});expect(mocks.graph).toHaveBeenCalledWith(expect.objectContaining({candidate:'cheap-native'}));expect([...mocks.small.mock.calls,...mocks.wide.mock.calls].every(x=>x[2]===c.core)).toBe(true);
    f.mine(p.data);const result=(await p.readResult(txHash))!;expect(result).toMatchObject({positionId:9n,sourceId:24n});const snapshot=(await result.prepareSnapshot(async()=>true))!;f.mine(snapshot.data,true);expect(await snapshot.readResult(txHash)).toMatchObject({positionId:9n});assertCurrentLimitPrepared(snapshot,f.signer);
  });
  it('rejects cross-candidate graph before private encryption',async()=>{const f=await fixture(true,'cheap-native');f.request.graph.expectedGraph=c.graph;await expect(f.cap.prepareLimit(f.request)).rejects.toThrow('Wrong Limit');expect(mocks.wide).not.toHaveBeenCalled();});
  it.each([true,false])('keeps selected private owner snapshot/proceeds/close accounting for direction %s',async direction=>{
    const f=await ownerFixture(direction,'cheap-native'),native=resolveCurrentCheapDexCandidate('cheap-native');expect(f.result.amounts).toMatchObject({unspent:100n,proceeds:7n,sellToken0:direction});const p=(await f.prepare('close'))!;expect(p).toMatchObject({to:native.core,graph:native.graph,packageSha256:native.packageSha256,readyToSign:false});f.ownerMine(p,'close');expect(await p.readResult(txHash)).toMatchObject({closed:true,amounts:{unspent:0n,proceeds:0n}});
  });
  it('rejects selected owner preparation after lease loss',async()=>{const f=await fixture(true,'cheap-native');f.revoke();await expect(f.cap.prepareLimit(f.request)).rejects.toThrow('Revoked');});
});

describe('selected six-market Limit preparation and accounting',()=>{
  it('binds new History candidate creation, snapshot and funding review to its selected market',async()=>{
    const f=await fixture(false,'cheap-history',4),p=(await f.cap.prepareLimit(f.request))!;
    expect(p).toMatchObject({to:f.c.core,graph:f.c.graph,packageSha256:f.c.packageSha256,marketId:f.pair!.marketId,poolTokens:f.pair!.tokens,readyToSign:false});
    expect(f.abi.decodeFunctionData('createPrivateOrder',p.data)[0]).toBe(f.pair!.marketId);
    assertCurrentLimitPrepared(p,f.signer);expect(()=>assertCurrentLimitPrepared({...p},f.signer)).toThrow();
    await p.assertAuthority({number:10n,hash});f.mine(p.data);
    const created=(await p.readResult(txHash))!;expect(created).toMatchObject({marketId:f.pair!.marketId,positionId:9n,sourceId:24n});
    const snapshot=(await created.prepareSnapshot(async()=>true))!;f.mine(snapshot.data,true);
    expect(await snapshot.readResult(txHash)).toMatchObject({marketId:f.pair!.marketId,positionId:9n,sourceId:24n});
    const review=await f.cap.prepareFundingReview({kind:'create',sellToken0:false,amount:11n});
    expect(review).toMatchObject({marketId:f.pair!.marketId,poolTokens:f.pair!.tokens,to:f.c.core,fundingToken:f.scope.poolTokens[1],readyToSign:false});
    expect(mocks.registry).toHaveBeenCalledWith(expect.objectContaining({candidate:'cheap-history'}));
  });
  it.each([0,2,5])('rejects inadequate exact funding in pair %i before review or encrypted-input signatures',async index=>{
    for(const direction of [true,false])for(const fault of ['balance','insufficient-allowance','excess-allowance']as const){
      const f=await fixture(direction,'cheap-exit',index),offered=f.c.tokens.findIndex(([token])=>token===f.pair!.tokens[direction?0:1]),amount=f.request.intent.amount;
      if(fault==='balance')f.balances[offered]=amount-1n;
      else f.allowances[offered]=amount+(fault==='insufficient-allowance'?-1n:1n);
      await expect(f.cap.prepareLimit(f.request)).rejects.toThrow(fault==='balance'?/balance/:/allowance/);
      expect(f.request.confirm).not.toHaveBeenCalled();expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();
    }
  });
  it.each([true,false])('accepts exactly funded direction %s without requiring unrelated token allowances',async direction=>{
    const f=await fixture(direction,'cheap-exit',4),offered=f.c.tokens.findIndex(([token])=>token===f.pair!.tokens[direction?0:1]);
    f.balances[offered]=f.request.intent.amount;
    const prepared=await f.cap.prepareLimit(f.request);expect(prepared).toMatchObject({phase:'limit-create',marketId:f.pair!.marketId});
    expect(f.request.confirm).toHaveBeenCalledOnce();expect(mocks.wide.mock.calls[0][1]).toBe(f.request.intent.amount);
  });
  it.each(Array.from({length:6},(_,index)=>index))('binds pair %i in both directions to its market ABI, Engine and exact four-token accounting',async index=>{
    for(const direction of [true,false]){
      const f=await fixture(direction,'cheap-exit',index),p=(await f.cap.prepareLimit(f.request))!;
      expect(p.marketId).toBe(f.pair!.marketId);expect(p.poolTokens).toEqual(f.pair!.tokens);
      expect(f.abi.decodeFunctionData('createPrivateOrder',p.data)[0]).toBe(f.pair!.marketId);
      expect([...mocks.small.mock.calls,...mocks.wide.mock.calls].every(call=>call[3]===f.abi.getFunction('createPrivateOrder')!.selector)).toBe(true);
      await p.assertAuthority({number:10n,hash});f.mine(p.data);
      const created=(await p.readResult(txHash))!;expect(created).toMatchObject({marketId:f.pair!.marketId,poolTokens:f.pair!.tokens,positionId:9n,sourceId:24n,readyToSign:false});
      const snap=(await created.prepareSnapshot(async()=>true))!;f.mine(snap.data,true);
      expect(await snap.readResult(txHash)).toMatchObject({marketId:f.pair!.marketId,positionId:9n,sourceId:24n});
      expect(mocks.registry).toHaveBeenCalledWith(expect.objectContaining({candidate:'cheap-exit'}));
      expect(f.provider.send.mock.calls.filter(([method])=>method==='eth_getStorageAt').some(([,params])=>params[0]===f.engine)).toBe(true);
    }
  });
  it.each(Array.from({length:6},(_,index)=>index))('pays only selected pair %i, preserves other tokens, and keeps source ID separate from NFT ID',async index=>{
    for(const direction of [true,false]){
      const f=await ownerFixture(direction,'cheap-exit',index),p=(await f.prepare('close'))!;
      expect(f.result).toMatchObject({positionId:9n,sourceId:24n,marketId:f.pair!.marketId});
      await p.assertAuthority({number:10n,hash});const receipt=f.ownerMine(p,'close');
      expect(receipt.logs.filter(log=>f.c.tokens.some(([address])=>address===log.address)).map(log=>log.address).sort()).toEqual([...f.pair!.tokens].sort());
      expect(await p.readResult(txHash)).toMatchObject({closed:true,marketId:f.pair!.marketId,amounts:{unspent:0n,proceeds:0n}});
    }
  });
  it.each(['market','mapping','registry-engine','registry-revision','key'] as const)('rejects %s owner authority drift before any send',async fault=>{
    const f=await ownerFixture(true,'cheap-exit',3);
    if(fault==='market')f.set(f.c.core,slot(9n,CURRENT_LIMIT_MARKET_FOR_POSITION),BigInt(STAGED_EXIT_PREVIEW_DEX_CANDIDATE.pairs[0].marketId));
    if(fault==='mapping')f.set(f.engine,slot(9n,l.engineMapping),25n);
    if(fault==='registry-engine'){const original=mocks.registry.getMockImplementation()!;mocks.registry.mockImplementation(async args=>{const result=await original(args);return{...result,markets:result.markets.map((m:{marketId:string;engine:string})=>m.marketId===f.pair!.marketId?{...m,engine:f.c.core}:m)};});}
    if(fault==='registry-revision')f.bumpRegistry();if(fault==='key')f.replaceAes();
    await expect(f.prepare('claim')).rejects.toThrow();
  });
  it('reads status at source ID, not at the distinct NFT ID',async()=>{
    const f=await ownerFixture(true,'cheap-exit',3);f.set(f.engine,slot(9n,l.engineStatus),1n);
    expect(await f.prepare('claim')).toMatchObject({positionId:9n});
  });
  it.each(['other-wallet','other-log','selected-payout','allowance','canonical'] as const)('rejects %s after owner payout',async fault=>{
    const f=await ownerFixture(false,'cheap-exit',4),p=(await f.prepare('close'))!,receipt=f.ownerMine(p,'close'),other=f.c.tokens.findIndex(([address])=>!f.pair!.tokens.some(token=>token===address));
    if(fault==='other-wallet')f.balances[other]++;
    if(fault==='other-log')receipt.logs.push({address:f.c.tokens[other][0],...transfer.encodeEventLog(transfer.getEvent('Transfer')!,[f.c.core,owner,[999n,0n],[1n,0n]])});
    if(fault==='selected-payout')receipt.logs[1].data=transfer.encodeEventLog(transfer.getEvent('Transfer')!,[f.c.core,owner,[999n,0n],[1n,999n]]).data;
    if(fault==='allowance')f.allowances[other]++;
    if(fault==='canonical'){const original=f.provider.send.getMockImplementation()!;f.provider.send.mockImplementation(async(method,params)=>method==='eth_getTransactionReceipt'?{...await original(method,params) as {transactionHash:string;status:string;blockNumber:string;transactionIndex:string},status:'0x0'}:original(method,params));}
    await expect(p.readResult(txHash)).rejects.toThrow();
  });
  it.each(['other-wallet','other-log','allowance','market','registry'] as const)('rejects %s creation drift',async fault=>{
    const f=await fixture(true,'cheap-exit',5),p=(await f.cap.prepareLimit(f.request))!,receipt=f.mine(p.data),other=f.c.tokens.findIndex(([address])=>!f.pair!.tokens.some(token=>token===address));
    if(fault==='other-wallet')f.balances[other]++;
    if(fault==='other-log')receipt.logs.push({address:f.c.tokens[other][0],...transfer.encodeEventLog(transfer.getEvent('Transfer')!,[owner,f.c.core,[1n,0n],[999n,0n]])});
    if(fault==='allowance')f.allowances[other]++;if(fault==='market')f.set(f.c.core,slot(9n,CURRENT_LIMIT_MARKET_FOR_POSITION),0n);if(fault==='registry')f.bumpRegistry();
    await expect(p.readResult(txHash)).rejects.toThrow();
  });
  it('retains old prepared scope with explicit pair and rejects missing or wrong pairs before encryption',async()=>{
    const f=await fixture(true,'cheap-prepared',2),p=(await f.cap.prepareLimit(f.request))!;expect(p.marketId).toBe(f.pair!.marketId);
    mocks.small.mockClear();mocks.wide.mockClear();
    for(const selectedPair of [undefined,[f.pair!.tokens[0],f.pair!.tokens[0]],[f.pair!.tokens[0],owner]] as const)await expect(issueCurrentDexLimitCapability({candidate:'cheap-exit',selectedPair}as never)).rejects.toThrow('Limit market pair');
    expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();
  });
});


describe('current plain Limit edit preparation',()=>{
  const terms=[5n,2n,1n,1n,2n]as const;
  const edit=(f:Awaited<ReturnType<typeof ownerFixture>>,action:'topup'|'reprice',extra={})=>f.cap.prepareOwnerAction({positionId:9n,action,snapshot:f.result,expectedContext:f.result.context,confirm:async()=>true,...(action==='topup'?{topUpAmount:11n}:{newTerms:terms}),...extra});
  it.each([[true,'cheap-exit'],[false,'cheap-exit'],[false,'cheap-history']]as const)('binds exact top-up funding direction %s on %s, clears stale amount authority and checks the sender debit',async(direction,key)=>{
    const f=await ownerFixture(direction,key,2),prepared=(await edit(f,'topup'))!,call=f.abi.decodeFunctionData('topUpPrivateOrder',prepared.data);
    expect(call[0]).toBe(9n);expect(call[1]).toBe(1n);expect(call[2]).toBe(1n);expect(call[3].ciphertext.ciphertextLow).toBe(11n);
    expect(prepared).toMatchObject({fundingToken:f.scope.poolTokens[direction?0:1],topUpAmount:11n,expectedTermsRevision:1n});
    expect(mocks.wide).toHaveBeenLastCalledWith(f.signer,11n,f.c.core,f.abi.getFunction('topUpPrivateOrder')!.selector);
    const receipt=f.ownerMine(prepared,'refresh');receipt.logs.push({address:f.c.core,...f.abi.encodeEventLog(f.abi.getEvent('FixedPositionToppedUp')!,[9n])});
    for(const [address]of f.c.tokens){if(!f.scope.poolTokens.includes(address))continue;const amount=address===prepared.fundingToken?11n:0n,index=f.c.tokens.findIndex(([a])=>a===address);f.balances[index]-=amount;f.allowances[index]-=amount;receipt.logs.push({address,...approval.encodeEventLog(approval.getEvent('Approval')!,[owner,f.c.core,[1n,f.allowances[index]],[999n,0n]])},{address,...transfer.encodeEventLog(transfer.getEvent('Transfer')!,[owner,f.c.core,[1n,amount],[999n,0n]])});}
    f.set(f.c.core,slot(24n,l.coreSources)+13n,123n);f.set(f.engine,slot(24n,l.engineSources)+16n,456n);
    expect(await prepared.readResult(txHash)).toMatchObject({values:null,amounts:null,refreshRequired:true,termsRevision:1n,lifecycleRevision:1n,status:0n});
    await expect(prepared.assertAuthority({number:10n,hash})).rejects.toThrow(/changed/);
  });
  it.each(['missing-approval','duplicate-approval','approval-owner','approval-spender','approval-amount','approval-encoding','duplicate-transfer','transfer-amount','other-event']as const)('rejects top-up receipt fault %s',async fault=>{
    const f=await ownerFixture(false,'cheap-history'),prepared=(await edit(f,'topup'))!,receipt=f.ownerMine(prepared,'refresh');
    receipt.logs.push({address:f.c.core,...f.abi.encodeEventLog(f.abi.getEvent('FixedPositionToppedUp')!,[9n])});
    for(const address of f.scope.poolTokens){
      const index=f.c.tokens.findIndex(([a])=>a===address),debit=address===prepared.fundingToken?11n:0n;f.balances[index]-=debit;f.allowances[index]-=debit;
      const selected=address===prepared.fundingToken,a={address,...approval.encodeEventLog(approval.getEvent('Approval')!,[selected&&fault==='approval-owner'?f.c.core:owner,selected&&fault==='approval-spender'?owner:f.c.core,[1n,f.allowances[index]+(selected&&fault==='approval-amount'?1n:0n)],[999n,0n]])},t={address,...transfer.encodeEventLog(transfer.getEvent('Transfer')!,[owner,f.c.core,[1n,debit+(selected&&fault==='transfer-amount'?1n:0n)],[999n,0n]])};
      if(selected&&fault==='approval-encoding')a.data+='00';
      if(!(selected&&fault==='missing-approval'))receipt.logs.push(a);receipt.logs.push(t);
      if(selected&&fault==='duplicate-approval')receipt.logs.push({...a});if(selected&&fault==='duplicate-transfer')receipt.logs.push({...t});if(selected&&fault==='other-event')receipt.logs.push({...t,topics:[toBeHex(999n,32),...t.topics.slice(1)]});
    }
    f.set(f.c.core,slot(24n,l.coreSources)+13n,123n);f.set(f.engine,slot(24n,l.engineSources)+16n,456n);
    await expect(prepared.readResult(txHash)).rejects.toThrow(/top-up/);
  });
  it.each(['cheap-exit','cheap-history']as const)('encrypts exact repricing on %s with zero range terms, binds selector and leaves wallets fixed',async key=>{
    const f=await ownerFixture(true,key),prepared=(await edit(f,'reprice'))!,call=f.abi.decodeFunctionData('repricePrivateOrder',prepared.data);
    expect(call[2].map((x:{ciphertext:bigint})=>x.ciphertext)).toEqual(terms);expect(call[3].map((x:{ciphertext:{ciphertextLow:bigint}})=>x.ciphertext.ciphertextLow)).toEqual([0n,0n,0n]);
    expect(mocks.small).toHaveBeenLastCalledWith(f.signer,2n,f.c.core,f.abi.getFunction('repricePrivateOrder')!.selector);
    const receipt=f.ownerMine(prepared,'refresh');receipt.logs.push({address:f.c.core,...f.abi.encodeEventLog(f.abi.getEvent('FixedPositionRepriced')!,[9n,2n])});
    f.set(f.c.core,slot(24n,l.coreSources)+9n,2n);f.set(f.engine,slot(24n,l.engineSources)+9n,2n);
    expect(await prepared.readResult(txHash)).toMatchObject({values:null,amounts:null,refreshRequired:true,termsRevision:2n,lifecycleRevision:1n});
  });
  it.each(['zero','overflow','witness','extra','snapshot','context','allowance','balance'])('rejects %s before confirmation and encryption',async fault=>{
    const f=await ownerFixture(true,'cheap-exit'),confirm=vi.fn(async()=>true),extra:Record<string,unknown>={confirm};let action:'topup'|'reprice'='topup';
    if(fault==='zero')extra.topUpAmount=0n;if(fault==='overflow')extra.topUpAmount=(1n<<256n)-1n;
    if(fault==='witness'){action='reprice';extra.newTerms=[5n,2n,1n,0n,0n];}if(fault==='extra')extra.fundingToken=f.scope.poolTokens[1];if(fault==='snapshot')extra.snapshot={...f.result};if(fault==='context')extra.expectedContext='0x';
    const index=f.c.tokens.findIndex(([address])=>address===f.scope.poolTokens[0]);if(fault==='allowance')f.allowances[index]=0n;if(fault==='balance')f.balances[index]=0n;
    mocks.small.mockClear();mocks.wide.mockClear();await expect(edit(f,action,extra)).rejects.toThrow();expect(confirm).not.toHaveBeenCalled();expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();
  });
  it('copies repricing terms before asynchronous review',async()=>{
    const f=await ownerFixture(true,'cheap-exit'),mutable:bigint[]=[...terms],prepared=await edit(f,'reprice',{newTerms:mutable,confirm:async()=>{mutable[0]=99n;return true;}});
    expect(prepared!.newTerms).toEqual(terms);expect(Object.isFrozen(prepared!.newTerms)).toBe(true);
  });
  it.each(['cheap-exit','cheap-history']as const)('issues branded read-only funding review on %s with low allowance; revokes it on any private wallet change',async key=>{
    const f=await ownerFixture(false,key,2),token=f.scope.poolTokens[1],index=f.c.tokens.findIndex(([a])=>a===token);f.allowances[index]=0n;mocks.small.mockClear();mocks.wide.mockClear();
    const review=await f.cap.prepareFundingReview({kind:'topup',positionId:9n,snapshot:f.result,expectedContext:f.result.context,amount:11n});
    expect(review).toMatchObject({phase:'limit-funding-review',kind:'topup',fundingToken:token,amount:11n,readyToSign:false});assertCurrentLimitPrepared(review,f.signer);expect(()=>assertCurrentLimitPrepared({...review},f.signer)).toThrow();
    await review.assertAuthority({number:10n,hash});expect(mocks.small).not.toHaveBeenCalled();expect(mocks.wide).not.toHaveBeenCalled();f.allowances[index]=11n;await expect(review.assertAuthority({number:10n,hash})).rejects.toThrow(/changed/);
  });
  it('reviews creation funding and rejects forged top-up snapshot or direction fields',async()=>{
    const f=await ownerFixture(true,'cheap-exit');expect(await f.cap.prepareFundingReview({kind:'create',sellToken0:false,amount:1n})).toMatchObject({kind:'create',fundingToken:f.scope.poolTokens[1]});
    await expect(f.cap.prepareFundingReview({kind:'topup',positionId:9n,snapshot:{...f.result},expectedContext:f.result.context,amount:1n})).rejects.toThrow(/Refresh/);
    await expect(f.cap.prepareFundingReview({kind:'topup',positionId:9n,snapshot:f.result,expectedContext:f.result.context,amount:1n,sellToken0:false}as never)).rejects.toThrow(/Invalid/);
  });
});
