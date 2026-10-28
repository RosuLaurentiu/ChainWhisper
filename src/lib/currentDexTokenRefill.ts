import { Interface, getAddress, keccak256 } from '@coti-io/coti-ethers';
import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from './dexV2Deployment';

// Distribution limits are public. This reader never reads the vault's private balance.
export const CURRENT_TOKEN_REFILL_AMOUNT = 1_000n * 10n ** 18n;
export const CURRENT_TOKEN_REFILL_QUOTA = 1_000_000n * 10n ** 18n;
export const CURRENT_TOKEN_REFILL_COOLDOWN = 86_400n;
export const currentTokenRefillAbi = new Interface([
  'function claim(address token)',
  'function CHAIN_ID() view returns(uint256)',
  'function TOKEN_A() view returns(address)', 'function TOKEN_B() view returns(address)',
  'function TOKEN_RUNTIME() view returns(bytes32)',
  'function CLAIM_AMOUNT() view returns(uint256)', 'function INITIAL_QUOTA() view returns(uint256)',
  'function COOLDOWN() view returns(uint256)', 'function expiresAt() view returns(uint256)',
  'function recovery() view returns(address)',
  'function remainingQuota(address token) view returns(uint256)',
  'function nextClaimAt(address token,address account) view returns(uint256)',
  'event Claimed(address indexed token,address indexed account)'
]);
export type CurrentTokenRefillBinding = Readonly<{
  address: string; runtimeHash: string; recovery: string; expiresAt: bigint;
}>;
export type CurrentTokenRefillState = Readonly<{
  address: string; token: string; owner: string; amount: bigint; quota: bigint;
  nextClaimAt: bigint; expiresAt: bigint; block: Readonly<{ number: bigint; hash: string; timestamp: bigint }>;
  availability: 'initial-claim-required' | 'expired' | 'exhausted' | 'cooldown' | 'ready';
}>;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const nonzero = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s) && BigInt(s) !== 0n;

// The caller supplies the deployed, receipt-bound identity. No deployment is admitted here.
export const readCurrentTokenRefill = async ({ binding, candidate, tokenIndex, owner, initialClaimed, head, rpc, assertCurrent } : {
  binding: CurrentTokenRefillBinding; candidate: CurrentCheapDexCandidateKey; tokenIndex: 0 | 1;
  owner: string; initialClaimed: boolean; head: { number: bigint; hash: string; timestamp: bigint };
  rpc: (method: string, params: unknown[]) => Promise<unknown>; assertCurrent: () => Promise<void>;
}): Promise<CurrentTokenRefillState> => {
  const c = resolveCurrentCheapDexCandidate(candidate);
  if ((tokenIndex !== 0 && tokenIndex !== 1) || !nonzero(owner) || !nonzero(binding.address) || !nonzero(binding.recovery) ||
    !/^0x[0-9a-fA-F]{64}$/.test(binding.runtimeHash) || BigInt(binding.runtimeHash) === 0n ||
    binding.expiresAt <= 0n || head.number < 0n || head.timestamp < 0n || !/^0x[0-9a-fA-F]{64}$/.test(head.hash) || BigInt(head.hash) === 0n) {
    throw new Error('Invalid Testnet refill binding.');
  }
  await assertCurrent();
  const at = getAddress(binding.address), account = getAddress(owner), token = c.tokens[tokenIndex][0];
  const block = { blockHash: head.hash, requireCanonical: true };
  const code = await rpc('eth_getCode', [at, block]); await assertCurrent();
  if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code) || !same(keccak256(code), binding.runtimeHash)) throw new Error('Testnet refill runtime changed.');
  const read = async (method: string, args: unknown[] = []) => {
    const raw = await rpc('eth_call', [{ from: account, to: at, data: currentTokenRefillAbi.encodeFunctionData(method, args) }, block]);
    await assertCurrent();
    if (typeof raw !== 'string') throw new Error('Invalid Testnet refill response.');
    const decoded = currentTokenRefillAbi.decodeFunctionResult(method, raw);
    if (!same(currentTokenRefillAbi.encodeFunctionResult(method, decoded), raw)) throw new Error('Non-canonical Testnet refill response.');
    return decoded[0];
  };
  const [chain, a, b, runtime, amount, quotaLimit, cooldown, expires, recovery, quota, next]:
    [bigint, string, string, string, bigint, bigint, bigint, bigint, string, bigint, bigint] = await Promise.all([
    read('CHAIN_ID'), read('TOKEN_A'), read('TOKEN_B'), read('TOKEN_RUNTIME'), read('CLAIM_AMOUNT'),
    read('INITIAL_QUOTA'), read('COOLDOWN'), read('expiresAt'), read('recovery'),
    read('remainingQuota', [token]), read('nextClaimAt', [token, account])
  ]);
  if (chain !== 7082400n || chain !== BigInt(c.chainId) || !same(a, c.tokens[0][0]) || !same(b, c.tokens[1][0]) ||
    c.tokens.some(([, hash]) => !same(hash, runtime)) || amount !== CURRENT_TOKEN_REFILL_AMOUNT || quotaLimit !== CURRENT_TOKEN_REFILL_QUOTA ||
    cooldown !== CURRENT_TOKEN_REFILL_COOLDOWN || expires !== binding.expiresAt || !same(recovery, binding.recovery) ||
    quota < 0n || quota > quotaLimit || quota % amount !== 0n || next < 0n || next > expires + cooldown) throw new Error('Testnet refill policy changed.');
  await assertCurrent();
  return Object.freeze({ address: at, token, owner: account, amount, quota, nextClaimAt: next, expiresAt: expires,
    block: Object.freeze({ ...head }), availability: head.timestamp >= expires ? 'expired' : !initialClaimed ? 'initial-claim-required' :
      quota < amount ? 'exhausted' : head.timestamp < next ? 'cooldown' : 'ready' });
};
