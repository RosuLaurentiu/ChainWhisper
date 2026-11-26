import { readFileSync } from 'node:fs';
import { FetchRequest, Interface } from '@coti-io/coti-ethers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentCheapDexStages, resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { createDexV2ReadCapability, readCurrentSharedPoolDexGraph } from './dexV2Chain';
import { issueCurrentDexSubmissionCapability } from '../features/wallet/currentDexSubmissionCapability';
import { currentTokenFundingAbi, CURRENT_TOKEN_FAUCET_AMOUNT } from './currentDexTokenFunding';
import { createPacedCotiRpc } from './appShared/cotiRpcPacing';

const mocks = vi.hoisted(() => ({ hashes: new Map<string, string>(), owner: vi.fn(), wide: vi.fn(), decrypt: vi.fn(), bool: vi.fn() }));
vi.mock('@coti-io/coti-ethers', async original => {
  const actual = await original<typeof import('@coti-io/coti-ethers')>();
  return { ...actual, keccak256: (data: string) => mocks.hashes.get(data) ?? actual.keccak256(data) };
});
vi.mock('../features/wallet/ownerCotiMetaMaskCapability', () => ({ hasCurrentDexBrowserSigner:()=>false, issueOwnerCotiMetaMaskCapability: mocks.owner }));
vi.mock('./privateUint256', () => ({ encryptPrivateUint256Input: mocks.wide, decryptPrivateUint256Output: mocks.decrypt }));
vi.mock('@coti-io/coti-sdk-typescript', () => ({ decryptUint: mocks.bool }));

const frozen = JSON.parse(readFileSync(new URL('../../../ChainWhisper Contracts V2/validation/reports/two-pool-app-stage-binding-2026-10-03/frozen-inputs.json', import.meta.url), 'utf8'));
const zero = `0x${'00'.repeat(32)}`, context = `0x${'77'.repeat(32)}`, headHash = `0x${'88'.repeat(32)}`, owner = `0x${'22'.repeat(20)}`;
const engineABI = new Interface(['function core() view returns(address)', 'function releaseId() view returns(bytes32)',
  'function marketId() view returns(bytes32)', 'function positionNFT() view returns(address)', 'function inputToken() view returns(address)',
  'function outputToken() view returns(address)', 'function feePpm() view returns(uint32)', 'function maxWorkLifetime() view returns(uint32)',
  'function selector() view returns(address)', 'function selectorRuntimeHash() view returns(bytes32)']);
const factoryABI = new Interface(['snapshotOwner','recurringOwner','ownerLifecycle','orderWork','workLifecycle','rangeOwner','rangeWork','matchWork'].map(n=>`function ${n}() view returns(address)`));
const nftABI = new Interface(['function core() view returns(address)']), evaluatorABI = new Interface(['function bindingCommitment() view returns(bytes32)']);
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); mocks.hashes.clear(); });

// decision-034: only the current candidate remains; its graph fixture uses the frozen 6d Core ABI.
async function fixture(key: CurrentCheapDexCandidateKey = 'cheap-history') {
  const abi = new Interface([...frozen.graphs['6d'].coreAbi,
    'function marketForTokens(address,address) view returns (bytes32,uint256,uint256,uint256,bool,address,address)']);
  vi.spyOn(Date, 'now').mockReturnValue(100_000);
  const c = resolveCurrentCheapDexCandidate(key), stages = currentCheapDexStages(c), blockNumber = BigInt(c.attestationBlock.number) + 20n;
  const at = (role: string) => c.runtimes.find(([n])=>n===role)![1], companion = (role: string)=>c.companions.find(([n])=>n===role)!;
  const engine=companion('ChainWhisperFixedEngine'), evaluator=companion('ChainWhisperDexWideTerminalGT'), nft=companion('ChainWhisperDexPositionNFT'), fast=companion('ChainWhisperDexFastPoolQuote');
  const codes=new Map<string,string>(); [...c.runtimes,...c.companions,...c.tokens.map(([a,h])=>['Token',a,h])].forEach(([,a,h],i)=>{const code=`0xcafe${i.toString(16).padStart(2,'0')}02`;codes.set(a,code);mocks.hashes.set(code,h);});
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
      if(n==='marketForTokens'){const p=c.pairs.find(row=>row.marketId===c.marketId)!;return abi.encodeFunctionResult(n,[p.marketId,BigInt(p.canonicalId),6n,1n,true,p.engine,p.poolTerms]);}
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

describe('exact successor App stage and authority binding',()=>{
  it('compares selected Activity graph admission under bounded competing reads', async () => {
    const results: Array<{ foreground: boolean; graphCalls: number; graphComplete: boolean; startsAtGraphEnd: number; spacing: boolean }> = [];
    try {
      for (const foreground of [false, true]) {
        vi.useFakeTimers();
        const f = await fixture('cheap-history');
        let id = 0, starts = 0, graphCalls = 0, startsAtGraphEnd = 0, graphComplete = false, graphError = '';
        const times: number[] = [];
        const graphIds = new Set<number>();
        const paced = createPacedCotiRpc(async request => {
          const body = JSON.parse(new TextDecoder().decode(request.body!));
          starts++; times.push(performance.now());
          const graph = graphIds.has(body.id);
          if (graph) graphCalls++;
          const result = graph ? await f.request({ method: body.method, params: body.params }) : '0x';
          return { statusCode: 200, statusMessage: 'OK', headers: {},
            body: new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0', id: body.id, result })) };
        }, undefined, true, 500);
        const send = async (method: string, params: unknown[], graph = false) => {
          const requestId = ++id;
          if (graph) graphIds.add(requestId);
          const request = new FetchRequest('https://fixture.invalid/rpc');
          request.body = JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params });
          const response = await (graph && foreground ? paced.foreground : paced)(request);
          return JSON.parse(new TextDecoder().decode(response.body!)).result;
        };
        // Fixed synthetic contention, not attribution of the connected App's callers.
        const competitors = Array.from({ length: 9 }, (_, producer) => (async () => {
          for (let n = 0; n < 100; n++) await send(producer < 3 ? 'eth_getCode' : 'eth_blockNumber', []);
        })().catch(() => undefined));
        const capability = createDexV2ReadCapability({ chainId: 7082400n, assertCurrent: () => {},
          provider: { request: ({ method, params = [] }) => {
            if (!Array.isArray(params)) throw new Error('The graph fixture requires positional RPC parameters.');
            return send(method, params, true);
          } } });
        const graph = readCurrentSharedPoolDexGraph({ capability, candidate: 'cheap-history', blockNumber: f.blockNumber, blockHash: headHash })
          .then(() => { graphComplete = true; startsAtGraphEnd = starts; })
          .catch(error => { graphError = String(error); startsAtGraphEnd = starts; });
        await vi.runAllTimersAsync();
        await Promise.all([...competitors, graph]);
        expect(graphError).toBe(foreground ? '' : 'Error: COTI RPC comparison stopped: request-limit. No automatic retry.');
        results.push({ foreground, graphCalls, graphComplete, startsAtGraphEnd,
          spacing: times.slice(1).every((time, index) => time - times[index] >= 500) });
        vi.useRealTimers();
      }
      expect(results[0]).toMatchObject({ graphComplete: false, startsAtGraphEnd: 600, spacing: true });
      expect(results[1]).toMatchObject({ graphComplete: true, graphCalls: 107, spacing: true });
      expect(results[1].startsAtGraphEnd).toBeLessThan(250);
      console.info('Activity graph queue contention comparison', results);
    } finally { vi.useRealTimers(); }
  });
  it('counts cold six-pair Activity graph reads at the raw fixture request boundary', async () => {
    const f = await fixture('cheap-history');
    expect('pairs' in f.c ? f.c.pairs : []).toHaveLength(6);
    await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-history' } as never);
    expect(f.request).not.toHaveBeenCalled();
    await readCurrentSharedPoolDexGraph({ capability: f.cap, candidate: 'cheap-history', blockNumber: f.blockNumber, blockHash: headHash });
    const counts: Record<string, number> = {};
    for (const [{ method }] of f.request.mock.calls) counts[method] = (counts[method] ?? 0) + 1;
    console.info('Cold Activity graph raw fixture counts', { counts, total: f.request.mock.calls.length,
      runtimes: f.c.runtimes.length, tokens: f.c.tokens.length, companions: f.c.companions.length });
    expect(counts).toEqual({ eth_chainId: 2, eth_getBlockByNumber: 6,
      eth_getCode: f.c.runtimes.length + f.c.tokens.length + f.c.companions.length,
      // The current graph adds one primary-market admission read (checkPrimaryMarket in dexV2Chain.ts).
      eth_call: 40, eth_getStorageAt: f.c.factoryStorage.length });
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
    expect(f.signer.estimateGas).not.toHaveBeenCalled();
  });
});
