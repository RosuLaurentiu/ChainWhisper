import { Interface, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import {
  PRIVATE_LIQUIDITY_V2_BOOK_FEATURES,
  PRIVATE_LIQUIDITY_V2_BOOK_VERSION,
  PRIVATE_LIQUIDITY_V2_MODULE_VERSION,
  PRIVATE_LIQUIDITY_V2_POSITION_TOKEN_FEATURES,
  PRIVATE_LIQUIDITY_V2_POSITION_TOKEN_VERSION,
  assertAttestedPrivateLiquidityV2Deployment,
  attestPrivateLiquidityV2Deployment,
  bindPrivateLiquidityV2ReadCapability,
  type AttestedPrivateLiquidityV2Deployment
} from './privateLiquidityV2Chain';
import type { PrivateLiquidityV2Manifest } from './privateLiquidityV2Deployment';
import {
  adoptAttestedPrivateLiquidityV2Book,
  assertAttestedPrivateLiquidityDeployment,
  bindPrivateLiquidityReadCapability
} from './privateLiquidityChain';

const ABI = new Interface([
  'function contractVersion() view returns (string)',
  'function moduleVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)',
  'function positionToken() view returns (address)',
  'function hiddenIntentModule() view returns (address)',
  'function hiddenIntentModuleRuntimeHash() view returns (bytes32)',
  'function positionBook() view returns (address)',
  'function intendedBook() view returns (address)',
  'function intendedPositionToken() view returns (address)',
  'function moduleSelf() view returns (address)'
]);

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const blockHash = (number: bigint): string => `0x${number.toString(16).padStart(64, '0')}`;
const quantity = (number: bigint): string => `0x${number.toString(16)}`;

const BOOK = address('11');
const MODULE = address('22');
const POSITION = address('33');
const BOOK_CODE = '0x6001600055';
const MODULE_CODE = '0x6002600055';
const POSITION_CODE = '0x6003600055';
const BOOK_TX = blockHash(1001n);
const MODULE_TX = blockHash(1002n);

const manifest: PrivateLiquidityV2Manifest = Object.freeze({
  chainId: '7082400',
  book: Object.freeze({
    address: BOOK,
    deploymentBlock: '125',
    deploymentBlockHash: blockHash(125n),
    creationTransactionHash: BOOK_TX,
    runtimeBytecodeHash: keccak256(BOOK_CODE).toLowerCase()
  }),
  hiddenIntentModule: Object.freeze({
    address: MODULE,
    deploymentBlock: '123',
    deploymentBlockHash: blockHash(123n),
    creationTransactionHash: MODULE_TX,
    runtimeBytecodeHash: keccak256(MODULE_CODE).toLowerCase()
  }),
  positionToken: Object.freeze({
    address: POSITION,
    deploymentBlock: '125',
    deploymentBlockHash: blockHash(125n),
    creationTransactionHash: BOOK_TX,
    runtimeBytecodeHash: keccak256(POSITION_CODE).toLowerCase()
  })
});

type FakeOptions = Readonly<{
  wrongBinding?: boolean;
  missingFeature?: string;
  wrongReceipt?: boolean;
  chainId?: bigint;
}>;

const fakeProvider = (options: FakeOptions = {}) => {
  const codeByAddress = new Map([
    [BOOK.toLowerCase(), BOOK_CODE],
    [MODULE.toLowerCase(), MODULE_CODE],
    [POSITION.toLowerCase(), POSITION_CODE]
  ]);
  const numberByHash = new Map<unknown, bigint>();
  for (let number = 0n; number <= 130n; number += 1n) numberByHash.set(blockHash(number), number);
  const missingFeatureHash = options.missingFeature
    ? keccak256(toUtf8Bytes(options.missingFeature)).toLowerCase()
    : null;

  return {
    request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
      if (method === 'eth_chainId') return quantity(options.chainId ?? 7082400n);
      if (method === 'eth_blockNumber') return quantity(130n);
      if (method === 'eth_getBlockByNumber') {
        const number = BigInt(String(params[0]));
        return { number: quantity(number), hash: blockHash(number), transactions: [] };
      }
      if (method === 'eth_getCode') {
        const contractAddress = String(params[0]).toLowerCase();
        const tag = params[1] as { blockHash?: unknown };
        const number = numberByHash.get(tag?.blockHash);
        if (number === undefined) throw new Error('unknown block');
        return codeByAddress.get(contractAddress) ?? '0x';
      }
      if (method === 'eth_getTransactionReceipt') {
        const transactionHash = String(params[0]).toLowerCase();
        const isBook = transactionHash === BOOK_TX;
        const isModule = transactionHash === MODULE_TX;
        if (!isBook && !isModule) return null;
        const number = isBook ? 125n : 123n;
        return {
          transactionHash,
          blockNumber: quantity(number),
          blockHash: options.wrongReceipt ? blockHash(number - 1n) : blockHash(number),
          status: '0x1',
          contractAddress: isBook ? BOOK : MODULE
        };
      }
      if (method === 'eth_call') {
        const call = params[0] as { to?: string; data?: string };
        const target = String(call.to).toLowerCase();
        const parsed = ABI.parseTransaction({ data: String(call.data) });
        if (!parsed) throw new Error('unknown call');
        let value: unknown;
        if (parsed.name === 'contractVersion') {
          value = target === BOOK.toLowerCase()
            ? PRIVATE_LIQUIDITY_V2_BOOK_VERSION
            : PRIVATE_LIQUIDITY_V2_POSITION_TOKEN_VERSION;
        } else if (parsed.name === 'moduleVersion') {
          value = PRIVATE_LIQUIDITY_V2_MODULE_VERSION;
        } else if (parsed.name === 'supportsFeature') {
          const featureHash = String(parsed.args[0]).toLowerCase();
          value = featureHash !== keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR')).toLowerCase() &&
            featureHash !== missingFeatureHash;
        } else if (parsed.name === 'positionToken') {
          value = POSITION;
        } else if (parsed.name === 'hiddenIntentModule') {
          value = MODULE;
        } else if (parsed.name === 'hiddenIntentModuleRuntimeHash') {
          value = manifest.hiddenIntentModule.runtimeBytecodeHash;
        } else if (parsed.name === 'positionBook' || parsed.name === 'intendedBook') {
          value = options.wrongBinding ? address('44') : BOOK;
        } else if (parsed.name === 'intendedPositionToken') {
          value = POSITION;
        } else if (parsed.name === 'moduleSelf') {
          value = MODULE;
        } else {
          throw new Error('unsupported getter');
        }
        return ABI.encodeFunctionResult(parsed.name, [value]);
      }
      throw new Error(`unsupported RPC ${method}`);
    }
  };
};

const attest = async (options: FakeOptions = {}) => {
  const capability = await bindPrivateLiquidityV2ReadCapability({
    provider: fakeProvider(options),
    expectedChainId: 7082400n,
    assertCurrent: () => {}
  });
  return attestPrivateLiquidityV2Deployment({
    capability,
    manifest,
    finalityLagBlocks: 5n
  });
};

describe('privateLiquidityV2Chain', () => {
  it('attests all three runtimes, versions, features, and immutable relationships', async () => {
    const deployment = await attest();
    expect(deployment).toMatchObject({
      manifest,
      bookVersion: PRIVATE_LIQUIDITY_V2_BOOK_VERSION,
      moduleVersion: PRIVATE_LIQUIDITY_V2_MODULE_VERSION,
      positionTokenVersion: PRIVATE_LIQUIDITY_V2_POSITION_TOKEN_VERSION,
      bookFeatures: PRIVATE_LIQUIDITY_V2_BOOK_FEATURES,
      positionTokenFeatures: PRIVATE_LIQUIDITY_V2_POSITION_TOKEN_FEATURES,
      finalityLagBlocks: '5',
      attestationBlock: { number: '125', hash: blockHash(125n) }
    });
    expect(assertAttestedPrivateLiquidityV2Deployment(deployment)).toBe(deployment);
    expect(Object.isFrozen(deployment.manifest.hiddenIntentModule)).toBe(true);
  });

  it('rejects a structural fake instead of trusting an environment-shaped object', () => {
    expect(() => assertAttestedPrivateLiquidityV2Deployment({
      manifest,
      bookVersion: PRIVATE_LIQUIDITY_V2_BOOK_VERSION
    } as AttestedPrivateLiquidityV2Deployment)).toThrow(/exact attester/);
  });

  it('projects only the exact V2-attested Book into the inherited position reader', async () => {
    const provider = fakeProvider();
    const [v2Capability, positionCapability] = await Promise.all([
      bindPrivateLiquidityV2ReadCapability({
        provider,
        expectedChainId: 7082400n,
        assertCurrent: () => {}
      }),
      bindPrivateLiquidityReadCapability({
        provider,
        expectedChainId: 7082400n,
        assertCurrent: () => {}
      })
    ]);
    const v2Deployment = await attestPrivateLiquidityV2Deployment({
      capability: v2Capability,
      manifest,
      finalityLagBlocks: 5n
    });
    const projected = await adoptAttestedPrivateLiquidityV2Book({
      capability: positionCapability,
      deployment: v2Deployment
    });

    expect(projected).toMatchObject({
      chainId: '7082400',
      contractAddress: BOOK.toLowerCase(),
      deploymentBlock: '125',
      runtimeBytecodeHash: manifest.book.runtimeBytecodeHash,
      contractVersion: PRIVATE_LIQUIDITY_V2_BOOK_VERSION,
      finalityLagBlocks: '5',
      attestationBlock: { number: '125', hash: blockHash(125n) }
    });
    expect(() => assertAttestedPrivateLiquidityDeployment(projected)).not.toThrow();
    await expect(adoptAttestedPrivateLiquidityV2Book({
      capability: positionCapability,
      deployment: { ...v2Deployment } as AttestedPrivateLiquidityV2Deployment
    })).rejects.toThrow(/exact attester/);
  });

  it('fails closed when an immutable component relationship is wrong', async () => {
    await expect(attest({ wrongBinding: true })).rejects.toThrow(/bindings are inconsistent/);
  });

  it('fails closed when a required feature is absent', async () => {
    await expect(attest({ missingFeature: 'COMPLETE_BOUNDED_HIDDEN_ROUTES' }))
      .rejects.toThrow(/missing COMPLETE_BOUNDED_HIDDEN_ROUTES/);
  });

  it('proves exact creation transaction and canonical deployment-block provenance', async () => {
    await expect(attest({ wrongReceipt: true })).rejects.toThrow(/creation receipt differs/);
  });

  it('refuses a read capability on another chain', async () => {
    await expect(bindPrivateLiquidityV2ReadCapability({
      provider: fakeProvider({ chainId: 2632500n }),
      expectedChainId: 7082400n,
      assertCurrent: () => {}
    })).rejects.toThrow(/chain changed/);
  });
});
