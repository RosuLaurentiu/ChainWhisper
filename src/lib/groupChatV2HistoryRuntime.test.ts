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
import type { GroupChatV2MessageEvent } from './groupChatV2Chain';
import type { GroupChatV2SessionController } from './groupChatV2Session';

const CONTRACT = '0x2222222222222222222222222222222222222222';
const OWNER = '0x1111111111111111111111111111111111111111';
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
    inspect: vi.fn(async () => ({
      createdBlock: 101n,
      firstMessageBlock: 105n,
      lastMessageBlock: 105n,
      messageCount: 1n
    })),
    latestBlock: vi.fn(async () => 120n),
    canonicalBlock: vi.fn(async (blockNumber: bigint) => ({
      blockNumber,
      blockHash: hashes.get(blockNumber) ?? `0x${blockNumber.toString(16).padStart(64, '0')}`,
      timestamp: Number(blockNumber)
    })),
    historyPage: vi.fn(async () => [event()]),
    membershipRanges: vi.fn(async () => [{
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
    messageCountAtBlock: vi.fn(async () => 1n),
    readEpochKey: vi.fn(async () => ({
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
    expect(source.historyPage).toHaveBeenCalledWith(1n, 105n, 110n);
    expect(source.messageCountAtBlock).toHaveBeenCalledWith(1n, 110n);
    expect(source.membershipRanges).toHaveBeenCalledWith(1n, OWNER);
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
    expect(source.historyPage).toHaveBeenLastCalledWith(1n, 105n, 110n);
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
    expect(source.historyPage).toHaveBeenCalledWith(1n, 4_201n, 4_210n);
    expect(source.messageCountAtBlock).toHaveBeenCalledWith(1n, 4_210n);
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
    expect(source.historyPage).toHaveBeenNthCalledWith(2, 1n, 105n, 110n);
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
