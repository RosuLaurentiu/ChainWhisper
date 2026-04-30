import { COTI_NETWORK, TRADE_ESCROW_CONTRACT_ADDRESS, type TradeFeeModeSelection } from '../lib/appShared';

export type TradeComposerTokenOption = {
  value: string;
  label: string;
};

type TradeComposerPanelProps = {
  feeMode: TradeFeeModeSelection;
  onFeeModeChange: (value: TradeFeeModeSelection) => void;
  feeSummaryLabel: string;
  feeError?: string;
  offerTokenOptions: TradeComposerTokenOption[];
  requestTokenOptions: TradeComposerTokenOption[];
  offerTokenSelection: string;
  onOfferTokenSelectionChange: (value: string) => void;
  requestTokenSelection: string;
  onRequestTokenSelectionChange: (value: string) => void;
  offerAssetError?: string;
  requestAssetError?: string;
  offerCustomAddress: string;
  onOfferCustomAddressChange: (value: string) => void;
  requestCustomAddress: string;
  onRequestCustomAddressChange: (value: string) => void;
  offerCustomMetaLabel: string;
  requestCustomMetaLabel: string;
  offerVerifyUrl?: string;
  requestVerifyUrl?: string;
  offerAmountInput: string;
  onOfferAmountInputChange: (value: string) => void;
  requestAmountInput: string;
  onRequestAmountInputChange: (value: string) => void;
  offerAmountError?: string;
  requestAmountError?: string;
  canUseMaxOfferAmount?: boolean;
  onUseMaxOfferAmount?: () => void;
  offerAmountSummaryLabel: string;
  requestAmountSummaryLabel: string;
  offerBalanceSummaryLabel: string;
  onSwapSides?: () => void;
  swapDisabled?: boolean;
  tradePreviewLabel?: string;
  tradeRateLabel?: string;
  expiresHoursInput: string;
  onExpiresHoursInputChange: (value: string) => void;
  expiresNever?: boolean;
  onExpiresNeverChange?: (value: boolean) => void;
  expiryError?: string;
  sending: boolean;
  canSend: boolean;
  title?: string;
  metaLabel?: string;
  safetyNote?: string;
  sendLabel?: string;
  sendingLabel?: string;
  sendTitle?: string;
  onSendTradeOffer: () => void;
  generalError?: string;
  validationMessage?: string;
};

function TradeSwapIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M3 8.5h12.5l-2.8-2.8 1.45-1.45L19.55 9l-5.4 4.75-1.45-1.45 2.8-2.8H3z"
        fill="currentColor"
        stroke="rgba(10, 10, 16, 0.9)"
        strokeWidth="0.8"
        strokeLinejoin="round"
        paintOrder="stroke"
      />
      <path
        d="M21 15.5H8.5l2.8 2.8-1.45 1.45L4.45 15l5.4-4.75 1.45 1.45-2.8 2.8H21z"
        fill="currentColor"
        stroke="rgba(10, 10, 16, 0.9)"
        strokeWidth="0.8"
        strokeLinejoin="round"
        paintOrder="stroke"
      />
    </svg>
  );
}

const explorerLabel = 'View token on explorer';

export default function TradeComposerPanel({
  feeMode,
  onFeeModeChange,
  feeSummaryLabel,
  feeError,
  offerTokenOptions,
  requestTokenOptions,
  offerTokenSelection,
  onOfferTokenSelectionChange,
  requestTokenSelection,
  onRequestTokenSelectionChange,
  offerAssetError,
  requestAssetError,
  offerCustomAddress,
  onOfferCustomAddressChange,
  requestCustomAddress,
  onRequestCustomAddressChange,
  offerCustomMetaLabel,
  requestCustomMetaLabel,
  offerVerifyUrl,
  requestVerifyUrl,
  offerAmountInput,
  onOfferAmountInputChange,
  requestAmountInput,
  onRequestAmountInputChange,
  offerAmountError,
  requestAmountError,
  canUseMaxOfferAmount,
  onUseMaxOfferAmount,
  offerAmountSummaryLabel,
  requestAmountSummaryLabel,
  offerBalanceSummaryLabel,
  onSwapSides,
  swapDisabled,
  tradePreviewLabel,
  tradeRateLabel,
  expiresHoursInput,
  onExpiresHoursInputChange,
  expiresNever = false,
  onExpiresNeverChange,
  expiryError,
  sending,
  canSend,
  title = 'Trade offer',
  metaLabel = 'Private terms, on-chain escrow',
  safetyNote = 'Trade terms stay in your encrypted private chat, but the final asset transfers remain visible on-chain.',
  sendLabel = 'Send Trade',
  sendingLabel = 'Creating...',
  sendTitle = 'Create the escrow trade and send the encrypted offer to this chat.',
  onSendTradeOffer,
  generalError,
  validationMessage
}: TradeComposerPanelProps) {
  const showOfferCustomToken = offerTokenSelection.startsWith('custom');
  const showRequestCustomToken = requestTokenSelection.startsWith('custom');
  const compactFeeSummaryLabel = feeSummaryLabel.replace(/^fee:\s*/i, '').trim();
  const hasTradePreview = Boolean(tradePreviewLabel || tradeRateLabel);
  const escrowContractUrl = `${COTI_NETWORK.blockExplorerUrl}/address/${TRADE_ESCROW_CONTRACT_ADDRESS}`;

  return (
    <div className="trade-compose-panel" role="group" aria-label="P2P trade offer">
      <div className="trade-compose-header">
        <strong>{title}</strong>
        <div className="trade-compose-header-meta">
          <span>{metaLabel}</span>
          <a
            className="trade-compose-header-link"
            href={escrowContractUrl}
            target="_blank"
            rel="noreferrer"
          >
            Escrow
          </a>
        </div>
      </div>

      <details className="trade-compose-warning">
        <summary>Safety note: verify token contracts before sending</summary>
        <div className="trade-compose-warning-body">
          <p>Only the escrowed settlement is enforced on-chain. Trade only with people you trust.</p>
          <p>{safetyNote}</p>
        </div>
      </details>

      <div className="trade-compose-grid">
        <section className="trade-compose-section trade-compose-section-sell" aria-label="Asset you are sending">
          <div className="trade-compose-section-header">
            <strong>You send</strong>
            <span>Balance: {offerBalanceSummaryLabel}</span>
          </div>
          <label className="trade-compose-field">
            <span className="trade-compose-field-head">
              <span className="trade-compose-field-label">Asset</span>
              {!showOfferCustomToken && offerVerifyUrl ? (
                <a
                  className="trade-compose-icon-link"
                  href={offerVerifyUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={explorerLabel}
                  title={explorerLabel}
                >
                  Explorer
                </a>
              ) : null}
            </span>
            <select
              className="trade-compose-select"
              value={offerTokenSelection}
              onChange={(event) => onOfferTokenSelectionChange(event.target.value)}
              disabled={sending}
              aria-invalid={offerAssetError ? 'true' : 'false'}
            >
              {offerTokenOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {showOfferCustomToken ? (
            <>
              <label className="trade-compose-field">
                <span className="trade-compose-field-label">Contract</span>
                <input
                  className="trade-compose-input"
                  type="text"
                  value={offerCustomAddress}
                  onChange={(event) => onOfferCustomAddressChange(event.target.value)}
                  placeholder="Custom token contract address"
                  disabled={sending}
                  aria-invalid={offerAssetError ? 'true' : 'false'}
                />
              </label>
              <div className="trade-compose-token-meta">
                <span>{offerCustomMetaLabel}</span>
                {offerVerifyUrl ? (
                  <a
                    className="trade-compose-icon-link"
                    href={offerVerifyUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={explorerLabel}
                    title={explorerLabel}
                  >
                    Explorer
                  </a>
                ) : null}
              </div>
            </>
          ) : null}
          {offerAssetError ? <p className="trade-compose-field-error">{offerAssetError}</p> : null}
          <label className="trade-compose-field">
            <span className="trade-compose-field-head">
              <span className="trade-compose-field-label">Amount</span>
              <span className="trade-compose-field-tools">
                <strong className="trade-compose-field-value">{offerAmountSummaryLabel}</strong>
                <button
                  type="button"
                  className="trade-compose-max"
                  onClick={() => onUseMaxOfferAmount?.()}
                  disabled={!canUseMaxOfferAmount || sending}
                >
                  Max
                </button>
              </span>
            </span>
            <input
              className="trade-compose-input"
              type="text"
              inputMode="decimal"
              value={offerAmountInput}
              onChange={(event) => onOfferAmountInputChange(event.target.value)}
              placeholder="Amount to send"
              disabled={sending}
              aria-invalid={offerAmountError ? 'true' : 'false'}
            />
          </label>
          {offerAmountError ? <p className="trade-compose-field-error">{offerAmountError}</p> : null}
        </section>

        <button
          type="button"
          className="trade-compose-swap-indicator"
          onClick={() => onSwapSides?.()}
          disabled={swapDisabled}
          aria-label="Swap send and receive sides"
          title="Swap trade sides"
        >
          <TradeSwapIcon />
        </button>

        <section className="trade-compose-section trade-compose-section-buy" aria-label="Asset you want back">
          <div className="trade-compose-section-header">
            <strong>You receive</strong>
            <span>Counterparty sends this</span>
          </div>
          <label className="trade-compose-field">
            <span className="trade-compose-field-head">
              <span className="trade-compose-field-label">Asset</span>
              {!showRequestCustomToken && requestVerifyUrl ? (
                <a
                  className="trade-compose-icon-link"
                  href={requestVerifyUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={explorerLabel}
                  title={explorerLabel}
                >
                  Explorer
                </a>
              ) : null}
            </span>
            <select
              className="trade-compose-select"
              value={requestTokenSelection}
              onChange={(event) => onRequestTokenSelectionChange(event.target.value)}
              disabled={sending}
              aria-invalid={requestAssetError ? 'true' : 'false'}
            >
              {requestTokenOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {showRequestCustomToken ? (
            <>
              <label className="trade-compose-field">
                <span className="trade-compose-field-label">Contract</span>
                <input
                  className="trade-compose-input"
                  type="text"
                  value={requestCustomAddress}
                  onChange={(event) => onRequestCustomAddressChange(event.target.value)}
                  placeholder="Custom token contract address"
                  disabled={sending}
                  aria-invalid={requestAssetError ? 'true' : 'false'}
                />
              </label>
              <div className="trade-compose-token-meta">
                <span>{requestCustomMetaLabel}</span>
                {requestVerifyUrl ? (
                  <a
                    className="trade-compose-icon-link"
                    href={requestVerifyUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={explorerLabel}
                    title={explorerLabel}
                  >
                    Explorer
                  </a>
                ) : null}
              </div>
            </>
          ) : null}
          {requestAssetError ? <p className="trade-compose-field-error">{requestAssetError}</p> : null}
          <label className="trade-compose-field">
            <span className="trade-compose-field-head">
              <span className="trade-compose-field-label">Amount</span>
              <strong className="trade-compose-field-value">{requestAmountSummaryLabel}</strong>
            </span>
            <input
              className="trade-compose-input"
              type="text"
              inputMode="decimal"
              value={requestAmountInput}
              onChange={(event) => onRequestAmountInputChange(event.target.value)}
              placeholder="Amount you want"
              disabled={sending}
              aria-invalid={requestAmountError ? 'true' : 'false'}
            />
          </label>
          {requestAmountError ? <p className="trade-compose-field-error">{requestAmountError}</p> : null}
        </section>
      </div>

      <div className={hasTradePreview ? 'trade-compose-bottom' : 'trade-compose-bottom trade-compose-bottom-compact'}>
        {hasTradePreview ? (
          <div className="trade-compose-preview" aria-live="polite">
            {tradePreviewLabel ? <strong>{tradePreviewLabel}</strong> : null}
            {tradeRateLabel ? <span>{tradeRateLabel}</span> : null}
          </div>
        ) : null}

        <div className="trade-compose-footer">
          <div className="trade-compose-fee-row trade-compose-fee-row-inline">
            <div className="trade-compose-fee-copy">
              <span className="trade-compose-field-label">Fee</span>
              <strong className="trade-compose-fee-value">{compactFeeSummaryLabel || feeSummaryLabel}</strong>
            </div>
            <div className="trade-compose-fee-segmented" role="group" aria-label="Trade fee mode">
              <button
                type="button"
                className={feeMode === 'coti' ? 'trade-compose-fee-toggle active' : 'trade-compose-fee-toggle'}
                onClick={() => onFeeModeChange('coti')}
                disabled={sending}
                aria-pressed={feeMode === 'coti'}
              >
                COTI
              </button>
              <button
                type="button"
                className={feeMode === 'token' ? 'trade-compose-fee-toggle active token' : 'trade-compose-fee-toggle token'}
                onClick={() => onFeeModeChange('token')}
                disabled={sending}
                aria-pressed={feeMode === 'token'}
              >
                Token
              </button>
            </div>
            {feeError ? <p className="trade-compose-field-error trade-compose-fee-error">{feeError}</p> : null}
          </div>
          <label className="trade-compose-expiry">
            <span>Expiration</span>
            <div
              className={
                onExpiresNeverChange
                  ? 'trade-compose-expiry-controls'
                  : 'trade-compose-expiry-controls trade-compose-expiry-controls-single'
              }
            >
              <input
                className="trade-compose-input"
                type="text"
                inputMode="numeric"
                value={expiresHoursInput}
                onChange={(event) => onExpiresHoursInputChange(event.target.value)}
                disabled={sending || expiresNever}
                aria-invalid={expiryError ? 'true' : 'false'}
                aria-label="Expiry in hours"
              />
              {onExpiresNeverChange ? (
                <button
                  type="button"
                  className={expiresNever ? 'trade-compose-expiry-toggle active' : 'trade-compose-expiry-toggle'}
                  onClick={() => onExpiresNeverChange(!expiresNever)}
                  disabled={sending}
                  aria-pressed={expiresNever}
                >
                  No expiry
                </button>
              ) : null}
            </div>
          </label>
          <button
            type="button"
            className="trade-compose-send"
            onClick={onSendTradeOffer}
            disabled={!canSend}
            title={validationMessage || sendTitle}
          >
            {sending ? sendingLabel : sendLabel}
          </button>
        </div>
      </div>
      {expiryError ? <p className="trade-compose-field-error">{expiryError}</p> : null}

      {generalError ? <p className="trade-compose-validation">{generalError}</p> : null}
    </div>
  );
}
