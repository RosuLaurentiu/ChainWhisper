'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const topup=require('./current-dex-matching-topup.cjs'),P=topup.POLICY,H='0x'+'ab'.repeat(32),B='0x'+'cd'.repeat(32),hex=n=>'0x'+BigInt(n).toString(16);
function fixture(options={},profile=topup){
 const P=profile.POLICY;
 let clock=1793966400000,sent=false,signs=0,locks=0,closed=0;const calls=[],rows=[];let intent=null;
 const initial={donor:2000000000000000000n,recipient:32686810640491417n,keeper:1000000000000000000n,c1:100000000000000000n,...options.balances};
 const a={schema:'CURRENT_DEX_MATCHING_TOPUP_APPROVAL_V1',acceptedBy:'root',live:true,policy:P,sources:profile.sources(),issuedAt:new Date(clock).toISOString(),expiresAt:new Date(clock+300000).toISOString()};
 const store={caseId:'dummy-case',approval:()=>a,intent:()=>intent,create:value=>{assert.equal(intent,null);intent=structuredClone(value);},rows:()=>structuredClone(rows),append:row=>rows.push(structuredClone(row))};
 const role=address=>Object.keys(initial).find(k=>P[k].toLowerCase()===address.toLowerCase()),fee=21000n*BigInt(P.gasPriceWei);
 const transaction={hash:H,from:P.donor,to:P.recipient,input:'0x',value:hex(P.valueWei),nonce:'0x7',gas:hex(P.gasLimit),gasPrice:hex(P.gasPriceWei),type:'0x0',blockHash:B,blockNumber:'0x11',transactionIndex:'0x0'};
 const io={withHolds:async(_mode,_store,fn)=>{locks+=2;return fn();},sign:async tx=>{signs++;assert.equal(tx.value,BigInt(P.valueWei));if(options.signError)throw Error('DUMMY_SIGN_FAILURE');if(options.drift)initial.donor-=1n;return 'DUMMY_SIGNED_BYTES';},decode:()=>({from:P.donor,to:P.recipient,data:'0x',value:BigInt(P.valueWei),chainId:7082400n,nonce:7,gasLimit:30000n,gasPrice:50000000n,type:0,hash:H,...options.signed}),hash:()=>H,pause:async()=>{clock+=1000;},close:()=>{closed++;},rpc:async(method,args)=>{
 calls.push(method);if(options.rpcError===method)throw Error('DUMMY_RPC_FAILURE');
 if(method==='eth_chainId')return options.chain??'0x6c11a0';
 if(method==='eth_getBlockByNumber'){if(args[0]==='0x0')return{hash:options.genesis??P.genesis};const number=sent?'0x11':'0x10';return{number,hash:B,timestamp:hex(Math.floor((args[0]==='0x11'?1793966400000:clock)/1000)),gasLimit:hex(120000000),baseFeePerGas:options.baseFee??'0x9',transactions:sent?[H]:[]};}
 if(method==='eth_gasPrice')return hex(options.fee??50000000);
 if(method==='eth_getCode')return options.code??'0x';
 if(method==='eth_getTransactionCount'){const r=role(args[0]);return hex(r==='donor'?7+(sent?1:0):3);}
 if(method==='eth_getBalance'){const r=role(args[0]);return hex(initial[r]+(sent?(r==='donor'?-(options.minedFailure?0n:BigInt(P.valueWei))-fee:r==='recipient'?(options.minedFailure?0n:BigInt(P.valueWei)):0n):0n)+(sent&&options.accountingDrift&&r==='recipient'?1n:0n));}
 if(method==='eth_estimateGas')return hex(options.estimate??21000);
 if(method==='eth_sendRawTransaction'){assert.equal(args[0],'DUMMY_SIGNED_BYTES');sent=true;if(options.uncertain)throw Error('DUMMY_UNCERTAIN_SEND');return H;}
 if(method==='eth_getTransactionReceipt')return sent&&!options.pending?{transactionHash:H,blockHash:B,blockNumber:'0x11',transactionIndex:'0x0',status:options.minedFailure?'0x0':'0x1',type:'0x0',gasUsed:hex(21000),effectiveGasPrice:hex(P.gasPriceWei)}:null;
 if(method==='eth_getTransactionByHash')return transaction;
 assert.fail(method);
 }};
 return{profile,store,io,a,rows,calls,now:()=>clock,expire:()=>{clock+=400000;},signs:()=>signs,locks:()=>locks,closed:()=>closed};
}
const run=(f,mode='--run')=>f.profile.main([mode,'unused'],f);
const verification=require('./current-dex-matching-verification-topup.cjs');
test('fixed C1 two-COTI profile binds Carol and retains all existing limits',async()=>{
 const profile=topup.createC1TwoCotiProfile(),r=await profile.main(['--check']);
 assert.deepEqual(profile.POLICY,{...P,recipient:P.c1,valueWei:'2000000000000000000',recipientMinimumWei:P.c1MinimumWei});assert(Object.isFrozen(profile.POLICY));assert(r.noNetwork&&r.noCredentials&&r.noSign&&r.noSend&&r.liveHeld);assert.equal(topup.POLICY.recipient,P.recipient);assert.throws(()=>topup.createC1TwoCotiProfile({recipient:P.donor}),/TOPUP_PROFILE_OPTIONS/);
});
test('fixed C1 two-COTI profile funds the low recipient and C1 alias with exact accounting',async()=>{
 const profile=topup.createC1TwoCotiProfile(),f=fixture({balances:{donor:4000000000000000000n,recipient:1n,c1:1n}},profile),r=await run(f);
 assert.equal(r.valueWei,'2000000000000000000');assert.equal(r.after.actors.donor.balanceWei,'1999998950000000000');assert.equal(r.after.actors.recipient.balanceWei,'2000000000000000001');assert.deepEqual(r.after.actors.c1,r.after.actors.recipient);assert.equal(r.actualFeeWei,'1050000000000');assert.equal(f.signs(),1);assert.equal(f.calls.filter(m=>m==='eth_sendRawTransaction').length,1);await assert.rejects(run(f),/TOPUP_ALREADY_ATTEMPTED/);
 const low=fixture({balances:{donor:2500000000000000000n,recipient:1n,c1:1n}},profile);await assert.rejects(run(low),/TOPUP_FULL_WINDOW_DONOR/);assert.equal(low.signs(),0);
 const unfunded=fixture({balances:{donor:4000000000000000000n,recipient:1n,c1:1n}},profile);await assert.rejects(run(unfunded,'--admit'),/TOPUP_FULL_WINDOW_RECIPIENT/);assert.equal(unfunded.signs(),0);
});
test('fixed C1 two-COTI profile rejects policy drift and reconciles uncertainty without resend',async()=>{
 const profile=topup.createC1TwoCotiProfile();for(const policy of [P,{...profile.POLICY,recipient:P.recipient},{...profile.POLICY,c1MinimumWei:'0'},{...profile.POLICY,valueWei:'2000000000000000001'}]){const f=fixture({},profile);f.a.policy=policy;await assert.rejects(run(f),/TOPUP_POLICY/);assert.equal(f.calls.length,0);assert.equal(f.signs(),0);}
 const f=fixture({balances:{donor:4000000000000000000n,recipient:1n,c1:1n},uncertain:true},profile);await assert.rejects(run(f),/DUMMY_UNCERTAIN_SEND/);await assert.rejects(run(f),/TOPUP_ALREADY_ATTEMPTED/);f.expire();const r=await run(f,'--reconcile');assert.equal(r.valueWei,'2000000000000000000');assert.deepEqual(r.after.actors.c1,r.after.actors.recipient);assert.equal(f.signs(),1);assert.equal(f.calls.filter(m=>m==='eth_sendRawTransaction').length,1);
});
test('five-COTI funding binds only the new approved value',async()=>{
 const five=require('./current-dex-matching-five-coti-topup.cjs');assert.deepEqual(five.POLICY,{...verification.POLICY,valueWei:'5000000000000000000'});assert(Object.isFrozen(five.POLICY));
 const f=fixture({balances:{donor:10000000000000000000n}},five);f.a.policy=verification.POLICY;await assert.rejects(run(f),/TOPUP_POLICY/);assert.equal(f.calls.length,0);assert.equal(f.signs(),0);
});
test('five-COTI funding delivers exactly once and preserves both balance deltas',async()=>{
 const five=require('./current-dex-matching-five-coti-topup.cjs'),f=fixture({balances:{donor:10000000000000000000n,recipient:11803919000000000n}},five),r=await run(f);
 assert.equal(r.valueWei,'5000000000000000000');assert.equal(r.after.actors.recipient.balanceWei,'5011803919000000000');assert.equal(r.after.actors.donor.balanceWei,'4999998950000000000');assert.equal(r.actualFeeWei,'1050000000000');
 await assert.rejects(run(f),/TOPUP_ALREADY_ATTEMPTED/);assert.equal(f.signs(),1);assert.equal(f.calls.filter(m=>m==='eth_sendRawTransaction').length,1);
});
test('five-COTI funding retains uncertain-send no-resend and rejects reserve/accounting failures',async()=>{
 const five=require('./current-dex-matching-five-coti-topup.cjs'),f=fixture({balances:{donor:10000000000000000000n},uncertain:true},five);await assert.rejects(run(f),/DUMMY_UNCERTAIN_SEND/);f.expire();assert.equal((await run(f,'--reconcile')).valueWei,'5000000000000000000');assert.equal(f.signs(),1);assert.equal(f.calls.filter(m=>m==='eth_sendRawTransaction').length,1);
 const low=fixture({balances:{donor:5500000000000000000n}},five);await assert.rejects(run(low),/TOPUP_FULL_WINDOW_DONOR/);assert.equal(low.signs(),0);
 const bad=fixture({balances:{donor:10000000000000000000n},accountingDrift:true},five);await assert.rejects(run(bad),/TOPUP_EXACT_RECIPIENT/);assert(!bad.rows.some(r=>r.kind==='verified'));
});
test('verification top-up binds the exact approved amount and preserves all other limits',async()=>{
 assert.deepEqual(verification.POLICY,{...P,valueWei:'479816070459508583',recipientMinimumWei:'500000000000000000'});
 assert(Object.isFrozen(verification.POLICY));const f=fixture({},verification);f.a.policy=P;
 await assert.rejects(run(f),/TOPUP_POLICY/);assert.equal(f.calls.length,0);assert.equal(f.signs(),0);
});
test('verification top-up delivers exact amount once and preserves accounting and no-resend',async()=>{
 const f=fixture({balances:{recipient:20183929540491417n}},verification),r=await run(f);
 assert.equal(r.valueWei,'479816070459508583');assert.equal(r.after.actors.recipient.balanceWei,'500000000000000000');
 assert.equal(r.actualFeeWei,'1050000000000');assert.equal(f.signs(),1);assert.equal(f.calls.filter(x=>x==='eth_sendRawTransaction').length,1);
 await assert.rejects(run(f),/TOPUP_ALREADY_ATTEMPTED/);
});
test('verification top-up preserves uncertain-send reconciliation and stops on RPC or accounting failure',async()=>{
 const f=fixture({uncertain:true},verification);await assert.rejects(run(f),/DUMMY_UNCERTAIN_SEND/);
 f.expire();assert.equal((await run(f,'--reconcile')).valueWei,'479816070459508583');assert.equal(f.signs(),1);assert.equal(f.calls.filter(x=>x==='eth_sendRawTransaction').length,1);
 const read=fixture({rpcError:'eth_getBalance'},verification);await assert.rejects(run(read),/DUMMY_RPC_FAILURE/);assert.equal(read.signs(),0);
 const accounting=fixture({accountingDrift:true},verification);await assert.rejects(run(accounting),/TOPUP_EXACT_RECIPIENT/);assert(!accounting.rows.some(x=>x.kind==='verified'));
});
test('fixed two-COTI profile preserves other limits and prepares without authority',async()=>{
 const profile=topup.createTwoCotiProfile(),r=await profile.main(['--check']);
 assert.deepEqual(profile.POLICY,{...P,valueWei:'2000000000000000000'});assert(Object.isFrozen(profile.POLICY));
 assert(r.noNetwork&&r.noCredentials&&r.noSign&&r.noSend&&r.liveHeld);assert.equal(r.policy,profile.POLICY);
 assert.equal(topup.POLICY.valueWei,'250000000000000000');
 assert.throws(()=>topup.createTwoCotiProfile({valueWei:'1'}),/TOPUP_PROFILE_OPTIONS/);
});
test('fixed two-COTI transfer accounts exact delivery and cannot start twice or resend',async()=>{
 const f=fixture({balances:{donor:4000000000000000000n},uncertain:true},topup.createTwoCotiProfile());
 await assert.rejects(run(f),/DUMMY_UNCERTAIN_SEND/);await assert.rejects(run(f),/TOPUP_ALREADY_ATTEMPTED/);f.expire();const r=await run(f,'--reconcile');
 assert.equal(r.valueWei,'2000000000000000000');assert.equal(r.actualFeeWei,'1050000000000');
 assert.equal(r.after.actors.donor.balanceWei,'1999998950000000000');assert.equal(r.after.actors.recipient.balanceWei,'2032686810640491417');
 await assert.rejects(run(f),/TOPUP_EXPIRED|TOPUP_ALREADY_ATTEMPTED/);assert.equal(f.signs(),1);assert.equal(f.calls.filter(x=>x==='eth_sendRawTransaction').length,1);
 assert.deepEqual(f.rows.map(x=>x.kind),['signing-start','signed','broadcast-start','verified']);
});
test('fixed two-COTI profile rejects changed or cross-profile policies before any IO',async()=>{
 const profile=topup.createTwoCotiProfile();
 for(const policy of [P,{...profile.POLICY,valueWei:'2000000000000000001'},{...profile.POLICY,maximumFeeWei:'1500000000001'}]){
  const f=fixture({balances:{donor:4000000000000000000n}},profile);f.a.policy=policy;
  await assert.rejects(run(f),/TOPUP_POLICY/);assert.equal(f.calls.length,0);assert.equal(f.signs(),0);assert.equal(f.locks(),0);
 }
 const legacy=fixture();legacy.a.policy=profile.POLICY;await assert.rejects(run(legacy),/TOPUP_POLICY/);assert.equal(legacy.calls.length,0);
});
test('default check has no network, credentials or write authority',async()=>{const r=await topup.main([]);assert(r.noNetwork&&r.noCredentials&&r.noSign&&r.noSend&&r.liveHeld);});
test('fixed transfer checks complete window and exact canonical accounting',async()=>{const f=fixture(),r=await run(f);assert.equal(r.status,'CURRENT_DEX_MATCHING_TOPUP_ACCOUNTED');assert.equal(r.valueWei,P.valueWei);assert.equal(r.actualFeeWei,'1050000000000');assert.equal(f.signs(),1);assert.equal(f.calls.filter(x=>x==='eth_sendRawTransaction').length,1);assert.equal(f.locks(),2);assert.equal(f.closed(),1);assert.deepEqual(f.rows.map(x=>x.kind),['signing-start','signed','broadcast-start','broadcast-returned','verified']);await assert.rejects(run(f),/TOPUP_ALREADY_ATTEMPTED/);});
for(const [name,options,guard]of [['chain',{chain:'0x1'},'TOPUP_CHAIN'],['genesis',{genesis:H},'TOPUP_GENESIS'],['EOA',{code:'0x01'},'TOPUP_EOA'],['base fee',{baseFee:hex(50000001)},'TOPUP_FEE'],['negative base fee',{baseFee:'-1'},'TOPUP_FEE'],['malformed base fee',{baseFee:'invalid'},'TOPUP_FEE'],['zero recommendation',{fee:0},'TOPUP_FEE'],['fit',{estimate:30001},'TOPUP_FIT'],['donor',{balances:{donor:870000000000000000n}},'TOPUP_FULL_WINDOW_DONOR'],['recipient',{balances:{recipient:1n}},'TOPUP_FULL_WINDOW_RECIPIENT'],['keeper',{balances:{keeper:1n}},'TOPUP_FULL_WINDOW_KEEPER'],['C1',{balances:{c1:1n}},'TOPUP_FULL_WINDOW_C1']])test('pre-sign admission rejects '+name,async()=>{const f=fixture(options);await assert.rejects(run(f),new RegExp(guard));assert.equal(f.signs(),0);assert(!f.calls.includes('eth_sendRawTransaction'));});

test('a high RPC recommendation does not reprice the fixed-fee transfer',async()=>{const f=fixture({fee:1000000007,baseFee:'0x7'}),r=await run(f);assert.equal(r.status,'CURRENT_DEX_MATCHING_TOPUP_ACCOUNTED');assert.equal(r.actualFeeWei,'1050000000000');assert.equal(f.signs(),1);assert.equal(f.rows.find(row=>row.kind==='verified').actualFeeWei,'1050000000000');});

test('a high RPC recommendation permits read-only full-window admission without signing',async()=>{const f=fixture({fee:1000000007,baseFee:'0x7',balances:{recipient:300000000000000000n}}),r=await run(f,'--admit');assert.equal(r.status,'CURRENT_DEX_FULL_WINDOW_ADMITTED');assert.equal(f.signs(),0);assert.equal(f.rows.length,0);assert(!f.calls.includes('eth_estimateGas'));assert(!f.calls.includes('eth_sendRawTransaction'));});
for(const [field,value]of [['to',P.donor],['value',1n],['gasPrice',50000001n]])test('signed identity rejects '+field,async()=>{const f=fixture({signed:{[field]:value}});await assert.rejects(run(f),/TOPUP_SIGNED_IDENTITY/);assert(!f.calls.includes('eth_sendRawTransaction'));assert.equal(f.rows[0].kind,'signing-start');});
test('balance drift after signing stops before broadcast and never signs again',async()=>{const f=fixture({drift:true});await assert.rejects(run(f),/TOPUP_STATE_DRIFT/);assert(!f.calls.includes('eth_sendRawTransaction'));assert(f.rows.some(r=>r.kind==='signed'));await assert.rejects(run(f),/TOPUP_ALREADY_ATTEMPTED/);});
test('uncertain send reconciles the known hash after expiry without resend',async()=>{const f=fixture({uncertain:true});await assert.rejects(run(f),/DUMMY_UNCERTAIN_SEND/);f.expire();const r=await run(f,'--reconcile');assert.equal(r.status,'CURRENT_DEX_MATCHING_TOPUP_ACCOUNTED');assert.equal(f.signs(),1);assert.equal(f.calls.filter(x=>x==='eth_sendRawTransaction').length,1);});
test('unknown signing remains held with no reconciliation send',async()=>{const f=fixture({signError:true});await assert.rejects(run(f),/DUMMY_SIGN_FAILURE/);await assert.rejects(run(f,'--reconcile'),/TOPUP_UNKNOWN_SIGN_HOLD/);assert(!f.calls.includes('eth_sendRawTransaction'));});
test('expired approval and source drift reject before network or signing',async()=>{for(const change of [f=>f.expire(),f=>{f.a.sources={};},f=>{f.a.policy={...P,valueWei:'1'};}]){const f=fixture();change(f);await assert.rejects(run(f),/TOPUP_EXPIRED|TOPUP_SOURCE_DRIFT|TOPUP_POLICY/);assert.equal(f.calls.length,0);assert.equal(f.signs(),0);}});
test('receipt accounting mismatch retains known hash without completion',async()=>{const f=fixture({accountingDrift:true});await assert.rejects(run(f),/TOPUP_EXACT_RECIPIENT/);assert(!f.rows.some(r=>r.kind==='verified'));assert.equal(f.signs(),1);});
test('whole-window read admission has no sign or send path',async()=>{const f=fixture({balances:{recipient:300000000000000000n}}),r=await run(f,'--admit');assert.equal(r.status,'CURRENT_DEX_FULL_WINDOW_ADMITTED');assert.equal(f.signs(),0);assert.equal(f.rows.length,0);assert(!f.calls.includes('eth_estimateGas'));assert(!f.calls.includes('eth_sendRawTransaction'));});

test('mined failure accounts fee without delivery and cannot resend',async()=>{const f=fixture({minedFailure:true}),r=await run(f);assert.equal(r.status,'CURRENT_DEX_MATCHING_TOPUP_FAILED_ACCOUNTED');assert.equal(r.valueWei,'0');assert.equal(r.actualFeeWei,'1050000000000');await assert.rejects(run(f),/TOPUP_ALREADY_ATTEMPTED/);});
test('full-window admission cannot skip an unresolved top-up journal',async()=>{const f=fixture({uncertain:true});await assert.rejects(run(f),/DUMMY_UNCERTAIN_SEND/);await assert.rejects(run(f,'--admit'),/TOPUP_UNRESOLVED_HOLD/);});

const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const shared=require('../../ChainWhisper Contracts V2/validation/candidates/concentrated-creation-fit-2026-09-20/integrated-testnet-entry.cjs');
function retainedFixture(t,options={}){const f=fixture(options),chain='topup-local-test-'+randomUUID(),actors=['0x0000000000000000000000000000000000000111','0x0000000000000000000000000000000000000222'],files=actors.map(actor=>shared.senderLockPath(chain,actor));delete f.io.withHolds;f.io.holdOptions={lockPath:(_chain,actor)=>files[actor===P.donor?0:1],alive:()=>false,pid:123456};t.after(()=>{for(const file of files){if(fs.existsSync(file))fs.unlinkSync(file);for(const name of fs.readdirSync(os.tmpdir()).filter(name=>name.startsWith(path.basename(file)+'.matching-topup-adopt-')))fs.unlinkSync(path.join(os.tmpdir(),name));}});return{...f,chain,actors,files};}
test('unresolved send retains both shared sender holds and ordinary senders fail closed',async t=>{const f=retainedFixture(t,{uncertain:true});await assert.rejects(run(f),/DUMMY_UNCERTAIN_SEND/);for(let i=0;i<2;i++){assert(fs.existsSync(f.files[i]));await assert.rejects(shared.withSenderLock(f.chain,f.actors[i],()=>assert.fail('foreign sender admitted')),/TESTNET_ENTRY_SENDER_LOCKED/);}const prior=f.files.map(file=>fs.readFileSync(file));f.io.holdOptions.alive=()=>true;await assert.rejects(run(f,'--reconcile'),/TOPUP_MUTEX_PROCESS_ALIVE/);f.files.forEach((file,i)=>assert(fs.readFileSync(file).equals(prior[i])));f.io.holdOptions.alive=()=>false;f.expire();const result=await run(f,'--reconcile');assert.equal(result.status,'CURRENT_DEX_MATCHING_TOPUP_ACCOUNTED');assert(f.files.every(file=>!fs.existsSync(file)));assert.equal(f.signs(),1);assert.equal(f.calls.filter(x=>x==='eth_sendRawTransaction').length,1);});
test('unknown signing retains global holds and cannot adopt without a known hash',async t=>{const f=retainedFixture(t,{signError:true});await assert.rejects(run(f),/DUMMY_SIGN_FAILURE/);assert(f.files.every(fs.existsSync));await assert.rejects(run(f,'--reconcile'),/TOPUP_UNKNOWN_SIGN_HOLD/);assert(f.files.every(fs.existsSync));});
test('pre-sign rejection and verified mined failure release only owned global holds',async t=>{const a=retainedFixture(t,{balances:{keeper:1n}});await assert.rejects(run(a),/TOPUP_FULL_WINDOW_KEEPER/);assert(a.files.every(file=>!fs.existsSync(file)));const b=retainedFixture(t,{minedFailure:true});const result=await run(b);assert.equal(result.status,'CURRENT_DEX_MATCHING_TOPUP_FAILED_ACCOUNTED');assert(b.files.every(file=>!fs.existsSync(file)));});
test('reconciliation refuses foreign hold binding and retains every unresolved sender hold',async t=>{const f=retainedFixture(t,{uncertain:true});await assert.rejects(run(f),/DUMMY_UNCERTAIN_SEND/);const record=JSON.parse(fs.readFileSync(f.files[0]));record.binding.caseId='another-case';fs.writeFileSync(f.files[0],JSON.stringify(record));const bytes=fs.readFileSync(f.files[0]);await assert.rejects(run(f,'--reconcile'),/TOPUP_MUTEX_BINDING/);assert(fs.readFileSync(f.files[0]).equals(bytes));assert(fs.existsSync(f.files[1]));});
test('matching stale sender recovery rejects the foreign top-up hold instead of deleting it',async t=>{const f=retainedFixture(t,{uncertain:true});await assert.rejects(run(f),/DUMMY_UNCERTAIN_SEND/);const matching=require('../../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/matching-service/runtime.cjs'),crypto=require('node:crypto');const target=matching.files('session-1'),manifest={chainId:f.chain,actors:{maker:f.actors[1]}},token={pid:123456,manifest:crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex')},read=fs.readFileSync,stat=fs.lstatSync;const replacements=new Map([[target.manifest,Buffer.from(JSON.stringify(manifest))],[target.lock,Buffer.from(JSON.stringify(token))]]);t.mock.method(fs,'readFileSync',(file,...args)=>replacements.has(file)?(args[0]==='utf8'?replacements.get(file).toString():replacements.get(file)):read(file,...args));t.mock.method(fs,'lstatSync',file=>replacements.has(file)?{isFile:()=>true,isSymbolicLink:()=>false,nlink:1,size:replacements.get(file).length}:stat(file));await assert.rejects(async()=>matching.recoverDeadRunner(target,manifest,()=>false),/MATCH_WINDOW_SENDER_LOCK_FILE/);assert(f.files.every(fs.existsSync));});
