'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const candidates = '../../ChainWhisper Contracts V2/validation/candidates/';
const root = candidates+'c1-band-sizing-2026-11-21/window-b/';
const predecessor = require(root+'convergence/service-runtime.cjs');
const {runService} = require(root+'convergence/service-execution.cjs');
const {graph:predecessorGraph,checkSenderLock} = require(root+'convergence-service-state.cjs');
const {validateBundle} = require(candidates+'c1-shared-integration-2026-10-05/convergence-connector.cjs');
const {TIMING} = require(candidates+'c1-shared-integration-2026-10-05/tier-schedule-policy.cjs');
const {CONFIG,checkRehearsalStopRecords} = require('./current-dex-service-watchdog.cjs');
const {bindC1Broadcast} = require('./current-dex-rpc-pacing.cjs');

const reports = path.resolve(__dirname,'../reports');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = /^[0-9a-f]{64}$/;

function readFile(file,limit) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && stat.nlink === 1 && stat.size <= limit && fs.realpathSync.native(file) === file,'C1_REHEARSAL_FILE');
  const bytes = fs.readFileSync(file);
  assert(bytes.length <= limit,'C1_REHEARSAL_FILE');
  return bytes;
}

function rehearsal(directory,period,now=Date.now(),reportsRoot=reports) {
  const parent = path.dirname(directory);
  assert(path.isAbsolute(reportsRoot) && [reportsRoot,path.join(reportsRoot,'server-beta-runs')].includes(parent) &&
    fs.realpathSync.native(directory) === directory,'C1_REHEARSAL_DIRECTORY');
  const approvalBytes = readFile(path.join(directory,'c1-rehearsal-approval.json'),32768);
  const approval = JSON.parse(approvalBytes), approvalSha256 = sha(approvalBytes);
  const operator = CONFIG.actors.c1.address, binding = period.replacementBindingSha256;
  const wide = binding==='6f6c3efd3b6915343f9281348a1dc313cee7fe99727fac50144ec44c364e5d5f';
  const sizing = binding==='0f8979593242e8aa85fdda878f3967c89e60a460eef84b859e84858f0fdffbf9';
  const selected = sizing?require(root+'../sizing-rehearsal-runtime.cjs'):
    wide?require(root+'wide-first/service-runtime.cjs'):predecessor;
  const graph = sizing||wide?selected.BINDING.graph:predecessorGraph;
  assert(approvalSha256 === period.c1RehearsalSha256 && approval.approvedByOwner === true &&
    approval.schema === 'CHAINWHISPER_C1_REHEARSAL_APPROVAL_V1' && approval.graph === graph &&
    binding === selected.verifiedSha256 && approval.bindingSha256 === binding && approval.chainId === '7082400' &&
    approval.signer === 'systemd-c1' && approval.operator === operator && approval.runName === path.basename(directory) &&
    approval.periodApprovalSha256 === period.approvalSha256 && approval.runtimeManifestSha256 === period.runtimeManifestSha256 &&
    approval.maximumCommittedWei === TIMING.totalWei && digest.test(approval.stagedRuntimeManifestSha256 ?? '') &&
    path.isAbsolute(approval.stagedRuntimeRoot ?? ''),'C1_REHEARSAL_APPROVAL_SCOPE');
  assert(period.graph === CONFIG.graph && period.mode === 'standing','C1_REHEARSAL_PRIOR_GROUP');
  const {issuedAt,expiresAt,priorRun,market,quoteModel,continuation} = approval, seconds = Math.floor(now/1000);
  assert(Number.isSafeInteger(issuedAt) && Number.isSafeInteger(expiresAt) && issuedAt <= seconds && seconds < expiresAt &&
    expiresAt-issuedAt <= 1800 && (period.expiresAt === null || expiresAt*1000 <= period.expiresAt),'C1_REHEARSAL_APPROVAL_TIME');
  assert(/^server-beta-[a-z0-9-]{1,120}$/.test(priorRun ?? '') && priorRun !== approval.runName,'C1_REHEARSAL_PRIOR_RUN');
  assert(approval.sequence === undefined,'C1_REHEARSAL_SEQUENCE_REQUIRES_CONTINUATION');
  checkSenderLock(approval.senderLock);
  if(wide||sizing)assert.equal(approval.senderLock.directory,'/var/lib/server-dashboard/chainwhisper-beta/c1-sender-locks',
    'C1_REHEARSAL_PERSISTENT_SENDER_LOCK');
  const prior = path.join(parent,priorRun);
  assert(fs.existsSync(path.join(prior,'stop-request.json')),'C1_REHEARSAL_PRIOR_GROUP');
  const proofBytes = readFile(path.join(directory,'STOPPED_SERVICES_RECONCILED.json'),32768);
  const proof = JSON.parse(proofBytes);
  const {carry:priorSpentFeeWei} = checkRehearsalStopRecords({approval,proofBytes,
    groupBytes:readFile(path.join(prior,'group.json'),8*1024*1024),now});
  assert(period.priorSpentFeeWei === priorSpentFeeWei,'C1_REHEARSAL_PRIOR_FEES');
  const bundle = validateBundle(JSON.parse(readFile(path.join(directory,'c1-rehearsal-bundle.json'),2*1024*1024)));
  assert(bundle.hash === approval.bundleHash && bundle.manifest.replacementBindingSha256 === binding &&
    bundle.manifest.binding.graph===graph&&bundle.manifest.operator === operator &&
    bundle.manifest.policy.now === issuedAt,'C1_REHEARSAL_BUNDLE');
  assert.deepEqual(bundle.senderLock,approval.senderLock,'C1_REHEARSAL_SENDER_LOCK');
  assert(typeof market === 'string' && Object.hasOwn(bundle.manifest.pairs,market),'C1_REHEARSAL_MARKET_SCOPE');
  if(sizing)assert(market==='2' && approval.operatorOnly===true && quoteModel,'C1_SIZING_REHEARSAL_SCOPE');
  if(approval.operatorOnly!==undefined){
    assert(approval.operatorOnly===true&&(wide||sizing)&&['1','2'].includes(market)&&quoteModel!==undefined,
      'C1_REHEARSAL_OPERATOR_ONLY_SCOPE');
    assert(continuation===undefined?approval.trigger!==undefined:market==='2'&&approval.trigger===undefined,
      'C1_REHEARSAL_OPERATOR_ONLY_SCOPE');
  }
  if (approval.trigger !== undefined) {
    const {hash,blockHash,blockNumber,timestamp}=approval.trigger;
    const quantity=/^(0|[1-9][0-9]*)$/;
    assert(continuation===undefined && quoteModel && (market==='1'||approval.operatorOnly===true&&market==='2') &&
      /^0x[0-9a-f]{64}$/.test(hash??'') &&
      /^0x[0-9a-f]{64}$/.test(blockHash??'') &&
      typeof blockNumber==='string' && quantity.test(blockNumber) && BigInt(blockNumber)===BigInt(bundle.discovery.fromBlock) &&
      typeof timestamp==='string' && quantity.test(timestamp) && BigInt(timestamp)<BigInt(issuedAt) &&
      BigInt(issuedAt)-BigInt(timestamp)<=5400n,'C1_REHEARSAL_TRIGGER_SCOPE');
  }
  if(quoteModel?.fullPage!==undefined||approval.trigger?.kind!==undefined){
    assert(quoteModel?.fullPage===true&&['full-page-order','full-page-expiry'].includes(approval.trigger?.kind)&&wide&&market==='1'&&
      approval.operatorOnly===true&&continuation===undefined,'C1_REHEARSAL_FULL_PAGE_SCOPE');
    if(approval.trigger.kind==='full-page-expiry')
      assert(approval.trigger.operatorNonceAfter===quoteModel.initialOperatorNonce,'C1_REHEARSAL_FULL_PAGE_EXPIRY_NONCE');
  }
  if (continuation !== undefined) assert(digest.test(continuation.continuationSha256 ?? '') &&
    [2,3].includes(continuation.windowOrdinal) && /^(0|[1-9][0-9]*)$/.test(continuation.expectedOperatorNonce ?? '') &&
    continuation.cumulativeCommitmentWei === String(BigInt(TIMING.totalWei)*BigInt(continuation.windowOrdinal)),
    'C1_REHEARSAL_CONTINUATION_SCOPE');
  if (quoteModel !== undefined) {
    const {reportSetSha256}=sizing?selected:require(root+(wide?'wide-first/quote-fit.cjs':'convergence-quote-fit.cjs'));
    assert(['1','2'].includes(market) && quoteModel.market === market && quoteModel.reportSetSha256 === reportSetSha256 &&
      /^(0|[1-9][0-9]*)$/.test(quoteModel.initialOperatorNonce ?? ''),'C1_REHEARSAL_QUOTE_MODEL_SCOPE');
    const predecessor = proof.settledRehearsals?.at(-1);
    assert(continuation !== undefined || quoteModel.initialOperatorNonce === (predecessor?.toNonce ?? proof.baselineNonces.c1),
      'C1_REHEARSAL_QUOTE_MODEL_NONCE');
  }
  return {graph,replacementBindingSha256:binding,feeLimitWei:TIMING.totalWei,approval,approvalSha256,bundle,priorSpentFeeWei,
    priorApprovalSha256:approval.periodApprovalSha256};
}

function waitForParent(peer,scope) {
  return new Promise((resolve,reject) => {
    const finish = error => {
      clearTimeout(timer);
      peer.removeListener('message',message);
      peer.removeListener('disconnect',disconnect);
      if (error) reject(error); else resolve();
    };
    const disconnect = () => finish(Error('C1_REHEARSAL_PARENT'));
    const message = value => {
      if (value?.type !== 'CHAINWHISPER_C1_REHEARSAL') return;
      if (value.approvalSha256 !== scope.approvalSha256 || value.pid !== peer.pid ||
        (value.windowOrdinal ?? 1) !== (scope.approval.continuation?.windowOrdinal ?? 1)) disconnect();
      else finish();
    };
    const timer = setTimeout(disconnect,10000);
    peer.on('message',message);
    peer.once('disconnect',disconnect);
  });
}

async function runRehearsal(directory,{peer=process,readPeriod,verifyLaunch,readPredecessor,execute=runService,
  reportsRoot=reports} = {}) {
  assert(typeof verifyLaunch === 'function' && typeof readPredecessor === 'function' &&
    peer.connected && peer.env.CHAINWHISPER_RPC_MANAGED_SERVICE === 'c1' &&
    path.isAbsolute(peer.env.CREDENTIALS_DIRECTORY ?? ''),'C1_REHEARSAL_WORKER_HELD');
  readPeriod ??= require('./current-dex-services.cjs').readServerPeriod;
  directory = path.resolve(directory);
  const period = readPeriod(directory), scope = rehearsal(directory,period,Date.now(),reportsRoot);
  const {approval,bundle,approvalSha256} = scope;
  assert.equal(approval.stagedRuntimeRoot,path.resolve(__dirname,'../..'),'C1_REHEARSAL_STAGE_ROOT');
  let stopped = false;
  const onStop = value => {if (value?.type === 'CHAINWHISPER_SERVICE_STOP') stopped = true;};
  const checkParent = () => assert(peer.connected && !stopped && !fs.existsSync(path.join(directory,'stop-request.json')),
    'C1_REHEARSAL_PARENT');
  function checkLaunch(kind) {
    checkParent();
    assert(verifyLaunch(scope,kind) === true,'C1_REHEARSAL_LAUNCH_HELD');
    if (kind === 'read') return;
    const observed = readPredecessor(scope), state = observed?.state;
    assert(observed?.graph === period.graph && observed.runName === approval.priorRun &&
      observed.runtimeManifestSha256 === approval.priorRuntimeManifestSha256 &&
      observed.groupSha256 === approval.priorGroupSha256 && observed.priorSpentFeeWei === scope.priorSpentFeeWei &&
      state?.noNetwork === true && state.noCredentials === true && state.noSend === true &&
      (state.status === 'CURRENT_C1_NOT_STARTED' || state.status === 'CURRENT_C1_SAVED_STATE' &&
        state.pendingHash === null && state.hashless === false && state.activePair === null && state.halt === null &&
        state.renewalPending === false && !state.transitionRequired && Array.isArray(state.queuedPairs) &&
        state.queuedPairs.length === 0 && (state.parkedPairs ?? []).length === 0),'C1_REHEARSAL_PREDECESSOR_UNRESOLVED');
    assert.deepEqual(readPeriod(directory),period,'C1_REHEARSAL_PERIOD_CHANGED');
    assert.deepEqual(rehearsal(directory,period,Date.now(),reportsRoot),scope,'C1_REHEARSAL_SCOPE_CHANGED');
  }
  peer.on('message',onStop);
  try {
    checkLaunch('start');
    await waitForParent(peer,scope);
    checkLaunch('start');
    const runtime = require(candidates+'limit-fill-history-shared-receipt-2026-10-13/c1-service/runtime.cjs');
    return await execute(bundle,{approvalSha256,expiresAt:approval.expiresAt,senderLock:approval.senderLock,
      rehearsalMarket:approval.market,quoteModel:approval.quoteModel,continuation:approval.continuation,
      rehearsalTrigger:approval.trigger,
      checkPublication(){checkLaunch('publish');return true;},
      queueBroadcast:bindC1Broadcast(peer),
      assertAuthorized(request,kind,action) {
        checkLaunch(kind);
        assert(request.bundleHash === bundle.hash && request.graph === scope.graph && request.chainId === '7082400' &&
          request.bindingSha256 === scope.replacementBindingSha256 && request.operator === approval.operator &&
          request.maximumCommittedWei === TIMING.totalWei && request.approvalSha256 === approvalSha256 &&
          request.issuedAt === approval.issuedAt && request.expiresAt === approval.expiresAt &&
          request.windowOrdinal === approval.continuation?.windowOrdinal &&
          request.continuationSha256 === approval.continuation?.continuationSha256 &&
          request.expectedOperatorNonce === approval.continuation?.expectedOperatorNonce &&
          request.cumulativeCommitmentWei === approval.continuation?.cumulativeCommitmentWei,'C1_REHEARSAL_REQUEST');
        if (kind === 'send' || action !== undefined) assert.equal(action?.pair,approval.market,'C1_REHEARSAL_MARKET_SCOPE');
        return true;
      },
      loadSigner:({provider,operator,assertAuthorized}) => runtime.loadOperator({provider,expected:operator,assertAuthorized,
        envPath:runtime.operatorCredentialPath(peer.env)}),
    });
  } finally {peer.removeListener('message',onStop);}
}

module.exports = {rehearsal,runRehearsal};
