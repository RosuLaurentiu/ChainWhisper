import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { toBeHex } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import { STAGED_PREPARED_DEX_CANDIDATE as candidate } from './dexV2Deployment';
import { checkPreparedPoolManagementTransition as transition, checkPreparedPoolManagementSnapshot as snapshot,
  checkPreparedPoolOwnershipTransition as ownership, type PreparedPoolManagementExpectation } from './currentDexPreparedPoolManagement';
import type { PreparedPoolStoredState } from './currentDexPreparedPoolSnapshot';

const w = (value: number | bigint) => toBeHex(value, 32), empty = (n: number) => Array.from({ length: n }, () => w(0));
const owner = toBeHex(123n, 20), id = '43';
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer V)[] ? Mutable<V>[] : T[K] extends object ? Mutable<T[K]> : T[K] };
type State = Mutable<PreparedPoolStoredState>;
const clone = <T,>(v: T): T => structuredClone(v);
function fixture(action: 'top-up' | 'close' = 'top-up', pairIndex = 0) {
  const pair = candidate.pairs[pairIndex], block = { number: 100n, hash: w(100) };
  const before: State = { graph: candidate.graph, marketId: pair.marketId, positionId: 43n, block,
    market: { marketId: pair.marketId, canonicalId: BigInt(pair.canonicalId), registryRevision: 7n, marketRevision: 1n,
      enabled: true, token0: pair.tokens[0], token1: pair.tokens[1], engine: pair.engine, poolTerms: pair.poolTerms,
      companions: pair.companions.map(([role, address, runtimeHash]) => ({ role, address, runtimeHash })) },
    claim: empty(64), anchors: [], core: empty(149), markets: {}, claims: {}, c1: {}, ledgers: {}, escrows: {}, custody: {},
    nftOwners: {}, nftMinted: {}, ownerNftBalance: 1n, engines: {}, directories: {}, fixedSources: {}, counter: 43n, operation: 7n };
  before.core[11] = w(43); before.core[12] = w(7);
  candidate.pairs.forEach((p, k) => {
    const raw = empty(71); raw[0] = candidate.releaseId; raw[1] = p.marketId; raw[2] = w(BigInt(p.tokens[0])); raw[3] = w(BigInt(p.tokens[1]));
    before.markets[p.marketId] = raw; before.engines[p.marketId] = empty(46); before.c1[p.marketId] = empty(49); before.directories[p.marketId] = [];
    for (let i = 0; i < 7; i++) {
      const anchorId = k * 7 + i + 1, a = empty(64); a[0] = w(1); a[4] = w(2); a[62] = w(i);
      raw[18 + i] = w(anchorId); before.claims[String(anchorId)] = { marketId: p.marketId, words: a };
      before.nftOwners[String(anchorId)] = w(0); before.nftMinted[String(anchorId)] = w(0);
      if (k === pairIndex) before.anchors.push(a);
    }
  });
  const c = before.claim; c[0] = w(1); c[4] = w(3); c[5] = w(1); c[6] = w(1); c[7] = w(1); c[59] = w(1); c[13] = w(77);
  before.claims[id] = { marketId: pair.marketId, words: c }; before.nftOwners[id] = w(BigInt(owner)); before.nftMinted[id] = w(1);
  candidate.tokens.forEach(([token]) => { before.ledgers[token] = empty(12); before.escrows[token] = empty(2); before.custody[token] = empty(4); });
  const beforeAmounts = { amount0: 20n, amount1: 40n, shares: 10n, totalShares: 100n, classId: 0n };
  const beforeWallets = candidate.tokens.map(([token]) => ({ token, balance: 100n, allowance: 30n }));
  if (action === 'top-up') for (const wallet of beforeWallets) {
    const i = (pair.tokens as readonly string[]).indexOf(wallet.token); if (i >= 0) wallet.allowance = [10n, 20n][i];
  }
  const managed = clone(before); managed.block = { number: 101n, hash: w(101) };
  managed.claim[4] = w(4); managed.claim[13] = w(78); managed.claim[60] = w(101); managed.claim[61] = w(102);
  managed.anchors.forEach(a => { a[4] = w(3); [8, 9, 10, 11].forEach((i, j) => { a[i] = w(100 + j); a[[14, 15, 18, 19][j]] = a[i]; }); });
  for (const i of [11, 12, 13, 14, ...Array.from({ length: 14 }, (_, i) => i + 25)]) managed.markets[pair.marketId][i] = w(1000 + i);
  for (const token of pair.tokens) { managed.ledgers[token][9] = w(501); managed.ledgers[token][10] = w(502); managed.custody[token] = [w(601), w(602), w(603), w(604)]; }
  const request = action === 'top-up' ? { action, budgets: [10n, 20n] as [bigint, bigint], preview: { operation: 'add' as const, used0: 10n, used1: 20n,
    unused0: 0n, unused1: 0n, mintedShares: 5n, ownedShares: 15n, toleranceN: 1n, toleranceD: 200n, classId: 0n } } :
    { action, minimums: [20n, 40n] as [bigint, bigint] };
  const tokenFlows = action === 'top-up' ? [10n, 20n] : [20n, 40n];
  if (action === 'close') {
    managed.claim[0] = w(4); managed.claim[6] = w(2); managed.claim[12] = w(BigInt(owner));
    managed.claim[22] = managed.claim[60]; managed.claim[23] = managed.claim[61]; managed.nftOwners[id] = w(0); managed.ownerNftBalance = 0n;
  } else for (let i = 14; i < 54; i++) managed.claim[i] = w(200 + i);
  const managedWallets = beforeWallets.map(v => { const i = (pair.tokens as readonly string[]).indexOf(v.token), delta = i < 0 ? 0n : tokenFlows[i];
    return { ...v, balance: v.balance + (action === 'close' ? delta : -delta), allowance: v.allowance - (action === 'close' ? 0n : delta) }; });
  const input = { owner, request, receiptStatus: 1 as const, before, managed, beforeAmounts, beforeWallets, managedWallets, tokenFlows };
  const after = clone(managed); after.block = { number: 102n, hash: w(102) };
  for (let i = 14; i < 54; i++) if (action !== 'close' || (i - 14) % 4 >= 2) after.claim[i] = w(i + 300);
  const observedAmounts = action === 'close' ? { ...beforeAmounts, shares: 0n } : { ...beforeAmounts, shares: 15n, totalShares: 105n, amount0: 30n, amount1: 60n };
  return { input, after, observedAmounts, check: () => transition(input), finish: () => snapshot({ expected: transition(input) as PreparedPoolManagementExpectation,
    managed, snapshot: after, observedAmounts, managedWallets, snapshotWallets: clone(managedWallets) }) };
}

// Synthetic App boundary only. The derivative's contract runtime checks prove
// actual reserve math; the issuer must authenticate its action11 receipt.
function withdrawFixture(pairIndex = 0) {
  const base = fixture('top-up', pairIndex), pair = candidate.pairs[pairIndex];
  const input: Parameters<typeof transition>[0] = { ...base.input,
    request: { action: 'withdraw-previewed', fraction: [1n, 2n], minimums: [10n, 20n],
      preview: { amount0: 10n, amount1: 20n, burnedShares: 5n, remainingShares: 5n, numerator: 1n, denominator: 2n } },
    managedWallets: base.input.beforeWallets.map(v => { const i = (pair.tokens as readonly string[]).indexOf(v.token);
      return { ...v, balance: v.balance + (i < 0 ? 0n : [10n, 20n][i]) }; }) };
  const observedAmounts = { ...base.observedAmounts, shares: 5n, totalShares: 95n, amount0: 10n, amount1: 20n };
  return { input, after: base.after, observedAmounts, check: () => transition(input),
    finish: () => snapshot({ expected: transition(input) as PreparedPoolManagementExpectation, managed: input.managed,
      snapshot: base.after, observedAmounts, managedWallets: input.managedWallets, snapshotWallets: clone(input.managedWallets) }) };
}

describe('prepared Pool management accounting', () => {
  it.each(['transfer','activate','resume'] as const)('checks the exact %s ownership transition without economic changes',action=>{
    const f=fixture(),before=f.input.before,after=clone(before),recipient=toBeHex(456n,20);
    if(action==='activate'){before.claim[0]=w(3);before.claim[13]=w(0);for(let i=0;i<10;i++){before.claim[16+4*i]=w(0);before.claim[17+4*i]=w(0);}}
    if(action==='resume')before.claim[0]=w(2);
    Object.assign(after,clone(before));after.block={number:101n,hash:w(101)};
    after.claim[0]=w(action==='transfer'?3:action==='activate'?2:1);after.claim[4]=w(BigInt(before.claim[4])+1n);after.claim[6]=w(BigInt(before.claim[6])+1n);
    if(action==='transfer'){
      after.claim[5]=w(BigInt(before.claim[5])+1n);after.claim[13]=w(0);for(let i=0;i<10;i++){after.claim[16+4*i]=w(0);after.claim[17+4*i]=w(0);}
      after.nftOwners[id]=w(BigInt(recipient));after.ownerNftBalance--;
    }else for(let i=13;i<54;i++)after.claim[i]=w(1000+i);
    const input={candidate,action,owner,recipient:action==='transfer'?recipient:undefined,before,after,beforeWallets:f.input.beforeWallets,afterWallets:clone(f.input.beforeWallets)};
    expect(ownership(input).privateAccountingVerified).toBe(true);
    for(const fault of ['shares','custody','other-claim','wallet','revision','envelope']as const){
      const bad=clone(input);
      if(fault==='shares')bad.after.claim[60]=w(99);
      if(fault==='custody')bad.after.custody[candidate.tokens[0][0]][0]=w(99);
      if(fault==='other-claim')bad.after.claims['1'].words[8]=w(99);
      if(fault==='wallet')bad.afterWallets[0].balance++;
      if(fault==='revision')bad.after.claim[5]=w(99);
      if(fault==='envelope'){if(action==='transfer')bad.after.claim[16]=w(99);else bad.after.claim[13]=w(0);}
      expect(()=>ownership(bad)).toThrow();
    }
  });
  it('accepts the explicit canonical candidate and rejects spoofed or duplicate descriptor scope', () => {
    const f = fixture();
    expect(transition({ ...f.input, candidate })).toEqual(f.check());
    const duplicate = { ...candidate, pairs: [candidate.pairs[0], ...candidate.pairs.slice(0, 5)] };
    const spoof = { ...candidate, tokens: [candidate.tokens[0], candidate.tokens[0], ...candidate.tokens.slice(2)] };
    for (const supplied of [duplicate, spoof]) expect(() => transition({ ...f.input, candidate: supplied })).toThrow('candidate changed');
  });
  it('rejects a common wrong graph, extra market, pair companion or duplicate wallet in both states', () => {
    for (const fault of ['graph', 'market', 'companion', 'wallet'] as const) {
      const f = fixture();
      for (const s of [f.input.before, f.input.managed]) {
        if (fault === 'graph') s.graph = 'wrong-graph';
        if (fault === 'market') s.markets['extra-market'] = empty(71);
        if (fault === 'companion') s.market.engine = owner;
      }
      if (fault === 'wallet') for (const values of [f.input.beforeWallets, f.input.managedWallets]) values[1].token = values[0].token;
      expect(f.check).toThrow();
    }
  });
  it('keeps the selected candidate scope through the separate final snapshot check', () => {
    const f = fixture(), expected = f.check() as PreparedPoolManagementExpectation;
    const args = { expected, managed: f.input.managed, snapshot: f.after, observedAmounts: f.observedAmounts,
      managedWallets: f.input.managedWallets, snapshotWallets: clone(f.input.managedWallets), candidate };
    expect(snapshot(args).privateAccountingVerified).toBe(true);
    f.input.managed.graph = 'same-wrong-graph'; f.after.graph = 'same-wrong-graph';
    expect(() => snapshot(args)).toThrow('candidate or position scope');
  });
  it('binds exact compiled build-6 layout and shared action semantics', () => {
    const frozen = createRequire(import.meta.url)('../../../ChainWhisper Contracts V2/validation/candidates/shared-core-prepared-markets-2026-10-07/candidate.cjs').frozen();
    expect(candidate.graph).toBe('85767f8adefa7323ca97b190b4d959ce8ee08b38be02e568c2415decf028052c');
    const sources = frozen.info.input.sources as Record<string, { content: string }>;
    const digests = ['ChainWhisperSharedPoolClaims', 'ChainWhisperSharedPoolMath', 'ChainWhisperDexPositionCommands', 'ChainWhisperPoolOwner'].map(name =>
      createHash('sha256').update(sources[`contracts/dex/${name}.sol`].content).digest('hex'));
    expect(digests).toEqual(COMPILED_SOURCE_HASHES);
    const types = frozen.info.output.contracts['contracts/dex/ChainWhisperDexCore.sol'].ChainWhisperDexCore.storageLayout.types as
      Record<string, { label: string; members?: { label: string; slot: string }[] }>;
    const layout = Object.values(types).find(v => v.label === 'struct ChainWhisperPoolOwner.Position')!.members!;
    expect(Object.fromEntries(layout.filter(v => ['snapshot', 'shares', 'privateClass', 'sharedClaim', 'closeOwner'].includes(v.label)).map(v => [v.label, v.slot])))
      .toEqual({ snapshot: '14', shares: '60', privateClass: '63', sharedClaim: '59', closeOwner: '12' });
  });
  it.each(candidate.pairs.map((_, i) => i))('proves top-up and separate snapshot for pair %s', index => {
    const f = fixture('top-up', index);
    expect(f.check()).toMatchObject({ status: 'manage-verified-snapshot-required', privateAccountingVerified: false, shares: 15n, snapshotTotalShares: 105n });
    expect(f.finish()).toEqual({ status: 'owner-action-verified', privateAccountingVerified: true });
  });
  it.each(candidate.pairs.map((_, i) => i))('proves exact close and preserves stored total for pair %s', index => {
    const f = fixture('close', index);
    expect(f.check()).toMatchObject({ tokenAmounts: [20n, 40n], shares: 0n, snapshotTotalShares: 100n }); expect(f.finish().privateAccountingVerified).toBe(true);
    f.observedAmounts.totalShares = 90n; expect(f.finish).toThrow('snapshot accounting');
  });
  it('accepts exact zero payouts on close without inventing token charges', () => {
    const f = fixture('close'); f.input.beforeAmounts.amount0 = 0n; f.input.beforeAmounts.amount1 = 0n;
    f.input.request = { action: 'close', minimums: [0n, 0n] }; f.input.tokenFlows = [0n, 0n]; f.input.managedWallets = clone(f.input.beforeWallets);
    expect(f.check()).toMatchObject({ tokenAmounts: [0n, 0n] });
  });
  it.each(['top-up', 'close'] as const)('proves rollback of a reverted %s', action => {
    const f = fixture(action);
    expect(transition({ ...f.input, receiptStatus: 0, managed: clone(f.input.before), managedWallets: clone(f.input.beforeWallets), tokenFlows: [] }))
      .toEqual({ status: 'reverted', privateAccountingVerified: true });
    expect(() => transition({ ...f.input, receiptStatus: 0 })).toThrow('roll back');
  });
  it('rejects partial withdrawal instead of inferring reserves from rounded entitlements', () => {
    const f = fixture();
    expect(() => transition({ ...f.input, request: { action: 'withdraw', fraction: [1n, 2n], minimums: [0n, 0n] } })).toThrow('exit-preview');
  });
  it('demonstrates exact partial-payout ambiguity in unchanged owner evidence', () => {
    const owned = 3n, total = 10n, burned = 2n;
    expect(4n * owned / total).toBe(1n); expect(5n * owned / total).toBe(1n);
    expect(4n * burned / total).toBe(0n); expect(5n * burned / total).toBe(1n);
  });
  it.each(candidate.pairs.map((_, i) => i))('checks previewed partial withdrawal and separate snapshot for pair %s', index => {
    const f = withdrawFixture(index);
    expect(f.check()).toMatchObject({ action: 'withdraw-previewed', shares: 5n, snapshotTotalShares: 95n,
      tokenAmounts: [10n, 20n], privateAccountingVerified: false });
    expect(f.finish()).toEqual({ status: 'owner-action-verified', privateAccountingVerified: true });
    expect(f.input.managed.ownerNftBalance).toBe(f.input.before.ownerNftBalance);
    expect(f.input.managed.nftOwners[id]).toBe(f.input.before.nftOwners[id]);
  });
  it.each(['minimum', 'fraction', 'burn', 'remaining', 'zero-payout', 'flow', 'allowance', 'unrelated-wallet', 'lifecycle', 'nft', 'snapshot-total', 'snapshot-shares'])(
    'rejects partial-withdraw accounting defect: %s', defect => {
      const f = withdrawFixture();
      if (f.input.request.action !== 'withdraw-previewed') throw Error('fixture');
      const request = f.input.request;
      if (defect === 'minimum') f.input.request = { ...request, minimums: [11n, 20n] };
      if (defect === 'fraction') f.input.request = { ...request, fraction: [2n, 3n] };
      if (defect === 'burn') f.input.request = { ...request, preview: { ...request.preview, burnedShares: 6n } };
      if (defect === 'remaining') f.input.request = { ...request, preview: { ...request.preview, remainingShares: 4n } };
      if (defect === 'zero-payout') f.input.request = { ...request, preview: { ...request.preview, amount0: 0n, amount1: 0n } };
      if (defect === 'flow') f.input.tokenFlows = [11n, 20n];
      if (defect === 'allowance') f.input.managedWallets = f.input.managedWallets.map((v, i) => i === 0 ? { ...v, allowance: 0n } : v);
      if (defect === 'unrelated-wallet') f.input.managedWallets = f.input.managedWallets.map((v, i) => i === 2 ? { ...v, balance: v.balance + 1n } : v);
      if (defect === 'lifecycle') (f.input.managed as State).claim[6] = w(2);
      if (defect === 'nft') (f.input.managed as State).nftOwners[id] = w(0);
      if (defect === 'snapshot-total') f.observedAmounts.totalShares++;
      if (defect === 'snapshot-shares') f.observedAmounts.shares++;
      expect(f.finish).toThrow();
    });
  it('checks exact partial-withdraw revert without requiring a successful preview result', () => {
    const f = withdrawFixture();
    expect(transition({ ...f.input, receiptStatus: 0, managed: clone(f.input.before), managedWallets: clone(f.input.beforeWallets), tokenFlows: [] }))
      .toEqual({ status: 'reverted', privateAccountingVerified: true });
  });
  it.each(['used', 'owned', 'minted-zero', 'budget', 'class', 'tolerance', 'total-overflow'])('rejects top-up preview defect: %s', reason => {
    const f = fixture(); if (f.input.request.action !== 'top-up') throw Error('fixture');
    const p = f.input.request.preview;
    if (reason === 'used') p.used0++;
    if (reason === 'owned') p.ownedShares++;
    if (reason === 'minted-zero') p.mintedShares = 0n;
    if (reason === 'budget') p.unused1++;
    if (reason === 'class') p.classId++;
    if (reason === 'tolerance') p.toleranceD = 0n;
    if (reason === 'total-overflow') f.input.beforeAmounts.totalShares = (1n << 128n) - 1n;
    expect(f.check).toThrow();
  });
  it('enforces minimum payouts before claiming a close result', () => {
    const f = fixture('close'); f.input.request = { action: 'close', minimums: [21n, 40n] }; expect(f.check).toThrow('minimum');
  });
  it.each(['flow', 'balance0', 'balance1', 'balance2', 'balance3', 'allowance0', 'allowance1', 'allowance2', 'allowance3', 'missing-wallet', 'reorder'])('rejects exact wallet/event defect: %s', reason => {
    const f = fixture();
    if (reason === 'flow') f.input.tokenFlows[0]++;
    if (reason.startsWith('balance')) f.input.managedWallets[Number(reason.slice(-1))].balance++;
    if (reason.startsWith('allowance')) f.input.managedWallets[Number(reason.slice(-1))].allowance++;
    if (reason === 'missing-wallet') f.input.managedWallets.pop();
    if (reason === 'reorder') f.input.managedWallets.reverse();
    expect(f.check).toThrow();
  });
  it.each(['core', 'other-market', 'other-anchor', 'engine', 'directory', 'c1', 'escrow', 'other-custody', 'ledger', 'mint', 'owner',
    'revision', 'lifecycle', 'class', 'source', 'claim-shape', 'duplicate', 'anchor-revision', 'anchor-snapshot', 'counter', 'missing-claim'])('rejects protected-state defect: %s', reason => {
    const f = fixture(), s = f.input.managed, other = candidate.pairs[1].marketId, token = candidate.tokens.find(([t]) => ![s.market.token0, s.market.token1].includes(t))![0];
    if (reason === 'core') s.core[10] = w(999);
    if (reason === 'other-market') s.markets[other][11] = w(999);
    if (reason === 'other-anchor') s.claims['8'].words[8] = w(999);
    if (reason === 'engine') s.engines[s.marketId][4] = w(999);
    if (reason === 'directory') s.directories[s.marketId].push(w(999));
    if (reason === 'c1') s.c1[s.marketId][1] = w(999);
    if (reason === 'escrow') s.escrows[s.market.token0][0] = w(999);
    if (reason === 'other-custody') s.custody[token][0] = w(999);
    if (reason === 'ledger') s.ledgers[s.market.token0][0] = w(999);
    if (reason === 'mint') s.nftMinted[id] = w(2);
    if (reason === 'owner') s.nftOwners[id] = w(999);
    if (reason === 'revision') s.claim[4] = w(3);
    if (reason === 'lifecycle') s.claim[6] = w(2);
    if (reason === 'class') s.claim[63] = w(999);
    if (reason === 'source') s.claim[1] = w(999);
    if (reason === 'claim-shape') s.claim.pop();
    if (reason === 'duplicate') s.claims[id] = { ...s.claims[id], words: [...s.claim, w(0)] };
    if (reason === 'anchor-revision') s.anchors[0][4] = w(2);
    if (reason === 'anchor-snapshot') s.anchors[0][14] = w(999);
    if (reason === 'counter') s.counter++;
    if (reason === 'missing-claim') delete s.claims['8'];
    expect(f.check).toThrow();
  });
  it.each(['wallet', 'financial', 'shares', 'total', 'class', 'closed-payout', 'duplicate'])('requires the separate snapshot proof: %s', reason => {
    const f = fixture(reason === 'closed-payout' ? 'close' : 'top-up'), expected = f.check() as PreparedPoolManagementExpectation;
    const wallets = clone(f.input.managedWallets);
    if (reason === 'wallet') wallets[0].balance++;
    if (reason === 'financial') f.after.claim[60] = w(999);
    if (reason === 'shares') f.observedAmounts.shares++;
    if (reason === 'total') f.observedAmounts.totalShares++;
    if (reason === 'class') f.observedAmounts.classId++;
    if (reason === 'closed-payout') f.observedAmounts.amount0++;
    if (reason === 'duplicate') f.after.claims[id] = { ...f.after.claims[id], words: [...f.after.claim, w(1)] };
    expect(() => snapshot({ expected, managed: f.input.managed, snapshot: f.after, observedAmounts: f.observedAmounts,
      managedWallets: f.input.managedWallets, snapshotWallets: wallets })).toThrow();
  });
});

const COMPILED_SOURCE_HASHES = ['0456f8efe324302b6cce266747f39e38f478be1412661251ea27875bf22db93f',
  'e4b860e4ebd12829fcc68fcace32f499f2491e06034767bbb907fde3083435a1',
  '1c45a07f22b55ef198fb75d7282c307eef712918296de2f3fdc0b5c62a1e901b',
  '84f3b7fcd638eb26e0c9f5ecc7001eb64680e345fb8974bbc563f086a541e7a9'];
