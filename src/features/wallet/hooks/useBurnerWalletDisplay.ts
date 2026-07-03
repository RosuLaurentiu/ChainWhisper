import { useCallback, type MutableRefObject } from 'react';
import {
  isWalletAddress,
  normalizeContactName,
  shortenAddress,
  type BurnerWalletRecord,
  type Contact,
  type SignerSource
} from '../../../lib/appShared';

type UseBurnerWalletDisplayArgs = {
  activeSignerSource: SignerSource;
  burnerWallets: BurnerWalletRecord[];
  contacts: Contact[];
  myNickname: string;
  onChainNicknameCacheRef: MutableRefObject<Record<string, string | null>>;
  switchActiveBurnerWallet: (walletIdOrAddress: string) => Promise<unknown> | unknown;
  walletAddress: string;
};

export default function useBurnerWalletDisplay({
  activeSignerSource,
  burnerWallets,
  contacts,
  myNickname,
  onChainNicknameCacheRef,
  switchActiveBurnerWallet,
  walletAddress
}: UseBurnerWalletDisplayArgs) {
  const findContactNameForWalletAddress = useCallback(
    (address?: string): string | undefined => {
      if (!address) {
        return undefined;
      }

      const normalizedAddress = address.toLowerCase();
      const contactName = contacts.find((contact) => contact.address.toLowerCase() === normalizedAddress)?.name;
      if (contactName) {
        return contactName;
      }

      const onChainNickname = onChainNicknameCacheRef.current[normalizedAddress];
      return onChainNickname ?? undefined;
    },
    [contacts, onChainNicknameCacheRef]
  );

  const getBurnerWalletDisplayName = useCallback(
    (walletRecord: BurnerWalletRecord): string => {
      const recordAddress = walletRecord.address?.toLowerCase();
      const currentWalletKey = walletAddress.trim().toLowerCase();
      if (recordAddress && recordAddress === currentWalletKey) {
        const ownNickname = normalizeContactName(myNickname);
        if (ownNickname) {
          return ownNickname;
        }
      }
      return findContactNameForWalletAddress(walletRecord.address) ?? (walletRecord.address ? shortenAddress(walletRecord.address) : 'Unnamed');
    },
    [findContactNameForWalletAddress, myNickname, walletAddress]
  );

  const handleSwitchActiveBurnerWallet = useCallback(
    (walletIdOrAddress: string) => {
      const walletSelector = walletIdOrAddress.trim();
      const walletSelectorKey = walletSelector.toLowerCase();
      const selectedWalletRecord = burnerWallets.find(
        (walletRecord) =>
          walletRecord.id === walletSelector || walletRecord.address?.toLowerCase() === walletSelectorKey
      );
      const selectedWalletKey = selectedWalletRecord?.address?.toLowerCase() ?? '';
      const currentWalletKey = walletAddress.trim().toLowerCase();
      const selectorIsCurrentAddress = isWalletAddress(walletSelector) && walletSelectorKey === currentWalletKey;
      if (
        !walletSelector ||
        (activeSignerSource === 'burner' && (selectorIsCurrentAddress || selectedWalletKey === currentWalletKey))
      ) {
        return;
      }

      Promise.resolve(switchActiveBurnerWallet(walletSelector)).catch(() => {});
    },
    [activeSignerSource, burnerWallets, switchActiveBurnerWallet, walletAddress]
  );

  const findBurnerWalletDefaultNameForAddress = useCallback(
    (address: string): string | undefined => {
      const normalizedAddress = address.toLowerCase();
      const currentWalletKey = walletAddress.trim().toLowerCase();
      if (normalizedAddress === currentWalletKey) {
        const ownNickname = normalizeContactName(myNickname);
        if (ownNickname) {
          return ownNickname;
        }
      }
      const walletIndex = burnerWallets.findIndex(
        (walletRecord) => walletRecord.address?.toLowerCase() === normalizedAddress
      );

      if (walletIndex < 0) {
        return undefined;
      }

      return getBurnerWalletDisplayName(burnerWallets[walletIndex]);
    },
    [burnerWallets, getBurnerWalletDisplayName, myNickname, walletAddress]
  );

  return {
    findBurnerWalletDefaultNameForAddress,
    findContactNameForWalletAddress,
    getBurnerWalletDisplayName,
    handleSwitchActiveBurnerWallet
  };
}
