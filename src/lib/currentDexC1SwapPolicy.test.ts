import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
const beta = vi.hoisted(() => ({ active: false }));
vi.mock('./currentDexOwnerBetaPolicy', async importOriginal => {
  const actual = await importOriginal<typeof import('./currentDexOwnerBetaPolicy')>();
  return { ...actual, isCurrentOwnerBeta: (graph: string, owner: string) => beta.active && graph === actual.CURRENT_OWNER_BETA.graph && owner.toLowerCase() === actual.CURRENT_OWNER_BETA.owner };
});
afterEach(() => { beta.active = false; });
import { STAGED_D06_DEX_CANDIDATE as d06, STAGED_NATIVE_DEX_CANDIDATE as historical,
  assertCurrentCheapDexNativeAdmission } from './dexV2Deployment';
import { CURRENT_D06_SWAP_GAS_CAPS as caps, assertCurrentD06AppAuthority, assertCurrentAppSharedFundingAuthority, assertCurrentAppLimitAuthority, assertCurrentAppPoolAuthority, assertCurrentAppPoolAllowanceCleanupAuthority, CURRENT_APP_POOL_ENGINEERING_OWNERS, isCurrentAppCanonicalClaimRepair, isCurrentAppLimitTopUpRepair, assertCurrentAppSigningCount, currentAppSigningStartLimit, CURRENT_APP_SWAP_OWNER, CURRENT_APP_REPLACEMENT_TRIAL, CURRENT_APP_FURTHER_TRIAL } from './currentDexC1SwapPolicy';
import { currentCheapDexGasCaps } from './currentDexSubmission';
import { assertCurrentSwapCandidate, isCurrentNativeSwapCandidate, usesCurrentNativeSwapChecks } from './currentDexNativeSwapPolicy';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE as current } from './currentDexExitCandidate';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as history } from './currentDexHistoryCandidate';
import { CURRENT_APP_PARTIAL_REFUND_TRIAL, hasCurrentPartialRefundProof } from './currentDexC1SwapPolicy';

const partialRefundPrior = [
  ['token-funding',148,'0x5de03c3f32ef5d7334d1a4541d9f03020dc3ec43931289af7551c563b7038e82'],
  ['quote',149,'0x6ad6c432b2d25a11a32bbc2bb16ebd0ee920f876da37fcc0b0857d8026b55874'],
  ['accept',150,'0x70a2e7345f4e192144b7120e56ff3e5ca2de45af7d3ccce55372a6d47d704f11'],
  ['recover',151,'0x63c23cf27c534f777428e61d3be280867a5f9ee57b1660c03c4457864331a13d'],
  ['token-funding',152,'0x904fcfd8ec833aaf8a6b213ca1de020b2ed5e1814acb9b6219c8f03e16ffe488'],
  ['quote',153,'0xdc7b017f0221f7eafe4a2cea43fe9c7db8c0262dea2461d8cedc864155c859dc'],
  ['accept',154,'0x10f7ac072e6a3b456c08df45b434ee075538899b128270a6603e54b4816f1bbe'],
  ['token-funding',162,'0xf5ceb9ebb0c8c24ef65f3746254574f5525ec6179ddc92379bd0e64b3f1fa708'],
  ['quote',163,'0x26dcfd82ad6dc1fd2da514ec0079bd5a6e9a4765a30f3b5d454ea76549458fe6'],
  ['quote',164,'0xb95911ec63dd48c89c266faa2498640f80edecb9afe9aefea9b23018266fe432'],
  ['accept',165,'0x2af62aa18799348b848617c93a64515f482d7179b610a209d6a8aa684dc655e2']
].map(([phase,nonce,hash])=>({phase:phase as string,nonce:nonce as number,hash:hash as string,scope:`quote:0x${'77'.repeat(32)}`}));

const root = new URL('../../../ChainWhisper Contracts V2/validation/candidates/core-advance-boundary-2026-10-06/', import.meta.url);
describe('d06 phase ceilings and separate authority', () => {
  it('retains all eleven starts and admits six more only after exact completed Fast7 proof',()=>{
    expect(CURRENT_APP_PARTIAL_REFUND_TRIAL).toMatchObject({approvedAt:1792441435n,expiresAt:1792448635n,
      maximumInput:3n,additionalSigningStarts:6,retainedLedgerStarts:11,maximumSigningStarts:17,
      additionalOwnerGas:235_000_000n,additionalOwnerCommitmentWei:11_750_000_000_000_000n});
    expect(hasCurrentPartialRefundProof(history.graph,CURRENT_APP_SWAP_OWNER,partialRefundPrior)).toBe(true);
    expect(currentAppSigningStartLimit(history.graph,CURRENT_APP_SWAP_OWNER,partialRefundPrior,8)).toBe(17);
    expect(hasCurrentPartialRefundProof(history.graph,CURRENT_APP_SWAP_OWNER,partialRefundPrior.slice(0,10))).toBe(false);
    for(let i=0;i<11;i++)for(const changed of [{hash:`0x${'99'.repeat(32)}`},{nonce:999}]) {
      const rows=partialRefundPrior.map((row,index)=>index===i?{...row,...changed}:row);
      expect(hasCurrentPartialRefundProof(history.graph,CURRENT_APP_SWAP_OWNER,rows)).toBe(false);
      expect(currentAppSigningStartLimit(history.graph,CURRENT_APP_SWAP_OWNER,rows,8)).not.toBe(17);
    }
    for(const scope of ['',undefined,`quote:0x${'88'.repeat(32)}`])expect(hasCurrentPartialRefundProof(history.graph,CURRENT_APP_SWAP_OWNER,
      partialRefundPrior.map((row,i)=>i===10?{...row,scope}:row))).toBe(false);
    for(const [graph,owner] of [[current.graph,CURRENT_APP_SWAP_OWNER],[history.graph,history.core],
      [history.graph,'0x8b749251cf1f712d4e39fd048c53394af03e10be']]){
      expect(hasCurrentPartialRefundProof(graph,owner,partialRefundPrior)).toBe(false);
      expect(currentAppSigningStartLimit(graph,owner,partialRefundPrior,8)).toBe(8);
    }
  });
  it('caps only the new six starts and rejects duplicate phases, faucet and Pool actions',()=>{
    for(const [phase,maximum] of [['quote',1],['accept',1],['cancel',1],['recover',1],['token-funding',2]] as const){
      const suffix=Array.from({length:maximum-1},()=>({phase}));
      expect(()=>assertCurrentAppSigningCount(history.graph,CURRENT_APP_SWAP_OWNER,phase,[...partialRefundPrior,...suffix])).not.toThrow();
      expect(()=>assertCurrentAppSigningCount(history.graph,CURRENT_APP_SWAP_OWNER,phase,[...partialRefundPrior,...suffix,{phase}])).toThrow('reserved');
    }
    for(const phase of ['token-faucet','pool-create','pool-snapshot','unknown','constructor','__proto__'])
      expect(()=>assertCurrentAppSigningCount(history.graph,CURRENT_APP_SWAP_OWNER,phase,partialRefundPrior)).toThrow('reserved');
    const suffix=['token-funding','quote','accept','cancel','recover','token-funding'].map(phase=>({phase}));
    expect(currentAppSigningStartLimit(history.graph,CURRENT_APP_SWAP_OWNER,[...partialRefundPrior,...suffix],8)).toBe(17);
    for(const phase of ['quote','accept','cancel','recover','token-funding'])
      expect(()=>assertCurrentAppSigningCount(history.graph,CURRENT_APP_SWAP_OWNER,phase,[...partialRefundPrior,...suffix])).toThrow('reserved');
    expect(()=>assertCurrentAppSigningCount(history.graph,CURRENT_APP_SWAP_OWNER,'accept',
      [...partialRefundPrior,{phase:'quote'},{phase:'quote'}])).toThrow('reserved');
  });
  it('limits the approved top-up receipt repair to its exact owner, candidate, mined identity and amount',()=>{
    const proof={graph:history.graph,owner:CURRENT_APP_SWAP_OWNER,core:history.core,hash:'0x99d43c33f95061f794fe6ead07e2eb2c2305653788974235398b70d797347a5f',nonce:205,blockNumber:10152730,blockHash:'0x8c96934c343ac7193f3cb35679e327bb858208b01b42ba7c573f4f445d7a89fa',positionId:55n,amount:250000n};
    expect(isCurrentAppLimitTopUpRepair(proof)).toBe(true);
    for(const change of [{graph:current.graph},{owner:history.core},{core:CURRENT_APP_SWAP_OWNER},{hash:`0x${'99'.repeat(32)}`},{nonce:206},{blockNumber:10152729},{blockHash:`0x${'88'.repeat(32)}`},{positionId:54n},{amount:250001n}])expect(isCurrentAppLimitTopUpRepair({...proof,...change})).toBe(false);
  });
  it('limits zero-allowance cleanup to the current graph and admitted Pool owners', () => {
    for (const owner of CURRENT_APP_POOL_ENGINEERING_OWNERS) expect(() => assertCurrentAppPoolAllowanceCleanupAuthority(history.graph, owner)).not.toThrow();
    expect(() => assertCurrentAppPoolAllowanceCleanupAuthority(current.graph, CURRENT_APP_SWAP_OWNER)).toThrow('hold');
    expect(() => assertCurrentAppPoolAllowanceCleanupAuthority(history.graph, history.core)).toThrow('hold');
    expect(() => assertCurrentAppPoolAuthority(history.graph, { owner: CURRENT_APP_SWAP_OWNER, action: 'create' })).toThrow('hold');
    expect(() => assertCurrentAppSigningCount(history.graph, CURRENT_APP_SWAP_OWNER, 'quote', [{ phase: 'quote' }])).toThrow('reserved');
  });
  it('admits authorized owner funding for four tokens without renewing consumed swaps', () => {
    for (const token of history.tokenMetadata) for (const action of ['initial', 'refill']) {
      expect(() => assertCurrentAppSharedFundingAuthority(history.graph, CURRENT_APP_SWAP_OWNER, token.address, action)).not.toThrow();
      for (const invalid of [
        [current.graph, CURRENT_APP_SWAP_OWNER, token.address, action],
        [history.graph, history.core, token.address, action],
        [history.graph, CURRENT_APP_SWAP_OWNER, history.core, action],
        [history.graph, CURRENT_APP_SWAP_OWNER, token.address, 'approve']
      ]) expect(() => assertCurrentAppSharedFundingAuthority(...invalid as [string, string, string, string])).toThrow('held');
    }
    expect(() => assertCurrentAppSigningCount(history.graph, CURRENT_APP_SWAP_OWNER, 'quote', [{ phase: 'quote' }])).toThrow('reserved');
  });
  it('admits the owner-authorized current engineering swap with the same finite terms', () => {
    const scope={principal:CURRENT_APP_SWAP_OWNER,destination:CURRENT_APP_SWAP_OWNER,profile:'cheap-async',
      inputToken:history.tokenMetadata[0].address,outputToken:history.tokenMetadata[1].address,maximumInput:1_000_000n};
    for(const profile of ['cheap-async','fast-pool'])expect(()=>assertCurrentD06AppAuthority(history.graph,{...scope,profile})).not.toThrow();
    for(const change of [{principal:history.core},{destination:'0x8b749251cf1f712d4e39fd048c53394af03e10be'},
      {inputToken:scope.outputToken},{maximumInput:1_000_001n},{maximumInput:0n},{profile:'pool'}])
      expect(()=>assertCurrentD06AppAuthority(history.graph,{...scope,...change})).toThrow('hold');
    expect(()=>assertCurrentAppLimitAuthority(history.graph,{owner:history.core,action:'refresh'})).toThrow('hold');
  });
  it('keeps current owner Quote and allowance limits separate from consumed legacy trials', () => {
    expect(()=>assertCurrentAppSigningCount(history.graph,CURRENT_APP_SWAP_OWNER,'quote',[])).not.toThrow();
    expect(()=>assertCurrentAppSigningCount(history.graph,CURRENT_APP_SWAP_OWNER,'quote',[{phase:'quote'}])).toThrow('reserved');
    expect(()=>assertCurrentAppSigningCount(history.graph,CURRENT_APP_SWAP_OWNER,'token-funding',[{phase:'token-funding'}])).toThrow('reserved');
    expect(()=>assertCurrentAppSigningCount(history.graph,CURRENT_APP_SWAP_OWNER,'token-faucet',[])).toThrow('reserved');
    const old=[{phase:'quote',hash:CURRENT_APP_REPLACEMENT_TRIAL.quoteHash},{phase:'cancel',hash:CURRENT_APP_REPLACEMENT_TRIAL.cancelHash}];
    expect(()=>assertCurrentAppSigningCount(history.graph,CURRENT_APP_SWAP_OWNER,'quote',old)).toThrow('reserved');
  });
  it('permits only one replacement Quote and allowance after the exact approved current recovery', () => {
    const prior=[{phase:'token-funding',hash:'0x5de03c3f32ef5d7334d1a4541d9f03020dc3ec43931289af7551c563b7038e82'},
      {phase:'quote',hash:'0x6ad6c432b2d25a11a32bbc2bb16ebd0ee920f876da37fcc0b0857d8026b55874'},
      {phase:'accept',hash:'0x70a2e7345f4e192144b7120e56ff3e5ca2de45af7d3ccce55372a6d47d704f11'},
      {phase:'recover',hash:'0x63c23cf27c534f777428e61d3be280867a5f9ee57b1660c03c4457864331a13d'}];
    for(const phase of ['quote','token-funding']){
      expect(()=>assertCurrentAppSigningCount(history.graph,CURRENT_APP_SWAP_OWNER,phase,prior)).not.toThrow();
      expect(()=>assertCurrentAppSigningCount(history.graph,CURRENT_APP_SWAP_OWNER,phase,[...prior,{phase}])).toThrow('reserved');
      expect(()=>assertCurrentAppSigningCount(history.graph,CURRENT_APP_SWAP_OWNER,phase,prior.slice(0,3))).toThrow('reserved');
    }
    expect(()=>assertCurrentAppSigningCount(history.graph,CURRENT_APP_SWAP_OWNER,'token-faucet',prior)).toThrow('reserved');
    expect(currentAppSigningStartLimit(history.graph,CURRENT_APP_SWAP_OWNER,prior,8)).toBe(8);
    for(let i=0;i<4;i++)expect(()=>assertCurrentAppSigningCount(history.graph,CURRENT_APP_SWAP_OWNER,'quote',
      prior.map((row,index)=>index===i?{...row,hash:`0x${'99'.repeat(32)}`}:row))).toThrow('reserved');
  });
  it('bounds engineering Pool funding and keeps other owners and phases held', () => {
    const owner='0x8b749251cf1f712d4e39fd048c53394af03e10be';
    const scope={owner,action:'create' as const,budgets:[1_000_000n,1_000_000n] as const,classId:0n,tolerance:[1n,200n] as const};
    for(const classId of [0n,1n,2n,3n,4n,5n,6n])expect(()=>assertCurrentAppPoolAuthority(history.graph,{...scope,classId})).not.toThrow();
    for(const changes of [{owner:'0x4444444444444444444444444444444444444444'},{owner:history.core},{budgets:[0n,1n] as const},{budgets:[1n,1_000_001n] as const},
      {budgets:undefined},{classId:7n},{tolerance:[2n,100n] as const},{tolerance:[1n,0n] as const},{action:'quote' as never}])
      expect(()=>assertCurrentAppPoolAuthority(history.graph,{...scope,...changes})).toThrow('hold');
    expect(()=>assertCurrentAppPoolAuthority(current.graph,scope)).toThrow('hold');
    for(const action of ['top-up','approve-top-up','clear-top-up'] as const){
      expect(()=>assertCurrentAppPoolAuthority(history.graph,{...scope,action,positionId:11n})).not.toThrow();
      expect(()=>assertCurrentAppPoolAuthority(history.graph,{...scope,action})).toThrow('hold');
    }
    for(const action of ['snapshot','withdraw','close','activate','resume'] as const){
      expect(()=>assertCurrentAppPoolAuthority(history.graph,{owner,action,positionId:11n})).not.toThrow();
      expect(()=>assertCurrentAppPoolAuthority(history.graph,{owner,action,positionId:7n})).toThrow('hold');
    }
    expect(()=>assertCurrentAppPoolAuthority(history.graph,{owner,action:'transfer',positionId:11n,recipient:'0xdc9f6af38d2cab7b298bbcd807e521ef71ef5d91'})).not.toThrow();
    for(const recipient of [owner,'0x4444444444444444444444444444444444444444',history.core,undefined])
      expect(()=>assertCurrentAppPoolAuthority(history.graph,{owner,action:'transfer',positionId:11n,recipient})).toThrow('hold');
    expect(()=>assertCurrentD06AppAuthority(history.graph)).toThrow('hold');
  });
  it('retains the approved current-wallet Pool journey without renewed swap authority', () => {
    const owner = CURRENT_APP_SWAP_OWNER, recipient = '0x8b749251cf1f712d4e39fd048c53394af03e10be';
    expect(() => assertCurrentAppPoolAuthority(history.graph, { owner, action: 'create',
      budgets: [1_000_000n, 1_000_000n], classId: 0n, tolerance: [1n, 100n] })).not.toThrow();
    for (const action of ['snapshot', 'withdraw', 'close', 'activate', 'resume'] as const)
      expect(() => assertCurrentAppPoolAuthority(history.graph, { owner, action, positionId: 20n })).not.toThrow();
    expect(() => assertCurrentAppPoolAuthority(history.graph, { owner, action: 'transfer', positionId: 20n, recipient })).not.toThrow();
    expect(() => assertCurrentAppPoolAuthority(history.graph, { owner: recipient, action: 'transfer', positionId: 20n, recipient: owner })).not.toThrow();
    expect(() => assertCurrentAppSigningCount(history.graph, owner, 'quote', [{ phase: 'quote' }])).toThrow('reserved');
  });
  it.each(['0x8b749251cf1f712d4e39fd048c53394af03e10be',CURRENT_APP_SWAP_OWNER])('bounds authorized Limit owner %s without general-wallet or renewed swap authority', owner => {
    for (const action of ['create','topup','approve-create','approve-topup'] as const) {
      expect(()=>assertCurrentAppLimitAuthority(history.graph,{owner,action,amount:1_000_000n})).not.toThrow();
      for (const amount of [undefined,0n,-1n,1_000_001n]) expect(()=>assertCurrentAppLimitAuthority(history.graph,{owner,action,amount})).toThrow('hold');
    }
    for (const action of ['snapshot','refresh','claim','pause','resume','close','reprice'] as const) {
      expect(()=>assertCurrentAppLimitAuthority(history.graph,{owner,action})).not.toThrow();
      expect(()=>assertCurrentAppLimitAuthority(history.graph,{owner:history.core,action})).toThrow('hold');
      expect(()=>assertCurrentAppLimitAuthority(history.graph,{owner,action,amount:1n})).toThrow('hold');
      expect(()=>assertCurrentAppLimitAuthority(current.graph,{owner,action})).toThrow('hold');
    }
    expect(()=>assertCurrentAppLimitAuthority(history.graph,{owner:history.core,action:'refresh'})).toThrow('hold');
    expect(()=>assertCurrentAppLimitAuthority(history.graph,{owner,action:'quote' as never})).toThrow('hold');
    expect(()=>assertCurrentD06AppAuthority(history.graph)).toThrow('hold');
    expect(()=>assertCurrentAppSigningCount(history.graph,CURRENT_APP_SWAP_OWNER,'quote',[{phase:'quote'}])).toThrow('reserved');
  });
  it('retains the qualified engineering 7b67 swap modes and keeps other phases held', () => {
    const owner = '0x8b749251cf1f712d4e39fd048c53394af03e10be';
    const scope = { principal: owner, destination: owner, profile: 'cheap-async',
      inputToken: history.tokenMetadata[0].address, outputToken: history.tokenMetadata[1].address, maximumInput: 1_000_000n };
    expect(() => assertCurrentD06AppAuthority(history.graph, scope)).not.toThrow();
    expect(() => assertCurrentD06AppAuthority(history.graph, {...scope,profile:'fast-pool'})).not.toThrow();
    expect(() => assertCurrentSwapCandidate(history, scope)).not.toThrow();
    for (const changes of [{ principal: CURRENT_APP_SWAP_OWNER },
      { principal: history.core }, { destination: history.core }, { profile: 'other' },
      { inputToken: scope.outputToken }, { outputToken: scope.inputToken }, { maximumInput: 1_000_001n }, { maximumInput: 0n }]) {
      expect(() => assertCurrentD06AppAuthority(history.graph, { ...scope, ...changes })).toThrow('signing hold');
    }
    expect(() => assertCurrentD06AppAuthority(history.graph)).toThrow('signing hold');
    expect(() => assertCurrentAppSigningCount(history.graph, owner, 'quote', [{ phase: 'quote' }])).toThrow('reserved');
    expect(() => assertCurrentAppSigningCount(history.graph, owner, 'token-funding', [{ phase: 'token-funding' }])).toThrow('reserved');
  });
  it('admits only one fourth Quote after all recorded closures and the failed Accept', () => {
    const charges = [{phase:'token-faucet'},{phase:'token-funding'},
      {phase:'quote',hash:CURRENT_APP_REPLACEMENT_TRIAL.quoteHash},{phase:'cancel',hash:CURRENT_APP_REPLACEMENT_TRIAL.cancelHash},
      {phase:'quote',hash:CURRENT_APP_FURTHER_TRIAL.quoteHash},{phase:'cancel',hash:CURRENT_APP_FURTHER_TRIAL.cancelHash},
      {phase:'quote',hash:'0x69f5725311a615b3b557271011d2a20f5788ec20b103f152f82807e37ef427e0'},
      {phase:'accept',hash:'0xb288ce7bd300366f1284a25ec12258c97c1ffbe64906151ed02b380fe2f42d87'},
      {phase:'cancel',hash:'0xc4d01d7adc3182dbebb88f20af3a10d69303f6ec58b2b0592dcd92e17533b511'}];
    expect(currentAppSigningStartLimit(current.graph,CURRENT_APP_SWAP_OWNER,charges,8)).toBe(12);
    expect(()=>assertCurrentAppSigningCount(current.graph,CURRENT_APP_SWAP_OWNER,'quote',charges)).not.toThrow();
    for(const missing of [6,7,8]) {
      const rows=charges.filter((_,i)=>i!==missing);
      expect(currentAppSigningStartLimit(current.graph,CURRENT_APP_SWAP_OWNER,rows,8)).toBe(9);
      if(missing!==6)expect(()=>assertCurrentAppSigningCount(current.graph,CURRENT_APP_SWAP_OWNER,'quote',rows)).toThrow('reserved');
    }
    expect(()=>assertCurrentAppSigningCount(current.graph,CURRENT_APP_SWAP_OWNER,'quote',[...charges,{phase:'quote'}])).toThrow('reserved');
    for(const phase of ['token-faucet','token-funding'])expect(()=>assertCurrentAppSigningCount(current.graph,CURRENT_APP_SWAP_OWNER,phase,charges)).toThrow('reserved');
    expect(currentAppSigningStartLimit(current.graph,current.core,charges,8)).toBe(8);
  });
  it('admits one third Quote only after both recorded cancellations, without another claim or approval', () => {
    const charges = [{phase:'token-faucet'},{phase:'token-funding'},
      {phase:'quote',hash:CURRENT_APP_REPLACEMENT_TRIAL.quoteHash},{phase:'cancel',hash:CURRENT_APP_REPLACEMENT_TRIAL.cancelHash},
      {phase:'quote',hash:'0x0ca44a17515a6e5680e0eb354fef7c21a5d6391dfbcbb024435f65ec1b004413'},
      {phase:'cancel',hash:'0xe3f6c912683251e6b8f53d5fd318ca2d9ae89dc43afd0bb5411f8423a1396dd8'}];
    expect(()=>assertCurrentAppSigningCount(current.graph,CURRENT_APP_SWAP_OWNER,'quote',charges)).not.toThrow();
    for (const rows of [charges.slice(0,5),charges.map((row,i)=>i===5?{...row,hash:`0x${'aa'.repeat(32)}`}:row),[...charges,{phase:'quote'}]])
      expect(()=>assertCurrentAppSigningCount(current.graph,CURRENT_APP_SWAP_OWNER,'quote',rows)).toThrow('reserved');
    for (const phase of ['token-faucet','token-funding'])
      expect(()=>assertCurrentAppSigningCount(current.graph,CURRENT_APP_SWAP_OWNER,phase,charges)).toThrow('reserved');
  });
  it('recognizes only the diagnosed legacy SDK claim; it grants no signing scope', () => {
    const claim = { graph: current.graph, owner: '0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d', token: current.tokenMetadata[1].address,
      hash: '0xf3593926823ab7f1f49d4a0a565352fc8d3044d1739c945091f42f39a38c2350', nonce: 137, blockNumber: 10044433,
      blockHash: '0x7a530c54117b72345d9746c533dd2e09530dda8855106b68b062733b35bef41d' };
    expect(isCurrentAppCanonicalClaimRepair(claim)).toBe(true);
    for (const changed of [{ graph: d06.graph }, { owner: current.core }, { token: current.tokenMetadata[0].address },
      { hash: `0x${'11'.repeat(32)}` }, { nonce: 138 }, { blockNumber: 10044434 }, { blockHash: null }])
      expect(isCurrentAppCanonicalClaimRepair({ ...claim, ...changed })).toBe(false);
    expect(() => assertCurrentD06AppAuthority(current.graph)).toThrow('hold');
  });
  it('admits only the approved owner async HBR to BCN scope while default and other actions stay held', () => {
    const scope = { principal: '0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d', destination: '0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d',
      profile: 'cheap-async', inputToken: current.tokenMetadata[1].address, outputToken: current.tokenMetadata[0].address, maximumInput: 1_000_000n };
    expect(() => assertCurrentD06AppAuthority(current.graph, scope)).not.toThrow();
    for (const changes of [{ principal: historical.core }, { destination: historical.core }, { profile: 'fast-pool' },
      { inputToken: scope.outputToken }, { outputToken: scope.inputToken }, { maximumInput: 1_000_001n }, { maximumInput: 0n }])
      expect(() => assertCurrentD06AppAuthority(current.graph, { ...scope, ...changes })).toThrow('hold');
    expect(() => assertCurrentD06AppAuthority(d06.graph, scope)).toThrow('hold');
  });
  it('keeps the current b2aa owner hold separate from technical admission', () => {
    expect(current.nativeScope.connectedAppWalletHeld).toBe(true);
    expect(() => assertCurrentD06AppAuthority(current.graph)).toThrow('connected App-wallet hold');
    expect(() => assertCurrentSwapCandidate(current)).toThrow('connected App-wallet hold');
    expect(() => assertCurrentD06AppAuthority(historical.graph)).not.toThrow();
  });
  it('binds retained Fast and current async signed ceilings without relabeling historical receipts', () => {
    const raw = readFileSync(new URL('handoff/cost-ledger.json', root));
    expect(createHash('sha256').update(raw).digest('hex')).toBe('1d9360a82279ba768744b8dcc7fb4efccbc48e53277e8a308b494e0bfab4032d');
    const rows = JSON.parse(raw.toString()).transactions as { graph: string; action: string; gasLimit: string; gasUsed: string }[];
    for (const phase of ['quote', 'accept'] as const) {
      const fast = rows.filter(r => r.action === `fast-${phase}`);
      expect(fast).toHaveLength(2);
      for (const r of fast) { expect(r.graph).toBe('73ab416f398abb28d6572088a5dcf4c80641805415550334e75a038d398ee8c2'); expect(BigInt(r.gasLimit)).toBe(caps['fast-pool'][phase]); }
      const async = rows.filter(r => r.graph === d06.graph && /^op[23]-/.test(r.action) && r.action.endsWith(phase === 'quote' ? '-issue' : '-accept'));
      expect(async).toHaveLength(2);
      for (const r of async) expect(BigInt(r.gasLimit)).toBe(caps['cheap-async'][phase]);
    }
    const unfunded = JSON.parse(readFileSync(new URL('unfunded-manifest-1.json', root), 'utf8'));
    expect(unfunded.graph).toBe(d06.graph); expect(unfunded.core.toLowerCase()).toBe(d06.core);
    expect(BigInt(unfunded.steps.find((s: { name: string }) => s.name === 'cancel').gas)).toBe(caps['cheap-async'].cancel);
    // Recovery cap is a proposed ceiling, not an invented d06 native receipt.
    expect(caps['cheap-async'].recover).toBe(50_000_000n);
  });
  it('keeps the real owner hold and owner/funding permission closed despite accessible ceilings', () => {
    expect(currentCheapDexGasCaps(d06)).toBe(caps);
    expect(() => assertCurrentD06AppAuthority(d06.graph)).toThrow('connected App-wallet hold');
    expect(() => assertCurrentSwapCandidate(d06)).toThrow('admission is absent');
    expect(() => assertCurrentCheapDexNativeAdmission(d06)).toThrow('admission is absent');
    expect(isCurrentNativeSwapCandidate(d06)).toBe(false);
    expect(usesCurrentNativeSwapChecks(d06)).toBe(true);
    expect(isCurrentNativeSwapCandidate(historical)).toBe(true);
  });
  it.each(['core', 'packageSha256', 'releaseId', 'reviewedTokenSet', 'attestationSha256'])('rejects changed %s before selecting d06 ceilings', field => {
    expect(() => currentCheapDexGasCaps({ ...d06, [field]: '0x00' })).toThrow('identity changed');
  });
});

describe('Decision-030 selected owner terms', () => {
  it('admits all six direct pairs and modes above the former trial amount cap', () => {
    beta.active = true;
    for (const pair of history.pairs) for (const tokens of [pair.tokens, [...pair.tokens].reverse()]) for (const profile of ['fast-pool','cheap-async']) {
      const scope = { principal: CURRENT_APP_SWAP_OWNER, destination: CURRENT_APP_SWAP_OWNER, inputToken: tokens[0], outputToken: tokens[1], maximumInput: 100_000_000n, profile };
      expect(() => assertCurrentD06AppAuthority(history.graph,scope)).not.toThrow();
      for (const change of [{ maximumInput:1n<<256n },{ maximumInput:0n },{ inputToken:scope.outputToken },{ destination:history.core },{ principal:history.core },{ inputToken:history.core },{ profile:'intermediate' }]) {
        expect(() => assertCurrentD06AppAuthority(history.graph,{...scope,...change})).toThrow();
      }
      expect(() => assertCurrentD06AppAuthority(current.graph,scope)).toThrow();
    }
  });
  it('removes owner Pool/Limit trial amount caps while retaining other actor limits', () => {
    beta.active = true;
    const pool = { owner:CURRENT_APP_SWAP_OWNER, action:'create' as const, budgets:[100_000_000n,100_000_000n] as const, classId:0n, tolerance:[1n,200n] as const };
    expect(() => assertCurrentAppPoolAuthority(history.graph,pool)).not.toThrow();
    expect(() => assertCurrentAppPoolAuthority(history.graph,{...pool,budgets:[1n<<256n,1n]})).toThrow();
    expect(() => assertCurrentAppPoolAuthority(history.graph,{...pool,owner:CURRENT_APP_POOL_ENGINEERING_OWNERS[0]})).toThrow();
    expect(() => assertCurrentAppPoolAuthority(history.graph,{owner:CURRENT_APP_SWAP_OWNER,action:'transfer',positionId:50n,recipient:history.core})).toThrow();
    for (const action of ['create','topup','approve-create','approve-topup'] as const) {
      expect(() => assertCurrentAppLimitAuthority(history.graph,{owner:CURRENT_APP_SWAP_OWNER,action,amount:100_000_000n})).not.toThrow();
      expect(() => assertCurrentAppLimitAuthority(history.graph,{owner:CURRENT_APP_SWAP_OWNER,action,amount:1n<<256n})).toThrow();
    }
  });
});
