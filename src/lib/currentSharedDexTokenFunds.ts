import { AbiCoder, Interface, getAddress, keccak256 } from '@coti-io/coti-ethers';
import { resolveCurrentSharedTokenDistribution, readCurrentSharedDexTokenDistribution, CURRENT_SHARED_DEX_TOKENS,
  currentSharedDistributionCoreAbi, currentSharedDistributionTokenAbi,
  type CurrentSharedDistributionHead } from './currentSharedDexTokenDistribution';
import type { PrivateUint256Output } from './privateUint256';
import type { CurrentCheapDexCandidateKey } from './dexV2Deployment';

const ct = '(uint256 ciphertextHigh,uint256 ciphertextLow)';
export const currentSharedTokenFundsAbi = new Interface([
  `function balanceOf(address) view returns(${ct})`,
  `function allowance(address,address) view returns((${ct} ciphertext,${ct} ownerCiphertext,${ct} spenderCiphertext))`,
  'function accountEncryptionAddress(address) view returns(address)'
]);
// Exact reviewed token layout. Each public reader checks its token runtime first.
export const CURRENT_SHARED_TOKEN_FUNDS_LAYOUT = Object.freeze({ balances: 4n, allowances: 5n });
const coder = AbiCoder.defaultAbiCoder(), zero = '0x0000000000000000000000000000000000000000';
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const quantity = (value: unknown) => {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) throw new Error('Invalid swap funding RPC quantity.');
  return BigInt(value);
};
const slot = (address: string, root: bigint) => BigInt(keccak256(coder.encode(['address', 'uint256'], [address, root])));

type FundsRead = {
  owner: string; head: CurrentSharedDistributionHead;
  rpc: (method: string, params: unknown[]) => Promise<unknown>; assertCurrent: () => Promise<void>;
  decrypt: (ciphertext: PrivateUint256Output) => bigint;
  candidate?: CurrentCheapDexCandidateKey;
};
const readPrivateFunds = async <T extends Readonly<{ symbol: string; address: string; decimals: 6 }>>(
  { owner, head: suppliedHead, rpc, assertCurrent, decrypt, candidate }: FundsRead, tokens: readonly T[]
) => {
  const policy = resolveCurrentSharedTokenDistribution(candidate);
  const head = Object.freeze({ ...suppliedHead }), account = getAddress(owner), block = Object.freeze({ blockHash: head.hash, requireCanonical: true });
  const guardedRpc = async (method: string, params: unknown[]) => {
    await assertCurrent(); const value = await rpc(method, params); await assertCurrent(); return value;
  };
  if (await guardedRpc('eth_getCode', [account, block]) !== '0x') throw new Error('Private beta funds require the selected owner wallet.');
  const funds = await Promise.all(tokens.map(async token => {
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
  return Object.freeze(funds);
};

export const readCurrentSharedDexTokenFunds = async (args: FundsRead) => {
  const policy = resolveCurrentSharedTokenDistribution(args.candidate), account = getAddress(args.owner);
  const read = { ...args, owner: account, head: Object.freeze({ ...args.head }) };
  const distribution = await readCurrentSharedDexTokenDistribution(read);
  if (!same(distribution.core, policy.core) || distribution.graph !== policy.graph ||
    distribution.packageSha256 !== policy.packageSha256 || !same(distribution.owner, account)) {
    throw new Error('Private beta funds candidate changed.');
  }
  const tokens = await readPrivateFunds(read, distribution.tokens);
  return Object.freeze({ ...distribution, tokens, privateFundsVerified: true as const, readyToSign: false as const });
};

export const readCurrentSharedDexSwapFunds = async (args: FundsRead & { tokens: readonly [string, string] }) => {
  const policy = resolveCurrentSharedTokenDistribution(args.candidate), owner = getAddress(args.owner);
  const assets = args.tokens.map(address => {
    const token = CURRENT_SHARED_DEX_TOKENS.find(t => same(t.address, address));
    if (!token) throw new Error('Invalid swap funding token.');
    return token;
  }), head = Object.freeze({ ...args.head });
  if (assets.length !== 2 || same(assets[0].address, assets[1].address) || owner === zero || typeof head.number !== 'bigint' || head.number < BigInt(policy.attestationBlock.number) ||
    typeof head.timestamp !== 'bigint' || head.timestamp < 0n || !/^0x[0-9a-f]{64}$/i.test(head.hash) || BigInt(head.hash) === 0n) {
    throw new Error('Invalid swap funding owner, token or head.');
  }
  const rpc = async (method: string, params: unknown[]) => {
    await args.assertCurrent(); const result = await args.rpc(method, params); await args.assertCurrent(); return result;
  };
  const block = { blockHash: head.hash, requireCanonical: true };
  const [chain, genesis, origin, current] = await Promise.all([
    rpc('eth_chainId', []), rpc('eth_getBlockByNumber', ['0x0', false]),
    rpc('eth_getBlockByNumber', [`0x${BigInt(policy.attestationBlock.number).toString(16)}`, false]),
    rpc('eth_getBlockByNumber', [`0x${head.number.toString(16)}`, false])
  ]);
  const genesisBlock = genesis as { number?: string; hash?: string } | null, originBlock = origin as { number?: string; hash?: string } | null;
  const currentBlock = current as { number?: string; hash?: string; timestamp?: string } | null;
  if (quantity(chain) !== policy.chainId || genesisBlock?.hash !== policy.genesisHash || quantity(genesisBlock.number) !== 0n ||
    originBlock?.hash !== policy.attestationBlock.hash || quantity(originBlock.number) !== BigInt(policy.attestationBlock.number) || currentBlock?.hash !== head.hash ||
    quantity(currentBlock.number) !== head.number || quantity(currentBlock.timestamp) !== head.timestamp) {
    throw new Error('Swap funding chain or canonical block changed.');
  }
  for (const [address, expected] of [[policy.core, policy.coreRuntimeHash], ...assets.map(token => [token.address, policy.tokenRuntimeHash])]) {
    const code = await rpc('eth_getCode', [address, block]);
    if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(code) || !same(keccak256(code), expected)) throw new Error('Swap funding runtime changed.');
  }
  for (const [address, abi, name, expected] of [
    [policy.core, currentSharedDistributionCoreAbi, 'releaseId', policy.releaseId],
    [policy.core, currentSharedDistributionCoreAbi, 'tokenAdmissionCommitment', policy.tokenAdmissionCommitment],
    ...assets.flatMap(token => [
      [token.address, currentSharedDistributionTokenAbi, 'decimals', 6n] as const,
      [token.address, currentSharedDistributionTokenAbi, 'publicAmountsEnabled', false] as const
    ])
  ] as const) {
    const raw = await rpc('eth_call', [{ from: owner, to: address, data: abi.encodeFunctionData(name) }, block]);
    if (typeof raw !== 'string') throw new Error('Swap funding policy is unavailable.');
    const decoded = abi.decodeFunctionResult(name, raw);
    if (!same(abi.encodeFunctionResult(name, decoded), raw) || decoded[0] !== expected) throw new Error('Swap funding policy changed.');
  }
  const tokens = await readPrivateFunds({ ...args, head }, assets);
  return Object.freeze({ owner, head, core: policy.core, graph: policy.graph, packageSha256: policy.packageSha256,
    tokens, privateFundsVerified: true as const, readyToSign: false as const });
};
