import { describe, expect, it } from 'vitest';
import {
  advanceGroupChatV2ReadCursor,
  createGroupChatV2ReadCursor,
  hasUnreadGroupChatV2Message,
  mergeGroupChatV2ReadCursors
} from './groupChatV2ReadCursor';

const SCOPE = {
  chainId: 7_082_400n,
  contractAddress: '0x1111111111111111111111111111111111111111',
  walletAddress: '0x2222222222222222222222222222222222222222',
  groupId: 3n
};
const HASH = `0x${'33'.repeat(32)}`;

describe('groupChatV2ReadCursor', () => {
  it('advances only to a finalized message in the exact group scope', () => {
    const empty = createGroupChatV2ReadCursor(SCOPE);
    const advanced = advanceGroupChatV2ReadCursor({
      cursor: empty,
      scope: SCOPE,
      visibleMessage: {
        direction: 'incoming',
        groupV2: {
          protocol: 'group-v2',
          contentState: 'available',
          chainId: SCOPE.chainId.toString(),
          contractAddress: SCOPE.contractAddress,
          groupId: '3',
          messageId: '8',
          epoch: '2',
          membershipRevision: '4',
          senderSequence: '3',
          nonce: `0x${'44'.repeat(12)}`,
          transactionHash: `0x${'55'.repeat(32)}`,
          blockNumber: '120',
          blockHash: HASH,
          logIndex: 1,
          finality: 'finalized'
        }
      }
    });
    expect(advanced.lastReadMessageId).toBe('8');
    expect(hasUnreadGroupChatV2Message({ cursor: advanced, latestIncomingMessageId: 9n })).toBe(true);
    expect(hasUnreadGroupChatV2Message({ cursor: advanced, latestIncomingMessageId: 8n })).toBe(false);
  });

  it('validates exact canonical anchors and lets a reset generation defeat stale cursors', async () => {
    const stale = createGroupChatV2ReadCursor(SCOPE, 0, {
      messageId: 8n,
      blockNumber: 120n,
      blockHash: HASH
    });
    const reset = createGroupChatV2ReadCursor(SCOPE, 1);
    await expect(mergeGroupChatV2ReadCursors({
      scope: SCOPE,
      cursors: [stale, reset],
      canonicalMessageCount: 8n,
      readCanonicalAnchor: async () => ({ messageId: 8n, blockNumber: 120n, blockHash: HASH })
    })).resolves.toEqual(reset);
  });
});
