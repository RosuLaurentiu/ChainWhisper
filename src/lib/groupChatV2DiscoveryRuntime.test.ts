import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionBrand = vi.hoisted(() => ({ assert: vi.fn() }));
vi.mock('./groupChatV2Session', async (importOriginal) => ({
  ...await importOriginal<typeof import('./groupChatV2Session')>(),
  assertGroupChatV2SessionController: sessionBrand.assert
}));

import { createGroupChatV2DiscoveryRuntime } from './groupChatV2DiscoveryRuntime';
import type { GroupChatV2SessionController } from './groupChatV2Session';

const OWNER = '0x1111111111111111111111111111111111111111';
const CONTRACT = '0x2222222222222222222222222222222222222222';
const EVENT_BLOCK_HASH = `0x${'33'.repeat(32)}`;

const makeSession = () => {
  const hashes = new Map<bigint, string>([
    [105n, EVENT_BLOCK_HASH],
    [107n, `0x${'77'.repeat(32)}`],
    [110n, `0x${'44'.repeat(32)}`]
  ]);
  return {
    ownerAddress: OWNER,
    manifest: {
      chainId: 7_082_400n,
      contractAddress: CONTRACT,
      deploymentBlock: 101n,
      runtimeBytecodeHash: `0x${'55'.repeat(32)}`
    },
    latestBlock: vi.fn(async () => 120n),
    canonicalBlock: vi.fn(async (blockNumber: bigint) => ({
      blockNumber,
      blockHash: hashes.get(blockNumber) ?? `0x${blockNumber.toString(16).padStart(64, '0')}`,
      timestamp: Number(blockNumber)
    })),
    lifecyclePage: vi.fn(async () => [{
      kind: 'member-added',
      groupId: 1n,
      walletAddress: OWNER,
      transactionHash: `0x${'66'.repeat(32)}`,
      blockHash: EVENT_BLOCK_HASH,
      blockNumber: 105n,
      logIndex: 0
    }]),
    inspect: vi.fn(async () => ({
      groupId: 1n,
      admin: OWNER,
      createdAt: 1_000n,
      updatedAt: 1_100n,
      createdBlock: 101n,
      metadataVersion: 0n,
      memberCount: 2n,
      lastMessageBlock: 108n
    })),
    inspectMember: vi.fn(async () => ({ active: true })),
    inspectInvite: vi.fn(async () => ({
      pending: false,
      effective: false,
      inviter: OWNER,
      expiresAt: 0n
    })),
    members: vi.fn(async () => [OWNER, '0x3333333333333333333333333333333333333333']),
    metadataPage: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
    metadataVersionAtBlock: vi.fn(async () => 0n),
    readMetadata: vi.fn(async () => ({ version: 1 as const, title: 'Private Desk' })),
    historyPage: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
    messageCountAtBlock: vi.fn(async () => 0n),
    clearEpochKeys: vi.fn(),
    hashes
  };
};

const farHeadSession = () => {
  const source = makeSession();
  const events = [
    { groupId: 1n, blockNumber: 105n },
    { groupId: 2n, blockNumber: 4_000n },
    { groupId: 4n, blockNumber: 9_999n }
  ];
  source.latestBlock.mockResolvedValue(10_010n);
  const blockHash = (block: bigint) => source.hashes.get(block) ?? `0x${block.toString(16).padStart(64, '0')}`;
  const lifecyclePage = vi.fn(async (from: bigint, to: bigint) => events
    .filter(event => event.blockNumber >= from && event.blockNumber <= to)
    .map(event => ({ ...event, kind: 'created', walletAddress: OWNER,
      transactionHash: `0x${'66'.repeat(32)}`, blockHash: blockHash(event.blockNumber), logIndex: 0 })));
  const inspect = vi.fn(async (groupId: bigint) => ({
    groupId, admin: OWNER, createdAt: 1_000n + groupId, updatedAt: 1_100n + groupId,
    createdBlock: events.find(event => event.groupId === groupId)?.blockNumber ?? 105n,
    metadataVersion: 0n, memberCount: 1n, lastMessageBlock: 0n
  }));
  return { ...source, lifecyclePage, inspect, events };
};

describe('groupChatV2DiscoveryRuntime', () => {
  beforeEach(() => vi.clearAllMocks());

  it('discovers owner-scoped active groups from finalized lifecycle events', async () => {
    const source = makeSession();
    const runtime = createGroupChatV2DiscoveryRuntime({
      confirmationDepth: 10n,
      isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController
    });
    const result = await runtime.sync();
    expect(result).toMatchObject({ complete: true, reorged: false, safeHead: 110n });
    expect(result.groups).toEqual([expect.objectContaining({
      id: 1,
      title: 'Group #1',
      isPrivate: true,
      memberCount: 2
    })]);
    expect(source.lifecyclePage).toHaveBeenCalledWith(101n, 110n);
  });

  it('projects an effective pending invite instead of an inactive membership', async () => {
    const source = makeSession();
    source.inspectMember.mockResolvedValueOnce({ active: false });
    source.inspectInvite.mockResolvedValueOnce({
      pending: true,
      effective: true,
      inviter: '0x3333333333333333333333333333333333333333',
      expiresAt: 2_000n
    });
    const runtime = createGroupChatV2DiscoveryRuntime({
      confirmationDepth: 10n,
      isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController
    });
    const result = await runtime.sync();
    expect(result.groups).toEqual([]);
    expect(result.invites).toEqual([expect.objectContaining({ groupId: 1, expired: false })]);
    expect(source.members).not.toHaveBeenCalled();
  });

  it('retains authorized archived groups and projects the native archive flag', async () => {
    const source = makeSession();
    const snapshot = await source.inspect();
    const archivedSnapshot = { ...snapshot, archived: true };
    source.inspect.mockResolvedValue(archivedSnapshot);
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });

    const result = await runtime.sync();
    expect(result.groups).toEqual([expect.objectContaining({ id: 1, archived: true })]);
  });

  it('uses only the finalized authenticated metadata version as the private title', async () => {
    const source = makeSession();
    source.metadataPage.mockResolvedValueOnce([{
      protocol: 'group-v2',
      groupId: 1n,
      metadataVersion: 1n,
      blockNumber: 107n,
      blockHash: source.hashes.get(107n)
    }]);
    source.metadataVersionAtBlock.mockResolvedValueOnce(1n);
    const runtime = createGroupChatV2DiscoveryRuntime({
      confirmationDepth: 10n,
      isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController
    });
    const result = await runtime.sync();
    expect(result.groups[0]?.title).toBe('Private Desk');
    expect(source.readMetadata).toHaveBeenCalledWith(expect.objectContaining({ metadataVersion: 1n }));
  });

  it('projects the latest finalized incoming anchor without decrypting every group', async () => {
    const source = makeSession();
    source.historyPage.mockResolvedValueOnce([{
      groupId: 1n,
      messageId: 1n,
      sender: '0x3333333333333333333333333333333333333333',
      blockNumber: 107n,
      blockHash: source.hashes.get(107n)
    }]);
    source.messageCountAtBlock.mockResolvedValueOnce(1n);
    const runtime = createGroupChatV2DiscoveryRuntime({
      confirmationDepth: 10n,
      isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController
    });
    const result = await runtime.sync();
    expect(result.latestIncoming).toEqual([{
      groupId: 1n,
      anchor: { messageId: 1n, blockNumber: 107n, blockHash: source.hashes.get(107n) }
    }]);
  });

  it('clears discovered identities and epoch keys after a finalized boundary reorg', async () => {
    const source = makeSession();
    const runtime = createGroupChatV2DiscoveryRuntime({
      confirmationDepth: 10n,
      isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController
    });
    await runtime.sync();
    source.hashes.set(110n, `0x${'99'.repeat(32)}`);
    const result = await runtime.sync();
    expect(result.reorged).toBe(true);
    expect(source.clearEpochKeys).toHaveBeenCalledOnce();
    expect(source.lifecyclePage).toHaveBeenLastCalledWith(101n, 110n);
  });

  it('discovers recent owner groups first and retains complete historical recovery', async () => {
    const source = farHeadSession();
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });

    const first = await runtime.sync();
    expect(first.groups.map(group => group.id)).toContain(4);
    expect(first.complete).toBe(false);
    expect(source.lifecyclePage.mock.calls[0]).toEqual([7_953n, 10_000n]);
    expect(source.lifecyclePage.mock.calls[1]).toEqual([101n, 2_148n]);
    let result = first;
    for (let step = 0; step < 6 && !result.complete; step++) result = await runtime.sync();
    expect(result.complete).toBe(true);
    expect(result.groups.map(group => group.id).sort()).toEqual([1, 2, 4]);
    for (const [from, to] of source.lifecyclePage.mock.calls) expect(to - from + 1n).toBeLessThanOrEqual(2_048n);
  });

  it('finds new recent groups while historical backfill is still incomplete', async () => {
    const source = farHeadSession();
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    await runtime.sync();
    source.events.push({ groupId: 5n, blockNumber: 10_001n });
    source.latestBlock.mockResolvedValue(10_012n);

    const next = await runtime.sync();
    expect(next.groups.map(group => group.id)).toContain(5);
    expect(next.complete).toBe(false);
    expect(source.lifecyclePage).toHaveBeenCalledWith(10_001n, 10_002n);
  });

  it.each([2_148n, 10_000n])('resets recent and historical identities after lifecycle boundary %s reorgs', async (boundary) => {
    const source = farHeadSession();
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    await runtime.sync();
    source.events.splice(0, source.events.length);
    source.hashes.set(boundary, `0x${'99'.repeat(32)}`);
    source.lifecyclePage.mockClear();

    const result = await runtime.sync();
    expect(result.reorged).toBe(true);
    expect(result.groups).toEqual([]);
    expect(source.clearEpochKeys).toHaveBeenCalledOnce();
    expect(source.lifecyclePage.mock.calls).toEqual([[7_953n, 10_000n], [101n, 2_148n]]);
    expect(result.complete).toBe(false);
  });

  it('keeps a gap after a long pause for historical recovery while exposing the new head', async () => {
    const source = farHeadSession();
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    await runtime.sync();
    source.events.push({ groupId: 3n, blockNumber: 12_500n }, { groupId: 6n, blockNumber: 19_999n });
    source.latestBlock.mockResolvedValue(20_010n);
    const recent = await runtime.sync();
    expect(recent.groups.map(group => group.id)).toContain(6);
    expect(recent.complete).toBe(false);
    expect(source.lifecyclePage).toHaveBeenCalledWith(17_953n, 20_000n);
    let result = recent;
    for (let step = 0; step < 12 && !result.complete; step++) result = await runtime.sync();
    expect(result.complete).toBe(true);
    expect(result.groups.map(group => group.id).sort()).toEqual([1, 2, 3, 4, 6]);
  });

  it('rejects an orphaned recent lifecycle event before projecting any identity', async () => {
    const source = farHeadSession();
    const original = source.lifecyclePage.getMockImplementation()!;
    source.lifecyclePage.mockImplementationOnce(async (from, to) =>
      (await original(from, to)).map(event => ({ ...event, blockHash: `0x${'ff'.repeat(32)}` })));
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });

    await expect(runtime.sync()).rejects.toThrow('orphaned lifecycle event');
    expect(source.inspect).not.toHaveBeenCalled();
    const recovered = await runtime.sync();
    expect(recovered.groups.map(group => group.id)).toContain(4);
  });

  it('rejects a recent boundary that changes during its page read', async () => {
    const source = farHeadSession();
    const original = source.lifecyclePage.getMockImplementation()!;
    source.lifecyclePage.mockImplementationOnce(async (from, to) => {
      source.hashes.set(to, `0x${'ff'.repeat(32)}`);
      return original(from, to);
    });
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });

    await expect(runtime.sync()).rejects.toThrow('boundary changed during synchronization');
    expect(source.inspect).not.toHaveBeenCalled();
  });

  it('serializes concurrent syncs and continues from the committed historical cursor', async () => {
    const source = farHeadSession();
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const original = source.lifecyclePage.getMockImplementation()!;
    let active = 0, peak = 0;
    source.lifecyclePage.mockImplementation(async (from, to) => {
      active++; peak = Math.max(peak, active);
      try {
        if (from === 7_953n) await waiting;
        return await original(from, to);
      } finally { active--; }
    });
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    const first = runtime.sync();
    await vi.waitFor(() => expect(source.lifecyclePage).toHaveBeenCalledOnce());
    const second = runtime.sync();
    for (let step = 0; step < 10; step++) await Promise.resolve();
    const startsBeforeRelease = source.latestBlock.mock.calls.length;
    release();
    const results = await Promise.all([first, second]);

    expect(startsBeforeRelease).toBe(1);
    expect(peak).toBe(1);
    expect(source.lifecyclePage.mock.calls).toEqual([
      [7_953n, 10_000n], [101n, 2_148n], [2_149n, 4_196n]
    ]);
    expect(results[0].groups.map(group => group.id).sort()).toEqual([1, 4]);
    expect(results[1].groups.map(group => group.id).sort()).toEqual([1, 2, 4]);
  });
});
