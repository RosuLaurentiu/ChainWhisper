import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AbiCoder,Interface,keccak256 } from '@coti-io/coti-ethers';
import { describe,expect,it } from 'vitest';
import { CURRENT_EXIT_DEX_DAILY_PRICE_ARTIFACT as artifact } from './currentDexExitDailyPriceArtifact';
import { CURRENT_D06_DEX_DAILY_PRICE_ARTIFACT as oldArtifact } from './currentDexD06DailyPriceArtifact';
import { CURRENT_EXIT_DEX_DAILY_PRICE_SOURCE as source,readCurrentDexDailyPrice,type CurrentDexDailyPriceView } from './currentDexDailyPrice';
import { currentDexMarketReference } from './currentDexMarketReference';
import { HISTORY_FIXTURE_DAY,makeHistoryFixture,type FixtureMode } from '../../tests/fixtures/history.fixture';

// Synthetic RPC/chain only. Reuse the admitted history fixture and convert its
// observations/getters to six-decimal units and the exact new compiled artifact.
function fixture(mode:FixtureMode='ready'){
  const f=makeHistoryFixture(mode),api=new Interface(artifact.abi),coder=AbiCoder.defaultAbiCoder();
  const manifest={...f.manifest,sourceGraph:source.graph,recorderArtifact:artifact.artifactSha256,runtimeHash:keccak256(artifact.deployedBytecode),decimals0:6,decimals1:6};
  const units=(values:unknown[])=>{values[13]=6n;values[14]=6n;return values;};
  const provider={request:async(args:Parameters<typeof f.provider.request>[0]):Promise<unknown>=>{
    const params=args.params as unknown[];
    if(args.method==='eth_getCode'&&params[0]===manifest.address)return artifact.deployedBytecode;
    if(args.method==='eth_call'){
      const call=params[0]as{to:string;data:string};
      if(call.to===manifest.token0||call.to===manifest.token1)return coder.encode(['uint8'],[6]);
      if(call.to===manifest.source){const raw=coder.decode(['bytes'],await f.provider.request(args)as string)[0];return coder.encode(['bytes'],[coder.encode(f.observationTypes,units(coder.decode(f.observationTypes,raw).toArray()))]);}
      const parsed=api.parseTransaction({data:call.data});
      if(parsed?.name==='SOURCE_GRAPH')return api.encodeFunctionResult('SOURCE_GRAPH',[`0x${source.graph}`]);
      if(parsed?.name==='decimals0'||parsed?.name==='decimals1')return api.encodeFunctionResult(parsed.name,[6]);
      if(parsed?.name==='getDays'){
        const rows=api.decodeFunctionResult('getDays',await f.provider.request(args)as string)[0].toArray(true)as unknown[][];
        for(const row of rows)if(row[1])units(row[2]as unknown[]);
        return api.encodeFunctionResult('getDays',[rows]);
      }
    }
    return f.provider.request(args);
  }};
  return{...f,manifest,provider};
}
describe('current recorder artifact and six-decimal price reads',()=>{
  it('uses the exact graph-only recorder derivative and unchanged ABI/storage settings',()=>{
    const root='../ChainWhisper Contracts V2/validation/candidates/shared-core-exit-preview-native-2026-10-07/reference-history/recorder-build/';
    const bytes=readFileSync(root+'build-1/ChainWhisperDailyPoolPrice.json'),compiled=JSON.parse(bytes.toString()),identity=JSON.parse(readFileSync(root+'build-1/identity.json','utf8'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.artifactSha256);
    expect(artifact.abi).toEqual(compiled.abi);expect(artifact.deployedBytecode).toBe(compiled.deployedBytecode);
    expect(identity).toMatchObject({graph:source.graph,abiUnchanged:true,storageUnchanged:true,settingsUnchanged:true,sourceGraphOnlyChange:true,runtimeBytes:5676,initWithArgumentsBytes:8159,nativeAdmission:false});
  });
  it('keeps priceE18 whole-token units while token base units use six decimals',async()=>{
    const f=fixture(),snapshot=await readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0});
    expect(snapshot.slots.filter(slot=>slot.point)).toHaveLength(2);expect(snapshot.slots[31].point).toBeNull();
    expect(snapshot.currentObservation?.priceE18).toBe('2000000000000000000');
    const view:CurrentDexDailyPriceView={status:'ready',snapshot},now=HISTORY_FIXTURE_DAY*86400n+100n;
    expect(currentDexMarketReference(view,f.manifest.symbols,now)).toMatchObject({status:'available',price:2});
    expect(currentDexMarketReference(view,[f.manifest.symbols[1],f.manifest.symbols[0]],now)).toMatchObject({status:'available',price:.5});
  });
  it.each(['stale','suppressed','unobserved']as const)('does not turn saved daily samples into a %s current quote',async mode=>{
    const f=fixture(mode),snapshot=await readCurrentDexDailyPrice({provider:f.provider,manifest:f.manifest,finalityLagBlocks:0});
    expect(snapshot.slots.filter(slot=>slot.point)).toHaveLength(2);expect(snapshot.currentObservation).toBeUndefined();
    expect(currentDexMarketReference({status:'ready',snapshot},f.manifest.symbols,HISTORY_FIXTURE_DAY*86400n+100n).status).toBe(mode==='stale'?'stale':'unavailable');
  });
  it('rejects old recorder artifact identity before any RPC',async()=>{
    const f=fixture();let calls=0;await expect(readCurrentDexDailyPrice({provider:{request:async()=>{calls++;throw Error('MUST_NOT_READ');}},manifest:{...f.manifest,recorderArtifact:oldArtifact.artifactSha256}})).rejects.toThrow('candidate');expect(calls).toBe(0);
  });
  it('rejects an old recorder runtime passed with the new graph identity',async()=>{
    const f=fixture(),provider={request:async(args:Parameters<typeof f.provider.request>[0])=>args.method==='eth_getCode'&&(args.params as unknown[])[0]===f.manifest.address?oldArtifact.deployedBytecode:f.provider.request(args)};
    await expect(readCurrentDexDailyPrice({provider,manifest:{...f.manifest,runtimeHash:keccak256(oldArtifact.deployedBytecode)},finalityLagBlocks:0})).rejects.toThrow('code differs');
  });
});
