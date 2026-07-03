import type { OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  BURNER_PIN_MIN_LENGTH,
  COTI_NETWORK,
  getProviderErrorMessage,
  hasInsufficientFundsError,
  loadBurnerWalletVaultFromStorage,
  loadCotiEthersModule,
  parseBurnerWalletStorageState,
  type BurnerPinMode,
  type BurnerWalletRecord
} from '../../../lib/appShared';
import { saveWalletPreference } from '../../../lib/appStorage';
import {
  buildNewBurnerWalletRecord,
  saveBurnerWalletRecordWithPin,
  selectBurnerWalletFromVault
} from '../../../lib/burnerWalletVault';
import {
  mergeOnboardInfoByAddress,
  type PendingBurnerWalletAction,
  type TradeSigner
} from '../components/P2PTradingPage.helpers';

type UseP2PBurnerWalletConnectionParams = {
  burnerImportInput: string;
  burnerPinInput: string;
  burnerPinRef: MutableRefObject<string>;
  burnerWalletRef: MutableRefObject<Wallet | null>;
  effectiveOnboardInfoByAddress: Record<string, OnboardInfo>;
  markSharedWalletSkippedAfterLocalAppSwitch: (walletKey: string) => void;
  pendingBurnerAction: PendingBurnerWalletAction;
  pendingBurnerWalletId: string;
  setBurnerPinInput: Dispatch<SetStateAction<string>>;
  setBurnerPinMode: Dispatch<SetStateAction<BurnerPinMode>>;
  setBurnerWallets: Dispatch<SetStateAction<BurnerWalletRecord[]>>;
  setChainId: Dispatch<SetStateAction<number | null>>;
  setConnectedWalletLabel: Dispatch<SetStateAction<string>>;
  setConnectingWalletId: Dispatch<SetStateAction<string>>;
  setOnboardInfoByAddress: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  setPendingBurnerAction: Dispatch<SetStateAction<PendingBurnerWalletAction>>;
  setPendingBurnerWalletId: Dispatch<SetStateAction<string>>;
  setSelectedBurnerWalletId: Dispatch<SetStateAction<string>>;
  setSelectedWalletId: Dispatch<SetStateAction<string>>;
  setShowBurnerImportModal: Dispatch<SetStateAction<boolean>>;
  setShowBurnerPinModal: Dispatch<SetStateAction<boolean>>;
  setTradeActionError: Dispatch<SetStateAction<string>>;
  setUnlockingBurner: Dispatch<SetStateAction<boolean>>;
  setWalletAddress: Dispatch<SetStateAction<string>>;
  setWalletError: Dispatch<SetStateAction<string>>;
  signerCacheRef: MutableRefObject<Record<string, TradeSigner>>;
  unlockingBurner: boolean;
};

export default function useP2PBurnerWalletConnection({
  burnerImportInput,
  burnerPinInput,
  burnerPinRef,
  burnerWalletRef,
  effectiveOnboardInfoByAddress,
  markSharedWalletSkippedAfterLocalAppSwitch,
  pendingBurnerAction,
  pendingBurnerWalletId,
  setBurnerPinInput,
  setBurnerPinMode,
  setBurnerWallets,
  setChainId,
  setConnectedWalletLabel,
  setConnectingWalletId,
  setOnboardInfoByAddress,
  setPendingBurnerAction,
  setPendingBurnerWalletId,
  setSelectedBurnerWalletId,
  setSelectedWalletId,
  setShowBurnerImportModal,
  setShowBurnerPinModal,
  setTradeActionError,
  setUnlockingBurner,
  setWalletAddress,
  setWalletError,
  signerCacheRef,
  unlockingBurner
}: UseP2PBurnerWalletConnectionParams) {
  const syncVisibleBurnerWallets = useCallback(() => {
    const storageState = parseBurnerWalletStorageState();
    if (storageState.kind === 'legacy') {
      setBurnerWallets([storageState.record]);
      return;
    }
    if (storageState.kind === 'legacy-vault') {
      setBurnerWallets(storageState.record.wallets);
      setSelectedBurnerWalletId('');
      return;
    }
    if (storageState.kind === 'none') {
      setBurnerWallets([]);
      setSelectedBurnerWalletId('');
    }
  }, [setBurnerWallets, setSelectedBurnerWalletId]);

  useEffect(() => {
    syncVisibleBurnerWallets();
    const handleFocus = () => syncVisibleBurnerWallets();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [syncVisibleBurnerWallets]);

  const chooseBurnerPinMode = useCallback((): BurnerPinMode => {
    const storageState = parseBurnerWalletStorageState();
    return storageState.kind === 'encrypted' ? 'unlock' : 'set';
  }, []);

  const unlockBurnerWalletWithPin = useCallback(
    async (walletId?: string, pin = '') => {
      setWalletError('');
      setTradeActionError('');
      setConnectingWalletId('burner');
      setUnlockingBurner(true);

      try {
        const vault = await loadBurnerWalletVaultFromStorage(pin);
        const selectedRecord = selectBurnerWalletFromVault(vault, walletId);
        if (!selectedRecord) {
          throw new Error('No saved ChainWhisper account found.');
        }
        if (pin.trim().length >= BURNER_PIN_MIN_LENGTH) {
          burnerPinRef.current = pin.trim();
        }

        const cotiEthers = await loadCotiEthersModule();
        const rpcProvider = new cotiEthers.JsonRpcProvider(COTI_NETWORK.rpcUrl, {
          name: COTI_NETWORK.chainName,
          chainId: COTI_NETWORK.chainIdDecimal
        });
        const signer = new cotiEthers.Wallet(selectedRecord.privateKey, rpcProvider);
        const cacheKey = signer.address.toLowerCase();
        const cachedOnboardInfo = effectiveOnboardInfoByAddress[cacheKey];
        if (cachedOnboardInfo) {
          signer.setUserOnboardInfo(cachedOnboardInfo);
        }

        burnerWalletRef.current = signer;
        signerCacheRef.current[cacheKey] = signer;
        markSharedWalletSkippedAfterLocalAppSwitch(cacheKey);
        setBurnerWallets(vault.wallets);
        setSelectedBurnerWalletId(selectedRecord.id ?? '');
        setWalletAddress(signer.address);
        setConnectedWalletLabel('ChainWhisper account');
        setSelectedWalletId('');
        setChainId(COTI_NETWORK.chainIdDecimal);
        setShowBurnerPinModal(false);
        setPendingBurnerWalletId('');
        setBurnerPinInput('');
        saveWalletPreference({ kind: 'app' });

        signer.disableAutoOnboard();
        let onboardInfo = signer.getUserOnboardInfo();
        if (!onboardInfo?.aesKey) {
          const appWalletBalance = await rpcProvider.getBalance(signer.address).catch(() => null);
          if (appWalletBalance !== null && appWalletBalance <= 0n) {
            setWalletError('ChainWhisper account selected. Fund it with COTI to unlock privacy and pay gas.');
            return;
          }

          try {
            await signer.generateOrRecoverAes();
          } catch (aesError) {
            const message = aesError instanceof Error ? aesError.message : String(aesError);
            if (hasInsufficientFundsError(message)) {
              setWalletError('ChainWhisper account selected. Fund it with COTI to unlock privacy and pay gas.');
              return;
            }
            throw aesError;
          }
          onboardInfo = signer.getUserOnboardInfo();
        }
        if (!onboardInfo?.aesKey) {
          throw new Error('Privacy unlock was not returned for the ChainWhisper account.');
        }

        setOnboardInfoByAddress((previous) =>
          mergeOnboardInfoByAddress(previous, cacheKey, onboardInfo)
        );
      } catch (error) {
        setWalletError(getProviderErrorMessage(error, 'Failed to connect app wallet.'));
      } finally {
        setUnlockingBurner(false);
        setConnectingWalletId('');
      }
    },
    [
      burnerPinRef,
      burnerWalletRef,
      effectiveOnboardInfoByAddress,
      markSharedWalletSkippedAfterLocalAppSwitch,
      setBurnerPinInput,
      setBurnerWallets,
      setChainId,
      setConnectedWalletLabel,
      setConnectingWalletId,
      setOnboardInfoByAddress,
      setPendingBurnerWalletId,
      setSelectedBurnerWalletId,
      setSelectedWalletId,
      setShowBurnerPinModal,
      setTradeActionError,
      setUnlockingBurner,
      setWalletAddress,
      setWalletError,
      signerCacheRef
    ]
  );

  const submitBurnerImport = useCallback(async () => {
    setWalletError('');
    setPendingBurnerAction('import');
    setPendingBurnerWalletId('');
    setBurnerPinMode(chooseBurnerPinMode());
    setBurnerPinInput('');
    setShowBurnerImportModal(false);
    setShowBurnerPinModal(true);
  }, [
    chooseBurnerPinMode,
    setBurnerPinInput,
    setBurnerPinMode,
    setPendingBurnerAction,
    setPendingBurnerWalletId,
    setShowBurnerImportModal,
    setShowBurnerPinModal,
    setWalletError
  ]);

  const closeBurnerPinModal = useCallback(() => {
    if (unlockingBurner) {
      return;
    }
    setShowBurnerPinModal(false);
    setPendingBurnerAction('connect');
    setPendingBurnerWalletId('');
    setBurnerPinInput('');
  }, [
    setBurnerPinInput,
    setPendingBurnerAction,
    setPendingBurnerWalletId,
    setShowBurnerPinModal,
    unlockingBurner
  ]);

  const submitBurnerPin = useCallback(async () => {
    const pin = burnerPinInput.trim();
    if (pin.length < BURNER_PIN_MIN_LENGTH) {
      setWalletError(`PIN must be at least ${BURNER_PIN_MIN_LENGTH} digits.`);
      return;
    }

    if (pendingBurnerAction === 'connect') {
      await unlockBurnerWalletWithPin(pendingBurnerWalletId || undefined, pin);
      return;
    }

    setUnlockingBurner(true);
    setConnectingWalletId('burner');
    try {
      const record = await buildNewBurnerWalletRecord(
        pendingBurnerAction === 'generate' ? 'generate' : 'import',
        burnerImportInput
      );
      const vault = await saveBurnerWalletRecordWithPin(record, pin);
      await unlockBurnerWalletWithPin(vault.activeWalletId, pin);
      setShowBurnerImportModal(false);
      setPendingBurnerAction('connect');
    } catch (error) {
      setWalletError(getProviderErrorMessage(error, 'Failed to save app wallet.'));
    } finally {
      setUnlockingBurner(false);
      setConnectingWalletId('');
    }
  }, [
    burnerImportInput,
    burnerPinInput,
    pendingBurnerAction,
    pendingBurnerWalletId,
    setConnectingWalletId,
    setPendingBurnerAction,
    setShowBurnerImportModal,
    setUnlockingBurner,
    setWalletError,
    unlockBurnerWalletWithPin
  ]);

  return {
    closeBurnerPinModal,
    submitBurnerImport,
    submitBurnerPin
  };
}
