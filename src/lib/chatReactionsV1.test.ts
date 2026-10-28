import { AbiCoder, Interface, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import { DEFAULT_REACTION_EMOJIS } from './appShared/core';
import {
  bindChatReactionPendingTransaction,
  buildChatReactionPending,
  CHAT_REACTIONS_V1_ABI,
  CHAT_REACTIONS_V1_DIRECT_TARGET_FEATURES,
  CHAT_REACTIONS_V1_EMOJIS,
  CHAT_REACTIONS_V1_GROUP_TARGET_FEATURES,
  CHAT_REACTIONS_V1_REQUIRED_FEATURES,
  compareChatReactionsV1Provenance,
  createChatReactionSourceResolver,
  deriveDirectChatReactionAnchor,
  deriveGroupChatReactionAnchor,
  getChatReactionEmoji,
  getChatReactionEmojiId,
  parseChatReactionsV1Log,
  replaceChatReactionPendingTransaction,
  type ChatReactionObservation,
  type ChatReactionSource,
  type ChatReactionTarget,
  type ChatReactionsV1ManifestInput,
  type ChatReactionsV1ProvenanceEvidence,
  type ComparedChatReactionsV1Deployment
} from './chatReactionsV1';

const address = (pair: string) => `0x${pair.repeat(20)}`;
const hash = (pair: string) => `0x${pair.repeat(32)}`;

const REACTIONS = address('11');
const DIRECT = address('22');
const GROUP = address('33');
const ALICE = address('44');
const CHAIN_ID = '7082400';
const CONVERSATION_ID = hash('66');
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;

const features = (required: readonly string[]) =>
  Object.fromEntries(required.map((feature) => [feature, true]));

const MANIFEST: ChatReactionsV1ManifestInput = {
  chainId: CHAIN_ID,
  contractAddress: REACTIONS,
  deploymentBlock: '100',
  runtimeBytecodeHash: hash('a1'),
  directChatV2: {
    contractAddress: DIRECT,
    deploymentBlock: '10',
    runtimeBytecodeHash: hash('a2')
  },
  groupChatV2: {
    contractAddress: GROUP,
    deploymentBlock: '20',
    runtimeBytecodeHash: hash('a3')
  }
};

const EVIDENCE: ChatReactionsV1ProvenanceEvidence = {
  chainId: CHAIN_ID,
  reactions: {
    contractAddress: REACTIONS,
    deploymentBlock: '100',
    runtimeBytecodeHash: hash('a1'),
    contractVersion: 'ChatReactionsV1',
    protocolVersion: '1',
    emojiSetVersion: '1',
    emojiCount: '13',
    directMessageAnchorDomain: keccak256(
      toUtf8Bytes('chainwhisper.chat-reactions.v1.direct-message-anchor')
    ),
    groupMessageAnchorDomain: keccak256(
      toUtf8Bytes('chainwhisper.chat-reactions.v1.group-message-anchor')
    ),
    features: features(CHAT_REACTIONS_V1_REQUIRED_FEATURES),
    appWalletExecutor: false,
    pinnedDirectChatV2: MANIFEST.directChatV2,
    pinnedGroupChatV2: MANIFEST.groupChatV2
  },
  directChatV2: {
    ...MANIFEST.directChatV2,
    contractVersion: 'ChainWhisperChatV2',
    protocolVersion: '2',
    features: features(CHAT_REACTIONS_V1_DIRECT_TARGET_FEATURES),
    appWalletExecutor: false
  },
  groupChatV2: {
    ...MANIFEST.groupChatV2,
    contractVersion: 'ChainWhisperGroupChatV2',
    protocolVersion: '2',
    features: features(CHAT_REACTIONS_V1_GROUP_TARGET_FEATURES),
    appWalletExecutor: false
  }
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const compare = (): ComparedChatReactionsV1Deployment =>
  compareChatReactionsV1Provenance(clone(MANIFEST), clone(EVIDENCE));

const DIRECT_SOURCE: ChatReactionSource = {
  kind: 'direct',
  chainId: CHAIN_ID,
  contractAddress: DIRECT,
  conversationId: CONVERSATION_ID,
  messageId: '1',
  blockHash: hash('b1'),
  transactionHash: hash('c1'),
  logIndex: 3
};

const GROUP_SOURCE: ChatReactionSource = {
  kind: 'group',
  chainId: CHAIN_ID,
  contractAddress: GROUP,
  groupId: '9',
  messageId: '1',
  blockHash: hash('b2'),
  transactionHash: hash('c2'),
  logIndex: 4
};

const reactionInterface = new Interface(CHAT_REACTIONS_V1_ABI);

type LogOptions = {
  kind?: 'direct' | 'group';
  stableId?: string;
  messageId?: bigint;
  reactor?: string;
  emojiId?: number;
  active?: boolean;
  anchor?: string;
  blockHash?: string;
  blockNumber?: bigint;
  transactionHash?: string;
  transactionIndex?: number;
  logIndex?: number;
  removed?: boolean;
};

const reactionLog = (options: LogOptions = {}) => {
  const kind = options.kind ?? 'direct';
  const eventName = kind === 'direct' ? 'DirectReactionSet' : 'GroupReactionSet';
  const event = reactionInterface.getEvent(eventName);
  if (!event) throw new Error('Missing test event ABI.');
  const stableId = options.stableId ?? (kind === 'direct' ? CONVERSATION_ID : '9');
  const anchor = options.anchor ?? (kind === 'direct'
    ? deriveDirectChatReactionAnchor({
        chainId: DIRECT_SOURCE.chainId,
        contractAddress: DIRECT_SOURCE.contractAddress,
        conversationId: DIRECT_SOURCE.conversationId ?? '',
        messageId: DIRECT_SOURCE.messageId,
        blockHash: DIRECT_SOURCE.blockHash,
        transactionHash: DIRECT_SOURCE.transactionHash,
        logIndex: DIRECT_SOURCE.logIndex
      })
    : deriveGroupChatReactionAnchor({
        chainId: GROUP_SOURCE.chainId,
        contractAddress: GROUP_SOURCE.contractAddress,
        groupId: GROUP_SOURCE.groupId ?? '',
        messageId: GROUP_SOURCE.messageId,
        blockHash: GROUP_SOURCE.blockHash,
        transactionHash: GROUP_SOURCE.transactionHash,
        logIndex: GROUP_SOURCE.logIndex
      }));
  const encoded = reactionInterface.encodeEventLog(event, [
    stableId,
    options.messageId ?? 1n,
    options.reactor ?? ALICE,
    options.emojiId ?? 1,
    options.active ?? true,
    anchor
  ]);
  return {
    address: REACTIONS,
    topics: encoded.topics,
    data: encoded.data,
    blockHash: options.blockHash ?? hash('d1'),
    blockNumber: options.blockNumber ?? 120n,
    transactionHash: options.transactionHash ?? hash('e1'),
    transactionIndex: options.transactionIndex ?? 2,
    index: options.logIndex ?? 7,
    removed: options.removed ?? false
  };
};

const parse = (options: LogOptions = {}): ChatReactionObservation =>
  parseChatReactionsV1Log({
    deployment: compare(),
    observedChainId: CHAIN_ID,
    log: reactionLog(options)
  });

const targetFrom = (observation: ChatReactionObservation): ChatReactionTarget => ({
  kind: observation.kind,
  chainId: observation.chainId,
  reactionsContract: observation.reactionsContract,
  targetContract: observation.targetContract,
  conversationId: observation.conversationId,
  groupId: observation.groupId,
  messageId: observation.messageId
});

describe('ChatReactionsV1 inactive app foundation', () => {
  it('pins the exact existing 13-emoji presentation to IDs 1 through 13', () => {
    expect(CHAT_REACTIONS_V1_EMOJIS).toEqual(DEFAULT_REACTION_EMOJIS);
    expect(CHAT_REACTIONS_V1_EMOJIS.map((emoji, index) => [getChatReactionEmojiId(emoji), getChatReactionEmoji(index + 1)]))
      .toEqual(CHAT_REACTIONS_V1_EMOJIS.map((emoji, index) => [index + 1, emoji]));
    expect(() => getChatReactionEmoji(0)).toThrow();
    expect(() => getChatReactionEmoji(14)).toThrow();
    expect(() => getChatReactionEmojiId('🦄')).toThrow();
  });

  it('compares exact frozen provenance, immutable targets, versions, and feature surfaces without minting chain trust', () => {
    const deployment = compare();
    expect(JSON.parse(JSON.stringify(deployment))).toEqual({
      contractAddress: REACTIONS,
      deploymentBlock: '100',
      runtimeBytecodeHash: hash('a1'),
      chainId: CHAIN_ID,
      directChatV2: {
        contractAddress: DIRECT,
        deploymentBlock: '10',
        runtimeBytecodeHash: hash('a2')
      },
      groupChatV2: {
        contractAddress: GROUP,
        deploymentBlock: '20',
        runtimeBytecodeHash: hash('a3')
      }
    });

    const wrongPinnedTarget = clone(EVIDENCE);
    wrongPinnedTarget.reactions.pinnedDirectChatV2.runtimeBytecodeHash = hash('ff');
    expect(() => compareChatReactionsV1Provenance(MANIFEST, wrongPinnedTarget)).toThrow(/immutable chat targets/i);

    const missingFeature = clone(EVIDENCE);
    missingFeature.directChatV2.features = {
      ...missingFeature.directChatV2.features,
      REACTION_AUTHORIZATION: false
    };
    expect(() => compareChatReactionsV1Provenance(MANIFEST, missingFeature)).toThrow(/required feature/i);

    const appWallet = clone(EVIDENCE);
    appWallet.groupChatV2.appWalletExecutor = true;
    expect(() => compareChatReactionsV1Provenance(MANIFEST, appWallet)).toThrow(/app-wallet/i);
  });

  it('derives Direct and Group anchors with the exact Solidity abi.encode domains and types', () => {
    const coder = AbiCoder.defaultAbiCoder();
    const expectedDirect = keccak256(coder.encode(
      ['bytes32', 'uint16', 'uint256', 'address', 'bytes32', 'uint64', 'bytes32', 'bytes32', 'uint256'],
      [keccak256(toUtf8Bytes('chainwhisper.chat-reactions.v1.direct-message-anchor')), 1,
        CHAIN_ID, DIRECT, CONVERSATION_ID, 1, hash('b1'), hash('c1'), 3]
    ));
    const expectedGroup = keccak256(coder.encode(
      ['bytes32', 'uint16', 'uint256', 'address', 'uint256', 'uint64', 'bytes32', 'bytes32', 'uint256'],
      [keccak256(toUtf8Bytes('chainwhisper.chat-reactions.v1.group-message-anchor')), 1,
        CHAIN_ID, GROUP, 9, 1, hash('b2'), hash('c2'), 4]
    ));
    expect(deriveDirectChatReactionAnchor({
      chainId: CHAIN_ID,
      contractAddress: DIRECT,
      conversationId: CONVERSATION_ID,
      messageId: '1',
      blockHash: hash('b1'),
      transactionHash: hash('c1'),
      logIndex: 3
    })).toBe(expectedDirect);
    expect(deriveGroupChatReactionAnchor({
      chainId: CHAIN_ID,
      contractAddress: GROUP,
      groupId: '9',
      messageId: '1',
      blockHash: hash('b2'),
      transactionHash: hash('c2'),
      logIndex: 4
    })).toBe(expectedGroup);
  });

  it('strictly parses JSON-safe Direct observations with block-aware raw identity', () => {
    const observation = parse();
    expect(observation).toMatchObject({
      kind: 'direct',
      chainId: CHAIN_ID,
      reactionsContract: REACTIONS,
      targetContract: DIRECT,
      conversationId: CONVERSATION_ID,
      messageId: '1',
      reactor: ALICE,
      emojiId: 1,
      emoji: '👍',
      active: true,
      blockNumber: '120',
      transactionIndex: 2,
      logIndex: 7,
      removed: false
    });
    expect(observation.rawIdentity).toContain(`${hash('d1')}:${hash('e1')}:7`);
    expect(() => JSON.stringify(observation)).not.toThrow();
    expect(JSON.stringify(observation)).not.toContain('n"');
  });

  it('strictly parses Group stable IDs and selects only the pinned Group target', () => {
    expect(parse({ kind: 'group', emojiId: 13 })).toMatchObject({
      kind: 'group',
      targetContract: GROUP,
      groupId: '9',
      messageId: '1',
      emojiId: 13,
      emoji: '💯'
    });
  });

  it('rejects wrong chain, address, topic, ABI length, IDs, anchors, chain identities, and metadata', () => {
    const deployment = compare();
    expect(() => parseChatReactionsV1Log({
      deployment,
      observedChainId: '1',
      log: reactionLog()
    })).toThrow(/chain/i);

    const cases: Array<() => unknown> = [
      () => ({ ...reactionLog(), address: address('99') }),
      () => {
        const log = reactionLog();
        return { ...log, topics: [hash('99'), ...log.topics.slice(1)] };
      },
      () => {
        const log = reactionLog();
        return { ...log, data: `${log.data}00` };
      },
      () => reactionLog({ messageId: 0n }),
      () => reactionLog({ kind: 'group', stableId: '0' }),
      () => reactionLog({ anchor: ZERO_BYTES32 }),
      () => ({ ...reactionLog(), blockHash: ZERO_BYTES32 }),
      () => ({ ...reactionLog(), transactionHash: ZERO_BYTES32 }),
      () => ({ ...reactionLog(), index: -1 }),
      () => ({ ...reactionLog(), transactionIndex: Number.MAX_SAFE_INTEGER + 1 }),
      () => {
        const log = reactionLog() as Record<string, unknown>;
        delete log.removed;
        return log;
      },
      () => reactionLog({ blockNumber: 99n }),
      () => reactionLog({ emojiId: 14 })
    ];
    for (const makeLog of cases) {
      expect(() => parseChatReactionsV1Log({
        deployment,
        observedChainId: CHAIN_ID,
        log: makeLog()
      })).toThrow();
    }
  });

  it('rejects noncanonical ABI words, coercive indices, and conflicting index aliases', () => {
    const deployment = compare();
    const canonical = reactionLog();
    const dataWords = canonical.data.slice(2).match(/.{64}/g);
    if (!dataWords || dataWords.length !== 3) throw new Error('Unexpected reaction test encoding.');
    const malformedLogs = [
      { ...canonical, data: `0x${`${'00'.repeat(30)}0101`}${dataWords[1]}${dataWords[2]}` },
      { ...canonical, data: `0x${dataWords[0]}${`${'00'.repeat(31)}02`}${dataWords[2]}` },
      { ...canonical, index: false },
      { ...canonical, index: '' },
      { ...canonical, index: '0x7' },
      { ...canonical, index: 7, logIndex: 8 }
    ];
    for (const log of malformedLogs) {
      expect(() => parseChatReactionsV1Log({
        deployment,
        observedChainId: CHAIN_ID,
        log
      })).toThrow();
    }
    expect(parseChatReactionsV1Log({
      deployment,
      observedChainId: CHAIN_ID,
      log: { ...canonical, index: 7, logIndex: 7 }
    }).logIndex).toBe(7);
  });

  it('rejects duplicate canonical source identities instead of guessing across a reorg', () => {
    expect(() => createChatReactionSourceResolver([
      DIRECT_SOURCE,
      { ...DIRECT_SOURCE, blockHash: hash('ff') }
    ])).toThrow(/duplicate stable message ID/i);
  });

  it('creates a pre-broadcast pending identity and preserves the original tx on replacement', () => {
    const event = parse();
    const draft = buildChatReactionPending({
      target: targetFrom(event),
      reactor: ALICE,
      emojiId: 1,
      active: true,
      messageAnchor: event.messageAnchor,
      operationId: 'tab-a:operation-1'
    });
    expect(draft).toMatchObject({
      stage: 'draft',
      originalTransactionHash: null,
      effectiveTransactionHash: null
    });
    expect(draft.identity).toContain(event.messageAnchor);
    expect(() => bindChatReactionPendingTransaction(clone(draft), hash('e1')))
      .toThrow(/verified draft/i);

    const submitted = bindChatReactionPendingTransaction(draft, hash('e1'));
    const replaced = replaceChatReactionPendingTransaction(submitted, hash('e2'));
    expect(replaced.originalTransactionHash).toBe(hash('e1'));
    expect(replaced.effectiveTransactionHash).toBe(hash('e2'));
    expect(replaced.identity).not.toBe(submitted.identity);
  });
});
