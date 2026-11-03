import { beforeEach, describe, expect, it, vi } from 'vitest';

const history = vi.hoisted(() => ({ normalize: vi.fn() }));
const sessionBrand = vi.hoisted(() => ({ assert: vi.fn() }));

vi.mock('./groupChatV2History', async (importOriginal) => ({
  ...await importOriginal<typeof import('./groupChatV2History')>(),
  normalizeGroupChatV2HistoryEvents: history.normalize
}));
vi.mock('./groupChatV2Session', async (importOriginal) => ({
  ...await importOriginal<typeof import('./groupChatV2Session')>(),
  assertGroupChatV2SessionController: sessionBrand.assert
}));

import { createGroupChatV2HistoryRuntime } from './groupChatV2HistoryRuntime';
import { buildGroupChatV2MessageKey, type GroupChatV2MessageEvent } from './groupChatV2Chain';
import type { GroupChatV2ReadPhase, GroupChatV2SessionController } from './groupChatV2Session';

const CONTRACT = '0x2222222222222222222222222222222222222222';
const OWNER = '0x1111111111111111111111111111111111111111';
const SELECTED_CONTEXT = Object.freeze({ purpose: 'selected-history' as const, groupId: 1n });
const event = (blockHash = `0x${'55'.repeat(32)}`): GroupChatV2MessageEvent => ({
  protocol: 'group-v2',
  key: 'group-v2:7082400:contract:1:1',
  chainId: 7_082_400n,
  contractAddress: CONTRACT,
  groupId: 1n,
  messageId: 1n,
  epoch: 1n,
  membershipRevision: 1n,
  senderSequence: 1n,
  sender: OWNER,
  nonce: `0x${'11'.repeat(12)}`,
  aadHash: `0x${'22'.repeat(32)}`,
  ciphertext: `0x${'33'.repeat(16)}`,
  valueSent: 0n,
  feeTaken: 0n,
  transactionHash: `0x${'44'.repeat(32)}`,
  blockHash,
  blockNumber: 105n,
  logIndex: 0,
  removed: false,
  context: {
    chainId: 7_082_400n,
    contractAddress: CONTRACT,
    groupId: 1n,
    epoch: 1n,
    membershipRevision: 1n,
    sender: OWNER,
    senderSequence: 1n,
    valueSent: 0n,
    feeTaken: 0n
  },
  encrypted: {
    nonce: `0x${'11'.repeat(12)}`,
    aadHash: `0x${'22'.repeat(32)}`,
    ciphertext: `0x${'33'.repeat(16)}`
  }
});

const makeSession = () => {
  const hashes = new Map<bigint, string>();
  for (let block = 101n; block <= 120n; block += 1n) {
    hashes.set(block, block === 105n ? `0x${'55'.repeat(32)}` : `0x${block.toString(16).padStart(64, '0')}`);
  }
  return {
    ownerAddress: OWNER,
    manifest: {
      chainId: 7_082_400n,
      contractAddress: CONTRACT,
      deploymentBlock: 101n,
      runtimeBytecodeHash: `0x${'66'.repeat(32)}`
    },
    inspect: vi.fn(async (..._args: Parameters<GroupChatV2SessionController['inspect']>) => ({
      createdBlock: 101n,
      firstMessageBlock: 105n,
      lastMessageBlock: 105n,
      messageCount: 1n
    })),
    latestBlock: vi.fn(async (..._args: Parameters<GroupChatV2SessionController['latestBlock']>) => 120n),
    canonicalBlock: vi.fn(async (blockNumber: bigint, _context?: Parameters<GroupChatV2SessionController['canonicalBlock']>[1]) => ({
      blockNumber,
      blockHash: hashes.get(blockNumber) ?? `0x${blockNumber.toString(16).padStart(64, '0')}`,
      timestamp: Number(blockNumber)
    })),
    historyPage: vi.fn(async (..._args: Parameters<GroupChatV2SessionController['historyPage']>) => [event()]),
    membershipRanges: vi.fn(async (..._args: Parameters<GroupChatV2SessionController['membershipRanges']>) => [{
      generation: 1n,
      firstMessageId: 1n,
      lastMessageId: 0n,
      firstEpoch: 1n,
      lastEpoch: 0n,
      joinedRevision: 1n,
      leftRevision: 0n,
      joinedAt: 1n,
      leftAt: 0n
    }]),
    messageCountAtBlock: vi.fn<GroupChatV2SessionController['messageCountAtBlock']>(async () => 1n),
    readEpochKey: vi.fn(async (..._args: Parameters<GroupChatV2SessionController['readEpochKey']>) => ({
      value: 1n,
      chainId: 7_082_400n,
      contractAddress: CONTRACT,
      groupId: 1n,
      epoch: 1n,
      membershipRevision: 1n
    })),
    clearEpochKeys: vi.fn(),
    hashes
  };
};

describe('groupChatV2HistoryRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    history.normalize.mockImplementation(async ({ events, expectedPreviousMessageId }) => ({
      entries: events.map(() => ({ id: 'entry-1' })),
      previousMessageId: expectedPreviousMessageId,
      lastMessageId: events.length ? 1n : expectedPreviousMessageId,
      nextMessageId: events.length ? 2n : expectedPreviousMessageId + 1n
    }));
  });

  it('opens a verified recent suffix and reads older blocks only on request', async () => {
    const source = makeSession();
    source.latestBlock.mockResolvedValue(10_010n);
    source.inspect.mockResolvedValue({ createdBlock: 101n, firstMessageBlock: 105n, lastMessageBlock: 9_999n, messageCount: 3n });
    source.messageCountAtBlock.mockImplementation(async (_id, block) => block < 105n ? 0n : block < 4_000n ? 1n : block < 9_999n ? 2n : 3n);
    source.historyPage.mockImplementation(async (_id, from, to) => [105n, 4_000n, 9_999n].flatMap((block, index) =>
      block < from || block > to ? [] : [{ ...event(), messageId: BigInt(index + 1), blockNumber: block,
        blockHash: source.hashes.get(block) ?? `0x${block.toString(16).padStart(64, '0')}` }]));
    history.normalize.mockImplementation(async ({ events, expectedPreviousMessageId }) => ({
      entries: events.map((item: GroupChatV2MessageEvent) => ({ id: item.messageId.toString() })),
      lastMessageId: events[events.length - 1]?.messageId ?? expectedPreviousMessageId
    }));
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    const recent = await runtime.sync(1n);
    expect(recent.entries).toEqual([{ id: '3' }]);
    expect(recent.hasOlder).toBe(true);
    expect(source.historyPage.mock.calls).toEqual([[1n, 7_952n, 9_999n, SELECTED_CONTEXT]]);
    await runtime.sync(1n);
    expect(source.historyPage).toHaveBeenCalledOnce();
    const dropped = await runtime.loadOlder(1n, () => false);
    expect(dropped.hasOlder).toBe(true);
    await runtime.loadOlder(1n);
    expect(source.historyPage.mock.calls[1]).toEqual(source.historyPage.mock.calls[2]);
    expect(source.historyPage.mock.calls[2]).toEqual([1n, 5_904n, 7_951n, SELECTED_CONTEXT]);
    const middle = await runtime.loadOlder(1n);
    expect(middle.entries).toEqual([{ id: '2' }]);
    let older = middle;
    for (let page = 0; page < 3 && older.hasOlder; page++) older = await runtime.loadOlder(1n);
    expect(older.entries).toEqual([{ id: '1' }]);
    expect(older.hasOlder).toBe(false);
    expect(runtime.checkpoint(1n)?.lastMessageId).toBe(3n);
  });

  it('keeps historical membership checks when loading an older page', async () => {
    const source = makeSession();
    source.latestBlock.mockResolvedValue(10_010n);
    source.inspect.mockResolvedValue({ createdBlock: 101n, firstMessageBlock: 105n, lastMessageBlock: 9_999n, messageCount: 2n });
    source.messageCountAtBlock.mockImplementation(async (_id, block) => block < 105n ? 0n : block < 9_999n ? 1n : 2n);
    source.membershipRanges.mockResolvedValue([{ generation: 2n, firstMessageId: 2n, lastMessageId: 0n,
      firstEpoch: 2n, lastEpoch: 0n, joinedRevision: 2n, leftRevision: 0n, joinedAt: 2n, leftAt: 0n }]);
    source.readEpochKey.mockImplementation(async (_id, epoch = 1n) => ({ value: 1n, chainId: 7_082_400n,
      contractAddress: CONTRACT, groupId: 1n, epoch, membershipRevision: epoch }));
    source.historyPage.mockImplementation(async (_id, from, to) => [105n, 9_999n].flatMap((block, index) => {
      if (block < from || block > to) return [];
      const messageId = BigInt(index + 1), epoch = messageId;
      return [{ ...event(), messageId, epoch, membershipRevision: epoch, blockNumber: block,
        key: buildGroupChatV2MessageKey({ chainId: 7_082_400n, contractAddress: CONTRACT, groupId: 1n, messageId }),
        blockHash: source.hashes.get(block) ?? `0x${block.toString(16).padStart(64, '0')}`,
        context: { ...event().context, epoch, membershipRevision: epoch } }];
    }));
    const actual = await vi.importActual<typeof import('./groupChatV2History')>('./groupChatV2History');
    history.normalize.mockImplementation(actual.normalizeGroupChatV2HistoryEvents);
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    expect((await runtime.sync(1n)).entries).toHaveLength(1);
    let older = await runtime.loadOlder(1n);
    for (let page = 0; page < 4 && older.hasOlder; page++) older = await runtime.loadOlder(1n);
    expect(older.hasOlder).toBe(false);
    expect(older.entries).toEqual([]);
    expect(source.readEpochKey.mock.calls.every(([, epoch]) => epoch === 2n)).toBe(true);
    expect(runtime.checkpoint(1n)?.lastMessageId).toBe(2n);
  });

  it('resets a recent suffix when its older-page boundary is no longer canonical', async () => {
    const source = makeSession();
    source.latestBlock.mockResolvedValue(10_010n);
    source.inspect.mockResolvedValue({ createdBlock: 101n, firstMessageBlock: 105n, lastMessageBlock: 9_999n, messageCount: 2n });
    source.messageCountAtBlock.mockImplementation(async (_id, block) => block < 105n ? 0n : block < 9_999n ? 1n : 2n);
    source.historyPage.mockResolvedValue([{ ...event(), messageId: 2n, blockNumber: 9_999n,
      blockHash: `0x${9_999n.toString(16).padStart(64, '0')}` }]);
    history.normalize.mockResolvedValue({ entries: [], lastMessageId: 2n });
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    await runtime.sync(1n);
    source.hashes.set(7_951n, `0x${'99'.repeat(32)}`);
    expect((await runtime.loadOlder(1n)).resetConversation).toBe(true);
    expect(source.clearEpochKeys).toHaveBeenCalledOnce();
    expect(source.historyPage.mock.calls[0]).toEqual(source.historyPage.mock.calls[1]);
  });

  it('rebases a long inactive conversation on recent messages without draining its middle gap', async () => {
    const source = makeSession();
    source.inspect.mockResolvedValueOnce({ createdBlock: 101n, firstMessageBlock: 0n, lastMessageBlock: 0n, messageCount: 0n });
    source.messageCountAtBlock.mockResolvedValueOnce(0n);
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    await runtime.sync(1n);
    source.latestBlock.mockResolvedValue(10_010n);
    source.inspect.mockResolvedValue({ createdBlock: 101n, firstMessageBlock: 5_000n, lastMessageBlock: 9_999n, messageCount: 2n });
    source.messageCountAtBlock.mockImplementation(async (_id, block) => block < 5_000n ? 0n : block < 9_999n ? 1n : 2n);
    source.historyPage.mockImplementation(async (_id, from, to) => from <= 9_999n && to >= 9_999n
      ? [{ ...event(), messageId: 2n, blockNumber: 9_999n, blockHash: `0x${9_999n.toString(16).padStart(64, '0')}` }] : []);
    history.normalize.mockImplementation(async ({ events, expectedPreviousMessageId }) => ({ entries: [],
      lastMessageId: events[events.length - 1]?.messageId ?? expectedPreviousMessageId }));
    expect(await runtime.sync(1n)).toMatchObject({ resetConversation: true, hasOlder: true, checkpoint: { lastMessageId: 2n } });
    expect(source.historyPage.mock.calls).toEqual([[1n, 7_952n, 9_999n, SELECTED_CONTEXT]]);
  });

  it('balances selected-history stages without exposing inputs or changing results when the observer throws', async () => {
    const source = makeSession();
    const events: Array<[GroupChatV2ReadPhase, boolean]> = [];
    history.normalize.mockImplementation(async ({ events, resolveEpochKey }) => {
      await resolveEpochKey({ groupId: 1n, epoch: 1n, membershipRevision: 1n });
      return { entries: events.map(() => ({ id: 'entry-1' })), lastMessageId: 1n };
    });
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController,
      onReadPhase: (phase, pending) => { events.push([phase, pending]); throw new Error('observer only'); } });
    expect(await runtime.sync(1n)).toMatchObject({ entries: [{ id: 'entry-1' }],
      checkpoint: { lastMessageId: 1n, nextBlock: 111n } });
    for (const phase of ['history-state', 'history-head', 'history-fence', 'history-page',
      'history-membership', 'history-count', 'history-keys'] as const) {
      expect(events).toContainEqual([phase, true]);
      expect(events.filter(([name, pending]) => name === phase && pending).length)
        .toBe(events.filter(([name, pending]) => name === phase && !pending).length);
    }
    expect(events.every(([phase, pending]) => phase.startsWith('history-') && typeof pending === 'boolean')).toBe(true);
    const readContext = { purpose: 'selected-history', groupId: 1n };
    expect(source.inspect).toHaveBeenCalledWith(1n, readContext);
    expect(source.latestBlock).toHaveBeenCalledWith(readContext);
    expect(source.canonicalBlock).toHaveBeenCalledWith(110n, readContext);
    expect(source.historyPage).toHaveBeenCalledWith(1n, 105n, 110n, readContext);
    expect(source.membershipRanges).toHaveBeenCalledWith(1n, OWNER, readContext);
    expect(source.messageCountAtBlock).toHaveBeenCalledWith(1n, 110n, readContext);
    expect(source.readEpochKey).toHaveBeenCalledWith(1n, 1n, readContext);
    expect(Object.isFrozen(source.inspect.mock.calls[0][1])).toBe(true);
  });

  it('closes the selected-history stage and preserves the original read error', async () => {
    const source = makeSession();
    const failure = new Error('history transport failed');
    source.latestBlock.mockRejectedValueOnce(failure);
    const events: Array<[GroupChatV2ReadPhase, boolean]> = [];
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController,
      onReadPhase: (phase, pending) => { events.push([phase, pending]); throw new Error('observer only'); } });
    await expect(runtime.sync(1n)).rejects.toBe(failure);
    expect(events).toEqual([['history-state', true], ['history-state', false],
      ['history-head', true], ['history-head', false]]);
    expect(source.historyPage).not.toHaveBeenCalled();
    expect(runtime.checkpoint(1n)).toBeNull();
  });

  it.each(['inspect', 'page', 'epoch key'] as const)('stops obsolete Group A after a held %s read, serves B, and replays A', async phase => {
    const source = makeSession();
    let selected = 1n, release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const inspected = source.inspect.getMockImplementation()!;
    source.inspect.mockImplementation(async (...args: Parameters<GroupChatV2SessionController['inspect']>) => {
      if (phase === 'inspect' && args[0] === 1n) await held;
      return inspected(...args);
    });
    source.historyPage.mockImplementation(async (...args: unknown[]) => {
      const groupId = args[0] as bigint;
      if (phase === 'page' && groupId === 1n) await held;
      return [{ ...event(), groupId, context: { ...event().context, groupId },
        key: buildGroupChatV2MessageKey({ chainId: 7_082_400n, contractAddress: CONTRACT, groupId, messageId: 1n }) }];
    });
    if (phase === 'epoch key') {
      const key = source.readEpochKey.getMockImplementation()!;
      source.readEpochKey.mockImplementation(async (...args: Parameters<GroupChatV2SessionController['readEpochKey']>) => {
        if (args[0] === 1n) await held;
        return { ...await key(...args), groupId: args[0] };
      });
      const actual = await vi.importActual<typeof import('./groupChatV2History')>('./groupChatV2History');
      history.normalize.mockImplementation(actual.normalizeGroupChatV2HistoryEvents);
    }
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    const acceptA = vi.fn(() => true), acceptB = vi.fn(() => true);
    const first = runtime.sync(1n, acceptA, () => selected === 1n);
    const rejected = expect(first).rejects.toThrow(/no longer current/);
    const read = phase === 'inspect' ? source.inspect : phase === 'page' ? source.historyPage : source.readEpochKey;
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    selected = 2n;
    const second = runtime.sync(2n, acceptB, () => selected === 2n);
    await Promise.resolve();
    expect(source.inspect).toHaveBeenCalledOnce();
    const normalizeBefore = history.normalize.mock.calls.length;
    release();
    await rejected;
    await second;
    expect(acceptA).not.toHaveBeenCalled();
    expect(acceptB).toHaveBeenCalledOnce();
    expect(runtime.checkpoint(1n)).toBeNull();
    expect(runtime.checkpoint(2n)?.lastMessageId).toBe(1n);
    expect(history.normalize).toHaveBeenCalledTimes(normalizeBefore + 1);
    if (phase === 'inspect') expect(source.latestBlock).toHaveBeenCalledOnce();
    selected = 1n;
    await runtime.sync(1n, acceptA, () => selected === 1n);
    expect(acceptA).toHaveBeenCalledOnce();
    expect(runtime.checkpoint(1n)?.lastMessageId).toBe(1n);
    expect(source.historyPage).toHaveBeenLastCalledWith(1n, 105n, 110n, SELECTED_CONTEXT);
    runtime.close();
  });

  it('retains a reorg reset when a view switch stops replay before delivery', async () => {
    const source = makeSession();
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    await runtime.sync(1n);
    source.hashes.set(110n, `0x${'99'.repeat(32)}`);
    let selected = true, release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    source.historyPage.mockImplementationOnce(async () => { await held; return [event()]; });
    const accept = vi.fn(() => true);
    const first = runtime.sync(1n, accept, () => selected);
    const rejected = expect(first).rejects.toThrow(/no longer current/);
    await vi.waitFor(() => expect(source.historyPage).toHaveBeenCalledTimes(2));
    selected = false; release(); await rejected;
    expect(accept).not.toHaveBeenCalled();
    expect(runtime.checkpoint(1n)).toBeNull();
    const replay = await runtime.sync(1n, () => true, () => true);
    expect(replay.resetConversation).toBe(true);
    expect(replay.entries).toHaveLength(1);
    expect((await runtime.sync(1n)).resetConversation).toBe(false);
  });

  it('reads one finalized provider page and commits its checkpoint only after completeness proof', async () => {
    const source = makeSession();
    const runtime = createGroupChatV2HistoryRuntime({
      confirmationDepth: 10n,
      isCurrent: () => true,
      ownerAddress: OWNER,
      session: source as unknown as GroupChatV2SessionController
    });
    const result = await runtime.sync(1n);
    expect(result).toMatchObject({ resetConversation: false, safeHead: 110n });
    expect(result.checkpoint).toMatchObject({
      nextBlock: 111n,
      lastMessageId: 1n,
      boundaryBlockNumber: 110n
    });
    expect(source.historyPage).toHaveBeenCalledWith(1n, 105n, 110n, SELECTED_CONTEXT);
    expect(source.messageCountAtBlock).toHaveBeenCalledWith(1n, 110n, SELECTED_CONTEXT);
    expect(source.membershipRanges).toHaveBeenCalledWith(1n, OWNER, SELECTED_CONTEXT);
    const normalizeInput = history.normalize.mock.calls[0]?.[0];
    expect(normalizeInput.isEventReadable(event())).toBe(true);
  });

  it('derives readable messages from historical membership revisions', async () => {
    const source = makeSession();
    source.membershipRanges.mockResolvedValueOnce([{
      generation: 1n,
      firstMessageId: 5n,
      lastMessageId: 0n,
      firstEpoch: 2n,
      lastEpoch: 0n,
      joinedRevision: 2n,
      leftRevision: 0n,
      joinedAt: 2n,
      leftAt: 0n
    }]);
    const runtime = createGroupChatV2HistoryRuntime({
      confirmationDepth: 10n,
      isCurrent: () => true,
      ownerAddress: OWNER,
      session: source as unknown as GroupChatV2SessionController
    });

    await runtime.sync(1n);
    const isEventReadable = history.normalize.mock.calls[0]?.[0].isEventReadable;
    expect(isEventReadable({ ...event(), membershipRevision: 1n })).toBe(false);
    expect(isEventReadable({ ...event(), membershipRevision: 2n })).toBe(true);
  });

  it('serializes overlapping history synchronization requests', async () => {
    const source = makeSession();
    let releaseFirst!: () => void;
    const firstPage = new Promise<void>((resolve) => { releaseFirst = resolve; });
    source.historyPage.mockImplementationOnce(async () => {
      await firstPage;
      return [event()];
    });
    const runtime = createGroupChatV2HistoryRuntime({
      confirmationDepth: 10n,
      isCurrent: () => true,
      ownerAddress: OWNER,
      session: source as unknown as GroupChatV2SessionController
    });

    const first = runtime.sync(1n);
    await vi.waitFor(() => expect(source.historyPage).toHaveBeenCalledOnce());
    const second = runtime.sync(1n);
    await Promise.resolve();

    expect(source.inspect).toHaveBeenCalledOnce();
    releaseFirst();
    await Promise.all([first, second]);
    expect(source.inspect).toHaveBeenCalledTimes(2);
  });

  it('rewinds the whole V2 group scope when the finalized boundary hash changes', async () => {
    const source = makeSession();
    const runtime = createGroupChatV2HistoryRuntime({
      confirmationDepth: 10n,
      isCurrent: () => true,
      ownerAddress: OWNER,
      session: source as unknown as GroupChatV2SessionController
    });
    await runtime.sync(1n);
    source.hashes.set(110n, `0x${'99'.repeat(32)}`);
    const result = await runtime.sync(1n);
    expect(result.resetConversation).toBe(true);
    expect(source.clearEpochKeys).toHaveBeenCalledOnce();
    expect(source.historyPage).toHaveBeenLastCalledWith(1n, 105n, 110n, SELECTED_CONTEXT);
  });

  it('skips the provably empty creation-to-first-message range on a fresh reload', async () => {
    const source = makeSession();
    source.inspect.mockResolvedValueOnce({
      createdBlock: 101n,
      firstMessageBlock: 4_201n,
      lastMessageBlock: 4_201n,
      messageCount: 1n
    });
    source.latestBlock.mockResolvedValueOnce(4_220n);
    source.canonicalBlock.mockImplementation(async (blockNumber: bigint) => ({
      blockNumber,
      blockHash: blockNumber === 4_201n
        ? `0x${'55'.repeat(32)}`
        : `0x${blockNumber.toString(16).padStart(64, '0')}`,
      timestamp: Number(blockNumber)
    }));
    source.historyPage.mockResolvedValueOnce([{ ...event(), blockNumber: 4_201n }]);
    const runtime = createGroupChatV2HistoryRuntime({
      confirmationDepth: 10n,
      isCurrent: () => true,
      ownerAddress: OWNER,
      session: source as unknown as GroupChatV2SessionController
    });

    const result = await runtime.sync(1n);

    expect(result.checkpoint).toMatchObject({ nextBlock: 4_211n, lastMessageId: 1n });
    expect(source.historyPage).toHaveBeenCalledWith(1n, 4_201n, 4_210n, SELECTED_CONTEXT);
    expect(source.messageCountAtBlock).toHaveBeenCalledWith(1n, 4_210n, SELECTED_CONTEXT);
  });

  it('fails closed on inconsistent message-block anchors', async () => {
    const source = makeSession();
    source.inspect.mockResolvedValueOnce({
      createdBlock: 101n,
      firstMessageBlock: 0n,
      lastMessageBlock: 105n,
      messageCount: 1n
    });
    const runtime = createGroupChatV2HistoryRuntime({
      confirmationDepth: 10n,
      isCurrent: () => true,
      ownerAddress: OWNER,
      session: source as unknown as GroupChatV2SessionController
    });

    await expect(runtime.sync(1n)).rejects.toThrow('message-block anchors are inconsistent');
    expect(source.historyPage).not.toHaveBeenCalled();
  });

  it('completes an empty group without scanning its empty block tail', async () => {
    const source = makeSession();
    source.latestBlock.mockResolvedValue(10_010n);
    source.inspect.mockResolvedValue({ createdBlock: 101n, firstMessageBlock: 0n, lastMessageBlock: 0n, messageCount: 0n });
    source.messageCountAtBlock.mockResolvedValue(0n);
    source.historyPage.mockResolvedValue([]);
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true, ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });

    const result = await runtime.sync(1n);
    expect(result.checkpoint).toMatchObject({ nextBlock: 10_001n, lastMessageId: 0n, boundaryBlockNumber: 10_000n });
    expect(source.historyPage).not.toHaveBeenCalled();
    expect(source.messageCountAtBlock.mock.calls).toEqual([[1n, 10_000n, SELECTED_CONTEXT]]);
  });

  it('stops after reconstructing the full finalized sequence and skips a later empty tail', async () => {
    const source = makeSession();
    source.latestBlock.mockResolvedValue(10_010n);
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true, ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });

    const result = await runtime.sync(1n);
    expect(result.entries).toHaveLength(1);
    expect(result.checkpoint).toMatchObject({ nextBlock: 10_001n, lastMessageId: 1n, boundaryBlockNumber: 10_000n });
    expect(source.historyPage).toHaveBeenCalledWith(1n, 105n, 2_152n, SELECTED_CONTEXT);
    expect(source.messageCountAtBlock.mock.calls).toEqual([[1n, 10_000n, SELECTED_CONTEXT]]);

    source.latestBlock.mockResolvedValue(20_010n);
    const next = await runtime.sync(1n);
    expect(next.entries).toEqual([]);
    expect(next.checkpoint?.nextBlock).toBe(20_001n);
    expect(source.historyPage).toHaveBeenCalledOnce();
  });

  it('keeps the page-end completeness check when finalized messages remain', async () => {
    const source = makeSession();
    source.latestBlock.mockResolvedValue(10_010n);
    source.messageCountAtBlock.mockImplementation(async (_groupId: bigint, blockNumber: bigint) => blockNumber === 10_000n ? 2n : 1n);
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true, ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });

    const result = await runtime.sync(1n);
    expect(result.checkpoint).toMatchObject({ nextBlock: 2_153n, lastMessageId: 1n, boundaryBlockNumber: 2_152n });
    expect(source.messageCountAtBlock.mock.calls).toEqual([[1n, 10_000n, SELECTED_CONTEXT], [1n, 2_152n, SELECTED_CONTEXT]]);
  });

  it('uses the finalized count rather than the latest unfinalized count or visible entry count', async () => {
    const source = makeSession();
    source.latestBlock.mockResolvedValue(10_010n);
    source.inspect.mockResolvedValue({ createdBlock: 101n, firstMessageBlock: 105n, lastMessageBlock: 10_005n, messageCount: 2n });
    history.normalize.mockResolvedValue({ entries: [], lastMessageId: 1n });
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true, ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    const result = await runtime.sync(1n);
    expect(result.entries).toEqual([]);
    expect(result.checkpoint).toMatchObject({ nextBlock: 10_001n, lastMessageId: 1n });
    expect(source.messageCountAtBlock.mock.calls).toEqual([[1n, 10_000n, SELECTED_CONTEXT], [1n, 7_952n, SELECTED_CONTEXT]]);
    expect(result.hasOlder).toBe(true);
  });

  it('rejects a missing suffix within a partial page rather than skipping to the finalized head', async () => {
    const source = makeSession();
    source.latestBlock.mockResolvedValue(10_010n);
    source.messageCountAtBlock.mockImplementation(async (_groupId: bigint, blockNumber: bigint) => blockNumber === 10_000n ? 3n : 2n);
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true, ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    await expect(runtime.sync(1n)).rejects.toThrow('completeness expected 2 messages but reconstructed 1');
    expect(runtime.checkpoint(1n)).toBeNull();
  });

  it('rejects a reconstructed sequence beyond the finalized count', async () => {
    const source = makeSession();
    source.latestBlock.mockResolvedValue(10_010n);
    history.normalize.mockResolvedValue({ entries: [], lastMessageId: 2n });
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true, ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    await expect(runtime.sync(1n)).rejects.toThrow('completeness expected 1 messages but reconstructed 2');
    expect(runtime.checkpoint(1n)).toBeNull();
  });

  it.each(['count', 'page', 'cached boundary'])('rejects a safe-head change during the %s read', async phase => {
    const source = makeSession();
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true, ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    if (phase === 'cached boundary') await runtime.sync(1n);
    source.latestBlock.mockResolvedValue(10_010n);
    const changeHead = () => source.hashes.set(10_000n, `0x${'99'.repeat(32)}`);
    if (phase === 'count') source.messageCountAtBlock.mockImplementationOnce(async () => { changeHead(); return 1n; });
    if (phase === 'page') source.historyPage.mockImplementationOnce(async () => { changeHead(); return [event()]; });
    if (phase === 'cached boundary') source.canonicalBlock.mockImplementation(async blockNumber => {
      if (blockNumber === 110n) changeHead();
      return { blockNumber, blockHash: source.hashes.get(blockNumber) ?? `0x${blockNumber.toString(16).padStart(64, '0')}`, timestamp: Number(blockNumber) };
    });
    await expect(runtime.sync(1n)).rejects.toThrow('safe head changed');
    expect(runtime.checkpoint(1n)?.nextBlock ?? null).toBe(phase === 'cached boundary' ? 111n : null);
  });

  it.each(['rejected', 'throwing', 'scope changed'])('does not commit an empty shortcut when its consumer is %s', async mode => {
    const source = makeSession(); let current = true;
    source.latestBlock.mockResolvedValue(10_010n);
    source.inspect.mockResolvedValue({ createdBlock: 101n, firstMessageBlock: 0n, lastMessageBlock: 0n, messageCount: 0n });
    source.messageCountAtBlock.mockResolvedValue(0n);
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => current, ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    const pending = runtime.sync(1n, () => {
      if (mode === 'throwing') throw new Error('Consumer rejected shortcut');
      if (mode === 'scope changed') current = false;
      return mode !== 'rejected';
    });
    if (mode === 'rejected') await pending;
    else await expect(pending).rejects.toThrow(mode === 'throwing' ? 'Consumer rejected shortcut' : 'no longer current');
    expect(runtime.checkpoint(1n)).toBeNull();
  });

  it('rejects an orphan log or an omitted canonical suffix without advancing', async () => {
    const source = makeSession();
    source.historyPage.mockResolvedValueOnce([event(`0x${'77'.repeat(32)}`)]);
    const runtime = createGroupChatV2HistoryRuntime({
      confirmationDepth: 10n,
      isCurrent: () => true,
      ownerAddress: OWNER,
      session: source as unknown as GroupChatV2SessionController
    });
    await expect(runtime.sync(1n)).rejects.toThrow('orphaned message log');
    expect(runtime.checkpoint(1n)).toBeNull();

    source.historyPage.mockResolvedValueOnce([event()]);
    source.messageCountAtBlock.mockResolvedValueOnce(2n);
    await expect(runtime.sync(1n)).rejects.toThrow('completeness expected 2');
    expect(runtime.checkpoint(1n)).toBeNull();
  });

  it('retains the reorg projection reset through a failed replay and empty successful retry', async () => {
    const source = makeSession();
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true, ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    await runtime.sync(1n);
    source.hashes.set(110n, `0x${'99'.repeat(32)}`);
    source.historyPage.mockRejectedValueOnce(new Error('RPC disconnected'));
    await expect(runtime.sync(1n)).rejects.toThrow('RPC disconnected');
    expect(runtime.checkpoint(1n)).toBeNull();
    source.inspect.mockResolvedValue({ createdBlock: 101n, firstMessageBlock: 0n, lastMessageBlock: 0n, messageCount: 0n });
    source.historyPage.mockResolvedValue([]); source.messageCountAtBlock.mockResolvedValue(0n);
    const recovered = await runtime.sync(1n);
    expect(recovered.entries).toEqual([]); expect(recovered.resetConversation).toBe(true);
    expect((await runtime.sync(1n)).resetConversation).toBe(false);
  });

  it('retries a transient page failure without advancing a healthy checkpoint', async () => {
    const source = makeSession();
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true, ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    source.historyPage.mockRejectedValueOnce(new Error('RPC disconnected'));
    await expect(runtime.sync(1n)).rejects.toThrow('RPC disconnected'); expect(runtime.checkpoint(1n)).toBeNull();
    const recovered = await runtime.sync(1n); expect(recovered.checkpoint?.lastMessageId).toBe(1n);
    expect(source.historyPage).toHaveBeenCalledTimes(2);
  });

  it('does not publish a pending page after close', async () => {
    const source = makeSession(); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    source.historyPage.mockImplementationOnce(async () => { await gate; return [event()]; });
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true, ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    const pending = runtime.sync(1n); const rejected = expect(pending).rejects.toThrow(/no longer current/);
    await vi.waitFor(() => expect(source.historyPage).toHaveBeenCalledOnce()); runtime.close(); release(); await rejected;
    expect(runtime.checkpoint(1n)).toBeNull(); expect(source.clearEpochKeys).toHaveBeenCalledOnce();
  });
  it('clears the old projection when the safe head rewinds before group creation', async () => {
    const source = makeSession();
    const canonicalBlock = source.canonicalBlock.getMockImplementation()!;
    source.canonicalBlock.mockImplementation(async blockNumber => {
      if (blockNumber < source.manifest.deploymentBlock) throw new Error('Canonical group block is outside the verified provider range.');
      return canonicalBlock(blockNumber);
    });
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true, ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    await runtime.sync(1n); source.latestBlock.mockResolvedValue(110n);
    const reset = await runtime.sync(1n);
    expect(reset).toMatchObject({ entries: [], checkpoint: null, resetConversation: true, safeHead: 100n });
    expect(runtime.checkpoint(1n)).toBeNull();
    expect((await runtime.sync(1n)).resetConversation).toBe(false);
  });
  it('does not return a stale caught-up checkpoint after close during its boundary read', async () => {
    const source = makeSession();
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true, ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    await runtime.sync(1n);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    source.canonicalBlock.mockImplementationOnce(async blockNumber => { await gate; return { blockNumber, blockHash: source.hashes.get(blockNumber)!, timestamp: Number(blockNumber) }; });
    const reads = source.canonicalBlock.mock.calls.length;
    const pending = runtime.sync(1n); const rejected = expect(pending).rejects.toThrow(/no longer current/);
    await vi.waitFor(() => expect(source.canonicalBlock.mock.calls.length).toBe(reads + 1));
    runtime.close(); release(); await rejected; expect(runtime.checkpoint(1n)).toBeNull();
  });
  it('keeps a failed replay reset scoped to its group across another group sync', async () => {
    const source = makeSession();
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true, ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    await runtime.sync(1n); source.hashes.set(110n, `0x${'99'.repeat(32)}`);
    source.historyPage.mockRejectedValueOnce(new Error('RPC disconnected'));
    await expect(runtime.sync(1n)).rejects.toThrow('RPC disconnected');
    source.inspect.mockResolvedValue({ createdBlock: 101n, firstMessageBlock: 0n, lastMessageBlock: 0n, messageCount: 0n });
    source.historyPage.mockResolvedValue([]); source.messageCountAtBlock.mockResolvedValue(0n);
    expect((await runtime.sync(2n)).resetConversation).toBe(false);
    expect((await runtime.sync(1n)).resetConversation).toBe(true);
  });
  it('replays a page dropped by the App before committing its checkpoint', async () => {
    const source = makeSession(); let release!: () => void; let selected = true;
    const gate = new Promise<void>(resolve => { release = resolve; });
    source.historyPage.mockImplementationOnce(async () => { await gate; return [event()]; });
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true, ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    const pending = runtime.sync(1n, () => selected);
    await vi.waitFor(() => expect(source.historyPage).toHaveBeenCalledOnce()); selected = false; release(); await pending;
    expect(runtime.checkpoint(1n)).toBeNull();
    const consume = vi.fn(result => { expect(runtime.checkpoint(1n)).toBeNull(); expect(result.entries).toHaveLength(1); return true; });
    await runtime.sync(1n, consume);
    expect(consume).toHaveBeenCalledOnce(); expect(runtime.checkpoint(1n)?.nextBlock).toBe(111n);
    expect(source.historyPage).toHaveBeenNthCalledWith(2, 1n, 105n, 110n, SELECTED_CONTEXT);
  });
  it('retains a dropped empty reorg reset until a current consumer accepts it', async () => {
    const source = makeSession();
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true, ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    await runtime.sync(1n); source.hashes.set(110n, `0x${'99'.repeat(32)}`);
    source.inspect.mockResolvedValue({ createdBlock: 101n, firstMessageBlock: 0n, lastMessageBlock: 0n, messageCount: 0n });
    source.historyPage.mockResolvedValue([]); source.messageCountAtBlock.mockResolvedValue(0n);
    const dropped = await runtime.sync(1n, () => false);
    expect(dropped.resetConversation).toBe(true); expect(runtime.checkpoint(1n)).toBeNull();
    const consume = vi.fn(result => { expect(result).toMatchObject({ resetConversation: true, entries: [] }); return true; });
    await runtime.sync(1n, consume); expect(consume).toHaveBeenCalledOnce();
    expect((await runtime.sync(1n)).resetConversation).toBe(false);
  });
  it('does not consume a reset dropped before group creation is finalized', async () => {
    const source = makeSession();
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true, ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    await runtime.sync(1n); source.latestBlock.mockResolvedValue(110n);
    await runtime.sync(1n, () => false);
    expect((await runtime.sync(1n, () => true)).resetConversation).toBe(true);
    expect((await runtime.sync(1n)).resetConversation).toBe(false);
  });
  it('does not advance a page when its consumer throws', async () => {
    const source = makeSession();
    const runtime = createGroupChatV2HistoryRuntime({ confirmationDepth: 10n, isCurrent: () => true, ownerAddress: OWNER, session: source as unknown as GroupChatV2SessionController });
    await expect(runtime.sync(1n, () => { throw new Error('Consumer rejected page'); })).rejects.toThrow('Consumer rejected page');
    expect(runtime.checkpoint(1n)).toBeNull();
    await runtime.sync(1n, () => true); expect(runtime.checkpoint(1n)?.lastMessageId).toBe(1n);
  });
});
