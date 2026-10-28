import { AbiCoder, keccak256, toBeHex } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import { readCurrentDexOwnedPositionIds } from './currentDexOwnedPositions';
import { resolvePreparedDexScope } from './currentDexPreparedScope';

const owner = `0x${'22'.repeat(20)}`, other = `0x${'33'.repeat(20)}`, hash = toBeHex(100n,32);
const slot = (key: bigint|string, root: bigint, type='uint256') => keccak256(AbiCoder.defaultAbiCoder().encode([type,'uint256'],[key,root]));
function fixture(key:'cheap-exit'|'cheap-history'='cheap-exit') {
  const candidate=resolvePreparedDexScope(key).candidate, nft=candidate.companions.find(([name])=>name==='ChainWhisperDexPositionNFT')![1];
  const words=new Map<string,string>([[`${candidate.core}:0x0b`,toBeHex(45n,32)],[`${nft}:${slot(owner,3n,'address')}`,toBeHex(2n,32)],
    [`${nft}:${slot(43n,2n)}`,toBeHex(BigInt(owner),32)],[`${nft}:${slot(44n,2n)}`,toBeHex(BigInt(other),32)],
    [`${nft}:${slot(45n,2n)}`,toBeHex(BigInt(owner),32)]]);
  const assertCurrent=vi.fn(), rpc=vi.fn(async (method:string,params:readonly unknown[])=>{
    expect(method).toBe('eth_getStorageAt'); expect(params[2]).toEqual({blockHash:hash,requireCanonical:true});
    return words.get(`${params[0]}:${params[1]}`)??toBeHex(0n,32);
  });
  const read=()=>readCurrentDexOwnedPositionIds({candidate:key,owner,block:{number:10n,hash},rpc,assertCurrent});
  return{read,words,candidate,nft,rpc,assertCurrent};
}
describe('canonical current owner NFT inventory',()=>{
  it.each(['cheap-exit','cheap-history']as const)('finds owned IDs only in %s without history or private decryption',async key=>{
    const f=fixture(key); expect(await f.read()).toMatchObject({positionIds:[43n,45n],complete:true,readyToSign:false});
    expect(f.rpc).toHaveBeenCalledTimes(47);
  });
  it('returns an honest empty inventory from a canonical zero balance',async()=>{
    const f=fixture(); f.words.set(`${f.nft}:${slot(owner,3n,'address')}`,toBeHex(0n,32));
    expect(await f.read()).toMatchObject({positionIds:[],complete:true}); expect(f.rpc).toHaveBeenCalledTimes(2);
  });
  it('does not claim completeness outside the existing 128-ID layout scope',async()=>{
    const f=fixture(); f.words.set(`${f.candidate.core}:0x0b`,toBeHex(129n,32));
    expect(await f.read()).toMatchObject({positionIds:[],complete:false}); expect(f.rpc).toHaveBeenCalledTimes(2);
  });
  it.each(['balance','word','address','rpc','lease'] as const)('rejects %s failure instead of showing empty history',async fault=>{
    const f=fixture();
    if(fault==='balance')f.words.set(`${f.nft}:${slot(owner,3n,'address')}`,toBeHex(3n,32));
    if(fault==='word')f.words.set(`${f.nft}:${slot(43n,2n)}`,'0x12');
    if(fault==='address')f.words.set(`${f.nft}:${slot(43n,2n)}`,toBeHex((1n<<160n)+BigInt(owner),32));
    if(fault==='rpc')f.rpc.mockRejectedValue(new Error('RPC unavailable'));
    if(fault==='lease')f.assertCurrent.mockImplementation(()=>{throw new Error('Revoked owner');});
    await expect(f.read()).rejects.toThrow();
  });
});
