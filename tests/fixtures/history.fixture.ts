// LOCAL ONLY. Synthetic canonical RPC/blocks and constructor values, exact frozen
// recorder code/ABI. Price 2 is the retained real-Core local one-Pool reference.
// This file is not imported by the production application.
import { AbiCoder, Interface, keccak256, toUtf8Bytes, type Eip1193Provider } from '@coti-io/coti-ethers';
import { CURRENT_DEX_DAILY_PRICE_ARTIFACT } from '../../src/lib/currentDexDailyPriceArtifact';
import { CURRENT_DEX_DAILY_PRICE_SOURCE, type CurrentDexDailyPriceConfig, type CurrentDexDailyPriceManifest } from '../../src/lib/currentDexDailyPrice';
const api=new Interface(CURRENT_DEX_DAILY_PRICE_ARTIFACT.abi),coder=AbiCoder.defaultAbiCoder(),id=(s:string)=>keccak256(toUtf8Bytes(s));
export type FixtureMode='ready'|'empty'|'stale'|'suppressed'|'unobserved'|'rpc'|'reorg'|'mismatch'|'loading';
export const HISTORY_FIXTURE_DAY=20729n;
const day=HISTORY_FIXTURE_DAY,hex=(n:bigint|number)=>`0x${BigInt(n).toString(16)}`;
const observationTypes=['bytes32','bytes32','uint256','address','bytes32','bytes32','bytes32','bytes32','uint256','uint256','uint256','address','address','uint8','uint8','uint256','uint256','uint256','uint256','bytes32','bool'];
export function makeHistoryFixture(initial:FixtureMode='ready'){
  const token0=`0x${'33'.repeat(20)}`,token1=`0x${'44'.repeat(20)}`,source=`0x${'22'.repeat(20)}`,address=`0x${'11'.repeat(20)}`,tokenCode='0x60026000',sourceCode='0x60016000',recorderCode=CURRENT_DEX_DAILY_PRICE_ARTIFACT.deployedBytecode;
  const manifest:CurrentDexDailyPriceManifest={sourceGraph:CURRENT_DEX_DAILY_PRICE_SOURCE.graph,recorderArtifact:CURRENT_DEX_DAILY_PRICE_SOURCE.recorderArtifact,chainId:'31337',genesisHash:id('block-0'),address,runtimeHash:keccak256(recorderCode),deployer:`0x${'55'.repeat(20)}`,deploymentBlock:'70',deploymentBlockHash:id('block-70'),deploymentTransactionHash:id('deployment'),source,sourceRuntimeHash:keccak256(sourceCode),releaseId:id('local-release'),market:id('local-market'),pair:keccak256(coder.encode(['uint256','address','address'],[31337,token0,token1])),canonicalId:'1',token0,token1,decimals0:18,decimals1:18,token0RuntimeHash:keccak256(tokenCode),token1RuntimeHash:keccak256(tokenCode),symbols:['cwTPA','cwTPB']};
  const config:CurrentDexDailyPriceConfig={status:'active',manifest,rpcUrl:'https://local.invalid',finalityLagBlocks:0};
  let mode=initial,afterSource=false,resolveLoading:(()=>void)|null=null;
  const header=(n:bigint)=>({number:hex(n),hash:id(mode==='reorg'&&afterSource&&n===100n?'reorganized-head':`block-${n}`),timestamp:hex(n===0n?0n:n===70n?(day-4n)*86400n:n===80n?(day-3n)*86400n+3600n:n===81n?(day-3n)*86400n+3605n:n===90n?(day-1n)*86400n+7200n:n===91n?(day-1n)*86400n+7205n:n===99n?day*86400n+90n:day*86400n+100n)});
  const observation=(price:bigint,time:bigint,block:bigint,revision:bigint,available=true)=>[CURRENT_DEX_DAILY_PRICE_SOURCE.schema,CURRENT_DEX_DAILY_PRICE_SOURCE.policy,31337n,source,manifest.sourceRuntimeHash,manifest.releaseId,manifest.market,manifest.pair,1n,2n,1n,token0,token1,18n,18n,price,time,block,revision,id(`state-${revision}`),available];
  const zeroObservation=[`0x${'00'.repeat(32)}`,`0x${'00'.repeat(32)}`,0,`0x${'00'.repeat(20)}`,`0x${'00'.repeat(32)}`,`0x${'00'.repeat(32)}`,`0x${'00'.repeat(32)}`,`0x${'00'.repeat(32)}`,0,0,0,`0x${'00'.repeat(20)}`,`0x${'00'.repeat(20)}`,0,0,0,0,0,0,`0x${'00'.repeat(32)}`,false];
  const getters:Record<string,unknown>={SOURCE_GRAPH:`0x${manifest.sourceGraph}`,SCHEMA:CURRENT_DEX_DAILY_PRICE_SOURCE.schema,POLICY:CURRENT_DEX_DAILY_PRICE_SOURCE.policy,source,sourceRuntime:manifest.sourceRuntimeHash,sourceChain:31337n,releaseId:manifest.releaseId,market:manifest.market,pair:manifest.pair,canonicalId:1n,token0,token1,decimals0:18n,decimals1:18n,MAX_PAGE:32n};
  const provider:Pick<Eip1193Provider,'request'>={request:async({method,params=[]})=>{
    if(mode==='loading')await new Promise<void>(resolve=>{resolveLoading=resolve;});
    if(mode==='rpc')throw new Error('Synthetic RPC failure');
    const args=params as unknown[];
    if(method==='eth_chainId')return '0x7a69';
    if(method==='eth_getBlockByNumber')return header(args[0]==='latest'?100n:BigInt(String(args[0])));
    if(method==='eth_getTransactionReceipt')return {status:'0x1',transactionHash:manifest.deploymentTransactionHash,blockNumber:'0x46',blockHash:manifest.deploymentBlockHash,contractAddress:address,from:manifest.deployer,to:null};
    const pin=args[1] as {blockHash?:string;requireCanonical?:boolean};if(!pin?.blockHash||pin.requireCanonical!==true)throw Error('Fixture requires EIP-1898');
    if(method==='eth_getCode'){const a=String(args[0]).toLowerCase();return mode==='mismatch'&&a===address?'0x6003':a===address?recorderCode:a===source?sourceCode:tokenCode;}
    if(method==='eth_call'){
      const call=args[0] as {to:string;data:string};
      if(call.to===token0||call.to===token1)return coder.encode(['uint8'],[18]);
      if(call.to===source){let o=observation(2n*10n**18n,day*86400n+90n,99n,3n);if(mode==='stale')o=observation(0n,day*86400n-1000n,90n,3n,false);if(mode==='suppressed')o=observation(0n,day*86400n+90n,99n,3n,false);if(mode==='unobserved')o=observation(0n,0n,0n,0n,false);afterSource=true;return coder.encode(['bytes'],[coder.encode(observationTypes,o)]);}
      const parsed=api.parseTransaction({data:call.data});if(!parsed)throw Error('Unknown fixture call');
      if(parsed.name==='getDays'){
        const start=BigInt(parsed.args[0]),count=BigInt(parsed.args[1]);if(count>32n)throw Error('Page cap');const page=[];
        for(let i=0n;i<count;i++){const d=start+i,present=mode!=='empty'&&(d===day-3n||d===day-1n),first=d===day-3n,at=d*86400n+(first?3600n:7200n),block=first?80n:90n;page.push([d,present,present?observation(first?1900000000000000000n:2n*10n**18n,at,block,first?1n:2n):zeroObservation,present?at+5n:0n,present?block+1n:0n]);}
        return api.encodeFunctionResult('getDays',[page]);
      }
      if(!(parsed.name in getters))throw Error('Unknown getter');return api.encodeFunctionResult(parsed.name,[getters[parsed.name]]);
    }
    throw Error(`Unexpected read ${method}`);
  }};
  return {provider,config,manifest,header,api,observation,observationTypes,setMode:(next:FixtureMode)=>{mode=next;afterSource=false;resolveLoading?.();resolveLoading=null;}};
}
