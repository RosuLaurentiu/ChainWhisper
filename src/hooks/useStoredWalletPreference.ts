import { useEffect, useState } from 'react';
import {
  readWalletPreference,
  subscribeWalletPreferenceChanges,
  type WalletPreference
} from '../lib/appStorage';

export function useStoredWalletPreference(): WalletPreference | null {
  const [walletPreference, setWalletPreference] = useState<WalletPreference | null>(() => readWalletPreference());

  useEffect(() => subscribeWalletPreferenceChanges(setWalletPreference), []);

  return walletPreference;
}
