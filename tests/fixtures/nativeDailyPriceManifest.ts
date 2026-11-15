// Historical deployment evidence only. No normal App selector imports this fixture.
import type {CurrentDexDailyPriceManifest} from '../../src/lib/currentDexDailyPrice';
// Accepted current-history-native-manifest-1.json. Only display labels differ.
// This public read configuration does not grant trading or signing admission.
export const NATIVE_TESTNET_DEX_DAILY_PRICE_MANIFEST: CurrentDexDailyPriceManifest = Object.freeze({
  "sourceGraph": "fa71b96c6c590a40feed6b234d8bf5a2fe548af0edb0a2a49dbd639f4c15938b",
  "recorderArtifact": "606227789b05ffb320211a3bc62bae2dfdf22fe589485645cfa0aa62ba0196bc",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0xAC1CeA88Cbf89f8bE2f2B057eB90Cc250105DF42",
  "runtimeHash": "0x5b5041a198e310715104e3801216fd9178843a733835efdb67108fe10295b6ba",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "9907816",
  "deploymentBlockHash": "0x0e19a21361252e6c187a7e2c2a4106fbaf6ae337e19c4379b4e0d571112cb687",
  "deploymentTransactionHash": "0x30d9412fe7c631f07273ebfc2f9b03568bc098206bd8631e87d27e77801f8dc7",
  "source": "0x7136B6B4209574d38f7aAD1fA7ABDB8d08D16960",
  "sourceRuntimeHash": "0x6d3c12daffe36c754845b6c41ea00d47a11b00202c2cbdd17639aba582c5855e",
  "releaseId": "0xda24bb25496a47044035abb1c4bc0d9f5112a2eed8a29deeb571bc6b2b40398d",
  "market": "0x4f013b7939cedbeb4c73f31c3abc3e89f7c2f0be23a4ff6cdd3c7eb062215168",
  "pair": "0xb88c71af0bc439174542b73b8905169179c2151e758bb2788f5ebd36f50ee4ed",
  "canonicalId": "1",
  "token0": "0x96D97450D36eb65804cE2F84d0fE6C9EF52F264A",
  "token1": "0xbBafDc398697154E1De68780eAFB0C586371CFF2",
  "decimals0": 18,
  "decimals1": 18,
  "token0RuntimeHash": "0x50ec5254aca88a9819cc819b1167c86bb8cba36916332c1c5a829b720da6d63b",
  "token1RuntimeHash": "0x50ec5254aca88a9819cc819b1167c86bb8cba36916332c1c5a829b720da6d63b",
  "symbols": Object.freeze(["Test token 1", "Test token 0"] as const)
});

