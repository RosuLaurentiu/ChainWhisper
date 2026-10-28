import { describe, expect, it, vi } from 'vitest';
import { readCurrentSharedDexTestTokens } from './currentSharedDexTokenRead';
import { readCurrentSharedDexTokenDistribution } from './currentSharedDexTokenDistribution';
vi.mock('./currentSharedDexTokenDistribution', () => ({ readCurrentSharedDexTokenDistribution: vi.fn(async () => ({ readyToSign: false })) }));
const owner = '0x8b749251CF1f712D4e39FD048C53394af03E10bE';
function fixture() {
  let accounts = [owner], chain = '0x6c11a0', current = true;
  const request = vi.fn(async ({ method }: { method: string; params: unknown[] }) => {
    if (method === 'eth_accounts') return accounts;
    if (method === 'eth_chainId') return chain;
    if (method === 'eth_getBlockByNumber') return { number: '0x97d700', hash: `0x${'11'.repeat(32)}`, timestamp: '0x6ac00000' };
    throw new Error('Unexpected wallet method.');
  });
  const run = () => readCurrentSharedDexTestTokens({ request, owner, chainId: 7082400, assertCurrent: () => { if (!current) throw new Error('Stale session.'); } });
  return { request, run, changeOwner: () => { accounts = []; }, changeChain: () => { chain = '0x282b34'; }, expire: () => { current = false; } };
}
describe('selected-wallet public beta funding read', () => {
  it('reads public eligibility without privacy or signing methods', async () => {
    const f = fixture(); await expect(f.run()).resolves.toEqual({ readyToSign: false });
    expect(f.request.mock.calls.every(([args]) => ['eth_accounts', 'eth_chainId', 'eth_getBlockByNumber'].includes(args.method))).toBe(true);
  });
  it('rejects wrong selected account or network before reading distribution', async () => {
    const f = fixture(); f.changeOwner(); await expect(f.run()).rejects.toThrow('selected wallet or network changed');
    const g = fixture(); g.changeChain(); await expect(g.run()).rejects.toThrow('selected wallet or network changed');
  });
  it('rejects wallet drift after the distribution read', async () => {
    const f = fixture(); vi.mocked(readCurrentSharedDexTokenDistribution).mockImplementationOnce(async () => { f.changeOwner(); return { readyToSign: false } as never; });
    await expect(f.run()).rejects.toThrow('selected wallet or network changed');
  });
  it('rejects expired UI scope without requesting the wallet', async () => {
    const f = fixture(); f.expire(); await expect(f.run()).rejects.toThrow('Stale session'); expect(f.request).not.toHaveBeenCalled();
  });
});
