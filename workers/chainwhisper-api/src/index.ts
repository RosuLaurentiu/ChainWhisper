import { createChainWhisperApiHandler } from './handler';
import { DEFAULT_CARBON_API_URL, DEFAULT_COTI_RPC_URL } from './registry';
import { HttpContractReader } from './rpc';
import { LiveApiSource } from './source';
import { ManifestPrivateLiquidityV2ApiSource } from './privateLiquidityV2';
import { ManifestPrivateLiquidityDailyPriceApiSource } from './privateLiquidityDailyPrice';
import { ManifestTestnetRegistryV2ApiSource } from './testnetRegistryV2';

type Env = {
  COTI_RPC_URL?: string;
  CARBON_API_BASE_URL?: string;
  CHAINWHISPER_TESTNET_CANDIDATE_MANIFEST_JSON?: string;
  CHAINWHISPER_TESTNET_PRIVATE_LIQUIDITY_ANALYTICS_MANIFEST_JSON?: string;
  CHAINWHISPER_TESTNET_RPC_URL?: string;
  QUOTE_RATE_LIMITER: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
};

let cached:
  | {
      key: string;
      handler: (request: Request) => Promise<Response>;
    }
  | undefined;

const handlerFor = (env: Env) => {
  const rpcUrl = env.COTI_RPC_URL?.trim() || DEFAULT_COTI_RPC_URL;
  const carbonApiUrl = env.CARBON_API_BASE_URL?.trim() || DEFAULT_CARBON_API_URL;
  const testnetManifest = env.CHAINWHISPER_TESTNET_CANDIDATE_MANIFEST_JSON?.trim() || '';
  const analyticsManifest =
    env.CHAINWHISPER_TESTNET_PRIVATE_LIQUIDITY_ANALYTICS_MANIFEST_JSON?.trim() || '';
  const testnetRpcUrl = env.CHAINWHISPER_TESTNET_RPC_URL?.trim() || '';
  const key = `${rpcUrl}\n${carbonApiUrl}\n${testnetRpcUrl}\n${testnetManifest}\n${analyticsManifest}`;
  if (!cached || cached.key !== key) {
    const source = new LiveApiSource({
      rpc: new HttpContractReader(rpcUrl),
      carbonApiUrl
    });
    const privateLiquidityV2Source = testnetManifest && testnetRpcUrl
      ? new ManifestPrivateLiquidityV2ApiSource({
          manifestJson: testnetManifest,
          rpc: new HttpContractReader(testnetRpcUrl)
        })
      : undefined;
    const privateLiquidityDailyPriceSource =
      testnetManifest && analyticsManifest && testnetRpcUrl
        ? new ManifestPrivateLiquidityDailyPriceApiSource({
            analyticsManifestJson: analyticsManifest,
            candidateManifestJson: testnetManifest,
            rpc: new HttpContractReader(testnetRpcUrl)
          })
        : undefined;
    const testnetRegistryV2Source = testnetManifest && testnetRpcUrl
      ? new ManifestTestnetRegistryV2ApiSource({
          manifestJson: testnetManifest,
          rpc: new HttpContractReader(testnetRpcUrl)
        })
      : undefined;
    cached = {
      key,
      handler: createChainWhisperApiHandler(
        source,
        env.QUOTE_RATE_LIMITER,
        privateLiquidityV2Source,
        privateLiquidityDailyPriceSource,
        testnetRegistryV2Source
      )
    };
  }
  return cached.handler;
};

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handlerFor(env)(request);
  }
};
