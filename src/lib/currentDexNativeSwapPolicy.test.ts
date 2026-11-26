const browserContexts = vi.hoisted(() => new WeakMap<object,{owner:string;guard:()=>void}>());
import { afterEach, describe, expect, it, vi } from 'vitest';
const ownerBeta = vi.hoisted(() => ({ active: false, activation: { activatedAt: 2_000_000_000n, startingNonce: 220, legacyReservationHash:'' } }));
vi.mock('./currentDexOwnerBetaPolicy', async importOriginal => {
  const actual = await importOriginal<typeof import('./currentDexOwnerBetaPolicy')>();
  const history = (await import('./selectedCurrentDexCandidate')).selectCurrentDexCandidate(undefined);
  const selected = (graph:string,owner:string) => ownerBeta.active && graph===history.graph && owner.toLowerCase()===actual.CURRENT_OWNER_BETA.owner;
  return { ...actual, CURRENT_OWNER_BETA: {...actual.CURRENT_OWNER_BETA, graph:history.graph, core:history.core, activation:ownerBeta.activation}, isCurrentOwnerBeta:selected,
    assertCurrentOwnerBetaWindow:(graph:string,owner:string,core:string,chainId:bigint,now:bigint,nonce:number,recovery:boolean,cap:bigint,price:bigint) => {
      if(!selected(graph,owner)||core.toLowerCase()!==history.core||chainId!==7082400n)throw new Error('Owner beta identity changed.');
      actual.checkCurrentOwnerBetaWindow(ownerBeta.activation,now,nonce,recovery,cap,price);
    } };
});
vi.mock('../features/wallet/ownerCotiMetaMaskCapability',()=>({hasCurrentDexBrowserSigner:(signer:object|undefined,owner:string)=>{const row=signer&&browserContexts.get(signer);if(!row||row.owner!==owner.toLowerCase())return false;row.guard();return true;}}));
const bindCurrentDexBrowserSigner=(signer:object,owner:string,_chain:bigint,guard:()=>void)=>{browserContexts.set(signer,{owner:owner.toLowerCase(),guard});};
afterEach(() => { ownerBeta.active=false; });
import { assertCurrentSwapCandidate, assertCurrentNativeSwapIntent, currentNativeSigningBudget, completeCurrentNativeSwapScope, CURRENT_NATIVE_SWAP_LIMITS as limits } from './currentDexNativeSwapPolicy';
import type { CurrentCheapDexPreparedQuote } from './currentDexSubmission';
import { assertCurrentSwapIdentity } from './currentDexNativeSwapPolicy';
import {currentNativeSwapCheckpoint,recordCurrentNativeSwapHash,restoreCurrentNativeSwapCheckpoint,validateCurrentNativeSwapCheckpoint} from './currentDexNativeSwapPolicy';
import { bindCurrentNativeSwapFundingScope, renewCurrentNativeSwapClosedWindow } from './currentDexNativeSwapPolicy';
import { CURRENT_APP_SWAP_OWNER } from './currentDexC1SwapPolicy';
import { selectCurrentDexCandidate } from './selectedCurrentDexCandidate';
import { recoverCurrentPartialLedger } from './currentDexNativeSwapPolicy';
import { CURRENT_APP_PARTIAL_LEDGER_RECOVERY as recovery } from './currentDexC1SwapPolicy';
import { readCurrentDexNativeReload, writeCurrentDexNativeReload } from './currentDexNativeReload';
import { currentOwnerBetaLegacyReservationHash } from './currentDexNativeSwapPolicy';
// The swap policy binds to the selected history candidate. decision-034 removed the earlier descriptors;
// a changed identity stands for them.
const history = selectCurrentDexCandidate(undefined);
const retired = { ...history, graph: '11'.repeat(32), packageSha256: '22'.repeat(32), core: `0x${'33'.repeat(20)}` };

describe('finite native swap identity and budget', () => {
  it('rejects the earlier history descriptor that the App no longer selects', () => {
    expect(retired.graph).not.toBe(history.graph);
    expect(() => assertCurrentSwapIdentity(retired)).toThrow('Native swap candidate identity changed.');
    expect(() => currentNativeSigningBudget({}, CURRENT_APP_SWAP_OWNER, () => 100n, retired)).toThrow('Native swap candidate identity changed.');
  });
  it('keeps engineering bounds for the same address without actual browser context and admits a new browser wallet at nonce zero',()=>{
    ownerBeta.active=true;
    const scope=`quote:0x${'af'.repeat(32)}`,wallet=`0x${'cd'.repeat(20)}`;
    expect(()=>currentNativeSigningBudget({},CURRENT_APP_SWAP_OWNER,()=>ownerBeta.activation.activatedAt,history).check('quote',scope,110_000_000n)).toThrow();
    expect(currentNativeSigningBudget({},wallet,()=>ownerBeta.activation.activatedAt,history).snapshot().normalExpiresAt).not.toBeNull();
    expect(()=>assertCurrentSwapCandidate(history,{principal:wallet,destination:wallet,inputToken:history.pairs[0].tokens[0],outputToken:history.pairs[0].tokens[1],profile:'fast-pool',maximumInput:100_000_000n})).toThrow();
    const signer={};let live=true;bindCurrentDexBrowserSigner(signer,wallet,7082400n,()=>{if(!live)throw new Error('lease ended');});
    const budget=currentNativeSigningBudget(signer,wallet,()=>ownerBeta.activation.activatedAt,history);
    budget.commit('quote',scope,110_000_000n,scope,0);
    const record=currentNativeSwapCheckpoint(signer);
    expect(record.version).toBe(2);expect(record.charges[0].nonce).toBe(0);
    expect(()=>validateCurrentNativeSwapCheckpoint(record,wallet,history,signer)).not.toThrow();
    expect(()=>restoreCurrentNativeSwapCheckpoint({},wallet,history,record)).toThrow();
    expect(()=>budget.commit('quote',scope,110_000_000n,scope,0)).toThrow();
    live=false;expect(()=>budget.check('cancel',`cancel:${scope}`,30_000_000n,scope)).toThrow('lease ended');
  });
  it('starts a distinct normal owner record without closed-trial charges and retains exact fees and no-resend', () => {
    ownerBeta.active=true;
    const signer={}, scope=`quote:0x${'ce'.repeat(32)}`;
    const record={version:2 as const,owner:CURRENT_APP_SWAP_OWNER,candidateGraph:history.graph,
      start:String(ownerBeta.activation.activatedAt),activeSwap:null,committedWei:'0',charges:[]};
    expect(()=>validateCurrentNativeSwapCheckpoint(record,CURRENT_APP_SWAP_OWNER,history)).not.toThrow();
    if(ownerBeta.active)bindCurrentDexBrowserSigner(signer,CURRENT_APP_SWAP_OWNER,7082400n,()=>{});
    restoreCurrentNativeSwapCheckpoint(signer,CURRENT_APP_SWAP_OWNER,history,record);
    const budget=currentNativeSigningBudget(signer,CURRENT_APP_SWAP_OWNER,()=>ownerBeta.activation.activatedAt+604800n,history);
    budget.commit('quote',scope,110_000_000n,scope,220);
    recordCurrentNativeSwapHash(signer,220,scope.slice(6),`0x${'ab'.repeat(32)}`);
    budget.commit('accept',`accept:${scope}`,110_000_000n,scope,221);
    recordCurrentNativeSwapHash(signer,221,scope.slice(6),`0x${'ac'.repeat(32)}`);
    completeCurrentNativeSwapScope(signer,scope);
    const saved=currentNativeSwapCheckpoint(signer);
    expect(saved).toMatchObject({version:2,committedWei:'11000000000000000',activeSwap:null});
    expect(()=>validateCurrentNativeSwapCheckpoint(saved,CURRENT_APP_SWAP_OWNER,history)).not.toThrow();
    expect(()=>restoreCurrentNativeSwapCheckpoint({},`0x${'ff'.repeat(20)}`,history,saved)).toThrow();
    const restored={};bindCurrentDexBrowserSigner(restored,CURRENT_APP_SWAP_OWNER,7082400n,()=>{});restoreCurrentNativeSwapCheckpoint(restored,CURRENT_APP_SWAP_OWNER,history,saved);
    expect(()=>currentNativeSigningBudget(restored,CURRENT_APP_SWAP_OWNER,()=>ownerBeta.activation.activatedAt,history).commit('quote',scope,110_000_000n,scope,222)).toThrow();
    for(const change of [{owner:`0x${'ee'.repeat(20)}`},{start:'bad'},{committedWei:'0'},{windowStart:'2000000000'}])
      expect(()=>validateCurrentNativeSwapCheckpoint({...saved,...change},CURRENT_APP_SWAP_OWNER,history)).toThrow();
  });
  it.each(['delivered','expired-replacement'] as const)('continues completed owner delivery into a %s Fast trial while retaining all prior charges', outcome => {
    const signer={},first=`quote:0x${'11'.repeat(32)}`,second=`quote:0x${'33'.repeat(32)}`,third=`quote:0x${'66'.repeat(32)}`;
    const phases=['token-funding','quote','accept','recover','token-funding','quote','accept'] as const;
    const hashes=['0x5de03c3f32ef5d7334d1a4541d9f03020dc3ec43931289af7551c563b7038e82','0x6ad6c432b2d25a11a32bbc2bb16ebd0ee920f876da37fcc0b0857d8026b55874','0x70a2e7345f4e192144b7120e56ff3e5ca2de45af7d3ccce55372a6d47d704f11','0x63c23cf27c534f777428e61d3be280867a5f9ee57b1660c03c4457864331a13d',
      '0x904fcfd8ec833aaf8a6b213ca1de020b2ed5e1814acb9b6219c8f03e16ffe488','0xdc7b017f0221f7eafe4a2cea43fe9c7db8c0262dea2461d8cedc864155c859dc','0x10f7ac072e6a3b456c08df45b434ee075538899b128270a6603e54b4816f1bbe'];
    const caps=[5_000_000n,110_000_000n,35_000_000n,50_000_000n,5_000_000n,110_000_000n,35_000_000n];
    phases.forEach((phase,i)=>{
      const scope=i<4?first:second, budget=currentNativeSigningBudget(signer,CURRENT_APP_SWAP_OWNER,()=>i<4?100n:1792199880n,history);
      const key=phase==='token-funding'?`${phase}:${scope}:0x${'22'.repeat(32)}`:phase==='quote'?scope:`${phase}:${scope}`;
      budget.commit(phase,key,caps[i],scope,148+i);recordCurrentNativeSwapHash(signer,148+i,scope.slice(6),hashes[i]);
      if(i===3){completeCurrentNativeSwapScope(signer,first);expect(renewCurrentNativeSwapClosedWindow(signer,CURRENT_APP_SWAP_OWNER,history,first,1792199880n)).toBe(true);}
    });
    completeCurrentNativeSwapScope(signer,second);
    const prior=currentNativeSwapCheckpoint(signer),now=1792248902n;
    expect(renewCurrentNativeSwapClosedWindow(signer,CURRENT_APP_SWAP_OWNER,history,second,now)).toBe(true);
    expect(renewCurrentNativeSwapClosedWindow(signer,CURRENT_APP_SWAP_OWNER,history,second,now+900n)).toBe(false);
    expect(currentNativeSwapCheckpoint(signer).charges).toEqual(prior.charges);
    const budget=currentNativeSigningBudget(signer,CURRENT_APP_SWAP_OWNER,()=>now+1n,history);
    for(const [i,phase] of (outcome==='delivered'?['token-funding','quote','accept'] as const:['token-funding','quote'] as const).entries()){
      const key=phase==='token-funding'?`${phase}:${third}:0x${'44'.repeat(32)}`:phase==='quote'?third:`${phase}:${third}`;
      budget.commit(phase,key,i===0?5_000_000n:110_000_000n,third,162+i);
      recordCurrentNativeSwapHash(signer,162+i,third.slice(6),outcome==='delivered'?`0x${String(7+i).repeat(64)}`:[
        '0xf5ceb9ebb0c8c24ef65f3746254574f5525ec6179ddc92379bd0e64b3f1fa708',
        '0x26dcfd82ad6dc1fd2da514ec0079bd5a6e9a4765a30f3b5d454ea76549458fe6'][i]);
      const checkpoint=currentNativeSwapCheckpoint(signer),reloaded={};
      expect(()=>validateCurrentNativeSwapCheckpoint(checkpoint,CURRENT_APP_SWAP_OWNER,history)).not.toThrow();
      restoreCurrentNativeSwapCheckpoint(reloaded,CURRENT_APP_SWAP_OWNER,history,checkpoint);
      expect(currentNativeSwapCheckpoint(reloaded)).toEqual(checkpoint);
    }
    completeCurrentNativeSwapScope(signer,third);
    if(outcome==='expired-replacement'){
      const before=currentNativeSwapCheckpoint(signer),renewedAt=1792255023n;
      for(const index of [7,8]){
        const changed={...before,charges:before.charges.map((row,i)=>i===index?{...row,hash:`0x${'cc'.repeat(32)}`}:row)},other={};
        restoreCurrentNativeSwapCheckpoint(other,CURRENT_APP_SWAP_OWNER,history,changed);
        expect(renewCurrentNativeSwapClosedWindow(other,CURRENT_APP_SWAP_OWNER,history,third,renewedAt)).toBe(false);
      }
      expect(renewCurrentNativeSwapClosedWindow(signer,CURRENT_APP_SWAP_OWNER,history,third,renewedAt-1n)).toBe(false);
      expect(renewCurrentNativeSwapClosedWindow(signer,CURRENT_APP_SWAP_OWNER,history,third,renewedAt)).toBe(true);
      expect(renewCurrentNativeSwapClosedWindow(signer,CURRENT_APP_SWAP_OWNER,history,third,renewedAt+1n)).toBe(false);
      expect(currentNativeSwapCheckpoint(signer).charges).toEqual(before.charges);
      const next=currentNativeSigningBudget(signer,CURRENT_APP_SWAP_OWNER,()=>renewedAt+1n,history),scope=`quote:0x${'aa'.repeat(32)}`;
      expect(()=>next.check('token-funding',`token-funding:${scope}:0x${'bb'.repeat(32)}`,5_000_000n,scope)).toThrow();
      for(const [i,phase] of (['quote','accept'] as const).entries()){
        const key=phase==='quote'?scope:`accept:${scope}`;
        next.commit(phase,key,110_000_000n,scope,164+i);recordCurrentNativeSwapHash(signer,164+i,scope.slice(6),`0x${'bb'.repeat(32)}`);
        const checkpoint=currentNativeSwapCheckpoint(signer),reloaded={};
        restoreCurrentNativeSwapCheckpoint(reloaded,CURRENT_APP_SWAP_OWNER,history,checkpoint);
        expect(currentNativeSwapCheckpoint(reloaded)).toEqual(checkpoint);
      }
      expect(currentNativeSwapCheckpoint(signer).charges).toHaveLength(11);
      expect(currentNativeSwapCheckpoint(signer).charges.slice(0,9)).toEqual(before.charges);
      completeCurrentNativeSwapScope(signer,scope);
      expect(()=>next.check('quote',`quote:0x${'cc'.repeat(32)}`,110_000_000n)).toThrow();
      return;
    }
    expect(currentNativeSwapCheckpoint(signer).charges).toHaveLength(10);
    expect(currentNativeSwapCheckpoint(signer).charges.slice(0,7)).toEqual(prior.charges);
    expect(()=>budget.check('quote',`quote:0x${'aa'.repeat(32)}`,110_000_000n)).toThrow();
    for(const index of [0,1,2,3,4,5,6]){
      const changed={...prior,charges:prior.charges.map((c,i)=>i===index?{...c,hash:`0x${'aa'.repeat(32)}`}:c)},other={};
      try {
        restoreCurrentNativeSwapCheckpoint(other,CURRENT_APP_SWAP_OWNER,history,changed);
        expect(renewCurrentNativeSwapClosedWindow(other,CURRENT_APP_SWAP_OWNER,history,second,now)).toBe(false);
      } catch (error) { expect(error).toHaveProperty('message','Native reload charge record is invalid.'); }
    }
  });
  it('renews the exact approved recovered history trial once without resetting its four charges', () => {
    const signer={},scope=`quote:0x${'11'.repeat(32)}`,phases=['token-funding','quote','accept','recover'] as const;
    const hashes=['0x5de03c3f32ef5d7334d1a4541d9f03020dc3ec43931289af7551c563b7038e82','0x6ad6c432b2d25a11a32bbc2bb16ebd0ee920f876da37fcc0b0857d8026b55874','0x70a2e7345f4e192144b7120e56ff3e5ca2de45af7d3ccce55372a6d47d704f11','0x63c23cf27c534f777428e61d3be280867a5f9ee57b1660c03c4457864331a13d'];
    const budget=currentNativeSigningBudget(signer,CURRENT_APP_SWAP_OWNER,()=>100n,history);
    phases.forEach((phase,i)=>{const key=i===0?`${phase}:${scope}:0x${'22'.repeat(32)}`:phase==='quote'?scope:`${phase}:${scope}`;
      budget.commit(phase,key,[5_000_000n,110_000_000n,35_000_000n,50_000_000n][i],scope,148+i);
      recordCurrentNativeSwapHash(signer,148+i,scope.slice(6),hashes[i]);});
    completeCurrentNativeSwapScope(signer,scope);const before=currentNativeSwapCheckpoint(signer),now=1792199880n;
    expect(renewCurrentNativeSwapClosedWindow(signer,CURRENT_APP_SWAP_OWNER,history,scope,now-1n)).toBe(false);
    expect(renewCurrentNativeSwapClosedWindow(signer,CURRENT_APP_SWAP_OWNER,history,scope,now)).toBe(true);
    expect(currentNativeSwapCheckpoint(signer)).toEqual({...before,windowStart:String(now)});
    expect(renewCurrentNativeSwapClosedWindow(signer,CURRENT_APP_SWAP_OWNER,history,scope,now+900n)).toBe(false);
    const next=currentNativeSigningBudget(signer,CURRENT_APP_SWAP_OWNER,()=>now,history),nextScope=`quote:0x${'33'.repeat(32)}`;
    for(const [i,phase]of phases.entries()){
      const key=i===0?`${phase}:${nextScope}:0x${'44'.repeat(32)}`:phase==='quote'?nextScope:`${phase}:${nextScope}`;
      next.commit(phase,key,[5_000_000n,110_000_000n,35_000_000n,50_000_000n][i],nextScope,152+i);
      recordCurrentNativeSwapHash(signer,152+i,nextScope.slice(6),`0x${'55'.repeat(32)}`);
      const checkpoint=currentNativeSwapCheckpoint(signer),reloaded={};
      expect(()=>validateCurrentNativeSwapCheckpoint(checkpoint,CURRENT_APP_SWAP_OWNER,history)).not.toThrow();
      restoreCurrentNativeSwapCheckpoint(reloaded,CURRENT_APP_SWAP_OWNER,history,checkpoint);
      expect(currentNativeSwapCheckpoint(reloaded)).toEqual(checkpoint);
      if(i===0){
        for(const charges of [checkpoint.charges.map((c,n)=>n===3?{...c,hash:`0x${'99'.repeat(32)}`}:c),
          checkpoint.charges.map((c,n)=>n===4?{...c,phase:'token-faucet' as const,key:c.key.replace('token-funding:','token-faucet:')}:c),
          checkpoint.charges.map((c,n)=>n===4?{...c,scope,key:c.key.replace(nextScope,scope)}:c)])
          expect(()=>validateCurrentNativeSwapCheckpoint({...checkpoint,charges},CURRENT_APP_SWAP_OWNER,history)).toThrow();
      }
    }
    completeCurrentNativeSwapScope(signer,nextScope);
    expect(currentNativeSwapCheckpoint(signer).charges).toHaveLength(8);
    expect(currentNativeSwapCheckpoint(signer).charges.slice(0,4)).toEqual(before.charges);
    expect(()=>next.check('quote',`quote:0x${'66'.repeat(32)}`,110_000_000n)).toThrow();
  });
  it('reserves terminal time before history async funding without changing Fast or recovery', () => {
    const intent = { candidate: history, principal: CURRENT_APP_SWAP_OWNER, destination: CURRENT_APP_SWAP_OWNER,
      profile: 'cheap-async', inputToken: history.tokenMetadata[0].address, outputToken: history.tokenMetadata[1].address,
      quoteProtocol: 'quote-slippage', toleranceBps: 50, maximumInput: 1_000_000n, minimumInput: 0n,
      minimumOutput: 0n, rateNumerator: 0n, rateDenominator: 1n, deadline: 280n };
    const prepared = { intent } as unknown as CurrentCheapDexPreparedQuote;
    expect(() => assertCurrentNativeSwapIntent(prepared, 100n, false, true)).toThrow('settlement');
    intent.deadline = 281n;
    expect(() => assertCurrentNativeSwapIntent(prepared, 100n, false, true)).not.toThrow();
    intent.deadline = 110n;
    expect(() => assertCurrentNativeSwapIntent(prepared, 100n)).not.toThrow();
    intent.profile = 'fast-pool';
    expect(() => assertCurrentNativeSwapIntent(prepared, 100n, false, true)).not.toThrow();
    intent.profile = 'cheap-async'; intent.deadline = 90n;
    expect(() => assertCurrentNativeSwapIntent(prepared, 100n, true)).not.toThrow();
  });
  it('binds a fresh Quote after confirmed funding without changing charges or original time bounds',()=>{
    const signer={},owner=`0x${'22'.repeat(20)}`,oldScope=`quote:0x${'11'.repeat(32)}`,newScope=`quote:0x${'77'.repeat(32)}`,
      budget=currentNativeSigningBudget(signer,owner,()=>100n,history),key=`token-funding:${oldScope}:0x${'22'.repeat(32)}`;
    budget.commit('token-funding',key,5_000_000n,oldScope,4);
    expect(()=>bindCurrentNativeSwapFundingScope(signer,newScope)).toThrow('confirmed');
    recordCurrentNativeSwapHash(signer,4,`0x${'22'.repeat(32)}`,`0x${'33'.repeat(32)}`);
    const before=currentNativeSwapCheckpoint(signer);
    bindCurrentNativeSwapFundingScope(signer,newScope);
    expect(currentNativeSwapCheckpoint(signer)).toMatchObject({start:before.start,committedWei:before.committedWei,charges:before.charges,activeSwap:newScope});
    budget.commit('quote',newScope,110_000_000n,newScope,5);
    expect(()=>validateCurrentNativeSwapCheckpoint(currentNativeSwapCheckpoint(signer),owner,history)).not.toThrow();
    expect(()=>bindCurrentNativeSwapFundingScope(signer,oldScope)).toThrow('confirmed');
  });
  it('admits only the exact history identity for swaps while the unscoped App gate stays held', () => {
    expect(() => assertCurrentSwapIdentity(history)).not.toThrow();
    expect(() => assertCurrentSwapCandidate(history)).toThrow('signing hold');
  });
  it.each(['packageSha256', 'core', 'releaseId', 'attestationSha256', 'reviewedTokenSet', 'marketId'])('rejects changed %s identity', field => {
    expect(() => assertCurrentSwapIdentity({ ...history, [field]: '00'.repeat(32) })).toThrow('identity changed');
    expect(() => assertCurrentSwapCandidate({ ...history, [field]: '00'.repeat(32) })).toThrow('identity changed');
  });
  it.each(['amount', 'tolerance', 'expiry', 'lifetime', 'candidate', 'minimum'])('rejects native %s protection drift', fault => {
    const intent = { candidate: history, quoteProtocol: 'quote-slippage', toleranceBps: 50, maximumInput: 100n,
      minimumInput: 1n, minimumOutput: 1n, rateNumerator: 0n, rateDenominator: 1n, deadline: 200n };
    if (fault === 'amount') intent.maximumInput = limits.maximumInput + 1n;
    if (fault === 'tolerance') intent.toleranceBps = 51;
    if (fault === 'expiry') intent.deadline = 100n;
    if (fault === 'lifetime') intent.deadline = 1001n;
    if (fault === 'candidate') Object.assign(intent, { candidate: { ...history, feePpm: 1 } });
    if (fault === 'minimum') intent.minimumInput = 101n;
    expect(() => assertCurrentNativeSwapIntent({ intent } as unknown as CurrentCheapDexPreparedQuote, 100n)).toThrow();
  });
});

describe('approved tiny partial-refund trial', () => {
  const approval = 1792441435n, expires = approval + 7200n;
  it('reconstructs only the eleven pinned public reservations without installing signing authority', () => {
    const caps=[5n,110n,35n,50n,5n,110n,35n,5n,110n,110n,110n];
    const rows=recovery.hashes.map((hash,i)=>({hash,nonce:i<7?148+i:155+i,data:`0x${(i+1).toString(16).padStart(2,'0')}`,
      gasLimit:caps[i]*1_000_000n,gasPrice:50_000_000n,chainId:7082400n,from:CURRENT_APP_SWAP_OWNER,
      to:[0,4,7].includes(i)?history.tokenMetadata[0].address:history.core,value:0n}));
    const run=(input=rows,owner=CURRENT_APP_SWAP_OWNER,now:bigint=recovery.approvedAt)=>recoverCurrentPartialLedger(owner,history,now,input);
    const checkpoint=run();
    expect(checkpoint.charges.map(c=>c.hash)).toEqual(recovery.hashes);
    expect(checkpoint.activeSwap).toBeNull();
    expect(checkpoint.committedWei).toBe(String(caps.reduce((sum,c)=>sum+c,0n)*1_000_000n*50_000_000n));
    for(const change of [{hash:'0x'+'a'.repeat(64)},{nonce:217},{gasLimit:1n},{gasPrice:1n},{chainId:1n},{value:1n},{from:history.core},{to:history.core}])
      expect(()=>run(rows.map((row,i)=>i===0?{...row,...change}:row))).toThrow();
    expect(()=>run(rows.slice(1))).toThrow();
    expect(()=>run(rows,history.core)).toThrow();
    expect(()=>run(rows,CURRENT_APP_SWAP_OWNER,recovery.approvedAt-1n)).toThrow();
    expect(()=>run(rows,CURRENT_APP_SWAP_OWNER,expires)).toThrow();
  });
  it('cannot start a new trial from a tab that lost the eleven prior reservations', () => {
    const budget = currentNativeSigningBudget({}, CURRENT_APP_SWAP_OWNER, () => approval + 1n, history);
    const scope = `quote:0x${'5'.repeat(64)}`;
    expect(() => budget.check('quote', scope, 110_000_000n, scope)).toThrow('prior reservations');
    expect(() => budget.check('token-funding', `token-funding:${scope}:0x${'a'.repeat(64)}`, 5_000_000n, scope)).toThrow('prior reservations');
    expect(budget.snapshot().signingStarts).toBe(0);
  });
  const hashes = [
    '0x5de03c3f32ef5d7334d1a4541d9f03020dc3ec43931289af7551c563b7038e82',
    '0x6ad6c432b2d25a11a32bbc2bb16ebd0ee920f876da37fcc0b0857d8026b55874',
    '0x70a2e7345f4e192144b7120e56ff3e5ca2de45af7d3ccce55372a6d47d704f11',
    '0x63c23cf27c534f777428e61d3be280867a5f9ee57b1660c03c4457864331a13d',
    '0x904fcfd8ec833aaf8a6b213ca1de020b2ed5e1814acb9b6219c8f03e16ffe488',
    '0xdc7b017f0221f7eafe4a2cea43fe9c7db8c0262dea2461d8cedc864155c859dc',
    '0x10f7ac072e6a3b456c08df45b434ee075538899b128270a6603e54b4816f1bbe',
    '0xf5ceb9ebb0c8c24ef65f3746254574f5525ec6179ddc92379bd0e64b3f1fa708',
    '0x26dcfd82ad6dc1fd2da514ec0079bd5a6e9a4765a30f3b5d454ea76549458fe6',
    '0xb95911ec63dd48c89c266faa2498640f80edecb9afe9aefea9b23018266fe432',
    '0x2af62aa18799348b848617c93a64515f482d7179b610a209d6a8aa684dc655e2'
  ];
  const scope = (n: string) => `quote:0x${n.repeat(64)}`;
  const prior = () => {
    const phases = ['token-funding','quote','accept','recover','token-funding','quote','accept','token-funding','quote','quote','accept'] as const;
    const caps = [5n,110n,35n,50n,5n,110n,35n,5n,110n,110n,110n].map(n => n * 1_000_000n);
    const charges = phases.map((phase, i) => {
      const s = scope(i < 4 ? '1' : i < 7 ? '2' : i < 9 ? '3' : '4');
      return { phase, scope: s, key: phase === 'token-funding' ? `${phase}:${s}:0x${String(i + 1).repeat(64)}` : phase === 'quote' ? s : `${phase}:${s}`,
        gasCap: String(caps[i]), gasPrice: '50000000', nonce: i < 7 ? 148 + i : 155 + i, hash: hashes[i] };
    });
    return { version: 1 as const, owner: CURRENT_APP_SWAP_OWNER, candidateGraph: history.graph, start: '100', windowStart: '1792255023',
      committedWei: String(caps.reduce((sum,n) => sum + n * 50_000_000n, 0n)), activeSwap: null, charges };
  };
  it('retains eleven records and renews once for the approved partial trial', () => {
    const signer = {}, before = prior(), now = approval + 1n;
    restoreCurrentNativeSwapCheckpoint(signer, CURRENT_APP_SWAP_OWNER, history, before);
    expect(renewCurrentNativeSwapClosedWindow(signer, CURRENT_APP_SWAP_OWNER, history, scope('4'), now)).toBe(true);
    expect(renewCurrentNativeSwapClosedWindow(signer, CURRENT_APP_SWAP_OWNER, history, scope('4'), now + 1n)).toBe(false);
    const budget = currentNativeSigningBudget(signer, CURRENT_APP_SWAP_OWNER, () => now, history), s = scope('5');
    for (const [i, phase] of (['token-funding','quote','accept'] as const).entries()) {
      const key = phase === 'token-funding' ? `${phase}:${s}:0x${'a'.repeat(64)}` : phase === 'quote' ? s : `accept:${s}`;
      budget.commit(phase, key, [5_000_000n,110_000_000n,35_000_000n][i], s, 217 + i);
      recordCurrentNativeSwapHash(signer, 217 + i, s.slice(6), `0x${'b'.repeat(64)}`);
      const checkpoint = currentNativeSwapCheckpoint(signer), reloaded = {};
      expect(checkpoint.charges.slice(0,11)).toEqual(before.charges);
      restoreCurrentNativeSwapCheckpoint(reloaded, CURRENT_APP_SWAP_OWNER, history, checkpoint);
      expect(currentNativeSwapCheckpoint(reloaded)).toEqual(checkpoint);
    }
    completeCurrentNativeSwapScope(signer, s);
    expect(() => budget.check('quote', scope('6'), 110_000_000n)).toThrow();
    expect(() => budget.check('token-faucet', `token-faucet:${s}:0x${'c'.repeat(64)}`, 5_000_000n, s)).toThrow();
    expect(currentNativeSwapCheckpoint(signer).charges).toHaveLength(14);
  });
  const completedLegacy = () => {
    const before=prior(), s=scope('5'), phases=['token-funding','quote','accept'] as const;
    const hashes=['0x2e8c953987b9da4dd5149b8053b503bc152ae4fcb699a0597f74e7686201e57e','0xf0555667b314df628eebefd04709adccbd64315e5ea244d6c7dfe0f526ad2bcc','0x38f0f3117ec7985797aee9636754aa29186970329e07fb9f8918e55b4d990210'];
    const charges=[...before.charges,...phases.map((phase,i)=>({phase,scope:s,key:phase==='token-funding'?`${phase}:${s}:0x${'a'.repeat(64)}`:phase==='quote'?s:`${phase}:${s}`,
      gasCap:String([5_000_000n,110_000_000n,35_000_000n][i]),gasPrice:'50000000',nonce:217+i,hash:hashes[i]}))];
    const value={...before,windowStart:String(approval+1n),charges,committedWei:String(charges.reduce((sum,row)=>sum+BigInt(row.gasCap)*50_000_000n,0n))};
    ownerBeta.activation.legacyReservationHash=currentOwnerBetaLegacyReservationHash(value);
    return value;
  };
  it('appends owner-beta swaps without resetting or repricing the14 legacy charges, then restores the same active scope', () => {
    ownerBeta.active=true;
    const legacy=completedLegacy(), signer={}, s=scope('6');
    if(ownerBeta.active)bindCurrentDexBrowserSigner(signer,CURRENT_APP_SWAP_OWNER,7082400n,()=>{});
    restoreCurrentNativeSwapCheckpoint(signer,CURRENT_APP_SWAP_OWNER,history,legacy);
    let now=ownerBeta.activation.activatedAt;
    const budget=currentNativeSigningBudget(signer,CURRENT_APP_SWAP_OWNER,()=>now,history);
    budget.commit('quote',s,110_000_000n,s,220);
    recordCurrentNativeSwapHash(signer,220,s.slice(6),`0x${'6'.repeat(64)}`);
    budget.commit('accept',`accept:${s}`,110_000_000n,s,221);
    recordCurrentNativeSwapHash(signer,221,s.slice(6),`0x${'7'.repeat(64)}`);
    const saved=currentNativeSwapCheckpoint(signer),reloaded={};
    expect(saved.charges.slice(0,14)).toEqual(legacy.charges);
    expect(BigInt(saved.committedWei)-BigInt(legacy.committedWei)).toBe(11_000_000_000_000_000n);
    bindCurrentDexBrowserSigner(reloaded,CURRENT_APP_SWAP_OWNER,7082400n,()=>{});restoreCurrentNativeSwapCheckpoint(reloaded,CURRENT_APP_SWAP_OWNER,history,saved);
    expect(currentNativeSwapCheckpoint(reloaded)).toEqual(saved);
    expect(()=>budget.check('quote',scope('7'),110_000_000n)).toThrow('scope');
    completeCurrentNativeSwapScope(signer,s);
    budget.commit('quote',scope('7'),110_000_000n,scope('7'),222);
    recordCurrentNativeSwapHash(signer,222,scope('7').slice(6),`0x${'8'.repeat(64)}`);
    now+=86400n;
    expect(()=>budget.check('accept',`accept:${scope('7')}`,35_000_000n,scope('7'))).not.toThrow();
    now+=604800n;
    expect(()=>budget.commit('recover',`recover:${scope('7')}`,50_000_000n,scope('7'),10_000)).not.toThrow();
    expect(budget.snapshot()).toMatchObject({normalExpiresAt:null,recoveryExpiresAt:null});
    expect(()=>budget.commit('recover',`recover:${scope('7')}`,50_000_000n,scope('7'),10_001)).toThrow('scope');
  });
  it('legacy digest excludes old clocks but rejects a changed charge scope', () => {
    ownerBeta.active=true;
    const legacy=completedLegacy(),digest=currentOwnerBetaLegacyReservationHash(legacy);
    expect(currentOwnerBetaLegacyReservationHash({...legacy,start:'101',windowStart:String(BigInt(legacy.windowStart)+1n)})).toBe(digest);
    const changedScope=scope('8');
    const changed={...legacy,charges:legacy.charges.map((row,i)=>i===0?{...row,scope:changedScope,key:`token-funding:${changedScope}:0x${'a'.repeat(64)}`}:row)};
    expect(currentOwnerBetaLegacyReservationHash(changed)).not.toBe(digest);
    expect(()=>validateCurrentNativeSwapCheckpoint(changed,CURRENT_APP_SWAP_OWNER,history)).toThrow('retained legacy reservation changed');
  });
  it('requires complete old records and rejects changed suffix nonce, fee, hash and scope on reload', () => {
    ownerBeta.active=true;
    const legacy=completedLegacy(),signer={},s=scope('6');
    const fresh={};bindCurrentDexBrowserSigner(fresh,CURRENT_APP_SWAP_OWNER,7082400n,()=>{});
    expect(()=>currentNativeSigningBudget(fresh,CURRENT_APP_SWAP_OWNER,()=>ownerBeta.activation.activatedAt,history).check('quote',s,110_000_000n)).not.toThrow();
    for(const change of [{charges:legacy.charges.slice(1)},{committedWei:'0'},{charges:legacy.charges.map((row,i)=>i===13?{...row,hash:`0x${'f'.repeat(64)}`}:row)}])
      expect(()=>restoreCurrentNativeSwapCheckpoint({},CURRENT_APP_SWAP_OWNER,history,{...legacy,...change})).toThrow();
    if(ownerBeta.active)bindCurrentDexBrowserSigner(signer,CURRENT_APP_SWAP_OWNER,7082400n,()=>{});
    restoreCurrentNativeSwapCheckpoint(signer,CURRENT_APP_SWAP_OWNER,history,legacy);
    const budget=currentNativeSigningBudget(signer,CURRENT_APP_SWAP_OWNER,()=>ownerBeta.activation.activatedAt,history);
    expect(()=>budget.commit('quote',s,110_000_000n,s,219)).toThrow();
    budget.commit('quote',s,110_000_000n,s,220);
    const saved=currentNativeSwapCheckpoint(signer);
    for(const change of [{nonce:219},{nonce:220.5},{gasPrice:'52000000'},{gasCap:'110000001'},{scope:scope('5')},{hash:'0x0'}]) {
      expect(()=>validateCurrentNativeSwapCheckpoint({...saved,charges:saved.charges.map((row,i)=>i===14?{...row,...change}:row)},CURRENT_APP_SWAP_OWNER,history)).toThrow();
    }
    expect(()=>validateCurrentNativeSwapCheckpoint({...saved,committedWei:legacy.committedWei},CURRENT_APP_SWAP_OWNER,history)).toThrow();
  });
  it('removes the consumed three-atom mode restriction without widening custom protection', () => {
    ownerBeta.active=true;
    const signer={};bindCurrentDexBrowserSigner(signer,CURRENT_APP_SWAP_OWNER,7082400n,()=>{});
    for(const profile of ['fast-pool','cheap-async']) {
      const intent={candidate:history,principal:CURRENT_APP_SWAP_OWNER,destination:CURRENT_APP_SWAP_OWNER,inputToken:history.tokenMetadata[3].address,outputToken:history.tokenMetadata[2].address,
        profile,quoteProtocol:'quote-slippage',maximumInput:20_000_000n,minimumInput:1n,minimumOutput:2n,rateNumerator:1n,rateDenominator:2n,toleranceBps:50,deadline:ownerBeta.activation.activatedAt+900n};
      const check=(change:object={})=>assertCurrentNativeSwapIntent({intent:{...intent,...change}} as unknown as CurrentCheapDexPreparedQuote,ownerBeta.activation.activatedAt,false,false,signer);
      expect(()=>check()).not.toThrow();
      expect(()=>check({toleranceBps:51})).toThrow();
      expect(()=>check({maximumInput:100_000_000n})).not.toThrow();
      expect(()=>check({maximumInput:1n<<256n})).toThrow();
    }
  });
  it('retains all records beyond the old count and fee quotas without permitting a resend', () => {
    ownerBeta.active=true;
    const legacy=completedLegacy();
    const suffix=Array.from({length:240},(_,i)=>{
      const scope=`quote:0x${(i%120+100).toString(16).padStart(64,'0')}`,phase=i<120?'quote' as const:'recover' as const;
      return {phase,scope,key:phase==='quote'?scope:`recover:${scope}`,gasCap:phase==='quote'?'110000000':'50000000',gasPrice:'50000000',nonce:220+i,hash:`0x${(i+100).toString(16).padStart(64,'0')}`};
    });
    const budget={...legacy,charges:[...legacy.charges,...suffix],committedWei:String(BigInt(legacy.committedWei)+suffix.reduce((sum,row)=>sum+BigInt(row.gasCap)*50_000_000n,0n))};
    expect(()=>validateCurrentNativeSwapCheckpoint(budget,CURRENT_APP_SWAP_OWNER,history)).not.toThrow();
    expect(BigInt(budget.committedWei)-BigInt(legacy.committedWei)).toBeGreaterThan(550_000_000_000_000_000n);
    const duplicate={...budget,charges:[...budget.charges,suffix[0]]};
    expect(()=>validateCurrentNativeSwapCheckpoint(duplicate,CURRENT_APP_SWAP_OWNER,history)).toThrow();
    const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
    const record={budget,authentication:`0x${'f'.repeat(64)}`};
    expect(JSON.stringify(record).length).toBeGreaterThan(65536);
    writeCurrentDexNativeReload(storage,record);
    expect(readCurrentDexNativeReload(storage)).toEqual(record);
  });
  it('blocks Fast gas, old scopes and actions outside the conservative authority window', () => {
    let now = approval + 1n; const signer = {};
    restoreCurrentNativeSwapCheckpoint(signer, CURRENT_APP_SWAP_OWNER, history, prior());
    renewCurrentNativeSwapClosedWindow(signer, CURRENT_APP_SWAP_OWNER, history, scope('4'), now);
    const budget = currentNativeSigningBudget(signer, CURRENT_APP_SWAP_OWNER, () => now, history), s = scope('5');
    expect(() => budget.check('quote', scope('4'), 110_000_000n)).toThrow();
    budget.commit('quote', s, 110_000_000n, s, 217);
    expect(() => budget.check('accept', `accept:${s}`, 110_000_000n, s)).toThrow();
    now = expires;
    expect(() => budget.check('recover', `recover:${s}`, 50_000_000n, s)).toThrow();
  });
  it('admits only the exact partial-refund financial intent and leaves older receipt inputs untouched', () => {
    const intent = { candidate: history, principal: CURRENT_APP_SWAP_OWNER, destination: CURRENT_APP_SWAP_OWNER,
      inputToken: history.tokenMetadata[0].address, outputToken: history.tokenMetadata[1].address,
      profile: 'cheap-async', quoteProtocol: 'quote-slippage', deadline: approval + 900n,
      maximumInput: 3n, minimumInput: 0n, minimumOutput: 1n, rateNumerator: 0n, rateDenominator: 1n, toleranceBps: 50 };
    const check = (changes: object, now = approval + 1n) => assertCurrentNativeSwapIntent({ intent: { ...intent, ...changes } } as unknown as CurrentCheapDexPreparedQuote, now);
    expect(() => check({})).not.toThrow();
    for (const changes of [{maximumInput:4n},{profile:'fast-pool'},{minimumInput:1n},{minimumOutput:0n},{rateNumerator:1n},{toleranceBps:49}]) expect(() => check(changes)).toThrow();
    expect(() => check({deadline:expires + 1n}, expires)).toThrow();
    expect(() => check({maximumInput:1_000_000n,deadline:approval - 1n + 900n}, approval - 1n)).not.toThrow();
  });
});
