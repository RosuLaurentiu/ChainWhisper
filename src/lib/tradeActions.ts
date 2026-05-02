import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import { ensureTradeTokenAllowance, resolveTradeEscrowContractConfig } from './appChain';
import { resolveTradeAssetTypeValue } from './appHelpers';
import {
  loadCotiEthersModule,
  PRIVATE_TRADE_ESCROW_CONTRACT_ABI,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  toSafeNumber,
  TRADE_ESCROW_CONTRACT_ABI,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload
} from './appShared';

type TradeSigner = Wallet | JsonRpcSigner;

type TradeAssetSelection = Pick<TradeAssetPayload, 'kind' | 'tokenAddress'>;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
const PRIVATE_TRADE_WRITE_GAS_LIMIT = 4_000_000n;

const createTradeContract = async (runner: TradeSigner, escrowContract?: string) => {
  const cotiEthers = await loadCotiEthersModule();
  const config = resolveTradeEscrowContractConfig(escrowContract);
  return new cotiEthers.Contract(config.address, config.abi, runner);
};

const requireSuccessfulReceipt = <T extends { status?: number | bigint } | null | undefined>(
  receipt: T,
  errorMessage: string
): NonNullable<T> => {
  if (!receipt || Number((receipt as { status?: number | bigint }).status ?? 0) !== 1) {
    throw new Error(errorMessage);
  }

  return receipt as NonNullable<T>;
};

const resolveAcceptedTxHash = (
  tx: { hash?: unknown },
  receipt: { hash?: unknown; transactionHash?: unknown }
): string | undefined => {
  if (typeof receipt.hash === 'string' && receipt.hash) {
    return receipt.hash;
  }
  if (typeof receipt.transactionHash === 'string' && receipt.transactionHash) {
    return receipt.transactionHash;
  }
  if (typeof tx.hash === 'string' && tx.hash) {
    return tx.hash;
  }

  return undefined;
};

export const closeCounterTradeOnChain = async ({
  signer,
  tradeId,
  actorRole
}: {
  signer: TradeSigner;
  tradeId: number;
  actorRole: 'maker' | 'taker';
}): Promise<'cancelled' | 'declined'> => {
  const tradeContract = await createTradeContract(signer);
  const tx =
    actorRole === 'maker' ? await tradeContract.cancelTrade(tradeId) : await tradeContract.declineTrade(tradeId);
  requireSuccessfulReceipt(await tx.wait(), 'Failed to close the original trade.');
  return actorRole === 'maker' ? 'cancelled' : 'declined';
};

const buildTradeAssetTuple = (asset: TradeAssetSelection, amountWei: bigint) =>
  [
    resolveTradeAssetTypeValue(asset.kind),
    asset.tokenAddress ?? ZERO_ADDRESS,
    amountWei
  ] as const;

const ensureOfferEscrowReady = async (
  signer: TradeSigner,
  makerAddress: string,
  offerAsset: TradeAssetSelection,
  offerAmountWei: bigint,
  spenderAddress = TRADE_ESCROW_CONTRACT_ADDRESS
): Promise<void> => {
  if (offerAsset.kind !== 'native' && offerAsset.tokenAddress) {
    await ensureTradeTokenAllowance(
      signer,
      makerAddress,
      offerAsset.tokenAddress,
      offerAmountWei,
      offerAsset.kind,
      spenderAddress
    );
  }
};

const ensureRequestPaymentReady = async (
  signer: TradeSigner,
  ownerAddress: string,
  requestAsset: TradeAssetPayload,
  requestAmountWei: bigint,
  spenderAddress = TRADE_ESCROW_CONTRACT_ADDRESS
): Promise<void> => {
  if (requestAsset.kind !== 'native' && requestAsset.tokenAddress) {
    await ensureTradeTokenAllowance(
      signer,
      ownerAddress,
      requestAsset.tokenAddress,
      requestAmountWei,
      requestAsset.kind,
      spenderAddress
    );
  }
};

const resolveTradeIdFromReceipt = async (
  tradeContract: Awaited<ReturnType<typeof createTradeContract>>,
  receipt: { logs?: unknown[] },
  fallbackErrorMessage: string,
  abi: typeof TRADE_ESCROW_CONTRACT_ABI | typeof PRIVATE_TRADE_ESCROW_CONTRACT_ABI = TRADE_ESCROW_CONTRACT_ABI
): Promise<number> => {
  const cotiEthers = await loadCotiEthersModule();
  const interfaceInstance = new cotiEthers.Interface(abi);
  let tradeId = 0;

  for (const log of receipt.logs ?? []) {
    try {
      const parsedLog = interfaceInstance.parseLog(log as never);
      if (parsedLog?.name === 'TradeOpened') {
        tradeId = toSafeNumber(parsedLog.args?.tradeId ?? parsedLog.args?.[0]);
        break;
      }
    } catch {
    }
  }

  if (tradeId <= 0) {
    const nextTradeIdRaw = await tradeContract.nextTradeId().catch(() => null);
    if (typeof nextTradeIdRaw === 'bigint' && nextTradeIdRaw > 0n) {
      tradeId = Number(nextTradeIdRaw - 1n);
    }
  }

  if (tradeId <= 0) {
    throw new Error(fallbackErrorMessage);
  }

  return tradeId;
};

const resolveTradeFunctionSelector = async (
  functionName: string,
  abi: typeof TRADE_ESCROW_CONTRACT_ABI | typeof PRIVATE_TRADE_ESCROW_CONTRACT_ABI = TRADE_ESCROW_CONTRACT_ABI
): Promise<string> => {
  const cotiEthers = await loadCotiEthersModule();
  const interfaceInstance = new cotiEthers.Interface(abi);
  const selector = interfaceInstance.getFunction(functionName)?.selector;
  if (!selector) {
    throw new Error(`Unable to prepare ${functionName}.`);
  }
  return selector;
};

const resolvePrivateFixedPriceFillResult = async (
  receipt: { logs?: unknown[] },
  fallbackFullyFilled = false
): Promise<boolean> => {
  const cotiEthers = await loadCotiEthersModule();
  const interfaceInstance = new cotiEthers.Interface(PRIVATE_TRADE_ESCROW_CONTRACT_ABI);

  for (const log of receipt.logs ?? []) {
    try {
      const parsedLog = interfaceInstance.parseLog(log as never);
      if (parsedLog?.name === 'PrivateFixedPriceTradeFilled') {
        return Boolean(parsedLog.args?.fullyFilled ?? parsedLog.args?.[2]);
      }
    } catch {
    }
  }

  return fallbackFullyFilled;
};

export const createTradeOnChain = async ({
  signer,
  makerAddress,
  takerAddress,
  offerAsset,
  offerAmountWei,
  requestAsset,
  requestAmountWei,
  expiresAt,
  nativeFeeWei,
  isPublic,
  accessHash,
  parentTradeId,
  hidePrivateLiquidity,
  hiddenOfferAmountWei,
  publicOfferAmountWei,
  termsHash
}: {
  signer: TradeSigner;
  makerAddress: string;
  takerAddress: string;
  offerAsset: TradeAssetSelection;
  offerAmountWei: bigint;
  requestAsset: TradeAssetSelection;
  requestAmountWei: bigint;
  expiresAt: number;
  nativeFeeWei: bigint;
  isPublic?: boolean;
  accessHash?: string;
  parentTradeId?: number;
  hidePrivateLiquidity?: boolean;
  hiddenOfferAmountWei?: bigint;
  publicOfferAmountWei?: bigint;
  termsHash?: string;
}): Promise<{ tradeId: number; escrowContract: string }> => {
  if (hidePrivateLiquidity) {
    if (parentTradeId) {
      throw new Error('Hidden-liquidity trades cannot be linked as counter offers yet.');
    }
    if (offerAsset.kind !== 'private-erc20' || requestAsset.kind !== 'private-erc20') {
      throw new Error('Hidden-liquidity trades require private tokens on both sides.');
    }

    const resolvedHiddenOfferAmountWei = hiddenOfferAmountWei ?? offerAmountWei;
    const resolvedPublicOfferAmountWei = publicOfferAmountWei ?? offerAmountWei;
    const tradeContract = await createTradeContract(signer, PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS);
    await ensureOfferEscrowReady(
      signer,
      makerAddress,
      offerAsset,
      resolvedHiddenOfferAmountWei,
      PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS
    );

    const createSelector = await resolveTradeFunctionSelector(
      'createPrivateFixedPriceTrade',
      PRIVATE_TRADE_ESCROW_CONTRACT_ABI
    );
    const encryptedHiddenOfferAmount = await signer.encryptValue(
      resolvedHiddenOfferAmountWei,
      PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
      createSelector
    );
    const createTx = await tradeContract.createPrivateFixedPriceTrade(
      buildTradeAssetTuple(offerAsset, resolvedPublicOfferAmountWei),
      buildTradeAssetTuple(requestAsset, requestAmountWei),
      takerAddress,
      expiresAt,
      Boolean(isPublic),
      accessHash ?? ZERO_BYTES32,
      termsHash ?? ZERO_BYTES32,
      encryptedHiddenOfferAmount,
      { value: nativeFeeWei, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
    );
    const createReceipt = requireSuccessfulReceipt(await createTx.wait(), 'Trade creation failed on-chain.');
    const tradeId = await resolveTradeIdFromReceipt(
      tradeContract,
      createReceipt as { logs?: unknown[] },
      'Trade was created, but the trade id could not be resolved.',
      PRIVATE_TRADE_ESCROW_CONTRACT_ABI
    );

    return { tradeId, escrowContract: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS };
  }

  const tradeContract = await createTradeContract(signer);
  await ensureOfferEscrowReady(signer, makerAddress, offerAsset, offerAmountWei);

  const offerAssetTuple = buildTradeAssetTuple(offerAsset, offerAmountWei);
  const requestAssetTuple = buildTradeAssetTuple(requestAsset, requestAmountWei);
  const valueToSend = (offerAsset.kind === 'native' ? offerAmountWei : 0n) + nativeFeeWei;
  const shouldUseAdvancedCreate = Boolean(isPublic || accessHash || parentTradeId);
  const createOverrides =
    offerAsset.kind === 'private-erc20'
      ? { value: valueToSend, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
      : { value: valueToSend };
  const createTx = shouldUseAdvancedCreate
    ? await tradeContract.createTradeAdvanced(
        offerAssetTuple,
        requestAssetTuple,
        takerAddress,
        expiresAt,
        Boolean(isPublic),
        accessHash ?? ZERO_BYTES32,
        parentTradeId ?? 0,
        createOverrides
      )
    : await tradeContract.createTrade(
        offerAssetTuple,
        requestAssetTuple,
        takerAddress,
        expiresAt,
        createOverrides
      );
  const createReceipt = requireSuccessfulReceipt(await createTx.wait(), 'Trade creation failed on-chain.');
  const tradeId = await resolveTradeIdFromReceipt(
    tradeContract,
    createReceipt as { logs?: unknown[] },
    'Trade was created, but the trade id could not be resolved.'
  );

  return { tradeId, escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS };
};

export const acceptTradeOnChain = async ({
  signer,
  ownerAddress,
  tradeId,
  requestAsset,
  requestAmountWei,
  accessSecret
}: {
  signer: TradeSigner;
  ownerAddress: string;
  tradeId: number;
  requestAsset: TradeAssetPayload;
  requestAmountWei?: bigint;
  accessSecret?: string;
}): Promise<{ acceptedTxHash?: string }> => {
  const tradeContract = await createTradeContract(signer);
  const resolvedRequestAmountWei = requestAmountWei ?? BigInt(requestAsset.amount);
  await ensureRequestPaymentReady(signer, ownerAddress, requestAsset, resolvedRequestAmountWei);

  const txOverrides = {
    value: requestAsset.kind === 'native' ? resolvedRequestAmountWei : 0n
  };
  const acceptTx = accessSecret
    ? await tradeContract.acceptTradeWithSecret(tradeId, accessSecret, txOverrides)
    : await tradeContract.acceptTrade(tradeId, txOverrides);
  const acceptReceipt = requireSuccessfulReceipt(
    (await acceptTx.wait()) as { status?: number | bigint; hash?: unknown; transactionHash?: unknown },
    'Trade acceptance failed on-chain.'
  );

  return {
    acceptedTxHash: resolveAcceptedTxHash(acceptTx as { hash?: unknown }, acceptReceipt)
  };
};

export const acceptCounterTradeAndCloseParentOnChain = async ({
  signer,
  ownerAddress,
  tradeId,
  requestAsset,
  requestAmountWei,
  accessSecret
}: {
  signer: TradeSigner;
  ownerAddress: string;
  tradeId: number;
  requestAsset: TradeAssetPayload;
  requestAmountWei?: bigint;
  accessSecret?: string;
}): Promise<{ acceptedTxHash?: string }> => {
  const tradeContract = await createTradeContract(signer);
  const resolvedRequestAmountWei = requestAmountWei ?? BigInt(requestAsset.amount);
  await ensureRequestPaymentReady(signer, ownerAddress, requestAsset, resolvedRequestAmountWei);

  const txOverrides = {
    value: requestAsset.kind === 'native' ? resolvedRequestAmountWei : 0n
  };
  const acceptTx = accessSecret
    ? await tradeContract.acceptCounterTradeAdvancedAndCloseParent(tradeId, accessSecret, txOverrides)
    : await tradeContract.acceptCounterTradeAndCloseParent(tradeId, txOverrides);
  const acceptReceipt = requireSuccessfulReceipt(
    (await acceptTx.wait()) as { status?: number | bigint; hash?: unknown; transactionHash?: unknown },
    'Counter acceptance failed on-chain.'
  );

  return {
    acceptedTxHash: resolveAcceptedTxHash(acceptTx as { hash?: unknown }, acceptReceipt)
  };
};

export const fillTradeOnChain = async ({
  signer,
  ownerAddress,
  tradeId,
  requestAsset,
  requestAmountWei,
  minOfferAmountOut = 0n,
  accessSecret
}: {
  signer: TradeSigner;
  ownerAddress: string;
  tradeId: number;
  requestAsset: TradeAssetPayload;
  requestAmountWei: bigint;
  minOfferAmountOut?: bigint;
  accessSecret?: string;
}): Promise<{ filledTxHash?: string }> => {
  const tradeContract = await createTradeContract(signer);
  await ensureRequestPaymentReady(signer, ownerAddress, requestAsset, requestAmountWei);

  const txOverrides = {
    value: requestAsset.kind === 'native' ? requestAmountWei : 0n
  };
  const fillTx = accessSecret
    ? await tradeContract.fillTradeAdvanced(tradeId, requestAmountWei, minOfferAmountOut, accessSecret, txOverrides)
    : await tradeContract.fillTrade(tradeId, requestAmountWei, minOfferAmountOut, txOverrides);
  const fillReceipt = requireSuccessfulReceipt(
    (await fillTx.wait()) as { status?: number | bigint; hash?: unknown; transactionHash?: unknown },
    'Partial fill failed on-chain.'
  );

  return {
    filledTxHash: resolveAcceptedTxHash(fillTx as { hash?: unknown }, fillReceipt)
  };
};

export const fillPrivateFixedPriceTradeOnChain = async ({
  signer,
  ownerAddress,
  tradeId,
  requestAsset,
  requestAmountWei,
  escrowContract,
  accessSecret
}: {
  signer: TradeSigner;
  ownerAddress: string;
  tradeId: number;
  requestAsset: TradeAssetPayload;
  requestAmountWei: bigint;
  escrowContract?: string;
  accessSecret?: string;
}): Promise<{ filledTxHash?: string; fullyFilled: boolean }> => {
  if (requestAsset.kind !== 'private-erc20') {
    throw new Error('Hidden-liquidity fills require a private payment token.');
  }

  const resolvedEscrowContract = escrowContract ?? PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS;
  const tradeContract = await createTradeContract(signer, resolvedEscrowContract);
  await ensureRequestPaymentReady(signer, ownerAddress, requestAsset, requestAmountWei, resolvedEscrowContract);

  const functionName = accessSecret ? 'fillPrivateFixedPriceTradeWithSecret' : 'fillPrivateFixedPriceTrade';
  const fillSelector = await resolveTradeFunctionSelector(functionName, PRIVATE_TRADE_ESCROW_CONTRACT_ABI);
  const encryptedRequestAmount = await signer.encryptValue(
    requestAmountWei,
    resolvedEscrowContract,
    fillSelector
  );
  const fillTx = accessSecret
    ? await tradeContract.fillPrivateFixedPriceTradeWithSecret(tradeId, encryptedRequestAmount, accessSecret, {
        gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT
      })
    : await tradeContract.fillPrivateFixedPriceTrade(tradeId, encryptedRequestAmount, {
        gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT
      });
  const fillReceipt = requireSuccessfulReceipt(
    (await fillTx.wait()) as { status?: number | bigint; hash?: unknown; transactionHash?: unknown; logs?: unknown[] },
    'Private fixed-price fill failed on-chain.'
  );

  return {
    filledTxHash: resolveAcceptedTxHash(fillTx as { hash?: unknown }, fillReceipt),
    fullyFilled: await resolvePrivateFixedPriceFillResult(fillReceipt)
  };
};

export const replacePrivateFixedPriceTradeOnChain = async ({
  signer,
  makerAddress,
  originalTradeId,
  takerAddress,
  offerAsset,
  offerAmountWei,
  requestAsset,
  requestAmountWei,
  expiresAt,
  nativeFeeWei,
  isPublic,
  accessHash,
  hiddenOfferAmountWei,
  publicOfferAmountWei,
  termsHash
}: {
  signer: TradeSigner;
  makerAddress: string;
  originalTradeId: number;
  takerAddress: string;
  offerAsset: TradeAssetSelection;
  offerAmountWei: bigint;
  requestAsset: TradeAssetSelection;
  requestAmountWei: bigint;
  expiresAt: number;
  nativeFeeWei: bigint;
  isPublic: boolean;
  accessHash?: string;
  hiddenOfferAmountWei?: bigint;
  publicOfferAmountWei?: bigint;
  termsHash?: string;
}): Promise<{ tradeId: number; escrowContract: string }> => {
  if (offerAsset.kind !== 'private-erc20' || requestAsset.kind !== 'private-erc20') {
    throw new Error('Hidden-liquidity trades require private tokens on both sides.');
  }

  const resolvedHiddenOfferAmountWei = hiddenOfferAmountWei ?? offerAmountWei;
  const resolvedPublicOfferAmountWei = publicOfferAmountWei ?? offerAmountWei;
  const tradeContract = await createTradeContract(signer, PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS);
  await ensureOfferEscrowReady(
    signer,
    makerAddress,
    offerAsset,
    resolvedHiddenOfferAmountWei,
    PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS
  );

  const editSelector = await resolveTradeFunctionSelector(
    'cancelAndReplacePrivateFixedPriceTrade',
    PRIVATE_TRADE_ESCROW_CONTRACT_ABI
  );
  const encryptedHiddenOfferAmount = await signer.encryptValue(
    resolvedHiddenOfferAmountWei,
    PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
    editSelector
  );
  const editTx = await tradeContract.cancelAndReplacePrivateFixedPriceTrade(
    originalTradeId,
    buildTradeAssetTuple(offerAsset, resolvedPublicOfferAmountWei),
    buildTradeAssetTuple(requestAsset, requestAmountWei),
    takerAddress,
    expiresAt,
    isPublic,
    accessHash ?? ZERO_BYTES32,
    termsHash ?? ZERO_BYTES32,
    encryptedHiddenOfferAmount,
    { value: nativeFeeWei, gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT }
  );
  const editReceipt = requireSuccessfulReceipt(await editTx.wait(), 'Private trade edit failed on-chain.');
  const tradeId = await resolveTradeIdFromReceipt(
    tradeContract,
    editReceipt as { logs?: unknown[] },
    'Private trade was edited, but the replacement trade id could not be resolved.',
    PRIVATE_TRADE_ESCROW_CONTRACT_ABI
  );

  return { tradeId, escrowContract: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS };
};

export const editTradeOnChain = async ({
  signer,
  makerAddress,
  originalTradeId,
  takerAddress,
  offerAsset,
  offerAmountWei,
  requestAsset,
  requestAmountWei,
  expiresAt,
  nativeFeeWei,
  isPublic,
  accessHash
}: {
  signer: TradeSigner;
  makerAddress: string;
  originalTradeId: number;
  takerAddress: string;
  offerAsset: TradeAssetSelection;
  offerAmountWei: bigint;
  requestAsset: TradeAssetSelection;
  requestAmountWei: bigint;
  expiresAt: number;
  nativeFeeWei: bigint;
  isPublic: boolean;
  accessHash?: string;
}): Promise<{ tradeId: number; escrowContract: string }> => {
  const tradeContract = await createTradeContract(signer);
  await ensureOfferEscrowReady(signer, makerAddress, offerAsset, offerAmountWei);

  const valueToSend = (offerAsset.kind === 'native' ? offerAmountWei : 0n) + nativeFeeWei;
  const editTx = await tradeContract.editTrade(
    originalTradeId,
    buildTradeAssetTuple(offerAsset, offerAmountWei),
    buildTradeAssetTuple(requestAsset, requestAmountWei),
    takerAddress,
    expiresAt,
    isPublic,
    accessHash ?? ZERO_BYTES32,
    { value: valueToSend }
  );
  const editReceipt = requireSuccessfulReceipt(await editTx.wait(), 'Trade edit failed on-chain.');
  const tradeId = await resolveTradeIdFromReceipt(
    tradeContract,
    editReceipt as { logs?: unknown[] },
    'Trade was edited, but the replacement trade id could not be resolved.'
  );

  return { tradeId, escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS };
};

export const counterTradeAndCloseCounteredTradeOnChain = async ({
  signer,
  makerAddress,
  counteredTradeId,
  offerAsset,
  offerAmountWei,
  requestAsset,
  requestAmountWei,
  expiresAt,
  nativeFeeWei
}: {
  signer: TradeSigner;
  makerAddress: string;
  counteredTradeId: number;
  offerAsset: TradeAssetSelection;
  offerAmountWei: bigint;
  requestAsset: TradeAssetSelection;
  requestAmountWei: bigint;
  expiresAt: number;
  nativeFeeWei: bigint;
}): Promise<{ tradeId: number; escrowContract: string }> => {
  const tradeContract = await createTradeContract(signer);
  await ensureOfferEscrowReady(signer, makerAddress, offerAsset, offerAmountWei);

  const valueToSend = (offerAsset.kind === 'native' ? offerAmountWei : 0n) + nativeFeeWei;
  const counterTx = await tradeContract.counterTradeAndCloseCounteredTrade(
    counteredTradeId,
    buildTradeAssetTuple(offerAsset, offerAmountWei),
    buildTradeAssetTuple(requestAsset, requestAmountWei),
    expiresAt,
    { value: valueToSend }
  );
  const counterReceipt = requireSuccessfulReceipt(await counterTx.wait(), 'Counter replacement failed on-chain.');
  const tradeId = await resolveTradeIdFromReceipt(
    tradeContract,
    counterReceipt as { logs?: unknown[] },
    'Counter was created, but the trade id could not be resolved.'
  );

  return { tradeId, escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS };
};

const runTradeActionOnChain = async ({
  signer,
  tradeId,
  escrowContract,
  action
}: {
  signer: TradeSigner;
  tradeId: number;
  escrowContract?: string;
  action: 'decline' | 'cancel';
}) => {
  const config = resolveTradeEscrowContractConfig(escrowContract);
  const tradeContract = await createTradeContract(signer, config.address);
  const overrides = config.hiddenOnly ? { gasLimit: PRIVATE_TRADE_WRITE_GAS_LIMIT } : undefined;
  const tx =
    action === 'decline'
      ? await tradeContract.declineTrade(tradeId, overrides ?? {})
      : await tradeContract.cancelTrade(tradeId, overrides ?? {});
  requireSuccessfulReceipt(
    await tx.wait(),
    action === 'decline' ? 'Trade refusal failed on-chain.' : 'Trade cancellation failed on-chain.'
  );
};

export const declineTradeOnChain = async ({
  signer,
  tradeId,
  escrowContract
}: {
  signer: TradeSigner;
  tradeId: number;
  escrowContract?: string;
}) => {
  await runTradeActionOnChain({
    signer,
    tradeId,
    escrowContract,
    action: 'decline'
  });
};

export const cancelTradeOnChain = async ({
  signer,
  tradeId,
  escrowContract
}: {
  signer: TradeSigner;
  tradeId: number;
  escrowContract?: string;
}) => {
  await runTradeActionOnChain({
    signer,
    tradeId,
    escrowContract,
    action: 'cancel'
  });
};
