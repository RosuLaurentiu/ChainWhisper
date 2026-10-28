import { getAddress } from '@coti-io/coti-ethers';
import type {
  DirectChatV2NonceAttempt,
  DirectChatV2NonceAttemptRetirer
} from './directChatV2Chain';

export const DIRECT_CHAT_V2_NONCE_RETIREMENT_SCHEMA =
  'chainwhisper-direct-chat-v2-nonce-attempt-v1' as const;
export const DIRECT_CHAT_V2_NONCE_RETIREMENT_DATABASE =
  'chainwhisper-chat-v2-security-v1' as const;
export const DIRECT_CHAT_V2_NONCE_RETIREMENT_STORE = 'nonce-attempts' as const;

const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const BYTES12_PATTERN = /^0x[0-9a-fA-F]{24}$/;

export type DirectChatV2NonceAttemptRecord = {
  schema: typeof DIRECT_CHAT_V2_NONCE_RETIREMENT_SCHEMA;
  key: string;
  chainId: string;
  contractAddress: string;
  conversationId: string;
  epoch: string;
  ownerAddress: string;
  nonce: string;
};

export type DirectChatV2NonceAttemptClaimStore = {
  claim: (record: DirectChatV2NonceAttemptRecord) => Promise<'claimed' | 'duplicate'>;
  close?: () => void;
};

const normalizeInteger = (
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

const normalizeHex = (value: string, pattern: RegExp, label: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!pattern.test(normalized)) {
    throw new Error(`${label} has an invalid byte length.`);
  }
  return normalized;
};

export const buildDirectChatV2NonceAttemptRecord = (
  attempt: Readonly<DirectChatV2NonceAttempt>
): DirectChatV2NonceAttemptRecord => {
  const chainId = normalizeInteger(attempt.chainId, 'Nonce-attempt chain ID', UINT256_MAX, false);
  const epoch = normalizeInteger(attempt.epoch, 'Nonce-attempt epoch', UINT64_MAX, false);
  const contractAddress = getAddress(attempt.contractAddress.trim());
  const ownerAddress = getAddress(attempt.ownerAddress.trim());
  const conversationId = normalizeHex(
    attempt.conversationId,
    BYTES32_PATTERN,
    'Nonce-attempt conversation ID'
  );
  const nonce = normalizeHex(attempt.nonce, BYTES12_PATTERN, 'Nonce attempt');
  if (nonce === `0x${'00'.repeat(12)}`) {
    throw new Error('Nonce attempt cannot be zero.');
  }
  const key = [
    DIRECT_CHAT_V2_NONCE_RETIREMENT_SCHEMA,
    chainId.toString(),
    contractAddress.toLowerCase(),
    conversationId,
    epoch.toString(),
    nonce
  ].join(':');
  return Object.freeze({
    schema: DIRECT_CHAT_V2_NONCE_RETIREMENT_SCHEMA,
    key,
    chainId: chainId.toString(),
    contractAddress,
    conversationId,
    epoch: epoch.toString(),
    ownerAddress,
    nonce
  });
};

export const createDirectChatV2NonceAttemptRetirer = (
  store: DirectChatV2NonceAttemptClaimStore
): DirectChatV2NonceAttemptRetirer => async (attempt) => {
  const record = buildDirectChatV2NonceAttemptRecord(attempt);
  const result = await store.claim(record);
  if (result !== 'claimed') {
    throw new Error('This direct-chat encryption nonce was already retired; nothing was sent.');
  }
};

const openNonceRetirementDatabase = (
  factory: IDBFactory,
  databaseName: string
): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = factory.open(databaseName, 1);
  let blocked = false;
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(DIRECT_CHAT_V2_NONCE_RETIREMENT_STORE)) {
      database.createObjectStore(DIRECT_CHAT_V2_NONCE_RETIREMENT_STORE, { keyPath: 'key' });
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
  request.onerror = () => reject(new Error('Chat V2 could not open its nonce-retirement database.'));
  request.onblocked = () => {
    blocked = true;
    reject(new Error('Chat V2 nonce-retirement storage is blocked by another tab.'));
  };
});

const claimIndexedDbRecord = (
  database: IDBDatabase,
  record: DirectChatV2NonceAttemptRecord
): Promise<'claimed' | 'duplicate'> => new Promise((resolve, reject) => {
  const transaction = database.transaction(DIRECT_CHAT_V2_NONCE_RETIREMENT_STORE, 'readwrite');
  const request = transaction.objectStore(DIRECT_CHAT_V2_NONCE_RETIREMENT_STORE).add(record);
  let duplicate = false;
  request.onerror = (event) => {
    if (request.error?.name === 'ConstraintError') {
      duplicate = true;
      event.preventDefault();
      event.stopPropagation();
    }
  };
  transaction.oncomplete = () => resolve(duplicate ? 'duplicate' : 'claimed');
  transaction.onerror = () => reject(new Error('Chat V2 could not retire its encryption nonce.'));
  transaction.onabort = () => reject(new Error('Chat V2 nonce retirement was not committed.'));
});

export const createIndexedDbDirectChatV2NonceAttemptClaimStore = ({
  factory,
  databaseName = DIRECT_CHAT_V2_NONCE_RETIREMENT_DATABASE
}: {
  factory?: IDBFactory;
  databaseName?: string;
} = {}): DirectChatV2NonceAttemptClaimStore => {
  const selectedFactory = factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
  if (!selectedFactory) {
    throw new Error('IndexedDB is required to retire direct-chat encryption nonces safely.');
  }
  const normalizedDatabaseName = databaseName.trim();
  if (!normalizedDatabaseName) {
    throw new Error('Chat V2 nonce-retirement database name is required.');
  }
  let databasePromise: Promise<IDBDatabase> | null = null;
  const getDatabase = (): Promise<IDBDatabase> => {
    if (!databasePromise) {
      databasePromise = openNonceRetirementDatabase(selectedFactory, normalizedDatabaseName).catch((error) => {
        databasePromise = null;
        throw error;
      });
    }
    return databasePromise;
  };
  return Object.freeze({
    claim: async (record: DirectChatV2NonceAttemptRecord) => {
      const database = await getDatabase();
      return claimIndexedDbRecord(database, record);
    },
    close: () => {
      const active = databasePromise;
      databasePromise = null;
      active?.then((database) => database.close()).catch(() => {});
    }
  });
};

export const createIndexedDbDirectChatV2NonceAttemptRetirer = (
  options?: Parameters<typeof createIndexedDbDirectChatV2NonceAttemptClaimStore>[0]
): { retire: DirectChatV2NonceAttemptRetirer; close: () => void } => {
  const store = createIndexedDbDirectChatV2NonceAttemptClaimStore(options);
  return Object.freeze({
    retire: createDirectChatV2NonceAttemptRetirer(store),
    close: () => store.close?.()
  });
};
