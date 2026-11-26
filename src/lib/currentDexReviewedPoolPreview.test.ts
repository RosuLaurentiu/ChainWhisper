import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveCurrentCheapDexCandidate } from './dexV2Deployment';
import { createCurrentPoolSubmissionAdapter } from './currentDexPoolSubmission';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY, currentDexScopedRecordKey } from './currentDexPendingAttempt';
import type { CurrentTransport } from './currentDexSendBoundary';

const browserContexts = vi.hoisted(() => new WeakMap<object, { owner: string }>());
vi.mock('../features/wallet/ownerCotiMetaMaskCapability', () => ({
  hasCurrentDexBrowserSigner: (signer: object | undefined, owner: string) =>
    !!signer && browserContexts.get(signer)?.owner === owner.toLowerCase()
}));

const fixture = (owner: string) => {
  const values = new Map<string, string>();
  const storage = (records: Map<string, string>) => ({
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => records.set(key, value),
    removeItem: (key: string) => records.delete(key)
  });
  const localStorage = storage(values);
  vi.stubGlobal('window', { localStorage, sessionStorage: storage(new Map()) });
  const signer = {};
  const head = { number: 10810508n, hash: `0x${'11'.repeat(32)}`, timestamp: 100n, gasLimit: 120_000_000n };
  const transport = {
    assertCurrent: vi.fn(async () => {}),
    readHead: vi.fn(async () => head),
    readNativeResources: vi.fn(async (head: Awaited<ReturnType<CurrentTransport['readHead']>>) => ({
      owner, head, chainId: 7082400n, latestNonce: 508, pendingNonce: 508, code: '0x',
      gasPrice: 50_000_000n, baseFeePerGas: 1n, balance: 10n ** 18n
    })),
    readNonce: async () => 508,
    readBlockHash: async () => head.hash,
    readTransaction: async () => null,
    waitForReceipt: async () => null,
    estimateGas: async () => { throw new Error('Recovery must not estimate a send'); },
    send: vi.fn(async () => { throw new Error('Recovery must not send'); })
  } satisfies CurrentTransport;
  const attest = vi.fn(async () => {});
  const adapter = createCurrentPoolSubmissionAdapter({
    signer, ownerAddress: owner, chainId: 7082400n, candidate: 'cheap-history',
    transport, attest, requireFunding: async () => { throw new Error('Recovery must not fund'); }, now: () => 100n
  });
  return { signer, transport, values, adapter, attest, newTab: () => {
    vi.stubGlobal('window', { localStorage, sessionStorage: storage(new Map()) });
  } };
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const txHash = `0x${'22'.repeat(32)}`;

describe('owner-reviewed Testnet Pool preview recovery', () => {
  it.each(['approved', 'approved other call', 'declined', 'pending nonce', 'used nonce', 'funding record', 'record with hash', 'changed record',
    'no browser lease', 'archive failure', 'already archived'] as const)(
    'checks the owner-reviewed release of an unsent preview: %s', async scenario => {
      const owner = '0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d';
      const f = fixture(owner), { signer, adapter } = f;
      if (scenario !== 'no browser lease') browserContexts.set(signer, { owner });
      const c = resolveCurrentCheapDexCandidate('cheap-history');
      const pendingKey = currentDexScopedRecordKey(CURRENT_DEX_PENDING_ATTEMPT_KEY, { chainId: c.chainId, graph: c.graph, owner });
      // CW-134: the release no longer binds one recorded call. The second call hash is the 2026-11-26 owner record.
      const callHash = scenario === 'approved other call' ? '0x92b13e4c0793a7f35486548557d7060d6ec60d7c19764092464f265299c4cde9' :
        '0x7d97428b902a35aac58e004dc55f6e436d008001883e547dbfc10f8ed19456c0';
      const record = { version: 1, chainId: c.chainId, graph: `0x${c.graph}`, owner, core: c.core,
        phase: scenario === 'funding record' ? 'pool-fund' : 'pool-preview', nonce: 508,
        txHash: scenario === 'record with hash' ? txHash : null, callHash, ...(scenario === 'funding record' ? { poolTopUpHash: null } : {}) };
      const raw = JSON.stringify(record, null, 2);
      f.values.set(pendingKey, raw);
      if (scenario !== 'record with hash') await expect(adapter.recoverPendingPoolAttempt()).resolves.toMatchObject({ status: 'manual-reconciliation-required' });
      expect(f.transport.readNativeResources).not.toHaveBeenCalled();
      const original = f.transport.readNativeResources.getMockImplementation()!;
      f.transport.readNativeResources.mockImplementation(async head => {
        if (scenario === 'changed record') f.values.set(pendingKey, JSON.stringify({ ...record, txHash }));
        return { ...await original(head), latestNonce: scenario === 'used nonce' ? 509 : 508,
          pendingNonce: scenario === 'pending nonce' || scenario === 'used nonce' ? 509 : 508 };
      });
      if (scenario === 'archive failure') {
        const set = f.values.set.bind(f.values);
        vi.spyOn(f.values, 'set').mockImplementation((key, value) => {
          if (key !== pendingKey) throw new Error('archive unavailable');
          return set(key, value);
        });
      }
      const review = vi.fn(async () => scenario !== 'declined');
      const result = adapter.releaseReviewedPoolPreview(review);
      if (scenario === 'approved' || scenario === 'approved other call' || scenario === 'already archived') {
        await expect(result).resolves.toBe(true);
        expect(f.values.has(pendingKey)).toBe(false);
        f.newTab();
        expect([...f.values]).toEqual([[`chainwhisper:dex:reviewed-pool-preview:v1:${c.chainId}:${c.graph}:${owner}:508:${callHash}`, raw]]);
        if (scenario === 'already archived') {
          f.values.set(pendingKey, raw);
          await expect(adapter.releaseReviewedPoolPreview(review)).rejects.toThrow();
          expect(f.values.get(pendingKey)).toBe(raw);
        }
      } else if (scenario === 'declined') {
        await expect(result).resolves.toBe(false);
        expect(f.transport.readNativeResources).not.toHaveBeenCalled();
        expect(f.values.get(pendingKey)).toBe(raw);
      } else {
        await expect(result).rejects.toThrow();
        expect(f.values.has(pendingKey)).toBe(true);
        expect([...f.values.keys()]).toEqual([pendingKey]);
      }
      if (scenario === 'funding record' || scenario === 'record with hash' || scenario === 'no browser lease') expect(review).not.toHaveBeenCalled();
      expect(f.transport.send).not.toHaveBeenCalled();
    });
});
