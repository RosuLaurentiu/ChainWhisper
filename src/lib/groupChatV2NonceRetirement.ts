import { getAddress } from '@coti-io/coti-ethers';
import type {
  GroupChatV2NonceAttempt,
  GroupChatV2NonceAttemptRetirer
} from './groupChatV2Chain';

export const GROUP_CHAT_V2_NONCE_RETIREMENT_SCHEMA =
  'chainwhisper-group-chat-v2-nonce-attempt-v1' as const;
export const GROUP_CHAT_V2_NONCE_RETIREMENT_DATABASE =
  'chainwhisper-group-chat-v2-security-v1' as const;
export const GROUP_CHAT_V2_NONCE_RETIREMENT_STORE = 'nonce-attempts' as const;

const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const BYTES12_PATTERN = /^0x[0-9a-fA-F]{24}$/;

export type GroupChatV2NonceAttemptRecord = {
  schema: typeof GROUP_CHAT_V2_NONCE_RETIREMENT_SCHEMA;
  key: string;
  purpose: GroupChatV2NonceAttempt['purpose'];
  chainId: string;
  contractAddress: string;
  groupId: string;
  epoch: string;
  ownerAddress: string;
  nonce: string;
};

export type GroupChatV2NonceAttemptClaimStore = {
  claim: (record: GroupChatV2NonceAttemptRecord) => Promise<'claimed' | 'duplicate'>;
  close?: () => void;
};

const integer = (
  value: bigint,
  label: string,
  maximum: bigint,
  allowZero: boolean
): bigint => {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} is not an integer.`);
  }
  if (parsed < 0n || parsed > maximum || (!allowZero && parsed === 0n)) {
    throw new Error(`${label} is out of range.`);
  }
  return parsed;
};

export const buildGroupChatV2NonceAttemptRecord = (
  attempt: Readonly<GroupChatV2NonceAttempt>
): GroupChatV2NonceAttemptRecord => {
  if (attempt.purpose !== 'message' && attempt.purpose !== 'metadata') {
    throw new Error('Group nonce purpose is invalid.');
  }
  const chainId = integer(attempt.chainId, 'Group nonce chain ID', UINT256_MAX, false);
  const groupId = integer(attempt.groupId, 'Group nonce group ID', UINT256_MAX, false);
  const epoch = integer(attempt.epoch, 'Group nonce epoch', UINT64_MAX, false);
  const contractAddress = getAddress(attempt.contractAddress.trim());
  const ownerAddress = getAddress(attempt.ownerAddress.trim());
  const nonce = attempt.nonce.trim().toLowerCase();
  if (!BYTES12_PATTERN.test(nonce)) {
    throw new Error('Group nonce attempt has an invalid byte length.');
  }
  if (nonce === `0x${'00'.repeat(12)}`) {
    throw new Error('Group nonce attempt cannot be zero.');
  }
  const key = [
    GROUP_CHAT_V2_NONCE_RETIREMENT_SCHEMA,
    attempt.purpose,
    chainId.toString(),
    contractAddress.toLowerCase(),
    groupId.toString(),
    epoch.toString(),
    nonce
  ].join(':');
  return Object.freeze({
    schema: GROUP_CHAT_V2_NONCE_RETIREMENT_SCHEMA,
    key,
    purpose: attempt.purpose,
    chainId: chainId.toString(),
    contractAddress,
    groupId: groupId.toString(),
    epoch: epoch.toString(),
    ownerAddress,
    nonce
  });
};

export const createGroupChatV2NonceAttemptRetirer = (
  store: GroupChatV2NonceAttemptClaimStore
): GroupChatV2NonceAttemptRetirer => async (attempt) => {
  const result = await store.claim(buildGroupChatV2NonceAttemptRecord(attempt));
  if (result !== 'claimed') {
    throw new Error('This group-chat encryption nonce was already retired; nothing was sent.');
  }
};

const openDatabase = (factory: IDBFactory, databaseName: string): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = factory.open(databaseName, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(GROUP_CHAT_V2_NONCE_RETIREMENT_STORE)) {
        request.result.createObjectStore(GROUP_CHAT_V2_NONCE_RETIREMENT_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(new Error('Group Chat V2 could not open nonce-retirement storage.'));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Group Chat V2 nonce-retirement storage is blocked by another tab.'));
    };
  });

const claimRecord = (
  database: IDBDatabase,
  record: GroupChatV2NonceAttemptRecord
): Promise<'claimed' | 'duplicate'> => new Promise((resolve, reject) => {
  const dbTransaction = database.transaction(GROUP_CHAT_V2_NONCE_RETIREMENT_STORE, 'readwrite');
  const request = dbTransaction.objectStore(GROUP_CHAT_V2_NONCE_RETIREMENT_STORE).add(record);
  let duplicate = false;
  request.onerror = (event) => {
    if (request.error?.name === 'ConstraintError') {
      duplicate = true;
      event.preventDefault();
      event.stopPropagation();
    }
  };
  dbTransaction.oncomplete = () => resolve(duplicate ? 'duplicate' : 'claimed');
  dbTransaction.onerror = () => reject(new Error('Group Chat V2 could not retire its nonce.'));
  dbTransaction.onabort = () => reject(new Error('Group Chat V2 nonce retirement was not committed.'));
});

export const createIndexedDbGroupChatV2NonceAttemptClaimStore = ({
  factory,
  databaseName = GROUP_CHAT_V2_NONCE_RETIREMENT_DATABASE
}: {
  factory?: IDBFactory;
  databaseName?: string;
} = {}): GroupChatV2NonceAttemptClaimStore => {
  const selectedFactory = factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
  if (!selectedFactory) {
    throw new Error('IndexedDB is required to retire group-chat encryption nonces safely.');
  }
  const name = databaseName.trim();
  if (!name) throw new Error('Group Chat V2 nonce-retirement database name is required.');
  let databasePromise: Promise<IDBDatabase> | null = null;
  const database = (): Promise<IDBDatabase> => {
    if (!databasePromise) {
      databasePromise = openDatabase(selectedFactory, name).catch((error) => {
        databasePromise = null;
        throw error;
      });
    }
    return databasePromise;
  };
  return Object.freeze({
    claim: async (record) => claimRecord(await database(), record),
    close: () => {
      const active = databasePromise;
      databasePromise = null;
      active?.then((value) => value.close()).catch(() => {});
    }
  });
};

export const createIndexedDbGroupChatV2NonceAttemptRetirer = (
  options?: Parameters<typeof createIndexedDbGroupChatV2NonceAttemptClaimStore>[0]
): { retire: GroupChatV2NonceAttemptRetirer; close: () => void } => {
  const store = createIndexedDbGroupChatV2NonceAttemptClaimStore(options);
  return Object.freeze({
    retire: createGroupChatV2NonceAttemptRetirer(store),
    close: () => store.close?.()
  });
};
