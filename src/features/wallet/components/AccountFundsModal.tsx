import { useEffect, useMemo, useRef, useState } from 'react';
import { useModalA11y } from '../../../shared/hooks/useModalA11y';
import {
  formatTokenAmount,
  parseTokenAmountInput
} from '../../../lib/appShared';
import {
  estimateWalletFundingPromptCount,
  formatWalletFundAmount,
  type WalletFundAsset
} from '../../../lib/walletFunds';

export type AccountFundsDirection = 'move' | 'withdraw';

export type AccountFundsAssetOption = {
  id: string;
  asset: WalletFundAsset;
  chainwhisperBalanceWei: bigint | null;
  ownerBalanceWei: bigint | null;
  chainwhisperPrivacyRequired?: boolean;
  ownerPrivacyRequired?: boolean;
};

export type AccountFundsSubmitRequest = {
  amountWei: bigint;
  asset: WalletFundAsset;
  direction: AccountFundsDirection;
};

type AccountFundsTokenScope = 'public' | 'private';

type AccountFundsModalProps = {
  assets: AccountFundsAssetOption[];
  chainwhisperAddress: string;
  initialDirection?: AccountFundsDirection;
  isOpen: boolean;
  ownerAddress: string;
  processing: boolean;
  onClose: () => void;
  onSubmit: (request: AccountFundsSubmitRequest) => Promise<void>;
};

const directionCopy = {
  move: {
    availableLabel: 'Available to move',
    detail: 'Move funds from the owner wallet into ChainWhisper.',
    empty: 'No available tokens in the owner wallet.',
    label: 'Move to ChainWhisper',
    locked: 'Unlock privacy to reveal private owner-wallet tokens.',
    sourceLabel: 'Owner wallet',
    submit: 'Move',
    targetLabel: 'ChainWhisper'
  },
  withdraw: {
    availableLabel: 'Available to withdraw',
    detail: 'Withdraw funds from ChainWhisper to the owner wallet.',
    empty: 'No available tokens in ChainWhisper.',
    label: 'Withdraw to owner',
    locked: 'Unlock privacy to reveal private ChainWhisper tokens.',
    sourceLabel: 'ChainWhisper',
    submit: 'Withdraw',
    targetLabel: 'Owner wallet'
  }
} as const;

const formatBalance = (balanceWei: bigint | null, asset: WalletFundAsset, decimals = 4): string =>
  balanceWei === null ? '--' : formatWalletFundAmount(balanceWei, asset, decimals);

const getSourceBalance = (option: AccountFundsAssetOption, direction: AccountFundsDirection): bigint | null =>
  direction === 'move' ? option.ownerBalanceWei : option.chainwhisperBalanceWei;

const getSourceLocked = (option: AccountFundsAssetOption, direction: AccountFundsDirection): boolean =>
  direction === 'move' ? Boolean(option.ownerPrivacyRequired) : Boolean(option.chainwhisperPrivacyRequired);

const getAssetScope = (asset: WalletFundAsset): AccountFundsTokenScope =>
  asset.kind === 'private-erc20' ? 'private' : 'public';

const getAssetKindPill = (asset: WalletFundAsset): string => {
  if (asset.kind === 'native') {
    return 'Native';
  }
  return asset.kind === 'private-erc20' ? 'Private' : 'Public';
};

const shortenTokenAddress = (address?: string): string => {
  const trimmed = address?.trim() ?? '';
  if (!trimmed) {
    return '';
  }
  return trimmed.length <= 14 ? trimmed : `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
};

const getAssetMetaLabel = (asset: WalletFundAsset): string =>
  asset.kind === 'native' ? 'COTI Mainnet native asset' : `CA ${shortenTokenAddress(asset.tokenAddress) || '--'}`;

export default function AccountFundsModal({
  assets,
  chainwhisperAddress,
  initialDirection = 'move',
  isOpen,
  ownerAddress,
  processing,
  onClose,
  onSubmit
}: AccountFundsModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [direction, setDirection] = useState<AccountFundsDirection>(initialDirection);
  const [activeScope, setActiveScope] = useState<AccountFundsTokenScope>('public');
  const [localError, setLocalError] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState('');
  useModalA11y({ closeDisabled: processing, dialogRef, isOpen, onClose });

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setAmountInput('');
    setDirection(initialDirection);
    setActiveScope('public');
    setLocalError('');
  }, [initialDirection, isOpen]);

  const visibleAssets = useMemo(
    () =>
      assets.filter((asset) => {
        if (getSourceLocked(asset, direction)) {
          return false;
        }
        const sourceBalance = getSourceBalance(asset, direction);
        return sourceBalance !== null && sourceBalance > 0n;
      }),
    [assets, direction]
  );

  const hasLockedSourceAssets = useMemo(
    () => assets.some((asset) => getSourceLocked(asset, direction)),
    [assets, direction]
  );
  const publicAssets = useMemo(
    () => visibleAssets.filter((asset) => getAssetScope(asset.asset) === 'public'),
    [visibleAssets]
  );
  const privateAssets = useMemo(
    () => visibleAssets.filter((asset) => getAssetScope(asset.asset) === 'private'),
    [visibleAssets]
  );
  const publicAssetCount = publicAssets.length;
  const privateAssetCount = privateAssets.length;
  const scopedAssets = activeScope === 'private' ? privateAssets : publicAssets;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setActiveScope((previous) => {
      if (previous === 'public' && publicAssetCount > 0) {
        return previous;
      }
      if (previous === 'private' && privateAssetCount > 0) {
        return previous;
      }
      return publicAssetCount > 0 ? 'public' : 'private';
    });
  }, [isOpen, privateAssetCount, publicAssetCount]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setSelectedAssetId((previous) => {
      if (previous && scopedAssets.some((asset) => asset.id === previous)) {
        return previous;
      }
      return scopedAssets[0]?.id ?? '';
    });
  }, [isOpen, scopedAssets]);

  const selectedAsset = useMemo(
    () => scopedAssets.find((asset) => asset.id === selectedAssetId) ?? scopedAssets[0] ?? null,
    [scopedAssets, selectedAssetId]
  );
  const parsedAmountWei = useMemo(
    () => (selectedAsset ? parseTokenAmountInput(amountInput, selectedAsset.asset.decimals) : null),
    [amountInput, selectedAsset]
  );
  const sourceBalanceWei = selectedAsset ? getSourceBalance(selectedAsset, direction) : null;
  const sourceLocked = selectedAsset ? getSourceLocked(selectedAsset, direction) : false;
  const estimatedPrompts =
    selectedAsset && parsedAmountWei !== null && parsedAmountWei > 0n
      ? estimateWalletFundingPromptCount([{ asset: selectedAsset.asset, amountWei: parsedAmountWei }])
      : selectedAsset?.asset.kind === 'private-erc20'
        ? 2
        : 1;
  const canSubmit =
    Boolean(ownerAddress) &&
    Boolean(chainwhisperAddress) &&
    Boolean(selectedAsset) &&
    !sourceLocked &&
    parsedAmountWei !== null &&
    parsedAmountWei > 0n &&
    sourceBalanceWei !== null &&
    parsedAmountWei <= sourceBalanceWei;

  if (!isOpen) {
    return null;
  }

  const copy = directionCopy[direction];
  const submitLabel = selectedAsset ? `${copy.submit} ${selectedAsset.asset.symbol}` : `${copy.submit} funds`;

  const setMaxAmount = () => {
    if (!selectedAsset || sourceBalanceWei === null || sourceLocked) {
      return;
    }
    setAmountInput(formatTokenAmount(sourceBalanceWei, selectedAsset.asset.decimals, 8));
    setLocalError('');
  };

  const submit = () => {
    if (!selectedAsset) {
      setLocalError(copy.empty);
      return;
    }
    if (sourceLocked) {
      setLocalError(
        direction === 'move'
          ? 'Unlock owner privacy to move this private token.'
          : 'Unlock ChainWhisper privacy to withdraw this private token.'
      );
      return;
    }
    if (parsedAmountWei === null || parsedAmountWei <= 0n) {
      setLocalError('Enter an amount greater than zero.');
      return;
    }
    if (sourceBalanceWei === null) {
      setLocalError(`${copy.sourceLabel} balance is not loaded yet.`);
      return;
    }
    if (parsedAmountWei > sourceBalanceWei) {
      setLocalError(`Amount is higher than the ${copy.sourceLabel.toLowerCase()} balance.`);
      return;
    }
    setLocalError('');
    onSubmit({ amountWei: parsedAmountWei, asset: selectedAsset.asset, direction }).catch((submitError) => {
      setLocalError(submitError instanceof Error ? submitError.message : `${submitLabel} failed.`);
    });
  };

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!processing) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        className="modal-card account-funds-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-funds-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="account-funds-title">Funds</h3>
        <p>{copy.detail}</p>

        <div className="account-funds-direction" role="tablist" aria-label="Funds direction">
          {(['move', 'withdraw'] as const).map((nextDirection) => (
            <button
              key={nextDirection}
              type="button"
              className={direction === nextDirection ? 'active' : undefined}
              onClick={() => {
                setDirection(nextDirection);
                setAmountInput('');
                setLocalError('');
              }}
              disabled={processing}
              role="tab"
              aria-selected={direction === nextDirection}
            >
              {directionCopy[nextDirection].label}
            </button>
          ))}
        </div>

        <div className="account-funds-token-picker">
          <div className="account-funds-token-tabs" role="tablist" aria-label="Token type">
            {(['public', 'private'] as const).map((scope) => {
              const count = scope === 'public' ? publicAssetCount : privateAssetCount;
              return (
                <button
                  key={scope}
                  type="button"
                  className={activeScope === scope ? 'active' : undefined}
                  onClick={() => {
                    setActiveScope(scope);
                    setAmountInput('');
                    setLocalError('');
                  }}
                  disabled={processing || count === 0}
                  role="tab"
                  aria-selected={activeScope === scope}
                >
                  {scope === 'public' ? 'Public' : 'Private'} <span>{count}</span>
                </button>
              );
            })}
          </div>

          {scopedAssets.length > 0 ? (
            <>
              <div className="account-funds-token-list-head">
                <span>Token</span>
                <span>{copy.availableLabel}</span>
              </div>
              <ul className="account-funds-token-list" role="listbox" aria-label="Available tokens">
                {scopedAssets.map((option) => {
                  const optionSourceBalance = getSourceBalance(option, direction);
                  const selected = selectedAsset?.id === option.id;
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={selected ? 'account-funds-token-row active' : 'account-funds-token-row'}
                        onClick={() => {
                          setSelectedAssetId(option.id);
                          setAmountInput('');
                          setLocalError('');
                        }}
                        disabled={processing}
                      >
                        <span className="account-funds-token-main">
                          <strong>{option.asset.symbol}</strong>
                          <small>{getAssetMetaLabel(option.asset)}</small>
                        </span>
                        <span className="account-funds-token-side">
                          <strong>{formatBalance(optionSourceBalance, option.asset)}</strong>
                          <span className="account-funds-token-kind">{getAssetKindPill(option.asset)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="account-funds-empty">
              {visibleAssets.length > 0 ? `No ${activeScope} tokens available.` : copy.empty}
            </p>
          )}
        </div>

        {hasLockedSourceAssets ? <p className="account-funds-warning">{copy.locked}</p> : null}

        {selectedAsset ? (
          <>
            <div className="account-funds-route" aria-label="Transfer route">
              <div>
                <span>From</span>
                <strong>{copy.sourceLabel}</strong>
              </div>
              <div>
                <span>To</span>
                <strong>{copy.targetLabel}</strong>
              </div>
            </div>

            <label className="account-funds-field">
              <span className="account-funds-field-head">
                <span>Amount</span>
                <small>
                  {copy.availableLabel}: {formatBalance(sourceBalanceWei, selectedAsset.asset)}
                </small>
              </span>
              <div className="account-funds-input-row">
                <input
                  value={amountInput}
                  onChange={(event) => {
                    setAmountInput(event.target.value);
                    setLocalError('');
                  }}
                  inputMode="decimal"
                  placeholder="0.00"
                  disabled={processing || sourceLocked}
                />
                <button
                  type="button"
                  onClick={setMaxAmount}
                  disabled={processing || sourceLocked || sourceBalanceWei === null}
                >
                  Max
                </button>
              </div>
            </label>

            <p className="account-funds-note">
              {estimatedPrompts} wallet prompt{estimatedPrompts === 1 ? '' : 's'} + 1 transfer transaction.
            </p>
          </>
        ) : null}

        {localError ? <p className="modal-error">{localError}</p> : null}

        <div className="modal-actions">
          <button type="button" className="connect-btn" onClick={onClose} disabled={processing}>
            Close
          </button>
          <button
            type="button"
            className="connect-btn wallet-primary-action"
            onClick={submit}
            disabled={processing || !canSubmit}
          >
            {processing ? 'Working...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
