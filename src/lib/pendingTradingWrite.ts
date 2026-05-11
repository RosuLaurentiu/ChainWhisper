export const PENDING_TRADING_WRITE_STORAGE_KEY = 'chainwhisper:p2p:pending-write:v1';

export type PendingTradingCounterAcceptMode = 'close-related' | 'accept-only';
export type PendingRecurringStatusAction = 'pause' | 'resume' | 'cancel';
export type PendingRecurringFillSide = 'buy' | 'sell';

export type PendingTradeCreateForm = {
  directTradeRecipient: string;
  tradeHasNoExpiry: boolean;
  tradeHidePrivateLiquidity: boolean;
  tradeOfferAmountInput: string;
  tradeOfferCustomTokenAddress: string;
  tradeOfferTokenSelection: string;
  tradePriceInput: string;
  tradePricingEditedFields: string[];
  tradeRequestAmountInput: string;
  tradeRequestCustomTokenAddress: string;
  tradeRequestTokenSelection: string;
  tradeVisibility: string;
};

export type PendingRecurringCreateForm = {
  recurringAddBuyBudgetInput: string;
  recurringAddSellInventoryInput: string;
  recurringBuyPriceInput: string;
  recurringBuyReceiveEditable: boolean;
  recurringBuyReceiveInput: string;
  recurringHidePrivateAmounts: boolean;
  recurringRemoveBuyBudgetInput: string;
  recurringRemoveSellInventoryInput: string;
  recurringSellPriceInput: string;
  recurringSellReceiveEditable: boolean;
  recurringSellReceiveInput: string;
  tradeOfferCustomTokenAddress: string;
  tradeOfferTokenSelection: string;
  tradeRequestCustomTokenAddress: string;
  tradeRequestTokenSelection: string;
};

export type PendingTradingWriteBase = {
  chainId: number | null;
  id: string;
  routePath: string;
  resumeCount: number;
  timestamp: number;
  walletAddress: string;
};

export type PendingAcceptTradingWrite = PendingTradingWriteBase & {
  counterAcceptMode?: PendingTradingCounterAcceptMode;
  escrowContract?: string;
  kind: 'accept-trade';
  tradeId: number;
};

export type PendingPartialFillTradingWrite = PendingTradingWriteBase & {
  amountInput: string;
  escrowContract?: string;
  kind: 'partial-fill';
  tradeId: number;
};

export type PendingTradeStatusTradingWrite = PendingTradingWriteBase & {
  escrowContract?: string;
  kind: 'cancel-trade' | 'decline-trade';
  tradeId: number;
};

export type PendingCreateTradingWrite = PendingTradingWriteBase & {
  context: {
    counterParentEscrowContract?: string;
    counterParentTradeId?: number;
    editingEscrowContract?: string;
    editingTradeId?: number;
  };
  form: PendingTradeCreateForm;
  kind: 'create-trade';
};

export type PendingCreateRecurringTradingWrite = PendingTradingWriteBase & {
  context: {
    editingEscrowContract?: string;
    editingTradeId?: number;
  };
  form: PendingRecurringCreateForm;
  kind: 'create-recurring';
};

export type PendingFillRecurringTradingWrite = PendingTradingWriteBase & {
  amountInput: string;
  escrowContract?: string;
  kind: 'fill-recurring-side';
  side: PendingRecurringFillSide;
  tradeId: number;
};

export type PendingRecurringStatusTradingWrite = PendingTradingWriteBase & {
  action: PendingRecurringStatusAction;
  escrowContract?: string;
  kind: 'update-recurring-status';
  tradeId: number;
};

export type PendingTradingWrite =
  | PendingAcceptTradingWrite
  | PendingPartialFillTradingWrite
  | PendingTradeStatusTradingWrite
  | PendingCreateTradingWrite
  | PendingCreateRecurringTradingWrite
  | PendingFillRecurringTradingWrite
  | PendingRecurringStatusTradingWrite;

type PendingTradingWriteDraftFor<T> = T extends unknown
  ? Omit<T, 'id' | 'resumeCount' | 'timestamp' | 'walletAddress'> & { walletAddress?: string | null }
  : never;

export type PendingTradingWriteDraft = PendingTradingWriteDraftFor<PendingTradingWrite>;

type PendingTradingWriteStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

const PENDING_TRADING_WRITE_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING_TRADING_WRITE_RESUMES = 1;

const getSessionStorage = (): PendingTradingWriteStorage | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const normalizeWalletAddress = (value?: string | null): string => value?.trim().toLowerCase() ?? '';

const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
};

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value : '');

const normalizeBoolean = (value: unknown): boolean => value === true;

const normalizeSafeInteger = (value: unknown): number | undefined => {
  if (!Number.isSafeInteger(value)) {
    return undefined;
  }
  const numeric = Number(value);
  return numeric > 0 ? numeric : undefined;
};

const normalizeStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const isCounterAcceptMode = (value: unknown): value is PendingTradingCounterAcceptMode =>
  value === 'close-related' || value === 'accept-only';

const isRecurringFillSide = (value: unknown): value is PendingRecurringFillSide =>
  value === 'buy' || value === 'sell';

const isRecurringStatusAction = (value: unknown): value is PendingRecurringStatusAction =>
  value === 'pause' || value === 'resume' || value === 'cancel';

const createPendingTradingWriteId = (now: number): string =>
  `p2p-write:${now.toString(36)}:${Math.random().toString(36).slice(2, 10)}`;

const sanitizeRoutePathForDiagnostics = (routePath: string): string => {
  try {
    const parsed = new URL(routePath, 'https://chainwhisper.local');
    return parsed.pathname.match(/^\/trades\/l\/[^/]+$/i) ? '/trades/l/[link]' : parsed.pathname;
  } catch {
    return routePath.split('?')[0]?.split('#')[0] ?? '';
  }
};

const normalizeTradeCreateForm = (value: unknown): PendingTradeCreateForm | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const form = value as Partial<PendingTradeCreateForm>;
  return {
    directTradeRecipient: normalizeString(form.directTradeRecipient),
    tradeHasNoExpiry: normalizeBoolean(form.tradeHasNoExpiry),
    tradeHidePrivateLiquidity: normalizeBoolean(form.tradeHidePrivateLiquidity),
    tradeOfferAmountInput: normalizeString(form.tradeOfferAmountInput),
    tradeOfferCustomTokenAddress: normalizeString(form.tradeOfferCustomTokenAddress),
    tradeOfferTokenSelection: normalizeString(form.tradeOfferTokenSelection),
    tradePriceInput: normalizeString(form.tradePriceInput),
    tradePricingEditedFields: normalizeStringArray(form.tradePricingEditedFields),
    tradeRequestAmountInput: normalizeString(form.tradeRequestAmountInput),
    tradeRequestCustomTokenAddress: normalizeString(form.tradeRequestCustomTokenAddress),
    tradeRequestTokenSelection: normalizeString(form.tradeRequestTokenSelection),
    tradeVisibility: normalizeString(form.tradeVisibility)
  };
};

const normalizeRecurringCreateForm = (value: unknown): PendingRecurringCreateForm | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const form = value as Partial<PendingRecurringCreateForm>;
  return {
    recurringAddBuyBudgetInput: normalizeString(form.recurringAddBuyBudgetInput),
    recurringAddSellInventoryInput: normalizeString(form.recurringAddSellInventoryInput),
    recurringBuyPriceInput: normalizeString(form.recurringBuyPriceInput),
    recurringBuyReceiveEditable: normalizeBoolean(form.recurringBuyReceiveEditable),
    recurringBuyReceiveInput: normalizeString(form.recurringBuyReceiveInput),
    recurringHidePrivateAmounts: normalizeBoolean(form.recurringHidePrivateAmounts),
    recurringRemoveBuyBudgetInput: normalizeString(form.recurringRemoveBuyBudgetInput),
    recurringRemoveSellInventoryInput: normalizeString(form.recurringRemoveSellInventoryInput),
    recurringSellPriceInput: normalizeString(form.recurringSellPriceInput),
    recurringSellReceiveEditable: normalizeBoolean(form.recurringSellReceiveEditable),
    recurringSellReceiveInput: normalizeString(form.recurringSellReceiveInput),
    tradeOfferCustomTokenAddress: normalizeString(form.tradeOfferCustomTokenAddress),
    tradeOfferTokenSelection: normalizeString(form.tradeOfferTokenSelection),
    tradeRequestCustomTokenAddress: normalizeString(form.tradeRequestCustomTokenAddress),
    tradeRequestTokenSelection: normalizeString(form.tradeRequestTokenSelection)
  };
};

const normalizePendingTradingWrite = (
  value: Partial<PendingTradingWrite>,
  now: number
): PendingTradingWrite | null => {
  const raw = value as Record<string, unknown>;
  const kind = value.kind;
  const timestamp = typeof value.timestamp === 'number' ? value.timestamp : 0;
  const walletAddress = normalizeWalletAddress(value.walletAddress);
  const routePath = typeof value.routePath === 'string' && value.routePath.startsWith('/') ? value.routePath : '';
  const chainId = typeof value.chainId === 'number' && Number.isFinite(value.chainId) ? value.chainId : null;
  const resumeCount = Number.isSafeInteger(value.resumeCount) ? Math.max(0, Number(value.resumeCount)) : 0;
  const id = typeof value.id === 'string' && value.id ? value.id : createPendingTradingWriteId(now);
  if (!kind || !walletAddress || !routePath || !timestamp || now - timestamp > PENDING_TRADING_WRITE_TTL_MS) {
    return null;
  }

  const base: PendingTradingWriteBase = {
    chainId,
    id,
    routePath,
    resumeCount,
    timestamp,
    walletAddress
  };

  if (kind === 'create-trade') {
    const form = normalizeTradeCreateForm(value.form);
    if (!form) {
      return null;
    }
    const context = raw.context && typeof raw.context === 'object' ? raw.context as Record<string, unknown> : {};
    return {
      ...base,
      context: {
        counterParentEscrowContract: normalizeOptionalString(context.counterParentEscrowContract),
        counterParentTradeId: normalizeSafeInteger(context.counterParentTradeId),
        editingEscrowContract: normalizeOptionalString(context.editingEscrowContract),
        editingTradeId: normalizeSafeInteger(context.editingTradeId)
      },
      form,
      kind
    };
  }

  if (kind === 'create-recurring') {
    const form = normalizeRecurringCreateForm(value.form);
    if (!form) {
      return null;
    }
    const context = raw.context && typeof raw.context === 'object' ? raw.context as Record<string, unknown> : {};
    return {
      ...base,
      context: {
        editingEscrowContract: normalizeOptionalString(context.editingEscrowContract),
        editingTradeId: normalizeSafeInteger(context.editingTradeId)
      },
      form,
      kind
    };
  }

  const tradeId = normalizeSafeInteger(raw.tradeId);
  if (!tradeId) {
    return null;
  }
  const escrowContract = normalizeOptionalString(raw.escrowContract);

  if (kind === 'accept-trade') {
    return {
      ...base,
      counterAcceptMode: isCounterAcceptMode(raw.counterAcceptMode) ? raw.counterAcceptMode : undefined,
      escrowContract,
      kind,
      tradeId
    };
  }

  if (kind === 'partial-fill') {
    const amountInput = normalizeString(raw.amountInput);
    if (!amountInput) {
      return null;
    }
    return {
      ...base,
      amountInput,
      escrowContract,
      kind,
      tradeId
    };
  }

  if (kind === 'cancel-trade' || kind === 'decline-trade') {
    return {
      ...base,
      escrowContract,
      kind,
      tradeId
    };
  }

  if (kind === 'fill-recurring-side') {
    const amountInput = normalizeString(raw.amountInput);
    if (!amountInput || !isRecurringFillSide(raw.side)) {
      return null;
    }
    return {
      ...base,
      amountInput,
      escrowContract,
      kind,
      side: raw.side,
      tradeId
    };
  }

  if (kind === 'update-recurring-status') {
    if (!isRecurringStatusAction(raw.action)) {
      return null;
    }
    return {
      ...base,
      action: raw.action,
      escrowContract,
      kind,
      tradeId
    };
  }

  return null;
};

export const readPendingTradingWrite = (
  storage: PendingTradingWriteStorage | null = getSessionStorage(),
  now = Date.now()
): PendingTradingWrite | null => {
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(PENDING_TRADING_WRITE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const write = normalizePendingTradingWrite(JSON.parse(raw) as Partial<PendingTradingWrite>, now);
    if (!write) {
      storage.removeItem(PENDING_TRADING_WRITE_STORAGE_KEY);
      return null;
    }
    return write;
  } catch {
    try {
      storage.removeItem(PENDING_TRADING_WRITE_STORAGE_KEY);
    } catch {
    }
    return null;
  }
};

export const writePendingTradingWrite = (
  write: PendingTradingWriteDraft,
  storage: PendingTradingWriteStorage | null = getSessionStorage(),
  now = Date.now()
): PendingTradingWrite | null => {
  if (!storage) {
    return null;
  }
  const nextWrite = normalizePendingTradingWrite(
    {
      ...write,
      id: createPendingTradingWriteId(now),
      resumeCount: 0,
      timestamp: now,
      walletAddress: normalizeWalletAddress(write.walletAddress)
    } as Partial<PendingTradingWrite>,
    now
  );
  if (!nextWrite) {
    return null;
  }
  try {
    storage.setItem(PENDING_TRADING_WRITE_STORAGE_KEY, JSON.stringify(nextWrite));
    return nextWrite;
  } catch {
    return null;
  }
};

export const clearPendingTradingWrite = (
  storage: PendingTradingWriteStorage | null = getSessionStorage()
): void => {
  try {
    storage?.removeItem(PENDING_TRADING_WRITE_STORAGE_KEY);
  } catch {
  }
};

export const markPendingTradingWriteResuming = (
  storage: PendingTradingWriteStorage | null = getSessionStorage(),
  now = Date.now()
): PendingTradingWrite | null => {
  const write = readPendingTradingWrite(storage, now);
  if (!write || write.resumeCount >= MAX_PENDING_TRADING_WRITE_RESUMES) {
    return null;
  }
  const nextWrite = normalizePendingTradingWrite(
    {
      ...write,
      resumeCount: write.resumeCount + 1
    },
    now
  );
  if (!nextWrite) {
    clearPendingTradingWrite(storage);
    return null;
  }
  try {
    storage?.setItem(PENDING_TRADING_WRITE_STORAGE_KEY, JSON.stringify(nextWrite));
    return nextWrite;
  } catch {
    return null;
  }
};

export const pendingTradingWriteCanResumeAgain = (write: PendingTradingWrite): boolean =>
  write.resumeCount < MAX_PENDING_TRADING_WRITE_RESUMES;

export const pendingTradingWriteMatchesWallet = (
  write: PendingTradingWrite,
  walletAddress?: string | null,
  chainId?: number | null
): boolean =>
  write.walletAddress === normalizeWalletAddress(walletAddress) &&
  (write.chainId === null || chainId === null || chainId === undefined || write.chainId === chainId);

export const sanitizePendingTradingWriteForDiagnostics = (write: PendingTradingWrite): Record<string, unknown> => {
  const base = {
    chainId: write.chainId,
    id: write.id,
    kind: write.kind,
    resumeCount: write.resumeCount,
    routePath: sanitizeRoutePathForDiagnostics(write.routePath),
    timestamp: write.timestamp
  };
  if ('tradeId' in write) {
    return {
      ...base,
      action: 'action' in write ? write.action : undefined,
      side: 'side' in write ? write.side : undefined,
      tradeId: write.tradeId
    };
  }
  return {
    ...base,
    context:
      write.kind === 'create-trade' || write.kind === 'create-recurring'
        ? {
            hasCounterParent: write.kind === 'create-trade' ? Boolean(write.context.counterParentTradeId) : false,
            hasEditingTrade: Boolean(write.context.editingTradeId)
          }
        : undefined
  };
};

export const clearPendingTradingWritesForTest = clearPendingTradingWrite;
