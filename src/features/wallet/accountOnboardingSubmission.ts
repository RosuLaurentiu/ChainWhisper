import {
  isProviderRequestAlreadyPending,
  isProviderRpcTransportUnavailable,
  type Eip1193Provider
} from '../../lib/appShared';

type Request = Parameters<Eip1193Provider['request']>[0];
const pendingMessage = 'The earlier Account Onboarding transaction is unresolved. Check MetaMask Activity before you retry.';
const validHash = (value: unknown): value is string =>
  typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const getRpcCode = (error: unknown): unknown =>
  (error as { code?: unknown } | null)?.code;

const walletPromptErrorMessage = (error: unknown, prompt: 'signature' | 'transaction'): string => {
  const code = getRpcCode(error);
  if (code === 4001 || code === 'ACTION_REJECTED') {
    return `The Account Onboarding ${prompt} was declined in MetaMask.`;
  }
  if (code === 4100) {
    return `MetaMask denied the Account Onboarding ${prompt} request. Reconnect this account to ChainWhisper and retry.`;
  }
  if (isProviderRequestAlreadyPending(error)) {
    return 'MetaMask already has a request open. Open the wallet to approve or reject it.';
  }
  if (code === -32602) {
    return `MetaMask rejected the Account Onboarding ${prompt} parameters (RPC -32602).`;
  }
  if (isProviderRpcTransportUnavailable(error)) {
    return prompt === 'signature'
      ? 'MetaMask lost its connection before the Account Onboarding signature. Reconnect the wallet and retry.'
      : 'MetaMask lost its connection during Account Onboarding. Check MetaMask Activity for the transaction.';
  }
  const diagnostic = typeof code === 'number' && Number.isInteger(code) ? ` (RPC ${code})` : '';
  return prompt === 'signature'
    ? `MetaMask could not complete the Account Onboarding signature${diagnostic}. Open the wallet and check its connection to ChainWhisper.`
    : `MetaMask could not complete the Account Onboarding transaction request${diagnostic}. Check MetaMask Activity before you retry.`;
};

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
  let signatureApproved = false;
  let walletErrorMessage: string | undefined;
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
    if (storage.getItem(storageKey)) {
      walletErrorMessage = pendingMessage;
      throw new Error(pendingMessage);
    }
    storage.setItem(storageKey, 'unknown');
    let hash: unknown;
    try {
      hash = await provider.request({
        method: request.method,
        params: [{ ...transaction, chainId: `0x${chainId.toString(16)}` }]
      });
    } catch (error) {
      const code = getRpcCode(error);
      // These RPC responses indicate that the wallet declined the request before broadcast.
      if (code === 4001 || code === 'ACTION_REJECTED' ||
        code === 4100 || code === 4200 || code === -32601 || code === -32602) {
        storage.removeItem(storageKey);
      }
      walletErrorMessage = walletPromptErrorMessage(error, 'transaction');
      throw error;
    }
    if (!validHash(hash)) {
      walletErrorMessage = 'MetaMask did not return a usable Account Onboarding transaction hash. Check MetaMask Activity for the submission.';
      throw new Error(walletErrorMessage);
    }
    submittedHash = hash;
    storage.setItem(storageKey, hash);
    return hash;
  };

  return {
    complete: () => {
      if (submittedHash && storage.getItem(storageKey) === submittedHash) storage.removeItem(storageKey);
    },
    getFailureMessage: () => {
      if (walletErrorMessage) return walletErrorMessage;
      if (submittedHash) {
        return 'ChainWhisper could not recover the key from the Account Onboarding transaction. Check its status in MetaMask Activity.';
      }
      return signatureApproved
        ? 'The MetaMask signature completed. ChainWhisper could not prepare the Account Onboarding transaction.'
        : 'ChainWhisper could not prepare the Account Onboarding signature. Check that MetaMask is connected to this account on COTI Testnet.';
    },
    reconcile,
    request: async (request: Request, guardedProvider: Eip1193Provider): Promise<unknown> => {
      if (request.method === 'eth_sendTransaction') {
        return typeof navigator !== 'undefined' && navigator.locks
          ? navigator.locks.request(storageKey, () => send(request))
          : send(request);
      }
      if (request.method !== 'personal_sign') return guardedProvider.request(request);
      try {
        const signature = await guardedProvider.request(request);
        signatureApproved = true;
        return signature;
      } catch (error) {
        walletErrorMessage = walletPromptErrorMessage(error, 'signature');
        throw error;
      }
    }
  };
};
