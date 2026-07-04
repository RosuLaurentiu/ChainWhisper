import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNewBurnerWalletRecord, saveBurnerWalletRecordWithOwnerAes, selectBurnerWalletFromVault } from './burnerWalletVault';
import {
  BURNER_WALLET_STORAGE_KEY,
  loadBurnerWalletVaultFromOwnerAesStorage,
  loadBurnerWalletVaultFromStorage,
  migrateLegacyBurnerWalletVaultStorage,
  parseBurnerWalletStorageState,
  saveEncryptedBurnerWalletVault,
  saveOwnerAesBurnerWalletVault,
  type BurnerWalletVault
} from './appShared';

const makeVault = (): BurnerWalletVault => ({
  version: 1,
  activeWalletId: 'wallet-b',
  wallets: [
    {
      id: 'wallet-a',
      address: '0x1111111111111111111111111111111111111111',
      privateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    },
    {
      id: 'wallet-b',
      address: '0x2222222222222222222222222222222222222222',
      privateKey: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    }
  ]
});

const makeStorage = () => {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    get length() {
      return values.size;
    }
  };
};

describe('app wallet vault helpers', () => {
  beforeEach(() => {
    const localStorage = makeStorage();
    vi.stubGlobal('window', {
      isSecureContext: true,
      localStorage
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('selects a wallet by id', () => {
    expect(selectBurnerWalletFromVault(makeVault(), 'wallet-b')?.id).toBe('wallet-b');
  });

  it('selects a wallet by address case-insensitively', () => {
    expect(selectBurnerWalletFromVault(makeVault(), '0x2222222222222222222222222222222222222222')?.id).toBe('wallet-b');
  });

  it('falls back to the first saved wallet instead of the previous active wallet', () => {
    expect(selectBurnerWalletFromVault(makeVault(), 'missing')?.id).toBe('wallet-a');
    expect(selectBurnerWalletFromVault(makeVault())?.id).toBe('wallet-a');
  });

  it('keeps PIN-encrypted vault storage compatible', async () => {
    await saveEncryptedBurnerWalletVault(makeVault(), '12345');

    expect(parseBurnerWalletStorageState().kind).toBe('encrypted');
    const restored = await loadBurnerWalletVaultFromStorage('12345');
    expect(restored.activeWalletId).toBe('wallet-b');
    expect(restored.wallets).toHaveLength(2);
    await expect(loadBurnerWalletVaultFromStorage('54321')).rejects.toThrow();
  });

  it('migrates legacy plaintext wallet storage to the encrypted vault format', async () => {
    window.localStorage.setItem(
      BURNER_WALLET_STORAGE_KEY,
      JSON.stringify({
        privateKey: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        mnemonic: 'legacy mnemonic'
      })
    );

    await expect(migrateLegacyBurnerWalletVaultStorage('12345')).resolves.toBe(true);

    expect(parseBurnerWalletStorageState().kind).toBe('encrypted');
    expect(window.localStorage.getItem(BURNER_WALLET_STORAGE_KEY)).not.toContain('0xcccccccc');
    const restored = await loadBurnerWalletVaultFromStorage('12345');
    expect(restored.wallets[0]?.privateKey).toBe(
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    );
  });

  it('encrypts legacy plaintext storage when the old app-wallet unlock path loads it', async () => {
    window.localStorage.setItem(
      BURNER_WALLET_STORAGE_KEY,
      JSON.stringify({
        privateKey: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        mnemonic: 'old path mnemonic'
      })
    );

    const restored = await loadBurnerWalletVaultFromStorage('12345');

    expect(restored.wallets[0]?.privateKey).toBe(
      '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    );
    expect(parseBurnerWalletStorageState().kind).toBe('encrypted');
    expect(window.localStorage.getItem(BURNER_WALLET_STORAGE_KEY)).not.toContain('0xdddddddd');
    await expect(loadBurnerWalletVaultFromStorage('54321')).rejects.toThrow();

    window.localStorage.setItem(
      BURNER_WALLET_STORAGE_KEY,
      JSON.stringify({
        activeWalletId: 'wallet-b',
        wallets: makeVault().wallets
      })
    );

    const restoredVault = await loadBurnerWalletVaultFromStorage('23456');

    expect(restoredVault.activeWalletId).toBe('wallet-b');
    expect(restoredVault.wallets).toHaveLength(2);
    expect(parseBurnerWalletStorageState().kind).toBe('encrypted');
    expect(window.localStorage.getItem(BURNER_WALLET_STORAGE_KEY)).not.toContain('0xbbbbbb');
  });

  it('does not migrate legacy plaintext storage with a legacy-length PIN', async () => {
    window.localStorage.setItem(
      BURNER_WALLET_STORAGE_KEY,
      JSON.stringify({
        privateKey: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
      })
    );

    await expect(migrateLegacyBurnerWalletVaultStorage('1234')).resolves.toBe(false);

    expect(parseBurnerWalletStorageState().kind).toBe('legacy');
    expect(window.localStorage.getItem(BURNER_WALLET_STORAGE_KEY)).toContain('0xcccccccc');
  });

  it('saves and loads owner-AES local app wallet vaults', async () => {
    const ownerAddress = '0x3333333333333333333333333333333333333333';

    await saveOwnerAesBurnerWalletVault(makeVault(), ownerAddress, 'owner-aes-key');

    const storageState = parseBurnerWalletStorageState();
    expect(storageState.kind).toBe('owner-aes');
    expect(window.localStorage.getItem(BURNER_WALLET_STORAGE_KEY)).not.toContain('0xaaaaaaaa');

    const restored = await loadBurnerWalletVaultFromOwnerAesStorage(ownerAddress, 'owner-aes-key');
    expect(restored.activeWalletId).toBe('wallet-b');
    expect(restored.wallets[1]?.privateKey).toBe('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    await expect(loadBurnerWalletVaultFromOwnerAesStorage(ownerAddress, 'wrong-key')).rejects.toThrow();
    await expect(
      loadBurnerWalletVaultFromOwnerAesStorage('0x4444444444444444444444444444444444444444', 'owner-aes-key')
    ).rejects.toThrow('different owner wallet');
  });

  it('allows a different owner to replace an owner-AES local account intentionally', async () => {
    const firstOwner = '0x3333333333333333333333333333333333333333';
    const secondOwner = '0x4444444444444444444444444444444444444444';

    await saveOwnerAesBurnerWalletVault(makeVault(), firstOwner, 'first-owner-aes-key');
    const replacementVault = await saveBurnerWalletRecordWithOwnerAes(
      {
        privateKey: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
      },
      secondOwner,
      'second-owner-aes-key'
    );

    expect(replacementVault.wallets).toHaveLength(1);
    await expect(loadBurnerWalletVaultFromOwnerAesStorage(firstOwner, 'first-owner-aes-key')).rejects.toThrow(
      'different owner wallet'
    );
    const restored = await loadBurnerWalletVaultFromOwnerAesStorage(secondOwner, 'second-owner-aes-key');
    expect(restored.wallets[0]?.privateKey).toBe(
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    );
  });

  it('does not invent a mnemonic for private-key-only imports', async () => {
    const record = await buildNewBurnerWalletRecord(
      'import',
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    );

    expect(record.privateKey).toBe('0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
    expect(record.mnemonic).toBeUndefined();
  });
});
