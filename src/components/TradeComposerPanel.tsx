import type { TradeFeeModeSelection } from '../lib/appShared';

export type TradeComposerTokenOption = {
  value: string;
  label: string;
};

type TradeComposerPanelProps = {
  feeMode: TradeFeeModeSelection;
  onToggleFeeMode: () => void;
  feeSummaryLabel: string;
  offerTokenOptions: TradeComposerTokenOption[];
  requestTokenOptions: TradeComposerTokenOption[];
  offerTokenSelection: string;
  onOfferTokenSelectionChange: (value: string) => void;
  requestTokenSelection: string;
  onRequestTokenSelectionChange: (value: string) => void;
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
  offerAmountSummaryLabel: string;
  requestAmountSummaryLabel: string;
  offerBalanceSummaryLabel: string;
  expiresHoursInput: string;
  onExpiresHoursInputChange: (value: string) => void;
  sending: boolean;
  canSend: boolean;
  onSendTradeOffer: () => void;
  validationMessage?: string;
};

const verifyLabel = 'Verify on explorer';

export default function TradeComposerPanel({
  feeMode,
  onToggleFeeMode,
  feeSummaryLabel,
  offerTokenOptions,
  requestTokenOptions,
  offerTokenSelection,
  onOfferTokenSelectionChange,
  requestTokenSelection,
  onRequestTokenSelectionChange,
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
  offerAmountSummaryLabel,
  requestAmountSummaryLabel,
  offerBalanceSummaryLabel,
  expiresHoursInput,
  onExpiresHoursInputChange,
  sending,
  canSend,
  onSendTradeOffer,
  validationMessage
}: TradeComposerPanelProps) {
  const showOfferCustomToken = offerTokenSelection.startsWith('custom');
  const showRequestCustomToken = requestTokenSelection.startsWith('custom');

  return (
    <div className="trade-compose-panel" role="group" aria-label="P2P trade offer">
      <div className="trade-compose-warning">
        <strong>P2P trade warning</strong>
        <p>Only the escrowed settlement is enforced on-chain. Verify token contracts and trade only with people you trust.</p>
        <p>Trade terms stay in your encrypted private chat, but the final asset transfers remain visible on-chain.</p>
      </div>

      <div className="trade-compose-fee-row">
        <button
          type="button"
          className={feeMode === 'coti' ? 'group-fee-toggle coti' : 'group-fee-toggle token'}
          onClick={onToggleFeeMode}
          disabled={sending}
          title={feeMode === 'coti' ? 'Fee will be paid in COTI.' : 'Fee will be paid with the configured fee token.'}
        >
          Fee: {feeMode === 'coti' ? 'COTI' : 'Token'}
        </button>
        <span className="trade-compose-fee-summary">{feeSummaryLabel}</span>
      </div>

      <div className="trade-compose-grid">
        <section className="trade-compose-section" aria-label="Asset you are locking">
          <div className="trade-compose-section-header">
            <strong>You lock</strong>
            <span>Balance: {offerBalanceSummaryLabel}</span>
          </div>
          <select
            className="trade-compose-select"
            value={offerTokenSelection}
            onChange={(event) => onOfferTokenSelectionChange(event.target.value)}
            disabled={sending}
          >
            {offerTokenOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {showOfferCustomToken ? (
            <>
              <input
                className="trade-compose-input"
                type="text"
                value={offerCustomAddress}
                onChange={(event) => onOfferCustomAddressChange(event.target.value)}
                placeholder="Custom token contract address"
                disabled={sending}
              />
              <div className="trade-compose-token-meta">
                <span>{offerCustomMetaLabel}</span>
                {offerVerifyUrl ? (
                  <a href={offerVerifyUrl} target="_blank" rel="noreferrer">
                    {verifyLabel}
                  </a>
                ) : null}
              </div>
            </>
          ) : offerVerifyUrl ? (
            <div className="trade-compose-token-meta">
              <span>Token preset</span>
              <a href={offerVerifyUrl} target="_blank" rel="noreferrer">
                {verifyLabel}
              </a>
            </div>
          ) : null}
          <input
            className="trade-compose-input"
            type="text"
            inputMode="decimal"
            value={offerAmountInput}
            onChange={(event) => onOfferAmountInputChange(event.target.value)}
            placeholder="Amount to lock"
            disabled={sending}
          />
          <div className="trade-compose-summary">{offerAmountSummaryLabel}</div>
        </section>

        <section className="trade-compose-section" aria-label="Asset you want back">
          <div className="trade-compose-section-header">
            <strong>You receive</strong>
            <span>Requested from your counterparty</span>
          </div>
          <select
            className="trade-compose-select"
            value={requestTokenSelection}
            onChange={(event) => onRequestTokenSelectionChange(event.target.value)}
            disabled={sending}
          >
            {requestTokenOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {showRequestCustomToken ? (
            <>
              <input
                className="trade-compose-input"
                type="text"
                value={requestCustomAddress}
                onChange={(event) => onRequestCustomAddressChange(event.target.value)}
                placeholder="Custom token contract address"
                disabled={sending}
              />
              <div className="trade-compose-token-meta">
                <span>{requestCustomMetaLabel}</span>
                {requestVerifyUrl ? (
                  <a href={requestVerifyUrl} target="_blank" rel="noreferrer">
                    {verifyLabel}
                  </a>
                ) : null}
              </div>
            </>
          ) : requestVerifyUrl ? (
            <div className="trade-compose-token-meta">
              <span>Token preset</span>
              <a href={requestVerifyUrl} target="_blank" rel="noreferrer">
                {verifyLabel}
              </a>
            </div>
          ) : null}
          <input
            className="trade-compose-input"
            type="text"
            inputMode="decimal"
            value={requestAmountInput}
            onChange={(event) => onRequestAmountInputChange(event.target.value)}
            placeholder="Amount you want"
            disabled={sending}
          />
          <div className="trade-compose-summary">{requestAmountSummaryLabel}</div>
        </section>
      </div>

      <div className="trade-compose-footer">
        <label className="trade-compose-expiry">
          <span>Expires in hours</span>
          <input
            className="trade-compose-input"
            type="text"
            inputMode="numeric"
            value={expiresHoursInput}
            onChange={(event) => onExpiresHoursInputChange(event.target.value)}
            disabled={sending}
          />
        </label>
        <button
          type="button"
          className="trade-compose-send"
          onClick={onSendTradeOffer}
          disabled={!canSend}
          title={validationMessage || 'Create the escrow trade and send the encrypted offer to this chat.'}
        >
          {sending ? 'Creating trade...' : 'Send Trade Offer'}
        </button>
      </div>

      {validationMessage ? <p className="trade-compose-validation">{validationMessage}</p> : null}
    </div>
  );
}
