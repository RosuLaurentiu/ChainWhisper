import { describe, expect, it, vi } from 'vitest';
import {
  APP_WALLET_RECOVERY_NOT_FOUND_MESSAGE,
  buildAppWalletRecoveryPromptEstimateMessage,
  decryptAppWalletRecoveryGcProfile,
  encodeCompactAppWalletRecoveryPayload,
  estimateAppWalletRecoveryPromptLoad,
  getAppWalletRecoveryReadErrorMessage,
  isAppWalletRecoveryConfigured,
  isAppWalletRecoveryNotFoundError,
  normalizeAppWalletRecoveryGcProfile
} from './appWalletRecovery';
import { CW_PROFILE_REGISTRY_CONTRACT_ADDRESS, createBurnerWalletVault } from './appShared';

describe('app wallet recovery helpers', () => {
  it('uses the canonical GC profile registry for local recovery', () => {
    expect(CW_PROFILE_REGISTRY_CONTRACT_ADDRESS).toBe('0xf37196Fafe760E92d3542D837a1595B2a625F618');
    expect(isAppWalletRecoveryConfigured()).toBe(true);
  });

  it('normalizes GC profile results from named or indexed fields', () => {
    const encryptedPayload = { value: [1n, 2n] };
    const named = normalizeAppWalletRecoveryGcProfile({
      encryptedPayload,
      version: 2n,
      active: true,
      cellCount: 2n
    }, 4, 4);
    expect(named).toMatchObject({
      encryptedPayload,
      scheme: 'coti-gc',
      version: 2n,
      active: true,
      payloadSize: 2n,
      profileId: 4,
      defaultProfile: true
    });

    const indexed = normalizeAppWalletRecoveryGcProfile({
      0: encryptedPayload,
      1: true,
      2: '3',
      3: '2'
    });
    expect(indexed).toMatchObject({
      encryptedPayload,
      scheme: 'coti-gc',
      version: 3n,
      active: true,
      payloadSize: 2n,
      profileId: 0
    });
  });

  it('decrypts the owner-readable ciphertext from GC recovery profiles', async () => {
    const privateKey = `0x${'11'.repeat(32)}`;
    const payloadJson = JSON.stringify({
      payloadKind: 'chainwhisper.appWalletRecovery.v1',
      recoveryOwnerAddress: '0x5DFcEe20b5a3FDd3577436A32f62d4C0b39e979d',
      activeWalletAddress: '0x19E7E376E7C213B7E7E7E46CC70A5DD086DAFF2A',
      version: 1,
      wallets: [
        {
          id: 'wallet-1',
          privateKey,
          name: 'Recovered'
        }
      ],
      activeWalletId: 'wallet-1'
    });
    const userCiphertext = { value: [3n, 4n] };
    const decryptValue = vi.fn().mockResolvedValue(payloadJson);
    const ownerSigner = {
      decryptValue
    } as never;

    const recovered = await decryptAppWalletRecoveryGcProfile(
      {
        active: true,
        encryptedPayload: userCiphertext,
        profileId: 0,
        scheme: 'coti-gc',
        version: 1n
      },
      ownerSigner
    );

    expect(decryptValue).toHaveBeenCalledWith(userCiphertext);
    expect(recovered.vault.wallets[0]?.privateKey).toBe(privateKey);
    expect(recovered.metadata.recoveryOwnerAddress).toBe('0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d');
  });

  it('decrypts V2 ethers tuple-shaped ctString payloads without dropping cells', async () => {
    const privateKey = `0x${'22'.repeat(32)}`;
    const payloadJson = JSON.stringify({
      v: 3,
      t: 'p',
      s: privateKey
    });
    const tuplePayload = Object.assign([[11n, 12n, 13n]], { value: [11n, 12n, 13n] });
    const decryptValue = vi.fn().mockResolvedValue(payloadJson);

    await decryptAppWalletRecoveryGcProfile(
      {
        active: true,
        encryptedPayload: tuplePayload,
        profileId: 0,
        scheme: 'coti-gc',
        version: 1n
      },
      { decryptValue } as never
    );

    expect(decryptValue).toHaveBeenCalledWith({ value: [11n, 12n, 13n] });
  });

  it('encodes only the active wallet in compact v3 recovery payloads', async () => {
    const firstPrivateKey = `0x${'11'.repeat(32)}`;
    const secondPrivateKey = `0x${'22'.repeat(32)}`;
    const vault = await createBurnerWalletVault(
      [
        { id: 'first', privateKey: firstPrivateKey, mnemonic: 'first mnemonic is ignored' },
        { id: 'second', privateKey: secondPrivateKey }
      ],
      'second'
    );

    const encoded = JSON.parse(encodeCompactAppWalletRecoveryPayload(vault)) as {
      s: string;
      t: string;
      v: number;
    };
    const estimate = estimateAppWalletRecoveryPromptLoad(vault);

    expect(encoded).toEqual({
      v: 3,
      t: 'p',
      s: secondPrivateKey
    });
    expect(estimate.plaintextBytes).toBe(new TextEncoder().encode(JSON.stringify(encoded)).byteLength);
    expect(estimate.estimatedWalletPrompts).toBeLessThan(20);
    expect(buildAppWalletRecoveryPromptEstimateMessage(estimate)).toContain('one-time action');
  });

  it('includes the active ChainWhisper account AES key when saving compact recovery', async () => {
    const privateKey = `0x${'44'.repeat(32)}`;
    const vault = await createBurnerWalletVault([
      {
        privateKey,
        onboardInfo: { aesKey: 'chainwhisper-account-aes' } as never
      }
    ]);

    const encoded = JSON.parse(encodeCompactAppWalletRecoveryPayload(vault)) as {
      a: string;
      s: string;
      t: string;
      v: number;
    };

    expect(encoded).toEqual({
      a: 'chainwhisper-account-aes',
      v: 3,
      t: 'p',
      s: privateKey
    });
  });

  it('restores compact v3 mnemonic recovery payloads with backup phrase available', async () => {
    const mnemonic = 'test test test test test test test test test test test junk';
    const userCiphertext = { value: [5n, 6n] };
    const decryptValue = vi.fn().mockResolvedValue(JSON.stringify({
      v: 3,
      t: 'm',
      s: mnemonic,
      n: 'Main account'
    }));

    const recovered = await decryptAppWalletRecoveryGcProfile(
      {
        active: true,
        encryptedPayload: { userCiphertext },
        profileId: 0,
        scheme: 'coti-gc',
        version: 1n
      },
      { decryptValue } as never
    );

    expect(recovered.vault.wallets[0]?.privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(recovered.vault.wallets[0]?.mnemonic).toBe(mnemonic);
    expect(recovered.vault.wallets[0]?.name).toBe('Main account');
  });

  it('restores compact v3 private-key recovery payloads without inventing a mnemonic', async () => {
    const privateKey = `0x${'33'.repeat(32)}`;
    const decryptValue = vi.fn().mockResolvedValue(JSON.stringify({
      v: 3,
      t: 'p',
      s: privateKey
    }));

    const recovered = await decryptAppWalletRecoveryGcProfile(
      {
        active: true,
        encryptedPayload: { userCiphertext: { value: [7n, 8n] } },
        profileId: 0,
        scheme: 'coti-gc',
        version: 1n
      },
      { decryptValue } as never
    );

    expect(recovered.vault.wallets[0]?.privateKey).toBe(privateKey);
    expect(recovered.vault.wallets[0]?.mnemonic).toBeUndefined();
  });

  it('restores compact v3 app-wallet AES so recovered accounts can connect without re-onboarding', async () => {
    const privateKey = `0x${'55'.repeat(32)}`;
    const decryptValue = vi.fn().mockResolvedValue(JSON.stringify({
      v: 3,
      t: 'p',
      s: privateKey,
      a: 'recovered-app-aes'
    }));

    const recovered = await decryptAppWalletRecoveryGcProfile(
      {
        active: true,
        encryptedPayload: { userCiphertext: { value: [9n, 10n] } },
        profileId: 0,
        scheme: 'coti-gc',
        version: 1n
      },
      { decryptValue } as never
    );

    expect(recovered.vault.wallets[0]?.privateKey).toBe(privateKey);
    expect(recovered.vault.wallets[0]?.onboardInfo?.aesKey).toBe('recovered-app-aes');
  });

  it('hides low-level contract decode errors behind recovery copy', () => {
    expect(getAppWalletRecoveryReadErrorMessage(new Error('out of result range'))).toContain(
      'ChainWhisper account recovery could not be read'
    );
  });

  it('distinguishes missing owner recovery from recovery failures', () => {
    expect(isAppWalletRecoveryNotFoundError(new Error(APP_WALLET_RECOVERY_NOT_FOUND_MESSAGE))).toBe(true);
    expect(isAppWalletRecoveryNotFoundError(new Error('could not decrypt recovery payload'))).toBe(false);
  });
});
