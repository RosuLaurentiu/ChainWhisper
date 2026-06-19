import {
  COTI_NETWORK,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE,
  REWARD_TOKEN_ADDRESS,
  FALLBACK_REWARD_TOKEN_DECIMALS,
  TIP_NATIVE_TOKEN_DECIMALS,
  TIP_NATIVE_TOKEN_SYMBOL,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  formatCotiAmount,
  formatTokenAmount,
  isWalletAddress,
  normalizeTokenDecimals,
  parseTokenAmountInput,
  shortenAddress,
  type TradeFeeModeSelection
} from './appShared';
import {
  VERIFIED_ECOSYSTEM_TOKENS,
  buildPrivateTradeTokenSymbolOrder,
  buildPublicTradeTokenSymbolOrder,
  buildTradeCustomTokenInfoKey,
  getVerifiedEcosystemToken,
  isCustomTradeTokenSelection,
  sortTradeTokenOptionsBySymbol,
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
  tradeHasNoExpiry?: boolean;
  tradeHidePrivateLiquidity?: boolean;
  hiddenLiquidityUnavailableMessage?: string;
  rewardTokenSymbol: string;
  rewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  privateRewardTokenDecimals: number;
  tipNativeBalanceWei: bigint | null;
  rewardTokenBalanceWei: bigint | null;
  privateRewardTokenBalanceWei: bigint | null;
  combinedBalanceByAssetKey?: Record<
    string,
    {
      combinedBalanceWei: bigint | null;
      ownerPrivacyRequired?: boolean;
      splitLabel?: string;
    }
  >;
  tradeRequiredFeeWei: bigint | null;
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
  tradeRequestBalanceSummaryLabel: string;
  tradeOfferAmountLabel: string;
  tradeRequestAmountLabel: string;
  tradeOfferAmountPlaceholder: string;
  tradeRequestAmountPlaceholder: string;
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
  tradeReverseRateLabel: string;
  tradeFeeSummaryLabel: string;
  tradeOfferCustomMetaLabel: string;
  tradeRequestCustomMetaLabel: string;
  canHidePrivateLiquidity: boolean;
  hiddenLiquidityActive: boolean;
  hiddenLiquidityUnavailableMessage: string;
  hiddenPriceOfferAmountWei: bigint | null;
  hiddenPriceRequestAmountWei: bigint | null;
};

const resolveSelectedTradeToken = ({
  selection,
  customTokenInfo,
  customAddress,
  rewardTokenSymbol,
  rewardTokenDecimals,
  privateRewardTokenSymbol,
  privateRewardTokenDecimals
}: {
  selection: TradeTokenPresetKey;
  customTokenInfo?: TradeCustomTokenInfo;
  customAddress?: string;
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

  const verifiedFallbackToken = getVerifiedEcosystemToken(customTokenInfo?.address || customAddress || selection);
  if ((!customTokenInfo || customTokenInfo.error || customTokenInfo.loading) && verifiedFallbackToken) {
    return {
      kind: verifiedFallbackToken.kind,
      tokenAddress: verifiedFallbackToken.address,
      symbol: verifiedFallbackToken.symbol,
      decimals: customTokenInfo?.decimals ?? FALLBACK_REWARD_TOKEN_DECIMALS,
      custom: true
    };
  }

  if (!customTokenInfo || customTokenInfo.error || customTokenInfo.loading) {
    return null;
  }

  const verifiedToken = getVerifiedEcosystemToken(customTokenInfo.address);
  const customTokenSymbol =
    verifiedToken && customTokenInfo.symbol.trim() === shortenAddress(customTokenInfo.address)
      ? verifiedToken.symbol
      : customTokenInfo.symbol;

  return {
    kind: customTokenInfo.kind,
    tokenAddress: customTokenInfo.address,
    symbol: customTokenSymbol,
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

export const buildTradeComposerAssetBalanceKey = (
  token: Pick<ResolvedTradeToken, 'kind' | 'tokenAddress'> | null
): string => {
  if (!token) {
    return '';
  }
  if (token.kind === 'native') {
    return 'native:coti';
  }
  const tokenAddress = token.tokenAddress?.trim().toLowerCase();
  return tokenAddress ? `${token.kind}:${tokenAddress}` : '';
};

const isTradeTokenMetadataPending = ({
  selection,
  customAddress,
  tokenInfo
}: {
  selection: TradeTokenPresetKey;
  customAddress: string;
  tokenInfo?: TradeCustomTokenInfo;
}): boolean => {
  const selectedAddress = isCustomTradeTokenSelection(selection) ? customAddress.trim() : selection.trim();
  if (!selectedAddress || !isWalletAddress(selectedAddress)) {
    return false;
  }
  const verifiedToken = getVerifiedEcosystemToken(selectedAddress);
  if (!isCustomTradeTokenSelection(selection) && !verifiedToken) {
    return false;
  }
  if (verifiedToken && tokenInfo?.error) {
    return true;
  }
  return !tokenInfo || Boolean(tokenInfo.loading && !tokenInfo.error);
};

const resolvePendingTradeTokenSymbol = ({
  selection,
  customAddress
}: {
  selection: TradeTokenPresetKey;
  customAddress: string;
}): string | undefined => {
  const selectedAddress = isCustomTradeTokenSelection(selection) ? customAddress.trim() : selection.trim();
  return selectedAddress && isWalletAddress(selectedAddress)
    ? getVerifiedEcosystemToken(selectedAddress)?.symbol
    : undefined;
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
  tradeHasNoExpiry = false,
  tradeHidePrivateLiquidity = false,
  hiddenLiquidityUnavailableMessage = '',
  rewardTokenSymbol,
  rewardTokenDecimals,
  privateRewardTokenSymbol,
  privateRewardTokenDecimals,
  tipNativeBalanceWei,
  rewardTokenBalanceWei,
  privateRewardTokenBalanceWei,
  combinedBalanceByAssetKey,
  tradeRequiredFeeWei,
  counterpartyRequired = true,
  missingCounterpartyMessage = 'Select a contact first.',
  selfTradeMessage = 'OTC Desk offers are only available in private chats with another wallet.'
}: DeriveTradeComposerModelParams): TradeComposerModel => {
  const resolvedTradeFeeModeSelection: TradeFeeModeSelection =
    tradeFeeModeSelection === 'token' ? 'coti' : tradeFeeModeSelection;
  const normalizedTradeOfferCustomTokenAddress = tradeOfferCustomTokenAddress.trim();
  const normalizedTradeRequestCustomTokenAddress = tradeRequestCustomTokenAddress.trim();
  const builtInTokenAddresses = new Set([
    REWARD_TOKEN_ADDRESS.toLowerCase(),
    PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()
  ]);
  const verifiedTokenOptions = VERIFIED_ECOSYSTEM_TOKENS.filter(
    ({ address }) => !builtInTokenAddresses.has(address.toLowerCase())
  ).map(({ address, kind, symbol: fallbackSymbol }) => {
    const key = buildTradeCustomTokenInfoKey(kind, address);
    const info = customTradeTokenInfoByAddress[key];
    if (
      !info ||
      info.loading ||
      info.error ||
      !info.symbol?.trim() ||
      info.symbol.trim() === shortenAddress(address)
    ) {
      return {
        value: address.toLowerCase(),
        label: `✓ ${fallbackSymbol} (ecosystem)`,
        symbol: fallbackSymbol,
        kindLabel: kind === 'private-erc20' ? 'Private' : 'Public',
        addressLabel: `CA ${shortenAddress(address)}`,
        verificationLabel: kind === 'private-erc20' ? 'Verified private token' : 'CA loaded'
      };
    }
    const symbol = info.symbol.trim();
    return {
      value: address.toLowerCase(),
      label: `✓ ${symbol} (ecosystem)`,
      symbol,
      kindLabel: kind === 'private-erc20' ? 'Private' : 'Public',
      addressLabel: `CA ${shortenAddress(address)}`,
      verificationLabel: kind === 'private-erc20' ? 'Verified private token' : 'CA loaded'
    };
  });
  const privateVerifiedTokenOptions = verifiedTokenOptions.filter(
    (option) => getVerifiedEcosystemToken(option.value)?.kind === 'private-erc20'
  ).map((option) => ({ ...option, label: option.label.replace('(ecosystem)', '(private)') }));
  const publicVerifiedTokenOptions = verifiedTokenOptions.filter(
    (option) => getVerifiedEcosystemToken(option.value)?.kind !== 'private-erc20'
  );
  const nativeCotiTokenOption = {
    value: 'coti',
    label: `✓ ${TIP_NATIVE_TOKEN_SYMBOL} (native)`,
    symbol: TIP_NATIVE_TOKEN_SYMBOL,
    kindLabel: 'Native',
    addressLabel: 'COTI Mainnet native asset',
    verificationLabel: 'Native asset'
  };
  const rewardTokenOption = {
    value: 'wisp',
    label: `✓ ${rewardTokenSymbol} (public)`,
    symbol: rewardTokenSymbol,
    kindLabel: 'Public',
    addressLabel: `CA ${shortenAddress(REWARD_TOKEN_ADDRESS)}`,
    verificationLabel: 'CA loaded'
  };
  const privateRewardTokenOption = {
    value: 'pwisp',
    label: `✓ ${privateRewardTokenSymbol} (private)`,
    symbol: privateRewardTokenSymbol,
    kindLabel: 'Private',
    addressLabel: `CA ${shortenAddress(PRIVATE_REWARD_TOKEN_ADDRESS)}`,
    verificationLabel: 'Verified private token'
  };
  const publicTradeTokenOptions = sortTradeTokenOptionsBySymbol(
    [...publicVerifiedTokenOptions, rewardTokenOption],
    buildPublicTradeTokenSymbolOrder(rewardTokenSymbol)
  );
  const privateTradeTokenOptions = sortTradeTokenOptionsBySymbol(
    [...privateVerifiedTokenOptions, privateRewardTokenOption],
    buildPrivateTradeTokenSymbolOrder(privateRewardTokenSymbol)
  );
  const tradeTokenOptions = [nativeCotiTokenOption, ...publicTradeTokenOptions, ...privateTradeTokenOptions];

  const tradeCustomOfferTokenKey = (() => {
    if (isCustomTradeTokenSelection(tradeOfferTokenSelection)) {
      return normalizedTradeOfferCustomTokenAddress && isWalletAddress(normalizedTradeOfferCustomTokenAddress)
        ? buildTradeCustomTokenInfoKey(tradeCustomOfferTokenKind, normalizedTradeOfferCustomTokenAddress)
        : '';
    }
    if (isWalletAddress(tradeOfferTokenSelection)) {
      return buildTradeCustomTokenInfoKey(
        getVerifiedEcosystemToken(tradeOfferTokenSelection)?.kind ?? 'erc20',
        tradeOfferTokenSelection
      );
    }
    return '';
  })();
  const tradeCustomRequestTokenKey = (() => {
    if (isCustomTradeTokenSelection(tradeRequestTokenSelection)) {
      return normalizedTradeRequestCustomTokenAddress && isWalletAddress(normalizedTradeRequestCustomTokenAddress)
        ? buildTradeCustomTokenInfoKey(tradeCustomRequestTokenKind, normalizedTradeRequestCustomTokenAddress)
        : '';
    }
    if (isWalletAddress(tradeRequestTokenSelection)) {
      return buildTradeCustomTokenInfoKey(
        getVerifiedEcosystemToken(tradeRequestTokenSelection)?.kind ?? 'erc20',
        tradeRequestTokenSelection
      );
    }
    return '';
  })();

  const tradeCustomOfferTokenInfo = tradeCustomOfferTokenKey
    ? customTradeTokenInfoByAddress[tradeCustomOfferTokenKey]
    : undefined;
  const tradeCustomRequestTokenInfo = tradeCustomRequestTokenKey
    ? customTradeTokenInfoByAddress[tradeCustomRequestTokenKey]
    : undefined;

  const selectedTradeOfferToken = resolveSelectedTradeToken({
    selection: tradeOfferTokenSelection,
    customTokenInfo: tradeCustomOfferTokenInfo,
    customAddress: normalizedTradeOfferCustomTokenAddress,
    rewardTokenSymbol,
    rewardTokenDecimals,
    privateRewardTokenSymbol,
    privateRewardTokenDecimals
  });
  const selectedTradeRequestToken = resolveSelectedTradeToken({
    selection: tradeRequestTokenSelection,
    customTokenInfo: tradeCustomRequestTokenInfo,
    customAddress: normalizedTradeRequestCustomTokenAddress,
    rewardTokenSymbol,
    rewardTokenDecimals,
    privateRewardTokenSymbol,
    privateRewardTokenDecimals
  });
  const tradeOfferTokenMetadataPending = isTradeTokenMetadataPending({
    selection: tradeOfferTokenSelection,
    customAddress: normalizedTradeOfferCustomTokenAddress,
    tokenInfo: tradeCustomOfferTokenInfo
  });
  const tradeRequestTokenMetadataPending = isTradeTokenMetadataPending({
    selection: tradeRequestTokenSelection,
    customAddress: normalizedTradeRequestCustomTokenAddress,
    tokenInfo: tradeCustomRequestTokenInfo
  });
  const tradeOfferPendingSymbol = tradeOfferTokenMetadataPending
    ? resolvePendingTradeTokenSymbol({
        selection: tradeOfferTokenSelection,
        customAddress: normalizedTradeOfferCustomTokenAddress
      })
    : undefined;
  const tradeRequestPendingSymbol = tradeRequestTokenMetadataPending
    ? resolvePendingTradeTokenSymbol({
        selection: tradeRequestTokenSelection,
        customAddress: normalizedTradeRequestCustomTokenAddress
      })
    : undefined;

  const resolveSelectedTradeBalanceWei = (selectedToken: ResolvedTradeToken | null): bigint | null => {
    if (!selectedToken) {
      return null;
    }
    if (selectedToken.kind === 'native') {
      return tipNativeBalanceWei;
    }
    const tokenKey = selectedToken.tokenAddress?.toLowerCase();
    if (!tokenKey) {
      return null;
    }
    if (tokenKey === REWARD_TOKEN_ADDRESS.toLowerCase()) {
      return rewardTokenBalanceWei;
    }
    if (tokenKey === PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()) {
      return privateRewardTokenBalanceWei;
    }
    return (
      customTradeTokenInfoByAddress[
        buildTradeCustomTokenInfoKey(selectedToken.kind === 'private-erc20' ? 'private-erc20' : 'erc20', tokenKey)
      ]?.balanceWei ?? null
    );
  };
  const selectedTradeOfferBalanceWei = resolveSelectedTradeBalanceWei(selectedTradeOfferToken);
  const selectedTradeRequestBalanceWei = resolveSelectedTradeBalanceWei(selectedTradeRequestToken);
  const selectedTradeOfferBalanceKey = buildTradeComposerAssetBalanceKey(selectedTradeOfferToken);
  const selectedTradeRequestBalanceKey = buildTradeComposerAssetBalanceKey(selectedTradeRequestToken);
  const selectedTradeOfferCombinedBalance = selectedTradeOfferBalanceKey
    ? combinedBalanceByAssetKey?.[selectedTradeOfferBalanceKey]
    : undefined;
  const selectedTradeRequestCombinedBalance = selectedTradeRequestBalanceKey
    ? combinedBalanceByAssetKey?.[selectedTradeRequestBalanceKey]
    : undefined;
  const selectedTradeOfferAvailableBalanceWei =
    selectedTradeOfferCombinedBalance?.combinedBalanceWei ?? selectedTradeOfferBalanceWei;
  const selectedTradeRequestAvailableBalanceWei =
    selectedTradeRequestCombinedBalance?.combinedBalanceWei ?? selectedTradeRequestBalanceWei;
  const nativeCombinedBalance = combinedBalanceByAssetKey?.['native:coti'];
  const nativeAvailableBalanceWei = nativeCombinedBalance?.combinedBalanceWei ?? tipNativeBalanceWei;

  const parsedTradeOfferAmountWei = selectedTradeOfferToken
    ? parseTokenAmountInput(tradeOfferAmountInput, selectedTradeOfferToken.decimals)
    : null;
  const parsedTradeRequestAmountWei = selectedTradeRequestToken
    ? parseTokenAmountInput(tradeRequestAmountInput, selectedTradeRequestToken.decimals)
    : null;
  const privateOrderSelected = selectedTradeOfferToken?.kind === 'private-erc20';
  const privateOrderPairInvalid =
    privateOrderSelected &&
    selectedTradeRequestToken?.kind === 'private-erc20' &&
    selectedTradeRequestToken.tokenAddress?.toLowerCase() === selectedTradeOfferToken?.tokenAddress?.toLowerCase();
  const hiddenLiquidityPairMessage = privateOrderSelected
    ? privateOrderPairInvalid
      ? 'Hidden amount orders need two different token sides.'
      : ''
    : 'Private liquidity requires the token you sell to be private.';
  const canHidePrivateLiquidity = privateOrderSelected && !privateOrderPairInvalid && !hiddenLiquidityUnavailableMessage;
  const hiddenLiquidityActive = Boolean(tradeHidePrivateLiquidity && canHidePrivateLiquidity);
  const resolvedHiddenLiquidityUnavailableMessage =
    hiddenLiquidityUnavailableMessage || hiddenLiquidityPairMessage;
  const hiddenPriceOfferAmountWei = selectedTradeOfferToken
    ? 10n ** BigInt(normalizeTokenDecimals(selectedTradeOfferToken.decimals))
    : null;
  const hiddenPriceRequestAmountWei =
    hiddenLiquidityActive &&
    hiddenPriceOfferAmountWei !== null &&
    parsedTradeOfferAmountWei !== null &&
    parsedTradeRequestAmountWei !== null &&
    parsedTradeOfferAmountWei > 0n &&
    parsedTradeRequestAmountWei > 0n
      ? (parsedTradeRequestAmountWei * hiddenPriceOfferAmountWei + parsedTradeOfferAmountWei - 1n) /
        parsedTradeOfferAmountWei
      : null;

  const formatAmountSummaryLabel = ({
    input,
    parsedAmountWei,
    selectedToken,
    pendingSymbol
  }: {
    input: string;
    parsedAmountWei: bigint | null;
    selectedToken: ResolvedTradeToken | null;
    pendingSymbol?: string;
  }): string => {
    const symbol = selectedToken?.symbol ?? pendingSymbol ?? 'TOKEN';
    if (parsedAmountWei !== null && parsedAmountWei > 0n && selectedToken) {
      return `${formatTokenAmount(parsedAmountWei, selectedToken.decimals, 6)} ${symbol}`;
    }
    const pendingAmount = input.trim();
    if (pendingAmount) {
      return `${pendingAmount} ${symbol}`;
    }
    return `0 ${symbol}`;
  };
  const formatBalanceSummaryLabel = (
    selectedToken: ResolvedTradeToken | null,
    balanceWei: bigint | null,
    combinedBalance?: { splitLabel?: string }
  ): string =>
    selectedToken && combinedBalance?.splitLabel
      ? combinedBalance.splitLabel
      : selectedToken && balanceWei !== null
        ? `${formatTokenAmount(balanceWei, selectedToken.decimals, 6)} ${selectedToken.symbol}`
        : selectedToken
          ? `-- ${selectedToken.symbol}`
          : '--';
  const tradeOfferAmountSummaryLabel = formatAmountSummaryLabel({
    input: tradeOfferAmountInput,
    parsedAmountWei: parsedTradeOfferAmountWei,
    selectedToken: selectedTradeOfferToken,
    pendingSymbol: tradeOfferPendingSymbol
  });
  const tradeRequestAmountSummaryLabel = formatAmountSummaryLabel({
    input: tradeRequestAmountInput,
    parsedAmountWei: parsedTradeRequestAmountWei,
    selectedToken: selectedTradeRequestToken,
    pendingSymbol: tradeRequestPendingSymbol
  });
  const tradeOfferBalanceSummaryLabel = formatBalanceSummaryLabel(
    selectedTradeOfferToken,
    selectedTradeOfferAvailableBalanceWei,
    selectedTradeOfferCombinedBalance
  );
  const tradeRequestBalanceSummaryLabel = formatBalanceSummaryLabel(
    selectedTradeRequestToken,
    selectedTradeRequestAvailableBalanceWei,
    selectedTradeRequestCombinedBalance
  );
  const tradeOfferVerifyUrl = selectedTradeOfferToken?.tokenAddress
    ? `${COTI_NETWORK.blockExplorerUrl}/address/${selectedTradeOfferToken.tokenAddress}`
    : isCustomTradeTokenSelection(tradeOfferTokenSelection) && isWalletAddress(normalizedTradeOfferCustomTokenAddress)
      ? `${COTI_NETWORK.blockExplorerUrl}/address/${normalizedTradeOfferCustomTokenAddress}`
      : isWalletAddress(tradeOfferTokenSelection)
        ? `${COTI_NETWORK.blockExplorerUrl}/address/${tradeOfferTokenSelection}`
        : undefined;
  const tradeRequestVerifyUrl = selectedTradeRequestToken?.tokenAddress
    ? `${COTI_NETWORK.blockExplorerUrl}/address/${selectedTradeRequestToken.tokenAddress}`
    : isCustomTradeTokenSelection(tradeRequestTokenSelection) && isWalletAddress(normalizedTradeRequestCustomTokenAddress)
      ? `${COTI_NETWORK.blockExplorerUrl}/address/${normalizedTradeRequestCustomTokenAddress}`
      : isWalletAddress(tradeRequestTokenSelection)
        ? `${COTI_NETWORK.blockExplorerUrl}/address/${tradeRequestTokenSelection}`
        : undefined;

  const normalizedExpiryInput = tradeHasNoExpiry ? '0' : tradeExpiryHoursInput.trim();
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

  if (!selectedTradeOfferToken && !tradeOfferTokenMetadataPending) {
    tradeComposerFieldErrors.offerAsset = isCustomTradeTokenSelection(tradeOfferTokenSelection)
      ? 'Load a valid token to send.'
      : 'Select a token to send.';
  }
  if (!selectedTradeRequestToken && !tradeRequestTokenMetadataPending) {
    tradeComposerFieldErrors.requestAsset = isCustomTradeTokenSelection(tradeRequestTokenSelection)
      ? 'Load a valid token to receive.'
      : 'Select a token to receive.';
  }
  if (tradeHidePrivateLiquidity && !canHidePrivateLiquidity) {
    tradeComposerFieldErrors.general = resolvedHiddenLiquidityUnavailableMessage;
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
  if (
    hiddenLiquidityActive &&
    selectedTradeOfferToken &&
    hiddenPriceOfferAmountWei !== null &&
    hiddenPriceOfferAmountWei > PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE
  ) {
    tradeComposerFieldErrors.general = `${selectedTradeOfferToken.symbol} decimals are too large for private order settlement.`;
  }
  if (
    hiddenLiquidityActive &&
    selectedTradeRequestToken &&
    hiddenPriceRequestAmountWei !== null &&
    hiddenPriceRequestAmountWei > PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE
  ) {
    tradeComposerFieldErrors.requestAmount = `The implied ${selectedTradeRequestToken.symbol} ratio is too large for private order settlement.`;
  }

  const offerAmountValid = selectedTradeOfferToken !== null && parsedTradeOfferAmountWei !== null && parsedTradeOfferAmountWei > 0n;

  if (selectedTradeOfferToken?.kind === 'native' && offerAmountValid) {
    if (nativeAvailableBalanceWei === null) {
      tradeComposerFieldErrors.offerAmount = 'Unable to read your COTI balance yet.';
    } else {
      const requiredNativeBalance = (parsedTradeOfferAmountWei as bigint) + (tradeRequiredFeeWei ?? 0n);
      if (requiredNativeBalance > nativeAvailableBalanceWei) {
        tradeComposerFieldErrors.offerAmount = `Need ${formatTokenAmount(requiredNativeBalance, TIP_NATIVE_TOKEN_DECIMALS, 6)} ${TIP_NATIVE_TOKEN_SYMBOL} to cover the send amount and fee.`;
      }
    }
  } else if (selectedTradeOfferToken && offerAmountValid) {
    if (selectedTradeOfferAvailableBalanceWei === null) {
      tradeComposerFieldErrors.offerAmount = `Unable to read ${selectedTradeOfferToken.symbol} balance yet.`;
    } else if ((parsedTradeOfferAmountWei as bigint) > selectedTradeOfferAvailableBalanceWei) {
      tradeComposerFieldErrors.offerAmount = `Insufficient ${selectedTradeOfferToken.symbol} balance to send this amount.`;
    }
  }

  if (tradeRequiredFeeWei === null) {
    tradeComposerFieldErrors.fee = 'Loading trade fee...';
  } else if (selectedTradeOfferToken?.kind !== 'native') {
    if (nativeAvailableBalanceWei === null || nativeAvailableBalanceWei < tradeRequiredFeeWei) {
      tradeComposerFieldErrors.fee = `Need ${formatCotiAmount(tradeRequiredFeeWei)} ${TIP_NATIVE_TOKEN_SYMBOL} for the trade fee.`;
    }
  }

  if (!tradeHasNoExpiry && (safeParsedTradeExpiryHours < 1 || safeParsedTradeExpiryHours > 720)) {
    tradeComposerFieldErrors.expiry = 'Set an expiry between 1 and 720 hours.';
  }

  if (selectedTradeOfferToken && selectedTradeRequestToken) {
    const offerTokenKey = selectedTradeOfferToken.tokenAddress?.toLowerCase() ?? 'native';
    const requestTokenKey = selectedTradeRequestToken.tokenAddress?.toLowerCase() ?? 'native';
    if (
      selectedTradeOfferToken.kind === selectedTradeRequestToken.kind &&
      offerTokenKey === requestTokenKey
    ) {
      tradeComposerFieldErrors.general = 'Choose two different assets for the trade.';
    }
  }

  const tokenMetadataPendingMessage = tradeOfferTokenMetadataPending
    ? 'Loading token to send.'
    : tradeRequestTokenMetadataPending
      ? 'Loading token to receive.'
      : '';

  const tradeComposerValidationMessage =
    tradeComposerFieldErrors.general ??
    tradeComposerFieldErrors.offerAsset ??
    tradeComposerFieldErrors.requestAsset ??
    tradeComposerFieldErrors.offerAmount ??
    tradeComposerFieldErrors.requestAmount ??
    tradeComposerFieldErrors.fee ??
    tradeComposerFieldErrors.expiry ??
    tokenMetadataPendingMessage ??
    '';

  let tradeOfferMaxAmountWei: bigint | null = null;
  if (selectedTradeOfferToken) {
    if (selectedTradeOfferToken.kind === 'native') {
      if (nativeAvailableBalanceWei !== null) {
        tradeOfferMaxAmountWei = nativeAvailableBalanceWei;
        if (resolvedTradeFeeModeSelection === 'coti') {
          tradeOfferMaxAmountWei =
            tradeRequiredFeeWei === null
              ? null
              : tradeOfferMaxAmountWei > tradeRequiredFeeWei
                ? tradeOfferMaxAmountWei - tradeRequiredFeeWei
                : 0n;
        }
      }
    } else if (selectedTradeOfferAvailableBalanceWei !== null) {
      tradeOfferMaxAmountWei = selectedTradeOfferAvailableBalanceWei;
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
      : `Sell ${tradeOfferAmountSummaryLabel} for ${tradeRequestAmountSummaryLabel}`;

  let tradeRateLabel = '';
  let tradeReverseRateLabel = '';
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
      tradeRateLabel = `1 ${selectedTradeOfferToken.symbol} = ${formatTokenAmount(
        scaledRequestAmount,
        selectedTradeRequestToken.decimals,
        6
      )} ${selectedTradeRequestToken.symbol}`;
      const scaledOfferAmount =
        (parsedTradeOfferAmountWei * 10n ** BigInt(selectedTradeRequestToken.decimals)) / parsedTradeRequestAmountWei;
      tradeReverseRateLabel = `1 ${selectedTradeRequestToken.symbol} = ${formatTokenAmount(
        scaledOfferAmount,
        selectedTradeOfferToken.decimals,
        6
      )} ${selectedTradeOfferToken.symbol}`;
    } catch {
      tradeRateLabel = '';
      tradeReverseRateLabel = '';
    }
  }

  const tradeFeeSummaryLabel = `Fee: ${
    tradeRequiredFeeWei !== null ? `${formatCotiAmount(tradeRequiredFeeWei)} ${TIP_NATIVE_TOKEN_SYMBOL}` : '--'
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
    tradeRequestBalanceSummaryLabel,
    tradeOfferAmountLabel: 'You sell',
    tradeRequestAmountLabel: 'You receive',
    tradeOfferAmountPlaceholder: 'Amount you sell',
    tradeRequestAmountPlaceholder: 'Amount you receive',
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
    tradeReverseRateLabel,
    tradeFeeSummaryLabel,
    tradeOfferCustomMetaLabel: buildTradeCustomMetaLabel(
      normalizedTradeOfferCustomTokenAddress,
      tradeCustomOfferTokenInfo
    ),
    tradeRequestCustomMetaLabel: buildTradeCustomMetaLabel(
      normalizedTradeRequestCustomTokenAddress,
      tradeCustomRequestTokenInfo
    ),
    canHidePrivateLiquidity,
    hiddenLiquidityActive,
    hiddenLiquidityUnavailableMessage: resolvedHiddenLiquidityUnavailableMessage,
    hiddenPriceOfferAmountWei,
    hiddenPriceRequestAmountWei
  };
};
