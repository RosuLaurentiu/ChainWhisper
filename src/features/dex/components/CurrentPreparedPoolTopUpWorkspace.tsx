import { wasCurrentDexUnsentReleased } from '../../../lib/currentDexSubmission';
import { CURRENT_UNSENT_RELEASED_MESSAGE, currentDexRecordScope } from '../../../lib/currentDexDisplay';
import TokenApprovalChoice, { useTokenApprovalMode } from '../../wallet/TokenApprovalChoice';
import { MAX_TOKEN_ALLOWANCE } from '../../../lib/tokenAllowance';
import { useEffect, useRef, useState } from 'react';
import { logMobileWalletDiagnostic } from '../../../lib/mobileWalletDiagnostics';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { type CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import { assertCurrentPoolFundingNativeAdmission } from '../../../lib/currentDexPoolSubmission';
import { usesPackedPoolInputs } from '../../../lib/currentDexPoolFunding';
import { assertCurrentAppPoolAuthority, type CurrentAppPoolScope } from '../../../lib/currentDexC1SwapPolicy';
import { resolvePreparedDexScope } from '../../../lib/currentDexPreparedScope';
import { formatDexCandidateTokenAmount, parseDexCandidateTokenAmount, readCurrentDexDisplay, hasCurrentDexPendingAction } from '../../../lib/currentDexDisplay';
import type { CurrentPoolPreparedTopUpPreview, CurrentPoolPreparedTopUpFunding } from '../../wallet/currentDexPoolFundingCapability';
import { currentPoolIntent } from './CurrentPoolWorkspace';
import { currentDexPendingStorage, readCurrentDexPendingAttempt } from '../../../lib/currentDexPendingAttempt';
import { currentPoolVerificationMessage } from '../../../lib/currentDexPoolProofError';
import TradeActionConfirmModal from '../../trading/components/TradeActionConfirmModal';
import useTradeActionConfirmationState from '../../trading/hooks/useTradeActionConfirmationState';
import TransactionSteps, { type StepState } from './TransactionSteps';
import { waitForTopUpReceipt } from './topUpResultWait';

type Preview = NonNullable<Awaited<ReturnType<CurrentPoolPreparedTopUpPreview['readPreview']>>>;
type Managed = NonNullable<Awaited<ReturnType<CurrentPoolPreparedTopUpFunding['readFunding']>>>;
type Sender = Awaited<ReturnType<NonNullable<NonNullable<SharedWalletSession['actions']>['getCurrentDexSubmissionCapability']>>>;
const unknownSendMessage = 'The wallet did not confirm submission. Check the attempt in your wallet activity. Keep this record and do not resend.';
export type PreparedTopUpPosition = Readonly<{ positionId: bigint; context: string; producerHash: string;
  poolTokens: readonly [string, string]; block: Readonly<{ number: bigint; hash: string }> }>;

/** Reuses the existing owner capabilities and one pending journal. All private
 * preview/result authority stays in this mounted owner/session scope. */
export default function CurrentPreparedPoolTopUpWorkspace({ session, position, disabled, onVerified, onManaged, onBegin, onReleased, candidateKey = 'cheap-prepared' }: {
  session: SharedWalletSession; position: PreparedTopUpPosition; disabled: boolean; candidateKey?: CurrentCheapDexCandidateKey;
  onVerified: (producerHash: string) => Promise<void>;
  onManaged: () => void;
  onBegin: () => void; onReleased: () => void;
}) {
  const { key, candidate } = resolvePreparedDexScope(candidateKey);
  const recordScope = currentDexRecordScope(candidate, session.walletAddress);
  const [budget0, setBudget0] = useState(''), [budget1, setBudget1] = useState(''), [tolerance, setTolerance] = useState('0.5');
  const [busy, setBusy] = useState(false), [stopState, setStopState] = useState<object | null>(null);
  const [message, setMessage] = useState(''), [preview, setPreview] = useState<{ value: Preview; scope: object } | null>(null);
  const [funding, setFunding] = useState<{ value: CurrentPoolPreparedTopUpFunding; scope: object } | null>(null);
  const [managed, setManaged] = useState<{ value: Managed; scope: object } | null>(null);
  const [approvalState, setApprovalState] = useState<{ scope: object; values: readonly boolean[] } | null>(null);
  const [pending, setPending] = useState<{ phase: 'preview' | 'fund' | 'snapshot' | 'approval-0' | 'approval-1' | 'clear-0' | 'clear-1';
    recover: () => Promise<unknown>; scope: object } | null>(null);
  // CW-136: display state for the step track only. It grants no action.
  const [busyStep, setBusyStep] = useState<number | null>(null), [completedState, setCompletedState] = useState<object | null>(null);
  const getFunding = session.actions?.getCurrentDexPoolFundingCapability, getSender = session.actions?.getCurrentDexSubmissionCapability;
  const getPositions = session.actions?.getCurrentDexPoolPositionCapability;
  const context = { candidateKey: key, graph: candidate.graph, packageSha256: candidate.packageSha256, core: candidate.core,
    owner: session.walletAddress.toLowerCase(), provider: session.browserProvider, chain: session.chainId,
    onboard: session.sessionOnboardInfo, health: session.walletAesHealthByAddress, wallet: session.browserWalletId, source: session.activeSignerSource,
    getFunding, getSender, getPositions, id: position.positionId, proof: position.producerHash, positionContext: position.context,
    pair: position.poolTokens.join(':'), terms: [budget0, budget1, tolerance].join(':') };
  const [approvalMode0, setApprovalMode0, getApprovalMode0] = useTokenApprovalMode(`${context.owner}:${candidate.graph}:${position.poolTokens[0]}`);
  const [approvalMode1, setApprovalMode1, getApprovalMode1] = useTokenApprovalMode(`${context.owner}:${candidate.graph}:${position.poolTokens[1]}`);
  const scope = useRef(context), inFlight = useRef(false), messageScope = useRef<object | null>(null);
  const changedScopeFields=(Object.keys(context) as (keyof typeof context)[]).filter(key=>context[key]!==scope.current[key]);
  if(changedScopeFields.length){
    logMobileWalletDiagnostic('pool-top-up-scope-invalidated',{phase:'render',fields:changedScopeFields});
    scope.current=context;
  }
  useEffect(()=>{
    logMobileWalletDiagnostic('pool-top-up-mounted');
    return()=>logMobileWalletDiagnostic('pool-top-up-unmounted');
  },[]);
  const { confirmation, requestConfirmation, resolveConfirmation } = useTradeActionConfirmationState(scope.current);
  const current = <T,>(value: { value: T; scope: object } | null) => value?.scope === scope.current ? value.value : null;
  const canAdvanceSnapshot = () => {
    const value=current(managed);if(!value)return false;
    try {
      const saved=readCurrentDexPendingAttempt(currentDexPendingStorage(recordScope));
      return !!saved&&saved.phase==='pool-fund'&&saved.poolTopUpHash===null&&!saved.verificationBlocked&&saved.txHash===value.transactionHash.toLowerCase()&&
        saved.chainId===candidate.chainId&&saved.owner===context.owner&&saved.core===candidate.core.toLowerCase()&&saved.graph===`0x${candidate.graph}`;
    } catch { return false; }
  };
  const stopped = stopState === scope.current;
  const approvals = approvalState?.scope === scope.current ? approvalState.values : [false, false];
  const setStopped = () => setStopState(scope.current);
  const setApprovals = (values: readonly boolean[]) => setApprovalState({ scope: scope.current, values });
  const labels = position.poolTokens.map(token => readCurrentDexDisplay(candidate).tokens.find(value => value.address === token)!.label);
  const approvalIndex = confirmation?.summaryRows.find(row=>row.label==='Token')?.value===labels[1]?1:0;
  const format = (value: bigint, index: number) => formatDexCandidateTokenAmount(candidate, position.poolTokens[index], value);
  const assertScope = (captured: object) => { if (scope.current !== captured) throw new Error('Top-up position, inputs or wallet session changed.'); };
  const appAuthority = (action: CurrentAppPoolScope['action']): CurrentAppPoolScope => {
    const base = { owner: context.owner, action, positionId: position.positionId };
    if (action === 'snapshot') return base;
    const budgets = [parseDexCandidateTokenAmount(candidate, position.poolTokens[0], budget0, labels[0], true),
      parseDexCandidateTokenAmount(candidate, position.poolTokens[1], budget1, labels[1], true)] as const;
    const parsed = currentPoolIntent('1', '1', '1', 0, tolerance);
    return { ...base, budgets, tolerance: [parsed.terms[8], parsed.terms[9]] };
  };
  const show = (value: string) => { messageScope.current = scope.current; setMessage(value); };
  const confirm = (title: string, rows: { label: string; value: string }[]) => requestConfirmation({ title, primaryLabel: 'Continue',
    fundingMoves: [], summaryRows: rows, stats: [], message: 'Only your owner wallet can read these amounts. Each transaction can cost network gas.' });
  const sender = async (captured: object): Promise<Sender> => {
    if (!getSender) throw new Error('Connect the owner wallet.');
    const value = await getSender(BigInt(candidate.chainId), { candidate: key }); assertScope(captured); return value;
  };
  const fail = (error: unknown, captured: object, recovery: boolean) => {
    if (captured === scope.current) {
      const held = hasCurrentDexPendingAction(recordScope);
      if (!held && !current(preview) && !current(funding) && !current(managed)) onReleased();
      if (wasCurrentDexUnsentReleased(error)) show(CURRENT_UNSENT_RELEASED_MESSAGE);
      else if (!recovery && held) {
        let notice = 'Check the saved liquidity attempt before continuing. Do not resend.';
        try {
          const saved = readCurrentDexPendingAttempt(currentDexPendingStorage(recordScope));
          if (saved && !saved.txHash && !saved.walletRejected) notice = unknownSendMessage;
        } catch { /* Keep the hold when the saved record cannot be read. */ }
        show(notice);
      } else show(error instanceof Error ? error.message : 'Top-up failed.');
    } else show('Top-up session changed. Recover the pending action before another request.');
  };
  const run = async (work: (captured: object) => Promise<void>, recovery = false, authority?: () => CurrentAppPoolScope, snapshotHandoff=false,
    stepHint: number | null = null) => {
    if (inFlight.current || busy || (!recovery && (disabled || pending || hasCurrentDexPendingAction(recordScope)&&!(snapshotHandoff&&canAdvanceSnapshot())))) return;
    const captured = scope.current; inFlight.current = true; setBusy(true); setBusyStep(stepHint);
    try { if (!recovery) { assertCurrentPoolFundingNativeAdmission(candidate, 'top-up'); if(key!=='cheap-history')assertCurrentAppPoolAuthority(candidate.graph, authority!()); } await work(captured); }
    catch (error) { fail(error, captured, recovery); }
    finally { inFlight.current = false; setBusy(false); setBusyStep(null); }
  };
  type PendingAction = NonNullable<typeof pending>;
  // One result check for the automatic and the manual path. It reads and verifies; it never sends.
  const settlePending = async (active: PendingAction, captured: object) => {
    const result = await active.recover(); assertScope(captured);
    if (!result || typeof result !== 'object') throw new Error('Private top-up result is unavailable.');
    if (active.phase === 'preview') {
      if (!('prepareFunding' in result) || typeof result.prepareFunding !== 'function' || !('positionId' in result) || result.positionId !== position.positionId ||
        !('ownerContext' in result) || result.ownerContext !== position.context) throw new Error('Top-up preview proof is unavailable.');
      setPreview({ value: result as Preview, scope: captured }); show('Private top-up preview verified. Review its exact debit.');
    } else if (active.phase === 'fund') {
      if (!('verifySnapshot' in result) || typeof result.verifySnapshot !== 'function' || !('positionId' in result) || result.positionId !== position.positionId) throw new Error('Top-up management proof is unavailable.');
      setManaged({ value: result as Managed, scope: captured }); onManaged(); show('Exact top-up debits checked. Select Verify position for the paid snapshot.');
    } else if (active.phase === 'snapshot') {
      const value = current(managed);
      if (!value || !('producerHash' in result) || typeof result.producerHash !== 'string') throw new Error('Top-up snapshot proof is unavailable.');
      if (!('privateAccountingVerified' in result) || result.privateAccountingVerified !== true ||
        !('poolTopUpHash' in result) || result.poolTopUpHash !== value.transactionHash.toLowerCase()) throw new Error('Top-up final private accounting is unavailable.');
      await onVerified(result.producerHash); setCompletedState(captured);
    } else {
      if (!('privateAccountingVerified' in result) || result.privateAccountingVerified !== true || !('funds' in result)) throw new Error('Approval private accounting is unavailable.');
      const observed = result as Awaited<ReturnType<Awaited<ReturnType<Sender['submitSharedPoolApproval']>>['recover']>>;
      const value = current(funding), funds = observed.funds;
      const index = active.phase.endsWith('0') ? 0 : 1, cleanup = active.phase.startsWith('clear-');
      if (!value || funds.owner.toLowerCase() !== context.owner || funds.graph !== candidate.graph || funds.core.toLowerCase() !== candidate.core ||
        funds.packageSha256 !== candidate.packageSha256 || funds.privateFundsVerified !== true || funds.tokens.length !== 4 ||
        observed.token.toLowerCase() !== position.poolTokens[index] || !['verified', 'reverted'].includes(observed.fundingOutcome) ||
        candidate.tokens.some(([token]) => funds.tokens.filter(t => t.address.toLowerCase() === token).length !== 1)) throw new Error('Approval owner, token or candidate changed.');
      const allowances = position.poolTokens.map(token => funds.tokens.find(t => t.address.toLowerCase() === token)?.allowance);
      const used = [value.amounts.used0, value.amounts.used1];
      if (observed.fundingOutcome === 'verified' && (cleanup ? allowances[index] !== 0n : allowances[index]! < used[index])) throw new Error('Approval result does not match the exact requested allowance.');
      setApprovals(allowances.map((v, i) => stopped ? v !== 0n : v! >= ((i === 0 ? getApprovalMode0() : getApprovalMode1()) === 'unlimited' ? MAX_TOKEN_ALLOWANCE : used[i])));
      if (stopped && allowances.every(v => v === 0n)) onReleased();
      show(observed.fundingOutcome === 'reverted' ? 'Approval reverted. Its rollback was checked.' : stopped ? 'Unused approval checked. Clear any remaining approval.' : 'Exact approval checked. Both tokens must pass before funding.');
    }
    setPending(null);
  };
  // CW-136: the App checks each submitted transaction itself. A late or failed check keeps the pending
  // state and the saved record unchanged; Check status repeats the same check.
  const autoSettle = async (active: PendingAction, transactionHash: string, captured: object) => {
    if (!await waitForTopUpReceipt(session.browserProvider, transactionHash, () => scope.current === captured)) {
      if (scope.current === captured) show('The transaction is not confirmed yet. Select Check status in a moment. Do not resend.');
      return;
    }
    try { await settlePending(active, captured); }
    catch (error) { fail(error, captured, true); }
  };
  const requestPreview = () => run(async captured => {
    if (!getFunding || !session.browserProvider || current(funding) || current(managed) || stopped) return;
    const budgets = [parseDexCandidateTokenAmount(candidate, position.poolTokens[0], budget0, labels[0], true),
      parseDexCandidateTokenAmount(candidate, position.poolTokens[1], budget1, labels[1], true)] as const;
    // Reuse the existing exact percentage parser. Top-up has no starting-price or
    // spread input: these belong to the authenticated existing position.
    const parsed = currentPoolIntent('1', '1', '1', 0, tolerance), fraction = [parsed.terms[8], parsed.terms[9]] as const;
    const next = await sender(captured);
    const raw = await session.browserProvider.request({ method: 'eth_getBlockByNumber', params: ['latest', false] }) as { number: string; hash: string };
    assertScope(captured);
    if (!raw || !/^0x[0-9a-fA-F]+$/.test(raw.number) || !/^0x[0-9a-fA-F]{64}$/.test(raw.hash)) throw new Error('Top-up block is unavailable.');
    const cap = await getFunding(BigInt(candidate.chainId), { candidate: key }); assertScope(captured);
    const prepared = await cap.preparePoolTopUp({ graph: { expectedGraph: candidate.graph, expectedPackageSha256: candidate.packageSha256,
      blockNumber: BigInt(raw.number), blockHash: raw.hash }, positionId: position.positionId, ownerContext: position.context,
      producerHash: position.producerHash, pair: position.poolTokens, intent: { budgets, tolerance: fraction },
      confirmPrivateInputs: async () => { const accepted = true; assertScope(captured);
        if (accepted) show(`Complete ${usesPackedPoolInputs(candidate) ? 3 : 4} private-input signatures for this preview. The transaction request follows separately.`);
        return accepted; } });
    assertScope(captured); if (!prepared) { show('Top-up preview cancelled.'); return; }
    setApprovalState(null); setPreview(null); setFunding(null); setManaged(null);
    onBegin(); const sent = await next.submitPoolTopUpPreview(prepared); assertScope(captured);
    const submitted: PendingAction = { phase: 'preview', recover: sent.recover, scope: captured };
    setPending(submitted); show('Top-up preview submitted. The App checks its private result.');
    await autoSettle(submitted, sent.transactionHash, captured);
  }, false, () => appAuthority('top-up'), false, 1);
  const fund = () => run(async captured => {
    const value = current(preview); if (!value || stopped || current(managed)) return;
    const prepared = current(funding) ?? await value.prepareFunding(async amounts => {
      const accepted = await confirm('Review exact top-up amounts', [ ...[amounts.used0, amounts.used1].map((v, i) => ({ label: `${labels[i]} debit`, value: format(v, i) })),
        ...[amounts.unused0, amounts.unused1].map((v, i) => ({ label: `${labels[i]} unused from entered budget`, value: format(v, i) })),
        { label: 'Added shares', value: amounts.mintedShares.toString() },
        { label: 'Private-input signatures for funding', value: String(usesPackedPoolInputs(candidate) ? 3 : 4) },
        { label: 'After signing', value: 'If token approvals are ready, your wallet will request the top-up transaction. Otherwise, approve the remaining token amounts first.' },
        { label: 'Token approvals, top-up and snapshot', value: 'Separate wallet requests; network fees apply' } ]); assertScope(captured);
      if (accepted) show(`Complete ${usesPackedPoolInputs(candidate) ? 3 : 4} private-input signatures for funding. Token approvals and transactions are separate.`);
      return accepted; });
    assertScope(captured); if (!prepared) { show('Top-up cancelled.'); return; }
    let ready = approvals;
    if (!current(funding)) {
      ready = await (await sender(captured)).readSharedPoolAllowances(prepared, [approvalMode0, approvalMode1]); assertScope(captured);
      setApprovals(ready); setFunding({ value: prepared, scope: captured });
    }
    if (!ready.every(Boolean)) { show('Funding prepared. Approve the remaining token amounts, then select Deposit top-up.'); return; }
    show('Checking funding. Your wallet will ask you to confirm the top-up transaction.');
    const sent = await (await sender(captured)).submitPoolTopUpFunding(prepared); assertScope(captured);
    const submitted: PendingAction = { phase: 'fund', recover: sent.recover, scope: captured };
    setPending(submitted); show('Top-up submitted. The App checks the exact debits.');
    await autoSettle(submitted, sent.transactionHash, captured);
  }, false, () => appAuthority('top-up'), false, 2);
  const approve = (index: 0 | 1, cleanup = false) => run(async captured => {
    const value = current(funding); if (!value || current(managed) || stopped && !cleanup) return;
    const next = await sender(captured);
    if (!cleanup) {
      const existing = await next.readSharedPoolAllowances(value, [approvalMode0, approvalMode1]); assertScope(captured);
      setApprovals(existing);
      if (existing[index]) { show(`Exact ${labels[index]} allowance verified.`); return; }
    }
    const prepared = await next.prepareSharedPoolApproval({ funding: value, canonicalIndex: index, cleanup, approvalMode: index === 0 ? getApprovalMode0 : getApprovalMode1,
      confirm: async review => { const accepted = await confirm(cleanup ? 'Clear unused top-up approval' : 'Approve top-up token', [
        { label: 'Token', value: labels[index] }, { label: cleanup ? 'New allowance' : 'Top-up amount', value: format(review.amount, index) }, { label: 'Spender', value: review.spender } ]); assertScope(captured); return accepted; } });
    assertScope(captured); if (!prepared) { show('Approval cancelled.'); return; }
    const sent = await next.submitSharedPoolApproval(prepared); assertScope(captured);
    const submitted: PendingAction = { phase: cleanup ? index ? 'clear-1' : 'clear-0' : index ? 'approval-1' : 'approval-0', recover: sent.recover, scope: captured };
    setPending(submitted); show('Approval submitted. The App checks its private result.');
    await autoSettle(submitted, sent.transactionHash, captured);
  }, false, () => appAuthority(cleanup ? 'clear-top-up' : 'approve-top-up'), false, 2);
  const stop = () => run(async captured => {
    const value = current(funding); if (!value || current(managed)) return;
    const result = await value.abandonUnfunded(async review => { const accepted = await confirm('Stop this unfunded top-up',
      review.allowances.map((v, i) => ({ label: `${labels[i]} remaining approval`, value: format(v, i) }))); assertScope(captured); return accepted; });
    assertScope(captured); if (!result) return; setStopped(); setApprovals(result.cleanupRequired);
    show(result.cleanupRequired.some(Boolean) ? 'Top-up stopped. Keep approvals for later use or revoke them separately.' : 'Top-up stopped. Both allowances are zero.');
    if (!result.cleanupRequired.some(Boolean)) onReleased();
  }, false, () => appAuthority('top-up'), false, 2);
  const snapshot = () => run(async captured => {
    const topUp = current(managed); if (!topUp || !getPositions) return;
    const cap = await getPositions(BigInt(candidate.chainId), { candidate: key }); assertScope(captured);
    const prepared = await cap.prepareSnapshot({ positionId: position.positionId, confirm: async review => {
      const accepted = await confirm('Verify liquidity after top-up', [{ label: 'Position NFT', value: review.positionId.toString() },
        { label: 'Maximum network fee', value: `${review.gasCap * 50_000_000n} wei` } ]); assertScope(captured); return accepted; } });
    assertScope(captured); if (!prepared) return;
    const sent = await (await sender(captured)).submitPoolPositionAction(prepared, topUp); assertScope(captured);
    const submitted: PendingAction = { phase: 'snapshot', recover: sent.recover, scope: captured };
    setPending(submitted); show('Paid snapshot submitted. The App checks final private accounting.');
    await autoSettle(submitted, sent.transactionHash, captured);
  }, false, () => appAuthority('snapshot'), true, 3);
  const recover = () => run(async captured => {
    if (!pending || pending.scope !== captured) {
      const saved = readCurrentDexPendingAttempt(currentDexPendingStorage(recordScope));
      if (!saved) {
        if (current(funding) && !current(managed) && !stopped) show(approvals.every(Boolean)
          ? 'Funding prepared. Select Deposit top-up to confirm the transaction in your wallet.'
          : 'Funding prepared. Approve the remaining token amounts, then select Deposit top-up.');
        else if (current(preview) && !current(funding) && !stopped) show('Private top-up preview verified. Review its exact debit.');
        else show('No pending top-up transaction. This view has no retained private accounting proof.');
        return;
      }
      const next = await sender(captured);
      const observed = saved.phase === 'token-approve' ? await next.recoverPendingSharedPoolApproval() :
        saved.phase === 'pool-preview' || saved.phase === 'pool-fund' ? await next.recoverPendingPoolAttempt() :
          saved.phase === 'pool-snapshot' ? await next.recoverPendingPoolPositionAttempt() : null;
      assertScope(captured);
      if (!observed) throw new Error('Pending action belongs to another adapter. Reconcile it before another request.');
      // decision-033: nothing was sent, so the verified state of this view stays valid and the top-up is not stopped.
      if (observed.status === 'released-unsent') {
        setPending(null); show(CURRENT_UNSENT_RELEASED_MESSAGE);
        if (!current(preview) && !current(funding) && !current(managed)) onReleased();
        return;
      }
      if (observed.status === 'observed-mined' || observed.status === 'observed-reverted') {
        setPending(null); setPreview(null); setFunding(null); setManaged(null); setApprovalState(null); setStopped();
        show('Transaction ' + (observed.status === 'observed-mined' ? 'mined' : 'reverted') +
          '. Public recovery does not confirm private top-up accounting or approvals. Reconcile the position and allowances before another top-up.');
      } else if (observed.status === 'observed-mined-verification-held' || observed.status === 'observed-reverted-verification-held') {
        const action = saved.phase === 'pool-fund' ? 'Top-up deposit' : saved.phase === 'pool-snapshot' ? 'Top-up verification snapshot' : 'Transaction';
        show(`${action} ${observed.status === 'observed-mined-verification-held' ? 'mined' : 'reverted'}, but verification remains on hold. ${observed.poolTopUpHash && !observed.verificationFailure ? 'Final top-up accounting has not completed.' : currentPoolVerificationMessage(observed.verificationFailure)} ${saved.phase === 'pool-snapshot' && observed.status === 'observed-mined-verification-held' ? 'Close this panel and select Review held top-up in the position details.' : 'Keep the saved record.'} Do not resend.`);
      } else if (observed.status === 'manual-reconciliation-required' && !saved.txHash && !saved.walletRejected) {
        show(unknownSendMessage);
      } else show('Transaction is pending or needs a status check. Do not resend it.');
      return;
    }
    await settlePending(pending, captured);
  }, true);
  const held = hasCurrentDexPendingAction(recordScope);
  const locked = busy || !!pending || disabled || held, funded = !!current(managed), approvedFunding = current(funding);
  // CW-136: step track. Display only: it reads existing state and the public saved phase.
  const pendingNow = pending && pending.scope === scope.current ? pending : null, completed = completedState === scope.current;
  const holdBlocks = held && !pendingNow && !busy && !(funded && canAdvanceSnapshot());
  const savedStep = (() => {
    if (!holdBlocks) return 0;
    try {
      const phase = readCurrentDexPendingAttempt(currentDexPendingStorage(recordScope))?.phase;
      return phase === 'pool-snapshot' ? 3 : phase === 'pool-fund' || phase === 'token-approve' ? 2 : phase === 'pool-preview' ? 1 : 0;
    } catch { return 0; }
  })();
  const activeStep = completed ? 4 : Math.max(funded ? 3 : current(preview) ? 2 : pendingNow?.phase === 'preview' ? 1 : 0,
    busy && busyStep !== null ? busyStep : 0, savedStep);
  const signatures = usesPackedPoolInputs(candidate) ? 3 : 4;
  const stepsDetail = completed ? 'Your position has the new liquidity.' :
    holdBlocks ? 'A saved attempt needs a status check. Do not resend.' :
    stopped ? 'Top-up stopped before funding.' :
    pendingNow && !busy ? 'A transaction is submitted. Select Check status.' :
    activeStep === 0 ? 'Enter the maximum amount of each token.' :
    activeStep === 1 ? `${signatures} private-input signatures, then 1 transaction.` :
    activeStep === 2 ? approvedFunding ? approvals.every(Boolean) ? 'Confirm 1 transaction in your wallet.' :
      'Approve the remaining token amounts. Then confirm 1 transaction.' :
      `Review the exact amounts. Then ${signatures} private-input signatures and 1 transaction.` :
    '1 transaction verifies your position.';
  const stepsModel = { title: completed ? 'Top-up complete' : `Step ${activeStep + 1} of 4`, detail: stepsDetail,
    outcome: completed ? 'complete' as const : holdBlocks || stopped ? 'stopped' as const : busy || activeStep > 0 ? 'running' as const : 'idle' as const,
    steps: ['Amounts', 'Preview', 'Deposit', 'Verify'].map((label, index) => ({ label,
      state: (index < activeStep ? 'done' : index > activeStep ? 'next' : busy ? 'wallet' : holdBlocks || stopped ? 'stopped' : 'active') as StepState })) };
  return <section className="dex-owner-top-up" aria-label="Top up owned liquidity" aria-busy={busy}>
    <TransactionSteps label="Top-up steps" className="dex-owner-top-up-steps" model={stepsModel} />
    {busy ? <p className="dex-owner-progress" role="status">Preparing or checking your top-up… If MetaMask opens, complete its request there. Keep this attempt open.</p> : null}
    <fieldset className="dex-v2-panel-fields" hidden={held || !!current(preview) || funded || stopped} disabled={locked || !!current(preview) || !!approvedFunding || funded || stopped}>
      <label>{labels[0]} maximum<input aria-label={`${labels[0]} top-up maximum`} value={budget0} inputMode="decimal" onChange={e => setBudget0(e.target.value)}/></label>
      <label>{labels[1]} maximum<input aria-label={`${labels[1]} top-up maximum`} value={budget1} inputMode="decimal" onChange={e => setBudget1(e.target.value)}/></label>
      <label>Funding tolerance (%)<input aria-label="Top-up funding tolerance" value={tolerance} inputMode="decimal" onChange={e => setTolerance(e.target.value)}/></label>
      <button type="button" onClick={() => { void requestPreview(); }}>Preview top-up</button>
    </fieldset>
    {current(preview) && !funded && !stopped ? <button type="button" disabled={locked} onClick={() => { void fund(); }}>{approvedFunding ? 'Deposit top-up' : 'Review and deposit'}</button> : null}
    {current(preview) && !approvedFunding && !funded && !stopped ? <button type="button" disabled={locked}
      onClick={() => { setStopped(); onReleased(); show('Top-up ended before approvals or funding.'); }}>Finish without funding</button> : null}
    {approvedFunding && !funded ? <>
      {([0, 1] as const).map(i => <button key={i} type="button" disabled={locked || !approvals[i] && stopped || approvals[i] && !stopped}
        onClick={() => { void approve(i, stopped); }}>{stopped ? 'Clear' : 'Approve'} {labels[i]} top-up amount</button>)}
      {!stopped ? <button type="button" disabled={locked} onClick={() => { void stop(); }}>Stop unfunded top-up</button> : null}
    </> : null}
    {funded && !completed ? <button type="button" disabled={busy||!!pending||disabled||!canAdvanceSnapshot()} onClick={() => { void snapshot(); }}>Verify position</button> : null}
    {stopped && current(preview) && candidateKey === 'cheap-history' && approvals.some(Boolean) ? <button type="button" disabled={locked} onClick={() => {
      onReleased(); setStopState(null); setApprovalState(null); setPreview(null); setFunding(null); setManaged(null);
      show('Top-up ended. Approvals remain available for later use.');
    }}>Keep approvals and finish</button> : null}
    {stopped && current(preview) && !approvals.some(Boolean) ? <button type="button" disabled={locked} onClick={() => {
      setStopState(null); setApprovalState(null); setPreview(null); setFunding(null); setManaged(null);
      show('Unfunded top-up ended with no remaining approvals. Review a new preview.');
    }}>Start another top-up</button> : null}
    <p role="status">{messageScope.current === scope.current ? message : held ? 'Check the saved liquidity attempt before continuing.' :
      'Top-up keeps the current Pool spread. Only the exact previewed amounts can be charged.'}</p>
    {/* CW-136: the App checks each result itself. This fallback shows only for a pending or saved action. */}
    {pending || held ? <button type="button" disabled={busy} onClick={() => { void recover(); }}>Check status</button> : null}
    <TradeActionConfirmModal confirmation={confirmation} onCancel={() => resolveConfirmation(false)} onConfirm={() => resolveConfirmation(true)}
      details={confirmation?.title==='Approve top-up token'?<TokenApprovalChoice token={labels[approvalIndex]} spender={candidate.core}
        value={approvalIndex===0?approvalMode0:approvalMode1} onChange={approvalIndex===0?setApprovalMode0:setApprovalMode1}/>:null}/>
  </section>;
}
