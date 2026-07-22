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

const normalizeAddress = (address?: string | null): string => String(address ?? '').trim();

const normalizeKey = (address?: string | null): string => normalizeAddress(address).toLowerCase();

const buildReadAccount = ({
  address,
  canReadPrivate,
  isActionAccount,
  role
}: {
  address: string;
  canReadPrivate: boolean;
  isActionAccount: boolean;
  role: WalletAccountRole;
}): WalletReadAccount => ({
  address,
  key: address.toLowerCase(),
  role,
  label: role === 'owner' ? 'Owner wallet' : 'ChainWhisper account',
  canReadPrivate,
  isActionAccount
});

export const buildWalletAccountScope = ({
  actionAddress,
  actionAesReady,
  ownerAddress,
  ownerAesReady
}: {
  actionAddress?: string | null;
  actionAesReady: boolean;
  ownerAddress?: string | null;
  ownerAesReady: boolean;
}): WalletAccountScope => {
  const normalizedActionAddress = normalizeAddress(actionAddress);
  const normalizedOwnerAddress = normalizeAddress(ownerAddress);
  const actionAccount = isWalletAddress(normalizedActionAddress)
    ? buildReadAccount({
        address: normalizedActionAddress,
        canReadPrivate: actionAesReady,
        isActionAccount: true,
        role: 'chainwhisper'
      })
    : null;
  const ownerAccount = isWalletAddress(normalizedOwnerAddress)
    ? buildReadAccount({
        address: normalizedOwnerAddress,
        canReadPrivate: ownerAesReady,
        isActionAccount: false,
        role: 'owner'
      })
    : null;

  const byKey = new Map<string, WalletReadAccount>();
  if (actionAccount) {
    byKey.set(actionAccount.key, actionAccount);
  }
  if (ownerAccount) {
    const existing = byKey.get(ownerAccount.key);
    if (!existing) {
      byKey.set(ownerAccount.key, ownerAccount);
    } else {
      byKey.set(ownerAccount.key, {
        ...existing,
        canReadPrivate: existing.canReadPrivate || ownerAccount.canReadPrivate,
        isActionAccount: existing.isActionAccount || ownerAccount.isActionAccount
      });
    }
  }

  const readAccounts = Array.from(byKey.values());
  return {
    actionAccount,
    ownerAccount,
    readAccounts,
    readAccountKeys: readAccounts.map((account) => account.key)
  };
};

export const getWalletAccountRoleLabel = (role?: WalletAccountRole): string =>
  role === 'owner' ? 'Owner wallet' : role === 'chainwhisper' ? 'ChainWhisper account' : '';

export const getWalletActionAccount = (accounts: WalletReadAccount[]): WalletReadAccount | null =>
  accounts.find((account) => account.isActionAccount) ?? null;

export const getWalletOwnerAccount = (accounts: WalletReadAccount[]): WalletReadAccount | null =>
  accounts.find((account) => account.role === 'owner') ?? null;

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

type WalletScopedMessage = {
  accountAddress?: string;
  accountRole?: WalletAccountRole;
  id?: string;
};

const findReadAccountForMessage = (
  message: WalletScopedMessage | null | undefined,
  readAccounts: WalletReadAccount[]
): WalletReadAccount | null => {
  const accountKey = normalizeKey(message?.accountAddress);
  if (!accountKey) {
    return null;
  }
  return readAccounts.find((account) => account.key === accountKey) ?? null;
};

export const resolveConversationActionAccount = ({
  fallbackAddress,
  messages,
  readAccounts,
  replyTarget
}: {
  fallbackAddress: string;
  messages: WalletScopedMessage[];
  readAccounts: WalletReadAccount[];
  replyTarget?: WalletScopedMessage | null;
}): WalletReadAccount | null => {
  const actionAccount = getWalletActionAccount(readAccounts);
  const ownerAccount = getWalletOwnerAccount(readAccounts);
  const fallbackKey = normalizeKey(fallbackAddress);
  const fallbackAccount = readAccounts.find((account) => account.key === fallbackKey) ?? null;

  const replyAccount = findReadAccountForMessage(replyTarget, readAccounts);
  if (replyAccount) {
    return replyAccount;
  }

  const messageAccounts = messages
    .map((message) => findReadAccountForMessage(message, readAccounts))
    .filter((account): account is WalletReadAccount => Boolean(account));
  if (actionAccount && messageAccounts.some((account) => account.key === actionAccount.key)) {
    return actionAccount;
  }
  if (ownerAccount && messageAccounts.length > 0 && messageAccounts.every((account) => account.key === ownerAccount.key)) {
    return ownerAccount;
  }

  return actionAccount ?? fallbackAccount ?? ownerAccount;
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
  const ownerKey = scope.ownerAccount?.key ?? '';
  const accountAddress = normalizeAddress(trade.accountAddress);

  if (actionKey && tradeMatchesAccountKey(trade, actionKey)) {
    return scope.actionAccount?.address ?? accountAddress;
  }

  if (ownerKey && tradeMatchesAccountKey(trade, ownerKey)) {
    return scope.ownerAccount?.address ?? accountAddress;
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
  if (action === 'fill') {
    return fallbackAddress;
  }

  const ownerAccount = getWalletOwnerAccount(readAccounts);
  if (!ownerAccount) {
    return fallbackAddress;
  }

  const actionAccount = getWalletActionAccount(readAccounts);
  const fallbackKey = normalizeKey(fallbackAddress);
  const actionKey = actionAccount?.key || fallbackKey;
  if (tradeMatchesAccountKey(trade, actionKey)) {
    return fallbackAddress;
  }

  const ownerMatches = trade.accountRole === 'owner' || tradeMatchesAccountKey(trade, ownerAccount.key);
  return ownerMatches ? ownerAccount.address : fallbackAddress;
};

export const mergeWalletAccountMatches = (
  existing: TradeSnapshot | null | undefined,
  incoming: TradeSnapshot
): TradeSnapshot => {
  const matches = new Map<string, { address: string; role: WalletAccountRole }>();
  for (const match of [...(existing?.accountMatches ?? []), ...(incoming.accountMatches ?? [])]) {
    const key = match.address.trim().toLowerCase();
    if (isWalletAddress(key)) {
      matches.set(key, { address: match.address, role: match.role });
    }
  }
  if (incoming.accountAddress && incoming.accountRole) {
    matches.set(incoming.accountAddress.trim().toLowerCase(), {
      address: incoming.accountAddress,
      role: incoming.accountRole
    });
  }
  if (existing?.accountAddress && existing.accountRole) {
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
