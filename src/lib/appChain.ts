import { type JsonRpcSigner } from '@coti-io/coti-ethers';
export { readCurrentDexOperation, readCurrentDexPrincipalReceipt, readCurrentDexIssuedQuote } from './dexV2Chain';
export { readCurrentDexDailyPrice } from './currentDexDailyPrice';
export { readOfficialTestnetGas } from './officialTestnetFaucet';
export { readCurrentSharedDexTestTokens } from './currentSharedDexTokenRead';
import { decryptUint256, type ctUint256 } from '@coti-io/coti-sdk-typescript';
import {
  ERC20_TOKEN_ABI,
  FALLBACK_REWARD_TOKEN_DECIMALS,
  OTC_HISTORY_READER_CONTRACT_ADDRESS,
  OTC_READER_CONTRACT_ADDRESS,
  PRIVATE_ERC20_TOKEN_ABI,
  PRIVATE_ERC20_TOKEN_VNEXT_ABI,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  DIRECT_TRADE_ESCROW_CONTRACT_ABI,
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ABI,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE,
  RECURRING_OTC_CONTRACT_ABI,
  RECURRING_OTC_CONTRACT_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  TIP_NATIVE_TOKEN_DECIMALS,
  TIP_NATIVE_TOKEN_SYMBOL,
  TRADE_ESCROW_CONTRACT_ABI,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  WISP_PRIVACY_BRIDGE_CONTRACT_ABI,
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiReadProvider,
  normalizeTokenDecimals,
  shortenAddress,
  type TradeAssetPayload
} from './appShared';
import { resolveTradeAssetTypeValue } from './appHelpers';
import { logMobileWalletDiagnostic } from './mobileWalletDiagnostics';
import { encryptPrivateUint256Input } from './privateUint256';
import { waitForPublicTransactionReceipt } from './publicTransactionReceipt';
import {
  COTI_PRIVACY_PORTAL_CHAIN_ID,
  PRIVACY_ERC20_BRIDGE_ABI,
  PRIVACY_NATIVE_BRIDGE_ABI,
  PRIVACY_TOKEN_PAIRS,
  applyPrivacyPortalGasMargin,
  buildPrivacyPortalQuoteKey,
  buildPrivacyPortalTransactionCall,
  calculatePrivacyPortalGasReserveWei,
  getPrivacyTokenPair,
  getPrivacyPortalAmountIssueMessage,
  normalizePrivacyPortalError,
  resolvePrivacyPortalAllowanceRequirement,
  resolvePrivacyPortalReceiveAmount,
  selectPrivacyPortalNativeGasProbeAmount,
  validatePrivacyPortalAmount,
  type PrivacyDirection,
  type PrivacyPairVerification,
  type PrivacyPairVerificationIssue,
  type PrivacyPortalConversionResult,
  type PrivacyPortalConversionStage,
  type PrivacyPortalGasEstimate,
  type PrivacyPortalLimits,
  type PrivacyPortalPairMetrics,
  type PrivacyPortalQuote,
  type PrivacyTokenPair
} from './privacyPortal';
import {
  BAND_STANDARD_REFERENCE_ABI,
  PRIVATE_TVL_BAND_PROXY_BY_CHAIN_ID,
  PRIVATE_TVL_DEFAULT_MAX_PRICE_AGE_SECONDS,
  buildPrivateTvlSnapshot,
  type PrivateTvlBridgeObservation,
  type PrivateTvlSnapshot
} from './privateTvl';
import {
  CHAINWHISPER_WISP_BRIDGE_PAIR,
  buildChainWhisperWispCall,
  buildChainWhisperWispQuoteKey,
  getChainWhisperWispAmountIssueMessage,
  getChainWhisperWispStatusIssueMessage,
  parseChainWhisperWispFeeQuote,
  resolveChainWhisperWispPublicApprovalAmounts,
  submitAndConfirmChainWhisperWispConversion,
  validateChainWhisperWispAmount,
  validateChainWhisperWispStatus,
  type ChainWhisperWispConversionResult,
  type ChainWhisperWispDirection,
  type ChainWhisperWispQuote,
  type ChainWhisperWispStage,
  type ChainWhisperWispVerification,
  type ChainWhisperWispVerificationIssue
} from './wispPrivacyBridge';
const PRIVATE_TOKEN_WRITE_GAS_LIMIT = 6_000_000n;
const PRIVATE_TOKEN_EXACT_APPROVAL_GAS_FALLBACK = 12_000_000n;

const waitForAppChainReceipt = (
  transaction: Readonly<{ hash?: unknown }>,
  label: string
): Promise<unknown> => waitForPublicTransactionReceipt({
  transactionHash: transaction.hash,
  label
});

type PrivateTokenSpendReadinessInput = {
  requiredAmountWei: bigint;
  balanceWei: bigint | null;
  allowanceWei: bigint | null;
  tokenSymbol?: string;
  afterApproval?: boolean;
  skipBalanceCheck?: boolean;
};

export type PrivateTokenSpendReadiness =
  | {
      status: 'ready';
      balanceWei: bigint;
      allowanceWei: bigint;
    }
  | {
      status: 'needs-approval';
      balanceWei: bigint;
      allowanceWei: bigint | null;
    }
  | {
      status: 'blocked';
      reason:
        | 'balance-unavailable'
        | 'insufficient-balance'
        | 'allowance-unavailable-after-approval'
        | 'insufficient-allowance-after-approval';
      message: string;
      balanceWei: bigint | null;
      allowanceWei: bigint | null;
    };

export const resolvePrivateTokenSpendReadiness = ({
  requiredAmountWei,
  balanceWei,
  allowanceWei,
  tokenSymbol = 'private token',
  afterApproval = false,
  skipBalanceCheck = false
}: PrivateTokenSpendReadinessInput): PrivateTokenSpendReadiness => {
  if (requiredAmountWei <= 0n) {
    return {
      status: 'ready',
      balanceWei: balanceWei ?? 0n,
      allowanceWei: allowanceWei ?? 0n
    };
  }

  const effectiveBalanceWei =
    skipBalanceCheck && (balanceWei === null || balanceWei < requiredAmountWei)
      ? requiredAmountWei
      : balanceWei;

  if (effectiveBalanceWei === null) {
    return {
      status: 'blocked',
      reason: 'balance-unavailable',
      message: `The app could not decrypt this wallet's private ${tokenSymbol} balance. Unlock privacy for the connected wallet and refresh the balance before filling.`,
      balanceWei: effectiveBalanceWei,
      allowanceWei
    };
  }

  if (effectiveBalanceWei < requiredAmountWei) {
    return {
      status: 'blocked',
      reason: 'insufficient-balance',
      message: `Your private ${tokenSymbol} balance is below this fill amount.`,
      balanceWei: effectiveBalanceWei,
      allowanceWei
    };
  }

  if (allowanceWei !== null && allowanceWei >= requiredAmountWei) {
    return {
      status: 'ready',
      balanceWei: effectiveBalanceWei,
      allowanceWei
    };
  }

  if (afterApproval && allowanceWei === null) {
    return {
      status: 'blocked',
      reason: 'allowance-unavailable-after-approval',
      message: `Private ${tokenSymbol} approval could not be confirmed after the approval transaction. Unlock privacy and try again.`,
      balanceWei: effectiveBalanceWei,
      allowanceWei
    };
  }

  if (afterApproval) {
    return {
      status: 'blocked',
      reason: 'insufficient-allowance-after-approval',
      message: `Private ${tokenSymbol} allowance is still below this fill amount after approval.`,
      balanceWei: effectiveBalanceWei,
      allowanceWei
    };
  }

  return {
    status: 'needs-approval',
    balanceWei: effectiveBalanceWei,
    allowanceWei
  };
};

export type PrivateTokenAllowanceWritePlan =
  | {
      method: 'approve';
      amountWei: bigint;
      selectorSignature: 'approve(address,((uint256,uint256),bytes))';
    }
  | {
      method: 'increaseAllowance';
      amountWei: bigint;
      selectorSignature: 'increaseAllowance(address,((uint256,uint256),bytes))';
    }
  | {
      method: 'decreaseAllowance';
      amountWei: bigint;
      selectorSignature: 'decreaseAllowance(address,((uint256,uint256),bytes))';
    };

export type PrivateTokenAllowancePolicy = 'maximum' | 'exact';

export const resolvePrivateTokenAllowanceWritePlan = (
  currentAllowanceWei: bigint | null,
  targetAllowanceWei = PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE,
  policy: PrivateTokenAllowancePolicy = 'maximum'
): PrivateTokenAllowanceWritePlan => {
  if (policy === 'exact' && currentAllowanceWei !== null && currentAllowanceWei > targetAllowanceWei) {
    return {
      method: 'decreaseAllowance',
      amountWei: currentAllowanceWei - targetAllowanceWei,
      selectorSignature: 'decreaseAllowance(address,((uint256,uint256),bytes))'
    };
  }

  if (currentAllowanceWei !== null && currentAllowanceWei > 0n) {
    const addedValue = targetAllowanceWei > currentAllowanceWei ? targetAllowanceWei - currentAllowanceWei : 0n;
    return {
      method: 'increaseAllowance',
      amountWei: addedValue,
      selectorSignature: 'increaseAllowance(address,((uint256,uint256),bytes))'
    };
  }

  return {
    method: 'approve',
    amountWei: targetAllowanceWei,
    selectorSignature: 'approve(address,((uint256,uint256),bytes))'
  };
};

type TradeEscrowConfig = {
  address: string;
  abi:
    | typeof TRADE_ESCROW_CONTRACT_ABI
    | typeof PRIVATE_TRADE_ESCROW_CONTRACT_ABI
    | typeof DIRECT_TRADE_ESCROW_CONTRACT_ABI;
  hiddenOnly: boolean;
  directVisible: boolean;
};

type OtcFeeEscrowConfig = {
  address: string;
  abi:
    | typeof TRADE_ESCROW_CONTRACT_ABI
    | typeof PRIVATE_TRADE_ESCROW_CONTRACT_ABI
    | typeof DIRECT_TRADE_ESCROW_CONTRACT_ABI
    | typeof RECURRING_OTC_CONTRACT_ABI;
};

export type TradingContractAddresses = {
  standardEscrow: string;
  privateEscrow: string;
  directEscrow: string;
  recurringEscrow: string;
  reader: string;
  historyReader: string;
};

export const DEFAULT_TRADING_CONTRACT_ADDRESSES: TradingContractAddresses = {
  standardEscrow: TRADE_ESCROW_CONTRACT_ADDRESS,
  privateEscrow: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  directEscrow: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  recurringEscrow: RECURRING_OTC_CONTRACT_ADDRESS,
  reader: OTC_READER_CONTRACT_ADDRESS,
  historyReader: OTC_HISTORY_READER_CONTRACT_ADDRESS
};

const normalizeEscrowAddress = (
  value?: string | null,
  addresses: TradingContractAddresses = DEFAULT_TRADING_CONTRACT_ADDRESSES
): string => (typeof value === 'string' && isWalletAddress(value) ? value : addresses.standardEscrow);

export const isPrivateOrderEscrowContractAddress = (
  value?: string | null,
  addresses: TradingContractAddresses = DEFAULT_TRADING_CONTRACT_ADDRESSES
): boolean =>
  typeof value === 'string' &&
  isWalletAddress(value) &&
  value.toLowerCase() === addresses.privateEscrow.toLowerCase();

const isDirectTradeEscrowContractAddress = (
  value?: string | null,
  addresses: TradingContractAddresses = DEFAULT_TRADING_CONTRACT_ADDRESSES
): boolean =>
  typeof value === 'string' &&
  isWalletAddress(value) &&
  isWalletAddress(addresses.directEscrow) &&
  value.toLowerCase() === addresses.directEscrow.toLowerCase();

export const resolveTradeEscrowContractConfig = (
  escrowContract?: string | null,
  addresses: TradingContractAddresses = DEFAULT_TRADING_CONTRACT_ADDRESSES
): TradeEscrowConfig => {
  const address = normalizeEscrowAddress(escrowContract, addresses);
  if (isPrivateOrderEscrowContractAddress(address, addresses)) {
    return {
      address: addresses.privateEscrow,
      abi: PRIVATE_TRADE_ESCROW_CONTRACT_ABI,
      hiddenOnly: true,
      directVisible: false
    };
  }
  if (isDirectTradeEscrowContractAddress(address, addresses)) {
    return {
      address: addresses.directEscrow,
      abi: DIRECT_TRADE_ESCROW_CONTRACT_ABI,
      hiddenOnly: false,
      directVisible: true
    };
  }
  if (address.toLowerCase() !== addresses.standardEscrow.toLowerCase()) {
    throw new Error('This trade link uses a retired contract and is not supported by the current app.');
  }

  return {
    address: addresses.standardEscrow,
    abi: TRADE_ESCROW_CONTRACT_ABI,
    hiddenOnly: false,
    directVisible: false
  };
};

export const resolveOtcFeeEscrowContractConfig = (
  escrowContract?: string | null,
  addresses: TradingContractAddresses = DEFAULT_TRADING_CONTRACT_ADDRESSES
): OtcFeeEscrowConfig => {
  const address = normalizeEscrowAddress(escrowContract, addresses).toLowerCase();
  if (address === addresses.privateEscrow.toLowerCase()) {
    return { address: addresses.privateEscrow, abi: PRIVATE_TRADE_ESCROW_CONTRACT_ABI };
  }
  if (address === addresses.directEscrow.toLowerCase()) {
    return { address: addresses.directEscrow, abi: DIRECT_TRADE_ESCROW_CONTRACT_ABI };
  }
  if (address === addresses.recurringEscrow.toLowerCase()) {
    return { address: addresses.recurringEscrow, abi: RECURRING_OTC_CONTRACT_ABI };
  }
  return { address: addresses.standardEscrow, abi: TRADE_ESCROW_CONTRACT_ABI };
};

export const readOtcEscrowFeeAmount = async (escrowContract?: string | null): Promise<bigint> => {
  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const config = resolveOtcFeeEscrowContractConfig(escrowContract);
  const contract = new cotiEthers.Contract(config.address, config.abi, readProvider);
  return (await contract.feeAmount()) as bigint;
};

const toBigintOrNull = (value: unknown): bigint | null => {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return null;
};

const normalizeCtUint256Value = (encryptedValue: unknown): ctUint256 | null => {
  const source = encryptedValue as
    | {
        ciphertextHigh?: unknown;
        ciphertextLow?: unknown;
        [key: number]: unknown;
      }
    | null
    | undefined;
  const ciphertextHigh = toBigintOrNull(source?.ciphertextHigh ?? source?.[0]);
  const ciphertextLow = toBigintOrNull(source?.ciphertextLow ?? source?.[1]);
  return ciphertextHigh === null || ciphertextLow === null ? null : { ciphertextHigh, ciphertextLow };
};

const readSignerAesKey = (signer: JsonRpcSigner): string | null => {
  const onboardInfo = signer.getUserOnboardInfo();
  return typeof onboardInfo?.aesKey === 'string' && onboardInfo.aesKey.trim() ? onboardInfo.aesKey.trim() : null;
};

const decryptPrivateUintValueWithCurrentAes = async (
  encryptedValue: unknown,
  signer: JsonRpcSigner
): Promise<bigint | null> => {
  const ctUint256Value = normalizeCtUint256Value(encryptedValue);
  if (ctUint256Value) {
    if (ctUint256Value.ciphertextHigh === 0n && ctUint256Value.ciphertextLow === 0n) {
      return 0n;
    }
    const aesKey = readSignerAesKey(signer);
    return aesKey ? decryptUint256(ctUint256Value, aesKey) : null;
  }

  const parseDecryptedValue = (decrypted: unknown): bigint | null => toBigintOrNull(decrypted);

  try {
    const decrypted = await signer.decryptValue(encryptedValue as never);
    return parseDecryptedValue(decrypted);
  } catch {
  }

  return null;
};

const decryptPrivateUintValue = async (
  encryptedValue: unknown,
  signer: JsonRpcSigner,
  recoverOnFailure = false
): Promise<bigint | null> => {
  void recoverOnFailure;
  if (encryptedValue === null || encryptedValue === undefined) {
    return null;
  }

  const firstAttempt = await decryptPrivateUintValueWithCurrentAes(encryptedValue, signer);
  if (firstAttempt !== null) {
    return firstAttempt;
  }

  return null;
};

// Wrong/stale AES keys can decrypt ctUint256 into random uint256-looking values.
// Current PrivateERC20 totalSupply() is not a reliable private-balance bound, so
// use a very high UI sanity cap to avoid rendering obvious AES garbage.
const PRIVATE_TOKEN_BALANCE_DECRYPT_SANITY_MAX_WEI = 10n ** 48n;

const normalizeCurrentPrivateTokenBalanceWei = (balanceWei: bigint | null): bigint | null => {
  if (balanceWei === null) {
    return null;
  }
  if (balanceWei < 0n) {
    return null;
  }
  if (balanceWei > PRIVATE_TOKEN_BALANCE_DECRYPT_SANITY_MAX_WEI) {
    return null;
  }
  return balanceWei;
};

export const __normalizeCurrentPrivateTokenBalanceWeiForTest = normalizeCurrentPrivateTokenBalanceWei;

const decryptPrivateTokenBalanceWei = async (
  encryptedValue: unknown,
  signer: JsonRpcSigner
): Promise<bigint | null> => {
  const firstAttempt = await decryptPrivateUintValueWithCurrentAes(encryptedValue, signer);
  return normalizeCurrentPrivateTokenBalanceWei(firstAttempt);
};

export const readCurrentPrivateErc20BalanceWei = async (
  tokenAddress: string,
  ownerAddress: string,
  signer: JsonRpcSigner,
  recoverOnFailure = false
): Promise<bigint | null> => {
  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const privateTokenVNextInterface = new cotiEthers.Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI);
  const legacyPrivateTokenInterface = new cotiEthers.Interface(PRIVATE_ERC20_TOKEN_ABI);
  let encryptedBalanceRaw: unknown = null;

  try {
    const balanceByAddressCallData = privateTokenVNextInterface.encodeFunctionData('balanceOf(address)', [
      ownerAddress
    ]);
    const balanceByAddressRawResult = await readProvider.call({
      from: ownerAddress,
      to: tokenAddress,
      data: balanceByAddressCallData
    });
    const decodedByAddress = privateTokenVNextInterface.decodeFunctionResult(
      'balanceOf(address)',
      balanceByAddressRawResult
    );
    encryptedBalanceRaw = decodedByAddress?.[0] ?? null;
  } catch {
    encryptedBalanceRaw = null;
  }

  if (encryptedBalanceRaw === null) {
    try {
      const legacyBalanceByAddressCallData = legacyPrivateTokenInterface.encodeFunctionData('balanceOf(address)', [
        ownerAddress
      ]);
      const legacyBalanceByAddressRawResult = await readProvider.call({
        from: ownerAddress,
        to: tokenAddress,
        data: legacyBalanceByAddressCallData
      });
      const decodedLegacyByAddress = legacyPrivateTokenInterface.decodeFunctionResult(
        'balanceOf(address)',
        legacyBalanceByAddressRawResult
      );
      encryptedBalanceRaw = decodedLegacyByAddress?.[0] ?? null;
    } catch {
      encryptedBalanceRaw = null;
    }
  }

  if (encryptedBalanceRaw === null) {
    try {
      const legacyBalanceCallData = legacyPrivateTokenInterface.encodeFunctionData('balanceOf()', []);
      const legacyBalanceRawResult = await readProvider.call({
        from: ownerAddress,
        to: tokenAddress,
        data: legacyBalanceCallData
      });
      const decodedLegacyBalance = legacyPrivateTokenInterface.decodeFunctionResult(
        'balanceOf()',
        legacyBalanceRawResult
      );
      encryptedBalanceRaw = decodedLegacyBalance?.[0] ?? null;
    } catch {
      encryptedBalanceRaw = null;
    }
  }

  if (encryptedBalanceRaw === null) {
    return null;
  }

  void recoverOnFailure;
  return decryptPrivateTokenBalanceWei(encryptedBalanceRaw, signer);
};

export const readPrivateTokenBalanceWei = readCurrentPrivateErc20BalanceWei;

export const readPrivateTokenAllowanceWei = async (
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string,
  signer: JsonRpcSigner,
  recoverOnFailure = false
): Promise<bigint | null> => {
  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const privateTokenVNextInterface = new cotiEthers.Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI);
  try {
    const allowanceCallData = privateTokenVNextInterface.encodeFunctionData('allowance(address,address)', [
      ownerAddress,
      spenderAddress
    ]);
    const allowanceRawResult = await readProvider.call({
      from: ownerAddress,
      to: tokenAddress,
      data: allowanceCallData
    });
    const decodedAllowance = privateTokenVNextInterface.decodeFunctionResult(
      'allowance(address,address)',
      allowanceRawResult
    );
    const allowance = decodedAllowance?.[0] as
      | { ownerCiphertext?: unknown; [key: number]: unknown }
      | null
      | undefined;
    const ownerCiphertext = allowance?.ownerCiphertext ?? allowance?.[1] ?? null;
    void recoverOnFailure;
    return decryptPrivateUintValue(ownerCiphertext, signer, false);
  } catch {
    return null;
  }
};

export const resolveTradeAssetSnapshot = async (
  assetTypeRaw: unknown,
  tokenAddressRaw: unknown,
  amountRaw: unknown,
  rewardTokenSymbol: string,
  rewardTokenDecimals: number,
  privateRewardTokenSymbol: string,
  privateRewardTokenDecimals: number
): Promise<TradeAssetPayload> => {
  const assetType = Number(assetTypeRaw);
  const amount = typeof amountRaw === 'bigint' ? amountRaw.toString() : String(amountRaw ?? '0');

  if (assetType === resolveTradeAssetTypeValue('native')) {
    return {
      kind: 'native',
      symbol: TIP_NATIVE_TOKEN_SYMBOL,
      decimals: TIP_NATIVE_TOKEN_DECIMALS,
      amount
    };
  }

  const tokenAddress = String(tokenAddressRaw ?? '').trim();
  const normalizedTokenAddress = isWalletAddress(tokenAddress)
    ? tokenAddress
    : '0x0000000000000000000000000000000000000000';
  const lowerTokenAddress = normalizedTokenAddress.toLowerCase();

  if (lowerTokenAddress === REWARD_TOKEN_ADDRESS.toLowerCase()) {
    return {
      kind: 'erc20',
      tokenAddress: normalizedTokenAddress,
      symbol: rewardTokenSymbol,
      decimals: rewardTokenDecimals,
      amount
    };
  }

  if (lowerTokenAddress === PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()) {
    return {
      kind: 'private-erc20',
      tokenAddress: normalizedTokenAddress,
      symbol: privateRewardTokenSymbol,
      decimals: privateRewardTokenDecimals,
      amount
    };
  }

  const kind: TradeAssetPayload['kind'] =
    assetType === resolveTradeAssetTypeValue('private-erc20') ? 'private-erc20' : 'erc20';

  try {
    const cotiEthers = await loadCotiEthersModule();
    const readProvider = await loadCotiReadProvider(true);
    const tokenContract = new cotiEthers.Contract(
      normalizedTokenAddress,
      kind === 'private-erc20' ? PRIVATE_ERC20_TOKEN_VNEXT_ABI : ERC20_TOKEN_ABI,
      readProvider
    );
    const [symbolRaw, decimalsRaw] = await Promise.all([
      tokenContract.symbol().catch(() => null),
      tokenContract.decimals().catch(() => null)
    ]);

    return {
      kind,
      tokenAddress: normalizedTokenAddress,
      symbol:
        typeof symbolRaw === 'string' && symbolRaw.trim().length > 0
          ? symbolRaw.trim().slice(0, 24)
          : shortenAddress(normalizedTokenAddress),
      decimals: normalizeTokenDecimals(Number(decimalsRaw ?? FALLBACK_REWARD_TOKEN_DECIMALS)),
      amount,
      custom: true
    };
  } catch {
    return {
      kind,
      tokenAddress: normalizedTokenAddress,
      symbol: shortenAddress(normalizedTokenAddress),
      decimals: FALLBACK_REWARD_TOKEN_DECIMALS,
      amount,
      custom: true
    };
  }
};

const approvePrivateTokenSpender = async (
  signer: JsonRpcSigner,
  tokenAddress: string,
  spenderAddress: string,
  currentAllowanceWei: bigint | null = null,
  targetAllowanceWei = PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE,
  policy: PrivateTokenAllowancePolicy = 'maximum'
): Promise<void> => {
  const cotiEthers = await loadCotiEthersModule();
  const privateTokenInterface = new cotiEthers.Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI);
  const writePlan = resolvePrivateTokenAllowanceWritePlan(currentAllowanceWei, targetAllowanceWei, policy);
  if (writePlan.amountWei <= 0n) {
    return;
  }
  const allowanceFunction = privateTokenInterface.getFunction(writePlan.selectorSignature);
  const allowanceSelector = allowanceFunction?.selector;
  if (!allowanceSelector) {
    throw new Error('Unable to prepare private token approval.');
  }

  const encryptedApproval = await encryptPrivateUint256Input(
    signer,
    writePlan.amountWei,
    tokenAddress,
    allowanceSelector
  );
  logMobileWalletDiagnostic('token-approval', {
    tokenKind: 'private-erc20'
  });
  const privateTokenWriteContract = new cotiEthers.Contract(tokenAddress, PRIVATE_ERC20_TOKEN_VNEXT_ABI, signer);
  const writeFunction = privateTokenWriteContract[writePlan.selectorSignature] as {
    (
      spender: string,
      value: unknown,
      overrides: { gasLimit: bigint }
    ): Promise<{ hash?: unknown; wait: () => Promise<unknown> }>;
    estimateGas: (spender: string, value: unknown) => Promise<bigint>;
  };
  let approvalGasLimit = PRIVATE_TOKEN_WRITE_GAS_LIMIT;
  if (policy === 'exact') {
    const estimatedGas = await writeFunction.estimateGas(spenderAddress, encryptedApproval).catch(() => null);
    approvalGasLimit =
      typeof estimatedGas === 'bigint' && estimatedGas > 0n
        ? applyPrivacyPortalGasMargin(estimatedGas)
        : PRIVATE_TOKEN_EXACT_APPROVAL_GAS_FALLBACK;
    const readProvider = await loadCotiReadProvider(true);
    const latestBlock = await readProvider.getBlock('latest').catch(() => null) ?? null;
    if (!latestBlock || approvalGasLimit > latestBlock.gasLimit) {
      throw new Error('The private token approval gas limit exceeds the current COTI block gas limit.');
    }
  }
  const approveTx =
    await writeFunction(spenderAddress, encryptedApproval, {
      gasLimit: approvalGasLimit
    });
  const approveReceipt = await waitForAppChainReceipt(approveTx, 'Private token approval');
  if (!approveReceipt || Number((approveReceipt as { status?: number | bigint }).status ?? 0) !== 1) {
    throw new Error('Private token approval failed on-chain.');
  }
};

export const ensurePrivateTokenExactAllowance = async ({
  signer,
  ownerAddress,
  tokenAddress,
  spenderAddress,
  targetAmountWei,
  tokenSymbol = 'private token',
  onBeforeApproval
}: {
  signer: JsonRpcSigner;
  ownerAddress: string;
  tokenAddress: string;
  spenderAddress: string;
  targetAmountWei: bigint;
  tokenSymbol?: string;
  onBeforeApproval?: () => void;
}): Promise<boolean> => {
  if (!isWalletAddress(ownerAddress) || !isWalletAddress(tokenAddress) || !isWalletAddress(spenderAddress)) {
    throw new Error('The private token approval addresses are invalid.');
  }
  if (targetAmountWei <= 0n || targetAmountWei > PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE) {
    throw new Error('Private token approval amount is outside the supported plaintext range.');
  }

  await assertPrivacyPortalSignerState(signer, ownerAddress);
  const encryptionSetupWrote = await ensurePrivateTokenAccountEncryptionAddress({
    signer,
    tokenAddress,
    ownerAddress,
    tokenSymbol
  });
  if (encryptionSetupWrote) {
    await assertPrivacyPortalSignerState(signer, ownerAddress);
  }

  let currentAllowanceWei = await readPrivateTokenAllowanceWei(
    tokenAddress,
    ownerAddress,
    spenderAddress,
    signer,
    true
  );
  let allowanceRecoveryWrote = false;
  let approvalProgressStarted = false;
  const notifyBeforeApproval = () => {
    if (!approvalProgressStarted) {
      approvalProgressStarted = true;
      onBeforeApproval?.();
    }
  };
  if (currentAllowanceWei === null) {
    await assertPrivacyPortalSignerState(signer, ownerAddress);
    notifyBeforeApproval();
    const cotiEthers = await loadCotiEthersModule();
    const privateTokenWriteContract = new cotiEthers.Contract(
      tokenAddress,
      PRIVATE_ERC20_TOKEN_VNEXT_ABI,
      signer
    );
    const reencryptAllowance = privateTokenWriteContract['reencryptAllowance(address,bool)'] as {
      (
        account: string,
        isSpender: boolean,
        overrides: { gasLimit: bigint }
      ): Promise<{ hash?: unknown; wait: () => Promise<unknown> }>;
      estimateGas: (account: string, isSpender: boolean) => Promise<bigint>;
    };
    const estimatedGas = await reencryptAllowance.estimateGas(spenderAddress, false).catch(() => null);
    const reencryptGasLimit =
      typeof estimatedGas === 'bigint' && estimatedGas > 0n
        ? applyPrivacyPortalGasMargin(estimatedGas)
        : PRIVATE_TOKEN_EXACT_APPROVAL_GAS_FALLBACK;
    const readProvider = await loadCotiReadProvider(true);
    const latestBlock = await readProvider.getBlock('latest').catch(() => null) ?? null;
    if (!latestBlock || reencryptGasLimit > latestBlock.gasLimit) {
      throw new Error('The private token allowance refresh gas limit exceeds the current COTI block gas limit.');
    }
    const reencryptTransaction = await reencryptAllowance(spenderAddress, false, { gasLimit: reencryptGasLimit });
    const reencryptReceipt = await waitForAppChainReceipt(
      reencryptTransaction,
      'Private token allowance refresh'
    );
    assertPrivacyPortalReceipt(reencryptReceipt, 'Private token allowance refresh');
    await assertPrivacyPortalSignerState(signer, ownerAddress);
    allowanceRecoveryWrote = true;
    currentAllowanceWei = await readPrivateTokenAllowanceWei(
      tokenAddress,
      ownerAddress,
      spenderAddress,
      signer,
      true
    );
    if (currentAllowanceWei === null) {
      throw new Error(
        `The app could not decrypt this wallet's private ${tokenSymbol} allowance after refreshing it. Unlock privacy and try again.`
      );
    }
  }
  if (currentAllowanceWei === targetAmountWei) {
    await assertPrivacyPortalSignerState(signer, ownerAddress);
    return allowanceRecoveryWrote;
  }

  await assertPrivacyPortalSignerState(signer, ownerAddress);
  notifyBeforeApproval();
  await approvePrivateTokenSpender(
    signer,
    tokenAddress,
    spenderAddress,
    currentAllowanceWei,
    targetAmountWei,
    'exact'
  );
  await assertPrivacyPortalSignerState(signer, ownerAddress);
  const refreshedAllowanceWei = await readPrivateTokenAllowanceWei(
    tokenAddress,
    ownerAddress,
    spenderAddress,
    signer,
    true
  );
  if (refreshedAllowanceWei === null) {
    throw new Error('Private token approval could not be confirmed after the approval transaction.');
  }
  if (refreshedAllowanceWei !== targetAmountWei) {
    throw new Error('Private token allowance does not match the requested conversion amount after approval.');
  }
  await assertPrivacyPortalSignerState(signer, ownerAddress);
  return true;
};

export const readPrivateTokenAccountEncryptionAddress = async (
  tokenAddress: string,
  ownerAddress: string
): Promise<string | null> => {
  if (!isWalletAddress(tokenAddress) || !isWalletAddress(ownerAddress)) {
    return null;
  }

  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const privateTokenContract = new cotiEthers.Contract(tokenAddress, PRIVATE_ERC20_TOKEN_VNEXT_ABI, readProvider);
  const currentAddress = await privateTokenContract.accountEncryptionAddress(ownerAddress).catch(() => null);
  return typeof currentAddress === 'string' && isWalletAddress(currentAddress) ? currentAddress : null;
};

const PRIVATE_TOKEN_ENCRYPTION_SETUP_CACHE_TTL_MS = 120_000;
const privateTokenEncryptionSetupInFlight = new Map<string, Promise<boolean>>();
const privateTokenEncryptionSetupReadyAt = new Map<string, number>();

const buildPrivateTokenEncryptionSetupKey = (
  tokenAddress: string,
  ownerAddress: string,
  encryptionAddress: string
): string => `${tokenAddress.toLowerCase()}:${ownerAddress.toLowerCase()}:${encryptionAddress.toLowerCase()}`;

export const ensurePrivateTokenAccountEncryptionAddress = async ({
  signer,
  tokenAddress,
  ownerAddress,
  encryptionAddress = ownerAddress,
  tokenSymbol = 'private token'
}: {
  signer: JsonRpcSigner;
  tokenAddress: string;
  ownerAddress: string;
  encryptionAddress?: string;
  tokenSymbol?: string;
}): Promise<boolean> => {
  if (!isWalletAddress(tokenAddress) || !isWalletAddress(ownerAddress) || !isWalletAddress(encryptionAddress)) {
    return false;
  }

  const setupKey = buildPrivateTokenEncryptionSetupKey(tokenAddress, ownerAddress, encryptionAddress);
  const lastReadyAt = privateTokenEncryptionSetupReadyAt.get(setupKey) ?? 0;
  if (lastReadyAt > 0 && Date.now() - lastReadyAt < PRIVATE_TOKEN_ENCRYPTION_SETUP_CACHE_TTL_MS) {
    return false;
  }

  const currentAddress = await readPrivateTokenAccountEncryptionAddress(tokenAddress, ownerAddress).catch(() => null);
  if (currentAddress === null) {
    throw new Error('Private token encryption address could not be read before setup.');
  }
  if (currentAddress?.toLowerCase() === encryptionAddress.toLowerCase()) {
    privateTokenEncryptionSetupReadyAt.set(setupKey, Date.now());
    return false;
  }

  const existingSetup = privateTokenEncryptionSetupInFlight.get(setupKey);
  if (existingSetup) {
    return existingSetup;
  }

  const setupPromise = (async () => {
    await refreshPrivateTokenAccountEncryptionAddress(signer, tokenAddress, encryptionAddress, tokenSymbol);
    privateTokenEncryptionSetupReadyAt.set(setupKey, Date.now());
    return true;
  })();
  privateTokenEncryptionSetupInFlight.set(setupKey, setupPromise);
  try {
    return await setupPromise;
  } finally {
    if (privateTokenEncryptionSetupInFlight.get(setupKey) === setupPromise) {
      privateTokenEncryptionSetupInFlight.delete(setupKey);
    }
  }
};

const refreshPrivateTokenAccountEncryptionAddress = async (
  signer: JsonRpcSigner,
  tokenAddress: string,
  ownerAddress: string,
  tokenSymbol = 'private token'
): Promise<void> => {
  const cotiEthers = await loadCotiEthersModule();
  const privateTokenContract = new cotiEthers.Contract(tokenAddress, PRIVATE_ERC20_TOKEN_VNEXT_ABI, signer);
  const tx = await privateTokenContract.setAccountEncryptionAddress(ownerAddress, {
    gasLimit: PRIVATE_TOKEN_WRITE_GAS_LIMIT
  }).catch((error: unknown) => {
    throw error instanceof Error
      ? error
      : new Error(`Unable to refresh private ${tokenSymbol} balance visibility for this wallet.`);
  });
  const receipt = await waitForAppChainReceipt(tx, `Private ${tokenSymbol} balance visibility refresh`);
  if (!receipt || Number((receipt as { status?: number | bigint }).status ?? 0) !== 1) {
    throw new Error(`Refreshing private ${tokenSymbol} balance visibility failed on-chain.`);
  }
};

export const ensurePrivateTokenSpendReady = async ({
  signer,
  ownerAddress,
  tokenAddress,
  spenderAddress,
  requiredAmount,
  tokenSymbol = 'private token',
  skipBalanceCheck = false
}: {
  signer: JsonRpcSigner;
  ownerAddress: string;
  tokenAddress: string;
  spenderAddress: string;
  requiredAmount: bigint;
  tokenSymbol?: string;
  skipBalanceCheck?: boolean;
}): Promise<void> => {
  if (requiredAmount <= 0n || !isWalletAddress(tokenAddress) || !isWalletAddress(spenderAddress)) {
    return;
  }

  if (requiredAmount > PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE) {
    throw new Error('Private token amount exceeds the maximum plaintext size supported by COTI private ERC-20.');
  }

  await ensurePrivateTokenAccountEncryptionAddress({
    signer,
    tokenAddress,
    ownerAddress,
    tokenSymbol
  });

  let balanceWei = skipBalanceCheck
    ? requiredAmount
    : await readCurrentPrivateErc20BalanceWei(tokenAddress, ownerAddress, signer, true).catch(() => null);
  if (!skipBalanceCheck && balanceWei === null) {
    balanceWei = await readCurrentPrivateErc20BalanceWei(tokenAddress, ownerAddress, signer, true).catch(() => null);
  }
  const allowanceWei = await readPrivateTokenAllowanceWei(
    tokenAddress,
    ownerAddress,
    spenderAddress,
    signer,
    true
  ).catch(() => null);
  const initialReadiness = resolvePrivateTokenSpendReadiness({
    requiredAmountWei: requiredAmount,
    balanceWei,
    allowanceWei,
    tokenSymbol,
    skipBalanceCheck
  });

  if (initialReadiness.status === 'blocked') {
    throw new Error(initialReadiness.message);
  }
  if (initialReadiness.status === 'ready') {
    return;
  }

  await approvePrivateTokenSpender(signer, tokenAddress, spenderAddress, allowanceWei);
  const refreshedAllowanceWei = await readPrivateTokenAllowanceWei(
    tokenAddress,
    ownerAddress,
    spenderAddress,
    signer,
    true
  ).catch(() => null);
  const refreshedReadiness = resolvePrivateTokenSpendReadiness({
    requiredAmountWei: requiredAmount,
    balanceWei,
    allowanceWei: refreshedAllowanceWei,
    tokenSymbol,
    afterApproval: true,
    skipBalanceCheck
  });
  if (refreshedReadiness.status !== 'ready') {
    throw new Error(refreshedReadiness.status === 'blocked' ? refreshedReadiness.message : 'Private token payment is not ready after approval.');
  }
};

export const ensureTradeRequestPaymentReady = async ({
  signer,
  ownerAddress,
  requestAsset,
  requestAmountWei,
  spenderAddress = TRADE_ESCROW_CONTRACT_ADDRESS
}: {
  signer: JsonRpcSigner;
  ownerAddress: string;
  requestAsset: TradeAssetPayload;
  requestAmountWei: bigint;
  spenderAddress?: string;
}): Promise<void> => {
  if (requestAmountWei <= 0n || requestAsset.kind === 'native' || !requestAsset.tokenAddress) {
    return;
  }

  if (requestAsset.kind === 'private-erc20') {
    await ensurePrivateTokenSpendReady({
      signer,
      ownerAddress,
      tokenAddress: requestAsset.tokenAddress,
      spenderAddress,
      requiredAmount: requestAmountWei,
      tokenSymbol: requestAsset.symbol
    });
    return;
  }

  await ensureTradeTokenAllowance(
    signer,
    ownerAddress,
    requestAsset.tokenAddress,
    requestAmountWei,
    requestAsset.kind,
    spenderAddress
  );
};

export const ensureTradeTokenAllowance = async (
  signer: JsonRpcSigner,
  ownerAddress: string,
  tokenAddress: string,
  requiredAmount: bigint,
  kind: Extract<TradeAssetPayload['kind'], 'erc20' | 'private-erc20'> = 'erc20',
  spenderAddress = TRADE_ESCROW_CONTRACT_ADDRESS
): Promise<void> => {
  if (requiredAmount <= 0n || !isWalletAddress(tokenAddress) || !isWalletAddress(spenderAddress)) {
    return;
  }

  if (kind === 'private-erc20') {
    if (requiredAmount > PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE) {
      throw new Error('Private token amount exceeds the maximum plaintext size supported by COTI private ERC-20.');
    }

    await ensurePrivateTokenAccountEncryptionAddress({
      signer,
      tokenAddress,
      ownerAddress
    });

    const allowance = await readPrivateTokenAllowanceWei(
      tokenAddress,
      ownerAddress,
      spenderAddress,
      signer,
      true
    ).catch(() => null);
    if (allowance === null) {
      throw new Error('Private token allowance could not be read before approval.');
    }
    if (allowance >= requiredAmount) {
      return;
    }

    await approvePrivateTokenSpender(signer, tokenAddress, spenderAddress, allowance, requiredAmount, 'exact');
    const refreshedAllowance = await readPrivateTokenAllowanceWei(
      tokenAddress,
      ownerAddress,
      spenderAddress,
      signer,
      true
    ).catch(() => null);
    if (refreshedAllowance === null) {
      throw new Error('Private token approval could not be confirmed after the approval transaction.');
    }
    if (refreshedAllowance !== requiredAmount) {
      throw new Error('Private token allowance does not match the required amount after approval.');
    }
    return;
  }

  const cotiEthers = await loadCotiEthersModule();
  const tokenContract = new cotiEthers.Contract(tokenAddress, ERC20_TOKEN_ABI, signer);
  const allowanceRaw = await tokenContract.allowance(ownerAddress, spenderAddress).catch(() => null);
  if (typeof allowanceRaw !== 'bigint') {
    throw new Error('Public token allowance could not be read before approval.');
  }
  if (allowanceRaw >= requiredAmount) {
    return;
  }

  logMobileWalletDiagnostic('token-approval', {
    tokenKind: 'erc20'
  });
  const approveTx = await tokenContract.approve(spenderAddress, requiredAmount);
  const approveReceipt = await waitForAppChainReceipt(approveTx, 'Public token approval');
  if (!approveReceipt || Number((approveReceipt as { status?: number | bigint }).status ?? 0) !== 1) {
    throw new Error('Public token approval failed on-chain.');
  }
  const refreshedAllowance = await tokenContract.allowance(ownerAddress, spenderAddress).catch((cause: unknown) => {
    const error = new Error('Public token allowance could not be read after approval.');
    Object.defineProperty(error, 'cause', { value: cause });
    throw error;
  });
  if (refreshedAllowance !== requiredAmount) {
    throw new Error('Public token allowance does not match the required amount after approval.');
  }
};

export const ensureTradeFeeTokenAllowance = async (
  signer: JsonRpcSigner,
  ownerAddress: string,
  requiredAmount: bigint
): Promise<void> => {
  if (requiredAmount <= 0n) {
    return;
  }

  const cotiEthers = await loadCotiEthersModule();
  const tradeContract = new cotiEthers.Contract(TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ABI, signer);
  const publicFeeTokenRaw = await tradeContract.publicFeeToken().catch(() => null);
  const publicFeeTokenAddress =
    typeof publicFeeTokenRaw === 'string' && isWalletAddress(publicFeeTokenRaw)
      ? publicFeeTokenRaw
      : REWARD_TOKEN_ADDRESS;
  await ensureTradeTokenAllowance(signer, ownerAddress, publicFeeTokenAddress, requiredAmount);
};

const toPrivacyPortalBigInt = (value: unknown, fallback = 0n): bigint => {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return fallback;
};

const isMissingContractCode = (code: unknown): boolean =>
  typeof code !== 'string' || !/^0x[0-9a-f]+$/i.test(code) || code === '0x' || /^0x0+$/i.test(code);

const addressesMatch = (left: unknown, right: string): boolean =>
  typeof left === 'string' && left.toLowerCase() === right.toLowerCase();

const privacyPortalVerificationCache = new Map<string, PrivacyPairVerification>();

const buildPrivacyPortalVerificationCacheKey = (pair: PrivacyTokenPair): string =>
  [
    pair.chainId,
    pair.id,
    pair.bridgeAddress,
    pair.publicToken.address ?? 'native',
    pair.privateToken.address,
    pair.publicToken.decimals,
    pair.privateToken.decimals
  ].join(':').toLowerCase();

type PrivacyPortalBridgeReadContract = {
  minDepositAmount: () => Promise<unknown>;
  maxDepositAmount: () => Promise<unknown>;
  minWithdrawAmount: () => Promise<unknown>;
  maxWithdrawAmount: () => Promise<unknown>;
  paused: () => Promise<boolean>;
  isDepositEnabled: () => Promise<boolean>;
  blacklisted: (account: string) => Promise<boolean>;
  estimateDepositFee: (amountWei: bigint) => Promise<readonly unknown[]>;
  estimateWithdrawFee: (amountWei: bigint) => Promise<readonly unknown[]>;
  getBridgeBalance?: () => Promise<unknown>;
};

const readPrivacyPortalLimits = async (
  bridgeContract: PrivacyPortalBridgeReadContract
): Promise<PrivacyPortalLimits> => {
  const [minDeposit, maxDeposit, minWithdraw, maxWithdraw] = await Promise.all([
    bridgeContract.minDepositAmount(),
    bridgeContract.maxDepositAmount(),
    bridgeContract.minWithdrawAmount(),
    bridgeContract.maxWithdrawAmount()
  ]);
  return {
    minDepositWei: toPrivacyPortalBigInt(minDeposit),
    maxDepositWei: toPrivacyPortalBigInt(maxDeposit),
    minWithdrawWei: toPrivacyPortalBigInt(minWithdraw),
    maxWithdrawWei: toPrivacyPortalBigInt(maxWithdraw)
  };
};

export const verifyPrivacyPortalPair = async (
  pair: PrivacyTokenPair
): Promise<PrivacyPairVerification> => {
  const cacheKey = buildPrivacyPortalVerificationCacheKey(pair);
  const cached = privacyPortalVerificationCache.get(cacheKey);
  if (cached?.status === 'ready') {
    return cached;
  }
  const issues: PrivacyPairVerificationIssue[] = [];
  let chainId: number | null = null;
  try {
    const officialPair = getPrivacyTokenPair(pair.id);
    if (
      !officialPair ||
      officialPair.chainId !== pair.chainId ||
      officialPair.bridgeKind !== pair.bridgeKind ||
      !addressesMatch(officialPair.bridgeAddress, pair.bridgeAddress) ||
      officialPair.publicToken.decimals !== pair.publicToken.decimals ||
      officialPair.privateToken.decimals !== pair.privateToken.decimals ||
      (officialPair.publicToken.address === null) !== (pair.publicToken.address === null) ||
      (officialPair.publicToken.address !== null &&
        pair.publicToken.address !== null &&
        !addressesMatch(officialPair.publicToken.address, pair.publicToken.address)) ||
      !addressesMatch(officialPair.privateToken.address, pair.privateToken.address)
    ) {
      issues.push('registry-entry-mismatch');
    }
    const [cotiEthers, readProvider] = await Promise.all([
      loadCotiEthersModule(),
      loadCotiReadProvider(true)
    ]);
    const network = await readProvider.getNetwork();
    chainId = Number(network.chainId);
    if (chainId !== pair.chainId || chainId !== COTI_PRIVACY_PORTAL_CHAIN_ID) {
      issues.push('wrong-chain');
    }

    const codeReads = [
      readProvider.getCode(pair.bridgeAddress),
      readProvider.getCode(pair.privateToken.address),
      pair.publicToken.address ? readProvider.getCode(pair.publicToken.address) : Promise.resolve('0x01')
    ] as const;
    const [bridgeCode, privateCode, publicCode] = await Promise.all(codeReads);
    if (isMissingContractCode(bridgeCode)) {
      issues.push('bridge-code-missing');
    }
    if (isMissingContractCode(privateCode)) {
      issues.push('private-token-code-missing');
    }
    if (pair.publicToken.address && isMissingContractCode(publicCode)) {
      issues.push('public-token-code-missing');
    }

    const bridgeContract = new cotiEthers.Contract(
      pair.bridgeAddress,
      pair.bridgeKind === 'native' ? PRIVACY_NATIVE_BRIDGE_ABI : PRIVACY_ERC20_BRIDGE_ABI,
      readProvider
    );
    if (pair.bridgeKind === 'native') {
      const privateAddress = await bridgeContract.privateCoti();
      if (!addressesMatch(privateAddress, pair.privateToken.address)) {
        issues.push('private-token-mismatch');
      }
    } else {
      const [publicAddress, privateAddress] = await Promise.all([
        bridgeContract.token(),
        bridgeContract.privateToken()
      ]);
      if (!pair.publicToken.address || !addressesMatch(publicAddress, pair.publicToken.address)) {
        issues.push('public-token-mismatch');
      }
      if (!addressesMatch(privateAddress, pair.privateToken.address)) {
        issues.push('private-token-mismatch');
      }
    }

    const privateTokenContract = new cotiEthers.Contract(
      pair.privateToken.address,
      PRIVATE_ERC20_TOKEN_VNEXT_ABI,
      readProvider
    );
    const publicDecimalsPromise = pair.publicToken.address
      ? new cotiEthers.Contract(pair.publicToken.address, ERC20_TOKEN_ABI, readProvider).decimals()
      : Promise.resolve(pair.publicToken.decimals);
    const [publicDecimals, privateDecimals] = await Promise.all([
      publicDecimalsPromise,
      privateTokenContract.decimals()
    ]);
    if (Number(publicDecimals) !== pair.publicToken.decimals) {
      issues.push('public-decimals-mismatch');
    }
    if (Number(privateDecimals) !== pair.privateToken.decimals) {
      issues.push('private-decimals-mismatch');
    }

    const verification: PrivacyPairVerification = {
      pairId: pair.id,
      chainId,
      status: issues.length === 0 ? 'ready' : 'mismatch',
      issues,
      verifiedAt: Date.now()
    };
    if (verification.status === 'ready') {
      privacyPortalVerificationCache.set(cacheKey, verification);
    }
    return verification;
  } catch {
    issues.push('verification-read-failed');
    return {
      pairId: pair.id,
      chainId,
      status: 'unavailable',
      issues: Array.from(new Set(issues)),
      verifiedAt: Date.now()
    };
  }
};

export const clearPrivacyPortalVerificationCache = (): void => {
  privacyPortalVerificationCache.clear();
};

const PRIVATE_TVL_FINALITY_LAG_BLOCKS = 5;
const PRIVATE_TVL_MAX_FINALITY_LAG_BLOCKS = 100;

type PrivateTvlBridgeReadContract = {
  totalUserLiability: (overrides: { blockTag: number }) => Promise<unknown>;
  getBridgeBalance?: (overrides: { blockTag: number }) => Promise<unknown>;
  privateCoti?: (overrides: { blockTag: number }) => Promise<unknown>;
  token?: (overrides: { blockTag: number }) => Promise<unknown>;
  privateToken?: (overrides: { blockTag: number }) => Promise<unknown>;
};

type PrivateTvlTokenReadContract = {
  balanceOf: (account: string, overrides: { blockTag: number }) => Promise<unknown>;
  decimals: (overrides: { blockTag: number }) => Promise<unknown>;
};

type PrivateTvlBandReadContract = {
  getReferenceData: (
    base: string,
    quote: string,
    overrides: { blockTag: number }
  ) => Promise<readonly unknown[]>;
};

const requirePrivateTvlAddress = (value: unknown, expected: string, label: string): void => {
  if (!addressesMatch(value, expected)) throw new Error(`${label} does not match the reviewed catalog.`);
};

/**
 * Reads the complete official COTI private-bridge TVL at one recent canonical block.
 * This is keyless and never touches a browser wallet or private balance.
 */
export const readOfficialPrivateTvlSnapshot = async ({
  finalityLagBlocks = PRIVATE_TVL_FINALITY_LAG_BLOCKS,
  maxPriceAgeSeconds = PRIVATE_TVL_DEFAULT_MAX_PRICE_AGE_SECONDS
}: {
  finalityLagBlocks?: number;
  maxPriceAgeSeconds?: string;
} = {}): Promise<PrivateTvlSnapshot> => {
  if (
    !Number.isSafeInteger(finalityLagBlocks) ||
    finalityLagBlocks <= 0 ||
    finalityLagBlocks > PRIVATE_TVL_MAX_FINALITY_LAG_BLOCKS
  ) {
    throw new Error('Private TVL finality lag is invalid.');
  }
  const [cotiEthers, readProvider] = await Promise.all([
    loadCotiEthersModule(),
    loadCotiReadProvider(true)
  ]);
  const initialNetwork = await readProvider.getNetwork();
  if (Number(initialNetwork.chainId) !== COTI_PRIVACY_PORTAL_CHAIN_ID) {
    throw new Error('Private TVL provider is not connected to COTI Mainnet.');
  }
  const latestBlockNumber = await readProvider.getBlockNumber();
  if (!Number.isSafeInteger(latestBlockNumber) || latestBlockNumber <= finalityLagBlocks) {
    throw new Error('Private TVL safe head is unavailable.');
  }
  const safeBlockNumber = latestBlockNumber - finalityLagBlocks;
  const safeBlock = await readProvider.getBlock(safeBlockNumber);
  if (!safeBlock || typeof safeBlock.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(safeBlock.hash)) {
    throw new Error('Private TVL safe-head block is unavailable.');
  }
  const safeBlockHash = safeBlock.hash;
  const blockTimestamp = toPrivacyPortalBigInt(safeBlock.timestamp, -1n);
  if (blockTimestamp <= 0n) throw new Error('Private TVL safe-head timestamp is unavailable.');
  const bandProxyAddress = PRIVATE_TVL_BAND_PROXY_BY_CHAIN_ID[COTI_PRIVACY_PORTAL_CHAIN_ID];
  const codeAddresses = new Set<string>([bandProxyAddress]);
  for (const pair of PRIVACY_TOKEN_PAIRS) {
    codeAddresses.add(pair.bridgeAddress);
    codeAddresses.add(pair.privateToken.address);
    if (pair.publicToken.address) codeAddresses.add(pair.publicToken.address);
  }
  const codeResults = await Promise.all(
    [...codeAddresses].map(async (address) => ({
      address,
      code: await readProvider.getCode(address, safeBlockNumber)
    }))
  );
  for (const { address, code } of codeResults) {
    if (isMissingContractCode(code)) throw new Error(`Private TVL reviewed runtime is missing at ${address}.`);
  }

  const bandContract = new cotiEthers.Contract(
    bandProxyAddress,
    BAND_STANDARD_REFERENCE_ABI,
    readProvider
  ) as unknown as PrivateTvlBandReadContract;
  const observations = await Promise.all(PRIVACY_TOKEN_PAIRS.map(async (pair): Promise<PrivateTvlBridgeObservation> => {
    const bridgeContract = new cotiEthers.Contract(
      pair.bridgeAddress,
      pair.bridgeKind === 'native' ? PRIVACY_NATIVE_BRIDGE_ABI : PRIVACY_ERC20_BRIDGE_ABI,
      readProvider
    ) as unknown as PrivateTvlBridgeReadContract;
    const privateTokenContract = new cotiEthers.Contract(
      pair.privateToken.address,
      PRIVATE_ERC20_TOKEN_VNEXT_ABI,
      readProvider
    ) as unknown as PrivateTvlTokenReadContract;
    const publicTokenContract = pair.publicToken.address
      ? new cotiEthers.Contract(
          pair.publicToken.address,
          ERC20_TOKEN_ABI,
          readProvider
        ) as unknown as PrivateTvlTokenReadContract
      : null;
    const callOptions = { blockTag: safeBlockNumber };
    const [liabilityRaw, privateDecimalsRaw, bandRaw, reserveRaw, publicDecimalsRaw, linkedPublic, linkedPrivate] =
      await Promise.all([
        bridgeContract.totalUserLiability(callOptions),
        privateTokenContract.decimals(callOptions),
        bandContract.getReferenceData(pair.oracleSymbol, 'USD', callOptions),
        pair.bridgeKind === 'native'
          ? bridgeContract.getBridgeBalance
            ? bridgeContract.getBridgeBalance(callOptions)
            : readProvider.getBalance(pair.bridgeAddress, safeBlockNumber)
          : publicTokenContract?.balanceOf(pair.bridgeAddress, callOptions),
        publicTokenContract ? publicTokenContract.decimals(callOptions) : Promise.resolve(pair.publicToken.decimals),
        pair.bridgeKind === 'native'
          ? Promise.resolve(null)
          : bridgeContract.token?.(callOptions),
        pair.bridgeKind === 'native'
          ? bridgeContract.privateCoti?.(callOptions)
          : bridgeContract.privateToken?.(callOptions)
      ]);
    if (reserveRaw === undefined || linkedPrivate === undefined) {
      throw new Error(`Private TVL bridge ${pair.id} is missing a reviewed read surface.`);
    }
    if (pair.bridgeKind === 'erc20') {
      if (!pair.publicToken.address || linkedPublic === undefined) {
        throw new Error(`Private TVL bridge ${pair.id} is missing its public-token relationship.`);
      }
      requirePrivateTvlAddress(linkedPublic, pair.publicToken.address, `Private TVL ${pair.id} public token`);
    }
    requirePrivateTvlAddress(linkedPrivate, pair.privateToken.address, `Private TVL ${pair.id} private token`);
    if (
      Number(toPrivacyPortalBigInt(publicDecimalsRaw, -1n)) !== pair.publicToken.decimals ||
      Number(toPrivacyPortalBigInt(privateDecimalsRaw, -1n)) !== pair.privateToken.decimals
    ) {
      throw new Error(`Private TVL ${pair.id} token decimals do not match the reviewed catalog.`);
    }
    if (!Array.isArray(bandRaw) || bandRaw.length < 3) {
      throw new Error(`Private TVL ${pair.id} Band response is malformed.`);
    }
    return Object.freeze({
      pairId: pair.id,
      chainId: String(pair.chainId),
      bridgeAddress: pair.bridgeAddress,
      blockNumber: String(safeBlockNumber),
      blockHash: safeBlockHash,
      blockTimestamp: blockTimestamp.toString(),
      reserveAtomic: toPrivacyPortalBigInt(reserveRaw).toString(),
      liabilityAtomic: toPrivacyPortalBigInt(liabilityRaw).toString(),
      band: Object.freeze({
        base: pair.oracleSymbol,
        quote: 'USD',
        rateE18: toPrivacyPortalBigInt(bandRaw[0]).toString(),
        lastUpdatedBase: toPrivacyPortalBigInt(bandRaw[1]).toString(),
        lastUpdatedQuote: toPrivacyPortalBigInt(bandRaw[2]).toString()
      })
    });
  }));

  const [finalNetwork, canonicalBlock] = await Promise.all([
    readProvider.getNetwork(),
    readProvider.getBlock(safeBlockNumber)
  ]);
  if (
    Number(finalNetwork.chainId) !== COTI_PRIVACY_PORTAL_CHAIN_ID ||
    canonicalBlock?.hash?.toLowerCase() !== safeBlockHash.toLowerCase()
  ) {
    throw new Error('Private TVL canonical block changed during the read.');
  }
  return buildPrivateTvlSnapshot({ observations, bandProxyAddress, maxPriceAgeSeconds });
};

const requireVerifiedPrivacyPortalPair = async (pair: PrivacyTokenPair): Promise<PrivacyPairVerification> => {
  const verification = await verifyPrivacyPortalPair(pair);
  if (verification.status !== 'ready') {
    const detail = verification.issues.join(', ') || 'verification unavailable';
    throw new Error(`Official privacy bridge verification failed for ${pair.publicToken.symbol}: ${detail}.`);
  }
  return verification;
};

const readPrivacyPortalBridgeLiquidity = async (
  pair: PrivacyTokenPair,
  bridgeContract: PrivacyPortalBridgeReadContract,
  readProvider: Awaited<ReturnType<typeof loadCotiReadProvider>>,
  cotiEthers: Awaited<ReturnType<typeof loadCotiEthersModule>>
): Promise<bigint> => {
  if (pair.bridgeKind === 'native') {
    const bridgeBalance = bridgeContract.getBridgeBalance
      ? await bridgeContract.getBridgeBalance()
      : await readProvider.getBalance(pair.bridgeAddress);
    return toPrivacyPortalBigInt(bridgeBalance);
  }
  if (!pair.publicToken.address) {
    throw new Error('The public token address is missing from the official registry.');
  }
  const publicTokenContract = new cotiEthers.Contract(pair.publicToken.address, ERC20_TOKEN_ABI, readProvider);
  return toPrivacyPortalBigInt(await publicTokenContract.balanceOf(pair.bridgeAddress));
};

export const readPrivacyPortalPairMetrics = async ({
  pair,
  ownerAddress,
  signer
}: {
  pair: PrivacyTokenPair;
  ownerAddress?: string | null;
  signer?: JsonRpcSigner | null;
}): Promise<PrivacyPortalPairMetrics> => {
  const account = typeof ownerAddress === 'string' && isWalletAddress(ownerAddress) ? ownerAddress : null;
  const verification = await requireVerifiedPrivacyPortalPair(pair);
  const [cotiEthers, readProvider] = await Promise.all([
    loadCotiEthersModule(),
    loadCotiReadProvider(true)
  ]);
  const bridgeContract = new cotiEthers.Contract(
    pair.bridgeAddress,
    pair.bridgeKind === 'native' ? PRIVACY_NATIVE_BRIDGE_ABI : PRIVACY_ERC20_BRIDGE_ABI,
    readProvider
  ) as unknown as PrivacyPortalBridgeReadContract;
  const privateTokenContract = new cotiEthers.Contract(
    pair.privateToken.address,
    PRIVATE_ERC20_TOKEN_VNEXT_ABI,
    readProvider
  );
  const publicTokenContract = pair.publicToken.address
    ? new cotiEthers.Contract(pair.publicToken.address, ERC20_TOKEN_ABI, readProvider)
    : null;

  const [
    paused,
    depositEnabled,
    blacklisted,
    limits,
    bridgeLiquidityWei,
    nativeCotiBalance,
    publicBalance,
    publicAllowance,
    privatePublicAmountsEnabled
  ] = await Promise.all([
    bridgeContract.paused(),
    bridgeContract.isDepositEnabled(),
    account ? bridgeContract.blacklisted(account) : Promise.resolve(false),
    readPrivacyPortalLimits(bridgeContract),
    readPrivacyPortalBridgeLiquidity(pair, bridgeContract, readProvider, cotiEthers),
    account ? readProvider.getBalance(account).catch(() => null) : Promise.resolve(null),
    account
      ? publicTokenContract
        ? publicTokenContract.balanceOf(account).catch(() => null)
        : readProvider.getBalance(account).catch(() => null)
      : Promise.resolve(null),
    account && publicTokenContract
      ? publicTokenContract.allowance(account, pair.bridgeAddress).catch(() => null)
      : Promise.resolve(null),
    privateTokenContract.publicAmountsEnabled().catch(() => null)
  ]);

  const signerMatchesAccount = signer && account
    ? await Promise.all([
        signer.getAddress().catch(() => ''),
        signer.provider?.getNetwork().catch(() => null) ?? Promise.resolve(null)
      ]).then(
        ([signerAddress, network]) =>
          signerAddress.toLowerCase() === account.toLowerCase() &&
          Number(network?.chainId ?? 0) === COTI_PRIVACY_PORTAL_CHAIN_ID
      )
    : false;
  const [privateBalanceWei, privateAllowanceWei] = signer && account && signerMatchesAccount
    ? await Promise.all([
        readCurrentPrivateErc20BalanceWei(pair.privateToken.address, account, signer, true).catch(() => null),
        readPrivateTokenAllowanceWei(
          pair.privateToken.address,
          account,
          pair.bridgeAddress,
          signer,
          true
        ).catch(() => null)
      ])
    : [null, null];

  return {
    pairId: pair.id,
    account,
    publicBalanceWei: publicBalance === null ? null : toPrivacyPortalBigInt(publicBalance),
    privateBalanceWei,
    nativeCotiBalanceWei: nativeCotiBalance === null ? null : toPrivacyPortalBigInt(nativeCotiBalance),
    publicAllowanceWei: publicAllowance === null ? null : toPrivacyPortalBigInt(publicAllowance),
    privateAllowanceWei,
    privatePublicAmountsEnabled:
      typeof privatePublicAmountsEnabled === 'boolean' ? privatePublicAmountsEnabled : null,
    paused: Boolean(paused),
    depositEnabled: Boolean(depositEnabled),
    blacklisted: Boolean(blacklisted),
    bridgeLiquidityWei,
    limits,
    verification,
    readAt: Date.now()
  };
};

export const readPrivacyPortalQuote = async ({
  pair,
  direction,
  amountWei,
  ownerAddress = ''
}: {
  pair: PrivacyTokenPair;
  direction: PrivacyDirection;
  amountWei: bigint;
  ownerAddress?: string | null;
}): Promise<PrivacyPortalQuote> => {
  if (amountWei <= 0n) {
    throw new Error('Enter an amount greater than zero before requesting a privacy quote.');
  }
  await requireVerifiedPrivacyPortalPair(pair);
  const [cotiEthers, readProvider] = await Promise.all([
    loadCotiEthersModule(),
    loadCotiReadProvider(true)
  ]);
  const bridgeContract = new cotiEthers.Contract(
    pair.bridgeAddress,
    pair.bridgeKind === 'native' ? PRIVACY_NATIVE_BRIDGE_ABI : PRIVACY_ERC20_BRIDGE_ABI,
    readProvider
  ) as unknown as PrivacyPortalBridgeReadContract;
  const account = typeof ownerAddress === 'string' && isWalletAddress(ownerAddress) ? ownerAddress : '';
  const quotePromise = direction === 'public-to-private'
    ? bridgeContract.estimateDepositFee(amountWei)
    : bridgeContract.estimateWithdrawFee(amountWei);
  const [quoteResult, paused, depositEnabled, limits, bridgeLiquidityWei, blacklisted] = await Promise.all([
    quotePromise,
    bridgeContract.paused(),
    bridgeContract.isDepositEnabled(),
    readPrivacyPortalLimits(bridgeContract),
    readPrivacyPortalBridgeLiquidity(pair, bridgeContract, readProvider, cotiEthers),
    account ? bridgeContract.blacklisted(account) : Promise.resolve(false)
  ]);
  const feeWei = toPrivacyPortalBigInt(quoteResult?.[0]);
  const cotiOracleTimestamp = toPrivacyPortalBigInt(quoteResult?.[1]);
  const tokenOracleTimestamp = pair.bridgeKind === 'native'
    ? cotiOracleTimestamp
    : toPrivacyPortalBigInt(quoteResult?.[2]);
  const blockTimestamp = pair.bridgeKind === 'native'
    ? toPrivacyPortalBigInt(quoteResult?.[2])
    : toPrivacyPortalBigInt(quoteResult?.[3]);
  const minAmountWei = direction === 'public-to-private' ? limits.minDepositWei : limits.minWithdrawWei;
  const maxAmountWei = direction === 'public-to-private' ? limits.maxDepositWei : limits.maxWithdrawWei;
  return {
    quoteKey: buildPrivacyPortalQuoteKey({
      chainId: pair.chainId,
      account,
      pairId: pair.id,
      direction,
      amountWei
    }),
    chainId: COTI_PRIVACY_PORTAL_CHAIN_ID,
    pairId: pair.id,
    direction,
    account,
    amountWei,
    feeWei,
    receiveAmountWei: resolvePrivacyPortalReceiveAmount(pair, direction, amountWei, feeWei),
    cotiOracleTimestamp,
    tokenOracleTimestamp,
    blockTimestamp,
    minAmountWei,
    maxAmountWei,
    paused: Boolean(paused),
    depositEnabled: Boolean(depositEnabled),
    blacklisted: Boolean(blacklisted),
    bridgeLiquidityWei,
    gasEstimate: null,
    gasLimit: null,
    quotedAt: Date.now()
  };
};

const assertPrivacyPortalReceipt = (receipt: unknown, label: string): void => {
  const status = Number((receipt as { status?: number | bigint } | null)?.status ?? 0);
  if (!receipt || status !== 1) {
    throw new Error(`${label} failed on-chain.`);
  }
};

const assertPrivacyPortalSignerState = async (
  signer: JsonRpcSigner,
  expectedAddress: string
): Promise<void> => {
  const actualAddress = await signer.getAddress();
  if (actualAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error('The active wallet account changed during the privacy conversion.');
  }
  const provider = signer.provider;
  if (!provider) {
    throw new Error('The selected signer is not connected to a network provider.');
  }
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== COTI_PRIVACY_PORTAL_CHAIN_ID) {
    throw new Error('Wrong network. Switch to COTI Mainnet and try again.');
  }
};

const ensurePrivacyPortalPublicAllowance = async ({
  signer,
  ownerAddress,
  pair,
  amountWei,
  onProgress
}: {
  signer: JsonRpcSigner;
  ownerAddress: string;
  pair: PrivacyTokenPair;
  amountWei: bigint;
  onProgress?: (stage: PrivacyPortalConversionStage) => void;
}): Promise<boolean> => {
  if (pair.bridgeKind === 'native' || !pair.publicToken.address) {
    return false;
  }
  const cotiEthers = await loadCotiEthersModule();
  const tokenContract = new cotiEthers.Contract(pair.publicToken.address, ERC20_TOKEN_ABI, signer);
  const allowanceWei = toPrivacyPortalBigInt(await tokenContract.allowance(ownerAddress, pair.bridgeAddress));
  if (allowanceWei >= amountWei) {
    return false;
  }
  if (allowanceWei > 0n) {
    onProgress?.('public-approval-reset');
    const resetTransaction = await tokenContract.approve(pair.bridgeAddress, 0n);
    const resetReceipt = await waitForAppChainReceipt(resetTransaction, `${pair.publicToken.symbol} approval reset`);
    assertPrivacyPortalReceipt(resetReceipt, `${pair.publicToken.symbol} approval reset`);
    await assertPrivacyPortalSignerState(signer, ownerAddress);
  }
  onProgress?.('public-approval');
  const approvalTransaction = await tokenContract.approve(pair.bridgeAddress, amountWei);
  const approvalReceipt = await waitForAppChainReceipt(approvalTransaction, `${pair.publicToken.symbol} approval`);
  assertPrivacyPortalReceipt(approvalReceipt, `${pair.publicToken.symbol} approval`);
  await assertPrivacyPortalSignerState(signer, ownerAddress);
  const refreshedAllowanceWei = toPrivacyPortalBigInt(
    await tokenContract.allowance(ownerAddress, pair.bridgeAddress)
  );
  if (refreshedAllowanceWei !== amountWei) {
    throw new Error(`${pair.publicToken.symbol} allowance does not match the requested conversion amount.`);
  }
  return true;
};

const estimatePrivacyPortalConversionGas = async ({
  bridgeContract,
  pair,
  direction,
  amountWei,
  quote
}: {
  bridgeContract: Record<string, unknown>;
  pair: PrivacyTokenPair;
  direction: PrivacyDirection;
  amountWei: bigint;
  quote: PrivacyPortalQuote;
}): Promise<{ gasEstimate: bigint; gasLimit: bigint }> => {
  const call = buildPrivacyPortalTransactionCall(pair, direction, amountWei, quote);
  const method = bridgeContract[call.functionSignature] as {
    estimateGas: (...args: unknown[]) => Promise<bigint>;
  };
  const estimate = await method.estimateGas(
    ...call.args,
    ...(call.valueWei > 0n ? [{ value: call.valueWei }] : [])
  );
  if (typeof estimate !== 'bigint' || estimate <= 0n) {
    throw new Error('The Privacy Portal transaction gas could not be estimated safely.');
  }
  return {
    gasEstimate: estimate,
    gasLimit: applyPrivacyPortalGasMargin(estimate)
  };
};

export const estimatePrivacyPortalQuoteGas = async ({
  signer,
  ownerAddress,
  pair,
  direction,
  amountWei
}: {
  signer: JsonRpcSigner;
  ownerAddress: string;
  pair: PrivacyTokenPair;
  direction: PrivacyDirection;
  amountWei: bigint;
}): Promise<PrivacyPortalGasEstimate> => {
  try {
    if (amountWei <= 0n) {
      throw new Error('Enter an amount greater than zero before estimating gas.');
    }
    await assertPrivacyPortalSignerState(signer, ownerAddress);
    const metrics = await readPrivacyPortalPairMetrics({ pair, ownerAddress, signer });
    if (metrics.paused) {
      throw new Error('BridgePaused');
    }
    if (direction === 'public-to-private' && !metrics.depositEnabled) {
      throw new Error('DepositDisabled');
    }
    if (metrics.blacklisted) {
      throw new Error('AddressBlacklisted');
    }
    if (metrics.nativeCotiBalanceWei === null) {
      throw new Error('Unable to read the selected account COTI balance before estimating gas.');
    }
    if (direction === 'public-to-private' && metrics.publicBalanceWei === null) {
      throw new Error(`Unable to read the ${pair.publicToken.symbol} balance before estimating gas.`);
    }
    if (direction === 'private-to-public' && metrics.privateBalanceWei === null) {
      throw new Error(`Unable to decrypt the ${pair.privateToken.symbol} balance. Unlock privacy and try again.`);
    }
    if (direction === 'private-to-public' && metrics.privatePublicAmountsEnabled === false) {
      throw new Error('This private token does not currently support bridge public-amount transfers.');
    }

    const allowanceRequirement = resolvePrivacyPortalAllowanceRequirement({
      pair,
      direction,
      amountWei,
      publicAllowanceWei: metrics.publicAllowanceWei,
      privateAllowanceWei: metrics.privateAllowanceWei
    });
    if (allowanceRequirement === 'public-allowance-unavailable') {
      throw new Error(`Unable to read the ${pair.publicToken.symbol} bridge allowance.`);
    }
    if (allowanceRequirement === 'public-approval-required') {
      throw new Error(`Approve ${pair.publicToken.symbol} before estimating conversion gas.`);
    }
    if (allowanceRequirement === 'private-allowance-unavailable') {
      throw new Error(`Unable to decrypt the ${pair.privateToken.symbol} bridge allowance. Unlock privacy and try again.`);
    }
    if (allowanceRequirement === 'private-approval-required') {
      throw new Error(`Approve ${pair.privateToken.symbol} before estimating conversion gas.`);
    }

    const quote = await readPrivacyPortalQuote({ pair, direction, amountWei, ownerAddress });
    if (quote.paused || (direction === 'public-to-private' && !quote.depositEnabled) || quote.blacklisted) {
      throw new Error('The bridge status changed before gas estimation. Refresh and try again.');
    }
    const balanceWei = direction === 'public-to-private'
      ? metrics.publicBalanceWei
      : metrics.privateBalanceWei;
    const amountIssues = validatePrivacyPortalAmount({
      amountWei,
      minAmountWei: quote.minAmountWei,
      maxAmountWei: quote.maxAmountWei,
      balanceWei,
      bridgeLiquidityWei: quote.bridgeLiquidityWei,
      direction,
      feeWei: quote.feeWei,
      nativeCotiBalanceWei: metrics.nativeCotiBalanceWei,
      bridgeKind: pair.bridgeKind
    });
    if (amountIssues.length > 0) {
      throw new Error(getPrivacyPortalAmountIssueMessage(amountIssues[0]));
    }

    const cotiEthers = await loadCotiEthersModule();
    const bridgeContract = new cotiEthers.Contract(
      pair.bridgeAddress,
      pair.bridgeKind === 'native' ? PRIVACY_NATIVE_BRIDGE_ABI : PRIVACY_ERC20_BRIDGE_ABI,
      signer
    ) as unknown as Record<string, unknown>;
    const { gasEstimate, gasLimit } = await estimatePrivacyPortalConversionGas({
      bridgeContract,
      pair,
      direction,
      amountWei,
      quote
    });
    const provider = await loadCotiReadProvider(true);
    const [feeData, latestBlock] = await Promise.all([
      provider.getFeeData(),
      provider.getBlock('latest')
    ]);
    if (!latestBlock || gasLimit > latestBlock.gasLimit) {
      throw new Error('The required gas limit exceeds the current COTI block gas limit.');
    }
    const gasPriceWei = feeData.maxFeePerGas ?? feeData.gasPrice;
    if (gasPriceWei === null || gasPriceWei < 0n) {
      throw new Error('The current COTI gas price is unavailable.');
    }
    const gasCostWei = calculatePrivacyPortalGasReserveWei(gasLimit, gasPriceWei);
    const bridgeValueWei = pair.bridgeKind === 'erc20'
      ? quote.feeWei
      : direction === 'public-to-private'
        ? amountWei
        : 0n;
    if (metrics.nativeCotiBalanceWei < bridgeValueWei + gasCostWei) {
      throw new Error('Insufficient funds for the conversion value, portal fee, and gas.');
    }
    await assertPrivacyPortalSignerState(signer, ownerAddress);
    return {
      quote: {
        ...quote,
        gasEstimate,
        gasLimit
      },
      gasEstimate,
      gasLimit,
      gasPriceWei,
      gasCostWei,
      estimatedAt: Date.now()
    };
  } catch (error) {
    throw normalizePrivacyPortalError(error);
  }
};

export const estimatePrivacyPortalNativeDepositGasReserveWei = async ({
  signer,
  ownerAddress,
  pair,
  amountWei
}: {
  signer: JsonRpcSigner;
  ownerAddress: string;
  pair: PrivacyTokenPair;
  amountWei: bigint;
}): Promise<bigint> => {
  try {
    if (pair.bridgeKind !== 'native') {
      throw new Error('Native COTI gas reserve estimation requires the official COTI pair.');
    }
    if (amountWei <= 0n) {
      return 0n;
    }
    await assertPrivacyPortalSignerState(signer, ownerAddress);
    const provider = await loadCotiReadProvider(true);
    const [quote, feeData, latestBlock, nativeBalanceWei] = await Promise.all([
      readPrivacyPortalQuote({
        pair,
        direction: 'public-to-private',
        amountWei,
        ownerAddress
      }),
      provider.getFeeData(),
      provider.getBlock('latest'),
      provider.getBalance(ownerAddress)
    ]);
    if (quote.paused || !quote.depositEnabled || quote.blacklisted) {
      throw new Error('The native COTI privacy bridge is not currently available for this account.');
    }
    if (!latestBlock) {
      throw new Error('The current COTI block gas limit is unavailable.');
    }
    const gasPriceWei = feeData.maxFeePerGas ?? feeData.gasPrice;
    if (gasPriceWei === null || gasPriceWei < 0n) {
      throw new Error('The current COTI gas price is unavailable.');
    }
    if (gasPriceWei === 0n) {
      await assertPrivacyPortalSignerState(signer, ownerAddress);
      return 0n;
    }
    const cotiEthers = await loadCotiEthersModule();
    const bridgeContract = new cotiEthers.Contract(
      pair.bridgeAddress,
      PRIVACY_NATIVE_BRIDGE_ABI,
      signer
    ) as unknown as Record<string, unknown>;
    let gasLimit: bigint;
    try {
      ({ gasLimit } = await estimatePrivacyPortalConversionGas({
        bridgeContract,
        pair,
        direction: 'public-to-private',
        amountWei,
        quote
      }));
    } catch (estimateError) {
      const normalizedMessage = normalizePrivacyPortalError(estimateError).message;
      if (!/not enough coti|insufficient.*(?:fund|balance)|gas.*allowance|exceeds.*balance/i.test(normalizedMessage)) {
        throw estimateError;
      }
      const safeProbeAmountWei = selectPrivacyPortalNativeGasProbeAmount({
        requestedAmountWei: amountWei,
        balanceWei: nativeBalanceWei,
        minAmountWei: quote.minAmountWei,
        maxAmountWei: quote.maxAmountWei,
        quotedFeeWei: quote.feeWei,
        headroomWei: calculatePrivacyPortalGasReserveWei(latestBlock.gasLimit, gasPriceWei)
      });
      if (safeProbeAmountWei === null || safeProbeAmountWei === amountWei) {
        throw estimateError;
      }
      const probeQuote = await readPrivacyPortalQuote({
        pair,
        direction: 'public-to-private',
        amountWei: safeProbeAmountWei,
        ownerAddress
      });
      ({ gasLimit } = await estimatePrivacyPortalConversionGas({
        bridgeContract,
        pair,
        direction: 'public-to-private',
        amountWei: safeProbeAmountWei,
        quote: probeQuote
      }));
    }
    if (gasLimit > latestBlock.gasLimit) {
      throw new Error('The required gas limit exceeds the current COTI block gas limit.');
    }
    await assertPrivacyPortalSignerState(signer, ownerAddress);
    return calculatePrivacyPortalGasReserveWei(gasLimit, gasPriceWei);
  } catch (error) {
    throw normalizePrivacyPortalError(error);
  }
};

const submitPrivacyPortalConversion = async ({
  bridgeContract,
  pair,
  direction,
  amountWei,
  quote,
  gasLimit
}: {
  bridgeContract: Record<string, unknown>;
  pair: PrivacyTokenPair;
  direction: PrivacyDirection;
  amountWei: bigint;
  quote: PrivacyPortalQuote;
  gasLimit: bigint;
}): Promise<{ hash?: string; wait: () => Promise<unknown> }> => {
  const call = buildPrivacyPortalTransactionCall(pair, direction, amountWei, quote);
  const method = bridgeContract[call.functionSignature] as (...args: unknown[]) => Promise<{
    hash?: string;
    wait: () => Promise<unknown>;
  }>;
  return method(...call.args, {
    ...(call.valueWei > 0n ? { value: call.valueWei } : {}),
    gasLimit
  });
};

export const executePrivacyPortalConversion = async ({
  signer,
  ownerAddress,
  pair,
  direction,
  amountWei,
  onProgress
}: {
  signer: JsonRpcSigner;
  ownerAddress: string;
  pair: PrivacyTokenPair;
  direction: PrivacyDirection;
  amountWei: bigint;
  onProgress?: (stage: PrivacyPortalConversionStage) => void;
}): Promise<PrivacyPortalConversionResult> => {
  try {
    onProgress?.('validating');
    if (!isWalletAddress(ownerAddress)) {
      throw new Error('A valid account is required for a privacy conversion.');
    }
    if (amountWei <= 0n) {
      throw new Error('Enter an amount greater than zero.');
    }
    await assertPrivacyPortalSignerState(signer, ownerAddress);
    await requireVerifiedPrivacyPortalPair(pair);

    const metrics = await readPrivacyPortalPairMetrics({ pair, ownerAddress, signer });
    if (metrics.paused) {
      throw new Error('BridgePaused');
    }
    if (direction === 'public-to-private' && !metrics.depositEnabled) {
      throw new Error('DepositDisabled');
    }
    if (metrics.blacklisted) {
      throw new Error('AddressBlacklisted');
    }
    if (metrics.nativeCotiBalanceWei === null) {
      throw new Error('Unable to read the selected account COTI balance. Refresh before converting.');
    }
    if (direction === 'public-to-private' && metrics.publicBalanceWei === null) {
      throw new Error(`Unable to read the ${pair.publicToken.symbol} balance. Refresh before converting.`);
    }
    if (direction === 'private-to-public' && metrics.privateBalanceWei === null) {
      throw new Error(`Unable to decrypt the ${pair.privateToken.symbol} balance. Unlock privacy and try again.`);
    }
    if (direction === 'private-to-public' && metrics.privatePublicAmountsEnabled === false) {
      throw new Error('This private token does not currently support bridge public-amount transfers.');
    }

    const initialQuote = await readPrivacyPortalQuote({ pair, direction, amountWei, ownerAddress });
    const balanceWei = direction === 'public-to-private'
      ? metrics.publicBalanceWei
      : metrics.privateBalanceWei;
    const issues = validatePrivacyPortalAmount({
      amountWei,
      minAmountWei: initialQuote.minAmountWei,
      maxAmountWei: initialQuote.maxAmountWei,
      balanceWei,
      bridgeLiquidityWei: initialQuote.bridgeLiquidityWei,
      direction,
      feeWei: initialQuote.feeWei,
      nativeCotiBalanceWei: metrics.nativeCotiBalanceWei,
      bridgeKind: pair.bridgeKind
    });
    if (issues.length > 0) {
      throw new Error(getPrivacyPortalAmountIssueMessage(issues[0]));
    }

    if (direction === 'public-to-private') {
      await ensurePrivacyPortalPublicAllowance({
        signer,
        ownerAddress,
        pair,
        amountWei,
        onProgress
      });
    } else {
      await ensurePrivateTokenExactAllowance({
        signer,
        ownerAddress,
        tokenAddress: pair.privateToken.address,
        spenderAddress: pair.bridgeAddress,
        targetAmountWei: amountWei,
        tokenSymbol: pair.privateToken.symbol,
        onBeforeApproval: () => onProgress?.('private-approval')
      });
      await assertPrivacyPortalSignerState(signer, ownerAddress);
    }

    onProgress?.('refreshing-quote');
    const quote = await readPrivacyPortalQuote({ pair, direction, amountWei, ownerAddress });
    if (quote.paused || (direction === 'public-to-private' && !quote.depositEnabled) || quote.blacklisted) {
      throw new Error('The bridge status changed while preparing the transaction. Refresh and try again.');
    }
    const refreshedIssues = validatePrivacyPortalAmount({
      amountWei,
      minAmountWei: quote.minAmountWei,
      maxAmountWei: quote.maxAmountWei,
      balanceWei,
      bridgeLiquidityWei: quote.bridgeLiquidityWei,
      direction,
      feeWei: quote.feeWei,
      nativeCotiBalanceWei: metrics.nativeCotiBalanceWei,
      bridgeKind: pair.bridgeKind
    });
    if (refreshedIssues.length > 0) {
      throw new Error(getPrivacyPortalAmountIssueMessage(refreshedIssues[0]));
    }

    const cotiEthers = await loadCotiEthersModule();
    const bridgeContract = new cotiEthers.Contract(
      pair.bridgeAddress,
      pair.bridgeKind === 'native' ? PRIVACY_NATIVE_BRIDGE_ABI : PRIVACY_ERC20_BRIDGE_ABI,
      signer
    ) as unknown as Record<string, unknown>;
    const { gasEstimate, gasLimit } = await estimatePrivacyPortalConversionGas({
      bridgeContract,
      pair,
      direction,
      amountWei,
      quote
    });
    const provider = await loadCotiReadProvider(true);
    const [latestBlock, feeData, latestNativeBalance] = await Promise.all([
      provider.getBlock('latest'),
      provider.getFeeData(),
      provider.getBalance(ownerAddress)
    ]);
    if (!latestBlock || gasLimit > latestBlock.gasLimit) {
      throw new Error('The required gas limit exceeds the current COTI block gas limit.');
    }
    const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
    if (gasPrice === null || gasPrice < 0n) {
      throw new Error('The current COTI gas price is unavailable.');
    }
    const bridgeValue = pair.bridgeKind === 'erc20'
      ? quote.feeWei
      : direction === 'public-to-private'
        ? amountWei
        : 0n;
    if (latestNativeBalance < bridgeValue + gasLimit * gasPrice) {
      throw new Error('Insufficient funds for the conversion value, portal fee, and gas.');
    }

    await assertPrivacyPortalSignerState(signer, ownerAddress);
    onProgress?.('awaiting-conversion');
    const transaction = await submitPrivacyPortalConversion({
      bridgeContract,
      pair,
      direction,
      amountWei,
      quote,
      gasLimit
    });
    onProgress?.('confirming');
    const receipt = await waitForAppChainReceipt(transaction, 'Privacy conversion');
    assertPrivacyPortalReceipt(receipt, 'Privacy conversion');
    onProgress?.('complete');
    return {
      transactionHash:
        transaction.hash ?? String((receipt as { hash?: unknown } | null)?.hash ?? ''),
      receipt,
      quote: {
        ...quote,
        gasEstimate,
        gasLimit
      },
      gasLimit
    };
  } catch (error) {
    throw normalizePrivacyPortalError(error);
  }
};

type ChainWhisperWispBridgeReadContract = {
  token: () => Promise<string>;
  privateToken: () => Promise<string>;
  paused: () => Promise<boolean>;
  isDepositEnabled: () => Promise<boolean>;
  minDepositAmount: () => Promise<bigint>;
  maxDepositAmount: () => Promise<bigint>;
  minWithdrawAmount: () => Promise<bigint>;
  maxWithdrawAmount: () => Promise<bigint>;
  blacklisted: (account: string) => Promise<boolean>;
  nativeCotiFee: () => Promise<bigint>;
  publicReserve: () => Promise<bigint>;
  estimateDepositFee: (amountWei: bigint) => Promise<unknown>;
  estimateWithdrawFee: (amountWei: bigint) => Promise<unknown>;
};

type ChainWhisperWispPublicTokenContract = {
  balanceOf: (account: string) => Promise<unknown>;
  allowance: (owner: string, spender: string) => Promise<unknown>;
  approve: (
    spender: string,
    amountWei: bigint
  ) => Promise<{ hash?: unknown; wait: () => Promise<unknown> }>;
};

const chainWhisperWispVerificationCache = new Map<string, ChainWhisperWispVerification>();

export const clearChainWhisperWispVerificationCache = (): void => {
  chainWhisperWispVerificationCache.clear();
};

export const verifyChainWhisperWispBridge = async (): Promise<ChainWhisperWispVerification> => {
  const cached = chainWhisperWispVerificationCache.get(CHAINWHISPER_WISP_BRIDGE_PAIR.bridgeAddress.toLowerCase());
  if (cached?.status === 'ready') {
    return cached;
  }
  const issues: ChainWhisperWispVerificationIssue[] = [];
  let chainId: number | null = null;
  try {
    const [cotiEthers, readProvider] = await Promise.all([
      loadCotiEthersModule(),
      loadCotiReadProvider(true)
    ]);
    const network = await readProvider.getNetwork();
    chainId = Number(network.chainId);
    if (chainId !== CHAINWHISPER_WISP_BRIDGE_PAIR.chainId) {
      issues.push('wrong-chain');
    }
    const [bridgeCode, publicCode, privateCode] = await Promise.all([
      readProvider.getCode(CHAINWHISPER_WISP_BRIDGE_PAIR.bridgeAddress),
      readProvider.getCode(CHAINWHISPER_WISP_BRIDGE_PAIR.publicTokenAddress),
      readProvider.getCode(CHAINWHISPER_WISP_BRIDGE_PAIR.privateTokenAddress)
    ]);
    if (isMissingContractCode(bridgeCode)) {
      issues.push('bridge-code-missing');
    }
    if (isMissingContractCode(publicCode)) {
      issues.push('public-token-code-missing');
    }
    if (isMissingContractCode(privateCode)) {
      issues.push('private-token-code-missing');
    }

    const bridgeContract = new cotiEthers.Contract(
      CHAINWHISPER_WISP_BRIDGE_PAIR.bridgeAddress,
      WISP_PRIVACY_BRIDGE_CONTRACT_ABI,
      readProvider
    ) as unknown as ChainWhisperWispBridgeReadContract;
    const publicTokenContract = new cotiEthers.Contract(
      CHAINWHISPER_WISP_BRIDGE_PAIR.publicTokenAddress,
      ERC20_TOKEN_ABI,
      readProvider
    );
    const privateTokenContract = new cotiEthers.Contract(
      CHAINWHISPER_WISP_BRIDGE_PAIR.privateTokenAddress,
      PRIVATE_ERC20_TOKEN_VNEXT_ABI,
      readProvider
    );
    const [configuredPublicToken, configuredPrivateToken, publicDecimals, privateDecimals] = await Promise.all([
      bridgeContract.token(),
      bridgeContract.privateToken(),
      publicTokenContract.decimals(),
      privateTokenContract.decimals()
    ]);
    if (!addressesMatch(configuredPublicToken, CHAINWHISPER_WISP_BRIDGE_PAIR.publicTokenAddress)) {
      issues.push('public-token-mismatch');
    }
    if (!addressesMatch(configuredPrivateToken, CHAINWHISPER_WISP_BRIDGE_PAIR.privateTokenAddress)) {
      issues.push('private-token-mismatch');
    }
    if (Number(publicDecimals) !== CHAINWHISPER_WISP_BRIDGE_PAIR.decimals) {
      issues.push('public-decimals-mismatch');
    }
    if (Number(privateDecimals) !== CHAINWHISPER_WISP_BRIDGE_PAIR.decimals) {
      issues.push('private-decimals-mismatch');
    }

    const verification: ChainWhisperWispVerification = {
      status: issues.length === 0 ? 'ready' : 'mismatch',
      chainId,
      issues,
      verifiedAt: Date.now()
    };
    if (verification.status === 'ready') {
      chainWhisperWispVerificationCache.set(
        CHAINWHISPER_WISP_BRIDGE_PAIR.bridgeAddress.toLowerCase(),
        verification
      );
    }
    return verification;
  } catch {
    issues.push('verification-read-failed');
    return {
      status: 'unavailable',
      chainId,
      issues: Array.from(new Set(issues)),
      verifiedAt: Date.now()
    };
  }
};

const requireVerifiedChainWhisperWispBridge = async (): Promise<void> => {
  const verification = await verifyChainWhisperWispBridge();
  if (verification.status !== 'ready') {
    throw new Error(
      `ChainWhisper WISP bridge verification failed: ${verification.issues.join(', ') || 'unavailable'}.`
    );
  }
};

const assertChainWhisperWispQuoteUsable = (quote: ChainWhisperWispQuote): void => {
  const issue = validateChainWhisperWispStatus(quote)[0];
  if (issue) {
    throw new Error(getChainWhisperWispStatusIssueMessage(issue));
  }
};

export const readChainWhisperWispBridgeQuote = async ({
  ownerAddress,
  direction,
  amountWei
}: {
  ownerAddress: string;
  direction: ChainWhisperWispDirection;
  amountWei: bigint;
}): Promise<ChainWhisperWispQuote> => {
  if (!isWalletAddress(ownerAddress)) {
    throw new Error('A valid account is required for a ChainWhisper WISP quote.');
  }
  if (amountWei <= 0n) {
    throw new Error('Enter a WISP amount greater than zero.');
  }
  await requireVerifiedChainWhisperWispBridge();
  const [cotiEthers, readProvider] = await Promise.all([
    loadCotiEthersModule(),
    loadCotiReadProvider(true)
  ]);
  const bridgeContract = new cotiEthers.Contract(
    CHAINWHISPER_WISP_BRIDGE_PAIR.bridgeAddress,
    WISP_PRIVACY_BRIDGE_CONTRACT_ABI,
    readProvider
  ) as unknown as ChainWhisperWispBridgeReadContract;
  const privateTokenContract = new cotiEthers.Contract(
    CHAINWHISPER_WISP_BRIDGE_PAIR.privateTokenAddress,
    PRIVATE_ERC20_TOKEN_VNEXT_ABI,
    readProvider
  );
  const quotePromise = direction === 'shield'
    ? bridgeContract.estimateDepositFee(amountWei)
    : bridgeContract.estimateWithdrawFee(amountWei);
  const [
    rawFeeQuote,
    nativeCotiFee,
    paused,
    depositEnabled,
    minDeposit,
    maxDeposit,
    minWithdraw,
    maxWithdraw,
    blacklisted,
    publicReserve,
    privatePublicAmountsEnabled
  ] = await Promise.all([
    quotePromise,
    bridgeContract.nativeCotiFee(),
    bridgeContract.paused(),
    bridgeContract.isDepositEnabled(),
    bridgeContract.minDepositAmount(),
    bridgeContract.maxDepositAmount(),
    bridgeContract.minWithdrawAmount(),
    bridgeContract.maxWithdrawAmount(),
    bridgeContract.blacklisted(ownerAddress),
    bridgeContract.publicReserve(),
    privateTokenContract.publicAmountsEnabled()
  ]);
  const parsedQuote = parseChainWhisperWispFeeQuote(rawFeeQuote);
  if (!parsedQuote) {
    throw new Error('The ChainWhisper WISP bridge returned an invalid fee quote.');
  }
  if (parsedQuote.feeWei !== nativeCotiFee) {
    throw new Error('The ChainWhisper WISP bridge fee changed while quoting. Refresh and try again.');
  }
  const minAmountWei = direction === 'shield' ? minDeposit : minWithdraw;
  const maxAmountWei = direction === 'shield' ? maxDeposit : maxWithdraw;
  return {
    quoteKey: buildChainWhisperWispQuoteKey({ account: ownerAddress, direction, amountWei }),
    direction,
    account: ownerAddress,
    amountWei,
    ...parsedQuote,
    minAmountWei,
    maxAmountWei,
    publicReserveWei: publicReserve,
    paused,
    depositEnabled,
    privatePublicAmountsEnabled: Boolean(privatePublicAmountsEnabled),
    blacklisted,
    quotedAt: Date.now()
  };
};

const readChainWhisperWispInputBalance = async ({
  direction,
  ownerAddress,
  signer,
  publicTokenContract
}: {
  direction: ChainWhisperWispDirection;
  ownerAddress: string;
  signer: JsonRpcSigner;
  publicTokenContract: Pick<ChainWhisperWispPublicTokenContract, 'balanceOf'>;
}): Promise<bigint | null> => {
  if (direction === 'shield') {
    const value = await publicTokenContract.balanceOf(ownerAddress).catch(() => null);
    return typeof value === 'bigint' ? value : null;
  }
  return readCurrentPrivateErc20BalanceWei(
    CHAINWHISPER_WISP_BRIDGE_PAIR.privateTokenAddress,
    ownerAddress,
    signer,
    true
  ).catch(() => null);
};

export const executeChainWhisperWispBridgeConversion = async ({
  signer,
  ownerAddress,
  direction,
  amountWei,
  onProgress
}: {
  signer: JsonRpcSigner;
  ownerAddress: string;
  direction: ChainWhisperWispDirection;
  amountWei: bigint;
  onProgress?: (stage: ChainWhisperWispStage) => void;
}): Promise<ChainWhisperWispConversionResult> => {
  try {
    onProgress?.('validating');
    if (!isWalletAddress(ownerAddress)) {
      throw new Error('A valid account is required for a ChainWhisper WISP conversion.');
    }
    if (amountWei <= 0n) {
      throw new Error('Enter a WISP amount greater than zero.');
    }
    await assertPrivacyPortalSignerState(signer, ownerAddress);
    await requireVerifiedChainWhisperWispBridge();

    const cotiEthers = await loadCotiEthersModule();
    const provider = await loadCotiReadProvider(true);
    const publicTokenContract = new cotiEthers.Contract(
      CHAINWHISPER_WISP_BRIDGE_PAIR.publicTokenAddress,
      ERC20_TOKEN_ABI,
      signer
    ) as unknown as ChainWhisperWispPublicTokenContract;
    const [initialQuote, initialInputBalanceWei, initialNativeBalanceWei] = await Promise.all([
      readChainWhisperWispBridgeQuote({ ownerAddress, direction, amountWei }),
      readChainWhisperWispInputBalance({
        direction,
        ownerAddress,
        signer,
        publicTokenContract
      }),
      provider.getBalance(ownerAddress).catch(() => null)
    ]);
    assertChainWhisperWispQuoteUsable(initialQuote);
    const initialIssues = validateChainWhisperWispAmount({
      direction,
      amountWei,
      minAmountWei: initialQuote.minAmountWei,
      maxAmountWei: initialQuote.maxAmountWei,
      balanceWei: initialInputBalanceWei,
      publicReserveWei: initialQuote.publicReserveWei,
      nativeBalanceWei: initialNativeBalanceWei,
      feeWei: initialQuote.feeWei
    });
    if (initialIssues.length > 0) {
      throw new Error(getChainWhisperWispAmountIssueMessage(initialIssues[0]));
    }

    if (direction === 'shield') {
      const currentAllowanceRaw = await publicTokenContract.allowance(
        ownerAddress,
        CHAINWHISPER_WISP_BRIDGE_PAIR.bridgeAddress
      );
      if (typeof currentAllowanceRaw !== 'bigint') {
        throw new Error('Unable to read the WISP bridge allowance.');
      }
      const approvalAmounts = resolveChainWhisperWispPublicApprovalAmounts(currentAllowanceRaw, amountWei);
      for (const approvalAmount of approvalAmounts) {
        onProgress?.(approvalAmount === 0n ? 'public-approval-reset' : 'public-approval');
        const approvalTransaction = await publicTokenContract.approve(
          CHAINWHISPER_WISP_BRIDGE_PAIR.bridgeAddress,
          approvalAmount
        );
        const approvalReceipt = await waitForAppChainReceipt(approvalTransaction, 'WISP approval');
        assertPrivacyPortalReceipt(approvalReceipt, 'WISP approval');
        await assertPrivacyPortalSignerState(signer, ownerAddress);
      }
      if (approvalAmounts.length > 0) {
        const refreshedAllowanceRaw = await publicTokenContract.allowance(
          ownerAddress,
          CHAINWHISPER_WISP_BRIDGE_PAIR.bridgeAddress
        );
        if (refreshedAllowanceRaw !== amountWei) {
          throw new Error('WISP allowance does not match the requested shield amount after approval.');
        }
      }
    } else {
      await ensurePrivateTokenExactAllowance({
        signer,
        ownerAddress,
        tokenAddress: CHAINWHISPER_WISP_BRIDGE_PAIR.privateTokenAddress,
        spenderAddress: CHAINWHISPER_WISP_BRIDGE_PAIR.bridgeAddress,
        targetAmountWei: amountWei,
        tokenSymbol: CHAINWHISPER_WISP_BRIDGE_PAIR.privateSymbol,
        onBeforeApproval: () => onProgress?.('private-approval')
      });
    }

    onProgress?.('refreshing-quote');
    await assertPrivacyPortalSignerState(signer, ownerAddress);
    const [quote, inputBalanceWei, nativeBalanceWei] = await Promise.all([
      readChainWhisperWispBridgeQuote({ ownerAddress, direction, amountWei }),
      readChainWhisperWispInputBalance({
        direction,
        ownerAddress,
        signer,
        publicTokenContract
      }),
      provider.getBalance(ownerAddress).catch(() => null)
    ]);
    assertChainWhisperWispQuoteUsable(quote);
    const refreshedIssues = validateChainWhisperWispAmount({
      direction,
      amountWei,
      minAmountWei: quote.minAmountWei,
      maxAmountWei: quote.maxAmountWei,
      balanceWei: inputBalanceWei,
      publicReserveWei: quote.publicReserveWei,
      nativeBalanceWei,
      feeWei: quote.feeWei
    });
    if (refreshedIssues.length > 0) {
      throw new Error(getChainWhisperWispAmountIssueMessage(refreshedIssues[0]));
    }

    const bridgeContract = new cotiEthers.Contract(
      CHAINWHISPER_WISP_BRIDGE_PAIR.bridgeAddress,
      WISP_PRIVACY_BRIDGE_CONTRACT_ABI,
      signer
    ) as unknown as Record<string, unknown>;
    const call = buildChainWhisperWispCall(direction, amountWei, quote);
    const writeMethod = bridgeContract[call.functionSignature] as {
      (...args: unknown[]): Promise<{ hash?: string; wait: () => Promise<unknown> }>;
      estimateGas: (...args: unknown[]) => Promise<bigint>;
    };
    const gasEstimate = await writeMethod.estimateGas(...call.args, { value: call.valueWei });
    if (typeof gasEstimate !== 'bigint' || gasEstimate <= 0n) {
      throw new Error('The ChainWhisper WISP bridge gas could not be estimated safely.');
    }
    const gasLimit = applyPrivacyPortalGasMargin(gasEstimate);
    const [latestBlock, feeData, latestNativeBalanceWei] = await Promise.all([
      provider.getBlock('latest'),
      provider.getFeeData(),
      provider.getBalance(ownerAddress)
    ]);
    if (!latestBlock || gasLimit > latestBlock.gasLimit) {
      throw new Error('The ChainWhisper WISP transaction exceeds the current COTI block gas limit.');
    }
    const gasPriceWei = feeData.maxFeePerGas ?? feeData.gasPrice;
    if (gasPriceWei === null || gasPriceWei < 0n) {
      throw new Error('The current COTI gas price is unavailable.');
    }
    if (latestNativeBalanceWei < quote.feeWei + gasLimit * gasPriceWei) {
      throw new Error('Insufficient funds for the ChainWhisper bridge fee and gas.');
    }

    const { transaction, receipt } = await submitAndConfirmChainWhisperWispConversion({
      assertReady: () => assertPrivacyPortalSignerState(signer, ownerAddress),
      submit: () => writeMethod(...call.args, {
        value: call.valueWei,
        gasLimit
      }),
      waitForReceipt: (submitted) => waitForAppChainReceipt(submitted, 'ChainWhisper WISP conversion'),
      onProgress
    });
    return {
      transactionHash: transaction.hash ?? String((receipt as { hash?: unknown } | null)?.hash ?? ''),
      receipt,
      quote,
      gasEstimate,
      gasLimit
    };
  } catch (error) {
    throw normalizePrivacyPortalError(error);
  }
};
