import { describe, expect, it } from 'vitest';
import { addCurrentPositionReview, currentPositionReviewFor, currentPositionReviewKey, currentReviewedPositionArchiveKey,
  readCurrentPositionReviews, releaseCurrentPositionReview, currentDexManageAttentionView, type CurrentPositionReview } from './currentDexPositionReview';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY, type CurrentDexPendingAttempt } from './currentDexPendingAttempt';

// CW-140.02: a mined, held top-up waits on its own position, not in the single saved-action record.
const h = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const scope = { chainId: '7082400', owner: `0x${'AB'.repeat(20)}`, core: `0x${'CD'.repeat(20)}` };
const store = () => { const values = new Map<string, string>();
  return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } }; };
const entry = (over: Partial<CurrentPositionReview> = {}): CurrentPositionReview => ({ version: 1, positionId: '56', txHash: h(1), poolTopUpHash: h(2),
  verificationFailure: 'pool-proof', reviewable: true, canonicalStatus: 1, blockHash: h(3), fundingBlockHash: h(4), original: '{"phase":"pool-snapshot"}', ...over });

describe('position review list (CW-140.02)', () => {
  it('adds, finds and releases one entry; the archive is written before the entry leaves', () => {
    const s = store();
    addCurrentPositionReview(s, scope, entry());
    addCurrentPositionReview(s, scope, entry({ positionId: '57', txHash: h(5), reviewable: false, poolTopUpHash: null, fundingBlockHash: null, verificationFailure: 'top-up-accounting' }));
    const rows = readCurrentPositionReviews(s, scope);
    expect(rows.map(r => r.positionId)).toEqual(['56', '57']);
    expect(currentPositionReviewFor(rows, 56n)?.txHash).toBe(h(1));
    expect(currentPositionReviewFor(rows, '58')).toBeNull();
    expect(currentPositionReviewKey(scope)).toBe(`chainwhisper:dex:position-review:v1:7082400:0x${'ab'.repeat(20)}:0x${'cd'.repeat(20)}`);
    releaseCurrentPositionReview(s, scope, h(1), '{"verification":"owner-reviewed"}');
    expect(s.values.get(currentReviewedPositionArchiveKey(scope, h(1)))).toBe('{"verification":"owner-reviewed"}');
    expect(readCurrentPositionReviews(s, scope).map(r => r.positionId)).toEqual(['57']);
    releaseCurrentPositionReview(s, scope, h(5), '{}');
    expect(s.values.has(currentPositionReviewKey(scope))).toBe(false);
  });
  it('keeps one entry per transaction and rejects a different review of the same transaction', () => {
    const s = store();
    addCurrentPositionReview(s, scope, entry());
    addCurrentPositionReview(s, scope, entry());
    expect(readCurrentPositionReviews(s, scope)).toHaveLength(1);
    expect(() => addCurrentPositionReview(s, scope, entry({ blockHash: h(9) }))).toThrow('different review');
  });
  it('rejects invalid entries, a reviewable entry without funding proof and a corrupted list', () => {
    const s = store();
    expect(() => addCurrentPositionReview(s, scope, entry({ txHash: 'x' }))).toThrow('invalid');
    expect(() => addCurrentPositionReview(s, scope, entry({ fundingBlockHash: null }))).toThrow('invalid');
    expect(() => addCurrentPositionReview(s, scope, entry({ canonicalStatus: 0 }))).toThrow('invalid');
    s.values.set(currentPositionReviewKey(scope), '[{"version":2}]');
    expect(() => readCurrentPositionReviews(s, scope)).toThrow('invalid');
  });
  it('refuses to replace a different archive and keeps the entry', () => {
    const s = store();
    addCurrentPositionReview(s, scope, entry());
    s.values.set(currentReviewedPositionArchiveKey(scope, h(1)), 'other');
    expect(() => releaseCurrentPositionReview(s, scope, h(1), 'mine')).toThrow('different reviewed record');
    expect(readCurrentPositionReviews(s, scope)).toHaveLength(1);
  });
});

describe('Manage opens on the item that needs the owner (CW-140.08)', () => {
  const binding = { ...scope, owner: scope.owner.toLowerCase(), core: scope.core.toLowerCase(), graph: `0x${'33'.repeat(32)}` };
  const attempt = (phase: CurrentDexPendingAttempt['phase'], over: Partial<CurrentDexPendingAttempt> = {}): CurrentDexPendingAttempt => ({ version: 1,
    chainId: binding.chainId, owner: binding.owner, core: binding.core, graph: binding.graph, phase, nonce: 4, txHash: h(9), callHash: h(8), ...over });
  it('chooses Positions for a Pool action or a saved review, Orders for a Limit action and nothing otherwise', () => {
    const s = store();
    expect(currentDexManageAttentionView(s, binding)).toBeNull();
    addCurrentPositionReview(s, scope, entry());
    expect(currentDexManageAttentionView(s, binding)).toBe('positions');
    const t = store();
    t.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify(attempt('limit-create')));
    expect(currentDexManageAttentionView(t, binding)).toBe('activity');
    t.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify(attempt('pool-snapshot')));
    expect(currentDexManageAttentionView(t, binding)).toBe('positions');
    t.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify(attempt('pool-preview', { txHash: null })));
    expect(currentDexManageAttentionView(t, binding)).toBe('positions');
    t.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify(attempt('quote')));
    expect(currentDexManageAttentionView(t, binding)).toBeNull();
  });
  it('chooses nothing for another wallet, an unreadable record or no storage', () => {
    const s = store();
    s.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify(attempt('pool-snapshot', { owner: `0x${'99'.repeat(20)}` })));
    expect(currentDexManageAttentionView(s, binding)).toBeNull();
    s.values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, '{');
    expect(currentDexManageAttentionView(s, binding)).toBeNull();
    expect(currentDexManageAttentionView(null, binding)).toBeNull();
  });
});
