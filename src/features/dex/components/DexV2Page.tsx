import './CurrentDexOwnerViews.css';
import { useEffect, useId, useRef, useState } from 'react';
import { formatEther, parseUnits } from '@coti-io/coti-ethers';
import {
  ArrowDownUp,
  ArrowRight,
  ChartNoAxesCombined,
  CircleDollarSign,
  ChevronDown,
  Clock3,
  Coins,
  Database,
  Info,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import DexMarketChart from './DexMarketChart';
import useCurrentDexDailyPrice from '../hooks/useCurrentDexDailyPrice';
import type { CurrentDexDailyPriceConfig } from '../../../lib/currentDexDailyPrice';
import type { Eip1193Provider } from '@coti-io/coti-ethers';
import CurrentPoolWorkspace, { parseCurrentTrialPriceLimit } from './CurrentPoolWorkspace';
export { parseCurrentTrialAtoms, parseCurrentTrialPriceLimit } from './CurrentPoolWorkspace';
import CurrentPoolPositionsWorkspace from './CurrentPoolPositionsWorkspace';
import CurrentDexActivity from './CurrentDexActivity';
import CurrentLimitWorkspace from './CurrentLimitWorkspace';
import CurrentTokenFundingControls, { checkCurrentFunding, currentFundingConfirmation } from './CurrentTokenFundingControls';
import CurrentSharedTestTokenControls from './CurrentSharedTestTokenControls';
import type { CurrentTokenFundingResult } from '../../../lib/currentDexTokenFunding';
import { CURRENT_APP_FURTHER_TRIAL } from '../../../lib/currentDexC1SwapPolicy';
import { CURRENT_SHARED_SWAP_APPROVAL_MAXIMUM } from '../../../lib/currentSharedDexTokenFunding';
import { currentDexPendingStorage, readCurrentDexPendingAttempt } from '../../../lib/currentDexPendingAttempt';
import { CURRENT_DEX_DISPLAY_PAIR, parseCurrentDexTokenAmount, readCurrentDexDisplay, currentDexDisplayPair,
  parseDexCandidateTokenAmount, formatDexCandidateTokenAmount } from '../../../lib/currentDexDisplay';
import { successorPairReferencePrice, type TradingPair } from '../../../app/components/TradingProductSwitch';
import {
  formatDexV2LotsAsTokenAmount,
  formatDexV2TickPrice,
  parseDexV2TokenAmountToLots,
  type DexV2SwapDirection
} from '../../../lib/dexV2Terms';
import {
  type SharedWalletSession,
  resolveBrowserWalletPrivacyState
} from '../../../lib/walletSession';
import { COTI_TESTNET_NETWORK } from '../../../lib/chainWhisperNetworks';
import { getProviderErrorMessage } from '../../../lib/appShared/core';
import { CURRENT_CHEAP_DEX_CANDIDATE, currentCheapDexQuoteProtocol, currentCheapDexStages, currentCheapDexOwnerActionEligible,
  resolveCurrentCheapDexCandidate, currentCheapDexCandidateKey, type CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import { assertCurrentSwapCandidate } from '../../../lib/currentDexNativeSwapPolicy';
import { CURRENT_EXIT_SWAP_GAS_CAPS, currentSwapFixedGasPrice, usesCurrentSwapAccounting } from '../../../lib/currentDexExitSwapPolicy';
import { resolvePreparedDexScope } from '../../../lib/currentDexPreparedScope';
import { CurrentDexPrivateReceiptError, type CurrentCheapDexIssuedQuote, type CurrentCheapDexPreparedQuote } from '../../../lib/currentDexSubmission';
import type { CurrentCheapDexProfile } from '../../../lib/currentDexOperation';
import type { TradeActionConfirmModel } from '../../../lib/tradeActionConfirm';
import { CurrentDexQuoteProtectionError, DEFAULT_CURRENT_DEX_SLIPPAGE_PERCENT, parseCurrentDexSlippagePercent } from '../../../lib/currentDexQuoteReview';
import { currentDexPriceImpact } from '../../../lib/currentDexPriceImpact';
import { currentDexEstimatedReceive, type CurrentDexMarketReference } from '../../../lib/currentDexMarketReference';
import { successorDexAdmissionAvailable } from '../../../lib/appChain';
import TradeActionConfirmModal from '../../trading/components/TradeActionConfirmModal';
import CurrentSwapProgress from './CurrentSwapProgress';
import { DexViewTabs, type DexView } from '../../trading/components/TradeDeskTabs';
import useTradeActionConfirmationState from '../../trading/hooks/useTradeActionConfirmationState';
import useSuccessorStrategyAction from '../hooks/useSuccessorStrategyAction';
import useDexV2TokenBalances from '../hooks/useDexV2TokenBalances';
import useCurrentTrialBalances from '../hooks/useCurrentTrialBalances';
import type { SuccessorDexRuntimeState } from '../hooks/useSuccessorDexDeployment';
import useVisualViewportKeyboardOpen from '../../../shared/hooks/useVisualViewportKeyboardOpen';
import {
  resolveCanonicalTradeActionSide,
  resolveDisplayedTradeActionSide,
  type TradeActionSide
} from '../../../lib/tradePerspective';
import { resolveCanonicalTradingPath } from '../../../shell/routing';
import { CurrentSwapJourneyTiming, currentSwapTimingVisible } from './currentSwapJourneyTiming';

type DexMode = Exclude<DexView, 'agent' | 'recurring'>;
type DexStrategyMode = 'pool' | 'limit' | 'recurring';
const trialChain = BigInt(CURRENT_CHEAP_DEX_CANDIDATE.chainId);
export const parseCurrentSwapAmount = parseCurrentDexTokenAmount;
export const parseCurrentSwapFillPercent = (value: string, maximum: bigint) => {
  if (!/^(0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(value.trim())) {
    throw new Error('Minimum fill: enter a percentage from 0 to 100, with at most two decimal places.');
  }
  const hundredths = parseUnits(value.trim(), 2);
  if (hundredths > 10000n) throw new Error('Minimum fill: enter a percentage from 0 to 100.');
  return (maximum * hundredths + 9999n) / 10000n;
};
export const parseCurrentSwapPriceLimit = (value: string, side: TradeActionSide) => {
  const rate = parseCurrentTrialPriceLimit(value.trim());
  return side === 'buy' ? { numerator: rate.denominator, denominator: rate.numerator } : rate;
};
type TrialSubmission = Awaited<ReturnType<NonNullable<NonNullable<SharedWalletSession['actions']>['getCurrentDexSubmissionCapability']>>>;
export const restoreCurrentTrialQuote = async (
  getQuoteCapability: NonNullable<NonNullable<SharedWalletSession['actions']>['getCurrentDexQuoteCapability']>,
  sender: TrialSubmission,
  expected: { owner: string; inputToken: string; outputToken: string },
  assertCurrent: () => void
) => {
  assertCurrent();
  const hint = sender.readCurrentCheapRestoreHint();
  if (!hint) return null;
  if (!hint.quoteHash) throw new Error('The saved signing request has no known Quote hash. Reconcile it before another action.');
  const capability = await getQuoteCapability(trialChain);
  assertCurrent();
  const issued = await capability.restoreCurrentQuote({ quoteHash: hint.quoteHash });
  assertCurrent();
  if (!['fast-pool','cheap-async'].includes(issued.intent.profile) || !['cheap-exit', 'cheap-history'].includes(currentCheapDexCandidateKey(issued.intent.candidate)) ||
      issued.intent.destination.toLowerCase() !== expected.owner.toLowerCase() ||
      issued.intent.inputToken.toLowerCase() !== expected.inputToken.toLowerCase() ||
      issued.intent.outputToken.toLowerCase() !== expected.outputToken.toLowerCase()) {
    throw new Error('Select the original swap pair and side before restoring this Quote.');
  }
  const restored = await sender.restoreCurrentCheapOperation(issued);
  assertCurrent();
  return restored;
};
// Shared candidates use six-decimal contracts, not the historical two-token adapter.
export const readCurrentSwapInputFunding = async (
  sender: Pick<TrialSubmission, 'readSharedTokenFunding' | 'readCurrentTokenFunding'>,
  candidateKey: CurrentCheapDexCandidateKey, owner: string, token: string, tokenIndex: 0 | 1
) => {
  if (candidateKey !== 'cheap-prepared' && candidateKey !== 'cheap-exit' && candidateKey !== 'cheap-history') return sender.readCurrentTokenFunding(tokenIndex);
  const candidate = resolveCurrentCheapDexCandidate(candidateKey), funds = await sender.readSharedTokenFunding();
  const input = funds.tokens.find(value => value.address.toLowerCase() === token.toLowerCase());
  if (funds.owner.toLowerCase() !== owner.toLowerCase() || funds.core.toLowerCase() !== candidate.core.toLowerCase() ||
      funds.graph !== candidate.graph || funds.packageSha256 !== candidate.packageSha256 || funds.privateFundsVerified !== true ||
      funds.readyToSign !== false || !input || input.decimals !== 6 || typeof input.balance !== 'bigint' || input.balance < 0n ||
      typeof input.allowance !== 'bigint' || input.allowance < 0n) throw new Error('Shared swap input funding identity or private state changed.');
  return { balance: input.balance, allowance: input.allowance, claimed: input.claimed, block: funds.head };
};
type TrialTiming = NonNullable<ReturnType<TrialSubmission['readCurrentCheapTiming']>>;
export const reconcileCurrentTrialPending = async (
  getCapability: NonNullable<NonNullable<SharedWalletSession['actions']>['getCurrentDexSubmissionCapability']>,
  existing: TrialSubmission | null = null,
  knownTransactionHash?: string,
  candidateKey: CurrentCheapDexCandidateKey = 'cheap-current'
) => {
  const sender = existing ?? (candidateKey === 'cheap-current' ? await getCapability(trialChain) : await getCapability(trialChain, { candidate: candidateKey }));
  return { sender, attempt: await sender.recoverPendingCurrentCheapAttempt(knownTransactionHash) };
};
export const verifyCurrentTrialCandidate = async (
  getCapability: NonNullable<NonNullable<SharedWalletSession['actions']>['getCurrentDexSubmissionCapability']>,
  owner: string,
  candidateKey: CurrentCheapDexCandidateKey = 'cheap-current'
) => {
  const candidate = candidateKey === 'cheap-current' ? CURRENT_CHEAP_DEX_CANDIDATE : resolveCurrentCheapDexCandidate(candidateKey);
  const sender = candidateKey === 'cheap-current' ? await getCapability(trialChain) : await getCapability(trialChain, { candidate: candidateKey });
  const observed = await sender.checkCurrentCheapCandidate();
  if (observed.chainId !== trialChain || observed.owner.toLowerCase() !== owner.toLowerCase() ||
      observed.core.toLowerCase() !== candidate.core ||
      observed.graph !== candidate.graph || observed.readyToSign !== false) {
    throw new Error('Current trial contract or owner identity changed.');
  }
  return { sender, observed };
};
export const hasCurrentTrialSavedAction = (storage: Parameters<typeof readCurrentDexPendingAttempt>[0]) => {
  try {
    const saved = readCurrentDexPendingAttempt(storage);
    // Existing token-funding recovery can verify its exact journal before Quote.
    return Boolean(saved && saved.phase !== 'token-faucet' && saved.phase !== 'token-approve');
  } catch { return true; } // Invalid or unreadable metadata cannot permit a send.
};
export const recoverOrReconcileCurrentTrial = async (
  pending: { recover: () => Promise<unknown> },
  getCapability: NonNullable<NonNullable<SharedWalletSession['actions']>['getCurrentDexSubmissionCapability']>,
  existing: TrialSubmission | null,
  knownTransactionHash?: string,
  candidateKey: CurrentCheapDexCandidateKey = 'cheap-current'
) => {
  try { return { kind: 'recovered' as const, observed: await pending.recover() }; }
  catch (error) {
    // Mining cannot establish a safe private payout. Keep its journal for diagnosis.
    if (error instanceof CurrentDexPrivateReceiptError) throw error;
    // Only the adapter's canonical journal read can classify a failed recovery call.
    return { kind: 'reconciled' as const, ...await reconcileCurrentTrialPending(getCapability, existing, knownTransactionHash, candidateKey) };
  }
};
type TrialAttempt = NonNullable<Awaited<ReturnType<TrialSubmission['recoverPendingCurrentCheapAttempt']>>>;
export const currentTrialAttemptPresentation = (attempt: TrialAttempt) => {
  if (attempt.status === 'manual-reconciliation-required') return { stage: 'reconciling', message:
    'verificationBlocked' in attempt && attempt.verificationBlocked
      ? 'Private verification failed or is unavailable. The saved action remains blocked. Check its exact private receipt in the original session; do not resend.'
      : 'transactionHash' in attempt && attempt.transactionHash
        ? `${'reason' in attempt ? attempt.reason : 'The existing transaction needs manual reconciliation.'} Transaction hash retained. Do not resend.`
        : 'The saved action has no transaction hash. Enter its existing hash below, then Check current state. Do not resend.' };
  if (attempt.status === 'awaiting-chain-confirmation') return { stage: 'reconciling',
    message: 'Transaction remains pending or is not available from the chain. Check current state later; do not resend.' };
  if (attempt.status === 'observed-reverted') return { stage: 'reverted', message: 'Transaction reverted. No settlement or refund is confirmed.' };
  if (attempt.phase === 'quote' && attempt.profile === 'fast-pool' && attempt.operation.phase === 'expired-unrecovered') {
    return { stage: 'observed-expired', message: 'Expired Fast Quote reconciled. It did not fund a swap. Select New Quote to start again.' };
  }
  if (attempt.phase === 'accept' && attempt.profile === 'cheap-async') return { stage: 'observed-accept',
    message: attempt.operation.phase === 'settled'
      ? 'Public settlement is complete. Private delivery and refund amounts are not verified in this session.'
      : attempt.operation.phase === 'released'
        ? 'Public release is complete. The private refund is not verified in this session.'
        : attempt.operation.phase === 'expired-unrecovered'
          ? 'Funded swap expired. Private recovery is required in an authenticated session.'
          : 'Accept is mined; settlement remains pending. Private delivery and refund amounts are not verified.' };
  return { stage: attempt.phase === 'quote' ? 'observed-open' : attempt.phase === 'accept' ? 'observed-accept' : 'observed-release',
    message: attempt.phase === 'quote' ? 'Open mined, but this session has no authenticated Quote origin. Accept is unavailable.'
      : attempt.phase === 'accept' ? 'Accept mined. Settlement and private payout are not confirmed in this session.'
        : 'Owner release mined. Read the private receipt with an authenticated origin to verify the refund.' };
};
export function CurrentSwapWorkspace({
  priceDisplayInverted,
  selectedPair,
  marketReference,
  sharedWalletSession,
  onPriceDisplayInvertedChange,
  candidateKey = 'cheap-current', visible = true
}: {
  priceDisplayInverted: boolean;
  selectedPair: TradingPair;
  marketReference?: CurrentDexMarketReference;
  sharedWalletSession?: SharedWalletSession;
  onPriceDisplayInvertedChange?: (inverted: boolean) => void;
  candidateKey?: CurrentCheapDexCandidateKey;
  visible?: boolean;
}) {
  const preparedScope = candidateKey === 'cheap-prepared' || candidateKey === 'cheap-exit' || candidateKey === 'cheap-history' ? resolvePreparedDexScope(candidateKey) : null;
  const candidate = preparedScope?.candidate ?? (candidateKey === 'cheap-current' ? CURRENT_CHEAP_DEX_CANDIDATE : resolveCurrentCheapDexCandidate(candidateKey));
  const preparedCandidate = preparedScope !== null;
  const display = readCurrentDexDisplay(candidate);
  const displayTokens = preparedCandidate ? selectedPair.map(label => {
    const token = display.tokens.find(token => token.label === label);
    if (!token) throw new Error('Selected pair is outside the prepared DEX candidate.');
    return token;
  }) : display.tokens.slice(0, 2);
  const selectedTokens = [displayTokens[0].address, displayTokens[1].address] as const;
  currentDexDisplayPair(candidate, ...selectedTokens);
  const trialTokens = [displayTokens[0].label, displayTokens[1].label] as const;
  const getSubmission = () => candidateKey === 'cheap-current'
    ? sharedWalletSession!.actions!.getCurrentDexSubmissionCapability!(trialChain)
    : sharedWalletSession!.actions!.getCurrentDexSubmissionCapability!(trialChain, { candidate: candidateKey });
  const [canonicalSide, setCanonicalSide] = useState<TradeActionSide>('buy');
  const [maximumInput, setMaximumInput] = useState('');
  const [minimumInput, setMinimumInput] = useState('0');
  const [profile, setProfile] = useState<CurrentCheapDexProfile>('fast-pool');
  const [minimumOutput, setMinimumOutput] = useState('0');
  const [priceLimit, setPriceLimit] = useState('');
  const [stage, setStage] = useState('idle');
  const [message, setMessage] = useState('');
  const [transactionHash, setTransactionHash] = useState('');
  const [existingTransactionHash, setExistingTransactionHash] = useState('');
  const [result, setResult] = useState<{ text: string; scope: object; operationId: string; transactionHash: string | null } | null>(null);
  const balances = useCurrentTrialBalances(sharedWalletSession, result?.text ?? '', { candidate, tokens: selectedTokens });
  const [timings, setTimings] = useState<TrialTiming[]>([]);
  const journey = useRef<CurrentSwapJourneyTiming | null>(null);
  const [, updateTimingDisplay] = useState(0);
  const workspaceElement = useRef<HTMLElement | null>(null);
  const [documentVisible, setDocumentVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const [issued, setIssued] = useState<CurrentCheapDexIssuedQuote | null>(null);
  const [publicAttempt, setPublicAttempt] = useState<TrialAttempt | null>(null);
  const [submission, setSubmission] = useState<TrialSubmission | null>(null);
  const [pending, setPending] = useState<{ recover: () => Promise<unknown>; phase: 'quote' | 'accept' | 'cancel' | 'recover' } | null>(null);
  const [checking, setChecking] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [fundingRecovery, setFundingRecovery] = useState(false);
  const [fundingPending, setFundingPending] = useState<(() => Promise<CurrentTokenFundingResult>) | null>(null);
  const sharedFundingPending = useRef<{ recover: Awaited<ReturnType<TrialSubmission['submitSharedSwapApproval']>>['recover'] | Awaited<ReturnType<TrialSubmission['submitSharedTokenFunding']>>['recover']; scope: object } | null>(null);
  const [capturedTerms, setCapturedTerms] = useState('');
  const [slippagePercent, setSlippagePercent] = useState(DEFAULT_CURRENT_DEX_SLIPPAGE_PERCENT);
  const [customSlippage, setCustomSlippage] = useState(false);
  const [quoteReview, setQuoteReview] = useState<{ model: TradeActionConfirmModel; scope: object } | null>(null);
  const displayedProfile = issued?.intent.profile ?? profile;
  const restoredQuote = issued !== null && capturedTerms === '';
  const displayedSlippage = restoredQuote ? String((issued.intent.toleranceBps ?? 0) / 100) : slippagePercent;
  const quoteProtocol = currentCheapDexQuoteProtocol(candidate);
  const termsKey = [candidate.graph, candidate.core, candidate.packageSha256, ...selectedTokens, selectedPair.join('/'), profile, canonicalSide, priceDisplayInverted, maximumInput, minimumInput, minimumOutput, priceLimit, quoteProtocol, slippagePercent].join(':');
  const inputIndex = canonicalSide === 'buy' ? 1 : 0;
  const outputIndex = canonicalSide === 'buy' ? 0 : 1;
  const parseInput = (value: string, field: string, positive = false) => parseDexCandidateTokenAmount(candidate, selectedTokens[inputIndex], value, field, positive);
  const parseOutput = (value: string, field: string) => parseDexCandidateTokenAmount(candidate, selectedTokens[outputIndex], value, field);
  const formatInput = (amount: bigint) => formatDexCandidateTokenAmount(candidate, selectedTokens[inputIndex], amount);
  const formatOutput = (amount: bigint) => formatDexCandidateTokenAmount(candidate, selectedTokens[outputIndex], amount);
  let fundingAtoms = '';
  try { fundingAtoms = parseInput(maximumInput, 'You send', true).toString(); } catch { /* Invalid input cannot enable approval. */ }
  const wallet = { address: sharedWalletSession?.walletAddress.toLowerCase(), chainId: sharedWalletSession?.chainId,
    provider: sharedWalletSession?.browserProvider };
  const currentWallet = useRef(wallet);
  if (currentWallet.current.address !== wallet.address || currentWallet.current.chainId !== wallet.chainId ||
      currentWallet.current.provider !== wallet.provider) currentWallet.current = wallet;
  const privacyReady = sharedWalletSession ? resolveBrowserWalletPrivacyState({ browserWalletAddress: sharedWalletSession.walletAddress,
    sessionOnboardInfo: sharedWalletSession.sessionOnboardInfo ?? {}, walletAesHealthByAddress: sharedWalletSession.walletAesHealthByAddress }).ownerAesReady : false;
  const reviewContext = { wallet: currentWallet.current, terms: termsKey, privacyReady,
    onboard: sharedWalletSession?.sessionOnboardInfo, health: sharedWalletSession?.walletAesHealthByAddress,
    source: sharedWalletSession?.activeSignerSource, walletId: sharedWalletSession?.browserWalletId,
    getQuote: sharedWalletSession?.actions?.getCurrentDexQuoteCapability,
    getSender: sharedWalletSession?.actions?.getCurrentDexSubmissionCapability,
    getReceipt: sharedWalletSession?.actions?.getCurrentDexReceiptCapability };
  const reviewScope = useRef(reviewContext);
  if ((Object.keys(reviewContext) as (keyof typeof reviewContext)[]).some(key => reviewContext[key] !== reviewScope.current[key])) reviewScope.current = reviewContext;
  const currentReviewScope = reviewScope.current;
  const { confirmation, requestConfirmation, resolveConfirmation } = useTradeActionConfirmationState(currentReviewScope);
  const activeJourney = journey.current?.scope === currentReviewScope ? journey.current : null;
  const timedConfirmation = (model: TradeActionConfirmModel, kind: string) => {
    const clock = journey.current?.scope === currentReviewScope ? journey.current : null;
    return clock ? clock.observeWait(kind, () => requestConfirmation(model), true) : requestConfirmation(model);
  };
  useEffect(() => {
    const changedVisibility = () => setDocumentVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', changedVisibility);
    return () => document.removeEventListener('visibilitychange', changedVisibility);
  }, []);
  const [verifiedScope, setVerifiedScope] = useState<typeof currentReviewScope | null>(null);
  const candidateReady = verifiedScope !== null && verifiedScope === currentReviewScope;
  const capturedWallet = useRef(wallet);
  const capturedCandidate = useRef(candidateKey);
  const candidateChanged = stage !== 'idle' && capturedCandidate.current !== candidateKey;
  const walletChanged = stage !== 'idle' && (capturedWallet.current.address !== wallet.address ||
    capturedWallet.current.chainId !== wallet.chainId || capturedWallet.current.provider !== wallet.provider);
  const changed = capturedTerms !== '' && capturedTerms !== termsKey;
  const connected = Boolean(sharedWalletSession?.walletAddress && sharedWalletSession.chainId === Number(trialChain) &&
    sharedWalletSession.actions?.getCurrentDexQuoteCapability &&
    sharedWalletSession.actions?.getCurrentDexSubmissionCapability &&
    sharedWalletSession.actions?.getCurrentDexReceiptCapability &&
    sharedWalletSession.browserProvider);
  const canInspect = Boolean(sharedWalletSession?.walletAddress && sharedWalletSession.chainId === Number(trialChain) &&
    sharedWalletSession.actions?.getCurrentDexSubmissionCapability);
  const enabled = candidateReady && connected && !walletChanged && !candidateChanged;
  const busy = ['preparing', 'open-pending', 'accepting', 'release-pending'].includes(stage);
  const savedActionPending = typeof window !== 'undefined' && hasCurrentTrialSavedAction(currentDexPendingStorage());
  const inputsLocked = connecting || busy || Boolean(issued) || Boolean(pending) || savedActionPending || fundingRecovery || candidateChanged;
  const unknownOrigin = stage.startsWith('observed-');
  const displayedSide = resolveDisplayedTradeActionSide(canonicalSide, priceDisplayInverted);
  const displayedBaseIndex = priceDisplayInverted ? 1 : 0;
  const captureTiming = (sender: TrialSubmission, hash: string) => {
    if (reviewScope.current !== currentReviewScope) return;
    const observed = sender.readCurrentCheapTiming?.(hash);
    if (observed) setTimings(previous => [...previous.filter(row => row.transactionHash !== observed.transactionHash), observed]);
  };
  const checkCandidate = async () => {
    if (!connected || checking || busy || walletChanged) return;
    setChecking(true); setVerifiedScope(null);
    const captured = currentWallet.current;
    try {
      const { sender } = await verifyCurrentTrialCandidate(
        sharedWalletSession!.actions!.getCurrentDexSubmissionCapability!, captured.address!, candidateKey);
      const current = currentWallet.current;
      if (current !== captured) {
        throw new Error('Wallet changed during the contract check.');
      }
      if (reviewScope.current !== currentReviewScope) throw new Error('Swap candidate, pair or privacy session changed during the contract check.');
      setSubmission(sender); setVerifiedScope(currentReviewScope);
      setMessage('Current test contracts verified. Quote and Accept repeat their checks; daily history is display-only.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Current contract verification failed.'); }
    finally { setChecking(false); }
  };
  const selectSide = (side: TradeActionSide) => {
    setCanonicalSide(resolveCanonicalTradeActionSide(side, priceDisplayInverted));
    setMaximumInput('');
    setMinimumOutput('0');
    setPriceLimit('');
  };
  const error = (cause: unknown) => {
    if (!fundingPending && !sharedFundingPending.current) {
      try {
        const saved = readCurrentDexPendingAttempt(currentDexPendingStorage());
        setFundingRecovery(saved?.phase === 'token-approve' || saved?.phase === 'token-faucet' || saved?.phase === 'token-refill');
      } catch { /* Keep recovery held if its durable record cannot be read. */ }
    }
    const message = getProviderErrorMessage(cause, 'The current DEX action failed. Check its chain state before another action.');
    setMessage(typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'TIMEOUT'
      ? 'The network request timed out. Check current state before another action; do not resend.'
      : /missing trie node/i.test(cause instanceof Error ? cause.message : message)
        ? 'The RPC node cannot read this swap state. Check current state later; do not resend.'
        : message);
    setStage('error');
  };
  const feeLimitStats = (identity: typeof candidate, action: CurrentCheapDexProfile) => {
    if (!usesCurrentSwapAccounting(identity)) return [];
    const caps = CURRENT_EXIT_SWAP_GAS_CAPS[action];
    const gasPrice = currentSwapFixedGasPrice(identity);
    return [
      { label: 'Quote fee limit', value: `${formatEther(caps.quote * gasPrice)} COTI` },
      { label: 'Accept fee limit', value: `${formatEther(caps.accept * gasPrice)} COTI` }
    ];
  };
  const confirm = async (title: string, rows: { label: string; value: string }[], ownerAction?: 'cancel' | 'recover') => {
    const quoteInputs = title === 'Confirm private Quote inputs';
    const accepted = await timedConfirmation({
      title, primaryLabel: ownerAction === 'recover' ? 'Recover swap' : ownerAction === 'cancel' ? 'Cancel swap' : 'Continue',
      secondaryLabel: ownerAction ? 'Back' : undefined,
      fundingMoves: [], stats: quoteInputs ? feeLimitStats(candidate, profile) : [],
      summaryRows: rows, message: ownerAction === 'recover'
        ? 'Return remaining input. Verify the refund after confirmation. Network gas applies.'
        : ownerAction === 'cancel' ? 'Cancel this swap. Network gas applies.'
          : 'Amounts stay private. Wallet transactions use network gas.'
    }, 'Private input or owner review request to decision');
    if (accepted && quoteInputs && currentWallet.current === capturedWallet.current && reviewScope.current === currentReviewScope) {
      setMessage('Private input review accepted. Complete the required wallet signatures.');
    }
    return accepted;
  };
  const showDelivery = async (current: CurrentCheapDexIssuedQuote, sender: TrialSubmission, terminalHash: string | null = null) => {
    if (currentCheapDexCandidateKey(current.intent.candidate) !== currentCheapDexCandidateKey(candidate) ||
        current.intent.inputToken.toLowerCase() !== selectedTokens[inputIndex] ||
        current.intent.outputToken.toLowerCase() !== selectedTokens[outputIndex]) {
      throw new Error('This operation belongs to another candidate or pair. Return to its original view to verify it.');
    }
    if (!privacyReady) throw new Error('Unlock privacy before checking the private result.');
    if (reviewScope.current !== currentReviewScope) throw new Error('Privacy session changed. Check the private result again.');
    const receipt = await sender.readCurrentCheapDelivery(current);
    if (currentWallet.current !== capturedWallet.current) throw new Error('Wallet changed during private result verification.');
    if (reviewScope.current !== currentReviewScope) throw new Error('Privacy session changed during private result verification. Check again.');
    const a = receipt.amounts;
    const unfundedCancellation = receipt.releaseAction === 'cancel';
    setResult({ scope: currentReviewScope, operationId: current.operationId.toString(), transactionHash: terminalHash || null,
      text: `Paid ${formatInput(a.actualInput)} ${trialTokens[inputIndex]}; received ${formatOutput(a.netOutput)} ${trialTokens[outputIndex]}; ${unfundedCancellation ? 'unused' : 'refunded'} ${formatInput(a.refund)} ${trialTokens[inputIndex]}.` });
    setStage(current.operation.phase === 'released' ? 'released' : 'settled');
    setMessage(unfundedCancellation ? 'Quote cancelled before funding.' : current.operation.phase === 'released' ? 'Released with a private refund receipt.' :
      a.filled ? 'Settlement confirmed by the private receipt.' : 'No fill; check the private refund receipt.');
  };
  const checkFunding = async (sender: TrialSubmission) => {
    if (!preparedCandidate) return checkCurrentFunding(sender, inputIndex as 0 | 1, fundingPending ?? undefined);
    if (sharedFundingPending.current) {
      if (sharedFundingPending.current.scope !== currentReviewScope || reviewScope.current !== currentReviewScope || currentWallet.current !== capturedWallet.current) {
        throw new Error('Swap approval recovery belongs to another wallet, pair or privacy session. Reconcile its original action; do not resend.');
      }
      const verified = await sharedFundingPending.current.recover();
      if (verified.fundingOutcome === 'reverted') return { fundingOutcome: 'reverted' as const };
    } else {
      const saved = readCurrentDexPendingAttempt(currentDexPendingStorage());
      const observed = saved?.phase === 'token-faucet' || saved?.phase === 'token-refill'
        ? await sender.recoverPendingSharedTokenFunding(existingTransactionHash)
        : await sender.recoverPendingSharedSwapApproval(existingTransactionHash);
      if (observed && !['observed-mined', 'observed-reverted'].includes(observed.status)) throw new Error('Shared approval needs chain reconciliation. Do not resend.');
    }
    return readCurrentSwapInputFunding(sender, candidateKey, currentWallet.current.address!, selectedTokens[inputIndex], inputIndex as 0 | 1);
  };
  const ensureFunding = async (sender: TrialSubmission, amount: bigint, attemptWallet: typeof wallet, preparedQuote?: CurrentCheapDexPreparedQuote) => {
    const assertWallet = () => {
      if (currentWallet.current !== attemptWallet) throw new Error('Wallet changed during input funding.');
      if (reviewScope.current !== currentReviewScope) throw new Error('Swap candidate, pair or privacy session changed during input funding.');
    };
    setMessage('Checking private input balance and allowance.');
    if (preparedCandidate) {
      if (candidateKey !== 'cheap-exit' && candidateKey !== 'cheap-history') throw new Error('Prepared-candidate swap approval is not supported. Its App swap admission remains held.');
      if (amount <= 0n || amount > CURRENT_SHARED_SWAP_APPROVAL_MAXIMUM) throw new Error('Shared swap input is outside the finite amount bound.');
      let funds = await readCurrentSwapInputFunding(sender, candidateKey, attemptWallet.address!, selectedTokens[inputIndex], inputIndex as 0 | 1); assertWallet();
      if (funds.balance < amount) throw new Error('Private input balance is insufficient. Claim test tokens separately before Get Quote.');
      if (funds.allowance === amount) return funds;
      if (funds.allowance !== 0n) throw new Error('The existing Core allowance differs from this exact swap amount. Do not replace it without reconciliation.');
      const prepared = await sender.prepareSharedSwapApproval({ token: selectedTokens[inputIndex], amount, assertReviewCurrent: assertWallet, preparedQuote,
        confirm: async review => {
          assertWallet(); const yes = await timedConfirmation({ title: 'Approve exact swap input', primaryLabel: 'Continue', fundingMoves: [], stats: [],
            summaryRows: [{ label: 'Input token', value: trialTokens[inputIndex] }, { label: 'Amount (tokens)', value: formatInput(review.amount) },
              { label: 'Core spender', value: review.spender }], message: 'This finite approval binds the selected input token and current Core. It is not unlimited approval.'
          }, 'Token setup review request to decision'); assertWallet(); return yes;
        } });
      assertWallet();
      if (!prepared) { setStage(issued ? 'ready' : 'idle'); setMessage('Exact approval cancelled. No swap was sent.'); return null; }
      setFundingRecovery(true);
      const sent = await sender.submitSharedSwapApproval(prepared);
      sharedFundingPending.current = { recover: sent.recover, scope: currentReviewScope }; setTransactionHash(sent.transactionHash); assertWallet();
      setMessage('Exact input approval submitted. Waiting for its private result.');
      if (!await sender.waitForCurrentCheapReceipt(sent.transactionHash)) {
        assertWallet(); setStage('error'); setMessage('Approval is pending. Check current state before another action; do not resend.'); return null;
      }
      const verified = await sent.recover(); assertWallet();
      sharedFundingPending.current = null; setFundingRecovery(false);
      if (verified.fundingOutcome === 'reverted') throw new Error('Approval reverted. Private state is unchanged.');
      funds = await readCurrentSwapInputFunding(sender, candidateKey, attemptWallet.address!, selectedTokens[inputIndex], inputIndex as 0 | 1); assertWallet();
      if (funds.balance < amount || funds.allowance !== amount) throw new Error('Exact shared input funds changed after approval.');
      return funds;
    }
    let funds = await sender.readCurrentTokenFunding(inputIndex as 0 | 1); assertWallet();
    for (const action of ['faucet', 'approve'] as const) {
      if (action === 'faucet' ? funds.balance >= amount : funds.allowance >= amount) continue;
      if (funds.balance < amount && (action === 'approve' || funds.claimed)) throw new Error('Current-mode input balance is insufficient. The test-token faucet cannot fund this amount.');
      const prepared = await sender.prepareCurrentTokenFunding({ tokenIndex: inputIndex as 0 | 1, action, amount,
        confirm: async review => {
          assertWallet(); const yes = await timedConfirmation(currentFundingConfirmation(review, action), 'Token setup review request to decision'); assertWallet(); return yes;
        } });
      assertWallet();
      if (!prepared) { setStage(issued ? 'ready' : 'idle'); setMessage('Current-token action cancelled. No swap was sent.'); return null; }
      setFundingRecovery(true);
      const sent = await sender.submitCurrentTokenFunding(prepared); assertWallet();
      const recover = async () => { assertWallet(); const value = await sent.recover(); assertWallet(); return value; };
      setFundingPending(() => recover);
      setTransactionHash(sent.transactionHash);
      setMessage('Current-token action submitted. Waiting for its exact private result.');
      if (!await sender.waitForCurrentCheapReceipt(sent.transactionHash)) {
        assertWallet(); setStage('error'); setMessage('Funding is still pending. Select Check funding and continue; do not resend.'); return null;
      }
      const verified = await recover();
      funds = verified;
      setFundingPending(null); setFundingRecovery(false);
      if (verified.fundingOutcome === 'reverted') throw new Error('Funding transaction reverted. Private state is unchanged.');
    }
    if (funds.balance < amount || funds.allowance < amount) throw new Error('Current-mode input funds remain insufficient.');
    return funds;
  };
  const showAttempt = (attempt: TrialAttempt) => {
    setPublicAttempt(attempt);
    if (!issued && attempt.status === 'observed-mined') setProfile(attempt.profile);
    if ('transactionHash' in attempt && attempt.transactionHash) setTransactionHash(attempt.transactionHash);
    const presentation = currentTrialAttemptPresentation(attempt);
    setStage(presentation.stage); setMessage(presentation.message);
  };
  const refresh = async () => {
    if (!canInspect || walletChanged || candidateChanged || checking || (busy && !pending)) return;
    if (stage === 'idle') { capturedWallet.current = currentWallet.current; capturedCandidate.current = candidateKey; }
    setChecking(true);
    let activeIssued = issued;
    let activeSender = submission;
    try {
      if (fundingRecovery) {
        const sender = submission ?? await getSubmission();
        const value = await checkFunding(sender);
        if (currentWallet.current !== capturedWallet.current) throw new Error('Wallet changed during input funding.');
        setFundingPending(null); sharedFundingPending.current = null; setFundingRecovery(false); setStage(issued ? 'ready' : 'idle');
        setMessage('fundingOutcome' in value && value.fundingOutcome === 'reverted' ? 'Funding reverted. Private state is unchanged.' : 'Private input funds verified. Continue with Get Quote or Review and Accept.'); return;
      }
      if (pending) {
        const outcome = await recoverOrReconcileCurrentTrial(pending,
          sharedWalletSession!.actions!.getCurrentDexSubmissionCapability!, submission, existingTransactionHash, candidateKey);
        if (currentWallet.current !== capturedWallet.current) throw new Error('Wallet changed during the operation check.');
        if (submission && transactionHash) captureTiming(submission, transactionHash);
        if (outcome.kind === 'reconciled') {
          setSubmission(outcome.sender);
          if (outcome.attempt?.status === 'observed-reverted' || outcome.attempt?.status === 'observed-mined') {
            setPending(null);
          }
          if (outcome.attempt) showAttempt(outcome.attempt);
          else { setStage('reconciling'); setMessage('Recovery failed and no canonical terminal result was found. Recheck before another action.'); }
          return;
        }
        const observed = outcome.observed;
        setPending(null);
        if (pending.phase === 'quote') {
          const quote = observed as CurrentCheapDexIssuedQuote;
          setIssued(quote);
          setStage(quote.operation.ready ? 'ready' : 'preparing-quote');
          setMessage('Quote confirmed. The operation ID came from the mined transaction.');
          return;
        }
        if (pending.phase === 'cancel' || pending.phase === 'recover') {
          setStage('released');
          setMessage('Release confirmed. Read the private receipt to verify the refund.');
        } else {
          const delivered = typeof observed === 'object' && observed !== null && 'status' in observed && observed.status === 'settled';
          setStage(delivered ? 'settled' : 'settlement-pending');
        }
      } else {
        const { sender, attempt } = await reconcileCurrentTrialPending(
          sharedWalletSession!.actions!.getCurrentDexSubmissionCapability!, submission, existingTransactionHash, candidateKey);
        if (currentWallet.current !== capturedWallet.current) throw new Error('Wallet changed during the operation check.');
        setSubmission(sender);
        activeSender = sender;
        if (!activeIssued && (candidateKey === 'cheap-exit' || candidateKey === 'cheap-history') && (!attempt ||
            attempt.status === 'observed-mined' && ['fast-pool','cheap-async'].includes(attempt.profile!))) {
          const restored = await restoreCurrentTrialQuote(
            sharedWalletSession!.actions!.getCurrentDexQuoteCapability!, sender,
            { owner: currentWallet.current.address!, inputToken: selectedTokens[inputIndex], outputToken: selectedTokens[outputIndex] },
            () => {
              if (currentWallet.current !== capturedWallet.current || reviewScope.current !== currentReviewScope) {
                throw new Error('Wallet, pair, candidate or privacy session changed during Quote restoration.');
              }
            });
          if (restored) {
            activeIssued = restored; setIssued(restored); setCapturedTerms(''); setPublicAttempt(null);
            setTransactionHash(restored.transactionHash); setVerifiedScope(currentReviewScope);
          }
        }
        if (attempt) {
          if (!activeIssued) showAttempt(attempt);
          // Public lookup never restores a private brand. A live issued origin
          // can still verify its own terminal receipt after this public read.
          if (!activeIssued || attempt.status !== 'observed-mined') return;
          if (issued && (attempt.phase !== 'accept' || attempt.operationId !== issued.operationId)) return;
        }
      }
      if (!activeIssued) { setMessage('No pending current DEX attempt was found for this owner session.'); return; }
      const current = await activeIssued.readCurrent();
      if (currentWallet.current !== capturedWallet.current) throw new Error('Wallet changed during the operation check.');
      setIssued(current);
      if (current.operation.phase === 'expired-unrecovered') {
        setStage('expired'); setMessage(activeIssued.intent.profile === 'fast-pool'
          ? 'Fast Quote expired. Quote did not fund the swap; create a new Quote.'
          : current.operation.stage === currentCheapDexStages(current.intent.candidate).funded
            ? 'Operation expired. Use Recover swap to return funded input.'
            : 'Quote expired without funding. Use Cancel swap before a new Quote.'); return;
      }
      if (currentWallet.current !== capturedWallet.current) throw new Error('Wallet changed during the operation check.');
      if (current.operation.phase === 'preparing-quote') {
        setStage('preparing-quote');
        setMessage(`Preparing multi-source Quote: ${Number(current.operation.stage) - 1} of ${currentCheapDexStages(current.intent.candidate).workCalls} work steps complete. Checking progress automatically.`); return;
      }
      if (current.operation.ready) {
        setIssued(current); setStage('ready'); setMessage('Private Quote is READY for review.');
        return;
      }
      if (current.operation.phase === 'settling') { setStage('settlement-pending'); setMessage('Accept is mined; settlement remains pending.'); return; }
      const sender = activeSender ?? await getSubmission();
      await showDelivery(current, sender);
    } catch (cause) { error(cause); }
    finally { setChecking(false); }
  };
  const getQuote = async () => {
    if (!connected || walletChanged || busy || checking || pending || savedActionPending || issued || unknownOrigin) return;
    const attemptWallet = currentWallet.current;
    capturedWallet.current = attemptWallet;
    capturedCandidate.current = candidateKey;
    const clock = new CurrentSwapJourneyTiming(currentReviewScope, { candidate: candidateKey, core: candidate.core, graph: candidate.graph, profile });
    journey.current = clock; setTimings([]); updateTimingDisplay(value => value + 1);
    try {
      // Prepared App writes stay held before the legacy funding path can run.
      const maximum = parseInput(maximumInput, 'You send', true);
      if (preparedCandidate) assertCurrentSwapCandidate(candidate,{principal:attemptWallet.address!,destination:attemptWallet.address!,profile,inputToken:selectedTokens[inputIndex],outputToken:selectedTokens[outputIndex],maximumInput:maximum});
      if(preparedCandidate&&candidateKey!=='cheap-exit'&&candidateKey!=='cheap-history')throw new Error('Prepared-candidate swap approval is not supported. Its App swap admission remains held.');
      const minimum = parseCurrentSwapFillPercent(minimumInput, maximum);
      const output = parseOutput(minimumOutput, 'You receive at least');
      let rate;
      const toleranceBps = quoteProtocol ? parseCurrentDexSlippagePercent(slippagePercent) : undefined;
      try { rate = quoteProtocol && !priceLimit.trim() ? { numerator: 0n, denominator: 1n } : parseCurrentSwapPriceLimit(priceLimit, displayedSide); }
      catch { throw new Error(`Price limit: enter a positive ${displayedSide === 'buy' ? 'maximum buy' : 'minimum sell'} price.`); }
      const { numerator, denominator } = rate;
      setStage('preparing'); setMessage('Checking current test contracts.');
      const saved = readCurrentDexPendingAttempt(currentDexPendingStorage());
      const { sender } = await verifyCurrentTrialCandidate(sharedWalletSession!.actions!.getCurrentDexSubmissionCapability!, attemptWallet.address!, candidateKey);
      if (currentWallet.current !== attemptWallet) throw new Error('Wallet changed during the contract check.');
      if (reviewScope.current !== currentReviewScope) throw new Error('Swap candidate, pair or privacy session changed during the contract check.');
      setSubmission(sender); setVerifiedScope(currentReviewScope);
      if (fundingRecovery || saved?.phase === 'token-faucet' || saved?.phase === 'token-approve') {
        setFundingRecovery(true); setMessage('Checking the existing funding action. No new approval is being sent.');
        const value = await checkFunding(sender);
        if (currentWallet.current !== attemptWallet) throw new Error('Wallet changed during input funding.');
        setFundingPending(null); sharedFundingPending.current = null; setFundingRecovery(false);
        if ('fundingOutcome' in value && value.fundingOutcome === 'reverted') throw new Error('Funding reverted. Private state is unchanged.');
      }
      const outstanding = await sender.recoverPendingCurrentCheapAttempt();
      if (currentWallet.current !== attemptWallet) throw new Error('Wallet changed during the pending-action check.');
      if (reviewScope.current !== currentReviewScope) throw new Error('Swap candidate, pair or privacy session changed during the pending-action check.');
      if (outstanding) { setSubmission(sender); showAttempt(outstanding); return; }
      const funds = preparedCandidate
        ? await readCurrentSwapInputFunding(sender,candidateKey,attemptWallet.address!,selectedTokens[inputIndex],inputIndex as 0|1)
        : await clock.observeWait('Quote input setup, including checks and any review or wallet wait', () => ensureFunding(sender, maximum, attemptWallet));
      if (!funds) return;
      const quoteCapability = await sharedWalletSession!.actions!.getCurrentDexQuoteCapability!(trialChain);
      if (currentWallet.current !== attemptWallet) throw new Error('Wallet changed during Quote preparation.');
      if (reviewScope.current !== currentReviewScope) throw new Error('Swap candidate, pair or privacy session changed during Quote preparation.');
      const quote = await quoteCapability.prepareCurrentQuote({ profile,
        graph: { candidate: candidateKey, expectedGraph: candidate.graph,
          expectedPackageSha256: candidate.packageSha256,
          blockNumber: funds.block.number, blockHash: funds.block.hash },
        terms: { inputToken: selectedTokens[inputIndex],
          outputToken: selectedTokens[outputIndex],
          destination: sharedWalletSession!.walletAddress, deadline: (candidateKey==='cheap-exit'||candidateKey==='cheap-history')
            ? funds.block.timestamp+CURRENT_APP_FURTHER_TRIAL.quoteSeconds
            : BigInt(Math.floor(Date.now()/1000))+600n,
          maximumInput: maximum, minimumInput: minimum, minimumOutput: output,
          rateNumerator: numerator, rateDenominator: denominator, ...(quoteProtocol ? { toleranceBps } : {}) },
        confirmPrivateInputs: review => confirm('Confirm private Quote inputs', [
          { label: 'Maximum input', value: `${formatInput(review.maximumInput)} ${trialTokens[inputIndex]}` },
          { label: 'Fill policy', value: review.minimumInput === 0n ? 'Any positive partial fill (0% minimum)' : `${minimumInput}% minimum · ${formatInput(review.minimumInput)} ${trialTokens[inputIndex]}` },
          { label: 'Minimum net output', value: `${formatOutput(review.minimumOutput)} ${trialTokens[outputIndex]}` },
          ...(quoteProtocol ? [{ label: 'Slippage', value: `${slippagePercent}% of the Quote net rate` }] : []),
          { label: displayedSide === 'buy' ? 'Maximum buy price' : 'Minimum sell price',
            value: quoteProtocol && !priceLimit.trim() ? 'No optional hard price limit' : `${priceLimit} ${trialTokens[1 - displayedBaseIndex]} per ${trialTokens[displayedBaseIndex]} · net of fees` }
        ])
      });
      if (!quote) { setStage('idle'); return; }
      if(preparedCandidate&&!await clock.observeWait('Exact branded Quote approval',()=>ensureFunding(sender,maximum,attemptWallet,quote)))return;
      if (currentWallet.current !== attemptWallet) throw new Error('Wallet changed during Quote preparation.');
      if (reviewScope.current !== currentReviewScope) throw new Error('Swap candidate, pair or privacy session changed during Quote preparation.');
      setSubmission(sender); setCapturedTerms(termsKey);
      const sent = await sender.submitCurrentCheapQuote(quote, {
        walletRequested: () => {
          if (currentWallet.current !== attemptWallet || reviewScope.current !== currentReviewScope) return;
          setStage('open-pending'); setMessage('Complete Quote in your wallet.');
        },
        transactionHashReturned: hash => {
          if (currentWallet.current !== attemptWallet || reviewScope.current !== currentReviewScope) return;
          clock.quoteSubmitted(hash); setTransactionHash(hash); captureTiming(sender, hash);
          setMessage('Quote submitted. Checking its transaction.');
        }
      });
      clock.quoteSubmitted(sent.transactionHash);
      captureTiming(sender, sent.transactionHash);
      setPending({ recover: sent.recover, phase: 'quote' }); setTransactionHash(sent.transactionHash);
      setStage('open-pending'); setMessage('Open submitted. Waiting for the confirmed Quote; the trade review will open when ready.');
      setChecking(true);
      if (!await sender.waitForCurrentCheapReceipt(sent.transactionHash)) {
        setMessage('Open submitted. Quote is still pending. Use Check current state; do not resend.'); return;
      }
      const confirmed = await sent.recover();
      if (currentWallet.current !== attemptWallet) throw new Error('Wallet changed while waiting for the Quote.');
      captureTiming(sender, sent.transactionHash);
      setPending(null); setIssued(confirmed);
      clock.bindOperation(confirmed.operationId.toString());
      setStage(confirmed.operation.ready ? 'ready' : 'preparing-quote');
      setChecking(false);
      if (confirmed.operation.ready) await reviewAndAccept(confirmed, sender);
      else setMessage('Quote preparation is in progress. Check current state for the private result.');
    } catch (cause) { error(cause); }
    finally { setChecking(false); }
  };
  const accept = async () => {
    if (!enabled || !issued || !submission || checking || savedActionPending || changed || stage !== 'ready' ||
        BigInt(Math.floor(Date.now() / 1000)) >= issued.intent.deadline) return;
    await reviewAndAccept(issued, submission);
  };
  const reviewAndAccept = async (quote: CurrentCheapDexIssuedQuote, sender: TrialSubmission) => {
    const attemptWallet = currentWallet.current;
    const clock = journey.current?.scope === currentReviewScope ? journey.current : null;
    const timingAttempt = clock?.acceptRequested();
    try {
      setStage('accepting');
      const funding = () => ensureFunding(sender, quote.intent.maximumInput, attemptWallet);
      if (!await (clock ? clock.observeWait('Accept input setup, including checks and any review or wallet wait', funding) : funding())) return;
      setMessage('Reading the private quote for review.');
      const sent = await sender.submitCurrentCheapAcceptance({ issued: quote,
        confirm: async model => {
          if (currentWallet.current !== attemptWallet) throw new Error('Wallet changed during quote review.');
          if (reviewScope.current !== currentReviewScope) throw new Error('Swap candidate, pair or privacy session changed during quote review.');
          setQuoteReview({ model: model as TradeActionConfirmModel, scope: currentReviewScope });
          clock?.bindOperation(quote.operationId.toString());
          const reviewedModel = model as TradeActionConfirmModel;
          const accepted = await timedConfirmation({ ...reviewedModel,
            stats: [...reviewedModel.stats, ...feeLimitStats(quote.intent.candidate, quote.intent.profile)]
          }, 'Accept review request to decision');
          if (timingAttempt) clock?.acceptDecision(timingAttempt, accepted);
          if (accepted) setMessage('Checking the quote and input funds before the wallet request.');
          return accepted;
        }, progress: {
          walletRequested: () => {
            if (currentWallet.current !== attemptWallet || reviewScope.current !== currentReviewScope) return;
            setMessage('Complete Accept in your wallet before the Quote expires.');
          },
          transactionHashReturned: hash => {
            if (currentWallet.current !== attemptWallet || reviewScope.current !== currentReviewScope) return;
            if (timingAttempt) clock?.acceptSubmitted(timingAttempt, hash);
            setTransactionHash(hash); captureTiming(sender, hash);
            setMessage('Accept submitted. Checking its transaction.');
          }
        } });
      if (!sent) { setStage('ready'); setMessage('Quote ready. Review and Accept when you are ready.'); return; }
      if (timingAttempt) clock?.acceptSubmitted(timingAttempt, sent.transactionHash);
      captureTiming(sender, sent.transactionHash);
      setPending({ recover: sent.recover, phase: 'accept' }); setTransactionHash(sent.transactionHash);
      setStage('accepting'); setMessage('Accept submitted. Waiting for the confirmed private result.'); setChecking(true);
      if (!await sender.waitForCurrentCheapReceipt(sent.transactionHash)) {
        setMessage('Accept submitted. Settlement is not complete. Use Check current state; do not resend.'); return;
      }
      const observed = await sent.recover();
      if (currentWallet.current !== attemptWallet) throw new Error('Wallet changed while waiting for Accept.');
      captureTiming(sender, sent.transactionHash); setPending(null);
      if (observed.status !== 'settled') {
        setStage('settlement-pending'); setMessage('Accept is mined; settlement remains pending.'); return;
      }
      const current = await quote.readCurrent();
      if (currentWallet.current !== attemptWallet) throw new Error('Wallet changed during private result verification.');
      await showDelivery(current, sender, sent.transactionHash);
    } catch (cause) {
      error(cause);
      if (cause instanceof CurrentDexQuoteProtectionError && currentWallet.current === attemptWallet) {
        await requestConfirmation(cause.review);
      }
    }
    finally { setChecking(false); }
  };
  const ownerAction = async (action: 'cancel' | 'recover') => {
    if (!enabled || !issued || !submission || busy || checking) return;
    const attemptWallet = currentWallet.current, previousStage = stage;
    const assertWallet = () => {
      if (currentWallet.current !== attemptWallet || reviewScope.current !== currentReviewScope) {
        throw new Error('Wallet, pair or privacy session changed during recovery. Check its original operation.');
      }
    };
    setChecking(true); setStage('release-pending');
    try {
      const sent = await submission.submitCurrentCheapOwnerAction({ issued, action, confirm: operation =>
        confirm(action === 'cancel' ? 'Cancel private swap' : 'Recover private swap', [
          { label: 'Operation', value: issued.operationId.toString() },
          { label: 'Public state', value: operation.phase }
        ], action), progress: {
          walletRequested: () => {
            if (currentWallet.current !== attemptWallet || reviewScope.current !== currentReviewScope) return;
            setMessage('Complete recovery in your wallet.');
          },
          transactionHashReturned: hash => {
            if (currentWallet.current !== attemptWallet || reviewScope.current !== currentReviewScope) return;
            setTransactionHash(hash); setMessage('Recovery submitted. Checking its transaction.');
          }
        } });
      assertWallet();
      if (!sent) { setStage(previousStage); return; }
      setPending({ recover: sent.recover, phase: action }); setTransactionHash(sent.transactionHash);
      setMessage('Recovery submitted. Verifying the private result.');
      if (!await submission.waitForCurrentCheapReceipt(sent.transactionHash)) {
        setMessage('Recovery submitted. Use Check current state; do not resend.'); return;
      }
      assertWallet(); await sent.recover(); assertWallet(); setPending(null);
      const current = await issued.readCurrent(); assertWallet(); setIssued(current);
      await showDelivery(current, submission, sent.transactionHash);
    } catch (cause) { error(cause); }
    finally { setChecking(false); }
  };
  const progressCheck = useRef(refresh);
  useEffect(() => { progressCheck.current = refresh; });
  useEffect(() => {
    if (issued?.intent.profile !== 'cheap-async' || !enabled || checking || pending || fundingRecovery || changed ||
        !['preparing-quote', 'settlement-pending'].includes(stage)) return;
    // Read-only progress. The keeper advances work; only an explicit wallet action can Accept.
    let stopped = false;
    let timer: number;
    const check = async () => {
      await progressCheck.current();
      if (!stopped) timer = window.setTimeout(() => { void check(); }, 5000);
    };
    timer = window.setTimeout(() => { void check(); }, 5000);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [issued, enabled, checking, pending, fundingRecovery, changed, stage]);
  const visibleQuote = quoteReview && quoteReview.scope === currentReviewScope ? quoteReview.model : null;
  const quoteOutput = visibleQuote?.summaryRows.find(row => row.label === 'You receive')?.value;
  const estimatedOutput = quoteOutput ? null : currentDexEstimatedReceive({reference:marketReference,pair:trialTokens,
    inputIndex:inputIndex as 0|1,input:fundingAtoms?BigInt(fundingAtoms):0n,inputDecimals:displayTokens[inputIndex].decimals,
    outputDecimals:displayTokens[outputIndex].decimals,now:BigInt(Math.floor(Date.now()/1000))});
  useEffect(() => {
    if (!activeJourney || !currentSwapTimingVisible(workspaceElement.current, documentVisible, visible)) return;
    let observed = false;
    // Public READY alone has no authenticated private review to display.
    if (visibleQuote && quoteOutput && issued && visibleQuote.summaryRows.some(row => row.label === 'You pay')) {
      observed = activeJourney.previewDisplayed(issued.operationId.toString()) || observed;
    }
    if (result?.scope === currentReviewScope) observed = activeJourney.deliveryDisplayed(result.operationId, result.transactionHash) || observed;
    if (observed) updateTimingDisplay(value => value + 1);
  }, [activeJourney, visibleQuote, quoteOutput, issued, result, currentReviewScope, documentVisible, visible]);
  const impactFor = (model: TradeActionConfirmModel | null) => currentDexPriceImpact({ model, reference: marketReference,
    pair: trialTokens, inputIndex: inputIndex as 0 | 1, now: BigInt(Math.floor(Date.now() / 1000)) });
  const quoteImpact = impactFor(visibleQuote);
  const displayedConfirmation = confirmation?.summaryRows.some(row => row.label === 'You pay')
    ? { ...confirmation, summaryRows: [...confirmation.summaryRows, { label: 'Price impact (net)', value: impactFor(confirmation) }] }
    : confirmation;
  const swapStatus = candidateChanged ? 'This operation belongs to the previous contract candidate. Return to its original view to check it.'
    : walletChanged ? 'Wallet or network changed. Reconnect and reconcile the pending action.'
      : changed ? 'Terms changed. This Quote cannot be accepted; inspect or cancel it.'
        : message || (wallet.address && (!connected || stage !== 'idle')
          ? wallet.chainId !== Number(trialChain) ? 'Switch your wallet to COTI Testnet to continue.'
            : !connected ? 'The wallet cannot use the current DEX. Check Transaction details.' : stage
          : null);
  const progressVisible = Boolean(canInspect || swapStatus || result || fundingRecovery || issued || transactionHash ||
    publicAttempt?.status === 'observed-mined' || ['error', 'reconciling'].includes(stage));
  const connectWallet = async () => {
    if (!sharedWalletSession?.actions?.connectBrowserWallet || connecting) return;
    setConnecting(true);
    try { await sharedWalletSession.actions.connectBrowserWallet(sharedWalletSession.browserWalletId || undefined); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Wallet connection failed. Try again.'); }
    finally { setConnecting(false); }
  };
  const unlockRequired = connected && !privacyReady && Boolean(sharedWalletSession?.actions?.unlockPrivacy) &&
    !issued && !fundingRecovery && !pending && !savedActionPending && !unknownOrigin && stage === 'idle';
  const unlockPrivacy = async () => {
    if (!unlockRequired || connecting || busy || checking || walletChanged) return;
    setConnecting(true);
    try { await sharedWalletSession!.actions!.unlockPrivacy(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Privacy unlock failed. Try again.'); }
    finally { setConnecting(false); }
  };
  const priceLimitField = <label>
    <span><strong>{displayedSide === 'buy' ? 'Maximum buy price' : 'Minimum sell price'}</strong><small>net of fees</small></span>
    <input aria-label="Price limit" inputMode="decimal" placeholder={quoteProtocol ? 'Optional' : 'Required'} value={restoredQuote
      ? issued.intent.rateNumerator === 0n ? '' : displayedSide === 'buy'
        ? `${issued.intent.rateDenominator} / ${issued.intent.rateNumerator}`
        : `${issued.intent.rateNumerator} / ${issued.intent.rateDenominator}`
      : priceLimit} onChange={event => setPriceLimit(event.target.value)} disabled={inputsLocked} />
    <small>{trialTokens[1 - displayedBaseIndex]} per {trialTokens[displayedBaseIndex]}</small>
  </label>;
  return <section ref={workspaceElement} className="dex-v2-swap-card dex-v2-current-swap" aria-label="Private Swap">
    <header className="dex-v2-current-swap-heading sr-only">
      <div>
        <h2>{displayedSide === 'buy' ? 'Buy' : 'Sell'} {trialTokens[displayedBaseIndex]}</h2>
      </div>
    </header>
    <div className="dex-v2-current-side-toggle" role="group" aria-label="Swap side">
      <button type="button" aria-label="Buy" aria-pressed={displayedSide === 'buy'} disabled={inputsLocked} onClick={() => selectSide('buy')}>Buy <span aria-hidden="true">{trialTokens[displayedBaseIndex]}</span></button>
      <button type="button" aria-label="Sell" aria-pressed={displayedSide === 'sell'} disabled={inputsLocked} onClick={() => selectSide('sell')}>Sell <span aria-hidden="true">{trialTokens[displayedBaseIndex]}</span></button>
    </div>
    <div className="dex-v2-current-amounts">
      <label>
        <span><strong>You send</strong><small>{trialTokens[inputIndex]}</small></span>
        <input aria-label="Maximum input" inputMode="decimal" placeholder="0" value={restoredQuote ? formatInput(issued.intent.maximumInput) : maximumInput} onChange={event => setMaximumInput(event.target.value)} disabled={inputsLocked} />
        {wallet.address ? <small aria-label="Input token balance">Balance: {connected && !privacyReady ? 'Locked' : balances.labels[inputIndex]}</small> : null}
      </label>
      <button className="dex-v2-current-direction" type="button" aria-label="Reverse price ratio" title="Reverse price ratio" disabled={inputsLocked || !onPriceDisplayInvertedChange} onClick={() => { setPriceLimit(''); onPriceDisplayInvertedChange?.(!priceDisplayInverted); }}>
        <ArrowDownUp size={18} aria-hidden="true" />
      </button>
      <div className="dex-v2-quote-output">
        <span><strong>{quoteOutput?'Quoted receive':'Estimated receive'}</strong><small>{trialTokens[outputIndex]}</small></span>
        <output aria-label={quoteOutput?'Quoted net output':'Estimated output'}>{quoteOutput??(estimatedOutput?`≈ ${estimatedOutput}`:'—')}</output>
        {estimatedOutput?<small role="note"><strong>Estimate only.</strong> Initial marginal price; excludes fees and price impact.</small>:null}
        {!quoteOutput&&!estimatedOutput&&fundingAtoms?<small>{marketReference?.status==='stale'?'Estimate unavailable: market price is stale.':'Estimate unavailable: current market price required.'}</small>:null}
        {quoteOutput ? <small>After fees</small> : null}
        {quoteOutput ? <small aria-label="Quote price impact">Price impact (net): {quoteImpact}</small> : null}
        {wallet.address ? <small aria-label="Output token balance">Balance: {connected && !privacyReady ? 'Locked' : balances.labels[outputIndex]}</small> : null}
      </div>
    </div>
    {balances.eligible ? <div className="dex-v2-current-actions">
      <button type="button" disabled={!balances.eligible || balances.loading || busy || checking} onClick={() => { void balances.refresh(); }}>Refresh balances</button>
    </div> : null}
    <details className="dex-v2-current-advanced">
      <summary><strong>{quoteProtocol ? 'Slippage' : 'Price protection'}</strong><span>{quoteProtocol ? `${displayedSlippage}%` : priceLimit || 'Set price limit · Required'}</span></summary>
      <div>
        {quoteProtocol ? <>
          <div className="dex-v2-setting-presets" role="group" aria-label="Slippage presets">
            {['0.1', '0.5', '1'].map(value => <button type="button" key={value} aria-pressed={!customSlippage && displayedSlippage === value} disabled={inputsLocked} onClick={() => { setSlippagePercent(value); setCustomSlippage(false); }}>{value}%</button>)}
            <button type="button" aria-pressed={customSlippage} disabled={inputsLocked} onClick={() => setCustomSlippage(true)}>Custom</button>
          </div>
          {customSlippage ? <label>Slippage (%)<input aria-label="Slippage percent" inputMode="decimal" value={slippagePercent} disabled={inputsLocked} onChange={event => setSlippagePercent(event.target.value)} /></label> : null}
        </> : <p>These test contracts require an exact price limit. Percentage slippage is not available.</p>}
        {!quoteProtocol ? <div className="dex-v2-current-fields">{priceLimitField}</div> : null}
        <details className="dex-v2-extra-settings"><summary>Advanced protections</summary><div className="dex-v2-current-fields">
          {quoteProtocol ? priceLimitField : null}
          <label>
            <span><strong>Minimum fill</strong><small>{restoredQuote ? trialTokens[inputIndex] : '% of You send'}</small></span>
            <input aria-label="Minimum input fill" inputMode="decimal" value={restoredQuote ? formatInput(issued.intent.minimumInput) : minimumInput} onChange={event => setMinimumInput(event.target.value)} disabled={inputsLocked} />
            {!restoredQuote ? <small>0% allows partial fills · 100% requires a full fill</small> : null}
          </label>
          <label>
            <span><strong>Minimum net output</strong><small>{trialTokens[outputIndex]} · optional</small></span>
            <input aria-label="Minimum net output" inputMode="decimal" value={restoredQuote ? formatOutput(issued.intent.minimumOutput) : minimumOutput} disabled={inputsLocked} onChange={event => setMinimumOutput(event.target.value)} />
          </label>
        </div>
        </details>
      </div>
    </details>
    {visibleQuote ? <details className="dex-v2-current-advanced"><summary>Quote details</summary><div>
      <p>Quotes do not reserve liquidity. Price impact includes spread and fees and uses the current rounded Pool reference.</p>
      <dl className="dex-v2-current-facts">{visibleQuote.summaryRows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
    </div></details> : null}
    <div className="dex-v2-execution-choice">
      <div className="dex-v2-swap-mode-toggle" role="group" aria-label="Swap mode">
        <button type="button" aria-pressed={displayedProfile === 'fast-pool'} disabled={inputsLocked} onClick={() => setProfile('fast-pool')}>Fast</button>
        <button type="button" aria-pressed={displayedProfile === 'cheap-async'} disabled={inputsLocked} onClick={() => setProfile('cheap-async')}>Multi-source</button>
      </div>
      <span>{displayedProfile === 'fast-pool' ? 'Pools only' : 'Pools and Limits · asynchronous'}</span>
    </div>
    {unlockRequired ? <p className="dex-v2-current-unlock-note">Unlock to view balances and request a quote.</p> : null}
    <div className="dex-v2-current-actions">
      {!wallet.address && sharedWalletSession?.actions?.connectBrowserWallet ? <button className="dex-v2-review-button" type="button" disabled={connecting || busy || checking} onClick={() => { void connectWallet(); }}>{connecting ? 'Connecting…' : 'Connect wallet'}</button> : unlockRequired ? <button className="dex-v2-review-button" type="button" disabled={connecting || busy || checking || walletChanged} onClick={() => { void unlockPrivacy(); }}>{connecting ? 'Unlocking…' : 'Unlock privacy'}</button> : !issued ? <button className="dex-v2-review-button" type="button" disabled={!connected || walletChanged || busy || checking || Boolean(pending) || savedActionPending || unknownOrigin} onClick={() => { void getQuote(); }}><span>{fundingRecovery ? 'Check funding and continue' : 'Get Quote'}</span><ArrowRight size={20} aria-hidden="true" /></button> :
      <button className="dex-v2-review-button" type="button" disabled={!enabled || checking || savedActionPending || changed || stage !== 'ready' ||
        BigInt(Math.floor(Date.now() / 1000)) >= (issued?.intent.deadline ?? 0n)}
      onClick={() => { void accept(); }}><span>Review and Accept</span><ArrowRight size={20} aria-hidden="true" /></button>}
    </div>
    <CurrentSwapProgress visible={progressVisible} status={swapStatus}
      result={result && result.scope === currentReviewScope && !walletChanged ? result.text : null}
      fundingRecovery={fundingRecovery}
      operation={issued ? { id: issued.operationId.toString(), expiresAt: new Date(Number(issued.intent.deadline) * 1000).toLocaleString() }
        : !walletChanged && !candidateChanged && publicAttempt?.status === 'observed-mined'
          ? { id: publicAttempt.operationId.toString(), publicState: publicAttempt.operation.phase, privateAccountingUnverified: true } : null}>
    <div className="dex-v2-progress-actions">
    {canInspect ? <button type="button" disabled={walletChanged || candidateChanged || checking || (busy && !pending)} onClick={() => { void refresh(); }}><RefreshCw size={15} aria-hidden="true" />Check current state</button> : null}
    {issued?.intent.profile === 'cheap-async' && currentCheapDexOwnerActionEligible(issued.intent.candidate, issued.operation.stage, 'cancel') && !pending &&
      !['settlement-pending', 'settled', 'released'].includes(stage) ? <button type="button" disabled={!enabled || busy || checking}
      onClick={() => { void ownerAction('cancel'); }}>Cancel swap</button> : null}
    {issued?.intent.profile === 'cheap-async' && currentCheapDexOwnerActionEligible(issued.intent.candidate, issued.operation.stage, 'recover') && !pending &&
      !['settled', 'released'].includes(stage) ? <button type="button" disabled={!enabled || busy || checking}
      onClick={() => { void ownerAction('recover'); }}>Recover swap</button> : null}
    {(['settled', 'released', 'observed-expired'].includes(stage) || (stage === 'expired' && issued?.intent.profile === 'fast-pool') || (stage === 'reverted' && !issued)) && !pending ? <button type="button" onClick={() => {
      setIssued(null); setSubmission(null); setCapturedTerms(''); setTransactionHash(''); setResult(null); setQuoteReview(null);
      setPublicAttempt(null);
      setExistingTransactionHash('');
      setTimings([]);
      journey.current = null; updateTimingDisplay(value => value + 1);
      setMessage(''); setStage('idle'); capturedWallet.current = wallet; capturedCandidate.current = candidateKey;
    }}>New Quote</button> : null}
    </div>
    {(['error', 'reconciling'].includes(stage) || (!issued && publicAttempt?.status === 'observed-mined')) && !fundingRecovery ? <details className="dex-v2-recovery-details"><summary>DEX recovery details</summary><div className="dex-v2-current-fields" style={{ gridTemplateColumns: '1fr' }}><label>
      Transaction hash (optional)
      <input aria-label="Existing DEX transaction hash" placeholder="0x…" value={existingTransactionHash}
        disabled={checking || walletChanged} onChange={event => setExistingTransactionHash(event.target.value)} />
      <small>Checks a saved Quote, Accept or recovery action. Does not send a transaction or restore private Accept authority.</small>
    </label></div></details> : null}
    {transactionHash ? <a className="dex-v2-progress-transaction" href={`${COTI_TESTNET_NETWORK.blockExplorerUrl}/tx/${transactionHash}`} target="_blank" rel="noreferrer">View transaction</a> : null}
    </CurrentSwapProgress>
    {preparedCandidate ? <details className="dex-v2-token-funding" open={fundingRecovery || undefined}><summary>Get test tokens</summary>
      <CurrentSharedTestTokenControls candidateKey={preparedScope!.key} sharedWalletSession={sharedWalletSession} disabled={busy || checking || walletChanged || Boolean(pending)} />
    </details> : null}
    {(!preparedCandidate || wallet.address || fundingRecovery || activeJourney) ? <details className="dex-v2-setup" open={fundingRecovery || undefined}><summary>Transaction details</summary><div>
      <p>Gas applies even when no trade fills.</p>
      {!preparedCandidate ? <CurrentTokenFundingControls sharedWalletSession={sharedWalletSession} tokenIndex={inputIndex as 0 | 1} maximumInput={fundingAtoms}
        recoveryRequired={fundingRecovery} recoverFunding={fundingPending ?? undefined}
        onReconciled={status => { setFundingPending(null); setFundingRecovery(false); setStage(issued ? 'ready' : 'idle'); setMessage(status); }}
        disabled={busy || checking || walletChanged || unknownOrigin || Boolean(pending) || (Boolean(issued) && stage !== 'ready')} /> : null}
    {!candidateReady ? <aside className="dex-v2-current-warning">
      <ShieldCheck size={19} aria-hidden="true" />
      <div><strong>Test contracts</strong>
        <button type="button" disabled={!connected || checking || busy || walletChanged} onClick={() => { void checkCandidate(); }}>Check current contracts</button>
      </div>
    </aside> : null}
    <details><summary>Trial token addresses</summary>
      <p>{trialTokens[0]}: {selectedTokens[0]}<br />{trialTokens[1]}: {selectedTokens[1]}</p>
    </details>
    {activeJourney && !walletChanged ? <details aria-label="Local trial timing">
      <summary>Local trial timing</summary>
      <p>Session timings in milliseconds; intervals can overlap. These do not measure mining or browser paint.</p>
      <dl>{([
        ['Get Quote click to private preview displayed', activeJourney.snapshot().quoteClickToPrivatePreviewDisplayedMs],
        ['Submitted Accept request to verified delivery/refund displayed', activeJourney.snapshot().acceptRequestToVerifiedResultDisplayedMs],
        ['Accept confirmation to verified delivery/refund displayed', activeJourney.snapshot().acceptConfirmationToVerifiedResultDisplayedMs],
        ['Complete journey: Get Quote click to verified delivery/refund displayed', activeJourney.snapshot().quoteClickToVerifiedResultDisplayedMs]
      ] as const).map(([label, elapsed]) => <div key={label}><dt>{label}</dt><dd>{elapsed === null ? 'Unknown / not observed' : `${Math.round(elapsed)} ms`}</dd></div>)}</dl>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(activeJourney.snapshot(), null, 2)}</pre>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(timings, null, 2)}</pre>
    </details> : null}
    </div></details> : null}
    <TradeActionConfirmModal confirmation={displayedConfirmation} onCancel={() => resolveConfirmation(false)} onConfirm={() => resolveConfirmation(true)}
      details={confirmation?.summaryRows.some(row => row.label === 'You pay') ? <details className="trade-action-confirm-details">
        <summary>Price and slippage</summary>
        <p>Price impact compares the net Quote rate with the rounded Pool reference, including spread and fees. Slippage protects the Quote net rate.</p>
      </details> : null} />
  </section>;
}

const STRATEGY_MODES: ReadonlyArray<{
  id: DexStrategyMode;
  label: string;
  detail: string;
  Icon: typeof ArrowDownUp;
}> = [
  { id: 'pool', label: 'Pool', detail: 'Shared four-bin liquidity', Icon: Database },
  { id: 'limit', label: 'Limit', detail: 'One private side at an exact tick', Icon: Clock3 },
  { id: 'recurring', label: 'Recurring', detail: 'Two private sides that replenish', Icon: RefreshCw }
];

const TICKS = Array.from({ length: 16 }, (_, index) => index);
const RECURRING_PRICE_PRESETS = Object.freeze([
  Object.freeze({ id: 'tight', label: '±1%', distance: 0.01 }),
  Object.freeze({ id: 'balanced', label: '±5%', distance: 0.05 }),
  Object.freeze({ id: 'wide', label: '±10%', distance: 0.1 })
]);

export const resolveDexModeFromPath = (path: string): DexMode => {
  const canonicalPath = resolveCanonicalTradingPath(path).toLowerCase();
  if (canonicalPath.endsWith('/positions')) return 'positions';
  if (canonicalPath.endsWith('/strategies')) return 'strategies';
  if (canonicalPath.endsWith('/limit')) return 'limit';
  if (canonicalPath.endsWith('/recurring')) return 'swap';
  if (canonicalPath.endsWith('/liquidity')) return 'liquidity';
  if (canonicalPath.endsWith('/activity')) return 'activity';
  return 'swap';
};

const normalizeAmountInput = (value: string): string => {
  if (!/^\d*(?:\.\d{0,6})?$/.test(value)) return '';
  return value.replace(/^0+(?=\d)/, '');
};

export const isExactSuccessorStrategyBudget = (
  value: string,
  token: Readonly<{ decimals: number; lotSizeRaw: string }>,
  allowZero = false
): boolean => {
  try {
    if (allowZero && /^0(?:\.0+)?$/u.test(value)) return true;
    const lots = parseDexV2TokenAmountToLots(value, token.decimals, BigInt(token.lotSizeRaw));
    return (allowZero ? lots >= 0n : lots > 0n) && lots <= 1_048_575n;
  } catch {
    return false;
  }
};

export type PoolRangeSelection = '0.5' | '1' | '5' | '10' | 'full' | 'custom';

export type PoolRangePreview = Readonly<{
  selection: PoolRangeSelection;
  lowerPrice: number;
  upperPrice: number;
}>;

export const DEFAULT_POOL_RANGE_PREVIEW: PoolRangePreview = Object.freeze({
  selection: 'custom',
  lowerPrice: 2 / Math.sqrt(1.003),
  upperPrice: 2 * Math.sqrt(1.003)
});

export const getDisplayedPoolRange = (
  range: PoolRangePreview,
  priceDisplayInverted = false
): Readonly<{ lowerPrice: number; upperPrice: number }> => {
  if (!priceDisplayInverted) {
    return Object.freeze({ lowerPrice: range.lowerPrice, upperPrice: range.upperPrice });
  }
  return Object.freeze({
    lowerPrice: 1 / range.upperPrice,
    upperPrice: 1 / range.lowerPrice
  });
};

export const formatDexV2DisplayedPrice = (
  tickRank: number,
  priceDisplayInverted = false
): string => {
  const forward = formatDexV2TickPrice(tickRank);
  if (!priceDisplayInverted) return forward;
  const numeric = Number(forward);
  return numeric > 0 ? (1 / numeric).toFixed(4) : '—';
};

export const resolveDexV2SwapTickRank = (
  canonicalBoundary: number,
  direction: DexV2SwapDirection
): number | null => {
  if (!Number.isFinite(canonicalBoundary) || canonicalBoundary <= 0) return null;
  const prices = TICKS.map((rank) => Number(formatDexV2TickPrice(rank)));
  if (direction === 'quote-to-base') {
    for (let rank = prices.length - 1; rank >= 0; rank -= 1) {
      if (prices[rank] <= canonicalBoundary) return rank;
    }
    return null;
  }
  for (let rank = 0; rank < prices.length; rank += 1) {
    if (prices[rank] >= canonicalBoundary) return rank;
  }
  return null;
};

export function ModeNavigation({ activeMode, onOpenAgent, onSelect }: { activeMode: DexMode; onOpenAgent?: () => void; onSelect: (mode: DexMode) => void }) {
  const selectView = (view: DexView) => {
    if (view === 'agent') {
      onOpenAgent?.();
      return;
    }
    onSelect(view === 'recurring' ? 'swap' : view);
  };
  return (
    <div className="dex-v2-mode-nav">
      <strong>DEX</strong>
      <DexViewTabs activeView={activeMode} onSelect={selectView} />
    </div>
  );
}

export function StrategyNavigation({
  activeStrategyMode,
  onSelect
}: {
  activeStrategyMode: DexStrategyMode;
  onSelect: (mode: DexStrategyMode) => void;
}) {
  return (
    <nav className="dex-v2-strategy-nav" aria-label="Strategy types">
      <div role="tablist" aria-label="DEX strategies">
        {STRATEGY_MODES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeStrategyMode === id}
            className={activeStrategyMode === id ? 'active' : undefined}
            onClick={() => onSelect(id)}
          >
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

export function MarketSummary({ selectedPair, successor }: { selectedPair: TradingPair; successor: SuccessorDexRuntimeState }) {
  const pair = successor.status === 'ready'
    ? successor.manifest.pairs.find(({ displayPair }) => displayPair === selectedPair.join('/'))
    : undefined;
  const referencePrice = successorPairReferencePrice(selectedPair);
  return (
    <section className="dex-v2-market-summary" aria-label="Current DEX market">
      <div className="dex-v2-market-pair">
        <span><i className="usdc">{selectedPair[0][0]}</i><i className="usdt">{selectedPair[1][0]}</i></span>
        <p><strong>{selectedPair.join(' / ')}</strong><small>COTI Testnet private pair</small></p>
      </div>
      <dl>
        <div><dt>Reference price</dt><dd>1 {selectedPair[0]} = {referencePrice.toFixed(4)} {selectedPair[1]}</dd></div>
        <div><dt>Direct sources</dt><dd>{pair?.sourceCount ?? '—'}</dd></div>
        <div><dt>Profile</dt><dd>{pair?.seedProfile ?? 'Verifying'}</dd></div>
        <div><dt>Execution</dt><dd>{pair?.sourceCount ? 'Unified same-pair' : 'P2 fallback test'}</dd></div>
      </dl>
    </section>
  );
}
function TokenAmountField({
  balanceLabel,
  errorMessage,
  label,
  symbol,
  displaySymbol: displaySymbolOverride,
  amount,
  readOnly,
  onBalanceAction,
  onBlur,
  onAmountChange,
  onMaxAmount,
  maxDisabled = false
}: {
  balanceLabel?: string;
  errorMessage?: string;
  label: string;
  symbol: string;
  displaySymbol?: string;
  amount: string;
  readOnly?: boolean;
  onBalanceAction?: () => void;
  onBlur?: () => void;
  onAmountChange?: (value: string) => void;
  onMaxAmount?: () => void;
  maxDisabled?: boolean;
}) {
  const isUsdc = symbol === 'pUSDC';
  const displaySymbol = displaySymbolOverride ?? symbol;
  const errorId = useId();
  return (
    <div className="dex-v2-token-field">
      <span className="dex-v2-field-label">
        <span>{label}</span>
        <span className="dex-v2-field-tools">
          {balanceLabel ? (onBalanceAction
            ? <button type="button" className="dex-v2-balance-action" onClick={onBalanceAction}>{balanceLabel}</button>
            : <small>{balanceLabel}</small>) : null}
          {onMaxAmount ? <button type="button" onClick={onMaxAmount} disabled={maxDisabled}>Max</button> : null}
        </span>
      </span>
      <div className="dex-v2-token-field-row">
        <span className="dex-v2-token-context" aria-label={`${label} token ${displaySymbol}`}>
          <span className={`dex-v2-token-icon ${isUsdc ? 'usdc' : 'usdt'}`}>
            {isUsdc ? <CircleDollarSign size={20} aria-hidden="true" /> : <Coins size={20} aria-hidden="true" />}
          </span>
          <strong>{displaySymbol}</strong>
        </span>
        {readOnly ? (
          <output className="dex-v2-amount-output" aria-label={`${label} amount`}>{amount}</output>
        ) : (
          <input
            inputMode="decimal"
            aria-label={`${label} amount`}
            aria-describedby={errorMessage ? errorId : undefined}
            aria-invalid={Boolean(errorMessage)}
            value={amount}
            placeholder="0.00"
            onChange={(event) => onAmountChange?.(normalizeAmountInput(event.target.value))}
            onBlur={onBlur}
          />
        )}
      </div>
      {errorMessage ? <small className="dex-v2-field-error" id={errorId} role="alert">{errorMessage}</small> : null}
    </div>
  );
}

function PoolAmountField({
  amount,
  balanceLabel,
  label,
  onAmountChange,
  onMaxAmount,
  maxDisabled,
  onRevealBalance,
  symbol
}: {
  amount: string;
  balanceLabel: string;
  label: string;
  onAmountChange: (value: string) => void;
  onMaxAmount: () => void;
  maxDisabled: boolean;
  onRevealBalance: () => void;
  symbol: string;
}) {
  const isUsdc = symbol === 'pUSDC';
  const displaySymbol = symbol;
  return (
    <div className="dex-v2-pool-amount-field">
      <div className="dex-v2-pool-amount-meta">
        <span>{label}</span>
        <span className="dex-v2-pool-amount-tools">
          <button type="button" onClick={onRevealBalance}>Available: {balanceLabel} {displaySymbol}</button>
          <button type="button" onClick={onMaxAmount} disabled={maxDisabled}>Max</button>
        </span>
      </div>
      <div className="dex-v2-pool-amount-input">
        <span className="dex-v2-pool-token-context" aria-label={`${label} token ${displaySymbol}`}>
          <span className={`dex-v2-token-icon ${isUsdc ? 'usdc' : 'usdt'}`}>
            {isUsdc ? <CircleDollarSign size={20} aria-hidden="true" /> : <Coins size={20} aria-hidden="true" />}
          </span>
          <strong>{displaySymbol}</strong>
        </span>
        <input
          aria-label={`${label} amount`}
          inputMode="decimal"
          value={amount}
          onChange={(event) => onAmountChange(normalizeAmountInput(event.target.value))}
        />
      </div>
    </div>
  );
}

function StrategyPreview({
  title,
  rows,
  note
}: {
  title: string;
  rows: ReadonlyArray<readonly [string, string]>;
  note: string;
}) {
  return (
    <aside className="dex-v2-strategy-preview">
      <header><span>ORDER PREVIEW</span><h2>{title}</h2></header>
      <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p><LockKeyhole size={17} aria-hidden="true" />{note}</p>
    </aside>
  );
}

export function PoolWorkspace({
  onRangePreviewChange,
  onSuccessorRefresh = () => undefined,
  priceDisplayInverted = false,
  rangePreview: _rangePreview,
  selectedPair = ['BCN', 'HBR'],
  successor = Object.freeze({ status: 'loading' } as const),
  sharedWalletSession
}: {
  onRangePreviewChange: (range: PoolRangePreview) => void;
  onSuccessorRefresh?: () => void;
  priceDisplayInverted?: boolean;
  rangePreview: PoolRangePreview;
  selectedPair?: TradingPair;
  successor?: SuccessorDexRuntimeState;
  sharedWalletSession?: SharedWalletSession;
}) {
  const marketReference = successorPairReferencePrice(selectedPair);
  const pairKey = selectedPair.join('/');
  const [canonicalStartingPrice, setCanonicalStartingPrice] = useState(marketReference);
  const [startingPriceInput, setStartingPriceInput] = useState(() =>
    (priceDisplayInverted ? 1 / marketReference : marketReference).toFixed(4));
  const [spreadInput, setSpreadInput] = useState('0.30');
  const [baseAmount, setBaseAmount] = useState('900');
  const [quoteAmount, setQuoteAmount] = useState('900');
  const { confirmation, requestConfirmation, resolveConfirmation } = useTradeActionConfirmationState();
  const balances = useDexV2TokenBalances({ runtime: successor, selectedPair, sharedWalletSession });
  const strategyAction = useSuccessorStrategyAction({ runtime: successor, sharedWalletSession, refresh: onSuccessorRefresh });
  const successorPair = successor.status === 'ready'
    ? successor.manifest.pairs.find((pair) => pair.displayPair === pairKey)
    : null;
  const baseToken = successor.status === 'ready'
    ? successor.manifest.tokens.find(({ symbol }) => symbol === selectedPair[0])
    : null;
  const quoteToken = successor.status === 'ready'
    ? successor.manifest.tokens.find(({ symbol }) => symbol === selectedPair[1])
    : null;
  const successorSupported = successor.status === 'ready' &&
    successorDexAdmissionAvailable(successor.snapshot, pairKey, 'Aggregate');
  const displayedBaseSymbol = priceDisplayInverted ? selectedPair[1] : selectedPair[0];
  const displayedQuoteSymbol = priceDisplayInverted ? selectedPair[0] : selectedPair[1];
  const numericStartingPrice = Number(startingPriceInput);
  const numericSpread = Number(spreadInput);
  const validStartingPrice = Number.isFinite(numericStartingPrice) && numericStartingPrice > 0;
  const validSpread = Number.isFinite(numericSpread) && numericSpread >= 0 && numericSpread <= 20;
  const validAmountText = (value: string) => /^\d+(?:\.\d{1,6})?$/.test(value) && Number(value) > 0;
  const validBudgets = baseToken && quoteToken
    ? isExactSuccessorStrategyBudget(baseAmount, baseToken) && isExactSuccessorStrategyBudget(quoteAmount, quoteToken)
    : validAmountText(baseAmount) && validAmountText(quoteAmount);
  const spreadFactor = validSpread ? Math.sqrt(1 + numericSpread / 100) : 1;
  const canonicalBid = canonicalStartingPrice / spreadFactor;
  const canonicalAsk = canonicalStartingPrice * spreadFactor;
  const displayedBid = priceDisplayInverted ? 1 / canonicalAsk : canonicalBid;
  const displayedAsk = priceDisplayInverted ? 1 / canonicalBid : canonicalAsk;
  const displayedMarket = priceDisplayInverted ? 1 / marketReference : marketReference;
  const maxBudget = (raw: bigint | null, selected: typeof baseToken) => {
    if (raw === null || !selected) return '';
    const lots = raw / BigInt(selected.lotSizeRaw);
    return formatDexV2LotsAsTokenAmount(
      lots > 1_048_575n ? 1_048_575n : lots,
      selected.decimals,
      BigInt(selected.lotSizeRaw)
    );
  };

  useEffect(() => {
    setCanonicalStartingPrice(marketReference);
    setStartingPriceInput((priceDisplayInverted ? 1 / marketReference : marketReference).toFixed(4));
    setSpreadInput('0.30');
    setBaseAmount('900');
    setQuoteAmount('900');
  }, [marketReference, pairKey, priceDisplayInverted]);

  useEffect(() => {
    if (!validStartingPrice || !validSpread) return;
    onRangePreviewChange({ selection: 'custom', lowerPrice: canonicalBid, upperPrice: canonicalAsk });
  }, [canonicalAsk, canonicalBid, onRangePreviewChange, validSpread, validStartingPrice]);

  const updateStartingPrice = (rawValue: string) => {
    const value = normalizeAmountInput(rawValue);
    setStartingPriceInput(value);
    const displayed = Number(value);
    if (Number.isFinite(displayed) && displayed > 0) {
      setCanonicalStartingPrice(priceDisplayInverted ? 1 / displayed : displayed);
    }
  };
  const useMarketPrice = () => {
    setCanonicalStartingPrice(marketReference);
    setStartingPriceInput(displayedMarket.toFixed(4));
  };
  const reviewPoolDesign = async () => {
    if (!successorPair || successor.status !== 'ready' || !validStartingPrice || !validSpread || !validBudgets) return;
    const accepted = await requestConfirmation(Object.freeze({
      title: 'Review private pool',
      message: 'Starting price, spread, and both budgets are authenticated private inputs. The protocol fee is separate and cannot be selected by the maker.',
      primaryLabel: 'Create private pool',
      secondaryLabel: null,
      fundingMoves: [],
      summaryRows: [
        { label: 'Starting price', value: `1 ${displayedBaseSymbol} = ${numericStartingPrice.toFixed(4)} ${displayedQuoteSymbol}` },
        { label: `Sell ${displayedBaseSymbol} marginal`, value: `${displayedBid.toFixed(4)} ${displayedQuoteSymbol}` },
        { label: `Buy ${displayedBaseSymbol} marginal`, value: `${displayedAsk.toFixed(4)} ${displayedQuoteSymbol}` },
        { label: 'Total spread', value: `${numericSpread.toFixed(2)}%` },
        { label: `${selectedPair[0]} budget`, value: baseAmount },
        { label: `${selectedPair[1]} budget`, value: quoteAmount }
      ],
      stats: [
        { label: 'Terms', value: 'Private' },
        { label: 'Pricing', value: 'Inventory-aware' },
        { label: 'Ownership', value: 'Position NFT' }
      ]
    }));
    if (!accepted) return;
    await strategyAction.create({
      family: 'Aggregate',
      pair: successorPair,
      amountBySymbol: { [selectedPair[0]]: baseAmount, [selectedPair[1]]: quoteAmount },
      startingPrice: canonicalStartingPrice,
      totalSpreadPercent: numericSpread
    });
  };

  return (
    <>
      <section className="dex-v2-pool-composer" aria-label="Private Pool creation">
        <section className="dex-v2-pool-section dex-v2-pool-range-section">
          <header><h2>Starting price</h2><span>{displayedQuoteSymbol} per {displayedBaseSymbol}</span></header>
          <label className="dex-v2-limit-price-field">
            <span><span>Reference price</span><button type="button" onClick={useMarketPrice}>Use market</button></span>
            <input
              aria-label={`Starting price (${displayedQuoteSymbol} per ${displayedBaseSymbol})`}
              aria-invalid={!validStartingPrice}
              inputMode="decimal"
              value={startingPriceInput}
              onChange={(event) => updateStartingPrice(event.target.value)}
            />
            <div className="dex-v2-limit-price-summary">
              <strong>Market reference {displayedMarket.toFixed(4)}</strong>
              <span>Editable before creation and through owner reprice.</span>
            </div>
          </label>
          {!validStartingPrice ? <p className="dex-v2-pool-error">Enter a starting price above 0.</p> : null}
        </section>
        <section className="dex-v2-pool-section dex-v2-pool-fee-section">
          <header><h2>Pool spread</h2><Info size={15} aria-label="Total private maker spread" /></header>
          <div className="dex-v2-pool-fee-row">
            <div className="dex-v2-pool-segmented" role="group" aria-label="Total pool spread">
              {['0', '0.30', '0.50', '1.00'].map((spread) => <button key={spread} type="button" className={spreadInput === spread ? 'active' : undefined} aria-pressed={spreadInput === spread} onClick={() => setSpreadInput(spread)}>{spread}%</button>)}
            </div>
            <label className="dex-v2-pool-custom-fee active">
              <span>Custom</span>
              <input aria-label="Custom total spread" aria-invalid={!validSpread} inputMode="decimal" value={spreadInput} onChange={(event) => setSpreadInput(normalizeAmountInput(event.target.value))} />
              <b>%</b>
            </label>
          </div>
          {validSpread && validStartingPrice ? <dl className="dex-v2-position-overview-grid">
            <div><dt>Sell {displayedBaseSymbol} marginal</dt><dd>{displayedBid.toFixed(4)} {displayedQuoteSymbol}</dd></div>
            <div><dt>Buy {displayedBaseSymbol} marginal</dt><dd>{displayedAsk.toFixed(4)} {displayedQuoteSymbol}</dd></div>
          </dl> : <p className="dex-v2-pool-error">Spread must be between 0% and 20%.</p>}
          <p className="dex-v2-activation-note">Spread is maker economics. The protocol fee is applied separately by the Core.</p>
        </section>
        <section className="dex-v2-pool-section dex-v2-pool-amounts-section">
          <header><h2>Private budgets</h2><Info size={15} aria-label="Initial private token budgets" /></header>
          <PoolAmountField amount={quoteAmount} balanceLabel={balances.quoteLabel} label="Initial budget" onAmountChange={setQuoteAmount} onMaxAmount={() => setQuoteAmount(maxBudget(balances.quoteBalanceWei, quoteToken))} maxDisabled={balances.status !== 'ready'} onRevealBalance={() => { void balances.reveal(); }} symbol={selectedPair[1]} />
          <span className="dex-v2-pool-plus"><Plus size={15} aria-hidden="true" /></span>
          <PoolAmountField amount={baseAmount} balanceLabel={balances.baseLabel} label="Initial budget" onAmountChange={setBaseAmount} onMaxAmount={() => setBaseAmount(maxBudget(balances.baseBalanceWei, baseToken))} maxDisabled={balances.status !== 'ready'} onRevealBalance={() => { void balances.reveal(); }} symbol={selectedPair[0]} />
          {!validBudgets ? <p className="dex-v2-pool-error">Enter a positive amount in the token's exact settlement-lot increment.</p> : null}
        </section>
        <div className="dex-v2-limit-privacy"><LockKeyhole size={21} aria-hidden="true" /><span><strong>Private by design</strong><small>Price, spread, budgets, and inventory stay encrypted.</small></span><ShieldCheck size={20} aria-hidden="true" /></div>
        <button className="dex-v2-review-button" type="button" disabled={!validStartingPrice || !validSpread || !validBudgets || !successorSupported || strategyAction.busy} onClick={() => { void reviewPoolDesign(); }}><span>Review private pool</span><ArrowRight size={21} aria-hidden="true" /></button>
        <p className="dex-v2-activation-note" role="status">{strategyAction.message || balances.message || (successorSupported ? 'Ready for the corrected Aggregate admission ABI.' : 'No verified Aggregate admission capacity remains for this pair.')}</p>
      </section>
      <TradeActionConfirmModal confirmation={confirmation} onCancel={() => resolveConfirmation(false)} onConfirm={() => resolveConfirmation(true)} />
    </>
  );
}


export function LimitWorkspace({
  limitCanonicalPrice,
  onLimitPriceChange,
  onSuccessorRefresh = () => undefined,
  onShowMarketChart,
  priceDisplayInverted = false,
  selectedPair = ['BCN', 'HBR'],
  successor = Object.freeze({ status: 'loading' } as const),
  sharedWalletSession
}: {
  limitCanonicalPrice: number;
  onLimitPriceChange: (canonicalPrice: number) => void;
  onSuccessorRefresh?: () => void;
  onShowMarketChart?: () => void;
  priceDisplayInverted?: boolean;
  selectedPair?: TradingPair;
  successor?: SuccessorDexRuntimeState;
  sharedWalletSession?: SharedWalletSession;
}) {
  const [orderFamily, setOrderFamily] = useState<'Fixed' | 'Range'>('Fixed');
  const [makerSide, setMakerSide] = useState<'sell-base' | 'sell-quote'>('sell-quote');
  const [minimumFillPercent, setMinimumFillPercent] = useState('25');
  const [inventoryAmount, setInventoryAmount] = useState('900');
  const [inventoryTouched, setInventoryTouched] = useState(false);
  const [limitPriceTouched, setLimitPriceTouched] = useState(false);
  const [reviewStatus] = useState('');
  const balances = useDexV2TokenBalances({ runtime: successor, selectedPair, sharedWalletSession });
  const strategyAction = useSuccessorStrategyAction({ runtime: successor, sharedWalletSession, refresh: onSuccessorRefresh });
  const successorPair = successor.status === 'ready' ? successor.manifest.pairs.find((pair) => pair.displayPair === selectedPair.join('/')) : null;
  const successorSupported = successor.status === 'ready' &&
    successorDexAdmissionAvailable(successor.snapshot, selectedPair.join('/'), orderFamily);
  const { confirmation, requestConfirmation, resolveConfirmation } = useTradeActionConfirmationState();
  const sellSymbol = makerSide === 'sell-base' ? selectedPair[0] : selectedPair[1];
  const receiveSymbol = makerSide === 'sell-base' ? selectedPair[1] : selectedPair[0];
  const buyBase = makerSide === 'sell-quote';
  const canonicalSide: TradeActionSide = buyBase ? 'buy' : 'sell';
  const displayedSide = resolveDisplayedTradeActionSide(canonicalSide, priceDisplayInverted);
  const displayedPrice = priceDisplayInverted ? 1 / limitCanonicalPrice : limitCanonicalPrice;
  const displayedBaseSymbol = priceDisplayInverted ? selectedPair[1] : selectedPair[0];
  const displayedQuoteSymbol = priceDisplayInverted ? selectedPair[0] : selectedPair[1];
  const formattedDisplayedPrice = displayedPrice.toFixed(4);
  const referencePrice = successorPairReferencePrice(selectedPair);
  const displayedReferencePrice = priceDisplayInverted ? 1 / referencePrice : referencePrice;
  const [limitPriceDraft, setLimitPriceDraft] = useState(formattedDisplayedPrice);
  const [limitPriceEditing, setLimitPriceEditing] = useState(false);
  const [rangeEndCanonicalPrice, setRangeEndCanonicalPrice] = useState(limitCanonicalPrice);
  const [rangeEndPriceDraft, setRangeEndPriceDraft] = useState(formattedDisplayedPrice);
  const limitPriceContextId = useId();
  const limitPriceErrorId = useId();
  const numericInventory = Number(inventoryAmount);
  const numericLimitPriceDraft = Number(limitPriceDraft);
  const successorSoldToken = successor.status === 'ready'
    ? successor.manifest.tokens.find(({ symbol }) => symbol === sellSymbol)
    : null;
  const inventoryNumericValid = Number.isFinite(numericInventory) && numericInventory > 0;
  const inventoryValid = inventoryNumericValid && (
    !successorSoldToken || isExactSuccessorStrategyBudget(inventoryAmount, successorSoldToken)
  );
  const inventoryError = !inventoryNumericValid
    ? 'Enter an amount greater than 0.'
    : successorSoldToken && !inventoryValid
      ? `Enter an exact ${successorSoldToken.symbol} settlement-lot multiple.`
      : undefined;
  const limitPriceValid = Number.isFinite(numericLimitPriceDraft) && numericLimitPriceDraft > 0;
  const rangeEndPriceValid = Number.isFinite(Number(rangeEndPriceDraft)) && Number(rangeEndPriceDraft) > 0;
  const receiveAmount = inventoryValid
    ? (buyBase ? numericInventory / limitCanonicalPrice : numericInventory * limitCanonicalPrice).toFixed(2)
    : '—';
  const marketDistance = (displayedPrice / displayedReferencePrice - 1) * 100;
  const marketRelation = Math.abs(marketDistance) < 0.005
    ? 'At market'
    : `${Math.abs(marketDistance).toFixed(2)}% ${marketDistance > 0 ? 'above' : 'below'} market`;
  const balanceAmount = sellSymbol === selectedPair[0] ? balances.baseLabel : balances.quoteLabel;
  const balanceActionLabel = balances.status === 'ready'
    ? `Available: ${balanceAmount} ${sellSymbol}`
    : balances.status === 'loading'
      ? 'Reading balance…'
      : balances.status === 'error'
        ? 'Try balance again'
        : sharedWalletSession?.walletAddress.trim()
          ? 'Unlock balance'
          : 'Connect to view balance';

  useEffect(() => {
    if (!limitPriceEditing && limitPriceValid) setLimitPriceDraft(formattedDisplayedPrice);
  }, [formattedDisplayedPrice, limitPriceEditing, limitPriceValid]);

  const defaultRangeEnd = (sold: string, start = limitCanonicalPrice) => {
    if (!successorPair || successor.status !== 'ready') return start;
    const soldAddress = successor.manifest.tokens.find(({ symbol }) => symbol === sold)?.address.toLowerCase();
    const displayBaseAddress = successor.manifest.tokens.find(({ symbol }) => symbol === selectedPair[0])?.address.toLowerCase();
    if (!soldAddress || !displayBaseAddress) return start;
    const increases = (displayBaseAddress === successorPair.token0.toLowerCase()) ===
      (soldAddress === successorPair.token1.toLowerCase());
    return start * (increases ? 1.05 : 0.95);
  };
  const setDefaultRangeEnd = (sold: string, start = limitCanonicalPrice) => {
    const canonical = defaultRangeEnd(sold, start);
    setRangeEndCanonicalPrice(canonical);
    setRangeEndPriceDraft((priceDisplayInverted ? 1 / canonical : canonical).toFixed(4));
  };
  const rangeDirectionValid = (() => {
    const expected = defaultRangeEnd(sellSymbol, 1) > 1 ? 'increase' : 'decrease';
    return expected === 'increase'
      ? rangeEndCanonicalPrice >= limitCanonicalPrice
      : rangeEndCanonicalPrice <= limitCanonicalPrice;
  })();

  const updateLimitPrice = (nextDraft: string) => {
    setLimitPriceDraft(nextDraft);
    const nextDisplayedPrice = Number(nextDraft);
    if (Number.isFinite(nextDisplayedPrice) && nextDisplayedPrice > 0) {
      onLimitPriceChange(priceDisplayInverted ? 1 / nextDisplayedPrice : nextDisplayedPrice);
    }
  };
  const commitLimitPrice = () => {
    const nextDisplayedPrice = Number(limitPriceDraft);
    if (Number.isFinite(nextDisplayedPrice) && nextDisplayedPrice > 0) {
      const canonical = priceDisplayInverted ? 1 / nextDisplayedPrice : nextDisplayedPrice;
      onLimitPriceChange(canonical);
      setLimitPriceDraft(nextDisplayedPrice.toFixed(4));
      if (orderFamily === 'Range') setDefaultRangeEnd(sellSymbol, canonical);
    }
    setLimitPriceTouched(true);
    setLimitPriceEditing(false);
  };
  const selectSide = (nextDisplayedSide: TradeActionSide) => {
    const nextCanonicalSide = resolveCanonicalTradeActionSide(nextDisplayedSide, priceDisplayInverted);
    const nextMakerSide = nextCanonicalSide === 'buy' ? 'sell-quote' : 'sell-base';
    setMakerSide(nextMakerSide);
    setInventoryAmount('900');
    setInventoryTouched(false);
    if (orderFamily === 'Range') {
      const nextSold = nextMakerSide === 'sell-base' ? selectedPair[0] : selectedPair[1];
      setDefaultRangeEnd(nextSold);
    }
  };
  const updateRangeEndPrice = (value: string) => {
    setRangeEndPriceDraft(value);
    const displayed = Number(value);
    if (Number.isFinite(displayed) && displayed > 0) {
      setRangeEndCanonicalPrice(priceDisplayInverted ? 1 / displayed : displayed);
    }
  };
  const reviewLimit = async () => {
    const accepted = await requestConfirmation(Object.freeze({
      title: `Review private ${orderFamily.toLowerCase()}`,
      message: 'Partial fills leave the remaining liquidity in the order. Your wallet signs the encrypted admission after review.',
      primaryLabel: `Create private ${orderFamily.toLowerCase()}`,
      secondaryLabel: null,
      fundingMoves: [],
      summaryRows: [
        { label: 'Action', value: `${displayedSide === 'buy' ? 'Buy' : 'Sell'} ${displayedBaseSymbol}` },
        { label: 'Fund', value: `${inventoryAmount || '0'} ${sellSymbol}` },
        { label: 'Limit price', value: `${displayedPrice.toFixed(4)} ${displayedQuoteSymbol} per ${displayedBaseSymbol}` },
        ...(orderFamily === 'Range' ? [{ label: 'End marginal price', value: `${Number(rangeEndPriceDraft).toFixed(4)} ${displayedQuoteSymbol} per ${displayedBaseSymbol}` }] : []),
        { label: 'Receive at full fill', value: `${receiveAmount} ${receiveSymbol}` },
        { label: 'Minimum fill', value: minimumFillPercent === '0' ? 'Any executable amount' : `At least ${minimumFillPercent}%` }
      ],
      stats: [
        { label: 'Status', value: 'Ready to create' },
        { label: 'Privacy', value: 'Price + amount private' },
        { label: 'Wallet', value: 'Signature required' }
      ]
    }));
    if (accepted && successorPair && successor.status === 'ready') {
      const common = {
        pair: successorPair,
        soldSymbol: sellSymbol,
        inventory: inventoryAmount || '0',
        minimumOutputPercent: Number(minimumFillPercent) as 0 | 25 | 50 | 100
      } as const;
      await strategyAction.create(orderFamily === 'Fixed'
        ? { ...common, family: 'Fixed', price: limitCanonicalPrice }
        : { ...common, family: 'Range', startPrice: limitCanonicalPrice, endPrice: rangeEndCanonicalPrice });
    }
  };

  return (
    <>
      <section className="dex-v2-limit-composer" aria-label="Private Limit creation">
        <header className="dex-v2-composer-heading">
          <span className="dex-v2-composer-eyebrow">Private Limit</span>
          <h1>{displayedSide === 'buy' ? 'Buy' : 'Sell'} {displayedBaseSymbol}</h1>
          <p>Fund {sellSymbol} · receive {receiveSymbol} at your limit.</p>
        </header>
        <div className="dex-v2-buy-sell-tabs" role="tablist" aria-label="Limit strategy type">
          {(['Fixed', 'Range'] as const).map((family) => <button
            key={family}
            type="button"
            role="tab"
            aria-selected={orderFamily === family}
            className={orderFamily === family ? 'active' : undefined}
            onClick={() => {
              setOrderFamily(family);
              if (family === 'Range') setDefaultRangeEnd(sellSymbol);
            }}
          >{family}</button>)}
        </div>
        <div className="dex-v2-buy-sell-tabs" role="tablist" aria-label="Limit direction">
          <button type="button" role="tab" aria-selected={displayedSide === 'buy'} className={displayedSide === 'buy' ? 'active' : undefined} onClick={() => selectSide('buy')}>Buy {displayedBaseSymbol}</button>
          <button type="button" role="tab" aria-selected={displayedSide === 'sell'} className={displayedSide === 'sell' ? 'active' : undefined} onClick={() => selectSide('sell')}>Sell {displayedBaseSymbol}</button>
        </div>
        <div className="dex-v2-limit-fields">
          <TokenAmountField
            balanceLabel={balanceActionLabel}
            errorMessage={inventoryTouched ? inventoryError : undefined}
            label="Fund"
            symbol={sellSymbol}
            amount={inventoryAmount}
            onBalanceAction={balances.status === 'loading' ? undefined : () => { void balances.reveal(); }}
            onBlur={() => setInventoryTouched(true)}
            onAmountChange={setInventoryAmount}
            onMaxAmount={() => setInventoryAmount(balanceAmount)}
            maxDisabled={balances.status !== 'ready'}
          />
          <label className="dex-v2-limit-price-field">
            <span><span>Limit price</span><small>{displayedQuoteSymbol} per {displayedBaseSymbol}</small></span>
            <input
              aria-label="Limit price"
              aria-describedby={limitPriceTouched && !limitPriceValid ? `${limitPriceContextId} ${limitPriceErrorId}` : limitPriceContextId}
              aria-invalid={limitPriceTouched && !limitPriceValid}
              inputMode="decimal"
              value={limitPriceDraft}
              onFocus={() => setLimitPriceEditing(true)}
              onChange={(event) => updateLimitPrice(event.target.value)}
              onBlur={commitLimitPrice}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
            <div className="dex-v2-limit-price-summary" id={limitPriceContextId}>
              <strong>1 {displayedBaseSymbol} = {displayedPrice.toFixed(4)} {displayedQuoteSymbol}</strong>
              <span>{marketRelation}</span>
            </div>
            {limitPriceTouched && !limitPriceValid
              ? <small className="dex-v2-field-error" id={limitPriceErrorId} role="alert">Enter a price greater than 0.</small>
              : null}
            {onShowMarketChart ? (
              <button className="dex-v2-limit-chart-link" type="button" onClick={onShowMarketChart}>
                <ChartNoAxesCombined size={16} aria-hidden="true" />
                <span>Show market chart</span>
              </button>
            ) : null}
          </label>
          {orderFamily === 'Range' ? <label className="dex-v2-limit-price-field">
            <span><span>End marginal price</span><small>{displayedQuoteSymbol} per {displayedBaseSymbol}</small></span>
            <input
              aria-label="Range end marginal price"
              aria-invalid={!rangeEndPriceValid || !rangeDirectionValid}
              inputMode="decimal"
              value={rangeEndPriceDraft}
              onChange={(event) => updateRangeEndPrice(event.target.value)}
              onBlur={() => {
                const displayed = Number(rangeEndPriceDraft);
                if (Number.isFinite(displayed) && displayed > 0) setRangeEndPriceDraft(displayed.toFixed(4));
              }}
            />
            <div className="dex-v2-limit-price-summary">
              <strong>Private range boundary</strong>
              <span>{rangeDirectionValid ? 'Valid for the funded side' : 'Move the end price in the opposite direction'}</span>
            </div>
          </label> : null}
          <TokenAmountField
            balanceLabel="Indicative · partial fills possible"
            label="Receive if fully filled"
            symbol={receiveSymbol}
            amount={receiveAmount}
            readOnly
          />
        </div>
        <details className="dex-v2-limit-advanced">
          <summary><span>Advanced</span><span>Minimum fill · {minimumFillPercent === '0' ? 'Any' : `${minimumFillPercent}%`} <ChevronDown size={17} aria-hidden="true" /></span></summary>
          <label>
            <span>Minimum fill</span>
            <select value={minimumFillPercent} onChange={(event) => setMinimumFillPercent(event.target.value)}>
              <option value="0">Any executable amount</option>
              <option value="25">25%</option>
              <option value="50">50%</option>
              <option value="100">100%</option>
            </select>
          </label>

        </details>
        <div className="dex-v2-limit-privacy">
          <LockKeyhole size={21} aria-hidden="true" />
          <span><strong>Private by design</strong><small>Price, amount, and activity stay private.</small></span>
          <ShieldCheck size={20} aria-hidden="true" />
        </div>
        <button
          className="dex-v2-review-button"
          type="button"
          disabled={!inventoryValid || !limitPriceValid || (orderFamily === 'Range' && (!rangeEndPriceValid || !rangeDirectionValid)) || !successorSupported || strategyAction.busy}
          onClick={() => { void reviewLimit(); }}
        >
          <span>Review private {orderFamily.toLowerCase()}</span>
          <ArrowRight size={21} aria-hidden="true" />
        </button>
        <p className="dex-v2-activation-note" role="status">{strategyAction.message || reviewStatus || balances.message || (successorSupported ? 'Ready to create on COTI Testnet.' : `No verified ${orderFamily} admission capacity remains for this pair.`)}</p>
      </section>
      <TradeActionConfirmModal confirmation={confirmation} onCancel={() => resolveConfirmation(false)} onConfirm={() => resolveConfirmation(true)} />
    </>
  );
}

export function RecurringWorkspace({
  onPricePreviewChange,
  onSuccessorRefresh = () => undefined,
  onShowMarketChart,
  priceDisplayInverted = false,
  selectedPair = ['BCN', 'HBR'],
  successor = Object.freeze({ status: 'loading' } as const),
  sharedWalletSession
}: {
  onPricePreviewChange?: (preview: { buyPrice: number; sellPrice: number }) => void;
  onSuccessorRefresh?: () => void;
  onShowMarketChart?: () => void;
  priceDisplayInverted?: boolean;
  selectedPair?: TradingPair;
  successor?: SuccessorDexRuntimeState;
  sharedWalletSession?: SharedWalletSession;
}) {
  const formatDisplayedRecurringPrice = (canonicalPrice: number, inverted = priceDisplayInverted) =>
    (inverted ? 1 / canonicalPrice : canonicalPrice).toFixed(4);
  const referencePrice = successorPairReferencePrice(selectedPair);
  const displayedReferencePrice = priceDisplayInverted ? 1 / referencePrice : referencePrice;
  const [recurringClass, setRecurringClass] = useState<'LL' | 'RR'>('LL');
  const [buyPriceInput, setBuyPriceInput] = useState(() => formatDisplayedRecurringPrice(referencePrice * 0.95));
  const [sellPriceInput, setSellPriceInput] = useState(() => formatDisplayedRecurringPrice(referencePrice * 1.05));
  const [buyEndPriceInput, setBuyEndPriceInput] = useState(() => formatDisplayedRecurringPrice(referencePrice));
  const [sellEndPriceInput, setSellEndPriceInput] = useState(() => formatDisplayedRecurringPrice(referencePrice));
  const committedBuyPriceInput = useRef(buyPriceInput);
  const committedSellPriceInput = useRef(sellPriceInput);
  const committedBuyEndPriceInput = useRef(buyEndPriceInput);
  const committedSellEndPriceInput = useRef(sellEndPriceInput);
  const [baseAmount, setBaseAmount] = useState('900');
  const [quoteAmount, setQuoteAmount] = useState('900');
  const [baseAmountTouched, setBaseAmountTouched] = useState(false);
  const [quoteAmountTouched, setQuoteAmountTouched] = useState(false);
  const [customBand, setCustomBand] = useState(false);
  const [reviewStatus] = useState('');
  const balances = useDexV2TokenBalances({ runtime: successor, selectedPair, sharedWalletSession });
  const strategyAction = useSuccessorStrategyAction({ runtime: successor, sharedWalletSession, refresh: onSuccessorRefresh });
  const successorPair = successor.status === 'ready' ? successor.manifest.pairs.find((pair) => pair.displayPair === selectedPair.join('/')) : null;
  const successorSupported = successor.status === 'ready' &&
    successorDexAdmissionAvailable(successor.snapshot, selectedPair.join('/'), 'Recurring');
  const priceInputsAreInverted = useRef(priceDisplayInverted);
  const inventoryHelpId = useId();
  const { confirmation, requestConfirmation, resolveConfirmation } = useTradeActionConfirmationState();
  const displayedBuyPrice = Number(buyPriceInput);
  const displayedSellPrice = Number(sellPriceInput);
  const displayedBuyEndPrice = Number(buyEndPriceInput);
  const displayedSellEndPrice = Number(sellEndPriceInput);
  const buyPrice = priceInputsAreInverted.current ? 1 / displayedBuyPrice : displayedBuyPrice;
  const sellPrice = priceInputsAreInverted.current ? 1 / displayedSellPrice : displayedSellPrice;
  const buyEndPrice = priceInputsAreInverted.current ? 1 / displayedBuyEndPrice : displayedBuyEndPrice;
  const sellEndPrice = priceInputsAreInverted.current ? 1 / displayedSellEndPrice : displayedSellEndPrice;
  const displayedBaseSymbol = priceDisplayInverted ? selectedPair[1] : selectedPair[0];
  const displayedQuoteSymbol = priceDisplayInverted ? selectedPair[0] : selectedPair[1];
  const displayedBuyLegSide = resolveDisplayedTradeActionSide('buy', priceDisplayInverted);
  const displayedSellLegSide = resolveDisplayedTradeActionSide('sell', priceDisplayInverted);
  const buyLegLabel = `${displayedBuyLegSide === 'buy' ? 'Buy' : 'Sell'} ${displayedBaseSymbol}`;
  const sellLegLabel = `${displayedSellLegSide === 'buy' ? 'Buy' : 'Sell'} ${displayedBaseSymbol}`;
  const ratioLabel = displayedQuoteSymbol + ' per ' + displayedBaseSymbol;
  const activeBandPreset = customBand ? 'custom' : RECURRING_PRICE_PRESETS.find((preset) => {
    const expectedBuy = Number(formatDisplayedRecurringPrice(referencePrice * (1 - preset.distance)));
    const expectedSell = Number(formatDisplayedRecurringPrice(referencePrice * (1 + preset.distance)));
    return Math.abs(displayedBuyPrice - expectedBuy) < 0.00005 && Math.abs(displayedSellPrice - expectedSell) < 0.00005;
  })?.id ?? 'custom';
  const quoteInventoryRole = displayedBuyLegSide === 'buy' ? 'Buy budget' : 'Sell inventory';
  const baseInventoryRole = displayedSellLegSide === 'buy' ? 'Buy budget' : 'Sell inventory';
  const numericQuoteAmount = Number(quoteAmount);
  const numericBaseAmount = Number(baseAmount);
  const successorBaseToken = successor.status === 'ready'
    ? successor.manifest.tokens.find(({ symbol }) => symbol === selectedPair[0])
    : null;
  const successorQuoteToken = successor.status === 'ready'
    ? successor.manifest.tokens.find(({ symbol }) => symbol === selectedPair[1])
    : null;
  const quoteAmountValid = quoteAmount === '' || (successorQuoteToken
    ? isExactSuccessorStrategyBudget(quoteAmount, successorQuoteToken, true)
    : Number.isFinite(numericQuoteAmount) && numericQuoteAmount >= 0);
  const baseAmountValid = baseAmount === '' || (successorBaseToken
    ? isExactSuccessorStrategyBudget(baseAmount, successorBaseToken, true)
    : Number.isFinite(numericBaseAmount) && numericBaseAmount >= 0);
  const inventoryFieldsValid = quoteAmountValid && baseAmountValid;
  const hasStartingInventory = (Number.isFinite(numericQuoteAmount) && numericQuoteAmount > 0) ||
    (Number.isFinite(numericBaseAmount) && numericBaseAmount > 0);
  const pricesAreValid = Number.isFinite(buyPrice) && buyPrice > 0 && buyPrice < referencePrice &&
    Number.isFinite(sellPrice) && sellPrice > referencePrice && buyPrice < sellPrice;
  const buyPriceIsValid = Number.isFinite(buyPrice) && buyPrice > 0 && buyPrice < referencePrice && buyPrice < sellPrice;
  const sellPriceIsValid = Number.isFinite(sellPrice) && sellPrice > referencePrice && buyPrice < sellPrice;
  const buyEndPriceIsValid = Number.isFinite(buyEndPrice) && buyEndPrice > 0 && buyEndPrice >= buyPrice;
  const sellEndPriceIsValid = Number.isFinite(sellEndPrice) && sellEndPrice > 0 && sellEndPrice <= sellPrice;
  const rangePricesAreValid = recurringClass === 'LL' || (buyEndPriceIsValid && sellEndPriceIsValid);
  const quoteReceivePreview = Number.isFinite(numericQuoteAmount) && numericQuoteAmount > 0 && buyPriceIsValid
    ? (numericQuoteAmount / buyPrice).toFixed(2)
    : '—';
  const baseReceivePreview = Number.isFinite(numericBaseAmount) && numericBaseAmount > 0 && sellPriceIsValid
    ? (numericBaseAmount * sellPrice).toFixed(2)
    : '—';
  const buyMarketDistance = Number.isFinite(displayedBuyPrice) ? (displayedBuyPrice / displayedReferencePrice - 1) * 100 : 0;
  const sellMarketDistance = Number.isFinite(displayedSellPrice) ? (displayedSellPrice / displayedReferencePrice - 1) * 100 : 0;
  const inventoryTouched = quoteAmountTouched || baseAmountTouched;
  const inventoryError = !inventoryFieldsValid
    ? 'Enter exact settlement-lot multiples for both tokens.'
    : inventoryTouched && !hasStartingInventory
      ? 'Fund at least one side to start the strategy.'
      : '';
  const balanceActionText = (balanceLabel: string, symbol: string) => balances.status === 'ready'
    ? `Available: ${balanceLabel} ${symbol}`
    : balances.status === 'error'
      ? 'Try balance again'
      : sharedWalletSession?.walletAddress.trim()
        ? 'Unlock balance'
        : 'Connect to view balance';
  const balanceActionAriaLabel = (symbol: string) => balances.status === 'ready'
    ? `Refresh ${symbol} balance`
    : balances.status === 'error'
      ? `Retry ${symbol} balance`
      : sharedWalletSession?.walletAddress.trim()
        ? `Unlock ${symbol} balance`
        : `Connect wallet to view ${symbol} balance`;

  useEffect(() => {
    if (priceInputsAreInverted.current === priceDisplayInverted) return;
    const invertInput = (value: string) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric > 0 ? (1 / numeric).toFixed(4) : value;
    };
    const nextBuy = invertInput(committedBuyPriceInput.current);
    const nextSell = invertInput(committedSellPriceInput.current);
    const nextBuyEnd = invertInput(committedBuyEndPriceInput.current);
    const nextSellEnd = invertInput(committedSellEndPriceInput.current);
    committedBuyPriceInput.current = nextBuy;
    committedSellPriceInput.current = nextSell;
    committedBuyEndPriceInput.current = nextBuyEnd;
    committedSellEndPriceInput.current = nextSellEnd;
    setBuyPriceInput(nextBuy);
    setSellPriceInput(nextSell);
    setBuyEndPriceInput(nextBuyEnd);
    setSellEndPriceInput(nextSellEnd);
    setCustomBand(true);
    priceInputsAreInverted.current = priceDisplayInverted;
  }, [priceDisplayInverted]);

  useEffect(() => {
    if (pricesAreValid) onPricePreviewChange?.({ buyPrice, sellPrice });
  }, [buyPrice, onPricePreviewChange, pricesAreValid, sellPrice]);

  useEffect(() => {
    const nextBuy = formatDisplayedRecurringPrice(referencePrice * 0.95);
    const nextSell = formatDisplayedRecurringPrice(referencePrice * 1.05);
    const nextRangeEnd = formatDisplayedRecurringPrice(referencePrice);
    committedBuyPriceInput.current = nextBuy;
    committedSellPriceInput.current = nextSell;
    committedBuyEndPriceInput.current = nextRangeEnd;
    committedSellEndPriceInput.current = nextRangeEnd;
    setBuyPriceInput(nextBuy);
    setSellPriceInput(nextSell);
    setBuyEndPriceInput(nextRangeEnd);
    setSellEndPriceInput(nextRangeEnd);
    setCustomBand(false);
  }, [referencePrice]);

  const applyPricePreset = (distance: number) => {
    const nextBuy = formatDisplayedRecurringPrice(referencePrice * (1 - distance));
    const nextSell = formatDisplayedRecurringPrice(referencePrice * (1 + distance));
    const nextRangeEnd = formatDisplayedRecurringPrice(referencePrice);
    committedBuyPriceInput.current = nextBuy;
    committedSellPriceInput.current = nextSell;
    committedBuyEndPriceInput.current = nextRangeEnd;
    committedSellEndPriceInput.current = nextRangeEnd;
    setBuyPriceInput(nextBuy);
    setSellPriceInput(nextSell);
    setBuyEndPriceInput(nextRangeEnd);
    setSellEndPriceInput(nextRangeEnd);
    priceInputsAreInverted.current = priceDisplayInverted;
    setCustomBand(false);
  };

  const normalizeRecurringPrice = (value: string) => {
    if (!/^\d*(?:\.\d{0,6})?$/.test(value)) return null;
    return value.replace(/^0+(?=\d)/, '');
  };
  const rememberValidRecurringPair = (nextBuyInput: string, nextSellInput: string) => {
    const nextDisplayedBuy = Number(nextBuyInput);
    const nextDisplayedSell = Number(nextSellInput);
    const nextBuy = priceDisplayInverted ? 1 / nextDisplayedBuy : nextDisplayedBuy;
    const nextSell = priceDisplayInverted ? 1 / nextDisplayedSell : nextDisplayedSell;
    if (
      Number.isFinite(nextBuy) && nextBuy > 0 && nextBuy < referencePrice &&
      Number.isFinite(nextSell) && nextSell > referencePrice && nextBuy < nextSell
    ) {
      committedBuyPriceInput.current = nextBuyInput;
      committedSellPriceInput.current = nextSellInput;
    }
  };
  const commitRecurringPricePair = () => {
    if (!pricesAreValid) return;
    const nextBuy = displayedBuyPrice.toFixed(4);
    const nextSell = displayedSellPrice.toFixed(4);
    committedBuyPriceInput.current = nextBuy;
    committedSellPriceInput.current = nextSell;
    setBuyPriceInput(nextBuy);
    setSellPriceInput(nextSell);
  };
  const reviewRecurring = async () => {
    const recurringLabel = recurringClass === 'LL' ? 'Fixed-price recurring' : 'Range recurring';
    const accepted = await requestConfirmation(Object.freeze({
      title: `Review ${recurringLabel.toLowerCase()}`,
      message: `${recurringLabel} moves received liquidity to the opposite leg after each fill. Your wallet signs the encrypted admission after review.`,
      primaryLabel: `Create ${recurringLabel.toLowerCase()}`,
      secondaryLabel: null,
      fundingMoves: [],
      summaryRows: [
        { label: `${buyLegLabel} ${recurringClass === 'LL' ? 'at' : 'range'}`, value: recurringClass === 'LL'
          ? `${displayedBuyPrice.toFixed(4)} ${ratioLabel}`
          : `${displayedBuyPrice.toFixed(4)} → ${displayedBuyEndPrice.toFixed(4)} ${ratioLabel}` },
        { label: `${sellLegLabel} ${recurringClass === 'LL' ? 'at' : 'range'}`, value: recurringClass === 'LL'
          ? `${displayedSellPrice.toFixed(4)} ${ratioLabel}`
          : `${displayedSellPrice.toFixed(4)} → ${displayedSellEndPrice.toFixed(4)} ${ratioLabel}` },
        { label: quoteInventoryRole, value: `${quoteAmount || '0'} ${displayedQuoteSymbol}` },
        { label: baseInventoryRole, value: `${baseAmount || '0'} ${displayedBaseSymbol}` }
      ],
      stats: [
        { label: 'Pricing', value: recurringLabel },
        { label: 'Privacy', value: 'Prices + inventory private' },
        { label: 'Wallet', value: 'Signature required' }
      ]
    }));
    if (accepted && successorPair && successor.status === 'ready') {
      const common = { family: 'Recurring', pair: successorPair, baseSymbol: selectedPair[0], quoteSymbol: selectedPair[1], baseInventory: baseAmount || '0', quoteInventory: quoteAmount || '0', buyPrice, sellPrice } as const;
      await strategyAction.create(recurringClass === 'LL'
        ? { ...common, recurringClass: 'LL' }
        : { ...common, recurringClass: 'RR', buyEndPrice, sellEndPrice });
    }
  };

  return (
    <>
      <section className="dex-v2-recurring-composer" aria-label="Private Recurring creation">
        <header className="dex-v2-composer-heading">
          <div className="dex-v2-recurring-title-row">
            <h1>Private recurring strategy</h1>
            <span>{recurringClass === 'LL' ? 'Fixed-price cycle' : 'Range-backed cycle'}</span>
          </div>
          <p>Choose fixed prices or price ranges for the two private recurring legs.</p>
        </header>
        <div className="dex-v2-buy-sell-tabs" role="tablist" aria-label="Recurring price model">
          <button type="button" role="tab" aria-selected={recurringClass === 'LL'} className={recurringClass === 'LL' ? 'active' : undefined} onClick={() => setRecurringClass('LL')}>Fixed prices (LL)</button>
          <button type="button" role="tab" aria-selected={recurringClass === 'RR'} className={recurringClass === 'RR' ? 'active' : undefined} onClick={() => setRecurringClass('RR')}>Range prices (RR)</button>
        </div>
        <section className="dex-v2-recurring-band" aria-label="Recurring private limit prices">
          <header>
            <span><strong>{recurringClass === 'LL' ? 'Two recurring limit prices' : 'Two recurring price ranges'}</strong><small>{recurringClass === 'LL' ? 'Choose both private prices' : 'Choose start and end prices for both legs'} · {ratioLabel}</small></span>
            <span>Market reference <strong>{displayedReferencePrice.toFixed(4)}</strong></span>
          </header>
          <div className="dex-v2-recurring-presets" role="group" aria-label="Recurring price spacing preset">
            {RECURRING_PRICE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={activeBandPreset === preset.id ? 'active' : undefined}
                aria-pressed={activeBandPreset === preset.id}
                onClick={() => applyPricePreset(preset.distance)}
              >
                {preset.label}
              </button>
            ))}
            <button type="button" className={activeBandPreset === 'custom' ? 'active' : undefined} aria-pressed={activeBandPreset === 'custom'} onClick={() => setCustomBand(true)}>Custom</button>
          </div>
          <div className="dex-v2-recurring-price-grid">
            <label className={displayedBuyLegSide}>
              <span><strong>{buyLegLabel}</strong><small>Spend {displayedQuoteSymbol} · receive {displayedBaseSymbol}</small></span>
              <div className={`dex-v2-recurring-price-input${buyPriceIsValid ? '' : ' invalid'}`}>
                <input
                  aria-label={`${buyLegLabel} recurring ${recurringClass === 'RR' ? 'start ' : ''}price`}
                  aria-describedby="dex-v2-recurring-price-guidance"
                  aria-invalid={!buyPriceIsValid}
                  inputMode="decimal"
                  value={buyPriceInput}
                  onChange={(event) => {
                    const next = normalizeRecurringPrice(event.target.value);
                    if (next !== null) {
                      setBuyPriceInput(next);
                      rememberValidRecurringPair(next, sellPriceInput);
                      priceInputsAreInverted.current = priceDisplayInverted;
                      setCustomBand(true);
                    }
                  }}
                  onBlur={commitRecurringPricePair}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
                <span>{displayedQuoteSymbol}</span>
              </div>
              <em>{buyPriceIsValid ? `${buyMarketDistance > 0 ? '+' : ''}${buyMarketDistance.toFixed(2)}% from market` : 'Must remain on its side of market'}</em>
              {recurringClass === 'RR' ? <>
                <div className={`dex-v2-recurring-price-input${buyEndPriceIsValid ? '' : ' invalid'}`}>
                  <input
                    aria-label={`${buyLegLabel} recurring end price`}
                    aria-describedby="dex-v2-recurring-price-guidance"
                    aria-invalid={!buyEndPriceIsValid}
                    inputMode="decimal"
                    value={buyEndPriceInput}
                    onChange={(event) => {
                      const next = normalizeRecurringPrice(event.target.value);
                      if (next !== null) {
                        committedBuyEndPriceInput.current = next;
                        setBuyEndPriceInput(next);
                        priceInputsAreInverted.current = priceDisplayInverted;
                      }
                    }}
                    onBlur={() => {
                      if (!Number.isFinite(displayedBuyEndPrice) || displayedBuyEndPrice <= 0) return;
                      const next = displayedBuyEndPrice.toFixed(4);
                      committedBuyEndPriceInput.current = next;
                      setBuyEndPriceInput(next);
                    }}
                  />
                  <span>{displayedQuoteSymbol}</span>
                </div>
                <em>{buyEndPriceIsValid ? 'Valid end marginal price' : 'End must move toward a higher canonical price'}</em>
              </> : null}
            </label>
            <label className={displayedSellLegSide}>
              <span><strong>{sellLegLabel}</strong><small>Spend {displayedBaseSymbol} · receive {displayedQuoteSymbol}</small></span>
              <div className={`dex-v2-recurring-price-input${sellPriceIsValid ? '' : ' invalid'}`}>
                <input
                  aria-label={`${sellLegLabel} recurring ${recurringClass === 'RR' ? 'start ' : ''}price`}
                  aria-describedby="dex-v2-recurring-price-guidance"
                  aria-invalid={!sellPriceIsValid}
                  inputMode="decimal"
                  value={sellPriceInput}
                  onChange={(event) => {
                    const next = normalizeRecurringPrice(event.target.value);
                    if (next !== null) {
                      setSellPriceInput(next);
                      rememberValidRecurringPair(buyPriceInput, next);
                      priceInputsAreInverted.current = priceDisplayInverted;
                      setCustomBand(true);
                    }
                  }}
                  onBlur={commitRecurringPricePair}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
                <span>{displayedQuoteSymbol}</span>
              </div>
              <em>{sellPriceIsValid ? `${sellMarketDistance > 0 ? '+' : ''}${sellMarketDistance.toFixed(2)}% from market` : 'Must remain on its side of market'}</em>
              {recurringClass === 'RR' ? <>
                <div className={`dex-v2-recurring-price-input${sellEndPriceIsValid ? '' : ' invalid'}`}>
                  <input
                    aria-label={`${sellLegLabel} recurring end price`}
                    aria-describedby="dex-v2-recurring-price-guidance"
                    aria-invalid={!sellEndPriceIsValid}
                    inputMode="decimal"
                    value={sellEndPriceInput}
                    onChange={(event) => {
                      const next = normalizeRecurringPrice(event.target.value);
                      if (next !== null) {
                        committedSellEndPriceInput.current = next;
                        setSellEndPriceInput(next);
                        priceInputsAreInverted.current = priceDisplayInverted;
                      }
                    }}
                    onBlur={() => {
                      if (!Number.isFinite(displayedSellEndPrice) || displayedSellEndPrice <= 0) return;
                      const next = displayedSellEndPrice.toFixed(4);
                      committedSellEndPriceInput.current = next;
                      setSellEndPriceInput(next);
                    }}
                  />
                  <span>{displayedQuoteSymbol}</span>
                </div>
                <em>{sellEndPriceIsValid ? 'Valid end marginal price' : 'End must move toward a lower canonical price'}</em>
              </> : null}
            </label>
          </div>
          <p id="dex-v2-recurring-price-guidance" className={pricesAreValid && rangePricesAreValid ? 'dex-v2-recurring-price-guidance' : 'dex-v2-recurring-price-guidance invalid'} role="status">
            {!pricesAreValid
              ? 'Place one start price below market and the other above it without crossing the two legs.'
              : recurringClass === 'RR' && !rangePricesAreValid
                ? 'Each end price must move in the valid direction for its funded token.'
                : recurringClass === 'RR'
                  ? 'Both private ranges are valid. Edit any boundary or use a spacing shortcut.'
                  : 'One below market · one above market. Edit either price or use a shortcut.'}
          </p>
          {onShowMarketChart ? (
            <button className="dex-v2-limit-chart-link dex-v2-recurring-chart-link" type="button" onClick={onShowMarketChart}>
              <ChartNoAxesCombined size={16} aria-hidden="true" />
              <span>Show market chart</span>
            </button>
          ) : null}
        </section>
        <section className="dex-v2-recurring-inventory" aria-label="Starting recurring inventory" aria-describedby={inventoryError ? inventoryHelpId : undefined}>
          <header><strong>Starting inventory</strong><small>Fund either side or both.</small></header>
          <div>
            <label>
              <span>{quoteInventoryRole} <small>
                {balances.status === 'loading'
                  ? <span>Reading balance…</span>
                  : <button type="button" className="dex-v2-recurring-balance-action" aria-label={balanceActionAriaLabel(displayedQuoteSymbol)} onClick={() => { void balances.reveal(); }}>{balanceActionText(balances.quoteLabel, displayedQuoteSymbol)}</button>}
                <button type="button" disabled={balances.status !== 'ready'} onClick={() => { setQuoteAmount(balances.quoteLabel); setQuoteAmountTouched(true); }}>Max</button>
              </small></span>
              <div className="dex-v2-recurring-inventory-input">
                <input
                  aria-label={`${quoteInventoryRole} amount`}
                  aria-describedby={inventoryError ? inventoryHelpId : undefined}
                  aria-invalid={quoteAmountTouched && !quoteAmountValid}
                  value={quoteAmount}
                  inputMode="decimal"
                  onBlur={() => setQuoteAmountTouched(true)}
                  onChange={(event) => setQuoteAmount(normalizeAmountInput(event.target.value))}
                />
                <span>{displayedQuoteSymbol}</span>
              </div>
              <em>Receive ≈ <strong>{quoteReceivePreview} {displayedBaseSymbol}</strong></em>
            </label>
            <label>
              <span>{baseInventoryRole} <small>
                {balances.status === 'loading'
                  ? <span>Reading balance…</span>
                  : <button type="button" className="dex-v2-recurring-balance-action" aria-label={balanceActionAriaLabel(displayedBaseSymbol)} onClick={() => { void balances.reveal(); }}>{balanceActionText(balances.baseLabel, displayedBaseSymbol)}</button>}
                <button type="button" disabled={balances.status !== 'ready'} onClick={() => { setBaseAmount(balances.baseLabel); setBaseAmountTouched(true); }}>Max</button>
              </small></span>
              <div className="dex-v2-recurring-inventory-input">
                <input
                  aria-label={`${baseInventoryRole} amount`}
                  aria-describedby={inventoryError ? inventoryHelpId : undefined}
                  aria-invalid={baseAmountTouched && !baseAmountValid}
                  value={baseAmount}
                  inputMode="decimal"
                  onBlur={() => setBaseAmountTouched(true)}
                  onChange={(event) => setBaseAmount(normalizeAmountInput(event.target.value))}
                />
                <span>{displayedBaseSymbol}</span>
              </div>
              <em>Receive ≈ <strong>{baseReceivePreview} {displayedQuoteSymbol}</strong></em>
            </label>
          </div>
          {inventoryError ? <p className="dex-v2-field-error" id={inventoryHelpId} role="alert">{inventoryError}</p> : null}
        </section>
        <div className="dex-v2-recurring-cycle-note">
          <RefreshCw size={17} aria-hidden="true" />
          <span><strong>How it repeats</strong><small>After {buyLegLabel}, received {displayedBaseSymbol} funds {sellLegLabel}. After {sellLegLabel}, received {displayedQuoteSymbol} funds {buyLegLabel}.</small></span>
        </div>
        <div className="dex-v2-limit-privacy">
          <LockKeyhole size={18} aria-hidden="true" />
          <span><strong>Private by design</strong><small>Prices, inventory, fills, and the active side stay private.</small></span>
          <ShieldCheck size={18} aria-hidden="true" />
        </div>
        <button className="dex-v2-review-button" type="button" disabled={!pricesAreValid || !rangePricesAreValid || !inventoryFieldsValid || !hasStartingInventory || !successorSupported || strategyAction.busy} onClick={() => { void reviewRecurring(); }}><span>Review {recurringClass === 'LL' ? 'fixed-price' : 'Range'} recurring</span><ArrowRight size={21} aria-hidden="true" /></button>
        <p className="dex-v2-activation-note" role="status">{strategyAction.message || reviewStatus || balances.message || (successorSupported ? 'Ready to create on COTI Testnet.' : 'No verified Recurring admission capacity remains for this pair.')}</p>
        <details className="dex-v2-recurring-summary">
          <summary>Strategy summary <ChevronDown size={17} aria-hidden="true" /></summary>
          <StrategyPreview
            title="A private two-sided liquidity cycle"
            rows={[
              [buyLegLabel, buyPriceIsValid && buyEndPriceIsValid && recurringClass === 'RR'
                ? `${displayedBuyPrice.toFixed(4)} → ${displayedBuyEndPrice.toFixed(4)} ${ratioLabel}`
                : buyPriceIsValid ? `${displayedBuyPrice.toFixed(4)} ${ratioLabel}` : '—'],
              [quoteInventoryRole, `${quoteAmount || '0'} ${displayedQuoteSymbol}`],
              [sellLegLabel, sellPriceIsValid && sellEndPriceIsValid && recurringClass === 'RR'
                ? `${displayedSellPrice.toFixed(4)} → ${displayedSellEndPrice.toFixed(4)} ${ratioLabel}`
                : sellPriceIsValid ? `${displayedSellPrice.toFixed(4)} ${ratioLabel}` : '—'],
              [baseInventoryRole, `${baseAmount || '0'} ${displayedBaseSymbol}`]
            ]}
            note="Filled inventory moves to the opposite side so the strategy can trade back later."
          />
          <p className="dex-v2-recurring-ratio-note">Reversing the shared price ratio relabels Buy and Sell for the displayed base asset without moving the underlying inventories.</p>
          <p className="dex-v2-recurring-ratio-note">Fixed prices (LL) use two private prices. Range prices (RR) add a private end marginal price to each leg.</p>
        </details>
      </section>
      <TradeActionConfirmModal confirmation={confirmation} onCancel={() => resolveConfirmation(false)} onConfirm={() => resolveConfirmation(true)} />
    </>
  );
}

const DEFAULT_DEX_PAIR: TradingPair = ['BCN', 'HBR'];

export default function DexV2Page({
  priceDisplayInverted = false, selectedPair = DEFAULT_DEX_PAIR, sharedWalletSession,
  onPriceDisplayInvertedChange, onOpenAgent, onNavigateMode, dailyPriceConfig, dailyPriceProvider, marketReference,
  swapCandidate = 'cheap-current'
}: {
  priceDisplayInverted?: boolean; selectedPair?: TradingPair; sharedWalletSession?: SharedWalletSession;
  onPriceDisplayInvertedChange?: (inverted: boolean) => void; onOpenAgent?: () => void;
  onNavigateMode?: (mode: DexMode) => void; dailyPriceConfig?: CurrentDexDailyPriceConfig;
  dailyPriceProvider?: Pick<Eip1193Provider, 'request'>;
  marketReference?: CurrentDexMarketReference;
  swapCandidate?: CurrentCheapDexCandidateKey;
} = {}) {
  const [activeMode, setActiveMode] = useState<DexMode>(() => typeof window === 'undefined' ? 'swap' : resolveDexModeFromPath(window.location.pathname));
  const [activityView, setActivityView] = useState<'orders' | 'history'>('orders');
  const dailyHistory = useCurrentDexDailyPrice({ pair: selectedPair, config: dailyPriceConfig, provider: dailyPriceProvider });
  const mobileKeyboardOpen = useVisualViewportKeyboardOpen();
  useEffect(() => {
    const syncModeWithLocation = () => setActiveMode(resolveDexModeFromPath(window.location.pathname));
    window.addEventListener('popstate', syncModeWithLocation);
    return () => window.removeEventListener('popstate', syncModeWithLocation);
  }, []);
  const trade = ['swap', 'limit'].includes(activeMode);
  const liquidity = ['liquidity', 'strategies'].includes(activeMode);
  const management = activeMode === 'activity' || activeMode === 'positions';
  // An unavailable prepared-market chart must keep the selected pair labels.
  const chartPair = swapCandidate === 'cheap-prepared' || swapCandidate === 'cheap-exit' || swapCandidate === 'cheap-history' || dailyHistory.view.status === 'ready' || dailyHistory.view.status === 'empty'
    ? selectedPair : CURRENT_DEX_DISPLAY_PAIR;
  const selectMode = (mode: DexMode) => { setActiveMode(mode); onNavigateMode?.(mode); };
  const inspect = (mode: DexMode) => { if (mode === 'activity') setActivityView('orders'); selectMode(mode); };
  return <main className={`dex-v2-page${mobileKeyboardOpen ? ' dex-v2-keyboard-open' : ''}`}>
    <ModeNavigation activeMode={activeMode} onOpenAgent={onOpenAgent} onSelect={selectMode} />
    <section className="dex-v2-main">
      <div className="dex-v2-content-grid">
        <div className="dex-market-chart-host">
          <DexMarketChart baseSymbol={chartPair[0]} quoteSymbol={chartPair[1]} history={dailyHistory.view}
            onHistoryRefresh={dailyHistory.refresh} illustrative priceDisplayInverted={priceDisplayInverted} />
        </div>
        <div className="dex-v2-form-column">
          {trade ? <nav className="dex-v2-section-tabs" aria-label="Trade type">
            {(['swap', 'limit'] as const).map(mode => <button type="button" key={mode} aria-current={activeMode === mode ? 'page' : undefined} onClick={() => selectMode(mode)}>{mode === 'swap' ? 'Swap' : 'Limit'}</button>)}
          </nav> : null}
          {management ? <nav className="dex-v2-section-tabs" aria-label="Manage views">
            <button type="button" aria-current={activeMode === 'activity' && activityView === 'orders' ? 'page' : undefined} onClick={() => { setActivityView('orders'); selectMode('activity'); }}>Orders</button>
            <button type="button" aria-current={activeMode === 'positions' ? 'page' : undefined} onClick={() => selectMode('positions')}>Positions</button>
            <button type="button" aria-current={activeMode === 'activity' && activityView === 'history' ? 'page' : undefined} onClick={() => { setActivityView('history'); selectMode('activity'); }}>History</button>
          </nav> : null}
          {/* Keep transaction origins and private result scopes alive when users change views. */}
          <div className="dex-v2-workspace-panel" hidden={activeMode !== 'swap'}>
            <CurrentSwapWorkspace onPriceDisplayInvertedChange={onPriceDisplayInvertedChange} priceDisplayInverted={priceDisplayInverted}
              selectedPair={selectedPair} sharedWalletSession={sharedWalletSession} marketReference={marketReference} candidateKey={swapCandidate} visible={activeMode === 'swap'} />
          </div>
          <div className="dex-v2-workspace-panel" hidden={activeMode !== 'limit' && !(activeMode === 'activity' && activityView === 'orders')}>
            <CurrentLimitWorkspace sharedWalletSession={sharedWalletSession} priceDisplayInverted={priceDisplayInverted} candidateKey={swapCandidate} selectedPair={selectedPair} view={activeMode === 'activity' ? 'manage' : 'create'} />
          </div>
          <div className="dex-v2-workspace-panel" hidden={!liquidity || activeMode === 'positions'}><CurrentPoolWorkspace sharedWalletSession={sharedWalletSession} priceDisplayInverted={priceDisplayInverted}
            candidateKey={swapCandidate} selectedPair={selectedPair} /></div>
          <div className="dex-v2-workspace-panel" hidden={activeMode !== 'positions'}><CurrentPoolPositionsWorkspace sharedWalletSession={sharedWalletSession} candidateKey={swapCandidate} visible={activeMode === 'positions'} /></div>
          <div className="dex-v2-workspace-panel" hidden={activeMode !== 'activity' || activityView !== 'history'}><CurrentDexActivity sharedWalletSession={sharedWalletSession} candidateKey={swapCandidate} visible={activeMode === 'activity' && activityView === 'history'} onInspect={inspect} /></div>
        </div>
      </div>
    </section>
  </main>;
}
