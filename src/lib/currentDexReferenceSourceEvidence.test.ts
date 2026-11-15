import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURRENT_DEX_REFERENCE_SOURCE_LAYOUT as layout, PACKED_DEX_REFERENCE_SOURCE_IDENTITY as packedIdentity } from './currentDexReferenceSourceLayout';

// These checks read the exact compiled candidates in ChainWhisper Contracts V2 (build info, manifest, Core artifact).
// The App repository alone does not contain them, so `npm run test:ci` excludes this file. `npm test` runs it.
describe('unchanged current-source price verification: compiled candidate evidence',()=>{
 it.each([
  ['packed-rate-input-2026-11-03/reference-fix-build-1',layout],
  ['c1-gap-aware-sizing-2026-11-15/build-1',packedIdentity]
 ] as const)('uses the exact pinned %s layout and artifact identities',(build,identity)=>{
  const root=`../ChainWhisper Contracts V2/validation/candidates/${build}/snapshot/`,bytes=readFileSync(root+'build-info/graph.json'),info=JSON.parse(bytes.toString()),l=info.output.contracts['contracts/dex/ChainWhisperDexCore.sol'].ChainWhisperDexCore.storageLayout;
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(identity.buildInfoSha256);
  const manifest=JSON.parse(readFileSync(root+'../manifest.json','utf8')),entry=manifest.graph.find((x:{path:string})=>x.path.endsWith('/ChainWhisperDexCore.json'));
  const artifact=readFileSync(root+entry.path);expect(createHash('sha256').update(artifact).digest('hex')).toBe(identity.coreArtifactSha256);
  const referenceSource=info.input.sources['contracts/dex/ChainWhisperDexPoolReference.sol'].content.replace(/\r\n/g,'\n');
  expect(createHash('sha256').update(referenceSource).digest('hex')).toBe('9d6bd11c9a4afd72b511a0ff2832affc8b39658848329dadcecf4addc797e62f');
  const field=l.storage.find((x:{label:string})=>x.label==='_marketState'),pool=l.types[l.types[field.type].value].members.find((x:{label:string})=>x.label==='_pool'),members=l.types[pool.type].members;
  expect(field.slot).toBe(layout.marketSlot);expect(pool.slot).toBe(layout.poolSlot);
  const positions=members.find((x:{label:string})=>x.label==='positions');expect(positions.slot).toBe(layout.positionsSlot);expect(members.find((x:{label:string})=>x.label==='sharedAnchorId').slot).toBe(layout.anchorsSlot);
  for(const [definition,fields]of [[layout.poolFields,members],[layout.anchorFields,l.types[l.types[positions.type].value].members]] as const)for(const [name,expected]of Object.entries(definition)){const actual=fields.find((x:{label:string})=>x.label===name);expect({slot:actual.slot,offset:actual.offset,bytes:Number(l.types[actual.type].numberOfBytes)}).toEqual({slot:expected.slot,offset:expected.offset,bytes:expected.bytes});}
 });
});
