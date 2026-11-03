import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionBrand = vi.hoisted(() => ({ assert: vi.fn() }));
vi.mock('./groupChatV2Session', async (importOriginal) => ({
  ...await importOriginal<typeof import('./groupChatV2Session')>(),
  assertGroupChatV2SessionController: sessionBrand.assert
}));

import { createGroupChatV2DiscoveryRuntime, isGroupChatV2DiscoveryYield, subscribeGroupChatV2DiscoveryHints, chatV2BackgroundPollDelay,
  type GroupChatV2DiscoveryResult } from './groupChatV2DiscoveryRuntime';
import type { CotiEventHintSubscription } from './appShared/cotiEventHints';
import { GROUP_CHAT_V2_MESSAGE_TOPIC, GROUP_CHAT_V2_WALLET_LIFECYCLE_TOPICS } from './groupChatV2Chain';
import type { GroupChatV2SessionController } from './groupChatV2Session';

const OWNER = '0x1111111111111111111111111111111111111111';
const CONTRACT = '0x2222222222222222222222222222222222222222';
const EVENT_BLOCK_HASH = `0x${'33'.repeat(32)}`;

it('binds Group hints to the admitted address, owner lifecycle and known group IDs', async () => {
  const requests: CotiEventHintSubscription[] = [], onHint = vi.fn(), onStatus = vi.fn();
  const subscribe = vi.fn(async (request: CotiEventHintSubscription) => { requests.push(request); return vi.fn(); });
  const stop = await subscribeGroupChatV2DiscoveryHints({ subscribe, contractAddress: CONTRACT, ownerAddress: OWNER,
    groupIds: [7, 9, 7], isCurrent: () => true, onHint, onStatus });
  expect(requests).toHaveLength(2);
  expect(requests.every(request => request.address === CONTRACT)).toBe(true);
  expect(requests[0].topics).toEqual([GROUP_CHAT_V2_WALLET_LIFECYCLE_TOPICS, null, `0x${OWNER.slice(2).padStart(64, '0')}`]);
  expect(requests[1].topics?.[0]).toContain(GROUP_CHAT_V2_MESSAGE_TOPIC);
  expect(requests[1].topics?.[1]).toEqual([`0x${'7'.padStart(64, '0')}`, `0x${'9'.padStart(64, '0')}`]);
  requests[0].onStatus?.('connected'); expect(onStatus).not.toHaveBeenLastCalledWith('connected');
  requests[1].onStatus?.('connected'); expect(onStatus).toHaveBeenLastCalledWith('connected');
  requests[0].onHint(); expect(onHint).toHaveBeenCalledOnce();
  requests[1].onStatus?.('reconnecting'); expect(onStatus).toHaveBeenLastCalledWith('reconnecting');
  stop(); requests[0].onHint(); expect(onHint).toHaveBeenCalledOnce();
});

it('cleans late Group subscriptions and rejects stale hint callbacks', async () => {
  let current = true, release!: (stop: () => void) => void;
  const stopped = vi.fn(), onHint = vi.fn(), onStatus = vi.fn();
  let request!: CotiEventHintSubscription;
  const pending = subscribeGroupChatV2DiscoveryHints({ contractAddress: CONTRACT, ownerAddress: OWNER, groupIds: [],
    subscribe: async input => { request = input; return new Promise(resolve => { release = resolve; }); },
    isCurrent: () => current, onHint, onStatus });
  current = false; request.onHint(); request.onStatus?.('connected'); release(stopped);
  await pending;
  expect(stopped).toHaveBeenCalledOnce(); expect(onHint).not.toHaveBeenCalled(); expect(onStatus).not.toHaveBeenCalled();
});

it('uses slower safety catch-up with a healthy socket and controlled fallback outside Chat', () => {
  expect(chatV2BackgroundPollDelay(true, true, 5_000)).toBe(60_000);
  expect(chatV2BackgroundPollDelay(true, false, 5_000)).toBe(120_000);
  expect(chatV2BackgroundPollDelay(false, true, 5_000)).toBe(5_000);
  expect(chatV2BackgroundPollDelay(false, false, 5_000)).toBe(30_000);
});

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
    latestBlock: vi.fn<GroupChatV2SessionController['latestBlock']>(async () => 120n),
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
      firstMessageBlock: 107n,
      metadataVersion: 0n,
      memberCount: 2n,
      lastMessageBlock: 108n
    })),
    inspectMember: vi.fn(async () => ({ active: true })),
    membershipRanges: vi.fn<GroupChatV2SessionController['membershipRanges']>(async () => []),
    inspectInvite: vi.fn(async () => ({
      pending: false,
      effective: false,
      inviter: OWNER,
      expiresAt: 0n
    })),
    members: vi.fn(async () => [OWNER, '0x3333333333333333333333333333333333333333']),
    metadataPage: vi.fn<(groupId: bigint, from: bigint, to: bigint) => Promise<Array<Record<string, unknown>>>>(async () => []),
    metadataVersionAtBlock: vi.fn<GroupChatV2SessionController['metadataVersionAtBlock']>(async () => 0n),
    readMetadata: vi.fn(async () => ({ version: 1 as const, title: 'Private Desk' })),
    historyPage: vi.fn<(groupId: bigint, from: bigint, to: bigint) => Promise<Array<Record<string, unknown>>>>(async () => []),
    messageCountAtBlock: vi.fn<GroupChatV2SessionController['messageCountAtBlock']>(async () => 0n),
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

  it('keeps a hinted new group pending until its creation block is finalized', async () => {
    const source = makeSession();
    source.lifecyclePage.mockResolvedValue([]);
    source.inspect.mockResolvedValue({ ...await source.inspect(), createdBlock: 115n, firstMessageBlock: 0n, lastMessageBlock: 0n });
    const historicalRead = async (_groupId: bigint, block: bigint) => {
      if (block < 115n) throw new Error('InvalidGroup()');
      return 0n;
    };
    source.metadataVersionAtBlock.mockImplementation(historicalRead);
    source.messageCountAtBlock.mockImplementation(historicalRead);
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });

    const pending = await runtime.sync(false, undefined, undefined, { groupIds: [1n] });
    expect(pending).toMatchObject({ complete: false, groups: [{ id: 1, members: [], membersLoaded: false }] });
    expect(source.metadataVersionAtBlock).not.toHaveBeenCalled();
    expect(source.messageCountAtBlock).not.toHaveBeenCalled();
    expect(source.members).not.toHaveBeenCalled();

    source.latestBlock.mockResolvedValue(125n);
    const finalized = await runtime.sync();
    expect(finalized).toMatchObject({ complete: true, groups: [{ id: 1, membersLoaded: true, members: [OWNER,
      '0x3333333333333333333333333333333333333333'] }] });
    expect(source.metadataVersionAtBlock).toHaveBeenCalledWith(1n, 115n);
    expect(source.messageCountAtBlock).toHaveBeenCalledWith(1n, 115n);
    runtime.close();
  });

  it.each([false, true])('retains former history without current content and preserves re-invites (invited=%s)', async invited => {
    const source = makeSession();
    source.inspectMember.mockResolvedValue({ active: false });
    source.inspectInvite.mockResolvedValue({ pending: invited, effective: invited, inviter: OWNER, expiresAt: 9_999n });
    source.membershipRanges.mockResolvedValue([{ generation: 1n, firstMessageId: 1n, lastMessageId: 2n,
      firstEpoch: 2n, lastEpoch: 2n, joinedRevision: 2n, leftRevision: 3n, joinedAt: 1_001n, leftAt: 1_050n }]);
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    const result = await runtime.sync();
    expect(result.groups).toEqual([expect.objectContaining({ id: 1, title: 'Group #1', membershipEnded: true,
      members: [], lastBlock: 0, lastTimestamp: 1_050 })]);
    expect(result).toMatchObject({ complete: true, latestIncoming: [], incomingCompleteGroupIds: [] });
    expect(result.invites).toHaveLength(invited ? 1 : 0);
    expect(source.membershipRanges).toHaveBeenCalledWith(1n, OWNER);
    for (const read of [source.members, source.metadataVersionAtBlock, source.metadataPage,
      source.readMetadata, source.historyPage, source.messageCountAtBlock]) expect(read).not.toHaveBeenCalled();
    runtime.close();
  });

  it.each(['scope', 'canonical-head', 'membership-read'])('rejects an unverified former entry after %s changes', async changed => {
    const source = makeSession();
    let current = true;
    source.inspectMember.mockResolvedValue({ active: false });
    source.membershipRanges.mockImplementation(async () => {
      if (changed === 'scope') current = false;
      if (changed === 'canonical-head') source.hashes.set(110n, `0x${'99'.repeat(32)}`);
      if (changed === 'membership-read') throw new Error('Membership read unavailable');
      return [{ generation: 1n, firstMessageId: 1n, lastMessageId: 2n,
        firstEpoch: 2n, lastEpoch: 2n, joinedRevision: 2n, leftRevision: 3n, joinedAt: 1_001n, leftAt: 1_050n }];
    });
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => current,
      session: source as unknown as GroupChatV2SessionController });
    const progress = vi.fn();
    await expect(runtime.sync(false, progress)).rejects.toThrow();
    expect(progress).not.toHaveBeenCalled();
    runtime.close();
  });

  it.each([false, true])('excludes an inactive wallet without a membership range (invited=%s)', async invited => {
    const source = makeSession();
    source.inspectMember.mockResolvedValue({ active: false });
    source.inspectInvite.mockResolvedValue({ pending: invited, effective: invited, inviter: OWNER, expiresAt: 9_999n });
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    const result = await runtime.sync();
    expect(result.groups).toEqual([]);
    expect(result.invites).toHaveLength(invited ? 1 : 0);
    expect(source.membershipRanges).toHaveBeenCalledWith(1n, OWNER);
    runtime.close();
  });

  it('finds Group 4 just before the recent window before Group 2 near deployment', async () => {
    const source = farHeadSession();
    source.manifest.deploymentBlock = 8_982_896n;
    source.latestBlock.mockResolvedValue(10_390_083n);
    source.events.splice(0, source.events.length,
      { groupId: 2n, blockNumber: 8_982_906n },
      { groupId: 4n, blockNumber: 10_274_927n },
      { groupId: 4n, blockNumber: 10_275_441n });
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    try {
      expect(await runtime.sync()).toMatchObject({ groups: [], complete: false, hasOlder: true });
      const older = await runtime.sync(false, undefined, undefined, { older: true });
      expect(older.groups.map(group => group.id)).toEqual([4]);
      expect(older).toMatchObject({ complete: false, hasOlder: true });
      expect(source.lifecyclePage.mock.calls).toEqual([
        [10_290_074n, 10_390_073n], [10_190_074n, 10_290_073n]
      ]);
    } finally { runtime.close(); }
  });

  it('does not drain the lifecycle archive during ordinary refresh and accepts scoped identity hints', async () => {
    const source = farHeadSession();
    source.latestBlock.mockResolvedValue(300_010n);
    source.events[2].blockNumber = 250_000n;
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    expect((await runtime.sync()).groups.map(group => group.id)).toEqual([4]);
    const refresh = await runtime.sync();
    expect(refresh.hasOlder).toBe(true);
    expect(source.lifecyclePage.mock.calls).toEqual([[200_001n, 300_000n]]);
    const hinted = await runtime.sync(false, undefined, undefined, { groupIds: [2n] });
    expect(hinted.groups.map(group => group.id).sort()).toEqual([2, 4]);
    const older = await runtime.sync(false, undefined, undefined, { older: true });
    expect(older.groups.map(group => group.id).sort()).toEqual([1, 2, 4]);
    expect(older.hasOlder).toBe(false);
    expect((await runtime.sync(false, undefined, undefined, { older: true })).complete).toBe(true);
  });

  it.each([false, true])('keeps an unresolved old incoming range incomplete and gives new messages priority (new=%s)', async freshIncoming => {
    const source = makeSession();
    source.latestBlock.mockResolvedValue(10_010n);
    source.inspect.mockResolvedValue({ ...await source.inspect(), firstMessageBlock: 105n, lastMessageBlock: 9_999n });
    const events = [105n, 9_999n].map((blockNumber, index) => ({ groupId: 1n, messageId: BigInt(index + 1),
      sender: index ? OWNER : '0x3333333333333333333333333333333333333333', blockNumber,
      blockHash: source.hashes.get(blockNumber) ?? `0x${blockNumber.toString(16).padStart(64, '0')}` }));
    source.messageCountAtBlock.mockImplementation(async (_id, block) => BigInt(events.filter(event => event.blockNumber <= block).length));
    source.historyPage.mockImplementation(async (_id, from, to) => events.filter(event => event.blockNumber >= from && event.blockNumber <= to));
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    expect(await runtime.sync()).toMatchObject({ complete: false, latestIncoming: [], incomingCompleteGroupIds: [] });
    expect((await runtime.sync()).complete).toBe(false);
    expect(source.historyPage).toHaveBeenCalledOnce();
    if (freshIncoming) {
      const blockNumber = 10_001n;
      events.push({ ...events[0], messageId: 3n, blockNumber, blockHash: `0x${blockNumber.toString(16).padStart(64, '0')}` });
      source.latestBlock.mockResolvedValue(10_012n);
      source.inspect.mockResolvedValue({ ...await source.inspect(), lastMessageBlock: blockNumber });
    }
    let result = await runtime.sync(false, undefined, undefined, { older: true });
    for (let page = 0; page < 4 && result.hasOlder; page++) result = await runtime.sync(false, undefined, undefined, { older: true });
    expect(result).toMatchObject({ complete: true, hasOlder: false, incomingCompleteGroupIds: [1n],
      latestIncoming: [{ groupId: 1n, anchor: { messageId: freshIncoming ? 3n : 1n } }] });
    if (freshIncoming) expect(source.historyPage.mock.calls[1]).toEqual([1n, 10_001n, 10_002n]);
  });

  it('passes the live yield checkpoint through initial head setup and resumes without publishing skipped work', async () => {
    const source = makeSession();
    let pause = false, release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const head = vi.fn();
    source.latestBlock.mockImplementationOnce(async (_readContext, assertContinue) => {
      await held;
      assertContinue?.();
      head();
      return 120n;
    });
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    const progress = vi.fn();
    const pending = runtime.sync(false, progress, () => pause).catch(error => error);
    await vi.waitFor(() => expect(source.latestBlock).toHaveBeenCalledOnce());
    pause = true;
    release();
    expect(isGroupChatV2DiscoveryYield(await pending)).toBe(true);
    expect(head).not.toHaveBeenCalled();
    expect(source.canonicalBlock).not.toHaveBeenCalled();
    expect(source.lifecyclePage).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
    pause = false;
    expect((await runtime.sync(false, progress, () => pause)).groups).toHaveLength(1);
    expect(source.lifecyclePage).toHaveBeenCalledOnce();
    expect(source.lifecyclePage).toHaveBeenCalledWith(101n, 110n);
  });

  it('yields after an in-flight lifecycle read without starting its next fence or consuming its cursor', async () => {
    const source = makeSession();
    let pause = false, release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const original = source.lifecyclePage.getMockImplementation()!;
    source.lifecyclePage.mockImplementationOnce(async () => { await held; return original(); });
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    const progress = vi.fn();
    const pending = runtime.sync(false, progress, () => pause);
    const yielded = expect(pending).rejects.toSatisfy(isGroupChatV2DiscoveryYield);
    await vi.waitFor(() => expect(source.lifecyclePage).toHaveBeenCalledOnce());
    const fences = source.canonicalBlock.mock.calls.length;
    pause = true; release(); await yielded;
    expect(source.canonicalBlock).toHaveBeenCalledTimes(fences);
    expect(source.inspect).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
    pause = false;
    expect((await runtime.sync(false, progress, () => pause)).groups).toHaveLength(1);
    expect(source.lifecyclePage).toHaveBeenCalledTimes(2);
    expect(source.lifecyclePage).toHaveBeenNthCalledWith(2, 101n, 110n);
  });

  it('retains a lifecycle cursor committed before priority changes', async () => {
    const source = makeSession();
    let pause = false, boundaryReads = 0;
    const original = source.canonicalBlock.getMockImplementation()!;
    source.canonicalBlock.mockImplementation(async block => {
      const result = await original(block);
      if (block === 110n && ++boundaryReads === 2) pause = true;
      return result;
    });
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    await expect(runtime.sync(false, undefined, () => pause)).rejects.toSatisfy(isGroupChatV2DiscoveryYield);
    expect(source.inspect).not.toHaveBeenCalled();
    pause = false;
    expect((await runtime.sync(false, undefined, () => pause)).groups).toHaveLength(1);
    expect(source.lifecyclePage).toHaveBeenCalledOnce();
  });

  it('does not swallow a yield at metadata decryption or cache it as a failed version', async () => {
    const source = makeSession();
    let pause = false, trigger = true;
    source.metadataVersionAtBlock.mockResolvedValue(1n);
    source.metadataPage.mockResolvedValue([{ groupId: 1n, metadataVersion: 1n,
      blockNumber: 107n, blockHash: source.hashes.get(107n) }]);
    const original = source.canonicalBlock.getMockImplementation()!;
    source.canonicalBlock.mockImplementation(async block => {
      const result = await original(block);
      if (trigger && source.metadataPage.mock.calls.length === 1 && block === 110n) {
        pause = true;
        trigger = false;
      }
      return result;
    });
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    const progress = vi.fn();
    await expect(runtime.sync(false, progress, () => pause)).rejects.toSatisfy(isGroupChatV2DiscoveryYield);
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ complete: false,
      groups: [expect.objectContaining({ title: 'Group #1' })] }));
    expect(source.readMetadata).not.toHaveBeenCalled();
    expect(source.members).not.toHaveBeenCalled();
    pause = false;
    const recovered = await runtime.sync(false, undefined, () => pause);
    expect(recovered.groups[0]?.title).toBe('Private Desk');
    expect(source.metadataPage).toHaveBeenCalledTimes(2);
    expect(source.readMetadata).toHaveBeenCalledOnce();
  });

  it.each(['messages', 'members'] as const)('replays uncommitted content after a yield during %s', async phase => {
    const source = makeSession();
    let pause = false;
    source.messageCountAtBlock.mockResolvedValue(1n);
    source.historyPage.mockImplementation(async () => {
      if (phase === 'messages') pause = true;
      return [{ groupId: 1n, messageId: 1n, sender: '0x3333333333333333333333333333333333333333',
        blockNumber: 107n, blockHash: source.hashes.get(107n) }];
    });
    if (phase === 'members') source.members.mockImplementationOnce(async () => { pause = true; return [OWNER]; });
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    await expect(runtime.sync(false, undefined, () => pause)).rejects.toSatisfy(isGroupChatV2DiscoveryYield);
    pause = false;
    source.historyPage.mockImplementation(async () => [{ groupId: 1n, messageId: 1n,
      sender: '0x3333333333333333333333333333333333333333', blockNumber: 107n, blockHash: source.hashes.get(107n) }]);
    const recovered = await runtime.sync(false, undefined, () => pause);
    expect(recovered.latestIncoming[0]?.anchor.messageId).toBe(1n);
    expect(recovered.complete).toBe(true);
    expect(source.historyPage).toHaveBeenCalledTimes(2);
    expect(source.historyPage).toHaveBeenLastCalledWith(1n, 107n, 110n);
  });

  it('latches a genuine in-flight error even when priority changes during that read', async () => {
    const source = makeSession();
    let pause = false;
    source.latestBlock.mockImplementationOnce(async () => { pause = true; throw new Error('real head failure'); });
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    const failure = await runtime.sync(false, undefined, () => pause).catch(error => error);
    expect(failure.message).toContain('real head failure');
    expect(isGroupChatV2DiscoveryYield(failure)).toBe(false);
    pause = false;
    await expect(runtime.sync(false, undefined, () => pause)).rejects.toBe(failure);
    expect(source.latestBlock).toHaveBeenCalledOnce();
  });

  it('rejects a closed scope instead of yielding or starting another read', async () => {
    const source = makeSession();
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    runtime.close();
    await expect(runtime.sync(false, undefined, () => true)).rejects.toThrow('scope changed');
    expect(source.latestBlock).not.toHaveBeenCalled();
  });

  it.each(['inspect', 'members'] as const)('publishes verified groups before another group finishes %s', async phase => {
    const source = farHeadSession();
    source.events.splice(2);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const original = source.inspect.getMockImplementation()!;
    source.inspect.mockImplementation(async id => {
      if (phase === 'inspect' && id === 2n) await held;
      return original(id);
    });
    source.members.mockImplementation(async (...args: unknown[]) => {
      if (phase === 'members' && args[0] === 2n) await held;
      return [OWNER];
    });
    const progress: GroupChatV2DiscoveryResult[] = [];
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    let finished = false;
    const pending = runtime.sync(false, result => progress.push(result)).then(result => { finished = true; return result; });
    try {
      await vi.waitFor(() => expect(progress.some(result => result.groups.some(group => group.id === 1))).toBe(true));
      expect(finished).toBe(false);
      expect(progress[0]).toMatchObject({ complete: false, groups: [expect.objectContaining({
        id: 1, members: [], membersLoaded: false
      })] });
      expect(progress.every(result => !result.complete)).toBe(true);
      release();
      expect((await pending).groups).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 1, membersLoaded: true, members: [OWNER] }),
        expect.objectContaining({ id: 2, membersLoaded: true, members: [OWNER] })
      ]));
      expect(progress[0].groups).toHaveLength(1);
      expect(progress[0].groups[0]?.members).toEqual([]);
    } finally { release(); await pending; runtime.close(); }
  });

  it('publishes authenticated titles before message-history and roster backfill', async () => {
    const source = makeSession();
    source.metadataVersionAtBlock.mockResolvedValue(1n);
    source.metadataPage.mockResolvedValue([{ groupId: 1n, metadataVersion: 1n,
      blockNumber: 107n, blockHash: source.hashes.get(107n) }]);
    source.messageCountAtBlock.mockResolvedValue(1n);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    source.historyPage.mockImplementation(async () => {
      await held;
      return [{ groupId: 1n, messageId: 1n, sender: OWNER, blockNumber: 107n, blockHash: source.hashes.get(107n) }];
    });
    const progress: GroupChatV2DiscoveryResult[] = [];
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    const pending = runtime.sync(false, result => progress.push(result));
    try {
      await vi.waitFor(() => expect(source.historyPage).toHaveBeenCalledOnce());
      expect(progress[progress.length - 1]?.groups[0]).toMatchObject({ title: 'Private Desk', membersLoaded: false });
      expect(source.members).not.toHaveBeenCalled();
    } finally { release(); await pending; runtime.close(); }
  });

  it.each(['scope', 'safe head'] as const)('rejects changed %s before publishing a group', async change => {
    const source = makeSession();
    let current = true;
    source.inspectMember.mockImplementation(async () => {
      if (change === 'scope') current = false;
      else source.hashes.set(110n, `0x${'99'.repeat(32)}`);
      return { active: true };
    });
    const progress = vi.fn();
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => current,
      session: source as unknown as GroupChatV2SessionController });
    await expect(runtime.sync(false, progress)).rejects.toThrow(change === 'scope' ? 'scope changed' : 'safe head changed');
    expect(progress).not.toHaveBeenCalled();
    expect(source.readMetadata).not.toHaveBeenCalled();
  });

  it('retries failed title decryption only on explicit Refresh', async () => {
    const source = makeSession();
    source.metadataVersionAtBlock.mockResolvedValue(1n);
    source.metadataPage.mockResolvedValue([{ groupId: 1n, metadataVersion: 1n,
      blockNumber: 107n, blockHash: source.hashes.get(107n) }]);
    source.readMetadata.mockRejectedValueOnce(new Error('Decrypt unavailable.'));
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    expect((await runtime.sync()).groups[0]?.title).toBe('Group #1');
    expect((await runtime.sync()).groups[0]?.title).toBe('Group #1');
    expect(source.readMetadata).toHaveBeenCalledOnce();
    expect((await runtime.sync(true)).groups[0]?.title).toBe('Private Desk');
    expect(source.readMetadata).toHaveBeenCalledTimes(2);
    expect(source.metadataPage).toHaveBeenCalledOnce();
  });

  it('does not publish a cached private title after owner membership is removed', async () => {
    const source = makeSession();
    source.metadataVersionAtBlock.mockResolvedValue(1n);
    source.metadataPage.mockResolvedValue([{ groupId: 1n, metadataVersion: 1n,
      blockNumber: 107n, blockHash: source.hashes.get(107n) }]);
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    expect((await runtime.sync()).groups[0]?.title).toBe('Private Desk');
    source.inspectMember.mockResolvedValue({ active: false });
    source.membershipRanges.mockResolvedValue([{ generation: 1n, firstMessageId: 1n, lastMessageId: 2n,
      firstEpoch: 2n, lastEpoch: 2n, joinedRevision: 2n, leftRevision: 3n, joinedAt: 1_001n, leftAt: 1_050n }]);
    const progress = vi.fn();
    expect((await runtime.sync(false, progress)).groups).toEqual([expect.objectContaining({
      id: 1, title: 'Group #1', membershipEnded: true })]);
    expect(progress.mock.calls.every(([result]) => result.groups.every((group: { title: string }) => group.title === 'Group #1'))).toBe(true);
    expect(source.readMetadata).toHaveBeenCalledOnce();
  });

  it('drops the cached private title and marks every reorg progress snapshot incomplete', async () => {
    const source = makeSession();
    source.metadataVersionAtBlock.mockResolvedValue(1n);
    source.metadataPage.mockResolvedValue([{ groupId: 1n, metadataVersion: 1n,
      blockNumber: 107n, blockHash: source.hashes.get(107n) }]);
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    expect((await runtime.sync()).groups[0]?.title).toBe('Private Desk');
    source.hashes.set(110n, `0x${'99'.repeat(32)}`);
    source.readMetadata.mockResolvedValue({ version: 1, title: 'Replacement Desk' });
    const progress: GroupChatV2DiscoveryResult[] = [];
    expect((await runtime.sync(false, result => progress.push(result))).groups[0]?.title).toBe('Replacement Desk');
    expect(progress[0]?.groups[0]).toMatchObject({ title: 'Group #1', membersLoaded: false });
    expect(progress.every(result => result.reorged && !result.complete)).toBe(true);
    expect(progress.flatMap(result => result.groups).some(group => group.title === 'Private Desk')).toBe(false);
    expect(source.clearEpochKeys).toHaveBeenCalledOnce();
  });

  it('rejects late private results after scope invalidation during roster backfill', async () => {
    const source = makeSession();
    let current = true, release!: (members: string[]) => void;
    source.members.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const progress: GroupChatV2DiscoveryResult[] = [];
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => current,
      session: source as unknown as GroupChatV2SessionController });
    const pending = runtime.sync(false, result => progress.push(result));
    const rejected = expect(pending).rejects.toThrow('scope changed');
    await vi.waitFor(() => expect(source.members).toHaveBeenCalledOnce());
    const before = progress.length;
    current = false;
    release([OWNER]);
    await rejected;
    expect(progress).toHaveLength(before);
    expect(progress.every(result => result.groups.every(group => group.membersLoaded === false))).toBe(true);
  });

  it('balances discovery phases on success and latched failure despite observer errors', async () => {
    const source = makeSession();
    source.metadataVersionAtBlock.mockResolvedValue(1n);
    source.metadataPage.mockResolvedValueOnce([{
      groupId: 1n, metadataVersion: 1n, blockNumber: 107n, blockHash: source.hashes.get(107n)
    }]);
    source.messageCountAtBlock.mockResolvedValue(1n);
    source.historyPage.mockResolvedValueOnce([{
      groupId: 1n, messageId: 1n, sender: OWNER, blockNumber: 107n, blockHash: source.hashes.get(107n)
    }]);
    let releaseMembers!: (value: string[]) => void;
    source.members.mockImplementationOnce(() => new Promise(resolve => { releaseMembers = resolve; }));
    const counts = new Map<string, number>();
    const events: Array<readonly [string, boolean]> = [];
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController,
      onReadPhase: (phase, pending) => {
        events.push([phase, pending]);
        counts.set(phase, (counts.get(phase) ?? 0) + (pending ? 1 : -1));
        throw new Error('observer only');
      }
    });
    const pending = runtime.sync();
    await vi.waitFor(() => expect(source.members).toHaveBeenCalledOnce());
    expect(counts.get('members')).toBe(1);
    expect([...counts].filter(([, count]) => count !== 0)).toEqual([['members', 1]]);
    releaseMembers([OWNER]);
    await expect(pending).resolves.toMatchObject({ complete: true, groups: [expect.objectContaining({ title: 'Private Desk' })] });
    for (const phase of ['lifecycle', 'group-state', 'metadata', 'messages', 'members', 'fence']) {
      expect(events).toContainEqual([phase, true]);
      expect(counts.get(phase)).toBe(0);
    }

    source.members.mockRejectedValueOnce(new Error('members failed'));
    await expect(runtime.sync()).rejects.toThrow('members failed');
    expect([...counts.values()].every(count => count === 0)).toBe(true);
    const completedEvents = events.length;
    await expect(runtime.sync()).rejects.toThrow('members failed');
    expect(events).toHaveLength(completedEvents);
    expect(source.members).toHaveBeenCalledTimes(2);
  });

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

  it('retains a safe failure and prevents queued or automatic reads until explicit retry', async () => {
    const source = makeSession();
    source.latestBlock.mockRejectedValueOnce(Object.assign(new Error('private provider payload'), {
      code: 'COTI_RPC_QUEUE_EXPIRED',
      queueTiming: { ahead: 17, completed: 60, waitedMs: 30_000, budgetMs: 30_000,
        transportMs: 2_000, pacingMs: 28_000, nextStartMs: 0 }
    }));
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    const results = await Promise.allSettled([runtime.sync(), runtime.sync()]);
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
    const failure = (results[0] as PromiseRejectedResult).reason;
    expect(failure.message).toContain('chain head');
    expect(failure.message).toContain('request expired in queue');
    expect(failure.message).not.toContain('private provider payload');
    await expect(runtime.sync()).rejects.toBe(failure);
    expect(source.latestBlock).toHaveBeenCalledOnce();
    expect((await runtime.sync(true)).groups.map(group => group.id)).toEqual([1]);
    expect(source.latestBlock).toHaveBeenCalledTimes(2);
    runtime.close();
    await expect(runtime.sync(true)).rejects.toThrow('scope changed');
    expect(source.latestBlock).toHaveBeenCalledTimes(2);
  });

  it.each(['metadata', 'messages'] as const)('commits the %s page only after the final canonical read', async kind => {
    const source = makeSession();
    const event = { groupId: 1n, blockNumber: 107n, blockHash: source.hashes.get(107n),
      metadataVersion: 1n, messageId: 1n, sender: '0x3333333333333333333333333333333333333333' };
    const page = kind === 'metadata' ? source.metadataPage : source.historyPage;
    const original = source.canonicalBlock.getMockImplementation()!;
    let failBoundary = false;
    source.canonicalBlock.mockImplementation(async block => {
      if (failBoundary && block === 110n) {
        failBoundary = false;
        throw new Error('Canonical header unavailable.');
      }
      return original(block);
    });
    page.mockImplementationOnce(async () => { failBoundary = true; return [event]; });
    page.mockResolvedValue([event]);
    if (kind === 'metadata') source.metadataVersionAtBlock.mockResolvedValue(1n);
    else source.messageCountAtBlock.mockResolvedValue(1n);
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    await expect(runtime.sync()).rejects.toThrow('Canonical header unavailable');
    const recovered = await runtime.sync(true);
    expect(recovered.complete).toBe(true);
    expect(recovered.groups[0]?.title).toBe(kind === 'metadata' ? 'Private Desk' : 'Group #1');
    if (kind === 'messages') expect(recovered.latestIncoming[0]?.anchor.messageId).toBe(1n);
    expect(page).toHaveBeenNthCalledWith(1, 1n, kind === 'metadata' ? 101n : 107n, 110n);
    expect(page).toHaveBeenNthCalledWith(2, 1n, kind === 'metadata' ? 101n : 107n, 110n);
  });

  it('does not retain the valid prefix of a rejected message page', async () => {
    const source = makeSession();
    const event = { groupId: 1n, blockNumber: 107n, blockHash: source.hashes.get(107n),
      messageId: 1n, sender: '0x3333333333333333333333333333333333333333' };
    source.historyPage.mockResolvedValueOnce([event, { ...event, messageId: 3n }]);
    source.historyPage.mockResolvedValue([event, { ...event, messageId: 2n }]);
    source.messageCountAtBlock.mockResolvedValue(2n);
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    await expect(runtime.sync()).rejects.toThrow('incomplete');
    expect((await runtime.sync(true)).latestIncoming[0]?.anchor.messageId).toBe(2n);
  });

  it.each(['metadata counter', 'message counter', 'members'] as const)('keeps the previous page checkpoint when %s fails', async kind => {
    const source = makeSession();
    source.metadataVersionAtBlock.mockResolvedValue(1n);
    source.metadataPage.mockResolvedValue([{ groupId: 1n, metadataVersion: 1n,
      blockNumber: 107n, blockHash: source.hashes.get(107n) }]);
    const read = kind === 'metadata counter' ? source.metadataVersionAtBlock
      : kind === 'message counter' ? source.messageCountAtBlock : source.members;
    read.mockRejectedValueOnce(new Error('Read unavailable.'));
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    await expect(runtime.sync()).rejects.toThrow('Read unavailable');
    expect(source.metadataPage).toHaveBeenCalledTimes(kind === 'members' ? 1 : 0);
    expect((await runtime.sync(true)).complete).toBe(true);
    expect(source.metadataPage).toHaveBeenCalledTimes(kind === 'members' ? 2 : 1);
    expect(source.metadataPage).toHaveBeenLastCalledWith(1n, 101n, 110n);
  });

  it('discovers recent owner groups first and retains complete historical recovery', async () => {
    const source = farHeadSession();
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });

    const first = await runtime.sync();
    expect(first.groups.map(group => group.id)).toContain(4);
    expect(first.complete).toBe(true);
    expect(source.lifecyclePage.mock.calls[0]).toEqual([101n, 10_000n]);
    expect(source.lifecyclePage).toHaveBeenCalledOnce();
    let result = first;
    for (let step = 0; step < 6 && !result.complete; step++) result = await runtime.sync();
    expect(result.complete).toBe(true);
    expect(result.groups.map(group => group.id).sort()).toEqual([1, 2, 4]);
    for (const [from, to] of source.lifecyclePage.mock.calls) expect(to - from + 1n).toBeLessThanOrEqual(100_000n);
    for (const [, from, to] of [...source.metadataPage.mock.calls, ...source.historyPage.mock.calls]) {
      expect(to - from + 1n).toBeLessThanOrEqual(2_048n);
    }
  });

  it('completes empty group content from finalized counters without walking empty block pages', async () => {
    const source = farHeadSession();
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    expect((await runtime.sync()).complete).toBe(true);
    expect(source.metadataPage).not.toHaveBeenCalled();
    expect(source.historyPage).not.toHaveBeenCalled();
    expect(source.metadataVersionAtBlock).toHaveBeenCalledWith(1n, 10_000n);
    expect(source.messageCountAtBlock).toHaveBeenCalledWith(1n, 10_000n);
  });

  it('starts discovery at the first message after a long idle creation gap', async () => {
    const source = makeSession();
    source.latestBlock.mockResolvedValue(100_010n);
    source.inspect.mockResolvedValue({ ...await source.inspect(), firstMessageBlock: 80_000n, lastMessageBlock: 80_000n });
    source.messageCountAtBlock.mockResolvedValue(1n);
    const event = { groupId: 1n, messageId: 1n, sender: '0x3333333333333333333333333333333333333333',
      blockNumber: 80_000n, blockHash: `0x${80_000n.toString(16).padStart(64, '0')}` };
    source.historyPage.mockImplementation(async (_id, from, to) => event.blockNumber >= from && event.blockNumber <= to ? [event] : []);
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    const result = await runtime.sync();
    expect(result.complete).toBe(true);
    expect(result.latestIncoming[0]?.anchor.blockNumber).toBe(80_000n);
    expect(source.historyPage.mock.calls).toEqual([[1n, 80_000n, 82_047n]]);
  });

  it('skips the cached empty prefix only after the first message finalizes', async () => {
    const source = makeSession();
    source.latestBlock.mockResolvedValue(80_005n);
    source.inspect.mockResolvedValue({ ...await source.inspect(), firstMessageBlock: 80_000n, lastMessageBlock: 80_000n });
    const event = { groupId: 1n, messageId: 1n, sender: '0x3333333333333333333333333333333333333333',
      blockNumber: 80_000n, blockHash: `0x${80_000n.toString(16).padStart(64, '0')}` };
    source.historyPage.mockImplementation(async (_id, from, to) => event.blockNumber >= from && event.blockNumber <= to ? [event] : []);
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    expect((await runtime.sync()).complete).toBe(true);
    expect(source.historyPage).not.toHaveBeenCalled();
    source.latestBlock.mockResolvedValue(100_010n);
    source.messageCountAtBlock.mockResolvedValue(1n);
    expect((await runtime.sync()).latestIncoming[0]?.anchor.blockNumber).toBe(80_000n);
    expect(source.historyPage.mock.calls).toEqual([[1n, 80_000n, 82_047n]]);
  });

  it.each([0n, 100n, 109n])('rejects invalid first-message anchor %s before reading message logs', async firstMessageBlock => {
    const source = makeSession();
    source.inspect.mockResolvedValue({ ...await source.inspect(), firstMessageBlock });
    source.messageCountAtBlock.mockResolvedValue(1n);
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    await expect(runtime.sync()).rejects.toThrow('message-block anchors are inconsistent');
    expect(source.historyPage).not.toHaveBeenCalled();
  });

  it('replays from the current first-message anchor after a reorg', async () => {
    const source = makeSession();
    source.latestBlock.mockResolvedValue(100_010n);
    const group = await source.inspect();
    let first = 80_000n;
    source.inspect.mockImplementation(async () => ({ ...group, firstMessageBlock: first, lastMessageBlock: first }));
    source.messageCountAtBlock.mockResolvedValue(1n);
    source.historyPage.mockImplementation(async (_id, from, to) => first >= from && first <= to ? [{
      groupId: 1n, messageId: 1n, sender: '0x3333333333333333333333333333333333333333',
      blockNumber: first, blockHash: `0x${first.toString(16).padStart(64, '0')}`
    }] : []);
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    await runtime.sync();
    first = 82_000n;
    source.hashes.set(100_000n, `0x${'99'.repeat(32)}`);
    const result = await runtime.sync();
    expect(result).toMatchObject({ complete: true, reorged: true });
    expect(result.latestIncoming[0]?.anchor.blockNumber).toBe(82_000n);
    expect(source.historyPage).toHaveBeenLastCalledWith(1n, 82_000n, 84_047n);
  });

  it('stops after finding every finalized entry without scanning the remaining empty tail', async () => {
    const source = makeSession();
    source.latestBlock.mockResolvedValue(10_010n);
    source.metadataPage.mockResolvedValue([{ groupId: 1n, metadataVersion: 1n,
      blockNumber: 9_999n, blockHash: `0x${9_999n.toString(16).padStart(64, '0')}` }]);
    source.metadataVersionAtBlock.mockImplementation(async (_id: bigint, block: bigint) => block < 9_999n ? 0n : 1n);
    source.historyPage.mockResolvedValue([{ groupId: 1n, messageId: 1n,
      sender: '0x3333333333333333333333333333333333333333',
      blockNumber: 107n, blockHash: source.hashes.get(107n) }]);
    source.messageCountAtBlock.mockResolvedValue(1n);
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    const result = await runtime.sync();
    expect(result.complete).toBe(true);
    expect(result.groups[0]?.title).toBe('Private Desk');
    expect(result.latestIncoming[0]?.anchor.messageId).toBe(1n);
    expect(source.metadataPage).toHaveBeenCalledOnce();
    expect(source.historyPage).toHaveBeenCalledOnce();
    await runtime.sync();
    expect(source.metadataPage).toHaveBeenCalledOnce();
    expect(source.historyPage).toHaveBeenCalledOnce();
  });

  it('keeps older metadata explicit while recent incoming history is complete', async () => {
    const source = makeSession();
    source.latestBlock.mockResolvedValue(10_010n);
    const event = { groupId: 1n, metadataVersion: 1n, messageId: 1n,
      sender: '0x3333333333333333333333333333333333333333', blockNumber: 4_000n,
      blockHash: `0x${4_000n.toString(16).padStart(64, '0')}` };
    source.metadataVersionAtBlock.mockImplementation(async (_id: bigint, block: bigint) => block < 4_000n ? 0n : 1n);
    source.messageCountAtBlock.mockResolvedValue(1n);
    source.inspect.mockResolvedValue({ ...await source.inspect(), firstMessageBlock: 4_000n, lastMessageBlock: 4_000n });
    source.metadataPage.mockImplementation(async (_id, from, to) => event.blockNumber >= from && event.blockNumber <= to ? [event] : []);
    source.historyPage.mockImplementation(async (_id, from, to) => event.blockNumber >= from && event.blockNumber <= to ? [event] : []);
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    expect((await runtime.sync()).complete).toBe(false);
    expect(source.readMetadata).not.toHaveBeenCalled();
    source.latestBlock.mockResolvedValue(10_012n);
    expect((await runtime.sync()).complete).toBe(false);
    expect(source.metadataPage).toHaveBeenCalledOnce();
    expect((await runtime.sync(false, undefined, undefined, { older: true })).complete).toBe(false);
    const second = await runtime.sync(false, undefined, undefined, { older: true });
    expect(second.complete).toBe(true);
    expect(second.latestIncoming[0]?.anchor.messageId).toBe(1n);
    expect(source.metadataPage).toHaveBeenLastCalledWith(1n, 3_857n, 5_904n);
    expect(source.historyPage.mock.calls).toEqual([[1n, 4_000n, 6_047n]]);
  });

  it.each(['metadata', 'message'] as const)('rejects a missing finalized %s suffix and recovers the same page', async kind => {
    const source = makeSession();
    const event = { groupId: 1n, metadataVersion: 1n, messageId: 1n,
      sender: '0x3333333333333333333333333333333333333333',
      blockNumber: 107n, blockHash: source.hashes.get(107n) };
    const page = kind === 'metadata' ? source.metadataPage : source.historyPage;
    const counter = kind === 'metadata' ? source.metadataVersionAtBlock : source.messageCountAtBlock;
    counter.mockResolvedValue(2n);
    page.mockResolvedValueOnce([event]);
    page.mockResolvedValue([event, { ...event, metadataVersion: 2n, messageId: 2n }]);
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    await expect(runtime.sync()).rejects.toThrow('missing a finalized');
    expect((await runtime.sync(true)).complete).toBe(true);
    expect(page).toHaveBeenNthCalledWith(2, 1n, kind === 'metadata' ? 101n : 107n, 110n);
  });

  it('rejects a changed safe head before committing a counter-based completion', async () => {
    const source = makeSession();
    source.metadataVersionAtBlock.mockImplementationOnce(async () => {
      source.hashes.set(110n, `0x${'99'.repeat(32)}`);
      return 0n;
    });
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    await expect(runtime.sync()).rejects.toThrow('safe head changed');
    const recovered = await runtime.sync(true);
    expect(recovered.reorged).toBe(true);
    expect(recovered.complete).toBe(true);
    expect(source.metadataPage).not.toHaveBeenCalled();
    expect(source.historyPage).not.toHaveBeenCalled();
  });

  it('bridges wide owner lifecycle pages without widening group content reads', async () => {
    const source = farHeadSession();
    source.latestBlock.mockResolvedValue(300_010n);
    source.events[2].blockNumber = 250_000n;
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    const first = await runtime.sync(false, undefined, undefined, { older: true });
    expect(first.groups.map(group => group.id)).toEqual([4]);
    expect(first.complete).toBe(false);
    expect((await runtime.sync(false, undefined, undefined, { older: true })).groups.map(group => group.id).sort()).toEqual([1, 2, 4]);
    expect((await runtime.sync(false, undefined, undefined, { older: true })).complete).toBe(true);
    expect(source.lifecyclePage.mock.calls).toEqual([
      [200_001n, 300_000n], [100_001n, 200_000n], [101n, 100_000n]
    ]);
    for (const [, from, to] of [...source.metadataPage.mock.calls, ...source.historyPage.mock.calls]) {
      expect(to - from + 1n).toBeLessThanOrEqual(2_048n);
    }
  });

  it('batches four empty historical pages before rebuilding a known group and resumes at the next page', async () => {
    const source = farHeadSession();
    source.latestBlock.mockResolvedValue(1_000_010n);
    source.events.splice(0, source.events.length, { groupId: 4n, blockNumber: 950_000n });
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    expect((await runtime.sync(false, undefined, undefined, { older: true })).groups.map(group => group.id)).toEqual([4]);
    for (const read of [source.lifecyclePage, source.inspect, source.inspectMember, source.inspectInvite,
      source.metadataVersionAtBlock, source.messageCountAtBlock, source.members]) read.mockClear();

    let partial = await runtime.sync(false, undefined, undefined, { older: true });
    for (let pass = 1; source.lifecyclePage.mock.calls.length < 4 && pass < 4; pass += 1) {
      partial = await runtime.sync(false, undefined, undefined, { older: true });
    }
    expect(partial.complete).toBe(false);
    expect(source.lifecyclePage.mock.calls).toEqual([
      [800_001n, 900_000n], [700_001n, 800_000n], [600_001n, 700_000n], [500_001n, 600_000n]
    ]);
    expect(Object.fromEntries((['inspect', 'inspectMember', 'inspectInvite', 'metadataVersionAtBlock',
      'messageCountAtBlock', 'members'] as const).map(name => [name, source[name].mock.calls.length])))
      .toEqual({ inspect: 1, inspectMember: 1, inspectInvite: 1, metadataVersionAtBlock: 1,
        messageCountAtBlock: 1, members: 1 });
    source.lifecyclePage.mockClear();
    expect((await runtime.sync(false, undefined, undefined, { older: true })).complete).toBe(false);
    expect(source.lifecyclePage.mock.calls[0]).toEqual([400_001n, 500_000n]);
    expect(source.lifecyclePage).toHaveBeenCalledTimes(4);
    source.lifecyclePage.mockClear();
    expect((await runtime.sync(false, undefined, undefined, { older: true })).complete).toBe(true);
    expect(source.lifecyclePage.mock.calls).toEqual([[101n, 100_000n]]);
    runtime.close();
  });

  it('completes the checked deployment interval in fourteen contiguous recent-first lifecycle pages', async () => {
    const source = farHeadSession();
    const deploymentBlock = 8_982_896n, safeHead = 10_368_834n, confirmationDepth = 5n;
    source.manifest.deploymentBlock = deploymentBlock;
    source.latestBlock.mockResolvedValue(safeHead + confirmationDepth);
    source.events.splice(0, source.events.length,
      { groupId: 1n, blockNumber: deploymentBlock + 10n },
      { groupId: 2n, blockNumber: deploymentBlock + 700_010n },
      { groupId: 4n, blockNumber: safeHead - 10n });
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    const pageCounts = [1, 5, 7, 11, 14];
    try {
      for (const [pass, pageCount] of pageCounts.entries()) {
        const result = await runtime.sync(false, undefined, undefined, { older: true });
        expect(source.lifecyclePage).toHaveBeenCalledTimes(pageCount);
        expect(result.complete).toBe(pass === pageCounts.length - 1);
        if (pageCount === 7) expect(result.groups.map(group => group.id).sort()).toEqual([2, 4]);
        if (result.complete) {
          expect(result.groups.map(group => group.id).sort()).toEqual([1, 2, 4]);
        }
      }
      expect(source.latestBlock).toHaveBeenCalledTimes(5);
      expect(source.lifecyclePage.mock.calls[0]).toEqual([10_268_835n, safeHead]);
      const ranges = [...source.lifecyclePage.mock.calls].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
      let nextBlock = deploymentBlock;
      for (const [from, to] of ranges) {
        expect(from).toBe(nextBlock);
        expect(to).toBeGreaterThanOrEqual(from);
        expect(to - from + 1n).toBeLessThanOrEqual(100_000n);
        nextBlock = to + 1n;
      }
      expect(nextBlock).toBe(safeHead + 1n);
      expect(source.metadataPage).not.toHaveBeenCalled();
      expect(source.historyPage).not.toHaveBeenCalled();
      expect(source.clearEpochKeys).not.toHaveBeenCalled();
    } finally { runtime.close(); }
  });

  it('ends a historical batch as soon as a page discovers a new group', async () => {
    const source = farHeadSession();
    source.latestBlock.mockResolvedValue(1_000_010n);
    source.events.splice(0, source.events.length, { groupId: 4n, blockNumber: 950_000n },
      { groupId: 5n, blockNumber: 750_000n });
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    await runtime.sync(false, undefined, undefined, { older: true });
    source.lifecyclePage.mockClear();
    expect((await runtime.sync(false, undefined, undefined, { older: true })).groups.map(group => group.id).sort()).toEqual([4, 5]);
    expect(source.lifecyclePage.mock.calls).toEqual([[800_001n, 900_000n], [700_001n, 800_000n]]);
    runtime.close();
  });

  it('does not start another historical page after scope invalidation during a batch', async () => {
    const source = farHeadSession();
    source.latestBlock.mockResolvedValue(1_000_010n);
    source.events.splice(0, source.events.length, { groupId: 4n, blockNumber: 950_000n });
    let current = true;
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => current,
      session: source as unknown as GroupChatV2SessionController });
    await runtime.sync(false, undefined, undefined, { older: true });
    const original = source.lifecyclePage.getMockImplementation()!;
    source.lifecyclePage.mockClear();
    source.lifecyclePage.mockImplementation(async (from, to) => {
      const events = await original(from, to);
      if (from === 700_001n) current = false;
      return events;
    });
    const progress = vi.fn();
    await expect(runtime.sync(false, progress, undefined, { older: true })).rejects.toThrow('scope changed');
    expect(source.lifecyclePage.mock.calls).toEqual([[800_001n, 900_000n], [700_001n, 800_000n]]);
    expect(progress).not.toHaveBeenCalled();
    runtime.close();
  });

  it('restarts historical batching after a committed boundary reorg', async () => {
    const source = farHeadSession();
    source.latestBlock.mockResolvedValue(1_000_010n);
    source.events.splice(0, source.events.length, { groupId: 4n, blockNumber: 950_000n });
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    await runtime.sync(false, undefined, undefined, { older: true });
    await runtime.sync(false, undefined, undefined, { older: true });
    source.hashes.set(600_000n, `0x${'99'.repeat(32)}`);
    source.lifecyclePage.mockClear();
    expect(await runtime.sync(false, undefined, undefined, { older: true })).toMatchObject({ reorged: true, complete: false,
      groups: [expect.objectContaining({ id: 4 })] });
    expect(source.clearEpochKeys).toHaveBeenCalledOnce();
    expect(source.lifecyclePage.mock.calls).toEqual([[900_001n, 1_000_000n]]);
    source.lifecyclePage.mockClear();
    await runtime.sync(false, undefined, undefined, { older: true });
    expect(source.lifecyclePage.mock.calls[0]).toEqual([800_001n, 900_000n]);
    expect(source.lifecyclePage).toHaveBeenCalledTimes(4);
    runtime.close();
  });

  it.each(['cold', 'reorg'] as const)('publishes recent groups after %s before held history and advances despite new recent activity', async start => {
    const source = farHeadSession();
    source.latestBlock.mockResolvedValue(300_010n);
    source.events[2].blockNumber = 250_000n;
    source.events[1].blockNumber = 150_000n;
    const original = source.lifecyclePage.getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    source.lifecyclePage.mockImplementation(async (from, to) => {
      if (from === 100_001n) await held;
      return original(from, to);
    });
    const progress: GroupChatV2DiscoveryResult[] = [];
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    if (start === 'reorg') {
      await runtime.sync(false, undefined, undefined, { older: true });
      source.hashes.set(300_000n, `0x${'99'.repeat(32)}`);
      source.lifecyclePage.mockClear();
    }
    const first = runtime.sync(false, result => progress.push(result));
    try {
      await vi.waitFor(() => expect(progress.some(result => result.groups.some(group => group.id === 4))).toBe(true));
      const recent = await first;
      expect(recent).toMatchObject({ complete: false, reorged: start === 'reorg', groups: [expect.objectContaining({ id: 4 })] });
      expect(progress.every(result => !result.complete)).toBe(true);
      expect(source.lifecyclePage.mock.calls).toEqual([[200_001n, 300_000n]]);
      const continuing = runtime.sync(false, undefined, undefined, { older: true });
      await vi.waitFor(() => expect(source.lifecyclePage).toHaveBeenCalledWith(100_001n, 200_000n));
      source.events.push({ groupId: 5n, blockNumber: 300_001n });
      source.latestBlock.mockResolvedValue(300_012n);
      release();
      expect((await continuing).complete).toBe(false);
      const recovered = await runtime.sync(false, undefined, undefined, { older: true });
      expect(recovered.complete).toBe(true);
      expect(recovered.groups.map(group => group.id).sort()).toEqual([1, 2, 4, 5]);
      expect(source.lifecyclePage.mock.calls).toEqual([
        [200_001n, 300_000n], [100_001n, 200_000n], [300_001n, 300_002n], [101n, 100_000n]
      ]);
    } finally { release(); await first; runtime.close(); }
  });

  it('finds new recent groups while historical backfill is still incomplete', async () => {
    const source = farHeadSession();
    source.latestBlock.mockResolvedValue(300_010n);
    source.events[2].blockNumber = 250_000n;
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    expect((await runtime.sync(false, undefined, undefined, { older: true })).complete).toBe(false);
    source.events.push({ groupId: 5n, blockNumber: 300_001n });
    source.latestBlock.mockResolvedValue(300_012n);

    const next = await runtime.sync(false, undefined, undefined, { older: true });
    expect(next.groups.map(group => group.id)).toContain(5);
    expect(next.complete).toBe(true);
    expect(source.lifecyclePage).toHaveBeenCalledWith(300_001n, 300_002n);
  });

  it.each([200_000n, 300_000n])('resets recent and historical identities after lifecycle boundary %s reorgs', async (boundary) => {
    const source = farHeadSession();
    source.latestBlock.mockResolvedValue(300_010n);
    source.events[1].blockNumber = 150_000n;
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    await runtime.sync(false, undefined, undefined, { older: true });
    source.events.splice(0, source.events.length);
    source.hashes.set(boundary, `0x${'99'.repeat(32)}`);
    source.lifecyclePage.mockClear();

    const result = await runtime.sync(false, undefined, undefined, { older: true });
    expect(result.reorged).toBe(true);
    expect(result.groups).toEqual([]);
    expect(source.clearEpochKeys).toHaveBeenCalledOnce();
    expect(source.lifecyclePage.mock.calls).toEqual([
      [200_001n, 300_000n], [100_001n, 200_000n], [101n, 100_000n]
    ]);
    expect(result.complete).toBe(true);
  });

  it('keeps a gap after a long pause for historical recovery while exposing the new head', async () => {
    const source = farHeadSession();
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    await runtime.sync(false, undefined, undefined, { older: true });
    source.events.push({ groupId: 3n, blockNumber: 250_000n }, { groupId: 6n, blockNumber: 499_999n });
    source.latestBlock.mockResolvedValue(500_010n);
    const recent = await runtime.sync(false, undefined, undefined, { older: true });
    expect(recent.groups.map(group => group.id)).toContain(6);
    expect(recent.complete).toBe(false);
    expect(source.lifecyclePage).toHaveBeenCalledWith(400_001n, 500_000n);
    expect(source.lifecyclePage).toHaveBeenCalledWith(200_001n, 300_000n);
    expect(recent.groups.map(group => group.id).sort()).toEqual([1, 2, 3, 4, 6]);
    expect((await runtime.sync(false, undefined, undefined, { older: true })).complete).toBe(true);
    expect(source.lifecyclePage.mock.calls).toEqual([
      [101n, 10_000n], [400_001n, 500_000n], [300_001n, 400_000n],
      [200_001n, 300_000n], [100_001n, 200_000n], [10_001n, 100_000n]
    ]);
  });

  it('rejects an orphaned recent lifecycle event before projecting any identity', async () => {
    const source = farHeadSession();
    const original = source.lifecyclePage.getMockImplementation()!;
    source.lifecyclePage.mockImplementationOnce(async (from, to) =>
      (await original(from, to)).map(event => ({ ...event, blockHash: `0x${'ff'.repeat(32)}` })));
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });

    await expect(runtime.sync(false, undefined, undefined, { older: true })).rejects.toThrow('orphaned lifecycle event');
    expect(source.inspect).not.toHaveBeenCalled();
    const recovered = await runtime.sync(true);
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

    await expect(runtime.sync(false, undefined, undefined, { older: true })).rejects.toThrow('boundary changed during synchronization');
    expect(source.inspect).not.toHaveBeenCalled();
  });

  it('serializes concurrent syncs and continues from the committed historical cursor', async () => {
    const source = farHeadSession();
    source.latestBlock.mockResolvedValue(300_010n);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const original = source.lifecyclePage.getMockImplementation()!;
    let active = 0, peak = 0;
    source.lifecyclePage.mockImplementation(async (from, to) => {
      active++; peak = Math.max(peak, active);
      try {
        if (from === 200_001n) await waiting;
        return await original(from, to);
      } finally { active--; }
    });
    const runtime = createGroupChatV2DiscoveryRuntime({ confirmationDepth: 10n, isCurrent: () => true,
      session: source as unknown as GroupChatV2SessionController });
    const first = runtime.sync(false, undefined, undefined, { older: true });
    await vi.waitFor(() => expect(source.lifecyclePage).toHaveBeenCalledOnce());
    const second = runtime.sync(false, undefined, undefined, { older: true });
    for (let step = 0; step < 10; step++) await Promise.resolve();
    const startsBeforeRelease = source.latestBlock.mock.calls.length;
    release();
    const results = await Promise.all([first, second]);

    expect(startsBeforeRelease).toBe(1);
    expect(peak).toBe(1);
    expect(source.lifecyclePage.mock.calls).toEqual([
      [200_001n, 300_000n], [100_001n, 200_000n], [101n, 100_000n]
    ]);
    expect(results[0].groups.map(group => group.id).sort()).toEqual([1, 2, 4]);
    expect(results[1].groups.map(group => group.id).sort()).toEqual([1, 2, 4]);
  });
});
