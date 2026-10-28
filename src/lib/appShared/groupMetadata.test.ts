import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GROUP_JOIN_CODE_ALPHABET,
  GROUP_JOIN_CODE_LENGTH,
  GROUP_PRIVATE_TITLE_LABEL,
  GROUP_TITLE_COMPACT_PREFIX,
  encodeStoredGroupTitle,
  generateRandomGroupJoinCode,
  normalizeGroupJoinCode,
  parseGroupInviteCode,
  parseStoredGroupTitle
} from './groupMetadata';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('group join-code generation', () => {
  it('generates a 130-bit base32 code from a cryptographically secure source', () => {
    const getRandomValues = vi.fn((values: Uint8Array) => {
      for (let index = 0; index < values.length; index += 1) {
        values[index] = index;
      }
      return values;
    });
    vi.stubGlobal('crypto', { getRandomValues });

    const code = generateRandomGroupJoinCode();

    expect(code).toHaveLength(GROUP_JOIN_CODE_LENGTH);
    expect(GROUP_JOIN_CODE_LENGTH * Math.log2(GROUP_JOIN_CODE_ALPHABET.length)).toBeGreaterThanOrEqual(128);
    expect(code).toMatch(new RegExp(`^[${GROUP_JOIN_CODE_ALPHABET}]+$`));
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  it('fails closed when secure randomness is unavailable', () => {
    vi.stubGlobal('crypto', undefined);

    expect(() => generateRandomGroupJoinCode()).toThrow(
      'Secure join-code generation is unavailable in this browser.'
    );
  });

  it('accepts only the new 26-character format and the known 5-character legacy format', () => {
    const currentCode = 'A'.repeat(GROUP_JOIN_CODE_LENGTH);

    expect(normalizeGroupJoinCode(currentCode.toLowerCase(), { allowLegacy: false })).toBe(currentCode);
    expect(normalizeGroupJoinCode('ABCDE', { allowLegacy: true })).toBe('ABCDE');
    expect(normalizeGroupJoinCode('ABCDE', { allowLegacy: false })).toBeNull();
    expect(normalizeGroupJoinCode('A'.repeat(6), { allowLegacy: true })).toBeNull();
    expect(normalizeGroupJoinCode('A'.repeat(25), { allowLegacy: true })).toBeNull();
    expect(normalizeGroupJoinCode('A'.repeat(27), { allowLegacy: true })).toBeNull();
    expect(normalizeGroupJoinCode('A'.repeat(64), { allowLegacy: true })).toBeNull();
    expect(
      normalizeGroupJoinCode(`${'A'.repeat(GROUP_JOIN_CODE_LENGTH - 1)}0`, { allowLegacy: false })
    ).toBeNull();
    expect(parseGroupInviteCode(`7:${currentCode}`)).toMatchObject({
      version: 2,
      groupId: 7,
      code: currentCode
    });
    expect(parseGroupInviteCode('7:ABCD')).toBeNull();
  });
});

describe('stored group titles', () => {
  it('writes only a versioned generic marker for a new private group', async () => {
    const sensitiveTitle = 'Acquisition target alpha';

    const encoded = await encodeStoredGroupTitle(sensitiveTitle, true);

    expect(encoded).toMatch(new RegExp(`^${GROUP_TITLE_COMPACT_PREFIX}p:`));
    expect(encoded).not.toContain(sensitiveTitle);
    expect(new TextEncoder().encode(encoded).length).toBeLessThanOrEqual(64);
    await expect(parseStoredGroupTitle(encoded, 17)).resolves.toEqual({
      title: GROUP_PRIVATE_TITLE_LABEL,
      isPrivate: true
    });
  });

  it('keeps public title writes and reads usable', async () => {
    const encoded = await encodeStoredGroupTitle('Builders', false);

    expect(encoded).toMatch(new RegExp(`^${GROUP_TITLE_COMPACT_PREFIX}u:`));
    await expect(parseStoredGroupTitle(encoded, 18)).resolves.toEqual({
      title: 'Builders',
      isPrivate: false
    });
  });

  it('continues to read legacy encrypted private titles', async () => {
    const encodedPublic = await encodeStoredGroupTitle('Legacy private title', false);
    const legacyPrivate = encodedPublic.replace(`${GROUP_TITLE_COMPACT_PREFIX}u:`, `${GROUP_TITLE_COMPACT_PREFIX}p:`);

    await expect(parseStoredGroupTitle(legacyPrivate, 19)).resolves.toEqual({
      title: 'Legacy private title',
      isPrivate: true
    });
  });
});
