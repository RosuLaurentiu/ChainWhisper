'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const candidates=path.resolve(__dirname,'../../ChainWhisper Contracts V2/validation/candidates');
let runtime;
const loadRuntime=()=>runtime??=require(path.join(candidates,'limit-fill-history-shared-receipt-2026-10-13/c1-service/runtime.cjs'));
const {pins}=require(path.join(candidates,'c1-band-sizing-2026-11-21/candidate.cjs'));
const {TIMING}=require(path.join(candidates,'c1-shared-integration-2026-10-05/tier-schedule-policy.cjs'));
const MODES=['--check','--read','--prepare','--start','--once','--restart','--reconcile','--inspect','--expire','--renew'];
const reports=path.resolve(__dirname,'../reports'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const approvalName='c1-rehearsal-approval.json',bundleName='c1-rehearsal-bundle.json';
function reportFile(file,maximum){
 const stat=fs.lstatSync(file);
 assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size<=maximum&&fs.realpathSync.native(file)===file,
  'C1_REHEARSAL_FILE');
 const bytes=fs.readFileSync(file);
 assert(bytes.length<=maximum,'C1_REHEARSAL_FILE');
 return {sha256:sha(bytes),value:JSON.parse(bytes),bytes};
}
function rehearsal(directory,period,now=Date.now(),reportsRoot=reports){
 const runParent=path.dirname(directory);
 assert(path.isAbsolute(reportsRoot)&&fs.realpathSync.native(reportsRoot)===reportsRoot&&
  (runParent===reportsRoot||runParent===path.join(reportsRoot,'server-beta-runs'))&&fs.realpathSync.native(directory)===directory,
  'C1_REHEARSAL_DIRECTORY');
 const {CONFIG,checkRehearsalStopRecords}=require('./current-dex-service-watchdog.cjs');
 const operator=CONFIG.actors.c1.address;
 const {replacementBindingSha256,c1RehearsalSha256}=period;
 assert(digest(replacementBindingSha256)&&digest(c1RehearsalSha256),'C1_REHEARSAL_PERIOD');
 const file=path.join(directory,approvalName),{sha256,value:approval}=reportFile(file,32768);
 assert.equal(sha256,c1RehearsalSha256,'C1_REHEARSAL_APPROVAL_DIGEST');
 assert(approval.schema==='CHAINWHISPER_C1_REHEARSAL_APPROVAL_V1'&&approval.approvedByOwner===true&&
  approval.graph===pins.graph&&approval.chainId==='7082400'&&approval.operator===operator&&
  approval.signer==='systemd-c1'&&approval.runName===path.basename(directory)&&
  approval.bindingSha256===replacementBindingSha256&&approval.periodApprovalSha256===period.approvalSha256&&
  approval.runtimeManifestSha256===period.runtimeManifestSha256&&approval.maximumCommittedWei===TIMING.totalWei&&
  digest(approval.bundleHash)&&digest(approval.priorGroupSha256)&&digest(approval.priorReconciliationSha256)&&
  digest(approval.priorRuntimeManifestSha256)&&digest(approval.stagedRuntimeManifestSha256)&&
  typeof approval.stagedRuntimeRoot==='string'&&path.isAbsolute(approval.stagedRuntimeRoot),'C1_REHEARSAL_APPROVAL_SCOPE');
 const continuation=approval.continuation;
 if(continuation!==undefined){
  assert(continuation&&(continuation.windowOrdinal===2||continuation.windowOrdinal===3)&&
   digest(continuation.continuationSha256)&&typeof continuation.expectedOperatorNonce==='string'&&
   /^(0|[1-9][0-9]*)$/.test(continuation.expectedOperatorNonce)&&
   continuation.cumulativeCommitmentWei===String(BigInt(TIMING.totalWei)*BigInt(continuation.windowOrdinal)),
   'C1_REHEARSAL_CONTINUATION_SCOPE');
 }
 const sequence=approval.sequence;
 if(sequence!==undefined){
  assert(continuation===undefined&&sequence&&(sequence.maximumWindows===2||sequence.maximumWindows===3)&&
   sequence.totalCommittedWei===String(BigInt(TIMING.totalWei)*BigInt(sequence.maximumWindows)),
   'C1_REHEARSAL_SEQUENCE_SCOPE');
 }
 require(path.join(candidates,'c1-band-sizing-2026-11-21/window-b/service-state.cjs')).checkSenderLock(approval.senderLock);
 const {issuedAt,expiresAt,priorRun}=approval,seconds=Math.floor(now/1000);
 assert(Number.isSafeInteger(issuedAt)&&Number.isSafeInteger(expiresAt)&&issuedAt<=seconds&&seconds<expiresAt&&
  expiresAt-issuedAt<=1800&&(period.expiresAt===null||expiresAt*1000<=period.expiresAt),'C1_REHEARSAL_APPROVAL_TIME');
 assert(typeof priorRun==='string'&&/^server-beta-[a-z0-9-]{1,120}$/.test(priorRun)&&priorRun!==approval.runName,
  'C1_REHEARSAL_PRIOR_RUN');
 const priorFile=path.join(runParent,priorRun,'group.json'),prior=reportFile(priorFile,8*1024*1024);
 assert(period.graph===CONFIG.graph&&period.mode==='standing'&&fs.existsSync(path.join(path.dirname(priorFile),'stop-request.json')),
  'C1_REHEARSAL_PRIOR_GROUP');
 const reconciliation=reportFile(path.join(directory,'STOPPED_SERVICES_RECONCILED.json'),32768);
 const {carry:priorSpentFeeWei}=checkRehearsalStopRecords({approval,groupBytes:prior.bytes,proofBytes:reconciliation.bytes,now});
 assert(period.priorSpentFeeWei===priorSpentFeeWei,'C1_REHEARSAL_PRIOR_FEES');
 const bundleFile=path.join(directory,bundleName),saved=reportFile(bundleFile,2*1024*1024),bundle=saved.value;
 const {hash,...body}=bundle;
 assert.equal(sha(JSON.stringify(body)),hash,'C1_REHEARSAL_BUNDLE_DIGEST');
 assert.deepEqual(bundle.senderLock,approval.senderLock,'C1_REHEARSAL_SENDER_LOCK');
 assert(bundle.hash===approval.bundleHash&&bundle.manifest?.binding?.graph===pins.graph&&
  bundle.manifest?.replacementBindingSha256===replacementBindingSha256&&bundle.manifest?.operator===operator&&
  bundle.manifest?.policy?.totalWei===TIMING.totalWei&&bundle.manifest.policy.now===issuedAt,'C1_REHEARSAL_BUNDLE');
 const {market}=approval;
 if(market!==undefined)assert(typeof market==='string'&&/^[1-6]$/.test(market)&&
  Object.hasOwn(bundle.manifest.pairs??{},market),'C1_REHEARSAL_MARKET_SCOPE');
 if(approval.quoteModel!==undefined){
  const fit=require(path.join(candidates,'c1-band-sizing-2026-11-21/window-b/quote-fit.cjs'));
  const published=approval.quoteModel?.reportSha256===fit.PUBLISHED_PASS_REPORT_SHA256;
  const wide=approval.quoteModel?.reportSha256===fit.WIDE_GAP_PASS_REPORT_SHA256||
   approval.quoteModel?.reportSha256===fit.WIDE_GAP_RESUME_REPORT_SHA256;
  const finalPair=approval.quoteModel?.finalPair===true;
  assert(market===(wide?'1':'2')&&continuation===undefined&&(!finalPair||published)&&
   (published&&!finalPair?sequence?.maximumWindows===2:sequence===undefined)&&
   typeof approval.quoteModel?.operatorNonce==='string'&&/^(0|[1-9][0-9]*)$/.test(approval.quoteModel.operatorNonce),
   'C1_REHEARSAL_QUOTE_MODEL_SCOPE');
  if(published||wide){
   const predecessor=reconciliation.value.settledRehearsals?.at(-1);
   assert(approval.quoteModel.operatorNonce===predecessor?.toNonce&&(!finalPair||predecessor.sends===40),
    'C1_REHEARSAL_QUOTE_MODEL_NONCE');
  }
  fit.bound(approval.quoteModel.reportSha256,finalPair);
 }
 return {graph:pins.graph,replacementBindingSha256,feeLimitWei:TIMING.totalWei,approval,approvalSha256:sha256,bundle,priorSpentFeeWei,
  priorApprovalSha256:approval.periodApprovalSha256};
}
function waitForParent(peer,digest,type='CHAINWHISPER_C1_REHEARSAL'){
 return new Promise((resolve,reject)=>{
  const guard=type==='CHAINWHISPER_C1_STANDING'?'C1_STANDING_PARENT':'C1_REHEARSAL_PARENT';
  const finish=(error,ordinal)=>{clearTimeout(wait);peer.removeListener('message',message);peer.removeListener('disconnect',disconnect);
   if(error)reject(error);else resolve(ordinal);};
  const message=value=>{if(value?.type===type)finish(value.approvalSha256===digest&&
   value.pid===peer.pid?undefined:Error(guard),value.windowOrdinal===undefined?1:value.windowOrdinal);};
  const disconnect=()=>finish(Error(guard));
  const wait=setTimeout(disconnect,10000);
  peer.on('message',message);peer.once('disconnect',disconnect);
 });
}
async function runStanding(directory,{peer=process,readScope,verifyLaunch,operate,bindBroadcast}={}){
 assert(typeof readScope==='function'&&typeof verifyLaunch==='function','C1_STANDING_WORKER_HELD');
 assert(peer.connected&&peer.env.CHAINWHISPER_RPC_MANAGED_SERVICE==='c1'&&
  typeof peer.env.CREDENTIALS_DIRECTORY==='string'&&path.isAbsolute(peer.env.CREDENTIALS_DIRECTORY),'C1_STANDING_MANAGED_SIGNER');
 directory=path.resolve(directory);
 const approved=structuredClone(readScope(directory)),{approvalSha256,firstBundle,standingInitialOperatorNonce}=approved;
 const m=firstBundle.manifest;
 const graph=m.binding.graph;
 const sizing=graph==='5045070b8faad2caab781e2981ad3300b7d916016b7a1d354fe59b12a1d1c239';
 const wide=graph===pins.graph?null:require(path.join(candidates,'c1-band-sizing-2026-11-21',
  sizing?'sizing-standing-runtime.cjs':'window-b/wide-first/service-runtime.cjs'));
 assert(digest(approvalSha256)&&(graph===pins.graph||graph===wide.BINDING.graph&&m.replacementBindingSha256===wide.verifiedSha256)&&m.chainId==='7082400'&&
  m.policy.totalWei===TIMING.totalWei&&typeof standingInitialOperatorNonce==='string'&&/^(0|[1-9][0-9]*)$/.test(standingInitialOperatorNonce),
  'C1_STANDING_AUTHORITY');
 let stopped=false;
 const onStop=message=>{if(message?.type==='CHAINWHISPER_SERVICE_STOP')stopped=true;};
 peer.on('message',onStop);
 const check=kind=>{
  assert(peer.connected&&!stopped&&!fs.existsSync(path.join(directory,'stop-request.json')),'C1_STANDING_PARENT');
  assert.deepEqual(readScope(directory),approved,'C1_STANDING_SCOPE_DRIFT');
  assert(verifyLaunch(approved,kind)===true,'C1_STANDING_WORKER_HELD');
 };
 try{
  check('start');
  await waitForParent(peer,approvalSha256,'CHAINWHISPER_C1_STANDING');
  check('start');
  const selected=loadRuntime();
  assert.equal(m.operator,selected.OPERATOR,'C1_STANDING_OPERATOR');
  const queueBroadcast=(bindBroadcast??require('./current-dex-rpc-pacing.cjs').bindC1Broadcast)();
  const assertAuthorized=(scope,kind)=>{
   check(kind);
   assert(scope.graph===graph&&scope.bindingSha256===m.replacementBindingSha256&&scope.operator===m.operator&&
    scope.maximumCommittedWei===TIMING.totalWei&&scope.approvalSha256===approvalSha256&&
    scope.standingInitialOperatorNonce===standingInitialOperatorNonce,'C1_STANDING_AUTHORITY');
   if(kind==='select')assert.equal(scope.initialBundleHash,firstBundle.hash,'C1_STANDING_INITIAL_BUNDLE');
   else assert(['publish','read','sign','send'].includes(kind),'C1_STANDING_AUTHORITY');
   return true;
  };
  return await (operate??selected.operateStandingReplacement)(firstBundle,{approvalSha256,standingInitialOperatorNonce,assertAuthorized,queueBroadcast,
   loadSigner:({provider,operator,assertAuthorized})=>selected.loadOperator({
    provider,expected:operator,assertAuthorized,envPath:selected.operatorCredentialPath(peer.env)
   })});
 }finally{peer.removeListener('message',onStop);}
}
async function runRehearsal(directory,{peer=process,readPeriod,verifyLaunch,readPredecessor,execute,bindBroadcast,reportsRoot=reports}={}){
 assert(typeof verifyLaunch==='function'&&typeof readPredecessor==='function'&&(execute===undefined||typeof execute==='function'),
  'C1_REHEARSAL_WORKER_HELD');
 assert(reportsRoot===reports||typeof readPeriod==='function','C1_REHEARSAL_INSTALLED_PERIOD_READER');
 assert(peer.connected&&peer.env.CHAINWHISPER_RPC_MANAGED_SERVICE==='c1'&&
  typeof peer.env.CREDENTIALS_DIRECTORY==='string'&&path.isAbsolute(peer.env.CREDENTIALS_DIRECTORY),'C1_REHEARSAL_MANAGED_SIGNER');
 directory=path.resolve(directory);
 readPeriod??=require('./current-dex-services.cjs').readServerPeriod;
 const period=readPeriod(directory),scope=rehearsal(directory,period,Date.now(),reportsRoot);
 let continuation=scope.approval.continuation,bundle=scope.bundle;
 if(reportsRoot!==reports)assert.equal(scope.approval.stagedRuntimeRoot,path.resolve(__dirname,'../..'),'C1_REHEARSAL_STAGE_ROOT');
 const checkLaunch=kind=>assert(verifyLaunch(scope,kind)===true,'C1_REHEARSAL_LAUNCH_HELD');
 checkLaunch('start');
 let stopped=false;
 const onStop=message=>{if(message?.type==='CHAINWHISPER_SERVICE_STOP')stopped=true;};
 peer.on('message',onStop);
 const assertPriorC1Idle=()=>{
  const prior=readPredecessor(scope);
  assert(prior?.graph===period.graph&&prior.runName===scope.approval.priorRun&&
   prior.runtimeManifestSha256===scope.approval.priorRuntimeManifestSha256&&
   prior.groupSha256===scope.approval.priorGroupSha256&&prior.priorSpentFeeWei===scope.priorSpentFeeWei,
   'C1_REHEARSAL_PREDECESSOR_SOURCE');
  const state=prior.state;
  const readOnly={noNetwork:true,noCredentials:true,noSend:true};
  const empty=isDeepStrictEqual(state,{status:'CURRENT_C1_NOT_STARTED',...readOnly});
  const idle=state?.status==='CURRENT_C1_SAVED_STATE'&&state.noNetwork===true&&state.noCredentials===true&&state.noSend===true&&
   state.pendingHash===null&&state.hashless===false&&state.activePair===null&&state.halt===null&&state.renewalPending===false&&
   (state.transitionRequired===undefined||state.transitionRequired===false)&&
   Array.isArray(state.queuedPairs)&&state.queuedPairs.length===0&&
   (state.parkedPairs===undefined||Array.isArray(state.parkedPairs)&&state.parkedPairs.length===0);
  assert(empty||idle,'C1_REHEARSAL_PREDECESSOR_UNRESOLVED');
 };
 const checkParent=()=>assert(peer.connected&&!stopped&&!fs.existsSync(path.join(directory,'stop-request.json')),'C1_REHEARSAL_PARENT');
 const checkPinned=()=>{
  assert.deepEqual(readPeriod(directory),period,'C1_REHEARSAL_PERIOD_CHANGED');
  const current=rehearsal(directory,period,Date.now(),reportsRoot);
  assert.deepEqual(current,scope,'C1_REHEARSAL_SCOPE_CHANGED');
  assertPriorC1Idle();
  checkParent();
 };
 const assertAuthorized=(request,kind,action)=>{
  checkParent();
  checkLaunch(kind);
  assert(request.bundleHash===bundle.hash&&request.graph===scope.graph&&request.chainId==='7082400'&&
   request.bindingSha256===scope.replacementBindingSha256&&request.maximumCommittedWei===scope.feeLimitWei&&
   request.operator===scope.approval.operator&&request.approvalSha256===scope.approvalSha256&&
   request.issuedAt===bundle.manifest.policy.now&&request.expiresAt===scope.approval.expiresAt&&
   request.windowOrdinal===continuation?.windowOrdinal&&request.continuationSha256===continuation?.continuationSha256&&
   request.expectedOperatorNonce===continuation?.expectedOperatorNonce&&
   request.cumulativeCommitmentWei===continuation?.cumulativeCommitmentWei,'C1_REHEARSAL_REQUEST');
  if(kind!=='read')checkPinned();
  if(scope.approval.market!==undefined&&(kind==='send'||action!==undefined))
   assert.equal(action?.pair,scope.approval.market,'C1_REHEARSAL_MARKET_SCOPE');
  return true;
 };
 try{
  const windowOrdinal=await waitForParent(peer,scope.approvalSha256),sequence=scope.approval.sequence;
  assert(Number.isSafeInteger(windowOrdinal)&&windowOrdinal>=1&&windowOrdinal<=(sequence?.maximumWindows??1),
   'C1_REHEARSAL_SEQUENCE_SCOPE');
  checkParent();
  checkLaunch('start');
  assertPriorC1Idle();
  const selectedRuntime=loadRuntime();
  assert.equal(selectedRuntime.OPERATOR,scope.approval.operator,'C1_REHEARSAL_RUNTIME_OPERATOR');
  if(windowOrdinal>1){
   const expiresAt=scope.approval.expiresAt;
   const advanced=await selectedRuntime.advanceReplacement(scope.bundle,{windowOrdinal,approvalSha256:scope.approvalSha256,expiresAt,
    totalReservedWei:sequence.totalCommittedWei,assertAuthorized:(request,kind)=>{
     checkParent();
     checkLaunch(kind);
     assert(kind==='publish'&&request.window===windowOrdinal&&request.graph===scope.graph&&
      request.bindingSha256===scope.replacementBindingSha256&&request.approvalSha256===scope.approvalSha256&&
      request.expiresAt===expiresAt&&request.issuedAt>scope.approval.issuedAt&&request.maximumCommittedWei===scope.feeLimitWei&&
      request.cumulativeCommitmentWei===String(BigInt(windowOrdinal)*BigInt(scope.feeLimitWei)),'C1_REHEARSAL_SEQUENCE_SCOPE');
     checkPinned();
     return true;
    }});
   ({bundle,...continuation}=advanced);
  }
  execute??=selectedRuntime.runReplacement;
  assert(typeof execute==='function','C1_REHEARSAL_WORKER_HELD');
  checkParent();
  const queueBroadcast=(bindBroadcast??require('./current-dex-rpc-pacing.cjs').bindC1Broadcast)();
  return await execute(bundle,{approvalSha256:scope.approvalSha256,expiresAt:scope.approval.expiresAt,assertAuthorized,senderLock:scope.approval.senderLock,
   ...(scope.approval.market===undefined?{}:{rehearsalMarket:scope.approval.market}),
   ...(scope.approval.quoteModel===undefined?{}:{quoteModel:scope.approval.quoteModel}),
   ...(continuation?{continuationSha256:continuation.continuationSha256}:{}),
   queueBroadcast,
   loadSigner:({provider,operator,assertAuthorized})=>selectedRuntime.loadOperator({
    provider,expected:operator,assertAuthorized,envPath:selectedRuntime.operatorCredentialPath(peer.env)
   })});
 }finally{peer.removeListener('message',onStop);}
}
async function main(args){
 if(Array.isArray(args)&&args.length===2&&args[0]==='--stand')return runStanding(args[1]);
 if(Array.isArray(args)&&args.length===2&&args[0]==='--check-replacement'){
  assert(process.env.CW_LOW_RPC_TRIAL===undefined,'C1_REPLACEMENT_CHECK_SELECTOR');
  if(args[1]===require('./current-dex-service-fees.cjs').build13PeerBinding){
   const sizingRoot=path.join(candidates,'c1-band-sizing-2026-11-21');
   const source=require(path.join(sizingRoot,'sizing-peer-binding.cjs')).openBuild13KeeperBinding(args[1]).loadPublicBinding();
   const runtime=require(path.join(sizingRoot,'sizing-rehearsal-runtime.cjs'));
   const {held,window}=runtime.openRuntime(runtime.verifiedSha256);
   const band=reportFile(path.join(sizingRoot,'native-bob-dense-1/BAND_RESULT.json'),65536);
   assert.equal(band.sha256,'af54e90efb3a2afe63692583ad8dbc16d2bd48d00260a9a61fc0a0b6df2f7ca8','C1_SIZING_BAND_RESULT');
   assert(held.graph===source.identity.graph&&held.core===source.identity.core.toLowerCase()&&
    band.value.status==='CW120_BUILD13_BAND_MEASURED'&&band.value.verifiedInBandByTerminalCommit===true&&
    band.value.rehearsal.sends===2*window.maximumJobs&&band.value.quiet.tiers===7&&
    band.value.conservedBothAssets===true,'C1_SIZING_REHEARSAL_COMPLETE');
   const {fit,limits}=require(path.join(sizingRoot,'sizing-standing-fit.cjs')).standingProfile();
   const standing=require(path.join(sizingRoot,'sizing-standing-runtime.cjs'));
   const {held:standingInput}=standing.openRuntime(standing.verifiedSha256);
   return {status:'BUILD13_C1_REHEARSAL_INPUTS_CHECKED',graph:held.graph,core:held.core,operator:held.operator,
    marketCount:source.marketBindings.size,rehearsalMarkets:Object.keys(held.pairs),completedRehearsalJobs:window.maximumJobs,
    standingInputMarkets:Object.keys(standingInput.pairs),standingBindingSha256:standing.verifiedSha256,
    standingQuoteFit:{poolPair:fit.paddedSufficient,limit1:limits[1].paddedSufficient,limit8:limits[8].paddedSufficient},
    committedWei:held.policy.totalWei,standingSupported:false,noNetwork:true,noCredentials:true,noSend:true,readyToSign:false};
  }
  const {held}=require(path.join(candidates,'c1-band-sizing-2026-11-21/window-b/wide-first/service-runtime.cjs')).openRuntime(args[1]);
  const durable=require(path.join(candidates,'c1-shared-integration-2026-10-05/convergence-durable-adapter.cjs'));
  return {status:'WINDOW_B_C1_RUNTIME_INPUTS_CHECKED',graph:held.graph,core:held.core,
   marketCount:Object.keys(held.pairs).length,committedWei:held.policy.totalWei,
   ownerRecoveryFloorWei:String(durable.replacementOwnerReserveFloor(held.policy)),
   noNetwork:true,noCredentials:true,noSend:true,readyToSign:false};
 }
 if(Array.isArray(args)&&args.length===1&&args[0]==='--check-replacement'){
  assert(process.env.CW_LOW_RPC_TRIAL===undefined,'C1_REPLACEMENT_CHECK_SELECTOR');
  return require(path.join(candidates,'c1-band-sizing-2026-11-21/window-b/service-runtime.cjs'))
   .main('--check','a1c0f2c1017906ac8bbe1d447282aacccbc2e8738b2afac0316020d6352a9f99');
 }
 if(Array.isArray(args)&&args.length===2&&args[0]==='--rehearse')return runRehearsal(args[1]);
 if(!Array.isArray(args)||args.length!==1||!MODES.includes(args[0]))throw Error('CURRENT_DEX_C1_USAGE');
 return loadRuntime().main(args[0]);
}
function failure(error){
 const guard=/^[A-Z][A-Z0-9_]+$/.test(error?.message??'')?error.message:'CURRENT_C1_REJECTED';
 const code=/^[A-Z][A-Z0-9_]+$/.test(error?.code??'')?error.code:null;
 return runtime?runtime.failure(error):{status:'CURRENT_C1_STOP',guard,code,
  noAutomaticRetry:true,reconcileSavedJournalBeforeRetry:true};
}
module.exports={main,rehearsal,runRehearsal,runStanding,failure};
if(require.main===module)main(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(error=>{
 console.error(JSON.stringify(failure(error)));
 process.exitCode=1;
});
