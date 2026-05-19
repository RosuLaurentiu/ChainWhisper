import {
  CONTACT_NAME_ENCODING_ONE,
  CONTACT_NAME_ENCODING_ZERO,
  CONTACT_NAME_METADATA_PREFIX,
  CONVERSATION_STATE_METADATA_PREFIX,
  LEGACY_CONVERSATION_STATE_METADATA_PREFIX,
  NICKNAME_DELIMITER,
  PROFILE_METADATA_PREFIX,
  REACTION_METADATA_PREFIX,
  REPLY_DELIMITER,
  REPLY_METADATA_PREFIX,
  extractRevertData,
  getProviderErrorMessage,
  type ChatMessage,
  type TradeAssetPayload,
  type TradeOfferMessagePayload,
  type TradeSnapshot
} from './appShared';

export type MessageReferenceCandidate = {
  txHash?: string;
  blockNumber?: number;
  logIndex?: number;
};

export type TradeTokenPresetKey = string;

export const GCOTI_TOKEN_ADDRESS = '0x7637C7838EC4Ec6b85080F28A678F8E234bB83D1';
export const USDC_E_TOKEN_ADDRESS = '0xf1Feebc4376c68B7003450ae66343Ae59AB37D3C';
export const PRIVATE_COTI_TOKEN_ADDRESS = '0xD2F2692B83C3ecDF2EAa0f7c2632BBd46Ae1cC91';
export const PRIVATE_WETH_TOKEN_ADDRESS = '0x4727FE8D8450CEBcB142331FAc034Cd8d311f0E5';
export const PRIVATE_WBTC_TOKEN_ADDRESS = '0x65449561257ba5756631Aa0d34f07f6457a319be';
export const PRIVATE_USDT_TOKEN_ADDRESS = '0x42107250C3D385ddfABE69ab6de163702040FeB0';
export const PRIVATE_USDC_E_TOKEN_ADDRESS = '0x63C9a1D05471fc8d47C83968725Dcfdcb5410392';
export const PRIVATE_WADA_TOKEN_ADDRESS = '0x3a8b49aAC1dAD86aa45a75231FbeC5bEb810e416';
export const PRIVATE_GCOTI_TOKEN_ADDRESS = '0x394b3c4328160f000763Ca391D07F902926EDaAc';
export const HOTDOG_PRIVATE_TOKEN_ADDRESS = '0x5085Ea0611A9C49316972C57390ca25C9CF236AB';

export const VERIFIED_ECOSYSTEM_TOKENS: Array<{
  address: string;
  kind: Extract<TradeAssetPayload['kind'], 'erc20' | 'private-erc20'>;
  symbol: string;
}> = [
  { address: GCOTI_TOKEN_ADDRESS, kind: 'erc20', symbol: 'gCOTI' },
  { address: '0x659AD6d1F7353Df13Dec552cc05c9c15AfdD04e8', kind: 'erc20', symbol: 'Pengo' },
  { address: '0x256353f5B4b515f488876dD1CAc2300c6C6f98B7', kind: 'erc20', symbol: 'WBBT' },
  { address: '0x8C39B1fD0e6260fdf20652Fc436d25026832bfEA', kind: 'erc20', symbol: 'WBTC' },
  { address: USDC_E_TOKEN_ADDRESS, kind: 'erc20', symbol: 'USDC.e' },
  { address: '0xfA6f73446b17A97a56e464256DA54AD43c2Cbc3E', kind: 'erc20', symbol: 'USDT' },
  { address: '0xe757Ca19d2c237AA52eBb1d2E8E4368eeA3eb331', kind: 'erc20', symbol: 'wADA' },
  { address: '0xFc075Bd3e22d337C19b7Ca25635282ad8e24941a', kind: 'erc20', symbol: 'NIGHT' },
  { address: '0x639aCc80569c5FC83c6FBf2319A6Cc38bBfe26d1', kind: 'erc20', symbol: 'WETH' },
  { address: PRIVATE_COTI_TOKEN_ADDRESS, kind: 'private-erc20', symbol: 'p.COTI' },
  { address: PRIVATE_WETH_TOKEN_ADDRESS, kind: 'private-erc20', symbol: 'p.WETH' },
  { address: PRIVATE_WBTC_TOKEN_ADDRESS, kind: 'private-erc20', symbol: 'p.WBTC' },
  { address: PRIVATE_USDT_TOKEN_ADDRESS, kind: 'private-erc20', symbol: 'p.USDT' },
  { address: PRIVATE_USDC_E_TOKEN_ADDRESS, kind: 'private-erc20', symbol: 'p.USDC.e' },
  { address: PRIVATE_WADA_TOKEN_ADDRESS, kind: 'private-erc20', symbol: 'p.wADA' },
  { address: PRIVATE_GCOTI_TOKEN_ADDRESS, kind: 'private-erc20', symbol: 'p.gCOTI' },
  { address: '0x682e3142e62a7aDe2a0CA5bdC87b205CaDe4B17a', kind: 'private-erc20', symbol: 'pWISP' },
  { address: '0xefe07cbd73538b2f7b3dd8cbc3a435fd4ee16213', kind: 'private-erc20', symbol: 'pPENGO' },
  { address: HOTDOG_PRIVATE_TOKEN_ADDRESS, kind: 'private-erc20', symbol: 'HOTDOG' },
];

export const PUBLIC_TRADE_TOKEN_SYMBOL_ORDER = [
  'gCOTI',
  'USDC.e',
  'WISP',
  'WETH',
  'WBTC',
  'USDT',
  'wADA',
  'Pengo',
  'WBBT',
  'NIGHT'
] as const;

export const PRIVATE_TRADE_TOKEN_SYMBOL_ORDER = [
  'p.COTI',
  'p.gCOTI',
  'p.USDC.e',
  'pWISP',
  'p.WETH',
  'p.WBTC',
  'p.USDT',
  'p.wADA',
  'pPENGO',
  'HOTDOG'
] as const;

export const buildPublicTradeTokenSymbolOrder = (rewardTokenSymbol: string): string[] =>
  PUBLIC_TRADE_TOKEN_SYMBOL_ORDER.map((symbol) => (symbol === 'WISP' ? rewardTokenSymbol : symbol));

export const buildPrivateTradeTokenSymbolOrder = (privateRewardTokenSymbol: string): string[] =>
  PRIVATE_TRADE_TOKEN_SYMBOL_ORDER.map((symbol) => (symbol === 'pWISP' ? privateRewardTokenSymbol : symbol));

export const sortTradeTokenOptionsBySymbol = <T extends { symbol?: string }>(options: T[], symbolOrder: string[]): T[] => {
  const orderBySymbol = new Map(symbolOrder.map((symbol, index) => [symbol.toLowerCase(), index]));
  return options
    .map((option, index) => ({
      option,
      index,
      rank: orderBySymbol.get(option.symbol?.toLowerCase() ?? '') ?? Number.MAX_SAFE_INTEGER
    }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ option }) => option);
};

const VERIFIED_ECOSYSTEM_TOKEN_ADDRESS_SET = new Set(
  VERIFIED_ECOSYSTEM_TOKENS.map((t) => t.address.toLowerCase())
);
const VERIFIED_ECOSYSTEM_TOKEN_BY_ADDRESS = new Map(
  VERIFIED_ECOSYSTEM_TOKENS.map((token) => [token.address.toLowerCase(), token] as const)
);

export const isVerifiedEcosystemToken = (address: string): boolean =>
  VERIFIED_ECOSYSTEM_TOKEN_ADDRESS_SET.has(address.toLowerCase());

export const getVerifiedEcosystemToken = (address: string) =>
  VERIFIED_ECOSYSTEM_TOKEN_BY_ADDRESS.get(address.trim().toLowerCase());

export type ResolvedTradeToken = Omit<TradeAssetPayload, 'amount'>;

export type PrivateTokenBalanceState =
  | { status: 'locked' }
  | { status: 'setup-needed' }
  | { status: 'setup-pending' }
  | { status: 'ready'; balanceWei: bigint }
  | { status: 'decrypt-failed' }
  | { status: 'snap-stale' }
  | { status: 'unsupported' };

export type PrivateTokenBalancePrivacyAction = 'none' | 'setup' | 'repair';

export const resolvePrivateTokenBalancePrivacyAction = (
  state?: PrivateTokenBalanceState
): PrivateTokenBalancePrivacyAction => {
  if (state?.status === 'setup-needed') {
    return 'setup';
  }
  if (state?.status === 'decrypt-failed' || state?.status === 'snap-stale') {
    return 'repair';
  }
  return 'none';
};

export const privateTokenBalanceStateNeedsPrivacyAction = (
  state?: PrivateTokenBalanceState
): boolean => resolvePrivateTokenBalancePrivacyAction(state) !== 'none';

export type TradeCustomTokenInfo = {
  kind: Extract<TradeAssetPayload['kind'], 'erc20' | 'private-erc20'>;
  address: string;
  symbol: string;
  decimals: number;
  balanceWei: bigint | null;
  loading: boolean;
  error?: string;
  walletKey?: string;
  aesReady?: boolean;
  privateBalanceState?: PrivateTokenBalanceState;
};

export type TradeComposerFieldErrors = {
  general?: string;
  fee?: string;
  offerAsset?: string;
  requestAsset?: string;
  offerAmount?: string;
  requestAmount?: string;
  expiry?: string;
};

export type PendingTradeCounterContext = {
  offer: TradeOfferMessagePayload;
  sourceMessage: ChatMessage;
};

export const DEFAULT_TRADE_EXPIRY_HOURS = '24';

const TRADE_STATUS_OPEN = 1;
const TRADE_STATUS_ACCEPTED = 2;
const TRADE_STATUS_CANCELLED = 3;
const TRADE_STATUS_DECLINED = 4;
const TRADE_STATUS_EXPIRED = 5;
const TRADE_ASSET_TYPE_NATIVE = 0;
const TRADE_ASSET_TYPE_ERC20 = 1;
const TRADE_ASSET_TYPE_PRIVATE_ERC20 = 2;

const TRADE_ERROR_MESSAGE_BY_SELECTOR: Record<string, string> = {
  '0xfceb320b': 'This trade needs its full private link before it can be accepted.',
  '0x025dbdd4': 'Insufficient escrow fee. Check the required COTI fee and try again.',
  '0xe6c4247b': 'Invalid wallet address for this trade action.',
  '0x8a8b5302': 'This order side is not available for that fill path.',
  '0x2723e9c2': 'The COTI amount sent does not match the fill amount.',
  '0x94697444': 'Enter a valid fill amount for this order side.',
  '0x8b2024a5': 'This order side does not have enough inventory for that fill.',
  '0x914e7cb8': 'Enter a private-token amount greater than zero.',
  '0x90b8ec18': 'Private token transfer failed. Check balance, privacy unlock, and approval.'
};

export const resolveTradeSnapshotStatus = (statusRaw: unknown, expiresAt: number): TradeSnapshot['status'] => {
  const status = Number(statusRaw);
  if (status === TRADE_STATUS_OPEN) {
    return expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1000) ? 'expired' : 'open';
  }
  if (status === TRADE_STATUS_ACCEPTED) {
    return 'accepted';
  }
  if (status === TRADE_STATUS_CANCELLED) {
    return 'cancelled';
  }
  if (status === TRADE_STATUS_DECLINED) {
    return 'declined';
  }
  if (status === TRADE_STATUS_EXPIRED) {
    return 'expired';
  }
  return 'unknown';
};

export const isCustomTradeTokenSelection = (selection: TradeTokenPresetKey): boolean =>
  selection === 'custom-public' || selection === 'custom-private';

export const resolveTradePresetKind = (selection: TradeTokenPresetKey): TradeAssetPayload['kind'] => {
  if (selection === 'coti') {
    return 'native';
  }
  const verifiedToken = getVerifiedEcosystemToken(selection);
  if (verifiedToken) {
    return verifiedToken.kind;
  }
  return selection === 'pwisp' || selection === 'custom-private' ? 'private-erc20' : 'erc20';
};

export const buildTradeCustomTokenInfoKey = (
  kind: Extract<TradeAssetPayload['kind'], 'erc20' | 'private-erc20'>,
  address: string
): string => `${kind}:${address.trim().toLowerCase()}`;

export const resolveTradeAssetTypeValue = (kind: TradeAssetPayload['kind']): number => {
  if (kind === 'native') {
    return TRADE_ASSET_TYPE_NATIVE;
  }
  return kind === 'private-erc20' ? TRADE_ASSET_TYPE_PRIVATE_ERC20 : TRADE_ASSET_TYPE_ERC20;
};

const SHARED_TX_REFERENCE_PREFIX_BYTES = 4;
const SHARED_TX_REFERENCE_PREFIX_BASE64_LENGTH = 6;
const SHARED_TX_REFERENCE_REGEX = new RegExp(
  `^x([0-9a-z]+)-([A-Za-z0-9\\-_]{${SHARED_TX_REFERENCE_PREFIX_BASE64_LENGTH}})$`
);
const CHAT_GC_MESSAGE_REFERENCE_REGEX = /^chatgc:\d+:0x[a-f0-9]{40}:\d+$/;

const isSafeReferencePart = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const buildSharedTxReference = (txHash?: string, blockNumber?: number): string => {
  const normalizedTxHash = txHash?.trim().toLowerCase() ?? '';
  if (!/^0x[a-f0-9]{64}$/.test(normalizedTxHash) || !isSafeReferencePart(blockNumber)) {
    return '';
  }

  const prefixHexLength = SHARED_TX_REFERENCE_PREFIX_BYTES * 2;
  const prefixHex = normalizedTxHash.slice(2, 2 + prefixHexLength);
  let binary = '';
  for (let index = 0; index < prefixHex.length; index += 2) {
    const nextByte = Number.parseInt(prefixHex.slice(index, index + 2), 16);
    if (!Number.isFinite(nextByte) || nextByte < 0 || nextByte > 255) {
      return '';
    }
    binary += String.fromCharCode(nextByte);
  }

  return `x${blockNumber.toString(36)}-${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
};

export const parseSharedTxReference = (
  value?: string
): { normalizedReference: string; blockNumber: number; txHashPrefix: string } | null => {
  const trimmedValue = value?.trim() ?? '';
  const match = trimmedValue.match(SHARED_TX_REFERENCE_REGEX);
  if (!match) {
    return null;
  }

  const blockNumber = Number.parseInt(match[1], 36);
  if (!isSafeReferencePart(blockNumber)) {
    return null;
  }

  const txHashPrefix = match[2];
  return {
    normalizedReference: `x${match[1].toLowerCase()}-${txHashPrefix}`,
    blockNumber,
    txHashPrefix
  };
};

export const buildMessageReferenceKeys = ({ txHash, blockNumber, logIndex }: MessageReferenceCandidate): string[] => {
  const keys = new Set<string>();
  const sharedReference = parseSharedTxReference(txHash);
  if (sharedReference) {
    keys.add(`s:${sharedReference.normalizedReference}`);
  }

  const normalizedTxHash = txHash?.trim().toLowerCase() ?? '';
  if (CHAT_GC_MESSAGE_REFERENCE_REGEX.test(normalizedTxHash)) {
    keys.add(`m:${normalizedTxHash}`);
  }

  if (/^0x[a-f0-9]{64}$/.test(normalizedTxHash)) {
    keys.add(`t:${normalizedTxHash}`);
    const compactSharedReference = buildSharedTxReference(normalizedTxHash, blockNumber);
    if (compactSharedReference) {
      keys.add(`s:${compactSharedReference}`);
    }
  }

  if (isSafeReferencePart(blockNumber) && isSafeReferencePart(logIndex)) {
    keys.add(`b:${blockNumber}:${logIndex}`);
  }

  return Array.from(keys);
};

export const buildMessageReferenceKey = (candidate: MessageReferenceCandidate): string =>
  buildMessageReferenceKeys(candidate)[0] ?? '';

export const messageReferencesMatch = (left: MessageReferenceCandidate, right: MessageReferenceCandidate): boolean => {
  const leftKeys = buildMessageReferenceKeys(left);
  if (leftKeys.length === 0) {
    return false;
  }

  const rightKeys = new Set(buildMessageReferenceKeys(right));
  return leftKeys.some((key) => rightKeys.has(key));
};

const OUTGOING_HIDDEN_METADATA_CHARACTERS_REGEX = new RegExp(
  `[${[
    CONVERSATION_STATE_METADATA_PREFIX,
    PROFILE_METADATA_PREFIX,
    REPLY_METADATA_PREFIX,
    CONTACT_NAME_METADATA_PREFIX,
    REACTION_METADATA_PREFIX,
    LEGACY_CONVERSATION_STATE_METADATA_PREFIX,
    CONTACT_NAME_ENCODING_ZERO,
    CONTACT_NAME_ENCODING_ONE,
    REPLY_DELIMITER,
    NICKNAME_DELIMITER
  ].join('')}]`,
  'g'
);

export const sanitizeOutgoingMessagePlainText = (value: string): string =>
  value.replace(/\r/g, '').replace(OUTGOING_HIDDEN_METADATA_CHARACTERS_REGEX, '');

const isLikelyOutOfGasFailure = (error: unknown): boolean => {
  const receipt = (error as { receipt?: { gasUsed?: bigint; gasLimit?: bigint } } | null)?.receipt;
  const transaction = (error as { transaction?: { gasLimit?: bigint } } | null)?.transaction;
  const gasUsed = receipt?.gasUsed;
  const gasLimit = receipt?.gasLimit ?? transaction?.gasLimit;
  if (typeof gasUsed !== 'bigint' || typeof gasLimit !== 'bigint' || gasLimit <= 0n) {
    return false;
  }

  return gasUsed >= gasLimit - 5_000n;
};

export const getOnChainFailureMessage = (error: unknown, fallbackMessage: string): string => {
  if (isLikelyOutOfGasFailure(error)) {
    return 'Transaction ran out of gas on-chain. Try a shorter message, clear any reply, or use a smaller group.';
  }

  const revertData = extractRevertData(error);
  if (revertData) {
    const mappedMessage = TRADE_ERROR_MESSAGE_BY_SELECTOR[revertData.slice(0, 10).toLowerCase()];
    if (mappedMessage) {
      return mappedMessage;
    }
  }

  const providerMessage = getProviderErrorMessage(error, fallbackMessage);
  const normalizedProviderMessage = providerMessage.toLowerCase();
  if (normalizedProviderMessage.includes('unknown custom error') || normalizedProviderMessage.includes('execution reverted')) {
    return fallbackMessage;
  }

  return providerMessage;
};
