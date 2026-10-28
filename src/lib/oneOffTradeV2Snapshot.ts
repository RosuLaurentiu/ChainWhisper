import { getAddress } from '@coti-io/coti-ethers';
import type { TradeAssetPayload, TradeOnChainStatus, TradeSnapshot } from './appShared/core';
import type { DirectTradeV2TradeTerms } from './directTradeV2Actions';
import type { PrivateTradeV2AccountSnapshot, PrivateTradeV2OrderView } from './privateTradeV2Actions';
import { isPrivateBookV2RuntimeHash, type PrivateBookV2AccountSnapshot, type PrivateBookV2OrderView } from './privateBookV2Actions';
import { normalizePrivateBookV2Price, privateBookV2Uint, PRIVATE_BOOK_V2_AMOUNT_MAX } from './privateBookV2Terms';
import type { RecurringTradeV2TokenMetadataResolver } from './recurringTradeV2Snapshot';
import type { StandardTradeV2View } from './standardTradeV2Actions';
import type { AttestedTradeHistoryV2Deployment } from './tradeHistoryV2Chain';

const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;

export type PrivateBookV2ProjectedSnapshot = TradeSnapshot & Readonly<{
  privateBook: Readonly<{
    runtimeBytecodeHash: string;
    priceTerms: Readonly<{ offerAmount: string; requestAmount: string }>;
    publicOfferBudget?: string;
    publicBudgetVisibility?: boolean;
    ownerBudget?: Readonly<PrivateBookV2AccountSnapshot & { recipient: string }>;
    fillBehavior: 'remaining-at-reviewed-price';
  }>;
}>;

/** Public terms are price units. Maker capacity is never copied into offer/request. */
export const projectPrivateBookV2Snapshot = ({ view, deployment, resolveTokenMetadata, viewer, account }: {
  view: PrivateBookV2OrderView;
  deployment: AttestedTradeHistoryV2Deployment;
  resolveTokenMetadata: RecurringTradeV2TokenMetadataResolver;
  viewer: string;
  account?: PrivateBookV2AccountSnapshot;
}): PrivateBookV2ProjectedSnapshot => {
  if (deployment.protocol !== 'private-v2' || !isPrivateBookV2RuntimeHash(deployment.runtimeBytecodeHash)) throw new Error('Private book projection needs the promoted runtime.');
  const price = normalizePrivateBookV2Price(view.priceTerms);
  const offer = asset({ kind: view.offerAsset.assetType, token: view.offerAsset.token, amount: price.offerAmount.toString(), resolveTokenMetadata });
  const request = asset({ kind: view.requestAsset.assetType, token: view.requestAsset.token, amount: price.requestAmount.toString(), resolveTokenMetadata });
  let ownerBudget: PrivateBookV2ProjectedSnapshot['privateBook']['ownerBudget'];
  const published = view.publicBudget?.visible ? privateBookV2Uint(view.publicBudget.amount, 'Published original budget', PRIVATE_BOOK_V2_AMOUNT_MAX).toString() : undefined;
  if (view.publicBudget && (typeof view.publicBudget.visible !== 'boolean' || !view.publicBudget.visible && view.publicBudget.amount !== '0')) throw new Error('Published budget state is invalid.');
  if (account) {
    const recipient = getAddress(viewer).toLowerCase();
    if (recipient !== getAddress(view.maker).toLowerCase() || account.orderId !== view.orderId || account.sequence !== view.revision) throw new Error('Private book budget belongs to another maker, order or revision.');
    const total = privateBookV2Uint(account.totalOfferAmount, 'Maker offer budget', PRIVATE_BOOK_V2_AMOUNT_MAX);
    const remaining = privateBookV2Uint(account.remainingOfferAmount, 'Maker remaining budget', PRIVATE_BOOK_V2_AMOUNT_MAX);
    const requestTotal = privateBookV2Uint(account.totalRequestAmount, 'Maker request total', PRIVATE_BOOK_V2_AMOUNT_MAX);
    if (total === 0n || remaining > total || requestTotal !== (total * price.requestAmount + price.offerAmount - 1n) / price.offerAmount) throw new Error('Private book maker budget is inconsistent with the public price.');
    if (published !== undefined && BigInt(published) !== total) throw new Error('Published budget differs from the original owner budget.');
    ownerBudget = Object.freeze({ ...account, recipient });
  }
  return Object.freeze({
    ...base({ id: view.orderId, deployment, maker: view.maker, offer, request,
      createdAt: view.createdAt, expiresAt: view.expiresAt, status: normalizeStatus(view.status),
      isPublic: true, hiddenLiquidity: true, revision: view.revision, amountMode: 'private',
      privateMode: view.mode === 'private-pair' ? 'fully-private' : view.mode }),
    replacementTradeId: safeNumber(view.replacementOrderId, 'Private replacement order ID') || undefined,
    replacesTradeId: safeNumber(view.replacesOrderId, 'Private replaced order ID') || undefined,
    privateBook: Object.freeze({ runtimeBytecodeHash: deployment.runtimeBytecodeHash,
      priceTerms: Object.freeze({ offerAmount: offer.amount, requestAmount: request.amount }),
      ...(view.offerAsset.assetType !== 'private-erc20' ? { publicOfferBudget: privateBookV2Uint(view.offerAsset.publicAmount, 'Public offer budget', PRIVATE_BOOK_V2_AMOUNT_MAX).toString() }
        : published === undefined ? {} : { publicOfferBudget: published }),
      ...(view.publicBudget ? { publicBudgetVisibility: view.publicBudget.visible } : {}),
      ...(ownerBudget ? { ownerBudget } : {}), fillBehavior: 'remaining-at-reviewed-price' })
  });
};

const safeNumber = (value: string, label: string): number => {
  const parsed = BigInt(value);
  const number = Number(parsed);
  if (parsed < 0n || !Number.isSafeInteger(number) || BigInt(number) !== parsed) {
    throw new Error(`${label} is outside the supported UI range.`);
  }
  return number;
};

const normalizeStatus = (
  value: 'open' | 'filled' | 'accepted' | 'cancelled' | 'declined' | 'expired' | 'superseded' | 'replaced'
): TradeOnChainStatus => value === 'filled' ? 'accepted' : value;

const asset = ({
  kind,
  token,
  amount,
  resolveTokenMetadata
}: {
  kind: 'native' | 'erc20' | 'private-erc20';
  token: string;
  amount: string;
  resolveTokenMetadata: RecurringTradeV2TokenMetadataResolver;
}): TradeAssetPayload => {
  if (kind === 'native') {
    return Object.freeze({ kind, symbol: 'COTI', decimals: 18, amount });
  }
  const tokenAddress = getAddress(token).toLowerCase();
  const metadata = resolveTokenMetadata(kind, tokenAddress);
  if (!metadata.symbol.trim() || !Number.isInteger(metadata.decimals) || metadata.decimals < 0 || metadata.decimals > 255) {
    throw new Error('OTC V2 token metadata is invalid.');
  }
  return Object.freeze({
    kind,
    tokenAddress,
    symbol: metadata.symbol.trim(),
    decimals: metadata.decimals,
    amount,
    ...(metadata.custom ? { custom: true } : {})
  });
};

const base = ({
  id,
  deployment,
  maker,
  taker = ZERO_ADDRESS,
  offer,
  request,
  createdAt,
  expiresAt,
  status,
  isPublic,
  hiddenLiquidity,
  revision,
  amountMode,
  privateMode
}: {
  id: string;
  deployment: AttestedTradeHistoryV2Deployment;
  maker: string;
  taker?: string;
  offer: TradeAssetPayload;
  request: TradeAssetPayload;
  createdAt: string;
  expiresAt: string;
  status: TradeOnChainStatus;
  isPublic: boolean;
  hiddenLiquidity: boolean;
  revision?: string;
  amountMode?: 'public' | 'private';
  privateMode?: 'fully-private' | 'private-offer-public-request' | 'public-offer-private-request';
}): TradeSnapshot => Object.freeze({
  tradeId: safeNumber(id, 'OTC V2 order ID'),
  escrowContract: getAddress(deployment.contractAddress).toLowerCase(),
  maker: getAddress(maker).toLowerCase(),
  taker: getAddress(taker).toLowerCase(),
  offer,
  request,
  createdAt: safeNumber(createdAt, 'OTC V2 creation time'),
  expiresAt: safeNumber(expiresAt, 'OTC V2 expiry'),
  status,
  isPublic,
  hiddenLiquidity,
  v2: Object.freeze({
    protocol: deployment.protocol as 'standard-v2' | 'private-v2' | 'direct-v2',
    chainId: deployment.chainId,
    contractAddress: deployment.contractAddress,
    ...(revision === undefined ? {} : { revision }),
    ...(amountMode === undefined ? {} : { amountMode }),
    ...(privateMode === undefined ? {} : { privateMode })
  })
});

export const projectStandardTradeV2Snapshot = ({ view, deployment, resolveTokenMetadata }: {
  view: StandardTradeV2View;
  deployment: AttestedTradeHistoryV2Deployment;
  resolveTokenMetadata: RecurringTradeV2TokenMetadataResolver;
}): TradeSnapshot => {
  const offer = asset({ kind: view.offerAsset.assetType, token: view.offerAsset.token, amount: view.offerAsset.amount, resolveTokenMetadata });
  const request = asset({ kind: view.requestAsset.assetType, token: view.requestAsset.token, amount: view.requestAsset.amount, resolveTokenMetadata });
  return Object.freeze({
    ...base({
      id: view.tradeId, deployment, maker: view.maker, offer, request,
      createdAt: view.createdAt, expiresAt: view.expiresAt, status: normalizeStatus(view.status),
      isPublic: true, hiddenLiquidity: false, revision: view.revision, amountMode: 'public'
    }),
    replacementTradeId: safeNumber(view.replacementTradeId, 'Standard replacement trade ID') || undefined,
    replacesTradeId: safeNumber(view.replacesTradeId, 'Standard replaced trade ID') || undefined,
    fillState: {
      remainingOfferAmount: view.remainingOfferAmount,
      remainingRequestAmount: view.remainingRequestAmount,
      filledOfferAmount: view.filledOfferAmount,
      filledRequestAmount: view.filledRequestAmount
    }
  });
};

export const projectPrivateTradeV2Snapshot = ({ view, deployment, resolveTokenMetadata, account }: {
  view: PrivateTradeV2OrderView;
  deployment: AttestedTradeHistoryV2Deployment;
  resolveTokenMetadata: RecurringTradeV2TokenMetadataResolver;
  account?: PrivateTradeV2AccountSnapshot;
}): TradeSnapshot => {
  const offerAmount = account?.totalOfferAmount ?? view.offerAsset.publicAmount;
  const requestAmount = account?.totalRequestAmount ?? view.requestAsset.publicAmount;
  const offer = asset({ kind: view.offerAsset.assetType, token: view.offerAsset.token, amount: offerAmount, resolveTokenMetadata });
  const request = asset({ kind: view.requestAsset.assetType, token: view.requestAsset.token, amount: requestAmount, resolveTokenMetadata });
  return Object.freeze({
    ...base({
      id: view.orderId, deployment, maker: view.maker, offer, request,
      createdAt: view.createdAt, expiresAt: view.expiresAt, status: normalizeStatus(view.status),
      isPublic: false, hiddenLiquidity: true, revision: view.revision,
      amountMode: view.mode === 'fully-private' ? 'private' : 'public', privateMode: view.mode
    }),
    replacementTradeId: safeNumber(view.replacementOrderId, 'Private replacement order ID') || undefined,
    replacesTradeId: safeNumber(view.replacesOrderId, 'Private replaced order ID') || undefined,
    ...(account ? {
      makerPrivateProgress: {
        initialOfferAmount: account.totalOfferAmount,
        remainingOfferAmount: account.remainingOfferAmount,
        filledOfferAmount: (BigInt(account.totalOfferAmount) - BigInt(account.remainingOfferAmount)).toString()
      }
    } : {})
  });
};

export const projectDirectTradeV2Snapshot = ({ view, deployment, resolveTokenMetadata }: {
  view: DirectTradeV2TradeTerms;
  deployment: AttestedTradeHistoryV2Deployment;
  resolveTokenMetadata: RecurringTradeV2TokenMetadataResolver;
}): TradeSnapshot => {
  const offer = asset({ kind: view.offerAsset.assetType, token: view.offerAsset.token, amount: view.offerAmount ?? '0', resolveTokenMetadata });
  const request = asset({ kind: view.requestAsset.assetType, token: view.requestAsset.token, amount: view.requestAmount ?? '0', resolveTokenMetadata });
  return Object.freeze({
    ...base({
      id: view.tradeId, deployment, maker: view.maker, taker: view.taker, offer, request,
      createdAt: view.createdAt, expiresAt: view.expiresAt, status: normalizeStatus(view.status),
      isPublic: false, hiddenLiquidity: view.amountMode === 'private', amountMode: view.amountMode
    }),
    parentTradeId: safeNumber(view.parentTradeId, 'Direct parent trade ID') || undefined,
    replacementTradeId: safeNumber(view.replacementTradeId, 'Direct replacement trade ID') || undefined,
    replacesTradeId: safeNumber(view.replacesTradeId, 'Direct replaced trade ID') || undefined,
    directTermsMetadata: {
      hasTermsPayload: view.offerAmount !== undefined && view.requestAmount !== undefined,
      offerAmountPrivate: view.amountMode === 'private',
      requestAmountPrivate: view.amountMode === 'private'
    }
  });
};
