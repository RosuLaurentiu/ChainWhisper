import {
  decodeFunctionResult,
  encodeFunctionData,
  type Abi,
  type Address,
  type Hex
} from 'viem';

export interface ContractReader {
  request<T>(method: string, params: readonly unknown[]): Promise<T>;
  readContract(input: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
}

export class RpcUnavailableError extends Error {
  constructor() {
    super('RPC request failed.');
  }
}

export class RpcContractRevertedError extends Error {
  constructor() {
    super('Contract call reverted.');
  }
}

const isContractRevert = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const error = value as { code?: unknown; message?: unknown };
  return (
    error.code === 3 ||
    /execution reverted|invalid opcode|panic code/iu.test(String(error.message ?? ''))
  );
};

const isTransientRpcOverload = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const error = value as { code?: unknown; message?: unknown };
  return (
    error.code === -32002 &&
    /endpoint returned too many errors|rate limit|temporarily unavailable/iu.test(
      String(error.message ?? '')
    )
  );
};

const validateRpcUrl = (value: string): string => {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    throw new Error('RPC URL must use HTTPS.');
  }
  return url.toString();
};

const retryableStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

const wait = (delayMs: number): Promise<void> => delayMs === 0
  ? Promise.resolve()
  : new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));

export class HttpContractReader implements ContractReader {
  readonly #url: string;
  readonly #fetcher: typeof fetch;
  readonly #timeoutMs: number;
  readonly #maxAttempts: number;
  readonly #retryDelayMs: number;
  #requestId = 0;
  #requestQueue: Promise<void> = Promise.resolve();

  constructor(
    url: string,
    fetcher: typeof fetch = fetch,
    timeoutMs = 5_000,
    retryPolicy: Readonly<{ maxAttempts?: number; retryDelayMs?: number }> = {}
  ) {
    this.#url = validateRpcUrl(url);
    this.#fetcher = fetcher;
    this.#timeoutMs = timeoutMs;
    this.#maxAttempts = retryPolicy.maxAttempts ?? 3;
    this.#retryDelayMs = retryPolicy.retryDelayMs ?? 100;
    if (
      !Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1_000 || this.#timeoutMs > 120_000 ||
      !Number.isSafeInteger(this.#maxAttempts) || this.#maxAttempts < 1 || this.#maxAttempts > 5 ||
      !Number.isSafeInteger(this.#retryDelayMs) || this.#retryDelayMs < 0 || this.#retryDelayMs > 5_000
    ) throw new Error('RPC reader configuration is invalid.');
  }

  async request<T>(method: string, params: readonly unknown[]): Promise<T> {
    const id = ++this.#requestId;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const execute = async (): Promise<T> => {
      for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = globalThis.setTimeout(() => controller.abort(), this.#timeoutMs);
        let response: Response;
        try {
          response = await this.#fetcher(this.#url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
            signal: controller.signal
          });
        } catch {
          if (attempt === this.#maxAttempts) throw new RpcUnavailableError();
          await wait(this.#retryDelayMs * attempt);
          continue;
        } finally {
          globalThis.clearTimeout(timeout);
        }
        if (!response.ok) {
          if (retryableStatus(response.status) && attempt < this.#maxAttempts) {
            await wait(this.#retryDelayMs * attempt);
            continue;
          }
          throw new RpcUnavailableError();
        }
        let text: string;
        try {
          text = await response.text();
        } catch {
          if (attempt === this.#maxAttempts) throw new RpcUnavailableError();
          await wait(this.#retryDelayMs * attempt);
          continue;
        }
        if (text.length > 2_000_000) throw new RpcUnavailableError();
        let payload: { error?: unknown; result?: T };
        try {
          payload = JSON.parse(text) as { error?: unknown; result?: T };
        } catch {
          throw new RpcUnavailableError();
        }
        if (payload.error) {
          if (isTransientRpcOverload(payload.error) && attempt < this.#maxAttempts) {
            await wait(this.#retryDelayMs * attempt);
            continue;
          }
          throw method === 'eth_call' && isContractRevert(payload.error)
            ? new RpcContractRevertedError()
            : new RpcUnavailableError();
        }
        if (payload.result === undefined) throw new RpcUnavailableError();
        return payload.result;
      }
      throw new RpcUnavailableError();
    };
    const pending = this.#requestQueue.then(execute, execute);
    this.#requestQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async readContract(input: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown> {
    const data = encodeFunctionData({
      abi: input.abi,
      functionName: input.functionName,
      args: input.args ?? []
    });
    const result = await this.request<Hex>('eth_call', [
      { to: input.address, data },
      'latest'
    ]);
    try {
      return decodeFunctionResult({
        abi: input.abi,
        functionName: input.functionName,
        data: result
      });
    } catch {
      throw new RpcUnavailableError();
    }
  }
}
