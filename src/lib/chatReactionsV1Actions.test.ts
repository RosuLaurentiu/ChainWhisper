import {
  BrowserProvider,
  Interface,
  keccak256,
  type JsonRpcSigner,
  type TransactionReceipt,
  type TransactionResponse
} from '@coti-io/coti-ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chainMocks = vi.hoisted(() => ({
  assertAttested: vi.fn()
}));

vi.mock('./chatReactionsV1Chain', () => ({
  assertAttestedChatReactionsV1Deployment: chainMocks.assertAttested
}));

import {
  CHAT_REACTIONS_V1_ABI,
  CHAT_REACTIONS_V1_EMOJIS,
  deriveChatReactionSourceAnchor,
  type ChatReactionSource,
  type ChatReactionsV1ManifestInput
} from './chatReactionsV1';
import {
  bindChatReactionsV1OwnerDeployment,
  bindChatReactionsV1MetaMaskCapability,
  setChatReactionsV1Reaction
} from './chatReactionsV1Actions';
import type { AttestedChatReactionsV1Deployment } from './chatReactionsV1Chain';

const address = (pair: string) => `0x${pair.repeat(20)}`;
const hash = (pair: string) => `0x${pair.repeat(32)}`;
const CHAIN_ID = 7_082_400n;
const REACTIONS = address('11');
const DIRECT = address('22');
const GROUP = address('33');
const ALICE = address('44');
const CONVERSATION_ID = hash('55');
const ORIGINAL_TX = hash('66');
const REPLACEMENT_TX = hash('77');
const REACTION_INTERFACE = new Interface(CHAT_REACTIONS_V1_ABI);

const MANIFEST: ChatReactionsV1ManifestInput = {
  chainId: CHAIN_ID,
  contractAddress: REACTIONS,
  deploymentBlock: 100n,
  runtimeBytecodeHash: keccak256('0x6001'),
  directChatV2: {
    contractAddress: DIRECT,
    deploymentBlock: 10n,
    runtimeBytecodeHash: keccak256('0x6002')
  },
  groupChatV2: {
    contractAddress: GROUP,
    deploymentBlock: 20n,
    runtimeBytecodeHash: keccak256('0x6003')
  }
};

const DEPLOYMENT = Object.freeze({
  chainId: CHAIN_ID.toString(),
  contractAddress: REACTIONS,
  deploymentBlock: '100',
  runtimeBytecodeHash: MANIFEST.runtimeBytecodeHash,
  directChatV2: Object.freeze({
    contractAddress: DIRECT,
    deploymentBlock: '10',
    runtimeBytecodeHash: MANIFEST.directChatV2.runtimeBytecodeHash
  }),
  groupChatV2: Object.freeze({
    contractAddress: GROUP,
    deploymentBlock: '20',
    runtimeBytecodeHash: MANIFEST.groupChatV2.runtimeBytecodeHash
  })
}) as unknown as AttestedChatReactionsV1Deployment;

const SOURCE: ChatReactionSource = Object.freeze({
  kind: 'direct',
  chainId: CHAIN_ID.toString(),
  contractAddress: DIRECT,
  conversationId: CONVERSATION_ID,
  messageId: '7',
  blockHash: hash('88'),
  transactionHash: hash('99'),
  logIndex: 3
});

const makeProvider = (): BrowserProvider => new BrowserProvider({
  request: vi.fn(async ({ method }: { method: string }) => {
    if (method === 'eth_chainId') return `0x${CHAIN_ID.toString(16)}`;
    if (method === 'eth_accounts') return [ALICE];
    throw new Error(`Unexpected provider request: ${method}`);
  })
}, { chainId: Number(CHAIN_ID), name: 'ChatReactionsV1 test' });

type FakeSigner = JsonRpcSigner & {
  sendTransaction: ReturnType<typeof vi.fn>;
};

const makeSigner = (provider: BrowserProvider): FakeSigner => ({
  provider,
  getAddress: vi.fn(async () => ALICE),
  sendTransaction: vi.fn()
}) as unknown as FakeSigner;

const reactionReceipt = ({
  transactionHash = ORIGINAL_TX,
  active = true,
  anchor = deriveChatReactionSourceAnchor(SOURCE)
}: {
  transactionHash?: string;
  active?: boolean;
  anchor?: string;
} = {}): TransactionReceipt => {
  const event = REACTION_INTERFACE.getEvent('DirectReactionSet');
  if (!event) throw new Error('Direct reaction event is missing from the test ABI.');
  const encoded = REACTION_INTERFACE.encodeEventLog(event, [
    CONVERSATION_ID,
    7n,
    ALICE,
    1,
    active,
    anchor
  ]);
  return {
    status: 1,
    hash: transactionHash,
    blockHash: hash('aa'),
    blockNumber: 120,
    index: 2,
    logs: [{
      address: REACTIONS,
      topics: encoded.topics,
      data: encoded.data,
      index: 4
    }]
  } as unknown as TransactionReceipt;
};

const transactionFrom = (
  request: Record<string, unknown>,
  receipt: TransactionReceipt,
  hashValue = ORIGINAL_TX
): TransactionResponse => ({
  from: ALICE,
  to: REACTIONS,
  data: String(request.data),
  value: 0n,
  hash: hashValue,
  wait: vi.fn(async () => receipt)
}) as unknown as TransactionResponse;

const setup = async () => {
  const provider = makeProvider();
  const signer = makeSigner(provider);
  const assertCurrent = vi.fn(async () => undefined);
  const assertSnapshotCurrent = vi.fn(() => undefined);
  const capability = await bindChatReactionsV1MetaMaskCapability({
    signer,
    browserProvider: provider,
    ownerAddress: ALICE,
    chainId: CHAIN_ID,
    assertCurrent,
    assertSnapshotCurrent
  });
  await bindChatReactionsV1OwnerDeployment({
    capability,
    deployment: DEPLOYMENT
  });
  return { capability, deployment: DEPLOYMENT, signer, assertCurrent, assertSnapshotCurrent };
};

describe('ChatReactionsV1 owner actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chainMocks.assertAttested.mockReturnValue(Object.freeze({ chainId: CHAIN_ID }));
  });

  it('refuses to bind an owner capability to a deployment attested on another chain', async () => {
    const provider = makeProvider();
    const signer = makeSigner(provider);
    const capability = await bindChatReactionsV1MetaMaskCapability({
      signer,
      browserProvider: provider,
      ownerAddress: ALICE,
      chainId: CHAIN_ID,
      assertCurrent: vi.fn(async () => undefined)
    });
    chainMocks.assertAttested.mockReturnValueOnce(Object.freeze({ chainId: 1n }));

    await expect(bindChatReactionsV1OwnerDeployment({
      capability,
      deployment: DEPLOYMENT
    })).rejects.toThrow(/another chain/i);
  });

  it('binds an already-attested deployment with the lease snapshot instead of another live wallet check', async () => {
    const provider = makeProvider();
    const signer = makeSigner(provider);
    const assertCurrent = vi.fn(async () => undefined);
    const assertSnapshotCurrent = vi.fn(() => undefined);
    const capability = await bindChatReactionsV1MetaMaskCapability({
      signer,
      browserProvider: provider,
      ownerAddress: ALICE,
      chainId: CHAIN_ID,
      assertCurrent,
      assertSnapshotCurrent
    });
    assertCurrent.mockClear();
    assertSnapshotCurrent.mockClear();

    await bindChatReactionsV1OwnerDeployment({ capability, deployment: DEPLOYMENT });

    expect(assertSnapshotCurrent).toHaveBeenCalledOnce();
    expect(assertCurrent).not.toHaveBeenCalled();
  });

  it('submits one exact public Direct V2 reaction and binds its matching receipt', async () => {
    const { capability, deployment, signer, assertCurrent, assertSnapshotCurrent } = await setup();
    vi.mocked(signer.getAddress).mockClear();
    const getNetwork = vi.spyOn(signer.provider as BrowserProvider, 'getNetwork');
    assertCurrent.mockClear();
    assertSnapshotCurrent.mockClear();
    signer.sendTransaction.mockImplementation(async (request: Record<string, unknown>) =>
      transactionFrom(request, reactionReceipt())
    );

    const result = await setChatReactionsV1Reaction({
      capability,
      deployment,
      source: SOURCE,
      emoji: CHAT_REACTIONS_V1_EMOJIS[0],
      active: true,
      operationId: 'direct-message-7-like'
    });

    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
    expect(signer.getAddress).not.toHaveBeenCalled();
    expect(getNetwork).not.toHaveBeenCalled();
    const request = signer.sendTransaction.mock.calls[0]?.[0] as Record<string, unknown>;
    const parsed = REACTION_INTERFACE.parseTransaction({ data: String(request.data) });
    expect(parsed?.name).toBe('setDirectReaction');
    expect([...parsed!.args]).toEqual([
      CONVERSATION_ID,
      7n,
      deriveChatReactionSourceAnchor(SOURCE),
      1n,
      true
    ]);
    expect(request.value).toBe(0n);
    expect(result.event.messageAnchor).toBe(deriveChatReactionSourceAnchor(SOURCE));
    expect(result.pending.effectiveTransactionHash).toBe(ORIGINAL_TX);
    expect(result.submittedTransactionHash).toBe(ORIGINAL_TX);
    expect(result.transactionHash).toBe(ORIGINAL_TX);
    expect(assertCurrent).not.toHaveBeenCalled();
    expect(assertSnapshotCurrent).toHaveBeenCalledTimes(1);
  });

  it('uses an independent canonical receipt reader instead of polling MetaMask after broadcast', async () => {
    const { capability, deployment, signer } = await setup();
    const receipt = reactionReceipt();
    let submitted: TransactionResponse | null = null;
    signer.sendTransaction.mockImplementation(async (request: Record<string, unknown>) => {
      submitted = transactionFrom(request, receipt);
      return submitted;
    });
    const waitForReceipt = vi.fn(async () => receipt);

    await setChatReactionsV1Reaction({
      capability,
      deployment,
      source: SOURCE,
      emoji: CHAT_REACTIONS_V1_EMOJIS[0],
      active: true,
      operationId: 'public-receipt-reader',
      waitForReceipt
    });

    expect(waitForReceipt).toHaveBeenCalledWith(ORIGINAL_TX);
    expect((submitted as unknown as { wait: ReturnType<typeof vi.fn> }).wait).not.toHaveBeenCalled();
  });

  it('accepts a non-cancelled exact replacement and records both transaction identities', async () => {
    const { capability, deployment, signer } = await setup();
    signer.sendTransaction.mockImplementation(async (request: Record<string, unknown>) => {
      const replacementReceipt = reactionReceipt({ transactionHash: REPLACEMENT_TX });
      const replacement = transactionFrom(request, replacementReceipt, REPLACEMENT_TX);
      return {
        ...transactionFrom(request, reactionReceipt()),
        wait: vi.fn(async () => {
          throw {
            code: 'TRANSACTION_REPLACED',
            cancelled: false,
            reason: 'repriced',
            replacement,
            receipt: replacementReceipt
          };
        })
      } as unknown as TransactionResponse;
    });

    const result = await setChatReactionsV1Reaction({
      capability,
      deployment,
      source: SOURCE,
      emoji: CHAT_REACTIONS_V1_EMOJIS[0],
      active: true,
      operationId: 'replacement'
    });

    expect(result.submittedTransactionHash).toBe(ORIGINAL_TX);
    expect(result.transactionHash).toBe(REPLACEMENT_TX);
    expect(result.pending.originalTransactionHash).toBe(ORIGINAL_TX);
    expect(result.pending.effectiveTransactionHash).toBe(REPLACEMENT_TX);
  });

  it('rejects a replacement that changes calldata', async () => {
    const { capability, deployment, signer } = await setup();
    signer.sendTransaction.mockImplementation(async (request: Record<string, unknown>) => {
      const replacementReceipt = reactionReceipt({ transactionHash: REPLACEMENT_TX });
      const replacement = {
        ...transactionFrom(request, replacementReceipt, REPLACEMENT_TX),
        data: '0x12345678'
      } as unknown as TransactionResponse;
      return {
        ...transactionFrom(request, reactionReceipt()),
        wait: vi.fn(async () => {
          throw {
            code: 'TRANSACTION_REPLACED',
            cancelled: false,
            reason: 'replaced',
            replacement,
            receipt: replacementReceipt
          };
        })
      } as unknown as TransactionResponse;
    });

    await expect(setChatReactionsV1Reaction({
      capability,
      deployment,
      source: SOURCE,
      emoji: CHAT_REACTIONS_V1_EMOJIS[0],
      active: true,
      operationId: 'changed-replacement'
    })).rejects.toThrow('replacement changed');
  });

  it('rejects a cancelled replacement without accepting its receipt', async () => {
    const { capability, deployment, signer } = await setup();
    signer.sendTransaction.mockImplementation(async (request: Record<string, unknown>) => ({
      ...transactionFrom(request, reactionReceipt()),
      wait: vi.fn(async () => {
        throw {
          code: 'TRANSACTION_REPLACED',
          cancelled: true,
          reason: 'cancelled',
          replacement: transactionFrom(request, reactionReceipt({ transactionHash: REPLACEMENT_TX }), REPLACEMENT_TX),
          receipt: reactionReceipt({ transactionHash: REPLACEMENT_TX })
        };
      })
    }) as unknown as TransactionResponse);

    await expect(setChatReactionsV1Reaction({
      capability,
      deployment,
      source: SOURCE,
      emoji: CHAT_REACTIONS_V1_EMOJIS[0],
      active: true,
      operationId: 'cancelled-replacement'
    })).rejects.toMatchObject({ cancelled: true });
  });

  it('rejects wrong chat deployments and receipts without one exact event', async () => {
    const { capability, deployment, signer } = await setup();
    await expect(setChatReactionsV1Reaction({
      capability,
      deployment,
      source: { ...SOURCE, contractAddress: address('ab') },
      emoji: CHAT_REACTIONS_V1_EMOJIS[0],
      active: true,
      operationId: 'wrong-source'
    })).rejects.toThrow('outside the attested chat deployment');
    expect(signer.sendTransaction).not.toHaveBeenCalled();

    const emptyReceipt = { ...reactionReceipt(), logs: [] } as unknown as TransactionReceipt;
    signer.sendTransaction.mockImplementation(async (request: Record<string, unknown>) =>
      transactionFrom(request, emptyReceipt)
    );
    await expect(setChatReactionsV1Reaction({
      capability,
      deployment,
      source: SOURCE,
      emoji: CHAT_REACTIONS_V1_EMOJIS[0],
      active: true,
      operationId: 'missing-event'
    })).rejects.toThrow('exactly one matching event');
  });
});
