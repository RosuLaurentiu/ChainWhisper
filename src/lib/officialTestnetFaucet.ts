import { getAddress } from '@coti-io/coti-ethers';
import { COTI_TESTNET_NETWORK } from './chainWhisperNetworks';
import { CURRENT_CHEAP_DEX_CANDIDATE } from './dexV2Deployment';

export const OFFICIAL_COTI_TESTNET_FAUCET_URL = 'https://faucet.testnet.coti.io/';
// Display catalog observed 2026-10-03. These addresses have no private DEX admission.
export const OFFICIAL_TESTNET_TOKEN_CATALOG = Object.freeze([
  ['gCOTI', '0x878a42D3cB737DEC9E6c7e7774d973F46fd8ed4C', 18],
  ['USDC', '0x63f3D2Cc8F5608F57ce6E5Aa3590A2Beb428D19C', 6],
  ['USDT', '0x9e961430053cd5AbB3b060544cEcCec848693Cf0', 6],
  ['wETH', '0x8bca4e6bbE402DB4aD189A316137aD08206154FB', 18],
  ['wBTC', '0x5dBDb2E5D51c3FFab5D6B862Caa11FCe1D83F492', 8],
  ['wADA', '0xe3E2cd3Abf412c73a404b9b8227B71dE3CfE829D', 6],
  ['NIGHT', '0x918084eee42832f08b868Ea64Bba2d41A5F360c6', 6]
] as const);

type Rpc = (args: { method: string; params: unknown[] }) => Promise<unknown>;
export type OfficialTestnetGasState = Readonly<{
  owner: string; chainId: number; balance: bigint;
  block: Readonly<{ number: bigint; hash: string; timestamp: bigint }>;
}>;
const quantity = (v: unknown): bigint => {
  if (typeof v !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(v)) throw new Error('Invalid Testnet RPC quantity.');
  return BigInt(v);
};
const block = (v: unknown) => {
  if (!v || typeof v !== 'object' || !('hash' in v) || typeof v.hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(v.hash)
    || !('number' in v) || !('timestamp' in v)) throw new Error('Testnet block is unavailable.');
  return { number: quantity(v.number), hash: v.hash.toLowerCase(), timestamp: quantity(v.timestamp) };
};

// Public, bounded owner gas read. It cannot claim tokens, approve or send a transaction.
export const readOfficialTestnetGas = async ({ request, owner, chainId }: {
  request: Rpc; owner: string; chainId: number | null;
}): Promise<OfficialTestnetGasState> => {
  if (chainId !== COTI_TESTNET_NETWORK.chainIdDecimal) throw new Error('Select COTI Testnet to check gas.');
  const account = getAddress(owner);
  if (account === '0x0000000000000000000000000000000000000000') throw new Error('Connect the owner wallet.');
  const call = (method: string, params: unknown[] = []) => request({ method, params });
  if (quantity(await call('eth_chainId')) !== BigInt(chainId)) throw new Error('The wallet network changed. Check gas again.');
  const genesis = block(await call('eth_getBlockByNumber', ['0x0', false]));
  if (genesis.number !== 0n || genesis.hash !== CURRENT_CHEAP_DEX_CANDIDATE.genesisHash.toLowerCase()) throw new Error('Testnet genesis does not match.');
  const head = block(await call('eth_getBlockByNumber', ['latest', false]));
  const balance = quantity(await call('eth_getBalance', [account, { blockHash: head.hash, requireCanonical: true }]));
  const after = block(await call('eth_getBlockByNumber', [`0x${head.number.toString(16)}`, false]));
  if (after.number !== head.number || after.hash !== head.hash || after.timestamp !== head.timestamp) throw new Error('The gas read changed during a reorg. Check again.');
  if (quantity(await call('eth_chainId')) !== BigInt(chainId)) throw new Error('The wallet network changed. Check gas again.');
  return Object.freeze({ owner: account, chainId, balance, block: Object.freeze(head) });
};
