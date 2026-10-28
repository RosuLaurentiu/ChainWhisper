import { describe, expect, it } from 'vitest';
import {
  buildDirectConversationReadScopeKey,
  collectMemoSignerOnboardInfoUpdates,
  filterLegacyConversationPreferenceStateByDirection,
  historyEntryToChatMessage,
  mergeDirectHistoryEntries,
  mergeMemoSignerOnboardInfoUpdates,
  pruneDirectMessagesOutsideReadScope,
  resolveDirectUnreadState
} from './directConversationSyncHelpers';
import type { ChatMessage, HistoryEntry } from './appShared';
import { buildWalletAccountScope } from './walletAccountScope';

const wallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const peer = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: '0xtx-1-out',
  contact: peer,
  direction: 'outgoing',
  text: 'hello',
  txHash: '0xtx',
  blockNumber: 10,
  logIndex: 1,
  timestamp: 100,
  ...overrides
});

describe('directConversationSyncHelpers', () => {
  it('collects lease-sensitive signer state before running a pure React state merge', () => {
    const onboardInfo = { aesKey: '11'.repeat(16) };
    const updates = collectMemoSignerOnboardInfoUpdates([{
      cacheKey: 'owner',
      signer: { getUserOnboardInfo: () => onboardInfo }
    }]);
    const throwingSigner = {
      getUserOnboardInfo: () => { throw new Error('expired wallet lease'); }
    };

    expect(updates).toEqual([{ cacheKey: 'owner', onboardInfo }]);
    expect(mergeMemoSignerOnboardInfoUpdates({}, updates)).toEqual({ owner: onboardInfo });
    expect(() => collectMemoSignerOnboardInfoUpdates([{
      cacheKey: 'owner',
      signer: throwingSigner
    }])).toThrow('expired wallet lease');
  });

  it('accepts legacy contact preferences only from the wallet own outgoing history', () => {
    const state = { hidden: true, muted: true };

    expect(filterLegacyConversationPreferenceStateByDirection('outgoing', state)).toEqual(state);
    expect(filterLegacyConversationPreferenceStateByDirection('incoming', state)).toBeUndefined();
  });

  it('invalidates an in-flight read lease when owner privacy locks', () => {
    const ownerWallet = '0x1111111111111111111111111111111111111111';
    const unlocked = buildWalletAccountScope({
      ownerAddress: ownerWallet,
      ownerAesReady: true
    });
    const locked = buildWalletAccountScope({
      ownerAddress: ownerWallet,
      ownerAesReady: false
    });

    expect(buildDirectConversationReadScopeKey(ownerWallet, true, unlocked.readAccounts)).not.toBe(
      buildDirectConversationReadScopeKey(ownerWallet, true, locked.readAccounts)
    );
  });

  it('maps history entries to chat messages with the right sender address', () => {
    expect(historyEntryToChatMessage(entry(), wallet)).toMatchObject({
      direction: 'outgoing',
      senderAddress: wallet
    });
    expect(historyEntryToChatMessage(entry({ direction: 'incoming' }), wallet)).toMatchObject({
      direction: 'incoming',
      senderAddress: peer
    });
  });

  it('preserves trade references from confirmed history entries', () => {
    const tradeReference = {
      version: 1 as const,
      tradeId: 42,
      escrowContract: '0x1111111111111111111111111111111111111111',
      terminalPath: '/otcdesk/terminal/l/ViAq'
    };

    expect(historyEntryToChatMessage(entry({ tradeReference }), wallet).tradeReference).toEqual(tradeReference);
  });

  it('preserves the read account metadata for owner-wallet history', () => {
    expect(
      historyEntryToChatMessage(
        entry({
          accountAddress: wallet,
          accountRole: 'owner'
        }),
        '0xcccccccccccccccccccccccccccccccccccccccc'
      )
    ).toMatchObject({
      accountAddress: wallet,
      accountRole: 'owner',
      senderAddress: wallet
    });
  });

  it('refreshes existing confirmed messages with parsed trade references', () => {
    const tradeReference = {
      version: 1 as const,
      tradeId: 42,
      escrowContract: '0x1111111111111111111111111111111111111111',
      terminalPath: '/otcdesk/terminal/l/ViAq'
    };
    const existing: ChatMessage = {
      id: '0xtx-1-out',
      direction: 'outgoing',
      text: 'hello',
      txHash: '0xtx',
      blockNumber: 10,
      logIndex: 1,
      timestamp: 100
    };

    const next = mergeDirectHistoryEntries(
      { [peer]: [existing] },
      [entry({ tradeReference })],
      wallet,
      { pruneOptimisticOutgoing: false }
    );

    expect(next[peer]).toHaveLength(1);
    expect(next[peer][0].tradeReference).toEqual(tradeReference);
  });

  it('dedupes confirmed outgoing messages against optimistic local messages', () => {
    const optimistic: ChatMessage = {
      id: 'local-1',
      direction: 'outgoing',
      text: 'hello',
      deliveryState: 'pending',
      timestamp: 98,
      txHash: '0xtx'
    };

    const next = mergeDirectHistoryEntries({ [peer]: [optimistic] }, [entry()], wallet);

    expect(next[peer]).toHaveLength(1);
    expect(next[peer][0]).toMatchObject({
      id: '0xtx-1-out',
      txHash: '0xtx'
    });
  });

  it('dedupes ChatGC confirmed messages against optimistic messages with transaction hashes', () => {
    const optimistic: ChatMessage = {
      id: 'local-2',
      direction: 'outgoing',
      text: 'hello',
      deliveryState: 'sent',
      timestamp: 98,
      txHash: `0x${'11'.repeat(32)}`
    };

    const confirmed = entry({
      id: 'chatgc:2632500:0xe5101d33986c91565d2c9f8b49aaf0b8ffee2243:1',
      txHash: 'chatgc:2632500:0xe5101d33986c91565d2c9f8b49aaf0b8ffee2243:1',
      timestamp: 100
    });
    const next = mergeDirectHistoryEntries({ [peer]: [optimistic] }, [confirmed], wallet);

    expect(next[peer]).toHaveLength(1);
    expect(next[peer][0]).toMatchObject({
      id: confirmed.id,
      txHash: confirmed.txHash
    });
  });

  it('dedupes ChatGC optimistic messages during contact preview syncs', () => {
    const optimistic: ChatMessage = {
      id: 'local-preview',
      direction: 'outgoing',
      text: 'hello',
      deliveryState: 'sent',
      timestamp: 98,
      txHash: `0x${'22'.repeat(32)}`
    };

    const confirmed = entry({
      id: 'chatgc:2632500:0xe5101d33986c91565d2c9f8b49aaf0b8ffee2243:2',
      txHash: 'chatgc:2632500:0xe5101d33986c91565d2c9f8b49aaf0b8ffee2243:2',
      timestamp: 100
    });
    const next = mergeDirectHistoryEntries(
      { [peer]: [optimistic] },
      [confirmed],
      wallet,
      { pruneOptimisticOutgoing: true }
    );

    expect(next[peer]).toHaveLength(1);
    expect(next[peer][0].id).toBe(confirmed.id);
  });

  it('never lets a legacy heuristic prune an exact Direct V2 optimistic attempt', () => {
    const directV2Optimistic: ChatMessage = {
      id: 'local-direct-v2-exact-attempt',
      direction: 'outgoing',
      text: 'hello',
      deliveryState: 'sent',
      timestamp: 98
    };
    const legacyConfirmed = entry({
      id: 'chatgc:2632500:0xe5101d33986c91565d2c9f8b49aaf0b8ffee2243:3',
      timestamp: 100
    });

    const next = mergeDirectHistoryEntries(
      { [peer]: [directV2Optimistic] },
      [legacyConfirmed],
      wallet,
      { pruneOptimisticOutgoing: true }
    );

    expect(next[peer].map((message) => message.id)).toEqual([
      'local-direct-v2-exact-attempt',
      legacyConfirmed.id
    ]);
  });

  it('keeps existing messages when adding older history without optimistic pruning', () => {
    const existing: ChatMessage = {
      id: 'existing',
      direction: 'incoming',
      text: 'newer',
      blockNumber: 20,
      logIndex: 1
    };

    const next = mergeDirectHistoryEntries(
      { [peer]: [existing] },
      [entry({ id: 'older', direction: 'incoming', blockNumber: 5, logIndex: 1, text: 'older' })],
      wallet,
      { pruneOptimisticOutgoing: false }
    );

    expect(next[peer].map((message) => message.id)).toEqual(['older', 'existing']);
  });

  it('removes locked owner plaintext while preserving explicitly readable legacy messages', () => {
    const ownerWallet = '0x1111111111111111111111111111111111111111';
    const legacyActionAccount = '0x2222222222222222222222222222222222222222';
    const previous = {
      [peer]: [
        { id: 'owner-message', direction: 'incoming', text: 'owner secret', accountAddress: ownerWallet },
        { id: 'legacy-message', direction: 'incoming', text: 'legacy message', accountAddress: legacyActionAccount }
      ] satisfies ChatMessage[]
    };

    const next = pruneDirectMessagesOutsideReadScope(previous, new Set([legacyActionAccount]));

    expect(next[peer].map((message) => message.id)).toEqual(['legacy-message']);
  });

  it('does not let the legacy read scope prune Direct V2 history', () => {
    const directV2 = {
      id: 'direct-v2-message',
      direction: 'incoming',
      text: 'V2 plaintext',
      accountAddress: wallet,
      directV2: {
        protocol: 'direct-v2',
        contentState: 'available',
        chainId: '2632500',
        contractAddress: '0x3333333333333333333333333333333333333333',
        conversationId: `0x${'44'.repeat(32)}`,
        messageId: '1',
        epoch: '1',
        senderSequence: '1',
        nonce: `0x${'55'.repeat(12)}`,
        transactionHash: `0x${'66'.repeat(32)}`,
        blockNumber: '100',
        blockHash: `0x${'77'.repeat(32)}`,
        logIndex: 0,
        finality: 'finalized'
      }
    } satisfies ChatMessage;

    const next = pruneDirectMessagesOutsideReadScope(
      { [peer]: [directV2] },
      new Set()
    );

    expect(next[peer]).toEqual([directV2]);
  });

  it('marks inactive contacts unread and active visible contacts read', () => {
    const latestMessageTimeByContact = new Map([
      [peer, 500],
      ['0xcccccccccccccccccccccccccccccccccccccccc', 600]
    ]);

    const activeResult = resolveDirectUnreadState({
      activeKey: peer,
      candidateAddresses: [peer],
      globalReadTs: 0,
      latestMessageTimeByContact,
      pageVisible: true,
      previousReadByContact: {},
      previousUnread: {},
      suppressedKeys: new Set(),
      walletKey: wallet
    });
    expect(activeResult.nextReadByContact[peer]).toBe(500);
    expect(activeResult.nextUnread[peer]).toBeUndefined();

    const inactiveResult = resolveDirectUnreadState({
      activeKey: peer,
      candidateAddresses: ['0xcccccccccccccccccccccccccccccccccccccccc'],
      globalReadTs: 0,
      latestMessageTimeByContact,
      pageVisible: true,
      previousReadByContact: {},
      previousUnread: {},
      suppressedKeys: new Set(),
      walletKey: wallet
    });
    expect(inactiveResult.nextUnread['0xcccccccccccccccccccccccccccccccccccccccc']).toBe(true);
  });
});
