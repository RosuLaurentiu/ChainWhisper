import { afterEach, describe, expect, it, vi } from 'vitest';
const ownerBeta = vi.hoisted(() => ({ active: false, activation: { activatedAt: 2_000_000_000n, startingNonce: 220, legacyReservationHash:'' } }));
vi.mock('./currentDexOwnerBetaPolicy', async importOriginal => {
  const actual = await importOriginal<typeof import('./currentDexOwnerBetaPolicy')>();
  const selected = (graph:string,owner:string) => ownerBeta.active && graph===actual.CURRENT_OWNER_BETA.graph && owner.toLowerCase()===actual.CURRENT_OWNER_BETA.owner;
  return { ...actual, CURRENT_OWNER_BETA: {...actual.CURRENT_OWNER_BETA, activation:ownerBeta.activation}, isCurrentOwnerBeta:selected,
    assertCurrentOwnerBetaWindow:(graph:string,owner:string,core:string,chainId:bigint,now:bigint,nonce:number,recovery:boolean,cap:bigint,price:bigint) => {
      if(!selected(graph,owner)||core.toLowerCase()!==actual.CURRENT_OWNER_BETA.core||chainId!==7082400n)throw new Error('Owner beta identity changed.');
      actual.checkCurrentOwnerBetaWindow(ownerBeta.activation,now,nonce,recovery,cap,price);
    } };
});
afterEach(() => { ownerBeta.active=false; });
import { STAGED_NATIVE_DEX_CANDIDATE as native, assertCurrentCheapDexNativeAdmission } from './dexV2Deployment';
import { assertCurrentSwapCandidate, assertCurrentNativeSwapIntent, currentNativeSigningBudget, completeCurrentNativeSwapScope, completeCurrentNativePoolScope, recordCurrentNativePoolOutcome, CURRENT_NATIVE_SWAP_LIMITS as limits } from './currentDexNativeSwapPolicy';
import type { CurrentCheapDexPreparedQuote } from './currentDexSubmission';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE as current } from './currentDexExitCandidate';
import { assertCurrentSwapIdentity, usesCurrentNativeSwapChecks } from './currentDexNativeSwapPolicy';
import { CURRENT_EXIT_SWAP_LIMITS } from './currentDexExitSwapPolicy';
import {currentNativeSwapCheckpoint,recordCurrentNativeSwapHash,restoreCurrentNativeSwapCheckpoint,validateCurrentNativeSwapCheckpoint} from './currentDexNativeSwapPolicy';
import { bindCurrentNativeSwapFundingScope, renewCurrentNativeSwapFundingWindow, renewCurrentNativeSwapClosedWindow } from './currentDexNativeSwapPolicy';
import { CURRENT_APP_SWAP_OWNER, CURRENT_APP_REPLACEMENT_TRIAL } from './currentDexC1SwapPolicy';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as history } from './currentDexHistoryCandidate';
import { recoverCurrentPartialLedger } from './currentDexNativeSwapPolicy';
import { CURRENT_APP_PARTIAL_LEDGER_RECOVERY as recovery } from './currentDexC1SwapPolicy';
import { readCurrentDexNativeReload, writeCurrentDexNativeReload } from './currentDexNativeReload';
import { currentOwnerBetaLegacyReservationHash } from './currentDexNativeSwapPolicy';

describe('finite native swap identity and budget', () => {
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
  it('reserves terminal time before current async funding without changing Fast or recovery', () => {
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
  it('retains nine records and reserves Accept and recovery for the fourth Quote', () => {
    const signer={},scopes=[`quote:0x${'11'.repeat(32)}`,`quote:0x${'77'.repeat(32)}`,`quote:0x${'88'.repeat(32)}`],nextScope=`quote:0x${'99'.repeat(32)}`;
    const phases=['token-faucet','token-funding','quote','cancel','quote','cancel','quote','accept','cancel'] as const;
    const caps=[5_000_000n,5_000_000n,110_000_000n,30_000_000n,110_000_000n,30_000_000n,110_000_000n,35_000_000n,30_000_000n];
    const hashes=['0xf3593926823ab7f1f49d4a0a565352fc8d3044d1739c945091f42f39a38c2350',
      '0xd2d1b519ac3dbd29216babad015da73a859723645d28958c6aac0f0b18510974',CURRENT_APP_REPLACEMENT_TRIAL.quoteHash,CURRENT_APP_REPLACEMENT_TRIAL.cancelHash,
      '0x0ca44a17515a6e5680e0eb354fef7c21a5d6391dfbcbb024435f65ec1b004413','0xe3f6c912683251e6b8f53d5fd318ca2d9ae89dc43afd0bb5411f8423a1396dd8',
      '0x69f5725311a615b3b557271011d2a20f5788ec20b103f152f82807e37ef427e0','0xb288ce7bd300366f1284a25ec12258c97c1ffbe64906151ed02b380fe2f42d87',
      '0xc4d01d7adc3182dbebb88f20af3a10d69303f6ec58b2b0592dcd92e17533b511'];
    const budget=currentNativeSigningBudget(signer,CURRENT_APP_SWAP_OWNER,()=>100n,current);
    phases.forEach((phase,i)=>{const scope=scopes[i<4?0:i<6?1:2],key=i<2?`${phase}:${scope}:0x${'22'.repeat(32)}`:phase==='quote'?scope:`${phase}:${scope}`;
      budget.commit(phase,key,caps[i],scope,137+i);recordCurrentNativeSwapHash(signer,137+i,phase==='quote'?scope.slice(6):`0x${'22'.repeat(32)}`,hashes[i]);
      if(phase==='cancel')completeCurrentNativeSwapScope(signer,scope);});
    const original=currentNativeSwapCheckpoint(signer),now=1791841485n;
    expect(renewCurrentNativeSwapClosedWindow(signer,CURRENT_APP_SWAP_OWNER,current,scopes[2],now)).toBe(true);
    expect(currentNativeSwapCheckpoint(signer)).toEqual({...original,windowStart:String(now)});
    for(const change of [{activeSwap:scopes[2]},{charges:original.charges.map((c,i)=>i===7?{...c,nonce:143}:c)},
      {charges:original.charges.map((c,i)=>i===8?{...c,hash:`0x${'44'.repeat(32)}`}:c)}]) {
      const other={};restoreCurrentNativeSwapCheckpoint(other,CURRENT_APP_SWAP_OWNER,current,{...original,...change});
      expect(renewCurrentNativeSwapClosedWindow(other,CURRENT_APP_SWAP_OWNER,current,scopes[2],now)).toBe(false);
    }
    const next=currentNativeSigningBudget(signer,CURRENT_APP_SWAP_OWNER,()=>now+1n,current);
    next.commit('quote',nextScope,110_000_000n,nextScope,146);recordCurrentNativeSwapHash(signer,146,nextScope.slice(6),`0x${'55'.repeat(32)}`);
    next.commit('accept',`accept:${nextScope}`,35_000_000n,nextScope,147);recordCurrentNativeSwapHash(signer,147,`0x${'22'.repeat(32)}`,`0x${'66'.repeat(32)}`);
    next.commit('recover',`recover:${nextScope}`,50_000_000n,nextScope,148);
    expect(currentNativeSwapCheckpoint(signer).charges).toHaveLength(12);
    expect(currentNativeSwapCheckpoint(signer).charges.slice(0,9)).toEqual(original.charges);
    expect(renewCurrentNativeSwapClosedWindow(signer,CURRENT_APP_SWAP_OWNER,current,scopes[2],now+1n)).toBe(false);
  });
  it('preserves six prior records and reserves Accept plus recovery for the approved third Quote', () => {
    const signer={},first=`quote:0x${'11'.repeat(32)}`,second=`quote:0x${'77'.repeat(32)}`,third=`quote:0x${'88'.repeat(32)}`;
    const phases=['token-faucet','token-funding','quote','cancel','quote','cancel'] as const;
    const caps=[5_000_000n,5_000_000n,110_000_000n,30_000_000n,110_000_000n,30_000_000n];
    const hashes=['0xf3593926823ab7f1f49d4a0a565352fc8d3044d1739c945091f42f39a38c2350',
      '0xd2d1b519ac3dbd29216babad015da73a859723645d28958c6aac0f0b18510974',CURRENT_APP_REPLACEMENT_TRIAL.quoteHash,CURRENT_APP_REPLACEMENT_TRIAL.cancelHash,
      '0x0ca44a17515a6e5680e0eb354fef7c21a5d6391dfbcbb024435f65ec1b004413','0xe3f6c912683251e6b8f53d5fd318ca2d9ae89dc43afd0bb5411f8423a1396dd8'];
    const budget=currentNativeSigningBudget(signer,CURRENT_APP_SWAP_OWNER,()=>100n,current);
    phases.forEach((phase,i)=>{const scope=i<4?first:second,key=i<2?`${phase}:${scope}:0x${'22'.repeat(32)}`:phase==='quote'?scope:`${phase}:${scope}`;
      budget.commit(phase,key,caps[i],scope,137+i);recordCurrentNativeSwapHash(signer,137+i,phase==='quote'?scope.slice(6):`0x${'22'.repeat(32)}`,hashes[i]);
      if(phase==='cancel')completeCurrentNativeSwapScope(signer,scope);});
    const original=currentNativeSwapCheckpoint(signer),now=1791837362n;
    expect(renewCurrentNativeSwapClosedWindow(signer,CURRENT_APP_SWAP_OWNER,current,second,now)).toBe(true);
    expect(currentNativeSwapCheckpoint(signer)).toEqual({...original,windowStart:String(now)});
    for (const change of [{activeSwap:second},{charges:original.charges.map((c,i)=>i===5?{...c,nonce:141}:c)},
      {charges:original.charges.map((c,i)=>i===5?{...c,hash:`0x${'44'.repeat(32)}`}:c)}]) {
      const other={};restoreCurrentNativeSwapCheckpoint(other,CURRENT_APP_SWAP_OWNER,current,{...original,...change});
      expect(renewCurrentNativeSwapClosedWindow(other,CURRENT_APP_SWAP_OWNER,current,second,now)).toBe(false);
    }
    const next=currentNativeSigningBudget(signer,CURRENT_APP_SWAP_OWNER,()=>now+1n,current);
    next.commit('quote',third,110_000_000n,third,143);recordCurrentNativeSwapHash(signer,143,third.slice(6),`0x${'55'.repeat(32)}`);
    next.commit('accept',`accept:${third}`,35_000_000n,third,144);recordCurrentNativeSwapHash(signer,144,`0x${'22'.repeat(32)}`,`0x${'66'.repeat(32)}`);
    next.commit('recover',`recover:${third}`,50_000_000n,third,145);recordCurrentNativeSwapHash(signer,145,`0x${'22'.repeat(32)}`,`0x${'77'.repeat(32)}`);
    completeCurrentNativeSwapScope(signer,third);
    const final=currentNativeSwapCheckpoint(signer);validateCurrentNativeSwapCheckpoint(final,CURRENT_APP_SWAP_OWNER,current);
    expect(final.charges).toHaveLength(9);expect(final.charges.slice(0,6)).toEqual(original.charges);
    expect(final.start).toBe(original.start);expect(final.committedWei).toBe('25220000000000000');
    expect(renewCurrentNativeSwapClosedWindow(signer,CURRENT_APP_SWAP_OWNER,current,third,now+1900n)).toBe(false);
    expect(()=>next.commit('quote',`quote:0x${'99'.repeat(32)}`,110_000_000n,`quote:0x${'99'.repeat(32)}`,146)).toThrow('reserved');
  });
  it('renews only the unused approved closed trial while retaining its ledger and finite windows', () => {
    const signer={},scope=`quote:0x${'11'.repeat(32)}`,hashes=[
      '0xf3593926823ab7f1f49d4a0a565352fc8d3044d1739c945091f42f39a38c2350',
      '0xd2d1b519ac3dbd29216babad015da73a859723645d28958c6aac0f0b18510974',
      '0xdcfd24aa56226f648176457c4deaeb7c748c891b83d26a632715827faa375128',
      '0x3fba05e2afa21b17e28b7ce577a7a2f30143ae42d5b742045940f0ce294f32a0'];
    const phases=['token-faucet','token-funding','quote','cancel'] as const,caps=[5_000_000n,5_000_000n,110_000_000n,30_000_000n];
    const budget=currentNativeSigningBudget(signer,CURRENT_APP_SWAP_OWNER,()=>100n,current);
    phases.forEach((phase,i)=>{const key=i<2?`${phase}:${scope}:0x${'22'.repeat(32)}`:phase==='quote'?scope:`${phase}:${scope}`;
      budget.commit(phase,key,caps[i],scope,137+i);recordCurrentNativeSwapHash(signer,137+i,i===2?scope.slice(6):`0x${'22'.repeat(32)}`,hashes[i]);});
    completeCurrentNativeSwapScope(signer,scope);
    const original=currentNativeSwapCheckpoint(signer),now=1791831919n;
    expect(renewCurrentNativeSwapClosedWindow({},CURRENT_APP_SWAP_OWNER,current,scope,now)).toBe(false);
    for(const change of [{owner:`0x${'22'.repeat(20)}`},{activeSwap:scope},
      {charges:original.charges.map((c,i)=>i===3?{...c,hash:`0x${'44'.repeat(32)}`}:c)},
      {charges:original.charges.map((c,i)=>i===2?{...c,nonce:138}:c)}]) {
      const other={};restoreCurrentNativeSwapCheckpoint(other,(change as {owner?:string}).owner??CURRENT_APP_SWAP_OWNER,current,{...original,...change});
      expect(renewCurrentNativeSwapClosedWindow(other,CURRENT_APP_SWAP_OWNER,current,scope,now)).toBe(false);
    }
    expect(renewCurrentNativeSwapClosedWindow(signer,CURRENT_APP_SWAP_OWNER,current,scope,now-1n)).toBe(false);
    expect(renewCurrentNativeSwapClosedWindow(signer,CURRENT_APP_SWAP_OWNER,current,`quote:0x${'99'.repeat(32)}`,now)).toBe(false);
    expect(renewCurrentNativeSwapClosedWindow(signer,CURRENT_APP_SWAP_OWNER,current,scope,now)).toBe(true);
    const renewed=currentNativeSwapCheckpoint(signer);
    expect(renewed).toEqual({...original,windowStart:String(now)});
    expect(renewCurrentNativeSwapClosedWindow(signer,CURRENT_APP_SWAP_OWNER,current,scope,now+1n)).toBe(false);
    const restored={};restoreCurrentNativeSwapCheckpoint(restored,CURRENT_APP_SWAP_OWNER,current,renewed);
    expect(renewCurrentNativeSwapClosedWindow(restored,CURRENT_APP_SWAP_OWNER,current,scope,now+limits.normalSeconds-1n)).toBe(false);
    expect(renewCurrentNativeSwapClosedWindow(restored,CURRENT_APP_SWAP_OWNER,current,scope,now+limits.normalSeconds)).toBe(true);
    expect(currentNativeSwapCheckpoint(restored)).toEqual({...original,windowStart:String(now+limits.normalSeconds)});
    expect(renewCurrentNativeSwapClosedWindow(restored,CURRENT_APP_SWAP_OWNER,current,scope,now+limits.normalSeconds+1n)).toBe(false);
    const next=currentNativeSigningBudget(restored,CURRENT_APP_SWAP_OWNER,()=>now+limits.normalSeconds+1n,current),newScope=`quote:0x${'77'.repeat(32)}`;
    expect(()=>next.check('quote',newScope,110_000_000n,newScope)).not.toThrow();
    next.commit('quote',newScope,110_000_000n,newScope,141);
    completeCurrentNativeSwapScope(restored,newScope);
    expect(renewCurrentNativeSwapClosedWindow(restored,CURRENT_APP_SWAP_OWNER,current,scope,now+2n*limits.normalSeconds)).toBe(false);
    expect(()=>next.check('quote',`quote:0x${'88'.repeat(32)}`,110_000_000n)).toThrow('reserved');
    expect(CURRENT_APP_REPLACEMENT_TRIAL.totalFeeCeilingWei).toBe(60_000_000_000_000_000n);
  });
  it('renews an expired confirmed funding window once and keeps every original reservation across reload',()=>{
    const signer={},owner=`0x${'22'.repeat(20)}`,oldScope=`quote:0x${'11'.repeat(32)}`,scope=`quote:0x${'77'.repeat(32)}`;
    const budget=currentNativeSigningBudget(signer,owner,()=>100n,current);
    budget.commit('token-faucet',`token-faucet:${oldScope}:0x${'22'.repeat(32)}`,5_000_000n,oldScope,4);
    recordCurrentNativeSwapHash(signer,4,`0x${'22'.repeat(32)}`,`0x${'33'.repeat(32)}`);
    const original=currentNativeSwapCheckpoint(signer);
    expect(()=>currentNativeSigningBudget(signer,owner,()=>1950n,current).check('quote',scope,110_000_000n,scope)).toThrow('expiry');
    renewCurrentNativeSwapFundingWindow(signer,owner,current,scope,1950n);
    const renewed=currentNativeSwapCheckpoint(signer);
    expect(renewed).toEqual({...original,activeSwap:scope,windowStart:'1950'});
    expect(()=>renewCurrentNativeSwapFundingWindow(signer,owner,current,`quote:0x${'88'.repeat(32)}`,2850n)).toThrow('renew');
    const restored={};restoreCurrentNativeSwapCheckpoint(restored,owner,current,renewed);
    const next=currentNativeSigningBudget(restored,owner,()=>1951n,current);
    expect(next.snapshot()).toMatchObject({signingStarts:1,committedWei:260_000_000_000_000n,normalExpiresAt:2850n,recoveryExpiresAt:3750n});
    expect(()=>next.check('token-faucet',original.charges[0].key,5_000_000n,oldScope)).toThrow();
    next.commit('quote',scope,110_000_000n,scope,5);
    expect(currentNativeSwapCheckpoint(restored)).toMatchObject({start:'100',windowStart:'1950',committedWei:'5980000000000000'});
    expect(()=>validateCurrentNativeSwapCheckpoint(currentNativeSwapCheckpoint(restored),owner,current)).not.toThrow();
    expect(()=>currentNativeSigningBudget(restored,owner,()=>2850n,current).check('accept',`accept:${scope}`,35_000_000n,scope)).toThrow('expiry');
    expect(()=>currentNativeSigningBudget(restored,owner,()=>3750n,current).check('recover',`recover:${scope}`,50_000_000n,scope)).toThrow('expiry');
  });
  it('rejects renewal without exact expired confirmed funding and validates the saved window',()=>{
    const signer={},owner=`0x${'22'.repeat(20)}`,oldScope=`quote:0x${'11'.repeat(32)}`,scope=`quote:0x${'77'.repeat(32)}`;
    const budget=currentNativeSigningBudget(signer,owner,()=>100n,current);
    expect(()=>renewCurrentNativeSwapFundingWindow(signer,owner,current,scope,1950n)).toThrow('renewal');
    budget.commit('token-funding',`token-funding:${oldScope}:0x${'22'.repeat(32)}`,5_000_000n,oldScope,4);
    expect(()=>renewCurrentNativeSwapFundingWindow(signer,owner,current,scope,1950n)).toThrow('renewal');
    recordCurrentNativeSwapHash(signer,4,`0x${'22'.repeat(32)}`,`0x${'33'.repeat(32)}`);
    const saved=currentNativeSwapCheckpoint(signer);
    for(const [who,candidate,newScope,now] of [
      [owner,current,scope,999n],[`0x${'44'.repeat(20)}`,current,scope,1950n],
      [owner,native,scope,1950n],[owner,{...current,packageSha256:'00'},scope,1950n],
      [owner,current,oldScope,1950n],[owner,current,'quote:invalid',1950n],
    ] as const)expect(()=>renewCurrentNativeSwapFundingWindow(signer,who,candidate,newScope,now)).toThrow();
    expect(currentNativeSwapCheckpoint(signer)).toEqual(saved);
    for(const windowStart of ['999','-1','01950',undefined,1950])
      expect(()=>validateCurrentNativeSwapCheckpoint({...saved,windowStart} as never,owner,current)).toThrow();
    budget.commit('quote',oldScope,110_000_000n,oldScope,5);
    expect(()=>renewCurrentNativeSwapFundingWindow(signer,owner,current,scope,1950n)).toThrow('renewal');
    const poolSigner={};currentNativeSigningBudget(poolSigner,owner,()=>100n).commit('pool-preview','pool',100_000_000n);
    expect(()=>renewCurrentNativeSwapFundingWindow(poolSigner,owner,current,scope,1950n)).toThrow('renewal');
  });
  it('binds a fresh Quote after confirmed funding without changing charges or original time bounds',()=>{
    const signer={},owner=`0x${'22'.repeat(20)}`,oldScope=`quote:0x${'11'.repeat(32)}`,newScope=`quote:0x${'77'.repeat(32)}`,
      budget=currentNativeSigningBudget(signer,owner,()=>100n,current),key=`token-funding:${oldScope}:0x${'22'.repeat(32)}`;
    budget.commit('token-funding',key,5_000_000n,oldScope,4);
    expect(()=>bindCurrentNativeSwapFundingScope(signer,newScope)).toThrow('confirmed');
    recordCurrentNativeSwapHash(signer,4,`0x${'22'.repeat(32)}`,`0x${'33'.repeat(32)}`);
    const before=currentNativeSwapCheckpoint(signer);
    bindCurrentNativeSwapFundingScope(signer,newScope);
    expect(currentNativeSwapCheckpoint(signer)).toMatchObject({start:before.start,committedWei:before.committedWei,charges:before.charges,activeSwap:newScope});
    budget.commit('quote',newScope,110_000_000n,newScope,5);
    expect(()=>validateCurrentNativeSwapCheckpoint(currentNativeSwapCheckpoint(signer),owner,current)).not.toThrow();
    expect(()=>bindCurrentNativeSwapFundingScope(signer,oldScope)).toThrow('confirmed');
  });
  it('keeps the exact approval in the same authenticated single-swap budget across reload', () => {
    const owner='0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d', signer={}, scope=`quote:0x${'11'.repeat(32)}`,
      key=`token-funding:${scope}:0x${'22'.repeat(32)}`, budget=currentNativeSigningBudget(signer,owner,()=>100n,current);
    const claimScope=`quote:0x${'55'.repeat(32)}`,claimKey=`token-faucet:${claimScope}:0x${'55'.repeat(32)}`;
    budget.commit('token-faucet',claimKey,5_000_000n,claimScope,3);
    recordCurrentNativeSwapHash(signer,3,`0x${'55'.repeat(32)}`,`0x${'66'.repeat(32)}`);
    expect(()=>budget.check('token-faucet',claimKey,5_000_000n,claimScope)).toThrow();
    budget.commit('token-funding',key,5_000_000n,scope,4);
    recordCurrentNativeSwapHash(signer,4,`0x${'22'.repeat(32)}`,`0x${'33'.repeat(32)}`);
    const saved=currentNativeSwapCheckpoint(signer);
    expect(saved.committedWei).toBe('520000000000000');
    const restored={};restoreCurrentNativeSwapCheckpoint(restored,owner,current,saved);
    const next=currentNativeSigningBudget(restored,owner,()=>101n,current);
    expect(()=>next.check('token-funding',key,5_000_000n,scope)).toThrow();
    expect(()=>next.check('quote',`quote:0x${'44'.repeat(32)}`,110_000_000n)).toThrow();
    next.commit('quote',scope,110_000_000n,scope,5);
    completeCurrentNativeSwapScope(restored,scope);
    expect(()=>next.check('quote',`quote:0x${'44'.repeat(32)}`,110_000_000n)).toThrow();
  });
  it('keeps legacy 50M charges and new 52M recovery in one exact authenticated total', () => {
    const owner = `0x${'22'.repeat(20)}`, scope = `quote:0x${'11'.repeat(32)}`, signer = {};
    const legacy = { version: 1 as const, owner, candidateGraph: current.graph, start: '100',
      committedWei: '5500000000000000', activeSwap: scope,
      charges: [{ phase: 'quote' as const, key: scope, scope, gasCap: '110000000', nonce: 4, hash: `0x${'33'.repeat(32)}` }] };
    expect(() => validateCurrentNativeSwapCheckpoint(legacy, owner, current)).not.toThrow();
    restoreCurrentNativeSwapCheckpoint(signer, owner, current, legacy);
    const budget = currentNativeSigningBudget(signer, owner, () => 101n, current);
    budget.commit('recover', `recover:${scope}`, 50_000_000n, scope, 5);
    const mixed = currentNativeSwapCheckpoint(signer);
    expect(mixed.charges[0]).not.toHaveProperty('gasPrice'); expect(mixed.charges[1].gasPrice).toBe('52000000');
    expect(mixed.committedWei).toBe('8100000000000000');
    const restored = {}; restoreCurrentNativeSwapCheckpoint(restored, owner, current, mixed);
    expect(currentNativeSigningBudget(restored, owner, () => 101n, current).snapshot()).toMatchObject({ committedWei: 8_100_000_000_000_000n, signingStarts: 2, normalExpiresAt: 1000n });
    expect(() => validateCurrentNativeSwapCheckpoint({ ...mixed, committedWei: '8320000000000000' }, owner, current)).toThrow('totals');
    expect(() => validateCurrentNativeSwapCheckpoint(mixed, owner, native)).toThrow('invalid');
    expect(() => validateCurrentNativeSwapCheckpoint(mixed, owner, { ...current, packageSha256: '00' })).toThrow('identity changed');
    for (const gasPrice of ['50000000', '52000001', '052000000', '0', undefined, 52000000]) {
      expect(() => validateCurrentNativeSwapCheckpoint({ ...mixed, charges: [{ ...mixed.charges[0], gasPrice }] } as never, owner, current)).toThrow('charge');
    }
  });
  it('restores all charged starts, original expiry and duplicate scope without a budget reset',()=>{
    const signer={},scope=`quote:0x${'11'.repeat(32)}`,owner=`0x${'22'.repeat(20)}`;
    const first=currentNativeSigningBudget(signer,owner,()=>100n,current);first.commit('quote',scope,110_000_000n,scope,4);
    recordCurrentNativeSwapHash(signer,4,scope.slice(6),`0x${'33'.repeat(32)}`);
    first.commit('accept',`accept:${scope}`,35_000_000n,scope,5);
    const checkpoint=currentNativeSwapCheckpoint(signer),secondSigner={};
    expect(checkpoint.charges[1].hash).toBeNull();restoreCurrentNativeSwapCheckpoint(secondSigner,owner,current,checkpoint);
    const second=currentNativeSigningBudget(secondSigner,owner,()=>600n,current);
    expect(second.snapshot()).toMatchObject({signingStarts:2,committedWei:7_540_000_000_000_000n,normalExpiresAt:1000n,recoveryExpiresAt:1900n});
    expect(()=>second.check('accept',`accept:${scope}`,35_000_000n,scope)).toThrow();
    expect(()=>currentNativeSigningBudget(secondSigner,owner,()=>1900n,current).check('recover',`recover:${scope}`,50_000_000n,scope)).toThrow('expiry');
    expect(()=>validateCurrentNativeSwapCheckpoint({...checkpoint,committedWei:'1'},owner,current)).toThrow('totals');
    expect(()=>validateCurrentNativeSwapCheckpoint({...checkpoint,charges:[{...checkpoint.charges[0],scope:'private:20'}]},owner,current)).toThrow('charge');
    expect(()=>restoreCurrentNativeSwapCheckpoint(secondSigner,owner,current,{...checkpoint,start:'200'})).toThrow('differs');
    expect(JSON.stringify(checkpoint)).not.toMatch(/maximumInput|minimumInput|rateNumerator|ciphertext|aesKey/);
  });
  it('uses the exact b2aa technical identity and tested raw bounds while its App hold remains active', () => {
    expect(usesCurrentNativeSwapChecks(current)).toBe(true);
    expect(() => assertCurrentSwapIdentity(current)).not.toThrow();
    expect(CURRENT_EXIT_SWAP_LIMITS).toEqual({ maximumInput: 20_000_000n,
      maximumToleranceBps: 50, normalSeconds: 900n });
    expect(() => assertCurrentSwapCandidate(current)).toThrow('connected App-wallet hold');
    expect(() => assertCurrentNativeSwapIntent({ intent: { candidate: current } } as unknown as CurrentCheapDexPreparedQuote, 100n))
      .toThrow('connected App-wallet hold');
  });
  it.each(['core', 'packageSha256', 'releaseId', 'reviewedTokenSet', 'attestationSha256'])('rejects changed b2aa %s identity', field => {
    expect(() => assertCurrentSwapIdentity({ ...current, [field]: '0x00' })).toThrow('identity changed');
  });
  it('keeps b2aa signed user caps inside the original finite budget without adding funding authority', () => {
    const signer = {}, budget = currentNativeSigningBudget(signer, 'owner', () => 100n, current);
    budget.commit('quote', 'q', 110_000_000n);
    budget.commit('accept', 'a', 110_000_000n, 'q');
    expect(budget.snapshot()).toMatchObject({ signingStarts: 2, committedWei: 11_440_000_000_000_000n });
    expect(() => budget.check('token-funding', 't', 5_000_000n)).toThrow('phase or gas cap');
    expect(() => budget.check('recover', 'r', 110_000_000n, 'q')).toThrow('phase or gas cap');
    expect(() => currentNativeSigningBudget(signer, 'owner', () => 100n).check('quote', 'old', 70_000_000n)).toThrow('candidate changed');
    budget.commit('recover', 'r', 50_000_000n, 'q');
    expect(budget.snapshot().committedWei).toBe(14_040_000_000_000_000n);
  });
  it('does not reset earlier funding commitments by selecting b2aa', () => {
    const signer = {}, old = currentNativeSigningBudget(signer, 'owner', () => 100n);
    old.commit('token-funding', 't', 5_000_000n);
    expect(() => currentNativeSigningBudget(signer, 'owner', () => 100n, current).check('quote', 'q', 110_000_000n)).toThrow('candidate changed');
    expect(old.snapshot()).toMatchObject({ signingStarts: 1, committedWei: 250_000_000_000_000n });
  });
  it('admits only exact native identity for swaps while the owner/funding gate stays held', () => {
    expect(() => assertCurrentSwapCandidate(native)).not.toThrow();
    expect(() => assertCurrentCheapDexNativeAdmission(native)).toThrow('admission is absent');
  });
  it.each(['packageSha256', 'core', 'releaseId', 'attestationSha256', 'reviewedTokenSet', 'marketId'])('rejects changed %s identity', field => {
    expect(() => assertCurrentSwapCandidate({ ...native, [field]: '00'.repeat(32) })).toThrow();
  });
  it.each(['amount', 'tolerance', 'expiry', 'lifetime', 'candidate', 'minimum'])('rejects native %s protection drift', fault => {
    const intent = { candidate: native, quoteProtocol: 'quote-slippage', toleranceBps: 50, maximumInput: 100n,
      minimumInput: 1n, minimumOutput: 1n, rateNumerator: 0n, rateDenominator: 1n, deadline: 200n };
    if (fault === 'amount') intent.maximumInput = limits.maximumInput + 1n;
    if (fault === 'tolerance') intent.toleranceBps = 51;
    if (fault === 'expiry') intent.deadline = 100n;
    if (fault === 'lifetime') intent.deadline = 1001n;
    if (fault === 'candidate') Object.assign(intent, { candidate: { ...native, feePpm: 1 } });
    if (fault === 'minimum') intent.minimumInput = 101n;
    expect(() => assertCurrentNativeSwapIntent({ intent } as unknown as CurrentCheapDexPreparedQuote, 100n)).toThrow();
  });
  it('does not reuse or refund a signing-start commitment and shares concurrent handles', () => {
    const signer = {}, a = currentNativeSigningBudget(signer, 'owner', () => 100n), b = currentNativeSigningBudget(signer, 'owner', () => 100n);
    a.check('quote', 'first', 70_000_000n); b.check('quote', 'second', 70_000_000n);
    a.commit('quote', 'first', 70_000_000n);
    expect(() => b.commit('quote', 'second', 70_000_000n)).toThrow();
    expect(() => a.commit('quote', 'first', 70_000_000n)).toThrow();
    expect(b.snapshot()).toMatchObject({ signingStarts: 1, committedWei: 3_500_000_000_000_000n });
    expect(() => currentNativeSigningBudget(signer, 'other', () => 100n).check('accept', 'accept', 85_000_000n)).toThrow();
  });
  it('reserves one recovery attempt and its full fixed-fee cap, including future token integration', () => {
    const budget = currentNativeSigningBudget({}, 'owner', () => 100n);
    budget.commit('quote', 'q', 65_000_000n);
    for (let i = 0; i < 6; i++) budget.commit('token-funding', `t${i}`, 10_000_000n);
    expect(() => budget.commit('accept', 'a', 35_000_000n)).toThrow();
    budget.commit('recover', 'r', 50_000_000n, 'q');
    expect(budget.snapshot().signingStarts).toBe(8);
    expect(() => budget.commit('cancel', 'c', 20_000_000n)).toThrow();
  });
  it('rejects financial overspend without consuming a start', () => {
    const budget = currentNativeSigningBudget({}, 'owner', () => 100n);
    for (let i = 0; i < 7; i++) budget.commit('token-funding', `t${i}`, 100_000_000n);
    expect(() => budget.commit('quote', 'q', 70_000_000n)).toThrow();
    expect(budget.snapshot().committedWei).toBe(35_000_000_000_000_000n);
  });
  it('expires normal authority, retains bounded direct recovery, and never renews from a new handle', () => {
    let clock = 100n; const signer = {}, budget = currentNativeSigningBudget(signer, 'owner', () => clock);
    budget.commit('quote', 'q', 65_000_000n); clock = 1000n;
    expect(() => currentNativeSigningBudget(signer, 'owner', () => clock).check('accept', 'a', 35_000_000n)).toThrow();
    budget.commit('recover', 'r', 50_000_000n, 'q'); clock = 1900n;
    expect(() => budget.check('recover', 'r2', 50_000_000n, 'q')).toThrow();
  });
});

describe('Pool scope shares the existing signer budget', () => {
  const join=(signer:object,b:ReturnType<typeof currentNativeSigningBudget>)=>{
    b.commit('pool-preview','p',100_000_000n);b.commit('token-funding','token-funding:approve:t0',5_000_000n);
    b.commit('token-funding','token-funding:approve:t1',5_000_000n);b.commit('pool-fund','f',100_000_000n,'p');
    recordCurrentNativePoolOutcome(signer,'p','funded');
  };
  it('eight Pool phases include one bounded replacement without a new budget',()=>{
    const signer={},b=currentNativeSigningBudget(signer,'owner',()=>100n);join(signer,b);
    b.commit('pool-active-snapshot','s',30_000_000n,'p');b.commit('pool-active-snapshot','s2',30_000_000n,'p');expect(()=>b.commit('pool-active-snapshot','s3',30_000_000n,'p')).toThrow();b.commit('pool-close','c',70_000_000n,'p');recordCurrentNativePoolOutcome(signer,'p','closed');
    b.commit('pool-closed-snapshot','z',30_000_000n,'p');expect(b.snapshot()).toMatchObject({signingStarts:8,committedWei:18_500_000_000_000_000n,poolRemainingTailWei:0n});
    expect(()=>b.commit('pool-closed-snapshot','again',30_000_000n,'p')).toThrow();
  });
  it('two prior swap starts reject preview before spending or consuming a start',()=>{
    const signer={},b=currentNativeSigningBudget(signer,'owner',()=>100n);b.commit('quote','q',65_000_000n);b.commit('accept','a',35_000_000n,'q');completeCurrentNativeSwapScope(signer,'q');
    expect(()=>b.commit('pool-preview','p',100_000_000n)).toThrow();expect(b.snapshot().signingStarts).toBe(2);
  });
  it('even one prior claim rejects Pool before preview because all eight starts are reserved',()=>{
    const signer={},b=currentNativeSigningBudget(signer,'owner',()=>100n);b.commit('token-funding','claim',5_000_000n);
    expect(()=>b.commit('pool-preview','p',100_000_000n)).toThrow();expect(b.snapshot().signingStarts).toBe(1);
  });
  it('failed second approval keeps only two bounded unfunded cleanup starts after normal expiry',()=>{
    let now=100n;const signer={},b=currentNativeSigningBudget(signer,'owner',()=>now);
    b.commit('pool-preview','p',100_000_000n);b.commit('token-funding','token-funding:approve:t0',5_000_000n);b.commit('token-funding','token-funding:approve:t1',5_000_000n);
    recordCurrentNativePoolOutcome(signer,'p','unfunded-failed');now=1000n;
    b.commit('pool-cleanup','clear0',5_000_000n,'p');b.commit('pool-cleanup','clear1',5_000_000n,'p');
    expect(()=>b.commit('pool-fund','fund',100_000_000n,'p')).toThrow();expect(()=>b.commit('pool-cleanup','retry',5_000_000n,'p')).toThrow();expect(b.snapshot().signingStarts).toBe(5);
  });
  it('funded tail remains executable after normal expiry but cannot clear or extend its window',()=>{
    let now=100n;const signer={},b=currentNativeSigningBudget(signer,'owner',()=>now);join(signer,b);now=1000n;
    b.commit('pool-active-snapshot','s',30_000_000n,'p');expect(()=>b.commit('pool-cleanup','clear',5_000_000n,'p')).toThrow();
    b.commit('pool-close','c',70_000_000n,'p');recordCurrentNativePoolOutcome(signer,'p','closed');now=1900n;
    expect(()=>b.commit('pool-closed-snapshot','z',30_000_000n,'p')).toThrow();expect(currentNativeSigningBudget(signer,'owner',()=>now).snapshot().signingStarts).toBe(6);
  });
  it('reserves four normal actions, blocks other activity and never resets committed costs', () => {
    const signer = {}, b = currentNativeSigningBudget(signer, 'owner', () => 100n);
    b.commit('pool-preview', 'p', 100_000_000n);
    expect(() => b.commit('quote', 'q', 70_000_000n)).toThrow();
    expect(() => b.commit('token-funding', 'token-funding:faucet:t', 5_000_000n)).toThrow();
    b.commit('token-funding', 'token-funding:approve:t0', 5_000_000n);
    b.commit('token-funding', 'token-funding:approve:t1', 5_000_000n);
    expect(() => b.commit('token-funding', 'token-funding:approve:t2', 5_000_000n)).toThrow();
    expect(() => b.commit('pool-fund', 'f', 100_000_000n, 'other')).toThrow();
    b.commit('pool-fund', 'f', 100_000_000n, 'p');
    expect(b.snapshot()).toMatchObject({ signingStarts: 4, committedWei: 10_500_000_000_000_000n });
    completeCurrentNativePoolScope(signer, 'p');
    expect(() => b.commit('pool-preview', 'p2', 100_000_000n)).toThrow();
    expect(currentNativeSigningBudget(signer, 'owner', () => 100n).snapshot().signingStarts).toBe(4);
  });
  it('does not create a new budget or lifetime for Pool work after earlier token actions', () => {
    let clock = 100n; const signer = {}, b = currentNativeSigningBudget(signer, 'owner', () => clock);
    for (let i = 0; i < 4; i++) b.commit('token-funding', `t${i}`, 5_000_000n);
    expect(() => b.check('pool-preview', 'p', 100_000_000n)).toThrow();
    clock = 1000n;
    expect(() => currentNativeSigningBudget(signer, 'owner', () => clock).check('pool-preview', 'p', 100_000_000n)).toThrow();
  });
});


it('allows distinct swaps only after terminal completion within the same finite budget',()=>{
  const signer={},budget=currentNativeSigningBudget(signer,'owner',()=>100n);
  budget.commit('quote','q1',70_000_000n);
  expect(()=>budget.commit('quote','q2',65_000_000n)).toThrow();
  budget.commit('accept','a1',85_000_000n,'q1');completeCurrentNativeSwapScope(signer,'q1');
  budget.commit('quote','q2',65_000_000n);budget.commit('accept','a2',35_000_000n,'q2');
  expect(budget.snapshot()).toMatchObject({signingStarts:4,committedWei:12_750_000_000_000_000n});
  expect(()=>budget.commit('accept','a1',85_000_000n,'q2')).toThrow();
});

it('unsigned abandonment preserves the original costs and admits only two bounded cleanup starts',()=>{
  let clock=100n;const signer={},b=currentNativeSigningBudget(signer,'owner',()=>clock);
  b.commit('pool-preview','p',100_000_000n);b.commit('token-funding','token-funding:approve:a',5_000_000n);b.commit('token-funding','token-funding:approve:b',5_000_000n);
  clock=1001n;const before=b.snapshot();expect(()=>b.assertUnfundedAbandon('p')).not.toThrow();expect(b.snapshot()).toEqual(before);
  recordCurrentNativePoolOutcome(signer,'p','unfunded-failed');b.commit('pool-cleanup','a',5_000_000n,'p');b.commit('pool-cleanup','b',5_000_000n,'p');
  expect(()=>b.commit('pool-cleanup','c',5_000_000n,'p')).toThrow();expect(()=>b.commit('pool-fund','f',100_000_000n,'p')).toThrow();
  completeCurrentNativePoolScope(signer,'p');expect(b.snapshot()).toMatchObject({signingStarts:5,committedWei:6_000_000_000_000_000n});
  expect(()=>b.commit('pool-preview','again',100_000_000n)).toThrow();
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
    restoreCurrentNativeSwapCheckpoint(reloaded,CURRENT_APP_SWAP_OWNER,history,saved);
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
    expect(()=>currentNativeSigningBudget({},CURRENT_APP_SWAP_OWNER,()=>ownerBeta.activation.activatedAt,history).check('quote',s,110_000_000n)).toThrow();
    for(const change of [{charges:legacy.charges.slice(1)},{committedWei:'0'},{charges:legacy.charges.map((row,i)=>i===13?{...row,hash:`0x${'f'.repeat(64)}`}:row)}])
      expect(()=>restoreCurrentNativeSwapCheckpoint({},CURRENT_APP_SWAP_OWNER,history,{...legacy,...change})).toThrow();
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
    for(const profile of ['fast-pool','cheap-async']) {
      const intent={candidate:history,principal:CURRENT_APP_SWAP_OWNER,destination:CURRENT_APP_SWAP_OWNER,inputToken:history.tokenMetadata[3].address,outputToken:history.tokenMetadata[2].address,
        profile,quoteProtocol:'quote-slippage',maximumInput:20_000_000n,minimumInput:1n,minimumOutput:2n,rateNumerator:1n,rateDenominator:2n,toleranceBps:50,deadline:ownerBeta.activation.activatedAt+900n};
      const check=(change:object={})=>assertCurrentNativeSwapIntent({intent:{...intent,...change}} as unknown as CurrentCheapDexPreparedQuote,ownerBeta.activation.activatedAt);
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
