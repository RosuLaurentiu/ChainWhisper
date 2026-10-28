import { Interface, keccak256, toUtf8Bytes, type Eip1193Provider } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import {
  bindChatReactionPendingTransaction,
  buildChatReactionPending,
  CHAT_REACTIONS_V1_ABI,
  CHAT_REACTIONS_V1_DIRECT_MESSAGE_ANCHOR_DOMAIN,
  CHAT_REACTIONS_V1_DIRECT_TARGET_FEATURES,
  CHAT_REACTIONS_V1_GROUP_MESSAGE_ANCHOR_DOMAIN,
  CHAT_REACTIONS_V1_GROUP_TARGET_FEATURES,
  CHAT_REACTIONS_V1_REQUIRED_FEATURES,
  createChatReactionSourceResolver,
  deriveDirectChatReactionAnchor,
  replaceChatReactionPendingTransaction,
  type ChatReactionSource,
  type ChatReactionsV1ManifestInput
} from './chatReactionsV1';
import {
  assertAttestedChatReactionsV1Deployment,
  attestChatReactionsV1Deployment,
  bindChatReactionsV1ReadCapability,
  readChatReactionsV1LatestBlock,
  readCanonicalChatReactionsV1LogRange,
  receiptConfirmsCurrentCanonicalChatReactionPending,
  reduceCanonicalChatReactionRangePage,
  type AttestedChatReactionsV1Deployment,
  type CanonicalChatReactionRangePage,
  type ChatReactionsV1ReadCapability
} from './chatReactionsV1Chain';

const address = (pair: string) => `0x${pair.repeat(20)}`;
const hash = (pair: string) => `0x${pair.repeat(32)}`;
const quantity = (value: bigint | number) => `0x${BigInt(value).toString(16)}`;
const blockHash = (number: bigint) => `0x${number.toString(16).padStart(64, '0')}`;

const CHAIN_ID = 7_082_400n;
const REACTIONS = address('11');
const DIRECT = address('22');
const GROUP = address('33');
const ALICE = address('44');
const BOB = address('55');
const CONVERSATION_ID = hash('66');
const REACTIONS_CODE = '0x6001600055';
const DIRECT_CODE = '0x6002600055';
const GROUP_CODE = '0x6003600055';
const REACTIONS_DEPLOYMENT_BLOCK = 100n;
const DIRECT_DEPLOYMENT_BLOCK = 10n;
const GROUP_DEPLOYMENT_BLOCK = 20n;
const LATEST_BLOCK = 150n;
const FINALITY_LAG = 5n;
const SAFE_HEAD = LATEST_BLOCK - FINALITY_LAG;
const REACTION_INTERFACE = new Interface(CHAT_REACTIONS_V1_ABI);

const MANIFEST: ChatReactionsV1ManifestInput = {
  chainId: CHAIN_ID,
  contractAddress: REACTIONS,
  deploymentBlock: REACTIONS_DEPLOYMENT_BLOCK,
  runtimeBytecodeHash: keccak256(REACTIONS_CODE),
  directChatV2: {
    contractAddress: DIRECT,
    deploymentBlock: DIRECT_DEPLOYMENT_BLOCK,
    runtimeBytecodeHash: keccak256(DIRECT_CODE)
  },
  groupChatV2: {
    contractAddress: GROUP,
    deploymentBlock: GROUP_DEPLOYMENT_BLOCK,
    runtimeBytecodeHash: keccak256(GROUP_CODE)
  }
};

const DIRECT_SOURCE: ChatReactionSource = {
  kind: 'direct',
  chainId: CHAIN_ID.toString(),
  contractAddress: DIRECT,
  conversationId: CONVERSATION_ID,
  messageId: '1',
  blockHash: hash('a1'),
  transactionHash: hash('a2'),
  logIndex: 3
};

const featureHashes = (features: readonly string[]) => new Set(
  features.map((feature) => keccak256(toUtf8Bytes(feature)).toLowerCase())
);

type RpcCall = { method: string; params: readonly unknown[] };

class ScriptedProvider implements Pick<Eip1193Provider, 'request'> {
  chainId = CHAIN_ID;
  latestBlock = LATEST_BLOCK;
  calls: RpcCall[] = [];
  codes = new Map<string, string>([
    [REACTIONS.toLowerCase(), REACTIONS_CODE],
    [DIRECT.toLowerCase(), DIRECT_CODE],
    [GROUP.toLowerCase(), GROUP_CODE]
  ]);
  blocks = new Map<string, { hash: string; transactions: string[] }>();
  receipts = new Map<string, Record<string, unknown>>();
  logs: unknown[] = [];
  getterOverrides = new Map<string, unknown>();
  rawCallOverrides = new Map<string, string>();
  rejectedMethods = new Set<string>();
  onRequest?: (method: string) => void;
  reorgSafeHeadAfterFirstRead = false;
  private safeHeadReads = 0;

  private featuresFor(target: string): Set<string> {
    if (target === REACTIONS.toLowerCase()) return featureHashes(CHAT_REACTIONS_V1_REQUIRED_FEATURES);
    if (target === DIRECT.toLowerCase()) return featureHashes(CHAT_REACTIONS_V1_DIRECT_TARGET_FEATURES);
    return featureHashes(CHAT_REACTIONS_V1_GROUP_TARGET_FEATURES);
  }

  private getter(target: string, name: string, args: readonly unknown[]): unknown {
    const overrideKey = `${target}:${name}:${String(args[0] ?? '').toLowerCase()}`;
    if (this.getterOverrides.has(overrideKey)) return this.getterOverrides.get(overrideKey);
    if (target === REACTIONS.toLowerCase()) {
      if (name === 'contractVersion') return 'ChatReactionsV1';
      if (name === 'PROTOCOL_VERSION') return 1n;
      if (name === 'EMOJI_SET_VERSION') return 1n;
      if (name === 'EMOJI_COUNT') return 13n;
      if (name === 'DIRECT_MESSAGE_ANCHOR_DOMAIN') return CHAT_REACTIONS_V1_DIRECT_MESSAGE_ANCHOR_DOMAIN;
      if (name === 'GROUP_MESSAGE_ANCHOR_DOMAIN') return CHAT_REACTIONS_V1_GROUP_MESSAGE_ANCHOR_DOMAIN;
      if (name === 'directChatV2') return DIRECT;
      if (name === 'groupChatV2') return GROUP;
      if (name === 'directChatRuntimeHash') return MANIFEST.directChatV2.runtimeBytecodeHash;
      if (name === 'groupChatRuntimeHash') return MANIFEST.groupChatV2.runtimeBytecodeHash;
      if (name === 'directChatDeploymentBlock') return DIRECT_DEPLOYMENT_BLOCK;
      if (name === 'groupChatDeploymentBlock') return GROUP_DEPLOYMENT_BLOCK;
      if (name === 'deploymentBlock') return REACTIONS_DEPLOYMENT_BLOCK;
    } else if (target === DIRECT.toLowerCase()) {
      if (name === 'contractVersion') return 'ChainWhisperChatV2';
      if (name === 'PROTOCOL_VERSION') return 2n;
      if (name === 'deploymentBlock') return DIRECT_DEPLOYMENT_BLOCK;
    } else if (target === GROUP.toLowerCase()) {
      if (name === 'contractVersion') return 'ChainWhisperGroupChatV2';
      if (name === 'PROTOCOL_VERSION') return 2n;
      if (name === 'deploymentBlock') return GROUP_DEPLOYMENT_BLOCK;
    }
    if (name === 'supportsFeature') {
      return this.featuresFor(target).has(String(args[0]).toLowerCase());
    }
    throw new Error(`Unexpected getter ${target}:${name}`);
  }

  private block(number: bigint) {
    const configured = this.blocks.get(number.toString()) ?? {
      hash: blockHash(number),
      transactions: []
    };
    let canonicalHash = configured.hash;
    if (number === SAFE_HEAD && this.reorgSafeHeadAfterFirstRead) {
      this.safeHeadReads += 1;
      if (this.safeHeadReads > 1) canonicalHash = hash('fe');
    }
    return {
      number: quantity(number),
      hash: canonicalHash,
      transactions: configured.transactions
    };
  }

  async request({ method, params = [] }: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    this.calls.push({ method, params: [...params] });
    this.onRequest?.(method);
    if (this.rejectedMethods.has(method)) throw new Error('scripted rejection');
    if (method === 'eth_chainId') return quantity(this.chainId);
    if (method === 'eth_blockNumber') return quantity(this.latestBlock);
    if (method === 'eth_getBlockByNumber') return this.block(BigInt(String(params[0])));
    if (method === 'eth_getCode') return this.codes.get(String(params[0]).toLowerCase()) ?? '0x';
    if (method === 'eth_getTransactionReceipt') {
      return this.receipts.get(String(params[0]).toLowerCase()) ?? null;
    }
    if (method === 'eth_getLogs') return [...this.logs];
    if (method === 'eth_call') {
      const request = params[0] as { to: string; data: string };
      const target = request.to.toLowerCase();
      const parsed = REACTION_INTERFACE.parseTransaction({ data: request.data });
      if (!parsed) throw new Error('Unknown scripted call');
      const rawOverride = this.rawCallOverrides.get(`${target}:${parsed.name}`);
      if (rawOverride) return rawOverride;
      return REACTION_INTERFACE.encodeFunctionResult(
        parsed.name,
        [this.getter(target, parsed.name, [...parsed.args])]
      );
    }
    throw new Error(`Unexpected RPC method ${method}`);
  }
}

const bind = async (
  provider: ScriptedProvider,
  assertCurrent: () => void | Promise<void> = vi.fn(async () => undefined)
): Promise<ChatReactionsV1ReadCapability> => bindChatReactionsV1ReadCapability({
  provider,
  expectedChainId: CHAIN_ID,
  assertCurrent
});

const attest = async (
  provider = new ScriptedProvider(),
  assertCurrent: () => void | Promise<void> = vi.fn(async () => undefined)
): Promise<{
  provider: ScriptedProvider;
  capability: ChatReactionsV1ReadCapability;
  deployment: AttestedChatReactionsV1Deployment;
}> => {
  const capability = await bind(provider, assertCurrent);
  const deployment = await attestChatReactionsV1Deployment({
    capability,
    manifest: MANIFEST,
    policy: { safeHeadLagBlocks: FINALITY_LAG }
  });
  return { provider, capability, deployment };
};

type ReactionLogOptions = {
  kind?: 'direct' | 'group';
  blockNumber?: bigint;
  transactionHash?: string;
  transactionIndex?: number;
  logIndex?: number;
  active?: boolean;
  reactor?: string;
  anchor?: string;
  removed?: boolean;
};

const reactionLog = (provider: ScriptedProvider, options: ReactionLogOptions = {}) => {
  const kind = options.kind ?? 'direct';
  const blockNumber = options.blockNumber ?? 120n;
  const transactionHash = (options.transactionHash ?? hash('b1')).toLowerCase();
  const transactionIndex = options.transactionIndex ?? 0;
  const logIndex = options.logIndex ?? 7;
  const event = REACTION_INTERFACE.getEvent(kind === 'direct' ? 'DirectReactionSet' : 'GroupReactionSet');
  if (!event) throw new Error('Missing reaction event in test ABI.');
  const anchor = options.anchor ?? deriveDirectChatReactionAnchor({
    chainId: DIRECT_SOURCE.chainId,
    contractAddress: DIRECT_SOURCE.contractAddress,
    conversationId: DIRECT_SOURCE.conversationId ?? '',
    messageId: DIRECT_SOURCE.messageId,
    blockHash: DIRECT_SOURCE.blockHash,
    transactionHash: DIRECT_SOURCE.transactionHash,
    logIndex: DIRECT_SOURCE.logIndex
  });
  const encoded = REACTION_INTERFACE.encodeEventLog(event, [
    kind === 'direct' ? CONVERSATION_ID : 9n,
    1n,
    options.reactor ?? ALICE,
    1,
    options.active ?? true,
    anchor
  ]);
  const configuredBlock = provider.blocks.get(blockNumber.toString()) ?? {
    hash: blockHash(blockNumber),
    transactions: []
  };
  while (configuredBlock.transactions.length <= transactionIndex) {
    configuredBlock.transactions.push(hash('ee'));
  }
  configuredBlock.transactions[transactionIndex] = transactionHash;
  provider.blocks.set(blockNumber.toString(), configuredBlock);
  const raw = {
    address: REACTIONS,
    topics: encoded.topics,
    data: encoded.data,
    blockHash: configuredBlock.hash,
    blockNumber: quantity(blockNumber),
    transactionHash,
    transactionIndex: quantity(transactionIndex),
    logIndex: quantity(logIndex),
    removed: options.removed ?? false
  };
  provider.receipts.set(transactionHash, {
    status: '0x1',
    blockHash: configuredBlock.hash,
    blockNumber: quantity(blockNumber),
    transactionHash,
    transactionIndex: quantity(transactionIndex),
    logs: [{ ...raw, removed: undefined }]
  });
  return raw;
};

const canonical = async (
  context: Awaited<ReturnType<typeof attest>>,
  logs: readonly unknown[],
  fromBlock = 120n,
  toBlock = 123n
): Promise<CanonicalChatReactionRangePage> => {
  context.provider.logs = [...logs];
  return readCanonicalChatReactionsV1LogRange({
  capability: context.capability,
  deployment: context.deployment,
  fromBlock,
  toBlock
  });
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('ChatReactionsV1 chain-attested foundation', () => {
  it('bounds startup getter production while retaining every attestation read', async () => {
    const provider = new ScriptedProvider(), request = provider.request.bind(provider);
    let pending = 0, maximumPending = 0;
    provider.request = async input => {
      maximumPending = Math.max(maximumPending, ++pending);
      await Promise.resolve();
      try { return await request(input); } finally { pending--; }
    };
    const context = await attest(provider);
    expect(context.deployment.attestationBlock.hash).toBe(blockHash(SAFE_HEAD));
    expect(provider.calls.filter(call => call.method === 'eth_call')).toHaveLength(36);
    expect(maximumPending).toBe(1);
  });

  it('attests all code and immutable getters at one EIP-1898 canonical snapshot', async () => {
    const context = await attest();
    expect(context.deployment).toMatchObject({
      chainId: CHAIN_ID.toString(),
      contractAddress: REACTIONS,
      attestationBlock: { number: SAFE_HEAD.toString(), hash: blockHash(SAFE_HEAD) }
    });
    const pinnedCalls = context.provider.calls.filter(({ method }) =>
      method === 'eth_getCode' || method === 'eth_call'
    );
    expect(pinnedCalls.length).toBeGreaterThan(20);
    expect(pinnedCalls.every(({ params }) => {
      const selector = params[1] as { blockHash?: string; requireCanonical?: boolean };
      return selector?.blockHash === blockHash(SAFE_HEAD) && selector.requireCanonical === true;
    })).toBe(true);
    expect(assertAttestedChatReactionsV1Deployment(context.deployment)).toEqual({
      chainId: CHAIN_ID
    });
    expect(await readChatReactionsV1LatestBlock(context.capability)).toBe(LATEST_BLOCK);
    expect(() => assertAttestedChatReactionsV1Deployment(
      clone(context.deployment)
    )).toThrow(/exact attester/i);

    await expect(readCanonicalChatReactionsV1LogRange({
      capability: context.capability,
      deployment: clone(context.deployment),
      fromBlock: 120n,
      toBlock: 123n
    })).rejects.toThrow(/not attested/i);

    context.provider.codes.set(REACTIONS.toLowerCase(), '0x6005');
    await expect(canonical(context, [])).rejects.toThrow(/runtime no longer matches/i);
  });

  it('binds a non-zero finality lag into the attested deployment', async () => {
    const provider = new ScriptedProvider();
    const capability = await bind(provider);
    await expect(attestChatReactionsV1Deployment({
      capability,
      manifest: MANIFEST,
      policy: { safeHeadLagBlocks: 0n }
    })).rejects.toThrow(/non-zero uint64/i);
  });

  it('rejects runtime, getter, feature, app-wallet, and noncanonical ABI evidence', async () => {
    const wrongRuntime = new ScriptedProvider();
    wrongRuntime.codes.set(DIRECT.toLowerCase(), '0x6004');
    await expect(attest(wrongRuntime)).rejects.toThrow(/runtime/i);

    const wrongTarget = new ScriptedProvider();
    wrongTarget.getterOverrides.set(`${REACTIONS.toLowerCase()}:directChatV2:`, BOB);
    await expect(attest(wrongTarget)).rejects.toThrow(/immutable chat targets/i);

    const missingFeature = new ScriptedProvider();
    const featureHash = keccak256(toUtf8Bytes('REACTION_AUTHORIZATION')).toLowerCase();
    missingFeature.getterOverrides.set(`${DIRECT.toLowerCase()}:supportsFeature:${featureHash}`, false);
    await expect(attest(missingFeature)).rejects.toThrow(/required feature/i);

    const appWallet = new ScriptedProvider();
    const appWalletHash = keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR')).toLowerCase();
    appWallet.getterOverrides.set(`${GROUP.toLowerCase()}:supportsFeature:${appWalletHash}`, true);
    await expect(attest(appWallet)).rejects.toThrow(/app-wallet/i);

    const noncanonicalBool = new ScriptedProvider();
    noncanonicalBool.rawCallOverrides.set(
      `${REACTIONS.toLowerCase()}:supportsFeature`,
      `0x${'00'.repeat(31)}02`
    );
    await expect(attest(noncanonicalBool)).rejects.toThrow(/noncanonical ABI/i);
  });

  it('fails closed on unsupported block-hash RPC, chain changes, snapshot reorg, and lease expiry', async () => {
    const unsupported = new ScriptedProvider();
    unsupported.rejectedMethods.add('eth_getCode');
    await expect(attest(unsupported)).rejects.toThrow(/eth_getCode failed/i);

    const wrongChain = new ScriptedProvider();
    wrongChain.chainId = 1n;
    await expect(bind(wrongChain)).rejects.toThrow(/chain changed/i);

    const reorganized = new ScriptedProvider();
    reorganized.reorgSafeHeadAfterFirstRead = true;
    await expect(attest(reorganized)).rejects.toThrow(/snapshot was reorganized/i);

    let current = true;
    const expired = new ScriptedProvider();
    expired.onRequest = (method) => {
      if (method === 'eth_getCode') current = false;
    };
    await expect(attest(expired, async () => {
      if (!current) throw new Error('lease expired');
    })).rejects.toThrow(/lease expired/i);
  });

  it('verifies canonical blocks, transaction slots, successful receipts, and exact receipt logs', async () => {
    const context = await attest();
    const raw = reactionLog(context.provider);
    const page = await canonical(context, [raw]);
    expect(page.safeHead).toEqual({ number: SAFE_HEAD.toString(), hash: blockHash(SAFE_HEAD) });
    expect(page.finalityLagBlocks).toBe(FINALITY_LAG.toString());
    expect(page.observations).toHaveLength(1);
    expect(page.observations[0]).toMatchObject({
      conversationId: CONVERSATION_ID,
      reactor: ALICE,
      active: true,
      removed: false
    });
    expect(page.range).toEqual({
      fromBlock: '120',
      toBlock: '123',
      fromBlockHash: blockHash(120n),
      toBlockHash: blockHash(123n)
    });
    const rangeCall = context.provider.calls.find(({ method }) => method === 'eth_getLogs');
    expect(rangeCall?.params).toEqual([{
      address: REACTIONS,
      fromBlock: '0x78',
      toBlock: '0x7b',
      topics: [[
        REACTION_INTERFACE.getEvent('DirectReactionSet')?.topicHash,
        REACTION_INTERFACE.getEvent('GroupReactionSet')?.topicHash
      ]]
    }]);
  });

  it('owns range completeness through eth_getLogs and ignores a caller-shaped subset field', async () => {
    const context = await attest();
    const first = reactionLog(context.provider, { transactionHash: hash('b8'), blockNumber: 120n });
    const second = reactionLog(context.provider, { transactionHash: hash('b9'), blockNumber: 121n });
    context.provider.logs = [first, second];
    const page = await readCanonicalChatReactionsV1LogRange({
      capability: context.capability,
      deployment: context.deployment,
      fromBlock: 120n,
      toBlock: 121n,
      logs: [first]
    } as unknown as Parameters<typeof readCanonicalChatReactionsV1LogRange>[0]);
    expect(page.observations).toHaveLength(2);
    await expect(readCanonicalChatReactionsV1LogRange({
      capability: context.capability,
      deployment: context.deployment,
      fromBlock: 120n,
      toBlock: 120n + 2_048n
    })).rejects.toThrow(/bounded uint64 bigint range/i);
    await expect(readCanonicalChatReactionsV1LogRange({
      capability: context.capability,
      deployment: context.deployment,
      fromBlock: 120n,
      toBlock: 1n << 64n
    })).rejects.toThrow(/bounded uint64 bigint range/i);

    context.provider.logs = Array.from({ length: 4_097 }, () => null);
    await expect(readCanonicalChatReactionsV1LogRange({
      capability: context.capability,
      deployment: context.deployment,
      fromBlock: 120n,
      toBlock: 120n
    })).rejects.toThrow(/split it into smaller ranges/i);
  });

  it('rejects removed, above-safe-head, orphan, and wrong-transaction-slot logs', async () => {
    const context = await attest();
    await expect(canonical(context, [reactionLog(context.provider, { removed: true })]))
      .rejects.toThrow(/removed-log signal/i);

    const aboveSafe = reactionLog(context.provider, {
      blockNumber: SAFE_HEAD + 1n,
      transactionHash: hash('b2')
    });
    await expect(canonical(context, [aboveSafe], SAFE_HEAD + 1n, SAFE_HEAD + 1n))
      .rejects.toThrow(/above the attested safe head/i);

    const orphan = reactionLog(context.provider, { transactionHash: hash('b3') });
    context.provider.blocks.set('120', { hash: hash('fd'), transactions: [hash('b3')] });
    await expect(canonical(context, [orphan])).rejects.toThrow(/orphan block/i);

    context.provider.blocks.set('120', { hash: blockHash(120n), transactions: [] });
    const wrongSlot = reactionLog(context.provider, { transactionHash: hash('b4') });
    context.provider.blocks.set('120', { hash: blockHash(120n), transactions: [hash('ff')] });
    await expect(canonical(context, [wrongSlot])).rejects.toThrow(/transaction slot/i);
  });

  it('rejects missing, failed, misplaced, and payload-mismatched receipts', async () => {
    const missingContext = await attest();
    const missing = reactionLog(missingContext.provider, { transactionHash: hash('c1') });
    missingContext.provider.receipts.delete(hash('c1'));
    await expect(canonical(missingContext, [missing])).rejects.toThrow(/receipt is missing/i);

    const failedContext = await attest();
    const failed = reactionLog(failedContext.provider, { transactionHash: hash('c2') });
    failedContext.provider.receipts.get(hash('c2'))!.status = '0x0';
    await expect(canonical(failedContext, [failed])).rejects.toThrow(/unsuccessful/i);

    const wrongBlockContext = await attest();
    const wrongBlock = reactionLog(wrongBlockContext.provider, { transactionHash: hash('c3') });
    wrongBlockContext.provider.receipts.get(hash('c3'))!.blockHash = hash('fc');
    await expect(canonical(wrongBlockContext, [wrongBlock])).rejects.toThrow(/block metadata/i);

    const payloadContext = await attest();
    const payload = reactionLog(payloadContext.provider, { transactionHash: hash('c4') });
    const receipt = payloadContext.provider.receipts.get(hash('c4'))!;
    const receiptLog = receipt.logs as Array<Record<string, unknown>>;
    receiptLog[0] = { ...receiptLog[0], data: `${String(receiptLog[0].data).slice(0, -2)}00` };
    await expect(canonical(payloadContext, [payload])).rejects.toThrow(/exactly match/i);

    const removedContext = await attest();
    const removed = reactionLog(removedContext.provider, { transactionHash: hash('c5') });
    const removedReceipt = removedContext.provider.receipts.get(hash('c5'))!;
    (removedReceipt.logs as Array<Record<string, unknown>>)[0].removed = true;
    await expect(canonical(removedContext, [removed])).rejects.toThrow(/removed-log signal/i);

    const malformedRemovedContext = await attest();
    const malformedRemoved = reactionLog(malformedRemovedContext.provider, { transactionHash: hash('c6') });
    const malformedRemovedReceipt = malformedRemovedContext.provider.receipts.get(hash('c6'))!;
    (malformedRemovedReceipt.logs as Array<Record<string, unknown>>)[0].removed = 'false';
    await expect(canonical(malformedRemovedContext, [malformedRemoved])).rejects.toThrow(/removed-log signal/i);
  });

  it('revalidates the deployment attestation block before and after every range read', async () => {
    const before = await attest();
    before.provider.blocks.set(SAFE_HEAD.toString(), { hash: hash('fa'), transactions: [] });
    await expect(canonical(before, [])).rejects.toThrow(/attestation block was reorganized/i);

    const after = await attest();
    const raw = reactionLog(after.provider, { transactionHash: hash('d0') });
    let receiptSeen = false;
    let postReceiptBlockReads = 0;
    after.provider.onRequest = (method) => {
      if (method === 'eth_getTransactionReceipt') receiptSeen = true;
      if (receiptSeen && method === 'eth_getBlockByNumber') {
        postReceiptBlockReads += 1;
        if (postReceiptBlockReads === 4) {
          after.provider.blocks.set(SAFE_HEAD.toString(), { hash: hash('f9'), transactions: [] });
        }
      }
    };
    await expect(canonical(after, [raw])).rejects.toThrow(/attestation block was reorganized/i);
  });

  it('uses the captured request method and performs a final chain fence before page branding', async () => {
    const captured = await attest();
    const raw = reactionLog(captured.provider, { transactionHash: hash('d3') });
    const replacement = vi.fn(async () => { throw new Error('replacement must not run'); });
    captured.provider.request = replacement as typeof captured.provider.request;
    await expect(canonical(captured, [raw])).resolves.toMatchObject({ observations: [{ transactionHash: hash('d3') }] });
    expect(replacement).not.toHaveBeenCalled();

    const switched = await attest();
    const switchedRaw = reactionLog(switched.provider, { transactionHash: hash('d4') });
    let receiptSeen = false;
    let blockReads = 0;
    switched.provider.onRequest = (method) => {
      if (method === 'eth_getTransactionReceipt') receiptSeen = true;
      if (receiptSeen && method === 'eth_getBlockByNumber' && ++blockReads === 4) {
        switched.provider.chainId = 1n;
      }
    };
    await expect(canonical(switched, [switchedRaw])).rejects.toThrow(/chain changed/i);
  });

  it('brands an entire batch atomically and rejects post-read reorgs or depth regressions', async () => {
    const reorgContext = await attest();
    const raw = reactionLog(reorgContext.provider, { transactionHash: hash('d1') });
    let receiptRead = false;
    reorgContext.provider.onRequest = (method) => {
      if (method === 'eth_getTransactionReceipt') receiptRead = true;
      if (receiptRead && method === 'eth_getBlockByNumber') {
        reorgContext.provider.blocks.set('120', { hash: hash('fb'), transactions: [hash('d1')] });
      }
    };
    await expect(canonical(reorgContext, [raw])).rejects.toThrow(/changed during verification|orphan block/i);

    const depthContext = await attest();
    const depthRaw = reactionLog(depthContext.provider, { transactionHash: hash('d2') });
    depthContext.provider.onRequest = (method) => {
      if (method === 'eth_getTransactionReceipt') depthContext.provider.latestBlock = SAFE_HEAD;
    };
    await expect(canonical(depthContext, [depthRaw])).rejects.toThrow(/lost its safe-head depth/i);
  });

  it('reduces only the exact canonical range page, validates source anchors, and folds last-write-wins', async () => {
    const context = await attest();
    const first = reactionLog(context.provider, {
      blockNumber: 120n,
      transactionHash: hash('e1'),
      active: true
    });
    const repeated = reactionLog(context.provider, {
      blockNumber: 121n,
      transactionHash: hash('e2'),
      active: true
    });
    const final = reactionLog(context.provider, {
      blockNumber: 122n,
      transactionHash: hash('e3'),
      active: false
    });
    const bob = reactionLog(context.provider, {
      blockNumber: 121n,
      transactionHash: hash('e4'),
      transactionIndex: 1,
      reactor: BOB,
      active: true
    });
    const stale = reactionLog(context.provider, {
      blockNumber: 123n,
      transactionHash: hash('e5'),
      anchor: hash('fa')
    });
    const page = await canonical(context, [final, stale, bob, repeated, first]);
    const reduced = reduceCanonicalChatReactionRangePage(
      page,
      createChatReactionSourceResolver([DIRECT_SOURCE])
    );
    expect(reduced.accepted.map((item) => item.blockNumber)).toEqual(['120', '121', '121', '122']);
    expect(reduced.states).toHaveLength(2);
    expect(reduced.states.find((item) => item.reactor === ALICE)?.active).toBe(false);
    expect(reduced.states.find((item) => item.reactor === BOB)?.active).toBe(true);
    expect(reduced.ignored).toContainEqual({ rawIdentity: page.observations[4].rawIdentity, reason: 'anchor-mismatch' });

    expect(() => reduceCanonicalChatReactionRangePage(
      clone(page),
      createChatReactionSourceResolver([DIRECT_SOURCE])
    )).toThrow(/atomically verified/i);
  });

  it('keeps empty and replayed results scoped to their exact immutable range pages', async () => {
    const context = await attest();
    const raw = reactionLog(context.provider, { transactionHash: hash('f1') });
    const added = await canonical(context, [raw, raw]);
    const empty = await canonical(context, []);
    const replayed = await canonical(context, [raw]);
    const resolver = createChatReactionSourceResolver([DIRECT_SOURCE]);
    expect(reduceCanonicalChatReactionRangePage(added, resolver).states).toHaveLength(1);
    expect(reduceCanonicalChatReactionRangePage(empty, resolver).states).toHaveLength(0);
    expect(reduceCanonicalChatReactionRangePage(replayed, resolver).states).toHaveLength(1);
    expect(empty.range).toEqual({
      fromBlock: '120',
      toBlock: '123',
      fromBlockHash: blockHash(120n),
      toBlockHash: blockHash(123n)
    });
    expect(() => reduceCanonicalChatReactionRangePage(
      clone(replayed),
      resolver
    )).toThrow(/canonical range page/i);
  });

  it('confirms only the exact canonical effective receipt event for the current pending identity', async () => {
    const context = await attest();
    const effectiveHash = hash('f2');
    const raw = reactionLog(context.provider, { transactionHash: effectiveHash });
    const page = await canonical(context, [raw]);
    const event = page.observations[0];
    const draft = buildChatReactionPending({
      target: {
        kind: event.kind,
        chainId: event.chainId,
        reactionsContract: event.reactionsContract,
        targetContract: event.targetContract,
        conversationId: event.conversationId,
        messageId: event.messageId
      },
      reactor: ALICE,
      emojiId: 1,
      active: true,
      messageAnchor: event.messageAnchor,
      operationId: 'reaction-operation'
    });
    const original = bindChatReactionPendingTransaction(draft, hash('f3'));
    const replaced = replaceChatReactionPendingTransaction(original, effectiveHash);
    expect(receiptConfirmsCurrentCanonicalChatReactionPending(replaced.identity, replaced, event)).toBe(true);
    expect(receiptConfirmsCurrentCanonicalChatReactionPending(original.identity, replaced, event)).toBe(false);
    expect(receiptConfirmsCurrentCanonicalChatReactionPending(
      replaced.identity,
      replaced,
      clone(event)
    )).toBe(false);
  });
});
