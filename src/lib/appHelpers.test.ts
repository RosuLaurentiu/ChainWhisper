import { describe, expect, it } from 'vitest';
import {
  buildMessageReferenceKeys,
  getVerifiedEcosystemToken,
  isVerifiedEcosystemToken,
  messageReferencesMatch,
  sanitizeOutgoingMessagePlainText
} from './appHelpers';
import {
  buildMessageWithReactionPayload,
  buildMessageWithReplyPayload,
  decodeMemoPlaintextStrict,
  encodeCompactMemoPlaintext,
  encodeMemoPlaintext,
  parseChatMessagePayload
} from './appShared';

describe('message reference helpers', () => {
  it('matches shared tx references with case-sensitive base64url prefixes', () => {
    const txHash = `0x12345678${'0'.repeat(56)}`;
    const blockNumber = 12345;
    const logIndex = 7;

    const targetKeys = buildMessageReferenceKeys({ txHash, blockNumber, logIndex });
    expect(targetKeys).toContain('s:x9ix-EjRWeA');

    expect(
      messageReferencesMatch(
        { txHash: 'x9ix-EjRWeA', blockNumber },
        { txHash, blockNumber, logIndex }
      )
    ).toBe(true);
  });

  it('round-trips group reaction targets using shared tx references', () => {
    const txHash = `0x12345678${'0'.repeat(56)}`;
    const blockNumber = 12345;
    const logIndex = 7;
    const payload = buildMessageWithReactionPayload(txHash, '👍', '', blockNumber, logIndex, true);
    const parsed = parseChatMessagePayload(payload);

    expect(parsed.cleanText).toBe('');
    expect(parsed.embeddedReaction?.emoji).toBe('👍');
    expect(
      messageReferencesMatch(
        {
          txHash: parsed.embeddedReaction?.targetTxHash,
          blockNumber: parsed.embeddedReaction?.targetBlockNumber,
          logIndex: parsed.embeddedReaction?.targetLogIndex
        },
        { txHash, blockNumber, logIndex }
      )
    ).toBe(true);
  });

  it('preserves user-authored message line breaks', () => {
    const plain = 'first line\nsecond line';
    const payload = buildMessageWithReplyPayload(plain);

    expect(sanitizeOutgoingMessagePlainText(plain)).toBe(plain);
    expect(parseChatMessagePayload(payload).cleanText).toBe(plain);
  });
});

describe('memo plaintext decoding', () => {
  it('accepts encoded ChainWhisper memos', () => {
    const plain = 'hello private chat';

    expect(decodeMemoPlaintextStrict(encodeMemoPlaintext(plain))).toBe(plain);
  });

  it('accepts compact compressed ChainWhisper memos', () => {
    const plain = 'private history '.repeat(80);

    expect(decodeMemoPlaintextStrict(encodeCompactMemoPlaintext(plain))).toBe(plain);
  });

  it('rejects wrong-key decoder output with replacement/control characters', () => {
    expect(decodeMemoPlaintextStrict('2&#\uFFFD~kh\u0004random')).toBeNull();
  });
});

describe('verified ecosystem tokens', () => {
  it('includes the added public ecosystem token', () => {
    const address = '0xe8C3D2248a578e9E020C2447f8148e606090fbfe';

    expect(isVerifiedEcosystemToken(address)).toBe(true);
    expect(getVerifiedEcosystemToken(address.toUpperCase())).toEqual({
      address,
      kind: 'erc20'
    });
  });
});
