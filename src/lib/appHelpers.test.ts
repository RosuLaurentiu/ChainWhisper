import { describe, expect, it } from 'vitest';
import { buildMessageReferenceKeys, messageReferencesMatch } from './appHelpers';
import { buildMessageWithReactionPayload, parseChatMessagePayload } from './appShared';

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
});
