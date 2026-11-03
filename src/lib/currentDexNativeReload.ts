// Public financial reservations only. Authentication and signing stay in the wallet consumer.
type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
import type { CurrentNativeSwapCheckpoint } from './currentDexNativeSwapPolicy';
export const CURRENT_DEX_NATIVE_RELOAD_KEY = 'chainwhisper:dex:native-reload:v1';
export const CURRENT_DEX_NORMAL_USE_RELOAD_KEY = 'chainwhisper:dex:owner-normal-use:v2';
export type CurrentDexReloadScope = Readonly<{ owner: string; graph: string; chainId: bigint }>;
export const currentDexNormalUseReloadKey = (scope: CurrentDexReloadScope) => {
  if (scope.chainId !== 7082400n || !/^0x[0-9a-f]{40}$/i.test(scope.owner) || !/^[0-9a-f]{64}$/.test(scope.graph)) throw new Error('Native reload scope is invalid.');
  return `${CURRENT_DEX_NORMAL_USE_RELOAD_KEY}:${scope.chainId}:${scope.graph}:${scope.owner.toLowerCase()}`;
};
export type CurrentDexNativeReloadRecord = Readonly<{ budget: CurrentNativeSwapCheckpoint; authentication: string }>;
export const readCurrentDexNativeReload = (storage: PendingStorage | null, normalUse: boolean | CurrentDexReloadScope = false,
  retainedScope?: CurrentDexReloadScope): CurrentDexNativeReloadRecord | null => {
  if (!storage) throw new Error('Native reload storage is unavailable.');
  const scope = typeof normalUse === 'object' ? normalUse : retainedScope;
  const keys = typeof normalUse === 'object' ? [[currentDexNormalUseReloadKey(normalUse), 2], [CURRENT_DEX_NORMAL_USE_RELOAD_KEY, 2], [CURRENT_DEX_NATIVE_RELOAD_KEY, 1]] as const :
    normalUse ? [[CURRENT_DEX_NORMAL_USE_RELOAD_KEY, 2], [CURRENT_DEX_NATIVE_RELOAD_KEY, 1]] as const : [[CURRENT_DEX_NATIVE_RELOAD_KEY, 1]] as const;
  let selected: CurrentDexNativeReloadRecord | null = null;
  for (const [key, version] of keys) {
    let raw: string | null;
    try { raw = storage.getItem(key); } catch { throw new Error('Native reload storage is unavailable.'); }
    if (raw === null) continue;
    let record: CurrentDexNativeReloadRecord;
    try {
      record = JSON.parse(raw);
      const budget = record?.budget;
      if (!record || Object.keys(record).sort().join(',') !== 'authentication,budget' || budget?.version !== version ||
          !/^0x[0-9a-f]{64}$/.test(record.authentication) || !/^0x[0-9a-f]{40}$/.test(budget.owner) ||
          !/^[0-9a-f]{64}$/.test(budget.candidateGraph) || !Array.isArray(budget.charges) ||
          budget.activeSwap !== null && typeof budget.activeSwap !== 'string' || scope && (
          budget.activeSwap !== null && !/^quote:0x[0-9a-f]{64}$/.test(budget.activeSwap) ||
          typeof budget.start !== 'string' || !/^[0-9]+$/.test(budget.start) ||
          typeof budget.committedWei !== 'string' || !/^[0-9]+$/.test(budget.committedWei) ||
          budget.charges.some(row => !row || typeof row.gasCap !== 'string' || !/^[1-9][0-9]*$/.test(row.gasCap) ||
            row.gasPrice !== undefined && (typeof row.gasPrice !== 'string' || !/^[1-9][0-9]*$/.test(row.gasPrice)) ||
            !Number.isSafeInteger(row.nonce) || row.nonce < 0 || typeof row.key !== 'string' || !/^quote:0x[0-9a-f]{64}$/.test(row.scope) ||
            !['quote','accept','cancel','recover','token-funding','token-faucet'].includes(row.phase) ||
            row.hash !== null && (!/^0x[0-9a-f]{64}$/.test(row.hash) || BigInt(row.hash) === 0n)) ||
          budget.charges.reduce((sum,row) => sum + BigInt(row.gasCap) * BigInt(row.gasPrice ?? '50000000'),0n) !== BigInt(budget.committedWei))) throw new Error();
    } catch { throw new Error('Native reload reservation is invalid; keep the pending action.'); }
    if (scope && (record.budget.owner !== scope.owner.toLowerCase() || record.budget.candidateGraph !== scope.graph)) {
      if (key === currentDexNormalUseReloadKey(scope)) throw new Error('Native reload reservation identity changed.');
      // Retain foreign records. An unfinished reservation must not become a clean session.
      if (record.budget.activeSwap !== null || record.budget.charges.some(row => !row?.hash)) throw new Error('Reconcile the retained active native record before normal use.');
      continue;
    }
    if (!selected) selected = record;
    else if (scope && (record.budget.activeSwap !== null || record.budget.charges.some(row => !row?.hash)))
      throw new Error('Reconcile the retained active native record before normal use.');
  }
  return selected;
};
export const writeCurrentDexNativeReload = (storage: PendingStorage | null, record: CurrentDexNativeReloadRecord, scope?: CurrentDexReloadScope) => {
  if (!storage) throw new Error('Native reload storage is unavailable.');
  const raw = JSON.stringify(record), normalUse = record.budget.version === 2;
  if (scope && (!normalUse || record.budget.owner !== scope.owner.toLowerCase() || record.budget.candidateGraph !== scope.graph)) throw new Error('Native reload write scope changed.');
  let key = scope ? currentDexNormalUseReloadKey(scope) : normalUse ? CURRENT_DEX_NORMAL_USE_RELOAD_KEY : CURRENT_DEX_NATIVE_RELOAD_KEY;
  if (scope) {
    const retained=readCurrentDexNativeReload(storage,scope);
    // Continue an existing matching v2 journal in place; never copy an active journal into a second slot.
    try {
      const old=storage.getItem(CURRENT_DEX_NORMAL_USE_RELOAD_KEY);
      if(storage.getItem(key)===null && retained?.budget.version===2 && old!==null && JSON.stringify(JSON.parse(old))===JSON.stringify(retained))
        key=CURRENT_DEX_NORMAL_USE_RELOAD_KEY;
    } catch { throw new Error('Native reload storage is unavailable.'); }
  }
  try { storage.setItem(key, raw); } catch { throw new Error('Native reload reservation could not be saved.'); }
  if (JSON.stringify(readCurrentDexNativeReload(storage, scope ?? normalUse)) !== raw) throw new Error('Native reload reservation did not persist.');
};
