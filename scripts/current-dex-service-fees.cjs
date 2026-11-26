'use strict';
// Read closed local accounting records. This interface grants no signing or send authority.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {Worker,isMainThread,parentPort,workerData} = require('node:worker_threads');
const ROOT = path.resolve(__dirname, '../..');
const GRAPH = '9c2cb36f958dc21ef11bf7d91ebf0373904a3d741edd6bf9eeae25752960631e';
const REPLACEMENT_GRAPH = '1a73e0205ca448e4eed5cdbbd4bb850dd87a0b08d183da20e44631fd4dd71fe7';
const WIDE_FIRST_GRAPH = '9e6c03ac69178445605dc78a70e088b596684181d73b218a6a3a89e942b3af21';
const build13Graph = '5045070b8faad2caab781e2981ad3300b7d916016b7a1d354fe59b12a1d1c239';
assert([undefined,GRAPH,REPLACEMENT_GRAPH,WIDE_FIRST_GRAPH,build13Graph].includes(process.env.CW_LOW_RPC_TRIAL), 'DEX_CURRENT_GRAPH_REQUIRED');
const CANDIDATES = 'ChainWhisper Contracts V2/validation/candidates';
const CURRENT = CANDIDATES + '/limit-fill-history-shared-receipt-2026-10-13';
const SHARED = CANDIDATES + '/c1-shared-integration-2026-10-05';
const REPLACEMENT = CANDIDATES + '/c1-band-sizing-2026-11-21';
const CONVERGENCE = REPLACEMENT + '/window-b/convergence';
const CONVERGENCE_BINDING = 'b845c354e58b16a8103960a7ee18c71c6cd99466751c28feb1009ed301dd7dda';
const WIDE_FIRST_BINDING = '6f6c3efd3b6915343f9281348a1dc313cee7fe99727fac50144ec44c364e5d5f';
const SIZING_BINDING = '0f8979593242e8aa85fdda878f3967c89e60a460eef84b859e84858f0fdffbf9';
const build13PeerBinding = '78bf74adac5634948defe7f1a168462f87f97cfbc93d8742859a55742e5668bd';
const build13StandingBinding = '35350b730e959fdbb8557edce5b61c2110f585ffda234b2dde58c78e4fa2e3cb';
const build13PriceAdmission = 'f5423f884ada6eaec1341ed4e7970ab17bd8bf0d398e92f06462f12cb82e5dc2';
const widePeerBindingEnv=Object.freeze({keeper:'CHAINWHISPER_KEEPER_BINDING_SHA256',
  prices:'CHAINWHISPER_PRICE_BINDING_SHA256',matching:'CHAINWHISPER_MATCHING_BINDING_SHA256'});
const ACTORS = Object.freeze({keeper:'0x23abde1d22019d52852d6845c9444326dde1d99e',prices:'0xc737b5850e15d03ed09bfadc8a33062f6073a850',matching:'0xdc9f6af38d2cab7b298bbcd807e521ef71ef5d91',c1:'0xddbfe89f9decad1b99406be4af8bb613065144be'});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const uint = value => { assert(typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value),'DEX_SERVICE_FEES_UINT');return BigInt(value); };
const identity = stat => ({dev:String(stat.dev),ino:String(stat.ino),birthtimeNs:String(stat.birthtimeNs)});
const source = file => require(path.join(ROOT, file));
const nextSendPhase={prepared:'signing',signing:'signed',signed:'broadcast'};
const COMMIT_UNBROADCAST='C1_COMMIT_UNBROADCAST';
const DISPATCH_UNBROADCAST='C1_DISPATCH_UNBROADCAST';
function assertEarlyExpiryAbort(manifest, send, durable=source(SHARED+'/durable-adapter.cjs')) {
  const call=durable.publicCall(manifest,send.envelope,[6],'DEX_SERVICE_FEES_UNBROADCAST');
  const identity=send.action.identity;
  assert(call.earlyExpiry&&call.pair===send.action.pair&&identity?.stage===1&&
    call.earlyExpiry.nonce===identity.nonce&&call.earlyExpiry.cursor===identity.cursor,'DEX_SERVICE_FEES_UNBROADCAST');
}
function assertCommitFitAbort(manifest, send, proof, durable=source(SHARED+'/durable-adapter.cjs')) {
  const guard='DEX_SERVICE_FEES_UNBROADCAST';
  assert(durable.REPLACEMENT_BINDING&&manifest.policy?.coverage==='tier-passes-v2',guard);
  assert.deepEqual(manifest.binding,durable.REPLACEMENT_BINDING,guard);
  const call=durable.publicCall(manifest,send.envelope,[2],guard),action=send.action;
  assert(call.pair===action.pair&&action.identity?.stage===1&&proof.operatorNonce===action.senderNonce&&
    uint(proof.operatorNonce)===uint(send.envelope.nonce)&&uint(proof.operatorBalanceWei)===uint(send.beforeBalance),guard);
}
function replacementFeeCap(durable,manifest,send) {
  const guard='DEX_SERVICE_FEES_C1_CONFIRMATION',e=send?.envelope,a=send?.action;
  assert(['signed','broadcast'].includes(send?.phase)&&/^0x[0-9a-f]{64}$/i.test(send.hash)&&e&&a,guard);
  const call=durable.publicCall(manifest,e,[1,2,6],guard);
  assert(call.action===a.action&&call.pair===a.pair&&e.nonce===a.senderNonce&&e.chainId===manifest.chainId&&e.type===0&&e.value==='0'&&
    e.gasLimit===manifest.gasCaps[call.action]&&e.gasPrice===manifest.feeCeilingWei&&
    a.maxWei===manifest.policy.caps[call.action],guard);
  return uint(a.maxWei);
}
function fitExitEvidence(durable,manifest,prior,state,proof,confirmedQuote) {
  const guard='DEX_SERVICE_FEES_C1_EXIT_WINDOW',send=prior.send,active=prior.policy.active;
  const {pair,identity}=send.action,{hash,check,headHash,time,operatorNonce,operatorBalanceWei}=proof;
  assert(check==='fit'&&Number.isSafeInteger(send.action.preparedAt)&&send.action.preparedAt>0&&
    time>=send.action.preparedAt&&!prior.rollover&&!state.rollover&&active?.pair===pair,guard);
  assert.deepEqual(active.identity,identity,guard);
  const publicIdentity=source(SHARED+'/service-policy.cjs').identity;
  assert.deepEqual(identity,publicIdentity(identity),guard);
  assert.deepEqual(prior.policy.inflight,{...send.action,txHash:send.hash},guard);
  assert.deepEqual(state.policy.active,active,guard);
  assert.deepEqual(state.unbroadcastCommit,proof,guard);
  replacementFeeCap(durable,manifest,send);
  const {send:quote,active:quoted,block,previousBlock,gasUsed}=confirmedQuote??{};
  assert(quote&&quoted?.pair===pair&&block&&block.cursor===identity.cursor&&
    /^0x[0-9a-f]{64}$/i.test(block.hash)&&uint(block.number)>0n,guard);
  assert.deepEqual(quoted.identity,identity,guard);
  assert.deepEqual(prior.quotes?.[pair],block,guard);
  assert.deepEqual(state.quotes?.[pair],block,guard);
  assert.notDeepEqual(previousBlock,block,guard);
  const before=publicIdentity(quote.action.identity),quoteTime=uint(block.timestamp);
  assert(before.stage===0&&uint(identity.nonce)===uint(before.nonce)+1n&&
    before.cursor===identity.cursor&&before.capitalRevision===identity.capitalRevision&&
    Number.isSafeInteger(quote.action.preparedAt)&&quote.action.preparedAt>0&&
    BigInt(quote.action.preparedAt)<=quoteTime&&quoteTime<=BigInt(send.action.preparedAt)&&
    quoteTime<uint(identity.deadline),guard);
  return {pair,identity,proof:{hash,check,headHash,time,operatorNonce,operatorBalanceWei},
    quote:{hash:quote.hash,nonce:quote.envelope.nonce,gasUsed,block:{number:block.number,hash:block.hash,timestamp:block.timestamp}}};
}
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
function snapshot(service, {runtimeRoot=ROOT,c1Halt,replacementBindingSha256,ownerExit=false,idleOwnerExit=false,
  standingInitialOperatorNonce}={}) {
  assert(Object.hasOwn(ACTORS,service),'DEX_SERVICE_FEES_SERVICE');
  assert(c1Halt===undefined||(service==='c1'&&typeof c1Halt==='string'&&/^[A-Z][A-Z0-9_]{2,63}$/.test(c1Halt)),'DEX_SERVICE_FEES_C1_HALT');
  const replacement=replacementBindingSha256!==undefined;
  const standing=standingInitialOperatorNonce!==undefined;
  if(replacement)assert(typeof replacementBindingSha256==='string'&&/^[0-9a-f]{64}$/.test(replacementBindingSha256),
    'DEX_SERVICE_FEES_REPLACEMENT_SCOPE');
  else assert.equal(process.env.CW_LOW_RPC_TRIAL,GRAPH,'DEX_SERVICE_FEES_TARGET');
  if(standing){
    assert(service==='c1'&&replacement&&!ownerExit&&!idleOwnerExit,'DEX_SERVICE_FEES_C1_STANDING_SCOPE');
    uint(standingInitialOperatorNonce);
  }
  assert(!ownerExit||(ownerExit===true&&service==='c1'&&replacement&&c1Halt===COMMIT_UNBROADCAST),'DEX_SERVICE_FEES_C1_EXIT_WINDOW');
  assert(idleOwnerExit===false||idleOwnerExit===true&&service==='c1'&&replacement&&!ownerExit&&c1Halt===undefined,'DEX_SERVICE_FEES_C1_IDLE_EXIT_WINDOW');
  const wide=replacementBindingSha256===WIDE_FIRST_BINDING;
  const sizing=replacementBindingSha256===SIZING_BINDING;
  const sizingPeer=replacementBindingSha256===build13PeerBinding;
  const sizingStanding=replacementBindingSha256===build13StandingBinding;
  const convergence=wide||sizing||sizingStanding||replacementBindingSha256===CONVERGENCE_BINDING;
  if(sizingPeer)assert(service!=='c1'&&!standing&&!ownerExit&&!idleOwnerExit,'DEX_SERVICE_FEES_REPLACEMENT_SCOPE');
  if(sizingStanding)assert(service==='c1'&&standing,'DEX_SERVICE_FEES_REPLACEMENT_SCOPE');
  if(convergence&&!wide&&!sizingStanding)assert(service==='c1'&&!standing&&!ownerExit&&!idleOwnerExit,'DEX_SERVICE_FEES_REPLACEMENT_SCOPE');
  if(wide)assert(!ownerExit&&!idleOwnerExit,'DEX_SERVICE_FEES_REPLACEMENT_SCOPE');
  const wideRuntime=wide?source(REPLACEMENT+'/window-b/wide-first/service-runtime.cjs'):null;
  const sizingRuntime=sizingStanding?source(REPLACEMENT+'/sizing-standing-runtime.cjs'):
    sizing?source(REPLACEMENT+'/sizing-rehearsal-runtime.cjs'):null;
  const graph=sizingPeer||sizingStanding?build13Graph:sizing?sizingRuntime.BINDING.graph:wide?WIDE_FIRST_GRAPH:convergence?source(REPLACEMENT+'/window-b/convergence-service-state.cjs').graph:
    replacement?REPLACEMENT_GRAPH:GRAPH;
  if((wide||sizingPeer)&&service!=='c1'){
    assert(process.env.CW_LOW_RPC_TRIAL===undefined&&process.env[widePeerBindingEnv[service]]===replacementBindingSha256,
      'DEX_SERVICE_FEES_TARGET');
    if(wide)wideRuntime.openRuntime(replacementBindingSha256);
  }else if(replacement&&service!=='c1'){
    if(service!=='prices')assert.equal(process.env.CW_LOW_RPC_TRIAL,graph,'DEX_SERVICE_FEES_TARGET');
    assert.equal(read(path.join(ROOT,REPLACEMENT,'window-b','SERVICE_BINDING.json')).sha256,
      replacementBindingSha256,'DEX_SERVICE_FEES_REPLACEMENT_SCOPE');
  }
  runtimeRoot=path.resolve(runtimeRoot);
  const at=name=>path.join(runtimeRoot,name),journals=[],transactions=new Set();
  let context,ownerExitWindow,idleExitWindow;
  const idleWindows=[];
  let priceInputs;
  const boundPrices=()=>{
    const factory=source(REPLACEMENT+'/window-b/price-inputs.cjs');
    priceInputs??=sizingPeer?factory.openBuild13Prices(replacementBindingSha256,service==='prices'?build13PriceAdmission:undefined):
      (wide?factory.openWideFirstPrices:factory.openReplacementPrices)(replacementBindingSha256);
    return priceInputs;
  };
  const ctx=()=>context??=(wide||sizingPeer?boundPrices().ctx:source(CURRENT+'/reference-history/package.cjs').accepted());
  const actor=sizingPeer&&service==='prices'?ctx().saved.base.actors.owner.address.toLowerCase():ACTORS[service];
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
    const directory=at(CURRENT+'/app-async-service/app-host-'+graph.slice(0,8)+'-'+ACTORS.keeper.slice(2));
    if(!fs.existsSync(directory))return;
    directories(path.dirname(directory),new RegExp('^app-host-'+graph.slice(0,8)+'-'+ACTORS.keeper.slice(2)+'$'));
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
    const retained=source(CURRENT+'/reference-history/service.cjs');
    const inputs=replacement?boundPrices():null;
    if(inputs)assert.equal(inputs.recorderPackage.GRAPH,graph,'DEX_SERVICE_FEES_PRICE_GRAPH');
    const serviceModule=inputs?retained.createService(inputs):retained;
    const action=inputs?.actions??source(CURRENT+'/reference-history/action.cjs');
    const pricePackage=inputs?.recorderPackage??source(CURRENT+'/reference-history/package.cjs');
    const tag=graph.slice(0,5);
    if(inputs)assert(fs.existsSync(serviceModule.controller.sessionRoots(runtimeRoot,tag)[0]),'DEX_SERVICE_FEES_PRICE_STATE_MISSING');
    for(const directory of serviceModule.controller.sessionDirectories(runtimeRoot,tag)) {
      const priceContext=inputs?.ctx??ctx();
      const manifestFile=path.join(directory,'service.json'),manifest=read(manifestFile),m=JSON.parse(manifest.bytes);
      serviceModule.validateBinding(m,priceContext,path.basename(directory));
      const journal=path.join(directory,'service.jsonl'),captured=fs.existsSync(journal)?read(journal):null,state=serviceModule.controller.inspect(m);
      assert(!state.pending&&state.attempts===state.verified.length,'DEX_SERVICE_FEES_UNRESOLVED');
      const actions=new Set();
      for(const row of state.verified) {
        const target={dir:path.join(directory,'action-'+row.action)};target.manifest=path.join(target.dir,'manifest.json');target.journal=path.join(target.dir,'journal.jsonl');
        actions.add(path.basename(target.dir));const innerManifest=read(target.manifest),inner=JSON.parse(innerManifest.bytes),bytes=read(target.journal),binding=m.deployments[Number(row.canonicalId)-1].binding;
        assert(Object.entries(inner.pins).every(([name,digest])=>m.currentPins[name]===digest),'DEX_SERVICE_FEES_INNER_SOURCES');
        const config=action.make({ctx:priceContext,rpc:()=>{throw Error('DEX_SERVICE_FEES_NO_RPC');},selected:pricePackage.market(priceContext.saved,Number(row.canonicalId)),binding,kind:row.kind,pins:inner.pins,assertPins:()=>{},publicPublisher:true});
        config.validateManifest(inner,priceContext.saved,{fresh:false});
        const progress=pp().prefix(pp().fixtureStore(target).history(),inner,config.steps);
        assert(!progress.pending&&!progress.next&&progress.done.length===1,'DEX_SERVICE_FEES_UNRESOLVED');const verified=progress.done[0];
        assert(verified.walletAndReceiptReconciled&&verified.afterSeal,'DEX_SERVICE_FEES_INNER_ACCOUNTING');
        assert.equal(verified.gasPriceWei,serviceModule.controller.LIMITS.feeWei,'DEX_SERVICE_FEES_PRICE');
        assert.equal(inner.actors.owner.toLowerCase(),actor,'DEX_SERVICE_FEES_ACTOR');
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
    for(const directory of directories(at(CURRENT+'/matching-service/sessions-'+graph.slice(0,12)),/^session-[1-9][0-9]*$/)) {
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
    const implementation=SHARED+(convergence?'/convergence-':'/');
    const durable=source(implementation+'durable-adapter.cjs');
    const runtime=replacement?null:source(CURRENT+'/c1-service/runtime.cjs'),runner=replacement?null:source(SHARED+'/runner.cjs');
    const stream='7082400:'+ACTORS.c1+':'+graph;
    const replacementState=replacement?source(REPLACEMENT+'/window-b/'+(convergence?'convergence-':'')+'service-state.cjs'):null;
    const statePaths={runtimeRoot,stream};
    const base=replacementState?.paths(statePaths).base??at(SHARED+'/current-c1-operator-'+graph.slice(0,8));
    const windowName=/^window-[1-9][0-9]*$/,windows=directories(base,windowName);
    const continuations=replacement?windows.slice(1).map(directory=>path.join(directory,'continuation.json')):[];
    if(replacement)assert(windows.length<=(standing?replacementState.STANDING_WINDOWS:replacementState.REHEARSAL_WINDOWS)&&
      continuations.every(file=>fs.existsSync(file)),'DEX_SERVICE_FEES_REPLACEMENT_WINDOW');
    const links=continuations.map(file=>{const captured=read(file);return {file,captured,proof:JSON.parse(captured.bytes)};});
    const diskState=replacementState?.checkPaths(statePaths);
    if(replacement)assert(diskState.ordinal===Math.max(1,windows.length),'DEX_SERVICE_FEES_REPLACEMENT_WINDOW');
    const pointerFile=diskState?.pointer??at(SHARED+'/durable-adapter-check-stream-'+sha(stream)+'.json');
    const readPointer=()=>fs.existsSync(pointerFile)?read(pointerFile):null;
    const pointerBefore=readPointer(),pointer=pointerBefore?JSON.parse(pointerBefore.bytes):null;
    let last=null,matchedHalt=false;
    const broadcasts=new Set();
    const idleReceipts=[];
    let idleSenderLock;
    const selected=sizingRuntime?sizingRuntime.BINDING:wide?wideRuntime.BINDING:replacement?durable.REPLACEMENT_BINDING:durable.CURRENT_BINDING;
    const connector=source(implementation+'connector.cjs'),coverage=replacement?'tier-passes-v2':durable.COVERAGE;
    const sourceDigest=()=>sha(JSON.stringify(connector.sources(selected,{coverage,...(sizingStanding?{pairs:['1','2','3','4','5','6']}:{})})));
    const sourceKey=sourceDigest(),validated=new Set();
    const replacementRoot=REPLACEMENT;
    if(convergence)assert.equal(runtimeRoot,ROOT,'DEX_SERVICE_FEES_REPLACEMENT_SCOPE');
    const convergenceProof=convergence?(sizingRuntime??wideRuntime??source(CONVERGENCE+'/service-runtime.cjs'))
      .openRuntime(replacementBindingSha256):null;
    const replacementFiles=replacement&&!convergence?{bindingFile:at(replacementRoot+'/window-b/SERVICE_BINDING.json'),
      captureFile:at(replacementRoot+'/window-b/PUBLIC_CAPTURE.json'),
      packageFile:at(replacementRoot+'/native-deployment-1/package.json')}:undefined;
    const stagedDigests=()=> (convergenceProof?.proofFiles??Object.values(replacementFiles)).map(file=>read(file).sha256);
    const stagedBefore=replacement?stagedDigests():null;
    if(replacement&&!convergence&&!windows.length)source(replacementRoot+'/window-b/service-runtime.cjs').qualifyHeld(replacementBindingSha256,replacementFiles);
    if(windows.length)durable.localBuild(false,selected);
    for(const [i,directory] of windows.entries()) {
      assert.equal(path.basename(directory),'window-'+(i+1),'DEX_SERVICE_FEES_WINDOW_GAP');
      const manifestFile=path.join(directory,'bundle.json'),manifest=read(manifestFile),journal=path.join(directory,'journal.jsonl');
      // Closed historical fees do not authorize renewal on changed live source.
      const bundle=JSON.parse(manifest.bytes),{hash:bundleHash,sources:oldSources,...body}=bundle,hashed={...bundle};delete hashed.hash;
      assert.equal(bundleHash,durable.sha(JSON.stringify(hashed)),'DEX_SERVICE_FEES_C1_BUNDLE');
      const validationKey=sha(JSON.stringify([manifestFile,manifest.sha256,manifest.fileIdentity,sourceKey]));
      if(replacement){
        assert(bundle.manifest.replacementBindingSha256===replacementBindingSha256&&bundle.manifest.binding.graph===graph&&
          bundle.manifest.operator===ACTORS.c1&&bundle.manifest.policy.stream===stream,'DEX_SERVICE_FEES_REPLACEMENT_SCOPE');
        const recorded=sizingStanding&&source(REPLACEMENT+'/window-b/rehearsal-continuation.cjs')
          .recordedReceiptReaderWindow(bundle,i+1,()=>[read(journal).sha256,read(path.join(directory,'cursor.json')).sha256]);
        if(!recorded)connector.validateBundle(bundle,{replacementFiles});
        const admission=path.join(directory,'admission.json');
        assert(fs.existsSync(admission),'DEX_SERVICE_FEES_C1_INCOMPLETE');
        assert.deepEqual(JSON.parse(read(admission).bytes),source(SHARED+'/runner.cjs').heldAdmission(bundle),
          'DEX_SERVICE_FEES_C1_INCOMPLETE');
      }else if(!c1Validated.has(validationKey)){
        const current=runtime.validateOperatorBundle(runner.bundleFor(bundle.manifest,{fromBlock:bundle.discovery.fromBlock,operatorRole:bundle.operatorRole,roles:bundle.roles}));
        const {sources:currentSources,...currentBody}=current;delete currentBody.hash;
        assert.deepEqual(body,currentBody,'DEX_SERVICE_FEES_C1_SCOPE');
        assert.deepEqual(Object.keys(oldSources).sort(),Object.keys(currentSources).sort(),'DEX_SERVICE_FEES_C1_SOURCES');
        assert(Object.values(oldSources).every(value=>/^[0-9a-f]{64}$/.test(value)),'DEX_SERVICE_FEES_C1_SOURCES');
      }
      validated.add(validationKey);
      const hash=durable.sha(JSON.stringify(bundle.manifest));
      if(!fs.existsSync(journal)){
        assert(!replacement&&i===0&&windows.length===1&&!pointer&&
          fs.readdirSync(directory).every(name=>['bundle.json','admission.json'].includes(name)),'DEX_SERVICE_FEES_C1_INCOMPLETE');continue;
      }
      const captured=read(journal),parsed=durable.readJournal(journal,hash),state=parsed.state;
      assert(parsed.bytes.equals(captured.bytes),'DEX_SERVICE_FEES_FILE_CHANGED');
      const continuation=links[i-1]?.proof, successor=links[i]?.proof;
      if(continuation)assert.equal(continuation.standingInitialOperatorNonce,standingInitialOperatorNonce,
        'DEX_SERVICE_FEES_C1_CONTINUATION');
      let senderBase=continuation?.expectedOperatorNonce??standingInitialOperatorNonce;
      if(successor){
        assert.equal(successor.standingInitialOperatorNonce,standingInitialOperatorNonce,'DEX_SERVICE_FEES_C1_CONTINUATION');
        let nonce;
        if(standing&&state.baseNonce===null){
          assert(state.verified===0&&state.feesWei==='0','DEX_SERVICE_FEES_C1_CONTINUATION');
          nonce=senderBase;
        }else{
          if(standing)assert.equal(state.baseNonce,senderBase,'DEX_SERVICE_FEES_C1_CONTINUATION');
          nonce=String(uint(state.baseNonce)+BigInt(state.verified));
        }
        assert(successor.parent.manifestHash===hash&&successor.parent.journalSha256===captured.sha256&&
          successor.parent.journalTail===parsed.prev&&successor.parent.nonce===nonce&&
          successor.expectedOperatorNonce===nonce,'DEX_SERVICE_FEES_C1_CONTINUATION');
      }else if(replacement){
        assert(diskState.startedHash===hash||(diskState.startedHash===null&&!fs.existsSync(diskState.cursor)&&
          captured.bytes.equals(durable.replacementGenesis(bundle.manifest))),'DEX_SERVICE_FEES_C1_INCOMPLETE');
      }
      if(continuation)assert(continuation.cumulativeCommitmentWei===String(BigInt(i+1)*uint(bundle.manifest.policy.totalWei)),
        'DEX_SERVICE_FEES_C1_CONTINUATION');
      const expectedHalt=c1Halt!==undefined&&i===windows.length-1;
      // CW-137: a held margin Commit (C1_COMMIT_UNBROADCAST) is recovered by the same projection as a refused Quote.
      const cutoff=standing&&!ownerExit&&!expectedHalt&&(state.halt===DISPATCH_UNBROADCAST||state.halt===COMMIT_UNBROADCAST)&&
        source(REPLACEMENT+'/window-b/rehearsal-continuation.cjs').cutoffQuote(bundle,parsed);
      const halts=[cutoff?null:state.halt,state.policy.halt].filter(Boolean);
      matchedHalt=expectedHalt&&halts.length>0&&halts.every(reason=>reason===c1Halt);
      assert(!state.send&&!state.policy.inflight&&(expectedHalt?matchedHalt:halts.length===0),'DEX_SERVICE_FEES_UNRESOLVED');
      if(idleOwnerExit){
        assert(!state.policy.active&&!state.rollover&&!state.policy.disabled&&
          Object.keys(state.policy.coverage?.parked??{}).length===0&&Object.keys(state.quotes??{}).length===0&&
          Number.isSafeInteger(state.verified)&&state.verified>=0,'DEX_SERVICE_FEES_C1_IDLE_EXIT_WINDOW');
        replacementState.checkSenderLock(bundle.senderLock);
        if(idleSenderLock)assert.deepEqual(bundle.senderLock,idleSenderLock,'DEX_SERVICE_FEES_C1_IDLE_EXIT_WINDOW');
        idleSenderLock=bundle.senderLock;
      }
      let prior=null;
      const confirmedQuotes=ownerExit?new Map():null;
      for(const row of captured.bytes.toString().trimEnd().split('\n').map(JSON.parse)) {
        const fee=uint(row.state.feesWei);assert(fee<=BigInt(bundle.manifest.policy.totalWei),'DEX_SERVICE_FEES_C1_BOUND');
        if(row.kind==='broadcast'&&typeof row.state.send?.hash==='string')broadcasts.add(row.state.send.hash.toLowerCase());
        const abortKind=row.state.halt===COMMIT_UNBROADCAST?'commit':
          row.state.halt==='C1_EARLY_EXPIRY_UNBROADCAST'?'expiry':
          row.state.halt===DISPATCH_UNBROADCAST?'dispatch':null;
        const abort=abortKind!==null&&prior?.halt!==row.state.halt;
        if(replacement){
          const previous=prior?.send,send=row.state.send,guard='DEX_SERVICE_FEES_C1_TRANSITION';
          if(previous&&!send)assert(row.kind==='confirmed'||abort,guard);
          if(send){
            if(ownerExit){
              uint(send.beforeBalance);
              assert(/^0x[0-9a-f]{64}$/i.test(send.beforeHead),'DEX_SERVICE_FEES_C1_EXIT_WINDOW');
              if(previous)assert(send.beforeBalance===previous.beforeBalance&&send.beforeHead===previous.beforeHead,
                'DEX_SERVICE_FEES_C1_EXIT_WINDOW');
            }
            if(!previous)assert(send.phase==='prepared'&&row.kind==='prepared',guard);
            else{
              assert(send.phase===previous.phase||send.phase===nextSendPhase[previous.phase]&&row.kind===send.phase,guard);
              assert(!previous.hash||send.hash===previous.hash,guard);
              assert.deepEqual(send.envelope,previous.envelope,guard);
              assert.deepEqual(send.action,previous.action,guard);
            }
          }
          if(prior?.halt||prior?.policy.halt)assert(row.state.halt===prior.halt&&row.state.policy.halt===prior.policy.halt&&
            !send&&!row.state.policy.inflight,guard);
          if(row.state.unbroadcastDispatch!==undefined)assert(row.state.halt===DISPATCH_UNBROADCAST,guard);
          if(prior?.halt===DISPATCH_UNBROADCAST)assert.deepEqual(row.state.unbroadcastDispatch,prior.unbroadcastDispatch,guard);
        }
        if(abort||row.kind==='halt'&&prior?.send&&!row.state.send){
          const expiry=abortKind==='expiry',dispatch=abortKind==='dispatch',send=prior?.send;
          const proof=dispatch?row.state.unbroadcastDispatch:expiry?row.state.unbroadcastExpiry:row.state.unbroadcastCommit;
          const guard='DEX_SERVICE_FEES_UNBROADCAST';
          assert(abort&&row.kind==='halt'&&send?.phase==='signed'&&
            /^0x[0-9a-f]{64}$/i.test(send.hash)&&!broadcasts.has(send.hash.toLowerCase())&&!transactions.has(send.hash.toLowerCase())&&
            prior.policy.inflight?.txHash===send.hash&&proof?.hash===send.hash&&!row.state.send&&!row.state.policy.inflight,guard);
          if(dispatch){
            assert(replacement,guard);
            replacementFeeCap(durable,bundle.manifest,send);
            assert.deepEqual(proof,{hash:send.hash,check:'pre-transport'},guard);
            assert.deepEqual(row.state,{...prior,send:null,policy:{...prior.policy,inflight:null},halt:DISPATCH_UNBROADCAST,
              unbroadcastDispatch:proof},guard);
          }else{
            assert(send.action?.action===(expiry?6:2)&&(expiry?['identity','deadline','proof','head']:['identity','margin','fit']).includes(proof.check)&&
              /^0x[0-9a-f]{64}$/i.test(proof.headHash)&&Number.isSafeInteger(proof.time),guard);
            if(expiry)assertEarlyExpiryAbort(bundle.manifest,send,durable);
            else if(proof.check==='fit')assertCommitFitAbort(bundle.manifest,send,proof,durable);
          }
          if(ownerExit&&abortKind==='commit'){
            replacementState.checkSenderLock(bundle.senderLock);
            ownerExitWindow={window:i+1,bundle:bundleHash,manifestHash:hash,journal,journalDigest:parsed.prev,
              journalSha256:captured.sha256,replacementBindingSha256,halt:c1Halt,senderLock:bundle.senderLock,
              ...fitExitEvidence(durable,bundle.manifest,prior,state,proof,confirmedQuotes.get(send.action.pair))};
          }
        }
        if(!prior)assert(fee===0n&&row.state.verified===0&&(!replacement||(!row.state.send&&!row.state.policy.inflight)),
          'DEX_SERVICE_FEES_C1_INITIAL');
        else if(row.kind==='confirmed') {
          const gasPrice=BigInt(replacement?bundle.manifest.feeCeilingWei:runtime.FEE);
          const increase=fee-uint(prior.feesWei);assert(increase>0n&&increase%gasPrice===0n&&prior.send?.hash&&!transactions.has(prior.send.hash.toLowerCase()),'DEX_SERVICE_FEES_C1_CONFIRMATION');
          const cap=replacement?replacementFeeCap(durable,bundle.manifest,prior.send):BigInt(prior.send.action.maxWei);
          assert(increase<=cap&&row.state.verified===prior.verified+1,'DEX_SERVICE_FEES_C1_CONFIRMATION');transactions.add(prior.send.hash.toLowerCase());
          if(links.length||idleOwnerExit||standing){
            senderBase??=prior.send.envelope.nonce;
            assert(row.state.baseNonce===senderBase&&uint(prior.send.envelope.nonce)===uint(senderBase)+BigInt(prior.verified),
              'DEX_SERVICE_FEES_C1_CONTINUATION');
          }
          if(idleOwnerExit){
            const {envelope,hash,action}=prior.send;
            idleReceipts.push({hash,nonce:envelope.nonce,pair:action.pair,action:action.action,
              to:envelope.to,calldataSha256:sha(envelope.data.toLowerCase()),gasLimit:envelope.gasLimit,
              gasPriceWei:envelope.gasPrice,gasUsed:String(increase/gasPrice)});
          }
          if(confirmedQuotes){
            const {pair,action}=prior.send.action,block=row.state.quotes?.[pair];
            if(action===1)confirmedQuotes.set(pair,{send:prior.send,active:row.state.policy.active,gasUsed:String(increase/gasPrice),
              block,previousBlock:prior.quotes?.[pair]});
            else if(!block)confirmedQuotes.delete(pair);
          }
        } else assert(fee===uint(prior.feesWei)&&row.state.verified===prior.verified,'DEX_SERVICE_FEES_C1_FEE_CHANGE');
        prior=row.state;
      }
      if((links.length||idleOwnerExit)&&state.verified>0)assert(state.baseNonce===senderBase,'DEX_SERVICE_FEES_C1_CONTINUATION');
      if(idleOwnerExit||ownerExit){
        idleWindows.push({window:i+1,bundle:bundleHash,manifestHash:hash,journal,journalDigest:parsed.prev,
          journalSha256:captured.sha256,verified:state.verified,feeWei:state.feesWei});
      }
      record(journal,manifestFile,hash,uint(state.feesWei),captured,manifest);last={journal,hash};
    }
    if(last||pointer)assert(last&&pointer&&pointer.version===1&&pointer.stream===stream&&pointer.journal===last.journal&&pointer.manifestHash===last.hash,'DEX_SERVICE_FEES_C1_POINTER');
    assert(c1Halt===undefined||matchedHalt,'DEX_SERVICE_FEES_UNRESOLVED');
    if(ownerExit)assert(ownerExitWindow,'DEX_SERVICE_FEES_C1_EXIT_WINDOW');
    if(idleOwnerExit){
      assert(idleWindows.length===windows.length&&idleReceipts.length>0,'DEX_SERVICE_FEES_C1_IDLE_EXIT_WINDOW');
      const startOperatorNonce=idleReceipts[0].nonce;
      assert(idleReceipts.every((receipt,i)=>uint(receipt.nonce)===uint(startOperatorNonce)+BigInt(i)),
        'DEX_SERVICE_FEES_C1_IDLE_EXIT_WINDOW');
      idleExitWindow={...idleWindows.at(-1),replacementBindingSha256,senderLock:idleSenderLock,startOperatorNonce,
        finalOperatorNonce:String(uint(startOperatorNonce)+BigInt(idleReceipts.length)),windows:idleWindows,
        receipts:idleReceipts,readyToSign:false};
    }
    assert.equal(sourceDigest(),sourceKey,'DEX_SERVICE_FEES_SOURCE_CHANGED');
    if(replacement){
      assert.deepEqual(replacementState.checkPaths(statePaths),diskState,'DEX_SERVICE_FEES_C1_INCOMPLETE');
      for(const {file,captured} of links)assert.deepEqual(read(file),captured,'DEX_SERVICE_FEES_C1_HISTORY');
      assert.deepEqual(stagedDigests(),stagedBefore,'DEX_SERVICE_FEES_SOURCE_CHANGED');
      assert.deepEqual(readPointer(),pointerBefore,'DEX_SERVICE_FEES_C1_POINTER');
      assert.deepEqual(directories(base,windowName),windows,'DEX_SERVICE_FEES_C1_HISTORY');
    }else c1Validated=validated;
  }
  try { ({keeper,prices,matching,c1})[service](); }
  catch(error) {
    if(replacement)throw Error(errorCode(error));
    throw Error(/^DEX_SERVICE_FEES_[A-Z_]+$/.test(error.message)?error.message:'DEX_SERVICE_FEES_RECORD_REJECTED');
  }
  journals.sort((a,b)=>a.path.localeCompare(b.path));
  return {schema:'CURRENT_DEX_SERVICE_FEES_V1',runtimeRoot,service,graph,chainId:'7082400',actor,
    ...(replacement?{replacementBindingSha256}:{}),...(ownerExit?{ownerExitWindow,ownerExitWindows:idleWindows}:{}),...(idleOwnerExit?{idleExitWindow}:{}),
    ...(standing?{standingInitialOperatorNonce}:{}),
    feeWei:String(journals.reduce((sum,row)=>sum+uint(row.feeWei),0n)),journals};
}
function delta(before,after) {
  for(const key of ['schema','runtimeRoot','service','graph','chainId','actor','replacementBindingSha256','standingInitialOperatorNonce'])assert.equal(after[key],before[key],'DEX_SERVICE_FEES_IDENTITY');
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
  return /^DEX_SERVICE_FEES_[A-Z0-9_]+$/.test(code)?code:'DEX_SERVICE_FEES_RECORD_REJECTED';
}
function accountingAsync(operation,args) {
  return new Promise((resolve,reject)=>{
    const c1=operation==='snapshot'&&args[0]==='c1';
    const binding=operation==='snapshot'?args[1]?.replacementBindingSha256:undefined;
    const replacement=binding!==undefined;
    const env=replacement?{...process.env}:undefined;
    // The explicit replacement binding selects its graph inside this read-only worker.
    if(env){
      for(const key of Object.values(widePeerBindingEnv))delete env[key];
      if(c1||binding===WIDE_FIRST_BINDING||binding===build13PeerBinding)delete env.CW_LOW_RPC_TRIAL;
      else env.CW_LOW_RPC_TRIAL=REPLACEMENT_GRAPH;
      if((binding===WIDE_FIRST_BINDING||binding===build13PeerBinding)&&Object.hasOwn(widePeerBindingEnv,args[0]))
        env[widePeerBindingEnv[args[0]]]=binding;
    }
    const data={operation,args,...(c1&&!replacement?{c1Validated:[...c1Validated]}:{})};
    let worker;
    try{worker=new Worker(__filename,{workerData:data,env,stdout:true,stderr:true});}
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
    parentPort.postMessage({value,...(workerData.c1Validated?{c1Validated:[...c1Validated]}:{})});
  }catch(error){parentPort.postMessage({error:errorCode(error)});}
}
module.exports={snapshot,delta,snapshotAsync,deltaAsync,assertEarlyExpiryAbort,assertCommitFitAbort,widePeerBindingEnv,
  build13Graph,build13PeerBinding,build13StandingBinding,build13PriceAdmission};
