import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AbiCoder, Interface } from '@coti-io/coti-ethers';
import { CURRENT_DEX_DAILY_PRICE_ARTIFACT } from './currentDexDailyPriceArtifact';
import { CURRENT_DEX_DAILY_PRICE_CONFIG,readCurrentDexDailyPrice,isVerifiedCurrentDexDailyPrice } from './currentDexDailyPrice';
import { HISTORY_FIXTURE_DAY,makeHistoryFixture } from '../../tests/fixtures/history.fixture';

describe('Current DEX daily price source boundary',()=>{
  it.each(['zero-revision','current-block-time','current-block-reorg'] as const)('rejects current observation %s before issuing a verified snapshot',async fault=>{
    const f=makeHistoryFixture(),coder=AbiCoder.defaultAbiCoder();let reads=0;
    const provider={request:async(args:Parameters<typeof f.provider.request>[0]):Promise<unknown>=>{
      const raw=await f.provider.request(args);
      if(args.method==='eth_getBlockByNumber'&&(args.params as unknown[])[0]==='0x63'){
        reads++;
        if(fault==='current-block-time')return {...raw as object,timestamp:'0x1'};
        if(fault==='current-block-reorg'&&reads>1)return {...raw as object,hash:`0x${'77'.repeat(32)}`};
      }
      if(fault==='zero-revision'&&args.method==='eth_call'&&((args.params as unknown[])[0] as {to:string}).to===f.manifest.source){
        const encoded=coder.decode(['bytes'],raw as string)[0],values=coder.decode(f.observationTypes,encoded).toArray();
        values[18]=0n;return coder.encode(['bytes'],[coder.encode(f.observationTypes,values)]);
      }
      return raw;
    }};
    await expect(readCurrentDexDailyPrice({provider,manifest:f.manifest,finalityLagBlocks:0})).rejects.toThrow();
  });
  it('issues an immutable current observation independently of the saved sample',async()=>{
    const f=makeHistoryFixture(),s=await readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0});
    expect(s.currentObservation).toEqual({priceE18:'2000000000000000000',sampledAt:String(HISTORY_FIXTURE_DAY*86400n+90n),sampledBlock:'99',revision:'3'});
    expect(Object.isFrozen(s.currentObservation)).toBe(true);
    expect(s.slots.filter(v=>v.point).map(v=>v.point!.sourceRevision)).toEqual(['1','2']);
    f.setMode('stale');const stale=await readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0});
    expect(stale.currentObservation).toBeUndefined();expect(stale.slots.filter(v=>v.point)).toHaveLength(2);
  });
  it('keeps production inactive and binds the exact accepted recorder artifact',()=>{
    expect(CURRENT_DEX_DAILY_PRICE_CONFIG.status).toBe('inactive');
    const bytes=readFileSync('../ChainWhisper Contracts V2/validation/candidates/daily-price-history-2026-10-03/local-build-1/ChainWhisperDailyPoolPrice.json');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(CURRENT_DEX_DAILY_PRICE_ARTIFACT.artifactSha256);
    const a=JSON.parse(bytes.toString());expect(CURRENT_DEX_DAILY_PRICE_ARTIFACT.abi).toEqual(a.abi);expect(CURRENT_DEX_DAILY_PRICE_ARTIFACT.deployedBytecode).toBe(a.deployedBytecode);
  });
  it('reads at most32 slots with two actual-time samples and explicit gaps',async()=>{
    const f=makeHistoryFixture(),s=await readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0});
    expect(isVerifiedCurrentDexDailyPrice(s)).toBe(true);expect(isVerifiedCurrentDexDailyPrice({...s})).toBe(false);
    expect(s.slots).toHaveLength(32);expect(s.slots.filter(s=>s.point)).toHaveLength(2);
    expect(s.slots[31]).toEqual({day:String(HISTORY_FIXTURE_DAY),point:null});
    const point=s.slots[30].point!;expect(point.priceE18).toBe('2000000000000000000');expect(point.sampledAt).toBe(String((HISTORY_FIXTURE_DAY-1n)*86400n+7200n));expect(point.recordedAt).toBe(String(BigInt(point.sampledAt)+5n));expect(point.sampledBlock).toBe('90');expect(point.sourceBlockHash).toBe(f.header(90n).hash);
  });
  it.each(['empty','stale','suppressed','unobserved'] as const)('keeps %s current source separate from saved history',async mode=>{
    const f=makeHistoryFixture(mode),s=await readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0});expect(s.currentReference).toBe(mode==='suppressed'?'suppressed-or-changed':mode==='empty'?'available':mode);expect(s.slots.filter(v=>v.point)).toHaveLength(mode==='empty'?0:2);
  });
  it.each(['rpc','reorg','mismatch'] as const)('rejects %s without an accepted partial page',async mode=>{
    const f=makeHistoryFixture(mode);await expect(readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0})).rejects.toMatchObject({kind:mode});
  });
  it.each(['sourceGraph','recorderArtifact','genesisHash','deploymentBlockHash','sourceRuntimeHash','pair','releaseId','token0RuntimeHash'] as const)('rejects changed manifest %s',async field=>{
    const f=makeHistoryFixture(),manifest={...f.manifest,[field]:`0x${'66'.repeat(32)}`};await expect(readCurrentDexDailyPrice({provider:f.provider,manifest,finalityLagBlocks:0})).rejects.toThrow();
  });
  it('rejects bounds, each malformed observation field and unit drift',async()=>{
    const f=makeHistoryFixture();for(const count of[0,33])await expect(readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,count,finalityLagBlocks:0})).rejects.toThrow();
    const api=new Interface(CURRENT_DEX_DAILY_PRICE_ARTIFACT.abi);
    for(const field of[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]){
      const provider={request:async(args:Parameters<typeof f.provider.request>[0])=>{const raw=await f.provider.request(args);if(args.method!=='eth_call')return raw;const call=(args.params as unknown[])[0] as {to:string;data:string};if(call.to!==f.manifest.address)return raw;const parsed=api.parseTransaction({data:call.data});if(parsed?.name!=='getDays')return raw;const page=api.decodeFunctionResult('getDays',raw as string)[0].toArray(true);const row=page.find((r:unknown[])=>r[1]===true) as unknown[];const o=row[2] as unknown[];o[field]=typeof o[field]==='boolean'?false:typeof o[field]==='bigint'?0n:typeof o[field]==='string'&&String(o[field]).length===42?`0x${'00'.repeat(20)}`:`0x${'00'.repeat(32)}`;return api.encodeFunctionResult('getDays',[page]);}};
      await expect(readCurrentDexDailyPrice({provider,manifest:f.manifest,finalityLagBlocks:0})).rejects.toThrow();
    }
    await expect(readCurrentDexDailyPrice({provider:f.provider,manifest:{...f.manifest,decimals0:6},finalityLagBlocks:0})).rejects.toThrow();
  });
  it.each(['future','day-boundary','aged','record-before-source','duplicate-revision','unordered-days','dirty-gap','constructor','failed-deployment','source-block-time','source-block-reorg'] as const)('rejects %s without a partial snapshot',async fault=>{
    const f=makeHistoryFixture(),api=new Interface(CURRENT_DEX_DAILY_PRICE_ARTIFACT.abi);let readSourceBlock=0;
    const provider={request:async(args:Parameters<typeof f.provider.request>[0]):Promise<unknown>=>{
      const raw=await f.provider.request(args);
      if(args.method==='eth_getTransactionReceipt'&&fault==='failed-deployment')return {...raw as object,status:'0x0'};
      if(args.method==='eth_getBlockByNumber'&&(args.params as unknown[])[0]==='0x50'){
        readSourceBlock++;if(fault==='source-block-time')return {...raw as object,timestamp:'0x1'};
        if(fault==='source-block-reorg'&&readSourceBlock>1)return {...raw as object,hash:`0x${'77'.repeat(32)}`};
      }
      if(args.method!=='eth_call')return raw;const call=(args.params as unknown[])[0] as {to:string;data:string};if(call.to!==f.manifest.address)return raw;
      const parsed=api.parseTransaction({data:call.data});
      if(parsed?.name==='MAX_PAGE'&&fault==='constructor')return api.encodeFunctionResult('MAX_PAGE',[31]);
      if(parsed?.name!=='getDays')return raw;
      const page=api.decodeFunctionResult('getDays',raw as string)[0].toArray(true) as unknown[][];
      const rows=page.filter(r=>r[1]===true),row=rows[0],o=row[2] as bigint[];
      if(fault==='future'){o[16]=HISTORY_FIXTURE_DAY*86400n+1000n;row[3]=o[16]+5n;}
      if(fault==='day-boundary')o[16]=(BigInt(row[0] as bigint)+1n)*86400n;
      if(fault==='aged')row[3]=o[16]+121n;
      if(fault==='record-before-source')row[4]=o[17]-1n;
      if(fault==='duplicate-revision')(rows[1][2] as bigint[])[18]=o[18];
      if(fault==='unordered-days')page[0][0]=BigInt(page[0][0] as bigint)+1n;
      if(fault==='dirty-gap')(page[0][2] as bigint[])[18]=1n;
      return api.encodeFunctionResult('getDays',[page]);
    }};
    await expect(readCurrentDexDailyPrice({provider,manifest:f.manifest,finalityLagBlocks:0})).rejects.toThrow();
  });
});
