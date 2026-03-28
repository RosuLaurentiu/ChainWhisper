import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import { ensureTradeFeeTokenAllowance, ensureTradeTokenAllowance } from './appChain';
import { resolveTradeAssetTypeValue } from './appHelpers';
import {
  loadCotiEthersModule,
  toSafeNumber,
  TRADE_ESCROW_CONTRACT_ABI,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload,
  type TradeFeeModeSelection
} from './appShared';

type TradeSigner = Wallet | JsonRpcSigner;

type TradeAssetSelection = Pick<TradeAssetPayload, 'kind' | 'tokenAddress'>;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

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
  requireSuccessfulReceipt(await tx.wait(), 'Failed to close the original trade before sending your counter offer.');
  return actorRole === 'maker' ? 'cancelled' : 'declined';
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
  feeMode,
  nativeFeeWei,
  tokenFeeAmount
}: {
  signer: TradeSigner;
  makerAddress: string;
  takerAddress: string;
  offerAsset: TradeAssetSelection;
  offerAmountWei: bigint;
  requestAsset: TradeAssetSelection;
  requestAmountWei: bigint;
  expiresAt: number;
  feeMode: TradeFeeModeSelection;
  nativeFeeWei: bigint;
  tokenFeeAmount: bigint;
}): Promise<{ tradeId: number }> => {
  const cotiEthers = await loadCotiEthersModule();
  const tradeContract = new cotiEthers.Contract(TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ABI, signer);
  const interfaceInstance = new cotiEthers.Interface(TRADE_ESCROW_CONTRACT_ABI);

  if (offerAsset.kind !== 'native' && offerAsset.tokenAddress) {
    await ensureTradeTokenAllowance(
      signer,
      makerAddress,
      offerAsset.tokenAddress,
      offerAmountWei,
      offerAsset.kind
    );
  }

  if (feeMode === 'token') {
    await ensureTradeFeeTokenAllowance(signer, makerAddress, tokenFeeAmount);
  }

  const offerAssetTuple = [
    resolveTradeAssetTypeValue(offerAsset.kind),
    offerAsset.tokenAddress ?? ZERO_ADDRESS,
    offerAmountWei
  ] as const;
  const requestAssetTuple = [
    resolveTradeAssetTypeValue(requestAsset.kind),
    requestAsset.tokenAddress ?? ZERO_ADDRESS,
    requestAmountWei
  ] as const;
  const valueToSend = (offerAsset.kind === 'native' ? offerAmountWei : 0n) + nativeFeeWei;
  const createTx = await tradeContract.createTrade(
    offerAssetTuple,
    requestAssetTuple,
    takerAddress,
    expiresAt,
    feeMode === 'coti' ? 0 : 1,
    { value: valueToSend }
  );
  const createReceipt = requireSuccessfulReceipt(await createTx.wait(), 'Trade creation failed on-chain.');

  let tradeId = 0;
  for (const log of (createReceipt as { logs?: unknown[] }).logs ?? []) {
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
    throw new Error('Trade was created, but the trade id could not be resolved.');
  }

  return { tradeId };
};

export const acceptTradeOnChain = async ({
  signer,
  ownerAddress,
  tradeId,
  requestAsset
}: {
  signer: TradeSigner;
  ownerAddress: string;
  tradeId: number;
  requestAsset: TradeAssetPayload;
}): Promise<{ acceptedTxHash?: string }> => {
  const tradeContract = await createTradeContract(signer);
  const requestAmountWei = BigInt(requestAsset.amount);

  if (requestAsset.kind !== 'native' && requestAsset.tokenAddress) {
    await ensureTradeTokenAllowance(signer, ownerAddress, requestAsset.tokenAddress, requestAmountWei, requestAsset.kind);
  }

  const acceptTx = await tradeContract.acceptTrade(tradeId, {
    value: requestAsset.kind === 'native' ? requestAmountWei : 0n
  });
  const acceptReceipt = requireSuccessfulReceipt(
    (await acceptTx.wait()) as { status?: number | bigint; hash?: unknown; transactionHash?: unknown },
    'Trade acceptance failed on-chain.'
  );

  return {
    acceptedTxHash: resolveAcceptedTxHash(acceptTx as { hash?: unknown }, acceptReceipt)
  };
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
