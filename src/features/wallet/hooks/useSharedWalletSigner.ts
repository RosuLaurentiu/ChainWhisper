import { type JsonRpcSigner, type OnboardInfo } from '@coti-io/coti-ethers';
import {
  mergeOnboardInfoByAddress,
  type Eip1193Provider
} from '../../../lib/appShared';

type SignerLeaseAssertion = () => void | Promise<void>;

const isLeaseGuardedProviderMethod = (method: string): boolean =>
  method.startsWith('eth_send') ||
  method.startsWith('eth_sign') ||
  method === 'eth_decrypt' ||
  method.startsWith('personal_sign') ||
  method === 'personal_unlockAccount' ||
  method.startsWith('wallet_');

export const createLeaseGuardedEip1193Provider = (
  provider: Eip1193Provider,
  assertCurrent: SignerLeaseAssertion,
  assertSnapshotCurrent: () => void
): Eip1193Provider => new Proxy(provider, {
  get(target, property) {
    if (property === 'request') {
      return async (request: { method: string; params?: unknown[] | object }) => {
        if (isLeaseGuardedProviderMethod(request.method)) {
          await assertCurrent();
          assertSnapshotCurrent();
        }
        return target.request(request);
      };
    }
    const value = Reflect.get(target, property, target) as unknown;
    return typeof value === 'function' ? value.bind(target) as unknown : value;
  }
});

const GUARDED_SIGNER_METHODS = new Set<PropertyKey>([
  '_legacySignMessage',
  'authorize',
  'decryptValue',
  'encrypt',
  'encryptValue',
  'encryptValue256',
  'generateOrRecoverAes',
  'sendUncheckedTransaction',
  'sendTransaction',
  'signTransaction',
  'signMessage',
  'signTypedData',
  'unlock',
  '_signTypedData'
]);

const GUARDED_SYNC_SIGNER_METHODS = new Set<PropertyKey>([
  'authorizeSync',
  'clearUserOnboardInfo',
  'disableAutoOnboard',
  'enableAutoOnboard',
  'getAutoOnboard',
  'getUserOnboardInfo',
  'encryptSync',
  'setAesKey',
  'setOnboardTxHash',
  'setRsaKeyPair',
  'setUserOnboardInfo',
  'signMessageSync'
]);

const GUARDED_SIGNER_PROPERTIES = new Set<PropertyKey>([
  'mnemonic',
  'privateKey',
  'provider',
  'signingKey'
]);

const POST_ASSERT_GUARDED_SIGNER_METHODS = new Set<PropertyKey>([
  'authorize',
  'decryptValue',
  'encrypt',
  'encryptValue',
  'encryptValue256',
  'generateOrRecoverAes',
  '_legacySignMessage',
  'signMessage',
  'signTransaction',
  'signTypedData',
  'unlock',
  '_signTypedData'
]);

export const createGuardedSignerLease = <T extends JsonRpcSigner>(
  signer: T,
  assertCurrent: SignerLeaseAssertion,
  assertSnapshotCurrent: () => void
): T => {
  if ('privateKey' in signer || 'signingKey' in signer || 'mnemonic' in signer) {
    throw new Error('ChainWhisper only accepts a selected browser-wallet signer.');
  }
  const guardedSigner = new Proxy(signer, {
    get(target, property) {
      if (GUARDED_SIGNER_PROPERTIES.has(property)) {
        assertSnapshotCurrent();
      }
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== 'function') {
        return value;
      }
      if (property === 'connect') {
        return () => {
          assertSnapshotCurrent();
          throw new Error('A leased wallet signer cannot be reconnected to another provider.');
        };
      }
      if (GUARDED_SYNC_SIGNER_METHODS.has(property)) {
        return (...args: unknown[]) => {
          assertSnapshotCurrent();
          const result = Reflect.apply(value, target, args) as unknown;
          assertSnapshotCurrent();
          return result;
        };
      }
      if (GUARDED_SIGNER_METHODS.has(property)) {
        return async (...args: unknown[]) => {
          await assertCurrent();
          assertSnapshotCurrent();
          const result = await Reflect.apply(value, target, args) as unknown;
          if (POST_ASSERT_GUARDED_SIGNER_METHODS.has(property)) {
            await assertCurrent();
            assertSnapshotCurrent();
          }
          return result;
        };
      }
      return value.bind(target) as unknown;
    }
  });
  return guardedSigner;
};

export const mergeLeaseScopedOnboardInfo = (
  previous: Record<string, OnboardInfo>,
  cacheKey: string,
  onboardInfo: OnboardInfo,
  assertSnapshotCurrent: () => void
): Record<string, OnboardInfo> => {
  try {
    assertSnapshotCurrent();
    return mergeOnboardInfoByAddress(previous, cacheKey, onboardInfo);
  } catch {
    return previous;
  }
};
