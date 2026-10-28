import { getAddress } from '@coti-io/coti-ethers';
import type { DirectTradeV2ChatEntry } from '../../lib/directTradeV2ChatProjection';

const SCHEMA = 1;
const MAX_ITEMS = 100;

export type DirectTradeNotificationScope = Readonly<{
  chainId: string;
  contractAddress: string;
  ownerAddress: string;
  supportedContracts?: readonly string[];
}>;

export type DirectTradeNotificationItem = Readonly<{
  id: string;
  kind: 'direct' | 'counter';
  contactAddress: string;
  tradeId: string;
  contractAddress?: string;
  parentTradeId: string;
  createdAt: number;
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  read: boolean;
}>;

type StoredNotifications = Readonly<{
  schema: 1;
  items: readonly DirectTradeNotificationItem[];
}>;

const canonicalDecimal = (value: unknown): value is string =>
  typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
const safeDecimal = (value: unknown): value is string =>
  canonicalDecimal(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER);
const canonicalHash = (value: unknown): value is string =>
  typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);

export const buildDirectTradeNotificationStorageKey = (
  scope: DirectTradeNotificationScope
): string => [
  'chainwhisper',
  'direct-trade-notifications-v1',
  scope.chainId,
  getAddress(scope.contractAddress).toLowerCase(),
  getAddress(scope.ownerAddress).toLowerCase()
].join(':');

const parseItem = (value: unknown): DirectTradeNotificationItem | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string' || !item.id.startsWith('direct-trade-v2:') ||
    (item.kind !== 'direct' && item.kind !== 'counter') ||
    typeof item.contactAddress !== 'string' ||
    !safeDecimal(item.tradeId) || !safeDecimal(item.parentTradeId) ||
    typeof item.createdAt !== 'number' || !Number.isSafeInteger(item.createdAt) || item.createdAt < 0 ||
    !safeDecimal(item.blockNumber) || !canonicalHash(item.blockHash) ||
    !canonicalHash(item.transactionHash) || typeof item.read !== 'boolean'
  ) return undefined;
  try {
    const contactAddress = getAddress(item.contactAddress).toLowerCase();
    const contractAddress = item.contractAddress === undefined ? undefined : getAddress(String(item.contractAddress)).toLowerCase();
    if ((item.kind === 'direct') !== (item.parentTradeId === '0')) return undefined;
    return Object.freeze({
      id: item.id,
      kind: item.kind,
      contactAddress,
      tradeId: item.tradeId,
      ...(contractAddress ? { contractAddress } : {}),
      parentTradeId: item.parentTradeId,
      createdAt: item.createdAt,
      blockNumber: item.blockNumber,
      blockHash: item.blockHash,
      transactionHash: item.transactionHash,
      read: item.read
    });
  } catch {
    return undefined;
  }
};

export const parseDirectTradeNotifications = (raw: string | null): readonly DirectTradeNotificationItem[] => {
  if (!raw) return Object.freeze([]);
  try {
    const parsed = JSON.parse(raw) as Partial<StoredNotifications>;
    if (parsed.schema !== SCHEMA || !Array.isArray(parsed.items) || parsed.items.length > MAX_ITEMS) {
      return Object.freeze([]);
    }
    const items = parsed.items.map(parseItem);
    if (items.some((item) => item === undefined)) return Object.freeze([]);
    return Object.freeze(items as DirectTradeNotificationItem[]);
  } catch {
    return Object.freeze([]);
  }
};

export const serializeDirectTradeNotifications = (
  items: readonly DirectTradeNotificationItem[]
): string => JSON.stringify({ schema: SCHEMA, items: items.slice(0, MAX_ITEMS) });

const notificationFromOpening = (
  scope: DirectTradeNotificationScope,
  entry: DirectTradeV2ChatEntry
): DirectTradeNotificationItem | undefined => {
  const identity = entry.message.directTradeV2;
  if (
    entry.message.direction !== 'incoming' || identity?.eventKind !== 'opened' ||
    getAddress(entry.viewer).toLowerCase() !== getAddress(scope.ownerAddress).toLowerCase() ||
    identity.chainId !== scope.chainId ||
    !(scope.supportedContracts ?? [scope.contractAddress]).some(address => getAddress(address).toLowerCase() === identity.contractAddress)
  ) return undefined;
  const parentTradeId = identity.relatedTradeId;
  return Object.freeze({
    id: entry.message.id,
    kind: parentTradeId === '0' ? 'direct' : 'counter',
    contactAddress: getAddress(entry.contact).toLowerCase(),
    tradeId: identity.tradeId,
    contractAddress: identity.contractAddress,
    parentTradeId,
    createdAt: entry.message.timestamp ?? 0,
    blockNumber: identity.blockNumber,
    blockHash: identity.blockHash,
    transactionHash: identity.transactionHash,
    read: false
  });
};

export const reconcileDirectTradeNotifications = ({
  scope,
  previous,
  newOpenings,
  canonicalOpenings,
  canonicalComplete
}: {
  scope: DirectTradeNotificationScope;
  previous: readonly DirectTradeNotificationItem[];
  newOpenings: readonly DirectTradeV2ChatEntry[];
  canonicalOpenings: readonly DirectTradeV2ChatEntry[];
  canonicalComplete: boolean;
}): readonly DirectTradeNotificationItem[] => {
  const canonicalIds = new Set(canonicalOpenings.filter(entry => notificationFromOpening(scope, entry)).map((entry) => entry.message.id));
  const byId = new Map(previous
    .filter((item) => !canonicalComplete || canonicalIds.has(item.id))
    .map((item) => [item.id, item]));
  for (const opening of canonicalOpenings) {
    const canonical = notificationFromOpening(scope, opening);
    const stored = canonical ? byId.get(canonical.id) : undefined;
    if (canonical && stored) {
      byId.set(canonical.id, Object.freeze({ ...canonical, read: stored.read }));
    }
  }
  for (const opening of newOpenings) {
    const item = notificationFromOpening(scope, opening);
    if (item && !byId.has(item.id)) byId.set(item.id, item);
  }
  return Object.freeze([...byId.values()]
    .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
    .slice(0, MAX_ITEMS));
};

export const markDirectTradeNotificationsRead = (
  items: readonly DirectTradeNotificationItem[],
  id?: string
): readonly DirectTradeNotificationItem[] => Object.freeze(items.map((item) =>
  (!id || item.id === id) && !item.read ? Object.freeze({ ...item, read: true }) : item
));
