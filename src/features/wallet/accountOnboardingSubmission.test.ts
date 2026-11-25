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
    await expect(create().request(sendRequest, { request })).rejects.toThrow('Wallet connection interrupted');
    expect(request).toHaveBeenLastCalledWith({
      method: 'eth_sendTransaction',
      params: [{ from: owner, chainId: '0x6c11a0' }]
    });

    const reloaded = create();
    await expect(reloaded.reconcile()).rejects.toThrow('earlier Account Onboarding transaction is unresolved');
    expect(records.size).toBe(1);
    await expect(reloaded.request(sendRequest, { request })).rejects.toThrow('earlier Account Onboarding transaction is unresolved');
    expect(request).toHaveBeenCalledOnce();
  });

  it('requires a mined Testnet receipt and the same wallet before clearing the recorded transaction', async () => {
    const { create, request, records, hasMinedReceipt, assertSnapshotCurrent } = createFixture();
    request.mockResolvedValueOnce(hash);
    await expect(create().request(sendRequest, { request })).resolves.toBe(hash);
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
    await submission.request(sendRequest, { request });
    expect(records.size).toBe(1);
    submission.complete();
    expect(records.size).toBe(0);
  });

  it('keeps the transaction available after a wallet rejection and sends nothing after a lease switch', async () => {
    const { create, request, assertSnapshotCurrent, records } = createFixture();
    request.mockRejectedValueOnce({ code: 4001 });
    await expect(create().request(sendRequest, { request })).rejects.toMatchObject({ code: 4001 });
    expect(records.size).toBe(0);

    request.mockClear();
    assertSnapshotCurrent.mockImplementationOnce(() => { throw new Error('Wallet changed'); });
    await expect(create().request(sendRequest, { request })).rejects.toThrow('Wallet changed');
    expect(request).not.toHaveBeenCalled();
    expect(records.size).toBe(0);
  });
});

describe('Account Onboarding errors hidden by the COTI SDK', () => {
  it('keeps a permission failure from the signature request without recording a transaction', async () => {
    const { create, request, records } = createFixture();
    const submission = create();
    const provider = { request };
    request.mockRejectedValueOnce({ code: 4100, message: 'Private wallet response' });
    await expect(submission.request({ method: 'personal_sign' }, provider)).rejects.toMatchObject({ code: 4100 });
    expect(submission.getFailureMessage()).toBe(
      'MetaMask denied the Account Onboarding signature request. Reconnect this account to ChainWhisper and retry.'
    );
    expect(records.size).toBe(0);
  });

  it('reports a definite transaction validation failure and lets the owner retry', async () => {
    const { create, request, records } = createFixture();
    const submission = create();
    request.mockRejectedValueOnce({ code: -32602 });
    await expect(submission.request(sendRequest, { request })).rejects.toMatchObject({ code: -32602 });
    expect(submission.getFailureMessage()).toContain('MetaMask rejected the Account Onboarding transaction parameters');
    expect(records.size).toBe(0);
  });

  it('retains the retry hold and reports an attempted send when MetaMask returns no usable hash', async () => {
    const { create, request, records } = createFixture();
    const submission = create();
    request.mockResolvedValueOnce(null);
    await expect(submission.request(sendRequest, { request })).rejects.toThrow('usable Account Onboarding transaction hash');
    expect(submission.getFailureMessage()).toContain('Check MetaMask Activity for the submission');
    expect([...records.values()]).toEqual(['unknown']);
  });
});
