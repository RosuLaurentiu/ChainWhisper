import { describe, expect, it } from 'vitest';
import { normalizeWalletPreference } from './appStorage';

describe('wallet preference storage', () => {
  it('keeps app wallet preferences minimal', () => {
    expect(normalizeWalletPreference({ version: 1, kind: 'app', browserWalletId: 'metamask' })).toEqual({
      version: 1,
      kind: 'app'
    });
  });

  it('keeps only a safe browser wallet id', () => {
    expect(normalizeWalletPreference({ version: 1, kind: 'browser', browserWalletId: 'MetaMask' })).toEqual({
      version: 1,
      kind: 'browser',
      browserWalletId: 'metamask'
    });
  });

  it('drops malformed preferences', () => {
    expect(normalizeWalletPreference({ version: 2, kind: 'browser', browserWalletId: 'metamask' })).toBeNull();
    expect(normalizeWalletPreference({ version: 1, kind: 'browser', browserWalletId: '0x1234' })).toEqual({
      version: 1,
      kind: 'browser'
    });
    expect(normalizeWalletPreference({ version: 1, kind: 'browser', browserWalletId: '../../wallet' })).toEqual({
      version: 1,
      kind: 'browser'
    });
  });
});
