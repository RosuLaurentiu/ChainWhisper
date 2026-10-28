import { Interface, keccak256 } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readCurrentTokenRefill, currentTokenRefillAbi as consumer, CURRENT_TOKEN_REFILL_AMOUNT as amount } from './currentDexTokenRefill';
import { resolveCurrentCheapDexCandidate } from './dexV2Deployment';

// Independent RPC fixture uses the public contract interface, not consumer exports.
const producer = new Interface([
  'function CHAIN_ID() view returns(uint256)', 'function TOKEN_A() view returns(address)', 'function TOKEN_B() view returns(address)',
  'function TOKEN_RUNTIME() view returns(bytes32)', 'function CLAIM_AMOUNT() view returns(uint256)',
  'function INITIAL_QUOTA() view returns(uint256)', 'function COOLDOWN() view returns(uint256)',
  'function expiresAt() view returns(uint256)', 'function recovery() view returns(address)',
  'function remainingQuota(address) view returns(uint256)', 'function nextClaimAt(address,address) view returns(uint256)',
  'function claim(address)'
]);
const owner = `0x${'11'.repeat(20)}`, vault = `0x${'22'.repeat(20)}`, recovery = `0x${'33'.repeat(20)}`, hash = `0x${'44'.repeat(32)}`, code = '0x123456';
function fixture(index: 0 | 1 = 0) {
  const c = resolveCurrentCheapDexCandidate('cheap-native');
  const values: Record<string, unknown> = { CHAIN_ID: 7082400n, TOKEN_A: c.tokens[0][0], TOKEN_B: c.tokens[1][0],
    TOKEN_RUNTIME: c.tokens[0][1], CLAIM_AMOUNT: 1000n * 10n ** 18n, INITIAL_QUOTA: 1000000n * 10n ** 18n,
    COOLDOWN: 86400n, expiresAt: 3000000n, recovery, remainingQuota: 999000n * 10n ** 18n, nextClaimAt: 0n };
  let rawCode = code, suffix = '', active = true;
  const assertCurrent = vi.fn(async () => { if (!active) throw new Error('Session changed'); });
  const rpc = vi.fn(async (method: string, params: unknown[]) => {
    expect(params[1]).toEqual({ blockHash: hash, requireCanonical: true });
    if (method === 'eth_getCode') { expect(params[0]).toBe(vault); return rawCode; }
    expect(method).toBe('eth_call');
    const request = params[0] as { from: string; to: string; data: string };
    expect(request.from).toBe(owner); expect(request.to).toBe(vault);
    const call = producer.parseTransaction({ data: request.data })!;
    if (call.name === 'remainingQuota' || call.name === 'nextClaimAt') expect(call.args[0].toLowerCase()).toBe(c.tokens[index][0]);
    if (call.name === 'nextClaimAt') expect(call.args[1]).toBe(owner);
    return producer.encodeFunctionResult(call.name, [values[call.name]]) + suffix;
  });
  const args = { binding: { address: vault, runtimeHash: keccak256(code), recovery, expiresAt: 3000000n },
    candidate: 'cheap-native' as const, tokenIndex: index, owner, initialClaimed: true,
    head: { number: 30n, hash, timestamp: 100000n }, rpc, assertCurrent };
  return { args, values, rpc, setCode: (v: string) => { rawCode = v; }, corrupt: () => { suffix = '00'.repeat(32); }, revoke: () => { active = false; } };
}
describe('private Testnet refill availability', () => {
  it('uses the actual production contract ABI for all reads, claims and claim events', () => {
    const artifacts = JSON.parse(readFileSync(new URL('../../../ChainWhisper Contracts V2/validation/candidates/private-token-refill-2026-10-04/artifacts.json', import.meta.url), 'utf8'));
    const actual = new Interface(artifacts.production.abi);
    for (const fragment of consumer.fragments) {
      if (fragment.type === 'function') expect(actual.getFunction(fragment.format('sighash'))?.format('minimal')).toBe(fragment.format('minimal'));
      if (fragment.type === 'event') expect(actual.getEvent(fragment.format('sighash'))?.format('minimal')).toBe(fragment.format('minimal'));
    }
  });
  it.each([0, 1] as const)('reads the selected token at one canonical block without private vault reads: %s', async index => {
    const f = fixture(index), s = await readCurrentTokenRefill(f.args);
    expect(s).toMatchObject({ availability: 'ready', amount, quota: 999000n * 10n ** 18n });
    expect(f.rpc).toHaveBeenCalledTimes(12); expect(Object.isFrozen(s.block)).toBe(true);
    expect(producer.decodeFunctionData('claim', consumer.encodeFunctionData('claim', [s.token]))[0].toLowerCase()).toBe(s.token);
  });
  it.each([
    ['initial-claim-required', false, 999000n * 10n ** 18n, 0n, 100000n],
    ['cooldown', true, 999000n * 10n ** 18n, 100001n, 100000n],
    ['ready', true, 999000n * 10n ** 18n, 100000n, 100000n],
    ['exhausted', true, 0n, 0n, 100000n],
    ['expired', true, 999000n * 10n ** 18n, 0n, 3000000n]
  ] as const)('reports %s at the boundary', async (availability, claimed, quota, next, time) => {
    const f = fixture(); f.args.initialClaimed = claimed; f.values.remainingQuota = quota; f.values.nextClaimAt = next; f.args.head.timestamp = time;
    expect((await readCurrentTokenRefill(f.args)).availability).toBe(availability);
  });
  it.each([
    ['CHAIN_ID', 1n], ['TOKEN_A', recovery], ['TOKEN_B', recovery], ['TOKEN_RUNTIME', hash],
    ['CLAIM_AMOUNT', 1001n * 10n ** 18n], ['INITIAL_QUOTA', 1001n * 10n ** 18n], ['COOLDOWN', 1n],
    ['expiresAt', 3000001n], ['recovery', owner], ['remainingQuota', 1000001n * 10n ** 18n],
    ['remainingQuota', 1n], ['nextClaimAt', 4000000n]
  ])('rejects changed %s', async (key, value) => {
    const f = fixture(); f.values[key as string] = value;
    await expect(readCurrentTokenRefill(f.args)).rejects.toThrow('policy changed');
  });
  it('rejects changed runtime before policy reads', async () => {
    const f = fixture(); f.setCode('0xabcdef'); await expect(readCurrentTokenRefill(f.args)).rejects.toThrow('runtime'); expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it('rejects non-canonical RPC encoding', async () => {
    const f = fixture(); f.corrupt(); await expect(readCurrentTokenRefill(f.args)).rejects.toThrow('Non-canonical');
  });
  it('rejects invalid identities and a lost wallet session before RPC', async () => {
    const f = fixture(); f.args.binding.address = `0x${'00'.repeat(20)}`;
    await expect(readCurrentTokenRefill(f.args)).rejects.toThrow('binding'); expect(f.rpc).not.toHaveBeenCalled();
    const g = fixture(); g.revoke(); await expect(readCurrentTokenRefill(g.args)).rejects.toThrow('Session'); expect(g.rpc).not.toHaveBeenCalled();
  });
  it('rejects RPC loss and wallet replacement during the read', async () => {
    const f = fixture(); f.rpc.mockRejectedValueOnce(new Error('RPC unavailable'));
    await expect(readCurrentTokenRefill(f.args)).rejects.toThrow('RPC unavailable');
    const g = fixture(); g.rpc.mockImplementationOnce(async () => { g.revoke(); return code; });
    await expect(readCurrentTokenRefill(g.args)).rejects.toThrow('Session changed'); expect(g.rpc).toHaveBeenCalledTimes(1);
  });
});
