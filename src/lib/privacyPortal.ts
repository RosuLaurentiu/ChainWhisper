export const COTI_PRIVACY_PORTAL_CHAIN_ID = 2_632_500;

export const PRIVACY_PORTAL_REGISTRY_VERSION = 'coti-mainnet-2026-07-22';
export const PRIVACY_PORTAL_REGISTRY_SOURCE = 'https://privacy.coti.io/';
export const PRIVACY_PORTAL_GAS_MARGIN_PERCENT = 30n;

export type PrivacyDirection = 'public-to-private' | 'private-to-public';
export type PrivacyPortalBridgeKind = 'native' | 'erc20';

export type PrivacyPortalToken = {
  symbol: string;
  name: string;
  address: string | null;
  decimals: number;
  kind: 'native' | 'erc20' | 'private-erc20';
};

export type PrivacyTokenPair = {
  id: string;
  chainId: typeof COTI_PRIVACY_PORTAL_CHAIN_ID;
  bridgeKind: PrivacyPortalBridgeKind;
  bridgeAddress: string;
  publicToken: PrivacyPortalToken;
  privateToken: PrivacyPortalToken & { address: string; kind: 'private-erc20' };
  oracleSymbol: string;
  provenance: {
    registryVersion: typeof PRIVACY_PORTAL_REGISTRY_VERSION;
    sourceUrl: typeof PRIVACY_PORTAL_REGISTRY_SOURCE;
    verifiedAt: '2026-07-22';
  };
};

const provenance = {
  registryVersion: PRIVACY_PORTAL_REGISTRY_VERSION,
  sourceUrl: PRIVACY_PORTAL_REGISTRY_SOURCE,
  verifiedAt: '2026-07-22'
} as const;

export const PRIVACY_TOKEN_PAIRS = [
  {
    id: 'coti',
    chainId: COTI_PRIVACY_PORTAL_CHAIN_ID,
    bridgeKind: 'native',
    bridgeAddress: '0x44D864973392064304dD88E2BDef39fF1ab11b7b',
    publicToken: {
      symbol: 'COTI',
      name: 'COTI',
      address: null,
      decimals: 18,
      kind: 'native'
    },
    privateToken: {
      symbol: 'p.COTI',
      name: 'Private COTI',
      address: '0xD2F2692B83C3ecDF2EAa0f7c2632BBd46Ae1cC91',
      decimals: 18,
      kind: 'private-erc20'
    },
    oracleSymbol: 'COTI',
    provenance
  },
  {
    id: 'weth',
    chainId: COTI_PRIVACY_PORTAL_CHAIN_ID,
    bridgeKind: 'erc20',
    bridgeAddress: '0x7286c83300f0C7131b4006f3cf9F8e44BeB45c13',
    publicToken: {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      address: '0x639aCc80569c5FC83c6FBf2319A6Cc38bBfe26d1',
      decimals: 18,
      kind: 'erc20'
    },
    privateToken: {
      symbol: 'p.WETH',
      name: 'Private Wrapped Ether',
      address: '0x4727FE8D8450CEBcB142331FAc034Cd8d311f0E5',
      decimals: 18,
      kind: 'private-erc20'
    },
    oracleSymbol: 'ETH',
    provenance
  },
  {
    id: 'wbtc',
    chainId: COTI_PRIVACY_PORTAL_CHAIN_ID,
    bridgeKind: 'erc20',
    bridgeAddress: '0xc3B7EdEe4f1c0A0bA1AcD341e4982371eC869862',
    publicToken: {
      symbol: 'WBTC',
      name: 'Wrapped Bitcoin',
      address: '0x8C39B1fD0e6260fdf20652Fc436d25026832bfEA',
      decimals: 8,
      kind: 'erc20'
    },
    privateToken: {
      symbol: 'p.WBTC',
      name: 'Private Wrapped Bitcoin',
      address: '0x65449561257ba5756631Aa0d34f07f6457a319be',
      decimals: 8,
      kind: 'private-erc20'
    },
    oracleSymbol: 'WBTC',
    provenance
  },
  {
    id: 'usdt',
    chainId: COTI_PRIVACY_PORTAL_CHAIN_ID,
    bridgeKind: 'erc20',
    bridgeAddress: '0x7685B473DAF1c6DeD815Ca64C6fa18Da2227440D',
    publicToken: {
      symbol: 'USDT',
      name: 'Tether USD',
      address: '0xfA6f73446b17A97a56e464256DA54AD43c2Cbc3E',
      decimals: 6,
      kind: 'erc20'
    },
    privateToken: {
      symbol: 'p.USDT',
      name: 'Private Tether USD',
      address: '0x42107250C3D385ddfABE69ab6de163702040FeB0',
      decimals: 6,
      kind: 'private-erc20'
    },
    oracleSymbol: 'USDT',
    provenance
  },
  {
    id: 'usdc-e',
    chainId: COTI_PRIVACY_PORTAL_CHAIN_ID,
    bridgeKind: 'erc20',
    bridgeAddress: '0x29334fC23ffa2c44AF1b372336C2296591Eadd86',
    publicToken: {
      symbol: 'USDC.e',
      name: 'Bridged USDC',
      address: '0xf1Feebc4376c68B7003450ae66343Ae59AB37D3C',
      decimals: 6,
      kind: 'erc20'
    },
    privateToken: {
      symbol: 'p.USDC.e',
      name: 'Private Bridged USDC',
      address: '0x63C9a1D05471fc8d47C83968725Dcfdcb5410392',
      decimals: 6,
      kind: 'private-erc20'
    },
    oracleSymbol: 'USDC',
    provenance
  },
  {
    id: 'wada',
    chainId: COTI_PRIVACY_PORTAL_CHAIN_ID,
    bridgeKind: 'erc20',
    bridgeAddress: '0xFa2126C07F517013c8d237cc465342da89B96f92',
    publicToken: {
      symbol: 'WADA',
      name: 'Wrapped ADA',
      address: '0xe757Ca19d2c237AA52eBb1d2E8E4368eeA3eb331',
      decimals: 6,
      kind: 'erc20'
    },
    privateToken: {
      symbol: 'p.WADA',
      name: 'Private Wrapped ADA',
      address: '0x3a8b49aAC1dAD86aa45a75231FbeC5bEb810e416',
      decimals: 6,
      kind: 'private-erc20'
    },
    oracleSymbol: 'ADA',
    provenance
  },
  {
    id: 'gcoti',
    chainId: COTI_PRIVACY_PORTAL_CHAIN_ID,
    bridgeKind: 'erc20',
    bridgeAddress: '0xD4e0d9AB16b48c68044cB6aeA3A089380d6D8cD4',
    publicToken: {
      symbol: 'gCOTI',
      name: 'gCOTI',
      address: '0x7637C7838EC4Ec6b85080F28A678F8E234bB83D1',
      decimals: 18,
      kind: 'erc20'
    },
    privateToken: {
      symbol: 'p.gCOTI',
      name: 'Private gCOTI',
      address: '0x394b3c4328160f000763Ca391D07F902926EDaAc',
      decimals: 18,
      kind: 'private-erc20'
    },
    oracleSymbol: 'GCOTI',
    provenance
  }
] as const satisfies readonly PrivacyTokenPair[];

export type PrivacyTokenPairId = (typeof PRIVACY_TOKEN_PAIRS)[number]['id'];

export const getPrivacyTokenPair = (pairId: string): PrivacyTokenPair | null =>
  PRIVACY_TOKEN_PAIRS.find((pair) => pair.id === pairId) ?? null;

export const PRIVACY_BRIDGE_COMMON_ABI = [
  'error AmountZero()',
  'error InsufficientEthBalance()',
  'error EthTransferFailed()',
  'error DepositDisabled()',
  'error InsufficientCotiFee()',
  'error BridgePaused()',
  'error EnforcedPause()',
  'error OracleTimestampMismatch(uint256 expected,uint256 actual)',
  'error PriceOracleNotSet()',
  'error InvalidOraclePrice()',
  'error OraclePriceStale(uint256 oracleLastUpdated,uint256 blockTimestamp,uint256 maxOracleAge)',
  'error OracleLastUpdatedInFuture(uint256 lastUpdated)',
  'error AddressBlacklisted(address account)',
  'error DepositBelowMinimum()',
  'error DepositExceedsMaximum()',
  'error WithdrawBelowMinimum()',
  'error WithdrawExceedsMaximum()',
  'function paused() view returns (bool)',
  'function isDepositEnabled() view returns (bool)',
  'function minDepositAmount() view returns (uint256)',
  'function maxDepositAmount() view returns (uint256)',
  'function minWithdrawAmount() view returns (uint256)',
  'function maxWithdrawAmount() view returns (uint256)',
  'function blacklisted(address account) view returns (bool)',
  'function totalUserLiability() view returns (uint256)'
] as const;

export const PRIVACY_NATIVE_BRIDGE_ABI = [
  ...PRIVACY_BRIDGE_COMMON_ABI,
  'function privateCoti() view returns (address)',
  'function getBridgeBalance() view returns (uint256)',
  'function estimateDepositFee(uint256 amount) view returns (uint256 fee,uint256 cotiLastUpdated,uint256 blockTimestamp)',
  'function estimateWithdrawFee(uint256 amount) view returns (uint256 fee,uint256 cotiLastUpdated,uint256 blockTimestamp)',
  'function deposit(uint256 cotiOracleTimestamp,uint256 tokenOracleTimestamp) payable',
  'function withdraw(uint256 amount,uint256 cotiOracleTimestamp,uint256 tokenOracleTimestamp)'
] as const;

export const PRIVACY_ERC20_BRIDGE_ABI = [
  ...PRIVACY_BRIDGE_COMMON_ABI,
  'error InsufficientBridgeLiquidity()',
  'error TokenTransferFailed()',
  'error UnexpectedTransferBalance(uint256 expected,uint256 received)',
  'error AmountTooLarge()',
  'error AmountTooSmall()',
  'function token() view returns (address)',
  'function privateToken() view returns (address)',
  'function tokenSymbol() view returns (string)',
  'function estimateDepositFee(uint256 amount) view returns (uint256 fee,uint256 cotiLastUpdated,uint256 tokenLastUpdated,uint256 blockTimestamp)',
  'function estimateWithdrawFee(uint256 amount) view returns (uint256 fee,uint256 cotiLastUpdated,uint256 tokenLastUpdated,uint256 blockTimestamp)',
  'function deposit(uint256 amount,uint256 cotiOracleTimestamp,uint256 tokenOracleTimestamp) payable',
  'function withdraw(uint256 amount,uint256 cotiOracleTimestamp,uint256 tokenOracleTimestamp) payable'
] as const;

export type PrivacyPairVerificationIssue =
  | 'registry-entry-mismatch'
  | 'wrong-chain'
  | 'bridge-code-missing'
  | 'public-token-code-missing'
  | 'private-token-code-missing'
  | 'public-token-mismatch'
  | 'private-token-mismatch'
  | 'public-decimals-mismatch'
  | 'private-decimals-mismatch'
  | 'verification-read-failed';

export type PrivacyPairVerification = {
  pairId: string;
  chainId: number | null;
  status: 'ready' | 'mismatch' | 'unavailable';
  issues: PrivacyPairVerificationIssue[];
  verifiedAt: number;
};

export type PrivacyPortalLimits = {
  minDepositWei: bigint;
  maxDepositWei: bigint;
  minWithdrawWei: bigint;
  maxWithdrawWei: bigint;
};

export type PrivacyPortalPairMetrics = {
  pairId: string;
  account: string | null;
  publicBalanceWei: bigint | null;
  privateBalanceWei: bigint | null;
  nativeCotiBalanceWei: bigint | null;
  publicAllowanceWei: bigint | null;
  privateAllowanceWei: bigint | null;
  privatePublicAmountsEnabled: boolean | null;
  paused: boolean;
  depositEnabled: boolean;
  blacklisted: boolean;
  bridgeLiquidityWei: bigint;
  limits: PrivacyPortalLimits;
  verification: PrivacyPairVerification;
  readAt: number;
};

export type PrivacyPortalQuote = {
  quoteKey: string;
  chainId: typeof COTI_PRIVACY_PORTAL_CHAIN_ID;
  pairId: string;
  direction: PrivacyDirection;
  account: string;
  amountWei: bigint;
  feeWei: bigint;
  receiveAmountWei: bigint;
  cotiOracleTimestamp: bigint;
  tokenOracleTimestamp: bigint;
  blockTimestamp: bigint;
  minAmountWei: bigint;
  maxAmountWei: bigint;
  paused: boolean;
  depositEnabled: boolean;
  blacklisted: boolean;
  bridgeLiquidityWei: bigint;
  gasEstimate: bigint | null;
  gasLimit: bigint | null;
  quotedAt: number;
};

export type PrivacyPortalConversionStage =
  | 'validating'
  | 'public-approval-reset'
  | 'public-approval'
  | 'private-approval'
  | 'refreshing-quote'
  | 'awaiting-conversion'
  | 'confirming'
  | 'complete';

export type PrivacyPortalConversionResult = {
  transactionHash: string;
  receipt: unknown;
  quote: PrivacyPortalQuote;
  gasLimit: bigint;
};

export type PrivacyPortalGasEstimate = {
  quote: PrivacyPortalQuote;
  gasEstimate: bigint;
  gasLimit: bigint;
  gasPriceWei: bigint;
  gasCostWei: bigint;
  estimatedAt: number;
};

export type PrivacyPortalAllowanceRequirement =
  | 'none'
  | 'public-allowance-unavailable'
  | 'public-approval-required'
  | 'private-allowance-unavailable'
  | 'private-approval-required';

export type PrivacyPortalTransactionCall = {
  functionSignature:
    | 'deposit(uint256,uint256)'
    | 'withdraw(uint256,uint256,uint256)'
    | 'deposit(uint256,uint256,uint256)';
  args: readonly bigint[];
  valueWei: bigint;
};

export type PrivacyPortalAmountValidationInput = {
  amountWei: bigint;
  minAmountWei: bigint;
  maxAmountWei: bigint;
  balanceWei?: bigint | null;
  bridgeLiquidityWei?: bigint | null;
  direction: PrivacyDirection;
  feeWei?: bigint;
  nativeCotiBalanceWei?: bigint | null;
  bridgeKind?: PrivacyPortalBridgeKind;
};

export type PrivacyPortalAmountIssue =
  | 'amount-zero'
  | 'below-minimum'
  | 'above-maximum'
  | 'insufficient-balance'
  | 'insufficient-bridge-liquidity'
  | 'fee-exceeds-amount'
  | 'insufficient-native-fee-balance';

const PRIVACY_PORTAL_AMOUNT_ISSUE_MESSAGES: Record<PrivacyPortalAmountIssue, string> = {
  'amount-zero': 'Enter an amount greater than zero.',
  'below-minimum': 'The amount is below the bridge minimum.',
  'above-maximum': 'The amount is above the bridge maximum.',
  'insufficient-balance': 'The selected account does not have enough of the input token.',
  'insufficient-bridge-liquidity': 'The bridge does not currently have enough withdrawal liquidity.',
  'fee-exceeds-amount': 'The COTI portal fee is greater than or equal to this amount.',
  'insufficient-native-fee-balance': 'The selected account does not have enough COTI to pay the portal fee.'
};

export const getPrivacyPortalAmountIssueMessage = (issue: PrivacyPortalAmountIssue): string =>
  PRIVACY_PORTAL_AMOUNT_ISSUE_MESSAGES[issue];

export const parsePrivacyAmountInput = (value: string, decimals: number): bigint | null => {
  const normalized = value.trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255 || !/^\d*(?:\.\d*)?$/.test(normalized)) {
    return null;
  }
  if (!normalized || normalized === '.') {
    return null;
  }

  const [whole = '0', fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) {
    return null;
  }
  const wholeValue = whole || '0';
  const paddedFraction = fraction.padEnd(decimals, '0');
  const raw = `${wholeValue}${paddedFraction}`.replace(/^0+(?=\d)/, '');
  return BigInt(raw || '0');
};

export const buildPrivacyPortalQuoteKey = ({
  chainId,
  account,
  pairId,
  direction,
  amountWei
}: {
  chainId: number;
  account?: string | null;
  pairId: string;
  direction: PrivacyDirection;
  amountWei: bigint;
}): string => `${chainId}:${(account ?? '').toLowerCase()}:${pairId}:${direction}:${amountWei}`;

export const applyPrivacyPortalGasMargin = (
  gasEstimate: bigint,
  marginPercent = PRIVACY_PORTAL_GAS_MARGIN_PERCENT
): bigint => {
  if (gasEstimate <= 0n) {
    return 0n;
  }
  if (marginPercent < 0n) {
    throw new RangeError('Privacy Portal gas margin cannot be negative.');
  }
  return (gasEstimate * (100n + marginPercent) + 99n) / 100n;
};

export const calculatePrivacyPortalGasReserveWei = (gasLimit: bigint, gasPriceWei: bigint): bigint => {
  if (gasLimit < 0n || gasPriceWei < 0n) {
    throw new RangeError('Privacy Portal gas values cannot be negative.');
  }
  return gasLimit * gasPriceWei;
};

export const selectPrivacyPortalNativeGasProbeAmount = ({
  requestedAmountWei,
  balanceWei,
  minAmountWei,
  maxAmountWei,
  quotedFeeWei,
  headroomWei
}: {
  requestedAmountWei: bigint;
  balanceWei: bigint;
  minAmountWei: bigint;
  maxAmountWei: bigint;
  quotedFeeWei: bigint;
  headroomWei: bigint;
}): bigint | null => {
  if (
    requestedAmountWei <= 0n ||
    balanceWei <= 0n ||
    maxAmountWei <= 0n ||
    quotedFeeWei < 0n ||
    headroomWei < 0n
  ) {
    return null;
  }
  const spendableBalanceWei = balanceWei > headroomWei ? balanceWei - headroomWei : 0n;
  const candidateWei = [requestedAmountWei, maxAmountWei, spendableBalanceWei].reduce(
    (smallest, value) => value < smallest ? value : smallest
  );
  const minimumViableWei = [1n, minAmountWei, quotedFeeWei + 1n].reduce(
    (largest, value) => value > largest ? value : largest
  );
  return candidateWei >= minimumViableWei && candidateWei < balanceWei ? candidateWei : null;
};

export const resolvePrivacyPortalAllowanceRequirement = ({
  pair,
  direction,
  amountWei,
  publicAllowanceWei,
  privateAllowanceWei
}: {
  pair: Pick<PrivacyTokenPair, 'bridgeKind'>;
  direction: PrivacyDirection;
  amountWei: bigint;
  publicAllowanceWei: bigint | null;
  privateAllowanceWei: bigint | null;
}): PrivacyPortalAllowanceRequirement => {
  if (direction === 'public-to-private') {
    if (pair.bridgeKind === 'native') {
      return 'none';
    }
    if (publicAllowanceWei === null) {
      return 'public-allowance-unavailable';
    }
    return publicAllowanceWei >= amountWei ? 'none' : 'public-approval-required';
  }
  if (privateAllowanceWei === null) {
    return 'private-allowance-unavailable';
  }
  return privateAllowanceWei >= amountWei ? 'none' : 'private-approval-required';
};

export const resolvePrivacyPortalReceiveAmount = (
  pair: Pick<PrivacyTokenPair, 'bridgeKind'>,
  direction: PrivacyDirection,
  amountWei: bigint,
  feeWei: bigint
): bigint => {
  if (pair.bridgeKind !== 'native') {
    return amountWei;
  }
  void direction;
  return amountWei > feeWei ? amountWei - feeWei : 0n;
};

export const buildPrivacyPortalTransactionCall = (
  pair: Pick<PrivacyTokenPair, 'bridgeKind'>,
  direction: PrivacyDirection,
  amountWei: bigint,
  quote: Pick<PrivacyPortalQuote, 'feeWei' | 'cotiOracleTimestamp' | 'tokenOracleTimestamp'>
): PrivacyPortalTransactionCall => {
  if (pair.bridgeKind === 'native' && direction === 'public-to-private') {
    return {
      functionSignature: 'deposit(uint256,uint256)',
      args: [quote.cotiOracleTimestamp, quote.tokenOracleTimestamp],
      valueWei: amountWei
    };
  }
  return {
    functionSignature:
      direction === 'public-to-private'
        ? 'deposit(uint256,uint256,uint256)'
        : 'withdraw(uint256,uint256,uint256)',
    args: [amountWei, quote.cotiOracleTimestamp, quote.tokenOracleTimestamp],
    valueWei: pair.bridgeKind === 'erc20' ? quote.feeWei : 0n
  };
};

export const validatePrivacyPortalAmount = ({
  amountWei,
  minAmountWei,
  maxAmountWei,
  balanceWei,
  bridgeLiquidityWei,
  direction,
  feeWei = 0n,
  nativeCotiBalanceWei,
  bridgeKind = 'erc20'
}: PrivacyPortalAmountValidationInput): PrivacyPortalAmountIssue[] => {
  const issues: PrivacyPortalAmountIssue[] = [];
  if (amountWei <= 0n) {
    issues.push('amount-zero');
  }
  if (amountWei > 0n && amountWei < minAmountWei) {
    issues.push('below-minimum');
  }
  if (amountWei > maxAmountWei) {
    issues.push('above-maximum');
  }
  if (balanceWei !== undefined && balanceWei !== null && amountWei > balanceWei) {
    issues.push('insufficient-balance');
  }
  if (
    direction === 'private-to-public' &&
    bridgeLiquidityWei !== undefined &&
    bridgeLiquidityWei !== null &&
    (bridgeKind === 'native' && amountWei > feeWei ? amountWei - feeWei : amountWei) > bridgeLiquidityWei
  ) {
    issues.push('insufficient-bridge-liquidity');
  }
  if (bridgeKind === 'native' && feeWei >= amountWei && amountWei > 0n) {
    issues.push('fee-exceeds-amount');
  }
  if (
    bridgeKind === 'erc20' &&
    nativeCotiBalanceWei !== undefined &&
    nativeCotiBalanceWei !== null &&
    feeWei > nativeCotiBalanceWei
  ) {
    issues.push('insufficient-native-fee-balance');
  }
  return issues;
};

const PRIVACY_PORTAL_ERROR_MESSAGES: Array<[RegExp, string]> = [
  [/OracleTimestampMismatch/i, 'The oracle price updated. Refresh the quote and confirm again.'],
  [/OraclePriceStale|OracleLastUpdatedInFuture/i, 'The bridge oracle is temporarily stale. Try again after the next update.'],
  [/DepositDisabled/i, 'Deposits for this token are currently disabled.'],
  [/BridgePaused|EnforcedPause|paused/i, 'This privacy bridge is currently paused.'],
  [/DepositBelowMinimum|WithdrawBelowMinimum|AmountBelowMinimum/i, 'The amount is below the bridge minimum.'],
  [/DepositExceedsMaximum|WithdrawExceedsMaximum|AmountAboveMaximum/i, 'The amount is above the bridge maximum.'],
  [/InsufficientBridgeLiquidity|InsufficientEthBalance|InsufficientReserve/i, 'The bridge does not currently have enough withdrawal liquidity.'],
  [/InsufficientCotiFee|InsufficientFee/i, 'There is not enough COTI to pay the portal fee.'],
  [/AddressBlacklisted/i, 'This account is not permitted to use the selected bridge.'],
  [/UnexpectedTransferBalance|TokenTransferFailed/i, 'The token transfer is not compatible with this bridge.'],
  [/user rejected|ACTION_REJECTED|4001/i, 'The transaction was rejected in the wallet.'],
  [/insufficient funds/i, 'There is not enough COTI for the transaction fee and gas.'],
  [/wrong(?:\s+network|[- ]chain)|unsupported chain|chain\s*id|switch(?:ing)?\s+(?:to\s+)?(?:the\s+)?(?:correct\s+)?network/i, 'Switch to COTI Mainnet and try again.'],
  [/decrypt|AES|Unlock privacy/i, 'Unlock privacy for this account and try again.']
];

const readErrorText = (error: unknown, depth = 0): string => {
  if (depth > 3) {
    return '';
  }
  if (error instanceof Error) {
    const nested = error as Error & {
      cause?: unknown;
      shortMessage?: unknown;
      reason?: unknown;
      data?: unknown;
      code?: unknown;
      revert?: { name?: unknown } | null;
      error?: unknown;
      info?: unknown;
    };
    return [
      error.message,
      nested.shortMessage,
      nested.reason,
      nested.code,
      nested.revert?.name,
      readErrorText(nested.data, depth + 1),
      readErrorText(nested.error, depth + 1),
      readErrorText(nested.info, depth + 1),
      readErrorText(nested.cause, depth + 1)
    ]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' ');
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object') {
    const record = error as {
      shortMessage?: unknown;
      reason?: unknown;
      message?: unknown;
      data?: unknown;
      code?: unknown;
      revert?: { name?: unknown } | null;
      error?: unknown;
      info?: unknown;
      cause?: unknown;
    };
    return [
      record.shortMessage,
      record.reason,
      record.message,
      record.data,
      record.code,
      record.revert?.name,
      readErrorText(record.error, depth + 1),
      readErrorText(record.info, depth + 1),
      readErrorText(record.cause, depth + 1)
    ]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' ');
  }
  return '';
};

export const normalizePrivacyPortalError = (error: unknown): Error => {
  const rawMessage = readErrorText(error);
  const mapped = PRIVACY_PORTAL_ERROR_MESSAGES.find(([pattern]) => pattern.test(rawMessage));
  return new Error(mapped?.[1] ?? (rawMessage || 'The privacy conversion could not be completed.'));
};
