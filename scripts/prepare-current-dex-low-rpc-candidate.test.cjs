'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const adapter=require('./prepare-current-dex-low-rpc-candidate.cjs');
const root=path.resolve(__dirname,'../../ChainWhisper Contracts V2/validation/candidates/packed-rate-input-2026-11-03');
const trial=path.resolve(__dirname,'../reports/low-rpc-trial-2026-11-05'),report=path.join(trial,'public-binding');
const json=file=>JSON.parse(fs.readFileSync(file));
const rows=file=>fs.readFileSync(file,'utf8').trim().split(/\r?\n/).map(JSON.parse);
const encode=value=>new TextEncoder().encode(JSON.stringify(value));
const tag={blockHash:'0x'+'11'.repeat(32),requireCanonical:true};
const address='0x'+'22'.repeat(20);

test('exact new graph binds44 constructors22 seed actions ABI and embedded matcher without network or credentials',async()=>{
 const read=fs.readFileSync,fetch=global.fetch;
 fs.readFileSync=function(file,...args){assert(!/(?:^|[\\/])\.env(?:[.\\/]|$)|credentials\.json|private.keys/i.test(String(file)),'NO_CREDENTIAL_READ');return read.call(this,file,...args);};
 global.fetch=()=>assert.fail('NO_NETWORK');
 try{const input=adapter.inputs(),checked=await adapter.main('--check-inputs');
  assert.equal(input.pkg.expectedCore,adapter.CORE);assert.equal(input.packageSha256,adapter.PACKAGE);assert.equal(input.frozen.manifest.binding.graphSha256,adapter.GRAPH);
  assert.equal(input.runtimes.length,44);assert.equal(input.minimumBlock,'10462136');assert.equal(input.protocol.coreAbiSha256,adapter.CORE_ABI);
  assert.equal(input.embedded.creationBytes,7917);assert.equal(input.embedded.runtime.length/2,7695);assert.equal(checked.seedActions,22);assert.equal(checked.noNetwork,true);assert.equal(checked.readyToSign,false);
  assert.deepEqual(input.factoryStorage.map(row=>row[0]),['5','6','7','10']);
 }finally{fs.readFileSync=read;global.fetch=fetch;}
});

test('constructor evidence rejects pending source nonce hash status and runtime drift',()=>{
 const input=adapter.baseInputs(),journal=rows(path.join(root,'low-rpc-native-deployment-1/journal.jsonl'));
 const sources=require(path.join(root,'low-rpc-deployment.cjs')).sourcePins();
 for(const mutate of [x=>x.pop(),x=>x[0].graph='wrong',x=>x[0].packageSha256='wrong',x=>x[0].nonce='1',x=>x.find(r=>r.kind==='signed').hash='0x'+'00'.repeat(32),x=>x.find(r=>r.kind==='verified').status=0,x=>x.find(r=>r.kind==='verified').runtimeHash='0x00']){
  const changed=structuredClone(journal);mutate(changed);assert.throws(()=>adapter.verifyJournal(changed,input.pkg,sources));
 }
});

test('seed prefix rejects missing/pending actions and a result from another graph or receipt sequence',()=>{
 const input=adapter.baseInputs(),seed=json(path.join(trial,'NATIVE_SEED_RESULT.json')),manifest=json(path.join(trial,'native-seed/packed-manifest-1.json')),journal=rows(path.join(trial,'native-seed/packed-journal-1.jsonl'));
 assert.equal(adapter.verifySeed(seed,manifest,journal,input.pkg),'10462136');
 assert.throws(()=>adapter.verifySeed(seed,manifest,journal.slice(0,-1),input.pkg));
 for(const mutate of [s=>s.graph='wrong',s=>s.noPending=false,s=>s.signedHashes[0]='0x'+'00'.repeat(32),s=>s.walletAndReceiptReconciled=false]){const changed=structuredClone(seed);mutate(changed);assert.throws(()=>adapter.verifySeed(changed,manifest,journal,input.pkg));}
 const changed=structuredClone(journal);changed.find(r=>r.kind==='signed').hash='0x'+'00'.repeat(32);assert.throws(()=>adapter.verifySeed(seed,manifest,changed,input.pkg));
});

test('HTTPS reader batches reads counts wire payloads and reuses only an identical observation key',async()=>{
 let physical=0;const capture={reads:[]};
 const reader=adapter.createReader('--capture',capture,async request=>{physical++;assert.equal(request.url,adapter.ENDPOINT);const payload=JSON.parse(new TextDecoder().decode(request.body));const reply=item=>({jsonrpc:'2.0',id:item.id,result:'0x1234'});return{statusCode:200,headers:{},body:encode(Array.isArray(payload)?payload.map(reply).reverse():reply(payload))};});
 try{
  assert.deepEqual(await Promise.all([reader.rpc('eth_getCode',[address,tag]),reader.rpc('eth_getCode',[address,tag]),reader.rpc('eth_getStorageAt',[address,'0x0',tag])]),['0x1234','0x1234','0x1234']);
  const s=reader.stats();assert.equal(s.logicalCalls,3);assert.equal(s.cacheHits,1);assert.equal(s.jsonPayloads,2);assert.equal(s.physicalHttp,1);assert.equal(physical,1);assert.equal(s.errors,0);assert.equal(capture.reads.length,2);assert.equal(s.pacing.intervalMs,334);
 }finally{await reader.close();}
 const replay=adapter.createReader('--check',capture,()=>assert.fail('NO_NETWORK'));
 assert.equal(await replay.rpc('eth_getCode',[address,tag]),'0x1234');assert.equal(await replay.rpc('eth_getStorageAt',[address,'0x0',tag]),'0x1234');replay.assertConsumed();assert.equal(replay.stats().physicalHttp,0);
});

test('first HTTP or RPC error stops further physical requests without retry',async()=>{
 for(const failure of ['http','rpc']){
  let physical=0;const reader=adapter.createReader('--capture',{reads:[]},async request=>{physical++;const payload=JSON.parse(new TextDecoder().decode(request.body));const reply=item=>({jsonrpc:'2.0',id:item.id,error:{code:-32000,message:'synthetic stop'}});return failure==='http'?{statusCode:403,headers:{},body:encode({})}:{statusCode:200,headers:{},body:encode(Array.isArray(payload)?payload.map(reply):reply(payload))};});
  try{await assert.rejects(reader.rpc('eth_getCode',[address,tag]));await assert.rejects(reader.rpc('eth_chainId',[]));assert.equal(physical,1);assert.equal(reader.stats().physicalHttp,1);assert(reader.stats().errors>=1);}finally{await reader.close();}
 }
});

test('latest numeric and noncanonical tags are not cached',async()=>{
 let physical=0;const reader=adapter.createReader('--capture',{reads:[]},async request=>{
  physical++;const item=JSON.parse(new TextDecoder().decode(request.body));
  return{statusCode:200,headers:{},body:encode({jsonrpc:'2.0',id:item.id,result:'0x1234'})};
 });
 try{
  for(const at of ['latest','0x1',{...tag,requireCanonical:false}]){
   await reader.rpc('eth_getCode',[address,at]);await reader.rpc('eth_getCode',[address,at]);
  }
  assert.equal(reader.stats().logicalCalls,6);assert.equal(reader.stats().cacheHits,0);assert.equal(physical,6);
 }finally{await reader.close();}
});

test('reader rejects sends missing saved reads and unused capture rows',async()=>{
 const reader=adapter.createReader('--capture',{reads:[]},()=>assert.fail('NO_NETWORK'));
 await assert.rejects(reader.rpc('eth_sendRawTransaction',['0x']),/LOW_RPC_READ_ONLY/);assert.equal(reader.stats().physicalHttp,0);await reader.close();
 const replay=adapter.createReader('--check',{reads:[{method:'eth_chainId',params:[],result:'0x6c12a0'}]},()=>assert.fail('NO_NETWORK'));
 assert.throws(()=>replay.assertConsumed(),/LOW_RPC_UNUSED_CAPTURE_ROWS/);await assert.rejects(replay.rpc('eth_getCode',[address,tag]),/LOW_RPC_CAPTURED_READ_REQUIRED/);
});

test('only public modes are admitted and output cannot change App/default candidate files',async()=>{
 for(const mode of ['--send','--enable','--prove-embedded','--sign'])await assert.rejects(adapter.main(mode),/LOW_RPC_PUBLIC_MODE/);
 assert.throws(()=>adapter.reportPath(path.resolve(__dirname,'../src/generated.ts')),/LOW_RPC_REPORT_OUTPUT_ONLY/);
 assert.equal(adapter.reportPath(path.join(report,'capture.json')),path.join(report,'capture.json'));
 const folder=fs.mkdtempSync(path.join(report,'collector-test-')),file=path.join(folder,'capture.json');
 try{
  const capture={schema:adapter.SCHEMA,destination:adapter.ENDPOINT,graph:adapter.GRAPH,packageSha256:adapter.PACKAGE,assemblySha256:adapter.ASSEMBLY,sourcePins:adapter.sourcePins(),bounds:adapter.BOUNDS,complete:false,reads:[]};
  fs.writeFileSync(file,JSON.stringify(capture));await assert.rejects(adapter.main('--check',file),/LOW_RPC_INCOMPLETE_CAPTURE/);
  capture.complete=true;capture.graph='958eea2faf9aec536df3318d5b770acec1da36efa1665cfc11a0c788d97f8fdf';fs.writeFileSync(file,JSON.stringify(capture));await assert.rejects(adapter.main('--check',file));
 }finally{fs.unlinkSync(file);fs.rmdirSync(folder);}
});
