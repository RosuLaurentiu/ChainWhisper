import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueCurrentSharedDexTokenFundsCapability } from './currentSharedDexTokenFundsCapability';
import { issueOwnerCotiMetaMaskCapability } from './ownerCotiMetaMaskCapability';
import { readCurrentSharedDexTokenFunds } from '../../lib/currentSharedDexTokenFunds';
vi.mock('./ownerCotiMetaMaskCapability', () => ({ issueOwnerCotiMetaMaskCapability: vi.fn() }));
vi.mock('../../lib/currentSharedDexTokenFunds', () => ({ readCurrentSharedDexTokenFunds: vi.fn() }));
const owner = `0x${'11'.repeat(20)}`, key = '000102030405060708090a0b0c0d0e0f';
afterEach(() => vi.clearAllMocks());
describe('selected-owner beta funds capability', () => {
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
    await expect(args.assertCurrent()).rejects.toThrow('Owner privacy'); expect(send).toHaveBeenCalledTimes(1);
  });
});
