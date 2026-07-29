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

const validateRpcUrl = (value: string): string => {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    throw new Error('RPC URL must use HTTPS.');
  }
  return url.toString();
};

export class HttpContractReader implements ContractReader {
  readonly #url: string;
  readonly #fetcher: typeof fetch;
  readonly #timeoutMs: number;
  #requestId = 0;

  constructor(url: string, fetcher: typeof fetch = fetch, timeoutMs = 5_000) {
    this.#url = validateRpcUrl(url);
    this.#fetcher = fetcher;
    this.#timeoutMs = timeoutMs;
  }

  async request<T>(method: string, params: readonly unknown[]): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetcher(this.#url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++this.#requestId,
          method,
          params
        }),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok || text.length > 2_000_000) {
        throw new Error('RPC request failed.');
      }
      const payload = JSON.parse(text) as {
        error?: unknown;
        result?: T;
      };
      if (payload.error) {
        throw method === 'eth_call' && isContractRevert(payload.error)
          ? new RpcContractRevertedError()
          : new RpcUnavailableError();
      }
      if (payload.result === undefined) throw new RpcUnavailableError();
      return payload.result;
    } catch (error) {
      if (error instanceof RpcContractRevertedError) throw error;
      throw new RpcUnavailableError();
    } finally {
      clearTimeout(timeout);
    }
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
