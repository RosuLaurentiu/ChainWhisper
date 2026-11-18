import TokenApprovalChoice, { useTokenApprovalMode } from '../../wallet/TokenApprovalChoice';
import { MAX_TOKEN_ALLOWANCE } from '../../../lib/tokenAllowance';
import './CurrentDexOwnerViews.css';
import { useEffect, useRef, useState } from 'react';
import { logMobileWalletDiagnostic } from '../../../lib/mobileWalletDiagnostics';
import { formatEther, parseUnits } from '@coti-io/coti-ethers';
import {
  ArrowDownUp,
  ArrowRight,
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
import { currentDexPendingStorage, readCurrentDexPendingAttempt, currentDexOwnerRecovery, type CurrentDexOwnerRecoveryView } from '../../../lib/currentDexPendingAttempt';
import { CURRENT_DEX_DISPLAY_PAIR, parseCurrentDexTokenAmount, readCurrentDexDisplay, currentDexDisplayPair,
  parseDexCandidateTokenAmount, formatDexCandidateTokenAmount, CURRENT_UNSENT_RELEASED_MESSAGE, currentDexRecordScope } from '../../../lib/currentDexDisplay';
import type { TradingPair } from '../../../app/components/TradingProductSwitch';
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
import { CurrentDexPrivateReceiptError, wasCurrentDexUnsentReleased, type CurrentCheapDexIssuedQuote, type CurrentCheapDexPreparedQuote } from '../../../lib/currentDexSubmission';
import type { CurrentCheapDexProfile } from '../../../lib/currentDexOperation';
import type { TradeActionConfirmModel } from '../../../lib/tradeActionConfirm';
import { CurrentDexQuoteProtectionError, DEFAULT_CURRENT_DEX_SLIPPAGE_PERCENT, parseCurrentDexSlippagePercent } from '../../../lib/currentDexQuoteReview';
import { currentDexPriceImpact, currentDexQuoteAveragePrice } from '../../../lib/currentDexPriceImpact';
import { currentDexEstimatedReceive, type CurrentDexMarketReference } from '../../../lib/currentDexMarketReference';
import TradeActionConfirmModal from '../../trading/components/TradeActionConfirmModal';
import CurrentSwapProgress from './CurrentSwapProgress';
import CurrentSwapSteps, {type SwapInputProgress,type SwapTransactionStep,type SwapApprovalStep} from './CurrentSwapSteps';
import { currentDexQuoteInputPlan } from '../../../lib/currentDexQuoteInputPlan';
import { DexViewTabs, type DexView } from '../../trading/components/TradeDeskTabs';
import useTradeActionConfirmationState from '../../trading/hooks/useTradeActionConfirmationState';
import useCurrentTrialBalances from '../hooks/useCurrentTrialBalances';
import useVisualViewportKeyboardOpen from '../../../shared/hooks/useVisualViewportKeyboardOpen';
import {
  resolveCanonicalTradeActionSide,
  resolveDisplayedTradeActionSide,
  type TradeActionSide
} from '../../../lib/tradePerspective';
import { resolveCanonicalTradingPath } from '../../../shell/routing';
import { CurrentSwapJourneyTiming, currentSwapTimingVisible } from './currentSwapJourneyTiming';

type DexMode = Exclude<DexView, 'agent' | 'recurring'>;
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
  sender: Pick<TrialSubmission, 'readSharedSwapInputFunding' | 'readCurrentTokenFunding'>,
  candidateKey: CurrentCheapDexCandidateKey, owner: string, token: string, tokenIndex: 0 | 1, outputToken: string
) => {
  if (candidateKey !== 'cheap-prepared' && candidateKey !== 'cheap-exit' && candidateKey !== 'cheap-history') return sender.readCurrentTokenFunding(tokenIndex);
  const candidate = resolveCurrentCheapDexCandidate(candidateKey), funds = await sender.readSharedSwapInputFunding(token, outputToken);
  const input = funds.tokens.find(value => value.address.toLowerCase() === token.toLowerCase());
  if (funds.owner.toLowerCase() !== owner.toLowerCase() || funds.core.toLowerCase() !== candidate.core.toLowerCase() ||
      funds.graph !== candidate.graph || funds.packageSha256 !== candidate.packageSha256 || funds.privateFundsVerified !== true ||
      funds.readyToSign !== false || !input || input.decimals !== 6 || typeof input.balance !== 'bigint' || input.balance < 0n ||
      typeof input.allowance !== 'bigint' || input.allowance < 0n) throw new Error('Shared swap input funding identity or private state changed.');
  return { balance: input.balance, allowance: input.allowance, block: funds.head };
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
// decision-033: the released-action message is shared with the other DEX screens.
const DEX_PAGE_UNSENT_RELEASED_MESSAGE = CURRENT_UNSENT_RELEASED_MESSAGE;
export const currentTrialAttemptPresentation = (attempt: TrialAttempt) => {
  if (attempt.status === 'released-unsent') return { stage: 'idle', message: DEX_PAGE_UNSENT_RELEASED_MESSAGE };
  if (attempt.status === 'manual-reconciliation-required') return { stage: 'reconciling', message:
    'verificationBlocked' in attempt && attempt.verificationBlocked
      ? 'Private verification failed or is unavailable. The saved action remains blocked. Check its exact private receipt in the original session; do not resend.'
      : 'transactionHash' in attempt && attempt.transactionHash
        ? `${'reason' in attempt ? attempt.reason : 'The existing transaction needs a status check.'} Transaction hash retained. Do not resend.`
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
  onInspect,
  candidateKey = 'cheap-current', visible = true
}: {
  priceDisplayInverted: boolean;
  selectedPair: TradingPair;
  marketReference?: CurrentDexMarketReference;
  sharedWalletSession?: SharedWalletSession;
  onInspect?: (view: CurrentDexOwnerRecoveryView) => void;
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
  const balances = useCurrentTrialBalances(sharedWalletSession, result?.text ?? '', { candidate, tokens: selectedTokens }, visible);
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
  const currentMarketReference = useRef(marketReference);
  currentMarketReference.current = marketReference;
  const displayedProfile = issued?.intent.profile ?? profile;
  const restoredQuote = issued !== null && capturedTerms === '';
  const displayedSlippage = restoredQuote ? String((issued.intent.toleranceBps ?? 0) / 100) : slippagePercent;
  const quoteProtocol = currentCheapDexQuoteProtocol(candidate);
  const termsKey = [candidate.graph, candidate.core, candidate.packageSha256, ...selectedTokens, selectedPair.join('/'), profile, canonicalSide, priceDisplayInverted, maximumInput, minimumInput, minimumOutput, priceLimit, quoteProtocol, slippagePercent].join(':');
  const inputIndex = canonicalSide === 'buy' ? 1 : 0;
  const [approvalMode, setApprovalMode, getApprovalMode] = useTokenApprovalMode(`${sharedWalletSession?.walletAddress}:${candidate.graph}:${selectedTokens[inputIndex]}`);
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
  const [stepProgress,setStepProgress]=useState<{scope:object;inputs:SwapInputProgress;approval:SwapApprovalStep;quote:SwapTransactionStep;accept:SwapTransactionStep;cancelledBeforeQuote?:boolean}|null>(null);
  const updateSteps=(patch:Partial<NonNullable<typeof stepProgress>>)=>{
    if(reviewScope.current!==currentReviewScope)return;
    setStepProgress(previous=>{
      const prior:NonNullable<typeof stepProgress>=previous?.scope===currentReviewScope?previous:{scope:currentReviewScope,inputs:{completed:0,total:currentDexQuoteInputPlan(candidateKey).length,requesting:false},approval:'conditional',quote:'next',accept:'next'};
      return{...prior,...patch,...(patch.approval==='not-needed'&&prior.approval==='verified'?{approval:'verified' as const}:{})};
    });
  };
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
  const [unusedApproval, setUnusedApproval] = useState<{ sender: TrialSubmission; quote: CurrentCheapDexPreparedQuote; scope: object; readyToContinue: boolean } | null>(null);
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
  const progressReady = canInspect && privacyReady && !walletChanged && !candidateChanged && verifiedScope !== null &&
    verifiedScope.wallet === currentReviewScope.wallet && verifiedScope.terms === currentReviewScope.terms &&
    verifiedScope.source === currentReviewScope.source && verifiedScope.walletId === currentReviewScope.walletId &&
    verifiedScope.onboard?.[wallet.address ?? '']?.aesKey === currentReviewScope.onboard?.[wallet.address ?? '']?.aesKey;
  const busy = ['preparing', 'open-pending', 'accepting', 'release-pending'].includes(stage);
  const savedActionPending = typeof window !== 'undefined' && hasCurrentTrialSavedAction(currentDexPendingStorage(currentDexRecordScope(candidate, sharedWalletSession?.walletAddress)));
  const readOwnerRecovery = () => currentDexOwnerRecovery(readCurrentDexPendingAttempt(currentDexPendingStorage(currentDexRecordScope(candidate, sharedWalletSession?.walletAddress))),
    { chainId: String(candidate.chainId), owner: wallet.address ?? '', core: candidate.core, graph: `0x${candidate.graph}` });
  let ownerRecovery: ReturnType<typeof readOwnerRecovery> = null;
  let ownerRecoveryError = '';
  try { if (typeof window !== 'undefined') ownerRecovery = readOwnerRecovery(); }
  catch (cause) { ownerRecoveryError = cause instanceof Error ? cause.message : 'The saved action is unavailable. Do not resend.'; }
  const inputsLocked = connecting || busy || Boolean(issued) || Boolean(pending) || savedActionPending || fundingRecovery || candidateChanged;
  const unknownOrigin = stage.startsWith('observed-');
  // Owner decision 2026-11-18: "Check current contracts" shows only while a swap or a recovery is in progress (Get Quote
  // and Accept run the contract check themselves). "Check current state" is one compact button at all times.
  const swapActivity = Boolean(issued || pending || savedActionPending || fundingRecovery || ownerRecovery || ownerRecoveryError || unknownOrigin || stage !== 'idle');
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
    const nextSide = resolveCanonicalTradeActionSide(side, priceDisplayInverted);
    setCanonicalSide(nextSide);
    setMaximumInput('');
    setMinimumOutput('0');
    setPriceLimit('');
  };
  const error = (cause: unknown, releasedStage?: typeof stage) => {
    // A released wallet rejection is not an error state: nothing was sent and no record remains.
    if (wasCurrentDexUnsentReleased(cause)) {
      // A released approval or claim leaves no funding action to check. Found in the Testnet App check of 2026-11-15.
      if (!fundingPending && !sharedFundingPending.current) setFundingRecovery(false);
      setMessage(DEX_PAGE_UNSENT_RELEASED_MESSAGE); setStage(releasedStage ?? (issued ? 'ready' : 'idle')); return;
    }
    if (!fundingPending && !sharedFundingPending.current) {
      try {
        const saved = readCurrentDexPendingAttempt(currentDexPendingStorage(currentDexRecordScope(candidate, sharedWalletSession?.walletAddress)));
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
  const showDelivery = async (current: CurrentCheapDexIssuedQuote, sender: TrialSubmission, terminalHash: string | null = null,
    verifiedDelivery?: Awaited<ReturnType<TrialSubmission['readCurrentCheapDelivery']>>) => {
    if (currentCheapDexCandidateKey(current.intent.candidate) !== currentCheapDexCandidateKey(candidate) ||
        current.intent.inputToken.toLowerCase() !== selectedTokens[inputIndex] ||
        current.intent.outputToken.toLowerCase() !== selectedTokens[outputIndex]) {
      throw new Error('This operation belongs to another candidate or pair. Return to its original view to verify it.');
    }
    if (!privacyReady) throw new Error('Unlock privacy before checking the private result.');
    if (reviewScope.current !== currentReviewScope) throw new Error('Privacy session changed. Check the private result again.');
    const receipt = verifiedDelivery ?? await sender.readCurrentCheapDelivery(current);
    if (currentWallet.current !== capturedWallet.current) throw new Error('Wallet changed during private result verification.');
    if (reviewScope.current !== currentReviewScope) throw new Error('Privacy session changed during private result verification. Check again.');
    const a = receipt.amounts;
    const unfundedCancellation = receipt.releaseAction === 'cancel';
    const phase = verifiedDelivery ? verifiedDelivery.operation.phase : current.operation.phase;
    setResult({ scope: currentReviewScope, operationId: current.operationId.toString(), transactionHash: terminalHash || null,
      text: `Paid ${formatInput(a.actualInput)} ${trialTokens[inputIndex]}; received ${formatOutput(a.netOutput)} ${trialTokens[outputIndex]}; ${unfundedCancellation ? 'unused' : 'refunded'} ${formatInput(a.refund)} ${trialTokens[inputIndex]}.` });
    setStage(phase === 'released' ? 'released' : 'settled');
    setMessage(unfundedCancellation ? 'Quote cancelled before funding.' : phase === 'released' ? 'Released with a private refund receipt.' :
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
      const saved = readCurrentDexPendingAttempt(currentDexPendingStorage(currentDexRecordScope(candidate, sharedWalletSession?.walletAddress)));
      const observed = saved?.phase === 'token-faucet' || saved?.phase === 'token-refill'
        ? await sender.recoverPendingSharedTokenFunding(existingTransactionHash)
        : await sender.recoverPendingSharedSwapApproval(existingTransactionHash);
      if (observed && !['observed-mined', 'observed-reverted', 'released-unsent'].includes(observed.status)) throw new Error('Shared approval needs chain reconciliation. Do not resend.');
    }
    return readCurrentSwapInputFunding(sender, candidateKey, currentWallet.current.address!, selectedTokens[inputIndex], inputIndex as 0 | 1, selectedTokens[outputIndex]);
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
      let funds = await readCurrentSwapInputFunding(sender, candidateKey, attemptWallet.address!, selectedTokens[inputIndex], inputIndex as 0 | 1, selectedTokens[outputIndex]); assertWallet();
      if (funds.balance < amount) throw new Error('Private input balance is insufficient. Claim test tokens separately before Get Quote.');
      if (funds.allowance >= amount && (getApprovalMode() === 'exact' || funds.allowance === MAX_TOKEN_ALLOWANCE)) {updateSteps({approval:'not-needed'});return funds;}
      updateSteps({approval:'needed'});
      const prepared = await sender.prepareSharedSwapApproval({ token: selectedTokens[inputIndex], amount, approvalMode: getApprovalMode, assertReviewCurrent: assertWallet, preparedQuote,
        confirm: async review => {
          assertWallet(); const yes = await timedConfirmation({ title: 'Approve swap token', primaryLabel: 'Continue', fundingMoves: [], stats: [],
            summaryRows: [{ label: 'Input token', value: trialTokens[inputIndex] }, { label: 'Swap amount', value: formatInput(amount) },
              { label: 'Core spender', value: review.spender }], message: 'Token approval is separate from the swap. Network gas applies.'
          }, 'Token setup review request to decision'); assertWallet(); return yes;
        } });
      assertWallet();
      if (!prepared) {updateSteps({cancelledBeforeQuote:!issued});setStage(issued ? 'ready' : 'idle'); setMessage('Token approval cancelled. No swap was sent.'); return null; }
      setFundingRecovery(true);
      const sent = await sender.submitSharedSwapApproval(prepared);
      assertWallet();updateSteps({approval:'submitted'});
      sharedFundingPending.current = { recover: sent.recover, scope: currentReviewScope }; setTransactionHash(sent.transactionHash); assertWallet();
      setMessage('Token approval submitted. Waiting for its private result.');
      if (!await sender.waitForCurrentCheapReceipt(sent.transactionHash)) {
        assertWallet(); setStage('error'); setMessage('Approval is pending. Check current state before another action; do not resend.'); return null;
      }
      const verified = await sent.recover(); assertWallet();
      sharedFundingPending.current = null; setFundingRecovery(false);
      if (verified.fundingOutcome === 'reverted') throw new Error('Approval reverted. Private state is unchanged.');
      funds = await readCurrentSwapInputFunding(sender, candidateKey, attemptWallet.address!, selectedTokens[inputIndex], inputIndex as 0 | 1, selectedTokens[outputIndex]); assertWallet();
      if (funds.balance < amount || funds.allowance < amount) throw new Error('Exact shared input funds changed after approval.');
      updateSteps({approval:'verified'});
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
    setPublicAttempt(attempt.status === 'released-unsent' ? null : attempt);
    if (!issued && attempt.status === 'observed-mined') setProfile(attempt.profile);
    if ('transactionHash' in attempt && attempt.transactionHash) setTransactionHash(attempt.transactionHash);
    const presentation = currentTrialAttemptPresentation(attempt);
    setStage(presentation.stage); setMessage(presentation.message);
  };
  const clearUnusedApproval = async () => {
    if (!unusedApproval || unusedApproval.scope !== currentReviewScope || !privacyReady || !connected ||
        busy || checking || pending || issued || savedActionPending || fundingRecovery || walletChanged || candidateChanged) return;
    const attemptWallet = currentWallet.current, context = unusedApproval;
    const assertCurrent = () => {
      if (currentWallet.current !== attemptWallet || reviewScope.current !== context.scope)
        throw new Error('Wallet, terms or privacy session changed during approval cleanup.');
    };
    setChecking(true);
    try {
      const sender = context.sender;
      const prepared = await sender.prepareSharedSwapAllowanceCleanup({ token: selectedTokens[inputIndex], preparedQuote: context.quote,
        assertReviewCurrent: assertCurrent, confirm: async review => {
          assertCurrent(); const yes = await timedConfirmation({ title: 'Clear unused approval', primaryLabel: 'Clear approval', fundingMoves: [], stats: [],
            summaryRows: [{ label: 'Token', value: trialTokens[inputIndex] }, { label: 'New allowance', value: '0' },
              { label: 'Core spender', value: review.spender }], message: 'This clears the previous token approval to 0 before a fresh exact approval. It does not cancel a funded swap. Network gas applies.'
          }, 'Approval cleanup review request to decision'); assertCurrent(); return yes;
        } });
      assertCurrent();
      if (!prepared) { setMessage('No approval cleanup was submitted.'); return; }
      setSubmission(sender); setFundingRecovery(true);
      const sent = await sender.submitSharedSwapApproval(prepared);
      sharedFundingPending.current = { recover: sent.recover, scope: context.scope };
      setTransactionHash(sent.transactionHash); assertCurrent();
      setMessage('Approval cleanup submitted. Waiting for verification; do not resend.');
      if (!await sender.waitForCurrentCheapReceipt(sent.transactionHash)) {
        assertCurrent(); setStage('error'); setMessage('Approval cleanup is pending. Check current state; do not resend.'); return;
      }
      const verified = await sent.recover(); assertCurrent();
      sharedFundingPending.current = null; setFundingRecovery(false);
      if (verified.fundingOutcome === 'reverted') throw new Error('Approval cleanup reverted. Private state is unchanged.');
      setUnusedApproval({ ...context, readyToContinue: true }); setStage('idle');
      setMessage('Approval cleared. Continue swap.');
    } catch (cause) { error(cause); }
    finally { setChecking(false); }
  };
  const refresh = async () => {
    if (!canInspect || walletChanged || candidateChanged || checking || (busy && !pending)) return;
    if (stage === 'idle') { capturedWallet.current = currentWallet.current; capturedCandidate.current = candidateKey; }
    setChecking(true);
    let activeIssued = issued;
    let activeSender = submission;
    let releasedNote = '';
    try {
      const ownerAction = readOwnerRecovery();
      if (ownerAction) { setStage('reconciling'); setMessage(ownerAction.message); return; }
      if (fundingRecovery) {
        const sender = submission ?? await getSubmission();
        const value = await checkFunding(sender);
        if (currentWallet.current !== capturedWallet.current) throw new Error('Wallet changed during input funding.');
        setFundingPending(null); sharedFundingPending.current = null; setFundingRecovery(false); setStage(issued ? 'ready' : 'idle');
        if (unusedApproval?.scope === currentReviewScope && !('fundingOutcome' in value)) {
          const ready = value.allowance === 0n || value.allowance >= unusedApproval.quote.intent.maximumInput;
          setUnusedApproval({ ...unusedApproval, readyToContinue: ready });
          setMessage(ready ? 'Approval cleared. Continue swap.' : 'Approval still differs from the swap amount. Update approval.'); return;
        }
        setMessage('fundingOutcome' in value && value.fundingOutcome === 'reverted' ? 'Funding reverted. Private state is unchanged.' : 'Private input funds verified. Continue with Get Quote or Review and Accept.'); return;
      }
      if (unusedApproval?.scope === currentReviewScope && !issued) {
        if (!privacyReady) throw new Error('Unlock privacy before checking approval.');
        const context = unusedApproval;
        setUnusedApproval({ ...context, readyToContinue: false });
        await context.sender.assertCurrentCheapSwapAllowanceCleanupIdle(context.quote);
        if (currentWallet.current !== capturedWallet.current || reviewScope.current !== context.scope) throw new Error('Wallet, terms or privacy session changed during approval check.');
        const funds = await readCurrentSwapInputFunding(context.sender, candidateKey, currentWallet.current.address!, selectedTokens[inputIndex], inputIndex as 0 | 1, selectedTokens[outputIndex]);
        if (currentWallet.current !== capturedWallet.current || reviewScope.current !== context.scope) throw new Error('Wallet, terms or privacy session changed during approval check.');
        const ready = funds.allowance === 0n || funds.allowance >= context.quote.intent.maximumInput;
        setUnusedApproval({ ...context, readyToContinue: ready }); setStage('idle');
        setMessage(ready ? funds.allowance === 0n ? 'Approval is zero. Continue swap.' : 'Exact approval verified. Continue swap.' : 'Approval still differs from the swap amount. Update approval.'); return;
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
        // decision-033: a released attempt sent nothing and leaves no saved action. The check continues as
        // if none was found, so an open Quote of this owner decides the next state.
        const released = attempt?.status === 'released-unsent';
        if (!activeIssued && (candidateKey === 'cheap-exit' || candidateKey === 'cheap-history') && (!attempt || released ||
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
        if (attempt && released) {
          if (!activeIssued) { showAttempt(attempt); return; }
          setPublicAttempt(null); releasedNote = `${DEX_PAGE_UNSENT_RELEASED_MESSAGE} `;
        } else if (attempt) {
          if (!activeIssued) showAttempt(attempt);
          // Public lookup never restores a private brand. A live issued origin
          // can still verify its own terminal receipt after this public read.
          if (!activeIssued || attempt.status !== 'observed-mined') return;
          if (issued && (attempt.phase !== 'accept' || attempt.operationId !== issued.operationId)) return;
        }
      }
      if (!activeIssued) {
        if (stage !== 'error') setMessage('No pending current DEX attempt was found for this owner session.');
        return;
      }
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
        setIssued(current); setStage('ready'); setMessage(`${releasedNote}Private Quote is READY for review.`);
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
    const resume = unusedApproval?.scope === currentReviewScope && unusedApproval.readyToContinue ? unusedApproval : null;
    if (!resume) setStepProgress(null);
    try {
      // Prepared App writes stay held before the legacy funding path can run.
      const maximum = parseInput(maximumInput, 'You send', true);
      if (preparedCandidate && candidateKey !== 'cheap-history') assertCurrentSwapCandidate(candidate,{principal:attemptWallet.address!,destination:attemptWallet.address!,profile,inputToken:selectedTokens[inputIndex],outputToken:selectedTokens[outputIndex],maximumInput:maximum});
      if(preparedCandidate&&candidateKey!=='cheap-exit'&&candidateKey!=='cheap-history')throw new Error('Prepared-candidate swap approval is not supported. Its App swap admission remains held.');
      const minimum = parseCurrentSwapFillPercent(minimumInput, maximum);
      const output = parseOutput(minimumOutput, 'You receive at least');
      let rate;
      const toleranceBps = quoteProtocol ? parseCurrentDexSlippagePercent(slippagePercent) : undefined;
      try { rate = quoteProtocol && !priceLimit.trim() ? { numerator: 0n, denominator: 1n } : parseCurrentSwapPriceLimit(priceLimit, displayedSide); }
      catch { throw new Error(`Price limit: enter a positive ${displayedSide === 'buy' ? 'maximum buy' : 'minimum sell'} price.`); }
      const { numerator, denominator } = rate;
      setStage('preparing'); setMessage('Checking current test contracts.');
      const saved = readCurrentDexPendingAttempt(currentDexPendingStorage(currentDexRecordScope(candidate, sharedWalletSession?.walletAddress)));
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
        ? await readCurrentSwapInputFunding(sender,candidateKey,attemptWallet.address!,selectedTokens[inputIndex],inputIndex as 0|1,selectedTokens[outputIndex])
        : await clock.observeWait('Quote input setup, including checks and any review or wallet wait', () => ensureFunding(sender, maximum, attemptWallet));
      if (!funds) return;
      if(preparedCandidate&&'allowance' in funds)updateSteps({approval:funds.allowance>=maximum?'not-needed':'needed'});
      if (resume && funds.block.timestamp >= resume.quote.intent.deadline) {
        setUnusedApproval(null); setStage('idle'); setMessage('Quote expired. Get a fresh quote.'); return;
      }
      const quoteCapability = resume ? null : await sharedWalletSession!.actions!.getCurrentDexQuoteCapability!(trialChain);
      if (currentWallet.current !== attemptWallet) throw new Error('Wallet changed during Quote preparation.');
      if (reviewScope.current !== currentReviewScope) throw new Error('Swap candidate, pair or privacy session changed during Quote preparation.');
      const quote = resume?.quote ?? await quoteCapability!.prepareCurrentQuote({ profile,
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
        progress:event=>{
          if(currentWallet.current!==attemptWallet||reviewScope.current!==currentReviewScope)return;
          updateSteps({inputs:{completed:event.completed,total:event.total,requesting:event.phase==='requesting'}});
        },
        // Owner decision 2026-11-17: no App window before the Quote input signatures; the step track shows them.
        confirmPrivateInputs: async () => {
          if (currentWallet.current === attemptWallet && reviewScope.current === currentReviewScope) setMessage('Complete the private Quote input signatures in your wallet.');
          return true;
        }
      });
      if (!quote) {updateSteps({cancelledBeforeQuote:true});setStage('idle');setMessage('Private input review cancelled. No Quote was sent.');return;}
      if(preparedCandidate&&!await clock.observeWait('Exact branded Quote approval',()=>ensureFunding(sender,maximum,attemptWallet,quote)))return;
      if (currentWallet.current !== attemptWallet) throw new Error('Wallet changed during Quote preparation.');
      if (reviewScope.current !== currentReviewScope) throw new Error('Swap candidate, pair or privacy session changed during Quote preparation.');
      setUnusedApproval(null); setSubmission(sender); setCapturedTerms(termsKey);
      const sent = await sender.submitCurrentCheapQuote(quote, {
        walletRequested: () => {
          if (currentWallet.current !== attemptWallet || reviewScope.current !== currentReviewScope) return;
          setStage('open-pending'); setMessage('Complete Quote in your wallet.');
          updateSteps({quote:'wallet'});
        },
        transactionHashReturned: hash => {
          if (currentWallet.current !== attemptWallet || reviewScope.current !== currentReviewScope) return;
          clock.quoteSubmitted(hash); setTransactionHash(hash); captureTiming(sender, hash);
          updateSteps({quote:'submitted'});
          setMessage('Quote submitted. Checking its transaction.');
        }
      });
      clock.quoteSubmitted(sent.transactionHash);
      updateSteps({quote:'submitted'});
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
      updateSteps({quote:'verified'});
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
          clock?.bindOperation(quote.operationId.toString());
          const originalModel = model as TradeActionConfirmModel;
          const reviewedModel = { ...originalModel, summaryRows: [
            ...originalModel.summaryRows.map(row => row.label === 'Average price' ? { ...row,
              value: currentDexQuoteAveragePrice({ model: originalModel, pair: trialTokens, inputIndex: inputIndex as 0 | 1,
                priceDisplayInverted: priceDisplayInverted }) } : row),
            { label: 'Slippage protection', value: quote.intent.toleranceBps === undefined ? 'Fixed price limit' : `${quote.intent.toleranceBps / 100}% of the Quote net rate` },
            { label: 'Quote expires', value: new Date(Number(quote.intent.deadline) * 1000).toLocaleString() },
            { label: 'Price impact (net)', value: currentDexPriceImpact({ model: originalModel, reference: currentMarketReference.current,
              pair: trialTokens, inputIndex: inputIndex as 0 | 1, now: BigInt(Math.floor(Date.now() / 1000)) }) }
          ] };
          setQuoteReview({ model: reviewedModel, scope: currentReviewScope });
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
            updateSteps({accept:'wallet'});
          },
          transactionHashReturned: hash => {
            if (currentWallet.current !== attemptWallet || reviewScope.current !== currentReviewScope) return;
            if (timingAttempt) clock?.acceptSubmitted(timingAttempt, hash);
            setTransactionHash(hash); captureTiming(sender, hash);
            updateSteps({accept:'submitted'});
            setMessage('Accept submitted. Checking its transaction.');
          }
        } });
      if (!sent) { setStage('ready'); setMessage('Quote ready. Review and Accept when you are ready.'); return; }
      if (timingAttempt) clock?.acceptSubmitted(timingAttempt, sent.transactionHash);
      updateSteps({accept:'submitted'});
      captureTiming(sender, sent.transactionHash);
      setPending({ recover: sent.recover, phase: 'accept' }); setTransactionHash(sent.transactionHash);
      setStage('accepting'); setMessage('Accept submitted. Waiting for the confirmed private result.'); setChecking(true);
      if (!await sender.waitForCurrentCheapReceipt(sent.transactionHash)) {
        setMessage('Accept submitted. Settlement is not complete. Use Check current state; do not resend.'); return;
      }
      const observed = await sent.recover();
      if (currentWallet.current !== attemptWallet) throw new Error('Wallet changed while waiting for Accept.');
      captureTiming(sender, sent.transactionHash); setPending(null);
      updateSteps({accept:'verified'});
      if (observed.status !== 'settled') {
        setStage('settlement-pending'); setMessage('Accept is mined; settlement remains pending.'); return;
      }
      const current = observed.delivery ? quote : await quote.readCurrent();
      if (currentWallet.current !== attemptWallet) throw new Error('Wallet changed during private result verification.');
      await showDelivery(current, sender, sent.transactionHash, observed.delivery);
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
    } catch (cause) { error(cause, previousStage); }
    finally { setChecking(false); }
  };
  const progressCheck = useRef(refresh);
  useEffect(() => { progressCheck.current = refresh; });
  useEffect(() => {
    if (issued?.intent.profile !== 'cheap-async' || !progressReady || checking || pending || fundingRecovery || changed ||
        !['preparing-quote', 'settlement-pending'].includes(stage)) return;
    // Session metadata can invalidate signing review without stopping reads of this same private operation.
    let stopped = false;
    let timer: number;
    const check = async () => {
      await progressCheck.current();
      if (!stopped) timer = window.setTimeout(() => { void check(); }, 5000);
    };
    timer = window.setTimeout(() => { void check(); }, 5000);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [issued, progressReady, checking, pending, fundingRecovery, changed, stage]);
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
  const quoteImpact = visibleQuote?.summaryRows.find(row => row.label === 'Price impact (net)')?.value ?? 'Unavailable';
  const swapStatus = candidateChanged ? 'This operation belongs to the previous contract candidate. Return to its original view to check it.'
    : walletChanged ? 'Wallet or network changed. Reconnect and reconcile the pending action.'
      : changed ? 'Terms changed. This Quote cannot be accepted; inspect or cancel it.'
        : ownerRecoveryError || ownerRecovery?.message || message || (wallet.address && (!connected || stage !== 'idle')
          ? wallet.chainId !== Number(trialChain) ? 'Switch your wallet to COTI Testnet to continue.'
            : !connected ? 'The wallet cannot use the current DEX. Check Transaction details.' : stage
          : null);
  const progressVisible = Boolean(canInspect || swapStatus || result || fundingRecovery || issued || transactionHash ||
    publicAttempt?.status === 'observed-mined' || ['error', 'reconciling'].includes(stage));
  const newQuoteEligible = (['settled', 'released', 'observed-expired'].includes(stage) ||
    (stage === 'expired' && issued?.intent.profile === 'fast-pool') || (stage === 'reverted' && !issued)) && !pending;
  const startNewQuote = () => {
    setUnusedApproval(null);
    setIssued(null); setSubmission(null); setCapturedTerms(''); setTransactionHash(''); setResult(null); setQuoteReview(null);
    setPublicAttempt(null); setExistingTransactionHash(''); setTimings([]);
    setStepProgress(null);
    journey.current = null; updateTimingDisplay(value => value + 1);
    setMessage(''); setStage('idle'); capturedWallet.current = wallet; capturedCandidate.current = candidateKey;
  };
  const cancelFastQuote = async () => {
    if (!enabled || issued?.intent.profile !== 'fast-pool' || !submission || busy || checking || pending || savedActionPending || fundingRecovery) return;
    const attemptWallet = currentWallet.current, attemptScope = currentReviewScope;
    setChecking(true); setMessage('Cancelling quote…');
    try {
      await submission.discardCurrentFastQuote(issued);
      if (currentWallet.current !== attemptWallet || reviewScope.current !== attemptScope) {
        throw new Error('Wallet, pair or privacy session changed while cancelling this quote.');
      }
      startNewQuote();
      setMessage('Quote cancelled. Change the amount and get a new quote.');
    } catch (cause) { error(cause); }
    finally { setChecking(false); }
  };
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
  // CW-096. Max uses the exact balance text only when it is a positive amount of the input token; status text such as Loading… gives no Max.
  let fullBalanceInput = '';
  if (wallet.address && privacyReady && balances.eligible && !balances.loading) {
    try { if (parseInput(balances.labels[inputIndex], 'Balance', true) > 0n) fullBalanceInput = balances.labels[inputIndex]; } catch { /* Not an amount. */ }
  }
  const priceLimitField = <label>
    <span><strong>{displayedSide === 'buy' ? 'Maximum buy price' : 'Minimum sell price'}</strong><small>net of fees</small></span>
    <input aria-label="Price limit" inputMode="decimal" placeholder={quoteProtocol ? 'Optional' : 'Required'} value={restoredQuote
      ? issued.intent.rateNumerator === 0n ? '' : displayedSide === 'buy'
        ? `${issued.intent.rateDenominator} / ${issued.intent.rateNumerator}`
        : `${issued.intent.rateNumerator} / ${issued.intent.rateDenominator}`
      : priceLimit} onChange={event => setPriceLimit(event.target.value)} disabled={inputsLocked} />
    <small>{trialTokens[1 - displayedBaseIndex]}/{trialTokens[displayedBaseIndex]}</small>
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
      {/* CW-096. A div, not a label: the box holds the Max button, and a label may hold only its one control. */}
      <div className="dex-v2-amount-input">
        <span><strong>You send</strong><small>{trialTokens[inputIndex]}</small></span>
        <input aria-label="Maximum input" inputMode="decimal" placeholder="0" value={restoredQuote ? formatInput(issued.intent.maximumInput) : maximumInput} onChange={event => setMaximumInput(event.target.value)} disabled={inputsLocked} />
        {wallet.address ? <span className="dex-v2-amount-balance">
          <small aria-label="Input token balance">Balance: {connected && !privacyReady ? 'Locked' : balances.labels[inputIndex]}</small>
          {fullBalanceInput ? <button type="button" className="dex-v2-amount-max" aria-label="Use the full balance" disabled={inputsLocked} onClick={() => setMaximumInput(fullBalanceInput)}>Max</button> : null}
        </span> : null}
      </div>
      <button className="dex-v2-current-direction" type="button" aria-label="Switch Buy and Sell" title="Switch Buy and Sell" disabled={inputsLocked} onClick={() => selectSide(displayedSide === 'buy' ? 'sell' : 'buy')}>
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
    {/* CW-096. The swap mode and the protection settings share one row; open settings take the full width below it. */}
    <div className="dex-v2-swap-settings">
    <div className="dex-v2-execution-choice">
      <div className="dex-v2-swap-mode-toggle" role="group" aria-label="Swap mode">
        <button type="button" aria-pressed={displayedProfile === 'fast-pool'} disabled={inputsLocked} onClick={() => setProfile('fast-pool')}>Fast</button>
        <button type="button" aria-pressed={displayedProfile === 'cheap-async'} disabled={inputsLocked} onClick={() => setProfile('cheap-async')}>Multi-source</button>
      </div>
      <span>{displayedProfile === 'fast-pool' ? 'Pools only' : 'Pools + Limits · async'}</span>
    </div>
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
    </div>
    {visibleQuote ? <details className="dex-v2-current-advanced"><summary>Quote details</summary><div>
      <p>Quotes do not reserve liquidity. Average price includes fees. Price impact uses the Pool reference captured for this review; the live header can change.</p>
      <dl className="dex-v2-current-facts">{visibleQuote.summaryRows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
    </div></details> : null}
    {/* CW-096. The main button comes before the step and cost summary. */}
    <div className="dex-v2-current-actions">
      {unusedApproval?.scope === currentReviewScope && !unusedApproval.readyToContinue && !issued ? <button className="dex-v2-review-button" type="button"
        disabled={!privacyReady || !connected || busy || checking || Boolean(pending) || savedActionPending || fundingRecovery || walletChanged || candidateChanged}
        onClick={() => { void clearUnusedApproval(); }}>Update approval</button> : null}
      {!wallet.address && sharedWalletSession?.actions?.connectBrowserWallet ? <button className="dex-v2-review-button" type="button" disabled={connecting || busy || checking} onClick={() => { void connectWallet(); }}>{connecting ? 'Connecting…' : 'Connect wallet'}</button> : unlockRequired ? <button className="dex-v2-review-button" type="button" disabled={connecting || busy || checking || walletChanged} onClick={() => { void unlockPrivacy(); }}>{connecting ? 'Unlocking…' : 'Unlock privacy'}</button> : newQuoteEligible ? <button className="dex-v2-review-button" type="button" disabled={checking || savedActionPending} onClick={startNewQuote}><span>New Quote</span><ArrowRight size={20} aria-hidden="true" /></button> : !issued ? <button className="dex-v2-review-button" type="button" disabled={!connected || walletChanged || busy || checking || Boolean(pending) || savedActionPending || unknownOrigin || unusedApproval?.scope === currentReviewScope && !unusedApproval.readyToContinue && !fundingRecovery} onClick={() => { void getQuote(); }}><span>{fundingRecovery ? 'Check funding and continue' : unusedApproval?.scope === currentReviewScope && unusedApproval.readyToContinue ? 'Continue swap' : 'Get Quote'}</span><ArrowRight size={20} aria-hidden="true" /></button> :
      <button className="dex-v2-review-button" type="button" disabled={!enabled || checking || savedActionPending || changed || stage !== 'ready' ||
        BigInt(Math.floor(Date.now() / 1000)) >= (issued?.intent.deadline ?? 0n)}
      onClick={() => { void accept(); }}><span>Review and Accept</span><ArrowRight size={20} aria-hidden="true" /></button>}
    </div>
    <CurrentSwapSteps profile={displayedProfile} stage={stage} privacyReady={privacyReady} restored={restoredQuote} status={swapStatus && swapStatus !== stage ? swapStatus : null}
      cancelledBeforeQuote={stepProgress?.scope===currentReviewScope&&stepProgress.cancelledBeforeQuote}
      inputs={stepProgress?.scope===currentReviewScope?stepProgress.inputs:{completed:0,total:currentDexQuoteInputPlan(candidateKey,restoredQuote).length,requesting:false}}
      approval={stepProgress?.scope===currentReviewScope?stepProgress.approval:'conditional'}
      quote={issued?'verified':stepProgress?.scope===currentReviewScope?stepProgress.quote:'next'}
      accept={stepProgress?.scope===currentReviewScope?stepProgress.accept:'next'}
      reviewReady={Boolean(issued?.operation.ready)&&stage==='ready'||Boolean(quoteReview?.scope===currentReviewScope)}
      work={displayedProfile==='cheap-async'?{total:currentCheapDexStages(candidate).workCalls,
        ...(issued&&(issued.operation.ready||['settling','settled','consumed-unverified'].includes(issued.operation.phase))?{completed:currentCheapDexStages(candidate).workCalls}:issued?.operation.phase==='preparing-quote'?{completed:Math.max(0,Math.min(currentCheapDexStages(candidate).workCalls,Number(issued.operation.stage)-1))}:{})}:undefined}
      delivered={Boolean(result&&result.scope===currentReviewScope&&!walletChanged)} scopeChanged={walletChanged||candidateChanged||changed||Boolean(stepProgress||issued)&&!progressReady}/>
    <CurrentSwapProgress visible={progressVisible} status={swapStatus}
      result={result && result.scope === currentReviewScope && !walletChanged ? result.text : null}
      fundingRecovery={fundingRecovery}
      operation={issued ? { id: issued.operationId.toString(), expiresAt: new Date(Number(issued.intent.deadline) * 1000).toLocaleString() }
        : !walletChanged && !candidateChanged && publicAttempt?.status === 'observed-mined'
          ? { id: publicAttempt.operationId.toString(), publicState: publicAttempt.operation.phase, privateAccountingUnverified: true } : null}>
    <div className="dex-v2-progress-actions">
    {ownerRecovery && onInspect ? <button type="button" disabled={walletChanged || candidateChanged || checking || busy}
      onClick={() => { try { const target = readOwnerRecovery(); if (target) onInspect(target.view); } catch (cause) { error(cause); } }}>{ownerRecovery.label}</button> : null}
    {ownerRecovery?.alternateView && onInspect ? <button type="button" disabled={walletChanged || candidateChanged || checking || busy}
      onClick={() => { try { const target = readOwnerRecovery(); if (target?.alternateView) onInspect(target.alternateView); } catch (cause) { error(cause); } }}>Open top-up recovery</button> : null}
    {/* Owner decision 2026-11-18: one compact button. While nothing is pending it still restores an open Quote from chain
        (another tab or device), so it stays visible. */}
    {canInspect ? <button type="button" disabled={walletChanged || candidateChanged || checking || (busy && !pending)} onClick={() => { void refresh(); }}><RefreshCw size={15} aria-hidden="true" />Check current state</button> : null}
    {issued?.intent.profile === 'fast-pool' && issued.operation.ready && !newQuoteEligible && !pending && !savedActionPending && !fundingRecovery &&
      ['ready', 'expired', 'error'].includes(stage) ? <button type="button" disabled={!enabled || busy || checking}
      onClick={() => { void cancelFastQuote(); }}>Cancel quote</button> : null}
    {issued?.intent.profile === 'cheap-async' && currentCheapDexOwnerActionEligible(issued.intent.candidate, issued.operation.stage, 'cancel') && !pending &&
      !['settlement-pending', 'settled', 'released'].includes(stage) ? <button type="button" disabled={!enabled || busy || checking}
      onClick={() => { void ownerAction('cancel'); }}>Cancel swap</button> : null}
    {issued?.intent.profile === 'cheap-async' && currentCheapDexOwnerActionEligible(issued.intent.candidate, issued.operation.stage, 'recover') && !pending &&
      !['settled', 'released'].includes(stage) ? <button type="button" disabled={!enabled || busy || checking}
      onClick={() => { void ownerAction('recover'); }}>Recover swap</button> : null}
    </div>
    {(['error', 'reconciling'].includes(stage) || (!issued && publicAttempt?.status === 'observed-mined')) && !fundingRecovery && !ownerRecovery && !ownerRecoveryError ? <details className="dex-v2-recovery-details"><summary>DEX recovery details</summary><div className="dex-v2-current-fields" style={{ gridTemplateColumns: '1fr' }}><label>
      Transaction hash (optional)
      <input aria-label="Existing DEX transaction hash" placeholder="0x…" value={existingTransactionHash}
        disabled={checking || walletChanged} onChange={event => setExistingTransactionHash(event.target.value)} />
      <small>Checks a saved Quote, Accept or recovery action. Does not send a transaction or restore private Accept authority.</small>
    </label></div></details> : null}
    {transactionHash ? <a className="dex-v2-progress-transaction" href={`${COTI_TESTNET_NETWORK.blockExplorerUrl}/tx/${transactionHash}`} target="_blank" rel="noreferrer">View transaction</a> : null}
    </CurrentSwapProgress>
    {preparedCandidate ? <details className="dex-v2-token-funding" open={fundingRecovery || undefined}><summary>Get test tokens</summary>
      <CurrentSharedTestTokenControls candidateKey={preparedScope!.key} sharedWalletSession={sharedWalletSession} onInspect={onInspect} disabled={busy || checking || walletChanged || Boolean(pending)} />
    </details> : null}
    {(!preparedCandidate || fundingRecovery || (!candidateReady && swapActivity) || (import.meta.env.DEV && activeJourney && !walletChanged)) ? <details className="dex-v2-setup" open={fundingRecovery || undefined}><summary>Transaction details</summary><div>
      {!preparedCandidate ? <CurrentTokenFundingControls sharedWalletSession={sharedWalletSession} tokenIndex={inputIndex as 0 | 1} maximumInput={fundingAtoms}
        recoveryRequired={fundingRecovery} recoverFunding={fundingPending ?? undefined}
        onReconciled={status => { setFundingPending(null); setFundingRecovery(false); setStage(issued ? 'ready' : 'idle'); setMessage(status); }}
        disabled={busy || checking || walletChanged || unknownOrigin || Boolean(pending) || (Boolean(issued) && stage !== 'ready')} /> : null}
    {!candidateReady && swapActivity ? <aside className="dex-v2-current-warning">
      <ShieldCheck size={19} aria-hidden="true" />
      <div><strong>Contracts not checked yet</strong>
        <button type="button" disabled={!connected || checking || busy || walletChanged} onClick={() => { void checkCandidate(); }}>Check current contracts</button>
      </div>
    </aside> : null}
    {/* CW-097: the engineering timing panel shows only on the Vite development server, where the browser journey checks run. */}
    {import.meta.env.DEV && activeJourney && !walletChanged ? <details aria-label="Local trial timing">
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
    <TradeActionConfirmModal confirmation={confirmation} onCancel={() => resolveConfirmation(false)} onConfirm={() => resolveConfirmation(true)}
      details={confirmation?.title === 'Approve swap token' ? <TokenApprovalChoice token={trialTokens[inputIndex]} spender={candidate.core}
        value={approvalMode} onChange={setApprovalMode}/> : confirmation?.summaryRows.some(row => row.label === 'You pay') ? <details className="trade-action-confirm-details">
        <summary>Price and slippage</summary>
        <p>Price impact includes spread and fees and uses the Pool reference captured for this review. The live header can change. Slippage protects the Quote net rate.</p>
      </details> : null} />
  </section>;
}

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

const DEFAULT_DEX_PAIR: TradingPair = ['BCN', 'HBR'];

export default function DexV2Page({
  priceDisplayInverted = false, selectedPair = DEFAULT_DEX_PAIR, sharedWalletSession,
  onOpenAgent, onNavigateMode, dailyPriceConfig, dailyPriceProvider, marketReference,
  swapCandidate = 'cheap-current'
}: {
  priceDisplayInverted?: boolean; selectedPair?: TradingPair; sharedWalletSession?: SharedWalletSession;
  /** Unused since CW-096: the header pair control reverses the price ratio; the Swap middle button switches Buy and Sell. */
  onPriceDisplayInvertedChange?: (inverted: boolean) => void; onOpenAgent?: () => void;
  onNavigateMode?: (mode: DexMode) => void; dailyPriceConfig?: CurrentDexDailyPriceConfig;
  dailyPriceProvider?: Pick<Eip1193Provider, 'request'>;
  marketReference?: CurrentDexMarketReference;
  swapCandidate?: CurrentCheapDexCandidateKey;
} = {}) {
  const [activeMode, setActiveMode] = useState<DexMode>(() => typeof window === 'undefined' ? 'swap' : resolveDexModeFromPath(window.location.pathname));
  const [activityView, setActivityView] = useState<'orders' | 'history'>('orders');
  useEffect(() => {
    logMobileWalletDiagnostic('dex-mounted');
    return () => logMobileWalletDiagnostic('dex-unmounted');
  }, []);
  useEffect(() => {
    logMobileWalletDiagnostic('dex-view', { mode: activeMode, activityView });
  }, [activeMode, activityView]);
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
  const managementTabs = (className: string) => <nav className={`dex-v2-section-tabs ${className}`} aria-label="Manage views">
    <button type="button" aria-current={activeMode === 'activity' && activityView === 'orders' ? 'page' : undefined} onClick={() => { setActivityView('orders'); selectMode('activity'); }}>Orders</button>
    <button type="button" aria-current={activeMode === 'positions' ? 'page' : undefined} onClick={() => selectMode('positions')}>Positions</button>
    <button type="button" aria-current={activeMode === 'activity' && activityView === 'history' ? 'page' : undefined} onClick={() => { setActivityView('history'); selectMode('activity'); }}>History</button>
  </nav>;
  return <main className={`dex-v2-page${management ? ' dex-v2-manage' : ''}${mobileKeyboardOpen ? ' dex-v2-keyboard-open' : ''}`}>
    <ModeNavigation activeMode={activeMode} onOpenAgent={onOpenAgent} onSelect={selectMode} />
    <section className="dex-v2-main">
      <div className="dex-v2-content-grid">
        <details className="dex-market-chart-host" open={!management || undefined}>
          <summary hidden={!management}>Market chart · {chartPair.join(' / ')}</summary>
          <DexMarketChart baseSymbol={chartPair[0]} quoteSymbol={chartPair[1]} history={dailyHistory.view}
            onHistoryRefresh={dailyHistory.refresh} marketReference={marketReference}
            priceDisplayInverted={priceDisplayInverted} />
        </details>
        <div className="dex-v2-form-column">
          <div className={management ? 'dex-mobile-management-navigation-host' : undefined} hidden={!trade && !management}>
            {trade ? <nav className="dex-v2-section-tabs" aria-label="Trade type">
              {(['swap', 'limit'] as const).map(mode => <button type="button" key={mode} aria-current={activeMode === mode ? 'page' : undefined} onClick={() => selectMode(mode)}>{mode === 'swap' ? 'Swap' : 'Limit'}</button>)}
            </nav> : management ? managementTabs('dex-mobile-management-navigation') : null}
          </div>
          {/* Keep transaction origins and private result scopes alive when users change views. */}
          <div className="dex-v2-workspace-panel" hidden={activeMode !== 'swap'}>
            <CurrentSwapWorkspace priceDisplayInverted={priceDisplayInverted} onInspect={inspect}
              selectedPair={selectedPair} sharedWalletSession={sharedWalletSession} marketReference={marketReference} candidateKey={swapCandidate} visible={activeMode === 'swap'} />
          </div>
          <div className="dex-v2-workspace-panel" hidden={activeMode !== 'limit' && !(activeMode === 'activity' && activityView === 'orders')}>
            <CurrentLimitWorkspace sharedWalletSession={sharedWalletSession} priceDisplayInverted={priceDisplayInverted} candidateKey={swapCandidate} selectedPair={selectedPair} managementNavigation={managementTabs('dex-desktop-management-navigation')} view={activeMode === 'activity' ? 'manage' : 'create'} visible={activeMode === 'limit' || activeMode === 'activity' && activityView === 'orders'} />
          </div>
          <div className="dex-v2-workspace-panel" hidden={!liquidity || activeMode === 'positions'}><CurrentPoolWorkspace sharedWalletSession={sharedWalletSession} priceDisplayInverted={priceDisplayInverted}
            candidateKey={swapCandidate} selectedPair={selectedPair} /></div>
          <div className="dex-v2-workspace-panel" hidden={activeMode !== 'positions'}><CurrentPoolPositionsWorkspace selectedPair={selectedPair} priceDisplayInverted={priceDisplayInverted} sharedWalletSession={sharedWalletSession} candidateKey={swapCandidate} managementNavigation={managementTabs('dex-desktop-management-navigation')} visible={activeMode === 'positions'} /></div>
          <div className="dex-v2-workspace-panel" hidden={activeMode !== 'activity' || activityView !== 'history'}><CurrentDexActivity sharedWalletSession={sharedWalletSession} candidateKey={swapCandidate} managementNavigation={managementTabs('dex-desktop-management-navigation')} visible={activeMode === 'activity' && activityView === 'history'} priceDisplayInverted={priceDisplayInverted} onInspect={inspect} /></div>
        </div>
      </div>
    </section>
  </main>;
}
