import { AbiCoder, keccak256 } from '@coti-io/coti-ethers';
import { COTI_TESTNET_NETWORK } from './chainWhisperNetworks';
import { CURRENT_HISTORY_DEX_DAILY_PRICE_SOURCE, type CurrentDexDailyPriceConfig, type CurrentDexDailyPriceManifest } from './currentDexDailyPrice';
import { readCurrentDexDisplay } from './currentDexDisplay';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import type { CurrentCheapDexCandidate } from './dexV2Deployment';

// Six canonical recorder exports; the reader checks deployment and sample provenance.
export const HISTORY_TESTNET_DEX_DAILY_PRICE_MANIFESTS: readonly CurrentDexDailyPriceManifest[] = Object.freeze([
  Object.freeze({
  "sourceGraph": "9591af0d1ea77bdb952adf0a859ef895398f0bbf5600d8a1addd941cce4ff3eb",
  "recorderArtifact": "fc90912c11cfac66ff8e2dea1d564395258d69f9ba30a955f5a293be3b32a436",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0x69f848D23Afb3A4E5D56Fb2046e6502E61129971",
  "runtimeHash": "0xdf2737857ec59579a9e084c1781407acaaa90314d2dde0e05d6c013c492a3945",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "10424236",
  "deploymentBlockHash": "0xd30b2cdd6dd21b4e8a7485f3ac93074bd7ed965557351b871c0f7fa8036503fc",
  "deploymentTransactionHash": "0xc4c52de293eb4c2f814282a251ebc7aee6fc81d7027195022437700a30c1c438",
  "source": "0xA3da6c8d5f9B1566Bf965E94966eCba9f1dEb758",
  "sourceRuntimeHash": "0xa5a60403d5c4ab01cd2baddb94cefdcd108bc99d249f21c6e217be2187cb3d34",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0x332b4261eab10c2e1a4b71d4d0315bb31e6e87a1eebc84797df7fa971c778c82",
  "pair": "0x3717864b0bdf813c3d0e34112b351fa40fb4661f8cdf6af296e7afb581ba8736",
  "canonicalId": "1",
  "token0": "0x5181B25e7AD744E635fe048D388Fd820f943e582",
  "token1": "0xe595F63789D1D31B4b7c0Bee69062Daf5BE81ac8",
  "decimals0": 6,
  "decimals1": 6,
  "token0RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "token1RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "symbols": [
    "HBR",
    "BCN"
  ]
} as const),
  Object.freeze({
  "sourceGraph": "9591af0d1ea77bdb952adf0a859ef895398f0bbf5600d8a1addd941cce4ff3eb",
  "recorderArtifact": "fc90912c11cfac66ff8e2dea1d564395258d69f9ba30a955f5a293be3b32a436",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0xaF5e82f7dDB58D13a5fc71BCa18EdFeFaC1024F2",
  "runtimeHash": "0xccd38cfecb6328f21ca2b41c4475690ff02c29a92b28b3fb801c4815f562f28a",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "10424240",
  "deploymentBlockHash": "0x55e2d8558467a81d33cc7256491a3c95742dc63c3ad0e271433674f1e6c3505c",
  "deploymentTransactionHash": "0x20d1c6d9f5ec8435b1b6c648da54b6d3880544d9cf4b7a5b1aff54123877645a",
  "source": "0xA3da6c8d5f9B1566Bf965E94966eCba9f1dEb758",
  "sourceRuntimeHash": "0xa5a60403d5c4ab01cd2baddb94cefdcd108bc99d249f21c6e217be2187cb3d34",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0x6752c14d88241318850f38fd0a96f6ea18792343d66f2c8f4e5a74f1f643d488",
  "pair": "0xd48b20c307c74255e81488248c822739421fdc18f0c0b425776cdff19f5f1459",
  "canonicalId": "2",
  "token0": "0x99B7D4CEF854CA380Be0c49863F761670A57F0B3",
  "token1": "0xe595F63789D1D31B4b7c0Bee69062Daf5BE81ac8",
  "decimals0": 6,
  "decimals1": 6,
  "token0RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "token1RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "symbols": [
    "EMBR",
    "BCN"
  ]
} as const),
  Object.freeze({
  "sourceGraph": "9591af0d1ea77bdb952adf0a859ef895398f0bbf5600d8a1addd941cce4ff3eb",
  "recorderArtifact": "fc90912c11cfac66ff8e2dea1d564395258d69f9ba30a955f5a293be3b32a436",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0x0C6D0469Ea192Dfa08db85662826765132005963",
  "runtimeHash": "0xdd72aa22958916aed06a74b46ff6aa5649aa47d558dbd5a77a4428254e1bff22",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "10424244",
  "deploymentBlockHash": "0xcfaf31d17dff9050768221e4fd3abe7ba1c5c1438e088f811e023826be04630b",
  "deploymentTransactionHash": "0x7e67d44cb2e5f4ad79199ca1ccc467b0daf761f412c11779fb6c3fbab6267c3a",
  "source": "0xA3da6c8d5f9B1566Bf965E94966eCba9f1dEb758",
  "sourceRuntimeHash": "0xa5a60403d5c4ab01cd2baddb94cefdcd108bc99d249f21c6e217be2187cb3d34",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0xb75e820ce92432e6cfa444714c11b169a49d59f8bb2c736d7ee4643ff0814050",
  "pair": "0xa7c153e1a9f411e2db70a5318e4c9bacc0fac91b25191f978f159d26e66e8539",
  "canonicalId": "3",
  "token0": "0x8e8f1142EFE829fbDF2FEcBa7A2fa0e472B5b703",
  "token1": "0xe595F63789D1D31B4b7c0Bee69062Daf5BE81ac8",
  "decimals0": 6,
  "decimals1": 6,
  "token0RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "token1RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "symbols": [
    "ORBT",
    "BCN"
  ]
} as const),
  Object.freeze({
  "sourceGraph": "9591af0d1ea77bdb952adf0a859ef895398f0bbf5600d8a1addd941cce4ff3eb",
  "recorderArtifact": "fc90912c11cfac66ff8e2dea1d564395258d69f9ba30a955f5a293be3b32a436",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0x3Ca6Ca2F60C73F2BE67c36557FD9252Ba7C629b6",
  "runtimeHash": "0x58a60167e5f013d4832abef2a740faa48d99b3d1977ea6ea0f586260e3736da6",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "10424248",
  "deploymentBlockHash": "0x43a601099280412af98f7d6aa8e1a80cb535a6dc2677260ed54832e0bb7e3250",
  "deploymentTransactionHash": "0x4dcd40f9e200883741140364e7124c3099f0f8fb35fe553837a344b3e96be79d",
  "source": "0xA3da6c8d5f9B1566Bf965E94966eCba9f1dEb758",
  "sourceRuntimeHash": "0xa5a60403d5c4ab01cd2baddb94cefdcd108bc99d249f21c6e217be2187cb3d34",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0xa813003013f03213c0ceeef7c3b379422c5e9e56dfd003f614e0c1325e4c9b6f",
  "pair": "0xc4bf3ea6d6f8fd04160c5c6b98784c2263a0c19ca128681d2579d7abe0f2c674",
  "canonicalId": "4",
  "token0": "0x5181B25e7AD744E635fe048D388Fd820f943e582",
  "token1": "0x99B7D4CEF854CA380Be0c49863F761670A57F0B3",
  "decimals0": 6,
  "decimals1": 6,
  "token0RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "token1RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "symbols": [
    "HBR",
    "EMBR"
  ]
} as const),
  Object.freeze({
  "sourceGraph": "9591af0d1ea77bdb952adf0a859ef895398f0bbf5600d8a1addd941cce4ff3eb",
  "recorderArtifact": "fc90912c11cfac66ff8e2dea1d564395258d69f9ba30a955f5a293be3b32a436",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0x5584c97377ff117034f4CF9c1FBd0b90eDdD8483",
  "runtimeHash": "0xd8b1601d527c4a088a15dc41ff8aae47044379d312ae545aa3c2dc1fb5b45f6b",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "10424962",
  "deploymentBlockHash": "0x511b8e6605916008b73891f89330325e9cec7bd11affe3c01092f6f7a58cc025",
  "deploymentTransactionHash": "0x00be8f483806230cef5fd150f3eec11b1152a2bba75bb40b82d24071a1f15223",
  "source": "0xA3da6c8d5f9B1566Bf965E94966eCba9f1dEb758",
  "sourceRuntimeHash": "0xa5a60403d5c4ab01cd2baddb94cefdcd108bc99d249f21c6e217be2187cb3d34",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0xdce7a2d32805455d34a3179fa176ec25bd60ca9b280eb31e4623af81dc8630b4",
  "pair": "0x0aa83caa8aafe0758e52f4ba3dd8fba633c7b516bfaac5c815204b63fa12ef99",
  "canonicalId": "5",
  "token0": "0x5181B25e7AD744E635fe048D388Fd820f943e582",
  "token1": "0x8e8f1142EFE829fbDF2FEcBa7A2fa0e472B5b703",
  "decimals0": 6,
  "decimals1": 6,
  "token0RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "token1RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "symbols": [
    "HBR",
    "ORBT"
  ]
} as const),
  Object.freeze({
  "sourceGraph": "9591af0d1ea77bdb952adf0a859ef895398f0bbf5600d8a1addd941cce4ff3eb",
  "recorderArtifact": "fc90912c11cfac66ff8e2dea1d564395258d69f9ba30a955f5a293be3b32a436",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0xD7BF1a20DC885A4B5Bdd1D15D07eCeF419d76970",
  "runtimeHash": "0x1f8943b0bb11d4aa9c9c7c1abef2b194b2326526be907bde6850015b7582fe76",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "10424966",
  "deploymentBlockHash": "0x260e3a30db36e9ac98769f79a0934012e93a87bb7ab456a47acce0ee4bf4faae",
  "deploymentTransactionHash": "0xa084f138bc36157291364fa2a425347797fab7d34bab746a1ea185ee80579e4f",
  "source": "0xA3da6c8d5f9B1566Bf965E94966eCba9f1dEb758",
  "sourceRuntimeHash": "0xa5a60403d5c4ab01cd2baddb94cefdcd108bc99d249f21c6e217be2187cb3d34",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0xb136fe13a904e03e7fea00dda10c163fbfca488ad57c0e31bc2855809ae37efa",
  "pair": "0x6ece32731716cb1a42a55cab5b45dc8b0e91c6333bc381dc2051643c8c239e81",
  "canonicalId": "6",
  "token0": "0x8e8f1142EFE829fbDF2FEcBa7A2fa0e472B5b703",
  "token1": "0x99B7D4CEF854CA380Be0c49863F761670A57F0B3",
  "decimals0": 6,
  "decimals1": 6,
  "token0RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "token1RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "symbols": [
    "ORBT",
    "EMBR"
  ]
} as const)
]);
const inactive: CurrentDexDailyPriceConfig = Object.freeze({status:'inactive'});
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();

/** Public scope only. The daily reader verifies deployment, runtime and sample provenance. */
export const currentHistoryDexDailyPriceManifestMatches=(candidate:CurrentCheapDexCandidate,pair:readonly[string,string],m:CurrentDexDailyPriceManifest):boolean=>{
  try{
    const {key,candidate:c}=resolvePreparedDexScope(candidate);if(key!=='cheap-history')return false;
    const selected=readCurrentDexDisplay(c).pairs.find(row=>
      row.tokens[0].label===pair[0]&&row.tokens[1].label===pair[1]||row.tokens[0].label===pair[1]&&row.tokens[1].label===pair[0]);
    if(!selected)return false;
    const canonical=c.pairs.find(row=>row.marketId===selected.marketId)!,core=c.runtimes.find(([role])=>role==='ChainWhisperDexCore')!,[token0,token1]=selected.tokens;
    return m.sourceGraph===c.graph&&m.recorderArtifact===CURRENT_HISTORY_DEX_DAILY_PRICE_SOURCE.recorderArtifact&&m.chainId===c.chainId&&same(m.genesisHash,c.genesisHash)&&
      same(m.source,c.core)&&same(m.sourceRuntimeHash,core[2])&&same(m.releaseId,c.releaseId)&&same(m.market,selected.marketId)&&m.canonicalId===canonical.canonicalId&&
      same(m.token0,token0.address)&&same(m.token1,token1.address)&&m.decimals0===token0.decimals&&m.decimals1===token1.decimals&&
      same(m.token0RuntimeHash,c.tokens.find(([address])=>same(address,token0.address))![1])&&same(m.token1RuntimeHash,c.tokens.find(([address])=>same(address,token1.address))![1])&&
      m.symbols.length===2&&m.symbols[0]===token0.label&&m.symbols[1]===token1.label&&
      same(m.pair,keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','address','address'],[c.chainId,token0.address,token1.address])));
  }catch{return false;}
};
export const currentHistoryDexDailyPriceConfig=(candidate:CurrentCheapDexCandidate,pair:readonly[string,string]):CurrentDexDailyPriceConfig=>{
  const matches=HISTORY_TESTNET_DEX_DAILY_PRICE_MANIFESTS.filter(m=>currentHistoryDexDailyPriceManifestMatches(candidate,pair,m));
  return matches.length===1?Object.freeze({status:'active',manifest:matches[0],rpcUrl:COTI_TESTNET_NETWORK.rpcUrl,finalityLagBlocks:2}):inactive;
};
