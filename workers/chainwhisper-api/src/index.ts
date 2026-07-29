import { createChainWhisperApiHandler } from './handler';
import { DEFAULT_CARBON_API_URL, DEFAULT_COTI_RPC_URL } from './registry';
import { HttpContractReader } from './rpc';
import { LiveApiSource } from './source';

type Env = {
  COTI_RPC_URL?: string;
  CARBON_API_BASE_URL?: string;
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
  const key = `${rpcUrl}\n${carbonApiUrl}`;
  if (!cached || cached.key !== key) {
    const source = new LiveApiSource({
      rpc: new HttpContractReader(rpcUrl),
      carbonApiUrl
    });
    cached = {
      key,
      handler: createChainWhisperApiHandler(source, env.QUOTE_RATE_LIMITER)
    };
  }
  return cached.handler;
};

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handlerFor(env)(request);
  }
};
