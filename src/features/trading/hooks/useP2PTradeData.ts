import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  buildTradeSnapshotKey,
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  getProviderErrorMessage,
  loadCotiEthersModule,
  withTimeout,
  type TradeSnapshot
} from '../../../lib/appShared/core';
import {
  fetchRecentTradeSnapshots,
  fetchTradeAccessMetadataById,
  fetchTradeSnapshotById,
  fetchWalletTradeSnapshots
} from '../../../lib/appChain';
import type { TradePageView } from './useP2PTradeRoute';
import { getWalletTransactionFlowState } from '../../../lib/walletTransactionFlow';
import {
  buildWalletReadAccountsKey,
  mergeWalletAccountMatches,
  type WalletReadAccount
} from '../../../lib/walletAccountScope';
import {
  doesAccessSecretMatchHash,
  normalizeAccessHash,
  PRIVATE_LINK_SECRET_MISMATCH_MESSAGE
} from '../../../lib/tradeLinks';
import { hasHydratedDirectTradeTerms } from '../../../lib/p2pTradeView';

const TRADE_DETAIL_LOAD_TIMEOUT_MS = 18_000;
const PUBLIC_TRADE_EMPTY_RETRY_DELAY_MS = 1_200;
const PUBLIC_TRADE_EMPTY_RETRY_LIMIT = 2;
const WALLET_FLOW_LIST_REFRESH_RETRY_MS = 450;
const P2P_TRADE_DATA_WARM_CACHE_TTL_MS = 5 * 60 * 1000;

const shouldHoldTradeReadForWalletFlow = (silent: boolean, hasExistingData: boolean): boolean => {
  const flowState = getWalletTransactionFlowState();
  return flowState === 'memory-active' || (flowState === 'stored-handoff' && (silent || hasExistingData));
};

const getSnapshotKey = (snapshot: Pick<TradeSnapshot, 'tradeId' | 'escrowContract'>): string =>
  buildTradeSnapshotKey(snapshot.tradeId, snapshot.escrowContract);

const sortTrades = (trades: TradeSnapshot[]): TradeSnapshot[] =>
  [...trades].sort((left, right) => {
    if (left.status === 'open' && right.status !== 'open') {
      return -1;
    }
    if (left.status !== 'open' && right.status === 'open') {
      return 1;
    }
    return right.tradeId - left.tradeId;
  });

const hasEntries = <T,>(value?: T[]): boolean => Boolean(value?.length);

type RecurringExecution = NonNullable<NonNullable<TradeSnapshot['recurringOrder']>['privateExecutions']>[number];
type WalletFillEvent = NonNullable<TradeSnapshot['walletFillEvents']>[number];
type PrivateFillReceipt = NonNullable<TradeSnapshot['privateFillReceipts']>[number];

const getRecurringExecutionKey = (execution: RecurringExecution): string =>
  `${execution.fillIndex}:${normalizeWalletKey(execution.filler)}`;

const getWalletFillEventKey = (event: WalletFillEvent): string =>
  event.txHash
    ? `${event.txHash.trim().toLowerCase()}:${event.logIndex ?? event.fillIndex}:${normalizeWalletKey(event.filler)}`
    : `${event.fillIndex}:${normalizeWalletKey(event.filler)}`;

const getPrivateFillReceiptKey = (receipt: PrivateFillReceipt): string =>
  receipt.txHash
    ? `${receipt.txHash.trim().toLowerCase()}:${receipt.fillIndex}:${normalizeWalletKey(receipt.filler)}`
    : `${receipt.fillIndex}:${normalizeWalletKey(receipt.filler)}`;

const sortFillEvents = <T extends { fillIndex: number; blockNumber?: number; logIndex?: number }>(items: T[]): T[] =>
  [...items].sort((left, right) =>
    (left.blockNumber ?? 0) - (right.blockNumber ?? 0) ||
    (left.logIndex ?? 0) - (right.logIndex ?? 0) ||
    left.fillIndex - right.fillIndex
  );

const mergeWalletFillEvents = (
  incoming?: WalletFillEvent[],
  existing?: WalletFillEvent[]
): WalletFillEvent[] | undefined => {
  if (!hasEntries(incoming) && !hasEntries(existing)) {
    return undefined;
  }

  const byKey = new Map<string, WalletFillEvent>();
  for (const event of existing ?? []) {
    byKey.set(getWalletFillEventKey(event), event);
  }
  for (const event of incoming ?? []) {
    const key = getWalletFillEventKey(event);
    byKey.set(key, {
      ...byKey.get(key),
      ...event
    });
  }

  return sortFillEvents(Array.from(byKey.values()));
};

const mergePrivateFillReceipts = (
  incoming?: PrivateFillReceipt[],
  existing?: PrivateFillReceipt[]
): PrivateFillReceipt[] | undefined => {
  if (!hasEntries(incoming) && !hasEntries(existing)) {
    return undefined;
  }

  const byKey = new Map<string, PrivateFillReceipt>();
  for (const receipt of existing ?? []) {
    byKey.set(getPrivateFillReceiptKey(receipt), receipt);
  }
  for (const receipt of incoming ?? []) {
    const key = getPrivateFillReceiptKey(receipt);
    byKey.set(key, {
      ...byKey.get(key),
      ...receipt
    });
  }

  return sortFillEvents(Array.from(byKey.values()));
};

const mergeRecurringExecutions = (
  incoming?: RecurringExecution[],
  existing?: RecurringExecution[]
): RecurringExecution[] | undefined => {
  if (!hasEntries(incoming) && !hasEntries(existing)) {
    return undefined;
  }

  const byKey = new Map<string, RecurringExecution>();
  for (const execution of existing ?? []) {
    byKey.set(getRecurringExecutionKey(execution), execution);
  }
  for (const execution of incoming ?? []) {
    const key = getRecurringExecutionKey(execution);
    byKey.set(key, {
      ...byKey.get(key),
      ...execution
    });
  }

  return Array.from(byKey.values()).sort((left, right) => left.fillIndex - right.fillIndex);
};

const waitForPublicTradeRetry = (): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, PUBLIC_TRADE_EMPTY_RETRY_DELAY_MS);
  });

const isDirectEscrowSnapshot = (snapshot: Pick<TradeSnapshot, 'escrowContract'>): boolean =>
  snapshot.escrowContract?.toLowerCase() === DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase();

const normalizeWalletKey = (walletKey?: string): string => walletKey?.trim().toLowerCase() ?? '';

const stripWalletScopedTradeSnapshot = (snapshot: TradeSnapshot): TradeSnapshot => {
  const stripped: TradeSnapshot = {
    ...snapshot,
    offer: isDirectEscrowSnapshot(snapshot) ? { ...snapshot.offer, amount: '0' } : snapshot.offer,
    request: isDirectEscrowSnapshot(snapshot) ? { ...snapshot.request, amount: '0' } : snapshot.request,
    fillState: isDirectEscrowSnapshot(snapshot) ? undefined : snapshot.fillState,
    hiddenLiquidity: isDirectEscrowSnapshot(snapshot) ? true : snapshot.hiddenLiquidity,
    makerPrivateProgress: undefined,
    privateFillReceipts: undefined,
    walletFillEvents: undefined,
    walletFillState: undefined,
    walletHasFill: undefined
  };

  if (snapshot.recurringOrder) {
    stripped.recurringOrder = {
      ...snapshot.recurringOrder,
      makerPrivateInventory: undefined,
      privateExecutions: undefined,
      publicExecutions: undefined
    };
  }

  return stripped;
};

type WalletScopedTradeFilterOptions = {
  preserveAuthorizedDirectTerms?: boolean;
};

const filterWalletScopedTradeSnapshot = (
  snapshot: TradeSnapshot,
  walletKey?: string,
  options: WalletScopedTradeFilterOptions = {}
): TradeSnapshot => {
  const normalizedWalletKey = normalizeWalletKey(walletKey);
  if (!normalizedWalletKey) {
    return stripWalletScopedTradeSnapshot(snapshot);
  }

  const makerKey = snapshot.maker.toLowerCase();
  const takerKey = snapshot.taker.toLowerCase();
  const isMaker = makerKey === normalizedWalletKey;
  const isDirectParticipant = isDirectEscrowSnapshot(snapshot) && (isMaker || takerKey === normalizedWalletKey);
  const canReadDirectTerms = isDirectParticipant || Boolean(options.preserveAuthorizedDirectTerms);
  const privateFillReceipts = isMaker
    ? snapshot.privateFillReceipts
    : (snapshot.privateFillReceipts ?? []).filter((receipt) => receipt.filler?.toLowerCase() === normalizedWalletKey);
  const hasPrivateFillReceipts = hasEntries(privateFillReceipts);
  const walletFillEvents = isMaker
    ? snapshot.walletFillEvents
    : (snapshot.walletFillEvents ?? []).filter((event) => event.filler?.toLowerCase() === normalizedWalletKey);
  const hasWalletFillEvents = hasEntries(walletFillEvents);
  const walletFillState = !isMaker && snapshot.walletHasFill ? snapshot.walletFillState : undefined;
  const walletHasFill = isMaker
    ? snapshot.walletHasFill || hasPrivateFillReceipts || hasWalletFillEvents
      ? true
      : undefined
    : hasPrivateFillReceipts || hasWalletFillEvents || (snapshot.walletHasFill && walletFillState)
      ? true
      : undefined;

  const filtered: TradeSnapshot = {
    ...snapshot,
    offer: isDirectEscrowSnapshot(snapshot) && !canReadDirectTerms ? { ...snapshot.offer, amount: '0' } : snapshot.offer,
    request: isDirectEscrowSnapshot(snapshot) && !canReadDirectTerms ? { ...snapshot.request, amount: '0' } : snapshot.request,
    fillState: isDirectEscrowSnapshot(snapshot) && !canReadDirectTerms ? undefined : snapshot.fillState,
    hiddenLiquidity: isDirectEscrowSnapshot(snapshot) && !canReadDirectTerms ? true : snapshot.hiddenLiquidity,
    makerPrivateProgress: isMaker ? snapshot.makerPrivateProgress : undefined,
    privateFillReceipts: hasPrivateFillReceipts ? privateFillReceipts : undefined,
    walletFillEvents: hasWalletFillEvents ? walletFillEvents : undefined,
    walletFillState,
    walletHasFill
  };

  if (snapshot.recurringOrder) {
    const privateExecutions = isMaker
      ? snapshot.recurringOrder.privateExecutions
      : (snapshot.recurringOrder.privateExecutions ?? []).filter(
          (execution) => execution.filler?.toLowerCase() === normalizedWalletKey
        );
    const publicExecutions = isMaker
      ? snapshot.recurringOrder.publicExecutions
      : (snapshot.recurringOrder.publicExecutions ?? []).filter(
          (execution) => execution.filler?.toLowerCase() === normalizedWalletKey
        );
    filtered.recurringOrder = {
      ...snapshot.recurringOrder,
      makerPrivateInventory: isMaker ? snapshot.recurringOrder.makerPrivateInventory : undefined,
      privateExecutions: hasEntries(privateExecutions) ? privateExecutions : undefined,
      publicExecutions: hasEntries(publicExecutions) ? publicExecutions : undefined
    };
    if (!isMaker && (snapshot.walletHasFill || hasEntries(privateExecutions) || hasEntries(publicExecutions))) {
      filtered.walletHasFill = true;
    }
  }

  return filtered;
};

const reconcileTradeSnapshotForReadAccounts = (
  snapshot: TradeSnapshot,
  walletReadAccounts: WalletReadAccount[],
  options: { preserveAuthorizedDirectTerms?: boolean } = {}
): TradeSnapshot => {
  const activeKeys = new Set(walletReadAccounts.map((account) => normalizeWalletKey(account.key || account.address)));
  const privateReadKeys = new Set(
    walletReadAccounts
      .filter((account) => account.canReadPrivate)
      .map((account) => normalizeWalletKey(account.key || account.address))
  );
  const makerKey = normalizeWalletKey(snapshot.maker);
  const takerKey = normalizeWalletKey(snapshot.taker);
  const scopedSnapshot = isDirectEscrowSnapshot(snapshot) &&
    !activeKeys.has(makerKey) &&
    !activeKeys.has(takerKey) &&
    !options.preserveAuthorizedDirectTerms
    ? stripWalletScopedTradeSnapshot(snapshot)
    : snapshot;
  const activeMaker = activeKeys.has(makerKey);
  const privateReadableMaker = privateReadKeys.has(makerKey);
  const privateFillReceipts = privateReadableMaker
    ? scopedSnapshot.privateFillReceipts
    : (scopedSnapshot.privateFillReceipts ?? []).filter((receipt) => privateReadKeys.has(normalizeWalletKey(receipt.filler)));
  const walletFillEvents = activeMaker
    ? scopedSnapshot.walletFillEvents
    : (scopedSnapshot.walletFillEvents ?? []).filter((event) => activeKeys.has(normalizeWalletKey(event.filler)));
  const accountMatches = (scopedSnapshot.accountMatches ?? []).filter((match) =>
    activeKeys.has(normalizeWalletKey(match.address))
  );
  const currentAccountKey = normalizeWalletKey(scopedSnapshot.accountAddress);
  const currentAccountIsActive = activeKeys.has(currentAccountKey);
  const replacementAccount = walletReadAccounts.find((account) =>
    accountMatches.some((match) => normalizeWalletKey(match.address) === normalizeWalletKey(account.key || account.address))
  );
  const reconciled: TradeSnapshot = {
    ...scopedSnapshot,
    accountAddress: currentAccountIsActive ? scopedSnapshot.accountAddress : replacementAccount?.address,
    accountRole: currentAccountIsActive ? scopedSnapshot.accountRole : replacementAccount?.role,
    accountMatches: accountMatches.length > 0 ? accountMatches : undefined,
    makerPrivateProgress: privateReadableMaker ? scopedSnapshot.makerPrivateProgress : undefined,
    privateFillReceipts: hasEntries(privateFillReceipts) ? privateFillReceipts : undefined,
    walletFillEvents: hasEntries(walletFillEvents) ? walletFillEvents : undefined,
    walletFillState: currentAccountIsActive ? scopedSnapshot.walletFillState : undefined
  };

  if (scopedSnapshot.recurringOrder) {
    const privateExecutions = privateReadableMaker
      ? scopedSnapshot.recurringOrder.privateExecutions
      : (scopedSnapshot.recurringOrder.privateExecutions ?? []).filter((execution) =>
          privateReadKeys.has(normalizeWalletKey(execution.filler))
        );
    const publicExecutions = activeMaker
      ? scopedSnapshot.recurringOrder.publicExecutions
      : (scopedSnapshot.recurringOrder.publicExecutions ?? []).filter((execution) =>
          activeKeys.has(normalizeWalletKey(execution.filler))
        );
    reconciled.recurringOrder = {
      ...scopedSnapshot.recurringOrder,
      makerPrivateInventory: privateReadableMaker ? scopedSnapshot.recurringOrder.makerPrivateInventory : undefined,
      privateExecutions: hasEntries(privateExecutions) ? privateExecutions : undefined,
      publicExecutions: hasEntries(publicExecutions) ? publicExecutions : undefined
    };
  }

  return reconciled;
};

const tradeSnapshotMatchesReadAccounts = (
  snapshot: TradeSnapshot,
  walletReadAccounts: WalletReadAccount[]
): boolean => {
  const activeKeys = new Set(walletReadAccounts.map((account) => normalizeWalletKey(account.key || account.address)));
  return Boolean(
    activeKeys.has(normalizeWalletKey(snapshot.maker)) ||
      activeKeys.has(normalizeWalletKey(snapshot.taker)) ||
      activeKeys.has(normalizeWalletKey(snapshot.accountAddress)) ||
      snapshot.accountMatches?.some((match) => activeKeys.has(normalizeWalletKey(match.address))) ||
      snapshot.walletFillEvents?.some((event) => activeKeys.has(normalizeWalletKey(event.filler))) ||
      snapshot.privateFillReceipts?.some((receipt) => activeKeys.has(normalizeWalletKey(receipt.filler))) ||
      snapshot.recurringOrder?.privateExecutions?.some((execution) =>
        activeKeys.has(normalizeWalletKey(execution.filler))
      ) ||
      snapshot.recurringOrder?.publicExecutions?.some((execution) =>
        activeKeys.has(normalizeWalletKey(execution.filler))
      )
  );
};

const reconcileTradeSnapshotsForReadAccounts = (
  snapshots: TradeSnapshot[],
  walletReadAccounts: WalletReadAccount[],
  removeUnmatched: boolean
): TradeSnapshot[] =>
  snapshots
    .filter((snapshot) => !removeUnmatched || tradeSnapshotMatchesReadAccounts(snapshot, walletReadAccounts))
    .map((snapshot) => reconcileTradeSnapshotForReadAccounts(snapshot, walletReadAccounts));

export const mergeTradeSnapshotEnrichment = (
  incoming: TradeSnapshot,
  existing?: TradeSnapshot | null,
  walletKey?: string,
  options: WalletScopedTradeFilterOptions = {}
): TradeSnapshot => {
  const shouldApplyWalletScope = walletKey !== undefined;
  const walletScopedIncoming = shouldApplyWalletScope
    ? filterWalletScopedTradeSnapshot(incoming, walletKey, options)
    : incoming;
  const walletScopedExisting =
    existing && shouldApplyWalletScope
      ? filterWalletScopedTradeSnapshot(existing, walletKey, options)
      : existing;

  if (!walletScopedExisting || getSnapshotKey(walletScopedExisting) !== getSnapshotKey(walletScopedIncoming)) {
    return mergeWalletAccountMatches(walletScopedExisting, walletScopedIncoming);
  }

  const preserveDirectTerms =
    isDirectEscrowSnapshot(walletScopedIncoming) &&
    hasHydratedDirectTradeTerms(walletScopedExisting) &&
    !hasHydratedDirectTradeTerms(walletScopedIncoming);
  const merged: TradeSnapshot = {
    ...walletScopedIncoming,
    ...(preserveDirectTerms
      ? {
          offer: walletScopedExisting.offer,
          request: walletScopedExisting.request,
          fillState: walletScopedExisting.fillState ?? walletScopedIncoming.fillState,
          hiddenLiquidity: walletScopedExisting.hiddenLiquidity
        }
      : {}),
    walletHasFill: Boolean(walletScopedIncoming.walletHasFill || walletScopedExisting.walletHasFill) || undefined,
    walletFillState: walletScopedIncoming.walletFillState ?? walletScopedExisting.walletFillState,
    walletFillEvents: mergeWalletFillEvents(walletScopedIncoming.walletFillEvents, walletScopedExisting.walletFillEvents),
    makerPrivateProgress: walletScopedIncoming.makerPrivateProgress ?? walletScopedExisting.makerPrivateProgress,
    privateFillReceipts: mergePrivateFillReceipts(
      walletScopedIncoming.privateFillReceipts,
      walletScopedExisting.privateFillReceipts
    )
  };

  if (walletScopedIncoming.recurringOrder && walletScopedExisting.recurringOrder) {
    const incomingPrivateInventory = walletScopedIncoming.recurringOrder.makerPrivateInventory;
    const existingPrivateInventory = walletScopedExisting.recurringOrder.makerPrivateInventory;
    merged.recurringOrder = {
      ...walletScopedIncoming.recurringOrder,
      makerPrivateInventory:
        incomingPrivateInventory || existingPrivateInventory
          ? {
              ...existingPrivateInventory,
              ...incomingPrivateInventory
            }
          : undefined,
      privateExecutions:
        mergeRecurringExecutions(
          walletScopedIncoming.recurringOrder.privateExecutions,
          walletScopedExisting.recurringOrder.privateExecutions
        ),
      publicExecutions:
        mergeRecurringExecutions(
          walletScopedIncoming.recurringOrder.publicExecutions,
          walletScopedExisting.recurringOrder.publicExecutions
        )
    };
  }

  return mergeWalletAccountMatches(walletScopedExisting, merged);
};

const mergeRefreshedTradeSnapshotScopes = ({
  existingDetail,
  preserveAuthorizedDirectTerms,
  snapshot,
  walletKey
}: {
  existingDetail?: TradeSnapshot | null;
  preserveAuthorizedDirectTerms: boolean;
  snapshot: TradeSnapshot;
  walletKey: string;
}): { detailSnapshot: TradeSnapshot; listSnapshot: TradeSnapshot } => ({
  detailSnapshot: mergeTradeSnapshotEnrichment(
    snapshot,
    existingDetail,
    walletKey,
    { preserveAuthorizedDirectTerms }
  ),
  listSnapshot: mergeTradeSnapshotEnrichment(snapshot, existingDetail, walletKey)
});

const annotateTradeSnapshotForAccount = (snapshot: TradeSnapshot, account: WalletReadAccount): TradeSnapshot => ({
  ...snapshot,
  accountAddress: account.address,
  accountRole: account.role,
  accountMatches: [
    {
      address: account.address,
      role: account.role
    }
  ]
});

const mergeAccountScopedSnapshot = (
  incoming: TradeSnapshot,
  existing: TradeSnapshot | undefined,
  accountKey: string
): TradeSnapshot => {
  const merged = mergeTradeSnapshotEnrichment(incoming, existing, accountKey);
  return merged;
};

const mergeTradeSnapshotList = (
  incoming: TradeSnapshot[],
  existing: TradeSnapshot[],
  walletKey?: string
): TradeSnapshot[] => {
  const existingByKey = new Map(existing.map((trade) => [getSnapshotKey(trade), trade]));
  return incoming.map((trade) => mergeTradeSnapshotEnrichment(trade, existingByKey.get(getSnapshotKey(trade)), walletKey));
};

const mergePublicTradeRefresh = (
  incoming: TradeSnapshot[],
  existing: TradeSnapshot[],
  silent: boolean,
  walletKey?: string
): TradeSnapshot[] => {
  if (silent && existing.length > 0 && incoming.length === 0) {
    return walletKey === undefined
      ? existing
      : existing.map((trade) => filterWalletScopedTradeSnapshot(trade, walletKey));
  }

  return sortTrades(mergeTradeSnapshotList(incoming, existing, walletKey));
};

type TradeAccessMetadataLike = {
  accessHash?: string;
  hasAccessHash?: boolean;
  isPublic?: boolean;
};

type TradeDetailAccessDecision = {
  allowed: boolean;
  error?: string;
  routeSecretValidated?: boolean;
};

const normalizeRouteAccessSecret = (value?: string): string => {
  const normalized = value?.trim() ?? '';
  return /^0x[a-fA-F0-9]{64}$/.test(normalized) ? normalized.toLowerCase() : '';
};

const hasValidatedRouteAccessSecret = (routeAccessSecret: string, validatedRouteAccessSecret?: string): boolean => {
  const normalizedRouteSecret = normalizeRouteAccessSecret(routeAccessSecret);
  return Boolean(
    normalizedRouteSecret &&
    normalizeRouteAccessSecret(validatedRouteAccessSecret) === normalizedRouteSecret
  );
};

const resolveTradeAccessHash = (
  metadata: TradeAccessMetadataLike | null | undefined,
  snapshot: TradeSnapshot
): string => normalizeAccessHash(metadata?.accessHash) || normalizeAccessHash(snapshot.accessHash);

const isWalletTradeParticipant = (
  snapshot: TradeSnapshot,
  walletKey: string,
  walletReadAccounts: WalletReadAccount[] = []
): boolean => {
  const readableWalletKeys = new Set<string>();
  const addWalletKey = (value?: string) => {
    const normalized = normalizeWalletKey(value);
    if (normalized) {
      readableWalletKeys.add(normalized);
    }
  };

  addWalletKey(walletKey);
  for (const account of walletReadAccounts) {
    addWalletKey(account.key);
    addWalletKey(account.address);
  }

  return readableWalletKeys.has(snapshot.maker.toLowerCase()) || readableWalletKeys.has(snapshot.taker.toLowerCase());
};

const resolveTradeDetailAccessDecision = ({
  hashAccessSecret,
  metadata,
  routeAccessSecret,
  snapshot,
  walletKey,
  walletReadAccounts = []
}: {
  hashAccessSecret: (accessSecret: string) => string;
  metadata?: TradeAccessMetadataLike | null;
  routeAccessSecret: string;
  snapshot: TradeSnapshot;
  walletKey: string;
  walletReadAccounts?: WalletReadAccount[];
}): TradeDetailAccessDecision => {
  const isParticipant = isWalletTradeParticipant(snapshot, walletKey, walletReadAccounts);
  const isUnlisted = metadata?.isPublic === false || snapshot.isPublic === false;
  const routeSecret = normalizeRouteAccessSecret(routeAccessSecret);
  const accessHash = resolveTradeAccessHash(metadata, snapshot);
  const routeSecretValidated = Boolean(
    routeSecret &&
    accessHash &&
    doesAccessSecretMatchHash(routeSecret, accessHash, hashAccessSecret)
  );
  if (!isUnlisted || isParticipant) {
    return routeSecretValidated
      ? { allowed: true, routeSecretValidated: true }
      : { allowed: true };
  }

  if (!routeSecret || !accessHash) {
    return { allowed: false };
  }

  return routeSecretValidated
    ? { allowed: true, routeSecretValidated: true }
    : { allowed: false, error: PRIVATE_LINK_SECRET_MISMATCH_MESSAGE };
};

export const __mergeTradeSnapshotEnrichmentForTest = mergeTradeSnapshotEnrichment;
export const __mergeAccountScopedSnapshotForTest = mergeAccountScopedSnapshot;
export const __mergePublicTradeRefreshForTest = mergePublicTradeRefresh;
export const __resolveTradeDetailAccessDecisionForTest = resolveTradeDetailAccessDecision;
export const __filterWalletScopedTradeSnapshotForTest = filterWalletScopedTradeSnapshot;
export const __stripWalletScopedTradeSnapshotForTest = stripWalletScopedTradeSnapshot;
export const __mergeRefreshedTradeSnapshotScopesForTest = mergeRefreshedTradeSnapshotScopes;
export const __reconcileTradeSnapshotForReadAccountsForTest = reconcileTradeSnapshotForReadAccounts;
export const __reconcileTradeSnapshotsForReadAccountsForTest = reconcileTradeSnapshotsForReadAccounts;

type TokenMetadata = {
  privateRewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
};

type TradeRefreshOptions = {
  silent?: boolean;
};

type EnrichMakerPrivateProgress = (
  snapshot: TradeSnapshot,
  forceReveal?: boolean,
  account?: WalletReadAccount
) => Promise<TradeSnapshot>;

type UseP2PTradeDataArgs = TokenMetadata & {
  enrichMakerPrivateProgress: EnrichMakerPrivateProgress;
  resolvedRouteAccessSecret: string;
  routeError: string;
  routeEscrowContract?: string;
  routeTradeId: number | null;
  routeView: TradePageView;
  syncSessionKey: string;
  walletAddress: string;
  walletKey: string;
  walletReadAccounts?: WalletReadAccount[];
};

type UseP2PTradeDataResult = {
  clearMyTrades: () => void;
  detailTrade: TradeSnapshot | null;
  detailTradeError: string;
  hasActiveListRefresh: () => boolean;
  loadingDetailTrade: boolean;
  loadingMyTrades: boolean;
  loadingPublicTrades: boolean;
  mergeTradeSnapshot: (snapshot: TradeSnapshot) => void;
  myTrades: TradeSnapshot[];
  myTradesError: string;
  publicTrades: TradeSnapshot[];
  publicTradesError: string;
  refreshMyTrades: (options?: TradeRefreshOptions) => Promise<void>;
  refreshPublicTrades: (options?: TradeRefreshOptions) => Promise<void>;
  readTradeDetail: (tradeId: number, escrowContract?: string) => Promise<TradeSnapshot | null>;
  refreshTradeDetail: (tradeId: number, escrowContract?: string, options?: TradeRefreshOptions) => Promise<TradeSnapshot | null>;
  setDetailTrade: Dispatch<SetStateAction<TradeSnapshot | null>>;
  setDetailTradeError: Dispatch<SetStateAction<string>>;
  tradeAccessBlocked: boolean;
};

type P2PTradeDataWarmCacheEntry = {
  detailTrade: TradeSnapshot | null;
  detailTradeError: string;
  myTrades: TradeSnapshot[];
  myTradesError: string;
  publicTrades: TradeSnapshot[];
  publicTradesError: string;
  routeAccessSecret: string;
  routeEscrowContract?: string;
  routeTradeId: number | null;
  routeView: TradePageView;
  tradeAccessBlocked: boolean;
  updatedAt: number;
  validatedRouteAccessSecret?: string;
};

const p2pTradeDataWarmCacheBySession = new Map<string, P2PTradeDataWarmCacheEntry>();

const readP2PTradeDataWarmCache = (syncSessionKey: string): P2PTradeDataWarmCacheEntry | null => {
  const cached = p2pTradeDataWarmCacheBySession.get(syncSessionKey);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.updatedAt > P2P_TRADE_DATA_WARM_CACHE_TTL_MS) {
    p2pTradeDataWarmCacheBySession.delete(syncSessionKey);
    return null;
  }
  return cached;
};

const cachedRouteMatches = (
  cached: P2PTradeDataWarmCacheEntry | null,
  routeView: TradePageView,
  routeTradeId: number | null,
  routeEscrowContract: string | undefined,
  routeAccessSecret: string
): boolean =>
  Boolean(
    cached &&
      cached.routeView === routeView &&
      cached.routeTradeId === routeTradeId &&
      (cached.routeEscrowContract ?? '').toLowerCase() === (routeEscrowContract ?? '').toLowerCase() &&
      cached.routeAccessSecret === normalizeRouteAccessSecret(routeAccessSecret)
  );

// A legacy link with no escrow query names the configured standard escrow.
// Other escrows need an explicit route identity or the retained participant gate.
const detailSnapshotMatchesRoute = (
  snapshot: TradeSnapshot | null,
  routeTradeId: number | null,
  routeEscrowContract?: string
): boolean =>
  Boolean(
    snapshot &&
      routeTradeId !== null &&
      snapshot.tradeId === routeTradeId &&
      (snapshot.escrowContract ?? '').toLowerCase() ===
        (routeEscrowContract?.trim() || TRADE_ESCROW_CONTRACT_ADDRESS).toLowerCase()
  );

const detailSnapshotMatchesPendingParticipantRoute = (
  snapshot: TradeSnapshot | null,
  routeTradeId: number | null,
  routeEscrowContract: string | undefined,
  walletKey: string,
  walletReadAccounts: WalletReadAccount[] = []
): boolean =>
  Boolean(
    snapshot &&
      routeTradeId !== null &&
      snapshot.tradeId === routeTradeId &&
      !routeEscrowContract?.trim() &&
      isWalletTradeParticipant(snapshot, walletKey, walletReadAccounts)
  );

const detailSnapshotCanRenderForRoute = (
  snapshot: TradeSnapshot | null,
  routeTradeId: number | null,
  routeEscrowContract: string | undefined,
  walletKey: string,
  walletReadAccounts: WalletReadAccount[] = []
): boolean =>
  detailSnapshotMatchesRoute(snapshot, routeTradeId, routeEscrowContract) ||
  detailSnapshotMatchesPendingParticipantRoute(
    snapshot,
    routeTradeId,
    routeEscrowContract,
    walletKey,
    walletReadAccounts
  );

const resolveRenderableDetailTrade = ({
  detailTrade,
  routeAccessSecret,
  routeEscrowContract,
  routeTradeId,
  routeView,
  validatedRouteAccessSecret,
  walletKey,
  walletReadAccounts = []
}: {
  detailTrade: TradeSnapshot | null;
  routeAccessSecret: string;
  routeEscrowContract?: string;
  routeTradeId: number | null;
  routeView: TradePageView;
  validatedRouteAccessSecret: string;
  walletKey: string;
  walletReadAccounts?: WalletReadAccount[];
}): TradeSnapshot | null => {
  if (
    routeView !== 'trade' ||
    !detailSnapshotCanRenderForRoute(detailTrade, routeTradeId, routeEscrowContract, walletKey, walletReadAccounts)
  ) {
    return null;
  }

  const currentRouteAccessSecret = normalizeRouteAccessSecret(routeAccessSecret);
  if (
    validatedRouteAccessSecret === currentRouteAccessSecret ||
    (detailTrade && isWalletTradeParticipant(detailTrade, walletKey, walletReadAccounts))
  ) {
    return detailTrade;
  }

  return null;
};

export const __detailSnapshotMatchesRouteForTest = detailSnapshotMatchesRoute;
export const __resolveRenderableDetailTradeForTest = resolveRenderableDetailTrade;

export default function useP2PTradeData({
  enrichMakerPrivateProgress,
  privateRewardTokenDecimals,
  privateRewardTokenSymbol,
  resolvedRouteAccessSecret,
  rewardTokenDecimals,
  rewardTokenSymbol,
  routeError,
  routeEscrowContract,
  routeTradeId,
  routeView,
  syncSessionKey,
  walletAddress,
  walletKey,
  walletReadAccounts = []
}: UseP2PTradeDataArgs): UseP2PTradeDataResult {
  const initialWarmCache = readP2PTradeDataWarmCache(syncSessionKey);
  const initialWarmCacheRouteMatches = cachedRouteMatches(
    initialWarmCache,
    routeView,
    routeTradeId,
    routeEscrowContract,
    resolvedRouteAccessSecret
  );
  const initialWarmCacheHasValidatedRouteSecret = Boolean(
    initialWarmCacheRouteMatches &&
    hasValidatedRouteAccessSecret(
      resolvedRouteAccessSecret,
      initialWarmCache?.validatedRouteAccessSecret
    )
  );
  const [publicTrades, setPublicTrades] = useState<TradeSnapshot[]>(() =>
    reconcileTradeSnapshotsForReadAccounts(initialWarmCache?.publicTrades ?? [], walletReadAccounts, false)
  );
  const [myTrades, setMyTrades] = useState<TradeSnapshot[]>(() =>
    reconcileTradeSnapshotsForReadAccounts(initialWarmCache?.myTrades ?? [], walletReadAccounts, true)
  );
  const [detailTrade, setDetailTrade] = useState<TradeSnapshot | null>(() =>
    initialWarmCacheRouteMatches && initialWarmCache?.detailTrade
      ? reconcileTradeSnapshotForReadAccounts(initialWarmCache.detailTrade, walletReadAccounts, {
          preserveAuthorizedDirectTerms: initialWarmCacheHasValidatedRouteSecret
        })
      : null
  );
  const [validatedDetailRouteAccessSecret, setValidatedDetailRouteAccessSecret] = useState(() =>
    initialWarmCacheRouteMatches ? initialWarmCache?.validatedRouteAccessSecret ?? '' : ''
  );
  const [loadingPublicTrades, setLoadingPublicTrades] = useState(false);
  const [loadingMyTrades, setLoadingMyTrades] = useState(false);
  const [loadingDetailTrade, setLoadingDetailTrade] = useState(false);
  const [tradeAccessBlocked, setTradeAccessBlocked] = useState(() =>
    initialWarmCacheRouteMatches ? Boolean(initialWarmCache?.tradeAccessBlocked) : false
  );
  const [publicTradesError, setPublicTradesError] = useState(() => initialWarmCache?.publicTradesError ?? '');
  const [myTradesError, setMyTradesError] = useState(() => initialWarmCache?.myTradesError ?? '');
  const [detailTradeError, setDetailTradeError] = useState(() =>
    initialWarmCacheRouteMatches ? initialWarmCache?.detailTradeError ?? '' : ''
  );
  const publicTradesRefreshRef = useRef<Promise<void> | null>(null);
  const myTradesRefreshRef = useRef<Promise<void> | null>(null);
  const publicTradesRefreshQueuedRef = useRef(false);
  const myTradesRefreshQueuedRef = useRef(false);
  const myTradesRefreshQueuedSilentRef = useRef(true);
  const detailTradeRef = useRef<TradeSnapshot | null>(null);
  const publicTradesRef = useRef<TradeSnapshot[]>([]);
  const myTradesRef = useRef<TradeSnapshot[]>([]);
  const latestSyncSessionKeyRef = useRef(syncSessionKey);
  const latestWalletKeyRef = useRef(walletKey);
  const previousWalletKeyRef = useRef(walletKey);
  const latestEnrichMakerPrivateProgressRef = useRef(enrichMakerPrivateProgress);
  const walletReadAccountsKey = buildWalletReadAccountsKey(walletReadAccounts, {
    includePrivateReadState: true
  });

  useEffect(() => {
    detailTradeRef.current = detailTrade;
  }, [detailTrade]);

  useEffect(() => {
    publicTradesRef.current = publicTrades;
  }, [publicTrades]);

  useEffect(() => {
    myTradesRef.current = myTrades;
  }, [myTrades]);

  useEffect(() => {
    latestSyncSessionKeyRef.current = syncSessionKey;
  }, [syncSessionKey]);

  useEffect(() => {
    latestWalletKeyRef.current = walletKey;
  }, [walletKey]);

  useEffect(() => {
    latestEnrichMakerPrivateProgressRef.current = enrichMakerPrivateProgress;
  }, [enrichMakerPrivateProgress]);

  useEffect(() => {
    const cached = readP2PTradeDataWarmCache(syncSessionKey);
    if (!cached) {
      return;
    }

    const routeMatches = cachedRouteMatches(
      cached,
      routeView,
      routeTradeId,
      routeEscrowContract,
      resolvedRouteAccessSecret
    );
    setPublicTrades(reconcileTradeSnapshotsForReadAccounts(cached.publicTrades, walletReadAccounts, false));
    setMyTrades(reconcileTradeSnapshotsForReadAccounts(cached.myTrades, walletReadAccounts, true));
    setPublicTradesError(cached.publicTradesError);
    setMyTradesError(cached.myTradesError);
    if (routeMatches) {
      const cachedRouteSecretIsValidated = hasValidatedRouteAccessSecret(
        resolvedRouteAccessSecret,
        cached.validatedRouteAccessSecret
      );
      setDetailTrade(
        cached.detailTrade
          ? reconcileTradeSnapshotForReadAccounts(cached.detailTrade, walletReadAccounts, {
              preserveAuthorizedDirectTerms: cachedRouteSecretIsValidated
            })
          : null
      );
      setValidatedDetailRouteAccessSecret(cached.validatedRouteAccessSecret ?? '');
      setDetailTradeError(cached.detailTradeError);
    } else {
      const currentDetailMatchesRoute =
        !normalizeRouteAccessSecret(resolvedRouteAccessSecret) &&
        detailSnapshotCanRenderForRoute(
          detailTradeRef.current,
          routeTradeId,
          routeEscrowContract,
          walletKey,
          walletReadAccounts
        );
      setDetailTrade(currentDetailMatchesRoute ? detailTradeRef.current : null);
      setValidatedDetailRouteAccessSecret('');
      setDetailTradeError(currentDetailMatchesRoute ? '' : routeError);
    }
    setTradeAccessBlocked(routeMatches ? cached.tradeAccessBlocked : false);
  }, [
    resolvedRouteAccessSecret,
    routeError,
    routeEscrowContract,
    routeTradeId,
    routeView,
    syncSessionKey,
    walletKey,
    walletReadAccountsKey
  ]);

  useEffect(() => {
    const routeAccessSecret = normalizeRouteAccessSecret(resolvedRouteAccessSecret);
    const cachedDetailTrade = resolveRenderableDetailTrade({
      detailTrade,
      routeAccessSecret,
      routeEscrowContract,
      routeTradeId,
      routeView,
      validatedRouteAccessSecret: validatedDetailRouteAccessSecret,
      walletKey,
      walletReadAccounts
    });
    p2pTradeDataWarmCacheBySession.set(syncSessionKey, {
      detailTrade: cachedDetailTrade,
      detailTradeError: cachedDetailTrade ? detailTradeError : '',
      myTrades,
      myTradesError,
      publicTrades,
      publicTradesError,
      routeAccessSecret,
      routeEscrowContract,
      routeTradeId,
      routeView,
      tradeAccessBlocked: cachedDetailTrade ? tradeAccessBlocked : false,
      updatedAt: Date.now(),
      validatedRouteAccessSecret: cachedDetailTrade ? validatedDetailRouteAccessSecret : ''
    });
  }, [
    detailTrade,
    detailTradeError,
    myTrades,
    myTradesError,
    publicTrades,
    publicTradesError,
    resolvedRouteAccessSecret,
    routeEscrowContract,
    routeTradeId,
    routeView,
    syncSessionKey,
    tradeAccessBlocked,
    validatedDetailRouteAccessSecret,
    walletKey,
    walletReadAccountsKey
  ]);

  useEffect(() => {
    const previousWalletKey = previousWalletKeyRef.current;
    if (previousWalletKey === walletKey) {
      return;
    }
    previousWalletKeyRef.current = walletKey;
    setPublicTrades((current) => current.map(stripWalletScopedTradeSnapshot));
    setDetailTrade((current) => (current ? stripWalletScopedTradeSnapshot(current) : current));
    setMyTrades([]);
  }, [walletKey]);

  useEffect(() => {
    setPublicTrades((current) => reconcileTradeSnapshotsForReadAccounts(current, walletReadAccounts, false));
    setMyTrades((current) => reconcileTradeSnapshotsForReadAccounts(current, walletReadAccounts, true));
    setDetailTrade((current) =>
      current
        ? reconcileTradeSnapshotForReadAccounts(current, walletReadAccounts, {
            preserveAuthorizedDirectTerms: hasValidatedRouteAccessSecret(
              resolvedRouteAccessSecret,
              validatedDetailRouteAccessSecret
            )
          })
        : current
    );
  }, [resolvedRouteAccessSecret, validatedDetailRouteAccessSecret, walletReadAccountsKey]);

  const enrichMakerPrivateProgressForList = useCallback(
    async (snapshots: TradeSnapshot[], account?: WalletReadAccount): Promise<TradeSnapshot[]> =>
      Promise.all(snapshots.map((snapshot) => enrichMakerPrivateProgress(snapshot, Boolean(account?.canReadPrivate), account))),
    [enrichMakerPrivateProgress]
  );
  const latestMyTradesRefreshArgsRef = useRef({
    enrichMakerPrivateProgressForList,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenDecimals,
    rewardTokenSymbol,
    walletAddress,
    walletReadAccounts
  });
  useEffect(() => {
    latestMyTradesRefreshArgsRef.current = {
      enrichMakerPrivateProgressForList,
      privateRewardTokenDecimals,
      privateRewardTokenSymbol,
      rewardTokenDecimals,
      rewardTokenSymbol,
      walletAddress,
      walletReadAccounts
    };
  }, [
    enrichMakerPrivateProgressForList,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenDecimals,
    rewardTokenSymbol,
    walletAddress,
    walletReadAccounts
  ]);

  const fetchPublicTradeSnapshotBatch = useCallback(
    () =>
      fetchRecentTradeSnapshots({
        rewardTokenSymbol,
        rewardTokenDecimals,
        privateRewardTokenSymbol,
        privateRewardTokenDecimals,
        limit: 80
      }),
    [privateRewardTokenDecimals, privateRewardTokenSymbol, rewardTokenDecimals, rewardTokenSymbol]
  );

  const refreshPublicTrades = useCallback(async (options?: TradeRefreshOptions) => {
    const silent = Boolean(options?.silent);
    if (shouldHoldTradeReadForWalletFlow(silent, publicTradesRef.current.length > 0)) {
      return;
    }
    if (publicTradesRefreshRef.current) {
      publicTradesRefreshQueuedRef.current = true;
      return publicTradesRefreshRef.current;
    }

    const refreshRequest = (async () => {
      do {
        const requestSessionKey = latestSyncSessionKeyRef.current || syncSessionKey;
        const requestWalletKey = latestWalletKeyRef.current;
        publicTradesRefreshQueuedRef.current = false;
        if (!silent) {
          setLoadingPublicTrades(true);
          setPublicTradesError('');
        }
        try {
          let snapshots = await fetchPublicTradeSnapshotBatch();
          for (
            let retryIndex = 0;
            !silent && snapshots.length === 0 && retryIndex < PUBLIC_TRADE_EMPTY_RETRY_LIMIT;
            retryIndex += 1
          ) {
            await waitForPublicTradeRetry();
            snapshots = await fetchPublicTradeSnapshotBatch();
          }
          if (latestSyncSessionKeyRef.current === requestSessionKey && latestWalletKeyRef.current === requestWalletKey) {
            setPublicTrades((previous) => mergePublicTradeRefresh(snapshots, previous, silent, requestWalletKey));
            if (silent) {
              setPublicTradesError('');
            }
          } else {
            publicTradesRefreshQueuedRef.current = true;
          }
        } catch (cause) {
          if (latestSyncSessionKeyRef.current !== requestSessionKey || latestWalletKeyRef.current !== requestWalletKey) {
            publicTradesRefreshQueuedRef.current = true;
          } else if (!silent) {
            setPublicTradesError(getProviderErrorMessage(cause, 'Failed to load public trades.'));
          }
        } finally {
          if (!silent && !publicTradesRefreshQueuedRef.current) {
            setLoadingPublicTrades(false);
          }
        }
      } while (publicTradesRefreshQueuedRef.current);

      publicTradesRefreshRef.current = null;
    })();

    publicTradesRefreshRef.current = refreshRequest;
    return refreshRequest;
  }, [fetchPublicTradeSnapshotBatch, syncSessionKey, walletKey]);

  const refreshMyTrades = useCallback(async (options?: TradeRefreshOptions) => {
    const silent = Boolean(options?.silent);
    if (shouldHoldTradeReadForWalletFlow(silent, myTradesRef.current.length > 0)) {
      return;
    }
    const initialReadAccounts =
      walletReadAccounts.length > 0
        ? walletReadAccounts
        : walletAddress
          ? [
              {
                address: walletAddress,
                canReadPrivate: true,
                isActionAccount: true,
                key: normalizeWalletKey(walletAddress),
                label: 'Connected wallet',
                role: 'owner' as const
              }
            ]
          : [];
    if (initialReadAccounts.length === 0) {
      setMyTrades([]);
      return;
    }
    if (myTradesRefreshRef.current) {
      myTradesRefreshQueuedRef.current = true;
      myTradesRefreshQueuedSilentRef.current = myTradesRefreshQueuedSilentRef.current && silent;
      if (!silent) {
        setLoadingMyTrades(true);
        setMyTradesError('');
      }
      return myTradesRefreshRef.current;
    }

    const refreshRequest = (async () => {
      let nextSilent = silent;
      do {
        const currentSilent = nextSilent;
        myTradesRefreshQueuedRef.current = false;
        myTradesRefreshQueuedSilentRef.current = true;
        const requestSessionKey = latestSyncSessionKeyRef.current || syncSessionKey;
        const {
          enrichMakerPrivateProgressForList: enrichLatestMakerPrivateProgressForList,
          privateRewardTokenDecimals: latestPrivateRewardTokenDecimals,
          privateRewardTokenSymbol: latestPrivateRewardTokenSymbol,
          rewardTokenDecimals: latestRewardTokenDecimals,
          rewardTokenSymbol: latestRewardTokenSymbol,
          walletAddress: latestWalletAddress,
          walletReadAccounts: latestWalletReadAccounts
        } = latestMyTradesRefreshArgsRef.current;
        const readAccounts =
          latestWalletReadAccounts.length > 0
            ? latestWalletReadAccounts
            : latestWalletAddress
              ? [
                  {
                    address: latestWalletAddress,
                    canReadPrivate: true,
                    isActionAccount: true,
                    key: normalizeWalletKey(latestWalletAddress),
                    label: 'Connected wallet',
                    role: 'owner' as const
                  }
                ]
              : [];
        if (readAccounts.length === 0) {
          setMyTrades([]);
          setMyTradesError('');
          setLoadingMyTrades(false);
          break;
        }
        const requestWalletKey = buildWalletReadAccountsKey(readAccounts, {
          includePrivateReadState: true
        });
        if (!currentSilent) {
          setLoadingMyTrades(true);
          setMyTradesError('');
        }
        try {
          const snapshotsByAccount = await Promise.all(
            readAccounts.map(async (account) => {
              const snapshotsRaw = await fetchWalletTradeSnapshots(account.address, {
                rewardTokenSymbol: latestRewardTokenSymbol,
                rewardTokenDecimals: latestRewardTokenDecimals,
                privateRewardTokenSymbol: latestPrivateRewardTokenSymbol,
                privateRewardTokenDecimals: latestPrivateRewardTokenDecimals,
                limit: 80
              });
              const snapshots = await enrichLatestMakerPrivateProgressForList(snapshotsRaw, account);
              return {
                account,
                snapshots: snapshots.map((snapshot) => annotateTradeSnapshotForAccount(snapshot, account))
              };
            })
          );
          const latestReadAccountsKey =
            latestMyTradesRefreshArgsRef.current.walletReadAccounts.length > 0
              ? buildWalletReadAccountsKey(latestMyTradesRefreshArgsRef.current.walletReadAccounts, {
                  includePrivateReadState: true
                })
              : buildWalletReadAccountsKey([
                  {
                    address: latestMyTradesRefreshArgsRef.current.walletAddress,
                    canReadPrivate: true,
                    isActionAccount: true,
                    key: normalizeWalletKey(latestMyTradesRefreshArgsRef.current.walletAddress),
                    label: 'Connected wallet',
                    role: 'owner'
                  }
                ], {
                  includePrivateReadState: true
                });
          if (latestReadAccountsKey !== requestWalletKey) {
            myTradesRefreshQueuedRef.current = true;
            continue;
          }
          if (latestSyncSessionKeyRef.current === requestSessionKey) {
            const snapshotsByKey = new Map<string, TradeSnapshot>();
            for (const { account, snapshots } of snapshotsByAccount) {
              for (const snapshot of snapshots) {
                const snapshotKey = getSnapshotKey(snapshot);
                const existing = snapshotsByKey.get(snapshotKey);
                snapshotsByKey.set(snapshotKey, mergeAccountScopedSnapshot(snapshot, existing, account.key));
              }
            }
            setMyTrades((previous) => {
              const previousByKey = new Map(previous.map((trade) => [getSnapshotKey(trade), trade]));
              const incoming = Array.from(snapshotsByKey.values()).map((snapshot) => {
                const accountKey = snapshot.accountAddress?.trim().toLowerCase() || latestWalletKeyRef.current;
                return mergeAccountScopedSnapshot(snapshot, previousByKey.get(getSnapshotKey(snapshot)), accountKey);
              });
              return sortTrades(mergeTradeSnapshotList(incoming, previous, undefined));
            });
            if (currentSilent) {
              setMyTradesError('');
            }
          } else {
            myTradesRefreshQueuedRef.current = true;
          }
        } catch {
          if (!currentSilent) {
            setMyTradesError('Failed to load your trades.');
          }
        } finally {
          if (!currentSilent) {
            setLoadingMyTrades(false);
          }
        }
        nextSilent = myTradesRefreshQueuedSilentRef.current;
      } while (myTradesRefreshQueuedRef.current);

      myTradesRefreshRef.current = null;
    })();

    myTradesRefreshRef.current = refreshRequest;
    return refreshRequest;
  }, [
    enrichMakerPrivateProgressForList,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenDecimals,
    rewardTokenSymbol,
    syncSessionKey,
    walletAddress,
    walletReadAccounts
  ]);

  const mergeTradeSnapshot = useCallback(
    (snapshot: TradeSnapshot, detailOptions: WalletScopedTradeFilterOptions = {}) => {
      const snapshotKey = getSnapshotKey(snapshot);
      const existingDetail = detailTradeRef.current;
      const resolveSnapshotMergeWalletKey = (incoming: TradeSnapshot, existing?: TradeSnapshot | null): string =>
        normalizeWalletKey(incoming.accountAddress) || normalizeWalletKey(existing?.accountAddress) || walletKey;
      const matchingDetail =
        existingDetail && getSnapshotKey(existingDetail) === snapshotKey ? existingDetail : undefined;
      const snapshotWalletKey = resolveSnapshotMergeWalletKey(snapshot, matchingDetail);
      const { detailSnapshot: mergedDetailSnapshot, listSnapshot: mergedSnapshot } = mergeRefreshedTradeSnapshotScopes({
        snapshot,
        existingDetail: matchingDetail,
        preserveAuthorizedDirectTerms: Boolean(detailOptions.preserveAuthorizedDirectTerms),
        walletKey: snapshotWalletKey
      });
      setDetailTrade((current) =>
        current && getSnapshotKey(current) === snapshotKey
          ? mergeTradeSnapshotEnrichment(
              mergedDetailSnapshot,
              current,
              resolveSnapshotMergeWalletKey(mergedDetailSnapshot, current),
              detailOptions
            )
          : current
      );
      setPublicTrades((previous) => {
        const withoutCurrent = previous.filter((trade) => getSnapshotKey(trade) !== snapshotKey);
        const existing = previous.find((trade) => getSnapshotKey(trade) === snapshotKey);
        const nextSnapshot = mergeTradeSnapshotEnrichment(
          mergedSnapshot,
          existing,
          resolveSnapshotMergeWalletKey(mergedSnapshot, existing)
        );
        if (nextSnapshot.isPublic && nextSnapshot.status === 'open') {
          return sortTrades([nextSnapshot, ...withoutCurrent]);
        }
        return sortTrades(withoutCurrent);
      });
      const snapshotParticipantKeys = [mergedSnapshot.maker.toLowerCase(), mergedSnapshot.taker.toLowerCase()];
      if (
        (walletKey && snapshotParticipantKeys.includes(walletKey)) ||
        (snapshotWalletKey && snapshotParticipantKeys.includes(snapshotWalletKey)) ||
        mergedSnapshot.walletHasFill
      ) {
        setMyTrades((previous) => {
          const withoutCurrent = previous.filter((trade) => getSnapshotKey(trade) !== snapshotKey);
          const existing = previous.find((trade) => getSnapshotKey(trade) === snapshotKey);
          return sortTrades([
            mergeTradeSnapshotEnrichment(
              mergedSnapshot,
              existing,
              resolveSnapshotMergeWalletKey(mergedSnapshot, existing)
            ),
            ...withoutCurrent
          ]);
        });
      }
    },
    [walletKey]
  );

  const readTradeSnapshot = useCallback(
    async (tradeId: number, escrowContract?: string): Promise<TradeSnapshot | null> => {
      return fetchTradeSnapshotById(tradeId, {
        rewardTokenSymbol,
        rewardTokenDecimals,
        privateRewardTokenSymbol,
        privateRewardTokenDecimals,
        escrowContract,
        accessSecret: resolvedRouteAccessSecret || undefined,
        callerAddress: walletAddress || undefined
      });
    },
    [
      privateRewardTokenDecimals,
      privateRewardTokenSymbol,
      rewardTokenDecimals,
      rewardTokenSymbol,
      resolvedRouteAccessSecret,
      walletAddress
    ]
  );

  const readTradeDetail = useCallback(
    async (tradeId: number, escrowContract?: string): Promise<TradeSnapshot | null> => {
      const snapshot = await readTradeSnapshot(tradeId, escrowContract);
      return snapshot ? latestEnrichMakerPrivateProgressRef.current(snapshot) : null;
    },
    [readTradeSnapshot]
  );

  const refreshTradeDetail = useCallback(
    async (tradeId: number, escrowContract?: string, options?: TradeRefreshOptions): Promise<TradeSnapshot | null> => {
      const snapshot = await readTradeDetail(tradeId, escrowContract);
      if (!snapshot) {
        return null;
      }
      const preserveAuthorizedDirectTerms = Boolean(
        hasValidatedRouteAccessSecret(
          resolvedRouteAccessSecret,
          validatedDetailRouteAccessSecret
        ) &&
        detailSnapshotMatchesRoute(
          snapshot,
          routeTradeId,
          routeEscrowContract
        )
      );
      mergeTradeSnapshot(snapshot, { preserveAuthorizedDirectTerms });
      if (options?.silent) {
        setDetailTradeError('');
      }
      return snapshot;
    },
    [
      mergeTradeSnapshot,
      readTradeDetail,
      resolvedRouteAccessSecret,
      routeEscrowContract,
      routeTradeId,
      validatedDetailRouteAccessSecret
    ]
  );

  const clearMyTrades = useCallback(() => {
    setMyTrades([]);
  }, []);

  const hasActiveListRefresh = useCallback(
    () => Boolean(publicTradesRefreshRef.current || myTradesRefreshRef.current),
    []
  );

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    const refreshWhenWalletFlowSettles = () => {
      if (cancelled) {
        return;
      }
      const hasExistingPublicTrades = publicTradesRef.current.length > 0;
      if (shouldHoldTradeReadForWalletFlow(hasExistingPublicTrades, hasExistingPublicTrades)) {
        retryTimer = window.setTimeout(refreshWhenWalletFlowSettles, WALLET_FLOW_LIST_REFRESH_RETRY_MS);
        return;
      }
      refreshPublicTrades({ silent: hasExistingPublicTrades }).catch(() => {});
    };

    refreshWhenWalletFlowSettles();
    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [refreshPublicTrades]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    const refreshWhenWalletFlowSettles = () => {
      if (cancelled) {
        return;
      }
      const hasExistingMyTrades = myTradesRef.current.length > 0;
      if (shouldHoldTradeReadForWalletFlow(hasExistingMyTrades, hasExistingMyTrades)) {
        retryTimer = window.setTimeout(refreshWhenWalletFlowSettles, WALLET_FLOW_LIST_REFRESH_RETRY_MS);
        return;
      }
      refreshMyTrades({ silent: hasExistingMyTrades }).catch(() => {});
    };

    refreshWhenWalletFlowSettles();
    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [refreshMyTrades]);

  useEffect(() => {
    if (routeView !== 'trade' || routeTradeId === null) {
      if (getWalletTransactionFlowState() !== 'inactive' && detailTradeRef.current) {
        return;
      }
      setDetailTrade(null);
      setValidatedDetailRouteAccessSecret('');
      setDetailTradeError(routeError);
      setTradeAccessBlocked(false);
      setLoadingDetailTrade(false);
      return;
    }

    let cancelled = false;
    const currentDetail = detailTradeRef.current;
    const hasCurrentDetail = Boolean(
      resolveRenderableDetailTrade({
        detailTrade: currentDetail,
        routeAccessSecret: resolvedRouteAccessSecret,
        routeEscrowContract,
        routeTradeId,
        routeView,
        validatedRouteAccessSecret: validatedDetailRouteAccessSecret,
        walletKey,
        walletReadAccounts
      })
    );
    setLoadingDetailTrade(!hasCurrentDetail);
    if (!hasCurrentDetail) {
      setDetailTradeError('');
      setTradeAccessBlocked(false);
      if (normalizeRouteAccessSecret(resolvedRouteAccessSecret)) {
        setDetailTrade(null);
        setValidatedDetailRouteAccessSecret('');
      }
    }

    const loadDetail = async () => {
      try {
        const [metadata, snapshot] = await Promise.all([
          withTimeout(
            fetchTradeAccessMetadataById(routeTradeId, routeEscrowContract),
            TRADE_DETAIL_LOAD_TIMEOUT_MS,
            'Timed out while reading trade access.'
          ).catch(() => null),
          withTimeout(
            readTradeSnapshot(routeTradeId, routeEscrowContract),
            TRADE_DETAIL_LOAD_TIMEOUT_MS,
            'Timed out while loading trade.'
          )
        ]);
        if (cancelled) {
          return;
        }
        if (!snapshot) {
          setDetailTrade(null);
          setValidatedDetailRouteAccessSecret('');
          return;
        }
        const cotiEthers = await loadCotiEthersModule();
        const accessDecision = resolveTradeDetailAccessDecision({
          hashAccessSecret: (accessSecret) => cotiEthers.keccak256(accessSecret),
          metadata,
          routeAccessSecret: resolvedRouteAccessSecret,
          snapshot,
          walletKey,
          walletReadAccounts
        });
        if (!accessDecision.allowed) {
          setTradeAccessBlocked(true);
          setDetailTrade(null);
          setValidatedDetailRouteAccessSecret('');
          if (accessDecision.error) {
            setDetailTradeError(accessDecision.error);
          }
          return;
        }
        if (!cancelled) {
          const preserveAuthorizedDirectTerms = Boolean(accessDecision.routeSecretValidated);
          setTradeAccessBlocked(false);
          setValidatedDetailRouteAccessSecret(
            preserveAuthorizedDirectTerms
              ? normalizeRouteAccessSecret(resolvedRouteAccessSecret)
              : ''
          );
          setDetailTrade((current) => mergeTradeSnapshotEnrichment(
            snapshot,
            current,
            walletKey,
            { preserveAuthorizedDirectTerms }
          ));

          withTimeout(
            latestEnrichMakerPrivateProgressRef.current(snapshot),
            TRADE_DETAIL_LOAD_TIMEOUT_MS,
            'Timed out while reading private trade history.'
          )
            .then((enrichedSnapshot) => {
              if (!cancelled) {
                setDetailTrade((current) =>
                  mergeTradeSnapshotEnrichment(
                    enrichedSnapshot,
                    current,
                    walletKey,
                    { preserveAuthorizedDirectTerms }
                  )
                );
              }
            })
            .catch(() => {});
        }
      } catch (loadError) {
        if (!cancelled && !hasCurrentDetail) {
          setDetailTradeError(getProviderErrorMessage(loadError, 'Trade was not found on the escrow contract.'));
        }
      } finally {
        if (!cancelled) {
          setLoadingDetailTrade(false);
        }
      }
    };

    loadDetail().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    readTradeSnapshot,
    resolvedRouteAccessSecret,
    routeError,
    routeEscrowContract,
    routeTradeId,
    routeView,
    validatedDetailRouteAccessSecret,
    walletKey,
    walletReadAccountsKey
  ]);

  const scopedPublicTrades = useMemo(
    () => reconcileTradeSnapshotsForReadAccounts(publicTrades, walletReadAccounts, false),
    [publicTrades, walletReadAccounts, walletReadAccountsKey]
  );
  const scopedMyTrades = useMemo(
    () => reconcileTradeSnapshotsForReadAccounts(myTrades, walletReadAccounts, true),
    [myTrades, walletReadAccounts, walletReadAccountsKey]
  );
  const scopedDetailTrade = useMemo(
    () => detailTrade
      ? reconcileTradeSnapshotForReadAccounts(detailTrade, walletReadAccounts, {
          preserveAuthorizedDirectTerms: hasValidatedRouteAccessSecret(
            resolvedRouteAccessSecret,
            validatedDetailRouteAccessSecret
          )
        })
      : null,
    [
      detailTrade,
      resolvedRouteAccessSecret,
      validatedDetailRouteAccessSecret,
      walletReadAccounts,
      walletReadAccountsKey
    ]
  );
  const renderableDetailTrade = resolveRenderableDetailTrade({
    detailTrade: scopedDetailTrade,
    routeAccessSecret: resolvedRouteAccessSecret,
    routeEscrowContract,
    routeTradeId,
    routeView,
    validatedRouteAccessSecret: validatedDetailRouteAccessSecret,
    walletKey,
    walletReadAccounts
  });

  return {
    clearMyTrades,
    detailTrade: renderableDetailTrade,
    detailTradeError,
    hasActiveListRefresh,
    loadingDetailTrade,
    loadingMyTrades,
    loadingPublicTrades,
    mergeTradeSnapshot,
    myTrades: scopedMyTrades,
    myTradesError,
    publicTrades: scopedPublicTrades,
    publicTradesError,
    refreshMyTrades,
    refreshPublicTrades,
    readTradeDetail,
    refreshTradeDetail,
    setDetailTrade,
    setDetailTradeError,
    tradeAccessBlocked
  };
}
