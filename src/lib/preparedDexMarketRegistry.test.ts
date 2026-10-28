import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Interface } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import { createDexV2ReadCapability, readPreparedDexMarketRegistry } from './dexV2Chain';
import { STAGED_PREPARED_DEX_CANDIDATE as prepared } from './currentDexPreparedCandidate';

const captureBytes = readFileSync(new URL('../../reports/prepared-candidate-2026-10-07/public-capture-2.json', import.meta.url));
type Row = { method: string; params: unknown[]; result: unknown };
const capture = JSON.parse(captureBytes.toString()) as { reads: Row[] };
const keyFor = (method: string, params: unknown[]) => {
  const normalized = [...params];
  if (method === 'eth_call') normalized[0] = { ...(params[0] as object), to: (params[0] as { to: string }).to.toLowerCase() };
  if (method === 'eth_getCode' || method === 'eth_getStorageAt') normalized[0] = String(params[0]).toLowerCase();
  return JSON.stringify([method, normalized]);
};
const saved = new Map(capture.reads.map(row => [keyFor(row.method, row.params), row.result]));
const registry = new Interface(['function marketForTokens(address input,address output) view returns(bytes32 selectedMarket,uint256 canonicalId,uint256 registryRevision,uint256 marketRevision,bool enabled,address engine,address terms)']);
const number = BigInt(prepared.attestationBlock.number), blockHash = prepared.attestationBlock.hash;
function fixture(change?: (method: string, params: unknown[], value: unknown) => unknown) {
  let active = true;
  const assertCurrent = vi.fn(() => { if (!active) throw new Error('Owner scope changed.'); });
  const request = vi.fn(async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
    expect(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getStorageAt', 'eth_call']).toContain(method);
    const key = keyFor(method, params);
    if (!saved.has(key)) throw new Error(`Missing exact captured read: ${method}`);
    return change ? change(method, params, saved.get(key)) : saved.get(key);
  });
  const capability = createDexV2ReadCapability({ provider: { request }, chainId: BigInt(prepared.chainId), assertCurrent });
  return { request, assertCurrent, capability, revoke: () => { active = false; },
    run: (blockNumber = number) => readPreparedDexMarketRegistry({ capability, blockNumber, blockHash }) };
}
const isRegistry = (method: string, params: unknown[]) => method === 'eth_call' &&
  (params[0] as { data: string }).data.startsWith(registry.getFunction('marketForTokens')!.selector);
const changedRegistry = (params: unknown[], raw: unknown, index: number, value: unknown) => {
  const data = (params[0] as { data: string }).data;
  const selected = registry.decodeFunctionData('marketForTokens', data)[0].toLowerCase();
  if (selected !== prepared.pairs[5].tokens[0]) return raw;
  const values = [...registry.decodeFunctionResult('marketForTokens', raw as string)]; values[index] = value;
  return registry.encodeFunctionResult('marketForTokens', values);
};

describe('prepared six-market public App reader', () => {
  it('uses the same explicit accepted key and rejects other keys before public reads', async () => {
    const f = fixture();
    const explicit = await readPreparedDexMarketRegistry({ capability: f.capability, blockNumber: number, blockHash, candidate: 'cheap-prepared' });
    expect(explicit).toEqual(await f.run());
    const other = fixture();
    await expect(readPreparedDexMarketRegistry({ capability: other.capability, blockNumber: number, blockHash, candidate: 'cheap-d06' })).rejects.toThrow('candidate changed');
    expect(other.request).not.toHaveBeenCalled();
  });
  it('uses the exact frozen ABI and accepted capture provenance', () => {
    const frozen = createRequire(import.meta.url)('../../../ChainWhisper Contracts V2/validation/candidates/shared-core-prepared-markets-2026-10-07/candidate.cjs').frozen();
    const exact = new Interface(frozen.artifacts.ChainWhisperDexCore.abi);
    expect(registry.getFunction('marketForTokens')!.format('full')).toBe(exact.getFunction('marketForTokens')!.format('full'));
    expect(createHash('sha256').update(JSON.stringify(frozen.artifacts.ChainWhisperDexCore.abi)).digest('hex')).toBe(prepared.protocol.coreAbiSha256);
    expect(createHash('sha256').update(captureBytes).digest('hex')).toBe(prepared.attestationSha256);
  });

  it('replays all six pairs in both directions with immutable public results', async () => {
    const f = fixture(), result = await f.run();
    expect(result).toMatchObject({ graph: prepared.graph, packageSha256: prepared.packageSha256, core: prepared.core,
      registryRevision: 7n, readyToSign: false });
    expect(result.tokens.map(token => token.address)).toEqual(prepared.tokens.map(([address]) => address));
    expect(result.markets.map(market => [market.marketId, market.canonicalId, market.token0, market.token1, market.engine, market.poolTerms]))
      .toEqual(prepared.pairs.map(pair => [pair.marketId, BigInt(pair.canonicalId), ...pair.tokens, pair.engine, pair.poolTerms]));
    const calls = f.request.mock.calls.filter(([call]) => isRegistry(call.method, call.params ?? []));
    expect(calls).toHaveLength(12);
    for (const pair of prepared.pairs) {
      const seen = calls.map(([call]) => [...registry.decodeFunctionData('marketForTokens', (call.params![0] as { data: string }).data)].map(value => value.toLowerCase()));
      expect(seen).toContainEqual([...pair.tokens]); expect(seen).toContainEqual([...pair.tokens].reverse());
    }
    const frozen = (value: unknown): void => { if (value && typeof value === 'object') { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(frozen); } };
    frozen(result); expect(f.request.mock.calls.length).toBeLessThan(250);
  });

  it.each([[0, `0x${'77'.repeat(32)}`], [1, 99n], [4, false], [5, prepared.core], [6, prepared.core]])('rejects changed registry field %s', async (index, value) => {
    const f = fixture((method, params, raw) => isRegistry(method, params) ? changedRegistry(params, raw, index as number, value) : raw);
    await expect(f.run()).rejects.toThrow('Prepared market');
  });

  it('rejects non-canonical ABI results and inconsistent directions', async () => {
    let reads = 0;
    await expect(fixture((method, params, raw) => isRegistry(method, params) ? String(raw) + '00'.repeat(32) : raw).run()).rejects.toThrow('non-canonical');
    await expect(fixture((method, params, raw) => {
      if (!isRegistry(method, params) || ++reads !== 2) return raw;
      const values = [...registry.decodeFunctionResult('marketForTokens', raw as string)]; values[2] = 8n;
      return registry.encodeFunctionResult('marketForTokens', values);
    }).run()).rejects.toThrow('directions');
  });

  it('returns observed revisions instead of treating the capture revision as current', async () => {
    const f = fixture((method, params, raw) => {
      if (!isRegistry(method, params)) return raw;
      const values = [...registry.decodeFunctionResult('marketForTokens', raw as string)]; values[2] = 8n; values[3] = 2n;
      return registry.encodeFunctionResult('marketForTokens', values);
    });
    const result = await f.run(); expect(result.registryRevision).toBe(8n); expect(result.markets.every(market => market.marketRevision === 2n)).toBe(true);
  });

  it('rejects a nested companion runtime change and a PoolTerms token-order change', async () => {
    const pair = prepared.pairs[5], math = pair.companions.find(([role]) => role === 'ChainWhisperSharedPoolMath')![1];
    await expect(fixture((method, params, raw) => method === 'eth_getCode' && params[0] === math ? '0x00' : raw).run()).rejects.toThrow('runtime hash');
    const terms = new Interface(['function token0() view returns(address)']);
    await expect(fixture((method, params, raw) => {
      const call = params[0] as { to?: string; data?: string };
      return method === 'eth_call' && call.to === pair.poolTerms && call.data === terms.encodeFunctionData('token0')
        ? terms.encodeFunctionResult('token0', [pair.tokens[1]]) : raw;
    }).run()).rejects.toThrow('token0');
  });

  it('rejects a changed final block, wrong network, missing market and revoked owner scope', async () => {
    let registrySeen = false;
    await expect(fixture((method, params, raw) => {
      if (isRegistry(method, params)) registrySeen = true;
      return registrySeen && method === 'eth_getBlockByNumber' && params[0] !== '0x0'
        ? { ...(raw as object), hash: `0x${'55'.repeat(32)}` } : raw;
    }).run()).rejects.toThrow('anchor');
    await expect(fixture((method, _params, raw) => method === 'eth_chainId' ? '0x1' : raw).run()).rejects.toThrow('networks');
    await expect(fixture((method, params, raw) => { if (isRegistry(method, params)) throw new Error('Market RPC unavailable'); return raw; }).run()).rejects.toThrow('unavailable');
    const f = fixture(); f.revoke(); await expect(f.run()).rejects.toThrow('scope'); expect(f.request).not.toHaveBeenCalled();
    const g = fixture((method, params, raw) => { if (isRegistry(method, params)) g.revoke(); return raw; });
    await expect(g.run()).rejects.toThrow('scope');
    await expect(fixture().run(number - 1n)).rejects.toThrow('after the read block');
  });
});
