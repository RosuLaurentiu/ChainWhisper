import { wasCurrentDexUnsentReleased } from '../../../lib/currentDexSubmission';
import { CURRENT_UNSENT_RELEASED_MESSAGE, currentDexRecordScope } from '../../../lib/currentDexDisplay';
import { useRef, useState } from 'react';
import { formatUnits } from '@coti-io/coti-ethers';
import { resolveBrowserWalletPrivacyState, type SharedWalletSession } from '../../../lib/walletSession';
import { readCurrentSharedDexTestTokens } from '../../../lib/appChain';
import { CURRENT_SHARED_DEX_TOKENS, resolveCurrentSharedTokenDistribution } from '../../../lib/currentSharedDexTokenDistribution';
import { OFFICIAL_COTI_TESTNET_FAUCET_URL } from '../../../lib/officialTestnetFaucet';
import type { CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import { assertCurrentSharedTokenFundingAppAuthority, type CurrentSharedTokenFundingReview } from '../../../lib/currentSharedDexTokenFunding';
import { currentDexPendingStorage, readCurrentDexPendingAttempt, currentDexOwnerRecovery, type CurrentDexOwnerRecoveryView } from '../../../lib/currentDexPendingAttempt';
import type { TradeActionConfirmModel } from '../../../lib/tradeActionConfirm';
import TradeActionConfirmModal from '../../trading/components/TradeActionConfirmModal';
import useTradeActionConfirmationState from '../../trading/hooks/useTradeActionConfirmationState';

type Snapshot = Awaited<ReturnType<typeof readCurrentSharedDexTestTokens>>;
type Token = Snapshot['tokens'][number];
type Funds = Awaited<ReturnType<Awaited<ReturnType<NonNullable<NonNullable<SharedWalletSession['actions']>['getCurrentSharedDexTokenFundsCapability']>>>['read']>>;
type Sender = Awaited<ReturnType<NonNullable<NonNullable<SharedWalletSession['actions']>['getCurrentDexSubmissionCapability']>>>;
type Recover = Awaited<ReturnType<Sender['submitSharedTokenFunding']>>['recover'];
export const sharedTokenFundingConfirmation = (review: CurrentSharedTokenFundingReview): TradeActionConfirmModel => {
  const symbol = CURRENT_SHARED_DEX_TOKENS.find(token => token.address.toLowerCase() === review.token.toLowerCase())?.symbol ?? review.token;
  return {
    title: `${review.action === 'initial' ? 'Claim' : 'Refill'} ${symbol}`, primaryLabel: 'Continue to wallet', fundingMoves: [], stats: [],
    summaryRows: [{ label: 'Amount', value: `${formatUnits(review.amount, review.decimals)} ${symbol}` },
      { label: 'Estimated network fee', value: `${formatUnits(review.gasEstimate * review.gasPrice, 18)} Test COTI` },
      { label: 'Maximum network fee', value: `${formatUnits(review.gasLimit * review.gasPrice, 18)} Test COTI` }],
    message: 'Private Testnet tokens. Your DEX allowance stays unchanged.'
  };
};
const fundingAdmitted = (scope:Parameters<typeof assertCurrentSharedTokenFundingAppAuthority>[0]) => { try { if(scope && typeof scope==='object' && 'candidate' in scope && scope.candidate==='cheap-history')return true; assertCurrentSharedTokenFundingAppAuthority(scope); return true; } catch { return false; } };
export const sharedTestTokenRefillText = (token: Token) => {
  switch (token.refillAvailability) {
    case 'initial-claim-required': return 'Claim the initial tokens first.';
    case 'expired': return 'Distributor expired.';
    case 'exhausted': return 'Refill quota exhausted.';
    case 'cooldown': return `Next refill ${formatRefillTime(token.nextClaimAt)}.`;
    case 'ready': return 'Refill available.';
  }
};
// Local date and time of the next refill, for example "Nov 18, 23:56".
const formatRefillTime = (seconds: bigint) => new Date(Number(seconds) * 1000)
  .toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
// Display balance: thousands separators and at most two decimals; the exact value stays in the title.
const formatBalance = (amount: bigint, decimals: number) =>
  Number(formatUnits(amount, decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 });
const formatPolicyAmount = (amount: bigint) => {
  const [whole, fraction] = formatUnits(amount, 6).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction}` : ''}`;
};

export default function CurrentSharedTestTokenControls({ sharedWalletSession, disabled = false, candidateKey = 'cheap-prepared', onInspect }: {
  sharedWalletSession?: SharedWalletSession; disabled?: boolean; candidateKey?: CurrentCheapDexCandidateKey;
  onInspect?: (view: CurrentDexOwnerRecoveryView) => void;
}) {
  const policy = resolveCurrentSharedTokenDistribution(candidateKey);
  const provider = sharedWalletSession?.browserProvider, owner = sharedWalletSession?.walletAddress ?? '';
  const recordScope = currentDexRecordScope(policy, owner);
  const chainId = sharedWalletSession?.chainId ?? null;
  const getFunds = sharedWalletSession?.actions?.getCurrentSharedDexTokenFundsCapability;
  const getSender = sharedWalletSession?.actions?.getCurrentDexSubmissionCapability;
  const privacyReady = sharedWalletSession ? resolveBrowserWalletPrivacyState({ browserWalletAddress: owner,
    sessionOnboardInfo: sharedWalletSession.sessionOnboardInfo ?? {}, walletAesHealthByAddress: sharedWalletSession.walletAesHealthByAddress }).ownerAesReady : false;
  const context = { provider, owner, chainId, candidateKey, privacyKey: sharedWalletSession?.sessionOnboardInfo?.[owner.toLowerCase()]?.aesKey,
    walletId: sharedWalletSession?.browserWalletId, source: sharedWalletSession?.activeSignerSource,
    privacyReady, onboard: sharedWalletSession?.sessionOnboardInfo, health: sharedWalletSession?.walletAesHealthByAddress, getFunds, getSender };
  const scope = useRef(context), running = useRef(false);
  if ((Object.keys(context) as (keyof typeof context)[]).some(key => context[key] !== scope.current[key])) scope.current = context;
  const [result, setResult] = useState<{ scope: object; value?: Snapshot; funds?: Funds; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false), [recoveryHash, setRecoveryHash] = useState('');
  const [pending, setPending] = useState<{ scope: object; recover: Recover } | null>(null);
  const { confirmation, requestConfirmation, resolveConfirmation } = useTradeActionConfirmationState(scope.current);
  let hasPending = true;
  let otherAction = '', ownerRecovery: ReturnType<typeof currentDexOwnerRecovery> = null;
  const readOwnerRecovery = (saved: ReturnType<typeof readCurrentDexPendingAttempt>) => currentDexOwnerRecovery(saved,
    { chainId: String(chainId), owner, core: policy.core, graph: `0x${policy.graph}` });
  try {
    const saved = readCurrentDexPendingAttempt(currentDexPendingStorage(recordScope)); hasPending = Boolean(saved);
    ownerRecovery = readOwnerRecovery(saved);
    if (saved && saved.phase !== 'token-faucet' && saved.phase !== 'token-refill')
      otherAction = ownerRecovery?.message ?? 'Another DEX action needs verification. Use its Status and recovery controls. Do not resend.';
  } catch (cause) { otherAction = cause instanceof Error ? cause.message : 'The saved action is unavailable. Do not resend.'; }
  const connected = Boolean(provider && owner && chainId === 7082400), current = result?.scope === scope.current ? result : null;
  const admitted = CURRENT_SHARED_DEX_TOKENS.some(token => fundingAdmitted({ candidate: candidateKey, owner, token: token.address,
    action: current?.value?.tokens.find(asset => asset.address.toLowerCase() === token.address.toLowerCase())?.initialClaimAvailability === 'claimed' ? 'refill' : 'initial' }));
  const assertFundsIdentity = (funds: Snapshot) => {
    if (funds.owner.toLowerCase() !== owner.toLowerCase() || funds.core.toLowerCase() !== policy.core.toLowerCase() ||
      funds.graph !== policy.graph || funds.packageSha256 !== policy.packageSha256 || funds.readyToSign !== false) {
      throw new Error('Beta funds candidate or owner changed.');
    }
  };
  const check = async () => {
    if (!provider || !connected || disabled || running.current) return;
    const captured = scope.current;
    const assertCurrent = () => { if (scope.current !== captured) throw new Error('The selected wallet changed. Check beta test tokens again.'); };
    running.current = true; setBusy(true); setResult(null);
    try {
      const value = await readCurrentSharedDexTestTokens({ request: args => provider.request(args), owner, chainId, assertCurrent, candidate: candidateKey });
      assertFundsIdentity(value);
      assertCurrent(); setResult({ scope: captured, value, message: 'Refills checked. Unlock privacy to see your balances.' });
    } catch (error) {
      if (scope.current === captured) setResult({ scope: captured, message: error instanceof Error ? error.message : 'Test-token availability is unavailable. Check again.' });
    } finally { running.current = false; setBusy(false); }
  };
  const reveal = async () => {
    if (!connected || !privacyReady || !getFunds || disabled || running.current) return;
    const captured = scope.current;
    const assertCurrent = () => { if (scope.current !== captured) throw new Error('Owner privacy changed. Check beta funds again.'); };
    running.current = true; setBusy(true); setResult(null);
    try {
      const capability = await getFunds(7082400n, { candidate: candidateKey }); assertCurrent();
      const funds = await capability.read(); assertCurrent();
      assertFundsIdentity(funds);
      if (funds.owner.toLowerCase() !== owner.toLowerCase() || funds.privateFundsVerified !== true || funds.readyToSign !== false) {
        throw new Error('Private beta funds owner changed.');
      }
      setResult({ scope: captured, value: funds, funds, message: 'Balances and refills checked.' });
    } catch (error) {
      if (scope.current === captured) setResult({ scope: captured, message: error instanceof Error ? error.message : 'Private beta funds are unavailable.' });
    } finally { running.current = false; setBusy(false); }
  };
  const claim = async (action: 'initial' | 'refill', token: string) => {
    if (!connected || !privacyReady || !getSender || !fundingAdmitted({candidate:candidateKey,owner:sharedWalletSession?.walletAddress??'',token,action}) || disabled || running.current || blocked || hasPending) return;
    const captured = scope.current, assertCurrent = () => { if (scope.current !== captured) throw new Error('Owner funding session changed. Check again.'); };
    running.current = true; setBusy(true); setResult(null);
    try {
      const sender = await getSender(7082400n, { candidate: candidateKey }); assertCurrent();
      const prepared = await sender.prepareSharedTokenFunding({ action, token, confirm: async review => {
        assertCurrent(); const yes = await requestConfirmation(sharedTokenFundingConfirmation(review)); assertCurrent(); return yes;
      } }); assertCurrent();
      if (!prepared) { setResult({ scope: captured, message: 'Beta token claim cancelled. Check funds before another action.' }); return; }
      setBlocked(true);
      setResult({ scope: captured, message: 'Checking the claim before the wallet request.' });
      const sent = await sender.submitSharedTokenFunding(prepared, () => {
        assertCurrent(); setResult({ scope: captured, message: 'Confirm the claim in your wallet.' });
      }); assertCurrent();
      setPending({ scope: captured, recover: sent.recover });
      setResult({ scope: captured, message: 'Claim submitted. Checking confirmation and private credit.' });
      const receipt = await sender.waitForCurrentCheapReceipt(sent.transactionHash); assertCurrent();
      if (!receipt) { setResult({ scope: captured, message: 'Claim is pending. Check confirmation; do not resend.' }); return; }
      const verified = await sent.recover(); assertCurrent(); assertFundsIdentity(verified.funds);
      if (!verified.privateAccountingVerified || !verified.funds.privateFundsVerified) throw new Error('Private claim credit is not verified. Do not resend.');
      setPending(null); setBlocked(false);
      setResult({ scope: captured, value: verified.funds, funds: verified.funds, message: verified.fundingOutcome === 'verified'
        ? 'Claim confirmed. Your private balance is updated.' : 'Claim reverted. Exact private state is unchanged.' });
    } catch (error) {
      const releasedClaim = wasCurrentDexUnsentReleased(error);
      if (scope.current === captured && releasedClaim) setBlocked(false);
      if (scope.current === captured) setResult({ scope: captured, message: releasedClaim ? CURRENT_UNSENT_RELEASED_MESSAGE : error instanceof Error ? error.message : 'Beta token claim failed. Do not resend an uncertain action.' });
    } finally { running.current = false; setBusy(false); }
  };
  const reconcile = async () => {
    if (!connected || !privacyReady || !getSender || disabled || running.current) return;
    const captured = scope.current, assertCurrent = () => { if (scope.current !== captured) throw new Error('Owner funding session changed. Check again.'); };
    running.current = true; setBusy(true); setResult(null);
    try {
      const savedAttempt = readCurrentDexPendingAttempt(currentDexPendingStorage(recordScope));
      if (savedAttempt && savedAttempt.phase !== 'token-faucet' && savedAttempt.phase !== 'token-refill') {
        const target = readOwnerRecovery(savedAttempt);
        setResult({ scope: captured, message: target?.message ?? 'Another DEX action needs verification. Use its Status and recovery controls. Do not resend.' }); return;
      }
      const sender = await getSender(7082400n, { candidate: candidateKey }); assertCurrent();
      const exact = pending?.scope === captured ? await pending.recover() : null; assertCurrent();
      const observed = exact ? null : await sender.recoverPendingSharedTokenFunding(recoveryHash.trim() || savedAttempt?.txHash || undefined); assertCurrent();
      if (observed?.status === 'released-unsent') { setPending(null); setBlocked(false); setResult({ scope: captured, message: CURRENT_UNSENT_RELEASED_MESSAGE }); return; }
      if (observed && !['observed-mined', 'observed-reverted'].includes(observed.status)) throw new Error(observed.status === 'manual-reconciliation-required'
        ? 'Beta funding has no saved hash. Enter its existing hash. Do not resend.' : 'Beta funding is pending. Check later; do not resend.');
      const funds = exact?.funds ?? await sender.readSharedTokenFunding(); assertCurrent();
      assertFundsIdentity(funds);
      if (funds.owner.toLowerCase() !== owner.toLowerCase() || !funds.privateFundsVerified || funds.readyToSign !== false) throw new Error('Beta funding owner changed.');
      const unresolved = Boolean(observed && 'verificationBlocked' in observed && observed.verificationBlocked);
      setPending(null); setBlocked(unresolved); setRecoveryHash('');
      setResult({ scope: captured, value: funds, funds, message: exact ? exact.fundingOutcome === 'verified'
        ? 'Claim confirmed. Your private balance is updated.' : 'Claim reverted. Exact private state is unchanged.'
        : unresolved ? observed && 'privateCreditVerified' in observed && observed.privateCreditVerified
          ? 'Private receipt credit verified. The earlier balance check is unresolved; do not resend.'
          : 'Claim reverted. The earlier balance check is unresolved; do not resend.'
        : observed?.privateAccountingVerified ? observed.status === 'observed-mined'
          ? 'Claim confirmed. Your private balance is updated.' : 'Claim reverted. Exact private state is unchanged.'
          : observed && 'privateCreditVerified' in observed && observed.privateCreditVerified
            ? 'Claim confirmed. Private receipt credit verified; balances are current.'
          : 'Current private funds checked. Reload recovery does not prove the previous private balance change.' });
    } catch (error) {
      setBlocked(true);
      if (scope.current === captured) setResult({ scope: captured, message: error instanceof Error ? error.message : 'Beta funding confirmation is unavailable. Do not resend.' });
    } finally { running.current = false; setBusy(false); }
  };
  const setupMessage = !provider || !owner ? 'Connect your wallet to check availability.'
    : chainId !== 7082400 ? 'Switch your wallet to COTI Testnet.'
      : otherAction || (blocked || pending || hasPending ? 'A previous transaction needs confirmation. Check it below; do not resend.'
        : !admitted ? 'Token signing is held until beta setup is complete.'
          : !privacyReady ? 'Unlock privacy to see your balances and claim tokens.'
          : busy || disabled ? 'Wait for the current action to finish.'
            : !getSender ? 'Token funding is unavailable for this wallet session.'
              : !current?.funds ? 'Check balances and refills before claiming tokens.' : '');
  // Owner decision 2026-11-18: one check button (private read when privacy is unlocked, else the public read),
  // one row per token, one Details for the panel, and confirmation tools under Status and recovery.
  const canReveal = privacyReady && Boolean(getFunds);
  const checkAll = () => { void (canReveal ? reveal() : check()); };
  const recoveryOpen = Boolean(!otherAction && (blocked || pending || hasPending));
  return <section className="dex-v2-beta-tokens" aria-label="Beta private test tokens">
    <div className="dex-v2-beta-token-tools">
      <button type="button" disabled={!connected || busy || disabled} onClick={checkAll}>{canReveal ? 'Check balances and refills' : 'Check refills'}</button>
    </div>
    <div className="dex-v2-beta-token-guidance" id="beta-token-setup">
      {setupMessage ? <p>{setupMessage}</p> : null}
    </div>
    <div className="dex-v2-beta-token-grid">{CURRENT_SHARED_DEX_TOKENS.map(token => {
      const publicToken = current?.value?.tokens.find(t => t.address.toLowerCase() === token.address.toLowerCase());
      const funds = current?.funds?.tokens.find(t => t.address.toLowerCase() === token.address.toLowerCase());
      const action: 'initial' | 'refill' = !publicToken || publicToken.initialClaimAvailability === 'ready' ? 'initial' : 'refill';
      const availability = action === 'initial' ? publicToken?.initialClaimAvailability : publicToken?.refillAvailability;
      const amount = formatPolicyAmount(action === 'initial' ? policy.initialAmount : policy.refillAmount);
      const allowed = Boolean(funds && (action === 'initial' ? funds.initialClaimAvailability === 'ready' : funds.refillAvailability === 'ready'));
      const held = !connected || !privacyReady || !getSender || !fundingAdmitted({candidate:candidateKey,owner:sharedWalletSession?.walletAddress??'',token:token.address,action}) || !funds || !allowed || busy || disabled || blocked || hasPending;
      const reason = !publicToken ? 'Not checked'
        : action === 'initial' ? publicToken.initialClaimAvailability === 'ready' ? 'Initial claim available.' : 'Initial claim already used.'
          : sharedTestTokenRefillText(publicToken);
      const actionId = `beta-token-action-${token.symbol.toLowerCase()}`;
      const actionStatus = !publicToken ? 'Not checked'
        : availability !== 'ready' ? reason
          : funds && !allowed ? 'Check balances again.'
            : action === 'initial' ? 'Initial claim available' : 'Refill available';
      return <article className="dex-v2-beta-token-card" key={token.address}>
        <header><strong>{token.symbol}</strong>{funds ? <span title={`${formatUnits(funds.balance, funds.decimals)} ${token.symbol}`}>{formatBalance(funds.balance, funds.decimals)}</span> : null}</header>
        <p className="dex-v2-beta-token-status" id={actionId} role="status">{actionStatus}</p>
        <button type="button" aria-describedby={`beta-token-setup ${actionId}`} disabled={held || availability !== 'ready'} onClick={() => { void claim(action, token.address); }}>{action === 'initial' ? 'Claim' : 'Refill'} {amount} {token.symbol}</button>
      </article>;
    })}</div>
    <details className="dex-v2-beta-token-details"><summary>Details</summary>
      <p>Initial claim: {formatPolicyAmount(policy.initialAmount)} tokens once per wallet and token. Refill: {formatPolicyAmount(policy.refillAmount)} tokens every 24 hours while quota remains.</p>
      <p>Distributor expiry: {current?.value ? new Date(Number(current.value.vault.expiresAt) * 1000).toLocaleString() : 'not checked'}{current?.value ? ` · checked at block ${current.value.head.number.toString()}` : ''}</p>
      <dl>{CURRENT_SHARED_DEX_TOKENS.map(token => {
        const publicToken = current?.value?.tokens.find(t => t.address.toLowerCase() === token.address.toLowerCase());
        const funds = current?.funds?.tokens.find(t => t.address.toLowerCase() === token.address.toLowerCase());
        return <div key={token.address}><dt>{token.symbol}</dt><dd>
          {publicToken ? `Quota ${formatUnits(publicToken.quota, publicToken.decimals)}` : 'Quota not checked'}
          {' · '}{funds ? `DEX allowance ${formatUnits(funds.allowance, funds.decimals)}` : 'DEX allowance not checked'}
          {' · '}{token.address}</dd></div>;
      })}</dl>
    </details>
    <div className="dex-v2-beta-token-tools dex-v2-beta-token-footer">{ownerRecovery && onInspect ? <button type="button" disabled={!connected || busy || disabled} onClick={() => {
      try { const target = readOwnerRecovery(readCurrentDexPendingAttempt(currentDexPendingStorage(recordScope))); if (target) onInspect(target.view); }
      catch (cause) { setResult({ scope: scope.current, message: cause instanceof Error ? cause.message : 'Saved action unavailable. Do not resend.' }); }
    }}>{ownerRecovery.label}</button> : null}
      {ownerRecovery?.alternateView && onInspect ? <button type="button" disabled={!connected || busy || disabled} onClick={() => {
        try { const target = readOwnerRecovery(readCurrentDexPendingAttempt(currentDexPendingStorage(recordScope))); if (target?.alternateView) onInspect(target.alternateView); }
        catch (cause) { setResult({ scope: scope.current, message: cause instanceof Error ? cause.message : 'Saved action unavailable. Do not resend.' }); }
      }}>Open top-up recovery</button> : null}
      <a href={OFFICIAL_COTI_TESTNET_FAUCET_URL} target="_blank" rel="noopener noreferrer">Get Test COTI for gas</a>
    </div>
    {!(ownerRecovery && onInspect) ? <details className="dex-v2-beta-token-recovery" open={recoveryOpen || undefined}><summary>Status and recovery</summary>
      <button type="button" disabled={!connected || !privacyReady || !getSender || busy || disabled || Boolean(otherAction)} onClick={() => { void reconcile(); }}>Check confirmation</button>
      {recoveryOpen ? <><label>Existing beta funding transaction hash<input aria-label="Existing beta funding transaction hash" value={recoveryHash}
        disabled={!connected || busy || disabled} onChange={event => setRecoveryHash(event.target.value)} placeholder="0x…" /></label>
      <p>Enter the existing claim hash. Do not resend.</p></> : null}
    </details> : null}
    <p role="status">{current?.message || (busy ? 'Checking test tokens…' : '')}</p>
    <TradeActionConfirmModal confirmation={confirmation} onCancel={() => resolveConfirmation(false)} onConfirm={() => resolveConfirmation(true)} />
  </section>;
}
