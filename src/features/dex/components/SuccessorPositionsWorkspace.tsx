import { ChartNoAxesCombined, Clock3, Database, LockKeyhole, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { TradingPair } from '../../../app/components/TradingProductSwitch';
import { COTI_TESTNET_NETWORK } from '../../../lib/chainWhisperNetworks';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { formatDexV2LotsAsTokenAmount } from '../../../lib/dexV2Terms';
import { successorStrategyPriceQToDisplayedPrice } from '../../../lib/successorDexStrategies';
import useSuccessorPositionAction, { successorPositionTermsScope } from '../hooks/useSuccessorPositionAction';
import type { SuccessorDexRuntimeState } from '../hooks/useSuccessorDexDeployment';

const iconFor = (family: string) => family === 'Fixed'
  ? Clock3
  : family === 'Range'
    ? ChartNoAxesCombined
    : family === 'Recurring'
      ? RefreshCw
      : Database;

const labelFor = (position: { family: string; recurringClass: 'LL' | 'RR' | null }) =>
  position.family === 'Recurring' && position.recurringClass
    ? `Recurring ${position.recurringClass}`
    : position.family;

export default function SuccessorPositionsWorkspace({
  refresh,
  runtime,
  selectedPair,
  sharedWalletSession
}: {
  refresh: () => void;
  runtime: SuccessorDexRuntimeState;
  selectedPair: TradingPair;
  sharedWalletSession?: SharedWalletSession;
}) {
  const [family, setFamily] = useState('All');
  const [pairOnly, setPairOnly] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [transferRecipient, setTransferRecipient] = useState('');
  const wallet = sharedWalletSession?.walletAddress.trim().toLowerCase() ?? '';
  const action = useSuccessorPositionAction({ refresh, runtime, sharedWalletSession });
  const positions = useMemo(() => {
    if (runtime.status !== 'ready' || !wallet) return [];
    return runtime.snapshot.positions.filter((position) =>
      position.owner.toLowerCase() === wallet &&
      (family === 'All' || position.family === family) &&
      (!pairOnly || position.pair.join('/') === selectedPair.join('/'))
    );
  }, [family, pairOnly, runtime, selectedPair, wallet]);

  useEffect(() => setTransferRecipient(''), [selectedId]);

  if (runtime.status === 'loading') return <section className="dex-v2-placeholder" aria-busy="true"><RefreshCw className="dex-v2-spin" size={30} /><h2>Verifying positions</h2><p>Checking the deployed Position NFT and strategy hosts.</p></section>;
  if (runtime.status === 'error') return <section className="dex-v2-placeholder"><ShieldCheck size={32} /><h2>Position verification failed</h2><p>{runtime.message}</p></section>;
  if (!wallet) return <section className="dex-v2-placeholder"><WalletCards size={32} /><h2>Connect your owner wallet</h2><p>Connect the wallet that owns the Position NFTs to view its strategies.</p></section>;
  if (sharedWalletSession?.chainId !== Number(runtime.manifest.chainId)) return <section className="dex-v2-placeholder"><WalletCards size={32} /><h2>COTI Testnet required</h2><p>Switch the connected wallet to COTI Testnet.</p></section>;

  const selected = positions.find(({ positionId }) => positionId === selectedId);
  const live = selected;
  const status = !live?.initialized ? 'Unavailable' : live.closed ? 'Closed' : live.paused ? 'Paused' : 'Active';
  const canClaim = selected?.family === 'Fixed' || selected?.family === 'Range';
  const canPause = selected?.family === 'Recurring' && !live?.paused;
  const canResume = selected?.family === 'Recurring' && live?.paused;
  const selectedTermsScope = selected ? successorPositionTermsScope(selected) : '';
  const revealedTerms = action.privateTermsScope === selectedTermsScope &&
      action.privateTerms?.positionId === selected?.positionId
    ? action.privateTerms
    : null;
  const revealedAggregate = revealedTerms?.family === 'Aggregate' ? revealedTerms : null;
  const revealedFixed = revealedTerms?.family === 'Fixed' ? revealedTerms : null;
  const revealedRange = revealedTerms?.family === 'Range' ? revealedTerms : null;
  const revealedRecurring = revealedTerms?.family === 'Recurring' ? revealedTerms : null;
  const editableTerms = revealedFixed ?? revealedRange;
  const ownerEditable = Boolean(live && live.ownershipRevision > 0);
  const actionRevisionAvailable = Boolean(live && (
    live.family === 'Aggregate' || live.family === 'Recurring'
      ? revealedTerms?.family === live.family
      : live.revision > 0
  ));
  const pairBinding = selected
    ? runtime.manifest.pairs.find(({ marketKey }) => marketKey.toLowerCase() === selected.marketKey.toLowerCase())
    : undefined;
  const token0 = pairBinding
    ? runtime.manifest.tokens.find(({ address }) => address.toLowerCase() === pairBinding.token0.toLowerCase())
    : undefined;
  const token1 = pairBinding
    ? runtime.manifest.tokens.find(({ address }) => address.toLowerCase() === pairBinding.token1.toLowerCase())
    : undefined;
  const [displayBase, displayQuote] = pairBinding?.displayPair.split('/') ?? [];
  const price = (priceQ: bigint) => pairBinding && displayBase
    ? successorStrategyPriceQToDisplayedPrice(runtime.manifest, pairBinding, displayBase, priceQ)
        .toFixed(8).replace(/\.?0+$/u, '')
    : '—';
  const inventory = (lots: bigint, token: typeof token0) => token
    ? `${formatDexV2LotsAsTokenAmount(lots, token.decimals, BigInt(token.lotSizeRaw))} ${token.symbol}`
    : `${lots} lots`;
  const amount = (lots: bigint, token: typeof token0) => token
    ? formatDexV2LotsAsTokenAmount(lots, token.decimals, BigInt(token.lotSizeRaw))
    : lots.toString();
  const soldToken = editableTerms?.side === 0 ? token0 : token1;
  const boughtToken = editableTerms?.side === 0 ? token1 : token0;
  const offeredInventory = editableTerms
    ? editableTerms.side === 0 ? editableTerms.inventory0Lots : editableTerms.inventory1Lots
    : 0n;
  const partialExitMaximum = offeredInventory > 1n ? offeredInventory - 1n : 0n;
  const recurringSold0 = revealedRecurring?.side0 === 0 ? token0 : token1;
  const recurringBought0 = revealedRecurring?.side0 === 0 ? token1 : token0;
  const recurringSold1 = revealedRecurring?.side1 === 0 ? token0 : token1;
  const recurringBought1 = revealedRecurring?.side1 === 0 ? token1 : token0;
  const aggregateLowerMarginalQ = revealedAggregate
    ? revealedAggregate.currentMidpointQ * 1_000_000n / revealedAggregate.spreadFactorPpm
    : null;
  const aggregateUpperMarginalQ = revealedAggregate
    ? revealedAggregate.currentMidpointQ * revealedAggregate.spreadFactorPpm / 1_000_000n
    : null;
  const aggregateSpreadPercent = revealedAggregate
    ? ((Number(revealedAggregate.spreadFactorPpm) / 1_000_000) ** 2 - 1) * 100
    : 0;
  return (
    <section className="dex-v2-positions-workspace index-open">
      <header className="dex-v2-positions-toolbar">
        <div><h2>Your positions</h2><span>{positions.length} verified Position NFT{positions.length === 1 ? '' : 's'}</span><div className="dex-v2-positions-meta"><small>Live host state at block {runtime.snapshot.latestBlock}</small></div></div>
        <div className="dex-v2-positions-toolbar-actions"><button type="button" onClick={() => setPairOnly((value) => !value)}>{pairOnly ? 'Show all pairs' : 'Selected pair only'}</button></div>
      </header>
      <div className="dex-v2-position-management">
        <section className="dex-v2-position-index" aria-label="Successor positions">
          <div className="dex-v2-position-kind-filters" role="group" aria-label="Position type filter">{['All', 'Aggregate', 'Fixed', 'Range', 'Recurring'].map((item) => <button key={item} type="button" className={family === item ? 'active' : undefined} aria-pressed={family === item} onClick={() => setFamily(item)}>{item}</button>)}</div>
          <div className="dex-v2-position-list">{positions.map((position) => {
            const Icon = iconFor(position.family);
            return <button type="button" className={`dex-v2-position-row${selectedId === position.positionId ? ' selected' : ''}`} key={position.positionId} onClick={() => setSelectedId(position.positionId)}><span className="dex-v2-position-icon"><Icon size={21} /></span><div className="dex-v2-position-primary"><strong>{labelFor(position)} position #{position.positionId}</strong><span>{position.pair.join(' / ')}</span></div><span className="dex-v2-position-status"><i />{position.closed ? 'Closed' : position.paused ? 'Paused' : 'Active'}</span></button>;
          })}</div>
        </section>
        <aside className="dex-v2-position-terminal" aria-label="Selected position terminal">
          {selected ? <div className="dex-v2-position-overview">
            <header className="dex-v2-position-terminal-head"><div><span>Position terminal</span><h2>{labelFor(selected)} #{selected.positionId}</h2></div><strong>{status}</strong></header>
            <dl className="dex-v2-position-overview-grid"><div><dt>Pair</dt><dd>{selected.pair.join(' / ')}</dd></div><div><dt>Host revision</dt><dd>{live?.revision ? live.revision : revealedTerms?.revision ?? 'Private'}</dd></div><div><dt>Actions</dt><dd>{live?.actionCount || revealedTerms?.actionCount || 'Private'}</dd></div><div><dt>NFT owner</dt><dd>Connected wallet · verified</dd></div>{selected.family === 'Recurring' ? <div><dt>Runs</dt><dd>{live?.runCount || revealedRecurring?.runCount || 'Private'}</dd></div> : null}<div><dt>Market</dt><dd>{selected.marketKey.slice(0, 10)}…</dd></div></dl>
            {revealedAggregate && token0 && token1 ? <section className="dex-v2-position-terms">
              <ShieldCheck size={20} aria-hidden="true" />
              <header>
                <strong>Owner-private Aggregate terms</strong>
                <span>Re-encrypted for the connected Position NFT owner. Values stay in this session only.</span>
                <dl className="dex-v2-position-overview-grid">
                  <div><dt>{token0.symbol} current budget</dt><dd>{inventory(revealedAggregate.principal0Lots, token0)}</dd></div>
                  <div><dt>{token1.symbol} current budget</dt><dd>{inventory(revealedAggregate.principal1Lots, token1)}</dd></div>
                  <div><dt>Starting midpoint</dt><dd>1 {displayBase} = {price(revealedAggregate.startingMidpointQ)} {displayQuote}</dd></div>
                  <div><dt>Current midpoint</dt><dd>1 {displayBase} = {price(revealedAggregate.currentMidpointQ)} {displayQuote}</dd></div>
                  <div><dt>Total spread</dt><dd>{aggregateSpreadPercent.toFixed(4).replace(/\.?0+$/u, '')}%</dd></div>
                  <div><dt>Lower marginal price</dt><dd>1 {displayBase} = {aggregateLowerMarginalQ === null ? '—' : price(aggregateLowerMarginalQ)} {displayQuote}</dd></div>
                  <div><dt>Upper marginal price</dt><dd>1 {displayBase} = {aggregateUpperMarginalQ === null ? '—' : price(aggregateUpperMarginalQ)} {displayQuote}</dd></div>
                  <div><dt>Lane mode</dt><dd>{revealedAggregate.laneMode}</dd></div>
                  <div><dt>Target</dt><dd>{revealedAggregate.targetLots.toString()} lots</dd></div>
                  <div><dt>Member shares</dt><dd>{revealedAggregate.totalMemberShares.toString()}</dd></div>
                  <div><dt>{token0.symbol} virtual inventory</dt><dd>{inventory(revealedAggregate.virtual0Lots, token0)}</dd></div>
                  <div><dt>{token1.symbol} virtual inventory</dt><dd>{inventory(revealedAggregate.virtual1Lots, token1)}</dd></div>
                  <div><dt>{token0.symbol} inventory limits</dt><dd>{inventory(revealedAggregate.minInventory0Lots, token0)} to {inventory(revealedAggregate.maxInventory0Lots, token0)}</dd></div>
                  <div><dt>{token1.symbol} inventory limits</dt><dd>{inventory(revealedAggregate.minInventory1Lots, token1)} to {inventory(revealedAggregate.maxInventory1Lots, token1)}</dd></div>
                  <div><dt>Accrued lane 1</dt><dd>{revealedAggregate.accrued0.toString()}</dd></div>
                  <div><dt>Accrued lane 2</dt><dd>{revealedAggregate.accrued1.toString()}</dd></div>
                  <div><dt>Accrued lane 3</dt><dd>{revealedAggregate.accrued2.toString()}</dd></div>
                  <div><dt>Accrued lane 4</dt><dd>{revealedAggregate.accrued3.toString()}</dd></div>
                  <div><dt>Private revision</dt><dd>{revealedAggregate.revision}</dd></div>
                  <div><dt>Private actions</dt><dd>{revealedAggregate.actionCount}</dd></div>
                </dl>
              </header>
            </section> : revealedFixed && token0 && token1 ? <section className="dex-v2-position-terms">
              <ShieldCheck size={20} aria-hidden="true" />
              <header>
                <strong>Owner-private Fixed terms</strong>
                <span>Re-encrypted for the connected Position NFT owner. Values stay in this session only.</span>
                <dl className="dex-v2-position-overview-grid">
                  <div><dt>Side</dt><dd>Sell {soldToken?.symbol} for {boughtToken?.symbol}</dd></div>
                  <div><dt>Fixed price</dt><dd>1 {displayBase} = {price(revealedFixed.priceQ)} {displayQuote}</dd></div>
                  <div><dt>{token0.symbol} inventory</dt><dd>{inventory(revealedFixed.inventory0Lots, token0)}</dd></div>
                  <div><dt>{token1.symbol} inventory</dt><dd>{inventory(revealedFixed.inventory1Lots, token1)}</dd></div>
                  <div><dt>Minimum output</dt><dd>{inventory(revealedFixed.minimumOutputLots, soldToken)}</dd></div>
                  <div><dt>Private revision</dt><dd>{revealedFixed.revision}</dd></div>
                  <div><dt>Private actions</dt><dd>{revealedFixed.actionCount}</dd></div>
                </dl>
              </header>
            </section> : revealedRange && token0 && token1 ? <section className="dex-v2-position-terms">
              <ShieldCheck size={20} aria-hidden="true" />
              <header>
                <strong>Owner-private Range terms</strong>
                <span>Re-encrypted for the connected Position NFT owner. Values stay in this session only.</span>
                <dl className="dex-v2-position-overview-grid">
                  <div><dt>Side</dt><dd>Sell {soldToken?.symbol} for {boughtToken?.symbol}</dd></div>
                  <div><dt>Start price</dt><dd>1 {displayBase} = {price(revealedRange.startPriceQ)} {displayQuote}</dd></div>
                  <div><dt>End price</dt><dd>1 {displayBase} = {price(revealedRange.endPriceQ)} {displayQuote}</dd></div>
                  <div><dt>Initial output</dt><dd>{inventory(revealedRange.initialOutputLots, soldToken)}</dd></div>
                  <div><dt>{token0.symbol} inventory</dt><dd>{inventory(revealedRange.inventory0Lots, token0)}</dd></div>
                  <div><dt>{token1.symbol} inventory</dt><dd>{inventory(revealedRange.inventory1Lots, token1)}</dd></div>
                  <div><dt>Minimum output</dt><dd>{inventory(revealedRange.minimumOutputLots, soldToken)}</dd></div>
                  <div><dt>Private revision</dt><dd>{revealedRange.revision}</dd></div>
                  <div><dt>Private actions</dt><dd>{revealedRange.actionCount}</dd></div>
                </dl>
              </header>
            </section> : revealedRecurring && token0 && token1 ? <section className="dex-v2-position-terms">
              <ShieldCheck size={20} aria-hidden="true" />
              <header>
                <strong>Owner-private Recurring {revealedRecurring.recurringClass} terms</strong>
                <span>Re-encrypted for the connected Position NFT owner. Values stay in this session only.</span>
                <dl className="dex-v2-position-overview-grid">
                  <div><dt>Leg 1 side</dt><dd>Sell {recurringSold0?.symbol} for {recurringBought0?.symbol}</dd></div>
                  <div><dt>Leg 1 start price</dt><dd>1 {displayBase} = {price(revealedRecurring.startPrice0Q)} {displayQuote}</dd></div>
                  <div><dt>Leg 1 end price</dt><dd>1 {displayBase} = {price(revealedRecurring.endPrice0Q)} {displayQuote}</dd></div>
                  <div><dt>Leg 1 activation output</dt><dd>{inventory(revealedRecurring.activationOutput0Lots, recurringSold0)}</dd></div>
                  <div><dt>Leg 1 minimum output</dt><dd>{inventory(revealedRecurring.minimumOutput0Lots, recurringSold0)}</dd></div>
                  <div><dt>Leg 1 threshold</dt><dd>{revealedRecurring.threshold0Lots.toString()} lots</dd></div>
                  <div><dt>Leg 1 next minimum</dt><dd>{revealedRecurring.nextMinimumInventory0Lots.toString()} lots</dd></div>
                  <div><dt>Leg 2 side</dt><dd>Sell {recurringSold1?.symbol} for {recurringBought1?.symbol}</dd></div>
                  <div><dt>Leg 2 start price</dt><dd>1 {displayBase} = {price(revealedRecurring.startPrice1Q)} {displayQuote}</dd></div>
                  <div><dt>Leg 2 end price</dt><dd>1 {displayBase} = {price(revealedRecurring.endPrice1Q)} {displayQuote}</dd></div>
                  <div><dt>Leg 2 activation output</dt><dd>{inventory(revealedRecurring.activationOutput1Lots, recurringSold1)}</dd></div>
                  <div><dt>Leg 2 minimum output</dt><dd>{inventory(revealedRecurring.minimumOutput1Lots, recurringSold1)}</dd></div>
                  <div><dt>Leg 2 threshold</dt><dd>{revealedRecurring.threshold1Lots.toString()} lots</dd></div>
                  <div><dt>Leg 2 next minimum</dt><dd>{revealedRecurring.nextMinimumInventory1Lots.toString()} lots</dd></div>
                  <div><dt>{token0.symbol} inventory</dt><dd>{inventory(revealedRecurring.inventory0Lots, token0)}</dd></div>
                  <div><dt>{token1.symbol} inventory</dt><dd>{inventory(revealedRecurring.inventory1Lots, token1)}</dd></div>
                  <div><dt>Active leg</dt><dd>Leg {revealedRecurring.activeIndex + 1}</dd></div>
                  <div><dt>Origin leg</dt><dd>Leg {revealedRecurring.originIndex + 1}</dd></div>
                  <div><dt>Cooldown actions</dt><dd>{revealedRecurring.cooldownActions.toString()}</dd></div>
                  <div><dt>Cycle limit</dt><dd>{revealedRecurring.cycleLimit === 0n ? 'No limit' : revealedRecurring.cycleLimit.toString()}</dd></div>
                  <div><dt>Cycles</dt><dd>{revealedRecurring.cycleCount.toString()}</dd></div>
                  <div><dt>Transitions</dt><dd>{revealedRecurring.transitionCount.toString()}</dd></div>
                  <div><dt>Last switch run</dt><dd>{revealedRecurring.lastSwitchRun.toString()}</dd></div>
                  <div><dt>Private state</dt><dd>{revealedRecurring.paused ? 'Paused' : 'Active'}</dd></div>
                  <div><dt>Private revision</dt><dd>{revealedRecurring.revision}</dd></div>
                  <div><dt>Private actions</dt><dd>{revealedRecurring.actionCount}</dd></div>
                  <div><dt>Private runs</dt><dd>{revealedRecurring.runCount}</dd></div>
                </dl>
              </header>
            </section> : <section className="dex-v2-position-terms dex-v2-private-terms-locked">
              <LockKeyhole size={20} aria-hidden="true" />
              <header><strong>Private position terms</strong><span>Inventory, prices, minimums, ranges, and recurring policy are hidden until the current owner unlocks privacy.</span></header>
              <p>Unlock privacy to request the current {selected.family} terms from the corrected owner-only contract endpoint.</p>
            </section>}
            {revealedAggregate && token0 && token1 && pairBinding && displayBase ? <section className="dex-v2-position-terms">
              <ShieldCheck size={20} aria-hidden="true" />
              <header>
                <strong>Edit owner-private Aggregate terms</strong>
                <span>Budget, current midpoint, and spread are encrypted for the Aggregate host. A confirmed edit requires a fresh reveal.</span>
                <form onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void action.edit(selected, revealedAggregate, {
                    kind: 'top-up-aggregate',
                    amount0: String(data.get('amount0') ?? ''),
                    amount1: String(data.get('amount1') ?? '')
                  });
                }}>
                  <label>Top up {token0.symbol}<input name="amount0" type="number" min="0" step={amount(1n, token0)} defaultValue="0" required /></label>
                  <label>Top up {token1.symbol}<input name="amount1" type="number" min="0" step={amount(1n, token1)} defaultValue="0" required /></label>
                  <button type="submit" disabled={action.busy}>Top up Aggregate budget</button>
                </form>
                <form onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void action.edit(selected, revealedAggregate, {
                    kind: 'reprice-aggregate',
                    displayedMidpoint: String(data.get('midpoint') ?? ''),
                    totalSpreadPercent: String(data.get('spread') ?? '')
                  });
                }}>
                  <label>Current midpoint ({displayQuote} per {displayBase})<input name="midpoint" type="number" min="0" step="any" defaultValue={price(revealedAggregate.currentMidpointQ)} required /></label>
                  <label>Total spread (%)<input name="spread" type="number" min="0" max="20" step="0.01" defaultValue={aggregateSpreadPercent.toFixed(4)} required /></label>
                  <button type="submit" disabled={action.busy}>Update Aggregate price and spread</button>
                </form>
                {revealedAggregate.totalMemberShares > 1n ? <form onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void action.edit(selected, revealedAggregate, {
                    kind: 'partial-exit-aggregate', shares: String(data.get('shares') ?? '')
                  });
                }}>
                  <label>Shares to exit<input name="shares" type="number" min="1" max={(revealedAggregate.totalMemberShares - 1n).toString()} step="1" defaultValue="1" required /></label>
                  <button type="submit" disabled={action.busy}>Partially exit Aggregate position</button>
                </form> : null}
                {[revealedAggregate.accrued0, revealedAggregate.accrued1, revealedAggregate.accrued2, revealedAggregate.accrued3].some((value) => value > 0n) ? <form onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void action.edit(selected, revealedAggregate, {
                    kind: 'withdraw-aggregate-counters',
                    amounts: ['counter0', 'counter1', 'counter2', 'counter3'].map((name) => String(data.get(name) ?? '0')) as [string, string, string, string]
                  });
                }}>
                  <span>Reset private flow telemetry. This does not withdraw tokens.</span>
                  {[revealedAggregate.accrued0, revealedAggregate.accrued1, revealedAggregate.accrued2, revealedAggregate.accrued3].map((value, index) => <label key={index}>Flow counter {index + 1}<input name={`counter${index}`} type="number" min="0" max={value.toString()} step="1" defaultValue="0" required /></label>)}
                  <button type="submit" disabled={action.busy}>Reset selected flow counters</button>
                </form> : null}
              </header>
            </section> : null}
            {revealedRecurring && token0 && token1 && pairBinding && displayBase ? <section className="dex-v2-position-terms">
              <ShieldCheck size={20} aria-hidden="true" />
              <header>
                <strong>Edit owner-private Recurring terms</strong>
                <span>Budgets and each leg policy are encrypted for the Recurring host. Cooldown and cycle limit remain fixed after creation.</span>
                <form onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void action.edit(selected, revealedRecurring, {
                    kind: 'top-up-recurring', amount0: String(data.get('amount0') ?? ''), amount1: String(data.get('amount1') ?? '')
                  });
                }}>
                  <label>Top up {token0.symbol}<input name="amount0" type="number" min="0" step={amount(1n, token0)} defaultValue="0" required /></label>
                  <label>Top up {token1.symbol}<input name="amount1" type="number" min="0" step={amount(1n, token1)} defaultValue="0" required /></label>
                  <button type="submit" disabled={action.busy}>Top up Recurring budget</button>
                </form>
                {[0, 1].map((leg) => {
                  const side = leg === 0 ? revealedRecurring.side0 : revealedRecurring.side1;
                  const sold = side === 0 ? token0 : token1;
                  const bought = side === 0 ? token1 : token0;
                  const startPriceQ = leg === 0 ? revealedRecurring.startPrice0Q : revealedRecurring.startPrice1Q;
                  const endPriceQ = leg === 0 ? revealedRecurring.endPrice0Q : revealedRecurring.endPrice1Q;
                  const minimumOutput = leg === 0 ? revealedRecurring.minimumOutput0Lots : revealedRecurring.minimumOutput1Lots;
                  const threshold = leg === 0 ? revealedRecurring.threshold0Lots : revealedRecurring.threshold1Lots;
                  const nextMinimum = leg === 0 ? revealedRecurring.nextMinimumInventory0Lots : revealedRecurring.nextMinimumInventory1Lots;
                  return <form key={`recurring-leg-${leg}`} onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void action.edit(selected, revealedRecurring, {
                      kind: 'reprice-recurring', leg: leg as 0 | 1,
                      displayedStartPrice: String(data.get('startPrice') ?? ''),
                      displayedEndPrice: String(data.get('endPrice') ?? ''),
                      minimumOutput: String(data.get('minimumOutput') ?? ''),
                      threshold: String(data.get('threshold') ?? ''),
                      nextMinimum: String(data.get('nextMinimum') ?? '')
                    });
                  }}>
                    <strong>Leg {leg + 1}: sell {sold.symbol} for {bought.symbol}</strong>
                    <label>Start price ({displayQuote} per {displayBase})<input name="startPrice" type="number" min="0" step="any" defaultValue={price(startPriceQ)} required /></label>
                    {revealedRecurring.recurringClass === 'RR' ? <label>End price ({displayQuote} per {displayBase})<input name="endPrice" type="number" min="0" step="any" defaultValue={price(endPriceQ)} required /></label> : <input name="endPrice" type="hidden" value={price(endPriceQ)} />}
                    <label>Minimum fill ({sold.symbol})<input name="minimumOutput" type="number" min="0" step={amount(1n, sold)} defaultValue={amount(minimumOutput, sold)} required /></label>
                    <label>Switch threshold ({sold.symbol})<input name="threshold" type="number" min="0" step={amount(1n, sold)} defaultValue={amount(threshold, sold)} required /></label>
                    <label>Next-leg minimum ({bought.symbol})<input name="nextMinimum" type="number" min="0" step={amount(1n, bought)} defaultValue={amount(nextMinimum, bought)} required /></label>
                    <button type="submit" disabled={action.busy}>Update leg {leg + 1}</button>
                  </form>;
                })}
                <form onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void action.edit(selected, revealedRecurring, {
                    kind: 'withdraw-recurring', amount0: String(data.get('amount0') ?? ''), amount1: String(data.get('amount1') ?? '')
                  });
                }}>
                  <label>Withdraw {token0.symbol}<input name="amount0" type="number" min="0" max={amount(revealedRecurring.inventory0Lots, token0)} step={amount(1n, token0)} defaultValue="0" required /></label>
                  <label>Withdraw {token1.symbol}<input name="amount1" type="number" min="0" max={amount(revealedRecurring.inventory1Lots, token1)} step={amount(1n, token1)} defaultValue="0" required /></label>
                  <button type="submit" disabled={action.busy}>Withdraw Recurring budget</button>
                </form>
              </header>
            </section> : null}
            {editableTerms && soldToken && pairBinding && displayBase ? <section className="dex-v2-position-terms">
              <ShieldCheck size={20} aria-hidden="true" />
              <header>
                <strong>Edit owner-private terms</strong>
                <span>Values are encrypted for the corrected {editableTerms.family} host. A confirmed edit requires a fresh reveal.</span>
                <form key={`${editableTerms.positionId}:${editableTerms.revision}:top-up`} onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void action.edit(selected, editableTerms, { kind: 'top-up', amount: String(data.get('amount') ?? '') });
                }}>
                  <label>Top up {soldToken.symbol}<input name="amount" type="number" min={amount(1n, soldToken)} step={amount(1n, soldToken)} defaultValue={amount(1n, soldToken)} required /></label>
                  <button type="submit" disabled={action.busy}>Top up position</button>
                </form>
                {partialExitMaximum > 0n && revealedFixed ? <form key={`${revealedFixed.positionId}:${revealedFixed.revision}:partial-exit`} onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void action.edit(selected, revealedFixed, {
                    kind: 'partial-exit-fixed', amount: String(data.get('amount') ?? '')
                  });
                }}>
                  <label>Withdraw offered principal ({soldToken.symbol})<input name="amount" type="number" min={amount(1n, soldToken)} max={amount(partialExitMaximum, soldToken)} step={amount(1n, soldToken)} defaultValue={amount(1n, soldToken)} required /></label>
                  <button type="submit" disabled={action.busy}>Partially exit Fixed position</button>
                </form> : partialExitMaximum > 0n && revealedRange ? <form key={`${revealedRange.positionId}:${revealedRange.revision}:partial-exit`} onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void action.edit(selected, revealedRange, {
                    kind: 'partial-exit-range',
                    amount: String(data.get('amount') ?? ''),
                    displayedStartPrice: String(data.get('startPrice') ?? ''),
                    displayedEndPrice: String(data.get('endPrice') ?? ''),
                    minimumOutput: String(data.get('minimumOutput') ?? '')
                  });
                }}>
                  <label>Withdraw offered principal ({soldToken.symbol})<input name="amount" type="number" min={amount(1n, soldToken)} max={amount(partialExitMaximum, soldToken)} step={amount(1n, soldToken)} defaultValue={amount(1n, soldToken)} required /></label>
                  <label>Remaining start price ({displayQuote} per {displayBase})<input name="startPrice" type="number" min="0" step="any" defaultValue={price(revealedRange.startPriceQ)} required /></label>
                  <label>Remaining end price ({displayQuote} per {displayBase})<input name="endPrice" type="number" min="0" step="any" defaultValue={price(revealedRange.endPriceQ)} required /></label>
                  <label>Remaining minimum fill ({soldToken.symbol})<input name="minimumOutput" type="number" min="0" step={amount(1n, soldToken)} defaultValue={amount(revealedRange.minimumOutputLots > partialExitMaximum ? partialExitMaximum : revealedRange.minimumOutputLots, soldToken)} required /></label>
                  <button type="submit" disabled={action.busy}>Partially exit Range position</button>
                </form> : null}
                {revealedFixed ? <form key={`${revealedFixed.positionId}:${revealedFixed.revision}:reprice`} onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void action.edit(selected, revealedFixed, {
                    kind: 'reprice-fixed',
                    displayedPrice: String(data.get('price') ?? ''),
                    minimumOutput: String(data.get('minimumOutput') ?? '')
                  });
                }}>
                  <label>Fixed price ({displayQuote} per {displayBase})<input name="price" type="number" min="0" step="any" defaultValue={price(revealedFixed.priceQ)} required /></label>
                  <label>Minimum fill ({soldToken.symbol})<input name="minimumOutput" type="number" min="0" step={amount(1n, soldToken)} defaultValue={amount(revealedFixed.minimumOutputLots, soldToken)} required /></label>
                  <button type="submit" disabled={action.busy}>Update Fixed terms</button>
                </form> : revealedRange ? <form key={`${revealedRange.positionId}:${revealedRange.revision}:reprice`} onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void action.edit(selected, revealedRange, {
                    kind: 'reprice-range',
                    displayedStartPrice: String(data.get('startPrice') ?? ''),
                    displayedEndPrice: String(data.get('endPrice') ?? ''),
                    minimumOutput: String(data.get('minimumOutput') ?? '')
                  });
                }}>
                  <label>Start price ({displayQuote} per {displayBase})<input name="startPrice" type="number" min="0" step="any" defaultValue={price(revealedRange.startPriceQ)} required /></label>
                  <label>End price ({displayQuote} per {displayBase})<input name="endPrice" type="number" min="0" step="any" defaultValue={price(revealedRange.endPriceQ)} required /></label>
                  <label>Minimum fill ({soldToken.symbol})<input name="minimumOutput" type="number" min="0" step={amount(1n, soldToken)} defaultValue={amount(revealedRange.minimumOutputLots, soldToken)} required /></label>
                  <button type="submit" disabled={action.busy}>Update Range terms</button>
                </form> : null}
              </header>
            </section> : null}
            {!live?.closed ? <div className="dex-v2-position-actions">
              {!revealedTerms ? <button type="button" disabled={action.busy || !ownerEditable} onClick={() => void action.revealTerms(selected)}>Reveal private terms</button> : null}
              {canClaim ? <button type="button" disabled={action.busy || !actionRevisionAvailable} onClick={() => live && void action.execute(selected, live, 'claim')}>Claim proceeds</button> : null}
              {canPause ? <button type="button" disabled={action.busy || !actionRevisionAvailable} onClick={() => live && void action.execute(selected, live, 'pause')}>Pause</button> : null}
              {canResume ? <button type="button" disabled={action.busy || !actionRevisionAvailable} onClick={() => live && void action.execute(selected, live, 'resume')}>Resume</button> : null}
              <button type="button" disabled={action.busy || !actionRevisionAvailable} onClick={() => {
                if (live && window.confirm('Exit this position and burn its Position NFT?')) void action.execute(selected, live, 'exit');
              }}>Exit position</button>
              <form onSubmit={(event) => {
                event.preventDefault();
                if (window.confirm(`Transfer Position NFT #${selected.positionId} to ${transferRecipient}?`)) {
                  void action.transfer(selected, transferRecipient);
                }
              }}>
                <label>Transfer owner<input aria-label="Recipient wallet" value={transferRecipient} onChange={(event) => setTransferRecipient(event.target.value)} placeholder="0x…" required /></label>
                <button type="submit" disabled={action.busy || !ownerEditable}>Transfer Position NFT</button>
              </form>
            </div> : null}
            {ownerEditable && !actionRevisionAvailable && !live?.closed && (live?.family === 'Aggregate' || live?.family === 'Recurring') ? <p className="dex-v2-position-action-status">Reveal the owner-private terms before a lifecycle action. The private revision is not published.</p> : null}
            {!ownerEditable && !live?.closed ? <p className="dex-v2-position-action-status">Position ownership is not available. Refresh the Position NFT state.</p> : null}
            {action.message ? <p className="dex-v2-position-action-status" role="status">{action.message}</p> : null}
            {selected.transactionHash ? <a href={`${COTI_TESTNET_NETWORK.blockExplorerUrl}/tx/${selected.transactionHash}`} target="_blank" rel="noreferrer">View creation transaction</a> : null}
          </div> : <div className="dex-v2-position-terminal-empty"><WalletCards size={28} /><strong>Select a position</strong><p>Live lifecycle state appears here. Private terms require owner-authorized reveal.</p></div>}
        </aside>
      </div>
    </section>
  );
}
