import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Interface } from '@coti-io/coti-ethers';
import { describe,expect,it } from 'vitest';
import { currentPoolPositionAbi,currentPoolNftAbi,checkCurrentPoolPositionValues,decodeCurrentPoolNftTransfer,currentPoolOwnerGasCap } from './currentDexPoolPosition';
const require=createRequire(import.meta.url);
describe('frozen current liquidity claim interface',()=>{
  it('keeps action-specific native diagnostic caps',()=>{
    expect(['withdraw','transfer','activate','resume','close'].map(action=>currentPoolOwnerGasCap(action as Parameters<typeof currentPoolOwnerGasCap>[0]))).toEqual([100_000_000n,10_000_000n,30_000_000n,30_000_000n,30_000_000n]);
    expect(()=>currentPoolOwnerGasCap('other' as never)).toThrow();
  });
  it('binds admitted caps to the completed native EOA evidence, without running a native helper',()=>{
    const root=resolve(process.cwd(),'../ChainWhisper Contracts V2/validation/candidates/direct-limit-match-2026-09-30/current-integration/app-owner-proof');
    for(const [name,pin]of [['native-manifest-1.json','e3c31852ce9eedc75566e98d4e6d3508dfe9b81c4fa726077daee1fcb55c2892'],['native-owner-1.jsonl','6303608f27335796d2982b979caa4e46373e1f3118954c69f4b7b9a26a944d1f'],['root-checker-revision-1.json','2fadcff41880de1b41dcd017a8e33a94332c44a5ffe5cb89fb163767c4fd9e21']])expect(createHash('sha256').update(readFileSync(resolve(root,name))).digest('hex')).toBe(pin);
    const manifest=JSON.parse(readFileSync(resolve(root,'native-manifest-1.json'),'utf8'));
    expect(manifest.graph).toBe('04ea108dd247d39d1158a0c441ddd9119efe05de5c9217b38c2a3d048944c1fc');expect(manifest.package).toBe('c7a2afd6c6dcd9b72129dfc62fb5285965e83cf547ac1ca972ed8b6d56a3a7ad');
    for(const [action,field]of [['withdraw','withdraw'],['transfer','transfer-out'],['activate','activate-other'],['resume','resume-other']]as const)expect(currentPoolOwnerGasCap(action)).toBe(BigInt(manifest.gasLimits[field]));
  });
  it('matches candidate-bound Core/NFT function selectors and all output types',()=>{
    // Offline bound compiler/artifact reads. No runner or RPC action is invoked.
    const candidate=require(resolve(process.cwd(),'../ChainWhisper Contracts V2/validation/candidates/direct-limit-match-2026-09-30/current-integration/candidate-binding.cjs')).loadCandidate();
    expect(candidate.graphSha256).toBe('04ea108dd247d39d1158a0c441ddd9119efe05de5c9217b38c2a3d048944c1fc');
    for(const [host,name]of[[currentPoolPositionAbi,'ChainWhisperDexCore'],[currentPoolNftAbi,'ChainWhisperDexPositionNFT']]as const){
      const frozen=new Interface(candidate.compiled(name).abi);
      host.forEachFunction(fragment=>{const target=frozen.getFunction(fragment.format('sighash'))!;expect(fragment.selector).toBe(target.selector);
        expect(fragment.outputs.map(value=>value.format('sighash'))).toEqual(target.outputs.map(value=>value.format('sighash')));});
    }
  });
  it.each(['length','class','padding','shares','negative','wide'])('rejects invalid %s owner values',fault=>{
    const values=[200n,100n,200n,400n,0n,0n,0n,0n,0n,1n];
    if(fault==='length')values.pop();if(fault==='class')values[9]=7n;if(fault==='padding')values[8]=1n;if(fault==='shares')values[2]=401n;if(fault==='negative')values[0]=-1n;if(fault==='wide')values[0]=1n<<128n;
    expect(()=>checkCurrentPoolPositionValues(values)).toThrow();
  });
  it.each(['valid','duplicate','foreign','id','owner','suffix'])('checks %s NFT authority event',fault=>{
    const nft=`0x${'11'.repeat(20)}`,from=`0x${'22'.repeat(20)}`,to=`0x${'33'.repeat(20)}`;
    const log={address:fault==='foreign'?from:nft,...currentPoolNftAbi.encodeEventLog(currentPoolNftAbi.getEvent('Transfer')!,[from,fault==='owner'?from:to,fault==='id'?9n:8n])};
    if(fault==='suffix')log.data+='00';const logs=fault==='duplicate'?[log,log]:[log];
    if(fault==='valid')expect(()=>decodeCurrentPoolNftTransfer(logs,nft,from,to,8n)).not.toThrow();else expect(()=>decodeCurrentPoolNftTransfer(logs,nft,from,to,8n)).toThrow();
  });
});
