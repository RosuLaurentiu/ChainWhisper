import { useState } from 'react';
import { formatTokenAmount, sanitizeTokenAmountInput } from '../../../lib/appShared/core';
import type {
  PrivateLiquidityPosition,
  PrivateLiquidityPositionStatus
} from '../../../lib/privateLiquidity';
import type {
  PrivateLiquidityPositionHistoryRow,
  PrivateLiquidityPositionHistoryTotals
} from '../../../lib/privateLiquidityHistory';
import type {
  PrivateLiquidityPositionActionIntent,
  PrivateLiquidityPositionToken
} from '../../../lib/privateLiquidityPositionFlow';

export type PrivateLiquidityManagerAction =
  | 'update-terms'
  | 'add-liquidity'
  | 'remove-liquidity'
  | 'pause'
  | 'resume'
  | 'activate-privacy'
  | 'transfer'
  | 'close';

export type PrivateLiquidityInventoryDisplay = Readonly<{
  state: 'locked' | 'available' | 'unavailable';
  baseAmount?: string;
  quoteAmount?: string;
}>;

type PrivateLiquidityPositionManagerProps = {
  position: PrivateLiquidityPosition;
  baseToken?: PrivateLiquidityPositionToken;
  quoteToken?: PrivateLiquidityPositionToken;
  inventory: PrivateLiquidityInventoryDisplay;
  totals?: PrivateLiquidityPositionHistoryTotals;
  historyRows?: readonly PrivateLiquidityPositionHistoryRow[];
  deploymentReady: boolean;
  walletReady: boolean;
  processingAction?: PrivateLiquidityManagerAction | null;
  actionMessage?: string;
  actionStatus?: 'idle' | 'pending' | 'success' | 'error';
  privateDataLoading?: boolean;
  privateDataError?: string;
  onRevealPrivateData?: () => void;
  onAction: (intent: Exclude<PrivateLiquidityPositionActionIntent, { kind: 'create' }>) => void;
  onBack: () => void;
};

const shorten = (value: string): string => `${value.slice(0, 8)}…${value.slice(-6)}`;

const statusLabel: Record<PrivateLiquidityPositionStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  closed: 'Closed'
};

const displayedAmount = (value: string, token?: PrivateLiquidityPositionToken): string =>
  token ? formatTokenAmount(BigInt(value), token.decimals, 8) : value;

const termsLabel = (
  { baseAmount, quoteAmount }: { baseAmount: string; quoteAmount: string },
  baseToken?: PrivateLiquidityPositionToken,
  quoteToken?: PrivateLiquidityPositionToken
): string =>
  `${displayedAmount(baseAmount, baseToken)} ${baseToken?.symbol ?? 'base'} / ${displayedAmount(quoteAmount, quoteToken)} ${quoteToken?.symbol ?? 'quote'}`;

export default function PrivateLiquidityPositionManager({
  position,
  baseToken,
  quoteToken,
  inventory,
  totals,
  historyRows = [],
  deploymentReady,
  walletReady,
  processingAction = null,
  actionMessage = '',
  actionStatus = 'idle',
  privateDataLoading = false,
  privateDataError = '',
  onRevealPrivateData,
  onAction,
  onBack
}: PrivateLiquidityPositionManagerProps) {
  const [draftAction, setDraftAction] = useState<Extract<
    PrivateLiquidityManagerAction,
    'update-terms' | 'add-liquidity' | 'remove-liquidity' | 'transfer'
  > | null>(null);
  const [firstInput, setFirstInput] = useState('');
  const [secondInput, setSecondInput] = useState('');
  const [thirdInput, setThirdInput] = useState('');
  const [fourthInput, setFourthInput] = useState('');
  const disabled = !deploymentReady || !walletReady || processingAction !== null;
  const isClosed = position.status === 'closed';
  const privacyActivationRequired = position.privacyOwner === null && !isClosed;
  const inventoryLabel = inventory.state === 'available'
    ? `${inventory.baseAmount ?? '0'} ${baseToken?.symbol ?? 'base'} · ${inventory.quoteAmount ?? '0'} ${quoteToken?.symbol ?? 'quote'}`
    : inventory.state === 'locked'
      ? 'Unlock COTI privacy to reveal current inventory'
      : 'Private inventory is unavailable for this owner';

  const openDraft = (action: NonNullable<typeof draftAction>) => {
    setDraftAction(action);
    if (action === 'update-terms' && baseToken && quoteToken) {
      setFirstInput(formatTokenAmount(BigInt(position.buyTerms.baseAmount), baseToken.decimals, 18));
      setSecondInput(formatTokenAmount(BigInt(position.buyTerms.quoteAmount), quoteToken.decimals, 18));
      setThirdInput(formatTokenAmount(BigInt(position.sellTerms.baseAmount), baseToken.decimals, 18));
      setFourthInput(formatTokenAmount(BigInt(position.sellTerms.quoteAmount), quoteToken.decimals, 18));
      return;
    }
    setFirstInput('');
    setSecondInput('');
    setThirdInput('');
    setFourthInput('');
  };

  const submitDraft = () => {
    if (!draftAction) return;
    if (draftAction === 'transfer') {
      onAction({ kind: draftAction, position, recipient: firstInput });
      return;
    }
    if (!baseToken || !quoteToken) return;
    if (draftAction === 'update-terms') {
      onAction({
        kind: draftAction,
        position,
        baseToken,
        quoteToken,
        buyBaseAmountInput: firstInput,
        buyQuoteAmountInput: secondInput,
        sellBaseAmountInput: thirdInput,
        sellQuoteAmountInput: fourthInput
      });
      return;
    }
    onAction({
      kind: draftAction,
      position,
      baseToken,
      quoteToken,
      baseAmountInput: firstInput,
      quoteAmountInput: secondInput
    });
  };

  const amountInput = ({ label, value, setValue }: {
    label: string;
    value: string;
    setValue: (value: string) => void;
  }) => (
    <label>
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => setValue(sanitizeTokenAmountInput(event.target.value))}
      />
    </label>
  );

  return (
    <section className="p2p-private-liquidity-position-manager" aria-label={`Manage Position NFT ${position.identity.positionId}`}>
      <header className="p2p-private-liquidity-manager-head">
        <div>
          <span>Position NFT #{position.identity.positionId}</span>
          <strong>{shorten(position.baseToken)} / {shorten(position.quoteToken)}</strong>
          <small>Revision {position.revision} · last activity block {position.lastActivityBlock}</small>
        </div>
        <div className={`p2p-private-liquidity-status p2p-private-liquidity-status-${position.status}`}>
          {statusLabel[position.status]}
        </div>
        <button type="button" className="standalone-trade-secondary-btn" onClick={onBack}>Back to positions</button>
      </header>

      {privacyActivationRequired ? (
        <div className="p2p-private-liquidity-activation" role="status">
          <div>
            <strong>Privacy activation required after transfer</strong>
            <p>The new NFT owner must re-encrypt the live inventory before this position can resume.</p>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAction({ kind: 'activate-privacy', position, resume: true })}
          >
            {processingAction === 'activate-privacy' ? 'Activating…' : 'Activate privacy'}
          </button>
        </div>
      ) : null}

      <div className="p2p-private-liquidity-manager-grid">
        <section>
          <span>Public bid terms</span>
          <strong>{termsLabel(position.buyTerms, baseToken, quoteToken)}</strong>
          <small>{position.buySideAvailable ? 'Side currently available' : 'Side depleted · reverse fills replenish it'}</small>
        </section>
        <section>
          <span>Public ask terms</span>
          <strong>{termsLabel(position.sellTerms, baseToken, quoteToken)}</strong>
          <small>{position.sellSideAvailable ? 'Side currently available' : 'Side depleted · reverse fills replenish it'}</small>
        </section>
        <section>
          <span>Private inventory</span>
          <strong>{inventoryLabel}</strong>
          <small>Only the current NFT owner can decrypt these balances.</small>
          {inventory.state !== 'available' && onRevealPrivateData && !privacyActivationRequired ? (
            <button
              type="button"
              className="standalone-trade-secondary-btn"
              disabled={disabled || privateDataLoading}
              onClick={onRevealPrivateData}
            >
              {privateDataLoading ? 'Revealing…' : privateDataError ? 'Retry private data' : 'Reveal private data'}
            </button>
          ) : null}
          {privateDataError ? <small className="p2p-private-liquidity-private-error" role="alert">{privateDataError}</small> : null}
        </section>
      </div>

      {!isClosed ? (
        <div className="p2p-private-liquidity-manager-actions" aria-label="Position actions">
          <button type="button" disabled={disabled || privacyActivationRequired || !baseToken || !quoteToken} onClick={() => openDraft('update-terms')}>Edit prices</button>
          <button type="button" disabled={disabled || privacyActivationRequired || !baseToken || !quoteToken} onClick={() => openDraft('add-liquidity')}>Add liquidity</button>
          <button type="button" disabled={disabled || privacyActivationRequired || !baseToken || !quoteToken} onClick={() => openDraft('remove-liquidity')}>Withdraw liquidity</button>
          {position.status === 'active' ? (
            <button type="button" disabled={disabled} onClick={() => onAction({ kind: 'pause', position })}>Pause</button>
          ) : (
            <button type="button" disabled={disabled || privacyActivationRequired} onClick={() => onAction({ kind: 'resume', position })}>Resume</button>
          )}
          <button type="button" disabled={disabled} onClick={() => openDraft('transfer')}>Transfer NFT</button>
          <button type="button" className="p2p-private-liquidity-danger" disabled={disabled || privacyActivationRequired} onClick={() => onAction({ kind: 'close', position })}>Close &amp; withdraw all</button>
        </div>
      ) : null}

      {draftAction ? (
        <section className="p2p-private-liquidity-action-form" aria-label={`${draftAction} Position NFT`}>
          <div className="p2p-private-liquidity-action-form-head">
            <div>
              <strong>{draftAction === 'update-terms' ? 'Edit public prices' : draftAction === 'add-liquidity' ? 'Add private liquidity' : draftAction === 'remove-liquidity' ? 'Withdraw private liquidity' : 'Transfer Position NFT'}</strong>
              <small>Revision {position.revision} will be checked on-chain.</small>
            </div>
            <button type="button" className="standalone-trade-secondary-btn" disabled={disabled} onClick={() => setDraftAction(null)}>Cancel</button>
          </div>
          <div className="p2p-private-liquidity-action-fields">
            {draftAction === 'transfer' ? (
              <label>
                <span>Recipient MetaMask address</span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="0x…"
                  value={firstInput}
                  onChange={(event) => setFirstInput(event.target.value.trim())}
                />
              </label>
            ) : draftAction === 'update-terms' ? (
              <>
                {amountInput({ label: `Bid base (${baseToken?.symbol ?? 'base'})`, value: firstInput, setValue: setFirstInput })}
                {amountInput({ label: `Bid quote (${quoteToken?.symbol ?? 'quote'})`, value: secondInput, setValue: setSecondInput })}
                {amountInput({ label: `Ask base (${baseToken?.symbol ?? 'base'})`, value: thirdInput, setValue: setThirdInput })}
                {amountInput({ label: `Ask quote (${quoteToken?.symbol ?? 'quote'})`, value: fourthInput, setValue: setFourthInput })}
              </>
            ) : (
              <>
                {amountInput({ label: `${baseToken?.symbol ?? 'Base'} amount`, value: firstInput, setValue: setFirstInput })}
                {amountInput({ label: `${quoteToken?.symbol ?? 'Quote'} amount`, value: secondInput, setValue: setSecondInput })}
              </>
            )}
          </div>
          <button type="button" className="trade-card-action trade-card-action-accept" disabled={disabled} onClick={submitDraft}>
            Review {draftAction.replace(/-/g, ' ')}
          </button>
        </section>
      ) : null}

      {actionMessage ? (
        <div className={`p2p-private-liquidity-action-message is-${actionStatus}`} role={actionStatus === 'error' ? 'alert' : 'status'}>
          {actionMessage}
        </div>
      ) : null}

      <section className="p2p-private-liquidity-activity" aria-label="Position activity">
        <div className="p2p-private-liquidity-activity-head">
          <div>
            <span>Position activity</span>
            <strong>{totals?.fillCount ?? historyRows.length} private fills</strong>
          </div>
          {totals ? (
            <small>
              {baseToken?.symbol ?? 'Base'} received {displayedAmount(totals.baseReceived, baseToken)} · {baseToken?.symbol ?? 'base'} paid {displayedAmount(totals.basePaid, baseToken)} · {quoteToken?.symbol ?? 'quote'} received {displayedAmount(totals.quoteReceived, quoteToken)} · {quoteToken?.symbol ?? 'quote'} paid {displayedAmount(totals.quotePaid, quoteToken)}
            </small>
          ) : null}
        </div>
        {historyRows.length === 0 ? (
          <p>No finalized fills for this position yet.</p>
        ) : (
          <ol>
            {historyRows.map((row) => (
              <li key={row.key}>
                <div>
                  <strong>Swap #{row.swapId}</strong>
                  <span>{row.direction === 'base-to-quote' ? 'Bought base' : 'Sold base'}</span>
                </div>
                <div>
                  <span>{displayedAmount(row.baseAmount, baseToken)} {baseToken?.symbol ?? 'base'}</span>
                  <span>{displayedAmount(row.quoteAmount, quoteToken)} {quoteToken?.symbol ?? 'quote'}</span>
                </div>
                <small>Block {row.provenance.blockNumber}</small>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
