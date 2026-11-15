// CW-086, decision-033: release of a wallet-rejected action that was never sent.
// Journal and ledger rules only. The send boundary has its own test file.
const browserContexts = vi.hoisted(() => new WeakMap<object, { owner: string }>());
import { describe, expect, it, vi } from 'vitest';
vi.mock('../features/wallet/ownerCotiMetaMaskCapability', () => ({
  hasCurrentDexBrowserSigner: (signer: object | undefined, owner: string) =>
    !!signer && browserContexts.get(signer)?.owner === owner.toLowerCase()
}));
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as candidate } from './selectedCurrentDexCandidate';
import {
  currentNativeSigningBudget, currentNativeSwapCheckpoint, recordCurrentNativeSwapHash,
  releaseCurrentNativeSwapCharge, restoreCurrentNativeSwapCheckpoint, validateCurrentNativeSwapCheckpoint
} from './currentDexNativeSwapPolicy';
import {
  CURRENT_DEX_PENDING_ATTEMPT_KEY, clearCurrentDexPendingAttempt, markCurrentDexPendingWalletRejected,
  readCurrentDexPendingAttempt, recordCurrentDexPendingHash, reserveCurrentDexPendingAttempt,
  type CurrentDexPendingAttempt
} from './currentDexPendingAttempt';

const memoryStorage = () => {
  const rows = new Map<string, string>();
  return { rows, getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
};
const owner = `0x${'a1'.repeat(20)}`;
const now = () => 1_800_000_000n;
const hash = (byte: string) => `0x${byte.repeat(32)}`;
const scopeOf = (byte: string) => `quote:${hash(byte)}`;
const browserSigner = () => { const signer = {}; browserContexts.set(signer, { owner }); return signer; };
const attempt = (overrides: Partial<CurrentDexPendingAttempt> = {}): CurrentDexPendingAttempt => ({
  version: 1, chainId: '7082400', owner, core: candidate.core.toLowerCase(), graph: `0x${candidate.graph}`,
  phase: 'quote', callHash: hash('44'), nonce: 7, txHash: null, ...overrides });

describe('pending-send record: wallet rejection fact', () => {
  it('marks a record that has no hash and keeps it readable', () => {
    const storage = memoryStorage(), saved = attempt();
    reserveCurrentDexPendingAttempt(storage, saved);
    const marked = markCurrentDexPendingWalletRejected(storage, saved);
    expect(marked).toEqual({ ...saved, walletRejected: true });
    expect(readCurrentDexPendingAttempt(storage)).toEqual({ ...saved, walletRejected: true });
    // The mark is idempotent for the same record.
    expect(markCurrentDexPendingWalletRejected(storage, marked)).toEqual(marked);
    clearCurrentDexPendingAttempt(storage, marked);
    expect(readCurrentDexPendingAttempt(storage)).toBeNull();
  });
  it('refuses the mark when a hash exists or the record changed', () => {
    const storage = memoryStorage(), saved = attempt();
    reserveCurrentDexPendingAttempt(storage, saved);
    expect(() => markCurrentDexPendingWalletRejected(storage, attempt({ nonce: 8 }))).toThrow('changed');
    recordCurrentDexPendingHash(storage, saved, hash('55'));
    expect(() => markCurrentDexPendingWalletRejected(storage, { ...saved, txHash: hash('55') })).toThrow();
    expect(readCurrentDexPendingAttempt(storage)).toEqual({ ...saved, txHash: hash('55') });
  });
  it('rejects a stored record that claims rejection and also has a hash', () => {
    const storage = memoryStorage();
    storage.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify({ ...attempt({ txHash: hash('55') }), walletRejected: true }));
    expect(() => readCurrentDexPendingAttempt(storage)).toThrow('invalid');
    storage.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify({ ...attempt(), walletRejected: false }));
    expect(() => readCurrentDexPendingAttempt(storage)).toThrow('invalid');
  });
  it('lets a known hash replace the rejection fact, so that a broadcast after a reported rejection is reconciled by hash', () => {
    const storage = memoryStorage(), saved = attempt();
    reserveCurrentDexPendingAttempt(storage, saved);
    const marked = markCurrentDexPendingWalletRejected(storage, saved);
    expect(() => recordCurrentDexPendingHash(storage, saved, hash('55'))).toThrow('changed');
    recordCurrentDexPendingHash(storage, marked, hash('55'));
    const stored = readCurrentDexPendingAttempt(storage);
    expect(stored).toEqual({ ...saved, txHash: hash('55') });
    expect(stored).not.toHaveProperty('walletRejected');
    expect(() => markCurrentDexPendingWalletRejected(storage, stored!)).toThrow('changed');
  });
});

describe('normal-use budget: release of an unsent reservation', () => {
  it('moves an unsent Quote reservation to the released list and frees its nonce, key and scope', () => {
    const signer = browserSigner(), budget = currentNativeSigningBudget(signer, owner, now, candidate), scope = scopeOf('ce');
    budget.commit('quote', scope, 110_000_000n, scope, 5);
    const before = currentNativeSwapCheckpoint(signer);
    expect(before).toMatchObject({ version: 2, activeSwap: scope, committedWei: '5500000000000000' });
    expect(before).not.toHaveProperty('released');
    expect(releaseCurrentNativeSwapCharge(signer, owner, candidate, 5, hash('ce'))).toBeTypeOf('function');
    const after = currentNativeSwapCheckpoint(signer);
    expect(after).toEqual({ ...before, activeSwap: null, committedWei: '0', charges: [], released: before.charges });
    expect(after.released![0]).toMatchObject({ phase: 'quote', key: scope, scope, nonce: 5, hash: null });
    expect(() => validateCurrentNativeSwapCheckpoint(after, owner, candidate, signer)).not.toThrow();
    // The same nonce and the same prepared Quote can be reserved again.
    budget.commit('quote', scope, 110_000_000n, scope, 5);
    expect(currentNativeSwapCheckpoint(signer)).toMatchObject({ activeSwap: scope, charges: [{ nonce: 5, hash: null }], released: before.charges });
    expect(() => validateCurrentNativeSwapCheckpoint(currentNativeSwapCheckpoint(signer), owner, candidate, signer)).not.toThrow();
  });
  it('keeps the swap scope when an unsent Accept is released', () => {
    const signer = browserSigner(), budget = currentNativeSigningBudget(signer, owner, now, candidate), scope = scopeOf('ce');
    budget.commit('quote', scope, 110_000_000n, scope, 5);
    recordCurrentNativeSwapHash(signer, 5, hash('ce'), hash('ab'));
    budget.commit('accept', `accept:${scope}`, 110_000_000n, scope, 6);
    expect(releaseCurrentNativeSwapCharge(signer, owner, candidate, 6, hash('77'))).toBeTypeOf('function');
    const after = currentNativeSwapCheckpoint(signer);
    expect(after).toMatchObject({ activeSwap: scope, committedWei: '5500000000000000',
      charges: [{ phase: 'quote', nonce: 5, hash: hash('ab') }], released: [{ phase: 'accept', nonce: 6, hash: null }] });
    expect(() => validateCurrentNativeSwapCheckpoint(after, owner, candidate, signer)).not.toThrow();
    budget.commit('accept', `accept:${scope}`, 110_000_000n, scope, 6);
    expect(currentNativeSwapCheckpoint(signer).charges).toHaveLength(2);
  });
  it('restores a record with released rows byte for byte', () => {
    const signer = browserSigner(), budget = currentNativeSigningBudget(signer, owner, now, candidate), scope = scopeOf('ce');
    budget.commit('quote', scope, 110_000_000n, scope, 5);
    releaseCurrentNativeSwapCharge(signer, owner, candidate, 5, hash('ce'));
    const saved = JSON.parse(JSON.stringify(currentNativeSwapCheckpoint(signer)));
    const reloaded = browserSigner();
    restoreCurrentNativeSwapCheckpoint(reloaded, owner, candidate, saved);
    expect(JSON.stringify(currentNativeSwapCheckpoint(reloaded))).toBe(JSON.stringify(saved));
  });
  it('reports an earlier release of the same reservation without a second change', () => {
    const signer = browserSigner(), budget = currentNativeSigningBudget(signer, owner, now, candidate), scope = scopeOf('ce');
    budget.commit('quote', scope, 110_000_000n, scope, 5);
    releaseCurrentNativeSwapCharge(signer, owner, candidate, 5, hash('ce'));
    const once = JSON.stringify(currentNativeSwapCheckpoint(signer));
    expect(releaseCurrentNativeSwapCharge(signer, owner, candidate, 5, hash('ce'))).toBeNull();
    expect(JSON.stringify(currentNativeSwapCheckpoint(signer))).toBe(once);
  });
  it('undoes a release when the caller cannot save the record', () => {
    const signer = browserSigner(), budget = currentNativeSigningBudget(signer, owner, now, candidate), scope = scopeOf('ce');
    budget.commit('quote', scope, 110_000_000n, scope, 5);
    const before = JSON.stringify(currentNativeSwapCheckpoint(signer));
    const undo = releaseCurrentNativeSwapCharge(signer, owner, candidate, 5, hash('ce'))!;
    undo();
    expect(JSON.stringify(currentNativeSwapCheckpoint(signer))).toBe(before);
    expect(() => budget.commit('quote', scope, 110_000_000n, scope, 5)).toThrow();
  });
  it('refuses a release for a sent reservation, another nonce, another Quote or a signer without the browser context', () => {
    const signer = browserSigner(), budget = currentNativeSigningBudget(signer, owner, now, candidate), scope = scopeOf('ce');
    budget.commit('quote', scope, 110_000_000n, scope, 5);
    expect(() => releaseCurrentNativeSwapCharge(signer, owner, candidate, 4, hash('ce'))).toThrow();
    expect(() => releaseCurrentNativeSwapCharge(signer, owner, candidate, 5, hash('cf'))).toThrow();
    expect(() => releaseCurrentNativeSwapCharge({}, owner, candidate, 5, hash('ce'))).toThrow();
    recordCurrentNativeSwapHash(signer, 5, hash('ce'), hash('ab'));
    expect(() => releaseCurrentNativeSwapCharge(signer, owner, candidate, 5, hash('ce'))).toThrow();
    expect(currentNativeSwapCheckpoint(signer)).not.toHaveProperty('released');
  });
  it('rejects a changed released list', () => {
    const signer = browserSigner(), budget = currentNativeSigningBudget(signer, owner, now, candidate), scope = scopeOf('ce');
    budget.commit('quote', scope, 110_000_000n, scope, 5);
    releaseCurrentNativeSwapCharge(signer, owner, candidate, 5, hash('ce'));
    const saved = JSON.parse(JSON.stringify(currentNativeSwapCheckpoint(signer)));
    for (const released of [[], [{ ...saved.released[0], hash: hash('ab') }], [{ ...saved.released[0], extra: 1 }],
      [{ ...saved.released[0], gasCap: '1' }], [{ ...saved.released[0], scope: 'quote:0x12' }], 'none']) {
      expect(() => validateCurrentNativeSwapCheckpoint({ ...saved, released }, owner, candidate, signer)).toThrow();
    }
  });
});
