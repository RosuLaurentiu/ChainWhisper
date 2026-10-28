import { AbiCoder, keccak256 } from '@coti-io/coti-ethers';
import { COTI_TESTNET_NETWORK } from './chainWhisperNetworks';
import { CURRENT_HISTORY_DEX_DAILY_PRICE_SOURCE, type CurrentDexDailyPriceConfig, type CurrentDexDailyPriceManifest } from './currentDexDailyPrice';
import { readCurrentDexDisplay } from './currentDexDisplay';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import type { CurrentCheapDexCandidate } from './dexV2Deployment';

// Six canonical recorder exports; the reader checks deployment and sample provenance.
export const HISTORY_TESTNET_DEX_DAILY_PRICE_MANIFESTS: readonly CurrentDexDailyPriceManifest[] = Object.freeze([
  Object.freeze({
  "sourceGraph": "7b67bcbb7c5941a24471e62ba5a0d939c0800671b0bf121e81bad14cca737456",
  "recorderArtifact": "687965246fa31bb25a1c50f7b486d006e7b46d8e4efafb0af5c328944304522d",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0x380227431cAa87278ab06A770fDe86EF55b34E44",
  "runtimeHash": "0x373acc60e5f0e44e2e9f74ad0f1b627cf1abefc97672011b1c92485eca57e096",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "10080523",
  "deploymentBlockHash": "0xd3f79feb4c8f220caef6b4af989139f40a75222be5c2d04928f3a79e5ae04a01",
  "deploymentTransactionHash": "0x072ae0bae0df3131986408f8a609f51be4b767bbc770f2c0e2f5ed1a8d8ebb6d",
  "source": "0xaB5374daddeA783C3e58DE19DB497B54C79fD4cc",
  "sourceRuntimeHash": "0xdf5bb9ac50ee3bf8f554d9d80c192918eebe2e8b43491d957bd9494ab457cc14",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0x10280867cde3eb729618ca3d6b33a7c38cdf1b26be73f6618c102e25938c8625",
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
  "sourceGraph": "7b67bcbb7c5941a24471e62ba5a0d939c0800671b0bf121e81bad14cca737456",
  "recorderArtifact": "687965246fa31bb25a1c50f7b486d006e7b46d8e4efafb0af5c328944304522d",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0xe9E6ED9a8081bF43Ee778BDb0E5d947c8bF5077E",
  "runtimeHash": "0x652f8cf87c15c8dc97d6be41adb67419de03e5efdb5a9046c6e73e93af3610c8",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "10080558",
  "deploymentBlockHash": "0x0957d68990c0bae459a8516ff6be6fdd42c4c6936eb58e098e2affc1b91c83f4",
  "deploymentTransactionHash": "0xb7a5e525f0da804e69942f8a4653a081e404acd45a19ed3e578003e927f06b8d",
  "source": "0xaB5374daddeA783C3e58DE19DB497B54C79fD4cc",
  "sourceRuntimeHash": "0xdf5bb9ac50ee3bf8f554d9d80c192918eebe2e8b43491d957bd9494ab457cc14",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0xef77260fbd4159811eb036d357fae01539f103f363b6810c941391ef231d9277",
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
  "sourceGraph": "7b67bcbb7c5941a24471e62ba5a0d939c0800671b0bf121e81bad14cca737456",
  "recorderArtifact": "687965246fa31bb25a1c50f7b486d006e7b46d8e4efafb0af5c328944304522d",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0xCD58729367a6932116E96F33e8E14aC61D3a746d",
  "runtimeHash": "0xd9245263ce06e35b39be973aaa9b6e3afac79bd618bf0b3b01773d5d8b4e5832",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "10080572",
  "deploymentBlockHash": "0xfe81799029e802054e42ebd6c7e3191fc3c54cfcae21f3e5d3df0a688710af95",
  "deploymentTransactionHash": "0xe13d0f7d17acb6c53fb809bdce6202d1d07d2eaa13f6e55cf699297499ce8493",
  "source": "0xaB5374daddeA783C3e58DE19DB497B54C79fD4cc",
  "sourceRuntimeHash": "0xdf5bb9ac50ee3bf8f554d9d80c192918eebe2e8b43491d957bd9494ab457cc14",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0x2f54c96111add2999ef6855f2cfece8455d3d4cd4c86814fc1bb96c155b138e2",
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
  "sourceGraph": "7b67bcbb7c5941a24471e62ba5a0d939c0800671b0bf121e81bad14cca737456",
  "recorderArtifact": "687965246fa31bb25a1c50f7b486d006e7b46d8e4efafb0af5c328944304522d",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0xF1A239e86e059eE29f436699Ea17a374cDa98e07",
  "runtimeHash": "0xeb7e8f9d39344131cbbf45a23c7d0b6ef0ba48ae2f3c27c8c86172753279b8ee",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "10080585",
  "deploymentBlockHash": "0x4ffb65decebf8758dbc617a1294a138d7f4e1112297b2f2b46a399c69c1fbcc9",
  "deploymentTransactionHash": "0x7e5d21ac5c58e93b790247d97c16afd0035212834a35d90569c7e4c292592412",
  "source": "0xaB5374daddeA783C3e58DE19DB497B54C79fD4cc",
  "sourceRuntimeHash": "0xdf5bb9ac50ee3bf8f554d9d80c192918eebe2e8b43491d957bd9494ab457cc14",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0xedeed9a69bbf2965efbbedee7034b6d14caaadb476ca5ac19efe4a6851deb214",
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
  "sourceGraph": "7b67bcbb7c5941a24471e62ba5a0d939c0800671b0bf121e81bad14cca737456",
  "recorderArtifact": "687965246fa31bb25a1c50f7b486d006e7b46d8e4efafb0af5c328944304522d",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0x573c7bdbbd35e43367488C2955Cb0061Fa0b4b9f",
  "runtimeHash": "0xda0529780ab6002bdef78447fcbc0ed7c4b352f41d0934f06070c5319915e47c",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "10080599",
  "deploymentBlockHash": "0x2886feecac1d3562f2bcfab541596fadac51cdb1acf95ebad52f08431b1da484",
  "deploymentTransactionHash": "0x8710fa2155c54c9879cb3ef8dc1206b252fbe2c459f7ceb0d3425a40811f6993",
  "source": "0xaB5374daddeA783C3e58DE19DB497B54C79fD4cc",
  "sourceRuntimeHash": "0xdf5bb9ac50ee3bf8f554d9d80c192918eebe2e8b43491d957bd9494ab457cc14",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0x143fc5aea202b0986b809c796ddbd0a15b9871c658fd3cf2e3fa42273d96a8df",
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
  "sourceGraph": "7b67bcbb7c5941a24471e62ba5a0d939c0800671b0bf121e81bad14cca737456",
  "recorderArtifact": "687965246fa31bb25a1c50f7b486d006e7b46d8e4efafb0af5c328944304522d",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0xcCc11E2263A11F6f0738AC2Af46ead453eD532b2",
  "runtimeHash": "0xeb1d223d80b7a91a98a73563d892b7b13981b0fe20074e6600198ce9297af2ff",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "10080613",
  "deploymentBlockHash": "0xe4f0ce8af994e14fa45ff9e578387f523b1f3e78879986494d7776684c6e6b53",
  "deploymentTransactionHash": "0xf8552cfcd4484dc9ac070828ef8448dd62443579d50c9bc83c48fb1d034396d0",
  "source": "0xaB5374daddeA783C3e58DE19DB497B54C79fD4cc",
  "sourceRuntimeHash": "0xdf5bb9ac50ee3bf8f554d9d80c192918eebe2e8b43491d957bd9494ab457cc14",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0x48df34a63e5d8da0f6de45b87355b5fb0ca81f7c8c1dceea9f71977e0c03b1df",
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
