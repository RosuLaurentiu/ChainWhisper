import type { GroupInvite, GroupSummary } from './appShared/core';
import type { GroupChatV2MetadataEvent } from './groupChatV2Chain';
import type { GroupChatV2ReadCursorAnchor } from './groupChatV2ReadCursor';
import {
  assertGroupChatV2SessionController,
  type GroupChatV2SessionController
} from './groupChatV2Session';

export type GroupChatV2DiscoveryResult = Readonly<{
  groups: readonly GroupSummary[];
  invites: readonly GroupInvite[];
  reorged: boolean;
  complete: boolean;
  safeHead: bigint;
  latestIncoming: readonly Readonly<{
    groupId: bigint;
    anchor: GroupChatV2ReadCursorAnchor;
  }>[];
}>;

export type GroupChatV2DiscoveryRuntime = Readonly<{
  sync: () => Promise<GroupChatV2DiscoveryResult>;
  close: () => void;
}>;

const MAX_BLOCK_SPAN = 2_048n;
type MetadataProjection = {
  nextBlock: bigint;
  boundaryBlockNumber: bigint | null;
  boundaryBlockHash: string;
  latestEvent: GroupChatV2MetadataEvent | null;
  decodedVersion: bigint;
  title: string | null;
};
type MessageProjection = {
  nextBlock: bigint;
  boundaryBlockNumber: bigint | null;
  boundaryBlockHash: string;
  lastMessageId: bigint;
  latestIncoming: GroupChatV2ReadCursorAnchor | null;
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
  session
}: {
  confirmationDepth: bigint;
  isCurrent: () => boolean;
  session: GroupChatV2SessionController;
}): GroupChatV2DiscoveryRuntime => {
  assertGroupChatV2SessionController(session);
  if (confirmationDepth <= 0n || confirmationDepth > 4_096n) {
    throw new Error('Group Chat V2 discovery finality depth is invalid.');
  }
  let current = true;
  let syncTail: Promise<void> = Promise.resolve();
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

  const scanLifecyclePage = async (fromBlock: bigint, toBlock: bigint): Promise<string> => {
    const before = await session.canonicalBlock(toBlock);
    const events = await session.lifecyclePage(fromBlock, toBlock);
    const blocks = new Map<bigint, string>();
    await Promise.all([...new Set(events.map((event) => event.blockNumber))].map(async (blockNumber) => {
      blocks.set(blockNumber, (await session.canonicalBlock(blockNumber)).blockHash);
    }));
    for (const event of events) {
      if (blocks.get(event.blockNumber) !== event.blockHash) {
        throw new Error('Group Chat V2 discovery contains an orphaned lifecycle event.');
      }
    }
    const after = await session.canonicalBlock(toBlock);
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

  const runSync = async (): Promise<GroupChatV2DiscoveryResult> => {
    assertCurrent();
    const latestBlock = await session.latestBlock();
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
        const block = await session.canonicalBlock(number);
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
    if (safeHead >= session.manifest.deploymentBlock) {
      // One public recent window per sync keeps new owner activity independent
      // of historical backfill. A long pause leaves any gap to that backfill.
      const windowStart = safeHead - MAX_BLOCK_SPAN + 1n > session.manifest.deploymentBlock
        ? safeHead - MAX_BLOCK_SPAN + 1n : session.manifest.deploymentBlock;
      const fromBlock = recentNextBlock !== null && recentNextBlock > windowStart
        ? recentNextBlock : windowStart;
      if (fromBlock <= safeHead) {
        const hash = await scanLifecyclePage(fromBlock, safeHead);
        if (recentNextBlock === null || recentNextBlock < fromBlock) recentFirstBlock = fromBlock;
        recentNextBlock = safeHead + 1n;
        recentBoundaryBlockNumber = safeHead;
        recentBoundaryBlockHash = hash;
      }
    }
    bridgeRecentHistory();
    if (safeHead >= session.manifest.deploymentBlock && nextBlock <= safeHead) {
      let toBlock = nextBlock + MAX_BLOCK_SPAN - 1n < safeHead
        ? nextBlock + MAX_BLOCK_SPAN - 1n
        : safeHead;
      if (recentFirstBlock !== null && nextBlock < recentFirstBlock && toBlock >= recentFirstBlock) {
        toBlock = recentFirstBlock - 1n;
      }
      const hash = await scanLifecyclePage(nextBlock, toBlock);
      boundaryBlockNumber = toBlock;
      boundaryBlockHash = hash;
      nextBlock = toBlock + 1n;
      bridgeRecentHistory();
    }

    const projections = await Promise.all([...knownGroupIds].map(async (groupId) => {
      const [group, member, invite] = await Promise.all([
        session.inspect(groupId),
        session.inspectMember(groupId, session.ownerAddress),
        session.inspectInvite(groupId, session.ownerAddress)
      ]);
      return { groupId, group, member, invite };
    }));
    const groups: GroupSummary[] = [];
    const invites: GroupInvite[] = [];
    const latestIncoming: Array<Readonly<{ groupId: bigint; anchor: GroupChatV2ReadCursorAnchor }>> = [];
    let metadataComplete = true;
    let messageDiscoveryComplete = true;
    for (const { groupId, group, member, invite } of projections) {
      const numericGroupId = safeNumber(groupId, 'Discovered group ID');
      if (member.active) {
        let metadata = metadataByGroup.get(groupId);
        if (!metadata) {
          metadata = {
            nextBlock: group.createdBlock,
            boundaryBlockNumber: null,
            boundaryBlockHash: '',
            latestEvent: null,
            decodedVersion: 0n,
            title: null
          };
          metadataByGroup.set(groupId, metadata);
        }
        if (metadata.boundaryBlockNumber !== null) {
          const canonical = await session.canonicalBlock(metadata.boundaryBlockNumber);
          if (canonical.blockHash !== metadata.boundaryBlockHash) {
            reorged = true;
            metadata = {
              nextBlock: group.createdBlock,
              boundaryBlockNumber: null,
              boundaryBlockHash: '',
              latestEvent: null,
              decodedVersion: 0n,
              title: null
            };
            metadataByGroup.set(groupId, metadata);
            session.clearEpochKeys();
          }
        }
        if (metadata.nextBlock <= safeHead) {
          const toBlock = metadata.nextBlock + MAX_BLOCK_SPAN - 1n < safeHead
            ? metadata.nextBlock + MAX_BLOCK_SPAN - 1n
            : safeHead;
          const before = await session.canonicalBlock(toBlock);
          const events = await session.metadataPage(groupId, metadata.nextBlock, toBlock);
          const eventBlocks = new Map<bigint, string>();
          await Promise.all([...new Set(events.map((event) => event.blockNumber))].map(async (blockNumber) => {
            eventBlocks.set(blockNumber, (await session.canonicalBlock(blockNumber)).blockHash);
          }));
          let expectedVersion = (metadata.latestEvent?.metadataVersion ?? 0n) + 1n;
          for (const event of events) {
            if (
              event.groupId !== groupId ||
              eventBlocks.get(event.blockNumber) !== event.blockHash ||
              event.metadataVersion !== expectedVersion
            ) {
              throw new Error('Group metadata page is incomplete or contains an orphaned event.');
            }
            metadata.latestEvent = event;
            expectedVersion += 1n;
          }
          const after = await session.canonicalBlock(toBlock);
          assertCurrent();
          if (before.blockHash !== after.blockHash) {
            throw new Error('Group metadata boundary changed during synchronization.');
          }
          metadata.boundaryBlockNumber = toBlock;
          metadata.boundaryBlockHash = after.blockHash;
          metadata.nextBlock = toBlock + 1n;
        }
        if (metadata.nextBlock <= safeHead) {
          metadataComplete = false;
        } else {
          const canonicalVersion = await session.metadataVersionAtBlock(groupId, safeHead);
          const observedVersion = metadata.latestEvent?.metadataVersion ?? 0n;
          if (canonicalVersion !== observedVersion) {
            throw new Error('Group metadata history is missing a finalized version.');
          }
          if (metadata.latestEvent && metadata.decodedVersion !== observedVersion) {
            metadata.decodedVersion = observedVersion;
            try {
              metadata.title = (await session.readMetadata(metadata.latestEvent)).title;
            } catch {
              metadata.title = null;
            }
          }
        }
        let messages = messagesByGroup.get(groupId);
        if (!messages) {
          messages = {
            nextBlock: group.createdBlock,
            boundaryBlockNumber: null,
            boundaryBlockHash: '',
            lastMessageId: 0n,
            latestIncoming: null
          };
          messagesByGroup.set(groupId, messages);
        }
        if (messages.boundaryBlockNumber !== null) {
          const canonical = await session.canonicalBlock(messages.boundaryBlockNumber);
          if (canonical.blockHash !== messages.boundaryBlockHash) {
            reorged = true;
            messages = {
              nextBlock: group.createdBlock,
              boundaryBlockNumber: null,
              boundaryBlockHash: '',
              lastMessageId: 0n,
              latestIncoming: null
            };
            messagesByGroup.set(groupId, messages);
          }
        }
        if (messages.nextBlock <= safeHead) {
          const toBlock = messages.nextBlock + MAX_BLOCK_SPAN - 1n < safeHead
            ? messages.nextBlock + MAX_BLOCK_SPAN - 1n
            : safeHead;
          const before = await session.canonicalBlock(toBlock);
          const events = await session.historyPage(groupId, messages.nextBlock, toBlock);
          const eventBlocks = new Map<bigint, string>();
          await Promise.all([...new Set(events.map((event) => event.blockNumber))].map(async (blockNumber) => {
            eventBlocks.set(blockNumber, (await session.canonicalBlock(blockNumber)).blockHash);
          }));
          for (const event of events) {
            if (
              event.groupId !== groupId ||
              eventBlocks.get(event.blockNumber) !== event.blockHash ||
              event.messageId !== messages.lastMessageId + 1n
            ) {
              throw new Error('Group message discovery is incomplete or contains an orphaned event.');
            }
            messages.lastMessageId = event.messageId;
            if (event.sender.toLowerCase() !== session.ownerAddress.toLowerCase()) {
              messages.latestIncoming = Object.freeze({
                messageId: event.messageId,
                blockNumber: event.blockNumber,
                blockHash: event.blockHash
              });
            }
          }
          const after = await session.canonicalBlock(toBlock);
          assertCurrent();
          if (before.blockHash !== after.blockHash) {
            throw new Error('Group message-discovery boundary changed during synchronization.');
          }
          messages.boundaryBlockNumber = toBlock;
          messages.boundaryBlockHash = after.blockHash;
          messages.nextBlock = toBlock + 1n;
        }
        if (messages.nextBlock <= safeHead) {
          messageDiscoveryComplete = false;
        } else if (await session.messageCountAtBlock(groupId, safeHead) !== messages.lastMessageId) {
          throw new Error('Group message discovery is missing a finalized message suffix.');
        }
        if (messages.latestIncoming) latestIncoming.push({ groupId, anchor: messages.latestIncoming });
        const members = await session.members(groupId);
        groups.push({
          id: numericGroupId,
          admin: group.admin,
          title: metadata.title ?? `Group #${numericGroupId}`,
          isPrivate: true,
          archived: group.archived,
          createdAt: safeNumber(group.createdAt, 'Group creation timestamp'),
          memberCount: safeNumber(group.memberCount, 'Group member count'),
          members: [...members],
          lastBlock: safeNumber(group.lastMessageBlock, 'Group last message block'),
          lastTimestamp: safeNumber(group.updatedAt, 'Group last update timestamp')
        });
      }
      if (invite.pending && invite.effective && !member.active) {
        invites.push({
          groupId: numericGroupId,
          inviter: invite.inviter,
          expiresAt: safeNumber(invite.expiresAt, 'Group invite expiry'),
          expired: false,
          title: `Group #${numericGroupId}`,
          admin: group.admin,
          isPrivate: true
        });
      }
    }
    groups.sort((left, right) => right.lastTimestamp - left.lastTimestamp || left.id - right.id);
    invites.sort((left, right) => left.groupId - right.groupId);
    return Object.freeze({
      groups,
      invites,
      reorged,
      complete: (safeHead < session.manifest.deploymentBlock || nextBlock > safeHead) &&
        metadataComplete && messageDiscoveryComplete,
      safeHead,
      latestIncoming
    });
  };

  return Object.freeze({
    sync: () => {
      const pending = syncTail.then(runSync, runSync);
      syncTail = pending.then(() => undefined, () => undefined);
      return pending;
    },
    close: () => {
      if (!current) return;
      current = false;
      knownGroupIds.clear();
      metadataByGroup.clear();
      messagesByGroup.clear();
    }
  });
};
