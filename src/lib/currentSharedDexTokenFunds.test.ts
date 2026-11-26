import { readFileSync } from 'node:fs';
import { AbiCoder, Interface, keccak256 } from '@coti-io/coti-ethers';
import { decodeUint, encodeKey, encrypt } from '@coti-io/coti-sdk-typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_SHARED_DEX_TOKENS as tokens, CURRENT_SHARED_TOKEN_DISTRIBUTION as p, readCurrentSharedDexTokenDistribution, resolveCurrentSharedTokenDistribution,
  currentSharedDistributionCoreAbi, currentSharedDistributionTokenAbi } from './currentSharedDexTokenDistribution';
import type { CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { CURRENT_SHARED_TOKEN_FUNDS_LAYOUT as layout, currentSharedTokenFundsAbi as abi, readCurrentSharedDexTokenFunds, readCurrentSharedDexSwapFunds } from './currentSharedDexTokenFunds';
import { decryptPrivateUint256Output } from './privateUint256';
vi.mock('./currentSharedDexTokenDistribution', async original => ({ ...await original<typeof import('./currentSharedDexTokenDistribution')>(), readCurrentSharedDexTokenDistribution: vi.fn() }));
const key = '000102030405060708090a0b0c0d0e0f', owner = '0x1111111111111111111111111111111111111111';
const head = { number: 9951288n, hash: `0x${'44'.repeat(32)}`, timestamp: 1791340000n }, zero = `0x${'00'.repeat(20)}`;
const cipherWord = (value: bigint) => {
  const bytes = new Uint8Array(16);
  for (let i = 15; i >= 0; i--) { bytes[i] = Number(value & 255n); value >>= 8n; }
  const sealed = encrypt(encodeKey(key), bytes); return decodeUint(new Uint8Array([...sealed.ciphertext, ...sealed.r]));
};
const encrypted = (value: bigint) => ({ ciphertextHigh: cipherWord(value >> 128n), ciphertextLow: cipherWord(value & ((1n << 128n) - 1n)) });
const empty = () => ({ ciphertextHigh: 0n, ciphertextLow: 0n });
const snapshot = () => ({ owner, head, core: p.core, graph: p.graph, packageSha256: p.packageSha256, vault: p.vault, readyToSign: false as const,
  tokens: tokens.map(t => ({ ...t, claimed: true, initialClaimAvailability: 'claimed' as const, refillAvailability: 'ready' as const,
    quota: p.initialQuota, nextClaimAt: 0n, initialAmount: p.initialAmount, refillAmount: p.refillAmount })) });
function fixture(candidate: CurrentCheapDexCandidateKey = 'cheap-history') {
  const p = resolveCurrentSharedTokenDistribution(candidate);
  let active = true, code = '0x', recipient = zero, suffix = '', lastHash = head.hash, storageWord = `0x${'00'.repeat(32)}`;
  const balances = [0n, 11_000_000000n, (1n << 192n) + 7n, (1n << 256n) - 1n];
  const allowances = [0n, 100_000000n, 0n, (1n << 128n) + 1n];
  const viewer = balances.map(encrypted), approvals = allowances.map(encrypted);
  const decrypt = vi.fn((cipher: Parameters<typeof decryptPrivateUint256Output>[1]) => decryptPrivateUint256Output({ getUserOnboardInfo: () => ({ aesKey: key }) } as never, cipher));
  const assertCurrent = async () => { if (!active) throw new Error('Scope revoked'); };
  vi.mocked(readCurrentSharedDexTokenDistribution).mockResolvedValue({ ...snapshot(), core: p.core, graph: p.graph, packageSha256: p.packageSha256 });
  const rpc = vi.fn(async (method: string, params: unknown[]) => {
    if (method === 'eth_getBlockByNumber') return { ...head, number: `0x${head.number.toString(16)}`, timestamp: `0x${head.timestamp.toString(16)}`, hash: lastHash };
    expect(params[1 + Number(method === 'eth_getStorageAt')]).toEqual({ blockHash: head.hash, requireCanonical: true });
    if (method === 'eth_getCode') { expect(params[0]).toBe(owner); return code; }
    if (method === 'eth_getStorageAt') return storageWord;
    expect(method).toBe('eth_call');
    const call = params[0] as { from: string; to: string; data: string }; expect(call.from).toBe(owner);
    const index = tokens.findIndex(t => t.address === call.to); expect(index).toBeGreaterThanOrEqual(0);
    const parsed = abi.parseTransaction({ data: call.data })!;
    expect(parsed.args[0]).toBe(owner);
    if (parsed.name === 'allowance') expect(parsed.args[1]).toBe(p.core);
    const result = parsed.name === 'balanceOf' ? viewer[index] : parsed.name === 'accountEncryptionAddress' ? recipient :
      { ciphertext: { ciphertextHigh: 91n, ciphertextLow: 92n }, ownerCiphertext: approvals[index], spenderCiphertext: { ciphertextHigh: 93n, ciphertextLow: 94n } };
    return abi.encodeFunctionResult(parsed.name, [result]) + suffix;
  });
  return { balances, allowances, viewer, approvals, rpc, decrypt, assertCurrent, run: () => readCurrentSharedDexTokenFunds({ owner, head, rpc, decrypt, assertCurrent, candidate }),
    revoke: () => { active = false; }, contract: () => { code = '0x6000'; }, recipient: (s: string) => { recipient = s; },
    corrupt: () => { suffix = '00'; }, reorg: () => { lastHash = `0x${'55'.repeat(32)}`; }, badStorage: () => { storageWord = `0x${'01'.repeat(32)}`; } };
}
afterEach(() => vi.restoreAllMocks());
describe('selected swap input funds', () => {
  const captures = [
    '../../reports/limit-directory-adoption-2026-11-04/public-binding/public-capture-1.json',
    '../../reports/low-rpc-trial-2026-11-05/public-binding/public-capture-1.json',
    // Build 13, the single App candidate (decision-034).
    '../../../ChainWhisper Contracts V2/validation/candidates/c1-band-sizing-2026-11-21/native-bob-dense-1/APP_PUBLIC_CAPTURE.json'
  ].map(file => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')));
  function swapFixture(fault = '') {
    const f = fixture('cheap-history'), policy = resolveCurrentSharedTokenDistribution('cheap-history');
    const capture = captures.find(value => value.graph === policy.graph);
    if (!capture) throw new Error('Missing selected swap-funds runtime fixture.');
    const swapHead = { ...head, number: BigInt(policy.attestationBlock.number) + 5n };
    let headReads = 0;
    const rpc = vi.fn(async (method: string, params: unknown[]): Promise<unknown> => {
      if (method === 'eth_chainId') return fault === 'chain' ? '0x1' : `0x${fault === 'quantity' ? '0' : ''}${policy.chainId.toString(16)}`;
      if (method === 'eth_getBlockByNumber') {
        if (params[0] === '0x0') return { number: '0x0', hash: fault === 'genesis' ? head.hash : policy.genesisHash };
        if (params[0] === `0x${BigInt(policy.attestationBlock.number).toString(16)}`) return { number: params[0], hash: fault === 'origin' ? head.hash : policy.attestationBlock.hash };
        headReads++;
        return { number: `0x${swapHead.number.toString(16)}`, timestamp: `0x${swapHead.timestamp.toString(16)}`,
          hash: fault === 'reorg' && headReads > 1 ? `0x${'55'.repeat(32)}` : swapHead.hash };
      }
      if (method === 'eth_getCode' && params[0] !== owner) {
        if (fault === 'runtime') return '0x6000';
        return capture.reads.find((r: { method: string; params: string[] }) => r.method === method && r.params[0].toLowerCase() === String(params[0]).toLowerCase()).result;
      }
      if (method === 'eth_call') {
        const call = params[0] as { to: string; data: string };
        const core = call.to.toLowerCase() === policy.core.toLowerCase();
        const publicAbi = core ? currentSharedDistributionCoreAbi : currentSharedDistributionTokenAbi;
        const parsed = publicAbi.parseTransaction({ data: call.data });
        if (parsed) {
          const value = parsed.name === 'releaseId' ? policy.releaseId : parsed.name === 'tokenAdmissionCommitment' ? policy.tokenAdmissionCommitment : parsed.name === 'decimals' ? 6n : false;
          return publicAbi.encodeFunctionResult(parsed.name, [fault === 'policy' && parsed.name === 'publicAmountsEnabled' ? true : value]);
        }
      }
      return f.rpc(method, params);
    });
    vi.mocked(readCurrentSharedDexTokenDistribution).mockClear();
    return { ...f, rpc, run: (token = tokens[1].address) => readCurrentSharedDexSwapFunds({
      owner, head: swapHead, tokens: [token, tokens[2].address], candidate: 'cheap-history', rpc, decrypt: f.decrypt,
      assertCurrent: async () => { await f.assertCurrent(); if (fault === 'session') throw new Error('Scope revoked'); }
    }) };
  }
  it('uses 21 logical reads for the current pair, without distribution or unrelated tokens', async () => {
    const f = swapFixture(), result = await f.run();
    expect(result.tokens).toHaveLength(2);
    expect(result.tokens[0]).toMatchObject({ address: tokens[1].address, balance: f.balances[1], allowance: f.allowances[1] });
    expect(result).toMatchObject({ privateFundsVerified: true, readyToSign: false });
    expect(f.rpc).toHaveBeenCalledTimes(21);
    expect(readCurrentSharedDexTokenDistribution).not.toHaveBeenCalled();
    expect(f.decrypt).toHaveBeenCalledTimes(4);
    expect(f.rpc.mock.calls.filter(([m]) => m === 'eth_call').map(([, a]) => (a[0] as { to: string }).to.toLowerCase()))
      .not.toContain(tokens[0].address.toLowerCase());
    expect(result.tokens[0]).not.toHaveProperty('claimed');
  });
  it.each(['chain', 'quantity', 'genesis', 'origin', 'runtime', 'policy', 'reorg', 'session'])('rejects changed %s', async fault => {
    const f = swapFixture(fault);
    await expect(f.run()).rejects.toThrow();
    expect(readCurrentSharedDexTokenDistribution).not.toHaveBeenCalled();
  });
  it('keeps owner-envelope and canonical-empty checks on the selected token', async () => {
    const f = swapFixture(); f.viewer[1] = empty(); f.badStorage();
    await expect(f.run()).rejects.toThrow('no owner envelope');
    const g = swapFixture(); g.recipient(p.vault.recovery);
    await expect(g.run()).rejects.toThrow('another encryption recipient');
  });
  it('rejects an unadmitted token before any read', async () => {
    const f = swapFixture(); await expect(f.run(owner)).rejects.toThrow('Invalid swap funding');
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('rejects a privacy lock during decryption', async () => {
    const f = swapFixture(); f.decrypt.mockImplementation(() => { f.revoke(); return 0n; });
    await expect(f.run()).rejects.toThrow('Scope revoked');
  });
});
describe('four-token owner private funds', () => {
  it('reads allowance for the current Core and refuses an earlier-Core distribution', async () => {
    const f = fixture('cheap-history'), result = await f.run();
    expect(result.core).toBe(resolveCurrentSharedTokenDistribution('cheap-history').core);
    expect(result.tokens.map(t => t.allowance)).toEqual(f.allowances);
    expect(readCurrentSharedDexTokenDistribution).toHaveBeenCalledWith(expect.objectContaining({ candidate: 'cheap-history' }));
    vi.mocked(readCurrentSharedDexTokenDistribution).mockResolvedValueOnce(snapshot());
    await expect(f.run()).rejects.toThrow('candidate changed');
  });
  it('binds storage roots and ABI to the exact reviewed token artifact', () => {
    const artifact = JSON.parse(readFileSync(new URL('../../../ChainWhisper Contracts V2/validation/reports/reviewed-token-admission-2026-09-15/fixed-token-build-1/token.json', import.meta.url), 'utf8'));
    const exact = new Interface(artifact.abi);
    for (const f of abi.fragments) expect(f.format('minimal')).toBe(exact.getFunction(f.format('sighash'))!.format('minimal'));
    for (const [name, root] of [['_balances', layout.balances], ['_allowances', layout.allowances]] as const) expect(BigInt(artifact.storageLayout.storage.find((f: { label: string }) => f.label === name).slot)).toBe(root);
  });
  it('decrypts only owner envelopes, including encrypted zero and full 256-bit values', async () => {
    const f = fixture(), result = await f.run();
    expect(result.tokens.map(t => t.balance)).toEqual(f.balances); expect(result.tokens.map(t => t.allowance)).toEqual(f.allowances);
    expect(result.privateFundsVerified).toBe(true); expect(result.readyToSign).toBe(false); expect(f.decrypt).toHaveBeenCalledTimes(8);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.tokens)).toBe(true); expect(result.tokens.every(Object.isFrozen)).toBe(true);
    expect(f.rpc.mock.calls.some(([method]) => method === 'eth_getStorageAt')).toBe(false);
    expect(f.decrypt.mock.calls.flatMap(([c]) => [BigInt(c.ciphertextHigh), BigInt(c.ciphertextLow)])).not.toContain(91n);
  });
  it('accepts canonical empty funds only after system slots are also empty', async () => {
    const f = fixture(); f.viewer[3] = empty(); f.approvals[3] = empty(); const result = await f.run();
    expect(result.tokens[3]).toMatchObject({ balance: 0n, allowance: 0n }); expect(f.decrypt).toHaveBeenCalledTimes(6);
    const coder = AbiCoder.defaultAbiCoder(), at = (address: string, root: bigint) => BigInt(keccak256(coder.encode(['address', 'uint256'], [address, root])));
    const b = at(owner, 4n), a = at(resolveCurrentSharedTokenDistribution('cheap-history').core, at(owner, 5n));
    expect(new Set(f.rpc.mock.calls.filter(([method]) => method === 'eth_getStorageAt').map(([, args]) => args[1]))).toEqual(new Set([b, b + 1n, a, a + 1n].map(n => `0x${n.toString(16)}`)));
  });
  it.each(['balance', 'allowance'])('rejects missing %s owner envelope with nonempty system storage', async kind => {
    const f = fixture(); (kind === 'balance' ? f.viewer : f.approvals)[2] = empty(); f.badStorage();
    await expect(f.run()).rejects.toThrow('no owner envelope');
  });
  it.each(['contract', 'recipient', 'encoding', 'decrypt', 'scope', 'reorg', 'distribution'])('rejects %s without substituting zero', async fault => {
    const f = fixture(); if (fault === 'contract') f.contract(); if (fault === 'recipient') f.recipient(p.vault.recovery);
    if (fault === 'encoding') f.corrupt(); if (fault === 'decrypt') f.decrypt.mockImplementation(() => { throw new Error('private test failure'); });
    if (fault === 'scope') f.decrypt.mockImplementation(() => { f.revoke(); return 0n; }); if (fault === 'reorg') f.reorg();
    if (fault === 'distribution') vi.mocked(readCurrentSharedDexTokenDistribution).mockRejectedValueOnce(new Error('Wrong runtime'));
    await expect(f.run()).rejects.toThrow();
    expect(f.rpc.mock.calls.every(([method]) => ['eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getStorageAt'].includes(method))).toBe(true);
  });
});
