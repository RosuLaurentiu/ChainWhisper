import { getProviderErrorMessage, type GroupInvite, type GroupSummary } from './appShared/core';
import { describeCotiRpcQueueExpiry } from './appShared/cotiRpcPacing';
import type { GroupChatV2MetadataEvent } from './groupChatV2Chain';
import type { GroupChatV2ReadCursorAnchor } from './groupChatV2ReadCursor';
import { getAddress, Interface, toBeHex, zeroPadValue } from '@coti-io/coti-ethers';
import { GROUP_CHAT_V2_ABI, GROUP_CHAT_V2_MAX_WALLET_LIFECYCLE_BLOCK_SPAN,
  GROUP_CHAT_V2_WALLET_LIFECYCLE_TOPICS } from './groupChatV2Chain';
import type { CotiEventHintSubscriber, CotiEventHintStatus } from './appShared/cotiEventHints';
import {
  assertGroupChatV2SessionController,
  observeGroupChatV2Read,
  type GroupChatV2ReadObserver,
  type GroupChatV2ReadPhase,
  type GroupChatV2SessionController
} from './groupChatV2Session';

export type GroupChatV2DiscoveryResult = Readonly<{
  groups: readonly GroupSummary[];
  invites: readonly GroupInvite[];
  reorged: boolean;
  complete: boolean;
  safeHead: bigint;
  hasOlder: boolean;
  incomingCompleteGroupIds: readonly bigint[];
  latestIncoming: readonly Readonly<{
    groupId: bigint;
    anchor: GroupChatV2ReadCursorAnchor;
  }>[];
}>;

export type GroupChatV2DiscoveryRuntime = Readonly<{
  /** Progress replaces the previous projection and is incomplete until sync returns. */
  sync: (retryFailed?: boolean, onProgress?: (result: GroupChatV2DiscoveryResult) => void,
    shouldYield?: () => boolean, request?: Readonly<{ older?: boolean; groupIds?: readonly bigint[] }>) => Promise<GroupChatV2DiscoveryResult>;
  close: () => void;
}>;

const GROUP_DISCOVERY_YIELD = Symbol('Group discovery yielded to the selected read');
export const isGroupChatV2DiscoveryYield = (error: unknown): boolean => error === GROUP_DISCOVERY_YIELD;

const MAX_BLOCK_SPAN = 2_048n;
const MAX_HISTORICAL_PAGES_PER_SYNC = 4;
const GROUP_HINT_INTERFACE = new Interface(GROUP_CHAT_V2_ABI);
const GROUP_HINT_TOPICS: string[] = [];
GROUP_HINT_INTERFACE.forEachEvent(event => { GROUP_HINT_TOPICS.push(event.topicHash); });

/** Hints wake canonical discovery; no event payload enters the projection. */
export const subscribeGroupChatV2DiscoveryHints = async ({ subscribe, contractAddress, ownerAddress, groupIds,
  isCurrent, onHint, onStatus }: {
  subscribe: CotiEventHintSubscriber; contractAddress: string; ownerAddress: string; groupIds: readonly number[];
  isCurrent: () => boolean; onHint: () => void; onStatus: (status: CotiEventHintStatus) => void;
}): Promise<() => void> => {
  if (!isCurrent()) return () => {};
  const address = getAddress(contractAddress).toLowerCase(), owner = zeroPadValue(getAddress(ownerAddress), 32).toLowerCase();
  const groups = [...new Set(groupIds)].map(id => {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Group hint ID is outside the UI range.');
    return toBeHex(BigInt(id), 32);
  });
  const filters = [{ address, topics: [[...GROUP_CHAT_V2_WALLET_LIFECYCLE_TOPICS], null, owner] },
    ...(groups.length ? [{ address, topics: [GROUP_HINT_TOPICS, groups] }] : [])];
  let active = true;
  const states: CotiEventHintStatus[] = filters.map(() => 'reconnecting'), stops: (() => void)[] = [];
  const current = () => active && isCurrent();
  const close = () => { active = false; stops.splice(0).forEach(stop => stop()); };
  try {
    await Promise.all(filters.map(async (filter, index) => {
      const stop = await subscribe({ ...filter,
        onHint: () => { if (current()) onHint(); },
        onStatus: status => {
          if (!current()) return;
          states[index] = status;
          onStatus(states.every(state => state === 'connected') ? 'connected' : 'reconnecting');
        }
      });
      if (!current()) stop(); else stops.push(stop);
    }));
    return close;
  } catch (cause) { close(); throw cause; }
};

export const chatV2BackgroundPollDelay = (connected: boolean, activeChat: boolean, fallbackMs: number): number =>
  connected ? activeChat ? 60_000 : 120_000 : activeChat ? fallbackMs : 30_000;

type MetadataProjection = {
  boundaryBlockNumber: bigint | null;
  boundaryBlockHash: string;
  latestEvent: GroupChatV2MetadataEvent | null;
  decodedVersion: bigint;
  failedVersion: bigint | null;
  title: string | null;
  searchBeforeBlock: bigint | null;
  observedVersion: bigint;
};
type MessageProjection = {
  nextBlock: bigint;
  boundaryBlockNumber: bigint | null;
  boundaryBlockHash: string;
  lastMessageId: bigint;
  latestIncoming: GroupChatV2ReadCursorAnchor | null;
  searchBeforeBlock: bigint | null;
};
const safeNumber = (value: bigint, label: string): number => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`${label} is outside the UI integer range.`);
  }
  return result;
};

export const createGroupChatV2DiscoveryRuntime = ({
  confirmationDepth,
  isCurrent,
  onReadPhase,
  session
}: {
  confirmationDepth: bigint;
  isCurrent: () => boolean;
  onReadPhase?: GroupChatV2ReadObserver;
  session: GroupChatV2SessionController;
}): GroupChatV2DiscoveryRuntime => {
  assertGroupChatV2SessionController(session);
  if (confirmationDepth <= 0n || confirmationDepth > 4_096n) {
    throw new Error('Group Chat V2 discovery finality depth is invalid.');
  }
  let current = true;
  let syncTail: Promise<void> = Promise.resolve();
  let failure: Error | null = null;
  let stage = 'chain head';
  let nextBlock = session.manifest.deploymentBlock;
  let boundaryBlockNumber: bigint | null = null;
  let boundaryBlockHash = '';
  let recentFirstBlock: bigint | null = null;
  let recentNextBlock: bigint | null = null;
  let recentBoundaryBlockNumber: bigint | null = null;
  let recentBoundaryBlockHash = '';
  const knownGroupIds = new Set<bigint>();
  const metadataByGroup = new Map<bigint, MetadataProjection>();
  const messagesByGroup = new Map<bigint, MessageProjection>();
  const assertCurrent = (): void => {
    if (!current || !isCurrent()) throw new Error('Group Chat V2 discovery scope changed.');
  };
  const readWithPriority = <T>(phase: GroupChatV2ReadPhase, operation: () => Promise<T>,
    shouldYield?: () => boolean): Promise<T> => {
    assertCurrent();
    if (shouldYield?.()) throw GROUP_DISCOVERY_YIELD;
    return observeGroupChatV2Read(phase, onReadPhase, operation);
  };

  const scanLifecyclePage = async (fromBlock: bigint, toBlock: bigint,
    read: typeof readWithPriority): Promise<string> => {
    stage = 'owner lifecycle';
    const before = await read('fence', () => session.canonicalBlock(toBlock));
    const events = await read('lifecycle', () => session.lifecyclePage(fromBlock, toBlock));
    const blocks = new Map<bigint, string>();
    await Promise.all([...new Set(events.map((event) => event.blockNumber))].map(async (blockNumber) => {
      blocks.set(blockNumber, (await read('fence', () => session.canonicalBlock(blockNumber))).blockHash);
    }));
    for (const event of events) {
      if (blocks.get(event.blockNumber) !== event.blockHash) {
        throw new Error('Group Chat V2 discovery contains an orphaned lifecycle event.');
      }
    }
    const after = await read('fence', () => session.canonicalBlock(toBlock));
    assertCurrent();
    if (before.blockHash !== after.blockHash) {
      throw new Error('Group Chat V2 discovery boundary changed during synchronization.');
    }
    for (const event of events) knownGroupIds.add(event.groupId);
    return after.blockHash;
  };

  const bridgeRecentHistory = (): void => {
    if (recentFirstBlock !== null && recentNextBlock !== null &&
      nextBlock >= recentFirstBlock && nextBlock <= recentNextBlock) {
      nextBlock = recentNextBlock;
      boundaryBlockNumber = recentBoundaryBlockNumber;
      boundaryBlockHash = recentBoundaryBlockHash;
    }
  };

  const runSync = async (retryFailed: boolean, onProgress?: (result: GroupChatV2DiscoveryResult) => void,
    shouldYield?: () => boolean, request?: Readonly<{ older?: boolean; groupIds?: readonly bigint[] }>): Promise<GroupChatV2DiscoveryResult> => {
    const assertContinue = (): void => {
      assertCurrent();
      if (shouldYield?.()) throw GROUP_DISCOVERY_YIELD;
    };
    assertContinue();
    const read = <T>(phase: GroupChatV2ReadPhase, operation: () => Promise<T>) =>
      readWithPriority(phase, operation, shouldYield);
    stage = 'chain head';
    const latestBlock = await session.latestBlock(undefined, assertContinue);
    const safeHead = latestBlock > confirmationDepth ? latestBlock - confirmationDepth : 0n;
    let reorged = false;
    for (const [number, hash] of [
      [boundaryBlockNumber, boundaryBlockHash],
      [recentBoundaryBlockNumber, recentBoundaryBlockHash]
    ] as const) {
      if (number === null) continue;
      if (number > safeHead) {
        reorged = true;
      } else {
        const block = await read('fence', () => session.canonicalBlock(number));
        if (block.blockHash !== hash) reorged = true;
      }
    }
    if (reorged) {
      knownGroupIds.clear();
      metadataByGroup.clear();
      messagesByGroup.clear();
      nextBlock = session.manifest.deploymentBlock;
      boundaryBlockNumber = null;
      boundaryBlockHash = '';
      recentFirstBlock = null;
      recentNextBlock = null;
      recentBoundaryBlockNumber = null;
      recentBoundaryBlockHash = '';
      session.clearEpochKeys();
    }
    const hadKnownGroups = knownGroupIds.size > 0;
    for (const groupId of request?.groupIds ?? []) {
      if (groupId <= 0n || !Number.isSafeInteger(Number(groupId))) throw new Error('Group discovery hint ID is invalid.');
      knownGroupIds.add(groupId);
    }
    if (safeHead >= session.manifest.deploymentBlock) {
      // One public recent window per sync keeps new owner activity independent
      // of historical backfill. A long pause leaves any gap to that backfill.
      const windowStart = safeHead - GROUP_CHAT_V2_MAX_WALLET_LIFECYCLE_BLOCK_SPAN + 1n > session.manifest.deploymentBlock
        ? safeHead - GROUP_CHAT_V2_MAX_WALLET_LIFECYCLE_BLOCK_SPAN + 1n : session.manifest.deploymentBlock;
      const fromBlock = recentNextBlock !== null && recentNextBlock > windowStart
        ? recentNextBlock : windowStart;
      if (fromBlock <= safeHead) {
        const hash = await scanLifecyclePage(fromBlock, safeHead, read);
        if (recentNextBlock === null || recentNextBlock < fromBlock) recentFirstBlock = fromBlock;
        recentNextBlock = safeHead + 1n;
        recentBoundaryBlockNumber = safeHead;
        recentBoundaryBlockHash = hash;
      }
    }
    bridgeRecentHistory();
    const recentGroupsFirst = !hadKnownGroups && knownGroupIds.size > 0;
    // Historical discovery advances only after an explicit owner request.
    for (let page = 0; page < MAX_HISTORICAL_PAGES_PER_SYNC && request?.older && !recentGroupsFirst &&
      safeHead >= session.manifest.deploymentBlock && nextBlock <= safeHead; page += 1) {
      assertCurrent();
      const previousGroupCount = knownGroupIds.size;
      const toBlock = recentFirstBlock! - 1n;
      const windowStart = toBlock - GROUP_CHAT_V2_MAX_WALLET_LIFECYCLE_BLOCK_SPAN + 1n;
      const fromBlock = windowStart > nextBlock ? windowStart : nextBlock;
      const hash = await scanLifecyclePage(fromBlock, toBlock, read);
      boundaryBlockNumber = toBlock;
      boundaryBlockHash = hash;
      recentFirstBlock = fromBlock;
      bridgeRecentHistory();
      if (knownGroupIds.size > previousGroupCount) break;
    }

    const groups: GroupSummary[] = [];
    const invites: GroupInvite[] = [];
    const latestIncoming: Array<Readonly<{ groupId: bigint; anchor: GroupChatV2ReadCursorAnchor }>> = [];
    const incomingCompleteGroupIds: bigint[] = [];
    const snapshot = (complete: boolean): GroupChatV2DiscoveryResult => Object.freeze({
      groups: [...groups].sort((left, right) => right.lastTimestamp - left.lastTimestamp || left.id - right.id),
      invites: [...invites].sort((left, right) => left.groupId - right.groupId),
      latestIncoming: [...latestIncoming], incomingCompleteGroupIds: [...incomingCompleteGroupIds],
      reorged, complete, hasOlder: !complete, safeHead
    });
    const publish = (): void => { assertCurrent(); onProgress?.(snapshot(false)); };
    const contentHead = await read('fence', () => session.canonicalBlock(safeHead));
    assertCurrent();
    if (recentBoundaryBlockNumber === safeHead && recentBoundaryBlockHash !== contentHead.blockHash) {
      throw new Error('Group discovery safe head changed during synchronization.');
    }
    const assertCanonicalHead = async (): Promise<void> => {
      const after = await read('fence', () => session.canonicalBlock(safeHead));
      assertCurrent();
      if (after.blockHash !== contentHead.blockHash) {
        throw new Error('Group discovery safe head changed during synchronization.');
      }
    };
    stage = 'group state';
    const projections = [];
    for (const groupId of knownGroupIds) {
      const [group, member, invite] = await Promise.all([
        read('group-state', () => session.inspect(groupId)),
        read('group-state', () => session.inspectMember(groupId, session.ownerAddress)),
        read('group-state', () => session.inspectInvite(groupId, session.ownerAddress))
      ]);
      const pastMemberships = member.active ? [] : await read('group-state',
        () => session.membershipRanges(groupId, session.ownerAddress));
      await assertCanonicalHead();
      const numericGroupId = safeNumber(groupId, 'Discovered group ID');
      const membershipEnded = !member.active && pastMemberships.some(range => range.leftRevision > range.joinedRevision);
      if (member.active || membershipEnded) {
        groups.push({
          id: numericGroupId, admin: group.admin, title: `Group #${numericGroupId}`, isPrivate: true,
          ...(membershipEnded ? { membershipEnded: true } : {}),
          archived: group.archived, createdAt: safeNumber(group.createdAt, 'Group creation timestamp'),
          memberCount: safeNumber(group.memberCount, 'Group member count'), members: [], membersLoaded: false,
          lastBlock: membershipEnded ? 0 : safeNumber(group.lastMessageBlock, 'Group last message block'),
          lastTimestamp: safeNumber(membershipEnded
            ? pastMemberships.reduce((latest, range) => range.leftAt > latest ? range.leftAt : latest, 0n)
            : group.updatedAt, 'Group last update timestamp')
        });
      }
      if (!member.active) {
        metadataByGroup.delete(groupId);
        messagesByGroup.delete(groupId);
      }
      if (invite.pending && invite.effective && !member.active) {
        invites.push({ groupId: numericGroupId, inviter: invite.inviter,
          expiresAt: safeNumber(invite.expiresAt, 'Group invite expiry'), expired: false,
          title: `Group #${numericGroupId}`, admin: group.admin, isPrivate: true });
      }
      projections.push({ groupId, group, member });
      publish();
    }
    let metadataComplete = true;
    let messageDiscoveryComplete = true;
    for (const { groupId, group, member } of projections) {
      if (group.createdBlock > safeHead) {
        metadataComplete = false;
        continue;
      }
      const numericGroupId = safeNumber(groupId, 'Discovered group ID');
      if (member.active) {
        stage = 'finalized group state';
        await assertCanonicalHead();
        const [canonicalVersion, canonicalMessageCount] = await Promise.all([
          read('metadata', () => session.metadataVersionAtBlock(groupId, safeHead)),
          read('messages', () => session.messageCountAtBlock(groupId, safeHead))
        ]);
        stage = 'metadata history';
        const emptyMetadata = (): MetadataProjection => ({
          boundaryBlockNumber: null, boundaryBlockHash: '',
          latestEvent: null, decodedVersion: 0n, failedVersion: null, title: null, searchBeforeBlock: null, observedVersion: 0n
        });
        let metadata: MetadataProjection = { ...(metadataByGroup.get(groupId) ?? emptyMetadata()) };
        if (metadata.boundaryBlockNumber !== null) {
          const canonical = await read('fence', () => session.canonicalBlock(metadata.boundaryBlockNumber!));
          if (metadata.boundaryBlockNumber > safeHead || canonical.blockHash !== metadata.boundaryBlockHash) {
            reorged = true;
            metadata = emptyMetadata();
            session.clearEpochKeys();
          }
        }
        const olderMetadata = request?.older && metadata.searchBeforeBlock !== null && metadata.observedVersion === canonicalVersion;
        if (canonicalVersion !== (metadata.latestEvent?.metadataVersion ?? 0n) &&
          (metadata.boundaryBlockNumber === null || metadata.observedVersion !== canonicalVersion || olderMetadata)) {
          const toBlock = olderMetadata ? metadata.searchBeforeBlock! - 1n : safeHead;
          const windowStart = toBlock - MAX_BLOCK_SPAN + 1n;
          const fromBlock = windowStart > group.createdBlock ? windowStart : group.createdBlock;
          const baseline = fromBlock > group.createdBlock
            ? await read('metadata', () => session.metadataVersionAtBlock(groupId, fromBlock - 1n)) : 0n;
          const expectedEnd = toBlock === safeHead ? canonicalVersion
            : await read('metadata', () => session.metadataVersionAtBlock(groupId, toBlock));
          const before = await read('fence', () => session.canonicalBlock(toBlock));
          const events = await read('metadata', () => session.metadataPage(groupId, fromBlock, toBlock));
          const eventBlocks = new Map<bigint, string>();
          await Promise.all([...new Set(events.map((event) => event.blockNumber))].map(async (blockNumber) => {
            eventBlocks.set(blockNumber, (await read('fence', () => session.canonicalBlock(blockNumber))).blockHash);
          }));
          let version = baseline;
          for (const event of events) {
            if (event.groupId !== groupId || event.blockNumber < fromBlock || event.blockNumber > toBlock ||
              eventBlocks.get(event.blockNumber) !== event.blockHash || event.metadataVersion !== version + 1n) {
              throw new Error('Group metadata page is incomplete or contains an orphaned event.');
            }
            if (!metadata.latestEvent || event.metadataVersion > metadata.latestEvent.metadataVersion) metadata.latestEvent = event;
            version = event.metadataVersion;
          }
          if (version !== expectedEnd) throw new Error('Group metadata history is missing a finalized version.');
          const after = await read('fence', () => session.canonicalBlock(toBlock));
          if (before.blockHash !== after.blockHash) throw new Error('Group metadata boundary changed during synchronization.');
          metadata.searchBeforeBlock = canonicalVersion === (metadata.latestEvent?.metadataVersion ?? 0n) ? null : fromBlock;
          if (metadata.searchBeforeBlock === group.createdBlock) {
            throw new Error('Group metadata history is missing a finalized version.');
          }
        }
        metadata.boundaryBlockNumber = safeHead;
        metadata.boundaryBlockHash = contentHead.blockHash;
        metadata.observedVersion = canonicalVersion;
        if (canonicalVersion !== (metadata.latestEvent?.metadataVersion ?? 0n)) {
          metadataComplete = false;
          metadata.title = null;
        } else if (metadata.latestEvent && metadata.decodedVersion !== canonicalVersion &&
          (retryFailed || metadata.failedVersion !== canonicalVersion)) {
          try {
            metadata.title = (await read('metadata', () => session.readMetadata(metadata.latestEvent!))).title;
            metadata.decodedVersion = canonicalVersion;
            metadata.failedVersion = null;
          } catch (cause) {
            if (isGroupChatV2DiscoveryYield(cause)) throw cause;
            metadata.title = null;
            metadata.failedVersion = canonicalVersion;
          }
        }
        await assertCanonicalHead();
        const groupIndex = groups.findIndex(summary => summary.id === numericGroupId);
        groups[groupIndex] = { ...groups[groupIndex], title: metadata.title ?? `Group #${numericGroupId}` };
        publish();
        stage = 'message history';
        let firstMessageBlock = group.createdBlock;
        if (canonicalMessageCount > 0n) {
          if (group.firstMessageBlock < group.createdBlock || group.firstMessageBlock > group.lastMessageBlock) {
            throw new Error('Group message-block anchors are inconsistent.');
          }
          firstMessageBlock = group.firstMessageBlock;
        }
        const emptyMessages = (): MessageProjection => ({
          nextBlock: firstMessageBlock, boundaryBlockNumber: null, boundaryBlockHash: '',
          lastMessageId: 0n, latestIncoming: null, searchBeforeBlock: null
        });
        let messages: MessageProjection = { ...(messagesByGroup.get(groupId) ?? emptyMessages()) };
        if (messages.boundaryBlockNumber !== null) {
          const canonical = await read('fence', () => session.canonicalBlock(messages.boundaryBlockNumber!));
          if (messages.boundaryBlockNumber > safeHead || canonical.blockHash !== messages.boundaryBlockHash) {
            reorged = true;
            messages = emptyMessages();
          }
        }
        const olderMessages = request?.older && messages.searchBeforeBlock !== null && messages.lastMessageId === canonicalMessageCount;
        if (canonicalMessageCount !== messages.lastMessageId || olderMessages) {
          const recentEnd = group.lastMessageBlock < safeHead ? group.lastMessageBlock : safeHead;
          let toBlock = olderMessages ? messages.searchBeforeBlock! - 1n
            : messages.boundaryBlockNumber !== null && recentEnd - messages.nextBlock + 1n <= MAX_BLOCK_SPAN
              ? safeHead : recentEnd;
          if (!olderMessages && firstMessageBlock + MAX_BLOCK_SPAN - 1n >= recentEnd) {
            toBlock = firstMessageBlock + MAX_BLOCK_SPAN - 1n < safeHead
              ? firstMessageBlock + MAX_BLOCK_SPAN - 1n : safeHead;
          }
          const windowStart = toBlock - MAX_BLOCK_SPAN + 1n;
          let fromBlock = windowStart > firstMessageBlock ? windowStart : firstMessageBlock;
          if (!olderMessages && messages.boundaryBlockNumber !== null && messages.nextBlock > fromBlock) fromBlock = messages.nextBlock;
          const baseline = fromBlock > firstMessageBlock
            ? await read('messages', () => session.messageCountAtBlock(groupId, fromBlock - 1n)) : 0n;
          const expectedEnd = toBlock === safeHead || (!olderMessages && group.lastMessageBlock <= toBlock) ? canonicalMessageCount
            : await read('messages', () => session.messageCountAtBlock(groupId, toBlock));
          const before = await read('fence', () => session.canonicalBlock(toBlock));
          const events = await read('messages', () => session.historyPage(groupId, fromBlock, toBlock));
          const eventBlocks = new Map<bigint, string>();
          await Promise.all([...new Set(events.map((event) => event.blockNumber))].map(async (blockNumber) => {
            eventBlocks.set(blockNumber, (await read('fence', () => session.canonicalBlock(blockNumber))).blockHash);
          }));
          let lastMessageId = baseline;
          let incoming: GroupChatV2ReadCursorAnchor | null = null;
          for (const event of events) {
            if (event.groupId !== groupId || event.blockNumber < fromBlock || event.blockNumber > toBlock ||
              eventBlocks.get(event.blockNumber) !== event.blockHash || event.messageId !== lastMessageId + 1n) {
              throw new Error('Group message discovery is incomplete or contains an orphaned event.');
            }
            lastMessageId = event.messageId;
            if (event.sender.toLowerCase() !== session.ownerAddress.toLowerCase()) {
              incoming = Object.freeze({ messageId: event.messageId, blockNumber: event.blockNumber, blockHash: event.blockHash });
            }
          }
          if (lastMessageId !== expectedEnd || (!olderMessages && lastMessageId !== canonicalMessageCount)) {
            throw new Error('Group message discovery is missing a finalized message suffix.');
          }
          const after = await read('fence', () => session.canonicalBlock(toBlock));
          if (before.blockHash !== after.blockHash) throw new Error('Group message-discovery boundary changed during synchronization.');
          if (incoming && (!messages.latestIncoming || incoming.messageId > messages.latestIncoming.messageId)) messages.latestIncoming = incoming;
          if (incoming || baseline === 0n) messages.searchBeforeBlock = null;
          else if (olderMessages || baseline > messages.lastMessageId) messages.searchBeforeBlock = fromBlock;
          if (!olderMessages) messages.lastMessageId = lastMessageId;
          messages.nextBlock = safeHead + 1n;
        }
        messages.boundaryBlockNumber = safeHead;
        messages.boundaryBlockHash = contentHead.blockHash;
        if (messages.searchBeforeBlock !== null) messageDiscoveryComplete = false;
        else incomingCompleteGroupIds.push(groupId);
        if (messages.latestIncoming) latestIncoming.push({ groupId, anchor: messages.latestIncoming });
        stage = 'group members';
        const members = await read('members', () => session.members(groupId));
        stage = 'finalized group state';
        await assertCanonicalHead();
        // Commit sequence and cursor together, after every read and completeness check.
        metadataByGroup.set(groupId, metadata);
        messagesByGroup.set(groupId, messages);
        groups[groupIndex] = { ...groups[groupIndex], members: [...members], membersLoaded: true };
        publish();
      }
    }
    assertCurrent();
    return snapshot((safeHead < session.manifest.deploymentBlock || nextBlock > safeHead) &&
      metadataComplete && messageDiscoveryComplete);
  };

  return Object.freeze({
    sync: (retryFailed = false, onProgress, shouldYield, request) => {
      const run = async () => {
        assertCurrent();
        if (retryFailed) failure = null;
        if (failure) throw failure;
        try { return await runSync(retryFailed, onProgress, shouldYield, request); }
        catch (cause) {
          if (isGroupChatV2DiscoveryYield(cause)) throw cause;
          const queueFailure = cause instanceof Error ? describeCotiRpcQueueExpiry(cause) : null;
          failure = new Error(`Group discovery (${stage}): ${queueFailure ?? getProviderErrorMessage(cause, 'Read failed.')}`);
          throw failure;
        }
      };
      const pending = syncTail.then(run, run);
      syncTail = pending.then(() => undefined, () => undefined);
      return pending;
    },
    close: () => {
      if (!current) return;
      current = false;
      failure = null;
      knownGroupIds.clear();
      metadataByGroup.clear();
      messagesByGroup.clear();
    }
  });
};
