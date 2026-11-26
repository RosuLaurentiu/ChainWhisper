import { Interface, keccak256, toBeHex } from '@coti-io/coti-ethers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CURRENT_NATIVE_TOKEN_REFILL_BINDING } from './currentDexNativeTokenRefillDeployment';
import { createCurrentTokenRefillSubmissionAdapter } from './currentDexTokenRefillSubmission';
import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { CURRENT_TOKEN_REFILL_AMOUNT as amount, CURRENT_TOKEN_REFILL_QUOTA as quota, currentTokenRefillAbi as abi } from './currentDexTokenRefill';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY as key, readCurrentDexPendingAttempt, reserveCurrentDexPendingAttempt, blockCurrentTokenFundingVerification } from './currentDexPendingAttempt';
const owner = `0x${'22'.repeat(20)}`, vault = `0x${'33'.repeat(20)}`, zero = `0x${'00'.repeat(20)}`, hash = toBeHex(30n, 32), txHash = toBeHex(40n, 32);
const producer = new Interface(['event Claimed(address indexed token,address indexed account)', 'event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
function fixture(candidate: CurrentCheapDexCandidateKey = 'cheap-history', nativeBinding = false) {
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
  const resources = vi.fn(async () => {}), attest = vi.fn(async () => {}), signer={};
  let clock: bigint | undefined;
  const make = () => createCurrentTokenRefillSubmissionAdapter({ candidate, signer, ownerAddress: owner, chainId: 7082400n, transport, binding, readState: async (i, block) => ({ ...states[i], block }), rpc,
    readReceiptBlock: async () => head, attest, assertResources: resources, decrypt: x => { if (BigInt(x.ciphertextHigh) !== 77n) throw new Error('Wrong receiver cipher'); return BigInt(x.ciphertextLow); }, now: () => clock ?? head.timestamp });
  const cap = make(), prepare = (index: 0 | 1 = 0) => cap.prepareCurrentTokenRefill({ tokenIndex: index, confirm: async () => true });
  return { cap, prepare, make, signer, states, limits, receipt, head, binding, store, storage, transport, rpc, resources, clock: (value: bigint) => {clock=value;}, revoke: () => { active = false; }, unknown: () => { unknown = true; } };
}
afterEach(() => vi.unstubAllGlobals());
describe('finite current token refill submission', () => {
  it('holds current refill admission before any estimate, nonce or send', async () => {
    const f = fixture(), p = await f.prepare(); await expect(f.cap.submitCurrentTokenRefill(p!)).rejects.toThrow('admission is absent');
    expect(f.transport.send).not.toHaveBeenCalled(); expect(f.transport.readNonce).not.toHaveBeenCalled();
  });
  it.each(['claim', 'expiry', 'quota', 'cooldown'] as const)('rejects unavailable %s', async cause => {
    const f = fixture(); if (cause === 'claim') f.states[0].claimed = false; if (cause === 'expiry') f.head.timestamp = 200_000n; if (cause === 'quota') f.limits[0].quota = 0n; if (cause === 'cooldown') f.limits[0].next = 101n;
    await expect(f.prepare()).rejects.toThrow('available'); expect(f.transport.send).not.toHaveBeenCalled();
  });
  it('does not prepare without confirmed review', async () => { const f = fixture(); expect(await f.cap.prepareCurrentTokenRefill({ tokenIndex: 0, confirm: async () => false })).toBe(null); expect(f.store.size).toBe(0); });
  it('rejects state changed during confirmed review', async () => { const f = fixture(); await expect(f.cap.prepareCurrentTokenRefill({ tokenIndex: 0, confirm: async () => { f.states[1].balance++; return true; } })).rejects.toThrow('during review'); });
});
describe('token-refill pending schema extension', () => {
  it.each(['token-faucet', 'token-approve', 'token-refill'] as const)('retains version 1 and supports blocked %s records', phase => {
    const f = fixture(), p = { version: 1 as const, chainId: '7082400', owner, core: owner, graph: hash, phase, callHash: hash, nonce: 4, txHash: null };
    reserveCurrentDexPendingAttempt(f.storage, p); blockCurrentTokenFundingVerification(f.storage, p); expect(readCurrentDexPendingAttempt(f.storage)).toEqual({ ...p, verificationBlocked: true });
  });
  it('preserves malformed and unknown records instead of deleting them', () => { const f = fixture(); const raw = JSON.stringify({ version: 1, phase: 'token-refill', verificationBlocked: false }); f.store.set(key, raw); expect(() => readCurrentDexPendingAttempt(f.storage)).toThrow('invalid'); expect(f.store.get(key)).toBe(raw); });
});





