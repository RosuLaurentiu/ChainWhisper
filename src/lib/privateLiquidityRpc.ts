import type { Eip1193Provider } from '@coti-io/coti-ethers';

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

const RPC_METHOD_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const READ_ONLY_RPC_METHODS = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getLogs',
  'eth_getTransactionReceipt'
]);

const retryableStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

const wait = (delayMs: number): Promise<void> => delayMs === 0
  ? Promise.resolve()
  : new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));

export type PrivateLiquidityHttpProvider = Pick<Eip1193Provider, 'request'>;

export const createPrivateLiquidityHttpProvider = ({
  rpcUrl,
  fetcher = globalThis.fetch.bind(globalThis),
  timeoutMs = 20_000,
  maxAttempts = 3,
  retryDelayMs = 150
}: {
  rpcUrl: string;
  fetcher?: FetchLike;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}): PrivateLiquidityHttpProvider => {
  let endpoint: string;
  try {
    endpoint = new URL(rpcUrl).toString();
  } catch {
    throw new Error('Private-liquidity HTTP provider requires a valid RPC URL.');
  }
  if (
    typeof fetcher !== 'function' ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000 ||
    !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5 ||
    !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 5_000
  ) {
    throw new Error('Private-liquidity HTTP provider configuration is invalid.');
  }
  let nextId = 1;
  let requestQueue: Promise<void> = Promise.resolve();
  return Object.freeze({
    request: async ({ method, params = [] }) => {
      if (
        typeof method !== 'string' ||
        !RPC_METHOD_PATTERN.test(method) ||
        !READ_ONLY_RPC_METHODS.has(method) ||
        !Array.isArray(params)
      ) {
        throw new Error('Private-liquidity JSON-RPC request is malformed.');
      }
      const id = nextId;
      nextId = nextId === Number.MAX_SAFE_INTEGER ? 1 : nextId + 1;
      const body = JSON.stringify({ jsonrpc: '2.0', id, method, params: [...params] });
      const execute = async (): Promise<unknown> => {
        let response: Response | null = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          const controller = new AbortController();
          const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
          try {
            response = await fetcher(endpoint, {
              method: 'POST',
              headers: Object.freeze({ 'content-type': 'application/json' }),
              body,
              cache: 'no-store',
              credentials: 'omit',
              redirect: 'error',
              signal: controller.signal
            });
          } catch {
            if (attempt === maxAttempts) {
              throw new Error('Private-liquidity JSON-RPC transport failed.');
            }
            await wait(retryDelayMs * attempt);
            continue;
          } finally {
            globalThis.clearTimeout(timeout);
          }
          if (response.ok || !retryableStatus(response.status) || attempt === maxAttempts) break;
          response = null;
          await wait(retryDelayMs * attempt);
        }
        if (!response?.ok) throw new Error('Private-liquidity JSON-RPC transport returned an error status.');
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new Error('Private-liquidity JSON-RPC response is not JSON.');
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          throw new Error('Private-liquidity JSON-RPC response is malformed.');
        }
        const record = payload as Record<string, unknown>;
        if (record.jsonrpc === '2.0' && record.id === id && 'error' in record) {
          const remote = record.error;
          const code = remote && typeof remote === 'object' && !Array.isArray(remote) &&
            Number.isSafeInteger((remote as Record<string, unknown>).code)
            ? ` (code ${String((remote as Record<string, unknown>).code)})`
            : '';
          throw new Error(`Private-liquidity JSON-RPC response was rejected${code}.`);
        }
        if (record.jsonrpc !== '2.0' || record.id !== id || !('result' in record)) {
          throw new Error('Private-liquidity JSON-RPC response failed validation.');
        }
        return record.result;
      };
      const pending = requestQueue.then(execute, execute);
      requestQueue = pending.then(() => undefined, () => undefined);
      return pending;
    }
  });
};
