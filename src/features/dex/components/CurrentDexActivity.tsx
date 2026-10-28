import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Clock3, Coins, Layers3, ListOrdered } from 'lucide-react';
import { resolveBrowserWalletPrivacyState, type SharedWalletSession } from '../../../lib/walletSession';
import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import { currentDexPendingStorage, readCurrentDexPendingAttempt } from '../../../lib/currentDexPendingAttempt';
import { formatDexCandidateTokenAmount, readCurrentDexDisplay } from '../../../lib/currentDexDisplay';
import { readCurrentDexActivityPage, buildCurrentDexActivityEntries } from '../../../lib/currentDexActivity';
import { COTI_TESTNET_NETWORK } from '../../../lib/chainWhisperNetworks';
import { CURRENT_LIMIT_FILL_HISTORY_GRAPHS } from '../../../lib/currentDexLimitFillHistory';

export default function CurrentDexActivity({ sharedWalletSession, candidateKey, visible, onInspect }: {
  sharedWalletSession?: SharedWalletSession; candidateKey: CurrentCheapDexCandidateKey; visible: boolean;
  onInspect: (mode: 'swap' | 'activity' | 'positions' | 'liquidity') => void;
}) {
  const candidate = resolveCurrentCheapDexCandidate(candidateKey);
  const privacyReady = sharedWalletSession ? resolveBrowserWalletPrivacyState({ browserWalletAddress: sharedWalletSession.walletAddress,
    sessionOnboardInfo: sharedWalletSession.sessionOnboardInfo ?? {}, walletAesHealthByAddress: sharedWalletSession.walletAesHealthByAddress }).ownerAesReady : false;
  const context = { owner: sharedWalletSession?.walletAddress.toLowerCase(), chain: sharedWalletSession?.chainId,
    provider: sharedWalletSession?.browserProvider, source: sharedWalletSession?.activeSignerSource,
    walletId: sharedWalletSession?.browserWalletId, onboard: sharedWalletSession?.sessionOnboardInfo,
    health: sharedWalletSession?.walletAesHealthByAddress, privacyReady, candidateKey,
    getSender: sharedWalletSession?.actions?.getCurrentDexSubmissionCapability, getQuote: sharedWalletSession?.actions?.getCurrentDexQuoteCapability };
  const scopeRef = useRef(context);
  if ((Object.keys(context) as (keyof typeof context)[]).some(key => scopeRef.current[key] !== context[key])) scopeRef.current = context;
  const scope = scopeRef.current, sessionRef = useRef(sharedWalletSession);
  sessionRef.current = sharedWalletSession;
  const [refresh, setRefresh] = useState(0);
  type Page = Awaited<ReturnType<typeof readCurrentDexActivityPage>>;
  type Data = Page & { deployments: Partial<Record<CurrentCheapDexCandidateKey, Page>>;
    failures: Partial<Record<CurrentCheapDexCandidateKey, string>> };
  type View = { scope: typeof scope; refresh: number; older: number; checkedAt?: number; state: 'loading' | 'empty' | 'error' | 'ready'; data?: Data; message?: string; checked?: number; total?: number };
  const [view, setView] = useState<View | null>(null), [older, setOlder] = useState(0), viewRef = useRef(view);
  const [filter, setFilter] = useState('All');
  viewRef.current = view;
  const connected = Boolean(context.owner && context.chain === Number(candidate.chainId));
  useEffect(() => {
    const session = sessionRef.current;
    if (!session || !connected || !scope.privacyReady) { setView(null); return; }
    if (!visible) return;
    const retained = viewRef.current?.scope === scope && viewRef.current.refresh === refresh ? viewRef.current : undefined;
    const returning = retained?.older === older && (retained.state === 'ready' || retained.state === 'empty');
    // Brief tab changes reuse this session's page; older pages and explicit Refresh still read the chain.
    if (returning && retained.checkedAt && Date.now() - retained.checkedAt < 30_000) return;
    const previous = returning ? undefined : retained?.data;
    let active = true;
    const assertCurrent = () => { if (!active || scopeRef.current !== scope) throw new Error('Activity wallet or privacy session changed.'); };
    setView({ scope, refresh, older, state: 'loading', data: retained?.data });
    void (async () => {
      const keys: CurrentCheapDexCandidateKey[] = candidateKey === 'cheap-history' ? ['cheap-history', 'cheap-exit'] : [candidateKey];
      const deployments = { ...previous?.deployments }, failures: Data['failures'] = {};
      let head = previous?.head;
      for (const key of keys) {
        const prior = deployments[key];
        if (prior?.complete) continue;
        try {
          const page = await readCurrentDexActivityPage(session, key, assertCurrent, {
            cursor: prior?.nextCursor ?? { transactions: 1, nfts: 1 }, head,
            onProgress: (checked,total) => { assertCurrent(); setView({scope,refresh,older,state:'loading',data:retained?.data,checked,total}); }
          });
          assertCurrent();
          if (head && (page.head.number !== head.number || page.head.hash.toLowerCase() !== head.hash.toLowerCase()))
            throw new Error('History chain head changed. Refresh history.');
          head = page.head;
          const rows = new Map((prior?.rows ?? []).map(row => [row.hash,row]));
          page.rows.forEach(row => rows.set(row.hash,row));
          const fills = new Map((prior?.fills ?? []).map(fill => [`${fill.engine}:${fill.record}`,fill]));
          page.fills?.forEach(fill => fills.set(`${fill.engine}:${fill.record}`,fill));
          deployments[key] = { ...page, rows: [...rows.values()], fills: [...fills.values()],
            unavailable: [...new Set([...(prior?.unavailable ?? []),...page.unavailable])].filter(hash => !rows.has(hash)) };
        } catch (error) {
          assertCurrent();
          delete deployments[key];
          const message = error instanceof Error ? error.message : 'Private activity is unavailable.';
          failures[key] = /missing trie node/i.test(message) ? 'This RPC cannot read the requested state. Activity is unavailable.' : message;
        }
      }
      assertCurrent();
      const pages = keys.flatMap(key => deployments[key] ? [deployments[key]!] : []);
      if (!pages.length) throw new Error(Object.values(failures).join(' ') || 'Private activity is unavailable.');
      const rows = new Map(pages.flatMap(page => page.rows).map(row => [row.hash,row]));
      const fills = new Map(pages.flatMap(page => page.fills ?? []).map(fill => [`${fill.engine}:${fill.record}`,fill]));
      const data: Data = { ...pages[0], head: head!, deployments, failures,
        rows: [...rows.values()].sort((a,b)=>b.blockNumber-a.blockNumber||a.hash.localeCompare(b.hash)), fills: [...fills.values()],
        complete: keys.every(key => deployments[key]?.complete) && !Object.keys(failures).length,
        unavailable: [...new Set(pages.flatMap(page => page.unavailable))].filter(hash => !rows.has(hash)) };
      setView({ scope, refresh, older, checkedAt: Date.now(), state: !data.rows.length && !data.fills.length && !data.unavailable.length && data.complete ? 'empty' : 'ready', data });
    })().catch(error => {
      if (active && scopeRef.current === scope) {
        const message = error instanceof Error ? error.message : 'Private activity is unavailable.';
        setView({ scope, refresh, older, state: 'error', message: /missing trie node/i.test(message)
          ? 'This RPC cannot read the requested state. Activity is unavailable.' : message });
      }
    });
    return () => { active = false; };
  }, [scope, connected, candidateKey, visible, refresh, older]);
  let pending: ReturnType<typeof readCurrentDexPendingAttempt> = null, storageError = '';
  if (connected) {
    try {
      const saved = readCurrentDexPendingAttempt(currentDexPendingStorage());
      if (saved && saved.owner === context.owner && saved.chainId === candidate.chainId &&
          saved.core === candidate.core.toLowerCase() && saved.graph === `0x${candidate.graph}`) pending = saved;
    } catch (error) { storageError = error instanceof Error ? error.message : 'Saved action cannot be read.'; }
  }
  const currentView = visible && privacyReady && view?.scope === scope ? view : null;
  const data = currentView?.data, display = readCurrentDexDisplay(candidate);
  const inspectMode = pending?.phase.startsWith('limit-') ? 'activity' :
    pending?.phase === 'pool-owner' || pending?.phase === 'pool-transfer' || pending?.phase === 'pool-snapshot' ? 'positions' :
    pending?.phase.startsWith('pool-') ? 'liquidity' : 'swap';
  const group = (action: string) => /swap|quote/i.test(action) ? 'Swaps' : /pool|liquidity|position/i.test(action) ? 'Liquidity' : /limit/i.test(action) ? 'Orders' : 'Funding';
  const entries = data ? buildCurrentDexActivityEntries(data.rows, data.fills) : [];
  const shown = entries.filter(row => filter === 'All' || group(row.action) === filter);
  return <section className="dex-v2-activity-card" aria-label="Trade history">
    <header className="dex-owner-heading"><div><h2>History</h2><p>Your DEX activity. Open a row for details.</p>{currentView?.checkedAt?<p>Last checked {new Date(currentView.checkedAt).toLocaleTimeString()} · Refresh for new activity.</p>:null}</div><button type="button" disabled={!connected || !privacyReady || currentView?.state === 'loading'} onClick={() => setRefresh(value => value + 1)}>{currentView?.state === 'loading' ? 'Checking…' : 'Refresh history'}</button></header>
    {storageError ? <p role="alert">{storageError}</p> : null}
    {pending ? <aside className="dex-v2-pending-card"><h3>Action needs a status check</h3>
      <p>{pending.phase.replace(/-/g, ' ')} · {pending.verificationBlocked ? 'Verification blocked' : 'Pending or uncertain'}</p>
      {pending.txHash ? <a href={`${COTI_TESTNET_NETWORK.blockExplorerUrl}/tx/${pending.txHash}`} target="_blank" rel="noreferrer">View transaction</a> : null}
      <button type="button" onClick={() => onInspect(inspectMode)}>Open status and recovery</button></aside> : null}
    {!connected ? <p>Connect your wallet on COTI Testnet to view activity.</p> : !privacyReady ? <p>Unlock privacy to view your trade results.</p> :
      currentView?.state === 'loading' ? <p role="status">Checking activity{currentView.total ? `: ${currentView.checked} of ${currentView.total} transactions` : '…'}</p> :
      currentView?.state === 'error' ? <p role="alert">{currentView.message}</p> : currentView?.state === 'empty' ?
        <div className="dex-v2-empty-state"><Clock3 size={28} aria-hidden="true" /><h3>No recorded DEX activity</h3></div> : null}
    {data ? <>
      <nav className="dex-history-toolbar" aria-label="Filter history">
        {['All', 'Swaps', 'Liquidity', 'Orders', 'Funding'].map(label => <button key={label} type="button" aria-pressed={filter === label} onClick={() => setFilter(label)}>{label}</button>)}
      </nav>
      <div className="dex-history-list">
      {shown.map(row => {
        const category = group(row.action);
        const Icon = category === 'Swaps' ? ArrowLeftRight : category === 'Liquidity' ? Layers3 : category === 'Orders' ? ListOrdered : Coins;
        return <details className="dex-history-row" key={row.key}>
          <summary>
            <span className="dex-history-icon"><Icon size={18} aria-hidden="true" /></span>
            <span className="dex-history-description"><strong>{row.action}</strong><time dateTime={new Date(Number(row.timestamp)*1000).toISOString()}>{new Date(Number(row.timestamp)*1000).toLocaleString()}</time></span>
            <span className="dex-history-movements">{row.movements.flatMap(m => {
              const token = display.tokens.find(t => t.address.toLowerCase() === m.token)?.label ?? 'Unknown token';
              return [m.paid > 0n ? <span key={`${m.token}-paid`}>−{formatDexCandidateTokenAmount(candidate,m.token,m.paid)} {token}</span> : null,
                m.received > 0n ? <span key={`${m.token}-received`}>+{formatDexCandidateTokenAmount(candidate,m.token,m.received)} {token}{row.transactions && m.token === row.inputToken ? ' refund' : ''}</span> : null];
            })}</span>
            <span className="dex-owner-status" data-state={/failed|expired|cancel/i.test(row.status) ? 'closed' : /pending|ready|recovery/i.test(row.status) ? 'pending' : 'active'}>{row.status}</span>
          </summary>
          <div className="dex-history-detail">
          {row.operationId !== undefined ? <p>Operation {row.operationId.toString()}</p> : row.positionId !== undefined ? <p>Position NFT {row.positionId.toString()}</p> : null}
          {row.movements.map(m => row.kind === 'limit-fill' ? <dl key={m.token}><div><dt>{m.paid>0n?'Sold from order':'Added to proceeds'}</dt>
            <dd>{formatDexCandidateTokenAmount(candidate,m.token,m.paid>0n?m.paid:m.received)} {display.tokens.find(t=>t.address.toLowerCase()===m.token)?.label}</dd></div></dl> : <dl key={m.token}><div><dt>Paid</dt><dd>{formatDexCandidateTokenAmount(candidate,m.token,m.paid)} {display.tokens.find(t=>t.address.toLowerCase()===m.token)?.label}</dd></div>
            <div><dt>{row.transactions && m.token===row.inputToken?'Refunded':'Received'}</dt><dd>{formatDexCandidateTokenAmount(candidate,m.token,m.received)} {display.tokens.find(t=>t.address.toLowerCase()===m.token)?.label}</dd></div></dl>)}
          {row.kind.endsWith('quote') ? <p>Quote only; not a completed trade.</p> : null}
          {row.hash ? <a href={`${COTI_TESTNET_NETWORK.blockExplorerUrl}/tx/${row.hash}`} target="_blank" rel="noreferrer">View transaction</a> : <p>Block {row.blockNumber}</p>}
          {row.transactions ? <details><summary>Transactions</summary>{row.transactions.map(tx=><p key={tx.hash}>{tx.action}: <a href={`${COTI_TESTNET_NETWORK.blockExplorerUrl}/tx/${tx.hash}`} target="_blank" rel="noreferrer">View transaction</a></p>)}</details> : null}
          </div>
        </details>;
      })}
      {!shown.length && entries.length ? <p className="dex-history-empty">No {filter.toLowerCase()} in this page of history.</p> : null}
      </div>
    </> : null}
    {data?.unavailable.map(hash=><p role="alert" key={hash}>Receipt or private amounts unavailable. <a href={`${COTI_TESTNET_NETWORK.blockExplorerUrl}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction</a></p>)}
    {data ? Object.entries(data.failures).map(([key,message]) => <p role="alert" key={key}>History is incomplete. {key === 'cheap-exit' ? 'Previous DEX deployment' : 'Selected DEX deployment'}: {message}</p>) : null}
    {data && !data.complete ? <button type="button" disabled={currentView?.state === 'loading'} onClick={()=>setOlder(value=>value+1)}>Load older activity</button> : null}
    <details className="dex-owner-footer"><summary>History coverage</summary>{data ? <p>Snapshot block {data.head.number.toString()}. Refresh history for current status.</p> : null}<p>{candidateKey === 'cheap-history' ? 'Current and previous DEX deployments' : 'Current DEX deployment'}, read from chain after reconnect or on another device. Load older activity for earlier pages. Private amounts come from canonical owner token receipts.
      {candidateKey === 'cheap-history' && data?.failures['cheap-history'] ? ' Selected-deployment Limit fills are unavailable.' :
        data?.limitFillsState==='available'?' Private Limit fills use saved-owner execution records. Fills from before these records were introduced are unavailable.':
          CURRENT_LIMIT_FILL_HISTORY_GRAPHS.includes(candidate.graph)?' Private Limit fills require a verified History read.':' Individual Limit fills are not recorded by this deployment.'}
      {' '}Claims and other owner actions are included. Original Quote-rate reconstruction is unavailable.</p></details>
  </section>;
}
