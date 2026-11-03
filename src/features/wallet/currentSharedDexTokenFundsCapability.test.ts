import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueCurrentSharedDexTokenFundsCapability } from './currentSharedDexTokenFundsCapability';
import { issueOwnerCotiMetaMaskCapability } from './ownerCotiMetaMaskCapability';
import { readCurrentSharedDexTokenFunds } from '../../lib/currentSharedDexTokenFunds';
vi.mock('./ownerCotiMetaMaskCapability', () => ({ hasCurrentDexBrowserSigner:()=>false, issueOwnerCotiMetaMaskCapability: vi.fn() }));
vi.mock('../../lib/currentSharedDexTokenFunds', () => ({ readCurrentSharedDexTokenFunds: vi.fn() }));
vi.mock('../../lib/appShared/core', async original => ({ ...await original<typeof import('../../lib/appShared/core')>(),
  sendCotiScopedRead: (provider: { send: (method: string, params: readonly unknown[]) => Promise<unknown> },
    guard: { run: (read: () => Promise<unknown>) => Promise<unknown> }, method: string, params: readonly unknown[]) =>
    guard.run(() => provider.send(method, params)) }));
const owner = `0x${'11'.repeat(20)}`, key = '000102030405060708090a0b0c0d0e0f';
afterEach(() => vi.clearAllMocks());
describe('selected-owner beta funds capability', () => {
  it('stops later funds requests when the caller hides during a read', async () => {
    let active = true, release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const send = vi.fn(async () => ({ number: '0x97d700', timestamp: '0x6ac00000', hash: `0x${'22'.repeat(32)}` }));
    vi.mocked(issueOwnerCotiMetaMaskCapability).mockImplementation(async args => args.bindCapability({
      assertCurrent: async () => {}, assertSnapshotCurrent: () => {}, readProvider: { send },
      signer: { getUserOnboardInfo: () => ({ aesKey: key }) }, ownerAddress: owner } as never));
    vi.mocked(readCurrentSharedDexTokenFunds).mockImplementation(async args => {
      await held; await args.rpc('eth_chainId', []); await args.rpc('eth_blockNumber', []);
      return { readyToSign: false } as never;
    });
    const capability = await issueCurrentSharedDexTokenFundsCapability({ candidate: 'cheap-history', expectedChainId: 7082400n,
      expectedOwnerAddress: owner, sessionOnboardInfo: { [owner]: { aesKey: key } } } as never);
    const pending = capability.read(() => { if (!active) throw new Error('caller hidden'); });
    await vi.waitFor(() => expect(readCurrentSharedDexTokenFunds).toHaveBeenCalledOnce());
    active = false; release();
    await expect(pending).rejects.toThrow('caller hidden');
    expect(send).toHaveBeenCalledOnce();
  });
  it.each([false, true])('refuses unavailable privacy or wrong chain before issuing or unlocking; wrongChain=%s', wrongChain => {
    expect(() => issueCurrentSharedDexTokenFundsCapability({ expectedChainId: wrongChain ? 2632500n : 7082400n,
      expectedOwnerAddress: owner, sessionOnboardInfo: wrongChain ? { [owner]: { aesKey: key } } : {} } as never)).toThrow('Unlock');
    expect(issueOwnerCotiMetaMaskCapability).not.toHaveBeenCalled();
  });
  it.each(['cheap-prepared', 'cheap-exit'] as const)('uses the exact owner issuer and guarded %s reading', async candidate => {
    const guard = vi.fn(async () => {}), snapshot = vi.fn(), send = vi.fn(async () => ({ number: '0x97d700', timestamp: '0x6ac00000', hash: `0x${'22'.repeat(32)}` }));
    let aes: string | undefined = key;
    vi.mocked(issueOwnerCotiMetaMaskCapability).mockImplementation(async args => {
      expect(args.requirePrivacy).toBe(true); expect(args.refreshPrivacy).toBe(false); expect(args.sessionOnboardInfo).toEqual({ [owner]: { aesKey: key } });
      return args.bindCapability({ assertCurrent: guard, assertSnapshotCurrent: snapshot, readProvider: { send }, signer: { getUserOnboardInfo: () => ({ aesKey: aes }) }, ownerAddress: owner } as never);
    });
    vi.mocked(readCurrentSharedDexTokenFunds).mockResolvedValue({ readyToSign: false } as never);
    const capability = await issueCurrentSharedDexTokenFundsCapability({ candidate, expectedChainId: 7082400n, expectedOwnerAddress: owner, sessionOnboardInfo: { [owner]: { aesKey: key } } } as never);
    expect(Object.keys(capability)).toEqual(['read']); await capability.read();
    expect(readCurrentSharedDexTokenFunds).toHaveBeenCalledWith(expect.objectContaining({ candidate, owner, head: expect.objectContaining({ number: 9950976n }) }));
    const args = vi.mocked(readCurrentSharedDexTokenFunds).mock.calls[0][0]; aes = undefined;
    await expect(capability.read()).rejects.toThrow('Owner privacy');
    await expect(args.assertCurrent()).rejects.toThrow('replaced'); expect(send).toHaveBeenCalledTimes(1);
  });
});
