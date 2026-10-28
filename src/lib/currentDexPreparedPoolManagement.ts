import type { CurrentCheapDexCandidate } from './dexV2Deployment';
import { resolvePreparedDexScope, type PreparedDexCandidate } from './currentDexPreparedScope';
import { CurrentPoolProofMismatch } from './currentDexPoolProofError';
import { checkPreparedPoolPositionValues, checkPreparedPoolSnapshotOnlyChange,
  type PreparedPoolStoredState } from './currentDexPreparedPoolSnapshot';
import type { checkCurrentPoolFundingValues } from './currentDexPoolFunding';
import { checkPoolExitPreviewValues, type PoolExitPreviewAmounts } from './currentDexPoolExitPreview';

type Amounts = ReturnType<typeof checkPreparedPoolPositionValues>;
type Wallets = readonly Readonly<{ token: string; balance: bigint; allowance: bigint }>[];
type Preview = ReturnType<typeof checkCurrentPoolFundingValues>;
export type PreparedPoolManagementRequest = Readonly<
  { action: 'top-up'; budgets: readonly [bigint, bigint]; preview: Preview } |
  { action: 'close'; minimums: readonly [bigint, bigint] } |
  { action: 'withdraw-previewed'; fraction: readonly [bigint, bigint]; minimums: readonly [bigint, bigint]; preview: PoolExitPreviewAmounts } |
  { action: 'withdraw'; fraction: readonly [bigint, bigint]; minimums: readonly [bigint, bigint] }>;
const requireProof = (ok: boolean, message: string): void => { if (!ok) throw new CurrentPoolProofMismatch(message); };
const same = (a: unknown, b: unknown) => JSON.stringify(a, (_, v) => typeof v === 'bigint' ? String(v) : v) ===
  JSON.stringify(b, (_, v) => typeof v === 'bigint' ? String(v) : v);
const uint = (v: bigint, bits = 256) => requireProof(typeof v === 'bigint' && v >= 0n && v < 1n << BigInt(bits), 'Invalid prepared management integer.');
const amounts = (v: Amounts) => {
  checkPreparedPoolPositionValues([v.amount0, v.amount1, v.shares, v.totalShares, 0n, 0n, 0n, 0n, 0n, v.classId]);
  [v.amount0, v.amount1, v.shares, v.totalShares].forEach(x => uint(x, 128));
};
const withoutBlock = (s: PreparedPoolStoredState) => ({ ...s, block: null });
const anchorFields = [4, 8, 9, 10, 11, 14, 15, 18, 19];
const marketFields = [11, 12, 13, 14, ...Array.from({ length: 14 }, (_, i) => 25 + i)];
const address = (word: string) => `0x${word.slice(-40)}`;

const scope = (s: PreparedPoolStoredState, candidate: PreparedDexCandidate, owner?: string) => {
  const pair = candidate.pairs.find(p => p.marketId === s.marketId);
  requireProof(s.graph === candidate.graph && !!pair && s.market.marketId === s.marketId && s.market.token0 === pair!.tokens[0] &&
    s.market.token1 === pair!.tokens[1] && s.market.canonicalId === BigInt(pair!.canonicalId) && s.market.enabled === true &&
    s.market.engine === pair!.engine && s.market.poolTerms === pair!.poolTerms &&
    same(s.market.companions, pair!.companions.map(([role, address, runtimeHash]) => ({ role, address, runtimeHash }))) &&
    s.counter >= 42n && s.counter <= 128n && s.positionId > 0n && s.positionId <= s.counter,
  'Prepared management candidate or position scope changed.');
  if (owner !== undefined) requireProof(/^0x[0-9a-fA-F]{40}$/.test(owner) && BigInt(owner) !== 0n, 'Prepared management owner changed.');
  const marketIds = candidate.pairs.map(p => p.marketId).sort(), tokens = candidate.tokens.map(([token]) => token).sort();
  for (const values of [s.markets, s.engines, s.c1, s.directories]) requireProof(same(Object.keys(values).sort(), marketIds), 'Prepared management needs exactly six candidate markets.');
  for (const values of [s.ledgers, s.escrows, s.custody]) requireProof(same(Object.keys(values).sort(), tokens), 'Prepared management needs exactly four candidate tokens.');
  requireProof(s.core.length === 149 && s.claim.length === 64 && s.anchors.length === 7 &&
    s.core[11] !== undefined && BigInt(s.core[11]) === s.counter && BigInt(s.core[12]) === s.operation &&
    Object.keys(s.claims).length === Number(s.counter), 'Prepared management storage scope is incomplete.');
  requireProof(same(s.claims[String(s.positionId)], { marketId: s.marketId, words: s.claim }) &&
    BigInt(s.claim[59]) === 1n && s.claim.slice(1, 4).every(v => BigInt(v) === 0n) && BigInt(s.claim[54]) === 0n &&
    BigInt(s.claim[7]) === 1n, 'Prepared management needs a shared Full Range claim.');
  for (const p of candidate.pairs) {
    const raw = s.markets[p.marketId];
    requireProof(raw?.length === 71 && s.engines[p.marketId]?.length === 46 && s.c1[p.marketId]?.length === 49 &&
      Array.isArray(s.directories[p.marketId]), 'Prepared management market scope is incomplete.');
    requireProof(raw[0] === candidate.releaseId && raw[1] === p.marketId && address(raw[2]) === p.tokens[0] &&
      address(raw[3]) === p.tokens[1], 'Prepared management stored market changed.');
    for (let i = 0; i < 7; i++) {
      const id = String(BigInt(raw[18 + i])), anchor = s.claims[id];
      requireProof(anchor?.marketId === p.marketId && anchor.words.length === 64 &&
        BigInt(anchor.words[0]) === 1n && BigInt(anchor.words[59]) === 0n && BigInt(anchor.words[62]) === BigInt(i),
      'Prepared management anchor scope changed.');
      if (p.marketId === s.marketId) requireProof(same(anchor.words, s.anchors[i]), 'Prepared management duplicate anchor differs.');
    }
  }
  for (let id = 1n; id <= s.counter; id++) requireProof(!!s.claims[String(id)] &&
    s.nftOwners[String(id)] !== undefined && s.nftMinted[String(id)] !== undefined, 'Prepared management allocated scope is incomplete.');
  for (const [token] of candidate.tokens) requireProof(s.ledgers[token]?.length === 12 && s.escrows[token]?.length === 2 &&
    s.custody[token]?.length === 4, 'Prepared management token scope is incomplete.');
};
const wallets = (values: Wallets, candidate: PreparedDexCandidate) => {
  requireProof(values.length === 4 && values.every((v, i) => v.token === candidate.tokens[i][0]), 'Prepared management needs all four ordered wallets.');
  values.forEach(v => { uint(v.balance); uint(v.allowance); });
};

/** Ownership changes preserve all economic state. The issuer must also bind the
 * canonical call, NFT Transfer/approval and recipient balance at the same blocks. */
export const checkPreparedPoolOwnershipTransition = ({ action, owner, recipient, before, after, beforeWallets,
  afterWallets, candidate: supplied }: {
  action: 'transfer' | 'activate' | 'resume'; owner: string; recipient?: string;
  before: PreparedPoolStoredState; after: PreparedPoolStoredState; beforeWallets: Wallets; afterWallets: Wallets;
  candidate?: CurrentCheapDexCandidate;
}) => {
  const { candidate } = resolvePreparedDexScope(supplied);
  scope(before, candidate, owner); scope(after, candidate, owner);
  wallets(beforeWallets, candidate); wallets(afterWallets, candidate);
  const transferring = action === 'transfer', id = String(before.positionId), status = BigInt(before.claim[0]);
  requireProof(['transfer', 'activate', 'resume'].includes(action) && after.block.number >= before.block.number &&
    address(before.nftOwners[id]) === owner.toLowerCase() && BigInt(before.nftMinted[id]) === 1n &&
    (transferring ? [1n, 2n, 3n].includes(status) : status === (action === 'activate' ? 3n : 2n)),
  'Prepared ownership baseline owner or status changed.');
  if (transferring) requireProof(typeof recipient === 'string' && /^0x[0-9a-fA-F]{40}$/.test(recipient) &&
    BigInt(recipient) !== 0n && recipient.toLowerCase() !== owner.toLowerCase(), 'Prepared ownership recipient changed.');
  else requireProof(recipient === undefined, 'Prepared lifecycle action has a recipient.');
  const userFields = Array.from({ length: 20 }, (_, i) => 16 + Math.floor(i / 2) * 4 + i % 2);
  if (action === 'activate') requireProof(BigInt(before.claim[13]) === 0n && userFields.every(i => BigInt(before.claim[i]) === 0n),
    'Pending recipient retains a previous owner envelope.');
  const allowed = transferring ? [0, 4, 5, 6, 13, ...userFields] : [0, 4, 6, ...Array.from({ length: 41 }, (_, i) => 13 + i)];
  const cleanWords = (words: readonly string[]) => words.map((v, i) => allowed.includes(i) ? 'ownership-write' : v);
  const clean = (s: PreparedPoolStoredState) => ({ ...s, block: null, claim: cleanWords(s.claim),
    claims: { ...s.claims, [id]: { ...s.claims[id], words: cleanWords(s.claims[id].words) } },
    nftOwners: transferring ? { ...s.nftOwners, [id]: 'recipient' } : s.nftOwners,
    ownerNftBalance: transferring ? 0n : s.ownerNftBalance });
  requireProof(same(clean(before), clean(after)) && same(beforeWallets, afterWallets),
    'Prepared ownership changed protected economic state.');
  requireProof(BigInt(after.claim[0]) === (transferring ? 3n : action === 'activate' ? 2n : 1n) &&
    BigInt(after.claim[4]) === BigInt(before.claim[4]) + 1n && BigInt(after.claim[6]) === BigInt(before.claim[6]) + 1n &&
    BigInt(after.claim[5]) === BigInt(before.claim[5]) + (transferring ? 1n : 0n) &&
    after.ownerNftBalance === before.ownerNftBalance - (transferring ? 1n : 0n) &&
    address(after.nftOwners[id]) === (transferring ? recipient!.toLowerCase() : owner.toLowerCase()) &&
    (transferring ? BigInt(after.claim[13]) === 0n && userFields.every(i => BigInt(after.claim[i]) === 0n) :
      BigInt(after.claim[13]) !== 0n && Array.from({ length: 10 }, (_, i) => i).every(i =>
        BigInt(after.claim[16 + 4 * i]) !== 0n || BigInt(after.claim[17 + 4 * i]) !== 0n)),
  'Prepared ownership lifecycle or owner envelopes changed.');
  return Object.freeze({ status: 'owner-action-verified' as const, privateAccountingVerified: true as const, readyToSign: false as const });
};

export type PreparedPoolManagementExpectation = Readonly<{
  action: 'top-up' | 'close' | 'withdraw-previewed'; positionId: bigint; marketId: string; classId: bigint;
  shares: bigint; snapshotTotalShares: bigint; tokenAmounts: readonly [bigint, bigint];
  status: 'manage-verified-snapshot-required'; privateAccountingVerified: false;
}>;

/** Pure financial check. The owner capability authenticates the retained baseline,
 * preview, canonical manage receipt/call, owner token event envelopes and each
 * block-pinned read before calling this function. This does not issue authority.
 * tokenFlows must be the two exact canonical-order owner debits/credits from that
 * receipt. Manage does not emit PoolSnapshotRefreshed; final accounting is separate.
 */
export const checkPreparedPoolManagementTransition = ({ owner, request, receiptStatus, before, managed, beforeAmounts,
  beforeWallets, managedWallets, tokenFlows, candidate: supplied }: {
  owner: string; request: PreparedPoolManagementRequest; receiptStatus: 0 | 1;
  before: PreparedPoolStoredState; managed: PreparedPoolStoredState; beforeAmounts: Amounts;
  beforeWallets: Wallets; managedWallets: Wallets; tokenFlows: readonly bigint[]; candidate?: CurrentCheapDexCandidate;
}): PreparedPoolManagementExpectation | Readonly<{ status: 'reverted'; privateAccountingVerified: true }> => {
  const { candidate } = resolvePreparedDexScope(supplied);
  scope(before, candidate, owner); scope(managed, candidate, owner); wallets(beforeWallets, candidate); wallets(managedWallets, candidate); amounts(beforeAmounts);
  requireProof(managed.block.number >= before.block.number, 'Prepared management block order changed.');
  if (receiptStatus === 0) {
    requireProof(tokenFlows.length === 0 && same(withoutBlock(before), withoutBlock(managed)) && same(beforeWallets, managedWallets),
      'Prepared management revert did not roll back exactly.');
    return Object.freeze({ status: 'reverted', privateAccountingVerified: true });
  }
  requireProof(receiptStatus === 1 && request.action !== 'withdraw',
    'Exact partial-withdraw proof requires authenticated exit-preview amounts; rounded owner snapshots are insufficient.');
  // This pure checker grants no candidate or sender admission. The issuer must
  // authenticate action12's preview receipt and unchanged reserve commitment.
  // The funded build6 issuer still rejects every partial-withdraw request.
  const closing = request.action === 'close', withdrawing = request.action === 'withdraw-previewed', status = BigInt(before.claim[0]);
  requireProof((closing ? [1n, 2n].includes(status) : status === 1n) && beforeAmounts.shares > 0n &&
    address(before.nftOwners[String(before.positionId)]) === owner.toLowerCase() &&
    BigInt(before.nftMinted[String(before.positionId)]) === 1n,
  'Prepared management baseline owner/status changed.');
  let paid: readonly [bigint, bigint], shares: bigint, total: bigint;
  if (request.action === 'top-up') {
    const p = request.preview; Object.values(p).filter(v => typeof v === 'bigint').forEach(v => uint(v as bigint));
    requireProof(request.budgets.length === 2, 'Prepared top-up needs both budgets.'); request.budgets.forEach(v => uint(v, 128));
    requireProof(p.operation === 'add' && p.classId === beforeAmounts.classId && p.used0 > 0n && p.used1 > 0n &&
      p.mintedShares > 0n && p.ownedShares === beforeAmounts.shares + p.mintedShares &&
      p.used0 + p.unused0 === request.budgets[0] && p.used1 + p.unused1 === request.budgets[1] &&
      p.toleranceD > 0n && p.toleranceN <= p.toleranceD, 'Prepared top-up differs from authenticated preview.');
    [p.toleranceN, p.toleranceD, p.mintedShares, p.ownedShares].forEach(v => uint(v, 128));
    paid = [p.used0, p.used1]; shares = p.ownedShares; total = beforeAmounts.totalShares + p.mintedShares; uint(total, 128);
  } else if (request.action === 'withdraw-previewed') {
    const p = request.preview;
    const checked = checkPoolExitPreviewValues([p.amount0, p.amount1, p.burnedShares, p.remainingShares, p.numerator, p.denominator],
      { ownedShares: beforeAmounts.shares, totalShares: beforeAmounts.totalShares,
        entitlements: [beforeAmounts.amount0, beforeAmounts.amount1], fraction: request.fraction });
    requireProof(request.minimums.length === 2, 'Prepared withdrawal needs both minimums.'); request.minimums.forEach(v => uint(v));
    paid = [checked.amount0, checked.amount1];
    requireProof(paid.every((v, i) => v >= request.minimums[i]), 'Prepared withdrawal payout is below its reviewed minimum.');
    shares = checked.remainingShares; total = beforeAmounts.totalShares - checked.burnedShares; uint(total, 128);
  } else {
    requireProof(request.action === 'close', 'Unsupported prepared management action.');
    const minimums = (request as Extract<PreparedPoolManagementRequest, { action: 'close' }>).minimums;
    requireProof(minimums.length === 2, 'Prepared close needs both minimums.'); minimums.forEach(v => uint(v));
    paid = [beforeAmounts.amount0, beforeAmounts.amount1];
    requireProof(paid.every((v, i) => v >= minimums[i]), 'Prepared close payout is below its reviewed minimum.');
    shares = 0n;
    // _exit writes only snapshot fields 0/1/2. Field 3 is the last pre-close
    // snapshot total, not the remaining class supply. Do not subtract here.
    total = beforeAmounts.totalShares;
  }
  requireProof(tokenFlows.length === 2 && same(tokenFlows, paid), 'Prepared management token event amounts changed.');
  const pairTokens = [before.market.token0, before.market.token1];
  beforeWallets.forEach((w, i) => {
    const index = pairTokens.indexOf(w.token), delta = index < 0 ? 0n : paid[index];
    const paying = closing || withdrawing;
    const expectedBalance = w.balance + (paying ? delta : -delta), expectedAllowance = w.allowance - (paying ? 0n : delta);
    requireProof((paying || index < 0 || w.allowance === delta) && expectedBalance >= 0n && expectedAllowance >= 0n && managedWallets[i].balance === expectedBalance &&
      managedWallets[i].allowance === expectedAllowance, 'Prepared management changed exact wallet balances or allowances.');
  });
  const allowed = closing ? [0, 4, 6, 12, 13, 14, 15, 18, 19, 22, 23, 60, 61] : [4, 13, ...Array.from({ length: 40 }, (_, i) => i + 14), 60, 61];
  const clean = (s: PreparedPoolStoredState) => ({ ...s, block: null, anchors: [],
    claim: s.claim.map((v, i) => allowed.includes(i) ? 'claim-write' : v),
    claims: Object.fromEntries(Object.entries(s.claims).map(([id, value]) => [id, { ...value, words:
      id === String(s.positionId) ? value.words.map((v, i) => allowed.includes(i) ? 'claim-write' : v) :
        value.marketId === s.marketId && s.markets[s.marketId].slice(18, 25).some(v => BigInt(v) === BigInt(id)) ?
          value.words.map((v, i) => anchorFields.includes(i) ? 'anchor-write' : v) : value.words }])),
    markets: Object.fromEntries(Object.entries(s.markets).map(([id, raw]) => [id, id === s.marketId ? raw.map((v, i) => marketFields.includes(i) ? 'pool-write' : v) : raw])),
    ledgers: Object.fromEntries(Object.entries(s.ledgers).map(([token, raw]) => [token, pairTokens.includes(token) ? raw.map((v, i) => i === 9 || i === 10 ? 'inventory-write' : v) : raw])),
    custody: Object.fromEntries(Object.entries(s.custody).map(([token, raw]) => [token, pairTokens.includes(token) ? 'custody-write' : raw])),
    nftOwners: { ...s.nftOwners, [String(s.positionId)]: 'owner' }, ownerNftBalance: 0n });
  requireProof(same(clean(before), clean(managed)), 'Prepared management changed protected state.');
  requireProof(BigInt(managed.claim[4]) === BigInt(before.claim[4]) + 1n &&
    BigInt(managed.claim[6]) === BigInt(before.claim[6]) + (closing ? 1n : 0n) &&
    BigInt(managed.claim[0]) === (closing ? 4n : status) &&
    managed.ownerNftBalance === before.ownerNftBalance - (closing ? 1n : 0n) &&
    (closing ? BigInt(managed.nftOwners[String(managed.positionId)]) === 0n && address(managed.claim[12]) === owner.toLowerCase() &&
      managed.claim[22] === managed.claim[60] && managed.claim[23] === managed.claim[61] :
      managed.nftOwners[String(managed.positionId)] === before.nftOwners[String(before.positionId)]),
  'Prepared management lifecycle or NFT result changed.');
  before.anchors.forEach((a, i) => requireProof(BigInt(managed.anchors[i][4]) === BigInt(a[4]) + 1n &&
    managed.anchors[i][8] === managed.anchors[i][14] && managed.anchors[i][9] === managed.anchors[i][15] &&
    managed.anchors[i][10] === managed.anchors[i][18] && managed.anchors[i][11] === managed.anchors[i][19],
  'Prepared management anchor revision or reserve snapshot changed.'));
  return Object.freeze({ action: closing ? 'close' : withdrawing ? 'withdraw-previewed' : 'top-up', positionId: before.positionId, marketId: before.marketId,
    classId: beforeAmounts.classId, shares, snapshotTotalShares: total, tokenAmounts: Object.freeze(paid),
    status: 'manage-verified-snapshot-required', privateAccountingVerified: false });
};

/** Call only after a separate confirmed, authenticated poolSnapshot producer.
 * Canonical transaction/call/event and producer-session checks remain with issuer.
 */
export const checkPreparedPoolManagementSnapshot = ({ expected, managed, snapshot, observedAmounts, managedWallets, snapshotWallets, candidate: supplied }: {
  expected: PreparedPoolManagementExpectation; managed: PreparedPoolStoredState; snapshot: PreparedPoolStoredState;
  observedAmounts: Amounts; managedWallets: Wallets; snapshotWallets: Wallets; candidate?: CurrentCheapDexCandidate;
}) => {
  const { candidate } = resolvePreparedDexScope(supplied);
  scope(managed, candidate); scope(snapshot, candidate);
  requireProof(expected.status === 'manage-verified-snapshot-required' && expected.positionId === managed.positionId &&
    expected.marketId === managed.marketId && snapshot.block.number >= managed.block.number, 'Prepared management snapshot identity changed.');
  for (const s of [managed, snapshot]) requireProof(same(s.claims[String(s.positionId)], { marketId: s.marketId, words: s.claim }),
    'Prepared management snapshot duplicate claim differs.');
  checkPreparedPoolSnapshotOnlyChange(managed, snapshot); wallets(managedWallets, candidate); wallets(snapshotWallets, candidate); amounts(observedAmounts);
  requireProof(same(managedWallets, snapshotWallets) && observedAmounts.classId === expected.classId &&
    observedAmounts.shares === expected.shares && observedAmounts.totalShares === expected.snapshotTotalShares &&
    (expected.action !== 'close' || observedAmounts.amount0 === expected.tokenAmounts[0] && observedAmounts.amount1 === expected.tokenAmounts[1]),
  'Prepared management snapshot accounting changed.');
  return Object.freeze({ status: 'owner-action-verified' as const, privateAccountingVerified: true as const });
};
