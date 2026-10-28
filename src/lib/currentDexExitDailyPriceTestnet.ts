import { AbiCoder, keccak256 } from '@coti-io/coti-ethers';
import type { CurrentCheapDexCandidate } from './dexV2Deployment';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { readCurrentDexDisplay } from './currentDexDisplay';
import { COTI_TESTNET_NETWORK } from './chainWhisperNetworks';
import { CURRENT_EXIT_DEX_DAILY_PRICE_SOURCE, type CurrentDexDailyPriceConfig, type CurrentDexDailyPriceManifest } from './currentDexDailyPrice';

// Accepted runner-v3/APP_MANIFESTS.json, SHA-256 bbfc6a2aba4df58bd176c3a031ac493ec36d38eb74be654685b5a2978c30a74e.
// Six native recorders; canonical1 retains an explicit empty history.
export const EXIT_TESTNET_DEX_DAILY_PRICE_MANIFESTS: readonly CurrentDexDailyPriceManifest[] = Object.freeze([
Object.freeze({
  "sourceGraph": "b2aa0895d7661a43e3a7db85c9ae24daaa641db238a06bec5c64d031dcf382cd",
  "recorderArtifact": "326fcb9b6347c26cdeb974efb327a7802c72245b5af7a1b2aac2a314947fe527",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0xB6d837467f8e726f44F5FBB9C2E9b59caC993568",
  "runtimeHash": "0xb4cc52e0c99eed9bea21c764ca35ef517b423daed32855a5e9c636fa8249aa95",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "9966771",
  "deploymentBlockHash": "0x78480b3200e0bdd3204d4cf9daa1863d9f1f76b4a37d2bc2d0a225d2c968751f",
  "deploymentTransactionHash": "0x3c648b5d14f45ffc481a63afecedbc1e9bd24d5bb54d30e5da83d507fea29c95",
  "source": "0x52d5D2acC60Ada57A7316de996221766BAffFe27",
  "sourceRuntimeHash": "0x58575c559e2fc41f767206fc488039d5d318d87ae53fabe816dce26dbcd02052",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0x5c25e0af1e4874c041b96ae0901478d5f86c42960b482b7e543fa6c09f9b5004",
  "pair": "0x3717864b0bdf813c3d0e34112b351fa40fb4661f8cdf6af296e7afb581ba8736",
  "canonicalId": "1",
  "token0": "0x5181B25e7AD744E635fe048D388Fd820f943e582",
  "token1": "0xe595F63789D1D31B4b7c0Bee69062Daf5BE81ac8",
  "decimals0": 6,
  "decimals1": 6,
  "token0RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "token1RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "symbols": Object.freeze(["HBR","BCN"] as const)
}),
Object.freeze({
  "sourceGraph": "b2aa0895d7661a43e3a7db85c9ae24daaa641db238a06bec5c64d031dcf382cd",
  "recorderArtifact": "326fcb9b6347c26cdeb974efb327a7802c72245b5af7a1b2aac2a314947fe527",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0x484e3dc6a608DB37513E0826831c96CF94c602E7",
  "runtimeHash": "0x1a9900edce7f2612db6e24ace2549cd6f4efc6fdb12af1808760f53719c9a530",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "9967539",
  "deploymentBlockHash": "0x1bed8294024b8251582dffa9896848ab056add38ded11fb6cf7cbc4e51c5e7b8",
  "deploymentTransactionHash": "0x1bc3c22c55b634b955be5cec89358f18117d002cf216c65786e7bad768fa864e",
  "source": "0x52d5D2acC60Ada57A7316de996221766BAffFe27",
  "sourceRuntimeHash": "0x58575c559e2fc41f767206fc488039d5d318d87ae53fabe816dce26dbcd02052",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0xcac7399d399f45c5ccac89ee1987665d168ad4f4540c76a846bc19e8162b30c2",
  "pair": "0xd48b20c307c74255e81488248c822739421fdc18f0c0b425776cdff19f5f1459",
  "canonicalId": "2",
  "token0": "0x99B7D4CEF854CA380Be0c49863F761670A57F0B3",
  "token1": "0xe595F63789D1D31B4b7c0Bee69062Daf5BE81ac8",
  "decimals0": 6,
  "decimals1": 6,
  "token0RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "token1RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "symbols": Object.freeze(["EMBR","BCN"] as const)
}),
Object.freeze({
  "sourceGraph": "b2aa0895d7661a43e3a7db85c9ae24daaa641db238a06bec5c64d031dcf382cd",
  "recorderArtifact": "326fcb9b6347c26cdeb974efb327a7802c72245b5af7a1b2aac2a314947fe527",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0x195Af705A449Ac583394A0AC4dB06C0942E4662a",
  "runtimeHash": "0x88a3625a0f982d7c498aa12b262f95515e654839618f9012696ebf874f2bad76",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "9967030",
  "deploymentBlockHash": "0xa0b32005f8c6ba0cfe923d5b50f8b7988b19dca63e3454d0f824fcd60d0b21fe",
  "deploymentTransactionHash": "0x13f93288583ea0757c83a52af5fbc172f7cb848f3498fcd3497e764791c834be",
  "source": "0x52d5D2acC60Ada57A7316de996221766BAffFe27",
  "sourceRuntimeHash": "0x58575c559e2fc41f767206fc488039d5d318d87ae53fabe816dce26dbcd02052",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0xf27e2b1a67f33f4f40ce8120ceda682386989006ce6999271760e413701218fb",
  "pair": "0xa7c153e1a9f411e2db70a5318e4c9bacc0fac91b25191f978f159d26e66e8539",
  "canonicalId": "3",
  "token0": "0x8e8f1142EFE829fbDF2FEcBa7A2fa0e472B5b703",
  "token1": "0xe595F63789D1D31B4b7c0Bee69062Daf5BE81ac8",
  "decimals0": 6,
  "decimals1": 6,
  "token0RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "token1RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "symbols": Object.freeze(["ORBT","BCN"] as const)
}),
Object.freeze({
  "sourceGraph": "b2aa0895d7661a43e3a7db85c9ae24daaa641db238a06bec5c64d031dcf382cd",
  "recorderArtifact": "326fcb9b6347c26cdeb974efb327a7802c72245b5af7a1b2aac2a314947fe527",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0x1597003D0F589E25d40c0C9A98988e9A197f3Db4",
  "runtimeHash": "0x88df0cb1a153dfd8375e3471bbf3d2df9cd2c774c8471afed1e71b989cc32cf0",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "9967597",
  "deploymentBlockHash": "0x23df28af81048c5efe0d7025036bced2602605c4dab5e9d9d67d5a19f4c8e6f6",
  "deploymentTransactionHash": "0x1f0a31659281c15680231a266d7ddf7bac5e1ec79504ac91218fbbda734feea5",
  "source": "0x52d5D2acC60Ada57A7316de996221766BAffFe27",
  "sourceRuntimeHash": "0x58575c559e2fc41f767206fc488039d5d318d87ae53fabe816dce26dbcd02052",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0xa9636953b2348837b5ca8bf3780ed0d83a535b6fcbbc656c94eea8dd560bd1ca",
  "pair": "0xc4bf3ea6d6f8fd04160c5c6b98784c2263a0c19ca128681d2579d7abe0f2c674",
  "canonicalId": "4",
  "token0": "0x5181B25e7AD744E635fe048D388Fd820f943e582",
  "token1": "0x99B7D4CEF854CA380Be0c49863F761670A57F0B3",
  "decimals0": 6,
  "decimals1": 6,
  "token0RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "token1RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "symbols": Object.freeze(["HBR","EMBR"] as const)
}),
Object.freeze({
  "sourceGraph": "b2aa0895d7661a43e3a7db85c9ae24daaa641db238a06bec5c64d031dcf382cd",
  "recorderArtifact": "326fcb9b6347c26cdeb974efb327a7802c72245b5af7a1b2aac2a314947fe527",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0x6C022Be437f312bba00ae0399166F6190773e359",
  "runtimeHash": "0xed05fb476112877418c11ad94c5cad77bb076bbafa33fd56b1d5200630be2057",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "9967655",
  "deploymentBlockHash": "0x97ccf8b7b5470bc98b39d228ec0bddb7598b0856a7ebd0a1120337489e89a3da",
  "deploymentTransactionHash": "0x3a857880d825ede046e52e876dbd0705939d367bbbb3df07241a75f019aa7ff1",
  "source": "0x52d5D2acC60Ada57A7316de996221766BAffFe27",
  "sourceRuntimeHash": "0x58575c559e2fc41f767206fc488039d5d318d87ae53fabe816dce26dbcd02052",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0x55904f11c4f7c8a4def1a5c36000856c3b0feff6ac3da4b7565feb9b0c7ba584",
  "pair": "0x0aa83caa8aafe0758e52f4ba3dd8fba633c7b516bfaac5c815204b63fa12ef99",
  "canonicalId": "5",
  "token0": "0x5181B25e7AD744E635fe048D388Fd820f943e582",
  "token1": "0x8e8f1142EFE829fbDF2FEcBa7A2fa0e472B5b703",
  "decimals0": 6,
  "decimals1": 6,
  "token0RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "token1RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "symbols": Object.freeze(["HBR","ORBT"] as const)
}),
Object.freeze({
  "sourceGraph": "b2aa0895d7661a43e3a7db85c9ae24daaa641db238a06bec5c64d031dcf382cd",
  "recorderArtifact": "326fcb9b6347c26cdeb974efb327a7802c72245b5af7a1b2aac2a314947fe527",
  "chainId": "7082400",
  "genesisHash": "0xdb0c31fec249b8bd6ec2d866ec8ec5d17bee2d7ff690bbe8190d813b92b29e8a",
  "address": "0x05365655F1E474557A8eF3768349bd8B126426A5",
  "runtimeHash": "0xa03aff8828d109d75cbc4b627d40863a60d6664dc5c7f546505dcf72fbafc9e4",
  "deployer": "0xC737b5850e15d03ed09bfAdc8A33062f6073a850",
  "deploymentBlock": "9967714",
  "deploymentBlockHash": "0x417d3aa1acad30479c35aa60aba97f4a36740f693549e19cd58665bf3a6a1c5b",
  "deploymentTransactionHash": "0xec548cbcccff984867251c3a2a11ff185d3f97df2028711183f55adce5b416e5",
  "source": "0x52d5D2acC60Ada57A7316de996221766BAffFe27",
  "sourceRuntimeHash": "0x58575c559e2fc41f767206fc488039d5d318d87ae53fabe816dce26dbcd02052",
  "releaseId": "0x9c94cf3cde6ae7a5cc913484e46d654f86db4d1ef942b9c4b42736cf9d59494b",
  "market": "0x2ecba6a1e0d08c55c6e35ca93feaf22c7f787b87c8048d9946cda7e511c03f13",
  "pair": "0x6ece32731716cb1a42a55cab5b45dc8b0e91c6333bc381dc2051643c8c239e81",
  "canonicalId": "6",
  "token0": "0x8e8f1142EFE829fbDF2FEcBa7A2fa0e472B5b703",
  "token1": "0x99B7D4CEF854CA380Be0c49863F761670A57F0B3",
  "decimals0": 6,
  "decimals1": 6,
  "token0RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "token1RuntimeHash": "0x0f9deefd8ba4019d903d9aa463895a27ec84d83dc981ba76529d4f29f7ed78f0",
  "symbols": Object.freeze(["ORBT","EMBR"] as const)
})
]);
const inactive: CurrentDexDailyPriceConfig = Object.freeze({status:'inactive'});
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();

/** Public scope check only. The maintained reader still verifies native provenance. */
export const currentExitDexDailyPriceManifestMatches=(candidate:CurrentCheapDexCandidate,selectedPair:readonly[string,string],m:CurrentDexDailyPriceManifest):boolean=>{
  try{
    const {key,candidate:c}=resolvePreparedDexScope(candidate);
    if(key!=='cheap-exit')return false;
    const display=readCurrentDexDisplay(c),pair=display.pairs.find(row=>
      row.tokens[0].label===selectedPair[0]&&row.tokens[1].label===selectedPair[1]||
      row.tokens[0].label===selectedPair[1]&&row.tokens[1].label===selectedPair[0]);
    if(!pair)return false;
    const canonical=c.pairs.find(row=>row.marketId===pair.marketId)!;
    const core=c.runtimes.find(([role])=>role==='ChainWhisperDexCore')!;
    const [token0,token1]=pair.tokens;
    return m.sourceGraph===c.graph&&m.recorderArtifact===CURRENT_EXIT_DEX_DAILY_PRICE_SOURCE.recorderArtifact&&
      m.chainId===c.chainId&&same(m.genesisHash,c.genesisHash)&&same(m.source,c.core)&&same(m.sourceRuntimeHash,core[2])&&
      same(m.releaseId,c.releaseId)&&same(m.market,pair.marketId)&&m.canonicalId===canonical.canonicalId&&
      same(m.token0,token0.address)&&same(m.token1,token1.address)&&m.decimals0===token0.decimals&&m.decimals1===token1.decimals&&
      same(m.token0RuntimeHash,c.tokens.find(([address])=>same(address,token0.address))![1])&&
      same(m.token1RuntimeHash,c.tokens.find(([address])=>same(address,token1.address))![1])&&
      m.symbols.length===2&&m.symbols[0]===token0.label&&m.symbols[1]===token1.label&&
      same(m.pair,keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','address','address'],[c.chainId,token0.address,token1.address])));
  }catch{return false;}
};

export const currentExitDexDailyPriceConfig=(candidate:CurrentCheapDexCandidate,selectedPair:readonly[string,string]):CurrentDexDailyPriceConfig=>{
  const matches=EXIT_TESTNET_DEX_DAILY_PRICE_MANIFESTS.filter(m=>currentExitDexDailyPriceManifestMatches(candidate,selectedPair,m));
  if(matches.length!==1)return inactive;
  return Object.freeze({status:'active',manifest:matches[0],rpcUrl:COTI_TESTNET_NETWORK.rpcUrl,finalityLagBlocks:2});
};
