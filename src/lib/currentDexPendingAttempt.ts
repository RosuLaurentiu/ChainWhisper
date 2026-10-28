// Public reconciliation metadata only. Storage is a duplicate-send guard, not signing authority.
type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type CurrentDexPendingAttempt = Readonly<{
  version: 1; chainId: string; owner: string; core: string; graph: string;
  phase: 'quote' | 'accept' | 'cancel' | 'recover' | 'pool-preview' | 'pool-fund' | 'pool-owner' | 'pool-transfer' | 'pool-snapshot' | 'limit-create' | 'limit-snapshot' | 'limit-owner' | 'token-faucet' | 'token-approve' | 'token-refill'; callHash: string; nonce: number; txHash: string | null;
  operationId?: string;
  target?: string;
  verificationBlocked?: true;
}>;
export const CURRENT_DEX_PENDING_ATTEMPT_KEY = 'chainwhisper:dex:current-pending-attempt:v1';
// Public lookup only. Confirmed Accept is no longer an uncertain send, but its
// operation must remain discoverable until authenticated terminal verification.
export const CURRENT_DEX_OPERATION_LOOKUPS_KEY = 'chainwhisper:dex:current-operation-lookups:v1';
export type CurrentDexOperationLookup = Readonly<{
  attempt: CurrentDexPendingAttempt; operationId: string; contextHash: string; deadline: string;
  origin: Readonly<{ number: number; hash: string }>;
}>;
const hex32 = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && BigInt(value) !== 0n;
const address = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value) && BigInt(value) !== 0n;
const valid = (value: unknown): value is CurrentDexPendingAttempt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const a = value as Partial<CurrentDexPendingAttempt>;
  const action = a.phase === 'cancel' || a.phase === 'recover';
  const blocked = a.verificationBlocked === true && ['token-faucet', 'token-approve', 'token-refill', 'quote', 'accept', 'cancel', 'recover', 'pool-preview', 'pool-fund', 'pool-owner', 'pool-snapshot', 'limit-create', 'limit-snapshot', 'limit-owner'].includes(a.phase ?? '');
  const targeted = a.target !== undefined;
  const keys = (blocked && action ?
    'callHash,chainId,core,graph,nonce,operationId,owner,phase,txHash,verificationBlocked,version' : blocked ?
    'callHash,chainId,core,graph,nonce,owner,phase,txHash,verificationBlocked,version' : action ?
    'callHash,chainId,core,graph,nonce,operationId,owner,phase,txHash,version' :
    'callHash,chainId,core,graph,nonce,owner,phase,txHash,version').split(',');
  if (targeted) keys.push('target');
  return Object.keys(value).sort().join(',') === keys.sort().join(',') &&
    (!targeted || address(a.target) && ['token-faucet', 'token-refill', 'token-approve'].includes(a.phase ?? '')) &&
    a.version === 1 && typeof a.chainId === 'string' && /^[1-9]\d*$/.test(a.chainId) &&
    address(a.owner) && address(a.core) && hex32(a.graph) &&
    (a.phase === 'quote' || a.phase === 'accept' || a.phase === 'pool-preview' || a.phase === 'pool-fund' || a.phase === 'pool-owner' || a.phase === 'pool-transfer' || a.phase === 'pool-snapshot' || a.phase === 'limit-create' || a.phase === 'limit-snapshot' || a.phase === 'limit-owner' || a.phase === 'token-faucet' || a.phase === 'token-approve' || a.phase === 'token-refill' || action) &&
    (!action || (typeof a.operationId === 'string' && /^[1-9]\d*$/.test(a.operationId))) && hex32(a.callHash) &&
    Number.isSafeInteger(a.nonce) && (a.nonce ?? -1) >= 0 && (a.txHash === null || hex32(a.txHash));
};
export const currentDexPendingStorage = (): PendingStorage | null => {
  if (typeof window === 'undefined') return null;
  try { return window.sessionStorage; } catch { return null; }
};
export const readCurrentDexPendingAttempt = (storage: PendingStorage | null): CurrentDexPendingAttempt | null => {
  if (!storage) throw new Error('Current DEX pending-attempt storage is unavailable.');
  let raw: string | null;
  try { raw = storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY); } catch {
    throw new Error('Current DEX pending-attempt storage is unavailable.');
  }
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (valid(value)) return Object.freeze(value);
  } catch { /* A malformed record must not be cleared automatically. */ }
  throw new Error('Current DEX pending-attempt record is invalid; reconcile manually.');
};
const validLookup = (value: unknown): value is CurrentDexOperationLookup => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<CurrentDexOperationLookup>;
  return Object.keys(value).sort().join(',') === 'attempt,contextHash,deadline,operationId,origin' &&
    valid(entry.attempt) && entry.attempt.phase === 'accept' && entry.attempt.txHash !== null &&
    typeof entry.operationId === 'string' && /^[1-9]\d*$/.test(entry.operationId) && hex32(entry.contextHash) &&
    typeof entry.deadline === 'string' && /^[1-9]\d*$/.test(entry.deadline) &&
    !!entry.origin && Object.keys(entry.origin).sort().join(',') === 'hash,number' &&
    Number.isSafeInteger(entry.origin.number) && entry.origin.number >= 0 && hex32(entry.origin.hash);
};
export const readCurrentDexOperationLookups = (storage: PendingStorage | null): readonly CurrentDexOperationLookup[] => {
  if (!storage) throw new Error('Current DEX operation storage is unavailable.');
  try {
    const raw = storage.getItem(CURRENT_DEX_OPERATION_LOOKUPS_KEY);
    if (raw === null) return [];
    const entries: unknown = JSON.parse(raw);
    if (Array.isArray(entries) && entries.length <= 32 && entries.every(validLookup) &&
        new Set(entries.map(entry => entry.attempt.txHash)).size === entries.length) return entries;
  } catch { /* Keep invalid metadata for manual reconciliation. */ }
  throw new Error('Current DEX operation lookup record is invalid; reconcile manually.');
};
const writeLookups = (storage: PendingStorage | null, entries: readonly CurrentDexOperationLookup[]) => {
  if (!storage) throw new Error('Current DEX operation storage is unavailable.');
  const value = JSON.stringify(entries);
  try {
    if (entries.length) storage.setItem(CURRENT_DEX_OPERATION_LOOKUPS_KEY, value);
    else storage.removeItem(CURRENT_DEX_OPERATION_LOOKUPS_KEY);
    if (JSON.stringify(readCurrentDexOperationLookups(storage)) !== value) throw new Error('Write differs.');
  } catch { throw new Error('Current DEX operation lookup could not be saved.'); }
};
export const recordCurrentDexOperationLookup = (storage: PendingStorage | null, entry: CurrentDexOperationLookup) => {
  if (!validLookup(entry)) throw new Error('Current DEX operation lookup is invalid.');
  const entries = readCurrentDexOperationLookups(storage), prior = entries.find(row => row.attempt.txHash === entry.attempt.txHash);
  if (prior && JSON.stringify(prior) !== JSON.stringify(entry)) throw new Error('Current DEX operation lookup changed.');
  if (!prior) {
    if (entries.length >= 32) throw new Error('Current DEX operation lookup limit reached. Verify an existing private result first.');
    writeLookups(storage, [...entries, entry]);
  }
};
export const blockCurrentDexOperationVerification = (storage: PendingStorage | null, entry: CurrentDexOperationLookup) => {
  const entries = readCurrentDexOperationLookups(storage);
  const index = entries.findIndex(row => JSON.stringify(row) === JSON.stringify(entry));
  if (index < 0) throw new Error('Current DEX operation lookup changed.');
  writeLookups(storage, entries.map((row, i) => i === index ? { ...row, attempt: { ...row.attempt, verificationBlocked: true } } : row));
};
export const clearCurrentDexOperationLookup = (storage: PendingStorage | null, entry: CurrentDexOperationLookup) => {
  const entries = readCurrentDexOperationLookups(storage);
  if (!entries.some(row => JSON.stringify(row) === JSON.stringify(entry))) throw new Error('Current DEX operation lookup changed.');
  writeLookups(storage, entries.filter(row => JSON.stringify(row) !== JSON.stringify(entry)));
};
const same = (left: CurrentDexPendingAttempt, right: CurrentDexPendingAttempt) =>
  left.chainId === right.chainId && left.owner === right.owner && left.core === right.core &&
  left.graph === right.graph && left.phase === right.phase && left.callHash === right.callHash &&
  left.nonce === right.nonce && left.txHash === right.txHash && left.operationId === right.operationId && left.target === right.target && left.verificationBlocked === right.verificationBlocked;
const write = (storage: PendingStorage, attempt: CurrentDexPendingAttempt) => {
  try { storage.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify(attempt)); } catch {
    throw new Error('Current DEX pending attempt could not be saved.');
  }
  if (!same(readCurrentDexPendingAttempt(storage)!, attempt)) {
    throw new Error('Current DEX pending attempt did not persist.');
  }
};
export const reserveCurrentDexPendingAttempt = (storage: PendingStorage | null, attempt: CurrentDexPendingAttempt) => {
  if (!storage) throw new Error('Current DEX pending-attempt storage is unavailable.');
  if (!valid(attempt)) throw new Error('Current DEX pending attempt is invalid.');
  if (readCurrentDexPendingAttempt(storage)) throw new Error('Current DEX has a pending attempt; reconcile it before another send.');
  write(storage, attempt);
};
export const recordCurrentDexPendingHash = (storage: PendingStorage | null, attempt: CurrentDexPendingAttempt, txHash: string) => {
  const current = readCurrentDexPendingAttempt(storage);
  if (!current || !same(current, attempt) || !hex32(txHash)) throw new Error('Current DEX pending attempt changed.');
  write(storage!, { ...attempt, txHash });
};
export const blockCurrentTokenFundingVerification = (storage: PendingStorage | null, attempt: CurrentDexPendingAttempt) => {
  const current = readCurrentDexPendingAttempt(storage);
  if (!current || !same(current, attempt) || !['token-faucet', 'token-approve', 'token-refill'].includes(current.phase)) throw new Error('Current-token pending attempt changed.');
  write(storage!, { ...current, verificationBlocked: true });
};
export const blockCurrentSwapVerification = (storage: PendingStorage | null, attempt: CurrentDexPendingAttempt) => {
  const current = readCurrentDexPendingAttempt(storage);
  if (!current || !same(current, attempt) || !['quote', 'accept', 'cancel', 'recover'].includes(current.phase)) throw new Error('Current-swap pending attempt changed.');
  write(storage!, { ...current, verificationBlocked: true });
};
export const blockCurrentPoolVerification = (storage: PendingStorage | null, attempt: CurrentDexPendingAttempt) => {
  const current = readCurrentDexPendingAttempt(storage);
  if (!current || !same(current, attempt) || !['pool-preview', 'pool-fund', 'pool-owner', 'pool-snapshot'].includes(current.phase)) throw new Error('Current-Pool pending attempt changed.');
  write(storage!, { ...current, verificationBlocked: true });
};
export const blockCurrentLimitVerification = (storage: PendingStorage | null, attempt: CurrentDexPendingAttempt) => {
  const current=readCurrentDexPendingAttempt(storage);
  if(!current||!same(current,attempt)||!['limit-create','limit-snapshot','limit-owner'].includes(current.phase))throw new Error('Current-Limit pending attempt changed.');
  write(storage!,{...current,verificationBlocked:true});
};
export const clearCurrentDexPendingAttempt = (storage: PendingStorage | null, attempt: CurrentDexPendingAttempt) => {
  const current = readCurrentDexPendingAttempt(storage);
  if (!current || !same(current, attempt)) throw new Error('Current DEX pending attempt changed.');
  try { storage!.removeItem(CURRENT_DEX_PENDING_ATTEMPT_KEY); } catch {
    throw new Error('Current DEX pending attempt could not be cleared.');
  }
  if (readCurrentDexPendingAttempt(storage)) throw new Error('Current DEX pending attempt could not be cleared.');
};

