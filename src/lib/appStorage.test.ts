import { describe, expect, it } from 'vitest';
import { normalizeWalletPreference } from './appStorage';

describe('wallet preference storage', () => {
  it('normalizes only safe wallet preference fields', () => {
    const cases = [
      {
        label: 'app account preference drops browser wallet details',
        input: { version: 1, kind: 'app', browserWalletId: 'metamask' },
        expected: { version: 1, kind: 'app' }
      },
      {
        label: 'browser wallet preference keeps a normalized safe id',
        input: { version: 1, kind: 'browser', browserWalletId: 'MetaMask' },
        expected: { version: 1, kind: 'browser', browserWalletId: 'metamask' }
      },
      {
        label: 'unsupported versions are dropped',
        input: { version: 2, kind: 'browser', browserWalletId: 'metamask' },
        expected: null
      },
      {
        label: 'address-like ids are dropped',
        input: { version: 1, kind: 'browser', browserWalletId: '0x1234' },
        expected: { version: 1, kind: 'browser' }
      },
      {
        label: 'path-like ids are dropped',
        input: { version: 1, kind: 'browser', browserWalletId: '../../wallet' },
        expected: { version: 1, kind: 'browser' }
      }
    ];

    for (const { expected, input, label } of cases) {
      expect(normalizeWalletPreference(input), label).toEqual(expected);
    }
  });
});
