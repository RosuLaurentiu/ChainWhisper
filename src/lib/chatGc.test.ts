import { describe, expect, it } from 'vitest';
import {
  CHAT_CONTRACT_ABI,
  CHAT_CONTRACT_ADDRESS,
  LEGACY_CHAT_BACKUP_CONTRACT_ABI,
  LEGACY_CHAT_BACKUP_CONTRACT_ADDRESS,
  loadCotiEthersModule
} from './appShared';
import {
  buildChatGcMessageKey,
  parseChatGcConversationRefs,
  parseChatGcMessageView,
  splitUtf8SafeChunks
} from './chatGc';

describe('ChatGC helpers', () => {
  it('scopes ChatGC message IDs by chain and contract address', () => {
    expect(buildChatGcMessageKey(12n)).toBe(`chatgc:2632500:${CHAT_CONTRACT_ADDRESS.toLowerCase()}:12`);
  });

  it('splits multipart plaintext without cutting UTF-8 characters', () => {
    const value = 'hello 😈 privacy desk';
    const chunks = splitUtf8SafeChunks(value, 8);

    expect(chunks.join('')).toBe(value);
    for (const chunk of chunks) {
      expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(8);
    }
  });

  it('parses recent conversation previews from ChatGC state rows', () => {
    const refs = parseChatGcConversationRefs([
      ['0x1111111111111111111111111111111111111111', 4n, 200n, 20n],
      {
        peer: '0x2222222222222222222222222222222222222222',
        messageId: 5n,
        blockNumber: 201n,
        timestamp: 21n
      }
    ]);

    expect(refs.map((ref) => ref.address.toLowerCase())).toEqual([
      '0x2222222222222222222222222222222222222222',
      '0x1111111111111111111111111111111111111111'
    ]);
    expect(refs[0]?.messageId).toBe('5');
  });

  it('parses ChatGC message views', () => {
    const ciphertext = [{ value: [1n] }, { value: [2n] }];
    const parsed = parseChatGcMessageView([
      7n,
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      300n,
      30n,
      2,
      5n,
      1n,
      ciphertext
    ]);

    expect(parsed).toMatchObject({
      id: '7',
      idNumber: 7,
      blockNumber: 300,
      timestamp: 30,
      chunkCount: 2,
      ciphertext
    });
    expect(parsed?.valueSent).toBe(5n);
    expect(parsed?.feeTaken).toBe(1n);
  });
});

describe('ChatGC ABI split', () => {
  it('keeps active chat and legacy backup on separate addresses and ABIs', async () => {
    const cotiEthers = await loadCotiEthersModule();
    const chatInterface = new cotiEthers.Interface(CHAT_CONTRACT_ABI);
    const backupInterface = new cotiEthers.Interface(LEGACY_CHAT_BACKUP_CONTRACT_ABI);

    expect(CHAT_CONTRACT_ADDRESS.toLowerCase()).toBe('0xe5101d33986c91565d2c9f8b49aaf0b8ffee2243');
    expect(LEGACY_CHAT_BACKUP_CONTRACT_ADDRESS.toLowerCase()).toBe(
      '0xf4cab1599aafbbb68677682354b7c1760bcf6c48'
    );
    expect(chatInterface.getFunction('submitMultipart')?.name).toBe('submitMultipart');
    expect(chatInterface.getEvent('MessageSubmitted')?.inputs[0]?.name).toBe('messageId');
    expect(backupInterface.getFunction('submit')?.name).toBe('submit');
    expect(backupInterface.getFunction('submitMultipart')).toBeNull();
  });
});
