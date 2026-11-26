import { describe, expect, it, vi } from 'vitest';
import { createCurrentCheapDexSubmissionAdapter } from './currentDexSubmission';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as candidate } from './dexV2Deployment';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY } from './currentDexPendingAttempt';

const owner = `0x${'11'.repeat(20)}`, hash = `0x${'55'.repeat(32)}`;

describe('current DEX swap recovery reader', () => {
  it.each(['limit-owner', 'token-faucet', 'token-approve'])('preserves %s attempts and refuses the swap recovery reader', async phase => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); } } });
    const transport = {
      assertCurrent: vi.fn(), readHead: vi.fn(async () => ({ number: 30n, hash, timestamp: 100n, gasLimit: 150_000_000n })),
      readNonce: vi.fn(async () => 4), readBlockHash: vi.fn(async () => hash), estimateGas: vi.fn(async () => 80_000n),
      send: vi.fn(), readTransaction: vi.fn(async () => null), waitForReceipt: vi.fn(async () => null)
    };
    const record = { version: 1, chainId: '7082400', owner: owner.toLowerCase(),
      core: candidate.core.toLowerCase(), graph: `0x${candidate.graph}`.toLowerCase(),
      phase, callHash: hash, nonce: 4, txHash: null };
    values.set(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify(record));
    const cheap = createCurrentCheapDexSubmissionAdapter({ candidate: 'cheap-history', signer: {}, ownerAddress: owner,
      chainId: 7082400n, transport, attest: async () => {},
      readOperation: async () => { throw new Error('No swap read is permitted'); },
      readReceipt: async () => { throw new Error('No swap read is permitted'); },
      reviewAcceptance: async () => null, requireFunding: async () => {} });
    await expect(cheap.recoverPendingCurrentCheapAttempt()).rejects.toThrow('owner-action pending-attempt reader');
    expect(JSON.parse(values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)!)).toMatchObject({ phase, nonce: 4 });
    expect(transport.send).not.toHaveBeenCalled();
    expect(transport.readTransaction).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
