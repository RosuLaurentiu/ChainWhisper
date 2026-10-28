'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const runtime=require(path.resolve(__dirname,'../../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/matching-service/runtime.cjs'));
const app=require('./current-dex-matching.cjs');
test('App matching commands use the maintained runtime without user-selected files',async t=>{
 const calls=[];t.mock.method(runtime,'main',async mode=>{calls.push(mode);return{mode};});
 for(const mode of ['--check','--start','--once','--reconcile','--inspect'])assert.deepEqual(await app.main([mode]),{mode});
 assert.deepEqual(calls,['--check','--start','--once','--reconcile','--inspect']);
 for(const args of [[],['--retry'],['--once','session-1']])await assert.rejects(app.main(args),/CURRENT_DEX_MATCHING_USAGE/);
});
test('package exposes normal matching startup, one-call check, status and recovery',()=>{
 const scripts=require('../package.json').scripts;
 for(const[name,mode]of [['check','check'],['dev','start'],['once','once'],['status','inspect'],['reconcile','reconcile']]){
  const preload=['check','inspect'].includes(mode)?'':'--require ./scripts/current-dex-rpc-pacing.cjs ';
  assert.equal(scripts[name+':matching'],'node '+preload+'scripts/current-dex-matching.cjs --'+mode);
 }
});

test('service failures expose a bounded code and source location without request data',()=>{
 const error=Object.assign(new Error('private request must stay local'),{code:'NETWORK_ERROR',cause:{code:'EPERM'},stack:'Error: private request\n at Object.main (C:/workspace/runtime.cjs:117:2)'});
 const report=app.failure(error);assert.equal(report.guard,'CURRENT_DEX_MATCHING_REJECTED');assert.equal(report.code,'NETWORK_ERROR');assert.equal(report.causeCode,'EPERM');assert.deepEqual(report.locations,['runtime.cjs:117:2']);assert(!JSON.stringify(report).includes('private request'));
});
