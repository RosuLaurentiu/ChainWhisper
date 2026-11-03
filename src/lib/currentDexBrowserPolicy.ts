import { hasCurrentDexBrowserSigner } from '../features/wallet/ownerCotiMetaMaskCapability';

export const CURRENT_BROWSER_DEX_GRAPH = '7b67bcbb7c5941a24471e62ba5a0d939c0800671b0bf121e81bad14cca737456';
export const CURRENT_BROWSER_DEX_CORE = '0xab5374daddea783c3e58de19db497b54c79fd4cc';
export const isCurrentDexBrowserSigner = (signer: object | undefined, graph: string, owner: string) =>
  graph === CURRENT_BROWSER_DEX_GRAPH && hasCurrentDexBrowserSigner(signer,owner,7082400n);
export const assertCurrentDexBrowserWindow = (signer: object, graph: string, owner: string, core: string, chainId: bigint,
  now: bigint, nonce: number, gasCap: bigint, gasPrice: bigint) => {
  if (!isCurrentDexBrowserSigner(signer, graph, owner) || core.toLowerCase() !== CURRENT_BROWSER_DEX_CORE || chainId !== 7082400n ||
      now <= 0n || !Number.isSafeInteger(nonce) || nonce < 0 || gasCap <= 0n || gasCap > 110_000_000n || gasPrice !== 50_000_000n)
    throw new Error('Browser DEX nonce, candidate or transaction fee check failed.');
};
