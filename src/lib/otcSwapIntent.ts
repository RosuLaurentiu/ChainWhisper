import type { OtcSwapInputMode } from './otcSwapQuote';

export type OtcSwapIntentTerminalInput =
  | {
      kind: 'standard';
      inputSide: 'pay' | 'buy';
    }
  | {
      kind: 'recurring';
      displayAction: 'sell' | 'buy';
      fillSide: 'buy' | 'sell';
    };

export type OtcSwapIntent = {
  version: 1;
  tradeKey: string;
  tradeId: number;
  escrowContract?: string;
  inputMode: OtcSwapInputMode;
  sellTokenKey: string;
  sellTokenSymbol: string;
  sellTokenDecimals: number;
  buyTokenKey: string;
  buyTokenSymbol: string;
  buyTokenDecimals: number;
  requestedSellAmountWei: string;
  requestedBuyAmountWei: string;
  terminalInputAmountWei: string;
  terminalInput: OtcSwapIntentTerminalInput;
  privateLiquidity: boolean;
  timestamp: number;
};

export type OtcSwapFillNote = {
  tradeKey: string;
  txHash?: string;
  requestedAmountWei: string;
  requestedAssetKey: string;
  requestedSymbol: string;
  requestedDecimals: number;
  requestedRole: 'sold' | 'bought';
  privateLiquidity: boolean;
  timestamp: number;
};

type TradeRouteStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

const PENDING_OTC_SWAP_INTENT_STORAGE_KEY = 'chainwhisper:p2p:pending-swap-intent:v1';
const OTC_SWAP_FILL_NOTES_STORAGE_KEY = 'chainwhisper:p2p:swap-fill-notes:v1';
export const OTC_SWAP_INTENT_TTL_MS = 10 * 60 * 1000;
const OTC_SWAP_FILL_NOTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const isPositiveIntegerString = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+$/.test(value);

const isTerminalInput = (value: unknown): value is OtcSwapIntentTerminalInput => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<OtcSwapIntentTerminalInput>;
  if (candidate.kind === 'standard') {
    return candidate.inputSide === 'pay' || candidate.inputSide === 'buy';
  }
  if (candidate.kind === 'recurring') {
    return (
      (candidate.displayAction === 'sell' || candidate.displayAction === 'buy') &&
      (candidate.fillSide === 'buy' || candidate.fillSide === 'sell')
    );
  }
  return false;
};

const getSessionStorage = (): TradeRouteStorage | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const getLocalStorage = (): TradeRouteStorage | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const normalizeTradeKey = (value: string): string => value.trim().toLowerCase();

const normalizeTxHash = (value?: string): string => value?.trim().toLowerCase() ?? '';

const parsePendingIntent = (value: string | null, now: number): OtcSwapIntent | null => {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<OtcSwapIntent>;
    const timestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : 0;
    if (
      parsed.version !== 1 ||
      !parsed.tradeKey ||
      !Number.isSafeInteger(parsed.tradeId) ||
      (parsed.tradeId ?? 0) <= 0 ||
      (parsed.inputMode !== 'sell' && parsed.inputMode !== 'buy') ||
      !parsed.sellTokenKey ||
      !parsed.buyTokenKey ||
      typeof parsed.sellTokenSymbol !== 'string' ||
      typeof parsed.buyTokenSymbol !== 'string' ||
      typeof parsed.sellTokenDecimals !== 'number' ||
      typeof parsed.buyTokenDecimals !== 'number' ||
      !isPositiveIntegerString(parsed.requestedSellAmountWei) ||
      !isPositiveIntegerString(parsed.requestedBuyAmountWei) ||
      !isPositiveIntegerString(parsed.terminalInputAmountWei) ||
      !isTerminalInput(parsed.terminalInput) ||
      now - timestamp > OTC_SWAP_INTENT_TTL_MS
    ) {
      return null;
    }
    const tradeId = parsed.tradeId;
    if (typeof tradeId !== 'number') {
      return null;
    }
    return {
      version: 1,
      tradeKey: normalizeTradeKey(parsed.tradeKey),
      tradeId,
      escrowContract: typeof parsed.escrowContract === 'string' ? parsed.escrowContract : undefined,
      inputMode: parsed.inputMode,
      sellTokenKey: parsed.sellTokenKey,
      sellTokenSymbol: parsed.sellTokenSymbol,
      sellTokenDecimals: parsed.sellTokenDecimals,
      buyTokenKey: parsed.buyTokenKey,
      buyTokenSymbol: parsed.buyTokenSymbol,
      buyTokenDecimals: parsed.buyTokenDecimals,
      requestedSellAmountWei: parsed.requestedSellAmountWei,
      requestedBuyAmountWei: parsed.requestedBuyAmountWei,
      terminalInputAmountWei: parsed.terminalInputAmountWei,
      terminalInput: parsed.terminalInput,
      privateLiquidity: Boolean(parsed.privateLiquidity),
      timestamp
    };
  } catch {
    return null;
  }
};

export const rememberPendingOtcSwapIntent = (
  intent: OtcSwapIntent,
  storage: TradeRouteStorage | null = getSessionStorage()
): void => {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(PENDING_OTC_SWAP_INTENT_STORAGE_KEY, JSON.stringify({
      ...intent,
      tradeKey: normalizeTradeKey(intent.tradeKey)
    }));
  } catch {
  }
};

export const readPendingOtcSwapIntent = (
  storage: TradeRouteStorage | null = getSessionStorage(),
  now = Date.now()
): OtcSwapIntent | null => {
  if (!storage) {
    return null;
  }
  const intent = parsePendingIntent(storage.getItem(PENDING_OTC_SWAP_INTENT_STORAGE_KEY), now);
  if (!intent) {
    try {
      storage.removeItem(PENDING_OTC_SWAP_INTENT_STORAGE_KEY);
    } catch {
    }
  }
  return intent;
};

export const readPendingOtcSwapIntentForTrade = (
  tradeKey: string,
  storage: TradeRouteStorage | null = getSessionStorage(),
  now = Date.now()
): OtcSwapIntent | null => {
  const intent = readPendingOtcSwapIntent(storage, now);
  return intent && intent.tradeKey === normalizeTradeKey(tradeKey) ? intent : null;
};

export const clearPendingOtcSwapIntent = (storage: TradeRouteStorage | null = getSessionStorage()): void => {
  try {
    storage?.removeItem(PENDING_OTC_SWAP_INTENT_STORAGE_KEY);
  } catch {
  }
};

const parseFillNotes = (storage: TradeRouteStorage | null, now: number): OtcSwapFillNote[] => {
  if (!storage) {
    return [];
  }
  try {
    const parsed = JSON.parse(storage.getItem(OTC_SWAP_FILL_NOTES_STORAGE_KEY) ?? '[]') as Array<Partial<OtcSwapFillNote>>;
    return parsed
      .filter((note): note is OtcSwapFillNote =>
        Boolean(
          note &&
            typeof note.tradeKey === 'string' &&
            isPositiveIntegerString(note.requestedAmountWei) &&
            typeof note.requestedAssetKey === 'string' &&
            typeof note.requestedSymbol === 'string' &&
            typeof note.requestedDecimals === 'number' &&
            (note.requestedRole === 'sold' || note.requestedRole === 'bought') &&
            typeof note.timestamp === 'number' &&
            now - note.timestamp <= OTC_SWAP_FILL_NOTE_TTL_MS
        )
      )
      .map((note) => ({
        ...note,
        tradeKey: normalizeTradeKey(note.tradeKey),
        txHash: note.txHash ? normalizeTxHash(note.txHash) : undefined
      }));
  } catch {
    return [];
  }
};

export const loadOtcSwapFillNotes = (
  storage: TradeRouteStorage | null = getLocalStorage(),
  now = Date.now()
): OtcSwapFillNote[] => parseFillNotes(storage, now);

export const rememberOtcSwapFillNote = (
  note: OtcSwapFillNote,
  storage: TradeRouteStorage | null = getLocalStorage(),
  now = Date.now()
): OtcSwapFillNote[] => {
  const notes = parseFillNotes(storage, now);
  const nextNote: OtcSwapFillNote = {
    ...note,
    tradeKey: normalizeTradeKey(note.tradeKey),
    txHash: note.txHash ? normalizeTxHash(note.txHash) : undefined,
    timestamp: note.timestamp || now
  };
  const next = [
    nextNote,
    ...notes.filter((existing) =>
      nextNote.txHash
        ? normalizeTxHash(existing.txHash) !== nextNote.txHash
        : existing.tradeKey !== nextNote.tradeKey || existing.requestedAssetKey !== nextNote.requestedAssetKey
    )
  ].slice(0, 50);
  try {
    storage?.setItem(OTC_SWAP_FILL_NOTES_STORAGE_KEY, JSON.stringify(next));
  } catch {
  }
  return next;
};

export const findOtcSwapFillNote = (
  notes: OtcSwapFillNote[],
  tradeKey: string,
  txHash?: string
): OtcSwapFillNote | null => {
  const normalizedTradeKey = normalizeTradeKey(tradeKey);
  const normalizedTxHash = normalizeTxHash(txHash);
  return (
    notes.find((note) =>
      normalizedTxHash
        ? note.tradeKey === normalizedTradeKey && normalizeTxHash(note.txHash) === normalizedTxHash
        : note.tradeKey === normalizedTradeKey
    ) ?? null
  );
};
