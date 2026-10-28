import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAddress } from '@coti-io/coti-ethers';
import type { DirectTradeV2TradeTerms } from '../../../lib/directTradeV2Actions';
import { buildTradeCustomTokenInfoKey, type TradeCustomTokenInfo } from '../../../lib/appHelpers';
import { getProviderErrorMessage, type TradeSnapshot } from '../../../lib/appShared/core';
import {
  projectDirectTradeV2Snapshot,
  projectPrivateTradeV2Snapshot,
  projectPrivateBookV2Snapshot,
  projectStandardTradeV2Snapshot
} from '../../../lib/oneOffTradeV2Snapshot';
import type { OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import type { PrivateTradeV2AccountSnapshot, PrivateTradeV2OrderView } from '../../../lib/privateTradeV2Actions';
import { isPrivateBookV2RuntimeHash, type PrivateBookV2OrderView } from '../../../lib/privateBookV2Actions';
import type { StandardTradeV2View } from '../../../lib/standardTradeV2Actions';
import type { TradeTokenInfoRequest } from './useP2PTradeTokenData';
import type { TradeHistoryV2OrderRef } from '../../../lib/tradeHistoryV2Ledger';
import type { AttestedTradeHistoryV2Deployment } from '../../../lib/tradeHistoryV2Chain';
import type { RecurringTradeV2TokenMetadataResolver } from '../../../lib/recurringTradeV2Snapshot';

const PAGE_LIMIT = 100n;

export const readOneOffTradeV2OwnerIds = async (
  readPage: (offset: bigint) => Promise<Readonly<{ tradeIds?: readonly string[]; orderIds?: readonly string[]; nextOffset: string }>>,
  isCurrent: () => boolean
): Promise<readonly string[]> => {
  const ids = new Set<string>();
  let offset = 0n;
  for (;;) {
    if (!isCurrent()) throw new Error('Owner order reader is no longer current.');
    const page = await readPage(offset);
    if (!isCurrent()) throw new Error('Owner order reader is no longer current.');
    const values = page.tradeIds ?? page.orderIds;
    if (!values || !/^(0|[1-9][0-9]*)$/.test(page.nextOffset)) throw new Error('Owner order page is malformed.');
    values.forEach(id => ids.add(id));
    const next = BigInt(page.nextOffset);
    if (values.length === 0 || next === 0n) return Object.freeze([...ids]);
    if (next <= offset) throw new Error('Owner order cursor did not advance.');
    offset = next;
  }
};

type ReferencedOneOffTrade = Readonly<{ deployment: AttestedTradeHistoryV2Deployment }> & (
  | Readonly<{ kind: 'standard'; view: StandardTradeV2View }>
  | Readonly<{ kind: 'book'; view: PrivateBookV2OrderView; account?: PrivateTradeV2AccountSnapshot }>
  | Readonly<{ kind: 'private'; view: PrivateTradeV2OrderView; account?: PrivateTradeV2AccountSnapshot }>
  | Readonly<{ kind: 'direct'; view: DirectTradeV2TradeTerms }>
);

export const readOneOffTradeV2Reference = async ({ runtime: root, reference, viewer, privateReadsEnabled }: {
  runtime: OtcV2ActionRuntime; reference: TradeHistoryV2OrderRef; viewer: string; privateReadsEnabled: boolean;
}): Promise<ReferencedOneOffTrade> => {
  if (!root.isCurrent()) throw new Error('The referenced order runtime is no longer current.');
  if (!/^[1-9][0-9]*$/.test(reference.orderId) || BigInt(reference.orderId) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid referenced order ID.');
  const runtime = await root.forReference?.(reference) ?? root;
  const assertCurrent = () => { if (!root.isCurrent() || !runtime.isCurrent()) throw new Error('The referenced order runtime is no longer current.'); };
  assertCurrent();
  const contractAddress = getAddress(reference.contractAddress).toLowerCase();
  const deployment = Object.values(runtime.deployments).find(item => item.chainId === reference.chainId && item.contractAddress.toLowerCase() === contractAddress);
  if (!deployment || !['standard-v2', 'private-v2', 'direct-v2'].includes(deployment.protocol)) throw new Error('The referenced order does not match an admitted one-off deployment.');
  const id = reference.orderId;
  const verifyView = (returnedId: string) => { assertCurrent(); if (returnedId !== id) throw new Error('The reader returned another order.'); };
  if (deployment.protocol === 'standard-v2') {
    const view = await runtime.readStandard(id); verifyView(view.tradeId);
    return Object.freeze({ kind: 'standard', view, deployment });
  }
  if (deployment.protocol === 'direct-v2') {
    const view = await runtime.readDirect(id, privateReadsEnabled); verifyView(view.tradeId);
    return Object.freeze({ kind: 'direct', view, deployment });
  }
  if (isPrivateBookV2RuntimeHash(deployment.runtimeBytecodeHash)) {
    if (!runtime.privateBook) throw new Error('The admitted private-book reader is unavailable.');
    const view = await runtime.privateBook.read(id); verifyView(view.orderId);
    const account = privateReadsEnabled && getAddress(view.maker).toLowerCase() === getAddress(viewer).toLowerCase()
      ? await runtime.privateBook.readAccount(id).catch(() => undefined) : undefined;
    assertCurrent();
    return Object.freeze({ kind: 'book', view, deployment, ...(account ? { account } : {}) });
  }
  const view = await runtime.readPrivateTrade(id); verifyView(view.orderId);
  const account = privateReadsEnabled ? await runtime.readPrivateTradeAccount(id).catch(() => undefined) : undefined;
  assertCurrent();
  return Object.freeze({ kind: 'private', view, deployment, ...(account ? { account } : {}) });
};

const projectReferencedTrade = (detail: ReferencedOneOffTrade, viewer: string, resolveTokenMetadata: RecurringTradeV2TokenMetadataResolver): TradeSnapshot => {
  const { deployment } = detail;
  if (detail.kind === 'standard') return projectStandardTradeV2Snapshot({ deployment, view: detail.view, resolveTokenMetadata });
  if (detail.kind === 'direct') return projectDirectTradeV2Snapshot({ deployment, view: detail.view, resolveTokenMetadata });
  if (detail.kind === 'book') return projectPrivateBookV2Snapshot({ deployment, view: detail.view, account: detail.account, viewer, resolveTokenMetadata });
  return projectPrivateTradeV2Snapshot({ deployment, view: detail.view, account: detail.account, resolveTokenMetadata });
};

export const readRetainedOneOffTradeV2Orders = async ({ runtime: root, viewer, privateReadsEnabled, isCurrent = () => root.isCurrent() }: {
  runtime: OtcV2ActionRuntime; viewer: string; privateReadsEnabled: boolean; isCurrent?: () => boolean;
}): Promise<readonly ReferencedOneOffTrade[]> => {
  const details: ReferencedOneOffTrade[] = [], seen = new Set<string>();
  for (const deployment of root.retainedDeployments ?? []) {
    if (!['standard-v2', 'private-v2', 'direct-v2'].includes(deployment.protocol)) continue;
    const key = `${deployment.chainId}:${deployment.contractAddress.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isCurrent() || !root.isCurrent()) throw new Error('Retained order reader is no longer current.');
    const runtime = await root.forReference?.({ chainId: deployment.chainId, contractAddress: deployment.contractAddress, orderId: '1' });
    if (!runtime?.isCurrent() || !isCurrent()) throw new Error('Retained order reader is unavailable.');
    const actual = runtime.deployments[deployment.protocol as 'standard-v2' | 'private-v2' | 'direct-v2'];
    if (actual.chainId !== deployment.chainId || actual.contractAddress !== deployment.contractAddress ||
        actual.runtimeBytecodeHash !== deployment.runtimeBytecodeHash) throw new Error('Retained order deployment differs.');
    const current = () => isCurrent() && root.isCurrent() && runtime.isCurrent();
    const list = (scope: 'maker' | 'filler') => readOneOffTradeV2OwnerIds(offset => {
      if (deployment.protocol === 'standard-v2') return runtime.listStandard(scope, offset, PAGE_LIMIT);
      if (deployment.protocol === 'direct-v2') return runtime.listDirect(scope === 'maker' ? 'maker' : 'taker', offset, PAGE_LIMIT);
      if (isPrivateBookV2RuntimeHash(deployment.runtimeBytecodeHash)) {
        if (!runtime.privateBook) throw new Error('The admitted private-book reader is unavailable.');
        return runtime.privateBook.list(scope, offset, PAGE_LIMIT);
      }
      return runtime.listPrivateTrade(scope, offset, PAGE_LIMIT);
    }, current);
    const ids = new Set([...(await list('maker')), ...(await list('filler'))]);
    for (const orderId of ids) {
      if (!current()) throw new Error('Retained order reader is no longer current.');
      const reference = { chainId: deployment.chainId, contractAddress: deployment.contractAddress, orderId };
      let detail: ReferencedOneOffTrade;
      try { detail = await readOneOffTradeV2Reference({ runtime: root, reference, viewer, privateReadsEnabled }); }
      catch (cause) {
        if (!current() || !privateReadsEnabled || deployment.protocol !== 'direct-v2') throw cause;
        // Keep the existing amount-free Direct card when participant decryption is unavailable.
        detail = await readOneOffTradeV2Reference({ runtime: root, reference, viewer, privateReadsEnabled: false });
      }
      if (!current()) throw new Error('Retained order reader is no longer current.');
      details.push(detail);
    }
  }
  return Object.freeze(details);
};

type RawState = Readonly<{
  scopeKey: string;
  openStandardIds: ReadonlySet<string>;
  openPrivateIds: ReadonlySet<string>;
  participantStandardIds: ReadonlySet<string>;
  participantPrivateIds: ReadonlySet<string>;
  standardViews: readonly StandardTradeV2View[];
  privateViews: readonly PrivateTradeV2OrderView[];
  privateBookViews: readonly PrivateBookV2OrderView[];
  privateAccounts: Readonly<Record<string, PrivateTradeV2AccountSnapshot>>;
  directViews: readonly DirectTradeV2TradeTerms[];
  retainedTrades: readonly ReferencedOneOffTrade[];
  retainedScope: string;
}>;

export type DirectTradeV2ParticipantHydration = Readonly<{
  views: readonly DirectTradeV2TradeTerms[];
  errorsByTradeId: Readonly<Record<string, string>>;
}>;

export const clearDirectTradeV2RevealErrors = (
  current: Record<string, string>
): Record<string, string> => Object.keys(current).length === 0 ? current : {};

const EMPTY: RawState = Object.freeze({
  scopeKey: '',
  openStandardIds: new Set<string>(),
  openPrivateIds: new Set<string>(),
  participantStandardIds: new Set<string>(),
  participantPrivateIds: new Set<string>(),
  standardViews: Object.freeze([]),
  privateViews: Object.freeze([]),
  privateBookViews: Object.freeze([]),
  privateAccounts: Object.freeze({}),
  directViews: Object.freeze([]),
  retainedTrades: Object.freeze([]),
  retainedScope: ''
});

const unique = (...groups: readonly (readonly string[])[]): string[] => Array.from(new Set(groups.flat()));

const order = (snapshots: readonly TradeSnapshot[]): TradeSnapshot[] => {
  const map = new Map<string, TradeSnapshot>();
  for (const snapshot of snapshots) {
    map.set(`${snapshot.escrowContract?.toLowerCase()}:${snapshot.tradeId}`, snapshot);
  }
  return Array.from(map.values()).sort((left, right) => right.createdAt - left.createdAt || right.tradeId - left.tradeId);
};

export const readOneOffDirectTradeV2PrivateTerms = async ({
  runtime,
  tradeId,
  privateReadsEnabled
}: {
  runtime: Pick<OtcV2ActionRuntime, 'isCurrent' | 'readDirect'>;
  tradeId: bigint | number | string;
  privateReadsEnabled: boolean;
}): Promise<DirectTradeV2TradeTerms> => {
  const id = BigInt(tradeId).toString();
  if (!runtime.isCurrent() || !privateReadsEnabled) {
    throw new Error('Unlock privacy before revealing Direct offer terms.');
  }
  const revealed = await runtime.readDirect(id, true);
  if (
    revealed.offerAmount === undefined ||
    revealed.requestAmount === undefined ||
    BigInt(revealed.offerAmount) <= 0n ||
    BigInt(revealed.requestAmount) <= 0n
  ) {
    throw new Error('Direct private terms were not returned for this participant.');
  }
  return revealed;
};

export const readOneOffDirectTradeV2ParticipantTerms = async ({
  runtime,
  tradeIds,
  privateReadsEnabled
}: {
  runtime: Pick<OtcV2ActionRuntime, 'isCurrent' | 'readDirect'>;
  tradeIds: readonly string[];
  privateReadsEnabled: boolean;
}): Promise<readonly DirectTradeV2TradeTerms[]> => {
  if (!runtime.isCurrent()) {
    throw new Error('Direct offer reader is no longer current.');
  }
  const views: DirectTradeV2TradeTerms[] = [];
  for (const id of tradeIds) {
    if (!privateReadsEnabled) {
      views.push(await runtime.readDirect(id, false));
      continue;
    }
    try {
      views.push(await readOneOffDirectTradeV2PrivateTerms({
        runtime,
        tradeId: id,
        privateReadsEnabled: true
      }));
    } catch {
      // Non-participants and temporarily unavailable private reads still need
      // the amount-free public card. The terminal keeps an explicit retry for
      // an eligible participant whose automatic reveal failed.
      views.push(await runtime.readDirect(id, false));
    }
  }
  return Object.freeze(views);
};

const hasDirectPrivateAmounts = (view: DirectTradeV2TradeTerms): boolean =>
  view.offerAmount !== undefined &&
  view.requestAmount !== undefined &&
  BigInt(view.offerAmount) > 0n &&
  BigInt(view.requestAmount) > 0n;

export const selectAutomaticDirectTradeV2Reveals = ({
  views,
  errorsByTradeId
}: {
  views: readonly DirectTradeV2TradeTerms[];
  errorsByTradeId: Readonly<Record<string, string>>;
}): readonly DirectTradeV2TradeTerms[] => Object.freeze(views.filter(
  (view) =>
    view.amountMode === 'private' &&
    !hasDirectPrivateAmounts(view) &&
    !errorsByTradeId[view.tradeId]
));

export const hydrateOneOffDirectTradeV2ParticipantTerms = async ({
  runtime,
  views,
  privateReadsEnabled
}: {
  runtime: Pick<OtcV2ActionRuntime, 'isCurrent' | 'readDirect'>;
  views: readonly DirectTradeV2TradeTerms[];
  privateReadsEnabled: boolean;
}): Promise<DirectTradeV2ParticipantHydration> => {
  if (!runtime.isCurrent()) {
    throw new Error('Direct offer reader is no longer current.');
  }
  if (!privateReadsEnabled) {
    return Object.freeze({ views: Object.freeze([...views]), errorsByTradeId: Object.freeze({}) });
  }

  const hydrated: DirectTradeV2TradeTerms[] = [];
  const errorsByTradeId: Record<string, string> = {};
  for (const view of views) {
    if (view.amountMode !== 'private' || hasDirectPrivateAmounts(view)) {
      hydrated.push(view);
      continue;
    }
    try {
      hydrated.push(await readOneOffDirectTradeV2PrivateTerms({
        runtime,
        tradeId: view.tradeId,
        privateReadsEnabled: true
      }));
    } catch (cause) {
      hydrated.push(view);
      errorsByTradeId[view.tradeId] = getProviderErrorMessage(
        cause,
        'Direct private terms could not be revealed.'
      );
    }
  }

  return Object.freeze({
    views: Object.freeze(hydrated),
    errorsByTradeId: Object.freeze(errorsByTradeId)
  });
};

export const mergeOneOffDirectTradeV2Views = ({
  current,
  incoming,
  preserveRevealed
}: {
  current: readonly DirectTradeV2TradeTerms[];
  incoming: readonly DirectTradeV2TradeTerms[];
  preserveRevealed: boolean;
}): readonly DirectTradeV2TradeTerms[] => {
  if (!preserveRevealed) return Object.freeze([...incoming]);
  const currentById = new Map(current.map((view) => [view.tradeId, view]));
  return Object.freeze(incoming.map((view) => {
    const revealed = currentById.get(view.tradeId);
    return revealed && hasDirectPrivateAmounts(revealed) && !hasDirectPrivateAmounts(view)
      ? revealed
      : view;
  }));
};

export default function useOneOffTradeV2Data({
  runtime,
  walletAddress,
  dataScopeKey,
  privateReadsEnabled,
  tokenInfoByKey,
  ensureTokenInfo,
  includePublicDiscovery = true,
  reference
}: {
  runtime: OtcV2ActionRuntime | null | undefined;
  walletAddress: string;
  dataScopeKey: string;
  privateReadsEnabled: boolean;
  tokenInfoByKey: Readonly<Record<string, TradeCustomTokenInfo>>;
  ensureTokenInfo: (request: TradeTokenInfoRequest) => Promise<void>;
  includePublicDiscovery?: boolean;
  reference?: TradeHistoryV2OrderRef;
}) {
  const walletScopeKey = walletAddress.trim().toLowerCase();
  const normalizedDataScopeKey = dataScopeKey.trim() ? `${dataScopeKey.trim().toLowerCase()}:${walletScopeKey}` : '';
  const [raw, setRaw] = useState<RawState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [directRevealErrorByTradeId, setDirectRevealErrorByTradeId] = useState<Record<string, string>>({});
  const [revealingDirectTradeId, setRevealingDirectTradeId] = useState('');
  const [refreshRevision, setRefreshRevision] = useState(0);
  const activeDataScopeRef = useRef(normalizedDataScopeKey);
  const referenceKey = reference ? `${reference.chainId}:${reference.contractAddress.toLowerCase()}:${reference.orderId}` : '';
  const referenceScope = `${normalizedDataScopeKey}:${walletScopeKey}:${privateReadsEnabled}`;
  const [referenced, setReferenced] = useState<Readonly<{ key: string; scope: string; runtime: typeof runtime; detail: ReferencedOneOffTrade }> | null>(null);
  const [referenceState, setReferenceState] = useState({ key: '', scope: '', loading: false, error: '' });
  const referenceInputs = useRef({ runtime, scope: referenceScope, tokenInfoByKey });
  referenceInputs.current = { runtime, scope: referenceScope, tokenInfoByKey };
  const resolveReferenceMetadata = useCallback<RecurringTradeV2TokenMetadataResolver>((kind, address) => {
    const info = referenceInputs.current.tokenInfoByKey[buildTradeCustomTokenInfoKey(kind, address)];
    if (!info || info.loading || info.error) throw new Error('Referenced order token metadata is not ready.');
    return { symbol: info.symbol, decimals: info.decimals, custom: true };
  }, []);
  const loadReference = useCallback(async (target: TradeHistoryV2OrderRef) => {
    if (!runtime?.isCurrent()) throw new Error('The referenced order runtime is not current.');
    const detail = await readOneOffTradeV2Reference({ runtime, reference: target, viewer: walletScopeKey, privateReadsEnabled });
    await Promise.all([detail.view.offerAsset, detail.view.requestAsset].flatMap(item => item.assetType === 'native' ? [] : [ensureTokenInfo({ kind: item.assetType, address: item.token })]));
    if (!runtime.isCurrent() || referenceInputs.current.runtime !== runtime || referenceInputs.current.scope !== referenceScope) throw new Error('The referenced order session changed.');
    return detail;
  }, [ensureTokenInfo, privateReadsEnabled, referenceScope, runtime, walletScopeKey]);
  const readReferencedTrade = useCallback(async (target: TradeHistoryV2OrderRef) => {
    const detail = await loadReference(target);
    const snapshot = projectReferencedTrade(detail, walletScopeKey, resolveReferenceMetadata);
    if (`${target.chainId}:${target.contractAddress.toLowerCase()}:${target.orderId}` === referenceKey) {
      setReferenced({ key: referenceKey, scope: referenceScope, runtime, detail });
      setReferenceState({ key: referenceKey, scope: referenceScope, loading: false, error: '' });
    }
    return snapshot;
  }, [loadReference, referenceKey, referenceScope, resolveReferenceMetadata, walletScopeKey]);
  const targetChain = reference?.chainId, targetContract = reference?.contractAddress, targetId = reference?.orderId;
  useEffect(() => {
    if (!targetChain || !targetContract || !targetId) return;
    let cancelled = false;
    setReferenced(current => current?.key === referenceKey && current.scope === referenceScope &&
      current.runtime === runtime && runtime?.isCurrent() ? current : null);
    setReferenceState({ key: referenceKey, scope: referenceScope, loading: true, error: '' });
    if (!runtime?.isCurrent()) return;
    void loadReference({ chainId: targetChain, contractAddress: targetContract, orderId: targetId }).then(detail => {
      if (!cancelled) setReferenced({ key: referenceKey, scope: referenceScope, runtime, detail });
    }).catch(cause => {
      if (!cancelled) setReferenceState({ key: referenceKey, scope: referenceScope, loading: false, error: getProviderErrorMessage(cause, 'The referenced order could not be read.') });
    }).finally(() => {
      if (!cancelled) setReferenceState(current => ({ ...current, loading: false }));
    });
    return () => { cancelled = true; };
  }, [loadReference, referenceKey, referenceScope, targetChain, targetContract, targetId, refreshRevision, runtime]);
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
  const refresh = useCallback(() => {
    setDirectRevealErrorByTradeId({});
    setRefreshRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    if (activeDataScopeRef.current === normalizedDataScopeKey) return;
    activeDataScopeRef.current = normalizedDataScopeKey;
    setRaw(EMPTY);
    setLoading(false);
    setError('');
    setDirectRevealErrorByTradeId(clearDirectTradeV2RevealErrors);
    setRevealingDirectTradeId('');
  }, [normalizedDataScopeKey]);
  const revealDirectTrade = useCallback(async (tradeId: bigint | number | string): Promise<void> => {
    const id = BigInt(tradeId).toString();
    if (!runtime) {
      throw new Error('Unlock privacy before revealing Direct offer terms.');
    }
    setRevealingDirectTradeId(id);
    setDirectRevealErrorByTradeId((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    try {
      const revealed = await readOneOffDirectTradeV2PrivateTerms({
        runtime,
        tradeId: id,
        privateReadsEnabled
      });
      setRaw((current) => Object.freeze({
        ...current,
        directViews: Object.freeze(current.directViews.map((view) =>
          view.tradeId === id ? revealed : view
        ))
      }));
    } catch (cause) {
      const message = getProviderErrorMessage(cause, 'Direct private terms could not be revealed.');
      setDirectRevealErrorByTradeId((current) => ({ ...current, [id]: message }));
      throw cause;
    } finally {
      setRevealingDirectTradeId((current) => current === id ? '' : current);
    }
  }, [privateReadsEnabled, runtime]);

  useEffect(() => {
    if (privateReadsEnabled) return;
    setRaw((current) => {
      if (current.privateBookViews.length === 0 || Object.keys(current.privateAccounts).length === 0) return current;
      return Object.freeze({ ...current, privateAccounts: Object.freeze({}) });
    });
  }, [privateReadsEnabled, raw.privateBookViews, raw.privateAccounts]);

  useEffect(() => {
    let cancelled = false;
    if (
      !runtime ||
      !runtime.isCurrent() ||
      !walletScopeKey ||
      raw.scopeKey !== normalizedDataScopeKey
    ) {
      return () => { cancelled = true; };
    }
    if (!privateReadsEnabled) {
      setRaw((current) => {
        if (!current.directViews.some((view) => view.amountMode === 'private' && hasDirectPrivateAmounts(view))) {
          return current;
        }
        return Object.freeze({
          ...current,
          directViews: Object.freeze(current.directViews.map((view) => view.amountMode === 'private'
            ? Object.freeze({ ...view, offerAmount: undefined, requestAmount: undefined })
            : view))
        });
      });
      setDirectRevealErrorByTradeId(clearDirectTradeV2RevealErrors);
      setRevealingDirectTradeId((current) => current ? '' : current);
      return () => { cancelled = true; };
    }
    const pendingViews = selectAutomaticDirectTradeV2Reveals({
      views: raw.directViews,
      errorsByTradeId: directRevealErrorByTradeId
    });
    if (pendingViews.length === 0) {
      return () => { cancelled = true; };
    }

    setRevealingDirectTradeId(pendingViews[0].tradeId);
    void hydrateOneOffDirectTradeV2ParticipantTerms({
      runtime,
      views: pendingViews,
      privateReadsEnabled: true
    }).then(({ views, errorsByTradeId }) => {
      if (cancelled || !runtime.isCurrent()) return;
      const hydratedById = new Map(views.map((view) => [view.tradeId, view]));
      if (views.some(hasDirectPrivateAmounts)) {
        setRaw((current) => Object.freeze({
          ...current,
          directViews: Object.freeze(current.directViews.map((view) => {
            const hydrated = hydratedById.get(view.tradeId);
            return hydrated && hasDirectPrivateAmounts(hydrated) ? hydrated : view;
          }))
        }));
      }
      setDirectRevealErrorByTradeId((current) => {
        const next = { ...current };
        for (const view of pendingViews) {
          const error = errorsByTradeId[view.tradeId];
          if (error) next[view.tradeId] = error;
          else delete next[view.tradeId];
        }
        return next;
      });
      setRevealingDirectTradeId('');
    }).catch((cause) => {
      if (cancelled) return;
      const message = getProviderErrorMessage(cause, 'Direct private terms could not be revealed.');
      setDirectRevealErrorByTradeId((current) => ({
        ...current,
        ...Object.fromEntries(pendingViews.map((view) => [view.tradeId, message]))
      }));
      setRevealingDirectTradeId('');
    });
    return () => { cancelled = true; };
  }, [
    directRevealErrorByTradeId,
    normalizedDataScopeKey,
    privateReadsEnabled,
    raw.directViews,
    raw.scopeKey,
    runtime,
    walletScopeKey
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!walletScopeKey || !normalizedDataScopeKey) {
      setRaw(EMPTY);
      setLoading(false);
      setError('');
      setDirectRevealErrorByTradeId({});
      setRevealingDirectTradeId('');
      return () => { cancelled = true; };
    }
    if (!runtime || !runtime.isCurrent()) {
      // Runtime replacement is an implementation detail. Keep the last
      // verified projection visible for this exact wallet/network scope while
      // the replacement is attested, instead of flashing an empty/legacy UI.
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    setError('');
    void (async () => {
      const current = () => !cancelled && runtime.isCurrent();
      const [
        openStandard, makerStandard, fillerStandard,
        openPrivate, makerPrivate, fillerPrivate,
        makerDirect, takerDirect
      ] = await Promise.all([
        includePublicDiscovery ? runtime.listStandard('open', 0n, PAGE_LIMIT) : { tradeIds: [] },
        readOneOffTradeV2OwnerIds(offset => runtime.listStandard('maker', offset, PAGE_LIMIT), current),
        readOneOffTradeV2OwnerIds(offset => runtime.listStandard('filler', offset, PAGE_LIMIT), current),
        includePublicDiscovery
          ? runtime.privateBook ? runtime.privateBook.list('open', 0n, PAGE_LIMIT) : runtime.listPrivateTrade('open', 0n, PAGE_LIMIT)
          : { orderIds: [] },
        readOneOffTradeV2OwnerIds(offset => runtime.privateBook ? runtime.privateBook.list('maker', offset, PAGE_LIMIT) : runtime.listPrivateTrade('maker', offset, PAGE_LIMIT), current),
        readOneOffTradeV2OwnerIds(offset => runtime.privateBook ? runtime.privateBook.list('filler', offset, PAGE_LIMIT) : runtime.listPrivateTrade('filler', offset, PAGE_LIMIT), current),
        readOneOffTradeV2OwnerIds(offset => runtime.listDirect('maker', offset, PAGE_LIMIT), current),
        readOneOffTradeV2OwnerIds(offset => runtime.listDirect('taker', offset, PAGE_LIMIT), current)
      ]);
      if (!current()) return;
      const participantStandardIds = unique(makerStandard, fillerStandard);
      const participantPrivateIds = unique(makerPrivate, fillerPrivate);
      const directIds = unique(makerDirect, takerDirect);
      const [standardViews, privateViews, directViews] = await Promise.all([
        Promise.all(unique(openStandard.tradeIds, participantStandardIds).map((id) => runtime.readStandard(id))),
        Promise.all(unique(openPrivate.orderIds, participantPrivateIds).map((id) => runtime.privateBook ? runtime.privateBook.read(id) : runtime.readPrivateTrade(id))),
        readOneOffDirectTradeV2ParticipantTerms({
          runtime,
          tradeIds: directIds,
          privateReadsEnabled: false
        })
      ]);
      if (!current()) return;
      const tokenRequests = new Map<string, TradeTokenInfoRequest>();
      const addToken = (kind: 'erc20' | 'private-erc20', address: string) => {
        const request = { kind, address } as const;
        tokenRequests.set(buildTradeCustomTokenInfoKey(kind, address), request);
      };
      for (const view of standardViews) {
        for (const item of [view.offerAsset, view.requestAsset]) if (item.assetType === 'erc20') addToken('erc20', item.token);
      }
      for (const view of privateViews) {
        for (const item of [view.offerAsset, view.requestAsset]) if (item.assetType !== 'native') addToken(item.assetType, item.token);
      }
      for (const view of directViews) {
        for (const item of [view.offerAsset, view.requestAsset]) if (item.assetType !== 'native') addToken(item.assetType, item.token);
      }
      await Promise.all(Array.from(tokenRequests.values()).map(ensureTokenInfo));
      if (!current()) return;
      const loadedTokens = new Set(tokenRequests.keys());
      const publish = (retainedTrades: readonly ReferencedOneOffTrade[] | undefined,
        privateAccounts: Readonly<Record<string, PrivateTradeV2AccountSnapshot>>) => {
        if (!current()) return;
        setRaw(previous => Object.freeze({
          scopeKey: normalizedDataScopeKey,
          retainedTrades: retainedTrades ?? (previous.scopeKey === normalizedDataScopeKey && previous.retainedScope === referenceScope
            ? previous.retainedTrades : []),
          retainedScope: referenceScope,
          openStandardIds: new Set(openStandard.tradeIds),
          openPrivateIds: new Set(openPrivate.orderIds),
          participantStandardIds: new Set(participantStandardIds),
          participantPrivateIds: new Set(participantPrivateIds),
          standardViews: Object.freeze(standardViews),
          privateViews: Object.freeze(runtime.privateBook ? [] : privateViews as PrivateTradeV2OrderView[]),
          privateBookViews: Object.freeze(runtime.privateBook ? privateViews as PrivateBookV2OrderView[] : []),
          privateAccounts: Object.freeze(privateAccounts),
          directViews: mergeOneOffDirectTradeV2Views({
            current: previous.scopeKey === normalizedDataScopeKey ? previous.directViews : [],
            incoming: directViews,
            preserveRevealed: privateReadsEnabled
          })
        }));
      };
      // Current rows do not depend on old deployments or private-account hydration.
      // Keep loading true until the same complete discovery pass ends.
      publish(undefined, {});
      const retainedTrades = await readRetainedOneOffTradeV2Orders({ runtime, viewer: walletScopeKey, privateReadsEnabled, isCurrent: current });
      if (!current()) return;
      for (const detail of retainedTrades) {
        for (const item of [detail.view.offerAsset, detail.view.requestAsset]) if (item.assetType !== 'native') addToken(item.assetType, item.token);
      }
      await Promise.all([...tokenRequests].filter(([key]) => !loadedTokens.has(key)).map(([, token]) => ensureTokenInfo(token)));
      if (!current()) return;
      const privateAccounts: Record<string, PrivateTradeV2AccountSnapshot> = {};
      if (privateReadsEnabled) {
        await Promise.all((runtime.privateBook ? makerPrivate : participantPrivateIds).map(async (id) => {
          const snapshot = await (runtime.privateBook ? runtime.privateBook.readAccount(id) : runtime.readPrivateTradeAccount(id)).catch(() => undefined);
          if (snapshot) privateAccounts[id] = snapshot;
        }));
      }
      if (cancelled || !runtime.isCurrent()) return;
      publish(retainedTrades, privateAccounts);
      setLoading(false);
    })().catch((cause) => {
      if (cancelled) return;
      setLoading(false);
      setError(getProviderErrorMessage(cause, 'OTC V2 orders could not be loaded.'));
    });
    return () => { cancelled = true; };
  }, [ensureTokenInfo, includePublicDiscovery, normalizedDataScopeKey, privateReadsEnabled, refreshRevision, runtime, walletScopeKey, referenceScope]);

  const projected = useMemo(() => {
    if (raw.scopeKey !== normalizedDataScopeKey || !projectionDeployments) return { active: [], mine: [] };
    const resolveTokenMetadata = (kind: 'erc20' | 'private-erc20', address: string) => {
      const info = tokenInfoByKey[buildTradeCustomTokenInfoKey(kind, address)];
      if (!info || info.loading || info.error) throw new Error('OTC V2 token metadata is not ready.');
      return { symbol: info.symbol, decimals: info.decimals, custom: true };
    };
    const standard = raw.standardViews.flatMap((view) => {
      try {
        return [projectStandardTradeV2Snapshot({ view, deployment: projectionDeployments['standard-v2'], resolveTokenMetadata })];
      } catch { return []; }
    });
    const privateOrders = raw.privateViews.flatMap((view) => {
      try {
        return [projectPrivateTradeV2Snapshot({
          view,
          deployment: projectionDeployments['private-v2'],
          resolveTokenMetadata,
          account: privateReadsEnabled ? raw.privateAccounts[view.orderId] : undefined
        })];
      } catch { return []; }
    });
    const privateBookOrders = raw.privateBookViews.flatMap((view) => {
      try {
        return [projectPrivateBookV2Snapshot({ view, deployment: projectionDeployments['private-v2'],
          resolveTokenMetadata, viewer: walletScopeKey,
          account: privateReadsEnabled && view.maker.toLowerCase() === walletScopeKey ? raw.privateAccounts[view.orderId] : undefined })];
      } catch { return []; }
    });
    const direct = raw.directViews.flatMap((view) => {
      try {
        return [projectDirectTradeV2Snapshot({ view: !privateReadsEnabled && view.amountMode === 'private' ? { ...view, offerAmount: undefined, requestAmount: undefined } : view, deployment: projectionDeployments['direct-v2'], resolveTokenMetadata })];
      } catch { return []; }
    });
    const retained = raw.retainedScope === referenceScope && runtime?.isCurrent() ? raw.retainedTrades.flatMap(detail => {
      try { return [projectReferencedTrade(detail, walletScopeKey, resolveTokenMetadata)]; } catch { return []; }
    }) : [];
    return {
      active: order([
        ...standard.filter((snapshot) => raw.openStandardIds.has(String(snapshot.tradeId))),
        ...privateOrders.filter((snapshot) => raw.openPrivateIds.has(String(snapshot.tradeId))),
        ...privateBookOrders.filter((snapshot) => raw.openPrivateIds.has(String(snapshot.tradeId)))
      ]),
      mine: order([
        ...standard.filter((snapshot) => raw.participantStandardIds.has(String(snapshot.tradeId))),
        ...privateOrders.filter((snapshot) => raw.participantPrivateIds.has(String(snapshot.tradeId))),
        ...privateBookOrders.filter((snapshot) => raw.participantPrivateIds.has(String(snapshot.tradeId))),
        ...direct,
        ...retained
      ])
    };
  }, [normalizedDataScopeKey, projectionDeployments, raw, tokenInfoByKey, privateReadsEnabled, walletScopeKey, referenceScope, runtime]);

  let referencedTrade: TradeSnapshot | null = null;
  const referenceSetupPending = Boolean(referenceKey && !runtime?.isCurrent());
  let referencedTradeError = !referenceSetupPending && referenceState.key === referenceKey && referenceState.scope === referenceScope ? referenceState.error : '';
  if (referenced?.key === referenceKey && referenced.scope === referenceScope && referenced.runtime === runtime && runtime?.isCurrent()) {
    try { referencedTrade = projectReferencedTrade(referenced.detail, walletScopeKey, resolveReferenceMetadata); }
    catch (cause) { referencedTradeError = getProviderErrorMessage(cause, 'Referenced order metadata is unavailable.'); }
  }
  return {
    referencedTrade,
    referencedTradeError,
    loadingReferencedTrade: referenceSetupPending || (referenceState.key === referenceKey && referenceState.scope === referenceScope && referenceState.loading),
    readReferencedTrade,
    activeOneOffV2Trades: projected.active,
    myOneOffV2Trades: projected.mine,
    loadingOneOffV2Trades: loading,
    oneOffV2TradesError: error,
    refreshOneOffV2Trades: refresh,
    revealDirectTrade,
    directRevealErrorByTradeId,
    revealingDirectTradeId
  };
}
