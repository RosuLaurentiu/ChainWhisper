import { CHAINWHISPER_TESTNET_CANDIDATE_CONFIG } from './chainWhisperTestnetCandidate';

export type TestnetQaArea = 'Wallet' | 'Chat' | 'Trading' | 'Integration' | 'Recovery';

export type TestnetQaJourney = Readonly<{
  id: string;
  area: TestnetQaArea;
  title: string;
  description: string;
  path: string;
}>;

export const CHAINWHISPER_TESTNET_QA_JOURNEYS: readonly TestnetQaJourney[] = Object.freeze([
  {
    id: 'wallet-desktop',
    area: 'Wallet',
    title: 'Desktop wallet and privacy',
    description: 'Connect MetaMask or CipherTrade, unlock privacy, reload, and confirm the same owner stays selected without duplicate prompts, disconnects, or an RPC request storm.',
    path: '/chat'
  },
  {
    id: 'walletconnect-mobile',
    area: 'Wallet',
    title: 'CipherTrade Mobile',
    description: 'Connect through WalletConnect, unlock privacy for the session, reconnect, and complete one safe action.',
    path: '/chat'
  },
  {
    id: 'direct-chat',
    area: 'Chat',
    title: 'Direct Chat V2',
    description: 'Create and reopen a conversation, send both directions, reply by stable message ID, rekey, save a contact name, hide it, and verify automatic history plus unread state after reload.',
    path: '/chat'
  },
  {
    id: 'group-chat',
    area: 'Chat',
    title: 'Group Chat V2',
    description: 'Verify no private group sync before unlock; then create, invite, accept, message, rekey, remove, rejoin, and verify old-history and rejoin-gap rules.',
    path: '/chat'
  },
  {
    id: 'reactions',
    area: 'Chat',
    title: 'Direct and group reactions',
    description: 'Add and remove an emoji in a direct chat and a group, then reload and verify the canonical state.',
    path: '/chat'
  },
  {
    id: 'public-orders',
    area: 'Trading',
    title: 'Public and recurring orders',
    description: 'Create, partially fill, edit or refill recurring liquidity, close, and verify exact per-fill and aggregate history.',
    path: '/otc'
  },
  {
    id: 'direct-trades',
    area: 'Trading',
    title: 'Direct trades and counters',
    description: 'Unlock privacy and verify exact price/amounts reveal automatically; open one fixed full-fill offer, counter and accept it, and confirm only incoming direct/counter openings notify.',
    path: '/otc/orders'
  },
  {
    id: 'trade-history',
    area: 'Trading',
    title: 'Exact trade history',
    description: 'For public, Direct, private, recurring, and pool fills, verify every per-fill sold/bought amount, unused input or refund, status transition, and aggregate order total after reload.',
    path: '/otc/orders'
  },
  {
    id: 'private-orders',
    area: 'Trading',
    title: 'Private and private recurring orders',
    description: 'Create, partially fill, reveal owner/filler receipts, edit liquidity, close, and verify hidden public views.',
    path: '/otc'
  },
  {
    id: 'position-nfts',
    area: 'Trading',
    title: 'Private-liquidity Position NFTs',
    description: 'Create multiple positions, fill all eligible positions, add/remove liquidity, transfer/reactivate, pause, and close.',
    path: '/dex/desk'
  },
  {
    id: 'private-swaps',
    area: 'Trading',
    title: 'Private-liquidity swaps',
    description: 'Review the quote and slippage limit, test partial spend/refund behavior, and verify exact received amounts in history.',
    path: '/dex'
  },
  {
    id: 'hidden-intents',
    area: 'Trading',
    title: 'Hidden intents',
    description: 'Create, partially and fully settle, cancel or expire, recover refunds, and verify private owner receipts.',
    path: '/dex/desk/intents'
  },
  {
    id: 'daily-price-demo',
    area: 'Trading',
    title: 'Daily price chart preview',
    description: 'Verify the chart is clearly labeled Illustrative demo, shows deterministic daily gaps and responsive ranges, carries no on-chain provenance, and never changes a swap quote or transaction.',
    path: '/dex/desk'
  },
  {
    id: 'daily-price-live',
    area: 'Integration',
    title: 'Verified daily price replacement',
    description: 'After the analytics manifest is active, verify an empty canonical history is not replaced with invented live data, then confirm the first stored UTC close automatically replaces the preview with exact store and source provenance.',
    path: '/dex/desk'
  },
  {
    id: 'public-api',
    area: 'Integration',
    title: 'Public API candidate reads',
    description: 'Verify status, capabilities, public orders/reference quotes, and the testnet private-liquidity pair against the exact manifest while private depth, amounts, intents, and credentials remain absent.',
    path: '/dex/desk'
  },
  {
    id: 'mcp-agent',
    area: 'Integration',
    title: 'MCP planner and Agent Wallet',
    description: 'Start from the reviewed catalog hash, attest the same candidate, exercise keyless reads/planning, and complete one explicitly confirmed testnet action without giving the agent browser-wallet authority.',
    path: '/otc/agent'
  },
  {
    id: 'wallet-recovery',
    area: 'Recovery',
    title: 'Wallet and RPC interruption recovery',
    description: 'Reject, reprice, reload, and recover after an RPC or extension interruption without duplicating a transaction.',
    path: '/chat'
  }
]);

const QA_SCHEMA_VERSION = 1;
const QA_STORAGE_PREFIX = 'chainwhisper:testnet-qa:v1:';
const JOURNEY_IDS = new Set(CHAINWHISPER_TESTNET_QA_JOURNEYS.map(({ id }) => id));

export type TestnetQaProgress = Readonly<{
  manifestHash: string;
  completed: readonly string[];
}>;

type QaStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

const emptyProgress = (manifestHash: string): TestnetQaProgress => Object.freeze({
  manifestHash,
  completed: Object.freeze([])
});

export const getActiveTestnetQaManifestHash = (): string | null =>
  CHAINWHISPER_TESTNET_CANDIDATE_CONFIG.status === 'active'
    ? CHAINWHISPER_TESTNET_CANDIDATE_CONFIG.manifestHash
    : null;

export const buildTestnetQaStorageKey = (manifestHash: string): string =>
  `${QA_STORAGE_PREFIX}${manifestHash.toLowerCase()}`;

export const parseTestnetQaProgress = (text: string | null, manifestHash: string): TestnetQaProgress => {
  if (!text) return emptyProgress(manifestHash);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyProgress(manifestHash);
    const record = parsed as Record<string, unknown>;
    if (
      record.schemaVersion !== QA_SCHEMA_VERSION ||
      typeof record.manifestHash !== 'string' ||
      record.manifestHash.toLowerCase() !== manifestHash.toLowerCase() ||
      !Array.isArray(record.completed)
    ) {
      return emptyProgress(manifestHash);
    }
    const completed = [...new Set(record.completed.filter(
      (id): id is string => typeof id === 'string' && JOURNEY_IDS.has(id)
    ))];
    return Object.freeze({ manifestHash, completed: Object.freeze(completed) });
  } catch {
    return emptyProgress(manifestHash);
  }
};

export const readTestnetQaProgress = (
  storage: QaStorage,
  manifestHash: string
): TestnetQaProgress => parseTestnetQaProgress(storage.getItem(buildTestnetQaStorageKey(manifestHash)), manifestHash);

export const writeTestnetQaProgress = (
  storage: QaStorage,
  progress: TestnetQaProgress
): void => {
  const completed = CHAINWHISPER_TESTNET_QA_JOURNEYS
    .map(({ id }) => id)
    .filter((id) => progress.completed.includes(id));
  storage.setItem(buildTestnetQaStorageKey(progress.manifestHash), JSON.stringify({
    schemaVersion: QA_SCHEMA_VERSION,
    manifestHash: progress.manifestHash.toLowerCase(),
    completed
  }));
};

export const toggleTestnetQaJourney = (
  progress: TestnetQaProgress,
  journeyId: string,
  complete: boolean
): TestnetQaProgress => {
  if (!JOURNEY_IDS.has(journeyId)) return progress;
  const completed = new Set(progress.completed);
  if (complete) completed.add(journeyId);
  else completed.delete(journeyId);
  return Object.freeze({
    manifestHash: progress.manifestHash,
    completed: Object.freeze(CHAINWHISPER_TESTNET_QA_JOURNEYS
      .map(({ id }) => id)
      .filter((id) => completed.has(id)))
  });
};

export const clearTestnetQaProgress = (storage: QaStorage, manifestHash: string): void => {
  storage.removeItem(buildTestnetQaStorageKey(manifestHash));
};
