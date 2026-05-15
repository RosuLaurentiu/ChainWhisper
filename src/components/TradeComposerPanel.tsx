import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  COTI_NETWORK,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  isWalletAddress,
  shortenAddress,
  type TradeFeeModeSelection
} from '../lib/appShared';
import type { TradePricingField } from '../lib/tradePricing';

export type TradeComposerTokenOption = {
  value: string;
  label: string;
  symbol?: string;
  kindLabel?: 'Native' | 'Public' | 'Private';
  addressLabel?: string;
  verificationLabel?: string;
};

type TradeComposerPanelProps = {
  validationDisplayMode?: 'immediate' | 'after-interaction';
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
  priceInput?: string;
  onPriceInputChange?: (value: string) => void;
  priceLabel?: string;
  pricePlaceholder?: string;
  priceSummaryLabel?: string;
  priceHelpText?: string;
  pricePlacement?: 'bottom' | 'sell-side';
  showPriceRatioPreview?: boolean;
  canUseMaxOfferAmount?: boolean;
  onUseMaxOfferAmount?: () => void;
  offerAmountSummaryLabel: string;
  requestAmountSummaryLabel: string;
  offerBalanceSummaryLabel: string;
  requestBalanceSummaryLabel?: string;
  pricingSourceFields?: TradePricingField[];
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
  escrowContractAddress?: string;
  escrowContractLabel?: string;
  safetyNote?: string;
  sendLabel?: string;
  sendingLabel?: string;
  sendTitle?: string;
  actionNotice?: ReactNode;
  onSendTradeOffer: () => void;
  generalError?: string;
  validationMessage?: string;
};

type TradeComposerValidationField = 'offerAsset' | 'requestAsset' | 'offerAmount' | 'requestAmount' | 'expiry';

const normalizeActionPhrase = (label: string): string => label.trim().toLowerCase() || 'continue';

const resolveSendReadinessLabel = ({
  canSend,
  sending,
  sendLabel,
  sendingLabel,
  validationMessage
}: {
  canSend: boolean;
  sending: boolean;
  sendLabel: string;
  sendingLabel: string;
  validationMessage?: string;
}): string => {
  if (sending) {
    return sendingLabel;
  }
  if (canSend) {
    return `Ready to ${normalizeActionPhrase(sendLabel)}`;
  }

  const message = validationMessage?.trim();
  if (!message) {
    return 'Complete required fields';
  }

  const normalizedMessage = message.toLowerCase();
  if (normalizedMessage.includes('connect your wallet')) {
    return 'Connect wallet to continue';
  }
  if (normalizedMessage.includes('switch to coti')) {
    return 'Switch to COTI network';
  }
  if (
    normalizedMessage.includes('loading token') ||
    normalizedMessage.includes('loading trade fee') ||
    normalizedMessage.includes('unable to read')
  ) {
    return 'Loading token balance';
  }
  if (normalizedMessage.includes('unlock privacy') || normalizedMessage.includes('refresh privacy')) {
    return 'Unlock privacy to continue';
  }

  return message;
};

const isDeferredSendValidationMessage = (validationMessage?: string): boolean => {
  const normalizedMessage = validationMessage?.trim().toLowerCase() ?? '';
  if (!normalizedMessage) {
    return false;
  }

  return (
    normalizedMessage.includes('loading token') ||
    normalizedMessage.includes('loading trade fee') ||
    normalizedMessage.includes('unable to read') ||
    normalizedMessage.includes('balance yet')
  );
};

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="14" height="14">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

type TradeTokenScope = 'public' | 'private';

const FEE_VARIANCE_NOTE = 'Fee may vary before submit.';
const explorerLabel = 'View token on explorer';

const stripTokenCheckmark = (value: string): string => value.replace(/^[\s\u2713]+/, '').trim();

const parseTokenLabel = (option?: TradeComposerTokenOption): { symbol: string; kindLabel: string } => {
  if (!option) {
    return { symbol: 'Select token', kindLabel: 'Whitelisted' };
  }
  const cleanLabel = stripTokenCheckmark(option.label);
  const kindMatch = cleanLabel.match(/\(([^)]+)\)/);
  const parsedSymbol = cleanLabel.replace(/\s*\([^)]+\)\s*$/, '').trim();
  const symbol = (option.symbol ?? parsedSymbol) || option.value;
  const rawKindLabel = option.kindLabel ?? (kindMatch?.[1] ? kindMatch[1].replace(/^ecosystem$/i, 'Public') : 'Whitelisted');
  return {
    symbol,
    kindLabel: rawKindLabel.charAt(0).toUpperCase() + rawKindLabel.slice(1)
  };
};

const resolveTokenOptionScope = (option?: TradeComposerTokenOption): TradeTokenScope => {
  if (!option) return 'public';
  const label = option.label.toLowerCase();
  if (option.kindLabel === 'Private' || option.value === 'pwisp' || label.includes('(private)')) {
    return 'private';
  }
  return 'public';
};

const resolveTokenAddressLabel = (option?: TradeComposerTokenOption): string => {
  if (!option) {
    return 'Choose from the approved token list.';
  }
  if (option.addressLabel) {
    return option.addressLabel;
  }
  if (isWalletAddress(option.value)) {
    return `CA ${shortenAddress(option.value)}`;
  }
  if (option.value === 'coti') {
    return 'COTI Mainnet native asset';
  }
  return 'Whitelisted token';
};

const resolveTokenVerificationLabel = (option?: TradeComposerTokenOption, balanceLabel?: string): string => {
  if (!option) {
    return 'Select whitelisted token';
  }
  if (balanceLabel?.trim().startsWith('--')) {
    return 'Balance pending';
  }
  if (option.value === 'coti') {
    return 'Native asset';
  }
  return 'Whitelisted';
};

export function TradeTokenSelect({
  options,
  value,
  onChange,
  disabled,
  invalid,
  balanceLabel,
  verifyUrl
}: {
  options: TradeComposerTokenOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  balanceLabel?: string;
  verifyUrl?: string;
}) {
  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [activeScope, setActiveScope] = useState<TradeTokenScope>('public');
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((o) => o.value === value);
  const selectedDisplay = parseTokenLabel(selectedOption);
  const selectedVerificationLabel = resolveTokenVerificationLabel(selectedOption, balanceLabel);
  const selectedAddressLabel = resolveTokenAddressLabel(selectedOption);
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
        <span className="trade-token-select-trigger-copy">
          <strong>{selectedDisplay.symbol}</strong>
          <small>{selectedDisplay.kindLabel}</small>
        </span>
        <ChevronIcon />
      </button>
      <div
        className={`trade-token-select-state ${
          selectedVerificationLabel === 'Balance pending' ? 'is-pending' : 'is-ready'
        }`}
      >
        <span>{selectedVerificationLabel}</span>
        {verifyUrl ? (
          <a href={verifyUrl} target="_blank" rel="noreferrer" title={explorerLabel}>
            {selectedAddressLabel}
          </a>
        ) : (
          <small>{selectedAddressLabel}</small>
        )}
      </div>
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
                const display = parseTokenLabel(option);
                const isVerified = option.label.trim().startsWith('\u2713') || Boolean(option.verificationLabel);
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
                    <span className="trade-token-select-option-main">
                      <strong>{display.symbol}</strong>
                      <small>{resolveTokenAddressLabel(option)}</small>
                    </span>
                    <span className="trade-token-select-option-kind">{display.kindLabel}</span>
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

export default function TradeComposerPanel({
  validationDisplayMode = 'immediate',
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
  priceInput = '',
  onPriceInputChange,
  priceLabel = 'Price',
  pricePlaceholder = 'quote per base',
  priceSummaryLabel = '',
  priceHelpText = 'Fill any two fields; the third updates automatically.',
  pricePlacement = 'bottom',
  showPriceRatioPreview = false,
  canUseMaxOfferAmount,
  onUseMaxOfferAmount,
  offerAmountSummaryLabel,
  requestAmountSummaryLabel,
  offerBalanceSummaryLabel,
  requestBalanceSummaryLabel = '--',
  pricingSourceFields = [],
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
  escrowContractAddress = TRADE_ESCROW_CONTRACT_ADDRESS,
  escrowContractLabel = 'Escrow',
  sendLabel = 'Send Trade',
  sendingLabel = 'Creating...',
  sendTitle = 'Create the escrow trade and send the encrypted offer to this chat.',
  actionNotice,
  onSendTradeOffer,
  generalError,
  validationMessage
}: TradeComposerPanelProps) {
  const showOfferCustomToken = offerTokenSelection.startsWith('custom');
  const showRequestCustomToken = requestTokenSelection.startsWith('custom');
  const compactFeeSummaryLabel = feeSummaryLabel.replace(/^fee:\s*/i, '').trim();
  const hasTradePreview = Boolean(tradePreviewLabel || tradeRateLabel || showPriceRatioPreview);
  const escrowContractUrl = `${COTI_NETWORK.blockExplorerUrl}/address/${escrowContractAddress}`;
  const escrowContractTitleLabel = escrowContractLabel.toLowerCase().includes('contract')
    ? escrowContractLabel
    : `${escrowContractLabel} contract`;
  const [showReverseRate, setShowReverseRate] = useState(false);
  const [touchedFields, setTouchedFields] = useState<Partial<Record<TradeComposerValidationField, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [sendWhenReady, setSendWhenReady] = useState(false);
  const visibleTradeRateLabel = showReverseRate && tradeReverseRateLabel ? tradeReverseRateLabel : tradeRateLabel;
  const showHiddenLiquidityToggle = Boolean(onHidePrivateLiquidityChange);
  const privateLiquidityStateLabel = hidePrivateLiquidity
    ? 'Private-token amounts hidden'
    : canHidePrivateLiquidity
      ? 'Private-token amounts visible'
      : 'Amounts visible';
  const privateLiquidityHelpText = hidePrivateLiquidity
    ? 'Public views show the price ratio; private-token order size and fill amounts stay hidden.'
    : canHidePrivateLiquidity
      ? 'Public views can show the entered order size; private-token transfers and receipts still use COTI privacy.'
      : hiddenLiquidityUnavailableMessage || 'Private liquidity requires the token you sell to be private.';
  const privateLiquidityPanelClassName = [
    'trade-compose-privacy-panel',
    hidePrivateLiquidity ? 'is-private trade-compose-privacy-panel-active' : '',
    !canHidePrivateLiquidity && !hidePrivateLiquidity ? 'trade-compose-privacy-panel-disabled' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const showPriceInput = Boolean(onPriceInputChange);
  const validationAfterInteraction = validationDisplayMode === 'after-interaction';
  const markTouched = (field: TradeComposerValidationField) => {
    if (!validationAfterInteraction) return;
    setTouchedFields((previous) => (previous[field] ? previous : { ...previous, [field]: true }));
  };
  const shouldShowError = (field: TradeComposerValidationField, error?: string) =>
    Boolean(error) && (!validationAfterInteraction || submitAttempted || touchedFields[field]);
  const showOfferAssetError = shouldShowError('offerAsset', offerAssetError);
  const showRequestAssetError = shouldShowError('requestAsset', requestAssetError);
  const showOfferAmountError = shouldShowError('offerAmount', offerAmountError);
  const showRequestAmountError = shouldShowError('requestAmount', requestAmountError);
  const showExpiryError = shouldShowError('expiry', expiryError);
  const sendButtonDisabled = validationAfterInteraction ? sending : !canSend;
  const showSendDisabledStyle = validationAfterInteraction
    ? submitAttempted && !canSend && !sending
    : !canSend && !sending;
  const sendButtonClassName = [
    showSendDisabledStyle ? 'trade-compose-send trade-compose-send-disabled' : 'trade-compose-send',
    sending ? 'p2p-action-pending' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const sendReadinessLabel = resolveSendReadinessLabel({
    canSend,
    sending,
    sendLabel,
    sendingLabel,
    validationMessage
  });
  const sendReadinessClassName = [
    'trade-compose-readiness',
    sending || sendWhenReady
      ? 'trade-compose-readiness-busy'
      : canSend
        ? 'trade-compose-readiness-ready'
        : 'trade-compose-readiness-blocked'
  ].join(' ');
  useEffect(() => {
    if (!sendWhenReady || sending) {
      return;
    }
    if (canSend) {
      setSendWhenReady(false);
      onSendTradeOffer();
      return;
    }
    if (!isDeferredSendValidationMessage(validationMessage)) {
      setSendWhenReady(false);
    }
  }, [canSend, onSendTradeOffer, sendWhenReady, sending, validationMessage]);
  const handleSendClick = () => {
    if (!canSend) {
      setSubmitAttempted(true);
      if (validationAfterInteraction && isDeferredSendValidationMessage(validationMessage)) {
        setSendWhenReady(true);
      }
      return;
    }
    setSendWhenReady(false);
    onSendTradeOffer();
  };
  const resolvePricingFieldClassName = (baseClassName: string, field: TradePricingField): string => {
    const fieldIsSource = pricingSourceFields.includes(field);
    const fieldIsDerived = pricingSourceFields.length >= 2 && !fieldIsSource;
    return [
      baseClassName,
      'trade-compose-pricing-field',
      fieldIsSource ? 'trade-compose-pricing-source' : '',
      fieldIsDerived ? 'trade-compose-pricing-derived' : ''
    ]
      .filter(Boolean)
      .join(' ');
  };
  const renderPricingFieldState = (field: TradePricingField) => {
    const fieldIsSource = pricingSourceFields.includes(field);
    const fieldIsDerived = pricingSourceFields.length >= 2 && !fieldIsSource;
    return fieldIsDerived ? <span className="trade-compose-pricing-state">Derived</span> : null;
  };
  const priceField = showPriceInput ? (
    <label className={resolvePricingFieldClassName('trade-compose-field trade-compose-price-field', 'price')}>
      <span className="trade-compose-field-head">
        <span className="trade-compose-field-label">{priceLabel}</span>
        {priceSummaryLabel || renderPricingFieldState('price') ? (
          <span className="trade-compose-field-tools">
            {renderPricingFieldState('price')}
            {priceSummaryLabel ? <strong className="trade-compose-field-value">{priceSummaryLabel}</strong> : null}
          </span>
        ) : null}
      </span>
      <input
        className="trade-compose-input"
        type="text"
        inputMode="decimal"
        value={priceInput}
        onChange={(event) => onPriceInputChange?.(event.target.value)}
        placeholder={pricePlaceholder}
        disabled={sending}
      />
    </label>
  ) : null;

  useEffect(() => {
    setShowReverseRate(false);
  }, [tradeRateLabel, tradeReverseRateLabel]);

  const previewInReceivePanel = pricePlacement === 'sell-side' && hasTradePreview;
  const showDockPreview = hasTradePreview && !previewInReceivePanel;
  const renderTradePreview = (className = 'trade-compose-preview') => (
    <div className={className} aria-live="polite">
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
      ) : showPriceRatioPreview ? (
        <div className="trade-compose-rate-toggle trade-compose-rate-toggle-static">
          <span>Price ratio</span>
          <strong>Reverse price appears after two fields.</strong>
        </div>
      ) : null}
    </div>
  );

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
            title={`Open ${escrowContractTitleLabel}`}
          >
            {escrowContractLabel}
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
            </span>
            <TradeTokenSelect
              options={offerTokenOptions}
              value={offerTokenSelection}
              onChange={(value) => {
                markTouched('offerAsset');
                onOfferTokenSelectionChange(value);
              }}
              disabled={sending}
              invalid={showOfferAssetError}
              balanceLabel={offerBalanceSummaryLabel}
              verifyUrl={!showOfferCustomToken ? offerVerifyUrl : undefined}
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
                  onChange={(event) => {
                    markTouched('offerAsset');
                    onOfferCustomAddressChange(event.target.value);
                  }}
                  onBlur={() => markTouched('offerAsset')}
                  placeholder="Custom token contract address"
                  disabled={sending}
                  aria-invalid={showOfferAssetError ? 'true' : 'false'}
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
          {showOfferAssetError ? <p className="trade-compose-field-error">{offerAssetError}</p> : null}
          <label className={resolvePricingFieldClassName('trade-compose-field trade-compose-amount-field', 'baseAmount')}>
              <span className="trade-compose-field-head">
                <span className="trade-compose-field-label">{offerAmountLabel}</span>
                <span className="trade-compose-field-tools">
                  {renderPricingFieldState('baseAmount')}
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
              onChange={(event) => {
                markTouched('offerAmount');
                onOfferAmountInputChange(event.target.value);
              }}
              onBlur={() => markTouched('offerAmount')}
              placeholder={offerAmountPlaceholder}
              disabled={sending}
              aria-invalid={showOfferAmountError ? 'true' : 'false'}
            />
          </label>
          {showOfferAmountError ? <p className="trade-compose-field-error">{offerAmountError}</p> : null}
          {pricePlacement === 'sell-side' ? (
            <div className="trade-compose-inline-price">
              {priceField}
              <p>{priceHelpText}</p>
            </div>
          ) : null}
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

        <section className="trade-compose-section trade-compose-section-buy" aria-label="Asset you receive">
          <div className="trade-compose-section-header">
            <strong>You receive</strong>
            <span>Balance: {requestBalanceSummaryLabel}</span>
          </div>
          <label className="trade-compose-field trade-compose-asset-field">
            <span className="trade-compose-field-head">
              <span className="trade-compose-field-label">Asset</span>
            </span>
            <TradeTokenSelect
              options={requestTokenOptions}
              value={requestTokenSelection}
              onChange={(value) => {
                markTouched('requestAsset');
                onRequestTokenSelectionChange(value);
              }}
              disabled={sending}
              invalid={showRequestAssetError}
              balanceLabel={requestBalanceSummaryLabel}
              verifyUrl={!showRequestCustomToken ? requestVerifyUrl : undefined}
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
                  onChange={(event) => {
                    markTouched('requestAsset');
                    onRequestCustomAddressChange(event.target.value);
                  }}
                  onBlur={() => markTouched('requestAsset')}
                  placeholder="Custom token contract address"
                  disabled={sending}
                  aria-invalid={showRequestAssetError ? 'true' : 'false'}
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
          {showRequestAssetError ? <p className="trade-compose-field-error">{requestAssetError}</p> : null}
          <label className={resolvePricingFieldClassName('trade-compose-field trade-compose-amount-field', 'quoteAmount')}>
            <span className="trade-compose-field-head">
              <span className="trade-compose-field-label">{requestAmountLabel}</span>
              <span className="trade-compose-field-tools">
                {renderPricingFieldState('quoteAmount')}
                <strong className="trade-compose-field-value">{requestAmountSummaryLabel}</strong>
              </span>
            </span>
            <input
              className="trade-compose-input"
              type="text"
              inputMode="decimal"
              value={requestAmountInput}
              onChange={(event) => {
                markTouched('requestAmount');
                onRequestAmountInputChange(event.target.value);
              }}
              onBlur={() => markTouched('requestAmount')}
              placeholder={requestAmountPlaceholder}
              disabled={sending}
              aria-invalid={showRequestAmountError ? 'true' : 'false'}
            />
          </label>
          {showRequestAmountError ? <p className="trade-compose-field-error">{requestAmountError}</p> : null}
          {previewInReceivePanel ? renderTradePreview('trade-compose-preview trade-compose-inline-preview') : null}
        </section>
      </div>

      {showHiddenLiquidityToggle ? (
        <div className={privateLiquidityPanelClassName}>
          <div className="trade-compose-privacy-copy">
            <span>Order privacy</span>
            <strong>{privateLiquidityStateLabel}</strong>
          </div>
          <p className="trade-compose-privacy-help">{privateLiquidityHelpText}</p>
          <div className="trade-compose-privacy-toggle" role="group" aria-label="Private liquidity">
            <button
              type="button"
              className={hidePrivateLiquidity ? 'active' : undefined}
              onClick={() => onHidePrivateLiquidityChange?.(true)}
              aria-pressed={hidePrivateLiquidity}
              disabled={sending || (!canHidePrivateLiquidity && !hidePrivateLiquidity)}
              title={canHidePrivateLiquidity ? 'Publish only the ratio; keep amounts and fills private' : hiddenLiquidityUnavailableMessage}
            >
              Private liquidity
            </button>
            <button
              type="button"
              className={!hidePrivateLiquidity ? 'active' : undefined}
              onClick={() => onHidePrivateLiquidityChange?.(false)}
              aria-pressed={!hidePrivateLiquidity}
              disabled={sending}
            >
              Visible amounts
            </button>
          </div>
        </div>
      ) : null}

      <div className="trade-compose-quote-dock">
        {showPriceInput && pricePlacement === 'bottom' ? (
          <div className="trade-compose-pricing-row">
            {priceField}
            <p>{priceHelpText}</p>
          </div>
        ) : null}

        <div className={showDockPreview ? 'trade-compose-bottom' : 'trade-compose-bottom trade-compose-bottom-compact'}>
          {showDockPreview ? renderTradePreview() : null}

          <div className="trade-compose-footer">
            <div className="trade-compose-fee-row trade-compose-fee-row-inline">
              <div className="trade-compose-fee-copy">
                <span className="trade-compose-field-label">Fee</span>
                <strong className="trade-compose-fee-value">{compactFeeSummaryLabel || feeSummaryLabel}</strong>
                <span className="trade-compose-fee-note">{FEE_VARIANCE_NOTE}</span>
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
              <label htmlFor="trade-compose-expiry-hours">Duration</label>
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
                  value={expiresNever ? '' : expiresHoursInput}
                  onChange={(event) => {
                    markTouched('expiry');
                    onExpiresHoursInputChange(event.target.value);
                  }}
                  onBlur={() => markTouched('expiry')}
                  placeholder={expiresNever ? 'Open' : 'Hours'}
                  disabled={sending || expiresNever}
                  aria-invalid={showExpiryError ? 'true' : 'false'}
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
                    onClick={() => {
                      markTouched('expiry');
                      onExpiresNeverChange(!expiresNever);
                    }}
                    disabled={sending}
                    aria-pressed={expiresNever}
                  >
                    Permanent
                  </button>
                ) : null}
              </div>
            </div>
            <div className="trade-compose-action-stack">
              {actionNotice ? (
                <div className="trade-compose-action-notice-slot">{actionNotice}</div>
              ) : (
                <p className={sendReadinessClassName} role="status">
                  {sendWhenReady && !canSend && !sending ? 'Will create when ready' : sendReadinessLabel}
                </p>
              )}
              <button
                type="button"
                className={sendButtonClassName}
                onClick={handleSendClick}
                disabled={sendButtonDisabled}
                aria-disabled={!canSend}
                title={validationMessage || sendTitle}
              >
                {sending ? sendingLabel : sendLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="trade-compose-warning" role="alert">
        <p>
          <strong>P2P OTC check:</strong> Verify token contracts, amounts, and price before confirming. Escrow enforces
          settlement, not counterparty reputation.
        </p>
      </div>
      {showExpiryError ? <p className="trade-compose-field-error">{expiryError}</p> : null}

      {generalError ? <p className="trade-compose-validation">{generalError}</p> : null}
    </div>
  );
}
