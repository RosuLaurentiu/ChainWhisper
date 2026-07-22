import {
  COTI_NETWORK,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  WISP_PRIVACY_BRIDGE_CONTRACT_ADDRESS
} from './appShared';

export const CHAINWHISPER_WISP_BRIDGE_PAIR = {
  chainId: COTI_NETWORK.chainIdDecimal,
  bridgeAddress: WISP_PRIVACY_BRIDGE_CONTRACT_ADDRESS,
  publicTokenAddress: REWARD_TOKEN_ADDRESS,
  privateTokenAddress: PRIVATE_REWARD_TOKEN_ADDRESS,
  decimals: 6,
  publicSymbol: 'WISP',
  privateSymbol: 'pWISP'
} as const;

export type ChainWhisperWispDirection = 'shield' | 'unshield';

export type ChainWhisperWispVerificationIssue =
  | 'wrong-chain'
  | 'bridge-code-missing'
  | 'public-token-code-missing'
  | 'private-token-code-missing'
  | 'public-token-mismatch'
  | 'private-token-mismatch'
  | 'public-decimals-mismatch'
  | 'private-decimals-mismatch'
  | 'verification-read-failed';

export type ChainWhisperWispVerification = {
  status: 'ready' | 'mismatch' | 'unavailable';
  chainId: number | null;
  issues: ChainWhisperWispVerificationIssue[];
  verifiedAt: number;
};

export type ChainWhisperWispQuote = {
  quoteKey: string;
  direction: ChainWhisperWispDirection;
  account: string;
  amountWei: bigint;
  feeWei: bigint;
  cotiOracleTimestamp: bigint;
  tokenOracleTimestamp: bigint;
  blockTimestamp: bigint;
  minAmountWei: bigint;
  maxAmountWei: bigint;
  publicReserveWei: bigint;
  paused: boolean;
  depositEnabled: boolean;
  privatePublicAmountsEnabled: boolean;
  blacklisted: boolean;
  quotedAt: number;
};

export type ChainWhisperWispStage =
  | 'validating'
  | 'public-approval-reset'
  | 'public-approval'
  | 'private-approval'
  | 'refreshing-quote'
  | 'awaiting-conversion'
  | 'confirming'
  | 'complete';

export type ChainWhisperWispConversionResult = {
  transactionHash: string;
  receipt: unknown;
  quote: ChainWhisperWispQuote;
  gasEstimate: bigint;
  gasLimit: bigint;
};

export type ChainWhisperWispSubmittedTransaction = {
  hash?: string;
  wait: () => Promise<unknown>;
};

export const submitAndConfirmChainWhisperWispConversion = async ({
  assertReady,
  submit,
  onProgress
}: {
  assertReady: () => Promise<void>;
  submit: () => Promise<ChainWhisperWispSubmittedTransaction>;
  onProgress?: (stage: ChainWhisperWispStage) => void;
}): Promise<{ transaction: ChainWhisperWispSubmittedTransaction; receipt: unknown }> => {
  await assertReady();
  onProgress?.('awaiting-conversion');
  const transaction = await submit();
  onProgress?.('confirming');
  const receipt = await transaction.wait();
  const receiptStatus = Number((receipt as { status?: number | bigint } | null)?.status ?? 0);
  if (!receipt || receiptStatus !== 1) {
    throw new Error('ChainWhisper WISP conversion failed on-chain.');
  }
  // Once a receipt succeeds it is authoritative. A later wallet/account change must
  // not turn the completed conversion into a retryable failure.
  onProgress?.('complete');
  return { transaction, receipt };
};

export type ChainWhisperWispAmountIssue =
  | 'amount-zero'
  | 'below-minimum'
  | 'above-maximum'
  | 'balance-unavailable'
  | 'insufficient-balance'
  | 'insufficient-reserve'
  | 'native-balance-unavailable'
  | 'insufficient-native-fee-balance';

export type ChainWhisperWispStatusIssue =
  | 'paused'
  | 'deposit-disabled'
  | 'private-public-amounts-disabled'
  | 'blacklisted';

export const validateChainWhisperWispStatus = ({
  direction,
  paused,
  depositEnabled,
  privatePublicAmountsEnabled,
  blacklisted
}: Pick<
  ChainWhisperWispQuote,
  'direction' | 'paused' | 'depositEnabled' | 'privatePublicAmountsEnabled' | 'blacklisted'
>): ChainWhisperWispStatusIssue[] => {
  const issues: ChainWhisperWispStatusIssue[] = [];
  if (paused) {
    issues.push('paused');
  }
  if (direction === 'shield' && !depositEnabled) {
    issues.push('deposit-disabled');
  }
  if (direction === 'unshield' && !privatePublicAmountsEnabled) {
    issues.push('private-public-amounts-disabled');
  }
  if (blacklisted) {
    issues.push('blacklisted');
  }
  return issues;
};

const WISP_STATUS_MESSAGES: Record<ChainWhisperWispStatusIssue, string> = {
  paused: 'The ChainWhisper WISP bridge is paused.',
  'deposit-disabled': 'ChainWhisper WISP deposits are disabled.',
  'private-public-amounts-disabled': 'The pWISP token does not currently support bridge public-amount transfers.',
  blacklisted: 'AddressBlacklisted'
};

export const getChainWhisperWispStatusIssueMessage = (issue: ChainWhisperWispStatusIssue): string =>
  WISP_STATUS_MESSAGES[issue];

export const buildChainWhisperWispQuoteKey = ({
  account,
  direction,
  amountWei
}: {
  account: string;
  direction: ChainWhisperWispDirection;
  amountWei: bigint;
}): string =>
  `${CHAINWHISPER_WISP_BRIDGE_PAIR.chainId}:${account.toLowerCase()}:${direction}:${amountWei}`;

export const parseChainWhisperWispFeeQuote = (value: unknown): {
  feeWei: bigint;
  cotiOracleTimestamp: bigint;
  tokenOracleTimestamp: bigint;
  blockTimestamp: bigint;
} | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const result = value as { [key: number]: unknown };
  if (
    typeof result[0] !== 'bigint' ||
    typeof result[1] !== 'bigint' ||
    typeof result[2] !== 'bigint' ||
    typeof result[3] !== 'bigint'
  ) {
    return null;
  }
  return {
    feeWei: result[0],
    cotiOracleTimestamp: result[1],
    tokenOracleTimestamp: result[2],
    blockTimestamp: result[3]
  };
};

export const resolveChainWhisperWispPublicApprovalAmounts = (
  currentAllowanceWei: bigint,
  targetAmountWei: bigint
): readonly bigint[] => {
  if (currentAllowanceWei === targetAmountWei) {
    return [];
  }
  return currentAllowanceWei > 0n ? [0n, targetAmountWei] : [targetAmountWei];
};

export const validateChainWhisperWispAmount = ({
  direction,
  amountWei,
  minAmountWei,
  maxAmountWei,
  balanceWei,
  publicReserveWei,
  nativeBalanceWei,
  feeWei
}: {
  direction: ChainWhisperWispDirection;
  amountWei: bigint;
  minAmountWei: bigint;
  maxAmountWei: bigint;
  balanceWei: bigint | null;
  publicReserveWei: bigint;
  nativeBalanceWei: bigint | null;
  feeWei: bigint;
}): ChainWhisperWispAmountIssue[] => {
  const issues: ChainWhisperWispAmountIssue[] = [];
  if (amountWei <= 0n) {
    issues.push('amount-zero');
  }
  if (amountWei > 0n && amountWei < minAmountWei) {
    issues.push('below-minimum');
  }
  if (amountWei > maxAmountWei) {
    issues.push('above-maximum');
  }
  if (balanceWei === null) {
    issues.push('balance-unavailable');
  } else if (amountWei > balanceWei) {
    issues.push('insufficient-balance');
  }
  if (direction === 'unshield' && amountWei > publicReserveWei) {
    issues.push('insufficient-reserve');
  }
  if (nativeBalanceWei === null) {
    issues.push('native-balance-unavailable');
  } else if (nativeBalanceWei < feeWei) {
    issues.push('insufficient-native-fee-balance');
  }
  return issues;
};

const WISP_AMOUNT_MESSAGES: Record<ChainWhisperWispAmountIssue, string> = {
  'amount-zero': 'Enter a WISP amount greater than zero.',
  'below-minimum': 'The amount is below the ChainWhisper bridge minimum.',
  'above-maximum': 'The amount is above the ChainWhisper bridge maximum.',
  'balance-unavailable': 'The selected account balance is unavailable. Refresh and try again.',
  'insufficient-balance': 'The selected account does not have enough of the input token.',
  'insufficient-reserve': 'The ChainWhisper WISP bridge does not have enough public reserve.',
  'native-balance-unavailable': 'The selected account COTI balance is unavailable. Refresh and try again.',
  'insufficient-native-fee-balance': 'The selected account does not have enough COTI for the bridge fee.'
};

export const getChainWhisperWispAmountIssueMessage = (issue: ChainWhisperWispAmountIssue): string =>
  WISP_AMOUNT_MESSAGES[issue];

export const buildChainWhisperWispCall = (
  direction: ChainWhisperWispDirection,
  amountWei: bigint,
  quote: Pick<ChainWhisperWispQuote, 'feeWei' | 'cotiOracleTimestamp' | 'tokenOracleTimestamp'>
): {
  functionSignature: 'deposit(uint256,uint256,uint256)' | 'withdraw(uint256,uint256,uint256)';
  args: readonly [bigint, bigint, bigint];
  valueWei: bigint;
} => ({
  functionSignature:
    direction === 'shield'
      ? 'deposit(uint256,uint256,uint256)'
      : 'withdraw(uint256,uint256,uint256)',
  args: [amountWei, quote.cotiOracleTimestamp, quote.tokenOracleTimestamp],
  valueWei: quote.feeWei
});
