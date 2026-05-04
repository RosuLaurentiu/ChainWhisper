import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import {
  ERC20_TOKEN_ABI,
  FALLBACK_REWARD_TOKEN_DECIMALS,
  GROUP_CHAT_CONTRACT_ABI,
  GROUP_CHAT_CONTRACT_ADDRESS,
  GROUP_SUBMIT_GAS_BUFFER,
  GROUP_SUBMIT_GAS_LIMIT_MAX,
  MAX_ERC20_APPROVAL,
  PRIVATE_ERC20_TOKEN_ABI,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ABI,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TOKEN_BALANCE_ABI,
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

const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
const ACCEPTED_TX_LOOKBACK_BLOCKS = 100_000;
const PRIVATE_TOKEN_WRITE_GAS_LIMIT = 4_000_000n;

type TradeEscrowConfig = {
  address: string;
  abi: typeof TRADE_ESCROW_CONTRACT_ABI | typeof PRIVATE_TRADE_ESCROW_CONTRACT_ABI;
  hiddenOnly: boolean;
};

const normalizeEscrowAddress = (value?: string | null): string =>
  typeof value === 'string' && isWalletAddress(value) ? value : TRADE_ESCROW_CONTRACT_ADDRESS;

const isRecurringOrderContractAddress = (value?: string | null): boolean =>
  typeof value === 'string' && isWalletAddress(value) && value.toLowerCase() === RECURRING_OTC_CONTRACT_ADDRESS.toLowerCase();

export const isActiveTradeEscrowContractAddress = (value?: string | null): boolean => {
  const address = normalizeEscrowAddress(value).toLowerCase();
  return (
    address === TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase() ||
    address === PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase() ||
    address === RECURRING_OTC_CONTRACT_ADDRESS.toLowerCase()
  );
};

export const resolveTradeEscrowContractConfig = (escrowContract?: string | null): TradeEscrowConfig => {
  const address = normalizeEscrowAddress(escrowContract);
  if (address.toLowerCase() === PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase()) {
    return {
      address: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
      abi: PRIVATE_TRADE_ESCROW_CONTRACT_ABI,
      hiddenOnly: true
    };
  }
  if (address.toLowerCase() !== TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase()) {
    throw new Error('This trade link uses a retired contract and is not supported by the current app.');
  }

  return {
    address: TRADE_ESCROW_CONTRACT_ADDRESS,
    abi: TRADE_ESCROW_CONTRACT_ABI,
    hiddenOnly: false
  };
};

export type TradeAccessMetadata = {
  isPublic?: boolean;
  hasAccessHash?: boolean;
  accessHash?: string;
  parentTradeId?: number;
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

const decryptPrivateUintValue = async (
  encryptedValue: unknown,
  signer: Wallet | JsonRpcSigner,
  recoverOnFailure = false
): Promise<bigint | null> => {
  if (encryptedValue === null || encryptedValue === undefined) {
    return null;
  }

  const parseDecryptedValue = (decrypted: unknown): bigint | null => {
    if (typeof decrypted === 'bigint') {
      return decrypted <= PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE ? decrypted : null;
    }
    if (typeof decrypted === 'string' && /^\d+$/.test(decrypted.trim())) {
      const parsed = BigInt(decrypted.trim());
      return parsed <= PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE ? parsed : null;
    }
    return null;
  };

  try {
    const decrypted = await signer.decryptValue(encryptedValue as never);
    return parseDecryptedValue(decrypted);
  } catch {
  }

  if (recoverOnFailure) {
    const previousOnboardInfo = signer.getUserOnboardInfo();
    try {
      signer.clearUserOnboardInfo();
      await signer.generateOrRecoverAes();
      const decrypted = await signer.decryptValue(encryptedValue as never);
      return parseDecryptedValue(decrypted);
    } catch {
      if (previousOnboardInfo) {
        signer.setUserOnboardInfo(previousOnboardInfo);
      }
    }
  }

  return null;
};

const extractUserCiphertext = (encryptedValue: unknown): unknown => {
  const encrypted = encryptedValue as { userCiphertext?: unknown; [key: number]: unknown } | null | undefined;
  return encrypted?.userCiphertext ?? encrypted?.[1] ?? encryptedValue;
};

export const readPrivateTokenBalanceWei = async (
  tokenAddress: string,
  ownerAddress: string,
  signer: Wallet | JsonRpcSigner
): Promise<bigint | null> => {
  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const privateTokenInterface = new cotiEthers.Interface(PRIVATE_TOKEN_BALANCE_ABI);

  let encryptedBalanceRaw: unknown = null;
  try {
    const balanceByAddressCallData = privateTokenInterface.encodeFunctionData('balanceOf(address)', [ownerAddress]);
    const balanceByAddressRawResult = await readProvider.call({
      from: ownerAddress,
      to: tokenAddress,
      data: balanceByAddressCallData
    });
    const decodedByAddress = privateTokenInterface.decodeFunctionResult(
      'balanceOf(address)',
      balanceByAddressRawResult
    );
    encryptedBalanceRaw = decodedByAddress?.[0] ?? null;
  } catch {
    encryptedBalanceRaw = null;
  }

  if (encryptedBalanceRaw === null) {
    try {
      const balanceCallData = privateTokenInterface.encodeFunctionData('balanceOf()', []);
      const balanceRawResult = await readProvider.call({
        from: ownerAddress,
        to: tokenAddress,
        data: balanceCallData
      });
      const decodedBalance = privateTokenInterface.decodeFunctionResult('balanceOf()', balanceRawResult);
      encryptedBalanceRaw = decodedBalance?.[0] ?? null;
    } catch {
      encryptedBalanceRaw = null;
    }
  }

  return decryptPrivateUintValue(encryptedBalanceRaw, signer);
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

const readPrivateTokenAllowanceWei = async (
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string,
  signer: Wallet | JsonRpcSigner
): Promise<bigint | null> => {
  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const privateTokenInterface = new cotiEthers.Interface(PRIVATE_ERC20_TOKEN_ABI);
  const allowanceCallData = privateTokenInterface.encodeFunctionData('allowance(address,address)', [
    ownerAddress,
    spenderAddress
  ]);
  const allowanceRawResult = await readProvider.call({
    from: ownerAddress,
    to: tokenAddress,
    data: allowanceCallData
  });
  const decodedAllowance = privateTokenInterface.decodeFunctionResult(
    'allowance(address,address)',
    allowanceRawResult
  );
  const allowance = decodedAllowance?.[0] as
    | { ownerCiphertext?: unknown; [key: number]: unknown }
    | null
    | undefined;
  const ownerCiphertext = allowance?.ownerCiphertext ?? allowance?.[1] ?? null;
  return decryptPrivateUintValue(ownerCiphertext, signer);
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
      kind === 'private-erc20' ? PRIVATE_TOKEN_BALANCE_ABI : ERC20_TOKEN_ABI,
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
  }
): Promise<TradeSnapshot> => {
  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const contract = new cotiEthers.Contract(RECURRING_OTC_CONTRACT_ADDRESS, RECURRING_OTC_CONTRACT_ABI, readProvider);
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
  }
): Promise<TradeSnapshot[]> => {
  if (orderIds.length === 0) {
    return [];
  }

  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const contract = new cotiEthers.Contract(RECURRING_OTC_CONTRACT_ADDRESS, RECURRING_OTC_CONTRACT_ABI, readProvider);
  const orderViewsRaw = await contract.getOrderViews(orderIds);
  const orderViews = Array.isArray(orderViewsRaw) ? orderViewsRaw : [];
  const snapshots = await Promise.all(
    orderIds.map((orderId, index) =>
      buildRecurringOrderSnapshotFromView(orderId, orderViews[index], options).catch(() => null)
    )
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
  return parseTradeAccessMetadata(metadataRaw);
};

export const fetchTradeSnapshotById = async (
  tradeId: number,
  options: {
    rewardTokenSymbol: string;
    rewardTokenDecimals: number;
    privateRewardTokenSymbol: string;
    privateRewardTokenDecimals: number;
    escrowContract?: string;
  }
): Promise<TradeSnapshot> => {
  if (isRecurringOrderContractAddress(options.escrowContract)) {
    return fetchRecurringOrderSnapshotById(tradeId, options);
  }

  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const config = resolveTradeEscrowContractConfig(options.escrowContract);
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
  const viewFillStateRaw = tradeView?.fillState ?? indexedTradeView?.[2];
  const viewEffectiveStatusRaw =
    tradeView?.effectiveStatus ?? indexedTradeView?.[config.hiddenOnly ? 3 : 4];
  const viewReplacementRaw =
    tradeView?.replacementTradeId ?? indexedTradeView?.[config.hiddenOnly ? 4 : 5];
  const viewReplacesRaw =
    tradeView?.replacesTradeId ?? indexedTradeView?.[config.hiddenOnly ? 5 : 6];
  const [counterParentRaw, replacementRaw, replacesRaw] = await Promise.all([
    typeof contract.counterParentTradeId === 'function'
      ? contract.counterParentTradeId(tradeId).catch(() => null)
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
  const offerAssetRaw = (tradeRaw?.offerAsset ?? tradeRaw?.[3]) as
    | { assetType?: unknown; token?: unknown; amount?: unknown; [key: number]: unknown }
    | null
    | undefined;
  const requestAssetRaw = (tradeRaw?.requestAsset ?? tradeRaw?.[4]) as
    | { assetType?: unknown; token?: unknown; amount?: unknown; [key: number]: unknown }
    | null
    | undefined;
  const createdAt = toSafeNumber(tradeRaw?.createdAt ?? tradeRaw?.[5]);
  const expiresAt = toSafeNumber(tradeRaw?.expiresAt ?? tradeRaw?.[6]);
  const offerAssetType = offerAssetRaw?.assetType ?? offerAssetRaw?.[0] ?? 0;
  const offerToken = offerAssetRaw?.token ?? offerAssetRaw?.[1] ?? '';
  const offerAmount = offerAssetRaw?.amount ?? offerAssetRaw?.[2] ?? 0n;
  const requestAssetType = requestAssetRaw?.assetType ?? requestAssetRaw?.[0] ?? 0;
  const requestToken = requestAssetRaw?.token ?? requestAssetRaw?.[1] ?? '';
  const requestAmount = requestAssetRaw?.amount ?? requestAssetRaw?.[2] ?? 0n;
  const { isPublic, hasAccessHash, accessHash, parentTradeId: parsedParentTradeId } = parseTradeAccessMetadata(metadataRaw);
  const parentTradeId = config.hiddenOnly ? undefined : parsedParentTradeId;
  const fillState = parseTradeFillState(fillStateRaw, offerAmount, requestAmount);
  const counterParentTradeId = parseOptionalTradeId(counterParentRaw);
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

  return {
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
    counterParentTradeId,
    replacementTradeId,
    replacesTradeId,
    fillState,
    acceptedTxHash,
    hiddenLiquidity
  };
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
  const configs = [
    resolveTradeEscrowContractConfig(TRADE_ESCROW_CONTRACT_ADDRESS),
    resolveTradeEscrowContractConfig(PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS)
  ];

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
              escrowContract: config.address
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
            escrowContract: config.address
          }).catch(() => null)
        )
      );
    }),
    (async () => {
      const contract = new cotiEthers.Contract(RECURRING_OTC_CONTRACT_ADDRESS, RECURRING_OTC_CONTRACT_ABI, readProvider);
      const openOrderIdsRaw = await contract.getOpenPublicOrderIds(0, safeLimit).catch(() => null);
      const orderIds = resolveRecurringIdsFromPagedResult(openOrderIdsRaw);
      const snapshots = await fetchRecurringOrderSnapshotsByIds(orderIds, {
        rewardTokenSymbol: options.rewardTokenSymbol,
        rewardTokenDecimals: options.rewardTokenDecimals,
        privateRewardTokenSymbol: options.privateRewardTokenSymbol,
        privateRewardTokenDecimals: options.privateRewardTokenDecimals
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
  const resolveIds = (raw: unknown): number[] => {
    const idsRaw = Array.isArray(raw) ? raw[0] : null;
    return Array.isArray(idsRaw)
      ? idsRaw.map((value: unknown) => toSafeNumber(value)).filter((value: number) => value > 0)
      : [];
  };
  const configs = [
    resolveTradeEscrowContractConfig(TRADE_ESCROW_CONTRACT_ADDRESS),
    resolveTradeEscrowContractConfig(PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS)
  ];
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
            escrowContract: config.address
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
      const contract = new cotiEthers.Contract(RECURRING_OTC_CONTRACT_ADDRESS, RECURRING_OTC_CONTRACT_ABI, readProvider);
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
        privateRewardTokenDecimals: options.privateRewardTokenDecimals
      }).catch(() => []);
      return snapshots.map((snapshot) =>
        recurringFillerIdSet.has(snapshot.tradeId) ? { ...snapshot, walletHasFill: true } : snapshot
      );
    })()
  ]);

  return snapshotGroups
    .flat()
    .filter((snapshot): snapshot is TradeSnapshot => snapshot !== null)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, safeLimit);
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

    const allowance = await readPrivateTokenAllowanceWei(
      tokenAddress,
      ownerAddress,
      spenderAddress,
      signer
    ).catch(() => null);
    if (allowance !== null && allowance >= requiredAmount) {
      return;
    }

    const cotiEthers = await loadCotiEthersModule();
    const privateTokenInterface = new cotiEthers.Interface(PRIVATE_ERC20_TOKEN_ABI);
    const approveSelector = privateTokenInterface.getFunction('approve')?.selector;
    if (!approveSelector) {
      throw new Error('Unable to prepare private token approval.');
    }

    const privateTokenContract = new cotiEthers.Contract(tokenAddress, PRIVATE_ERC20_TOKEN_ABI, signer);
    const encryptedApproval = await signer.encryptValue(
      PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE,
      tokenAddress,
      approveSelector
    );
    const approveTx = await privateTokenContract.approve(spenderAddress, encryptedApproval, {
      gasLimit: PRIVATE_TOKEN_WRITE_GAS_LIMIT
    });
    await approveTx.wait();
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
