import { keccak256, toHex, type Hex } from 'viem';
import {
  parsePrivateLiquidityV2ApiManifest,
  type TestnetCandidateComponentKey,
  type TestnetCandidateManifestComponent
} from './privateLiquidityV2';
import type { ContractReader } from './rpc';
import type {
  PublicTestnetRegistryV2,
  TestnetRegistryComponentSurface,
  TestnetRegistryEventPolicy,
  TestnetRegistryV2ApiSource
} from './types';

const CHAIN_ID = 7_082_400n;
const ZERO_HASH = `0x${'00'.repeat(32)}`;
const HASH = /^0x[0-9a-fA-F]{64}$/u;

type ComponentPolicy = {
  surface: TestnetRegistryComponentSurface;
  events: TestnetRegistryEventPolicy;
};

const events = (
  publicIndexable: readonly string[],
  encryptedContentNotReturned: readonly string[],
  participantEncryptedNotReturned: readonly string[],
  catalogOnlyNotReturned: readonly string[],
  incomingDirectTradeNotification: readonly string[] = []
): TestnetRegistryEventPolicy => ({
  publicIndexable,
  encryptedContentNotReturned,
  participantEncryptedNotReturned,
  catalogOnlyNotReturned,
  incomingDirectTradeNotification
});

export const TESTNET_COMPONENT_EVENT_POLICIES = {
  directChatV2: {
    surface: 'direct-chat',
    events: events(
      ['NicknameSet', 'ConversationCreated', 'ConversationKeyRotated', 'ConversationEnvelopeRefreshed'],
      ['MessagePosted'],
      [],
      [
        'OwnershipTransferStarted', 'OwnershipTransferred', 'FeeRecipientSet', 'MessageFeeSet',
        'Paused', 'Unpaused', 'NativeCreditWithdrawn'
      ]
    )
  },
  groupChatV2: {
    surface: 'group-chat',
    events: events(
      [
        'GroupCreated', 'GroupAdminChanged', 'GroupArchived', 'GroupMembershipRevisionAdvanced',
        'GroupMemberAdded', 'GroupMemberRemoved', 'GroupMemberLeft', 'GroupEpochCreated',
        'GroupEpochEnvelopeSynchronized', 'GroupInviteCreated', 'GroupInviteAccepted',
        'GroupInviteDeclined', 'GroupInviteRevoked', 'GroupJoinCodeCreated',
        'GroupJoinCodeRevoked', 'GroupJoinedWithCode'
      ],
      ['EncryptedGroupMetadataUpdated', 'GroupMessagePosted'],
      [],
      [
        'OwnershipTransferStarted', 'OwnershipTransferred', 'FeeRecipientSet', 'MessageFeeSet',
        'Paused', 'Unpaused', 'NativeCreditWithdrawn'
      ]
    )
  },
  chatReactionsV1: {
    surface: 'chat-reactions',
    events: events(['DirectReactionSet', 'GroupReactionSet'], [], [], [])
  },
  directOtcV2: {
    surface: 'direct-otc',
    events: events(
      ['DirectTradeOpened', 'DirectTradeStatusChanged', 'DirectTradeReplaced'],
      [],
      [],
      [
        'OwnershipTransferred', 'PublicTokenApprovalSet', 'PrivateTokenApprovalSet',
        'NativeCreditRecorded', 'NativeCreditWithdrawn'
      ],
      ['DirectTradeOpened']
    )
  },
  standardOtcV2: {
    surface: 'standard-otc',
    events: events(
      ['StandardTradeOpened', 'StandardTradeFilled', 'StandardTradeStatusChanged', 'StandardTradeReplaced'],
      [],
      [],
      ['OwnershipTransferred', 'TokenApprovalSet', 'NativeCreditRecorded', 'NativeCreditWithdrawn']
    )
  },
  privateOtcV2: {
    surface: 'private-otc',
    events: events(
      ['PrivateOrderOpened', 'PrivateOrderFilled', 'PrivateOrderStatusChanged', 'PrivateOrderReplaced'],
      [],
      ['PrivateOrderAccountSnapshotUpdated'],
      [
        'OwnershipTransferred', 'PublicTokenApprovalSet', 'PrivateTokenApprovalSet',
        'NativeCreditRecorded', 'NativeCreditWithdrawn'
      ]
    )
  },
  recurringOtcV2: {
    surface: 'recurring-otc',
    events: events(
      [
        'RecurringOrderOpened', 'RecurringOrderEdited', 'RecurringOrderExecuted',
        'RecurringOrderStatusChanged', 'RecurringInventorySettled'
      ],
      [],
      [],
      ['OwnershipTransferred', 'TokenApprovalSet', 'NativeCreditRecorded', 'NativeCreditWithdrawn']
    )
  },
  'private-recurringOtcV2': {
    surface: 'private-recurring-otc',
    events: events(
      [
        'PrivateRecurringOrderOpened', 'PrivateRecurringOrderEdited',
        'PrivateRecurringOrderExecuted', 'PrivateRecurringOrderStatusChanged',
        'PrivateRecurringInventorySettled'
      ],
      [],
      ['PrivateRecurringExecutionReceiptUpdated', 'PrivateRecurringMakerInventorySnapshotUpdated'],
      ['OwnershipTransferred', 'PrivateTokenApprovalSet']
    )
  },
  privateLiquidityBookV2: {
    surface: 'private-liquidity-book',
    events: events(
      [
        'PrivateLiquidityPositionCreated', 'PrivateLiquidityPositionTermsUpdated',
        'PrivateLiquidityPositionLiquidityChanged', 'PrivateLiquidityPositionStatusChanged',
        'PrivateLiquidityPositionTransferActivationRequired',
        'PrivateLiquidityPositionPrivacyActivated', 'PrivateLiquiditySwapExecuted',
        'PrivateLiquidityPositionClosed'
      ],
      [],
      [
        'PrivateLiquidityOwnerInventorySnapshotUpdated',
        'PrivateLiquidityPositionExecutionReceiptUpdated',
        'PrivateLiquidityTraderSwapReceiptUpdated'
      ],
      ['OwnershipTransferred', 'NewActivityPauseSet', 'PrivateTokenApprovalSet']
    )
  },
  privateLiquidityHiddenIntentV2: {
    surface: 'private-liquidity-hidden-intents',
    events: events(
      [],
      [],
      [
        'PrivateLiquidityHiddenIntentOwnerReceiptUpdated',
        'PrivateLiquidityHiddenIntentPositionReceiptUpdated',
        'PrivateLiquidityOwnerInventorySnapshotUpdated'
      ],
      [
        'OwnershipTransferred', 'PrivateLiquidityHiddenIntentOpened',
        'PrivateLiquidityHiddenIntentExecuted', 'PrivateLiquidityHiddenIntentCancelled',
        'PrivateLiquidityHiddenIntentExpired', 'PrivateLiquidityHiddenIntentSettlementProcessed'
      ]
    )
  },
  privateLiquidityPositionNftV2: {
    surface: 'private-liquidity-position-nft',
    events: events(['Approval', 'ApprovalForAll', 'Transfer'], [], [], [])
  },
  publicTestTokenA: {
    surface: 'public-test-token',
    events: events(
      ['Approval', 'FaucetClaimed', 'Transfer'],
      [],
      [],
      ['OwnershipTransferred', 'OwnershipTransferStarted']
    )
  },
  publicTestTokenB: {
    surface: 'public-test-token',
    events: events(
      ['Approval', 'FaucetClaimed', 'Transfer'],
      [],
      [],
      ['OwnershipTransferred', 'OwnershipTransferStarted']
    )
  },
  privateTestTokenA: {
    surface: 'private-test-token',
    events: events(
      ['FaucetClaimed'],
      ['Approval', 'Transfer'],
      [],
      [
        'AccountEncryptionAddressSet', 'AllowanceReencrypted', 'OwnershipTransferred',
        'OwnershipTransferStarted', 'PublicAmountsEnabledSet', 'RoleAdminChanged',
        'RoleGranted', 'RoleRevoked'
      ]
    )
  },
  privateTestTokenB: {
    surface: 'private-test-token',
    events: events(
      ['FaucetClaimed'],
      ['Approval', 'Transfer'],
      [],
      [
        'AccountEncryptionAddressSet', 'AllowanceReencrypted', 'OwnershipTransferred',
        'OwnershipTransferStarted', 'PublicAmountsEnabledSet', 'RoleAdminChanged',
        'RoleGranted', 'RoleRevoked'
      ]
    )
  }
} as const satisfies Record<TestnetCandidateComponentKey, ComponentPolicy>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const uint = (value: unknown): bigint => {
  try {
    const parsed = BigInt(value as string | number | bigint);
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch {
    throw new Error('invalid registry uint');
  }
};

const hash = (value: unknown): Hex => {
  if (typeof value !== 'string' || !HASH.test(value) || value.toLowerCase() === ZERO_HASH) {
    throw new Error('invalid registry hash');
  }
  return value.toLowerCase() as Hex;
};

const blockReference = (blockHash: Hex) => ({ blockHash, requireCanonical: true });

const blockAt = async (rpc: ContractReader, number: bigint) => {
  const raw = await rpc.request<unknown>('eth_getBlockByNumber', [toHex(number), false]);
  if (!isRecord(raw)) throw new Error('registry block unavailable');
  return {
    number: uint(raw.number),
    hash: hash(raw.hash),
    timestamp: uint(raw.timestamp)
  };
};

const verifyCode = async (
  rpc: ContractReader,
  item: TestnetCandidateManifestComponent,
  blockHash: Hex
): Promise<void> => {
  const code = await rpc.request<Hex>('eth_getCode', [item.address, blockReference(blockHash)]);
  if (code === '0x' || keccak256(code).toLowerCase() !== item.runtimeBytecodeHash.toLowerCase()) {
    throw new Error('registry runtime mismatch');
  }
};

const assertPolicyPartition = (): void => {
  for (const [componentKey, { events: policy }] of Object.entries(TESTNET_COMPONENT_EVENT_POLICIES)) {
    const buckets = [
      policy.publicIndexable,
      policy.encryptedContentNotReturned,
      policy.participantEncryptedNotReturned,
      policy.catalogOnlyNotReturned
    ];
    const flattened = buckets.flat();
    if (new Set(flattened).size !== flattened.length) {
      throw new Error(`duplicate event classification for ${componentKey}`);
    }
    if (policy.incomingDirectTradeNotification.some((name) => !policy.publicIndexable.includes(name))) {
      throw new Error(`notification event is not public-indexable for ${componentKey}`);
    }
  }
};

assertPolicyPartition();

export class ManifestTestnetRegistryV2ApiSource implements TestnetRegistryV2ApiSource {
  readonly #manifest;
  readonly #rpc: ContractReader;
  readonly #finalityLag: bigint;

  constructor(input: { manifestJson: string; rpc: ContractReader; finalityLagBlocks?: bigint }) {
    this.#manifest = parsePrivateLiquidityV2ApiManifest(input.manifestJson);
    this.#rpc = input.rpc;
    this.#finalityLag = input.finalityLagBlocks ?? 5n;
    if (this.#finalityLag < 1n || this.#finalityLag > 4_096n) {
      throw new Error('invalid registry finality lag');
    }
  }

  async getRegistry(): Promise<PublicTestnetRegistryV2> {
    if (BigInt(await this.#rpc.request<Hex>('eth_chainId', [])) !== CHAIN_ID) {
      throw new Error('wrong registry chain');
    }
    const components = Object.values(this.#manifest.components)
      .sort((left, right) => left.key.localeCompare(right.key));
    const attested = await blockAt(this.#rpc, this.#manifest.attestationBlock.number);
    if (attested.hash !== this.#manifest.attestationBlock.hash) {
      throw new Error('orphaned registry attestation');
    }
    await Promise.all(components.map((item) => verifyCode(this.#rpc, item, attested.hash)));

    const latest = BigInt(await this.#rpc.request<Hex>('eth_blockNumber', []));
    if (latest < this.#finalityLag) throw new Error('registry safe head unavailable');
    const safe = await blockAt(this.#rpc, latest - this.#finalityLag);
    if (safe.number < this.#manifest.attestationBlock.number) {
      throw new Error('registry candidate is not finalized');
    }
    await Promise.all(components.map((item) => verifyCode(this.#rpc, item, safe.hash)));

    const [finalSafe, finalAttestation, finalChain] = await Promise.all([
      blockAt(this.#rpc, safe.number),
      blockAt(this.#rpc, this.#manifest.attestationBlock.number),
      this.#rpc.request<Hex>('eth_chainId', [])
    ]);
    if (
      finalSafe.hash !== safe.hash ||
      finalAttestation.hash !== this.#manifest.attestationBlock.hash ||
      BigInt(finalChain) !== CHAIN_ID
    ) throw new Error('registry changed during attestation');

    return {
      protocol: 'ChainWhisperTestnetRegistryV2',
      schemaVersion: 1,
      network: 'COTI Testnet',
      chainId: 7_082_400,
      manifestHash: this.#manifest.manifestHash,
      owner: this.#manifest.owner,
      attestationBlock: {
        number: this.#manifest.attestationBlock.number.toString(),
        hash: this.#manifest.attestationBlock.hash
      },
      atBlock: {
        number: safe.number.toString(),
        hash: safe.hash,
        timestamp: safe.timestamp.toString()
      },
      complete: true,
      components: components.map((item) => ({
        key: item.key,
        contract: item.contract,
        surface: TESTNET_COMPONENT_EVENT_POLICIES[item.key].surface,
        address: item.address,
        runtimeBytecodeHash: item.runtimeBytecodeHash,
        deploymentBlock: item.deploymentBlock.toString(),
        events: TESTNET_COMPONENT_EVENT_POLICIES[item.key].events
      })),
      privacyBoundary: {
        eventDataReturned: false,
        ciphertextReturned: false,
        privateAmountsReturned: false,
        participantReceiptsReturned: false,
        hiddenIntentIdentifiersReturned: false,
        walletActivityReturned: false
      },
      notificationPolicy: {
        incomingDirectTradesAndCounters: {
          componentKey: 'directOtcV2',
          eventName: 'DirectTradeOpened',
          recipientField: 'taker',
          counterWhenParentTradeIdNonzero: true
        },
        otherTradingEvents: 'none'
      }
    };
  }
}
