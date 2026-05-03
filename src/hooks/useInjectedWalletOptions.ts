import { useEffect, useState } from 'react';
import {
  getInjectedWalletOptions,
  rememberInjectedWalletProvider,
  type Eip1193Provider,
  type InjectedWalletOption
} from '../lib/appShared';

type Eip6963ProviderInfo = {
  name?: string;
  rdns?: string;
  uuid?: string;
};

export default function useInjectedWalletOptions(): InjectedWalletOption[] {
  const [options, setOptions] = useState(() => getInjectedWalletOptions());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const refreshInjectedWalletOptions = () => {
      setOptions(getInjectedWalletOptions());
    };
    const handleProviderAnnouncement = (event: Event) => {
      const detail = (event as CustomEvent<{ provider?: Eip1193Provider; info?: Eip6963ProviderInfo }>).detail;
      rememberInjectedWalletProvider(detail?.provider, detail?.info);
      refreshInjectedWalletOptions();
    };

    refreshInjectedWalletOptions();
    window.addEventListener('ethereum#initialized', refreshInjectedWalletOptions);
    window.addEventListener('eip6963:announceProvider', handleProviderAnnouncement);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    const refreshTimers = [250, 1000, 2500].map((delay) => window.setTimeout(refreshInjectedWalletOptions, delay));

    return () => {
      window.removeEventListener('ethereum#initialized', refreshInjectedWalletOptions);
      window.removeEventListener('eip6963:announceProvider', handleProviderAnnouncement);
      refreshTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return options;
}
