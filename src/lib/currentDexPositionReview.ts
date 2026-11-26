// CW-140.02: mined Pool position transactions that wait only for the owner's review.
// A held top-up snapshot is mined, so it no longer owns the wallet nonce stream. It moves out of the single saved-action
// record into this per-position list. Swap, Limit and other positions are then free; only its own position stays locked
// until the owner reviews it. The list holds public transaction facts only, never keys or private amounts.
import { currentDexOwnerRecovery, readCurrentDexPendingAttempt } from './currentDexPendingAttempt';

type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type CurrentPositionReviewScope = Readonly<{ chainId: string; owner: string; core: string }>;
export type CurrentPositionReview = Readonly<{
  version: 1;
  positionId: string;
  txHash: string;
  poolTopUpHash: string | null;
  verificationFailure: string | null;
  /** The funding and snapshot were proved on chain and the hold reason allows the owner-reviewed release. */
  reviewable: boolean;
  canonicalStatus: 0 | 1;
  blockHash: string;
  fundingBlockHash: string | null;
  /** The exact saved-action record that this entry replaced. */
  original: string;
}>;

const MAX_REVIEWS = 32;
const hash = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && BigInt(value) !== 0n;
export const currentPositionReviewKey = (scope: CurrentPositionReviewScope) =>
  `chainwhisper:dex:position-review:v1:${scope.chainId}:${scope.owner.toLowerCase()}:${scope.core.toLowerCase()}`;
export const currentReviewedPositionArchiveKey = (scope: CurrentPositionReviewScope, txHash: string) =>
  `chainwhisper:dex:reviewed-position:v1:${scope.chainId}:${scope.owner.toLowerCase()}:${scope.core.toLowerCase()}:${txHash}`;

const validReview = (value: unknown): value is CurrentPositionReview => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).sort().join() === 'blockHash,canonicalStatus,fundingBlockHash,original,poolTopUpHash,positionId,reviewable,txHash,verificationFailure,version' &&
    v.version === 1 && typeof v.positionId === 'string' && /^[1-9][0-9]{0,77}$/.test(v.positionId) && hash(v.txHash) &&
    (v.poolTopUpHash === null || hash(v.poolTopUpHash)) && (v.verificationFailure === null || typeof v.verificationFailure === 'string' &&
      /^[a-z0-9-]{1,40}$/.test(v.verificationFailure)) && typeof v.reviewable === 'boolean' && (v.canonicalStatus === 0 || v.canonicalStatus === 1) &&
    hash(v.blockHash) && (v.fundingBlockHash === null || hash(v.fundingBlockHash)) && typeof v.original === 'string' && v.original.length > 0 &&
    v.original.length <= 8192 && (!v.reviewable || v.canonicalStatus === 1 && v.poolTopUpHash !== null && v.fundingBlockHash !== null);
};

export const readCurrentPositionReviews = (storage: PendingStorage | null, scope: CurrentPositionReviewScope): readonly CurrentPositionReview[] => {
  if (!storage) return Object.freeze([]);
  const raw = storage.getItem(currentPositionReviewKey(scope));
  if (raw === null) return Object.freeze([]);
  let rows: unknown;
  try { rows = JSON.parse(raw); } catch { throw new Error('Saved position review list is invalid. Keep it.'); }
  if (!Array.isArray(rows) || rows.length > MAX_REVIEWS || !rows.every(validReview) ||
      new Set(rows.map(row => row.txHash)).size !== rows.length) throw new Error('Saved position review list is invalid. Keep it.');
  return Object.freeze(rows as CurrentPositionReview[]);
};

export const currentPositionReviewFor = (reviews: readonly CurrentPositionReview[], positionId: bigint | string | null | undefined) => {
  if (positionId === null || positionId === undefined || positionId === '') return null;
  const id = String(positionId);
  return reviews.find(row => row.positionId === id) ?? null;
};

const write = (storage: PendingStorage, key: string, value: string, failure: string) => {
  storage.setItem(key, value);
  if (storage.getItem(key) !== value) throw new Error(failure);
};

/** Adds one entry. The same transaction with different facts is a conflict and changes nothing. */
export const addCurrentPositionReview = (storage: PendingStorage | null, scope: CurrentPositionReviewScope, entry: CurrentPositionReview) => {
  if (!storage) throw new Error('Position review storage is unavailable. Keep the saved action.');
  if (!validReview(entry)) throw new Error('Position review entry is invalid. Keep the saved action.');
  const rows = readCurrentPositionReviews(storage, scope), prior = rows.find(row => row.txHash === entry.txHash);
  if (prior) {
    if (JSON.stringify(prior) !== JSON.stringify(entry)) throw new Error('A different review of this transaction is saved. Keep the saved action.');
    return;
  }
  if (rows.length >= MAX_REVIEWS) throw new Error('Too many positions wait for review. Review one first.');
  write(storage, currentPositionReviewKey(scope), JSON.stringify([...rows, entry]), 'Position review was not retained. Keep the saved action.');
};

/** Archives the reviewed entry first, then removes it from the list. */
export const releaseCurrentPositionReview = (storage: PendingStorage | null, scope: CurrentPositionReviewScope, txHash: string, archive: string) => {
  if (!storage) throw new Error('Position review storage is unavailable. Keep the review.');
  const rows = readCurrentPositionReviews(storage, scope), entry = rows.find(row => row.txHash === txHash);
  if (!entry) throw new Error('This position review is no longer saved.');
  const archiveKey = currentReviewedPositionArchiveKey(scope, txHash), existing = storage.getItem(archiveKey);
  if (existing !== null && existing !== archive) throw new Error('A different reviewed record of this transaction is saved. Keep the review.');
  write(storage, archiveKey, archive, 'Reviewed position record was not retained. Keep the review.');
  const rest = rows.filter(row => row.txHash !== txHash), key = currentPositionReviewKey(scope);
  if (rest.length) write(storage, key, JSON.stringify(rest), 'Position review list was not updated. Keep the review.');
  else { storage.removeItem(key); if (storage.getItem(key) !== null) throw new Error('Position review list was not updated. Keep the review.'); }
  return entry;
};

/** CW-140.08: the Manage view that holds the item that waits for the owner. Null when nothing waits or a record cannot be read. */
export const currentDexManageAttentionView = (storage: PendingStorage | null,
  binding: Readonly<{ chainId: string; owner: string; core: string; graph: string }>): 'positions' | 'activity' | null => {
  try {
    const recovery = currentDexOwnerRecovery(readCurrentDexPendingAttempt(storage), binding);
    if (recovery) return recovery.view === 'positions' || recovery.alternateView === 'positions' ? 'positions' : recovery.view === 'activity' ? 'activity' : null;
    return readCurrentPositionReviews(storage, binding).length > 0 ? 'positions' : null;
  } catch { return null; }
};
