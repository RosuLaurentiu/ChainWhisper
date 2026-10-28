import { getAddress } from '@coti-io/coti-ethers';
import type { GroupChatV2DeploymentConfig } from './groupChatV2Deployment';
import {
  createGroupChatV2DiscoveryRuntime,
  type GroupChatV2DiscoveryRuntime
} from './groupChatV2DiscoveryRuntime';
import {
  createGroupChatV2HistoryRuntime,
  type GroupChatV2HistoryRuntime
} from './groupChatV2HistoryRuntime';
import { createIndexedDbGroupChatV2NonceAttemptRetirer } from './groupChatV2NonceRetirement';
import {
  createGroupChatV2ReadCursorStore,
  type GroupChatV2ReadCursorStore
} from './groupChatV2ReadCursorStore';
import {
  createGroupChatV2Session,
  type GroupChatV2OwnerCapabilityGetter,
  type GroupChatV2SessionController,
  type GroupChatV2TransactionFlow
} from './groupChatV2Session';
import {
  releaseGroupChatV2MetaMaskCapability,
  type GroupChatV2MetaMaskCapability
} from './groupChatV2Chain';

type NonceRetirement = Readonly<{
  retire: Parameters<typeof createGroupChatV2Session>[0]['retireNonceAttempt'];
  close: () => void;
}>;

type CachedOwnerCapabilityGetter = Readonly<{
  get: GroupChatV2OwnerCapabilityGetter;
  invalidate: () => void;
  close: () => void;
}>;

export const createCachedGroupChatV2OwnerCapabilityGetter = ({
  getOwnerCapability,
  releaseCapability = releaseGroupChatV2MetaMaskCapability
}: {
  getOwnerCapability: GroupChatV2OwnerCapabilityGetter;
  releaseCapability?: (capability: GroupChatV2MetaMaskCapability) => unknown;
}): CachedOwnerCapabilityGetter => {
  let publicCapability: Promise<GroupChatV2MetaMaskCapability> | null = null;
  let privateCapability: Promise<GroupChatV2MetaMaskCapability> | null = null;
  let closed = false;

  const load = async (requirePrivacy: boolean): Promise<GroupChatV2MetaMaskCapability> => {
    if (closed) return Promise.reject(new Error('Group Chat V2 wallet capability cache is closed.'));
    const cached = privateCapability ?? (!requirePrivacy ? publicCapability : null);
    if (cached) {
      try {
        return await cached;
      } catch {
        if (privateCapability === cached) privateCapability = null;
        if (publicCapability === cached) publicCapability = null;
        void cached.then(releaseCapability).catch(() => {});
      }
    }

    const pending = getOwnerCapability(requirePrivacy);
    const guarded = pending.catch((error) => {
      if (requirePrivacy && privateCapability === guarded) privateCapability = null;
      if (!requirePrivacy && publicCapability === guarded) publicCapability = null;
      throw error;
    });
    if (requirePrivacy) privateCapability = guarded;
    else publicCapability = guarded;
    return await guarded;
  };

  const invalidate = (): void => {
    const released = new Set<GroupChatV2MetaMaskCapability>();
    for (const pending of [publicCapability, privateCapability]) {
      void pending?.then((capability) => {
        if (released.has(capability)) return;
        released.add(capability);
        releaseCapability(capability);
      }).catch(() => {});
    }
    publicCapability = null;
    privateCapability = null;
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    invalidate();
  };

  return Object.freeze({ get: load, invalidate, close });
};

export type GroupChatV2Runtime =
  | Readonly<{
      enabled: false;
      status: 'inactive' | 'invalid' | 'unavailable';
      error?: string;
      discovery: null;
      history: null;
      readCursors: null;
      session: null;
      isCurrent: () => false;
      close: () => void;
    }>
  | Readonly<{
      enabled: true;
      status: 'active';
      discovery: GroupChatV2DiscoveryRuntime;
      history: GroupChatV2HistoryRuntime;
      readCursors: GroupChatV2ReadCursorStore;
      session: GroupChatV2SessionController;
      isCurrent: () => boolean;
      close: () => void;
    }>;

const disabled = (
  status: 'inactive' | 'invalid' | 'unavailable',
  error?: string
): GroupChatV2Runtime => Object.freeze({
  enabled: false as const,
  status,
  ...(error ? { error } : {}),
  discovery: null,
  history: null,
  readCursors: null,
  session: null,
  isCurrent: () => false as const,
  close: () => {}
});

export const createGroupChatV2Runtime = ({
  deploymentConfig,
  getOwnerCapability,
  nonceRetirementFactory = createIndexedDbGroupChatV2NonceAttemptRetirer,
  ownerAddress,
  readCursorStore,
  runOwnerTransactionFlow
}: {
  deploymentConfig: GroupChatV2DeploymentConfig;
  getOwnerCapability: GroupChatV2OwnerCapabilityGetter;
  nonceRetirementFactory?: () => NonceRetirement;
  ownerAddress: string;
  readCursorStore?: GroupChatV2ReadCursorStore;
  runOwnerTransactionFlow: GroupChatV2TransactionFlow;
}): GroupChatV2Runtime => {
  if (deploymentConfig.status === 'inactive') return disabled('inactive');
  if (deploymentConfig.status === 'invalid') return disabled('invalid', deploymentConfig.error);
  let owner: string;
  try {
    owner = getAddress(ownerAddress.trim());
  } catch {
    return disabled('unavailable', 'Group Chat V2 requires the selected owner wallet.');
  }
  let nonceRetirement: NonceRetirement;
  try {
    nonceRetirement = nonceRetirementFactory();
  } catch {
    return disabled('unavailable', 'Group Chat V2 secure nonce storage is unavailable.');
  }
  let current = true;
  let closed = false;
  let session: GroupChatV2SessionController | null = null;
  let history: GroupChatV2HistoryRuntime | null = null;
  let discovery: GroupChatV2DiscoveryRuntime | null = null;
  let readCursors: GroupChatV2ReadCursorStore | null = null;
  const capabilityCache = createCachedGroupChatV2OwnerCapabilityGetter({
    getOwnerCapability
  });
  try {
    session = createGroupChatV2Session({
      getOwnerCapability: capabilityCache.get,
      invalidateOwnerCapabilities: capabilityCache.invalidate,
      manifest: deploymentConfig.manifest,
      ownerAddress: owner,
      retireNonceAttempt: nonceRetirement.retire,
      runOwnerTransactionFlow
    });
    history = createGroupChatV2HistoryRuntime({
      confirmationDepth: deploymentConfig.finalityLagBlocks,
      isCurrent: () => current,
      ownerAddress: owner,
      session
    });
    discovery = createGroupChatV2DiscoveryRuntime({
      confirmationDepth: deploymentConfig.finalityLagBlocks,
      isCurrent: () => current,
      session
    });
    readCursors = readCursorStore ?? createGroupChatV2ReadCursorStore();
    const activeSession = session;
    const activeHistory = history;
    const activeDiscovery = discovery;
    const activeReadCursors = readCursors;
    return Object.freeze({
      enabled: true as const,
      status: 'active' as const,
      discovery: activeDiscovery,
      history: activeHistory,
      readCursors: activeReadCursors,
      session: activeSession,
      isCurrent: () => current,
      close: () => {
        if (closed) return;
        closed = true;
        current = false;
        activeDiscovery.close();
        activeHistory.close();
        activeReadCursors.close();
        activeSession.clearEpochKeys();
        capabilityCache.close();
        nonceRetirement.close();
      }
    });
  } catch {
    current = false;
    discovery?.close();
    history?.close();
    readCursors?.close();
    session?.clearEpochKeys();
    capabilityCache.close();
    nonceRetirement.close();
    return disabled('unavailable', 'Group Chat V2 runtime initialization failed closed.');
  }
};
