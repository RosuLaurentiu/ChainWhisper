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
  // decision-033: the wallet reported user rejection (code 4001) and returned no hash.
  // A fact only. Release also needs the chain nonce check at the send boundary.
  walletRejected?: true;
}>;
export const CURRENT_DEX_PENDING_ATTEMPT_KEY = 'chainwhisper:dex:current-pending-attempt:v1';
// The first reviewed record (CW-129) stays under its own key. Later records get one key each.
const REVIEWED_POOL_PREVIEW_ARCHIVE_PREFIX = 'chainwhisper:dex:reviewed-pool-preview:v1';

// CW-134: any Pool preview with no returned hash can be released after owner review. A preview moves
// no tokens. Funding and every other phase stay held. The send boundary still checks the wallet nonce.
export const isReviewedPoolPreview = (attempt: CurrentDexPendingAttempt | null): boolean =>
  !!attempt && attempt.phase === 'pool-preview' && attempt.txHash === null &&
  attempt.walletRejected === undefined && attempt.verificationBlocked === undefined &&
  attempt.target === undefined && attempt.operationId === undefined && attempt.poolTopUpHash === undefined;
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
    // CW-140.02: one plain message and one button per item that needs attention.
    label: preview ? 'Open the new Pool' : view === 'activity' ? 'Open the order' : view === 'liquidity' ? 'Open Liquidity' : 'Open the position',
    message: preview ? 'A Pool preview needs your attention. For a new Pool, open Liquidity; for a top-up, open the position. Nothing is resent.' :
      view === 'activity' ? 'A Limit order needs your attention. Open it to check its status. Nothing is resent.' :
      view === 'liquidity' ? 'A deposit needs your attention. Open Liquidity to finish it. Nothing is resent.' :
      'A position needs your attention. Open it to check its status. Nothing is resent.' };
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
  if (a.walletRejected !== undefined) {
    // Only a record with no hash and no verification hold can carry the rejection fact.
    if (a.walletRejected !== true || a.txHash !== null || a.verificationBlocked !== undefined) return false;
    keys.push('walletRejected');
  }
  return Object.keys(value).sort().join(',') === keys.sort().join(',') &&
    (!targeted || address(a.target) && ['token-faucet', 'token-refill', 'token-approve'].includes(a.phase ?? '')) &&
    a.version === 1 && typeof a.chainId === 'string' && /^[1-9]\d*$/.test(a.chainId) &&
    address(a.owner) && address(a.core) && hex32(a.graph) &&
    (a.phase === 'quote' || a.phase === 'accept' || a.phase === 'pool-preview' || a.phase === 'pool-fund' || a.phase === 'pool-owner' || a.phase === 'pool-transfer' || a.phase === 'pool-snapshot' || a.phase === 'limit-create' || a.phase === 'limit-snapshot' || a.phase === 'limit-owner' || a.phase === 'token-faucet' || a.phase === 'token-approve' || a.phase === 'token-refill' || action) &&
    (!action || (typeof a.operationId === 'string' && /^[1-9]\d*$/.test(a.operationId))) && hex32(a.callHash) &&
    Number.isSafeInteger(a.nonce) && (a.nonce ?? -1) >= 0 && (a.txHash === null || hex32(a.txHash));
};
// decision-033 part B (CW-086). The reconciliation records are durable and shared by all tabs of this site.
// The pending slot, the private refresh slot and the operation lookups are separate for each chain, candidate and wallet.
// The records hold public reconciliation data only. Privacy keys stay in the wallet session.
export type CurrentDexRecordScope = Readonly<{ chainId: bigint | number | string; graph: string; owner: string }>;
export class CurrentDexTabRecordConflict extends Error {
  constructor() {
    super('This tab has a saved DEX record that differs from the shared record of this browser. Both records are kept and no request is sent from this tab. Check the saved action in the tab that has the shared record. Do not resend.');
    this.name = 'CurrentDexTabRecordConflict';
  }
}
const SCOPED_RECORD_KEYS: readonly string[] = [CURRENT_DEX_PENDING_ATTEMPT_KEY, CURRENT_POOL_REFRESH_ATTEMPT_KEY, CURRENT_DEX_OPERATION_LOOKUPS_KEY];
const recordScopeSuffix = (chainId: string, graph: string, owner: string) => {
  const plainGraph = graph.toLowerCase().replace(/^0x/, ''), plainOwner = owner.toLowerCase();
  if (!/^[1-9]\d*$/.test(chainId) || !/^[0-9a-f]{64}$/.test(plainGraph) || !/^0x[0-9a-f]{40}$/.test(plainOwner)) throw new Error('Current DEX record scope is invalid.');
  return `:${chainId}:${plainGraph}:${plainOwner}`;
};
export const currentDexScopedRecordKey = (key: string, scope: CurrentDexRecordScope) => {
  if (!SCOPED_RECORD_KEYS.includes(key)) throw new Error('This DEX record has no wallet scope.');
  return `${key}${recordScopeSuffix(String(scope.chainId), scope.graph, scope.owner)}`;
};
const invalidTabRecord = () => new Error('A saved DEX record of this tab is invalid; reconcile manually. Do not resend.');
// The wallet scope of a tab record comes from the record itself, never from the connected wallet.
const tabRecordSuffix = (value: unknown) => {
  if (!valid(value)) throw invalidTabRecord();
  return recordScopeSuffix(value.chainId, value.graph, value.owner);
};
const durableRecordStorage = (durable: PendingStorage, session: PendingStorage, scope?: CurrentDexRecordScope): PendingStorage => {
  const suffix = scope ? recordScopeSuffix(String(scope.chainId), scope.graph, scope.owner) : null;
  const moveExact = (target: string, raw: string) => {
    const existing = durable.getItem(target);
    if (existing === null) {
      durable.setItem(target, raw);
      if (durable.getItem(target) !== raw) throw new Error('A saved DEX record of this tab could not be moved to shared storage. Keep this tab open.');
    } else if (existing !== raw) throw new CurrentDexTabRecordConflict();
  };
  const moveLookups = (raw: string) => {
    let entries: unknown;
    try { entries = JSON.parse(raw); } catch { throw invalidTabRecord(); }
    if (!Array.isArray(entries) || !entries.every(validLookup)) throw invalidTabRecord();
    const groups = new Map<string, CurrentDexOperationLookup[]>();
    for (const entry of entries) {
      const target = CURRENT_DEX_OPERATION_LOOKUPS_KEY + tabRecordSuffix(entry.attempt);
      groups.set(target, [...groups.get(target) ?? [], entry]);
    }
    // Check every wallet scope before the first write. A conflict changes nothing.
    const writes: [string, string][] = [];
    for (const [target, moved] of groups) {
      const existing = durable.getItem(target);
      if (existing === null) { writes.push([target, groups.size === 1 ? raw : JSON.stringify(moved)]); continue; }
      let shared: unknown;
      try { shared = JSON.parse(existing); } catch { throw new CurrentDexTabRecordConflict(); }
      if (!Array.isArray(shared) || !shared.every(validLookup)) throw new CurrentDexTabRecordConflict();
      const added = moved.filter(entry => {
        const prior = (shared as CurrentDexOperationLookup[]).find(row => row.attempt.txHash === entry.attempt.txHash);
        if (prior && JSON.stringify(prior) !== JSON.stringify(entry)) throw new CurrentDexTabRecordConflict();
        return !prior;
      });
      if (shared.length + added.length > 32) throw new CurrentDexTabRecordConflict();
      if (added.length) writes.push([target, JSON.stringify([...shared, ...added])]);
    }
    for (const [target, value] of writes) {
      durable.setItem(target, value);
      if (durable.getItem(target) !== value) throw new Error('A saved DEX record of this tab could not be moved to shared storage. Keep this tab open.');
    }
  };
  // Moves the record that this tab saved under `key` before part B. The tab copy is removed only after the
  // durable record has the same content. A different durable record is a conflict: both stay and the tab holds.
  const adopt = (key: string) => {
    const raw = session.getItem(key);
    if (raw === null) return;
    if (key === CURRENT_DEX_OPERATION_LOOKUPS_KEY) moveLookups(raw);
    else if (!SCOPED_RECORD_KEYS.includes(key)) moveExact(key, raw);
    else {
      let record: unknown;
      try { record = JSON.parse(raw); } catch { throw invalidTabRecord(); }
      if (key === CURRENT_POOL_REFRESH_ATTEMPT_KEY) {
        const refresh = record as { attempt?: unknown } | null;
        if (!refresh || typeof refresh.attempt !== 'string') throw invalidTabRecord();
        try { record = JSON.parse(refresh.attempt); } catch { throw invalidTabRecord(); }
      }
      moveExact(key + tabRecordSuffix(record), raw);
    }
    session.removeItem(key);
  };
  const physical = (key: string) => SCOPED_RECORD_KEYS.includes(key) ? suffix === null ? null : key + suffix : key;
  // A scoped slot accepts only a record of its own chain, candidate and wallet.
  const assertOwnScope = (key: string, value: string) => {
    if (!SCOPED_RECORD_KEYS.includes(key)) return;
    let record: unknown;
    try {
      record = JSON.parse(value);
      if (key === CURRENT_POOL_REFRESH_ATTEMPT_KEY) record = JSON.parse((record as { attempt: string }).attempt);
    } catch { throw new Error('Current DEX record is invalid.'); }
    const rows = key === CURRENT_DEX_OPERATION_LOOKUPS_KEY && Array.isArray(record) ? record.map(entry => (entry as { attempt?: unknown })?.attempt) : [record];
    if (rows.some(row => !valid(row) || recordScopeSuffix(row.chainId, row.graph, row.owner) !== suffix)) throw new Error('Current DEX record belongs to another wallet scope.');
  };
  return {
    getItem: key => { adopt(key); const target = physical(key); return target === null ? null : durable.getItem(target); },
    setItem: (key, value) => {
      adopt(key); const target = physical(key);
      if (target === null) throw new Error('A wallet scope is required to save this DEX record.');
      assertOwnScope(key, value); durable.setItem(target, value);
    },
    removeItem: key => {
      adopt(key); const target = physical(key);
      if (target === null) throw new Error('A wallet scope is required to clear this DEX record.');
      durable.removeItem(target);
    }
  };
};
export const currentDexPendingStorage = (scope?: CurrentDexRecordScope): PendingStorage | null => {
  if (typeof window === 'undefined') return null;
  try {
    const session = window.sessionStorage;
    // A platform with no durable storage API keeps the previous records of the tab. A browser always has the API;
    // when the browser blocks it, the records are unavailable and nothing is sent.
    if (!('localStorage' in window)) return session;
    const durable = window.localStorage;
    return durable && session ? durableRecordStorage(durable, session, scope) : null;
  } catch { return null; }
};
export const readCurrentDexPendingAttempt = (storage: PendingStorage | null): CurrentDexPendingAttempt | null => {
  if (!storage) throw new Error('Current DEX pending-attempt storage is unavailable.');
  let raw: string | null;
  try { raw = storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY); } catch (error) {
    if (error instanceof CurrentDexTabRecordConflict) throw error;
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
  left.nonce === right.nonce && left.txHash === right.txHash && left.operationId === right.operationId && left.target === right.target && left.poolTopUpHash === right.poolTopUpHash && left.verificationBlocked === right.verificationBlocked && left.verificationFailure === right.verificationFailure &&
  left.walletRejected === right.walletRejected;
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
  // A hash from the wallet or the chain replaces an earlier rejection fact: the record is then reconciled by its hash.
  write(storage!, { ...attempt, txHash, walletRejected: undefined });
};
// decision-033. Saves the wallet rejection fact before any release check, so that the
// same check can run again after an RPC failure or a reload. It does not release the action.
export const markCurrentDexPendingWalletRejected = (storage: PendingStorage | null, attempt: CurrentDexPendingAttempt): CurrentDexPendingAttempt => {
  const current = readCurrentDexPendingAttempt(storage);
  if (!current || current.txHash !== null || current.verificationBlocked ||
      !same(current, attempt) && !same(current, { ...attempt, walletRejected: true })) throw new Error('Current DEX pending attempt changed.');
  if (current.walletRejected) return current;
  const marked: CurrentDexPendingAttempt = Object.freeze({ ...current, walletRejected: true as const });
  write(storage!, marked);
  return marked;
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

export const archiveReviewedPoolPreview = (storage: PendingStorage, attempt: CurrentDexPendingAttempt) => {
  if (typeof window === 'undefined' || !('localStorage' in window))
    throw new Error('Shared browser storage is unavailable. Keep the pending record.');
  const raw = storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY);
  if (raw === null || !isReviewedPoolPreview(attempt) || !same(JSON.parse(raw), attempt)) throw new Error('The reviewed preview record changed. Keep the pending record.');
  // One preserved copy for each released record. The same record is never released twice.
  const archiveKey = `${REVIEWED_POOL_PREVIEW_ARCHIVE_PREFIX}${recordScopeSuffix(attempt.chainId, attempt.graph, attempt.owner)}:${attempt.nonce}:${attempt.callHash}`;
  if (storage.getItem(CURRENT_POOL_REFRESH_ATTEMPT_KEY) !== null || storage.getItem(archiveKey) !== null)
    throw new Error('The reviewed preview record changed or was already saved. Keep the pending record.');
  storage.setItem(archiveKey, raw);
  if (storage.getItem(archiveKey) !== raw || storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY) !== raw)
    throw new Error('The original preview record could not be preserved. Keep the pending record.');
  clearCurrentDexPendingAttempt(storage, attempt);
};

