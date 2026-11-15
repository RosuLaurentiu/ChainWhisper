import { useEffect, useMemo, useRef, useState } from 'react';
import type { SharedWalletSession } from '../../lib/walletSession';
import { resolveBrowserWalletPrivacyState } from '../../lib/walletSession';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as candidate } from '../../lib/dexV2Deployment';
import { MAX_TOKEN_ALLOWANCE } from '../../lib/tokenAllowance';
import { formatDexCandidateTokenAmount } from '../../lib/currentDexDisplay';
import TradeActionConfirmModal from '../trading/components/TradeActionConfirmModal';

type Sender = Awaited<ReturnType<NonNullable<NonNullable<SharedWalletSession['actions']>['getCurrentDexSubmissionCapability']>>>;
type Row = { token: string; symbol: string; allowance: bigint };

export default function TokenApprovalsDialog({ session, onClose }: { session: SharedWalletSession; onClose: () => void }) {
  const privacy = resolveBrowserWalletPrivacyState({ browserWalletAddress: session.walletAddress,
    sessionOnboardInfo: session.sessionOnboardInfo, walletAesHealthByAddress: session.walletAesHealthByAddress });
  const scope = useMemo(() => ({}), [session.walletAddress, session.chainId, session.browserWalletId, session.browserProvider,
    session.sessionOnboardInfo, session.activeSignerSource, privacy.ownerAesKey, privacy.ownerAesReady]);
  const current = useRef(session); current.current = session;
  const currentScope = useRef(scope); currentScope.current = scope;
  const inFlight = useRef(false);
  const [rows, setRows] = useState<{ scope: object; values: Row[] }>();
  const [selection, setSelection] = useState<{scope:object;row:Row}>();
  const selected = selection?.scope === scope ? selection.row : undefined;
  const setSelected = (row?:Row) => setSelection(row ? {scope,row} : undefined);
  const [busy, setBusy] = useState(false);
  const [knownHash, setKnownHash] = useState('');
  const [held, setHeld] = useState(false);
  const [message, setMessage] = useState('Check your current DEX token approvals. Private values are shown only in this wallet session.');
  const pending = useRef<Awaited<ReturnType<Sender['submitSharedPoolApproval']>> | undefined>(undefined);
  const sender = useRef<{scope:object;cap:Sender} | undefined>(undefined);
  useEffect(() => {
    setRows(undefined); setSelection(undefined); setKnownHash(''); setHeld(false);
    setMessage('Check your current DEX token approvals. Private values are shown only in this wallet session.');
    sender.current = undefined; pending.current = undefined;
  }, [scope]);
  const assertCurrent = (captured: SharedWalletSession) => {
    if (currentScope.current !== scope || current.current.walletAddress !== captured.walletAddress || current.current.chainId !== captured.chainId ||
        current.current.browserProvider !== captured.browserProvider || current.current.sessionOnboardInfo !== captured.sessionOnboardInfo)
      throw new Error('Wallet or privacy session changed. Close Token approvals and check again.');
  };
  const run = async (revoke = false) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); const captured = session;
    try {
      const get = captured.actions?.getCurrentDexSubmissionCapability;
      if (!get || !privacy.ownerAesReady) throw new Error('Connect and unlock your Testnet wallet first.');
      // The durable pending journal survives a changed privacy session or a closed dialog.
      if (pending.current && sender.current?.scope !== scope) pending.current = undefined;
      const cap = sender.current?.scope === scope ? sender.current.cap : await get(BigInt(candidate.chainId), { candidate: 'cheap-history' });
      assertCurrent(captured);
      sender.current = {scope,cap};
      if (revoke && selected) {
        const pair = candidate.pairs.find(pair => pair.tokens.some(token => token.toLowerCase() === selected.token.toLowerCase()));
        if (!pair) throw new Error('Token is outside the current DEX.');
        const prepared = await cap.prepareSharedPoolAllowanceCleanup({ marketId: pair.marketId,
          canonicalIndex: pair.tokens.findIndex(token => token.toLowerCase() === selected.token.toLowerCase()) as 0 | 1,
          confirm: async review => { assertCurrent(captured); return review.previousAllowance === selected.allowance; } });
        assertCurrent(captured);
        if (prepared) {
          const submitted = await cap.submitSharedPoolApproval(prepared);
          assertCurrent(captured);
          pending.current = submitted;
        }
        setSelected(undefined);
      }
      if (pending.current) {
        const result = await pending.current.recover(); assertCurrent(captured);
        if (!result.privateAccountingVerified) throw new Error('Approval verification is incomplete. Do not resend.');
        pending.current = undefined;
        setMessage(result.fundingOutcome === 'reverted' ? 'Revocation reverted. The allowance is unchanged.' : 'Revocation verified.');
      } else if (!revoke) {
        const recovered = await cap.reconcilePendingSharedTokenApproval(knownHash || undefined); assertCurrent(captured);
        if (recovered && !recovered.privateAccountingVerified) {
          setHeld(true); throw new Error('The saved approval still needs reconciliation. If the wallet returned no hash, enter its transaction hash. Do not resend.');
        }
        if (recovered) setMessage('Saved approval effect verified against its canonical receipt and private state. The original reviewed amount is unavailable. Current permissions are shown below.');
      }
      const funds = await cap.readSharedTokenFunding(); assertCurrent(captured);
      setHeld(false);
      setRows({ scope, values: funds.tokens.map(token => ({ token: token.address, symbol: token.symbol, allowance: token.allowance })) });
    } catch (error) {
      setHeld(true);
      setSelected(undefined);
      setMessage(error instanceof Error ? error.message : 'Token approvals are unavailable. Do not resend.');
    } finally { inFlight.current = false; setBusy(false); }
  };
  const visible = rows?.scope === scope ? rows.values : [];
  const format = (row: Row) => row.allowance === MAX_TOKEN_ALLOWANCE ? 'Unlimited' : formatDexCandidateTokenAmount(candidate, row.token, row.allowance);
  return <TradeActionConfirmModal confirmation={{ title: 'Token approvals', primaryLabel: selected ? 'Revoke selected approval' : 'Close',
    message: selected ? `Revoke ${selected.symbol} permission for the DEX spender ${candidate.core}. This needs a wallet transaction. Existing swaps and deposits are not cancelled.` : message,
    fundingMoves: [], stats: [], summaryRows: selected ? [{ label: 'Current allowance', value: format(selected) }] : [] }}
    onCancel={() => { if (!busy) { if (selected) setSelected(undefined); else onClose(); } }}
    onConfirm={() => { if (!busy) { if (selected) void run(true); else onClose(); } }}
    details={<div aria-busy={busy}>
      <p style={{overflowWrap:'anywhere'}}>DEX spender: {candidate.core}</p>
      {held ? <label>Transaction hash (if needed)<input value={knownHash} disabled={busy} onChange={event => setKnownHash(event.target.value.trim())}/></label> : null}
      <button type="button" disabled={busy || !!selected} onClick={() => { void run(); }}>{pending.current ? 'Check submitted revocation' : 'Check approvals'}</button>
      {visible.map(row => <div key={row.token}><span>{row.symbol}: {format(row)}</span>{' '}
        <button type="button" disabled={busy || held || !!pending.current || row.allowance === 0n} onClick={() => setSelected(row)}>Revoke {row.symbol}</button>
      </div>)}
      <p>Revocation is held while a swap or transaction needs reconciliation. Cancellation does not automatically clear an approval.</p>
    </div>}/>;
}
