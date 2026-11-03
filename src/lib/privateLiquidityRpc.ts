import type { Eip1193Provider } from '@coti-io/coti-ethers';
import { COTI_NETWORK, loadCotiHttpProvider } from './appShared/core';

const READ_ONLY_RPC_METHODS = new Set([
  'eth_blockNumber', 'eth_call', 'eth_chainId', 'eth_getBlockByNumber',
  'eth_getCode', 'eth_getLogs', 'eth_getTransactionReceipt'
]);

export type PrivateLiquidityHttpProvider = Pick<Eip1193Provider, 'request'>;

export const createPrivateLiquidityHttpProvider = ({ rpcUrl }: {
  rpcUrl: string;
}): PrivateLiquidityHttpProvider => {
  let endpoint: string;
  try {
    endpoint = new URL(rpcUrl).toString();
  } catch {
    throw new Error('Private-liquidity HTTP provider requires a valid RPC URL.');
  }
  if (endpoint !== new URL(COTI_NETWORK.rpcUrl).toString()) {
    throw new Error('Private-liquidity reads require the selected COTI RPC endpoint.');
  }
  return Object.freeze({
    request: async ({ method, params = [] }) => {
      if (!READ_ONLY_RPC_METHODS.has(method) || !Array.isArray(params)) {
        throw new Error('Private-liquidity JSON-RPC request is malformed.');
      }
      try {
        // All App reads share pacing and the same persistent HTTP 403/429 stop.
        const provider = await loadCotiHttpProvider();
        return await provider.send(method, params);
      } catch (cause) {
        // Keep local stop details; never copy upstream messages or request data into the UI.
        if (cause instanceof Error && /^COTI RPC reads stopped after (HTTP (403|429)|request timeout)\. No automatic retry\.$/.test(cause.message)) {
          throw new Error(cause.message);
        }
        const error = cause as { code?: unknown; info?: { error?: { code?: unknown } } } | null;
        const code = error?.info?.error?.code ?? error?.code;
        throw new Error(`Private-liquidity JSON-RPC read failed${Number.isSafeInteger(code) ? ` (code ${String(code)})` : ''}.`);
      }
    }
  });
};
