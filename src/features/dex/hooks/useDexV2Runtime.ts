import { useCallback, useEffect, useRef, useState } from 'react';
import type { Eip1193Provider } from '@coti-io/coti-ethers';
import {
  assertAttestedDexV2Deployment,
  attestDexV2Deployment,
  createDexV2ReadCapability,
  type AttestedDexV2Deployment
} from '../../../lib/dexV2Chain';
import {
  DEX_V2_DEPLOYMENT_CONFIG,
  type DexV2DeploymentConfig
} from '../../../lib/dexV2Deployment';
import type { SharedWalletSession } from '../../../lib/walletSession';

const READ_METHODS = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_getBlockByNumber',
  'eth_getCode'
]);

type Fetcher = typeof fetch;
type ReadProvider = Pick<Eip1193Provider, 'request'>;

export type DexV2RuntimeState =
  | Readonly<{ status: 'inactive' }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'attesting' }>
  | Readonly<{ status: 'error' }>
  | Readonly<{
      status: 'ready';
      deployment: AttestedDexV2Deployment;
      providerSource: 'wallet' | 'public-rpc';
    }>;

const initialState = (config: DexV2DeploymentConfig): DexV2RuntimeState => {
  if (config.status === 'inactive') return Object.freeze({ status: 'inactive' });
  if (config.status === 'invalid') return Object.freeze({ status: 'invalid' });
  return Object.freeze({ status: 'attesting' });
};

export const createDexV2PublicReadProvider = ({
  rpcUrl,
  fetcher = fetch,
  signal
}: {
  rpcUrl: string;
  fetcher?: Fetcher;
  signal?: AbortSignal;
}): ReadProvider => {
  let requestId = 0;
  return Object.freeze({
    request: async ({ method, params = [] }) => {
      if (!READ_METHODS.has(method)) throw new Error('DEX V2 public RPC is read-only.');
      if (signal?.aborted) throw new Error('DEX V2 read was cancelled.');
      const id = ++requestId;
      const response = await fetcher(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal
      });
      if (!response.ok) throw new Error('DEX V2 RPC request failed.');
      const payload = await response.json() as Record<string, unknown>;
      if (
        !payload || payload.jsonrpc !== '2.0' || payload.id !== id ||
        Object.prototype.hasOwnProperty.call(payload, 'error') ||
        !Object.prototype.hasOwnProperty.call(payload, 'result')
      ) throw new Error('DEX V2 RPC response is invalid.');
      return payload.result;
    }
  });
};

export const loadDexV2Runtime = async ({
  config,
  walletSession,
  fetcher,
  signal,
  assertCurrent
}: {
  config: DexV2DeploymentConfig;
  walletSession?: SharedWalletSession;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  assertCurrent: () => void | Promise<void>;
}): Promise<DexV2RuntimeState> => {
  if (config.status === 'inactive') return Object.freeze({ status: 'inactive' });
  if (config.status === 'invalid') return Object.freeze({ status: 'invalid' });
  const chainId = BigInt(config.manifest.chainId);
  const walletProvider = walletSession?.browserProvider ?? null;
  const useWallet = Boolean(walletProvider && walletSession?.chainId === Number(chainId));
  const attestWithProvider = async (
    provider: ReadProvider,
    providerSource: 'wallet' | 'public-rpc'
  ): Promise<DexV2RuntimeState> => {
    const capability = createDexV2ReadCapability({ provider, chainId, assertCurrent });
    const deployment = assertAttestedDexV2Deployment(await attestDexV2Deployment({
      capability,
      manifest: config.manifest,
      finalityLagBlocks: config.finalityLagBlocks
    }));
    return Object.freeze({ status: 'ready', deployment, providerSource });
  };

  if (useWallet) {
    try {
      return await attestWithProvider(walletProvider as ReadProvider, 'wallet');
    } catch (walletError) {
      if (signal?.aborted) throw walletError;
      await assertCurrent();
    }
  }

  return attestWithProvider(
    createDexV2PublicReadProvider({ rpcUrl: config.rpcUrl, fetcher, signal }),
    'public-rpc'
  );
};

export default function useDexV2Runtime({
  sharedWalletSession,
  config = DEX_V2_DEPLOYMENT_CONFIG
}: {
  sharedWalletSession?: SharedWalletSession;
  config?: DexV2DeploymentConfig;
} = {}): Readonly<{
  runtime: DexV2RuntimeState;
  refresh: () => void;
}> {
  const sessionRef = useRef(sharedWalletSession);
  sessionRef.current = sharedWalletSession;
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [runtime, setRuntime] = useState<DexV2RuntimeState>(() => initialState(config));
  const refresh = useCallback(() => setRefreshEpoch((value) => value + 1), []);

  useEffect(() => {
    if (config.status !== 'active') {
      setRuntime(initialState(config));
      return undefined;
    }
    let current = true;
    const controller = new AbortController();
    const capturedProvider = sharedWalletSession?.browserProvider ?? null;
    const capturedChainId = sharedWalletSession?.chainId ?? null;
    setRuntime(Object.freeze({ status: 'attesting' }));
    void loadDexV2Runtime({
      config,
      walletSession: sharedWalletSession,
      signal: controller.signal,
      assertCurrent: () => {
        if (!current) throw new Error('DEX V2 read is stale.');
        if (capturedProvider && capturedChainId === Number(config.manifest.chainId)) {
          const latest = sessionRef.current;
          if (latest?.browserProvider !== capturedProvider || latest.chainId !== capturedChainId) {
            throw new Error('DEX V2 wallet read capability is stale.');
          }
        }
      }
    }).then((next) => {
      if (current) setRuntime(next);
    }).catch(() => {
      if (current) setRuntime(Object.freeze({ status: 'error' }));
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [config, refreshEpoch, sharedWalletSession?.browserProvider, sharedWalletSession?.chainId]);

  return Object.freeze({ runtime, refresh });
}
