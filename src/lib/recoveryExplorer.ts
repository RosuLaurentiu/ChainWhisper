import {
  COTI_NETWORK,
  CW_PROFILE_REGISTRY_CONTRACT_ADDRESS,
  isWalletAddress
} from './appShared';

const RECOVERY_ADD_PROFILE_SELECTOR = '0xe43260fc';
const RECOVERY_SET_PROFILE_SELECTOR = '0xab479c7a';
const TRANSACTION_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const MAX_EXPLORER_PAGES = 50;

type BlockscoutAddress = {
  hash?: unknown;
};

export type RecoveryExplorerTransaction = {
  block_number?: unknown;
  from?: BlockscoutAddress | null;
  hash?: unknown;
  index?: unknown;
  position?: unknown;
  raw_input?: unknown;
  status?: unknown;
  to?: BlockscoutAddress | null;
};

type RecoveryExplorerPage = {
  items?: unknown;
  next_page_params?: unknown;
};

type RecoveryWrite = {
  blockNumber: number;
  hash: string;
  position: number;
  profileId?: number;
  type: 'add' | 'set';
};

const normalizeAddress = (value: unknown): string =>
  typeof value === 'string' && isWalletAddress(value) ? value.toLowerCase() : '';

const normalizeTransactionPosition = (transaction: RecoveryExplorerTransaction): number => {
  const rawPosition =
    typeof transaction.position === 'number'
      ? transaction.position
      : typeof transaction.index === 'number'
        ? transaction.index
        : 0;
  return Number.isSafeInteger(rawPosition) && rawPosition >= 0 ? rawPosition : 0;
};

const decodeSetProfileId = (rawInput: string): number | undefined => {
  const encodedProfileId = rawInput.slice(10, 74);
  if (!/^[a-fA-F0-9]{64}$/.test(encodedProfileId)) {
    return undefined;
  }

  const profileId = Number(BigInt(`0x${encodedProfileId}`));
  return Number.isSafeInteger(profileId) && profileId >= 0 ? profileId : undefined;
};

const normalizeRecoveryWrite = (
  transaction: RecoveryExplorerTransaction,
  ownerAddress: string
): RecoveryWrite | undefined => {
  const hash =
    typeof transaction.hash === 'string' && TRANSACTION_HASH_PATTERN.test(transaction.hash)
      ? transaction.hash
      : '';
  const rawInput = typeof transaction.raw_input === 'string' ? transaction.raw_input : '';
  const selector = rawInput.slice(0, 10).toLowerCase();
  const blockNumber =
    typeof transaction.block_number === 'number' &&
    Number.isSafeInteger(transaction.block_number) &&
    transaction.block_number >= 0
      ? transaction.block_number
      : -1;

  if (
    !hash ||
    blockNumber < 0 ||
    (transaction.status !== undefined && transaction.status !== 'ok') ||
    normalizeAddress(transaction.from?.hash) !== ownerAddress ||
    normalizeAddress(transaction.to?.hash) !== CW_PROFILE_REGISTRY_CONTRACT_ADDRESS.toLowerCase()
  ) {
    return undefined;
  }

  if (selector === RECOVERY_ADD_PROFILE_SELECTOR) {
    return {
      blockNumber,
      hash,
      position: normalizeTransactionPosition(transaction),
      type: 'add'
    };
  }

  if (selector === RECOVERY_SET_PROFILE_SELECTOR) {
    const profileId = decodeSetProfileId(rawInput);
    return profileId === undefined
      ? undefined
      : {
          blockNumber,
          hash,
          position: normalizeTransactionPosition(transaction),
          profileId,
          type: 'set'
        };
  }

  return undefined;
};

export const resolveRecoveryTransactionHash = ({
  ownerAddress,
  profileId,
  transactions
}: {
  ownerAddress: string;
  profileId: number;
  transactions: RecoveryExplorerTransaction[];
}): string | undefined => {
  const normalizedOwnerAddress = normalizeAddress(ownerAddress);
  if (
    !normalizedOwnerAddress ||
    !Number.isSafeInteger(profileId) ||
    profileId < 0
  ) {
    return undefined;
  }

  const writes = transactions
    .map((transaction) => normalizeRecoveryWrite(transaction, normalizedOwnerAddress))
    .filter((write): write is RecoveryWrite => Boolean(write))
    .sort(
      (left, right) =>
        left.blockNumber - right.blockNumber ||
        left.position - right.position
    );
  const creation = writes.filter((write) => write.type === 'add')[profileId];
  if (!creation) {
    return undefined;
  }

  const matchingUpdates = writes.filter(
    (write) => write.type === 'set' && write.profileId === profileId
  );
  return matchingUpdates.length > 0
    ? matchingUpdates[matchingUpdates.length - 1]?.hash
    : creation.hash;
};

const normalizeNextPageParams = (value: unknown): Record<string, string> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value).flatMap(([key, rawValue]) =>
    typeof rawValue === 'string' || typeof rawValue === 'number'
      ? [[key, String(rawValue)]]
      : []
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
};

export const findRecoveryTransactionHash = async ({
  ownerAddress,
  profileId,
  signal,
  fetchImpl = fetch
}: {
  ownerAddress: string;
  profileId: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<string | undefined> => {
  if (!isWalletAddress(ownerAddress) || !Number.isSafeInteger(profileId) || profileId < 0) {
    return undefined;
  }

  const transactions: RecoveryExplorerTransaction[] = [];
  let nextPageParams: Record<string, string> | null = null;

  for (let pageIndex = 0; pageIndex < MAX_EXPLORER_PAGES; pageIndex += 1) {
    const query = new URLSearchParams({ filter: 'to', ...(nextPageParams ?? {}) });
    const response = await fetchImpl(
      `${COTI_NETWORK.blockExplorerUrl}/api/v2/addresses/${CW_PROFILE_REGISTRY_CONTRACT_ADDRESS}/transactions?${query}`,
      {
        headers: { accept: 'application/json' },
        signal
      }
    );
    if (!response.ok) {
      return undefined;
    }

    const page = (await response.json()) as RecoveryExplorerPage;
    if (Array.isArray(page.items)) {
      transactions.push(...(page.items as RecoveryExplorerTransaction[]));
    }
    nextPageParams = normalizeNextPageParams(page.next_page_params);
    if (!nextPageParams) {
      break;
    }
  }

  return resolveRecoveryTransactionHash({
    ownerAddress,
    profileId,
    transactions
  });
};
