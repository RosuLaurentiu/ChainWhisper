import type { Eip1193Provider } from './appShared';

export type P2PTradeWalletPromptFlow = {
  id: string;
  sessionKey: string;
};

type PromptSessionInput = {
  chainId?: number | null;
  provider?: Eip1193Provider | null;
  walletAddress?: string | null;
};

const providerIds = new WeakMap<object, string>();
const activePromptCounts = new Map<string, number>();

let providerIdCounter = 0;
let promptIdCounter = 0;

const getProviderPromptKey = (provider?: Eip1193Provider | null): string => {
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

export const getP2PTradeWalletPromptSessionKey = ({
  chainId,
  provider,
  walletAddress
}: PromptSessionInput): string =>
  [
    walletAddress?.trim().toLowerCase() || 'no-wallet',
    getProviderPromptKey(provider),
    chainId ?? 'no-chain'
  ].join(':');

export const beginP2PTradeWalletPromptFlow = (input: PromptSessionInput): P2PTradeWalletPromptFlow => {
  const sessionKey = getP2PTradeWalletPromptSessionKey(input);
  promptIdCounter += 1;
  const id = `${sessionKey}:${promptIdCounter}`;
  activePromptCounts.set(sessionKey, (activePromptCounts.get(sessionKey) ?? 0) + 1);
  return { id, sessionKey };
};

export const endP2PTradeWalletPromptFlow = (flow: P2PTradeWalletPromptFlow | null | undefined): void => {
  if (!flow) {
    return;
  }

  const current = activePromptCounts.get(flow.sessionKey) ?? 0;
  if (current <= 1) {
    activePromptCounts.delete(flow.sessionKey);
    return;
  }
  activePromptCounts.set(flow.sessionKey, current - 1);
};

export const isP2PTradeWalletPromptActive = (input?: PromptSessionInput): boolean => {
  if (input) {
    return (activePromptCounts.get(getP2PTradeWalletPromptSessionKey(input)) ?? 0) > 0;
  }

  for (const count of activePromptCounts.values()) {
    if (count > 0) {
      return true;
    }
  }
  return false;
};

export const clearP2PTradeWalletPromptFlowsForTest = (): void => {
  activePromptCounts.clear();
};
