import { Interface, keccak256 } from '@coti-io/coti-ethers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PACKED_INPUT_DEX_DAILY_PRICE_ARTIFACT as artifact } from './packedInputDexDailyPriceArtifact';
import { PACKED_INPUT_DEX_DAILY_PRICE_SOURCE as source, readCurrentDexDailyPrice } from './currentDexDailyPrice';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as selected } from './selectedCurrentDexCandidate';
import { readCurrentDexPublicReference } from './currentDexDailyPrice';
import { CURRENT_DEX_DAILY_PRICE_SOURCE, CURRENT_NATIVE_DEX_DAILY_PRICE_SOURCE, CURRENT_D06_DEX_DAILY_PRICE_SOURCE, CURRENT_EXIT_DEX_DAILY_PRICE_SOURCE, CURRENT_HISTORY_DEX_DAILY_PRICE_SOURCE, LOW_RPC_DEX_DAILY_PRICE_SOURCE, REFERENCE_DEX_DAILY_PRICE_SOURCE } from '../../tests/fixtures/historicalDailyPriceSources';
import { makeHistoryFixture } from '../../tests/fixtures/history.fixture';

afterEach(()=>vi.restoreAllMocks());
const fixture=(mode:Parameters<typeof makeHistoryFixture>[0]='ready')=>{
  const f=makeHistoryFixture(mode);
  vi.spyOn(Date,'now').mockReturnValue(Number(BigInt(f.header(100n).timestamp))*1000);
  return f;
};
describe('packed-input current chart',()=>{
  it.each(['ready','empty','stale','suppressed','unobserved'] as const)('reads current %s state independently from saved daily samples',async mode=>{
    const f=fixture(mode),s=await readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0});
    expect(s.manifest.sourceGraph).toBe(source.graph);
    expect(s.slots).toHaveLength(32);expect(s.slots.filter(x=>x.point)).toHaveLength(mode==='empty'?0:2);
    expect(s.currentReference).toBe(['ready','empty','stale'].includes(mode)?'available':mode==='suppressed'?'suppressed-or-changed':mode);
    if(mode==='ready'||mode==='empty'||mode==='stale')expect(s.currentObservation).toMatchObject({priceE18:'2000000000000000000',checkedAt:String(BigInt(f.header(100n).timestamp))});
    else expect(s.currentObservation).toBeUndefined();
  });
  it('rejects a stale checked head even when saved samples are valid',async()=>{
    const f=fixture();vi.mocked(Date.now).mockReturnValue((Number(BigInt(f.header(100n).timestamp))+121)*1000);
    await expect(readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0})).rejects.toThrow('checked head is stale');
  });
  it.each(['rpc','reorg','mismatch'] as const)('rejects %s without accepting a partial page',async mode=>{
    const f=fixture(mode);await expect(readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0})).rejects.toMatchObject({kind:mode});
  });
  it.each(['artifact','runtime','policy'] as const)('rejects a changed recorder %s',async fault=>{
    const f=fixture(),api=new Interface(artifact.abi);let calls=0;
    const provider={request:async(args:Parameters<typeof f.provider.request>[0])=>{calls++;
      if(fault==='runtime'&&args.method==='eth_getCode'&&(args.params as unknown[])[0]===f.manifest.address)return '0x6003';
      if(fault==='policy'&&args.method==='eth_call'){const c=(args.params as unknown[])[0] as {to:string;data:string};if(c.to===f.manifest.address&&api.parseTransaction({data:c.data})?.name==='POLICY')return api.encodeFunctionResult('POLICY',['0x'+'11'.repeat(32)]);}
      return f.provider.request(args);
    }};
    const manifest=fault==='artifact'?{...f.manifest,recorderArtifact:'00'.repeat(32)}:fault==='runtime'?{...f.manifest,runtimeHash:keccak256('0x6003')}:f.manifest;
    await expect(readCurrentDexDailyPrice({provider,manifest,finalityLagBlocks:0})).rejects.toThrow();
    if(fault==='artifact')expect(calls).toBe(0);
  });
});

describe('current price admission excludes previous contracts',()=>{
  it.each([CURRENT_DEX_DAILY_PRICE_SOURCE,CURRENT_NATIVE_DEX_DAILY_PRICE_SOURCE,CURRENT_D06_DEX_DAILY_PRICE_SOURCE,CURRENT_EXIT_DEX_DAILY_PRICE_SOURCE,CURRENT_HISTORY_DEX_DAILY_PRICE_SOURCE,LOW_RPC_DEX_DAILY_PRICE_SOURCE,REFERENCE_DEX_DAILY_PRICE_SOURCE])('rejects old graph $graph before RPC',async old=>{
    const f=fixture();let calls=0;const provider={request:async()=>{calls++;throw Error('MUST_NOT_READ');}};
    await expect(readCurrentDexDailyPrice({provider,manifest:{...f.manifest,sourceGraph:old.graph,recorderArtifact:old.recorderArtifact}})).rejects.toThrow('candidate');expect(calls).toBe(0);
  });
  // decision-034: the d06 and b2aa descriptors were removed; changed identities stand for any other Core.
  it.each([{...selected,graph:'11'.repeat(32)},{...selected,core:`0x${'33'.repeat(20)}`}])('rejects old Core $graph before RPC',async candidate=>{
    let calls=0;const provider={request:async()=>{calls++;throw Error('MUST_NOT_READ');}};
    await expect(readCurrentDexPublicReference({provider,candidate:candidate as never,pair:['HBR','BCN']})).rejects.toThrow('candidate');expect(calls).toBe(0);
  });
});

it.each([6,18])('keeps E18 price units with %i-decimal current tokens',async decimals=>{
 const f=makeHistoryFixture('ready',2n*10n**18n,decimals);
 const snapshot=await readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0});
 expect(snapshot.manifest.decimals0).toBe(decimals);expect(snapshot.manifest.decimals1).toBe(decimals);
 expect(snapshot.currentObservation?.priceE18).toBe('2000000000000000000');expect(snapshot.slots.filter(x=>x.point)).toHaveLength(2);
});
