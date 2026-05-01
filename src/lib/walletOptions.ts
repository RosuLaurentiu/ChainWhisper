import type { InjectedWalletOption } from './appShared';

export type InjectedWalletPriority = 'metamask' | 'selected';

export const isPreferredMetaMaskWalletOption = (option: InjectedWalletOption): boolean =>
  Boolean(option.provider.isMetaMask && !option.provider.isBraveWallet);

const normalizeWalletOptionText = (...values: string[]): string =>
  values
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export const isCypherTradeWalletOption = (option: InjectedWalletOption): boolean => {
  const providerWithFlags = option.provider as typeof option.provider & {
    isCypher?: boolean;
    isCypherTrade?: boolean;
    isCypherWallet?: boolean;
  };
  if (providerWithFlags.isCypherTrade || providerWithFlags.isCypherWallet || providerWithFlags.isCypher) {
    return true;
  }

  const identityText = normalizeWalletOptionText(option.id, option.label);
  return identityText.includes('cyphertrade') || identityText.includes('cypherwallet');
};

export const isAllowedBrowserWalletOption = (option: InjectedWalletOption): boolean =>
  isPreferredMetaMaskWalletOption(option) || isCypherTradeWalletOption(option);

export const filterAllowedBrowserWalletOptions = (options: InjectedWalletOption[]): InjectedWalletOption[] =>
  options.filter(isAllowedBrowserWalletOption);

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
    return options.find(isPreferredMetaMaskWalletOption) ?? options[0] ?? null;
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
  const metaMaskOption = priority === 'metamask' ? options.find(isPreferredMetaMaskWalletOption) ?? null : null;

  return uniqueWalletOptions([selectedOption, metaMaskOption, ...options]);
};
