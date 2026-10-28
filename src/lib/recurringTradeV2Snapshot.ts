import { getAddress } from '@coti-io/coti-ethers';
import type {
  RecurringTradeSnapshotPayload,
  TradeAssetPayload,
  TradeOnChainStatus,
  TradeSnapshot
} from './appShared/core';
import type { AttestedTradeHistoryV2Deployment } from './tradeHistoryV2Chain';
import type {
  PrivateRecurringTradeV2Inventory,
  PrivateRecurringTradeV2OrderView
} from './privateRecurringTradeV2Actions';
import type { RecurringTradeV2OrderView } from './recurringTradeV2Actions';

const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;

export type RecurringTradeV2TokenMetadata = Readonly<{
  symbol: string;
  decimals: number;
  custom?: boolean;
}>;

export type RecurringTradeV2TokenMetadataResolver = (
  kind: 'erc20' | 'private-erc20',
  tokenAddress: string
) => RecurringTradeV2TokenMetadata;

const safeNumber = (value: string, label: string): number => {
  const parsed = BigInt(value);
  const number = Number(parsed);
  if (parsed < 0n || !Number.isSafeInteger(number) || BigInt(number) !== parsed) {
    throw new Error(`${label} is outside the supported UI range.`);
  }
  return number;
};

const status = (value: 'active' | 'paused' | 'cancelled' | 'expired'): TradeOnChainStatus =>
  value === 'active' || value === 'paused' ? 'open' : value;

const recurringStatus = (
  value: 'active' | 'paused' | 'cancelled' | 'expired'
): RecurringTradeSnapshotPayload['recurringStatus'] => value === 'expired' ? 'cancelled' : value;

const tokenAsset = ({
  kind,
  tokenAddress,
  amount,
  resolveTokenMetadata
}: {
  kind: 'erc20' | 'private-erc20';
  tokenAddress: string;
  amount: string;
  resolveTokenMetadata: RecurringTradeV2TokenMetadataResolver;
}): TradeAssetPayload => {
  const token = getAddress(tokenAddress).toLowerCase();
  const metadata = resolveTokenMetadata(kind, token);
  if (!metadata.symbol.trim() || !Number.isInteger(metadata.decimals) || metadata.decimals < 0 || metadata.decimals > 255) {
    throw new Error('Recurring V2 token metadata is invalid.');
  }
  return Object.freeze({
    kind,
    tokenAddress: token,
    symbol: metadata.symbol.trim(),
    decimals: metadata.decimals,
    amount,
    ...(metadata.custom ? { custom: true } : {})
  });
};

const nativeAsset = (amount: string): TradeAssetPayload => Object.freeze({
  kind: 'native',
  symbol: 'COTI',
  decimals: 18,
  amount
});

const publicAsset = (
  value: RecurringTradeV2OrderView['baseAsset'],
  amount: string,
  resolveTokenMetadata: RecurringTradeV2TokenMetadataResolver
): TradeAssetPayload => value.assetType === 'native'
  ? nativeAsset(amount)
  : tokenAsset({ kind: 'erc20', tokenAddress: value.token, amount, resolveTokenMetadata });

const baseSnapshot = ({
  orderId,
  maker,
  orderStatus,
  createdAt,
  expiresAt,
  contractAddress,
  offer,
  request,
  recurringOrder,
  isPublic,
  hiddenLiquidity
}: {
  orderId: string;
  maker: string;
  orderStatus: TradeOnChainStatus;
  createdAt: string;
  expiresAt: string;
  contractAddress: string;
  offer: TradeAssetPayload;
  request: TradeAssetPayload;
  recurringOrder: RecurringTradeSnapshotPayload;
  isPublic: boolean;
  hiddenLiquidity: boolean;
}): TradeSnapshot => Object.freeze({
  tradeId: safeNumber(orderId, 'Recurring V2 order ID'),
  escrowContract: getAddress(contractAddress).toLowerCase(),
  maker: getAddress(maker).toLowerCase(),
  taker: ZERO_ADDRESS,
  offer,
  request,
  createdAt: safeNumber(createdAt, 'Recurring V2 creation time'),
  expiresAt: safeNumber(expiresAt, 'Recurring V2 expiry'),
  status: orderStatus,
  isPublic,
  hiddenLiquidity,
  recurringOrder
});

export const projectRecurringTradeV2Snapshot = ({
  view,
  deployment,
  resolveTokenMetadata
}: {
  view: RecurringTradeV2OrderView;
  deployment: AttestedTradeHistoryV2Deployment;
  resolveTokenMetadata: RecurringTradeV2TokenMetadataResolver;
}): TradeSnapshot => {
  const baseAsset = publicAsset(view.baseAsset, view.baseInventory, resolveTokenMetadata);
  const quoteAsset = publicAsset(view.quoteAsset, view.quoteInventory, resolveTokenMetadata);
  const active = view.status === 'active';
  return baseSnapshot({
    orderId: view.orderId,
    maker: view.maker,
    orderStatus: status(view.status),
    createdAt: view.createdAt,
    expiresAt: view.expiresAt,
    contractAddress: deployment.contractAddress,
    offer: baseAsset,
    request: quoteAsset,
    isPublic: true,
    hiddenLiquidity: false,
    recurringOrder: Object.freeze({
      orderId: safeNumber(view.orderId, 'Recurring V2 order ID'),
      selectedSide: 'buy',
      mode: 'public',
      recurringStatus: recurringStatus(view.status),
      baseAsset,
      quoteAsset,
      buyTerms: view.buyTerms,
      sellTerms: view.sellTerms,
      publicBaseInventory: view.baseInventory,
      publicQuoteInventory: view.quoteInventory,
      buySideOpen: active && BigInt(view.quoteInventory) > 0n,
      sellSideOpen: active && BigInt(view.baseInventory) > 0n,
      hasPrivateBaseInventory: false,
      hasPrivateQuoteInventory: false,
      executionCount: safeNumber(view.executionCount, 'Recurring V2 execution count'),
      v2: Object.freeze({
        protocol: 'recurring-v2',
        chainId: deployment.chainId,
        contractAddress: deployment.contractAddress,
        revision: view.revision,
        pairKey: view.pairKey
      })
    })
  });
};

export const projectPrivateRecurringTradeV2Snapshot = ({
  view,
  deployment,
  resolveTokenMetadata,
  makerInventory
}: {
  view: PrivateRecurringTradeV2OrderView;
  deployment: AttestedTradeHistoryV2Deployment;
  resolveTokenMetadata: RecurringTradeV2TokenMetadataResolver;
  makerInventory?: PrivateRecurringTradeV2Inventory;
}): TradeSnapshot => {
  const baseAmount = makerInventory?.baseAmount ?? '0';
  const quoteAmount = makerInventory?.quoteAmount ?? '0';
  const baseAsset = tokenAsset({
    kind: 'private-erc20',
    tokenAddress: view.baseToken,
    amount: baseAmount,
    resolveTokenMetadata
  });
  const quoteAsset = tokenAsset({
    kind: 'private-erc20',
    tokenAddress: view.quoteToken,
    amount: quoteAmount,
    resolveTokenMetadata
  });
  const active = view.status === 'active';
  return baseSnapshot({
    orderId: view.orderId,
    maker: view.maker,
    orderStatus: status(view.status),
    createdAt: view.createdAt,
    expiresAt: view.expiresAt,
    contractAddress: deployment.contractAddress,
    offer: baseAsset,
    request: quoteAsset,
    isPublic: false,
    hiddenLiquidity: true,
    recurringOrder: Object.freeze({
      orderId: safeNumber(view.orderId, 'Private recurring V2 order ID'),
      selectedSide: 'buy',
      mode: 'fully-private',
      recurringStatus: recurringStatus(view.status),
      baseAsset,
      quoteAsset,
      buyTerms: view.buyTerms,
      sellTerms: view.sellTerms,
      publicBaseInventory: '0',
      publicQuoteInventory: '0',
      buySideOpen: active,
      sellSideOpen: active,
      hasPrivateBaseInventory: active,
      hasPrivateQuoteInventory: active,
      executionCount: safeNumber(view.executionCount, 'Private recurring V2 execution count'),
      ...(makerInventory ? {
        makerPrivateInventory: {
          baseInventory: makerInventory.baseAmount,
          quoteInventory: makerInventory.quoteAmount
        }
      } : {}),
      v2: Object.freeze({
        protocol: 'private-recurring-v2',
        chainId: deployment.chainId,
        contractAddress: deployment.contractAddress,
        revision: view.revision,
        pairKey: view.pairKey
      })
    })
  });
};
