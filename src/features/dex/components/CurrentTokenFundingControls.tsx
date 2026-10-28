import { useRef, useState } from 'react';
import { formatUnits } from '@coti-io/coti-ethers';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { resolveBrowserWalletPrivacyState } from '../../../lib/walletSession';
import { CURRENT_CHEAP_DEX_CANDIDATE as c } from '../../../lib/dexV2Deployment';
import type { CurrentTokenFundingState, CurrentTokenFundingResult } from '../../../lib/currentDexTokenFunding';
import { CURRENT_NATIVE_SWAP_LIMITS } from '../../../lib/currentDexNativeSwapPolicy';
import TradeActionConfirmModal from '../../trading/components/TradeActionConfirmModal';
import useTradeActionConfirmationState from '../../trading/hooks/useTradeActionConfirmationState';
import CurrentTestnetGasControls from './CurrentTestnetGasControls';
import CurrentTokenRefillControls from './CurrentTokenRefillControls';
import CurrentSharedTestTokenControls from './CurrentSharedTestTokenControls';
// Bounded Testnet funding was reviewed. Sends require an explicit owner action.
export const CURRENT_TOKEN_FUNDING_UI_ADMITTED = true;
type FundingSender = Pick<Awaited<ReturnType<NonNullable<NonNullable<SharedWalletSession['actions']>['getCurrentDexSubmissionCapability']>>>, 'readCurrentTokenFunding' | 'recoverPendingCurrentTokenFunding'>;
export const checkCurrentFunding = async (sender: FundingSender, tokenIndex: 0 | 1, recover?: () => Promise<CurrentTokenFundingResult>, knownHash?: string) => {
  if (recover) {
    const verified = await recover();
    if (verified.fundingOutcome === 'reverted') return verified;
    return { ...await sender.readCurrentTokenFunding(tokenIndex), fundingOutcome: verified.fundingOutcome };
  }
  const observed = await sender.recoverPendingCurrentTokenFunding(knownHash);
  if (observed && !['observed-mined', 'observed-reverted'].includes(observed.status)) {
    throw new Error(observed.status === 'manual-reconciliation-required'
      ? 'The saved funding action has no hash. Open Recovery details and enter its existing hash. Do not resend.'
      : 'Funding is not confirmed yet. Check funding and continue later. Do not resend.');
  }
  // Canonical metadata alone is not private accounting. Read the current funds before unlocking the form.
  return sender.readCurrentTokenFunding(tokenIndex);
};
export const currentFundingConfirmation = (review: { tokenIndex: number; amount: bigint; previousAllowance: bigint; spender: string }, action: 'faucet' | 'approve') => ({
  title: action === 'faucet' ? 'Claim current test-token faucet' : 'Approve exact current input', primaryLabel: 'Continue', fundingMoves: [], stats: [],
  summaryRows: [{ label: 'Test token', value: String(review.tokenIndex) }, { label: 'Amount (tokens)', value: formatUnits(review.amount, 18) },
    { label: 'Previous Core allowance (tokens)', value: formatUnits(review.previousAllowance, 18) }, { label: 'Core spender', value: review.spender }],
  message: action === 'faucet' ? 'This one-time faucet publicly mints 10000 test tokens. Your private balance is checked after receipt.' : 'This replaces only the current Core allowance with this finite amount. It is not unlimited approval.'
});

export default function CurrentTokenFundingControls({ sharedWalletSession, tokenIndex, maximumInput, disabled, recoveryRequired = false, recoverFunding, onReconciled }: {
  sharedWalletSession?: SharedWalletSession; tokenIndex: 0 | 1; maximumInput: string; disabled: boolean;
  recoveryRequired?: boolean; recoverFunding?: () => Promise<CurrentTokenFundingResult>; onReconciled?: (message: string) => void;
}) {
  const [state, setState] = useState<{ value: CurrentTokenFundingState; scope: object } | null>(null);
  const [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false), [message, setStoredMessage] = useState('');
  const [pending, setPending] = useState<{ recover: () => Promise<CurrentTokenFundingResult>; scope: object } | null>(null);
  const [recoveryHash, setRecoveryHash] = useState('');
  const getSender = sharedWalletSession?.actions?.getCurrentDexSubmissionCapability;
  const privacyReady = sharedWalletSession ? resolveBrowserWalletPrivacyState({ browserWalletAddress: sharedWalletSession.walletAddress,
    sessionOnboardInfo: sharedWalletSession.sessionOnboardInfo ?? {}, walletAesHealthByAddress: sharedWalletSession.walletAesHealthByAddress }).ownerAesReady : false;
  const context = { owner: sharedWalletSession?.walletAddress.toLowerCase(), chain: sharedWalletSession?.chainId,
    provider: sharedWalletSession?.browserProvider, source: sharedWalletSession?.activeSignerSource,
    walletId: sharedWalletSession?.browserWalletId, privacyReady, onboard: sharedWalletSession?.sessionOnboardInfo,
    health: sharedWalletSession?.walletAesHealthByAddress, getSender, tokenIndex, maximumInput };
  const scope = useRef(context), inFlight = useRef(false);
  if ((Object.keys(context) as (keyof typeof context)[]).some(k => context[k] !== scope.current[k])) scope.current = context;
  const messageScope = useRef<object | null>(null);
  const setMessage = (text: string) => { messageScope.current = scope.current; setStoredMessage(text); };
  const assertScope = (s: object) => { if (scope.current !== s) throw new Error('Funding owner, input or wallet session changed. Check again.'); };
  const connected = Boolean(context.owner && context.chain === Number(c.chainId) && context.provider && getSender && privacyReady);
  const current = state?.scope === scope.current ? state.value : null;
  const amount = /^[1-9]\d*$/.test(maximumInput) ? BigInt(maximumInput) : 0n;
  const { confirmation, requestConfirmation, resolveConfirmation } = useTradeActionConfirmationState(scope.current);
  const fail = (e: unknown, captured: object) => setMessage(scope.current !== captured
    ? 'Funding owner, input or wallet session changed. Check again.'
    : e instanceof Error ? e.message : 'Current-token check failed. Do not resend an uncertain action.');
  const action = async (action: 'faucet' | 'approve') => {
    if (!CURRENT_TOKEN_FUNDING_UI_ADMITTED || !current || !connected || inFlight.current || blocked || disabled || amount <= 0n) return;
    if (action === 'approve' && amount > CURRENT_NATIVE_SWAP_LIMITS.maximumInput) return;
    inFlight.current = true; const s = scope.current; setBusy(true); setState(null);
    try {
      const sender = await getSender!(BigInt(c.chainId)); assertScope(s);
      const prepared = await sender.prepareCurrentTokenFunding({ tokenIndex, action, amount, confirm: async review => {
        assertScope(s); const yes = await requestConfirmation(currentFundingConfirmation(review, action));
        assertScope(s); return yes;
      } });
      assertScope(s); if (!prepared) { setMessage('Current-token action cancelled. Check again before another action.'); return; }
      setBlocked(true); const sent = await sender.submitCurrentTokenFunding(prepared); assertScope(s);
      setPending({ recover: sent.recover, scope: s }); setMessage('Current-token action submitted. Check its exact private result before another send.');
      if (!await sender.waitForCurrentCheapReceipt(sent.transactionHash)) return;
      assertScope(s);
      const value = await sent.recover(); assertScope(s);
      if (value.fundingOutcome !== 'reverted') setState({ value, scope: s });
      setPending(null); setBlocked(false);
      setMessage(value.fundingOutcome === 'reverted' ? 'Funding transaction reverted. Private state is unchanged.' : 'Exact private funding result verified. Continue with Get Quote or Review and Accept.');
    } catch (e) { fail(e, s); } finally { inFlight.current = false; setBusy(false); }
  };
  const reconcile = async () => {
    if (!connected || inFlight.current || disabled) return; inFlight.current = true; setBusy(true); setState(null);
    const s = pending?.scope ?? scope.current;
    try {
      assertScope(s);
      const sender = await getSender!(BigInt(c.chainId)); assertScope(s);
      const value = await checkCurrentFunding(sender, tokenIndex, pending?.recover ?? recoverFunding, recoveryHash.trim() || undefined); assertScope(s);
      const reverted = 'fundingOutcome' in value && value.fundingOutcome === 'reverted';
      if (!reverted) setState({ value, scope: s });
      const status = reverted ? 'Funding reverted. Private state is unchanged.' :
        'fundingOutcome' in value ? 'Exact private funding result verified. Continue with Get Quote or Review and Accept.' :
          'Private current-token balance and Core allowance verified. Continue with Get Quote or Review and Accept.';
      onReconciled?.(status);
      setBlocked(false); setPending(null); setRecoveryHash(''); setMessage(status);
    } catch (e) { setBlocked(true); fail(e, s); } finally { inFlight.current = false; setBusy(false); }
  };
  return <details className="dex-v2-current-funding" aria-label="Current trial-token funding">
    <summary>Test-token funding and exact allowance</summary>
    <CurrentTestnetGasControls sharedWalletSession={sharedWalletSession} onReturn={() => { void reconcile(); }} />
    <CurrentSharedTestTokenControls sharedWalletSession={sharedWalletSession} disabled={disabled || busy} />
    <p>Current Test token {tokenIndex} uses 18 decimals. Enter normal token amounts in the swap form; 1 means one token. Conversion to on-chain units is exact. Faucet credit is public test data; private balances and allowances stay local.</p>
    <p>This funding trial permits at most {formatUnits(CURRENT_NATIVE_SWAP_LIMITS.maximumInput, 18)} test tokens per finite approval. This is not a product amount limit.</p>
    {!CURRENT_TOKEN_FUNDING_UI_ADMITTED ? <p>Funding writes await the frozen local review. Private checks and reconciliation remain available.</p> : null}
    {current ? <p aria-label="Private current-token readiness">Balance {formatUnits(current.balance, 18)} tokens; Core allowance {formatUnits(current.allowance, 18)} tokens. {amount > 0n && current.balance >= amount && current.allowance >= amount ? 'Ready for this input.' : 'Funding or finite allowance is required.'}</p> : null}
    <div className="dex-v2-current-actions">
    <button type="button" disabled={!connected || busy || disabled} onClick={() => { void reconcile(); }}>Check current input funds</button>
    <button type="button" disabled={!CURRENT_TOKEN_FUNDING_UI_ADMITTED || !current || busy || blocked || disabled || amount <= 0n || current.claimed || current.balance >= amount} onClick={() => { void action('faucet'); }}>Claim current test-token faucet</button>
    <button type="button" disabled={!CURRENT_TOKEN_FUNDING_UI_ADMITTED || !current || busy || blocked || disabled || amount <= 0n || amount > CURRENT_NATIVE_SWAP_LIMITS.maximumInput || current.balance < amount || current.allowance >= amount} onClick={() => { void action('approve'); }}>Approve exact input allowance</button>
    <button type="button" disabled={!connected || busy || disabled} onClick={() => { void reconcile(); }}>Check funding status</button>
    </div>
    {blocked || pending || recoveryRequired ? <details><summary>Recovery details</summary><label>Existing funding transaction hash (optional)
      <input aria-label="Existing funding transaction hash" value={recoveryHash} onChange={event => setRecoveryHash(event.target.value)} disabled={busy || disabled || !connected} placeholder="0x…" />
    </label>
    <p>This hash is only used to verify an existing faucet or approval call against its saved owner, nonce and call. It cannot send a transaction or bypass a known private-accounting failure.</p></details> : null}
    <CurrentTokenRefillControls sharedWalletSession={sharedWalletSession} tokenIndex={tokenIndex} disabled={disabled || busy} onReconciled={onReconciled} />
    <p role="status">{(messageScope.current === scope.current ? message : '') || 'Connect the owner and unlock privacy, then check the selected current input token.'}</p>
    <TradeActionConfirmModal confirmation={confirmation} onCancel={() => resolveConfirmation(false)} onConfirm={() => resolveConfirmation(true)} />
  </details>;
}

