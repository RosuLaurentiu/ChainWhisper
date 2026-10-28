import { useRef, useState } from 'react';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { type CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import { assertCurrentPoolFundingNativeAdmission } from '../../../lib/currentDexPoolSubmission';
import { assertCurrentAppPoolAuthority, type CurrentAppPoolScope } from '../../../lib/currentDexC1SwapPolicy';
import { resolvePreparedDexScope } from '../../../lib/currentDexPreparedScope';
import { formatDexCandidateTokenAmount, parseDexCandidateTokenAmount, readCurrentDexDisplay, hasCurrentDexPendingAction } from '../../../lib/currentDexDisplay';
import type { CurrentPoolPreparedTopUpPreview, CurrentPoolPreparedTopUpFunding } from '../../wallet/currentDexPoolFundingCapability';
import { currentPoolIntent } from './CurrentPoolWorkspace';
import { currentDexPendingStorage, readCurrentDexPendingAttempt } from '../../../lib/currentDexPendingAttempt';
import TradeActionConfirmModal from '../../trading/components/TradeActionConfirmModal';
import useTradeActionConfirmationState from '../../trading/hooks/useTradeActionConfirmationState';

type Preview = NonNullable<Awaited<ReturnType<CurrentPoolPreparedTopUpPreview['readPreview']>>>;
type Managed = NonNullable<Awaited<ReturnType<CurrentPoolPreparedTopUpFunding['readFunding']>>>;
type Sender = Awaited<ReturnType<NonNullable<NonNullable<SharedWalletSession['actions']>['getCurrentDexSubmissionCapability']>>>;
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
  const [budget0, setBudget0] = useState(''), [budget1, setBudget1] = useState(''), [tolerance, setTolerance] = useState('0.5');
  const [busy, setBusy] = useState(false), [stopState, setStopState] = useState<object | null>(null);
  const [message, setMessage] = useState(''), [preview, setPreview] = useState<{ value: Preview; scope: object } | null>(null);
  const [funding, setFunding] = useState<{ value: CurrentPoolPreparedTopUpFunding; scope: object } | null>(null);
  const [managed, setManaged] = useState<{ value: Managed; scope: object } | null>(null);
  const [approvalState, setApprovalState] = useState<{ scope: object; values: readonly boolean[] } | null>(null);
  const [pending, setPending] = useState<{ phase: 'preview' | 'fund' | 'snapshot' | 'approval-0' | 'approval-1' | 'clear-0' | 'clear-1';
    recover: () => Promise<unknown>; scope: object } | null>(null);
  const getFunding = session.actions?.getCurrentDexPoolFundingCapability, getSender = session.actions?.getCurrentDexSubmissionCapability;
  const getPositions = session.actions?.getCurrentDexPoolPositionCapability;
  const context = { candidateKey: key, graph: candidate.graph, packageSha256: candidate.packageSha256, core: candidate.core,
    owner: session.walletAddress.toLowerCase(), provider: session.browserProvider, chain: session.chainId,
    onboard: session.sessionOnboardInfo, health: session.walletAesHealthByAddress, wallet: session.browserWalletId, source: session.activeSignerSource,
    getFunding, getSender, getPositions, id: position.positionId, proof: position.producerHash, positionContext: position.context,
    pair: position.poolTokens.join(':'), terms: [budget0, budget1, tolerance].join(':') };
  const scope = useRef(context), inFlight = useRef(false), messageScope = useRef<object | null>(null);
  if ((Object.keys(context) as (keyof typeof context)[]).some(key => context[key] !== scope.current[key])) scope.current = context;
  const { confirmation, requestConfirmation, resolveConfirmation } = useTradeActionConfirmationState(scope.current);
  const current = <T,>(value: { value: T; scope: object } | null) => value?.scope === scope.current ? value.value : null;
  const stopped = stopState === scope.current;
  const approvals = approvalState?.scope === scope.current ? approvalState.values : [false, false];
  const setStopped = () => setStopState(scope.current);
  const setApprovals = (values: readonly boolean[]) => setApprovalState({ scope: scope.current, values });
  const labels = position.poolTokens.map(token => readCurrentDexDisplay(candidate).tokens.find(value => value.address === token)!.label);
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
  const run = async (work: (captured: object) => Promise<void>, recovery = false, authority?: () => CurrentAppPoolScope) => {
    if (inFlight.current || busy || (!recovery && (disabled || pending || hasCurrentDexPendingAction()))) return;
    const captured = scope.current; inFlight.current = true; setBusy(true);
    try { if (!recovery) { assertCurrentPoolFundingNativeAdmission(candidate, 'top-up'); assertCurrentAppPoolAuthority(candidate.graph, authority!()); } await work(captured); }
    catch (error) {
      if (captured === scope.current && !hasCurrentDexPendingAction() && !current(preview) && !current(funding) && !current(managed)) onReleased();
      show(captured === scope.current && error instanceof Error ? error.message : 'Top-up session changed. Recover the pending action before another request.');
    }
    finally { inFlight.current = false; setBusy(false); }
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
      confirmPrivateInputs: async () => { const accepted = await confirm('Review liquidity top-up', [
        { label: 'Position NFT', value: position.positionId.toString() }, ...budgets.map((value, i) => ({ label: `${labels[i]} maximum`, value: format(value, i) })),
        { label: 'Funding tolerance', value: `${tolerance}%` } ]); assertScope(captured); return accepted; } });
    assertScope(captured); if (!prepared) { show('Top-up preview cancelled.'); return; }
    setApprovalState(null); setPreview(null); setFunding(null); setManaged(null);
    onBegin(); const sent = await next.submitPoolTopUpPreview(prepared); assertScope(captured);
    setPending({ phase: 'preview', recover: sent.recover, scope: captured }); show('Top-up preview submitted. Check its private result.');
  }, false, () => appAuthority('top-up'));
  const fund = () => run(async captured => {
    const value = current(preview); if (!value || stopped || current(managed)) return;
    const prepared = current(funding) ?? await value.prepareFunding(async amounts => {
      const accepted = await confirm('Review exact top-up amounts', [ ...[amounts.used0, amounts.used1].map((v, i) => ({ label: `${labels[i]} debit`, value: format(v, i) })),
        ...[amounts.unused0, amounts.unused1].map((v, i) => ({ label: `${labels[i]} left in wallet`, value: format(v, i) })),
        { label: 'Added shares', value: amounts.mintedShares.toString() } ]); assertScope(captured); return accepted; });
    assertScope(captured); if (!prepared) { show('Top-up cancelled.'); return; }
    if (!current(funding)) { setApprovals([false, false]); setFunding({ value: prepared, scope: captured }); show('Approve both exact token amounts, then submit the top-up.'); return; }
    if (!approvals.every(Boolean)) { show('Approve both exact token amounts, then submit the top-up.'); return; }
    const sent = await (await sender(captured)).submitPoolTopUpFunding(prepared); assertScope(captured);
    setPending({ phase: 'fund', recover: sent.recover, scope: captured }); show('Top-up submitted. Check exact debits before the paid snapshot.');
  }, false, () => appAuthority('top-up'));
  const approve = (index: 0 | 1, cleanup = false) => run(async captured => {
    const value = current(funding); if (!value || current(managed) || stopped && !cleanup) return;
    const next = await sender(captured), prepared = await next.prepareSharedPoolApproval({ funding: value, canonicalIndex: index, cleanup,
      confirm: async review => { const accepted = await confirm(cleanup ? 'Clear unused top-up approval' : 'Approve exact top-up amount', [
        { label: labels[index], value: format(review.amount, index) }, { label: 'Spender', value: review.spender } ]); assertScope(captured); return accepted; } });
    assertScope(captured); if (!prepared) { show('Approval cancelled.'); return; }
    const sent = await next.submitSharedPoolApproval(prepared); assertScope(captured);
    setPending({ phase: cleanup ? index ? 'clear-1' : 'clear-0' : index ? 'approval-1' : 'approval-0', recover: sent.recover, scope: captured }); show('Approval submitted. Check its private result.');
  }, false, () => appAuthority(cleanup ? 'clear-top-up' : 'approve-top-up'));
  const stop = () => run(async captured => {
    const value = current(funding); if (!value || current(managed)) return;
    const result = await value.abandonUnfunded(async review => { const accepted = await confirm('Stop this unfunded top-up',
      review.allowances.map((v, i) => ({ label: `${labels[i]} remaining approval`, value: format(v, i) }))); assertScope(captured); return accepted; });
    assertScope(captured); if (!result) return; setStopped(); setApprovals(result.cleanupRequired);
    show(result.cleanupRequired.some(Boolean) ? 'Top-up stopped. Clear its remaining approvals.' : 'Top-up stopped. Both allowances are zero.');
    if (!result.cleanupRequired.some(Boolean)) onReleased();
  }, false, () => appAuthority('top-up'));
  const snapshot = () => run(async captured => {
    if (!current(managed) || !getPositions) return;
    const cap = await getPositions(BigInt(candidate.chainId), { candidate: key }); assertScope(captured);
    const prepared = await cap.prepareSnapshot({ positionId: position.positionId, confirm: async review => {
      const accepted = await confirm('Verify liquidity after top-up', [{ label: 'Position NFT', value: review.positionId.toString() },
        { label: 'Maximum network fee', value: `${review.gasCap * 50_000_000n} wei` } ]); assertScope(captured); return accepted; } });
    assertScope(captured); if (!prepared) return;
    const sent = await (await sender(captured)).submitPoolPositionAction(prepared); assertScope(captured);
    // The sender clears its journal after its own snapshot proof. Retain only
    // the confirmed public hash so a later read failure can retry the full
    // top-up checker, which rereads both canonical receipts and private state.
    let snapshotHash: string | null = null;
    setPending({ phase: 'snapshot', recover: async () => {
      if (!snapshotHash) {
        const result = await sent.recover();
        if (!result || !('producerHash' in result) || typeof result.producerHash !== 'string') throw new Error('Top-up snapshot proof is unavailable.');
        snapshotHash = result.producerHash;
      }
      return { producerHash: snapshotHash };
    }, scope: captured }); show('Paid snapshot submitted. Check final private accounting.');
  }, false, () => appAuthority('snapshot'));
  const recover = () => run(async captured => {
    if (!pending || pending.scope !== captured) {
      const saved = readCurrentDexPendingAttempt(currentDexPendingStorage());
      if (!saved) { show('No pending top-up transaction. This view has no retained private accounting proof.'); return; }
      const next = await sender(captured);
      const observed = saved.phase === 'token-approve' ? await next.recoverPendingSharedPoolApproval() :
        saved.phase === 'pool-preview' || saved.phase === 'pool-fund' ? await next.recoverPendingPoolAttempt() :
          saved.phase === 'pool-snapshot' ? await next.recoverPendingPoolPositionAttempt() : null;
      assertScope(captured);
      if (!observed) throw new Error('Pending action belongs to another adapter. Reconcile it before another request.');
      if (observed.status === 'observed-mined' || observed.status === 'observed-reverted') {
        setPending(null); setPreview(null); setFunding(null); setManaged(null); setApprovalState(null); setStopped();
        show('Transaction ' + (observed.status === 'observed-mined' ? 'mined' : 'reverted') +
          '. Public recovery does not confirm private top-up accounting or approvals. Reconcile the position and allowances before another top-up.');
      } else show('Transaction is pending or needs manual reconciliation. Do not resend it.');
      return;
    }
    const result = await pending.recover(); assertScope(captured);
    if (!result || typeof result !== 'object') throw new Error('Private top-up result is unavailable.');
    if (pending.phase === 'preview') {
      if (!('prepareFunding' in result) || typeof result.prepareFunding !== 'function' || !('positionId' in result) || result.positionId !== position.positionId ||
        !('ownerContext' in result) || result.ownerContext !== position.context) throw new Error('Top-up preview proof is unavailable.');
      setPreview({ value: result as Preview, scope: captured }); show('Private top-up preview verified. Review its exact debit.');
    } else if (pending.phase === 'fund') {
      if (!('verifySnapshot' in result) || typeof result.verifySnapshot !== 'function' || !('positionId' in result) || result.positionId !== position.positionId) throw new Error('Top-up management proof is unavailable.');
      setManaged({ value: result as Managed, scope: captured }); onManaged(); show('Exact top-up debits checked. Review the paid snapshot to finish verification.');
    } else if (pending.phase === 'snapshot') {
      const value = current(managed);
      if (!value || !('producerHash' in result) || typeof result.producerHash !== 'string') throw new Error('Top-up snapshot proof is unavailable.');
      const verified = await value.verifySnapshot(result.producerHash); assertScope(captured);
      if (!verified.privateAccountingVerified) throw new Error('Top-up final private accounting is unavailable.');
      await onVerified(result.producerHash);
    } else {
      if (!('privateAccountingVerified' in result) || result.privateAccountingVerified !== true || !('funds' in result)) throw new Error('Approval private accounting is unavailable.');
      const observed = result as Awaited<ReturnType<Awaited<ReturnType<Sender['submitSharedPoolApproval']>>['recover']>>;
      const value = current(funding), funds = observed.funds;
      const index = pending.phase.endsWith('0') ? 0 : 1, cleanup = pending.phase.startsWith('clear-');
      if (!value || funds.owner.toLowerCase() !== context.owner || funds.graph !== candidate.graph || funds.core.toLowerCase() !== candidate.core ||
        funds.packageSha256 !== candidate.packageSha256 || funds.privateFundsVerified !== true || funds.tokens.length !== 4 ||
        observed.token.toLowerCase() !== position.poolTokens[index] || !['verified', 'reverted'].includes(observed.fundingOutcome) ||
        candidate.tokens.some(([token]) => funds.tokens.filter(t => t.address.toLowerCase() === token).length !== 1)) throw new Error('Approval owner, token or candidate changed.');
      const allowances = position.poolTokens.map(token => funds.tokens.find(t => t.address.toLowerCase() === token)?.allowance);
      const used = [value.amounts.used0, value.amounts.used1];
      if (allowances.some((v, i) => v !== 0n && v !== used[i])) throw new Error('Unknown top-up allowance. Reconcile before funding.');
      if (observed.fundingOutcome === 'verified' && allowances[index] !== (cleanup ? 0n : used[index])) throw new Error('Approval result does not match the exact requested allowance.');
      setApprovals(allowances.map((v, i) => stopped ? v !== 0n : v === used[i]));
      if (stopped && allowances.every(v => v === 0n)) onReleased();
      show(observed.fundingOutcome === 'reverted' ? 'Approval reverted. Its rollback was checked.' : stopped ? 'Unused approval checked. Clear any remaining approval.' : 'Exact approval checked. Both tokens must pass before funding.');
    }
    setPending(null);
  }, true);
  const locked = busy || !!pending || disabled || hasCurrentDexPendingAction(), funded = !!current(managed), approvedFunding = current(funding);
  return <section className="dex-v2-test-form" aria-label="Top up owned liquidity" aria-busy={busy}>
    <h3>Top up this position</h3>
    {busy ? <p className="dex-owner-progress" role="status">Preparing or checking your top-up… If MetaMask opens, complete its request there. Keep this attempt open.</p> : null}
    <fieldset hidden={!!current(preview) || funded || stopped} disabled={locked || !!current(preview) || !!approvedFunding || funded || stopped}>
      <label>{labels[0]} maximum<input aria-label={`${labels[0]} top-up maximum`} value={budget0} inputMode="decimal" onChange={e => setBudget0(e.target.value)}/></label>
      <label>{labels[1]} maximum<input aria-label={`${labels[1]} top-up maximum`} value={budget1} inputMode="decimal" onChange={e => setBudget1(e.target.value)}/></label>
      <label>Funding tolerance (%)<input aria-label="Top-up funding tolerance" value={tolerance} inputMode="decimal" onChange={e => setTolerance(e.target.value)}/></label>
      <button type="button" onClick={() => { void requestPreview(); }}>Review top-up preview</button>
    </fieldset>
    {current(preview) && !funded && !stopped ? <button type="button" disabled={locked} onClick={() => { void fund(); }}>{approvedFunding ? 'Submit liquidity top-up' : 'Review exact top-up'}</button> : null}
    {current(preview) && !approvedFunding && !funded && !stopped ? <button type="button" disabled={locked}
      onClick={() => { setStopped(); onReleased(); show('Top-up ended before approvals or funding.'); }}>Finish without funding</button> : null}
    {approvedFunding && !funded ? <>
      {([0, 1] as const).map(i => <button key={i} type="button" disabled={locked || !approvals[i] && stopped || approvals[i] && !stopped}
        onClick={() => { void approve(i, stopped); }}>{stopped ? 'Clear' : 'Approve'} {labels[i]} top-up amount</button>)}
      {!stopped ? <button type="button" disabled={locked} onClick={() => { void stop(); }}>Stop unfunded top-up</button> : null}
    </> : null}
    {funded ? <button type="button" disabled={locked} onClick={() => { void snapshot(); }}>Review top-up verification snapshot</button> : null}
    {stopped && current(preview) && !approvals.some(Boolean) ? <button type="button" disabled={locked} onClick={() => {
      setStopState(null); setApprovalState(null); setPreview(null); setFunding(null); setManaged(null);
      show('Unfunded top-up ended with no remaining approvals. Review a new preview.');
    }}>Start another top-up</button> : null}
    <button type="button" disabled={busy} onClick={() => { void recover(); }}>Check top-up status</button>
    <p role="status">{messageScope.current === scope.current ? message : 'Top-up keeps the current Pool spread. Only the exact previewed amounts can be charged.'}</p>
    <TradeActionConfirmModal confirmation={confirmation} onCancel={() => resolveConfirmation(false)} onConfirm={() => resolveConfirmation(true)}/>
  </section>;
}
