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
});
test('package exposes each normal C1 operator command',()=>{
 const scripts=require('../package.json').scripts;
 for(const[name,mode]of [['check','check'],['read','read'],['dev','start'],['once','once'],['restart','restart'],['reconcile','reconcile'],['status','inspect'],['expire','expire'],['renew','renew']]){
  const preload=['check','inspect'].includes(mode)?'':'--require ./scripts/current-dex-rpc-pacing.cjs ';
  assert.equal(scripts[name+':c1'],'node '+preload+'scripts/current-dex-c1.cjs --'+mode);
 }
});
