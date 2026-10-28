import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Interface, keccak256 } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import { CURRENT_NATIVE_DEX_DAILY_PRICE_ARTIFACT as artifact } from './currentDexNativeDailyPriceArtifact';
import { CURRENT_DEX_DAILY_PRICE_ARTIFACT as oldArtifact } from './currentDexDailyPriceArtifact';
import { CURRENT_NATIVE_DEX_DAILY_PRICE_SOURCE as source, CURRENT_DEX_DAILY_PRICE_CONFIG, readCurrentDexDailyPrice } from './currentDexDailyPrice';
import { makeHistoryFixture } from '../../tests/fixtures/history.fixture';

// Synthetic RPC only. The retained fixture is unchanged; the new compiled recorder
// and SOURCE_GRAPH getter are substituted for local artifact selection checks.
function fixture() {
  const f = makeHistoryFixture(), api = new Interface(artifact.abi);
  const manifest = { ...f.manifest, sourceGraph: source.graph, recorderArtifact: artifact.artifactSha256, runtimeHash: keccak256(artifact.deployedBytecode) };
  const provider = { request: async (args: Parameters<typeof f.provider.request>[0]) => {
    const params = args.params as unknown[];
    if (args.method === 'eth_getCode' && params[0] === manifest.address) return artifact.deployedBytecode;
    if (args.method === 'eth_call') {
      const call = params[0] as { to: string; data: string };
      if (call.to === manifest.address && api.parseTransaction({ data: call.data })?.name === 'SOURCE_GRAPH') return api.encodeFunctionResult('SOURCE_GRAPH', [`0x${source.graph}`]);
    }
    return f.provider.request(args);
  } };
  return { f, api, manifest, provider };
}
describe('current-candidate daily history artifact', () => {
  it('binds the generated artifact to the exact completed local compile and keeps feed inactive', () => {
    const bytes = readFileSync('../ChainWhisper Contracts V2/validation/candidates/next-dex-history-2026-10-04/build-2/ChainWhisperDailyPoolPrice.json');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.artifactSha256);
    const compiled = JSON.parse(bytes.toString()); expect(artifact.abi).toEqual(compiled.abi); expect(artifact.deployedBytecode).toBe(compiled.deployedBytecode);
    expect(artifact.abi).toEqual(oldArtifact.abi); expect(artifact.deployedBytecode).not.toBe(oldArtifact.deployedBytecode);
    expect(CURRENT_DEX_DAILY_PRICE_CONFIG.status).toBe('inactive');
  });
  it('reads current-candidate synthetic provenance through the unchanged history rules', async () => {
    const f = fixture(), s = await readCurrentDexDailyPrice({ provider: f.provider, manifest: f.manifest, finalityLagBlocks: 0 });
    expect(s.manifest.sourceGraph).toBe(source.graph); expect(s.slots).toHaveLength(32); expect(s.slots.filter(x => x.point)).toHaveLength(2);
    expect(s.currentReference).toBe('available');
  });
  it('rejects cross-candidate artifact selection before RPC', async () => {
    const f = fixture(); let calls = 0;
    const provider = { request: async () => { calls++; throw new Error('No RPC'); } };
    await expect(readCurrentDexDailyPrice({ provider, manifest: { ...f.manifest, recorderArtifact: oldArtifact.artifactSha256 } })).rejects.toThrow('candidate');
    expect(calls).toBe(0);
  });
  it('rejects a retained recorder code supplied under the new artifact identity', async () => {
    const f = fixture(), provider = { request: async (args: Parameters<typeof f.provider.request>[0]) => {
      if (args.method === 'eth_getCode' && (args.params as unknown[])[0] === f.manifest.address) return oldArtifact.deployedBytecode;
      return f.provider.request(args);
    } };
    await expect(readCurrentDexDailyPrice({ provider, manifest: { ...f.manifest, runtimeHash: keccak256(oldArtifact.deployedBytecode) }, finalityLagBlocks: 0 })).rejects.toThrow('code differs');
  });
});
