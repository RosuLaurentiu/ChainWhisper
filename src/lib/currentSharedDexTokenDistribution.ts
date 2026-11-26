import { Interface, getAddress, keccak256 } from '@coti-io/coti-ethers';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as current } from './selectedCurrentDexCandidate';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import type { CurrentCheapDexCandidateKey } from './dexV2Deployment';

// Public distribution policy only. This module issues no signing authority.
// decision-034: identity defaults come from the current build 13 candidate (they were the 85767 prepared descriptor).
export const CURRENT_SHARED_TOKEN_DISTRIBUTION = Object.freeze({
  chainId: BigInt(current.chainId),
  genesisHash: current.genesisHash,
  core: getAddress(current.core),
  coreRuntimeHash: current.runtimes.find(([name]) => name === 'ChainWhisperDexCore')![2],
  graph: current.graph,
  packageSha256: current.packageSha256,
  releaseId: current.releaseId,
  tokenAdmissionCommitment: current.tokenAdmissionCommitment,
  tokenRuntimeHash: current.tokens[0][1],
  attestationSha256: current.attestationSha256,
  attestationBlock: current.attestationBlock,
  initialAmount: 10_000n * 10n ** 6n,
  refillAmount: 1_000n * 10n ** 6n,
  initialQuota: 1_000_000n * 10n ** 6n,
  cooldown: 86_400n,
  vault: Object.freeze({ address: '0x93569e6ae15d42F60A642B3F306e50c37Ca78FbF',
    runtimeHash: '0x1b905cca2b1c984e9edd8b39c6a8064e4e5858f6b21282ad0dfed379ef0260d5',
    recovery: '0xC737b5850e15d03ed09bfAdc8A33062f6073a850', expiresAt: 1796608723n }),
  vaultDeployment: Object.freeze({
    transactionHash: '0xad5ce94cfef71c07ce2555f8226ed8d9a81210f11be42485bd048f9c461218ff',
    blockNumber: 10484977n,
    blockHash: '0xd167bbe87e47d6577d96592d9ca066301d8ec173a79f4a6330b24b8dcff5ab09',
    transactionIndex: 0n, from: '0xC737b5850e15d03ed09bfAdc8A33062f6073a850', nonce: 7641n,
    calldataHash: '0x11d113a270aab79a95b873c560510c4bb307e8a93f05e372669df6837114244b' })
});
export const CURRENT_SHARED_DEX_TOKENS = Object.freeze(current.tokenMetadata
  .map(token => Object.freeze({ symbol: token.symbol, address: getAddress(token.address), decimals: token.decimals })));

// The distributor and tokens are shared. The DEX allowance and Core proof are not.
// Select only a maintained exact descriptor; this does not issue write authority.
export const resolveCurrentSharedTokenDistribution = (key: CurrentCheapDexCandidateKey = 'cheap-history') => {
  const { candidate } = resolvePreparedDexScope(key);
  const coreRuntime = candidate.runtimes.find(([name]) => name === 'ChainWhisperDexCore');
  if (!coreRuntime || candidate.tokenMetadata.length !== CURRENT_SHARED_DEX_TOKENS.length ||
    candidate.tokenMetadata.some((token, i) => token.address.toLowerCase() !== CURRENT_SHARED_DEX_TOKENS[i].address.toLowerCase() ||
      token.symbol !== CURRENT_SHARED_DEX_TOKENS[i].symbol || token.decimals !== 6) ||
    candidate.tokens.some(([, hash]) => hash !== CURRENT_SHARED_TOKEN_DISTRIBUTION.tokenRuntimeHash)) {
    throw new Error('Shared beta token candidate changed.');
  }
  return Object.freeze({ ...CURRENT_SHARED_TOKEN_DISTRIBUTION,
    chainId: BigInt(candidate.chainId), genesisHash: candidate.genesisHash, core: getAddress(candidate.core),
    coreRuntimeHash: coreRuntime[2], graph: candidate.graph, packageSha256: candidate.packageSha256,
    releaseId: candidate.releaseId, tokenAdmissionCommitment: candidate.tokenAdmissionCommitment,
    attestationSha256: candidate.attestationSha256, attestationBlock: candidate.attestationBlock });
};

export const currentSharedDistributionCoreAbi = new Interface([
  'function releaseId() view returns(bytes32)', 'function tokenAdmissionCommitment() view returns(bytes32)'
]);
export const currentSharedDistributionTokenAbi = new Interface([
  'function decimals() view returns(uint8)', 'function publicAmountsEnabled() view returns(bool)',
  'function faucetAmount() view returns(uint256)', 'function faucetClaimed(address) view returns(bool)'
]);
export const currentSharedDistributionVaultAbi = new Interface([
  'function CHAIN_ID() view returns(uint256)', ...['A', 'B', 'C', 'D'].map(x => `function TOKEN_${x}() view returns(address)`),
  'function TOKEN_RUNTIME() view returns(bytes32)', 'function CLAIM_AMOUNT() view returns(uint256)',
  'function INITIAL_QUOTA() view returns(uint256)', 'function COOLDOWN() view returns(uint256)',
  'function expiresAt() view returns(uint256)', 'function recovery() view returns(address)',
  'function remainingQuota(address) view returns(uint256)', 'function nextClaimAt(address,address) view returns(uint256)'
]);
export type CurrentSharedDistributionHead = Readonly<{ number: bigint; hash: string; timestamp: bigint }>;
export type CurrentSharedDexTokenDistributionAsset = Readonly<{
  symbol: string; address: string; decimals: 6; claimed: boolean;
  initialClaimAvailability: 'ready' | 'claimed';
  refillAvailability: 'initial-claim-required' | 'expired' | 'exhausted' | 'cooldown' | 'ready';
  quota: bigint; nextClaimAt: bigint; initialAmount: bigint; refillAmount: bigint;
}>;
export type CurrentSharedDexTokenDistributionSnapshot = Readonly<{
  owner: string; head: CurrentSharedDistributionHead; core: string; graph: string; packageSha256: string;
  vault: typeof CURRENT_SHARED_TOKEN_DISTRIBUTION.vault;
  tokens: readonly CurrentSharedDexTokenDistributionAsset[]; readyToSign: false;
}>;
const same = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
const hex = (n: bigint) => `0x${n.toString(16)}`;
const uint = (value: unknown): bigint => {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) throw new Error('Invalid distribution RPC quantity.');
  return BigInt(value);
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Missing distribution canonical proof.');
  return value as Record<string, unknown>;
};

export const readCurrentSharedDexTokenDistribution = async ({ owner, head: suppliedHead, rpc, assertCurrent, candidate }: {
  owner: string; head: CurrentSharedDistributionHead;
  rpc: (method: string, params: unknown[]) => Promise<unknown>; assertCurrent: () => Promise<void>;
  candidate?: CurrentCheapDexCandidateKey;
}): Promise<CurrentSharedDexTokenDistributionSnapshot> => {
  const p = resolveCurrentSharedTokenDistribution(candidate), d = p.vaultDeployment;
  const head = Object.freeze({ ...suppliedHead });
  if (!/^0x[0-9a-f]{40}$/i.test(owner) || BigInt(owner) === 0n || typeof head.number !== 'bigint' ||
    typeof head.timestamp !== 'bigint' || head.number < d.blockNumber || head.timestamp < 0n ||
    !/^0x[0-9a-f]{64}$/i.test(head.hash) || BigInt(head.hash) === 0n) throw new Error('Invalid distribution owner or head.');
  const account = getAddress(owner), block = Object.freeze({ blockHash: head.hash, requireCanonical: true });
  const readRpc = async (method: string, params: unknown[]) => {
    await assertCurrent(); const result = await rpc(method, params); await assertCurrent(); return result;
  };
  const canonicalHead = async () => {
    const value = record(await readRpc('eth_getBlockByNumber', [hex(head.number), false]));
    if (!same(value.hash, head.hash) || uint(value.number) !== head.number || uint(value.timestamp) !== head.timestamp)
      throw new Error('Distribution canonical head changed.');
  };
  const [chain, genesis] = await Promise.all([readRpc('eth_chainId', []), readRpc('eth_getBlockByNumber', ['0x0', false])]);
  if (uint(chain) !== p.chainId || !same(record(genesis).hash, p.genesisHash)) throw new Error('Distribution chain or genesis changed.');
  await canonicalHead();
  const checkCode = async (address: string, hash: string) => {
    const code = await readRpc('eth_getCode', [address, block]);
    if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(code) || !same(keccak256(code), hash))
      throw new Error('Distribution runtime changed.');
  };
  await Promise.all([checkCode(p.core, p.coreRuntimeHash), checkCode(p.vault.address, p.vault.runtimeHash),
    ...CURRENT_SHARED_DEX_TOKENS.map(token => checkCode(token.address, p.tokenRuntimeHash))]);
  const call = async (address: string, abi: Interface, name: string, args: unknown[] = []) => {
    const raw = await readRpc('eth_call', [{ from: account, to: address, data: abi.encodeFunctionData(name, args) }, block]);
    if (typeof raw !== 'string') throw new Error('Invalid distribution RPC result.');
    const decoded = abi.decodeFunctionResult(name, raw);
    if (!same(abi.encodeFunctionResult(name, decoded), raw)) throw new Error('Non-canonical distribution RPC result.');
    return decoded[0];
  };
  const [release, admission] = await Promise.all(['releaseId', 'tokenAdmissionCommitment'].map(name => call(p.core, currentSharedDistributionCoreAbi, name)));
  if (!same(release, p.releaseId) || !same(admission, p.tokenAdmissionCommitment)) throw new Error('Distribution Core identity changed.');
  // The vault deployment proof is independent of DEX operation evidence.
  const [txValue, receiptValue, deployBlockValue] = await Promise.all([
    readRpc('eth_getTransactionByHash', [d.transactionHash]), readRpc('eth_getTransactionReceipt', [d.transactionHash]),
    readRpc('eth_getBlockByNumber', [hex(d.blockNumber), false])
  ]);
  const tx = record(txValue), receipt = record(receiptValue), deployBlock = record(deployBlockValue);
  if (!same(tx.hash, d.transactionHash) || !same(tx.from, d.from) || tx.to !== null || uint(tx.nonce) !== d.nonce ||
    uint(tx.chainId) !== p.chainId || uint(tx.value) !== 0n || typeof tx.input !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(tx.input) ||
    !same(keccak256(tx.input), d.calldataHash) || !same(tx.blockHash, d.blockHash) || uint(tx.blockNumber) !== d.blockNumber ||
    uint(tx.transactionIndex) !== d.transactionIndex || !same(receipt.transactionHash, d.transactionHash) || uint(receipt.status) !== 1n ||
    !same(receipt.from, d.from) || receipt.to !== null || !same(receipt.contractAddress, p.vault.address) ||
    !same(receipt.blockHash, d.blockHash) || uint(receipt.blockNumber) !== d.blockNumber || uint(receipt.transactionIndex) !== d.transactionIndex ||
    !same(deployBlock.hash, d.blockHash) || uint(deployBlock.number) !== d.blockNumber ||
    !Array.isArray(deployBlock.transactions) || !same(deployBlock.transactions[Number(d.transactionIndex)], d.transactionHash))
    throw new Error('Distribution vault deployment proof changed.');
  const vaultNames = ['CHAIN_ID', 'TOKEN_A', 'TOKEN_B', 'TOKEN_C', 'TOKEN_D', 'TOKEN_RUNTIME', 'CLAIM_AMOUNT', 'INITIAL_QUOTA', 'COOLDOWN', 'expiresAt', 'recovery'];
  const values = await Promise.all(vaultNames.map(name => call(p.vault.address, currentSharedDistributionVaultAbi, name)));
  const expected = [p.chainId, ...CURRENT_SHARED_DEX_TOKENS.map(token => token.address), p.tokenRuntimeHash, p.refillAmount,
    p.initialQuota, p.cooldown, p.vault.expiresAt, p.vault.recovery];
  if (values.some((value, index) => typeof expected[index] === 'string' ? !same(value, expected[index] as string) : value !== expected[index]))
    throw new Error('Distribution vault policy changed.');
  const tokens = await Promise.all(CURRENT_SHARED_DEX_TOKENS.map(async token => {
    const [decimals, publicAmounts, initialAmount, claimed, quota, nextClaimAt] = await Promise.all([
      ...['decimals', 'publicAmountsEnabled', 'faucetAmount'].map(name => call(token.address, currentSharedDistributionTokenAbi, name)),
      call(token.address, currentSharedDistributionTokenAbi, 'faucetClaimed', [account]),
      call(p.vault.address, currentSharedDistributionVaultAbi, 'remainingQuota', [token.address]),
      call(p.vault.address, currentSharedDistributionVaultAbi, 'nextClaimAt', [token.address, account])
    ]) as [bigint, boolean, bigint, boolean, bigint, bigint];
    if (decimals !== 6n || publicAmounts !== false || initialAmount !== p.initialAmount || typeof claimed !== 'boolean' ||
      quota < 0n || quota > p.initialQuota || quota % p.refillAmount !== 0n || nextClaimAt < 0n || nextClaimAt > p.vault.expiresAt + p.cooldown)
      throw new Error('Distribution token policy changed.');
    const refillAvailability = head.timestamp >= p.vault.expiresAt ? 'expired' : !claimed ? 'initial-claim-required' :
      quota < p.refillAmount ? 'exhausted' : head.timestamp < nextClaimAt ? 'cooldown' : 'ready';
    return Object.freeze({ ...token, claimed, initialClaimAvailability: claimed ? 'claimed' as const : 'ready' as const,
      refillAvailability, quota, nextClaimAt, initialAmount, refillAmount: p.refillAmount });
  }));
  await canonicalHead(); await assertCurrent();
  return Object.freeze({ owner: account, head, core: p.core, graph: p.graph, packageSha256: p.packageSha256,
    vault: p.vault, tokens: Object.freeze(tokens), readyToSign: false as const });
};
