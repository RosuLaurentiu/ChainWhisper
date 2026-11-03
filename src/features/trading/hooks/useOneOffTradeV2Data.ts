import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAddress } from '@coti-io/coti-ethers';
import type { DirectTradeV2TradeTerms } from '../../../lib/directTradeV2Actions';
import { buildTradeCustomTokenInfoKey, type TradeCustomTokenInfo } from '../../../lib/appHelpers';
import { getProviderErrorMessage, type TradeSnapshot } from '../../../lib/appShared/core';
import {
  projectDirectTradeV2Snapshot,
  projectPrivateBookV2Snapshot,
  projectStandardTradeV2Snapshot
} from '../../../lib/oneOffTradeV2Snapshot';
import type { OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import type { PrivateBookV2AccountSnapshot } from '../../../lib/privateBookV2Actions';
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
  | Readonly<{ kind: 'book'; view: PrivateBookV2OrderView; account?: PrivateBookV2AccountSnapshot }>
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
  throw new Error('This private order does not match the current Book deployment.');
};

const projectReferencedTrade = (detail: ReferencedOneOffTrade, viewer: string, resolveTokenMetadata: RecurringTradeV2TokenMetadataResolver): TradeSnapshot => {
  const { deployment } = detail;
  if (detail.kind === 'standard') return projectStandardTradeV2Snapshot({ deployment, view: detail.view, resolveTokenMetadata });
  if (detail.kind === 'direct') return projectDirectTradeV2Snapshot({ deployment, view: detail.view, resolveTokenMetadata });
  return projectPrivateBookV2Snapshot({ deployment, view: detail.view, account: detail.account, viewer, resolveTokenMetadata });
};

type RawState = Readonly<{
  scopeKey: string;
  openStandardIds: ReadonlySet<string>;
  openPrivateIds: ReadonlySet<string>;
  participantStandardIds: ReadonlySet<string>;
  participantPrivateIds: ReadonlySet<string>;
  standardViews: readonly StandardTradeV2View[];
  privateBookViews: readonly PrivateBookV2OrderView[];
  privateAccounts: Readonly<Record<string, PrivateBookV2AccountSnapshot>>;
  privateProjectionSession: object | null;
  directViews: readonly DirectTradeV2TradeTerms[];
  directPrivateSession: object | null;
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
  privateBookViews: Object.freeze([]),
  privateAccounts: Object.freeze({}),
  privateProjectionSession: null,
  directViews: Object.freeze([]),
  directPrivateSession: null,
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
  privateReadsEnabled,
  shouldContinue,
  onProgress
}: {
  runtime: Pick<OtcV2ActionRuntime, 'isCurrent' | 'readDirect'>;
  tradeIds: readonly string[];
  privateReadsEnabled: boolean;
  shouldContinue: () => boolean;
  onProgress?: (views: readonly DirectTradeV2TradeTerms[]) => Promise<void>;
}): Promise<readonly DirectTradeV2TradeTerms[]> => {
  if (!runtime.isCurrent() || !shouldContinue()) {
    throw new Error('Direct offer reader is no longer current.');
  }
  const views: DirectTradeV2TradeTerms[] = [];
  for (const id of tradeIds) {
    if (!runtime.isCurrent() || !shouldContinue()) throw new Error('Direct offer reader is no longer current.');
    if (!privateReadsEnabled) {
      views.push(await runtime.readDirect(id, false));
    } else try {
      views.push(await readOneOffDirectTradeV2PrivateTerms({
        runtime,
        tradeId: id,
        privateReadsEnabled: true
      }));
    } catch {
      if (!runtime.isCurrent() || !shouldContinue()) throw new Error('Direct offer reader is no longer current.');
      // Non-participants and temporarily unavailable private reads still need
      // the amount-free public card. The terminal keeps an explicit retry for
      // an eligible participant whose automatic reveal failed.
      views.push(await runtime.readDirect(id, false));
    }
    if (!runtime.isCurrent() || !shouldContinue()) throw new Error('Direct offer reader is no longer current.');
    await onProgress?.(Object.freeze([...views]));
  }
  if (!runtime.isCurrent() || !shouldContinue()) throw new Error('Direct offer reader is no longer current.');
  return Object.freeze(views);
};

const hasDirectPrivateAmounts = (view: DirectTradeV2TradeTerms): boolean =>
  view.offerAmount !== undefined &&
  view.requestAmount !== undefined &&
  BigInt(view.offerAmount) > 0n &&
  BigInt(view.requestAmount) > 0n;

const withoutDirectPrivateAmounts = (view: DirectTradeV2TradeTerms): DirectTradeV2TradeTerms =>
  view.amountMode === 'private' ? { ...view, offerAmount: undefined, requestAmount: undefined } : view;

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
  privateReadsEnabled,
  shouldContinue
}: {
  runtime: Pick<OtcV2ActionRuntime, 'isCurrent' | 'readDirect'>;
  views: readonly DirectTradeV2TradeTerms[];
  privateReadsEnabled: boolean;
  shouldContinue: () => boolean;
}): Promise<DirectTradeV2ParticipantHydration> => {
  if (!runtime.isCurrent() || !shouldContinue()) {
    throw new Error('Direct offer reader is no longer current.');
  }
  if (!privateReadsEnabled) {
    return Object.freeze({ views: Object.freeze([...views]), errorsByTradeId: Object.freeze({}) });
  }

  const hydrated: DirectTradeV2TradeTerms[] = [];
  const errorsByTradeId: Record<string, string> = {};
  for (const view of views) {
    if (!runtime.isCurrent() || !shouldContinue()) throw new Error('Direct offer reader is no longer current.');
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
      if (!runtime.isCurrent() || !shouldContinue()) throw new Error('Direct offer reader is no longer current.');
      hydrated.push(view);
      errorsByTradeId[view.tradeId] = getProviderErrorMessage(
        cause,
        'Direct private terms could not be revealed.'
      );
    }
  }
  if (!runtime.isCurrent() || !shouldContinue()) throw new Error('Direct offer reader is no longer current.');
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
  reference,
  onInitialDiscoverySettled
}: {
  runtime: OtcV2ActionRuntime | null | undefined;
  walletAddress: string;
  dataScopeKey: string;
  privateReadsEnabled: boolean;
  tokenInfoByKey: Readonly<Record<string, TradeCustomTokenInfo>>;
  ensureTokenInfo: (request: TradeTokenInfoRequest) => Promise<void>;
  includePublicDiscovery?: boolean;
  reference?: TradeHistoryV2OrderRef;
  onInitialDiscoverySettled?: (runtime: OtcV2ActionRuntime) => void;
}) {
  const walletScopeKey = walletAddress.trim().toLowerCase();
  const normalizedDataScopeKey = dataScopeKey.trim() ? `${dataScopeKey.trim().toLowerCase()}:${walletScopeKey}` : '';
  const [raw, setRaw] = useState<RawState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [directRevealErrorByTradeId, setDirectRevealErrorByTradeId] = useState<Record<string, string>>({});
  const [revealingDirectTradeId, setRevealingDirectTradeId] = useState('');
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [settledDiscovery, setSettledDiscovery] = useState<Readonly<{ scope: string; runtime: OtcV2ActionRuntime }> | null>(null);
  const [publicDiscovery, setPublicDiscovery] = useState<Readonly<{
    scope: string; runtime: OtcV2ActionRuntime; includePublic: boolean; loading: boolean; settled: boolean
  }> | null>(null);
  const activeDataScopeRef = useRef(normalizedDataScopeKey);
  const publicRouteRef = useRef({ runtime, scope: normalizedDataScopeKey, enabled: includePublicDiscovery });
  if (publicRouteRef.current.runtime !== runtime || publicRouteRef.current.scope !== normalizedDataScopeKey ||
    publicRouteRef.current.enabled !== includePublicDiscovery) {
    publicRouteRef.current = { runtime, scope: normalizedDataScopeKey, enabled: includePublicDiscovery };
  }
  const requestPublicDiscoveryRef = useRef<(() => void) | null>(null);
  const metadataLoaderRef = useRef(ensureTokenInfo);
  metadataLoaderRef.current = ensureTokenInfo;
  const referenceKey = reference ? `${reference.chainId}:${reference.contractAddress.toLowerCase()}:${reference.orderId}` : '';
  const referenceScope = `${normalizedDataScopeKey}:${walletScopeKey}:${privateReadsEnabled}`;
  const [referenced, setReferenced] = useState<Readonly<{ key: string; scope: string; runtime: typeof runtime; detail: ReferencedOneOffTrade }> | null>(null);
  const [referenceState, setReferenceState] = useState({ key: '', scope: '', loading: false, error: '' });
  const referenceInputs = useRef({ runtime, scope: referenceScope, tokenInfoByKey });
  referenceInputs.current = { runtime, scope: referenceScope, tokenInfoByKey };
  const privateReadSession = useMemo(() => ({ runtime, scope: referenceScope, enabled: privateReadsEnabled, revision: refreshRevision, alive: true }), [runtime, referenceScope, privateReadsEnabled, refreshRevision]);
  const activePrivateSessionRef = useRef(privateReadSession);
  activePrivateSessionRef.current = privateReadSession;
  const privateAttemptsRef = useRef({ session: privateReadSession, refreshRevision, keys: new Set<string>() });
  useEffect(() => {
    privateReadSession.alive = true;
    return () => { privateReadSession.alive = false; };
  }, [privateReadSession]);
  const resolveReferenceMetadata = useCallback<RecurringTradeV2TokenMetadataResolver>((kind, address) => {
    const info = referenceInputs.current.tokenInfoByKey[buildTradeCustomTokenInfoKey(kind, address)];
    if (!info || info.loading || info.error) throw new Error('Referenced order token metadata is not ready.');
    return { symbol: info.symbol, decimals: info.decimals, custom: true };
  }, []);
  const loadReference = useCallback(async (target: TradeHistoryV2OrderRef) => {
    if (!runtime?.isCurrent()) throw new Error('The referenced order runtime is not current.');
    const detail = await readOneOffTradeV2Reference({ runtime, reference: target, viewer: walletScopeKey, privateReadsEnabled });
    if (!privateReadSession.alive || !runtime.isCurrent() || referenceInputs.current.runtime !== runtime || referenceInputs.current.scope !== referenceScope) throw new Error('The referenced order session changed.');
    await Promise.all([detail.view.offerAsset, detail.view.requestAsset].flatMap(item => item.assetType === 'native' ? [] : [ensureTokenInfo({ kind: item.assetType, address: item.token })]));
    if (!privateReadSession.alive || !runtime.isCurrent() || referenceInputs.current.runtime !== runtime || referenceInputs.current.scope !== referenceScope) throw new Error('The referenced order session changed.');
    return detail;
  }, [ensureTokenInfo, privateReadsEnabled, privateReadSession, referenceScope, runtime, walletScopeKey]);
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
    setSettledDiscovery(null);
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
    const current = () => privateReadSession.alive && runtime.isCurrent() &&
      referenceInputs.current.runtime === runtime && referenceInputs.current.scope === referenceScope;
    if (!current()) throw new Error('Direct private reveal session changed.');
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
      if (!current()) throw new Error('Direct private reveal session changed.');
      setRaw((previous) => !current() ? previous : Object.freeze({
        ...previous,
        directPrivateSession: privateReadSession,
        directViews: Object.freeze(previous.directViews.map((view) =>
          view.tradeId === id ? revealed : previous.directPrivateSession === privateReadSession ? view : withoutDirectPrivateAmounts(view)
        ))
      }));
    } catch (cause) {
      const message = getProviderErrorMessage(cause, 'Direct private terms could not be revealed.');
      if (current()) setDirectRevealErrorByTradeId((previous) => ({ ...previous, [id]: message }));
      throw cause;
    } finally {
      if (current()) setRevealingDirectTradeId((previous) => previous === id ? '' : previous);
    }
  }, [privateReadsEnabled, privateReadSession, referenceScope, runtime]);

  useEffect(() => {
    if (privateReadsEnabled) return;
    setRaw((current) => {
      if (!current.privateProjectionSession && Object.keys(current.privateAccounts).length === 0) return current;
      return Object.freeze({ ...current, privateAccounts: Object.freeze({}), privateProjectionSession: null });
    });
  }, [privateReadsEnabled]);

  useEffect(() => {
    if (!runtime?.isCurrent() || !privateReadsEnabled || raw.scopeKey !== normalizedDataScopeKey) return;
    if (privateAttemptsRef.current.session !== privateReadSession || privateAttemptsRef.current.refreshRevision !== refreshRevision) {
      privateAttemptsRef.current = { session: privateReadSession, refreshRevision, keys: new Set<string>() };
    }
    const current = () => privateReadSession.alive && activePrivateSessionRef.current === privateReadSession &&
      runtime.isCurrent() && activeDataScopeRef.current === normalizedDataScopeKey;
    const start = (key: string, read: () => Promise<void>) => {
      if (!current() || privateAttemptsRef.current.keys.has(key)) return;
      privateAttemptsRef.current.keys.add(key);
      void read().catch(cause => {
        if (current()) setError(previous => [previous, getProviderErrorMessage(cause, 'Private order amounts could not be loaded.')].filter(Boolean).join(' '));
      });
    };
    const accountIds = raw.privateBookViews.filter(view => view.maker.toLowerCase() === walletScopeKey).map(view => view.orderId);
    for (const id of accountIds) start(`account:${id}`, async () => {
      if (!current()) return;
      if (!runtime.privateBook) throw new Error('The current private Book is unavailable.');
      const account = await runtime.privateBook.readAccount(id);
      if (!current()) return;
      // Read the latest same-generation map so concurrent completed accounts are retained.
      setRaw(previous => {
        if (!current() || previous.scopeKey !== normalizedDataScopeKey) return previous;
        const same = previous.privateProjectionSession === privateReadSession;
        return Object.freeze({ ...previous, privateProjectionSession: privateReadSession,
          privateAccounts: Object.freeze({ ...(same ? previous.privateAccounts : {}), [id]: account }) });
      });
    });
  }, [normalizedDataScopeKey, privateReadSession, privateReadsEnabled, raw.participantPrivateIds, raw.privateBookViews,
    raw.scopeKey, refreshRevision, runtime, walletScopeKey]);

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
          directPrivateSession: null,
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
      views: raw.directPrivateSession === privateReadSession ? raw.directViews : raw.directViews.map(withoutDirectPrivateAmounts),
      errorsByTradeId: directRevealErrorByTradeId
    });
    if (pendingViews.length === 0) {
      return () => { cancelled = true; };
    }

    setRevealingDirectTradeId(pendingViews[0].tradeId);
    void hydrateOneOffDirectTradeV2ParticipantTerms({
      runtime,
      views: pendingViews,
      privateReadsEnabled: true,
      shouldContinue: () => !cancelled && privateReadSession.alive && activePrivateSessionRef.current === privateReadSession
    }).then(({ views, errorsByTradeId }) => {
      if (cancelled || !runtime.isCurrent() || !privateReadSession.alive || activePrivateSessionRef.current !== privateReadSession) return;
      const hydratedById = new Map(views.map((view) => [view.tradeId, view]));
      if (views.some(hasDirectPrivateAmounts)) {
        setRaw((current) => cancelled || !privateReadSession.alive || activePrivateSessionRef.current !== privateReadSession ? current : Object.freeze({
          ...current,
          directPrivateSession: privateReadSession,
          directViews: Object.freeze(current.directViews.map((view) => {
            const hydrated = hydratedById.get(view.tradeId);
            return hydrated && hasDirectPrivateAmounts(hydrated) ? hydrated : current.directPrivateSession === privateReadSession ? view : withoutDirectPrivateAmounts(view);
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
      if (cancelled || !runtime.isCurrent() || !privateReadSession.alive || activePrivateSessionRef.current !== privateReadSession) return;
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
    privateReadSession,
    raw.directViews,
    raw.scopeKey,
    runtime,
    walletScopeKey
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!walletScopeKey || !normalizedDataScopeKey) {
      setRaw(EMPTY);
      setSettledDiscovery(null);
      setPublicDiscovery(null);
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
      setSettledDiscovery(null);
      setPublicDiscovery(null);
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    setError('');
    const initialPublicRoute = publicRouteRef.current;
    setPublicDiscovery(previous => ({ scope: normalizedDataScopeKey, runtime, includePublic: initialPublicRoute.enabled,
      loading: initialPublicRoute.enabled, settled: Boolean(previous?.scope === normalizedDataScopeKey && previous.runtime === runtime &&
        previous.includePublic === initialPublicRoute.enabled && previous.settled) }));
    let requestPublicDiscovery: (() => void) | null = null;
    void (async () => {
      const current = () => !cancelled && runtime.isCurrent();
      const loadedTokens = new Map<string, { loader: typeof ensureTokenInfo; result: Promise<void> }>();
      const loadToken = async (token: TradeTokenInfoRequest, shouldContinue = current) => {
        const key = buildTradeCustomTokenInfoKey(token.kind, token.address);
        const latest = () => {
          const loader = metadataLoaderRef.current;
          let entry = loadedTokens.get(key);
          if (!entry || entry.loader !== loader) {
            entry = { loader, result: loader(token) };
            loadedTokens.set(key, entry);
          }
          return entry;
        };
        let entry = latest();
        await entry.result;
        if (!shouldContinue()) return;
        if (entry.loader !== metadataLoaderRef.current) {
          // An old fulfilled loader can discard its stale-scope result. Load
          // only this metadata with the current callback; never restart IDs.
          entry = latest();
          await entry.result;
          if (shouldContinue() && entry.loader !== metadataLoaderRef.current) {
            throw new Error('Order token metadata scope changed again during loading.');
          }
        }
      };
      const loadTokens = async (views: readonly (StandardTradeV2View | PrivateBookV2OrderView | DirectTradeV2TradeTerms)[], shouldContinue = current) => {
        if (!shouldContinue()) return;
        const requests: Promise<void>[] = [];
        for (const view of views) for (const item of [view.offerAsset, view.requestAsset]) {
          if (item.assetType === 'native') continue;
          requests.push(loadToken({ kind: item.assetType, address: item.token }, shouldContinue));
        }
        await Promise.all(requests);
      };
      const publish = (patch: Partial<RawState>, shouldContinue = current) => {
        if (!shouldContinue()) return;
        setRaw(previous => {
          if (!shouldContinue()) return previous;
          const base = previous.scopeKey === normalizedDataScopeKey ? previous : EMPTY;
          const next = { ...base, scopeKey: normalizedDataScopeKey, ...patch };
          if (patch.standardViews) {
            next.standardViews = Object.freeze([...new Map([...base.standardViews, ...patch.standardViews]
              .map(view => [view.tradeId, view])).values()].filter(view =>
              next.openStandardIds.has(view.tradeId) || next.participantStandardIds.has(view.tradeId)));
          }
          if (patch.privateBookViews) {
            next.privateBookViews = Object.freeze([...new Map([...base.privateBookViews, ...patch.privateBookViews]
              .map(view => [view.orderId, view])).values()].filter(view =>
              next.openPrivateIds.has(view.orderId) || next.participantPrivateIds.has(view.orderId)));
          }
          return Object.freeze(next);
        });
      };
      const failures = new Map<string, string>();
      const source = async <T,>(name: string, read: () => Promise<T>, shouldContinue = current): Promise<T | undefined> => {
        try { return await read(); }
        catch (cause) {
          if (shouldContinue()) {
            failures.set(name, `${name}: ${getProviderErrorMessage(cause, 'Orders could not be loaded.')}`);
            setError([...failures.values()].join(' '));
          }
          return undefined;
        }
      };
      const publicStandardViews = new Map<string, StandardTradeV2View>();
      const publicPrivateViews = new Map<string, PrivateBookV2OrderView>();
      let publicInFlight: Promise<void> | null = null;
      let releaseInitialPublicWait: () => void = () => {};
      const publicRouteLeft = new Promise<void>(resolve => { releaseInitialPublicWait = resolve; });
      const readPublic = async (route: typeof initialPublicRoute) => {
        const publicCurrent = () => current() && publicRouteRef.current === route && route.enabled;
        if (!publicCurrent()) return;
        failures.delete('Standard'); failures.delete('Private book');
        setError([...failures.values()].join(' '));
        setPublicDiscovery(previous => ({ scope: normalizedDataScopeKey, runtime, includePublic: true,
          loading: true, settled: Boolean(previous?.scope === normalizedDataScopeKey && previous.runtime === runtime && previous.settled) }));
        try {
          await Promise.all([
            source('Standard', async () => {
              const open = await runtime.listStandard('open', 0n, PAGE_LIMIT);
              if (!publicCurrent()) return;
              const views = await Promise.all(unique(open.tradeIds).map(id => runtime.readStandard(id)));
              if (!publicCurrent()) return;
              await loadTokens(views, publicCurrent);
              if (!publicCurrent()) return;
              publicStandardViews.clear();
              views.forEach(view => publicStandardViews.set(view.tradeId, view));
              publish({ openStandardIds: new Set(open.tradeIds), standardViews: Object.freeze(views) }, publicCurrent);
            }, publicCurrent),
            source('Private book', async () => {
              const book = runtime.privateBook;
              if (!book) throw new Error('The current private Book is unavailable.');
              const open = await book.list('open', 0n, PAGE_LIMIT);
              if (!publicCurrent()) return;
              const views = await Promise.all(unique(open.orderIds).map(id => book.read(id)));
              if (!publicCurrent()) return;
              await loadTokens(views, publicCurrent);
              if (!publicCurrent()) return;
              publicPrivateViews.clear();
              views.forEach(view => publicPrivateViews.set(view.orderId, view));
              publish({ openPrivateIds: new Set(open.orderIds), privateBookViews: Object.freeze(views) }, publicCurrent);
            }, publicCurrent)
          ]);
        } finally {
          if (publicCurrent()) setPublicDiscovery({ scope: normalizedDataScopeKey, runtime,
            includePublic: true, loading: false, settled: true });
        }
      };
      const startPublic = () => {
        const route = publicRouteRef.current;
        if (!route.enabled) { releaseInitialPublicWait(); return; }
        if (!current() || publicInFlight) return;
        publicInFlight = readPublic(route).catch(cause => {
          if (current() && publicRouteRef.current === route) setError(getProviderErrorMessage(cause, 'OTC V2 orders could not be loaded.'));
        }).finally(() => {
          publicInFlight = null;
          // A new Offers entry waits for the obsolete public read to drain,
          // then starts one current pass. The owner pass does not restart.
          if (current() && publicRouteRef.current !== route && publicRouteRef.current.enabled) startPublic();
        });
      };
      requestPublicDiscovery = startPublic;
      requestPublicDiscoveryRef.current = startPublic;
      if (initialPublicRoute.enabled) {
        startPublic();
        await Promise.race([publicInFlight, publicRouteLeft]);
        // Give verified Offers a render boundary before owner backfill starts.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (!current()) return;
      // Owner discovery and recovery run even if a public source failed.
      await Promise.all([
        source('Standard owner', async () => {
          const [maker, filler] = await Promise.all([
            readOneOffTradeV2OwnerIds(offset => runtime.listStandard('maker', offset, PAGE_LIMIT), current),
            readOneOffTradeV2OwnerIds(offset => runtime.listStandard('filler', offset, PAGE_LIMIT), current)
          ]);
          if (!current()) return;
          const participantIds = unique(maker, filler);
          const views = await Promise.all(participantIds.map(id => publicStandardViews.get(id) ?? runtime.readStandard(id)));
          await loadTokens(views);
          publish({ participantStandardIds: new Set(participantIds), standardViews: Object.freeze(views) });
        }),
        source('Private book owner', async () => {
          const book = runtime.privateBook;
          if (!book) throw new Error('The current private Book is unavailable.');
          const list = (scope: 'open' | 'maker' | 'filler', offset = 0n) => book.list(scope, offset, PAGE_LIMIT);
          const [maker, filler] = await Promise.all([
            readOneOffTradeV2OwnerIds(offset => list('maker', offset), current),
            readOneOffTradeV2OwnerIds(offset => list('filler', offset), current)
          ]);
          if (!current()) return;
          const participantIds = unique(maker, filler);
          const views = await Promise.all(participantIds.map(id => publicPrivateViews.get(id) ?? book.read(id)));
          await loadTokens(views);
          publish({ participantPrivateIds: new Set(participantIds),
            privateBookViews: Object.freeze(views) });
        }),
        source('Direct', async () => {
          const [maker, taker] = await Promise.all([
            readOneOffTradeV2OwnerIds(offset => runtime.listDirect('maker', offset, PAGE_LIMIT), current),
            readOneOffTradeV2OwnerIds(offset => runtime.listDirect('taker', offset, PAGE_LIMIT), current)
          ]);
          if (!current()) return;
          const publishDirect = async (views: readonly DirectTradeV2TradeTerms[]) => {
            await loadTokens(views);
            if (!current()) return;
            setRaw(previous => {
              if (!current()) return previous;
              const base = previous.scopeKey === normalizedDataScopeKey ? previous : EMPTY;
              return Object.freeze({ ...base, scopeKey: normalizedDataScopeKey, directViews: mergeOneOffDirectTradeV2Views({
                current: base.directViews, incoming: views, preserveRevealed: activePrivateSessionRef.current.enabled && base.directPrivateSession === activePrivateSessionRef.current
              }) });
            });
          };
          const views = await readOneOffDirectTradeV2ParticipantTerms({ runtime, tradeIds: unique(maker, taker),
            privateReadsEnabled: false, shouldContinue: current, onProgress: publishDirect });
          if (views.length === 0) await publishDirect(views);
        })
      ]);
    })().catch((cause) => {
      if (cancelled || !runtime.isCurrent()) return;
      setError(getProviderErrorMessage(cause, 'OTC V2 orders could not be loaded.'));
    }).finally(() => {
      if (cancelled) return;
      setLoading(false);
      // This is an attempt boundary, not complete coverage. A source error
      // remains visible and must not leave independent History blocked forever.
      if (runtime.isCurrent()) {
        setSettledDiscovery({ scope: normalizedDataScopeKey, runtime });
      } else {
        setError('The order runtime is no longer current. Refresh after wallet setup is ready.');
      }
    });
    return () => {
      cancelled = true;
      if (requestPublicDiscoveryRef.current === requestPublicDiscovery) requestPublicDiscoveryRef.current = null;
    };
  }, [normalizedDataScopeKey, refreshRevision, runtime, walletScopeKey]);

  useEffect(() => { requestPublicDiscoveryRef.current?.(); }, [includePublicDiscovery]);

  useEffect(() => {
    if (runtime?.isCurrent() && settledDiscovery?.runtime === runtime && settledDiscovery.scope === normalizedDataScopeKey) {
      onInitialDiscoverySettled?.(runtime);
    }
  }, [normalizedDataScopeKey, onInitialDiscoverySettled, runtime, settledDiscovery]);

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
    const privateBookOrders = raw.privateBookViews.flatMap((view) => {
      try {
        return [projectPrivateBookV2Snapshot({ view, deployment: projectionDeployments['private-v2'],
          resolveTokenMetadata, viewer: walletScopeKey,
          account: privateReadsEnabled && raw.privateProjectionSession === privateReadSession && view.maker.toLowerCase() === walletScopeKey ? raw.privateAccounts[view.orderId] : undefined })];
      } catch { return []; }
    });
    const direct = raw.directViews.flatMap((view) => {
      try {
        return [projectDirectTradeV2Snapshot({ view: !privateReadsEnabled || raw.directPrivateSession !== privateReadSession ? withoutDirectPrivateAmounts(view) : view, deployment: projectionDeployments['direct-v2'], resolveTokenMetadata })];
      } catch { return []; }
    });
    return {
      active: order([
        ...standard.filter((snapshot) => raw.openStandardIds.has(String(snapshot.tradeId))),
        ...privateBookOrders.filter((snapshot) => raw.openPrivateIds.has(String(snapshot.tradeId)))
      ]),
      mine: order([
        ...standard.filter((snapshot) => raw.participantStandardIds.has(String(snapshot.tradeId))),
        ...privateBookOrders.filter((snapshot) => raw.participantPrivateIds.has(String(snapshot.tradeId))),
        ...direct
      ])
    };
  }, [normalizedDataScopeKey, projectionDeployments, raw, tokenInfoByKey, privateReadsEnabled, privateReadSession, walletScopeKey, runtime]);

  let referencedTrade: TradeSnapshot | null = null;
  const publicDiscoveryMatches = runtime?.isCurrent() && publicDiscovery?.runtime === runtime &&
    publicDiscovery.scope === normalizedDataScopeKey && publicDiscovery.includePublic === includePublicDiscovery;
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
    oneOffV2DiscoverySettled: Boolean(runtime?.isCurrent() && settledDiscovery?.runtime === runtime && settledDiscovery.scope === normalizedDataScopeKey),
    oneOffV2PublicDiscoverySettled: Boolean(publicDiscoveryMatches && publicDiscovery.settled),
    loadingPublicOneOffV2Trades: Boolean(runtime?.isCurrent() && includePublicDiscovery &&
      (!publicDiscoveryMatches || publicDiscovery.loading)),
    loadingOneOffV2Trades: loading,
    oneOffV2TradesError: error,
    refreshOneOffV2Trades: refresh,
    revealDirectTrade,
    directRevealErrorByTradeId,
    revealingDirectTradeId
  };
}
