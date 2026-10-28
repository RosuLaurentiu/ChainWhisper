import { describe, expect, it, vi } from 'vitest';
import type { WalletSessionActions } from '../../../lib/walletSession';
import {
  acquireSharedP2PTradeSigner
} from './useP2PTradeSigner';

describe('acquireSharedP2PTradeSigner', () => {
  it('delegates Trading signer requests to the shared wallet session when available', async () => {
    const walletKey = '0x0000000000000000000000000000000000000abc';
    const signer = { address: walletKey };
    const sharedGetSigner = vi.fn(async () => signer) as unknown as WalletSessionActions['getSigner'];

    await expect(
      acquireSharedP2PTradeSigner(sharedGetSigner, true, { refreshAes: true }, walletKey, () => undefined)
    ).resolves.toBe(signer);

    expect(sharedGetSigner).toHaveBeenCalledWith(true, { refreshAes: true });
  });

  it('fails closed when Trading has no shared wallet session', async () => {
    await expect(
      acquireSharedP2PTradeSigner(
        undefined,
        false,
        {},
        '0x0000000000000000000000000000000000000044',
        () => undefined
      )
    ).rejects.toThrow('Trading requires the connected ChainWhisper browser-wallet session');
  });

  it('rejects an ordinary shared signer when the originating wallet changes during acquisition', async () => {
    const walletA = '0x0000000000000000000000000000000000000044';
    const walletB = '0x0000000000000000000000000000000000000055';
    let releaseSigner!: (signer: { address: string }) => void;
    const signerGate = new Promise<{ address: string }>((resolve) => {
      releaseSigner = resolve;
    });
    const sharedGetSigner = vi.fn(() => signerGate) as unknown as WalletSessionActions['getSigner'];
    let currentWallet = walletA;
    const acquiring = acquireSharedP2PTradeSigner(
      sharedGetSigner,
      false,
      {},
      walletA,
      () => {
        if (currentWallet !== walletA) {
          throw new Error('P2P wallet session changed');
        }
      }
    );
    await vi.waitFor(() => expect(sharedGetSigner).toHaveBeenCalledTimes(1));

    currentWallet = walletB;
    releaseSigner({ address: walletB });

    await expect(acquiring).rejects.toThrow('P2P wallet session changed');
  });

  it('does not request a shared signer after the originating wallet is already stale', async () => {
    const walletA = '0x0000000000000000000000000000000000000044';
    const sharedGetSigner = vi.fn(async () => ({ address: walletA })) as unknown as WalletSessionActions['getSigner'];

    await expect(
      acquireSharedP2PTradeSigner(sharedGetSigner, false, {}, walletA, () => {
        throw new Error('P2P wallet session changed');
      })
    ).rejects.toThrow('P2P wallet session changed');
    expect(sharedGetSigner).not.toHaveBeenCalled();
  });

  it('rejects a returned signer that does not match the originating wallet', async () => {
    const walletA = '0x0000000000000000000000000000000000000044';
    const walletB = '0x0000000000000000000000000000000000000055';
    const sharedGetSigner = vi.fn(async () => ({ address: walletB })) as unknown as WalletSessionActions['getSigner'];

    await expect(
      acquireSharedP2PTradeSigner(sharedGetSigner, false, {}, walletA, () => undefined)
    ).rejects.toThrow('Connected wallet changed while the trade action was pending.');
  });

  it('returns the ordinary shared signer while the originating wallet remains current', async () => {
    const walletA = '0x0000000000000000000000000000000000000044';
    const signer = { address: walletA };
    const sharedGetSigner = vi.fn(async () => signer) as unknown as WalletSessionActions['getSigner'];

    await expect(
      acquireSharedP2PTradeSigner(sharedGetSigner, true, { refreshAes: true }, walletA, () => undefined)
    ).resolves.toBe(signer);
    expect(sharedGetSigner).toHaveBeenCalledWith(true, { refreshAes: true });
  });
});
