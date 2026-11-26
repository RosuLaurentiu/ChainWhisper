import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentCheapDexGasCaps } from './currentDexSubmission';
import { createCurrentAttemptBoundary } from './currentDexSendBoundary';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE, rejectUnprovenNativeAdmission } from './dexV2Deployment';
import { CURRENT_EXIT_SWAP_GAS_CAPS } from './currentDexExitSwapPolicy';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const c = STAGED_SHARED_HISTORY_DEX_CANDIDATE;
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const owner = `0x${'22'.repeat(20)}`, hash = `0x${'33'.repeat(32)}`;
  const transport = { assertCurrent: vi.fn(), readHead: vi.fn(async () => ({ number: 10n, hash, timestamp: 100n, gasLimit: 120_000_000n })),
    readNonce: vi.fn(async () => 4),
    readNativeResources: vi.fn(async (head: {number: bigint; hash: string; timestamp: bigint; gasLimit: bigint}) => ({ owner, chainId: 7082400n, head, latestNonce: 4, pendingNonce: 4, gasPrice: 50_000_000n, baseFeePerGas: 1n, balance: 10n**18n, code: '0x' })), readBlockHash: vi.fn(async () => hash),
    readTransaction: vi.fn(async () => null), estimateGas: vi.fn(async () => 37_000_000n), waitForReceipt: vi.fn(async () => null),
    verifyCanonicalInclusion: vi.fn(async () => {}),
    send: vi.fn(async (request: { chainId: bigint; from: string; to: string; value: 0n; data: string; nonce?: number; gasLimit: bigint }) => ({ ...request, hash })) };
  const boundary = createCurrentAttemptBoundary({ storage, c, core: c.core, owner, chainId: 7082400n, transport,
    attest: vi.fn(async () => {}), now: () => 100n, historical: false });
  const call = { chainId: 7082400n, from: owner, to: c.core, value: 0n as const, data: '0x1234' };
  return { c, owner, values, transport, boundary, validate: vi.fn(), signing: vi.fn(), call };
}
describe('current native caps and strict fit', () => {
  it.each(['quote', 'accept', 'cancel', 'recover', 'token-approve', 'pool-fund'] as const)('blocks an unscoped current %s at the shared boundary before reads, estimation or reservation', async phase => {
    const f = fixture();
    await expect(f.boundary.sendCurrent(phase, f.call, 200n, f.validate, f.signing)).rejects.toThrow('signing hold');
    expect(f.transport.readHead).not.toHaveBeenCalled();
    expect(f.transport.estimateGas).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(f.signing).not.toHaveBeenCalled(); expect(f.values.size).toBe(0);
  });
  it('selects the exact accepted current native phase caps without activation', () => {
    expect(currentCheapDexGasCaps(STAGED_SHARED_HISTORY_DEX_CANDIDATE)).toBe(CURRENT_EXIT_SWAP_GAS_CAPS);
    expect(currentCheapDexGasCaps()).toBe(CURRENT_EXIT_SWAP_GAS_CAPS);
    expect(rejectUnprovenNativeAdmission).toThrow(/admission is absent/);
  });
});
