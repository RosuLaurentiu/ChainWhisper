import { isCurrentDexBrowserSigner, assertCurrentDexBrowserWindow } from './currentDexBrowserPolicy';
import { rejectUnprovenNativeAdmission,
  currentCheapDexCandidateKey, resolveCurrentCheapDexCandidate, type CurrentCheapDexIdentity } from './dexV2Deployment';
import type { CurrentCheapDexPreparedQuote } from './currentDexSubmission';
import { assertCurrentD06AppAuthority, assertCurrentAppSigningCount, currentAppSigningStartLimit, CURRENT_APP_SWAP_OWNER, CURRENT_APP_HISTORY_REPLACEMENT_TRIAL, CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY, hasCurrentHistoryReplacementProof, CURRENT_APP_HISTORY_FAST_TRIAL, hasCurrentHistoryFastProof, type CurrentAppSwapScope } from './currentDexC1SwapPolicy';
import { CURRENT_EXIT_SWAP_LIMITS, CURRENT_EXIT_SWAP_GAS_CAPS, usesCurrentSwapAccounting,
  CURRENT_NATIVE_FIXED_GAS_PRICE, CURRENT_BROWSER_SWAP_MAXIMUM_TOLERANCE_BPS } from './currentDexExitSwapPolicy';
import {CURRENT_APP_HISTORY_FAST_REPLACEMENT_TRIAL,hasCurrentHistoryFastReplacementProof} from './currentDexC1SwapPolicy';
import { CURRENT_APP_PARTIAL_REFUND_TRIAL, hasCurrentPartialRefundProof } from './currentDexC1SwapPolicy';
import { CURRENT_APP_PARTIAL_LEDGER_RECOVERY, currentPartialLedgerRecoveryAllowed } from './currentDexC1SwapPolicy';
import { keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import { CURRENT_OWNER_BETA, isCurrentOwnerBeta } from './currentDexOwnerBetaPolicy';

export const CURRENT_NATIVE_SWAP_LIMITS = Object.freeze({ commitmentWei: 40_000_000_000_000_000n,
  starts: 8, normalSeconds: 900n, recoverySeconds: 1800n, recoveryGasCap: 50_000_000n,
  asyncAcceptReserveSeconds: 180n,
  fixedGasPrice: CURRENT_NATIVE_FIXED_GAS_PRICE, maximumInput: 100n * 10n ** 18n, maximumToleranceBps: 50 });
// decision-034: the fa71 native candidate and its native Pool trial were removed (CW-140.12).
// Swap checks only. Do not transfer fa71 Pool, faucet, refill or owner admission.
export const usesCurrentNativeSwapChecks = (c: CurrentCheapDexIdentity) => usesCurrentSwapAccounting(c);
// Registry identity can support unsigned preparation. It grants no phase authority.
export const assertCurrentSwapIdentity = (c: CurrentCheapDexIdentity) => {
  let registered;
  try { registered = resolveCurrentCheapDexCandidate(currentCheapDexCandidateKey(c)); }
  catch { throw new Error('Native swap candidate identity changed.'); }
  if (JSON.stringify(c) !== JSON.stringify(registered)) throw new Error('Native swap candidate identity changed.');
};
export const assertCurrentSwapCandidate = (c: CurrentCheapDexIdentity, scope?: CurrentAppSwapScope, signer?: object) => {
  assertCurrentSwapIdentity(c);
  assertCurrentD06AppAuthority(c.graph, scope, signer);
  if (!usesCurrentSwapAccounting(c)) return rejectUnprovenNativeAdmission();
};
export const assertCurrentNativeSwapIntent = (prepared: CurrentCheapDexPreparedQuote, now: bigint, expired = false, funding = false, signer?: object) => {
  if (!prepared.intent.candidate || !usesCurrentNativeSwapChecks(prepared.intent.candidate)) throw new Error('Native swap intent candidate is absent.');
  assertCurrentSwapCandidate(prepared.intent.candidate, prepared.intent, signer);
  const i = prepared.intent, limits = usesCurrentSwapAccounting(prepared.intent.candidate)
    ? CURRENT_EXIT_SWAP_LIMITS : CURRENT_NATIVE_SWAP_LIMITS;
  const partial = CURRENT_APP_PARTIAL_REFUND_TRIAL;
  if (!isCurrentDexBrowserSigner(signer,i.candidate!.graph,i.principal) && i.candidate?.graph === CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY.graph && i.principal?.toLowerCase() === CURRENT_APP_SWAP_OWNER && now >= partial.approvedAt &&
      (now >= partial.expiresAt || i.profile !== 'cheap-async' || i.maximumInput !== partial.maximumInput ||
        i.minimumInput !== 0n || i.minimumOutput !== 1n || i.rateNumerator !== 0n || i.rateDenominator !== 1n || i.toleranceBps !== 50)) {
    throw new Error('Approved partial-refund trial terms or window changed.');
  }
  // Keep the keeper's 60-second margin plus 120 seconds for App and terminal work.
  if (funding && usesCurrentSwapAccounting(prepared.intent.candidate) && i.profile === 'cheap-async' &&
      i.deadline - now <= CURRENT_NATIVE_SWAP_LIMITS.asyncAcceptReserveSeconds) {
    throw new Error('Not enough time for asynchronous settlement. Cancel this Quote and request a new one.');
  }
  const browser = isCurrentDexBrowserSigner(signer,i.candidate!.graph,i.principal);
  if (i.quoteProtocol === 'quote-slippage' && Number.isInteger(i.toleranceBps) && i.toleranceBps! > (browser ? CURRENT_BROWSER_SWAP_MAXIMUM_TOLERANCE_BPS : limits.maximumToleranceBps)) {
    throw new Error(`Slippage ${i.toleranceBps! / 100}% is above the ${(browser ? CURRENT_BROWSER_SWAP_MAXIMUM_TOLERANCE_BPS : limits.maximumToleranceBps) / 100}% limit. Lower it and request a new Quote.`);
  }
  if (i.quoteProtocol !== 'quote-slippage' || !Number.isInteger(i.toleranceBps) || i.toleranceBps! < 0 ||
      i.maximumInput <= 0n || i.maximumInput > (browser ? (1n << 256n) - 1n : limits.maximumInput) || i.minimumInput < 0n || i.minimumInput > i.maximumInput ||
      i.minimumOutput < 0n || i.rateNumerator < 0n || i.rateDenominator <= 0n ||
      (!expired && (now >= i.deadline || i.deadline - now > limits.normalSeconds))) {
    throw new Error('Native swap amount, protection or lifetime exceeds the finite profile.');
  }
};

type Phase = 'quote' | 'accept' | 'cancel' | 'recover' | 'token-funding' | 'token-faucet';
type SwapCharge = { phase: 'quote' | 'accept' | 'cancel' | 'recover' | 'token-funding' | 'token-faucet'; key: string; scope: string; gasCap: string; gasPrice?: string; nonce: number; hash: string | null };
// Old authenticated v1 records did not store a fee. They bind the original 50M
// request and reservation. Never reprice an old charge at the current fee.
export const currentNativeSwapChargeGasPrice = (charge: Readonly<SwapCharge>) =>
  charge.gasPrice === undefined ? CURRENT_NATIVE_FIXED_GAS_PRICE : BigInt(charge.gasPrice);
const partialTrialCommitment = (graph: string, owner: string, charges: readonly Readonly<SwapCharge>[]) =>
  hasCurrentPartialRefundProof(graph, owner, charges)
    ? charges.slice(0, CURRENT_APP_PARTIAL_REFUND_TRIAL.retainedLedgerStarts).reduce((sum, c) => sum + BigInt(c.gasCap) * currentNativeSwapChargeGasPrice(c), 0n) + CURRENT_APP_PARTIAL_REFUND_TRIAL.additionalOwnerCommitmentWei
    : CURRENT_NATIVE_SWAP_LIMITS.commitmentWei;
export type CurrentNativeSwapCheckpoint = Readonly<{ version: 1 | 2; owner: string; candidateGraph: string; start: string;
  windowStart?: string; committedWei: string; activeSwap: string | null; charges: readonly Readonly<SwapCharge>[];
  // decision-033: reservations that the wallet rejected and the chain never saw. Kept, never deleted.
  // Present only when not empty, so that records with no release keep their exact bytes.
  released?: readonly Readonly<SwapCharge>[] }>;
// Builds public reservations only. The consumer must prove canonical calls and private Fast7 settlement before installation.
export const recoverCurrentPartialLedger = (owner:string,candidate:CurrentCheapDexIdentity,now:bigint,
  transactions:readonly Readonly<{hash:string;nonce?:number;data:string;gasLimit?:bigint;gasPrice?:bigint;chainId:bigint;from:string;to:string|null;value:bigint}>[]):CurrentNativeSwapCheckpoint => {
  const r=CURRENT_APP_PARTIAL_LEDGER_RECOVERY;
  if(!currentPartialLedgerRecoveryAllowed(candidate.graph,owner,now)||transactions.length!==11)
    throw new Error('Exact approved ledger recovery is unavailable.');
  const phases=['token-funding','quote','accept','recover','token-funding','quote','accept','token-funding','quote','quote','accept'] as const;
  const caps=[5n,110n,35n,50n,5n,110n,35n,5n,110n,110n,110n];
  const charges=transactions.map((tx,i)=>{
    const phase=phases[i],scope=`quote:${keccak256(transactions[i<4?1:i<7?5:i<9?8:9].data)}`;
    if(tx.hash.toLowerCase()!==r.hashes[i]||tx.nonce!==(i<7?148+i:155+i)||tx.chainId!==7082400n||
      tx.from.toLowerCase()!==owner.toLowerCase()||tx.value!==0n||tx.gasLimit!==caps[i]*1_000_000n||tx.gasPrice!==50_000_000n||
      tx.to?.toLowerCase()!==(phase==='token-funding'?CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY.inputToken:candidate.core).toLowerCase())
      throw new Error('Recorded partial-trial ledger transaction changed.');
    return {phase,scope,key:phase==='quote'?scope:phase==='token-funding'?`${phase}:${scope}:${keccak256(tx.data)}`:`${phase}:${scope}`,
      gasCap:String(tx.gasLimit),gasPrice:String(tx.gasPrice),nonce:tx.nonce,hash:r.hashes[i]};
  });
  const budget:CurrentNativeSwapCheckpoint={version:1,owner:owner.toLowerCase(),candidateGraph:candidate.graph,
    start:String(r.conservativeStart),windowStart:String(r.previousWindowStart),activeSwap:null,
    committedWei:String(charges.reduce((sum,row)=>sum+BigInt(row.gasCap)*BigInt(row.gasPrice),0n)),charges};
  validateCurrentNativeSwapCheckpoint(budget,owner,candidate);
  return budget;
};
type Budget = { version: 1 | 2; owner: string; candidateGraph: string; start: bigint; windowStart?: bigint; committed: bigint; keys: Set<string>; activeSwap: string | null;
  charges: SwapCharge[]; released: SwapCharge[]; lastCommit: { key: string; activeSwap: string | null } | null };
const budgets = new WeakMap<object, Budget>();
export const hasCurrentNativeSigningBudget = (signer: object) => budgets.has(signer);
// Shared cost accounting only. This interface grants no phase, calldata or signer authority.
// Token funding remains held until its own adapter joins this same budget.
export const currentNativeSigningBudget = (signer: object, owner: string, now: () => bigint, supplied?: CurrentCheapDexIdentity) => {
  // decision-034: the fa71 default candidate was removed; a caller must name the current candidate.
  if (!supplied) throw new Error('Native swap candidate identity changed.');
  const candidate = supplied;
  assertCurrentSwapIdentity(candidate);
  let budget = budgets.get(signer);
  if (!budget) { budget = { version: isCurrentDexBrowserSigner(signer,candidate.graph,owner)?2:1, owner: owner.toLowerCase(), candidateGraph: candidate.graph, start: now(), committed: 0n, keys: new Set(), activeSwap: null,
    charges: [], released: [], lastCommit: null }; budgets.set(signer, budget); }
  const state = budget, l = CURRENT_NATIVE_SWAP_LIMITS, fixedGasPrice = CURRENT_NATIVE_FIXED_GAS_PRICE;
  const check = (phase: Phase, key: string, gasCap: bigint, swapScope?: string) => {
    if (state.candidateGraph !== candidate.graph) throw new Error('Native signing budget candidate changed.');
    if (isCurrentDexBrowserSigner(signer,candidate.graph,owner)) {
      validateCurrentNativeSwapCheckpoint(currentNativeSwapCheckpoint(signer), owner, candidate, signer);
      const scope = swapScope ?? key, approval = phase === 'token-funding';
      const caps = phase === 'quote' ? [110_000_000n] : phase === 'accept' ? [35_000_000n,110_000_000n] :
        phase === 'cancel' ? [30_000_000n] : phase === 'recover' ? [50_000_000n] : approval ? [5_000_000n] : [];
      const prior = state.charges.filter(row => row.scope === scope);
      if (state.owner !== owner.toLowerCase() || !caps.includes(gasCap) || !/^quote:0x[0-9a-f]{64}$/.test(scope) ||
          state.keys.has(key) || state.charges.slice(0,state.version===1?CURRENT_OWNER_BETA.legacyStarts:0).some(row => row.scope === scope) ||
          (approval ? !key.startsWith(`token-funding:${scope}:`) || !/^0x[0-9a-f]{64}$/.test(key.slice(`token-funding:${scope}:`.length)) : key !== (phase === 'quote' ? scope : `${phase}:${scope}`)) ||
          ((phase === 'quote' || approval) ? state.activeSwap !== null && (state.activeSwap !== scope || prior.some(row => row.phase !== 'token-funding')) :
            state.activeSwap !== scope || !prior.some(row => row.phase === 'quote'))) {
        throw new Error('Owner beta swap scope, phase or prior reservation changed.');
      }
      assertCurrentDexBrowserWindow(signer, candidate.graph, owner, candidate.core, 7082400n, now(),
        (state.charges[state.charges.length - 1]?.nonce ?? -1) + 1, gasCap, fixedGasPrice);
      return;
    }
    const exitSwap = usesCurrentSwapAccounting(candidate);
    const partial = CURRENT_APP_PARTIAL_REFUND_TRIAL, partialProof = hasCurrentPartialRefundProof(candidate.graph, owner, state.charges);
    if (candidate.graph === CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY.graph && owner.toLowerCase() === CURRENT_APP_SWAP_OWNER &&
        now() >= partial.approvedAt && !partialProof) {
      throw new Error('Restore all eleven prior reservations before the approved partial-refund trial.');
    }
    const partialActive = partialProof && (state.windowStart ?? state.start) >= partial.approvedAt;
    const scope = swapScope ?? key, extra = state.charges.slice(partial.retainedLedgerStarts);
    if (partialProof && (!partialActive || now() < partial.approvedAt || now() >= partial.expiresAt ||
        state.charges.slice(0, partial.retainedLedgerStarts).some(c => c.scope === scope) || extra.some(c => c.scope !== scope) ||
        (phase === 'accept' && gasCap !== 35_000_000n) ||
        extra.reduce((sum, c) => sum + BigInt(c.gasCap), gasCap) > partial.additionalOwnerGas)) {
      throw new Error('Approved partial-refund trial scope, gas or window changed.');
    }
    const swapApproval = exitSwap && (phase === 'token-funding' || phase === 'token-faucet') &&
      gasCap === 5_000_000n && typeof swapScope === 'string' && /^quote:0x[0-9a-f]{64}$/.test(swapScope) &&
      key.startsWith(`${phase}:${swapScope}:`) && /^0x[0-9a-f]{64}$/.test(key.slice(`${phase}:${swapScope}:`.length)) &&
      (!state.charges.some(c=>c.phase==='quote') || phase==='token-funding'&&(
        hasCurrentHistoryReplacementProof(candidate.graph,owner,state.charges)&&state.charges.length===4 ||
        hasCurrentHistoryFastProof(candidate.graph,owner,state.charges)&&state.charges.length===7 || partialActive));
    if (exitSwap && !swapApproval && (!(phase === 'quote' || phase === 'accept' || phase === 'cancel' || phase === 'recover') ||
        (phase === 'quote' ? gasCap !== CURRENT_EXIT_SWAP_GAS_CAPS['fast-pool'].quote :
          phase === 'accept' ? gasCap !== CURRENT_EXIT_SWAP_GAS_CAPS['fast-pool'].accept && gasCap !== CURRENT_EXIT_SWAP_GAS_CAPS['cheap-async'].accept :
            gasCap !== CURRENT_EXIT_SWAP_GAS_CAPS['cheap-async'][phase]))) {
      throw new Error('Current native swap signing phase or gas cap changed.');
    }
    assertCurrentAppSigningCount(candidate.graph,owner,phase,state.charges);
    const recovery = phase === 'cancel' || phase === 'recover', cost = gasCap * fixedGasPrice;
    const reserve = l.recoveryGasCap * fixedGasPrice;
    const windowStart = state.windowStart ?? state.start;
    // Fast Accept settles atomically; this approved final start needs no later recovery transaction.
    const finalFastAccept=phase==='accept'&&gasCap===110_000_000n&&state.charges.length===10&&
      hasCurrentHistoryFastReplacementProof(candidate.graph,owner,state.charges)&&state.charges[9].scope===swapScope;
    if (state.owner !== owner.toLowerCase() || now() < windowStart || now() >= windowStart + (partialActive ? 7200n : recovery ? l.recoverySeconds : l.normalSeconds) ||
        !key || gasCap <= 0n || gasCap > (exitSwap && (phase === 'quote' || phase === 'accept') ? 110_000_000n : 100_000_000n) || state.keys.has(key) ||
        (phase === 'quote' && state.activeSwap !== null && !(exitSwap &&
          (state.charges.every(c=>c.phase==='token-funding'||c.phase==='token-faucet') || hasCurrentHistoryReplacementProof(candidate.graph,owner,state.charges)&&
            state.charges.slice(4).every(c=>c.phase==='token-funding') || hasCurrentHistoryFastProof(candidate.graph,owner,state.charges)&&
            state.charges.slice(7).every(c=>c.phase==='token-funding') || partialActive && extra.every(c=>c.phase==='token-funding')) && state.activeSwap === (swapScope ?? key))) ||
        (phase !== 'quote' && phase !== 'token-funding' && phase !== 'token-faucet' && (state.activeSwap === null || swapScope !== state.activeSwap)) ||
        state.keys.size >= currentAppSigningStartLimit(candidate.graph,owner,state.charges,l.starts) - (recovery||finalFastAccept ? 0 : 1) || state.committed + cost + (recovery ? 0n : reserve) > partialTrialCommitment(candidate.graph,owner,state.charges)) {
      throw new Error('Native signing session budget, reserve, expiry or prior commitment blocks this action.');
    }
  };
  return Object.freeze({ check, commit: (phase: Phase, key: string, gasCap: bigint, swapScope?: string, nonce?: number) => {
    check(phase, key, gasCap, swapScope);
    if (isCurrentDexBrowserSigner(signer,candidate.graph,owner)) {
      assertCurrentDexBrowserWindow(signer,candidate.graph,owner,candidate.core,7082400n,now(),nonce!,gasCap,fixedGasPrice);
      if (state.charges.some(row => row.nonce >= nonce!)) throw new Error('Owner beta nonce was already reserved.');
    }
    const priorActiveSwap = state.activeSwap;
    state.keys.add(key); if (phase === 'quote' || usesCurrentSwapAccounting(candidate) && phase === 'token-funding') state.activeSwap = swapScope ?? key;
    state.committed += gasCap * fixedGasPrice;
    if (usesCurrentSwapAccounting(candidate) && ['quote','accept','cancel','recover','token-funding','token-faucet'].includes(phase) && Number.isSafeInteger(nonce) && nonce! >= 0) {
      state.charges.push({ phase: phase as SwapCharge['phase'], key, scope: swapScope ?? key, gasCap: String(gasCap), gasPrice: String(fixedGasPrice), nonce: nonce!, hash: null });
      // In memory only: a release in the same session restores the exact scope from before this reservation.
      state.lastCommit = { key, activeSwap: priorActiveSwap };
    }
  }, snapshot: () => Object.freeze({ committedWei: state.committed, signingStarts: state.keys.size,
    normalExpiresAt: isCurrentDexBrowserSigner(signer,candidate.graph,owner) ? null : hasCurrentPartialRefundProof(candidate.graph,owner,state.charges) && (state.windowStart??state.start)>=CURRENT_APP_PARTIAL_REFUND_TRIAL.approvedAt ? CURRENT_APP_PARTIAL_REFUND_TRIAL.expiresAt : (state.windowStart ?? state.start) + l.normalSeconds,
    recoveryExpiresAt: isCurrentDexBrowserSigner(signer,candidate.graph,owner) ? null : hasCurrentPartialRefundProof(candidate.graph,owner,state.charges) && (state.windowStart??state.start)>=CURRENT_APP_PARTIAL_REFUND_TRIAL.approvedAt ? CURRENT_APP_PARTIAL_REFUND_TRIAL.expiresAt : (state.windowStart ?? state.start) + l.recoverySeconds }) });
};

// Public financial reservations only. The wallet authenticates this exact record;
// the submission consumer separately reconciles every charge against canonical chain data.
export const currentNativeSwapCheckpoint = (signer: object): CurrentNativeSwapCheckpoint => {
  const b = budgets.get(signer);
  if (!b || b.charges.length !== b.keys.size) throw new Error('Original native budget has no complete reload reservation.');
  return Object.freeze({ version: b.version, owner: b.owner, candidateGraph: b.candidateGraph, start: String(b.start), committedWei: String(b.committed),
    ...(b.windowStart === undefined ? {} : {windowStart: String(b.windowStart)}),
    activeSwap: b.activeSwap, charges: Object.freeze(b.charges.map(c=>Object.freeze({...c}))),
    ...(b.released.length ? { released: Object.freeze(b.released.map(c=>Object.freeze({...c}))) } : {}) });
};
// decision-033. The caller proves that the wallet rejected the request and that the chain shows the
// reserved nonce unused, and then saves the record. The reservation moves to the released list; it is
// never deleted. Returns an undo for a failed save, or null when this reservation was released before.
export const releaseCurrentNativeSwapCharge = (signer: object, owner: string, candidate: CurrentCheapDexIdentity,
  nonce: number, callHash: string, phase?: SwapCharge['phase']): (() => void) | null => {
  const b = budgets.get(signer);
  if (!b || b.version !== 2 || !isCurrentDexBrowserSigner(signer, candidate.graph, owner) || b.owner !== owner.toLowerCase() ||
      b.candidateGraph !== candidate.graph || !Number.isSafeInteger(nonce) || nonce < 0 || !/^0x[0-9a-f]{64}$/.test(callHash))
    throw new Error('Unsent reservation release has no current browser budget.');
  const matches = (row: SwapCharge) => row.nonce === nonce && row.hash === null && (phase === undefined || row.phase === phase) &&
    (row.phase === 'quote' ? row.scope === `quote:${callHash}` : row.phase !== 'token-funding' || row.key.endsWith(`:${callHash}`));
  const last = b.charges[b.charges.length - 1];
  if (!last || !matches(last)) {
    // Repeat calls change nothing. A different open or later reservation is never released here.
    if (b.released.some(matches) && !b.charges.some(row => row.hash === null || row.nonce >= nonce)) return null;
    throw new Error('Unsent reservation release does not match the last reservation.');
  }
  const before = { charges: b.charges, released: b.released, keys: new Set(b.keys), committed: b.committed, activeSwap: b.activeSwap, lastCommit: b.lastCommit };
  const restore = () => { b.charges = before.charges; b.released = before.released; b.keys = new Set(before.keys);
    b.committed = before.committed; b.activeSwap = before.activeSwap; b.lastCommit = before.lastCommit; };
  b.charges = b.charges.slice(0, -1); b.released = [...b.released, { ...last }]; b.keys.delete(last.key);
  b.committed -= BigInt(last.gasCap) * currentNativeSwapChargeGasPrice(last);
  if (before.lastCommit?.key === last.key) b.activeSwap = before.lastCommit.activeSwap;
  else if (b.activeSwap === last.scope && !b.charges.some(row => row.scope === last.scope)) {
    // After a reload the earlier scope is unknown. Keep the scope while confirmed funding still waits for its Quote.
    const lastScope = b.charges[b.charges.length - 1]?.scope;
    const fundingWaits = lastScope !== undefined && b.charges.filter(row => row.scope === lastScope).every(row => row.phase === 'token-funding' && row.hash !== null);
    if (!fundingWaits) b.activeSwap = null;
  }
  b.lastCommit = null;
  try { validateCurrentNativeSwapCheckpoint(currentNativeSwapCheckpoint(signer), owner, candidate, signer); }
  catch (error) { restore(); throw error; }
  return restore;
};
export const recordCurrentNativeSwapHash = (signer: object, nonce: number, callHash: string, transactionHash: string) => {
  const b=budgets.get(signer), charge=b?.charges.find(c=>c.nonce===nonce&&c.hash===null);
  if (!charge || !/^0x[0-9a-f]{64}$/.test(transactionHash) || (charge.phase==='quote' && charge.scope!==`quote:${callHash}`)) throw new Error('Native reload reservation changed.');
  charge.hash=transactionHash;
};
const validateLegacyCurrentNativeSwapCheckpoint = (value: CurrentNativeSwapCheckpoint, owner: string, candidate: CurrentCheapDexIdentity) => {
  const exact=(v:object,keys:string)=>Object.keys(v).sort().join(',')===keys;
  if (!usesCurrentSwapAccounting(candidate) || !value || !(exact(value,'activeSwap,candidateGraph,charges,committedWei,owner,start,version') ||
      exact(value,'activeSwap,candidateGraph,charges,committedWei,owner,start,version,windowStart') && typeof value.windowStart === 'string' &&
      /^(0|[1-9][0-9]*)$/.test(value.windowStart) && BigInt(value.windowStart) >= BigInt(value.start) + CURRENT_NATIVE_SWAP_LIMITS.normalSeconds) || value.version!==1 ||
      value.owner!==owner.toLowerCase() || value.candidateGraph!==candidate.graph || !/^(0|[1-9][0-9]*)$/.test(value.start) ||
      !/^(0|[1-9][0-9]*)$/.test(value.committedWei) || !Array.isArray(value.charges) || value.charges.length===0 || value.charges.length>currentAppSigningStartLimit(candidate.graph,owner,value.charges,CURRENT_NATIVE_SWAP_LIMITS.starts)) throw new Error('Native reload budget record is invalid.');
  assertCurrentSwapIdentity(candidate);
  let committed=0n;const keys=new Set<string>();
  for(const c of value.charges){
    const approval=c?.phase==='token-funding'||c?.phase==='token-faucet';
    const prior=value.charges.slice(0,keys.size),replacementApproval=c?.phase==='token-funding'&&(
      prior.length===4&&hasCurrentHistoryReplacementProof(candidate.graph,owner,prior)&&c.scope!==prior[1].scope ||
      prior.length===7&&hasCurrentHistoryFastProof(candidate.graph,owner,prior)&&c.scope!==prior[1].scope&&c.scope!==prior[5].scope ||
      hasCurrentPartialRefundProof(candidate.graph,owner,prior)&&prior.slice(0,11).every(row=>row.scope!==c.scope)&&prior.slice(11).every(row=>row.scope===c.scope));
    if(!c||!(exact(c,'gasCap,hash,key,nonce,phase,scope')||exact(c,'gasCap,gasPrice,hash,key,nonce,phase,scope')&&c.gasPrice===String(CURRENT_NATIVE_FIXED_GAS_PRICE))||!['quote','accept','cancel','recover','token-funding','token-faucet'].includes(c.phase)||!/^quote:0x[0-9a-f]{64}$/.test(c.scope)||
       (approval ? prior.some(row=>row.phase==='quote')&&!replacementApproval || c.gasPrice!==String(CURRENT_NATIVE_FIXED_GAS_PRICE) || !c.key.startsWith(`${c.phase}:${c.scope}:`) || !/^0x[0-9a-f]{64}$/.test(c.key.slice(`${c.phase}:${c.scope}:`.length)) : c.key!==(c.phase==='quote'?c.scope:`${c.phase}:${c.scope}`))||keys.has(c.key)||!Number.isSafeInteger(c.nonce)||c.nonce<0||
       !/^[1-9][0-9]*$/.test(c.gasCap)||(c.hash!==null&&(!/^0x[0-9a-f]{64}$/.test(c.hash)||BigInt(c.hash)===0n))) throw new Error('Native reload charge record is invalid.');
    const caps=approval?[5_000_000n]:c.phase==='quote'?[110_000_000n]:c.phase==='accept'?[35_000_000n,110_000_000n]:c.phase==='cancel'?[30_000_000n]:[50_000_000n];
    if(!caps.includes(BigInt(c.gasCap))||!approval&&c.phase!=='quote'&&!keys.has(c.scope))throw new Error('Native reload charge scope changed.');
    keys.add(c.key);committed+=BigInt(c.gasCap)*currentNativeSwapChargeGasPrice(c);
    if (prior.length >= 11 && hasCurrentPartialRefundProof(candidate.graph,owner,prior)) {
      assertCurrentAppSigningCount(candidate.graph,owner,c.phase,prior);
      if (BigInt(value.windowStart ?? value.start) < CURRENT_APP_PARTIAL_REFUND_TRIAL.approvedAt ||
          value.charges.slice(0,11).some(row=>row.scope===c.scope) || value.charges.slice(11).some(row=>row.scope!==c.scope) ||
          c.phase==='accept'&&BigInt(c.gasCap)!==35_000_000n ||
          value.charges.slice(11).reduce((sum,row)=>sum+BigInt(row.gasCap),0n)>CURRENT_APP_PARTIAL_REFUND_TRIAL.additionalOwnerGas)
        throw new Error('Approved partial-refund reload scope or gas changed.');
    }
  }
  const replacementFunding=(value.charges.length===5&&hasCurrentHistoryReplacementProof(candidate.graph,owner,value.charges)&&
    value.charges[4].phase==='token-funding'&&value.charges[4].scope===value.activeSwap)||
    value.charges.length===8&&hasCurrentHistoryFastProof(candidate.graph,owner,value.charges)&&value.charges[7].phase==='token-funding'&&value.charges[7].scope===value.activeSwap ||
    hasCurrentPartialRefundProof(candidate.graph,owner,value.charges)&&value.charges.length>11&&value.charges.slice(11).every(c=>c.phase==='token-funding'&&c.scope===value.activeSwap);
  if(committed!==BigInt(value.committedWei)||committed>partialTrialCommitment(candidate.graph,owner,value.charges)||value.activeSwap!==null&&!keys.has(value.activeSwap)&&!replacementFunding&&!(value.charges.every(c=>c.phase==='token-funding'||c.phase==='token-faucet')&&/^quote:0x[0-9a-f]{64}$/.test(value.activeSwap)))throw new Error('Native reload budget totals changed.');
};
// Canonical public prefix identity; old clocks and reservations stay stored/HMAC-bound.
export const currentOwnerBetaLegacyReservationHash = (value: CurrentNativeSwapCheckpoint) => keccak256(toUtf8Bytes(JSON.stringify({
  version:value.version,owner:value.owner,candidateGraph:value.candidateGraph,
  charges:value.charges.slice(0,CURRENT_OWNER_BETA.legacyStarts).map(row=>({phase:row.phase,key:row.key,scope:row.scope,
    gasCap:row.gasCap,gasPrice:row.gasPrice,nonce:row.nonce,hash:row.hash}))
})));
export const validateCurrentNativeSwapCheckpoint = (value: CurrentNativeSwapCheckpoint, owner: string, candidate: CurrentCheapDexIdentity, signer?: object) => {
  if (!(value?.version===2 && isCurrentDexBrowserSigner(signer,candidate.graph,owner)) && !isCurrentOwnerBeta(candidate.graph,owner)) return validateLegacyCurrentNativeSwapCheckpoint(value, owner, candidate);
  const normalUse=value?.version===2;
  if(normalUse){
    if(value.released!==undefined){
      const caps:Record<string,readonly string[]>={quote:['110000000'],accept:['35000000','110000000'],cancel:['30000000'],recover:['50000000'],'token-funding':['5000000']};
      // Shape only. A released row grants nothing; only the browser release step can add one.
      if(!Array.isArray(value.released)||value.released.length===0||
          value.released.some(row=>!row||Object.keys(row).sort().join(',')!=='gasCap,gasPrice,hash,key,nonce,phase,scope'||row.hash!==null||
            !Object.prototype.hasOwnProperty.call(caps,row.phase)||!caps[row.phase].includes(row.gasCap)||row.gasPrice!=='50000000'||!/^quote:0x[0-9a-f]{64}$/.test(row.scope)||
            typeof row.key!=='string'||!row.key||!Number.isSafeInteger(row.nonce)||row.nonce<0))
        throw new Error('Owner normal-use released reservation is invalid.');
    }
    if(Object.keys(value).filter(key=>key!=='released').sort().join(',')!=='activeSwap,candidateGraph,charges,committedWei,owner,start,version'||
        value.owner!==owner.toLowerCase()||value.candidateGraph!==candidate.graph||typeof value.start!=='string'||
        !/^[1-9][0-9]*$/.test(value.start)||BigInt(value.start)<(isCurrentDexBrowserSigner(signer,candidate.graph,owner)?1n:CURRENT_OWNER_BETA.activation!.activatedAt)||
        typeof value.committedWei!=='string'||!/^(0|[1-9][0-9]*)$/.test(value.committedWei)||!Array.isArray(value.charges))
      throw new Error('Owner normal-use reload record is invalid.');
    assertCurrentSwapIdentity(candidate);
  }
  const count = normalUse?0:CURRENT_OWNER_BETA.legacyStarts;
  if (!value || !Array.isArray(value.charges) || value.charges.length < count) {
    throw new Error('Owner beta requires all retained legacy reservations.');
  }
  const legacy = value.charges.slice(0,count), suffix = value.charges.slice(count);
  const legacyFees = legacy.reduce((sum,row) => sum + BigInt(row.gasCap) * currentNativeSwapChargeGasPrice(row), 0n);
  if(!normalUse)validateLegacyCurrentNativeSwapCheckpoint({ ...value, charges: legacy, committedWei: String(legacyFees), activeSwap: null }, owner, candidate);
  if(!normalUse&&currentOwnerBetaLegacyReservationHash(value)!==CURRENT_OWNER_BETA.activation!.legacyReservationHash)
    throw new Error('Owner beta retained legacy reservation changed.');
  const terminalHashes = [
    '0x2e8c953987b9da4dd5149b8053b503bc152ae4fcb699a0597f74e7686201e57e',
    '0xf0555667b314df628eebefd04709adccbd64315e5ea244d6c7dfe0f526ad2bcc',
    '0x38f0f3117ec7985797aee9636754aa29186970329e07fb9f8918e55b4d990210'
  ];
  if (!normalUse&&(!hasCurrentPartialRefundProof(candidate.graph,owner,legacy) || legacy.some(row => !row.hash) ||
      legacy.slice(11).some((row,i) => row.nonce !== 217+i || row.hash !== terminalHashes[i] || row.phase !== ['token-funding','quote','accept'][i]))) {
    throw new Error('Owner beta legacy reservation identity changed.');
  }
  const keys = new Set(legacy.map(row => row.key)), scopes = new Set(legacy.map(row => row.scope));
  let fees = 0n, lastNonce = normalUse && isCurrentDexBrowserSigner(signer,candidate.graph,owner) ? -1 : CURRENT_OWNER_BETA.activation!.startingNonce - 1;
  for (const [index,row] of suffix.entries()) {
    const approval = row?.phase === 'token-funding';
    const caps = row?.phase === 'quote' ? ['110000000'] : row?.phase === 'accept' ? ['35000000','110000000'] :
      row?.phase === 'cancel' ? ['30000000'] : row?.phase === 'recover' ? ['50000000'] : approval ? ['5000000'] : [];
    if (!row || Object.keys(row).sort().join(',') !== 'gasCap,gasPrice,hash,key,nonce,phase,scope' ||
        !caps.includes(row.gasCap) || row.gasPrice !== '50000000' || !/^quote:0x[0-9a-f]{64}$/.test(row.scope) || scopes.has(row.scope) ||
        !Number.isSafeInteger(row.nonce) || row.nonce <= lastNonce ||
        keys.has(row.key) || (row.hash === null ? index !== suffix.length-1 : !/^0x[0-9a-f]{64}$/.test(row.hash) || BigInt(row.hash) === 0n) ||
        (approval ? !row.key.startsWith(`token-funding:${row.scope}:`) || !/^0x[0-9a-f]{64}$/.test(row.key.slice(`token-funding:${row.scope}:`.length)) :
          row.key !== (row.phase === 'quote' ? row.scope : `${row.phase}:${row.scope}`) || row.phase !== 'quote' && !keys.has(row.scope))) {
      throw new Error('Owner beta reload charge changed.');
    }
    lastNonce = row.nonce; keys.add(row.key); fees += BigInt(row.gasCap) * BigInt(row.gasPrice);
  }
  const lastScope = suffix[suffix.length-1]?.scope;
  const unquotedFunding = lastScope !== undefined && suffix.filter(row => row.scope === lastScope).every(row => row.phase === 'token-funding' && row.hash !== null);
  if (value.committedWei !== String(legacyFees + fees) ||
      normalUse && suffix.some(row=>row.hash===null&&value.activeSwap!==row.scope) ||
      value.activeSwap !== null && (!/^quote:0x[0-9a-f]{64}$/.test(value.activeSwap) || scopes.has(value.activeSwap) ||
        !suffix.some(row => row.scope === value.activeSwap) && !unquotedFunding)) {
    throw new Error('Owner beta reload totals or active scope changed.');
  }
};
// The consumer first proves every funding transaction and the fresh exact private allowance.
export const bindCurrentNativeSwapFundingScope = (signer:object,scope:string) => {
  const b=budgets.get(signer);
  if (b && isCurrentDexBrowserSigner(signer,b.candidateGraph,b.owner)) {
    const lastScope=b.charges[b.charges.length-1]?.scope, funding=b.charges.slice(b.version===1?CURRENT_OWNER_BETA.legacyStarts:0).filter(row=>row.scope===lastScope);
    if (!/^quote:0x[0-9a-f]{64}$/.test(scope) || !funding.length || funding.some(row=>!row.hash||row.phase!=='token-funding') ||
        b.charges.some(row=>row.scope===scope)) throw new Error('Owner beta funding needs confirmed unquoted approval and a fresh scope.');
    b.activeSwap=scope;return;
  }
  if(!b||!/^quote:0x[0-9a-f]{64}$/.test(scope)||!b.charges.length||b.charges.some(c=>!c.hash||!['token-funding','token-faucet'].includes(c.phase)))
    throw new Error('Only confirmed funding can bind a fresh Quote scope.');
  b.activeSwap=scope;
};
// The caller authenticates the record, confirms all funding and fresh private funds,
// and excludes pending operations before an explicit owner-reviewed Quote renewal.
export const renewCurrentNativeSwapFundingWindow = (signer:object,owner:string,candidate:CurrentCheapDexIdentity,scope:string,now:bigint):void => {
  const b=budgets.get(signer);
  if(!b||b.owner!==owner.toLowerCase()||b.candidateGraph!==candidate.graph||b.windowStart!==undefined||
      now<b.start+CURRENT_NATIVE_SWAP_LIMITS.normalSeconds||!/^quote:0x[0-9a-f]{64}$/.test(scope)||
      !b.charges.length||b.charges.some(c=>!c.hash||!['token-funding','token-faucet'].includes(c.phase)||c.scope===scope))
    throw new Error('Native funding window renewal requires expired confirmed funding and a fresh Quote scope.');
  validateCurrentNativeSwapCheckpoint(currentNativeSwapCheckpoint(signer),owner,candidate);
  b.windowStart=now;b.activeSwap=scope;
};
// Fresh cancellation proof can renew an expired unused trial; a replacement signing start blocks renewal.
export const renewCurrentNativeSwapClosedWindow = (signer:object,owner:string,candidate:CurrentCheapDexIdentity,scope:string,now:bigint):boolean => {
  const b=budgets.get(signer);
  if(candidate.graph===CURRENT_APP_HISTORY_ENGINEERING_AUTHORITY.graph){
    const partial=CURRENT_APP_PARTIAL_REFUND_TRIAL;
    if(b&&b.owner===owner.toLowerCase()&&b.candidateGraph===candidate.graph&&b.activeSwap===null&&b.charges.length===partial.retainedLedgerStarts&&
        hasCurrentPartialRefundProof(candidate.graph,owner,b.charges)&&b.charges.slice(9).every(c=>c.scope===scope)&&
        now>=partial.approvedAt&&now<partial.expiresAt&&(b.windowStart??b.start)<partial.approvedAt){
      validateCurrentNativeSwapCheckpoint(currentNativeSwapCheckpoint(signer),owner,candidate);
      b.windowStart=now;return true;
    }
    const fastReplacement=CURRENT_APP_HISTORY_FAST_REPLACEMENT_TRIAL;
    if(b&&b.activeSwap===null&&b.charges.length===9&&hasCurrentHistoryFastReplacementProof(candidate.graph,owner,b.charges)&&
        b.charges.slice(7).every(c=>c.scope===scope)&&now>=fastReplacement.approvedAt&&(b.windowStart??b.start)<fastReplacement.approvedAt){
      validateCurrentNativeSwapCheckpoint(currentNativeSwapCheckpoint(signer),owner,candidate);
      b.windowStart=now;return true;
    }
    if(b&&b.activeSwap===null&&b.charges.length===7&&hasCurrentHistoryFastProof(candidate.graph,owner,b.charges)&&
        b.charges.slice(4).every(c=>c.scope===scope)&&now>=CURRENT_APP_HISTORY_FAST_TRIAL.approvedAt&&
        (b.windowStart??b.start)<CURRENT_APP_HISTORY_FAST_TRIAL.approvedAt){
      validateCurrentNativeSwapCheckpoint(currentNativeSwapCheckpoint(signer),owner,candidate);
      b.windowStart=now;return true;
    }
    const r=CURRENT_APP_HISTORY_REPLACEMENT_TRIAL;
    if(!b||b.owner!==owner.toLowerCase()||b.candidateGraph!==candidate.graph||b.activeSwap!==null||b.windowStart!==undefined||
        now<r.approvedAt||now<b.start+CURRENT_NATIVE_SWAP_LIMITS.normalSeconds||b.charges.length!==4||
        !hasCurrentHistoryReplacementProof(candidate.graph,owner,b.charges)||b.charges.some((c,i)=>c.nonce!==148+i)||
        b.charges.slice(1).some(c=>c.scope!==scope))return false;
    validateCurrentNativeSwapCheckpoint(currentNativeSwapCheckpoint(signer),owner,candidate);
    b.windowStart=now;return true;
  }
  // decision-034: the b2aa replacement, further and fourth trials were removed with their candidate.
  return false;
};
export const restoreCurrentNativeSwapCheckpoint = (signer: object, owner: string, candidate: CurrentCheapDexIdentity, value: CurrentNativeSwapCheckpoint) => {
  validateCurrentNativeSwapCheckpoint(value,owner,candidate,signer);
  if(budgets.has(signer)){if(JSON.stringify(currentNativeSwapCheckpoint(signer))!==JSON.stringify(value))throw new Error('Live native budget differs from reload reservation.');return;}
  currentNativeSigningBudget(signer,owner,()=>BigInt(value.start),candidate);
  const b=budgets.get(signer)!;b.version=value.version;b.windowStart=value.windowStart===undefined?undefined:BigInt(value.windowStart);b.committed=BigInt(value.committedWei);b.keys=new Set(value.charges.map(c=>c.key));b.activeSwap=value.activeSwap;b.charges=value.charges.map(c=>({...c}));
  b.released=(value.released??[]).map(c=>({...c}));b.lastCommit=null;
};

// Called only after authenticated terminal/refund proof or an unfunded reverted Quote.
// Missing prior session budget remains a no-op for receipt-only recovery.
export const completeCurrentNativeSwapScope = (signer: object, swapScope: string) => {
  const budget = budgets.get(signer);
  if (budget?.activeSwap === swapScope) budget.activeSwap = null;
};
