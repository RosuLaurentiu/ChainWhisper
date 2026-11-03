import { hasCurrentDexBrowserSigner } from '../features/wallet/ownerCotiMetaMaskCapability';

export const CURRENT_BROWSER_DEX_GRAPH = '9591af0d1ea77bdb952adf0a859ef895398f0bbf5600d8a1addd941cce4ff3eb';
export const CURRENT_BROWSER_DEX_CORE = '0xa3da6c8d5f9b1566bf965e94966ecba9f1deb758';
export const isCurrentDexBrowserSigner = (signer: object | undefined, graph: string, owner: string) =>
  graph === CURRENT_BROWSER_DEX_GRAPH && hasCurrentDexBrowserSigner(signer,owner,7082400n);
export const assertCurrentDexBrowserWindow = (signer: object, graph: string, owner: string, core: string, chainId: bigint,
  now: bigint, nonce: number, gasCap: bigint, gasPrice: bigint) => {
  if (!isCurrentDexBrowserSigner(signer, graph, owner) || core.toLowerCase() !== CURRENT_BROWSER_DEX_CORE || chainId !== 7082400n ||
      now <= 0n || !Number.isSafeInteger(nonce) || nonce < 0 || gasCap <= 0n || gasCap > 110_000_000n || gasPrice !== 50_000_000n)
    throw new Error('Browser DEX nonce, candidate or transaction fee check failed.');
};
