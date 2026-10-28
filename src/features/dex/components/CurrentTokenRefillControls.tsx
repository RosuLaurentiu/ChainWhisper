import { useRef, useState } from 'react';
import { formatUnits } from '@coti-io/coti-ethers';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { resolveBrowserWalletPrivacyState } from '../../../lib/walletSession';
import { CURRENT_CHEAP_DEX_CANDIDATE as c, assertCurrentCheapDexNativeAdmission } from '../../../lib/dexV2Deployment';
import { CURRENT_NATIVE_TOKEN_REFILL_BINDING, assertCurrentNativeTokenRefillBinding } from '../../../lib/currentDexNativeTokenRefillDeployment';
import { currentDexPendingStorage, readCurrentDexPendingAttempt } from '../../../lib/currentDexPendingAttempt';
import type { TradeActionConfirmModel } from '../../../lib/tradeActionConfirm';
import TradeActionConfirmModal from '../../trading/components/TradeActionConfirmModal';
import useTradeActionConfirmationState from '../../trading/hooks/useTradeActionConfirmationState';

type Sender = Awaited<ReturnType<NonNullable<NonNullable<SharedWalletSession['actions']>['getCurrentDexSubmissionCapability']>>>;
type Snapshot = Awaited<ReturnType<Sender['readCurrentTokenRefillSubmission']>>;
type Recover = Awaited<ReturnType<Sender['submitCurrentTokenRefill']>>['recover'];
export const currentRefillUiAdmitted = () => {
  try { assertCurrentCheapDexNativeAdmission(c); assertCurrentNativeTokenRefillBinding('cheap-current', CURRENT_NATIVE_TOKEN_REFILL_BINDING); return true; }
  catch { return false; }
};
export const currentRefillConfirmation = (review: { token: string; amount: bigint; vault: string; cooldown: bigint; expiresAt: bigint }): TradeActionConfirmModel => ({
  title: 'Get test tokens: refill', primaryLabel: 'Continue to wallet', fundingMoves: [], stats: [],
  summaryRows: [{ label: 'Test token', value: review.token }, { label: 'Refill amount', value: `${formatUnits(review.amount, 18)} tokens` },
    { label: 'Cooldown', value: `${review.cooldown / 3600n} hours per wallet and token` }, { label: 'Distributor', value: review.vault },
    { label: 'Expires (UTC)', value: new Date(Number(review.expiresAt) * 1000).toISOString() }],
  message: 'This Testnet claim adds 1000 private test tokens from a finite distributor. It does not change your DEX allowance. Check the exact private credit after confirmation.'
});
export const checkCurrentRefill = async (sender: Pick<Sender, 'readCurrentTokenRefillSubmission' | 'recoverPendingCurrentTokenRefill'>, recover?: Recover, knownHash?: string) => {
  const result = recover ? await recover() : await sender.recoverPendingCurrentTokenRefill(knownHash);
  if (result && 'status' in result && !['observed-mined', 'observed-reverted'].includes(result.status)) {
    throw new Error(result.status === 'manual-reconciliation-required' ? 'Refill has no saved hash. Enter its existing transaction hash. Do not resend.' : 'Refill is pending. Check confirmation later. Do not resend.');
  }
  // Read private balances only after canonical reconciliation. A new baseline is not historical accounting.
  const value = await sender.readCurrentTokenRefillSubmission();
  return { value, privateAccountingVerified: Boolean(result?.privateAccountingVerified), reverted: Boolean(result && ('refillOutcome' in result ? result.refillOutcome === 'reverted' : result.status === 'observed-reverted')) };
};
export const currentRefillAvailabilityText = (state: Snapshot['refills'][number]) => {
  switch (state.availability) {
    case 'initial-claim-required': return 'Claim the original one-time faucet first.';
    case 'expired': return 'The test-token distributor has expired.';
    case 'exhausted': return 'The finite test-token quota is exhausted.';
    case 'cooldown': return `Cooldown: next refill after ${new Date(Number(state.nextClaimAt) * 1000).toISOString()} (UTC).`;
    case 'ready': return 'Ready for a 1000-token refill.';
  }
};

export default function CurrentTokenRefillControls({ sharedWalletSession, tokenIndex, disabled = false, onReconciled }: {
  sharedWalletSession?: SharedWalletSession; tokenIndex: 0 | 1; disabled?: boolean; onReconciled?: (message: string) => void;
}) {
  const [state, setState] = useState<{ value: Snapshot; scope: object } | null>(null);
  const [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false), [message, setStoredMessage] = useState('');
  const [pending, setPending] = useState<{ recover: Recover; scope: object } | null>(null), [recoveryHash, setRecoveryHash] = useState('');
  const getSender = sharedWalletSession?.actions?.getCurrentDexSubmissionCapability;
  const privacyReady = sharedWalletSession ? resolveBrowserWalletPrivacyState({ browserWalletAddress: sharedWalletSession.walletAddress,
    sessionOnboardInfo: sharedWalletSession.sessionOnboardInfo ?? {}, walletAesHealthByAddress: sharedWalletSession.walletAesHealthByAddress }).ownerAesReady : false;
  const context = { owner: sharedWalletSession?.walletAddress.toLowerCase(), chain: sharedWalletSession?.chainId,
    provider: sharedWalletSession?.browserProvider, source: sharedWalletSession?.activeSignerSource, walletId: sharedWalletSession?.browserWalletId,
    privacyReady, onboard: sharedWalletSession?.sessionOnboardInfo, health: sharedWalletSession?.walletAesHealthByAddress, getSender, tokenIndex };
  const scope = useRef(context), inFlight = useRef(false);
  if ((Object.keys(context) as (keyof typeof context)[]).some(k => context[k] !== scope.current[k])) scope.current = context;
  const messageScope = useRef<object | null>(null);
  const setMessage = (text: string) => { messageScope.current = scope.current; setStoredMessage(text); };
  const assertScope = (s: object) => { if (scope.current !== s) throw new Error('Refill owner, token or privacy session changed. Check again.'); };
  const connected = Boolean(context.owner && context.chain === Number(c.chainId) && context.provider && getSender && privacyReady);
  const current = state?.scope === scope.current ? state.value : null, admitted = currentRefillUiAdmitted();
  let saved = null, journalUnavailable = false;
  try { saved = readCurrentDexPendingAttempt(currentDexPendingStorage()); } catch { journalUnavailable = true; }
  const hasPending = Boolean(saved || blocked || pending), knownBlocked = saved?.phase === 'token-refill' && saved.verificationBlocked;
  const { confirmation, requestConfirmation, resolveConfirmation } = useTradeActionConfirmationState(scope.current);
  const fail = (error: unknown, captured: object) => setMessage(scope.current !== captured
    ? 'Refill owner, token or privacy session changed. Check again.'
    : error instanceof Error ? error.message : 'Refill check failed. Do not resend an uncertain action.');
  const check = async () => {
    if (!connected || disabled || inFlight.current) return;
    inFlight.current = true; setBusy(true); setState(null);
    const s = scope.current;
    try {
      const sender = await getSender!(BigInt(c.chainId)); assertScope(s);
      const result = await checkCurrentRefill(sender, pending?.scope === s ? pending.recover : undefined, recoveryHash.trim() || undefined); assertScope(s);
      setState({ value: result.value, scope: s }); setPending(null); setBlocked(false); setRecoveryHash('');
      const status = result.reverted ? 'Refill reverted. Current private funds checked; no new send.' : result.privateAccountingVerified ?
        'Confirmed: exact 1000-token private refill verified. Current funds checked.' : 'Current private funds checked. Metadata recovery does not prove historical private accounting.';
      setMessage(status); onReconciled?.(status);
    } catch (error) { setBlocked(true); fail(error, s); } finally { inFlight.current = false; setBusy(false); }
  };
  const claim = async () => {
    if (!connected || !admitted || disabled || inFlight.current || hasPending || journalUnavailable || current?.refills[tokenIndex].availability !== 'ready') return;
    inFlight.current = true; setBusy(true); const s = scope.current; setState(null); setMessage('Awaiting refill review.');
    try {
      const sender = await getSender!(BigInt(c.chainId)); assertScope(s);
      const prepared = await sender.prepareCurrentTokenRefill({ tokenIndex, confirm: async review => {
        assertScope(s); const yes = await requestConfirmation(currentRefillConfirmation(review)); assertScope(s); return yes;
      } }); assertScope(s);
      if (!prepared) { setMessage('Refill review cancelled. Check availability before another action.'); return; }
      setBlocked(true); setMessage('Awaiting wallet signature. An uncertain result stays pending; do not resend.');
      const sent = await sender.submitCurrentTokenRefill(prepared); assertScope(s);
      setPending({ recover: sent.recover, scope: s }); setMessage('Refill submitted. Check confirmation before another action.');
      // No automatic retry or recovery. The owner uses Check refill confirmation explicitly.
    } catch (error) { fail(error, s); } finally { inFlight.current = false; setBusy(false); }
  };
  return <section aria-label="Get test tokens refill">
    <h4>Get test tokens: refill</h4>
    <p>Testnet only: 1000 private test tokens per refill, with a 24-hour cooldown per wallet and token. Finite quota: 1,000,000 tokens per token. The original one-time faucet and exact DEX allowance are separate.</p>
    <p>Distributor expires {new Date(Number(CURRENT_NATIVE_TOKEN_REFILL_BINDING.expiresAt) * 1000).toISOString()} (UTC).</p>
    {!admitted ? <p>Refill unavailable: the active DEX candidate has no refill admission. Writes are held.</p> : null}
    {current ? <><p>{currentRefillAvailabilityText(current.refills[tokenIndex])} Remaining subsidy quota: {formatUnits(current.refills[tokenIndex].quota, 18)} tokens.</p>
      <p aria-label="Private refill balance">Private selected-token balance: {formatUnits(current.tokens[tokenIndex].balance, 18)} tokens. DEX allowance: {formatUnits(current.tokens[tokenIndex].allowance, 18)} tokens.</p></> : null}
    <div className="dex-v2-current-actions">
      <button type="button" disabled={!connected || busy || disabled} onClick={() => { void check(); }}>Check refill availability</button>
      <button type="button" disabled={!connected || !admitted || busy || disabled || hasPending || journalUnavailable || current?.refills[tokenIndex].availability !== 'ready'} onClick={() => { void claim(); }}>Refill 1000 test tokens</button>
      <button type="button" disabled={!connected || busy || disabled} onClick={() => { void check(); }}>Check refill confirmation</button>
    </div>
    {hasPending || knownBlocked || journalUnavailable ? <details><summary>Refill recovery details</summary><label>Existing refill transaction hash
      <input aria-label="Existing refill transaction hash" value={recoveryHash} onChange={event => setRecoveryHash(event.target.value)} disabled={!connected || busy || disabled} placeholder="0x…" />
    </label><p>Use only the existing claim hash. Unknown wallet results remain locked. Recovery verifies the saved owner, nonce and claim; it never resends or clears a known verification failure.</p></details> : null}
    <p role="status">{knownBlocked ? 'Refill verification is blocked. Manual reconciliation is required; do not resend.' : (messageScope.current === scope.current ? message : '') || (connected ? 'Check the selected token before a refill.' : 'Connect the Testnet owner and unlock privacy to check refill availability.')}</p>
    <TradeActionConfirmModal confirmation={confirmation} onCancel={() => resolveConfirmation(false)} onConfirm={() => resolveConfirmation(true)} />
  </section>;
}
