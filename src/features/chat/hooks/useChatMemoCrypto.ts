import type { JsonRpcSigner } from '@coti-io/coti-ethers';
import { useCallback, type MutableRefObject } from 'react';
import {
  CHAT_MEMO_SECURITY_LIMITS,
  decodeMemoPlaintextStrict,
  decryptMemoWithCellLimit,
  encodeCompactMemoPlaintext,
  getProviderErrorMessage,
  isWalletAddress,
  parseChatMessagePayload,
  MemoCiphertextLimitError,
  type MemoSecurityLimits
} from '../../../lib/appShared';
import {
  buildWalletAesHealthState,
  type WalletAesHealthState
} from '../../../lib/cotiAesUnlock';
import {
  assertWalletReadSignerMatchesAccount,
  resolveWalletReadSignerRoute,
  type WalletReadAccount
} from '../../../lib/walletAccountScope';

type MemoSignerBundle = {
  signer: JsonRpcSigner;
  cacheKey: string;
};

type UseChatMemoCryptoArgs = {
  encodeMemoForActiveSignerRef: MutableRefObject<(plain: string) => string>;
  getMemoSignerRef: MutableRefObject<() => Promise<MemoSignerBundle>>;
  getOwnerReadSigner: (requirePrivacy: boolean) => Promise<JsonRpcSigner>;
  memoAesRecoveryAttemptedRef: MutableRefObject<Record<string, boolean>>;
  ownerWalletAddress: string;
  setOnboardStatus: (status: string) => void;
  setWalletAesHealth: (address: string, health: WalletAesHealthState) => void;
  walletAesHealthByAddress: Record<string, WalletAesHealthState>;
};

export default function useChatMemoCrypto({
  encodeMemoForActiveSignerRef,
  getMemoSignerRef,
  getOwnerReadSigner,
  memoAesRecoveryAttemptedRef,
  ownerWalletAddress,
  setOnboardStatus,
  setWalletAesHealth,
  walletAesHealthByAddress
}: UseChatMemoCryptoArgs) {
  const getMemoSigner = useCallback(async (): Promise<MemoSignerBundle> => {
    const signer = await getOwnerReadSigner(true);
    const cacheKey = signer.address.toLowerCase();
    return { signer, cacheKey };
  }, [getOwnerReadSigner]);

  const getMemoSignerForAccount = useCallback(async (account: WalletReadAccount): Promise<MemoSignerBundle> => {
    resolveWalletReadSignerRoute({
      account,
      ownerAddress: ownerWalletAddress
    });
    const bundle = {
      signer: await getOwnerReadSigner(true),
      cacheKey: account.key.toLowerCase()
    };
    assertWalletReadSignerMatchesAccount(account, bundle.signer.address);
    const accountKey = account.key.trim().toLowerCase();
    if (!isWalletAddress(bundle.cacheKey) || bundle.cacheKey.trim().toLowerCase() !== accountKey) {
      throw new Error('The wallet signer cache scope changed. Refresh the wallet session and try again.');
    }
    return { ...bundle, cacheKey: accountKey };
  }, [
    getOwnerReadSigner,
    ownerWalletAddress
  ]);

  const encodeMemoForActiveSigner = useCallback(
    (plain: string): string => encodeCompactMemoPlaintext(plain),
    []
  );

  const decodeDecryptedMemoPlaintext = useCallback((
    decrypted: string | bigint,
    maxPlaintextBytes = CHAT_MEMO_SECURITY_LIMITS.maxPlaintextBytes
  ): string => {
    const raw = typeof decrypted === 'string' ? decrypted : decrypted.toString();
    const plain = decodeMemoPlaintextStrict(raw, maxPlaintextBytes);
    if (plain === null) {
      throw new Error('Decrypted memo is not a valid ChainWhisper payload.');
    }
    return plain;
  }, []);

  const tryRecoverRegisteredMemoAes = useCallback(
    async (
      signer: JsonRpcSigner,
      cacheKey: string,
      previousError: unknown,
      shouldCommit: () => boolean
    ): Promise<boolean> => {
      if (!shouldCommit() || memoAesRecoveryAttemptedRef.current[cacheKey]) {
        return false;
      }

      memoAesRecoveryAttemptedRef.current[cacheKey] = true;
      void signer;
      const currentHealth = walletAesHealthByAddress[cacheKey]?.status;
      const message = getProviderErrorMessage(
        previousError,
        'The privacy key did not decrypt existing wallet data.'
      );
      if (!shouldCommit()) {
        return false;
      }
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
      memoAesRecoveryAttemptedRef,
      setOnboardStatus,
      setWalletAesHealth,
      walletAesHealthByAddress
    ]
  );

  const decryptMemoPlaintextWithRecovery = useCallback(
    async (
      signer: JsonRpcSigner,
      cacheKey: string,
      ciphertext: unknown,
      limits: MemoSecurityLimits = CHAT_MEMO_SECURITY_LIMITS,
      shouldCommit: () => boolean = () => true
    ): Promise<string> => {
      try {
        const decrypted = await decryptMemoWithCellLimit(
          ciphertext,
          limits.maxCiphertextCells,
          () => signer.decryptValue(ciphertext as never)
        );
        const plain = decodeDecryptedMemoPlaintext(decrypted, limits.maxPlaintextBytes);
        if (shouldCommit()) {
          setWalletAesHealth(cacheKey, buildWalletAesHealthState({
            status: 'ready',
            walletAddress: cacheKey
          }));
        }
        return plain;
      } catch (firstError) {
        if (firstError instanceof MemoCiphertextLimitError) {
          throw firstError;
        }
        const recovered = await tryRecoverRegisteredMemoAes(signer, cacheKey, firstError, shouldCommit);
        if (!recovered) {
          throw firstError;
        }

        const decrypted = await decryptMemoWithCellLimit(
          ciphertext,
          limits.maxCiphertextCells,
          () => signer.decryptValue(ciphertext as never)
        );
        const plain = decodeDecryptedMemoPlaintext(decrypted, limits.maxPlaintextBytes);
        if (shouldCommit()) {
          setWalletAesHealth(cacheKey, buildWalletAesHealthState({
            status: 'ready',
            walletAddress: cacheKey
          }));
        }
        return plain;
      }
    },
    [decodeDecryptedMemoPlaintext, setWalletAesHealth, tryRecoverRegisteredMemoAes]
  );

  const parseEncryptedChatMessagePayload = useCallback(
    async (
      signer: JsonRpcSigner,
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
