import { describe, expect, it, vi } from 'vitest';
import type { Eip1193Provider } from '../../lib/appShared';
import { createAccountOnboardingSubmission } from './accountOnboardingSubmission';

const owner = '0x1111111111111111111111111111111111111111';
const hash = `0x${'c'.repeat(64)}`;
const sendRequest = { method: 'eth_sendTransaction', params: [{ from: owner }] };

const createFixture = () => {
  const records = new Map<string, string>();
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => records.set(key, value),
    removeItem: (key: string) => records.delete(key)
  } as unknown as Storage;
  const request = vi.fn<Eip1193Provider['request']>();
  const provider = { request };
  const assertCurrent = vi.fn(async () => {});
  const assertSnapshotCurrent = vi.fn();
  const hasMinedReceipt = vi.fn(async (_hash: string) => false);
  const create = () => createAccountOnboardingSubmission(
    provider, 7082400, owner, assertCurrent, assertSnapshotCurrent, hasMinedReceipt, storage
  );
  return { create, request, assertSnapshotCurrent, hasMinedReceipt, records };
};

describe('Account Onboarding transaction recovery', () => {
  it('holds a submission with an unknown hash across a reload', async () => {
    const { create, request, records } = createFixture();
    request.mockRejectedValueOnce(new Error('Wallet connection interrupted'));
    await expect(create().send(sendRequest)).rejects.toThrow('Wallet connection interrupted');
    expect(request).toHaveBeenLastCalledWith({
      method: 'eth_sendTransaction',
      params: [{ from: owner, chainId: '0x6c11a0' }]
    });

    const reloaded = create();
    await expect(reloaded.reconcile()).rejects.toThrow('earlier Account Onboarding transaction is unresolved');
    expect(records.size).toBe(1);
    await expect(reloaded.send(sendRequest)).rejects.toThrow('earlier Account Onboarding transaction is unresolved');
    expect(request).toHaveBeenCalledOnce();
  });

  it('requires a mined Testnet receipt and the same wallet before clearing the recorded transaction', async () => {
    const { create, request, records, hasMinedReceipt, assertSnapshotCurrent } = createFixture();
    request.mockResolvedValueOnce(hash);
    await expect(create().send(sendRequest)).resolves.toBe(hash);
    await expect(create().reconcile()).rejects.toThrow('earlier Account Onboarding transaction is unresolved');
    hasMinedReceipt.mockResolvedValue(true);
    assertSnapshotCurrent.mockImplementationOnce(() => { throw new Error('Wallet changed'); });
    await expect(create().reconcile()).rejects.toThrow('Wallet changed');
    expect(records.size).toBe(1);
    await create().reconcile();
    expect(hasMinedReceipt).toHaveBeenLastCalledWith(hash);
    expect(records.size).toBe(0);
  });

  it('clears the record once this attempt finishes processing its receipt', async () => {
    const { create, request, records } = createFixture();
    const submission = create();
    request.mockResolvedValueOnce(hash);
    await submission.send(sendRequest);
    expect(records.size).toBe(1);
    submission.complete();
    expect(records.size).toBe(0);
  });

  it('keeps the transaction available after a wallet rejection and sends nothing after a lease switch', async () => {
    const { create, request, assertSnapshotCurrent, records } = createFixture();
    request.mockRejectedValueOnce({ code: 4001 });
    await expect(create().send(sendRequest)).rejects.toMatchObject({ code: 4001 });
    expect(records.size).toBe(0);

    request.mockClear();
    assertSnapshotCurrent.mockImplementationOnce(() => { throw new Error('Wallet changed'); });
    await expect(create().send(sendRequest)).rejects.toThrow('Wallet changed');
    expect(request).not.toHaveBeenCalled();
    expect(records.size).toBe(0);
  });
});
