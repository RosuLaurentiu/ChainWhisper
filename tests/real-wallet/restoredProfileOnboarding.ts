import { recoverUserKey as sdkRecoverUserKey } from '@coti-io/coti-sdk-typescript';
import {
  getAddress,
  hexlify,
  Interface,
  keccak256,
  zeroPadValue
} from '@coti-io/coti-ethers';
import {
  COTI_SNAP_ID,
  COTI_TESTNET_CHAIN_ID,
  PINNED_COTI_SNAP_VERSION
} from './metamaskPolicy';

export const ACCOUNT_ONBOARD_ADDRESS = '0x536A67f0cc46513E7d27a370ed1aF9FDcC7A5095';
export const ACCOUNT_ONBOARD_SELECTOR = '0xafaea1bd';
export const ACCOUNT_ONBOARD_RUNTIME_BYTECODE_HASH =
  '0x10b300ac6fba3b03ab87fb4728ed1d7a033a1551c97abc81194aa4c889324718';
export const ACCOUNT_ONBOARD_GAS_LIMIT = 12_000_000n;
export const ACCOUNT_ONBOARD_GAS_HEX = '0xb71b00';
export const PINNED_COTI_SNAP_SET_AES_KEY_ORIGINS = [
  'https://metamask.coti.io',
  'https://dev.metamask.coti.io'
] as const;

const RSA_PUBLIC_KEY_BYTES = 294;
const RSA_ENCRYPTED_SHARE_BYTES = 256;
const PERSONAL_SIGNATURE_BYTES = 65;
const AES_KEY_BYTES = 16;
const TRANSACTION_KEYS = ['data', 'from', 'gas', 'to'] as const;
const TRANSACTION_KEYS_WITH_VALUE = [...TRANSACTION_KEYS, 'value'] as const;
const ONBOARD_ABI = [
  'function onboardAccount(bytes publicKey, bytes signedEK)',
  'event AccountOnboarded(address indexed _from, bytes userKey1, bytes userKey2)'
] as const;
const ONBOARD_INTERFACE = new Interface(ONBOARD_ABI);
const ONBOARD_EVENT = ONBOARD_INTERFACE.getEvent('AccountOnboarded');
const ONBOARD_EVENT_TOPIC = ONBOARD_EVENT?.topicHash.toLowerCase() ?? '';
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const PINNED_COTI_SNAP_SET_AES_KEY_ORIGIN_SET = new Set<string>(
  PINNED_COTI_SNAP_SET_AES_KEY_ORIGINS
);

export class RestoredProfileOnboardingPolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RestoredProfileOnboardingPolicyError';
    this.code = code;
  }

  toJSON(): { code: string; name: string } {
    return { code: this.code, name: this.name };
  }
}

function fail(code: string, message: string): never {
  throw new RestoredProfileOnboardingPolicyError(code, message);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const assertExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
  code: string
): void => {
  let actual: string[];
  try {
    actual = Object.keys(value).sort();
  } catch {
    fail(code, 'Blocked malformed restored-profile onboarding request.');
  }
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code, 'Blocked restored-profile onboarding request with an unexpected schema.');
  }
};

const normalizeAddress = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !ADDRESS_PATTERN.test(value)) {
    fail(code, 'Blocked restored-profile onboarding request with an invalid address.');
  }
  try {
    const normalized = getAddress(value).toLowerCase();
    if (/^0x0{40}$/.test(normalized)) {
      fail(code, 'Blocked restored-profile onboarding request with an invalid address.');
    }
    return normalized;
  } catch (error) {
    if (error instanceof RestoredProfileOnboardingPolicyError) throw error;
    fail(code, 'Blocked restored-profile onboarding request with an invalid address.');
  }
};

const normalizeHash = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !BYTES32_PATTERN.test(value)) {
    fail(code, 'Blocked restored-profile onboarding data with an invalid hash.');
  }
  return value.toLowerCase();
};

const normalizePositiveRpcQuantity = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !/^0x[1-9a-f][0-9a-f]*$/.test(value)) {
    fail(code, 'Blocked restored-profile onboarding data with a noncanonical quantity.');
  }
  return BigInt(value).toString();
};

const normalizeFixedBytes = (
  value: unknown,
  bytes: number,
  code: string,
  label: string
): string => {
  if (
    typeof value !== 'string' ||
    !new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)
  ) {
    fail(code, `Blocked restored-profile onboarding with malformed ${label}.`);
  }
  return value.toLowerCase();
};

const normalizeRsaPublicKey = (value: Uint8Array | string): string => {
  try {
    if (value instanceof Uint8Array) {
      if (value.byteLength !== RSA_PUBLIC_KEY_BYTES) {
        fail('RSA_PUBLIC_KEY_INVALID', 'Blocked restored-profile onboarding with an invalid RSA key.');
      }
      return hexlify(value).toLowerCase();
    }
    if (
      typeof value !== 'string' ||
      !new RegExp(`^0x[0-9a-fA-F]{${RSA_PUBLIC_KEY_BYTES * 2}}$`).test(value)
    ) {
      fail('RSA_PUBLIC_KEY_INVALID', 'Blocked restored-profile onboarding with an invalid RSA key.');
    }
    return value.toLowerCase();
  } catch (error) {
    if (error instanceof RestoredProfileOnboardingPolicyError) throw error;
    fail('RSA_PUBLIC_KEY_INVALID', 'Blocked restored-profile onboarding with an invalid RSA key.');
  }
};

const normalizePersonalSignature = (value: unknown): string => {
  const signature = normalizeFixedBytes(
    value,
    PERSONAL_SIGNATURE_BYTES,
    'PERSONAL_SIGNATURE_INVALID',
    'personal signature'
  );
  if (!signature.endsWith('1b') && !signature.endsWith('1c')) {
    fail('PERSONAL_SIGNATURE_INVALID', 'Blocked restored-profile onboarding with an invalid signature form.');
  }
  return signature;
};

export type RuntimeBytecodeAttestation = Readonly<{
  address: typeof ACCOUNT_ONBOARD_ADDRESS;
  runtimeBytecodeHash: typeof ACCOUNT_ONBOARD_RUNTIME_BYTECODE_HASH;
}>;

export const assertPinnedAccountOnboardRuntimeHash = (
  observedHash: unknown
): RuntimeBytecodeAttestation => {
  if (
    normalizeHash(observedHash, 'RUNTIME_HASH_INVALID') !==
    ACCOUNT_ONBOARD_RUNTIME_BYTECODE_HASH
  ) {
    fail('RUNTIME_HASH_MISMATCH', 'COTI AccountOnboard runtime does not match the reviewed bytecode.');
  }
  return Object.freeze({
    address: ACCOUNT_ONBOARD_ADDRESS,
    runtimeBytecodeHash: ACCOUNT_ONBOARD_RUNTIME_BYTECODE_HASH
  });
};

export const attestAccountOnboardRuntimeBytecode = (
  runtimeBytecode: unknown
): RuntimeBytecodeAttestation => {
  if (
    typeof runtimeBytecode !== 'string' ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(runtimeBytecode)
  ) {
    fail('RUNTIME_BYTECODE_INVALID', 'COTI AccountOnboard returned invalid runtime bytecode.');
  }
  let observedHash: string;
  try {
    observedHash = keccak256(runtimeBytecode);
  } catch {
    fail('RUNTIME_BYTECODE_INVALID', 'COTI AccountOnboard returned invalid runtime bytecode.');
  }
  return assertPinnedAccountOnboardRuntimeHash(observedHash);
};

export type PersonalSignAttestation = Readonly<{
  account: string;
  method: 'personal_sign';
  rsaPublicKeyBytes: typeof RSA_PUBLIC_KEY_BYTES;
}>;

/**
 * ethers v6 JsonRpcSigner.signMessage emits personal_sign as
 * [hexlify(messageBytes), signer.address.toLowerCase()]. This lane deliberately
 * accepts that one reviewed order only.
 */
export const validateOnboardingPersonalSignParams = (
  params: object | unknown[] | undefined,
  context: { expectedAccount: string; rsaPublicKey: Uint8Array | string }
): PersonalSignAttestation => {
  if (!Array.isArray(params) || params.length !== 2) {
    fail('PERSONAL_SIGN_SCHEMA', 'Blocked malformed COTI onboarding signature request.');
  }
  const expectedKey = normalizeRsaPublicKey(context.rsaPublicKey);
  const account = normalizeAddress(context.expectedAccount, 'PERSONAL_SIGN_ACCOUNT');
  if (params[0] !== expectedKey || params[1] !== account) {
    fail('PERSONAL_SIGN_BINDING', 'Blocked COTI onboarding signature request outside its in-memory binding.');
  }
  return Object.freeze({ account, method: 'personal_sign', rsaPublicKeyBytes: RSA_PUBLIC_KEY_BYTES });
};

export type AccountOnboardTransactionAttestation = Readonly<{
  account: string;
  gasLimit: '12000000';
  selector: typeof ACCOUNT_ONBOARD_SELECTOR;
  target: string;
}>;

export const validateAccountOnboardTransactionRequest = (
  params: object | unknown[] | undefined,
  context: {
    expectedAccount: string;
    personalSignature: string;
    rsaPublicKey: Uint8Array | string;
  }
): AccountOnboardTransactionAttestation => {
  try {
    if (!Array.isArray(params) || params.length !== 1 || !isRecord(params[0])) {
      fail('ONBOARD_TRANSACTION_SCHEMA', 'Blocked malformed COTI onboarding transaction request.');
    }
    const transaction = params[0];
    const hasExplicitValue = Object.prototype.hasOwnProperty.call(transaction, 'value');
    assertExactKeys(
      transaction,
      hasExplicitValue ? TRANSACTION_KEYS_WITH_VALUE : TRANSACTION_KEYS,
      'ONBOARD_TRANSACTION_SCHEMA'
    );
    const account = normalizeAddress(context.expectedAccount, 'ONBOARD_TRANSACTION_ACCOUNT');
    if (normalizeAddress(transaction.from, 'ONBOARD_TRANSACTION_ACCOUNT') !== account) {
      fail('ONBOARD_TRANSACTION_ACCOUNT', 'Blocked COTI onboarding transaction from an unexpected account.');
    }
    const target = normalizeAddress(transaction.to, 'ONBOARD_TRANSACTION_TARGET');
    if (target !== ACCOUNT_ONBOARD_ADDRESS.toLowerCase()) {
      fail('ONBOARD_TRANSACTION_TARGET', 'Blocked COTI onboarding transaction to an unexpected contract.');
    }
    // ethers v6 omits value for this nonpayable call. An explicitly supplied
    // zero is also safe, but it must use the canonical JSON-RPC quantity form.
    if (hasExplicitValue && transaction.value !== '0x0') {
      fail('ONBOARD_TRANSACTION_VALUE', 'Blocked noncanonical or nonzero COTI onboarding transaction value.');
    }
    if (transaction.gas !== ACCOUNT_ONBOARD_GAS_HEX) {
      fail('ONBOARD_TRANSACTION_GAS', 'Blocked COTI onboarding transaction outside the exact gas policy.');
    }

    const publicKey = normalizeRsaPublicKey(context.rsaPublicKey);
    const signature = normalizePersonalSignature(context.personalSignature);
    if (
      typeof transaction.data !== 'string' ||
      !/^0x(?:[0-9a-f]{2})+$/.test(transaction.data) ||
      transaction.data.slice(0, 10) !== ACCOUNT_ONBOARD_SELECTOR
    ) {
      fail('ONBOARD_CALLDATA_INVALID', 'Blocked COTI onboarding transaction with invalid calldata.');
    }
    const parsed = ONBOARD_INTERFACE.parseTransaction({ data: transaction.data });
    if (
      !parsed ||
      parsed.name !== 'onboardAccount' ||
      String(parsed.args[0]).toLowerCase() !== publicKey ||
      String(parsed.args[1]).toLowerCase() !== signature
    ) {
      fail('ONBOARD_CALLDATA_BINDING', 'Blocked COTI onboarding transaction outside its in-memory binding.');
    }
    const canonical = ONBOARD_INTERFACE.encodeFunctionData('onboardAccount', [publicKey, signature]);
    if (transaction.data !== canonical) {
      fail('ONBOARD_CALLDATA_CANONICAL', 'Blocked COTI onboarding transaction with noncanonical calldata.');
    }
    return Object.freeze({
      account,
      gasLimit: ACCOUNT_ONBOARD_GAS_LIMIT.toString() as '12000000',
      selector: ACCOUNT_ONBOARD_SELECTOR,
      target
    });
  } catch (error) {
    if (error instanceof RestoredProfileOnboardingPolicyError) throw error;
    fail('ONBOARD_TRANSACTION_INVALID', 'Blocked invalid COTI onboarding transaction request.');
  }
};

export type InMemoryCotiAesKey = Readonly<{
  byteLength: typeof AES_KEY_BYTES;
  destroy(): void;
  isDestroyed(): boolean;
  matches(candidate: unknown): boolean;
  toJSON(): Readonly<{ byteLength: typeof AES_KEY_BYTES; redacted: true }>;
  toString(): string;
  use<T>(consumer: (aesKey: string) => T): T;
}>;

const protectCotiAesKey = (value: unknown): InMemoryCotiAesKey => {
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value)) {
    fail('AES_KEY_INVALID', 'Recovered COTI AES key is not a canonical 16-byte value.');
  }
  const secretBytes = new Uint8Array(AES_KEY_BYTES);
  for (let index = 0; index < secretBytes.length; index += 1) {
    secretBytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  value = '';
  let destroyed = false;

  const assertLive = (): void => {
    if (destroyed) {
      fail('AES_KEY_DESTROYED', 'Recovered COTI AES key has already been destroyed.');
    }
  };

  const ephemeralHex = (): string =>
    Array.from(secretBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  const protectedKey: InMemoryCotiAesKey = {
    byteLength: AES_KEY_BYTES,
    destroy(): void {
      if (destroyed) return;
      secretBytes.fill(0);
      destroyed = true;
    },
    isDestroyed: () => destroyed,
    matches(candidate: unknown): boolean {
      if (destroyed) return false;
      if (typeof candidate !== 'string' || !/^[0-9a-f]{32}$/.test(candidate)) return false;
      let difference = 0;
      for (let index = 0; index < secretBytes.length; index += 1) {
        difference |=
          secretBytes[index] ^ Number.parseInt(candidate.slice(index * 2, index * 2 + 2), 16);
      }
      return difference === 0;
    },
    toJSON: () => Object.freeze({ byteLength: AES_KEY_BYTES, redacted: true as const }),
    toString: () => '[redacted COTI AES key]',
    use<T>(consumer: (aesKey: string) => T): T {
      assertLive();
      return consumer(ephemeralHex());
    }
  };
  return Object.freeze(protectedKey);
};

export type RecoverUserKey = (
  rsaPrivateKey: Uint8Array,
  encryptedKeyShare0: string,
  encryptedKeyShare1: string
) => string;

export type AccountOnboardRecovery = Readonly<{
  aesKey: InMemoryCotiAesKey;
  receipt: Readonly<{
    account: string;
    blockHash: string;
    blockNumber: string;
    contractAddress: string;
    transactionHash: string;
  }>;
}>;

const successStatus = (value: unknown): boolean => value === '0x1' || value === 1 || value === 1n;

export const recoverAesKeyFromAccountOnboardReceipt = (
  receiptInput: unknown,
  context: {
    expectedAccount: string;
    expectedTransactionHash: string;
    rsaPrivateKey: Uint8Array;
  },
  recoverUserKey: RecoverUserKey = sdkRecoverUserKey
): AccountOnboardRecovery => {
  try {
    if (!isRecord(receiptInput) || !successStatus(receiptInput.status)) {
      fail('ONBOARD_RECEIPT_STATUS', 'COTI onboarding receipt is missing a successful status.');
    }
    const account = normalizeAddress(context.expectedAccount, 'ONBOARD_RECEIPT_ACCOUNT');
    const expectedTransactionHash = normalizeHash(
      context.expectedTransactionHash,
      'ONBOARD_RECEIPT_TRANSACTION'
    );
    const transactionHash = normalizeHash(
      receiptInput.transactionHash,
      'ONBOARD_RECEIPT_TRANSACTION'
    );
    const blockHash = normalizeHash(receiptInput.blockHash, 'ONBOARD_RECEIPT_BLOCK');
    const blockNumber = normalizePositiveRpcQuantity(
      receiptInput.blockNumber,
      'ONBOARD_RECEIPT_BLOCK'
    );
    if (
      transactionHash !== expectedTransactionHash ||
      normalizeAddress(receiptInput.from, 'ONBOARD_RECEIPT_ACCOUNT') !== account ||
      normalizeAddress(receiptInput.to, 'ONBOARD_RECEIPT_CONTRACT') !==
        ACCOUNT_ONBOARD_ADDRESS.toLowerCase()
    ) {
      fail('ONBOARD_RECEIPT_PROVENANCE', 'COTI onboarding receipt provenance does not match the approved request.');
    }
    if (!Array.isArray(receiptInput.logs)) {
      fail('ONBOARD_RECEIPT_LOGS', 'COTI onboarding receipt does not contain a valid log collection.');
    }

    const expectedAccountTopic = zeroPadValue(account, 32).toLowerCase();
    let recoveredShares: { userKey1: string; userKey2: string } | null = null;
    for (const logInput of receiptInput.logs) {
      if (!isRecord(logInput)) continue;
      let logAddress: string;
      try {
        logAddress = normalizeAddress(logInput.address, 'ONBOARD_EVENT_ADDRESS');
      } catch {
        continue;
      }
      if (logAddress !== ACCOUNT_ONBOARD_ADDRESS.toLowerCase()) continue;
      if (
        !Array.isArray(logInput.topics) ||
        typeof logInput.topics[0] !== 'string' ||
        logInput.topics[0].toLowerCase() !== ONBOARD_EVENT_TOPIC
      ) {
        continue;
      }
      if (
        logInput.removed !== false ||
        normalizeHash(logInput.transactionHash, 'ONBOARD_EVENT_TRANSACTION') !== transactionHash ||
        normalizeHash(logInput.blockHash, 'ONBOARD_EVENT_BLOCK') !== blockHash ||
        normalizePositiveRpcQuantity(logInput.blockNumber, 'ONBOARD_EVENT_BLOCK') !== blockNumber ||
        logInput.topics.length !== 2 ||
        typeof logInput.topics[1] !== 'string' ||
        logInput.topics[1].toLowerCase() !== expectedAccountTopic
      ) {
        fail('ONBOARD_EVENT_PROVENANCE', 'COTI AccountOnboarded event provenance does not match the approved receipt.');
      }
      const topics = logInput.topics as string[];
      if (recoveredShares) {
        fail('ONBOARD_EVENT_DUPLICATE', 'COTI onboarding receipt contains duplicate matching events.');
      }
      if (typeof logInput.data !== 'string' || !/^0x(?:[0-9a-f]{2})+$/.test(logInput.data)) {
        fail('ONBOARD_EVENT_DATA', 'COTI AccountOnboarded event data is malformed.');
      }
      const parsed = ONBOARD_INTERFACE.parseLog({ data: logInput.data, topics });
      if (!parsed || parsed.name !== 'AccountOnboarded') {
        fail('ONBOARD_EVENT_DATA', 'COTI AccountOnboarded event data is malformed.');
      }
      const eventAccount = normalizeAddress(parsed.args[0], 'ONBOARD_EVENT_ACCOUNT');
      const userKey1 = normalizeFixedBytes(
        String(parsed.args[1]),
        RSA_ENCRYPTED_SHARE_BYTES,
        'ONBOARD_EVENT_SHARE',
        'encrypted key share'
      );
      const userKey2 = normalizeFixedBytes(
        String(parsed.args[2]),
        RSA_ENCRYPTED_SHARE_BYTES,
        'ONBOARD_EVENT_SHARE',
        'encrypted key share'
      );
      if (eventAccount !== account) {
        fail('ONBOARD_EVENT_ACCOUNT', 'COTI AccountOnboarded event is bound to an unexpected account.');
      }
      const canonical = ONBOARD_INTERFACE.encodeEventLog(ONBOARD_EVENT!, [account, userKey1, userKey2]);
      if (
        canonical.data !== logInput.data ||
        canonical.topics.length !== topics.length ||
        canonical.topics.some((topic, index) => topic !== topics[index])
      ) {
        fail('ONBOARD_EVENT_CANONICAL', 'COTI AccountOnboarded event encoding is noncanonical.');
      }
      recoveredShares = { userKey1, userKey2 };
    }
    if (!recoveredShares) {
      fail('ONBOARD_EVENT_MISSING', 'COTI onboarding receipt is missing the matching AccountOnboarded event.');
    }
    if (!(context.rsaPrivateKey instanceof Uint8Array) || context.rsaPrivateKey.byteLength === 0) {
      fail('RSA_PRIVATE_KEY_INVALID', 'COTI onboarding recovery key is unavailable in memory.');
    }

    let recovered: unknown;
    try {
      recovered = recoverUserKey(
        context.rsaPrivateKey,
        recoveredShares.userKey1.slice(2),
        recoveredShares.userKey2.slice(2)
      );
    } catch {
      fail('AES_RECOVERY_FAILED', 'COTI AES recovery failed closed.');
    }
    return Object.freeze({
      aesKey: protectCotiAesKey(recovered),
      receipt: Object.freeze({
        account,
        blockHash,
        blockNumber,
        contractAddress: ACCOUNT_ONBOARD_ADDRESS.toLowerCase(),
        transactionHash
      })
    });
  } catch (error) {
    if (error instanceof RestoredProfileOnboardingPolicyError) throw error;
    fail('ONBOARD_RECEIPT_INVALID', 'COTI onboarding receipt validation failed closed.');
  }
};

export type CotiSnapInstallAttestation = Readonly<{
  method: 'wallet_requestSnaps';
  snapId: typeof COTI_SNAP_ID;
  version: typeof PINNED_COTI_SNAP_VERSION;
}>;

export const validatePinnedCotiSnapInstallRequest = (
  requestInput: unknown
): CotiSnapInstallAttestation => {
  if (!isRecord(requestInput)) {
    fail('SNAP_INSTALL_SCHEMA', 'Blocked malformed COTI Snap installation request.');
  }
  assertExactKeys(requestInput, ['method', 'params'], 'SNAP_INSTALL_SCHEMA');
  if (requestInput.method !== 'wallet_requestSnaps' || !isRecord(requestInput.params)) {
    fail('SNAP_INSTALL_SCHEMA', 'Blocked malformed COTI Snap installation request.');
  }
  assertExactKeys(requestInput.params, [COTI_SNAP_ID], 'SNAP_INSTALL_SCHEMA');
  const snapOptions = requestInput.params[COTI_SNAP_ID];
  if (!isRecord(snapOptions)) {
    fail('SNAP_INSTALL_SCHEMA', 'Blocked malformed COTI Snap installation request.');
  }
  assertExactKeys(snapOptions, ['version'], 'SNAP_INSTALL_SCHEMA');
  if (snapOptions.version !== PINNED_COTI_SNAP_VERSION) {
    fail('SNAP_INSTALL_VERSION', 'Blocked COTI Snap installation outside the reviewed version pin.');
  }
  return Object.freeze({
    method: 'wallet_requestSnaps',
    snapId: COTI_SNAP_ID,
    version: PINNED_COTI_SNAP_VERSION
  });
};

export type CotiSnapSetAesKeyAttestation = Readonly<{
  chainId: typeof COTI_TESTNET_CHAIN_ID;
  method: 'wallet_invokeSnap';
  operation: 'set-aes-key';
  snapId: typeof COTI_SNAP_ID;
}>;

export type PinnedCotiSnapSetAesKeyOrigin =
  (typeof PINNED_COTI_SNAP_SET_AES_KEY_ORIGINS)[number];

/**
 * The exact pinned Snap bundle independently rejects set-aes-key from every
 * other dapp origin. Request-shape validation does not override that gate.
 */
export const assertPinnedCotiSnapSetAesKeyOrigin = (
  origin: unknown
): PinnedCotiSnapSetAesKeyOrigin => {
  if (typeof origin !== 'string' || !PINNED_COTI_SNAP_SET_AES_KEY_ORIGIN_SET.has(origin)) {
    fail('SNAP_SET_AES_ORIGIN', 'COTI Snap does not allow AES key storage from this origin.');
  }
  return origin as PinnedCotiSnapSetAesKeyOrigin;
};

export const validateCotiSnapSetAesKeyRequest = (
  requestInput: unknown,
  expectedAesKey: InMemoryCotiAesKey
): CotiSnapSetAesKeyAttestation => {
  if (!isRecord(requestInput)) {
    fail('SNAP_SET_AES_SCHEMA', 'Blocked malformed COTI Snap key-storage request.');
  }
  assertExactKeys(requestInput, ['method', 'params'], 'SNAP_SET_AES_SCHEMA');
  if (requestInput.method !== 'wallet_invokeSnap' || !isRecord(requestInput.params)) {
    fail('SNAP_SET_AES_SCHEMA', 'Blocked malformed COTI Snap key-storage request.');
  }
  assertExactKeys(requestInput.params, ['request', 'snapId'], 'SNAP_SET_AES_SCHEMA');
  if (requestInput.params.snapId !== COTI_SNAP_ID || !isRecord(requestInput.params.request)) {
    fail('SNAP_SET_AES_TARGET', 'Blocked key-storage request for an unexpected Snap.');
  }
  const invocation = requestInput.params.request;
  assertExactKeys(invocation, ['method', 'params'], 'SNAP_SET_AES_SCHEMA');
  if (invocation.method !== 'set-aes-key' || !isRecord(invocation.params)) {
    fail('SNAP_SET_AES_OPERATION', 'Blocked unapproved COTI Snap operation.');
  }
  assertExactKeys(invocation.params, ['chainId', 'newUserAesKey'], 'SNAP_SET_AES_SCHEMA');
  if (invocation.params.chainId !== COTI_TESTNET_CHAIN_ID) {
    fail('SNAP_SET_AES_CHAIN', 'Blocked COTI Snap key storage outside testnet.');
  }
  if (!expectedAesKey.matches(invocation.params.newUserAesKey)) {
    fail('SNAP_SET_AES_BINDING', 'Blocked COTI Snap key storage outside its in-memory AES binding.');
  }
  return Object.freeze({
    chainId: COTI_TESTNET_CHAIN_ID,
    method: 'wallet_invokeSnap',
    operation: 'set-aes-key',
    snapId: COTI_SNAP_ID
  });
};

if (
  ONBOARD_INTERFACE.getFunction('onboardAccount')?.selector.toLowerCase() !==
    ACCOUNT_ONBOARD_SELECTOR ||
  !ONBOARD_EVENT ||
  !ONBOARD_EVENT_TOPIC
) {
  throw new Error('Pinned COTI AccountOnboard ABI does not match its reviewed selectors.');
}
