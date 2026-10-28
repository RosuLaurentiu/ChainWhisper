import { Interface, toBeHex } from '@coti-io/coti-ethers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createCurrentTokenFundingAdapter, currentTokenFundingAbi as abi, CURRENT_TOKEN_FAUCET_AMOUNT as mint, CURRENT_TOKEN_FUNDING_CAP, CURRENT_TOKEN_FUNDING_NATIVE } from './currentDexTokenFunding';
import { CURRENT_CHEAP_DEX_CANDIDATE as c, resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY as key, readCurrentDexPendingAttempt } from './currentDexPendingAttempt';
import { currentNativeSigningBudget, CURRENT_NATIVE_SWAP_LIMITS } from './currentDexNativeSwapPolicy';
// Retained faucet/rollback cases use the archived deployment. Native approval cases below select cheap-native explicitly.
vi.mock('./dexV2Deployment', async original => {
  const actual = await original<typeof import('./dexV2Deployment')>();
  return { ...actual, CURRENT_CHEAP_DEX_CANDIDATE: actual.ARCHIVED_CHEAP_DEX_CANDIDATE,
    resolveCurrentCheapDexCandidate: (key: CurrentCheapDexCandidateKey) => actual.resolveCurrentCheapDexCandidate(key === 'cheap-current' ? 'cheap-archived' : key),
    assertCurrentCheapDexNativeAdmission: (c: typeof actual.ARCHIVED_CHEAP_DEX_CANDIDATE) => {
      const archived = actual.ARCHIVED_CHEAP_DEX_CANDIDATE;
      if (actual.currentCheapDexStages(c).workCalls === 4) throw new Error('Successor DEX native App submission admission is absent.');
      if (c.graph !== archived.graph || c.packageSha256 !== archived.packageSha256 || c.core.toLowerCase() !== archived.core)
        throw new Error('Staged DEX native App submission admission is absent.');
    } };
});
const owner = `0x${'22'.repeat(20)}`, zero = `0x${'00'.repeat(20)}`, hash = toBeHex(30n, 32), txHash = toBeHex(40n, 32);
// Independent producer: event definitions and expected amounts are not read from the verifier.
const events = new Interface(['event FaucetClaimed(address indexed account)',
  'event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)',
  'event Approval(address indexed owner,address indexed spender,(uint256 ciphertextHigh,uint256 ciphertextLow) ownerValue,(uint256 ciphertextHigh,uint256 ciphertextLow) spenderValue)']);
function fixture(index: 0 | 1 = 0, approval = false, candidate: CurrentCheapDexCandidateKey = 'cheap-current') {
  const c = resolveCurrentCheapDexCandidate(candidate);
  const store = new Map<string, string>(); vi.stubGlobal('window', { sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) } });
  const head = { number: 30n, hash, timestamp: 100n, gasLimit: 120_000_000n };
  const state = { tokenIndex: index, token: c.tokens[index][0], owner, balance: approval ? 100n : 0n, allowance: approval ? 2n : 0n, claimed: false, faucetAmount: 10_000n * 10n ** 18n, decimals: 18n, publicAmounts: false, encryptionAddress: zero, block: head };
  const other = { ...state, tokenIndex: (index === 0 ? 1 : 0) as 0 | 1, token: c.tokens[index === 0 ? 1 : 0][0] };
  let active = true, uncertain = false, tx: Record<string, unknown> | null = null;
  let clock = 100n;
  const signer = {}, guard = vi.fn(async () => { if (!active) throw new Error('Session revoked'); });
  const receipt = { hash: txHash, status: 1, from: owner, to: state.token, blockNumber: 30, blockHash: hash, logs: [] as { address: string; topics: string[]; data: string }[] };
  const encrypt = vi.fn(async (amount: bigint) => ({ ciphertext: { ciphertextHigh: 77n, ciphertextLow: amount }, signature: `0x${'44'.repeat(65)}` }));
  const transport = { assertCurrent: guard, readHead: async () => head, readNonce: vi.fn(async () => 4), estimateGas: vi.fn(async () => 500_000n),
    readNativeResources: vi.fn(async () => ({owner, chainId: BigInt(c.chainId), head, latestNonce: 4, pendingNonce: 4, baseFeePerGas: 1n, gasPrice: 50_000_000n, code: '0x', balance: 10n ** 18n})),
    verifyCanonicalInclusion: vi.fn(async (transaction, included) => {
      expect(transaction.hash).toBe(txHash); expect(transaction.blockHash).toBe(head.hash);
      expect(transaction.blockNumber).toBe(30); expect(included.hash).toBe(txHash);
      expect(included.blockHash).toBe(head.hash); expect(included.blockNumber).toBe(30);
    }),
    readBlockHash: vi.fn(async () => hash), readTransaction: vi.fn(async () => tx), waitForReceipt: vi.fn(async () => receipt),
    send: vi.fn(async request => {
      if (uncertain) throw new Error('Interrupted transport');
      tx = { ...request, hash: txHash, blockNumber: 30, blockHash: hash };
      const approve = request.data.slice(0, 10) === abi.getFunction('approve')!.selector;
      if (approve) { state.allowance = 20n; receipt.logs = [{ address: state.token, ...events.encodeEventLog(events.getEvent('Approval')!, [owner, c.core, [77n, 20n], [999n, 20n]]) }]; }
      else { state.balance += 10_000n * 10n ** 18n; state.claimed = true; receipt.logs = [
        { address: state.token, ...events.encodeEventLog(events.getEvent('Transfer')!, [zero, owner, [999n, 0n], [77n, 10_000n * 10n ** 18n]]) },
        { address: state.token, ...events.encodeEventLog(events.getEvent('FaucetClaimed')!, [owner]) }]; }
      return { ...request, hash: txHash };
    }) };
  const resources = vi.fn(async () => {}), attest = vi.fn(async (block: typeof head) => { void block; }), read = vi.fn(async (i: 0 | 1, block: typeof head) => ({ ...(i === index ? state : other), block }));
  const make = (identity = signer) => createCurrentTokenFundingAdapter({ candidate, signer: identity, ownerAddress: owner, chainId: BigInt(c.chainId), transport: transport as never, readState: read, assertResources: resources, attest, encrypt, decrypt: x => { if (BigInt(x.ciphertextHigh) === 999n) throw new Error('Protocol-only ciphertext'); return BigInt(x.ciphertextLow); }, now: () => clock });
  const prepare = (cap = make(), confirm = async () => true) => cap.prepareCurrentTokenFunding({ tokenIndex: index, action: approval ? 'approve' : 'faucet', amount: 20n, confirm });
  return { make, prepare, signer, state, other, receipt, transport, encrypt, resources, attest, store, head, clock: (value: bigint) => { clock = value; }, tx: () => tx!, revoke: () => { active = false; }, interrupt: () => { uncertain = true; } };
}
afterEach(() => vi.unstubAllGlobals());
describe('current-token finite funding', () => {
  it('retains the original canonical private native approval proof across same-lease remount',async()=>{
    const f=fixture(0,true,'cheap-native'),cap=f.make(),prepared=(await f.prepare(cap))!;await cap.submitCurrentTokenFunding(prepared);
    expect(await f.make().recoverCurrentNativePoolTokenResult()).toMatchObject({fundingOutcome:'verified',allowance:20n});
    expect(f.transport.send).toHaveBeenCalledOnce();expect(await f.make().recoverCurrentNativePoolTokenResult()).toBeNull();
  });
  it.each(['foreign-signer','foreign-owner','foreign-candidate','nonce','hash','blocked','unknown','unavailable','revoked'])('retained private native token recovery rejects or holds %s',async fault=>{
    const f=fixture(0,true,'cheap-native'),cap=f.make(),prepared=(await f.prepare(cap))!;await cap.submitCurrentTokenFunding(prepared);
    const pending=JSON.parse(f.store.get(key)!);
    if(fault==='foreign-owner')pending.owner='0x'+'33'.repeat(20);if(fault==='foreign-candidate')pending.graph=toBeHex(123n,32);
    if(fault==='nonce')pending.nonce++;if(fault==='hash')pending.txHash=toBeHex(123n,32);if(fault==='blocked')pending.verificationBlocked=true;
    if(fault==='unknown')pending.txHash=null;f.store.set(key,JSON.stringify(pending));
    if(fault==='unavailable')f.transport.waitForReceipt.mockRejectedValue(new Error('RPC unavailable'));if(fault==='revoked')f.revoke();
    const remount=f.make(fault==='foreign-signer'?{}:f.signer);
    if(['foreign-signer','nonce','hash','unknown'].includes(fault))expect(await remount.recoverCurrentNativePoolTokenResult()).toBeNull();
    else await expect(remount.recoverCurrentNativePoolTokenResult()).rejects.toThrow();
    expect(f.store.size).toBe(1);expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each([0, 1] as const)('binds native approval to exact Core and the shared finite signing budget: token %s', async index => {
    const candidate = resolveCurrentCheapDexCandidate('cheap-native'), f = fixture(index, true, 'cheap-native'), cap = f.make();
    const prepared = await cap.prepareCurrentTokenFunding({tokenIndex: index, action: 'approve', amount: 20n,
      confirm: async review => {expect(review.spender.toLowerCase()).toBe(candidate.core); return true;}});
    expect(prepared).toMatchObject({graph: candidate.graph, packageSha256: candidate.packageSha256, readyToSign: false});
    expect(abi.decodeFunctionData('approve', prepared!.data)[0].toLowerCase()).toBe(candidate.core);
    const sent = await cap.submitCurrentTokenFunding(prepared!);
    expect((await sent.recover()).allowance).toBe(20n);
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalledTimes(2);
    expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({gasPrice: 50_000_000n, gasLimit: 5_000_000n}), expect.any(Function));
    expect(currentNativeSigningBudget(f.signer, owner, () => 100n).snapshot()).toMatchObject({signingStarts: 1, committedWei: 250_000_000_000_000n});
    await expect(fixture(index, true).make().submitCurrentTokenFunding(prepared!)).rejects.toThrow('session');
  });
  it.each([0, 1] as const)('admits exact native one-time initial claim with private credit and unchanged other token: %s', async index => {
    const actual = await vi.importActual<typeof import('./dexV2Deployment')>('./dexV2Deployment');
    const f = fixture(index, false, 'cheap-native'), cap = f.make(), p = (await f.prepare(cap))!;
    expect(p.graph).toBe(actual.STAGED_NATIVE_DEX_CANDIDATE.graph); expect(p.amount).toBe(mint);
    expect(() => actual.assertCurrentCheapDexNativeAdmission(actual.STAGED_NATIVE_DEX_CANDIDATE)).toThrow();
    const baseline = { ...f.other }, sent = await cap.submitCurrentTokenFunding(p);
    expect(await sent.recover()).toMatchObject({ balance: mint, claimed: true, fundingOutcome: 'verified' });
    expect(f.other).toEqual(baseline); expect(f.transport.send).toHaveBeenCalledOnce();
    expect(currentNativeSigningBudget(f.signer, owner, () => 100n).snapshot().signingStarts).toBe(1);
    await expect(f.prepare(cap)).rejects.toThrow('eligible');
  });
  it('binds both initial claims and source-bound refill to accepted public proof', () => {
    const raw = readFileSync('reports/next-dex-app-2026-10-04/current-refill-native-binding-3.json');
    const proof = JSON.parse(raw.toString()); expect(proof.status).toBe('DEVELOPMENT_PRIVATE_REFILL_NATIVE_ACCEPTED');
    expect(proof.exactInitialAndRefillCredit).toBe(true); expect(proof.noPending).toBe(true);
    expect(proof.transactions.filter((r: { name: string }) => r.name.startsWith('initial-')).map((r: { gasUsed: string }) => r.gasUsed)).toEqual(['713863','713863']);
  });
  it.each(['before', 'after'] as const)('rejects native other-token mutation %s send', async when => {
    const f = fixture(0, false, 'cheap-native'), cap = f.make(), p = (await f.prepare(cap))!;
    if (when === 'before') { f.other.balance++; await expect(cap.submitCurrentTokenFunding(p)).rejects.toThrow('Other'); expect(f.transport.send).not.toHaveBeenCalled(); }
    else { const sent = await cap.submitCurrentTokenFunding(p); f.other.allowance++; await expect(sent.recover()).rejects.toThrow('Other'); expect(JSON.parse(f.store.get(key)!).verificationBlocked).toBe(true); }
  });
  it('rejects native claim estimate without25percent plus1M margin without consuming budget', async () => {
    const f = fixture(0, false, 'cheap-native'), cap = f.make(); f.transport.estimateGas.mockResolvedValue(3_300_000n);
    await expect(cap.submitCurrentTokenFunding((await f.prepare(cap))!)).rejects.toThrow('estimate');
    expect(currentNativeSigningBudget(f.signer, owner, () => 100n).snapshot().signingStarts).toBe(0); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('native claim receipt-only private recovery survives signing-window expiry and low gas', async () => {
    const f=fixture(0,false,'cheap-native'),cap=f.make(),sent=await cap.submitCurrentTokenFunding((await f.prepare(cap))!);
    f.clock(2000n);f.resources.mockRejectedValue(new Error('No gas'));
    expect(await sent.recover()).toMatchObject({fundingOutcome:'verified',balance:mint});expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('blocks mutation of original native receipt during canonical check',async()=>{
    const f=fixture(0,false,'cheap-native'),cap=f.make(),sent=await cap.submitCurrentTokenFunding((await f.prepare(cap))!);
    f.transport.verifyCanonicalInclusion.mockImplementation(async()=>{f.receipt.status=0;f.receipt.logs=[];});
    await expect(sent.recover()).rejects.toThrow('receipt changed');expect(JSON.parse(f.store.get(key)!).verificationBlocked).toBe(true);
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('native claim status0 proves exact selected and other-token rollback',async()=>{
    const f=fixture(0,false,'cheap-native'),cap=f.make(),p=(await f.prepare(cap))!,sent=await cap.submitCurrentTokenFunding(p);
    f.receipt.status=0;f.receipt.logs=[];f.state.balance=p.before.balance;f.state.claimed=p.before.claimed;
    expect(await sent.recover()).toMatchObject({fundingOutcome:'reverted'});expect(f.store.size).toBe(0);
  });
  it('native metadata recovery after expiry is explicitly non-signing and no private proof',async()=>{
    const f=fixture(0,false,'cheap-native'),cap=f.make();await cap.submitCurrentTokenFunding((await f.prepare(cap))!);
    f.clock(2000n);f.head.timestamp=2000n;f.resources.mockRejectedValue(new Error('No gas'));
    expect(await f.make({}).recoverPendingCurrentTokenFunding()).toEqual({status:'observed-mined',privateAccountingVerified:false,readyToSign:false});
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('refuses native approval above the swap input profile before estimation', async () => {
    const f = fixture(0, true, 'cheap-native'), cap = f.make();
    f.state.balance = CURRENT_NATIVE_SWAP_LIMITS.maximumInput + 1n;
    const p = await cap.prepareCurrentTokenFunding({tokenIndex: 0, action: 'approve', amount: f.state.balance, confirm: async () => true});
    await expect(cap.submitCurrentTokenFunding(p!)).rejects.toThrow('finite private funding profile');
    expect(f.transport.send).not.toHaveBeenCalled(); expect(f.transport.estimateGas).not.toHaveBeenCalled();
  });
  it('counts approval against swap signing starts and retains the recovery reserve', async () => {
    const f = fixture(0, true, 'cheap-native'), cap = f.make();
    const budget = currentNativeSigningBudget(f.signer, owner, () => 100n);
    for (let i = 0; i < 7; i++) budget.commit('token-funding', `prior:${i}`, 5_000_000n);
    await expect(cap.submitCurrentTokenFunding((await f.prepare(cap))!)).rejects.toThrow('budget');
    expect(f.transport.estimateGas).not.toHaveBeenCalled(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('retains native approval commitment after an uncertain wallet response', async () => {
    const f = fixture(0, true, 'cheap-native'), cap = f.make(); f.interrupt();
    await expect(cap.submitCurrentTokenFunding((await f.prepare(cap))!)).rejects.toThrow('Interrupted');
    expect(currentNativeSigningBudget(f.signer, owner, () => 100n).snapshot().signingStarts).toBe(1);
    expect(f.store.size).toBe(1);
  });
  it('binds the native approval profile to the accepted current-candidate recovery journal', () => {
    const raw = readFileSync(new URL('../../../ChainWhisper Contracts V2/validation/candidates/next-dex-funded-recovery-2026-10-04/native-2.jsonl', import.meta.url));
    expect(createHash('sha256').update(raw).digest('hex')).toBe('00bc2c7a58235bb9a12981305fd2ad036e3bdd53ced58cccdf1491802fa15b5e');
    const rows = raw.toString().trim().split(/\r?\n/).map(line => JSON.parse(line)).filter(r => r.name === 'approve');
    expect(rows.map(r => r.kind)).toEqual(['signing-start', 'signed', 'broadcast', 'verified']);
    expect(rows[0]).toMatchObject({gasLimit: '5000000', gasPriceWei: '50000000', manifestHash: 'ebfc7e4dac90d2e4da9d3bd6a5d594b20109b624c4febac985cfb23ae8a381fc'});
    expect(rows[2].hash).toBe('0xe0bd3144f46df2bd789dfaae5ef6ba4c394c6ae7338b33c11428a72e5662ccc3');
  });
  it('does not commit an approval whose strict native estimate is unavailable', async () => {
    const f = fixture(0, true, 'cheap-native'), cap = f.make(); f.transport.estimateGas.mockRejectedValue(new Error('No estimate'));
    await expect(cap.submitCurrentTokenFunding((await f.prepare(cap))!)).rejects.toThrow('No estimate');
    expect(currentNativeSigningBudget(f.signer, owner, () => 100n).snapshot().signingStarts).toBe(0);
    expect(f.store.size).toBe(0); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('keeps native approval pending if the final canonical check fails after private verification', async () => {
    const f = fixture(0, true, 'cheap-native'), cap = f.make();
    const sent = await cap.submitCurrentTokenFunding((await f.prepare(cap))!);
    f.transport.verifyCanonicalInclusion.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Canonical reorg'));
    await expect(sent.recover()).rejects.toThrow('Canonical reorg');
    expect(f.store.size).toBe(1); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('binds the current native faucet and both encrypted approvals to immutable public receipt records', () => {
    const dir = '../../../ChainWhisper Contracts V2/validation/candidates/direct-limit-match-2026-09-30/current-integration/current-lp-fresh-trial/';
    for (const [name, pin, hash, gas] of [
      ['faucet-refill-1.jsonl', '5c03dd82a0afda1a6d4d61915a01d9b25df541ec197a13be8779a57eb4faad5c', CURRENT_TOKEN_FUNDING_NATIVE.faucet, 713863n],
      ['native-lp-fresh-trial-2.jsonl', '93a5728efeac97ca6a3820a74c73ebbce93530e5ac77ef24f70551576a5d5740', CURRENT_TOKEN_FUNDING_NATIVE.approve[0], 460748n],
      ['native-lp27-reverse-proof-1.jsonl', 'f7bbce6a51122db3c19dd30fd6ff04984de24f6152d764f05a957396a85327e5', CURRENT_TOKEN_FUNDING_NATIVE.approve[1], 459140n]
    ] as const) {
      const raw = readFileSync(new URL(dir + name, import.meta.url)); expect(createHash('sha256').update(raw).digest('hex')).toBe(pin);
      const rows = raw.toString().trim().split(/\r?\n/).map(line => JSON.parse(line)).filter(r => r.hash === hash);
      const s = rows.filter(r => r.kind === 'signed'), r = rows.filter(r => r.kind === 'receipt'), v = rows.filter(r => r.kind === 'verified');
      expect(s).toHaveLength(1); expect(r).toHaveLength(1); expect(v).toHaveLength(1); expect(r[0].status).toBe(1); expect(BigInt(r[0].gasUsed)).toBe(gas); expect(BigInt(s[0].gasLimit)).toBe(CURRENT_TOKEN_FUNDING_CAP);
      if (name.startsWith('faucet')) expect(v[0]).toMatchObject({ exactCredit: true, allowanceUnchanged: true });
    }
    expect(c.tokens.map(([, runtime]) => runtime)).toEqual([CURRENT_TOKEN_FUNDING_NATIVE.tokenRuntime, CURRENT_TOKEN_FUNDING_NATIVE.tokenRuntime]);
  });
  it.each([0, 1] as const)('prepares, submits and proves exact faucet credit followed by finite approval on token %s', async index => {
    const f = fixture(index), cap = f.make(), p = await f.prepare(cap); expect(p!.before.balance).toBe(0n); expect(f.encrypt).not.toHaveBeenCalled();
    const sent = await cap.submitCurrentTokenFunding(p!); const result = await sent.recover();
    expect(result.balance).toBe(mint); expect(result.allowance).toBe(0n); expect(result.claimed).toBe(true); expect(f.store.size).toBe(0);
    expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({ to: c.tokens[index][0], gasLimit: 5_000_000n, nonce: 4 }), expect.any(Function));
    const approved = await cap.prepareCurrentTokenFunding({ tokenIndex: index, action: 'approve', amount: 20n, confirm: async review => { expect(review.spender.toLowerCase()).toBe(c.core); expect(review.amount).toBe(20n); return true; } });
    expect(f.encrypt).toHaveBeenCalledWith(20n, c.tokens[index][0], abi.getFunction('approve')!.selector);
    const done = await (await cap.submitCurrentTokenFunding(approved!)).recover(); expect(done.allowance).toBe(20n); expect(done.balance).toBe(mint);
    expect(f.transport.estimateGas).not.toHaveBeenCalled(); expect(f.transport.send).toHaveBeenCalledTimes(2);
    await expect(cap.submitCurrentTokenFunding(p!)).rejects.toThrow();
  });
  it('cancels before private encryption and refuses copied or wrong-owner preparations', async () => {
    const f = fixture(0, true), cap = f.make(); expect(await f.prepare(cap, async () => false)).toBeNull(); expect(f.encrypt).not.toHaveBeenCalled();
    const p = await f.prepare(cap); await expect(cap.submitCurrentTokenFunding({ ...p! })).rejects.toThrow('session'); await expect(f.make({}).submitCurrentTokenFunding(p!)).rejects.toThrow('session'); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['balance', 'allowance', 'claim', 'graph', 'nonce', 'lease', 'headroom', 'config', 'redirect'] as const)('rejects %s drift before send', async fault => {
    const f = fixture(0, true), cap = f.make(), p = await f.prepare(cap);
    if (fault === 'balance') f.state.balance++; if (fault === 'allowance') f.state.allowance++; if (fault === 'claim') f.state.claimed = true;
    if (fault === 'graph') f.attest.mockRejectedValue(new Error('Graph drift')); if (fault === 'nonce') f.resources.mockRejectedValue(new Error('Pending nonce'));
    if (fault === 'lease') f.revoke(); if (fault === 'headroom') f.head.gasLimit = 5_000_000n;
    if (fault === 'config') f.state.decimals = 6n; if (fault === 'redirect') f.state.encryptionAddress = c.core;
    await expect(cap.submitCurrentTokenFunding(p!)).rejects.toThrow(); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(['event-credit', 'wallet-credit', 'allowance', 'extra-log', 'receipt', 'reorg', 'spender'] as const)('keeps %s private/canonical failure pending, never a second spend', async fault => {
    const f = fixture(), cap = f.make(), sent = await cap.submitCurrentTokenFunding((await f.prepare(cap))!);
    if (fault === 'event-credit') f.receipt.logs[0] = { address: f.state.token, ...events.encodeEventLog(events.getEvent('Transfer')!, [zero, owner, [999n, 0n], [77n, mint - 1n]]) };
    if (fault === 'wallet-credit') f.state.balance--; if (fault === 'allowance') f.state.allowance = 1n;
    if (fault === 'extra-log') f.receipt.logs.push(f.receipt.logs[0]); if (fault === 'receipt') f.receipt.from = c.core;
    if (fault === 'reorg') f.transport.readBlockHash.mockResolvedValue(toBeHex(32n, 32)); if (fault === 'spender') f.tx().to = c.core;
    await expect(sent.recover()).rejects.toThrow(); expect(f.store.has(key)).toBe(true);
    await expect(f.prepare(cap)).rejects.toThrow('pending'); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['faucet', 'approve'] as const)('reload reconciles exact %s metadata and then permits a fresh private read, not restored authority', async action => {
    const f = fixture(1, action === 'approve'), cap = f.make(), p = await f.prepare(cap); await cap.submitCurrentTokenFunding(p!);
    const reload = f.make({}); expect(await reload.recoverPendingCurrentTokenFunding()).toEqual({ status: 'observed-mined', privateAccountingVerified: false });
    expect(f.store.size).toBe(0); expect((await reload.readCurrentTokenFunding(1)).balance).toBe(f.state.balance);
    await expect(reload.submitCurrentTokenFunding(p!)).rejects.toThrow('session');
  });
  it.each(['event', 'candidate', 'nonce', 'gas'] as const)('reload refuses wrong public %s binding and keeps the lock', async fault => {
    const f = fixture(), cap = f.make(); await cap.submitCurrentTokenFunding((await f.prepare(cap))!);
    if (fault === 'event') f.receipt.logs[1] = { address: f.state.token, ...events.encodeEventLog(events.getEvent('FaucetClaimed')!, [c.core]) };
    if (fault === 'candidate') f.store.set(key, JSON.stringify({ ...JSON.parse(f.store.get(key)!), graph: toBeHex(88n, 32) }));
    if (fault === 'nonce') f.tx().nonce = 5; if (fault === 'gas') f.tx().gasLimit = 4_000_000n;
    await expect(f.make({}).recoverPendingCurrentTokenFunding()).rejects.toThrow(); expect(f.store.has(key)).toBe(true);
  });
  it.each([false, 'true', 1, null, 'other-phase'] as const)('refuses malformed or other-phase verification marker %s', async marker => {
    const f = fixture(), cap = f.make(); await cap.submitCurrentTokenFunding((await f.prepare(cap))!);
    const record = JSON.parse(f.store.get(key)!);
    f.store.set(key, JSON.stringify({ ...record, ...(marker === 'other-phase' ? { phase: 'limit-create', verificationBlocked: true } : { verificationBlocked: marker }) }));
    expect(() => readCurrentDexPendingAttempt(window.sessionStorage)).toThrow('invalid');
    await expect(f.make({}).recoverPendingCurrentTokenFunding()).rejects.toThrow(); expect(f.store.has(key)).toBe(true);
  });
  it('unknown outcome keeps the shared nonce reserved and cannot resend', async () => {
    const f = fixture(), cap = f.make(), p = await f.prepare(cap); f.interrupt(); await expect(cap.submitCurrentTokenFunding(p!)).rejects.toThrow('Interrupted');
    expect(await cap.recoverPendingCurrentTokenFunding()).toEqual({ status: 'manual-reconciliation-required', privateAccountingVerified: false });
    await expect(cap.submitCurrentTokenFunding(p!)).rejects.toThrow('pending'); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['faucet', 'approve'] as const)('reconciles broadcast %s after a lost wallet response by exact public hash without resending', async action => {
    const f = fixture(1, action === 'approve'), cap = f.make();
    const send = f.transport.send.getMockImplementation()!;
    f.transport.send.mockImplementation(async request => { await send(request); throw new Error('Wallet response lost after broadcast'); });
    await expect(cap.submitCurrentTokenFunding((await f.prepare(cap))!)).rejects.toThrow('response lost');
    expect(JSON.parse(f.store.get(key)!).txHash).toBeNull();
    const reload = f.make({});
    expect(await reload.recoverPendingCurrentTokenFunding()).toMatchObject({ status: 'manual-reconciliation-required' });
    expect(await reload.recoverPendingCurrentTokenFunding(txHash)).toEqual({ status: 'observed-mined', privateAccountingVerified: false });
    expect(f.store.size).toBe(0); expect(f.transport.send).toHaveBeenCalledOnce();
    expect(await reload.readCurrentTokenFunding(1)).toMatchObject({ balance: f.state.balance, allowance: f.state.allowance });
  });
  it.each(['hash', 'owner', 'chain', 'nonce', 'call', 'token', 'gas', 'event', 'reorg', 'blocked', 'race', 'missing'] as const)('retains a hashless reservation after supplied-hash %s failure', async fault => {
    const f = fixture(), cap = f.make(), send = f.transport.send.getMockImplementation()!;
    f.transport.send.mockImplementation(async request => { await send(request); throw new Error('Wallet response lost'); });
    await expect(cap.submitCurrentTokenFunding((await f.prepare(cap))!)).rejects.toThrow('response lost');
    if (fault === 'owner') f.tx().from = c.core;
    if (fault === 'chain') f.tx().chainId = 1n;
    if (fault === 'nonce') f.tx().nonce = 5;
    if (fault === 'call') f.tx().data = abi.encodeFunctionData('approve', [c.core, { ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature: `0x${'33'.repeat(65)}` }]);
    if (fault === 'token') f.tx().to = c.core;
    if (fault === 'gas') f.tx().gasLimit = 4_000_000n;
    if (fault === 'event') f.receipt.logs[1] = { address: f.state.token, ...events.encodeEventLog(events.getEvent('FaucetClaimed')!, [c.core]) };
    if (fault === 'reorg') f.transport.readBlockHash.mockResolvedValue(toBeHex(32n, 32));
    if (fault === 'blocked') f.store.set(key, JSON.stringify({ ...JSON.parse(f.store.get(key)!), verificationBlocked: true }));
    if (fault === 'race') f.transport.readBlockHash.mockImplementation(async () => { f.store.set(key, JSON.stringify({ ...JSON.parse(f.store.get(key)!), nonce: 9 })); return hash; });
    if (fault === 'missing') f.transport.readTransaction.mockResolvedValue(null);
    const recovery = f.make({}).recoverPendingCurrentTokenFunding(fault === 'hash' ? toBeHex(41n, 32) : txHash);
    if (fault === 'missing') expect(await recovery).toMatchObject({ status: 'awaiting-chain-confirmation' });
    else await expect(recovery).rejects.toThrow();
    expect(f.store.has(key)).toBe(true); expect(JSON.parse(f.store.get(key)!).txHash).toBeNull();
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('does not replace an already recorded hash or accept malformed hashes', async () => {
    const f = fixture(), cap = f.make(); await cap.submitCurrentTokenFunding((await f.prepare(cap))!);
    for (const supplied of [toBeHex(41n, 32), 'invalid', toBeHex(0n, 32)]) {
      await expect(cap.recoverPendingCurrentTokenFunding(supplied)).rejects.toThrow();
      expect(JSON.parse(f.store.get(key)!).txHash).toBe(txHash);
    }
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each([1, 0])('reconciles status %s public metadata without requesting pruned receipt-block state', async status => {
    const f = fixture(), cap = f.make(), sent = await cap.submitCurrentTokenFunding((await f.prepare(cap))!);
    f.receipt.status = status;
    if (!status) { f.receipt.logs = []; f.state.balance = 0n; f.state.claimed = false; }
    f.head.number = 31n; f.head.hash = toBeHex(31n, 32);
    f.attest.mockImplementation(async block => {
      if (block.number === 30n) throw new Error('missing trie node: receipt-block state unavailable');
      expect(block).toMatchObject({ number: 31n, hash: toBeHex(31n, 32) });
    });
    // Exact same-session accounting must not substitute latest state for before/after proof.
    await expect(sent.recover()).rejects.toThrow('missing trie node');
    f.attest.mockClear();
    expect(await f.make({}).recoverPendingCurrentTokenFunding()).toEqual({
      status: status ? 'observed-mined' : 'observed-reverted', privateAccountingVerified: false });
    expect(f.attest).toHaveBeenCalledOnce(); expect(f.transport.readBlockHash).toHaveBeenCalledWith(30);
    expect(f.store.size).toBe(0); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('keeps metadata pending when current runtime admission fails even with a canonical old receipt', async () => {
    const f = fixture(), cap = f.make(); await cap.submitCurrentTokenFunding((await f.prepare(cap))!);
    f.head.number = 31n; f.attest.mockRejectedValue(new Error('Current runtime drift'));
    await expect(f.make({}).recoverPendingCurrentTokenFunding()).rejects.toThrow('Current runtime drift');
    expect(f.store.has(key)).toBe(true); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['faucet', 'approve'] as const)('reconciles proven %s rollback in the same session without replay', async action => {
    const f = fixture(0, action === 'approve'), cap = f.make(), p = (await f.prepare(cap))!;
    const sent = await cap.submitCurrentTokenFunding(p); f.receipt.status = 0; f.receipt.logs = [];
    f.state.balance = p.before.balance; f.state.allowance = p.before.allowance; f.state.claimed = p.before.claimed;
    expect(await sent.recover()).toMatchObject({ fundingOutcome: 'reverted', balance: p.before.balance, allowance: p.before.allowance });
    expect(f.store.size).toBe(0); await expect(cap.submitCurrentTokenFunding(p)).rejects.toThrow('already attempted');
    expect(await f.prepare(cap)).not.toBeNull(); expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it.each(['logs', 'state'] as const)('keeps a purported rollback with wrong %s blocked', async fault => {
    const f = fixture(), cap = f.make(), sent = await cap.submitCurrentTokenFunding((await f.prepare(cap))!);
    f.receipt.status = 0; if (fault === 'state') f.receipt.logs = [];
    await expect(sent.recover()).rejects.toThrow(); expect(f.store.has(key)).toBe(true);
  });
  it.each(['event', 'wallet', 'claimed', 'allowance'] as const)('rejects wrong approval %s accounting', async fault => {
    const f = fixture(0, true), cap = f.make(), sent = await cap.submitCurrentTokenFunding((await f.prepare(cap))!);
    if (fault === 'event') f.receipt.logs[0] = { address: f.state.token, ...events.encodeEventLog(events.getEvent('Approval')!, [owner, c.core, [77n, 21n], [999n, 20n]]) };
    if (fault === 'wallet') f.state.balance--; if (fault === 'claimed') f.state.claimed = true; if (fault === 'allowance') f.state.allowance--;
    await expect(sent.recover()).rejects.toThrow(); expect(f.store.has(key)).toBe(true);
    expect(JSON.parse(f.store.get(key)!).verificationBlocked).toBe(true);
    await expect(f.make({}).recoverPendingCurrentTokenFunding()).rejects.toThrow('Known');
    expect(f.store.has(key)).toBe(true);
  });
  it.each([0n, -1n, 1n << 256n, mint + 1n])('rejects nonfinite trial budget %s', async amount => {
    const f = fixture(); await expect(f.make().prepareCurrentTokenFunding({ tokenIndex: 0, action: 'approve', amount, confirm: async () => true })).rejects.toThrow('finite'); expect(f.encrypt).not.toHaveBeenCalled();
  });
  it('uses a sub-block diagnostic cap, not unlimited approval', () => expect(CURRENT_TOKEN_FUNDING_CAP).toBe(5_000_000n));
});
