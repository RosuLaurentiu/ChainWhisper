import { lazy, Suspense } from 'react';
import { BURNER_PIN_MIN_LENGTH, type BurnerPinMode } from '../../../lib/appShared';
import type {
  AccountFundsAssetOption,
  AccountFundsDirection,
  AccountFundsSubmitRequest
} from './AccountFundsModal';
import type { RecoverySavePromptState } from '../hooks/useBurnerWallet';

const BurnerBackupModal = lazy(() => import('./BurnerBackupModal'));
const AccountFundsModal = lazy(() => import('./AccountFundsModal'));
const BurnerImportModal = lazy(() => import('./BurnerImportModal'));
const BurnerPinModal = lazy(() => import('./BurnerPinModal'));
const RecoverySaveConfirmModal = lazy(() => import('./RecoverySaveConfirmModal'));
const TopUpModal = lazy(() => import('./TopUpModal'));

type WalletSessionModalsProps = {
  accountFundsAssets: AccountFundsAssetOption[];
  accountFundsDirection: AccountFundsDirection | null;
  accountFundsProcessing: boolean;
  burnerAddress: string;
  burnerBalanceWei: bigint | null;
  burnerImportInput: string;
  burnerMnemonicBackup: string;
  burnerPinInput: string;
  burnerPinMode: BurnerPinMode;
  closeAccountFundsModal: () => void;
  closeBurnerBackup: () => void;
  closeBurnerPinModal: () => void;
  confirmRecoverySavePrompt: () => void;
  cancelRecoverySavePrompt: () => void;
  error: string;
  estimatedMessagesLeft: bigint | null;
  importBurnerWallet: () => Promise<void>;
  initializingBurner: boolean;
  loadingTopUpQuote: boolean;
  ownerWalletAddress: string;
  recoverySavePrompt: RecoverySavePromptState | null;
  setBurnerImportInput: (value: string) => void;
  setBurnerPinInput: (value: string) => void;
  setRecoverySavePromptMakeDefault: (makeDefault: boolean) => void;
  setShowBurnerImportModal: (value: boolean) => void;
  setShowTopUpModal: (value: boolean) => void;
  showBurnerImportModal: boolean;
  showBurnerMnemonic: boolean;
  showBurnerPinModal: boolean;
  showTopUpModal: boolean;
  submitAccountFundsTransfer: (request: AccountFundsSubmitRequest) => Promise<void>;
  submitBurnerPinAndInitialize: () => Promise<void>;
  topUpAmountLabel: string;
  topUpAmountWei: bigint | null;
  topUpBurnerWithWallet: () => Promise<void>;
  topUpMessageTarget: number;
  setTopUpMessageTarget: (value: number) => void;
};

export default function WalletSessionModals({
  accountFundsAssets,
  accountFundsDirection,
  accountFundsProcessing,
  burnerAddress,
  burnerBalanceWei,
  burnerImportInput,
  burnerMnemonicBackup,
  burnerPinInput,
  burnerPinMode,
  cancelRecoverySavePrompt,
  closeAccountFundsModal,
  closeBurnerBackup,
  closeBurnerPinModal,
  confirmRecoverySavePrompt,
  error,
  estimatedMessagesLeft,
  importBurnerWallet,
  initializingBurner,
  loadingTopUpQuote,
  ownerWalletAddress,
  recoverySavePrompt,
  setBurnerImportInput,
  setBurnerPinInput,
  setRecoverySavePromptMakeDefault,
  setShowBurnerImportModal,
  setShowTopUpModal,
  showBurnerImportModal,
  showBurnerMnemonic,
  showBurnerPinModal,
  showTopUpModal,
  submitAccountFundsTransfer,
  submitBurnerPinAndInitialize,
  topUpAmountLabel,
  topUpAmountWei,
  topUpBurnerWithWallet,
  topUpMessageTarget,
  setTopUpMessageTarget
}: WalletSessionModalsProps) {
  return (
    <>
      {showBurnerImportModal ? (
        <Suspense fallback={null}>
          <BurnerImportModal
            isOpen={showBurnerImportModal}
            initializingBurner={initializingBurner}
            burnerImportInput={burnerImportInput}
            onBurnerImportInputChange={setBurnerImportInput}
            error={error}
            onClose={() => setShowBurnerImportModal(false)}
            onImport={importBurnerWallet}
          />
        </Suspense>
      ) : null}

      {showBurnerPinModal ? (
        <Suspense fallback={null}>
          <BurnerPinModal
            isOpen={showBurnerPinModal}
            burnerPinMode={burnerPinMode}
            burnerPinInput={burnerPinInput}
            onBurnerPinInputChange={setBurnerPinInput}
            pinMinLength={BURNER_PIN_MIN_LENGTH}
            error={error}
            initializingBurner={initializingBurner}
            onClose={closeBurnerPinModal}
            onSubmit={submitBurnerPinAndInitialize}
          />
        </Suspense>
      ) : null}

      {showBurnerMnemonic && burnerMnemonicBackup ? (
        <Suspense fallback={null}>
          <BurnerBackupModal isOpen={showBurnerMnemonic} mnemonic={burnerMnemonicBackup} onClose={closeBurnerBackup} />
        </Suspense>
      ) : null}

      {recoverySavePrompt ? (
        <Suspense fallback={null}>
          <RecoverySaveConfirmModal
            isOpen={Boolean(recoverySavePrompt)}
            estimate={recoverySavePrompt.estimate}
            makeDefault={recoverySavePrompt.makeDefault}
            message={recoverySavePrompt.message}
            onCancel={cancelRecoverySavePrompt}
            onConfirm={confirmRecoverySavePrompt}
            onMakeDefaultChange={setRecoverySavePromptMakeDefault}
          />
        </Suspense>
      ) : null}

      {accountFundsDirection ? (
        <Suspense fallback={null}>
          <AccountFundsModal
            assets={accountFundsAssets}
            chainwhisperAddress={burnerAddress}
            initialDirection={accountFundsDirection}
            isOpen={Boolean(accountFundsDirection)}
            ownerAddress={ownerWalletAddress}
            processing={accountFundsProcessing}
            onClose={closeAccountFundsModal}
            onSubmit={submitAccountFundsTransfer}
          />
        </Suspense>
      ) : null}

      {showTopUpModal ? (
        <Suspense fallback={null}>
          <TopUpModal
            isOpen={showTopUpModal}
            initializingBurner={initializingBurner}
            loadingTopUpQuote={loadingTopUpQuote}
            burnerAddress={burnerAddress}
            topUpAmountWei={topUpAmountWei}
            topUpMessageTarget={topUpMessageTarget}
            onTopUpMessageTargetChange={setTopUpMessageTarget}
            burnerBalanceWei={burnerBalanceWei}
            estimatedMessagesLeft={estimatedMessagesLeft}
            topUpAmountLabel={topUpAmountLabel}
            onTopUpBurnerWithWallet={topUpBurnerWithWallet}
            onClose={() => setShowTopUpModal(false)}
          />
        </Suspense>
      ) : null}
    </>
  );
}
