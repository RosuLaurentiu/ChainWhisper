import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AbiCoder, Interface } from '@coti-io/coti-ethers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PACKED_INPUT_DEX_DAILY_PRICE_ARTIFACT } from './packedInputDexDailyPriceArtifact';
import { CROSSED_REFERENCE_DEX_DAILY_PRICE_ARTIFACT } from './currentDexReferenceDailyPriceArtifact';
import { readCurrentDexDailyPrice } from './currentDexDailyPrice';
import { CURRENT_DEX_DAILY_PRICE_SOURCE, REFERENCE_DEX_DAILY_PRICE_SOURCE } from '../../tests/fixtures/historicalDailyPriceSources';
import { makeHistoryFixture } from '../../tests/fixtures/history.fixture';

const coder=AbiCoder.defaultAbiCoder();
afterEach(()=>vi.restoreAllMocks());

describe('current DEX reference daily price current',()=>{
  it('retains old artifact/export evidence while rejecting its runtime graph',async()=>{
    const f=makeHistoryFixture();let calls=0;
    await expect(readCurrentDexDailyPrice({provider:{request:async()=>{calls++;throw Error('MUST_NOT_READ');}},manifest:{...f.manifest,sourceGraph:REFERENCE_DEX_DAILY_PRICE_SOURCE.graph,recorderArtifact:CROSSED_REFERENCE_DEX_DAILY_PRICE_ARTIFACT.artifactSha256}})).rejects.toThrow('candidate');expect(calls).toBe(0);
    const bytes=readFileSync('../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/reference-history/recorder-build/build-reference-fix-1/ChainWhisperDailyPoolPrice.json');
    const candidate=JSON.parse(bytes.toString());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(CROSSED_REFERENCE_DEX_DAILY_PRICE_ARTIFACT.artifactSha256);
    expect(CROSSED_REFERENCE_DEX_DAILY_PRICE_ARTIFACT.abi).toEqual(candidate.abi);
    expect(CROSSED_REFERENCE_DEX_DAILY_PRICE_ARTIFACT.deployedBytecode).toBe(candidate.deployedBytecode);
    const result=JSON.parse(readFileSync('reports/current-reference-recorders-2026-11-07/RESULT.json','utf8'));
    for(let i=1;i<=6;i++){
      const exported=JSON.parse(readFileSync(`reports/current-reference-recorders-2026-11-07/recorder-${i}-export.json`,'utf8'));
      const manifest=JSON.parse(readFileSync(`../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/reference-history/directory-reference-fix-2026-11-07/deploy-${i}-1/manifest.json`,'utf8'));
      expect(result.recorders[i-1].manifest).toEqual(exported.manifest);
      expect(exported.manifest).toMatchObject({sourceGraph:manifest.graph,chainId:manifest.chainId,genesisHash:manifest.genesisHash,address:manifest.binding.address,source:manifest.core,releaseId:manifest.binding.releaseId,market:manifest.selected.market,canonicalId:manifest.selected.canonicalId,pair:manifest.selected.pair,token0:manifest.selected.token0,token1:manifest.selected.token1});
    }
  });

  it.each(['observation','getter'] as const)('rejects the legacy policy on the current %s path',async target=>{
    const f=makeHistoryFixture('ready'),api=new Interface(PACKED_INPUT_DEX_DAILY_PRICE_ARTIFACT.abi),legacy=CURRENT_DEX_DAILY_PRICE_SOURCE.policy;
    const provider={request:async(args:Parameters<typeof f.provider.request>[0])=>{
      const raw=await f.provider.request(args);if(args.method!=='eth_call')return raw;
      const call=(args.params as unknown[])[0] as {to:string;data:string};
      if(target==='observation'&&call.to===f.manifest.source){const encoded=coder.decode(['bytes'],raw as string)[0],values=coder.decode(f.observationTypes,encoded).toArray();values[1]=legacy;return coder.encode(['bytes'],[coder.encode(f.observationTypes,values)]);}
      if(target==='getter'&&call.to===f.manifest.address){const parsed=api.parseTransaction({data:call.data});if(parsed?.name==='POLICY')return api.encodeFunctionResult('POLICY',[legacy]);}
      return raw;
    }};
    await expect(readCurrentDexDailyPrice({provider,manifest:f.manifest,finalityLagBlocks:0})).rejects.toThrow();
  });
  it.each(['aged','other-day'] as const)('keeps the current daily record rule strict for %s samples',async fault=>{
    const f=makeHistoryFixture('ready'),api=new Interface(PACKED_INPUT_DEX_DAILY_PRICE_ARTIFACT.abi);
    const provider={request:async(args:Parameters<typeof f.provider.request>[0])=>{
      const raw=await f.provider.request(args);if(args.method!=='eth_call')return raw;
      const call=(args.params as unknown[])[0] as {to:string;data:string};if(call.to!==f.manifest.address||api.parseTransaction({data:call.data})?.name!=='getDays')return raw;
      const page=api.decodeFunctionResult('getDays',raw as string)[0].toArray(true),row=page.find((r:unknown[])=>r[1]===true) as unknown[],observation=row[2] as bigint[];
      if(fault==='aged')row[3]=observation[16]+121n;else observation[16]=(BigInt(row[0] as string)+1n)*86400n;
      return api.encodeFunctionResult('getDays',[page]);
    }};
    await expect(readCurrentDexDailyPrice({provider,manifest:f.manifest,finalityLagBlocks:0})).rejects.toThrow('History sample provenance');
  });
});
