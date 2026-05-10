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

export type WalletTransactionFlowState = 'inactive' | 'memory-active' | 'stored-handoff';

type StoredWalletTransactionFlow = {
  count: number;
  expiresAt: number;
  sessionKey: string;
  trace: string[];
  updatedAt: number;
};

const providerIds = new WeakMap<object, string>();
const activeFlowCounts = new Map<string, number>();

const WALLET_TRANSACTION_FLOW_STORAGE_KEY = 'chainwhisper:wallet-transaction-flow:v1';
const WALLET_TRANSACTION_FLOW_TTL_MS = 10 * 60 * 1000;
const MAX_TRACE_ENTRIES = 16;

let providerIdCounter = 0;
let flowIdCounter = 0;

const normalizeWalletAddress = (walletAddress?: string | null): string =>
  walletAddress?.trim().toLowerCase() || 'no-wallet';

const resolveProviderKind = (provider?: Eip1193Provider | null): string => {
  if (!provider || typeof provider !== 'object') {
    return 'no-provider';
  }

  const providerWithFlags = provider as Eip1193Provider & {
    isBraveWallet?: unknown;
    isCipher?: unknown;
    isCipherTrade?: unknown;
    isCipherWallet?: unknown;
    isCypher?: unknown;
    isCypherTrade?: unknown;
    isCypherWallet?: unknown;
    isMetaMask?: unknown;
  };
  if (
    providerWithFlags.isCipherTrade ||
    providerWithFlags.isCipherWallet ||
    providerWithFlags.isCipher ||
    providerWithFlags.isCypherTrade ||
    providerWithFlags.isCypherWallet ||
    providerWithFlags.isCypher
  ) {
    return 'ciphertrade';
  }
  if (providerWithFlags.isMetaMask && providerWithFlags.isBraveWallet) {
    return 'brave-wallet';
  }
  if (providerWithFlags.isMetaMask) {
    return 'metamask';
  }

  return 'browser-wallet';
};

const getProviderFlowKey = (provider?: Eip1193Provider | null): string => {
  if (!provider || typeof provider !== 'object') {
    return 'no-provider';
  }

  const providerKind = resolveProviderKind(provider);
  if (providerKind !== 'browser-wallet') {
    return providerKind;
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
    normalizeWalletAddress(walletAddress),
    getProviderFlowKey(provider),
    chainId ?? 'no-chain'
  ].join(':');

const getSessionStorage = (): Storage | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const readStoredFlows = (now = Date.now()): Record<string, StoredWalletTransactionFlow> => {
  const storage = getSessionStorage();
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(WALLET_TRANSACTION_FLOW_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, Partial<StoredWalletTransactionFlow>>;
    const next: Record<string, StoredWalletTransactionFlow> = {};
    let changed = false;
    for (const [sessionKey, value] of Object.entries(parsed)) {
      const count = Number(value.count ?? 0);
      const expiresAt = Number(value.expiresAt ?? 0);
      if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(expiresAt) || expiresAt <= now) {
        changed = true;
        continue;
      }
      next[sessionKey] = {
        count,
        expiresAt,
        sessionKey,
        trace: Array.isArray(value.trace) ? value.trace.filter((entry): entry is string => typeof entry === 'string') : [],
        updatedAt: Number(value.updatedAt ?? now)
      };
    }
    if (changed) {
      storage.setItem(WALLET_TRANSACTION_FLOW_STORAGE_KEY, JSON.stringify(next));
    }
    return next;
  } catch {
    try {
      storage.removeItem(WALLET_TRANSACTION_FLOW_STORAGE_KEY);
    } catch {
    }
    return {};
  }
};

const writeStoredFlows = (flows: Record<string, StoredWalletTransactionFlow>): void => {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  try {
    const entries = Object.entries(flows);
    if (entries.length === 0) {
      storage.removeItem(WALLET_TRANSACTION_FLOW_STORAGE_KEY);
      return;
    }
    storage.setItem(WALLET_TRANSACTION_FLOW_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
  }
};

const touchStoredFlow = (sessionKey: string, count: number, traceEntry?: string): void => {
  const now = Date.now();
  const flows = readStoredFlows(now);
  const previous = flows[sessionKey];
  const trace = [
    ...(previous?.trace ?? []),
    ...(traceEntry ? [`${new Date(now).toISOString()} ${traceEntry}`] : [])
  ].slice(-MAX_TRACE_ENTRIES);
  flows[sessionKey] = {
    count,
    expiresAt: now + WALLET_TRANSACTION_FLOW_TTL_MS,
    sessionKey,
    trace,
    updatedAt: now
  };
  writeStoredFlows(flows);
};

const removeStoredFlow = (sessionKey: string, traceEntry?: string): void => {
  const flows = readStoredFlows();
  if (flows[sessionKey] && traceEntry) {
    flows[sessionKey].trace = [...flows[sessionKey].trace, `${new Date().toISOString()} ${traceEntry}`].slice(
      -MAX_TRACE_ENTRIES
    );
  }
  delete flows[sessionKey];
  writeStoredFlows(flows);
};

export const beginWalletTransactionFlow = (input: WalletTransactionSessionInput): WalletTransactionFlow => {
  const sessionKey = getWalletTransactionSessionKey(input);
  flowIdCounter += 1;
  const id = `${sessionKey}:${flowIdCounter}`;
  const nextCount = (activeFlowCounts.get(sessionKey) ?? 0) + 1;
  activeFlowCounts.set(sessionKey, nextCount);
  touchStoredFlow(sessionKey, nextCount, 'flow-started');
  return { id, sessionKey };
};

export const endWalletTransactionFlow = (flow: WalletTransactionFlow | null | undefined): void => {
  if (!flow) {
    return;
  }

  const current = activeFlowCounts.get(flow.sessionKey) ?? 0;
  if (current <= 1) {
    activeFlowCounts.delete(flow.sessionKey);
    removeStoredFlow(flow.sessionKey, 'flow-ended');
    return;
  }
  const nextCount = current - 1;
  activeFlowCounts.set(flow.sessionKey, nextCount);
  touchStoredFlow(flow.sessionKey, nextCount, 'flow-ended');
};

export const isWalletTransactionFlowActive = (input?: WalletTransactionSessionInput): boolean => {
  return getWalletTransactionFlowState(input) !== 'inactive';
};

export const getWalletTransactionFlowState = (input?: WalletTransactionSessionInput): WalletTransactionFlowState => {
  if (input) {
    const sessionKey = getWalletTransactionSessionKey(input);
    if ((activeFlowCounts.get(sessionKey) ?? 0) > 0) {
      return 'memory-active';
    }
    return readStoredFlows()[sessionKey] ? 'stored-handoff' : 'inactive';
  }

  for (const count of activeFlowCounts.values()) {
    if (count > 0) {
      return 'memory-active';
    }
  }
  return Object.keys(readStoredFlows()).length > 0 ? 'stored-handoff' : 'inactive';
};

export const isWalletTransactionPromptActive = (input?: WalletTransactionSessionInput): boolean => {
  return getWalletTransactionFlowState(input) === 'memory-active';
};

export const recordWalletTransactionFlowStage = (
  input: WalletTransactionSessionInput | WalletTransactionFlow,
  stage: string
): void => {
  const sessionKey = 'sessionKey' in input ? input.sessionKey : getWalletTransactionSessionKey(input);
  const count = activeFlowCounts.get(sessionKey) ?? readStoredFlows()[sessionKey]?.count ?? 1;
  touchStoredFlow(sessionKey, count, stage);
};

export const readWalletTransactionFlowTrace = (input?: WalletTransactionSessionInput): string[] => {
  const flows = readStoredFlows();
  if (input) {
    return flows[getWalletTransactionSessionKey(input)]?.trace ?? [];
  }
  return Object.values(flows).flatMap((flow) => flow.trace);
};

export const clearWalletTransactionFlow = (input?: WalletTransactionSessionInput): void => {
  if (!input) {
    activeFlowCounts.clear();
    writeStoredFlows({});
    return;
  }

  const walletKey = normalizeWalletAddress(input.walletAddress);
  const providerKey = getProviderFlowKey(input.provider);
  const shouldClearSessionKey = (sessionKey: string): boolean => {
    const [sessionWalletKey, sessionProviderKey, sessionChainKey] = sessionKey.split(':');
    if (sessionWalletKey !== walletKey || sessionProviderKey !== providerKey) {
      return false;
    }
    return input.chainId === undefined || input.chainId === null || sessionChainKey === String(input.chainId);
  };

  for (const sessionKey of Array.from(activeFlowCounts.keys())) {
    if (shouldClearSessionKey(sessionKey)) {
      activeFlowCounts.delete(sessionKey);
    }
  }

  const flows = readStoredFlows();
  for (const sessionKey of Object.keys(flows)) {
    if (shouldClearSessionKey(sessionKey)) {
      delete flows[sessionKey];
    }
  }
  writeStoredFlows(flows);
};

export const runWalletTransactionFlow = async <T>(
  input: WalletTransactionSessionInput,
  operation: () => Promise<T>
): Promise<T> => {
  const flow = beginWalletTransactionFlow(input);
  try {
    const result = await operation();
    recordWalletTransactionFlowStage(flow, 'flow-completed');
    return result;
  } catch (error) {
    recordWalletTransactionFlowStage(flow, 'flow-failed');
    throw error;
  } finally {
    endWalletTransactionFlow(flow);
  }
};

export const clearWalletTransactionFlowsForTest = (): void => {
  clearWalletTransactionFlow();
};

export const clearWalletTransactionFlowMemoryForTest = (): void => {
  activeFlowCounts.clear();
};
