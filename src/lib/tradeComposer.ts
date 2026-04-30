import {
  COTI_NETWORK,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE,
  REWARD_TOKEN_ADDRESS,
  TIP_NATIVE_TOKEN_DECIMALS,
  TIP_NATIVE_TOKEN_SYMBOL,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  formatCotiAmount,
  formatTokenAmount,
  isWalletAddress,
  parseTokenAmountInput,
  type TradeFeeModeSelection
} from './appShared';
import {
  buildTradeCustomTokenInfoKey,
  isCustomTradeTokenSelection,
  type ResolvedTradeToken,
  type TradeComposerFieldErrors,
  type TradeCustomTokenInfo,
  type TradeTokenPresetKey
} from './appHelpers';

type DeriveTradeComposerModelParams = {
  activeContact: string | null;
  walletAddress: string;
  isSelfChat: boolean;
  onCotiNetwork: boolean;
  creatingTrade: boolean;
  sending: boolean;
  tipping: boolean;
  tradeFeeModeSelection: TradeFeeModeSelection;
  tradeOfferTokenSelection: TradeTokenPresetKey;
  tradeRequestTokenSelection: TradeTokenPresetKey;
  tradeOfferCustomTokenAddress: string;
  tradeRequestCustomTokenAddress: string;
  tradeCustomOfferTokenKind: Extract<ResolvedTradeToken['kind'], 'erc20' | 'private-erc20'>;
  tradeCustomRequestTokenKind: Extract<ResolvedTradeToken['kind'], 'erc20' | 'private-erc20'>;
  customTradeTokenInfoByAddress: Record<string, TradeCustomTokenInfo>;
  tradeOfferAmountInput: string;
  tradeRequestAmountInput: string;
  tradeExpiryHoursInput: string;
  rewardTokenSymbol: string;
  rewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  privateRewardTokenDecimals: number;
  tipNativeBalanceWei: bigint | null;
  rewardTokenBalanceWei: bigint | null;
  privateRewardTokenBalanceWei: bigint | null;
  tradeRequiredFeeWei: bigint | null;
  tradeTokenFeeWei: bigint | null;
  counterpartyRequired?: boolean;
  missingCounterpartyMessage?: string;
  selfTradeMessage?: string;
};

export type TradeComposerModel = {
  tradeTokenOptions: Array<{ value: string; label: string }>;
  tradeCustomOfferTokenInfo?: TradeCustomTokenInfo;
  tradeCustomRequestTokenInfo?: TradeCustomTokenInfo;
  selectedTradeOfferToken: ResolvedTradeToken | null;
  selectedTradeRequestToken: ResolvedTradeToken | null;
  selectedTradeOfferBalanceWei: bigint | null;
  parsedTradeOfferAmountWei: bigint | null;
  parsedTradeRequestAmountWei: bigint | null;
  tradeOfferAmountSummaryLabel: string;
  tradeRequestAmountSummaryLabel: string;
  tradeOfferBalanceSummaryLabel: string;
  tradeOfferVerifyUrl?: string;
  tradeRequestVerifyUrl?: string;
  parsedTradeExpiryHours: number;
  tradeComposerFieldErrors: TradeComposerFieldErrors;
  tradeComposerValidationMessage: string;
  canSendTradeOffer: boolean;
  tradeOfferMaxAmountWei: bigint | null;
  tradeOfferMaxInputValue: string;
  canUseTradeOfferMax: boolean;
  tradePreviewLabel: string;
  tradeRateLabel: string;
  tradeFeeSummaryLabel: string;
  tradeOfferCustomMetaLabel: string;
  tradeRequestCustomMetaLabel: string;
};

const resolveSelectedTradeToken = ({
  selection,
  customTokenInfo,
  rewardTokenSymbol,
  rewardTokenDecimals,
  privateRewardTokenSymbol,
  privateRewardTokenDecimals
}: {
  selection: TradeTokenPresetKey;
  customTokenInfo?: TradeCustomTokenInfo;
  rewardTokenSymbol: string;
  rewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  privateRewardTokenDecimals: number;
}): ResolvedTradeToken | null => {
  if (selection === 'coti') {
    return {
      kind: 'native',
      symbol: TIP_NATIVE_TOKEN_SYMBOL,
      decimals: TIP_NATIVE_TOKEN_DECIMALS
    };
  }

  if (selection === 'wisp') {
    return {
      kind: 'erc20',
      tokenAddress: REWARD_TOKEN_ADDRESS,
      symbol: rewardTokenSymbol,
      decimals: rewardTokenDecimals
    };
  }

  if (selection === 'pwisp') {
    return {
      kind: 'private-erc20',
      tokenAddress: PRIVATE_REWARD_TOKEN_ADDRESS,
      symbol: privateRewardTokenSymbol,
      decimals: privateRewardTokenDecimals
    };
  }

  if (!customTokenInfo || customTokenInfo.error || customTokenInfo.loading) {
    return null;
  }

  return {
    kind: customTokenInfo.kind,
    tokenAddress: customTokenInfo.address,
    symbol: customTokenInfo.symbol,
    decimals: customTokenInfo.decimals,
    custom: true
  };
};

const buildTradeCustomMetaLabel = (address: string, tokenInfo?: TradeCustomTokenInfo): string => {
  if (!address) {
    return 'Paste a token contract address.';
  }
  if (!isWalletAddress(address)) {
    return 'Enter a valid token contract address.';
  }
  if (tokenInfo?.loading) {
    return 'Loading token metadata...';
  }
  if (tokenInfo?.error) {
    return tokenInfo.error;
  }
  if (tokenInfo) {
    return `${tokenInfo.symbol} \u2022 ${tokenInfo.decimals} decimals`;
  }
  return 'Loading token metadata...';
};

export const deriveTradeComposerModel = ({
  activeContact,
  walletAddress,
  isSelfChat,
  onCotiNetwork,
  creatingTrade,
  sending,
  tipping,
  tradeFeeModeSelection,
  tradeOfferTokenSelection,
  tradeRequestTokenSelection,
  tradeOfferCustomTokenAddress,
  tradeRequestCustomTokenAddress,
  tradeCustomOfferTokenKind,
  tradeCustomRequestTokenKind,
  customTradeTokenInfoByAddress,
  tradeOfferAmountInput,
  tradeRequestAmountInput,
  tradeExpiryHoursInput,
  rewardTokenSymbol,
  rewardTokenDecimals,
  privateRewardTokenSymbol,
  privateRewardTokenDecimals,
  tipNativeBalanceWei,
  rewardTokenBalanceWei,
  privateRewardTokenBalanceWei,
  tradeRequiredFeeWei,
  tradeTokenFeeWei,
  counterpartyRequired = true,
  missingCounterpartyMessage = 'Select a contact first.',
  selfTradeMessage = 'P2P trades are only available in private chats with another wallet.'
}: DeriveTradeComposerModelParams): TradeComposerModel => {
  const normalizedTradeOfferCustomTokenAddress = tradeOfferCustomTokenAddress.trim();
  const normalizedTradeRequestCustomTokenAddress = tradeRequestCustomTokenAddress.trim();
  const tradeTokenOptions = [
    { value: 'coti', label: `${TIP_NATIVE_TOKEN_SYMBOL} (native)` },
    { value: 'wisp', label: `${rewardTokenSymbol} (public)` },
    { value: 'pwisp', label: `${privateRewardTokenSymbol} (private)` },
    { value: 'custom-public', label: 'Custom public token / CA' },
    { value: 'custom-private', label: 'Custom private token / CA' }
  ];

  const tradeCustomOfferTokenKey =
    normalizedTradeOfferCustomTokenAddress && isWalletAddress(normalizedTradeOfferCustomTokenAddress)
      ? buildTradeCustomTokenInfoKey(tradeCustomOfferTokenKind, normalizedTradeOfferCustomTokenAddress)
      : '';
  const tradeCustomRequestTokenKey =
    normalizedTradeRequestCustomTokenAddress && isWalletAddress(normalizedTradeRequestCustomTokenAddress)
      ? buildTradeCustomTokenInfoKey(tradeCustomRequestTokenKind, normalizedTradeRequestCustomTokenAddress)
      : '';

  const tradeCustomOfferTokenInfo = tradeCustomOfferTokenKey
    ? customTradeTokenInfoByAddress[tradeCustomOfferTokenKey]
    : undefined;
  const tradeCustomRequestTokenInfo = tradeCustomRequestTokenKey
    ? customTradeTokenInfoByAddress[tradeCustomRequestTokenKey]
    : undefined;

  const selectedTradeOfferToken = resolveSelectedTradeToken({
    selection: tradeOfferTokenSelection,
    customTokenInfo: tradeCustomOfferTokenInfo,
    rewardTokenSymbol,
    rewardTokenDecimals,
    privateRewardTokenSymbol,
    privateRewardTokenDecimals
  });
  const selectedTradeRequestToken = resolveSelectedTradeToken({
    selection: tradeRequestTokenSelection,
    customTokenInfo: tradeCustomRequestTokenInfo,
    rewardTokenSymbol,
    rewardTokenDecimals,
    privateRewardTokenSymbol,
    privateRewardTokenDecimals
  });

  let selectedTradeOfferBalanceWei: bigint | null = null;
  if (selectedTradeOfferToken) {
    if (selectedTradeOfferToken.kind === 'native') {
      selectedTradeOfferBalanceWei = tipNativeBalanceWei;
    } else {
      const tokenKey = selectedTradeOfferToken.tokenAddress?.toLowerCase();
      if (tokenKey) {
        if (tokenKey === REWARD_TOKEN_ADDRESS.toLowerCase()) {
          selectedTradeOfferBalanceWei = rewardTokenBalanceWei;
        } else if (tokenKey === PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()) {
          selectedTradeOfferBalanceWei = privateRewardTokenBalanceWei;
        } else {
          selectedTradeOfferBalanceWei =
            customTradeTokenInfoByAddress[
              buildTradeCustomTokenInfoKey(
                selectedTradeOfferToken.kind === 'private-erc20' ? 'private-erc20' : 'erc20',
                tokenKey
              )
            ]?.balanceWei ?? null;
        }
      }
    }
  }

  const parsedTradeOfferAmountWei = selectedTradeOfferToken
    ? parseTokenAmountInput(tradeOfferAmountInput, selectedTradeOfferToken.decimals)
    : null;
  const parsedTradeRequestAmountWei = selectedTradeRequestToken
    ? parseTokenAmountInput(tradeRequestAmountInput, selectedTradeRequestToken.decimals)
    : null;

  const tradeOfferAmountSummaryLabel =
    parsedTradeOfferAmountWei !== null && parsedTradeOfferAmountWei > 0n && selectedTradeOfferToken
      ? `${formatTokenAmount(parsedTradeOfferAmountWei, selectedTradeOfferToken.decimals, 6)} ${selectedTradeOfferToken.symbol}`
      : `0 ${selectedTradeOfferToken?.symbol ?? 'TOKEN'}`;
  const tradeRequestAmountSummaryLabel =
    parsedTradeRequestAmountWei !== null && parsedTradeRequestAmountWei > 0n && selectedTradeRequestToken
      ? `${formatTokenAmount(parsedTradeRequestAmountWei, selectedTradeRequestToken.decimals, 6)} ${selectedTradeRequestToken.symbol}`
      : `0 ${selectedTradeRequestToken?.symbol ?? 'TOKEN'}`;
  const tradeOfferBalanceSummaryLabel =
    selectedTradeOfferToken && selectedTradeOfferBalanceWei !== null
      ? `${formatTokenAmount(selectedTradeOfferBalanceWei, selectedTradeOfferToken.decimals, 6)} ${selectedTradeOfferToken.symbol}`
      : '--';
  const tradeOfferVerifyUrl = selectedTradeOfferToken?.tokenAddress
    ? `${COTI_NETWORK.blockExplorerUrl}/token/${selectedTradeOfferToken.tokenAddress}`
    : undefined;
  const tradeRequestVerifyUrl = selectedTradeRequestToken?.tokenAddress
    ? `${COTI_NETWORK.blockExplorerUrl}/token/${selectedTradeRequestToken.tokenAddress}`
    : undefined;

  const normalizedExpiryInput = tradeExpiryHoursInput.trim();
  const parsedTradeExpiryHours = /^\d+$/.test(normalizedExpiryInput)
    ? Number.parseInt(normalizedExpiryInput, 10)
    : 0;
  const safeParsedTradeExpiryHours = Number.isFinite(parsedTradeExpiryHours) ? parsedTradeExpiryHours : 0;

  const tradeComposerFieldErrors: TradeComposerFieldErrors = {};

  if (counterpartyRequired && !activeContact) {
    tradeComposerFieldErrors.general = missingCounterpartyMessage;
  } else if (!walletAddress || !isWalletAddress(walletAddress)) {
    tradeComposerFieldErrors.general = 'Connect your wallet first.';
  } else if (counterpartyRequired && isSelfChat) {
    tradeComposerFieldErrors.general = selfTradeMessage;
  } else if (!onCotiNetwork) {
    tradeComposerFieldErrors.general = 'Switch to COTI network first.';
  } else if (!TRADE_ESCROW_CONTRACT_ADDRESS || !isWalletAddress(TRADE_ESCROW_CONTRACT_ADDRESS)) {
    tradeComposerFieldErrors.general = 'Trade escrow contract is not configured yet.';
  }

  if (!selectedTradeOfferToken) {
    tradeComposerFieldErrors.offerAsset = isCustomTradeTokenSelection(tradeOfferTokenSelection)
      ? 'Load a valid token to send.'
      : 'Select a token to send.';
  }
  if (!selectedTradeRequestToken) {
    tradeComposerFieldErrors.requestAsset = isCustomTradeTokenSelection(tradeRequestTokenSelection)
      ? 'Load a valid token to receive.'
      : 'Select a token to receive.';
  }

  if (selectedTradeOfferToken && (parsedTradeOfferAmountWei === null || parsedTradeOfferAmountWei <= 0n)) {
    tradeComposerFieldErrors.offerAmount = `Enter a valid ${selectedTradeOfferToken.symbol} amount to send.`;
  }
  if (selectedTradeRequestToken && (parsedTradeRequestAmountWei === null || parsedTradeRequestAmountWei <= 0n)) {
    tradeComposerFieldErrors.requestAmount = `Enter a valid ${selectedTradeRequestToken.symbol} amount to receive.`;
  }

  if (
    selectedTradeOfferToken &&
    parsedTradeOfferAmountWei !== null &&
    parsedTradeOfferAmountWei > 0n &&
    selectedTradeOfferToken.kind === 'private-erc20' &&
    parsedTradeOfferAmountWei > PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE
  ) {
    tradeComposerFieldErrors.offerAmount = `${selectedTradeOfferToken.symbol} private trades are capped at ${formatTokenAmount(
      PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE,
      selectedTradeOfferToken.decimals,
      6
    )} ${selectedTradeOfferToken.symbol}.`;
  }
  if (
    selectedTradeRequestToken &&
    parsedTradeRequestAmountWei !== null &&
    parsedTradeRequestAmountWei > 0n &&
    selectedTradeRequestToken.kind === 'private-erc20' &&
    parsedTradeRequestAmountWei > PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE
  ) {
    tradeComposerFieldErrors.requestAmount = `${selectedTradeRequestToken.symbol} private trades are capped at ${formatTokenAmount(
      PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE,
      selectedTradeRequestToken.decimals,
      6
    )} ${selectedTradeRequestToken.symbol}.`;
  }

  const offerAmountValid = selectedTradeOfferToken !== null && parsedTradeOfferAmountWei !== null && parsedTradeOfferAmountWei > 0n;
  const requestAmountValid =
    selectedTradeRequestToken !== null && parsedTradeRequestAmountWei !== null && parsedTradeRequestAmountWei > 0n;

  if (selectedTradeOfferToken?.kind === 'native' && offerAmountValid) {
    if (tipNativeBalanceWei === null) {
      tradeComposerFieldErrors.offerAmount = 'Unable to read your COTI balance yet.';
    } else {
      const requiredNativeBalance =
        (parsedTradeOfferAmountWei as bigint) + (tradeFeeModeSelection === 'coti' ? tradeRequiredFeeWei ?? 0n : 0n);
      if (requiredNativeBalance > tipNativeBalanceWei) {
        tradeComposerFieldErrors.offerAmount = `Need ${formatTokenAmount(requiredNativeBalance, TIP_NATIVE_TOKEN_DECIMALS, 6)} ${TIP_NATIVE_TOKEN_SYMBOL} to cover the send amount and fee.`;
      }
    }
  } else if (selectedTradeOfferToken && offerAmountValid) {
    if (selectedTradeOfferBalanceWei === null) {
      tradeComposerFieldErrors.offerAmount = `Unable to read ${selectedTradeOfferToken.symbol} balance yet.`;
    } else if ((parsedTradeOfferAmountWei as bigint) > selectedTradeOfferBalanceWei) {
      tradeComposerFieldErrors.offerAmount = `Insufficient ${selectedTradeOfferToken.symbol} balance to send this amount.`;
    }
  }

  if (tradeFeeModeSelection === 'token') {
    if (tradeTokenFeeWei === null) {
      tradeComposerFieldErrors.fee = `Loading ${rewardTokenSymbol} fee...`;
    }
  } else if (tradeRequiredFeeWei === null) {
    tradeComposerFieldErrors.fee = 'Loading trade fee...';
  } else if (selectedTradeOfferToken?.kind !== 'native') {
    if (tipNativeBalanceWei === null || tipNativeBalanceWei < tradeRequiredFeeWei) {
      tradeComposerFieldErrors.fee = `Need ${formatCotiAmount(tradeRequiredFeeWei)} ${TIP_NATIVE_TOKEN_SYMBOL} for the trade fee.`;
    }
  }

  if (safeParsedTradeExpiryHours < 1 || safeParsedTradeExpiryHours > 720) {
    tradeComposerFieldErrors.expiry = 'Set an expiry between 1 and 720 hours.';
  }

  if (selectedTradeOfferToken && selectedTradeRequestToken && offerAmountValid && requestAmountValid) {
    const offerTokenKey = selectedTradeOfferToken.tokenAddress?.toLowerCase() ?? 'native';
    const requestTokenKey = selectedTradeRequestToken.tokenAddress?.toLowerCase() ?? 'native';
    if (
      selectedTradeOfferToken.kind === selectedTradeRequestToken.kind &&
      offerTokenKey === requestTokenKey &&
      parsedTradeOfferAmountWei === parsedTradeRequestAmountWei
    ) {
      tradeComposerFieldErrors.general = 'Choose different send and receive terms.';
    }
  }

  const tradeComposerValidationMessage =
    tradeComposerFieldErrors.general ??
    tradeComposerFieldErrors.offerAsset ??
    tradeComposerFieldErrors.requestAsset ??
    tradeComposerFieldErrors.offerAmount ??
    tradeComposerFieldErrors.requestAmount ??
    tradeComposerFieldErrors.fee ??
    tradeComposerFieldErrors.expiry ??
    '';

  let tradeOfferMaxAmountWei: bigint | null = null;
  if (selectedTradeOfferToken) {
    if (selectedTradeOfferToken.kind === 'native') {
      if (tipNativeBalanceWei !== null) {
        tradeOfferMaxAmountWei = tipNativeBalanceWei;
        if (tradeFeeModeSelection === 'coti') {
          tradeOfferMaxAmountWei =
            tradeRequiredFeeWei === null
              ? null
              : tradeOfferMaxAmountWei > tradeRequiredFeeWei
                ? tradeOfferMaxAmountWei - tradeRequiredFeeWei
                : 0n;
        }
      }
    } else if (selectedTradeOfferBalanceWei !== null) {
      tradeOfferMaxAmountWei = selectedTradeOfferBalanceWei;
    }
  }

  if (
    selectedTradeOfferToken?.kind === 'private-erc20' &&
    tradeOfferMaxAmountWei !== null &&
    tradeOfferMaxAmountWei > PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE
  ) {
    tradeOfferMaxAmountWei = PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE;
  }

  if (tradeOfferMaxAmountWei !== null && tradeOfferMaxAmountWei < 0n) {
    tradeOfferMaxAmountWei = 0n;
  }

  const tradeOfferMaxInputValue =
    selectedTradeOfferToken && tradeOfferMaxAmountWei !== null
      ? formatTokenAmount(tradeOfferMaxAmountWei, selectedTradeOfferToken.decimals, 18)
      : '';
  const canUseTradeOfferMax = tradeOfferMaxAmountWei !== null && tradeOfferMaxAmountWei > 0n;

  const tradePreviewLabel =
    !selectedTradeOfferToken ||
    !selectedTradeRequestToken ||
    parsedTradeOfferAmountWei === null ||
    parsedTradeRequestAmountWei === null ||
    parsedTradeOfferAmountWei <= 0n ||
    parsedTradeRequestAmountWei <= 0n
      ? ''
      : `Send ${tradeOfferAmountSummaryLabel} for ${tradeRequestAmountSummaryLabel}`;

  let tradeRateLabel = '';
  if (
    selectedTradeOfferToken &&
    selectedTradeRequestToken &&
    parsedTradeOfferAmountWei !== null &&
    parsedTradeRequestAmountWei !== null &&
    parsedTradeOfferAmountWei > 0n &&
    parsedTradeRequestAmountWei > 0n
  ) {
    try {
      const scaledRequestAmount =
        (parsedTradeRequestAmountWei * 10n ** BigInt(selectedTradeOfferToken.decimals)) / parsedTradeOfferAmountWei;
      tradeRateLabel = `1 ${selectedTradeOfferToken.symbol} \u2248 ${formatTokenAmount(
        scaledRequestAmount,
        selectedTradeRequestToken.decimals,
        6
      )} ${selectedTradeRequestToken.symbol}`;
    } catch {
      tradeRateLabel = '';
    }
  }

  const tradeFeeSummaryLabel =
    tradeFeeModeSelection === 'coti'
      ? `Fee: ${tradeRequiredFeeWei !== null ? `${formatCotiAmount(tradeRequiredFeeWei)} ${TIP_NATIVE_TOKEN_SYMBOL}` : '--'}`
      : `Fee: ${
          tradeTokenFeeWei !== null
            ? `${formatTokenAmount(tradeTokenFeeWei, rewardTokenDecimals, 6)} ${rewardTokenSymbol}`
            : `-- ${rewardTokenSymbol}`
        }`;

  return {
    tradeTokenOptions,
    tradeCustomOfferTokenInfo,
    tradeCustomRequestTokenInfo,
    selectedTradeOfferToken,
    selectedTradeRequestToken,
    selectedTradeOfferBalanceWei,
    parsedTradeOfferAmountWei,
    parsedTradeRequestAmountWei,
    tradeOfferAmountSummaryLabel,
    tradeRequestAmountSummaryLabel,
    tradeOfferBalanceSummaryLabel,
    tradeOfferVerifyUrl,
    tradeRequestVerifyUrl,
    parsedTradeExpiryHours: safeParsedTradeExpiryHours,
    tradeComposerFieldErrors,
    tradeComposerValidationMessage,
    canSendTradeOffer: !creatingTrade && !sending && !tipping && tradeComposerValidationMessage.length === 0,
    tradeOfferMaxAmountWei,
    tradeOfferMaxInputValue,
    canUseTradeOfferMax,
    tradePreviewLabel,
    tradeRateLabel,
    tradeFeeSummaryLabel,
    tradeOfferCustomMetaLabel: buildTradeCustomMetaLabel(
      normalizedTradeOfferCustomTokenAddress,
      tradeCustomOfferTokenInfo
    ),
    tradeRequestCustomMetaLabel: buildTradeCustomMetaLabel(
      normalizedTradeRequestCustomTokenAddress,
      tradeCustomRequestTokenInfo
    )
  };
};
