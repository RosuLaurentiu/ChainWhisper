'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const runtime=require(path.resolve(__dirname,'../../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/c1-service/runtime.cjs'));
const app=require('./current-dex-c1.cjs');
test('App C1 commands forward one supported mode to the maintained runtime',async t=>{
 const calls=[];t.mock.method(runtime,'main',async mode=>{calls.push(mode);return{mode};});
 const modes=['--check','--read','--start','--once','--restart','--reconcile','--inspect','--expire','--renew'];
 for(const mode of modes)assert.deepEqual(await app.main([mode]),{mode});
 assert.deepEqual(calls,modes);
 for(const args of [[],['--invalid'],['--start','operation.json']])await assert.rejects(app.main(args),/CURRENT_DEX_C1_USAGE/);
 const error=Object.assign(Error('provider detail stays private'),{code:'CALL_EXCEPTION'});
 const published=app.failure(error);
 assert.deepEqual(published,runtime.failure(error));
 assert.equal(published.code,'CALL_EXCEPTION');
 assert(!JSON.stringify(published).includes(error.message));
});
test('package exposes each normal C1 operator command',()=>{
 const scripts=require('../package.json').scripts;
 for(const[name,mode]of [['check','check'],['read','read'],['dev','start'],['once','once'],['restart','restart'],['reconcile','reconcile'],['status','inspect'],['expire','expire'],['renew','renew']]){
  const preload=['check','inspect'].includes(mode)?'':'--require ./scripts/current-dex-rpc-pacing.cjs ';
  assert.equal(scripts[name+':c1'],'node '+preload+'scripts/current-dex-c1.cjs --'+mode);
 }
});


test('C1 uses the supplied systemd credential namespace without a development-file fallback',()=>{
 const fallback=runtime.operatorCredentialPath({});
 assert.equal(path.basename(fallback),'.env.coti-testnet.local');
 const directory=path.resolve('/run/credentials/chainwhisper-c1-case.service');
 assert.equal(runtime.operatorCredentialPath({CREDENTIALS_DIRECTORY:directory}),path.join(directory,'chainwhisper-beta.env'));
 for(const invalid of ['', 'relative/credentials'])assert.throws(()=>runtime.operatorCredentialPath({CREDENTIALS_DIRECTORY:invalid}),/C1_CREDENTIAL_NAMESPACE/);
});

test('cc7 saved unused window rebuild keeps rollover candidate identity with current source pins',{skip:process.env.CW_LOW_RPC_TRIAL!=='cc7eb662c644c10bef875d2a72524095848a236155005a32377b10a7c0c13e44'},async()=>{
 const fs=require('node:fs'),{Interface,AbiCoder}=require('ethers'),coder=AbiCoder.defaultAbiCoder();
 const base=path.resolve(__dirname,'../../ChainWhisper Contracts V2/validation/candidates'),d=require(path.join(base,'c1-shared-integration-2026-10-05/durable-adapter.cjs')),mb=require(path.join(base,'c1-shared-integration-2026-10-05/market-binding.cjs'));
 const old=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../reports/c1-pool-trigger-repair-2026-11-08/BEFORE_WINDOW8_BUNDLE.json'))),m=old.manifest,ctx=runtime.inputs(),l=mb.layout(d.localBuild(false,d.CURRENT_BINDING));
 const capture=JSON.parse(fs.readFileSync(require(path.join(base,'limit-fill-history-shared-receipt-2026-10-13/app-async-service/public-binding.cjs')).captureFile));
 const codes=new Map(capture.reads.filter(v=>v.method==='eth_getCode').map(v=>[v.params[0].toLowerCase(),v.result])),storage=new Map(),interfaces=new Map(),now=Math.floor(Date.now()/1000),head={number:'0x64',hash:'0x'+'12'.repeat(32),timestamp:'0x'+now.toString(16),gasLimit:'0x7270e00',baseFeePerGas:'0x1'};
 const put=(slot,value)=>storage.set(String(slot),'0x'+BigInt(value).toString(16).padStart(64,'0'));
 for(const p of Object.values(m.pairs)){
  const addresses=Object.fromEntries(Object.entries(p.deployment).map(([n,row])=>[n,row.address]));
  for(const [name,row]of Object.entries(p.deployment)){codes.set(row.address.toLowerCase(),d.linkedRuntime(name,row.address,addresses,row.immutableValues,d.CURRENT_BINDING));interfaces.set(row.address.toLowerCase(),new Interface(d.artifactFor(name,d.CURRENT_BINDING).artifact.abi));}
  const root=mb.field(l,'_marketState'),type=l.types[root.type].value,slot=mb.map(root.slot,p.selectedMarket,'bytes32');
  for(const [label,value]of [['fixedEngine',addresses.ChainWhisperFixedEngine],['terminalEvaluator',addresses.ChainWhisperDexWideTerminalGT],['inputToken',p.tokens[0]],['outputToken',p.tokens[1]],['fixedEngineRuntimeHash',p.deployment.ChainWhisperFixedEngine.runtimeHash],['terminalEvaluatorRuntimeHash',p.deployment.ChainWhisperDexWideTerminalGT.runtimeHash],['_fixedEngineBindingCommitment',p.deployment.ChainWhisperFixedEngine.immutableValues[mb.CURRENT_IMMUTABLES.ChainWhisperFixedEngine.bindingCommitment]],['terminalEvaluatorBindingCommitment',p.deployment.ChainWhisperDexWideTerminalGT.immutableValues[mb.CURRENT_IMMUTABLES.ChainWhisperDexWideTerminalGT.bindingCommitment]]])put(slot+BigInt(mb.member(l,type,label).slot),value);
  const primary=p.selectedMarket===ctx.saved.pkg.market,c1=mb.field(l,primary?'_c1':'_marketC1'),ct=primary?c1.type:l.types[c1.type].value,cb=primary?BigInt(c1.slot):mb.map(c1.slot,p.selectedMarket,'bytes32');
  for(const [label,value]of [['owner',p.owner],['runtime',p.deployment.ChainWhisperC1Commands.runtimeHash],['mathRuntime',p.deployment.ChainWhisperC1Math.runtimeHash],['poolOwnerRuntime',p.deployment.ChainWhisperPoolOwner.runtimeHash],['fixedOwnerRuntime',p.deployment.ChainWhisperFixedOwner.runtimeHash],['ratioRuntime',p.deployment.ChainWhisperFixedProtectedRatio.runtimeHash],['ratio',addresses.ChainWhisperFixedProtectedRatio]])put(cb+BigInt(mb.member(l,ct,label).slot),value);
 }
 let count=0;
 const rpc=async(method,args)=>{count++;
  if(method==='eth_chainId')return'0x'+BigInt(m.chainId).toString(16);
  if(method==='eth_getBlockByNumber')return args[0]==='0x0'?{hash:m.genesisHash}:head;
  if(method==='eth_gasPrice')return'0x1';if(method==='eth_getBalance')return'0xde0b6b3a7640000';if(method==='eth_getTransactionCount')return'0x0';
  if(method==='eth_getCode'){if([m.operator,m.pairs['1'].owner].includes(args[0]))return'0x';assert(codes.has(args[0].toLowerCase()),'SYNTHETIC_CODE');return codes.get(args[0].toLowerCase());}
  if(method==='eth_getStorageAt'){assert(storage.has(String(BigInt(args[1]))),'SYNTHETIC_SLOT');return storage.get(String(BigInt(args[1])));}
  assert.equal(method,'eth_call');const iface=interfaces.get(args[0].to.toLowerCase()),call=iface.parseTransaction(args[0]);let values;
  if(call.name==='marketForTokens'){const [key,p]=Object.entries(m.pairs).find(([,p])=>p.tokens.every(t=>call.args.some(v=>v.toLowerCase()===t)));values=[p.selectedMarket,BigInt(key),6n,1n,true,p.deployment.ChainWhisperFixedEngine.address,p.deployment.ChainWhisperPoolTerms.address];}
  else if(call.name==='c1ForMarket')values=[coder.encode(['uint8','uint256','uint256','uint256','uint256'],[0,0,0,0,1])];
  else{const p=Object.values(m.pairs).find(p=>Object.values(p.deployment).some(v=>v.address.toLowerCase()===args[0].to.toLowerCase())),name={sharedMath:'ChainWhisperSharedPoolMath',positionNFT:'ChainWhisperDexPositionNFT',fastPoolQuote:'ChainWhisperDexFastPoolQuote'}[call.name];assert(name,'SYNTHETIC_GETTER');values=[p.deployment[name].address];}
  return iface.encodeFunctionResult(call.fragment,values);
 };
 const result=await runtime.build({rpc,ctx,now:()=>now});
 assert.equal(result.bundle.manifest.policy.coverage,d.COVERAGE);assert.equal(result.bundle.manifest.policySha256,d.policySha(result.bundle.manifest.policy));assert.match(result.bundle.sources['pool-coverage-policy.cjs'],/^[0-9a-f]{64}$/);
 for(const key of ['binding','candidate','chainId','genesisHash','operator','pairs'])assert.deepEqual(result.bundle.manifest[key],m[key],'ROLLOVER_'+key);
 assert.notDeepEqual(result.bundle.sources,old.sources);assert.equal(result.rpcCalls,count);console.log(JSON.stringify({kind:'C1_OFFLINE_SAVED_WINDOW_REBUILD',reads:count,sourceChanged:true,native:false}));
});
