import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import { ensureTradeTokenAllowance } from './appChain';
import { resolveTradeAssetTypeValue } from './appHelpers';
import {
  loadCotiEthersModule,
  toSafeNumber,
  TRADE_ESCROW_CONTRACT_ABI,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload
} from './appShared';

type TradeSigner = Wallet | JsonRpcSigner;

type TradeAssetSelection = Pick<TradeAssetPayload, 'kind' | 'tokenAddress'>;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;

const createTradeContract = async (runner: TradeSigner) => {
  const cotiEthers = await loadCotiEthersModule();
  return new cotiEthers.Contract(TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ABI, runner);
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
  offerAmountWei: bigint
): Promise<void> => {
  if (offerAsset.kind !== 'native' && offerAsset.tokenAddress) {
    await ensureTradeTokenAllowance(
      signer,
      makerAddress,
      offerAsset.tokenAddress,
      offerAmountWei,
      offerAsset.kind
    );
  }
};

const ensureRequestPaymentReady = async (
  signer: TradeSigner,
  ownerAddress: string,
  requestAsset: TradeAssetPayload,
  requestAmountWei: bigint
): Promise<void> => {
  if (requestAsset.kind !== 'native' && requestAsset.tokenAddress) {
    await ensureTradeTokenAllowance(signer, ownerAddress, requestAsset.tokenAddress, requestAmountWei, requestAsset.kind);
  }
};

const resolveTradeIdFromReceipt = async (
  tradeContract: Awaited<ReturnType<typeof createTradeContract>>,
  receipt: { logs?: unknown[] },
  fallbackErrorMessage: string
): Promise<number> => {
  const cotiEthers = await loadCotiEthersModule();
  const interfaceInstance = new cotiEthers.Interface(TRADE_ESCROW_CONTRACT_ABI);
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
  parentTradeId
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
}): Promise<{ tradeId: number }> => {
  const tradeContract = await createTradeContract(signer);
  await ensureOfferEscrowReady(signer, makerAddress, offerAsset, offerAmountWei);

  const offerAssetTuple = buildTradeAssetTuple(offerAsset, offerAmountWei);
  const requestAssetTuple = buildTradeAssetTuple(requestAsset, requestAmountWei);
  const valueToSend = (offerAsset.kind === 'native' ? offerAmountWei : 0n) + nativeFeeWei;
  const shouldUseAdvancedCreate = Boolean(isPublic || accessHash || parentTradeId);
  const createTx = shouldUseAdvancedCreate
    ? await tradeContract.createTradeAdvanced(
        offerAssetTuple,
        requestAssetTuple,
        takerAddress,
        expiresAt,
        Boolean(isPublic),
        accessHash ?? ZERO_BYTES32,
        parentTradeId ?? 0,
        { value: valueToSend }
      )
    : await tradeContract.createTrade(
        offerAssetTuple,
        requestAssetTuple,
        takerAddress,
        expiresAt,
        { value: valueToSend }
      );
  const createReceipt = requireSuccessfulReceipt(await createTx.wait(), 'Trade creation failed on-chain.');
  const tradeId = await resolveTradeIdFromReceipt(
    tradeContract,
    createReceipt as { logs?: unknown[] },
    'Trade was created, but the trade id could not be resolved.'
  );

  return { tradeId };
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
}): Promise<{ tradeId: number }> => {
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

  return { tradeId };
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
}): Promise<{ tradeId: number }> => {
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

  return { tradeId };
};

const runTradeActionOnChain = async ({
  signer,
  tradeId,
  action
}: {
  signer: TradeSigner;
  tradeId: number;
  action: 'decline' | 'cancel';
}) => {
  const tradeContract = await createTradeContract(signer);
  const tx = action === 'decline' ? await tradeContract.declineTrade(tradeId) : await tradeContract.cancelTrade(tradeId);
  requireSuccessfulReceipt(
    await tx.wait(),
    action === 'decline' ? 'Trade refusal failed on-chain.' : 'Trade cancellation failed on-chain.'
  );
};

export const declineTradeOnChain = async ({
  signer,
  tradeId
}: {
  signer: TradeSigner;
  tradeId: number;
}) => {
  await runTradeActionOnChain({
    signer,
    tradeId,
    action: 'decline'
  });
};

export const cancelTradeOnChain = async ({
  signer,
  tradeId
}: {
  signer: TradeSigner;
  tradeId: number;
}) => {
  await runTradeActionOnChain({
    signer,
    tradeId,
    action: 'cancel'
  });
};
