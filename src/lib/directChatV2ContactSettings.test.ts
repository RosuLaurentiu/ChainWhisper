import { describe, expect, it } from 'vitest';
import {
  decodeDirectChatV2ContactSettings,
  encodeDirectChatV2ContactSettings,
  isEmptyDirectChatV2ContactSettings,
  normalizeDirectChatV2ContactSavedName,
  readDirectChatV2ContactSettingsSerially
} from './directChatV2ContactSettings';

describe('Direct Chat V2 private contact settings', () => {
  it('round-trips one saved name and one unified hidden flag', () => {
    const encoded = encodeDirectChatV2ContactSettings({ savedName: ' Alice ', hidden: true });
    expect(encoded).toBe('11Alice');
    expect(decodeDirectChatV2ContactSettings(`${encoded}\0\0`)).toEqual({
      savedName: 'Alice',
      hidden: true
    });
  });

  it('treats visible without a saved name as an empty record', () => {
    expect(isEmptyDirectChatV2ContactSettings({ savedName: ' ', hidden: false })).toBe(true);
    expect(isEmptyDirectChatV2ContactSettings({ savedName: '', hidden: true })).toBe(false);
  });

  it('accepts Unicode up to 32 UTF-8 bytes and rejects controls or overflow', () => {
    expect(normalizeDirectChatV2ContactSavedName('é'.repeat(16))).toBe('é'.repeat(16));
    expect(() => normalizeDirectChatV2ContactSavedName('é'.repeat(17))).toThrow(/32 UTF-8 bytes/);
    expect(() => normalizeDirectChatV2ContactSavedName('bad\nname')).toThrow(/control/);
  });

  it('fails closed on malformed or unsupported decrypted payloads', () => {
    expect(() => decodeDirectChatV2ContactSettings('20Alice')).toThrow(/unsupported schema/);
    expect(() => decodeDirectChatV2ContactSettings('12Alice')).toThrow(/hidden flag/);
    expect(() => decodeDirectChatV2ContactSettings(1)).toThrow(/not text/);
  });

  it('deduplicates and reads private settings with concurrency one', async () => {
    let active = 0;
    let maximumActive = 0;
    const read = async (contact: string) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return {
        exists: true,
        revision: 1n,
        settings: { savedName: contact, hidden: false }
      };
    };

    const loaded = await readDirectChatV2ContactSettingsSerially({
      contacts: [' 0xAA ', '0xaa', '0xBB'],
      read
    });

    expect(maximumActive).toBe(1);
    expect(loaded.map(([contact]) => contact)).toEqual(['0xaa', '0xbb']);
  });

  it('stops before another wallet read after its scope is retired', async () => {
    let current = true;
    const read = async () => {
      current = false;
      return {
        exists: false,
        revision: 0n,
        settings: { savedName: '', hidden: false }
      };
    };

    await expect(readDirectChatV2ContactSettingsSerially({
      contacts: ['0xaa', '0xbb'],
      read,
      shouldContinue: () => current
    })).resolves.toEqual([]);
  });
});
