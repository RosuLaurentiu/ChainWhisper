import { Interface, keccak256 } from '@coti-io/coti-ethers';
import { afterEach, expect, it, vi } from 'vitest';
import { ARCHIVED_CHEAP_DEX_CANDIDATE as c } from './dexV2Deployment';
import { CURRENT_CHEAP_DEX_QUOTE_ABI } from './currentDexOperation';
import { createArchivedCheapDexRecovery } from './currentDexSubmission';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY } from './currentDexPendingAttempt';

afterEach(() => vi.unstubAllGlobals());
it.each(['fast-pool', 'cheap-async'] as const)('reconciles exact archived %s without exposing a sender or restoring private authority', async profile => {
  const owner = `0x${'22'.repeat(20)}`, hash = `0x${'33'.repeat(32)}`, blockHash = `0x${'44'.repeat(32)}`, context = `0x${'55'.repeat(32)}`;
  const abi = new Interface(CURRENT_CHEAP_DEX_QUOTE_ABI), method = profile === 'fast-pool' ? 'quoteFastPoolV1' : 'quoteCheapAsyncV1';
  const encrypted = [[1n, 2n], `0x${'11'.repeat(65)}`];
  const terms = [c.tokens[0][0], c.tokens[1][0], owner, 200n, encrypted, encrypted, encrypted, [1n, '0x11'], [1n, '0x11']];
  const data = abi.encodeFunctionData(method, profile === 'fast-pool' ? terms : [terms]);
  const record = { version: 1, chainId: c.chainId, owner, core: c.core, graph: `0x${c.graph}`, phase: 'quote', nonce: 4, callHash: keccak256(data), txHash: hash };
  const values = new Map([[CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify(record)]]);
  vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
  const tx = { hash, chainId: 7082400n, from: owner, to: c.core, value: 0n, data, nonce: 4,
    gasLimit: profile === 'fast-pool' ? 60_000_000n : 50_000_000n, blockNumber: 50, blockHash };
  const event = abi.encodeEventLog(abi.getEvent(profile === 'fast-pool' ? 'FastPoolQuoteIssued' : 'CheapAsyncAdvanced')!,
    profile === 'fast-pool' ? [7n, context, 200n] : [7n, 1, `0x${'00'.repeat(32)}`]);
  const send = vi.fn(async () => { throw new Error('No archived sender is permitted'); });
  const attest = vi.fn(async () => {});
  const recover = createArchivedCheapDexRecovery({ signer: {}, ownerAddress: owner, chainId: 7082400n, now: () => 100n,
    attest, transport: { assertCurrent: () => {}, send, estimateGas: vi.fn(async () => 1n), readNonce: async () => 5,
      readHead: async () => ({ number: 50n, hash: blockHash, timestamp: 100n, gasLimit: 120_000_000n }),
      readTransaction: async () => tx, readBlockHash: async () => blockHash,
      waitForReceipt: async () => ({ hash, status: 1, from: owner, to: c.core, blockNumber: 50, blockHash, logs: [{ address: c.core, ...event }] }) },
    readOperation: async () => ({ operation: { profile, phase: profile === 'fast-pool' ? 'quote-prepared' : 'preparing-quote',
      contextHash: profile === 'fast-pool' ? context : `0x${'00'.repeat(32)}`, deadline: 200n, ready: profile === 'fast-pool', stage: profile === 'cheap-async' ? 1 : undefined } }) });
  expect(typeof recover).toBe('function');
  const result = await recover();
  expect(result).toMatchObject({ status: 'observed-mined', profile, operationId: 7n, readyToSign: false });
  expect(result).not.toHaveProperty('intent');
  expect(values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
  expect(attest).toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
});
