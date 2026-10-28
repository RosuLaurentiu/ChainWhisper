import { describe, expect, it } from 'vitest';
import { keccak256, toHex, type Hex } from 'viem';
import {
  TESTNET_CANDIDATE_COMPONENT_CONTRACTS,
  parsePrivateLiquidityV2ApiManifest
} from '../src/privateLiquidityV2';
import type { ContractReader } from '../src/rpc';
import {
  ManifestTestnetRegistryV2ApiSource,
  TESTNET_COMPONENT_EVENT_POLICIES
} from '../src/testnetRegistryV2';

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]));
};

const fixture = () => {
  const codes = new Map<string, Hex>();
  const components = Object.entries(TESTNET_CANDIDATE_COMPONENT_CONTRACTS)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, contract], index) => {
      const address = `0x${(index + 1).toString(16).padStart(40, '0')}`;
      const code = `0x60${(index + 1).toString(16).padStart(2, '0')}` as Hex;
      codes.set(address.toLowerCase(), code);
      return {
        key,
        contract,
        address,
        runtimeBytecodeHash: keccak256(code),
        deploymentBlock: String(80 + index)
      };
    });
  const byKey = new Map(components.map((item) => [item.key, item]));
  const body = {
    schemaVersion: 1,
    status: 'attested-testnet-candidate-not-app-active',
    network: 'cotiTestnet',
    chainId: '7082400',
    owner: '0x1111111111111111111111111111111111111111',
    attestationBlock: { number: '100', hash: keccak256(toHex('block:100')) },
    components,
    relationships: {
      chatReactionsV1: {
        directChatV2: byKey.get('directChatV2')!.address,
        groupChatV2: byKey.get('groupChatV2')!.address
      },
      tokenAdmissionOperations: 16,
      appActivated: false
    }
  };
  return {
    codes,
    text: JSON.stringify({
      ...body,
      manifestHash: keccak256(toHex(JSON.stringify(canonicalize(body))))
    })
  };
};

class RegistryRpc implements ContractReader {
  readonly methods = new Set<string>();
  #safeReads = 0;

  constructor(
    readonly codes: Map<string, Hex>,
    readonly options: {
      wrongChain?: boolean;
      runtimeMismatch?: boolean;
      reorgSafeHead?: boolean;
      rpcOutage?: boolean;
    } = {}
  ) {}

  async readContract(): Promise<unknown> {
    throw new Error('Registry attestation must use block-hash-pinned raw RPC reads.');
  }

  async request<T>(method: string, params: readonly unknown[]): Promise<T> {
    this.methods.add(method);
    if (method === 'eth_chainId') return (this.options.wrongChain ? '0x1' : '0x6c11a0') as T;
    if (this.options.rpcOutage && method === 'eth_blockNumber') {
      throw new Error('sensitive RPC host detail');
    }
    if (method === 'eth_blockNumber') return '0x6e' as T;
    if (method === 'eth_getBlockByNumber') {
      const number = BigInt(String(params[0]));
      if (number === 105n) this.#safeReads += 1;
      const reorged = number === 105n && this.options.reorgSafeHead && this.#safeReads > 1;
      return {
        number: toHex(number),
        hash: keccak256(toHex(reorged ? `reorg:${number}` : `block:${number}`)),
        timestamp: toHex(1_800_000_000n + number)
      } as T;
    }
    if (method === 'eth_getCode') {
      const block = params[1] as { blockHash?: Hex } | undefined;
      if (this.options.runtimeMismatch && block?.blockHash === keccak256(toHex('block:105'))) {
        return '0x6000' as T;
      }
      return (this.codes.get(String(params[0]).toLowerCase()) ?? '0x') as T;
    }
    throw new Error(`Unexpected RPC method ${method}.`);
  }
}

describe('manifest-attested V2 Worker registry', () => {
  it('returns all 15 exact components and only classifications, never event/private data', async () => {
    const input = fixture();
    const manifest = parsePrivateLiquidityV2ApiManifest(input.text);
    const rpc = new RegistryRpc(input.codes);
    const registry = await new ManifestTestnetRegistryV2ApiSource({
      manifestJson: input.text,
      rpc,
      finalityLagBlocks: 5n
    }).getRegistry();

    expect(registry).toMatchObject({
      protocol: 'ChainWhisperTestnetRegistryV2',
      schemaVersion: 1,
      network: 'COTI Testnet',
      chainId: 7_082_400,
      manifestHash: manifest.manifestHash,
      complete: true,
      privacyBoundary: {
        eventDataReturned: false,
        ciphertextReturned: false,
        privateAmountsReturned: false,
        participantReceiptsReturned: false,
        hiddenIntentIdentifiersReturned: false,
        walletActivityReturned: false
      }
    });
    expect(registry.components).toHaveLength(15);
    expect(registry.components.map(({ key }) => key)).toEqual(
      Object.keys(TESTNET_CANDIDATE_COMPONENT_CONTRACTS).sort()
    );
    expect(registry.components.find(({ key }) => key === 'directOtcV2')?.events)
      .toEqual(TESTNET_COMPONENT_EVENT_POLICIES.directOtcV2.events);
    expect(registry.notificationPolicy).toEqual({
      incomingDirectTradesAndCounters: {
        componentKey: 'directOtcV2',
        eventName: 'DirectTradeOpened',
        recipientField: 'taker',
        counterWhenParentTradeIdNonzero: true
      },
      otherTradingEvents: 'none'
    });
    expect(rpc.methods).toEqual(new Set([
      'eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_blockNumber'
    ]));
    const serialized = JSON.stringify(registry);
    for (const forbidden of [
      'ciphertext', 'privateAmount', 'inventoryAmount', 'intentId', 'walletActivity',
      'eventData', 'transactionHash', 'logIndex'
    ]) expect(serialized).not.toMatch(new RegExp(`"${forbidden}":`, 'u'));
  });

  it('classifies every known event exactly once per component', () => {
    for (const policy of Object.values(TESTNET_COMPONENT_EVENT_POLICIES)) {
      const classified = [
        ...policy.events.publicIndexable,
        ...policy.events.encryptedContentNotReturned,
        ...policy.events.participantEncryptedNotReturned,
        ...policy.events.catalogOnlyNotReturned
      ];
      expect(new Set(classified).size).toBe(classified.length);
      expect(policy.events.incomingDirectTradeNotification.every((name) =>
        policy.events.publicIndexable.includes(name)
      )).toBe(true);
    }
  });

  it.each([
    ['wrong chain', { wrongChain: true }],
    ['runtime drift', { runtimeMismatch: true }],
    ['safe-head reorg', { reorgSafeHead: true }],
    ['RPC outage', { rpcOutage: true }]
  ] as const)('fails closed on %s', async (_label, options) => {
    const input = fixture();
    const source = new ManifestTestnetRegistryV2ApiSource({
      manifestJson: input.text,
      rpc: new RegistryRpc(input.codes, options),
      finalityLagBlocks: 5n
    });
    await expect(source.getRegistry()).rejects.toThrow();
  });

  it('rejects zero or excessive finality policy before reading the chain', () => {
    const input = fixture();
    const rpc = new RegistryRpc(input.codes);
    expect(() => new ManifestTestnetRegistryV2ApiSource({
      manifestJson: input.text,
      rpc,
      finalityLagBlocks: 0n
    })).toThrow('invalid registry finality lag');
    expect(() => new ManifestTestnetRegistryV2ApiSource({
      manifestJson: input.text,
      rpc,
      finalityLagBlocks: 4_097n
    })).toThrow('invalid registry finality lag');
  });
});
