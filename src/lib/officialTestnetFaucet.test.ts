import { describe, expect, it, vi } from 'vitest';
import { CURRENT_CHEAP_DEX_CANDIDATE as c } from './dexV2Deployment';
import { readOfficialTestnetGas, OFFICIAL_COTI_TESTNET_FAUCET_URL, OFFICIAL_TESTNET_TOKEN_CATALOG } from './officialTestnetFaucet';
const owner = '0x1111111111111111111111111111111111111111';
const head = { number: '0x100', hash: `0x${'22'.repeat(32)}`, timestamp: '0x200' };
const genesis = { number: '0x0', hash: c.genesisHash, timestamp: '0x0' };
const fixture = () => vi.fn(async ({ method, params }: { method: string; params: unknown[] }): Promise<unknown> => {
  if (method === 'eth_chainId') return '0x6c11a0';
  if (method === 'eth_getBlockByNumber') return params[0] === '0x0' ? genesis : head;
  if (method === 'eth_getBalance') return '0x0';
  throw new Error('Unexpected RPC');
});
describe('official Testnet gas and token admission', () => {
  it('reads the exact owner at a canonical hash, preserves zero gas and never sends', async () => {
    const request = fixture();
    const result = await readOfficialTestnetGas({ request, owner, chainId: 7082400 });
    expect(result.balance).toBe(0n); expect(result.owner.toLowerCase()).toBe(owner);
    expect(request).toHaveBeenCalledTimes(6);
    expect(request).toHaveBeenCalledWith({ method: 'eth_getBalance', params: [owner, { blockHash: head.hash, requireCanonical: true }] });
    expect(request.mock.calls.some(([a]) => /send|sign|approve|requestAccounts/.test(a.method))).toBe(false);
  });
  it('stops a selected Mainnet before RPC and a changed wallet chain before balance', async () => {
    const request = fixture();
    await expect(readOfficialTestnetGas({ request, owner, chainId: 2632500 })).rejects.toThrow('Select COTI Testnet');
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValueOnce('0x282b34');
    await expect(readOfficialTestnetGas({ request, owner, chainId: 7082400 })).rejects.toThrow('wallet network changed');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects wrong genesis and has no alternate provider', async () => {
    const request = fixture().mockResolvedValueOnce('0x6c11a0').mockResolvedValueOnce({ ...genesis, hash: head.hash });
    await expect(readOfficialTestnetGas({ request, owner, chainId: 7082400 })).rejects.toThrow('genesis');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('rejects a reorg or unsupported hash-pinned RPC without a latest fallback', async () => {
    const request = fixture().mockResolvedValueOnce('0x6c11a0').mockResolvedValueOnce(genesis)
      .mockResolvedValueOnce(head).mockResolvedValueOnce('0x1').mockResolvedValueOnce({ ...head, hash: `0x${'33'.repeat(32)}` });
    await expect(readOfficialTestnetGas({ request, owner, chainId: 7082400 })).rejects.toThrow('reorg');
    expect(request).toHaveBeenCalledTimes(5);
    const failed = fixture().mockResolvedValueOnce('0x6c11a0').mockResolvedValueOnce(genesis).mockResolvedValueOnce(head).mockRejectedValueOnce(new Error('hash pin unsupported'));
    await expect(readOfficialTestnetGas({ request: failed, owner, chainId: 7082400 })).rejects.toThrow('hash pin unsupported');
    expect(failed).toHaveBeenCalledTimes(4);
  });
  it('rejects malformed gas and a chain change after the read', async () => {
    const request = fixture().mockResolvedValueOnce('0x6c11a0').mockResolvedValueOnce(genesis).mockResolvedValueOnce(head).mockResolvedValueOnce('0x00');
    await expect(readOfficialTestnetGas({ request, owner, chainId: 7082400 })).rejects.toThrow('quantity');
    const changed = fixture().mockResolvedValueOnce('0x6c11a0').mockResolvedValueOnce(genesis).mockResolvedValueOnce(head)
      .mockResolvedValueOnce('0x1').mockResolvedValueOnce(head).mockResolvedValueOnce('0x282b34');
    await expect(readOfficialTestnetGas({ request: changed, owner, chainId: 7082400 })).rejects.toThrow('wallet network changed');
  });
  it('uses only the official URL and keeps all external catalog assets outside the current private fixture', () => {
    expect(OFFICIAL_COTI_TESTNET_FAUCET_URL).toBe('https://faucet.testnet.coti.io/');
    expect(OFFICIAL_TESTNET_TOKEN_CATALOG).toHaveLength(7);
    for (const [,address] of OFFICIAL_TESTNET_TOKEN_CATALOG) expect(c.tokens.some(([a]) => a.toLowerCase() === address.toLowerCase())).toBe(false);
  });
});
