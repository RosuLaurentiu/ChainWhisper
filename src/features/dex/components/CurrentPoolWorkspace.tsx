import { useRef, useState } from 'react';
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import { resolveCurrentCheapDexCandidate, STAGED_NATIVE_DEX_CANDIDATE, type CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import { assertCurrentPoolFundingNativeAdmission } from '../../../lib/currentDexPoolSubmission';
import { assertCurrentAppPoolAuthority, assertCurrentAppPoolAllowanceCleanupAuthority } from '../../../lib/currentDexC1SwapPolicy';
import { CURRENT_NATIVE_POOL_PROFILE } from '../../../lib/currentDexNativePoolPolicy';
import { resolvePreparedDexScope } from '../../../lib/currentDexPreparedScope';
import { currentDexPendingStorage, readCurrentDexPendingAttempt } from '../../../lib/currentDexPendingAttempt';
import { CURRENT_DEX_POOL_LABELS, currentDexTokenLabel, formatCurrentDexTokenAmount, parseCurrentDexTokenAmount, hasCurrentDexPendingAction,
  readCurrentDexDisplay, currentDexDisplayPair, formatDexCandidateTokenAmount, parseDexCandidateTokenAmount } from '../../../lib/currentDexDisplay';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { resolveBrowserWalletPrivacyState } from '../../../lib/walletSession';
import type { CurrentPoolPreparedPreview } from '../../wallet/currentDexPoolFundingCapability';
import TradeActionConfirmModal from '../../trading/components/TradeActionConfirmModal';
import useTradeActionConfirmationState from '../../trading/hooks/useTradeActionConfirmationState';
import './CurrentPoolWorkspace.css';

export const CURRENT_POOL_SPREADS = ['0.1', '0.3', '0.5', '1', '2', '5', '10'] as const;
const spreadFractions = [[1001n, 1000n], [1003n, 1000n], [201n, 200n], [101n, 100n], [51n, 50n], [21n, 20n], [11n, 10n]];
type Sender = Awaited<ReturnType<NonNullable<NonNullable<SharedWalletSession['actions']>['getCurrentDexSubmissionCapability']>>>;
type Preview = NonNullable<Awaited<ReturnType<CurrentPoolPreparedPreview['readPreview']>>>;
type Amounts = Preview['amounts'];
type PreparedFunding = NonNullable<Awaited<ReturnType<Preview['prepareFunding']>>>;

export const parseCurrentTrialAtoms = (value: string, positive = false) => {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Enter a whole number of token atoms.');
  const parsed = BigInt(value);
  if (parsed >= 1n << 256n || (positive && parsed === 0n)) throw new Error('Token atom amount is outside the supported range.');
  return parsed;
};
export const parseCurrentTrialPriceLimit = (value: string) => {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  if (!match || value.length > 78 || (match[2]?.length ?? 0) > 38) throw new Error('Enter a valid positive price limit.');
  let denominator = 10n ** BigInt(match[2]?.length ?? 0);
  let numerator = BigInt(match[1]) * denominator + BigInt(match[2] || '0');
  if (numerator === 0n) throw new Error('Enter a valid positive price limit.');
  let divisor = numerator, remainder = denominator;
  while (remainder !== 0n) [divisor, remainder] = [remainder, divisor % remainder];
  numerator /= divisor; denominator /= divisor;
  if (numerator >= 1n << 128n || denominator >= 1n << 128n) throw new Error('Price limit is outside the supported range.');
  return { numerator, denominator };
};
export const currentPoolFractionWitness = (n: bigint, d: bigint): readonly [bigint, bigint, bigint, bigint] => {
  let a = n, b = d, u = 1n, v = 0n;
  while (b !== 0n) {
    const q = a / b;
    [a, b] = [b, a - q * b]; [u, v] = [v, u - q * v];
  }
  if (n <= 0n || d <= 0n || n >= 1n << 128n || d >= 1n << 128n || a !== 1n) throw new Error('Invalid Pool price fraction.');
  u = d === 1n ? 1n : (u % d + d) % d;
  return [n, d, u, (n * u - 1n) / d];
};
export const currentPoolIntent = (budget0: string, budget1: string, price: string, classId: number, tolerance: string) => {
  if (!Number.isInteger(classId) || classId < 0 || classId >= 7) throw new Error('Select one of the seven Pool spreads.');
  const p = parseCurrentTrialPriceLimit(price);
  const t = /^0(?:\.0+)?$/.test(tolerance) ? { numerator: 0n, denominator: 1n } : parseCurrentTrialPriceLimit(tolerance);
  if (t.numerator > t.denominator * 100n) throw new Error('Funding tolerance must be between 0% and 100%.');
  // Percentage is an exact fraction; keep the denominator within the contract's uint128 domain.
  let tn = t.numerator, td = t.denominator * 100n, x = tn, y = td;
  while (y !== 0n) [x, y] = [y, x % y];
  tn /= x; td /= x;
  if (td >= 1n << 128n) throw new Error('Funding tolerance is outside the supported range.');
  return { classId: BigInt(classId), budgets: [parseCurrentTrialAtoms(budget0, true), parseCurrentTrialAtoms(budget1, true)] as const,
    terms: [...currentPoolFractionWitness(p.numerator, p.denominator), ...currentPoolFractionWitness(...spreadFractions[classId] as [bigint, bigint]), tn, td] as
      [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] };
};
const amountRows = (a: Amounts, tokenLabels = CURRENT_DEX_POOL_LABELS,
  format: (amount: bigint, index: 0 | 1) => string = formatCurrentDexTokenAmount) => [
  { label: 'Action', value: a.operation === 'initialize' ? 'Initialize this Pool' : 'Add to this Pool' },
  { label: `${tokenLabels[0]} debit`, value: format(a.used0, 0) }, { label: `${tokenLabels[1]} debit`, value: format(a.used1, 1) },
  { label: `${tokenLabels[0]} left in wallet`, value: format(a.unused0, 0) }, { label: `${tokenLabels[1]} left in wallet`, value: format(a.unused1, 1) },
  { label: 'New private shares', value: a.mintedShares.toString() }, { label: 'Position shares after funding', value: a.ownedShares.toString() },
  { label: 'Funding tolerance', value: `${a.toleranceN}/${a.toleranceD}` }
];

export default function CurrentPoolWorkspace({ sharedWalletSession, priceDisplayInverted = false, candidateKey = 'cheap-current', selectedPair }: {
  sharedWalletSession?: SharedWalletSession; priceDisplayInverted?: boolean; candidateKey?: CurrentCheapDexCandidateKey; selectedPair?: readonly [string, string]
}) {
  const preparedScope = candidateKey === 'cheap-prepared' || candidateKey === 'cheap-exit' || candidateKey === 'cheap-history' ? resolvePreparedDexScope(candidateKey) : null;
  const candidate = preparedScope?.candidate ?? resolveCurrentCheapDexCandidate(candidateKey), chain = BigInt(candidate.chainId);
  const preparedCandidate = preparedScope !== null;
  const display = preparedCandidate ? readCurrentDexDisplay(candidate) : null;
  const selectedTokens = display && selectedPair?.map(label => display.tokens.find(token => token.label === label));
  const pair = preparedCandidate ? (() => {
    if (!selectedTokens || selectedTokens.length !== 2 || !selectedTokens[0] || !selectedTokens[1]) throw new Error('Select the prepared Pool pair.');
    return currentDexDisplayPair(candidate, selectedTokens[0].address, selectedTokens[1].address);
  })() : null;
  const poolTokens = pair ? pair.tokens.map(token => token.address) as [string, string] :
    [...candidate.tokens].map(([address]) => address).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1) as [string, string];
  const tokenLabels = pair ? pair.tokens.map(token => token.label) : CURRENT_DEX_POOL_LABELS;
  const format = (amount: bigint, index: 0 | 1 = 0) => preparedCandidate ?
    formatDexCandidateTokenAmount(candidate, poolTokens[index], amount) : formatCurrentDexTokenAmount(amount);
  const parse = (value: string, index: 0 | 1) => preparedCandidate ?
    parseDexCandidateTokenAmount(candidate, poolTokens[index], value, tokenLabels[index], true) : parseCurrentDexTokenAmount(value, tokenLabels[index], true);
  const rows = (a: Amounts) => amountRows(a, tokenLabels, format);
  const nativeTrial = candidate.graph === STAGED_NATIVE_DEX_CANDIDATE.graph;
  const [budget0, setBudget0] = useState(nativeTrial ? '100' : ''); const [budget1, setBudget1] = useState(nativeTrial ? '100' : '');
  const [price, setPrice] = useState(nativeTrial ? (priceDisplayInverted ? '0.5' : '2') : '');
  const [classId, setClassId] = useState(nativeTrial ? 0 : 1); const [tolerance, setTolerance] = useState(nativeTrial ? '0.5' : '1');
  const [busy, setBusy] = useState(false); const [blocked, setBlocked] = useState(false); const [message, setStoredMessage] = useState('');
  const [sender, setSender] = useState<{ value: Sender; scope: object } | null>(null);
  const [preview, setPreview] = useState<{ value: Preview; scope: object } | null>(null);
  const [funding, setFunding] = useState<{ value: PreparedFunding; scope: object } | null>(null);
  const [approvals, setApprovals] = useState<readonly [boolean, boolean]>([false, false]);
  const [clears, setClears] = useState<readonly [boolean, boolean]>([false, false]);
  const [pending, setPending] = useState<{ phase: 'preview' | 'fund' | 'approval-0' | 'approval-1' | 'clear-0' | 'clear-1'; recover: () => Promise<unknown>; scope: object } | null>(null);
  const [transactionHash, setTransactionHash] = useState(''); const [nftId, setStoredNftId] = useState<bigint | null>(null);
  const [unfundedFailed, setUnfundedFailed] = useState(false);
  const [attemptComplete, setAttemptComplete] = useState(false);
  const [originalPreview, setOriginalPreview] = useState<{ value: CurrentPoolPreparedPreview; scope: object } | null>(null);
  const [unfundedAbandonEligible, setUnfundedAbandonEligible] = useState(false);
  const getPool = sharedWalletSession?.actions?.getCurrentDexPoolFundingCapability;
  const getSender = sharedWalletSession?.actions?.getCurrentDexSubmissionCapability;
  const privacyReady = sharedWalletSession ? resolveBrowserWalletPrivacyState({ browserWalletAddress: sharedWalletSession.walletAddress,
    sessionOnboardInfo: sharedWalletSession.sessionOnboardInfo ?? {}, walletAesHealthByAddress: sharedWalletSession.walletAesHealthByAddress }).ownerAesReady : false;
  const context = { terms: [budget0, budget1, price, classId, tolerance, priceDisplayInverted].join(':'), owner: sharedWalletSession?.walletAddress.toLowerCase(),
    candidateKey, graph: candidate.graph, core: candidate.core, marketId: pair?.marketId ?? candidate.marketId, pair: poolTokens.join(':'),
    chainId: sharedWalletSession?.chainId, provider: sharedWalletSession?.browserProvider, getPool, getSender,
    walletId: sharedWalletSession?.browserWalletId, source: sharedWalletSession?.activeSignerSource,
    privacyReady, onboard: sharedWalletSession?.sessionOnboardInfo, health: sharedWalletSession?.walletAesHealthByAddress };
  const scope = useRef(context);
  const messageScope = useRef<object | null>(null);
  const nftScope = useRef<object | null>(null);
  const inFlight = useRef(false);
  if ((Object.keys(context) as (keyof typeof context)[]).some(key => context[key] !== scope.current[key])) scope.current = context;
  const { confirmation, requestConfirmation, resolveConfirmation } = useTradeActionConfirmationState(scope.current);
  const validPreview = preview?.scope === scope.current;
  const validFunding = funding?.scope === scope.current;
  const previewWalletCurrent = preview && ['candidateKey', 'graph', 'core', 'marketId', 'pair', 'owner', 'chainId', 'provider', 'getPool', 'getSender', 'walletId', 'source', 'privacyReady', 'onboard', 'health'].every(
    key => (preview.scope as Record<string, unknown>)[key] === (context as Record<string, unknown>)[key]);
  const connected = Boolean(context.owner && context.chainId === Number(chain) && context.provider && getPool && getSender);
  const savedActionPending = hasCurrentDexPendingAction();
  const displayQuote = pair ? (priceDisplayInverted ? pair.tokenIn : pair.tokenOut) : null;
  const priceUnits = pair ? `${displayQuote!.label} per ${(priceDisplayInverted ? pair.tokenOut : pair.tokenIn).label}` :
    `${tokenLabels[priceDisplayInverted ? 1 : 0]} per ${tokenLabels[priceDisplayInverted ? 0 : 1]}`;
  const assertScope = (captured: object) => { if (scope.current !== captured) throw new Error('Pool terms or wallet session changed. Request a new preview.'); };
  const setMessage = (text: string) => { messageScope.current = scope.current; setStoredMessage(text); };
  const setNftId = (value: bigint | null) => { nftScope.current = scope.current; setStoredNftId(value); };
  const fail = (cause: unknown, captured: object) => setMessage(captured !== scope.current
    ? 'Pool terms or wallet session changed. Request a new preview.'
    : cause instanceof Error ? cause.message : 'Pool action failed. Check its status before another request.');
  const confirm = (title: string, rows: { label: string; value: string }[]) => requestConfirmation({ title, primaryLabel: 'Continue',
    fundingMoves: [], summaryRows: rows, stats: [{ label: 'Ownership', value: 'Position NFT' }],
    message: 'Only your wallet can read these amounts. A transaction can cost network gas.' });
  const assertPoolAuthority = (action: 'create' | 'approve-create' | 'clear-create', intent: { classId: bigint; budgets: readonly [bigint, bigint];
    terms: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] }) =>
    assertCurrentAppPoolAuthority(candidate.graph, { owner: context.owner!, action, budgets: intent.budgets, classId: intent.classId,
      tolerance: [intent.terms[8], intent.terms[9]] });
  const currentSender = async (captured: typeof context) => {
    const next = await getSender!(chain, preparedCandidate ? { candidate: preparedScope!.key } : nativeTrial ? { nativePoolProfile: CURRENT_NATIVE_POOL_PROFILE } : undefined);
    const checked = await next.checkCurrentCheapCandidate();
    assertScope(captured);
    if (checked.chainId !== chain || checked.owner.toLowerCase() !== captured.owner || checked.graph !== candidate.graph ||
        checked.core.toLowerCase() !== candidate.core || checked.packageSha256 !== candidate.packageSha256 || checked.readyToSign !== false) throw new Error('Current Pool candidate or owner changed.');
    setSender({ value: next, scope: captured }); return next;
  };
  const prepare = async () => {
    if (!connected || inFlight.current || busy || blocked || savedActionPending || funding || nftId !== null || (nativeTrial && preview)) return;
    const captured = scope.current;
    inFlight.current = true; setBusy(true); setPreview(null); setFunding(null); setApprovals([false, false]); setClears([false, false]); setNftId(null);
    try {
      if (preparedCandidate) assertCurrentPoolFundingNativeAdmission(candidate);
      const intent = currentPoolIntent(parse(budget0, 0).toString(), parse(budget1, 1).toString(), price, classId, tolerance);
      if (preparedCandidate) assertPoolAuthority('create', intent);
      // Pool initialization stores canonical token1/token0. Match the displayed ratio.
      if (pair ? displayQuote!.address === poolTokens[0] : !priceDisplayInverted) {
        const w = currentPoolFractionWitness(intent.terms[1], intent.terms[0]);
        intent.terms = [...w, ...intent.terms.slice(4)] as typeof intent.terms;
      }
      const next = await currentSender(captured);
      const head = await context.provider!.request({ method: 'eth_getBlockByNumber', params: ['latest', false] }) as { number: string; hash: string } | null;
      assertScope(captured);
      if (!head || !/^0x[0-9a-fA-F]{64}$/.test(head.hash)) throw new Error('Current Pool block is unavailable.');
      const capability = preparedCandidate ? await getPool!(chain, { candidate: preparedScope!.key }) : await getPool!(chain);
      assertScope(captured);
      const retained = originalPreview?.scope === captured ? originalPreview.value : null;
      if (retained && !await confirm('Review original unsigned Pool preview', [
        { label: 'Pool spread', value: `${CURRENT_POOL_SPREADS[classId]}%` },
        { label: `${tokenLabels[0]} maximum`, value: format(retained.intent.budgets[0], 0) },
        { label: `${tokenLabels[1]} maximum`, value: format(retained.intent.budgets[1], 1) }
      ])) { assertScope(captured); setMessage('Original Pool preview cancelled.'); return; }
      const prepared = retained ?? await capability.preparePoolCreation({ graph: { expectedGraph: candidate.graph, expectedPackageSha256: candidate.packageSha256,
        blockNumber: BigInt(head.number), blockHash: head.hash }, pair: preparedCandidate ? poolTokens : undefined, intent, confirmPrivateInputs: async () => {
          const accepted = await confirm('Confirm private Pool inputs', [
            { label: 'Pool spread', value: `${CURRENT_POOL_SPREADS[classId]}%` },
            { label: `${tokenLabels[0]} maximum`, value: format(intent.budgets[0], 0) }, { label: `${tokenLabels[1]} maximum`, value: format(intent.budgets[1], 1) },
            { label: 'Starting price if empty', value: `${price} ${priceUnits}` },
            { label: 'Funding tolerance', value: `${tolerance}%` }
          ]);
          assertScope(captured); return accepted;
        } });
      assertScope(captured);
      if (!prepared) { setMessage('Pool preview cancelled.'); return; }
      setOriginalPreview({ value: prepared, scope: captured });
      setBlocked(true);
      const sent = await next.submitPoolPreview(prepared);
      setPending({ phase: 'preview', recover: sent.recover, scope: captured }); setTransactionHash(sent.transactionHash);
      setMessage('Pool preview submitted. Check its private result before funding.');
    } catch (cause) { fail(cause, captured); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const fund = async () => {
    if (!connected || inFlight.current || busy || blocked || savedActionPending || unfundedFailed || (!validFunding && (!validPreview || !preview))) return;
    const captured = scope.current;
    inFlight.current = true; setBusy(true);
    try {
      if (preparedCandidate) {
        assertCurrentPoolFundingNativeAdmission(candidate);
        const intent = funding?.scope === captured ? funding.value.intent : originalPreview?.scope === captured ? originalPreview.value.intent : null;
        if (!intent) throw new Error('Prepared Pool terms are unavailable. Check the original preview before funding.');
        assertPoolAuthority('create', intent);
      }
      const next = await currentSender(captured);
      const prepared = funding && validFunding ? funding.value : await preview!.value.prepareFunding(async values => {
        const accepted = await confirm(values.operation === 'initialize' ? 'Initialize this Pool' : 'Add to this Pool', rows(values));
        assertScope(captured); return accepted;
      });
      assertScope(captured);
      if (!prepared) { setMessage('Pool funding cancelled.'); return; }
      if ((nativeTrial || preparedCandidate) && (!validFunding || !approvals.every(Boolean))) {
        setFunding({ value: prepared, scope: captured });
        if (preparedCandidate) setUnfundedAbandonEligible(true);
        setMessage('Review and approve each exact token amount, then fund this Pool.');
        return;
      }
      setBlocked(true);
      const sent = await next.submitPoolFunding(prepared);
      setPending({ phase: 'fund', recover: sent.recover, scope: captured }); setTransactionHash(sent.transactionHash);
      setMessage('Pool funding submitted. Check the private debits and minted NFT.');
    } catch (cause) { fail(cause, captured); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const approve = async (index: 0 | 1, cleanup = false) => {
    if (!connected || inFlight.current || busy || savedActionPending || !funding || !validFunding || nftId !== null || (!cleanup && (blocked || unfundedFailed))) return;
    const captured = scope.current; inFlight.current = true; setBusy(true);
    try {
      if (preparedCandidate) {
        assertCurrentPoolFundingNativeAdmission(candidate);
        const intent = funding.value.intent;
        assertPoolAuthority(cleanup ? 'clear-create' : 'approve-create', intent);
      }
      const next = await currentSender(captured);
      const review = async (values: { amount: bigint; previousAllowance: bigint; spender: string }) => {
        const accepted = await confirm(cleanup ? 'Clear unused Pool approval' : 'Approve exact Pool funding', [
          { label: 'Token', value: tokenLabels[index] }, { label: 'Approval', value: format(values.amount, index) },
          { label: 'Previous allowance', value: format(values.previousAllowance, index) },
          { label: 'Spender', value: values.spender }
        ]);
        assertScope(captured); return accepted;
      };
      const sent = await (async () => {
        if (preparedCandidate) {
          const prepared = await next.prepareSharedPoolApproval({ funding: funding.value, canonicalIndex: index, cleanup, confirm: review });
          assertScope(captured);
          if (!prepared) return null;
          setBlocked(true); return next.submitSharedPoolApproval(prepared);
        }
        const prepared = cleanup ? await next.preparePoolUnfundedCleanup(index, review) : await next.preparePoolApproval(funding.value, index, review);
        assertScope(captured);
        if (!prepared) return null;
        setBlocked(true); return next.submitCurrentTokenFunding(prepared);
      })();
      assertScope(captured);
      if (!sent) { setMessage('Pool approval cancelled.'); return; }
      setPending({ phase: cleanup ? index === 0 ? 'clear-0' : 'clear-1' : index === 0 ? 'approval-0' : 'approval-1', recover: sent.recover, scope: captured });
      setTransactionHash(sent.transactionHash); setMessage(cleanup ? 'Zero approval submitted. Check its result.' : 'Exact approval submitted. Check its private result.');
    } catch (cause) { fail(cause, captured); } finally { inFlight.current = false; setBusy(false); }
  };
  const clearRecoveredApproval = async (index: 0 | 1) => {
    if (candidateKey !== 'cheap-history' || !connected || !pair || inFlight.current || busy || savedActionPending || validFunding || validPreview || nftId !== null) return;
    const captured = scope.current; inFlight.current = true; setBusy(true);
    try {
      assertCurrentAppPoolAllowanceCleanupAuthority(candidate.graph, context.owner!);
      const next = await currentSender(captured);
      const prepared = await next.prepareSharedPoolAllowanceCleanup({ marketId: pair.marketId, canonicalIndex: index,
        confirm: async values => {
          const accepted = await confirm('Clear unused Pool approval', [
            { label: 'Token', value: tokenLabels[index] }, { label: 'Approval', value: format(values.amount, index) },
            { label: 'Previous allowance', value: format(values.previousAllowance, index) }, { label: 'Spender', value: values.spender }
          ]);
          assertScope(captured); return accepted;
        } });
      assertScope(captured);
      if (!prepared) { setMessage('No cleanup transaction was prepared.'); return; }
      setBlocked(true);
      const sent = await next.submitSharedPoolApproval(prepared); assertScope(captured);
      setPending({ phase: index === 0 ? 'clear-0' : 'clear-1', recover: sent.recover, scope: captured });
      setTransactionHash(sent.transactionHash); setMessage('Zero approval submitted. Check its private result.');
    } catch (cause) { fail(cause, captured); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const abandon = async () => {
    if ((!nativeTrial && !preparedCandidate) || !connected || inFlight.current || busy || savedActionPending || !validFunding || !funding ||
        nftId !== null || unfundedFailed || attemptComplete || !unfundedAbandonEligible) return;
    const captured = scope.current; inFlight.current = true; setBusy(true);
    try {
      const review = async (review: { allowances: readonly [bigint, bigint] }) => {
        const accepted = await confirm('Stop this unfunded Pool deposit', [
          { label: `${tokenLabels[0]} unused approval`, value: format(review.allowances[0], 0) },
          { label: `${tokenLabels[1]} unused approval`, value: format(review.allowances[1], 1) },
          { label: 'Next action', value: 'Clear only the remaining approvals. This deposit cannot be funded or restarted.' }
        ]);
        assertScope(captured); return accepted;
      };
      const result = preparedCandidate ? await funding.value.abandonUnfunded(review) : await (await currentSender(captured)).abandonCurrentNativePoolFunding(review);
      assertScope(captured);
      if (!result) { setMessage('Deposit stop cancelled. No approval was changed.'); return; }
      setUnfundedFailed(true); setUnfundedAbandonEligible(false); setBlocked(false); setPreview(null);
      setApprovals(result.cleanupRequired); setClears([!result.cleanupRequired[0], !result.cleanupRequired[1]]);
      setAttemptComplete(result.status === 'unfunded-allowances-cleared');
      setMessage(result.status === 'unfunded-allowances-cleared' ?
        'Unfunded deposit stopped. Both approvals are zero; no cleanup transaction is required.' :
        'Unfunded deposit stopped. Clear its remaining approvals below. Funding cannot restart.');
    } catch (cause) { fail(cause, captured); } finally { inFlight.current = false; setBusy(false); }
  };
  const acceptNativeTokenResult = async (observed: unknown, next: Sender, captured: object) => {
    if (!observed || typeof observed !== 'object' || !('fundingOutcome' in observed) ||
        !['verified', 'reverted'].includes(String(observed.fundingOutcome)) || !('token' in observed) || typeof observed.token !== 'string') {
      throw new Error('Native Pool approval result has no authenticated outcome.');
    }
    const resumed = await next.readCurrentNativePoolResume(); assertScope(captured);
    if (!resumed || !resumed.funding || resumed.positionId !== undefined) throw new Error('Original unfunded Pool recovery is unavailable.');
    const observedToken = observed.token.toLowerCase();
    const label = preparedCandidate ? display!.tokens.find(token => token.address === observedToken)?.label : currentDexTokenLabel(observedToken);
    if (!label) throw new Error('Pool approval token is outside this candidate.');
    setSender({ value: next, scope: captured }); setPending(null); setBlocked(false); setApprovals(resumed.approvals);
    setFunding({ value: resumed.funding, scope: captured }); setUnfundedFailed(resumed.unfundedFailed);
    setUnfundedAbandonEligible(resumed.unfundedAbandonEligible); setAttemptComplete(resumed.completed);
    setClears([!resumed.approvals[0], !resumed.approvals[1]]);
    if (resumed.unfundedFailed) setPreview(null);
    setMessage(observed.fundingOutcome === 'reverted' ?
      `${label} approval transaction reverted. Its allowance was not changed. Check the remaining approvals and recovery capacity; do not assume cleanup is complete.` :
      resumed.completed ? 'Both unused approvals are zero. The unfunded Pool attempt is complete.' :
      resumed.unfundedFailed ? `${label} unused approval cleared. Check any remaining approval before completion.` :
      `${label} exact approval verified. Fund only after both actual approvals pass.`);
  };
  const acceptPreparedTokenResult = (observed: unknown, phase: string, captured: object) => {
    assertScope(captured);
    if (!observed || typeof observed !== 'object' ||
        !('fundingOutcome' in observed) || !['verified', 'reverted'].includes(String(observed.fundingOutcome)) ||
        !('privateAccountingVerified' in observed) || observed.privateAccountingVerified !== true ||
        !('token' in observed) || !('funds' in observed)) throw new Error('Prepared Pool approval has no authenticated private accounting.');
    const result = observed as Awaited<ReturnType<Awaited<ReturnType<Sender['submitSharedPoolApproval']>>['recover']>>;
    const index = phase.endsWith('-0') ? 0 : 1, cleanup = phase.startsWith('clear-'), funds = result.funds;
    if (result.token.toLowerCase() !== poolTokens[index] || funds.owner.toLowerCase() !== context.owner ||
        funds.graph !== candidate.graph || funds.packageSha256 !== candidate.packageSha256 || funds.core.toLowerCase() !== candidate.core ||
        funds.privateFundsVerified !== true || funds.readyToSign !== false || funds.tokens.length !== 4) throw new Error('Prepared Pool approval owner, token or candidate changed.');
    const tokens = poolTokens.map(token => funds.tokens.find(value => value.address.toLowerCase() === token));
    if (tokens.some(token => !token || token.decimals !== 6)) throw new Error('Prepared Pool approval selected-token funds are unavailable.');
    if (result.recoveredCleanup === true) {
      if (!cleanup || result.cleanup !== true || validFunding || validPreview ||
          result.fundingOutcome === 'verified' && tokens[index]!.allowance !== 0n) throw new Error('Recovered cleanup differs from the reviewed zero approval.');
      setPending(null); setBlocked(false); setClears(tokens.map(token => token!.allowance === 0n) as [boolean, boolean]);
      setMessage(result.fundingOutcome === 'reverted' ? 'Zero approval reverted. Its rollback is verified.' : `Unused ${tokenLabels[index]} approval cleared.`);
      return;
    }
    if (!funding || funding.scope !== captured) throw new Error('Prepared Pool approval has no authenticated funding context.');
    const used = [funding.value.amounts.used0, funding.value.amounts.used1];
    if (result.fundingOutcome === 'verified' && tokens[index]!.allowance !== (cleanup ? 0n : used[index])) throw new Error('Prepared Pool approval differs from the exact reviewed allowance.');
    if (tokens.some((token, i) => token!.allowance !== 0n && token!.allowance !== used[i])) throw new Error('Prepared Pool allowance needs manual reconciliation.');
    const verified = tokens.map((token, i) => token!.allowance === used[i]) as [boolean, boolean];
    const cleared = tokens.map(token => token!.allowance === 0n) as [boolean, boolean];
    setPending(null); setBlocked(false); setApprovals(verified); setClears(cleared);
    setAttemptComplete(unfundedFailed && cleared.every(Boolean));
    setUnfundedAbandonEligible(!unfundedFailed);
    setMessage(result.fundingOutcome === 'reverted' ? 'Pool approval reverted. Its exact rollback is verified; check the remaining approvals.' :
      unfundedFailed && cleared.every(Boolean) ? 'Both unused approvals are zero. The unfunded Pool attempt is complete.' :
      cleanup ? `Unused ${tokenLabels[index]} approval cleared.` : `Exact ${tokenLabels[index]} approval verified. Fund only after both approvals pass.`);
  };
  const refresh = async () => {
    if (!getSender || context.chainId !== Number(chain) || inFlight.current || busy) return;
    inFlight.current = true; setBusy(true); const captured = scope.current;
    const currentPending = pending?.scope === captured ? pending : null;
    let firstRecoveryError: unknown;
    try {
      if (currentPending) {
        try {
          const observed = await currentPending.recover();
          assertScope(currentPending.scope);
          if (!observed) throw new Error('Private Pool result is not available yet.');
          if (nativeTrial && (currentPending.phase.startsWith('approval-') || currentPending.phase.startsWith('clear-'))) {
            const next = await currentSender(captured);
            await acceptNativeTokenResult(observed, next, captured); return;
          }
          if (preparedCandidate && (currentPending.phase.startsWith('approval-') || currentPending.phase.startsWith('clear-'))) {
            acceptPreparedTokenResult(observed, currentPending.phase, captured); return;
          }
          setPending(null); setBlocked(false);
          if (currentPending.phase === 'preview') {
            setPreview({ value: observed as Preview, scope: currentPending.scope });
            setMessage('Private Pool preview verified. Review the exact debit before funding.');
          } else if (currentPending.phase.startsWith('approval-')) {
            const index = currentPending.phase === 'approval-0' ? 0 : 1;
            setApprovals(previous => index === 0 ? [true, previous[1]] : [previous[0], true]);
            setMessage(`Exact ${tokenLabels[index]} approval verified. Fund only after both approvals pass.`);
          } else if (currentPending.phase.startsWith('clear-')) {
            const index = currentPending.phase === 'clear-0' ? 0 : 1;
            setClears(previous => index === 0 ? [true, previous[1]] : [previous[0], true]);
            setApprovals(previous => index === 0 ? [false, previous[1]] : [previous[0], false]);
            setMessage(`Unused ${tokenLabels[index]} approval cleared.`);
          } else {
            const result = observed as { positionId: bigint };
            setNftId(result.positionId); setPreview(null); setFunding(null);
            setMessage(`Position NFT ${result.positionId} minted. Both private token debits are verified.`);
          }
          return;
        } catch (cause) {
          firstRecoveryError = cause;
          // Only the canonical journal can release an uncertain attempt. Its public result grants no private authority.
        }
      }
      const next = sender?.scope === captured ? sender.value : await getSender(chain, preparedCandidate ? { candidate: preparedScope!.key } : nativeTrial ? { nativePoolProfile: CURRENT_NATIVE_POOL_PROFILE } : undefined);
      assertScope(captured);
      const savedPhase = readCurrentDexPendingAttempt(currentDexPendingStorage())?.phase;
      const tokenPending = currentPending?.phase.startsWith('approval-') || currentPending?.phase.startsWith('clear-') || savedPhase === 'token-approve';
      if (preparedCandidate && !tokenPending) {
        const result = await next.recoverCurrentPreparedPoolFundingResult(); assertScope(captured);
        if (result && typeof result === 'object') {
          setPending(null); setBlocked(false);
          if ('prepareFunding' in result) { setPreview({ value: result as Preview, scope: captured }); setMessage('Original private preview recovered. Review its exact funding amounts.'); }
          else if ('positionId' in result && typeof result.positionId === 'bigint') {
            setNftId(result.positionId); setPreview(null); setFunding(null);
            setMessage(`Position NFT ${result.positionId} and private funding recovered. Open Your liquidity for refresh and exit.`);
          } else throw new Error('Prepared private Pool recovery returned an unexpected result.');
          return;
        }
      }
      if (nativeTrial && tokenPending) {
        const result = await next.recoverCurrentNativePoolTokenResult(); assertScope(captured);
        if (result) { await acceptNativeTokenResult(result, next, captured); return; }
      }
      if (nativeTrial && !tokenPending) {
        const result = await next.recoverCurrentNativePoolFundingResult();
        assertScope(captured);
        if (result && typeof result === 'object') {
          setPending(null); setBlocked(false);
          if ('prepareFunding' in result) { setPreview({ value: result as Preview, scope: captured }); setMessage('Original private preview recovered. Review its exact funding amounts.'); }
          else if ('positionId' in result && typeof result.positionId === 'bigint') { setNftId(result.positionId); setPreview(null); setFunding(null); setMessage(`Position NFT ${result.positionId} and private funding recovered. Open Your liquidity for refresh and exit.`); }
          else throw new Error('Original private Pool recovery returned an unexpected result.');
          return;
        }
      }
      if (nativeTrial && !readCurrentDexPendingAttempt(currentDexPendingStorage())) {
        const resumed = await next.readCurrentNativePoolResume(); assertScope(captured);
        if (resumed) {
          setSender({ value: next, scope: captured }); setPending(null); setBlocked(false); setUnfundedFailed(resumed.unfundedFailed); setAttemptComplete(resumed.completed);
          setUnfundedAbandonEligible(resumed.unfundedAbandonEligible);
          setApprovals(resumed.approvals);
          if (resumed.unfundedFailed) setClears([!resumed.approvals[0], !resumed.approvals[1]]);
          if (resumed.positionId !== undefined) {
            setNftId(resumed.positionId); setFunding(null); setPreview(null);
            if (resumed.producerHash) setTransactionHash(resumed.producerHash);
            setMessage(resumed.completed ? 'Pool attempt complete. Its exact exit proof is verified.' :
              `Original funded claim NFT ${resumed.positionId} recovered. Open Your liquidity for refresh and exit.`);
          } else {
            setFunding(resumed.funding ? { value: resumed.funding, scope: captured } : null);
            setPreview(resumed.previewResult ? { value: resumed.previewResult, scope: captured } : null);
            if (resumed.previewHash) setTransactionHash(resumed.previewHash);
            setOriginalPreview(resumed.originalPreviewRetryEligible ? { value: resumed.preview, scope: captured } : null);
            setMessage(resumed.unfundedFailed ? 'Original unfunded attempt recovered. Clear only its unused approvals; do not fund or restart it.' :
              'Original Pool preparation recovered. Exact current approvals are checked; its signing budget is retained.');
          }
          return;
        }
      }
      const observed = tokenPending ? preparedCandidate ? await next.recoverPendingSharedPoolApproval() : await next.recoverPendingCurrentTokenFunding() : await next.recoverPendingPoolAttempt();
      assertScope(captured);
      setSender({ value: next, scope: captured });
      if (!observed) { setBlocked(false); setMessage('No pending Pool attempt was found.'); return; }
      if (observed.status === 'observed-reverted' || observed.status === 'observed-mined') {
        setPending(null); setBlocked(false);
        if (!tokenPending) setPreview(null);
        setMessage(observed.status === 'observed-reverted' ? 'Pool transaction reverted. No funds or NFT result are confirmed.' :
          'Pool transaction mined. This session has no authenticated private result; no funding or NFT amount is confirmed.');
      } else { setBlocked(true); setMessage('Pool transaction is pending or needs manual reconciliation. Do not resend it.'); }
    } catch (cause) {
      setBlocked(true);
      fail(firstRecoveryError && cause instanceof Error && cause.message === 'Known Pool verification failure. Manual reconciliation is required.'
        ? firstRecoveryError : cause, captured);
    }
    finally { inFlight.current = false; setBusy(false); }
  };
  const fieldsDisabled = busy || blocked || validFunding;
  return <>
    <section className="dex-v2-pool-composer dex-v2-current-pool" aria-label="Current private Pool creation">
      <header className="dex-v2-composer-heading"><h2>Add liquidity</h2><p>Shared Full Range Pool</p></header>
      {nativeTrial ? <p className="dex-v2-activation-note">This Testnet join uses 100 of each token, 0.1% spread and 0.5% funding tolerance.</p> : null}
      <section className="dex-v2-pool-section dex-v2-pool-amounts-section">
        <header><h3>Deposit amounts</h3><span>Maximum spend</span></header>
        <div className="dex-v2-current-fields">
          <label><span>{tokenLabels[0]}</span><input aria-label={`${tokenLabels[0]} Pool budget`} inputMode="decimal" placeholder="0" value={budget0} disabled={fieldsDisabled || nativeTrial} onChange={event => setBudget0(event.target.value)} /></label>
          <label><span>{tokenLabels[1]}</span><input aria-label={`${tokenLabels[1]} Pool budget`} inputMode="decimal" placeholder="0" value={budget1} disabled={fieldsDisabled || nativeTrial} onChange={event => setBudget1(event.target.value)} /></label>
        </div>
        <p className="dex-v2-activation-note">Unused amounts stay in your wallet.</p>
      </section>
      <section className="dex-v2-pool-section dex-v2-pool-fee-section">
        <header><h3>Pool spread</h3><span>Fixed for this Pool</span></header>
        <label className="dex-v2-pool-custom-fee"><span>Spread class</span><select aria-label="Pool spread" value={classId} disabled={fieldsDisabled || nativeTrial}
          onChange={event => setClassId(Number(event.target.value))}>{CURRENT_POOL_SPREADS.map((spread, i) => <option key={spread} value={i}>{spread}%</option>)}</select></label>
        <p className="dex-v2-activation-note">The protocol fee is separate. To change spread, withdraw and deposit again.</p>
      </section>
      <details className="dex-v2-setup"><summary>Pool settings</summary><div>
          <label><span>Starting price if empty · required for preview</span><input aria-label="Pool starting price" inputMode="decimal"
            value={price} disabled={fieldsDisabled || nativeTrial} onChange={event => setPrice(event.target.value)} /><small>{priceUnits}</small></label>
          <p>The current contracts need this value before the preview. It is used only to start an empty Pool. An existing Pool uses its reserve ratio.</p>
          <label><span>Funding tolerance (%)</span><input aria-label="Pool funding tolerance" inputMode="decimal" value={tolerance} disabled={fieldsDisabled || nativeTrial} onChange={event => setTolerance(event.target.value)} /></label>
          <p>Funding needs private balances and token allowances for both tokens.</p>
      </div></details>
      {preview && previewWalletCurrent ? <aside className="dex-v2-strategy-preview" aria-label="Authenticated Pool preview">
        <header><span>PRIVATE PREVIEW</span><h2>{preview.value.amounts.operation === 'initialize' ? 'Initialize this Pool' : 'Add to this Pool'}</h2></header>
        <dl>{rows(preview.value.amounts).map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
        {!validPreview ? <p role="alert">Pool terms or wallet session changed. Request a new preview.</p> : null}
      </aside> : null}
      <div className="dex-v2-limit-privacy"><LockKeyhole size={21} aria-hidden="true" /><span><strong>Private by design</strong><small>Your shares belong to a position NFT, not an LP token.</small></span><ShieldCheck size={20} aria-hidden="true" /></div>
      <button className="dex-v2-review-button" type="button" disabled={!connected || busy || blocked || savedActionPending || Boolean(funding) || nftId !== null || (nativeTrial && Boolean(preview))} onClick={() => { void prepare(); }}>Review deposit<ArrowRight size={21} aria-hidden="true" /></button>
      {funding && validFunding ? <div className="dex-v2-current-fields">{([0, 1] as const).map(index => <button key={index} type="button"
        disabled={!connected || busy || blocked || savedActionPending || unfundedFailed || attemptComplete || approvals[index]} onClick={() => { void approve(index); }}>
        {approvals[index] ? `${tokenLabels[index]} approval verified` : `Approve exact ${tokenLabels[index]}`}</button>)}</div> : null}
      {preview || funding ? <button className="dex-v2-review-button" type="button" disabled={!connected || busy || blocked || savedActionPending || unfundedFailed || (!validPreview && !validFunding) || (Boolean(funding && validFunding) && !approvals.every(Boolean))}
        onClick={() => { void fund(); }}>{(nativeTrial || preparedCandidate) && !validFunding ? 'Review funding and approvals' : 'Review and fund Pool'}<ArrowRight size={21} aria-hidden="true" /></button> : null}
      {(nativeTrial || preparedCandidate) && funding && validFunding && nftId === null && !unfundedFailed && !attemptComplete ? <>
        <button type="button" disabled={!connected || busy || savedActionPending || !unfundedAbandonEligible}
          onClick={() => { void abandon(); }}>Review stop and clear approvals</button>
        <p className="dex-v2-activation-note">Check Pool status to verify whether this unsigned deposit can stop. A pending or signed deposit needs reconciliation first.</p>
      </> : null}
      {(nativeTrial || preparedCandidate) && funding && validFunding && nftId === null && unfundedFailed && !attemptComplete ? <details className="dex-v2-setup"><summary>Unused approval recovery</summary>
        <p>Only a verified unfunded attempt can clear these approvals. This does not restart the attempt.</p>
        {([0, 1] as const).map(index => <button key={index} type="button" disabled={!connected || busy || savedActionPending || clears[index]} onClick={() => { void approve(index, true); }}>Clear {tokenLabels[index]} approval</button>)}
      </details> : null}
      {candidateKey === 'cheap-history' && !validFunding && !validPreview && nftId === null ? <details className="dex-v2-setup"><summary>Unused approval recovery</summary>
        <p>Clear an unused token approval to this DEX. This does not deposit or withdraw tokens.</p>
        {([0, 1] as const).map(index => <button key={index} type="button" disabled={!connected || busy || blocked || savedActionPending || clears[index]}
          onClick={() => { void clearRecoveredApproval(index); }}>Clear unused {tokenLabels[index]} approval</button>)}
      </details> : null}
      {savedActionPending ? <p role="alert">A saved action needs reconciliation. Open its status and recovery from Activity before a new deposit.</p> : null}
      {connected ? <button className="dex-v2-current-pool-status" type="button" disabled={!getSender || busy || context.chainId !== Number(chain)} onClick={() => { void refresh(); }}>Check Pool status</button> : null}
      <p className="dex-v2-activation-note" role="status">{(messageScope.current === scope.current && message) || (connected ? 'Request an authenticated private preview for this owner wallet.' : 'Connect the owner wallet on COTI Testnet to prepare this Pool.')}</p>
      {transactionHash ? <p className="dex-v2-activation-note" style={{ overflowWrap: 'anywhere' }}>Transaction {transactionHash}</p> : null}
      {nftId !== null && nftScope.current === scope.current ? <p className="dex-v2-activation-note">Verified position NFT ID: {nftId.toString()}. {attemptComplete ? 'The claim exit is complete.' : 'Use this ID and funding transaction in Your liquidity to refresh and exit the claim.'}</p> : null}
    </section>
    <TradeActionConfirmModal confirmation={confirmation} onCancel={() => resolveConfirmation(false)} onConfirm={() => resolveConfirmation(true)} />
  </>;
}
