import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import { decryptUint256, type ctUint256 } from '@coti-io/coti-sdk-typescript';
import {
  ERC20_TOKEN_ABI,
  FALLBACK_REWARD_TOKEN_DECIMALS,
  GROUP_CHAT_CONTRACT_ABI,
  GROUP_CHAT_CONTRACT_ADDRESS,
  GROUP_SUBMIT_GAS_BUFFER,
  GROUP_SUBMIT_GAS_LIMIT_MAX,
  LEGACY_PRIVATE_REWARD_TOKEN_ADDRESS,
  MAX_ERC20_APPROVAL,
  OTC_HISTORY_READER_CONTRACT_ABI,
  OTC_HISTORY_READER_CONTRACT_ADDRESS,
  OTC_READER_CONTRACT_ADDRESS,
  OTC_REGISTRY_CONTRACT_ABI,
  OTC_REGISTRY_CONTRACT_ADDRESS,
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
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiReadProvider,
  normalizeTokenDecimals,
  shortenAddress,
  toSafeNumber,
  type PrivateTradeFillReceiptPayload,
  type RecurringPrivateExecutionPayload,
  type RecurringTradeMode,
  type RecurringTradeStatus,
  type TradeAssetPayload,
  type TradeSnapshot
} from './appShared';
import { resolveTradeAssetTypeValue, resolveTradeSnapshotStatus } from './appHelpers';
import { applyDirectTradeTermsToSnapshot, decryptDirectTradeTerms } from './directTradeTerms';
import { encryptPrivateUint256Input } from './privateUint256';
import {
  decryptTradeRecoveryPayloadForSigner,
  type TradeRecoveryPayload
} from './tradeRecoveryPayload';
import { normalizeAccessHash } from './tradeLinks';

const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
const ACCEPTED_TX_LOOKBACK_BLOCKS = 100_000;
const PRIVATE_TOKEN_WRITE_GAS_LIMIT = 6_000_000n;

type PrivateTokenSpendReadinessInput = {
  requiredAmountWei: bigint;
  balanceWei: bigint | null;
  allowanceWei: bigint | null;
  tokenSymbol?: string;
  afterApproval?: boolean;
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
  afterApproval = false
}: PrivateTokenSpendReadinessInput): PrivateTokenSpendReadiness => {
  if (requiredAmountWei <= 0n) {
    return {
      status: 'ready',
      balanceWei: balanceWei ?? 0n,
      allowanceWei: allowanceWei ?? 0n
    };
  }

  if (balanceWei === null) {
    return {
      status: 'blocked',
      reason: 'balance-unavailable',
      message: `The app could not decrypt this wallet's private ${tokenSymbol} balance. Unlock privacy for the connected wallet and refresh the balance before filling.`,
      balanceWei,
      allowanceWei
    };
  }

  if (balanceWei < requiredAmountWei) {
    return {
      status: 'blocked',
      reason: 'insufficient-balance',
      message: `Your private ${tokenSymbol} balance is below this fill amount.`,
      balanceWei,
      allowanceWei
    };
  }

  if (allowanceWei !== null && allowanceWei >= requiredAmountWei) {
    return {
      status: 'ready',
      balanceWei,
      allowanceWei
    };
  }

  if (afterApproval && allowanceWei === null) {
    return {
      status: 'blocked',
      reason: 'allowance-unavailable-after-approval',
      message: `Private ${tokenSymbol} approval could not be confirmed after the approval transaction. Unlock privacy and try again.`,
      balanceWei,
      allowanceWei
    };
  }

  if (afterApproval) {
    return {
      status: 'blocked',
      reason: 'insufficient-allowance-after-approval',
      message: `Private ${tokenSymbol} allowance is still below this fill amount after approval.`,
      balanceWei,
      allowanceWei
    };
  }

  return {
    status: 'needs-approval',
    balanceWei,
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
    };

export const resolvePrivateTokenAllowanceWritePlan = (
  currentAllowanceWei: bigint | null,
  maxAllowanceWei = PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE
): PrivateTokenAllowanceWritePlan => {
  if (currentAllowanceWei !== null && currentAllowanceWei > 0n) {
    const addedValue = maxAllowanceWei > currentAllowanceWei ? maxAllowanceWei - currentAllowanceWei : 0n;
    return {
      method: 'increaseAllowance',
      amountWei: addedValue,
      selectorSignature: 'increaseAllowance(address,((uint256,uint256),bytes))'
    };
  }

  return {
    method: 'approve',
    amountWei: maxAllowanceWei,
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

const normalizeRegistryAddress = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && isWalletAddress(value) ? value : fallback;

export const isOtcRegistryConfigured = (): boolean => isWalletAddress(OTC_REGISTRY_CONTRACT_ADDRESS);

export const isOtcHistoryReaderConfigured = (
  addresses: TradingContractAddresses = DEFAULT_TRADING_CONTRACT_ADDRESSES
): boolean => isWalletAddress(addresses.historyReader);

export const resolveTradingContractAddressesFromRegistryValue = (
  raw: unknown,
  fallback: TradingContractAddresses = DEFAULT_TRADING_CONTRACT_ADDRESSES
): TradingContractAddresses => {
  const source = raw as
    | {
        standardEscrow?: unknown;
        privateEscrow?: unknown;
        directEscrow?: unknown;
        recurringEscrow?: unknown;
        reader?: unknown;
        historyReader?: unknown;
        [key: number]: unknown;
      }
    | null
    | undefined;

  return {
    standardEscrow: normalizeRegistryAddress(source?.standardEscrow ?? source?.[0], fallback.standardEscrow),
    privateEscrow: normalizeRegistryAddress(source?.privateEscrow ?? source?.[1], fallback.privateEscrow),
    directEscrow: normalizeRegistryAddress(source?.directEscrow ?? source?.[2], fallback.directEscrow),
    recurringEscrow: normalizeRegistryAddress(source?.recurringEscrow ?? source?.[3], fallback.recurringEscrow),
    reader: normalizeRegistryAddress(source?.reader ?? source?.[4], fallback.reader),
    historyReader: normalizeRegistryAddress(source?.historyReader ?? source?.[5], fallback.historyReader)
  };
};

export const resolveTradingContractAddresses = async (): Promise<TradingContractAddresses> => {
  if (!isOtcRegistryConfigured()) {
    return DEFAULT_TRADING_CONTRACT_ADDRESSES;
  }

  try {
    const cotiEthers = await loadCotiEthersModule();
    const readProvider = await loadCotiReadProvider(true);
    const registry = new cotiEthers.Contract(OTC_REGISTRY_CONTRACT_ADDRESS, OTC_REGISTRY_CONTRACT_ABI, readProvider);
    return resolveTradingContractAddressesFromRegistryValue(await registry.getContracts());
  } catch {
    return DEFAULT_TRADING_CONTRACT_ADDRESSES;
  }
};

const normalizeEscrowAddress = (
  value?: string | null,
  addresses: TradingContractAddresses = DEFAULT_TRADING_CONTRACT_ADDRESSES
): string => (typeof value === 'string' && isWalletAddress(value) ? value : addresses.standardEscrow);

const isRecurringOrderContractAddress = (
  value?: string | null,
  addresses: TradingContractAddresses = DEFAULT_TRADING_CONTRACT_ADDRESSES
): boolean =>
  typeof value === 'string' &&
  isWalletAddress(value) &&
  value.toLowerCase() === addresses.recurringEscrow.toLowerCase();

export const isLegacyPrivateOrderEscrowContractAddress = (_value?: string | null): boolean => false;

export const isPrivateOrderEscrowContractAddress = (
  value?: string | null,
  addresses: TradingContractAddresses = DEFAULT_TRADING_CONTRACT_ADDRESSES
): boolean =>
  typeof value === 'string' &&
  isWalletAddress(value) &&
  value.toLowerCase() === addresses.privateEscrow.toLowerCase();

export const isDirectTradeEscrowConfigured = (): boolean => isWalletAddress(DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS);

const isDirectTradeEscrowContractAddress = (
  value?: string | null,
  addresses: TradingContractAddresses = DEFAULT_TRADING_CONTRACT_ADDRESSES
): boolean =>
  typeof value === 'string' &&
  isWalletAddress(value) &&
  isWalletAddress(addresses.directEscrow) &&
  value.toLowerCase() === addresses.directEscrow.toLowerCase();

export const isActiveTradeEscrowContractAddress = (value?: string | null): boolean => {
  const address = normalizeEscrowAddress(value).toLowerCase();
  return (
    address === TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase() ||
    address === PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase() ||
    isDirectTradeEscrowContractAddress(address) ||
    address === RECURRING_OTC_CONTRACT_ADDRESS.toLowerCase()
  );
};

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

const resolveActiveOneOffTradeEscrowConfigs = (
  addresses: TradingContractAddresses = DEFAULT_TRADING_CONTRACT_ADDRESSES
): TradeEscrowConfig[] => {
  const configs = [
    resolveTradeEscrowContractConfig(addresses.standardEscrow, addresses),
    resolveTradeEscrowContractConfig(addresses.privateEscrow, addresses)
  ];
  if (isWalletAddress(addresses.directEscrow)) {
    configs.push(resolveTradeEscrowContractConfig(addresses.directEscrow, addresses));
  }
  if (
    isWalletAddress(DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS) &&
    DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase() !== addresses.directEscrow.toLowerCase()
  ) {
    configs.push(resolveTradeEscrowContractConfig(DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS));
  }
  return configs;
};

export type TradeAccessMetadata = {
  isPublic?: boolean;
  hasAccessHash?: boolean;
  accessHash?: string;
  parentTradeId?: number;
  hasTermsPayload?: boolean;
  hasMakerAccessSecret?: boolean;
  hasTakerAccessSecret?: boolean;
  hasMakerTermsPayload?: boolean;
  hasCounterpartyTermsPayload?: boolean;
  publicAmountCaveat?: boolean;
};

const parseTradeAccessMetadata = (metadataRaw: unknown): TradeAccessMetadata => {
  const metadata = metadataRaw as { isPublic?: unknown; accessHash?: unknown } | null | undefined;
  const indexedMetadata = metadataRaw as { [key: number]: unknown } | null | undefined;
  const metadataIsPublicRaw = metadata?.isPublic ?? indexedMetadata?.[0];
  const metadataAccessHash = String(metadata?.accessHash ?? indexedMetadata?.[1] ?? '');
  const parentTradeId = toSafeNumber((metadata as { parentTradeId?: unknown } | null | undefined)?.parentTradeId ?? indexedMetadata?.[2]);
  const isPublic = typeof metadataIsPublicRaw === 'boolean' ? metadataIsPublicRaw : undefined;
  const hasAccessHash = /^0x[0-9a-fA-F]{64}$/.test(metadataAccessHash)
    ? metadataAccessHash.toLowerCase() !== ZERO_BYTES32
    : undefined;
  const accessHash = /^0x[0-9a-fA-F]{64}$/.test(metadataAccessHash)
    ? metadataAccessHash.toLowerCase()
    : undefined;

  return {
    isPublic,
    hasAccessHash,
    accessHash,
    parentTradeId: parentTradeId > 0 ? parentTradeId : undefined
  };
};

const parseDirectTradeAccessMetadata = (metadataRaw: unknown): TradeAccessMetadata => {
  const metadata = metadataRaw as {
    accessHash?: unknown;
    parentTradeId?: unknown;
    hasTermsPayload?: unknown;
    hasMakerAccessSecret?: unknown;
    hasTakerAccessSecret?: unknown;
    hasMakerTermsPayload?: unknown;
    hasCounterpartyTermsPayload?: unknown;
    publicAmountCaveat?: unknown;
  } | null | undefined;
  const indexedMetadata = metadataRaw as { [key: number]: unknown } | null | undefined;
  const metadataAccessHash = String(metadata?.accessHash ?? indexedMetadata?.[0] ?? '');
  const parentTradeId = toSafeNumber(metadata?.parentTradeId ?? indexedMetadata?.[1]);
  const accessHash = /^0x[0-9a-fA-F]{64}$/.test(metadataAccessHash)
    ? metadataAccessHash.toLowerCase()
    : undefined;
  const hasTermsPayload = metadata?.hasTermsPayload ?? indexedMetadata?.[4];
  const hasMakerAccessSecret = metadata?.hasMakerAccessSecret ?? indexedMetadata?.[5];
  const hasTakerAccessSecret = metadata?.hasTakerAccessSecret ?? indexedMetadata?.[6];
  const publicAmountCaveat = metadata?.publicAmountCaveat ?? indexedMetadata?.[7];

  return {
    isPublic: false,
    hasAccessHash: accessHash ? accessHash !== ZERO_BYTES32 : undefined,
    accessHash,
    parentTradeId: parentTradeId > 0 ? parentTradeId : undefined,
    hasTermsPayload: typeof hasTermsPayload === 'boolean' ? hasTermsPayload : undefined,
    hasMakerAccessSecret: typeof hasMakerAccessSecret === 'boolean' ? hasMakerAccessSecret : undefined,
    hasTakerAccessSecret: typeof hasTakerAccessSecret === 'boolean' ? hasTakerAccessSecret : undefined,
    hasMakerTermsPayload: typeof hasMakerAccessSecret === 'boolean' ? hasMakerAccessSecret : undefined,
    hasCounterpartyTermsPayload:
      typeof hasTermsPayload === 'boolean' ? hasTermsPayload : undefined,
    publicAmountCaveat: typeof publicAmountCaveat === 'boolean' ? publicAmountCaveat : undefined
  };
};

const toBigintString = (value: unknown, fallback = '0'): string => {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  const stringValue = String(value ?? '').trim();
  return /^\d+$/.test(stringValue) ? stringValue : fallback;
};

const parseOptionalTradeId = (value: unknown): number | undefined => {
  const tradeId = toSafeNumber(value);
  return tradeId > 0 ? tradeId : undefined;
};

const getIndexedResultValue = (value: unknown, index: number): unknown => {
  try {
    return (value as { [key: number]: unknown } | null | undefined)?.[index];
  } catch {
    return undefined;
  }
};

export const __getIndexedResultValueForTest = getIndexedResultValue;

const DIRECT_TERM_PAYLOAD_SECRET_CALLER_CANDIDATES = [
  '0x000000000000000000000000000000000000dEaD',
  '0x0000000000000000000000000000000000000001',
  '0x1111111111111111111111111111111111111111'
];

const resolveDirectTermPayloadSecretCaller = (makerAddress?: string, takerAddress?: string): string => {
  const makerKey = makerAddress?.trim().toLowerCase() ?? '';
  const takerKey = takerAddress?.trim().toLowerCase() ?? '';
  return (
    DIRECT_TERM_PAYLOAD_SECRET_CALLER_CANDIDATES.find((candidate) => {
      const candidateKey = candidate.toLowerCase();
      return candidateKey !== makerKey && candidateKey !== takerKey;
    }) ?? DIRECT_TERM_PAYLOAD_SECRET_CALLER_CANDIDATES[0]
  );
};

export const __resolveDirectTermPayloadSecretCallerForTest = resolveDirectTermPayloadSecretCaller;

type RecurringRawAsset = {
  assetType?: unknown;
  token?: unknown;
  [key: number]: unknown;
};

type RecurringRawTerms = {
  baseAmount?: unknown;
  quoteAmount?: unknown;
  [key: number]: unknown;
};

type RecurringRawOrder = {
  maker?: unknown;
  taker?: unknown;
  status?: unknown;
  mode?: unknown;
  baseAsset?: unknown;
  quoteAsset?: unknown;
  buyTerms?: unknown;
  sellTerms?: unknown;
  isPublic?: unknown;
  accessHash?: unknown;
  createdAt?: unknown;
  executionCount?: unknown;
  publicBaseInventory?: unknown;
  publicQuoteInventory?: unknown;
  [key: number]: unknown;
};

type RecurringRawView = {
  order?: unknown;
  buySideOpen?: unknown;
  sellSideOpen?: unknown;
  hasPrivateBaseInventory?: unknown;
  hasPrivateQuoteInventory?: unknown;
  [key: number]: unknown;
};

const parseRecurringAssetRaw = (assetRaw: unknown): { assetType: unknown; token: unknown } => {
  const asset = assetRaw as RecurringRawAsset | null | undefined;
  return {
    assetType: asset?.assetType ?? asset?.[0] ?? 0,
    token: asset?.token ?? asset?.[1] ?? ''
  };
};

const parseRecurringTermsRaw = (termsRaw: unknown): { baseAmount: string; quoteAmount: string } => {
  const terms = termsRaw as RecurringRawTerms | null | undefined;
  return {
    baseAmount: toBigintString(terms?.baseAmount ?? terms?.[0]),
    quoteAmount: toBigintString(terms?.quoteAmount ?? terms?.[1])
  };
};

const resolveRecurringMode = (value: unknown): RecurringTradeMode => {
  const mode = Number(value ?? 0);
  if (mode === 1) {
    return 'fully-private';
  }
  if (mode === 2) {
    return 'hybrid-private';
  }
  return 'public';
};

const resolveRecurringStatus = (value: unknown): RecurringTradeStatus => {
  const status = Number(value ?? 0);
  if (status === 1) {
    return 'active';
  }
  if (status === 2) {
    return 'paused';
  }
  if (status === 3) {
    return 'cancelled';
  }
  return 'unknown';
};

const resolveRecurringTradeStatus = (value: unknown): TradeSnapshot['status'] => {
  const status = resolveRecurringStatus(value);
  if (status === 'active') {
    return 'open';
  }
  if (status === 'cancelled') {
    return 'cancelled';
  }
  return 'unknown';
};

const proportionalAmount = (available: string, numerator: string, denominator: string): string => {
  try {
    const availableAmount = BigInt(available);
    const numeratorAmount = BigInt(numerator);
    const denominatorAmount = BigInt(denominator);
    if (availableAmount <= 0n || numeratorAmount <= 0n || denominatorAmount <= 0n) {
      return '0';
    }
    return ((availableAmount * numeratorAmount) / denominatorAmount).toString();
  } catch {
    return '0';
  }
};

const parseTradeFillState = (
  fillStateRaw: unknown,
  offerAmount: unknown,
  requestAmount: unknown
): NonNullable<TradeSnapshot['fillState']> => {
  const fillState = fillStateRaw as
    | {
        remainingOfferAmount?: unknown;
        remainingRequestAmount?: unknown;
        filledOfferAmount?: unknown;
        filledRequestAmount?: unknown;
      }
    | null
    | undefined;
  const indexedFillState = fillStateRaw as { [key: number]: unknown } | null | undefined;

  return {
    remainingOfferAmount: toBigintString(fillState?.remainingOfferAmount ?? indexedFillState?.[0], toBigintString(offerAmount)),
    remainingRequestAmount: toBigintString(fillState?.remainingRequestAmount ?? indexedFillState?.[1], toBigintString(requestAmount)),
    filledOfferAmount: toBigintString(fillState?.filledOfferAmount ?? indexedFillState?.[2]),
    filledRequestAmount: toBigintString(fillState?.filledRequestAmount ?? indexedFillState?.[3])
  };
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

const readSignerAesKey = (signer: Wallet | JsonRpcSigner): string | null => {
  const onboardInfo = signer.getUserOnboardInfo();
  return typeof onboardInfo?.aesKey === 'string' && onboardInfo.aesKey.trim() ? onboardInfo.aesKey.trim() : null;
};

const decryptPrivateUintValueWithCurrentAes = async (
  encryptedValue: unknown,
  signer: Wallet | JsonRpcSigner
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
  signer: Wallet | JsonRpcSigner,
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

const extractUserCiphertext = (encryptedValue: unknown): unknown => {
  const encrypted = encryptedValue as { userCiphertext?: unknown; [key: number]: unknown } | null | undefined;
  return encrypted?.userCiphertext ?? encrypted?.[1] ?? encryptedValue;
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
  signer: Wallet | JsonRpcSigner
): Promise<bigint | null> => {
  const firstAttempt = await decryptPrivateUintValueWithCurrentAes(encryptedValue, signer);
  return normalizeCurrentPrivateTokenBalanceWei(firstAttempt);
};

export const readCurrentPrivateErc20BalanceWei = async (
  tokenAddress: string,
  ownerAddress: string,
  signer: Wallet | JsonRpcSigner,
  recoverOnFailure = false
): Promise<bigint | null> => {
  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const privateTokenVNextInterface = new cotiEthers.Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI);

  const balanceByAddressCallData = privateTokenVNextInterface.encodeFunctionData('balanceOf(address)', [ownerAddress]);
  const balanceByAddressRawResult = await readProvider.call({
    from: ownerAddress,
    to: tokenAddress,
    data: balanceByAddressCallData
  });
  const decodedByAddress = privateTokenVNextInterface.decodeFunctionResult(
    'balanceOf(address)',
    balanceByAddressRawResult
  );
  const encryptedBalanceRaw = decodedByAddress?.[0] ?? null;
  void recoverOnFailure;
  return decryptPrivateTokenBalanceWei(encryptedBalanceRaw, signer);
};

export const readLegacyPrivateRewardBalanceWei = async (
  ownerAddress: string,
  signer: Wallet | JsonRpcSigner,
  recoverOnFailure = false
): Promise<bigint | null> => {
  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const legacyPrivateTokenInterface = new cotiEthers.Interface(PRIVATE_ERC20_TOKEN_ABI);
  let encryptedBalanceRaw: unknown = null;

  try {
    const legacyBalanceByAddressCallData = legacyPrivateTokenInterface.encodeFunctionData('balanceOf(address)', [
      ownerAddress
    ]);
    const legacyBalanceByAddressRawResult = await readProvider.call({
      from: ownerAddress,
      to: LEGACY_PRIVATE_REWARD_TOKEN_ADDRESS,
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

  if (encryptedBalanceRaw === null) {
    const balanceCallData = legacyPrivateTokenInterface.encodeFunctionData('balanceOf()', []);
    const balanceRawResult = await readProvider.call({
      from: ownerAddress,
      to: LEGACY_PRIVATE_REWARD_TOKEN_ADDRESS,
      data: balanceCallData
    });
    const decodedBalance = legacyPrivateTokenInterface.decodeFunctionResult('balanceOf()', balanceRawResult);
    encryptedBalanceRaw = decodedBalance?.[0] ?? null;
  }

  void recoverOnFailure;
  return decryptPrivateTokenBalanceWei(encryptedBalanceRaw, signer);
};

export const readPrivateTokenBalanceWei = readCurrentPrivateErc20BalanceWei;

export type DirectTermsRevealSource =
  | 'already-hydrated'
  | 'access-secret-payload'
  | 'account-secret-envelope';

export type DirectTermsRevealErrorCode =
  | 'not-direct'
  | 'not-participant'
  | 'missing-counterparty-payload'
  | 'stale-access-secret'
  | 'missing-account-secret'
  | 'account-secret-decrypt-failed'
  | 'missing-maker-payload'
  | 'maker-recovery-decrypt-failed'
  | 'amount-snapshot-failed';

export type DirectTermsRevealResult =
  | {
      ok: true;
      snapshot: TradeSnapshot;
      source: DirectTermsRevealSource;
      recoveredAccessSecret?: string;
    }
  | {
      ok: false;
      snapshot: TradeSnapshot;
      code: DirectTermsRevealErrorCode;
      message: string;
    };

const hasPositiveSnapshotAssetAmount = (value?: string | null): boolean => {
  const normalized = value?.trim() ?? '';
  return /^\d+$/.test(normalized) && BigInt(normalized) > 0n;
};

const hasHydratedDirectSnapshotAmounts = (snapshot: Pick<TradeSnapshot, 'offer' | 'request'>): boolean =>
  hasPositiveSnapshotAssetAmount(snapshot.offer.amount) &&
  hasPositiveSnapshotAssetAmount(snapshot.request.amount);

const MAX_UINT256_VALUE = (1n << 256n) - 1n;

const bigintToBytes32Hex = (value: bigint): string | null => {
  if (value < 0n || value > MAX_UINT256_VALUE) {
    return null;
  }
  return `0x${value.toString(16).padStart(64, '0')}`;
};

export const readDirectTermPayloadBySecret = async ({
  tradeId,
  escrowContract,
  accessSecret,
  makerAddress,
  takerAddress
}: {
  tradeId: number;
  escrowContract?: string;
  accessSecret: string;
  makerAddress?: string;
  takerAddress?: string;
}): Promise<string | null> => {
  if (!Number.isSafeInteger(tradeId) || tradeId <= 0 || !normalizeAccessHash(accessSecret)) {
    return null;
  }

  const config = resolveTradeEscrowContractConfig(escrowContract);
  if (!config.directVisible) {
    return null;
  }

  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const directInterface = new cotiEthers.Interface(config.abi);
  const rawResult = await readProvider
    .call({
      from: resolveDirectTermPayloadSecretCaller(makerAddress, takerAddress),
      to: config.address,
      data: directInterface.encodeFunctionData('getDirectTermPayload', [tradeId, accessSecret])
    })
    .catch(() => '');
  if (!rawResult || rawResult === '0x') {
    return null;
  }
  const decoded = directInterface.decodeFunctionResult('getDirectTermPayload', rawResult);
  const payload = String(decoded?.[0] ?? '');
  return payload && payload !== '0x' ? payload : null;
};

export const readDirectTermPayloadForAccount = async ({
  tradeId,
  escrowContract,
  walletAddress,
  signer
}: {
  tradeId: number;
  escrowContract?: string;
  walletAddress: string;
  signer?: Wallet | JsonRpcSigner;
}): Promise<string | null> => {
  if (!Number.isSafeInteger(tradeId) || tradeId <= 0 || !isWalletAddress(walletAddress)) {
    return null;
  }

  const config = resolveTradeEscrowContractConfig(escrowContract);
  if (!config.directVisible) {
    return null;
  }

  const cotiEthers = await loadCotiEthersModule();
  if (signer) {
    const signerContract = new cotiEthers.Contract(config.address, config.abi, signer) as {
      getDirectTermPayload?: {
        staticCall?: (tradeId: number | bigint, accessSecret: string) => Promise<unknown>;
      };
    };
    const signerPayload = await signerContract.getDirectTermPayload
      ?.staticCall?.(BigInt(tradeId), ZERO_BYTES32)
      .catch(() => null);
    const normalizedSignerPayload = String(signerPayload ?? '');
    if (normalizedSignerPayload && normalizedSignerPayload !== '0x') {
      return normalizedSignerPayload;
    }
  }

  const readProvider = await loadCotiReadProvider(true);
  const directInterface = new cotiEthers.Interface(config.abi);
  const rawResult = await readProvider
    .call({
      from: walletAddress,
      to: config.address,
      data: directInterface.encodeFunctionData('getDirectTermPayload', [tradeId, ZERO_BYTES32])
    })
    .catch(() => '');
  if (!rawResult || rawResult === '0x') {
    return null;
  }
  const decoded = directInterface.decodeFunctionResult('getDirectTermPayload', rawResult);
  const payload = String(decoded?.[0] ?? '');
  return payload && payload !== '0x' ? payload : null;
};

export const readDirectAccessSecretForAccount = async ({
  tradeId,
  escrowContract,
  walletAddress,
  signer
}: {
  tradeId: number;
  escrowContract?: string;
  walletAddress: string;
  signer: Wallet | JsonRpcSigner;
}): Promise<string | null> => {
  if (!Number.isSafeInteger(tradeId) || tradeId <= 0 || !isWalletAddress(walletAddress)) {
    return null;
  }

  const config = resolveTradeEscrowContractConfig(escrowContract);
  if (!config.directVisible) {
    return null;
  }

  const cotiEthers = await loadCotiEthersModule();
  const directSignerContract = new cotiEthers.Contract(config.address, config.abi, signer) as {
    getDirectAccessSecretForAccount?: {
      staticCall?: (tradeId: number | bigint) => Promise<unknown>;
    };
  };
  let encryptedSecret = await directSignerContract.getDirectAccessSecretForAccount
    ?.staticCall?.(BigInt(tradeId))
    .catch(() => null);
  if (!encryptedSecret) {
    const readProvider = await loadCotiReadProvider(true);
    const directInterface = new cotiEthers.Interface(config.abi);
    const rawResult = await readProvider
      .call({
        from: walletAddress,
        to: config.address,
        data: directInterface.encodeFunctionData('getDirectAccessSecretForAccount', [tradeId])
      })
      .catch(() => '');
    if (!rawResult || rawResult === '0x') {
      return null;
    }
    const decoded = directInterface.decodeFunctionResult('getDirectAccessSecretForAccount', rawResult);
    encryptedSecret = decoded?.[0] ?? decoded;
  }

  const decryptedSecret = await decryptPrivateUintValue(extractUserCiphertext(encryptedSecret), signer, true);
  return decryptedSecret === null ? null : bigintToBytes32Hex(decryptedSecret);
};

export const revealDirectTradeTermsForWallet = async ({
  snapshot,
  walletAddress,
  signer,
  accessSecret
}: {
  snapshot: TradeSnapshot;
  walletAddress: string;
  signer: Wallet | JsonRpcSigner;
  accessSecret?: string;
}): Promise<DirectTermsRevealResult> => {
  const config = resolveTradeEscrowContractConfig(snapshot.escrowContract);
  if (!config.directVisible) {
    return {
      ok: false,
      snapshot,
      code: 'not-direct',
      message: 'This offer is not a Direct OTC offer.'
    };
  }

  if (hasHydratedDirectSnapshotAmounts(snapshot)) {
    return { ok: true, snapshot, source: 'already-hydrated' };
  }

  const normalizedWallet = walletAddress.trim().toLowerCase();
  const makerKey = snapshot.maker.trim().toLowerCase();
  const takerKey = snapshot.taker.trim().toLowerCase();
  const isMaker = normalizedWallet !== '' && normalizedWallet === makerKey;
  const isFixedTaker =
    normalizedWallet !== '' &&
    takerKey !== '' &&
    takerKey !== ZERO_BYTES32.toLowerCase() &&
    takerKey !== '0x0000000000000000000000000000000000000000' &&
    normalizedWallet === takerKey;
  const validAccessSecret = normalizeAccessHash(accessSecret);
  let staleSecretError: DirectTermsRevealResult | null = null;
  let accountSecretError: DirectTermsRevealResult | null = null;

  if (validAccessSecret) {
    try {
      const encryptedPayload = await readDirectTermPayloadBySecret({
        tradeId: snapshot.tradeId,
        escrowContract: snapshot.escrowContract,
        accessSecret: validAccessSecret,
        makerAddress: snapshot.maker,
        takerAddress: snapshot.taker
      });
      if (!encryptedPayload) {
        staleSecretError = {
          ok: false,
          snapshot,
          code: snapshot.directTermsMetadata?.hasTermsPayload === false
            ? 'missing-counterparty-payload'
            : 'stale-access-secret',
          message:
            snapshot.directTermsMetadata?.hasTermsPayload === false
              ? 'This Direct offer was created without link-readable terms. Open it with the maker or recipient wallet.'
              : 'The saved counter link secret is stale or invalid. Open the copied link again.'
        };
      } else {
        const terms = await decryptDirectTradeTerms(encryptedPayload, validAccessSecret);
        const revealedSnapshot = applyDirectTradeTermsToSnapshot(snapshot, terms);
        if (hasHydratedDirectSnapshotAmounts(revealedSnapshot)) {
          return {
            ok: true,
            snapshot: revealedSnapshot,
            source: 'access-secret-payload',
            recoveredAccessSecret: validAccessSecret
          };
        }
        staleSecretError = {
          ok: false,
          snapshot,
          code: 'stale-access-secret',
          message: 'The saved counter link secret is stale or invalid. Open the copied link again.'
        };
      }
    } catch {
      staleSecretError = {
        ok: false,
        snapshot,
        code: 'stale-access-secret',
        message: 'The saved counter link secret is stale or invalid. Open the copied link again.'
      };
    }
  }

  if (isMaker || isFixedTaker) {
    try {
      const missingEnvelope =
        (isMaker && snapshot.directTermsMetadata?.hasMakerAccessSecret === false) ||
        (isFixedTaker && snapshot.directTermsMetadata?.hasTakerAccessSecret === false);
      if (missingEnvelope) {
        accountSecretError = {
          ok: false,
          snapshot,
          code: 'missing-account-secret',
          message: 'This Direct offer was created before wallet-reveal terms were supported. Open the share link or recreate it.'
        };
      } else {
        const recoveredSecret = await readDirectAccessSecretForAccount({
          tradeId: snapshot.tradeId,
          escrowContract: snapshot.escrowContract,
          walletAddress,
          signer
        });
        const normalizedRecoveredSecret = normalizeAccessHash(recoveredSecret);
        if (!normalizedRecoveredSecret) {
          accountSecretError = {
            ok: false,
            snapshot,
            code: 'account-secret-decrypt-failed',
            message: 'Privacy is unlocked, but this wallet could not decrypt the Direct offer key. Refresh privacy key.'
          };
        } else {
          const encryptedPayload =
            (await readDirectTermPayloadBySecret({
              tradeId: snapshot.tradeId,
              escrowContract: snapshot.escrowContract,
              accessSecret: normalizedRecoveredSecret,
              makerAddress: snapshot.maker,
              takerAddress: snapshot.taker
            })) ??
            (await readDirectTermPayloadForAccount({
              tradeId: snapshot.tradeId,
              escrowContract: snapshot.escrowContract,
              walletAddress,
              signer
            }));
          if (!encryptedPayload) {
            accountSecretError = {
              ok: false,
              snapshot,
              code: 'missing-counterparty-payload',
              message: 'This Direct offer was created without canonical encrypted terms. Open the share link or recreate it.'
            };
          } else {
            const terms = await decryptDirectTradeTerms(encryptedPayload, normalizedRecoveredSecret);
            const revealedSnapshot = applyDirectTradeTermsToSnapshot(snapshot, terms);
            if (hasHydratedDirectSnapshotAmounts(revealedSnapshot)) {
              return {
                ok: true,
                snapshot: revealedSnapshot,
                source: 'account-secret-envelope',
                recoveredAccessSecret: normalizedRecoveredSecret
              };
            }
            accountSecretError = {
              ok: false,
              snapshot,
              code: 'missing-counterparty-payload',
              message: 'This Direct offer was created without complete encrypted terms. Open the share link or recreate it.'
            };
          }
        }
      }
    } catch {
      accountSecretError = {
        ok: false,
        snapshot,
        code: 'account-secret-decrypt-failed',
        message: 'Privacy is unlocked, but this wallet could not decrypt the Direct offer key. Refresh privacy key.'
      };
    }
  }

  if (!isMaker && !isFixedTaker && !validAccessSecret) {
    return {
      ok: false,
      snapshot,
      code: 'not-participant',
      message: 'This wallet is not the maker or recipient for this Direct offer.'
    };
  }

  return (
    accountSecretError ??
    staleSecretError ?? {
      ok: false,
      snapshot,
      code: 'missing-account-secret',
      message: 'This Direct offer is missing wallet-reveal terms. Open the share link or recreate it.'
    }
  );
};

export const readPrivateTradeRemainingOfferWei = async ({
  tradeId,
  escrowContract,
  makerAddress,
  signer
}: {
  tradeId: number;
  escrowContract?: string;
  makerAddress: string;
  signer: Wallet | JsonRpcSigner;
}): Promise<bigint | null> => {
  if (!Number.isSafeInteger(tradeId) || tradeId <= 0 || !isWalletAddress(makerAddress)) {
    return null;
  }

  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const config = resolveTradeEscrowContractConfig(escrowContract);
  if (!config.hiddenOnly) {
    return null;
  }

  const privateTradeInterface = new cotiEthers.Interface(config.abi);
  try {
    const callData = privateTradeInterface.encodeFunctionData('getPrivateOrderAccountSnapshot', [tradeId, makerAddress]);
    const rawResult = await readProvider.call({
      from: makerAddress,
      to: config.address,
      data: callData
    });
    const decoded = privateTradeInterface.decodeFunctionResult('getPrivateOrderAccountSnapshot', rawResult);
    const snapshot = decoded?.[0] ?? decoded;
    const initialized = Boolean(snapshot?.initialized ?? snapshot?.[1] ?? decoded?.initialized ?? decoded?.[1]);
    if (!initialized) {
      return null;
    }
    const encryptedRemaining = snapshot?.remainingOfferAmount ?? snapshot?.[2] ?? decoded?.remainingOfferAmount ?? decoded?.[2];
    const decrypted = await decryptPrivateUintValue(extractUserCiphertext(encryptedRemaining), signer, true);
    if (decrypted === null) {
      throw new Error('Private order liquidity could not be decrypted. Refresh AES and try again.');
    }
    return decrypted;
  } catch (error) {
    if (error instanceof Error && error.message.includes('could not be decrypted')) {
      throw error;
    }
    throw new Error('Private order liquidity reveal failed. Make sure this is your order, AES is unlocked, and the contract can read the private balance.');
  }
};

const decryptRecurringReceiptAmount = async (
  encryptedValue: unknown,
  signer: Wallet | JsonRpcSigner
): Promise<string | undefined> => {
  const value = await decryptPrivateUintValue(extractUserCiphertext(encryptedValue), signer, true);
  return value === null ? undefined : value.toString();
};

export const fetchRecurringPrivateFillReceiptsForWallet = async ({
  orderId,
  walletAddress,
  signer,
  fromBlock
}: {
  orderId: number;
  walletAddress: string;
  signer: Wallet | JsonRpcSigner;
  fromBlock?: number;
}): Promise<RecurringPrivateExecutionPayload[]> => {
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !isWalletAddress(walletAddress)) {
    return [];
  }

  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const contract = new cotiEthers.Contract(RECURRING_OTC_CONTRACT_ADDRESS, RECURRING_OTC_CONTRACT_ABI, readProvider);
  const safeFromBlock =
    typeof fromBlock === 'number' && Number.isSafeInteger(fromBlock)
      ? Math.max(0, fromBlock)
      : 0;
  const logs = await contract.queryFilter(
    contract.filters.PrivateRecurringFillReceipt(BigInt(orderId), walletAddress, null),
    safeFromBlock,
    'latest'
  );

  const executions = await Promise.all(
    logs.map(async (log: unknown): Promise<RecurringPrivateExecutionPayload | null> => {
      const eventLog = log as {
        args?: {
          orderId?: unknown;
          recipient?: unknown;
          filler?: unknown;
          fillIndex?: unknown;
          side?: unknown;
          baseAmount?: unknown;
          quoteAmount?: unknown;
          remainingBaseInventory?: unknown;
          remainingQuoteInventory?: unknown;
          [key: number]: unknown;
        };
        transactionHash?: string;
        blockNumber?: number;
      };
      const args = eventLog.args;
      if (!args) {
        return null;
      }

      const receiptOrderId = toSafeNumber(args.orderId ?? args[0]);
      if (receiptOrderId !== orderId) {
        return null;
      }

      const fillIndex = toSafeNumber(args.fillIndex ?? args[3]);
      const sideRaw = Number(args.side ?? args[4] ?? 0);
      const filler = String(args.filler ?? args[2] ?? '').trim();
      const [baseAmount, quoteAmount, remainingBaseInventory, remainingQuoteInventory] = await Promise.all([
        decryptRecurringReceiptAmount(args.baseAmount ?? args[5], signer),
        decryptRecurringReceiptAmount(args.quoteAmount ?? args[6], signer),
        decryptRecurringReceiptAmount(args.remainingBaseInventory ?? args[7], signer),
        decryptRecurringReceiptAmount(args.remainingQuoteInventory ?? args[8], signer)
      ]);

      return {
        fillIndex,
        side: sideRaw === 1 ? 'sell' : 'buy',
        filler,
        ...(baseAmount !== undefined ? { baseAmount } : {}),
        ...(quoteAmount !== undefined ? { quoteAmount } : {}),
        ...(remainingBaseInventory !== undefined ? { remainingBaseInventory } : {}),
        ...(remainingQuoteInventory !== undefined ? { remainingQuoteInventory } : {}),
        ...(eventLog.transactionHash ? { txHash: eventLog.transactionHash } : {}),
        ...(typeof eventLog.blockNumber === 'number' ? { blockNumber: eventLog.blockNumber } : {})
      };
    })
  );

  const filteredExecutions = executions
    .filter((execution): execution is RecurringPrivateExecutionPayload => execution !== null)
    .sort((left, right) => left.fillIndex - right.fillIndex);
  const hasDecryptedReceiptValue = filteredExecutions.some(
    (execution) =>
      execution.baseAmount !== undefined ||
      execution.quoteAmount !== undefined ||
      execution.remainingBaseInventory !== undefined ||
      execution.remainingQuoteInventory !== undefined
  );
  if (logs.length > 0 && !hasDecryptedReceiptValue) {
    throw new Error('Private recurring fill receipts were found, but this wallet AES key could not decrypt them.');
  }
  return filteredExecutions;
};

export const fetchRecurringExecutionRowsForWallet = async ({
  orderId,
  walletAddress,
  fromBlock
}: {
  orderId: number;
  walletAddress?: string;
  fromBlock?: number;
}): Promise<RecurringPrivateExecutionPayload[]> => {
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    return [];
  }
  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const contract = new cotiEthers.Contract(RECURRING_OTC_CONTRACT_ADDRESS, RECURRING_OTC_CONTRACT_ABI, readProvider);
  const safeFromBlock =
    typeof fromBlock === 'number' && Number.isSafeInteger(fromBlock)
      ? Math.max(0, fromBlock)
      : 0;
  const fillerFilter = walletAddress && isWalletAddress(walletAddress) ? walletAddress : null;
  const logs = await contract.queryFilter(
    contract.filters.RecurringOrderExecuted(BigInt(orderId), fillerFilter),
    safeFromBlock,
    'latest'
  );

  return logs
    .map((log: unknown): RecurringPrivateExecutionPayload | null => {
      const eventLog = log as {
        args?: {
          orderId?: unknown;
          filler?: unknown;
          side?: unknown;
          executionIndex?: unknown;
          publicBaseAmount?: unknown;
          publicQuoteAmount?: unknown;
          [key: number]: unknown;
        };
        transactionHash?: string;
        blockNumber?: number;
      };
      const args = eventLog.args;
      if (!args || toSafeNumber(args.orderId ?? args[0]) !== orderId) {
        return null;
      }
      const sideRaw = Number(args.side ?? args[2] ?? 0);
      const baseAmount = toBigintString(args.publicBaseAmount ?? args[4]);
      const quoteAmount = toBigintString(args.publicQuoteAmount ?? args[5]);
      return {
        fillIndex: toSafeNumber(args.executionIndex ?? args[3]),
        side: sideRaw === 1 ? 'sell' : 'buy',
        filler: String(args.filler ?? args[1] ?? '').trim(),
        ...(baseAmount !== '0' ? { baseAmount } : {}),
        ...(quoteAmount !== '0' ? { quoteAmount } : {}),
        ...(eventLog.transactionHash ? { txHash: eventLog.transactionHash } : {}),
        ...(typeof eventLog.blockNumber === 'number' ? { blockNumber: eventLog.blockNumber } : {})
      };
    })
    .filter((execution): execution is RecurringPrivateExecutionPayload => execution !== null)
    .sort((left, right) => left.fillIndex - right.fillIndex);
};

export const fetchRecurringPrivateInventorySnapshotsForWallet = async ({
  orderId,
  walletAddress,
  signer,
  fromBlock
}: {
  orderId: number;
  walletAddress: string;
  signer: Wallet | JsonRpcSigner;
  fromBlock?: number;
}): Promise<Array<{ baseInventory?: string; quoteInventory?: string; txHash?: string; blockNumber?: number }>> => {
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !isWalletAddress(walletAddress)) {
    return [];
  }

  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const contract = new cotiEthers.Contract(RECURRING_OTC_CONTRACT_ADDRESS, RECURRING_OTC_CONTRACT_ABI, readProvider);
  const latestSnapshotRaw = await contract.getRecurringAccountSnapshot(BigInt(orderId), walletAddress);
  const latestInitialized = Boolean(latestSnapshotRaw?.initialized ?? latestSnapshotRaw?.[1]);
  if (latestInitialized) {
    const [baseInventory, quoteInventory] = await Promise.all([
      decryptRecurringReceiptAmount(latestSnapshotRaw?.baseInventory ?? latestSnapshotRaw?.[2], signer),
      decryptRecurringReceiptAmount(latestSnapshotRaw?.quoteInventory ?? latestSnapshotRaw?.[3], signer)
    ]);
    if (baseInventory === undefined && quoteInventory === undefined) {
      throw new Error('Private recurring liquidity was found, but this wallet AES key could not decrypt it.');
    }
    return [
      {
        ...(baseInventory !== undefined ? { baseInventory } : {}),
        ...(quoteInventory !== undefined ? { quoteInventory } : {})
      }
    ];
  }
  const safeFromBlock =
    typeof fromBlock === 'number' && Number.isSafeInteger(fromBlock)
      ? Math.max(0, fromBlock)
      : 0;
  const logs = await contract.queryFilter(
    contract.filters.PrivateRecurringInventorySnapshot(BigInt(orderId), walletAddress),
    safeFromBlock,
    'latest'
  );

  const snapshots = await Promise.all(
    logs.map(async (log: unknown): Promise<{ baseInventory?: string; quoteInventory?: string; txHash?: string; blockNumber?: number } | null> => {
      const eventLog = log as {
        args?: {
          orderId?: unknown;
          recipient?: unknown;
          baseInventory?: unknown;
          quoteInventory?: unknown;
          [key: number]: unknown;
        };
        transactionHash?: string;
        blockNumber?: number;
      };
      const args = eventLog.args;
      if (!args) {
        return null;
      }

      const snapshotOrderId = toSafeNumber(args.orderId ?? args[0]);
      if (snapshotOrderId !== orderId) {
        return null;
      }

      const [baseInventory, quoteInventory] = await Promise.all([
        decryptRecurringReceiptAmount(args.baseInventory ?? args[2], signer),
        decryptRecurringReceiptAmount(args.quoteInventory ?? args[3], signer)
      ]);

      return {
        ...(baseInventory !== undefined ? { baseInventory } : {}),
        ...(quoteInventory !== undefined ? { quoteInventory } : {}),
        ...(eventLog.transactionHash ? { txHash: eventLog.transactionHash } : {}),
        ...(typeof eventLog.blockNumber === 'number' ? { blockNumber: eventLog.blockNumber } : {})
      };
    })
  );

  const filteredSnapshots = snapshots.filter(
    (snapshot): snapshot is { baseInventory?: string; quoteInventory?: string; txHash?: string; blockNumber?: number } =>
      snapshot !== null
  );
  const hasDecryptedSnapshotValue = filteredSnapshots.some(
    (snapshot) => snapshot.baseInventory !== undefined || snapshot.quoteInventory !== undefined
  );
  if (logs.length > 0 && !hasDecryptedSnapshotValue) {
    throw new Error('Private recurring liquidity snapshots were found, but this wallet AES key could not decrypt them.');
  }
  return filteredSnapshots;
};

export const fetchPrivateOrderFillReceiptsForWallet = async ({
  tradeId,
  escrowContract,
  walletAddress,
  signer,
  fromBlock
}: {
  tradeId: number;
  escrowContract?: string;
  walletAddress: string;
  signer: Wallet | JsonRpcSigner;
  fromBlock?: number;
}): Promise<PrivateTradeFillReceiptPayload[]> => {
  if (!Number.isSafeInteger(tradeId) || tradeId <= 0 || !isWalletAddress(walletAddress)) {
    return [];
  }

  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const config = resolveTradeEscrowContractConfig(escrowContract);
  if (!config.hiddenOnly) {
    return [];
  }

  const contract = new cotiEthers.Contract(config.address, config.abi, readProvider);
  const safeFromBlock =
    typeof fromBlock === 'number' && Number.isSafeInteger(fromBlock)
      ? Math.max(0, fromBlock)
      : 0;
  const logs = await contract.queryFilter(
    contract.filters.PrivateOrderFillReceipt(BigInt(tradeId), walletAddress, null),
    safeFromBlock,
    'latest'
  );

  const receipts = await Promise.all(
    logs.map(async (log: unknown): Promise<PrivateTradeFillReceiptPayload | null> => {
      const eventLog = log as {
        args?: {
          tradeId?: unknown;
          recipient?: unknown;
          filler?: unknown;
          fillIndex?: unknown;
          offerAmount?: unknown;
          requestAmount?: unknown;
          remainingOfferAmount?: unknown;
          [key: number]: unknown;
        };
        transactionHash?: string;
        blockNumber?: number;
      };
      const args = eventLog.args;
      if (!args) {
        return null;
      }

      const receiptTradeId = toSafeNumber(args.tradeId ?? args[0]);
      if (receiptTradeId !== tradeId) {
        return null;
      }

      const fillIndex = toSafeNumber(args.fillIndex ?? args[3]);
      const filler = String(args.filler ?? args[2] ?? '').trim();
      const [offerAmount, requestAmount, remainingOfferAmount] = await Promise.all([
        decryptRecurringReceiptAmount(args.offerAmount ?? args[4], signer),
        decryptRecurringReceiptAmount(args.requestAmount ?? args[5], signer),
        decryptRecurringReceiptAmount(args.remainingOfferAmount ?? args[6], signer)
      ]);

      return {
        fillIndex,
        filler,
        ...(offerAmount !== undefined ? { offerAmount } : {}),
        ...(requestAmount !== undefined ? { requestAmount } : {}),
        ...(remainingOfferAmount !== undefined ? { remainingOfferAmount } : {}),
        ...(eventLog.transactionHash ? { txHash: eventLog.transactionHash } : {}),
        ...(typeof eventLog.blockNumber === 'number' ? { blockNumber: eventLog.blockNumber } : {})
      };
    })
  );

  const filteredReceipts = receipts
    .filter((receipt): receipt is PrivateTradeFillReceiptPayload => receipt !== null)
    .sort((left, right) => left.fillIndex - right.fillIndex);
  const hasDecryptedReceiptValue = filteredReceipts.some(
    (receipt) =>
      receipt.offerAmount !== undefined ||
      receipt.requestAmount !== undefined ||
      receipt.remainingOfferAmount !== undefined
  );
  if (logs.length > 0 && !hasDecryptedReceiptValue) {
    throw new Error('Private fill receipts were found, but this wallet AES key could not decrypt them.');
  }
  return filteredReceipts;
};

export const readPrivateTokenAllowanceWei = async (
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string,
  signer: Wallet | JsonRpcSigner,
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

const resolveTradeAssetSnapshot = async (
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

const buildRecurringOrderSnapshotFromView = async (
  orderId: number,
  orderViewRaw: unknown,
  options: {
    rewardTokenSymbol: string;
    rewardTokenDecimals: number;
    privateRewardTokenSymbol: string;
    privateRewardTokenDecimals: number;
  }
): Promise<TradeSnapshot> => {
  const view = orderViewRaw as RecurringRawView | null | undefined;
  const orderRaw = (view?.order ?? view?.[0]) as RecurringRawOrder | null | undefined;
  if (!orderRaw) {
    throw new Error('Recurring order was not found.');
  }

  const baseAssetRaw = parseRecurringAssetRaw(orderRaw.baseAsset ?? orderRaw[4]);
  const quoteAssetRaw = parseRecurringAssetRaw(orderRaw.quoteAsset ?? orderRaw[5]);
  const buyTerms = parseRecurringTermsRaw(orderRaw.buyTerms ?? orderRaw[6]);
  const sellTerms = parseRecurringTermsRaw(orderRaw.sellTerms ?? orderRaw[7]);
  const publicBaseInventory = toBigintString(orderRaw.publicBaseInventory ?? orderRaw[12]);
  const publicQuoteInventory = toBigintString(orderRaw.publicQuoteInventory ?? orderRaw[13]);
  const buySideOpen = Boolean(view?.buySideOpen ?? view?.[1]);
  const sellSideOpen = Boolean(view?.sellSideOpen ?? view?.[2]);
  const selectedSide = sellSideOpen || !buySideOpen ? 'sell' : 'buy';
  const mode = resolveRecurringMode(orderRaw.mode ?? orderRaw[3]);
  const recurringStatus = resolveRecurringStatus(orderRaw.status ?? orderRaw[2]);
  const hiddenLiquidity = mode !== 'public';

  const [baseAsset, quoteAsset] = await Promise.all([
    resolveTradeAssetSnapshot(
      baseAssetRaw.assetType,
      baseAssetRaw.token,
      '0',
      options.rewardTokenSymbol,
      options.rewardTokenDecimals,
      options.privateRewardTokenSymbol,
      options.privateRewardTokenDecimals
    ),
    resolveTradeAssetSnapshot(
      quoteAssetRaw.assetType,
      quoteAssetRaw.token,
      '0',
      options.rewardTokenSymbol,
      options.rewardTokenDecimals,
      options.privateRewardTokenSymbol,
      options.privateRewardTokenDecimals
    )
  ]);

  const sideOfferAmount = selectedSide === 'sell' ? sellTerms.baseAmount : buyTerms.quoteAmount;
  const sideRequestAmount = selectedSide === 'sell' ? sellTerms.quoteAmount : buyTerms.baseAmount;
  const remainingOfferAmount =
    selectedSide === 'sell'
      ? hiddenLiquidity && baseAsset.kind === 'private-erc20'
        ? '0'
        : publicBaseInventory
      : hiddenLiquidity && quoteAsset.kind === 'private-erc20'
        ? '0'
        : publicQuoteInventory;
  const remainingRequestAmount =
    selectedSide === 'sell'
      ? proportionalAmount(remainingOfferAmount, sellTerms.quoteAmount, sellTerms.baseAmount)
      : proportionalAmount(remainingOfferAmount, buyTerms.baseAmount, buyTerms.quoteAmount);
  const maker = String(orderRaw.maker ?? orderRaw[0] ?? '').trim();
  const taker = String(orderRaw.taker ?? orderRaw[1] ?? '').trim();
  const accessHash = String(orderRaw.accessHash ?? orderRaw[9] ?? '');
  const normalizedAccessHash = /^0x[0-9a-fA-F]{64}$/.test(accessHash) ? accessHash.toLowerCase() : undefined;
  const isPublicRaw = orderRaw.isPublic ?? orderRaw[8];
  const isPublic = typeof isPublicRaw === 'boolean' ? isPublicRaw : undefined;
  const executionCount = toSafeNumber(orderRaw.executionCount ?? orderRaw[11]);

  return {
    tradeId: orderId,
    escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
    maker,
    taker,
    offer:
      selectedSide === 'sell'
        ? { ...baseAsset, amount: sideOfferAmount }
        : { ...quoteAsset, amount: sideOfferAmount },
    request:
      selectedSide === 'sell'
        ? { ...quoteAsset, amount: sideRequestAmount }
        : { ...baseAsset, amount: sideRequestAmount },
    createdAt: toSafeNumber(orderRaw.createdAt ?? orderRaw[10]),
    expiresAt: 0,
    status: resolveRecurringTradeStatus(orderRaw.status ?? orderRaw[2]),
    isPublic,
    hasAccessHash: normalizedAccessHash
      ? normalizedAccessHash !== ZERO_BYTES32
      : undefined,
    accessHash: normalizedAccessHash,
    fillState: {
      remainingOfferAmount,
      remainingRequestAmount,
      filledOfferAmount: executionCount > 0 ? '1' : '0',
      filledRequestAmount: executionCount > 0 ? '1' : '0'
    },
    hiddenLiquidity,
    recurringOrder: {
      orderId,
      selectedSide,
      mode,
      recurringStatus,
      baseAsset,
      quoteAsset,
      buyTerms,
      sellTerms,
      publicBaseInventory,
      publicQuoteInventory,
      buySideOpen,
      sellSideOpen,
      hasPrivateBaseInventory: Boolean(view?.hasPrivateBaseInventory ?? view?.[3]),
      hasPrivateQuoteInventory: Boolean(view?.hasPrivateQuoteInventory ?? view?.[4]),
      executionCount
    }
  };
};

const fetchRecurringOrderSnapshotById = async (
  orderId: number,
  options: {
    rewardTokenSymbol: string;
    rewardTokenDecimals: number;
    privateRewardTokenSymbol: string;
    privateRewardTokenDecimals: number;
    contractAddress?: string;
  }
): Promise<TradeSnapshot> => {
  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const contractAddress = isWalletAddress(options.contractAddress ?? '')
    ? String(options.contractAddress)
    : RECURRING_OTC_CONTRACT_ADDRESS;
  const contract = new cotiEthers.Contract(contractAddress, RECURRING_OTC_CONTRACT_ABI, readProvider);
  let orderViewRaw: unknown;
  try {
    orderViewRaw = await contract.getOrderView(orderId);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('InvalidOrder') || message.includes('0xaf610693')) {
      throw new Error('Recurring order was not found on the active contract. Old recurring links are retired.');
    }
    throw error;
  }
  return buildRecurringOrderSnapshotFromView(orderId, orderViewRaw, options);
};

export const __buildRecurringOrderSnapshotFromViewForTest = buildRecurringOrderSnapshotFromView;

const resolveRecurringIdsFromPagedResult = (raw: unknown): number[] => {
  const idsRaw = Array.isArray(raw) ? raw[0] : null;
  return Array.isArray(idsRaw)
    ? idsRaw.map((value: unknown) => toSafeNumber(value)).filter((value: number) => value > 0)
    : [];
};

export const __resolveRecurringIdsFromPagedResultForTest = resolveRecurringIdsFromPagedResult;

const fetchRecurringOrderSnapshotsByIds = async (
  orderIds: number[],
  options: {
    rewardTokenSymbol: string;
    rewardTokenDecimals: number;
    privateRewardTokenSymbol: string;
    privateRewardTokenDecimals: number;
    contractAddress?: string;
  }
): Promise<TradeSnapshot[]> => {
  if (orderIds.length === 0) {
    return [];
  }

  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const contractAddress = isWalletAddress(options.contractAddress ?? '')
    ? String(options.contractAddress)
    : RECURRING_OTC_CONTRACT_ADDRESS;
  const contract = new cotiEthers.Contract(contractAddress, RECURRING_OTC_CONTRACT_ABI, readProvider);
  const snapshots = await Promise.all(
    orderIds.map(async (orderId) => {
      try {
        const orderView = await contract.getOrderView(orderId);
        return await buildRecurringOrderSnapshotFromView(orderId, orderView, options);
      } catch {
        return null;
      }
    })
  );
  return snapshots.filter((snapshot): snapshot is TradeSnapshot => snapshot !== null);
};

export const fetchTradeAccessMetadataById = async (
  tradeId: number,
  escrowContract?: string
): Promise<TradeAccessMetadata> => {
  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  if (isRecurringOrderContractAddress(escrowContract)) {
    const contract = new cotiEthers.Contract(RECURRING_OTC_CONTRACT_ADDRESS, RECURRING_OTC_CONTRACT_ABI, readProvider);
    const orderViewRaw = await contract.getOrderView(tradeId);
    const view = orderViewRaw as RecurringRawView | null | undefined;
    const orderRaw = (view?.order ?? view?.[0]) as RecurringRawOrder | null | undefined;
    const isPublicRaw = orderRaw?.isPublic ?? orderRaw?.[8];
    const accessHash = String(orderRaw?.accessHash ?? orderRaw?.[9] ?? '');
    const normalizedAccessHash = /^0x[0-9a-fA-F]{64}$/.test(accessHash) ? accessHash.toLowerCase() : undefined;
    return {
      isPublic: typeof isPublicRaw === 'boolean' ? isPublicRaw : undefined,
      hasAccessHash: normalizedAccessHash ? normalizedAccessHash !== ZERO_BYTES32 : undefined,
      accessHash: normalizedAccessHash
    };
  }

  const config = resolveTradeEscrowContractConfig(escrowContract);
  const contract = new cotiEthers.Contract(config.address, config.abi, readProvider);
  let metadataRaw: unknown;
  if (typeof contract.getTradeMetadata === 'function') {
    metadataRaw = await contract.getTradeMetadata(tradeId);
  } else {
    const tradeViewRaw = (await contract.getTradeView(tradeId)) as { metadata?: unknown; [key: number]: unknown };
    metadataRaw = tradeViewRaw.metadata ?? tradeViewRaw[1];
  }
  return config.directVisible ? parseDirectTradeAccessMetadata(metadataRaw) : parseTradeAccessMetadata(metadataRaw);
};

export const recoverTradeAccessPayloadForMaker = async ({
  tradeId,
  escrowContract,
  signer,
  callerAddress
}: {
  tradeId: number;
  escrowContract?: string;
  signer: Wallet | JsonRpcSigner;
  callerAddress?: string;
}): Promise<TradeRecoveryPayload> => {
  const cotiEthers = await loadCotiEthersModule();
  if (isRecurringOrderContractAddress(escrowContract)) {
    const contract = new cotiEthers.Contract(RECURRING_OTC_CONTRACT_ADDRESS, RECURRING_OTC_CONTRACT_ABI, signer);
    const encryptedPayload = await contract.getRecurringRecoveryNote(tradeId);
    return decryptTradeRecoveryPayloadForSigner(signer, String(encryptedPayload));
  }

  const config = resolveTradeEscrowContractConfig(escrowContract);
  const contract = new cotiEthers.Contract(config.address, config.abi, signer);
  let encryptedPayload: unknown = '0x';
  if (config.directVisible || config.hiddenOnly) {
    const functionName = config.directVisible ? 'getDirectTermPayload' : 'getMakerRecoveryNote';
    const functionArgs = config.directVisible ? [tradeId, ZERO_BYTES32] : [tradeId];
    const callerOverride = isWalletAddress(callerAddress ?? '') ? callerAddress : '';
    if (callerOverride) {
      try {
        const readProvider = await loadCotiReadProvider(true);
        const tradeInterface = new cotiEthers.Interface(config.abi);
        const rawResult = await readProvider.call({
          from: callerOverride,
          to: config.address,
          data: tradeInterface.encodeFunctionData(functionName, functionArgs)
        });
        const decoded = tradeInterface.decodeFunctionResult(functionName, rawResult);
        encryptedPayload = decoded?.[0] ?? decoded;
      } catch {
        encryptedPayload = '0x';
      }
    }
    if (String(encryptedPayload) === '0x') {
      encryptedPayload = config.directVisible
        ? await contract.getDirectTermPayload(tradeId, ZERO_BYTES32)
        : await contract.getMakerRecoveryNote(tradeId);
    }
  }
  return decryptTradeRecoveryPayloadForSigner(signer, String(encryptedPayload));
};

const fetchTradeSnapshotByIdFromContract = async (
  tradeId: number,
  options: {
    rewardTokenSymbol: string;
    rewardTokenDecimals: number;
    privateRewardTokenSymbol: string;
    privateRewardTokenDecimals: number;
    escrowContract?: string;
    accessSecret?: string;
    callerAddress?: string;
    contractAddresses?: TradingContractAddresses;
  }
): Promise<TradeSnapshot> => {
  const contractAddresses = options.contractAddresses ?? DEFAULT_TRADING_CONTRACT_ADDRESSES;
  if (isRecurringOrderContractAddress(options.escrowContract, contractAddresses)) {
    return fetchRecurringOrderSnapshotById(tradeId, {
      ...options,
      contractAddress: options.escrowContract ?? contractAddresses.recurringEscrow
    });
  }

  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const config = resolveTradeEscrowContractConfig(options.escrowContract, contractAddresses);
  const contract = new cotiEthers.Contract(config.address, config.abi, readProvider);
  const tradeViewRaw = await contract.getTradeView(tradeId);
  const tradeView = tradeViewRaw as
    | {
        trade?: unknown;
        metadata?: unknown;
        fillState?: unknown;
        effectiveStatus?: unknown;
        replacementTradeId?: unknown;
        replacesTradeId?: unknown;
        rootTradeId?: unknown;
        [key: number]: unknown;
      }
    | null
    | undefined;
  const indexedTradeView = tradeViewRaw as { [key: number]: unknown } | null | undefined;
  const viewTradeRaw = tradeView?.trade ?? indexedTradeView?.[0];
  const viewMetadataRaw = tradeView?.metadata ?? indexedTradeView?.[1];
  const viewFillStateRaw = config.directVisible ? null : tradeView?.fillState ?? indexedTradeView?.[2];
  const viewEffectiveStatusRaw =
    tradeView?.effectiveStatus ?? indexedTradeView?.[config.directVisible ? 2 : config.hiddenOnly ? 3 : 4];
  const viewReplacementRaw =
    tradeView?.replacementTradeId ?? indexedTradeView?.[config.directVisible ? 3 : config.hiddenOnly ? 4 : 5];
  const viewReplacesRaw =
    tradeView?.replacesTradeId ?? indexedTradeView?.[config.directVisible ? 4 : config.hiddenOnly ? 5 : 6];
  const viewDirectOfferAmountPrivateRaw = config.directVisible
    ? (tradeView as { offerAmountPrivate?: unknown } | null | undefined)?.offerAmountPrivate ?? indexedTradeView?.[6]
    : undefined;
  const viewDirectRequestAmountPrivateRaw = config.directVisible
    ? (tradeView as { requestAmountPrivate?: unknown } | null | undefined)?.requestAmountPrivate ?? indexedTradeView?.[7]
    : undefined;
  const [counterParentRaw, counterParentEscrowRaw, replacementRaw, replacesRaw] = await Promise.all([
    typeof contract.counterParentTradeId === 'function'
      ? contract.counterParentTradeId(tradeId).catch(() => null)
      : Promise.resolve(null),
    typeof contract.counterParentEscrow === 'function'
      ? contract.counterParentEscrow(tradeId).catch(() => null)
      : Promise.resolve(null),
    typeof contract.replacementTradeId === 'function'
      ? contract.replacementTradeId(tradeId).catch(() => viewReplacementRaw ?? null)
      : Promise.resolve(viewReplacementRaw ?? null),
    typeof contract.replacesTradeId === 'function'
      ? contract.replacesTradeId(tradeId).catch(() => viewReplacesRaw ?? null)
      : Promise.resolve(viewReplacesRaw ?? null)
  ]);
  const tradeRaw = viewTradeRaw as
    | {
        maker?: unknown;
        taker?: unknown;
        status?: unknown;
        offerAsset?: unknown;
        requestAsset?: unknown;
        createdAt?: unknown;
        expiresAt?: unknown;
        [key: number]: unknown;
      }
    | null
    | undefined;
  const metadataRaw = viewMetadataRaw;
  const fillStateRaw = viewFillStateRaw;
  const maker = String(tradeRaw?.maker ?? tradeRaw?.[0] ?? '').trim();
  const taker = String(tradeRaw?.taker ?? tradeRaw?.[1] ?? '').trim();
  const statusRaw = viewEffectiveStatusRaw ?? tradeRaw?.status ?? tradeRaw?.[2];
  const offerAssetRaw = (tradeRaw?.offerAsset ?? getIndexedResultValue(tradeRaw, 3)) as
    | { assetType?: unknown; token?: unknown; amount?: unknown; [key: number]: unknown }
    | null
    | undefined;
  const requestAssetRaw = (tradeRaw?.requestAsset ?? getIndexedResultValue(tradeRaw, 4)) as
    | { assetType?: unknown; token?: unknown; amount?: unknown; [key: number]: unknown }
    | null
    | undefined;
  const createdAt = toSafeNumber(tradeRaw?.createdAt ?? tradeRaw?.[5]);
  const expiresAt = toSafeNumber(tradeRaw?.expiresAt ?? tradeRaw?.[6]);
  const offerAssetType = offerAssetRaw?.assetType ?? getIndexedResultValue(offerAssetRaw, 0) ?? 0;
  const offerToken = offerAssetRaw?.token ?? getIndexedResultValue(offerAssetRaw, 1) ?? '';
  const offerAmount = offerAssetRaw?.amount ?? getIndexedResultValue(offerAssetRaw, 2) ?? 0n;
  const requestAssetType = requestAssetRaw?.assetType ?? getIndexedResultValue(requestAssetRaw, 0) ?? 0;
  const requestToken = requestAssetRaw?.token ?? getIndexedResultValue(requestAssetRaw, 1) ?? '';
  const requestAmount = requestAssetRaw?.amount ?? getIndexedResultValue(requestAssetRaw, 2) ?? 0n;
  const tradeAccessMetadata = config.directVisible
    ? parseDirectTradeAccessMetadata(metadataRaw)
    : parseTradeAccessMetadata(metadataRaw);
  const { isPublic, hasAccessHash, accessHash, parentTradeId: parsedParentTradeId } = tradeAccessMetadata;
  const parentTradeId = config.hiddenOnly ? undefined : parsedParentTradeId;
  const fillState = parseTradeFillState(fillStateRaw, offerAmount, requestAmount);
  const counterParentTradeId = parseOptionalTradeId(counterParentRaw);
  const counterParentEscrow =
    typeof counterParentEscrowRaw === 'string' && isWalletAddress(counterParentEscrowRaw)
      ? counterParentEscrowRaw
      : undefined;
  const replacementTradeId = parseOptionalTradeId(replacementRaw);
  const replacesTradeId = parseOptionalTradeId(replacesRaw);

  const [offer, request] = await Promise.all([
    resolveTradeAssetSnapshot(
      offerAssetType,
      offerToken,
      offerAmount,
      options.rewardTokenSymbol,
      options.rewardTokenDecimals,
      options.privateRewardTokenSymbol,
      options.privateRewardTokenDecimals
    ),
    resolveTradeAssetSnapshot(
      requestAssetType,
      requestToken,
      requestAmount,
      options.rewardTokenSymbol,
      options.rewardTokenDecimals,
      options.privateRewardTokenSymbol,
      options.privateRewardTokenDecimals
    )
  ]);
  const resolvedStatus = resolveTradeSnapshotStatus(statusRaw, expiresAt);
  const hiddenLiquidity =
    config.hiddenOnly ||
    offer.kind === 'private-erc20' &&
    request.kind === 'private-erc20' &&
    fillState.remainingOfferAmount === '0' &&
    fillState.remainingRequestAmount === '0' &&
    fillState.filledOfferAmount === '0' &&
    fillState.filledRequestAmount === '0';
  let acceptedTxHash: string | undefined;

  if (resolvedStatus === 'accepted') {
    try {
      const latestBlock = await readProvider.getBlockNumber().catch(() => null);
      const fromBlock =
        typeof latestBlock === 'number' && Number.isSafeInteger(latestBlock)
          ? Math.max(0, latestBlock - ACCEPTED_TX_LOOKBACK_BLOCKS)
          : 0;
      const acceptedLogs = await contract.queryFilter(
        contract.filters.TradeAccepted(BigInt(tradeId), null),
        fromBlock,
        'latest'
      );
      const latestAcceptedLog = acceptedLogs[acceptedLogs.length - 1];
      if (latestAcceptedLog && typeof latestAcceptedLog.transactionHash === 'string') {
        acceptedTxHash = latestAcceptedLog.transactionHash;
      }
    } catch {
      acceptedTxHash = undefined;
    }
  }

  let snapshot: TradeSnapshot = {
    tradeId,
    escrowContract: config.address,
    maker,
    taker,
    offer,
    request,
    createdAt,
    expiresAt,
    status: resolvedStatus,
    isPublic,
    hasAccessHash,
    accessHash,
    parentTradeId,
    counterParentEscrow,
    counterParentTradeId,
    replacementTradeId,
    replacesTradeId,
    fillState,
    acceptedTxHash,
    hiddenLiquidity,
    directTermsMetadata: config.directVisible
      ? {
          hasTermsPayload: tradeAccessMetadata.hasTermsPayload,
          hasMakerAccessSecret: tradeAccessMetadata.hasMakerAccessSecret,
          hasTakerAccessSecret: tradeAccessMetadata.hasTakerAccessSecret,
          hasMakerTermsPayload: tradeAccessMetadata.hasMakerTermsPayload,
          hasCounterpartyTermsPayload: tradeAccessMetadata.hasCounterpartyTermsPayload,
          offerAmountPrivate:
            typeof viewDirectOfferAmountPrivateRaw === 'boolean' ? viewDirectOfferAmountPrivateRaw : undefined,
          requestAmountPrivate:
            typeof viewDirectRequestAmountPrivateRaw === 'boolean' ? viewDirectRequestAmountPrivateRaw : undefined,
          publicAmountCaveat: tradeAccessMetadata.publicAmountCaveat
        }
      : undefined
  };

  if (config.directVisible && options.accessSecret) {
    try {
      const encryptedPayload = await readDirectTermPayloadBySecret({
        tradeId,
        escrowContract: config.address,
        accessSecret: options.accessSecret,
        makerAddress: maker,
        takerAddress: taker
      });
      if (encryptedPayload) {
        const terms = await decryptDirectTradeTerms(String(encryptedPayload), options.accessSecret);
        snapshot = applyDirectTradeTermsToSnapshot(snapshot, terms);
      }
    } catch {
    }
  }

  return snapshot;
};

export const __selectTradeSnapshotCandidateForTest = (
  snapshots: TradeSnapshot[],
  accessSecretHash?: string
): TradeSnapshot | null => {
  if (snapshots.length === 0) {
    return null;
  }

  const normalizedAccessSecretHash = normalizeAccessHash(accessSecretHash);
  if (normalizedAccessSecretHash) {
    const accessMatched = snapshots.find((snapshot) =>
      normalizeAccessHash(snapshot.accessHash) === normalizedAccessSecretHash
    );
    if (accessMatched) {
      return accessMatched;
    }
    const directCounterCandidate = snapshots.find((snapshot) =>
      isDirectTradeEscrowContractAddress(snapshot.escrowContract) &&
      Boolean(snapshot.counterParentTradeId) &&
      normalizeAccessHash(snapshot.accessHash) === ZERO_BYTES32
    );
    if (directCounterCandidate) {
      return directCounterCandidate;
    }
  }

  const publicCandidate = snapshots.find((snapshot) => snapshot.isPublic);
  return publicCandidate ?? snapshots[0] ?? null;
};

export const fetchTradeSnapshotById = async (
  tradeId: number,
  options: {
    rewardTokenSymbol: string;
    rewardTokenDecimals: number;
    privateRewardTokenSymbol: string;
    privateRewardTokenDecimals: number;
    escrowContract?: string;
    accessSecret?: string;
    callerAddress?: string;
    contractAddresses?: TradingContractAddresses;
  }
): Promise<TradeSnapshot> => {
  const contractAddresses = options.contractAddresses ?? DEFAULT_TRADING_CONTRACT_ADDRESSES;
  if (options.escrowContract || isRecurringOrderContractAddress(options.escrowContract, contractAddresses)) {
    return fetchTradeSnapshotByIdFromContract(tradeId, options);
  }

  const cotiEthers = await loadCotiEthersModule();
  const configs = resolveActiveOneOffTradeEscrowConfigs(contractAddresses);
  const candidates = await Promise.all(
    configs.map((config) =>
      fetchTradeSnapshotByIdFromContract(tradeId, {
        ...options,
        escrowContract: config.address,
        contractAddresses
      }).catch(() => null)
    )
  );
  const readableCandidates = candidates.filter((snapshot): snapshot is TradeSnapshot => snapshot !== null);
  const accessSecretHash = options.accessSecret
    ? normalizeAccessHash(cotiEthers.keccak256(options.accessSecret))
    : undefined;
  const selected = __selectTradeSnapshotCandidateForTest(readableCandidates, accessSecretHash);
  if (selected) {
    return selected;
  }

  return fetchTradeSnapshotByIdFromContract(tradeId, {
    ...options,
    escrowContract: contractAddresses.standardEscrow,
    contractAddresses
  });
};

export const fetchRecentTradeSnapshots = async (
  options: {
    rewardTokenSymbol: string;
    rewardTokenDecimals: number;
    privateRewardTokenSymbol: string;
    privateRewardTokenDecimals: number;
    limit?: number;
  }
): Promise<TradeSnapshot[]> => {
  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const safeLimit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 48)));
  const tradingContracts = await resolveTradingContractAddresses();
  const configs = resolveActiveOneOffTradeEscrowConfigs(tradingContracts);

  const snapshotGroups = await Promise.all([
    ...configs.map(async (config) => {
      const contract = new cotiEthers.Contract(config.address, config.abi, readProvider);
      const publicTradeIdsRaw = await contract.getOpenPublicTradeIds?.(0, safeLimit).catch(() => null);
      const publicTradeIdsResult = Array.isArray(publicTradeIdsRaw) ? publicTradeIdsRaw[0] : null;
      const publicTradeIds = Array.isArray(publicTradeIdsResult)
        ? publicTradeIdsResult
            .map((value: unknown) => toSafeNumber(value))
            .filter((value: number) => value > 0)
        : [];

      if (publicTradeIdsRaw !== null) {
        return Promise.all(
          publicTradeIds.map((tradeId: number) =>
            fetchTradeSnapshotById(tradeId, {
              rewardTokenSymbol: options.rewardTokenSymbol,
              rewardTokenDecimals: options.rewardTokenDecimals,
              privateRewardTokenSymbol: options.privateRewardTokenSymbol,
              privateRewardTokenDecimals: options.privateRewardTokenDecimals,
              escrowContract: config.address,
              contractAddresses: tradingContracts
            }).catch(() => null)
          )
        );
      }

      const nextTradeIdRaw = await contract.nextTradeId();
      const nextTradeId = toSafeNumber(nextTradeIdRaw);
      const tradeIds: number[] = [];

      for (let tradeId = nextTradeId - 1; tradeId > 0 && tradeIds.length < safeLimit; tradeId -= 1) {
        tradeIds.push(tradeId);
      }

      return Promise.all(
        tradeIds.map((tradeId) =>
          fetchTradeSnapshotById(tradeId, {
            rewardTokenSymbol: options.rewardTokenSymbol,
            rewardTokenDecimals: options.rewardTokenDecimals,
            privateRewardTokenSymbol: options.privateRewardTokenSymbol,
            privateRewardTokenDecimals: options.privateRewardTokenDecimals,
            escrowContract: config.address,
            contractAddresses: tradingContracts
          }).catch(() => null)
        )
      );
    }),
    (async () => {
      const contract = new cotiEthers.Contract(tradingContracts.recurringEscrow, RECURRING_OTC_CONTRACT_ABI, readProvider);
      const openOrderIdsRaw = await contract.getOpenPublicOrderIds(0, safeLimit).catch(() => null);
      const orderIds = resolveRecurringIdsFromPagedResult(openOrderIdsRaw);
      const snapshots = await fetchRecurringOrderSnapshotsByIds(orderIds, {
        rewardTokenSymbol: options.rewardTokenSymbol,
        rewardTokenDecimals: options.rewardTokenDecimals,
        privateRewardTokenSymbol: options.privateRewardTokenSymbol,
        privateRewardTokenDecimals: options.privateRewardTokenDecimals,
        contractAddress: tradingContracts.recurringEscrow
      }).catch(() => []);
      return snapshots.filter((snapshot) =>
        snapshot.status === 'open' &&
        Boolean(snapshot.recurringOrder?.buySideOpen || snapshot.recurringOrder?.sellSideOpen)
      );
    })()
  ]);

  return snapshotGroups
    .flat()
    .filter((snapshot): snapshot is TradeSnapshot => snapshot !== null)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, safeLimit);
};

type WalletHistoryReaderRef = {
  contractAddress: string;
  localId: number;
  kind: number;
  role: number;
  amountVisibility: number;
};

const parseWalletHistoryReaderRefs = (raw: unknown): WalletHistoryReaderRef[] => {
  const rowsRaw = Array.isArray(raw) ? raw[0] : null;
  if (!Array.isArray(rowsRaw)) return [];
  return rowsRaw
    .map((row): WalletHistoryReaderRef | null => {
      const entry = row as
        | {
            contractAddress?: unknown;
            localId?: unknown;
            kind?: unknown;
            role?: unknown;
            amountVisibility?: unknown;
            [key: number]: unknown;
          }
        | null
        | undefined;
      const contractAddress = String(entry?.contractAddress ?? entry?.[0] ?? '');
      const localId = toSafeNumber(entry?.localId ?? entry?.[1]);
      if (!isWalletAddress(contractAddress) || localId <= 0) return null;
      return {
        contractAddress,
        localId,
        kind: toSafeNumber(entry?.kind ?? entry?.[2]),
        role: toSafeNumber(entry?.role ?? entry?.[3]),
        amountVisibility: toSafeNumber(entry?.amountVisibility ?? entry?.[8])
      };
    })
    .filter((entry): entry is WalletHistoryReaderRef => entry !== null);
};

const fetchWalletHistoryRefsFromReader = async (
  walletAddress: string,
  addresses: TradingContractAddresses,
  limit: number
): Promise<WalletHistoryReaderRef[] | null> => {
  if (!isOtcHistoryReaderConfigured(addresses)) {
    return null;
  }

  try {
    const cotiEthers = await loadCotiEthersModule();
    const readProvider = await loadCotiReadProvider(true);
    const contract = new cotiEthers.Contract(addresses.historyReader, OTC_HISTORY_READER_CONTRACT_ABI, readProvider);
    const raw = isOtcRegistryConfigured()
      ? await contract.getWalletHistoryPage(walletAddress, OTC_REGISTRY_CONTRACT_ADDRESS, 0, limit)
      : await contract.getWalletHistoryPageFromContracts(
          walletAddress,
          addresses.standardEscrow,
          addresses.privateEscrow,
          addresses.directEscrow || '0x0000000000000000000000000000000000000000',
          addresses.recurringEscrow,
          0,
          limit
        );
    return parseWalletHistoryReaderRefs(raw);
  } catch {
    return null;
  }
};

const getWalletTradeSnapshotKey = (snapshot: TradeSnapshot): string =>
  `${(snapshot.escrowContract ?? '').toLowerCase()}:${snapshot.tradeId}`;

export const __mergeWalletTradeSnapshotsForTest = (
  snapshotGroups: TradeSnapshot[][],
  limit = 80
): TradeSnapshot[] => {
  const byKey = new Map<string, TradeSnapshot>();
  for (const snapshot of snapshotGroups.flat()) {
    const key = getWalletTradeSnapshotKey(snapshot);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, snapshot);
      continue;
    }

    byKey.set(key, {
      ...existing,
      ...snapshot,
      walletHasFill: Boolean(existing.walletHasFill || snapshot.walletHasFill),
      walletFillState: snapshot.walletFillState ?? existing.walletFillState,
      makerPrivateProgress: snapshot.makerPrivateProgress ?? existing.makerPrivateProgress
    });
  }

  return Array.from(byKey.values())
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, limit);
};

export const fetchWalletTradeSnapshots = async (
  walletAddress: string,
  options: {
    rewardTokenSymbol: string;
    rewardTokenDecimals: number;
    privateRewardTokenSymbol: string;
    privateRewardTokenDecimals: number;
    limit?: number;
  }
): Promise<TradeSnapshot[]> => {
  if (!isWalletAddress(walletAddress)) {
    return [];
  }

  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const safeLimit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 80)));
  const tradingContracts = await resolveTradingContractAddresses();
  const resolveIds = (raw: unknown): number[] => {
    const idsRaw = Array.isArray(raw) ? raw[0] : null;
    return Array.isArray(idsRaw)
      ? idsRaw.map((value: unknown) => toSafeNumber(value)).filter((value: number) => value > 0)
      : [];
  };
  const readWalletFillState = async (
    contractInstance: unknown,
    tradeId: number
  ): Promise<TradeSnapshot['walletFillState'] | undefined> => {
    const contractWithFills = contractInstance as {
      getTradeFillForAccount?: (tradeId: number, account: string) => Promise<unknown>;
    };
    const raw = await contractWithFills.getTradeFillForAccount?.(tradeId, walletAddress).catch(() => null);
    if (!raw) {
      return undefined;
    }
    const fillState = raw as {
      offerAmountReceived?: unknown;
      requestAmountPaid?: unknown;
      [key: number]: unknown;
    };
    const offerAmountReceived = toBigintString(fillState.offerAmountReceived ?? fillState[0]);
    const requestAmountPaid = toBigintString(fillState.requestAmountPaid ?? fillState[1]);
    return offerAmountReceived !== '0' || requestAmountPaid !== '0'
      ? { offerAmountReceived, requestAmountPaid }
      : undefined;
  };
  const historyRefs = await fetchWalletHistoryRefsFromReader(walletAddress, tradingContracts, safeLimit);
  let historySnapshots: TradeSnapshot[] = [];
  if (historyRefs) {
    const fillerKeys = new Set(
      historyRefs
        .filter((ref) => ref.role === 3)
        .map((ref) => `${ref.contractAddress.toLowerCase()}:${ref.localId}`)
    );
    const uniqueRefs = Array.from(
      new Map(historyRefs.map((ref) => [`${ref.contractAddress.toLowerCase()}:${ref.localId}`, ref])).values()
    ).slice(0, safeLimit);
    const snapshots = await Promise.all(
      uniqueRefs.map((ref) =>
        fetchTradeSnapshotById(ref.localId, {
          rewardTokenSymbol: options.rewardTokenSymbol,
          rewardTokenDecimals: options.rewardTokenDecimals,
          privateRewardTokenSymbol: options.privateRewardTokenSymbol,
          privateRewardTokenDecimals: options.privateRewardTokenDecimals,
          escrowContract: ref.contractAddress,
          contractAddresses: tradingContracts,
          callerAddress: walletAddress
        })
          .then(async (snapshot) => {
            const key = `${ref.contractAddress.toLowerCase()}:${ref.localId}`;
            if (!fillerKeys.has(key)) return snapshot;
            const config = ref.kind === 3 ? null : resolveTradeEscrowContractConfig(ref.contractAddress, tradingContracts);
            if (!config || config.hiddenOnly) return { ...snapshot, walletHasFill: true };
            const contract = new cotiEthers.Contract(config.address, config.abi, readProvider);
            return {
              ...snapshot,
              walletHasFill: true,
              walletFillState: await readWalletFillState(contract, ref.localId)
            };
          })
          .catch(() => null)
      )
    );
    historySnapshots = snapshots.filter((snapshot): snapshot is TradeSnapshot => snapshot !== null);
  }
  const configs = resolveActiveOneOffTradeEscrowConfigs(tradingContracts);
  const snapshotGroups = await Promise.all([
    ...configs.map(async (config) => {
      const contract = new cotiEthers.Contract(config.address, config.abi, readProvider);
      const [makerIdsRaw, takerIdsRaw, fillerIdsRaw] = await Promise.all([
        contract.getTradeIdsForMaker(walletAddress, 0, safeLimit).catch(() => null),
        contract.getTradeIdsForTaker(walletAddress, 0, safeLimit).catch(() => null),
        contract.getTradeIdsForFiller?.(walletAddress, 0, safeLimit).catch(() => null)
      ]);
      const fillerIds = resolveIds(fillerIdsRaw);
      const fillerIdSet = new Set(fillerIds);
      const tradeIds = Array.from(new Set([...resolveIds(makerIdsRaw), ...resolveIds(takerIdsRaw), ...resolveIds(fillerIdsRaw)]))
        .sort((left, right) => right - left)
        .slice(0, safeLimit);
      return Promise.all(
        tradeIds.map((tradeId) =>
          fetchTradeSnapshotById(tradeId, {
            rewardTokenSymbol: options.rewardTokenSymbol,
            rewardTokenDecimals: options.rewardTokenDecimals,
            privateRewardTokenSymbol: options.privateRewardTokenSymbol,
            privateRewardTokenDecimals: options.privateRewardTokenDecimals,
            escrowContract: config.address,
            contractAddresses: tradingContracts,
            callerAddress: walletAddress
          })
            .then(async (snapshot) => {
              if (!fillerIdSet.has(tradeId)) {
                return snapshot;
              }
              return {
                ...snapshot,
                walletHasFill: true,
                ...(config.hiddenOnly ? {} : { walletFillState: await readWalletFillState(contract, tradeId) })
              };
            })
            .catch(() => null)
        )
      );
    }),
    (async () => {
      const contract = new cotiEthers.Contract(tradingContracts.recurringEscrow, RECURRING_OTC_CONTRACT_ABI, readProvider);
      const [makerIdsRaw, takerIdsRaw, fillerIdsRaw] = await Promise.all([
        contract.getOrderIdsForMaker(walletAddress, 0, safeLimit).catch(() => null),
        contract.getOrderIdsForTaker(walletAddress, 0, safeLimit).catch(() => null),
        contract.getOrderIdsForFiller(walletAddress, 0, safeLimit).catch(() => null)
      ]);
      const recurringFillerIds = resolveRecurringIdsFromPagedResult(fillerIdsRaw);
      const recurringFillerIdSet = new Set(recurringFillerIds);
      const orderIds = Array.from(
        new Set([
          ...resolveRecurringIdsFromPagedResult(makerIdsRaw),
          ...resolveRecurringIdsFromPagedResult(takerIdsRaw),
          ...recurringFillerIds
        ])
      )
        .sort((left, right) => right - left)
        .slice(0, safeLimit);
      const snapshots = await fetchRecurringOrderSnapshotsByIds(orderIds, {
        rewardTokenSymbol: options.rewardTokenSymbol,
        rewardTokenDecimals: options.rewardTokenDecimals,
        privateRewardTokenSymbol: options.privateRewardTokenSymbol,
        privateRewardTokenDecimals: options.privateRewardTokenDecimals,
        contractAddress: tradingContracts.recurringEscrow
      }).catch(() => []);
      return snapshots.map((snapshot) =>
        recurringFillerIdSet.has(snapshot.tradeId) ? { ...snapshot, walletHasFill: true } : snapshot
      );
    })()
  ]);

  const directSnapshots = snapshotGroups
    .flat()
    .filter((snapshot): snapshot is TradeSnapshot => snapshot !== null);
  const walletKey = walletAddress.toLowerCase();
  const parentSnapshotsForCounterScan = directSnapshots.filter(
    (snapshot) =>
      !snapshot.recurringOrder &&
      !snapshot.counterParentTradeId &&
      snapshot.status === 'open' &&
      snapshot.maker.toLowerCase() === walletKey &&
      isWalletAddress(snapshot.escrowContract ?? '')
  );
  const directCounterSnapshots =
    parentSnapshotsForCounterScan.length > 0
      ? (
          await Promise.all(
            configs
              .filter((config) => config.directVisible)
              .map(async (config) => {
                const contract = new cotiEthers.Contract(config.address, config.abi, readProvider);
                const counterIdsByParent = await Promise.all(
                  parentSnapshotsForCounterScan.map(async (parentSnapshot) => {
                    const raw = await contract
                      .getCounterTradeIdsForParent?.(parentSnapshot.escrowContract, parentSnapshot.tradeId, 0, safeLimit)
                      .catch(() => null);
                    return resolveIds(raw);
                  })
                );
                const counterIds = Array.from(new Set(counterIdsByParent.flat()))
                  .sort((left, right) => right - left)
                  .slice(0, safeLimit);
                return Promise.all(
                  counterIds.map((tradeId) =>
                    fetchTradeSnapshotById(tradeId, {
                      rewardTokenSymbol: options.rewardTokenSymbol,
                      rewardTokenDecimals: options.rewardTokenDecimals,
                      privateRewardTokenSymbol: options.privateRewardTokenSymbol,
                      privateRewardTokenDecimals: options.privateRewardTokenDecimals,
                      escrowContract: config.address,
                      contractAddresses: tradingContracts,
                      callerAddress: walletAddress
                    }).catch(() => null)
                  )
                );
              })
          )
        )
          .flat()
          .filter((snapshot): snapshot is TradeSnapshot => snapshot !== null)
      : [];

  return __mergeWalletTradeSnapshotsForTest([historySnapshots, directSnapshots, directCounterSnapshots], safeLimit);
};

const approvePrivateTokenSpender = async (
  signer: Wallet | JsonRpcSigner,
  tokenAddress: string,
  spenderAddress: string,
  currentAllowanceWei: bigint | null = null
): Promise<void> => {
  const cotiEthers = await loadCotiEthersModule();
  const privateTokenInterface = new cotiEthers.Interface(PRIVATE_ERC20_TOKEN_VNEXT_ABI);
  const writePlan = resolvePrivateTokenAllowanceWritePlan(currentAllowanceWei);
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
  const privateTokenWriteContract = new cotiEthers.Contract(tokenAddress, PRIVATE_ERC20_TOKEN_VNEXT_ABI, signer);
  const writeFunction = privateTokenWriteContract[writePlan.selectorSignature] as (
    spender: string,
    value: unknown,
    overrides: { gasLimit: bigint }
  ) => Promise<{ wait: () => Promise<unknown> }>;
  const approveTx =
    await writeFunction(spenderAddress, encryptedApproval, {
      gasLimit: PRIVATE_TOKEN_WRITE_GAS_LIMIT
    });
  const approveReceipt = await approveTx.wait();
  if (!approveReceipt || Number((approveReceipt as { status?: number | bigint }).status ?? 0) !== 1) {
    throw new Error('Private token approval failed on-chain.');
  }
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

export const ensurePrivateTokenAccountEncryptionAddress = async ({
  signer,
  tokenAddress,
  ownerAddress,
  encryptionAddress = ownerAddress,
  tokenSymbol = 'private token'
}: {
  signer: Wallet | JsonRpcSigner;
  tokenAddress: string;
  ownerAddress: string;
  encryptionAddress?: string;
  tokenSymbol?: string;
}): Promise<boolean> => {
  if (!isWalletAddress(tokenAddress) || !isWalletAddress(ownerAddress) || !isWalletAddress(encryptionAddress)) {
    return false;
  }

  const currentAddress = await readPrivateTokenAccountEncryptionAddress(tokenAddress, ownerAddress).catch(() => null);
  if (currentAddress?.toLowerCase() === encryptionAddress.toLowerCase()) {
    return false;
  }

  await refreshPrivateTokenAccountEncryptionAddress(signer, tokenAddress, encryptionAddress, tokenSymbol);
  return true;
};

const refreshPrivateTokenAccountEncryptionAddress = async (
  signer: Wallet | JsonRpcSigner,
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
  const receipt = await tx.wait();
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
  tokenSymbol = 'private token'
}: {
  signer: Wallet | JsonRpcSigner;
  ownerAddress: string;
  tokenAddress: string;
  spenderAddress: string;
  requiredAmount: bigint;
  tokenSymbol?: string;
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

  let balanceWei = await readCurrentPrivateErc20BalanceWei(tokenAddress, ownerAddress, signer, true).catch(() => null);
  if (balanceWei === null) {
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
    tokenSymbol
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
    afterApproval: true
  });
  if (refreshedReadiness.status !== 'ready') {
    throw new Error(refreshedReadiness.status === 'blocked' ? refreshedReadiness.message : 'Private token payment is not ready after approval.');
  }
};

export const ensureTradeTokenAllowance = async (
  signer: Wallet | JsonRpcSigner,
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
    if (allowance !== null && allowance >= requiredAmount) {
      return;
    }

    await approvePrivateTokenSpender(signer, tokenAddress, spenderAddress, allowance);
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
    if (refreshedAllowance < requiredAmount) {
      throw new Error('Private token allowance is still below the required amount after approval.');
    }
    return;
  }

  const cotiEthers = await loadCotiEthersModule();
  const tokenContract = new cotiEthers.Contract(tokenAddress, ERC20_TOKEN_ABI, signer);
  const allowanceRaw = await tokenContract.allowance(ownerAddress, spenderAddress).catch(() => null);
  const allowance = typeof allowanceRaw === 'bigint' ? allowanceRaw : 0n;
  if (allowance >= requiredAmount) {
    return;
  }

  const approveTx = await tokenContract.approve(spenderAddress, MAX_ERC20_APPROVAL);
  await approveTx.wait();
};

export const ensureTradeFeeTokenAllowance = async (
  signer: Wallet | JsonRpcSigner,
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

export const ensureGroupTokenFeeAllowance = async (
  signer: Wallet | JsonRpcSigner,
  ownerAddress: string,
  tokenFeeAmount: bigint,
  privateRewardTokenBalanceWei: bigint | null
): Promise<void> => {
  if (tokenFeeAmount <= 0n) {
    return;
  }

  if (privateRewardTokenBalanceWei !== null && privateRewardTokenBalanceWei >= tokenFeeAmount) {
    return;
  }

  const cotiEthers = await loadCotiEthersModule();
  const groupContract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
  const publicFeeTokenRaw = await groupContract.publicFeeToken().catch(() => null);
  const publicFeeTokenAddress =
    typeof publicFeeTokenRaw === 'string' && isWalletAddress(publicFeeTokenRaw)
      ? publicFeeTokenRaw
      : REWARD_TOKEN_ADDRESS;
  const publicFeeTokenContract = new cotiEthers.Contract(publicFeeTokenAddress, ERC20_TOKEN_ABI, signer);
  const allowanceRaw = await publicFeeTokenContract
    .allowance(ownerAddress, GROUP_CHAT_CONTRACT_ADDRESS)
    .catch(() => null);
  const allowance = typeof allowanceRaw === 'bigint' ? allowanceRaw : 0n;
  if (allowance >= tokenFeeAmount) {
    return;
  }

  const approveTx = await publicFeeTokenContract.approve(GROUP_CHAT_CONTRACT_ADDRESS, MAX_ERC20_APPROVAL);
  await approveTx.wait();
};

export const resolveGroupSubmitGasLimit = async (
  contract: unknown,
  groupId: number,
  memoTuple: unknown,
  paymentMode: number,
  requiredFee: bigint
): Promise<bigint | null> => {
  try {
    const submitWithMode = (contract as { submitGroupMessageWithMode?: unknown }).submitGroupMessageWithMode as
      | {
          estimateGas?: (
            groupIdArg: number,
            memoTupleArg: unknown,
            paymentModeArg: number,
            overrides: { value: bigint }
          ) => Promise<bigint>;
        }
      | undefined;
    const estimated =
      submitWithMode?.estimateGas &&
      (await submitWithMode.estimateGas(groupId, memoTuple, paymentMode, {
        value: requiredFee
      }));
    if (typeof estimated !== 'bigint' || estimated <= 0n) {
      return null;
    }
    const padded = estimated + GROUP_SUBMIT_GAS_BUFFER;
    return padded > GROUP_SUBMIT_GAS_LIMIT_MAX ? GROUP_SUBMIT_GAS_LIMIT_MAX : padded;
  } catch {
    return null;
  }
};
