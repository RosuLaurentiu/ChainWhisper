import { describe, expect, it, vi } from 'vitest';
import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import { createGuardedSignerLease } from './useSharedWalletSigner';
import { loadOwnerPrivateTokenBalances } from './useOwnerWalletBalances';

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

describe('loadOwnerPrivateTokenBalances', () => {
  it('borrows one read signer without taking ownership of its provider lifecycle', async () => {
    const walletAddress = '0x0000000000000000000000000000000000000001';
    const destroy = vi.fn();
    const signer = {
      address: walletAddress,
      provider: { destroy }
    } as unknown as JsonRpcSigner;
    const getOwnerReadSigner = vi.fn(async () => signer);

    await expect(loadOwnerPrivateTokenBalances({
      getOwnerReadSigner,
      ownerWalletAddress: walletAddress,
      readCurrentPrivateBalance: vi.fn(async () => 7n),
      readLegacyPrivateBalance: vi.fn(async () => 8n)
    })).resolves.toMatchObject({
      legacyPrivateBalanceWei: 8n,
      ownerPrivateSigner: signer,
      privateBalanceWei: 7n
    });
    expect(getOwnerReadSigner).toHaveBeenCalledOnce();
    expect(getOwnerReadSigner).toHaveBeenCalledWith(true);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('does not decrypt after a deferred balance RPC when the owner signer lease is revoked', async () => {
    const walletAddress = '0x0000000000000000000000000000000000000001';
    const balanceRpc = createDeferred<void>();
    const decryptUint256 = vi.fn(() => 7n);
    const rawDecryptValue = vi.fn(async () => 9n);
    const rawGetUserOnboardInfo = vi.fn(() => ({ aesKey: 'owner-aes-key' }));
    const rawSigner = {
      address: walletAddress,
      decryptValue: rawDecryptValue,
      getUserOnboardInfo: rawGetUserOnboardInfo,
      sendUncheckedTransaction: vi.fn()
    } as unknown as JsonRpcSigner;
    let leaseCurrent = true;
    const assertCurrent = () => {
      if (!leaseCurrent) {
        throw new Error('owner signer lease expired');
      }
    };
    const leasedSigner = createGuardedSignerLease(rawSigner, assertCurrent, assertCurrent);
    const readCurrentPrivateBalance = vi.fn(async (
      _tokenAddress: string,
      _ownerAddress: string,
      signer: JsonRpcSigner | Wallet
    ) => {
      await balanceRpc.promise;
      const aesKey = signer.getUserOnboardInfo()?.aesKey;
      return aesKey ? decryptUint256() : null;
    });
    const readLegacyPrivateBalance = vi.fn(async (
      _ownerAddress: string,
      signer: JsonRpcSigner | Wallet
    ) => signer.decryptValue('legacy-ciphertext' as never) as Promise<bigint>);

    const loading = loadOwnerPrivateTokenBalances({
      getOwnerReadSigner: async () => leasedSigner,
      ownerWalletAddress: walletAddress,
      readCurrentPrivateBalance,
      readLegacyPrivateBalance
    });
    await vi.waitFor(() => expect(readCurrentPrivateBalance).toHaveBeenCalledTimes(1));

    leaseCurrent = false;
    balanceRpc.resolve();

    await expect(loading).resolves.toMatchObject({
      legacyPrivateBalanceWei: null,
      privateBalanceWei: null
    });
    expect(decryptUint256).not.toHaveBeenCalled();
    expect(rawGetUserOnboardInfo).not.toHaveBeenCalled();
    expect(rawDecryptValue).not.toHaveBeenCalled();
    expect(readLegacyPrivateBalance).toHaveBeenCalledTimes(1);
  });
});
