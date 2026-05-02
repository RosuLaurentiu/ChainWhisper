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

export const resolveTradeEscrowContractConfig = (escrowContract?: string | null): TradeEscrowConfig => {
  const address = normalizeEscrowAddress(escrowContract);
  if (address.toLowerCase() === PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase()) {
    return {
      address: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
      abi: PRIVATE_TRADE_ESCROW_CONTRACT_ABI,
      hiddenOnly: true
    };
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

  return {
    isPublic,
    hasAccessHash,
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
  signer: Wallet | JsonRpcSigner
): Promise<bigint | null> => {
  if (encryptedValue === null || encryptedValue === undefined) {
    return null;
  }

  try {
    const decrypted = await signer.decryptValue(encryptedValue as never);
    if (typeof decrypted === 'bigint') {
      return decrypted <= PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE ? decrypted : null;
    }
    if (typeof decrypted === 'string' && /^\d+$/.test(decrypted.trim())) {
      const parsed = BigInt(decrypted.trim());
      return parsed <= PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE ? parsed : null;
    }
  } catch {
  }

  return null;
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
  const callData = privateTradeInterface.encodeFunctionData('offboardPrivateFixedPriceRemainingForMaker', [tradeId]);
  const rawResult = await readProvider.call({
    from: makerAddress,
    to: config.address,
    data: callData
  });
  const decoded = privateTradeInterface.decodeFunctionResult('offboardPrivateFixedPriceRemainingForMaker', rawResult);
  const encryptedRemainingRaw = decoded?.[0] as { userCiphertext?: unknown; [key: number]: unknown } | null | undefined;
  const userCiphertext = encryptedRemainingRaw?.userCiphertext ?? encryptedRemainingRaw?.[1] ?? encryptedRemainingRaw;
  return decryptPrivateUintValue(userCiphertext, signer);
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
  const allowanceCallData = privateTokenInterface.encodeFunctionData('allowance', [spenderAddress, true]);
  const allowanceRawResult = await readProvider.call({
    from: ownerAddress,
    to: tokenAddress,
    data: allowanceCallData
  });
  const decodedAllowance = privateTokenInterface.decodeFunctionResult('allowance', allowanceRawResult);
  return decryptPrivateUintValue(decodedAllowance?.[0] ?? null, signer);
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

export const fetchTradeAccessMetadataById = async (
  tradeId: number,
  escrowContract?: string
): Promise<TradeAccessMetadata> => {
  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const config = resolveTradeEscrowContractConfig(escrowContract);
  const contract = new cotiEthers.Contract(config.address, config.abi, readProvider);
  const metadataRaw = await contract.getTradeMetadata(tradeId);
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
  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const config = resolveTradeEscrowContractConfig(options.escrowContract);
  const contract = new cotiEthers.Contract(config.address, config.abi, readProvider);
  const tradeRaw = await contract.getTrade(tradeId);
  const [metadataRaw, fillStateRaw, counterParentRaw, replacementRaw, replacesRaw] = await Promise.all([
    contract.getTradeMetadata?.(tradeId).catch(() => null),
    contract.getTradeFillState?.(tradeId).catch(() => null),
    contract.counterParentTradeId?.(tradeId).catch(() => null),
    contract.replacementTradeId?.(tradeId).catch(() => null),
    contract.replacesTradeId?.(tradeId).catch(() => null)
  ]);
  const maker = String((tradeRaw as { maker?: unknown }).maker ?? tradeRaw?.[0] ?? '').trim();
  const taker = String((tradeRaw as { taker?: unknown }).taker ?? tradeRaw?.[1] ?? '').trim();
  const statusRaw = (tradeRaw as { status?: unknown }).status ?? tradeRaw?.[2];
  const offerAssetRaw = (tradeRaw as { offerAsset?: unknown }).offerAsset ?? tradeRaw?.[3];
  const requestAssetRaw = (tradeRaw as { requestAsset?: unknown }).requestAsset ?? tradeRaw?.[4];
  const createdAt = toSafeNumber((tradeRaw as { createdAt?: unknown }).createdAt ?? tradeRaw?.[5]);
  const expiresAt = toSafeNumber((tradeRaw as { expiresAt?: unknown }).expiresAt ?? tradeRaw?.[6]);
  const offerAssetType = (offerAssetRaw as { assetType?: unknown })?.assetType ?? offerAssetRaw?.[0] ?? 0;
  const offerToken = (offerAssetRaw as { token?: unknown })?.token ?? offerAssetRaw?.[1] ?? '';
  const offerAmount = (offerAssetRaw as { amount?: unknown })?.amount ?? offerAssetRaw?.[2] ?? 0n;
  const requestAssetType = (requestAssetRaw as { assetType?: unknown })?.assetType ?? requestAssetRaw?.[0] ?? 0;
  const requestToken = (requestAssetRaw as { token?: unknown })?.token ?? requestAssetRaw?.[1] ?? '';
  const requestAmount = (requestAssetRaw as { amount?: unknown })?.amount ?? requestAssetRaw?.[2] ?? 0n;
  const { isPublic, hasAccessHash, parentTradeId } = parseTradeAccessMetadata(metadataRaw);
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

  const snapshotGroups = await Promise.all(
    configs.map(async (config) => {
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
    })
  );

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
  const snapshotGroups = await Promise.all(
    configs.map(async (config) => {
      const contract = new cotiEthers.Contract(config.address, config.abi, readProvider);
      const [makerIdsRaw, takerIdsRaw, fillerIdsRaw] = await Promise.all([
        contract.getTradeIdsForMaker(walletAddress, 0, safeLimit).catch(() => null),
        contract.getTradeIdsForTaker(walletAddress, 0, safeLimit).catch(() => null),
        contract.getTradeIdsForFiller?.(walletAddress, 0, safeLimit).catch(() => null)
      ]);
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
          }).catch(() => null)
        )
      );
    })
  );

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
