import { Interface, getAddress, keccak256 } from '@coti-io/coti-ethers';
import { resolveCurrentCheapDexCandidate, assertCurrentCheapDexNativeAdmission, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { createCurrentAttemptBoundary, type CurrentTransport } from './currentDexSubmission';
import { clearCurrentDexPendingAttempt, currentDexPendingStorage, blockCurrentTokenFundingVerification, recordCurrentDexPendingHash } from './currentDexPendingAttempt';
import type { PrivateUint256Input, PrivateUint256Output } from './privateUint256';
import { assertCurrentSwapCandidate, isCurrentNativeSwapCandidate, currentNativeSigningBudget, CURRENT_NATIVE_SWAP_LIMITS,
  recordCurrentNativePoolOutcome, completeCurrentNativePoolScope } from './currentDexNativeSwapPolicy';
import { admitCurrentNativePoolFunding, currentNativePoolSession, requireCurrentNativePoolSession, CURRENT_NATIVE_POOL_PROFILE } from './currentDexNativePoolPolicy';
import type { CurrentPoolPreparedFunding } from '../features/wallet/currentDexPoolFundingCapability';
import { isKnownCurrentPoolProofMismatch } from './currentDexPoolProofError';

const ct = '(uint256 ciphertextHigh,uint256 ciphertextLow)';
export const currentTokenFundingAbi = new Interface([
  `function balanceOf(address account) view returns(${ct})`,
  `function allowance(address owner,address spender) view returns((${ct} ciphertext,${ct} ownerCiphertext,${ct} spenderCiphertext))`,
  `function approve(address spender,(${ct} ciphertext,bytes signature) value)`,
  'function claimFaucet()', 'function faucetClaimed(address account) view returns(bool)',
  'function faucetAmount() view returns(uint256)', 'function decimals() view returns(uint8)',
  'function publicAmountsEnabled() view returns(bool)', 'function accountEncryptionAddress(address account) view returns(address)',
  `event Approval(address indexed owner,address indexed spender,${ct} ownerValue,${ct} spenderValue)`,
  `event Transfer(address indexed from,address indexed to,${ct} senderValue,${ct} receiverValue)`,
  'event FaucetClaimed(address indexed account)'
]);
export const CURRENT_TOKEN_FAUCET_AMOUNT = 10_000n * 10n ** 18n;
export const CURRENT_TOKEN_FUNDING_CAP = 5_000_000n;
// Native token A faucet: 24c5b96f..., 713863 gas. Both current token runtimes are
// 50ec5254...6d63b. Encrypted approvals B/A: 060e2b76.../02801794..., 460748/459140.
// Exact native hashes and source/receipt pins are checked by the companion test.
export const CURRENT_TOKEN_FUNDING_NATIVE = Object.freeze({
  faucet: '0x24c5b96f133d2f588d646545849180f1f21d15699d696f92a76285a73451e4f9',
  approve: ['0x060e2b7609d2ed003a4a8339f92dec20129a4d427d26d9b0a7f906fa7731c4cf',
    '0x0280179428146f223bb760fd96a82c78640e97c72ef190173e4cd782e2e5c93d'],
  tokenRuntime: '0x50ec5254aca88a9819cc819b1167c86bb8cba36916332c1c5a829b720da6d63b'
});
type Head = Awaited<ReturnType<CurrentTransport['readHead']>>;
export type CurrentTokenFundingState = Readonly<{ tokenIndex: 0 | 1; token: string; owner: string;
  balance: bigint; allowance: bigint; claimed: boolean; faucetAmount: bigint; decimals: bigint;
  publicAmounts: boolean; encryptionAddress: string; block: Head }>;
type Action = 'faucet' | 'approve';
export type CurrentTokenFundingPrepared = Readonly<{ action: Action; before: CurrentTokenFundingState;
  amount: bigint; data: string; graph: string; packageSha256: string; readyToSign: false }>;
export type CurrentTokenFundingResult = CurrentTokenFundingState & Readonly<{ fundingOutcome: 'verified' | 'reverted' }>;
export type CurrentPoolApprovalConfirm = (review:{canonicalIndex:0|1;tokenIndex:0|1;amount:bigint;previousAllowance:bigint;spender:string;cleanup:boolean})=>Promise<boolean>;
const brands = new WeakMap<object, object>();
const attempts = new WeakMap<object, WeakSet<object>>();
// Original private proof closures only; public pending metadata cannot issue one.
const nativeTokenRecoveries=new WeakMap<object,Map<string,()=>Promise<CurrentTokenFundingResult>>>();
const tokenRecoveryKey=(candidate:unknown,owner:string,chainId:bigint,phase:string,callHash:string,nonce:number,txHash:string)=>
  JSON.stringify([candidate,owner.toLowerCase(),String(chainId),phase,callHash.toLowerCase(),nonce,txHash.toLowerCase()]);
const same = (a: string | null, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
const zero = '0x0000000000000000000000000000000000000000';
const receiptSnapshot = (r: NonNullable<Awaited<ReturnType<CurrentTransport['waitForReceipt']>>>) => Object.freeze({ ...r,
  logs: r.logs && Object.freeze(r.logs.map(l => Object.freeze({ ...l, topics: Object.freeze([...l.topics]) }))) });
export const createCurrentTokenFundingAdapter = ({ signer, ownerAddress, chainId, transport, attest, readState, encrypt, decrypt, assertResources, candidate = 'cheap-current',
  now = () => BigInt(Math.floor(Date.now() / 1000)) }: {
  signer: object; ownerAddress: string; chainId: bigint; transport: CurrentTransport; attest: (head: Head) => Promise<void>;
  readState: (index: 0 | 1, head: Head) => Promise<CurrentTokenFundingState>;
  encrypt: (amount: bigint, token: string, selector: string) => Promise<PrivateUint256Input>;
  decrypt: (cipher: PrivateUint256Output) => bigint; assertResources: () => Promise<void>; now?: () => bigint;
  candidate?: CurrentCheapDexCandidateKey;
}) => {
  const c = resolveCurrentCheapDexCandidate(candidate);
  if (c.tokens.some(([, runtime]) => runtime !== CURRENT_TOKEN_FUNDING_NATIVE.tokenRuntime)) throw new Error('Current-token runtime has no funding evidence.');
  const owner = getAddress(ownerAddress), core = getAddress(c.core), storage = currentDexPendingStorage();
  if (chainId !== BigInt(c.chainId) || same(owner, zero)) throw new Error('Wrong current-token owner or chain.');
  const b = createCurrentAttemptBoundary({ storage, c, core, owner, chainId, transport, attest, now, historical: false });
  let used = attempts.get(signer); if (!used) { used = new WeakSet(); attempts.set(signer, used); }
  const otherStates = new WeakMap<object, CurrentTokenFundingState>();
  const poolPreparations = new WeakMap<object,{funding:CurrentPoolPreparedFunding;scope:string;cleanup:boolean}>();
  const metadata = <T extends object>(result: T) => Object.freeze({ ...result, ...(isCurrentNativeSwapCandidate(c) ? { readyToSign: false as const } : {}) });
  const indexOf = (token: string) => {
    const index = c.tokens.findIndex(([at]) => same(at, token));
    if (index !== 0 && index !== 1) throw new Error('Not a current trial token.'); return index;
  };
  const inspect = async (index: 0 | 1, head?: Head) => {
    if (index !== 0 && index !== 1) throw new Error('Not a current trial token.');
    const block = head ?? await b.currentHead(undefined, CURRENT_TOKEN_FUNDING_CAP);
    const s = await readState(index, block); await transport.assertCurrent();
    if (!same(s.token, c.tokens[index][0]) || !same(s.owner, owner) || s.tokenIndex !== index ||
      s.block.hash !== block.hash || s.block.number !== block.number || s.decimals !== 18n || s.publicAmounts ||
      s.faucetAmount !== CURRENT_TOKEN_FAUCET_AMOUNT || s.balance < 0n || s.allowance < 0n ||
      ![zero.toLowerCase(), owner.toLowerCase()].includes(s.encryptionAddress.toLowerCase())) {
      throw new Error('Current-token state, privacy or configuration changed.');
    }
    return Object.freeze({ ...s, block: Object.freeze({ ...block }) });
  };
  const equalState = (a: CurrentTokenFundingState, z: CurrentTokenFundingState) =>
    ['token', 'owner', 'tokenIndex', 'balance', 'allowance', 'claimed', 'faucetAmount', 'decimals', 'publicAmounts', 'encryptionAddress']
      .every(k => a[k as keyof typeof a] === z[k as keyof typeof z]);
  const fundingAuthority = (p: CurrentTokenFundingPrepared) => {
    if (!isCurrentNativeSwapCandidate(c)) return assertCurrentCheapDexNativeAdmission(c);
    assertCurrentSwapCandidate(c);
    const scoped=poolPreparations.get(p);
    const activePool=currentNativePoolSession(signer);
    if(activePool&&!activePool.completed&&!scoped)throw new Error('Only preview-linked approvals may use the native Pool scope.');
    if(scoped){const session=requireCurrentNativePoolSession(signer,owner,c);
      if(session.scope!==scoped.scope||session.funded!==scoped.funding||session.positionId!==undefined||
        (scoped.cleanup?!session.unfundedFailed:session.unfundedFailed)||p.action!=='approve')throw new Error('Native Pool token scope changed.');
      if(scoped.cleanup){if(p.amount!==0n||p.before.allowance===0n)throw new Error('Native Pool zero cleanup is not required.');shape(p.action,p.data);return;}
    }
    if (brands.get(p) !== signer || p.graph !== c.graph || p.packageSha256 !== c.packageSha256 ||
        !['approve', 'faucet'].includes(p.action) || p.readyToSign !== false ||
        !same(p.before.owner, owner) || !same(p.before.token, c.tokens[p.before.tokenIndex]?.[0] ?? '') ||
        (p.action === 'approve' ? p.amount <= 0n || p.amount > CURRENT_NATIVE_SWAP_LIMITS.maximumInput ||
          p.before.balance < p.amount || p.before.allowance >= p.amount : p.amount !== CURRENT_TOKEN_FAUCET_AMOUNT || p.before.claimed)) {
      throw new Error('Native token approval exceeds its finite private funding profile.');
    }
    shape(p.action, p.data);
  };
  const shape = (action: Action, data: string) => {
    const method = action === 'faucet' ? 'claimFaucet' : 'approve', values = currentTokenFundingAbi.decodeFunctionData(method, data);
    if (!same(currentTokenFundingAbi.encodeFunctionData(method, values), data) || action === 'approve' && !same(values[0], core)) {
      throw new Error('Current-token call or Core spender changed.');
    }
    return values;
  };
  const eventProof = (logs: NonNullable<Awaited<ReturnType<CurrentTransport['waitForReceipt']>>>['logs'], action: Action, token: string, amount?: bigint) => {
    if (!logs || logs.length !== (action === 'faucet' ? 2 : 1) || logs.some(l => !same(l.address, token))) throw new Error('Unexpected current-token events.');
    const events = logs.map(l => {
      const e = currentTokenFundingAbi.parseLog({ ...l, topics: [...l.topics] });
      const encoded = e && currentTokenFundingAbi.encodeEventLog(e.fragment, e.args);
      if (!e || encoded?.data.toLowerCase() !== l.data.toLowerCase() || encoded.topics.length !== l.topics.length ||
        encoded.topics.some((t, i) => !same(t, l.topics[i]))) throw new Error('Non-canonical current-token event.'); return e;
    });
    if (action === 'approve') {
      const e = events[0]; if (e.name !== 'Approval' || !same(e.args.owner, owner) || !same(e.args.spender, core)) throw new Error('Wrong private approval event.');
      if (amount !== undefined && decrypt(e.args.ownerValue) !== amount) throw new Error('Wrong private allowance event amount.');
    } else {
      const claim = events.filter(e => e.name === 'FaucetClaimed'), mint = events.filter(e => e.name === 'Transfer');
      if (claim.length !== 1 || mint.length !== 1 || !same(claim[0].args.account, owner) ||
        !same(mint[0].args.from, zero) || !same(mint[0].args.to, owner)) throw new Error('Wrong fixed faucet event.');
      if (amount !== undefined && decrypt(mint[0].args.receiverValue) !== CURRENT_TOKEN_FAUCET_AMOUNT) throw new Error('Wrong private faucet credit.');
    }
  };
  const validate = async (p: CurrentTokenFundingPrepared, fresh = false) => {
    if (brands.get(p) !== signer || p.graph !== c.graph || p.packageSha256 !== c.packageSha256 || p.readyToSign !== false ||
      !['faucet', 'approve'].includes(p.action) || p.amount < 0n || (p.amount===0n&&!poolPreparations.get(p)?.cleanup) || p.amount > CURRENT_TOKEN_FAUCET_AMOUNT) throw new Error('Current-token preparation or owner session changed.');
    shape(p.action, p.data);
    if (fresh) {
      await assertResources(); if (!equalState(p.before, await inspect(p.before.tokenIndex))) throw new Error('Current-token balance or allowance changed. Check again.');
      if (isCurrentNativeSwapCandidate(c)) {
        const other = otherStates.get(p);
        if (!other || !equalState(other, await inspect(other.tokenIndex))) throw new Error('Other current-token state changed. Check again.');
      }
    }
    await transport.assertCurrent();
  };
  const preparePoolApproval = async (funding:CurrentPoolPreparedFunding,canonicalIndex:0|1,
    confirm:(review:{canonicalIndex:0|1;tokenIndex:0|1;amount:bigint;previousAllowance:bigint;spender:string;cleanup:boolean})=>Promise<boolean>,cleanup=false) => {
    if(canonicalIndex!==0&&canonicalIndex!==1||typeof confirm!=='function')throw new Error('Select one canonical Pool approval.');
    const scope=cleanup?requireCurrentNativePoolSession(signer,owner,c).scope:admitCurrentNativePoolFunding(c,funding,signer,CURRENT_NATIVE_POOL_PROFILE);
    const session=requireCurrentNativePoolSession(signer,owner,c);
    if(session.funded!==funding||session.positionId!==undefined||cleanup!==session.unfundedFailed)throw new Error('Native Pool approval branch is not admitted.');
    if(cleanup)await funding.assertUnfundedCleanupCurrent();else await funding.assertCurrent();
    b.requireEmptyPending();await assertResources();
    const tokens=[...c.tokens].sort(([a],[z])=>BigInt(a)<BigInt(z)?-1:1),tokenIndex=indexOf(tokens[canonicalIndex][0]);
    const before=await inspect(tokenIndex),other=await inspect(tokenIndex===0?1:0,before.block),amount=cleanup?0n:canonicalIndex===0?funding.amounts.used0:funding.amounts.used1;
    if(cleanup&&before.allowance===0n)return null;
    if(cleanup?before.allowance!==(canonicalIndex===0?funding.amounts.used0:funding.amounts.used1):before.allowance!==0n||before.balance<amount)throw new Error('Native Pool exact approval allowance/balance changed.');
    if(!await confirm({canonicalIndex,tokenIndex,amount,previousAllowance:before.allowance,spender:core,cleanup}))return null;
    await transport.assertCurrent();if(!equalState(before,await inspect(tokenIndex))||!equalState(other,await inspect(other.tokenIndex)))throw new Error('Native Pool approval state changed during review.');
    const data=currentTokenFundingAbi.encodeFunctionData('approve',[core,await encrypt(amount,before.token,currentTokenFundingAbi.getFunction('approve')!.selector)]);
    const prepared=Object.freeze({action:'approve' as const,before,amount,data,graph:c.graph,packageSha256:c.packageSha256,readyToSign:false as const});
    brands.set(prepared,signer);otherStates.set(prepared,other);poolPreparations.set(prepared,{funding,scope,cleanup});return prepared;
  };
  const abandonEligible=()=>{
    const session=currentNativePoolSession(signer);
    if(!session||session.completed||session.unfundedFailed||!session.funded||session.positionId!==undefined||b.pending()||
      session.owner!==owner.toLowerCase()||JSON.stringify(session.candidate)!==JSON.stringify(c))return false;
    try{currentNativeSigningBudget(signer,owner,now).assertUnfundedAbandon(session.scope);return true;}catch{return false;}
  };
  const abandonmentState=async()=>{
    await transport.assertCurrent();b.requireEmptyPending();
    const session=requireCurrentNativePoolSession(signer,owner,c);
    if(!session.funded||session.positionId!==undefined||session.unfundedFailed)throw new Error('Native Pool unsigned abandonment is not eligible.');
    currentNativeSigningBudget(signer,owner,now).assertUnfundedAbandon(session.scope);
    await session.funded.assertUnfundedCleanupCurrent();await assertResources();
    const head=await b.currentHead(undefined,CURRENT_TOKEN_FUNDING_CAP);
    if(!transport.readNativeResources)throw new Error('Native Pool cleanup resources are unavailable.');
    const resources=await transport.readNativeResources(head);
    if(resources.owner.toLowerCase()!==owner.toLowerCase()||resources.chainId!==chainId||resources.head.hash!==head.hash||resources.head.number!==head.number||
      resources.latestNonce!==resources.pendingNonce||resources.code!=='0x'||resources.gasPrice!==CURRENT_NATIVE_SWAP_LIMITS.fixedGasPrice||
      resources.balance<500_000_000_000_000n+10n**16n)throw new Error('Native Pool cleanup reserve is unavailable.');
    const canonical=[...c.tokens].sort(([a],[z])=>BigInt(a)<BigInt(z)?-1:1);
    const allowances=await Promise.all(canonical.map(([token])=>inspect(indexOf(token),head).then(v=>v.allowance)));
    if(allowances.some((v,i)=>v!==0n&&v!==(i===0?session.funded!.amounts.used0:session.funded!.amounts.used1)))throw new Error('Native Pool cleanup allowance is not exact.');
    await transport.assertCurrent();b.requireEmptyPending();currentNativeSigningBudget(signer,owner,now).assertUnfundedAbandon(session.scope);
    return {session,allowances:allowances as [bigint,bigint]};
  };
  return Object.freeze({
    readCurrentNativePoolResume: async () => {
      await transport.assertCurrent();
      const session=currentNativePoolSession(signer);
      if(!session)return null;
      if(session.owner!==owner.toLowerCase()||JSON.stringify(session.candidate)!==JSON.stringify(c))throw new Error('Native Pool resume session changed.');
      if(session.previewResult&&session.positionId===undefined&&!session.unfundedFailed&&now()<currentNativeSigningBudget(signer,owner,now).snapshot().normalExpiresAt!){const original=session.previewResult,verified=await session.prepared.readPreview(original.transactionHash);
        if(!verified||verified.context!==original.context||JSON.stringify(verified.amounts,(_,v)=>typeof v==='bigint'?v.toString():v)!==
          JSON.stringify(original.amounts,(_,v)=>typeof v==='bigint'?v.toString():v))throw new Error('Retained native Pool preview canonical proof changed.');}
      const approvals:[boolean,boolean]=[false,false];
      if(session.funded){const canonical=[...c.tokens].sort(([a],[z])=>BigInt(a)<BigInt(z)?-1:1);
        for(const index of [0,1] as const){const observed=await inspect(indexOf(canonical[index][0]));
          const used=index===0?session.funded.amounts.used0:session.funded.amounts.used1;
          if(observed.allowance!==0n&&observed.allowance!==used)throw new Error('Retained native Pool approval does not equal its exact used amount.');
          if(session.positionId!==undefined&&observed.allowance!==0n)throw new Error('Funded native Pool allowance is not zero.');
          approvals[index]=observed.allowance===used;}}
      await transport.assertCurrent();
      return Object.freeze({preview:session.prepared,previewResult:session.previewResult,previewHash:session.previewResult?.transactionHash,
        originalPreviewRetryEligible:!b.pending()&&!session.previewResult&&currentNativeSigningBudget(signer,owner,now).snapshot().signingStarts===0&&
          now()<currentNativeSigningBudget(signer,owner,now).snapshot().normalExpiresAt!,
        unfundedAbandonEligible:abandonEligible(),approvals:Object.freeze(approvals),funding:session.funded,positionId:session.positionId,
        producerHash:session.producer?.transactionHash,unfundedFailed:session.unfundedFailed,completed:session.completed});
    },
    abandonCurrentNativePoolFunding:async(confirm:(review:{allowances:readonly [bigint,bigint];scope:string;readyToSign:false})=>Promise<boolean>)=>{
      if(typeof confirm!=='function')throw new Error('Review the irreversible native Pool stop.');
      const before=await abandonmentState();
      if(!await confirm(Object.freeze({allowances:Object.freeze(before.allowances),scope:before.session.scope,readyToSign:false as const})))return null;
      const after=await abandonmentState();
      if(after.session!==before.session||after.allowances.some((v,i)=>v!==before.allowances[i]))throw new Error('Native Pool cleanup state changed during review.');
      after.session.unfundedFailed=true;after.session.unfundedAbandoned=true;
      recordCurrentNativePoolOutcome(signer,after.session.scope,'unfunded-failed');
      const cleanupRequired=Object.freeze(after.allowances.map(v=>v!==0n) as [boolean,boolean]);
      if(!cleanupRequired.some(Boolean)){after.session.completed=true;completeCurrentNativePoolScope(signer,after.session.scope);}
      return Object.freeze({status:after.session.completed?'unfunded-allowances-cleared' as const:'unfunded-abandoned' as const,cleanupRequired,readyToSign:false as const});
    },
    preparePoolApproval:(funding:CurrentPoolPreparedFunding,canonicalIndex:0|1,confirm:Parameters<typeof preparePoolApproval>[2])=>preparePoolApproval(funding,canonicalIndex,confirm),
    preparePoolUnfundedCleanup:(canonicalIndex:0|1,confirm:Parameters<typeof preparePoolApproval>[2])=>{
      const session=requireCurrentNativePoolSession(signer,owner,c);if(!session.funded)throw new Error('Unfunded Pool cleanup has no prepared baseline.');return preparePoolApproval(session.funded,canonicalIndex,confirm,true);},
    readCurrentTokenFunding: inspect,
    prepareCurrentTokenFunding: async ({ tokenIndex, action, amount, confirm }: { tokenIndex: 0 | 1; action: Action; amount: bigint;
      confirm: (review: { action: Action; tokenIndex: 0 | 1; amount: bigint; previousAllowance: bigint; spender: string }) => Promise<boolean> }) => {
      b.requireEmptyPending();
      await assertResources();
      if (typeof amount !== 'bigint' || amount <= 0n || amount > CURRENT_TOKEN_FAUCET_AMOUNT || !['faucet', 'approve'].includes(action)) throw new Error('Use a finite positive current-token amount, at most 10000 test tokens.');
      const before = await inspect(tokenIndex);
      const other = isCurrentNativeSwapCandidate(c) ? await inspect(tokenIndex === 0 ? 1 : 0, before.block) : undefined;
      if (action === 'faucet' ? before.claimed || (!isCurrentNativeSwapCandidate(c) && before.balance >= amount) : before.balance < amount || before.allowance >= amount) throw new Error('Current-token funding action is not required or eligible.');
      if (!await confirm({ action, tokenIndex, amount: action === 'faucet' ? CURRENT_TOKEN_FAUCET_AMOUNT : amount, previousAllowance: before.allowance, spender: core })) return null;
      await transport.assertCurrent();
      if (!equalState(before, await inspect(tokenIndex))) throw new Error('Current-token funding state changed during review.');
      if (other && !equalState(other, await inspect(other.tokenIndex))) throw new Error('Other current-token state changed during review.');
      const data = action === 'faucet' ? currentTokenFundingAbi.encodeFunctionData('claimFaucet') :
        currentTokenFundingAbi.encodeFunctionData('approve', [core, await encrypt(amount, before.token, currentTokenFundingAbi.getFunction('approve')!.selector)]);
      await transport.assertCurrent();
      const p = Object.freeze({ action, before, amount: action === 'faucet' ? CURRENT_TOKEN_FAUCET_AMOUNT : amount, data, graph: c.graph, packageSha256: c.packageSha256, readyToSign: false as const });
      if (other) otherStates.set(p, other);
      brands.set(p, signer); return p;
    },
    submitCurrentTokenFunding: async (p: CurrentTokenFundingPrepared) => {
      fundingAuthority(p);
      const budget = isCurrentNativeSwapCandidate(c) ? currentNativeSigningBudget(signer, owner, now) : null;
      const budgetKey = `token-funding:${p.action}:${p.before.token.toLowerCase()}:${keccak256(p.data).toLowerCase()}`;
      const scoped=poolPreparations.get(p),budgetPhase=scoped?.cleanup?'pool-cleanup':'token-funding';
      const checkPoolResources=async()=>{if(!scoped||!budget)return;
        if(!transport.readNativeResources)throw new Error('Native Pool approval resources are unavailable.');
        const head=await b.currentHead(undefined,CURRENT_TOKEN_FUNDING_CAP),resources=await transport.readNativeResources(head),remaining=budget.snapshot();
        const normal=scoped.cleanup?0n:remaining.poolRemainingNormalWei;
        if(resources.balance<normal+remaining.poolRemainingTailWei+10n**16n)throw new Error('Native Pool approval would consume its remaining lifecycle reserve.');
        await transport.assertCurrent();};
      budget?.check(budgetPhase, budgetKey, CURRENT_TOKEN_FUNDING_CAP,scoped?.scope);
      await validate(p, true); b.requireEmptyPending(); if (used!.has(p)) throw new Error('Current-token action already attempted. Reconcile it.'); used!.add(p); let signing = false;
      const phase = p.action === 'faucet' ? 'token-faucet' : 'token-approve';
      try {
        const sent = await b.sendCurrent(phase, { chainId, from: owner, to: p.before.token, value: 0n, data: p.data }, undefined,
          async () => { fundingAuthority(p); await validate(p, true);if(scoped?.cleanup)await scoped.funding.assertUnfundedCleanupCurrent();await checkPoolResources(); budget?.check(budgetPhase, budgetKey, CURRENT_TOKEN_FUNDING_CAP,scoped?.scope); },
          () => { signing = true; }, undefined, CURRENT_TOKEN_FUNDING_CAP, undefined,
          async () => { fundingAuthority(p);await checkPoolResources(); budget?.commit(budgetPhase, budgetKey, CURRENT_TOKEN_FUNDING_CAP,scoped?.scope); });
        const result=Object.freeze({ ...sent, recover: async () => {
          await validate(p); const pending = b.pending();
          if (!pending || pending.phase !== phase || pending.callHash !== keccak256(p.data).toLowerCase() || pending.nonce !== sent.request.nonce) throw new Error('Current-token pending action changed.');
          if (pending.verificationBlocked) throw new Error('Known current-token verification failure. Manual reconciliation is required.');
          b.requireOwnPending(pending, sent.transactionHash);
          const observed = isCurrentNativeSwapCandidate(c) ? await transport.waitForReceipt(sent.transactionHash) : null;
          const baseline = observed && receiptSnapshot(observed);
          let r: ReturnType<typeof receiptSnapshot>;
          try { r = receiptSnapshot(await b.verifyMinedCall(sent.request, sent.transactionHash, true)); }
          catch (error) {
            if (error instanceof Error && error.message === 'Current DEX canonical transaction inclusion changed. Do not resend.') blockCurrentTokenFundingVerification(storage, pending);
            throw error;
          }
          if (baseline && JSON.stringify(baseline) !== JSON.stringify(r)) {
            blockCurrentTokenFundingVerification(storage, pending); throw new Error('Native token funding receipt changed during canonical verification.');
          }
          const recheckNative = async () => {
            if (!isCurrentNativeSwapCandidate(c)) return;
            try { await b.recheckMinedCall(sent.request, sent.transactionHash, r, true); }
            catch (error) {
              if(!scoped||isKnownCurrentPoolProofMismatch(error))blockCurrentTokenFundingVerification(storage, pending);
              throw error;
            }
          };
          const head = { ...p.before.block, number: BigInt(r.blockNumber!), hash: r.blockHash! };
          await attest(head);
          const other = otherStates.get(p);
          if (other && !equalState(other, await inspect(other.tokenIndex, head))) {
            blockCurrentTokenFundingVerification(storage, pending); throw new Error('Other current-token state changed during funding. Do not resend.');
          }
          if (r.status === 0) {
            if (!r.logs || r.logs.length !== 0) { blockCurrentTokenFundingVerification(storage, pending); throw new Error('Reverted current-token call emitted events.'); }
            const unchanged = await inspect(p.before.tokenIndex, head);
            if (!equalState(unchanged, p.before)) { blockCurrentTokenFundingVerification(storage, pending); throw new Error('Reverted current-token state differs. Do not resend.'); }
            await recheckNative(); await transport.assertCurrent(); clearCurrentDexPendingAttempt(storage, b.requireOwnPending(pending, sent.transactionHash));
            if(scoped&&!scoped.cleanup){const session=currentNativePoolSession(signer)!;session.unfundedFailed=true;recordCurrentNativePoolOutcome(signer,scoped.scope,'unfunded-failed');}
            return Object.freeze({ ...unchanged, fundingOutcome: 'reverted' as const });
          }
          try { eventProof(r.logs, p.action, p.before.token, p.amount); }
          catch (error) { blockCurrentTokenFundingVerification(storage, pending); throw error; }
          const after = await inspect(p.before.tokenIndex, head), expected = { ...p.before,
            balance: p.before.balance + (p.action === 'faucet' ? CURRENT_TOKEN_FAUCET_AMOUNT : 0n),
            allowance: p.action === 'approve' ? p.amount : p.before.allowance,
            claimed: p.action === 'faucet' ? true : p.before.claimed };
          if (!equalState(after, expected)) { blockCurrentTokenFundingVerification(storage, pending); throw new Error('Current-token private credit or allowance differs. Do not resend.'); }
          await recheckNative(); await transport.assertCurrent(); clearCurrentDexPendingAttempt(storage, b.requireOwnPending(pending, sent.transactionHash));
          if(scoped?.cleanup&&after.allowance===0n&&other!.allowance===0n){const session=currentNativePoolSession(signer)!;session.completed=true;completeCurrentNativePoolScope(signer,scoped.scope);}
          return Object.freeze({ ...after, fundingOutcome: 'verified' as const });
        } });
        if(isCurrentNativeSwapCandidate(c)){
          let recoveries=nativeTokenRecoveries.get(signer);if(!recoveries){recoveries=new Map();nativeTokenRecoveries.set(signer,recoveries);}
          recoveries.set(tokenRecoveryKey(c,owner,chainId,phase,keccak256(p.data),sent.request.nonce,sent.transactionHash),result.recover);
        }
        return result;
      } catch (e) { if (!signing) used!.delete(p); throw e; }
    },
    recoverCurrentNativePoolTokenResult:async():Promise<CurrentTokenFundingResult|null>=>{
      await transport.assertCurrent();const pending=b.pending();
      if(!pending||!isCurrentNativeSwapCandidate(c))return null;
      if(pending.chainId!==String(chainId)||!same(pending.owner,owner)||!same(pending.core,core)||pending.graph!==`0x${c.graph}`||
        !['token-faucet','token-approve'].includes(pending.phase))throw new Error('Pending token proof belongs to another owner or candidate.');
      if(pending.verificationBlocked)throw new Error('Known current-token verification failure. Manual reconciliation is required.');
      if(!pending.txHash)return null;
      const recover=nativeTokenRecoveries.get(signer)?.get(tokenRecoveryKey(c,owner,chainId,pending.phase,pending.callHash,pending.nonce,pending.txHash));
      return recover?recover():null;
    },
    recoverPendingCurrentTokenFunding: async (knownTransactionHash?: string) => {
      await transport.assertCurrent(); const p = b.pending(); if (!p) return null;
      if (!['token-faucet', 'token-approve'].includes(p.phase) || p.chainId !== String(chainId) || !same(p.owner, owner) || !same(p.core, core) || p.graph !== `0x${c.graph}`) throw new Error('Pending action belongs to another current adapter.');
      if (p.verificationBlocked) throw new Error('Known current-token verification failure. Manual reconciliation is required.');
      const supplied = knownTransactionHash?.trim().toLowerCase();
      if (supplied && (!/^0x[0-9a-f]{64}$/.test(supplied) || BigInt(supplied) === 0n)) throw new Error('Enter a valid funding transaction hash.');
      if (p.txHash && supplied && supplied !== p.txHash) throw new Error('Funding transaction hash differs from the saved attempt.');
      const transactionHash = p.txHash ?? supplied;
      if (!transactionHash) return metadata({ status: 'manual-reconciliation-required' as const, privateAccountingVerified: false as const });
      const tx = await transport.readTransaction(transactionHash), r = await transport.waitForReceipt(transactionHash);
      if (!tx || !r) return metadata({ status: 'awaiting-chain-confirmation' as const, privateAccountingVerified: false as const });
      const observedReceipt = receiptSnapshot(r);
      const action = p.phase === 'token-faucet' ? 'faucet' : 'approve'; indexOf(tx.to ?? ''); shape(action, tx.data);
      if (keccak256(tx.data).toLowerCase() !== p.callHash) throw new Error('Pending current-token calldata changed.');
      const request = { chainId, from: owner, to: tx.to!, data: tx.data, value: 0n as const, nonce: p.nonce, gasLimit: CURRENT_TOKEN_FUNDING_CAP };
      const canonical = receiptSnapshot(await b.verifyMinedCall(request, transactionHash, true));
      if (isCurrentNativeSwapCandidate(c) && JSON.stringify(observedReceipt) !== JSON.stringify(canonical)) {
        blockCurrentTokenFundingVerification(storage, p); throw new Error('Native token funding receipt changed during canonical verification.');
      }
      // Metadata recovery proves canonical inclusion, not receipt-block private accounting.
      // Admit the current graph without requiring the RPC to retain historical state.
      await b.currentHead(undefined, CURRENT_TOKEN_FUNDING_CAP);
      if (canonical.status === 1) eventProof(canonical.logs, action, tx.to!);
      else if (!canonical.logs || canonical.logs.length !== 0) throw new Error('Reverted current-token call emitted events.');
      await b.recheckMinedCall(request, transactionHash, canonical, true);
      await transport.assertCurrent();
      // Bind an uncertain wallet response only after the exact canonical call is proved.
      if (!p.txHash) recordCurrentDexPendingHash(storage, p, transactionHash);
      clearCurrentDexPendingAttempt(storage, b.requireOwnPending(p, transactionHash));
      const session=currentNativePoolSession(signer);
      if(canonical.status===0&&action==='approve'&&session?.funded&&session.positionId===undefined&&!session.completed){
        session.unfundedFailed=true;recordCurrentNativePoolOutcome(signer,session.scope,'unfunded-failed');
      }
      return metadata({ status: canonical.status === 1 ? 'observed-mined' as const : 'observed-reverted' as const, privateAccountingVerified: false as const });
    }
  });
};
