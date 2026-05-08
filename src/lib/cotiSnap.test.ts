import { describe, expect, it } from 'vitest';
import { getCotiSnapAesStatus } from './cotiSnap';
import type { Eip1193Provider } from './appShared';

const snapId = 'npm:@coti-io/coti-snap';

const provider = (handler: (method: string) => unknown): Eip1193Provider =>
  ({
    request: async ({ method }: { method: string }) => handler(method)
  }) as unknown as Eip1193Provider;

describe('getCotiSnapAesStatus', () => {
  it('detects unsupported Snap discovery without prompting install', async () => {
    await expect(
      getCotiSnapAesStatus(
        provider(() => {
          throw new Error('unsupported');
        })
      )
    ).resolves.toBe('unsupported');
  });

  it('detects missing and installed Snap AES states', async () => {
    await expect(getCotiSnapAesStatus(provider((method) => (method === 'wallet_getSnaps' ? {} : null)))).resolves.toBe(
      'not-installed'
    );
    await expect(
      getCotiSnapAesStatus(
        provider((method) => {
          if (method === 'wallet_getSnaps') return { [snapId]: {} };
          if (method === 'wallet_invokeSnap') return true;
          return null;
        })
      )
    ).resolves.toBe('installed-aes-ready');
    await expect(
      getCotiSnapAesStatus(
        provider((method) => {
          if (method === 'wallet_getSnaps') return { [snapId]: {} };
          if (method === 'wallet_invokeSnap') return false;
          return null;
        })
      )
    ).resolves.toBe('installed-aes-missing');
  });
});
