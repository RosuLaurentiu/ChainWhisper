import { AbiCoder, keccak256 } from '@coti-io/coti-ethers';
import { COTI_TESTNET_NETWORK } from './chainWhisperNetworks';
import { PACKED_INPUT_DEX_DAILY_PRICE_SOURCE, type CurrentDexDailyPriceConfig, type CurrentDexDailyPriceManifest } from './currentDexDailyPrice';
import { readCurrentDexDisplay } from './currentDexDisplay';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import type { CurrentCheapDexCandidate } from './dexV2Deployment';

// Six canonical build 13 recorder exports.
const BUILD13_TESTNET_DAILY_PRICE_MANIFESTS = [
  {
    "sourceGraph": "5045070b8faad2caab781e2981ad3300b7d916016b7a1d354fe59b12a1d1c239",
    "recorderArtifact": "44731a0f1b9dcdba867b17e165bc139c3e0f2cbfd7c55de7d82b60333bf06efb",
    "chainId": "7082400",
    "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
    "address": "0x0f9Db4dD93dFF234aFfEbC15c416D6da50eCb7af",
    "runtimeHash": "0x57bb24be23a3c6c6b484605977bcdc1f39660756b22b20c10d8555c5ce8fd756",
    "deployer": "0x8b749251CF1f712D4e39FD048C53394af03E10bE",
    "deploymentBlock": "10790253",
    "deploymentBlockHash": "0xc863528f670c4a3f6a7c89f8f37621ef26475a95b0fe4156ee93adc08fcd3899",
    "deploymentTransactionHash": "0x16dce9dec9b8b691d668f2300b20ea9c4cfd171de459fef2bec1d4f4b37a52d4",
    "source": "0xbbe7fc39f326fdebc018476cde9b46bf71af90b1",
    "sourceRuntimeHash": "0x3f42c901c1e7f8cd20095801a685c23c4ac61ce0921822b29c08a3d974c94807",
    "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
    "market": "0xb70b7746d3e5fad7401f768a6c3916d7c5865d8f551f3c91d17e4a48b72e6769",
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
  },
  {
    "sourceGraph": "5045070b8faad2caab781e2981ad3300b7d916016b7a1d354fe59b12a1d1c239",
    "recorderArtifact": "44731a0f1b9dcdba867b17e165bc139c3e0f2cbfd7c55de7d82b60333bf06efb",
    "chainId": "7082400",
    "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
    "address": "0x7cCC22381a37E4929D26A4ED7C91c8aA5EE9cADe",
    "runtimeHash": "0xa6c41a4c530f85c6d450895c7e17ab55663373120ac21d427adb2342cd07e5cd",
    "deployer": "0x8b749251CF1f712D4e39FD048C53394af03E10bE",
    "deploymentBlock": "10790255",
    "deploymentBlockHash": "0x5f99354110206d4d280349d2cccb9f50f574e512ad0729dfc5105cc4b036a6e9",
    "deploymentTransactionHash": "0xe9d6def61e48812f74a9c042d8a2c6e324bcd32c660eb9be72cfd03ae16233b1",
    "source": "0xbbe7fc39f326fdebc018476cde9b46bf71af90b1",
    "sourceRuntimeHash": "0x3f42c901c1e7f8cd20095801a685c23c4ac61ce0921822b29c08a3d974c94807",
    "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
    "market": "0x6f51d0ba0cd669cfe4dbf81d02e6a8b9835a49c924fe7fa6fd0931ef1507fb16",
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
  },
  {
    "sourceGraph": "5045070b8faad2caab781e2981ad3300b7d916016b7a1d354fe59b12a1d1c239",
    "recorderArtifact": "44731a0f1b9dcdba867b17e165bc139c3e0f2cbfd7c55de7d82b60333bf06efb",
    "chainId": "7082400",
    "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
    "address": "0x1796ECDF399A23b81B996F10520C1bb227E7FE9b",
    "runtimeHash": "0x60bbbbb7891f4bb07e761b04f7144566f6d04aa1621f9387884182b5dc99f44f",
    "deployer": "0x8b749251CF1f712D4e39FD048C53394af03E10bE",
    "deploymentBlock": "10790257",
    "deploymentBlockHash": "0x3c6b96106aed668ccfeaf92bd9978ea5f6e25d346cf1d725ee28333274857a39",
    "deploymentTransactionHash": "0xda2eee682798828fc14ff46fb73a9353a50af5e1ee5335fd2c2941092f32ac0a",
    "source": "0xbbe7fc39f326fdebc018476cde9b46bf71af90b1",
    "sourceRuntimeHash": "0x3f42c901c1e7f8cd20095801a685c23c4ac61ce0921822b29c08a3d974c94807",
    "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
    "market": "0x58f8b849bbd0a8b0419e4134f5badde9ba39d21dfacfd357e45af967f53944dd",
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
  },
  {
    "sourceGraph": "5045070b8faad2caab781e2981ad3300b7d916016b7a1d354fe59b12a1d1c239",
    "recorderArtifact": "44731a0f1b9dcdba867b17e165bc139c3e0f2cbfd7c55de7d82b60333bf06efb",
    "chainId": "7082400",
    "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
    "address": "0x20829c02773F6e9aF76cF5a4EbB00a515C2fc17F",
    "runtimeHash": "0xac24b76b4ee741a61b142e3663c26cb43ccafc00017c48fbd08f4ef592bbaeb3",
    "deployer": "0x8b749251CF1f712D4e39FD048C53394af03E10bE",
    "deploymentBlock": "10790259",
    "deploymentBlockHash": "0xcc9b16177cd81e04a3e76e749b2e31418ecc7c9790c3d1e3b2d8651cc2180162",
    "deploymentTransactionHash": "0xd5470c1f6fbf2f50804d7913464de28576ce91279642d2b047a8a8c9685cc5a8",
    "source": "0xbbe7fc39f326fdebc018476cde9b46bf71af90b1",
    "sourceRuntimeHash": "0x3f42c901c1e7f8cd20095801a685c23c4ac61ce0921822b29c08a3d974c94807",
    "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
    "market": "0xc077583db78c0ded2ef72d655a024d8843134ccdc01c5830a7afc760e18359d6",
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
  },
  {
    "sourceGraph": "5045070b8faad2caab781e2981ad3300b7d916016b7a1d354fe59b12a1d1c239",
    "recorderArtifact": "44731a0f1b9dcdba867b17e165bc139c3e0f2cbfd7c55de7d82b60333bf06efb",
    "chainId": "7082400",
    "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
    "address": "0x485039aD7901437a39c413Ba0a823082f11326EF",
    "runtimeHash": "0x2af4f509d985e25693d3cf6df3853a8fa34271cc20e80f4a3ade26abffd03114",
    "deployer": "0x8b749251CF1f712D4e39FD048C53394af03E10bE",
    "deploymentBlock": "10790261",
    "deploymentBlockHash": "0x59803e91fbcade290924b78f708f75e4193d133c2a93d778549dc8ef41e15584",
    "deploymentTransactionHash": "0xd17516a9140ec5c27dec018b4338ee0ddd43bb62a1df69668b998f059730f782",
    "source": "0xbbe7fc39f326fdebc018476cde9b46bf71af90b1",
    "sourceRuntimeHash": "0x3f42c901c1e7f8cd20095801a685c23c4ac61ce0921822b29c08a3d974c94807",
    "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
    "market": "0xdb38f4a70a6cb9a8bf74de1c31e1c69918eef13667a49df11df4b536f9d3e318",
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
  },
  {
    "sourceGraph": "5045070b8faad2caab781e2981ad3300b7d916016b7a1d354fe59b12a1d1c239",
    "recorderArtifact": "44731a0f1b9dcdba867b17e165bc139c3e0f2cbfd7c55de7d82b60333bf06efb",
    "chainId": "7082400",
    "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
    "address": "0xa868c21C13Fdab649fCcc846b70d37f3949eCaaF",
    "runtimeHash": "0xe220d72600dcbc1334d8fbe18a96b65a73e2bdfa7d649b321be658d6c6a32253",
    "deployer": "0x8b749251CF1f712D4e39FD048C53394af03E10bE",
    "deploymentBlock": "10790263",
    "deploymentBlockHash": "0xad105d1405cc0dfebada56459508ac3e41b2707708f6f74187e9c35555c1fe34",
    "deploymentTransactionHash": "0xd1935815532da8d53e987525f1e5767c6ae8afd146894a84549a929b2ff91d79",
    "source": "0xbbe7fc39f326fdebc018476cde9b46bf71af90b1",
    "sourceRuntimeHash": "0x3f42c901c1e7f8cd20095801a685c23c4ac61ce0921822b29c08a3d974c94807",
    "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
    "market": "0xeebfd61fbf43b12336497339ce3ba899362bfeca26907a66fda2903acef90825",
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
  }
] as const;

export const HISTORY_TESTNET_DEX_DAILY_PRICE_MANIFESTS: readonly CurrentDexDailyPriceManifest[] = Object.freeze(
  BUILD13_TESTNET_DAILY_PRICE_MANIFESTS.map(manifest => Object.freeze({...manifest,
    symbols:Object.freeze(manifest.symbols)})),
);

const inactive: CurrentDexDailyPriceConfig = Object.freeze({status:'inactive'});
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();

/** Public scope only. The daily reader verifies deployment, runtime and sample provenance. */
export const currentHistoryDexDailyPriceManifestMatches=(candidate:CurrentCheapDexCandidate,pair:readonly[string,string],m:CurrentDexDailyPriceManifest):boolean=>{
  try{
    const {key,candidate:c}=resolvePreparedDexScope(candidate);if(key!=='cheap-history'||c.graph!==PACKED_INPUT_DEX_DAILY_PRICE_SOURCE.graph)return false;
    const selected=readCurrentDexDisplay(c).pairs.find(row=>
      row.tokens[0].label===pair[0]&&row.tokens[1].label===pair[1]||row.tokens[0].label===pair[1]&&row.tokens[1].label===pair[0]);
    if(!selected)return false;
    const canonical=c.pairs.find(row=>row.marketId===selected.marketId)!,core=c.runtimes.find(([role])=>role==='ChainWhisperDexCore')!,[token0,token1]=selected.tokens;
    const source=PACKED_INPUT_DEX_DAILY_PRICE_SOURCE;
    return m.sourceGraph===c.graph&&m.recorderArtifact===source.recorderArtifact&&m.chainId===c.chainId&&same(m.genesisHash,c.genesisHash)&&
      same(m.source,c.core)&&same(m.sourceRuntimeHash,core[2])&&same(m.releaseId,c.releaseId)&&same(m.market,selected.marketId)&&m.canonicalId===canonical.canonicalId&&
      same(m.token0,token0.address)&&same(m.token1,token1.address)&&m.decimals0===token0.decimals&&m.decimals1===token1.decimals&&
      same(m.token0RuntimeHash,c.tokens.find(([address])=>same(address,token0.address))![1])&&same(m.token1RuntimeHash,c.tokens.find(([address])=>same(address,token1.address))![1])&&
      m.symbols.length===2&&m.symbols[0]===token0.label&&m.symbols[1]===token1.label&&
      same(m.pair,keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','address','address'],[c.chainId,token0.address,token1.address])));
  }catch{return false;}
};
export const currentHistoryDexDailyPriceConfig=(candidate:CurrentCheapDexCandidate,pair:readonly[string,string]):CurrentDexDailyPriceConfig=>{
  const manifests=HISTORY_TESTNET_DEX_DAILY_PRICE_MANIFESTS;
  const matches=manifests.filter(m=>currentHistoryDexDailyPriceManifestMatches(candidate,pair,m));
  return matches.length===1?Object.freeze({status:'active',manifest:matches[0],rpcUrl:COTI_TESTNET_NETWORK.rpcUrl,finalityLagBlocks:2}):inactive;
};
