import { COTI_NETWORK, type Eip1193Provider } from './appShared';
import { getCotiAesWalletSessionKey } from './cotiAesUnlock';

export const P2P_TRADE_ACTION_RESUME_STORAGE_KEY = 'chainwhisper:p2p:trade-action-resume:v1';
export const P2P_TRADE_ACTION_RESUME_TTL_MS = 10 * 60 * 1000;
export const P2P_TRADE_ACTION_MAX_AUTO_RESUME_ATTEMPTS = 5;

export type P2PTradeActionResumeKind =
  | 'accept'
  | 'partial-fill'
  | 'cancel'
  | 'decline'
  | 'recurring-fill'
  | 'recurring-status';

export type P2PTradeActionResumeStage =
  | 'started'
  | 'aes-ready'
  | 'token-visibility-ready'
  | 'allowance-ready'
  | 'submit-trade'
  | 'confirm-refresh';

export type P2PTradeActionResumeStatus = 'pending' | 'paused';

export type P2PTradeActionResume = {
  accessSecret?: string;
  actionKind: P2PTradeActionResumeKind;
  amountInput?: string;
  amountWei?: string;
  autoResumeAttempts: number;
  baselineFilledRequestAmount?: string;
  baselineRecurringExecutionCount?: number;
  baselineRemainingRequestAmount?: string;
  baselineStatus?: string;
  chainId: number;
  counterAcceptMode?: 'close-related' | 'accept-only';
  createdAt: number;
  escrowContract?: string;
  expiresAt: number;
  lastAutoResumeAt?: number;
  lastAttemptAt: number;
  pauseReason?: string;
  recurringSide?: 'buy' | 'sell';
  recurringStatusAction?: 'pause' | 'resume' | 'cancel';
  sessionKey: string;
  stage: P2PTradeActionResumeStage;
  stageAttempts: number;
  status: P2PTradeActionResumeStatus;
  terminalPath: string;
  tradeId: number;
  updatedAt: number;
  version: 1;
  walletAddress: string;
};

export type RememberP2PTradeActionResumeInput = {
  accessSecret?: string;
  actionKind: P2PTradeActionResumeKind;
  amountInput?: string;
  amountWei?: string;
  baselineFilledRequestAmount?: string;
  baselineRecurringExecutionCount?: number;
  baselineRemainingRequestAmount?: string;
  baselineStatus?: string;
  chainId?: number | null;
  counterAcceptMode?: 'close-related' | 'accept-only';
  escrowContract?: string;
  provider?: Eip1193Provider | null;
  recurringSide?: 'buy' | 'sell';
  recurringStatusAction?: 'pause' | 'resume' | 'cancel';
  stage?: P2PTradeActionResumeStage;
  terminalPath: string;
  tradeId: number;
  walletAddress: string;
};

export type P2PTradeActionResumeStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

const getSessionStorage = (): P2PTradeActionResumeStorage | null => {
  try {
    const maybeWindow = globalThis as {
      sessionStorage?: Storage;
      window?: { sessionStorage?: Storage };
    };
    return maybeWindow.window?.sessionStorage ?? maybeWindow.sessionStorage ?? null;
  } catch {
    return null;
  }
};

const normalizeWalletAddress = (value: string): string => value.trim().toLowerCase();

const normalizeEscrowContract = (value?: string): string => value?.trim().toLowerCase() ?? '';

const resolveSessionKey = (walletAddress: string, provider?: Eip1193Provider | null): string =>
  getCotiAesWalletSessionKey(walletAddress, provider);

const resolveChainId = (chainId?: number | null): number =>
  Number.isFinite(chainId ?? NaN) ? Number(chainId) : COTI_NETWORK.chainIdDecimal;

const isSameAction = (
  left: Pick<P2PTradeActionResume, 'actionKind' | 'escrowContract' | 'sessionKey' | 'tradeId'>,
  right: Pick<P2PTradeActionResume, 'actionKind' | 'escrowContract' | 'sessionKey' | 'tradeId'>
): boolean =>
  left.actionKind === right.actionKind &&
  left.tradeId === right.tradeId &&
  left.sessionKey === right.sessionKey &&
  normalizeEscrowContract(left.escrowContract) === normalizeEscrowContract(right.escrowContract);

export const clearP2PTradeActionResume = (
  storage: P2PTradeActionResumeStorage | null = getSessionStorage()
): void => {
  try {
    storage?.removeItem(P2P_TRADE_ACTION_RESUME_STORAGE_KEY);
  } catch {
  }
};

export const readP2PTradeActionResume = (
  storage: P2PTradeActionResumeStorage | null = getSessionStorage(),
  now = Date.now()
): P2PTradeActionResume | null => {
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(P2P_TRADE_ACTION_RESUME_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<P2PTradeActionResume>;
    if (
      parsed.version !== 1 ||
      typeof parsed.sessionKey !== 'string' ||
      typeof parsed.walletAddress !== 'string' ||
      typeof parsed.actionKind !== 'string' ||
      typeof parsed.tradeId !== 'number' ||
      typeof parsed.terminalPath !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.expiresAt <= now
    ) {
      clearP2PTradeActionResume(storage);
      return null;
    }
    return {
      ...parsed,
      accessSecret: typeof parsed.accessSecret === 'string' ? parsed.accessSecret : undefined,
      amountInput: typeof parsed.amountInput === 'string' ? parsed.amountInput : undefined,
      amountWei: typeof parsed.amountWei === 'string' ? parsed.amountWei : undefined,
      autoResumeAttempts: Number(parsed.autoResumeAttempts ?? 0),
      baselineFilledRequestAmount:
        typeof parsed.baselineFilledRequestAmount === 'string' ? parsed.baselineFilledRequestAmount : undefined,
      baselineRecurringExecutionCount:
        typeof parsed.baselineRecurringExecutionCount === 'number' ? parsed.baselineRecurringExecutionCount : undefined,
      baselineRemainingRequestAmount:
        typeof parsed.baselineRemainingRequestAmount === 'string' ? parsed.baselineRemainingRequestAmount : undefined,
      baselineStatus: typeof parsed.baselineStatus === 'string' ? parsed.baselineStatus : undefined,
      chainId: Number(parsed.chainId ?? COTI_NETWORK.chainIdDecimal),
      counterAcceptMode:
        parsed.counterAcceptMode === 'accept-only' || parsed.counterAcceptMode === 'close-related'
          ? parsed.counterAcceptMode
          : undefined,
      createdAt: Number(parsed.createdAt ?? now),
      escrowContract: typeof parsed.escrowContract === 'string' ? parsed.escrowContract : undefined,
      lastAttemptAt: Number(parsed.lastAttemptAt ?? parsed.updatedAt ?? now),
      recurringSide: parsed.recurringSide === 'buy' || parsed.recurringSide === 'sell' ? parsed.recurringSide : undefined,
      recurringStatusAction:
        parsed.recurringStatusAction === 'pause' ||
        parsed.recurringStatusAction === 'resume' ||
        parsed.recurringStatusAction === 'cancel'
          ? parsed.recurringStatusAction
          : undefined,
      stage: parsed.stage ?? 'started',
      stageAttempts: Number(parsed.stageAttempts ?? 0),
      status: parsed.status === 'paused' ? 'paused' : 'pending',
      tradeId: parsed.tradeId,
      updatedAt: Number(parsed.updatedAt ?? now),
      version: 1,
      walletAddress: parsed.walletAddress
    } as P2PTradeActionResume;
  } catch {
    clearP2PTradeActionResume(storage);
    return null;
  }
};

export const readP2PTradeActionResumeForSession = ({
  chainId,
  provider,
  storage = getSessionStorage(),
  walletAddress
}: {
  chainId?: number | null;
  provider?: Eip1193Provider | null;
  storage?: P2PTradeActionResumeStorage | null;
  walletAddress: string;
}): P2PTradeActionResume | null => {
  const pending = readP2PTradeActionResume(storage);
  if (!pending) {
    return null;
  }
  const sessionKey = resolveSessionKey(walletAddress, provider);
  if (
    pending.sessionKey !== sessionKey ||
    pending.walletAddress !== normalizeWalletAddress(walletAddress) ||
    pending.chainId !== resolveChainId(chainId)
  ) {
    return null;
  }
  return pending;
};

export const rememberP2PTradeActionResume = (
  input: RememberP2PTradeActionResumeInput,
  storage: P2PTradeActionResumeStorage | null = getSessionStorage(),
  now = Date.now()
): P2PTradeActionResume | null => {
  if (!storage || !input.walletAddress.trim() || input.tradeId <= 0 || !input.terminalPath.trim()) {
    return null;
  }

  const sessionKey = resolveSessionKey(input.walletAddress, input.provider);
  const previous = readP2PTradeActionResume(storage, now);
  const identity = {
    actionKind: input.actionKind,
    escrowContract: input.escrowContract,
    sessionKey,
    tradeId: input.tradeId
  };
  const preserve = previous && isSameAction(previous, identity);
  const stage = input.stage ?? previous?.stage ?? 'started';
  const next: P2PTradeActionResume = {
    accessSecret: input.accessSecret,
    actionKind: input.actionKind,
    amountInput: input.amountInput,
    amountWei: input.amountWei,
    autoResumeAttempts: preserve ? previous.autoResumeAttempts : 0,
    baselineFilledRequestAmount: input.baselineFilledRequestAmount ?? (preserve ? previous.baselineFilledRequestAmount : undefined),
    baselineRecurringExecutionCount: input.baselineRecurringExecutionCount ?? (preserve ? previous.baselineRecurringExecutionCount : undefined),
    baselineRemainingRequestAmount: input.baselineRemainingRequestAmount ?? (preserve ? previous.baselineRemainingRequestAmount : undefined),
    baselineStatus: input.baselineStatus ?? (preserve ? previous.baselineStatus : undefined),
    chainId: resolveChainId(input.chainId),
    counterAcceptMode: input.counterAcceptMode,
    createdAt: preserve ? previous.createdAt : now,
    escrowContract: input.escrowContract,
    expiresAt: now + P2P_TRADE_ACTION_RESUME_TTL_MS,
    lastAutoResumeAt: preserve ? previous.lastAutoResumeAt : undefined,
    lastAttemptAt: now,
    recurringSide: input.recurringSide,
    recurringStatusAction: input.recurringStatusAction,
    sessionKey,
    stage,
    stageAttempts: preserve && previous.stage === stage ? previous.stageAttempts : 0,
    status: 'pending',
    terminalPath: input.terminalPath,
    tradeId: input.tradeId,
    updatedAt: now,
    version: 1,
    walletAddress: normalizeWalletAddress(input.walletAddress)
  };

  try {
    storage.setItem(P2P_TRADE_ACTION_RESUME_STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
};

export const updateP2PTradeActionResumeStage = (
  stage: P2PTradeActionResumeStage,
  storage: P2PTradeActionResumeStorage | null = getSessionStorage(),
  now = Date.now()
): P2PTradeActionResume | null => {
  const pending = readP2PTradeActionResume(storage, now);
  if (!pending || !storage) {
    return null;
  }
  const next: P2PTradeActionResume = {
    ...pending,
    expiresAt: now + P2P_TRADE_ACTION_RESUME_TTL_MS,
    lastAttemptAt: now,
    stage,
    stageAttempts: pending.stage === stage ? pending.stageAttempts + 1 : 1,
    status: 'pending',
    updatedAt: now
  };
  try {
    storage.setItem(P2P_TRADE_ACTION_RESUME_STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
};

export const bumpP2PTradeActionAutoResumeAttempt = (
  pending: P2PTradeActionResume,
  storage: P2PTradeActionResumeStorage | null = getSessionStorage(),
  now = Date.now()
): P2PTradeActionResume | null => {
  if (!storage || pending.status === 'paused') {
    return null;
  }
  if (pending.autoResumeAttempts >= P2P_TRADE_ACTION_MAX_AUTO_RESUME_ATTEMPTS) {
    const paused: P2PTradeActionResume = {
      ...pending,
      pauseReason: 'Trade action paused after repeated mobile wallet returns. Tap the action again to continue.',
      status: 'paused',
      updatedAt: now
    };
    try {
      storage.setItem(P2P_TRADE_ACTION_RESUME_STORAGE_KEY, JSON.stringify(paused));
    } catch {
    }
    return null;
  }
  const next: P2PTradeActionResume = {
    ...pending,
    autoResumeAttempts: pending.autoResumeAttempts + 1,
    expiresAt: now + P2P_TRADE_ACTION_RESUME_TTL_MS,
    lastAutoResumeAt: now,
    status: 'pending',
    updatedAt: now
  };
  try {
    storage.setItem(P2P_TRADE_ACTION_RESUME_STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
};

export const shouldPreserveP2PTradeActionResumeForError = (error: unknown): boolean => {
  const candidate = error as { code?: unknown; message?: unknown } | null | undefined;
  const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : '';
  return (
    message.includes('already pending') ||
    message.includes('request already pending') ||
    message.includes('already known') ||
    message.includes('transaction underpriced') ||
    message.includes('replacement transaction underpriced')
  );
};
