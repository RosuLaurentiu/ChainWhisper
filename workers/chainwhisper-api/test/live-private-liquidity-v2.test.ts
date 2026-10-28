import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createChainWhisperApiHandler } from '../src/handler';
import { API_BASE_PATH } from '../src/openapi';
import { ManifestPrivateLiquidityV2ApiSource } from '../src/privateLiquidityV2';
import { HttpContractReader, type ContractReader } from '../src/rpc';
import { ManifestTestnetRegistryV2ApiSource } from '../src/testnetRegistryV2';
import type { ChainWhisperApiSource } from '../src/types';

const LIVE = process.env.CHAINWHISPER_LIVE_TESTNET_API_READONLY === 'true';
const ALLOWED_RPC_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_call'
]);

class ReadOnlyLiveReader implements ContractReader {
  readonly #reader: HttpContractReader;
  readonly methods = new Set<string>();

  constructor(url: string) {
    this.#reader = new HttpContractReader(url, fetch, 30_000);
  }

  async request<T>(method: string, params: readonly unknown[]): Promise<T> {
    if (!ALLOWED_RPC_METHODS.has(method)) {
      throw new Error(`Live API smoke refused non-read RPC method ${method}.`);
    }
    this.methods.add(method);
    return this.#reader.request<T>(method, params);
  }

  async readContract(input: Parameters<ContractReader['readContract']>[0]): Promise<unknown> {
    throw new Error(`Live API smoke refused unpinned readContract call to ${input.address}.`);
  }
}

const assertPrivacyBoundary = (value: unknown): void => {
  const text = JSON.stringify(value);
  for (const forbidden of [
    'baseInventory',
    'quoteInventory',
    'hiddenSide',
    'limitBase',
    'limitQuote',
    'budget',
    'minimumFill',
    'intentId',
    'selectedIntentId',
    'targetIntentId'
  ]) {
    expect(text).not.toContain(`"${forbidden}"`);
  }
};

describe.skipIf(!LIVE)('live read-only Private Liquidity V2 API', () => {
  it('serves the exact canonical amount-free testnet pair without invoking a write RPC', async () => {
    const manifestPath = process.env.CHAINWHISPER_TESTNET_CANDIDATE_MANIFEST_PATH;
    const rpcUrl = process.env.CHAINWHISPER_TESTNET_RPC_URL;
    expect(manifestPath?.trim()).toBe(manifestPath);
    expect(rpcUrl?.trim()).toBe(rpcUrl);
    expect(manifestPath).toBeTruthy();
    expect(rpcUrl).toBeTruthy();

    const manifestJson = await readFile(resolve(manifestPath!), 'utf8');
    const manifest = JSON.parse(manifestJson) as {
      manifestHash: string;
      components: Array<{ key: string; address: string }>;
    };
    const book = manifest.components.find(({ key }) => key === 'privateLiquidityBookV2');
    expect(book).toBeDefined();

    const rpc = new ReadOnlyLiveReader(rpcUrl!);
    const source = new ManifestPrivateLiquidityV2ApiSource({
      manifestJson,
      rpc,
      finalityLagBlocks: 5n
    });
    const registrySource = new ManifestTestnetRegistryV2ApiSource({
      manifestJson,
      rpc,
      finalityLagBlocks: 5n
    });
    const handler = createChainWhisperApiHandler(
      {} as ChainWhisperApiSource,
      undefined,
      source,
      undefined,
      registrySource
    );
    const registryResponse = await handler(new Request(
      `https://api.chainwhisper.chat${API_BASE_PATH}/testnet/registry-v2`
    ));
    expect(registryResponse.status).toBe(200);
    const registry = await registryResponse.json() as Record<string, unknown>;
    expect(registry).toMatchObject({
      protocol: 'ChainWhisperTestnetRegistryV2',
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
    });
    expect((registry.components as unknown[]).length).toBe(15);
    assertPrivacyBoundary(registry);
    const response = await handler(new Request(
      `https://api.chainwhisper.chat${API_BASE_PATH}/testnet/private-liquidity/pair`
    ));
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      protocol: 'PrivateLiquidityV2',
      network: 'COTI Testnet',
      chainId: 7_082_400,
      manifestHash: manifest.manifestHash,
      contractAddress: book!.address,
      complete: true,
      privacyBoundary: {
        inventory: 'not-returned',
        hiddenIntentTerms: 'not-returned',
        hiddenIntentSelection: 'contract-selected-only'
      }
    });
    expect(Array.isArray(body.positions)).toBe(true);
    expect(body.askRoute).toBeTypeOf('object');
    expect(body.bidRoute).toBeTypeOf('object');
    expect(rpc.methods).toEqual(ALLOWED_RPC_METHODS);
    assertPrivacyBoundary(body);
  }, 120_000);
});
