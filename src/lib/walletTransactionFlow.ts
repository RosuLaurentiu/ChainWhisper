import type { Eip1193Provider } from './appShared';

export type WalletTransactionFlow = {
  id: string;
  sessionKey: string;
};

export type WalletTransactionSessionInput = {
  chainId?: number | null;
  provider?: Eip1193Provider | null;
  walletAddress?: string | null;
};

const providerIds = new WeakMap<object, string>();
const activeFlowCounts = new Map<string, number>();

let providerIdCounter = 0;
let flowIdCounter = 0;

const getProviderFlowKey = (provider?: Eip1193Provider | null): string => {
  if (!provider || typeof provider !== 'object') {
    return 'no-provider';
  }

  const existing = providerIds.get(provider);
  if (existing) {
    return existing;
  }

  providerIdCounter += 1;
  const next = `provider-${providerIdCounter}`;
  providerIds.set(provider, next);
  return next;
};

export const getWalletTransactionSessionKey = ({
  chainId,
  provider,
  walletAddress
}: WalletTransactionSessionInput): string =>
  [
    walletAddress?.trim().toLowerCase() || 'no-wallet',
    getProviderFlowKey(provider),
    chainId ?? 'no-chain'
  ].join(':');

export const beginWalletTransactionFlow = (input: WalletTransactionSessionInput): WalletTransactionFlow => {
  const sessionKey = getWalletTransactionSessionKey(input);
  flowIdCounter += 1;
  const id = `${sessionKey}:${flowIdCounter}`;
  activeFlowCounts.set(sessionKey, (activeFlowCounts.get(sessionKey) ?? 0) + 1);
  return { id, sessionKey };
};

export const endWalletTransactionFlow = (flow: WalletTransactionFlow | null | undefined): void => {
  if (!flow) {
    return;
  }

  const current = activeFlowCounts.get(flow.sessionKey) ?? 0;
  if (current <= 1) {
    activeFlowCounts.delete(flow.sessionKey);
    return;
  }
  activeFlowCounts.set(flow.sessionKey, current - 1);
};

export const isWalletTransactionFlowActive = (input?: WalletTransactionSessionInput): boolean => {
  if (input) {
    return (activeFlowCounts.get(getWalletTransactionSessionKey(input)) ?? 0) > 0;
  }

  for (const count of activeFlowCounts.values()) {
    if (count > 0) {
      return true;
    }
  }
  return false;
};

export const runWalletTransactionFlow = async <T>(
  input: WalletTransactionSessionInput,
  operation: () => Promise<T>
): Promise<T> => {
  const flow = beginWalletTransactionFlow(input);
  try {
    return await operation();
  } finally {
    endWalletTransactionFlow(flow);
  }
};

export const clearWalletTransactionFlowsForTest = (): void => {
  activeFlowCounts.clear();
};
