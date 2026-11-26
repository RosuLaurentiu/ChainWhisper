import { MAX_TOKEN_ALLOWANCE } from './tokenAllowance';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { getAddress, keccak256, toBeHex } from '@coti-io/coti-ethers';
import { createCurrentSharedDexTokenFundingAdapter, assertCurrentSharedTokenFundingAppAuthority, currentSharedTokenFundingAbi as abi,
  assertCurrentSharedPoolApprovalPrepared, type CurrentSharedTokenFundingAction } from './currentSharedDexTokenFunding';
import { CURRENT_SHARED_TOKEN_DISTRIBUTION as policy, CURRENT_SHARED_DEX_TOKENS, resolveCurrentSharedTokenDistribution } from './currentSharedDexTokenDistribution';
import { readCurrentDexPendingAttempt, reserveCurrentDexPendingAttempt, CURRENT_DEX_PENDING_ATTEMPT_KEY, CURRENT_DEX_OPERATION_LOOKUPS_KEY, currentDexScopedRecordKey } from './currentDexPendingAttempt';
import { currentTokenFundingAbi as approvalAbi } from './currentDexTokenFunding';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from './dexV2Deployment';
import { wasCurrentDexUnsentReleased } from './currentDexSendBoundary';
import { createCurrentAttemptBoundary } from './currentDexSendBoundary';
import { currentDexNormalUseReloadKey } from './currentDexNativeReload';
import type { CurrentPoolPreparedFunding, CurrentPoolPreparedTopUpFunding } from '../features/wallet/currentDexPoolFundingCapability';
import type { CurrentLimitFundingReview } from '../features/wallet/currentDexLimitCapability';

const fundingBrands = vi.hoisted(() => new WeakMap<object, object>());
const limitBrands = vi.hoisted(() => new WeakMap<object, object>());
// CW-086: only a registered signer has the browser wallet context. Every other signer keeps the engineering path.
const browserContexts = vi.hoisted(() => new WeakMap<object, { owner: string }>());
vi.mock('../features/wallet/ownerCotiMetaMaskCapability', () => ({
  hasCurrentDexBrowserSigner: (signer: object | undefined, owner: string) =>
    !!signer && browserContexts.get(signer)?.owner === owner.toLowerCase()
}));
vi.mock('../features/wallet/currentDexLimitCapability', () => ({
  assertCurrentLimitPrepared: (value: object, signer: object) => {
    if (limitBrands.get(value) !== signer) throw new Error('Limit was not prepared in this owner session.');
  }
}));
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
// The approved current App owner. `unrelated` has no current App admission.
const owner = getAddress('0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d'), unrelated = getAddress(`0x${'11'.repeat(20)}`), hash = toBeHex(55n, 32), txHash = toBeHex(66n, 32), zero = `0x${'00'.repeat(20)}`;
function fixture(candidate: Args['candidate'] = 'cheap-history', selectedOwner = owner, submittedHash = txHash) {
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

describe('selected current candidate funding identity', () => {
  it('uses one funding observation per head read and reads again on the next check', async () => {
    const f = fixture('cheap-history');
    const first = await f.cap.readSharedTokenFunding();
    expect(f.readFunds).toHaveBeenCalledTimes(1);
    expect(first.tokens[0].balance).toBe(7n);
    f.states[0].balance = 9n;
    const second = await f.cap.readSharedTokenFunding();
    expect(f.readFunds).toHaveBeenCalledTimes(2);
    expect(second.tokens[0].balance).toBe(9n);
    f.revoke();
    await expect(f.cap.readSharedTokenFunding()).rejects.toThrow('Session changed');
    expect(f.readFunds).toHaveBeenCalledTimes(2);
    expect(f.transport.send).not.toHaveBeenCalled();
  });
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
    for (const selected of [unrelated, '0xab5374daddea783c3e58de19db497b54c79fd4cc']) {
      for (const action of ['initial', 'refill']) expect(() => assertCurrentSharedTokenFundingAppAuthority({
        candidate: 'cheap-history', owner: selected, token: CURRENT_SHARED_DEX_TOKENS[0].address, action })).toThrow('held');
    }
  });
  it.each(['initial', 'refill'] as const)('binds %s review, pending and private result to the current Core', async action => {
    const f = fixture('cheap-history'); if (action === 'refill') f.states[0].claimed = true;
    const p = (await f.prepare(action))!;
    expect(p).toMatchObject({ core: f.policy.core, graph: f.policy.graph, packageSha256: f.policy.packageSha256, readyToSign: false });
    allowLocalTechnicalSubmission();
    const sent = await f.cap.submitSharedTokenFunding(p);
    expect(readCurrentDexPendingAttempt(f.storage)).toMatchObject({ core: f.policy.core.toLowerCase(), graph: `0x${f.policy.graph}` });
    expect(await sent.recover()).toMatchObject({ core: f.policy.core, graph: f.policy.graph, packageSha256: f.policy.packageSha256,
      fundingOutcome: 'verified', privateAccountingVerified: true, funds: { core: f.policy.core } });
    expect(f.decrypt.mock.calls.every(([cipher]) => cipher.ciphertextHigh === 77n)).toBe(true);
  });
  it.each(['core', 'graph', 'packageSha256', 'privateFundsVerified', 'allowance'] as const)('rejects wrong %s in current private funds', async field => {
    const f = fixture('cheap-history'), original = await f.args.readFunds(f.head);
    f.readFunds.mockImplementation(async head => {
      const funds = { ...original, head };
      if (field === 'allowance') return { ...funds, tokens: funds.tokens.map((t, i) => i === 0 ? { ...t, allowance: -1n } : t) };
      return { ...funds, [field]: field === 'privateFundsVerified' ? false : policy[field] } as Awaited<ReturnType<Args['readFunds']>>;
    });
    await expect(f.prepare()).rejects.toThrow('identity or state changed'); expect(f.transport.send).not.toHaveBeenCalled();
  });
});

function approvalFixture(pairIndex = 0, canonicalIndex: 0 | 1 = 0, cleanup = false, candidate: Args['candidate'] = 'cheap-history',selectedOwner=owner) {
  const owner=selectedOwner;
  const f = fixture(candidate,owner), policy = f.policy;
  const pair = resolvePreparedDexScope(candidate??'cheap-history').candidate.pairs[pairIndex];
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
      const call = approvalAbi.parseTransaction({data:request.data})!;
      const input = call.args[1];
      const approved = BigInt(input.ciphertext.ciphertextLow) + (call.name === 'increaseAllowance' ? f.states[selectedIndex].allowance : 0n);
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

describe('existing exact Pool allowances', () => {
  it.each([0, 2, 5])('reads both canonical tokens for pair %s without preparing or sending an approval', async pairIndex => {
    const f = approvalFixture(pairIndex);
    const indices = f.funding.intent.poolTokens.map(address => f.states.findIndex(t => t.address.toLowerCase() === address.toLowerCase()));
    f.states[indices[0]].allowance = 11n;
    expect(await f.cap.readSharedPoolAllowances(f.request.funding)).toEqual([true, false]);
    f.states[indices[1]].allowance = 13n;
    expect(await f.cap.readSharedPoolAllowances(f.request.funding)).toEqual([true, true]);
    f.states[indices[0]].allowance = 12n;
    expect(await f.cap.readSharedPoolAllowances(f.request.funding)).toEqual([true, true]);
    f.states[indices[1]].balance = 12n;
    expect(await f.cap.readSharedPoolAllowances(f.request.funding)).toEqual([true, false]);
    for (const fn of [f.confirm, f.encrypt, f.transport.estimateGas, f.transport.send]) expect(fn).not.toHaveBeenCalled();
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  it.each(['copy', 'session', 'pending', 'stopped', 'identity', 'amount'] as const)('rejects changed %s before an allowance result', async reason => {
    const f = approvalFixture(); let funding = f.request.funding;
    if (reason === 'copy') funding = { ...funding };
    if (reason === 'session') f.revoke();
    if (reason === 'pending') f.storage.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY, 'unreconciled');
    if (reason === 'stopped') f.funding.assertApprovalCurrent.mockRejectedValue(new Error('Stopped'));
    if (reason === 'identity') f.funding.intent.marketId = hash;
    if (reason === 'amount') f.funding.amounts.used0 = 0n;
    await expect(f.cap.readSharedPoolAllowances(funding)).rejects.toThrow();
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('reuses the same exact check for branded top-up funding', async () => {
    const f = approvalFixture(), topUp = Object.assign(f.funding, { positionId: 43n, ownerContext: hash });
    f.states[f.selectedIndex].allowance = f.amount;
    expect(await f.cap.readSharedPoolAllowances(topUp as unknown as CurrentPoolPreparedTopUpFunding)).toEqual([true, false]);
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('holds when another pending action appears during the private read', async () => {
    const f = approvalFixture(), read = f.readFunds.getMockImplementation()!;
    f.readFunds.mockImplementation(async head => {
      const result = await read(head); f.storage.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY, 'unreconciled'); return result;
    });
    await expect(f.cap.readSharedPoolAllowances(f.request.funding)).rejects.toThrow();
    expect(f.storage.getItem(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe('unreconciled');
    expect(f.transport.send).not.toHaveBeenCalled();
  });
});

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
  it('holds cleanup for another owner', async () => {
    const f = approvalFixture(0, 0, true, 'cheap-history', unrelated);
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

describe('current candidate exact Pool approvals', () => {
  const cases = STAGED_SHARED_HISTORY_DEX_CANDIDATE.pairs.flatMap((_, pairIndex) =>
    ([0, 1] as const).map(canonicalIndex => ({ pairIndex, canonicalIndex })));
  it.each(cases)('proves current-Core approval for pair $pairIndex token $canonicalIndex', async ({ pairIndex, canonicalIndex }) => {
    const f = approvalFixture(pairIndex, canonicalIndex, false, 'cheap-history'), before = f.states.map(t => ({ ...t }));
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
    const f = approvalFixture(5, 1, false, 'cheap-history'), p = (await f.prepare())!;
    allowLocalTechnicalSubmission();
    const sent = await f.cap.submitSharedPoolApproval(p);
    f.receipt.logs = [{ address: p.token, ...approvalAbi.encodeEventLog(approvalAbi.getEvent('Approval')!,
      [owner, policy.core, [77n, f.amount], [99n, f.amount]]) }];
    await expect(sent.recover()).rejects.toThrow('event changed');
    expect(readCurrentDexPendingAttempt(f.storage)).toMatchObject({ core: f.policy.core.toLowerCase(), verificationBlocked: true });
  });
  it('keeps unadmitted-owner approval signing held before review or encryption', async () => {
    const f = approvalFixture(2, 0, false, 'cheap-history', unrelated);
    const cap = createCurrentSharedDexTokenFundingAdapter({ ...f.args, assertApprovalAdmission: undefined });
    await expect(cap.prepareSharedPoolApproval(f.request)).rejects.toThrow('signing hold');
    expect(f.encrypt).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['core', 'market', 'pair'] as const)('rejects a wrong %s before private approval encryption', async field => {
    const f = approvalFixture(5, 1, false, 'cheap-history');
    if (field === 'core') f.funding.intent.core = policy.core;
    if (field === 'market') f.funding.intent.marketId = STAGED_SHARED_HISTORY_DEX_CANDIDATE.pairs[0].marketId;
    if (field === 'pair') Object.assign(f.funding.intent, { poolTokens: [...f.funding.intent.poolTokens].reverse() });
    await expect(f.prepare()).rejects.toThrow('exact funding intent');
    expect(f.encrypt).not.toHaveBeenCalled(); expect(f.readFunds).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
  });
});

function limitApprovalFixture(kind: 'create' | 'topup' = 'topup', index: 0 | 1 = 0, candidate:'cheap-history'|'cheap-history'='cheap-history',selectedOwner=candidate==='cheap-history'?getAddress('0x8b749251cf1f712d4e39fd048c53394af03e10be'):owner) {
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
    const f=limitApprovalFixture('create',0,'cheap-history',unrelated),cap=createCurrentSharedDexTokenFundingAdapter({...f.args,assertApprovalAdmission:undefined});
    await expect(cap.prepareSharedLimitApproval(f.request)).rejects.toThrow(/held|hold/);
    expect(f.encrypt).not.toHaveBeenCalled();expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each([['create', 0], ['topup', 1]] as const)('sets exact %s allowance for token %s without moving inventory', async (kind, index) => {
    const f = limitApprovalFixture(kind, index), before = f.states.map(t => ({ ...t }));
    f.states[f.selectedIndex].allowance = 1n; before[f.selectedIndex].allowance = 1n;
    const p = (await f.prepare())!;
    expect(f.confirm).toHaveBeenCalledWith({ token: p.token, amount: f.amount, previousAllowance: 1n, spender: f.policy.core });
    expect(f.encrypt).toHaveBeenCalledWith(f.amount - 1n, p.token, approvalAbi.getFunction('increaseAllowance')!.selector);
    allowLocalTechnicalSubmission(); const sent = await f.cap.submitSharedLimitApproval(p);
    f.funding.assertAuthority.mockRejectedValue(new Error('Allowance changed after its mined approval'));
    expect(await sent.recover()).toMatchObject({ fundingOutcome: 'verified', privateAccountingVerified: true });
    expect(f.states).toEqual(before.map((t, i) => i === f.selectedIndex ? { ...t, allowance: f.amount } : t));
    expect(f.decrypt.mock.calls.every(([cipher]) => cipher.ciphertextHigh === 77n)).toBe(true);
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
  });
  it('keeps the actual App hold before review, private encryption or wallet resources', async () => {
    const f = limitApprovalFixture('topup', 0, 'cheap-history', unrelated), cap = createCurrentSharedDexTokenFundingAdapter({ ...f.args, assertApprovalAdmission: undefined });
    await expect(cap.prepareSharedLimitApproval(f.request)).rejects.toThrow('signing hold');
    await expect(cap.submitSharedLimitApproval({} as never)).rejects.toThrow('held');
    for (const call of [f.confirm, f.encrypt, f.readFunds, f.transport.readNonce, f.transport.estimateGas, f.transport.send]) expect(call).not.toHaveBeenCalled();
  });
  it.each(['copy', 'session', 'core', 'market', 'pair', 'token', 'zero', 'overflow', 'balance', 'source', 'review-drift'])('rejects changed Limit funding before a transaction: %s', async fault => {
    const f = limitApprovalFixture();
    if (fault === 'copy') f.request.funding = { ...f.funding };
    if (fault === 'session') limitBrands.set(f.funding, {});
    if (fault === 'core') f.funding.to = policy.core;
    if (fault === 'market') f.funding.marketId = STAGED_SHARED_HISTORY_DEX_CANDIDATE.pairs[0].marketId;
    if (fault === 'pair') Object.assign(f.funding, { poolTokens: [...f.funding.poolTokens].reverse() });
    if (fault === 'token') f.funding.fundingToken = owner;
    if (fault === 'zero') f.funding.amount = 0n;
    if (fault === 'overflow') f.funding.amount = 1n << 256n;
    if (fault === 'balance') f.states[f.selectedIndex].balance = 0n;
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

function swapApprovalFixture(tokenIndex = 0, candidate: 'cheap-history' | 'cheap-history' = 'cheap-history') {
  const descriptor = resolvePreparedDexScope(candidate).candidate;
  const pairIndex = descriptor.pairs.findIndex(pair => pair.tokens.some(token => token.toLowerCase() === CURRENT_SHARED_DEX_TOKENS[tokenIndex].address.toLowerCase()));
  const canonicalIndex = descriptor.pairs[pairIndex].tokens.findIndex(token => token.toLowerCase() === CURRENT_SHARED_DEX_TOKENS[tokenIndex].address.toLowerCase()) as 0 | 1;
  const f = approvalFixture(pairIndex, canonicalIndex, false, candidate);
  const admission = vi.fn<NonNullable<Args['assertSwapApprovalAdmission']>>(async () => {}), assertReviewCurrent = vi.fn(async () => {});
  const args = { ...f.args, assertSwapApprovalAdmission: admission }, cap = createCurrentSharedDexTokenFundingAdapter(args);
  const request = { token: f.states[tokenIndex].address, amount: 17n, assertReviewCurrent, confirm: vi.fn(async () => true) };
  return { ...f, args, cap, request, admission, assertReviewCurrent, prepare: () => cap.prepareSharedSwapApproval(request) };
}

describe('swap allowance cleanup', () => {
  const cleanupFixture = () => {
    const f = swapApprovalFixture(0, 'cheap-history');
    f.states[0].allowance = 99n;
    const request = { ...f.request, preparedQuote: {} as never };
    return { ...f, request, prepareCleanup: () => f.cap.prepareSharedSwapAllowanceCleanup(request) };
  };
  it('prepares only zero for the selected Core allowance', async () => {
    const f = cleanupFixture();
    const prepared = (await f.prepareCleanup())!;
    expect(prepared).toMatchObject({ cleanup: true, amount: 0n, token: getAddress(f.request.token), spender: f.policy.core });
    expect(f.request.confirm).toHaveBeenCalledWith(expect.objectContaining({ cleanup: true, amount: 0n, previousAllowance: 99n }));
    expect(f.encrypt).toHaveBeenCalledWith(0n, prepared.token, approvalAbi.getFunction('approve')!.selector);
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('keeps default authority held and requires the original Quote', async () => {
    const f = cleanupFixture(), cap = createCurrentSharedDexTokenFundingAdapter({ ...f.args, assertSwapApprovalAdmission: undefined });
    await expect(cap.prepareSharedSwapAllowanceCleanup(f.request)).rejects.toThrow('held');
    await expect(f.cap.prepareSharedSwapAllowanceCleanup({ ...f.request, preparedQuote: undefined as never })).rejects.toThrow('Original branded');
    expect(f.encrypt).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('does not prompt or encrypt when allowance is already zero', async () => {
    const f = cleanupFixture(); f.states[0].allowance = 0n;
    expect(await f.prepareCleanup()).toBeNull();
    expect(f.request.confirm).not.toHaveBeenCalled(); expect(f.encrypt).not.toHaveBeenCalled();
  });
  it.each(['prepare', 'sign'] as const)('rejects operation lookup uncertainty at %s', async phase => {
    const f = cleanupFixture(), prepared = phase === 'sign' ? (await f.prepareCleanup())! : null;
    f.storage.setItem(CURRENT_DEX_OPERATION_LOOKUPS_KEY, '{unreconciled');
    await expect(prepared ? f.cap.submitSharedSwapApproval(prepared) : f.prepareCleanup()).rejects.toThrow();
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('rejects an unbranded Quote at the shared send boundary', async () => {
    const f = cleanupFixture(), prepared = (await f.prepareCleanup())!;
    allowLocalTechnicalSubmission();
    await expect(f.cap.submitSharedSwapApproval(prepared)).rejects.toThrow('not prepared in this owner wallet session');
    expect(f.transport.send).not.toHaveBeenCalled();
  });
});

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

describe('current candidate exact swap approvals', () => {
  it.each([0, 1, 2, 3])('proves selected token %s without a Pool intent or another token change', async tokenIndex => {
    const f = swapApprovalFixture(tokenIndex), before = f.states.map(t => ({ ...t })), prepared = (await f.prepare())!;
    expect(prepared).toMatchObject({ candidate: 'cheap-history', owner, spender: f.policy.core, token: getAddress(f.request.token), amount: 17n, readyToSign: false });
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
  it('rejects insufficient balance', async () => {
    const f = swapApprovalFixture(); f.states[0].balance = 16n;
    await expect(f.prepare()).rejects.toThrow('sufficient input funds'); expect(f.encrypt).not.toHaveBeenCalled();
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
  const mappings = STAGED_SHARED_HISTORY_DEX_CANDIDATE.pairs.flatMap((pair, pairIndex) =>
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
    const f = approvalFixture(0, 0, false, 'cheap-history', unrelated), topUp = Object.assign(f.funding, { positionId: 43n, ownerContext: hash });
    const cap = createCurrentSharedDexTokenFundingAdapter({ ...f.args, assertApprovalAdmission: undefined });
    await expect(cap.prepareSharedPoolApproval({ ...f.request, funding: topUp as unknown as CurrentPoolPreparedTopUpFunding })).rejects.toThrow('signing hold');
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
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalledTimes(4); expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
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
    const f = approvalFixture(0, 0, false, 'cheap-history', unrelated), cap = createCurrentSharedDexTokenFundingAdapter({ ...f.args, assertApprovalAdmission: undefined });
    await expect(cap.prepareSharedPoolApproval(f.request)).rejects.toThrow('signing hold');
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
  it.each(['insufficient', 'zero', 'negative', 'overflow'])('rejects invalid allowance request: %s', async reason => {
    const f = approvalFixture();
    if (reason === 'insufficient') f.states[f.selectedIndex].balance = f.amount - 1n;
    if (reason === 'zero') f.funding.amounts.used0 = 0n;
    if (reason === 'negative') f.funding.amounts.used0 = -1n;
    if (reason === 'overflow') f.funding.amounts.used0 = 1n << 256n;
    const expected = reason === 'insufficient' ? 'Pool token balance is below the required deposit amount.' :
      'Invalid exact Pool allowance.';
    await expect(f.prepare()).rejects.toThrow(expected);
    expect(f.confirm).not.toHaveBeenCalled(); expect(f.encrypt).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('reports an already cleared Pool allowance without another cleanup send', async () => {
    const f = approvalFixture(0, 0, true); f.states[f.selectedIndex].allowance = 0n;
    expect(await f.prepare()).toBeNull();
    expect(f.confirm).not.toHaveBeenCalled(); expect(f.encrypt).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
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
  it.each(['cheap-history'] as const)('%s reviews fresh owner resources, nonce and estimate for initial claims and refills', async candidate => {
    for (const action of ['initial', 'refill'] as const) {
      const f = fixture(candidate);
      if (action === 'refill') f.states.forEach(t => { t.claimed = true; });
      let reviewed: unknown;
      const confirm = vi.fn(async (review: unknown) => { reviewed = review; return true; });
      const p = await f.cap.prepareSharedTokenFunding({ action, token: f.states[0].address, confirm });
      expect(p).not.toBeNull();
      expect(reviewed).toMatchObject({ action, token: f.states[0].address, decimals: 6, gasEstimate: 800_000n,
        gasPrice: 50_000_000n, gasLimit: 5_000_000n });
      expect(vi.mocked(f.transport.readNativeResources!)).toHaveBeenCalled();
      expect(vi.mocked(f.transport.readNonce)).toHaveBeenCalled();
      expect(vi.mocked(f.transport.estimateGas)).toHaveBeenCalledWith(expect.objectContaining({
        from: owner, to: p!.to, data: p!.data, value: 0n, nonce: 3, gasPrice: 50_000_000n
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
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalledTimes(4);
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
  it.each(['cheap-history'] as const)('keeps a rejected wallet request locked until reconciliation: %s', async candidate => {
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
  it.each([false, true])('holds an old distributor refill after rotation without resending (hashless: %s)', async hashless => {
    const f = fixture('cheap-history', getAddress('0x8b749251cf1f712d4e39fd048c53394af03e10be'));
    f.states.forEach(token => { token.claimed = true; });
    const oldVault = getAddress('0xB509dCfaa8a0AB7b976B84f091875246e0FDD8Cf');
    expect(getAddress(f.policy.vault.address)).not.toBe(oldVault);
    const data = abi.encodeFunctionData('claim', [f.states[0].address]);
    reserveCurrentDexPendingAttempt(f.storage, { version: 1, chainId: String(f.policy.chainId), owner: f.args.ownerAddress.toLowerCase(),
      core: f.policy.core.toLowerCase(), graph: `0x${f.policy.graph}`, phase: 'token-refill', callHash: keccak256(data), nonce: 3,
      txHash: hashless ? null : txHash, target: oldVault.toLowerCase() });
    f.txs.value = { chainId: f.policy.chainId, from: f.args.ownerAddress, to: oldVault, data, value: 0n, nonce: 3,
      gasLimit: 5_000_000n, gasPrice: 50_000_000n, hash: txHash, blockNumber: Number(f.head.number), blockHash: f.head.hash };
    f.receipt.to = oldVault;
    const pending = readCurrentDexPendingAttempt(f.storage)!;
    const reload = createCurrentSharedDexTokenFundingAdapter(f.args);
    if (hashless) expect(await reload.recoverPendingSharedTokenFunding()).toMatchObject({ status: 'manual-reconciliation-required' });
    else await expect(reload.recoverPendingSharedTokenFunding()).rejects.toThrow('target or calldata changed');
    expect(readCurrentDexPendingAttempt(f.storage)).toMatchObject({ ...pending, ...(hashless ? {} : { verificationBlocked: true }) });
    await expect(reload.prepareSharedTokenFunding({ action: 'refill', token: f.states[0].address, confirm: async () => true })).rejects.toThrow(/pending/i);
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(getAddress(readCurrentDexPendingAttempt(f.storage)!.target!)).toBe(oldVault);
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


describe('sufficient and unlimited token approvals', () => {
  it('keeps cleanup at zero without consulting the unlimited switch',async()=>{
    const f=approvalFixture(0,0,true);f.states[f.selectedIndex].allowance=99n;
    const approvalMode=vi.fn(()=>'unlimited' as const);
    await f.cap.prepareSharedPoolApproval({...f.request,approvalMode});
    expect(approvalMode).not.toHaveBeenCalled();expect(f.encrypt).toHaveBeenCalledWith(0n,expect.any(String),approvalAbi.getFunction('approve')!.selector);
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['swap','limit','pool'] as const)('uses the %s switch choice made in the existing confirmation before encryption', async kind => {
    const f=kind==='swap'?swapApprovalFixture():kind==='limit'?limitApprovalFixture():approvalFixture();
    let unlimited=false;
    const approvalMode=vi.fn(()=>unlimited?'unlimited' as const:'exact' as const);
    const confirm=vi.fn(async()=>{unlimited=true;return true;});
    const p=kind==='swap'?await f.cap.prepareSharedSwapApproval({...f.request as ReturnType<typeof swapApprovalFixture>['request'],approvalMode,confirm})
      :kind==='limit'?await f.cap.prepareSharedLimitApproval({...f.request as ReturnType<typeof limitApprovalFixture>['request'],approvalMode,confirm})
      :await f.cap.prepareSharedPoolApproval({...f.request as ReturnType<typeof approvalFixture>['request'],approvalMode,confirm});
    expect(p).not.toBeNull();expect(confirm).toHaveBeenCalledOnce();expect(approvalMode).toHaveBeenCalledOnce();
    expect(f.encrypt).toHaveBeenCalledWith(MAX_TOKEN_ALLOWANCE,expect.any(String),approvalAbi.getFunction('approve')!.selector);
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['swap','limit','pool'] as const)('cancels the %s popup without reading its choice or encrypting', async kind => {
    const f=kind==='swap'?swapApprovalFixture():kind==='limit'?limitApprovalFixture():approvalFixture();
    const approvalMode=vi.fn(()=>'unlimited' as const),confirm=vi.fn(async()=>false);
    const p=kind==='swap'?await f.cap.prepareSharedSwapApproval({...f.request as ReturnType<typeof swapApprovalFixture>['request'],approvalMode,confirm})
      :kind==='limit'?await f.cap.prepareSharedLimitApproval({...f.request as ReturnType<typeof limitApprovalFixture>['request'],approvalMode,confirm})
      :await f.cap.prepareSharedPoolApproval({...f.request as ReturnType<typeof approvalFixture>['request'],approvalMode,confirm});
    expect(p).toBeNull();expect(approvalMode).not.toHaveBeenCalled();expect(f.encrypt).not.toHaveBeenCalled();expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each([11n, 12n, MAX_TOKEN_ALLOWANCE])('reuses Pool allowance %s without approval', async allowance => {
    const f=approvalFixture(); f.states[f.selectedIndex].allowance=allowance;
    expect(await f.prepare()).toBeNull(); expect(f.encrypt).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['exact','unlimited'] as const)('increases only the selected Pool token using %s policy', async approvalMode => {
    const f=approvalFixture(); f.states[f.selectedIndex].allowance=1n;
    const before=f.states.map(token=>({...token})), target=approvalMode==='unlimited'?MAX_TOKEN_ALLOWANCE:f.amount;
    const p=(await f.cap.prepareSharedPoolApproval({...f.request,approvalMode}))!;
    expect(f.encrypt).toHaveBeenCalledWith(target-1n,p.token,approvalAbi.getFunction('increaseAllowance')!.selector);
    expect(f.confirm).toHaveBeenCalledWith(expect.objectContaining({amount:target,previousAllowance:1n}));
    allowLocalTechnicalSubmission(); const sent=await f.cap.submitSharedPoolApproval(p);
    expect(await sent.recover()).toMatchObject({privateAccountingVerified:true});
    expect(f.states).toEqual(before.map((token,i)=>i===f.selectedIndex?{...token,allowance:target}:token));
  });
  it('rechecks the dependency hold before send and preserves the existing allowance',async()=>{
    const f=approvalFixture(), idle=vi.fn(async()=>{}),cap=createCurrentSharedDexTokenFundingAdapter({...f.args,assertAllowanceMutationIdle:idle});
    const p=(await cap.prepareSharedPoolApproval(f.request))!; idle.mockRejectedValue(new Error('Active swap'));
    await expect(cap.submitSharedPoolApproval(p)).rejects.toThrow('Active swap');
    expect(f.transport.send).not.toHaveBeenCalled();expect(f.states[f.selectedIndex].allowance).toBe(0n);
  });
  it.each([17n, 19n, MAX_TOKEN_ALLOWANCE])('reuses sufficient swap allowance %s',async allowance=>{
    const f=swapApprovalFixture();f.states[0].allowance=allowance;
    expect(await f.prepare()).toBeNull();expect(f.encrypt).not.toHaveBeenCalled();
  });
  it('increases a swap shortfall and verifies the resulting target',async()=>{
    const f=swapApprovalFixture();f.states[0].allowance=1n;
    const p=(await f.prepare())!;expect(f.encrypt).toHaveBeenCalledWith(16n,p.token,approvalAbi.getFunction('increaseAllowance')!.selector);
    allowLocalTechnicalSubmission();const sent=await f.cap.submitSharedSwapApproval(p);
    expect(await sent.recover()).toMatchObject({privateAccountingVerified:true});expect(f.states[0].allowance).toBe(17n);
  });
  it('reuses sufficient Limit allowance',async()=>{
    const f=limitApprovalFixture();f.states[f.selectedIndex].allowance=MAX_TOKEN_ALLOWANCE;
    expect(await f.prepare()).toBeNull();expect(f.encrypt).not.toHaveBeenCalled();
  });
});


// CW-086, decision-033: the normal browser App releases a token action that the wallet rejected and never sent.
describe('release of a wallet-rejected token action in the browser App', () => {
  const asBrowser = <T extends { args: Args; values: Map<string, string>; transport: Args['transport']; policy: { graph: string; chainId: bigint } }>(f: T): T => {
    const browserOwner = f.args.ownerAddress.toLowerCase();
    browserContexts.set(f.args.signer, { owner: browserOwner });
    f.values.set(currentDexNormalUseReloadKey({ owner: browserOwner, graph: f.policy.graph, chainId: f.policy.chainId }), JSON.stringify({
      budget: { version: 2, owner: browserOwner, candidateGraph: f.policy.graph, start: '1', committedWei: '0', activeSwap: null, charges: [] },
      authentication: hash }));
    (f.transport as { admitOwnerRecord?: unknown }).admitOwnerRecord = vi.fn(async () => {});
    return f;
  };
  const rejection = () => Object.assign(new Error('User rejected the request.'), { code: 4001 });
  it.each(['initial', 'refill'] as const)('releases a rejected %s claim and permits the same claim again', async action => {
    allowLocalTechnicalSubmission();
    const f = asBrowser(fixture('cheap-history')); if (action === 'refill') f.states[0].claimed = true;
    const p = (await f.prepare(action))!, error = rejection();
    vi.mocked(f.transport.send).mockRejectedValueOnce(error);
    await expect(f.cap.submitSharedTokenFunding(p)).rejects.toBe(error);
    expect(wasCurrentDexUnsentReleased(error)).toBe(true);
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
    const sent = await f.cap.submitSharedTokenFunding(p);
    expect(await sent.recover()).toMatchObject({ fundingOutcome: 'verified', privateAccountingVerified: true });
    expect(f.transport.send).toHaveBeenCalledTimes(2);
  });
  it('keeps an unknown wallet result locked in the browser App', async () => {
    allowLocalTechnicalSubmission();
    const f = asBrowser(fixture('cheap-history')), p = (await f.prepare())!; f.unknown();
    await expect(f.cap.submitSharedTokenFunding(p)).rejects.toThrow('Unknown wallet result');
    expect(readCurrentDexPendingAttempt(f.storage)).toMatchObject({ phase: 'token-faucet', txHash: null });
    expect(readCurrentDexPendingAttempt(f.storage)).not.toHaveProperty('walletRejected');
    await expect(f.cap.submitSharedTokenFunding(p)).rejects.toThrow();
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('keeps a rejected claim locked while its nonce is pending and releases it on a later check', async () => {
    allowLocalTechnicalSubmission();
    const f = asBrowser(fixture('cheap-history')), p = (await f.prepare())!, error = rejection();
    let pendingNonce = 3;
    vi.mocked(f.transport.readNativeResources!).mockImplementation(async h => ({ owner: f.args.ownerAddress, chainId: f.policy.chainId, head: { ...h },
      latestNonce: 3, pendingNonce, baseFeePerGas: 1n, gasPrice: 50_000_000n, code: '0x', balance: 10n ** 18n }));
    vi.mocked(f.transport.send).mockImplementationOnce(async () => { pendingNonce = 4; throw error; });
    await expect(f.cap.submitSharedTokenFunding(p)).rejects.toBe(error);
    expect(wasCurrentDexUnsentReleased(error)).toBe(false);
    expect(readCurrentDexPendingAttempt(f.storage)).toMatchObject({ phase: 'token-faucet', txHash: null, walletRejected: true });
    const reload = createCurrentSharedDexTokenFundingAdapter(f.args);
    await expect(reload.recoverPendingSharedTokenFunding()).rejects.toThrow('nonce');
    expect(readCurrentDexPendingAttempt(f.storage)).toMatchObject({ walletRejected: true });
    pendingNonce = 3;
    expect(await reload.recoverPendingSharedTokenFunding()).toMatchObject({ status: 'released-unsent', privateAccountingVerified: false });
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('releases a rejected Limit approval and permits the same approval again', async () => {
    allowLocalTechnicalSubmission();
    const f = asBrowser(limitApprovalFixture('topup', 0, 'cheap-history')), p = (await f.prepare())!, error = rejection();
    vi.mocked(f.transport.send).mockRejectedValueOnce(error);
    await expect(f.cap.submitSharedLimitApproval(p)).rejects.toBe(error);
    expect(wasCurrentDexUnsentReleased(error)).toBe(true);
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
    await f.cap.submitSharedLimitApproval(p);
    expect(readCurrentDexPendingAttempt(f.storage)).toMatchObject({ phase: 'token-approve', txHash });
    expect(f.transport.send).toHaveBeenCalledTimes(2);
  });
  it('releases a rejected Pool approval and permits the same approval again', async () => {
    allowLocalTechnicalSubmission();
    const f = asBrowser(approvalFixture(0, 0, false, 'cheap-history')), p = (await f.prepare())!, error = rejection();
    vi.mocked(f.transport.send).mockRejectedValueOnce(error);
    await expect(f.cap.submitSharedPoolApproval(p)).rejects.toBe(error);
    expect(wasCurrentDexUnsentReleased(error)).toBe(true);
    expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
    await f.cap.submitSharedPoolApproval(p);
    expect(readCurrentDexPendingAttempt(f.storage)).toMatchObject({ phase: 'token-approve', txHash });
    expect(f.transport.send).toHaveBeenCalledTimes(2);
  });
  it('does not release while the owner record is in use and has no release step, and releases with the step', async () => {
    allowLocalTechnicalSubmission();
    const base = asBrowser(limitApprovalFixture('topup', 0, 'cheap-history'));
    const cap = createCurrentSharedDexTokenFundingAdapter({ ...base.args, authorizeSwapApprovalSigning: async () => {} });
    const p = (await cap.prepareSharedLimitApproval(base.request))!, error = rejection();
    vi.mocked(base.transport.send).mockRejectedValueOnce(error);
    await expect(cap.submitSharedLimitApproval(p)).rejects.toBe(error);
    expect(wasCurrentDexUnsentReleased(error)).toBe(false);
    expect(readCurrentDexPendingAttempt(base.storage)).toMatchObject({ phase: 'token-approve', txHash: null, walletRejected: true });
    const release = vi.fn(async (_attempt: unknown) => {});
    const withStep = createCurrentSharedDexTokenFundingAdapter({ ...base.args, authorizeSwapApprovalSigning: async () => {}, releaseUnsentLedgerReservation: release });
    expect(await withStep.recoverPendingSharedLimitApproval()).toMatchObject({ status: 'released-unsent' });
    expect(release).toHaveBeenCalledOnce();
    expect(release.mock.calls[0][0]).toMatchObject({ phase: 'token-approve', walletRejected: true });
    expect(readCurrentDexPendingAttempt(base.storage)).toBeNull();
    expect(base.transport.send).toHaveBeenCalledOnce();
  });
});
// CW-086 part B, decision-033: the adapter saves its records in durable storage that all tabs of the site share.
describe('durable shared records in the token adapter', () => {
  const memory = () => { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; };
  it('moves the tab records, saves a sent claim for its wallet, and shows it to a new tab that cannot send again', async () => {
    allowLocalTechnicalSubmission();
    const f = fixture('cheap-history'), browserOwner = f.args.ownerAddress.toLowerCase(), durable = memory();
    browserContexts.set(f.args.signer, { owner: browserOwner });
    (f.transport as { admitOwnerRecord?: unknown }).admitOwnerRecord = vi.fn(async () => {});
    const scope = { owner: browserOwner, graph: f.policy.graph, chainId: f.policy.chainId }, budgetKey = currentDexNormalUseReloadKey(scope);
    const budget = JSON.stringify({ budget: { version: 2, owner: browserOwner, candidateGraph: f.policy.graph, start: '1', committedWei: '0',
      activeSwap: null, charges: [] }, authentication: hash });
    f.values.set(budgetKey, budget);
    const request = { action: 'initial' as const, token: f.states[0].address, confirm: async () => true };
    vi.stubGlobal('window', { sessionStorage: f.storage, localStorage: durable });
    const first = createCurrentSharedDexTokenFundingAdapter(f.args);
    await first.submitSharedTokenFunding((await first.prepareSharedTokenFunding(request))!);
    const pendingKey = currentDexScopedRecordKey(CURRENT_DEX_PENDING_ATTEMPT_KEY, scope);
    expect(JSON.parse(durable.values.get(pendingKey)!)).toMatchObject({ phase: 'token-faucet', owner: browserOwner, txHash });
    // The budget record of the tab moved with identical bytes. The tab keeps no copy.
    expect(durable.values.get(budgetKey)).toBe(budget);
    expect(f.values.size).toBe(0);
    expect([...durable.values.keys()].sort()).toEqual([pendingKey, budgetKey].sort());
    expect([...durable.values.values()].join('')).not.toMatch(/aesKey|ciphertext|signature|privateKey|mnemonic/i);
    // A new tab of the same wallet has empty tab storage and the same durable storage.
    vi.stubGlobal('window', { sessionStorage: memory(), localStorage: durable });
    const second = createCurrentSharedDexTokenFundingAdapter(f.args);
    await expect((async () => second.submitSharedTokenFunding((await second.prepareSharedTokenFunding(request))!))()).rejects.toThrow();
    expect(f.transport.send).toHaveBeenCalledOnce();
    expect(JSON.parse(durable.values.get(pendingKey)!)).toMatchObject({ phase: 'token-faucet', txHash });
    // The state check of the new tab reconciles the open action by its hash.
    await expect(second.recoverPendingSharedTokenFunding()).resolves.toMatchObject({ status: 'observed-mined' });
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
});
describe('wallet menu durable approval reconciliation',()=>{
  it.each(['verified','changed-balance','parent-reorg']as const)('accounts for a lost revocation handle: %s',async fault=>{
    const f=approvalFixture(0,0,true),before=await f.args.readFunds(f.head),p=(await f.prepare())!;
    allowLocalTechnicalSubmission();await f.cap.submitSharedPoolApproval(p);
    const read=f.args.readFunds;
    const cap=createCurrentSharedDexTokenFundingAdapter({...f.args,
      readReceiptBlock:async number=>({...f.head,number:BigInt(number)}),
      readFunds:async head=>head.number<f.head.number?{...before,head}:read(head)});
    if(fault==='changed-balance')f.states[1].balance++;
    if(fault==='parent-reorg')vi.mocked(f.transport.readBlockHash).mockResolvedValue(toBeHex(789n,32));
    if(fault==='verified'){
      expect(await cap.reconcilePendingSharedTokenApproval()).toMatchObject({status:'observed-mined',privateAccountingVerified:true,reviewedTargetVerified:false});
      expect(readCurrentDexPendingAttempt(f.storage)).toBeNull();
    }else{
      await expect(cap.reconcilePendingSharedTokenApproval()).rejects.toThrow();
      expect(readCurrentDexPendingAttempt(f.storage)?.verificationBlocked).toBe(true);
    }
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
});

it('explicit Unlimited can upgrade an already sufficient finite Pool allowance',async()=>{
  const f=approvalFixture();f.states[f.selectedIndex].allowance=f.amount+1n;
  expect(await f.cap.readSharedPoolAllowances(f.request.funding)).toEqual([true,false]);
  expect(await f.cap.readSharedPoolAllowances(f.request.funding,['unlimited','exact'])).toEqual([false,false]);
  const p=await f.cap.prepareSharedPoolApproval({...f.request,approvalMode:'unlimited'});
  expect(p).not.toBeNull();expect(f.encrypt).toHaveBeenCalledWith(MAX_TOKEN_ALLOWANCE-f.amount-1n,expect.any(String),approvalAbi.getFunction('increaseAllowance')!.selector);
});
