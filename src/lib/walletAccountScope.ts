import { isWalletAddress, type TradeSnapshot, type WalletAccountRole } from './appShared';

export type WalletReadAccount = {
  address: string;
  key: string;
  role: WalletAccountRole;
  label: string;
  canReadPrivate: boolean;
  isActionAccount: boolean;
};

export type WalletAccountScope = {
  actionAccount: WalletReadAccount | null;
  ownerAccount: WalletReadAccount | null;
  readAccounts: WalletReadAccount[];
  readAccountKeys: string[];
};

export type TradeWalletAction = 'accept' | 'cancel' | 'decline' | 'fill';

export type WalletReadSignerRoute = 'owner';

const normalizeAddress = (address?: string | null): string => String(address ?? '').trim();

const normalizeKey = (address?: string | null): string => normalizeAddress(address).toLowerCase();

const buildReadAccount = ({
  address,
  canReadPrivate,
  isActionAccount,
}: {
  address: string;
  canReadPrivate: boolean;
  isActionAccount: boolean;
}): WalletReadAccount => ({
  address,
  key: address.toLowerCase(),
  role: 'owner',
  label: 'Connected wallet',
  canReadPrivate,
  isActionAccount
});

export const buildWalletAccountScope = ({
  ownerAddress,
  ownerAesReady
}: {
  ownerAddress?: string | null;
  ownerAesReady: boolean;
}): WalletAccountScope => {
  const normalizedOwnerAddress = normalizeAddress(ownerAddress);
  const connectedAddress = isWalletAddress(normalizedOwnerAddress) ? normalizedOwnerAddress : '';
  const connectedAccount = connectedAddress
    ? buildReadAccount({
        address: connectedAddress,
        canReadPrivate: ownerAesReady,
        isActionAccount: true
      })
    : null;
  const readAccounts = connectedAccount ? [connectedAccount] : [];
  return {
    actionAccount: connectedAccount,
    ownerAccount: connectedAccount,
    readAccounts,
    readAccountKeys: readAccounts.map((account) => account.key)
  };
};

export const getWalletActionAccount = (accounts: WalletReadAccount[]): WalletReadAccount | null =>
  accounts.find((account) => account.isActionAccount) ?? null;

export const getWalletOwnerAccount = (accounts: WalletReadAccount[]): WalletReadAccount | null =>
  accounts.find((account) => account.isActionAccount && account.role === 'owner') ?? null;

export const buildWalletReadAccountsKey = (
  accounts: WalletReadAccount[],
  options: { includePrivateReadState?: boolean } = {}
): string =>
  accounts
    .map((account) =>
      options.includePrivateReadState
        ? `${account.role}:${account.key}:${account.canReadPrivate ? 'r' : 'l'}`
        : `${account.role}:${account.key}`
    )
    .join('|');

export const resolveWalletReadSignerRoute = ({
  account,
  ownerAddress
}: {
  account: WalletReadAccount;
  ownerAddress: string;
}): WalletReadSignerRoute => {
  const accountAddressKey = normalizeKey(account.address);
  const accountKey = normalizeKey(account.key);
  if (
    !isWalletAddress(account.address) ||
    !isWalletAddress(account.key) ||
    accountAddressKey !== accountKey
  ) {
    throw new Error('The wallet read account is malformed. Refresh the wallet session and try again.');
  }

  if (
    account.isActionAccount &&
    account.role === 'owner' &&
    accountKey === normalizeKey(ownerAddress)
  ) {
    return 'owner';
  }

  throw new Error('The wallet read scope changed. Refresh the wallet session and try again.');
};

export const assertWalletReadSignerMatchesAccount = (
  account: WalletReadAccount,
  signerAddress: string
): void => {
  const signerKey = normalizeKey(signerAddress);
  const accountKey = normalizeKey(account.key);
  if (!isWalletAddress(signerAddress) || !accountKey || signerKey !== accountKey) {
    throw new Error('The wallet signer changed. Refresh the wallet session and try again.');
  }
};

const tradeMatchesAccountKey = (
  trade: Pick<TradeSnapshot, 'maker' | 'taker' | 'walletHasFill' | 'accountAddress' | 'accountRole' | 'accountMatches'>,
  accountKey: string
): boolean => {
  if (!accountKey) {
    return false;
  }

  const makerKey = normalizeKey(trade.maker);
  const takerKey = normalizeKey(trade.taker);
  const snapshotAccountKey = normalizeKey(trade.accountAddress);
  return (
    makerKey === accountKey ||
    takerKey === accountKey ||
    snapshotAccountKey === accountKey ||
    Boolean(trade.accountMatches?.some((match) => normalizeKey(match.address) === accountKey))
  );
};

export const getTradeAccountPerspectiveAddress = (
  trade: Pick<TradeSnapshot, 'maker' | 'taker' | 'walletHasFill' | 'accountAddress' | 'accountRole' | 'accountMatches'>,
  scope: Pick<WalletAccountScope, 'actionAccount' | 'ownerAccount'>
): string => {
  const actionKey = scope.actionAccount?.key ?? '';
  const accountAddress = normalizeAddress(trade.accountAddress);

  if (actionKey && tradeMatchesAccountKey(trade, actionKey)) {
    return scope.actionAccount?.address ?? accountAddress;
  }

  return scope.actionAccount?.address ?? accountAddress;
};

export const resolveTradeActionWalletAddress = ({
  action,
  fallbackAddress,
  readAccounts,
  trade
}: {
  action: TradeWalletAction;
  fallbackAddress: string;
  readAccounts: WalletReadAccount[];
  trade: Pick<TradeSnapshot, 'maker' | 'taker' | 'walletHasFill' | 'accountAddress' | 'accountRole' | 'accountMatches'>;
}): string => {
  void action;
  void readAccounts;
  void trade;
  return fallbackAddress;
};

export const mergeWalletAccountMatches = (
  existing: TradeSnapshot | null | undefined,
  incoming: TradeSnapshot
): TradeSnapshot => {
  const matches = new Map<string, { address: string; role: WalletAccountRole }>();
  for (const match of [...(existing?.accountMatches ?? []), ...(incoming.accountMatches ?? [])]) {
    const key = match.address.trim().toLowerCase();
    if (isWalletAddress(key) && match.role === 'owner') {
      matches.set(key, { address: match.address, role: 'owner' });
    }
  }
  if (incoming.accountAddress && incoming.accountRole === 'owner') {
    matches.set(incoming.accountAddress.trim().toLowerCase(), {
      address: incoming.accountAddress,
      role: incoming.accountRole
    });
  }
  if (existing?.accountAddress && existing.accountRole === 'owner') {
    matches.set(existing.accountAddress.trim().toLowerCase(), {
      address: existing.accountAddress,
      role: existing.accountRole
    });
  }

  const orderedMatches = Array.from(matches.values());
  return {
    ...incoming,
    accountMatches: orderedMatches.length > 0 ? orderedMatches : undefined
  };
};
