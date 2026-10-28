import { getAddress } from '@coti-io/coti-ethers';
import type { DirectChatV2DeploymentConfig } from './directChatV2Deployment';
import {
  createIndexedDbDirectChatV2NonceAttemptRetirer
} from './directChatV2NonceRetirement';
import {
  createDirectChatV2Session,
  type DirectChatV2OwnerCapabilityGetter,
  type DirectChatV2SessionController,
  type DirectChatV2TransactionFlow
} from './directChatV2Session';
import {
  releaseDirectChatV2MetaMaskCapability,
  type DirectChatV2MetaMaskCapability
} from './directChatV2Chain';
import {
  createDirectChatV2HistoryRuntime,
  type DirectChatV2HistoryRuntime
} from './directChatV2HistoryRuntime';
import type { DirectChatV2ReadCursorStore } from './directChatV2ReadCursorStore';
import {
  createDirectChatV2WriteCoordinator,
  DIRECT_CHAT_V2_WRITE_DISABLED,
  type DirectChatV2WriteCoordinator,
  type DirectChatV2WriteLifecycle
} from './directChatV2WriteCoordinator';

type NonceRetirement = Readonly<{
  retire: Parameters<typeof createDirectChatV2Session>[0]['retireNonceAttempt'];
  close: () => void;
}>;

type CachedOwnerCapabilityGetter = Readonly<{
  get: DirectChatV2OwnerCapabilityGetter;
  invalidate: () => void;
  close: () => void;
}>;

export const createCachedDirectChatV2OwnerCapabilityGetter = ({
  getOwnerCapability,
  releaseCapability = releaseDirectChatV2MetaMaskCapability
}: {
  getOwnerCapability: DirectChatV2OwnerCapabilityGetter;
  releaseCapability?: (capability: DirectChatV2MetaMaskCapability) => void;
}): CachedOwnerCapabilityGetter => {
  let publicCapability: Promise<DirectChatV2MetaMaskCapability> | null = null;
  let privateCapability: Promise<DirectChatV2MetaMaskCapability> | null = null;
  let closed = false;

  const load = (requirePrivacy: boolean): Promise<DirectChatV2MetaMaskCapability> => {
    if (closed) return Promise.reject(new Error('Direct Chat V2 wallet capability cache is closed.'));
    if (privateCapability) return privateCapability;
    if (!requirePrivacy && publicCapability) return publicCapability;

    const pending = getOwnerCapability(requirePrivacy);
    const guarded = pending.catch((error) => {
      if (requirePrivacy && privateCapability === guarded) privateCapability = null;
      if (!requirePrivacy && publicCapability === guarded) publicCapability = null;
      throw error;
    });
    if (requirePrivacy) privateCapability = guarded;
    else publicCapability = guarded;
    return guarded;
  };

  const invalidate = (): void => {
    const released = new Set<DirectChatV2MetaMaskCapability>();
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

export type DirectChatV2Runtime =
  | Readonly<{
      enabled: false;
      status: 'inactive' | 'invalid' | 'unavailable';
      error?: string;
      coordinator: DirectChatV2WriteCoordinator;
      history: null;
      session: null;
      isCurrent: () => false;
      close: () => void;
    }>
  | Readonly<{
      enabled: true;
      status: 'active';
      coordinator: DirectChatV2WriteCoordinator;
      history: DirectChatV2HistoryRuntime;
      session: DirectChatV2SessionController;
      isCurrent: () => boolean;
      close: () => void;
    }>;

const DISABLED_COORDINATOR = createDirectChatV2WriteCoordinator(DIRECT_CHAT_V2_WRITE_DISABLED);

const disabledRuntime = (
  status: 'inactive' | 'invalid' | 'unavailable',
  error?: string
): DirectChatV2Runtime => Object.freeze({
  enabled: false as const,
  status,
  ...(error ? { error } : {}),
  coordinator: DISABLED_COORDINATOR,
  history: null,
  session: null,
  isCurrent: () => false as const,
  close: () => {}
});

export const createDirectChatV2Runtime = ({
  cursorStore,
  deploymentConfig,
  getOwnerCapability,
  lifecycle,
  nonceRetirementFactory = createIndexedDbDirectChatV2NonceAttemptRetirer,
  ownerAddress,
  runOwnerTransactionFlow
}: {
  cursorStore?: DirectChatV2ReadCursorStore;
  deploymentConfig: DirectChatV2DeploymentConfig;
  getOwnerCapability: DirectChatV2OwnerCapabilityGetter;
  lifecycle: DirectChatV2WriteLifecycle;
  nonceRetirementFactory?: () => NonceRetirement;
  ownerAddress: string;
  runOwnerTransactionFlow: DirectChatV2TransactionFlow;
}): DirectChatV2Runtime => {
  if (deploymentConfig.status === 'inactive') return disabledRuntime('inactive');
  if (deploymentConfig.status === 'invalid') {
    return disabledRuntime('invalid', deploymentConfig.error);
  }

  let normalizedOwner: string;
  try {
    normalizedOwner = getAddress(ownerAddress.trim());
  } catch {
    return disabledRuntime('unavailable', 'Direct Chat V2 requires the selected owner wallet.');
  }

  let nonceRetirement: NonceRetirement;
  try {
    nonceRetirement = nonceRetirementFactory();
  } catch {
    return disabledRuntime(
      'unavailable',
      'Direct Chat V2 secure nonce storage is unavailable in this browser.'
    );
  }

  let current = true;
  let closed = false;
  const capabilityCache = createCachedDirectChatV2OwnerCapabilityGetter({
    getOwnerCapability
  });
  try {
    const session = createDirectChatV2Session({
      getOwnerCapability: capabilityCache.get,
      invalidateOwnerCapabilities: capabilityCache.invalidate,
      manifest: deploymentConfig.manifest,
      ownerAddress: normalizedOwner,
      retireNonceAttempt: nonceRetirement.retire,
      runOwnerTransactionFlow
    });
    const coordinator = createDirectChatV2WriteCoordinator({
      enabled: true,
      mode: 'metamask-owner',
      ownerAddress: normalizedOwner,
      session,
      lifecycle
    });
    const history = createDirectChatV2HistoryRuntime({
      confirmationDepth: deploymentConfig.finalityLagBlocks,
      cursorStore,
      isCurrent: () => current,
      ownerAddress: normalizedOwner,
      session
    });
    const close = () => {
      if (closed) return;
      closed = true;
      current = false;
      history.close();
      session.clearEpochKeys();
      capabilityCache.close();
      nonceRetirement.close();
    };
    return Object.freeze({
      enabled: true as const,
      status: 'active' as const,
      coordinator,
      history,
      session,
      isCurrent: () => current,
      close
    });
  } catch {
    current = false;
    cursorStore?.close();
    capabilityCache.close();
    nonceRetirement.close();
    return disabledRuntime('unavailable', 'Direct Chat V2 runtime initialization failed closed.');
  }
};
