import type { OnboardInfo } from '@coti-io/coti-ethers';
import {
  BURNER_OWNER_AES_WALLET_STORAGE_SCHEME,
  BURNER_OWNER_AES_WALLET_STORAGE_VERSION,
  BURNER_PIN_MIN_LENGTH,
  BURNER_PIN_PBKDF2_ITERATIONS,
  BURNER_WALLET_STORAGE_KEY,
  BURNER_WALLET_STORAGE_VERSION,
  BURNER_WALLET_VAULT_VERSION,
  type BurnerWalletRecord,
  type BurnerWalletStorageState,
  type BurnerWalletVault,
  type EncryptedBurnerWalletRecord,
  isBurnerStorageAvailable,
  isWalletAddress,
  loadCotiEthersModule,
  normalizeContactName,
  type OwnerAesBurnerWalletRecord,
  TEXT_DECODER,
  TEXT_ENCODER
} from './core';
import { base64ToBytes, bytesToBase64, getSecureWebCrypto, toArrayBuffer } from './parsers';
export const createBurnerWalletId = (): string =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const normalizeBurnerWalletOnboardInfo = (onboardInfo?: OnboardInfo): OnboardInfo | undefined => {
  const aesKey = typeof onboardInfo?.aesKey === 'string' ? onboardInfo.aesKey.trim() : '';
  return aesKey ? ({ aesKey } as OnboardInfo) : undefined;
};
export const createBurnerWalletVault = async (
  records: BurnerWalletRecord[],
  preferredActiveWalletId?: string
): Promise<BurnerWalletVault> => {
  const cotiEthers = await loadCotiEthersModule();
  const normalizedWallets: BurnerWalletRecord[] = [];
  const seenPrivateKeys = new Set<string>();

  for (const walletRecord of records) {
    const privateKey = walletRecord.privateKey.trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
      continue;
    }

    const dedupeKey = privateKey.toLowerCase();
    if (seenPrivateKeys.has(dedupeKey)) {
      continue;
    }

    seenPrivateKeys.add(dedupeKey);
    normalizedWallets.push({
      id: walletRecord.id?.trim() || createBurnerWalletId(),
      address: new cotiEthers.Wallet(privateKey).address,
      name: normalizeContactName(typeof walletRecord.name === 'string' ? walletRecord.name : ''),
      privateKey,
      mnemonic: walletRecord.mnemonic?.trim() || undefined,
      onboardInfo: normalizeBurnerWalletOnboardInfo(walletRecord.onboardInfo),
      recoveryDefault: walletRecord.recoveryDefault === true,
      recoveryProfileId:
        typeof walletRecord.recoveryProfileId === 'number' && Number.isSafeInteger(walletRecord.recoveryProfileId) && walletRecord.recoveryProfileId >= 0
          ? walletRecord.recoveryProfileId
          : undefined,
      recoveryProfileVersion:
        typeof walletRecord.recoveryProfileVersion === 'string' && /^\d+$/.test(walletRecord.recoveryProfileVersion)
          ? walletRecord.recoveryProfileVersion
          : undefined
    });
  }

  if (normalizedWallets.length === 0) {
    throw new Error('No valid app wallets found in storage.');
  }

  const activeWallet =
    normalizedWallets.find((walletRecord) => walletRecord.id === preferredActiveWalletId) ?? normalizedWallets[0];

  return {
    version: BURNER_WALLET_VAULT_VERSION,
    wallets: normalizedWallets,
    activeWalletId: activeWallet.id as string
  };
};

export const upsertBurnerWalletInVault = async (
  vault: BurnerWalletVault,
  walletRecord: BurnerWalletRecord
): Promise<BurnerWalletVault> => {
  const normalizedVault = await createBurnerWalletVault(vault.wallets, vault.activeWalletId);
  const incomingPrivateKey = walletRecord.privateKey.trim().toLowerCase();
  const existingWallet = normalizedVault.wallets.find(
    (existingWalletRecord) => existingWalletRecord.privateKey.toLowerCase() === incomingPrivateKey
  );

  if (existingWallet) {
    return {
      ...normalizedVault,
      wallets: normalizedVault.wallets.map((existingWalletRecord) =>
        existingWalletRecord.id === existingWallet.id
          ? {
              ...existingWalletRecord,
              name: normalizeContactName(typeof walletRecord.name === 'string' ? walletRecord.name : '') ?? existingWalletRecord.name,
              mnemonic: walletRecord.mnemonic?.trim() || existingWalletRecord.mnemonic,
              onboardInfo:
                normalizeBurnerWalletOnboardInfo(walletRecord.onboardInfo) ??
                normalizeBurnerWalletOnboardInfo(existingWalletRecord.onboardInfo),
              recoveryDefault: walletRecord.recoveryDefault === true,
              recoveryProfileId:
                typeof walletRecord.recoveryProfileId === 'number' && Number.isSafeInteger(walletRecord.recoveryProfileId) && walletRecord.recoveryProfileId >= 0
                  ? walletRecord.recoveryProfileId
                  : existingWalletRecord.recoveryProfileId,
              recoveryProfileVersion:
                typeof walletRecord.recoveryProfileVersion === 'string' && /^\d+$/.test(walletRecord.recoveryProfileVersion)
                  ? walletRecord.recoveryProfileVersion
                  : existingWalletRecord.recoveryProfileVersion
            }
          : existingWalletRecord
      ),
      activeWalletId: existingWallet.id as string
    };
  }

  const cotiEthers = await loadCotiEthersModule();
  const privateKey = walletRecord.privateKey.trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
    throw new Error('Invalid app wallet private key format.');
  }

  const createdWallet: BurnerWalletRecord = {
    id: createBurnerWalletId(),
    address: new cotiEthers.Wallet(privateKey).address,
    name: normalizeContactName(typeof walletRecord.name === 'string' ? walletRecord.name : ''),
    privateKey,
    mnemonic: walletRecord.mnemonic?.trim() || undefined,
    onboardInfo: normalizeBurnerWalletOnboardInfo(walletRecord.onboardInfo),
    recoveryDefault: walletRecord.recoveryDefault === true,
    recoveryProfileId:
      typeof walletRecord.recoveryProfileId === 'number' && Number.isSafeInteger(walletRecord.recoveryProfileId) && walletRecord.recoveryProfileId >= 0
        ? walletRecord.recoveryProfileId
        : undefined,
    recoveryProfileVersion:
      typeof walletRecord.recoveryProfileVersion === 'string' && /^\d+$/.test(walletRecord.recoveryProfileVersion)
        ? walletRecord.recoveryProfileVersion
        : undefined
  };

  return {
    ...normalizedVault,
    wallets: [...normalizedVault.wallets, createdWallet],
    activeWalletId: createdWallet.id as string
  };
};

export const parseBurnerWalletStorageState = (): BurnerWalletStorageState => {
  try {
    const raw = window.localStorage.getItem(BURNER_WALLET_STORAGE_KEY);
    if (!raw) {
      return { kind: 'none' };
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return { kind: 'none' };
    }

    const ownerAesCandidate = parsed as {
      version?: unknown;
      scheme?: unknown;
      ownerAddress?: unknown;
      iv?: unknown;
      ciphertext?: unknown;
    };
    const ownerAddress =
      typeof ownerAesCandidate.ownerAddress === 'string' ? ownerAesCandidate.ownerAddress.trim() : '';
    const hasOwnerAesShape =
      ownerAesCandidate.scheme === BURNER_OWNER_AES_WALLET_STORAGE_SCHEME &&
      isWalletAddress(ownerAddress) &&
      typeof ownerAesCandidate.iv === 'string' &&
      typeof ownerAesCandidate.ciphertext === 'string';
    if (hasOwnerAesShape) {
      const parsedVersion =
        typeof ownerAesCandidate.version === 'number'
          ? ownerAesCandidate.version
          : typeof ownerAesCandidate.version === 'string'
            ? Number(ownerAesCandidate.version)
            : Number.NaN;
      return {
        kind: 'owner-aes',
        record: {
          version:
            Number.isFinite(parsedVersion) && parsedVersion > 0
              ? Math.floor(parsedVersion)
              : BURNER_OWNER_AES_WALLET_STORAGE_VERSION,
          scheme: BURNER_OWNER_AES_WALLET_STORAGE_SCHEME,
          ownerAddress: ownerAddress.toLowerCase(),
          iv: ownerAesCandidate.iv as string,
          ciphertext: ownerAesCandidate.ciphertext as string
        }
      };
    }

    const encryptedCandidate = parsed as {
      version?: unknown;
      salt?: unknown;
      iv?: unknown;
      ciphertext?: unknown;
      iterations?: unknown;
    };

    const hasEncryptedShape =
      typeof encryptedCandidate.salt === 'string' &&
      typeof encryptedCandidate.iv === 'string' &&
      typeof encryptedCandidate.ciphertext === 'string';
    if (hasEncryptedShape) {
      const salt = encryptedCandidate.salt as string;
      const iv = encryptedCandidate.iv as string;
      const ciphertext = encryptedCandidate.ciphertext as string;
      const parsedIterations =
        typeof encryptedCandidate.iterations === 'number'
          ? encryptedCandidate.iterations
          : typeof encryptedCandidate.iterations === 'string'
            ? Number(encryptedCandidate.iterations)
            : Number.NaN;
      const iterations =
        Number.isFinite(parsedIterations) && parsedIterations > 0
          ? Math.floor(parsedIterations)
          : BURNER_PIN_PBKDF2_ITERATIONS;
      const version =
        typeof encryptedCandidate.version === 'number' && Number.isFinite(encryptedCandidate.version)
          ? Math.floor(encryptedCandidate.version)
          : BURNER_WALLET_STORAGE_VERSION;
      return {
        kind: 'encrypted',
        record: {
          version,
          salt,
          iv,
          ciphertext,
          iterations
        }
      };
    }

    const legacyVaultCandidate = parsed as {
      wallets?: unknown;
      activeWalletId?: unknown;
    };
    if (Array.isArray(legacyVaultCandidate.wallets)) {
      return {
        kind: 'legacy-vault',
        record: {
          wallets: legacyVaultCandidate.wallets as BurnerWalletRecord[],
          activeWalletId:
            typeof legacyVaultCandidate.activeWalletId === 'string'
              ? legacyVaultCandidate.activeWalletId
              : undefined
        }
      };
    }

    const legacyCandidate = parsed as { privateKey?: unknown; mnemonic?: unknown };
    const privateKey = typeof legacyCandidate.privateKey === 'string' ? legacyCandidate.privateKey.trim() : '';
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
      return { kind: 'none' };
    }

    const mnemonic = typeof legacyCandidate.mnemonic === 'string' ? legacyCandidate.mnemonic.trim() : undefined;
    return {
      kind: 'legacy',
      record: { privateKey, mnemonic }
    };
  } catch {
    return { kind: 'none' };
  }
};

const requireOwnerAesStorageInputs = (ownerAddress: string, ownerAesKey: string): {
  ownerAddress: string;
  ownerAesKey: string;
} => {
  const normalizedOwnerAddress = ownerAddress.trim().toLowerCase();
  const normalizedOwnerAesKey = ownerAesKey.trim();
  if (!isWalletAddress(normalizedOwnerAddress)) {
    throw new Error('Connect a valid owner wallet to unlock the app wallet.');
  }
  if (!normalizedOwnerAesKey) {
    throw new Error('Unlock the owner wallet AES key to unlock the app wallet.');
  }
  return {
    ownerAddress: normalizedOwnerAddress,
    ownerAesKey: normalizedOwnerAesKey
  };
};

const deriveBurnerOwnerAesStorageKey = async (
  ownerAddress: string,
  ownerAesKey: string,
  usages: KeyUsage[]
): Promise<CryptoKey> => {
  const { subtle } = getSecureWebCrypto();
  const inputs = requireOwnerAesStorageInputs(ownerAddress, ownerAesKey);
  const keyDigest = await subtle.digest(
    'SHA-256',
    toArrayBuffer(
      TEXT_ENCODER.encode(`ChainWhisperAppWalletLocalVaultV1:${inputs.ownerAddress}:${inputs.ownerAesKey}`)
    )
  );
  return subtle.importKey('raw', keyDigest, { name: 'AES-GCM' }, false, usages);
};

export const deriveBurnerPinKey = async (
  pin: string,
  salt: Uint8Array,
  iterations: number,
  usages: KeyUsage[]
): Promise<CryptoKey> => {
  const { subtle } = getSecureWebCrypto();
  const pinMaterial = await subtle.importKey('raw', TEXT_ENCODER.encode(pin), 'PBKDF2', false, [
    'deriveKey'
  ]);

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations,
      hash: 'SHA-256'
    },
    pinMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
};

export const encryptBurnerWalletVaultWithOwnerAes = async (
  vault: BurnerWalletVault,
  ownerAddress: string,
  ownerAesKey: string
): Promise<OwnerAesBurnerWalletRecord> => {
  const { webCrypto, subtle } = getSecureWebCrypto();
  const inputs = requireOwnerAesStorageInputs(ownerAddress, ownerAesKey);
  const normalizedVault = await createBurnerWalletVault(vault.wallets, vault.activeWalletId);
  const iv = webCrypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBurnerOwnerAesStorageKey(inputs.ownerAddress, inputs.ownerAesKey, ['encrypt']);
  const encrypted = await subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    TEXT_ENCODER.encode(JSON.stringify(normalizedVault))
  );

  return {
    version: BURNER_OWNER_AES_WALLET_STORAGE_VERSION,
    scheme: BURNER_OWNER_AES_WALLET_STORAGE_SCHEME,
    ownerAddress: inputs.ownerAddress,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted))
  };
};

export const decryptBurnerWalletVaultWithOwnerAes = async (
  encryptedRecord: OwnerAesBurnerWalletRecord,
  ownerAddress: string,
  ownerAesKey: string
): Promise<BurnerWalletVault> => {
  const inputs = requireOwnerAesStorageInputs(ownerAddress, ownerAesKey);
  if (encryptedRecord.scheme !== BURNER_OWNER_AES_WALLET_STORAGE_SCHEME) {
    throw new Error('Unsupported app wallet owner storage scheme.');
  }
  if (encryptedRecord.ownerAddress.trim().toLowerCase() !== inputs.ownerAddress) {
    throw new Error('This app wallet is saved for a different owner wallet.');
  }

  const iv = base64ToBytes(encryptedRecord.iv);
  const ciphertext = base64ToBytes(encryptedRecord.ciphertext);
  const key = await deriveBurnerOwnerAesStorageKey(inputs.ownerAddress, inputs.ownerAesKey, ['decrypt']);
  const { subtle } = getSecureWebCrypto();
  const decrypted = await subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ciphertext)
  );
  const parsed = JSON.parse(TEXT_DECODER.decode(decrypted)) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid app wallet payload.');
  }

  const asVault = parsed as { version?: unknown; wallets?: unknown; activeWalletId?: unknown };
  if (asVault.version === BURNER_WALLET_VAULT_VERSION && Array.isArray(asVault.wallets)) {
    return createBurnerWalletVault(
      asVault.wallets as BurnerWalletRecord[],
      typeof asVault.activeWalletId === 'string' ? asVault.activeWalletId : undefined
    );
  }

  throw new Error('Invalid app wallet payload.');
};

export const encryptBurnerWalletVault = async (vault: BurnerWalletVault, pin: string): Promise<EncryptedBurnerWalletRecord> => {
  const { webCrypto, subtle } = getSecureWebCrypto();
  const salt = webCrypto.getRandomValues(new Uint8Array(16));
  const iv = webCrypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBurnerPinKey(pin, salt, BURNER_PIN_PBKDF2_ITERATIONS, ['encrypt']);

  const payload = JSON.stringify(vault);
  const encrypted = await subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    TEXT_ENCODER.encode(payload)
  );

  return {
    version: BURNER_WALLET_STORAGE_VERSION,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iterations: BURNER_PIN_PBKDF2_ITERATIONS
  };
};

export const decryptBurnerWalletVault = async (
  encryptedRecord: EncryptedBurnerWalletRecord,
  pin: string
): Promise<BurnerWalletVault> => {
  const salt = base64ToBytes(encryptedRecord.salt);
  const iv = base64ToBytes(encryptedRecord.iv);
  const ciphertext = base64ToBytes(encryptedRecord.ciphertext);
  const key = await deriveBurnerPinKey(pin, salt, encryptedRecord.iterations, ['decrypt']);
  const { subtle } = getSecureWebCrypto();

  const decrypted = await subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ciphertext)
  );
  const rawPayload = TEXT_DECODER.decode(decrypted);
  const parsed = JSON.parse(rawPayload) as unknown;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid app wallet payload.');
  }

  const asVault = parsed as { version?: unknown; wallets?: unknown; activeWalletId?: unknown };
  if (asVault.version === BURNER_WALLET_VAULT_VERSION && Array.isArray(asVault.wallets)) {
    return createBurnerWalletVault(
      asVault.wallets as BurnerWalletRecord[],
      typeof asVault.activeWalletId === 'string' ? asVault.activeWalletId : undefined
    );
  }

  const legacyRecord = parsed as { privateKey?: unknown; mnemonic?: unknown };
  const privateKey = typeof legacyRecord.privateKey === 'string' ? legacyRecord.privateKey.trim() : '';
  if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
    throw new Error('Invalid app wallet private key format.');
  }

  return createBurnerWalletVault([
    {
      privateKey,
      mnemonic: typeof legacyRecord.mnemonic === 'string' ? legacyRecord.mnemonic.trim() : undefined
    }
  ]);
};

export const loadBurnerWalletVaultFromStorage = async (pin: string): Promise<BurnerWalletVault> => {
  const storageState = parseBurnerWalletStorageState();
  if (storageState.kind === 'none') {
    throw new Error('No saved ChainWhisper account found. Generate or import one first.');
  }

  if (storageState.kind === 'legacy') {
    const vault = await createBurnerWalletVault([storageState.record]);
    if (pin.trim().length >= BURNER_PIN_MIN_LENGTH) {
      await saveEncryptedBurnerWalletVault(vault, pin.trim());
    }
    return vault;
  }

  if (storageState.kind === 'legacy-vault') {
    const vault = await createBurnerWalletVault(storageState.record.wallets, storageState.record.activeWalletId);
    if (pin.trim().length >= BURNER_PIN_MIN_LENGTH) {
      await saveEncryptedBurnerWalletVault(vault, pin.trim());
    }
    return vault;
  }

  if (storageState.kind === 'owner-aes') {
    throw new Error('Connect the owner wallet to unlock this app wallet.');
  }

  if (!pin.trim()) {
    throw new Error('Enter PIN to unlock app wallet.');
  }

  try {
    return await decryptBurnerWalletVault(storageState.record, pin);
  } catch {
    throw new Error('Invalid PIN or corrupted app wallet data.');
  }
};

export const loadBurnerWalletVaultFromOwnerAesStorage = async (
  ownerAddress: string,
  ownerAesKey: string
): Promise<BurnerWalletVault> => {
  const storageState = parseBurnerWalletStorageState();
  if (storageState.kind === 'none') {
    throw new Error('No saved ChainWhisper account found. Generate, import, or recover one first.');
  }
  if (storageState.kind !== 'owner-aes') {
    throw new Error('Saved app wallet uses PIN unlock.');
  }

  try {
    return await decryptBurnerWalletVaultWithOwnerAes(storageState.record, ownerAddress, ownerAesKey);
  } catch (error) {
    if (error instanceof Error && error.message === 'This app wallet is saved for a different owner wallet.') {
      throw error;
    }
    throw new Error('Unable to unlock the saved app wallet with this owner wallet.');
  }
};

export const saveEncryptedBurnerWalletVault = async (vault: BurnerWalletVault, pin: string): Promise<void> => {
  if (!isBurnerStorageAvailable()) {
    throw new Error('Browser storage is unavailable. Disable private browsing or storage restrictions, then try again.');
  }
  const encrypted = await encryptBurnerWalletVault(vault, pin);
  try {
    window.localStorage.setItem(BURNER_WALLET_STORAGE_KEY, JSON.stringify(encrypted));
  } catch {
    throw new Error('Failed to persist wallet data in browser storage.');
  }
};

export const migrateLegacyBurnerWalletVaultStorage = async (pin: string): Promise<boolean> => {
  const normalizedPin = pin.trim();
  if (normalizedPin.length < BURNER_PIN_MIN_LENGTH) {
    return false;
  }

  const storageState = parseBurnerWalletStorageState();
  if (storageState.kind === 'legacy') {
    await saveEncryptedBurnerWalletVault(await createBurnerWalletVault([storageState.record]), normalizedPin);
    return true;
  }

  if (storageState.kind === 'legacy-vault') {
    await saveEncryptedBurnerWalletVault(
      await createBurnerWalletVault(storageState.record.wallets, storageState.record.activeWalletId),
      normalizedPin
    );
    return true;
  }

  return false;
};

export const saveOwnerAesBurnerWalletVault = async (
  vault: BurnerWalletVault,
  ownerAddress: string,
  ownerAesKey: string
): Promise<void> => {
  if (!isBurnerStorageAvailable()) {
    throw new Error('Browser storage is unavailable. Disable private browsing or storage restrictions, then try again.');
  }
  const encrypted = await encryptBurnerWalletVaultWithOwnerAes(vault, ownerAddress, ownerAesKey);
  try {
    window.localStorage.setItem(BURNER_WALLET_STORAGE_KEY, JSON.stringify(encrypted));
  } catch {
    throw new Error('Failed to persist wallet data in browser storage.');
  }
};
