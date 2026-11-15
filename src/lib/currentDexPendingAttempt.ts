// Public reconciliation metadata only. Storage is a duplicate-send guard, not signing authority.
import { currentPoolVerificationFailure, isCurrentPoolVerificationFailure, type CurrentPoolVerificationFailure } from './currentDexPoolProofError';
type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type CurrentDexPendingAttempt = Readonly<{
  version: 1; chainId: string; owner: string; core: string; graph: string;
  phase: 'quote' | 'accept' | 'cancel' | 'recover' | 'pool-preview' | 'pool-fund' | 'pool-owner' | 'pool-transfer' | 'pool-snapshot' | 'limit-create' | 'limit-snapshot' | 'limit-owner' | 'token-faucet' | 'token-approve' | 'token-refill'; callHash: string; nonce: number; txHash: string | null;
  operationId?: string;
  target?: string;
  verificationBlocked?: true;
  verificationFailure?: CurrentPoolVerificationFailure;
  // Null marks funding; the snapshot retains that funding transaction's hash.
  poolTopUpHash?: string | null;
}>;
export const CURRENT_DEX_PENDING_ATTEMPT_KEY = 'chainwhisper:dex:current-pending-attempt:v1';
export type CurrentDexOwnerRecoveryView = 'positions' | 'liquidity' | 'activity';
// This selects a view only. It never verifies or clears the saved action.
export const currentDexOwnerRecovery = (attempt: CurrentDexPendingAttempt | null,
  binding: Pick<CurrentDexPendingAttempt, 'chainId' | 'owner' | 'core' | 'graph'>) => {
  if (!attempt || !/^(pool|limit)-/.test(attempt.phase)) return null;
  if (attempt.chainId !== binding.chainId || attempt.owner !== binding.owner.toLowerCase() ||
      attempt.core !== binding.core.toLowerCase() || attempt.graph !== binding.graph.toLowerCase())
    throw new Error('The saved action belongs to another wallet, network or contract. Restore that session to check it. Do not resend.');
  const view: CurrentDexOwnerRecoveryView = attempt.phase.startsWith('limit-') ? 'activity' :
    attempt.phase === 'pool-preview' || attempt.phase === 'pool-fund' && attempt.poolTopUpHash !== null ? 'liquidity' : 'positions';
  const preview = attempt.phase === 'pool-preview';
  return { view, alternateView: preview ? 'positions' as const : null,
    label: preview ? 'Open new-Pool recovery' : view === 'activity' ? 'Open order recovery' : view === 'liquidity' ? 'Open liquidity recovery' : 'Open position recovery',
    message: preview ? 'A Pool preview needs verification. For a new Pool, open Liquidity. For a top-up, open Manage → Positions. Use the existing action recovery; do not request another preview.' :
      `${view === 'activity' ? 'A Limit' : 'A Pool'} action needs verification. Open ${view === 'activity' ? 'Manage → Orders' : view === 'positions' ? 'Manage → Positions' : 'Liquidity'} and use Status and recovery. The saved record stays protected. Do not resend.` };
};
export const CURRENT_POOL_REFRESH_ATTEMPT_KEY = 'chainwhisper:dex:pool-refresh-attempt:v1';
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
  if (a.poolTopUpHash !== undefined) {
    if (!(a.phase === 'pool-fund' && a.poolTopUpHash === null || a.phase === 'pool-snapshot' && hex32(a.poolTopUpHash))) return false;
    keys.push('poolTopUpHash');
  }
  if (a.verificationFailure !== undefined) {
    if (!blocked || !['pool-owner', 'pool-snapshot', 'pool-preview', 'pool-fund'].includes(a.phase ?? '') || !isCurrentPoolVerificationFailure(a.verificationFailure)) return false;
    keys.push('verificationFailure');
  }
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
  if (raw === null) {
    if (storage.getItem(CURRENT_POOL_REFRESH_ATTEMPT_KEY) !== null) throw new Error('A private refresh record needs reconciliation. Do not resend.');
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (valid(value)) return Object.freeze(value);
  } catch { /* A malformed record must not be cleared automatically. */ }
  throw new Error('Current DEX pending-attempt record is invalid; reconcile manually.');
};
export const heldPoolSnapshotRefreshEligible = (attempt: CurrentDexPendingAttempt | null,
  binding: Pick<CurrentDexPendingAttempt, 'chainId' | 'owner' | 'core' | 'graph'>) =>
  !!attempt && attempt.phase === 'pool-snapshot' && attempt.verificationBlocked === true && !!attempt.txHash &&
  attempt.poolTopUpHash === undefined && attempt.target === undefined && attempt.operationId === undefined &&
  attempt.chainId === binding.chainId && attempt.owner === binding.owner.toLowerCase() && attempt.core === binding.core.toLowerCase() &&
  attempt.graph === binding.graph.toLowerCase();

// A new refresh owns a separate send slot. The original hold never moves or clears.
export const currentPoolRefreshStorage = (storage: PendingStorage | null, held: CurrentDexPendingAttempt, callHash?: string): PendingStorage => {
  if (!storage || !heldPoolSnapshotRefreshEligible(held, held)) throw new Error('A confirmed plain snapshot hold is required.');
  const original = storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY);
  if (JSON.stringify(readCurrentDexPendingAttempt(storage)) !== JSON.stringify(held)) throw new Error('Original snapshot hold changed.');
  const guard = () => {
    if (storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY) !== original) throw new Error('Original snapshot hold changed. Do not resend.');
  };
  const read = () => {
    guard(); const raw = storage.getItem(CURRENT_POOL_REFRESH_ATTEMPT_KEY); if (raw === null) return null;
    let record: { original?: unknown; attempt?: unknown };
    try { record = JSON.parse(raw); } catch { throw new Error('Private refresh record is invalid. Do not resend.'); }
    if (!record || Object.keys(record).sort().join(',') !== 'attempt,original' || record.original !== original ||
      typeof record.attempt !== 'string') throw new Error('Private refresh record changed. Do not resend.');
    return record.attempt;
  };
  // A send binds its prepared call; reload binds the existing refresh, not the old position.
  let refreshCallHash = callHash?.toLowerCase();
  const check = (raw: string) => {
    const attempt: unknown = JSON.parse(raw);
    if (!valid(attempt) || attempt.phase !== 'pool-snapshot' || attempt.poolTopUpHash !== undefined ||
      attempt.target !== undefined || attempt.operationId !== undefined || attempt.nonce <= held.nonce ||
      refreshCallHash !== undefined && attempt.callHash !== refreshCallHash ||
      ['chainId','owner','core','graph'].some(k => attempt[k as keyof CurrentDexPendingAttempt] !== held[k as keyof CurrentDexPendingAttempt]))
      throw new Error('Independent snapshot identity or nonce changed. Do not resend.');
    refreshCallHash ??= attempt.callHash;
    return raw;
  };
  return {
    getItem: key => key === CURRENT_DEX_PENDING_ATTEMPT_KEY ? (() => { const raw = read(); return raw === null ? null : check(raw); })() :
      key === CURRENT_POOL_REFRESH_ATTEMPT_KEY ? null : (guard(), storage.getItem(key)),
    setItem: (key, value) => {
      guard();
      if (key === CURRENT_DEX_PENDING_ATTEMPT_KEY) storage.setItem(CURRENT_POOL_REFRESH_ATTEMPT_KEY, JSON.stringify({ original, attempt: check(value) }));
      else if (key === CURRENT_POOL_REFRESH_ATTEMPT_KEY) throw new Error('Private refresh slot cannot be overwritten directly.');
      else storage.setItem(key, value);
      guard();
    },
    removeItem: key => { guard(); if (key !== CURRENT_DEX_PENDING_ATTEMPT_KEY) throw new Error('Only the private refresh slot can be cleared.');
      read(); storage.removeItem(CURRENT_POOL_REFRESH_ATTEMPT_KEY); guard(); },
  };
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
  left.nonce === right.nonce && left.txHash === right.txHash && left.operationId === right.operationId && left.target === right.target && left.poolTopUpHash === right.poolTopUpHash && left.verificationBlocked === right.verificationBlocked && left.verificationFailure === right.verificationFailure;
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
export const advanceCurrentPoolTopUpAttempt = (storage: PendingStorage | null, funding: CurrentDexPendingAttempt, snapshot: CurrentDexPendingAttempt) => {
  const current = readCurrentDexPendingAttempt(storage);
  if (!current || !same(current, funding) || current.verificationBlocked || current.phase !== 'pool-fund' || current.poolTopUpHash !== null || !current.txHash ||
    !valid(snapshot) || snapshot.phase !== 'pool-snapshot' || snapshot.poolTopUpHash !== current.txHash || snapshot.txHash !== null || snapshot.nonce <= current.nonce ||
    snapshot.chainId !== current.chainId || snapshot.owner !== current.owner || snapshot.core !== current.core || snapshot.graph !== current.graph)
    throw new Error('Top-up snapshot handoff changed. Keep the pending record.');
  write(storage!, snapshot);
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
export const blockCurrentPoolVerification = (storage: PendingStorage | null, attempt: CurrentDexPendingAttempt, error?: unknown) => {
  const current = readCurrentDexPendingAttempt(storage);
  if (!current || !same(current, attempt) || !['pool-preview', 'pool-fund', 'pool-owner', 'pool-snapshot'].includes(current.phase)) throw new Error('Current-Pool pending attempt changed.');
  write(storage!, { ...current, verificationBlocked: true,
    ...(current.verificationBlocked || error === undefined ? {} : { verificationFailure: currentPoolVerificationFailure(error) }) });
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

