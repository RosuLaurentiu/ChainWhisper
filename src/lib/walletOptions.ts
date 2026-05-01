import type { InjectedWalletOption } from './appShared';

export type InjectedWalletPriority = 'metamask' | 'selected';

const isPreferredMetaMask = (option: InjectedWalletOption): boolean =>
  Boolean(option.provider.isMetaMask && !option.provider.isBraveWallet);

const uniqueWalletOptions = (options: Array<InjectedWalletOption | null | undefined>): InjectedWalletOption[] => {
  const seen = new Set<string>();
  const result: InjectedWalletOption[] = [];

  for (const option of options) {
    if (!option || seen.has(option.id)) {
      continue;
    }
    seen.add(option.id);
    result.push(option);
  }

  return result;
};

export const getPreferredInjectedWalletOption = (
  options: InjectedWalletOption[],
  selectedWalletId = '',
  priority: InjectedWalletPriority = 'metamask'
): InjectedWalletOption | null => {
  const selectedOption = selectedWalletId
    ? options.find((option) => option.id === selectedWalletId) ?? null
    : null;

  if (selectedOption) {
    return selectedOption;
  }

  if (priority === 'metamask') {
    return options.find(isPreferredMetaMask) ?? options[0] ?? null;
  }

  return options[0] ?? null;
};

export const orderInjectedWalletOptions = (
  options: InjectedWalletOption[],
  selectedWalletId = '',
  priority: InjectedWalletPriority = 'metamask'
): InjectedWalletOption[] => {
  const selectedOption = selectedWalletId
    ? options.find((option) => option.id === selectedWalletId) ?? null
    : null;
  const metaMaskOption = priority === 'metamask' ? options.find(isPreferredMetaMask) ?? null : null;

  return uniqueWalletOptions([selectedOption, metaMaskOption, ...options]);
};
