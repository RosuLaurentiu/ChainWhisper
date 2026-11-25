import type { Eip1193Provider } from '../../lib/appShared';

type Request = Parameters<Eip1193Provider['request']>[0];
const pendingMessage = 'The earlier Account Onboarding transaction is unresolved. Check MetaMask Activity before you retry.';
const validHash = (value: unknown): value is string =>
  typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);

export const createAccountOnboardingSubmission = (
  provider: Eip1193Provider,
  chainId: number,
  owner: string,
  assertCurrent: () => Promise<void>,
  assertSnapshotCurrent: () => void,
  hasMinedReceipt: (hash: string) => Promise<boolean>,
  storage: Storage
) => {
  // The retry record contains public transaction metadata only.
  const storageKey = `chainwhisper:account-onboarding:v1:${chainId}:${owner}`;
  let submittedHash: string | undefined;
  const reconcile = async (): Promise<void> => {
    const recorded = storage.getItem(storageKey);
    if (!recorded) return;
    if (!validHash(recorded)) {
      throw new Error('The earlier Account Onboarding transaction is unresolved. MetaMask did not return a transaction hash. Account Onboarding is locked in this browser.');
    }
    if (!await hasMinedReceipt(recorded)) throw new Error(pendingMessage);
    await assertCurrent();
    assertSnapshotCurrent();
    if (storage.getItem(storageKey) === recorded) storage.removeItem(storageKey);
  };

  const send = async (request: Request): Promise<unknown> => {
    const transaction = Array.isArray(request.params) ? request.params[0] : undefined;
    if (!transaction || typeof transaction.from !== 'string' || transaction.from.toLowerCase() !== owner) {
      throw new Error('Account Onboarding could not prepare its transaction.');
    }
    await assertCurrent();
    assertSnapshotCurrent();
    if (storage.getItem(storageKey)) throw new Error(pendingMessage);
    storage.setItem(storageKey, 'unknown');
    try {
      const hash = await provider.request({
        method: request.method,
        params: [{ ...transaction, chainId: `0x${chainId.toString(16)}` }]
      });
      if (validHash(hash)) {
        storage.setItem(storageKey, hash);
        submittedHash = hash;
      }
      return hash;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 4001 || code === 'ACTION_REJECTED') storage.removeItem(storageKey);
      throw error;
    }
  };

  return {
    complete: () => {
      if (submittedHash && storage.getItem(storageKey) === submittedHash) storage.removeItem(storageKey);
    },
    reconcile,
    send: (request: Request) => typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request(storageKey, () => send(request))
      : send(request)
  };
};
