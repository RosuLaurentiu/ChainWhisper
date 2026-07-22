import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  COTI_NETWORK,
  createCotiBrowserProvider,
  decodeMemoPlaintextStrict,
  encodeCompactMemoPlaintext,
  encodeMemoPlaintext,
  mergeOnboardInfo,
  mergeOnboardInfoByAddress,
  parseChatMessagePayload,
  type Eip1193Provider,
  type SignerSource
} from '../../../lib/appShared';
import {
  buildWalletAesHealthState,
  getOrRecoverAesForWallet,
  type WalletAesHealthState
} from '../../../lib/cotiAesUnlock';
import { getCotiSnapOwnerAesKeyResult, getCotiSnapOwnerAesStatusMessage } from '../../../lib/cotiSnap';
import type { WalletReadAccount } from '../../../lib/walletAccountScope';

type MemoSignerBundle = {
  signer: Wallet | JsonRpcSigner;
  cacheKey: string;
};

type UseChatMemoCryptoArgs = {
  activeSignerSource: SignerSource;
  browserWalletProvider: Eip1193Provider | null | undefined;
  burnerWalletRef: MutableRefObject<Wallet | null>;
  chainId: number | null;
  encodeMemoForActiveSignerRef: MutableRefObject<(plain: string) => string>;
  getConnectedProvider: () => Eip1193Provider | null;
  getMemoSignerRef: MutableRefObject<() => Promise<MemoSignerBundle>>;
  memoAesRecoveryAttemptedRef: MutableRefObject<Record<string, boolean>>;
  ownerWalletAddress: string;
  sessionOnboardInfo: Record<string, OnboardInfo>;
  setOnboardStatus: (status: string) => void;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  setWalletAesHealth: (address: string, health: WalletAesHealthState) => void;
  signerCacheRef: MutableRefObject<Record<string, JsonRpcSigner>>;
  signerProviderCacheRef: MutableRefObject<Record<string, Eip1193Provider>>;
  walletAddress: string;
  walletAesHealthByAddress: Record<string, WalletAesHealthState>;
};

export default function useChatMemoCrypto({
  activeSignerSource,
  browserWalletProvider,
  burnerWalletRef,
  chainId,
  encodeMemoForActiveSignerRef,
  getConnectedProvider,
  getMemoSignerRef,
  memoAesRecoveryAttemptedRef,
  ownerWalletAddress,
  sessionOnboardInfo,
  setOnboardStatus,
  setSessionOnboardInfo,
  setWalletAesHealth,
  signerCacheRef,
  signerProviderCacheRef,
  walletAddress,
  walletAesHealthByAddress
}: UseChatMemoCryptoArgs) {
  const getMemoSigner = useCallback(async (): Promise<MemoSignerBundle> => {
    if (activeSignerSource === 'metamask') {
      const provider = getConnectedProvider();
      if (!provider) {
        throw new Error('Owner wallet provider not detected. Connect your owner wallet first.');
      }

      if (!walletAddress) {
        throw new Error('Connect your owner wallet first.');
      }

      if (chainId !== COTI_NETWORK.chainIdDecimal) {
        throw new Error('Switch to COTI network first.');
      }

      const cacheKey = walletAddress.toLowerCase();
      const cachedOnboardInfo = sessionOnboardInfo[cacheKey];
      let signer = signerCacheRef.current[cacheKey] as JsonRpcSigner | undefined;
      if (signer && signerProviderCacheRef.current[cacheKey] !== provider) {
        delete signerCacheRef.current[cacheKey];
        delete signerProviderCacheRef.current[cacheKey];
        signer = undefined;
      }
      if (!signer) {
        const browserProvider = await createCotiBrowserProvider(provider);
        signer = await browserProvider.getSigner(walletAddress, cachedOnboardInfo);
        signer.disableAutoOnboard();
        signerCacheRef.current[cacheKey] = signer;
        signerProviderCacheRef.current[cacheKey] = provider;
      } else if (cachedOnboardInfo) {
        signer.setUserOnboardInfo(cachedOnboardInfo);
      }

      signer.disableAutoOnboard();

      let onboardInfo = signer.getUserOnboardInfo();
      if (!onboardInfo?.aesKey) {
        if (cachedOnboardInfo) {
          signer.setUserOnboardInfo(cachedOnboardInfo);
          onboardInfo = signer.getUserOnboardInfo();
        }
      }

      if (!onboardInfo?.aesKey) {
        const snapAesResult = await getCotiSnapOwnerAesKeyResult(provider, walletAddress);
        if (snapAesResult.status !== 'ready') {
          throw new Error(getCotiSnapOwnerAesStatusMessage(snapAesResult.status));
        }
        onboardInfo = mergeOnboardInfo(signer.getUserOnboardInfo(), {
          aesKey: snapAesResult.aesKey
        } as OnboardInfo);
        signer.setUserOnboardInfo(onboardInfo);
      }

      if (!onboardInfo?.aesKey) {
        throw new Error('Privacy unlock unavailable. Complete the privacy unlock signature once.');
      }

      setSessionOnboardInfo((previous) => mergeOnboardInfoByAddress(previous, cacheKey, onboardInfo));
      setWalletAesHealth(walletAddress, buildWalletAesHealthState({
        status: 'ready-unverified',
        walletAddress
      }));

      setOnboardStatus('Owner privacy ready');
      return { signer, cacheKey };
    }

    const signer = burnerWalletRef.current;
    if (!signer) {
      throw new Error('ChainWhisper account is not initialized.');
    }

    const cacheKey = signer.address.toLowerCase();
    const cachedOnboardInfo = sessionOnboardInfo[cacheKey];
    if (cachedOnboardInfo) {
      signer.setUserOnboardInfo(cachedOnboardInfo);
    }

    let onboardInfo = signer.getUserOnboardInfo();
    if (!onboardInfo?.aesKey) {
      onboardInfo = await getOrRecoverAesForWallet({
        signer,
        walletAddress: signer.address
      });
    }

    if (!onboardInfo?.aesKey) {
      throw new Error('Privacy unlock unavailable in this session. Please sign to enable encryption.');
    }

    setSessionOnboardInfo((previous) => mergeOnboardInfoByAddress(previous, cacheKey, onboardInfo));

    setOnboardStatus('Privacy ready');

    return { signer, cacheKey };
  }, [
    activeSignerSource,
    burnerWalletRef,
    chainId,
    getConnectedProvider,
    sessionOnboardInfo,
    setOnboardStatus,
    setSessionOnboardInfo,
    setWalletAesHealth,
    signerCacheRef,
    signerProviderCacheRef,
    walletAddress
  ]);

  const getMemoSignerForAccount = useCallback(async (account: WalletReadAccount): Promise<MemoSignerBundle> => {
    const accountKey = account.key || account.address.trim().toLowerCase();
    const activeWalletKey = walletAddress.trim().toLowerCase();
    if (accountKey === activeWalletKey) {
      return getMemoSigner();
    }

    const ownerKey = ownerWalletAddress.trim().toLowerCase();
    if (account.role !== 'owner' || !ownerKey || accountKey !== ownerKey) {
      return getMemoSigner();
    }

    const provider = browserWalletProvider ?? getConnectedProvider();
    if (!provider) {
      throw new Error('Owner wallet is not connected.');
    }
    if (chainId !== COTI_NETWORK.chainIdDecimal) {
      throw new Error('Switch to COTI network first.');
    }

    const cachedOnboardInfo = sessionOnboardInfo[ownerKey];
    if (!cachedOnboardInfo?.aesKey) {
      throw new Error('Owner privacy is locked.');
    }

    let signer = signerCacheRef.current[ownerKey] as JsonRpcSigner | undefined;
    if (signer && signerProviderCacheRef.current[ownerKey] !== provider) {
      delete signerCacheRef.current[ownerKey];
      delete signerProviderCacheRef.current[ownerKey];
      signer = undefined;
    }
    if (!signer) {
      const browserProvider = await createCotiBrowserProvider(provider);
      signer = await browserProvider.getSigner(ownerWalletAddress, cachedOnboardInfo);
      signer.disableAutoOnboard();
      signerCacheRef.current[ownerKey] = signer;
      signerProviderCacheRef.current[ownerKey] = provider;
    } else {
      signer.setUserOnboardInfo(cachedOnboardInfo);
    }

    signer.disableAutoOnboard();
    if (!signer.getUserOnboardInfo()?.aesKey) {
      throw new Error('Owner privacy is locked.');
    }

    return { signer, cacheKey: ownerKey };
  }, [
    browserWalletProvider,
    chainId,
    getConnectedProvider,
    getMemoSigner,
    ownerWalletAddress,
    sessionOnboardInfo,
    signerCacheRef,
    signerProviderCacheRef,
    walletAddress
  ]);

  const encodeMemoForActiveSigner = useCallback(
    (plain: string): string =>
      activeSignerSource === 'metamask' ? encodeCompactMemoPlaintext(plain) : encodeMemoPlaintext(plain),
    [activeSignerSource]
  );

  const decodeDecryptedMemoPlaintext = useCallback((decrypted: string | bigint): string => {
    const raw = typeof decrypted === 'string' ? decrypted : decrypted.toString();
    const plain = decodeMemoPlaintextStrict(raw);
    if (plain === null) {
      throw new Error('Decrypted memo is not a valid ChainWhisper payload.');
    }
    return plain;
  }, []);

  const tryRecoverRegisteredMemoAes = useCallback(
    async (
      signer: Wallet | JsonRpcSigner,
      cacheKey: string,
      previousError: unknown
    ): Promise<boolean> => {
      if (activeSignerSource !== 'metamask' || memoAesRecoveryAttemptedRef.current[cacheKey]) {
        return false;
      }

      memoAesRecoveryAttemptedRef.current[cacheKey] = true;
      void signer;
      const currentHealth = walletAesHealthByAddress[cacheKey]?.status;
      const message =
        previousError instanceof Error
          ? previousError.message
          : 'The privacy key did not decrypt existing wallet data.';
      if (currentHealth !== 'ready') {
        setWalletAesHealth(cacheKey, buildWalletAesHealthState({
          message,
          status: 'repair-needed',
          walletAddress: cacheKey
        }));
        setOnboardStatus('Privacy key needs refresh');
      } else {
        setOnboardStatus('Privacy ready');
      }
      return false;
    },
    [
      activeSignerSource,
      memoAesRecoveryAttemptedRef,
      setOnboardStatus,
      setWalletAesHealth,
      walletAesHealthByAddress
    ]
  );

  const decryptMemoPlaintextWithRecovery = useCallback(
    async (
      signer: Wallet | JsonRpcSigner,
      cacheKey: string,
      ciphertext: unknown
    ): Promise<string> => {
      try {
        const decrypted = await signer.decryptValue(ciphertext as never);
        const plain = decodeDecryptedMemoPlaintext(decrypted);
        setWalletAesHealth(cacheKey, buildWalletAesHealthState({
          status: 'ready',
          walletAddress: cacheKey
        }));
        return plain;
      } catch (firstError) {
        const recovered = await tryRecoverRegisteredMemoAes(signer, cacheKey, firstError);
        if (!recovered) {
          throw firstError;
        }

        const decrypted = await signer.decryptValue(ciphertext as never);
        const plain = decodeDecryptedMemoPlaintext(decrypted);
        setWalletAesHealth(cacheKey, buildWalletAesHealthState({
          status: 'ready',
          walletAddress: cacheKey
        }));
        return plain;
      }
    },
    [decodeDecryptedMemoPlaintext, setWalletAesHealth, tryRecoverRegisteredMemoAes]
  );

  const parseEncryptedChatMessagePayload = useCallback(
    async (
      signer: Wallet | JsonRpcSigner,
      cacheKey: string,
      ciphertext: unknown
    ): Promise<ReturnType<typeof parseChatMessagePayload>> => {
      const plain = await decryptMemoPlaintextWithRecovery(signer, cacheKey, ciphertext);
      return parseChatMessagePayload(plain);
    },
    [decryptMemoPlaintextWithRecovery]
  );

  getMemoSignerRef.current = getMemoSigner;
  encodeMemoForActiveSignerRef.current = encodeMemoForActiveSigner;

  return {
    decryptMemoPlaintextWithRecovery,
    encodeMemoForActiveSigner,
    getMemoSigner,
    getMemoSignerForAccount,
    parseEncryptedChatMessagePayload
  };
}
