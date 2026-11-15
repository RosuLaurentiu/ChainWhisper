'use strict';
// Exact trial public binding. Generated TS stays in the trial report.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto'),{createRequire}=require('node:module');
const validation=path.resolve(__dirname,'../../ChainWhisper Contracts V2/validation');
const candidateRoot=path.join(validation,'candidates/packed-rate-input-2026-11-03');
const trial=path.resolve(__dirname,'../reports/low-rpc-trial-2026-11-05'),report=path.join(trial,'public-binding');
const deployment=path.join(candidateRoot,'low-rpc-native-deployment-1');
const adapter=require(path.join(candidateRoot,'low-rpc-deployment.cjs')),{candidate}=adapter;
const boundary=require(path.join(validation,'candidates/shared-core-markets-2026-10-07/deployment-boundary.cjs'));
const {runtimeFor}=require(path.join(validation,'candidates/core-advance-boundary-2026-10-06/runtime.cjs'));
const pp=require(path.join(validation,'candidates/c1-shared-integration-2026-10-05/native-fixture/pp-trial.cjs'));
const prepared=require('./prepare-current-dex-prepared-candidate.cjs');
const {createPacing}=require('./current-dex-rpc-pacing.cjs');
const {Interface,FetchRequest,JsonRpcProvider}=createRequire(path.join(validation,'package.json'))('ethers');
const sha=value=>createHash('sha256').update(value).digest('hex'),fileSha=file=>sha(fs.readFileSync(file));
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const GRAPH='7c63020b4eead20603e63c580e3155af8974b4eb5cf0a2b2eb2ea8c796a10eb9';
const CORE='0xa7a3D2564b4aE598BaD316a5FddC8016ad889EDF';
const PACKAGE='2c5f6db37d33d0d88159e6f65fcbd5461e67262b3303f5cae5ea124df4d6d41d';
const ASSEMBLY='66923ce9db01882199397e8f3f164bbe42f9f9c5a85db967a32675fd0a7a1313';
const CORE_ABI='077457e4b1931295614909fa8553b6629e8244b76dcbf60553667ac8eb9dfa98';
const ENDPOINT='https://testnet.coti.io/rpc',SCHEMA='LOW_RPC_APP_PUBLIC_BINDING_V1';
const BOUNDS=Object.freeze({logicalCalls:350,physicalHttp:350,jsonPayloads:350,elapsedMs:12*60000,responseMs:30000,intervalMs:334,batchMaxCount:16,retries:0});
const DEPLOYMENT_FILES=Object.freeze({
 'base.json':'84ebc3457e3666d6265ccdea4f633ce0bdb95c3988d4afaaa1a3739074011393',
 'package.json':'16e4dab3e681bcf333e835cfa9d253f68936d499c08e5b5075f1cefddb85bde7',
 'RESULT.json':'55f10c27ca758c2859ab2bc6aca486c0f4f308bf343f9c2622105c9a54cc25cc',
 'journal.jsonl':'2dad7d3ae405bfe620c0b357e81623e83e6a54af870d47e9f2c14bc06073b7d6',
 'admission.json':'47e2fff6f169aaeaa9676b2d0d987e86b605ac88db7fef1c217ed97eaa724cb8'
});
const SEED_FILES=Object.freeze({
 'NATIVE_SEED_RESULT.json':'cae817fab80c1a46654afd6fc89bbe692df1682012985334d614a69cd1c2d88b',
 'seed-binding.json':'89d1ece5938da00dfdeacb393ad4e01d99b9df6296fa669596752c89c2d7cbe6',
 'native-seed/packed-manifest-1.json':'c28e942a91d0448817f1d08266c4b039244d2bb3222a406716d6e2ba867cd354',
 'native-seed/packed-journal-1.jsonl':'96d054014a0f23be55141c07e9b59c99fbd66338056324ad7f9b292e42b64bc5'
});
function journal(file){const raw=fs.readFileSync(file,'utf8');assert(raw.endsWith('\n'),'LOW_RPC_JOURNAL_TRUNCATED');return raw.trim().split(/\r?\n/).map(JSON.parse);}
function verifyJournal(rows,pkg,sources){
 const state=boundary.historyState(rows,pkg,PACKAGE);
 assert.equal(state.verified,44,'LOW_RPC_CONSTRUCTORS');assert.equal(state.pending,null,'LOW_RPC_PENDING_CONSTRUCTOR');
 assert(rows.every(row=>Object.entries(sources).every(([k,v])=>row[k]===v)),'LOW_RPC_CONSTRUCTOR_SOURCES');
 const verified=rows.filter(row=>row.kind==='verified');
 for(const call of pkg.calls){const matches=verified.filter(row=>row.index===call.index);assert.equal(matches.length,1);const row=matches[0];
  assert.equal(row.status,1);assert.equal(row.address.toLowerCase(),call.predictedAddress.toLowerCase());assert(/^0x[0-9a-f]{64}$/i.test(row.runtimeHash),'LOW_RPC_RUNTIME_HASH');}
 return verified;
}
function verifySeed(seed,manifest,rows,pkg){
 assert.equal(seed.status,'SIX_MARKET_SEED_COMPLETE_KEEP_FUNDED');assert.equal(seed.graph,GRAPH);assert.equal(seed.core,CORE);
 assert.equal(seed.verified,22);assert.equal(seed.starts,22);assert.equal(seed.noPending,true);assert.equal(seed.walletAndReceiptReconciled,true);
 assert.equal(seed.keepFunded,true);assert.equal(seed.globalLedgerDirectlyDecrypted,false);
 assert.equal(manifest.schema,'SHARED_RECEIPT_MARKET_SEED_SIX_V1');assert.equal(manifest.graph,GRAPH);assert.equal(manifest.core,CORE);
 assert.equal(manifest.packageSha256,PACKAGE);assert.equal(manifest.chainId,String(pkg.chainId));assert.equal(manifest.genesisHash,pkg.genesisHash);
 assert.deepEqual(manifest.tokens,pkg.tokenAddresses);assert.equal(seed.manifestSha256,pp.digest(manifest));assert.equal(manifest.steps.length,22);
 const progress=pp.prefix(rows,manifest,manifest.steps);assert.equal(progress.done.length,22);assert.equal(progress.pending,null);assert.equal(progress.next,null);
 assert.deepEqual(seed.signedHashes,progress.done.map(row=>row.hash));
 assert.deepEqual(seed.pairs,[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]]);
 assert(progress.done.every(row=>row.walletAndReceiptReconciled===true),'LOW_RPC_SEED_ACCOUNTING');
 return String(progress.done.reduce((n,row)=>BigInt(row.blockNumber)>n?BigInt(row.blockNumber):n,0n));
}
function baseInputs(){
 assert.equal(candidate.pins.graph,GRAPH);assert.equal(candidate.pins.manifest,'401d67b7417d8483768703140d6ed380e87284b8ae6e8edde8d2f4d1549788cc');
 adapter.localChecks();const frozen=candidate.frozen();
 for(const [name,want]of Object.entries(DEPLOYMENT_FILES))assert.equal(fileSha(path.join(deployment,name)),want,'LOW_RPC_DEPLOYMENT_DRIFT');
 const {pkg}=adapter.admit(true),result=json(path.join(deployment,'RESULT.json'));
 assert.equal(sha(JSON.stringify(pkg)),PACKAGE);assert.equal(pkg.artifactGraphSha256,GRAPH);assert.equal(pkg.expectedCore,CORE);assert.equal(pkg.calls.length,44);
 assert.equal(result.status,'SHARED_MARKETS_CONSTRUCTORS_VERIFIED');assert.equal(result.count,44);assert.equal(result.noPending,true);assert.equal(result.graph,GRAPH);assert.equal(result.core,CORE);
 const verified=verifyJournal(journal(path.join(deployment,'journal.jsonl')),pkg,adapter.sourcePins());
 const runtimes=pkg.calls.map(call=>{const row=verified.find(r=>r.index===call.index);return[call.name,row.address.toLowerCase(),row.runtimeHash];});
 const factory=pkg.calls.find(row=>row.name==='ChainWhisperFixedEngineFactory');
 const artifact=frozen.artifacts.ChainWhisperFixedEngineFactory;
 const layout=frozen.info.output.contracts[artifact.sourceName].ChainWhisperFixedEngineFactory.storageLayout;
 const args=artifact.abi.find(row=>row.type==='constructor').inputs;
 const factoryStorage=[['_first','first_'],['_second','second_'],['_creationLength','creationLength_'],['expectedCore','expectedCore_']].map(([field,arg])=>{
  const slot=layout.storage.find(row=>row.label===field),index=args.findIndex(row=>row.name===arg);assert(slot&&slot.offset===0&&index>=0);
  return[slot.slot,'0x'+BigInt(factory.args[index]).toString(16).padStart(64,'0')];});
 const api=name=>new Interface(frozen.artifacts[name].abi),source=frozen.info.input.sources['contracts/dex/ChainWhisperDexCheapAsyncTypes.sol'].content;
 assert.match(source,/enum Stage\s*\{\s*NONE, POOL_BASELINE, TWO_POOL, LIMIT_FIRST, LIMIT_SECOND, READY, FUNDED, SETTLED, RELEASED\s*\}/);
 const protocol={name:'quote-slippage',stages:{workCalls:4,ready:5,funded:6,settled:7,released:8},coreAbiSha256:sha(JSON.stringify(frozen.artifacts.ChainWhisperDexCore.abi)),quoteSignature:api('ChainWhisperDexCore').getFunction('quoteCheapAsync').format('sighash'),stagesSourceSha256:sha(source)};
 assert.equal(protocol.coreAbiSha256,CORE_ABI);assert.equal(api('ChainWhisperDexCore').getFunction('cheapAsyncAdmission').stateMutability,'view');
 assert.equal(api('ChainWhisperFixedEngine').getFunction('cheapPageAuthority').stateMutability,'view');assert.equal(api('ChainWhisperFixedEngine').getFunction('quoteRangeForward'),null);
 for(const row of Object.values(json(path.join(candidate.build,'all-storage-checks.json'))))assert.equal(row.allPriorFieldsUnchanged,true);
 const delta=json(path.join(candidate.build,'abi-delta-check.json'));
 assert.deepEqual(delta.added,['ChainWhisperDexCore:cheapAsyncAdmission(uint256,address,address,address)','ChainWhisperFixedEngine:cheapPageAuthority(uint256,uint256,uint256)']);
 assert.deepEqual(delta.removed,['ChainWhisperFixedEngine:quoteRangeForward(uint256,bytes32,uint256,uint256[4])']);
 for(const [name,want]of Object.entries(SEED_FILES))assert.equal(fileSha(path.join(trial,name)),want,'LOW_RPC_SEED_DRIFT');
 const seed=json(path.join(trial,'NATIVE_SEED_RESULT.json')),binding=json(path.join(trial,'seed-binding.json'));
 assert.equal(path.resolve(binding.deploymentDir),deployment);assert.equal(binding.resultSha256,DEPLOYMENT_FILES['RESULT.json']);
 assert.equal(fileSha(binding.candidatePath),binding.candidateSha256);assert.deepEqual(require(binding.candidatePath).pins,candidate.pins);
 assert.equal(binding.engine.toLowerCase(),result.public.primaryEngine.toLowerCase());
 const minimumBlock=verifySeed(seed,json(path.join(trial,'native-seed/packed-manifest-1.json')),journal(path.join(trial,'native-seed/packed-journal-1.jsonl')),pkg);
 assert(BigInt(minimumBlock)>=BigInt(result.public.blockNumber));
 return{frozen,pkg,packageSha256:PACKAGE,verified,runtimes,factory,factoryStorage,api,runtime:runtimeFor(frozen,pkg),minimumBlock,protocol};
}
function inputs(){const input=baseInputs(),file=path.join(report,'engine-assembly.json');assert.equal(fileSha(file),ASSEMBLY,'LOW_RPC_ASSEMBLY_DRIFT');return{...input,embedded:prepared.verifyEmbedded(json(file),input,GRAPH)};}
function sourcePins(){return Object.fromEntries([__filename,path.join(candidateRoot,'low-rpc-deployment.cjs'),path.join(candidateRoot,'low-rpc-candidate.cjs'),require.resolve('./prepare-current-dex-prepared-candidate.cjs'),require.resolve('./prepare-current-dex-c1-candidate.cjs'),require.resolve('./current-dex-rpc-pacing.cjs'),require.resolve(path.join(validation,'candidates/core-advance-boundary-2026-10-06/runtime.cjs')),require.resolve(path.join(validation,'candidates/c1-shared-integration-2026-10-05/native-fixture/pp-trial.cjs'))].map(file=>[path.relative(report,file),fileSha(file)]));}
function reportPath(file){assert(file,'LOW_RPC_OUTPUT_REQUIRED');const full=path.resolve(file),relative=path.relative(report,full);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'LOW_RPC_REPORT_OUTPUT_ONLY');return full;}

// The fake transport argument is used only by the focused local test.
function createReader(mode,capture,getUrl=FetchRequest.createGetUrlFunc()){
 const live=mode==='--capture',saved=new Map(),cursors=new Map(),cache=new Map();
 for(const row of capture.reads){const key=JSON.stringify([row.method,row.params]);if(!saved.has(key))saved.set(key,[]);saved.get(key).push(row.result);}
 let logical=0,cacheHits=0,errors=0,stopped=null,provider=null,consumed=0;const started=Date.now();
 const check=()=>{if(stopped)throw stopped;assert(Date.now()-started<BOUNDS.elapsedMs,'LOW_RPC_TIME_BOUND');};
 const pacing=createPacing(async(request,signal)=>{const s=pacing.stats(),payload=JSON.parse(new TextDecoder().decode(request.body));assert(s.requests<=BOUNDS.physicalHttp&&s.rpcCalls<=BOUNDS.jsonPayloads,'LOW_RPC_WIRE_BOUND');assert((Array.isArray(payload)?payload:[payload]).every(r=>['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_getStorageAt','eth_call'].includes(r.method)),'LOW_RPC_READ_ONLY');return getUrl(request,signal);},BOUNDS.intervalMs,check,null,true);
 async function rpc(method,params){
  try{
   check();assert(['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_getStorageAt','eth_call'].includes(method),'LOW_RPC_READ_ONLY');assert(++logical<=BOUNDS.logicalCalls,'LOW_RPC_READ_BOUND');
   params=structuredClone(params);
   const tag=params.at(-1),key=JSON.stringify([method,params]);
   const reusable=!['eth_chainId','eth_getBlockByNumber'].includes(method)&&tag&&typeof tag==='object'&&!Array.isArray(tag)&&
    Object.keys(tag).length===2&&/^0x[0-9a-f]{64}$/i.test(tag.blockHash)&&tag.requireCanonical===true;
   if(reusable&&cache.has(key)){cacheHits++;return await cache.get(key);}
   const work=(async()=>{
    if(!live){const cursor=cursors.get(key)??0,rows=saved.get(key);assert(rows&&cursor<rows.length,'LOW_RPC_CAPTURED_READ_REQUIRED');cursors.set(key,cursor+1);consumed++;return rows[cursor];}
    if(!provider){const request=new FetchRequest(ENDPOINT);request.timeout=BOUNDS.responseMs;request.getUrlFunc=pacing.getUrl;request.retryFunc=async()=>false;request.setThrottleParams({maxAttempts:1});provider=new JsonRpcProvider(request,{chainId:7082400,name:'coti-testnet'},{staticNetwork:true,batchMaxCount:BOUNDS.batchMaxCount,batchStallTime:10});}
    const result=await provider.send(method,params);capture.reads.push({method,params,result});return result;
   })();
   if(reusable)cache.set(key,work);return await work;
  }catch(error){errors++;stopped??=error;throw stopped;}
 }
 return{rpc,stats:()=>({logicalCalls:logical,cacheHits,errors,consumedSavedReads:consumed,physicalHttp:pacing.stats().requests,jsonPayloads:pacing.stats().rpcCalls,pacing:pacing.stats(),elapsedMs:Date.now()-started,stopped:stopped?String(stopped.code??'READ_STOP'):null}),close:async()=>{if(provider)await provider.destroy();},assertConsumed:()=>{if(!live)assert.equal(consumed,capture.reads.length,'LOW_RPC_UNUSED_CAPTURE_ROWS');}};
}
async function main(mode,output,emitTarget){
 assert(['--check-inputs','--capture','--check','--emit'].includes(mode),'LOW_RPC_PUBLIC_MODE');
 const input=inputs();
 if(mode==='--check-inputs')return{status:'LOW_RPC_PUBLIC_INPUTS_VERIFIED',graph:GRAPH,core:CORE,packageSha256:PACKAGE,constructors:44,seedActions:22,minimumBlock:input.minimumBlock,coreAbiSha256:input.protocol.coreAbiSha256,embeddedCreationBytes:input.embedded.creationBytes,bounds:BOUNDS,noNetwork:true,readyToSign:false};
 output=reportPath(output);if(mode==='--capture')assert(!fs.existsSync(output),'LOW_RPC_CAPTURE_EXISTS');
 if(mode==='--emit'){emitTarget=reportPath(emitTarget);assert(path.extname(emitTarget)==='.ts'&&!fs.existsSync(emitTarget),'LOW_RPC_NEW_TS_REQUIRED');}
 const pins=sourcePins();
 const capture=mode==='--capture'?{schema:SCHEMA,destination:ENDPOINT,graph:GRAPH,packageSha256:PACKAGE,assemblySha256:ASSEMBLY,sourcePins:pins,bounds:BOUNDS,complete:false,reads:[]}:json(output);
 assert.equal(capture.schema,SCHEMA);assert.equal(capture.destination,ENDPOINT);assert.equal(capture.graph,GRAPH);assert.equal(capture.packageSha256,PACKAGE);assert.equal(capture.assemblySha256,ASSEMBLY);assert.deepEqual(capture.sourcePins,pins);assert.deepEqual(capture.bounds,BOUNDS);assert(Array.isArray(capture.reads));
 if(mode!=='--capture')assert.equal(capture.complete,true,'LOW_RPC_INCOMPLETE_CAPTURE');
 const reader=createReader(mode,capture);let data;
 try{data=await prepared.collect(reader.rpc,input,PACKAGE);reader.assertConsumed();assert.equal(data.graph,GRAPH);assert.equal(data.core.toLowerCase(),CORE.toLowerCase());assert.equal(data.readyToSign,false);assert.equal(data.tokens.length,4);assert.equal(data.pairs.length,6);assert.deepEqual(sourcePins(),pins,'LOW_RPC_COLLECTOR_SOURCE_DRIFT');if(mode==='--capture')capture.complete=true;}
 finally{await reader.close();if(mode==='--capture'){capture.counts=reader.stats();fs.writeFileSync(output,JSON.stringify(capture,null,2)+'\n',{flag:'wx'});}}
 data={...data,attestationSha256:fileSha(output),nativeScope:{sixMarketPublicBinding:true,fullFixtureAdmission:false,connectedAppWalletHeld:true,noBetaAcceptance:true}};
 if(mode==='--emit')fs.writeFileSync(emitTarget,prepared.render(data,'STAGED_LOW_RPC_DEX_CANDIDATE'),{flag:'wx'});
 return{status:'LOW_RPC_PUBLIC_BINDING_VERIFIED',graph:GRAPH,core:CORE,packageSha256:PACKAGE,pairs:6,attestationBlock:data.attestationBlock,counts:reader.stats(),capturedCounts:capture.counts,readyToSign:false,noSign:true,noSend:true};
}
module.exports={baseInputs,inputs,verifyJournal,verifySeed,sourcePins,createReader,reportPath,main,GRAPH,CORE,PACKAGE,ASSEMBLY,CORE_ABI,SCHEMA,ENDPOINT,BOUNDS,DEPLOYMENT_FILES,SEED_FILES};
if(require.main===module)main(process.argv[2],process.argv[3],process.argv[4]).then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({status:'LOW_RPC_PUBLIC_BINDING_STOP',guard:/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:null,code:error.code??null,noSign:true,noSend:true}));process.exitCode=1;});
