import { COTI_TESTNET_NETWORK } from './chainWhisperNetworks';
import { CURRENT_DEX_DAILY_PRICE_SOURCE, type CurrentDexDailyPriceConfig, type CurrentDexDailyPriceManifest } from './currentDexDailyPrice';

// CW-040.01: native-record-1/NATIVE_FINAL_SEAL.json
// 2249051551615c39a5106cfd7227660310e16cb899c68a467a8969fdc57a6c94.
// This explicit read configuration does not select a trading or signing candidate.
export const TESTNET_DEX_DAILY_PRICE_MANIFEST: CurrentDexDailyPriceManifest = Object.freeze({
  sourceGraph: CURRENT_DEX_DAILY_PRICE_SOURCE.graph,
  recorderArtifact: CURRENT_DEX_DAILY_PRICE_SOURCE.recorderArtifact,
  chainId: '7082400',
  genesisHash: '0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a',
  address: '0x9C0C35CaC1AD83ed157308C5cB8eFC275F7C3db7',
  runtimeHash: '0x91a5f4363743ac885ca17fca1c6810df369e2f84c8c66c52ab47500e16edbc18',
  deployer: '0xC737b5850e15d03ed09bfAdc8A33062f6073a850',
  deploymentBlock: '9897315',
  deploymentBlockHash: '0xb28b94c91cd24db8750e01a55cba3c4ecee1644ed7db66cf81067657f6b7736a',
  deploymentTransactionHash: '0x9407e9eed78c675c4b857e1c7d419be56cebd1f2c68f9c568a1d9fb179012118',
  source: '0xe35F5DA20D4D3A2bba74d24B455C0a1B789CA66E',
  sourceRuntimeHash: '0x6bc1841652e1ba83c9f95ba52dda7f4b96ce89c308e9e4047f7362811fecf187',
  releaseId: '0xda24bb25496a47044035abb1c4bc0d9f5112a2eed8a29deeb571bc6b2b40398d',
  market: '0x4f013b7939cedbeb4c73f31c3abc3e89f7c2f0be23a4ff6cdd3c7eb062215168',
  pair: '0xb88c71af0bc439174542b73b8905169179c2151e758bb2788f5ebd36f50ee4ed',
  canonicalId: '1',
  token0: '0x96D97450D36eb65804cE2F84d0fE6C9EF52F264A',
  token1: '0xbBafDc398697154E1De68780eAFB0C586371CFF2',
  decimals0: 18, decimals1: 18,
  token0RuntimeHash: '0x50ec5254aca88a9819cc819b1167c86bb8cba36916332c1c5a829b720da6d63b',
  token1RuntimeHash: '0x50ec5254aca88a9819cc819b1167c86bb8cba36916332c1c5a829b720da6d63b',
  // Safe address labels from the trial; canonical address order is reversed.
  symbols: Object.freeze(['Test token 1', 'Test token 0'] as const)
});

export const TESTNET_DEX_DAILY_PRICE_CONFIG: CurrentDexDailyPriceConfig = Object.freeze({
  status: 'active', manifest: TESTNET_DEX_DAILY_PRICE_MANIFEST,
  rpcUrl: COTI_TESTNET_NETWORK.rpcUrl, finalityLagBlocks: 2
});
