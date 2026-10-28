import { getAddress } from '@coti-io/coti-ethers';
import { readCurrentSharedDexTokenDistribution } from './currentSharedDexTokenDistribution';
import type { CurrentCheapDexCandidateKey } from './dexV2Deployment';

// Public eligibility only. This path cannot unlock privacy, request a signature or send.
export const readCurrentSharedDexTestTokens = async ({ request, owner, chainId, assertCurrent, candidate }: {
  request: (args: { method: string; params: unknown[] }) => Promise<unknown>;
  owner: string; chainId: number | null; assertCurrent: () => void;
  candidate?: CurrentCheapDexCandidateKey;
}) => {
  if (chainId !== 7082400) throw new Error('Select COTI Testnet to check beta test tokens.');
  const account = getAddress(owner);
  if (BigInt(account) === 0n) throw new Error('Connect the owner wallet.');
  const rpc = async (method: string, params: unknown[]) => {
    assertCurrent(); const result = await request({ method, params }); assertCurrent(); return result;
  };
  const guard = async () => {
    assertCurrent();
    const [accounts, chain] = await Promise.all([rpc('eth_accounts', []), rpc('eth_chainId', [])]);
    if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== account.toLowerCase() ||
      typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== BigInt(chainId)) {
      throw new Error('The selected wallet or network changed. Check beta test tokens again.');
    }
    assertCurrent();
  };
  await guard();
  const raw = await rpc('eth_getBlockByNumber', ['latest', false]) as Record<string, unknown> | null;
  const quantity = (value: unknown) => {
    if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) throw new Error('Testnet block is unavailable.');
    return BigInt(value);
  };
  if (!raw || typeof raw.hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(raw.hash)) throw new Error('Testnet block is unavailable.');
  const head = { number: quantity(raw.number), hash: raw.hash, timestamp: quantity(raw.timestamp) };
  const result = await readCurrentSharedDexTokenDistribution({ owner: account, head, rpc, candidate, assertCurrent: async () => { assertCurrent(); } });
  await guard();
  return result;
};
