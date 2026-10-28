import { Interface, keccak256, toUtf8Bytes, type Eip1193Provider } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import {
  assertCanonicalPrivateLiquidityCatalogAnchor,
  assertCanonicalPrivateLiquidityLogRange,
  assertCanonicalPrivateLiquidityPositionSnapshot,
  assertCompleteCanonicalPrivateLiquidityPositionSnapshot,
  attestPrivateLiquidityDeployment,
  bindPrivateLiquidityReadCapability,
  composeCompleteCanonicalPrivateLiquidityPositionSnapshot,
  readCanonicalPrivateLiquidityCatalogAnchor,
  readCanonicalPrivateLiquidityLogRange,
  readCanonicalPrivateLiquidityPositions,
  type AttestedPrivateLiquidityDeployment,
  type PrivateLiquidityManifestInput,
  type PrivateLiquidityReadCapability
} from './privateLiquidityChain';
import { PRIVATE_LIQUIDITY_V1_EVENT_ABI } from './privateLiquidityEvents';
import { buildPrivateLiquidityPairKey } from './privateLiquidity';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;
const quantity = (value: bigint | number): string => `0x${BigInt(value).toString(16)}`;
const blockHash = (number: bigint): string => `0x${number.toString(16).padStart(64, '0')}`;

const CHAIN_ID = 7_082_400n;
const CONTRACT = address('11');
const OWNER = address('22');
const BASE = address('33');
const QUOTE = address('44');
const PAIR = hash('55');
const CODE = '0x6001600055';
const DEPLOYMENT_BLOCK = 100n;
const LATEST = 150n;
const LAG = 5n;
const SAFE_HEAD = LATEST - LAG;
const METADATA = new Interface([
  'function contractVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)'
]);
const EVENTS = new Interface(PRIVATE_LIQUIDITY_V1_EVENT_ABI);
const POSITION_VIEWS = new Interface([
  'function getPositionView(uint256 positionId) view returns (tuple(tuple(uint8 status,address baseToken,address quoteToken,tuple(uint256 baseAmount,uint256 quoteAmount) buyTerms,tuple(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint64 createdAt,uint64 revision,bytes32 baseTokenCodeHash,bytes32 quoteTokenCodeHash,address privacyOwner,bool buySideAvailable,bool sellSideAvailable) position,uint256 positionId,address positionOwner,bytes32 pairKey) view_)',
  'function lastActivityBlock(uint256 positionId) view returns (uint256)',
  'function nextPositionId() view returns (uint256)'
]);
const VIEW_PAIR = buildPrivateLiquidityPairKey(BASE, QUOTE);
const APP_WALLET_FEATURE = keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR')).toLowerCase();

const MANIFEST: PrivateLiquidityManifestInput = {
  chainId: CHAIN_ID,
  contractAddress: CONTRACT,
  deploymentBlock: DEPLOYMENT_BLOCK,
  runtimeBytecodeHash: keccak256(CODE)
};

type RpcCall = Readonly<{ method: string; params: readonly unknown[] }>;

class ScriptedProvider implements Pick<Eip1193Provider, 'request'> {
  chainId = CHAIN_ID;
  latest = LATEST;
  code = CODE;
  version = 'ChainWhisperPrivateLiquidityBookV1';
  appWalletExecutor = false;
  unsupportedFeatures = new Set<string>();
  logs: unknown[] = [];
  blocks = new Map<string, { hash: string; transactions: string[] }>();
  receipts = new Map<string, Record<string, unknown>>();
  calls: RpcCall[] = [];
  reorgAttestation = false;
  nextPositionId = 8n;
  private attestationReads = 0;

  private block(number: bigint) {
    const configured = this.blocks.get(number.toString()) ?? {
      hash: blockHash(number),
      transactions: []
    };
    let canonicalHash = configured.hash;
    if (this.reorgAttestation && number === SAFE_HEAD) {
      this.attestationReads += 1;
      if (this.attestationReads > 1) canonicalHash = hash('fe');
    }
    return {
      number: quantity(number),
      hash: canonicalHash,
      transactions: [...configured.transactions]
    };
  }

  async request({ method, params = [] }: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    this.calls.push({ method, params: [...params] });
    if (method === 'eth_chainId') return quantity(this.chainId);
    if (method === 'eth_blockNumber') return quantity(this.latest);
    if (method === 'eth_getBlockByNumber') return this.block(BigInt(String(params[0])));
    if (method === 'eth_getCode') return this.code;
    if (method === 'eth_getLogs') {
      const filter = params[0] as { topics?: unknown[] };
      const requested = Array.isArray(filter?.topics?.[0])
        ? new Set((filter.topics[0] as unknown[]).map((topic) => String(topic).toLowerCase()))
        : new Set<string>();
      return this.logs.filter((log) => requested.has(String(
        (log as { topics?: unknown[] }).topics?.[0]
      ).toLowerCase()));
    }
    if (method === 'eth_getTransactionReceipt') {
      return this.receipts.get(String(params[0]).toLowerCase()) ?? null;
    }
    if (method === 'eth_call') {
      const call = params[0] as { data: string };
      const positionCall = POSITION_VIEWS.parseTransaction({ data: call.data });
      if (positionCall?.name === 'getPositionView') {
        const id = BigInt(positionCall.args[0]);
        return POSITION_VIEWS.encodeFunctionResult(positionCall.name, [[
          [
            1,
            BASE,
            QUOTE,
            [1n, 9n],
            [1n, 11n],
            123n,
            4n,
            hash('66'),
            hash('77'),
            OWNER,
            true,
            true
          ],
          id,
          OWNER,
          VIEW_PAIR
        ]]);
      }
      if (positionCall?.name === 'lastActivityBlock') {
        return POSITION_VIEWS.encodeFunctionResult(positionCall.name, [120n]);
      }
      if (positionCall?.name === 'nextPositionId') {
        return POSITION_VIEWS.encodeFunctionResult(positionCall.name, [this.nextPositionId]);
      }
      const parsed = METADATA.parseTransaction({ data: call.data });
      if (!parsed) throw new Error('Unknown metadata call.');
      if (parsed.name === 'contractVersion') {
        return METADATA.encodeFunctionResult(parsed.name, [this.version]);
      }
      const feature = String(parsed.args[0]).toLowerCase();
      const supported = feature === APP_WALLET_FEATURE
        ? this.appWalletExecutor
        : !this.unsupportedFeatures.has(feature);
      return METADATA.encodeFunctionResult(parsed.name, [supported]);
    }
    throw new Error(`Unexpected RPC method ${method}.`);
  }
}

const bind = async (
  provider: ScriptedProvider,
  assertCurrent: () => void | Promise<void> = vi.fn(async () => undefined)
): Promise<PrivateLiquidityReadCapability> => bindPrivateLiquidityReadCapability({
  provider,
  expectedChainId: CHAIN_ID,
  assertCurrent
});

const attest = async (provider = new ScriptedProvider()): Promise<{
  provider: ScriptedProvider;
  capability: PrivateLiquidityReadCapability;
  deployment: AttestedPrivateLiquidityDeployment;
}> => {
  const capability = await bind(provider);
  const deployment = await attestPrivateLiquidityDeployment({
    capability,
    manifest: MANIFEST,
    finalityLagBlocks: LAG
  });
  return { provider, capability, deployment };
};

const positionCreatedLog = (
  provider: ScriptedProvider,
  overrides: Partial<Record<'status' | 'blockNumber' | 'transactionIndex' | 'logIndex', bigint>> & {
    removed?: boolean;
  } = {}
) => {
  const event = EVENTS.getEvent('PrivateLiquidityPositionCreated');
  if (!event) throw new Error('Missing position-created ABI.');
  const blockNumber = overrides.blockNumber ?? 120n;
  const transactionIndex = overrides.transactionIndex ?? 1n;
  const logIndex = overrides.logIndex ?? 4n;
  const transactionHash = hash('aa');
  const encoded = EVENTS.encodeEventLog(event, [
    7n,
    OWNER,
    PAIR,
    BASE,
    QUOTE,
    [1n, 9n],
    [1n, 11n],
    123n,
    1n
  ]);
  const configured = provider.blocks.get(blockNumber.toString()) ?? {
    hash: blockHash(blockNumber),
    transactions: []
  };
  while (configured.transactions.length <= Number(transactionIndex)) configured.transactions.push(hash('ee'));
  configured.transactions[Number(transactionIndex)] = transactionHash;
  provider.blocks.set(blockNumber.toString(), configured);
  const raw = {
    address: CONTRACT,
    topics: encoded.topics,
    data: encoded.data,
    blockNumber: quantity(blockNumber),
    blockHash: configured.hash,
    transactionHash,
    transactionIndex: quantity(transactionIndex),
    logIndex: quantity(logIndex),
    removed: overrides.removed ?? false
  };
  provider.receipts.set(transactionHash, {
    status: quantity(overrides.status ?? 1n),
    blockNumber: quantity(blockNumber),
    blockHash: configured.hash,
    transactionHash,
    transactionIndex: quantity(transactionIndex),
    logs: [{ ...raw, removed: undefined }]
  });
  return raw;
};

describe('privateLiquidityChain', () => {
  it('attests exact runtime, version, all features, chain, and nonzero finality', async () => {
    const context = await attest();
    expect(context.deployment).toMatchObject({
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      deploymentBlock: DEPLOYMENT_BLOCK.toString(),
      runtimeBytecodeHash: keccak256(CODE),
      contractVersion: 'ChainWhisperPrivateLiquidityBookV1',
      attestationBlock: { number: SAFE_HEAD.toString(), hash: blockHash(SAFE_HEAD) }
    });
    expect(context.deployment.requiredFeatures).toContain('CONTRIBUTOR_COUNT_MAY_LEAK');
    const pinned = context.provider.calls.filter(({ method }) =>
      method === 'eth_getCode' || method === 'eth_call'
    );
    expect(pinned.every(({ params }) => {
      const selector = params[1] as { blockHash?: string; requireCanonical?: boolean };
      return selector.blockHash === blockHash(SAFE_HEAD) && selector.requireCanonical === true;
    })).toBe(true);
  });

  it('owns a bounded complete range and admits only receipt-bound canonical events', async () => {
    const context = await attest();
    const created = positionCreatedLog(context.provider);
    context.provider.logs = [created];
    const receipt = context.provider.receipts.get(created.transactionHash) as { logs: unknown[] };
    receipt.logs.unshift({
      ...created,
      address: BASE,
      topics: [hash('ab'), `0x${'00'.repeat(32)}`],
      data: '0x',
      logIndex: quantity(0n),
      removed: undefined
    });
    const page = await readCanonicalPrivateLiquidityLogRange({
      capability: context.capability,
      deployment: context.deployment,
      fromBlock: 120n,
      toBlock: 123n
    });
    expect(page.range).toEqual({
      fromBlock: '120',
      toBlock: '123',
      fromBlockHash: blockHash(120n),
      toBlockHash: blockHash(123n)
    });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({
      kind: 'position-created',
      positionId: '7',
      positionOwner: OWNER,
      pairKey: PAIR
    });
    expect(() => assertCanonicalPrivateLiquidityLogRange(page)).not.toThrow();
    expect(Object.isFrozen(page.events[0])).toBe(true);
    const query = context.provider.calls.find(({ method }) => method === 'eth_getLogs');
    expect(query?.params[0]).toMatchObject({
      address: CONTRACT,
      fromBlock: '0x78',
      toBlock: '0x7b'
    });
  });

  it('reads exact position availability and terms at one block-hash-pinned safe snapshot', async () => {
    const context = await attest();
    const snapshot = await readCanonicalPrivateLiquidityPositions({
      capability: context.capability,
      deployment: context.deployment,
      positionIds: [7n]
    });
    expect(snapshot.atBlock).toEqual({
      number: SAFE_HEAD.toString(),
      hash: blockHash(SAFE_HEAD)
    });
    expect(snapshot.positions).toEqual([{
      identity: {
        chainId: CHAIN_ID.toString(),
        contractAddress: CONTRACT,
        positionId: '7'
      },
      owner: OWNER,
      pairKey: VIEW_PAIR,
      baseToken: BASE,
      quoteToken: QUOTE,
      buyTerms: { baseAmount: '1', quoteAmount: '9' },
      sellTerms: { baseAmount: '1', quoteAmount: '11' },
      status: 'active',
      revision: '4',
      buySideAvailable: true,
      sellSideAvailable: true,
      privacyOwner: OWNER,
      createdAt: '123',
      lastActivityBlock: '120'
    }]);
    expect(() => assertCanonicalPrivateLiquidityPositionSnapshot(snapshot)).not.toThrow();
    expect(() => assertCanonicalPrivateLiquidityPositionSnapshot({ ...snapshot } as never))
      .toThrow(/provider-owned canonical snapshot/);
    const viewCalls = context.provider.calls.filter(({ method, params }) =>
      method === 'eth_call' &&
      (params[0] as { data?: string }).data?.toLowerCase().startsWith(
        POSITION_VIEWS.getFunction('getPositionView')?.selector.toLowerCase() ?? 'missing'
      )
    );
    expect(viewCalls).toHaveLength(1);
    expect((viewCalls[0].params[1] as { blockHash: string }).blockHash).toBe(blockHash(SAFE_HEAD));
  });

  it('anchors catalog completeness to nextPositionId and composes only exact contiguous batches', async () => {
    const context = await attest();
    context.provider.nextPositionId = 2n;
    const anchor = await readCanonicalPrivateLiquidityCatalogAnchor({
      capability: context.capability,
      deployment: context.deployment
    });
    expect(anchor).toMatchObject({
      atBlock: { number: SAFE_HEAD.toString(), hash: blockHash(SAFE_HEAD) },
      nextPositionId: '2',
      positionCount: '1'
    });
    expect(() => assertCanonicalPrivateLiquidityCatalogAnchor(anchor)).not.toThrow();
    expect(() => assertCanonicalPrivateLiquidityCatalogAnchor({ ...anchor } as never))
      .toThrow(/provider-owned canonical snapshot/);

    const batch = await readCanonicalPrivateLiquidityPositions({
      capability: context.capability,
      deployment: context.deployment,
      positionIds: [1n],
      atBlock: SAFE_HEAD
    });
    const complete = composeCompleteCanonicalPrivateLiquidityPositionSnapshot({
      anchor,
      snapshots: [batch]
    });
    expect(complete.positionCount).toBe('1');
    expect(complete.positions.map(({ identity }) => identity.positionId)).toEqual(['1']);
    expect(() => assertCompleteCanonicalPrivateLiquidityPositionSnapshot(complete)).not.toThrow();
    expect(() => assertCompleteCanonicalPrivateLiquidityPositionSnapshot({ ...complete } as never))
      .toThrow(/complete canonical/);

    context.provider.nextPositionId = 3n;
    const largerAnchor = await readCanonicalPrivateLiquidityCatalogAnchor({
      capability: context.capability,
      deployment: context.deployment
    });
    expect(() => composeCompleteCanonicalPrivateLiquidityPositionSnapshot({
      anchor: largerAnchor,
      snapshots: [batch]
    })).toThrow(/do not cover the complete catalog/);
  });

  it('rejects duplicate, zero, oversized, and above-safe-head position view requests', async () => {
    const context = await attest();
    await expect(readCanonicalPrivateLiquidityPositions({
      capability: context.capability,
      deployment: context.deployment,
      positionIds: [7n, 7n]
    })).rejects.toThrow(/positive and unique/);
    await expect(readCanonicalPrivateLiquidityPositions({
      capability: context.capability,
      deployment: context.deployment,
      positionIds: [0n]
    })).rejects.toThrow(/positive and unique/);
    await expect(readCanonicalPrivateLiquidityPositions({
      capability: context.capability,
      deployment: context.deployment,
      positionIds: Array.from({ length: 129 }, (_, index) => BigInt(index + 1))
    })).rejects.toThrow(/between 1 and 128/);
    await expect(readCanonicalPrivateLiquidityPositions({
      capability: context.capability,
      deployment: context.deployment,
      positionIds: [7n],
      atBlock: SAFE_HEAD + 1n
    })).rejects.toThrow(/outside the attested safe range/);
  });

  it('fails attestation on runtime, version, feature, app-wallet, and finality mismatches', async () => {
    const runtime = new ScriptedProvider();
    runtime.code = '0x6002600055';
    await expect(attest(runtime)).rejects.toThrow(/runtime/);

    const version = new ScriptedProvider();
    version.version = 'SpoofedLiquidityBook';
    await expect(attest(version)).rejects.toThrow(/version/);

    const feature = new ScriptedProvider();
    feature.unsupportedFeatures.add(keccak256(toUtf8Bytes('POSITION_NFTS')).toLowerCase());
    await expect(attest(feature)).rejects.toThrow(/POSITION_NFTS/);

    const appWallet = new ScriptedProvider();
    appWallet.appWalletExecutor = true;
    await expect(attest(appWallet)).rejects.toThrow(/app-wallet/);

    const provider = new ScriptedProvider();
    const capability = await bind(provider);
    await expect(attestPrivateLiquidityDeployment({
      capability,
      manifest: MANIFEST,
      finalityLagBlocks: 0n
    })).rejects.toThrow(/non-zero/);
  });

  it('rejects removed, failed, duplicate, and receipt-mismatched logs', async () => {
    const removed = await attest();
    removed.provider.logs = [positionCreatedLog(removed.provider, { removed: true })];
    await expect(readCanonicalPrivateLiquidityLogRange({
      capability: removed.capability,
      deployment: removed.deployment,
      fromBlock: 120n,
      toBlock: 123n
    })).rejects.toThrow(/removed/i);

    const failed = await attest();
    failed.provider.logs = [positionCreatedLog(failed.provider, { status: 0n })];
    await expect(readCanonicalPrivateLiquidityLogRange({
      capability: failed.capability,
      deployment: failed.deployment,
      fromBlock: 120n,
      toBlock: 123n
    })).rejects.toThrow(/unsuccessful/);

    const duplicate = await attest();
    const raw = positionCreatedLog(duplicate.provider);
    duplicate.provider.logs = [raw, raw];
    await expect(readCanonicalPrivateLiquidityLogRange({
      capability: duplicate.capability,
      deployment: duplicate.deployment,
      fromBlock: 120n,
      toBlock: 123n
    })).rejects.toThrow(/duplicate physical/);

    const mismatch = await attest();
    const valid = positionCreatedLog(mismatch.provider);
    mismatch.provider.receipts.get(valid.transactionHash)!.logs = [{ ...valid, data: '0x' }];
    mismatch.provider.logs = [valid];
    await expect(readCanonicalPrivateLiquidityLogRange({
      capability: mismatch.capability,
      deployment: mismatch.deployment,
      fromBlock: 120n,
      toBlock: 123n
    })).rejects.toThrow(/exactly match/);
  });

  it('rejects forged capabilities, deployments, and canonical pages', async () => {
    const context = await attest();
    await expect(readCanonicalPrivateLiquidityLogRange({
      capability: Object.freeze({}) as PrivateLiquidityReadCapability,
      deployment: context.deployment,
      fromBlock: 120n,
      toBlock: 123n
    })).rejects.toThrow(/exact current/);
    await expect(readCanonicalPrivateLiquidityLogRange({
      capability: context.capability,
      deployment: { ...context.deployment } as AttestedPrivateLiquidityDeployment,
      fromBlock: 120n,
      toBlock: 123n
    })).rejects.toThrow(/not attested/);
    expect(() => assertCanonicalPrivateLiquidityLogRange({} as never)).toThrow(/provider-owned/);
  });

  it('rejects ranges before deployment, above safe head, and above the cap', async () => {
    const context = await attest();
    await expect(readCanonicalPrivateLiquidityLogRange({
      capability: context.capability,
      deployment: context.deployment,
      fromBlock: 99n,
      toBlock: 100n
    })).rejects.toThrow(/predates/);
    await expect(readCanonicalPrivateLiquidityLogRange({
      capability: context.capability,
      deployment: context.deployment,
      fromBlock: 145n,
      toBlock: 146n
    })).rejects.toThrow(/above the safe head/);
    await expect(readCanonicalPrivateLiquidityLogRange({
      capability: context.capability,
      deployment: context.deployment,
      fromBlock: 100n,
      toBlock: 2_148n
    })).rejects.toThrow(/bounded/);
  });

  it('fails closed if the deployment attestation block is reorganized', async () => {
    const provider = new ScriptedProvider();
    const capability = await bind(provider);
    const deployment = await attestPrivateLiquidityDeployment({
      capability,
      manifest: MANIFEST,
      finalityLagBlocks: LAG
    });
    provider.reorgAttestation = true;
    await expect(readCanonicalPrivateLiquidityLogRange({
      capability,
      deployment,
      fromBlock: 120n,
      toBlock: 123n
    })).rejects.toThrow(/attestation block was reorganized/);
  });

  it('captures provider request and rechecks the supplied lease across RPC work', async () => {
    const provider = new ScriptedProvider();
    const assertCurrent = vi.fn(async () => undefined);
    const capability = await bind(provider, assertCurrent);
    const captured = provider.request;
    provider.request = async () => { throw new Error('replacement must not be used'); };
    await expect(attestPrivateLiquidityDeployment({
      capability,
      manifest: MANIFEST,
      finalityLagBlocks: LAG
    })).resolves.toBeDefined();
    expect(provider.request).not.toBe(captured);
    expect(assertCurrent.mock.calls.length).toBeGreaterThan(10);
  });
});
