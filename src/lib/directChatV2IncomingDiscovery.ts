import type {
  DirectChatV2CanonicalBlock,
  DirectChatV2MessageEvent
} from './directChatV2Chain';

const CHECKPOINT_SCHEMA = 'chainwhisper-direct-chat-v2-activity-discovery-v3';
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const MAX_PAGES_PER_SCAN = 4;
const MAX_PERSISTED_PEERS = 4_096;

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
  hasMore: boolean;
  reorged: boolean;
  scannedFromBlock?: bigint;
  scannedToBlock?: bigint;
}>;

type DirectChatV2IncomingDiscoveryCheckpoint = Readonly<{
  nextBlock: bigint;
  lastScannedBlock: bigint;
  lastScannedBlockHash: string;
  peers: readonly string[];
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
  peers: readonly string[];
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
      !Array.isArray(parsed.peers) ||
      parsed.peers.length > MAX_PERSISTED_PEERS
    ) {
      return null;
    }
    const peers = parsed.peers.map((peer) => normalizeAddress(
      peer,
      'Incoming discovery checkpoint peer'
    ));
    if (
      peers.includes(scope.ownerAddress) ||
      new Set(peers).size !== peers.length
    ) {
      return null;
    }
    return Object.freeze({
      nextBlock,
      lastScannedBlock,
      lastScannedBlockHash: normalizeHash(
        parsed.lastScannedBlockHash,
        'Incoming discovery checkpoint block hash'
      ),
      peers: Object.freeze(peers)
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
  if (checkpoint.peers.length > MAX_PERSISTED_PEERS) {
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
    peers: checkpoint.peers
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
      return Object.freeze({ peers: Object.freeze([]), hasMore: false, reorged: false });
    }

    let checkpoint = memoryCheckpoint ?? loadCheckpoint({ scope: normalizedScope, storage });
    let reorged = false;
    if (checkpoint) {
      const boundary = await dependencies.readCanonicalBlock(checkpoint.lastScannedBlock);
      assertCurrent(shouldContinue);
      if (!boundary || boundary.hash.toLowerCase() !== checkpoint.lastScannedBlockHash) {
        checkpoint = null;
        memoryCheckpoint = null;
        reorged = true;
        clearCheckpoint({ scope: normalizedScope, storage });
      }
    }

    let fromBlock = checkpoint?.nextBlock ?? normalizedScope.deploymentBlock;
    const firstScannedBlock = fromBlock;
    const peers = new Set<string>(checkpoint?.peers ?? []);
    let lastScannedBlock: bigint | undefined;
    for (let page = 0; page < MAX_PAGES_PER_SCAN && fromBlock <= safeHead; page += 1) {
      const toBlock = fromBlock + 2_047n < safeHead ? fromBlock + 2_047n : safeHead;
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
        peers.add(ownerIsSender ? recipient : sender);
      }
      checkpoint = Object.freeze({
        nextBlock: toBlock + 1n,
        lastScannedBlock: toBlock,
        lastScannedBlockHash: normalizeHash(after.hash, 'Incoming discovery page hash'),
        peers: Object.freeze([...peers])
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
      peers: Object.freeze([...peers]),
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
