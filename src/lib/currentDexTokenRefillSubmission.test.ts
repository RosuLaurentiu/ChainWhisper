import { Interface, keccak256, toBeHex } from '@coti-io/coti-ethers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CURRENT_NATIVE_TOKEN_REFILL_BINDING, assertCurrentNativeTokenRefillBinding } from './currentDexNativeTokenRefillDeployment';
import { currentNativeSigningBudget } from './currentDexNativeSwapPolicy';
import { createCurrentTokenRefillSubmissionAdapter } from './currentDexTokenRefillSubmission';
import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { CURRENT_TOKEN_REFILL_AMOUNT as amount, CURRENT_TOKEN_REFILL_QUOTA as quota, currentTokenRefillAbi as abi } from './currentDexTokenRefill';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY as key, readCurrentDexPendingAttempt, reserveCurrentDexPendingAttempt, blockCurrentTokenFundingVerification } from './currentDexPendingAttempt';
const owner = `0x${'22'.repeat(20)}`, vault = `0x${'33'.repeat(20)}`, zero = `0x${'00'.repeat(20)}`, hash = toBeHex(30n, 32), txHash = toBeHex(40n, 32);
const producer = new Interface(['event Claimed(address indexed token,address indexed account)', 'event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
// Preserve the archived refill-adapter cases under their original admission. This does not admit native refill sends.
vi.mock('./dexV2Deployment', async original => {
  const actual = await original<typeof import('./dexV2Deployment')>();
  return { ...actual, resolveCurrentCheapDexCandidate: (key: CurrentCheapDexCandidateKey) =>
    actual.resolveCurrentCheapDexCandidate(key === 'cheap-current' ? 'cheap-archived' : key),
    assertCurrentCheapDexNativeAdmission: (c: typeof actual.ARCHIVED_CHEAP_DEX_CANDIDATE) => {
      const archived = actual.ARCHIVED_CHEAP_DEX_CANDIDATE;
      if (actual.currentCheapDexStages(c).workCalls === 4) throw new Error('Successor DEX native App submission admission is absent.');
      if (c.graph !== archived.graph || c.packageSha256 !== archived.packageSha256 || c.core.toLowerCase() !== archived.core)
        throw new Error('Staged DEX native App submission admission is absent.');
    } };
});
function fixture(candidate: CurrentCheapDexCandidateKey = 'cheap-current', nativeBinding = false) {
  const c = resolveCurrentCheapDexCandidate(candidate), store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  vi.stubGlobal('window', { sessionStorage: storage });
  const head = { number: 30n, hash, timestamp: 100n, gasLimit: 120_000_000n };
  const binding = nativeBinding ? { ...CURRENT_NATIVE_TOKEN_REFILL_BINDING } : { address: vault, runtimeHash: keccak256('0x6000'), recovery: owner, expiresAt: 200_000n };
  const at = binding.address;
  let runtime = '0x6000';
  if (nativeBinding) {
    const artifact = JSON.parse(readFileSync(new URL('../../../ChainWhisper Contracts V2/validation/candidates/private-token-refill-2026-10-04/artifacts.json', import.meta.url),'utf8')).production.evm.deployedBytecode;
    const ids = Object.keys(artifact.immutableReferences);
    const choices = [toBeHex(binding.expiresAt,32).slice(2), toBeHex(BigInt(binding.recovery),32).slice(2)];
    for (const values of [choices, [...choices].reverse()]) {
      let code = artifact.object;
      ids.forEach((id,i) => artifact.immutableReferences[id].forEach((r: { start: number; length: number }) => { expect(r.length).toBe(32); code=code.slice(0,r.start*2)+values[i]+code.slice((r.start+r.length)*2); }));
      if (keccak256(`0x${code}`)===binding.runtimeHash) runtime=`0x${code}`;
    }
    expect(keccak256(runtime)).toBe(binding.runtimeHash);
  }
  const states = ([0, 1] as const).map(index => ({ tokenIndex: index, token: c.tokens[index][0], owner, balance: 8n, allowance: 2n, claimed: true, faucetAmount: 10_000n * 10n ** 18n, decimals: 18n, publicAmounts: false, encryptionAddress: zero, block: head }));
  const limits = [{ quota, next: 0n }, { quota, next: 0n }];
  let active = true, unknown = false;
  type Tx = Awaited<ReturnType<Parameters<typeof createCurrentTokenRefillSubmissionAdapter>[0]['transport']['readTransaction']>>;
  let tx: Tx = null;
  const receipt = { hash: txHash, from: owner, to: at, status: 1, blockNumber: 30, blockHash: hash, logs: [] as { address: string; topics: string[]; data: string }[] };
  const guard = vi.fn(async () => { if (!active) throw new Error('Session revoked'); });
  const transport = { assertCurrent: guard, readHead: async () => head, readNonce: vi.fn(async () => 4), readBlockHash: vi.fn(async () => hash),
    readNativeResources: vi.fn(async () => ({owner, chainId: 7082400n, head, latestNonce:4, pendingNonce:4, baseFeePerGas:1n, gasPrice:50_000_000n, code:'0x', balance:10n**18n})),
    verifyCanonicalInclusion: vi.fn(async () => {}),
    estimateGas: vi.fn(async () => 1_000_000n), readTransaction: vi.fn(async () => tx), waitForReceipt: vi.fn(async () => receipt),
    send: vi.fn(async request => {
      if (unknown) throw new Error('Unknown wallet result');
      tx = { ...request, hash: txHash, blockNumber: 30, blockHash: hash };
      const index = c.tokens.findIndex(([token]) => token.toLowerCase() === String(abi.decodeFunctionData('claim', request.data)[0]).toLowerCase());
      if (receipt.status === 1) {
        states[index].balance += amount; limits[index].quota -= amount; limits[index].next = head.timestamp + 86_400n;
        receipt.logs = [{ address: c.tokens[index][0], ...producer.encodeEventLog(producer.getEvent('Transfer')!, [at, owner, [999n, 0n], [77n, amount]]) },
          { address: at, ...producer.encodeEventLog(producer.getEvent('Claimed')!, [c.tokens[index][0], owner]) }];
      }
      return { ...request, hash: txHash };
    }) } satisfies Parameters<typeof createCurrentTokenRefillSubmissionAdapter>[0]['transport'];
  const rpc = vi.fn(async (method: string, params: unknown[]) => {
    if (method === 'eth_getCode') return runtime;
    const call = params[0] as { data: string }, decoded = abi.parseTransaction({ data: call.data })!;
    const index = decoded.args.length > 0 ? c.tokens.findIndex(([t]) => t.toLowerCase() === String(decoded.args[0]).toLowerCase()) : 0;
    const values: Record<string, unknown> = { CHAIN_ID: 7082400n, TOKEN_A: c.tokens[0][0], TOKEN_B: c.tokens[1][0], TOKEN_RUNTIME: c.tokens[0][1], CLAIM_AMOUNT: amount, INITIAL_QUOTA: quota, COOLDOWN: 86_400n, expiresAt: binding.expiresAt, recovery: binding.recovery,
      remainingQuota: limits[index].quota, nextClaimAt: limits[index].next };
    return abi.encodeFunctionResult(decoded.name, [values[decoded.name]]);
  });
  const resources = vi.fn(async () => {}), admission = vi.fn(async () => { if(nativeBinding)assertCurrentNativeTokenRefillBinding(candidate,binding); }), attest = vi.fn(async () => {}), signer={};
  let clock: bigint | undefined;
  const make = () => createCurrentTokenRefillSubmissionAdapter({ candidate, signer, ownerAddress: owner, chainId: 7082400n, transport, binding, assertRefillAdmission: admission, readState: async (i, block) => ({ ...states[i], block }), rpc,
    readReceiptBlock: async () => head, attest, assertResources: resources, decrypt: x => { if (BigInt(x.ciphertextHigh) !== 77n) throw new Error('Wrong receiver cipher'); return BigInt(x.ciphertextLow); }, now: () => clock ?? head.timestamp });
  const cap = make(), prepare = (index: 0 | 1 = 0) => cap.prepareCurrentTokenRefill({ tokenIndex: index, confirm: async () => true });
  return { cap, prepare, make, signer, states, limits, receipt, head, binding, store, storage, transport, rpc, resources, admission, clock: (value: bigint) => {clock=value;}, revoke: () => { active = false; }, unknown: () => { unknown = true; } };
}
afterEach(() => vi.unstubAllGlobals());
describe('finite current token refill submission', () => {
  it.each([0,1] as const)('uses exact native registry/deployed runtime for refill and same signer budget: %s',async i=>{
    const actual=await vi.importActual<typeof import('./dexV2Deployment')>('./dexV2Deployment');
    expect(()=>actual.assertCurrentCheapDexNativeAdmission(actual.STAGED_NATIVE_DEX_CANDIDATE)).toThrow();
    const f=fixture('cheap-native',true),p=(await f.prepare(i))!,sent=await f.cap.submitCurrentTokenRefill(p);
    expect(p.graph).toBe(actual.STAGED_NATIVE_DEX_CANDIDATE.graph);
    expect(await sent.recover()).toEqual({refillOutcome:'verified',privateAccountingVerified:true});
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalled();
    expect(currentNativeSigningBudget(f.signer,owner,()=>100n).snapshot()).toMatchObject({signingStarts:1,committedWei:250_000_000_000_000n});
  });
  it('retains native budget commitment/hashless lock after unknown signature',async()=>{
    const f=fixture('cheap-native',true),p=(await f.prepare())!;f.unknown();
    await expect(f.cap.submitCurrentTokenRefill(p)).rejects.toThrow('Unknown');
    expect(currentNativeSigningBudget(f.signer,owner,()=>100n).snapshot().signingStarts).toBe(1);
    await expect(f.cap.submitCurrentTokenRefill(p)).rejects.toThrow('pending');expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('blocks native budget exhaustion before estimation',async()=>{
    const f=fixture('cheap-native',true),p=(await f.prepare())!,budget=currentNativeSigningBudget(f.signer,owner,()=>100n);
    for(let i=0;i<7;i++)budget.commit('token-funding',`prior:${i}`,5_000_000n);
    await expect(f.cap.submitCurrentTokenRefill(p)).rejects.toThrow('budget');expect(f.transport.estimateGas).not.toHaveBeenCalled();
  });
  it('native known receipt recovers after budget/claim expiry without gas or send authority',async()=>{
    const f=fixture('cheap-native',true),p=(await f.prepare())!,sent=await f.cap.submitCurrentTokenRefill(p);
    f.clock(f.binding.expiresAt+1n);f.resources.mockRejectedValue(new Error('No gas'));f.admission.mockRejectedValue(new Error('held'));
    expect(await sent.recover()).toMatchObject({refillOutcome:'verified'});expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('native strict estimate25percent plus1M rejects without commitment',async()=>{
    const f=fixture('cheap-native',true),p=(await f.prepare())!;f.transport.estimateGas.mockResolvedValue(3_300_000n);
    await expect(f.cap.submitCurrentTokenRefill(p)).rejects.toThrow('headroom');expect(currentNativeSigningBudget(f.signer,owner,()=>100n).snapshot().signingStarts).toBe(0);
  });
  it.each(['claim','expiry','quota','cooldown'] as const)('native unavailable %s never estimates or sends',async cause=>{
    const f=fixture('cheap-native',true);if(cause==='claim')f.states[0].claimed=false;if(cause==='expiry')f.head.timestamp=f.binding.expiresAt;if(cause==='quota')f.limits[0].quota=0n;if(cause==='cooldown')f.limits[0].next=101n;
    await expect(f.prepare()).rejects.toThrow('available');expect(f.transport.estimateGas).not.toHaveBeenCalled();expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('native injected admission revoked during estimate cannot sign',async()=>{
    const f=fixture('cheap-native',true),p=(await f.prepare())!;
    f.transport.estimateGas.mockImplementation(async()=>{f.admission.mockRejectedValue(new Error('Revoked'));return 1_000_000n;});
    await expect(f.cap.submitCurrentTokenRefill(p)).rejects.toThrow('Revoked');expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('native status0 proves rollback and retains spent attempt budget',async()=>{
    const f=fixture('cheap-native',true),p=(await f.prepare())!;f.receipt.status=0;
    const sent=await f.cap.submitCurrentTokenRefill(p);expect(await sent.recover()).toMatchObject({refillOutcome:'reverted'});
    expect(currentNativeSigningBudget(f.signer,owner,()=>100n).snapshot().signingStarts).toBe(1);
  });
  it('blocks mutable original receipt after native canonical inclusion',async()=>{
    const f=fixture('cheap-native',true),p=(await f.prepare())!,sent=await f.cap.submitCurrentTokenRefill(p);
    f.transport.verifyCanonicalInclusion.mockImplementation(async()=>{f.receipt.status=0;f.receipt.logs=[];});
    await expect(sent.recover()).rejects.toThrow('receipt changed');expect(readCurrentDexPendingAttempt(f.storage)?.verificationBlocked).toBe(true);
  });
  it('native private failure remains permanently locked against metadata recovery',async()=>{
    const f=fixture('cheap-native',true),p=(await f.prepare())!,sent=await f.cap.submitCurrentTokenRefill(p);f.states[1].balance++;
    await expect(sent.recover()).rejects.toThrow('accounting');await expect(f.make().recoverPendingCurrentTokenRefill()).rejects.toThrow('Known');
    expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('native metadata recovery after expiry proves only metadata with no restored authority',async()=>{
    const f=fixture('cheap-native',true),p=(await f.prepare())!;await f.cap.submitCurrentTokenRefill(p);f.clock(f.binding.expiresAt+1n);
    f.resources.mockRejectedValue(new Error('No gas'));f.admission.mockRejectedValue(new Error('held'));
    expect(await f.make().recoverPendingCurrentTokenRefill()).toEqual({status:'observed-mined',privateAccountingVerified:false,readyToSign:false});expect(f.transport.send).toHaveBeenCalledOnce();
  });
  it('native canonical inclusion failure remains blocked',async()=>{
    const f=fixture('cheap-native',true),p=(await f.prepare())!,sent=await f.cap.submitCurrentTokenRefill(p);
    f.transport.verifyCanonicalInclusion.mockRejectedValue(new Error('Current DEX canonical transaction inclusion changed. Do not resend.'));
    await expect(sent.recover()).rejects.toThrow('inclusion');expect(readCurrentDexPendingAttempt(f.storage)?.verificationBlocked).toBe(true);
  });
  it.each(['nonce','fee','reserve'] as const)('native resource %s drift cannot consume an attempt',async defect=>{
    const f=fixture('cheap-native',true),p=(await f.prepare())!,read=f.transport.readNativeResources.getMockImplementation()!;
    f.transport.readNativeResources.mockImplementation(async()=>{const r=await read();return{...r,...(defect==='nonce'?{pendingNonce:5}:defect==='fee'?{baseFeePerGas:50_000_001n}:{balance:0n})};});
    await expect(f.cap.submitCurrentTokenRefill(p)).rejects.toThrow('resources');expect(f.transport.send).not.toHaveBeenCalled();
    expect(currentNativeSigningBudget(f.signer,owner,()=>100n).snapshot().signingStarts).toBe(0);
  });
  it.each(['nonce','pending','lease'] as const)('async final admission %s drift prevents reservation and signing',async defect=>{
    const f=fixture('cheap-native',true),p=(await f.prepare())!;
    f.admission.mockImplementation(async()=>{
      assertCurrentNativeTokenRefillBinding('cheap-native',f.binding);
      if(f.transport.readNativeResources.mock.calls.length<2)return;
      await Promise.resolve();
      if(defect==='nonce')f.transport.readNonce.mockResolvedValue(5);
      if(defect==='lease')f.revoke();
      if(defect==='pending')reserveCurrentDexPendingAttempt(f.storage,{version:1,chainId:'7082400',owner,core:resolveCurrentCheapDexCandidate('cheap-native').core,graph:`0x${p.graph}`,phase:'token-approve',nonce:4,callHash:toBeHex(99n,32),txHash:null});
    });
    await expect(f.cap.submitCurrentTokenRefill(p)).rejects.toThrow();expect(f.transport.send).not.toHaveBeenCalled();
    if(defect==='pending')expect(readCurrentDexPendingAttempt(f.storage)?.phase).toBe('token-approve');else expect(f.store.size).toBe(0);
    expect(currentNativeSigningBudget(f.signer,owner,()=>100n).snapshot().signingStarts).toBe(1);
  });
  it.each([0, 1] as const)('proves exact private credit, quota, cooldown and unchanged other token/allowances: %s', async i => {
    const f = fixture(), p = await f.prepare(i), sent = await f.cap.submitCurrentTokenRefill(p!);
    expect(await sent.recover()).toEqual({ refillOutcome: 'verified', privateAccountingVerified: true });
    expect(f.transport.estimateGas).toHaveBeenCalled(); expect(f.transport.send).toHaveBeenCalledTimes(1);
    expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({ to: vault, gasLimit: 5_000_000n, nonce: 4 }), expect.any(Function));
    expect(f.states[i].balance).toBe(8n + amount); expect(f.states[1-i].balance).toBe(8n); expect(f.store.size).toBe(0);
  });
  it('holds successor native admission before any estimate, nonce or send', async () => {
    const f = fixture('cheap-native'), p = await f.prepare(); await expect(f.cap.submitCurrentTokenRefill(p!)).rejects.toThrow('admission');
    expect(f.transport.send).not.toHaveBeenCalled(); expect(f.transport.readNonce).not.toHaveBeenCalled();
  });
  it('requires the injected refill admission', async () => { const f = fixture(), p = await f.prepare(); f.admission.mockRejectedValue(new Error('Held')); await expect(f.cap.submitCurrentTokenRefill(p!)).rejects.toThrow('Held'); expect(f.transport.send).not.toHaveBeenCalled(); });
  it.each(['claim', 'expiry', 'quota', 'cooldown'] as const)('rejects unavailable %s', async cause => {
    const f = fixture(); if (cause === 'claim') f.states[0].claimed = false; if (cause === 'expiry') f.head.timestamp = 200_000n; if (cause === 'quota') f.limits[0].quota = 0n; if (cause === 'cooldown') f.limits[0].next = 101n;
    await expect(f.prepare()).rejects.toThrow('available'); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('rejects estimate without required margin before reserving or sending', async () => { const f = fixture(), p = await f.prepare(); f.transport.estimateGas.mockResolvedValue(4_500_000n); await expect(f.cap.submitCurrentTokenRefill(p!)).rejects.toThrow('headroom'); expect(f.store.size).toBe(0); expect(f.transport.send).not.toHaveBeenCalled(); });
  it('rejects changed private state and a different adapter session', async () => { const f = fixture(), p = await f.prepare(); await expect(f.make().submitCurrentTokenRefill(p!)).rejects.toThrow('session'); f.states[1].allowance++; await expect(f.cap.submitCurrentTokenRefill(p!)).rejects.toThrow('state changed'); });
  it('proves status zero rollback with no events', async () => { const f = fixture(), p = await f.prepare(); f.receipt.status = 0; const sent = await f.cap.submitCurrentTokenRefill(p!); expect(await sent.recover()).toEqual({ refillOutcome: 'reverted', privateAccountingVerified: true }); expect(f.store.size).toBe(0); });
  it.each(['credit', 'event', 'extra', 'quota', 'cooldown', 'allowance', 'other'] as const)('blocks known %s verification failure', async defect => {
    const f = fixture(), p = await f.prepare(), sent = await f.cap.submitCurrentTokenRefill(p!);
    if (defect === 'credit') f.states[0].balance++; if (defect === 'event') f.receipt.logs[1].address = owner; if (defect === 'extra') f.receipt.logs.push(f.receipt.logs[0]);
    if (defect === 'quota') f.limits[0].quota -= amount; if (defect === 'cooldown') f.limits[0].next++; if (defect === 'allowance') f.states[0].allowance++; if (defect === 'other') f.states[1].balance++;
    await expect(sent.recover()).rejects.toThrow(); expect(readCurrentDexPendingAttempt(f.storage)?.verificationBlocked).toBe(true); await expect(sent.recover()).rejects.toThrow('Known'); expect(f.transport.send).toHaveBeenCalledTimes(1);
  });
  it('retains an unknown wallet result and forbids duplicate sends', async () => { const f = fixture(), p = await f.prepare(); f.unknown(); await expect(f.cap.submitCurrentTokenRefill(p!)).rejects.toThrow('Unknown'); expect(readCurrentDexPendingAttempt(f.storage)?.txHash).toBe(null); await expect(f.cap.submitCurrentTokenRefill(p!)).rejects.toThrow('pending'); expect(await f.cap.recoverPendingCurrentTokenRefill()).toEqual({ status: 'manual-reconciliation-required', privateAccountingVerified: false }); });
  it('reports metadata recovery without claiming private accounting or resending', async () => { const f = fixture(), p = await f.prepare(); await f.cap.submitCurrentTokenRefill(p!); expect(await f.make().recoverPendingCurrentTokenRefill()).toEqual({ status: 'observed-mined', privateAccountingVerified: false }); expect(f.transport.send).toHaveBeenCalledTimes(1); });
  it('does not prepare without confirmed review', async () => { const f = fixture(); expect(await f.cap.prepareCurrentTokenRefill({ tokenIndex: 0, confirm: async () => false })).toBe(null); expect(f.store.size).toBe(0); });
  it('rejects state changed during confirmed review', async () => { const f = fixture(); await expect(f.cap.prepareCurrentTokenRefill({ tokenIndex: 0, confirm: async () => { f.states[1].balance++; return true; } })).rejects.toThrow('during review'); });
  it('does not sign with failed resources', async () => { const f = fixture(), p = await f.prepare(); f.resources.mockRejectedValue(new Error('No gas')); await expect(f.cap.submitCurrentTokenRefill(p!)).rejects.toThrow('No gas'); expect(f.transport.send).not.toHaveBeenCalled(); });
  it('blocks status zero with changed state', async () => { const f = fixture(), p = await f.prepare(); f.receipt.status = 0; const sent = await f.cap.submitCurrentTokenRefill(p!); f.states[0].balance++; await expect(sent.recover()).rejects.toThrow('roll back'); expect(readCurrentDexPendingAttempt(f.storage)?.verificationBlocked).toBe(true); });
  it('blocks a malformed event instead of clearing pending', async () => { const f = fixture(), p = await f.prepare(), sent = await f.cap.submitCurrentTokenRefill(p!); f.receipt.logs[0].data = '0x'; await expect(sent.recover()).rejects.toThrow('proof failed'); expect(readCurrentDexPendingAttempt(f.storage)?.verificationBlocked).toBe(true); });
  it('blocks a known transaction mutation', async () => { const f = fixture(), p = await f.prepare(), sent = await f.cap.submitCurrentTokenRefill(p!); const tx = await f.transport.readTransaction(); f.transport.readTransaction.mockResolvedValue({ ...tx!, to: owner }); await expect(sent.recover()).rejects.toThrow('transaction differs'); expect(readCurrentDexPendingAttempt(f.storage)?.verificationBlocked).toBe(true); });
  it('holds a stale or replaced source before signing', async () => { const f = fixture(), p = await f.prepare(); f.rpc.mockImplementation(async () => '0x6001'); await expect(f.cap.submitCurrentTokenRefill(p!)).rejects.toThrow('runtime changed'); expect(f.transport.send).not.toHaveBeenCalled(); });
  it('rejects a supplied hash that differs from the saved attempt', async () => { const f = fixture(), p = await f.prepare(); await f.cap.submitCurrentTokenRefill(p!); await expect(f.cap.recoverPendingCurrentTokenRefill(toBeHex(99n,32))).rejects.toThrow('hash'); expect(f.store.size).toBe(1); });
  it('rechecks refill admission after strict estimate before signing', async () => {
    const f = fixture(), p = await f.prepare();
    f.transport.estimateGas.mockImplementation(async () => { f.admission.mockRejectedValue(new Error('Revoked gate')); return 1_000_000n; });
    await expect(f.cap.submitCurrentTokenRefill(p!)).rejects.toThrow('Revoked gate'); expect(f.transport.send).not.toHaveBeenCalled(); expect(f.store.size).toBe(0);
  });
  it('recovers with low gas after a send without a resource or admission gate', async () => {
    const f = fixture(), p = await f.prepare(), sent = await f.cap.submitCurrentTokenRefill(p!);
    f.resources.mockRejectedValue(new Error('No gas')); f.admission.mockRejectedValue(new Error('held'));
    expect(await sent.recover()).toMatchObject({ refillOutcome: 'verified' });
  });
  it('uses the actual receipt timestamp for cooldown instead of review time', async () => {
    const f = fixture(), p = await f.prepare(), sent = await f.cap.submitCurrentTokenRefill(p!);
    f.head.timestamp = 110n; f.limits[0].next = 110n + 86_400n;
    expect(await sent.recover()).toMatchObject({ refillOutcome: 'verified' });
  });
  it('retains an RPC failure without marking known accounting failure', async () => {
    const f = fixture(), p = await f.prepare(), sent = await f.cap.submitCurrentTokenRefill(p!);
    f.rpc.mockRejectedValueOnce(new Error('RPC unavailable'));
    await expect(sent.recover()).rejects.toThrow('RPC unavailable');
    expect(readCurrentDexPendingAttempt(f.storage)?.verificationBlocked).toBeUndefined();
    expect(f.transport.send).toHaveBeenCalledTimes(1);
  });
  it('blocks a canonical block change after private proof', async () => {
    const f = fixture(), p = await f.prepare(), sent = await f.cap.submitCurrentTokenRefill(p!);
    f.transport.readBlockHash.mockResolvedValueOnce(hash).mockResolvedValueOnce(hash).mockResolvedValueOnce(hash).mockResolvedValueOnce(toBeHex(99n, 32));
    await expect(sent.recover()).rejects.toThrow('block changed');
    expect(readCurrentDexPendingAttempt(f.storage)?.verificationBlocked).toBe(true);
  });
  it('blocks a changed receipt after private proof', async () => {
    const f = fixture(), p = await f.prepare(), sent = await f.cap.submitCurrentTokenRefill(p!);
    f.transport.waitForReceipt.mockResolvedValueOnce({ ...f.receipt }).mockResolvedValueOnce({ ...f.receipt }).mockResolvedValueOnce({ ...f.receipt, status: 0 });
    await expect(sent.recover()).rejects.toThrow('receipt changed');
    expect(readCurrentDexPendingAttempt(f.storage)?.verificationBlocked).toBe(true);
  });
  it('recovers a supplied known hash from the saved unknown-hash attempt without resending', async () => {
    const f = fixture(), p = await f.prepare(); await f.cap.submitCurrentTokenRefill(p!);
    const pending = readCurrentDexPendingAttempt(f.storage)!; f.store.set(key, JSON.stringify({ ...pending, txHash: null }));
    expect(await f.cap.recoverPendingCurrentTokenRefill(txHash)).toEqual({ status: 'observed-mined', privateAccountingVerified: false });
    expect(f.store.size).toBe(0); expect(f.transport.send).toHaveBeenCalledTimes(1);
  });
  it('permits receipt-only recovery after expiry', async () => {
    const f = fixture(), p = await f.prepare(), sent = await f.cap.submitCurrentTokenRefill(p!);
    f.binding.expiresAt = 200_000n;
    // Wall clock may pass expiry. The mined receipt remains at timestamp 100.
    const expired = createCurrentTokenRefillSubmissionAdapter({ candidate: 'cheap-current', signer: {}, ownerAddress: owner, chainId: 7082400n,
      transport: f.transport, binding: f.binding, assertRefillAdmission: async () => { throw new Error('held'); }, readState: async (i, block) => ({ ...f.states[i], block }),
      rpc: f.rpc, readReceiptBlock: async () => f.head, attest: async () => {}, assertResources: async () => {}, decrypt: x => BigInt(x.ciphertextLow), now: () => 200_001n });
    expect(await expired.recoverPendingCurrentTokenRefill(sent.transactionHash)).toMatchObject({ status: 'observed-mined', privateAccountingVerified: false });
  });
  it('does not clear a missing receipt or revoked session', async () => { const f = fixture(), p = await f.prepare(), sent = await f.cap.submitCurrentTokenRefill(p!); f.transport.waitForReceipt.mockResolvedValueOnce(null as never); await expect(sent.recover()).rejects.toThrow(); expect(f.store.size).toBe(1); f.revoke(); await expect(sent.recover()).rejects.toThrow('revoked'); expect(f.store.size).toBe(1); });
});
describe('token-refill pending schema extension', () => {
  it.each(['token-faucet', 'token-approve', 'token-refill'] as const)('retains version 1 and supports blocked %s records', phase => {
    const f = fixture(), p = { version: 1 as const, chainId: '7082400', owner, core: owner, graph: hash, phase, callHash: hash, nonce: 4, txHash: null };
    reserveCurrentDexPendingAttempt(f.storage, p); blockCurrentTokenFundingVerification(f.storage, p); expect(readCurrentDexPendingAttempt(f.storage)).toEqual({ ...p, verificationBlocked: true });
  });
  it('preserves malformed and unknown records instead of deleting them', () => { const f = fixture(); const raw = JSON.stringify({ version: 1, phase: 'token-refill', verificationBlocked: false }); f.store.set(key, raw); expect(() => readCurrentDexPendingAttempt(f.storage)).toThrow('invalid'); expect(f.store.get(key)).toBe(raw); });
});





