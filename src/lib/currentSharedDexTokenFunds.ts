import { AbiCoder, Interface, getAddress, keccak256 } from '@coti-io/coti-ethers';
import { resolveCurrentSharedTokenDistribution, readCurrentSharedDexTokenDistribution,
  type CurrentSharedDistributionHead } from './currentSharedDexTokenDistribution';
import type { PrivateUint256Output } from './privateUint256';
import type { CurrentCheapDexCandidateKey } from './dexV2Deployment';

const ct = '(uint256 ciphertextHigh,uint256 ciphertextLow)';
export const currentSharedTokenFundsAbi = new Interface([
  `function balanceOf(address) view returns(${ct})`,
  `function allowance(address,address) view returns((${ct} ciphertext,${ct} ownerCiphertext,${ct} spenderCiphertext))`,
  'function accountEncryptionAddress(address) view returns(address)'
]);
// Exact reviewed token layout. Its runtime is checked by the distribution reader.
export const CURRENT_SHARED_TOKEN_FUNDS_LAYOUT = Object.freeze({ balances: 4n, allowances: 5n });
const coder = AbiCoder.defaultAbiCoder(), zero = '0x0000000000000000000000000000000000000000';
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const slot = (address: string, root: bigint) => BigInt(keccak256(coder.encode(['address', 'uint256'], [address, root])));

export const readCurrentSharedDexTokenFunds = async ({ owner, head: suppliedHead, rpc, assertCurrent, decrypt, candidate }: {
  owner: string; head: CurrentSharedDistributionHead;
  rpc: (method: string, params: unknown[]) => Promise<unknown>; assertCurrent: () => Promise<void>;
  decrypt: (ciphertext: PrivateUint256Output) => bigint;
  candidate?: CurrentCheapDexCandidateKey;
}) => {
  const policy = resolveCurrentSharedTokenDistribution(candidate);
  const head = Object.freeze({ ...suppliedHead }), account = getAddress(owner), block = Object.freeze({ blockHash: head.hash, requireCanonical: true });
  const guardedRpc = async (method: string, params: unknown[]) => {
    await assertCurrent(); const value = await rpc(method, params); await assertCurrent(); return value;
  };
  const distribution = await readCurrentSharedDexTokenDistribution({ owner: account, head, rpc: guardedRpc, assertCurrent, candidate });
  if (distribution.core.toLowerCase() !== policy.core.toLowerCase() || distribution.graph !== policy.graph ||
    distribution.packageSha256 !== policy.packageSha256 || distribution.owner.toLowerCase() !== account.toLowerCase()) {
    throw new Error('Private beta funds candidate changed.');
  }
  if (await guardedRpc('eth_getCode', [account, block]) !== '0x') throw new Error('Private beta funds require the selected owner wallet.');
  const funds = await Promise.all(distribution.tokens.map(async token => {
    const read = async (method: string, args: string[]) => {
      const raw = await guardedRpc('eth_call', [{ from: account, to: token.address,
        data: currentSharedTokenFundsAbi.encodeFunctionData(method, args) }, block]);
      if (typeof raw !== 'string') throw new Error('Private beta funds are unavailable.');
      const result = currentSharedTokenFundsAbi.decodeFunctionResult(method, raw);
      if (!same(currentSharedTokenFundsAbi.encodeFunctionResult(method, result), raw)) throw new Error('Private beta funds encoding changed.');
      return result[0];
    };
    const [balanceCipher, allowance, encryptionAddress] = await Promise.all([
      read('balanceOf', [account]), read('allowance', [account, policy.core]), read('accountEncryptionAddress', [account])
    ]);
    if (!same(encryptionAddress, zero) && !same(encryptionAddress, account)) throw new Error('Beta token balance uses another encryption recipient.');
    const reveal = async (cipher: PrivateUint256Output, systemSlot: bigint) => {
      await assertCurrent();
      if (BigInt(cipher.ciphertextHigh) === 0n && BigInt(cipher.ciphertextLow) === 0n) {
        // A missing viewer envelope is zero only if the exact token's underlying
        // system storage is also canonical empty. Never decrypt a system envelope.
        const words = await Promise.all([0n, 1n].map(offset => guardedRpc('eth_getStorageAt',
          [token.address, `0x${(systemSlot + offset).toString(16)}`, block])));
        if (!words.every(word => typeof word === 'string' && /^0x0{64}$/i.test(word))) {
          throw new Error('Private beta funds have no owner envelope.');
        }
        return 0n;
      }
      let amount: bigint;
      try { amount = decrypt(cipher); } catch { throw new Error('Private beta funds could not be decrypted. Check owner privacy.'); }
      await assertCurrent();
      if (typeof amount !== 'bigint' || amount < 0n || amount >= (1n << 256n)) throw new Error('Invalid private beta funds.');
      return amount;
    };
    const balanceSlot = slot(account, CURRENT_SHARED_TOKEN_FUNDS_LAYOUT.balances);
    const allowanceSlot = slot(policy.core, slot(account, CURRENT_SHARED_TOKEN_FUNDS_LAYOUT.allowances));
    const [balance, approved] = await Promise.all([reveal(balanceCipher, balanceSlot), reveal(allowance.ownerCiphertext, allowanceSlot)]);
    return Object.freeze({ ...token, balance, allowance: approved, encryptionAddress: getAddress(encryptionAddress) });
  }));
  const last = await guardedRpc('eth_getBlockByNumber', [`0x${head.number.toString(16)}`, false]) as Record<string, unknown> | null;
  if (!last || typeof last.hash !== 'string' || !same(last.hash, head.hash) || BigInt(String(last.number)) !== head.number ||
    BigInt(String(last.timestamp)) !== head.timestamp) throw new Error('Private beta funds block changed.');
  await assertCurrent();
  return Object.freeze({ ...distribution, tokens: Object.freeze(funds), privateFundsVerified: true as const, readyToSign: false as const });
};
