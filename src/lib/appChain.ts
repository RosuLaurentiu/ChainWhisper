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

export const fetchTradeSnapshotById = async (
  tradeId: number,
  options: {
    rewardTokenSymbol: string;
    rewardTokenDecimals: number;
    privateRewardTokenSymbol: string;
    privateRewardTokenDecimals: number;
  }
): Promise<TradeSnapshot> => {
  const cotiEthers = await loadCotiEthersModule();
  const readProvider = await loadCotiReadProvider(true);
  const contract = new cotiEthers.Contract(TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ABI, readProvider);
  const tradeRaw = await contract.getTrade(tradeId);
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
  let acceptedTxHash: string | undefined;

  if (resolvedStatus === 'accepted') {
    try {
      const acceptedLogs = await contract.queryFilter(contract.filters.TradeAccepted(BigInt(tradeId), null), 0, 'latest');
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
    maker,
    taker,
    offer,
    request,
    createdAt,
    expiresAt,
    status: resolvedStatus,
    acceptedTxHash
  };
};

export const ensureTradeTokenAllowance = async (
  signer: Wallet | JsonRpcSigner,
  ownerAddress: string,
  tokenAddress: string,
  requiredAmount: bigint,
  kind: Extract<TradeAssetPayload['kind'], 'erc20' | 'private-erc20'> = 'erc20'
): Promise<void> => {
  if (requiredAmount <= 0n || !isWalletAddress(tokenAddress)) {
    return;
  }

  if (kind === 'private-erc20') {
    if (requiredAmount > PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE) {
      throw new Error('Private token amount exceeds the maximum plaintext size supported by COTI private ERC-20.');
    }

    const allowance = await readPrivateTokenAllowanceWei(
      tokenAddress,
      ownerAddress,
      TRADE_ESCROW_CONTRACT_ADDRESS,
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
    const approveTx = await privateTokenContract.approve(TRADE_ESCROW_CONTRACT_ADDRESS, encryptedApproval);
    await approveTx.wait();
    return;
  }

  const cotiEthers = await loadCotiEthersModule();
  const tokenContract = new cotiEthers.Contract(tokenAddress, ERC20_TOKEN_ABI, signer);
  const allowanceRaw = await tokenContract.allowance(ownerAddress, TRADE_ESCROW_CONTRACT_ADDRESS).catch(() => null);
  const allowance = typeof allowanceRaw === 'bigint' ? allowanceRaw : 0n;
  if (allowance >= requiredAmount) {
    return;
  }

  const approveTx = await tokenContract.approve(TRADE_ESCROW_CONTRACT_ADDRESS, MAX_ERC20_APPROVAL);
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
