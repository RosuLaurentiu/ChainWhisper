import { describe, expect, it } from 'vitest';
import { mergeUniqueContacts } from './parsers';

const alice = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1111';
const bob = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2222';

describe('mergeUniqueContacts', () => {
  it('preserves saved names and preferences across discovery and repeated polls without mutation', () => {
    const existing = [{ address: alice, name: 'Public', savedName: 'Private', muted: true, hidden: false }];
    const before = structuredClone(existing);
    for (const discovered of [[], [alice], [bob]]) {
      const merged = mergeUniqueContacts(existing, discovered);
      expect(merged[0]).toEqual(existing[0]);
      expect(mergeUniqueContacts(merged, discovered)).toEqual(merged);
    }
    expect(existing).toEqual(before);
  });

  it('merges duplicates case insensitively and preserves an explicit empty saved name', () => {
    expect(mergeUniqueContacts([
      { address: alice, savedName: '', name: 'First', hidden: true },
      { address: alice.toUpperCase().replace('0X', '0x'), savedName: 'Stale', name: 'Second', muted: false }
    ], [])).toEqual([{ address: alice, savedName: '', name: 'First', hidden: true, muted: false }]);
    expect(mergeUniqueContacts([{ address: alice }, { address: alice, savedName: 'Private' }], []))
      .toEqual([{ address: alice, savedName: 'Private' }]);
  });

  it('preserves unresolved references and transfers metadata when a short reference resolves', () => {
    const short = '0xaaaa...1111';
    expect(mergeUniqueContacts([{ address: short, savedName: 'Private', hidden: true }], []))
      .toEqual([{ address: short, savedName: 'Private', hidden: true }]);
    expect(mergeUniqueContacts([{ address: short, savedName: 'Private', hidden: true }], [alice]))
      .toEqual([{ address: alice, savedName: 'Private', hidden: true }]);
    expect(mergeUniqueContacts([{ address: alice, savedName: '' }, { address: short, savedName: 'Stale' }], []))
      .toEqual([{ address: alice, savedName: '' }]);
    expect(mergeUniqueContacts([{ address: short }, { address: short.toUpperCase(), savedName: 'Private' }], []))
      .toEqual([{ address: short, savedName: 'Private' }]);
  });

  it('keeps a private name on an ambiguous short reference', () => {
    const other = '0xaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1111';
    expect(mergeUniqueContacts([{ address: '0xaaaa...1111', savedName: 'Private' }], [alice, other]))
      .toEqual([{ address: alice }, { address: other }, { address: '0xaaaa...1111', savedName: 'Private' }]);
  });
});
