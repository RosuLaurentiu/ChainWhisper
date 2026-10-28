import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, keccak256, parseAbiParameters, type Address } from 'viem';
import { createChainWhisperApiHandler } from '../src/handler';
import { API_BASE_PATH } from '../src/openapi';
import { ManifestPrivateLiquidityDailyPriceApiSource } from '../src/privateLiquidityDailyPrice';
import { HttpContractReader, type ContractReader } from '../src/rpc';
import type { ChainWhisperApiSource } from '../src/types';

const LIVE = process.env.CHAINWHISPER_LIVE_TESTNET_ANALYTICS_READONLY === 'true';
const ALLOWED_RPC_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getTransactionReceipt',
  'eth_call'
]);

class ReadOnlyAnalyticsReader implements ContractReader {
  readonly #reader: HttpContractReader;
  readonly methods = new Set<string>();

  constructor(url: string) {
    this.#reader = new HttpContractReader(url, fetch, 30_000);
  }

  async request<T>(method: string, params: readonly unknown[]): Promise<T> {
    if (!ALLOWED_RPC_METHODS.has(method)) {
      throw new Error(`Live analytics smoke refused non-read RPC method ${method}.`);
    }
    this.methods.add(method);
    return this.#reader.request<T>(method, params);
  }

  async readContract(input: Parameters<ContractReader['readContract']>[0]): Promise<unknown> {
    throw new Error(`Live analytics smoke refused unpinned readContract call to ${input.address}.`);
  }
}

const pairKeyFor = (left: Address, right: Address): `0x${string}` => {
  const [baseToken, quoteToken] = [left, right]
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())) as [Address, Address];
  return keccak256(encodeAbiParameters(
    parseAbiParameters('address baseToken,address quoteToken'),
    [baseToken, quoteToken]
  ));
};

describe.skipIf(!LIVE)('live read-only Private Liquidity daily-price API', () => {
  it('serves the attested bounded daily history without invoking a write RPC', async () => {
    const candidatePath = process.env.CHAINWHISPER_TESTNET_CANDIDATE_MANIFEST_PATH;
    const analyticsPath = process.env.CHAINWHISPER_TESTNET_PRIVATE_LIQUIDITY_ANALYTICS_MANIFEST_PATH;
    const rpcUrl = process.env.CHAINWHISPER_TESTNET_RPC_URL;
    expect(candidatePath?.trim()).toBe(candidatePath);
    expect(analyticsPath?.trim()).toBe(analyticsPath);
    expect(rpcUrl?.trim()).toBe(rpcUrl);
    expect(candidatePath).toBeTruthy();
    expect(analyticsPath).toBeTruthy();
    expect(rpcUrl).toBeTruthy();

    const candidateJson = await readFile(resolve(candidatePath!), 'utf8');
    const analyticsJson = await readFile(resolve(analyticsPath!), 'utf8');
    const candidate = JSON.parse(candidateJson) as {
      components: Array<{ key: string; address: Address }>;
    };
    const analytics = JSON.parse(analyticsJson) as {
      manifestHash: string;
      address: string;
      sourceBook: string;
    };
    const privateTokens = candidate.components
      .filter(({ key }) => key === 'privateTestTokenA' || key === 'privateTestTokenB')
      .map(({ address }) => address);
    expect(privateTokens).toHaveLength(2);
    const pairKey = pairKeyFor(privateTokens[0]!, privateTokens[1]!);

    const rpc = new ReadOnlyAnalyticsReader(rpcUrl!);
    const source = new ManifestPrivateLiquidityDailyPriceApiSource({
      analyticsManifestJson: analyticsJson,
      candidateManifestJson: candidateJson,
      rpc,
      finalityLagBlocks: 5n
    });
    const handler = createChainWhisperApiHandler(
      {} as ChainWhisperApiSource,
      undefined,
      undefined,
      source
    );
    const response = await handler(new Request(
      `https://api.chainwhisper.chat${API_BASE_PATH}/testnet/private-liquidity/daily-prices?pairKey=${pairKey}&limit=90`
    ));
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      protocol: 'ChainWhisperPrivateLiquidityDailyPriceStoreV1',
      network: 'COTI Testnet',
      chainId: 7_082_400,
      analyticsManifestHash: analytics.manifestHash,
      storeAddress: analytics.address,
      sourceBook: analytics.sourceBook,
      pairKey,
      completeRange: true,
      privacyBoundary: {
        publicFields: ['daily-marginal-price', 'utc-day', 'source-provenance'],
        excluded: ['liquidity-depth', 'inventory', 'traded-amounts', 'volume', 'participants'],
        recorderReplayVerifiedByApi: false
      }
    });
    expect(Array.isArray(body.points)).toBe(true);
    expect(rpc.methods).toEqual(ALLOWED_RPC_METHODS);
    expect(JSON.stringify(body)).not.toMatch(/"(?:owner|recorder)"|liquidityDepth|inventoryAmount|tradedAmount/iu);
  }, 120_000);
});
