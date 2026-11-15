'use strict';
// Read closed local accounting records. This interface grants no signing or send authority.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {Worker,isMainThread,parentPort,workerData} = require('node:worker_threads');
const ROOT = path.resolve(__dirname, '../..');
const GRAPH = '9c2cb36f958dc21ef11bf7d91ebf0373904a3d741edd6bf9eeae25752960631e';
assert(process.env.CW_LOW_RPC_TRIAL === undefined || process.env.CW_LOW_RPC_TRIAL === GRAPH, 'DEX_CURRENT_GRAPH_REQUIRED');
const CANDIDATES = 'ChainWhisper Contracts V2/validation/candidates';
const CURRENT = CANDIDATES + '/limit-fill-history-shared-receipt-2026-10-13';
const SHARED = CANDIDATES + '/c1-shared-integration-2026-10-05';
const ACTORS = Object.freeze({keeper:'0x23abde1d22019d52852d6845c9444326dde1d99e',prices:'0xc737b5850e15d03ed09bfadc8a33062f6073a850',matching:'0xdc9f6af38d2cab7b298bbcd807e521ef71ef5d91',c1:'0xddbfe89f9decad1b99406be4af8bb613065144be'});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const uint = value => { assert(typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value),'DEX_SERVICE_FEES_UINT');return BigInt(value); };
const identity = stat => ({dev:String(stat.dev),ino:String(stat.ino),birthtimeNs:String(stat.birthtimeNs)});
const source = file => require(path.join(ROOT, file));
// Only validated bundle identities cross worker calls. Journals and fees are always checked again.
let c1Validated = new Set();
function read(file) {
  const stat=fs.lstatSync(file,{bigint:true});
  assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1n&&stat.size<=67108864n,'DEX_SERVICE_FEES_FILE');
  assert.equal(fs.realpathSync.native(file),path.resolve(file),'DEX_SERVICE_FEES_FILE_REDIRECT');
  const fd=fs.openSync(file,'r');
  try {
    assert.deepEqual(identity(fs.fstatSync(fd,{bigint:true})),identity(stat),'DEX_SERVICE_FEES_FILE_REPLACED');
    const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true});
    assert(stat.size===after.size&&stat.mtimeNs===after.mtimeNs&&stat.ctimeNs===after.ctimeNs&&BigInt(bytes.length)===stat.size,'DEX_SERVICE_FEES_FILE_CHANGED');
    return {bytes,length:bytes.length,sha256:sha(bytes),fileIdentity:identity(stat)};
  } finally { fs.closeSync(fd); }
}
function directories(directory, pattern) {
  if(!fs.existsSync(directory))return [];
  const stat=fs.lstatSync(directory);
  assert(stat.isDirectory()&&!stat.isSymbolicLink()&&fs.realpathSync.native(directory)===path.resolve(directory),'DEX_SERVICE_FEES_DIRECTORY');
  return fs.readdirSync(directory).filter(name=>pattern.test(name)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(name=>{
    const file=path.join(directory,name),s=fs.lstatSync(file);
    assert(s.isDirectory()&&!s.isSymbolicLink(),'DEX_SERVICE_FEES_DIRECTORY');return file;
  });
}
function snapshot(service, {runtimeRoot=ROOT}={}) {
  assert(Object.hasOwn(ACTORS,service),'DEX_SERVICE_FEES_SERVICE');
  assert.equal(process.env.CW_LOW_RPC_TRIAL,GRAPH,'DEX_SERVICE_FEES_TARGET');
  runtimeRoot=path.resolve(runtimeRoot);
  const at=name=>path.join(runtimeRoot,name),journals=[],transactions=new Set();
  let context;
  const ctx=()=>context??=source(CURRENT+'/reference-history/package.cjs').accepted();
  const pub=()=>source(CURRENT+'/app-async-service/public-binding.cjs');
  const pp=()=>source(SHARED+'/native-fixture/pp-trial.cjs');
  function receipt(row, cap, fee) {
    assert(/^0x[0-9a-f]{64}$/i.test(row.hash)&&!transactions.has(row.hash.toLowerCase()),'DEX_SERVICE_FEES_DUPLICATE_RECEIPT');
    transactions.add(row.hash.toLowerCase());
    const gas=uint(row.gasUsed);assert(gas>0n&&gas<=BigInt(cap),'DEX_SERVICE_FEES_GAS');
    if(row.gasPriceWei!==undefined)assert.equal(uint(row.gasPriceWei),BigInt(fee),'DEX_SERVICE_FEES_PRICE');
    return gas*BigInt(fee);
  }
  function record(file,manifestFile,manifestHash,feeWei,captured,capturedManifest) {
    const current=read(file);if(captured)assert.deepEqual(current,captured,'DEX_SERVICE_FEES_FILE_CHANGED');
    const manifest=read(manifestFile);assert.deepEqual(manifest,capturedManifest,'DEX_SERVICE_FEES_MANIFEST_CHANGED');
    journals.push({path:path.relative(runtimeRoot,file).replaceAll('\\','/'),manifestHash,manifestSha256:manifest.sha256,
      length:current.length,sha256:current.sha256,fileIdentity:current.fileIdentity,feeWei:String(feeWei)});
  }
  function keeper() {
    const directory=at(CURRENT+'/app-async-service/app-host-'+GRAPH.slice(0,8)+'-'+ACTORS.keeper.slice(2));
    if(!fs.existsSync(directory))return;
    directories(path.dirname(directory),new RegExp('^app-host-'+GRAPH.slice(0,8)+'-'+ACTORS.keeper.slice(2)+'$'));
    const hostFile=path.join(directory,'HOST.json'),hostBytes=read(hostFile),host=JSON.parse(hostBytes.bytes),binding=pub().loadPublicBinding();
    assert(host.schema==='CURRENT_SHARED_HISTORY_APP_HOST_V1'&&host.chain==='7082400'&&host.genesis===binding.genesis&&host.core===binding.identity.core&&host.operator===ACTORS.keeper&&Array.isArray(host.operations),'DEX_SERVICE_FEES_HOST');
    assert.deepEqual(Object.keys(host).sort(),['schema','chain','genesis','core','operator','startBlock','sourceDigest','cursor','operations'].sort(),'DEX_SERVICE_FEES_HOST');
    assert(/^[0-9a-f]{64}$/.test(host.sourceDigest)&&host.operations.length<=32,'DEX_SERVICE_FEES_HOST');
    for(const block of [host.startBlock,host.cursor])assert(block&&/^(0|[1-9][0-9]*)$/.test(block.number)&&/^0x[0-9a-f]{64}$/i.test(block.hash),'DEX_SERVICE_FEES_HOST');
    assert(BigInt(host.cursor.number)>=BigInt(host.startBlock.number),'DEX_SERVICE_FEES_HOST');
    const normal=source(CURRENT+'/app-async-service/runtime/service.cjs');
    const parser=source(CANDIDATES+'/shared-core-exit-preview-native-2026-10-07/app-async-service/keeper-v4.cjs').createKeeper({c:{api:binding.api},CAP:normal.CAP,FEE:normal.FEE,RESERVE:normal.RESERVE,COMMIT:normal.COMMIT});
    const expected=new Set();
    for(const row of host.operations) {
      const n=row.nomination;assert(typeof row.finished==='boolean'&&/^[1-9][0-9]*$/.test(n?.operationId)&&/^0x[0-9a-f]{64}$/i.test(n.quoteHash),'DEX_SERVICE_FEES_HOST_OPERATION');
      const name=n.operationId+'-'+n.quoteHash.slice(2);assert(!expected.has(name),'DEX_SERVICE_FEES_HOST_OPERATION');expected.add(name);
      const operation=path.join(directory,name),manifestFile=path.join(operation,'manifest.json'),journal=path.join(operation,'journal.jsonl');
      if(!fs.lstatSync(operation,{throwIfNoEntry:false})){
        if(Object.hasOwn(row,'unstartedRetirement'))source(CURRENT+'/app-async-service/runtime/app-host.cjs').validateUnstartedRetirement(row,binding,ACTORS.keeper);
        else assert(!row.finished&&!Object.hasOwn(row,'retirement'),'DEX_SERVICE_FEES_HOST_RECORD_MISSING');
        continue;
      }
      const manifest=read(manifestFile),m=JSON.parse(manifest.bytes);normal.validateManifest(m,m.sources,binding);
      assert.equal(m.config.operator.toLowerCase(),ACTORS.keeper,'DEX_SERVICE_FEES_ACTOR');assert.equal(m.operationId,n.operationId);assert.equal(m.quoteHash,n.quoteHash);
      if(!fs.existsSync(journal)){assert(!fs.existsSync(path.join(operation,'signed-work')),'DEX_SERVICE_FEES_SIGNATURE_WITHOUT_JOURNAL');continue;}
      const captured=read(journal),state=parser.session(parser.parse(captured.bytes),m);
      assert(!state.pending,'DEX_SERVICE_FEES_UNRESOLVED');
      let failedReceipt=null;
      if(state.failed){
        assert(row.finished&&row.failedRetirement,'DEX_SERVICE_FEES_UNRESOLVED');
        const p=source(CURRENT+'/app-async-service/runtime/app-host.cjs').validateFailedRetirement(row,m,captured.bytes,binding,ACTORS.keeper);
        failedReceipt={hash:p.failedHash,gasUsed:p.receipt.gasUsed,gasPriceWei:p.receipt.gasPriceWei};
      }else assert(!row.failedRetirement&&state.starts.length===state.verifiedRows.length,'DEX_SERVICE_FEES_UNRESOLVED');
      const fee=state.verifiedRows.reduce((sum,r)=>sum+receipt(r,normal.CAP,normal.FEE),0n)+(failedReceipt?receipt(failedReceipt,normal.CAP,normal.FEE):0n);
      record(journal,manifestFile,m.hash,fee,captured,manifest);
    }
    for(const operation of directories(directory,/^[1-9][0-9]*-[0-9a-f]{64}$/i))assert(expected.has(path.basename(operation)),'DEX_SERVICE_FEES_HOST_ORPHAN');
    assert.deepEqual(read(hostFile),hostBytes,'DEX_SERVICE_FEES_HOST_CHANGED');
  }
  function prices() {
    const serviceModule=source(CURRENT+'/reference-history/service.cjs'),action=source(CURRENT+'/reference-history/action.cjs');
    const base=at(CANDIDATES+'/shared-core-exit-preview-native-2026-10-07/reference-history/service-v8');
    for(const directory of directories(base,new RegExp('^service-session-'+GRAPH.slice(0,5)+'-[1-9][0-9]*$'))) {
      const manifestFile=path.join(directory,'service.json'),manifest=read(manifestFile),m=JSON.parse(manifest.bytes);
      serviceModule.validateBinding(m,ctx(),path.basename(directory));
      const journal=path.join(directory,'service.jsonl'),captured=fs.existsSync(journal)?read(journal):null,state=serviceModule.controller.inspect(m);
      assert(!state.pending&&state.attempts===state.verified.length,'DEX_SERVICE_FEES_UNRESOLVED');
      const actions=new Set();
      for(const row of state.verified) {
        const target={dir:path.join(directory,'action-'+row.action)};target.manifest=path.join(target.dir,'manifest.json');target.journal=path.join(target.dir,'journal.jsonl');
        actions.add(path.basename(target.dir));const innerManifest=read(target.manifest),inner=JSON.parse(innerManifest.bytes),bytes=read(target.journal),binding=m.deployments[Number(row.canonicalId)-1].binding;
        assert(Object.entries(inner.pins).every(([name,digest])=>m.currentPins[name]===digest),'DEX_SERVICE_FEES_INNER_SOURCES');
        const config=action.make({ctx:ctx(),rpc:()=>{throw Error('DEX_SERVICE_FEES_NO_RPC');},selected:source(CURRENT+'/reference-history/package.cjs').market(ctx().saved,Number(row.canonicalId)),binding,kind:row.kind,pins:inner.pins,assertPins:()=>{},publicPublisher:true});
        config.validateManifest(inner,ctx().saved,{fresh:false});
        const progress=pp().prefix(pp().fixtureStore(target).history(),inner,config.steps);
        assert(!progress.pending&&!progress.next&&progress.done.length===1,'DEX_SERVICE_FEES_UNRESOLVED');const verified=progress.done[0];
        assert(verified.walletAndReceiptReconciled&&verified.afterSeal,'DEX_SERVICE_FEES_INNER_ACCOUNTING');
        assert.equal(verified.gasPriceWei,serviceModule.controller.LIMITS.feeWei,'DEX_SERVICE_FEES_PRICE');
        assert.equal(inner.actors.owner.toLowerCase(),ACTORS.prices,'DEX_SERVICE_FEES_ACTOR');
        assert.equal(row.transaction,verified.hash);assert.equal(row.gasUsed,verified.gasUsed);assert.equal(row.checkpoint.journal,bytes.sha256);assert.equal(row.checkpoint.manifest,pp().digest(inner));
        const fee=receipt(verified,row.kind==='record'?serviceModule.controller.LIMITS.recordGas:serviceModule.controller.LIMITS.refreshGas,serviceModule.controller.LIMITS.feeWei);
        record(target.journal,target.manifest,pp().digest(inner),fee,bytes,innerManifest);
      }
      for(const target of directories(directory,/^action-[0-9]+$/))assert(actions.has(path.basename(target)),'DEX_SERVICE_FEES_INNER_ORPHAN');
      if(captured)record(journal,manifestFile,serviceModule.controller.hash(m),0n,captured,manifest);
    }
  }
  function matching() {
    const runtime=source(CURRENT+'/matching-service/runtime.cjs');
    for(const directory of directories(at(CURRENT+'/matching-service/sessions-'+GRAPH.slice(0,12)),/^session-[1-9][0-9]*$/)) {
      const target={dir:directory,manifest:path.join(directory,'manifest.json'),journal:path.join(directory,'journal.jsonl'),retired:path.join(directory,'retired.json')};
      if(!fs.existsSync(target.manifest)) {
        const closed=JSON.parse(read(path.join(directory,'closed.json')).bytes);
        assert(closed.status==='MATCH_WINDOW_PREPARE_STOPPED'&&closed.prepared===false&&closed.noSend===true&&closed.sessionName===path.basename(directory)&&!fs.existsSync(target.journal),'DEX_SERVICE_FEES_INCOMPLETE');continue;
      }
      const manifest=read(target.manifest),captured=read(target.journal),saved=runtime.readSession(target,ctx());
      assert.equal(saved.m.actors.maker.toLowerCase(),ACTORS.matching,'DEX_SERVICE_FEES_ACTOR');
      assert(!saved.progress.pending,'DEX_SERVICE_FEES_UNRESOLVED');
      const fee=saved.progress.done.reduce((sum,r)=>{assert(r.walletAndReceiptReconciled&&r.afterSeal,'DEX_SERVICE_FEES_INNER_ACCOUNTING');assert.equal(r.gasPriceWei,saved.m.gasPriceWei,'DEX_SERVICE_FEES_PRICE');return sum+receipt(r,runtime.CAP,saved.m.gasPriceWei);},0n);
      record(target.journal,target.manifest,pp().digest(saved.m),fee,captured,manifest);
    }
  }
  function c1() {
    const runtime=source(CURRENT+'/c1-service/runtime.cjs'),durable=source(SHARED+'/durable-adapter.cjs'),runner=source(SHARED+'/runner.cjs');
    const base=at(SHARED+'/current-c1-operator-'+GRAPH.slice(0,8)),stream='7082400:'+ACTORS.c1+':'+GRAPH,pointerFile=at(SHARED+'/durable-adapter-check-stream-'+sha(stream)+'.json');
    const pointer=fs.existsSync(pointerFile)?JSON.parse(read(pointerFile).bytes):null,windows=directories(base,/^window-[1-9][0-9]*$/);let last=null;
    const connector=source(SHARED+'/connector.cjs'),sourceKey=sha(JSON.stringify(connector.sources(durable.CURRENT_BINDING,{coverage:durable.COVERAGE}))),validated=new Set();
    if(windows.length)durable.localBuild(false,durable.CURRENT_BINDING);
    for(const [i,directory] of windows.entries()) {
      assert.equal(path.basename(directory),'window-'+(i+1),'DEX_SERVICE_FEES_WINDOW_GAP');
      const manifestFile=path.join(directory,'bundle.json'),manifest=read(manifestFile),journal=path.join(directory,'journal.jsonl');
      // Closed historical fees do not authorize renewal on changed live source.
      const bundle=JSON.parse(manifest.bytes),{hash:bundleHash,sources:oldSources,...body}=bundle,hashed={...bundle};delete hashed.hash;
      assert.equal(bundleHash,durable.sha(JSON.stringify(hashed)),'DEX_SERVICE_FEES_C1_BUNDLE');
      const validationKey=sha(JSON.stringify([manifestFile,manifest.sha256,manifest.fileIdentity,sourceKey]));
      if(!c1Validated.has(validationKey)){
        const current=runtime.validateOperatorBundle(runner.bundleFor(bundle.manifest,{fromBlock:bundle.discovery.fromBlock,operatorRole:bundle.operatorRole,roles:bundle.roles}));
        const {sources:currentSources,...currentBody}=current;delete currentBody.hash;
        assert.deepEqual(body,currentBody,'DEX_SERVICE_FEES_C1_SCOPE');
        assert.deepEqual(Object.keys(oldSources).sort(),Object.keys(currentSources).sort(),'DEX_SERVICE_FEES_C1_SOURCES');
        assert(Object.values(oldSources).every(value=>/^[0-9a-f]{64}$/.test(value)),'DEX_SERVICE_FEES_C1_SOURCES');
      }
      validated.add(validationKey);
      const hash=durable.sha(JSON.stringify(bundle.manifest));
      if(!fs.existsSync(journal)){
        assert(i===0&&windows.length===1&&!pointer&&fs.readdirSync(directory).every(name=>['bundle.json','admission.json'].includes(name)),'DEX_SERVICE_FEES_C1_INCOMPLETE');continue;
      }
      const captured=read(journal),parsed=durable.readJournal(journal,hash),state=parsed.state;
      assert(parsed.bytes.equals(captured.bytes),'DEX_SERVICE_FEES_FILE_CHANGED');
      assert(!state.send&&!state.halt&&!state.policy.halt&&!state.policy.inflight,'DEX_SERVICE_FEES_UNRESOLVED');
      let prior=null;
      for(const row of captured.bytes.toString().trimEnd().split('\n').map(JSON.parse)) {
        const fee=uint(row.state.feesWei);assert(fee<=BigInt(bundle.manifest.policy.totalWei),'DEX_SERVICE_FEES_C1_BOUND');
        if(!prior)assert(fee===0n&&row.state.verified===0,'DEX_SERVICE_FEES_C1_INITIAL');
        else if(row.kind==='confirmed') {
          const increase=fee-uint(prior.feesWei);assert(increase>0n&&increase%BigInt(runtime.FEE)===0n&&prior.send?.hash&&!transactions.has(prior.send.hash.toLowerCase()),'DEX_SERVICE_FEES_C1_CONFIRMATION');
          assert(increase<=BigInt(prior.send.action.maxWei)&&row.state.verified===prior.verified+1,'DEX_SERVICE_FEES_C1_CONFIRMATION');transactions.add(prior.send.hash.toLowerCase());
        } else assert(fee===uint(prior.feesWei)&&row.state.verified===prior.verified,'DEX_SERVICE_FEES_C1_FEE_CHANGE');
        prior=row.state;
      }
      record(journal,manifestFile,hash,uint(state.feesWei),captured,manifest);last={journal,hash};
    }
    if(last||pointer)assert(last&&pointer&&pointer.version===1&&pointer.stream===stream&&pointer.journal===last.journal&&pointer.manifestHash===last.hash,'DEX_SERVICE_FEES_C1_POINTER');
    assert.equal(sha(JSON.stringify(connector.sources(durable.CURRENT_BINDING,{coverage:durable.COVERAGE}))),sourceKey,'DEX_SERVICE_FEES_SOURCE_CHANGED');
    c1Validated=validated;
  }
  try { ({keeper,prices,matching,c1})[service](); }
  catch(error) { throw Error(/^DEX_SERVICE_FEES_[A-Z_]+$/.test(error.message)?error.message:'DEX_SERVICE_FEES_RECORD_REJECTED'); }
  journals.sort((a,b)=>a.path.localeCompare(b.path));
  return {schema:'CURRENT_DEX_SERVICE_FEES_V1',runtimeRoot,service,graph:GRAPH,chainId:'7082400',actor:ACTORS[service],feeWei:String(journals.reduce((sum,row)=>sum+uint(row.feeWei),0n)),journals};
}
function delta(before,after) {
  for(const key of ['schema','runtimeRoot','service','graph','chainId','actor'])assert.equal(after[key],before[key],'DEX_SERVICE_FEES_IDENTITY');
  assert.equal(before.schema,'CURRENT_DEX_SERVICE_FEES_V1','DEX_SERVICE_FEES_SCHEMA');
  const index=snapshot=>{
    const rows=new Map();for(const row of snapshot.journals){assert(typeof row.path==='string'&&row.path&&!path.isAbsolute(row.path)&&!row.path.split(/[\\/]/).includes('..')&&!rows.has(row.path),'DEX_SERVICE_FEES_PATH');assert(Number.isSafeInteger(row.length)&&row.length>=0&&/^[0-9a-f]{64}$/.test(row.sha256),'DEX_SERVICE_FEES_METADATA');uint(row.feeWei);rows.set(row.path,row);}
    assert.equal(String([...rows.values()].reduce((sum,row)=>sum+uint(row.feeWei),0n)),snapshot.feeWei,'DEX_SERVICE_FEES_TOTAL');return rows;
  };
  const old=index(before),current=index(after);let difference=0n;
  for(const [file,prior]of old) {
    const row=current.get(file);assert(row,'DEX_SERVICE_FEES_REMOVED');
    assert(row.length>=prior.length,'DEX_SERVICE_FEES_TRUNCATED');assert.deepEqual(row.fileIdentity,prior.fileIdentity,'DEX_SERVICE_FEES_REPLACED');
    assert(row.manifestHash===prior.manifestHash&&row.manifestSha256===prior.manifestSha256,'DEX_SERVICE_FEES_MANIFEST_CHANGED');
    const actual=read(path.join(after.runtimeRoot,file));
    assert(actual.length===row.length&&actual.sha256===row.sha256,'DEX_SERVICE_FEES_FILE_CHANGED');assert.deepEqual(actual.fileIdentity,row.fileIdentity,'DEX_SERVICE_FEES_REPLACED');
    assert.equal(sha(actual.bytes.subarray(0,prior.length)),prior.sha256,'DEX_SERVICE_FEES_PREFIX_CHANGED');
    if(row.length===prior.length)assert.equal(row.feeWei,prior.feeWei,'DEX_SERVICE_FEES_FEE_WITHOUT_APPEND');
    const fee=uint(row.feeWei)-uint(prior.feeWei);assert(fee>=0n,'DEX_SERVICE_FEES_DECREASED');difference+=fee;
  }
  for(const [file,row]of current)if(!old.has(file)){const actual=read(path.join(after.runtimeRoot,file));assert(actual.sha256===row.sha256&&actual.length===row.length,'DEX_SERVICE_FEES_FILE_CHANGED');assert.deepEqual(actual.fileIdentity,row.fileIdentity,'DEX_SERVICE_FEES_REPLACED');difference+=uint(row.feeWei);}
  assert.equal(difference,uint(after.feeWei)-uint(before.feeWei),'DEX_SERVICE_FEES_INEXACT_DELTA');return String(difference);
}
function errorCode(error) {
  const code=error?.message?.split('\n')[0];
  return /^DEX_SERVICE_FEES_[A-Z_]+$/.test(code)?code:'DEX_SERVICE_FEES_RECORD_REJECTED';
}
function accountingAsync(operation,args) {
  return new Promise((resolve,reject)=>{
    let worker;
    try{worker=new Worker(__filename,{workerData:{operation,args,...(operation==='snapshot'&&args[0]==='c1'?{c1Validated:[...c1Validated]}:{})},stdout:true,stderr:true});}
    catch{reject(Error('DEX_SERVICE_FEES_WORKER_FAILED'));return;}
    // Do not forward dependency logs or raw assertion details to the supervisor.
    worker.stdout.resume();worker.stderr.resume();
    let result;
    worker.once('message',message=>{result=message;});
    worker.once('error',()=>reject(Error('DEX_SERVICE_FEES_WORKER_FAILED')));
    worker.once('exit',code=>{
      if(code!==0||!result)reject(Error('DEX_SERVICE_FEES_WORKER_FAILED'));
      else if(result.error)reject(Error(result.error));
      else {if(result.c1Validated)c1Validated=new Set(result.c1Validated);resolve(result.value);}
    });
  });
}
const snapshotAsync=(service,options)=>accountingAsync('snapshot',[service,options]);
const deltaAsync=(before,after)=>accountingAsync('delta',[before,after]);
if(!isMainThread&&require.main===module) {
  try {
    assert(workerData&&['snapshot','delta'].includes(workerData.operation),'DEX_SERVICE_FEES_OPERATION');
    if(workerData.c1Validated)c1Validated=new Set(workerData.c1Validated);
    const value=workerData.operation==='snapshot'?snapshot(...workerData.args):delta(...workerData.args);
    parentPort.postMessage({value,...(workerData.operation==='snapshot'&&workerData.args[0]==='c1'?{c1Validated:[...c1Validated]}:{})});
  }catch(error){parentPort.postMessage({error:errorCode(error)});}
}
module.exports={snapshot,delta,snapshotAsync,deltaAsync};
