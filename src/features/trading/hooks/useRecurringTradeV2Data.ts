import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import type {
  PrivateRecurringTradeV2Inventory,
  PrivateRecurringTradeV2OrderView
} from '../../../lib/privateRecurringTradeV2Actions';
import type { RecurringTradeV2OrderView } from '../../../lib/recurringTradeV2Actions';
import {
  projectPrivateRecurringTradeV2Snapshot,
  projectRecurringTradeV2Snapshot
} from '../../../lib/recurringTradeV2Snapshot';
import { buildTradeCustomTokenInfoKey, type TradeCustomTokenInfo } from '../../../lib/appHelpers';
import { getProviderErrorMessage, type TradeSnapshot } from '../../../lib/appShared/core';
import type { TradeTokenInfoRequest } from './useP2PTradeTokenData';

const PAGE_LIMIT = 100n;

type RawState = Readonly<{
  scopeKey: string;
  activePublicIds: ReadonlySet<string>;
  activePrivateIds: ReadonlySet<string>;
  participantPublicIds: ReadonlySet<string>;
  participantPrivateIds: ReadonlySet<string>;
  publicViews: readonly RecurringTradeV2OrderView[];
  privateViews: readonly PrivateRecurringTradeV2OrderView[];
  privateInventories: Readonly<Record<string, PrivateRecurringTradeV2Inventory>>;
}>;

const EMPTY: RawState = Object.freeze({
  scopeKey: '',
  activePublicIds: new Set<string>(),
  activePrivateIds: new Set<string>(),
  participantPublicIds: new Set<string>(),
  participantPrivateIds: new Set<string>(),
  publicViews: Object.freeze([]),
  privateViews: Object.freeze([]),
  privateInventories: Object.freeze({})
});

const unique = (...pages: readonly (readonly string[])[]): string[] => Array.from(new Set(pages.flat()));

const byTradeKey = (snapshots: readonly TradeSnapshot[]): TradeSnapshot[] => {
  const map = new Map<string, TradeSnapshot>();
  for (const snapshot of snapshots) {
    map.set(`${snapshot.escrowContract?.toLowerCase()}:${snapshot.tradeId}`, snapshot);
  }
  return Array.from(map.values()).sort((left, right) => right.createdAt - left.createdAt || right.tradeId - left.tradeId);
};

export default function useRecurringTradeV2Data({
  runtime,
  walletAddress,
  dataScopeKey,
  privateReadsEnabled,
  tokenInfoByKey,
  ensureTokenInfo,
  includePublicDiscovery = true
}: {
  runtime: OtcV2ActionRuntime | null | undefined;
  walletAddress: string;
  dataScopeKey: string;
  privateReadsEnabled: boolean;
  tokenInfoByKey: Readonly<Record<string, TradeCustomTokenInfo>>;
  ensureTokenInfo: (request: TradeTokenInfoRequest) => Promise<void>;
  includePublicDiscovery?: boolean;
}) {
  const normalizedDataScopeKey = dataScopeKey.trim().toLowerCase();
  const walletScopeKey = walletAddress.trim().toLowerCase();
  const [raw, setRaw] = useState<RawState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshRevision, setRefreshRevision] = useState(0);
  const activeDataScopeRef = useRef(normalizedDataScopeKey);
  const projectionDeploymentsRef = useRef<Readonly<{
    scopeKey: string;
    deployments: OtcV2ActionRuntime['deployments'];
  }> | null>(null);
  const currentDeployments = runtime?.isCurrent() ? runtime.deployments : null;
  if (currentDeployments && normalizedDataScopeKey) {
    projectionDeploymentsRef.current = Object.freeze({
      scopeKey: normalizedDataScopeKey,
      deployments: currentDeployments
    });
  }
  const projectionDeployments = currentDeployments ?? (
    projectionDeploymentsRef.current?.scopeKey === normalizedDataScopeKey
      ? projectionDeploymentsRef.current.deployments
      : null
  );
  const refresh = useCallback(() => setRefreshRevision((value) => value + 1), []);

  useEffect(() => {
    if (activeDataScopeRef.current === normalizedDataScopeKey) return;
    activeDataScopeRef.current = normalizedDataScopeKey;
    setRaw(EMPTY);
    setLoading(false);
    setError('');
  }, [normalizedDataScopeKey]);

  useEffect(() => {
    let cancelled = false;
    if (!walletScopeKey || !normalizedDataScopeKey) {
      setRaw(EMPTY);
      setLoading(false);
      setError('');
      return () => { cancelled = true; };
    }
    if (!runtime || !runtime.isCurrent()) {
      // Keep the last verified projection for this exact wallet/network while
      // a replacement runtime is being attested.
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    setError('');
    void (async () => {
      const current = () => !cancelled && runtime.isCurrent();
      const [activePublic, makerPublic, fillerPublic, activePrivate, makerPrivate, fillerPrivate] = await Promise.all([
        includePublicDiscovery ? runtime.listRecurring('active', 0n, PAGE_LIMIT) : { orderIds: [] },
        runtime.listRecurring('maker', 0n, PAGE_LIMIT),
        runtime.listRecurring('filler', 0n, PAGE_LIMIT),
        includePublicDiscovery ? runtime.listPrivateRecurring('active', 0n, PAGE_LIMIT) : { orderIds: [] },
        runtime.listPrivateRecurring('maker', 0n, PAGE_LIMIT),
        runtime.listPrivateRecurring('filler', 0n, PAGE_LIMIT)
      ]);
      if (!current()) return;
      const participantPublicIds = unique(makerPublic.orderIds, fillerPublic.orderIds);
      const participantPrivateIds = unique(makerPrivate.orderIds, fillerPrivate.orderIds);
      const publicIds = unique(activePublic.orderIds, participantPublicIds);
      const privateIds = unique(activePrivate.orderIds, participantPrivateIds);
      const [publicViews, privateViews] = await Promise.all([
        Promise.all(publicIds.map((orderId) => runtime.readRecurring(orderId))),
        Promise.all(privateIds.map((orderId) => runtime.readPrivateRecurring(orderId)))
      ]);
      if (!current()) return;
      const tokenRequests = new Map<string, TradeTokenInfoRequest>();
      for (const view of publicViews) {
        for (const asset of [view.baseAsset, view.quoteAsset]) {
          if (asset.assetType === 'erc20') {
            const request = { address: asset.token, kind: 'erc20' as const };
            tokenRequests.set(buildTradeCustomTokenInfoKey(request.kind, request.address), request);
          }
        }
      }
      for (const view of privateViews) {
        for (const address of [view.baseToken, view.quoteToken]) {
          const request = { address, kind: 'private-erc20' as const };
          tokenRequests.set(buildTradeCustomTokenInfoKey(request.kind, request.address), request);
        }
      }
      await Promise.all(Array.from(tokenRequests.values()).map((request) => ensureTokenInfo(request)));
      if (!current()) return;
      const privateInventories: Record<string, PrivateRecurringTradeV2Inventory> = {};
      if (privateReadsEnabled) {
        await Promise.all(privateViews.map(async (view) => {
          if (view.maker.toLowerCase() !== walletScopeKey) return;
          const inventory = await runtime.readPrivateRecurringInventory(view.orderId).catch(() => undefined);
          if (inventory) privateInventories[view.orderId] = inventory;
        }));
      }
      if (cancelled || !runtime.isCurrent()) return;
      setRaw(Object.freeze({
        scopeKey: normalizedDataScopeKey,
        activePublicIds: new Set(activePublic.orderIds),
        activePrivateIds: new Set(activePrivate.orderIds),
        participantPublicIds: new Set(participantPublicIds),
        participantPrivateIds: new Set(participantPrivateIds),
        publicViews: Object.freeze(publicViews),
        privateViews: Object.freeze(privateViews),
        privateInventories: Object.freeze(privateInventories)
      }));
      setLoading(false);
    })().catch((cause) => {
      if (cancelled) return;
      setLoading(false);
      setError(getProviderErrorMessage(cause, 'Recurring OTC V2 orders could not be loaded.'));
    });
    return () => { cancelled = true; };
  }, [ensureTokenInfo, includePublicDiscovery, normalizedDataScopeKey, privateReadsEnabled, refreshRevision, runtime, walletScopeKey]);

  const projected = useMemo(() => {
    if (raw.scopeKey !== normalizedDataScopeKey || !projectionDeployments) return { active: [], mine: [] };
    const resolveTokenMetadata = (kind: 'erc20' | 'private-erc20', address: string) => {
      const info = tokenInfoByKey[buildTradeCustomTokenInfoKey(kind, address)];
      if (!info || info.loading || info.error) throw new Error('Recurring V2 token metadata is not ready.');
      return { symbol: info.symbol, decimals: info.decimals, custom: true };
    };
    const publicSnapshots = raw.publicViews.flatMap((view) => {
      try {
        return [projectRecurringTradeV2Snapshot({
          view,
          deployment: projectionDeployments['recurring-v2'],
          resolveTokenMetadata
        })];
      } catch {
        return [];
      }
    });
    const privateSnapshots = raw.privateViews.flatMap((view) => {
      try {
        return [projectPrivateRecurringTradeV2Snapshot({
          view,
          deployment: projectionDeployments['private-recurring-v2'],
          resolveTokenMetadata,
          makerInventory: raw.privateInventories[view.orderId]
        })];
      } catch {
        return [];
      }
    });
    return {
      active: byTradeKey([
        ...publicSnapshots.filter((snapshot) => raw.activePublicIds.has(String(snapshot.tradeId))),
        ...privateSnapshots.filter((snapshot) => raw.activePrivateIds.has(String(snapshot.tradeId)))
      ]),
      mine: byTradeKey([
        ...publicSnapshots.filter((snapshot) => raw.participantPublicIds.has(String(snapshot.tradeId))),
        ...privateSnapshots.filter((snapshot) => raw.participantPrivateIds.has(String(snapshot.tradeId)))
      ])
    };
  }, [normalizedDataScopeKey, projectionDeployments, raw, tokenInfoByKey]);

  return {
    activeRecurringV2Trades: projected.active,
    myRecurringV2Trades: projected.mine,
    loadingRecurringV2Trades: loading,
    recurringV2TradesError: error,
    refreshRecurringV2Trades: refresh
  };
}
