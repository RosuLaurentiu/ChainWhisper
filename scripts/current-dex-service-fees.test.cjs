'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
process.env.CW_LOW_RPC_TRIAL ??= '9c2cb36f958dc21ef11bf7d91ebf0373904a3d741edd6bf9eeae25752960631e';
const fees = require('./current-dex-service-fees.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(__dirname, '.fee-test-'));
  t.after(() => { assert(path.resolve(directory).startsWith(path.resolve(__dirname) + path.sep)); fs.rmSync(directory, { recursive: true, force: true }); });
  return directory;
}
function fixture(t) {
  const root = temporary(t), file = path.join(root, 'journal.jsonl');
  fs.writeFileSync(file, 'first\n');
  function view(feeWei) {
    const bytes = fs.readFileSync(file), s = fs.lstatSync(file, { bigint: true });
    return {schema:'CURRENT_DEX_SERVICE_FEES_V1',runtimeRoot:root,service:'keeper',graph:process.env.CW_LOW_RPC_TRIAL,chainId:'7082400',actor:'0x23abde1d22019d52852d6845c9444326dde1d99e',feeWei,
      journals:[{path:'journal.jsonl',manifestHash:'a'.repeat(64),manifestSha256:'b'.repeat(64),length:bytes.length,sha256:sha(bytes),fileIdentity:{dev:String(s.dev),ino:String(s.ino),birthtimeNs:String(s.birthtimeNs)},feeWei}]};
  }
  return {root,file,view};
}
function keeperFixture(t) {
  const root=temporary(t),base=path.resolve(__dirname,'../../ChainWhisper Contracts V2/validation/candidates'),normal=require(path.join(base,'limit-fill-history-shared-receipt-2026-10-13/app-async-service/runtime/service.cjs'));
  const binding=require(path.join(base,'limit-fill-history-shared-receipt-2026-10-13/app-async-service/public-binding.cjs')).loadPublicBinding();
  const actor='0x23abde1d22019d52852d6845c9444326dde1d99e',hash='0x'+'11'.repeat(32),block='0x'+'22'.repeat(32),operatorRoot=path.join(root,'ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/app-async-service/app-host-'+process.env.CW_LOW_RPC_TRIAL.slice(0,8)+'-'+actor.slice(2));
  const m={schema:'CURRENT_SHARED_HISTORY_NORMAL_KEEPER_V1',sources:{fixture:'a'.repeat(64)},identity:binding.identity,chain:'7082400',genesis:binding.genesis,endpoint:'https://testnet.coti.io/rpc',config:{principal:binding.pkg.actor,operator:actor,operatorRole:'operator'},tokens:binding.pkg.tokenAddresses.slice(0,2),operationId:'1',quoteHash:hash,operatorNonce:'0',startBlock:{number:'1',hash:block},observedAt:'2026-11-08T00:00:00.000Z',expiresAt:'2026-11-08T00:15:00.000Z',maximumCalls:5,maximumCommittedWei:String(normal.COMMIT),connectedAppWalletHeld:true,noQuoteAcceptAuthority:true,recovery:{reserveWei:String(normal.RESERVE),method:'cancelSwap',authority:binding.pkg.actor}};
  m.hash=sha(JSON.stringify(m));
  const directory=path.join(operatorRoot,'1-'+hash.slice(2)),manifest=path.join(directory,'manifest.json'),journal=path.join(directory,'journal.jsonl');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(manifest,JSON.stringify(m));
  fs.writeFileSync(path.join(operatorRoot,'HOST.json'),JSON.stringify({schema:'CURRENT_SHARED_HISTORY_APP_HOST_V1',chain:'7082400',genesis:binding.genesis,core:binding.identity.core,operator:actor,startBlock:m.startBlock,cursor:m.startBlock,sourceDigest:'a'.repeat(64),operations:[{nomination:{operationId:'1',quoteHash:hash},finished:false}]}));
  const rows=[{kind:'nominated',operationId:'1',quoteHash:hash,manifestHash:m.hash}];
  function append(stage,gas,ending='verified',transaction='0x'+String(stage+2).repeat(64)) {
    const start={kind:'signing-start',manifestHash:m.hash,operationId:'1',stage,nonce:String(stage-1),gasLimit:String(normal.CAP),gasPriceWei:String(normal.FEE),beforeBalanceWei:'1000000000000000000',head:{},context:block,deadline:'1',fit:{}};
    rows.push(start);if(ending!=='hashless'){rows.push({...start,kind:'signed',hash:transaction});if(ending!=='pending')rows.push({kind:ending,manifestHash:m.hash,operationId:'1',stage,hash:transaction,canonical:true,publicStageVerified:true,noRetry:true,gasUsed:String(gas),blockHash:block});}
    fs.writeFileSync(journal,rows.map(JSON.stringify).join('\n')+'\n');
  }
  append(1,7);return{root,normal,manifest,journal,append,operatorRoot,binding,fee:String(normal.FEE)};
}

function currentC1Fixture(t){
 const root=temporary(t),shared='ChainWhisper Contracts V2/validation/candidates/c1-shared-integration-2026-10-05',base=path.resolve(__dirname,'../../'+shared);
 const runtime=require(path.resolve(base,'../limit-fill-history-shared-receipt-2026-10-13/c1-service/runtime.cjs')),runner=require(path.join(base,'runner.cjs'));
 const m=require(path.resolve(base,'../limit-fill-history-shared-receipt-2026-10-13/c1-service/runtime-fixture.cjs')).currentManifest();
 const bundle=runner.bundleFor(m,{fromBlock:100,operatorRole:'carol',roles:{carol:{address:runtime.OPERATOR}}});
 const directory=path.join(root,shared,'current-c1-operator-'+process.env.CW_LOW_RPC_TRIAL.slice(0,8),'window-1');fs.mkdirSync(directory,{recursive:true});
 const manifest=path.join(directory,'bundle.json'),journal=path.join(directory,'journal.jsonl'),manifestHash=sha(JSON.stringify(m));fs.writeFileSync(manifest,JSON.stringify(bundle));
 const state={feesWei:'0',verified:0,send:null,halt:null,policy:{halt:null,inflight:null}};
 const write=()=>{const row={version:1,seq:0,previous:'0'.repeat(64),manifestHash,kind:'start',state};fs.writeFileSync(journal,JSON.stringify({...row,digest:sha(JSON.stringify(row))})+'\n');};write();
 fs.writeFileSync(path.join(root,shared,'durable-adapter-check-stream-'+sha(m.policy.stream)+'.json'),JSON.stringify({version:1,stream:m.policy.stream,journal,manifestHash}));
 return{root,runner,manifest,journal,state,write,bundle};
}

test('C1 reuses only unchanged validated bundles and still rejects pending journals, replacement and scope changes',t=>{
 const f=currentC1Fixture(t),build=f.runner.bundleFor;let calls=0;t.mock.method(f.runner,'bundleFor',(...args)=>{calls++;return build(...args);});
 const before=fees.snapshot('c1',{runtimeRoot:f.root});assert.equal(calls,1);
 assert.deepEqual(fees.snapshot('c1',{runtimeRoot:f.root}),before);assert.equal(calls,1);
 f.state.send={hash:null};f.write();assert.throws(()=>fees.snapshot('c1',{runtimeRoot:f.root}),/DEX_SERVICE_FEES_UNRESOLVED/);assert.equal(calls,1);
 f.state.send=null;f.write();
 fs.renameSync(f.manifest,f.manifest+'.old');fs.writeFileSync(f.manifest,JSON.stringify(f.bundle));fees.snapshot('c1',{runtimeRoot:f.root});assert.equal(calls,2);
 const changed={...f.bundle,operatorRole:'bob'};delete changed.hash;changed.hash=sha(JSON.stringify(changed));fs.writeFileSync(f.manifest,JSON.stringify(changed));
 assert.throws(()=>fees.snapshot('c1',{runtimeRoot:f.root}),/DEX_SERVICE_FEES_RECORD_REJECTED/);assert.equal(calls,3);
});

test('C1 bundle reuse revalidates and stops when current source pins no longer match',t=>{
 const f=currentC1Fixture(t),build=f.runner.bundleFor,connector=require('../../ChainWhisper Contracts V2/validation/candidates/c1-shared-integration-2026-10-05/connector.cjs'),sources=connector.sources;let calls=0;
 t.mock.method(f.runner,'bundleFor',(...args)=>{calls++;return build(...args);});
 fees.snapshot('c1',{runtimeRoot:f.root});assert.equal(calls,1);
 t.mock.method(connector,'sources',(...args)=>({...sources(...args),'runner.cjs':'22'.repeat(32)}));
 assert.throws(()=>fees.snapshot('c1',{runtimeRoot:f.root}),/DEX_SERVICE_FEES_RECORD_REJECTED/);assert.equal(calls,2);
});

test('C1 async reuse leaves the public result unchanged and rechecks modified journal content',async t=>{
 const f=currentC1Fixture(t),before=await fees.snapshotAsync('c1',{runtimeRoot:f.root});
 assert.deepEqual(await fees.snapshotAsync('c1',{runtimeRoot:f.root}),before);assert(!Object.hasOwn(before,'c1Validated'));
 f.state.send={hash:'0x'+'11'.repeat(32)};f.write();await assert.rejects(fees.snapshotAsync('c1',{runtimeRoot:f.root}),/DEX_SERVICE_FEES_UNRESOLVED/);
});
test('async accounting preserves public snapshot and delta results while timers run', async t => {
  const f=keeperFixture(t),expected=fees.snapshot('keeper',{runtimeRoot:f.root});
  let ticks=0;const timer=setInterval(()=>ticks++,1);
  let before;
  try{before=await fees.snapshotAsync('keeper',{runtimeRoot:f.root});}finally{clearInterval(timer);}
  assert(ticks>0,'accounting worker must leave the parent event loop responsive');
  assert.deepEqual(before,expected);
  assert(!JSON.stringify(before).includes('beforeBalanceWei'));assert(!JSON.stringify(before).includes('nominated'));
  f.append(2,3);
  const after=await fees.snapshotAsync('keeper',{runtimeRoot:f.root});
  assert.equal(await fees.deltaAsync(before,after),fees.delta(before,after));
});

test('async accounting rejects pending and hashless sends without exposing records', async t => {
  for(const ending of ['pending','hashless']) {
    const f=keeperFixture(t);f.append(2,3,ending);
    assert.throws(()=>fees.snapshot('keeper',{runtimeRoot:f.root}),/DEX_SERVICE_FEES_UNRESOLVED/);
    await assert.rejects(fees.snapshotAsync('keeper',{runtimeRoot:f.root}),error=>{
      assert.equal(error.message,'DEX_SERVICE_FEES_UNRESOLVED');
      assert(!error.stack.includes('beforeBalanceWei'));assert(!Object.hasOwn(error,'actual'));return true;
    });
  }
  await assert.rejects(fees.snapshotAsync('private-untrusted-input'),/^Error: DEX_SERVICE_FEES_SERVICE$/);
});

test('async delta retains exact prefix and fee validation and sanitizes unknown errors', async t => {
  const f=fixture(t),before=f.view('7');fs.appendFileSync(f.file,'second\n');const after=f.view('12');
  assert.equal(await fees.deltaAsync(before,after),'5');
  fs.writeFileSync(f.file,'other\nsecond\n');
  await assert.rejects(fees.deltaAsync(before,f.view('12')),/^Error: DEX_SERVICE_FEES_PREFIX_CHANGED$/);
  await assert.rejects(fees.deltaAsync(before,{...after,feeWei:'private-untrusted-input'}),/^Error: DEX_SERVICE_FEES_TOTAL$/);
  await assert.rejects(fees.deltaAsync(null,{private:'private-untrusted-input'}),/^Error: DEX_SERVICE_FEES_RECORD_REJECTED$/);
});
function unstartedFixture(t,stage=8) {
  const f=keeperFixture(t),hostFile=path.join(f.operatorRoot,'HOST.json'),host=JSON.parse(fs.readFileSync(hostFile)),n=host.operations[0].nomination;
  Object.assign(n,{schema:'CURRENT_DEX_APP_QUOTE_NOMINATION_V1',identity:{graph:f.binding.identity.graph,packageSha256:f.binding.identity.package,core:f.binding.identity.core.toLowerCase(),chainId:f.binding.pkg.chainId,genesisHash:f.binding.genesis,releaseId:f.binding.pkg.release},principal:f.binding.pkg.actor.toLowerCase(),destination:f.binding.pkg.actor.toLowerCase(),inputToken:f.binding.pkg.tokenAddresses[0].toLowerCase(),outputToken:f.binding.pkg.tokenAddresses[1].toLowerCase(),origin:host.startBlock,deadline:'2000',toleranceBps:50});
  const proof={schema:'CURRENT_KEEPER_UNSTARTED_RETIREMENT_V1',nominationSha256:sha(JSON.stringify(n)),head:{number:'2',hash:'0x'+'33'.repeat(32),timestamp:'1940'},stage,deadline:n.deadline,reason:[7,8].includes(stage)?'public-terminal':'scheduling-cutoff'};
  proof.recordSha256=sha(JSON.stringify(proof));host.operations[0].finished=true;host.operations[0].unstartedRetirement=proof;
  const manifestBytes=fs.readFileSync(f.manifest),journalBytes=fs.readFileSync(f.journal);fs.rmSync(path.dirname(f.manifest),{recursive:true});
  const save=()=>fs.writeFileSync(hostFile,JSON.stringify(host));save();return{...f,host,proof,save,manifestBytes,journalBytes};
}
test('keeper accepts typed no-directory scheduling retirement for both public reasons',t=>{
  for(const stage of [7,8,1,2,3,4,5]) {
    const f=unstartedFixture(t,stage),view=fees.snapshot('keeper',{runtimeRoot:f.root});
    assert.equal(view.feeWei,'0');assert.equal(view.journals.length,0);
  }
});
test('keeper holds missing, damaged or mismatched no-directory retirement proof',t=>{
  for(const damage of ['missing','digest','nomination','stage6','reason','deadline','head','extra','unfinished','signed-retirement','nomination-fields']) {
    const f=unstartedFixture(t),row=f.host.operations[0],p=f.proof;
    if(damage==='missing')delete row.unstartedRetirement;
    if(damage==='nomination')row.nomination.toleranceBps++;
    if(damage==='stage6'){p.stage=6;p.reason='scheduling-cutoff';}
    if(damage==='reason')p.reason='scheduling-cutoff';
    if(damage==='deadline')p.deadline='2001';
    if(damage==='head')p.head.number='0';
    if(damage==='extra')p.privateDelivery=true;
    if(damage==='unfinished')row.finished=false;
    if(damage==='signed-retirement')row.retirement={};
    if(damage==='nomination-fields'){delete row.nomination.destination;p.nominationSha256=sha(JSON.stringify(row.nomination));}
    p.recordSha256=sha(JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k])=>k!=='recordSha256'))));
    if(damage==='digest')p.recordSha256='0'.repeat(64);
    f.save();assert.throws(()=>fees.snapshot('keeper',{runtimeRoot:f.root}),damage);
  }
});
test('unstarted retirement proof cannot bypass an existing journal or its unresolved sends',t=>{
  const f=unstartedFixture(t);fs.mkdirSync(path.dirname(f.manifest));fs.writeFileSync(f.manifest,f.manifestBytes);fs.writeFileSync(f.journal,f.journalBytes);
  assert.equal(fees.snapshot('keeper',{runtimeRoot:f.root}).feeWei,String(7n*BigInt(f.fee)));
  f.append(2,3,'pending');assert.throws(()=>fees.snapshot('keeper',{runtimeRoot:f.root}),/DEX_SERVICE_FEES_UNRESOLVED/);
});
test('unstarted retirement proof cannot treat a dangling directory link as absent',t=>{
  const f=unstartedFixture(t),directory=path.dirname(f.manifest);
  const missing=path.join(f.operatorRoot,'missing');fs.mkdirSync(missing);let cleanup;
  try{fs.symlinkSync(missing,directory,'junction');cleanup=()=>fs.unlinkSync(directory);}
  catch(error){
    if(process.platform!=='win32'||error.code!=='EPERM')throw error;
    t.diagnostic('Windows denied junction creation; model only the dangling lstat entry.');
    const original=fs.lstatSync,mocked=t.mock.method(fs,'lstatSync',(file,...args)=>file===directory?{isSymbolicLink:()=>true,isDirectory:()=>false}:original(file,...args));cleanup=()=>mocked.mock.restore();
  }finally{fs.rmdirSync(missing);}
  try{assert(!fs.existsSync(directory));assert.throws(()=>fees.snapshot('keeper',{runtimeRoot:f.root}));}finally{cleanup();}
});
test('delta counts exact fees and validates the saved prefix after an append', t => {
  const f=fixture(t), before=f.view('7');fs.appendFileSync(f.file,'second\n');
  assert.equal(fees.delta(before,f.view('12')),'5');
});
test('delta rejects removed, replaced, truncated or rewritten prior journals', t => {
  for(const damage of ['removed','replaced','truncated','rewritten']) {
    const f=fixture(t),before=f.view('7');
    if(damage==='removed'){const after={...before,journals:[],feeWei:'0'};assert.throws(()=>fees.delta(before,after));continue;}
    if(damage==='replaced'){const other=f.file+'.replacement';fs.writeFileSync(other,'first\nsecond\n');fs.unlinkSync(f.file);fs.renameSync(other,f.file);}
    if(damage==='truncated')fs.writeFileSync(f.file,'x\n');
    if(damage==='rewritten')fs.writeFileSync(f.file,'other\nsecond\n');
    assert.throws(()=>fees.delta(before,f.view('12')));
  }
});
test('delta rejects fee decreases, inexact totals, identity changes and changed manifests', t => {
  const f=fixture(t),before=f.view('7');
  for(const change of [{feeWei:'6',journals:[{...before.journals[0],feeWei:'6'}]},{feeWei:'8'},{feeWei:'8',journals:[{...before.journals[0],feeWei:'8'}]},{actor:'0x'+'11'.repeat(20)},{journals:[{...before.journals[0],manifestHash:'c'.repeat(64)}]}])
    assert.throws(()=>fees.delta(before,{...before,...change}));
});
test('fresh isolated state is zero for each service, but an empty keeper host is contradictory', t => {
  const root=temporary(t);
  for(const service of ['keeper','prices','matching','c1'])assert.equal(fees.snapshot(service,{runtimeRoot:root}).feeWei,'0');
  fs.mkdirSync(path.join(root,'ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/app-async-service/app-host-'+process.env.CW_LOW_RPC_TRIAL.slice(0,8)+'-23abde1d22019d52852d6845c9444326dde1d99e'),{recursive:true});
  assert.throws(()=>fees.snapshot('keeper',{runtimeRoot:root}));
});
test('keeper snapshot uses supported session accounting and returns no raw records', t => {
  const f=keeperFixture(t),before=fees.snapshot('keeper',{runtimeRoot:f.root});
  assert.equal(before.feeWei,String(7n*BigInt(f.fee)));assert.equal(before.journals.length,1);
  assert(!JSON.stringify(before).includes('beforeBalanceWei'));assert(!JSON.stringify(before).includes('nominated'));
  f.append(2,3);assert.equal(fees.delta(before,fees.snapshot('keeper',{runtimeRoot:f.root})),String(3n*BigInt(f.fee)));
});
test('keeper rejects hashless, pending, failed and duplicate receipts', t => {
  for(const ending of ['hashless','pending','failed','duplicate']) {
    const f=keeperFixture(t);f.append(2,3,ending==='duplicate'?'verified':ending,ending==='duplicate'?'0x'+'3'.repeat(64):undefined);
    assert.throws(()=>fees.snapshot('keeper',{runtimeRoot:f.root}));
  }
});
test('snapshot rejects a manifest replacement after validation', t => {
  const f=keeperFixture(t),validate=f.normal.validateManifest;
  t.mock.method(f.normal,'validateManifest',(...args)=>{const result=validate(...args);fs.writeFileSync(f.manifest,'{}');return result;});
  assert.throws(()=>fees.snapshot('keeper',{runtimeRoot:f.root}));
});
test('C1 counts prior expiry and renewal windows and rejects a lost current journal', t => {
  const root=temporary(t),base=path.resolve(__dirname,'../../ChainWhisper Contracts V2/validation/candidates'),shared='ChainWhisper Contracts V2/validation/candidates/c1-shared-integration-2026-10-05';
  const saved=JSON.parse(fs.readFileSync(path.join(base,'c1-shared-integration-2026-10-05/current-c1-operator-cc7eb662/window-1/bundle.json'))),runtime=require(path.join(base,'limit-fill-history-shared-receipt-2026-10-13/c1-service/runtime.cjs')),runner=require(path.join(base,'c1-shared-integration-2026-10-05/runner.cjs'));
  const bundle=runner.bundleFor(saved.manifest,{fromBlock:saved.discovery.fromBlock,operatorRole:saved.operatorRole,roles:saved.roles});
  runtime.validateOperatorBundle(bundle);const hash=sha(JSON.stringify(bundle.manifest)),unit=BigInt(runtime.FEE);let last;
  bundle.sources['operator/runtime']='00'.repeat(32);delete bundle.hash;bundle.hash=sha(JSON.stringify(bundle));
  for(const [index,gas]of [13n,17n].entries()) {
    const directory=path.join(root,shared,'current-c1-operator-cc7eb662/window-'+(index+1));fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'bundle.json'),JSON.stringify(bundle));
    const initial={feesWei:'0',verified:0,send:null,halt:null,policy:{halt:null,inflight:null}},signed={...initial,send:{hash:'0x'+String(index+3).repeat(64),action:{action:6,maxWei:String(100n*unit)}}},confirmed={...initial,feesWei:String(gas*unit),verified:1};
    let previous='0'.repeat(64);const rows=[['start',initial],['signed',signed],['confirmed',confirmed]].map(([kind,state],seq)=>{const row={version:1,seq,previous,manifestHash:hash,kind,state};row.digest=sha(JSON.stringify(row));previous=row.digest;return row;});
    last=path.join(directory,'journal.jsonl');fs.writeFileSync(last,rows.map(JSON.stringify).join('\n')+'\n');
  }
  const stream='7082400:0xddbfe89f9decad1b99406be4af8bb613065144be:'+process.env.CW_LOW_RPC_TRIAL,pointer=path.join(root,shared,'durable-adapter-check-stream-'+sha(stream)+'.json');
  fs.writeFileSync(pointer,JSON.stringify({version:1,stream,journal:last,manifestHash:hash}));
  const view=fees.snapshot('c1',{runtimeRoot:root});assert.equal(view.journals.length,2);assert.equal(view.feeWei,String(30n*unit));
  fs.unlinkSync(last);assert.throws(()=>fees.snapshot('c1',{runtimeRoot:root}));
  fs.rmSync(path.dirname(path.dirname(last)),{recursive:true});assert.throws(()=>fees.snapshot('c1',{runtimeRoot:root}));
});
test('C1 unbroadcast retirement keeps prior fees and charges no unconfirmed intent',t=>{
 const root=temporary(t),base=path.resolve(__dirname,'../../ChainWhisper Contracts V2/validation/candidates'),shared='ChainWhisper Contracts V2/validation/candidates/c1-shared-integration-2026-10-05';
 const runtime=require(path.join(base,'limit-fill-history-shared-receipt-2026-10-13/c1-service/runtime.cjs')),runner=require(path.join(base,'c1-shared-integration-2026-10-05/runner.cjs'));
 const saved=JSON.parse(fs.readFileSync(path.join(base,'c1-shared-integration-2026-10-05/current-c1-operator-cc7eb662/window-1/bundle.json'))),bundle=runner.bundleFor(saved.manifest,{fromBlock:saved.discovery.fromBlock,operatorRole:saved.operatorRole,roles:saved.roles});runtime.validateOperatorBundle(bundle);
 const directory=path.join(root,shared,'current-c1-operator-cc7eb662/window-1');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'bundle.json'),JSON.stringify(bundle));
 const journal=path.join(directory,'journal.jsonl'),manifestHash=sha(JSON.stringify(bundle.manifest)),initial={feesWei:'0',verified:0,send:null,halt:null,policy:{halt:null,inflight:null}},send={hash:'0x'+'4'.repeat(64),action:{maxWei:String(100n*BigInt(runtime.FEE))}},confirmed={...initial,feesWei:runtime.FEE,verified:1};
 let previous='0'.repeat(64),seq=0;const append=(kind,state)=>{const row={version:1,seq:seq++,previous,manifestHash,kind,state};row.digest=sha(JSON.stringify(row));previous=row.digest;fs.appendFileSync(journal,JSON.stringify(row)+'\n');};
 append('start',initial);append('signed',{...initial,send});append('confirmed',confirmed);const baselineBytes=fs.readFileSync(journal);
 const stream='7082400:'+runtime.OPERATOR+':'+process.env.CW_LOW_RPC_TRIAL;fs.writeFileSync(path.join(root,shared,'durable-adapter-check-stream-'+sha(stream)+'.json'),JSON.stringify({version:1,stream,journal,manifestHash}));
 const before=fees.snapshot('c1',{runtimeRoot:root}),intent={...send,hash:'0x'+'5'.repeat(64),phase:'signed'};append('signed',{...confirmed,send:intent,policy:{halt:null,inflight:{txHash:intent.hash}}});
 assert.throws(()=>fees.snapshot('c1',{runtimeRoot:root}),/DEX_SERVICE_FEES_UNRESOLVED/);
 append('policy',{...confirmed,unbroadcastRecovery:{schema:'C1_UNBROADCAST_RETIRED_V1',intent,noSend:true,feeWei:'0'}});
 const after=fees.snapshot('c1',{runtimeRoot:root});assert.equal(after.feeWei,before.feeWei);assert.equal(fees.delta(before,after),'0');assert(fs.readFileSync(journal).subarray(0,baselineBytes.length).equals(baselineBytes));
 append('policy',{...confirmed,feesWei:'0'});assert.throws(()=>fees.snapshot('c1',{runtimeRoot:root}),/DEX_SERVICE_FEES_RECORD_REJECTED/);
});

test('C1 historical fees preserve renewal holds and reject unresolved or invalid accounting',t=>{
  const root=temporary(t),base=path.resolve(__dirname,'../../ChainWhisper Contracts V2/validation/candidates'),shared='ChainWhisper Contracts V2/validation/candidates/c1-shared-integration-2026-10-05';
  const runtime=require(path.join(base,'limit-fill-history-shared-receipt-2026-10-13/c1-service/runtime.cjs')),runner=require(path.join(base,'c1-shared-integration-2026-10-05/runner.cjs'));
  const saved=JSON.parse(fs.readFileSync(path.join(base,'c1-shared-integration-2026-10-05/current-c1-operator-cc7eb662/window-1/bundle.json')));
  const bundle=runner.bundleFor(saved.manifest,{fromBlock:saved.discovery.fromBlock,operatorRole:saved.operatorRole,roles:saved.roles});bundle.sources['operator/runtime']='00'.repeat(32);delete bundle.hash;bundle.hash=sha(JSON.stringify(bundle));
  const directory=path.join(root,shared,'current-c1-operator-cc7eb662/window-1');fs.mkdirSync(directory,{recursive:true});
  const target={bundle:path.join(directory,'bundle.json'),journal:path.join(directory,'journal.jsonl'),cursor:path.join(directory,'cursor.json')};fs.writeFileSync(target.bundle,JSON.stringify(bundle));
  const hash=sha(JSON.stringify(bundle.manifest)),stream=bundle.manifest.policy.stream,pointer=path.join(root,shared,'durable-adapter-check-stream-'+sha(stream)+'.json');
  fs.writeFileSync(pointer,JSON.stringify({version:1,stream,journal:target.journal,manifestHash:hash}));
  const cursor={version:1,bundleHash:bundle.hash,nextBlock:bundle.discovery.fromBlock,last:null};fs.writeFileSync(target.cursor,JSON.stringify({...cursor,digest:sha(JSON.stringify(cursor))}));
  const state={feesWei:'0',verified:0,send:null,halt:null,baseNonce:null,triggers:[],policy:{halt:null,inflight:null,active:null,queue:[],jobs:0}};
  const write=()=>{const row={version:1,seq:0,previous:'0'.repeat(64),manifestHash:hash,kind:'start',state};fs.writeFileSync(target.journal,JSON.stringify({...row,digest:sha(JSON.stringify(row))})+'\n');};write();
  const before=fs.readFileSync(target.bundle),view=fees.snapshot('c1',{runtimeRoot:root});assert.equal(view.feeWei,'0');assert.equal(view.journals.length,1);assert.equal(view.journals[0].manifestSha256,sha(before));assert.deepEqual(fs.readFileSync(target.bundle),before);
  for(const patch of [{feesWei:'1'},{send:{hash:'0x'+'11'.repeat(32)}},{verified:1}]){
    Object.assign(state,patch);write();assert.throws(()=>runtime.renewalMetadata(target),/C1_CURRENT_SOURCE_RENEW_UNUSED/);assert.throws(()=>fees.snapshot('c1',{runtimeRoot:root}),/DEX_SERVICE_FEES_(UNRESOLVED|C1_INITIAL|RECORD_REJECTED)/);
    Object.assign(state,{feesWei:'0',send:null,baseNonce:null,verified:0});
  }
  write();
  for(const damage of ['digest','source-key','source-hash','scope']){
    const changed=JSON.parse(before);
    if(damage==='source-key')delete changed.sources['operator/runtime'];
    if(damage==='source-hash')changed.sources['operator/runtime']='invalid';
    if(damage==='scope')changed.operatorRole='bob';
    delete changed.hash;changed.hash=sha(JSON.stringify(changed));if(damage==='digest')changed.hash='00'.repeat(32);
    fs.writeFileSync(target.bundle,JSON.stringify(changed));assert.throws(()=>fees.snapshot('c1',{runtimeRoot:root}),/DEX_SERVICE_FEES_/);
  }
});
test('price snapshot binds controller and inner receipts and rejects an orphan action', t => {
  const base=path.resolve(__dirname,'../../ChainWhisper Contracts V2/validation/candidates'),current=path.join(base,'limit-fill-history-shared-receipt-2026-10-13/reference-history'),h=require(path.join(current,'package.cjs')),service=require(path.join(current,'service.cjs')),action=require(path.join(current,'action.cjs')),native=require(path.join(current,'native.cjs')),pp=require(path.join(base,'c1-shared-integration-2026-10-05/native-fixture/pp-trial.cjs')),ctx=h.accepted();
  const before=fees.snapshot('prices'),name='service-session-cc7eb-999'+Date.now(),directory=service.controller.directory(name);
  assert(!fs.existsSync(directory));
  t.after(()=>{assert.equal(path.dirname(path.resolve(directory)),path.dirname(service.controller.directory(name)));assert.equal(path.basename(directory),name);if(fs.existsSync(directory))fs.rmSync(directory,{recursive:true,force:true});});
  const now=Date.now(),block='0x'+'22'.repeat(32),owner=ctx.saved.base.actors.owner.address,root={type:'current-price-root',graph:h.GRAPH,core:h.CORE,head:{number:'100',hash:block,timestamp:String(Math.floor(now/1000))},actors:{owner:{address:owner,latestNonce:'0',pendingNonce:'0',balanceWei:'1000000000000000000'}}};
  const m={...service.controller.draft(name,service.identity(ctx),root,service.acceptedDeployments(ctx),now),accountingScope:action.PUBLIC_SCOPE,currentPins:service.pins()};
  fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'service.json'),JSON.stringify(m)+'\n');
  const selected=h.market(ctx.saved,1),binding=m.deployments[0].binding,pins=native.pins(),config=action.make({ctx,rpc:()=>assert.fail('NO_RPC'),selected,binding,kind:'refresh',pins,assertPins:()=>{},publicPublisher:true});
  const inner=config.buildManifest({rb:{live:{roles:root.actors}},model:{},creds:{userKeys:{owner:'synthetic-test'}},now,seal:()=>({synthetic:true})}),manifestHash=pp.digest(inner),transaction='0x'+'33'.repeat(32),target=path.join(directory,'action-0');
  fs.mkdirSync(target);fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(inner));
  const common={manifestSha256:manifestHash,action:'refresh-reference',role:'owner'},rows=[{kind:'prepared',manifestSha256:manifestHash},{...common,kind:'signing-start',nonce:'0',calldataHash:block},{...common,kind:'signed',nonce:'0',calldataHash:block,hash:transaction},{...common,kind:'verified',hash:transaction,gasUsed:'7',gasPriceWei:String(h.FEE),blockHash:block,blockNumber:'100',afterSeal:{synthetic:true},walletAndReceiptReconciled:true}];
  const bytes=Buffer.from(rows.map(JSON.stringify).join('\n')+'\n');fs.writeFileSync(path.join(target,'journal.jsonl'),bytes);
  const checkpoint={type:'current-price-action',directory:target,manifest:manifestHash,journal:sha(bytes),transaction,blockHash:block,blockNumber:'100'},outer=[{event:'started',kind:'refresh',canonicalId:'1',action:0,directory:target,predecessor:root,gas:service.controller.LIMITS.refreshGas},{event:'verified',kind:'refresh',canonicalId:'1',action:0,transaction,gasUsed:'7',checkpoint,sampledAt:Math.floor(now/1000)}];
  let previous='0'.repeat(64);const control=outer.map((event,ordinal)=>{const row={ordinal,previous,manifest:service.controller.hash(m),...event};row.hash=service.controller.hash(row);previous=row.hash;return row;});
  fs.writeFileSync(path.join(directory,'service.jsonl'),control.map(JSON.stringify).join('\n')+'\n');
  const after=fees.snapshot('prices');assert.equal(fees.delta(before,after),String(7n*h.FEE));
  fs.unlinkSync(path.join(directory,'service.jsonl'));assert.throws(()=>fees.snapshot('prices'),/DEX_SERVICE_FEES_INNER_ORPHAN/);
});
test('matching snapshot reuses a closed pp proof and rejects its truncated completion', t => {
  const root=temporary(t),relative='ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/matching-service/sessions-cc7eb662c644/session-1',original=path.resolve(__dirname,'../..',relative),directory=path.join(root,relative);
  const rows=fs.readFileSync(path.join(original,'journal.jsonl'),'utf8').trim().split('\n').map(JSON.parse),manifest=JSON.parse(fs.readFileSync(path.join(original,'manifest.json'))),done=rows.filter(row=>row.kind==='verified');
  assert(done.length>0);assert.equal(rows.at(-1).kind,'verified');fs.mkdirSync(directory,{recursive:true});
  for(const file of ['manifest.json','journal.jsonl'])fs.copyFileSync(path.join(original,file),path.join(directory,file),fs.constants.COPYFILE_EXCL);
  const view=fees.snapshot('matching',{runtimeRoot:root});assert.equal(view.journals.length,1);assert.equal(view.feeWei,String(done.reduce((sum,row)=>sum+BigInt(row.gasUsed)*BigInt(manifest.gasPriceWei),0n)));
  fs.writeFileSync(path.join(directory,'journal.jsonl'),rows.slice(0,-1).map(JSON.stringify).join('\n')+'\n');assert.throws(()=>fees.snapshot('matching',{runtimeRoot:root}),/DEX_SERVICE_FEES_UNRESOLVED/);
});

test('selected current fee namespace excludes old sessions and rejects malformed current records',{skip:!process.env.CW_LOW_RPC_TRIAL.startsWith('9c2cb')},t=>{
 const root=temporary(t),prefix='ChainWhisper Contracts V2/validation/candidates/',current=prefix+'limit-fill-history-shared-receipt-2026-10-13/',shared=prefix+'c1-shared-integration-2026-10-05/';
 const records={keeper:current+'app-async-service/app-host-cc7eb662-23abde1d22019d52852d6845c9444326dde1d99e/HOST.json',prices:prefix+'shared-core-exit-preview-native-2026-10-07/reference-history/service-v8/service-session-cc7eb-1/service.json',matching:current+'matching-service/sessions-cc7eb662c644/session-1/closed.json',c1:shared+'current-c1-operator-cc7eb662/window-1/bundle.json'};
 for(const [name,file]of Object.entries(records)){const old=path.join(root,file);fs.mkdirSync(path.dirname(old),{recursive:true});fs.writeFileSync(old,'invalid historical record');const empty=fees.snapshot(name,{runtimeRoot:root});assert.equal(empty.graph,process.env.CW_LOW_RPC_TRIAL);assert.equal(empty.feeWei,'0');assert.deepEqual(empty.journals,[]);
 const now=path.join(root,file.replace('cc7eb662c644',process.env.CW_LOW_RPC_TRIAL.slice(0,12)).replace('cc7eb662',process.env.CW_LOW_RPC_TRIAL.slice(0,8)).replace('cc7eb',process.env.CW_LOW_RPC_TRIAL.slice(0,5)));fs.mkdirSync(path.dirname(now),{recursive:true});fs.writeFileSync(now,'invalid current record');assert.throws(()=>fees.snapshot(name,{runtimeRoot:root}),/DEX_SERVICE_FEES_RECORD_REJECTED/);}
});
