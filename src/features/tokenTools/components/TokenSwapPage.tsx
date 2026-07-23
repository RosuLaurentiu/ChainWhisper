import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  ArchiveRestore,
  ArrowDownUp,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Info,
  LockKeyhole,
  Search,
  ShieldCheck
} from 'lucide-react';
import {
  COTI_NETWORK,
  formatCotiAmount,
  formatTokenAmount,
  type SwapDirection
} from '../../../lib/appShared';
import { COTI_PRIVACY_PORTAL_URL } from '../../../lib/ecosystemLinks';
import {
  buildPrivacyPortalQuoteKey,
  parsePrivacyAmountInput,
  type PrivacyDirection,
  type PrivacyPortalConversionStage,
  type PrivacyPortalPairMetrics,
  type PrivacyPortalQuote,
  type PrivacyTokenPair
} from '../../../lib/privacyPortal';
import type { AppHelpReason } from '../../../lib/appHelpLaunch';
import type { ChainWhisperWispStage } from '../../../lib/wispPrivacyBridge';

export type WispRecoveryView = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amountInput: string;
  onAmountInputChange: (value: string) => void;
  onMaxAmount: () => void;
  maxDisabled?: boolean;
  inputBalanceLabel: string;
  outputBalanceLabel: string;
  direction: SwapDirection;
  onDirectionChange: (direction: SwapDirection) => void;
  canShield: boolean;
  canUnshield: boolean;
  canLegacyUnshield: boolean;
  publicSymbol: string;
  privateSymbol: string;
  legacyPrivateSymbol?: string;
  inputSymbol: string;
  feeLabel: string;
  contractUrl: string;
  legacyContractUrl?: string;
  busy: boolean;
  actionStage: ChainWhisperWispStage | null;
  canSubmit: boolean;
  buttonLabel: string;
  onSubmit: () => Promise<void>;
  statusMessage: string;
  error: string;
  transactionUrl?: string;
};

export type TokenSwapPageProps = {
  pairs: readonly PrivacyTokenPair[];
  selectedPair: PrivacyTokenPair;
  onPairChange: (pairId: string) => void;
  tokenSearch: string;
  onTokenSearchChange: (value: string) => void;
  privacyDirection: PrivacyDirection;
  onPrivacyDirectionChange: (direction: PrivacyDirection) => void;
  activePortalAccount: 'chainwhisper' | 'owner';
  showPortalAccountTabs: boolean;
  onPortalAccountChange: (value: 'chainwhisper' | 'owner') => void;
  amountInput: string;
  onAmountInputChange: (value: string) => void;
  onMaxAmount: () => void;
  metrics: PrivacyPortalPairMetrics | null;
  quote: PrivacyPortalQuote | null;
  loading: boolean;
  actionStage: PrivacyPortalConversionStage | null;
  walletAddress: string;
  onCotiNetwork: boolean;
  hasAesReady: boolean;
  canConvert: boolean;
  buttonLabel: string;
  onConvert: () => Promise<void>;
  onRefresh: () => void;
  statusMessage: string;
  error: string;
  transactionUrl?: string;
  recovery?: WispRecoveryView;
  onOpenHelp?: (reason: AppHelpReason) => void;
};

const TOKEN_ICON_LABELS: Record<string, string> = {
  coti: 'C',
  weth: 'E',
  wbtc: 'B',
  usdt: 'T',
  'usdc-e': 'U',
  wada: 'A',
  gcoti: 'G'
};

const TOKEN_ICON_PATHS: Record<string, string> = {
  coti: '/token-icons/coti.svg',
  weth: '/token-icons/weth.svg',
  wbtc: '/token-icons/wbtc.svg',
  usdt: '/token-icons/usdt.svg',
  'usdc-e': '/token-icons/usdc.svg',
  wada: '/token-icons/wada.svg',
  gcoti: '/token-icons/gcoti.svg'
};

const ACTION_STAGE_LABELS: Record<PrivacyPortalConversionStage, string> = {
  validating: 'Validating bridge',
  'public-approval-reset': 'Resetting token approval',
  'public-approval': 'Approving public token',
  'private-approval': 'Approving private token',
  'refreshing-quote': 'Refreshing quote',
  'awaiting-conversion': 'Confirm conversion',
  confirming: 'Confirming on COTI',
  complete: 'Conversion complete'
};

const WISP_ACTION_STAGE_LABELS: Record<ChainWhisperWispStage, string> = {
  validating: 'Validating ChainWhisper bridge',
  'public-approval-reset': 'Resetting WISP approval',
  'public-approval': 'Approving WISP',
  'private-approval': 'Approving pWISP',
  'refreshing-quote': 'Refreshing WISP quote',
  'awaiting-conversion': 'Confirm WISP conversion',
  confirming: 'Confirming on COTI',
  complete: 'WISP conversion complete'
};

const TokenIcon = ({ pair, privateToken = false }: { pair: PrivacyTokenPair; privateToken?: boolean }) => (
  <span className={`privacy-token-icon privacy-token-icon-${pair.id}${privateToken ? ' is-private' : ''}`} aria-hidden="true">
    <span className="privacy-token-icon-fallback">
      {TOKEN_ICON_LABELS[pair.id] ?? pair.publicToken.symbol.slice(0, 1)}
    </span>
    <img
      src={TOKEN_ICON_PATHS[pair.id]}
      alt=""
      onError={(event) => event.currentTarget.remove()}
    />
    {privateToken ? (
      <span className="privacy-token-lock-badge"><LockKeyhole size={10} strokeWidth={2.7} /></span>
    ) : null}
  </span>
);

const WispIcon = ({ privateToken = false }: { privateToken?: boolean }) => (
  <span className={`privacy-token-icon privacy-token-icon-wisp${privateToken ? ' is-private' : ''}`} aria-hidden="true">
    <span className="privacy-token-icon-fallback">W</span>
    <img
      src="/token-icons/wisp.png"
      alt=""
      onError={(event) => event.currentTarget.remove()}
    />
    {privateToken ? (
      <span className="privacy-token-lock-badge"><LockKeyhole size={10} strokeWidth={2.7} /></span>
    ) : null}
  </span>
);

const MobileTokenMenu = ({
  id,
  pairs,
  selectedPairId,
  onSelect,
  onSelectWisp,
  wispSelected,
  placement,
  menuRef,
  disabled = false
}: {
  id: string;
  pairs: readonly PrivacyTokenPair[];
  selectedPairId: string;
  onSelect: (pairId: string) => void;
  onSelectWisp?: () => void;
  wispSelected: boolean;
  placement: 'summary' | 'inline';
  menuRef?: RefObject<HTMLDivElement>;
  disabled?: boolean;
}) => (
  <div
    id={id}
    ref={menuRef}
    className={`privacy-mobile-token-menu is-${placement}`}
    role="menu"
    aria-label="Select a privacy token"
  >
    {onSelectWisp ? (
      <button
        type="button"
        className={`privacy-mobile-wisp-option${wispSelected ? ' active' : ''}`}
        onClick={onSelectWisp}
        disabled={disabled}
      >
        <WispIcon />
        <span>
          <strong>WISP</strong>
          <small>pWISP</small>
        </span>
      </button>
    ) : null}
    {pairs.map((pair) => (
      <button
        type="button"
        key={pair.id}
        className={!wispSelected && pair.id === selectedPairId ? 'active' : ''}
        onClick={() => onSelect(pair.id)}
        disabled={disabled}
      >
        <TokenIcon pair={pair} />
        <span>
          <strong>{pair.publicToken.symbol}</strong>
          <small>{pair.privateToken.symbol}</small>
        </span>
      </button>
    ))}
  </div>
);

const InfoTip = ({ label }: { label: string }) => (
  <span className="swap-info-tip" title={label} aria-label={label}>
    <Info size={12} aria-hidden="true" />
  </span>
);

const formatBalance = (value: bigint | null | undefined, pair: PrivacyTokenPair, locked = false) => {
  if (locked) {
    return 'Locked';
  }
  if (value === null || value === undefined) {
    return '—';
  }
  return formatTokenAmount(value, pair.publicToken.decimals, 6);
};

const formatGas = (quote: PrivacyPortalQuote | null) => {
  if (quote?.gasEstimate === null || quote?.gasEstimate === undefined) {
    return '—';
  }
  return `${quote.gasEstimate.toLocaleString()} gas`;
};

const getBridgeState = (
  metrics: PrivacyPortalPairMetrics | null,
  direction: PrivacyDirection,
  loading: boolean
) => {
  if (loading && !metrics) {
    return { label: 'Checking', tone: 'loading' } as const;
  }
  if (!metrics || metrics.verification.status === 'unavailable') {
    return { label: 'Unavailable', tone: 'error' } as const;
  }
  if (metrics.verification.status !== 'ready') {
    return { label: 'Contract mismatch', tone: 'error' } as const;
  }
  if (metrics.paused || (direction === 'public-to-private' && !metrics.depositEnabled)) {
    return { label: 'Paused', tone: 'error' } as const;
  }
  if (metrics.blacklisted) {
    return { label: 'Account restricted', tone: 'error' } as const;
  }
  return { label: 'Live', tone: 'live' } as const;
};

function WispConversionCard({
  recovery,
  walletAddress,
  onCotiNetwork,
  hasAesReady,
  activePortalAccount,
  onCurrentDirectionChange,
  legacyExpanded,
  onLegacyExpandedChange,
  legacyDisabled,
  onOpenHelp
}: {
  recovery: WispRecoveryView;
  walletAddress: string;
  onCotiNetwork: boolean;
  hasAesReady: boolean;
  activePortalAccount: 'chainwhisper' | 'owner';
  onCurrentDirectionChange: (direction: 'shield' | 'unshield') => void;
  legacyExpanded: boolean;
  onLegacyExpandedChange: (open: boolean) => void;
  legacyDisabled: boolean;
  onOpenHelp?: (reason: AppHelpReason) => void;
}) {
  const isLegacyActive = recovery.direction === 'legacy-unshield';
  const isToPrivate = recovery.direction === 'shield';
  const inputSymbol = isToPrivate ? recovery.publicSymbol : recovery.privateSymbol;
  const outputSymbol = isToPrivate ? recovery.privateSymbol : recovery.publicSymbol;
  const currentDirectionEnabled = isToPrivate ? recovery.canShield : recovery.canUnshield;
  const bridgeState = currentDirectionEnabled ? 'live' : 'error';
  const bridgeLabel = currentDirectionEnabled ? 'Live' : 'Paused';
  const privacyTitle = !walletAddress
    ? 'Wallet not connected'
    : !onCotiNetwork
      ? 'Wrong network'
      : !hasAesReady
        ? 'Privacy locked'
        : 'Privacy unlocked';
  const privacyDescription = !walletAddress
    ? 'Connect from the header to use the ChainWhisper bridge.'
    : !onCotiNetwork
      ? 'Switch to COTI Mainnet to convert WISP.'
      : !hasAesReady
        ? 'Unlock privacy to view and use pWISP.'
        : `Private balances are available for the ${activePortalAccount === 'owner' ? 'owner wallet' : 'ChainWhisper account'}.`;
  const readinessHelpReason: AppHelpReason | null = !walletAddress
    ? 'wallet-needed'
    : !onCotiNetwork
      ? 'wrong-network'
      : !hasAesReady
        ? 'privacy-locked'
        : null;

  return (
    <div className={`swap-card privacy-wisp-card${isLegacyActive ? ' is-legacy-active' : ''}`}>
      <div className="privacy-wisp-brand-row">
        <span>
          <WispIcon />
          <span>
            <strong>WISP / pWISP</strong>
            <small>ChainWhisper bridge</small>
          </span>
        </span>
        <span className="privacy-wisp-source-badge">ChainWhisper</span>
      </div>

      <div className="swap-field swap-field-route">
        <span id="wisp-direction-label" className="swap-label-sr">WISP conversion direction</span>
        <div className="swap-pill-switch privacy-direction-switch" role="group" aria-labelledby="wisp-direction-label">
          <button
            type="button"
            className={isToPrivate && !isLegacyActive ? 'swap-pill-option active' : 'swap-pill-option'}
            onClick={() => onCurrentDirectionChange('shield')}
            disabled={!recovery.canShield || recovery.busy}
            aria-pressed={isToPrivate && !isLegacyActive}
          >
            <LockKeyhole size={15} aria-hidden="true" /> To private
          </button>
          <button
            type="button"
            className={!isToPrivate && !isLegacyActive ? 'swap-pill-option active' : 'swap-pill-option'}
            onClick={() => onCurrentDirectionChange('unshield')}
            disabled={!recovery.canUnshield || recovery.busy}
            aria-pressed={!isToPrivate && !isLegacyActive}
          >
            <LockKeyhole size={15} aria-hidden="true" /> To public
          </button>
        </div>
      </div>

      <div className="swap-flow">
        <div className="swap-asset-panel">
          <div className="swap-panel-head">
            <span>You pay</span>
            <span>
              <span className="privacy-wisp-active-balance">Balance: {recovery.inputBalanceLabel}</span>
              <button
                type="button"
                onClick={recovery.onMaxAmount}
                disabled={recovery.maxDisabled || recovery.busy || isLegacyActive}
              >
                Max
              </button>
            </span>
          </div>
          <div className="swap-panel-main">
            <label className="swap-label-sr" htmlFor="wisp-current-amount">Amount</label>
            <input
              id="wisp-current-amount"
              type="text"
              inputMode="decimal"
              value={recovery.amountInput}
              onChange={(event) => recovery.onAmountInputChange(event.target.value)}
              placeholder="0.0"
              disabled={recovery.busy || isLegacyActive}
            />
            <span className="swap-token-chip swap-token-chip-output">
              <WispIcon privateToken={!isToPrivate} />
              <span>{inputSymbol}</span>
            </span>
          </div>
        </div>

        <button
          type="button"
          className="swap-route-chip"
          onClick={() => onCurrentDirectionChange(isToPrivate ? 'unshield' : 'shield')}
          disabled={recovery.busy || isLegacyActive || (isToPrivate ? !recovery.canUnshield : !recovery.canShield)}
          aria-label="Reverse WISP conversion direction"
        >
          <ArrowDownUp size={20} aria-hidden="true" />
        </button>

        <div className="swap-asset-panel swap-asset-panel-output">
          <div className="swap-panel-head">
            <span>You receive</span>
            <span>Balance: {recovery.outputBalanceLabel}</span>
          </div>
          <div className="swap-panel-main swap-panel-main-readonly">
            <strong>{recovery.amountInput.trim() || '0.0'}</strong>
            <span className="swap-token-chip swap-token-chip-output">
              <WispIcon privateToken={isToPrivate} />
              <span>{outputSymbol}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="privacy-quote-table">
        <div>
          <span>Portal fee <InfoTip label="Live fee read from the ChainWhisper WISP bridge." /></span>
          <strong>{recovery.feeLabel}</strong>
        </div>
        <div>
          <span>Conversion</span>
          <strong>1:1 before portal fee</strong>
        </div>
        <div>
          <span>Bridge</span>
          {recovery.contractUrl ? (
            <a href={recovery.contractUrl} target="_blank" rel="noreferrer">
              <i className={`privacy-status-dot is-${bridgeState}`} aria-hidden="true" />
              ChainWhisper contract <ExternalLink size={12} aria-hidden="true" />
            </a>
          ) : (
            <strong>ChainWhisper contract</strong>
          )}
        </div>
      </div>

      <div className="privacy-readiness" role="status" aria-live="polite">
        <div className="privacy-readiness-bridge">
          <span>
            <i className={`privacy-status-dot is-${bridgeState}`} aria-hidden="true" />
            <strong>ChainWhisper bridge · <em>{bridgeLabel}</em></strong>
          </span>
          <p>This pair is provided by ChainWhisper, not an official COTI bridge.</p>
        </div>
        <div className="privacy-readiness-private">
          <ShieldCheck size={21} aria-hidden="true" />
          <span>
            <strong>{privacyTitle}</strong>
            <p>{privacyDescription}</p>
          </span>
          {!hasAesReady ? <InfoTip label="Private balances are decrypted locally for the selected account." /> : null}
          {readinessHelpReason && onOpenHelp ? (
            <button
              type="button"
              className="app-help-context-link"
              onClick={() => onOpenHelp(readinessHelpReason)}
            >
              Get help
            </button>
          ) : null}
        </div>
      </div>

      {!isLegacyActive ? (
        <button
          className="connect-btn swap-action-btn"
          type="button"
          onClick={() => recovery.onSubmit().catch(() => {})}
          disabled={!recovery.canSubmit}
        >
          {recovery.buttonLabel}
        </button>
      ) : null}

      {recovery.busy && !isLegacyActive ? (
        <div className="privacy-action-progress" role="status" aria-live="polite">
          <i aria-hidden="true" />
          <span>
            <strong>
              {recovery.actionStage
                ? WISP_ACTION_STAGE_LABELS[recovery.actionStage]
                : 'Preparing ChainWhisper conversion'}
            </strong>
          </span>
        </div>
      ) : null}
      {!isLegacyActive && recovery.statusMessage ? <p className="swap-status-note">{recovery.statusMessage}</p> : null}
      {!isLegacyActive && recovery.transactionUrl ? (
        <a className="privacy-transaction-link" href={recovery.transactionUrl} target="_blank" rel="noreferrer">
          View transaction on COTI Explorer <ExternalLink size={13} aria-hidden="true" />
        </a>
      ) : null}
      {!isLegacyActive && recovery.error ? (
        <div className="swap-error-row">
          <p className="error swap-error">{recovery.error}</p>
          {onOpenHelp ? (
            <button type="button" className="app-help-context-link" onClick={() => onOpenHelp('generic-error')}>
              Get help
            </button>
          ) : null}
        </div>
      ) : null}

      <LegacyWispRecovery
        recovery={recovery}
        expanded={legacyExpanded}
        onExpandedChange={onLegacyExpandedChange}
        disabled={legacyDisabled}
      />
    </div>
  );
}

function LegacyWispRecovery({
  recovery,
  expanded,
  onExpandedChange,
  disabled = false
}: {
  recovery: WispRecoveryView;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  disabled?: boolean;
}) {
  const legacyPrivateSymbol = (recovery.legacyPrivateSymbol || recovery.inputSymbol)
    .replace(/^p\.WISP$/i, 'pWISP')
    .replace(/\s+\(old\)$/i, '');

  return (
    <details
      className="privacy-legacy-recovery"
      open={expanded}
      onToggle={(event) => onExpandedChange(event.currentTarget.open)}
    >
      <summary
        aria-disabled={recovery.busy || disabled}
        onClick={(event) => {
          if (recovery.busy || disabled) {
            event.preventDefault();
          }
        }}
      >
        <span className="privacy-legacy-summary-icon" aria-hidden="true">
          <ArchiveRestore size={17} />
        </span>
        <span className="privacy-legacy-summary-copy">
          <strong>Legacy pWISP</strong>
          <small>Recover previous-bridge balances to WISP</small>
        </span>
        <span className="privacy-legacy-summary-tag">Previous bridge</span>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="privacy-recovery-body">
        <p>
          Only use this for pWISP created by the previous ChainWhisper bridge. This recovery path can only
          return legacy pWISP to public WISP.
        </p>
        <div className="privacy-recovery-input">
          <label htmlFor="wisp-legacy-amount">Amount to recover</label>
          <div>
            <input
              id="wisp-legacy-amount"
              type="text"
              inputMode="decimal"
              value={recovery.amountInput}
              onChange={(event) => recovery.onAmountInputChange(event.target.value)}
              placeholder="0.0"
              disabled={recovery.busy || disabled}
            />
            <strong>{legacyPrivateSymbol} (legacy)</strong>
          </div>
          <small>Legacy balance: {recovery.inputBalanceLabel}</small>
        </div>
        <div className="privacy-recovery-meta">
          <span>Network fee</span>
          <strong>{recovery.feeLabel}</strong>
          {recovery.legacyContractUrl ? (
            <a href={recovery.legacyContractUrl} target="_blank" rel="noreferrer">
              View legacy contract <ExternalLink size={12} aria-hidden="true" />
            </a>
          ) : null}
        </div>
        <button
          className="connect-btn privacy-recovery-action"
          type="button"
          onClick={() => recovery.onSubmit().catch(() => {})}
          disabled={disabled || !recovery.canLegacyUnshield || !recovery.canSubmit}
        >
          {recovery.buttonLabel}
        </button>
        {recovery.busy ? (
          <div className="privacy-action-progress" role="status" aria-live="polite">
            <i aria-hidden="true" />
            <span><strong>Confirming legacy recovery</strong></span>
          </div>
        ) : null}
        {recovery.statusMessage ? <p className="swap-status-note">{recovery.statusMessage}</p> : null}
        {recovery.error ? <p className="error swap-error">{recovery.error}</p> : null}
      </div>
    </details>
  );
}

export default function TokenSwapPage({
  pairs,
  selectedPair,
  onPairChange,
  tokenSearch,
  onTokenSearchChange,
  privacyDirection,
  onPrivacyDirectionChange,
  activePortalAccount,
  showPortalAccountTabs,
  onPortalAccountChange,
  amountInput,
  onAmountInputChange,
  onMaxAmount,
  metrics,
  quote,
  loading,
  actionStage,
  walletAddress,
  onCotiNetwork,
  hasAesReady,
  canConvert,
  buttonLabel,
  onConvert,
  onRefresh,
  statusMessage,
  error,
  transactionUrl,
  recovery,
  onOpenHelp
}: TokenSwapPageProps) {
  const [mobileTokenMenuAnchor, setMobileTokenMenuAnchor] = useState<'summary' | 'chip' | null>(null);
  const [legacyExpanded, setLegacyExpanded] = useState(false);
  const mobileTokenMenuRef = useRef<HTMLDivElement>(null);
  const mobileSummaryTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileChipTriggerRef = useRef<HTMLButtonElement>(null);
  const actionLocked = Boolean(actionStage && actionStage !== 'complete');
  const wispSelected = Boolean(recovery?.open);
  const selectionLocked = actionLocked || Boolean(recovery?.busy);
  const normalizedSearch = tokenSearch.trim().toLowerCase();
  const visiblePairs = normalizedSearch
    ? pairs.filter((pair) =>
        `${pair.publicToken.symbol} ${pair.publicToken.name} ${pair.privateToken.symbol}`
          .toLowerCase()
          .includes(normalizedSearch)
      )
    : pairs;
  const wispMatchesSearch = Boolean(recovery) && (
    !normalizedSearch || 'wisp pwisp chainwhisper private'.includes(normalizedSearch)
  );
  const isToPrivate = privacyDirection === 'public-to-private';
  const activeMetrics =
    metrics &&
    metrics.pairId === selectedPair.id &&
    (!walletAddress || metrics.account?.toLowerCase() === walletAddress.toLowerCase())
      ? metrics
      : null;
  const parsedAmountWei = parsePrivacyAmountInput(amountInput, selectedPair.publicToken.decimals);
  const expectedQuoteKey =
    parsedAmountWei === null
      ? ''
      : buildPrivacyPortalQuoteKey({
          chainId: selectedPair.chainId,
          account: walletAddress,
          pairId: selectedPair.id,
          direction: privacyDirection,
          amountWei: parsedAmountWei
        });
  const activeQuote = quote?.quoteKey === expectedQuoteKey ? quote : null;
  const inputToken = isToPrivate ? selectedPair.publicToken : selectedPair.privateToken;
  const outputToken = isToPrivate ? selectedPair.privateToken : selectedPair.publicToken;
  const inputBalanceWei = isToPrivate ? activeMetrics?.publicBalanceWei : activeMetrics?.privateBalanceWei;
  const outputBalanceWei = isToPrivate ? activeMetrics?.privateBalanceWei : activeMetrics?.publicBalanceWei;
  const inputBalanceLocked = !isToPrivate && !hasAesReady;
  const outputBalanceLocked = isToPrivate && !hasAesReady;
  const inputBalanceLabel = formatBalance(inputBalanceWei, selectedPair, inputBalanceLocked);
  const outputBalanceLabel = formatBalance(outputBalanceWei, selectedPair, outputBalanceLocked);
  const receiveLabel = activeQuote
    ? formatTokenAmount(activeQuote.receiveAmountWei, selectedPair.publicToken.decimals, 8)
    : amountInput.trim() && selectedPair.bridgeKind === 'erc20'
      ? amountInput
      : '0.0';
  const minimumWei = isToPrivate ? activeMetrics?.limits.minDepositWei : activeMetrics?.limits.minWithdrawWei;
  const minimumLabel =
    minimumWei === undefined
      ? 'Live bridge limit'
      : `${formatTokenAmount(minimumWei, selectedPair.publicToken.decimals, 8)} ${inputToken.symbol}`;
  const feeLabel = activeQuote ? `${formatCotiAmount(activeQuote.feeWei)} COTI` : '—';
  const bridgeState = getBridgeState(activeMetrics, privacyDirection, loading);
  const bridgeUrl = `${COTI_NETWORK.blockExplorerUrl}/address/${selectedPair.bridgeAddress}#code`;
  const privacyTitle = !walletAddress
    ? 'Wallet not connected'
    : !onCotiNetwork
      ? 'Wrong network'
      : !hasAesReady
        ? 'Privacy locked'
        : 'Privacy unlocked';
  const privacyDescription = !walletAddress
    ? 'Connect from the header to view balances and convert tokens.'
    : !onCotiNetwork
      ? 'Switch to COTI Mainnet to use the selected bridge.'
      : !hasAesReady
        ? 'Unlock privacy to view private balances.'
        : `Private balances are available for the ${activePortalAccount === 'owner' ? 'owner wallet' : 'ChainWhisper account'}.`;
  const readinessHelpReason: AppHelpReason | null = !walletAddress
    ? 'wallet-needed'
    : !onCotiNetwork
      ? 'wrong-network'
      : !hasAesReady
        ? 'privacy-locked'
        : null;

  const restoreMobileTokenMenuFocus = (anchor: 'summary' | 'chip' | null) => {
    if (!anchor) {
      return;
    }
    window.requestAnimationFrame(() => {
      (anchor === 'summary' ? mobileSummaryTriggerRef.current : mobileChipTriggerRef.current)?.focus();
    });
  };

  const closeMobileTokenMenu = () => {
    const activeAnchor = mobileTokenMenuAnchor;
    setMobileTokenMenuAnchor(null);
    restoreMobileTokenMenuFocus(activeAnchor);
  };

  useEffect(() => {
    if (!mobileTokenMenuAnchor) {
      return;
    }
    mobileTokenMenuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      const activeAnchor = mobileTokenMenuAnchor;
      setMobileTokenMenuAnchor(null);
      window.requestAnimationFrame(() => {
        (activeAnchor === 'summary' ? mobileSummaryTriggerRef.current : mobileChipTriggerRef.current)?.focus();
      });
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mobileTokenMenuAnchor]);

  const selectPair = (pairId: string) => {
    if (selectionLocked) {
      return;
    }
    setLegacyExpanded(false);
    recovery?.onOpenChange(false);
    onPairChange(pairId);
    closeMobileTokenMenu();
  };

  const selectWisp = () => {
    if (selectionLocked || !recovery) {
      return;
    }
    if (recovery.direction === 'legacy-unshield') {
      recovery.onDirectionChange('unshield');
    }
    setLegacyExpanded(false);
    recovery.onOpenChange(true);
    closeMobileTokenMenu();
  };

  const selectCurrentWispDirection = (direction: 'shield' | 'unshield') => {
    if (!recovery || recovery.busy || actionLocked) {
      return;
    }
    setLegacyExpanded(false);
    recovery.onDirectionChange(direction);
  };

  const toggleLegacyRecovery = (open: boolean) => {
    if (!recovery || recovery.busy || actionLocked) {
      return;
    }
    setLegacyExpanded(open);
    recovery.onDirectionChange(open ? 'legacy-unshield' : 'unshield');
  };

  return (
    <main className="swap-page-shell">
      <section className="swap-page-panel">
        <div className="swap-page-hero">
          <div className="swap-page-heading">
            <h1 className="swap-page-title">Privacy Portal</h1>
            <p>
              Make supported COTI tokens private. Portal back anytime.{' '}
              <a
                className="swap-privacy-portal-link"
                href={COTI_PRIVACY_PORTAL_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Official COTI contracts <ExternalLink size={13} aria-hidden="true" />
              </a>
            </p>
          </div>
          {showPortalAccountTabs ? (
            <div className="swap-pill-switch swap-account-switch" role="group" aria-label="Privacy Portal account">
              <button
                type="button"
                className={activePortalAccount === 'chainwhisper' ? 'swap-pill-option active' : 'swap-pill-option'}
                onClick={() => onPortalAccountChange('chainwhisper')}
                disabled={selectionLocked}
                aria-pressed={activePortalAccount === 'chainwhisper'}
              >
                ChainWhisper
              </button>
              <button
                type="button"
                className={activePortalAccount === 'owner' ? 'swap-pill-option active' : 'swap-pill-option'}
                onClick={() => onPortalAccountChange('owner')}
                disabled={selectionLocked}
                aria-pressed={activePortalAccount === 'owner'}
              >
                Owner
              </button>
            </div>
          ) : null}
        </div>

        <div className="privacy-mobile-token-picker">
          <button
            ref={mobileSummaryTriggerRef}
            type="button"
            onClick={() => {
              if (mobileTokenMenuAnchor === 'summary') {
                closeMobileTokenMenu();
              } else {
                setMobileTokenMenuAnchor('summary');
              }
            }}
            disabled={selectionLocked}
            aria-expanded={mobileTokenMenuAnchor === 'summary'}
            aria-controls="privacy-mobile-token-menu-summary"
            aria-haspopup="menu"
          >
            <span>
              {wispSelected ? <WispIcon /> : <TokenIcon pair={selectedPair} />}
              <strong>{wispSelected ? 'WISP / pWISP' : `${pairs.length + (recovery ? 1 : 0)} supported tokens`}</strong>
            </span>
            <ChevronRight size={20} aria-hidden="true" />
          </button>
          {mobileTokenMenuAnchor === 'summary' ? (
            <MobileTokenMenu
              id="privacy-mobile-token-menu-summary"
              pairs={pairs}
              selectedPairId={selectedPair.id}
              onSelect={selectPair}
              onSelectWisp={recovery ? selectWisp : undefined}
              wispSelected={wispSelected}
              placement="summary"
              menuRef={mobileTokenMenuRef}
              disabled={selectionLocked}
            />
          ) : null}
        </div>

        <div className="privacy-portal-workspace">
          <aside className="privacy-token-rail" aria-label="Supported privacy tokens">
            <div className="privacy-token-rail-title">
              <span className="privacy-token-rail-mark" aria-hidden="true"><ShieldCheck size={15} /></span>
              <strong>Supported tokens</strong>
            </div>
            <label className="privacy-token-search">
              <span className="swap-label-sr">Search supported tokens</span>
              <input
                type="search"
                value={tokenSearch}
                onChange={(event) => onTokenSearchChange(event.target.value)}
                placeholder="Search token"
                disabled={selectionLocked}
              />
              <Search size={16} aria-hidden="true" />
            </label>
            <div className="privacy-token-list">
              {wispMatchesSearch ? (
                <button
                  type="button"
                  className={`privacy-token-wisp-option${wispSelected ? ' active' : ''}`}
                  onClick={selectWisp}
                  disabled={selectionLocked}
                  aria-pressed={wispSelected}
                >
                  <WispIcon />
                  <span>
                    <strong>WISP</strong>
                    <small>pWISP</small>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              ) : null}
              {visiblePairs.map((pair) => (
                <button
                  type="button"
                  key={pair.id}
                  className={!wispSelected && pair.id === selectedPair.id ? 'active' : ''}
                  onClick={() => selectPair(pair.id)}
                  disabled={selectionLocked}
                  aria-pressed={!wispSelected && pair.id === selectedPair.id}
                >
                  <TokenIcon pair={pair} />
                  <span>
                    <strong>{pair.publicToken.symbol}</strong>
                    <small>{pair.privateToken.symbol}</small>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              ))}
              {visiblePairs.length === 0 && !wispMatchesSearch ? <p>No supported tokens match.</p> : null}
            </div>
            <p className="privacy-token-rail-note">Eight supported public/private token pairs.</p>
            <a href={COTI_PRIVACY_PORTAL_URL} target="_blank" rel="noopener noreferrer">
              Learn more <ExternalLink size={12} aria-hidden="true" />
            </a>
          </aside>

          {wispSelected && recovery ? (
            <WispConversionCard
              recovery={recovery}
              walletAddress={walletAddress}
              onCotiNetwork={onCotiNetwork}
              hasAesReady={hasAesReady}
              activePortalAccount={activePortalAccount}
              onCurrentDirectionChange={selectCurrentWispDirection}
              legacyExpanded={legacyExpanded}
              onLegacyExpandedChange={toggleLegacyRecovery}
              legacyDisabled={actionLocked}
              onOpenHelp={onOpenHelp}
            />
          ) : (
          <div className="swap-card">
            <div className="swap-field swap-field-route">
              <span id="swap-page-direction-label" className="swap-label-sr">Conversion direction</span>
              <div className="swap-pill-switch privacy-direction-switch" role="group" aria-labelledby="swap-page-direction-label">
                <button
                  type="button"
                  className={isToPrivate ? 'swap-pill-option active' : 'swap-pill-option'}
                  onClick={() => onPrivacyDirectionChange('public-to-private')}
                  disabled={Boolean(actionStage && actionStage !== 'complete')}
                  aria-pressed={isToPrivate}
                >
                  <LockKeyhole size={15} aria-hidden="true" /> To private
                </button>
                <button
                  type="button"
                  className={!isToPrivate ? 'swap-pill-option active' : 'swap-pill-option'}
                  onClick={() => onPrivacyDirectionChange('private-to-public')}
                  disabled={Boolean(actionStage && actionStage !== 'complete')}
                  aria-pressed={!isToPrivate}
                >
                  <LockKeyhole size={15} aria-hidden="true" /> To public
                </button>
              </div>
            </div>

            {mobileTokenMenuAnchor === 'chip' ? (
              <MobileTokenMenu
                id="privacy-mobile-token-menu-chip"
                pairs={pairs}
                selectedPairId={selectedPair.id}
                onSelect={selectPair}
                onSelectWisp={recovery ? selectWisp : undefined}
              wispSelected={wispSelected}
              placement="inline"
              menuRef={mobileTokenMenuRef}
              disabled={selectionLocked}
              />
            ) : null}

            <div className="swap-flow">
              <div className="swap-asset-panel">
                <div className="swap-panel-head">
                  <span>You pay</span>
                  <span>
                    Balance: {inputBalanceLabel} {inputBalanceLocked ? '' : inputToken.symbol}
                    <button type="button" onClick={onMaxAmount} disabled={!walletAddress || inputBalanceLocked || loading}>
                      Max
                    </button>
                  </span>
                </div>
                <div className="swap-panel-main">
                  <label className="swap-label-sr" htmlFor="swap-page-amount-input">Amount</label>
                  <input
                    id="swap-page-amount-input"
                    type="text"
                    inputMode="decimal"
                    value={amountInput}
                    onChange={(event) => onAmountInputChange(event.target.value)}
                    placeholder="0.0"
                    disabled={Boolean(actionStage && actionStage !== 'complete')}
                  />
                  <button
                    ref={mobileChipTriggerRef}
                    className="swap-token-chip"
                    type="button"
                    disabled={selectionLocked}
                    onClick={() => {
                      if (typeof window !== 'undefined' && window.matchMedia('(max-width: 920px)').matches) {
                        if (mobileTokenMenuAnchor === 'chip') {
                          closeMobileTokenMenu();
                        } else {
                          setMobileTokenMenuAnchor('chip');
                        }
                      }
                    }}
                    aria-expanded={mobileTokenMenuAnchor === 'chip'}
                    aria-controls="privacy-mobile-token-menu-chip"
                    aria-haspopup="menu"
                    aria-label={`Select token. Current token ${selectedPair.publicToken.symbol}`}
                  >
                    <TokenIcon pair={selectedPair} privateToken={!isToPrivate} />
                    <span>{inputToken.symbol}</span>
                    <ChevronDown className="privacy-token-chip-chevron" size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <button
                type="button"
                className="swap-route-chip"
                onClick={() => onPrivacyDirectionChange(isToPrivate ? 'private-to-public' : 'public-to-private')}
                disabled={Boolean(actionStage && actionStage !== 'complete')}
                aria-label="Reverse privacy conversion direction"
              >
                <ArrowDownUp size={20} aria-hidden="true" />
              </button>

              <div className="swap-asset-panel swap-asset-panel-output">
                <div className="swap-panel-head">
                  <span>You receive</span>
                  <span>
                    {outputToken.kind === 'private-erc20' ? 'Private balance' : 'Balance'}: {outputBalanceLabel}
                    {outputBalanceLocked ? <InfoTip label="Unlock privacy to view this balance." /> : null}
                  </span>
                </div>
                <div className="swap-panel-main swap-panel-main-readonly">
                  <strong className={!activeQuote && selectedPair.bridgeKind === 'native' ? 'is-pending' : ''}>{receiveLabel}</strong>
                  <span className="swap-token-chip swap-token-chip-output">
                    <TokenIcon pair={selectedPair} privateToken={isToPrivate} />
                    <span>{outputToken.symbol}</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="privacy-quote-table">
              <div>
                <span>Portal fee <InfoTip label="Amount-specific fee quoted by the selected bridge." /></span>
                <strong>{feeLabel}</strong>
              </div>
              <div>
                <span>Estimated gas <InfoTip label="Estimated gas units before the transaction safety margin." /></span>
                <strong>{formatGas(activeQuote)}</strong>
              </div>
              <div>
                <span>Minimum <InfoTip label="Live directional minimum read from the selected bridge." /></span>
                <strong>{minimumLabel}</strong>
              </div>
              <div>
                <span>Conversion</span>
                <strong>1:1 before portal fee</strong>
              </div>
              <div>
                <span>Official bridge</span>
                <a href={bridgeUrl} target="_blank" rel="noreferrer">
                  <i className={`privacy-status-dot is-${bridgeState.tone}`} aria-hidden="true" />
                  Official COTI bridge <ExternalLink size={12} aria-hidden="true" />
                </a>
              </div>
            </div>

            <div className="privacy-readiness" role="status" aria-live="polite">
              <div className="privacy-readiness-bridge">
                <span>
                  <i className={`privacy-status-dot is-${bridgeState.tone}`} aria-hidden="true" />
                  <strong>Official bridge · <em>{bridgeState.label}</em></strong>
                </span>
                <p>Uses the selected official COTI bridge.</p>
              </div>
              <div className="privacy-readiness-private">
                <ShieldCheck size={21} aria-hidden="true" />
                <span>
                  <strong>{privacyTitle}</strong>
                  <p>{privacyDescription}</p>
                </span>
                {!hasAesReady ? <InfoTip label="Private balances are decrypted locally for the selected account." /> : null}
                {readinessHelpReason && onOpenHelp ? (
                  <button
                    type="button"
                    className="app-help-context-link"
                    onClick={() => onOpenHelp(readinessHelpReason)}
                  >
                    Get help
                  </button>
                ) : null}
              </div>
            </div>

            <button
              className="connect-btn swap-action-btn"
              type="button"
              onClick={() => onConvert().catch(() => {})}
              disabled={!canConvert}
            >
              {buttonLabel}
            </button>

            {actionStage ? (
              <div className={`privacy-action-progress${actionStage === 'complete' ? ' is-complete' : ''}`} role="status" aria-live="polite">
                <i aria-hidden="true" />
                <span>
                  <strong>{ACTION_STAGE_LABELS[actionStage]}</strong>
                  {transactionUrl ? (
                    <a href={transactionUrl} target="_blank" rel="noreferrer">
                      View transaction <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  ) : null}
                </span>
              </div>
            ) : null}
            {statusMessage ? <p className="swap-status-note">{statusMessage}</p> : null}
            {error ? (
              <div className="swap-error-row">
                <p className="error swap-error">{error}</p>
                <button type="button" onClick={onRefresh} disabled={loading}>Retry</button>
                {onOpenHelp ? (
                  <button
                    type="button"
                    className="app-help-context-link"
                    onClick={() => onOpenHelp('generic-error')}
                  >
                    Get help
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          )}
        </div>
      </section>
    </main>
  );
}
