import { readFileSync } from 'node:fs';
import { Interface, keccak256 } from '@coti-io/coti-ethers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARCHIVED_CHEAP_DEX_CANDIDATE, CURRENT_CHEAP_DEX_CANDIDATE, STAGED_D06_DEX_CANDIDATE, STAGED_QUOTE_SLIPPAGE_CANDIDATE, STAGED_TWO_POOL_CANDIDATE,
  STAGED_POOL_REFERENCE_CANDIDATE, STAGED_NATIVE_DEX_CANDIDATE, currentCheapDexStages, currentCheapDexCandidateKey, currentCheapDexQuoteProtocol,
  resolveCurrentCheapDexCandidate, currentCheapDexOwnerActionEligible, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { decodeCurrentCheapDexOperation, CURRENT_SLIPPAGE_DEX_QUOTE_ABI } from './currentDexOperation';
import { createDexV2ReadCapability, readCurrentDexOperation, readCurrentDexPrincipalReceipt, readCurrentSharedPoolDexGraph } from './dexV2Chain';
import { issueCurrentDexQuoteCapability } from '../features/wallet/currentDexQuoteCapability';
import { issueCurrentDexReceiptCapability } from '../features/wallet/currentDexReceiptCapability';
import { issueCurrentDexSubmissionCapability } from '../features/wallet/currentDexSubmissionCapability';
import { buildCurrentDexQuoteReview, prepareCurrentDexAcceptance } from './currentDexQuoteReview';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY } from './currentDexPendingAttempt';
import { currentTokenFundingAbi, CURRENT_TOKEN_FAUCET_AMOUNT } from './currentDexTokenFunding';

const mocks = vi.hoisted(() => ({ hashes: new Map<string, string>(), owner: vi.fn(), wide: vi.fn(), decrypt: vi.fn(), bool: vi.fn() }));
vi.mock('@coti-io/coti-ethers', async original => {
  const actual = await original<typeof import('@coti-io/coti-ethers')>();
  return { ...actual, keccak256: (data: string) => mocks.hashes.get(data) ?? actual.keccak256(data) };
});
vi.mock('../features/wallet/ownerCotiMetaMaskCapability', () => ({ issueOwnerCotiMetaMaskCapability: mocks.owner }));
vi.mock('./privateUint256', () => ({ encryptPrivateUint256Input: mocks.wide, decryptPrivateUint256Output: mocks.decrypt }));
vi.mock('@coti-io/coti-sdk-typescript', () => ({ decryptUint: mocks.bool }));

const frozen = JSON.parse(readFileSync(new URL('../../../ChainWhisper Contracts V2/validation/reports/two-pool-app-stage-binding-2026-10-03/frozen-inputs.json', import.meta.url), 'utf8'));
const abi = new Interface(frozen.graphs['6d'].coreAbi);
const nativeAbi = new Interface(JSON.parse(readFileSync(new URL('../../reports/next-dex-app-2026-10-04/core-abi.json', import.meta.url), 'utf8')));
const d06Abi = new Interface(JSON.parse(readFileSync(new URL('../../reports/current-dex-c1-integration-2026-10-06/core-abi.json', import.meta.url), 'utf8')));
const zero = `0x${'00'.repeat(32)}`, context = `0x${'77'.repeat(32)}`, headHash = `0x${'88'.repeat(32)}`, owner = `0x${'22'.repeat(20)}`;
const engineABI = new Interface(['function core() view returns(address)', 'function releaseId() view returns(bytes32)',
  'function marketId() view returns(bytes32)', 'function positionNFT() view returns(address)', 'function inputToken() view returns(address)',
  'function outputToken() view returns(address)', 'function feePpm() view returns(uint32)', 'function maxWorkLifetime() view returns(uint32)',
  'function selector() view returns(address)', 'function selectorRuntimeHash() view returns(bytes32)']);
const factoryABI = new Interface(['snapshotOwner','recurringOwner','ownerLifecycle','orderWork','workLifecycle','rangeOwner','rangeWork','matchWork'].map(n=>`function ${n}() view returns(address)`));
const nftABI = new Interface(['function core() view returns(address)']), evaluatorABI = new Interface(['function bindingCommitment() view returns(bytes32)']);
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); mocks.hashes.clear(); });

async function fixture(key: CurrentCheapDexCandidateKey = 'cheap-reference') {
  const abi = key === 'cheap-d06' || key === 'cheap-current' ? d06Abi : key === 'cheap-native' ? nativeAbi : new Interface(frozen.graphs['6d'].coreAbi);
  vi.spyOn(Date, 'now').mockReturnValue(100_000);
  const c = resolveCurrentCheapDexCandidate(key), stages = currentCheapDexStages(c), blockNumber = BigInt(c.attestationBlock.number) + 20n;
  const at = (role: string) => c.runtimes.find(([n])=>n===role)![1], companion = (role: string)=>c.companions.find(([n])=>n===role)!;
  const engine=companion('ChainWhisperFixedEngine'), evaluator=companion('ChainWhisperDexWideTerminalGT'), nft=companion('ChainWhisperDexPositionNFT'), fast=companion('ChainWhisperDexFastPoolQuote');
  const codes=new Map<string,string>(); [...c.runtimes,...c.companions,...c.tokens.map(([a,h])=>['Token',a,h])].forEach(([,a,h],i)=>{const code=`0xcafe${i.toString(16).padStart(2,'0')}${key==='cheap-two-pool'?'01':'02'}`;codes.set(a,code);mocks.hashes.set(code,h);});
  const values: Record<string,Record<string,unknown>>={
    [c.core]: {releaseId:c.releaseId,marketId:c.marketId,feePpm:c.feePpm,maxWorkLifetime:c.maxWorkLifetime,tokenAdmissionCommitment:c.reviewedTokenSet,
      inputToken:c.tokens[0][0],outputToken:c.tokens[1][0],inputRuntimeHash:c.tokens[0][1],outputRuntimeHash:c.tokens[1][1],
      fixedEngine:engine[1],fixedEngineRuntimeHash:engine[2],terminalEvaluator:evaluator[1],terminalEvaluatorRuntimeHash:evaluator[2],
      positionNFT:nft[1],positionNFTRuntimeHash:nft[2],terminalEvaluatorBindingCommitment:c.evaluatorBinding,fastPoolQuote:fast[1],poolTerms:c.poolTerms},
    [engine[1]]:{core:c.core,releaseId:c.releaseId,marketId:c.marketId,positionNFT:nft[1],inputToken:c.tokens[0][0],outputToken:c.tokens[1][0],feePpm:c.feePpm,maxWorkLifetime:c.maxWorkLifetime,
      selector:at('ChainWhisperFixedBoundedSelector'),selectorRuntimeHash:c.runtimes.find(([n])=>n==='ChainWhisperFixedBoundedSelector')![2]},
    [evaluator[1]]:{bindingCommitment:c.evaluatorBinding},[nft[1]]:{core:c.core},[fast[1]]:{core:c.core},
    [at('ChainWhisperFixedEngineFactory')]:Object.fromEntries(['snapshotOwner','recurringOwner','ownerLifecycle','orderWork','workLifecycle','rangeOwner','rangeWork','matchWork'].map((n,i)=>[n,at(['ChainWhisperFixedOwner','ChainWhisperRecurringOwnerControls','ChainWhisperOrderOwnerLifecycle','ChainWhisperOrderWork','ChainWhisperFixedWorkLifecycle','ChainWhisperRangeOwner','ChainWhisperRangeWork','ChainWhisperFixedMatchWork'][i])]))
  };
  const interfaces:Record<string,Interface>={[c.core]:abi,[engine[1]]:engineABI,[evaluator[1]]:evaluatorABI,[nft[1]]:nftABI,[fast[1]]:nftABI,[at('ChainWhisperFixedEngineFactory')]:factoryABI};
  for(const [token]of c.tokens) {
    interfaces[token]=currentTokenFundingAbi;
    values[token]={balanceOf:[20n,1n],allowance:[[0n,0n],[0n,0n],[0n,0n]],faucetClaimed:false,
      faucetAmount:CURRENT_TOKEN_FAUCET_AMOUNT,decimals:18n,publicAmountsEnabled:false,encryptionAddress:`0x${'00'.repeat(20)}`};
    values[token].accountEncryptionAddress=values[token].encryptionAddress;
  }
  let stage=stages.ready,active=true,reorg=false,chain=false,genesis=false,runtime=false,origin=false,contextDrift=false,account=false,receiptDrift=false;
  let amounts={filled:true,maximumInput:20n,actualInput:15n,refund:5n,grossOutput:17n,fee:1n,netOutput:16n};
  const request=vi.fn(async ({method,params=[]}:{method:string;params?:unknown[]})=>{
    if(method==='eth_chainId') return chain?'0x1':'0x6c11a0';
    if(method==='eth_gasPrice')return '0x2faf080';
    if(method==='eth_getBalance')return '0xde0b6b3a7640000';
    if(method==='eth_getBlockByNumber') { if(params[0]==='0x0')return{number:'0x0',hash:genesis?headHash:c.genesisHash};
      const n=params[0]==='latest'?blockNumber:BigInt(params[0] as string);return{number:'0x'+n.toString(16),hash:n===BigInt(c.attestationBlock.number)?origin?headHash:c.attestationBlock.hash:reorg?zero:headHash,timestamp:'0x64',gasLimit:'0x7270e00'}; }
    const call=params[0] as {to:string;data:string;from?:string};
    if(method==='eth_getCode'){expect(params[1]).toEqual({blockHash:headHash,requireCanonical:true});return runtime?'0x6001':codes.get(params[0] as string);}
    if(method==='eth_getStorageAt'){expect(params[2]).toEqual({blockHash:headHash,requireCanonical:true});return c.factoryStorage.find(([s])=>BigInt(s)===BigInt(params[1] as string))![1];}
    if(method==='eth_call'){expect(params[1]).toEqual({blockHash:headHash,requireCanonical:true});const i=interfaces[call.to.toLowerCase()],n=i.parseTransaction({data:call.data})!.name;
      if(n==='cheapAsyncPublic')return abi.encodeFunctionResult(n,[stage,stage===0||stage<stages.ready?zero:contextDrift?headHash:context,stage===0?0n:200n]);
      if(n==='fastPoolQuotePublic')return abi.encodeFunctionResult(n,[contextDrift?headHash:context,200n,stage===stages.ready]);
      if(n==='principalReceipt'||n==='fastPoolPrincipalReceipt'){expect(call.from?.toLowerCase()).toBe(owner);const wide=(v:bigint)=>[[99n,1n],[v,1n]];return abi.encodeFunctionResult(n,[[[1n,amounts.filled?2n:3n],wide(amounts.maximumInput),wide(amounts.actualInput),wide(amounts.refund),wide(amounts.grossOutput-(receiptDrift?1n:0n)),wide(amounts.fee),wide(amounts.netOutput-(receiptDrift?1n:0n))]]);}
      return i.encodeFunctionResult(n,[values[call.to.toLowerCase()][n]]); }
    throw new Error('Unexpected synthetic RPC '+method);
  });
  const guard=()=>{if(!active)throw new Error('Session revoked');if(account)throw new Error('Account changed');}, cap=createDexV2ReadCapability({chainId:7082400n,provider:{request},assertCurrent:guard});
  const signer={encryptValue:vi.fn(async()=>({ciphertext:1n,signature:`0x${'11'.repeat(65)}`})),sendTransaction:vi.fn(),estimateGas:vi.fn(),getNonce:vi.fn(async()=>1),getUserOnboardInfo:()=>({aesKey:'synthetic-only'})};
  const transactions=new Map<string,Record<string,unknown>>(),receipts=new Map<string,Record<string,unknown>>();
  mocks.owner.mockImplementation(async args=>args.bindCapability({chainId:7082400n,ownerAddress:owner,signer,assertCurrent:guard,assertSnapshotCurrent:guard,readProvider:{send:(method:string,params:unknown[])=>request({method,params}),getTransaction:async(h:string)=>transactions.get(h)??null,getTransactionReceipt:async(h:string)=>receipts.get(h)??null,waitForTransaction:async(h:string)=>receipts.get(h)??null}}));
  mocks.wide.mockResolvedValue({ciphertext:{ciphertextHigh:1n,ciphertextLow:2n},signature:`0x${'11'.repeat(65)}`});mocks.decrypt.mockImplementation((_s,v)=>BigInt(v.ciphertextHigh));mocks.bool.mockImplementation(v=>v===2n?1n:v===3n?0n:2n);
  const storage=new Map<string,string>();vi.stubGlobal('window',{sessionStorage:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)}});
  const expected={chainId:7082400n,core:c.core,runtimeHash:c.runtimes.find(([n])=>n==='ChainWhisperDexCore')![2],releaseId:c.releaseId,blockNumber,blockHash:headHash};
  return{c,abi,cap,key,request,signer,storage,expected,blockNumber,values,transactions,receipts,setAmounts:(value:Partial<typeof amounts>)=>{amounts={...amounts,...value};},clearContextFault:()=>{contextDrift=false;},clearReceiptFault:()=>{receiptDrift=false;},setStage:(n:number)=>{stage=n;},fault:(name:string)=>{if(name==='lease')active=false;if(name==='account')account=true;if(name==='receipt')receiptDrift=true;if(name==='reorg')reorg=true;if(name==='chain')chain=true;if(name==='genesis')genesis=true;if(name==='runtime')runtime=true;if(name==='origin')origin=true;if(name==='context')contextDrift=true;}};
}

async function currentReviewFixture(profile:'fast-pool'|'cheap-async') {
  const f=await fixture('cheap-d06'),q=await issueCurrentDexQuoteCapability({}as never);
  const prepared=(await q.prepareCurrentQuote({profile,graph:{candidate:f.key,expectedGraph:f.c.graph,expectedPackageSha256:f.c.packageSha256,blockNumber:f.blockNumber,blockHash:headHash},
    terms:{inputToken:f.c.tokens[0][0],outputToken:f.c.tokens[1][0],destination:owner,deadline:200n,maximumInput:20n,minimumInput:5n,minimumOutput:1n,rateNumerator:0n,rateDenominator:1n,toleranceBps:50},confirmPrivateInputs:async()=>true}))!;
  const reader=await issueCurrentDexReceiptCapability({}as never);
  return {...f,prepared,review:{intent:{...prepared.intent,operationId:1n,contextHash:context},now:()=>100n,
    input:{symbol:'I',decimals:0},output:{symbol:'O',decimals:0},
    readReceipt:()=>reader.readCurrent({candidate:f.c,profile,operationId:1n,expected:f.expected})}};
}

describe('exact successor App stage and authority binding',()=>{
  it('uses selected native Core for the real wallet capability funding reads and unsigned approval',async()=>{
    const f=await fixture('cheap-d06'), capability=await issueCurrentDexSubmissionCapability({admission:null,candidate:'cheap-d06'}as never);
    const state=await capability.readCurrentTokenFunding(0);
    expect(state).toMatchObject({token:f.c.tokens[0][0],owner,balance:20n,allowance:0n,publicAmounts:false});
    const allowanceCalls=f.request.mock.calls.filter(([r])=>r.method==='eth_call'&&
      (r.params![0] as {data:string}).data.startsWith(currentTokenFundingAbi.getFunction('allowance')!.selector));
    expect(allowanceCalls.length).toBeGreaterThan(0);
    for(const [r]of allowanceCalls)expect(currentTokenFundingAbi.decodeFunctionData('allowance',(r.params![0]as{data:string}).data)[1].toLowerCase()).toBe(f.c.core);
    const prepared=await capability.prepareCurrentTokenFunding({tokenIndex:0,action:'approve',amount:10n,confirm:async review=>{expect(review.spender.toLowerCase()).toBe(f.c.core);return true;}});
    expect(prepared).toMatchObject({graph:f.c.graph,packageSha256:f.c.packageSha256});
    await expect(capability.submitCurrentTokenFunding(prepared!)).rejects.toThrow('native App submission admission');
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();expect(f.signer.estimateGas).not.toHaveBeenCalled();expect(f.storage.size).toBe(0);
  });
  it('keeps the active trial and verifies current native ABI protection selectors',()=>{
    expect(CURRENT_CHEAP_DEX_CANDIDATE).toBe(STAGED_D06_DEX_CANDIDATE);
    expect(resolveCurrentCheapDexCandidate('cheap-native')).toBe(STAGED_NATIVE_DEX_CANDIDATE);
    expect(STAGED_NATIVE_DEX_CANDIDATE.graph).toBe('fa71b96c6c590a40feed6b234d8bf5a2fe548af0edb0a2a49dbd639f4c15938b');
    const protectionABI=new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI);
    for(const name of ['quoteCheapAsync','cheapAsyncPublic','principalReceipt']) {
      const consumer=name==='quoteCheapAsync'?protectionABI:abi;
      expect(nativeAbi.getFunction(name)!.format('full')).toBe(consumer.getFunction(name)!.format('full'));
      expect(d06Abi.getFunction(name)!.format('full')).toBe(consumer.getFunction(name)!.format('full'));
    }
    expect(nativeAbi.getEvent('CheapAsyncAdvanced')!.format('full')).toBe(abi.getEvent('CheapAsyncAdvanced')!.format('full'));
  });
  it.each([
    ['STAGED_QUOTE_SLIPPAGE_CANDIDATE', 'cheap-slippage', 3],
    ['STAGED_TWO_POOL_CANDIDATE', 'cheap-two-pool', 4],
    ['STAGED_POOL_REFERENCE_CANDIDATE', 'cheap-reference', 4],
    ['STAGED_NATIVE_DEX_CANDIDATE', 'cheap-native', 4],
    ['STAGED_D06_DEX_CANDIDATE', 'cheap-d06', 4]
  ] as const)('resolves exact registered protocol identity: %s',(_name,key,workCalls)=>{
    const candidate=resolveCurrentCheapDexCandidate(key);
    expect(currentCheapDexCandidateKey(candidate)).toBe(key);
    expect(currentCheapDexQuoteProtocol(candidate)).toBe('quote-slippage');
    expect(currentCheapDexStages(candidate)).toEqual({workCalls,ready:workCalls+1,funded:workCalls+2,settled:workCalls+3,released:workCalls+4});
  });
  it('holds explicitly selected inactive ed09 with valid branded inputs before estimate or signing',async()=>{
    const f=await fixture('cheap-slippage'),q=await issueCurrentDexQuoteCapability({}as never);
    const prepared=(await q.prepareCurrentQuote({profile:'cheap-async',graph:{candidate:'cheap-slippage',expectedGraph:f.c.graph,expectedPackageSha256:f.c.packageSha256,blockNumber:f.blockNumber,blockHash:headHash},terms:{inputToken:f.c.tokens[0][0],outputToken:f.c.tokens[1][0],destination:owner,deadline:200n,maximumInput:20n,minimumInput:5n,minimumOutput:1n,rateNumerator:0n,rateDenominator:1n,toleranceBps:50},confirmPrivateInputs:async()=>true}))!;
    expect(prepared.intent.candidate).toBe(STAGED_QUOTE_SLIPPAGE_CANDIDATE);
    const sender=await issueCurrentDexSubmissionCapability({admission:null,candidate:'cheap-slippage'}as never);
    await expect(sender.submitCurrentCheapQuote(prepared)).rejects.toThrow('Staged DEX native App submission admission');
    expect(f.signer.estimateGas).not.toHaveBeenCalled();expect(f.signer.sendTransaction).not.toHaveBeenCalled();expect(f.storage.size).toBe(0);
  });
  it.each([ARCHIVED_CHEAP_DEX_CANDIDATE,STAGED_QUOTE_SLIPPAGE_CANDIDATE])('retains old stages for $graph',c=>expect(currentCheapDexStages(c)).toEqual({workCalls:3,ready:4,funded:5,settled:6,released:7}));
  it.each([STAGED_TWO_POOL_CANDIDATE,STAGED_POOL_REFERENCE_CANDIDATE,STAGED_NATIVE_DEX_CANDIDATE,STAGED_D06_DEX_CANDIDATE])('decodes every actual-ABI successor stage for $graph',c=>{
    const abi=c===STAGED_D06_DEX_CANDIDATE?d06Abi:c===STAGED_NATIVE_DEX_CANDIDATE?nativeAbi:new Interface(frozen.graphs['6d'].coreAbi);
    const phases=['not-found','preparing-quote','preparing-quote','preparing-quote','preparing-quote','quote-prepared','settling','settled','released'];
    for(let n=0;n<=8;n++)expect(decodeCurrentCheapDexOperation(abi.encodeFunctionResult('cheapAsyncPublic',[n,n===0||n<5?zero:context,n===0?0n:200n]),100n,'cheap-async',c)).toMatchObject({stage:n,phase:phases[n],ready:n===5});
    expect(decodeCurrentCheapDexOperation(abi.encodeFunctionResult('cheapAsyncPublic',[8,zero,200n]),300n,'cheap-async',c).phase).toBe('released');
    for(const [n,ct]of [[4,context],[5,zero],[6,zero],[7,zero],[9,context]] as const)expect(()=>decodeCurrentCheapDexOperation(abi.encodeFunctionResult('cheapAsyncPublic',[n,ct,200n]),100n,'cheap-async',c)).toThrow();
    for(const k of ['graph','packageSha256','core']as const)expect(()=>currentCheapDexCandidateKey({...c,[k]:ARCHIVED_CHEAP_DEX_CANDIDATE[k]})).toThrow();
    expect(currentCheapDexQuoteProtocol(c)).toBe('quote-slippage');
    for(let n=0;n<=8;n++){
      expect(currentCheapDexOwnerActionEligible(c,n,'cancel')).toBe(n>=1&&n<=5);
      expect(currentCheapDexOwnerActionEligible(c,n,'recover')).toBe(n===6);
    }
  });
  it.each(['cheap-two-pool','cheap-reference','cheap-native','cheap-d06'] as const)('checks complete synthetic canonical graph, operation and receipt stages: %s',async key=>{
    const f=await fixture(key);expect(await readCurrentSharedPoolDexGraph({capability:f.cap,candidate:key,blockNumber:f.blockNumber,blockHash:headHash})).toMatchObject({graph:f.c.graph,readyToSign:false,runtimeCount:f.c.runtimes.length+6});
    for(const [n,kind]of [[5,'quote'],[6,'pending'],[7,'terminal'],[8,'terminal']]as const){f.setStage(n);expect(await readCurrentDexPrincipalReceipt({capability:f.cap,candidate:f.c,expected:f.expected,operationId:1n,profile:'cheap-async',principal:owner})).toMatchObject({candidate:{graph:f.c.graph},kind,operation:{stage:n}});}
    f.setStage(4);await expect(readCurrentDexPrincipalReceipt({capability:f.cap,candidate:f.c,expected:f.expected,operationId:1n,profile:'cheap-async',principal:owner})).rejects.toThrow('not available');
    await expect(readCurrentDexOperation({capability:f.cap,expected:f.expected,operationId:1n,profile:'cheap-async'})).rejects.toThrow('requires graph');
    expect(f.request.mock.calls.some(([r])=>r.method.startsWith('eth_send'))).toBe(false);
  });
  it.each(['chain','genesis','runtime','origin','reorg','lease'])('rejects canonical/source/session drift: %s',async name=>{const f=await fixture();f.fault(name);await expect(readCurrentDexOperation({capability:f.cap,candidate:f.c,expected:f.expected,operationId:1n,profile:'cheap-async'})).rejects.toThrow();});
  it.each(['chain','genesis','runtime','origin','reorg','lease'])('rejects current native canonical/source/session drift: %s',async name=>{const f=await fixture('cheap-native');f.fault(name);await expect(readCurrentDexOperation({capability:f.cap,candidate:f.c,expected:f.expected,operationId:1n,profile:'cheap-async'})).rejects.toThrow();});
  it.each(['chain','genesis','runtime','origin','reorg','lease','account'])('rejects d06 canonical/source/account drift: %s',async name=>{const f=await fixture('cheap-d06');f.fault(name);await expect(readCurrentDexOperation({capability:f.cap,candidate:f.c,expected:f.expected,operationId:1n,profile:'cheap-async'})).rejects.toThrow();});
  it.each(['fast-pool','cheap-async']as const)('rejects d06 invalid, expired and already consumed quotes without confirmation: %s',async profile=>{
    for(const fault of ['expired','consumed','refund','fee','minimum-fill','minimum-output','rate','no-fill']as const){
      const f=await currentReviewFixture(profile),confirm=vi.fn(async()=>true);
      if(fault==='expired')f.review.now=()=>200n;
      if(fault==='consumed')f.setStage(6);
      if(fault==='refund')f.setAmounts({refund:4n});
      if(fault==='fee')f.setAmounts({fee:2n});
      if(fault==='minimum-fill')f.review.intent.minimumInput=16n;
      if(fault==='minimum-output')f.review.intent.minimumOutput=17n;
      if(fault==='rate')f.review.intent.rateNumerator=2n;
      if(fault==='no-fill')f.setAmounts({filled:false,actualInput:0n,refund:20n,grossOutput:0n,fee:0n,netOutput:0n});
      await expect(prepareCurrentDexAcceptance({...f.review,confirm}),fault).rejects.toThrow();
      expect(confirm,fault).not.toHaveBeenCalled();
      expect(f.signer.sendTransaction,fault).not.toHaveBeenCalled();expect(f.storage.size,fault).toBe(0);
    }
  });
  it.each(['fast-pool','cheap-async']as const)('rechecks d06 expiry and consumption after the review dialog: %s',async profile=>{
    for(const fault of ['expired','consumed']as const){
      const f=await currentReviewFixture(profile);let now=100n;
      await expect(prepareCurrentDexAcceptance({...f.review,now:()=>now,confirm:async()=>{
        if(fault==='expired')now=200n;else f.setStage(6);return true;
      }})).rejects.toThrow('not available');
      expect(f.signer.sendTransaction).not.toHaveBeenCalled();expect(f.storage.size).toBe(0);
    }
  });
  it.each(['fast-pool','cheap-async']as const)('reads d06 consumed receipt amounts without restoring acceptance or inventing Fast settlement proof: %s',async profile=>{
    const f=await currentReviewFixture(profile);f.setStage(7);
    const kind=profile==='fast-pool'?'unverified':'terminal';
    expect(await f.review.readReceipt()).toMatchObject({kind,amounts:{filled:true,maximumInput:20n,actualInput:15n,refund:5n,netOutput:16n}});
    f.setAmounts({filled:false,actualInput:0n,refund:20n,grossOutput:0n,fee:0n,netOutput:0n});
    if(profile==='cheap-async')f.setStage(8);
    expect(await f.review.readReceipt()).toMatchObject({kind,amounts:{filled:false,maximumInput:20n,actualInput:0n,refund:20n,netOutput:0n}});
    const confirm=vi.fn(async()=>true);
    await expect(prepareCurrentDexAcceptance({...f.review,confirm})).rejects.toThrow('not available');
    expect(confirm).not.toHaveBeenCalled();expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(['fast-pool','cheap-async'] as const)('prepares d06 unsigned Quote, private review and exact Accept while all sends stay held: %s',async profile=>{
    const f=await fixture('cheap-d06'), q=await issueCurrentDexQuoteCapability({}as never);
    const prepared=(await q.prepareCurrentQuote({profile,graph:{candidate:f.key,expectedGraph:f.c.graph,expectedPackageSha256:f.c.packageSha256,blockNumber:f.blockNumber,blockHash:headHash},terms:{inputToken:f.c.tokens[0][0],outputToken:f.c.tokens[1][0],destination:owner,deadline:200n,maximumInput:20n,minimumInput:5n,minimumOutput:1n,rateNumerator:0n,rateDenominator:1n,toleranceBps:50},confirmPrivateInputs:async()=>true}))!;
    expect(prepared).toMatchObject({graph:f.c.graph,to:f.c.core,readyToSign:false,intent:{candidate:f.c,profile,quoteProtocol:'quote-slippage',toleranceBps:50}});
    const quoteName=profile==='fast-pool'?'quoteFastPool':'quoteCheapAsync';
    expect(f.abi.parseTransaction({data:prepared.data})!.name).toBe(quoteName);
    const txHash=`0x${'33'.repeat(32)}`;
    if(profile==='cheap-async')f.setStage(1);
    const eventName=profile==='fast-pool'?'FastPoolQuoteIssued':'CheapAsyncAdvanced';
    const log=f.abi.encodeEventLog(f.abi.getEvent(eventName)!,profile==='fast-pool'?[1n,context,200n]:[1n,1,zero]);
    f.transactions.set(txHash,{hash:txHash,chainId:7082400n,from:owner,to:f.c.core,value:0n,data:prepared.data,nonce:1,gasLimit:65_000_000n,blockNumber:Number(f.blockNumber),blockHash:headHash});
    f.receipts.set(txHash,{hash:txHash,status:1,from:owner,to:f.c.core,blockNumber:Number(f.blockNumber),blockHash:headHash,logs:[{address:f.c.core,...log}]});
    const issued=(await prepared.readIssue(txHash))!;
    f.setStage(5);const ready=await issued.readCurrent();
    expect(ready.operation).toMatchObject({ready:true,contextHash:context});
    f.fault('context');await expect(ready.readCurrent()).rejects.toThrow('context changed');f.clearContextFault();
    const reader=await issueCurrentDexReceiptCapability({}as never);
    const readReceipt=()=>reader.readCurrent({candidate:f.c,profile,operationId:1n,expected:f.expected});
    const receipt=await readReceipt(),intent={...prepared.intent,operationId:1n,contextHash:context};
    expect(receipt).toMatchObject({kind:'quote',candidate:f.c,amounts:{actualInput:15n,refund:5n,netOutput:16n}});
    const acceptance=await prepareCurrentDexAcceptance({intent,now:()=>100n,input:{symbol:'I',decimals:0},output:{symbol:'O',decimals:0},readReceipt,confirm:async()=>true});
    expect(acceptance).toMatchObject({to:f.c.core,operationId:1n,contextHash:context,readyToSign:false});
    const decoded=f.abi.parseTransaction({data:acceptance!.data})!;
    expect(decoded.name).toBe(profile==='fast-pool'?'acceptFastPool':'acceptPrivateSwapV1');
    expect([...decoded.args]).toEqual([1n,context]);
    expect(()=>buildCurrentDexQuoteReview({receipt:{...receipt,candidate:STAGED_NATIVE_DEX_CANDIDATE},intent,now:100n,input:{symbol:'I',decimals:0},output:{symbol:'O',decimals:0}})).toThrow('exact candidate');
    const sender=await issueCurrentDexSubmissionCapability({admission:null,candidate:f.key}as never);
    await expect(sender.submitCurrentCheapQuote(prepared)).rejects.toThrow('native App submission admission');
    await expect(sender.submitCurrentCheapAcceptance({issued:ready,confirm:async()=>true})).rejects.toThrow('native App submission admission');
    for(const fault of ['receipt','account']){
      await expect(prepareCurrentDexAcceptance({intent,now:()=>100n,input:{symbol:'I',decimals:0},output:{symbol:'O',decimals:0},readReceipt,confirm:async()=>{f.fault(fault);return true;}})).rejects.toThrow(fault==='receipt'?'Quote changed during review':'Account changed');
      if(fault==='receipt')f.clearReceiptFault();
    }
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();expect(f.signer.estimateGas).not.toHaveBeenCalled();expect(f.storage.size).toBe(0);
  });
  it.each(['cheap-two-pool','cheap-reference','cheap-d06']as const)('prepares exact branded inputs and private review but holds all sends: %s',async key=>{
    const f=await fixture(key),q=await issueCurrentDexQuoteCapability({}as never);
    const prepared=(await q.prepareCurrentQuote({profile:'cheap-async',graph:{candidate:key,expectedGraph:f.c.graph,expectedPackageSha256:f.c.packageSha256,blockNumber:f.blockNumber,blockHash:headHash},terms:{inputToken:f.c.tokens[0][0],outputToken:f.c.tokens[1][0],destination:owner,deadline:200n,maximumInput:20n,minimumInput:5n,minimumOutput:1n,rateNumerator:0n,rateDenominator:1n,toleranceBps:50},confirmPrivateInputs:async()=>true}))!;
    expect(prepared.readyToSign).toBe(false);expect(prepared.intent.candidate).toBe(f.c);
    const selector=new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI).getFunction('quoteCheapAsync')!.selector;
    expect(mocks.wide.mock.calls.every(c=>c[2]===f.c.core&&c[3]===selector)).toBe(true);
    f.setStage(1);
    const txHash=`0x${'33'.repeat(32)}`,log=abi.encodeEventLog(abi.getEvent('CheapAsyncAdvanced')!,[1n,1,zero]);
    f.transactions.set(txHash,{hash:txHash,chainId:7082400n,from:owner,to:f.c.core,value:0n,data:prepared.data,nonce:1,gasLimit:50_000_000n,blockNumber:Number(f.blockNumber),blockHash:headHash});
    f.receipts.set(txHash,{hash:txHash,status:1,from:owner,to:f.c.core,blockNumber:Number(f.blockNumber),blockHash:headHash,logs:[{address:f.c.core,...log}]});
    const issued=(await prepared.readIssue(txHash))!;expect(issued.operation).toMatchObject({stage:1,ready:false,contextHash:zero});
    f.setStage(4);expect((await issued.readCurrent()).operation).toMatchObject({stage:4,ready:false,contextHash:zero});
    f.setStage(5);const ready=await issued.readCurrent();expect(ready.operation).toMatchObject({stage:5,ready:true,contextHash:context});
    f.fault('context');await expect(ready.readCurrent()).rejects.toThrow('context changed');f.clearContextFault();
    const r=await issueCurrentDexReceiptCapability({}as never),receipt=await r.readCurrent({candidate:f.c,profile:'cheap-async',operationId:1n,expected:f.expected});
    expect(receipt.amounts).toEqual({filled:true,maximumInput:20n,actualInput:15n,refund:5n,grossOutput:17n,fee:1n,netOutput:16n});
    const intent={...prepared.intent,operationId:1n,contextHash:context};
    expect(buildCurrentDexQuoteReview({receipt,intent,now:100n,input:{symbol:'I',decimals:0},output:{symbol:'O',decimals:0}})).toMatchObject({});
    expect(()=>buildCurrentDexQuoteReview({receipt:{...receipt,candidate:STAGED_QUOTE_SLIPPAGE_CANDIDATE},intent,now:100n,input:{symbol:'I',decimals:0},output:{symbol:'O',decimals:0}})).toThrow('exact candidate');
    const sender=await issueCurrentDexSubmissionCapability({admission:null,candidate:key}as never);
    await expect(sender.submitCurrentCheapQuote(prepared)).rejects.toThrow('native App submission admission');
    await expect(sender.submitCurrentCheapAcceptance({issued:{}as never,confirm:async()=>true})).rejects.toThrow('native App submission admission');
    await expect(sender.submitCurrentCheapOwnerAction({issued:{}as never,action:'recover',confirm:async()=>true})).rejects.toThrow('native App submission admission');
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();expect(f.signer.estimateGas).not.toHaveBeenCalled();expect(f.storage.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    // Reload into the unchanged active issuer. Dispatch the saved graph/Core to its pinned package.
    const saved={version:1,chainId:'7082400',owner,core:f.c.core,graph:'0x'+f.c.graph,phase:'quote',callHash:keccak256(prepared.data),nonce:1,txHash};
    const savedBytes=JSON.stringify(saved);f.storage.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,savedBytes);
    const active=await issueCurrentDexSubmissionCapability({admission:null}as never);
    if (key === 'cheap-d06') await expect(active.recoverPendingCurrentCheapAttempt()).rejects.toThrow('gas cap changed');
    else expect(await active.recoverPendingCurrentCheapAttempt()).toMatchObject({status:'manual-reconciliation-required',receiptStatus:1,readyToSign:false});
    expect(f.storage.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(savedBytes);
    f.receipts.set(txHash,{...f.receipts.get(txHash),status:0});
    if (key === 'cheap-d06') await expect(active.recoverPendingCurrentCheapAttempt()).rejects.toThrow('gas cap changed');
    else expect(await active.recoverPendingCurrentCheapAttempt()).toMatchObject({status:'manual-reconciliation-required',receiptStatus:0});
    f.receipts.delete(txHash);expect(await active.recoverPendingCurrentCheapAttempt()).toMatchObject({status:'awaiting-chain-confirmation'});
    f.storage.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify({...saved,txHash:null}));
    expect(await active.recoverPendingCurrentCheapAttempt()).toMatchObject({status:'manual-reconciliation-required',nonce:1});
    f.storage.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify({...saved,graph:'0x'+ARCHIVED_CHEAP_DEX_CANDIDATE.graph}));
    await expect(active.recoverPendingCurrentCheapAttempt()).rejects.toThrow('unknown candidate');
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();expect(f.signer.estimateGas).not.toHaveBeenCalled();
  });
});
