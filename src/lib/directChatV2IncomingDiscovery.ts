import type {
  DirectChatV2CanonicalBlock,
  DirectChatV2ConversationPreview,
  DirectChatV2MessageEvent
} from './directChatV2Chain';
import { DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC } from './directChatV2Chain';
import type { CotiEventHintSubscriber, CotiEventHintStatus } from './appShared/cotiEventHints';

const CHECKPOINT_SCHEMA = 'chainwhisper-direct-chat-v2-recent-activity-v1';
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const RECENT_BLOCK_SPAN = 2_048n;
const MAX_PERSISTED_PEERS = 4_096;

/** Memory belongs to one runtime; canonical history still verifies changed anchors. */
export const rememberDirectChatV2Preview = (
  seen: Map<string, string>, preview: DirectChatV2ConversationPreview
): boolean => {
  const peer = preview.peer.toLowerCase();
  const anchor = [preview.conversationId, preview.currentEpoch, preview.messageCount,
    preview.createdBlock, preview.firstMessageBlock, preview.lastMessageBlock, preview.lastMessageAt].join(':');
  if (seen.get(peer) === anchor) return false;
  seen.set(peer, anchor);
  return true;
};

export type DirectChatV2IncomingDiscoveryScope = Readonly<{
  chainId: bigint;
  contractAddress: string;
  ownerAddress: string;
  deploymentBlock: bigint;
}>;

export type DirectChatV2IncomingDiscoveryDependencies = Readonly<{
  getLatestBlockNumber: () => Promise<bigint>;
  readCanonicalBlock: (blockNumber: bigint) => Promise<DirectChatV2CanonicalBlock | null>;
  readIncomingPage: (range: Readonly<{
    fromBlock: bigint;
    toBlock: bigint;
  }>) => Promise<DirectChatV2MessageEvent[]>;
}>;

export type DirectChatV2IncomingDiscoveryResult = Readonly<{
  peers: readonly string[];
  /** Peers with activity in this scan, including previously discovered peers. */
  changedPeers: readonly string[];
  /** Recent activity only; complete conversation discovery uses the participant index. */
  hasMore: boolean;
  reorged: boolean;
  scannedFromBlock?: bigint;
  scannedToBlock?: bigint;
}>;

type DirectChatV2IncomingDiscoveryCheckpoint = Readonly<{
  nextBlock: bigint;
  lastScannedBlock: bigint;
  lastScannedBlockHash: string;
  activityBlocks: Readonly<Record<string, string>>;
}>;

type SerializedCheckpoint = Readonly<{
  schema: typeof CHECKPOINT_SCHEMA;
  chainId: string;
  contractAddress: string;
  ownerAddress: string;
  deploymentBlock: string;
  nextBlock: string;
  lastScannedBlock: string;
  lastScannedBlockHash: string;
  activityBlocks: Readonly<Record<string, string>>;
}>;

export type DirectChatV2IncomingDiscoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const normalizeAddress = (value: string, label: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!ADDRESS_PATTERN.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
};

const normalizeHash = (value: string, label: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!BYTES32_PATTERN.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
};

const normalizeUint = (value: bigint, label: string): bigint => {
  if (value < 0n) throw new Error(`${label} is invalid.`);
  return value;
};

const parseUint = (value: unknown): bigint | null => {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

const normalizeScope = (
  scope: DirectChatV2IncomingDiscoveryScope
): DirectChatV2IncomingDiscoveryScope => Object.freeze({
  chainId: normalizeUint(scope.chainId, 'Incoming discovery chain ID'),
  contractAddress: normalizeAddress(scope.contractAddress, 'Incoming discovery contract'),
  ownerAddress: normalizeAddress(scope.ownerAddress, 'Incoming discovery owner'),
  deploymentBlock: normalizeUint(scope.deploymentBlock, 'Incoming discovery deployment block')
});

/** Observe only this owner's incoming events; canonical discovery still owns data. */
export const subscribeDirectChatV2DiscoveryHints = async ({ subscribe, scope, isCurrent, onHint, onStatus }: {
  subscribe: CotiEventHintSubscriber; scope: DirectChatV2IncomingDiscoveryScope; isCurrent: () => boolean;
  onHint: () => void; onStatus: (status: CotiEventHintStatus) => void;
}): Promise<() => void> => {
  if (!isCurrent()) return () => {};
  const target = normalizeScope(scope);
  let active = true;
  const current = () => active && isCurrent();
  const stop = await subscribe({ address: target.contractAddress,
    topics: [DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC, null, null, `0x${target.ownerAddress.slice(2).padStart(64, '0')}`],
    onHint: () => { if (current()) onHint(); }, onStatus: status => { if (current()) onStatus(status); }
  });
  if (!current()) { active = false; stop(); }
  return () => { if (!active) return; active = false; stop(); };
};

export const buildDirectChatV2IncomingDiscoveryStorageKey = (
  scope: DirectChatV2IncomingDiscoveryScope
): string => {
  const normalized = normalizeScope(scope);
  return [
    CHECKPOINT_SCHEMA,
    normalized.chainId,
    normalized.contractAddress,
    normalized.ownerAddress
  ].join(':');
};

const defaultStorage = (): DirectChatV2IncomingDiscoveryStorage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

const loadCheckpoint = ({
  scope,
  storage
}: {
  scope: DirectChatV2IncomingDiscoveryScope;
  storage: DirectChatV2IncomingDiscoveryStorage | null;
}): DirectChatV2IncomingDiscoveryCheckpoint | null => {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(buildDirectChatV2IncomingDiscoveryStorageKey(scope));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SerializedCheckpoint>;
    const nextBlock = parseUint(parsed.nextBlock);
    const lastScannedBlock = parseUint(parsed.lastScannedBlock);
    if (
      parsed.schema !== CHECKPOINT_SCHEMA ||
      parsed.chainId !== scope.chainId.toString() ||
      parsed.contractAddress !== scope.contractAddress ||
      parsed.ownerAddress !== scope.ownerAddress ||
      parsed.deploymentBlock !== scope.deploymentBlock.toString() ||
      nextBlock === null ||
      lastScannedBlock === null ||
      nextBlock !== lastScannedBlock + 1n ||
      lastScannedBlock < scope.deploymentBlock ||
      typeof parsed.lastScannedBlockHash !== 'string' ||
      !parsed.activityBlocks || typeof parsed.activityBlocks !== 'object' || Array.isArray(parsed.activityBlocks) ||
      Object.keys(parsed.activityBlocks).length > MAX_PERSISTED_PEERS
    ) {
      return null;
    }
    const activityBlocks: Record<string, string> = {};
    for (const [peer, block] of Object.entries(parsed.activityBlocks)) {
      const address = normalizeAddress(peer, 'Incoming discovery checkpoint peer');
      const blockNumber = parseUint(block);
      if (address !== peer || address === scope.ownerAddress || blockNumber === null ||
          blockNumber < scope.deploymentBlock || blockNumber > lastScannedBlock) return null;
      activityBlocks[address] = blockNumber.toString();
    }
    return Object.freeze({
      nextBlock,
      lastScannedBlock,
      lastScannedBlockHash: normalizeHash(
        parsed.lastScannedBlockHash,
        'Incoming discovery checkpoint block hash'
      ),
      activityBlocks: Object.freeze(activityBlocks)
    });
  } catch {
    return null;
  }
};

const saveCheckpoint = ({
  checkpoint,
  scope,
  storage
}: {
  checkpoint: DirectChatV2IncomingDiscoveryCheckpoint;
  scope: DirectChatV2IncomingDiscoveryScope;
  storage: DirectChatV2IncomingDiscoveryStorage | null;
}): void => {
  if (!storage) return;
  if (Object.keys(checkpoint.activityBlocks).length > MAX_PERSISTED_PEERS) {
    clearCheckpoint({ scope, storage });
    return;
  }
  const serialized: SerializedCheckpoint = {
    schema: CHECKPOINT_SCHEMA,
    chainId: scope.chainId.toString(),
    contractAddress: scope.contractAddress,
    ownerAddress: scope.ownerAddress,
    deploymentBlock: scope.deploymentBlock.toString(),
    nextBlock: checkpoint.nextBlock.toString(),
    lastScannedBlock: checkpoint.lastScannedBlock.toString(),
    lastScannedBlockHash: checkpoint.lastScannedBlockHash,
    activityBlocks: checkpoint.activityBlocks
  };
  try {
    storage.setItem(
      buildDirectChatV2IncomingDiscoveryStorageKey(scope),
      JSON.stringify(serialized)
    );
  } catch {
    // Discovery remains correct with a memory-only checkpoint; the next reload rescans.
  }
};

const clearCheckpoint = ({
  scope,
  storage
}: {
  scope: DirectChatV2IncomingDiscoveryScope;
  storage: DirectChatV2IncomingDiscoveryStorage | null;
}): void => {
  if (!storage) return;
  try {
    storage.removeItem(buildDirectChatV2IncomingDiscoveryStorageKey(scope));
  } catch {
    // A stale checkpoint is hash-validated before reuse and therefore cannot skip a reorg.
  }
};

export const createDirectChatV2IncomingDiscovery = ({
  confirmationDepth,
  dependencies,
  isCurrent,
  scope,
  storage = defaultStorage()
}: {
  confirmationDepth: bigint;
  dependencies: DirectChatV2IncomingDiscoveryDependencies;
  isCurrent: () => boolean;
  scope: DirectChatV2IncomingDiscoveryScope;
  storage?: DirectChatV2IncomingDiscoveryStorage | null;
}) => {
  const normalizedScope = normalizeScope(scope);
  if (confirmationDepth <= 0n || confirmationDepth > 4_096n) {
    throw new Error('Incoming discovery finality depth is invalid.');
  }
  if (typeof isCurrent !== 'function' || !isCurrent()) {
    throw new Error('Incoming discovery requires a current owner session.');
  }
  let closed = false;
  let tail: Promise<void> = Promise.resolve();
  let memoryCheckpoint: DirectChatV2IncomingDiscoveryCheckpoint | null = null;
  const current = (external?: () => boolean): boolean =>
    !closed && isCurrent() && (external ? external() : true);
  const assertCurrent = (external?: () => boolean): void => {
    if (!current(external)) throw new Error('Incoming discovery scope changed while scanning.');
  };

  const runScan = async (
    shouldContinue?: () => boolean
  ): Promise<DirectChatV2IncomingDiscoveryResult> => {
    assertCurrent(shouldContinue);
    const latestBlock = normalizeUint(
      await dependencies.getLatestBlockNumber(),
      'Incoming discovery latest block'
    );
    assertCurrent(shouldContinue);
    const safeHead = latestBlock >= confirmationDepth ? latestBlock - confirmationDepth : 0n;
    if (safeHead < normalizedScope.deploymentBlock) {
      memoryCheckpoint = null;
      clearCheckpoint({ scope: normalizedScope, storage });
      return Object.freeze({ peers: Object.freeze([]), changedPeers: Object.freeze([]), hasMore: false, reorged: false });
    }

    let checkpoint = memoryCheckpoint ?? loadCheckpoint({ scope: normalizedScope, storage });
    let reorged = false;
    if (checkpoint) {
      const boundary = await dependencies.readCanonicalBlock(checkpoint.lastScannedBlock);
      assertCurrent(shouldContinue);
      if (checkpoint.lastScannedBlock > safeHead || !boundary || boundary.hash.toLowerCase() !== checkpoint.lastScannedBlockHash) {
        checkpoint = null;
        memoryCheckpoint = null;
        reorged = true;
        clearCheckpoint({ scope: normalizedScope, storage });
      }
    }

    // Old conversations and messages remain reachable through their own indexed pages.
    const recentStart = safeHead >= RECENT_BLOCK_SPAN - 1n ? safeHead - RECENT_BLOCK_SPAN + 1n : 0n;
    const floor = recentStart > normalizedScope.deploymentBlock ? recentStart : normalizedScope.deploymentBlock;
    let fromBlock = checkpoint && checkpoint.nextBlock > floor ? checkpoint.nextBlock : floor;
    const firstScannedBlock = fromBlock;
    const activityBlocks = Object.fromEntries(Object.entries(checkpoint?.activityBlocks ?? {})
      .filter(([, block]) => BigInt(block) >= floor));
    const changedPeers = new Set<string>();
    let lastScannedBlock: bigint | undefined;
    if (fromBlock <= safeHead) {
      const toBlock = safeHead;
      const before = await dependencies.readCanonicalBlock(toBlock);
      assertCurrent(shouldContinue);
      if (!before) throw new Error('Incoming discovery page boundary is unavailable.');
      const events = await dependencies.readIncomingPage({ fromBlock, toBlock });
      assertCurrent(shouldContinue);
      const after = await dependencies.readCanonicalBlock(toBlock);
      assertCurrent(shouldContinue);
      if (!after || before.hash.toLowerCase() !== after.hash.toLowerCase()) {
        throw new Error('Incoming discovery page changed while it was being scanned.');
      }
      for (const event of events) {
        const sender = normalizeAddress(event.sender, 'Chat activity sender');
        const recipient = normalizeAddress(event.recipient, 'Chat activity recipient');
        const ownerIsSender = sender === normalizedScope.ownerAddress;
        const ownerIsRecipient = recipient === normalizedScope.ownerAddress;
        if (
          ownerIsSender === ownerIsRecipient ||
          event.blockNumber < fromBlock ||
          event.blockNumber > toBlock ||
          event.removed
        ) {
          throw new Error('Chat activity discovery received an invalid canonical message event.');
        }
        const peer = ownerIsSender ? recipient : sender;
        if (!activityBlocks[peer] || event.blockNumber > BigInt(activityBlocks[peer])) {
          activityBlocks[peer] = event.blockNumber.toString();
        }
        changedPeers.add(peer);
      }
      checkpoint = Object.freeze({
        nextBlock: toBlock + 1n,
        lastScannedBlock: toBlock,
        lastScannedBlockHash: normalizeHash(after.hash, 'Incoming discovery page hash'),
        activityBlocks: Object.freeze(activityBlocks)
      });
      lastScannedBlock = toBlock;
      fromBlock = toBlock + 1n;
    }

    assertCurrent(shouldContinue);
    if (checkpoint && lastScannedBlock !== undefined) {
      memoryCheckpoint = checkpoint;
      saveCheckpoint({ checkpoint, scope: normalizedScope, storage });
    }
    return Object.freeze({
      peers: Object.freeze(Object.keys(activityBlocks)),
      changedPeers: Object.freeze([...changedPeers]),
      hasMore: fromBlock <= safeHead,
      reorged,
      ...(lastScannedBlock === undefined
        ? {}
        : { scannedFromBlock: firstScannedBlock, scannedToBlock: lastScannedBlock })
    });
  };

  return Object.freeze({
    scan: (shouldContinue?: () => boolean) => {
      const pending = tail.then(
        () => runScan(shouldContinue),
        () => runScan(shouldContinue)
      );
      tail = pending.then(() => undefined, () => undefined);
      return pending;
    },
    close: () => {
      closed = true;
      memoryCheckpoint = null;
    }
  });
};
