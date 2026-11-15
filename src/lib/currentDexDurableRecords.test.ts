// CW-086 part B, decision-033: DEX reconciliation records are durable, shared by all tabs and separate per wallet.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_DEX_OPERATION_LOOKUPS_KEY, CURRENT_DEX_PENDING_ATTEMPT_KEY, CURRENT_POOL_REFRESH_ATTEMPT_KEY, CurrentDexTabRecordConflict,
  currentDexPendingStorage, currentDexScopedRecordKey, readCurrentDexOperationLookups, readCurrentDexPendingAttempt,
  recordCurrentDexOperationLookup, recordCurrentDexPendingHash, reserveCurrentDexPendingAttempt, type CurrentDexPendingAttempt
} from './currentDexPendingAttempt';
import { CURRENT_DEX_NATIVE_RELOAD_KEY, currentDexNormalUseReloadKey, readCurrentDexNativeReload, writeCurrentDexNativeReload } from './currentDexNativeReload';

const hex = (byte: string, bytes = 32) => `0x${byte.repeat(bytes)}`;
const ownerA = hex('aa', 20), ownerB = hex('bb', 20), core = hex('cc', 20), graph = '9c'.repeat(32), otherGraph = '7b'.repeat(32);
const scopeA = { chainId: 7082400n, graph, owner: ownerA }, scopeB = { chainId: 7082400n, graph, owner: ownerB };
const attempt = (owner = ownerA, patch: Partial<CurrentDexPendingAttempt> = {}): CurrentDexPendingAttempt => ({
  version: 1, chainId: '7082400', owner, core, graph: `0x${graph}`, phase: 'quote', callHash: hex('11'), nonce: 4, txHash: null, ...patch });
const lookup = (owner: string, txHash: string) => ({ attempt: attempt(owner, { phase: 'accept', txHash }), operationId: '7', contextHash: hex('22'),
  deadline: '900', origin: { number: 10, hash: hex('33') } });
const budget = (owner: string, start = '1') => ({ budget: { version: 2 as const, owner, candidateGraph: graph, start, committedWei: '0',
  activeSwap: null, charges: [] }, authentication: hex('44') });
const store = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
};
// One tab has its own session storage. All tabs of the site share the durable storage.
const tab = (durable = store(), session = store()) => { vi.stubGlobal('window', { sessionStorage: session, localStorage: durable }); return { durable, session }; };
afterEach(() => { vi.unstubAllGlobals(); });

describe('durable DEX reconciliation records', () => {
  it('uses the tab records unchanged on a platform with no durable storage', () => {
    const session = store(); vi.stubGlobal('window', { sessionStorage: session });
    expect(currentDexPendingStorage(scopeA)).toBe(session);
    expect(currentDexPendingStorage()).toBe(session);
  });
  it('is unavailable when the durable storage cannot be opened', () => {
    vi.stubGlobal('window', { sessionStorage: store(), get localStorage(): never { throw new Error('SecurityError'); } });
    expect(currentDexPendingStorage(scopeA)).toBeNull();
  });
  it('keeps the pending slot separate for each wallet, candidate and chain', () => {
    const { durable, session } = tab();
    reserveCurrentDexPendingAttempt(currentDexPendingStorage(scopeA), attempt());
    expect([...durable.values.keys()]).toEqual([`${CURRENT_DEX_PENDING_ATTEMPT_KEY}:7082400:${graph}:${ownerA}`]);
    expect(currentDexScopedRecordKey(CURRENT_DEX_PENDING_ATTEMPT_KEY, scopeA)).toBe(`${CURRENT_DEX_PENDING_ATTEMPT_KEY}:7082400:${graph}:${ownerA}`);
    expect(session.values.size).toBe(0);
    expect(readCurrentDexPendingAttempt(currentDexPendingStorage(scopeB))).toBeNull();
    expect(readCurrentDexPendingAttempt(currentDexPendingStorage({ ...scopeA, graph: otherGraph }))).toBeNull();
    reserveCurrentDexPendingAttempt(currentDexPendingStorage(scopeB), attempt(ownerB));
    expect(readCurrentDexPendingAttempt(currentDexPendingStorage(scopeA))).toEqual(attempt());
    expect(readCurrentDexPendingAttempt(currentDexPendingStorage(scopeB))).toEqual(attempt(ownerB));
  });
  it('shows an open action and its lookups to a new tab and blocks a second send there', () => {
    const first = tab(), saved = attempt();
    reserveCurrentDexPendingAttempt(currentDexPendingStorage(scopeA), saved);
    recordCurrentDexPendingHash(currentDexPendingStorage(scopeA), saved, hex('55'));
    recordCurrentDexOperationLookup(currentDexPendingStorage(scopeA), lookup(ownerA, hex('66')));
    tab(first.durable);
    const second = currentDexPendingStorage(scopeA);
    expect(readCurrentDexPendingAttempt(second)).toEqual({ ...saved, txHash: hex('55') });
    expect(readCurrentDexOperationLookups(second)).toEqual([lookup(ownerA, hex('66'))]);
    expect(() => reserveCurrentDexPendingAttempt(second, attempt(ownerA, { nonce: 5 }))).toThrow('pending attempt');
    expect(readCurrentDexPendingAttempt(second)).toEqual({ ...saved, txHash: hex('55') });
  });
  it('reads nothing and refuses a write when no wallet scope is given', () => {
    const { durable } = tab();
    reserveCurrentDexPendingAttempt(currentDexPendingStorage(scopeA), attempt());
    expect(readCurrentDexPendingAttempt(currentDexPendingStorage())).toBeNull();
    expect(readCurrentDexOperationLookups(currentDexPendingStorage())).toEqual([]);
    expect(() => reserveCurrentDexPendingAttempt(currentDexPendingStorage(), attempt(ownerB))).toThrow('could not be saved');
    expect(durable.values.size).toBe(1);
  });
  it('rejects a record that does not belong to the wallet scope of its slot', () => {
    tab();
    expect(() => reserveCurrentDexPendingAttempt(currentDexPendingStorage(scopeB), attempt(ownerA))).toThrow('could not be saved');
    expect(readCurrentDexPendingAttempt(currentDexPendingStorage(scopeB))).toBeNull();
  });
});

describe('one-time move of tab records to durable storage', () => {
  it('moves a tab record once, with identical bytes, to the scope of its own wallet', () => {
    const { durable, session } = tab(), raw = JSON.stringify(attempt(ownerA, { txHash: hex('55') }));
    session.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY, raw);
    // Another wallet is connected. The record of wallet A moves to the scope of wallet A and does not block wallet B.
    expect(readCurrentDexPendingAttempt(currentDexPendingStorage(scopeB))).toBeNull();
    expect(durable.values.get(currentDexScopedRecordKey(CURRENT_DEX_PENDING_ATTEMPT_KEY, scopeA))).toBe(raw);
    expect(session.values.size).toBe(0);
    expect(readCurrentDexPendingAttempt(currentDexPendingStorage(scopeA))).toEqual(JSON.parse(raw));
    expect([...durable.values.entries()]).toEqual([[currentDexScopedRecordKey(CURRENT_DEX_PENDING_ATTEMPT_KEY, scopeA), raw]]);
  });
  it('drops the tab copy when the durable record already has the same bytes', () => {
    const { durable, session } = tab(), raw = JSON.stringify(attempt());
    durable.setItem(currentDexScopedRecordKey(CURRENT_DEX_PENDING_ATTEMPT_KEY, scopeA), raw);
    session.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY, raw);
    expect(readCurrentDexPendingAttempt(currentDexPendingStorage(scopeA))).toEqual(attempt());
    expect(session.values.size).toBe(0); expect(durable.values.size).toBe(1);
  });
  it('moves a private refresh record with its held snapshot', () => {
    const { durable, session } = tab();
    const held = JSON.stringify(attempt(ownerA, { phase: 'pool-snapshot', txHash: hex('55'), verificationBlocked: true }));
    const refresh = JSON.stringify({ original: held, attempt: JSON.stringify(attempt(ownerA, { phase: 'pool-snapshot', nonce: 5, callHash: hex('77') })) });
    session.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY, held); session.setItem(CURRENT_POOL_REFRESH_ATTEMPT_KEY, refresh);
    const storage = currentDexPendingStorage(scopeA)!;
    expect(storage.getItem(CURRENT_POOL_REFRESH_ATTEMPT_KEY)).toBe(refresh);
    expect(storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(held);
    expect(durable.values.get(currentDexScopedRecordKey(CURRENT_POOL_REFRESH_ATTEMPT_KEY, scopeA))).toBe(refresh);
    expect(durable.values.get(currentDexScopedRecordKey(CURRENT_DEX_PENDING_ATTEMPT_KEY, scopeA))).toBe(held);
    expect(session.values.size).toBe(0);
  });
  it('moves operation lookups to the scope of each wallet and keeps existing durable lookups', () => {
    const { durable, session } = tab();
    const single = JSON.stringify([lookup(ownerA, hex('66'))]);
    session.setItem(CURRENT_DEX_OPERATION_LOOKUPS_KEY, single);
    expect(readCurrentDexOperationLookups(currentDexPendingStorage(scopeA))).toEqual([lookup(ownerA, hex('66'))]);
    expect(durable.values.get(currentDexScopedRecordKey(CURRENT_DEX_OPERATION_LOOKUPS_KEY, scopeA))).toBe(single);
    expect(session.values.size).toBe(0);
    // A second tab has one known lookup, one new lookup of wallet A and one lookup of wallet B.
    session.setItem(CURRENT_DEX_OPERATION_LOOKUPS_KEY, JSON.stringify([lookup(ownerA, hex('66')), lookup(ownerB, hex('88')), lookup(ownerA, hex('99'))]));
    expect(readCurrentDexOperationLookups(currentDexPendingStorage(scopeB))).toEqual([lookup(ownerB, hex('88'))]);
    expect(readCurrentDexOperationLookups(currentDexPendingStorage(scopeA))).toEqual([lookup(ownerA, hex('66')), lookup(ownerA, hex('99'))]);
    expect(session.values.size).toBe(0);
  });
  it('moves budget records under their own keys', () => {
    const { durable, session } = tab(), scoped = JSON.stringify(budget(ownerA)), old = JSON.stringify({ budget: { version: 1, owner: ownerB,
      candidateGraph: otherGraph, start: '1', committedWei: '0', activeSwap: null, charges: [] }, authentication: hex('44') });
    session.setItem(currentDexNormalUseReloadKey(scopeA), scoped); session.setItem(CURRENT_DEX_NATIVE_RELOAD_KEY, old);
    const storage = currentDexPendingStorage(scopeA);
    expect(readCurrentDexNativeReload(storage, scopeA)).toEqual(budget(ownerA));
    expect(durable.values.get(currentDexNormalUseReloadKey(scopeA))).toBe(scoped);
    expect(durable.values.get(CURRENT_DEX_NATIVE_RELOAD_KEY)).toBe(old);
    expect(session.values.size).toBe(0);
    writeCurrentDexNativeReload(storage, budget(ownerA, '2'), scopeA);
    expect(durable.values.get(currentDexNormalUseReloadKey(scopeA))).toBe(JSON.stringify(budget(ownerA, '2')));
    expect(session.values.size).toBe(0);
  });
  it('keeps both records and holds when a tab record differs from the durable record', () => {
    const { durable, session } = tab(), mine = JSON.stringify(attempt(ownerA, { nonce: 4 })), shared = JSON.stringify(attempt(ownerA, { nonce: 6, txHash: hex('55') }));
    const key = currentDexScopedRecordKey(CURRENT_DEX_PENDING_ATTEMPT_KEY, scopeA);
    session.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY, mine); durable.setItem(key, shared);
    for (const scope of [scopeA, scopeB]) {
      expect(() => readCurrentDexPendingAttempt(currentDexPendingStorage(scope))).toThrow(CurrentDexTabRecordConflict);
      expect(() => reserveCurrentDexPendingAttempt(currentDexPendingStorage(scope), attempt(scope.owner, { nonce: 7 }))).toThrow(CurrentDexTabRecordConflict);
    }
    expect(session.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(mine); expect(durable.values.get(key)).toBe(shared);
    expect(durable.values.size).toBe(1); expect(session.values.size).toBe(1);
    // A new tab has no tab record. It reads the shared record.
    tab(durable);
    expect(readCurrentDexPendingAttempt(currentDexPendingStorage(scopeA))).toEqual(JSON.parse(shared));
  });
  it('keeps both budget records and holds on a budget conflict', () => {
    const { durable, session } = tab(), mine = JSON.stringify(budget(ownerA, '1')), shared = JSON.stringify(budget(ownerA, '2'));
    session.setItem(currentDexNormalUseReloadKey(scopeA), mine); durable.setItem(currentDexNormalUseReloadKey(scopeA), shared);
    expect(() => readCurrentDexNativeReload(currentDexPendingStorage(scopeA), scopeA)).toThrow(CurrentDexTabRecordConflict);
    expect(() => writeCurrentDexNativeReload(currentDexPendingStorage(scopeA), budget(ownerA, '3'), scopeA)).toThrow(CurrentDexTabRecordConflict);
    expect(session.values.get(currentDexNormalUseReloadKey(scopeA))).toBe(mine); expect(durable.values.get(currentDexNormalUseReloadKey(scopeA))).toBe(shared);
  });
  it('keeps a lookup conflict in the tab and holds', () => {
    const { durable, session } = tab(), key = currentDexScopedRecordKey(CURRENT_DEX_OPERATION_LOOKUPS_KEY, scopeA);
    const shared = JSON.stringify([lookup(ownerA, hex('66'))]), mine = JSON.stringify([{ ...lookup(ownerA, hex('66')), operationId: '8' }]);
    durable.setItem(key, shared); session.setItem(CURRENT_DEX_OPERATION_LOOKUPS_KEY, mine);
    expect(() => readCurrentDexOperationLookups(currentDexPendingStorage(scopeA))).toThrow();
    expect(durable.values.get(key)).toBe(shared); expect(session.values.get(CURRENT_DEX_OPERATION_LOOKUPS_KEY)).toBe(mine);
  });
  it('keeps an invalid tab record in the tab and holds', () => {
    const { durable, session } = tab();
    session.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY, '{"version":1}');
    expect(() => readCurrentDexPendingAttempt(currentDexPendingStorage(scopeA))).toThrow();
    expect(session.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe('{"version":1}'); expect(durable.values.size).toBe(0);
  });
  it('keeps the tab record when the durable write does not persist', () => {
    const durable = store(), raw = JSON.stringify(attempt());
    const { session } = tab({ ...durable, setItem: () => {} });
    session.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY, raw);
    expect(() => readCurrentDexPendingAttempt(currentDexPendingStorage(scopeA))).toThrow();
    expect(session.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(raw);
  });
});

describe('durable records hold public reconciliation data only', () => {
  it('stores only the known record keys and public fields', () => {
    const { durable } = tab(), saved = attempt();
    reserveCurrentDexPendingAttempt(currentDexPendingStorage(scopeA), saved);
    recordCurrentDexPendingHash(currentDexPendingStorage(scopeA), saved, hex('55'));
    recordCurrentDexOperationLookup(currentDexPendingStorage(scopeA), lookup(ownerA, hex('66')));
    writeCurrentDexNativeReload(currentDexPendingStorage(scopeA), budget(ownerA), scopeA);
    const scopeSuffix = `:7082400:${graph}:${ownerA}`;
    expect([...durable.values.keys()].sort()).toEqual([
      `chainwhisper:dex:current-operation-lookups:v1${scopeSuffix}`, `chainwhisper:dex:current-pending-attempt:v1${scopeSuffix}`,
      `chainwhisper:dex:owner-normal-use:v2${scopeSuffix}`]);
    const fields = new Set<string>();
    const walk = (value: unknown) => { if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object')
      for (const [name, inner] of Object.entries(value)) { fields.add(name); walk(inner); } };
    for (const raw of durable.values.values()) walk(JSON.parse(raw));
    expect([...fields].sort()).toEqual(['activeSwap', 'attempt', 'authentication', 'budget', 'callHash', 'candidateGraph', 'chainId', 'charges',
      'committedWei', 'contextHash', 'core', 'deadline', 'graph', 'hash', 'nonce', 'number', 'operationId', 'origin', 'owner', 'phase', 'start',
      'txHash', 'version']);
    expect([...durable.values.values()].join('')).not.toMatch(/aesKey|ciphertext|signature|privateKey|mnemonic|maximumInput|minimumOutput/i);
  });
});
