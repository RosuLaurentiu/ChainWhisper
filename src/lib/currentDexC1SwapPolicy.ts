import { STAGED_D06_DEX_CANDIDATE } from './currentDexC1Candidate';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE } from './currentDexExitCandidate';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from './currentDexHistoryCandidate';
import { CURRENT_OWNER_BETA, isCurrentOwnerBeta } from './currentDexOwnerBetaPolicy';

// Candidate-specific ceilings, not permission or a claim of general native fit.
// Fast: source-bound 73ab service fixture (75M/75M). Async: d06 coexistence.
// Recovery's 50M is a trial ceiling; native proof covers the bounded Pool13 profile.
// Every permitted send must also pass its fresh exact-call estimate and resources.
export const CURRENT_D06_SWAP_GAS_CAPS = Object.freeze({
  'fast-pool': Object.freeze({ quote: 75_000_000n, accept: 75_000_000n }),
  'cheap-async': Object.freeze({ quote: 65_000_000n, accept: 35_000_000n,
    cancel: 20_000_000n, recover: 50_000_000n })
});

// This hold is not caller-controlled and cannot be cleared by a receipt, a gas
// estimate, a prepared intent or local storage. Technical checks do not lift it.
// Both the adapter and shared sender enforce the d06 and current b2aa holds.
// Keep this guard independent of technical phase admission and gas evidence.
export type CurrentAppSwapScope = Readonly<{ principal: string; destination: string; profile: string;
  inputToken: string; outputToken: string; maximumInput: bigint }>;
export const CURRENT_APP_SWAP_OWNER = '0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d';
// Current live permission. Reusable funding and accounting do not select owners or tokens.
export const CURRENT_APP_SWAP_AUTHORITY = Object.freeze({ graph:STAGED_EXIT_PREVIEW_DEX_CANDIDATE.graph,
  owner:CURRENT_APP_SWAP_OWNER, inputToken:STAGED_EXIT_PREVIEW_DEX_CANDIDATE.tokenMetadata[1].address,
  outputToken:STAGED_EXIT_PREVIEW_DEX_CANDIDATE.tokenMetadata[0].address, maximumInput:1_000_000n,
  profile:'cheap-async', maximumClaims:1, maximumApprovals:1, maximumQuotes:4 });
// Standing Testnet engineering scope; current Fast native proof: current-fast-app-integration-2026-10-15/native-fast-1/RESULT.json.
export const CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY = Object.freeze({ graph: STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph,
  owner: '0x8b749251cf1f712d4e39fd048c53394af03e10be',
  inputToken: STAGED_SHARED_HISTORY_DEX_CANDIDATE.tokenMetadata[0].address,
  outputToken: STAGED_SHARED_HISTORY_DEX_CANDIDATE.tokenMetadata[1].address,
  maximumInput: 1_000_000n, profile: 'cheap-async', maximumClaims: 0, maximumApprovals: 1, maximumQuotes: 1 });
// Owner authorized this wallet for current Testnet engineering on 2026-10-17; old trial ledgers stay separate.
const CURRENT_HISTORY_SWAP_OWNERS = Object.freeze([CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY.owner, CURRENT_APP_SWAP_OWNER]);
// Owner approved one replacement of privately recovered operation4 on 2026-10-17.
export const CURRENT_APP_HISTORY_REPLACEMENT_TRIAL = Object.freeze({ approvedAt:1792199880n,
  approvalHash:'0x5de03c3f32ef5d7334d1a4541d9f03020dc3ec43931289af7551c563b7038e82',
  quoteHash:'0x6ad6c432b2d25a11a32bbc2bb16ebd0ee920f876da37fcc0b0857d8026b55874',
  acceptHash:'0x70a2e7345f4e192144b7120e56ff3e5ca2de45af7d3ccce55372a6d47d704f11',
  recoverHash:'0x63c23cf27c534f777428e61d3be280867a5f9ee57b1660c03c4457864331a13d' });
export const hasCurrentHistoryReplacementProof = (graph:string,owner:string,charges:readonly {phase:string;hash?:string|null}[]) => {
  const r=CURRENT_APP_HISTORY_REPLACEMENT_TRIAL;
  return graph===STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph&&owner.toLowerCase()===CURRENT_APP_SWAP_OWNER&&
    charges.length>=4&&['token-funding','quote','accept','recover'].every((phase,i)=>charges[i].phase===phase&&
      charges[i].hash===[r.approvalHash,r.quoteHash,r.acceptHash,r.recoverHash][i]);
};
// One owner-authorized Fast journey after verified operation5; prior records stay charged.
export const CURRENT_APP_HISTORY_FAST_TRIAL = Object.freeze({ approvedAt:1792248902n,
  quoteHash:'0xdc7b017f0221f7eafe4a2cea43fe9c7db8c0262dea2461d8cedc864155c859dc',
  terminalHash:'0x36e884e0300986edb56bd7d968f217573b24c975b4db7e11febd6af4c8df9872' });
export const hasCurrentHistoryFastProof = (graph:string,owner:string,charges:readonly {phase:string;hash?:string|null;nonce?:number}[]) =>
  hasCurrentHistoryReplacementProof(graph,owner,charges)&&charges.length>=7&&charges.slice(0,7).every((c,i)=>c.nonce===148+i)&&
  ['token-funding','quote','accept'].every((phase,i)=>charges[4+i].phase===phase&&charges[4+i].hash===[
    '0x904fcfd8ec833aaf8a6b213ca1de020b2ed5e1814acb9b6219c8f03e16ffe488',CURRENT_APP_HISTORY_FAST_TRIAL.quoteHash,
    '0x10f7ac072e6a3b456c08df45b434ee075538899b128270a6603e54b4816f1bbe'][i]);
// Owner renewed one Fast Quote/Accept after unfunded Quote6; no new approval or funding.
export const CURRENT_APP_HISTORY_FAST_REPLACEMENT_TRIAL=Object.freeze({approvedAt:1792255023n,quoteSeconds:900n,
  approvalHash:'0xf5ceb9ebb0c8c24ef65f3746254574f5525ec6179ddc92379bd0e64b3f1fa708',
  quoteHash:'0x26dcfd82ad6dc1fd2da514ec0079bd5a6e9a4765a30f3b5d454ea76549458fe6'});
export const hasCurrentHistoryFastReplacementProof=(graph:string,owner:string,charges:readonly {phase:string;hash?:string|null;nonce?:number}[])=>
  hasCurrentHistoryFastProof(graph,owner,charges)&&charges.length>=9&&
  ['token-funding','quote'].every((phase,i)=>charges[7+i].phase===phase&&charges[7+i].nonce===162+i&&
    charges[7+i].hash===[CURRENT_APP_HISTORY_FAST_REPLACEMENT_TRIAL.approvalHash,CURRENT_APP_HISTORY_FAST_REPLACEMENT_TRIAL.quoteHash][i]);
// One bounded async trial; all eleven prior signing starts remain charged.
export const CURRENT_APP_PARTIAL_REFUND_TRIAL=Object.freeze({approvedAt:1792441435n,expiresAt:1792448635n,
  maximumInput:3n,additionalSigningStarts:6,retainedLedgerStarts:11,maximumSigningStarts:17,
  additionalOwnerGas:235_000_000n,additionalOwnerCommitmentWei:11_750_000_000_000_000n});
// Owner approved recovery of this lost local record only; all eleven starts stay charged.
export const CURRENT_APP_PARTIAL_LEDGER_RECOVERY=Object.freeze({approvedAt:1792434879n,
  conservativeStart:1792198683n,previousWindowStart:1792255023n,
  hashes:Object.freeze([
    CURRENT_APP_HISTORY_REPLACEMENT_TRIAL.approvalHash,CURRENT_APP_HISTORY_REPLACEMENT_TRIAL.quoteHash,
    CURRENT_APP_HISTORY_REPLACEMENT_TRIAL.acceptHash,CURRENT_APP_HISTORY_REPLACEMENT_TRIAL.recoverHash,
    '0x904fcfd8ec833aaf8a6b213ca1de020b2ed5e1814acb9b6219c8f03e16ffe488',CURRENT_APP_HISTORY_FAST_TRIAL.quoteHash,
    '0x10f7ac072e6a3b456c08df45b434ee075538899b128270a6603e54b4816f1bbe',
    CURRENT_APP_HISTORY_FAST_REPLACEMENT_TRIAL.approvalHash,CURRENT_APP_HISTORY_FAST_REPLACEMENT_TRIAL.quoteHash,
    '0xb95911ec63dd48c89c266faa2498640f80edecb9afe9aefea9b23018266fe432',
    '0x2af62aa18799348b848617c93a64515f482d7179b610a209d6a8aa684dc655e2'])});
export const currentPartialLedgerRecoveryAllowed=(graph:string,owner:string,now:bigint)=>
  graph===STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph&&owner.toLowerCase()===CURRENT_APP_SWAP_OWNER&&
  now>=CURRENT_APP_PARTIAL_LEDGER_RECOVERY.approvedAt&&now<CURRENT_APP_PARTIAL_REFUND_TRIAL.expiresAt;
export const hasCurrentPartialRefundProof=(graph:string,owner:string,charges:readonly {phase:string;hash?:string|null;nonce?:number;scope?:string}[])=>
  hasCurrentHistoryFastReplacementProof(graph,owner,charges)&&charges.length>=CURRENT_APP_PARTIAL_REFUND_TRIAL.retainedLedgerStarts&&
  /^quote:0x[0-9a-f]{64}$/.test(charges[9].scope??'')&&charges[9].scope===charges[10].scope&&
  ['quote','accept'].every((phase,i)=>charges[9+i].phase===phase&&charges[9+i].nonce===164+i&&charges[9+i].hash===[
    '0xb95911ec63dd48c89c266faa2498640f80edecb9afe9aefea9b23018266fe432',
    '0x2af62aa18799348b848617c93a64515f482d7179b610a209d6a8aa684dc655e2'][i]);
// Owner approved one replacement on 2026-10-12; the original ledger remains charged.
export const CURRENT_APP_REPLACEMENT_TRIAL = Object.freeze({ approvedAt:1791831919n,
  quoteHash:'0xdcfd24aa56226f648176457c4deaeb7c748c891b83d26a632715827faa375128',
  cancelHash:'0x3fba05e2afa21b17e28b7ce577a7a2f30143ae42d5b742045940f0ce294f32a0',
  totalFeeCeilingWei:60_000_000_000_000_000n });
// Owner approved one further trial after privately verified cancellation51; prior fees stay charged.
export const CURRENT_APP_FURTHER_TRIAL = Object.freeze({ approvedAt:1791837362n,
  quoteHash:'0x0ca44a17515a6e5680e0eb354fef7c21a5d6391dfbcbb024435f65ec1b004413',
  cancelHash:'0xe3f6c912683251e6b8f53d5fd318ca2d9ae89dc43afd0bb5411f8423a1396dd8',
  maximumSigningStarts:9, quoteSeconds:900n, totalFeeCeilingWei:60_000_000_000_000_000n });
// Owner approved the prepared wallet-response repair trial; all nine prior records remain charged.
export const CURRENT_APP_FOURTH_TRIAL = Object.freeze({ approvedAt:1791841485n,
  quoteHash:'0x69f5725311a615b3b557271011d2a20f5788ec20b103f152f82807e37ef427e0',
  failedAcceptHash:'0xb288ce7bd300366f1284a25ec12258c97c1ffbe64906151ed02b380fe2f42d87',
  cancelHash:'0xc4d01d7adc3182dbebb88f20af3a10d69303f6ec58b2b0592dcd92e17533b511',
  maximumSigningStarts:12, quoteSeconds:900n, totalFeeCeilingWei:80_000_000_000_000_000n });
export const currentAppSigningStartLimit = (graph:string,owner:string,charges:readonly {phase:string;hash?:string|null;nonce?:number;scope?:string}[],original:number) => {
  if(hasCurrentPartialRefundProof(graph,owner,charges))return CURRENT_APP_PARTIAL_REFUND_TRIAL.maximumSigningStarts;
  if(hasCurrentHistoryFastProof(graph,owner,charges))return 11;
  const a=CURRENT_APP_SWAP_AUTHORITY,r=CURRENT_APP_FURTHER_TRIAL,first=CURRENT_APP_REPLACEMENT_TRIAL;
  const priorClosed=graph===a.graph&&owner.toLowerCase()===a.owner&&
    charges.some(c=>c.phase==='quote'&&c.hash===first.quoteHash)&&charges.some(c=>c.phase==='cancel'&&c.hash===first.cancelHash)&&
    charges.some(c=>c.phase==='quote'&&c.hash===r.quoteHash)&&charges.some(c=>c.phase==='cancel'&&c.hash===r.cancelHash);
  if(!priorClosed)return original;
  const fourth=CURRENT_APP_FOURTH_TRIAL;
  return charges.some(c=>c.phase==='quote'&&c.hash===fourth.quoteHash)&&
    charges.some(c=>c.phase==='accept'&&c.hash===fourth.failedAcceptHash)&&charges.some(c=>c.phase==='cancel'&&c.hash===fourth.cancelHash)
    ?fourth.maximumSigningStarts:r.maximumSigningStarts;
};
export const assertCurrentAppInitialClaimAuthority = (graph:string,owner:string,token:string,action:string) => {
  const a=CURRENT_APP_SWAP_AUTHORITY;
  if(graph!==a.graph||owner.toLowerCase()!==a.owner||token.toLowerCase()!==a.inputToken||action!=='initial')
    throw new Error('Beta token signing is held: this initial claim has no current App admission.');
};
// Owner authorized four-token funding on 2026-10-17; token policy still bounds each credit.
// This grants no approval or DEX phase and does not renew consumed swap ledgers.
export const assertCurrentAppSharedFundingAuthority = (graph: string, owner: string, token: string, action: string) => {
  if (graph !== STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph || !CURRENT_HISTORY_SWAP_OWNERS.includes(owner.toLowerCase()) ||
      !STAGED_SHARED_HISTORY_DEX_CANDIDATE.tokenMetadata.some(asset => asset.address === token.toLowerCase()) ||
      action !== 'initial' && action !== 'refill') throw new Error('Beta token signing is held: this funding action has no current App admission.');
};
export type CurrentAppLimitScope = Readonly<{ owner: string; action: 'create' | 'snapshot' | 'refresh' | 'claim' | 'pause' | 'resume' | 'close' | 'topup' | 'reprice' | 'approve-create' | 'approve-topup'; amount?: bigint }>;
export const CURRENT_APP_POOL_ENGINEERING_OWNERS = Object.freeze([
  CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY.owner,
  CURRENT_APP_SWAP_OWNER, // Approved Pool trial: current-pool-owner-app-2026-10-17/POOL_AUTHORITY_PROPOSAL.md.
  '0xdc9f6af38d2cab7b298bbcd807e521ef71ef5d91',
  '0x23abde1d22019d52852d6845c9444326dde1d99e'
]);
export const assertCurrentAppPoolAllowanceCleanupAuthority = (graph: string, owner: string) => {
  if (graph !== STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph || !CURRENT_APP_POOL_ENGINEERING_OWNERS.includes(owner.toLowerCase())) {
    throw new Error('Shared-history DEX App signing hold remains active: Pool allowance cleanup owner or candidate is outside engineering scope.');
  }
};
export type CurrentAppPoolScope = Readonly<{ owner: string;
  action: 'create' | 'top-up' | 'approve-create' | 'approve-top-up' | 'clear-create' | 'clear-top-up' | 'snapshot' | 'withdraw' | 'close' | 'transfer' | 'activate' | 'resume';
  positionId?: bigint; budgets?: readonly [bigint, bigint]; classId?: bigint; tolerance?: readonly [bigint, bigint]; recipient?: string | null }>;
// Existing Testnet actors only; the shared sender also requires authentic issuer objects.
export const assertCurrentAppPoolAuthority = (graph: string, scope: CurrentAppPoolScope) => {
  if (graph !== STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph) return assertCurrentD06AppAuthority(graph);
  const owner = scope.owner.toLowerCase(), funded = ['create','top-up','approve-create','approve-top-up','clear-create','clear-top-up'].includes(scope.action);
  const creation = ['create','approve-create','clear-create'].includes(scope.action);
  const maximum = isCurrentOwnerBeta(graph, owner) ? (1n << 256n) - 1n : 1_000_000n;
  if (!CURRENT_APP_POOL_ENGINEERING_OWNERS.includes(owner) ||
      !['create','top-up','approve-create','approve-top-up','clear-create','clear-top-up','snapshot','withdraw','close','transfer','activate','resume'].includes(scope.action) ||
      (creation ? scope.positionId !== undefined : typeof scope.positionId !== 'bigint' || scope.positionId < 8n) ||
      (funded ? !scope.budgets || scope.budgets.length !== 2 || scope.budgets.some(value => typeof value !== 'bigint' || value <= 0n || value > maximum) ||
        (creation || scope.classId !== undefined) && (typeof scope.classId !== 'bigint' || scope.classId < 0n || scope.classId > 6n) || !scope.tolerance || scope.tolerance.length !== 2 ||
        scope.tolerance.some(value => typeof value !== 'bigint') || scope.tolerance[0] < 0n || scope.tolerance[1] <= 0n || scope.tolerance[0] * 100n > scope.tolerance[1]
        : scope.budgets !== undefined || scope.classId !== undefined || scope.tolerance !== undefined) ||
      (scope.action === 'transfer' ? !scope.recipient || !CURRENT_APP_POOL_ENGINEERING_OWNERS.includes(scope.recipient.toLowerCase()) || scope.recipient.toLowerCase() === owner
        : scope.recipient != null)) {
    throw new Error('Shared-history DEX App signing hold remains active: Pool owner, action or terms are outside engineering scope.');
  }
};
// Owner authorized the current wallet's Limit journey on 2026-10-18; other trial ledgers stay separate.
export const assertCurrentAppLimitAuthority = (graph: string, scope: CurrentAppLimitScope) => {
  if (graph !== STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph) return assertCurrentD06AppAuthority(graph);
  const funding = ['create', 'topup', 'approve-create', 'approve-topup'].includes(scope.action);
  const maximum = isCurrentOwnerBeta(graph, scope.owner) ? (1n << 256n) - 1n : 1_000_000n;
  if (![CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY.owner, CURRENT_APP_SWAP_OWNER].includes(scope.owner.toLowerCase()) ||
      !['create', 'snapshot', 'refresh', 'claim', 'pause', 'resume', 'close', 'topup', 'reprice', 'approve-create', 'approve-topup'].includes(scope.action) ||
      (funding ? typeof scope.amount !== 'bigint' || scope.amount <= 0n || scope.amount > maximum : scope.amount !== undefined)) {
    throw new Error('Shared-history DEX App signing hold remains active: Limit owner, action or amount is outside engineering scope.');
  }
};
// This claim stopped on the old SDK's missing removed field, before private checks.
// Only full canonical and owner-private receipt proof may retire that legacy flag.
export const isCurrentAppCanonicalClaimRepair = (claim: Readonly<{ graph: string; owner: string; token: string;
  hash: string; nonce?: number; blockNumber?: number | null; blockHash?: string | null }>) => {
  const a = CURRENT_APP_SWAP_AUTHORITY;
  return claim.graph === a.graph && claim.owner.toLowerCase() === a.owner && claim.token.toLowerCase() === a.inputToken &&
    claim.hash.toLowerCase() === '0xf3593926823ab7f1f49d4a0a565352fc8d3044d1739c945091f42f39a38c2350' &&
    claim.nonce === 137 && claim.blockNumber === 10044433 &&
    claim.blockHash?.toLowerCase() === '0x7a530c54117b72345d9746c533dd2e09530dda8855106b68b062733b35bef41d';
};
// Owner-approved repair for this diagnosed receipt checker failure only.
export const isCurrentAppLimitTopUpRepair=(proof:Readonly<{graph:string;owner:string;core:string;hash:string;nonce:number;blockNumber:number;blockHash:string;positionId:bigint;amount:bigint}>)=>
  proof.graph==='7b67bcbb7c5941a24471e62ba5a0d939c0800671b0bf121e81bad14cca737456'&&proof.owner.toLowerCase()===CURRENT_APP_SWAP_OWNER&&
  proof.core.toLowerCase()==='0xab5374daddea783c3e58de19db497b54c79fd4cc'&&proof.hash.toLowerCase()==='0x99d43c33f95061f794fe6ead07e2eb2c2305653788974235398b70d797347a5f'&&
  proof.nonce===205&&proof.blockNumber===10152730&&proof.blockHash.toLowerCase()==='0x8c96934c343ac7193f3cb35679e327bb858208b01b42ba7c573f4f445d7a89fa'&&proof.positionId===55n&&proof.amount===250000n;
export const assertCurrentAppSigningCount = (graph:string,owner:string,phase:string,charges:readonly {phase:string;hash?:string|null;nonce?:number;scope?:string}[]) => {
  if(hasCurrentPartialRefundProof(graph,owner,charges)){
    const suffix=charges.slice(CURRENT_APP_PARTIAL_REFUND_TRIAL.retainedLedgerStarts);
    const limits:Readonly<Record<string,number>>={quote:1,accept:1,cancel:1,recover:1,'token-funding':2};
    if(!Object.prototype.hasOwnProperty.call(limits,phase)||suffix.length>=CURRENT_APP_PARTIAL_REFUND_TRIAL.additionalSigningStarts||
      suffix.some(c=>!Object.prototype.hasOwnProperty.call(limits,c.phase)||suffix.filter(row=>row.phase===c.phase).length>limits[c.phase])||
      suffix.filter(c=>c.phase===phase).length>=limits[phase])
      throw new Error('Current App signing scope is already reserved. Reconcile the original action.');
    return;
  }
  const a=graph===STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph?CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY:CURRENT_APP_SWAP_AUTHORITY;
  const allowed=graph===STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph?CURRENT_HISTORY_SWAP_OWNERS.includes(owner.toLowerCase()):owner.toLowerCase()===a.owner;
  if(graph!==a.graph||!allowed)return;
  const replacement=graph===CURRENT_APP_SWAP_AUTHORITY.graph&&charges.some(c=>c.phase==='quote'&&c.hash===CURRENT_APP_REPLACEMENT_TRIAL.quoteHash)&&
    charges.some(c=>c.phase==='cancel'&&c.hash===CURRENT_APP_REPLACEMENT_TRIAL.cancelHash);
  const limit=currentAppSigningStartLimit(graph,owner,charges,8);
  const historyReplacement=hasCurrentHistoryReplacementProof(graph,owner,charges);
  const maximum=phase==='token-faucet'?a.maximumClaims:phase==='quote'&&hasCurrentHistoryFastReplacementProof(graph,owner,charges)?4:hasCurrentHistoryFastProof(graph,owner,charges)&&(phase==='token-funding'||phase==='quote')?3:historyReplacement&&(phase==='token-funding'||phase==='quote')?2:phase==='token-funding'?a.maximumApprovals:phase==='quote'?
    (replacement?(limit===CURRENT_APP_FOURTH_TRIAL.maximumSigningStarts?a.maximumQuotes:limit===CURRENT_APP_FURTHER_TRIAL.maximumSigningStarts?3:2):1):undefined;
  if(maximum!==undefined&&charges.filter(c=>c.phase===phase).length>=maximum)throw new Error('Current App signing scope is already reserved. Reconcile the original action.');
};
export const assertCurrentD06AppAuthority = (graph: string, scope?: CurrentAppSwapScope): void => {
  if (graph === STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph) {
    if (scope && isCurrentOwnerBeta(graph, scope.principal) && scope.destination.toLowerCase() === CURRENT_OWNER_BETA.owner &&
        ['fast-pool','cheap-async'].includes(scope.profile) && scope.maximumInput > 0n && scope.maximumInput < 1n << 256n &&
        STAGED_SHARED_HISTORY_DEX_CANDIDATE.pairs.some(pair => pair.tokens.some(token => token === scope.inputToken.toLowerCase()) &&
          pair.tokens.some(token => token === scope.outputToken.toLowerCase()) && scope.inputToken.toLowerCase() !== scope.outputToken.toLowerCase())) return;
    const a = CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY;
    if (scope && typeof scope.principal === 'string' && typeof scope.destination === 'string' &&
        typeof scope.inputToken === 'string' && typeof scope.outputToken === 'string' &&
        CURRENT_HISTORY_SWAP_OWNERS.includes(scope.principal.toLowerCase()) && scope.destination.toLowerCase() === scope.principal.toLowerCase() &&
        (scope.profile === a.profile || scope.profile === 'fast-pool') && scope.inputToken.toLowerCase() === a.inputToken &&
        scope.outputToken.toLowerCase() === a.outputToken && scope.maximumInput > 0n && scope.maximumInput <= a.maximumInput) return;
    throw new Error('Shared-history DEX App signing hold remains active pending integration.');
  }
  if (graph === STAGED_EXIT_PREVIEW_DEX_CANDIDATE.graph && scope &&
      typeof scope.principal === 'string' && typeof scope.destination === 'string' && typeof scope.inputToken === 'string' && typeof scope.outputToken === 'string' &&
      scope.principal.toLowerCase() === CURRENT_APP_SWAP_AUTHORITY.owner && scope.destination.toLowerCase() === CURRENT_APP_SWAP_AUTHORITY.owner &&
      scope.profile === CURRENT_APP_SWAP_AUTHORITY.profile && scope.inputToken.toLowerCase() === CURRENT_APP_SWAP_AUTHORITY.inputToken &&
      scope.outputToken.toLowerCase() === CURRENT_APP_SWAP_AUTHORITY.outputToken &&
      scope.maximumInput > 0n && scope.maximumInput <= CURRENT_APP_SWAP_AUTHORITY.maximumInput) return;
  if (graph === STAGED_D06_DEX_CANDIDATE.graph || graph === STAGED_EXIT_PREVIEW_DEX_CANDIDATE.graph) {
    throw new Error('Successor DEX native App submission admission is absent: connected App-wallet hold remains active. Native evidence does not grant App submission.');
  }
};
