import { describe, expect, it } from 'vitest';
import { resolveOwnerFundsOnboardInfo } from './useAccountFundsSigners';

describe('resolveOwnerFundsOnboardInfo', () => {
  it('reuses an address-scoped AES key unless an explicit privacy refresh was requested', () => {
    expect(resolveOwnerFundsOnboardInfo({
      cached: { aesKey: 'cached-aes' } as never,
      ownerAesKey: ' owner-aes ',
      refreshPrivacy: false
    })).toMatchObject({ aesKey: 'owner-aes' });
    expect(resolveOwnerFundsOnboardInfo({
      cached: { aesKey: 'stale' } as never,
      ownerAesKey: 'owner-aes',
      refreshPrivacy: true
    })).toBeUndefined();
  });
});
