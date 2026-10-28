import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { getAddress, toBeHex } from '@coti-io/coti-ethers';
import { createCurrentSharedDexTokenFundingAdapter, assertCurrentSharedTokenFundingAppAuthority, currentSharedTokenFundingAbi as abi,
  assertCurrentSharedPoolApprovalPrepared, type CurrentSharedTokenFundingAction } from './currentSharedDexTokenFunding';
import { CURRENT_SHARED_TOKEN_DISTRIBUTION as policy, CURRENT_SHARED_DEX_TOKENS, resolveCurrentSharedTokenDistribution } from './currentSharedDexTokenDistribution';
import { readCurrentDexPendingAttempt, CURRENT_DEX_PENDING_ATTEMPT_KEY } from './currentDexPendingAttempt';
import { currentTokenFundingAbi as approvalAbi } from './currentDexTokenFunding';
import { STAGED_PREPARED_DEX_CANDIDATE, STAGED_EXIT_PREVIEW_DEX_CANDIDATE } from './dexV2Deployment';
import { createCurrentAttemptBoundary } from './currentDexSubmission';
import type { CurrentPoolPreparedFunding, CurrentPoolPreparedTopUpFunding } from '../features/wallet/currentDexPoolFundingCapability';
import type { CurrentLimitFundingReview } from '../features/wallet/currentDexLimitCapability';

const fundingBrands = vi.hoisted(() => new WeakMap<object, object>());
const limitBrands = vi.hoisted(() => new WeakMap<object, object>());
vi.mock('../features/wallet/currentDexLimitCapability', () => ({
  assertCurrentLimitPrepared: (value: object, signer: object) => {
    if (limitBrands.get(value) !== signer) throw new Error('Limit was not prepared in this owner session.');
  }
}));
describe('one App initial HBR claim authority',()=>{
  it('opens only the exact approved owner, candidate, initial HBR action',()=>{
    const scope={candidate:'cheap-exit' as const,owner:'0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d',token:CURRENT_SHARED_DEX_TOKENS[1].address,action:'initial' as const};
    expect(()=>assertCurrentSharedTokenFundingAppAuthority(scope)).not.toThrow();
    expect(()=>assertCurrentSharedTokenFundingAppAuthority()).toThrow('held');
    for(const changes of [{candidate:'cheap-prepared'},{owner:STAGED_EXIT_PREVIEW_DEX_CANDIDATE.core},{token:CURRENT_SHARED_DEX_TOKENS[0].address},{action:'refill'}])
      expect(()=>assertCurrentSharedTokenFundingAppAuthority({...scope,...changes} as typeof scope)).toThrow('held');
  });
});
const localSubmissionAuthority = vi.hoisted(() => ({ allowed: false }));
// These fixtures test engineering sender mechanics, not the owner's retained-ledger admission.
// Owner admission and quota removal are covered by the policy and shared-boundary suites.
vi.mock('./currentDexOwnerBetaPolicy', async importOriginal => ({
  ...await importOriginal<typeof import('./currentDexOwnerBetaPolicy')>(), isCurrentOwnerBeta: () => false
}));
vi.mock('./currentDexC1SwapPolicy', async importOriginal => {
  const actual = await importOriginal<typeof import('./currentDexC1SwapPolicy')>();
  return { ...actual, assertCurrentAppPoolAuthority: (...args:Parameters<typeof actual.assertCurrentAppPoolAuthority>)=>{
    if(localSubmissionAuthority.allowed)return;
    actual.assertCurrentAppPoolAuthority(...args);
  }, assertCurrentAppLimitAuthority: (...args:Parameters<typeof actual.assertCurrentAppLimitAuthority>)=>{
    if(localSubmissionAuthority.allowed)return;
    actual.assertCurrentAppLimitAuthority(...args);
  }, assertCurrentD06AppAuthority: (graph: string) => {
    if (localSubmissionAuthority.allowed) return;
    actual.assertCurrentD06AppAuthority(graph);
  } };
});
vi.mock('../features/wallet/currentDexPoolFundingCapability', () => ({
  assertCurrentPoolFundingPrepared: (value: object, signer: object) => {
    if (fundingBrands.get(value) !== signer) throw new Error('Pool request was not prepared in this owner wallet session.');
  }
}));
// Use this only to reach the local sender mechanics behind the real App hold.
function allowLocalTechnicalSubmission() { localSubmissionAuthority.allowed = true; }

type Args = Parameters<typeof createCurrentSharedDexTokenFundingAdapter>[0];
const owner = getAddress(`0x${'11'.repeat(20)}`), hash = toBeHex(55n, 32), txHash = toBeHex(66n, 32), zero = `0x${'00'.repeat(20)}`;
function fixture(candidate: Args['candidate'] = 'cheap-prepared', selectedOwner = owner, submittedHash = txHash) {
  const owner = selectedOwner, txHash = submittedHash;
  const policy = resolveCurrentSharedTokenDistribution(candidate);
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  vi.stubGlobal('window', { sessionStorage: storage });
  const head = { number: 9952000n, hash, timestamp: 1791345000n, gasLimit: 120_000_000n };
  const states = CURRENT_SHARED_DEX_TOKENS.map(t => ({ ...t, claimed: false, balance: 7n, allowance: 3n, encryptionAddress: zero,
    quota: policy.initialQuota, nextClaimAt: 0n, initialAmount: policy.initialAmount, refillAmount: policy.refillAmount }));
  let active = true, unknown = false;
  const txs = { value: null as Awaited<ReturnType<Args['transport']['readTransaction']>> };
  const receipt = { hash: txHash, status: 1, from: owner, to: '', blockNumber: Number(head.number), blockHash: hash,
    logs: [] as { address: string; topics: string[]; data: string }[] };
  const assertCurrent = vi.fn(async () => { if (!active) throw new Error('Session changed'); });
  const transport: Args['transport'] = {
    assertCurrent, readHead: vi.fn(async () => head), readNonce: vi.fn(async () => 3), readBlockHash: vi.fn(async () => hash),
    readNativeResources: vi.fn(async h => ({ owner, chainId: policy.chainId, head: { ...h }, latestNonce: 3, pendingNonce: 3,
      baseFeePerGas: 1n, gasPrice: 50_000_000n, code: '0x', balance: 10n ** 18n })),
    estimateGas: vi.fn(async () => 800_000n), readTransaction: vi.fn(async () => txs.value),
    waitForReceipt: vi.fn(async () => receipt), verifyCanonicalInclusion: vi.fn(async () => {}),
    send: vi.fn(async request => {
      if (unknown) throw new Error('Unknown wallet result');
      txs.value = { ...request, hash: txHash, blockNumber: receipt.blockNumber, blockHash: hash };
      receipt.to = request.to;
      const initial = request.data === abi.encodeFunctionData('claimFaucet');
      const token = initial ? request.to : String(abi.decodeFunctionData('claim', request.data)[0]);
      const state = states.find(t => t.address.toLowerCase() === token.toLowerCase())!;
      if (receipt.status === 1) {
        const amount = initial ? policy.initialAmount : policy.refillAmount;
        state.balance += amount;
        if (initial) state.claimed = true;
        else { state.quota -= amount; state.nextClaimAt = head.timestamp + policy.cooldown; }
        receipt.logs = [{ address: token, ...abi.encodeEventLog(abi.getEvent('Transfer')!, [initial ? zero : policy.vault.address, owner, [0n, 0n], [77n, amount]]) },
          { address: initial ? token : policy.vault.address, ...abi.encodeEventLog(abi.getEvent(initial ? 'FaucetClaimed' : 'Claimed')!, initial ? [owner] : [token, owner]) }];
      }
      return { ...request, hash: txHash };
    })
  };
  const readFunds = vi.fn<Args['readFunds']>(async h => Object.freeze({ owner, head: Object.freeze({ ...h }), core: policy.core,
    graph: policy.graph, packageSha256: policy.packageSha256, vault: policy.vault, privateFundsVerified: true as const, readyToSign: false as const,
    tokens: Object.freeze(states.map(t => Object.freeze({ ...t, initialClaimAvailability: t.claimed ? 'claimed' as const : 'ready' as const,
      refillAvailability: !t.claimed ? 'initial-claim-required' as const : h.timestamp >= policy.vault.expiresAt ? 'expired' as const :
        t.quota < policy.refillAmount ? 'exhausted' as const : h.timestamp < t.nextClaimAt ? 'cooldown' as const : 'ready' as const }))) }));
  const admission = vi.fn(async () => {}), decrypt = vi.fn((cipher: Parameters<Args['decrypt']>[0]) => {
    if (BigInt(cipher.ciphertextHigh) !== 77n) throw new Error('Wrong viewer cipher'); return BigInt(cipher.ciphertextLow);
  });
  const args: Args = { candidate, signer: {}, ownerAddress: owner, chainId: policy.chainId, transport, readFunds,
    readReceiptBlock: async () => ({ ...head }), decrypt, assertAdmission: admission, now: () => head.timestamp };
  const cap = createCurrentSharedDexTokenFundingAdapter(args);
  const prepare = (action: CurrentSharedTokenFundingAction = 'initial', index = 0, confirm: (review: unknown) => Promise<boolean> = async () => true) => cap.prepareSharedTokenFunding({ action,
    token: states[index].address, confirm });
  return { policy, cap, args, prepare, states, head, transport, receipt, txs, readFunds, admission, values, storage, decrypt,
    revoke: () => { active = false; }, unknown: () => { unknown = true; } };
}
afterEach(() => { localSubmissionAuthority.allowed = false; vi.unstubAllGlobals(); });

describe('selected exit candidate funding identity', () => {
  it.each(['initial', 'refill'] as const)('admits current engineering %s for each of the four tokens with exact private credit', async action => {
    for (const selected of ['0x8b749251cf1f712d4e39fd048c53394af03e10be', '0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d']) for (let index = 0; index < 4; index++) {
      const engineering = getAddress(selected), f = fixture('cheap-history', engineering);
      if (action === 'refill') f.states[index].claimed = true;
      const before = f.states.map(token => ({ ...token })), confirm = vi.fn(async () => true);
      expect(() => assertCurrentSharedTokenFundingAppAuthority({ candidate: 'cheap-history', owner: engineering,
        token: f.states[index].address, action })).not.toThrow();
      const prepared = (await f.prepare(action, index, confirm))!, sent = await f.cap.submitSharedTokenFunding(prepared);
      const result = await sent.recover();
      expect(result).toMatchObject({ fundingOutcome: 'verified', privateAccountingVerified: true });
      expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({ gasPrice: 50_000_000n, gasLimit: 5_000_000n,
        to: action === 'initial' ? f.states[index].address : f.policy.vault.address }), expect.any(Function));
      expect(f.states[index].balance).toBe(before[index].balance + (action === 'initial' ? f.policy.initialAmount : f.policy.refillAmount));
      expect(f.states.every((token, i) => token.allowance === before[i].allowance && (i === index || token.balance === before[i].balance))).toBe(true);
      expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
    }
  });
  it.each([
    ['phase', 'token-approve', 5_000_000n, 'claimFaucet', 'token-faucet'],
    ['target', 'token-faucet', 5_000_000n, 'claimFaucet', 'token'],
    ['calldata', 'token-faucet', 5_000_000n, 'claim', 'token-faucet'],
    ['cap', 'token-faucet', 5_000_001n, 'claimFaucet', 'token-faucet']
  ] as const)('rejects changed history funding %s before native reads or send', async (_fault, phase, cap, dataKind, targetKind) => {
    const engineering = getAddress('0x8b749251cf1f712d4e39fd048c53394af03e10be'), f = fixture('cheap-history', engineering);
    const c = { ...f.policy }, token = f.states[0].address;
    const boundary = createCurrentAttemptBoundary({ storage: f.storage, c, core: f.policy.core, owner: engineering,
      chainId: f.policy.chainId, transport: f.transport, attest: async () => {}, now: () => f.head.timestamp,
      historical: false, bindTarget: true });
    const call = { chainId: f.policy.chainId, from: engineering,
      to: targetKind === 'token' ? f.states[1].address : token, value: 0n as const,
      data: dataKind === 'claim' ? abi.encodeFunctionData('claim', [token]) : abi.encodeFunctionData('claimFaucet') };
    await expect(boundary.sendCurrent(phase as never, call, undefined, async () => {}, () => {}, undefined, cap,
      undefined, undefined, undefined, undefined, undefined, { action: 'initial', token })).rejects.toThrow('Shared funding App call changed.');
    expect(f.transport.readHead).not.toHaveBeenCalled(); expect(f.transport.readNonce).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled(); expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  it('rechecks the history scope before pending reservation after signing authorization yields', async () => {
    const engineering = getAddress('0x8b749251cf1f712d4e39fd048c53394af03e10be'), f = fixture('cheap-history', engineering);
    const c = { ...f.policy }, token = f.states[0].address;
    const boundary = createCurrentAttemptBoundary({ storage: f.storage, c, core: f.policy.core, owner: engineering,
      chainId: f.policy.chainId, transport: f.transport, attest: async () => {}, now: () => f.head.timestamp,
      historical: false, bindTarget: true });
    const call = { chainId: f.policy.chainId, from: engineering, to: token, value: 0n as const,
      data: abi.encodeFunctionData('claimFaucet') };
    await expect(boundary.sendCurrent('token-faucet', call, undefined, async () => {}, () => {}, undefined, 5_000_000n,
      undefined, async () => { c.graph = '00'.repeat(32); }, undefined, undefined, undefined, { action: 'initial', token }))
      .rejects.toThrow('held');
    expect(f.transport.estimateGas).toHaveBeenCalledOnce();
    expect(f.transport.send).not.toHaveBeenCalled(); expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  it('keeps unrelated current wallets outside funding admission', () => {
    for (const selected of [owner, '0xab5374daddea783c3e58de19db497b54c79fd4cc']) {
      for (const action of ['initial', 'refill']) expect(() => assertCurrentSharedTokenFundingAppAuthority({
        candidate: 'cheap-history', owner: selected, token: CURRENT_SHARED_DEX_TOKENS[0].address, action })).toThrow('held');
    }
  });
  it.each(['initial', 'refill'] as const)('binds %s review, pending and private result to the current Core', async action => {
    const f = fixture('cheap-exit'); if (action === 'refill') f.states[0].claimed = true;
    const p = (await f.prepare(action))!;
    expect(p).toMatchObject({ core: f.policy.core, graph: f.policy.graph, packageSha256: f.policy.packageSha256, readyToSign: false });
    allowLocalTechnicalSubmission();
    const sent = await f.cap.submitSharedTokenFunding(p);
    expect(readCurrentDexPendingAttempt(f.storage)).toMatchObject({ core: f.policy.core.toLowerCase(), graph: `0x${f.policy.graph}` });
    expect(await sent.recover()).toMatchObject({ core: f.policy.core, graph: f.policy.graph, packageSha256: f.policy.packageSha256,
      fundingOutcome: 'verified', privateAccountingVerified: true, funds: { core: f.policy.core } });
    expect(f.decrypt.mock.calls.every(([cipher]) => cipher.ciphertextHigh === 77n)).toBe(true);
  });
  it('rejects another candidate preparation and pending attempt without sending or clearing it', async () => {
    const f = fixture('cheap-exit'), p = (await f.prepare())!;
    const old = createCurrentSharedDexTokenFundingAdapter({ ...f.args, candidate: 'cheap-prepared' });
    await expect(old.submitSharedTokenFunding(p)).rejects.toThrow('preparation or session changed');
    allowLocalTechnicalSubmission();
    await f.cap.submitSharedTokenFunding(p); const pending = f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY);
    await expect(old.recoverPendingSharedTokenFunding()).rejects.toThrow('another adapter');
    expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(pending); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['core', 'graph', 'packageSha256', 'privateFundsVerified', 'allowance'] as const)('rejects wrong %s in current private funds', async field => {
    const f = fixture('cheap-exit'), original = await f.args.readFunds(f.head);
    f.readFunds.mockImplementation(async head => {
      const funds = { ...original, head };
      if (field === 'allowance') return { ...funds, tokens: funds.tokens.map((t, i) => i === 0 ? { ...t, allowance: -1n } : t) };
      return { ...funds, [field]: field === 'privateFundsVerified' ? false : policy[field] } as Awaited<ReturnType<Args['readFunds']>>;
    });
    await expect(f.prepare()).rejects.toThrow('identity or state changed'); expect(f.transport.send).not.toHaveBeenCalled();
  });
});

function approvalFixture(pairIndex = 0, canonicalIndex: 0 | 1 = 0, cleanup = false, candidate: Args['candidate'] = 'cheap-prepared',selectedOwner=owner) {
  const owner=selectedOwner;
  const f = fixture(candidate,owner), policy = f.policy;
  const pair = resolvePreparedDexScope(candidate??'cheap-prepared').candidate.pairs[pairIndex];
  f.states.forEach(t => { t.allowance = 0n; t.balance = 100n; });
  const selectedIndex = f.states.findIndex(t => t.address.toLowerCase() === pair.tokens[canonicalIndex].toLowerCase());
  const amount = canonicalIndex === 0 ? 11n : 13n;
  if (cleanup) f.states[selectedIndex].allowance = amount;
  const funding = {
    graph: policy.graph, packageSha256: policy.packageSha256, chainId: policy.chainId,
    from: owner, to: policy.core, value: 0n, readyToSign: false,
    intent: { marketId: pair.marketId, poolTokens: pair.tokens, principal: owner, core: policy.core,
      classId:0n,budgets:[11n,13n] as const,terms:[1n,1n,1n,1n,1n,1n,1n,1n,1n,200n] as const },
    amounts: { used0: 11n, used1: 13n }, assertCurrent: vi.fn(async () => {}),
    assertApprovalCurrent: vi.fn(async () => {}), assertUnfundedCleanupCurrent: vi.fn(async () => {})
  };
  fundingBrands.set(funding, f.args.signer);
  const encrypt = vi.fn<NonNullable<Args['encrypt']>>(async value => ({ ciphertext: { ciphertextHigh: 88n, ciphertextLow: value }, signature: `0x${'12'.repeat(65)}` }));
  const approvalAdmission = vi.fn(async () => {});
  const args = { ...f.args, encrypt, assertApprovalAdmission: approvalAdmission };
  const cap = createCurrentSharedDexTokenFundingAdapter(args);
  vi.mocked(f.transport.send).mockImplementation(async request => {
    // Keep the existing session/resources and replace only the token effect.
    if (unknownApproval) throw new Error('Unknown wallet result');
    f.txs.value = { ...request, hash: txHash, blockNumber: f.receipt.blockNumber, blockHash: hash };
    f.receipt.to = request.to;
    if (f.receipt.status === 1) {
      const input = approvalAbi.decodeFunctionData('approve', request.data)[1];
      const approved = BigInt(input.ciphertext.ciphertextLow);
      f.states[selectedIndex].allowance = approved;
      f.receipt.logs = [{ address: request.to, ...approvalAbi.encodeEventLog(approvalAbi.getEvent('Approval')!,
        [owner, policy.core, [77n, approved], [99n, 999n]]) }];
    }
    return { ...request, hash: txHash };
  });
  let unknownApproval = false;
  const confirm = vi.fn(async () => true);
  const request = { funding: funding as unknown as CurrentPoolPreparedFunding, canonicalIndex, cleanup, confirm };
  return { ...f, cap, args, funding, request, encrypt, confirm, approvalAdmission, selectedIndex, amount,
    prepare: () => cap.prepareSharedPoolApproval(request), unknown: () => { unknownApproval = true; } };
}

describe('Pool allowance cleanup after lost funding review', () => {
  const cleanupFixture = (canonicalIndex: 0 | 1 = 0) => {
    const f = approvalFixture(0, canonicalIndex, true, 'cheap-history', getAddress('0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d'));
    fundingBrands.delete(f.funding);
    return { ...f, cleanupRequest: { marketId: f.funding.intent.marketId, canonicalIndex, confirm: f.confirm } };
  };
  it.each([0, 1] as const)('clears only selected allowance %s without an old funding brand or terms', async index => {
    const f = cleanupFixture(index); f.states[f.selectedIndex].allowance = 999_999_999n;
    const before = f.states.map(token => ({ ...token }));
    const p = (await f.cap.prepareSharedPoolAllowanceCleanup(f.cleanupRequest))!;
    expect(p).toMatchObject({ amount: 0n, cleanup: true, recovery: true });
    expect(f.confirm).toHaveBeenCalledWith(expect.objectContaining({ amount: 0n, previousAllowance: 999_999_999n, cleanup: true }));
    expect(f.encrypt).toHaveBeenCalledWith(0n, p.token, approvalAbi.getFunction('approve')!.selector);
    expect(assertCurrentSharedPoolApprovalPrepared(p, f.args.signer)).toMatchObject({ kind: 'allowance-cleanup', marketId: p.marketId, from: f.args.ownerAddress, to: f.policy.core });
    const sent = await f.cap.submitSharedPoolApproval(p), result = await sent.recover();
    expect(result).toMatchObject({ recoveredCleanup: true, cleanup: true, fundingOutcome: 'verified', privateAccountingVerified: true });
    expect(f.states).toEqual(before.map((token, i) => i === f.selectedIndex ? { ...token, allowance: 0n } : token));
    expect(f.funding.assertApprovalCurrent).not.toHaveBeenCalled(); expect(f.funding.assertUnfundedCleanupCurrent).not.toHaveBeenCalled();
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  it('does not ask for review, encryption or signing when allowance is already zero', async () => {
    const f = cleanupFixture(); f.states[f.selectedIndex].allowance = 0n;
    expect(await f.cap.prepareSharedPoolAllowanceCleanup(f.cleanupRequest)).toBeNull();
    expect(f.confirm).not.toHaveBeenCalled(); expect(f.encrypt).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['market', 'token-index', 'pending', 'review-drift', 'session'] as const)('rejects cleanup %s without signing', async reason => {
    const f = cleanupFixture(), request = { ...f.cleanupRequest };
    if (reason === 'market') request.marketId = f.policy.core;
    if (reason === 'token-index') request.canonicalIndex = 2 as 0;
    if (reason === 'pending') f.storage.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY, 'unreconciled');
    if (reason === 'review-drift') f.confirm.mockImplementation(async () => { f.states[3].balance++; return true; });
    if (reason === 'session') f.revoke();
    await expect(f.cap.prepareSharedPoolAllowanceCleanup(request)).rejects.toThrow(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['owner', 'graph'] as const)('holds cleanup for another %s', async reason => {
    const f = approvalFixture(0, 0, true, reason === 'graph' ? 'cheap-exit' : 'cheap-history');
    await expect(f.cap.prepareSharedPoolAllowanceCleanup({ marketId: f.funding.intent.marketId, canonicalIndex: 0, confirm: f.confirm })).rejects.toThrow('hold');
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['brand','signer','phase','target','data','cap','candidate','amount','recovery'] as const)('holds changed cleanup %s at the shared sender', async fault => {
    const f = cleanupFixture(), p = (await f.cap.prepareSharedPoolAllowanceCleanup(f.cleanupRequest))!, c = { ...f.policy };
    const boundary = createCurrentAttemptBoundary({ storage: f.storage, c, core: f.policy.core, owner: f.args.ownerAddress,
      chainId: f.policy.chainId, transport: f.transport, attest: async () => {}, now: () => f.head.timestamp, historical: false, bindTarget: true });
    vi.clearAllMocks(); if (fault === 'candidate') c.packageSha256 = 'changed';
    const call = { chainId: f.policy.chainId, from: f.args.ownerAddress, to: fault === 'target' ? f.policy.core : p.token,
      value: 0n as const, data: fault === 'data' ? '0x12345678' : p.data };
    const prepared = fault === 'brand' ? { ...p } : fault === 'amount' ? { ...p, amount: 1n } : fault === 'recovery' ? { ...p, recovery: undefined } : p;
    await expect(boundary.sendCurrent(fault === 'phase' ? 'pool-preview' : 'token-approve', call, undefined, async () => {}, () => {}, undefined,
      fault === 'cap' ? 5_000_001n : 5_000_000n, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      { kind: 'approval', prepared, signer: fault === 'signer' ? {} : f.args.signer })).rejects.toThrow();
    expect(f.transport.send).not.toHaveBeenCalled(); expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  it.each(['allowance', 'other-balance', 'session', 'fee', 'nonce', 'fit', 'copy'] as const)('rejects cleanup drift %s before signing', async reason => {
    const f = cleanupFixture(), p = (await f.cap.prepareSharedPoolAllowanceCleanup(f.cleanupRequest))!;
    if (reason === 'allowance') f.states[f.selectedIndex].allowance++;
    if (reason === 'other-balance') f.states[3].balance++;
    if (reason === 'session') f.revoke();
    if (reason === 'fit') vi.mocked(f.transport.estimateGas).mockResolvedValue(5_000_000n);
    if (reason === 'fee' || reason === 'nonce') {
      const r = await f.transport.readNativeResources!(f.head);
      vi.mocked(f.transport.readNativeResources!).mockResolvedValue({ ...r, ...(reason === 'fee' ? { baseFeePerGas: 50_000_001n } : { pendingNonce: 4 }) });
    }
    await expect(f.cap.submitSharedPoolApproval(reason === 'copy' ? { ...p } : p)).rejects.toThrow(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('retains a hashless cleanup attempt and does not resend', async () => {
    const f = cleanupFixture(), p = (await f.cap.prepareSharedPoolAllowanceCleanup(f.cleanupRequest))!; f.unknown();
    await expect(f.cap.submitSharedPoolApproval(p)).rejects.toThrow('Unknown');
    await expect(f.cap.submitSharedPoolApproval(p)).rejects.toThrow('pending'); expect(f.transport.send).toHaveBeenCalledOnce();
  });
});

describe('exit candidate exact Pool approvals', () => {
  const cases = STAGED_EXIT_PREVIEW_DEX_CANDIDATE.pairs.flatMap((_, pairIndex) =>
    ([0, 1] as const).map(canonicalIndex => ({ pairIndex, canonicalIndex })));
  it.each(cases)('proves current-Core approval for pair $pairIndex token $canonicalIndex', async ({ pairIndex, canonicalIndex }) => {
    const f = approvalFixture(pairIndex, canonicalIndex, false, 'cheap-exit'), before = f.states.map(t => ({ ...t }));
    const p = (await f.prepare())!;
    expect(p).toMatchObject({ core: f.policy.core, graph: f.policy.graph, packageSha256: f.policy.packageSha256 });
    expect(approvalAbi.decodeFunctionData('approve', p.data)[0]).toBe(f.policy.core);
    allowLocalTechnicalSubmission();
    const sent = await f.cap.submitSharedPoolApproval(p);
    expect(await sent.recover()).toMatchObject({ core: f.policy.core, fundingOutcome: 'verified', privateAccountingVerified: true });
    expect(f.states).toEqual(before.map((t, i) => i === f.selectedIndex ? { ...t, allowance: f.amount } : t));
    expect(f.decrypt.mock.calls.every(([cipher]) => cipher.ciphertextHigh === 77n)).toBe(true);
  });
  it('rejects an old-Core approval event and preserves the blocked pending result', async () => {
    const f = approvalFixture(5, 1, false, 'cheap-exit'), p = (await f.prepare())!;
    allowLocalTechnicalSubmission();
    const sent = await f.cap.submitSharedPoolApproval(p);
    f.receipt.logs = [{ address: p.token, ...approvalAbi.encodeEventLog(approvalAbi.getEvent('Approval')!,
      [owner, policy.core, [77n, f.amount], [99n, f.amount]]) }];
    await expect(sent.recover()).rejects.toThrow('event changed');
    expect(readCurrentDexPendingAttempt(f.storage)).toMatchObject({ core: f.policy.core.toLowerCase(), verificationBlocked: true });
  });
  it('keeps exit candidate approval signing held before review or encryption', async () => {
    const f = approvalFixture(2, 0, false, 'cheap-exit');
    const cap = createCurrentSharedDexTokenFundingAdapter({ ...f.args, assertApprovalAdmission: undefined });
    await expect(cap.prepareSharedPoolApproval(f.request)).rejects.toThrow('held');
    expect(f.encrypt).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['core', 'market', 'pair'] as const)('rejects a wrong %s before private approval encryption', async field => {
    const f = approvalFixture(5, 1, false, 'cheap-exit');
    if (field === 'core') f.funding.intent.core = policy.core;
    if (field === 'market') f.funding.intent.marketId = STAGED_EXIT_PREVIEW_DEX_CANDIDATE.pairs[0].marketId;
    if (field === 'pair') Object.assign(f.funding.intent, { poolTokens: [...f.funding.intent.poolTokens].reverse() });
    await expect(f.prepare()).rejects.toThrow('exact funding intent');
    expect(f.encrypt).not.toHaveBeenCalled(); expect(f.readFunds).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
  });
});

function limitApprovalFixture(kind: 'create' | 'topup' = 'topup', index: 0 | 1 = 0, candidate:'cheap-exit'|'cheap-history'='cheap-exit',selectedOwner=candidate==='cheap-history'?getAddress('0x8b749251cf1f712d4e39fd048c53394af03e10be'):owner) {
  const owner=selectedOwner;
  const f = approvalFixture(2, index, false, candidate,owner), pair = resolvePreparedDexScope(candidate).candidate.pairs[2];
  const funding = { phase: 'limit-funding-review' as const, kind, from: owner, to: f.policy.core, chainId: f.policy.chainId,
    graph: f.policy.graph, packageSha256: f.policy.packageSha256, marketId: pair.marketId as string, poolTokens: pair.tokens,
    fundingToken: pair.tokens[index] as string, amount: f.amount, readyToSign: false as const,
    assertCurrent: vi.fn(async () => {}), assertAuthority: vi.fn(async () => {}) };
  limitBrands.set(funding, f.args.signer);
  const request = { funding: funding as CurrentLimitFundingReview, confirm: f.confirm };
  return { ...f, funding, request, prepare: () => f.cap.prepareSharedLimitApproval(request) };
}

describe('plain Limit exact allowance consumer', () => {
  it.each([
    ['create','0x8b749251cf1f712d4e39fd048c53394af03e10be'],['topup','0x8b749251cf1f712d4e39fd048c53394af03e10be'],
    ['create','0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d'],['topup','0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d']
  ] as const)('uses authorized %s approval for %s through private result',async(kind,address)=>{
    const engineering=getAddress(address);
    const f=limitApprovalFixture(kind,0,'cheap-history',engineering),before=f.states.map(t=>({...t}));
    const cap=createCurrentSharedDexTokenFundingAdapter({...f.args,assertApprovalAdmission:undefined});
    const p=(await cap.prepareSharedLimitApproval(f.request))!,sent=await cap.submitSharedLimitApproval(p);
    expect(f.transport.send).toHaveBeenCalledOnce();
    expect(await sent.recover()).toMatchObject({fundingOutcome:'verified',privateAccountingVerified:true});
    expect(f.states).toEqual(before.map((t,i)=>i===f.selectedIndex?{...t,allowance:f.amount}:t));
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
    await expect(cap.submitSharedLimitApproval(p)).rejects.toThrow();expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('rejects excessive engineering allowance before private reads, input signing or review',async()=>{
    const f=limitApprovalFixture('create',0,'cheap-history',getAddress('0x8b749251cf1f712d4e39fd048c53394af03e10be'));
    f.funding.amount=1_000_001n;
    await expect(f.cap.prepareSharedLimitApproval(f.request)).rejects.toThrow('hold');
    for(const fn of [f.readFunds,f.encrypt,f.confirm,f.transport.readNonce,f.transport.send]) expect(fn).not.toHaveBeenCalled();
  });
  it('binds a new-graph Limit approval to its exact Core and preserves all wallet balances',async()=>{
    const f=limitApprovalFixture('topup',1,'cheap-history'),before=f.states.map(t=>({...t})),p=(await f.prepare())!;
    expect(p).toMatchObject({core:f.policy.core,graph:f.policy.graph,packageSha256:f.policy.packageSha256});
    allowLocalTechnicalSubmission();const sent=await f.cap.submitSharedLimitApproval(p);
    expect(await sent.recover()).toMatchObject({fundingOutcome:'verified',privateAccountingVerified:true});
    expect(f.states).toEqual(before.map((t,i)=>i===f.selectedIndex?{...t,allowance:f.amount}:t));
  });
  it('keeps new-graph allowance authority held before private inputs or a transaction',async()=>{
    const f=limitApprovalFixture('create',0,'cheap-history',owner),cap=createCurrentSharedDexTokenFundingAdapter({...f.args,assertApprovalAdmission:undefined});
    await expect(cap.prepareSharedLimitApproval(f.request)).rejects.toThrow(/held|hold/);
    expect(f.encrypt).not.toHaveBeenCalled();expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each([['create', 0], ['topup', 1]] as const)('sets exact %s allowance for token %s without moving inventory', async (kind, index) => {
    const f = limitApprovalFixture(kind, index), before = f.states.map(t => ({ ...t }));
    f.states[f.selectedIndex].allowance = 1n; before[f.selectedIndex].allowance = 1n;
    const p = (await f.prepare())!;
    expect(f.confirm).toHaveBeenCalledWith({ token: p.token, amount: f.amount, previousAllowance: 1n, spender: f.policy.core });
    expect(f.encrypt).toHaveBeenCalledWith(f.amount, p.token, approvalAbi.getFunction('approve')!.selector);
    allowLocalTechnicalSubmission(); const sent = await f.cap.submitSharedLimitApproval(p);
    f.funding.assertAuthority.mockRejectedValue(new Error('Allowance changed after its mined approval'));
    expect(await sent.recover()).toMatchObject({ fundingOutcome: 'verified', privateAccountingVerified: true });
    expect(f.states).toEqual(before.map((t, i) => i === f.selectedIndex ? { ...t, allowance: f.amount } : t));
    expect(f.decrypt.mock.calls.every(([cipher]) => cipher.ciphertextHigh === 77n)).toBe(true);
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  it('keeps the actual App hold before review, private encryption or wallet resources', async () => {
    const f = limitApprovalFixture(), cap = createCurrentSharedDexTokenFundingAdapter({ ...f.args, assertApprovalAdmission: undefined });
    await expect(cap.prepareSharedLimitApproval(f.request)).rejects.toThrow('held');
    await expect(cap.submitSharedLimitApproval({} as never)).rejects.toThrow('held');
    for (const call of [f.confirm, f.encrypt, f.readFunds, f.transport.readNonce, f.transport.estimateGas, f.transport.send]) expect(call).not.toHaveBeenCalled();
  });
  it.each(['copy', 'session', 'core', 'market', 'pair', 'token', 'zero', 'overflow', 'balance', 'exact', 'source', 'review-drift'])('rejects changed Limit funding before a transaction: %s', async fault => {
    const f = limitApprovalFixture();
    if (fault === 'copy') f.request.funding = { ...f.funding };
    if (fault === 'session') limitBrands.set(f.funding, {});
    if (fault === 'core') f.funding.to = policy.core;
    if (fault === 'market') f.funding.marketId = STAGED_EXIT_PREVIEW_DEX_CANDIDATE.pairs[0].marketId;
    if (fault === 'pair') Object.assign(f.funding, { poolTokens: [...f.funding.poolTokens].reverse() });
    if (fault === 'token') f.funding.fundingToken = owner;
    if (fault === 'zero') f.funding.amount = 0n;
    if (fault === 'overflow') f.funding.amount = 1n << 256n;
    if (fault === 'balance') f.states[f.selectedIndex].balance = 0n;
    if (fault === 'exact') f.states[f.selectedIndex].allowance = f.amount;
    if (fault === 'source') f.funding.assertAuthority.mockRejectedValue(new Error('Source changed'));
    if (fault === 'review-drift') f.confirm.mockImplementation(async () => { f.states[3].balance++; return true; });
    await expect(f.prepare()).rejects.toThrow(); expect(f.encrypt).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('cancels the allowance review without private input or pending state', async () => {
    const f = limitApprovalFixture(); f.confirm.mockResolvedValue(false);
    expect(await f.prepare()).toBeNull(); expect(f.encrypt).not.toHaveBeenCalled(); expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  it('rechecks source authority before sending and rejects a copied approval', async () => {
    const f = limitApprovalFixture(), p = (await f.prepare())!;
    await expect(f.cap.submitSharedLimitApproval({ ...p })).rejects.toThrow();
    f.funding.assertAuthority.mockRejectedValue(new Error('Source changed'));
    await expect(f.cap.submitSharedLimitApproval(p)).rejects.toThrow('Source changed'); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('keeps uncertainty pending and never sends it twice', async () => {
    const f = limitApprovalFixture(), p = (await f.prepare())!; allowLocalTechnicalSubmission(); f.unknown();
    await expect(f.cap.submitSharedLimitApproval(p)).rejects.toThrow('Unknown');
    expect(await f.cap.recoverPendingSharedLimitApproval()).toMatchObject({ status: 'manual-reconciliation-required', privateAccountingVerified: false });
    await expect(f.cap.submitSharedLimitApproval(p)).rejects.toThrow('pending'); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('locks a private accounting failure; reload cannot clear it', async () => {
    const f = limitApprovalFixture(), p = (await f.prepare())!; allowLocalTechnicalSubmission(); const sent = await f.cap.submitSharedLimitApproval(p);
    f.states[(f.selectedIndex + 1) % 4].balance++;
    await expect(sent.recover()).rejects.toThrow('private balances');
    expect(readCurrentDexPendingAttempt(f.storage)?.verificationBlocked).toBe(true);
    await expect(createCurrentSharedDexTokenFundingAdapter(f.args).recoverPendingSharedLimitApproval()).rejects.toThrow('Known');
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
});

function swapApprovalFixture(tokenIndex = 0, candidate: 'cheap-exit' | 'cheap-history' = 'cheap-exit') {
  const descriptor = resolvePreparedDexScope(candidate).candidate;
  const pairIndex = descriptor.pairs.findIndex(pair => pair.tokens.some(token => token.toLowerCase() === CURRENT_SHARED_DEX_TOKENS[tokenIndex].address.toLowerCase()));
  const canonicalIndex = descriptor.pairs[pairIndex].tokens.findIndex(token => token.toLowerCase() === CURRENT_SHARED_DEX_TOKENS[tokenIndex].address.toLowerCase()) as 0 | 1;
  const f = approvalFixture(pairIndex, canonicalIndex, false, candidate);
  const admission = vi.fn<NonNullable<Args['assertSwapApprovalAdmission']>>(async () => {}), assertReviewCurrent = vi.fn(async () => {});
  const args = { ...f.args, assertSwapApprovalAdmission: admission }, cap = createCurrentSharedDexTokenFundingAdapter(args);
  const request = { token: f.states[tokenIndex].address, amount: 17n, assertReviewCurrent, confirm: vi.fn(async () => true) };
  return { ...f, args, cap, request, admission, assertReviewCurrent, prepare: () => cap.prepareSharedSwapApproval(request) };
}

describe('history candidate exact swap approvals', () => {
  it.each([0, 1, 2, 3])('prepares and proves only token %s allowance for the current Core', async tokenIndex => {
    const f = swapApprovalFixture(tokenIndex, 'cheap-history'), before = f.states.map(t => ({ ...t })), p = (await f.prepare())!;
    expect(p).toMatchObject({ candidate: 'cheap-history', core: f.policy.core, spender: f.policy.core, graph: f.policy.graph,
      packageSha256: f.policy.packageSha256, token: getAddress(f.request.token), amount: 17n, readyToSign: false });
    allowLocalTechnicalSubmission(); const sent = await f.cap.submitSharedSwapApproval(p);
    expect(await sent.recover()).toMatchObject({ privateAccountingVerified: true, fundingOutcome: 'verified' });
    expect(f.states).toEqual(before.map((t, i) => i === tokenIndex ? { ...t, allowance: 17n } : t));
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull(); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('retains the default owner hold before reads, confirmation or encryption', async () => {
    const f = swapApprovalFixture(0, 'cheap-history'), cap = createCurrentSharedDexTokenFundingAdapter({ ...f.args, assertSwapApprovalAdmission: undefined });
    await expect(cap.prepareSharedSwapApproval(f.request)).rejects.toThrow('held');
    for (const mock of [f.readFunds, f.request.confirm, f.encrypt, f.transport.send]) expect(mock).not.toHaveBeenCalled();
  });
  it('restores known approval metadata without a resend', async () => {
    const f = swapApprovalFixture(0, 'cheap-history'), p = (await f.prepare())!;
    allowLocalTechnicalSubmission(); await f.cap.submitSharedSwapApproval(p);
    const reloaded = createCurrentSharedDexTokenFundingAdapter(f.args);
    expect(await reloaded.recoverPendingSharedSwapApproval()).toMatchObject({ status: 'observed-mined', privateAccountingVerified: false });
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull(); expect(f.transport.send).toHaveBeenCalledOnce();
  });
});

describe('exit candidate exact swap approvals', () => {
  it.each([0, 1, 2, 3])('proves selected token %s without a Pool intent or another token change', async tokenIndex => {
    const f = swapApprovalFixture(tokenIndex), before = f.states.map(t => ({ ...t })), prepared = (await f.prepare())!;
    expect(prepared).toMatchObject({ candidate: 'cheap-exit', owner, spender: f.policy.core, token: getAddress(f.request.token), amount: 17n, readyToSign: false });
    expect(f.encrypt).toHaveBeenCalledWith(17n, prepared.token, approvalAbi.getFunction('approve')!.selector);
    expect(f.admission.mock.calls.every(([review]) => !('data' in review))).toBe(true);
    allowLocalTechnicalSubmission(); const sent = await f.cap.submitSharedSwapApproval(prepared);
    expect(await sent.recover()).toMatchObject({ fundingOutcome: 'verified', privateAccountingVerified: true });
    expect(f.states).toEqual(before.map((t, i) => i === tokenIndex ? { ...t, allowance: 17n } : t));
    expect(f.decrypt.mock.calls.every(([cipher]) => cipher.ciphertextHigh === 77n)).toBe(true);
    expect(f.funding.assertApprovalCurrent).not.toHaveBeenCalled(); expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  it('holds by default before private reads, review or encryption', async () => {
    const f = swapApprovalFixture(), cap = createCurrentSharedDexTokenFundingAdapter({ ...f.args, assertSwapApprovalAdmission: undefined });
    await expect(cap.prepareSharedSwapApproval(f.request)).rejects.toThrow('held');
    for (const mock of [f.readFunds, f.request.confirm, f.encrypt, f.transport.send]) expect(mock).not.toHaveBeenCalled();
  });
  it.each([0n, -1n, 1n << 256n])('rejects invalid or out-of-bound amount %s', async amount => {
    const f = swapApprovalFixture(); await expect(f.cap.prepareSharedSwapApproval({ ...f.request, amount })).rejects.toThrow('Invalid exact swap');
    expect(f.readFunds).not.toHaveBeenCalled(); expect(f.encrypt).not.toHaveBeenCalled();
  });
  it('prepares an exact allowance above the old trial cap when funds are available',async()=>{
    const f=swapApprovalFixture();f.states[0].balance=100_000_000n;
    const prepared=await f.cap.prepareSharedSwapApproval({...f.request,amount:20_000_001n});
    expect(prepared).not.toBeNull();expect(f.encrypt).toHaveBeenCalled();expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['balance', 'allowance'] as const)('rejects insufficient balance or unmatched nonzero %s', async field => {
    const f = swapApprovalFixture(); f.states[0][field] = field === 'balance' ? 16n : 1n;
    await expect(f.prepare()).rejects.toThrow('sufficient funds and zero prior allowance'); expect(f.encrypt).not.toHaveBeenCalled();
  });
  it('does not encrypt or send after cancelled confirmation', async () => {
    const f = swapApprovalFixture(); f.request.confirm.mockResolvedValue(false);
    expect(await f.prepare()).toBeNull(); expect(f.encrypt).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['confirmation', 'encryption', 'submission'] as const)('stops a changed review scope at %s', async phase => {
    const f = swapApprovalFixture(); let active = true;
    f.assertReviewCurrent.mockImplementation(async () => { if (!active) throw new Error('Review scope changed'); });
    if (phase === 'confirmation') f.request.confirm.mockImplementation(async () => { active = false; return true; });
    if (phase === 'encryption') f.encrypt.mockImplementation(async value => { active = false; return { ciphertext: { ciphertextHigh: 88n, ciphertextLow: value }, signature: `0x${'12'.repeat(65)}` }; });
    if (phase !== 'submission') await expect(f.prepare()).rejects.toThrow('Review scope changed');
    else { const p = (await f.prepare())!; active = false; await expect(f.cap.submitSharedSwapApproval(p)).rejects.toThrow('Review scope changed'); }
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('rejects cloned, cross-session and Pool preparations', async () => {
    const f = swapApprovalFixture(), p = (await f.prepare())!, other = createCurrentSharedDexTokenFundingAdapter(f.args);
    await expect(f.cap.submitSharedSwapApproval({ ...p })).rejects.toThrow('this session');
    await expect(other.submitSharedSwapApproval(p)).rejects.toThrow('this session');
    await expect(f.cap.submitSharedPoolApproval(p as unknown as Parameters<typeof f.cap.submitSharedPoolApproval>[0])).rejects.toThrow('this session');
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['funds', 'block', 'expiry', 'resources'] as const)('rejects stale %s before send', async field => {
    const f = swapApprovalFixture(), p = (await f.prepare())!;
    if (field === 'funds') f.states[3].balance++;
    if (field === 'block') vi.mocked(f.transport.readBlockHash).mockResolvedValue(toBeHex(1n, 32));
    if (field === 'expiry') f.head.timestamp += 301n;
    if (field === 'resources') vi.mocked(f.transport.readNativeResources!).mockImplementation(async h => ({ owner, chainId: f.policy.chainId, head: h, latestNonce: 3, pendingNonce: 4, balance: 10n ** 18n, baseFeePerGas: 1n, gasPrice: 50_000_000n, code: '0x' }));
    await expect(f.cap.submitSharedSwapApproval(p)).rejects.toThrow(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('keeps an uncertain send locked and never resends', async () => {
    const f = swapApprovalFixture(), p = (await f.prepare())!; allowLocalTechnicalSubmission(); f.unknown();
    await expect(f.cap.submitSharedSwapApproval(p)).rejects.toThrow('Unknown wallet result');
    expect(await f.cap.recoverPendingSharedSwapApproval()).toMatchObject({ status: 'manual-reconciliation-required', privateAccountingVerified: false });
    await expect(f.cap.submitSharedSwapApproval(p)).rejects.toThrow(); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('blocks a false private event and preserves pending metadata', async () => {
    const f = swapApprovalFixture(), p = (await f.prepare())!; allowLocalTechnicalSubmission(); const sent = await f.cap.submitSharedSwapApproval(p);
    f.states[1].balance++;
    await expect(sent.recover()).rejects.toThrow('private balances'); expect(readCurrentDexPendingAttempt(f.storage)).toMatchObject({ verificationBlocked: true });
    await expect(f.cap.recoverPendingSharedSwapApproval()).rejects.toThrow('Known');
  });
  it('reconciles reload only as observed state, not original private accounting', async () => {
    const f = swapApprovalFixture(), p = (await f.prepare())!; allowLocalTechnicalSubmission(); await f.cap.submitSharedSwapApproval(p);
    const reloaded = createCurrentSharedDexTokenFundingAdapter(f.args);
    expect(await reloaded.recoverPendingSharedSwapApproval()).toMatchObject({ status: 'observed-mined', privateAccountingVerified: false });
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull(); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('proves an exact rollback on revert', async () => {
    const f = swapApprovalFixture(), p = (await f.prepare())!, before = f.states.map(t => ({ ...t })); f.receipt.status = 0;
    allowLocalTechnicalSubmission(); const sent = await f.cap.submitSharedSwapApproval(p);
    expect(await sent.recover()).toMatchObject({ fundingOutcome: 'reverted', privateAccountingVerified: true }); expect(f.states).toEqual(before);
  });
});

describe('prepared Pool exact token approvals', () => {
  it.each([false,true])('uses real engineering Pool approval scope, cleanup=%s',async cleanup=>{
    const engineering=getAddress('0x8b749251cf1f712d4e39fd048c53394af03e10be');
    const f=approvalFixture(0,0,cleanup,'cheap-history',engineering),before=f.states.map(token=>({...token}));
    const p=(await f.prepare())!,sent=await f.cap.submitSharedPoolApproval(p),result=await sent.recover();
    expect(localSubmissionAuthority.allowed).toBe(false);
    expect(result).toMatchObject({fundingOutcome:'verified',privateAccountingVerified:true});
    expect(f.states).toEqual(before.map((token,i)=>i===f.selectedIndex?{...token,allowance:cleanup?0n:f.amount}:token));
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  it.each(['brand','signer','phase','target','data','cap','candidate']as const)('holds changed engineering Pool approval %s at the shared sender',async fault=>{
    const engineering=getAddress('0x8b749251cf1f712d4e39fd048c53394af03e10be'),f=approvalFixture(0,0,false,'cheap-history',engineering);
    const p=(await f.prepare())!,c={...f.policy};
    const boundary=createCurrentAttemptBoundary({storage:f.storage,c,core:f.policy.core,owner:engineering,
      chainId:f.policy.chainId,transport:f.transport,attest:async()=>{},now:()=>f.head.timestamp,historical:false,bindTarget:true});
    vi.clearAllMocks();
    if(fault==='candidate')c.packageSha256='changed';
    const call={chainId:f.policy.chainId,from:engineering,to:fault==='target'?f.states.find(token=>token.address.toLowerCase()!==p.token.toLowerCase())!.address:p.token,
      value:0n as const,data:fault==='data'?'0x12345678':p.data};
    await expect(boundary.sendCurrent(fault==='phase'?'pool-preview':'token-approve',call,undefined,async()=>{},()=>{},undefined,
      fault==='cap'?5_000_001n:5_000_000n,undefined,undefined,undefined,undefined,undefined,undefined,undefined,
      {kind:'approval',prepared:fault==='brand'?{...p}:p,signer:fault==='signer'?{}:f.args.signer})).rejects.toThrow();
    expect(f.transport.readHead).not.toHaveBeenCalled();expect(f.transport.readNonce).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled();expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  it('rechecks engineering Pool identity after the final signing authorization yields',async()=>{
    const engineering=getAddress('0x8b749251cf1f712d4e39fd048c53394af03e10be'),f=approvalFixture(0,0,false,'cheap-history',engineering);
    const p=(await f.prepare())!,c={...f.policy};
    const boundary=createCurrentAttemptBoundary({storage:f.storage,c,core:f.policy.core,owner:engineering,
      chainId:f.policy.chainId,transport:f.transport,attest:async()=>{},now:()=>f.head.timestamp,historical:false,bindTarget:true});
    const call={chainId:f.policy.chainId,from:engineering,to:p.token,value:0n as const,data:p.data};
    await expect(boundary.sendCurrent('token-approve',call,undefined,async()=>{},()=>{},undefined,5_000_000n,
      undefined,async()=>{c.packageSha256='changed';},undefined,undefined,undefined,undefined,undefined,
      {kind:'approval',prepared:p,signer:f.args.signer})).rejects.toThrow('Pool App');
    expect(f.transport.send).not.toHaveBeenCalled();expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  const mappings = STAGED_PREPARED_DEX_CANDIDATE.pairs.flatMap((pair, pairIndex) =>
    ([0, 1] as const).map(canonicalIndex => ({ pairIndex, canonicalIndex, market: pair.marketId })));
  it.each(mappings)('consumes top-up funding for pair $pairIndex token $canonicalIndex with the same exact approval rules', async ({ pairIndex, canonicalIndex }) => {
    const f = approvalFixture(pairIndex, canonicalIndex), before = f.states.map(t => ({ ...t }));
    const topUp = Object.assign(f.funding, { positionId: 43n, ownerContext: hash });
    const prepared = (await f.cap.prepareSharedPoolApproval({ ...f.request, funding: topUp as unknown as CurrentPoolPreparedTopUpFunding }))!;
    const sent = await f.cap.submitSharedPoolApproval(prepared);
    await expect(sent.recover()).resolves.toMatchObject({ privateAccountingVerified: true, fundingOutcome: 'verified' });
    expect(f.states).toEqual(before.map((token, i) => i === f.selectedIndex ? { ...token, allowance: f.amount } : token));
    expect(f.funding.assertApprovalCurrent).toHaveBeenCalled(); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('keeps the real App hold for top-up approvals before review or encryption', async () => {
    const f = approvalFixture(), topUp = Object.assign(f.funding, { positionId: 43n, ownerContext: hash });
    const cap = createCurrentSharedDexTokenFundingAdapter({ ...f.args, assertApprovalAdmission: undefined });
    await expect(cap.prepareSharedPoolApproval({ ...f.request, funding: topUp as unknown as CurrentPoolPreparedTopUpFunding })).rejects.toThrow('held');
    for (const mock of [f.confirm, f.encrypt, f.readFunds, f.transport.readNonce, f.transport.estimateGas, f.transport.send]) expect(mock).not.toHaveBeenCalled();
  });
  it.each(mappings)('proves exact allowance in selected pair $pairIndex token $canonicalIndex', async ({ pairIndex, canonicalIndex }) => {
    const f = approvalFixture(pairIndex, canonicalIndex), before = f.states.map(t => ({ ...t })), p = (await f.prepare())!;
    expect(p).toMatchObject({ token: getAddress(f.request.funding.intent.poolTokens[canonicalIndex]), amount: f.amount, readyToSign: false });
    expect(f.encrypt).toHaveBeenCalledWith(f.amount, p.token, approvalAbi.getFunction('approve')!.selector);
    const sent = await f.cap.submitSharedPoolApproval(p);
    expect(await sent.recover()).toMatchObject({ fundingOutcome: 'verified', privateAccountingVerified: true });
    expect(f.states).toEqual(before.map((t, i) => i === f.selectedIndex ? { ...t, allowance: f.amount } : t));
    expect(f.decrypt).toHaveBeenCalledOnce(); expect(f.decrypt.mock.calls[0][0].ciphertextHigh).toBe(77n);
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalledTimes(2); expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  it.each([0, 1] as const)('proves zero cleanup for canonical token %s after stop', async index => {
    const f = approvalFixture(4, index, true), before = f.states.map(t => ({ ...t }));
    f.funding.assertApprovalCurrent.mockRejectedValue(new Error('Stopped'));
    const p = (await f.prepare())!, sent = await f.cap.submitSharedPoolApproval(p);
    expect(p.amount).toBe(0n); expect(await sent.recover()).toMatchObject({ fundingOutcome: 'verified', privateAccountingVerified: true });
    expect(f.funding.assertUnfundedCleanupCurrent).toHaveBeenCalled(); expect(f.funding.assertApprovalCurrent).not.toHaveBeenCalled();
    expect(f.states).toEqual(before.map((t, i) => i === f.selectedIndex ? { ...t, allowance: 0n } : t));
  });
  it('keeps actual App hold before review, encryption, funds, estimates or signing', async () => {
    const f = approvalFixture(), cap = createCurrentSharedDexTokenFundingAdapter({ ...f.args, assertApprovalAdmission: undefined });
    await expect(cap.prepareSharedPoolApproval(f.request)).rejects.toThrow('held');
    await expect(cap.submitSharedPoolApproval({} as never)).rejects.toThrow('held');
    for (const mock of [f.confirm, f.encrypt, f.readFunds, f.transport.readNonce, f.transport.estimateGas, f.transport.send]) expect(mock).not.toHaveBeenCalled();
  });
  it('cancels before encryption and creates no pending record', async () => {
    const f = approvalFixture(); f.confirm.mockResolvedValue(false);
    expect(await f.prepare()).toBeNull(); expect(f.encrypt).not.toHaveBeenCalled(); expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  it.each(['funding-copy', 'foreign-session', 'approval-copy', 'revoked', 'stopped', 'review-drift', 'submit-drift', 'review-block', 'expired'])('rejects stale or forged input: %s', async reason => {
    const f = approvalFixture();
    if (reason === 'funding-copy') f.request.funding = { ...f.request.funding };
    if (reason === 'foreign-session') fundingBrands.set(f.funding, {});
    if (reason === 'review-drift') f.confirm.mockImplementation(async () => { f.states[3].balance++; return true; });
    if (['funding-copy', 'foreign-session', 'review-drift'].includes(reason)) await expect(f.prepare()).rejects.toThrow();
    else {
      const p = (await f.prepare())!;
      if (reason === 'revoked') f.revoke();
      if (reason === 'stopped') f.funding.assertApprovalCurrent.mockRejectedValue(new Error('Stopped'));
      if (reason === 'submit-drift') f.states[3].quota--;
      if (reason === 'review-block') vi.mocked(f.transport.readBlockHash).mockResolvedValue(toBeHex(56n, 32));
      if (reason === 'expired') f.head.timestamp += 301n;
      await expect(f.cap.submitSharedPoolApproval(reason === 'approval-copy' ? { ...p } : p)).rejects.toThrow();
    }
    expect(f.transport.send).not.toHaveBeenCalled(); expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  it.each(['foreign-allowance', 'already-exact', 'insufficient', 'zero', 'negative', 'overflow'])('rejects invalid allowance request: %s', async reason => {
    const f = approvalFixture();
    if (reason === 'foreign-allowance') f.states[f.selectedIndex].allowance = 1n;
    if (reason === 'already-exact') f.states[f.selectedIndex].allowance = f.amount;
    if (reason === 'insufficient') f.states[f.selectedIndex].balance = f.amount - 1n;
    if (reason === 'zero') f.funding.amounts.used0 = 0n;
    if (reason === 'negative') f.funding.amounts.used0 = -1n;
    if (reason === 'overflow') f.funding.amounts.used0 = 1n << 256n;
    await expect(f.prepare()).rejects.toThrow(); expect(f.encrypt).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['estimate', 'headroom', 'zero-estimate', 'nonce', 'fee', 'reserve'])('stops failed fresh prerequisites: %s', async reason => {
    const f = approvalFixture(), p = (await f.prepare())!;
    if (reason === 'estimate') vi.mocked(f.transport.estimateGas).mockRejectedValue(new Error('Estimate unavailable'));
    if (reason === 'headroom') vi.mocked(f.transport.estimateGas).mockResolvedValue(3_200_001n);
    if (reason === 'zero-estimate') vi.mocked(f.transport.estimateGas).mockResolvedValue(0n);
    if (['nonce', 'fee', 'reserve'].includes(reason)) vi.mocked(f.transport.readNativeResources!).mockImplementation(async head => ({
      owner, chainId: policy.chainId, head, latestNonce: 3, pendingNonce: reason === 'nonce' ? 4 : 3, code: '0x',
      baseFeePerGas: reason === 'fee' ? 100_000_000n : 1n, gasPrice: 50_000_000n, balance: reason === 'reserve' ? 0n : 10n ** 18n }));
    await expect(f.cap.submitSharedPoolApproval(p)).rejects.toThrow(); expect(f.transport.send).not.toHaveBeenCalled(); expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  it('retains uncertainty without another wallet send', async () => {
    const f = approvalFixture(), p = (await f.prepare())!; f.unknown();
    await expect(f.cap.submitSharedPoolApproval(p)).rejects.toThrow('Unknown');
    expect(await f.cap.recoverPendingSharedPoolApproval()).toEqual({ core: f.policy.core, graph: f.policy.graph, packageSha256: f.policy.packageSha256, status: 'manual-reconciliation-required', privateAccountingVerified: false });
    await expect(f.cap.submitSharedPoolApproval(p)).rejects.toThrow('pending'); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each([1, 0])('reload reports observation only for receipt status %s', async status => {
    const f = approvalFixture(), p = (await f.prepare())!; f.receipt.status = status;
    await f.cap.submitSharedPoolApproval(p);
    expect(await createCurrentSharedDexTokenFundingAdapter(f.args).recoverPendingSharedPoolApproval()).toEqual({
      core: f.policy.core, graph: f.policy.graph, packageSha256: f.policy.packageSha256,
      status: status ? 'observed-mined' : 'observed-reverted', privateAccountingVerified: false });
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull(); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('keeps temporary absence pending and then proves the same transaction', async () => {
    const f = approvalFixture(), p = (await f.prepare())!, sent = await f.cap.submitSharedPoolApproval(p);
    vi.mocked(f.transport.readTransaction).mockResolvedValueOnce(null);
    await expect(sent.recover()).rejects.toThrow(); expect(readCurrentDexPendingAttempt(f.storage)?.verificationBlocked).not.toBe(true);
    await expect(f.cap.submitSharedPoolApproval(p)).rejects.toThrow('pending');
    expect(await sent.recover()).toMatchObject({ privateAccountingVerified: true }); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('proves complete rollback for a revert', async () => {
    const f = approvalFixture(), before = f.states.map(t => ({ ...t })), p = (await f.prepare())!; f.receipt.status = 0;
    const sent = await f.cap.submitSharedPoolApproval(p);
    expect(await sent.recover()).toMatchObject({ fundingOutcome: 'reverted', privateAccountingVerified: true }); expect(f.states).toEqual(before);
  });
  it.each(['balance0', 'balance1', 'balance2', 'balance3', 'other-allowance', 'quota', 'claimed', 'cooldown', 'amount-policy', 'recipient',
    'allowance', 'missing-event', 'extra-event', 'event-token', 'event-owner', 'event-spender', 'owner-envelope', 'event-amount', 'event-padding',
    'gas', 'mined-hash', 'canonical', 'receipt-drift', 'revert-state', 'revert-log'])('blocks proof defect across reload: %s', async reason => {
    const f = approvalFixture(), p = (await f.prepare())!;
    if (reason.startsWith('revert-')) f.receipt.status = 0;
    const sent = await f.cap.submitSharedPoolApproval(p), other = (f.selectedIndex + 1) % 4;
    if (reason.startsWith('balance')) f.states[Number(reason.slice(-1))].balance++;
    if (reason === 'other-allowance') f.states[other].allowance++;
    if (reason === 'quota') f.states[other].quota--;
    if (reason === 'claimed') f.states[other].claimed = true;
    if (reason === 'cooldown') f.states[other].nextClaimAt++;
    if (reason === 'amount-policy') f.states[other].refillAmount++;
    if (reason === 'recipient') f.states[other].encryptionAddress = owner;
    if (reason === 'allowance' || reason === 'revert-state') f.states[f.selectedIndex].allowance++;
    if (reason === 'missing-event') f.receipt.logs = [];
    if (reason === 'extra-event') f.receipt.logs.push(f.receipt.logs[0]);
    if (reason === 'event-token') f.receipt.logs[0].address = f.states[other].address;
    if (['event-owner', 'event-spender', 'owner-envelope', 'event-amount', 'revert-log'].includes(reason)) f.receipt.logs = [{ address: p.token,
      ...approvalAbi.encodeEventLog(approvalAbi.getEvent('Approval')!, [reason === 'event-owner' ? zero : owner,
        reason === 'event-spender' ? owner : policy.core, [reason === 'owner-envelope' ? 99n : 77n, reason === 'event-amount' ? f.amount + 1n : f.amount], [99n, f.amount]]) }];
    if (reason === 'event-padding') f.receipt.logs[0].data += '00'.repeat(32);
    if (reason === 'gas') f.txs.value = { ...f.txs.value!, gasLimit: 6_000_000n };
    if (reason === 'mined-hash') f.txs.value = { ...f.txs.value!, hash: toBeHex(67n, 32) };
    if (reason === 'canonical') vi.mocked(f.transport.verifyCanonicalInclusion!).mockRejectedValue(new Error('Current DEX canonical transaction inclusion changed. Do not resend.'));
    if (reason === 'receipt-drift') vi.mocked(f.transport.verifyCanonicalInclusion!).mockImplementationOnce(async () => { f.receipt.status = 0; });
    await expect(sent.recover()).rejects.toThrow(); expect(readCurrentDexPendingAttempt(f.storage)?.verificationBlocked).toBe(true);
    await expect(createCurrentSharedDexTokenFundingAdapter(f.args).recoverPendingSharedPoolApproval()).rejects.toThrow('Known'); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('stores only public target-bound pending metadata', async () => {
    const f = approvalFixture(), p = (await f.prepare())!; await f.cap.submitSharedPoolApproval(p);
    const record = JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!);
    expect(Object.keys(record).sort()).toEqual(['version', 'chainId', 'owner', 'core', 'graph', 'phase', 'callHash', 'nonce', 'txHash', 'target'].sort());
    expect(record).toMatchObject({ phase: 'token-approve', target: p.token.toLowerCase() });
  });
});

describe('four-token beta funding', () => {
  it('retires only the diagnosed SDK flag after full canonical and private receipt credit, without asserting historical delta', async () => {
    const claimHash = '0xf3593926823ab7f1f49d4a0a565352fc8d3044d1739c945091f42f39a38c2350';
    const f = fixture('cheap-exit', getAddress('0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d'), claimHash);
    f.head.number = 10044433n; f.head.hash = '0x7a530c54117b72345d9746c533dd2e09530dda8855106b68b062733b35bef41d';
    f.receipt.blockNumber = Number(f.head.number); f.receipt.blockHash = f.head.hash;
    vi.mocked(f.transport.readBlockHash).mockImplementation(async () => f.receipt.blockHash);
    const send = vi.mocked(f.transport.send).getMockImplementation()!;
    vi.mocked(f.transport.send).mockImplementation(async request => { const sent = await send(request);
      f.txs.value = { ...f.txs.value!, blockHash: f.receipt.blockHash }; return sent; });
    vi.mocked(f.transport.readNonce).mockResolvedValue(137);
    vi.mocked(f.transport.readNativeResources!).mockImplementation(async head => ({ owner: f.args.ownerAddress, chainId: f.policy.chainId,
      head, latestNonce: 137, pendingNonce: 137, baseFeePerGas: 1n, gasPrice: 50_000_000n, code: '0x', balance: 10n ** 18n }));
    const p = (await f.prepare('initial', 1))!; allowLocalTechnicalSubmission();
    const sent = await f.cap.submitSharedTokenFunding(p);
    vi.mocked(f.transport.verifyCanonicalInclusion!).mockRejectedValueOnce(new Error('Current DEX canonical transaction inclusion changed. Do not resend.'));
    await expect(sent.recover()).rejects.toThrow('inclusion changed');
    const mined = { ...f.head }, read = f.readFunds.getMockImplementation()!;
    f.head.number += 1000n; f.head.timestamp += 1000n; f.args.readReceiptBlock = async number => ({ ...mined, number: BigInt(number) });
    f.readFunds.mockImplementation(async head => { if (head.number < f.head.number) throw new Error('missing trie node'); return read(head); });
    const result = await createCurrentSharedDexTokenFundingAdapter(f.args).recoverPendingSharedTokenFunding(claimHash);
    expect(result).toMatchObject({ status: 'observed-mined', privateCreditVerified: true, privateAccountingVerified: false });
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull(); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('retries the same failed claim proof with its original private snapshot and no resend', async () => {
    const f = fixture(), p = (await f.prepare())!;
    allowLocalTechnicalSubmission(); const sent = await f.cap.submitSharedTokenFunding(p);
    vi.mocked(f.transport.verifyCanonicalInclusion!).mockRejectedValueOnce(new Error('Current DEX canonical transaction inclusion changed. Do not resend.'));
    await expect(sent.recover()).rejects.toThrow('inclusion changed');
    expect(readCurrentDexPendingAttempt(f.storage)?.verificationBlocked).toBe(true);
    expect(await sent.recover()).toMatchObject({ fundingOutcome: 'verified', privateAccountingVerified: true });
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull(); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('keeps a repeated private-credit mismatch locked under the original snapshot', async () => {
    const f = fixture(), p = (await f.prepare())!;
    allowLocalTechnicalSubmission(); const sent = await f.cap.submitSharedTokenFunding(p); f.states[0].balance++;
    await expect(sent.recover()).rejects.toThrow('accounting');
    const pending = f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY);
    await expect(sent.recover()).rejects.toThrow('accounting');
    expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(pending);
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['exact', 'wrong-credit', 'unavailable-history', 'pruned-history', 'pruned-rpc-history'] as const)('rechecks a blocked known claim with full historical accounting: %s', async mode => {
    const f = fixture(), before = await f.readFunds(f.head), p = (await f.prepare())!;
    allowLocalTechnicalSubmission(); const sent = await f.cap.submitSharedTokenFunding(p);
    vi.mocked(f.transport.verifyCanonicalInclusion!).mockRejectedValueOnce(new Error('Current DEX canonical transaction inclusion changed. Do not resend.'));
    await expect(sent.recover()).rejects.toThrow('inclusion changed');
    const saved = f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY);
    const read = f.readFunds.getMockImplementation()!;
    f.args.readReceiptBlock = async number => ({ ...f.head, number: BigInt(number), timestamp: f.head.timestamp - (number < f.receipt.blockNumber ? 1n : 0n) });
    f.readFunds.mockImplementation(async head => {
      if (head.number < f.head.number) {
        if (mode === 'unavailable-history') throw new Error('Historical private state unavailable');
        if (mode === 'pruned-history') throw new Error('missing trie node; historical state unavailable');
        if (mode === 'pruned-rpc-history') throw Object.assign(new Error('missing revert data'), { info: { error: { message: 'missing trie node; historical state unavailable' } } });
        return { ...before, head };
      }
      return read(head);
    });
    if (mode === 'wrong-credit') f.states[0].balance++;
    const reloaded = createCurrentSharedDexTokenFundingAdapter(f.args);
    await expect(reloaded.recoverPendingSharedTokenFunding()).rejects.toThrow('Known');
    if (mode === 'exact') {
      expect(await reloaded.recoverPendingSharedTokenFunding(txHash)).toMatchObject({ status: 'observed-mined', privateAccountingVerified: true });
      expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
    } else if (mode === 'pruned-history' || mode === 'pruned-rpc-history') {
      expect(await reloaded.recoverPendingSharedTokenFunding(txHash)).toMatchObject({ status: 'observed-mined',
        privateCreditVerified: true, privateAccountingVerified: false, verificationBlocked: true });
      expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(saved);
    } else {
      await expect(reloaded.recoverPendingSharedTokenFunding(txHash)).rejects.toThrow();
      expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(saved);
    }
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['cheap-prepared', 'cheap-exit'] as const)('%s reviews fresh owner resources, nonce and estimate for initial claims and refills', async candidate => {
    for (const action of ['initial', 'refill'] as const) {
      const f = fixture(candidate);
      if (action === 'refill') f.states.forEach(t => { t.claimed = true; });
      let reviewed: unknown;
      const confirm = vi.fn(async (review: unknown) => { reviewed = review; return true; });
      const p = await f.cap.prepareSharedTokenFunding({ action, token: f.states[0].address, confirm });
      expect(p).not.toBeNull();
      expect(reviewed).toMatchObject({ action, token: f.states[0].address, decimals: 6, gasEstimate: 800_000n,
        gasPrice: candidate==='cheap-exit'?52_000_000n:50_000_000n, gasLimit: 5_000_000n });
      expect(vi.mocked(f.transport.readNativeResources!)).toHaveBeenCalled();
      expect(vi.mocked(f.transport.readNonce)).toHaveBeenCalled();
      expect(vi.mocked(f.transport.estimateGas)).toHaveBeenCalledWith(expect.objectContaining({
        from: owner, to: p!.to, data: p!.data, value: 0n, nonce: 3, gasPrice: candidate==='cheap-exit'?52_000_000n:50_000_000n
      }));
      expect(vi.mocked(f.transport.readNativeResources!).mock.invocationCallOrder[0]).toBeLessThan(confirm.mock.invocationCallOrder[0]);
      expect(vi.mocked(f.transport.readNonce).mock.invocationCallOrder[0]).toBeLessThan(confirm.mock.invocationCallOrder[0]);
      expect(vi.mocked(f.transport.estimateGas).mock.invocationCallOrder[0]).toBeLessThan(confirm.mock.invocationCallOrder[0]);
      expect(Object.isFrozen(reviewed)).toBe(true);
    }
  });
  it.each(['estimate', 'headroom', 'nonce', 'fee', 'reserve'] as const)('does not show a claim review when initial resources fail: %s', async reason => {
    const f = fixture(), confirm = vi.fn(async () => true);
    if (reason === 'estimate') vi.mocked(f.transport.estimateGas).mockRejectedValue(new Error('RPC estimate failed'));
    if (reason === 'headroom') vi.mocked(f.transport.estimateGas).mockResolvedValue(3_200_001n);
    if (reason === 'nonce' || reason === 'fee' || reason === 'reserve') vi.mocked(f.transport.readNativeResources!).mockImplementation(async h => ({
      owner, chainId: f.policy.chainId, head: h, latestNonce: 3, pendingNonce: reason === 'nonce' ? 4 : 3, code: '0x',
      baseFeePerGas: reason === 'fee' ? 100_000_000n : 1n, gasPrice: 50_000_000n, balance: reason === 'reserve' ? 0n : 10n ** 18n }));
    await expect(f.cap.prepareSharedTokenFunding({ action: 'initial', token: f.states[0].address, confirm })).rejects.toThrow();
    expect(confirm).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  it('cancels review without a pending attempt and cannot submit the captured review', async () => {
    const f = fixture(); let review: unknown;
    expect(await f.cap.prepareSharedTokenFunding({ action: 'initial', token: f.states[0].address,
      confirm: async value => { review = value; return false; } })).toBeNull();
    await expect(f.cap.submitSharedTokenFunding(review as never)).rejects.toThrow('preparation');
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['session', 'eligibility', 'resources', 'estimate'] as const)('stops a changed %s after the owner reviews the claim', async change => {
    const f = fixture();
    const confirm = vi.fn(async () => {
      if (change === 'session') f.revoke();
      if (change === 'eligibility') f.states[0].claimed = true;
      if (change === 'resources') vi.mocked(f.transport.readNativeResources!).mockImplementation(async h => ({
        owner, chainId: f.policy.chainId, head: h, latestNonce: 3, pendingNonce: 4, code: '0x', baseFeePerGas: 1n, gasPrice: 50_000_000n, balance: 10n ** 18n }));
      if (change === 'estimate') vi.mocked(f.transport.estimateGas).mockResolvedValue(3_200_001n);
      return true;
    });
    await expect(f.cap.prepareSharedTokenFunding({ action: 'initial', token: f.states[0].address, confirm })).rejects.toThrow();
    expect(confirm).toHaveBeenCalledOnce(); expect(f.transport.send).not.toHaveBeenCalled();
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  it.each([0, 1, 2, 3])('proves initial private credit and leaves all allowances/other funds unchanged: token%s', async index => {
    const f = fixture(), p = (await f.prepare('initial', index))!, sent = await f.cap.submitSharedTokenFunding(p);
    expect(readCurrentDexPendingAttempt(f.storage)?.target).toBe(p.to.toLowerCase());
    expect(await sent.recover()).toMatchObject({ fundingOutcome: 'verified', privateAccountingVerified: true });
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalledTimes(2);
    expect(f.states[index].balance).toBe(7n + policy.initialAmount); expect(f.states[index].allowance).toBe(3n);
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull(); expect(p.readyToSign).toBe(false);
    expect([...f.values.values()].join('')).not.toContain('balance');
  });
  it.each([0, 1, 2, 3])('proves refill private credit/quota/cooldown for token%s', async index => {
    const f = fixture(); f.states.forEach(t => { t.claimed = true; });
    const p = (await f.prepare('refill', index))!, sent = await f.cap.submitSharedTokenFunding(p);
    expect(await sent.recover()).toMatchObject({ fundingOutcome: 'verified', privateAccountingVerified: true });
    expect(f.states[index].balance).toBe(7n + policy.refillAmount); expect(f.states[index].quota).toBe(policy.initialQuota - policy.refillAmount);
    expect(f.states[index].nextClaimAt).toBe(f.head.timestamp + policy.cooldown);
  });
  it('holds real App authority before reading a nonce, estimating or sending', async () => {
    const f = fixture(), cap = createCurrentSharedDexTokenFundingAdapter({ ...f.args, assertAdmission: assertCurrentSharedTokenFundingAppAuthority });
    await expect(cap.prepareSharedTokenFunding({ action: 'initial', token: f.states[0].address, confirm: async () => true })).rejects.toThrow('held');
    await expect(cap.submitSharedTokenFunding({ action: 'initial', token: f.states[0].address } as never)).rejects.toThrow('held');
    expect(f.transport.readNonce).not.toHaveBeenCalled(); expect(f.transport.estimateGas).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('rejects forged preparations and unreviewed assets', async () => {
    const f = fixture(), p = (await f.prepare())!;
    await expect(f.cap.submitSharedTokenFunding({ ...p })).rejects.toThrow('preparation');
    await expect(f.cap.prepareSharedTokenFunding({ action: 'initial', token: owner, confirm: async () => true })).rejects.toThrow('Not a beta');
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('rejects a session change during review', async () => {
    const f = fixture();
    await expect(f.cap.prepareSharedTokenFunding({ action: 'initial', token: f.states[0].address, confirm: async () => { f.revoke(); return true; } })).rejects.toThrow('Session');
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['claimed', 'cooldown', 'exhausted', 'expired'])('rejects unavailable refill: %s', async reason => {
    const f = fixture(); f.states[0].claimed = reason !== 'claimed';
    if (reason === 'cooldown') f.states[0].nextClaimAt = f.head.timestamp + 1n;
    if (reason === 'exhausted') f.states[0].quota = 0n;
    if (reason === 'expired') f.head.timestamp = policy.vault.expiresAt;
    await expect(f.prepare('refill')).rejects.toThrow('not available'); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('retains a hashless lock after an unknown wallet result; never resends', async () => {
    const f = fixture(), p = (await f.prepare())!; f.unknown();
    await expect(f.cap.submitSharedTokenFunding(p)).rejects.toThrow('Unknown');
    expect(readCurrentDexPendingAttempt(f.storage)).toMatchObject({ txHash: null, target: p.to.toLowerCase() });
    expect(await f.cap.recoverPendingSharedTokenFunding()).toEqual({ core: f.policy.core, graph: f.policy.graph, packageSha256: f.policy.packageSha256, status: 'manual-reconciliation-required', privateAccountingVerified: false });
    await expect(f.cap.submitSharedTokenFunding(p)).rejects.toThrow('pending'); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('keeps current history funding locked after an unknown send across reload; never resends', async () => {
    const engineering = getAddress('0x8b749251cf1f712d4e39fd048c53394af03e10be'), f = fixture('cheap-history', engineering);
    const p = (await f.prepare('initial', 2))!; f.unknown();
    await expect(f.cap.submitSharedTokenFunding(p)).rejects.toThrow('Unknown wallet result');
    expect(readCurrentDexPendingAttempt(f.storage)).toMatchObject({ phase: 'token-faucet', txHash: null, target: p.to.toLowerCase() });
    const reload = createCurrentSharedDexTokenFundingAdapter(f.args);
    expect(await reload.recoverPendingSharedTokenFunding()).toMatchObject({ status: 'manual-reconciliation-required', privateAccountingVerified: false });
    await expect(reload.submitSharedTokenFunding(p)).rejects.toThrow('pending');
    expect(f.transport.send).toHaveBeenCalledOnce();
    expect(readCurrentDexPendingAttempt(f.storage)).toMatchObject({ phase: 'token-faucet', txHash: null, target: p.to.toLowerCase() });
  });
  it.each(['cheap-prepared', 'cheap-exit'] as const)('keeps a rejected wallet request locked until reconciliation: %s', async candidate => {
    allowLocalTechnicalSubmission();
    const f = fixture(candidate), p = (await f.prepare())!;
    vi.mocked(f.transport.send).mockRejectedValueOnce(Object.assign(new Error('Wallet request rejected'), { code: 4001 }));
    await expect(f.cap.submitSharedTokenFunding(p)).rejects.toThrow('Wallet request rejected');
    expect(readCurrentDexPendingAttempt(f.storage)).toMatchObject({ txHash: null, core: f.policy.core.toLowerCase(), target: p.to.toLowerCase() });
    const reload = createCurrentSharedDexTokenFundingAdapter(f.args);
    expect(await reload.recoverPendingSharedTokenFunding()).toMatchObject({ status: 'manual-reconciliation-required', privateAccountingVerified: false });
    await expect(reload.submitSharedTokenFunding(p)).rejects.toThrow();
    expect(f.transport.send).toHaveBeenCalledOnce();
    expect(readCurrentDexPendingAttempt(f.storage)?.txHash).toBeNull();
  });
  it('reconciles a reload without claiming historical private-delta proof', async () => {
    const f = fixture(), p = (await f.prepare())!; await f.cap.submitSharedTokenFunding(p);
    const reload = createCurrentSharedDexTokenFundingAdapter(f.args);
    expect(await reload.recoverPendingSharedTokenFunding()).toEqual({ core: f.policy.core, graph: f.policy.graph, packageSha256: f.policy.packageSha256, status: 'observed-mined', privateAccountingVerified: false, privateCreditVerified: true });
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull(); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('recovers a normal known claim after historical state is pruned, with receipt credit and current funds kept separate', async () => {
    const f = fixture(), p = (await f.prepare())!; await f.cap.submitSharedTokenFunding(p);
    const mined = { ...f.head }, read = f.readFunds.getMockImplementation()!;
    f.head.number += 1000n; f.head.timestamp += 1000n;
    f.args.readReceiptBlock = async () => mined;
    f.readFunds.mockImplementation(async head => {
      if (head.number === mined.number) throw new Error('missing trie node');
      return read(head);
    });
    const result = await createCurrentSharedDexTokenFundingAdapter(f.args).recoverPendingSharedTokenFunding();
    expect(result).toMatchObject({ status: 'observed-mined', privateCreditVerified: true, privateAccountingVerified: false });
    expect(f.decrypt).toHaveBeenCalled(); expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('keeps a temporarily missing mined transaction pending and proves the same send when it becomes available', async () => {
    const f = fixture(), p = (await f.prepare())!, sent = await f.cap.submitSharedTokenFunding(p);
    vi.mocked(f.transport.readTransaction).mockResolvedValueOnce(f.txs.value).mockResolvedValueOnce(null);
    await expect(sent.recover()).rejects.toThrow('transaction is unavailable');
    expect(readCurrentDexPendingAttempt(f.storage)).toMatchObject({ txHash, target: p.to.toLowerCase() });
    expect(readCurrentDexPendingAttempt(f.storage)?.verificationBlocked).not.toBe(true);
    await expect(f.cap.submitSharedTokenFunding(p)).rejects.toThrow('pending');
    expect(await sent.recover()).toMatchObject({ fundingOutcome: 'verified', privateAccountingVerified: true });
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull(); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('blocks a changed mined transaction hash and does not treat it as temporary absence', async () => {
    const f = fixture(), p = (await f.prepare())!, sent = await f.cap.submitSharedTokenFunding(p);
    vi.mocked(f.transport.readTransaction).mockResolvedValueOnce(f.txs.value).mockResolvedValueOnce({ ...f.txs.value!, hash: toBeHex(67n, 32) });
    await expect(sent.recover()).rejects.toThrow('mined transaction changed');
    expect(readCurrentDexPendingAttempt(f.storage)?.verificationBlocked).toBe(true);
    await expect(createCurrentSharedDexTokenFundingAdapter(f.args).recoverPendingSharedTokenFunding()).rejects.toThrow('Known');
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('does not accept another token with the same claimFaucet calldata after reload', async () => {
    const f = fixture(), p = (await f.prepare())!; await f.cap.submitSharedTokenFunding(p);
    f.txs.value = { ...f.txs.value!, to: f.states[1].address };
    await expect(f.cap.recoverPendingSharedTokenFunding()).rejects.toThrow('target or calldata');
    expect(readCurrentDexPendingAttempt(f.storage)?.verificationBlocked).toBe(true);
  });
  it.each(['estimate', 'headroom', 'nonce', 'fee', 'reserve'])('stops invalid send prerequisites before signing: %s', async reason => {
    const f = fixture(), p = (await f.prepare())!;
    if (reason === 'estimate') vi.mocked(f.transport.estimateGas).mockRejectedValue(new Error('RPC estimate failed'));
    if (reason === 'headroom') vi.mocked(f.transport.estimateGas).mockResolvedValue(4_000_000n);
    if (reason === 'nonce' || reason === 'fee' || reason === 'reserve') vi.mocked(f.transport.readNativeResources!).mockImplementation(async h => ({
      owner, chainId: policy.chainId, head: h, latestNonce: 3, pendingNonce: reason === 'nonce' ? 4 : 3, code: '0x',
      baseFeePerGas: reason === 'fee' ? 100_000_000n : 1n, gasPrice: 50_000_000n, balance: reason === 'reserve' ? 0n : 10n ** 18n }));
    await expect(f.cap.submitSharedTokenFunding(p)).rejects.toThrow();
    expect(f.transport.send).not.toHaveBeenCalled(); expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  it('proves reverted funding without a private credit', async () => {
    const f = fixture(), p = (await f.prepare())!; f.receipt.status = 0;
    const sent = await f.cap.submitSharedTokenFunding(p);
    expect(await sent.recover()).toMatchObject({ fundingOutcome: 'reverted', privateAccountingVerified: true }); expect(f.states[0].balance).toBe(7n);
  });
  it.each(['balance', 'allowance', 'other', 'event', 'gas'])('keeps a known proof failure blocked across reload: %s', async reason => {
    const f = fixture(), p = (await f.prepare())!, sent = await f.cap.submitSharedTokenFunding(p);
    if (reason === 'balance') f.states[0].balance--;
    if (reason === 'allowance') f.states[0].allowance++;
    if (reason === 'other') f.states[1].balance++;
    if (reason === 'event') f.receipt.logs.pop();
    if (reason === 'gas') f.txs.value = { ...f.txs.value!, gasLimit: 6_000_000n };
    await expect(sent.recover()).rejects.toThrow(); expect(readCurrentDexPendingAttempt(f.storage)?.verificationBlocked).toBe(true);
    await expect(createCurrentSharedDexTokenFundingAdapter(f.args).recoverPendingSharedTokenFunding()).rejects.toThrow('Known');
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('stores only one public target-bound record, without private amounts or ciphertext', async () => {
    const f = fixture(), p = (await f.prepare())!; await f.cap.submitSharedTokenFunding(p);
    expect([...f.values.keys()]).toEqual([CURRENT_DEX_PENDING_ATTEMPT_KEY]);
    const record = JSON.parse(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!);
    expect(Object.keys(record).sort()).toEqual(['version', 'chainId', 'owner', 'core', 'graph', 'phase', 'callHash', 'nonce', 'txHash', 'target'].sort());
  });
});
