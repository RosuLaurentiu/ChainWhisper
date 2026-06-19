import {
  createBurnerWalletVault,
  loadBurnerWalletVaultFromOwnerAesStorage,
  loadBurnerWalletVaultFromStorage,
  loadCotiEthersModule,
  looksLikePrivateKeyInput,
  normalizeImportInput,
  normalizeMnemonicInput,
  normalizePrivateKeyInput,
  parseBurnerWalletStorageState,
  saveEncryptedBurnerWalletVault,
  saveOwnerAesBurnerWalletVault,
  upsertBurnerWalletInVault,
  type BurnerInitMode,
  type BurnerWalletRecord,
  type BurnerWalletVault
} from './appShared';

export type BurnerWalletMutationMode = Exclude<BurnerInitMode, 'stored'>;

export const selectBurnerWalletFromVault = (
  vault: BurnerWalletVault,
  preferredWalletSelector?: string
): BurnerWalletRecord | null => {
  const selector = preferredWalletSelector?.trim() ?? '';
  const selectorKey = selector.toLowerCase();
  const selectedWallet = selector
    ? (
      vault.wallets.find((walletRecord) => walletRecord.id === selector) ??
      vault.wallets.find((walletRecord) => walletRecord.address?.toLowerCase() === selectorKey)
    )
    : null;

  return (
    selectedWallet ??
    vault.wallets[0] ??
    null
  );
};

export const buildNewBurnerWalletRecord = async (
  mode: BurnerWalletMutationMode,
  seedOrPrivateKey = ''
): Promise<BurnerWalletRecord> => {
  const cotiEthers = await loadCotiEthersModule();

  if (mode === 'generate') {
    const createdWallet = cotiEthers.Wallet.createRandom();
    return {
      privateKey: createdWallet.privateKey,
      mnemonic: createdWallet.mnemonic?.phrase
    };
  }

  const normalizedSeed = normalizeImportInput(seedOrPrivateKey);
  if (!normalizedSeed) {
    throw new Error('Enter a mnemonic phrase or private key.');
  }

  const normalizedPrivateKey = normalizePrivateKeyInput(normalizedSeed);
  if (normalizedPrivateKey) {
    return { privateKey: normalizedPrivateKey };
  }

  if (looksLikePrivateKeyInput(normalizedSeed)) {
    throw new Error('Invalid private key. Use exactly 64 hex characters (optionally prefixed with 0x).');
  }

  const normalizedMnemonic = normalizeMnemonicInput(normalizedSeed);
  try {
    const importedWallet = cotiEthers.Wallet.fromPhrase(normalizedMnemonic);
    return {
      privateKey: importedWallet.privateKey,
      mnemonic: normalizedMnemonic
    };
  } catch {
    throw new Error('Invalid mnemonic phrase.');
  }
};

export const loadStoredBurnerWalletRecord = async (
  pin: string,
  preferredWalletSelector?: string
): Promise<{ record: BurnerWalletRecord; vault: BurnerWalletVault }> => {
  const vault = await loadBurnerWalletVaultFromStorage(pin);
  const selectedWallet = selectBurnerWalletFromVault(vault, preferredWalletSelector);
  if (!selectedWallet) {
    throw new Error('No saved ChainWhisper account found. Generate or import one first.');
  }

  return {
    record: selectedWallet,
    vault: {
      ...vault,
      activeWalletId: selectedWallet.id as string
    }
  };
};

export const saveBurnerWalletRecordWithPin = async (
  record: BurnerWalletRecord,
  pin: string
): Promise<BurnerWalletVault> => {
  const storageState = parseBurnerWalletStorageState();
  const existingVault =
    storageState.kind === 'none'
      ? null
      : await loadBurnerWalletVaultFromStorage(storageState.kind === 'encrypted' ? pin : '');
  const nextVault = existingVault
    ? await upsertBurnerWalletInVault(existingVault, record)
    : await createBurnerWalletVault([record]);

  await saveEncryptedBurnerWalletVault(nextVault, pin);
  return nextVault;
};

export const saveBurnerWalletRecordWithOwnerAes = async (
  record: BurnerWalletRecord,
  ownerAddress: string,
  ownerAesKey: string
): Promise<BurnerWalletVault> => {
  const storageState = parseBurnerWalletStorageState();
  let existingVault: BurnerWalletVault | null = null;
  if (storageState.kind === 'owner-aes') {
    try {
      existingVault = await loadBurnerWalletVaultFromOwnerAesStorage(ownerAddress, ownerAesKey);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('different owner wallet')) {
        throw error;
      }
    }
  }
  const nextVault = existingVault
    ? await upsertBurnerWalletInVault(existingVault, record)
    : await createBurnerWalletVault([record]);

  await saveOwnerAesBurnerWalletVault(nextVault, ownerAddress, ownerAesKey);
  return nextVault;
};

export const resaveBurnerWalletVaultWithPin = async (
  wallets: BurnerWalletRecord[],
  pin: string,
  activeWalletId?: string
): Promise<BurnerWalletVault> => {
  const vault = await createBurnerWalletVault(wallets, activeWalletId);
  await saveEncryptedBurnerWalletVault(vault, pin);
  return vault;
};
