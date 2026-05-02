import { useEffect, useRef, useState } from 'react';
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
  offerAmountLabel?: string;
  requestAmountLabel?: string;
  offerAmountPlaceholder?: string;
  requestAmountPlaceholder?: string;
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
  tradeReverseRateLabel?: string;
  expiresHoursInput: string;
  onExpiresHoursInputChange: (value: string) => void;
  expiresNever?: boolean;
  onExpiresNeverChange?: (value: boolean) => void;
  expiryError?: string;
  hidePrivateLiquidity?: boolean;
  canHidePrivateLiquidity?: boolean;
  hiddenLiquidityUnavailableMessage?: string;
  onHidePrivateLiquidityChange?: (value: boolean) => void;
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

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="14" height="14">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

type TradeTokenScope = 'public' | 'private';

const stripTokenCheckmark = (value: string): string => value.replace(/^[\s✓]+/, '').trim();

const resolveTokenOptionScope = (option?: TradeComposerTokenOption): TradeTokenScope => {
  if (!option) return 'public';
  const label = option.label.toLowerCase();
  if (option.value === 'pwisp' || option.value === 'custom-private' || label.includes('(private)')) {
    return 'private';
  }
  return 'public';
};

function TradeTokenSelect({
  options,
  value,
  onChange,
  disabled,
  invalid
}: {
  options: TradeComposerTokenOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [activeScope, setActiveScope] = useState<TradeTokenScope>('public');
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((o) => o.value === value);
  const selectedLabel = selectedOption?.label ?? value;
  const normalizedSearch = searchInput.trim().toLowerCase();
  const publicCount = options.filter((option) => resolveTokenOptionScope(option) === 'public').length;
  const privateCount = options.filter((option) => resolveTokenOptionScope(option) === 'private').length;
  const filteredOptions = options.filter((option) => {
    if (resolveTokenOptionScope(option) !== activeScope) return false;
    if (!normalizedSearch) return true;
    return `${option.label} ${option.value}`.toLowerCase().includes(normalizedSearch);
  });
  const selectOption = (option: TradeComposerTokenOption) => {
    onChange(option.value);
    setOpen(false);
    setSearchInput('');
    setActiveScope(resolveTokenOptionScope(option));
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSearchInput('');
    setActiveScope(resolveTokenOptionScope(selectedOption));
  }, [open, selectedOption?.value]);

  return (
    <div
      ref={containerRef}
      className={[
        'trade-token-select',
        open ? 'open' : '',
        invalid ? 'invalid' : ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        className="trade-token-select-trigger"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selectedLabel}</span>
        <ChevronIcon />
      </button>
      {open ? (
        <div className="trade-token-select-dropdown">
          <div className="trade-token-select-search">
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={`Search ${activeScope} tokens`}
              autoFocus
              aria-label="Search trade tokens"
            />
            <div className="trade-token-select-tabs" role="tablist" aria-label="Token type">
              <button
                type="button"
                className={activeScope === 'public' ? 'active' : undefined}
                onClick={() => setActiveScope('public')}
                role="tab"
                aria-selected={activeScope === 'public'}
              >
                Public <span>{publicCount}</span>
              </button>
              <button
                type="button"
                className={activeScope === 'private' ? 'active' : undefined}
                onClick={() => setActiveScope('private')}
                role="tab"
                aria-selected={activeScope === 'private'}
              >
                Private <span>{privateCount}</span>
              </button>
            </div>
          </div>
          <ul className="trade-token-select-list" role="listbox">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const isVerified = option.label.trim().startsWith('✓');
                return (
                  <li
                    key={option.value}
                    role="option"
                    tabIndex={0}
                    aria-selected={option.value === value}
                    className={[
                      'trade-token-select-option',
                      option.value === value ? 'selected' : '',
                      isVerified ? 'verified' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      selectOption(option);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectOption(option);
                      }
                    }}
                  >
                    {isVerified ? (
                      <>
                        <span className="trade-token-select-check" aria-hidden="true">
                          ✓
                        </span>
                        <span>{stripTokenCheckmark(option.label)}</span>
                      </>
                    ) : (
                      <span>{option.label}</span>
                    )}
                  </li>
                );
              })
            ) : (
              <li className="trade-token-select-empty">No {activeScope} tokens match that search.</li>
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

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
  offerAmountLabel = 'Amount',
  requestAmountLabel = 'Amount',
  offerAmountPlaceholder = 'Amount to send',
  requestAmountPlaceholder = 'Amount you want',
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
  tradeReverseRateLabel,
  expiresHoursInput,
  onExpiresHoursInputChange,
  expiresNever = false,
  onExpiresNeverChange,
  expiryError,
  hidePrivateLiquidity = false,
  canHidePrivateLiquidity = false,
  hiddenLiquidityUnavailableMessage = '',
  onHidePrivateLiquidityChange,
  sending,
  canSend,
  title = 'Trade offer',
  metaLabel = 'Private terms, on-chain escrow',
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
  const [showReverseRate, setShowReverseRate] = useState(false);
  const visibleTradeRateLabel = showReverseRate && tradeReverseRateLabel ? tradeReverseRateLabel : tradeRateLabel;
  const showHiddenLiquidityToggle = Boolean(onHidePrivateLiquidityChange);

  useEffect(() => {
    setShowReverseRate(false);
  }, [tradeRateLabel, tradeReverseRateLabel]);

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

      <div className="trade-compose-grid">
        <section className="trade-compose-section trade-compose-section-sell" aria-label="Asset you are sending">
          <div className="trade-compose-section-header">
            <strong>You sell</strong>
            <span>Balance: {offerBalanceSummaryLabel}</span>
          </div>
          <label className="trade-compose-field trade-compose-asset-field">
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
            <TradeTokenSelect
              options={offerTokenOptions}
              value={offerTokenSelection}
              onChange={onOfferTokenSelectionChange}
              disabled={sending}
              invalid={Boolean(offerAssetError)}
            />
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
          <label className="trade-compose-field trade-compose-amount-field">
            <span className="trade-compose-field-head">
              <span className="trade-compose-field-label">{offerAmountLabel}</span>
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
              placeholder={offerAmountPlaceholder}
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
            <strong>You buy</strong>
            <span>Counterparty sends this</span>
          </div>
          <label className="trade-compose-field trade-compose-asset-field">
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
            <TradeTokenSelect
              options={requestTokenOptions}
              value={requestTokenSelection}
              onChange={onRequestTokenSelectionChange}
              disabled={sending}
              invalid={Boolean(requestAssetError)}
            />
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
          <label className="trade-compose-field trade-compose-amount-field">
            <span className="trade-compose-field-head">
              <span className="trade-compose-field-label">{requestAmountLabel}</span>
              <strong className="trade-compose-field-value">{requestAmountSummaryLabel}</strong>
            </span>
            <input
              className="trade-compose-input"
              type="text"
              inputMode="decimal"
              value={requestAmountInput}
              onChange={(event) => onRequestAmountInputChange(event.target.value)}
              placeholder={requestAmountPlaceholder}
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
            {tradePreviewLabel && !visibleTradeRateLabel ? <strong>{tradePreviewLabel}</strong> : null}
            {visibleTradeRateLabel ? (
              <button
                type="button"
                className="trade-compose-rate-toggle"
                onClick={() => setShowReverseRate((value) => !value)}
                title="Flip rate"
                aria-label="Flip displayed trade rate"
              >
                <span>Price ratio</span>
                <strong>{visibleTradeRateLabel}</strong>
              </button>
            ) : null}
          </div>
        ) : null}

        {showHiddenLiquidityToggle ? (
          <label
            className={
              hidePrivateLiquidity
                ? 'trade-compose-privacy-row trade-compose-privacy-row-active'
                : 'trade-compose-privacy-row'
            }
            title={canHidePrivateLiquidity ? 'Publish only the ratio; keep amounts and fills private' : hiddenLiquidityUnavailableMessage}
          >
            <input
              type="checkbox"
              checked={hidePrivateLiquidity}
              onChange={(event) => onHidePrivateLiquidityChange?.(event.target.checked)}
              disabled={sending || (!canHidePrivateLiquidity && !hidePrivateLiquidity)}
            />
            <span>Private liquidity</span>
            <strong>
              {hidePrivateLiquidity
                ? 'Price public, amounts private'
                : canHidePrivateLiquidity
                  ? 'Off'
                  : hiddenLiquidityUnavailableMessage}
            </strong>
          </label>
        ) : null}

        <div className="trade-compose-footer">
          <div className="trade-compose-fee-row trade-compose-fee-row-inline">
            <div className="trade-compose-fee-copy">
              <span className="trade-compose-field-label">Fee</span>
              <strong className="trade-compose-fee-value">{compactFeeSummaryLabel || feeSummaryLabel}</strong>
            </div>
            <div className="trade-compose-fee-segmented" role="group" aria-label="Trade fee">
              <button
                type="button"
                className={feeMode === 'coti' ? 'trade-compose-fee-toggle active' : 'trade-compose-fee-toggle'}
                onClick={() => onFeeModeChange('coti')}
                disabled={sending}
                aria-pressed={feeMode === 'coti'}
              >
                COTI
              </button>
            </div>
            {feeError ? <p className="trade-compose-field-error trade-compose-fee-error">{feeError}</p> : null}
          </div>
          <div className="trade-compose-expiry" role="group" aria-label="Trade expiration">
            <label htmlFor="trade-compose-expiry-hours">Expiration</label>
            <div
              className={
                onExpiresNeverChange
                  ? 'trade-compose-expiry-controls'
                  : 'trade-compose-expiry-controls trade-compose-expiry-controls-single'
              }
            >
              <input
                id="trade-compose-expiry-hours"
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
                  className={
                    expiresNever
                      ? 'trade-compose-expiry-toggle trade-compose-expiry-never active'
                      : 'trade-compose-expiry-toggle trade-compose-expiry-never'
                  }
                  onClick={() => onExpiresNeverChange(!expiresNever)}
                  disabled={sending}
                  aria-pressed={expiresNever}
                >
                  No expiry
                </button>
              ) : null}
            </div>
          </div>
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
      <div className="trade-compose-warning" role="alert">
        <p>
          <strong>P2P trading risks:</strong> Always verify token contract addresses, amounts, and exchange rates before
          confirming. Only the escrowed asset transfer is enforced on-chain — only trade with parties you trust.
        </p>
      </div>
      {expiryError ? <p className="trade-compose-field-error">{expiryError}</p> : null}

      {generalError ? <p className="trade-compose-validation">{generalError}</p> : null}
    </div>
  );
}
