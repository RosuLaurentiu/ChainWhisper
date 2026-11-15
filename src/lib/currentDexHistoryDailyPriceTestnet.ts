import { AbiCoder, keccak256 } from '@coti-io/coti-ethers';
import { COTI_TESTNET_NETWORK } from './chainWhisperNetworks';
import { PACKED_INPUT_DEX_DAILY_PRICE_SOURCE, type CurrentDexDailyPriceConfig, type CurrentDexDailyPriceManifest } from './currentDexDailyPrice';
import { readCurrentDexDisplay } from './currentDexDisplay';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import type { CurrentCheapDexCandidate } from './dexV2Deployment';

// Six canonical graph9c exports; see reports/c1-gap-adoption-2026-11-15.
export const HISTORY_TESTNET_DEX_DAILY_PRICE_MANIFESTS: readonly CurrentDexDailyPriceManifest[] = Object.freeze([
  Object.freeze({...{
  "sourceGraph": "9c2cb36f958dc21ef11bf7d91ebf0373904a3d741edd6bf9eeae25752960631e",
  "recorderArtifact": "b7d1a1aa0e50252755b0be56922622c4f5ca7124d5e94b3d3995101adea80f6d",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0x06d2753057859F352754BeDae14419c019Cc4515",
  "runtimeHash": "0xde888393c55137c51587faac20565b446642f9b505c402c868019becdb6c28be",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "10621382",
  "deploymentBlockHash": "0xa92f32c1f0b8f12543b73992d64da59325c5fa26e72bce3699a9445043688198",
  "deploymentTransactionHash": "0x01781bd7dc4300d60cdaee1a6767479790d7fc360abdbed1cc33fe7a2e287260",
  "source": "0xdB4Ff69E687907dA576dfbE9F2361785CdE5727e",
  "sourceRuntimeHash": "0x1323551e49525d6c732e4560f364f7006dec13d5bc1fc562f9a78d575b9b4b41",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0x9225c08f8f5f0d6495d9f36407c20ed2d9693cf338f52d8d8c86dc097bc036d8",
  "pair": "0x3717864b0bdf813c3d0e34112b351fa40fb4661f8cdf6af296e7afb581ba8736",
  "canonicalId": "1",
  "token0": "0x5181B25e7AD744E635fe048D388Fd820f943e582",
  "token1": "0xe595F63789D1D31B4b7c0Bee69062Daf5BE81ac8",
  "decimals0": 6,
  "decimals1": 6,
  "token0RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "token1RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0"
},symbols:Object.freeze(["HBR","BCN"] as const)}),
  Object.freeze({...{
  "sourceGraph": "9c2cb36f958dc21ef11bf7d91ebf0373904a3d741edd6bf9eeae25752960631e",
  "recorderArtifact": "b7d1a1aa0e50252755b0be56922622c4f5ca7124d5e94b3d3995101adea80f6d",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0x1075ef5Ca80eAB9242069151B3AC096473296de2",
  "runtimeHash": "0xa812809f8dcb3bfeecb112904260325205aa31410a9afc99843fbdd4aa839133",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "10621384",
  "deploymentBlockHash": "0x2b06e3ed5ef23fbf7a416f71ad50ea3a5e687ba9d86b284bd1d14d52a36c9120",
  "deploymentTransactionHash": "0xc9c3c93e942196ace857a282dc22e6a5ea287067a91aa6402e99c69eb1a96cc9",
  "source": "0xdB4Ff69E687907dA576dfbE9F2361785CdE5727e",
  "sourceRuntimeHash": "0x1323551e49525d6c732e4560f364f7006dec13d5bc1fc562f9a78d575b9b4b41",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0xf2bf19355bbe3605833876a4e20329dab455419ddfb4a9ad5f833f459bf0d0cc",
  "pair": "0xd48b20c307c74255e81488248c822739421fdc18f0c0b425776cdff19f5f1459",
  "canonicalId": "2",
  "token0": "0x99B7D4CEF854CA380Be0c49863F761670A57F0B3",
  "token1": "0xe595F63789D1D31B4b7c0Bee69062Daf5BE81ac8",
  "decimals0": 6,
  "decimals1": 6,
  "token0RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "token1RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0"
},symbols:Object.freeze(["EMBR","BCN"] as const)}),
  Object.freeze({...{
  "sourceGraph": "9c2cb36f958dc21ef11bf7d91ebf0373904a3d741edd6bf9eeae25752960631e",
  "recorderArtifact": "b7d1a1aa0e50252755b0be56922622c4f5ca7124d5e94b3d3995101adea80f6d",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0x564f86Eae95b0E351E729F83A05C8bb8999c36CE",
  "runtimeHash": "0x7258a98ad1b1233b0772ac002157400b4f887e1ea31d85c6f19f4d2e622fd58c",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "10621386",
  "deploymentBlockHash": "0xb4f52666f1c1562683f6bbb9748673200424d53eeb9fa6703c059e6d6d4f8373",
  "deploymentTransactionHash": "0x2a906a170601838acc77f1579cb502716b71b7a8b022c98ea27a90fd9edd7abe",
  "source": "0xdB4Ff69E687907dA576dfbE9F2361785CdE5727e",
  "sourceRuntimeHash": "0x1323551e49525d6c732e4560f364f7006dec13d5bc1fc562f9a78d575b9b4b41",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0xe7c57f31cb39b185d4993eb70df282f2a17947416ed5e165ca00e0f8448b847c",
  "pair": "0xa7c153e1a9f411e2db70a5318e4c9bacc0fac91b25191f978f159d26e66e8539",
  "canonicalId": "3",
  "token0": "0x8e8f1142EFE829fbDF2FEcBa7A2fa0e472B5b703",
  "token1": "0xe595F63789D1D31B4b7c0Bee69062Daf5BE81ac8",
  "decimals0": 6,
  "decimals1": 6,
  "token0RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "token1RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0"
},symbols:Object.freeze(["ORBT","BCN"] as const)}),
  Object.freeze({...{
  "sourceGraph": "9c2cb36f958dc21ef11bf7d91ebf0373904a3d741edd6bf9eeae25752960631e",
  "recorderArtifact": "b7d1a1aa0e50252755b0be56922622c4f5ca7124d5e94b3d3995101adea80f6d",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0x852ec3a79659ABeA85855aF442Df565BB00242B0",
  "runtimeHash": "0x1853adf82d99ac015cfa09523a2781ffa36babe573bb541484b6f685b5bb3f3c",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "10621388",
  "deploymentBlockHash": "0xd9874436e7e349e16194b2f65a1cb0cc8b369d62a84b69d1b9dc2a06be14ab52",
  "deploymentTransactionHash": "0x12e12fecb92a74b1ee5df731b1c1d36e151607d943f99b51f9bd09a2d5906c02",
  "source": "0xdB4Ff69E687907dA576dfbE9F2361785CdE5727e",
  "sourceRuntimeHash": "0x1323551e49525d6c732e4560f364f7006dec13d5bc1fc562f9a78d575b9b4b41",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0x0c5efdefb896dd15e366d0993e92c237e772f32f6c15bdec16bb9e4d8312baf6",
  "pair": "0xc4bf3ea6d6f8fd04160c5c6b98784c2263a0c19ca128681d2579d7abe0f2c674",
  "canonicalId": "4",
  "token0": "0x5181B25e7AD744E635fe048D388Fd820f943e582",
  "token1": "0x99B7D4CEF854CA380Be0c49863F761670A57F0B3",
  "decimals0": 6,
  "decimals1": 6,
  "token0RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "token1RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0"
},symbols:Object.freeze(["HBR","EMBR"] as const)}),
  Object.freeze({...{
  "sourceGraph": "9c2cb36f958dc21ef11bf7d91ebf0373904a3d741edd6bf9eeae25752960631e",
  "recorderArtifact": "b7d1a1aa0e50252755b0be56922622c4f5ca7124d5e94b3d3995101adea80f6d",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0xb9dbF7E5266265871e70c81b0AD10a531BE8682f",
  "runtimeHash": "0x01e1047681187a1e92eb34dc251f24b457b5bdb388f3033cbca1a7eec159cc98",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "10621390",
  "deploymentBlockHash": "0x0b2b96a8a7f2e084509528321455206ba3b288da562ac37cba6d71bdefb209eb",
  "deploymentTransactionHash": "0x6609a0d1901798274e7602b6efaa9c9a38fc349707bb06ed2ff9b79a41844c6d",
  "source": "0xdB4Ff69E687907dA576dfbE9F2361785CdE5727e",
  "sourceRuntimeHash": "0x1323551e49525d6c732e4560f364f7006dec13d5bc1fc562f9a78d575b9b4b41",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0x49d1c868f05d1e3ff38586ae0b95458f8b022a9e9dcd232a3f5115224d45fcee",
  "pair": "0x0aa83caa8aafe0758e52f4ba3dd8fba633c7b516bfaac5c815204b63fa12ef99",
  "canonicalId": "5",
  "token0": "0x5181B25e7AD744E635fe048D388Fd820f943e582",
  "token1": "0x8e8f1142EFE829fbDF2FEcBa7A2fa0e472B5b703",
  "decimals0": 6,
  "decimals1": 6,
  "token0RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "token1RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0"
},symbols:Object.freeze(["HBR","ORBT"] as const)}),
  Object.freeze({...{
  "sourceGraph": "9c2cb36f958dc21ef11bf7d91ebf0373904a3d741edd6bf9eeae25752960631e",
  "recorderArtifact": "b7d1a1aa0e50252755b0be56922622c4f5ca7124d5e94b3d3995101adea80f6d",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0x9d994a4A634598A90e4A24Eb8841DCB716671630",
  "runtimeHash": "0x1eef696e08945e3e9b2a0d9c92cd6939e8c82a10df30a2085ecf3a7cbbe43dd7",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "10621392",
  "deploymentBlockHash": "0x9e3b049f041ecb1ac28fa3c94d05a66dddde9586b540fb990546092e729effcd",
  "deploymentTransactionHash": "0x674c29be175fe48077f7d61bbde7dea2d382361fd499f7bafc0436b735da4726",
  "source": "0xdB4Ff69E687907dA576dfbE9F2361785CdE5727e",
  "sourceRuntimeHash": "0x1323551e49525d6c732e4560f364f7006dec13d5bc1fc562f9a78d575b9b4b41",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0x5cfb2c0d7009006189afe8665eebed53695436cd0bbd617aba0bb1e8f5ad2557",
  "pair": "0x6ece32731716cb1a42a55cab5b45dc8b0e91c6333bc381dc2051643c8c239e81",
  "canonicalId": "6",
  "token0": "0x8e8f1142EFE829fbDF2FEcBa7A2fa0e472B5b703",
  "token1": "0x99B7D4CEF854CA380Be0c49863F761670A57F0B3",
  "decimals0": 6,
  "decimals1": 6,
  "token0RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "token1RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0"
},symbols:Object.freeze(["ORBT","EMBR"] as const)})
]);
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
