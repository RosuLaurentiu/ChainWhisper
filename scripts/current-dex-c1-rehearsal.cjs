'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const controlFile='/etc/server-dashboard/chainwhisper-beta.rehearsal.json';
const claimDirectory='/var/lib/chainwhisper-c1-rehearsal/claims';
const startFile=directory=>path.join(directory,'c1-rehearsal-started.json');
const standingFile='/etc/server-dashboard/chainwhisper-beta.c1-standing.json';
const standingStart=directory=>path.join(directory,'c1-standing-started.json');
const toolEnv={PATH:'/usr/bin:/bin',HOME:'/nonexistent',NODE_ENV:'production'};
const replacementGraph='1a73e0205ca448e4eed5cdbbd4bb850dd87a0b08d183da20e44631fd4dd71fe7';
const replacementBinding='a1c0f2c1017906ac8bbe1d447282aacccbc2e8738b2afac0316020d6352a9f99';
const standingBindings=new Map([[replacementGraph,replacementBinding],
 ['9e6c03ac69178445605dc78a70e088b596684181d73b218a6a3a89e942b3af21',
  '6f6c3efd3b6915343f9281348a1dc313cee7fe99727fac50144ec44c364e5d5f'],
 ['5045070b8faad2caab781e2981ad3300b7d916016b7a1d354fe59b12a1d1c239',
  '35350b730e959fdbb8557edce5b61c2110f585ffda234b2dde58c78e4fa2e3cb']]);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

function readFile(file,limit,protectedSource=false){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const stat=fs.fstatSync(fd),named=fs.lstatSync(file);
  assert(stat.isFile()&&stat.nlink===1&&stat.size<=limit&&named.dev===stat.dev&&named.ino===stat.ino&&
   fs.realpathSync.native(file)===file,'C1_REHEARSAL_HOST_FILE');
  if(protectedSource){
   assert(stat.uid===0&&(stat.mode&0o022)===0,'C1_REHEARSAL_HOST_FILE');
   for(let parent=path.dirname(file);parent!=='/';parent=path.dirname(parent)){
    const directory=fs.lstatSync(parent);
    assert(directory.isDirectory()&&directory.uid===0&&(directory.mode&0o022)===0,'C1_REHEARSAL_HOST_FILE');
   }
  }
  const bytes=Buffer.alloc(stat.size);
  assert(fs.readSync(fd,bytes)===bytes.length&&fs.fstatSync(fd).size===bytes.length,'C1_REHEARSAL_HOST_FILE');
  return bytes;
 }finally{fs.closeSync(fd);}
}

function pinnedScript(root,manifest,name){
 const file=path.join(root,'APP','scripts',name);
 assert(sha(readFile(file,1024*1024,true))===manifest.files?.['APP/scripts/'+name],'C1_REHEARSAL_HOST_SOURCE');
 return file;
}

function createRecord(file,record,mode){
 const fd=fs.openSync(file,'wx',mode);
 try{fs.fchmodSync(fd,mode);fs.writeFileSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const parent=fs.openSync(path.dirname(file),'r');
 try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
}

function unitState(name,invocationId){
 const unit=Object.fromEntries(execFileSync('/usr/bin/systemctl',['show',name,'-p','MainPID','-p','InvocationID','-p','ActiveState','-p','ControlGroup'],
  {env:toolEnv,encoding:'utf8',timeout:5000}).trim().split('\n').map(line=>line.split('=')));
 assert(unit.InvocationID===invocationId&&!process.env.NODE_OPTIONS&&unit.ControlGroup==='/system.slice/'+name&&
  fs.readFileSync('/proc/self/cgroup','utf8').trim()==='0::'+unit.ControlGroup,'C1_REHEARSAL_HOST_UNIT');
 return unit;
}

function cachedPredecessor(root,graph,operator){
 const shared=path.join(root,'ChainWhisper Contracts V2/validation/candidates/c1-shared-integration-2026-10-05');
 const stream='7082400:'+operator.toLowerCase()+':'+graph;
 const pointer=path.join(shared,'durable-adapter-check-stream-'+sha(stream)+'.json');
 const windows=path.join(shared,'current-c1-operator-'+graph.slice(0,8));
 let cached;
 function snapshot(){
  if(!fs.existsSync(pointer))return null;
  const bytes=readFile(pointer,32768),value=JSON.parse(bytes);
  const window=path.basename(path.dirname(value.journal??''));
  const journal=path.join(windows,window,'journal.jsonl'),bundle=path.join(windows,window,'bundle.json');
  if(value.version!==1||value.stream!==stream||value.journal!==journal||!/^window-[1-9][0-9]{0,5}$/.test(window)||
    !fs.existsSync(journal)||!fs.existsSync(bundle)||fs.statSync(journal).size>8*1024*1024)return null;
  const key=[sha(bytes),sha(readFile(bundle,2*1024*1024)),sha(readFile(journal,8*1024*1024))].join(':');
  assert(readFile(pointer,32768).equals(bytes),'C1_REHEARSAL_PREDECESSOR_CHANGED');
  return key;
 }
 return inspect=>{
  const key=snapshot();
  if(key&&cached?.key===key)return structuredClone(cached.state);
  const state=inspect();
  if(key)assert.equal(snapshot(),key,'C1_REHEARSAL_PREDECESSOR_CHANGED');
  cached=key&&state?.status==='CURRENT_C1_SAVED_STATE'?{key,state:structuredClone(state)}:null;
  return state;
 };
}

function hostIo(){
 const invocationId=process.env.INVOCATION_ID;
 assert(process.platform==='linux'&&/^[0-9a-f]{32}$/.test(invocationId??''),'C1_REHEARSAL_HOST_UNIT');
 const watchdog='/opt/server-dashboard/modules/chainwhisper-beta/watchdog.cjs';
 assert.equal(sha(readFile(watchdog,1024*1024,true)),
  '94b916e1114cdc78822ba6d33932b19991582ca128173350c72d5cfca1106a3f','C1_REHEARSAL_HOST_SOURCE');
 const {CONFIG}=require(watchdog);
 const installedRoot=CONFIG.runtimeRoot,stageRoot=path.resolve(__dirname,'../..');
 const reportsRoot=path.join(installedRoot,'APP','reports'),manifestFile=path.join(installedRoot,'runtime-public.json');
 const dependencies=path.join(installedRoot,'ChainWhisper Contracts V2/validation/node_modules');
 const inspectCached=cachedPredecessor(installedRoot,CONFIG.graph,CONFIG.actors.c1.address);
 let services,worker;
 const readPeriod=directory=>services.readServerPeriod(directory,Date.now(),manifestFile,CONFIG.graph);
 const stagedManifest=approval=>{
   const manifest=readFile(path.join(stageRoot,'runtime-public.json'),2*1024*1024,true);
   assert(sha(manifest)===approval.stagedRuntimeManifestSha256&&/^[0-9a-f]{64}$/.test(approval.graph),'C1_REHEARSAL_HOST_SOURCE');
   const proof=JSON.parse(manifest);
   assert.equal(pinnedScript(stageRoot,proof,path.basename(__filename)),__filename,'C1_REHEARSAL_HOST_SOURCE');
   return proof;
 };
 return {installedRoot,stageRoot,context:{pid:process.pid,get ppid(){return process.ppid;},invocationId},
  checkUnit(supervisor,active=false){
   assert(os.userInfo().username===CONFIG.serviceUser&&
    process.env.CREDENTIALS_DIRECTORY==='/run/credentials/'+CONFIG.unit,'C1_REHEARSAL_HOST_UNIT');
   const unit=unitState(CONFIG.unit,invocationId);
   assert(unit.MainPID===String(supervisor)&&(active?unit.ActiveState==='active':['activating','active'].includes(unit.ActiveState)),
    'C1_REHEARSAL_HOST_UNIT');
  },
  checkClaimUnit(){
   assert(process.getuid()===0,'C1_REHEARSAL_HOST_UNIT');
   const unit=unitState(CONFIG.unit,invocationId);
   assert(unit.ActiveState==='activating'&&unit.MainPID==='0','C1_REHEARSAL_HOST_UNIT');
  },
  verifyClaimSource(approval){
   const manifest=stagedManifest(approval);
   return require(pinnedScript(stageRoot,manifest,'current-dex-service-watchdog.cjs')).checkRehearsalStopRecords;
  },
  checkPeerRuntime(approval){
   const manifest=stagedManifest(approval);
   require(pinnedScript(stageRoot,manifest,'current-dex-services.cjs')).checkInstalledPeerRuntime(installedRoot);
  },
  readStopProof:directory=>readFile(path.join(directory,'STOPPED_SERVICES_RECONCILED.json'),32768),
  readStoppedGroup(priorRun){
   const directory=path.join(CONFIG.runParent,priorRun);
   readFile(path.join(directory,'stop-request.json'),0);
   return readFile(path.join(directory,'group.json'),8*1024*1024);
  },
  claim(record){
   for(let directory=claimDirectory;directory!=='/';directory=path.dirname(directory)){
    const stat=fs.lstatSync(directory);
    assert(stat.isDirectory()&&stat.uid===0&&(stat.mode&0o022)===0,'C1_REHEARSAL_HOST_FILE');
   }
   const file=path.join(claimDirectory,record.approvalSha256+'.json');
   assert(!fs.existsSync(file),'C1_REHEARSAL_START_CONSUMED');
   createRecord(file,record,0o644);
  },
  readClaim:approvalSha256=>JSON.parse(readFile(path.join(claimDirectory,approvalSha256+'.json'),4096,true)),
  readApproval:()=>readFile(controlFile,32768,true),
  readInstalledApproval:()=>readFile(CONFIG.approvalFile,32768,true),
  readScope(directory,approval){
   const proof=stagedManifest(approval);
   services=require(pinnedScript(stageRoot,proof,'current-dex-services.cjs'));
   services.checkRuntimeFiles(stageRoot,{graph:approval.graph,manifestSha256:approval.stagedRuntimeManifestSha256,
    guard:'C1_REHEARSAL_HOST_SOURCE',writableState:path.join(stageRoot,'APP','reports','c1-state-'+approval.graph.slice(0,8))});
   pinnedScript(stageRoot,proof,'current-dex-service-watchdog.cjs');
   worker=require(pinnedScript(stageRoot,proof,services.rehearsalWorkerFile(approval.graph)));
   const period=readPeriod(directory);
   return {period,scope:worker.rehearsal(directory,period,Date.now(),reportsRoot)};
  },
  readPeriod,
  consume(directory,record){
   assert(!fs.existsSync(path.join(directory,'group.json'))&&!fs.existsSync(path.join(directory,'stop-request.json'))&&
    !fs.existsSync(startFile(directory)),'C1_REHEARSAL_START_CONSUMED');
   createRecord(startFile(directory),record,0o600);
  },
  readStart(directory){
   assert(fs.existsSync(startFile(directory)),'C1_REHEARSAL_START_BINDING');
   return JSON.parse(readFile(startFile(directory),4096));
  },
  inspectPredecessor(){
   const manifest=readFile(manifestFile,2*1024*1024,true);
   assert.equal(sha(manifest),CONFIG.runtimeManifestSha256,'C1_REHEARSAL_HOST_SOURCE');
   const inspector=pinnedScript(installedRoot,JSON.parse(manifest),'current-dex-c1.cjs');
   return inspectCached(()=>JSON.parse(execFileSync(process.execPath,[inspector,'--inspect'],{cwd:installedRoot,encoding:'utf8',timeout:7000,maxBuffer:1024*1024,
    env:{...toolEnv,NODE_PATH:dependencies,CW_LOW_RPC_TRIAL:CONFIG.graph,CHAINWHISPER_RUNTIME_ROOT:installedRoot}})));
  },
  runGroup(args,options){
   // The peer ledger inherits this selector. The staged C1 child gets its own environment.
   process.env.CW_LOW_RPC_TRIAL=CONFIG.graph;
   return services.main(args,options);
  },
  runWorker:(directory,options)=>worker.runRehearsal(directory,options),
  workerFailure:error=>worker?.failure?.(error)
 };
}

function standingHostIo(){
 const invocationId=process.env.INVOCATION_ID,root=path.resolve(__dirname,'../..');
 const unitName='chainwhisper-beta.service',manifestFile=path.join(root,'runtime-public.json');
 assert(process.platform==='linux'&&/^[a-f0-9]{32}$/.test(invocationId??''),'C1_STANDING_HOST_UNIT');
 return {root,context:{pid:process.pid,get ppid(){return process.ppid;},invocationId},
  checkUnit(supervisor,active=false){
   assert(os.userInfo().username==='serverdash'&&process.env.CREDENTIALS_DIRECTORY==='/run/credentials/'+unitName,
    'C1_STANDING_HOST_UNIT');
   const unit=unitState(unitName,invocationId);
   assert(unit.MainPID===String(supervisor)&&(active?unit.ActiveState==='active':['activating','active'].includes(unit.ActiveState)),
    'C1_STANDING_HOST_UNIT');
  },
  readApproval:()=>readFile(standingFile,2*1024*1024,true),
  readInstalledApproval:()=>readFile('/etc/server-dashboard/chainwhisper-beta.approval.json',32768,true),
  readEvidence:()=>({
   rehearsal:readFile('/etc/server-dashboard/chainwhisper-beta.c1-rehearsal-result.json',32768,true),
   capital:readFile('/etc/server-dashboard/chainwhisper-beta.c1-capital-result.json',32768,true),
  }),
  open(approval){
   const manifest=readFile(manifestFile,2*1024*1024,true);
   assert(sha(manifest)===approval.runtimeManifestSha256,'C1_STANDING_HOST_SOURCE');
   const source=JSON.parse(manifest);
   assert(source.graph===approval.graph&&pinnedScript(root,source,path.basename(__filename))===__filename,'C1_STANDING_HOST_SOURCE');
   const services=require(pinnedScript(root,source,'current-dex-services.cjs'));
   const worker=require(pinnedScript(root,source,'current-dex-c1.cjs'));
   return {readPeriod:directory=>services.readServerPeriod(directory,Date.now(),manifestFile,approval.graph),
    runGroup:services.main,runWorker:worker.runStanding,workerEntry:__filename};
  },
  consume:(directory,start)=>createRecord(standingStart(directory),start,0o600),
  readStart:directory=>JSON.parse(readFile(standingStart(directory),4096)),
 };
}

async function mainStanding(args,host=standingHostIo()){
 assert(args.length===2&&['--supervise-standing','--stand'].includes(args[0]),'C1_STANDING_BOOTSTRAP_USAGE');
 const [mode,directory]=args,supervising=mode==='--supervise-standing';
 const supervisor=supervising?host.context.pid:host.context.ppid;
 host.checkUnit(supervisor);
 const bytes=host.readApproval(),approvalSha256=sha(bytes),approval=JSON.parse(bytes);
 const graph=approval.graph,binding=standingBindings.get(graph);
 const installedBytes=host.readInstalledApproval(),installedSha256=sha(installedBytes),installed=JSON.parse(installedBytes);
 const {firstBundle,standingInitialOperatorNonce}=approval,m=firstBundle?.manifest;
 const {hash,...body}=firstBundle??{};
 assert(approval.schema==='CHAINWHISPER_C1_STANDING_APPROVAL_V1'&&approval.approvedByOwner===true&&
  binding!==undefined&&approval.bindingSha256===binding&&digest(approval.runtimeManifestSha256)&&
  digest(approval.rehearsalResultSha256)&&digest(approval.capitalResultSha256)&&
  typeof standingInitialOperatorNonce==='string'&&/^(0|[1-9][0-9]*)$/.test(standingInitialOperatorNonce)&&
  digest(hash)&&sha(JSON.stringify(body))===hash&&m?.binding?.graph===graph&&
  m.replacementBindingSha256===binding&&m.chainId==='7082400'&&
  m.operator==='0xddbfe89f9decad1b99406be4af8bb613065144be'&&m.policy?.totalWei==='323200000000000000',
  'C1_STANDING_HOST_APPROVAL');
 const {rehearsal,capital}=host.readEvidence();
 assert(sha(rehearsal)===approval.rehearsalResultSha256&&sha(capital)===approval.capitalResultSha256,
  'C1_STANDING_HOST_CUTOVER_EVIDENCE');
 const rehearsalResult=JSON.parse(rehearsal),capitalResult=JSON.parse(capital);
 assert(rehearsalResult.graph===graph&&rehearsalResult.status==='C1_REHEARSAL_VERIFIED'&&
  capitalResult.graph===graph&&capitalResult.status==='C1_CUTOVER_CAPITAL_RECONCILED'&&
  capitalResult.rehearsalResultSha256===approval.rehearsalResultSha256&&
  capitalResult.operatorNonce===standingInitialOperatorNonce,'C1_STANDING_HOST_CUTOVER_EVIDENCE');
 assert(installed.approvedByOwner===true&&installed.graph===graph&&installed.mode==='standing'&&
  installed.runtimeManifestSha256===approval.runtimeManifestSha256&&installed.c1StandingSha256===approvalSha256&&
  typeof installed.runName==='string'&&/^server-beta-[a-z0-9-]{1,120}$/.test(installed.runName)&&
  directory===path.join(host.root,'APP','reports','server-beta-runs',installed.runName),'C1_STANDING_HOST_APPROVAL');
 const entry=host.open(approval),period=entry.readPeriod(directory);
 assert(period.approvalSha256===installedSha256&&period.c1StandingSha256===approvalSha256&&
  period.runtimeManifestSha256===approval.runtimeManifestSha256&&period.replacementBindingSha256===binding&&
  period.priorSpentFeeWei===installed.priorSpentFeeWei,'C1_STANDING_HOST_PERIOD');
 const start={schema:'CHAINWHISPER_C1_STANDING_START_V1',runName:installed.runName,approvalSha256,installedSha256,
  supervisor,invocationId:host.context.invocationId};
 const scope={approvalSha256,firstBundle,standingInitialOperatorNonce};
 const readScope=target=>{
  assert(target===directory&&sha(host.readApproval())===approvalSha256&&sha(host.readInstalledApproval())===installedSha256,
   'C1_STANDING_HOST_APPROVAL');
  assert.deepEqual(entry.readPeriod(directory),period,'C1_STANDING_HOST_PERIOD');
  return structuredClone(scope);
 };
 if(supervising){
  readScope(directory);host.consume(directory,start);
  return entry.runGroup(['--serve',directory],{readStandingScope:readScope,standingWorkerEntry:entry.workerEntry});
 }
 const verifyLaunch=(selected,kind)=>{
  assert(host.context.ppid===supervisor,'C1_STANDING_START_BINDING');
  assert.deepEqual(selected,readScope(directory),'C1_STANDING_START_BINDING');
  assert.deepEqual(host.readStart(directory),start,'C1_STANDING_START_BINDING');
  if(kind==='publish'||kind==='sign'||kind==='send')host.checkUnit(supervisor,true);
  return true;
 };
 verifyLaunch(scope);
 return entry.runWorker(directory,{readScope,verifyLaunch});
}

async function main(args,host){
 if(['--supervise-standing','--stand'].includes(args[0]))return mainStanding(args,host);
 host??=hostIo();
 assert(args.length===2&&['--claim','--supervise','--rehearse'].includes(args[0]),'C1_REHEARSAL_BOOTSTRAP_USAGE');
 const [mode,directory]=args,claiming=mode==='--claim',supervising=mode==='--supervise';
 const supervisor=supervising?host.context.pid:host.context.ppid;
 if(claiming)host.checkClaimUnit();else host.checkUnit(supervisor);
 const approved=host.readApproval(),approval=JSON.parse(approved),approvalSha256=sha(approved);
 const reportsRoot=path.join(host.installedRoot,'APP','reports');
 const validRun=name=>typeof name==='string'&&/^server-beta-[a-z0-9-]{1,120}$/.test(name);
 assert(validRun(approval.runName)&&validRun(approval.priorRun)&&approval.runName!==approval.priorRun&&
  directory===path.join(reportsRoot,'server-beta-runs',approval.runName)&&approval.stagedRuntimeRoot===host.stageRoot,'C1_REHEARSAL_HOST_APPROVAL');
 const checkApproval=()=>assert(sha(host.readApproval())===approvalSha256&&sha(host.readInstalledApproval())===approval.periodApprovalSha256,
  'C1_REHEARSAL_HOST_APPROVAL');
 const claim={schema:'CHAINWHISPER_C1_REHEARSAL_CLAIM_V1',runName:approval.runName,approvalSha256,invocationId:host.context.invocationId};
 checkApproval();
 if(claiming){
  const now=Date.now(),seconds=Math.floor(now/1000),{issuedAt,expiresAt}=approval;
  assert(approval.schema==='CHAINWHISPER_C1_REHEARSAL_APPROVAL_V1'&&approval.approvedByOwner===true&&
   Number.isSafeInteger(issuedAt)&&Number.isSafeInteger(expiresAt)&&issuedAt<=seconds&&seconds<expiresAt&&expiresAt-issuedAt<=1800,
   'C1_REHEARSAL_HOST_APPROVAL');
  const validateStop=host.verifyClaimSource(approval);
  const {baselineCarry}=validateStop({approval,now,groupBytes:host.readStoppedGroup(approval.priorRun),proofBytes:host.readStopProof(directory)});
  const installed=JSON.parse(host.readInstalledApproval());
  assert(installed.runName===approval.priorRun&&installed.priorSpentFeeWei===baselineCarry,'C1_REHEARSAL_HOST_STOP_PROOF');
  host.checkPeerRuntime(approval);
  checkApproval();
  host.claim(claim);
  return {status:'C1_REHEARSAL_APPROVAL_CONSUMED',runName:approval.runName};
 }
 const checkClaim=()=>assert.deepEqual(host.readClaim(approvalSha256),claim,'C1_REHEARSAL_START_BINDING');
 checkClaim();
 const {scope,period}=host.readScope(directory,approval);
 assert(scope.approvalSha256===approvalSha256&&scope.priorApprovalSha256===approval.periodApprovalSha256,'C1_REHEARSAL_HOST_APPROVAL');
 const start={schema:'CHAINWHISPER_C1_REHEARSAL_START_V1',runName:approval.runName,approvalSha256,supervisor,invocationId:host.context.invocationId};
 if(supervising){
  checkClaim();checkApproval();
  host.consume(directory,start);
  return host.runGroup(['--serve',directory],{installedPeerRoot:host.installedRoot,stagedC1Root:host.stageRoot,stagedRehearsalScope:scope});
 }
 const verifyLaunch=(selected,kind)=>{
  assert(selected.approvalSha256===approvalSha256&&host.context.ppid===supervisor,'C1_REHEARSAL_START_BINDING');
  if(kind==='send'||kind==='publish')host.checkUnit(supervisor,true);
  checkApproval();
  checkClaim();
  assert.deepEqual(host.readStart(directory),start,'C1_REHEARSAL_START_BINDING');
  return true;
 };
 verifyLaunch(scope);
 return host.runWorker(directory,{reportsRoot,readPeriod:host.readPeriod,verifyLaunch,readPredecessor:selected=>{
  verifyLaunch(selected);
  const state=host.inspectPredecessor(selected);
  verifyLaunch(selected);
  return {graph:period.graph,runName:approval.priorRun,runtimeManifestSha256:approval.priorRuntimeManifestSha256,
   groupSha256:approval.priorGroupSha256,priorSpentFeeWei:scope.priorSpentFeeWei,state};
 }});
}

module.exports={main,claimDirectory,cachedPredecessor};
if(require.main===module){
 const args=process.argv.slice(2);
 let host;
 Promise.resolve().then(()=>{
  if(args[0]==='--rehearse')host=hostIo();
  return main(args,host);
 }).then(result=>console.log(JSON.stringify(result))).catch(error=>{
  const guard=/^[A-Z][A-Z0-9_]+$/.test(error?.message??'')?error.message:'C1_REHEARSAL_HOST_REJECTED';
  const code=/^[A-Z][A-Z0-9_]+$/.test(error?.code??'')?error.code:null;
  const locations=String(error?.stack??'').split('\n').slice(1).flatMap(line=>{
   const site=/([\w.-]+\.cjs:\d+:\d+)(?:\)|$)/.exec(line);
   return site?[site[1]]:[];
  }).slice(0,4);
  console.error(JSON.stringify(host?.workerFailure(error)??
   {status:'CURRENT_C1_STOP',guard,code,locations,noAutomaticRetry:true,reconcileSavedJournalBeforeRetry:true}));
  process.exitCode=1;
 });
}
